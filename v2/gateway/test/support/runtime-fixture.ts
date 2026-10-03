import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function runtimeRoot() {
  const nonce = randomUUID();
  const root = await mkdtemp(join(await realpath(tmpdir()), `crew-runtime-${nonce}-`));
  const initial = await lstat(root);
  const identity = { nonce, dev: initial.dev, ino: initial.ino, uid: initial.uid };
  console.log(JSON.stringify({ action: 'created', root, ...identity }));
  return {
    root,
    async cleanup() {
      const stat = await lstat(root);
      assert(stat.isDirectory() && !stat.isSymbolicLink());
      assert.deepEqual(
        { dev: stat.dev, ino: stat.ino, uid: stat.uid },
        { dev: initial.dev, ino: initial.ino, uid: initial.uid },
      );
      await rm(root, { recursive: true });
      await assert.rejects(lstat(root), { code: 'ENOENT' });
      console.log(JSON.stringify({ action: 'removed-after-writer-close', root, ...identity }));
    },
  };
}
