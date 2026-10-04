import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPersistedAssistantActorResolver } from '../src/assistant/authority.ts';
import type {
  OrchestrationAction,
  OrchestrationProof,
  TurnFence,
  WorkflowRun,
} from '../src/assistant/contracts.ts';
import { createProjectOrchestrationPort } from '../src/assistant/orchestration.ts';
import type { CreateRunInput } from '../src/assistant/runs.ts';
import { createWorkflowRuns, workflowEffectId } from '../src/assistant/runs.ts';
import { provisionMachine } from '../src/auth/machine.ts';
import { mutate } from '../src/journal/mutation.ts';
import type { Actor, Db, Id, Tx } from '../src/platform/contracts.ts';
import { assistantFixture, fixtureVerifierBuildSha256 } from './support/assistant.ts';
import { databaseFixture } from './support/db.ts';
import { inputTicket, owner } from './support/tickets.ts';

const withDatabase = databaseFixture(11);
type VectorEntry = {
  source: Record<string, unknown>;
  projection: Record<string, unknown>;
  definition: {
    sha256: string;
    skills: { path: string; sha256: string }[];
    customizationSha256: string;
    render?: Record<string, unknown>;
  };
};
// Shared S3b vector: exactly what the gateway reports and the server stores for B.
const vector = JSON.parse(
  await readFile(
    new URL('../../gateway/test/fixtures/workflow-definitions/install-report-vector.json', import.meta.url),
    'utf8',
  ),
) as { superpowers: VectorEntry; bmad: VectorEntry };
const superpowersHash = vector.superpowers.definition.sha256;
const bmadHash = vector.bmad.definition.sha256;
const skillSha = (workflow: 'superpowers' | 'bmad', path: string) =>
  vector[workflow].definition.skills.find((skill) => skill.path === path)?.sha256;
const missingSlot = { state: 'missing', installed: null, lastError: null, observedAt: null };
const currentSlot = (installed: unknown, extra: Record<string, unknown> = {}) => ({
  state: 'current',
  installed,
  lastError: null,
  observedAt: '2026-10-04T00:00:00.000Z',
  ...extra,
});
type Slot = {
  state: string;
  installed: unknown;
  lastError: null;
  observedAt: string | null;
  definition?: VectorEntry['definition'];
};
type Status = Record<
  'superpowers' | 'bmad',
  { source: Slot; projections: Record<'claude' | 'codex' | 'api', Slot> }
>;
function workflowStatus(change?: (status: Status) => void): Record<string, unknown> {
  const status: Status = JSON.parse(
    JSON.stringify({
      superpowers: {
        source: currentSlot(vector.superpowers.source),
        projections: {
          claude: currentSlot(vector.superpowers.projection, { definition: vector.superpowers.definition }),
          codex: missingSlot,
          api: missingSlot,
        },
      },
      bmad: {
        source: currentSlot(vector.bmad.source),
        projections: {
          claude: currentSlot(vector.bmad.projection, { definition: vector.bmad.definition }),
          codex: missingSlot,
          api: missingSlot,
        },
      },
    }),
  );
  change?.(status);
  return status;
}

type RunFixtureOptions = {
  workflow?: 'superpowers' | 'bmad';
  admission?: 'none' | { receiptStatus: 'FAIL' };
  actions?: OrchestrationAction[];
};

