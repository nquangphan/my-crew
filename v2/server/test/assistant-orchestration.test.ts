import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Pin } from '../../src/workflow-policy.ts';
import type {
  OrchestrationAction,
  OrchestrationProof,
  ProjectOrchestrationAuthority,
} from '../src/assistant/contracts.ts';
import { provisionMachine } from '../src/auth/machine.ts';
import { canonicalJson } from '../src/journal/canonical.ts';
import { mutate } from '../src/journal/mutation.ts';
import type { Actor, Db, Tx } from '../src/platform/contracts.ts';
import { ApiError } from '../src/platform/errors.ts';
import { bindProject, createProject } from '../src/projects/service.ts';
import type { CreateTicket, TicketServiceDependencies } from '../src/tickets/contracts.ts';
import { deployTicketFingerprint, readDeployAuthorization } from '../src/tickets/deploy.ts';
import { createTicketServices } from '../src/tickets/service.ts';
import { databaseFixture } from './support/db.ts';
import { inputTicket, owner, ticketFixture } from './support/tickets.ts';

const withDatabase = databaseFixture(11);
const pin: Pin = { workflow: 'superpowers', version: '1', revision: 'test', checksum: 'a'.repeat(64) };
const clone = <T>(value: T): T => JSON.parse(canonicalJson(value));
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const targetHash = (input: CreateTicket) => hash(['crew-v2:orchestration-target:1', 'create_ticket', input]);
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
  target: string;
  input: CreateTicket;
  projectId: string;
  rootId: string | null;
  bindingMachineId: string;
};

// Explicit TEST-ONLY trust port. These IDs are not admission, native-delivery, or
// scope-certification receipts. Production persisted actor resolution stays denied.
function testOnlyAuthority() {
  const allowed = new WeakMap<Tx, Allowance>();
  const observed: Allowance[] = [];
  let hook: ((tx: Tx) => Promise<void>) | undefined;
  const authority: ProjectOrchestrationAuthority = {
    async verify(tx, actor, proof, action, target) {
      const entry = allowed.get(tx);
      const deny = () => {
        throw new ApiError('TEST_TRUST_DENIED', 403, 'Test allowlist mismatch');
      };
      if (!entry) return deny();
      const checkIdentity = () => {
        if (
          entry.tx !== tx ||
          canonicalJson(entry.actor) !== canonicalJson(actor) ||
          canonicalJson(entry.proof) !== canonicalJson(proof) ||
          entry.action !== action ||
          entry.target !== target ||
          targetHash(entry.input) !== target
        )
          deny();
      };
      checkIdentity();
      const [project] = await tx`select id,machine_id from projects where id=${entry.input.projectId}`;
      const [machine] = await tx`select id from machines where id=${actor.id} and revoked_at is null`;
      if (
        actor.kind !== 'machine' ||
        !machine ||
        !project ||
        project.id !== entry.projectId ||
        project.machine_id !== entry.bindingMachineId
      )
        deny();
      if (entry.input.parentId) {
        const [parent] = await tx`select root_id,project_id from tickets where id=${entry.input.parentId}`;
        if (!parent || parent.root_id !== entry.rootId || parent.project_id !== entry.projectId) deny();
      } else if (entry.rootId !== null) deny();
      observed.push(entry);
      await hook?.(tx);
      checkIdentity();
    },
  };
  return {
    authority,
    allowed,
    observed,
    setHook(value: typeof hook) {
      hook = value;
    },
  };
}

