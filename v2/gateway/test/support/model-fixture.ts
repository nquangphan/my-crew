import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const identities = new Map<string, { dev: number; ino: number; uid: number }>();
export async function modelFixtureRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(await realpath(tmpdir()), `crew-task2-${label}-`)),
    stat = await lstat(root);
  const identity = { dev: stat.dev, ino: stat.ino, uid: stat.uid };
  identities.set(root, identity);
  console.log(JSON.stringify({ type: 'task2-owned-resource', action: 'create', root, ...identity }));
  return root;
}
export async function removeModelFixture(root: string): Promise<void> {
  const identity = identities.get(root),
    stat = await lstat(root);
  if (
    !identity ||
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    stat.dev !== identity.dev ||
    stat.ino !== identity.ino ||
    stat.uid !== identity.uid
  )
    throw new Error('FIXTURE_IDENTITY_MISMATCH');
  await rm(root, { recursive: true, force: false });
  identities.delete(root);
  try {
    await lstat(root);
    throw new Error('FIXTURE_NOT_REMOVED');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  console.log(JSON.stringify({ type: 'task2-owned-resource', action: 'removed', root, ...identity }));
}
