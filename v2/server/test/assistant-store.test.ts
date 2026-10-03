import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { canonicalJson } from '../src/journal/canonical.ts';
import { appendEvent } from '../src/journal/events.ts';
import {
  assistantContractSamples,
  assistantFixture,
  assistantSchemaCompiler,
  pendingCount,
} from './support/assistant.ts';
import { databaseFixture } from './support/db.ts';
import { openPeerDb } from './support/execution.ts';
import { inputTicket, owner } from './support/tickets.ts';

test('assistant runtime schemas reject overflowing persisted counters without coercion', async () => {
  const { turnFenceSchema } = await import('../src/assistant/contracts.ts');
  {
    const validate = assistantSchemaCompiler()(turnFenceSchema);
    const fence = {
      turnId: randomUUID(),
      designationId: randomUUID(),
      designationRevision: 1,
      generation: '9223372036854775807',
      processInstanceId: randomUUID(),
    };
    assert.equal(validate(fence), true);
    for (const generation of ['9223372036854775808', '0', '01', '-1']) {
      assert.equal(validate({ ...fence, generation }), false, generation);
    }
    assert.equal(validate({ ...fence, designationRevision: '1' }), false);
    assert.equal(validate({ ...fence, extra: true }), false);
  }
});

test('assistant runtime schemas validate every serializable DTO and discriminated routing variant', async () => {
  const schemas: Record<string, unknown> = await import('../src/assistant/contracts.ts');
  const compile = assistantSchemaCompiler();
  {
    for (const [name, samples] of Object.entries(assistantContractSamples())) {
      assert.ok(schemas[name], `${name} must exist`);
      const validate = compile(schemas[name]);
      for (const sample of samples) {
        assert.equal(validate(sample), true, `${name}: ${JSON.stringify(validate.errors)}`);
        if (typeof sample === 'object' && sample !== null) {
          assert.equal(validate({ ...sample, unapproved: true }), false, `${name} rejects extra field`);
          const invalid = structuredClone(sample) as Record<string, unknown>;
          if ('kind' in invalid) {
            invalid.kind = 'unapproved';
            assert.equal(validate(invalid), false, `${name} discriminator`);
          }
          if ('name' in invalid) {
            invalid.name = 'unapproved';
            assert.equal(validate(invalid), false, `${name} tool name`);
          }
        }
      }
    }
    const request = assistantContractSamples().routingToolRequestSchema?.[4] as Record<string, unknown>;
    const validate = compile(schemas.routingToolRequestSchema);
    for (const path of [
      ['fence', 'turnId'],
      ['inputSnapshot', 'snapshotSha256'],
      ['call', 'input', 'candidateReadOperationId'],
      ['call', 'input', 'chosen', 'machineId'],
      ['call', 'input', 'sources', 0, 'kind'],
    ]) {
      const invalid = structuredClone(request);
      let cursor: Record<string | number, unknown> = invalid;
      for (const part of path.slice(0, -1)) cursor = cursor[part] as Record<string | number, unknown>;
      const last = path.at(-1);
      assert.ok(last !== undefined);
      cursor[last] = 'invalid';
      assert.equal(validate(invalid), false, `nested ${path.join('.')}`);
    }
    const tool = compile(schemas.routingToolSchema);
    assert.equal(tool({ name: 'read_catalog', input: { path: 'unexpected' } }), false);
    const swapped = structuredClone(assistantContractSamples().routingToolSchema?.[1]) as Record<
      string,
      unknown
    >;
    swapped.name = 'request_dispatch';
    assert.equal(tool(swapped), false);
    const negatives: [string, number, (string | number)[], unknown][] = [
      ['workflowRunSchema', 0, ['source', 'sourceRevision'], 'bad'],
      ['workflowRunSchema', 0, ['projection', 'derivation', 'extra'], true],
      ['workflowRunSchema', 0, ['steps', 0, 'role'], 'operator'],
      ['ownerQuestionSchema', 0, ['revision'], 0],
      ['capacityReceiptSchema', 0, ['telemetry', 'memoryAvailableBytes'], '-1'],
      ['capacityReceiptSchema', 0, ['telemetry', 'diskAvailableBytes'], '9223372036854775808'],
      ['capacityReceiptSchema', 0, ['telemetry', 'memoryPressure'], 'unknown'],
      ['capacityReceiptSchema', 0, ['telemetry', 'sampleAgeMs'], 15001],
      ['routingCertificationEvidenceSchema', 0, ['surfaces', 0, 'allowedTrace'], 'G'.repeat(64)],
      ['routingCertificationEvidenceSchema', 0, ['usage', 'costUsd'], -1],
      ['routingCertificationLaunchSchema', 0, ['context', 'key', 'machineId'], 'not-uuid'],
      ['executionCandidateSnapshotSchema', 0, ['scope', 'bindingRevision'], 1.5],
      ['executionCandidateSnapshotSchema', 0, ['entries', 0, 'capabilities'], ['unknown']],
      ['preparedDispatchSchema', 0, ['permit', 'workflow', 'checksum'], 'bad'],
      ['preparedDispatchSchema', 0, ['modelChoice', 'probeReceiptId'], 'bad'],
      ['routingToolSchema', 2, ['input', 'ticket', 'level'], 'workspace'],
      ['routingToolSchema', 2, ['input', 'ticket', 'workflowPin', 'extra'], true],
      ['routingToolSchema', 2, ['input', 'ticket', 'criteria', 'constructor'], {}],
      ['routingToolSchema', 5, ['input', 'scopeSha256'], 'bad'],
      ['routingToolResultSchema', 1, ['result', 'snapshot', 'modelConfigRevision'], 0],
      ['unclaimedStopProofSchema', 0, ['stopEvidenceId'], randomUUID()],
      ['unclaimedStopProofSchema', 1, ['generation'], '01'],
    ];
    const samples = assistantContractSamples();
    for (const [name, index, path, value] of negatives) {
      const invalid = structuredClone(samples[name]?.[index]) as Record<string | number, unknown>;
      let cursor = invalid;
      for (const part of path.slice(0, -1)) cursor = cursor[part] as Record<string | number, unknown>;
      const last = path.at(-1);
      assert.ok(last !== undefined);
      cursor[last] = value;
      assert.equal(compile(schemas[name])(invalid), false, `${name}: ${path.join('.')}`);
    }
  }
});

