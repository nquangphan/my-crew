import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadAttachmentConfig } from '../src/attachments/config.ts';
import { createFileBlobStore, renameOwnedStage, writePrivateJson } from '../src/attachments/storage.ts';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
async function* body(bytes: Uint8Array) {
  yield bytes;
}

test('attachment storage keeps exact bytes and separates equal digests by attachment', async () => {
  const fixture = await ownedPureRoot();
  const root = fixture.root;
  try {
    const store = await createFileBlobStore({ root: await realpath(root) });
    const bytes = Buffer.from('Nguyên bản\n');
    const a = randomUUID();
    const b = randomUUID();
    const first = await store.receive(
      { attachmentId: a, generation: '1', expectedBytes: bytes.length, expectedSha256: sha(bytes) },
      body(bytes),
      new AbortController().signal,
    );
    const second = await store.receive(
      { attachmentId: b, generation: '1', expectedBytes: bytes.length, expectedSha256: sha(bytes) },
      body(bytes),
      new AbortController().signal,
    );
    assert.notEqual(first.key, second.key);
    assert.equal(await store.verify(first), 'present');
    const chunks: Uint8Array[] = [];
    for await (const chunk of await store.open(first)) chunks.push(chunk);
    assert.deepEqual(Buffer.concat(chunks), bytes);
  } finally {
    await fixture.close();
  }
});

test('attachment storage rejects truncated and oversized streams without publishing original', async () => {
  const fixture = await ownedPureRoot();
  const root = fixture.root;
  try {
    const store = await createFileBlobStore({ root: await realpath(root) });
    const bytes = Buffer.from('abc');
    for (const wrong of [2, 4]) {
      const id = randomUUID();
      await assert.rejects(
        store.receive(
          { attachmentId: id, generation: '1', expectedBytes: wrong, expectedSha256: sha(bytes) },
          body(bytes),
          new AbortController().signal,
        ),
      );
      assert.equal(
        await store.verify({ key: `uploads/${id}/original`, sha256: sha(bytes), byteLength: wrong }),
        'missing',
      );
    }
  } finally {
    await fixture.close();
  }
});

test('attachment config requires absolute private root and bounds operator limits', () => {
  assert.throws(() => loadAttachmentConfig({}), /ROOT/);
  assert.throws(() => loadAttachmentConfig({ CREW_V2_ATTACHMENT_STORAGE_ROOT: 'relative' }), /ROOT/);
  assert.throws(
    () =>
      loadAttachmentConfig({
        CREW_V2_ATTACHMENT_STORAGE_ROOT: '/tmp/attachments',
        CREW_V2_ATTACHMENT_MAX_FILE_BYTES: '999999999',
      }),
    /LIMIT/,
  );
  const c = loadAttachmentConfig({ CREW_V2_ATTACHMENT_STORAGE_ROOT: '/tmp/attachments' });
  assert.equal(c.maxFileBytes, 25 * 1024 * 1024);
  assert.equal(c.chunkBytes, 64 * 1024);
});

test('attachment storage derivative publication is separate from original', async () => {
  const fixture = await ownedPureRoot();
  const root = fixture.root;
  try {
    const canonicalRoot = await realpath(root);
    const store = await createFileBlobStore({
      root: canonicalRoot,
      persistIntent: async (intent) => {
        await writePrivateJson(canonicalRoot, join(canonicalRoot, `.journal.${randomUUID()}.json`), intent);
      },
    });
    const original = Buffer.from('one');
    const derived = Buffer.from('two');
    const attachmentId = randomUUID();
    const a = await store.receive(
      { attachmentId, generation: '1', expectedBytes: 3, expectedSha256: sha(original) },
      body(original),
      new AbortController().signal,
    );
    const d = await store.publishDerivative(
      {
        attachmentId,
        extractionId: randomUUID(),
        derivativeId: randomUUID(),
        generation: '1',
        expectedBytes: 3,
        expectedSha256: sha(derived),
      },
      body(derived),
      new AbortController().signal,
    );
    assert.equal(await store.verify(a), 'present');
    assert.equal(await store.verify(d), 'present');
  } finally {
    await fixture.close();
  }
});

