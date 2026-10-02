import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Selection } from '../src/attachments/contracts.ts';
import { appendEvent } from '../src/journal/events.ts';
import { createTicketServices } from '../src/tickets/service.ts';
import { attachmentFixture, bufferBody, sha } from './support/attachments.ts';
import { databaseFixture } from './support/db.ts';
import { inputTicket, owner } from './support/tickets.ts';

async function fixture(
  work: (
    db: Parameters<Parameters<ReturnType<typeof databaseFixture>>[0]>[0],
    f: Awaited<ReturnType<typeof attachmentFixture>>,
    s: Awaited<ReturnType<typeof consumer>>,
  ) => Promise<void>,
  options: Parameters<typeof attachmentFixture>[1] = {},
) {
  await databaseFixture(10)(async (db) => {
    const f = await attachmentFixture(db, options);
    try {
      await work(db, f, await consumer(f));
    } finally {
      await f.close();
    }
  });
}
async function consumer(f: Awaited<ReturnType<typeof attachmentFixture>>) {
  const { createAttachmentSubmissions } = await import('../src/attachments/submissions.ts');
  return createAttachmentSubmissions({
    tickets: createTicketServices,
    stage: f.stage,
    store: f.store,
    queuePolicy: {
      extractorVersion: 'fixture-pending-only',
      configSha256: sha(Buffer.from('fixture protocol')),
    },
    now: f.clock.now,
  });
}
async function selection(
  f: Awaited<ReturnType<typeof attachmentFixture>>,
  purpose: 'ticket' | 'comment',
  files = [Buffer.from('A'), Buffer.from('B')],
): Promise<Selection> {
  const compose = await f.mutation(randomUUID(), (tx) =>
    f.stage.createCompose(
      tx,
      purpose === 'comment'
        ? { purpose: 'comment', projectId: f.project.id, ticketId: f.request.id }
        : { purpose: 'ticket', projectId: f.project.id, ticketId: null },
      owner,
    ),
  );

  let revision = compose.revision;
  const ids: string[] = [];
  for (const [i, bytes] of files.entries()) {
    const r = await f.mutation(randomUUID(), (tx) =>
      f.stage.reserve(
        tx,
        {
          composeSessionId: compose.id,
          expectedRevision: revision,
          fileName: `${i}.txt`,
          declaredMime: 'text/plain',
          byteLength: bytes.length,
          sha256: sha(bytes),
        },
        owner,
      ),
    );
    revision = r.selectionRevision;
    await f.stage.receive(r.attachment.attachmentId, owner, bufferBody(bytes), new AbortController().signal);
    ids.push(r.attachment.attachmentId);
  }
  return { composeSessionId: compose.id, selectionRevision: revision, attachmentIds: ids };
}
test('attachment submission unavailable original rolls back comment links receipt quota and009 fanout', async () =>
  fixture(async (db, f, s) => {
    const selected = await selection(f, 'comment');
    await db`update attachment_uploads set state='missing' where id=${selected.attachmentIds[1]}`;
    const before = await db`select * from attachment_input_revisions order by target_id`;
    await assert.rejects(
      f.mutation(randomUUID(), (tx) => s.comment(tx, f.request.id, { text: '', selection: selected }, owner)),
      { code: 'ATTACHMENT_NOT_READY' },
    );
    assert.equal((await db`select * from comments`).length, 0);
    assert.equal((await db`select * from attachment_links`).length, 0);
    assert.equal((await db`select * from attachment_submissions`).length, 0);
    assert.equal((await db`select * from attachment_uploads where quota_released_at is not null`).length, 0);
    assert.deepEqual(await db`select * from attachment_input_revisions order by target_id`, before);
  }));
