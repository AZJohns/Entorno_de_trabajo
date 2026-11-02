# Plan del backoffice personal

- **Estado:** borrador v2 (diseño; todavía no hay código)
- **Fecha:** 2026-11-02 · **Revisión 2:** incorpora las confirmaciones de la plantilla real y tus decisiones sobre §9 (repositorio público, ASVS 5.0 L2 + NIST SP 800-63B, conciliación, despliegue con medición)
- **Documentos relacionados:** [`docs/plantilla-excel.md`](plantilla-excel.md) (contrato del importador), [`docs/seguridad/asvs-l2.md`](seguridad/asvs-l2.md) (matriz de cumplimiento), [`docs/runbooks/github.md`](runbooks/github.md) (configuración del repositorio público), [`SECURITY.md`](../SECURITY.md) y [`CLAUDE.md`](../CLAUDE.md) (reglas de trabajo)

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
| 1 | «Hace falta HTTPS público para el atajo y las notificaciones» | **Solo es cierto en parte** (la fase 2 empieza con la opción privada y mide; §7). El atajo sí necesita llegar al servidor. Las notificaciones push **no**: el servidor solo hace conexiones salientes al servicio de push de Apple. La PWA y el *service worker* necesitan HTTPS con un certificado válido, no necesariamente público. Existe una alternativa sin exposición pública (§7.2, opción D) |
| 2 | «Deduplicar envíos repetidos con una clave de idempotencia» | Una clave generada **dentro** del atajo no evita los duplicados cuando iOS ejecuta la automatización dos veces, porque cada ejecución genera una clave distinta. Hacen falta dos mecanismos: la clave, para los reintentos, y una **huella** (tarjeta + importe + comercio + ventana de tiempo) que marque «posible duplicado» sin rechazarlo (§5.5) |
| 3 | Clasificar las filas de «Datos y supuestos» | **RESUELTO:** se añade la columna «Tipo de registro» (plantilla v2; migración en `plantilla-excel.md` §14) |
| 4 | Las comprobaciones (Checks) de la plantilla | En la app, la mitad de ellas **no pueden fallar por construcción** (p. ej., «gasto total = suma de líneas»). Se convierten en invariantes probados por tests, no en comprobaciones visibles para el usuario (`plantilla-excel.md` §9.6) |
| 5 | «Tests de conciliación» | **RESUELTO:** conciliación mensual por cuenta frente al saldo del banco, con un movimiento de ajuste explícito si hay diferencia (§2.3) |
| 6 | Movimientos con origen «importación» | **RESUELTO:** la importación de extractos queda fuera del MVP y el origen `import` se elimina del modelo hasta entonces |
| 7 | `.xlsm` sin macros | **RESUELTO:** se guarda como `.xlsx` |
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
├── SECURITY.md                     # cómo reportar vulnerabilidades en privado
├── LICENSE                         # pendiente de decidir (§9, pregunta 28)
├── .githooks/                      # pre-commit con gitleaks (core.hooksPath, sin dependencias npm)
├── docs/
│   ├── plan.md                     # este documento
│   ├── plantilla-excel.md          # contrato del importador
│   ├── dependencias.md             # registro de dependencias (§4.3)
│   ├── atajo-iphone.md             # configuración paso a paso del atajo (fase 2)
│   ├── adr/                        # 0001-monorepo-pnpm.md, 0002-express.md, …
│   ├── seguridad/                  # asvs-l2.md (matriz), inventario de logs y de criptografía
│   └── runbooks/                   # github.md, despliegue, copia y restauración, rotación de secretos
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
└── .github/                        # workflows/ci.yml, dependabot.yml
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
| stage | text | `CHECK IN ('mfa_pending','full')`. Tras la contraseña, la sesión queda en `mfa_pending` (5 minutos, solo puede llamar a `/auth/login/second-factor`); con el segundo factor se **emite un token nuevo** en `full` (ASVS 7.2.4) |
| created_at, last_seen_at | timestamptz | `last_seen_at` controla la caducidad por inactividad (§6.2) |
| expires_at | timestamptz | NOT NULL (caducidad absoluta) |
| reauthenticated_at | timestamptz | NULL. Última reautenticación completa, para las acciones sensibles (§6.2) |
| revoked_at | timestamptz | NULL |
| user_agent | text | Para listar las sesiones abiertas |

Índice en `expires_at` para la limpieza periódica.

**`totp_authenticators`** (segundo factor obligatorio)
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK `users` ON DELETE CASCADE |
| secret_ciphertext, secret_nonce | bytea | NOT NULL. La semilla **se cifra** (AES-256-GCM) con una clave de la variable de entorno `TOTP_ENCRYPTION_KEY`. No se puede guardar como hash, porque hay que recalcular los códigos. Así, una copia de seguridad o un volcado de la base de datos no bastan para generarlos |
| key_version | smallint | NOT NULL. Permite rotar la clave |
| last_used_step | bigint | NULL. Último paso de 30 s aceptado: **cada código solo vale una vez** (ASVS 6.5.1) |
| confirmed_at | timestamptz | NULL hasta que se verifica el primer código |
| created_at | timestamptz | |

Índice único parcial `(user_id) WHERE confirmed_at IS NOT NULL`: un solo TOTP activo.

**`recovery_codes`** (códigos de recuperación de un solo uso)
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK ON DELETE CASCADE |
| code_hash | text | NOT NULL. 10 códigos de 16 caracteres en base32 de Crockford (80 bits). Como tienen **menos de 112 bits**, se guardan con **Argon2id** y sal, no con SHA-256 (ASVS 6.5.2) |
| used_at | timestamptz | NULL. Un código usado no vuelve a servir |
| created_at | timestamptz | Al regenerarlos, se borran todos los anteriores |

**`webauthn_credentials`** (passkeys; **solo si la evaluación de la fase 2 es positiva**, §6.2): `credential_id` (bytea, único), `public_key`, `sign_count`, `transports`, `name`, `created_at`, `last_used_at`.

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
| action | text | `login.success`, `login.failure`, `mfa.success`, `mfa.failure`, `recovery_code.used`, `reauth.success`, `device_token.created`, `device_token.revoked`, `plan_import.confirmed`, `password.changed`, `totp.changed`, `data.exported`, `authz.denied`… (inventario completo en `docs/seguridad/`, ASVS 16.1.1) |
| entity_type, entity_id | text, uuid | NULL |
| metadata | jsonb | Sin importes, tokens ni contraseñas |

### 2.3 Módulo `finance` — capa real (`ledger`)

**`accounts`**
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id | uuid | PK |
| name | text | NOT NULL; único sobre `lower(name)` `WHERE archived_at IS NULL` |
| type | text | `CHECK IN ('checking','savings','cash')`: corriente, ahorro y efectivo [RESUELTO: no hay tarjetas de crédito; si algún día hacen falta, se deciden en un ADR] |
| currency | char(3) | NOT NULL DEFAULT `'EUR'`, `CHECK (currency = 'EUR')` en el MVP. Admitir otras monedas será una decisión explícita, con su migración |
| opening_balance_cents | bigint | NOT NULL DEFAULT 0. Puede ser negativo (descubierto) |
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
| source | text | `CHECK IN ('manual','shortcut','reconciliation')`. `import` se elimina hasta que existan los extractos bancarios [RESUELTO] |
| reconciliation_id | uuid | NULL. FK `account_reconciliations` ON DELETE CASCADE, `UNIQUE`. Solo en los movimientos de ajuste |
| status | text | `CHECK IN ('pending','confirmed')` |
| flags | text[] | NOT NULL DEFAULT `'{}'`. `CHECK (flags <@ ARRAY['amount_missing','amount_unparsed','merchant_missing','unknown_card','possible_duplicate','foreign_currency'])` |
| wallet_card_id | uuid | FK `wallet_cards`, NULL |
| device_token_id | uuid | FK `device_tokens` ON DELETE RESTRICT, NULL. Los tokens se revocan, no se borran |
| idempotency_key | text | NULL, longitud ≤ 128 |
| raw_payload | jsonb | NULL. Lo que envió el atajo, para diagnosticar problemas de formato. **Se borra al confirmar** (minimización de datos) |
| created_at, updated_at, confirmed_at | timestamptz | |

Restricciones de tabla:
- `CHECK (status = 'pending' OR (amount_cents > 0 AND account_id IS NOT NULL AND (category_id IS NOT NULL OR source = 'reconciliation') AND flags = '{}'))`: un movimiento confirmado siempre está completo y sin incidencias pendientes. Los ajustes de conciliación no llevan categoría: aparecen en una línea propia, «Ajustes de conciliación».
- `CHECK ((source = 'reconciliation') = (reconciliation_id IS NOT NULL))` y `CHECK (source <> 'reconciliation' OR status = 'confirmed')`.
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