async function fixture(db: Db) {
  const f = await ticketFixture(db);
  const machines = await f.mutation('machines', async (tx) => ({
    a: (await provisionMachine(tx, 'Assistant A')).machine,
    b: (await provisionMachine(tx, 'Target B')).machine,
  }));
  await f.mutation('binding', (tx) =>
    bindProject(tx, f.project.id, {
      machineId: machines.b.id,
      checkoutPath: '/tmp/b1-test-only-target',
      expectedRevision: 1,
    }),
  );
  const actor: Actor = { kind: 'machine', id: machines.a.id };
  const proof = proofForTest();
  const trust = testOnlyAuthority();
  const services = createTicketServices({ assistant: trust.authority });
  const candidate = (changes: Partial<CreateTicket> = {}) =>
    inputTicket(f.project.id, 'step', f.request.id, changes);
  const run = async (
    input: CreateTicket,
    options: {
      actor?: Actor;
      proof?: OrchestrationProof;
      services?: ReturnType<typeof createTicketServices>;
      change?: (entry: Allowance) => void;
      body?: unknown;
      afterStart?: () => void;
    } = {},
  ) => {
    const submittedActor = options.actor ?? actor;
    const submittedProof = options.proof ?? proof;
    const key = randomUUID();
    const result = await mutate(
      db,
      {
        actor: clone(submittedActor),
        route: 'test-only:assistant-create',
        key,
        body: options.body ?? input,
      },
      async (tx) => {
        const [parent] = input.parentId
          ? await tx`select root_id from tickets where id=${input.parentId}`
          : [];
        const entry: Allowance = {
          tx,
          actor: clone(submittedActor),
          proof: clone(submittedProof),
          action: 'create_ticket',
          target: targetHash(input),
          input: clone(input),
          projectId: input.projectId.toLowerCase(),
          rootId: (parent?.root_id as string | undefined) ?? null,
          bindingMachineId: machines.b.id,
        };
        options.change?.(entry);
        trust.allowed.set(tx, entry);
        const pending = (options.services ?? services).assistantCreateTicket(
          tx,
          submittedActor,
          submittedProof,
          input,
        );
        options.afterStart?.();
        return { status: 201, body: await pending };
      },
    );
    return { ticket: result.body, key };
  };
  return { ...f, actor, proof, trust, services, candidate, run, machines };
}

test('B1 trust fixture creates A→B child with actual A audit and unchanged raw journal hash', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const input = f.candidate({ inputs: { target: 'B' } });
    const { ticket, key } = await f.run(input);
    assert.equal(ticket.rootId, f.request.id);
    assert.equal(ticket.parentId, f.request.id);
    assert.equal(ticket.status, 'pending');
    assert.equal(ticket.revision, 1);
    assert.deepEqual(ticket.inputs, input.inputs);
    const [row] = await db`select created_actor_kind,created_actor_id from tickets where id=${ticket.id}`;
    assert.deepEqual({ ...row }, { created_actor_kind: 'machine', created_actor_id: f.actor.id });
    const [journal] = await db`select actor_kind,actor_id,body_hash from idempotency where key=${key}`;
    assert.deepEqual({ ...journal }, { actor_kind: 'machine', actor_id: f.actor.id, body_hash: hash(input) });
    assert.equal(f.trust.observed.length, 1);
    assert.equal(f.trust.observed[0]?.target, targetHash(input));
  }));

test('B1 generic A→B create remains 404 despite JSON-shaped forged capability', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const input = { ...f.candidate(), capability: { authorized: true, actor: owner, tx: 'forged' } };
    await assert.rejects(() => f.mutation('generic', (tx) => f.services.createTicket(tx, input, f.actor)), {
      code: 'NOT_FOUND',
      status: 404,
    });
    assert.equal(f.trust.observed.length, 0);
  }));

test('B1 missing captured authority denies 503 even for machine bound to target project', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    await assert.rejects(
      () =>
        f.run(f.candidate(), {
          services: createTicketServices(),
          actor: { kind: 'machine', id: f.machines.b.id },
        }),
      { code: 'ORCHESTRATION_UNAVAILABLE', status: 503 },
    );
  }));

test('B1 owner cannot enter machine-only scoped creator', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    await assert.rejects(() => f.run(f.candidate(), { actor: owner }), {
      code: 'ORCHESTRATION_MACHINE_REQUIRED',
      status: 403,
    });
    assert.equal(f.trust.observed.length, 0);
  }));

