import { execFile } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface CheckoutInfo {
  path: string;
  head: string | null;
  clean: boolean | null;
}

/** Bản tin máy chỉ mang tối đa chừng này checkout. */
export const MAX_CHECKOUTS = 64;

function subdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

async function inspect(path: string): Promise<CheckoutInfo> {
  try {
    const options = { timeout: 10_000, maxBuffer: 1024 * 1024 } as const;
    const top = await run('git', ['-C', path, 'rev-parse', '--show-toplevel', 'HEAD'], options);
    const [root, head] = top.stdout.trim().split('\n');
    // `.git` hỏng thì git dò lên thư mục cha: chỉ nhận khi gốc repo đúng là thư mục này.
    if (!root || realpathSync(root) !== realpathSync(path) || !head || !/^[0-9a-f]{40}$/.test(head))
      return { path, head: null, clean: null };
    const status = await run('git', ['-C', path, 'status', '--porcelain'], options);
    return { path, head, clean: status.stdout.trim() === '' };
  } catch {
    return { path, head: null, clean: null };
  }
}

/** Checkout của agent: thư mục git `~/crew-agents/<project>/<role>`, tối đa 64, sắp theo path. Không bao giờ ném. */
export async function scanCheckouts(home: string): Promise<CheckoutInfo[]> {
  const candidates = subdirectories(join(home, 'crew-agents'))
    .flatMap(subdirectories)
    .filter((dir) => existsSync(join(dir, '.git')))
    .sort()
    .slice(0, MAX_CHECKOUTS);
  return Promise.all(candidates.map(inspect));
}
