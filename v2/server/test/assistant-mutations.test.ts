import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import type {
  OrchestrationAction,
  OrchestrationProof,
  ProjectOrchestrationAuthority,
} from '../src/assistant/contracts.ts';
import { bootstrapOwner } from '../src/auth/bootstrap.ts';
import { provisionMachine } from '../src/auth/machine.ts';
import { createAuthenticator } from '../src/auth/routes.ts';
import { docsSourceReader } from '../src/docs/read.ts';
import { canonicalJson } from '../src/journal/canonical.ts';
import { createMutator, mutate } from '../src/journal/mutation.ts';
import type { Actor, Db, Tx } from '../src/platform/contracts.ts';
import { ApiError } from '../src/platform/errors.ts';
import { bindProject } from '../src/projects/service.ts';
import type { DecisionInput, DocsSourceReader, TicketServiceDependencies } from '../src/tickets/contracts.ts';
import { registerTicketRoutes } from '../src/tickets/routes.ts';
import { createTicketServices } from '../src/tickets/service.ts';
import { databaseFixture } from './support/db.ts';
import { importWithKey, legacyBundle, validDocs } from './support/docs.ts';
import { inputTicket, owner, ticketFixture } from './support/tickets.ts';

const withDatabase = databaseFixture(11);
const clone = <T>(value: T): T => JSON.parse(canonicalJson(value));
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
type Action = 'decision' | 'dependency' | 'signal';
type DecisionPayload = { ticketId: string; input: DecisionInput };
type DependencyPayload = { ticketId: string; predecessorId: string; expectedRevision: number };
type SignalPayload = {
  ticketId: string;
  signal: 'dependencies_ready' | 'wait_owner';
  expectedRevision: number;
};
type Payload = DecisionPayload | DependencyPayload | SignalPayload;
const targetHash = (action: OrchestrationAction, payload: Payload) =>
  hash(['crew-v2:orchestration-target:1', action, payload]);
const decisionInput = (changes: Partial<DecisionInput> = {}): DecisionInput => ({
  kind: 'assessment',
  content: 'Đánh giá đã ghi',
  rationale: 'Nguồn trong cùng cây',
  sources: [],
  scope: {},
  ...changes,
});
const proofForTest = (): OrchestrationProof => ({
  scopeId: randomUUID(),
  operationId: randomUUID(),
  fence: {
    turnId: randomUUID(),
    designationId: randomUUID(),
    designationRevision: 1,
    generation: '1',
    processInstanceId: randomUUID(),
  },
});
type Allowance = {
  tx: Tx;
  actor: Actor;
  proof: OrchestrationProof;
  action: OrchestrationAction;
  payload: Payload;
  target: string;
  rootId: string;
  projectId: string;
  machineId: string;
};

// TEST-ONLY allowlist over real DB targets; no admission/certificate/native receipt.
function testTrust() {
  const allowed = new WeakMap<Tx, Allowance>();
  const observed: Allowance[] = [];
  let hook: ((tx: Tx, entry: Allowance) => Promise<void>) | undefined;
  const authority: ProjectOrchestrationAuthority = {
    async verify(tx, actor, proof, action, target) {
      const entry = allowed.get(tx);
      const deny = () => {
        throw new ApiError('TEST_TRUST_DENIED', 403, 'Exact allowlist mismatch');
      };
      if (!entry) return deny();
      const identity = () => {
        if (
          entry.tx !== tx ||
          canonicalJson(entry.actor) !== canonicalJson(actor) ||
          canonicalJson(entry.proof) !== canonicalJson(proof) ||
          entry.action !== action ||
          entry.target !== target ||
          targetHash(entry.action, entry.payload) !== target
        )
          deny();
      };
      identity();
      const [machine] = await tx`select id from machines where id=${actor.id} and revoked_at is null`;
      const ids =
        'predecessorId' in entry.payload
          ? [entry.payload.ticketId, entry.payload.predecessorId]
          : [entry.payload.ticketId];
      for (const id of ids) {
        const [row] =
          await tx`select t.root_id,t.project_id,p.machine_id from tickets t join projects p on p.id=t.project_id where t.id=${id}`;
        if (
          actor.kind !== 'machine' ||
          !machine ||
          !row ||
          row.root_id !== entry.rootId ||
          row.project_id !== entry.projectId ||
          row.machine_id !== entry.machineId
        )
          deny();
      }
      observed.push(entry);
      await hook?.(tx, entry);
      identity();
    },
  };
  return {
    allowed,
    observed,
    authority,
    setHook(value: typeof hook) {
      hook = value;
    },
  };
}