test('attachment submission exact set duplicates foreign IDs stale revision and permission replay reject atomically', async () =>
  fixture(async (db, f, s) => {
    const selected = await selection(f, 'comment');
    for (const [value, code] of [
      [{ ...selected, attachmentIds: [selected.attachmentIds[0], selected.attachmentIds[0]] }, 'VALIDATION'],
      [{ ...selected, attachmentIds: [randomUUID(), selected.attachmentIds[1]] }, 'NOT_FOUND'],
      [{ ...selected, attachmentIds: selected.attachmentIds.slice(0, 1) }, 'SELECTION_CHANGED'],
      [{ ...selected, selectionRevision: selected.selectionRevision - 1 }, 'SELECTION_CHANGED'],
    ] as const)
      await assert.rejects(
        f.mutation(randomUUID(), (tx) =>
          s.comment(
            tx,
            f.request.id,
            { text: '', selection: { ...value, attachmentIds: [...value.attachmentIds] } },
            owner,
          ),
        ),
        { code },
      );
    const body = { text: '', selection: selected };
    const result = await f.mutationWith(randomUUID(), body, (tx) => s.comment(tx, f.request.id, body, owner));
    assert.deepEqual(
      await f.mutationWith(randomUUID(), body, (tx) =>
        s.comment(
          tx,
          f.request.id,
          {
            ...body,
            selection: { ...selected, attachmentIds: [...selected.attachmentIds].reverse() },
            assistantRead: 'none',
          },
          owner,
        ),
      ),
      result,
    );
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        s.comment(tx, f.request.id, { ...body, assistantRead: 'selected-inputs' }, owner),
      ),
      { code: 'COMPOSE_ALREADY_SUBMITTED' },
    );
    assert.equal((await db`select * from comments`).length, 1);
    assert.equal((await db`select * from attachment_links`).length, 2);
    assert.equal((await db`select * from events where type='comment.created'`).length, 1);
    assert.equal((await db`select * from attachment_submission_authorizations`).length, 0);
    assert.equal(
      (
        await db`select * from attachment_uploads where linked_at is not null and quota_released_at is not null`
      ).length,
      2,
    );
    assert.equal((await db`select * from attachment_extractions where status='pending'`).length, 2);
    for (const id of [f.request.id, f.a.id, f.b.id]) {
      const [r] = await db`select revision from attachment_input_revisions where target_id=${id}`;
      assert.equal(Number(r.revision), 2);
    }
  }));
test('attachment ticket concurrent new-key canonical retry returns one ticket and selected authorization', async () =>
  fixture(async (db, f, s) => {
    const selected = await selection(f, 'ticket');
    const body = {
      ticket: inputTicket(f.project.id, 'request'),
      selection: selected,
      assistantRead: 'selected-inputs' as const,
    };
    const before = (await db`select id from tickets`).length;
    const responses = await Promise.all(
      [0, 1].map(() => f.mutationWith(randomUUID(), body, (tx) => s.ticket(tx, body, owner))),
    );
    assert.deepEqual(responses[0], responses[1]);
    assert.equal((await db`select id from tickets`).length, before + 1);
    assert.equal((await db`select * from attachment_submission_authorizations`).length, 1);
    const [auth] = await db`select * from attachment_submission_authorizations`;
    assert.equal(auth.allow_original, false);
    assert.equal(auth.scope, 'submitted-inputs');
    assert.equal(auth.originals.length, 2);
    assert.equal((await db`select * from attachment_assistant_grants`).length, 0);
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        s.ticket(tx, { ...body, ticket: { ...body.ticket, title: 'Changed' } }, owner),
      ),
      { code: 'COMPOSE_ALREADY_SUBMITTED' },
    );
  }));

test('attachment submission actual missing original fails despite ready row without filesystem mutation in transaction', async () =>
  fixture(async (db, f, s) => {
    const selected = await selection(f, 'comment', [Buffer.from('real')]);
    const [upload] =
      await db`select storage_key,ownership_nonce from attachment_uploads where id=${selected.attachmentIds[0]}`;
    assert.equal(
      await f.store.removeOwned({
        key: String(upload.storage_key),
        ownershipNonce: String(upload.ownership_nonce),
      }),
      'removed',
    );
    await assert.rejects(
      f.mutation(randomUUID(), (tx) => s.comment(tx, f.request.id, { text: '', selection: selected }, owner)),
      { code: 'ATTACHMENT_NOT_READY' },
    );
    assert.equal((await db`select * from comments`).length, 0);
    assert.equal((await db`select * from attachment_uploads where linked_at is not null`).length, 0);
  }));
