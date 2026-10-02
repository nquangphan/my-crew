import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { RouteMessageInput } from '../src/attachments/contracts.ts';
import { claimAttempt } from '../src/execution/attempts.ts';
import { createCommand } from '../src/execution/commands.ts';
import { mutate } from '../src/journal/mutation.ts';
import type { Db, DispatchPermit } from '../src/platform/contracts.ts';
import { attachmentFixture, sha } from './support/attachments.ts';
import { databaseFixture } from './support/db.ts';
import { pin } from './support/execution.ts';
import { inputTicket, owner } from './support/tickets.ts';

async function routed(
  work: (
    db: Db,
    f: Awaited<ReturnType<typeof attachmentFixture>>,
    s: ReturnType<typeof import('../src/attachments/messages.ts').createMessageServices>,
    r: ReturnType<typeof import('../src/attachments/routing.ts').createRoutingServices>,
    first: import('../src/attachments/contracts.ts').MessageRoute,
    next: RouteMessageInput,
  ) => Promise<void>,
) {
  await databaseFixture(10)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      const { createMessageServices } = await import('../src/attachments/messages.ts');
      const { createRoutingServices } = await import('../src/attachments/routing.ts');
      const s = createMessageServices({
        store: f.store,
        now: f.clock.now,
        queuePolicy: {
          extractorVersion: 'fixture-pending-only',
          configSha256: sha(Buffer.from('fixture protocol')),
        },
      });
      const c = await f.mutation(randomUUID(), (tx) => s.createConversation(tx, owner));
      const selection = await f.readyCompose(
        { purpose: 'assistant_message', projectId: null, ticketId: null, conversationId: c.id },
        [Buffer.from('original')],
      );
      const m = await f.mutation(randomUUID(), (tx) =>
        s.submitAssistantMessage(
          tx,
          { conversationId: c.id, clientMessageId: randomUUID(), text: '', selection, assistantRead: 'none' },
          owner,
        ),
      );
      const ticket = inputTicket(f.project.id, 'request', null, { workflowPin: pin });
      const decision = await f.mutation(randomUUID(), (tx) =>
        s.persistMessageInputDecision(
          tx,
          {
            messageId: m.id,
            inputRevision: '1',
            snapshotId: null,
            grantId: null,
            receiptId: null,
            kind: 'routing',
            body: { ticket, expectedRouteRevision: 0 },
          },
          owner,
        ),
      );
      const r = createRoutingServices({
        now: f.clock.now,
        authority: async (_tx, actor) => assert.deepEqual(actor, owner),
        retire: async (tx, route, actor) => {
          const [row] = await tx`select revision from tickets where id=${route.ticketId}`;
          await f.services.signalTicket(tx, route.ticketId, 'wait_owner', Number(row.revision), null, actor);
        },
      });
      const first = await f.mutation(randomUUID(), (tx) =>
        r.routeAssistantMessage(
          tx,
          {
            messageId: m.id,
            expectedInputRevision: '1',
            expectedRouteRevision: 0,
            decisionId: decision,
            ticket,
          },
          owner,
        ),
      );
      const nextTicket = { ...ticket, title: 'Correction' };
      const nextDecision = await f.mutation(randomUUID(), (tx) =>
        s.persistMessageInputDecision(
          tx,
          {
            messageId: m.id,
            inputRevision: '2',
            snapshotId: null,
            grantId: null,
            receiptId: null,
            kind: 'routing',
            body: { ticket: nextTicket, expectedRouteRevision: 1 },
          },
          owner,
        ),
      );
      await work(db, f, s, r, first, {
        messageId: m.id,
        expectedInputRevision: '2',
        expectedRouteRevision: 1,
        decisionId: nextDecision,
        ticket: nextTicket,
      });
    } finally {
      await f.close();
    }
  });
}

