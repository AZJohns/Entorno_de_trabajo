/**
 * Presupuesto por categoría y mes (docs/plan.md §2.3b, fase 3a): cuánto se quiere gastar como máximo en
 * una categoría de gasto durante un mes. Solo guarda ese límite (una **entrada**); lo gastado y lo que
 * queda se calculan al leer con los movimientos confirmados (`domain/budget.ts`), nunca se guardan.
 *
 * Restricciones que también se imponen en la base de datos:
 * - `month` es el primer día del mes. Se valida con `EXTRACT(DAY …) = 1` y no con `date_trunc`, como en
 *   `account_reconciliations` (0003): `date_trunc` compara un `date` con un `timestamptz` y depende de la
 *   zona horaria de la sesión.
 * - Solo categorías de gasto: `kind` vale siempre `'expense'` y la FK compuesta `(category_id, kind)` →
 *   `categories(id, kind)` (la misma que usa `movements`) impide apuntar a una categoría de ingreso.
 *   `kind` existe solo para esa FK; la API no lo expone.
 * - Un único presupuesto por mes y categoría: `UNIQUE (month, category_id)`.
 * - Importe estrictamente positivo: «sin presupuesto» se expresa no teniendo fila, no con un 0.
 *
 * La importación del Excel (fase 3b) rellenará esta misma tabla a través del servicio de presupuestos,
 * por lo que no hay columna de origen: un presupuesto es el mismo dato venga de donde venga.
 */
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE category_budgets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- Primer día del mes presupuestado.
      month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
      category_id uuid NOT NULL,
      -- Constante: existe solo para la clave ajena compuesta (solo categorías de gasto).
      kind text NOT NULL DEFAULT 'expense' CHECK (kind = 'expense'),
      -- Límite de gasto del mes, en céntimos.
      amount_cents bigint NOT NULL CHECK (amount_cents > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      -- RESTRICT: las categorías no se borran, se archivan; un borrado no debe llevarse el presupuesto.
      CONSTRAINT category_budgets_category_expense_fkey FOREIGN KEY (category_id, kind)
        REFERENCES categories (id, kind) ON DELETE RESTRICT,
      CONSTRAINT category_budgets_month_category_key UNIQUE (month, category_id)
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS category_budgets`.execute(db);
}
