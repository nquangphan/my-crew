import assert from 'node:assert/strict';
import test from 'node:test';
import { createStageServices } from '../src/attachments/staging.ts';
import {
  attachmentFixture,
  bufferBody,
  runLinuxReceiverCase,
  sha,
  verifyAttachmentMigrationRestore,
} from './support/attachments.ts';
import { databaseFixture } from './support/db.ts';
import { owner } from './support/tickets.ts';

test('attachment staging reserves under owner quota and keeps bytes through ready commit', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      const bytes = Buffer.from('Nguyên bản\n');
      const compose = await f.mutation('compose', (tx) =>
        f.stage.createCompose(tx, { projectId: f.project.id, ticketId: null, purpose: 'ticket' }, owner),
      );
      const reserved = await f.mutation('reserve', (tx) =>
        f.stage.reserve(
          tx,
          {
            composeSessionId: compose.id,
            expectedRevision: 1,
            fileName: 'note.txt',
            declaredMime: 'text/plain',
            byteLength: bytes.length,
            sha256: sha(bytes),
          },
          owner,
        ),
      );
      const ready = await f.stage.receive(
        reserved.attachment.attachmentId,
        owner,
        bufferBody(bytes),
        new AbortController().signal,
      );
      assert.equal(ready.state, 'ready');
      assert.equal(ready.sha256, sha(bytes));
      const [row] =
        await db`select storage_key,durable_at,receiver_id from attachment_uploads where id=${ready.attachmentId}`;
      assert.ok(row.durable_at);
      assert.ok(row.receiver_id);
      assert.equal(
        await f.store.verify({ key: String(row.storage_key), sha256: sha(bytes), byteLength: bytes.length }),
        'present',
      );
    } finally {
      await f.close();
    }
  });
});

test('attachment staging refuses machine and stale compose revision', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      const compose = await f.mutation('compose', (tx) =>
        f.stage.createCompose(tx, { projectId: f.project.id, ticketId: null, purpose: 'ticket' }, owner),
      );
      const spec = {
        composeSessionId: compose.id,
        expectedRevision: 1,
        fileName: 'note.txt',
        declaredMime: 'text/plain',
        byteLength: 1,
        sha256: sha(Buffer.from('x')),
      };
      await assert.rejects(
        f.mutation('machine', (tx) => f.stage.reserve(tx, spec, { kind: 'machine', id: f.project.id })),
        { status: 403 },
      );
      await f.mutation('reserve', (tx) => f.stage.reserve(tx, spec, owner));
      await assert.rejects(
        f.mutation('stale', (tx) => f.stage.reserve(tx, spec, owner)),
        { status: 409 },
      );
    } finally {
      await f.close();
    }
  });
});

import { randomUUID } from 'node:crypto';
import { appendComment } from '../src/tickets/decisions.ts';
import { inputTicket } from './support/tickets.ts';

async function composeAndReserve(
  f: Awaited<ReturnType<typeof attachmentFixture>>,
  bytes: Uint8Array,
  changes: Record<string, unknown> = {},
) {
  const compose = await f.mutation(randomUUID(), (tx) =>
    f.stage.createCompose(tx, { projectId: f.project.id, ticketId: null, purpose: 'ticket' }, owner),
  );
  const spec = {
    composeSessionId: compose.id,
    expectedRevision: 1,
    fileName: 'note.txt',
    declaredMime: 'text/plain',
    byteLength: bytes.length,
    sha256: sha(bytes),
    ...changes,
  };
  const reserved = await f.mutationWith(randomUUID(), spec, (tx) => f.stage.reserve(tx, spec, owner));
  return { compose, spec, reserved, id: reserved.attachment.attachmentId };
}