// Real persisted rows: admitted PASS turn of machine A, root scope with the create_run
// tool, project bound to B, and B's stored install report (fixture seed of 007).
async function runFixture(db: Db, options: RunFixtureOptions = {}) {
  const f = await assistantFixture(db);
  const machines = await f.mutation(randomUUID(), async (tx) => ({
    a: await provisionMachine(tx, 'Assistant A'),
    b: await provisionMachine(tx, 'Bound B'),
    c: await provisionMachine(tx, 'Other C'),
  }));
  const a: Actor = { kind: 'machine', id: machines.a.machine.id };
  const b: Actor = { kind: 'machine', id: machines.b.machine.id };
  const c: Actor = { kind: 'machine', id: machines.c.machine.id };
  await db`update projects set machine_id=${b.id},checkout_path='/tmp/s4-test-only',binding_revision=2 where id=${f.project.id}`;
  const root = await f.mutation(randomUUID(), (tx) =>
    f.services.createTicket(
      tx,
      inputTicket(f.project.id, 'request', null, {
        kind: 'code',
        title: 'Yêu cầu chạy workflow',
        criteria: { workflowChoice: options.workflow ?? 'superpowers' },
      }),
      owner,
    ),
  );
  const seedApplied = async (machineId: Id, status: Record<string, unknown>) => {
    const reportId = randomUUID();
    await db.begin(async (tx) => {
      const [boot] = await tx`select 1 from gateway_boots where machine_id=${machineId}`;
      if (!boot)
        await tx`insert into gateway_boots(machine_id,boot_id,boot_generation,previous_generation,created_at)
          values(${machineId},${randomUUID()},1,0,now())`;
      await tx`insert into gateway_install_reports(id,machine_id,boot_generation,config_revision,body_hash,report,response,received_at)
        values(${reportId},${machineId},1,1,${'a'.repeat(64)},${tx.json({ fixture: true })},${tx.json({ accepted: true })},now())`;
      await tx`insert into gateway_applied(machine_id,revision,inventory,latest_report_id,workflow_status,applied_at)
        values(${machineId},1,${tx.json(status as never)},${reportId},${tx.json(status as never)},now())
        on conflict(machine_id) do update set inventory=excluded.inventory,workflow_status=excluded.workflow_status,
        latest_report_id=excluded.latest_report_id`;
    });
  };
  await seedApplied(b.id, workflowStatus());
  const submitted = await f.submitMessage();
  let fence: TurnFence;
  let snapshotId: Id;
  if (options.admission === 'none') {
    fence = await f.seedTurn(submitted.conversation.id, null);
    snapshotId = randomUUID();
    await db`insert into attachment_input_snapshots(id,target_kind,target_id,input_revision,route_revision,canonical,sha256)
      values(${snapshotId},'ticket',${root.id},1,0,'{}',${'c'.repeat(64)})`;
  } else {
    const seeded = await f.seedAdmittedTurn({
      conversationId: submitted.conversation.id,
      messageId: null,
      target: { kind: 'ticket', id: root.id },
      machineId: a.id,
      ...(options.admission ? { receiptStatus: options.admission.receiptStatus } : {}),
    });
    fence = seeded.fence;
    snapshotId = seeded.snapshotId as Id;
  }
  const scopeId = randomUUID();
  await db`insert into assistant_scopes(id,turn_id,root_ticket_id,message_id,project_id,actions,tool_names,input_snapshot_id,
    scope_sha256,owner_authorization_id,expires_at)
    values(${scopeId},${fence.turnId},${root.id},null,${f.project.id},
    ${db.json(options.actions ?? ['create_ticket', 'dependency'])},${db.json(['create_run'])},${snapshotId},
    ${'a'.repeat(64)},${randomUUID()},clock_timestamp()+interval '60 seconds')`;
  const resolver = createPersistedAssistantActorResolver({ verifierBuildSha256: fixtureVerifierBuildSha256 });
  const port = createProjectOrchestrationPort({ resolver });
  const runs = createWorkflowRuns({ port, resolver });
  // The tools route stand-in: a pending operation row written in the same Tx as the call.
  const inTurn = async <T>(work: (tx: Tx, proof: OrchestrationProof) => Promise<T>): Promise<T> => {
    const result = await mutate(
      db,
      { actor: a, route: 'test-only:assistant-create-run', key: randomUUID(), body: {} },
      async (tx) => {
        const operationId = await f.seedToolOperation(tx, { turnId: fence.turnId, snapshotId });
        return { status: 201, body: { value: (await work(tx, { fence, scopeId, operationId })) as unknown } };
      },
    );
    return result.body.value as T;
  };
  const create = (input: Partial<CreateRunInput> = {}) =>
    inTurn((tx, proof) =>
      runs.createRun(tx, proof, {
        rootTicketId: root.id,
        path: options.workflow === 'bmad' ? 'bmad-dispatch' : 'architectural',
        definitionSha256: options.workflow === 'bmad' ? bmadHash : superpowersHash,
        ...input,
      }),
    );
  const rows = async () => ({
    runs: await db`select * from workflow_runs order by id`,
    steps: await db`select * from workflow_steps order by id`,
    gates: await db`select * from workflow_gates order by id`,
    operations: await db`select * from assistant_operation_ids order by id`,
    tickets: await db`select id,revision,status from tickets order by id`,
    dependencies: await db`select * from dependencies order by ticket_id,predecessor_id`,
  });
  return {
    ...f,
    assistantA: a,
    boundB: b,
    otherC: c,
    root,
    fence,
    snapshotId,
    scopeId,
    runs,
    inTurn,
    create,
    rows,
    seedApplied,
  };
}
type RunFixture = Awaited<ReturnType<typeof runFixture>>;

