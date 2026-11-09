# Pantalla «Tareas» (web)

Interfaz de `apps/api/src/modules/tasks`. Diseño y API: `docs/plan.md` §2.6 y §2.10. Ruta: `/tareas`.

| Archivo | Contenido |
|---|---|
| `TasksPage.tsx` | Tablero de cuatro columnas; estado de arrastre, de «tarjeta cogida» con teclado, avisos y mutaciones |
| `TaskCard.tsx` | Tarjeta: fecha límite (con «Vencida» en texto), tiempo, cronómetro, acciones y menú «Mover a…» |
| `TaskForm.tsx` | Alta y edición (título, descripción, fecha límite), validadas con los esquemas de `@backoffice/shared` |
| `TimePanel.tsx` | Total, entradas con borrado y anotación manual (duración o inicio y fin) |
| `boardLogic.ts` | Lógica pura: colocar una tarjeta, traducirla a `move`, vencidas, ventana de «Terminado», duraciones |
| `queries.ts` | react-query: tablero, movimiento optimista con vuelta atrás, tiempo; textos de error en español |

## Decisiones

### Mover tarjetas sin librería de arrastrar y soltar

`docs/plan.md` preveía `@dnd-kit`. No se añade (ver `docs/dependencias.md`): hay tres formas de mover y las tres
funcionan sin dependencia.

- **Ratón**: arrastrar y soltar nativo de HTML5 (`draggable`, `dragover`, `drop`).
- **Teclado y lector de pantalla**: el asa «Reordenar «…»» de cada tarjeta. Espacio o Intro la coge; las flechas
  izquierda/derecha cambian de columna y arriba/abajo de lugar; Espacio o Intro la suelta y Escape cancela. Cada paso
  se anuncia en una región `aria-live`. Si el foco sale del asa, se cancela.
- **Menú «Mover a…»** en cada tarjeta (un `<select>` nativo): es la vía para pantalla táctil, porque el arrastre
  nativo de HTML5 no es fiable en la PWA instalada en iOS. **Comprobar en el iPhone** antes de dar por cerrado el
  criterio «arrastrar funciona en la PWA» de la fase 4.

### Movimiento optimista

La tarjeta cambia de sitio al instante. Si el servidor responde con un error, se restaura el tablero anterior, se
muestra el motivo y se anuncia. Siempre se recarga el tablero al terminar, porque el servidor renumera las posiciones.
El índice de destino no cuenta la propia tarjeta y se traduce a `afterId` (detrás de la anterior), `beforeId` (si va la
primera) o nada (al final).

### «Terminado»

Se ordena por fecha de cierre (la más reciente primero), no a mano: soltar una tarjeta allí la deja al final de la
columna en el servidor, y es la más reciente. Se muestran 10 y «Ver más» añade 10. **Limitación**: la API devuelve la
columna entera, así que lo que se limita es lo que se pinta, no lo que se descarga. Paginar la descarga exige un
`limit` en `GET /tasks?status=done` (propuesto como cambio aparte).

### Cronómetro y «hoy»

- Solo puede haber un cronómetro. Si ya hay otro, se explica cuál sin llamar al servidor; el 409 del servidor (por
  una carrera) se traduce igual.
- El contador solo avanza (un `setInterval` de 1 s) mientras hay un cronómetro en marcha. `role="timer"` no anuncia
  cada segundo; el inicio y la parada se anuncian en la región `aria-live`.
- «Hoy» y la anotación por duración usan el reloj y la zona del **navegador**. Una tarea vence si su fecha límite es
  anterior a hoy y no está terminada (se marca con «⚠ Vencida», no solo con color).
- La anotación por **duración** se guarda como terminada ahora (`inicio = ahora − duración`); para otro momento está
  «Inicio y fin».
