import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { createPersistedAssistantActorResolver } from '../src/assistant/authority.ts';
import type { OrchestrationAction, OrchestrationProof, TurnFence } from '../src/assistant/contracts.ts';
import {
  createPersistedOrchestrationAuthority,
  createProjectOrchestrationPort,
} from '../src/assistant/orchestration.ts';
import { digest } from '../src/attachments/submissions.ts';
import { bootstrapOwner } from '../src/auth/bootstrap.ts';
import { provisionMachine } from '../src/auth/machine.ts';
import { createAuthenticator } from '../src/auth/routes.ts';
import type { CreateCommand } from '../src/execution/contracts.ts';
import { canonicalJson } from '../src/journal/canonical.ts';
import { createMutator, mutate } from '../src/journal/mutation.ts';
import type { Actor, Db, Id, Tx } from '../src/platform/contracts.ts';
import { ApiError } from '../src/platform/errors.ts';
import type { CreateTicket, DecisionInput } from '../src/tickets/contracts.ts';
import { registerTicketRoutes } from '../src/tickets/routes.ts';
import { createTicketServices } from '../src/tickets/service.ts';
import { assistantFixture, fixtureVerifierBuildSha256 } from './support/assistant.ts';
import { databaseFixture } from './support/db.ts';
import { inputTicket, owner } from './support/tickets.ts';

const withDatabase = databaseFixture(11);
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const createHashFor = (input: CreateTicket) =>
  hash(['crew-v2:orchestration-target:1', 'create_ticket', input]);
const otherVerifier = createHash('sha256').update('crew-v2:test-only-other-verifier').digest('hex');
const allActions: OrchestrationAction[] = ['create_ticket', 'decision', 'dependency', 'signal', 'command'];
const decisionInput = (changes: Partial<DecisionInput> = {}): DecisionInput => ({
  kind: 'assessment',
  content: 'Đánh giá qua port thật',
  rationale: 'Nguồn trong cùng cây',
  sources: [],
  scope: {},
  ...changes,
});
type Admission = Omit<
  Parameters<Awaited<ReturnType<typeof assistantFixture>>['seedAdmittedTurn']>[0],
  'conversationId' | 'messageId' | 'target' | 'machineId'
>;