for (const mismatch of ['actor', 'operation', 'fence', 'hash', 'action', 'root', 'project', 'tx'] as const) {
  test(`B1 test-only allowlist rejects exact ${mismatch} mismatch`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      await assert.rejects(
        () =>
          f.run(f.candidate(), {
            change(entry) {
              switch (mismatch) {
                case 'actor':
                  entry.actor = { kind: 'machine', id: f.machines.b.id };
                  break;
                case 'operation':
                  entry.proof.operationId = randomUUID();
                  break;
                case 'fence':
                  entry.proof.fence.generation = '2';
                  break;
                case 'hash':
                  entry.target = '0'.repeat(64);
                  break;
                case 'action':
                  entry.action = 'signal';
                  break;
                case 'root':
                  entry.rootId = randomUUID();
                  break;
                case 'project':
                  entry.projectId = randomUUID();
                  break;
                case 'tx':
                  entry.tx = db as unknown as Tx;
                  break;
              }
            },
          }),
        { code: 'TEST_TRUST_DENIED', status: 403 },
      );
    }));
}

test('B1 authority called anew per Tx; prior successful proof is not a reusable capability', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    await f.run(f.candidate());
    await assert.rejects(
      () =>
        f.mutation('unlisted-second-tx', (tx) =>
          f.services.assistantCreateTicket(tx, f.actor, f.proof, f.candidate()),
        ),
      { code: 'TEST_TRUST_DENIED' },
    );
    assert.equal(f.trust.observed.length, 1);
  }));

test('B1 captures authority method at factory construction and does not follow later replacement', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    f.trust.authority.verify = async () => {
      throw new Error('REPLACEMENT_MUST_NOT_RUN');
    };
    await f.run(f.candidate());
    assert.equal(f.trust.observed.length, 1);
    const deps: TicketServiceDependencies = {};
    const absent = createTicketServices(deps);
    deps.assistant = f.trust.authority;
    await assert.rejects(() => f.run(f.candidate(), { services: absent }), {
      code: 'ORCHESTRATION_UNAVAILABLE',
      status: 503,
    });
  }));

for (const changed of ['input', 'actor', 'proof'] as const) {
  test(`B1 snapshots ${changed} before deferred verify and uses original identity throughout`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      const input = f.candidate({ inputs: { nested: { value: 'submitted' } } });
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
      const pending = f.run(input, { actor, proof });
      const settled = pending.then(
        () => 'settled',
        () => 'settled',
      );
      try {
        // Scaffold fails promptly here instead of waiting forever for absent verification.
        assert.equal(await Promise.race([entered.then(() => 'entered'), settled]), 'entered');
        if (changed === 'input') {
          input.title = 'mutated';
          (input.inputs.nested as { value: string }).value = 'mutated';
          input.parentId = f.a.id;
        } else if (changed === 'actor') {
          actor.id = f.machines.b.id;
        } else {
          proof.operationId = randomUUID();
          proof.fence.generation = '99';
        }
        release();
        const { ticket } = await pending;
        assert.equal(ticket.title, 'Ticket step');
        assert.equal(ticket.parentId, f.request.id);
        assert.deepEqual(ticket.inputs, { nested: { value: 'submitted' } });
        const [row] = await db`select created_actor_id from tickets where id=${ticket.id}`;
        assert.equal(row?.created_actor_id, f.actor.id);
      } finally {
        release();
        await pending.catch(() => undefined);
      }
    }));
}

test('B1 root, parent and project prefix locks are held before authority verify', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    f.trust.setHook(async () => {
      for (const id of [f.request.id, f.a.id]) {
        await assert.rejects(
          () =>
            db.begin(async (peer) => {
              await peer`select id from tickets where id=${id} for update nowait`;
            }),
          { code: '55P03' },
        );
      }
      await assert.rejects(
        () =>
          db.begin(async (peer) => {
            await peer`select id from projects where id=${f.project.id} for update nowait`;
          }),
        { code: '55P03' },
      );
    });
    const { ticket } = await f.run(inputTicket(f.project.id, 'task', f.a.id));
    assert.equal(ticket.rootId, f.request.id);
  }));