test('attachment submission reserved receiving rejected deleting deleted slots remain selected and cannot be omitted', async () =>
  fixture(async (db, f, s) => {
    for (const state of ['reserved', 'receiving', 'rejected', 'deleting', 'deleted'] as const) {
      const selected = await selection(f, 'comment', [Buffer.from('real')]);
      await db`update attachment_uploads set state=${state} where id=${selected.attachmentIds[0]}`;
      await assert.rejects(
        f.mutation(randomUUID(), (tx) =>
          s.comment(tx, f.request.id, { text: 'Input', selection: selected }, owner),
        ),
        { code: 'ATTACHMENT_NOT_READY' },
      );
      await assert.rejects(
        f.mutation(randomUUID(), (tx) =>
          s.comment(
            tx,
            f.request.id,
            { text: 'Input', selection: { ...selected, attachmentIds: [] } },
            owner,
          ),
        ),
        { code: 'SELECTION_CHANGED' },
      );
    }
    assert.equal((await db`select * from comments`).length, 0);
  }));
test('attachment submission abandoned slot stale expiry target mismatch empty whitespace and text-only semantics', async () =>
  fixture(async (db, f, s) => {
    const selected = await selection(f, 'comment', [Buffer.from('A')]);
    const abandoned = await f.mutation(randomUUID(), (tx) =>
      f.stage.abandonUpload(
        tx,
        {
          composeSessionId: selected.composeSessionId,
          attachmentId: selected.attachmentIds[0],
          expectedRevision: selected.selectionRevision,
        },
        owner,
      ),
    );
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        s.comment(tx, f.request.id, { text: 'Input', selection: selected }, owner),
      ),
      { code: 'SELECTION_CHANGED' },
    );
    const current = await f.stage.readCompose(db, selected.composeSessionId, owner);
    const empty = { ...selected, selectionRevision: current.session.revision, attachmentIds: [] };
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        s.comment(tx, f.request.id, { text: ' \t\n', selection: empty }, owner),
      ),
      { code: 'VALIDATION' },
    );
    const result = await f.mutation(randomUUID(), (tx) =>
      s.comment(tx, f.request.id, { text: 'Nội dung', selection: empty }, owner),
    );
    assert.equal(result.comment.text, 'Nội dung');
    assert.equal(abandoned, current.session.revision);
    const foreign = await selection(f, 'ticket', []);
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        s.comment(tx, f.request.id, { text: 'Input', selection: foreign }, owner),
      ),
      { code: 'NOT_FOUND' },
    );
    const expires = await selection(f, 'comment', []);
    f.clock.advance(f.config.stagingTtlMs + 1);
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        s.comment(tx, f.request.id, { text: 'Input', selection: expires }, owner),
      ),
      { code: 'SELECTION_CHANGED' },
    );
  }));
test('attachment submission retained quota permits new reserve once and immutable replay keeps latches', async () =>
  fixture(
    async (db, f, s) => {
      const selected = await selection(f, 'comment', [Buffer.from('AB')]);
      const next = await selection(f, 'comment', []);
      const reserve = () =>
        f.mutation(randomUUID(), (tx) =>
          f.stage.reserve(
            tx,
            {
              composeSessionId: next.composeSessionId,
              expectedRevision: next.selectionRevision,
              fileName: 'next.txt',
              declaredMime: 'text/plain',
              byteLength: 1,
              sha256: sha(Buffer.from('C')),
            },
            owner,
          ),
        );
      await assert.rejects(reserve(), { code: 'ATTACHMENT_OWNER_QUOTA' });
      const input = { text: '', selection: selected };
      const result = await f.mutation(randomUUID(), (tx) => s.comment(tx, f.request.id, input, owner));
      const latches =
        await db`select id,linked_at,quota_released_at from attachment_uploads where id=${selected.attachmentIds[0]}`;
      assert.deepEqual(
        await f.mutation(randomUUID(), (tx) => s.comment(tx, f.request.id, input, owner)),
        result,
      );
      assert.deepEqual(
        await db`select id,linked_at,quota_released_at from attachment_uploads where id=${selected.attachmentIds[0]}`,
        latches,
      );
      assert.equal((await reserve()).attachment.state, 'reserved');
    },
    {
      env: {
        CREW_V2_ATTACHMENT_MAX_FILE_BYTES: '2',
        CREW_V2_ATTACHMENT_MAX_COMPOSE_BYTES: '2',
        CREW_V2_ATTACHMENT_MAX_OWNER_STAGING_BYTES: '2',
      },
    },
  ));
