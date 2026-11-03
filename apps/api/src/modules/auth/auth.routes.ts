/**
 * Rutas de autenticación (`/api/v1/auth/...`). Cada ruta declara su nivel de acceso de forma
 * explícita; las que no están aquí las protege la guarda por defecto de la aplicación (`active`).
 */
import { Router, type RequestHandler } from 'express';
import type { AuthRateLimiters } from '../../http/rate-limit.ts';
import type { createAuthController } from './auth.controller.ts';
import type { Access } from './auth.middleware.ts';

type Controller = ReturnType<typeof createAuthController>;
type Guard = (access: Access) => RequestHandler;

export function createAuthRouter(
  controller: Controller,
  guard: Guard,
  limits: AuthRateLimiters,
): Router {
  const router = Router();

  router.post('/login', limits.loginGlobal, limits.loginPerIp, guard('public'), controller.login);
  router.post(
    '/login/second-factor',
    limits.factorPerIp,
    guard('mfa_pending'),
    controller.secondFactor,
  );
  router.post('/unlock', limits.factorPerIp, guard('locked'), controller.unlock);
  router.post('/reauth', limits.factorPerIp, guard('active'), controller.reauth);
  router.post('/logout', guard('session'), controller.logout);
  router.get('/session', guard('session'), controller.session);

  // Acciones sensibles: exigen reautenticación completa reciente (ASVS 7.5.1, 7.5.2).
  router.post('/password', guard('active_reauth'), controller.changePassword);
  router.post('/totp/enroll', guard('active_reauth'), controller.totpEnroll);
  router.post('/totp/confirm', guard('active_reauth'), controller.totpConfirm);
  router.post('/recovery-codes', guard('active_reauth'), controller.recoveryCodes);
  router.get('/sessions', guard('active'), controller.listSessions);
  router.delete('/sessions/:id', guard('active_reauth'), controller.revokeSession);

  return router;
}