async function fixture(db: Db, docsSource?: DocsSourceReader) {
  const f = await ticketFixture(db);
  const machines = await f.mutation('machines', async (tx) => ({
    a: await provisionMachine(tx, 'Assistant A'),
    b: await provisionMachine(tx, 'Bound B'),
  }));
  await f.mutation('bind', (tx) =>
    bindProject(tx, f.project.id, {
      machineId: machines.b.machine.id,
      checkoutPath: '/tmp/b2a-test-only',
      expectedRevision: 1,
    }),
  );
  const actor: Actor = { kind: 'machine', id: machines.a.machine.id };
  const proof = proofForTest();
  const trust = testTrust();
  const services = createTicketServices({ assistant: trust.authority, docsSource });
  const payloadFor = (action: Action): Payload =>
    action === 'decision'
      ? { ticketId: f.a.id, input: decisionInput() }
      : action === 'dependency'
        ? { ticketId: f.a.id, predecessorId: f.b.id, expectedRevision: 1 }
        : { ticketId: f.a.id, signal: 'dependencies_ready', expectedRevision: 1 };
  const run = async (
    action: Action,
    payload = payloadFor(action),
    options: {
      actor?: Actor;
      proof?: OrchestrationProof;
      services?: ReturnType<typeof createTicketServices>;
      change?: (entry: Allowance) => void;
      afterStart?: () => void;
    } = {},
  ) => {
    const actualActor = options.actor ?? actor;
    const actualProof = options.proof ?? proof;
    const key = randomUUID();
    const result = await mutate(
      db,
      { actor: clone(actualActor), route: `test-only:${action}`, key, body: payload },
      async (tx) => {
        const [scope] = await tx`select root_id,project_id from tickets where id=${payload.ticketId}`;
        const entry: Allowance = {
          tx,
          actor: clone(actualActor),
          proof: clone(actualProof),
          action,
          payload: clone(payload),
          target: targetHash(action, payload),
          rootId: scope?.root_id as string,
          projectId: scope?.project_id as string,
          machineId: machines.b.machine.id,
        };
        options.change?.(entry);
        trust.allowed.set(tx, entry);
        const selected = options.services ?? services;
        const pending =
          'input' in payload
            ? selected.assistantRecordDecision(tx, actualActor, actualProof, payload.ticketId, payload.input)
            : 'predecessorId' in payload
              ? selected.assistantAddDependency(
                  tx,
                  actualActor,
                  actualProof,
                  payload.ticketId,
                  payload.predecessorId,
                  payload.expectedRevision,
                )
              : selected.assistantSignalTicket(
                  tx,
                  actualActor,
                  actualProof,
                  payload.ticketId,
                  payload.signal,
                  payload.expectedRevision,
                );
        options.afterStart?.();
        // Frozen dependency port returns void; HTTP/journal envelope is caller-owned.
        const value = await pending;
        return {
          status: 201,
          body: {
            id: typeof value === 'string' ? value : null,
            ticket: value && typeof value === 'object' ? value : null,
          },
        };
      },
    );
    return { id: result.body.id, ticket: result.body.ticket, key };
  };
  const state = async () => ({
    decisions: await db`select * from decisions order by id`,
    dependencies: await db`select * from dependencies order by ticket_id,predecessor_id`,
    revisions:
      await db`select id,revision,status,wait_reason,repair_limit_cycle_id,repair_limit_consumed_decision_id
        from tickets order by id`,
    events: await db`select cursor,type from events order by cursor`,
    commands: await db`select * from commands order by id`,
    attempts: await db`select id,state,terminal_intent,terminal_reason from attempts order by id`,
  });
  return { ...f, actor, proof, machines, trust, services, payloadFor, run, state };
}