// Real persisted rows only: admitted turn, PASS receipt of the pinned fixture verifier,
// scope and pending tool operation. No test-trust authority or allowlist exists here.
async function portFixture(
  db: Db,
  options: {
    scope?: 'root' | 'message';
    actions?: OrchestrationAction[];
    admission?: Admission | 'none';
    verifierBuildSha256?: string;
  } = {},
) {
  const f = await assistantFixture(db);
  const machines = await f.mutation(randomUUID(), async (tx) => ({
    a: await provisionMachine(tx, 'Assistant A'),
    b: await provisionMachine(tx, 'Bound B'),
  }));
  const a: Actor = { kind: 'machine', id: machines.a.machine.id };
  const b: Actor = { kind: 'machine', id: machines.b.machine.id };
  await db`update projects set machine_id=${b.id},checkout_path='/tmp/s2-test-only',binding_revision=2 where id=${f.project.id}`;
  const submitted = await f.submitMessage();
  const kind = options.scope ?? 'root';
  const messageId = kind === 'message' ? submitted.message.id : null;
  let fence: TurnFence;
  let snapshotId: Id;
  let policyReceiptId: Id | null = null;
  if (options.admission === 'none') {
    fence = await f.seedTurn(submitted.conversation.id, messageId);
    snapshotId = randomUUID();
    await db`insert into attachment_input_snapshots(id,target_kind,target_id,input_revision,route_revision,canonical,sha256)
      values(${snapshotId},${kind === 'root' ? 'ticket' : 'message'},${kind === 'root' ? f.request.id : submitted.message.id},1,0,'{}',${'c'.repeat(64)})`;
  } else {
    const seeded = await f.seedAdmittedTurn({
      conversationId: submitted.conversation.id,
      messageId,
      target:
        kind === 'root'
          ? { kind: 'ticket', id: f.request.id }
          : { kind: 'message', id: submitted.message.id },
      machineId: a.id,
      ...options.admission,
    });
    fence = seeded.fence;
    snapshotId = seeded.snapshotId as Id;
    policyReceiptId = seeded.policyReceiptId;
  }
  const scopeId = randomUUID();
  await db`insert into assistant_scopes(id,turn_id,root_ticket_id,message_id,project_id,actions,tool_names,input_snapshot_id,
    scope_sha256,owner_authorization_id,expires_at)
    values(${scopeId},${fence.turnId},${kind === 'root' ? f.request.id : null},${messageId},${kind === 'root' ? f.project.id : null},
    ${db.json(options.actions ?? allActions)},'[]',${snapshotId},${'a'.repeat(64)},${randomUUID()},clock_timestamp()+interval '60 seconds')`;
  const resolver = createPersistedAssistantActorResolver({
    verifierBuildSha256: options.verifierBuildSha256 ?? fixtureVerifierBuildSha256,
  });
  const port = createProjectOrchestrationPort({ resolver });
  const run = async <T>(
    call: (tx: Tx, proof: OrchestrationProof, actor: Actor) => Promise<T>,
    opts: {
      actor?: Actor;
      operationId?: Id;
      before?: (tx: Tx, proof: OrchestrationProof) => Promise<void>;
    } = {},
  ) => {
    const actor = opts.actor ?? a;
    const key = randomUUID();
    const result = await mutate(
      db,
      { actor, route: 'test-only:assistant-port', key, body: {} },
      async (tx) => {
        const operationId =
          opts.operationId ?? (await f.seedToolOperation(tx, { turnId: fence.turnId, snapshotId }));
        const proof: OrchestrationProof = { fence, scopeId, operationId };
        await opts.before?.(tx, proof);
        const value = await call(tx, proof, actor);
        // Journal responses must be JSON objects; the frozen dependency port returns void.
        return { status: 201, body: { value: (value ?? null) as unknown } };
      },
    );
    return { value: result.body.value, key };
  };
  // Stand-in for the B4 router: the routing decision row it writes in the same Tx.
  const routingDecision = async (sql: Db | Tx, proof: OrchestrationProof, ticketSha256: string) => {
    const [message] =
      await sql`select input_revision from attachment_messages where id=${submitted.message.id}`;
    const input = {
      messageId: submitted.message.id,
      inputRevision: String(message?.input_revision),
      snapshotId,
      grantId: null,
      receiptId: null,
      kind: 'routing',
      body: { operationId: proof.operationId, scopeId: proof.scopeId, ticketSha256 },
    };
    await sql`insert into attachment_message_decisions(id,message_id,input_revision,snapshot_id,grant_id,receipt_id,actor_kind,actor_id,kind,body,sha256)
      values(${randomUUID()},${input.messageId},${input.inputRevision},${snapshotId},null,null,'machine',${a.id},'routing',
      ${sql.json(input.body)},${digest({ ...input, actor: a })})`;
  };
  const state = async () => ({
    tickets:
      await db`select id,revision,status,wait_reason,created_actor_kind,created_actor_id from tickets order by id`,
    decisions: await db`select * from decisions order by id`,
    dependencies: await db`select * from dependencies order by ticket_id,predecessor_id`,
    events: await db`select cursor,type from events order by cursor`,
    commands: await db`select * from commands order by id`,
    idempotency:
      await db`select route,key from idempotency where route='test-only:assistant-port' order by key`,
  });
  return {
    ...f,
    machines,
    assistantA: a,
    boundB: b,
    fence,
    snapshotId,
    scopeId,
    policyReceiptId,
    message: submitted.message,
    resolver,
    port,
    run,
    routingDecision,
    state,
  };
}

