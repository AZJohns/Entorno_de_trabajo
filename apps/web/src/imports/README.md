# Pantalla de la importación del Excel (web)

Interfaz de `apps/api/src/modules/imports`. Diseño: `docs/plan.md` §3.9–§3.11. API y razones de los 409: `apps/api/src/modules/imports/README.md`.

| Ruta            | Pantalla                                                                                                  | Archivo                  |
| --------------- | --------------------------------------------------------------------------------------------------------- | ------------------------ |
| `/importar`     | Mes y archivo; aviso previo de extensión y de 5 MB; subida                                                | `ImportUploadPage.tsx`   |
| `/importar/:id` | Vista previa (resumen, problemas, categorías, líneas), confirmar, descartar y resultado según el estado   | `ImportPreviewPage.tsx`  |

## Estructura

- `queries.ts`: hooks de react-query; validan con los esquemas de `@backoffice/shared` (no se redefine ningún tipo). La subida y la confirmación usan `apiWithStatus` para distinguir 201 de 200.
- `fileCheck.ts`: comprobación **previa** del archivo (extensión, 5 MB, vacío). Es una ayuda: la API decide.
- `messages.ts`: un mensaje en español por cada razón de 409 (`errors[].path`) y por 400, 403, 404, 413, 415 y 422. Funciones puras, con test.
- `previewLogic.ts`: agrupar problemas y categorías, importe de una línea y `confirmOutcome` (201 / «ya estaba confirmada» / «no había cambios»). Solo reordena lo que devuelve la API: no calcula totales ni presupuestos.
- `IssuesPanel.tsx`, `CategoryDecisions.tsx`, `ImportNoticeView.tsx`: piezas presentacionales.

## Decisiones

- **Texto del Excel = texto de React.** Nombre del archivo, hojas, celdas, conceptos, categorías y mensajes se pintan como texto; nada de `dangerouslySetInnerHTML` (lo impide ESLint) ni de HTML construido a mano.
- **El 200 de confirmar tiene dos significados** (ya confirmada / mismo contenido que el plan vigente); solo el estado del lote releído los separa. En el segundo caso el lote sigue en vista previa y la pantalla no vuelve a ofrecer confirmar.
- **Reautenticación**: la subida es S+. Si la app lleva a `/reautenticar`, el archivo elegido se pierde y hay que elegirlo otra vez.
- **Sin lista de importaciones anteriores** (fuera de alcance): una vista previa que se abandona se sustituye subiendo otra.
- Los importes salen de céntimos con `money()` de `finance/amount.ts`: ni `parseFloat` ni `Number(texto)`.

## Tests (`apps/web/test/`)

| Archivo                  | Cubre                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `imports-logic.test.ts`  | Aviso previo (5 MB, extensión, `.xlsm`), un mensaje por cada razón de 409 y por 400/404/413/415/422, agrupación de la vista previa y `confirmOutcome`                                               |
| `imports-pages.test.tsx` | Subida (aviso antes de enviar, binario + CSRF, 201 y 200), texto malicioso literal, confirmar desactivado con errores, decisiones de categoría, 201 frente a 200, los 409 en pantalla y estados del lote |

Todo con datos inventados; nunca se usa ni se pide el Excel real.
