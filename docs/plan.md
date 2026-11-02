# Plan del backoffice personal

- **Estado:** borrador v1 (diseño; todavía no hay código)
- **Fecha:** 2026-11-02
- **Documentos relacionados:** [`docs/plantilla-excel.md`](plantilla-excel.md) (contrato del importador) y [`CLAUDE.md`](../CLAUDE.md) (reglas de trabajo)

**Marcas usadas en este documento**
- **[VERIFICAR]**: dato que no he podido comprobar o que cambia con el tiempo (versiones, precios, comportamiento de iOS). Hay que confirmarlo antes de decidir nada que dependa de él.
- **[DECIDIR]**: decisión que te corresponde a ti. Todas están reunidas en §9, con una opción recomendada.
- **Hecho / inferencia / opinión**: cuando la diferencia importa, lo indico de forma explícita.

---

## 0. Resumen y correcciones a las premisas

**Decisiones principales del plan**
1. Un único despliegue: Express sirve la SPA compilada y la API `/api/v1` desde el **mismo origen**. Así no hace falta CORS y las cookies `SameSite` funcionan sin trucos.
2. Base de datos como fuente de verdad: las restricciones (`CHECK`, claves ajenas compuestas, índices parciales) protegen las reglas de negocio aunque el código tenga errores. No se guarda ningún dato derivado (saldos, totales, proyecciones), salvo el índice de búsqueda.
3. La lógica financiera son **funciones puras** con importes en céntimos enteros. Se prueba sin base de datos.
4. Acceso a datos con **Kysely** (constructor de consultas tipado) y migraciones SQL versionadas. Sin ORM (§4.2).
5. Importación del Excel con **vista previa y confirmación**, idempotente por hash del contenido.

**Premisas del enunciado que conviene corregir o matizar**

| # | Premisa | Corrección |
|---|---|---|
| 1 | «Hace falta HTTPS público para el atajo y las notificaciones» | **Solo es cierto en parte.** El atajo sí necesita llegar al servidor. Las notificaciones push **no**: el servidor solo hace conexiones salientes al servicio de push de Apple. La PWA y el *service worker* necesitan HTTPS con un certificado válido, no necesariamente público. Existe una alternativa sin exposición pública (§7.2, opción D) |
| 2 | «Deduplicar envíos repetidos con una clave de idempotencia» | Una clave generada **dentro** del atajo no evita los duplicados cuando iOS ejecuta la automatización dos veces, porque cada ejecución genera una clave distinta. Hacen falta dos mecanismos: la clave, para los reintentos, y una **huella** (tarjeta + importe + comercio + ventana de tiempo) que marque «posible duplicado» sin rechazarlo (§5.5) |
| 3 | Clasificar las filas de «Datos y supuestos» | Recomiendo **añadir la columna «Tipo de registro»** en lugar de inferirla. Es más fiable y más sencillo de mantener (§3.3) |
| 4 | Las comprobaciones (Checks) de la plantilla | En la app, la mitad de ellas **no pueden fallar por construcción** (p. ej., «gasto total = suma de líneas»). Se convierten en invariantes probados por tests, no en comprobaciones visibles para el usuario (`plantilla-excel.md` §9.6) |
| 5 | «Tests de conciliación» | La conciliación no está definida en el enunciado. Propongo una definición mínima (§2.3, `account_reconciliations`) y la dejo como pregunta abierta |
| 6 | Movimientos con origen «importación» | El Excel es **plan**, no movimientos reales. No hay ninguna fuente de importación de movimientos reales definida (¿extractos bancarios?). Se deja el valor en el modelo, pero no se implementa nada [DECIDIR] |
| 7 | `.xlsm` sin macros | Si no hay macros, guardar como `.xlsx` simplifica la validación del tipo de archivo y elimina una ambigüedad [DECIDIR] |
| 8 | «Al tocar la notificación se abre la bandeja de pendientes» | En iOS hay errores documentados en los que `clients.openWindow(url)` abre la raíz de la app en vez de la URL indicada. Según un comentario de WebKit, ya no se reproduce en iOS 26 [VERIFICAR]. El diseño no depende de ello: la pantalla de inicio muestra los pendientes (§5.7) |
| 9 | Tareas programadas (recordatorios) | Exigen un proceso **siempre encendido**. Eso descarta los planes gratuitos que «duermen» (§7) |

---

## 1. (a) Arquitectura y estructura de carpetas

### 1.1 Vista general

```
 iPhone                                   Servidor (un solo host)
 ┌──────────────────────┐   HTTPS   ┌─────────────────────────────────────────┐
 │ PWA instalada        │──────────▶│ Caddy (TLS automático, proxy inverso)   │
 │  · cookie de sesión  │           │   │                                     │
 │  · service worker    │           │   ▼                                     │
 │ Atajo «Transacción»  │──────────▶│ Express 5 (Node LTS)                    │
 │  · token de          │  Bearer   │  ├─ /            → SPA estática (Vite)  │
 │    dispositivo       │           │  ├─ /api/v1/...  → módulos              │
 └──────────▲───────────┘           │  └─ planificador (bucle de 60 s)        │
            │                       │   │                                     │
            │ push cifrado          │   ▼                                     │
   ┌────────┴────────────┐ saliente │ PostgreSQL (red interna, sin exponer)   │
   │ Servicio de push de │◀─────────│                                         │
   │ Apple               │          └───────────────┬─────────────────────────┘
   └─────────────────────┘                          │ pg_dump cifrado (cron del host)
                                                    ▼
                                         Almacenamiento externo (copias)
```

### 1.2 Decisiones estructurales

