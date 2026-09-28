import { CSRF_HEADER } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
import { generateSync } from 'otplib';
import { buildApp } from '../../src/app.js';
import { seedOwner } from '../../src/cli/seed-owner.js';
import type { AppConfig } from '../../src/config.js';
import type { Database } from '../../src/db/client.js';
import { ORIGIN, testConfig } from './test-db.js';

export const OWNER = { username: 'owner', password: 'correct horse battery staple' };

export async function makeApp(db: Database, overrides: Partial<AppConfig> = {}): Promise<FastifyInstance> {
  const app = await buildApp({ config: testConfig(overrides), db });
  await app.ready();
  return app;
}

/** TOTP code for the current step plus `stepOffset` 30 s steps (within the accepted drift window). */
export function totpCode(secret: string, stepOffset = 0): string {
  return generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + stepOffset * 30 });
}

/** Parses `set-cookie` headers into a `cookie` request header value plus a name -> value map. */
export function cookiesFrom(setCookie: string | string[] | undefined) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const map: Record<string, string> = {};
  for (const line of list) {
    const [pair] = line.split(';');
    const index = pair?.indexOf('=') ?? -1;
    if (pair && index > 0) map[pair.slice(0, index)] = pair.slice(index + 1);
  }
  const header = Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return { header, map };
}

export interface LoggedInOwner {
  cookie: string;
  csrfToken: string;
  totpSecret: string;
  recoveryCodes: string[];
  /** Headers for a mutating owner request: session cookie, Origin and CSRF token. */
  headers: Record<string, string>;
}

export async function seedAndLogin(app: FastifyInstance, db: Database): Promise<LoggedInOwner> {
  const seeded = await seedOwner(db, { ...OWNER, reset: false });
  return loginOwner(app, seeded);
}

/** A new session of the seeded owner (another device). Clear the TOTP replay marker first for a second login. */
export async function loginOwner(
  app: FastifyInstance,
  seeded: { totpSecret: string; recoveryCodes: string[] },
): Promise<LoggedInOwner> {
  const step1 = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { origin: ORIGIN },
    payload: OWNER,
  });
  if (step1.statusCode !== 200) throw new Error(`login step 1 failed: ${step1.body}`);
  const step2 = await app.inject({
    method: 'POST',
    url: '/v1/auth/login/totp',
    headers: { origin: ORIGIN },
    payload: { challenge: step1.json().challenge, code: totpCode(seeded.totpSecret) },
  });
  if (step2.statusCode !== 200) throw new Error(`login step 2 failed: ${step2.body}`);
  const { header } = cookiesFrom(step2.headers['set-cookie']);
  const csrfToken = step2.json().csrfToken as string;
  return {
    cookie: header,
    csrfToken,
    totpSecret: seeded.totpSecret,
    recoveryCodes: seeded.recoveryCodes,
    headers: { cookie: header, origin: ORIGIN, [CSRF_HEADER]: csrfToken },
  };
}