test('B1 snapshots input, actor and proof synchronously before the first authority-prefix await', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const input = f.candidate();
    const actor = clone(f.actor);
    const proof = clone(f.proof);
    const { ticket } = await f.run(input, {
      actor,
      proof,
      afterStart() {
        input.title = 'Changed immediately';
        input.parentId = f.a.id;
        actor.id = f.machines.b.id;
        proof.fence.generation = '2';
        proof.operationId = randomUUID();
      },
    });
    assert.equal(ticket.title, 'Ticket step');
    assert.equal(ticket.parentId, f.request.id);
    const [row] = await db`select created_actor_id from tickets where id=${ticket.id}`;
    assert.equal(row?.created_actor_id, f.actor.id);
    assert.equal(f.trust.observed.length, 1);
  }));

test('B1 request target hashes exact submitted payload before defaults; omitted differs from null', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const omitted = inputTicket(f.project.id, 'request');
    const explicitNull = { ...omitted, deployApprovalDecisionId: null };
    const first = await f.run(omitted);
    const second = await f.run(explicitNull);
    assert.notEqual(targetHash(omitted), targetHash(explicitNull));
    assert.equal(f.trust.observed[0]?.target, targetHash(omitted));
    assert.equal(f.trust.observed[1]?.target, targetHash(explicitNull));
    for (const { ticket } of [first, second]) {
      assert.equal(ticket.rootId, ticket.id);
      assert.deepEqual(ticket.criteria, { workflowChoice: 'superpowers' });
      assert.equal(ticket.workflowPin, null);
    }
    assert.deepEqual(omitted.criteria, {});
  }));

test('B1 scoped create inherits parent pin and preserves submitted hash', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const root = await f.mutation('pinned-root', (tx) =>
      f.services.createTicket(tx, inputTicket(f.project.id, 'request', null, { workflowPin: pin }), owner),
    );
    const input = inputTicket(f.project.id, 'step', root.id);
    const { ticket } = await f.run(input);
    assert.deepEqual(ticket.workflowPin, pin);
    assert.equal(f.trust.observed[0]?.target, targetHash(input));
    assert.equal(input.workflowPin, null);
  }));

for (const invariant of [
  'parent-project',
  'parent-level',
  'missing-parent',
  'closed-root',
  'closed-parent',
  'pin',
] as const) {
  test(`B1 shared create invariant rejects ${invariant}`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      let input = f.candidate();
      let code = 'TICKET_HIERARCHY';
      if (invariant === 'parent-project') {
        const project = await f.mutation('other-project', (tx) =>
          createProject(tx, { key: 'OTHER', name: 'Other', repositoryUrl: null }),
        );
        input.projectId = project.id;
      } else if (invariant === 'parent-level') {
        input.parentId = f.a.id;
      } else if (invariant === 'missing-parent') {
        input.parentId = randomUUID();
        code = 'NOT_FOUND';
      } else if (invariant === 'closed-root') {
        await db`update tickets set status='done' where id=${f.request.id}`;
        code = 'TICKET_CLOSED';
      } else if (invariant === 'closed-parent') {
        await db`update tickets set status='cancelled' where id=${f.a.id}`;
        input = inputTicket(f.project.id, 'task', f.a.id);
        code = 'TICKET_CLOSED';
      } else {
        input.workflowPin = pin;
        code = 'WORKFLOW_PIN_MISMATCH';
      }
      await assert.rejects(() => f.run(input), { code });
    }));
}

