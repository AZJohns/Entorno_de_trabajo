/**
 * Capa del plan que rellena la confirmación de la importación del Excel (docs/plan.md §2.4, fase 3b.1,
 * PR 2): la foto de un mes (`plan_snapshots`), las filas de las cinco hojas de entrada y la tabla
 * persistente de correspondencias de categorías.
 *
 * Solo hay **entradas**: ninguna columna guarda totales, proyecciones, estados calculados ni resultados de
 * los checks (plan.md §3.2). Lo calculado se calcula al leer (fase 3b.2).
 *
 * Decisiones de la migración:
 * - Importes en `bigint` (céntimos) y meses en centésimas enteras (`quantity_hundredths`): nunca decimales.
 * - `month` y `expected_date` son `date` (sin zona horaria). El mes es el primer día, con
 *   `EXTRACT(DAY …) = 1` y no `date_trunc` (ver `account_reconciliations`).
 * - Las referencias entre filas de la misma foto son claves ajenas **compuestas** `(snapshot_id, …)`: una
 *   línea, un evento o una meta solo pueden apuntar a una fila de Datos de su propia foto. Con `MATCH
 *   SIMPLE` (el valor por defecto) una referencia con la columna a NULL no se comprueba: así se expresa
 *   «sin referencia» en las columnas opcionales, y los CHECK `num_nonnulls(...)` obligan a que haya
 *   exactamente una de las dos formas (referencia o literal).
 * - `ON DELETE`:
 *   · `snapshot_id → plan_snapshots`: CASCADE. Las filas de una foto no existen sin ella; borrarla (no hay
 *     ruta de la API que lo haga: el historial se conserva) se lleva todo en una sola sentencia.
 *   · claves compuestas hacia `plan_items`: NO ACTION y `DEFERRABLE INITIALLY DEFERRED`. No se puede borrar
 *     una fila de Datos a la que aún apunta algo, pero el borrado en cascada de la foto entera tiene que
 *     funcionar: PostgreSQL ejecuta las cascadas una tras otra y, si la comprobación fuera inmediata (NO
 *     ACTION sin diferir, o RESTRICT), fallaría al borrar `plan_items` antes de borrar las filas que la usan
 *     (se vio en el test de borrado de una foto con escenarios). Diferida, se comprueba al final de la
 *     transacción, cuando ya no queda nada que apunte. Consecuencia: una referencia a una fila de otra foto
 *     se rechaza al confirmar la transacción, no en la sentencia; el servicio la valida antes y la base de
 *     datos es la última defensa.
 *   · `plan_snapshots.import_batch_id → import_batches`: RESTRICT. El lote es el registro de auditoría de
 *     la foto (archivo, hash, fecha); no se borra mientras exista la foto.
 *   · `category_id → categories`: RESTRICT, como en `category_budgets`: las categorías se archivan, no se
 *     borran. La FK es compuesta `(category_id, kind)` con `kind = 'expense'`: **la base de datos impide
 *     que una línea del presupuesto o una correspondencia apunten a una categoría de ingreso**.
 * - **Origen de los presupuestos importados** (`category_budgets.source_snapshot_id`): la confirmación de un
 *   mes que ya tiene foto sustituye los presupuestos que creó la foto anterior y no toca los creados a mano
 *   (docs/plan.md §2.3 y pregunta 39), así que hay que saber de qué foto viene cada uno. NULL = creado a
 *   mano (alta manual, `copy-previous`, o un presupuesto importado que se editó a mano). La FK es compuesta
 *   `(source_snapshot_id, month)` → `plan_snapshots(id, month)`: la base de datos impide citar una foto de
 *   otro mes. `ON DELETE SET NULL (source_snapshot_id)` (PostgreSQL ≥ 15; la columna de la lista deja
 *   intacto `month`, que es NOT NULL): si una foto desapareciera, sus presupuestos pasan a «manuales» y
 *   nunca se borran solos. Ninguna tabla referencia `category_budgets`, así que borrar uno no arrastra nada.
 * - `plan_category_mappings` guarda solo decisiones del usuario (nombre normalizado → categoría); las
 *   correspondencias automáticas por nombre no se guardan porque se vuelven a calcular al subir.
 */
import { sql, type Kysely } from 'kysely';

/** Lista de valores de un CHECK: `'a', 'b', 'c'`. */
const list = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(', ');