test('attachment submission real invalid event after link rolls back receipt and quota; current guard precedes cache', async () =>
  fixture(async (db, f, s) => {
    const selected = await selection(f, 'comment', [Buffer.from('A')]);
    const body = { text: '', selection: selected };
    await assert.rejects(
      f.mutation(randomUUID(), async (tx) => {
        await s.comment(tx, f.request.id, body, owner);
        await appendEvent(tx, {
          type: 'UNREGISTERED_ATTACHMENT_FAILURE',
          projectId: null,
          ticketId: null,
          audienceMachineId: null,
          data: {},
        });
      }),
      { code: 'EVENT_INVALID' },
    );
    assert.equal((await db`select * from comments`).length, 0);
    assert.equal((await db`select * from attachment_submissions`).length, 0);
    assert.equal((await db`select * from attachment_uploads where linked_at is not null`).length, 0);
    const key = randomUUID();
    const value = await f.mutationAs(key, body, owner, { ticketId: f.request.id }, (tx) =>
      s.comment(tx, f.request.id, body, owner),
    );
    assert.deepEqual(
      await f.mutationAs(key, body, owner, { ticketId: f.request.id }, async () => {
        throw new Error('CACHE_MUST_SKIP_WORK');
      }),
      value,
    );
    await assert.rejects(
      f.mutationAs(key, body, owner, { ticketId: randomUUID() }, async () => value),
      { code: 'NOT_FOUND' },
    );
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        s.comment(tx, f.request.id, body, { kind: 'machine', id: randomUUID() }),
      ),
      { code: 'FORBIDDEN' },
    );
  }));
test('attachment submission constructor captures verify and pending policy; selected files default deny without worker identity', async () =>
  fixture(async (db, f) => {
    const { createAttachmentSubmissions } = await import('../src/attachments/submissions.ts');
    const selected = await selection(f, 'comment', [Buffer.from('A')]);
    const denied = createAttachmentSubmissions({
      tickets: createTicketServices,
      stage: f.stage,
      store: f.store,
    });
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        denied.comment(tx, f.request.id, { text: '', selection: selected }, owner),
      ),
      { code: 'EXTRACTION_NOT_CONFIGURED' },
    );
    const deps = {
      tickets: createTicketServices,
      stage: f.stage,
      store: { verify: f.store.verify.bind(f.store) },
      queuePolicy: { extractorVersion: 'fixture-pending-only', configSha256: sha(Buffer.from('frozen')) },
    };
    const s = createAttachmentSubmissions(deps);
    deps.store.verify = async () => {
      throw new Error('REPLACED_VERIFY');
    };
    deps.queuePolicy.extractorVersion = 'replacement';
    await f.mutation(randomUUID(), (tx) =>
      s.comment(tx, f.request.id, { text: '', selection: selected }, owner),
    );
    const [job] = await db`select extractor_version,status from attachment_extractions`;
    assert.equal(job.extractor_version, 'fixture-pending-only');
    assert.equal(job.status, 'pending');
  }));

test('attachment submission ready row with nonterminal receiver cannot release quota or retain original', async () =>
  fixture(async (db, f, s) => {
    const selectionValue = await selection(f, 'comment', [Buffer.from('A')]);
    const [upload] =
      await db`select receiver_id from attachment_uploads where id=${selectionValue.attachmentIds[0]}`;
    await db`update attachment_receivers set state='writing' where id=${upload.receiver_id}`;
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        s.comment(tx, f.request.id, { text: '', selection: selectionValue }, owner),
      ),
      { code: 'ATTACHMENT_NOT_READY' },
    );
    assert.equal((await db`select * from comments`).length, 0);
    assert.equal((await db`select * from attachment_uploads where quota_released_at is not null`).length, 0);
  }));