// Static RED preparation. The first authorized real run must fail on missing
// migration011/service; no production implementation precedes that observation.
test('assistant store schema has a durable empty inbox in the actual PostgreSQL migration prefix', async () => {
  // Before 011 exists, connect/migrate the accepted prefix010 and exercise the
  // missing relation in PostgreSQL. Once authored, require/checksum prefix011.
  const through = existsSync(new URL('../migrations/011_assistant.sql', import.meta.url)) ? 11 : 10;
  await databaseFixture(through)(async (db) => {
    const [inbox] = await db`select count(*)::integer as count from assistant_work_inbox`;
    assert.equal(inbox?.count, 0);
    const [monitor] = await db`select cursor,generation from assistant_monitor where singleton=true`;
    assert.equal(String(monitor?.cursor), '0');
    assert.equal(String(monitor?.generation), '0');
  });
});

test('assistant store retains one unrouted message across duplicate event ingestion and pool restart', async () =>
  databaseFixture(11)(async (db) => {
    const { ingestEvents } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    try {
      const submitted = await f.submitMessage();
      const ticketCount = (await db`select id from tickets`).length;
      await db.begin(async (tx) => {
        await ingestEvents(tx, submitted.cursor);
        await ingestEvents(tx, submitted.cursor);
        assert.equal(await pendingCount(tx, submitted.cursor), 1);
      });
      const [before] = await db`
        select id,logical_key,target_kind,target_id,input_revision,state,turn_id
        from assistant_work_inbox where source_cursor=${submitted.cursor}
      `;
      assert.ok(before);
      assert.equal(before.target_kind, 'message');
      assert.equal(before.target_id, submitted.message.id);
      assert.equal(String(before.input_revision), '1');
      assert.equal(before.state, 'pending');
      assert.equal(before.turn_id, null);
      const first = await openPeerDb(db);
      try {
        await first.begin((tx) => ingestEvents(tx, submitted.cursor));
      } finally {
        await first.end();
      }
      const restarted = await openPeerDb(db);
      try {
        await restarted.begin(async (tx) => {
          await ingestEvents(tx, submitted.cursor);
          assert.equal(await pendingCount(tx, submitted.cursor), 1);
        });
        const [after] = await restarted`
          select id,logical_key,target_kind,target_id,input_revision,state,turn_id
          from assistant_work_inbox where source_cursor=${submitted.cursor}
        `;
        assert.deepEqual(after, before);
        const [linked] = await restarted`
          select conversation_id,text from attachment_messages where id=${submitted.message.id}
        `;
        assert.equal(linked?.conversation_id, submitted.conversation.id);
        assert.equal(linked?.text, submitted.input.text);
        assert.equal((await restarted`select id from tickets`).length, ticketCount);
        assert.equal((await restarted`select id from attachment_messages`).length, 1);
      } finally {
        await restarted.end();
      }
    } finally {
      await f.close();
    }
  }));

test('assistant store rolls back inbox insertion and cursor together after a crashed transaction', async () =>
  databaseFixture(11)(async (db) => {
    const { ingestEvents } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    try {
      const submitted = await f.submitMessage();
      const before = await db`select cursor from assistant_monitor where singleton=true`;
      await assert.rejects(
        db.begin(async (tx) => {
          await ingestEvents(tx, submitted.cursor);
          assert.equal(await pendingCount(tx, submitted.cursor), 1);
          throw new Error('FIXTURE_CRASH_BEFORE_COMMIT');
        }),
        /FIXTURE_CRASH_BEFORE_COMMIT/,
      );
      assert.equal(await db.begin((tx) => pendingCount(tx, submitted.cursor)), 0);
      assert.deepEqual(await db`select cursor from assistant_monitor where singleton=true`, before);
      await db.begin((tx) => ingestEvents(tx, submitted.cursor));
      assert.equal(await db.begin((tx) => pendingCount(tx, submitted.cursor)), 1);
    } finally {
      await f.close();
    }
  }));

test('assistant store advances cursor in commit order without skipping or re-enqueuing an earlier event', async () =>
  databaseFixture(11)(async (db) => {
    const { ingestEvents } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    try {
      const first = await f.submitMessage('Yêu cầu thứ nhất');
      const second = await f.submitMessage('Yêu cầu thứ hai');
      await db.begin((tx) => ingestEvents(tx, first.cursor));
      assert.equal(await db.begin((tx) => pendingCount(tx, first.cursor)), 1);
      assert.equal(await db.begin((tx) => pendingCount(tx, second.cursor)), 0);
      await db.begin((tx) => ingestEvents(tx, second.cursor));
      await db.begin((tx) => ingestEvents(tx, first.cursor));
      const [monitor] = await db`select cursor from assistant_monitor where singleton=true`;
      assert.equal(String(monitor?.cursor), second.cursor);
      assert.equal(await db.begin((tx) => pendingCount(tx, first.cursor)), 1);
      assert.equal(await db.begin((tx) => pendingCount(tx, second.cursor)), 1);
    } finally {
      await f.close();
    }
  }));