test('attachment reroute actual ticket retirement retains original identity audit and invalidates old inputs once', async () =>
  routed(async (db, f, _s, r, old, next) => {
    const originals =
      await db`select id,expected_sha256,storage_key,linked_at,quota_released_at from attachment_uploads order by id`;
    const result = await f.mutation(randomUUID(), (tx) => r.routeAssistantMessage(tx, next, owner));
    assert.equal(result.supersedesRouteId, old.id);
    assert.equal(result.revision, 2);
    const [retired] = await db`select status from tickets where id=${old.ticketId}`;
    assert.equal(retired.status, 'needs_input');
    const [oldRoute] = await db`select revoked_at from attachment_message_routes where id=${old.id}`;
    assert.ok(oldRoute.revoked_at);
    assert.equal(
      (await db`select * from attachment_links where message_route_id=${old.id} and revoked_at is null`)
        .length,
      0,
    );
    assert.equal(
      (await db`select * from attachment_links where message_route_id=${result.id} and revoked_at is null`)
        .length,
      1,
    );
    const [message] =
      await db`select input_revision,route_revision from attachment_messages where id=${next.messageId}`;
    assert.equal(Number(message.input_revision), 3);
    assert.equal(Number(message.route_revision), 2);
    const [revision] =
      await db`select revision from attachment_input_revisions where target_id=${old.ticketId}`;
    assert.equal(Number(revision.revision), 2);
    assert.deepEqual(
      await db`select id,expected_sha256,storage_key,linked_at,quota_released_at from attachment_uploads order by id`,
      originals,
    );
    assert.deepEqual(
      await f.mutation(randomUUID(), (tx) => r.routeAssistantMessage(tx, next, owner)),
      result,
    );
    assert.equal((await db`select * from attachment_extractions`).length, 1);
  }));
test('attachment reroute concurrent decisions CAS exactly one new route and one retirement', async () =>
  routed(async (db, f, s, r, old, next) => {
    const ticket = { ...next.ticket, title: 'Different correction' };
    const decisionId = await f.mutation(randomUUID(), (tx) =>
      s.persistMessageInputDecision(
        tx,
        {
          messageId: next.messageId,
          inputRevision: '2',
          snapshotId: null,
          grantId: null,
          receiptId: null,
          kind: 'routing',
          body: { ticket, expectedRouteRevision: 1 },
        },
        owner,
      ),
    );
    const results = await Promise.allSettled(
      [next, { ...next, ticket, decisionId }].map((input) =>
        f.mutation(randomUUID(), (tx) => r.routeAssistantMessage(tx, input, owner)),
      ),
    );
    assert.equal(results.filter((v) => v.status === 'fulfilled').length, 1);
    const failed = results.find((v) => v.status === 'rejected');
    assert.ok(failed && failed.status === 'rejected');
    assert.equal(failed.reason.code, 'INPUT_SNAPSHOT_STALE');
    assert.equal((await db`select * from attachment_message_routes`).length, 2);
    assert.equal(
      (await db`select * from events where type='ticket.changed' and ticket_id=${old.ticketId}`).length,
      1,
    );
  }));
test('attachment reroute retirement failure rolls back actual workflow event route revision and original links', async () =>
  routed(async (db, f, _s, _r, old, next) => {
    const { createRoutingServices } = await import('../src/attachments/routing.ts');
    const r = createRoutingServices({
      authority: async () => {},
      retire: async (tx, route, actor) => {
        await f.services.signalTicket(tx, route.ticketId, 'wait_owner', 1, null, actor);
        throw new Error('RETIREMENT_AFTER_SERVICE_FAILURE');
      },
    });
    const before = await db`select cursor,type,data from events order by cursor`;
    await assert.rejects(
      f.mutation(randomUUID(), (tx) => r.routeAssistantMessage(tx, next, owner)),
      /RETIREMENT_AFTER_SERVICE_FAILURE/,
    );
    assert.deepEqual(await db`select cursor,type,data from events order by cursor`, before);
    const [ticket] = await db`select status,revision from tickets where id=${old.ticketId}`;
    assert.equal(ticket.status, 'pending');
    assert.equal(Number(ticket.revision), 1);
    assert.equal((await db`select * from attachment_message_routes where revoked_at is null`).length, 1);
    assert.equal(
      (await db`select * from attachment_links where message_route_id=${old.id} and revoked_at is null`)
        .length,
      1,
    );
  }));