test('attachment staging validates name MIME size limits and permits exact limit and empty text', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db, { env: { CREW_V2_ATTACHMENT_MAX_FILE_BYTES: '4' } });
    try {
      for (const changes of [
        { fileName: '../note.txt' },
        { fileName: 'bad\u0000.txt' },
        { fileName: 'note.svg' },
        { fileName: 'image.png', declaredMime: 'text/plain' },
        { byteLength: 5 },
      ]) {
        await assert.rejects(composeAndReserve(f, Buffer.from('x'), changes));
      }
      for (const bytes of [Buffer.alloc(0), Buffer.from('abcd')]) {
        const slot = await composeAndReserve(f, bytes);
        const attachment = await f.stage.receive(
          slot.id,
          owner,
          bufferBody(bytes),
          new AbortController().signal,
        );
        assert.equal(attachment.state, 'ready');
        assert.equal(attachment.byteLength, bytes.length);
      }
    } finally {
      await f.close();
    }
  });
});

test('attachment staging rejects wrong bytes malformed UTF binary text and magic before original publication', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      const cases = [
        { bytes: Buffer.from('abc'), changes: { byteLength: 4 } },
        { bytes: Buffer.from('abcd'), changes: { byteLength: 3 } },
        { bytes: Buffer.from([0xff, 0xff]), changes: {} },
        { bytes: Buffer.concat([Buffer.alloc(600, 65), Buffer.from([0])]), changes: {} },
        { bytes: Buffer.from('not png'), changes: { fileName: 'image.png', declaredMime: 'image/png' } },
        { bytes: Buffer.from('different hash'), changes: { sha256: sha(Buffer.from('other')) } },
      ];
      for (const entry of cases) {
        const slot = await composeAndReserve(f, entry.bytes, entry.changes);
        await assert.rejects(
          f.stage.receive(slot.id, owner, bufferBody(entry.bytes), new AbortController().signal),
        );
        const [upload] =
          await db`select state,storage_key,quota_released_at from attachment_uploads where id=${slot.id}`;
        assert.equal(upload.state, 'rejected');
        assert.equal(upload.quota_released_at, null);
        assert.equal(
          await f.store.verify({
            key: String(upload.storage_key),
            sha256: slot.spec.sha256,
            byteLength: slot.spec.byteLength,
          }),
          'missing',
        );
        const [receiver] = await db`select state from attachment_receivers where attachment_id=${slot.id}`;
        assert.equal(receiver.state, 'closed');
      }
    } finally {
      await f.close();
    }
  });
});

test('attachment staging accepts split UTF16 BOM as text without browser inline interpretation', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      const bytes = Buffer.from([0xff, 0xfe, 0x41, 0x00]);
      const slot = await composeAndReserve(f, bytes);
      async function* chunks() {
        for (const byte of bytes) yield Uint8Array.of(byte);
      }
      const attachment = await f.stage.receive(slot.id, owner, chunks(), new AbortController().signal);
      assert.equal(attachment.state, 'ready');
      assert.equal(attachment.mime, 'text/plain');
    } finally {
      await f.close();
    }
  });
});

test('attachment staging reserve replay checks canonical request and same digest keeps distinct originals', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      const slot = await composeAndReserve(f, Buffer.from('one'));
      const spec = { ...slot.spec, expectedRevision: slot.reserved.selectionRevision };
      const key = randomUUID();
      const a = await f.mutationWith(key, spec, (tx) => f.stage.reserve(tx, spec, owner));
      const replay = await f.mutationWith(key, spec, (tx) => f.stage.reserve(tx, spec, owner));
      assert.equal(a.attachment.attachmentId, replay.attachment.attachmentId);
      await assert.rejects(
        f.mutationWith(key, { ...spec, fileName: 'changed.txt' }, (tx) =>
          f.stage.reserve(tx, { ...spec, fileName: 'changed.txt' }, owner),
        ),
        { code: 'IDEMPOTENCY_CONFLICT' },
      );
      assert.notEqual(a.attachment.attachmentId, slot.id);
      const rows = await db`select storage_key from attachment_uploads where compose_id=${slot.compose.id}`;
      assert.equal(new Set(rows.map((row) => row.storage_key)).size, 2);
    } finally {
      await f.close();
    }
  });
});

