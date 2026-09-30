import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { RuntimeReleaseFiles } from '@crew/shared';
import { manifestText, packTarGz, signManifest } from '../scripts/runtime-bundle.mjs';

/** DER prefix of an Ed25519 PKCS#8 private key; the 32-byte seed follows it. */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** A deterministic test-only Ed25519 key, derived from a label (no key material is committed). */
export function testKey(label: string): { privateKey: KeyObject; publicKey: string } {
  const seed = createHash('sha256').update(`crew-test-runtime-key:${label}`).digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const publicKey = createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .subarray(-32)
    .toString('base64');
  return { privateKey, publicKey };
}

export const SHELL = { appVersion: '0.3.0', electronVersion: '44.4.5' };
export const SHELL_RANGE = { app: '>=0.3.0 <0.4.0', electron: '44' };

/** The files of a small runtime whose host and renderer name the version (so a switch is visible). */
export function runtimeFiles(version: string): Map<string, Buffer> {
  return new Map([
    ['host/index.js', Buffer.from(`export const version = '${version}';\n`)],
    ['host/package.json', Buffer.from('{ "type": "module" }\n')],
    ['host/prompts/dev.md', Buffer.from('# dev\n')],
    ['renderer/index.html', Buffer.from(`<html>${version}</html>\n`)],
  ]);
}

export interface Built {
  manifest: string;
  signature: string | null;
  bundle: Buffer;
}

/** A signed release of `files` (or of a tarball built by `pack`, for hostile archives). */
export function buildRelease(
  key: KeyObject | null,
  version: string,
  options: {
    files?: Map<string, Buffer>;
    shellRange?: { app: string; electron: string };
    /** Builds the tarball from the files (default: the real packer). */
    pack?: (files: Map<string, Buffer>) => Buffer;
  } = {},
): Built {
  const files = options.files ?? runtimeFiles(version);
  const bundle = (options.pack ?? packTarGz)(files);
  const manifest = manifestText({
    files,
    version,
    shellRange: options.shellRange ?? SHELL_RANGE,
    commit: 'test',
    createdAt: '2026-09-30T05:00:00.000Z',
    bundle,
  });
  return { manifest, signature: key ? signManifest(manifest, key) : null, bundle };
}

/** The server's answer for a release (metadata plus its manifest and signature). */
export function releaseFiles(built: Built, version: string, app = SHELL_RANGE.app): RuntimeReleaseFiles {
  return {
    version,
    commit: 'test',
    createdAt: '2026-09-30T05:00:00.000Z',
    publishedAt: '2026-09-30T05:00:00.000Z',
    shellRange: { app, electron: '44' },
    size: built.bundle.length,
    bundleSha256: createHash('sha256').update(built.bundle).digest('hex'),
    source: 'upload',
    publishedBy: 'owner:test',
    keyId: 'test-1',
    manifest: built.manifest,
    signature: built.signature ?? '',
  };
}

/** One raw ustar entry (any type and name), for archives the real packer would never make. */
export function rawEntry(name: string, data: Buffer, type = '0', linkname = ''): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100, 8, 'ascii');
  header.write('0000000\0', 108, 8, 'ascii');
  header.write('0000000\0', 116, 8, 'ascii');
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.write('00000000000\0', 136, 12, 'ascii');
  header.write('        ', 148, 8, 'ascii');
  header.write(type, 156, 1, 'ascii');
  header.write(linkname, 157, 100, 'utf8');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, pad]);
}

export function rawTarGz(entries: Buffer[]): Buffer {
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

/** A builtin runtime folder (what `out/runtime` holds) for the manager's fallback. */
export function writeBuiltin(dir: string, version: string): void {
  for (const [path, data] of runtimeFiles(version)) {
    mkdirSync(join(dir, ...path.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(dir, ...path.split('/')), data);
  }
}