async function stepCriteria(db: Db, run: WorkflowRun) {
  const criteria = [];
  for (const step of run.steps) {
    const [row] = await db`select criteria from tickets where id=${step.ticketId}`;
    criteria.push(row?.criteria.workflowRun);
  }
  return criteria;
}

async function assertGraph(db: Db, f: RunFixture, run: WorkflowRun) {
  // Child tickets: created by machine A under the root of B's project.
  const tickets = await db`select id,parent_id,root_id,level,created_actor_kind,created_actor_id from tickets
    where id in ${db(run.steps.map((step) => step.ticketId))}`;
  assert.equal(tickets.length, run.steps.length);
  for (const ticket of tickets)
    assert.deepEqual(
      { ...ticket, id: undefined },
      {
        id: undefined,
        parent_id: f.root.id,
        root_id: f.root.id,
        level: 'step',
        created_actor_kind: 'machine',
        created_actor_id: f.assistantA.id,
      },
    );
  // The dependency DAG equals the step predecessor relation exactly.
  const byStep = new Map(run.steps.map((step) => [step.id, step.ticketId]));
  const expected = run.steps
    .flatMap((step) =>
      step.predecessorIds.map((id) => ({ ticket_id: step.ticketId, predecessor_id: byStep.get(id) })),
    )
    .sort((x, y) => `${x.ticket_id}${x.predecessor_id}`.localeCompare(`${y.ticket_id}${y.predecessor_id}`));
  const dependencies = await db`select ticket_id,predecessor_id from dependencies
    where ticket_id in ${db(run.steps.map((step) => step.ticketId))} order by ticket_id,predecessor_id`;
  assert.deepEqual(
    dependencies.map((row) => ({ ...row })),
    expected,
  );
  // One distinct persisted operation per child ticket and per edge, effect IDs recomputable.
  const operations = await db`select * from assistant_operation_ids where run_id=${run.id}`;
  assert.equal(operations.length, run.steps.length + expected.length);
  assert.equal(new Set(operations.map((row) => row.id)).size, operations.length);
  const criteria = await stepCriteria(db, run);
  for (const [index, step] of run.steps.entries()) {
    const own = operations.filter((row) => row.step_id === step.id && row.action_kind === 'create_ticket');
    assert.equal(own.length, 1);
    assert.equal(own[0]?.id, criteria[index].stepOperationId);
    assert.equal(own[0]?.target_identity, step.ticketId);
  }
  for (const row of operations)
    assert.equal(
      row.effect_id,
      workflowEffectId({
        runId: run.id,
        stepOperationId: row.id,
        actionKind: row.action_kind,
        targetIdentity: row.target_identity,
        preconditionSha256: row.precondition_sha256,
      }),
    );
  // Gate IDs are reserved on the step; no gate row exists without an artifact.
  assert.equal((await db`select * from workflow_gates where run_id=${run.id}`).length, 0);
  for (const [index, step] of run.steps.entries())
    assert.deepEqual(
      criteria[index].gates.map((gate: { id: Id }) => gate.id),
      step.gateIds,
    );
  return criteria;
}

const outline = (run: WorkflowRun, criteria: { stepKey: string; gates: { kind: string }[] }[]) =>
  run.steps.map((step, index) => ({
    key: criteria[index]?.stepKey,
    skill: step.skill,
    sourcePath: step.sourcePath,
    role: step.role,
    gates: criteria[index]?.gates.map((gate) => gate.kind),
  }));