for (const action of ['decision', 'dependency'] as const) {
  test(`B2a ${action} scoped A→B verifies exact authority and preserves actual audit/journal`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      const payload = f.payloadFor(action);
      const result = await f.run(action, payload);
      assert.equal(f.trust.observed.length, 1);
      assert.equal(f.trust.observed[0]?.target, targetHash(action, payload));
      const [journal] =
        await db`select actor_kind,actor_id,body_hash from idempotency where key=${result.key}`;
      assert.deepEqual(
        { ...journal },
        { actor_kind: 'machine', actor_id: f.actor.id, body_hash: hash(payload) },
      );
      if (action === 'decision') {
        const [row] = await db`select actor_kind,actor_id from decisions where id=${result.id}`;
        assert.deepEqual({ ...row }, { actor_kind: 'machine', actor_id: f.actor.id });
      } else {
        assert.equal(result.id, null);
        assert.equal((await f.read(f.a.id)).revision, 2);
        assert.equal((await db`select * from dependencies`).length, 1);
      }
    }));

  for (const invalid of [
    'missing',
    'owner',
    'actor',
    'operation',
    'action',
    'hash',
    'root',
    'project',
    'tx',
  ] as const) {
    test(`B2a ${action} rejects ${invalid} authority and atomically preserves state`, async () =>
      withDatabase(async (db) => {
        const f = await fixture(db);
        const before = await f.state();
        await assert.rejects(
          () =>
            f.run(action, undefined, {
              actor: invalid === 'owner' ? owner : undefined,
              services: invalid === 'missing' ? createTicketServices() : undefined,
              change(entry) {
                if (invalid === 'actor') entry.actor = { kind: 'machine', id: f.machines.b.machine.id };
                if (invalid === 'operation') entry.proof.operationId = randomUUID();
                if (invalid === 'action') entry.action = action === 'decision' ? 'dependency' : 'decision';
                if (invalid === 'hash') entry.target = '0'.repeat(64);
                if (invalid === 'root') entry.rootId = randomUUID();
                if (invalid === 'project') entry.projectId = randomUUID();
                if (invalid === 'tx') entry.tx = db as unknown as Tx;
              },
            }),
          {
            code:
              invalid === 'missing'
                ? 'ORCHESTRATION_UNAVAILABLE'
                : invalid === 'owner'
                  ? 'ORCHESTRATION_MACHINE_REQUIRED'
                  : 'TEST_TRUST_DENIED',
          },
        );
        assert.deepEqual(await f.state(), before);
      }));
  }

  test(`B2a ${action} prefix locks root, canonical sorted tickets and project before verify`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      f.trust.setHook(async () => {
        const ids = action === 'dependency' ? [f.request.id, f.a.id, f.b.id] : [f.request.id, f.a.id];
        for (const id of ids)
          await assert.rejects(
            () =>
              db.begin(async (peer) => {
                await peer`select id from tickets where id=${id} for update nowait`;
              }),
            { code: '55P03' },
          );
        await assert.rejects(
          () =>
            db.begin(async (peer) => {
              await peer`select id from projects where id=${f.project.id} for update nowait`;
            }),
          { code: '55P03' },
        );
      });
      await f.run(action);
      assert.equal(f.trust.observed.length, 1);
    }));

  test(`B2a ${action} snapshots input actor proof before first await and during deferred verify`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      const payload = f.payloadFor(action);
      const original = clone(payload);
      const actor = clone(f.actor);
      const proof = clone(f.proof);
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const resume = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.trust.setHook(async () => {
        enter();
        await resume;
      });
      const pending = f.run(action, payload, {
        actor,
        proof,
        afterStart() {
          actor.id = f.machines.b.machine.id;
          proof.operationId = randomUUID();
          if ('input' in payload) payload.input.content = 'Caller changed before first await';
          else payload.expectedRevision = 99;
        },
      });
      try {
        assert.equal(
          await Promise.race([
            entered.then(() => 'entered'),
            pending.then(
              () => 'settled',
              () => 'settled',
            ),
          ]),
          'entered',
        );
        proof.fence.generation = '99';
        if ('input' in payload) payload.input.sources.push({ kind: 'ticket', id: randomUUID() });
        release();
        const result = await pending;
        assert.equal(f.trust.observed[0]?.target, targetHash(action, original));
        if ('input' in original) {
          const [row] = await db`select content,actor_id from decisions where id=${result.id}`;
          assert.equal(row?.content, original.input.content);
          assert.equal(row?.actor_id, f.actor.id);
        } else assert.equal((await f.read(f.a.id)).revision, 2);
      } finally {
        release();
        await pending.catch(() => undefined);
      }
    }));

  test(`B2a ${action} captures factory authority and denies cross-Tx token reuse`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      f.trust.authority.verify = async () => {
        throw new Error('REPLACED_METHOD');
      };
      await f.run(action);
      assert.equal(f.trust.observed.length, 1);
      const payload = f.payloadFor(action);
      if ('expectedRevision' in payload) {
        const fresh = await f.mutation('fresh-target', (tx) =>
          f.services.createTicket(tx, inputTicket(f.project.id, 'step', f.request.id), owner),
        );
        payload.ticketId = fresh.id;
      }
      await assert.rejects(
        () =>
          f.mutation('unlisted-tx', async (tx) => {
            if ('input' in payload)
              await f.services.assistantRecordDecision(tx, f.actor, f.proof, payload.ticketId, payload.input);
            else if ('predecessorId' in payload)
              await f.services.assistantAddDependency(
                tx,
                f.actor,
                f.proof,
                payload.ticketId,
                payload.predecessorId,
                payload.expectedRevision,
              );
          }),
        { code: 'TEST_TRUST_DENIED' },
      );
      const deps: TicketServiceDependencies = {};
      const absent = createTicketServices(deps);
      deps.assistant = f.trust.authority;
      await assert.rejects(() => f.run(action, payload, { services: absent }), {
        code: 'ORCHESTRATION_UNAVAILABLE',
      });
    }));

  test(`B2a ${action} uppercase identities retain exact submitted hash and reject lowercase replay`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      const payload = f.payloadFor(action);
      payload.ticketId = payload.ticketId.toUpperCase();
      if ('predecessorId' in payload) payload.predecessorId = payload.predecessorId.toUpperCase();
      await assert.rejects(
        () =>
          f.run(action, payload, {
            change(entry) {
              entry.payload.ticketId = entry.payload.ticketId.toLowerCase();
              entry.target = targetHash(action, entry.payload);
            },
          }),
        { code: 'TEST_TRUST_DENIED' },
      );
      await f.run(action, payload);
      assert.equal(f.trust.observed[0]?.target, targetHash(action, payload));
    }));
}

