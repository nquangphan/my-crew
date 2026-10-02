import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { denyPreclaimSelection } from '../src/attachments/grants.ts';
import {
  assertDispatchInputsCurrent,
  assessSnapshotCapabilities,
  readInputSnapshot,
} from '../src/attachments/snapshots.ts';
import { attachmentAccessFixture } from './support/attachment-access.ts';
import { databaseFixture } from './support/db.ts';
import { owner } from './support/tickets.ts';

test('attachment snapshot pending extraction cannot invent capabilities; descendant comments invalidate exact counter', async () => {
  await databaseFixture(10)(async (db) => {
    const f = await attachmentAccessFixture(db);
    try {
      await f.linkFile('A', Buffer.from('waiting'));
      const child = await f.child('A');
      const target = { kind: 'ticket' as const, ticketId: child.id, projectId: f.projects.A.id };
      const read = () =>
        f.mutation((tx) =>
          readInputSnapshot(
            tx,
            owner,
            { target, access: { kind: 'owner' }, expectedInputRevision: null, scopeDecisionId: null },
            denyPreclaimSelection,
          ),
        );
      const before = await read();
      assert.equal(before.state, 'ready'); // Child has comments, only explicitly inherited refs.
      const [source] = await db`select id from attachment_links where ticket_id=${f.tickets.A.id}`;
      const inherited = await f.ownerRequest('POST', `/v2/tickets/${child.id}/attachment-references`, {
        sourceLinkIds: [source.id],
      });
      assert.equal(inherited.statusCode, 201, inherited.body);
      const pending = await read();
      assert.equal(pending.state, 'waiting');
      assert.equal(pending.problems[0]?.code, 'EXTRACTION_PENDING');
      assert.deepEqual(pending.requiredCapabilities, []);
      const comment = await f.ownerRequest('POST', `/v2/tickets/${f.tickets.A.id}/comments`, {
        text: 'new root input',
      });
      assert.equal(comment.statusCode, 201, comment.body);
      const after = await read();
      assert.equal(BigInt(after.inputRevision), BigInt(pending.inputRevision) + 1n);
      assert.equal(after.comments.length, pending.comments.length + 1);
      await assert.rejects(
        f.mutation((tx) =>
          readInputSnapshot(
            tx,
            owner,
            {
              target,
              access: { kind: 'owner' },
              expectedInputRevision: pending.inputRevision,
              scopeDecisionId: null,
            },
            denyPreclaimSelection,
          ),
        ),
        { code: 'INPUT_SNAPSHOT_STALE' },
      );
      assert.equal(assessSnapshotCapabilities(pending, ['text', 'vision']).state, 'waiting');
      await assert.rejects(
        f.mutation((tx) =>
          readInputSnapshot(
            tx,
            f.actors.B,
            {
              target,
              access: { kind: 'bound-project', projectId: f.projects.A.id, bindingRevision: 2 },
              expectedInputRevision: null,
              scopeDecisionId: null,
            },
            denyPreclaimSelection,
          ),
        ),
        { code: 'NOT_FOUND' },
      );
      await assert.rejects(
        f.mutation((tx) =>
          readInputSnapshot(
            tx,
            owner,
            { target, access: { kind: 'owner' }, expectedInputRevision: null, scopeDecisionId: randomUUID() },
            denyPreclaimSelection,
          ),
        ),
        { code: 'PRECLAIM_SELECTION_NOT_CONFIGURED' },
      );
      await assert.rejects(
        f.mutation((tx) =>
          assertDispatchInputsCurrent(
            tx,
            {
              commandId: randomUUID(),
              decisionId: randomUUID(),
              pin: {
                snapshotId: pending.id,
                snapshotSha256: pending.sha256,
                inputRevision: pending.inputRevision,
                selectionSha256: '0'.repeat(64),
              },
              modelRequired: ['text'],
            },
            f.actors.A,
          ),
        ),
        { code: 'INPUT_SNAPSHOT_STALE' },
      );
    } finally {
      await f.close();
    }
  });
});

