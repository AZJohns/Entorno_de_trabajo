/**
 * Crea la aplicación Express sin ponerla a escuchar, para poder probarla con supertest.
 *
 * Orden de los middlewares de `/api/v1` (cada uno tiene su motivo):
 * 1. `no-store`: ninguna respuesta se guarda en cachés.
 * 2. Origen: las peticiones que modifican datos solo se aceptan desde PUBLIC_ORIGIN.
 * 3. Cuerpo JSON obligatorio en las peticiones con cuerpo.
 * 4. Sesión: se carga desde la cookie (sin rechazar nada todavía).
 * 5. CSRF: token sincronizado en las peticiones con sesión que modifican datos.
 * 6. Rutas, cada una con su nivel de acceso; las demás (las de negocio, como el libro) exigen una sesión
 *    activa (denegar por defecto).
 */
import express, { type Express } from 'express';
import type { Kysely } from 'kysely';
import type { Logger } from 'pino';
import type { Database } from './db/schema.ts';
import { AppError, errorHandler, notFoundHandler } from './http/errors.ts';
import { createHttpLogger } from './http/logger.ts';
import { noStore, requireJsonBody, requireSameOrigin, securityHeaders } from './http/security.ts';
import type { Clock } from './lib/clock.ts';
import { createAuthModule, getSession, type PasswordBreachChecker } from './modules/auth/index.ts';
import { createFinanceModule } from './modules/finance/index.ts';
import { createImportsModule, UPLOAD_PATH } from './modules/imports/index.ts';
import { createNotesModule } from './modules/notes/index.ts';
import { createNotificationsModule } from './modules/notifications/index.ts';
import { createTasksModule } from './modules/tasks/index.ts';

/** Dependencias externas de la aplicación (se inyectan para poder sustituirlas en los tests). */
export interface AppDependencies {
  readonly logger: Logger;
  readonly db: Kysely<Database>;
  readonly clock: Clock;
  readonly breachChecker: PasswordBreachChecker;
  readonly publicOrigin: string;
  /** Proxies inversos de confianza (0 = ninguno): de ellos depende la IP de cada petición. */
  readonly trustProxyHops: number;
  readonly totpKey: Buffer;
  readonly totpKeyVersion: number;
}

/** Límite del cuerpo JSON: la API no recibe documentos grandes por JSON. */
const JSON_BODY_LIMIT = '100kb';

/** Construye la aplicación con todas sus rutas bajo `/api/v1`. */
export function createApp(deps: AppDependencies): Express {
  const app = express();
  // No se anuncia la tecnología del servidor.
  app.disable('x-powered-by');
  // Sin proxies de confianza, `req.ip` es la dirección de la conexión y se ignora X-Forwarded-For
  // (que cualquier cliente puede falsificar, ASVS 4.1.3). Ver docs/seguridad/limites.md.
  app.set('trust proxy', deps.trustProxyHops > 0 ? deps.trustProxyHops : false);
  app.use(securityHeaders());
  app.use(createHttpLogger(deps.logger));

  const auth = createAuthModule({
    db: deps.db,
    clock: deps.clock,
    totpKey: deps.totpKey,
    totpKeyVersion: deps.totpKeyVersion,
    breachChecker: deps.breachChecker,
    publicOrigin: deps.publicOrigin,
  });

  const api = express.Router();
  api.use(noStore);
  api.use(requireSameOrigin(deps.publicOrigin));
  api.use(requireJsonBody([UPLOAD_PATH]));
  api.use(express.json({ limit: JSON_BODY_LIMIT }));
  api.use(auth.loadSession);
  api.use(auth.verifyCsrf);

  // Comprobación de disponibilidad: pública, sin versión ni detalles internos (ASVS 13.4.5).
  api.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  api.use('/auth', auth.router);

  // Denegar por defecto: cualquier otra ruta exige una sesión activa. Una ruta inexistente responde
  // 401 sin sesión y 404 con ella, así que no se puede descubrir qué rutas existen sin autenticarse.
  api.use(auth.guard('active'));
  const finance = createFinanceModule({
    db: deps.db,
    clock: deps.clock,
    requireReauth: auth.guard('active_reauth'),
    recordExport: async (req, res, counts) => {
      const session = getSession(res);
      if (session === null) throw new AppError('UNAUTHENTICATED', 401, 'Sesión no iniciada');
      await auth.service.recordDataExport(
        session,
        { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
        counts,
      );
    },
  });
  api.use(finance.router);
  api.use(
    createImportsModule({
      db: deps.db,
      clock: deps.clock,
      categories: finance.ledger,
      requireReauth: auth.guard('active_reauth'),
    }).router,
  );
  const notifications = createNotificationsModule({
    db: deps.db,
    clock: deps.clock,
    onChannelError: (channel, error) => {
      deps.logger.error({ err: error, channel }, 'Falló un canal de notificaciones');
    },
  });
  api.use(notifications.router);
  api.use(
    createTasksModule({
      db: deps.db,
      clock: deps.clock,
      notifications: notifications.service,
    }).router,
  );
  api.use(createNotesModule({ db: deps.db, clock: deps.clock }).router);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