for (const invalid of [
  'missing-pin',
  'bad-pin',
  'empty-title',
  'bad-level',
  'bad-kind',
  'bad-json',
  'cycle',
  'accessor',
  'prototype',
  'undefined',
] as const) {
  test(`B1 shared validation rejects ${invalid} without writes`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      const input = f.candidate();
      if (invalid === 'missing-pin') Reflect.deleteProperty(input, 'workflowPin');
      else if (invalid === 'bad-pin') input.workflowPin = { ...pin, checksum: 'bad' };
      else if (invalid === 'empty-title') input.title = '';
      else if (invalid === 'bad-level') Object.assign(input, { level: 'other' });
      else if (invalid === 'bad-kind') Object.assign(input, { kind: 'other' });
      else if (invalid === 'bad-json') input.inputs = { invalid: Number.NaN };
      else if (invalid === 'cycle') input.inputs.self = input.inputs;
      else if (invalid === 'accessor')
        Object.defineProperty(input.inputs, 'secret', {
          enumerable: true,
          get() {
            throw new Error('ACCESSOR_EXECUTED');
          },
        });
      else if (invalid === 'prototype') input.inputs = Object.create({ inherited: true });
      else input.inputs = { invalid: undefined };
      const [before] = await db`select count(*)::int as count from tickets`;
      // Deliberately bypass HTTP/journal body validation to exercise the service boundary.
      await assert.rejects(
        () =>
          f.mutation(`invalid-${invalid}`, (tx) =>
            f.services.assistantCreateTicket(tx, f.actor, f.proof, input),
          ),
        { code: 'VALIDATION', status: 400 },
      );
      const [after] = await db`select count(*)::int as count from tickets`;
      assert.equal(after?.count, before?.count);
      assert.equal(f.trust.observed.length, 0);
    }));
}

test('B1 deploy request and unapproved child never gain owner intent from scoped authority', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    for (const input of [
      inputTicket(f.project.id, 'request', null, { kind: 'deploy' }),
      f.candidate({ kind: 'deploy' }),
    ]) {
      await assert.rejects(() => f.run(input), { code: 'DEPLOY_OWNER_INTENT_REQUIRED', status: 403 });
    }
  }));

test('B1 deploy child requires exact persisted approval and rejects changed target', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const input = f.candidate({ kind: 'deploy', title: 'Staging', inputs: { environment: 'staging' } });
    const approvalId = await f.mutation('approval', (tx) =>
      f.services.recordDecision(
        tx,
        f.request.id,
        {
          kind: 'approval',
          content: 'Duyệt staging',
          rationale: 'Test owner intent',
          sources: [],
          scope: {
            action: 'deploy',
            rootTicketId: f.request.id,
            ticketDefinitionHash: deployTicketFingerprint(input, f.request.id),
          },
        },
        owner,
      ),
    );
    for (const changes of [{ title: 'Production' }, { inputs: { environment: 'production' } }]) {
      await assert.rejects(() => f.run({ ...input, ...changes, deployApprovalDecisionId: approvalId }), {
        code: 'DEPLOY_OWNER_INTENT_REQUIRED',
        status: 403,
      });
    }
    const { ticket } = await f.run({ ...input, deployApprovalDecisionId: approvalId });
    assert.equal(await db.begin((tx) => readDeployAuthorization(tx, ticket.id)), 'owner_approval');
    assert.equal(Object.hasOwn(ticket, 'deployApprovalDecisionId'), false);
    const [row] =
      await db`select created_actor_id,deploy_approval_decision_id from tickets where id=${ticket.id}`;
    assert.equal(row?.created_actor_id, f.actor.id);
    assert.equal(row?.deploy_approval_decision_id, approvalId);
  }));

