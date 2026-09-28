import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { E2E_API_URL, E2E_STATE_FILE, type E2eState, type PreparedState } from './e2e-env';

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) {
    headers.authorization = `Bearer ${token}`;
    headers['idempotency-key'] = `e2e-setup-${randomUUID()}`;
  }
  const res = await fetch(`${E2E_API_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

/**
 * Runs after both servers are up: pairs two machines through the public pairing route. Machine A hosts
 * the assistant and creates project SHOP from a "folder"; machine B owns nothing (it asks for a takeover
 * in the admin flow).
 */
export default async function globalSetup(): Promise<void> {
  const prepared = JSON.parse(readFileSync(E2E_STATE_FILE, 'utf8')) as PreparedState;
  const pair = async (code: string, name: string) => {
    const res = await post<{ machineId: string; token: string }>('/v1/machines/pair', {
      code,
      name,
      hostname: `${name}.local`,
      os: 'darwin 25.5',
      hardware: { cpus: 10, memGb: 32 },
    });
    return { id: res.machineId, name, token: res.token };
  };
  const machineA = await pair(prepared.pairingCodes[0], 'macbook-e2e');
  const machineB = await pair(prepared.pairingCodes[1], 'mac-mini-e2e');
  await post('/v1/daemon/claims', { hostsAssistant: true }, machineA.token);
  const project = await post<{ id: string; key: string; name: string }>(
    '/v1/daemon/projects',
    {
      key: 'SHOP',
      name: 'Shop API',
      description: 'API bán hàng: đơn hàng, thanh toán, hoàn tiền.',
      repoUrl: 'https://github.com/2p/shop-api.git',
      platform: 'web',
    },
    machineA.token,
  );
  const state: E2eState = {
    ...prepared,
    project: { id: project.id, key: project.key, name: project.name },
    machineA,
    machineB,
  };
  writeFileSync(E2E_STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}
