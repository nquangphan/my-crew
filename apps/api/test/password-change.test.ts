import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { seedOwner } from '../src/cli/seed-owner.js';
import { owner, sessions } from '../src/db/schema.js';
import { cookiesFrom, type LoggedInOwner, loginOwner, makeApp, OWNER } from './helpers/owner-session.js';
import { ORIGIN, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const NEW_PASSWORD = 'a brand new passphrase 42';

async function setup(overrides: Parameters<typeof makeApp>[1] = {}) {
  app = await makeApp(ctx.db, overrides);
  await seedOwner(ctx.db, { ...OWNER, reset: false });
  const session = await loginOwner(app);
  return { a: app, session };
}

function change(a: FastifyInstance, session: LoggedInOwner, payload: object, headers = session.headers) {
  return a.inject({ method: 'POST', url: '/v1/auth/password', headers, payload });
}

async function getSession(a: FastifyInstance, cookie: string) {
  return a.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } });
}

async function passwordLogin(a: FastifyInstance, password: string) {
  return a.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { origin: ORIGIN },
    payload: { username: OWNER.username, password },
  });
}

describe('owner password change', () => {
  it('re-hashes with argon2id, keeps the calling device under a new session id and signs out the others', async () => {
    const { a, session } = await setup();
    const other = await loginOwner(a);
    const [before] = await ctx.db.select().from(owner);

    const res = await change(a, session, { currentPassword: OWNER.password, newPassword: NEW_PASSWORD });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ owner: { username: 'owner' }, csrfToken: expect.any(String) });

    const [after] = await ctx.db.select().from(owner);
    expect(after?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(after?.passwordHash).not.toBe(before?.passwordHash);

    // Exactly one session remains: the rotated one returned to the caller.
    expect(await ctx.db.$count(sessions)).toBe(1);
    const rotated = cookiesFrom(res.headers['set-cookie']);
    expect(rotated.map.crew_session).toBeTruthy();
    expect(rotated.map.crew_csrf).toBe(res.json().csrfToken);
    expect(res.json().csrfToken).not.toBe(session.csrfToken);
    expect((await getSession(a, session.cookie)).statusCode).toBe(401);
    expect((await getSession(a, other.cookie)).statusCode).toBe(401);
    const current = await getSession(a, rotated.header);
    expect(current.statusCode).toBe(200);
    expect(current.json().csrfToken).toBe(res.json().csrfToken);

    expect((await passwordLogin(a, OWNER.password)).statusCode).toBe(401);
    expect((await passwordLogin(a, NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('ignores a verification code an older client still sends', async () => {
    const { a, session } = await setup();
    const res = await change(a, session, {
      currentPassword: OWNER.password,
      newPassword: NEW_PASSWORD,
      code: '000000',
    });
    expect(res.statusCode).toBe(200);
    expect((await passwordLogin(a, NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('rejects a wrong current password with a generic 401 and keeps the session', async () => {
    const { a, session } = await setup();
    const wrong = await change(a, session, {
      currentPassword: 'not the password at all',
      newPassword: NEW_PASSWORD,
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toEqual({ code: 'UNAUTHORIZED', message: 'invalid password' });
    expect(wrong.headers['set-cookie']).toBeUndefined();
    expect((await getSession(a, session.cookie)).statusCode).toBe(200);
    expect((await passwordLogin(a, OWNER.password)).statusCode).toBe(200);
    expect(await ctx.db.$count(sessions)).toBe(2);
  });

  it('validates the new password: at least 12 characters and different from the current one', async () => {
    const { a, session } = await setup();
    const short = await change(a, session, { currentPassword: OWNER.password, newPassword: 'short-pass1' });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe('VALIDATION_FAILED');
    const same = await change(a, session, { currentPassword: OWNER.password, newPassword: OWNER.password });
    expect(same.statusCode).toBe(400);
    expect(same.json().error.details).toEqual([
      { path: 'newPassword', message: 'the new password must differ from the current one' },
    ]);
    const missing = await change(a, session, { newPassword: NEW_PASSWORD });
    expect(missing.statusCode).toBe(400);
    // Validation failures change nothing: the session and the current password still work.
    expect(
      (await change(a, session, { currentPassword: OWNER.password, newPassword: NEW_PASSWORD })).statusCode,
    ).toBe(200);
  });

  it('requires a session, an allowed Origin and the CSRF token', async () => {
    const { a, session } = await setup();
    const body = { currentPassword: OWNER.password, newPassword: NEW_PASSWORD };
    const noSession = await change(a, session, body, { origin: ORIGIN });
    expect(noSession.statusCode).toBe(401);
    const noCsrf = await change(a, session, body, { cookie: session.cookie, origin: ORIGIN });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe('CSRF_FAILED');
    const badOrigin = await change(a, session, body, { ...session.headers, origin: 'https://evil.example' });
    expect(badOrigin.statusCode).toBe(403);
    expect((await passwordLogin(a, OWNER.password)).statusCode).toBe(200);
  });

  it('rate limits attempts like login, counting wrong current passwords', async () => {
    const { a, session } = await setup({ loginRateLimitPerMinute: 3 });
    const statuses: number[] = [];
    for (const currentPassword of [
      'wrong password one',
      'wrong password two',
      'wrong password 3',
      OWNER.password,
    ]) {
      const res = await change(a, session, { currentPassword, newPassword: NEW_PASSWORD });
      statuses.push(res.statusCode);
      if (res.statusCode === 429) expect(res.json().error.code).toBe('RATE_LIMITED');
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    expect((await passwordLogin(a, OWNER.password)).statusCode).toBe(200);
  });
});