test('attachment staging serializes owner quota reservations and holds rejected and abandoned quota', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db, {
      env: {
        CREW_V2_ATTACHMENT_MAX_FILE_BYTES: '4',
        CREW_V2_ATTACHMENT_MAX_COMPOSE_BYTES: '4',
        CREW_V2_ATTACHMENT_MAX_OWNER_STAGING_BYTES: '4',
      },
    });
    try {
      const [a, b] = await Promise.all([
        f.mutation(randomUUID(), (tx) =>
          f.stage.createCompose(tx, { projectId: f.project.id, ticketId: null, purpose: 'ticket' }, owner),
        ),
        f.mutation(randomUUID(), (tx) =>
          f.stage.createCompose(tx, { projectId: f.project.id, ticketId: null, purpose: 'ticket' }, owner),
        ),
      ]);
      const reserve = (id: string) => {
        const spec = {
          composeSessionId: id,
          expectedRevision: 1,
          fileName: 'note.txt',
          declaredMime: 'text/plain',
          byteLength: 4,
          sha256: sha(Buffer.from('abcd')),
        };
        return f.mutationWith(randomUUID(), spec, (tx) => f.stage.reserve(tx, spec, owner));
      };
      const results = await Promise.allSettled([reserve(a.id), reserve(b.id)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const rejected = results.find((r) => r.status === 'rejected');
      assert.ok(rejected && rejected.status === 'rejected');
      assert.equal(rejected.reason.code, 'ATTACHMENT_OWNER_QUOTA');
      const success = results.find((r) => r.status === 'fulfilled');
      assert.ok(success && success.status === 'fulfilled');
      const upload = success.value.attachment;
      await assert.rejects(
        f.stage.receive(
          upload.attachmentId,
          owner,
          bufferBody(Buffer.from('x')),
          new AbortController().signal,
        ),
      );
      await f.mutation(randomUUID(), (tx) =>
        f.stage.abandonUpload(
          tx,
          {
            composeSessionId: upload.composeSessionId,
            attachmentId: upload.attachmentId,
            expectedRevision: 2,
          },
          owner,
        ),
      );
      const [quota] =
        await db`select sum(expected_bytes)::int as held from attachment_uploads where quota_released_at is null`;
      assert.equal(quota.held, 4);
    } finally {
      await f.close();
    }
  });
});

test('attachment staging validates ready PUT replay bytes and emits only owner-scoped exact metadata', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      const bytes = Buffer.from('safe');
      const slot = await composeAndReserve(f, bytes);
      await f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal);
      const replay = await f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal);
      assert.equal(replay.state, 'ready');
      await assert.rejects(
        f.stage.receive(slot.id, owner, bufferBody(Buffer.from('evil')), new AbortController().signal),
        { code: 'ATTACHMENT_REPLAY_MISMATCH' },
      );
      const events =
        await db`select project_id,ticket_id,audience_machine_id,data from events where type='attachment.changed'`;
      assert.equal(events.length, 1);
      assert.equal(events[0].project_id, null);
      assert.equal(events[0].ticket_id, null);
      assert.equal(events[0].audience_machine_id, null);
      assert.deepEqual(events[0].data, { attachmentId: slot.id, state: 'ready', extraction: 'pending' });
    } finally {
      await f.close();
    }
  });
});

test('attachment staging refuses ready publication after generation CAS is superseded and retains durable blob intent', async () => {
  await databaseFixture(9)(async (db) => {
    let uploadId = '';
    const f = await attachmentFixture(db, {
      fault: async (point) => {
        if (point === 'before-ready-commit')
          await db`update attachment_uploads set generation=generation+1 where id=${uploadId}`;
      },
    });
    try {
      const bytes = Buffer.from('durable');
      const slot = await composeAndReserve(f, bytes);
      uploadId = slot.id;
      await assert.rejects(f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal), {
        code: 'ATTACHMENT_UPLOAD_CONFLICT',
      });
      const [row] =
        await db`select storage_key,state,quota_released_at from attachment_uploads where id=${slot.id}`;
      assert.equal(row.state, 'receiving');
      assert.equal(row.quota_released_at, null);
      assert.equal(
        await f.store.verify({ key: String(row.storage_key), sha256: sha(bytes), byteLength: bytes.length }),
        'present',
      );
      const [intent] =
        await db`select owned_key,ownership_nonce from attachment_gc where attachment_id=${slot.id}`;
      assert.ok(intent);
      assert.equal((await db`select cursor from events where type='attachment.changed'`).length, 0);
    } finally {
      await f.close();
    }
  });
});

