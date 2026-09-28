import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { issueChallenge, verifyOwnerTotp } from '../src/auth/owner-auth.js';
import { seedOwner } from '../src/cli/seed-owner.js';
import { owner, sessions } from '../src/db/schema.js';
import { cookiesFrom, makeApp, OWNER, seedAndLogin, totpCode } from './helpers/owner-session.js';
import { ORIGIN, testConfig, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function passwordStep(a: FastifyInstance, body: object = OWNER) {
  return a.inject({ method: 'POST', url: '/v1/auth/login', headers: { origin: ORIGIN }, payload: body });
}

async function totpStep(a: FastifyInstance, body: object) {
  return a.inject({ method: 'POST', url: '/v1/auth/login/totp', headers: { origin: ORIGIN }, payload: body });
}

describe('seed CLI', () => {
  it('stores an argon2id hash, a TOTP secret and 10 hashed recovery codes', async () => {
    const seeded = await seedOwner(ctx.db, { ...OWNER, reset: false });
    const [row] = await ctx.db.select().from(owner);
    expect(row?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row?.totpSecret).toBe(seeded.totpSecret);
    expect(seeded.recoveryCodes).toHaveLength(10);
    expect(row?.recoveryCodeHashes).toHaveLength(10);
    expect(row?.recoveryCodeHashes).not.toContain(seeded.recoveryCodes[0]);
    expect(seeded.totpUri).toMatch(/^otpauth:\/\/totp\/2P%20Crew:owner\?secret=/);
  });

  it('refuses to overwrite the owner without --reset, and a reset signs every session out', async () => {
    app = await makeApp(ctx.db);
    const session = await seedAndLogin(app, ctx.db);
    await expect(seedOwner(ctx.db, { ...OWNER, reset: false })).rejects.toThrow(/already exists/);
    await seedOwner(ctx.db, { ...OWNER, reset: true });
    expect(await ctx.db.$count(sessions)).toBe(0);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie: session.cookie },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects short passwords', async () => {
    await expect(seedOwner(ctx.db, { username: 'owner', password: 'short', reset: false })).rejects.toThrow();
  });
});

describe('login', () => {
  it('needs the password, then a valid TOTP code, and sets hardened cookies', async () => {
    app = await makeApp(ctx.db);
    const { totpSecret } = await seedOwner(ctx.db, { ...OWNER, reset: false });

    const step1 = await passwordStep(app);
    expect(step1.statusCode).toBe(200);
    expect(step1.headers['set-cookie']).toBeUndefined();

    const step2 = await totpStep(app, { challenge: step1.json().challenge, code: totpCode(totpSecret) });
    expect(step2.statusCode).toBe(200);
    expect(step2.json()).toMatchObject({ owner: { username: 'owner' }, recoveryCodesLeft: 10 });
    const setCookie = ([] as string[]).concat(step2.headers['set-cookie'] ?? []);
    const sessionCookie = setCookie.find((c) => c.startsWith('crew_session='));
    const csrfCookie = setCookie.find((c) => c.startsWith('crew_csrf='));
    expect(sessionCookie).toMatch(/HttpOnly/);
    expect(sessionCookie).toMatch(/Secure/);
    expect(sessionCookie).toMatch(/SameSite=Lax/);
    expect(csrfCookie).not.toMatch(/HttpOnly/);
    expect(csrfCookie).toContain(step2.json().csrfToken);

    const { header } = cookiesFrom(step2.headers['set-cookie']);
    const me = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie: header } });
    expect(me.statusCode).toBe(200);
    expect(me.json().csrfToken).toBe(step2.json().csrfToken);
  });

  it('fails without a valid TOTP code', async () => {
    app = await makeApp(ctx.db);
    const { totpSecret } = await seedOwner(ctx.db, { ...OWNER, reset: false });
    const { challenge } = (await passwordStep(app)).json();

    const wrong = await totpStep(app, { challenge, code: totpCode(totpSecret, 5) });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.headers['set-cookie']).toBeUndefined();
    expect((await totpStep(app, { challenge })).statusCode).toBe(400);
    expect((await totpStep(app, { challenge: `${challenge}x`, code: totpCode(totpSecret) })).statusCode).toBe(
      401,
    );

    const [row] = await ctx.db.select().from(owner);
    const expired = issueChallenge(testConfig().sessionSecret, row?.id ?? '', Date.now() - 10 * 60 * 1000);
    expect(
      (await totpStep(app, { challenge: expired.challenge, code: totpCode(totpSecret) })).statusCode,
    ).toBe(401);
    expect(await ctx.db.$count(sessions)).toBe(0);
  });

  it('rejects a wrong password and an unknown user with the same answer', async () => {
    app = await makeApp(ctx.db);
    await seedOwner(ctx.db, { ...OWNER, reset: false });
    const wrong = await passwordStep(app, { username: 'owner', password: 'not the password' });
    const unknown = await passwordStep(app, { username: 'nobody', password: 'whatever-password' });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it('does not accept the same TOTP code twice', async () => {
    app = await makeApp(ctx.db);
    const { totpSecret } = await seedOwner(ctx.db, { ...OWNER, reset: false });
    const code = totpCode(totpSecret);
    const first = await totpStep(app, { challenge: (await passwordStep(app)).json().challenge, code });
    const replay = await totpStep(app, { challenge: (await passwordStep(app)).json().challenge, code });
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(401);
  });

  it('accepts each recovery code once', async () => {
    app = await makeApp(ctx.db);
    const { recoveryCodes } = await seedOwner(ctx.db, { ...OWNER, reset: false });
    const recoveryCode = recoveryCodes[3]?.toLowerCase() ?? '';
    const first = await totpStep(app, {
      challenge: (await passwordStep(app)).json().challenge,
      recoveryCode,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().recoveryCodesLeft).toBe(9);
    const again = await totpStep(app, {
      challenge: (await passwordStep(app)).json().challenge,
      recoveryCode,
    });
    expect(again.statusCode).toBe(401);
  });

  it('rate limits login attempts per client IP, ignoring X-Forwarded-For from untrusted peers', async () => {
    app = await makeApp(ctx.db, { loginRateLimitPerMinute: 3 });
    await seedOwner(ctx.db, { ...OWNER, reset: false });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { origin: ORIGIN, 'x-forwarded-for': `10.0.0.${i}` },
        payload: { username: 'owner', password: 'wrong-password' },
      });
      statuses.push(res.statusCode);
      if (res.statusCode === 429) expect(res.json().error.code).toBe('RATE_LIMITED');
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });
});