test('attachment storage leaves a published blob inspectable after injected failure', async () => {
  const fixture = await ownedPureRoot();
  const root = fixture.root;
  const id = randomUUID();
  const bytes = Buffer.from('safe');
  try {
    const store = await createFileBlobStore({
      root: await realpath(root),
      fault: async (point) => {
        if (point === 'after-publish') throw new Error('CRASH_INJECTION');
      },
    });
    await assert.rejects(
      store.receive(
        { attachmentId: id, generation: '1', expectedBytes: 4, expectedSha256: sha(bytes) },
        body(bytes),
        new AbortController().signal,
      ),
      /CRASH_INJECTION/,
    );
    assert.equal(
      await store.verify({ key: `uploads/${id}/original`, sha256: sha(bytes), byteLength: 4 }),
      'present',
    );
  } finally {
    await fixture.close();
  }
});

// Breaks caught: mutable policy, following owner-marker symlinks, publishing another
// UUID/generation, blindly accepting foreign destination, late publication after abort.
test('attachment config freezes accepted policy including nested limits and extensions', () => {
  const config = loadAttachmentConfig({ CREW_V2_ATTACHMENT_STORAGE_ROOT: '/tmp/private-attachments' });
  assert.throws(() => {
    config.maxFileBytes = 1;
  }, TypeError);
  assert.throws(() => {
    config.limits.maxPdfPages = 1;
  }, TypeError);
  assert.throws(() => {
    config.allowedExtensions.push('exe');
  }, TypeError);
});

async function ownedPureRoot() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-v2-attachments-')));
  const identity = await lstat(root);
  const nonce = randomUUID();
  await writePrivateJson(root, join(root, '.fixture-owner.json'), { nonce });
  console.info(`attachment scratch created ${root} nonceSha256=${sha(Buffer.from(nonce))}`);
  return {
    root,
    async close() {
      const marker = JSON.parse(await readFile(join(root, '.fixture-owner.json'), 'utf8')) as {
        nonce: string;
      };
      const actual = await lstat(root);
      assert.equal(marker.nonce, nonce);
      assert.equal(actual.isSymbolicLink(), false);
      assert.equal(actual.dev, identity.dev);
      assert.equal(actual.ino, identity.ino);
      await rm(root, { recursive: true, force: true });
      console.info(`attachment scratch removed ${root}`);
    },
  };
}
async function pureFixture(fn: (root: string) => Promise<void>) {
  const fixture = await ownedPureRoot();
  try {
    await fn(fixture.root);
  } finally {
    await fixture.close();
  }
}

test('attachment storage rejects a symlink owner marker before opening stage', async () =>
  pureFixture(async (root) => {
    const store = await createFileBlobStore({ root });
    const id = randomUUID();
    const bytes = Buffer.from('x');
    await mkdir(join(root, 'uploads', id));
    const outside = join(root, 'foreign.json');
    await writeFile(outside, JSON.stringify({ kind: 'upload', id, nonce: randomUUID() }), { mode: 0o600 });
    await symlink(outside, join(root, 'uploads', id, '.owner.json'));
    await assert.rejects(
      store.receive(
        { attachmentId: id, generation: '1', expectedBytes: 1, expectedSha256: sha(bytes) },
        body(bytes),
        new AbortController().signal,
      ),
      /SYMLINK/,
    );
    await assert.rejects(access(join(root, 'uploads', id, 'stage.1')), { code: 'ENOENT' });
  }));

