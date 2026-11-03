/**
 * Libro real: cuentas, categorías, conciliaciones, movimientos y transferencias
 * (docs/plan.md §2.3, fase 1b).
 *
 * Diferencias con el plan, todas porque `wallet_cards` y `device_tokens` son de la fase 2 y todavía no
 * existen (una FK a una tabla inexistente no se puede crear):
 * - `movements` no tiene `wallet_card_id`, `device_token_id`, `idempotency_key` ni `raw_payload`, y
 *   `source` solo admite `manual` y `reconciliation`. La migración de la fase 2 añadirá las columnas, el
 *   valor `shortcut` y los CHECK que dependen de ellas.
 *
 * Añadidos respecto al plan (reglas de negocio que también se imponen en la base de datos):
 * - FK compuesta `(reconciliation_id, account_id)`: un ajuste solo puede pertenecer a la cuenta que se
 *   concilió.
 * - `month` se valida con `EXTRACT(DAY …) = 1` en lugar de `date_trunc`, que compara un `date` con un
 *   `timestamptz` y depende de la zona horaria de la sesión.
 * - Longitudes máximas de los textos libres.
 *
 * Los importes son `bigint` en céntimos y siempre positivos en `movements` y `transfers`: el signo lo
 * determina `kind` (o el sentido de la transferencia). No se guarda ningún saldo ni total.
 */
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
      type text NOT NULL CHECK (type IN ('checking', 'savings', 'cash')),
      -- Una sola moneda en el MVP; admitir otras será una decisión explícita con su migración.
      currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
      -- Puede ser negativo (descubierto).
      opening_balance_cents bigint NOT NULL DEFAULT 0,
      -- El servicio rechaza movimientos anteriores a esta fecha.
      opening_date date NOT NULL,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  // Parcial: el nombre de una cuenta archivada se puede reutilizar.
  await sql`
    CREATE UNIQUE INDEX accounts_active_name_key
      ON accounts (lower(name)) WHERE archived_at IS NULL
  `.execute(db);

  await sql`
    CREATE TABLE categories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
      kind text NOT NULL CHECK (kind IN ('income', 'expense')),
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      -- Existe solo para la clave ajena compuesta de movements: la base de datos impide asignar una
      -- categoría de ingreso a un gasto.
      CONSTRAINT categories_id_kind_key UNIQUE (id, kind)
    )
  `.execute(db);
  // No es parcial: el nombre de una categoría archivada sigue reservado, para no duplicarla al importar.
  await sql`CREATE UNIQUE INDEX categories_kind_name_key ON categories (kind, lower(name))`.execute(
    db,
  );

  await sql`
    CREATE TABLE account_reconciliations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      -- CASCADE: las conciliaciones no tienen sentido sin su cuenta (que en la práctica se archiva).
      account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
      -- Primer día del mes conciliado.
      month date NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
      -- Fecha del saldo que muestra el banco; dentro de month.
      as_of date NOT NULL,
      statement_balance_cents bigint NOT NULL,
      -- Registro histórico de lo que la app calculó al conciliar (antes del ajuste), no una caché: es la
      -- excepción documentada a «no guardar derivados» (plan §2.3).
      computed_balance_cents bigint NOT NULL,
      note text CHECK (char_length(note) <= 500),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT account_reconciliations_as_of_in_month
        CHECK (as_of >= month AND as_of < month + interval '1 month'),
      -- Una conciliación por cuenta y mes.
      CONSTRAINT account_reconciliations_account_month_key UNIQUE (account_id, month),
      -- Para la clave ajena compuesta de movements.
      CONSTRAINT account_reconciliations_id_account_key UNIQUE (id, account_id)
    )
  `.execute(db);

  await sql`
    CREATE TABLE movements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL CHECK (kind IN ('income', 'expense')),
      -- Siempre positivo: el signo lo determina kind. Solo puede ser 0 mientras está pendiente.
      amount_cents bigint NOT NULL CHECK (amount_cents >= 0),
      description text CHECK (char_length(description) <= 500),
      merchant text CHECK (char_length(merchant) <= 200),
      account_id uuid REFERENCES accounts (id) ON DELETE RESTRICT,
      category_id uuid,
      booked_on date NOT NULL,
      source text NOT NULL CHECK (source IN ('manual', 'reconciliation')),
      -- Solo en los ajustes de conciliación. Borrar la conciliación borra el ajuste.
      reconciliation_id uuid UNIQUE,
      status text NOT NULL CHECK (status IN ('pending', 'confirmed')),
      flags text[] NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      confirmed_at timestamptz,
      -- «Compuesta» a propósito: (category_id, kind) debe existir en categories(id, kind).
      CONSTRAINT movements_category_kind_fkey FOREIGN KEY (category_id, kind)
        REFERENCES categories (id, kind) ON DELETE RESTRICT,
      CONSTRAINT movements_reconciliation_fkey FOREIGN KEY (reconciliation_id, account_id)
        REFERENCES account_reconciliations (id, account_id) ON DELETE CASCADE,
      CONSTRAINT movements_flags_known CHECK (
        flags <@ ARRAY['amount_missing', 'amount_unparsed', 'merchant_missing', 'unknown_card',
                       'possible_duplicate', 'foreign_currency']::text[]
      ),
      -- Un movimiento confirmado siempre está completo y sin incidencias pendientes. Los ajustes de
      -- conciliación no llevan categoría: aparecen en una línea propia.
      CONSTRAINT movements_confirmed_is_complete CHECK (
        status = 'pending'
        OR (amount_cents > 0 AND account_id IS NOT NULL
            AND (category_id IS NOT NULL OR source = 'reconciliation')
            AND flags = '{}')
      ),
      CONSTRAINT movements_reconciliation_source CHECK (
        (source = 'reconciliation') = (reconciliation_id IS NOT NULL)
      ),
      CONSTRAINT movements_reconciliation_is_confirmed CHECK (
        source <> 'reconciliation' OR status = 'confirmed'
      ),
      CONSTRAINT movements_confirmed_at CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))
    )
  `.execute(db);
  await sql`CREATE INDEX movements_booked_on_idx ON movements (booked_on)`.execute(db);
  await sql`CREATE INDEX movements_account_booked_on_idx ON movements (account_id, booked_on)`.execute(
    db,
  );
  await sql`CREATE INDEX movements_category_booked_on_idx ON movements (category_id, booked_on)`.execute(
    db,
  );
  // Bandeja de pendientes.
  await sql`CREATE INDEX movements_pending_idx ON movements (created_at) WHERE status = 'pending'`.execute(
    db,
  );

  // Tabla aparte (y no dos movimientos enlazados) para que una transferencia no pueda contar como
  // gasto por accidente: ninguna consulta de ingresos o gastos la toca; solo el cálculo de saldos.
  await sql`
    CREATE TABLE transfers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      from_account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
      to_account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
      amount_cents bigint NOT NULL CHECK (amount_cents > 0),
      booked_on date NOT NULL,
      note text CHECK (char_length(note) <= 500),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT transfers_distinct_accounts CHECK (from_account_id <> to_account_id)
    )
  `.execute(db);
  await sql`CREATE INDEX transfers_from_booked_on_idx ON transfers (from_account_id, booked_on)`.execute(
    db,
  );
  await sql`CREATE INDEX transfers_to_booked_on_idx ON transfers (to_account_id, booked_on)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS transfers`.execute(db);
  await sql`DROP TABLE IF EXISTS movements`.execute(db);
  await sql`DROP TABLE IF EXISTS account_reconciliations`.execute(db);
  await sql`DROP TABLE IF EXISTS categories`.execute(db);
  await sql`DROP TABLE IF EXISTS accounts`.execute(db);
}