test('attachment staging abort waits in-flight producer then terminal close and never releases quota or publishes', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db);
    let complete: () => void = () => {};
    let task: Promise<unknown> | undefined;
    try {
      const bytes = Buffer.from('ab');
      const slot = await composeAndReserve(f, bytes);
      const controller = new AbortController();
      let entered: () => void = () => {};
      const reached = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const released = new Promise<void>((resolve) => {
        complete = resolve;
      });
      async function* chunks() {
        yield bytes.subarray(0, 1);
        entered();
        await released;
        yield bytes.subarray(1);
      }
      task = f.stage.receive(slot.id, owner, chunks(), controller.signal);
      const result = assert.rejects(task);
      await reached;
      controller.abort();
      const [row] = await db`select receiver_id from attachment_uploads where id=${slot.id}`;
      await assert.rejects(f.receivers.closeAndAcknowledge(String(row.receiver_id)), /STILL_ACTIVE/);
      assert.equal(await f.receivers.proveStopped(String(row.receiver_id)), null);
      complete();
      await result;
      const [terminal] =
        await db`select u.state,u.quota_released_at,r.state as receiver_state from attachment_uploads u join attachment_receivers r on r.id=u.receiver_id where u.id=${slot.id}`;
      assert.equal(terminal.state, 'rejected');
      assert.equal(terminal.receiver_state, 'closed');
      assert.equal(terminal.quota_released_at, null);
    } finally {
      complete();
      if (task) await task.catch(() => {});
      await f.close();
    }
  });
});

test('attachment legacy revision actual appendComment bumps descendant subtree exactly once and rollback restores counters', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      const child = await f.mutation(randomUUID(), (tx) =>
        f.services.createTicket(tx, inputTicket(f.project.id, 'task', f.a.id), owner),
      );
      await f.mutation(randomUUID(), (tx) => appendComment(tx, f.request.id, 'Thông tin gốc', owner));
      const revision = async (id: string) => {
        const [row] =
          await db`select revision from attachment_input_revisions where target_kind='ticket' and target_id=${id}`;
        return Number(row.revision);
      };
      assert.equal(await revision(f.request.id), 2);
      assert.equal(await revision(f.a.id), 2);
      assert.equal(await revision(f.b.id), 2);
      assert.equal(await revision(child.id), 2);
      await f.mutation(randomUUID(), (tx) => appendComment(tx, f.a.id, 'Thông tin nhánh', owner));
      assert.equal(await revision(f.request.id), 2);
      assert.equal(await revision(f.a.id), 3);
      assert.equal(await revision(f.b.id), 2);
      assert.equal(await revision(child.id), 3);
      await assert.rejects(
        f.mutation(randomUUID(), async (tx) => {
          await appendComment(tx, f.a.id, 'Rollback', owner);
          throw new Error('INJECT');
        }),
        /INJECT/,
      );
      assert.equal(await revision(child.id), 3);
      assert.equal((await db`select id from comments where text='Rollback'`).length, 0);
      assert.equal((await db`select cursor from events where type='comment.created'`).length, 2);
    } finally {
      await f.close();
    }
  });
});

