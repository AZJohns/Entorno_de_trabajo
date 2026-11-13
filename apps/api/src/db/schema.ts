/**
 * Tipos de las tablas para Kysely, escritos a mano (docs/adr/0006: con pocas tablas, kysely-codegen
 * añadiría una dependencia y una base de datos en el paso de generación). Los tests de integración,
 * que usan la base de datos real, detectan cualquier desajuste con las migraciones.
 */
import type { ColumnType, Generated } from 'kysely';

/** Columna con valor por defecto en la base de datos: opcional al insertar. */
type Defaulted<T> = ColumnType<T, T | undefined, T>;

export interface UsersTable {
  id: Generated<string>;
  username: string;
  password_hash: string;
  timezone: Defaulted<string>;
  disabled_at: Date | null;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: Buffer;
  stage: 'mfa_pending' | 'full';
  failed_attempts: Defaulted<number>;
  created_at: Defaulted<Date>;
  last_seen_at: Defaulted<Date>;
  expires_at: Date;
  reauthenticated_at: Date | null;
  revoked_at: Date | null;
  user_agent: string | null;
}

export interface TotpAuthenticatorsTable {
  id: Generated<string>;
  user_id: string;
  secret_ciphertext: Buffer;
  secret_nonce: Buffer;
  key_version: number;
  // Algoritmo HMAC con el que se calculan los códigos de esta semilla (CHECK en la base de datos).
  algorithm: 'SHA1' | 'SHA256';
  // bigint de PostgreSQL: pg lo devuelve como cadena; se convierte en el repositorio.
  last_used_step: ColumnType<string | null, number | null, number | null>;
  confirmed_at: Date | null;
  created_at: Defaulted<Date>;
}

export interface RecoveryCodesTable {
  id: Generated<string>;
  user_id: string;
  code_hash: string;
  used_at: Date | null;
  created_at: Defaulted<Date>;
}

export interface AuditEventsTable {
  id: Generated<string>;
  occurred_at: Defaulted<Date>;
  actor: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip: string | null;
  metadata: Defaulted<Record<string, unknown>>;
}

/**
 * Importe en céntimos (`bigint` de PostgreSQL): `pg` lo devuelve como cadena, para no perder precisión,
 * y se acepta un número al insertar. Se convierte con `centsFromDb` (src/db/cents.ts), nunca con `Number`.
 */
type CentsColumn = ColumnType<string, number, number>;

/**
 * Fecha contable (`date`) como `YYYY-MM-DD`. `createDatabase` configura `pg` para no convertirla en un
 * `Date` a medianoche de la zona local, que cambiaría de día según la zona del servidor.
 */
type DateColumn = ColumnType<string, string, string>;

export interface AccountsTable {
  id: Generated<string>;
  name: string;
  type: 'checking' | 'savings' | 'cash';
  currency: Defaulted<'EUR'>;
  opening_balance_cents: ColumnType<string, number | undefined, number>;
  opening_date: DateColumn;
  archived_at: Defaulted<Date | null>;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
}

export interface CategoriesTable {
  id: Generated<string>;
  name: string;
  kind: 'income' | 'expense';
  archived_at: Defaulted<Date | null>;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
}

export interface AccountReconciliationsTable {
  id: Generated<string>;
  account_id: string;
  month: DateColumn;
  as_of: DateColumn;
  statement_balance_cents: CentsColumn;
  computed_balance_cents: CentsColumn;
  note: string | null;
  created_at: Defaulted<Date>;
}

/** Incidencias que impiden confirmar un movimiento (plan §2.3). */
export type MovementFlag =
  | 'amount_missing'
  | 'amount_unparsed'
  | 'merchant_missing'
  | 'unknown_card'
  | 'possible_duplicate'
  | 'foreign_currency';

export interface MovementsTable {
  id: Generated<string>;
  kind: 'income' | 'expense';
  amount_cents: CentsColumn;
  description: string | null;
  merchant: string | null;
  account_id: string | null;
  category_id: string | null;
  booked_on: DateColumn;
  source: 'manual' | 'reconciliation';
  reconciliation_id: string | null;
  status: 'pending' | 'confirmed';
  flags: Defaulted<MovementFlag[]>;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
  confirmed_at: Date | null;
}