**`account_reconciliations`** [RESUELTO: una vez al mes y por cuenta, el saldo calculado se compara con el saldo real del banco]
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| account_id | uuid | FK `accounts` ON DELETE CASCADE |
| month | date | `CHECK (month = date_trunc('month', month))`; `UNIQUE (account_id, month)`: **una por cuenta y mes** |
| as_of | date | Fecha del saldo del banco; `CHECK` de que está dentro de `month` |
| statement_balance_cents | bigint | El saldo que muestra el banco |
| computed_balance_cents | bigint | Saldo calculado **en el momento de conciliar** |
| note | text | |
| created_at | timestamptz | |

- Saldo calculado = `opening_balance + Σ ingresos confirmados − Σ gastos confirmados + Σ transferencias recibidas − Σ transferencias enviadas`, hasta `as_of` incluido.
- **Excepción documentada a «no guardar derivados»**: `computed_balance_cents` no es una caché, sino el **registro histórico** de lo que la app calculó al conciliar. Si después se edita un movimiento de un periodo ya conciliado, la pantalla muestra el saldo calculado actual junto al registrado y avisa de la discrepancia.
- **Ajuste explícito**: si `statement − computed ≠ 0`, en la **misma transacción** se crea un movimiento confirmado con `source = 'reconciliation'`, `kind` según el signo, `amount_cents = |diferencia|`, `booked_on = as_of` y `description` = «Ajuste de conciliación». Así, tras conciliar, saldo calculado = saldo del banco. El ajuste es visible y reversible: borrar la conciliación lo borra en cascada.

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
| record_type | text | `CHECK IN ('income','expense','savings_balance','assumption','emergency_fund_months','goal','scenario','historical','one_off_payment')`. Índice único parcial `(snapshot_id) WHERE record_type = 'emergency_fund_months'` |
| group_label, concept | text | `concept` NOT NULL |
| unit | text | `CHECK IN ('eur_per_month','eur','months')` |
| amount_cents | bigint | NULL |
| quantity_hundredths | integer | NULL, ≥ 0. Meses en centésimas enteras (6 meses = 600), para calcular sin decimales |
| nature | text | CHECK con los 11 valores de la plantilla |
| status | text | CHECK con los 10 valores de la plantilla |
| source_note, note | text | NULL. `source_note` guarda en ISO `YYYY-MM-DD` las celdas que eran fechas |

`CHECK ((unit IN ('eur_per_month','eur') AND amount_cents IS NOT NULL AND quantity_hundredths IS NULL) OR (unit = 'months' AND quantity_hundredths IS NOT NULL AND amount_cents IS NULL))` y `CHECK (amount_cents IS NULL OR amount_cents >= 0)` (todos los importes son positivos).

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
| id, snapshot_id, source_row, concept, note | | |
| nature_label | text | NULL. **Texto libre** (en la plantilla no tiene validación); solo se muestra |
| amount_item_id | uuid | NULL, con FK compuesta como arriba. Fila en `€` o `€/mes` (con `€/mes` = un único pago igual a la cuota) |
| multiplier_item_id | uuid | NULL, con FK compuesta. Fila en `meses` (forma PRODUCT2: cuota × plazo) |
| amount_cents | bigint | NULL, ≥ 0 (literal) |
| status | text | `CHECK IN ('estimated','paid','finished','active','inactive','not_committed')` |
| expected_date | date | NULL |
| include_in_projection | boolean | NOT NULL |

- `CHECK (num_nonnulls(amount_item_id, amount_cents) = 1)`: el importe es una referencia o un literal, nunca las dos cosas.
- `CHECK (multiplier_item_id IS NULL OR amount_item_id IS NOT NULL)`: solo hay multiplicador si hay referencia.
- `CHECK (NOT include_in_projection OR expected_date IS NOT NULL)`.
- `base_impact` **se elimina** [RESUELTO: ninguna fórmula lo leía; la proyección usa solo `include_in_projection` y la fecha].

**`plan_goals`** («Metas»)
| Columna | Tipo | Restricciones y notas |
|---|---|---|
| id, snapshot_id, source_row, name, criterion | | |
| goal_kind | text | `CHECK IN ('fixed_amount','emergency_fund')`. Índice único parcial `(snapshot_id) WHERE goal_kind = 'emergency_fund'` |
| target_item_id / target_cents | uuid / bigint | `fixed_amount`: exactamente uno de los dos. `emergency_fund`: los dos NULL, porque el objetivo lo calcula la app (gastos esenciales × meses objetivo) |
| current_item_id / current_cents | uuid / bigint | `num_nonnulls(…) = 1` |
| contribution_item_id / contribution_cents | uuid / bigint | `num_nonnulls(…) = 1` |

**No hay columna `status`**: en la plantilla, el estado es una columna calculada y la app lo recalcula (`plantilla-excel.md` §9.4).

**`plan_scenarios`** y **`plan_scenario_items`** (un escenario es una lista de filas de Datos)
| Tabla | Columnas | Restricciones |
|---|---|---|
| `plan_scenarios` | `id`, `snapshot_id`, `source_row`, `name` | `UNIQUE (snapshot_id, source_row)` |
| `plan_scenario_items` | `scenario_id`, `snapshot_id`, `plan_item_id`, `role` | `role CHECK IN ('extra_monthly','one_off')`; `PRIMARY KEY (scenario_id, plan_item_id, role)`; FK compuesta `(snapshot_id, plan_item_id) → plan_items` |

El importador traduce `=0` (lista vacía), la referencia directa y `SUM` sobre un rango contiguo a filas de esta tabla. Los escenarios **no** se filtran con `includedInBase`.

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
**No se guarda el archivo binario** [RESUELTO]: las entradas ya quedan en las tablas del plan y así no se acumulan copias del Excel.

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

Índice único `((true)) WHERE ended_at IS NULL`: solo puede haber **un cronómetro en marcha** en toda la aplicación. [RESUELTO] Se admiten **las dos formas**, y las dos se guardan como intervalos: el cronómetro (iniciar y parar, con un único cronómetro activo) y la anotación manual (inicio y fin, o inicio y duración convertida en fin).

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
plan_snapshots 1─* plan_events|plan_goals *─0..1 plan_items
plan_snapshots 1─* plan_scenarios 1─* plan_scenario_items *─1 plan_items
users 1─0..1 totp_authenticators · users 1─* recovery_codes
account_reconciliations 1─0..1 movements (ajuste)
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
  - **S+**: sesión y, además, una **reautenticación completa** (contraseña + TOTP, o passkey) en los últimos 10 minutos (ASVS 7.5.1).
  - **D(scope)**: token de dispositivo con ese permiso.
- **Denegar por defecto**: el router de `/api/v1` exige sesión salvo en una lista explícita de excepciones. Un test recorre todas las rutas registradas y lo comprueba.

**auth**
| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/health` | P | `{ status: "ok" }`. Sin versión ni detalles internos |
| POST | `/auth/login` | P (con límite de peticiones) | `{ username, password }` → 200 `{ next: "second-factor" }` + cookie de sesión en `mfa_pending` |
| POST | `/auth/login/second-factor` | sesión `mfa_pending` (con límite de peticiones) | `{ totp }`, `{ recoveryCode }` o la aserción WebAuthn → 204 + **cookie nueva** en `full` |
| POST | `/auth/logout` | S | Revoca la sesión actual y responde con `Clear-Site-Data` (ASVS 14.3.1) |
| GET | `/auth/session` | S | `{ user, csrfToken, expiresAt, idleExpiresAt }` |
| POST | `/auth/reauth` | S | Reautenticación **completa**: `{ password, totp }` o passkey |
| POST | `/auth/password` | S+ | `{ currentPassword, newPassword }`. Comprueba la lista de contraseñas filtradas y ofrece cerrar las demás sesiones |
| POST | `/auth/totp/enroll` | S+ | Genera una semilla nueva sin confirmar; devuelve la clave y el URI `otpauth://` |
| POST | `/auth/totp/confirm` | S+ | `{ code }`. Activa la semilla nueva y desactiva la anterior; ofrece cerrar las demás sesiones |
| POST | `/auth/recovery-codes` | S+ | Regenera los 10 códigos y los devuelve **una sola vez** |
| GET | `/export` | S+ | Exportación completa en JSON (`Content-Disposition: attachment`) |
| GET / DELETE | `/auth/sessions`, `/auth/sessions/:id` | S | Ver y cerrar las sesiones abiertas |
| GET | `/auth/device-tokens` | S | Lista (prefijo, uso, caducidad) |
| POST | `/auth/device-tokens` | S+ | `{ name, expiresInDays, scopes }` → 201 con el token **en claro una sola vez** |
| DELETE | `/auth/device-tokens/:id` | S+ | Revoca el token (no lo borra) |