| Decisión | Motivo |
|---|---|
| **Mismo origen** para la SPA y la API | No hace falta CORS; la cookie puede ser `SameSite=Lax` con el prefijo `__Host-`; un solo despliegue |
| **Monolito modular**: `auth`, `finance`, `imports`, `tasks`, `notes`, `notifications` | Un único proceso y una única base de datos, pero con fronteras explícitas. Si algún día hiciera falta, un módulo se podría extraer sin reescribir |
| **Capas** rutas → controlador → servicio → repositorio | Cada capa tiene una responsabilidad (tabla §1.3) y los servicios se prueban sin HTTP |
| **API pública de cada módulo** en `modules/<m>/index.ts` | Otro módulo solo puede importar desde ese archivo. Se impone con la regla `no-restricted-imports` de ESLint, que no añade dependencias. Una convención que no se comprueba acaba incumpliéndose |
| **Composición manual** (`container.ts`): se crean los repositorios, después los servicios y después los controladores | Inyección de dependencias sin un framework: se puede explicar línea a línea y permite usar dobles de prueba en los tests |
| **Dominio puro** (`domain/`) dentro de cada módulo | Los cálculos financieros no hacen E/S. Se prueban con tablas de casos |
| **Errores** con una clase `AppError` y un único middleware | Formato único [RFC 9457 *Problem Details*](https://www.rfc-editor.org/rfc/rfc9457) (`application/problem+json`). Express 5 ya pasa al gestor de errores las promesas rechazadas |
| **Validación** con esquemas Zod en `packages/shared` | Un único esquema valida el formulario en el navegador y la petición en el servidor. La configuración (variables de entorno) también se valida al arrancar |
| **Fechas** | Fechas contables como `date`; instantes como `timestamptz`; zona `Europe/Madrid` para decidir a qué mes pertenece algo y para los recordatorios |
| **API versionada** `/api/v1` | Con un único cliente web aportaría poco. El **atajo** es un segundo cliente que no se actualiza a la vez que la web; por eso sí tiene sentido |

### 1.3 Responsabilidades de cada capa

| Capa | Hace | No hace |
|---|---|---|
| Rutas | Declarar el método, la ruta y los middlewares (autenticación, CSRF, límite de peticiones) | Lógica |
| Controlador | Validar la entrada con el esquema compartido, llamar al servicio y dar forma a la respuesta | SQL ni reglas de negocio |
| Servicio | Reglas de negocio, transacciones y llamadas a servicios de otros módulos | Conocer `req` o `res` |
| Repositorio | Consultas con Kysely; devuelve objetos tipados | Decisiones de negocio |
| Dominio | Funciones puras (cálculos, clasificación, conversión de importes) | Ningún tipo de E/S |

### 1.4 Dependencias permitidas entre módulos (sin ciclos)

```
imports ──▶ finance ──▶ notifications ◀── tasks
                                          notes (independiente)
auth: lo usan todos a través de su middleware; él no depende de nadie.
jobs (infraestructura) ──▶ tasks, notifications, imports, auth (limpiezas y recordatorios)
```

- Se permiten **claves ajenas entre tablas de módulos distintos**, porque protegen la integridad de los datos. Lo que no se permite es que un módulo **acceda** a las tablas de otro: solo puede llamar a su servicio.

### 1.5 Estructura de carpetas

```
.
├── CLAUDE.md
├── README.md                       # qué es, cómo arrancarlo y enlaces a docs/
├── docs/
│   ├── plan.md                     # este documento
│   ├── plantilla-excel.md          # contrato del importador
│   ├── dependencias.md             # registro de dependencias (§4.3)
│   ├── atajo-iphone.md             # configuración paso a paso del atajo (fase 2)
│   ├── adr/                        # 0001-monorepo-pnpm.md, 0002-express.md, …
│   └── runbooks/                   # despliegue, copia y restauración, rotación de secretos
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts              # crea la app de Express sin listen (se puede probar)
│   │   │   ├── server.ts           # listen + arranque del planificador
│   │   │   ├── container.ts        # composición de dependencias
│   │   │   ├── config/             # variables de entorno validadas con Zod
│   │   │   ├── db/                 # instancia de Kysely, migrations/, tipos generados
│   │   │   ├── http/               # middlewares: sesión, CSRF, errores, requestId, rate limit
│   │   │   ├── jobs/               # planificador y tareas periódicas
│   │   │   └── modules/
│   │   │       ├── auth/           # README.md, index.ts, *.routes|controller|service|repository.ts, __tests__/
│   │   │       ├── finance/
│   │   │       │   ├── ledger/     # cuentas, categorías, movimientos, transferencias, informes, ingesta
│   │   │       │   └── plan/       # fotos del plan y domain/ con los cálculos
│   │   │       ├── imports/        # lectura, validación, vista previa y confirmación del Excel
│   │   │       ├── notifications/
│   │   │       ├── tasks/
│   │   │       └── notes/
│   │   ├── scripts/                # create-user, rotate-vapid…
│   │   └── test/                   # fixtures FICTICIAS y utilidades de test
│   └── web/
│       ├── public/                 # iconos y manifiesto
│       └── src/
│           ├── app/                # router, proveedores, layout
│           ├── features/           # auth, finance, plan, inbox, tasks, notes, settings
│           ├── components/         # componentes de interfaz genéricos
│           ├── lib/                # cliente de la API, formato de importes y fechas
│           └── sw/                 # service worker (push, notificationclick)
├── packages/
│   └── shared/src/                 # schemas/ (Zod por módulo), money/, errors/ (códigos)
├── compose.yaml                    # PostgreSQL local
├── deploy/                         # compose.prod.yaml, Caddyfile (sin secretos)
└── .github/workflows/ci.yml
```

---

## 2. (b) Modelo de datos y endpoints

### 2.1 Convenciones

- Tablas y columnas en `snake_case` e inglés. En la API, `camelCase` (con `CamelCasePlugin` de Kysely).
- Clave primaria `id uuid DEFAULT gen_random_uuid()`. Con PostgreSQL 18 se puede usar `uuidv7()`, que mejora la localidad del índice [VERIFICAR la versión que ofrezca el host]. Motivos para usar UUID: los identificadores no se pueden adivinar ni revelan cuántos registros hay, y se pueden generar en el cliente si algún día hay modo sin conexión.
- **Importes:** `bigint` con el sufijo `_cents`. En JavaScript se manejan como `number` comprobando `Number.isSafeInteger` (el máximo seguro equivale a unos 90 billones de euros). El driver `pg` devuelve `bigint` y `SUM()` como cadena de texto: se convierten en un único sitio, con esa comprobación.
- **Enumeraciones** como `text` con un `CHECK (… IN (…))`, en lugar del tipo `ENUM` de PostgreSQL. Motivo: a un `ENUM` no se le puede quitar un valor y añadir uno tiene restricciones dentro de las transacciones. Un `CHECK` se reemplaza con una migración normal.
- Las claves ajenas declaran siempre `ON DELETE` de forma explícita. Las entidades a las que apuntan otras (cuentas, categorías) se **archivan** (`archived_at`) en lugar de borrarse.
- **No se guardan datos derivados**: saldos, totales, proyecciones y resultados de los checks se calculan al leer. Con un solo usuario y miles de filas, el coste es despreciable. Si un día no lo fuera, se añadiría una vista materializada.
- `created_at` y `updated_at` son `timestamptz NOT NULL DEFAULT now()`. `updated_at` lo actualiza el repositorio, no un *trigger*, para que el comportamiento sea visible en el código.

### 2.2 Módulo `auth`

**`users`**
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| username | text | NOT NULL; índice único sobre `lower(username)` |
| password_hash | text | NOT NULL. Formato PHC (`$argon2id$v=19$m=…,t=…,p=…$…`): guarda los parámetros, así que se pueden endurecer sin migración, recalculando el hash en el siguiente inicio de sesión |
| timezone | text | NOT NULL DEFAULT `'Europe/Madrid'` |
| created_at, updated_at | timestamptz | |

Índice único `ON users ((true))`: **garantiza en la base de datos que solo hay un usuario**. Si algún día hubiera varios, se elimina con una migración.

**`sessions`**
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK `users` ON DELETE CASCADE |
| token_hash | bytea | NOT NULL UNIQUE. SHA-256 del valor de la cookie: si se filtra la base de datos, las sesiones no se pueden usar |
| csrf_token_hash | bytea | NOT NULL |
| created_at, last_seen_at | timestamptz | |
| expires_at | timestamptz | NOT NULL (caducidad absoluta) |
| revoked_at | timestamptz | NULL |
| user_agent | text | Para listar las sesiones abiertas |

Índice en `expires_at` para la limpieza periódica.

**`device_tokens`** (tokens del atajo)
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| name | text | NOT NULL (p. ej., «iPhone – atajo») |
| token_hash | bytea | NOT NULL UNIQUE (SHA-256) |
| token_prefix | text | NOT NULL. Los primeros caracteres, para reconocerlo en la interfaz y en los logs |
| scopes | text[] | NOT NULL `CHECK (scopes <@ ARRAY['ingest:write','ingest:read-catalog'])` |
| created_at | timestamptz | |
| expires_at | timestamptz | NOT NULL `CHECK (expires_at > created_at AND expires_at <= created_at + interval '366 days')` |
| last_used_at, revoked_at | timestamptz | NULL |

**`audit_events`** (solo se añaden filas)
| Columna | Tipo | Notas |
|---|---|---|
| id | bigint identity | PK |
| occurred_at | timestamptz | índice |
| actor | text | `user`, `device:<id>` o `system` |
| action | text | `login.success`, `login.failure`, `device_token.created`, `device_token.revoked`, `plan_import.confirmed`, `password.changed`… |
| entity_type, entity_id | text, uuid | NULL |
| metadata | jsonb | Sin importes, tokens ni contraseñas |

### 2.3 Módulo `finance` — capa real (`ledger`)

**`accounts`**
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| name | text | NOT NULL; único sobre `lower(name)` `WHERE archived_at IS NULL` |
| type | text | `CHECK IN ('checking','savings','cash','credit_card','other')` |
| currency | char(3) | NOT NULL DEFAULT `'EUR'`, `CHECK (currency = 'EUR')` en el MVP. Admitir otras monedas será una decisión explícita, con su migración |
| opening_balance_cents | bigint | NOT NULL DEFAULT 0. Puede ser negativo (tarjeta de crédito) |
| opening_date | date | NOT NULL. El servicio rechaza movimientos anteriores a esta fecha |
| archived_at | timestamptz | NULL |

**`categories`**
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| name | text | NOT NULL |
| kind | text | `CHECK IN ('income','expense')` |
| archived_at | timestamptz | NULL |

`UNIQUE (kind, lower(name))` y `UNIQUE (id, kind)`. Esta segunda existe para la clave ajena compuesta de `movements`.

**`wallet_cards`** (nombre de la tarjeta en Wallet → cuenta)
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| wallet_name | text | NOT NULL UNIQUE. **Solo el nombre visible en Wallet.** `CHECK (wallet_name !~ '[0-9]{12,}')`: defensa para no guardar nunca algo con forma de número de tarjeta |
| account_id | uuid | FK `accounts` ON DELETE RESTRICT, NULL mientras no esté asignada |
| first_seen_at, last_seen_at | timestamptz | |

**`movements`** (ingresos y gastos; las transferencias van aparte)
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| kind | text | `CHECK IN ('income','expense')`. El importe siempre es positivo y el signo lo determina `kind` |
| amount_cents | bigint | NOT NULL `CHECK (amount_cents >= 0)`. Puede ser 0 solo mientras está pendiente (borrador) |
| description | text | NULL. El «concepto» |
| merchant | text | NULL. El comercio |
| account_id | uuid | FK `accounts` ON DELETE RESTRICT, NULL solo si está pendiente |
| category_id | uuid | NULL. FK compuesta `(category_id, kind) → categories(id, kind)`: **la base de datos impide asignar una categoría de ingreso a un gasto** |
| booked_on | date | NOT NULL. Fecha contable |
| source | text | `CHECK IN ('manual','shortcut','import')` |
| status | text | `CHECK IN ('pending','confirmed')` |
| flags | text[] | NOT NULL DEFAULT `'{}'`. `CHECK (flags <@ ARRAY['amount_missing','amount_unparsed','merchant_missing','unknown_card','possible_duplicate','foreign_currency'])` |
| wallet_card_id | uuid | FK `wallet_cards`, NULL |
| device_token_id | uuid | FK `device_tokens` ON DELETE RESTRICT, NULL. Los tokens se revocan, no se borran |
| idempotency_key | text | NULL, longitud ≤ 128 |
| raw_payload | jsonb | NULL. Lo que envió el atajo, para diagnosticar problemas de formato. **Se borra al confirmar** (minimización de datos) |
| created_at, updated_at, confirmed_at | timestamptz | |

Restricciones de tabla:
- `CHECK (status = 'pending' OR (amount_cents > 0 AND account_id IS NOT NULL AND category_id IS NOT NULL AND flags = '{}'))`: un movimiento confirmado siempre está completo y sin incidencias pendientes.
- `CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL))`
- `CHECK (source <> 'shortcut' OR (device_token_id IS NOT NULL AND idempotency_key IS NOT NULL))`
- Índice único parcial `(device_token_id, idempotency_key) WHERE idempotency_key IS NOT NULL`.

Índices: `(booked_on)`, `(account_id, booked_on)`, `(category_id, booked_on)`, `(created_at) WHERE status = 'pending'` (bandeja de pendientes) y `(wallet_card_id, created_at)` (detección de duplicados).

**`transfers`**
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| from_account_id, to_account_id | uuid | FK `accounts` ON DELETE RESTRICT; `CHECK (from_account_id <> to_account_id)` |
| amount_cents | bigint | `CHECK (amount_cents > 0)` |
| booked_on | date | NOT NULL |
| note | text | NULL |

Índices: `(from_account_id, booked_on)` y `(to_account_id, booked_on)`.
**Por qué una tabla aparte** y no dos movimientos enlazados: así una transferencia **no puede** contar como gasto por accidente. Ninguna consulta de ingresos o gastos toca esta tabla; solo la usa el cálculo de saldos. La alternativa obliga a que todas las consultas recuerden filtrar las transferencias.

**`account_reconciliations`** (definición propuesta de «conciliación» [DECIDIR])
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| account_id | uuid | FK `accounts` ON DELETE CASCADE |
| as_of | date | `UNIQUE (account_id, as_of)` |
| statement_balance_cents | bigint | El saldo que muestra el banco en esa fecha |
| note | text | |

La diferencia `saldo del banco − saldo calculado` se calcula al leer. Saldo calculado = `opening_balance + Σ ingresos confirmados − Σ gastos confirmados + Σ transferencias recibidas − Σ transferencias enviadas`, contando hasta `as_of` incluido.

### 2.4 Módulo `finance` — capa de plan (`plan`)

Solo guarda **entradas** de la plantilla. No hay columnas de totales, proyecciones ni resultados de los checks.

**`plan_snapshots`** (foto del plan de un mes)
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| month | date | `CHECK (month = date_trunc('month', month))` |
| import_batch_id | uuid | FK `import_batches`, NOT NULL UNIQUE |
| content_hash | bytea | NOT NULL |
| template_version | smallint | NOT NULL |
| status | text | `CHECK IN ('active','superseded')` |
| created_at, superseded_at | timestamptz | |

`UNIQUE (month) WHERE status = 'active'` (una única foto vigente por mes) y `UNIQUE (month, content_hash)`.

**`plan_items`** (filas de «Datos y supuestos»)
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK; además `UNIQUE (snapshot_id, id)` para las claves ajenas compuestas |
| snapshot_id | uuid | FK ON DELETE CASCADE |
| source_row | integer | `CHECK (source_row >= 6)`; `UNIQUE (snapshot_id, source_row)` |
| record_type | text | `CHECK IN ('income','expense','savings_balance','assumption','goal','scenario','historical','one_off_payment')` |
| group_label, concept | text | `concept` NOT NULL |
| unit | text | `CHECK IN ('eur_per_month','eur','months')` |
| amount_cents | bigint | NULL |
| quantity | numeric(8,2) | NULL |
| nature | text | CHECK con los 11 valores de la plantilla |
| status | text | CHECK con los 10 valores de la plantilla |
| source_note, note | text | NULL |

`CHECK ((unit IN ('eur_per_month','eur') AND amount_cents IS NOT NULL AND quantity IS NULL) OR (unit = 'months' AND quantity IS NOT NULL AND amount_cents IS NULL))`.

**`plan_budget_lines`** (filas de «Presupuesto»)
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id, snapshot_id, source_row | | igual que arriba |
| category_id | uuid | FK `categories` NOT NULL. El servicio comprueba que la categoría sea de gasto |
| category_label, concept | text | El texto original, solo para mostrarlo |
| cost_type | text | `CHECK IN ('fixed','variable','irregular')` |
| essential | boolean | NOT NULL |
| plan_item_id | uuid | NOT NULL. FK compuesta `(snapshot_id, plan_item_id) → plan_items(snapshot_id, id)`: **la línea solo puede apuntar a una fila de la misma foto** |

El importe y el estado **no se copian**: se leen de `plan_items`.

**`plan_events`** («Eventos y compromisos»)
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id, snapshot_id, source_row, concept, nature, note | | |
| plan_item_id | uuid | NULL, con FK compuesta como arriba |
| amount_cents | bigint | NULL, ≥ 0 |
| status | text | `CHECK IN ('estimated','paid','finished','active','inactive','not_committed')` |
| expected_date | date | NULL |
| include_in_projection | boolean | NOT NULL |
| base_impact | text | `CHECK IN ('one_off','excluded','scenario','irregular','variable','goal')` |

`CHECK (num_nonnulls(plan_item_id, amount_cents) = 1)` (el importe o es una referencia o es un literal, nunca las dos cosas) y `CHECK (NOT include_in_projection OR expected_date IS NOT NULL)`.

**`plan_goals`** y **`plan_scenarios`**: la misma estructura. Cada importe de entrada se guarda como una pareja `*_item_id` / `*_cents` con `num_nonnulls(…) = 1`.
- Metas: objetivo, actual, aportación, `status CHECK IN ('completed','paused','in_progress')` y `criterion`.
- Escenarios: `name`, extra mensual y pago puntual.

**`plan_category_mappings`**
| Columna | Tipo | Notas |
|---|---|---|
| source_name_normalized | text | PK |
| category_id | uuid | FK `categories` |

### 2.5 Módulo `imports`

**`import_batches`**
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| kind | text | `CHECK IN ('plan_excel')`. Admite otros tipos en el futuro, como extractos bancarios |
| month | date | Primer día del mes |
| file_name | text | Saneado, ≤ 255. Solo se muestra |
| file_size_bytes | integer | |
| file_sha256 | bytea | Hash del archivo, para auditoría |
| content_hash | bytea | NULL. Hash **canónico del contenido extraído**, para la idempotencia (§3.6) |
| template_version | smallint | NULL |
| status | text | `CHECK IN ('preview','confirmed','discarded','failed','expired')` |
| extracted | jsonb | NULL. Entradas normalizadas mientras dura la vista previa. **Se vacía al confirmar o al caducar** |
| issues | jsonb | NOT NULL DEFAULT `'[]'` |
| decisions | jsonb | NOT NULL DEFAULT `'{}'`. Correspondencias de categorías elegidas en la vista previa |
| created_at, expires_at, confirmed_at | timestamptz | |

`UNIQUE (kind, month, content_hash) WHERE status = 'confirmed'` e índice `(status, expires_at)` para la limpieza.
**No se guarda el archivo binario** [DECIDIR]: las entradas ya quedan en las tablas del plan y así no se acumulan copias del Excel.

### 2.6 Módulo `tasks`

**`tasks`**
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| title | text | `CHECK (char_length(title) BETWEEN 1 AND 200)` |
| description_md | text | NULL |
| status | text | `CHECK IN ('todo','in_progress','testing','done')` |
| position | integer | `CHECK (position >= 0)` |
| due_on | date | NULL (fecha límite) |
| completed_at | timestamptz | `CHECK ((status = 'done') = (completed_at IS NOT NULL))` |

`UNIQUE (status, position) DEFERRABLE INITIALLY DEFERRED`: al reordenar, las posiciones se renumeran dentro de una transacción y la unicidad se comprueba al final, no fila a fila. Índice `(due_on) WHERE status <> 'done'`.

**`task_time_entries`** (tiempo dedicado)
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| task_id | uuid | FK ON DELETE CASCADE; índice |
| started_at | timestamptz | NOT NULL |
| ended_at | timestamptz | NULL mientras el cronómetro está en marcha; `CHECK (ended_at IS NULL OR ended_at > started_at)` |

Índice único `((true)) WHERE ended_at IS NULL`: solo puede haber **un cronómetro en marcha** en toda la aplicación. Sirve tanto para el cronómetro como para la anotación manual [DECIDIR cuál de las dos].

**`task_reminders`**
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| task_id | uuid | FK ON DELETE CASCADE |
| remind_at | timestamptz | NOT NULL |
| sent_at | timestamptz | NULL |
| attempts | smallint | DEFAULT 0 |
| last_error | text | NULL |

Índice parcial `(remind_at) WHERE sent_at IS NULL`.

### 2.7 Módulo `notifications`

**`push_subscriptions`**
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| endpoint | text | NOT NULL UNIQUE |
| p256dh, auth | text | NOT NULL. Claves públicas de la suscripción (no son secretos del servidor) |
| user_agent | text | |
| created_at, last_success_at | timestamptz | |
| consecutive_failures | smallint | DEFAULT 0 |
| disabled_at | timestamptz | Se rellena si el servicio de push responde 404 o 410 (suscripción caducada) |

**`notification_deliveries`** (opcional; registro de envíos para diagnosticar, con retención de 30 días): `kind`, `reference_id`, `subscription_id`, `sent_at`, `http_status`, `error`.

### 2.8 Módulo `notes`

**`notes`**
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| title | text | `CHECK (char_length(title) BETWEEN 1 AND 200)` |
| body_md | text | NOT NULL DEFAULT `''`; `CHECK (octet_length(body_md) <= 1048576)` |
| archived_at | timestamptz | NULL |
| search_vector | tsvector | `GENERATED ALWAYS AS (setweight(to_tsvector('es_unaccent', title), 'A') \|\| setweight(to_tsvector('es_unaccent', body_md), 'B')) STORED` |

- Índice GIN sobre `search_vector` e índice `(updated_at DESC)`.
- `es_unaccent` es una configuración de búsqueda copiada de `spanish` con el filtro `unaccent`, de modo que «balance» encuentra «balancé» y «presupuestos» encuentra «presupuesto». Necesita la extensión `unaccent` [VERIFICAR que el host la permita].
- Las consultas usan `websearch_to_tsquery` (sintaxis tolerante a lo que escribe el usuario), `ts_rank_cd` y `ts_headline` con marcadores propios, que el frontend renderiza como texto, nunca como HTML.

**`tags`**: `id`, `name` (`char_length` entre 1 y 40) y un índice único sobre `lower(name)`.
**`note_tags`**: `note_id` (FK CASCADE) y `tag_id` (FK CASCADE), con `PRIMARY KEY (note_id, tag_id)` e índice `(tag_id, note_id)` para filtrar por etiqueta.

### 2.9 Relaciones (resumen)

```
users 1─* sessions                         device_tokens 1─* movements
accounts 1─* movements *─1 categories      wallet_cards *─1 accounts
accounts 1─* transfers (origen y destino)  accounts 1─* account_reconciliations
import_batches 1─1 plan_snapshots 1─* plan_items
plan_snapshots 1─* plan_budget_lines *─1 plan_items   (y *─1 categories)
plan_snapshots 1─* plan_events|plan_goals|plan_scenarios *─0..1 plan_items
plan_category_mappings *─1 categories
tasks 1─* task_time_entries · tasks 1─* task_reminders
notes *─* tags (note_tags)
```

### 2.10 Endpoints REST

**Convenciones comunes**
- Base `/api/v1`. JSON en `camelCase`. Importes en céntimos enteros (`amountCents`); el formato se aplica en el frontend.
- Fechas `YYYY-MM-DD`; meses `YYYY-MM`; instantes en ISO 8601.
- Paginación por cursor (`?limit=50&cursor=…` → `{ items, nextCursor }`) en las listas que crecen (movimientos y notas).
- Errores con RFC 9457: `{ type, title, status, detail, code, errors?: [...], requestId }`.
- Códigos de estado:
  - `400` validación · `401` sin autenticar · `403` CSRF o permiso insuficiente · `404` no existe
  - `409` conflicto (p. ej., archivar una cuenta con un movimiento pendiente o confirmar una importación caducada)
  - `413` archivo demasiado grande · `415` tipo de contenido no admitido · `422` el archivo no cumple la plantilla · `429` límite de peticiones
- Columna **Auth**:
  - **P**: público.
  - **S**: cookie de sesión, más la cabecera CSRF en los métodos que modifican datos.
  - **S+**: sesión y, además, haber reintroducido la contraseña en los últimos 10 minutos.
  - **D(scope)**: token de dispositivo con ese permiso.
- **Denegar por defecto**: el router de `/api/v1` exige sesión salvo en una lista explícita de excepciones. Un test recorre todas las rutas registradas y lo comprueba.

**auth**
| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/health` | P | `{ status: "ok" }`. Sin versión ni detalles internos |
| POST | `/auth/login` | P (con límite de peticiones) | `{ username, password }` → 204 + `Set-Cookie` |
| POST | `/auth/logout` | S | Revoca la sesión actual |
| GET | `/auth/session` | S | `{ user, csrfToken, expiresAt }` |
| POST | `/auth/reauth` | S | Confirma la contraseña para las acciones sensibles |
| POST | `/auth/password` | S+ | Cambia la contraseña y revoca las demás sesiones |
| GET / DELETE | `/auth/sessions`, `/auth/sessions/:id` | S | Ver y cerrar las sesiones abiertas |
| GET | `/auth/device-tokens` | S | Lista (prefijo, uso, caducidad) |
| POST | `/auth/device-tokens` | S+ | `{ name, expiresInDays, scopes }` → 201 con el token **en claro una sola vez** |
| DELETE | `/auth/device-tokens/:id` | S | Revoca el token (no lo borra) |

**finance: capa real**
| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET, POST | `/accounts` | S | |
| GET, PATCH | `/accounts/:id` | S | |
| POST | `/accounts/:id/archive` | S | 409 si tiene movimientos pendientes |
| GET, POST | `/accounts/:id/reconciliations` | S | Devuelve `statementBalanceCents`, `computedBalanceCents` y `differenceCents` |
| GET, POST | `/categories` | S | |
| PATCH | `/categories/:id` | S | |
| POST | `/categories/:id/archive` | S | |
| GET | `/movements` | S | Filtros: `from`, `to`, `accountId`, `categoryId`, `status`, `kind`, `source`, `q`, con cursor |
| POST | `/movements` | S | Alta manual (formulario rápido) |
| GET, PATCH, DELETE | `/movements/:id` | S | |
| POST | `/movements/:id/confirm` | S | Valida que esté completo, limpia `flags` y `raw_payload` y lo pasa a confirmado |
| GET | `/movements/pending/count` | S | Para el contador del icono y el aviso en la pantalla de inicio |
| GET, POST | `/transfers` | S | |
| PATCH, DELETE | `/transfers/:id` | S | |
| GET | `/wallet-cards` | S | |
| PATCH | `/wallet-cards/:id` | S | `{ accountId }` |
| GET | `/reports/monthly?from=YYYY-MM&to=YYYY-MM` | S | Por mes: ingresos, gastos, neto y pendientes (número e importe) |
| GET | `/reports/monthly/:month/categories` | S | Desglose por categoría |
| GET | `/reports/balances?at=YYYY-MM-DD` | S | Saldo por cuenta |
| GET | `/reports/balance-history?from&to` | S | Saldo a fin de cada mes por cuenta (gráfico de líneas) |
| POST | `/ingest/wallet-transactions` | D(`ingest:write`) | Atajo de iPhone (§5.4) |
| GET | `/ingest/catalog` | D(`ingest:read-catalog`) | Categorías para la mejora opcional del atajo |

**finance: plan**
| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/plan/snapshots?from&to` | S | Historial de fotos |
| GET | `/plan/snapshots/:id` | S | Entradas de una foto |
| GET | `/plan/months/:month` | S | Foto vigente del mes (404 si no hay) |
| GET | `/plan/months/:month/budget` | S | Líneas y resumen (calculado) |
| GET | `/plan/months/:month/projection` | S | 12 meses (calculado) |
| GET | `/plan/months/:month/goals` | S | Metas con lo pendiente y los meses que faltan (calculado) |
| GET | `/plan/months/:month/scenarios` | S | Caja libre, tasa y lectura (calculado) |
| GET | `/plan/months/:month/checks` | S | Resultados y estado global (calculado) |
| GET | `/plan/months/:month/dashboard` | S | Todo lo anterior en una sola respuesta |
| GET | `/plan/months/:month/comparison` | S | Plan frente a real por categoría (§3.8) |
| GET, PUT, DELETE | `/plan/category-mappings[/:name]` | S | |

**imports**
| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/imports/plan-excel?month=YYYY-MM` | S+ | Cuerpo binario (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-excel.sheet.macroEnabled.12` u `octet-stream`). Responde 201 `{ id, status, issues, summary }`, o 200 con la importación existente si ya se confirmó ese mismo contenido |
| GET | `/imports?month=` | S | |
| GET | `/imports/:id` | S | Vista previa: filas extraídas, problemas y diferencias con la foto vigente |
| PATCH | `/imports/:id/decisions` | S | `{ categoryMappings }` → vuelve a validar |
| POST | `/imports/:id/confirm` | S | 201 `{ snapshotId }`; 200 si ya estaba confirmada; 409 si caducó o tiene errores |
| DELETE | `/imports/:id` | S | Descarta la vista previa |

