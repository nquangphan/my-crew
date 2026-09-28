import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Where the machine token lives. It is never written to the config, the state DB or an agent env. */
export interface TokenStore {
  readonly kind: 'keychain' | 'file';
  get(): string | null;
  set(token: string): void;
  delete(): void;
}

export class SecretStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretStoreError';
  }
}

const TOKEN_RE = /^[\x21-\x7e]{16,500}$/;

function assertToken(token: string): void {
  if (!TOKEN_RE.test(token)) throw new SecretStoreError('refusing to store a malformed machine token');
}

/** A 0600 file (Linux, and tests). Written atomically so a crash never leaves half a token. */
export class FileTokenStore implements TokenStore {
  readonly kind = 'file' as const;
  constructor(private readonly path: string) {}

  get(): string | null {
    if (!existsSync(this.path)) return null;
    const token = readFileSync(this.path, 'utf8').trim();
    return token === '' ? null : token;
  }

  set(token: string): void {
    assertToken(token);
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, `${token}\n`, { mode: 0o600 });
    renameSync(temp, this.path);
    chmodSync(this.path, 0o600);
  }

  delete(): void {
    rmSync(this.path, { force: true });
  }
}

export const KEYCHAIN_SERVICE = '2p-crew-machine-token';

/**
 * macOS login Keychain through the `security` CLI. Writes go through `security -i` on stdin, so the token
 * never appears in a process argument list.
 */
export class KeychainTokenStore implements TokenStore {
  readonly kind = 'keychain' as const;
  constructor(
    private readonly account: string,
    private readonly securityBin = '/usr/bin/security',
  ) {}

  get(): string | null {
    const result = spawnSync(
      this.securityBin,
      ['find-generic-password', '-a', this.account, '-s', KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8' },
    );
    if (result.error) throw new SecretStoreError(`cannot run security: ${result.error.message}`);
    // 44: the item does not exist.
    if (result.status === 44) return null;
    if (result.status !== 0) {
      throw new SecretStoreError(`security find-generic-password failed: ${result.stderr.trim()}`);
    }
    const token = result.stdout.trim();
    return token === '' ? null : token;
  }

  set(token: string): void {
    assertToken(token);
    const quote = (value: string) => `"${value.replace(/(["\\])/g, '\\$1')}"`;
    const command = `add-generic-password -U -a ${quote(this.account)} -s ${quote(KEYCHAIN_SERVICE)} -w ${quote(token)}\n`;
    const result = spawnSync(this.securityBin, ['-i'], { input: command, encoding: 'utf8' });
    if (result.error) throw new SecretStoreError(`cannot run security: ${result.error.message}`);
    if (result.status !== 0 || /error/i.test(result.stderr)) {
      throw new SecretStoreError(`security add-generic-password failed: ${result.stderr.trim()}`);
    }
  }

  delete(): void {
    const result = spawnSync(
      this.securityBin,
      ['delete-generic-password', '-a', this.account, '-s', KEYCHAIN_SERVICE],
      { encoding: 'utf8' },
    );
    if (result.status !== 0 && result.status !== 44) {
      throw new SecretStoreError(`security delete-generic-password failed: ${result.stderr.trim()}`);
    }
  }
}

/**
 * The platform store: the Keychain on macOS, a 0600 file elsewhere. `CREW_TOKEN_STORE=file` forces the
 * file (headless macOS, tests), so the owner's Keychain is never touched by a test.
 */
export function defaultTokenStore(tokenFile: string, env: NodeJS.ProcessEnv = process.env): TokenStore {
  if (env.CREW_TOKEN_STORE === 'file' || process.platform !== 'darwin') return new FileTokenStore(tokenFile);
  return new KeychainTokenStore(tokenFile);
}