export interface TransfersTable {
  id: Generated<string>;
  from_account_id: string;
  to_account_id: string;
  amount_cents: CentsColumn;
  booked_on: DateColumn;
  note: string | null;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
}

export interface CategoryBudgetsTable {
  id: Generated<string>;
  /** Primer día del mes presupuestado (`YYYY-MM-01`). */
  month: DateColumn;
  category_id: string;
  /** Constante `'expense'`: solo existe para la clave ajena compuesta con `categories`. */
  kind: Defaulted<'expense'>;
  amount_cents: CentsColumn;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
}

/** Fecha contable opcional (`date` NULL): mismo formato que `DateColumn`. */
type NullableDateColumn = ColumnType<string | null, string | null | undefined, string | null>;

export interface TasksTable {
  id: Generated<string>;
  title: string;
  description_md: string | null;
  status: 'todo' | 'in_progress' | 'testing' | 'done';
  position: number;
  /** Fecha límite: un día del calendario, sin hora ni zona. */
  due_on: NullableDateColumn;
  completed_at: Date | null;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
}

export interface TaskTimeEntriesTable {
  id: Generated<string>;
  task_id: string;
  started_at: Date;
  /** `NULL` mientras el cronómetro está en marcha. */
  ended_at: Date | null;
  created_at: Defaulted<Date>;
}

export interface TaskRemindersTable {
  id: Generated<string>;
  task_id: string;
  remind_at: Date;
  /** `NULL` mientras el aviso está pendiente. */
  sent_at: Date | null;
  attempts: Defaulted<number>;
  last_error: string | null;
  created_at: Defaulted<Date>;
}

export interface NotificationsTable {
  id: Generated<string>;
  kind: string;
  /** Origen de la notificación (p. ej. el recordatorio). Sin clave ajena: es de otro módulo. */
  reference_id: string | null;
  title: string;
  body: Defaulted<string>;
  created_at: Defaulted<Date>;
  read_at: Date | null;
}

export interface NotesTable {
  id: Generated<string>;
  title: string;
  body_md: Defaulted<string>;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
  /** Columna generada por PostgreSQL (título y cuerpo, `es_unaccent`): no se inserta ni se actualiza. */
  search_vector: ColumnType<string, never, never>;
}

export interface TagsTable {
  id: Generated<string>;
  /** Con la grafía con la que se creó; la unicidad no distingue mayúsculas (índice sobre `lower(name)`). */
  name: string;
  created_at: Defaulted<Date>;
}

export interface NoteTagsTable {
  note_id: string;
  tag_id: string;
}

/** Esquema completo de la base de datos. */
/**
 * Lote de importación del Excel del plan (migración 0009). `extracted`, `issues` y `decisions` son
 * `jsonb`: se insertan como texto JSON (`pg` convertiría un array en un array de PostgreSQL) y se leen
 * ya como objetos; el repositorio los valida con los esquemas compartidos.
 */
export interface ImportBatchesTable {
  id: Generated<string>;
  kind: 'plan_excel';
  /** Primer día del mes 1 del plan (`YYYY-MM-01`). */
  month: DateColumn;
  file_name: string;
  file_size_bytes: number;
  file_sha256: Buffer;
  content_hash: Buffer | null;
  template_version: number | null;
  status: 'preview' | 'confirmed' | 'discarded' | 'failed' | 'expired';
  extracted: ColumnType<unknown, string | null, string | null>;
  issues: ColumnType<unknown, string | undefined, string>;
  decisions: ColumnType<unknown, string | undefined, string>;
  created_at: Defaulted<Date>;
  expires_at: Date;
  confirmed_at: Date | null;
}

/** Importe en céntimos opcional (`bigint` NULL): `pg` lo devuelve como cadena. */
type NullableCentsColumn = ColumnType<string | null, number | null | undefined, number | null>;