test('B2a real machine-authenticated generic decision/dependency routes keep A→B ACL', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
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
    const before = await f.state();
    try {
      for (const path of ['decisions', 'dependencies']) {
        const response = await app.inject({
          method: 'POST',
          url: `/v2/tickets/${f.a.id}/${path}`,
          headers: { authorization: `Bearer ${f.machines.a.token}`, 'idempotency-key': randomUUID() },
          payload: path === 'decisions' ? decisionInput() : { predecessorId: f.b.id, expectedRevision: 1 },
        });
        assert.equal(response.statusCode, 404);
        assert.equal(response.json().error.code, 'NOT_FOUND');
      }
      assert.deepEqual(await f.state(), before);
    } finally {
      await app.close();
    }
  }));

for (const condition of [
  'revision',
  'self',
  'cross-root',
  'duplicate',
  'cycle',
  'closed',
  'ready',
  'running',
  'missing',
] as const) {
  test(`B2a dependency preserves ${condition} invariant`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      const payload = f.payloadFor('dependency') as DependencyPayload;
      let code = 'REVISION_CONFLICT';
      if (condition === 'revision') payload.expectedRevision = 2;
      if (condition === 'self') {
        payload.predecessorId = f.a.id.toUpperCase();
        code = 'DEPENDENCY_CYCLE';
      }
      if (condition === 'cross-root') {
        const other = await f.mutation('other-root', (tx) =>
          f.services.createTicket(tx, inputTicket(f.project.id, 'request'), owner),
        );
        payload.predecessorId = other.id;
        code = 'DEPENDENCY_SCOPE';
      }
      if (condition === 'duplicate' || condition === 'cycle') {
        await f.mutation('seed-edge', (tx) => f.services.addDependency(tx, f.a.id, f.b.id, 1));
        if (condition === 'duplicate') {
          payload.expectedRevision = 2;
          code = 'DEPENDENCY_EXISTS';
        } else {
          payload.ticketId = f.b.id;
          payload.predecessorId = f.a.id;
          code = 'DEPENDENCY_CYCLE';
        }
      }
      if (condition === 'closed') {
        await db`update tickets set status='done' where id=${f.request.id}`;
        code = 'TICKET_CLOSED';
      }
      if (condition === 'ready' || condition === 'running') {
        await db`update tickets set status=${condition} where id=${f.a.id}`;
        code = 'DEPENDENCY_EDIT_NOT_ALLOWED';
      }
      if (condition === 'missing') {
        payload.predecessorId = randomUUID();
        code = 'NOT_FOUND';
      }
      const before = await f.state();
      await assert.rejects(() => f.run('dependency', payload), { code });
      assert.deepEqual(await f.state(), before);
    }));
}