El archivo se recibe con `express.raw({ type: [...], limit: '5mb' })`, **sin multipart**. Así no hace falta `multer` y el archivo nunca se escribe en disco.

**notifications**
| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/notifications/vapid-public-key` | S | |
| POST | `/notifications/subscriptions` | S | Inserta o actualiza por `endpoint` |
| DELETE | `/notifications/subscriptions/:id` | S | |
| POST | `/notifications/test` | S | Envía una notificación de prueba |
| GET, PUT | `/notifications/preferences` | S | P. ej., mostrar u ocultar los importes en la pantalla de bloqueo |

**tasks**
| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/tasks?status=` | S | Ordenadas por `position` |
| POST | `/tasks` | S | Se añade al final de la columna |
| GET, PATCH, DELETE | `/tasks/:id` | S | |
| POST | `/tasks/:id/move` | S | `{ status, beforeId?, afterId? }` → renumera las columnas afectadas en una transacción y devuelve su nuevo orden |
| GET, POST | `/tasks/:id/time-entries` | S | Anotación manual `{ startedAt, endedAt }` |
| POST | `/tasks/:id/timer/start`, `/tasks/:id/timer/stop` | S | 409 si ya hay un cronómetro en marcha |
| DELETE | `/time-entries/:id` | S | |
| GET, POST | `/tasks/:id/reminders` | S | `{ remindAt }` |
| DELETE | `/tasks/:id/reminders/:reminderId` | S | |