test('attachment subset selection binds exact original identity when unit IDs repeat across files', async () => {
  const { fixturePng, publishKnownRepresentation } = await import(
    './support/attachment-access-publication.ts'
  );
  const { digest } = await import('../src/attachments/submissions.ts');
  const { recordDecision } = await import('../src/tickets/decisions.ts');
  await databaseFixture(10)(async (db) => {
    const f = await attachmentAccessFixture(db);
    try {
      const a = await f.linkFile('A', fixturePng, 'a.png'),
        b = await f.linkFile('A', Buffer.from('text input'));
      const ea = await publishKnownRepresentation(f, a),
        eb = await publishKnownRepresentation(f, b, 'text');
      const target = { kind: 'ticket' as const, ticketId: f.tickets.A.id, projectId: f.projects.A.id };
      const all = await f.mutation((tx) =>
        readInputSnapshot(
          tx,
          owner,
          { target, access: { kind: 'owner' }, expectedInputRevision: null, scopeDecisionId: null },
          denyPreclaimSelection,
        ),
      );
      assert.equal(all.state, 'ready');
      assert.deepEqual(all.requiredCapabilities, ['text', 'vision']);
      const u = ea.units[0];
      assert.ok(u);
      const inputSelection = {
        target,
        inputRevision: all.inputRevision,
        routeRevision: all.routeRevision,
        required: [{ original: a, unitIds: ['u1'] }],
        unitsSha256: digest([
          {
            original: a,
            extractionId: ea.id,
            manifestSha256: ea.manifestSha256,
            unitId: u.id,
            locator: u.locator,
            needs: u.needs,
          },
        ]),
        rationale: 'Chỉ đánh giá ảnh đã chọn.',
      };
      const decision = await f.mutation((tx) =>
        recordDecision(
          tx,
          target.ticketId,
          {
            kind: 'assessment',
            content: 'Scope',
            rationale: 'Scoped fixture',
            sources: [],
            scope: { inputSelection },
          },
          owner,
        ),
      );
      const approved = async (
        tx: import('../src/platform/contracts.ts').Tx,
        _actor: import('../src/platform/contracts.ts').Actor,
        input: Parameters<import('../src/attachments/contracts.ts').PreclaimSelectionAuthority>[2],
      ) => {
        const [row] = await tx`select scope from decisions where id=${input.scopeDecisionId}`;
        assert.deepEqual(row.scope.inputSelection, inputSelection);
        assert.deepEqual(input.requestedUnitIds, ['u1']);
      };
      const subset = await f.mutation((tx) =>
        readInputSnapshot(
          tx,
          owner,
          {
            target,
            access: { kind: 'owner' },
            expectedInputRevision: all.inputRevision,
            scopeDecisionId: decision,
          },
          approved,
        ),
      );
      assert.equal(subset.state, 'ready');
      assert.deepEqual(subset.required, [{ original: a, unitIds: ['u1'] }]);
      assert.deepEqual(subset.requiredCapabilities, ['vision']);
      assert.deepEqual(subset.selectedDerivativeIds, [ea.derivatives[0]?.id]);
      assert.ok(!subset.selectedDerivativeIds.includes(eb.derivatives[0]?.id));
      for (const changed of [
        { required: [] },
        { unitsSha256: '0'.repeat(64) },
        { inputRevision: '1' },
        { target: { ...target, ticketId: f.tickets.B.id } },
        { required: [{ original: a, unitIds: ['unknown'] }] },
        { required: [{ original: { ...a, sha256: b.sha256 }, unitIds: ['u1'] }] },
      ]) {
        const id = await f.mutation((tx) =>
          recordDecision(
            tx,
            target.ticketId,
            {
              kind: 'assessment',
              content: 'Bad scope',
              rationale: 'Fixture',
              sources: [],
              scope: { inputSelection: { ...inputSelection, ...changed } },
            },
            owner,
          ),
        );
        await assert.rejects(
          f.mutation((tx) =>
            readInputSnapshot(
              tx,
              owner,
              { target, access: { kind: 'owner' }, expectedInputRevision: null, scopeDecisionId: id },
              async () => {},
            ),
          ),
          { code: 'INPUT_SELECTION_INVALID' },
        );
      }
    } finally {
      await f.close();
    }
  });
});