test('B2a concurrent opposite dependency requests cannot commit a cycle', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const results = await Promise.allSettled([
      f.run('dependency', { ticketId: f.a.id, predecessorId: f.b.id, expectedRevision: 1 }),
      f.run('dependency', { ticketId: f.b.id, predecessorId: f.a.id, expectedRevision: 1 }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const failed = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(failed.reason.code, 'DEPENDENCY_CYCLE');
    assert.equal((await db`select * from dependencies`).length, 1);
    assert.equal(f.trust.observed.length, 1);
  }));

for (const condition of [
  'owner-answer',
  'owner-approval',
  'empty-content',
  'long-content',
  'empty-rationale',
  'long-rationale',
  'too-many-sources',
  'unsafe-scope',
  'cross-root-source',
  'bad-locator',
  'missing-docs-reader',
] as const) {
  test(`B2a decision preserves ${condition} invariant`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      const input = decisionInput();
      let code = 'VALIDATION';
      if (condition === 'owner-answer') {
        input.kind = 'owner_answer';
        code = 'OWNER_DECISION_REQUIRED';
      }
      if (condition === 'owner-approval') {
        input.kind = 'approval';
        code = 'OWNER_APPROVAL_REQUIRED';
      }
      if (condition === 'empty-content') input.content = '';
      if (condition === 'long-content') input.content = 'x'.repeat(32769);
      if (condition === 'empty-rationale') input.rationale = '';
      if (condition === 'long-rationale') input.rationale = 'x'.repeat(32769);
      if (condition === 'too-many-sources')
        input.sources = Array.from({ length: 101 }, () => ({ kind: 'ticket', id: f.a.id }));
      if (condition === 'unsafe-scope') input.scope = { constructor: 'forbidden' };
      if (condition === 'cross-root-source') {
        const other = await f.mutation('source-other-root', (tx) =>
          f.services.createTicket(tx, inputTicket(f.project.id, 'request'), owner),
        );
        input.sources = [{ kind: 'ticket', id: other.id }];
        code = 'SOURCE_UNVERIFIED';
      }
      if (condition === 'bad-locator') {
        input.sources = [{ kind: 'artifact', id: randomUUID(), locator: 'wrong/path' }];
        code = 'SOURCE_UNVERIFIED';
      }
      if (condition === 'missing-docs-reader') {
        input.sources = [{ kind: 'docs', id: randomUUID(), path: 'docs/index.md' }];
        code = 'SOURCE_UNVERIFIED';
      }
      const before = await f.state();
      await assert.rejects(() => f.run('decision', { ticketId: f.a.id, input }), { code });
      assert.deepEqual(await f.state(), before);
      assert.equal(f.trust.observed.length, 0);
    }));
}

test('B2a decision supports actual same-root ticket owner decision and reported artifact sources', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const prior = await f.mutation('owner-source', (tx) =>
      f.services.recordDecision(tx, f.a.id, decisionInput(), owner),
    );
    const artifact = randomUUID();
    // Existing source-existence semantics only: no verified artifact/native receipt.
    await db`insert into evidence(id,ticket_id,kind,data) values(${artifact},${f.a.id},'artifact',${db.json({ locator: 'reports/result.md', verification: 'reported' })})`;
    await f.run('decision', {
      ticketId: f.a.id,
      input: decisionInput({
        sources: [
          { kind: 'ticket', id: f.b.id.toUpperCase() },
          { kind: 'owner_decision', id: prior },
          { kind: 'artifact', id: artifact, locator: 'reports/result.md' },
        ],
      }),
    });
    assert.equal(f.trust.observed.length, 1);
    await db`update tickets set status='done' where id=${f.request.id}`;
    await f.run('decision'); // Decision timeline on a closed tree retains existing semantics.
    assert.equal(f.trust.observed.length, 2);
  }));

test('B2a docs source validation completes before verify and is not repeated after verification', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const imported = await importWithKey(db, legacyBundle(validDocs()), 'docs-source');
    const source = imported.projects[0];
    assert.ok(source);
    assert.equal(source.auditState, 'unverified');
    await f.mutation('bind-doc-project', (tx) =>
      bindProject(tx, source.projectId, {
        machineId: f.machines.b.machine.id,
        checkoutPath: '/tmp/b2a-docs-source',
        expectedRevision: 1,
      }),
    );
    const root = await f.mutation('docs-root', (tx) =>
      f.services.createTicket(tx, inputTicket(source.projectId, 'request'), owner),
    );
    const trace: string[] = [];
    const reader: DocsSourceReader = async (tx, projectId, snapshotId, path) => {
      trace.push('docs');
      assert.equal(f.trust.observed.length, 0);
      return docsSourceReader(tx, projectId, snapshotId, path);
    };
    const deps: TicketServiceDependencies = { assistant: f.trust.authority, docsSource: reader };
    const services = createTicketServices(deps);
    deps.docsSource = async () => {
      throw new Error('REPLACED_DOCS_READER');
    };
    f.trust.setHook(async () => {
      trace.push('verify');
    });
    await f.run(
      'decision',
      {
        ticketId: root.id,
        input: decisionInput({ sources: [{ kind: 'docs', id: source.snapshotId, path: 'docs/index.md' }] }),
      },
      { services },
    );
    assert.deepEqual(trace, ['docs', 'verify']);
    // Existing reader checks stored project/snapshot/path; this is not content attestation.
  }));