**notes**
| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/notes?q=&tag=&archived=&cursor=` | S | Búsqueda de texto completo, ordenada por relevancia si hay `q` |
| POST | `/notes` | S | `{ title, bodyMd, tags: string[] }`. Las etiquetas se crean si no existen |
| GET, PATCH, DELETE | `/notes/:id` | S | `tags` en el PATCH sustituye el conjunto completo |
| GET | `/tags` | S | Con el número de notas |
| PATCH, DELETE | `/tags/:id` | S | Renombrar o eliminar |

---

## 3. (c) Mapeo de la plantilla Excel al modelo

El contrato completo, columna a columna, está en [`plantilla-excel.md`](plantilla-excel.md). Aquí van las decisiones de diseño.

### 3.1 Hoja → modelo

| Hoja | Papel | Se lee | Destino | Se ignora |
|---|---|---|---|---|
| Datos y supuestos | Entrada principal | Columnas A–H (+ I en la v2) | `plan_items` | — |
| Presupuesto | Entrada + calculada | Categoría, Concepto, Tipo, Esencial, **referencias** de Mensual y Estado | `plan_budget_lines` (+ `plan_category_mappings`) | Anual, % ingreso y el bloque de resumen |
| Eventos y compromisos | Entrada | Todas las columnas; Importe como referencia o literal | `plan_events` | — |
| Metas | Entrada + calculada | Meta, Objetivo, Actual, Aportación, Estado, Criterio | `plan_goals` | Pendiente y Meses |
| Escenarios | Calculada con definiciones | Nombre, extra mensual y pago puntual [columnas A CONFIRMAR] | `plan_scenarios` | Gasto base, caja libre, tasa y lectura |
| Proyección 12M | Calculada | — | — | Toda (se recalcula) |
| Checks | Calculada | — | — | Toda (se recalcula) |
| Dashboard | Calculada | — | — | Toda (se recalcula) |

### 3.2 Principio clave: entrada frente a derivado

La plantilla mezcla datos de entrada y resultados. La app los separa: **las tablas solo guardan entradas** y los resultados son funciones puras de esas entradas. Esta separación es la que elimina por diseño los cuatro errores de la plantilla (`plantilla-excel.md` §10).

### 3.3 Clasificar las filas de «Datos y supuestos»: inferir o añadir una columna

| Criterio | A. Inferir + vista previa confirmable | B. Columna «Tipo de registro» en la plantilla |
|---|---|---|
| Determinismo | Heurístico. Cambiar el texto de «Grupo» puede cambiar la clasificación | Total |
| Esfuerzo en la plantilla | Ninguno | Una vez: añadir la columna I con una lista desplegable y etiquetar las filas (minutos) |
| Esfuerzo en el código | Reglas con prioridad, memoria de decisiones, interfaz para reclasificar y tests de cada regla | Leer una columna y hacer comprobaciones cruzadas |
| Errores silenciosos | Posibles: una regla que se equivoca «con confianza». La vista previa los mitiga, pero con decenas de filas se acaba aceptando sin leer (fatiga de confirmación) | El error se ve en el propio Excel; las referencias entre hojas generan avisos |
| Fuente de verdad | Repartida entre el Excel y la memoria de decisiones de la app | El Excel |
| Evolución | Cada tipo nuevo exige una regla nueva y riesgo de colisiones | Un valor nuevo en la lista |
| Defensa en una entrevista | Se puede explicar, pero cuesta justificar por qué se adivina algo que se puede declarar | «Contrato de datos explícito, mejor explícito que implícito» |

**Recomendación: B.** La inferencia resuelve un problema que no hace falta tener: tú controlas la plantilla. La vista previa se mantiene en cualquier caso, porque sirve para revisar los problemas, las correspondencias de categorías y las diferencias con el mes anterior.

Si decides **no** tocar la plantilla (opción A), estas son las reglas mínimas, por orden de prioridad:
1. Decisión recordada para el par normalizado (grupo, concepto).
2. Referencias entre hojas: desde Presupuesto · Mensual → `expense`; desde Eventos · Importe → `one_off_payment`; desde Escenarios → `scenario`; desde Metas → `goal` o `assumption` (ambiguo, se pregunta).
3. Estado = Histórico → `historical`.
4. Naturaleza Saldo/Acumulado y unidad € → `savings_balance`.
5. Unidad «meses» o Naturaleza Supuesto → `assumption`.
6. Naturaleza Objetivo → `goal`.
7. Naturaleza Puntual y unidad € → `one_off_payment`.
8. Palabras clave en Grupo («ingreso», «nómina») y €/mes → `income`. Es la más frágil.
9. Si ninguna se cumple → `unclassified`, que **bloquea la confirmación** hasta decidirlo a mano.

### 3.4 Relacionar filas entre hojas

1. Se lee el **texto de la fórmula** de Presupuesto · Mensual y Estado, Eventos · Importe y las columnas de entrada de Metas y Escenarios.
2. Se analiza con la gramática estricta de `plantilla-excel.md` §5 → `(columna, fila)` de «Datos y supuestos».
3. La fila se convierte en el `plan_item` con ese `source_row` **de la misma importación**. La FK compuesta impide mezclar fotos.
4. Validaciones: que la fila destino exista y no esté vacía; que la columna sea la esperada (C para importes, F para estados); que Mensual y Estado apunten a la misma fila; que la unidad sea compatible.
5. **El texto del concepto nunca se usa para relacionar filas.** Si los conceptos de las dos hojas no coinciden, solo se muestran los dos en la vista previa.
6. Entre meses distintos, `source_row` puede cambiar porque se inserten filas. Para mostrar «qué ha cambiado respecto al mes pasado», la correspondencia se hace, solo a título informativo, por `(record_type, concepto normalizado)`. Nunca se usa para calcular nada.

### 3.5 Qué pasa si el archivo no cumple la estructura

Hay cuatro niveles de validación. **Se recogen todos los problemas** antes de responder y **nunca se hace una importación parcial**.

| Nivel | Ejemplos | Respuesta |
|---|---|---|
| 1. Archivo | Tamaño, no es un ZIP OOXML, tiene macros, tiene vínculos externos, supera los límites de descompresión | `413` / `415` / `422` sin crear un lote |
| 2. Libro | Falta una hoja, cabecera distinta, versión de plantilla no admitida | Lote `failed` con los problemas (así queda el historial) |
| 3. Celda | Tipo incorrecto, valor fuera de la lista, más de 2 decimales, fórmula no admitida | Lote `preview` con errores → **no se puede confirmar** |
| 4. Semántica | Referencias rotas, Mensual y Estado en filas distintas, evento incluido sin fecha, categoría sin correspondencia | Igual que el nivel 3. Las categorías sin correspondencia se pueden resolver en la vista previa; el resto obliga a corregir el Excel y volver a subirlo |

Cada problema indica `code`, `severity`, `sheet`, `cell` (A1) y un mensaje en español. Los **avisos** no bloquean la confirmación, pero se muestran. **Nunca se ejecuta ni se evalúa nada** del archivo: se leen el valor y el texto de la fórmula.

### 3.6 Idempotencia al importar el mismo mes dos veces

- `file_sha256` (bytes del archivo): solo para auditoría. **No sirve para la idempotencia**: Excel cambia metadatos al volver a guardar aunque los datos no cambien.
- `content_hash`: SHA-256 de una **serialización canónica de las entradas extraídas** (claves ordenadas, textos normalizados, importes en céntimos). Dos archivos con las mismas entradas producen el mismo hash.

| Caso | Resultado |
|---|---|
| Mismo mes y mismo `content_hash` que la foto vigente | 200 con la importación existente. No se crea nada |
| El mismo archivo guardado otra vez sin cambios (bytes distintos, mismo contenido) | Igual que el caso anterior |
| Mismo mes con el contenido cambiado | Nueva vista previa. Al confirmar, **en una única transacción**: la foto anterior pasa a `superseded`, se crea la nueva `active` y el lote pasa a `confirmed`. El historial se conserva |
| Dos confirmaciones simultáneas del mismo mes | `pg_advisory_xact_lock` por mes + índice único parcial `(month) WHERE status = 'active'`. La segunda recibe un 409 o el resultado de la primera |
| Confirmar dos veces el mismo lote | La segunda devuelve 200 con el mismo `snapshotId` |
| Vista previa abandonada | Caduca a las 24 h. Un trabajo periódico la marca `expired` y vacía `extracted` |

### 3.7 Estados de una importación

```
subida ──▶ failed (estructura inválida)
   │
   └──▶ preview ──(decisiones)──▶ preview ──▶ confirmed ──▶ crea plan_snapshot (active)
            │                                               la foto anterior → superseded
            ├──▶ discarded (el usuario la descarta)
            └──▶ expired (más de 24 h)