**finance: capa real**
| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET, POST | `/accounts` | S | |
| GET, PATCH | `/accounts/:id` | S | |
| POST | `/accounts/:id/archive` | S | 409 si tiene movimientos pendientes |
| GET | `/accounts/:id/reconciliations` | S | Historial con la discrepancia actual, si la hay |
| POST | `/accounts/:id/reconciliations` | S | `{ month, asOf, statementBalanceCents }` → 201 `{ computedBalanceCents, differenceCents, adjustmentMovementId? }`. 409 si ya existe la de ese mes |
| DELETE | `/reconciliations/:id` | S | Borra la conciliación y su ajuste |
| GET, POST | `/categories` | S | |
| PATCH | `/categories/:id` | S | |
| POST | `/categories/:id/archive` | S | |
| GET | `/movements` | S | Filtros: `from`, `to`, `accountId`, `categoryId`, `status`, `kind`, `source` (`manual`, `shortcut` o `reconciliation`), `q`, con cursor |
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
| Presupuesto | Entrada + calculada | Categoría, Concepto, Tipo, Esencial, **referencias** de Mensual y Estado (filas 6 hasta la etiqueta del resumen) | `plan_budget_lines` (+ `plan_category_mappings`) | Anual y % ingreso (un literal ≠ 0 genera un aviso), resumen y nota |
| Eventos y compromisos | Entrada | Concepto, Naturaleza (texto libre), Importe (literal, referencia o cuota × plazo), Estado, Fecha, Incluir 12M y Nota | `plan_events` | «Impacto base», que se elimina en la v2 |
| Metas | Entrada + calculada | Meta, Objetivo (salvo en el fondo de emergencia), Actual, Aportación, Criterio y **Tipo de meta** (v2) | `plan_goals` | Pendiente, Meses y **Estado** (calculados), resumen y nota |
| Escenarios | Calculada con definiciones | A Escenario; C Extra mensual y D Pago puntual como listas de filas (`=0`, referencia o `SUM` de un rango contiguo) | `plan_scenarios` + `plan_scenario_items` | B, E, F, G y H (calculadas) y la nota |
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

**DECISIÓN TOMADA: B** (plantilla v2; pasos exactos en `plantilla-excel.md` §14). Motivo: la inferencia resuelve un problema que no hace falta tener: tú controlas la plantilla. La vista previa se mantiene en cualquier caso, porque sirve para revisar los problemas, las correspondencias de categorías y las diferencias con el mes anterior.

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
2. Se analiza con las cuatro **formas cerradas** de `plantilla-excel.md` §5 (REF, SUMRANGE, PRODUCT2 y ZERO) → una o varias filas de «Datos y supuestos». Nunca se evalúa nada: `SUM(C20:C23)` se convierte en la lista de filas 20–23, y el producto, en la pareja (cuota, plazo), que multiplica la app.
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

- **Plan aplicable a M**: la foto vigente de M. Si no hay, la vigente más reciente anterior a M, indicada claramente («plan de septiembre») [RESUELTO].
- **Plan por categoría**: Σ de las líneas de presupuesto incluidas, según la correspondencia de categorías.
- **Real por categoría**: Σ de los gastos **confirmados** con `booked_on` dentro de M.
- Los movimientos **pendientes** se muestran aparte («N pendientes, X €») y no se reparten por categoría [RESUELTO].
- Las transferencias no aparecen, por construcción.
- Los **ajustes de conciliación** del mes se muestran en una fila propia, «Ajustes de conciliación», porque no tienen categoría.
- Los **eventos puntuales** de M se muestran en una fila propia, «Pagos puntuales previstos», porque en la plantilla no tienen categoría [RESUELTO].
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
| **TOTP (segundo factor)** | Implementación propia con `node:crypto` · otpauth · speakeasy | **Propia** (RFC 6238, HMAC-SHA1, 6 dígitos, paso de 30 s, ventana de ±1 paso) | Son unas 40 líneas que se prueban con los **vectores oficiales del apéndice B de RFC 6238**. speakeasy lleva años sin mantenimiento [VERIFICAR] | Que `last_used_step` impide reutilizar un código. **Sin dependencia de códigos QR**: se muestran la clave y el enlace `otpauth://`, que en iOS abre la app Contraseñas [VERIFICAR] |
| **Passkeys (WebAuthn)** | @simplewebauthn/server + /browser · implementación propia | **@simplewebauthn** (MIT [VERIFICAR]), **solo si T18 confirma** que funciona en la PWA | Verificar las aserciones de WebAuthn a mano es delicado; aquí sí está justificado usar una librería | El soporte en el modo *standalone* de iOS; que el RP ID (el dominio) no cambie entre las opciones D y A (§7.3) |
| **Contraseñas filtradas** | API de rangos de Pwned Passwords (HIBP) · lista local | **API de rangos** con `fetch` nativo (sin dependencia): solo se envían los 5 primeros caracteres del SHA-1 (*k-anonymity*). Además, una **lista local** de las contraseñas más comunes y de palabras del contexto (ASVS 6.2.4, 6.2.11, 6.2.12) | Solo se consulta al fijar o cambiar la contraseña | Si la API no responde, se **rechaza** el cambio y se pide reintentar (fallo seguro, ASVS 16.5.3). `api.pwnedpasswords.com` entra en la lista de destinos salientes permitidos |
| **Escaneo de secretos** | **gitleaks** · trufflehog · solo GitHub secret scanning | **gitleaks** como **binario** (Go, MIT [VERIFICAR]) en un *hook* de pre-commit (`core.hooksPath` → `.githooks/`, sin husky ni lefthook) y en CI con la imagen oficial de contenedor, sobre **todo el historial**. Además, el secret scanning y la *push protection* de GitHub | Con un repositorio público, tres capas: la máquina local, la CI y GitHub | No usar `gitleaks-action` si exige licencia en tu tipo de cuenta [VERIFICAR]. Fijar la versión de la imagen por *digest* |
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
7. **Con la opción de despliegue D (Tailscale, §7)**: app de Tailscale con **VPN On Demand** en «Siempre» para Wi-Fi y para datos móviles. iOS solo permite **una** VPN con On Demand a la vez: si usas otra VPN con On Demand, entra en conflicto.

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
- **Privacidad en la pantalla de bloqueo** [RESUELTO: texto genérico por defecto, «Nuevo pago pendiente»; se puede cambiar en las preferencias]. El contenido del push viaja cifrado de extremo a extremo (RFC 8291), pero la pantalla de bloqueo lo muestra.

### 5.8 Mejora opcional: preguntar el concepto y la categoría en el momento

- El atajo llama a `GET /ingest/catalog`, muestra «Elegir de la lista» y «Pedir entrada» y envía `description` y `categoryId`.
- **Incertidumbres:** si una automatización con «Ejecutar inmediatamente» puede mostrar diálogos interactivos y cómo lo hace (en la pantalla de bloqueo o encima de la app de pago); si es cómodo hacerlo en la caja; y la latencia de dos peticiones.
- [RESUELTO] **Se prueba** en la prueba T13. Mientras tanto, aunque se envíen el concepto y la categoría, el movimiento **entra como pendiente** (una sola ruta de confirmación). Confirmarlo directamente cuando el importe es mayor que 0 y no hay marcas **se decide después de T13** (§9, pregunta 18).

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

Hay que anotar la versión de iOS y el resultado de cada prueba en `docs/atajo-iphone.md`. **Sin datos reales**: el repositorio es público, así que solo se anotan resultados (funciona o no, formato), nunca importes, comercios ni nombres de tarjetas.

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
| T16 | (Opción D) Pago sin haber abierto Tailscale en horas, en Wi-Fi y en datos móviles | El POST llega. Si no llega, se anota como «fallo atribuible a la VPN» (§7.3) |
| T17 | (Opción D) Consumo de batería de Tailscale (Ajustes → Batería) durante 2 semanas | Se anota el porcentaje diario medio (§7.3) |
| T18 | Passkey dentro de la PWA instalada: alta, inicio de sesión y reautenticación, con la app cerrada y abierta | Funciona sin abrir Safari (§6.2) |
| T19 | Autorrelleno del código TOTP desde la app Contraseñas de iOS dentro de la PWA | Se anota si funciona (afecta a la usabilidad de §6.2) |

---

## 6. (f) Seguridad y copias de seguridad

