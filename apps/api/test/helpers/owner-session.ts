import { CSRF_HEADER } from '@crew/shared';
import type { FastifyInstance } from 'fastify';
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
  /** Headers for a mutating owner request: session cookie, Origin and CSRF token. */
  headers: Record<string, string>;
}

export async function seedAndLogin(app: FastifyInstance, db: Database): Promise<LoggedInOwner> {
  await seedOwner(db, { ...OWNER, reset: false });
  return loginOwner(app);
}

/** A new session of the seeded owner (another device). */
export async function loginOwner(app: FastifyInstance, password = OWNER.password): Promise<LoggedInOwner> {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { origin: ORIGIN },
    payload: { username: OWNER.username, password },
  });
  if (response.statusCode !== 200) throw new Error(`login failed: ${response.body}`);
  const { header } = cookiesFrom(response.headers['set-cookie']);
  const csrfToken = response.json().csrfToken as string;
  return { cookie: header, csrfToken, headers: { cookie: header, origin: ORIGIN, [CSRF_HEADER]: csrfToken } };
}