test('attachment staging schema preserves accepted policy and immutable original identity without absolute DB paths', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      const slot = await composeAndReserve(f, Buffer.from('immutable'));
      const [row] =
        await db`select accepted_config,policy_sha256,ownership_nonce from attachment_uploads where id=${slot.id}`;
      assert.equal(row.policy_sha256, f.config.policySha256);
      assert.ok(row.ownership_nonce);
      assert.equal(row.accepted_config.storageRoot, undefined);
      await assert.rejects(
        db`update attachment_uploads set expected_sha256=${sha(Buffer.from('different'))} where id=${slot.id}`,
        /IDENTITY_IMMUTABLE/,
      );
      await assert.rejects(db`update attachment_uploads set quota_released_at=now() where id=${slot.id}`);
      const snapshotId = randomUUID();
      await db`insert into attachment_input_snapshots(id,target_kind,target_id,input_revision,route_revision,canonical,sha256) values(${snapshotId},'ticket',${f.request.id},1,0,${db.json({ version: 1 })},${sha(Buffer.from('snapshot'))})`;
      await assert.rejects(
        db`update attachment_input_snapshots set input_revision=2 where id=${snapshotId}`,
        /RECORD_IMMUTABLE/,
      );
    } finally {
      await f.close();
    }
  });
});

test('attachment staging heartbeat holds lease for a live writer and late generation loses publication', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db, {
      env: {
        CREW_V2_ATTACHMENT_UPLOAD_HEARTBEAT_MS: '10',
        CREW_V2_ATTACHMENT_UPLOAD_LEASE_MS: '1000',
        CREW_V2_ATTACHMENT_UPLOAD_MAX_WALL_MS: '3000',
      },
    });
    let release: () => void = () => {};
    let task: Promise<unknown> | undefined;
    try {
      const bytes = Buffer.from('ab');
      const slot = await composeAndReserve(f, bytes);
      let enter: () => void = () => {};
      const ready = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      async function* chunks() {
        yield bytes.subarray(0, 1);
        enter();
        await barrier;
        yield bytes.subarray(1);
      }
      task = f.stage.receive(slot.id, owner, chunks(), new AbortController().signal);
      const refused = assert.rejects(task);
      await ready;
      const [before] =
        await db`select receive_lease_until,receiver_id from attachment_uploads where id=${slot.id}`;
      f.clock.advance(300);
      const deadline = Date.now() + 1000;
      let renewed = false;
      while (Date.now() < deadline) {
        const [current] = await db`select receive_lease_until from attachment_uploads where id=${slot.id}`;
        if (
          (current.receive_lease_until as Date).getTime() > (before.receive_lease_until as Date).getTime()
        ) {
          renewed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(renewed, true);
      assert.equal(await f.receivers.proveStopped(String(before.receiver_id)), null);
      await db`update attachment_uploads set generation=generation+1 where id=${slot.id}`;
      release();
      await refused;
      const [after] =
        await db`select state,quota_released_at,storage_key from attachment_uploads where id=${slot.id}`;
      assert.equal(after.state, 'receiving');
      assert.equal(after.quota_released_at, null);
      assert.equal(
        await f.store.verify({
          key: String(after.storage_key),
          sha256: sha(bytes),
          byteLength: bytes.length,
        }),
        'missing',
      );
    } finally {
      release();
      if (task) await task.catch(() => {});
      await f.close();
    }
  });
});

test('attachment staging Linux registry refuses premature close then persists exact native receiver proof', {
  skip: process.platform !== 'linux',
}, async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db, { nativeReceiver: true });
    let release: () => void = () => {};
    let task: Promise<unknown> | undefined;
    try {
      const bytes = Buffer.from('ab');
      const slot = await composeAndReserve(f, bytes);
      let enter: () => void = () => {};
      const ready = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      async function* chunks() {
        yield bytes.subarray(0, 1);
        enter();
        await barrier;
        yield bytes.subarray(1);
      }
      task = f.stage.receive(slot.id, owner, chunks(), new AbortController().signal);
      await ready;
      const [row] = await db`select receiver_id,generation from attachment_uploads where id=${slot.id}`;
      const receiverId = String(row.receiver_id);
      await assert.rejects(f.receivers.closeAndAcknowledge(receiverId), /STILL_ACTIVE/);
      assert.equal(await f.receivers.proveStopped(receiverId), null);
      release();
      const completed = (await task) as { state: string };
      assert.equal(completed.state, 'ready');
      const proof = await f.receivers.proveStopped(receiverId);
      assert.ok(proof);
      assert.equal(proof.kind, 'closed-ack');
      assert.equal(proof.receiverId, receiverId);
      assert.equal(proof.generation, String(row.generation));
      assert.equal(proof.identity.pid, process.pid);
      const [writer] =
        await db`select start_ticks,linux_boot_id,proc_namespace_inode from attachment_server_writers where instance_id=${proof.identity.instanceId}`;
      assert.equal(proof.identity.startTicks, String(writer.start_ticks));
      assert.equal(proof.identity.linuxBootId, writer.linux_boot_id);
      assert.equal(proof.identity.procNamespaceInode, writer.proc_namespace_inode);
    } finally {
      release();
      if (task) await task.catch(() => {});
      await f.close();
    }
  });
});

