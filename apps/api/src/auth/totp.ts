import { createHash, randomInt } from 'node:crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';

export const TOTP_ISSUER = '2P Crew';
export const RECOVERY_CODE_COUNT = 10;

/** Accept the previous and next 30 s step to absorb clock drift. */
const EPOCH_TOLERANCE_SECONDS = 30;

export function generateTotpSecret(): string {
  return generateSecret();
}

export function totpUri(secret: string, username: string): string {
  return generateURI({ secret, issuer: TOTP_ISSUER, label: username });
}

/**
 * Verifies a 6-digit code. Returns the matched time step, or null. A code whose step is not newer than
 * `lastStep` is rejected, so a code cannot be replayed within its validity window.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  let result: ReturnType<typeof verifySync>;
  try {
    result = verifySync({ secret, token: code, epochTolerance: EPOCH_TOLERANCE_SECONDS });
  } catch {
    return null;
  }
  if (!result.valid || !('timeStep' in result)) return null;
  const step = result.timeStep;
  if (lastStep !== null && step <= lastStep) return null;
  return step;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 16 base32 characters (80 bits), shown as ABCD-EFGH-IJKL-MNOP. */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 16 }, () => BASE32[randomInt(BASE32.length)]).join('');
    return chars.match(/.{4}/g)?.join('-') ?? chars;
  });
}

/** Recovery codes are high-entropy, so a fast hash is enough; input is case- and dash-insensitive. */
export function hashRecoveryCode(code: string): string {
  const normalized = code.trim().toUpperCase().replaceAll('-', '');
  return createHash('sha256').update(normalized).digest('hex');
}
