import { createHash, createPrivateKey, createPublicKey, type KeyObject, sign } from 'node:crypto';

/** DER prefix of an Ed25519 PKCS#8 private key; the 32-byte seed follows it. */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** A deterministic test-only Ed25519 key (derived from a label, so no key material is committed). */
export function testSigningKey(label: string): { privateKey: KeyObject; publicKey: string } {
  const seed = createHash('sha256').update(`crew-test-runtime-key:${label}`).digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const raw = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
  return { privateKey, publicKey: raw.toString('base64') };
}

export interface TestRelease {
  manifest: string;
  signature: string;
  bundle: Buffer;
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

/** A signed release whose tarball is arbitrary bytes (the server never unpacks it; the shell does). */
export function testRelease(
  key: KeyObject,
  version: string,
  options: { app?: string; bundle?: Buffer; tamper?: (manifest: Record<string, unknown>) => void } = {},
): TestRelease {
  const bundle = options.bundle ?? Buffer.from(`bundle of ${version}`);
  const manifest: Record<string, unknown> = {
    format: 1,
    version,
    commit: 'abc123',
    createdAt: '2026-09-30T05:00:00.000Z',
    shellRange: { app: options.app ?? '>=0.3.0 <0.4.0', electron: '44' },
    bundle: { sha256: sha256(bundle), size: bundle.length },
    files: {
      'host/index.js': { sha256: sha256('host'), size: 4 },
      'renderer/index.html': { sha256: sha256('html'), size: 4 },
    },
  };
  options.tamper?.(manifest);
  const text = JSON.stringify(manifest, null, 2);
  return { manifest: text, signature: sign(null, Buffer.from(text), key).toString('base64'), bundle };
}