test('assistant store concurrent consumers commit one wake per event target revision', async () =>
  databaseFixture(11)(async (db) => {
    const { ingestEvents } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    const peer = await openPeerDb(db);
    try {
      const submitted = await f.submitMessage();
      await Promise.all([
        db.begin((tx) => ingestEvents(tx, submitted.cursor)),
        peer.begin((tx) => ingestEvents(tx, submitted.cursor)),
      ]);
      assert.equal(await db.begin((tx) => pendingCount(tx, submitted.cursor)), 1);
      assert.equal(
        (await db`select id from assistant_work_inbox where source_cursor=${submitted.cursor}`).length,
        1,
      );
    } finally {
      await peer.end();
      await f.close();
    }
  }));

test('assistant store legacy root comment wakes current descendants using existing 009 counters exactly once', async () =>
  databaseFixture(11)(async (db) => {
    const { ingestEvents } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    try {
      const child = await f.mutation(randomUUID(), (tx) =>
        f.services.createTicket(tx, inputTicket(f.project.id, 'task', f.a.id), owner),
      );
      const { cursor } = await f.comment(f.request.id);
      const before = await db`
        select target_id,revision from attachment_input_revisions where target_kind='ticket' order by target_id
      `;
      await db.begin((tx) => ingestEvents(tx, cursor));
      const work = await db`
        select target_id,input_revision from assistant_work_inbox where source_cursor=${cursor} order by target_id
      `;
      assert.deepEqual(
        work.map((row) => row.target_id).sort(),
        [f.request.id, f.a.id, f.b.id, child.id].sort(),
      );
      assert.ok(work.every((row) => String(row.input_revision) === '2'));
      assert.deepEqual(
        await db`select target_id,revision from attachment_input_revisions where target_kind='ticket' order by target_id`,
        before,
      );
      await db.begin((tx) => ingestEvents(tx, cursor));
      assert.equal(await db.begin((tx) => pendingCount(tx, cursor)), 4);
    } finally {
      await f.close();
    }
  }));

test('assistant store child comment excludes parent and sibling work', async () =>
  databaseFixture(11)(async (db) => {
    const { ingestEvents } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    try {
      const child = await f.mutation(randomUUID(), (tx) =>
        f.services.createTicket(tx, inputTicket(f.project.id, 'task', f.a.id), owner),
      );
      const { cursor } = await f.comment(f.a.id);
      await db.begin((tx) => ingestEvents(tx, cursor));
      const work = await db`select target_id from assistant_work_inbox where source_cursor=${cursor}`;
      assert.deepEqual(work.map((row) => row.target_id).sort(), [f.a.id, child.id].sort());
    } finally {
      await f.close();
    }
  }));

test('assistant store does not create an Assistant wake from unrelated internal probe metadata', async () =>
  databaseFixture(11)(async (db) => {
    const { ingestEvents } = await import('../src/assistant/inbox.ts');
    const event = await db.begin((tx) =>
      appendEvent(tx, {
        type: 'probe',
        projectId: null,
        ticketId: null,
        audienceMachineId: null,
        data: {},
      }),
    );
    await db.begin((tx) => ingestEvents(tx, event.cursor));
    assert.equal(await db.begin((tx) => pendingCount(tx, event.cursor)), 0);
    const [monitor] = await db`select cursor from assistant_monitor where singleton=true`;
    assert.equal(String(monitor?.cursor), event.cursor);
  }));

test('assistant store revision reconciliation recovers an unrouted message and deduplicates its later event', async () =>
  databaseFixture(11)(async (db) => {
    const { ingestEvents, reconcileWork } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    try {
      const submitted = await f.submitMessage();
      await db.begin((tx) => reconcileWork(tx));
      const [recovered] = await db`
        select id,target_id,input_revision,state from assistant_work_inbox
        where target_kind='message' and target_id=${submitted.message.id}
      `;
      assert.ok(recovered);
      assert.equal(recovered.target_id, submitted.message.id);
      assert.equal(String(recovered.input_revision), '1');
      assert.equal(recovered.state, 'pending');
      await db.begin((tx) => reconcileWork(tx));
      await db.begin((tx) => ingestEvents(tx, submitted.cursor));
      const rows = await db`
        select id,target_id,input_revision,state from assistant_work_inbox
        where target_kind='message' and target_id=${submitted.message.id}
      `;
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], recovered);
      assert.equal((await db`select id from assistant_turns`).length, 0);
    } finally {
      await f.close();
    }
  }));

test('assistant store revision reconciliation preserves newer child input without waking its unchanged sibling twice', async () =>
  databaseFixture(11)(async (db) => {
    const { ingestEvents, reconcileWork } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    try {
      await db.begin((tx) => reconcileWork(tx));
      const siblingBefore = await db`
        select id,input_revision,state from assistant_work_inbox
        where target_kind='ticket' and target_id=${f.b.id} and input_revision is not null order by id
      `;
      const changed = await f.comment(f.a.id);
      await db.begin((tx) => reconcileWork(tx));
      await db.begin((tx) => ingestEvents(tx, changed.cursor));
      const changedRows = await db`
        select input_revision from assistant_work_inbox
        where target_kind='ticket' and target_id=${f.a.id} and input_revision is not null order by input_revision
      `;
      assert.deepEqual(
        changedRows.map((row) => String(row.input_revision)),
        ['1', '2'],
      );
      const siblingAfter = await db`
        select id,input_revision,state from assistant_work_inbox
        where target_kind='ticket' and target_id=${f.b.id} and input_revision is not null order by id
      `;
      assert.deepEqual(siblingAfter, siblingBefore);
      assert.equal((await db`select id from assistant_turns`).length, 0);
    } finally {
      await f.close();
    }
  }));

