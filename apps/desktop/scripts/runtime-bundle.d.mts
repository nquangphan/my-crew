/** Types of `runtime-bundle.mjs` for the TypeScript tests that build bundles with it. */
import type { KeyObject } from 'node:crypto';

export interface ShellRange {
  app: string;
  electron: string;
}

export const RUNTIME_DIR: string;
export function collectFiles(runtimeDir: string): Map<string, Buffer>;
export function packTarGz(files: Map<string, Buffer>): Buffer;
export function runtimeConfig(): { version: string; shellRange: ShellRange };
export function manifestText(input: {
  files: Map<string, Buffer>;
  version: string;
  shellRange: ShellRange;
  commit?: string;
  createdAt?: string;
  bundle?: Buffer;
}): string;
export function signManifest(text: string, key: string | KeyObject): string;
export function publicKeyOf(key: string | KeyObject): string;
export function trustedPublicKeys(): string[];
export function createRuntimeRelease(input: {
  runtimeDir?: string;
  version: string;
  shellRange: ShellRange;
  signingKey?: string | KeyObject | null;
  commit?: string;
}): { bundle: Buffer; manifest: string; signature: string | null };
export function verifyRelease(dir: string, version: string, keys?: string[]): void;
