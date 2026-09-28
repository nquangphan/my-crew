import { createHash } from 'node:crypto';
import { MACHINE_TOKEN_PREFIX } from '@crew/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { machineSkills, machines, machineTokens, pairingCodes } from '../src/db/schema.js';
import { ROTATION_GRACE_MS } from '../src/services/machine-service.js';
import { freshTotp, insertPairingCode, pairTestMachine, setTokenExpiry } from './helpers/machines.js';
import { type LoggedInOwner, makeApp, seedAndLogin } from './helpers/owner-session.js';
import { ORIGIN, useTestDb } from './helpers/test-db.js';

const ctx = useTestDb();
let app: FastifyInstance;
let owner: LoggedInOwner;

beforeEach(async () => {
  app = await makeApp(ctx.db);
  owner = await seedAndLogin(app, ctx.db);
});
afterEach(() => app.close());

const pairBody = (code: string) => ({
  code,
  name: 'Mac mini văn phòng',
  hostname: 'mini.local',
  os: 'darwin 25.5',
  hardware: { cpus: 10, memGb: 32, arch: 'arm64' },
  inventory: {
    skills: [{ name: 'ak:scout', source: 'plugin', description: 'Scout files' }],
    mcpServers: [{ name: 'playwright', source: 'user', status: 'connected', tools: [{ name: 'navigate' }] }],
  },
});