```

### 3.8 Comparativa plan frente a real (por categoría y mes M)

- **Plan aplicable a M**: la foto vigente de M. Si no hay, la vigente más reciente anterior a M, indicada claramente («plan de septiembre») [DECIDIR].
- **Plan por categoría**: Σ de las líneas de presupuesto incluidas, según la correspondencia de categorías.
- **Real por categoría**: Σ de los gastos **confirmados** con `booked_on` dentro de M.
- Los movimientos **pendientes** se muestran aparte («N pendientes, X €») y no se reparten por categoría [DECIDIR].
- Las transferencias no aparecen, por construcción.
- Los **eventos puntuales** de M se muestran en una fila propia, «Pagos puntuales previstos», porque en la plantilla no tienen categoría [DECIDIR].
- Las categorías con gasto real y sin plan aparecen como «sin presupuesto».
- Columnas: plan, real, diferencia (real − plan) y % ejecutado. También hay una fila de ingresos plan frente a real.

---

## 4. (d) Evaluación crítica del stack y de las librerías

### 4.1 Express 5 frente a las alternativas

| Opción | Qué aporta | Qué cuesta | Encaje con este proyecto |
|---|---|---|---|
| **Express 5** (elegida) | Mínimo, ubicuo y conocido. La versión 5 pasa los errores de las funciones `async` al gestor de errores | La estructura depende de tu disciplina. No trae validación, logger ni inyección de dependencias | **Bueno**, si la estructura se impone con lint y tests. Cada decisión es tuya y explicable |
| NestJS | Módulos, inyección de dependencias, decoradores, pipes de validación y una estructura impuesta | Mucha abstracción (decoradores, `reflect-metadata`). Aprendes Nest antes que HTTP y Node. Es pesado para un solo usuario | Te daría la estructura «gratis», pero esconde justo lo que quieres saber explicar. Es una opción razonable si tu objetivo laboral son empresas que usan Nest |
| Fastify | Validación y serialización por esquema integradas, logger (pino) integrado, encapsulación de plugins que encaja con los módulos y mejor rendimiento | Menos ubicuo que Express; su modelo de plugins requiere aprendizaje | **Técnicamente igual o superior** para este caso. El rendimiento **no** es un argumento aquí: hay un solo usuario. Elegir Express se defiende por ubicuidad y simplicidad, no por méritos técnicos |
| Supabase | PostgreSQL gestionado, autenticación, almacenamiento, API REST automática con RLS y copias (de pago) | La lógica (recálculo, importador) acabaría en *edge functions* (Deno) o en el cliente. Seguridad centrada en RLS. Dependencia del proveedor. El plan gratuito **se pausa tras ~7 días sin actividad y no tiene copias** [VERIFICAR] | Mal encaje como backend: le quita el backend al proyecto. Sí podría servir **solo como PostgreSQL gestionado**, de pago para evitar la pausa |
| Next.js | Full-stack React: rutas de API, server actions y renderizado en el servidor | Es una app privada tras un login: el SSR y el SEO no aportan nada. Añade la complejidad de la frontera servidor/cliente. Los procesos de larga duración (recordatorios) encajan mal en *serverless*. La PWA se monta a mano | Mal encaje. Vite + SPA + una API separada es más simple y deja más clara la separación de capas que quieres demostrar |

**Conclusión (opinión razonada):** el stack elegido es defendible. Su punto débil es que **la arquitectura no la impone el framework**. Para compensarlo:
1. `no-restricted-imports` para las fronteras entre módulos.
2. Un test que recorre las rutas y comprueba que todas exigen autenticación.
3. Un README por módulo.
4. ADR para cada desviación.

Si en la entrevista te preguntan «¿por qué no Fastify?», la respuesta honesta es: «ubicuidad y una superficie mínima; Fastify habría sido igual de válido».

### 4.2 Librerías candidatas

Licencias y estado de mantenimiento según lo consultado en noviembre de 2026; hay que **volver a comprobarlos al instalar** cada una [VERIFICAR]. Cada dependencia se registra en `docs/dependencias.md` (§4.3).

| Necesidad | Candidatas | Recomendación | Por qué | Qué verificar |
|---|---|---|---|---|
| **Acceso a datos y migraciones** | Prisma · Drizzle · **Kysely** · TypeORM · Knex · node-pg-migrate + SQL | **Kysely** + `pg` + migraciones con el `Migrator` de Kysely (SQL escrito a mano) + `kysely-codegen` para generar los tipos a partir de la base de datos | El SQL es de primera clase: `CHECK`, FK compuestas, índices parciales, `tsvector` y restricciones diferibles se escriben tal cual. Las consultas se parecen al SQL (aprendes SQL, que vale más en una entrevista). No es un ORM con magia. MIT. Publica versiones con regularidad (0.28.x) | Versión estable actual. Que `kysely-codegen` genere bien las columnas `GENERATED` y los arrays. Que el tipado de `CamelCasePlugin` funcione |
| | Drizzle (alternativa) | Reconsiderarlo cuando publique la 1.0 estable | El esquema en TypeScript infiere los tipos sin generación de código | **La 1.0 seguía en release candidate** [VERIFICAR]: habría cambios incompatibles al migrar desde la 0.x |
| | Prisma (descartado) | — | Buena experiencia de desarrollo, pero `tsvector` es `Unsupported`, los `CHECK` se escriben a mano en la migración y el DSL esconde el SQL | — |
| **Lectura del Excel** | **SheetJS CE** · ExcelJS · OOXML a mano (zip + XML) | **Spike de 1 día al empezar la fase 3** con la fixture ficticia. Preselección: **SheetJS CE ≥ 0.20.x** instalado desde su CDN oficial, con la versión fijada y el *tarball* guardado en el repositorio | Lee el texto de las fórmulas (`cellFormula`), las fechas y el sistema 1904. Apache-2.0 | **El paquete `xlsx` del registro npm está anclado en 0.18.5, con CVE conocidos** (p. ej., CVE-2023-30533); las versiones corregidas solo se publican en `cdn.sheetjs.com`. Dependabot no lo vigila → revisión manual trimestral. Comprobar que expande las **fórmulas compartidas** a cada celda y que acepta `.xlsm` |
| | ExcelJS | Plan B | MIT y en npm | **Sin versiones desde la 4.4.0 (2023) y con muchas incidencias abiertas** (Snyk lo marca como inactivo) [VERIFICAR] |
| | OOXML a mano | Plan C | Control total y cero dependencias de Excel | Unos cientos de líneas propias; lo más delicado es detectar las fechas (estilos y `numFmt`) |
| **Gráficos** | **Recharts** · Chart.js + react-chartjs-2 · ECharts · visx | **Recharts** | Declarativo en JSX y suficiente para barras, líneas y tarta. SVG accesible y fácil de probar. MIT | Compatibilidad de la v3 con la versión de React que se use; tamaño del bundle; accesibilidad (textos alternativos o tabla de datos) |
| **Arrastrar y soltar** | **dnd-kit** · @hello-pangea/dnd · Pragmatic DnD (Atlassian) | **@dnd-kit/core + @dnd-kit/sortable**, con sensores táctiles y de teclado, y un menú «Mover a…» como alternativa | Más actividad de mantenimiento; admite toque, teclado y lectores de pantalla. MIT | **En la PWA instalada en iOS**: el conflicto entre desplazar y arrastrar (retardo de activación). Estado del nuevo `@dnd-kit/react` (no usarlo si es pre-1.0). @hello-pangea/dnd (Apache-2.0) es más simple para kanban, pero muestra **menos actividad** [VERIFICAR]. Pragmatic DnD usa DnD nativo de HTML5, con soporte táctil dudoso en iOS |
| **PWA** | **vite-plugin-pwa** (Workbox) · *service worker* escrito a mano | **vite-plugin-pwa 1.x, estrategia `injectManifest`** | Genera la lista de archivos a precachear con sus hashes; el *service worker* lo escribes tú (push y clics en notificaciones). MIT | Compatibilidad con la versión de Vite (dependencias *peer*). **No cachear `/api`** (`NetworkOnly`): ni datos financieros obsoletos ni copias en el dispositivo |
| **Envío de push** | **web-push** · @pushforge/builder · implementación propia (RFC 8291/8292) | **web-push**, detrás de una interfaz `PushSender` para poder cambiarlo | El protocolo (VAPID + cifrado `aes128gcm`) es estable desde 2017, así que «sin versiones» no implica «roto». Es el más usado | **Inactivo desde la 3.6.7 (enero de 2024)** [VERIFICAR]. Licencia **MPL-2.0**: copyleft por archivo; usarlo sin modificarlo no impone obligaciones a tu código y la app no se distribuye. Probar que funciona con `web.push.apple.com` y con la versión LTS de Node |
| **Tareas programadas** | `setInterval` · croner · node-cron · pg-boss · cron del sistema | **Sin dependencia**: un bucle de 60 s en el proceso que **reclama** los trabajos en la base de datos (`FOR UPDATE SKIP LOCKED`, `sent_at`). Las copias de seguridad, con un **temporizador del sistema** (fuera de la app) | El estado vive en PostgreSQL, así que un reinicio no pierde recordatorios y nada se envía dos veces. pg-boss (MIT) solo compensa con varias instancias o reintentos complejos | Desfase de los temporizadores tras suspensiones; comportamiento con el cambio de horario (se guarda `timestamptz` y se calcula en `Europe/Madrid`) |
| **Hash de contraseñas** | **`crypto.argon2` de Node** · @node-rs/argon2 · argon2 · scrypt de Node | **Argon2id nativo de Node** (añadido en la 24.7.0 y marcado como estable después) → cero dependencias. Alternativa: `@node-rs/argon2` (MIT, binarios precompilados) | Algoritmo recomendado por OWASP | Que sea estable **en la versión LTS que elijas** [VERIFICAR]. Parámetros mínimos de OWASP: m = 19 MiB, t = 2, p = 1 |
| **Límite de peticiones** | **express-rate-limit** · implementación propia | **express-rate-limit** (MIT) con almacenamiento en memoria | Una sola instancia, así que la memoria basta | Que el estado se pierde al reiniciar (aceptable). Configurar `trust proxy` detrás de Caddy, o la IP será siempre la del proxy |
| **Cabeceras de seguridad** | **helmet** · a mano | **helmet** (MIT) | CSP, HSTS, `frame-ancestors`… con valores razonables | CSP compatible con el *service worker* y con Vite en producción |
| **Logs** | **pino** · console | **pino** + `pino-http` (MIT) | JSON estructurado y **`redact`** para cookies, `authorization`, contraseñas y tokens | Que nunca se registren cuerpos de petición con importes o tokens |
| **Validación** | **Zod** · Valibot · ArkType | **Zod 4** (MIT) | Ecosistema amplio y tipos inferidos | Diferencias de API entre la v3 y la v4 en los ejemplos que encuentres |
| **Tests** | **Vitest** · Jest; supertest; Playwright | **Vitest** + **supertest** (MIT). Playwright (Apache-2.0) solo si hacen falta pruebas de extremo a extremo | Vitest comparte configuración con Vite | Tests de integración contra PostgreSQL real (Docker en local; contenedor de servicio en CI). Sin Testcontainers, que sería una dependencia más |
| **Lint y formato** | **ESLint 9 + typescript-eslint + Prettier** · Biome | **ESLint + typescript-eslint** (reglas con tipos, como `no-floating-promises`, crítica en Express) + Prettier | Estándar y con reglas que necesitan información de tipos | — |
| **Frontend: datos y rutas** | TanStack Query · SWR; React Router · TanStack Router | **TanStack Query** + **React Router** (modo declarativo, sin el modo *framework*) | Caché e invalidación del estado del servidor; rutas sin SSR | — |
| **Markdown (notas)** | **react-markdown** · marked + DOMPurify | **react-markdown** + `remark-gfm`, **sin `rehype-raw`** | No renderiza HTML incrustado por defecto → sin XSS | No activar nunca HTML crudo |
| **Monorepo** | **pnpm workspaces** · npm workspaces · Turborepo/Nx | **pnpm** | `node_modules` estricto: detecta las dependencias no declaradas. Desde la v10 **no ejecuta los scripts `postinstall`** de las dependencias por defecto. **`minimumReleaseAge`** (desde la 10.16; 24 h por defecto en la 11) protege frente a versiones maliciosas recién publicadas | Dónde va la configuración en tu versión (`pnpm-workspace.yaml` frente a `.npmrc`). Instalación de pnpm sin Corepack si tu versión de Node ya no lo incluye |
| **Ejecutar TypeScript (API)** | `tsc` · tsx · eliminación de tipos nativa de Node | En desarrollo, `node --watch` con eliminación de tipos nativa (exige `erasableSyntaxOnly`: sin `enum` ni *parameter properties*), o tsx si falla. En producción, compilar con `tsc` | Menos dependencias y comportamiento predecible en producción | Que la importación de `packages/shared` funcione con la eliminación de tipos nativa |
| **Runtime** | Node 24 / 26 | **La LTS activa al empezar** (Node 26 pasó a LTS en octubre de 2026, según lo anunciado) | — | [VERIFICAR] el calendario oficial. Node cambia a una versión mayor al año a partir de la 27 |

### 4.3 Política de dependencias

- Archivo `docs/dependencias.md` con una fila por dependencia directa: **para qué sirve, qué alternativa había y por qué se descartó, licencia, última versión y fecha, y fecha de la revisión**.
- La pregunta previa a añadir cualquier dependencia: **¿lo resuelve la plataforma (Node, el navegador, PostgreSQL) en menos de unas 50 líneas que se puedan probar?** Si la respuesta es sí, no se añade.
- `pnpm audit` y Dependabot (o Renovate) con revisión semanal. Las actualizaciones mayores, en PR aparte.

---

## 5. (e) Atajo de iPhone: flujo completo

### 5.1 Componentes

1. **Automatización personal «Transacción»** en Atajos (iOS 17+). Se ejecuta al pagar con las tarjetas de Wallet que elijas. Según la documentación de terceros y los foros, la entrada del atajo ofrece las propiedades **Transacción, Tarjeta, Comercio, Importe y Nombre** [VERIFICAR en tu dispositivo].
2. **Token de dispositivo** con permisos limitados (`ingest:write` y, opcionalmente, `ingest:read-catalog`).
3. **Endpoint** `POST /api/v1/ingest/wallet-transactions`.
4. **Notificación push** a la PWA instalada.
5. **Bandeja de pendientes** en la PWA.

### 5.2 Configuración inicial (una sola vez)

1. Instalar la PWA desde Safari (Compartir → «Añadir a pantalla de inicio») y abrirla **desde el icono**.
2. En la PWA: Ajustes → Notificaciones → «Activar» (el permiso se pide al tocar un botón; iOS no lo permite de otra forma).
3. En la PWA: Ajustes → Dispositivos → «Crear token para el atajo» (caducidad de 90 a 180 días). El token se muestra **una sola vez**.
4. En Atajos: Automatización → Nueva → **Transacción** → elegir las tarjetas → **«Ejecutar inmediatamente»** y desactivar «Notificar al ejecutar» si se prefiere.
5. Acciones del atajo (la guía con capturas irá en `docs/atajo-iphone.md`):
   - **Obtener contenido de URL**: método POST, con las cabeceras `Authorization: Bearer <token>`, `Idempotency-Key: <fecha y hora con segundos + número aleatorio>` y `Content-Type: application/json`, y un cuerpo JSON con `card`, `merchant`, `amount` (**como texto, tal cual llega**), `name` y `occurredAt` (fecha actual en ISO 8601).
   - **Si** el resultado no indica éxito → **Mostrar notificación** «No se pudo registrar el pago: regístralo a mano». Un fallo nunca debe pasar desapercibido.
6. Requisito señalado por terceros: **los datos móviles deben estar activados para Wallet**, o la automatización puede fallar [VERIFICAR].

**Sobre el token guardado en el atajo:** los atajos se sincronizan por iCloud, así que el token queda guardado en los servidores de Apple. Por eso tiene un permiso mínimo (solo crear pendientes y leer categorías; **no puede leer movimientos ni saldos**), caduca, se puede revocar y registra su último uso.

### 5.3 Secuencia al pagar

```
Pago con Wallet ─▶ automatización ─▶ POST /ingest/wallet-transactions
  servidor: 1. límite de peticiones por token
            2. autentica el token (hash, no revocado, no caducado, con permiso) y actualiza last_used_at
            3. valida el cuerpo con un esquema tolerante (§5.4)
            4. idempotencia: INSERT … ON CONFLICT (device_token_id, idempotency_key) DO NOTHING
                 → si ya existía: 200 con el movimiento original (sin volver a notificar)
            5. convierte el importe (función compartida y probada) → céntimos o una marca
            6. tarjeta → wallet_cards (la crea si es nueva) → cuenta o marca unknown_card
            7. huella: misma tarjeta + importe + comercio en ±2 min → marca possible_duplicate
            8. INSERT movimiento (expense, pending, source = shortcut, raw_payload)
            9. responde 201 en menos de 1 s
           10. DESPUÉS de responder: notificación push y contador del icono (un fallo del push no afecta al registro)