const isChain = (run: WorkflowRun) =>
  run.steps.every((step, index) =>
    index === 0
      ? step.predecessorIds.length === 0
      : step.predecessorIds.length === 1 && step.predecessorIds[0] === run.steps[index - 1]?.id,
  );

test('assistant workflows: definition not proven on machine B is 422 without rows', async () =>
  withDatabase(async (db) => {
    const f = await runFixture(db);
    try {
      const before = await f.rows();
      await assert.rejects(() => f.create({ definitionSha256: 'f'.repeat(64) }), {
        code: 'WORKFLOW_DEFINITION_UNKNOWN',
        status: 422,
      });
      // Same hash reported by another machine only.
      await f.seedApplied(
        f.boundB.id,
        workflowStatus((status) => {
          status.superpowers.projections.claude = missingSlot;
        }),
      );
      await f.seedApplied(f.otherC.id, workflowStatus());
      await assert.rejects(() => f.create(), { code: 'WORKFLOW_DEFINITION_UNKNOWN', status: 422 });
      // Slot not current, even though the definition bytes are present.
      await f.seedApplied(
        f.boundB.id,
        workflowStatus((status) => {
          status.superpowers.projections.claude.state = 'mismatch';
        }),
      );
      await assert.rejects(() => f.create(), { code: 'WORKFLOW_DEFINITION_UNKNOWN', status: 422 });
      // Stored digest no longer recomputes over the slot pins and skills.
      await f.seedApplied(
        f.boundB.id,
        workflowStatus((status) => {
          status.superpowers.projections.claude.definition?.skills.pop();
        }),
      );
      await assert.rejects(() => f.create(), { code: 'WORKFLOW_DEFINITION_UNKNOWN', status: 422 });
      // A BMAD definition cannot drive a Superpowers path.
      await f.seedApplied(f.boundB.id, workflowStatus());
      await assert.rejects(() => f.create({ definitionSha256: bmadHash }), {
        code: 'WORKFLOW_PATH_MISMATCH',
        status: 422,
      });
      assert.deepEqual(await f.rows(), before);
    } finally {
      await f.close();
    }
  }));

test('assistant workflows: resolver denial writes no run', async () => {
  for (const [admission, expected] of [
    ['none', { code: 'ASSISTANT_ADMISSION_NOT_CONFIGURED', status: 503 }],
    [{ receiptStatus: 'FAIL' }, { code: 'ASSISTANT_ADMISSION_DENIED', status: 403 }],
  ] as const)
    await withDatabase(async (db) => {
      const f = await runFixture(db, { admission });
      try {
        const before = await f.rows();
        await assert.rejects(() => f.create(), expected);
        assert.deepEqual(await f.rows(), before);
      } finally {
        await f.close();
      }
    });
});