for (const hostile of ['getter', 'iterator', 'prototype'] as const) {
  test(`B2a decision rejects array ${hostile} before user code or authority`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      let executions = 0;
      const values = ['text'];
      if (hostile === 'getter')
        Object.defineProperty(values, '0', {
          enumerable: true,
          get() {
            executions++;
            return 'safe';
          },
        });
      if (hostile === 'iterator')
        Object.defineProperty(values, Symbol.iterator, {
          value: function* () {
            executions++;
            yield 'safe';
          },
        });
      if (hostile === 'prototype') Object.setPrototypeOf(values, Object.create(Array.prototype));
      const before = await f.state();
      let failure: unknown;
      try {
        // Bound machine exercises service input validation independently of generic A→B denial.
        await f.mutation('unsafe-boundary', (tx) =>
          f.services.assistantRecordDecision(
            tx,
            { kind: 'machine', id: f.machines.b.machine.id },
            f.proof,
            f.a.id,
            decisionInput({ scope: { values } }),
          ),
        );
      } catch (error) {
        failure = error;
      }
      assert.equal(failure instanceof ApiError ? failure.code : null, 'VALIDATION');
      assert.equal(executions, 0);
      assert.equal(f.trust.observed.length, 0);
      assert.deepEqual(await f.state(), before);
    }));
}

const signalPayload = (
  ticketId: string,
  signal: SignalPayload['signal'],
  expectedRevision = 1,
): SignalPayload => ({ ticketId, signal, expectedRevision });

test('B2b-i real machine-authenticated generic signal route keeps A→B ACL', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
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
    const before = await f.state();
    try {
      for (const signal of ['dependencies_ready', 'wait_owner'] as const) {
        const response = await app.inject({
          method: 'POST',
          url: `/v2/tickets/${f.a.id}/signals`,
          headers: { authorization: `Bearer ${f.machines.a.token}`, 'idempotency-key': randomUUID() },
          payload: { signal, expectedRevision: 1 },
        });
        assert.equal(response.statusCode, 404);
        assert.equal(response.json().error.code, 'NOT_FOUND');
      }
      assert.deepEqual(await f.state(), before);
      assert.equal(f.trust.observed.length, 0);
    } finally {
      await app.close();
    }
  }));

test('B2b-i signal without orchestration authority is unavailable and preserves revision', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const before = await f.state();
    for (const signal of ['dependencies_ready', 'wait_owner'] as const)
      await assert.rejects(
        () => f.run('signal', signalPayload(f.a.id, signal), { services: createTicketServices() }),
        { code: 'ORCHESTRATION_UNAVAILABLE' },
      );
    assert.deepEqual(await f.state(), before);
    assert.equal((await f.read(f.a.id)).revision, 1);
  }));

for (const invalid of ['owner', 'actor', 'operation', 'action', 'hash', 'root', 'project', 'tx'] as const) {
  test(`B2b-i signal rejects ${invalid} authority and atomically preserves state`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      const before = await f.state();
      await assert.rejects(
        () =>
          f.run('signal', signalPayload(f.a.id, 'wait_owner'), {
            actor: invalid === 'owner' ? owner : undefined,
            change(entry) {
              if (invalid === 'actor') entry.actor = { kind: 'machine', id: f.machines.b.machine.id };
              if (invalid === 'operation') entry.proof.operationId = randomUUID();
              if (invalid === 'action') entry.action = 'dependency';
              if (invalid === 'hash') entry.target = '0'.repeat(64);
              if (invalid === 'root') entry.rootId = randomUUID();
              if (invalid === 'project') entry.projectId = randomUUID();
              if (invalid === 'tx') entry.tx = db as unknown as Tx;
            },
          }),
        { code: invalid === 'owner' ? 'ORCHESTRATION_MACHINE_REQUIRED' : 'TEST_TRUST_DENIED' },
      );
      assert.deepEqual(await f.state(), before);
    }));
}

