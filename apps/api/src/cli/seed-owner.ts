/**
 * Creates (or with --reset, replaces) the single owner account. Run over SSH on the VPS:
 *
 *   DATABASE_URL=... pnpm --filter @crew/api seed:owner --username <name> [--reset]
 *
 * The password is read from CREW_OWNER_PASSWORD, or prompted for (hidden) on a TTY. The TOTP secret and
 * 10 recovery codes are printed once; only hashes of the recovery codes are stored.
 */
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/password.js';
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, totpUri } from '../auth/totp.js';
import { createDb, type Executor } from '../db/client.js';
import { owner, sessions } from '../db/schema.js';

export interface SeedOwnerResult {
  username: string;
  totpSecret: string;
  totpUri: string;
  recoveryCodes: string[];
}

export async function seedOwner(
  db: Executor,
  args: { username: string; password: string; reset: boolean },
): Promise<SeedOwnerResult> {
  const username = args.username.trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(username))
    throw new Error('username must be 1-100 of A-Z a-z 0-9 . _ -');
  const passwordHash = await hashPassword(args.password);
  const totpSecret = generateTotpSecret();
  const recoveryCodes = generateRecoveryCodes();
  const values = {
    username,
    passwordHash,
    totpSecret,
    totpLastStep: null,
    recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
    updatedAt: new Date(),
  };

  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: owner.id }).from(owner);
    if (existing.length > 0 && !args.reset) {
      throw new Error('an owner already exists; pass --reset to replace the credentials');
    }
    if (existing.length > 0) {
      const [current] = existing;
      if (!current) throw new Error('owner row vanished');
      await tx.update(owner).set(values).where(eq(owner.id, current.id));
      await tx.delete(sessions).where(eq(sessions.ownerId, current.id));
    } else {
      await tx.insert(owner).values(values);
    }
  });
  return { username, totpSecret, totpUri: totpUri(totpSecret, username), recoveryCodes };
}

async function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) throw new Error('no TTY: set CREW_OWNER_PASSWORD instead');
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          finish();
          reject(new Error('cancelled'));
          return;
        }
        value = char === '\u007f' ? value.slice(0, -1) : value + char;
      }
    };
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.CREW_OWNER_PASSWORD;
  if (fromEnv) return fromEnv;
  const first = await promptHidden(`Password (min ${MIN_PASSWORD_LENGTH} chars): `);
  const second = await promptHidden('Repeat password: ');
  if (first !== second) throw new Error('passwords do not match');
  return first;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { username: { type: 'string' }, reset: { type: 'boolean', default: false } },
  });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (!values.username) throw new Error('--username is required');

  const password = await readPassword();
  const handle = createDb(url, { max: 1 });
  try {
    const result = await seedOwner(handle.db, { username: values.username, password, reset: values.reset });
    console.log(`Owner "${result.username}" saved. Existing sessions were signed out.`);
    console.log('\nAdd this TOTP secret to your authenticator app (shown once):');
    console.log(`  secret: ${result.totpSecret}`);
    console.log(`  uri:    ${result.totpUri}`);
    console.log('\nRecovery codes (each works once; store them offline):');
    for (const code of result.recoveryCodes) console.log(`  ${code}`);
  } finally {
    await handle.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
