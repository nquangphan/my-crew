import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { test } from 'node:test';
import postgres from 'postgres';
import { connectDb } from '../src/db/client.ts';
import { captureMigrations, migrate } from '../src/db/migrate.ts';
import { appendEvent } from '../src/journal/events.ts';
import type { Db, Id, Tx } from '../src/platform/contracts.ts';
import { ApiError } from '../src/platform/errors.ts';
import type { CommentAttachmentInput, CommentAttachmentLinker } from '../src/tickets/contracts.ts';
import { appendComment } from '../src/tickets/decisions.ts';
import { createTicketServices } from '../src/tickets/service.ts';
import { attachmentFixture, bufferBody, sha } from './support/attachments.ts';
import { databaseFixture } from './support/db.ts';
import { inputTicket, owner } from './support/tickets.ts';

type Fixture = Awaited<ReturnType<typeof attachmentFixture>>;
const prefixNine = [
  'dda56a23030e01ee5025d61578969b53157f96fd19ffe6172108b652f6adfa76',
  '11806e8bb34e6aefb2f225d1499052d66d76c06f1ccd278021353fcc7fed78e9',
  '0949541124c0ff26fec05030b8693afe65705ff2d63887f7e452fa6d37487d5d',
  '1149012423551fb847c6a9adf3784906d466a6026d8edb67e079d433dcf8af4f',
  'b8351b54e99ae91a3d2476df812b8fc374860ae472cfe8b7459a4dfc61e41027',
  '8c48a69a27205ff95d11be8b966ffffcd079f62e537f5263777cd867325b75ae',
  '9a5542b2a58dd151d1ad78a7dc799ba7bee157abfd094c3c1ebfebf1a2d49eb4',
  'd268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f',
  'fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a',
];
const migrationTenSha = 'aa2a308ba8a180186e57fb08f93fac7195fc6c0468b821f96c107f4e13ccf59d';
async function withFixture(work: (db: Db, f: Fixture) => Promise<void>, through = 10) {
  const migrations = await captureMigrations(through);
  assert.deepEqual(
    migrations.files.slice(0, 9).map((file) => file.sha256),
    prefixNine,
  );
  if (through === 10) assert.equal(migrations.files[9]?.sha256, migrationTenSha);
  await databaseFixture(through)(async (db) => {
    const container = process.env.CREW_V2_TEST_CONTAINER_ID;
    assert.match(container ?? '', /^[0-9a-f]{64}$/);
    const port = new URL(process.env.CREW_V2_TEST_DATABASE_URL ?? '').port;
    const [database] = await db`select current_database() as name`;
    console.info(
      `comment producer resource container=${container} port=${port} database=${database.name} pid=${process.pid} command=${JSON.stringify(process.argv)}`,
    );
    const f = await attachmentFixture(db);
    try {
      const root = await lstat(f.root);
      assert.equal(root.uid, process.getuid?.());
      assert.equal(root.isSymbolicLink(), false);
      console.info(
        `comment producer root identity ${f.root} dev=${root.dev} ino=${root.ino} uid=${root.uid}`,
      );
      await work(db, f);
    } finally {
      await f.close();
    }
  });
}
async function readyCompose(
  f: Fixture,
  files: Uint8Array[],
  ticketId = f.request.id,
): Promise<CommentAttachmentInput> {
  const compose = await f.mutation(randomUUID(), (tx) =>
    f.stage.createCompose(tx, { purpose: 'comment', projectId: f.project.id, ticketId }, owner),
  );
  let selectionRevision = 1;
  const attachmentIds: Id[] = [];
  for (const [index, bytes] of files.entries()) {
    const reserved = await f.mutation(randomUUID(), (tx) =>
      f.stage.reserve(
        tx,
        {
          composeSessionId: compose.id,
          expectedRevision: selectionRevision,
          fileName: `input-${index}.txt`,
          declaredMime: 'text/plain',
          byteLength: bytes.length,
          sha256: sha(bytes),
        },
        owner,
      ),
    );
    selectionRevision = reserved.selectionRevision;
    const ready = await f.stage.receive(
      reserved.attachment.attachmentId,
      owner,
      bufferBody(bytes),
      new AbortController().signal,
    );
    assert.equal(ready.state, 'ready');
    attachmentIds.push(ready.attachmentId);
  }
  return { composeSessionId: compose.id, selectionRevision, attachmentIds };
}
// Test-owned port only: actual ready rows + immutable bytes validate the producer's
// callback contract. It is not Task2b selection/submission/retention implementation.
function actualReadyLinker(db: Db, f: Fixture): CommentAttachmentLinker {
  return async (tx, { commentId, ticketId, attachments }, actor) => {
    assert.deepEqual(actor, owner);
    const [comment] = await tx`select ticket_id from comments where id=${commentId}`;
    assert.equal(comment.ticket_id, ticketId);
    assert.equal(
      (await tx`select cursor from events where type='comment.created' and data->>'commentId'=${commentId}`)
        .length,
      0,
    );
    const [compose] =
      await tx`select * from attachment_compose_sessions where id=${attachments.composeSessionId} for update`;
    if (
      !compose ||
      compose.purpose !== 'comment' ||
      compose.ticket_id !== ticketId ||
      compose.project_id !== f.project.id ||
      Number(compose.revision) !== attachments.selectionRevision ||
      compose.state !== 'open'
    )
      throw new ApiError('ATTACHMENT_SELECTION_INVALID', 422, 'Lượt gửi không hợp lệ');
    const ids = attachments.attachmentIds;
    if (new Set(ids).size !== ids.length)
      throw new ApiError('ATTACHMENT_SELECTION_INVALID', 422, 'Lượt gửi không hợp lệ');
    const uploads =
      await tx`select * from attachment_uploads where compose_id=${compose.id} and state<>'abandoned' order by id for update`;
    if (
      uploads.length !== ids.length ||
      uploads.some((u) => !ids.includes(String(u.id)) || u.state !== 'ready' || !u.durable_at)
    )
      throw new ApiError('ATTACHMENT_NOT_READY', 422, 'Tệp chưa sẵn sàng');
    for (const upload of uploads) {
      if (
        (await f.store.verify({
          key: String(upload.storage_key),
          sha256: String(upload.expected_sha256),
          byteLength: Number(upload.expected_bytes),
        })) !== 'present'
      )
        throw new ApiError('ATTACHMENT_NOT_READY', 422, 'Tệp chưa sẵn sàng');
      await tx`insert into attachment_links(id,attachment_id,project_id,ticket_id,comment_id) values(${randomUUID()},${upload.id},${f.project.id},${ticketId},${commentId})`;
    }
    assert.notEqual(tx, db);
  };
}
async function counts(db: Db) {
  const [row] =
    await db`select (select count(*) from comments) as comments,(select count(*) from attachment_links) as links,(select count(*) from events where type='comment.created') as events`;
  return { comments: Number(row.comments), links: Number(row.links), events: Number(row.events) };
}
async function revisions(db: Db) {
  return (
    await db`select target_id,revision::text from attachment_input_revisions where target_kind='ticket' order by target_id`
  ).map((r) => ({ id: String(r.target_id), revision: String(r.revision) }));
}
function producer(deps: Parameters<typeof createTicketServices>[0] = {}) {
  const services = createTicketServices(deps);
  assert.equal(
    typeof services.appendAttachmentComment,
    'function',
    'attachment comment producer method must exist',
  );
  return services;
}

