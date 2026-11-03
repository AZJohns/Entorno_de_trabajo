/**
 * Controladores HTTP de la autenticación: validan la entrada con los esquemas compartidos, llaman al
 * servicio y dan forma a la respuesta (cookies incluidas). Sin lógica de negocio.
 */
import type { Request, RequestHandler, Response } from 'express';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  reauthRequestSchema,
  secondFactorRequestSchema,
  totpConfirmRequestSchema,
  unlockRequestSchema,
  type LoginResponse,
  type RecoveryCodesResponse,
  type SessionListResponse,
  type SessionResponse,
  type TotpEnrollResponse,
} from '@backoffice/shared';
import { z } from 'zod';
import { clearedSessionCookie, sessionCookie } from '../../http/cookies.ts';
import { AppError } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import { requireSessionContext } from './auth.middleware.ts';
import type { AuthService, IssuedSession, RequestMeta } from './auth.service.ts';
import { csrfTokenFor } from './crypto/tokens.ts';

function meta(req: Request): RequestMeta {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}

export function createAuthController(service: AuthService, clock: Clock) {
  function setSessionCookie(res: Response, issued: IssuedSession): void {
    const seconds = (issued.expiresAt.getTime() - clock.now().getTime()) / 1000;
    res.setHeader('Set-Cookie', sessionCookie(issued.token, seconds));
  }

  /** Responde con el estado de la sesión recién emitida (token nuevo). */
  async function respondWithSession(res: Response, issued: IssuedSession): Promise<void> {
    const session = await service.loadSession(issued.token);
    if (session === null) throw new AppError('INTERNAL_ERROR', 500, 'Sesión no encontrada');
    setSessionCookie(res, issued);
    res.json(await describe(session));
  }

  async function describe(
    session: Parameters<AuthService['describeSession']>[0],
  ): Promise<SessionResponse> {
    const info = await service.describeSession(session);
    return {
      user: { username: info.username },
      stage: info.stage,
      state: session.state,
      csrfToken: info.csrfToken,
      expiresAt: info.expiresAt.toISOString(),
      idleExpiresAt: info.idleExpiresAt.toISOString(),
      reauthenticatedUntil: info.reauthenticatedUntil?.toISOString() ?? null,
    };
  }

  const login: RequestHandler = async (req, res) => {
    const input = loginRequestSchema.parse(req.body);
    const issued = await service.login(input.username, input.password, meta(req));
    setSessionCookie(res, issued);
    const body: LoginResponse = {
      next: 'second-factor',
      csrfToken: csrfTokenFor(issued.token),
      expiresAt: issued.expiresAt.toISOString(),
    };
    res.json(body);
  };

  const secondFactor: RequestHandler = async (req, res) => {
    const input = secondFactorRequestSchema.parse(req.body);
    const issued = await service.completeSecondFactor(requireSessionContext(res), input, meta(req));
    await respondWithSession(res, issued);
  };

  const unlock: RequestHandler = async (req, res) => {
    const input = unlockRequestSchema.parse(req.body);
    const issued = await service.unlock(requireSessionContext(res), input.password, meta(req));
    await respondWithSession(res, issued);
  };

  const reauth: RequestHandler = async (req, res) => {
    const input = reauthRequestSchema.parse(req.body);
    const issued = await service.reauthenticate(
      requireSessionContext(res),
      input.password,
      input.totp,
      meta(req),
    );
    await respondWithSession(res, issued);
  };

  const logout: RequestHandler = async (req, res) => {
    await service.logout(requireSessionContext(res), meta(req));
    res.setHeader('Set-Cookie', clearedSessionCookie());
    // Borra en el navegador lo que haya guardado esta web (ASVS 14.3.1).
    res.setHeader('Clear-Site-Data', '"cache", "cookies", "storage"');
    res.status(204).end();
  };

  const session: RequestHandler = async (_req, res) => {
    res.json(await describe(requireSessionContext(res)));
  };

  const changePassword: RequestHandler = async (req, res) => {
    const input = changePasswordRequestSchema.parse(req.body);
    await service.changePassword(requireSessionContext(res), input, meta(req));
    res.status(204).end();
  };

  const totpEnroll: RequestHandler = async (req, res) => {
    const body: TotpEnrollResponse = await service.startTotpEnrollment(
      requireSessionContext(res),
      meta(req),
    );
    res.json(body);
  };

  const totpConfirm: RequestHandler = async (req, res) => {
    const input = totpConfirmRequestSchema.parse(req.body);
    await service.confirmTotpEnrollment(requireSessionContext(res), input, meta(req));
    res.status(204).end();
  };

  const recoveryCodes: RequestHandler = async (req, res) => {
    const body: RecoveryCodesResponse = {
      codes: await service.regenerateRecoveryCodes(requireSessionContext(res), meta(req)),
    };
    res.json(body);
  };

  const listSessions: RequestHandler = async (_req, res) => {
    const sessions = await service.listSessions(requireSessionContext(res));
    const body: SessionListResponse = {
      sessions: sessions.map((s) => ({
        id: s.id,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
        userAgent: s.userAgent,
        current: s.current,
      })),
    };
    res.json(body);
  };

  const revokeSession: RequestHandler = async (req, res) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const current = requireSessionContext(res);
    await service.revokeSessionById(current, id, meta(req));
    if (id === current.id) res.setHeader('Set-Cookie', clearedSessionCookie());
    res.status(204).end();
  };

  return {
    login,
    secondFactor,
    unlock,
    reauth,
    logout,
    session,
    changePassword,
    totpEnroll,
    totpConfirm,
    recoveryCodes,
    listSessions,
    revokeSession,
  };
}
