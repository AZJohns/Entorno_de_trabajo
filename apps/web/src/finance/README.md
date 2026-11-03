# Pantallas del libro real (web)

Interfaz de `apps/api/src/modules/finance/ledger`. Diseño y API: `docs/plan.md` §2.3 y §2.10.

| Ruta | Pantalla | Archivo |
|---|---|---|
| `/cuentas` | Lista con saldo, alta, edición y archivado | `pages/AccountsPage.tsx` |
| `/cuentas/:id/conciliacion` | Conciliar, historial con aviso de discrepancia y borrar | `pages/ReconciliationPage.tsx` |
| `/categorias` | Alta, renombrar y archivar (gastos e ingresos) | `pages/CategoriesPage.tsx` |
| `/movimientos` | Filtros de la API, alta, edición, borrado con confirmación y confirmar pendientes | `pages/MovementsPage.tsx` |
| `/transferencias` | Filtros, alta, edición y borrado con confirmación | `pages/TransfersPage.tsx` |

## Estructura

- `queries.ts`: hooks de react-query; validan las respuestas con los esquemas de `@backoffice/shared`. Cada cambio invalida todo `['finance']` porque cambia saldos y listas.
- `formLogic.ts`: lógica **pura** de los formularios (texto → petición o mensaje por campo). Los importes se convierten solo con `readAmount` (`amount.ts` → `parseEuroAmount`): no hay `parseFloat` ni `Number` con importes.
- `forms/`: formularios presentacionales (reciben callbacks y el error de la API; no conocen react-query), con foco en el primer campo con error.
- `dates.ts`: fechas como texto, sin `Date` para formatear (evita el desfase de zona horaria).
- `../ui/finance-forms.tsx`: campos con etiqueta y `aria-describedby`, `ProblemNotice` y `ConfirmBar`.

## Errores de la API

`ProblemNotice` muestra el mensaje en español de la API y distingue los dos casos de un formulario válido:
**409** «No se puede hacer ahora» (el estado lo impide: cuenta archivada, nombre repetido, saldo ≠ 0 al archivar, mes ya conciliado) y
**422** «Revisa los datos» (incoherente con lo guardado: fecha anterior a la apertura, categoría de otro tipo).

## Decisiones

- Las cuentas archivadas y los ajustes de conciliación no se editan ni se borran desde la lista (la API respondería 409); un ajuste se borra con su conciliación.
- Las listas paginadas usan «Cargar más» con el cursor de la API.
- Un importe con un único separador y exactamente tres cifras (`12,345`) se interpreta como miles (12.345 €), según `parseEuroAmount`; el campo lo indica en su ayuda.
