# CLAUDE.md — reglas para trabajar en este repositorio

Backoffice personal y privado de un solo usuario: finanzas, tareas y notas. Monorepo con `apps/web`
(React + Vite + Tailwind, PWA), `apps/api` (Express 5, monolito modular) y `packages/shared` (esquemas
Zod). Usa PostgreSQL. El diseño está en `docs/plan.md`, el contrato del Excel en `docs/plantilla-excel.md` y la
matriz de seguridad (OWASP ASVS 5.0 L2) en `docs/seguridad/asvs-l2.md`.
Si alguno de esos documentos contradice el código, avisa antes de cambiar nada.

## Forma de trabajar: entender → diseñar → implementar → comprobar
1. **Entender**: lee el código, el README del módulo y los ADR relacionados. Si el objetivo es ambiguo, pregunta.
2. **Diseñar**: explica en pocas líneas qué vas a cambiar y por qué antes de tocar varios archivos.
3. **Implementar**: haz el cambio mínimo que resuelve lo pedido. No incluyas refactors ni mejoras que no se hayan pedido.
4. **Comprobar**: ejecuta lint, typecheck y tests (más abajo). Informa del resultado real, incluidos los fallos.

## Alcance
- Cambios pequeños y dentro de lo pedido. Si algo fuera del alcance lo requiere, propónlo y espera confirmación.
- No cambies la arquitectura (módulos, capas, formato de errores, versionado de la API) sin un ADR nuevo en `docs/adr/`.
- No añadas dependencias sin justificarlas en `docs/dependencias.md`: para qué sirve, qué alternativa había,
  licencia y estado de mantenimiento. Antes, comprueba si Node, el navegador o PostgreSQL ya lo resuelven.

## Arquitectura (resumen)
- Módulos en `apps/api/src/modules/`: auth, finance, imports, tasks, notes y notifications.
- Capas: rutas → controlador → servicio → repositorio. La lógica pura (cálculos) va en `domain/`, sin E/S.
- Un módulo solo importa a otro a través de su `index.ts` (servicio público). Nunca accede a su repositorio ni a sus tablas.
- La API está bajo `/api/v1`. Todas las rutas exigen sesión salvo una lista explícita. Errores en formato RFC 9457 con el gestor central.
- Validación con los esquemas de `packages/shared`, que se usan en el frontend y en el backend.

## Base de datos
- **Nunca edites una migración ya aplicada o publicada en `main`: crea una nueva.** La CI lo comprueba.
- Importes como `bigint` en céntimos (`*_cents`). Nunca `float`, `parseFloat` ni `Number(texto)` con importes:
  usa la utilidad de importes de `packages/shared`.
- No guardes datos derivados (saldos, totales, proyecciones): se calculan al leer.
- Las reglas de negocio importantes también van como restricciones en la base de datos (`CHECK`, FK, índices únicos).

## Convenciones de código
- Identificadores en inglés. Comentarios, documentación, mensajes de commit y textos de la interfaz en español.
- Los comentarios explican el **porqué**, no lo que ya dice el código.
- TSDoc obligatorio en las funciones exportadas y en toda la lógica financiera (unidades, redondeo, casos límite).
- Cada módulo tiene un `README.md`: responsabilidad, API pública, tablas y decisiones.
- TypeScript estricto. No uses `any` ni `@ts-ignore` sin un comentario que lo justifique.

## Tests (obligatorios en la lógica de negocio)
- Cálculos financieros, importador del Excel, conciliación, permisos (rutas sin sesión, sin CSRF o con un
  token de dispositivo) e ingesta del atajo.
- Un cambio de comportamiento lleva su test. Un error corregido lleva un test que lo reproduce.

## Comprobar antes de dar algo por terminado
Node ≥ 24.12 y pnpm 10.34.9. `pnpm test` necesita PostgreSQL (`pnpm db:up`) y `TEST_DATABASE_URL` en `.env`.
- `pnpm lint` (ESLint + Prettier) · `pnpm typecheck` · `pnpm test` · `pnpm build`
- `pnpm secrets:scan` (gitleaks sobre el historial) · `pnpm check:migrations origin/main`
- Migraciones: `pnpm db:migrate`. Nuevas en `apps/api/src/db/migrations/NNNN_descripcion.ts`.

Si no puedes ejecutarlos, dilo explícitamente. Nunca desactives, saltes ni borres un test para que la CI pase.

## Repositorio PÚBLICO: todo lo que se sube (también el historial) es público
- Nunca subas secretos, dominios, IP, correos de terceros, datos privados, nombres reales de cuentas, bancos o
  tarjetas, ni datos financieros: ni en el código, ni en los tests, ni en la documentación, ni en los commits.
- Configuración solo por variables de entorno (`.env` está ignorado; `.env.example` va sin valores). El dominio
  de producción es `PUBLIC_ORIGIN`, nunca un literal en el código.
- **Nunca subas datos reales**: ni el Excel real, ni extractos, ni volcados, ni capturas con cifras. Los tests
  usan solo fixtures FICTICIAS de `apps/api/test/fixtures/`. Los resultados de las pruebas en el dispositivo, solo
  como recuentos y formatos.
- gitleaks se ejecuta en pre-commit y en CI: no lo desactives ni amplíes `.gitleaksignore` sin explicarlo.
- Si se sube un secreto por error: avisa, **rótalo primero** y después límpialo (`docs/runbooks/github.md` §8).
- Los cambios de seguridad actualizan `docs/seguridad/asvs-l2.md` en el mismo PR.

## Seguridad y datos
- No registres en los logs cookies, tokens, contraseñas ni cuerpos de petición con datos financieros.
- Nunca guardes números de tarjeta ni credenciales bancarias: de cada tarjeta solo se guarda su nombre en Wallet.
- No evalúes ni ejecutes nada del contenido de los archivos subidos.
- Nunca leas, muestres ni copies `.env`. Para conocer las variables usa `.env.example` y `apps/api/src/config/env.ts`. Si necesitas un valor, pídemelo.

## Git
- Commits pequeños y con un mensaje descriptivo en español. No hagas push directo a `main`: siempre mediante PR con la CI en verde.
- El correo del propietario ya es público en su perfil de GitHub y se acepta en el historial. No se reescribe el
  historial por ese motivo. Nunca se añaden correos de terceros.