test('assistant workflows: architectural path follows the pinned brainstorming → plan chain', async () =>
  withDatabase(async (db) => {
    const f = await runFixture(db);
    try {
      const run = await f.create();
      assert.equal(run.steps[0]?.sourcePath, 'skills/brainstorming/SKILL.md');
      assert.equal(run.path, 'architectural');
      assert.equal(run.revision, 1);
      assert.equal(run.renderedArtifactId, null);
      assert.equal(run.parallelApprovalId, null);
      assert.equal(run.definitionSha256, superpowersHash);
      assert.equal(run.customizationSha256, vector.superpowers.definition.customizationSha256);
      assert.deepEqual(run.source, vector.superpowers.source);
      assert.deepEqual(run.projection, vector.superpowers.projection);
      const criteria = await assertGraph(db, f, run);
      assert.deepEqual(outline(run, criteria), [
        {
          key: 'design',
          skill: 'brainstorming',
          sourcePath: 'skills/brainstorming/SKILL.md',
          role: 'research',
          gates: ['design_approval'],
        },
        {
          key: 'spec',
          skill: 'brainstorming',
          sourcePath: 'skills/brainstorming/SKILL.md',
          role: 'research',
          gates: ['spec_approval'],
        },
        {
          key: 'plan',
          skill: 'writing-plans',
          sourcePath: 'skills/writing-plans/SKILL.md',
          role: 'research',
          gates: ['plan_approval_execution_method'],
        },
        {
          key: 'implement',
          skill: 'test-driven-development',
          sourcePath: 'skills/test-driven-development/SKILL.md',
          role: 'implement',
          gates: [],
        },
        {
          key: 'review',
          skill: 'requesting-code-review',
          sourcePath: 'skills/requesting-code-review/SKILL.md',
          role: 'review',
          gates: [],
        },
        {
          key: 'verify',
          skill: 'verification-before-completion',
          sourcePath: 'skills/verification-before-completion/SKILL.md',
          role: 'review',
          gates: [],
        },
      ]);
      for (const step of run.steps) assert.equal(step.sourceSha256, skillSha('superpowers', step.sourcePath));
      assert.ok(isChain(run), 'mặc định tuần tự: mỗi bước chỉ chờ bước trước');
      for (const gate of criteria.flatMap((item) => item.gates)) assert.equal(gate.requiredActor, 'owner');
      // A run cannot be created twice for the same root, and Superpowers runs never latch a render.
      await assert.rejects(() => f.create(), { code: 'WORKFLOW_RUN_EXISTS', status: 409 });
      await assert.rejects(() => db.begin((tx) => f.runs.latchRenderedArtifact(tx, run.id, randomUUID())), {
        code: 'WORKFLOW_RENDER_NOT_REQUIRED',
        status: 409,
      });
    } finally {
      await f.close();
    }
  }));

const superpowersOutlines: Record<'bounded' | 'bug' | 'spike', ReturnType<typeof outline>> = {
  bounded: [
    {
      key: 'design',
      skill: 'brainstorming',
      sourcePath: 'skills/brainstorming/SKILL.md',
      role: 'research',
      gates: ['design_approval'],
    },
    {
      key: 'implement',
      skill: 'test-driven-development',
      sourcePath: 'skills/test-driven-development/SKILL.md',
      role: 'implement',
      gates: [],
    },
    {
      key: 'review',
      skill: 'requesting-code-review',
      sourcePath: 'skills/requesting-code-review/SKILL.md',
      role: 'review',
      gates: [],
    },
    {
      key: 'verify',
      skill: 'verification-before-completion',
      sourcePath: 'skills/verification-before-completion/SKILL.md',
      role: 'review',
      gates: [],
    },
  ],
  bug: [
    ...['root_cause', 'pattern', 'hypothesis'].map((key) => ({
      key,
      skill: 'systematic-debugging',
      sourcePath: 'skills/systematic-debugging/SKILL.md',
      role: 'research' as const,
      gates: [],
    })),
    {
      key: 'fix',
      skill: 'systematic-debugging',
      sourcePath: 'skills/systematic-debugging/SKILL.md',
      role: 'fix',
      gates: ['architecture_discussion'],
    },
    {
      key: 'review',
      skill: 'requesting-code-review',
      sourcePath: 'skills/requesting-code-review/SKILL.md',
      role: 'review',
      gates: [],
    },
    {
      key: 'verify',
      skill: 'verification-before-completion',
      sourcePath: 'skills/verification-before-completion/SKILL.md',
      role: 'review',
      gates: [],
    },
  ],
  spike: [
    {
      key: 'probe',
      skill: 'brainstorming',
      sourcePath: 'skills/brainstorming/SKILL.md',
      role: 'research',
      gates: ['probe_approval'],
    },
    {
      key: 'investigate',
      skill: 'brainstorming',
      sourcePath: 'skills/brainstorming/SKILL.md',
      role: 'research',
      gates: [],
    },
  ],
};