**Estándares de referencia [RESUELTO]**
- **OWASP ASVS 5.0, nivel 2**, para la seguridad de la aplicación.
- **NIST SP 800-63B-4** para las contraseñas, los autenticadores y la reautenticación (nivel AAL2).

La matriz requisito a requisito, con su fase, módulo y test, está en [`docs/seguridad/asvs-l2.md`](seguridad/asvs-l2.md). Este apartado recoge las decisiones; la matriz, la trazabilidad. Cuando no se cumple un requisito al pie de la letra, se indica como **desviación documentada**, con su motivo y su mitigación.

### 6.1 Modelo de amenazas (resumen)

| Activo | Amenaza | Control principal |
|---|---|---|
| Datos financieros | Atacante desde internet (escaneos, fuerza bruta) | Superficie mínima (opción D: ninguna pública), autenticación obligatoria con dos factores, límite de peticiones y PostgreSQL sin exponer |
| Contraseña | Fuerza bruta, relleno de credenciales, contraseña filtrada | Argon2id, lista de contraseñas filtradas y **TOTP obligatorio**: la contraseña sola no basta |
| Segundo factor | Robo de la semilla TOTP (volcado o copia de seguridad) | La semilla se cifra con una clave que no está ni en la base de datos ni en las copias |
| Sesión | Robo de la cookie, CSRF | `HttpOnly`, `Secure`, `SameSite=Lax`, prefijo `__Host-`, token CSRF, comprobación de `Origin` y caducidad corta |
| Token del atajo | Filtración (iCloud, captura de pantalla) | Permiso mínimo, guardado como hash, caducidad, revocación (que exige reautenticación) y `last_used_at` |
| Copias de seguridad | Filtración o borrado | Cifrado en el cliente, almacenamiento de solo añadir, 3-2-1 y restauración probada |
| **Repositorio público** | Fuga de secretos, datos, dominio o IP en el código o en el historial | Reglas de `CLAUDE.md`, gitleaks en pre-commit y en CI sobre todo el historial, secret scanning y *push protection* de GitHub, solo fixtures ficticias y configuración por variables de entorno |
| Dependencias | Paquete comprometido | Pocas dependencias, lockfile, `minimumReleaseAge`, sin `postinstall`, Dependabot y plazos de corrección (§6.2) |
| Teléfono robado | Acceso a la PWA con la sesión abierta | Bloqueo del iPhone, inactividad de 1 h, reautenticación para las acciones sensibles y revocación de sesiones desde otro dispositivo |

### 6.2 Controles

**Autenticación (NIST AAL2 · ASVS V6)**
- **Dos factores obligatorios**: contraseña + **TOTP** (RFC 6238; 6 dígitos; 30 s). **No existe ninguna sesión completa sin segundo factor.** El script `create-user` da de alta la contraseña **y** el TOTP a la vez: muestra una sola vez el enlace `otpauth://` y los códigos de recuperación.
- **Códigos de recuperación**: 10, de un solo uso, de 80 bits y guardados con Argon2id (ASVS 6.5.2). Regenerarlos invalida los anteriores.
- **Cada código TOTP vale una sola vez** (`last_used_step`, ASVS 6.5.1). Se acepta el paso actual y el anterior para tolerar el desfase de reloj (RFC 6238 §5.2). **Desviación documentada** frente a una lectura estricta de ASVS 6.5.5 (vida máxima de 30 s): en el peor caso, un código vale hasta 60 s. Mitigación: los códigos son de un solo uso y el número de intentos está limitado.
- **Passkey** (WebAuthn, un autenticador multifactor resistente al *phishing*): **se evalúa en la fase 2** (prueba T18). Si funciona dentro de la web app de pantalla de inicio de iOS, se ofrece **como alternativa** al par contraseña + TOTP, con el TOTP siempre disponible como respaldo. Hay que verificar cómo trata NIST SP 800-63B-4 las passkeys sincronizadas en AAL2 [VERIFICAR].
- **Contraseña** (NIST 800-63B-4 y ASVS 6.2):
  - Mínimo 15 caracteres. NIST permite 8 cuando la contraseña forma parte de un sistema multifactor; se eligen 15 porque ASVS lo «recomienda encarecidamente».
  - Se admiten al menos 64 caracteres.
  - Sin reglas de composición y sin caducidad periódica.
  - Se permite pegar y usar gestores de contraseñas.
  - Se verifica exactamente como llega, sin recortarla ni cambiar mayúsculas.
  - Al fijarla o cambiarla, se comprueba contra: una lista local de las contraseñas más comunes (al menos 3.000, ASVS 6.2.4), una lista documentada de **palabras del contexto** (nombre de la app, usuario, dominio; ASVS 6.1.2 y 6.2.11) y la API de rangos de **Pwned Passwords** (ASVS 6.2.12).
- **Hash**: Argon2id con parámetros iguales o superiores a los mínimos de OWASP; formato PHC.
- **Recuperación** (ASVS 6.4):
  - No hay recuperación por correo ni preguntas secretas.
  - Si se pierde el TOTP: código de recuperación.
  - Si se pierde todo: un script en el servidor. Exige acceso SSH, que equivale a la verificación de identidad del alta (ASVS 6.4.4). El restablecimiento de la contraseña **no desactiva el TOTP** (ASVS 6.4.3).
- **Defensa contra la fuerza bruta** (documentada, ASVS 6.1.1):
  - Login: 5 intentos por IP cada 15 minutos, más una espera creciente global.
  - Segundo factor: 5 intentos por sesión `mfa_pending`; después, la sesión se revoca y hay que volver a empezar.
  - **Sin bloqueo de cuenta**: con un solo usuario, el bloqueo sería una denegación de servicio contra uno mismo.
- **Vías de autenticación documentadas** (ASVS 6.1.3 y 6.3.4):
  1. Contraseña + TOTP.
  2. Contraseña + código de recuperación.
  3. Passkey, si se adopta.
  4. Script en el servidor (recuperación).

  El token de dispositivo **no** es una vía de acceso a la app: solo permite llamar a `/ingest/*`.
- Sin cuentas por defecto (ASVS 6.3.2) y sin endpoint de registro.

**Sesiones (ASVS V7) — duración justificada**

| Parámetro | Valor | Justificación |
|---|---|---|
| Caducidad absoluta | **24 h** | NIST SP 800-63B-4 para AAL2: la caducidad absoluta *SHOULD* no superar las 24 h (verificado en la página de AAL de NIST). Una vez al día se repite el inicio de sesión completo |
| Caducidad por inactividad | **1 h** | Valor de AAL2 según fuentes secundarias [VERIFICAR en el texto de NIST: `pages.nist.gov` no fue accesible desde esta sesión]. Al expirar, hay que **reautenticarse por completo** (passkey, o contraseña + TOTP) |
| Usabilidad en la PWA | — | El flujo crítico (el pago con Wallet) **no depende de la sesión**: el atajo usa su token. La sesión solo se pide al abrir la bandeja. Con una passkey (Face ID) o con el autorrelleno de la contraseña y del código desde la app Contraseñas de iOS, reautenticarse cuesta unos segundos. Se comprueba en T18 y T19 |
| Si T18 **y** T19 fallan | inactividad de 8 h como máximo | **Desviación documentada** (ASVS 7.1.1 exige justificar las desviaciones de NIST). Motivos: un solo usuario; dispositivo personal con bloqueo biométrico; la PWA tiene sus propias cookies, separadas de Safari; las acciones sensibles exigen reautenticación; la caducidad absoluta sigue siendo de 24 h. Se decide en la fase 2 (§9, pregunta 33) |
| Sesiones simultáneas | Como máximo 5; al abrir la sexta, se cierra la más antigua | ASVS 7.1.2 |
| Ver y cerrar sesiones | Lista en Ajustes; cerrarlas exige reautenticación | ASVS 7.5.2 |
| Cambio de factor | Al cambiar la contraseña, el TOTP o las passkeys, se ofrece cerrar las demás sesiones | ASVS 7.4.3 |
| Salir | Botón visible en todas las pantallas; `Clear-Site-Data` y borrado de la caché de TanStack Query | ASVS 7.4.4 y 14.3.1 |

**Rotación del token**: la sesión recibe un token nuevo al pasar de `mfa_pending` a `full` **y en cada reautenticación** (ASVS 7.2.4).

**Reautenticación completa** (en los últimos 10 minutos; ASVS 7.5.1): crear **o revocar** tokens de dispositivo, **exportar datos**, cambiar la contraseña, cambiar el TOTP, regenerar los códigos de recuperación, añadir o eliminar passkeys, cerrar otras sesiones y subir el Excel del plan.