test('attachment storage binds publication to exact attachment and generation', async () =>
  pureFixture(async (root) => {
    const id = randomUUID();
    const bytes = Buffer.from('x');
    const store = await createFileBlobStore({
      root,
      fault: async (point) => {
        if (point === 'after-stage-sync') throw new Error('INJECT');
      },
    });
    await assert.rejects(
      store.receive(
        { attachmentId: id, generation: '1', expectedBytes: 1, expectedSha256: sha(bytes) },
        body(bytes),
        new AbortController().signal,
      ),
      /INJECT/,
    );
    await assert.rejects(
      renameOwnedStage(
        `uploads/${id}/stage.1`,
        `uploads/${id}/original`,
        { attachmentId: randomUUID(), generation: '2', sha256: sha(bytes), byteLength: 1 },
        root,
      ),
      /KEY|GENERATION|OWNERSHIP/,
    );
    assert.equal(
      await store.verify({ key: `uploads/${id}/original`, sha256: sha(bytes), byteLength: 1 }),
      'missing',
    );
  }));

test('attachment storage never accepts a foreign existing destination even with equal digest', async () =>
  pureFixture(async (root) => {
    const id = randomUUID();
    const bytes = Buffer.from('x');
    const store = await createFileBlobStore({ root });
    await mkdir(join(root, 'uploads', id));
    await writeFile(
      join(root, 'uploads', id, '.owner.json'),
      JSON.stringify({ kind: 'upload', id, nonce: randomUUID() }),
      { mode: 0o600 },
    );
    await writeFile(join(root, 'uploads', id, 'original'), bytes);
    await assert.rejects(
      store.receive(
        { attachmentId: id, generation: '1', expectedBytes: 1, expectedSha256: sha(bytes) },
        body(bytes),
        new AbortController().signal,
      ),
      /DESTINATION|OWNERSHIP/,
    );
  }));

test('attachment storage prevents publication after abort at stage flush', async () =>
  pureFixture(async (root) => {
    const controller = new AbortController();
    const id = randomUUID();
    const bytes = Buffer.from('x');
    const store = await createFileBlobStore({
      root,
      fault: async (point) => {
        if (point === 'after-stage-sync') controller.abort();
      },
    });
    await assert.rejects(
      store.receive(
        { attachmentId: id, generation: '1', expectedBytes: 1, expectedSha256: sha(bytes) },
        body(bytes),
        controller.signal,
      ),
      /ABORTED/,
    );
    assert.equal(
      await store.verify({ key: `uploads/${id}/original`, sha256: sha(bytes), byteLength: 1 }),
      'missing',
    );
  }));

test('attachment storage can reopen durable root and verify originals', async () =>
  pureFixture(async (root) => {
    const bytes = Buffer.from('restart');
    const id = randomUUID();
    const a = await createFileBlobStore({ root });
    const blob = await a.receive(
      { attachmentId: id, generation: '1', expectedBytes: bytes.length, expectedSha256: sha(bytes) },
      body(bytes),
      new AbortController().signal,
    );
    const b = await createFileBlobStore({ root });
    assert.equal(await b.verify(blob), 'present');
  }));

test('attachment storage requires durable journal integration before derivative bytes', async () =>
  pureFixture(async (root) => {
    const store = await createFileBlobStore({ root });
    const bytes = Buffer.from('derived');
    const attachmentId = randomUUID(),
      extractionId = randomUUID(),
      derivativeId = randomUUID();
    await assert.rejects(
      store.publishDerivative(
        {
          attachmentId,
          extractionId,
          derivativeId,
          generation: '1',
          expectedBytes: bytes.length,
          expectedSha256: sha(bytes),
        },
        body(bytes),
        new AbortController().signal,
      ),
      /INTENT_NOT_CONFIGURED/,
    );
    assert.equal(
      await store.verify({
        key: `derivatives/${attachmentId}/${extractionId}/${derivativeId}`,
        sha256: sha(bytes),
        byteLength: bytes.length,
      }),
      'missing',
    );
  }));