test('assistant workflows: bounded, bug and spike paths map their pinned sources', async () => {
  for (const path of ['bounded', 'bug', 'spike'] as const)
    await withDatabase(async (db) => {
      const f = await runFixture(db);
      try {
        const run = await f.create({ path });
        const criteria = await assertGraph(db, f, run);
        assert.deepEqual(outline(run, criteria), superpowersOutlines[path], path);
        assert.ok(isChain(run), path);
        for (const step of run.steps)
          assert.equal(step.sourceSha256, skillSha('superpowers', step.sourcePath));
        if (path === 'spike') {
          const kinds =
            await db`select kind from tickets where id in ${db(run.steps.map((step) => step.ticketId))}`;
          assert.deepEqual(
            [...new Set(kinds.map((row) => row.kind))],
            ['research'],
            'spike không hoàn tất mã sản phẩm',
          );
        }
      } finally {
        await f.close();
      }
    });
});

const projectRoot = '/Users/fixture/work/crew-ws-1';
const generationPath = (root: string, tail = '0123456789abcdef0123') => {
  const slug =
    root
      .split('/')
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') ?? 'project';
  const rootHash = createHash('sha256').update(root, 'utf8').digest('hex').slice(0, 12);
  return `${root}/_bmad/render/bmad-build/${slug}-${rootHash}/${tail}`;
};

// Test-only execution rows standing in for the S6 receipt registration on machine B.
async function seedReceipt(
  db: Db,
  input: {
    ticketId: Id;
    machineId: Id;
    bindingRevision?: number;
    data?: Record<string, unknown>;
    kind?: string;
  },
  run: WorkflowRun,
) {
  const commandId = randomUUID(),
    attemptId = randomUUID(),
    evidenceId = randomUUID();
  const [existing] = await db`select id from attempts where ticket_id=${input.ticketId} and state='active'`;
  const attempt = existing?.id ?? attemptId;
  if (!existing) {
    await db`insert into commands(id,machine_id,ticket_id,binding_revision,type,payload,state)
      values(${commandId},${input.machineId},${input.ticketId},${input.bindingRevision ?? 2},'start','{}','received')`;
    await db`insert into attempts(id,ticket_id,machine_id,command_id,fence,binding_revision,process_instance_id,state,lease_expires_at,workflow_pin)
      values(${attemptId},${input.ticketId},${input.machineId},${commandId},1,${input.bindingRevision ?? 2},${randomUUID()},
      'active',now()+interval '60 seconds','{}')`;
  }
  const data = {
    definitionSha256: run.definitionSha256,
    customizationSha256: run.customizationSha256,
    projectRoot,
    generationPath: generationPath(projectRoot),
    inspection: { kind: 'artifact-inspection', manifestSha256: 'a'.repeat(64) },
    ...input.data,
  };
  await db`insert into evidence(id,ticket_id,attempt_id,kind,data)
    values(${evidenceId},${input.ticketId},${attempt},${input.kind ?? 'workflow_render_receipt'},${db.json(data)})`;
  return evidenceId;
}

