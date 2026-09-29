import { MIN_PASSWORD_LENGTH } from '@crew/shared';
import { hash, verify } from '@node-rs/argon2';

export { MIN_PASSWORD_LENGTH };

/** OWASP-recommended argon2id parameters (19 MiB, 2 passes, 1 lane). argon2id is the library default. */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return hash(password, OPTIONS);
}

/** Never throws: a malformed hash counts as a mismatch. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Burns the same time as a real check when the username is unknown, so timing does not reveal it. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hash('dummy-password-for-timing', OPTIONS);
  await verifyPassword(await dummyHash, password);
  return false;
}