test('attachment staging Linux native receiver uses actual private PostgreSQL and replays terminal ACK', async () => {
  await databaseFixture(9)(runLinuxReceiverCase);
});

test('attachment staging publication failure preserves original intent and terminal receiver proof', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db, {
      storeFault: async (point) => {
        if (point === 'after-publish') throw new Error('INJECT_PUBLISHED');
      },
    });
    try {
      const bytes = Buffer.from('retained');
      const slot = await composeAndReserve(f, bytes);
      await assert.rejects(
        f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal),
        /INJECT_PUBLISHED/,
      );
      const [row] =
        await db`select state,storage_key,receiver_id,quota_released_at from attachment_uploads where id=${slot.id}`;
      assert.equal(row.state, 'receiving');
      assert.equal(row.quota_released_at, null);
      assert.equal(
        await f.store.verify({ key: String(row.storage_key), sha256: sha(bytes), byteLength: bytes.length }),
        'present',
      );
      const proof = await f.receivers.proveStopped(String(row.receiver_id));
      assert.ok(proof);
      assert.equal(proof.kind, 'closed-ack');
      assert.equal((await db`select cursor from events where type='attachment.changed'`).length, 0);
    } finally {
      await f.close();
    }
  });
});

test('attachment migration restores reviewed 008 through 009 and retains attachment checksum against drift', async () => {
  await databaseFixture(8)(verifyAttachmentMigrationRestore);
});

test('attachment staging review F1 ready replay enforces accepted wall deadline and closes stalled iterator', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db, { env: { CREW_V2_ATTACHMENT_UPLOAD_MAX_WALL_MS: '100' } });
    try {
      const bytes = Buffer.from('ok');
      const slot = await composeAndReserve(f, bytes);
      await f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal);
      const [before] =
        await db`select generation,receiver_id,quota_released_at from attachment_uploads where id=${slot.id}`;
      let returned = 0,
        active = 0,
        calls = 0,
        resolveNext: (value: IteratorResult<Uint8Array>) => void = () => {};
      const stalled: AsyncIterableIterator<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          if (calls++) return Promise.resolve({ done: true, value: undefined });
          active++;
          return new Promise((resolve) => {
            resolveNext = (value) => {
              active--;
              resolve(value);
            };
          });
        },
        async return() {
          returned++;
          resolveNext({ done: true, value: undefined });
          return { done: true, value: undefined };
        },
      };
      const replay = createStageServices({
        db,
        store: f.store,
        receivers: f.receivers,
        now: f.clock.now,
        config: { ...f.config, uploadMaxWallMs: 5000 },
      });
      assert.equal(
        (await replay.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal)).state,
        'ready',
      );
      const started = performance.now();
      // Test watchdog supplies the old unbounded branch with correct bytes so RED
      // fails an assertion rather than leaking a never-settled read/timer.
      const watchdog = setTimeout(() => resolveNext({ done: false, value: bytes }), 250);
      try {
        await assert.rejects(replay.receive(slot.id, owner, stalled, new AbortController().signal), {
          code: 'ATTACHMENT_UPLOAD_TIMEOUT',
        });
      } finally {
        clearTimeout(watchdog);
        if (active) await stalled.return?.();
      }
      assert.ok(performance.now() - started < 240);
      assert.equal(returned, 1);
      assert.equal(active, 0);
      const [after] =
        await db`select state,generation,receiver_id,quota_released_at,storage_key from attachment_uploads where id=${slot.id}`;
      assert.equal(after.state, 'ready');
      assert.equal(after.generation, before.generation);
      assert.equal(after.receiver_id, before.receiver_id);
      assert.equal(after.quota_released_at, null);
      assert.equal(
        await f.store.verify({
          key: String(after.storage_key),
          sha256: sha(bytes),
          byteLength: bytes.length,
        }),
        'present',
      );
      assert.equal((await db`select cursor from events where type='attachment.changed'`).length, 1);
    } finally {
      await f.close();
    }
  });
});