test('attachment comment producer default denies before INSERT and freezes absence at factory creation', async () =>
  withFixture(async (db, f) => {
    const deps: Parameters<typeof createTicketServices>[0] = {};
    const services = producer(deps);
    deps.commentAttachments = actualReadyLinker(db, f);
    const before = await revisions(db);
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        services.appendAttachmentComment(
          tx,
          f.request.id,
          {
            text: '',
            attachments: {
              composeSessionId: randomUUID(),
              selectionRevision: 1,
              attachmentIds: [randomUUID()],
            },
          },
          owner,
        ),
      ),
      { code: 'ATTACHMENT_LINKER_NOT_CONFIGURED' },
    );
    assert.deepEqual(await counts(db), { comments: 0, links: 0, events: 0 });
    assert.deepEqual(await revisions(db), before);
  }));

test('attachment comment producer preserves legacy appendComment whitespace and empty rejection exactly', async () =>
  withFixture(async (db, f) => {
    await assert.rejects(
      f.mutation(randomUUID(), (tx) => appendComment(tx, f.request.id, '', owner)),
      { code: 'VALIDATION' },
    );
    const text = ' \t\r\n ';
    const legacy = await f.mutation(randomUUID(), (tx) =>
      f.services.appendComment(tx, f.request.id, text, owner),
    );
    assert.equal(legacy.text, text);
    const [stored] = await db`select text from comments where id=${legacy.id}`;
    assert.equal(stored.text, text);
    assert.deepEqual(await counts(db), { comments: 1, links: 0, events: 1 });
  }));