test('attachment storage publishes multiple derivatives in one extraction generation without collision', async () =>
  pureFixture(async (root) => {
    const journal = join(root, '.derivative-journal.json');
    const bytes = Buffer.from('derived');
    const attachmentId = randomUUID(),
      extractionId = randomUUID();
    const entries: unknown[] = [];
    const store = await createFileBlobStore({
      root,
      persistIntent: async (intent) => {
        entries.push(intent);
        await writeFile(journal, JSON.stringify(entries), { mode: 0o600 });
      },
    });
    const a = await store.publishDerivative(
      {
        attachmentId,
        extractionId,
        derivativeId: randomUUID(),
        generation: '1',
        expectedBytes: bytes.length,
        expectedSha256: sha(bytes),
      },
      body(bytes),
      new AbortController().signal,
    );
    const b = await store.publishDerivative(
      {
        attachmentId,
        extractionId,
        derivativeId: randomUUID(),
        generation: '1',
        expectedBytes: bytes.length,
        expectedSha256: sha(bytes),
      },
      body(bytes),
      new AbortController().signal,
    );
    assert.notEqual(a.key, b.key);
    assert.equal(await store.verify(a), 'present');
    assert.equal(await store.verify(b), 'present');
    assert.equal((JSON.parse(await readFile(journal, 'utf8')) as unknown[]).length, 2);
  }));

test('attachment storage cleanup rejects guessed nonce and leaves original intact', async () =>
  pureFixture(async (root) => {
    const store = await createFileBlobStore({ root });
    const bytes = Buffer.from('kept');
    const id = randomUUID();
    const blob = await store.receive(
      { attachmentId: id, generation: '1', expectedBytes: bytes.length, expectedSha256: sha(bytes) },
      body(bytes),
      new AbortController().signal,
    );
    await assert.rejects(store.removeOwned({ key: blob.key, ownershipNonce: randomUUID() }), /OWNERSHIP/);
    assert.equal(await store.verify(blob), 'present');
    const marker = JSON.parse(await readFile(join(root, 'uploads', id, '.owner.json'), 'utf8')) as {
      nonce: string;
    };
    assert.equal(await store.removeOwned({ key: blob.key, ownershipNonce: marker.nonce }), 'removed');
    assert.equal(await store.removeOwned({ key: blob.key, ownershipNonce: marker.nonce }), 'absent');
  }));

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  observeWriterStopped,
  parseLinuxStartTicks,
  readLocalWriterIdentity,
} from '../src/attachments/receivers.ts';

test('attachment receiver parses Linux comm containing spaces and parentheses without birth-field drift', () => {
  const fields = ['S', ...Array.from({ length: 18 }, () => '0'), '123456', '0'];
  assert.equal(parseLinuxStartTicks(`123 (server (upload worker)) ${fields.join(' ')}`), '123456');
  assert.throws(() => parseLinuxStartTicks('123 malformed stat'), /STAT_INVALID/);
});

test('attachment receiver rejects native writer setup on unsupported host', {
  skip: process.platform === 'linux',
}, async () => {
  await assert.rejects(readLocalWriterIdentity(randomUUID()), /LINUX_WRITER_REQUIRED/);
});

test('attachment receiver distinguishes exact native birth from pid reuse and unknown namespace', {
  skip: process.platform !== 'linux',
}, async () => {
  const current = await readLocalWriterIdentity(randomUUID());
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  await once(child, 'spawn');
  const pid = child.pid;
  assert.ok(pid);
  const exit = once(child, 'exit');
  try {
    const ticks = parseLinuxStartTicks(await readFile(`/proc/${pid}/stat`, 'utf8'));
    const writer = { ...current, instanceId: randomUUID(), pid, startTicks: ticks };
    assert.equal(await observeWriterStopped(writer, current), false);
    assert.equal(await observeWriterStopped({ ...writer, startTicks: 'invalid' }, current), false);
    assert.equal(await observeWriterStopped({ ...writer, pid: -1 }, current), false);
    assert.equal(await observeWriterStopped({ ...writer, procNamespaceInode: '999999999' }, current), false);
    assert.equal(
      await observeWriterStopped({ ...writer, startTicks: (BigInt(ticks) + 1n).toString() }, current),
      true,
    );
    child.kill('SIGTERM');
    await exit;
    assert.equal(await observeWriterStopped(writer, { ...current, storageHostId: randomUUID() }), false);
    assert.equal(await observeWriterStopped(writer, current), true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await exit;
    }
  }
});

import type { ManagedReceiverRegistry } from '../src/attachments/receivers.ts';
import { createStageServices } from '../src/attachments/staging.ts';
import type { Db } from '../src/platform/contracts.ts';

