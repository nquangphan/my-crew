import { existsSync, readFileSync } from 'node:fs';
import { SetupError } from './context.js';
import { writeIfChanged } from './fs-util.js';

export interface Manifest {
  version: 1;
  port: number;
  listenAddress: string;
  worktreeRoot: string;
  paperclipKey: string;
  installedAt: string;
}

export function readManifest(path: string): Manifest | null {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Manifest>;
  if (
    raw.version !== 1 ||
    typeof raw.port !== 'number' ||
    typeof raw.listenAddress !== 'string' ||
    typeof raw.worktreeRoot !== 'string' ||
    typeof raw.paperclipKey !== 'string' ||
    typeof raw.installedAt !== 'string'
  ) {
    throw new SetupError(`${path} hỏng; xóa file rồi chạy lại "crew-mac setup".`);
  }
  return raw as Manifest;
}

export function writeManifest(path: string, manifest: Manifest): boolean {
  return writeIfChanged(path, `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
}