async function projectsAs(token: string) {
  return app.inject({
    method: 'GET',
    url: '/v1/daemon/projects',
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('pairing codes', () => {
  it('need a fresh TOTP, are shown once and stored only as a hash', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/machines/pairing-codes',
      headers: owner.headers,
      payload: { code: '000000' },
    });
    expect(bad.statusCode).toBe(401);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/machines/pairing-codes',
      headers: owner.headers,
      payload: { code: await freshTotp(ctx.db, owner.totpSecret) },
    });
    expect(res.statusCode).toBe(201);
    const { pairingCode, expiresAt } = res.json();
    expect(pairingCode).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    const ttl = new Date(expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(10 * 60 * 1000);

    const [row] = await ctx.db.select().from(pairingCodes);
    const normalized = pairingCode.replaceAll('-', '');
    expect(row?.codeHash).toBe(createHash('sha256').update(normalized).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(normalized);
  });

  it('are refused without an owner session or CSRF token', async () => {
    const noSession = await app.inject({
      method: 'POST',
      url: '/v1/machines/pairing-codes',
      headers: { origin: ORIGIN },
      payload: { code: '123456' },
    });
    expect(noSession.statusCode).toBe(401);
    const noCsrf = await app.inject({
      method: 'POST',
      url: '/v1/machines/pairing-codes',
      headers: { cookie: owner.cookie, origin: ORIGIN },
      payload: { code: '123456' },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('are rate limited', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/machines/pairing-codes',
        headers: owner.headers,
        payload: { code: '000000' },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });
});

describe('POST /v1/machines/pair', () => {
  it('returns a prefixed 256-bit token once, stores only its hash, and works with any case or dashes', async () => {
    const code = await insertPairingCode(ctx.db);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/machines/pair',
      payload: pairBody(`${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`.toLowerCase()),
    });
    expect(res.statusCode).toBe(201);
    const { machineId, token, expiresAt } = res.json();
    expect(token.startsWith(MACHINE_TOKEN_PREFIX)).toBe(true);
    expect(Buffer.from(token.slice(MACHINE_TOKEN_PREFIX.length), 'base64url')).toHaveLength(32);
    const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThanOrEqual(90);

    const tokens = await ctx.db.select().from(machineTokens);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    const dump = await ctx.db.execute(sql`select row_to_json(t)::text as j from machine_tokens t`);
    expect(JSON.stringify(dump)).not.toContain(token);

    const [machine] = await ctx.db.select().from(machines).where(eq(machines.id, machineId));
    expect(machine).toMatchObject({
      name: 'Mac mini văn phòng',
      hostname: 'mini.local',
      hardware: { cpus: 10, memGb: 32, arch: 'arm64' },
      online: true,
      hostsAssistant: false,
    });
    const [inventory] = await ctx.db.select().from(machineSkills);
    expect(inventory).toMatchObject({ machineId, projectId: null });
    expect(inventory?.skills[0]?.name).toBe('ak:scout');

    expect((await projectsAs(token)).statusCode).toBe(200);
  });

  it('refuses a used, expired or unknown code', async () => {
    const code = await insertPairingCode(ctx.db);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/machines/pair', payload: pairBody(code) })).statusCode,
    ).toBe(201);
    const reused = await app.inject({ method: 'POST', url: '/v1/machines/pair', payload: pairBody(code) });
    expect(reused.statusCode).toBe(401);

    const expired = await insertPairingCode(ctx.db, -1_000);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/machines/pair', payload: pairBody(expired) })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/v1/machines/pair', payload: pairBody('AAAA-BBBB-CCCC') }))
        .statusCode,
    ).toBe(401);
    expect(await ctx.db.$count(machines)).toBe(1);
  });

  it('validates the body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/machines/pair',
      payload: { ...pairBody(await insertPairingCode(ctx.db)), hardware: { cpus: 0, memGb: 16 } },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('machine tokens', () => {
  it('reject missing, malformed, expired and revoked tokens with 401', async () => {
    const machine = await pairTestMachine(ctx.db, 'm1');
    expect((await app.inject({ method: 'GET', url: '/v1/daemon/projects' })).statusCode).toBe(401);
    expect((await projectsAs('not a token')).statusCode).toBe(401);
    expect((await projectsAs(`${MACHINE_TOKEN_PREFIX}${'x'.repeat(43)}`)).statusCode).toBe(401);

    await setTokenExpiry(ctx.db, machine.token, new Date(Date.now() - 1_000));
    const expired = await projectsAs(machine.token);
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('UNAUTHORIZED');

    const other = await pairTestMachine(ctx.db, 'm2');
    expect((await projectsAs(other.token)).statusCode).toBe(200);
    const revoke = await app.inject({
      method: 'POST',
      url: `/v1/machines/${other.machineId}/revoke`,
      headers: owner.headers,
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().revokedAt).not.toBeNull();
    expect((await projectsAs(other.token)).statusCode).toBe(401);
  });

  it('daemon routes ignore owner cookies and owner routes ignore bearer tokens', async () => {
    const machine = await pairTestMachine(ctx.db, 'm1');
    const withCookie = await app.inject({
      method: 'GET',
      url: '/v1/daemon/projects',
      headers: owner.headers,
    });
    expect(withCookie.statusCode).toBe(401);
    const withBearer = await app.inject({ method: 'GET', url: '/v1/projects', headers: machine.auth });
    expect(withBearer.statusCode).toBe(401);
  });

  it('rotate: the new token works and the old one expires after the grace period', async () => {
    const machine = await pairTestMachine(ctx.db, 'm1');
    const res = await app.inject({ method: 'POST', url: '/v1/daemon/token/rotate', headers: machine.auth });
    expect(res.statusCode).toBe(201);
    const rotated = res.json();
    expect(rotated.machineId).toBe(machine.machineId);
    expect(rotated.token).not.toBe(machine.token);
    expect((await projectsAs(rotated.token)).statusCode).toBe(200);

    // The old token keeps working during the grace window, then stops.
    expect((await projectsAs(machine.token)).statusCode).toBe(200);
    const oldHash = createHash('sha256').update(machine.token).digest('hex');
    const [old] = await ctx.db.select().from(machineTokens).where(eq(machineTokens.tokenHash, oldHash));
    expect(old?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + ROTATION_GRACE_MS);
    await setTokenExpiry(ctx.db, machine.token, new Date(Date.now() - 1));
    expect((await projectsAs(machine.token)).statusCode).toBe(401);
    expect((await projectsAs(rotated.token)).statusCode).toBe(200);
  });

  it('the owner lists machines with token expiry and online state', async () => {
    const machine = await pairTestMachine(ctx.db, 'm1');
    const res = await app.inject({ method: 'GET', url: '/v1/machines', headers: owner.headers });
    expect(res.statusCode).toBe(200);
    const [item] = res.json().items;
    expect(item).toMatchObject({
      id: machine.machineId,
      name: 'm1',
      online: true,
      streamConnected: false,
      revokedAt: null,
      projectKeys: [],
    });
    expect(new Date(item.tokenExpiresAt).getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);
  });
});