test('S2 admitted PASS turn creates A→B child through the real port with actor A audit', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db);
    try {
      const input = inputTicket(f.project.id, 'step', f.request.id);
      const { value, key } = await f.run((tx, proof, actor) => f.port.createTicket(tx, actor, proof, input));
      const created = value as { id: Id; rootId: Id; projectId: Id };
      assert.equal(created.rootId, f.request.id);
      const [row] = await db`select t.created_actor_kind,t.created_actor_id,p.machine_id from tickets t
        join projects p on p.id=t.project_id where t.id=${created.id}`;
      assert.deepEqual(
        { ...row },
        { created_actor_kind: 'machine', created_actor_id: f.assistantA.id, machine_id: f.boundB.id },
      );
      const [journal] = await db`select actor_kind,actor_id from idempotency where key=${key}`;
      assert.deepEqual({ ...journal }, { actor_kind: 'machine', actor_id: f.assistantA.id });
    } finally {
      await f.close();
    }
  }));

test('S2 decision, dependency and signal go through the real port with actor A audit', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db);
    try {
      const decision = await f.run((tx, proof, actor) =>
        f.port.decision(tx, actor, proof, f.a.id, decisionInput()),
      );
      const [row] =
        await db`select actor_kind,actor_id,ticket_id from decisions where id=${decision.value as Id}`;
      assert.deepEqual({ ...row }, { actor_kind: 'machine', actor_id: f.assistantA.id, ticket_id: f.a.id });
      await f.run((tx, proof, actor) => f.port.dependency(tx, actor, proof, f.a.id, f.b.id, 1));
      assert.equal((await db`select * from dependencies where ticket_id=${f.a.id}`).length, 1);
      const signalled = await f.run((tx, proof, actor) =>
        f.port.signal(tx, actor, proof, f.b.id, 'dependencies_ready', 1),
      );
      assert.equal((signalled.value as { status: string }).status, 'ready');
      const journals = await db`select actor_id from idempotency where route='test-only:assistant-port'`;
      assert.deepEqual(
        journals.map((journal) => journal.actor_id),
        [f.assistantA.id, f.assistantA.id, f.assistantA.id],
      );
    } finally {
      await f.close();
    }
  }));

test('S2 port snapshots caller arguments synchronously before any authority wait', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db);
    try {
      const input = decisionInput();
      const { value } = await f.run(async (tx, proof, actor) => {
        const mutableActor = { ...actor };
        const mutableProof = { ...proof, fence: { ...proof.fence } };
        const pending = f.port.decision(tx, mutableActor, mutableProof, f.a.id, input);
        input.content = 'Caller changed after call';
        mutableActor.id = f.boundB.id;
        mutableProof.operationId = randomUUID();
        return pending;
      });
      const [row] = await db`select content,actor_id from decisions where id=${value as Id}`;
      assert.deepEqual({ ...row }, { content: 'Đánh giá qua port thật', actor_id: f.assistantA.id });
    } finally {
      await f.close();
    }
  }));

test('S2 turn without admission stays 503 and preserves state', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db, { admission: 'none' });
    try {
      const before = await f.state();
      await assert.rejects(
        () =>
          f.run((tx, proof, actor) =>
            f.port.createTicket(tx, actor, proof, inputTicket(f.project.id, 'step', f.request.id)),
          ),
        { code: 'ASSISTANT_ADMISSION_NOT_CONFIGURED', status: 503 },
      );
      assert.deepEqual(await f.state(), before);
    } finally {
      await f.close();
    }
  }));

const admissionDenials: Record<
  string,
  {
    admission?: Admission;
    verifierBuildSha256?: string;
    tamper?: (db: Db, f: Awaited<ReturnType<typeof portFixture>>) => Promise<void>;
  }