**Cookies y CSRF**
- Cookie `__Host-sid`: `HttpOnly; Secure; SameSite=Lax; Path=/` (ASVS 3.3).
- Token CSRF sincronizado en la cabecera `X-CSRF-Token` y comprobación de `Origin` / `Sec-Fetch-Site` (ASVS 3.5.1). Sin `csurf`.
- Por qué `Lax` y no `Strict`: con `Strict`, una navegación iniciada fuera de la app (desde una notificación) podría llegar sin la cookie [VERIFICAR en el dispositivo].

**Límite de peticiones**: login y segundo factor (arriba); ingesta, 30 por minuto por token; resto de la API, 300 por minuto (ASVS 2.4.1).

**SSRF en el push** (ASVS 1.3.6): el `endpoint` de una suscripción lo envía el cliente. Solo se aceptan URL `https` de los hosts de los servicios de push conocidos (Apple, Google, Mozilla), tanto al suscribirse como al enviar. Así, nadie puede usar el servidor para hacer peticiones a la red interna.

**Autorización**: denegar por defecto (§2.10). Los tokens de dispositivo solo sirven en `/ingest/*`. Un test por cada combinación de credencial y ruta. Las denegaciones se registran (ASVS 16.3.2).

**Entradas y salidas**
- Zod en todas las fronteras, con esquemas **estrictos** que rechazan los campos desconocidos (protección contra la asignación masiva, ASVS 15.3.3).
- Kysely parametriza las consultas. `sql.raw` está prohibido salvo justificación.
- React escapa la salida; Markdown sin HTML crudo; `ts_headline` se trata como texto.
- Para los mapas internos con claves que vienen del usuario se usan `Map` o `Object.create(null)` (contaminación de prototipos, ASVS 15.3.6).

**Archivos subidos** (ASVS V5)
- Tipos, extensiones y tamaños, incluido el tamaño descomprimido, documentados en `plantilla-excel.md` §2 (ASVS 5.1.1).
- Solo se aceptan con reautenticación.
- Se comprueban los bytes iniciales y la estructura OOXML; hay límites de descompresión.
- Se rechazan `vbaProject.bin` y los vínculos externos.
- Nada se escribe en disco y no se evalúan fórmulas.

