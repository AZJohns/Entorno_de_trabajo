# Notificaciones (web)

Interfaz de `apps/api/src/modules/notifications`. Diseño y API: `docs/plan.md` §2.7 y §2.10. Ruta: `/notificaciones`.

| Archivo | Contenido |
|---|---|
| `NotificationBell.tsx` | Campana del menú (`pages/Layout.tsx`) con el número de no leídas y enlace a la lista |
| `NotificationsPage.tsx` | Lista de las 50 más recientes, «Nueva» en las no leídas, marcar una o todas como leídas y enlace al tablero en los recordatorios |
| `queries.ts` | react-query: contador, lista y las dos mutaciones |

## Decisiones

### El contador no se consulta cada cierto tiempo

Cada petición con sesión activa renueva el plazo de inactividad de 1 hora (`apps/api/src/modules/auth/auth.middleware.ts`, `docs/plan.md` §6.2). Un sondeo cada minuto mantendría la sesión abierta sin que nadie usara la app y anularía ese bloqueo. Por eso el contador se refresca solo cuando la persona actúa:

- al **cambiar de pantalla** (la campana lo pide al cambiar la ruta);
- al **volver a la ventana** (`refetchOnWindowFocus` de react-query);
- tras **marcar** notificaciones.

Consecuencia: un recordatorio que vence con la app abierta y sin tocar se ve en la siguiente interacción. Que avise **sin abrir la app** es el push de la fase 2. Si una sesión ya estaba bloqueada, la petición del contador recibe `SESSION_LOCKED` y la aplicación lleva a la pantalla de desbloqueo, igual que cualquier otra. El test «no sondea» comprueba que la consulta no tiene intervalo.

### Accesibilidad

El número va escrito (no solo un color) y el enlace lo anuncia completo («Notificaciones, 3 sin leer»). Las no leídas se marcan con el texto «Nueva», no solo con el borde.

### Horas

Se muestran en la hora de Madrid con CET/CEST (`ui/moment.ts`), la misma zona en la que se escriben los recordatorios.
