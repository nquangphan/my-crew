import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CommandRunner, type Manifest, macPaths, readManifest } from '@crew/mac';

export type ExistingMachine =
  | { kind: 'fresh' }
  | {
      kind: 'existing';
      port: number;
      worktreeRoot: string;
      statusUrl: string | null;
      companyId: string | null;
      hasWebhookSecret: boolean;
    }
  | { kind: 'broken'; message: string };

export interface ImportDeps {
  home: string;
  runner: CommandRunner;
  /** Test thay; mặc định đọc manifest crew-mac dưới `home`. */
  readManifest?: (path: string) => Manifest | null;
  /** Test thay; mặc định đọc `~/.crew/status.json`. */
  readStatus?: (path: string) => { url?: unknown; companyId?: unknown } | null;
}

function readStatusFile(path: string): { url?: unknown; companyId?: unknown } | null {
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof data === 'object' && data !== null ? data : null;
  } catch {
    return null;
  }
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/**
 * Nhận cài đặt có sẵn của Mac mini (manifest crew-mac, `~/.crew/status.json`, secret webhook trong Keychain).
 * Chỉ đọc: không sinh key, không ghi gì. Secret chỉ được hỏi sự tồn tại (không `-w`, giá trị không rời Keychain).
 */
export async function detectExisting(deps: ImportDeps): Promise<ExistingMachine> {
  let manifest: Manifest | null;
  try {
    manifest = (deps.readManifest ?? readManifest)(macPaths(deps.home).manifest);
  } catch (error) {
    return { kind: 'broken', message: error instanceof Error ? error.message : String(error) };
  }
  if (!manifest) return { kind: 'fresh' };
  const status = (deps.readStatus ?? readStatusFile)(join(deps.home, '.crew', 'status.json'));
  const secret = await deps.runner.run('security', ['find-generic-password', '-s', 'crew-mac-status'], {
    timeoutMs: 10_000,
  });
  return {
    kind: 'existing',
    port: manifest.port,
    worktreeRoot: manifest.worktreeRoot,
    statusUrl: text(status?.url),
    companyId: text(status?.companyId),
    hasWebhookSecret: secret.code === 0,
  };
}
