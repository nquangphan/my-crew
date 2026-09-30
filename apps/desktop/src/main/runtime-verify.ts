import { createHash, createPublicKey, verify } from 'node:crypto';
import {
  parseRuntimeManifest,
  RUNTIME_SIGNING_KEYS,
  type RuntimeManifest,
  shellRangeProblem,
} from '@crew/shared';

export interface SigningKey {
  id: string;
  /** Raw Ed25519 public key, base64. */
  publicKey: string;
}

export interface ShellFacts {
  appVersion: string;
  electronVersion: string;
}

/** A bundle that must not run; `message` is shown to the owner (Vietnamese). */
export class RuntimeRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeRefused';
  }
}

/** DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows it. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * The keys this shell trusts: the ones built into it, plus test keys from `CREW_RUNTIME_TEST_KEYS` only when the
 * app runs in its E2E test mode (never in a normal launch).
 */
export function trustedKeys(env: NodeJS.ProcessEnv): SigningKey[] {
  const keys = [...RUNTIME_SIGNING_KEYS];
  if (env.CREW_DESKTOP_TEST_MODE === '1' && env.CREW_RUNTIME_TEST_KEYS) {
    const extra = env.CREW_RUNTIME_TEST_KEYS.split(',')
      .map((key) => key.trim())
      .filter(Boolean);
    for (const [index, publicKey] of extra.entries()) keys.push({ id: `test-${index + 1}`, publicKey });
  }
  return keys;
}

/** The id of the trusted key whose Ed25519 signature over `message` is `signature` (base64), or null. */
export function signedBy(message: Buffer, signature: string, keys: readonly SigningKey[]): string | null {
  const sig = Buffer.from(signature.trim(), 'base64');
  if (sig.length !== 64) return null;
  for (const key of keys) {
    const raw = Buffer.from(key.publicKey, 'base64');
    if (raw.length !== 32) continue;
    try {
      const publicKey = createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
        format: 'der',
        type: 'spki',
      });
      if (verify(null, message, publicKey, sig)) return key.id;
    } catch {
      // a malformed key never verifies anything
    }
  }
  return null;
}

export const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

/**
 * Checks a runtime release before anything of it is used: a trusted key signed the manifest's exact bytes, the
 * manifest is well formed (safe paths, bounded sizes), and this shell can run it. Throws `RuntimeRefused`.
 */
export function verifyManifest(
  manifestText: string,
  signature: string | null,
  keys: readonly SigningKey[],
  shell: ShellFacts,
): RuntimeManifest {
  if (!signature) throw new RuntimeRefused('Bản runtime chưa được ký nên bị từ chối.');
  if (!signedBy(Buffer.from(manifestText, 'utf8'), signature, keys)) {
    throw new RuntimeRefused('Chữ ký của bản runtime không hợp lệ (không khớp khoá tin cậy) nên bị từ chối.');
  }
  const parsed = parseRuntimeManifest(manifestText);
  if ('error' in parsed) throw new RuntimeRefused(`Manifest của bản runtime không hợp lệ: ${parsed.error}.`);
  const problem = shellRangeProblem(parsed.manifest.shellRange, shell);
  if (problem)
    throw new RuntimeRefused(
      `Bản runtime ${parsed.manifest.version} không chạy được trên app này: ${problem}.`,
    );
  return parsed.manifest;
}

/** The downloaded tarball is exactly the one the signed manifest names. */
export function verifyTarball(tarball: Buffer, manifest: RuntimeManifest): void {
  if (!manifest.bundle) throw new RuntimeRefused('Manifest không ghi tarball của bản runtime.');
  if (tarball.length !== manifest.bundle.size || sha256(tarball) !== manifest.bundle.sha256) {
    throw new RuntimeRefused(
      `Tarball của bản runtime ${manifest.version} bị sửa hoặc tải lỗi (hash không khớp).`,
    );
  }
}