test('assistant workflows: bmad-dispatch run waits for a verified render latch', async () =>
  withDatabase(async (db) => {
    const f = await runFixture(db, { workflow: 'bmad' });
    try {
      const run = await f.create();
      const criteria = await assertGraph(db, f, run);
      const file = (name: string) => `.claude/skills/bmad-build/${name}`;
      assert.deepEqual(outline(run, criteria), [
        {
          key: 'step-01',
          skill: 'bmad-build',
          sourcePath: file('step-01-clarify-and-route.md'),
          role: 'research',
          gates: [],
        },
        {
          key: 'step-02',
          skill: 'bmad-build',
          sourcePath: file('step-02-plan.md'),
          role: 'research',
          gates: ['spec_approval'],
        },
        {
          key: 'step-03',
          skill: 'bmad-build',
          sourcePath: file('step-03-implement.md'),
          role: 'implement',
          gates: [],
        },
        {
          key: 'step-04',
          skill: 'bmad-build',
          sourcePath: file('step-04-review.md'),
          role: 'review',
          gates: [],
        },
        {
          key: 'step-05',
          skill: 'bmad-build',
          sourcePath: file('step-05-present.md'),
          role: 'implement',
          gates: [],
        },
      ]);
      for (const step of run.steps) assert.equal(step.sourceSha256, skillSha('bmad', step.sourcePath));
      assert.ok(isChain(run));
      assert.equal(run.renderedArtifactId, null);
      assert.deepEqual(run.projection, vector.bmad.projection);
      const [first, second] = run.steps;
      const latch = (evidenceId: Id) =>
        db.begin((tx) => f.runs.latchRenderedArtifact(tx, run.id, evidenceId));
      const conflict = { code: 'WORKFLOW_RENDER_RECEIPT_INVALID', status: 409 };
      const wrong: Promise<Id>[] = [];
      // Attempt by a machine other than the current binding.
      wrong.push(seedReceipt(db, { ticketId: second?.ticketId as Id, machineId: f.otherC.id }, run));
      const good = { ticketId: first?.ticketId as Id, machineId: f.boundB.id };
      // Attempt on a ticket outside this run.
      wrong.push(seedReceipt(db, { ticketId: f.a.id, machineId: f.boundB.id }, run));
      const denied = await Promise.all(wrong);
      denied.push(await seedReceipt(db, { ...good, data: { definitionSha256: superpowersHash } }, run));
      denied.push(await seedReceipt(db, { ...good, data: { customizationSha256: 'e'.repeat(64) } }, run));
      denied.push(
        await seedReceipt(db, { ...good, data: { projectRoot: '/Users/fixture/work/other' } }, run),
      );
      denied.push(await seedReceipt(db, { ...good, kind: 'artifact' }, run));
      for (const evidenceId of denied) await assert.rejects(() => latch(evidenceId), conflict);
      assert.equal(
        (await db`select rendered_artifact_id,revision from workflow_runs where id=${run.id}`)[0]?.revision,
        1,
      );
      const accepted = await seedReceipt(db, good, run);
      const latched = await latch(accepted);
      assert.equal(latched.renderedArtifactId, accepted);
      assert.equal(latched.revision, 2);
      const again = await seedReceipt(db, good, run);
      await assert.rejects(() => latch(again), {
        code: 'WORKFLOW_RENDER_ALREADY_LATCHED',
        status: 409,
      });
      const [row] = await db`select rendered_artifact_id,revision from workflow_runs where id=${run.id}`;
      assert.deepEqual({ ...row }, { rendered_artifact_id: accepted, revision: 2 });
    } finally {
      await f.close();
    }
  }));

test('assistant workflows: bmad-oneshot keeps the official oneshot route without an artifact', async () =>
  withDatabase(async (db) => {
    const f = await runFixture(db, { workflow: 'bmad' });
    try {
      const run = await f.create({ path: 'bmad-oneshot' });
      const criteria = await assertGraph(db, f, run);
      const file = (name: string) => `.claude/skills/bmad-build/${name}`;
      assert.deepEqual(outline(run, criteria), [
        {
          key: 'step-01',
          skill: 'bmad-build',
          sourcePath: file('step-01-clarify-and-route.md'),
          role: 'research',
          gates: [],
        },
        {
          key: 'step-02',
          skill: 'bmad-build',
          sourcePath: file('step-02-plan.md'),
          role: 'research',
          gates: [],
        },
        {
          key: 'step-oneshot',
          skill: 'bmad-build',
          sourcePath: file('step-oneshot.md'),
          role: 'implement',
          gates: [],
        },
      ]);
      assert.equal(run.renderedArtifactId, null);
      // A Superpowers path cannot use the BMAD definition.
      await assert.rejects(() => f.create({ path: 'bounded' }), { status: 422 });
    } finally {
      await f.close();
    }
  }));

test('assistant workflows: pinned run and step identity is immutable in SQL', async () =>
  withDatabase(async (db) => {
    const f = await runFixture(db);
    try {
      const run = await f.create({ path: 'bounded' });
      const updates = [
        () => db`update workflow_runs set source='{}' where id=${run.id}`,
        () => db`update workflow_runs set projection='{}' where id=${run.id}`,
        () => db`update workflow_runs set definition_sha256=${'1'.repeat(64)} where id=${run.id}`,
        () => db`update workflow_runs set customization_sha256=${'2'.repeat(64)} where id=${run.id}`,
        () => db`update workflow_runs set path='bug' where id=${run.id}`,
        () => db`update workflow_steps set gate_ids='[]' where run_id=${run.id}`,
        () => db`update workflow_steps set source_sha256=${'3'.repeat(64)} where run_id=${run.id}`,
        () => db`update assistant_operation_ids set target_identity='x' where run_id=${run.id}`,
        () => db`delete from workflow_runs where id=${run.id}`,
      ];
      for (const update of updates) await assert.rejects(update, /ASSISTANT_RECORD_IMMUTABLE/);
      const [row] = await db`select definition_sha256,revision from workflow_runs where id=${run.id}`;
      assert.deepEqual({ ...row }, { definition_sha256: superpowersHash, revision: 1 });
    } finally {
      await f.close();
    }
  }));