test('attachment comment producer attachment-only actual ready originals emits one event and sole009 subtree fanout', async () =>
  withFixture(async (db, f) => {
    const child = await f.mutation(randomUUID(), (tx) =>
      f.services.createTicket(tx, inputTicket(f.project.id, 'task', f.a.id), owner),
    );
    const other = await f.mutation(randomUUID(), (tx) =>
      f.services.createTicket(tx, inputTicket(f.project.id, 'request'), owner),
    );
    const selection = await readyCompose(f, [Buffer.from('A'), Buffer.from('B')]);
    const services = producer({ commentAttachments: actualReadyLinker(db, f) });
    const comment = await f.mutation(randomUUID(), (tx) =>
      services.appendAttachmentComment(tx, f.request.id, { text: '', attachments: selection }, owner),
    );
    assert.equal(comment.text, '');
    assert.deepEqual(await counts(db), { comments: 1, links: 2, events: 1 });
    const [event] = await db`select project_id,ticket_id,data from events where type='comment.created'`;
    assert.deepEqual(event.data, { commentId: comment.id });
    assert.equal(event.project_id, f.project.id);
    assert.equal(event.ticket_id, f.request.id);
    for (const id of [f.request.id, f.a.id, f.b.id, child.id]) {
      const [revision] = await db`select revision from attachment_input_revisions where target_id=${id}`;
      assert.equal(Number(revision.revision), 2);
    }
    assert.equal(
      (await db`select target_id from attachment_input_revisions where target_id=${other.id}`).length,
      0,
    );
  }));

test('attachment comment producer mixed input and whitespace with actual originals preserve supplied text', async () =>
  withFixture(async (db, f) => {
    const services = producer({ commentAttachments: actualReadyLinker(db, f) });
    for (const text of ['Nội dung với original', ' \t\n ']) {
      const attachments = await readyCompose(f, [Buffer.from('original')]);
      const c = await f.mutation(randomUUID(), (tx) =>
        services.appendAttachmentComment(tx, f.request.id, { text, attachments }, owner),
      );
      assert.equal(c.text, text);
    }
    assert.deepEqual(await counts(db), { comments: 2, links: 2, events: 2 });
  }));

test('attachment comment producer rejects empty whitespace invalid type and over max without client allowEmpty authority', async () =>
  withFixture(async (db, f) => {
    let calls = 0;
    const services = producer({
      commentAttachments: async () => {
        calls++;
      },
    });
    const before = await revisions(db);
    for (const text of ['', ' \t\n ', 'x'.repeat(32769), 7]) {
      const input = {
        text,
        attachments: { composeSessionId: randomUUID(), selectionRevision: 1, attachmentIds: [] },
        allowEmpty: true,
      };
      await assert.rejects(
        f.mutation(randomUUID(), (tx) =>
          services.appendAttachmentComment(
            tx,
            f.request.id,
            input as Parameters<typeof services.appendAttachmentComment>[2],
            owner,
          ),
        ),
        { code: 'VALIDATION' },
      );
    }
    assert.equal(calls, 0);
    assert.deepEqual(await counts(db), { comments: 0, links: 0, events: 0 });
    assert.deepEqual(await revisions(db), before);
  }));

test('attachment comment producer accepts exact max text with trusted empty selection', async () =>
  withFixture(async (db, f) => {
    const attachments = await readyCompose(f, []);
    const services = producer({ commentAttachments: actualReadyLinker(db, f) });
    const text = 'x'.repeat(32768);
    const result = await f.mutation(randomUUID(), (tx) =>
      services.appendAttachmentComment(tx, f.request.id, { text, attachments }, owner),
    );
    assert.equal(result.text, text);
    assert.deepEqual(await counts(db), { comments: 1, links: 0, events: 1 });
  }));

