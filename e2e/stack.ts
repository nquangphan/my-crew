import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { generateSync } from 'otplib';
import { composeArgs, E2E_ORIGIN } from './env';

/** `docker compose` on the E2E stack; returns stdout. */
export function compose(args: string[], input?: string): string {
  return execFileSync('docker', [...composeArgs, ...args], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

/**
 * TOTP codes are single use per 30 s step. Clearing the replay marker of the owner stands in for waiting for
 * the next step (the API tests do the same); the stack's Postgres has no host port, so it goes through docker.
 */
export function freshTotp(postgresContainer: string, secret: string): string {
  execFileSync('docker', [
    'exec',
    postgresContainer,
    'psql',
    '-U',
    'crew',
    '-d',
    'crew',
    '-XAtqc',
    'update owner set totp_last_step = null',
  ]);
  return generateSync({ secret });
}

async function call<T>(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${E2E_ORIGIN}${path}`, {
    method,
    headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Acts as a paired machine through the daemon REST API (bearer token plus an Idempotency-Key). */
export function asMachine(token: string) {
  return <T>(method: string, path: string, body?: unknown) =>
    call<T>(
      method,
      path,
      { authorization: `Bearer ${token}`, 'idempotency-key': `e2e-${randomUUID()}` },
      body,
    );
}

/** An owner session outside the browser: password, then TOTP; later writes carry the CSRF token. */
export async function ownerSession(owner: {
  username: string;
  password: string;
  totpSecret: string;
  postgresContainer: string;
}) {
  const cookies = new Map<string, string>();
  const headers = () => ({
    origin: E2E_ORIGIN,
    cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
    'x-csrf-token': cookies.get('crew_csrf') ?? '',
  });
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${E2E_ORIGIN}${path}`, {
      method,
      headers: { ...headers(), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const eq = pair.indexOf('=');
      cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  };
  const { challenge } = await request<{ challenge: string }>('POST', '/v1/auth/login', {
    username: owner.username,
    password: owner.password,
  });
  await request('POST', '/v1/auth/login/totp', {
    challenge,
    code: freshTotp(owner.postgresContainer, owner.totpSecret),
  });
  return request;
}