test('B2b-i dependencies_ready requires done predecessors, then readies with exact audit and event', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    await f.mutation('seed-edge', (tx) => f.services.addDependency(tx, f.a.id, f.b.id, 1));
    const before = await f.state();
    await assert.rejects(() => f.run('signal', signalPayload(f.a.id, 'dependencies_ready', 2)), {
      code: 'DEPENDENCIES_NOT_READY',
    });
    assert.deepEqual(await f.state(), before);
    assert.equal(f.trust.observed.length, 0);
    await db`update tickets set status='done' where id=${f.b.id}`;
    const payload = signalPayload(f.a.id, 'dependencies_ready', 2);
    const original = clone(payload);
    const actor = clone(f.actor);
    const proof = clone(f.proof);
    const cursor = (await db`select coalesce(max(cursor),0) as cursor from events`)[0]?.cursor;
    const result = await f.run('signal', payload, {
      actor,
      proof,
      afterStart() {
        // Caller mutations after the call starts cannot alter the captured operation.
        actor.id = f.machines.b.machine.id;
        proof.operationId = randomUUID();
        payload.signal = 'wait_owner';
        payload.expectedRevision = 99;
      },
    });
    assert.equal(f.trust.observed.length, 1);
    assert.equal(f.trust.observed[0]?.target, targetHash('signal', original));
    assert.equal(result.ticket?.status, 'ready');
    assert.equal(result.ticket?.revision, 3);
    const ticket = await f.read(f.a.id);
    assert.deepEqual([ticket.status, ticket.revision, ticket.waitReason], ['ready', 3, null]);
    const events = await db`select type,ticket_id,data from events where cursor>${cursor} order by cursor`;
    assert.deepEqual(
      events.map((row) => ({ ...row })),
      [{ type: 'ticket.changed', ticket_id: f.a.id, data: { revision: 3, status: 'ready' } }],
    );
    const [journal] = await db`select actor_kind,actor_id,body_hash from idempotency where key=${result.key}`;
    assert.deepEqual(
      { ...journal },
      { actor_kind: 'machine', actor_id: f.actor.id, body_hash: hash(original) },
    );
  }));

for (const status of ['pending', 'ready'] as const) {
  test(`B2b-i wait_owner on ${status} moves to needs_input for owner input`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      if (status === 'ready') await db`update tickets set status='ready' where id=${f.a.id}`;
      const cursor = (await db`select coalesce(max(cursor),0) as cursor from events`)[0]?.cursor;
      const result = await f.run('signal', signalPayload(f.a.id, 'wait_owner'));
      assert.equal(f.trust.observed.length, 1);
      const ticket = await f.read(f.a.id);
      assert.deepEqual(
        [ticket.status, ticket.waitReason, ticket.revision],
        ['needs_input', 'owner_input', 2],
      );
      assert.equal(result.ticket?.status, 'needs_input');
      const events = await db`select type,data from events where cursor>${cursor} order by cursor`;
      assert.deepEqual(
        events.map((row) => ({ ...row })),
        [{ type: 'ticket.changed', data: { revision: 2, status: 'needs_input' } }],
      );
    }));
}

test('B2b-i wait_owner on running ticket fails closed without synthetic owner command', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const calls: string[] = [];
    const services = createTicketServices({
      assistant: f.trust.authority,
      execution: {
        async verifySignal() {
          calls.push('verifySignal');
        },
        async requestTerminalIntent() {
          calls.push('requestTerminalIntent');
        },
        async verifyRepairResult() {
          calls.push('verifyRepairResult');
        },
      },
    });
    const commandId = randomUUID();
    await db`insert into commands(id,machine_id,ticket_id,binding_revision,type,payload,state)
      values(${commandId},${f.machines.b.machine.id},${f.a.id},1,'start','{}','received')`;
    await db`insert into attempts(id,ticket_id,machine_id,command_id,fence,binding_revision,process_instance_id,state,lease_expires_at,workflow_pin)
      values(${randomUUID()},${f.a.id},${f.machines.b.machine.id},${commandId},1,1,${randomUUID()},'active',now()+interval '60 seconds','{}')`;
    await db`update tickets set status='running' where id=${f.a.id}`;
    const before = await f.state();
    await assert.rejects(() => f.run('signal', signalPayload(f.a.id, 'wait_owner'), { services }), {
      code: 'EXECUTION_PROOF_REQUIRED',
    });
    assert.deepEqual(await f.state(), before);
    assert.equal(before.commands.length, 1);
    assert.deepEqual(
      before.attempts.map((row) => [row.terminal_intent, row.terminal_reason]),
      [['complete', null]],
    );
    assert.equal((await f.read(f.a.id)).revision, 1);
    assert.deepEqual(calls, []);
    assert.equal(f.trust.observed.length, 0);
  }));

