import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { seedOwner } from '../src/cli/seed-owner.js';
import { owner, sessions } from '../src/db/schema.js';
import { freshTotp } from './helpers/machines.js';
import {
  cookiesFrom,
  type LoggedInOwner,
  loginOwner,
  makeApp,
  OWNER,
  totpCode,
} from './helpers/owner-session.js';
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
  const seeded = await seedOwner(ctx.db, { ...OWNER, reset: false });
  const session = await loginOwner(app, seeded);
  return { a: app, seeded, session };
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
    const { a, seeded, session } = await setup();
    await ctx.db.update(owner).set({ totpLastStep: null });
    const other = await loginOwner(a, seeded);
    const [before] = await ctx.db.select().from(owner);

    const res = await change(a, session, {
      currentPassword: OWNER.password,
      code: await freshTotp(ctx.db, seeded.totpSecret),
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ owner: { username: 'owner' }, recoveryCodesLeft: 10 });

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

  it('rejects a wrong current password with a generic 401 and does not spend the TOTP code', async () => {
    const { a, seeded, session } = await setup();
    const code = await freshTotp(ctx.db, seeded.totpSecret);
    const wrong = await change(a, session, {
      currentPassword: 'not the password at all',
      code,
      newPassword: NEW_PASSWORD,
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toEqual({
      code: 'UNAUTHORIZED',
      message: 'invalid password or verification code',
    });
    expect(wrong.headers['set-cookie']).toBeUndefined();
    // The session survives a failed attempt, and the unspent code still works.
    expect((await getSession(a, session.cookie)).statusCode).toBe(200);
    const ok = await change(a, session, { currentPassword: OWNER.password, code, newPassword: NEW_PASSWORD });
    expect(ok.statusCode).toBe(200);
  });

  it('rejects a wrong TOTP code with the same generic 401', async () => {
    const { a, seeded, session } = await setup();
    await ctx.db.update(owner).set({ totpLastStep: null });
    const wrong = await change(a, session, {
      currentPassword: OWNER.password,
      code: totpCode(seeded.totpSecret, 5),
      newPassword: NEW_PASSWORD,
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error).toEqual({
      code: 'UNAUTHORIZED',
      message: 'invalid password or verification code',
    });
    expect((await passwordLogin(a, OWNER.password)).statusCode).toBe(200);
  });

  it('refuses a TOTP code that was already used', async () => {
    const { a, seeded, session } = await setup();
    // loginOwner just spent the current step, so re-sending its code is a replay.
    const body = { currentPassword: OWNER.password, newPassword: NEW_PASSWORD };
    const replay = await change(a, session, { ...body, code: totpCode(seeded.totpSecret) });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.message).toBe('invalid password or verification code');

    // A code used for one change cannot be used for the next.
    const code = await freshTotp(ctx.db, seeded.totpSecret);
    const first = await change(a, session, { ...body, code });
    expect(first.statusCode).toBe(200);
    const rotated = cookiesFrom(first.headers['set-cookie']).header;
    const second = await change(
      a,
      session,
      { currentPassword: NEW_PASSWORD, code, newPassword: 'yet another passphrase 7' },
      { cookie: rotated, origin: ORIGIN, 'x-csrf-token': first.json().csrfToken as string },
    );
    expect(second.statusCode).toBe(401);
  });

  it('accepts a recovery code once and consumes it', async () => {
    const { a, seeded, session } = await setup();
    const recoveryCode = seeded.recoveryCodes[2] ?? '';
    const res = await change(a, session, {
      currentPassword: OWNER.password,
      recoveryCode,
      newPassword: NEW_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().recoveryCodesLeft).toBe(9);

    const rotated = cookiesFrom(res.headers['set-cookie']).header;
    const headers = { cookie: rotated, origin: ORIGIN, 'x-csrf-token': res.json().csrfToken as string };
    const reuse = await a.inject({
      method: 'POST',
      url: '/v1/auth/password',
      headers,
      payload: { currentPassword: NEW_PASSWORD, recoveryCode, newPassword: 'yet another passphrase 7' },
    });
    expect(reuse.statusCode).toBe(401);
    const [row] = await ctx.db.select().from(owner);
    expect(row?.recoveryCodeHashes).toHaveLength(9);
  });

  it('validates the new password: at least 12 characters and different from the current one', async () => {
    const { a, seeded, session } = await setup();
    const code = await freshTotp(ctx.db, seeded.totpSecret);
    const short = await change(a, session, {
      currentPassword: OWNER.password,
      code,
      newPassword: 'short-pass1',
    });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.code).toBe('VALIDATION_FAILED');
    const same = await change(a, session, {
      currentPassword: OWNER.password,
      code,
      newPassword: OWNER.password,
    });
    expect(same.statusCode).toBe(400);
    expect(same.json().error.details).toEqual([
      { path: 'newPassword', message: 'the new password must differ from the current one' },
    ]);
    const neither = await change(a, session, { currentPassword: OWNER.password, newPassword: NEW_PASSWORD });
    expect(neither.statusCode).toBe(400);
    // Validation failures spend nothing: the code still changes the password.
    expect(
      (await change(a, session, { currentPassword: OWNER.password, code, newPassword: NEW_PASSWORD }))
        .statusCode,
    ).toBe(200);
  });

  it('requires a session, an allowed Origin and the CSRF token', async () => {
    const { a, seeded, session } = await setup();
    const body = {
      currentPassword: OWNER.password,
      code: await freshTotp(ctx.db, seeded.totpSecret),
      newPassword: NEW_PASSWORD,
    };
    const noSession = await change(a, session, body, { origin: ORIGIN });
    expect(noSession.statusCode).toBe(401);
    const noCsrf = await change(a, session, body, { cookie: session.cookie, origin: ORIGIN });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().error.code).toBe('CSRF_FAILED');
    const badOrigin = await change(a, session, body, { ...session.headers, origin: 'https://evil.example' });
    expect(badOrigin.statusCode).toBe(403);
    expect((await passwordLogin(a, OWNER.password)).statusCode).toBe(200);
  });

  it('rate limits attempts like login, counting wrong passwords and wrong codes', async () => {
    const { a, seeded, session } = await setup({ loginRateLimitPerMinute: 3 });
    const statuses: number[] = [];
    for (const payload of [
      { currentPassword: 'wrong password one', code: '000000', newPassword: NEW_PASSWORD },
      { currentPassword: OWNER.password, code: totpCode(seeded.totpSecret, 5), newPassword: NEW_PASSWORD },
      { currentPassword: 'wrong password two', code: '000000', newPassword: NEW_PASSWORD },
      {
        currentPassword: OWNER.password,
        code: await freshTotp(ctx.db, seeded.totpSecret),
        newPassword: NEW_PASSWORD,
      },
    ]) {
      const res = await change(a, session, payload);
      statuses.push(res.statusCode);
      if (res.statusCode === 429) expect(res.json().error.code).toBe('RATE_LIMITED');
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    expect((await passwordLogin(a, OWNER.password)).statusCode).toBe(200);
  });
});
