import {
  ChangePasswordRequest,
  LoginPasswordRequest,
  LoginTotpRequest,
  type SessionResponse,
} from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { assertAllowedOrigin } from '../auth/csrf.js';
import {
  changeOwnerPassword,
  checkPassword,
  clearSessionCookies,
  completeLogin,
  destroySession,
  issueChallenge,
  ownerGuard,
  recoveryCodesLeft,
  SESSION_COOKIE,
  setSessionCookies,
} from '../auth/owner-auth.js';
import { ApiError } from '../errors.js';
import { parseInput, type RouteDeps } from './route-deps.js';

/** Owner login (password, then TOTP or a recovery code), session read, password change and logout. */
export async function authRoutes(app: FastifyInstance, { db, config }: RouteDeps): Promise<void> {
  const loginRateLimit = { rateLimit: { max: config.loginRateLimitPerMinute, timeWindow: '1 minute' } };
  const guard = ownerGuard(db, config);

  app.post('/v1/auth/login', { config: loginRateLimit }, async (request) => {
    assertAllowedOrigin(request, config.allowedOrigins);
    const body = parseInput(LoginPasswordRequest, request.body);
    const row = await checkPassword(db, body.username, body.password);
    return issueChallenge(config.sessionSecret, row.id);
  });

  app.post('/v1/auth/login/totp', { config: loginRateLimit }, async (request, reply) => {
    assertAllowedOrigin(request, config.allowedOrigins);
    const body = parseInput(LoginTotpRequest, request.body);
    const { sessionId, session } = await completeLogin(db, config, {
      challenge: body.challenge,
      code: 'code' in body ? body.code : undefined,
      recoveryCode: 'recoveryCode' in body ? body.recoveryCode : undefined,
    });
    // Rotate: the pre-login session id (if any) never survives a login.
    await destroySession(db, request.cookies[SESSION_COOKIE]);
    setSessionCookies(reply, config, sessionId, session.csrfToken);
    return session;
  });

  app.get('/v1/auth/session', { onRequest: guard }, async (request): Promise<SessionResponse> => {
    const session = request.ownerSession;
    if (!session) throw new ApiError('UNAUTHORIZED', 'login required');
    return {
      owner: { username: session.username },
      csrfToken: session.csrfToken,
      recoveryCodesLeft: await recoveryCodesLeft(db, session.ownerId),
    };
  });

  /**
   * Password change behind the session guard (Origin + CSRF) and the login rate limit, so wrong passwords
   * and codes are throttled like login attempts. Rotates the session: every other device is signed out.
   */
  app.post('/v1/auth/password', { onRequest: guard, config: loginRateLimit }, async (request, reply) => {
    const session = request.ownerSession;
    if (!session) throw new ApiError('UNAUTHORIZED', 'login required');
    const body = parseInput(ChangePasswordRequest, request.body);
    const { sessionId, session: rotated } = await changeOwnerPassword(db, config, session.ownerId, {
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      code: 'code' in body ? body.code : undefined,
      recoveryCode: 'recoveryCode' in body ? body.recoveryCode : undefined,
    });
    setSessionCookies(reply, config, sessionId, rotated.csrfToken);
    return rotated;
  });

  app.post('/v1/auth/logout', { onRequest: guard }, async (request, reply) => {
    await destroySession(db, request.cookies[SESSION_COOKIE]);
    clearSessionCookies(reply, config);
    return reply.status(204).send();
  });
}