for (const level of ['step', 'task'] as const) {
  test(`B1 FIX1 uppercase project identity creates ${level} under exact submitted hash`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      const parentId = level === 'step' ? f.request.id : f.a.id;
      const input = inputTicket(f.project.id.toUpperCase(), level, parentId.toUpperCase());
      const { ticket, key } = await f.run(input);
      assert.equal(ticket.projectId, f.project.id);
      assert.equal(ticket.parentId, parentId);
      assert.equal(ticket.rootId, f.request.id);
      assert.equal(f.trust.observed[0]?.projectId, f.project.id);
      assert.equal(f.trust.observed[0]?.target, targetHash(input));
      assert.notEqual(targetHash(input), targetHash({ ...input, projectId: f.project.id }));
      const [journal] = await db`select body_hash,actor_id from idempotency where key=${key}`;
      assert.equal(journal?.body_hash, hash(input));
      assert.equal(journal?.actor_id, f.actor.id);
    }));

  test(`B1 FIX1 lowercase hash allowance cannot authorize uppercase ${level} payload`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      const input = inputTicket(f.project.id.toUpperCase(), level, level === 'step' ? f.request.id : f.a.id);
      const [before] = await db`select count(*)::int as count from tickets`;
      await assert.rejects(
        () =>
          f.run(input, {
            change(entry) {
              entry.input.projectId = f.project.id;
              entry.target = targetHash(entry.input);
            },
          }),
        { code: 'TEST_TRUST_DENIED', status: 403 },
      );
      const [after] = await db`select count(*)::int as count from tickets`;
      assert.equal(after?.count, before?.count);
      assert.equal(f.trust.observed.length, 0);
    }));
}

for (const hostile of ['index-getter', 'custom-iterator', 'custom-prototype'] as const) {
  test(`B1 FIX1 array ${hostile} is rejected without executing user code or changing identity`, async () =>
    withDatabase(async (db) => {
      const f = await fixture(db);
      const actor = clone(f.actor);
      const proof = clone(f.proof);
      const originalActor = clone(actor);
      const originalProof = clone(proof);
      let executions = 0;
      let verifications = 0;
      const payload = ['ordinary'];
      const mutateIdentity = () => {
        executions += 1;
        actor.id = f.machines.b.id;
        proof.operationId = randomUUID();
      };
      if (hostile === 'index-getter') {
        Object.defineProperty(payload, '0', {
          enumerable: true,
          configurable: true,
          get() {
            mutateIdentity();
            return 'getter-returned-safe-string';
          },
        });
      } else if (hostile === 'custom-iterator') {
        Object.defineProperty(payload, Symbol.iterator, {
          value: function* () {
            mutateIdentity();
            yield 'iterator-returned-safe-string';
          },
        });
      } else {
        Object.setPrototypeOf(payload, Object.create(Array.prototype));
      }
      const input = f.candidate({ inputs: { nested: { payload } } });
      // Reject-only observer: no blanket trust grant and no hostile data passed
      // through the journal's canonicalizer before reaching the B1 boundary.
      const services = createTicketServices({
        assistant: {
          async verify() {
            verifications += 1;
            throw new ApiError('TEST_BOUNDARY_REACHED', 403, 'Unexpected authority call');
          },
        },
      });
      const [before] = await db`select count(*)::int as count from tickets`;
      let failure: unknown;
      try {
        await f.mutation(`hostile-${hostile}`, (tx) =>
          services.assistantCreateTicket(tx, actor, proof, input),
        );
      } catch (error) {
        failure = error;
      }
      const [after] = await db`select count(*)::int as count from tickets`;
      assert.deepEqual(
        {
          code: failure instanceof ApiError ? failure.code : null,
          status: failure instanceof ApiError ? failure.status : null,
          executions,
          verifications,
          actor,
          proof,
          writes: Number(after?.count) - Number(before?.count),
        },
        {
          code: 'VALIDATION',
          status: 400,
          executions: 0,
          verifications: 0,
          actor: originalActor,
          proof: originalProof,
          writes: 0,
        },
      );
    }));
}

test('B1 FIX1 ordinary nested JSON arrays remain supported with their exact submitted hash', async () =>
  withDatabase(async (db) => {
    const f = await fixture(db);
    const input = f.candidate({
      criteria: { checks: ['first', { nested: [true, false] }] },
      inputs: { values: [null, 0, 1.5, 'text', [], { children: [1, 2] }] },
      outputs: { values: [] },
    });
    const { ticket } = await f.run(input);
    assert.deepEqual(ticket.criteria, input.criteria);
    assert.deepEqual(ticket.inputs, input.inputs);
    assert.deepEqual(ticket.outputs, input.outputs);
    assert.equal(f.trust.observed[0]?.target, targetHash(input));
  }));