test('B2b-i signal stale revision conflicts and preserves state', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const before = await f.state();
    for (const signal of ['dependencies_ready', 'wait_owner'] as const)
      await assert.rejects(() => f.run('signal', signalPayload(f.a.id, signal, 2)), {
        code: 'REVISION_CONFLICT',
      });
    assert.deepEqual(await f.state(), before);
    assert.equal(f.trust.observed.length, 0);
  }));

for (const signal of ['resume', 'start', 'passed'] as const) {
  test(`B2b-i scoped signal rejects ${signal} as invalid input`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      await db`update tickets set status=${signal === 'resume' ? 'needs_input' : signal === 'start' ? 'ready' : 'running'}
        where id=${f.a.id}`;
      const before = await f.state();
      await assert.rejects(
        () => f.run('signal', signalPayload(f.a.id, signal as unknown as SignalPayload['signal'])),
        { code: 'VALIDATION' },
      );
      assert.deepEqual(await f.state(), before);
      assert.equal(f.trust.observed.length, 0);
    }));
}

test('B2b-i scoped wait_owner on repair-limit ticket never consumes owner continuation', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const evidence = randomUUID();
    const cycle = randomUUID();
    await db`insert into evidence(id,ticket_id,kind,data) values(${evidence},${f.a.id},'artifact',${db.json({ observation: 'Không đạt' })})`;
    await db`insert into repair_results(check_step_id,cycle_id,classification,passed,evidence_id)
      values(${f.a.id},${cycle},'repair_review',false,${evidence})`;
    await db`update tickets set repair_cycles=5,wait_reason='repair_limit',repair_limit_cycle_id=${cycle},
      repair_limit_at=now()-interval '1 minute' where id=${f.a.id}`;
    await f.mutation('owner-continuation', (tx) =>
      f.services.recordDecision(
        tx,
        f.a.id,
        decisionInput({
          kind: 'owner_answer',
          content: 'Tiếp tục sau vòng 5',
          scope: { repairStepId: f.a.id, cycleId: cycle, continueAfterFive: true },
        }),
        owner,
      ),
    );
    const before = await f.state();
    await assert.rejects(
      () => f.run('signal', signalPayload(f.a.id, 'resume' as unknown as SignalPayload['signal'], 1)),
      { code: 'VALIDATION' },
    );
    assert.deepEqual(await f.state(), before);
    await f.run('signal', signalPayload(f.a.id, 'wait_owner', 1));
    const [row] =
      await db`select status,wait_reason,revision,repair_limit_cycle_id,repair_limit_consumed_decision_id
      from tickets where id=${f.a.id}`;
    assert.deepEqual(
      { ...row },
      {
        status: 'needs_input',
        wait_reason: 'repair_limit',
        revision: 2,
        repair_limit_cycle_id: cycle,
        repair_limit_consumed_decision_id: null,
      },
    );
    assert.equal(f.trust.observed.length, 1);
  }));

test('B2b-i scoped signal and dependency edge serialize on the root before verify', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.trust.setHook(async (_tx, entry) => {
      if (entry.action !== 'signal') return;
      for (const id of [f.request.id, f.a.id])
        await assert.rejects(
          () =>
            db.begin(async (peer) => {
              await peer`select id from tickets where id=${id} for update nowait`;
            }),
          { code: '55P03' },
        );
      await assert.rejects(
        () =>
          db.begin(async (peer) => {
            await peer`select id from projects where id=${f.project.id} for update nowait`;
          }),
        { code: '55P03' },
      );
      enter();
      await resume;
    });
    const signal = f.run('signal', signalPayload(f.a.id, 'dependencies_ready'));
    let dependency: Promise<unknown> | undefined;
    try {
      assert.equal(
        await Promise.race([
          entered.then(() => 'entered'),
          signal.then(
            () => 'settled',
            () => 'settled',
          ),
        ]),
        'entered',
      );
      dependency = f.run('dependency', { ticketId: f.a.id, predecessorId: f.b.id, expectedRevision: 1 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(f.trust.observed.length, 1);
    } finally {
      release();
    }
    const [signalled, added] = await Promise.allSettled([signal, dependency]);
    assert.equal(signalled.status, 'fulfilled');
    assert.equal(added.status, 'rejected');
    assert.equal((added as PromiseRejectedResult).reason.code, 'REVISION_CONFLICT');
    assert.equal((await db`select * from dependencies`).length, 0);
    const ticket = await f.read(f.a.id);
    assert.deepEqual([ticket.status, ticket.revision], ['ready', 2]);
  }));