◀─ el atajo comprueba la respuesta; si hay error, notificación local
Notificación ─▶ toque ─▶ PWA ─▶ bandeja de pendientes ─▶ completar ─▶ confirmar
```

### 5.4 Contrato del endpoint

- **Petición:** cuerpo JSON. Todos los campos son textos opcionales con una longitud máxima: `card`, `merchant`, `amount`, `name`, `occurredAt`, y para la mejora opcional `description` y `categoryId`.
- **Filosofía: no perder nunca un pago.** Se acepta cualquier contenido como borrador, con marcas. Solo se rechaza un JSON mal formado (400), la falta de autenticación (401), la falta de permiso (403) o el exceso de peticiones (429).
- **Conversión del importe** (en `packages/shared`, con tests de tabla):
  - Admite `"12,50 €"`, `"€12.50"`, `"12.50"`, `"1.234,56 €"` y `"12 €"`.
  - Regla: el último separador seguido de 1 o 2 dígitos es el separador decimal; seguido de 3 dígitos, es el de miles.
  - El formato real se descubre en la prueba T3 (§5.10).
  - Importe 0 o que no se puede interpretar → `amount_cents = 0` y la marca `amount_missing` o `amount_unparsed`.
  - Moneda distinta del euro → `amount_cents = 0` y la marca `foreign_currency`: completas el importe en euros cuando veas el cargo.
- **Comercio vacío** → marca `merchant_missing`.
- **Tarjeta:** si el texto contiene algo con forma de número de tarjeta (12 o más dígitos seguidos), se descarta y se registra un aviso.
- **Respuestas:** 201 `{ id, status: "pending", flags }` · 200 (repetido) con el mismo cuerpo.

### 5.5 Duplicados: por qué hacen falta dos mecanismos

| Situación | Clave de idempotencia | Huella (±2 min) |
|---|---|---|
| El atajo reintenta la misma petición | ✅ la detecta: misma clave | — |
| iOS ejecuta la automatización dos veces | ❌ son dos claves distintas | ✅ marca `possible_duplicate` |
| Dos cafés idénticos en 2 minutos (legítimo) | — | ⚠️ marca `possible_duplicate`, **pero no lo rechaza**: lo decides tú al confirmar |

### 5.6 Bandeja de pendientes

- Lista ordenada de más reciente a más antiguo. Las marcas se muestran como etiquetas: «sin importe», «tarjeta sin asignar», «¿duplicado?».
- **Sugerencia de categoría**: la última que usaste con ese comercio. Es una regla simple, sin «IA».
- Tarjeta desconocida → eliges la cuenta y la opción «recordar para esta tarjeta».
- Botones «Confirmar» y «Descartar». Confirmar valida que esté completo; la restricción de la base de datos lo garantiza aunque falle el frontend.
- **Formulario rápido** para los pagos que no son de Wallet: importe, categoría y cuenta (preseleccionada) en una pantalla, con fecha de hoy por defecto. Objetivo: registrar un gasto en menos de 15 s.

### 5.7 Notificación → apertura en la bandeja

- **Problema conocido:** en varias versiones de iOS, `clients.openWindow(url)` desde `notificationclick` abría **la raíz** de la PWA y no la URL indicada, sobre todo si la app estaba cerrada. Un comentario de WebKit de diciembre de 2025 dice que en iOS 26 ya no se reproduce [VERIFICAR].
- **Diseño robusto, que no depende de ese comportamiento:**
  1. En el *service worker*: si ya hay una ventana abierta → `focus()` + `postMessage({ navigate: '/inbox' })`; si no → `openWindow('/inbox')`.
  2. La **pantalla de inicio** muestra «Pendientes (N)» de forma destacada cuando N > 0. Aunque el enlace profundo falle, la bandeja queda a un toque.
  3. Contador en el icono con `navigator.setAppBadge(N)`, disponible en las web apps de pantalla de inicio desde iOS 16.4 [VERIFICAR].
- **Privacidad en la pantalla de bloqueo** [DECIDIR]: «Nuevo pago pendiente» (genérico) o «12,50 € en Comercio». El contenido del push viaja cifrado de extremo a extremo (RFC 8291), pero la pantalla de bloqueo lo muestra.

### 5.8 Mejora opcional: preguntar el concepto y la categoría en el momento

- El atajo llama a `GET /ingest/catalog`, muestra «Elegir de la lista» y «Pedir entrada» y envía `description` y `categoryId`.
- **Incertidumbres:** si una automatización con «Ejecutar inmediatamente» puede mostrar diálogos interactivos y cómo lo hace (en la pantalla de bloqueo o encima de la app de pago); si es cómodo hacerlo en la caja; y la latencia de dos peticiones.
- Aunque se envíe la categoría, el movimiento **sigue entrando como pendiente**. Así hay una sola ruta de confirmación. Una variante sería confirmarlo directamente si el importe es mayor que 0 y no hay marcas [DECIDIR tras probarlo].

### 5.9 Limitaciones

| Limitación | Consecuencia o mitigación |
|---|---|
| Solo cubre los pagos con Wallet | Formulario rápido para el resto |
| Puede no dispararse con pagos desde el **Apple Watch**, con pagos **online** de Apple Pay o en modo Exprés de transporte [VERIFICAR los tres] | Prueba T1/T14; registro manual |
| El importe puede ser el **autorizado** y no el final (gasolineras, propinas, preautorizaciones) | El importe se puede editar al confirmar |
| Hay informes de **importe 0** y de **comercio vacío** | Se acepta como borrador con marca |
| Los **reembolsos** probablemente no generan ningún evento [VERIFICAR] | Se registran a mano como ingreso |
| Sin conexión al pagar, el POST falla y el atajo no lo pone en cola | Notificación local de fallo y registro manual |
| El token está guardado en el atajo y sincronizado con iCloud | Permiso mínimo, caducidad, revocación y `last_used_at` visible |
| Las actualizaciones de iOS pueden cambiar el comportamiento sin avisar | Volver a pasar el protocolo §5.10 tras cada versión mayor de iOS |
| Push: solo con la PWA en la pantalla de inicio (iOS 16.4+), con un permiso que el usuario concede tocando un botón. iOS puede invalidar las suscripciones | Detectar los 404/410 y desactivar; botón «Notificación de prueba»; aviso en la app si no hay ninguna suscripción activa |
| Las automatizaciones **no se pueden probar ejecutándolas a mano** (la entrada llega vacía) | Las pruebas exigen pagos reales: hacer compras pequeñas a propósito |
| Riesgo de plataforma: en 2024 Apple anunció que retiraba las web apps de pantalla de inicio en la UE y después rectificó | Bajo, pero real. Alternativa: el formulario rápido funciona también en Safari |

### 5.10 Protocolo de pruebas en tu dispositivo

Hay que anotar la versión de iOS y el resultado de cada prueba en `docs/atajo-iphone.md`.

**Durante el *spike***, el endpoint guarda el cuerpo recibido en un log temporal para conocer el formato real. **Después hay que borrar ese log.**

| ID | Prueba | Resultado esperado o qué anotar |
|---|---|---|
| T1 | Pago real con cada tarjeta (débito y crédito), con el iPhone bloqueado y desbloqueado | Se dispara siempre; el movimiento aparece como pendiente |
| T2 | Contenido exacto de Tarjeta, Comercio, Importe y Nombre | Anotar los nombres y los formatos reales |
| T3 | Formato del importe: céntimos, ≥ 1.000 €, sin decimales | Ajustar los tests de la conversión con los ejemplos reales |
| T4 | Pago en otra moneda (si es posible) | Marca `foreign_currency` |
| T5 | Sin cobertura justo al pagar | Aparece la notificación local de fallo |
| T6 | Latencia total del atajo | Menos de 2–3 s; ¿cuánto tarda iOS en cortar la petición? |
| T7 | ¿Se dispara dos veces? ¿Con qué frecuencia? | Marca `possible_duplicate` |
| T8 | Llega el push con la app cerrada y el iPhone bloqueado; con un modo de Concentración activo | Anotar el comportamiento |
| T9 | Al tocar la notificación se abre la bandeja (en arranque en frío y con la app ya abierta) | `/inbox`, o como mínimo la pantalla de inicio con el aviso de pendientes |
| T10 | Contador en el icono | Coincide con el número de pendientes |
| T11 | La sesión de la PWA sigue activa tras 7 días o más sin usarla | Sigue iniciada sin volver a introducir la contraseña (o anotar si no) |
| T12 | Token revocado o caducado | 401 → notificación local |
| T13 | Mejora opcional: diálogos dentro de la automatización | ¿Aparecen? ¿Es cómodo usarlos en la caja? |
| T14 | Apple Pay en una web o una app y pago con el Apple Watch | ¿Se dispara? |
| T15 | Devolución o reembolso | ¿Se dispara? ¿Con qué signo? |

---

## 6. (f) Seguridad y copias de seguridad

### 6.1 Modelo de amenazas (resumen)

| Activo | Amenaza | Control principal |
|---|---|---|
| Datos financieros | Atacante desde internet (escaneos, fuerza bruta) | Superficie mínima, autenticación obligatoria, límite de peticiones, PostgreSQL sin exponer |
| Contraseña | Fuerza bruta o relleno de credenciales | Argon2id, límite de peticiones y espera creciente; contraseña larga y única (gestor de contraseñas) |
| Sesión | Robo de la cookie, CSRF | `HttpOnly`, `Secure`, `SameSite=Lax`, prefijo `__Host-`, token CSRF y comprobación de `Origin` |
| Token del atajo | Filtración (iCloud, captura de pantalla) | Permiso mínimo, guardado como hash, caducidad, revocación y `last_used_at` |
| Copias de seguridad | Filtración o borrado | Cifrado en el cliente; almacenamiento en modo de solo añadir; restauración probada |
| Repositorio | Commit accidental de datos o secretos | `.gitignore`, solo fixtures ficticias, escaneo de secretos en CI |
| Dependencias | Paquete comprometido (como los incidentes en npm de septiembre de 2025) | Pocas dependencias, lockfile, `minimumReleaseAge`, sin scripts `postinstall` |
| Teléfono robado | Acceso a la PWA con la sesión abierta | Bloqueo del iPhone; reautenticación para las acciones sensibles; revocar sesiones desde otro dispositivo |

### 6.2 Controles

**Autenticación**
- Argon2id con parámetros iguales o superiores a los mínimos de OWASP. El formato PHC permite subirlos y recalcular el hash al iniciar sesión.
- Contraseña de **15 caracteres como mínimo**, en línea con NIST SP 800-63B-4 para un único factor [VERIFICAR la redacción final]. Sin reglas de composición.
- Usuario creado por un script de CLI (`scripts/create-user`). **No existe ningún endpoint de registro.**
- Recuperación de acceso: un script en el servidor (requiere acceso SSH). No hay «olvidé mi contraseña» por correo, porque abriría una vía de ataque.
- Segundo factor (TOTP o passkey) [DECIDIR]. Una passkey (WebAuthn) en la PWA sería segura y cómoda, pero hay que verificar el soporte en el modo *standalone* de iOS.

**Sesiones**
- Identificador aleatorio de 256 bits. En la base de datos solo se guarda su SHA-256.
- Cookie `__Host-sid`: `HttpOnly; Secure; SameSite=Lax; Path=/`.
- Caducidad por inactividad de 14 días y caducidad absoluta de 60 [DECIDIR].
- La sesión se rota al iniciar sesión y se revocan todas al cambiar la contraseña.

**CSRF**
- Token sincronizado por sesión: lo entrega `/auth/session`, viaja en la cabecera `X-CSRF-Token` en los métodos que modifican datos y se compara su hash.
- Además, se comprueba `Origin` (o `Sec-Fetch-Site`).
- `SameSite=Lax` es la tercera capa. **No se usa `csurf`**, que está obsoleto.
- Por qué `Lax` y no `Strict`: con `Strict`, una navegación iniciada fuera de la app (por ejemplo, desde una notificación) podría llegar sin la cookie [VERIFICAR en el dispositivo].

**Límite de peticiones**
- Login: 5 intentos por IP cada 15 minutos, más una espera creciente global. Un bloqueo de cuenta sería una denegación de servicio contra ti mismo.
- Ingesta: 30 por minuto por token.
- Resto de la API: 300 por minuto.

**Autorización**
- Denegar por defecto (§2.10).
- Los tokens de dispositivo solo sirven en `/ingest/*`. Un test por cada combinación de credencial y ruta: **tests de permisos obligatorios**.

**Entradas y salidas**
- Zod en todas las fronteras.
- Kysely parametriza las consultas → sin inyección SQL. `sql.raw` está prohibido salvo justificación.
- React escapa la salida; Markdown sin HTML crudo; `ts_headline` se trata como texto.

**Archivos subidos**
- Solo los acepta la sesión con reautenticación, con un límite de 5 MB en el *parser*.
- Comprobación de los bytes iniciales y de la estructura OOXML. Límites de descompresión.
- Rechazo de `vbaProject.bin` y de vínculos externos.
- Nada se escribe en disco y no se evalúan fórmulas.
- Como solo sube archivos el usuario autenticado, el riesgo de denegación de servicio es limitado; los límites bastan.

**Cabeceras**
- helmet con:
  - CSP: `default-src 'self'`, sin `unsafe-inline` en los scripts, `frame-ancestors 'none'`.
  - HSTS.
  - `Referrer-Policy: no-referrer`.
  - `Permissions-Policy` restrictiva.

**Secretos**
- En variables de entorno, validadas al arrancar. `.env.example` sin valores; `.env*` en `.gitignore`.
- En producción, un archivo con permisos `600` fuera del repositorio.
- Secretos: la URL de la base de datos, las claves VAPID, la contraseña del repositorio de copias y la clave de firma, si la hubiera.

**Ningún dato real en el repositorio**
- `.gitignore` con `*.xlsx`, `*.xlsm`, `*.csv`, `*.dump`, `*.sql.gz`, `backups/` y `.env*`, con excepciones explícitas solo para `apps/api/test/fixtures/*ficticio*`.
- Escaneo de secretos en CI (p. ej., gitleaks [VERIFICAR la licencia y el mantenimiento]) y *push protection* de GitHub.

**Logs**
- pino con `redact`. No se registran los cuerpos de las peticiones de finanzas ni de la ingesta (salvo en el *spike*, de forma temporal y luego borrado).
- Cada petición lleva un `requestId`.

**Servidor (si es un VPS)**
- SSH solo con clave; sin `root` ni contraseña. Mejor aún, SSH solo a través de Tailscale.
- Cortafuegos con 80 y 443 abiertos. Actualizaciones de seguridad automáticas.
- PostgreSQL solo en la red interna de Docker. Imágenes con la versión fijada.

**Cifrado de columnas:** no se propone. El atacante que compromete el servidor también obtiene la clave, así que el beneficio real es bajo y la complejidad, alta. Se prefiere reforzar el servidor y cifrar las copias.

### 6.3 Copias de seguridad

| Aspecto | Propuesta |
|---|---|
| Qué | `pg_dump -Fc` de la base de datos completa, diario |
| Cómo | **restic** (BSD-2 [VERIFICAR]): `pg_dump … \| restic backup --stdin`. Cifrado en el cliente, deduplicación, retención y `restic check`. Alternativa: `age` + `rclone` |
| Quién lo ejecuta | Un temporizador `systemd` o el cron **del host**, no la app: la app no debe tener credenciales del almacén de copias |
| Dónde | Almacenamiento de objetos fuera del proveedor del servidor (p. ej., Backblaze B2, Cloudflare R2 o Hetzner Storage Box) [VERIFICAR el precio: céntimos al mes con este volumen] |
| Protección frente a un servidor comprometido | Una clave de aplicación **sin permiso de borrado**, o un bloqueo de objetos. Así un atacante en el servidor no puede borrar las copias |
| Retención | 7 diarias, 4 semanales y 12 mensuales |
| Claves | La contraseña de restic, en tu gestor de contraseñas **y** en una copia fuera de línea. Sin ella, las copias no sirven de nada |
| Restauración | **Prueba mensual**: restaurar en una base de datos temporal y ejecutar una consulta de humo (número de filas y suma de importes). Una copia que nunca se ha restaurado no se puede dar por buena |
| Monitorización | El script avisa a un servicio de «interruptor de hombre muerto» (p. ej., healthchecks.io) al terminar bien; si un día no avisa, te llega una alerta |
| Objetivos | RPO de 24 h (como mucho se pierde un día) y RTO de unas horas [DECIDIR]. Para un RPO menor haría falta archivar el WAL (pgBackRest o WAL-G), que es excesivo aquí |
| Exportación | Exportar en JSON o CSV desde la app (portabilidad y copia legible) [opcional] |

---

## 7. (g) Despliegue

### 7.1 Requisitos reales

1. **HTTPS con un certificado válido** para la PWA: el *service worker* y el push exigen un contexto seguro.
2. **Que el atajo pueda llegar al servidor.** Es lo único que exige accesibilidad desde fuera de casa.
3. **Proceso siempre encendido**: el planificador de recordatorios y la latencia del atajo. Descarta los planes gratuitos que se duermen (en Render, tras 15 minutos de inactividad y con más de 30 s para despertar [VERIFICAR]).
4. PostgreSQL persistente con copias.
5. Conexiones salientes a los servicios de push.

### 7.2 Opciones (costes aproximados en noviembre de 2026, sin IVA) [VERIFICAR todos los precios]

| Opción | Componentes | Coste/mes | A favor | En contra |
|---|---|---|---|---|
| **A. VPS en la UE + Docker Compose + Caddy** | Hetzner CX23 (2 vCPU / 4 GB) o similar (OVH, Netcup); dominio; almacenamiento de copias | VPS **~4–6 €** (Hetzner subió precios dos veces en 2026) + dominio ~1 € (10–15 €/año) + copias < 1 € → **~6–8 €** | Siempre encendido, coste fijo, control total, PostgreSQL local sin exponer, el planificador funciona | Te ocupas del sistema operativo, los parches y el cortafuegos: la seguridad del servidor es responsabilidad tuya |
| B. PaaS + PostgreSQL gestionado | Render Starter (~7 $) + PostgreSQL gestionado (~6–19 $), o Railway / Fly.io | **~15–30 $** | Sin sistema operativo que mantener; TLS y despliegue desde git; copias del proveedor (según el plan) | Más caro. Los planes gratuitos duermen; el PostgreSQL gratuito de Render **caduca a los 30 días**. Dependencia del proveedor |
| C. Servidor en casa + Cloudflare Tunnel | Raspberry Pi o NAS + `cloudflared` + dominio en Cloudflare | ~0 € + hardware + electricidad | Sin abrir puertos | Disponibilidad doméstica. **Cloudflare termina el TLS y ve el tráfico en claro**: tus datos financieros pasan por un tercero. Copia fuera de casa obligatoria |
| D. Solo red privada (Tailscale), sin exposición pública | VPS o casa + Tailscale; HTTPS con un certificado de `*.ts.net` | 0 € (plan personal [VERIFICAR]) + host | **Ninguna superficie de ataque pública** | El atajo solo funciona con la VPN activa en el iPhone (¿VPN bajo demanda? [VERIFICAR]). Hay que verificar el push y el *service worker* con un dominio `ts.net`. Dependes de Tailscale |
| E. Supabase como PostgreSQL + API en otro host | | Gratuito: **se pausa a los ~7 días sin actividad y no tiene copias**. Pro: ~25 $ | PostgreSQL gestionado con copias (Pro) | Caro para lo que aporta aquí |

### 7.3 Recomendación

**Opción A** con estas medidas:
1. Caddy (HTTPS automático con Let's Encrypt).
2. Solo los puertos 80 y 443 abiertos al público.
3. SSH accesible únicamente por Tailscale (combina lo mejor de A y D para la administración).
4. PostgreSQL sin exponer.
5. Copias con restic a un almacén externo.

**Coste estimado: 6–8 €/mes** [VERIFICAR].

Si más adelante quieres **cero exposición**, se puede migrar a la D sin cambiar el código. Solo cambian el DNS y el certificado.

### 7.4 Proceso de despliegue

- **Al principio, manual y documentado** (`docs/runbooks/deploy.md`): `git pull` → `docker compose build` → `migrate` (como comando separado, **antes** de arrancar la versión nueva) → `docker compose up -d` → comprobar `/health`.
- Unos segundos de corte son aceptables con un solo usuario, así que no hace falta *blue/green*. Las migraciones van siempre hacia delante. Para los cambios destructivos se usa el patrón *expand/contract* (añadir, migrar los datos y eliminar en un despliegue posterior).
- **Después**: un workflow de GitHub Actions que construye la imagen, la publica en GHCR (privado) y despliega por SSH con una clave restringida a ese comando.
- Entornos: **local** (Docker Compose) y **producción**. **Sin staging**: con un solo usuario, el coste de mantenerlo supera su beneficio. Se compensa con tests y con migraciones probadas en local sobre una copia **ficticia**.

---

## 8. (h) Plan por fases

Tamaños relativos (S, M, L, XL). No pongo días porque no conozco tu ritmo y una cifra inventada daría una precisión falsa. Cada fase termina con: tests en verde en CI, el README de los módulos afectados, los ADR de las decisiones tomadas y `docs/dependencias.md` actualizado.

### Fase 0 — Base del repositorio, CI y CLAUDE.md · tamaño S

- **Alcance**
  - pnpm workspaces (`apps/web`, `apps/api`, `packages/shared`).
  - `tsconfig` base estricto (`strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`).
  - Todo en ESM. ESLint + Prettier y Vitest.
  - `compose.yaml` con PostgreSQL.
  - API con solo `/api/v1/health`, el gestor de errores (RFC 9457), la configuración validada, pino y el ejecutor de migraciones con una primera migración (extensiones `unaccent` y configuración `es_unaccent`).
  - Web con Vite + React + Tailwind y una página vacía.
  - `packages/shared` con la utilidad de importes (céntimos ↔ texto) y sus tests.
  - CI: instalación con el lockfile congelado, lint, typecheck, tests contra PostgreSQL como servicio y build.
  - Comprobación en CI de que **no se modifica ninguna migración existente** (`git diff` contra `main` de `db/migrations/`).
  - `.gitignore` de datos, `.env.example`, `CLAUDE.md` actualizado con los comandos reales, ADR 0001–0005 (monorepo, Express, Kysely, sesiones, importes en céntimos) y `docs/dependencias.md`.
  - Proteger `main` en GitHub (exigir la CI).
- **Terminado cuando**
  - Un clon limpio arranca siguiendo el README en menos de 15 minutos.
  - `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pasan en local y en CI.
  - Un test verifica el formato de error y otro verifica `/health`.
  - Un PR que modifica una migración existente hace fallar la CI.
- **Riesgos**
  - Pulir las herramientas sin fin. Mitigación: limitar el tiempo; lo que no haga falta en la fase 1, no se configura.
  - Incompatibilidades entre ESM y CJS y la nueva configuración de Tailwind v4.
- **Conceptos para la entrevista**
  - Workspaces y resolución de dependencias.
  - ESM frente a CJS.
  - Qué garantiza cada paso de la CI (lint ≠ typecheck ≠ tests).
  - Lockfiles e instalaciones reproducibles.
  - Configuración *12-factor*.
  - Qué es un ADR y por qué existe.
  - Migraciones versionadas e inmutables.

### Fase 1 — Autenticación + cuentas, categorías y movimientos + balance mensual y gráficos · tamaño L

- **Alcance**
  - **1a. Autenticación**
    - Script `create-user`.
    - Login, logout, sesión, reautenticación y cambio de contraseña.
    - CSRF, límite de peticiones en el login y `audit_events`.
    - Pantallas de login y de sesiones abiertas.
  - **1b. Libro real**
    - Cuentas, categorías (con categorías iniciales opcionales), movimientos (alta manual, edición, confirmación y filtros) y transferencias.
    - Correspondencia entre las tarjetas de Wallet y las cuentas: la tabla existe desde ahora y su interfaz llega en la fase 2.
    - Conciliación de saldo (§2.3).
  - **1c. Informes**
    - Balance mensual (ingresos, gastos y neto), desglose por categoría y saldo por cuenta.
    - Gráficos con Recharts: barras de ingresos y gastos por mes, línea de saldo a fin de mes y barras por categoría.
  - Todo **en local**; sin desplegar todavía.
- **Terminado cuando**
  - Hay tests de:
    - Conversión y formato de importes (tabla con decimales, miles y negativos).
    - Saldo: el saldo inicial, los ingresos y gastos confirmados y las transferencias de entrada y salida, **sin que las transferencias cuenten como gasto**.
    - Pertenencia de cada movimiento a su mes.
    - Las restricciones de la base de datos (un movimiento confirmado incompleto falla; una categoría de ingreso en un gasto falla).
    - La conciliación.
    - Los **permisos**: todas las rutas sin sesión → 401; sin CSRF → 403; el login limitado → 429.
  - Prueba manual: alta, edición y confirmación de movimientos y gráficos de 12 meses con datos **ficticios** de una semilla.
  - Existen los ADR de sesiones frente a JWT y de CSRF.
- **Riesgos**
  - Errores sutiles de autenticación. Mitigación: tests de permisos y la checklist de OWASP.
  - Cookies `Secure` en `http://localhost` con Safari [VERIFICAR; si hace falta, HTTPS local con mkcert].
  - Que se cuelen números decimales (`Number(input)`). Mitigación: todo pasa por la utilidad de importes compartida.
  - Que los gráficos se coman el tiempo. Mitigación: 3 gráficos y ninguno más.
- **Conceptos para la entrevista**
  - Hash frente a cifrado; Argon2id y sus parámetros; por qué los tokens aleatorios se guardan con SHA-256 y las contraseñas con un hash lento.
  - Sesiones con estado frente a JWT (revocación).
  - CSRF y `SameSite`; los atributos de las cookies.
  - Restricciones SQL, FK compuestas e índices parciales.
  - Por qué céntimos enteros y no `float`.
  - Capas e inyección de dependencias manual.
  - Diseño REST: códigos de estado, idempotencia de PUT y DELETE, paginación por cursor frente a desplazamiento.
  - Caché e invalidación con TanStack Query.

### Fase 2 — Despliegue + PWA + registro rápido + atajo de iPhone · tamaño L

- **Alcance**
  - **2a. Spike de iOS (primero, como máximo 1–2 días)**
    - Desplegar lo mínimo: `/health`, un endpoint de ingesta que solo registra en el log y una PWA con push.
    - Pasar T1–T3 y T7–T9 **antes** de construir el resto. Este módulo depende de que esto funcione.
  - **2b. Producción**
    - VPS, Caddy y dominio.
    - Copias con restic y una **restauración probada**.
    - Monitorización de disponibilidad y de las copias.
    - Runbooks.
  - **2c. PWA**
    - Manifiesto, iconos, *service worker* (`injectManifest`), suscripción a push, notificación de prueba y contador del icono.
  - **2d. Atajo**
    - Tokens de dispositivo (crear, listar y revocar).
    - `/ingest/wallet-transactions` con idempotencia, marcas y huella.
    - Correspondencia de tarjetas, bandeja de pendientes y formulario rápido.
  - **2e.** `docs/atajo-iphone.md` con la configuración paso a paso y los resultados del protocolo §5.10.
- **Terminado cuando**
  - El protocolo T1–T15 está pasado y documentado, con la versión de iOS.
  - Se ha hecho una restauración completa de una copia en una base de datos temporal.
  - Las cabeceras de seguridad están verificadas (CSP sin errores en la consola).
  - Un token revocado recibe un 401 y el atajo muestra la notificación local.
  - Hay tests de la ingesta: idempotencia (la misma clave → 200 y una sola fila), huella, marcas, conversión de importes con los ejemplos **reales** de T3 (anonimizados) y permisos del token (no puede leer `/movements`).
  - Un gasto manual se registra en menos de 15 s desde el iPhone.
- **Riesgos**
  - **El mayor del proyecto: el comportamiento de iOS.** Mitigación: el spike 2a va primero.
  - Que el enlace profundo de la notificación no funcione. Mitigación: §5.7.
  - Pérdida de suscripciones push.
  - El trabajo de mantener un VPS.
  - Que la sesión de la PWA expire antes de lo esperado.
- **Conceptos para la entrevista**
  - TLS y ACME (Let's Encrypt); proxy inverso.
  - Ciclo de vida de un *service worker*.
  - Protocolo Web Push (servicio de push, VAPID y cifrado).
  - Limitaciones de las PWA en iOS.
  - Claves de idempotencia (el patrón de Stripe) frente a la deduplicación por huella.
  - Tokens *bearer* frente a cookies; permisos de mínimo privilegio.
  - Modelo de amenazas; copias 3-2-1, RPO y RTO.

### Fase 3 — Importación del Excel + presupuesto, proyección, metas, escenarios, comprobaciones y comparativa · tamaño XL (se divide en tres)

- **Antes de empezar:** resolver la lista [A CONFIRMAR] de `plantilla-excel.md` §13 y la decisión sobre la columna «Tipo de registro».
- **Alcance**
  - **3a. Importación**
    - Spike de la librería de Excel (§4.2).
    - Fixture ficticia hecha a mano en Excel, con los resultados esperados calculados a mano.
    - Lectura, validación de los 4 niveles, vista previa, correspondencia de categorías, confirmación, fotos e idempotencia.
  - **3b. Cálculos** (funciones puras): presupuesto, proyección, metas, escenarios y checks, con sus endpoints.
  - **3c. Interfaz**: dashboard del plan (indicadores y 3 gráficos) y comparativa entre plan y realidad.
- **Terminado cuando**
  - Hay tests:
    - Del importador, para cada código del catálogo de problemas.
    - De idempotencia (el mismo archivo dos veces; el mismo contenido guardado otra vez; un contenido distinto sustituye a la foto anterior).
    - De los cálculos contra los valores esperados de la fixture.
    - **De regresión de los 4 errores de la plantilla** (un evento nuevo se proyecta; el total y el check usan el mismo predicado…).
    - De los invariantes (`M = I − G`, roll-forward).
    - De la comparativa (pendientes aparte, transferencias excluidas).
  - Una revisión del esquema confirma que **ninguna tabla guarda resultados calculados**.
  - Importar la plantilla real (en local, **sin hacer commit de nada**) da `PASS` o diferencias explicadas.
- **Riesgos**
  - Ambigüedades de la plantilla. Mitigación: §13 resuelta antes de empezar.
  - Peculiaridades de la librería (fechas, fórmulas compartidas).
  - El tamaño de la fase. Mitigación: entregar 3a, 3b y 3c por separado.
  - Que se cuele un dato real en la fixture.
- **Conceptos para la entrevista**
  - Análisis seguro de archivos no fiables (zip bombs, XXE, no evaluar nada).
  - Entrada frente a derivado (normalización y fuente única de verdad).
  - Funciones puras y tests de tabla.
  - Idempotencia por hash del contenido.
  - El patrón vista previa/confirmación (*staging*).
  - Transacciones y bloqueos consultivos.
  - Aritmética entera y redondeo.

### Fase 4 — Tareas con recordatorios · tamaño M

- **Alcance**
  - Kanban de 4 columnas, arrastrar y reordenar (dnd-kit) y el menú «Mover a…».
  - Fecha límite, tiempo dedicado (cronómetro o anotación manual [DECIDIR]) y recordatorios por push.
  - Planificador de 60 s.
- **Terminado cuando**
  - Hay tests:
    - Del reordenamiento: posiciones consecutivas y sin duplicados tras mover dentro de una columna y entre columnas, con la restricción diferible.
    - De que un recordatorio se envía **una sola vez**, incluso con un reinicio de por medio (`sent_at` y la reclamación con `SKIP LOCKED`).
    - Del cambio de horario de marzo y octubre.
    - De que solo puede haber un cronómetro en marcha.
  - Arrastrar funciona en la PWA del iPhone y con el teclado.
- **Riesgos**
  - Arrastrar y soltar en iOS en modo *standalone*.
  - Recordatorios perdidos si el host se duerme (mitigado por la elección del despliegue).
  - Errores de zona horaria.
- **Conceptos para la entrevista**
  - Estrategias de ordenación (renumerar enteros frente a índices fraccionarios).
  - Restricciones diferibles.
  - Planificador por sondeo frente a colas.
  - Entrega «al menos una vez» frente a «exactamente una vez».
  - `timestamptz` y el cambio de horario.
  - Accesibilidad de arrastrar y soltar.

### Fase 5 — Notas con etiquetas · tamaño S–M

- **Alcance**
  - CRUD de notas en Markdown (un `textarea` con vista previa, sin editor WYSIWYG).
  - Etiquetas N:M que no distinguen mayúsculas.
  - Búsqueda de texto completo en español sin acentos, con fragmentos resaltados, y filtro por etiqueta.
- **Terminado cuando**
  - Hay tests:
    - De la búsqueda: lematización («presupuestos» → «presupuesto»), acentos y ranking.
    - De XSS: `<script>` e `<img onerror>` en Markdown se muestran inertes.
    - De las etiquetas: deduplicación por mayúsculas y sustitución del conjunto.
- **Riesgos**
  - XSS.
  - Que se espere encontrar palabras a medias, algo que la búsqueda de texto completo no hace sin `:*` o `pg_trgm`.
  - Que el host no permita `unaccent`.
- **Conceptos para la entrevista**
  - Relaciones N:M y tablas intermedias.
  - `tsvector`, `tsquery`, índices GIN y columnas generadas.
  - Ranking de resultados.
  - XSS y CSP.

### Fase 6 (opcional) — Contenido del portfolio · tamaño M

- **Alcance (propuesta)**
  - Editar el contenido (proyectos, textos) en el backoffice y **publicarlo con un commit** de un archivo JSON o Markdown en el repositorio Portfolio-v2 mediante la API de GitHub. GitHub Pages lo reconstruye.
  - **El backoffice sigue siendo privado**: el portfolio nunca le hace peticiones en tiempo de ejecución.
- **Terminado cuando**
  - La publicación es explícita (un botón) y muestra antes las diferencias.
  - Se usa un *fine-grained token* limitado a ese repositorio con `contents:write`.
  - Ningún dato que no sea del portfolio puede salir: hay un esquema de salida cerrado y un test.
- **Riesgos**
  - Acoplamiento con la estructura del portfolio.
  - Que se filtre el token de GitHub.
- **Conceptos para la entrevista**
  - Generación estática frente a contenido en tiempo de ejecución.
  - Tokens de mínimo privilegio.
  - El contenido como datos.

---

## 9. (i) Preguntas abiertas (te corresponde decidir)

Cada pregunta incluye mi recomendación (**R**) para que puedas decidir rápido.

**Plantilla y plan**
1. ¿Añades la columna I «Tipo de registro» a la plantilla? **R:** sí (§3.3).
2. ¿Qué estados cuentan en el plan base? **R:** la tabla de `plantilla-excel.md` §6.1 (excluye Potencial, No activo, Pausado e Histórico).
3. ¿Qué relación hay entre «Impacto base» e «Incluir 12M»? ¿Un evento «Escenario» se proyecta?
4. ¿El mes 1 de la proyección es el mes del plan o el siguiente? ¿Puede haber varias filas «Saldo de ahorro»?
5. Las columnas de la hoja «Escenarios» y cómo afecta el pago puntual a la caja libre.
6. ¿Algún «Objetivo» de las metas es una fórmula calculada (fondo de emergencia)? Si lo es, la app necesita esa regla explícita.
7. ¿Hay gastos irregulares expresados en € (no en €/mes) en el Presupuesto? ¿Cómo se convierten a cantidad mensual?
8. ¿Se aceptan valores fijos en Presupuesto · Mensual? **R:** no; se exige una referencia.
9. Si un mes no tiene plan importado, ¿se aplica el último? **R:** sí, indicándolo.
10. ¿Los eventos puntuales cuentan en la comparativa? **R:** en una fila aparte.
11. ¿`.xlsm` o `.xlsx`? **R:** `.xlsx`.
12. ¿Se guarda el archivo original subido? **R:** no.

**Finanzas reales**
13. ¿Los pendientes cuentan en los saldos y en la comparativa? **R:** no; se muestran aparte.
14. Tarjetas de crédito con cargo aplazado: ¿cuenta propia y transferencia en el momento de la liquidación (lo correcto), o asignarlas a la cuenta corriente (lo simple)?
15. ¿Qué significa el origen «importación» en los movimientos reales? ¿Extractos bancarios (CSV o Norma 43)? ¿En qué fase?
16. ¿«Conciliación» es comparar con el saldo del banco (mi propuesta) o casar los pendientes con un extracto importado?

**Atajo y notificaciones**
17. ¿Importe y comercio visibles en la pantalla de bloqueo? **R:** texto genérico por defecto.
18. ¿Probar la mejora de preguntar la categoría en el momento? ¿Confirmar directamente si el pago está completo?
19. Caducidad del token del atajo. **R:** 180 días, con un aviso 14 días antes.

**Seguridad y despliegue**
20. ¿Opción A (VPS) o D (solo Tailscale)? ¿Qué presupuesto mensual aceptas?
21. ¿Segundo factor o passkey? ¿Cuánto debe durar la sesión de la PWA?
22. RPO y RTO, y retención de las copias.
23. **¿El repositorio será público?** Ventaja: sirve de portfolio. Riesgo: expone la arquitectura de un sistema con tus finanzas. La seguridad no debe depender de ocultar el código, pero entonces nunca deben aparecer en él el dominio, la IP ni los datos. **R:** público solo si se cumple esa disciplina; si no, privado.
24. ¿`user_id` en las tablas por si algún día hubiera varios usuarios? **R:** no (YAGNI). El índice `users ((true))` documenta la decisión.

**Producto**
25. Tiempo dedicado a las tareas: ¿cronómetro, anotación manual o ambos?
26. Portfolio: ¿publicar con commits por la API de GitHub (mi propuesta) u otra vía?
27. Interfaz solo en español (sin i18n). **R:** sí.

---

## 10. Fuentes consultadas para los datos marcados como verificados o [VERIFICAR]

- Propiedades de la automatización «Transacción» y el importe 0: [Apple Community](https://discussions.apple.com/thread/256252606), [Matthew Cassinelli](https://matthewcassinelli.com/shortcuts-automations-ios-ipados-transaction-display-stage-manager/), [Automators](https://talk.automators.fm/t/apple-wallet-to-csv/17674), [TravelSpend](https://help.travel-spend.com/shortcuts--automation/ignQHsp85RQDsig2QwVcdX/set-up-apple-pay-automation/7tL8XfjBceg4D7mQeiSK2V) y [finerd](https://help.finerd.ai/apple-pay)
- Enlace profundo de las notificaciones en iOS: [WebKit 263687](https://bugs.webkit.org/show_bug.cgi?id=263687) y [Apple Developer Forums 733604](https://developer.apple.com/forums/thread/733604)
- `crypto.argon2` en Node: [commit «mark argon2 … as stable»](https://github.com/nodejs/node/commit/5402b5e)
- SheetJS en npm frente al CDN: [issue 2961](https://git.sheetjs.com/sheetjs/sheetjs/issues/2961)
- ExcelJS: [Snyk Advisor](https://snyk.io/advisor/npm-package/exceljs)
- Drizzle 1.0: [cambios de la v0 a la v1](https://orm.drizzle.team/docs/v0-v1-changes)
- Arrastrar y soltar: [PkgPulse 2026](https://www.pkgpulse.com/guides/dnd-kit-vs-react-beautiful-dnd-vs-pragmatic-drag-drop-2026)
- web-push: [Snyk Advisor](https://snyk.io/advisor/npm-package/web-push)
- pnpm `minimumReleaseAge`: [ThreatCluster](https://threatcluster.io/cluster/pnpm-11-introduces-default-minimum-release-age-to-mitigate-s-81fce868)
- Calendario de Node: [InfoQ](https://infoq.com/news/2026/06/nodejs-release-changes)
- Hetzner CX23: [VPSBenchmarks](https://www.vpsbenchmarks.com/hosters/hetzner/plans/cx23)
- Pausa de los proyectos gratuitos de Supabase: [Supabase](https://supabase.com/kb/faqs/platform/free-project-pausing)
- Planes de Render: [Render, plataformas gratuitas 2026](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026.md)
- Kysely: [unpkg](https://app.unpkg.com/kysely@0.28.8)
- vite-plugin-pwa: [registro de cambios](https://vite-pwa-org.netlify.app/guide/change-log)