test('attachment reroute actual claimed active attempt blocks despite expired lease and never fabricates stopped proof', async () =>
  routed(async (db, f, _s, r, old, next) => {
    const machineId = randomUUID();
    await db`insert into machines(id,name,token_hash) values(${machineId},'fixture-claim-only',${sha(Buffer.from(machineId))})`;
    await db`update projects set machine_id=${machineId},binding_revision=2,checkout_path='/tmp/fixture-only-no-launch' where id=${f.project.id}`;
    const ready = await f.mutation(randomUUID(), (tx) =>
      f.services.signalTicket(tx, old.ticketId, 'dependencies_ready', 1, null, owner),
    );
    const command = await f.mutation(randomUUID(), (tx) =>
      createCommand(tx, { machineId, ticketId: old.ticketId, type: 'start', payload: {} }, owner),
    );
    const actor = { kind: 'machine' as const, id: machineId };
    const permit: DispatchPermit = {
      commandId: command.id,
      ticketId: old.ticketId,
      machineId,
      bindingRevision: 2,
      ticketRevision: ready.revision,
      workflow: pin,
      checkedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 20000).toISOString(),
      telemetryId: randomUUID(),
      decisionId: randomUUID(),
    };
    // Actual claim API + private fixture authorization; no process/provider launch.
    const attempt = await f.mutation(randomUUID(), (tx) =>
      claimAttempt(tx, command.id, { processInstanceId: randomUUID(), permit }, actor, async () => {}),
    );
    await db`update attempts set lease_expires_at=now()-interval '1 hour' where id=${attempt.id}`;
    await assert.rejects(
      f.mutation(randomUUID(), (tx) => r.routeAssistantMessage(tx, next, owner)),
      { code: 'ROUTE_IN_USE' },
    );
    const [observed] = await db`select state,stopped_at from attempts where id=${attempt.id}`;
    assert.equal(observed.state, 'active');
    assert.equal(observed.stopped_at, null);
    assert.equal((await db`select * from attachment_message_routes`).length, 1);
  }));
test('attachment routing digest target and current authority checked before per-route and mutator cache replay', async () =>
  routed(async (db, f, _s, r, _old, next) => {
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        r.routeAssistantMessage(
          tx,
          { ...next, ticket: { ...next.ticket, projectId: 'invalid-uuid' } },
          owner,
        ),
      ),
      { code: 'VALIDATION' },
    );
    await assert.rejects(
      f.mutation(randomUUID(), (tx) =>
        r.routeAssistantMessage(
          tx,
          { ...next, ticket: { ...next.ticket, title: 'Unauthorized payload' } },
          owner,
        ),
      ),
      { code: 'ROUTING_DECISION_INVALID' },
    );
    const key = randomUUID();
    const context = {
      actor: owner,
      route: 'fixture:route',
      key,
      body: next,
      authorize: (tx: Parameters<typeof r.authorize>[0]) => r.authorize(tx, next, owner),
    };
    const value = await mutate(db, context, async (tx) => ({
      status: 200,
      body: await r.routeAssistantMessage(tx, next, owner),
    }));
    assert.deepEqual(
      await mutate(db, context, async () => {
        throw new Error('CACHED_WORK_EXECUTED');
      }),
      value,
    );
    await db`update attachment_message_decisions set sha256=${'0'.repeat(64)} where id=${next.decisionId}`;
    await assert.rejects(
      mutate(db, context, async () => value),
      { code: 'ROUTING_DECISION_INVALID' },
    );
  }));