test('actual publication/comment and persisted 005 claim serialize in both winning orders across two pools', async () => {
  const { openPeerDb } = await import('./support/execution.ts');
  const { fixturePng, publishKnownRepresentation } = await import(
    './support/attachment-access-publication.ts'
  );
  const { digest } = await import('../src/attachments/submissions.ts');
  const { setTimeout: delay } = await import('node:timers/promises');
  const { mutate } = await import('../src/journal/mutation.ts');
  const { appendComment } = await import('../src/tickets/decisions.ts');
  for (const operation of ['publication', 'comment'] as const)
    for (const winner of ['publication', 'claim'] as const)
      await databaseFixture(10)(async (db) => {
        const f = await attachmentAccessFixture(db),
          peer = await openPeerDb(db);
        let release!: () => void;
        const barrier = new Promise<void>((resolve) => {
          release = resolve;
        });
        let entered!: () => void;
        const reached = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const pending: Promise<unknown>[] = [];
        try {
          const original = await f.linkFile('A', fixturePng, 'parent.png'),
            child = await f.child('A');
          const signal = await f.ownerRequest('POST', `/v2/tickets/${child.id}/signals`, {
            signal: 'dependencies_ready',
            expectedRevision: 1,
          });
          assert.equal(signal.statusCode, 200, signal.body);
          const target = { kind: 'ticket' as const, ticketId: child.id, projectId: f.projects.A.id };
          const snapshot = await f.mutation((tx) =>
            readInputSnapshot(
              tx,
              owner,
              { target, access: { kind: 'owner' }, expectedInputRevision: null, scopeDecisionId: null },
              denyPreclaimSelection,
            ),
          );
          assert.equal(snapshot.state, 'ready');
          const inputPin = {
            snapshotId: snapshot.id,
            snapshotSha256: snapshot.sha256,
            inputRevision: snapshot.inputRevision,
            selectionSha256: digest(snapshot.required),
          };
          const [previous] =
            await db`select payload from commands where ticket_id=${f.tickets.A.id} and type='start'`;
          const decisionId = randomUUID(),
            selection = { ...previous.payload.selection, decisionId };
          // Reviewed test-only dispatch selection authority, never a result certificate.
          await f.mutation(async (tx) => {
            await tx`insert into decisions(id,ticket_id,actor_kind,actor_id,kind,content,rationale,sources,scope) values(${decisionId},${child.id},'owner','owner','dispatch','Fixture claim','Fixture claim','[]',${tx.json({ selection, inputSnapshot: inputPin })})`;
            return true;
          });
          const command = await f.ownerRequest('POST', '/v2/commands', {
            machineId: f.machines.A.machineId,
            ticketId: child.id,
            type: 'start',
            payload: { selection, inputSnapshot: inputPin },
          });
          assert.equal(command.statusCode, 202, command.body);
          const commandId = command.json().id;
          await db`insert into attachment_dispatch_inputs(command_id,decision_id,snapshot_id,sha256,input_revision,selection_sha256) values(${commandId},${decisionId},${snapshot.id},${snapshot.sha256},${snapshot.inputRevision},${inputPin.selectionSha256})`;
          const [ticket] = await db`select revision,workflow_pin from tickets where id=${child.id}`;
          const previousAuthority = f.options.authorizeDispatch;
          f.options.authorizeDispatch = async (tx, actor, permit) => {
            await previousAuthority(tx, actor, permit);
            await assertDispatchInputsCurrent(
              tx,
              { commandId, decisionId, pin: inputPin, modelRequired: [] },
              actor,
            );
            if (winner === 'claim') {
              entered();
              await barrier;
            }
          };
          const claim = () =>
            f.machineRequest('A', 'POST', `/v2/machine/commands/${commandId}/claim`, {
              processInstanceId: randomUUID(),
              permit: {
                commandId,
                ticketId: child.id,
                machineId: f.machines.A.machineId,
                bindingRevision: 2,
                ticketRevision: Number(ticket.revision),
                workflow: ticket.workflow_pin,
                checkedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 20000).toISOString(),
                telemetryId: randomUUID(),
                decisionId,
              },
            });
          const published = () =>
            operation === 'comment'
              ? mutate(
                  peer,
                  { actor: owner, route: 'fixture:comment', key: randomUUID(), body: {} },
                  async (tx) => {
                    const body = await appendComment(tx, f.tickets.A.id, 'New inherited comment', owner);
                    if (winner === 'publication') {
                      entered();
                      await barrier;
                    }
                    return { status: 201, body };
                  },
                )
              : publishKnownRepresentation(
                  { ...f, db: peer },
                  original,
                  'image',
                  winner === 'publication'
                    ? async () => {
                        entered();
                        await barrier;
                      }
                    : undefined,
                );
          const first = winner === 'publication' ? published() : claim();
          pending.push(first);
          await reached;
          const second = winner === 'publication' ? claim() : published();
          pending.push(second);
          let blocked = false;
          for (let i = 0; i < 200; i++) {
            const [row] =
              await db`select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%event_cursor%'`;
            if (row) {
              blocked = true;
              break;
            }
            await delay(10);
          }
          assert.equal(blocked, true, 'second pool reached actual journal lock');
          release();
          const [one, two] = await Promise.all([first, second]);
          const response = winner === 'publication' ? two : one;
          assert.equal(
            (response as Awaited<ReturnType<typeof claim>>).statusCode,
            winner === 'publication' ? 409 : 201,
            (response as Awaited<ReturnType<typeof claim>>).body,
          );
          const [revision] =
            await db`select revision from attachment_input_revisions where target_kind='ticket' and target_id=${child.id}`;
          assert.equal(BigInt(revision.revision), BigInt(snapshot.inputRevision) + 1n);
          const [attempts] = await db`select count(*)::int n from attempts where command_id=${commandId}`;
          assert.equal(attempts.n, winner === 'publication' ? 0 : 1);
          await assert.rejects(
            db.begin((tx) =>
              assertDispatchInputsCurrent(
                tx,
                { commandId, decisionId, pin: inputPin, modelRequired: [] },
                f.actors.A,
              ),
            ),
            { code: 'INPUT_SNAPSHOT_STALE' },
          );
        } finally {
          release();
          await Promise.allSettled(pending);
          await peer.end();
          await f.close();
        }
      });
});