test('attachment submission malformed target returns400 before scope SQL or cached replay', async () =>
  fixture(async (db, f, s) => {
    const selected = await selection(f, 'ticket', []);
    const body = { ticket: inputTicket(f.project.id, 'request'), selection: selected };
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        s.ticket(tx, { ...body, ticket: { ...body.ticket, projectId: 'invalid-uuid' } }, owner),
      ),
      { code: 'VALIDATION' },
    );
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        s.comment(tx, 'invalid-uuid', { text: 'Input', selection: selected }, owner),
      ),
      { code: 'VALIDATION' },
    );
    const key = randomUUID();
    const result = await f.mutationAs(key, body, owner, { projectId: f.project.id }, (tx) =>
      s.ticket(tx, body, owner),
    );
    await assert.rejects(
      f.mutationAs(key, body, owner, { projectId: 'invalid-uuid' }, async () => result),
      { code: 'VALIDATION' },
    );
    assert.equal((await db`select * from attachment_submissions`).length, 1);
  }));

test('attachment submission accepts actual closed ACK only; unknown and native gone proofs retain quota', async () =>
  fixture(async (db, f, s) => {
    const bytes = Buffer.from('Actual staged original');
    const selected = await selection(f, 'comment', [bytes]);
    const beforeUploads = await db`select * from attachment_uploads where id=${selected.attachmentIds[0]}`;
    const [upload] = beforeUploads;
    const [receiver] = await db`select * from attachment_receivers where id=${upload.receiver_id}`;
    const actualProof = receiver.stop_proof;
    assert.equal(actualProof.kind, 'closed-ack');
    assert.equal(receiver.state, 'closed');
    assert.equal(actualProof.proofSha256, receiver.closed_ack_sha256);
    const revisions = await db`select * from attachment_input_revisions order by target_id`;
    const body = { text: '', selection: selected };
    for (const kind of ['process-gone', 'native-process-gone', 'unknown-proof']) {
      // Negative corruption preserves every real ready/identity/hash/byte gate.
      // Native process disappearance is not the producer's publication ACK.
      await db`update attachment_receivers set stop_proof=${db.json({ ...actualProof, kind })} where id=${receiver.id}`;
      await assert.rejects(
        f.mutation(randomUUID(), (tx) => s.comment(tx, f.request.id, body, owner)),
        { code: 'ATTACHMENT_NOT_READY' },
      );
      assert.equal((await db`select * from comments`).length, 0);
      assert.equal((await db`select * from attachment_links`).length, 0);
      assert.equal((await db`select * from attachment_submissions`).length, 0);
      assert.equal((await db`select * from attachment_extractions`).length, 0);
      assert.deepEqual(await db`select * from attachment_input_revisions order by target_id`, revisions);
      assert.deepEqual(await db`select * from attachment_uploads where id=${upload.id}`, beforeUploads);
      assert.equal(
        await f.store.verify({
          key: String(upload.storage_key),
          sha256: sha(bytes),
          byteLength: bytes.length,
        }),
        'present',
      );
    }
    // Restore the ACK captured from actual reserve/receive, never synthesize one.
    await db`update attachment_receivers set stop_proof=${db.json(actualProof)} where id=${receiver.id}`;
    await f.mutation(randomUUID(), (tx) => s.comment(tx, f.request.id, body, owner));
    assert.equal((await db`select * from attachment_links where attachment_id=${upload.id}`).length, 1);
    const [retained] =
      await db`select linked_at,quota_released_at from attachment_uploads where id=${upload.id}`;
    assert.ok(retained.linked_at);
    assert.ok(retained.quota_released_at);
    const [job] = await db`select status from attachment_extractions where attachment_id=${upload.id}`;
    assert.equal(job.status, 'pending');
  }));