test('attachment staging review F2 rejects every invalid one-byte text control before original publication', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      for (let byte = 0; byte < 32; byte++) {
        if ([9, 10, 13].includes(byte)) continue;
        const bytes = Buffer.from([byte]);
        const slot = await composeAndReserve(f, bytes);
        await assert.rejects(
          f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal),
          { code: 'ATTACHMENT_BINARY_TEXT' },
          `control ${byte}`,
        );
        const [row] =
          await db`select u.state,u.storage_key,u.quota_released_at,r.state as receiver_state from attachment_uploads u join attachment_receivers r on r.id=u.receiver_id where u.id=${slot.id}`;
        assert.equal(row.state, 'rejected');
        assert.equal(row.receiver_state, 'closed');
        assert.equal(row.quota_released_at, null);
        assert.equal(
          await f.store.verify({ key: String(row.storage_key), sha256: sha(bytes), byteLength: 1 }),
          'missing',
        );
      }
      for (const bytes of [Buffer.from([0xc3]), Buffer.from([0xff, 0xfe, 0x01])]) {
        const slot = await composeAndReserve(f, bytes);
        await assert.rejects(
          f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal),
          { code: 'ATTACHMENT_BINARY_TEXT' },
        );
        const [row] =
          await db`select u.storage_key,u.quota_released_at,r.state from attachment_uploads u join attachment_receivers r on r.id=u.receiver_id where u.id=${slot.id}`;
        assert.equal(row.state, 'closed');
        assert.equal(row.quota_released_at, null);
        assert.equal(
          await f.store.verify({
            key: String(row.storage_key),
            sha256: sha(bytes),
            byteLength: bytes.length,
          }),
          'missing',
        );
      }
      for (const bytes of [
        Buffer.alloc(0),
        Buffer.from('a'),
        Buffer.from('\t'),
        Buffer.from('\n'),
        Buffer.from('\r'),
      ]) {
        const slot = await composeAndReserve(f, bytes);
        assert.equal(
          (await f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal)).state,
          'ready',
        );
      }
      assert.equal((await db`select cursor from events where type='attachment.changed'`).length, 5);
    } finally {
      await f.close();
    }
  });
});

test('attachment staging review F1 noncooperative replay times out but stays BUSY until actual teardown', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db, { env: { CREW_V2_ATTACHMENT_UPLOAD_MAX_WALL_MS: '100' } });
    let release = () => {},
      closed = 0;
    let task: Promise<unknown> | undefined;
    let producerClosed: Promise<void> | undefined;
    try {
      const bytes = Buffer.from('ok');
      const slot = await composeAndReserve(f, bytes);
      await f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal);
      let entered = () => {},
        finished = () => {};
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const done = new Promise<void>((resolve) => {
        finished = resolve;
      });
      producerClosed = done;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      async function* source() {
        try {
          entered();
          await barrier;
          yield bytes;
        } finally {
          closed++;
          finished();
        }
      }
      task = f.stage.receive(slot.id, owner, source(), new AbortController().signal);
      const rejected = assert.rejects(task, { code: 'ATTACHMENT_UPLOAD_TIMEOUT' });
      await started;
      const since = performance.now();
      await rejected;
      assert.ok(performance.now() - since < 240);
      assert.equal(closed, 0);
      const replacement = createStageServices({
        db,
        store: f.store,
        receivers: f.receivers,
        now: f.clock.now,
        config: f.config,
      });
      await assert.rejects(
        replacement.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal),
        { code: 'ATTACHMENT_UPLOAD_BUSY' },
      );
      const [before] =
        await db`select state,generation,receiver_id,quota_released_at from attachment_uploads where id=${slot.id}`;
      assert.equal(before.state, 'ready');
      assert.equal(before.quota_released_at, null);
      release();
      await done;
      assert.equal(closed, 1);
      assert.equal(
        (await replacement.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal)).state,
        'ready',
      );
      const [after] =
        await db`select state,generation,receiver_id,quota_released_at from attachment_uploads where id=${slot.id}`;
      assert.deepEqual(after, before);
      assert.equal((await db`select cursor from events where type='attachment.changed'`).length, 1);
    } finally {
      release();
      if (task) await task.catch(() => {});
      if (producerClosed) await producerClosed;
      await f.close();
    }
  });
});