test('preclaim compares actual latest extraction generation even before controlled version enqueue invalidates counter', async () => {
  const { fixturePng, publishKnownRepresentation } = await import(
    './support/attachment-access-publication.ts'
  );
  const { digest } = await import('../src/attachments/submissions.ts');
  const { recordDecision } = await import('../src/tickets/decisions.ts');
  const { createCommand } = await import('../src/execution/commands.ts');
  await databaseFixture(10)(async (db) => {
    const f = await attachmentAccessFixture(db);
    try {
      const original = await f.linkFile('A', fixturePng, 'latest.png');
      await publishKnownRepresentation(f, original);
      const target = { kind: 'ticket' as const, ticketId: f.tickets.A.id, projectId: f.projects.A.id };
      const snapshot = await f.mutation((tx) =>
        readInputSnapshot(
          tx,
          owner,
          { target, access: { kind: 'owner' }, expectedInputRevision: null, scopeDecisionId: null },
          denyPreclaimSelection,
        ),
      );
      const inputPin = {
        snapshotId: snapshot.id,
        snapshotSha256: snapshot.sha256,
        inputRevision: snapshot.inputRevision,
        selectionSha256: digest(snapshot.required),
      };
      const decisionId = await f.mutation((tx) =>
        recordDecision(
          tx,
          target.ticketId,
          {
            kind: 'dispatch',
            content: 'Input pin',
            rationale: 'Protocol fixture',
            sources: [],
            scope: { inputSnapshot: inputPin },
          },
          owner,
        ),
      );
      const command = await f.mutation((tx) =>
        createCommand(
          tx,
          {
            machineId: f.machines.A.machineId,
            ticketId: target.ticketId,
            type: 'resume',
            payload: { inputSnapshot: inputPin },
          },
          owner,
        ),
      );
      await db`insert into attachment_dispatch_inputs(command_id,decision_id,snapshot_id,sha256,input_revision,selection_sha256) values(${command.id},${decisionId},${snapshot.id},${snapshot.sha256},${snapshot.inputRevision},${inputPin.selectionSha256})`;
      const check = () =>
        db.begin((tx) =>
          assertDispatchInputsCurrent(
            tx,
            { commandId: command.id, decisionId, pin: inputPin, modelRequired: ['vision'] },
            f.actors.A,
          ),
        );
      await check();
      const id = randomUUID();
      await db`insert into attachment_extractions(id,attachment_id,original_sha256,extractor_version,config_sha256,status) values(${id},${original.attachmentId},${original.sha256},'controlled-next',${f.base.config.policySha256},'pending')`;
      for (const status of ['pending', 'running', 'failed']) {
        await db`update attachment_extractions set status=${status} where id=${id}`;
        await assert.rejects(check(), { code: 'INPUT_SNAPSHOT_STALE' });
      }
      const [revision] =
        await db`select revision from attachment_input_revisions where target_kind='ticket' and target_id=${target.ticketId}`;
      assert.equal(String(revision.revision), snapshot.inputRevision);
    } finally {
      await f.close();
    }
  });
});

