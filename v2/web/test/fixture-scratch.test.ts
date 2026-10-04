import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { OwnedResource } from '../e2e/support/fixture.ts';
import { closeScratches, createAttachmentScratch } from '../scripts/e2e-fixture.ts';

async function scratch(label: string) {
  const path = await mkdtemp(join(tmpdir(), `crew-v2-web-${label}-`));
  const entry = await stat(path);
  const identity = `${entry.dev}:${entry.ino}`;
  const resource: OwnedResource = {
    kind: 'scratch',
    id: path,
    ownershipNonce: `unit-${label}`,
    startIdentity: identity,
  };
  return { path, identity, resource, entry };
}

test('attachment scratch REMOVE hết hạn giữ nguyên cả scratch của attachment lẫn registry chính', async () => {
  const main = await scratch('main');
  const storage = await scratch('storage');
  const registryPath = join(main.path, 'registry.json');
  await writeFile(registryPath, '{"phase":"stopped"}', { mode: 0o600 });
  let release: () => void = () => undefined;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let rmCalls = 0;
  try {
    const outcome = await closeScratches({
      main: { resource: main.resource, path: main.path, identity: main.identity },
      attachment: { resource: storage.resource, path: storage.path, identity: storage.identity },
      deadlineMs: 200,
      removal: {
        stat: async (path) => {
          if (path === storage.path) await delayed;
          return path === storage.path
            ? { dev: storage.entry.dev, ino: storage.entry.ino }
            : { dev: main.entry.dev, ino: main.entry.ino };
        },
        rm: async (path, options) => {
          rmCalls++;
          await rm(path, options);
        },
      },
    });
    assert.deepEqual(
      outcome.results.map((result) => [result.resourceId, result.state, result.reason]),
      [
        [storage.path, 'unknown', 'REMOVE_DEADLINE'],
        [main.path, 'unknown', 'PREVIOUS_CLEANUP_UNKNOWN'],
      ],
    );
    assert.equal(outcome.phase, 'unknown:ATTACHMENT_SCRATCH_REMOVE');
    release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(rmCalls, 0, 'Callback đã abort không được khởi chạy rm');
    assert.equal(existsSync(storage.path), true);
    assert.equal(existsSync(registryPath), true, 'Registry UNKNOWN phải còn để đối chiếu');
  } finally {
    release();
    await rm(storage.path, { recursive: true, force: true });
    await rm(main.path, { recursive: true, force: true });
  }
});

test('scratch attachment được xóa trước scratch chính khi mọi thứ đã dừng', async () => {
  const main = await scratch('main-ok');
  const storage = await scratch('storage-ok');
  const outcome = await closeScratches({
    main: { resource: main.resource, path: main.path, identity: main.identity },
    attachment: { resource: storage.resource, path: storage.path, identity: storage.identity },
  });
  assert.deepEqual(
    outcome.results.map((result) => [result.resourceId, result.state]),
    [
      [storage.path, 'removed'],
      [main.path, 'removed'],
    ],
  );
  assert.equal(outcome.phase, 'stopped');
  assert.equal(existsSync(storage.path) || existsSync(main.path), false);
});

test('tạo attachment scratch lỗi giữa mkdtemp và đăng ký thì xóa đúng thư mục vừa tạo', async () => {
  const created: string[] = [];
  const removed: string[] = [];
  await assert.rejects(
    createAttachmentScratch({
      mkdtemp: async (prefix) => {
        const path = await mkdtemp(prefix);
        created.push(path);
        return path;
      },
      realpath: async (path) => path,
      stat: async () => {
        throw new Error('STAT_FAILED');
      },
      rm: async (path, options) => {
        removed.push(path);
        await rm(path, options);
      },
    }),
    /STAT_FAILED/,
  );
  assert.equal(created.length, 1);
  assert.deepEqual(removed, created);
  assert.equal(existsSync(created[0] ?? ''), false);
});

test('tạo attachment scratch thành công trả path đã resolve và identity dev:ino', async () => {
  const made = await createAttachmentScratch();
  try {
    assert.match(made.path, /crew-v2-web-attachments-/);
    const entry = await stat(made.path);
    assert.equal(made.identity, `${entry.dev}:${entry.ino}`);
  } finally {
    await rm(made.path, { recursive: true, force: true });
  }
});
