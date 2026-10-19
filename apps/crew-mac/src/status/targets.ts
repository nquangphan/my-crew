import { randomUUID } from 'node:crypto';
import {
  normalizeStatusUrl,
  readStatusConfig,
  resolveClaudePath,
  type StatusConfig,
  UUID_PATTERN,
  writeStatusConfig,
} from '../commands/status.js';
import type { MacContext } from '../context.js';

/** Một Paperclip/company nhận bản tin máy. Secret webhook của đích nằm trong Keychain ở `keychainService`. */
export interface StatusTarget {
  url: string;
  companyId: string;
  keychainService: string;
}

/** Service Keychain của cấu hình một đích cũ (`status config` + `status set-secret`). */
export const LEGACY_KEYCHAIN_SERVICE = 'crew-mac-status';
const SERVICE_PATTERN = /^crew-mac-status(-[0-9a-f]{8})?$/;

export function targetKeychainService(companyId: string): string {
  return `${LEGACY_KEYCHAIN_SERVICE}-${companyId.slice(0, 8).toLowerCase()}`;
}

function validTarget(value: unknown): value is StatusTarget {
  if (typeof value !== 'object' || value === null) return false;
  const { url, companyId, keychainService } = value as Record<string, unknown>;
  if (typeof companyId !== 'string' || !UUID_PATTERN.test(companyId)) return false;
  if (typeof keychainService !== 'string' || !SERVICE_PATTERN.test(keychainService)) return false;
  try {
    return typeof url === 'string' && normalizeStatusUrl(url) === url;
  } catch {
    return false;
  }
}

/** Đích theo `status.json`: mảng `targets` nếu có; cấu hình cũ `{url, companyId}` là một đích với service cũ. */
export function targetsOf(config: StatusConfig | null): StatusTarget[] {
  if (!config) return [];
  if (Array.isArray(config.targets)) return config.targets.filter(validTarget);
  if (!config.companyId || !UUID_PATTERN.test(config.companyId)) return [];
  return [{ url: config.url, companyId: config.companyId, keychainService: LEGACY_KEYCHAIN_SERVICE }];
}

export function listTargets(ctx: MacContext): StatusTarget[] {
  return targetsOf(readStatusConfig(ctx));
}

/** Ghi secret vào Keychain qua stdin của `security -i` (không lên argv: process cùng user đọc được argv qua `ps`). */
export async function writeKeychainSecret(ctx: MacContext, service: string, input: string): Promise<void> {
  const secret = input.replace(/\r?\n$/, '');
  if (!secret || secret.includes('\n') || secret.includes('\r'))
    throw new Error('Secret phải có đúng một dòng');
  // Trong cú pháp của `security -i`, chuỗi trong nháy kép thoát `\` và `"` bằng gạch chéo ngược (đã thử với `$`,
  // `` ` ``, `'`, dấu cách).
  const quoted = `"${secret.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  const result = await ctx.runner.run('security', ['-i'], {
    timeoutMs: 10_000,
    input: `add-generic-password -U -s ${service} -a crew-mac -w ${quoted}\n`,
  });
  if (result.code !== 0) throw new Error('Không ghi được secret vào Keychain');
}

export type KeychainRead = { ok: true; secret: string } | { ok: false; code: number; timedOut: boolean };

export async function readKeychainSecret(ctx: MacContext, service: string): Promise<KeychainRead> {
  const found = await ctx.runner.run('security', ['find-generic-password', '-s', service, '-w'], {
    timeoutMs: 10_000,
  });
  const secret = found.stdout.replace(/\r?\n$/, '');
  if (found.code !== 0 || !secret) return { ok: false, code: found.code, timedOut: found.timedOut };
  return { ok: true, secret };
}

/**
 * Thêm (hoặc cập nhật) một đích: secret vào Keychain service riêng của company, rồi ghi `targets` vào `status.json`.
 * Đích cũ của cùng company giữ service của nó. `url` mặc định là URL đang cấu hình. `machineId` giữ chung mọi đích.
 */
export async function addTarget(
  ctx: MacContext,
  input: { url?: string; companyId: string; secret: string },
): Promise<StatusTarget> {
  if (!UUID_PATTERN.test(input.companyId)) throw new Error('company phải là UUID hợp lệ');
  const config = readStatusConfig(ctx);
  const rawUrl = input.url ?? config?.url;
  if (!rawUrl) throw new Error('Chưa cấu hình Paperclip: truyền --url <origin>');
  const url = normalizeStatusUrl(rawUrl);
  const current = targetsOf(config);
  const existing = current.find((target) => target.companyId === input.companyId);
  const keychainService = existing?.keychainService ?? targetKeychainService(input.companyId);
  const clash = current.find((t) => t.keychainService === keychainService && t.companyId !== input.companyId);
  if (clash) throw new Error('Trùng service Keychain với một đích khác');
  await writeKeychainSecret(ctx, keychainService, input.secret);
  const target: StatusTarget = { url, companyId: input.companyId, keychainService };
  const targets = existing
    ? current.map((t) => (t.companyId === input.companyId ? target : t))
    : [...current, target];
  writeStatusConfig(ctx, {
    ...(config ?? {
      url,
      companyId: input.companyId,
      machineId: randomUUID(),
      claudePath: resolveClaudePath(ctx.home) ?? undefined,
    }),
    targets,
  });
  return target;
}