test('attachment comment producer fake IDs unavailable and reserved originals cannot authorize attachment-only text', async () =>
  withFixture(async (db, f) => {
    const services = producer({ commentAttachments: actualReadyLinker(db, f) });
    const selected = await readyCompose(f, [Buffer.from('real')]);
    const before = await revisions(db);
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        services.appendAttachmentComment(
          tx,
          f.request.id,
          { text: '', attachments: { ...selected, attachmentIds: [randomUUID()] } },
          owner,
        ),
      ),
      { code: 'ATTACHMENT_NOT_READY' },
    );
    await db`update attachment_uploads set state='missing' where id=${selected.attachmentIds[0]}`;
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        services.appendAttachmentComment(tx, f.request.id, { text: '', attachments: selected }, owner),
      ),
      { code: 'ATTACHMENT_NOT_READY' },
    );
    const reserved = await readyCompose(f, []);
    const pending = await f.mutation(randomUUID(), (tx) =>
      f.stage.reserve(
        tx,
        {
          composeSessionId: reserved.composeSessionId,
          expectedRevision: 1,
          fileName: 'reserved.txt',
          declaredMime: 'text/plain',
          byteLength: 1,
          sha256: sha(Buffer.from('R')),
        },
        owner,
      ),
    );
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        services.appendAttachmentComment(
          tx,
          f.request.id,
          {
            text: '',
            attachments: {
              ...reserved,
              selectionRevision: pending.selectionRevision,
              attachmentIds: [pending.attachment.attachmentId],
            },
          },
          owner,
        ),
      ),
      { code: 'ATTACHMENT_NOT_READY' },
    );
    assert.deepEqual(await counts(db), { comments: 0, links: 0, events: 0 });
    assert.deepEqual(await revisions(db), before);
  }));

test('attachment comment producer callback failure rolls back inserted comment links event and existing009 fanout', async () =>
  withFixture(async (db, f) => {
    await f.mutation(randomUUID(), (tx) => f.services.appendComment(tx, f.request.id, 'Baseline', owner));
    const selected = await readyCompose(f, [Buffer.from('real')]);
    const before = await revisions(db);
    const ready = actualReadyLinker(db, f);
    const services = producer({
      commentAttachments: async (tx, input, actor) => {
        await ready(tx, input, actor);
        await appendEvent(tx, {
          type: 'comment.created',
          projectId: f.project.id,
          ticketId: f.request.id,
          audienceMachineId: null,
          data: { commentId: input.commentId },
        });
        throw new Error('LINKER_AFTER_WRITE_FAILURE');
      },
    });
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        services.appendAttachmentComment(tx, f.request.id, { text: '', attachments: selected }, owner),
      ),
      /LINKER_AFTER_WRITE_FAILURE/,
    );
    assert.deepEqual(await counts(db), { comments: 1, links: 0, events: 1 });
    assert.deepEqual(await revisions(db), before);
  }));

test('attachment comment producer captured linker cannot be replaced through caller dependency mutation', async () =>
  withFixture(async (db, f) => {
    const deps = { commentAttachments: actualReadyLinker(db, f) };
    const services = producer(deps);
    deps.commentAttachments = async () => {
      throw new Error('REPLACED_LINKER');
    };
    const attachments = await readyCompose(f, [Buffer.from('immutable')]);
    await f.mutation(randomUUID(), (tx) =>
      services.appendAttachmentComment(tx, f.request.id, { text: '', attachments }, owner),
    );
    assert.deepEqual(await counts(db), { comments: 1, links: 1, events: 1 });
  }));