**Cabeceras** (ASVS 3.4) con helmet:
- **HSTS** de 1 año con `includeSubDomains`.
- **CSP** con `default-src 'self'`, sin `unsafe-inline` en los scripts y con `frame-ancestors 'none'`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` y `Permissions-Policy` restrictiva.
- **`Cache-Control: no-store` en todas las respuestas de `/api`** (ASVS 14.3.2).

**Secretos**
- Todos en variables de entorno, validadas al arrancar; `.env.example` sin valores.
- En producción, en un archivo con permisos `600` fuera del repositorio, y copia en el gestor de contraseñas.
- Inventario: `DATABASE_URL`, `VAPID_PRIVATE_KEY`, `TOTP_ENCRYPTION_KEY`, `HIBP_USER_AGENT` y `PUBLIC_ORIGIN`. Solo en el host, nunca en la app: la contraseña de restic y las claves del almacén de copias.
- **Desviación documentada de ASVS 13.3.1** (exige un gestor de secretos tipo *vault*): con un único host y un único operador, un *vault* añadiría infraestructura sin reducir el riesgo real. Si el host se compromete, el atacante obtiene igualmente los secretos en memoria. Mitigación: permisos mínimos, rotación documentada en `docs/runbooks/` y secretos de copias fuera de la app.

**Repositorio público** [RESUELTO]
- El repositorio se trata como público **desde ya**. Ni en el código ni en el historial puede haber secretos, dominios, IP, correos, nombres reales de cuentas ni datos financieros.
- El dominio de producción se configura con `PUBLIC_ORIGIN` y nunca se escribe en el repositorio.
- gitleaks se ejecuta en un *hook* de pre-commit (`.githooks/`) y en la CI. **Antes de hacer público el repositorio**, se pasa sobre **todo el historial** y se revisa a mano.
- En GitHub: secret scanning y *push protection* **a nivel de repositorio** (la de usuario no genera alertas), Dependabot, code scanning y una regla que protege `main`. Los pasos están en [`docs/runbooks/github.md`](runbooks/github.md).
- `SECURITY.md` explica cómo reportar vulnerabilidades en privado.
- La seguridad no depende de ocultar el código: todo control tiene que funcionar aunque el atacante lea el repositorio.

**Logs (ASVS V16)**
- pino en JSON, con `redact` para cookies, `authorization`, contraseñas, códigos TOTP, tokens y cuerpos con datos financieros.
- Marcas de tiempo en UTC. Inventario de los eventos registrados en `docs/seguridad/` (ASVS 16.1.1).
- `audit_events` en la base de datos para los eventos de seguridad: autenticación con éxito y fallida, segundo factor, reautenticación, tokens, exportaciones y denegaciones.
- Los logs se copian a diario al almacén de copias, que es de solo añadir y está fuera del servidor (ASVS 16.4.2 y 16.4.3, cumplimiento **parcial**: no hay un SIEM ni alertas en tiempo real; se acepta el riesgo y se documenta).

**Dependencias (ASVS 15.1)**
- Plazos de corrección de vulnerabilidades: **crítica 7 días · alta 30 días · media 90 días · baja con la siguiente actualización ordinaria**.
- Actualización general mensual.
- SBOM: la exportación del *dependency graph* de GitHub (SPDX), sin herramientas adicionales.

**Servidor**
- SSH solo con clave y **solo a través de Tailscale**; sin `root` ni contraseña.
- Cortafuegos: ningún puerto público en la opción D; 80 y 443 en la A.
- Actualizaciones de seguridad automáticas.
- PostgreSQL solo en la red interna de Docker, con un rol de la app sin privilegios de superusuario.
- **Desviación documentada de ASVS 13.2.1**: la app se conecta a PostgreSQL con contraseña. Mitigación: red interna, rol dedicado de mínimo privilegio y contraseña larga aleatoria rotada según el runbook.

**Cifrado de columnas**: no se usa en general, porque quien compromete el servidor obtiene también la clave. **Excepción**: las semillas TOTP, para que un volcado o una copia de seguridad no basten para generar códigos.

### 6.3 Copias de seguridad [propuesta; confirma los valores en §9, pregunta 22]

| Aspecto | Propuesta |
|---|---|
| **Regla 3-2-1** | **3 copias**: (1) la base de datos de producción; (2) un repositorio restic diario en un almacén de objetos de un **proveedor distinto** del servidor; (3) una copia semanal de ese repositorio (`restic copy`) en un **segundo destino**, que puede ser otro proveedor o un disco externo cifrado en casa [§9, pregunta 32]. **2 soportes o proveedores distintos** y **al menos 1 fuera del servidor**; en realidad son 2 |
| Qué | `pg_dump -Fc` completo y los logs del día |
| Cómo | **restic**: cifrado en el cliente, deduplicación, retención y `restic check`. Licencia BSD-2 [VERIFICAR] |
| Automático | Un temporizador `systemd` del **host**, no la app: la app no tiene credenciales del almacén |
| Protección | Clave del almacén **sin permiso de borrado** o con bloqueo de objetos: quien comprometa el servidor no puede borrar las copias |
| **RPO** (pérdida máxima aceptable) | **24 h**. Lo que entra por el atajo en un día se puede reconstruir con los movimientos del banco. Archivar el WAL sería excesivo aquí |
| **RTO** (tiempo de recuperación) | **4 h**: crear un VPS nuevo, desplegar con el runbook y restaurar la última copia |
| **Retención escalonada** | 7 diarias, 4 semanales, 12 mensuales y 3 anuales (`restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --keep-yearly 3`), aplicada desde una máquina con permisos de borrado, no desde el servidor |
| **Prueba de restauración** | **Al menos una vez por trimestre**: restaurar en una base de datos temporal y comprobar el número de filas por tabla, la suma de importes por mes y un inicio de sesión. Se anota en `docs/runbooks/backup-restore.md` (fecha, copia restaurada, duración, resultado), **sin cifras reales** porque el repositorio es público. Además, `restic check --read-data-subset` cada mes |
| Monitorización | Un servicio de «interruptor de hombre muerto» (p. ej., healthchecks.io) avisa si no llega la señal diaria |
| Claves | La contraseña de restic, en el gestor de contraseñas y en una copia en papel fuera de línea. `TOTP_ENCRYPTION_KEY`, igual: sin ella, una restauración obliga a volver a dar de alta el TOTP |
| Exportación | `GET /export` (JSON, con reautenticación) para tener una copia legible y portabilidad |

---

## 7. (g) Despliegue

### 7.1 Requisitos reales

1. **HTTPS con un certificado de confianza** para la PWA: el *service worker* y el push exigen un contexto seguro.
2. **Que el atajo pueda llegar al servidor** cuando pagas fuera de casa.
3. **Proceso siempre encendido** (planificador de recordatorios y latencia del atajo). Descarta los planes gratuitos que se duermen.
4. PostgreSQL persistente con copias.
5. Conexiones salientes a los servicios de push y a la API de Pwned Passwords.

### 7.2 Opciones

**Corrección importante**: **Tailscale no aloja nada.** Las dos opciones finalistas necesitan el **mismo servidor siempre encendido** (un VPS o un equipo en casa) y el coste es similar. **Lo que cambia es la exposición.**

| Opción | Qué se expone | Coste/mes [VERIFICAR] | A favor | En contra |
|---|---|---|---|---|
| **A. Endurecida (pública)** | 80 y 443 a internet; SSH solo por Tailscale | VPS ~4–6 € (Hetzner CX23 tras las subidas de 2026) + dominio ~1 € + copias < 1 € → **~6–8 €** | Funciona desde cualquier red sin VPN en el iPhone | Superficie pública: escaneos y ataques automatizados. La aplicación tiene que resistirlos (ASVS L2, dos factores, límites de peticiones) |
| **D. Privada (Tailscale)** | **Nada** a internet; todo dentro de la *tailnet* | El mismo servidor, **~6–8 €**. Plan personal de Tailscale gratuito [VERIFICAR] | **Ninguna superficie de ataque pública** | El atajo solo llega con la VPN activa. Hay que medir los fallos y la batería. Dependes de Tailscale |
| B. PaaS + PostgreSQL gestionado | Pública | ~15–30 $ | Sin sistema operativo que mantener | Más caro; los planes gratuitos se duermen. **Descartada** |
| C. Casa + Cloudflare Tunnel | Pública vía Cloudflare | ~0 € + hardware | Sin abrir puertos | **Cloudflare descifra el tráfico**. **Descartada** para datos financieros |
| E. Supabase como base de datos | — | Gratuito: se pausa a los ~7 días y no tiene copias | — | **Descartada** |

**Corrección sobre la opción D**: según la documentación de Tailscale, **VPN On Demand en iOS admite «Siempre» tanto en Wi-Fi como en datos móviles**, así que la VPN puede mantenerse activa sin intervención. Límite: **iOS solo permite una VPN con On Demand activado a la vez**. Si conectas otra VPN, iOS desactiva el On Demand de Tailscale hasta que lo reconectes a mano.

### 7.3 Procedimiento de decisión [RESUELTO: se decide en la fase 2 con datos]

1. **La fase 2 empieza con la opción D.**
2. **Mismo origen en las dos opciones** (recomendación; §9, pregunta 31):
   - Desde el primer día se usa un **dominio propio**. En D, su registro DNS apunta a la IP de Tailscale (100.x) y el certificado se obtiene con **ACME DNS-01**, que no necesita que el servidor sea accesible desde internet.
   - Así, pasar a A **solo cambia el registro DNS y el cortafuegos**. Se mantienen el origen, la PWA instalada, las suscripciones push, las cookies, el RP ID de las passkeys y la URL del atajo.
   - Con un nombre `*.ts.net`, en cambio, el cambio obligaría a reinstalar la PWA, volver a suscribirse al push, dar de alta de nuevo las passkeys y editar el atajo.
   - Hay que verificar el plugin DNS de Caddy (o certbot) para tu proveedor de DNS [VERIFICAR]. El dominio **no se escribe en el repositorio**.
3. **Medición durante 2 semanas de uso real**, anotada en `docs/atajo-iphone.md` **solo con recuentos, sin importes, comercios ni nombres de tarjeta**:
   - `N_wallet`: pagos con Wallet.
   - `N_fallo_vpn`: pagos en los que el atajo mostró la notificación de fallo **y** la causa era la VPN (Tailscale desconectado o la *tailnet* inaccesible).
   - `N_fallo_otro`: fallos por otras causas (sin cobertura, error del servidor…).
   - Batería: porcentaje diario medio de Tailscale en Ajustes → Batería.
   - Conflictos: si has necesitado otra VPN con On Demand.
   - Muestra mínima: **20 pagos con Wallet**. Si en 2 semanas no se llega, se prolonga la medición.
4. **Criterio para pasar a la opción A endurecida** (basta con que se cumpla uno):
   - `N_fallo_vpn / N_wallet > 5 %`, o `N_fallo_vpn ≥ 3` en el periodo.
   - Batería de Tailscale **> 5 %** del consumo diario medio.
   - Necesidad real de otra VPN con On Demand.
   - T8 o T9 (push y apertura de la PWA) fallan por culpa de la VPN.

   Si no se cumple ninguno → **se queda en D**.
5. **Paso a A endurecida (sin cambiar código)**:
   1. Abrir 80 y 443 en el cortafuegos del proveedor y del host.
   2. Apuntar el registro DNS a la IP pública y cambiar a ACME HTTP-01, o mantener DNS-01.
   3. SSH sigue solo por Tailscale.
   4. Comprobar las cabeceras y TLS desde fuera.
   5. Revisar en `asvs-l2.md` las filas marcadas como «sensible a la exposición».
   6. Anotar la decisión en un ADR.

### 7.4 Proceso de despliegue

- **Al principio, manual y documentado** (`docs/runbooks/deploy.md`): `git pull` → `docker compose build` → `migrate` (como comando separado, **antes** de arrancar la versión nueva) → `docker compose up -d` → comprobar `/health`.
- Unos segundos de corte son aceptables con un solo usuario: no hace falta *blue/green*. Las migraciones van siempre hacia delante, con *expand/contract* para los cambios destructivos.
- **Después**: un workflow de GitHub Actions que construye la imagen, la publica en GHCR y despliega por SSH **a través de Tailscale**, con una clave restringida a ese comando. Al ser un repositorio público, los workflows de despliegue **solo** se ejecutan en `main` y nunca con código de PR de terceros.
- Entornos: **local** y **producción**. Sin *staging*.

---

## 8. (h) Plan por fases

Tamaños relativos (S, M, L, XL). No pongo días porque no conozco tu ritmo y una cifra inventada daría una precisión falsa. Cada fase termina con: tests en verde en CI, el README de los módulos afectados, los ADR de las decisiones tomadas y `docs/dependencias.md` actualizado.

### Fase 0 — Base del repositorio, CI, seguridad del repositorio público y CLAUDE.md · tamaño S

- **Alcance**
  - pnpm workspaces (`apps/web`, `apps/api`, `packages/shared`).
  - `tsconfig` base estricto (`strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`); todo en ESM. ESLint + Prettier y Vitest.
  - `compose.yaml` con PostgreSQL.
  - API con solo `/api/v1/health`, el gestor de errores (RFC 9457), la configuración validada, pino con `redact` y el ejecutor de migraciones con una primera migración (`unaccent` y `es_unaccent`).
  - Web con Vite + React + Tailwind y una página vacía.
  - `packages/shared` con la utilidad de importes (céntimos ↔ texto) y sus tests.
  - **CI**:
    - Instalación con el lockfile congelado, lint, typecheck, tests contra PostgreSQL como servicio y build.
    - Comprobación de que **no se modifica ninguna migración existente**.
    - **gitleaks sobre todo el historial** (imagen oficial fijada por *digest*).
    - Permisos mínimos del `GITHUB_TOKEN` (`permissions: contents: read`).
  - **Seguridad del repositorio público**:
    - `.githooks/pre-commit` con gitleaks (`git config core.hooksPath .githooks`, sin dependencias npm).
    - `.gitignore` de datos; `.env.example` sin valores.
    - `SECURITY.md` (ya creado) y `.github/dependabot.yml` (npm, GitHub Actions y Docker).
    - `LICENSE`, en cuanto decidas la licencia (§9, pregunta 28).
  - **Configuración de GitHub** siguiendo [`docs/runbooks/github.md`](runbooks/github.md), **que haces tú en la web**: secret scanning y *push protection* del repositorio, alertas y actualizaciones de seguridad de Dependabot, code scanning (CodeQL, configuración por defecto) y una **regla que protege `main`** exigiendo PR y la CI en verde.
    - Corrección respecto a la v1: GitHub solo permite proteger ramas en repositorios privados con un plan de pago, así que ahora **sí** es posible, porque el repositorio será público.
  - **Antes de hacer público el repositorio**: gitleaks sobre todo el historial + revisión manual de todos los archivos y commits (hoy son pocos).
  - `CLAUDE.md` con los comandos reales.
  - ADR 0001–0006: monorepo, Express, Kysely, sesiones y dos factores, importes en céntimos y repositorio público.
  - `docs/dependencias.md`.
- **Terminado cuando**
  - Un clon limpio arranca siguiendo el README en menos de 15 minutos.
  - `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pasan en local y en CI.
  - Un test verifica el formato de error y otro, `/health`.
  - Un PR que modifica una migración existente hace fallar la CI.
  - Un commit con un secreto de prueba **lo bloquea el *hook*** y, si se fuerza, **lo detecta la CI**. La prueba se hace en una rama desechable con un secreto falso del formato que reconoce gitleaks.
  - gitleaks está limpio sobre todo el historial.
  - La regla de `main` está activa: no se puede fusionar sin la CI en verde.
  - La *push protection* del repositorio, Dependabot y CodeQL están activos (casillas del runbook).