test('attachment routing configured owner decisions replay and correction default denies without retirement', async () =>
  databaseFixture(10)(async (db) => {
    const f = await attachmentFixture(db);
    try {
      const { createMessageServices } = await import('../src/attachments/messages.ts');
      const { createRoutingServices } = await import('../src/attachments/routing.ts');
      const s = createMessageServices({
        store: f.store,
        now: f.clock.now,
        queuePolicy: {
          extractorVersion: 'fixture-pending-only',
          configSha256: sha(Buffer.from('fixture protocol')),
        },
      });
      const c = await f.mutation(randomUUID(), (tx) => s.createConversation(tx, owner));
      const selection = await f.readyCompose(
        { purpose: 'assistant_message', projectId: null, ticketId: null, conversationId: c.id },
        [Buffer.from('input')],
      );
      const message = await f.mutation(randomUUID(), (tx) =>
        s.submitAssistantMessage(
          tx,
          { conversationId: c.id, clientMessageId: randomUUID(), text: '', selection, assistantRead: 'none' },
          owner,
        ),
      );
      const ticket = inputTicket(f.project.id, 'request');
      const decisionId = await f.mutation(randomUUID(), (tx) =>
        s.persistMessageInputDecision(
          tx,
          {
            messageId: message.id,
            inputRevision: '1',
            snapshotId: null,
            grantId: null,
            receiptId: null,
            kind: 'routing',
            body: { ticket, expectedRouteRevision: 0 },
          },
          owner,
        ),
      );
      const request = {
        messageId: message.id,
        expectedInputRevision: '1',
        expectedRouteRevision: 0,
        decisionId,
        ticket,
      };
      const denied = createRoutingServices();
      await assert.rejects(
        f.mutation(randomUUID(), (tx) => denied.routeAssistantMessage(tx, request, owner)),
        { code: 'INPUT_ROUTING_NOT_CONFIGURED' },
      );
      const routes = createRoutingServices({
        authority: async (_tx, actor) => assert.deepEqual(actor, owner),
      });
      const response = await f.mutation(randomUUID(), (tx) =>
        routes.routeAssistantMessage(tx, request, owner),
      );
      assert.deepEqual(
        await f.mutation(randomUUID(), (tx) => routes.routeAssistantMessage(tx, request, owner)),
        response,
      );
      assert.equal((await db`select * from attachment_message_routes`).length, 1);
      assert.equal(
        (await db`select * from attachment_links where message_route_id=${response.id}`).length,
        1,
      );
      const [current] =
        await db`select input_revision,route_revision from attachment_messages where id=${message.id}`;
      assert.equal(Number(current.input_revision), 2);
      assert.equal(Number(current.route_revision), 1);
      const nextTicket = { ...ticket, title: 'Correction' };
      const nextDecision = await f.mutation(randomUUID(), (tx) =>
        s.persistMessageInputDecision(
          tx,
          {
            messageId: message.id,
            inputRevision: '2',
            snapshotId: null,
            grantId: null,
            receiptId: null,
            kind: 'routing',
            body: { ticket: nextTicket, expectedRouteRevision: 1 },
          },
          owner,
        ),
      );
      await assert.rejects(
        f.mutation(randomUUID(), (tx) =>
          routes.routeAssistantMessage(
            tx,
            {
              messageId: message.id,
              expectedInputRevision: '2',
              expectedRouteRevision: 1,
              decisionId: nextDecision,
              ticket: nextTicket,
            },
            owner,
          ),
        ),
        { code: 'ROUTE_CORRECTION_NOT_CONFIGURED' },
      );
      assert.equal((await db`select * from attachment_message_routes where revoked_at is null`).length, 1);
      assert.equal((await db`select * from attachment_assistant_grants`).length, 0);
    } finally {
      await f.close();
    }
  }));