test('attachment comment migration010 forward upgrade and private backup restore preserve comments prefix hashes and009 triggers', async () =>
  withFixture(async (db, f) => {
    await f.mutation(randomUUID(), (tx) => f.services.appendComment(tx, f.request.id, ' \t\n ', owner));
    const comments = await db`select * from comments order by id`;
    const beforeRevisions = await revisions(db);
    const triggers =
      await db`select tgname,pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid='comments'::regclass and not tgisinternal order by tgname`;
    const foreignKeys =
      await db`select conname,pg_get_constraintdef(oid) as definition from pg_constraint where contype='f' and (conrelid='comments'::regclass or confrelid='comments'::regclass) order by conname`;
    const set = await captureMigrations(10);
    assert.deepEqual(
      set.files.slice(0, 9).map((file) => file.sha256),
      prefixNine,
    );
    assert.equal(set.files[9]?.sha256, migrationTenSha);
    const container = process.env.CREW_V2_TEST_CONTAINER_ID ?? '';
    assert.match(container, /^[0-9a-f]{64}$/);
    const baseUrl = process.env.CREW_V2_TEST_DATABASE_URL ?? '';
    const admin = postgres(baseUrl, { max: 1 });
    const [source] = await db`select current_database() as name`;
    assert.match(String(source.name), /^crew_v2_test_[0-9a-f]{32}$/);
    const restore = async (prefix: number) => {
      const dump = spawnSync(
        'docker',
        ['exec', container, 'pg_dump', '-Fc', '-U', 'postgres', String(source.name)],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      assert.equal(dump.status, 0, dump.stderr.toString());
      const expectedComments = await db`select * from comments order by id`;
      const expectedRevisions = await revisions(db);
      const name = `crew_v2_test_${randomUUID().replaceAll('-', '')}`;
      let created = false;
      try {
        await admin`create database ${admin(name)}`;
        created = true;
        console.info(
          `comment producer restore created container=${container} database=${name} prefix=${prefix}`,
        );
        const result = spawnSync(
          'docker',
          ['exec', '-i', container, 'pg_restore', '-U', 'postgres', '-d', name],
          { input: dump.stdout, maxBuffer: 4 * 1024 * 1024 },
        );
        assert.equal(result.status, 0, result.stderr.toString());
        const url = new URL(baseUrl);
        url.pathname = `/${name}`;
        const restored = connectDb(url.toString());
        try {
          await migrate(restored, set);
          await migrate(restored, set);
          assert.deepEqual(await restored`select * from comments order by id`, expectedComments);
          assert.deepEqual(await revisions(restored), expectedRevisions);
          assert.deepEqual(
            await restored`select tgname,pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid='comments'::regclass and not tgisinternal order by tgname`,
            triggers,
          );
          assert.deepEqual(
            await restored`select conname,pg_get_constraintdef(oid) as definition from pg_constraint where contype='f' and (conrelid='comments'::regclass or confrelid='comments'::regclass) order by conname`,
            foreignKeys,
          );
          assert.deepEqual(
            (await restored`select checksum from schema_migrations order by version`).map(
              (row) => row.checksum,
            ),
            [...prefixNine, migrationTenSha],
          );
        } finally {
          await restored.end();
        }
      } finally {
        if (created) {
          await admin`drop database ${admin(name)} with (force)`;
          console.info(`comment producer restore removed container=${container} database=${name}`);
        }
      }
    };
    try {
      await restore(9);
      await migrate(db, set);
      assert.deepEqual(await db`select * from comments order by id`, comments);
      assert.deepEqual(await revisions(db), beforeRevisions);
      assert.deepEqual(
        await db`select tgname,pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid='comments'::regclass and not tgisinternal order by tgname`,
        triggers,
      );
      assert.deepEqual(
        await db`select conname,pg_get_constraintdef(oid) as definition from pg_constraint where contype='f' and (conrelid='comments'::regclass or confrelid='comments'::regclass) order by conname`,
        foreignKeys,
      );
      const [nullability] =
        await db`select attnotnull from pg_attribute where attrelid='comments'::regclass and attname='text'`;
      assert.equal(nullability.attnotnull, true);
      for (const [text, code] of [
        [null, '23502'],
        ['x'.repeat(32769), '23514'],
      ] as const) {
        await assert.rejects(
          db.begin(async (tx) => {
            await tx`insert into comments(id,ticket_id,actor_kind,actor_id,text) values(${randomUUID()},${f.request.id},'owner','owner',${text})`;
          }),
          { code },
        );
      }
      await assert.rejects(
        f.mutation(randomUUID(), (tx) => f.services.appendComment(tx, f.request.id, '', owner)),
        { code: 'VALIDATION' },
      );
      const attachments = await readyCompose(f, [Buffer.from('forward-upgrade')]);
      const services = producer({ commentAttachments: actualReadyLinker(db, f) });
      const empty = await f.mutation(randomUUID(), (tx) =>
        services.appendAttachmentComment(tx, f.request.id, { text: '', attachments }, owner),
      );
      assert.equal(empty.text, '');
      await restore(10);
      const drift = {
        ...set,
        files: set.files.map((file) => {
          if (file.version !== 10) return file;
          const sql = `${file.sql}\n-- deliberate test-only drift`;
          return { ...file, sql, sha256: sha(Buffer.from(sql)) };
        }),
      };
      await assert.rejects(migrate(db, drift), /MIGRATION_DRIFT/);
      assert.deepEqual(
        (await db`select checksum from schema_migrations order by version`).map((row) => row.checksum),
        [...prefixNine, migrationTenSha],
      );
    } finally {
      await admin.end();
    }
  }, 9));