test('failed final publication transaction rolls back manifest and revisions and retains published orphan journal', async () => {
  const { fixturePng, publishKnownRepresentation } = await import(
    './support/attachment-access-publication.ts'
  );
  await databaseFixture(10)(async (db) => {
    const f = await attachmentAccessFixture(db);
    try {
      const original = await f.linkFile('A', fixturePng, 'rollback.png');
      const before = await db`select target_id,revision from attachment_input_revisions order by target_id`;
      await assert.rejects(
        publishKnownRepresentation(f, original, 'image', async () => {
          throw new Error('Controlled rollback');
        }),
        { code: 'WORKER_FAILED' },
      );
      assert.deepEqual(
        await db`select target_id,revision from attachment_input_revisions order by target_id`,
        before,
      );
      const [job] =
        await db`select manifest,status from attachment_extractions where attachment_id=${original.attachmentId}`;
      assert.equal(job.manifest, null);
      assert.equal(job.status, 'failed');
      assert.equal(
        (await db`select id from attachment_derivatives where attachment_id=${original.attachmentId}`).length,
        0,
      );
      assert.ok(
        (await db`select id from attachment_gc where attachment_id=${original.attachmentId}`).length > 0,
        'published bytes remain tracked; no false GC closure',
      );
    } finally {
      await f.close();
    }
  });
});

test('initial owner route and fresh snapshot serialize on message before input across two pools', async () => {
  const { admittedInboxFixture } = await import('./support/attachment-access-inbox.ts');
  const { openPeerDb } = await import('./support/execution.ts');
  const { createRoutingServices } = await import('../src/attachments/routing.ts');
  const { inputTicket } = await import('./support/tickets.ts');
  const { mutate } = await import('../src/journal/mutation.ts');
  const { setTimeout: delay } = await import('node:timers/promises');
  for (const winner of ['route', 'snapshot'] as const)
    await databaseFixture(10)(async (db) => {
      const f = await admittedInboxFixture(db),
        peer = await openPeerDb(db),
        pending: Promise<unknown>[] = [];
      let release!: () => void;
      const barrier = new Promise<void>((r) => {
        release = r;
      });
      let entered!: () => void;
      const reached = new Promise<void>((r) => {
        entered = r;
      });
      try {
        const ticket = inputTicket(f.projects.A.id, 'request');
        const decisionId = await f.mutation((tx) =>
          f.messages.persistMessageInputDecision(
            tx,
            {
              messageId: f.message.id,
              inputRevision: f.snapshot.inputRevision,
              snapshotId: null,
              grantId: null,
              receiptId: null,
              kind: 'routing',
              body: { ticket, expectedRouteRevision: 0 },
            },
            owner,
          ),
        );
        const router = createRoutingServices({
          authority: async (_tx, actor) => assert.deepEqual(actor, owner),
        });
        const route = () =>
          mutate(
            peer,
            { actor: owner, route: 'fixture:initial-route', key: randomUUID(), body: {} },
            async (tx) => {
              const body = await router.routeAssistantMessage(
                tx,
                {
                  messageId: f.message.id,
                  expectedInputRevision: f.snapshot.inputRevision,
                  expectedRouteRevision: 0,
                  decisionId,
                  ticket,
                },
                owner,
              );
              if (winner === 'route') {
                entered();
                await barrier;
              }
              return { status: 200, body };
            },
          );
        const target = { kind: 'message' as const, messageId: f.message.id };
        const snapshot = () =>
          db.begin(async (tx) => {
            const result = await readInputSnapshot(
              tx,
              owner,
              { target, access: { kind: 'owner' }, expectedInputRevision: null, scopeDecisionId: null },
              denyPreclaimSelection,
            );
            if (winner === 'snapshot') {
              entered();
              await barrier;
            }
            return result;
          });
        const first = winner === 'route' ? route() : snapshot();
        pending.push(first);
        await reached;
        const second = winner === 'route' ? snapshot() : route();
        pending.push(second);
        let blocked = false;
        for (let i = 0; i < 200; i++) {
          const [row] =
            await db`select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%attachment_messages%' and query like '%for update%'`;
          if (row) {
            blocked = true;
            break;
          }
          await delay(10);
        }
        assert.equal(blocked, true, 'actual service waits for message before touching input');
        release();
        const [one, two] = await Promise.all([first, second]);
        const read = winner === 'snapshot' ? one : two;
        assert.equal(
          (read as import('../src/attachments/contracts.ts').InputSnapshot).inputRevision,
          winner === 'snapshot' ? f.snapshot.inputRevision : String(BigInt(f.snapshot.inputRevision) + 1n),
        );
        await assert.rejects(
          db.begin((tx) =>
            readInputSnapshot(
              tx,
              owner,
              {
                target,
                access: { kind: 'owner' },
                expectedInputRevision: f.snapshot.inputRevision,
                scopeDecisionId: null,
              },
              denyPreclaimSelection,
            ),
          ),
          { code: 'INPUT_SNAPSHOT_STALE' },
        );
      } finally {
        release();
        await Promise.allSettled(pending);
        await peer.end();
        await f.close();
      }
    });
});
