import assert from 'node:assert/strict';
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ResourceRegistry } from '../src/resources/registry.ts';

test('resources reservations and unverified creation never grant deletion; unknown process retains', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-resources-'));
  let registry = await ResourceRegistry.open(root);
  try {
    const reserved = await registry.reserveOwnedPath({ runId: 'run', kind: 'scratch' });
    await mkdir(reserved.path);
    await writeFile(join(reserved.path, 'bytes'), 'keep');
    await registry.close();
    registry = await ResourceRegistry.open(root);
    assert.deepEqual((await registry.cleanup('run')).retained, [reserved.resourceId]);
    assert.equal(await readFile(join(reserved.path, 'bytes'), 'utf8'), 'keep');
  } finally {
    await registry.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('resources attested path swapped to symlink or hardlinked bytes is retained unchanged', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-resource-alias-'));
  const registry = await ResourceRegistry.open(root);
  try {
    const a = await registry.reserveOwnedPath({ runId: 'run', kind: 'scratch' });
    await registry.createAndAttest(a.resourceId, async (path) => {
      await writeFile(join(path, 'bytes'), 'owner bytes');
    });
    await rename(a.path, `${a.path}-original`);
    await symlink(`${a.path}-original`, a.path);
    assert.ok((await registry.cleanup('run')).retained.includes(a.resourceId));
    assert.equal(await readFile(join(a.path, 'bytes'), 'utf8'), 'owner bytes');
    const b = await registry.reserveOwnedPath({ runId: 'run', kind: 'scratch' });
    await registry.createAndAttest(b.resourceId, async (path) => {
      await writeFile(join(path, 'bytes'), 'run B bytes');
    });
    await link(join(b.path, 'bytes'), join(root, 'run-b-reference'));
    assert.ok((await registry.cleanup('run')).retained.includes(b.resourceId));
    assert.equal(await readFile(join(root, 'run-b-reference'), 'utf8'), 'run B bytes');
    await registry.retain(b.resourceId, 'dirty workspace');
  } finally {
    await registry.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('resources proven stopped run deletes only its owned scratch and retries idempotently', async () => {
  const { ownedRun } = await import('./support/owned-run.ts');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-delete-'));
  const fixture = await ownedRun(root);
  try {
    const a = await fixture.registry.reserveOwnedPath({ runId: 'run', kind: 'scratch' });
    await fixture.registry.createAndAttest(a.resourceId, async (path) => {
      await mkdir(join(path, 'nested'));
      await writeFile(join(path, 'nested', 'bytes'), 'owned');
    });
    const b = await fixture.registry.reserveOwnedPath({ runId: 'other', kind: 'scratch' });
    await fixture.registry.createAndAttest(b.resourceId, async (path) => {
      await writeFile(join(path, 'bytes'), 'other run');
    });
    assert.deepEqual(await fixture.registry.cleanup('run'), {
      deleted: [a.resourceId],
      retained: [],
      failed: [],
    });
    await assert.rejects(readFile(join(a.path, 'nested', 'bytes')));
    assert.equal(await readFile(join(b.path, 'bytes'), 'utf8'), 'other run');
    assert.deepEqual(await fixture.registry.cleanup('run'), {
      deleted: [a.resourceId],
      retained: [],
      failed: [],
    });
  } finally {
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('resources exact stop does not permit parent symlink swap, hardlink alias, dirty or shared cleanup', async () => {
  const { ownedRun } = await import('./support/owned-run.ts');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-delete-negative-'));
  const fixture = await ownedRun(root);
  try {
    for (const kind of ['symlink', 'hardlink', 'dirty', 'reference', 'unattested', 'reserved']) {
      const a = await fixture.registry.reserveOwnedPath({ runId: 'run', kind: 'scratch' });
      if (kind === 'unattested') {
        await assert.rejects(
          fixture.registry.createAndAttest(a.resourceId, async (path) => {
            await writeFile(join(path, 'bytes'), 'owner bytes');
            throw new Error('crash before attest');
          }),
        );
      } else if (kind !== 'reserved')
        await fixture.registry.createAndAttest(a.resourceId, async (path) => {
          await writeFile(join(path, 'bytes'), 'owner bytes');
        });
      if (kind === 'symlink') {
        await rename(a.path, `${a.path}-original`);
        await symlink(`${a.path}-original`, a.path);
      }
      if (kind === 'hardlink') await link(join(a.path, 'bytes'), join(root, 'other-run-bytes'));
      if (kind === 'dirty') await fixture.registry.retain(a.resourceId, 'dirty workspace');
      if (kind === 'reference') await fixture.registry.reference(a.resourceId, 'other-run');
      assert.ok((await fixture.registry.cleanup('run')).retained.includes(a.resourceId));
      if (kind === 'reserved') await assert.rejects(readFile(join(a.path, 'bytes')));
      else assert.equal(await readFile(join(a.path, 'bytes'), 'utf8'), 'owner bytes');
    }
    const eligible = await fixture.registry.reserveOwnedPath({ runId: 'run', kind: 'scratch' });
    await fixture.registry.createAndAttest(eligible.resourceId, async (path) => {
      await writeFile(join(path, 'bytes'), 'eligible owned bytes');
    });
    const parent = join(root, 'resources', 'objects');
    await rename(parent, `${parent}-original`);
    await symlink(`${parent}-original`, parent);
    const result = await fixture.registry.cleanup('run');
    assert.equal(result.deleted.length, 0);
    assert.ok(result.retained.includes(eligible.resourceId));
    assert.equal(await readFile(join(eligible.path, 'bytes'), 'utf8'), 'eligible owned bytes');
    await unlink(parent);
    await mkdir(parent, { mode: 0o700 });
    await mkdir(join(parent, eligible.resourceId), { mode: 0o700 });
    await writeFile(join(parent, eligible.resourceId, 'bytes'), 'replacement owner bytes');
    const replaced = await fixture.registry.cleanup('run');
    assert.ok(replaced.retained.includes(eligible.resourceId));
    assert.equal(
      await readFile(join(parent, eligible.resourceId, 'bytes'), 'utf8'),
      'replacement owner bytes',
    );
    assert.equal(
      await readFile(join(`${parent}-original`, eligible.resourceId, 'bytes'), 'utf8'),
      'eligible owned bytes',
    );
  } finally {
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
test('resources cancellation retains attested scratch even with exact stopped proof', async () => {
  const { ownedRun } = await import('./support/owned-run.ts');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-cancel-cleanup-'));
  const controller = new AbortController();
  const fixture = await ownedRun(root, controller.signal);
  try {
    const a = await fixture.registry.reserveOwnedPath({ runId: 'run', kind: 'scratch' });
    await fixture.registry.createAndAttest(a.resourceId, async (path) => {
      await writeFile(join(path, 'bytes'), 'retain');
    });
    controller.abort();
    assert.deepEqual((await fixture.registry.cleanup('run')).retained, [a.resourceId]);
    assert.equal(await readFile(join(a.path, 'bytes'), 'utf8'), 'retain');
  } finally {
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('resources cleanup recovers a crash after quarantine rename before durable state update', async () => {
  const { ownedRun } = await import('./support/owned-run.ts');
  const { NativeHelper } = await import('../src/journal/native.ts');
  const { fileURLToPath } = await import('node:url');
  const { lstat } = await import('node:fs/promises');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-quarantine-recovery-'));
  const fixture = await ownedRun(root);
  let registry = fixture.registry;
  try {
    const a = await registry.reserveOwnedPath({ runId: 'run', kind: 'scratch' });
    const attested = await registry.createAndAttest(a.resourceId, async (path) => {
      await writeFile(join(path, 'bytes'), 'owned');
    });
    const resourceRoot = join(root, 'resources');
    const r = await lstat(resourceRoot);
    const p = await lstat(join(resourceRoot, 'objects'));
    const q = await lstat(join(resourceRoot, 'quarantine'));
    const helper = await NativeHelper.build(
      resourceRoot,
      fileURLToPath(new URL('../src/resources/native-resources.c', import.meta.url)),
    );
    await helper.run([
      'quarantine',
      resourceRoot,
      String(r.dev),
      String(r.ino),
      'objects',
      String(p.dev),
      String(p.ino),
      a.resourceId,
      attested.device,
      attested.inode,
      String(attested.linkCount),
      String(q.dev),
      String(q.ino),
    ]);
    await registry.close();
    registry = await ResourceRegistry.open(root, { processJournal: fixture.journal });
    assert.deepEqual(await registry.cleanup('run'), { deleted: [a.resourceId], retained: [], failed: [] });
  } finally {
    await registry.close();
    await fixture.launcher.close();
    await fixture.journal.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('resources callback cannot attest a symlink to the owner checkout', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-owner-path-'));
  const owner = join(root, 'owner-checkout');
  await mkdir(owner);
  await writeFile(join(owner, 'bytes'), 'owner');
  const registry = await ResourceRegistry.open(root);
  try {
    const a = await registry.reserveOwnedPath({ runId: 'run', kind: 'scratch' });
    await assert.rejects(
      registry.createAndAttest(a.resourceId, async (path) => {
        await rm(path, { recursive: true });
        await symlink(owner, path);
      }),
      /IDENTITY/,
    );
    assert.deepEqual((await registry.cleanup('run')).retained, [a.resourceId]);
    assert.equal(await readFile(join(owner, 'bytes'), 'utf8'), 'owner');
  } finally {
    await registry.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('resources abort after durable quarantine retains owned bytes and retry removes the same inode', async () => {
  const { ownedRun } = await import('./support/owned-run.ts');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'crew-mid-cleanup-'));
  const fixture = await ownedRun(root);
  await fixture.registry.close();
  const controller = new AbortController();
  let registry = await ResourceRegistry.open(root, {
    processJournal: fixture.journal,
    signal: controller.signal,
    onDurableCleanup: async (stage) => {
      if (stage === 'quarantined') controller.abort();
    },
  });
  try {
    const a = await registry.reserveOwnedPath({ runId: 'run', kind: 'scratch' });
    await registry.createAndAttest(a.resourceId, async (path) => {
      await writeFile(join(path, 'bytes'), 'owned');
    });
    assert.deepEqual((await registry.cleanup('run')).retained, [a.resourceId]);
    assert.equal(
      await readFile(join(root, 'resources', 'quarantine', a.resourceId, 'bytes'), 'utf8'),
      'owned',
    );
    await registry.close();
    registry = await ResourceRegistry.open(root, { processJournal: fixture.journal });
    assert.deepEqual(await registry.cleanup('run'), { deleted: [a.resourceId], retained: [], failed: [] });
  } finally {
    await registry.close();
    await fixture.launcher.close();
    await fixture.journal.close();
    await rm(root, { recursive: true, force: true });
  }
});
