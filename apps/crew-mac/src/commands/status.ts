import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { MacContext } from '../context.js';
import { buildMachineReport } from '../status/report.js';
import { signCrewBody } from '../status/sign.js';

export interface StatusConfig {
  url: string;
  companyId?: string;
  machineId: string;
}
export class StatusSendError extends Error {}

function statusPath(ctx: MacContext): string {
  return join(ctx.home, '.crew', 'status.json');
}
function lastPath(ctx: MacContext): string {
  return join(ctx.home, '.crew', 'status-last.json');
}

function writePrivate(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}

export function readStatusConfig(ctx: MacContext): StatusConfig | null {
  try {
    const data = JSON.parse(readFileSync(statusPath(ctx), 'utf8')) as StatusConfig;
    return typeof data.url === 'string' && typeof data.machineId === 'string' ? data : null;
  } catch {
    return null;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function configureStatus(ctx: MacContext, url: string, companyId: string): StatusConfig {
  if (!UUID_PATTERN.test(companyId)) throw new Error('company phải là UUID hợp lệ');
  const parsed = new URL(url);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw new Error('URL phải là origin HTTP(S) của Paperclip');
  }
  const config = { url: parsed.origin, companyId, machineId: readStatusConfig(ctx)?.machineId ?? randomUUID() };
  writePrivate(statusPath(ctx), config);
  return config;
}

export async function setStatusSecret(ctx: MacContext, input: string): Promise<void> {
  const secret = input.replace(/\r?\n$/, '');
  if (!secret || secret.includes('\n') || secret.includes('\r'))
    throw new Error('Secret phải có đúng một dòng');
  const result = await ctx.runner.run(
    'security',
    ['add-generic-password', '-U', '-s', 'crew-mac-status', '-a', 'crew-mac', '-w', secret],
    { timeoutMs: 10_000 },
  );
  if (result.code !== 0) throw new Error('Không ghi được secret vào Keychain');
}

export async function sendStatus(ctx: MacContext, fetcher: typeof fetch = fetch): Promise<void> {
  let httpStatus: number | null = null;
  let failureMessage = 'crew-mac status: gửi thất bại; kiểm tra cấu hình và secret';
  try {
    const config = readStatusConfig(ctx);
    if (!config) throw new Error('config');
    if (!config.companyId) {
      failureMessage = 'crew-mac status: thiếu companyId; chạy status config --company <UUID>';
      throw new Error('company');
    }
    const found = await ctx.runner.run('security', ['find-generic-password', '-s', 'crew-mac-status', '-w'], {
      timeoutMs: 10_000,
    });
    const secret = found.stdout.replace(/\r?\n$/, '');
    if (found.code !== 0 || !secret) throw new Error('keychain');
    const body = JSON.stringify(await buildMachineReport(ctx, config.companyId, config.machineId));
    const response = await fetcher(`${config.url}/api/plugins/crew.core/webhooks/machine-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...signCrewBody(body, secret, Math.floor(ctx.now().getTime() / 1000)),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    httpStatus = response.status;
    if (response.status < 200 || response.status >= 300) throw new Error('http');
    writePrivate(lastPath(ctx), { at: ctx.now().toISOString(), ok: true, httpStatus });
  } catch {
    writePrivate(lastPath(ctx), { at: ctx.now().toISOString(), ok: false, httpStatus });
    ctx.out(httpStatus === null ? failureMessage : `crew-mac status: gửi thất bại (HTTP ${httpStatus})`);
    throw new StatusSendError('Gửi trạng thái máy thất bại');
  }
}