test('assistant store input events share a revision wake without rewriting its original cursor or logical key', async () =>
  databaseFixture(11)(async (db) => {
    const { ingestEvents } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    try {
      const submitted = await f.submitMessage();
      await db.begin((tx) => ingestEvents(tx, submitted.cursor));
      const original = await db`
        select id,logical_key,source_cursor,target_id,input_revision,state from assistant_work_inbox
        where target_kind='message' and target_id=${submitted.message.id}
      `;
      const machineId = randomUUID();
      await db`insert into machines(id,name,token_hash) values(${machineId},'fixture-input-wake',${'f'.repeat(64)})`;
      const duplicate = await db.begin((tx) =>
        appendEvent(tx, {
          type: 'attachment.input.changed',
          projectId: null,
          ticketId: null,
          audienceMachineId: machineId,
          data: { targetKind: 'message', targetId: submitted.message.id, inputRevision: '1' },
        }),
      );
      await db.begin((tx) => ingestEvents(tx, duplicate.cursor));
      assert.deepEqual(
        await db`
        select id,logical_key,source_cursor,target_id,input_revision,state from assistant_work_inbox
        where target_kind='message' and target_id=${submitted.message.id}
      `,
        original,
      );
      const [monitor] = await db`select cursor from assistant_monitor where singleton=true`;
      assert.equal(String(monitor?.cursor), duplicate.cursor);
    } finally {
      await f.close();
    }
  }));

test('assistant store distinct lifecycle events survive deduplication while input revision is unchanged', async () =>
  databaseFixture(11)(async (db) => {
    const { ingestEvents } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    try {
      const cursors: string[] = [];
      let revision = f.a.revision;
      for (const signal of ['wait_owner', 'resume'] as const) {
        const ticket = await f.mutation(randomUUID(), (tx) =>
          f.services.signalTicket(tx, f.a.id, signal, revision, null, owner),
        );
        revision = ticket.revision;
        const [event] = await db`
          select cursor from events where type='ticket.changed' and ticket_id=${f.a.id}
          and (data->>'revision')::integer=${revision}
        `;
        assert.ok(event);
        cursors.push(String(event.cursor));
      }
      await db.begin((tx) => ingestEvents(tx, cursors[1] ?? '0'));
      const work = await db`
        select source_cursor,input_revision from assistant_work_inbox
        where source_cursor in ${db(cursors)} order by source_cursor
      `;
      assert.deepEqual(
        work.map((row) => String(row.source_cursor)),
        cursors,
      );
      assert.ok(work.every((row) => row.input_revision === null));
    } finally {
      await f.close();
    }
  }));

test('assistant store rejects claiming work with an unpersisted turn fence and preserves pending delivery', async () =>
  databaseFixture(11)(async (db) => {
    const { claimWork, ingestEvents } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    try {
      const submitted = await f.submitMessage();
      await db.begin((tx) => ingestEvents(tx, submitted.cursor));
      const [work] = await db`
        select id,state,turn_id,claim_generation,attempts,acked_at from assistant_work_inbox
        where target_kind='message' and target_id=${submitted.message.id}
      `;
      assert.ok(work);
      await assert.rejects(
        db.begin((tx) =>
          claimWork(tx, String(work.id), {
            turnId: randomUUID(),
            designationId: randomUUID(),
            designationRevision: 1,
            generation: '1',
            processInstanceId: randomUUID(),
          }),
        ),
        { status: 409 },
      );
      const [after] = await db`
        select id,state,turn_id,claim_generation,attempts,acked_at from assistant_work_inbox where id=${work.id}
      `;
      assert.deepEqual(after, work);
      assert.equal(after?.state, 'pending');
    } finally {
      await f.close();
    }
  }));

test('assistant store rejects acknowledging mere delivery without persisted turn authority', async () =>
  databaseFixture(11)(async (db) => {
    const { ackWork, ingestEvents } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    try {
      const submitted = await f.submitMessage();
      await db.begin((tx) => ingestEvents(tx, submitted.cursor));
      const [work] = await db`
        select id,state,turn_id,claim_generation,attempts,acked_at from assistant_work_inbox
        where target_kind='message' and target_id=${submitted.message.id}
      `;
      assert.ok(work);
      await assert.rejects(
        db.begin((tx) =>
          ackWork(tx, String(work.id), {
            turnId: randomUUID(),
            designationId: randomUUID(),
            designationRevision: 1,
            generation: '1',
            processInstanceId: randomUUID(),
          }),
        ),
        { status: 409 },
      );
      const [after] = await db`
        select id,state,turn_id,claim_generation,attempts,acked_at from assistant_work_inbox where id=${work.id}
      `;
      assert.deepEqual(after, work);
      assert.equal(after?.state, 'pending');
    } finally {
      await f.close();
    }
  }));

