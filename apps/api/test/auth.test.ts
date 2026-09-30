import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedOwner, main as seedOwnerCli } from '../src/cli/seed-owner.js';
import { owner, sessions } from '../src/db/schema.js';
import { cookiesFrom, makeApp, OWNER, seedAndLogin } from './helpers/owner-session.js';
import { TEST_DATABASE_URL } from './helpers/test-database-url.js';
import { ORIGIN, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function loginStep(a: FastifyInstance, body: object = OWNER, headers: Record<string, string> = {}) {
  return a.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { origin: ORIGIN, ...headers },
    payload: body,
  });
}

describe('seed CLI', () => {
  it('stores an argon2id hash and no two-factor secret or recovery codes', async () => {
    const seeded = await seedOwner(ctx.db, { ...OWNER, reset: false });
    expect(seeded).toEqual({ username: 'owner' });
    const [row] = await ctx.db.select().from(owner);
    expect(row?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(row?.totpSecret).toBe('');
    expect(row?.totpLastStep).toBeNull();
    expect(row?.recoveryCodeHashes).toEqual([]);
  });

  it('prints only the saved owner, with no TOTP secret or recovery codes', async () => {
    vi.stubEnv('DATABASE_URL', TEST_DATABASE_URL);
    vi.stubEnv('CREW_OWNER_PASSWORD', OWNER.password);
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });
    await seedOwnerCli(['--username', 'owner']);
    const output = lines.join('\n');
    expect(output).toBe('Owner "owner" saved. Existing sessions were signed out.');
    expect(output).not.toMatch(/totp|secret|recovery|otpauth/i);
    expect(await ctx.db.$count(owner)).toBe(1);
  });

  it('clears two-factor data left by an older seed on --reset', async () => {
    await seedOwner(ctx.db, { ...OWNER, reset: false });
    await ctx.db
      .update(owner)
      .set({ totpSecret: 'OLDSECRET', totpLastStep: 42, recoveryCodeHashes: ['abc'] });
    await seedOwner(ctx.db, { ...OWNER, reset: true });
    const [row] = await ctx.db.select().from(owner);
    expect(row).toMatchObject({ totpSecret: '', totpLastStep: null, recoveryCodeHashes: [] });
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
  it('signs in with the username and password in one step and sets hardened cookies', async () => {
    app = await makeApp(ctx.db);
    await seedOwner(ctx.db, { ...OWNER, reset: false });

    const res = await loginStep(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ owner: { username: 'owner' }, csrfToken: expect.any(String) });
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const sessionCookie = setCookie.find((c) => c.startsWith('crew_session='));
    const csrfCookie = setCookie.find((c) => c.startsWith('crew_csrf='));
    expect(sessionCookie).toMatch(/HttpOnly/);
    expect(sessionCookie).toMatch(/Secure/);
    expect(sessionCookie).toMatch(/SameSite=Lax/);
    expect(csrfCookie).not.toMatch(/HttpOnly/);
    expect(csrfCookie).toContain(res.json().csrfToken);

    const { header } = cookiesFrom(res.headers['set-cookie']);
    const me = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie: header } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ owner: { username: 'owner' }, csrfToken: res.json().csrfToken });
  });

  it('ignores a verification code an older client still sends', async () => {
    app = await makeApp(ctx.db);
    await seedOwner(ctx.db, { ...OWNER, reset: false });
    expect((await loginStep(app, { ...OWNER, code: '123456' })).statusCode).toBe(200);
  });

  it('rejects a wrong password and an unknown user with the same answer and no session', async () => {
    app = await makeApp(ctx.db);
    await seedOwner(ctx.db, { ...OWNER, reset: false });
    const wrong = await loginStep(app, { username: 'owner', password: 'not the password' });
    const unknown = await loginStep(app, { username: 'nobody', password: 'whatever-password' });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.headers['set-cookie']).toBeUndefined();
    expect(await ctx.db.$count(sessions)).toBe(0);
  });

  it('rejects a malformed body and a foreign Origin', async () => {
    app = await makeApp(ctx.db);
    await seedOwner(ctx.db, { ...OWNER, reset: false });
    expect((await loginStep(app, { username: 'owner' })).statusCode).toBe(400);
    expect((await loginStep(app, OWNER, { origin: 'https://evil.test' })).statusCode).toBe(403);
    expect(await ctx.db.$count(sessions)).toBe(0);
  });

  it('no longer serves the old second login step', async () => {
    app = await makeApp(ctx.db);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/totp',
      headers: { origin: ORIGIN },
      payload: { challenge: 'x', code: '123456' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rate limits login attempts per client IP, ignoring X-Forwarded-For from untrusted peers', async () => {
    app = await makeApp(ctx.db, { loginRateLimitPerMinute: 3 });
    await seedOwner(ctx.db, { ...OWNER, reset: false });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await loginStep(
        app,
        { username: 'owner', password: 'wrong-password' },
        { 'x-forwarded-for': `10.0.0.${i}` },
      );
      statuses.push(res.statusCode);
      if (res.statusCode === 429) expect(res.json().error.code).toBe('RATE_LIMITED');
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    // The limit also holds back the right password until the window passes.
    expect((await loginStep(app)).statusCode).toBe(429);
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

    const again = await loginAgain(app);
    await ctx.db.update(sessions).set({ expiresAt: sql`now() - interval '1 second'` });
    const res = await app.inject({ method: 'GET', url: '/v1/tickets', headers: { cookie: again } });
    expect(res.statusCode).toBe(401);
  });

  it('rotates the session id on login and logs out', async () => {
    app = await makeApp(ctx.db);
    const first = await seedAndLogin(app, ctx.db);
    const relogin = await loginStep(app, OWNER, { cookie: first.cookie });
    expect(relogin.statusCode).toBe(200);
    const second = cookiesFrom(relogin.headers['set-cookie']).header;
    expect(second).not.toBe(first.cookie);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/tickets', headers: { cookie: first.cookie } })).statusCode,
    ).toBe(401);

    const csrf = relogin.json().csrfToken as string;
    const logout = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { cookie: second, origin: ORIGIN, 'x-csrf-token': csrf },
    });
    expect(logout.statusCode).toBe(204);
    expect(await ctx.db.$count(sessions)).toBe(0);
  });
});

/** Logs the already-seeded owner in again (another session). */
async function loginAgain(a: FastifyInstance): Promise<string> {
  const res = await loginStep(a);
  if (res.statusCode !== 200) throw new Error(res.body);
  return cookiesFrom(res.headers['set-cookie']).header;
}