- **Riesgos**
  - Pulir las herramientas sin fin. Mitigación: limitar el tiempo.
  - Falsos positivos de gitleaks. Mitigación: un `.gitleaksignore` revisado y nunca reglas genéricas.
  - Hacer público el repositorio antes de revisar el historial.
- **Conceptos para la entrevista**
  - Workspaces; ESM frente a CJS.
  - Qué garantiza cada paso de la CI.
  - Lockfiles.
  - Configuración *12-factor*.
  - ADR.
  - Migraciones inmutables.
  - **Cadena de suministro**: escaneo de secretos en varias capas, por qué un secreto subido hay que **rotarlo** (no basta con borrarlo del historial), Dependabot, SBOM, permisos mínimos del `GITHUB_TOKEN` y riesgos de `pull_request_target` en repositorios públicos.

### Fase 1 — Autenticación con dos factores + cuentas, categorías y movimientos + balance mensual y gráficos · tamaño L

- **Alcance**
  - **1a. Autenticación (ASVS V6 y V7 · NIST AAL2)**
    - Script `create-user`: contraseña + alta del TOTP + códigos de recuperación.
    - Login en dos pasos (`mfa_pending` → `full`, con un token nuevo).
    - TOTP de uso único, códigos de recuperación, reautenticación completa y cambio de contraseña con comprobación de contraseñas filtradas.
    - Caducidades de 24 h y 1 h; lista y cierre de sesiones; `Clear-Site-Data` al salir.
    - CSRF, límites de peticiones y `audit_events`.
    - Cabeceras (HSTS, CSP, `no-store`).
  - **1b. Libro real**
    - Cuentas (corriente, ahorro y efectivo), categorías, movimientos (alta, edición, confirmación y filtros) y transferencias.
    - **Conciliación mensual con un movimiento de ajuste.**
  - **1c. Informes**: balance mensual, desglose por categoría, saldo por cuenta (con los ajustes en una línea propia) y 3 gráficos.
  - **1d. Exportación** `GET /export` con reautenticación.
  - Todo **en local**.
- **Terminado cuando**
  - Hay tests de:
    - Importes y saldos, con las transferencias fuera de los gastos y los ajustes incluidos en el saldo.
    - Las restricciones de la base de datos.
    - **La conciliación**: una diferencia de 0 no crea ajuste; una positiva crea un ingreso de ajuste; una negativa, un gasto; tras conciliar, saldo calculado = saldo del banco; borrar la conciliación borra el ajuste; no puede haber dos por cuenta y mes; un movimiento editado después produce un aviso de discrepancia.
    - **TOTP**: los vectores de RFC 6238, la reutilización de un código rechazada y la ventana de ±1 paso.
    - Que un código de recuperación vale una sola vez.
    - Las caducidades por inactividad y absoluta, con un reloj simulado.
    - La matriz de **permisos**: todas las rutas sin sesión → 401; en `mfa_pending` → 401; sin CSRF → 403; S+ sin reautenticación → 403; token de dispositivo fuera de `/ingest` → 401/403.
    - Las contraseñas cortas, comunes o filtradas, rechazadas (con un doble de prueba de la API de HIBP).
    - Los límites de peticiones.
  - Las filas de V6, V7 y V8 de `asvs-l2.md` asignadas a la fase 1 están en estado «cumplido» y cada una enlaza a su test.
- **Riesgos**
  - Errores sutiles de autenticación (la matriz ASVS y los tests de permisos los mitigan).
  - Cookies `Secure` en `localhost` con Safari [VERIFICAR; si hace falta, mkcert].
  - El desfase de reloj en el TOTP.
  - Que se cuelen números decimales en los importes.
- **Conceptos para la entrevista**
  - Factores de autenticación y AAL2.
  - TOTP (HMAC, pasos de tiempo, reutilización).
  - Por qué los códigos de recuperación se guardan con Argon2id y los tokens aleatorios de 256 bits con SHA-256.
  - *k-anonymity* en Pwned Passwords.
  - Fijación de sesión y rotación del token.
  - Sesiones con estado frente a JWT; CSRF y `SameSite`.
  - Restricciones SQL; importes en céntimos.
  - Conciliación contable y ajustes explícitos frente a «arreglar» el saldo inicial.

### Fase 2 — Despliegue privado con medición + PWA + registro rápido + atajo de iPhone · tamaño L

- **Alcance**
  - **2a. Spike de iOS (primero; como máximo 1–2 días)**
    - Servidor siempre encendido con la **opción D** (Tailscale), dominio propio y certificado por DNS-01 (§7.3).
    - `/health`, un endpoint de ingesta que solo registra en el log y una PWA con push.
    - Pasar T1–T3, T7–T9 y T16 **antes** de construir el resto.
  - **2b. Producción en D**
    - Copias **3-2-1** automáticas con restic y la **primera prueba de restauración documentada**.
    - Monitorización de disponibilidad y de las copias.
    - Runbooks de despliegue, copia y restauración y rotación de secretos.
  - **2c. PWA**: manifiesto, *service worker*, suscripción a push, notificación de prueba y contador en el icono.
  - **2d. Atajo**
    - Tokens de dispositivo (crear y revocar, ambos con reautenticación).
    - `/ingest/wallet-transactions`, correspondencia de tarjetas, bandeja de pendientes y formulario rápido.
    - Prueba T13 (preguntar el concepto y la categoría en el momento).
  - **2e. Evaluación de passkeys y usabilidad de la sesión**
    - T18 (passkey en la PWA) y T19 (autorrelleno del TOTP).
    - Si T18 funciona: alta de passkeys con @simplewebauthn y su ADR.
    - Si T18 y T19 fallan: decidir la desviación de la inactividad (§6.2).
  - **2f. Medición de 2 semanas y decisión D/A** según el criterio de §7.3, con su ADR.
  - **2g.** `docs/atajo-iphone.md`: configuración paso a paso (sin dominio ni token reales) y resultados de T1–T19 y de la medición, **solo con recuentos**.
- **Terminado cuando**
  - Protocolo T1–T19 pasado y documentado con la versión de iOS.
  - Medición de 2 semanas con al menos 20 pagos, completada y **decisión D/A tomada con el criterio de §7.3**.
  - Primera restauración completa hecha y anotada; la tercera copia (`restic copy`) verificada.
  - Cabeceras verificadas: sin errores de CSP en la consola; HSTS presente.
  - Revocar un token → el atajo recibe 401 y muestra la notificación local.
  - Hay tests de la ingesta (idempotencia, huella, marcas, importes con los formatos **reales** de T3 reescritos con cifras inventadas, permisos del token).
  - Gasto manual registrado en menos de 15 s.
  - Filas de la fase 2 en `asvs-l2.md` actualizadas.
- **Riesgos**
  - **El comportamiento de iOS** (el spike va primero).
  - Que la VPN corte el atajo (la medición y el criterio objetivo lo cubren).
  - Que el plugin DNS-01 no exista para tu proveedor de DNS: cambiar de DNS o usar certbot.
  - Que la passkey no funcione en la PWA: el TOTP sigue disponible.
  - Pérdida de suscripciones push.
  - **Filtrar datos reales en la documentación del dispositivo** (el repositorio es público).
- **Conceptos para la entrevista**
  - Superficie de ataque y redes privadas (WireGuard/Tailscale) frente a exposición pública.
  - ACME HTTP-01 frente a DNS-01.
  - Por qué el **origen** (esquema + host + puerto) determina cookies, *service workers*, push y el RP ID de WebAuthn.
  - Ciclo de vida de un *service worker*; Web Push y VAPID.
  - Passkeys y resistencia al *phishing*.
  - Idempotencia frente a huella.
  - Decisiones basadas en métricas con un criterio fijado **antes** de medir.
  - 3-2-1, RPO y RTO.

### Fase 3 — Importación del Excel + presupuesto, proyección, metas, escenarios, comprobaciones y comparativa · tamaño XL (se divide en tres)