const RECORD_TYPES = [
  'income',
  'expense',
  'savings_balance',
  'assumption',
  'emergency_fund_months',
  'goal',
  'scenario',
  'historical',
  'one_off_payment',
];
const UNITS = ['eur_per_month', 'eur', 'months'];
const NATURES = [
  'recurring',
  'variable',
  'irregular',
  'balance',
  'assumption',
  'target',
  'potential',
  'finished',
  'accumulated',
  'paid',
  'one_off',
];
const STATUSES = [
  'confirmed',
  'pending',
  'to_confirm',
  'provisional',
  'estimated',
  'to_confirm_paid',
  'potential',
  'inactive',
  'paused',
  'historical',
];
const EVENT_STATUSES = ['estimated', 'paid', 'finished', 'active', 'inactive', 'not_committed'];

export async function up(db: Kysely<unknown>): Promise<void> {
  // Un lote confirmado ya no guarda las entradas (plan.md §2.5): ahora que existe la confirmación, la base de
  // datos lo exige. Seguro en una base existente: hasta esta migración ningún lote podía confirmarse.
  await sql`
    ALTER TABLE import_batches
      ADD CONSTRAINT import_batches_confirmed_without_extracted
      CHECK (status <> 'confirmed' OR extracted IS NULL)
  `.execute(db);

  await sql`
    CREATE TABLE plan_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
      -- RESTRICT: el lote es el registro de auditoría de la foto. UNIQUE: un lote da una sola foto.
      import_batch_id uuid NOT NULL UNIQUE REFERENCES import_batches (id) ON DELETE RESTRICT,
      content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
      template_version smallint NOT NULL CHECK (template_version >= 2),
      status text NOT NULL CHECK (status IN ('active', 'superseded')),
      created_at timestamptz NOT NULL DEFAULT now(),
      superseded_at timestamptz,
      CONSTRAINT plan_snapshots_superseded_at CHECK (
        (status = 'superseded') = (superseded_at IS NOT NULL)
      ),
      CONSTRAINT plan_snapshots_superseded_after_creation CHECK (
        superseded_at IS NULL OR superseded_at >= created_at
      ),
      -- El mismo contenido no vuelve a ser una foto del mismo mes (ni siquiera una antigua).
      CONSTRAINT plan_snapshots_month_content_key UNIQUE (month, content_hash),
      -- Para la FK compuesta de category_budgets: el origen de un presupuesto es una foto de SU mes.
      CONSTRAINT plan_snapshots_id_month_key UNIQUE (id, month)
    )
  `.execute(db);
  // Una única foto vigente por mes: es lo que impide que dos confirmaciones simultáneas la dupliquen.
  await sql`
    CREATE UNIQUE INDEX plan_snapshots_active_month_key ON plan_snapshots (month) WHERE status = 'active'
  `.execute(db);

  await sql
    .raw(
      `
    CREATE TABLE plan_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id uuid NOT NULL REFERENCES plan_snapshots (id) ON DELETE CASCADE,
      -- Fila del Excel (los datos empiezan en la 6).
      source_row integer NOT NULL CHECK (source_row >= 6),
      record_type text NOT NULL CHECK (record_type IN (${list(RECORD_TYPES)})),
      group_label text NOT NULL CHECK (char_length(group_label) >= 1),
      concept text NOT NULL CHECK (char_length(concept) >= 1),
      unit text NOT NULL CHECK (unit IN (${list(UNITS)})),
      -- Céntimos (€ y €/mes). Todos los importes son positivos o cero.
      amount_cents bigint CHECK (amount_cents >= 0),
      -- Meses en centésimas enteras (6 meses = 600), para calcular sin decimales.
      quantity_hundredths integer CHECK (quantity_hundredths >= 0),
      nature text NOT NULL CHECK (nature IN (${list(NATURES)})),
      status text NOT NULL CHECK (status IN (${list(STATUSES)})),
      -- Una celda de fecha se guarda en ISO YYYY-MM-DD.
      source_note text,
      note text,
      CONSTRAINT plan_items_snapshot_row_key UNIQUE (snapshot_id, source_row),
      -- Para las claves ajenas compuestas: una referencia solo puede apuntar a una fila de la misma foto.
      CONSTRAINT plan_items_snapshot_id_key UNIQUE (snapshot_id, id),
      CONSTRAINT plan_items_unit_value CHECK (
        (unit IN ('eur_per_month', 'eur') AND amount_cents IS NOT NULL AND quantity_hundredths IS NULL)
        OR (unit = 'months' AND quantity_hundredths IS NOT NULL AND amount_cents IS NULL)
      )
    )
  `,
    )
    .execute(db);
  // Como mucho una fila de «Meses de fondo de emergencia» por foto.
  await sql`
    CREATE UNIQUE INDEX plan_items_emergency_months_key ON plan_items (snapshot_id)
      WHERE record_type = 'emergency_fund_months'
  `.execute(db);

  await sql`
    CREATE TABLE plan_budget_lines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id uuid NOT NULL REFERENCES plan_snapshots (id) ON DELETE CASCADE,
      source_row integer NOT NULL CHECK (source_row >= 6),
      category_id uuid NOT NULL,
      -- Constante: existe solo para la clave ajena compuesta (solo categorías de gasto).
      kind text NOT NULL DEFAULT 'expense' CHECK (kind = 'expense'),
      -- El texto original del Excel, solo para mostrarlo.
      category_label text NOT NULL CHECK (char_length(category_label) >= 1),
      concept text NOT NULL CHECK (char_length(concept) >= 1),
      cost_type text NOT NULL CHECK (cost_type IN ('fixed', 'variable', 'irregular')),
      essential boolean NOT NULL,
      -- El importe y el estado no se copian: se leen de esta fila de Datos.
      plan_item_id uuid NOT NULL,
      CONSTRAINT plan_budget_lines_snapshot_row_key UNIQUE (snapshot_id, source_row),
      CONSTRAINT plan_budget_lines_category_expense_fkey FOREIGN KEY (category_id, kind)
        REFERENCES categories (id, kind) ON DELETE RESTRICT,
      CONSTRAINT plan_budget_lines_item_fkey FOREIGN KEY (snapshot_id, plan_item_id)
        REFERENCES plan_items (snapshot_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
    )
  `.execute(db);

  await sql
    .raw(
      `
    CREATE TABLE plan_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id uuid NOT NULL REFERENCES plan_snapshots (id) ON DELETE CASCADE,
      source_row integer NOT NULL CHECK (source_row >= 6),
      concept text NOT NULL CHECK (char_length(concept) >= 1),
      note text,
      -- Texto libre (en la plantilla no tiene validación): solo se muestra.
      nature_label text,
      -- Fila en € o €/mes. Con €/mes, un único pago igual a la cuota.
      amount_item_id uuid,
      -- Fila en meses (forma cuota × plazo).
      multiplier_item_id uuid,
      -- Importe literal en céntimos.
      amount_cents bigint CHECK (amount_cents >= 0),
      status text NOT NULL CHECK (status IN (${list(EVENT_STATUSES)})),
      expected_date date,
      include_in_projection boolean NOT NULL,
      CONSTRAINT plan_events_snapshot_row_key UNIQUE (snapshot_id, source_row),
      CONSTRAINT plan_events_amount_item_fkey FOREIGN KEY (snapshot_id, amount_item_id)
        REFERENCES plan_items (snapshot_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT plan_events_multiplier_item_fkey FOREIGN KEY (snapshot_id, multiplier_item_id)
        REFERENCES plan_items (snapshot_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
      -- El importe es una referencia o un literal, nunca las dos cosas ni ninguna.
      CONSTRAINT plan_events_amount_source CHECK (num_nonnulls(amount_item_id, amount_cents) = 1),
      CONSTRAINT plan_events_multiplier_needs_reference CHECK (
        multiplier_item_id IS NULL OR amount_item_id IS NOT NULL
      ),
      -- Un evento incluido en la proyección necesita fecha (plantilla-excel.md §6.3).
      CONSTRAINT plan_events_included_has_date CHECK (NOT include_in_projection OR expected_date IS NOT NULL)
    )
  `,
    )
    .execute(db);

  await sql`
    CREATE TABLE plan_goals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id uuid NOT NULL REFERENCES plan_snapshots (id) ON DELETE CASCADE,
      source_row integer NOT NULL CHECK (source_row >= 6),
      name text NOT NULL CHECK (char_length(name) >= 1),
      criterion text,
      goal_kind text NOT NULL CHECK (goal_kind IN ('fixed_amount', 'emergency_fund')),
      target_item_id uuid,
      target_cents bigint CHECK (target_cents >= 0),
      current_item_id uuid,
      current_cents bigint CHECK (current_cents >= 0),
      contribution_item_id uuid,
      contribution_cents bigint CHECK (contribution_cents >= 0),
      -- No hay columna de estado: es calculado (plantilla-excel.md §9.4).
      CONSTRAINT plan_goals_snapshot_row_key UNIQUE (snapshot_id, source_row),
      CONSTRAINT plan_goals_target_item_fkey FOREIGN KEY (snapshot_id, target_item_id)
        REFERENCES plan_items (snapshot_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT plan_goals_current_item_fkey FOREIGN KEY (snapshot_id, current_item_id)
        REFERENCES plan_items (snapshot_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
      CONSTRAINT plan_goals_contribution_item_fkey FOREIGN KEY (snapshot_id, contribution_item_id)
        REFERENCES plan_items (snapshot_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
      -- Importe fijo: el objetivo es una referencia o un literal. Fondo de emergencia: ninguno, porque
      -- lo calcula la app (gastos esenciales × meses objetivo).
      CONSTRAINT plan_goals_target CHECK (
        (goal_kind = 'fixed_amount' AND num_nonnulls(target_item_id, target_cents) = 1)
        OR (goal_kind = 'emergency_fund' AND num_nonnulls(target_item_id, target_cents) = 0)
      ),
      CONSTRAINT plan_goals_current CHECK (num_nonnulls(current_item_id, current_cents) = 1),
      CONSTRAINT plan_goals_contribution CHECK (num_nonnulls(contribution_item_id, contribution_cents) = 1)
    )
  `.execute(db);
  await sql`
    CREATE UNIQUE INDEX plan_goals_emergency_fund_key ON plan_goals (snapshot_id)
      WHERE goal_kind = 'emergency_fund'
  `.execute(db);

  await sql`
    CREATE TABLE plan_scenarios (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      snapshot_id uuid NOT NULL REFERENCES plan_snapshots (id) ON DELETE CASCADE,
      source_row integer NOT NULL CHECK (source_row >= 6),
      name text NOT NULL CHECK (char_length(name) >= 1),
      CONSTRAINT plan_scenarios_snapshot_row_key UNIQUE (snapshot_id, source_row),
      CONSTRAINT plan_scenarios_snapshot_id_key UNIQUE (snapshot_id, id)
    )
  `.execute(db);
  // Un escenario es una lista de filas de Datos (no guarda importes propios).
  await sql`
    CREATE TABLE plan_scenario_items (
      scenario_id uuid NOT NULL,
      snapshot_id uuid NOT NULL,
      plan_item_id uuid NOT NULL,
      role text NOT NULL CHECK (role IN ('extra_monthly', 'one_off')),
      PRIMARY KEY (scenario_id, plan_item_id, role),
      -- CASCADE: la lista no existe sin su escenario; y las dos claves comparten snapshot_id, así que
      -- escenario y fila de Datos son siempre de la misma foto.
      CONSTRAINT plan_scenario_items_scenario_fkey FOREIGN KEY (snapshot_id, scenario_id)
        REFERENCES plan_scenarios (snapshot_id, id) ON DELETE CASCADE,
      CONSTRAINT plan_scenario_items_item_fkey FOREIGN KEY (snapshot_id, plan_item_id)
        REFERENCES plan_items (snapshot_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
    )
  `.execute(db);

  await sql`
    CREATE TABLE plan_category_mappings (
      -- Nombre de la categoría de Presupuesto normalizado (plantilla-excel.md §3).
      source_name_normalized text PRIMARY KEY CHECK (
        char_length(source_name_normalized) BETWEEN 1 AND 200
        AND source_name_normalized = btrim(source_name_normalized)
      ),
      category_id uuid NOT NULL,
      kind text NOT NULL DEFAULT 'expense' CHECK (kind = 'expense'),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT plan_category_mappings_category_expense_fkey FOREIGN KEY (category_id, kind)
        REFERENCES categories (id, kind) ON DELETE RESTRICT
    )
  `.execute(db);

  await sql`
    ALTER TABLE category_budgets
      ADD COLUMN source_snapshot_id uuid,
      ADD CONSTRAINT category_budgets_source_snapshot_fkey FOREIGN KEY (source_snapshot_id, month)
        REFERENCES plan_snapshots (id, month) ON DELETE SET NULL (source_snapshot_id)
  `.execute(db);
  // Localiza los presupuestos importados de un mes (los que sustituye una confirmación). Parcial: los
  // manuales, que son casi todos, no ocupan sitio.
  await sql`
    CREATE INDEX category_budgets_source_snapshot_idx ON category_budgets (source_snapshot_id)
      WHERE source_snapshot_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Primero la columna de origen (arrastra su FK y su índice): después ya se pueden borrar las fotos.
  await sql`ALTER TABLE category_budgets DROP COLUMN IF EXISTS source_snapshot_id`.execute(db);
  await sql`DROP TABLE IF EXISTS plan_category_mappings`.execute(db);
  await sql`DROP TABLE IF EXISTS plan_scenario_items`.execute(db);
  await sql`DROP TABLE IF EXISTS plan_scenarios`.execute(db);
  await sql`DROP TABLE IF EXISTS plan_goals`.execute(db);
  await sql`DROP TABLE IF EXISTS plan_events`.execute(db);
  await sql`DROP TABLE IF EXISTS plan_budget_lines`.execute(db);
  await sql`DROP TABLE IF EXISTS plan_items`.execute(db);
  await sql`DROP TABLE IF EXISTS plan_snapshots`.execute(db);
  await sql`ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_confirmed_without_extracted`.execute(
    db,
  );
}