describe('sessions', () => {
  it('requires a session on owner routes', async () => {
    app = await makeApp(ctx.db);
    const res = await app.inject({ method: 'GET', url: '/v1/tickets' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
    const bearer = await app.inject({
      method: 'GET',
      url: '/v1/tickets',
      headers: { authorization: 'Bearer x' },
    });
    expect(bearer.statusCode).toBe(401);
  });

  it('expires after 12 h idle and after 7 days absolute', async () => {
    app = await makeApp(ctx.db);
    const session = await seedAndLogin(app, ctx.db);
    const get = () => app?.inject({ method: 'GET', url: '/v1/tickets', headers: { cookie: session.cookie } });
    expect((await get())?.statusCode).toBe(200);

    await ctx.db.update(sessions).set({ lastSeenAt: sql`now() - interval '13 hours'` });
    expect((await get())?.statusCode).toBe(401);

    const again = await seedAndLoginAgain(app);
    await ctx.db.update(sessions).set({ expiresAt: sql`now() - interval '1 second'` });
    const res = await app.inject({ method: 'GET', url: '/v1/tickets', headers: { cookie: again } });
    expect(res.statusCode).toBe(401);
  });

  it('rotates the session id on login and logs out', async () => {
    app = await makeApp(ctx.db);
    const first = await seedAndLogin(app, ctx.db);
    const [row] = await ctx.db.select().from(owner);
    const step1 = await passwordStep(app);
    const step2 = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/totp',
      headers: { origin: ORIGIN, cookie: first.cookie },
      payload: { challenge: step1.json().challenge, code: totpCode(row?.totpSecret ?? '', 1) },
    });
    expect(step2.statusCode).toBe(200);
    const second = cookiesFrom(step2.headers['set-cookie']).header;
    expect(second).not.toBe(first.cookie);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/tickets', headers: { cookie: first.cookie } })).statusCode,
    ).toBe(401);

    const csrf = step2.json().csrfToken as string;
    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { cookie: second, origin: ORIGIN, 'x-csrf-token': csrf },
    });
    expect(logout.statusCode).toBe(204);
    expect(await ctx.db.$count(sessions)).toBe(0);
  });

  it('re-confirms the TOTP for sensitive actions, once per code', async () => {
    const seeded = await seedOwner(ctx.db, { ...OWNER, reset: false });
    const [row] = await ctx.db.select().from(owner).where(eq(owner.username, 'owner'));
    const code = totpCode(seeded.totpSecret);
    expect(await verifyOwnerTotp(ctx.db, row?.id ?? '', code)).toBe(true);
    expect(await verifyOwnerTotp(ctx.db, row?.id ?? '', code)).toBe(false);
    expect(await verifyOwnerTotp(ctx.db, row?.id ?? '', '123')).toBe(false);
  });
});

/** Logs the already-seeded owner in with the next TOTP step (the current one was used). */
async function seedAndLoginAgain(a: FastifyInstance): Promise<string> {
  const [row] = await ctx.db.select().from(owner);
  const step1 = await passwordStep(a);
  const step2 = await totpStep(a, {
    challenge: step1.json().challenge,
    code: totpCode(row?.totpSecret ?? '', 1),
  });
  if (step2.statusCode !== 200) throw new Error(step2.body);
  return cookiesFrom(step2.headers['set-cookie']).header;
}