/** Fecha opcional de la capa del plan (`date` NULL), como `YYYY-MM-DD`. */
type PlanNullableDate = ColumnType<string | null, string | null | undefined, string | null>;

/** Foto del plan de un mes (migración 0010). Solo una `active` por mes. */
export interface PlanSnapshotsTable {
  id: Generated<string>;
  month: DateColumn;
  import_batch_id: string;
  content_hash: Buffer;
  template_version: number;
  status: 'active' | 'superseded';
  created_at: Defaulted<Date>;
  superseded_at: Date | null;
}

/** Fila de «Datos y supuestos» (migración 0010). */
export interface PlanItemsTable {
  id: Generated<string>;
  snapshot_id: string;
  source_row: number;
  record_type: string;
  group_label: string;
  concept: string;
  unit: string;
  amount_cents: NullableCentsColumn;
  quantity_hundredths: number | null;
  nature: string;
  status: string;
  source_note: string | null;
  note: string | null;
}

/** Línea de «Presupuesto»: importe y estado se leen de `plan_items`. */
export interface PlanBudgetLinesTable {
  id: Generated<string>;
  snapshot_id: string;
  source_row: number;
  category_id: string;
  /** Constante `'expense'`: solo existe para la clave ajena compuesta con `categories`. */
  kind: Defaulted<'expense'>;
  category_label: string;
  concept: string;
  cost_type: string;
  essential: boolean;
  plan_item_id: string;
}

/** Fila de «Eventos y compromisos». */
export interface PlanEventsTable {
  id: Generated<string>;
  snapshot_id: string;
  source_row: number;
  concept: string;
  note: string | null;
  nature_label: string | null;
  amount_item_id: string | null;
  multiplier_item_id: string | null;
  amount_cents: NullableCentsColumn;
  status: string;
  expected_date: PlanNullableDate;
  include_in_projection: boolean;
}

/** Fila de «Metas». */
export interface PlanGoalsTable {
  id: Generated<string>;
  snapshot_id: string;
  source_row: number;
  name: string;
  criterion: string | null;
  goal_kind: string;
  target_item_id: string | null;
  target_cents: NullableCentsColumn;
  current_item_id: string | null;
  current_cents: NullableCentsColumn;
  contribution_item_id: string | null;
  contribution_cents: NullableCentsColumn;
}

export interface PlanScenariosTable {
  id: Generated<string>;
  snapshot_id: string;
  source_row: number;
  name: string;
}

export interface PlanScenarioItemsTable {
  scenario_id: string;
  snapshot_id: string;
  plan_item_id: string;
  role: 'extra_monthly' | 'one_off';
}

/** Correspondencia persistente: nombre de categoría de Presupuesto normalizado → categoría de gasto. */
export interface PlanCategoryMappingsTable {
  source_name_normalized: string;
  category_id: string;
  kind: Defaulted<'expense'>;
  created_at: Defaulted<Date>;
  updated_at: Defaulted<Date>;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  totp_authenticators: TotpAuthenticatorsTable;
  recovery_codes: RecoveryCodesTable;
  audit_events: AuditEventsTable;
  accounts: AccountsTable;
  categories: CategoriesTable;
  account_reconciliations: AccountReconciliationsTable;
  movements: MovementsTable;
  transfers: TransfersTable;
  category_budgets: CategoryBudgetsTable;
  tasks: TasksTable;
  task_time_entries: TaskTimeEntriesTable;
  task_reminders: TaskRemindersTable;
  notifications: NotificationsTable;
  notes: NotesTable;
  tags: TagsTable;
  note_tags: NoteTagsTable;
  import_batches: ImportBatchesTable;
  plan_snapshots: PlanSnapshotsTable;
  plan_items: PlanItemsTable;
  plan_budget_lines: PlanBudgetLinesTable;
  plan_events: PlanEventsTable;
  plan_goals: PlanGoalsTable;
  plan_scenarios: PlanScenariosTable;
  plan_scenario_items: PlanScenarioItemsTable;
  plan_category_mappings: PlanCategoryMappingsTable;
}