- **Antes de empezar:** migrar tu Excel a la v2 (`plantilla-excel.md` §14) y anotar los textos exactos de las etiquetas de resumen (§13). Las decisiones de diseño de la plantilla ya están resueltas.
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
  - Fecha límite, tiempo dedicado (cronómetro **y** anotación manual, ambos guardados como intervalos) y recordatorios por push.
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

## 9. (i) Preguntas abiertas

Estado tras la revisión 2: **RESUELTA** (con la decisión tomada) o **PENDIENTE** (con mi recomendación **R** y cuándo hay que decidirla).

**Plantilla y plan**

| # | Pregunta | Estado | Decisión o recomendación |
|---|---|---|---|
| 1 | ¿Columna «Tipo de registro»? | RESUELTA | Sí, en la plantilla v2 (`plantilla-excel.md` §7 y §14) |
| 2 | ¿Qué estados cuentan en el plan base? | RESUELTA | La tabla de `plantilla-excel.md` §6.1 (excluye Potencial, No activo, Pausado e Histórico). Los escenarios son la excepción |
| 3 | ¿«Impacto base» frente a «Incluir 12M»? | RESUELTA | «Impacto base» se elimina en la v2; la proyección usa solo Incluir 12M y la fecha |
| 4 | ¿Cuál es el mes 1? ¿Varias filas de saldo? | RESUELTA | Mes 1 = el mes elegido al subir el archivo; los meses pasados se muestran con datos reales. Se admiten varias filas de saldo y se suman |
| 5 | ¿Columnas de Escenarios y cómo se aplica el pago puntual? | RESUELTA | A–H confirmadas; el escenario es una lista de filas de Datos; el pago puntual se resta entero |
| 6 | ¿El objetivo de alguna meta se calcula con una fórmula? | RESUELTA | Sí, el del fondo de emergencia: tipo de meta `emergency_fund`, que calcula la app |
| 7 | ¿Gastos irregulares en €? | RESUELTA | El gasto irregular tiene el Anual escrito a mano: aviso `VALUE_IN_CALCULATED_COLUMN` + paso 6 de la migración |
| 8 | ¿Valores fijos en Presupuesto · Mensual? | RESUELTA | No; se exige una referencia |
| 9 | ¿Un mes sin plan usa el último? | RESUELTA | Sí, indicándolo |
| 10 | ¿Eventos puntuales en la comparativa? | RESUELTA | En una fila aparte |
| 11 | ¿`.xlsm` o `.xlsx`? | RESUELTA | `.xlsx` |
| 12 | ¿Guardar el archivo original? | RESUELTA | No |

**Finanzas reales**

| # | Pregunta | Estado | Decisión o recomendación |
|---|---|---|---|
| 13 | ¿Los pendientes cuentan en los saldos y en la comparativa? | RESUELTA | No; se muestran aparte |
| 14 | ¿Tarjetas de crédito? | RESUELTA | No hay. Cuentas corriente, ahorro y efectivo; si algún día hacen falta, ADR |
| 15 | ¿Origen «importación»? | RESUELTA | La importación de extractos queda fuera del MVP; `import` se elimina del modelo |
| 16 | ¿Qué es la conciliación? | RESUELTA | Una vez al mes por cuenta: saldo calculado frente al del banco, con un ajuste explícito si hay diferencia |
| 29 | ¿El saldo inicial de la proyección (`S0`) debería salir de las cuentas reales? | PENDIENTE (fase 3) | **R:** cuando haya cuentas conciliadas, `S0` = Σ de los saldos calculados de las cuentas a fin del mes anterior al mes 1, mostrando la diferencia con las filas «Saldo de ahorro» del Excel; hasta entonces, las filas del Excel |

**Atajo y notificaciones**

| # | Pregunta | Estado | Decisión o recomendación |
|---|---|---|---|
| 17 | ¿Importes en la pantalla de bloqueo? | RESUELTA | Texto genérico por defecto |
| 18 | ¿Preguntar en el atajo? ¿Confirmar directamente? | RESUELTA la prueba / PENDIENTE la confirmación directa | Se prueba en T13. La confirmación directa se decide después de T13 (fase 2) |
| 19 | ¿Caducidad del token del atajo? | RESUELTA | 180 días, con un aviso 14 días antes |

**Seguridad y despliegue**

| # | Pregunta | Estado | Decisión o recomendación |
|---|---|---|---|
| 20 | ¿Opción A o D? | PENDIENTE (fase 2, con datos) | Se empieza con D, se mide 2 semanas y se aplica el criterio de §7.3 |
| 21 | ¿Segundo factor? ¿Duración de la sesión? | RESUELTA (con dos subpreguntas pendientes) | TOTP obligatorio + códigos de recuperación; 24 h de caducidad absoluta y 1 h de inactividad; reautenticación para las acciones sensibles (§6.2) |
| 22 | ¿RPO, RTO y retención? | PENDIENTE (confirma los valores propuestos) | **R:** RPO 24 h, RTO 4 h, retención 7/4/12/3 y prueba de restauración trimestral (§6.3) |
| 23 | ¿Repositorio público? | RESUELTA | Sí, con las reglas de §6.2 y de `CLAUDE.md` |
| 24 | ¿`user_id` en las tablas? | RESUELTA | No (YAGNI) |
| 28 | ¿Licencia? | PENDIENTE (fase 0, antes de publicar) | **R: MIT.** Sin licencia, el código se puede ver pero no reutilizar legalmente; con MIT, cualquiera puede reutilizarlo citando el aviso de copyright. No afecta a la seguridad |
| 31 | ¿Dominio propio desde el principio, también en D? | PENDIENTE (inicio de la fase 2) | **R:** sí, con DNS-01. Mantiene el mismo origen si se pasa a A (§7.3) |
| 32 | ¿Segundo destino de las copias (la tercera copia)? | PENDIENTE (fase 2) | **R:** un segundo proveedor de almacén de objetos si cuesta menos de ~1 €/mes con este volumen [VERIFICAR]; si no, un disco externo cifrado actualizado cada mes |
| 33 | ¿Desviación de la inactividad si fallan la passkey y el autorrelleno (T18 y T19)? | PENDIENTE (fase 2, tras las pruebas) | **R:** 8 h como máximo, documentada como desviación de NIST (§6.2); la caducidad absoluta de 24 h se mantiene |
| 34 | ¿Adoptar passkeys? | PENDIENTE (fase 2, tras T18) | **R:** sí, si funcionan en la PWA; el TOTP se mantiene como respaldo |
| 35 | ¿Retención de `audit_events` y de los logs técnicos? | PENDIENTE (fase 1) | **R:** `audit_events`, 1 año; logs técnicos, 30 días (y en las copias según su retención) |

**Producto**

| # | Pregunta | Estado | Decisión o recomendación |
|---|---|---|---|
| 25 | ¿Tiempo dedicado a las tareas? | RESUELTA | Cronómetro (uno activo a la vez) y anotación manual, ambos como intervalos |
| 26 | ¿Cómo se publica en el portfolio? | RESUELTA | Commits mediante la API de GitHub a Portfolio-v2 |
| 27 | ¿Interfaz solo en español? | RESUELTA | Sí |

Los números 29–35 son preguntas nuevas de esta revisión (la 30 se fusionó con la 18).

---

## 10. Fuentes consultadas

- OWASP ASVS 5.0 (texto de los requisitos, capítulos V1–V17): [repositorio oficial, carpeta 5.0/en](https://github.com/OWASP/ASVS/tree/master/5.0/en)
- NIST SP 800-63B-4, AAL y reautenticación: [pages.nist.gov/800-63-4/sp800-63b/aal](https://pages.nist.gov/800-63-4/sp800-63b/aal/). La caducidad de 1 h por inactividad solo se ha visto en fuentes secundarias, como [MojoAuth](https://mojoauth.com/glossary/session-timeout) [VERIFICAR]
- Tailscale VPN On Demand en iOS: [documentación de Tailscale](https://tailscale.com/kb/1291/ios-vpn-on-demand)
- GitHub, alertas de secret scanning y *push protection* de usuario frente a la de repositorio: [GitHub Docs](https://docs.github.com/en/code-security/secret-scanning/managing-alerts-from-secret-scanning/about-alerts)
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
- Pausa de los proyectos de Supabase: [Supabase](https://supabase.com/kb/faqs/platform/free-project-pausing)
- Render: [plataformas gratuitas 2026](https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026.md)
- Kysely: [unpkg](https://app.unpkg.com/kysely@0.28.8)
- vite-plugin-pwa: [registro de cambios](https://vite-pwa-org.netlify.app/guide/change-log)