test('assistant store claims once and acknowledges only its exact current persisted fence', async () =>
  databaseFixture(11)(async (db) => {
    const { claimWork, ackWork, ingestEvents, reconcileWork } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    try {
      const m = await f.submitMessage();
      const fence = await f.seedTurn(m.conversation.id, m.message.id);
      await db.begin((tx) => ingestEvents(tx, m.cursor));
      const [work] =
        await db`select id from assistant_work_inbox where target_kind='message' and target_id=${m.message.id}`;
      assert.ok(work);
      for (const change of [
        { processInstanceId: randomUUID() },
        { generation: '2' },
        { designationRevision: 2 },
        { designationId: randomUUID() },
      ])
        await assert.rejects(
          db.begin((tx) => claimWork(tx, String(work.id), { ...fence, ...change })),
          { status: 409 },
        );
      await db.begin((tx) => claimWork(tx, String(work.id), fence));
      await db.begin((tx) => claimWork(tx, String(work.id), fence));
      const [claimed] =
        await db`select state,attempts,acked_at from assistant_work_inbox where id=${work.id}`;
      assert.equal(claimed?.state, 'claimed');
      assert.equal(claimed?.attempts, 1);
      assert.equal(claimed?.acked_at, null);
      await db`update assistant_config set designation_id=null,revision=revision+1 where singleton=true`;
      await assert.rejects(
        db.begin((tx) => ackWork(tx, String(work.id), fence)),
        { status: 409 },
      );
      const [held] = await db`select state,attempts,acked_at from assistant_work_inbox where id=${work.id}`;
      assert.deepEqual(held, claimed);
      await db`update assistant_config set designation_id=${fence.designationId},revision=revision+1 where singleton=true`;
      await db.begin((tx) => ackWork(tx, String(work.id), fence));
      await db.begin((tx) => ackWork(tx, String(work.id), fence));
      await db.begin((tx) => reconcileWork(tx));
      const done =
        await db`select state,attempts,acked_at from assistant_work_inbox where target_kind='message' and target_id=${m.message.id}`;
      assert.equal(done.length, 1);
      assert.equal(done[0]?.state, 'acked');
      assert.equal(done[0]?.attempts, 1);
      assert.ok(done[0]?.acked_at);
    } finally {
      await f.close();
    }
  }));

test('assistant store uncertain turn retains singleton guard and claimed work across restart', async () =>
  databaseFixture(11)(async (db) => {
    const { claimWork, ackWork, ingestEvents } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    try {
      const m = await f.submitMessage();
      const fence = await f.seedTurn(m.conversation.id, m.message.id);
      await db.begin((tx) => ingestEvents(tx, m.cursor));
      const [work] =
        await db`select id from assistant_work_inbox where target_kind='message' and target_id=${m.message.id}`;
      assert.ok(work);
      await db.begin((tx) => claimWork(tx, String(work.id), fence));
      await db`update assistant_turns set state='uncertain' where id=${fence.turnId}`;
      const peer = await openPeerDb(db);
      try {
        await assert.rejects(
          peer.begin((tx) => ackWork(tx, String(work.id), fence)),
          { status: 409 },
        );
        await assert.rejects(
          peer`insert into assistant_turns(id,conversation_id,message_id,designation_id,designation_revision,generation,process_instance_id,model_selection_id,state)
          select ${randomUUID()},conversation_id,message_id,designation_id,designation_revision,2,${randomUUID()},${randomUUID()},'reserved'
          from assistant_turns where id=${fence.turnId}`,
          { code: '23505' },
        );
        const [held] = await peer`select state from assistant_turns where id=${fence.turnId}`;
        assert.equal(held?.state, 'uncertain');
        const [pending] = await peer`select state,acked_at from assistant_work_inbox where id=${work.id}`;
        assert.equal(pending?.state, 'claimed');
        assert.equal(pending?.acked_at, null);
      } finally {
        await peer.end();
      }
    } finally {
      await f.close();
    }
  }));

test('assistant store generation allocation rolls back and fails rather than wrapping bigint', async () =>
  databaseFixture(11)(async (db) => {
    const { allocateAssistantGeneration } = await import('../src/assistant/store.ts');
    await assert.rejects(
      db.begin(async (tx) => {
        assert.equal(await allocateAssistantGeneration(tx), '1');
        throw new Error('RESERVATION_ROLLBACK');
      }),
      /RESERVATION_ROLLBACK/,
    );
    assert.equal(await db.begin((tx) => allocateAssistantGeneration(tx)), '1');
    assert.equal(await db.begin((tx) => allocateAssistantGeneration(tx)), '2');
    await db`update assistant_monitor set generation=9223372036854775807 where singleton=true`;
    await assert.rejects(
      db.begin((tx) => allocateAssistantGeneration(tx)),
      { code: 'ASSISTANT_GENERATION_EXHAUSTED' },
    );
    const [row] = await db`select generation from assistant_monitor where singleton=true`;
    assert.equal(String(row?.generation), '9223372036854775807');
  }));

test('assistant store turn linkage is immutable and exact to the submitted conversation', async () =>
  databaseFixture(11)(async (db) => {
    const f = await assistantFixture(db);
    try {
      const first = await f.submitMessage();
      const second = await f.submitMessage();
      const fence = await f.seedTurn(first.conversation.id, first.message.id);
      await assert.rejects(
        db`update assistant_turns set message_id=${second.message.id} where id=${fence.turnId}`,
        /ASSISTANT_RECORD_IMMUTABLE/,
      );
      await assert.rejects(
        db`update assistant_turns set conversation_id=${second.conversation.id} where id=${fence.turnId}`,
        /ASSISTANT_RECORD_IMMUTABLE/,
      );
      await assert.rejects(
        db`update attachment_messages set text='Thay đổi' where id=${first.message.id}`,
        /ATTACHMENT_RECORD_IMMUTABLE/,
      );
      const [stored] =
        await db`select conversation_id,message_id from assistant_turns where id=${fence.turnId}`;
      assert.equal(stored?.conversation_id, first.conversation.id);
      assert.equal(stored?.message_id, first.message.id);
    } finally {
      await f.close();
    }
  }));