async function setParallelApproval(db: Db, decisionId: Id | null) {
  await db`update assistant_config set policy=jsonb_set(policy,'{parallelApprovalId}',${db.json(decisionId as never)})
    where singleton=true`;
}
async function insertDecision(db: Db, ticketId: Id, actor: Actor, kind: string, scope: unknown) {
  const id = randomUUID();
  await db`insert into decisions(id,ticket_id,actor_kind,actor_id,kind,content,rationale,sources,scope)
    values(${id},${ticketId},${actor.kind},${actor.id},${kind},'Chạy song song hai phần','Phần độc lập','[]',${db.json(scope as never)})`;
  return id;
}

test('assistant workflows: parallel needs an exact owner approval, sequential otherwise', async () =>
  withDatabase(async (db) => {
    const f = await runFixture(db);
    try {
      const scope = {
        parallel: {
          rootTicketId: f.root.id,
          path: 'bounded',
          definitionSha256: superpowersHash,
          units: [
            { key: 'api', title: 'API', ownershipKeys: ['v2/server/src/a.ts'] },
            { key: 'web', title: 'Web', ownershipKeys: ['v2/web/src/b.tsx'] },
          ],
        },
      };
      const before = await f.rows();
      await setParallelApproval(db, await insertDecision(db, f.root.id, f.assistantA, 'approval', scope));
      await assert.rejects(() => f.create({ path: 'bounded' }), {
        code: 'WORKFLOW_PARALLEL_APPROVAL_INVALID',
        status: 403,
      });
      await setParallelApproval(db, await insertDecision(db, f.a.id, owner, 'approval', scope));
      await assert.rejects(() => f.create({ path: 'bounded' }), {
        code: 'WORKFLOW_PARALLEL_APPROVAL_INVALID',
        status: 403,
      });
      const overlapping = structuredClone(scope);
      overlapping.parallel.units[1]?.ownershipKeys.push('v2/server/src/a.ts');
      await setParallelApproval(db, await insertDecision(db, f.root.id, owner, 'approval', overlapping));
      await assert.rejects(() => f.create({ path: 'bounded' }), {
        code: 'WORKFLOW_PARALLEL_OWNERSHIP_CONFLICT',
        status: 409,
      });
      const after = await f.rows();
      assert.deepEqual(
        { runs: after.runs, steps: after.steps, operations: after.operations, tickets: after.tickets },
        { runs: before.runs, steps: before.steps, operations: before.operations, tickets: before.tickets },
      );
      const approval = await insertDecision(db, f.root.id, owner, 'approval', scope);
      await setParallelApproval(db, approval);
      const run = await f.create({ path: 'bounded' });
      assert.equal(run.parallelApprovalId, approval);
      const criteria = await assertGraph(db, f, run);
      assert.deepEqual(
        criteria.map((item) => item.stepKey),
        ['design', 'implement', 'implement', 'review', 'verify'],
      );
      const [design, one, two, review] = run.steps;
      assert.deepEqual(one?.predecessorIds, [design?.id]);
      assert.deepEqual(two?.predecessorIds, [design?.id]);
      assert.deepEqual(new Set(review?.predecessorIds), new Set([one?.id, two?.id]));
      assert.deepEqual(
        [one?.ownershipKeys, two?.ownershipKeys],
        [['v2/server/src/a.ts'], ['v2/web/src/b.tsx']],
      );
      assert.notEqual(criteria[1].stepOperationId, criteria[2].stepOperationId);
    } finally {
      await f.close();
    }
  }));