> = {
  'receipt UNVERIFIED': { admission: { receiptStatus: 'UNVERIFIED' } },
  'receipt FAIL': { admission: { receiptStatus: 'FAIL' } },
  'receipt expired': { admission: { receiptExpiresInSeconds: -60 } },
  'receipt revoked': {
    tamper: async (db, f) => {
      await db`update assistant_policy_receipts set revoked_at=now() where id=${f.policyReceiptId}`;
    },
  },
  'receipt from another deployment': {
    // Simulates an imported row: bypass identity triggers/FKs only to place a foreign deployment ID.
    tamper: async (db, f) => {
      await db.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update assistant_policy_receipts set deployment_id=${randomUUID()} where id=${f.policyReceiptId}`;
      });
    },
  },
  'receipt signed by another verifier': { admission: { verifierBuildSha256: otherVerifier } },
  'assembly pinned to another verifier': { verifierBuildSha256: otherVerifier },
  'session expired': {
    tamper: async (db) => {
      await db`update attachment_assistant_sessions set expires_at=clock_timestamp()-interval '1 second'`;
    },
  },
  'session other process instance': {
    tamper: async (db) => {
      await db`update attachment_assistant_sessions set process_instance_id=${randomUUID()}`;
    },
  },
  'session other designation revision': {
    tamper: async (db) => {
      await db`update attachment_assistant_sessions set designation_revision=2`;
    },
  },
  'session no longer live': {
    tamper: async (db) => {
      await db`update attachment_assistant_sessions set state='unknown'`;
    },
  },
};

for (const [name, variant] of Object.entries(admissionDenials)) {
  test(`S2 admission denies ${name} with 403 and preserves state`, async () =>
    withDatabase(async (db) => {
      const f = await portFixture(db, {
        admission: variant.admission,
        verifierBuildSha256: variant.verifierBuildSha256,
      });
      try {
        await variant.tamper?.(db, f);
        const before = await f.state();
        await assert.rejects(
          () =>
            f.run((tx, proof, actor) =>
              f.port.createTicket(tx, actor, proof, inputTicket(f.project.id, 'step', f.request.id)),
            ),
          { code: 'ASSISTANT_ADMISSION_DENIED', status: 403 },
        );
        assert.deepEqual(await f.state(), before);
      } finally {
        await f.close();
      }
    }));
}

test('S2 operation must be a pending row of this turn on the scope input', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db);
    try {
      const before = await f.state();
      const decide = (operationId: Id) =>
        f.run((tx, proof, actor) => f.port.decision(tx, actor, proof, f.a.id, decisionInput()), {
          operationId,
        });
      await assert.rejects(() => decide(randomUUID()), {
        code: 'ASSISTANT_OPERATION_NOT_FOUND',
        status: 404,
      });
      const completed = await f.seedToolOperation(db, {
        turnId: f.fence.turnId,
        snapshotId: f.snapshotId,
        state: 'completed',
      });
      await assert.rejects(() => decide(completed), { code: 'ASSISTANT_OPERATION_NOT_FOUND', status: 404 });
      const otherSnapshot = randomUUID();
      await db`insert into attachment_input_snapshots(id,target_kind,target_id,input_revision,route_revision,canonical,sha256)
        values(${otherSnapshot},'ticket',${f.request.id},1,0,'{}',${'e'.repeat(64)})`;
      const stale = await f.seedToolOperation(db, { turnId: f.fence.turnId, snapshotId: otherSnapshot });
      await assert.rejects(() => decide(stale), { code: 'ASSISTANT_OPERATION_STALE', status: 409 });
      assert.deepEqual(await f.state(), before);
      // A pending operation committed earlier on the scope input still authorizes.
      const pending = await f.seedToolOperation(db, { turnId: f.fence.turnId, snapshotId: f.snapshotId });
      await decide(pending);
    } finally {
      await f.close();
    }
  }));

test('S2 action outside the persisted scope actions is denied', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db, { actions: ['decision'] });
    try {
      const before = await f.state();
      await assert.rejects(
        () =>
          f.run((tx, proof, actor) =>
            f.port.createTicket(tx, actor, proof, inputTicket(f.project.id, 'step', f.request.id)),
          ),
        { code: 'ORCHESTRATION_ACTION_NOT_IN_SCOPE', status: 403 },
      );
      await assert.rejects(
        () => f.run((tx, proof, actor) => f.port.signal(tx, actor, proof, f.a.id, 'wait_owner', 1)),
        { code: 'ORCHESTRATION_ACTION_NOT_IN_SCOPE', status: 403 },
      );
      assert.deepEqual(await f.state(), before);
    } finally {
      await f.close();
    }
  }));

test('S2 new root requires the same-Tx routing decision for the exact CreateTicket hash', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db, { scope: 'message' });
    try {
      const input = inputTicket(f.project.id, 'request');
      const create = (before?: (tx: Tx, proof: OrchestrationProof) => Promise<void>, operationId?: Id) =>
        f.run((tx, proof, actor) => f.port.createTicket(tx, actor, proof, input), { before, operationId });
      const before = await f.state();
      await assert.rejects(() => create(), { code: 'ORCHESTRATION_ROUTING_DECISION_REQUIRED', status: 403 });
      await assert.rejects(
        () => create((tx, proof) => f.routingDecision(tx, proof, createHashFor({ ...input, title: 'Khác' }))),
        { code: 'ORCHESTRATION_ROUTING_DECISION_REQUIRED', status: 403 },
      );
      const committed = await f.seedToolOperation(db, { turnId: f.fence.turnId, snapshotId: f.snapshotId });
      await f.routingDecision(
        db,
        { fence: f.fence, scopeId: f.scopeId, operationId: committed },
        createHashFor(input),
      );
      await assert.rejects(() => create(undefined, committed), {
        code: 'ORCHESTRATION_ROUTING_DECISION_REQUIRED',
        status: 403,
      });
      const after = await f.state();
      assert.deepEqual(after, before);
      const { value } = await create((tx, proof) => f.routingDecision(tx, proof, createHashFor(input)));
      const created = value as { id: Id; rootId: Id; level: string };
      assert.deepEqual([created.rootId, created.level], [created.id, 'request']);
      const [row] = await db`select created_actor_kind,created_actor_id from tickets where id=${created.id}`;
      assert.deepEqual({ ...row }, { created_actor_kind: 'machine', created_actor_id: f.assistantA.id });
    } finally {
      await f.close();
    }
  }));

test('S2 root scope cannot create a new root without a message routing decision', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db);
    try {
      const before = await f.state();
      await assert.rejects(
        () =>
          f.run((tx, proof, actor) =>
            f.port.createTicket(tx, actor, proof, inputTicket(f.project.id, 'request')),
          ),
        { code: 'ORCHESTRATION_ROUTING_DECISION_REQUIRED', status: 403 },
      );
      assert.deepEqual(await f.state(), before);
    } finally {
      await f.close();
    }
  }));

test('S2 message scope without a root cannot write existing tickets', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db, { scope: 'message' });
    try {
      const before = await f.state();
      await assert.rejects(
        () => f.run((tx, proof, actor) => f.port.decision(tx, actor, proof, f.a.id, decisionInput())),
        { code: 'NOT_FOUND', status: 404 },
      );
      assert.deepEqual(await f.state(), before);
    } finally {
      await f.close();
    }
  }));

test('S2 tickets outside the scope root are not found', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db);
    try {
      const otherRoot = await f.mutation(randomUUID(), (tx) =>
        f.services.createTicket(tx, inputTicket(f.project.id, 'request'), owner),
      );
      const otherChild = await f.mutation(randomUUID(), (tx) =>
        f.services.createTicket(tx, inputTicket(f.project.id, 'step', otherRoot.id), owner),
      );
      const before = await f.state();
      await assert.rejects(
        () => f.run((tx, proof, actor) => f.port.decision(tx, actor, proof, otherChild.id, decisionInput())),
        { code: 'NOT_FOUND', status: 404 },
      );
      await assert.rejects(
        () =>
          f.run((tx, proof, actor) =>
            f.port.createTicket(tx, actor, proof, inputTicket(f.project.id, 'step', otherRoot.id)),
          ),
        { code: 'NOT_FOUND', status: 404 },
      );
      await assert.rejects(
        () => f.run((tx, proof, actor) => f.port.signal(tx, actor, proof, otherChild.id, 'wait_owner', 1)),
        { code: 'NOT_FOUND', status: 404 },
      );
      assert.deepEqual(await f.state(), before);
    } finally {
      await f.close();
    }
  }));

test('S2 caller actor other than the designation machine is denied despite a valid proof', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db);
    try {
      const before = await f.state();
      for (const actor of [f.boundB, { kind: 'machine', id: f.assistantA.id.toUpperCase() } as Actor])
        await assert.rejects(
          () =>
            f.run((tx, proof, caller) => f.port.decision(tx, caller, proof, f.a.id, decisionInput()), {
              actor,
            }),
          { code: 'ORCHESTRATION_ACTOR_MISMATCH', status: 403 },
        );
      assert.deepEqual(await f.state(), before);
    } finally {
      await f.close();
    }
  }));

test('S2 generic ticket routes stay 404 for machine A while its admitted turn is live', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db);
    await bootstrapOwner(db, 'test-only-owner-password');
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    const options = {
      db,
      publicOrigin: 'http://localhost',
      secureCookies: false,
      sessionEncryptionKey: Buffer.alloc(32),
      now: () => new Date(),
      authorizeDispatch: async () => {
        throw new Error('NO_DISPATCH');
      },
      verifyFinalResult: async () => {
        throw new Error('NO_FINALIZATION');
      },
    };
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof ApiError) return reply.status(error.status).send({ error: { code: error.code } });
      return reply.status(500).send({ error: { code: 'UNEXPECTED' } });
    });
    registerTicketRoutes(app, options, {
      auth: createAuthenticator(db, options),
      mutator: createMutator(db),
    });
    try {
      const before = await f.state();
      const requests = [
        { url: '/v2/tickets', payload: inputTicket(f.project.id, 'step', f.request.id) },
        { url: `/v2/tickets/${f.a.id}/decisions`, payload: decisionInput() },
        {
          url: `/v2/tickets/${f.a.id}/dependencies`,
          payload: { predecessorId: f.b.id, expectedRevision: 1 },
        },
        { url: `/v2/tickets/${f.a.id}/signals`, payload: { signal: 'wait_owner', expectedRevision: 1 } },
      ];
      for (const request of requests) {
        const response = await app.inject({
          method: 'POST',
          url: request.url,
          headers: { authorization: `Bearer ${f.machines.a.token}`, 'idempotency-key': randomUUID() },
          payload: request.payload,
        });
        assert.equal(response.statusCode, 404, `${request.url} ${response.body}`);
        assert.equal(response.json().error.code, 'NOT_FOUND');
      }
      assert.deepEqual(await f.state(), before);
    } finally {
      await app.close();
      await f.close();
    }
  }));

test('S2 command stays unreleased with 503 and writes nothing', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db);
    try {
      const before = await f.state();
      const command: CreateCommand = { machineId: f.boundB.id, ticketId: f.a.id, type: 'start', payload: {} };
      await assert.rejects(() => f.run((tx, proof, actor) => f.port.command(tx, actor, proof, command)), {
        code: 'ORCHESTRATION_COMMAND_NOT_RELEASED',
        status: 503,
      });
      assert.deepEqual(await f.state(), before);
    } finally {
      await f.close();
    }
  }));

test('S2 bare persisted authority without the port target fails closed', async () =>
  withDatabase(async (db) => {
    const f = await portFixture(db);
    try {
      const authority = createPersistedOrchestrationAuthority(f.resolver);
      const services = createTicketServices({ assistant: authority });
      const before = await f.state();
      await assert.rejects(
        () =>
          f.run((tx, proof, actor) =>
            authority.verify(
              tx,
              actor,
              proof,
              'decision',
              hash(['crew-v2:orchestration-target:1', 'decision', {}]),
            ),
          ),
        { code: 'ORCHESTRATION_SCOPE_INVALID', status: 403 },
      );
      await assert.rejects(
        () =>
          f.run((tx, proof, actor) =>
            services.assistantRecordDecision(tx, actor, proof, f.a.id, decisionInput()),
          ),
        { code: 'ORCHESTRATION_SCOPE_INVALID', status: 403 },
      );
      assert.deepEqual(await f.state(), before);
    } finally {
      await f.close();
    }
  }));