test('assistant store routing certificate cannot change deployment or admit a different binary context', async () =>
  databaseFixture(11)(async (db) => {
    const f = await assistantFixture(db);
    try {
      const m = await f.submitMessage();
      await f.seedTurn(m.conversation.id, m.message.id);
      await assert.rejects(
        db`update assistant_config set deployment_id=${randomUUID()} where singleton=true`,
        /ASSISTANT_RECORD_IMMUTABLE/,
      );
      await assert.rejects(
        db`update assistant_policy_receipts set status='PASS'`,
        /ASSISTANT_RECORD_IMMUTABLE/,
      );
      await assert.rejects(
        db`insert into assistant_policy_receipts(id,deployment_id,challenge_id,verifier_build_sha256,machine_id,model_key,os_version,binary_sha256,policy_sha256,probe_context_sha256,status,evidence_ids,expires_at)
        select ${randomUUID()},deployment_id,challenge_id,verifier_build_sha256,machine_id,model_key,os_version,${'0'.repeat(64)},policy_sha256,probe_context_sha256,status,evidence_ids,expires_at from assistant_policy_receipts`,
        /ASSISTANT_CERTIFICATION_CONTEXT_MISMATCH/,
      );
      await assert.rejects(
        db`update routing_capability_receipts set context_sha256=${'0'.repeat(64)}`,
        /ASSISTANT_RECORD_IMMUTABLE/,
      );
    } finally {
      await f.close();
    }
  }));

test('assistant store uncertain budget cannot rewind or settle without a reported spend receipt', async () =>
  databaseFixture(11)(async (db) => {
    const f = await assistantFixture(db);
    try {
      const m = await f.submitMessage();
      const id = randomUUID();
      await db`insert into assistant_budget_reservations(id,scope_kind,scope_id,reserved_usd,spent_usd,state)
        values(${id},'conversation',${m.conversation.id},5,1,'uncertain')`;
      await assert.rejects(
        db`update assistant_budget_reservations set spent_usd=0 where id=${id}`,
        /ASSISTANT_BUDGET_REWIND/,
      );
      await assert.rejects(
        db`update assistant_budget_reservations set state='reserved' where id=${id}`,
        /ASSISTANT_BUDGET_REWIND/,
      );
      await assert.rejects(
        db`update assistant_budget_reservations set state='settled' where id=${id}`,
        /ASSISTANT_BUDGET_RECEIPT_REQUIRED/,
      );
      const [row] =
        await db`select state,reserved_usd,spent_usd from assistant_budget_reservations where id=${id}`;
      assert.equal(row?.state, 'uncertain');
      assert.equal(Number(row?.reserved_usd), 5);
      assert.equal(Number(row?.spent_usd), 1);
      const [config] =
        await db`select policy->>'maxCostUsdPerRun' as budget from assistant_config where singleton=true`;
      assert.equal(config?.budget, '0');
    } finally {
      await f.close();
    }
  }));

test('assistant store durable effects use hex64 and a persisted ordinal across repeated intentional actions', async () =>
  databaseFixture(11)(async (db) => {
    const f = await assistantFixture(db);
    try {
      const run = await f.seedWorkflowRows();
      const insert = (id: string, identity: string, effect: string) => db`
        insert into assistant_operation_ids(id,run_id,step_id,action_kind,target_identity,precondition_sha256,effect_id)
        values(${id},${run.runId},${run.stepId},'write',${identity},${'a'.repeat(64)},${effect})`;
      await insert(randomUUID(), 'fixture.txt:ordinal:1', 'b'.repeat(64));
      await assert.rejects(insert(randomUUID(), 'fixture.txt:ordinal:1', 'c'.repeat(64)), { code: '23505' });
      await assert.rejects(insert(randomUUID(), 'fixture.txt:ordinal:2', 'b'.repeat(64)), { code: '23505' });
      await assert.rejects(insert(randomUUID(), 'fixture.txt:ordinal:2', randomUUID()), { code: '23514' });
      await insert(randomUUID(), 'fixture.txt:ordinal:2', 'c'.repeat(64));
      await assert.rejects(
        db`update assistant_operation_ids set effect_id=${'d'.repeat(64)} where target_identity='fixture.txt:ordinal:1'`,
        /ASSISTANT_RECORD_IMMUTABLE/,
      );
      const rows =
        await db`select target_identity,effect_id from assistant_operation_ids order by target_identity`;
      assert.deepEqual(
        rows.map((r) => [r.target_identity, r.effect_id]),
        [
          ['fixture.txt:ordinal:1', 'b'.repeat(64)],
          ['fixture.txt:ordinal:2', 'c'.repeat(64)],
        ],
      );
    } finally {
      await f.close();
    }
  }));

test('assistant store tool operations keep sequence and completed result immutable', async () =>
  databaseFixture(11)(async (db) => {
    const f = await assistantFixture(db);
    try {
      const m = await f.submitMessage();
      const fence = await f.seedTurn(m.conversation.id, m.message.id);
      const snapshotId = randomUUID(),
        operationId = randomUUID();
      await db`insert into attachment_input_snapshots(id,target_kind,target_id,input_revision,route_revision,canonical,sha256)
        values(${snapshotId},'message',${m.message.id},1,0,'{}',${'a'.repeat(64)})`;
      await db`insert into assistant_tool_operations(operation_id,turn_id,client_sequence,provider_call_id,request_hash,input_snapshot_id,state)
        values(${operationId},${fence.turnId},1,'provider-1',${'b'.repeat(64)},${snapshotId},'pending')`;
      await assert.rejects(
        db`insert into assistant_tool_operations(operation_id,turn_id,client_sequence,provider_call_id,request_hash,input_snapshot_id,state)
        values(${randomUUID()},${fence.turnId},1,'provider-2',${'c'.repeat(64)},${snapshotId},'pending')`,
        { code: '23505' },
      );
      await assert.rejects(
        db`update assistant_tool_operations set request_hash=${'c'.repeat(64)} where operation_id=${operationId}`,
        /ASSISTANT_RECORD_IMMUTABLE/,
      );
      const response = { operationId, state: 'rejected', result: null, errorCode: 'FIXTURE_NOT_ADMITTED' };
      await db`update assistant_tool_operations set state='rejected',response=${db.json(response)} where operation_id=${operationId}`;
      await assert.rejects(
        db`update assistant_tool_operations set response='{}' where operation_id=${operationId}`,
        /ASSISTANT_TOOL_RESULT_IMMUTABLE/,
      );
      const [stored] =
        await db`select response from assistant_tool_operations where operation_id=${operationId}`;
      assert.deepEqual(stored?.response, response);
    } finally {
      await f.close();
    }
  }));