test('attachment staging review F1 caller abort closes replay input and tracks rejected pending next', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db, { env: { CREW_V2_ATTACHMENT_UPLOAD_MAX_WALL_MS: '100' } });
    try {
      const bytes = Buffer.from('ok');
      const slot = await composeAndReserve(f, bytes);
      await f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal);
      const abort = new AbortController();
      let returned = 0;
      const source: AsyncIterableIterator<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          abort.abort();
          throw new Error('INPUT_ABORTED');
        },
        async return() {
          returned++;
          return { done: true, value: undefined };
        },
      };
      await assert.rejects(f.stage.receive(slot.id, owner, source, abort.signal), {
        code: 'ATTACHMENT_ABORTED',
      });
      assert.equal(
        (await f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal)).state,
        'ready',
      );
      assert.equal(returned, 1);
      const preAborted = new AbortController();
      preAborted.abort();
      let reads = 0;
      const preSource: AsyncIterableIterator<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          reads++;
          return { done: false, value: bytes };
        },
        async return() {
          returned++;
          return { done: true, value: undefined };
        },
      };
      await assert.rejects(f.stage.receive(slot.id, owner, preSource, preAborted.signal), {
        code: 'ATTACHMENT_ABORTED',
      });
      assert.equal(reads, 0);
      assert.equal(
        (await f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal)).state,
        'ready',
      );
      assert.equal(returned, 2);
      const [row] = await db`select state,quota_released_at from attachment_uploads where id=${slot.id}`;
      assert.equal(row.state, 'ready');
      assert.equal(row.quota_released_at, null);
    } finally {
      await f.close();
    }
  });
});

test('attachment staging review F1 deadline before verified replay success retains tracked verification', async () => {
  await databaseFixture(9)(async (db) => {
    const f = await attachmentFixture(db, { env: { CREW_V2_ATTACHMENT_UPLOAD_MAX_WALL_MS: '100' } });
    let release = () => {};
    let verifySettled: Promise<void> | undefined;
    try {
      const bytes = Buffer.from('ok');
      const slot = await composeAndReserve(f, bytes);
      await f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal);
      let enter = () => {};
      const started = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let verified = () => {};
      verifySettled = new Promise<void>((resolve) => {
        verified = resolve;
      });
      const replay = createStageServices({
        db,
        receivers: f.receivers,
        now: f.clock.now,
        config: f.config,
        store: {
          ...f.store,
          async verify(blob) {
            enter();
            await barrier;
            try {
              return await f.store.verify(blob);
            } finally {
              verified();
            }
          },
        },
      });
      const task = replay.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal);
      const rejected = assert.rejects(task, { code: 'ATTACHMENT_UPLOAD_TIMEOUT' });
      await started;
      await rejected;
      await assert.rejects(f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal), {
        code: 'ATTACHMENT_UPLOAD_BUSY',
      });
      release();
      // Await the actual owned verify settlement before allowing another replay.
      await verifySettled;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        (await f.stage.receive(slot.id, owner, bufferBody(bytes), new AbortController().signal)).state,
        'ready',
      );
    } finally {
      release();
      if (verifySettled) await verifySettled;
      await f.close();
    }
  });
});