test('attachment staging private lease journal serializes SQL timestamps before receiver work', async () => {
  // Test-owned SQL boundary data only: actual mutate/canonical codec stays in path.
  // This is no migration fixture and does not claim DB/receiver acceptance.
  const id = randomUUID(),
    composeId = randomUUID(),
    receiverId = randomUUID(),
    conversationId = randomUUID();
  const config = loadAttachmentConfig({ CREW_V2_ATTACHMENT_STORAGE_ROOT: '/tmp/fixture-private-lease' });
  const { storageRoot: _root, ...acceptedPolicy } = config;
  const compose = {
    id: composeId,
    owner_id: 'owner',
    project_id: null,
    ticket_id: null,
    conversation_id: conversationId,
    purpose: 'assistant_message',
    state: 'open',
    revision: 1,
    expires_at: new Date('2030-01-01'),
    created_at: new Date('2026-01-01'),
  };
  const upload = {
    id,
    compose_id: composeId,
    owner_id: 'owner',
    initial_project_id: null,
    file_name: 'note.txt',
    declared_mime: 'text/plain',
    detected_mime: null,
    expected_bytes: '1',
    expected_sha256: sha(Buffer.from('x')),
    storage_key: `uploads/${id}/original`,
    stage_key: null,
    state: 'reserved',
    generation: '0',
    receiver_id: null,
    durable_at: null,
    linked_at: null,
    quota_released_at: null,
    rejection_code: null,
    abandoned_at: null,
    expires_at: new Date('2030-01-01'),
    created_at: new Date('2026-01-01'),
    ownership_nonce: randomUUID(),
    policy_sha256: config.policySha256,
    accepted_config: acceptedPolicy,
  };
  const query = async (parts: TemplateStringsArray) => {
    const sql = parts.join('?');
    if (sql.includes('select compose_id from attachment_uploads')) return [{ compose_id: composeId }];
    if (sql.includes('select project_id,ticket_id,conversation_id'))
      return [{ project_id: null, ticket_id: null, conversation_id: conversationId }];
    if (sql.includes('select * from attachment_compose_sessions')) return [compose];
    if (sql.includes('select * from attachment_uploads')) return [upload];
    if (sql.includes('select value from event_cursor')) return [{ value: '0' }];
    return [];
  };
  const db = Object.assign(query, {
    begin: async <T>(work: (tx: Db) => Promise<T>) => work(db as unknown as Db),
    json: (value: unknown) => value,
  }) as unknown as Db;
  const receivers = {
    register: async () => ({
      id: receiverId,
      attachmentId: id,
      generation: '1',
      identity: {
        instanceId: randomUUID(),
        storageHostId: randomUUID(),
        linuxBootId: 'fixture',
        procNamespaceInode: 'fixture',
        pid: 1,
        startTicks: '1',
      },
      stageKey: `uploads/${id}/stage.1.${receiverId}`,
      operationNonce: randomUUID(),
      state: 'registered' as const,
      abortRequested: false,
    }),
    requestAbort: async () => {},
    closeAndAcknowledge: async () => {
      throw new Error('WRITER_STILL_ACTIVE');
    },
    proveStopped: async () => null,
    control: {
      run: async () => {
        throw new Error('RECEIVER_BOUNDARY_REACHED');
      },
    },
  } satisfies ManagedReceiverRegistry;
  const store = {
    receive: async () => {
      throw new Error('UNREACHABLE');
    },
    publishDerivative: async () => {
      throw new Error('UNREACHABLE');
    },
    verify: async () => 'missing' as const,
    open: async () => body(Buffer.alloc(0)),
    removeOwned: async () => 'absent' as const,
  };
  const stage = createStageServices({ db, store, receivers, config, now: () => new Date('2026-10-02') });
  await assert.rejects(
    stage.receive(id, { kind: 'owner', id: 'owner' }, body(Buffer.from('x')), new AbortController().signal),
    /RECEIVER_BOUNDARY_REACHED/,
  );
});