test('assistant store prelaunch hook rejects missing or different process identity and binds a matching claim atomically', async () =>
  databaseFixture(11)(async (db) => {
    const f = await assistantFixture(db);
    try {
      const dispatch = await f.seedDispatchRows();
      await assert.rejects(dispatch.insertAttempt(randomUUID()), /ASSISTANT_PRELAUNCH_REQUIRED/);
      const launch = await dispatch.launch();
      await assert.rejects(dispatch.insertAttempt(randomUUID()), /ASSISTANT_PRELAUNCH_REQUIRED/);
      assert.equal((await db`select id from attempts where command_id=${dispatch.command.id}`).length, 0);
      const [before] = await db`select state from assistant_reservations where id=${dispatch.reservationId}`;
      assert.equal(before?.state, 'reserved');
      const attemptId = await dispatch.insertAttempt(launch.processInstanceId);
      const [bound] =
        await db`select state,attempt_id from assistant_launch_authorizations where command_id=${dispatch.command.id}`;
      const [active] = await db`select state from assistant_reservations where id=${dispatch.reservationId}`;
      assert.equal(bound?.state, 'claimed');
      assert.equal(bound?.attempt_id, attemptId);
      assert.equal(active?.state, 'active');
      await assert.rejects(
        db`update assistant_reservations set state='released' where id=${dispatch.reservationId}`,
        /ASSISTANT_FINALIZATION_REQUIRED/,
      );
      await db`update attempts set state='finalizing',stopped_at=now(),stop_reason='exit' where id=${attemptId}`;
      await assert.rejects(
        db`update assistant_reservations set state='released' where id=${dispatch.reservationId}`,
        /ASSISTANT_FINALIZATION_REQUIRED/,
      );
      await db`update attempts set state='stopped',finalized_at=now() where id=${attemptId}`;
      await db`update assistant_reservations set state='released' where id=${dispatch.reservationId}`;
      const [released] =
        await db`select state from assistant_reservations where id=${dispatch.reservationId}`;
      assert.equal(released?.state, 'released');
    } finally {
      await f.close();
    }
  }));

test('assistant store retirement tombstone blocks claim and unclaimed release needs exact never-authorized proof', async () =>
  databaseFixture(11)(async (db) => {
    const f = await assistantFixture(db);
    try {
      const dispatch = await f.seedDispatchRows();
      const retirementId = randomUUID();
      await db`insert into assistant_dispatch_retirements(command_id,retirement_id,reason) values(${dispatch.command.id},${retirementId},'expired')`;
      await assert.rejects(
        db`update assistant_reservations set state='released' where id=${dispatch.reservationId}`,
        /ASSISTANT_RETIREMENT_PROOF_REQUIRED/,
      );
      const proof = { kind: 'never-authorized', commandId: dispatch.command.id, retirementId };
      await db`update assistant_dispatch_retirements set proof=${db.json(proof)},released_at=now() where command_id=${dispatch.command.id}`;
      await db`update assistant_reservations set state='released' where id=${dispatch.reservationId}`;
      const launch = await dispatch.launch();
      await assert.rejects(dispatch.insertAttempt(launch.processInstanceId), /ASSISTANT_PRELAUNCH_REQUIRED/);
      await assert.rejects(
        db`update assistant_dispatch_retirements set proof='{}' where command_id=${dispatch.command.id}`,
        /ASSISTANT_RECORD_LATCHED/,
      );
      assert.equal((await db`select id from attempts where command_id=${dispatch.command.id}`).length, 0);
    } finally {
      await f.close();
    }
  }));

test('assistant store derived route consent cannot extend parent expiry or widen original access', async () =>
  databaseFixture(11)(async (db) => {
    const f = await assistantFixture(db);
    try {
      const m = await f.submitMessage();
      const routeId = randomUUID(),
        decisionId = randomUUID(),
        parentId = randomUUID();
      await db`insert into attachment_message_decisions(id,message_id,input_revision,actor_kind,actor_id,kind,body,sha256)
        values(${decisionId},${m.message.id},1,'owner','owner','routing','{}',${'a'.repeat(64)})`;
      await db`insert into attachment_message_routes(id,message_id,revision,project_id,ticket_id,decision_id)
        values(${routeId},${m.message.id},1,${f.project.id},${f.request.id},${decisionId})`;
      const original = { attachmentId: randomUUID(), sha256: 'e'.repeat(64), ownerId: 'owner' };
      await db`insert into attachment_submission_authorizations(id,target_kind,target_id,originals,authorization_sha256,allow_original,expires_at)
        values(${parentId},'message',${m.message.id},${db.json([original])},${'b'.repeat(64)},false,now()+interval '1 hour')`;
      for (const invalid of [
        { minutes: 120, allowOriginal: false, ticketId: f.request.id, originals: [] },
        { minutes: 30, allowOriginal: true, ticketId: f.request.id, originals: [] },
        { minutes: 30, allowOriginal: false, ticketId: f.a.id, originals: [] },
        {
          minutes: 30,
          allowOriginal: false,
          ticketId: f.request.id,
          originals: [{ attachmentId: original.attachmentId }],
        },
      ]) {
        const derivedId = randomUUID();
        await db`insert into attachment_submission_authorizations(id,target_kind,target_id,originals,authorization_sha256,allow_original,expires_at)
          values(${derivedId},'ticket',${invalid.ticketId},${db.json(invalid.originals)},${'c'.repeat(64)},${invalid.allowOriginal},now()+${invalid.minutes}*interval '1 minute')`;
        await assert.rejects(
          db`insert into assistant_route_authorizations(route_id,parent_authorization_id,derived_authorization_id,parent_scope_sha256)
          values(${routeId},${parentId},${derivedId},${'b'.repeat(64)})`,
          /ASSISTANT_ROUTE_CONSENT_MISMATCH/,
        );
      }
      const validId = randomUUID();
      await db`insert into attachment_submission_authorizations(id,target_kind,target_id,originals,authorization_sha256,allow_original,expires_at)
        values(${validId},'ticket',${f.request.id},'[]',${'c'.repeat(64)},false,now()+interval '30 minutes')`;
      await assert.rejects(
        db`insert into assistant_route_authorizations(route_id,parent_authorization_id,derived_authorization_id,parent_scope_sha256)
        values(${routeId},${parentId},${validId},${'d'.repeat(64)})`,
        /ASSISTANT_ROUTE_CONSENT_MISMATCH/,
      );
      await db`insert into assistant_route_authorizations(route_id,parent_authorization_id,derived_authorization_id,parent_scope_sha256)
        values(${routeId},${parentId},${validId},${'b'.repeat(64)})`;
      const [linked] =
        await db`select derived_authorization_id from assistant_route_authorizations where route_id=${routeId}`;
      assert.equal(linked?.derived_authorization_id, validId);
    } finally {
      await f.close();
    }
  }));

test('assistant store capacity hashes are required hex64 immutable values independent of the request receipt latch', async () =>
  databaseFixture(11)(async (db) => {
    const f = await assistantFixture(db);
    try {
      const dispatch = await f.seedDispatchRows();
      const [row] = await db`select q.id as request_id,q.request_sha256,r.id as receipt_id,r.receipt_sha256
        from assistant_capacity_requests q join assistant_capacity_receipts r on r.id=q.receipt_id
        where q.machine_id=${dispatch.machineId}`;
      assert.match(String(row?.request_sha256), /^[0-9a-f]{64}$/);
      assert.match(String(row?.receipt_sha256), /^[0-9a-f]{64}$/);
      assert.equal(
        row?.request_sha256,
        createHash('sha256').update(canonicalJson(dispatch.request)).digest('hex'),
      );
      assert.equal(
        row?.receipt_sha256,
        createHash('sha256').update(canonicalJson(dispatch.receipt)).digest('hex'),
      );
      await assert.rejects(
        db`update assistant_capacity_requests set request_sha256=${'f'.repeat(64)} where id=${row?.request_id}`,
        /ASSISTANT_RECORD_IMMUTABLE/,
      );
      await assert.rejects(
        db`update assistant_capacity_receipts set receipt_sha256=${'f'.repeat(64)} where id=${row?.receipt_id}`,
        /ASSISTANT_RECORD_IMMUTABLE/,
      );
      await assert.rejects(
        db`update assistant_capacity_requests set receipt_id=null where id=${row?.request_id}`,
        /ASSISTANT_RECORD_LATCHED/,
      );
      for (const value of [null, 'bad']) {
        await assert.rejects(
          db`insert into assistant_capacity_requests(id,machine_id,ticket_id,kind,ownership_keys,boot_generation,requested_at,expires_at,request_sha256)
          values(${randomUUID()},${dispatch.machineId},${f.a.id},'implement','[]','1',now(),now()+interval '10 seconds',${value})`,
          { code: value === null ? '23502' : '23514' },
        );
        await assert.rejects(
          db`insert into assistant_capacity_receipts(id,request_id,machine_id,boot_generation,ticket_id,kind,ownership_keys,telemetry,received_at,expires_at,allowed,reason,receipt_sha256)
          values(${randomUUID()},${row?.request_id},${dispatch.machineId},'1',${f.a.id},'implement','[]','{}',now(),now()+interval '10 seconds',true,'Fixture',${value})`,
          { code: value === null ? '23502' : '23514' },
        );
      }
    } finally {
      await f.close();
    }
  }));

test('assistant store restores prefix010 before upgrade and prefix011 with identical data and migration hashes', async () =>
  databaseFixture(10)(async (db) => {
    const { verifyBackupRestore } = await import('./support/assistant.ts');
    const { captureMigrations, migrate } = await import('../src/db/migrate.ts');
    const { ingestEvents } = await import('../src/assistant/inbox.ts');
    const f = await assistantFixture(db);
    let cursor: string;
    try {
      cursor = (await f.submitMessage('Nội dung phải giữ nguyên qua backup và restore')).cursor;
    } finally {
      await f.close();
    }
    const before = await db`select version,checksum from schema_migrations order by version`;
    await verifyBackupRestore(db, 10);
    const prefix11 = await captureMigrations(11);
    await migrate(db, prefix11);
    assert.deepEqual(
      await db`select version,checksum from schema_migrations where version<=10 order by version`,
      before,
    );
    await db.begin((tx) => ingestEvents(tx, cursor));
    assert.equal(await db.begin((tx) => pendingCount(tx, cursor)), 1);
    await verifyBackupRestore(db, 11);
    const [eleventh] = await db`select checksum from schema_migrations where version=11`;
    assert.equal(eleventh?.checksum, prefix11.files[10]?.sha256);
  }));
