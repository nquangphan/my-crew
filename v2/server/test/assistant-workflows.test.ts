import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPersistedAssistantActorResolver } from '../src/assistant/authority.ts';
import type {
  OrchestrationAction,
  OrchestrationProof,
  QuestionProposal,
  TurnFence,
  WorkflowRun,
} from '../src/assistant/contracts.ts';
import type { GateAnswer, RecordGateAnswerInput } from '../src/assistant/gates.ts';
import { createWorkflowGates } from '../src/assistant/gates.ts';
import type { OperationRequest } from '../src/assistant/operation-request.ts';
import { operationRequestSha256 } from '../src/assistant/operation-request.ts';
import type { WorkflowOrchestrationPort } from '../src/assistant/orchestration.ts';
import { createProjectOrchestrationPort } from '../src/assistant/orchestration.ts';
import type { CreateRunInput } from '../src/assistant/runs.ts';
import { createWorkflowRuns, workflowEffectId } from '../src/assistant/runs.ts';
import { provisionMachine } from '../src/auth/machine.ts';
import { canonicalJson } from '../src/journal/canonical.ts';
import { mutate } from '../src/journal/mutation.ts';
import type { Actor, Db, Id, Tx } from '../src/platform/contracts.ts';
import { ApiError } from '../src/platform/errors.ts';
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

type RequestFor = (
  tx: Tx,
  operationId: Id,
) => Promise<OperationRequest | { action: string; payload: unknown }>;
type RunFixtureOptions = {
  workflow?: 'superpowers' | 'bmad';
  admission?: 'none' | { receiptStatus: 'FAIL' };
  actions?: OrchestrationAction[];
  tools?: string[];
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
    ${db.json(options.actions ?? ['create_ticket', 'dependency'])},${db.json(options.tools ?? ['create_run'])},${snapshotId},
    ${'a'.repeat(64)},${randomUUID()},clock_timestamp()+interval '60 seconds')`;
  const resolver = createPersistedAssistantActorResolver({ verifierBuildSha256: fixtureVerifierBuildSha256 });
  const port = createProjectOrchestrationPort({ resolver });
  const runs = createWorkflowRuns({ port, resolver });
  // The tools route stand-in: a pending operation row written in the same Tx as the call,
  // carrying the request hash the transport computes for it.
  const inTurn = async <T>(
    request: RequestFor,
    work: (tx: Tx, proof: OrchestrationProof) => Promise<T>,
    proofScopeId: Id = scopeId,
  ): Promise<T> => {
    const result = await mutate(
      db,
      { actor: a, route: 'test-only:assistant-create-run', key: randomUUID(), body: {} },
      async (tx) => {
        const operationId = randomUUID();
        await f.seedToolOperation(tx, {
          turnId: fence.turnId,
          snapshotId,
          operationId,
          request: await request(tx, operationId),
        });
        return {
          status: 201,
          body: { value: (await work(tx, { fence, scopeId: proofScopeId, operationId })) as unknown },
        };
      },
    );
    return result.body.value as T;
  };
  const runInput = (input: Partial<CreateRunInput> = {}): CreateRunInput => ({
    rootTicketId: root.id,
    path: options.workflow === 'bmad' ? 'bmad-dispatch' : 'architectural',
    definitionSha256: options.workflow === 'bmad' ? bmadHash : superpowersHash,
    ...input,
  });
  const create = (
    input: Partial<CreateRunInput> = {},
    opts: { request?: RequestFor; runs?: typeof runs } = {},
  ) =>
    inTurn(
      opts.request ?? ((tx, operationId) => runs.createRunRequest(tx, operationId, runInput(input))),
      (tx, proof) => (opts.runs ?? runs).createRun(tx, proof, runInput(input)),
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
    resolver,
    port,
    inTurn,
    runInput,
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

// Independent oracle: the pinned archives themselves. Cited lines are read from the exact
// fixture bytes the definition was built from, never from the mapping under test.
const archives = {
  superpowers: {
    file: fileURLToPath(
      new URL('../../gateway/test/fixtures/workflows/superpowers-6.4.2.tgz', import.meta.url),
    ),
    prefix: 'superpowers-8ca22dba9a94f28898bbce59f2537ff4d87c747d/',
  },
  bmad: {
    file: fileURLToPath(new URL('../../gateway/test/fixtures/workflows/bmad-6.12.0.tgz', import.meta.url)),
    prefix: 'package/',
  },
};
const sourceCache = new Map<string, string[]>();
function sourceLines(path: string): string[] {
  const cached = sourceCache.get(path);
  if (cached) return cached;
  const archive = path.startsWith('skills/') ? archives.superpowers : archives.bmad;
  const text = execFileSync('tar', ['-xzOf', archive.file, `${archive.prefix}${path}`], { encoding: 'utf8' });
  const lines = text.split('\n');
  sourceCache.set(path, lines);
  return lines;
}
/** Text of every cited range; each range must exist in the pinned file. */
function cited(citation: string): string {
  const parts: string[] = [];
  for (const reference of citation.split('; ')) {
    const match = /^([^:]+):([0-9,-]+)$/.exec(reference);
    assert.ok(match, `citation ${reference}`);
    const lines = sourceLines(match[1] as string);
    for (const range of (match[2] as string).split(',')) {
      const [from, to = from] = range.split('-').map(Number) as [number, number?];
      assert.ok(
        from >= 1 && (to as number) >= from && (to as number) <= lines.length,
        `${reference} out of range`,
      );
      parts.push(lines.slice(from - 1, to).join('\n'));
    }
  }
  return parts.join('\n');
}
// What each gate kind must literally be in its cited source lines.
const gateMarkers: Record<string, RegExp> = {
  design_approval: /User approves design\?|approves the short in-chat design/,
  spec_approval: /User Review Gate|CHECKPOINT 1/,
  plan_approval_execution_method: /Which execution approach/,
  architecture_discussion: /If 3\+ Fixes Failed/,
  probe_approval: /approves the question and probe/,
};
type StepCriteria = {
  stepKey: string;
  citation: string;
  sourcePath: string;
  gates: { id: Id; kind: string; requiredActor: string; trigger: string; citation: string }[];
  executionChoices?: { method: string; skill: string; sourcePath: string; sourceSha256: string }[];
  resolvedByGateId?: Id;
};
function assertCitations(run: WorkflowRun, criteria: StepCriteria[]) {
  for (const [index, step] of run.steps.entries()) {
    const item = criteria[index] as StepCriteria;
    assert.equal(item.sourcePath, step.sourcePath);
    assert.ok(cited(item.citation).length > 0);
    for (const gate of item.gates) {
      const marker = gateMarkers[gate.kind];
      assert.ok(marker, `gate ${gate.kind} has no source marker`);
      assert.match(cited(gate.citation), marker, `${gate.kind} citation`);
      assert.equal(gate.requiredActor, 'owner');
    }
  }
}
const isChain = (run: WorkflowRun) =>
  run.steps.every((step, index) =>
    index === 0
      ? step.predecessorIds.length === 0
      : step.predecessorIds.length === 1 && step.predecessorIds[0] === run.steps[index - 1]?.id,
  );
const skillsIn = (text: string) => [...text.matchAll(/superpowers:([a-z-]+)/g)].map((match) => match[1]);
const requiredSubSkills = (path: string) =>
  sourceLines(path)
    .filter((line) => line.includes('REQUIRED SUB-SKILL'))
    .flatMap(skillsIn);

test('assistant workflows: definition not proven on machine B is 422 without rows', async () =>
  withDatabase(async (db) => {
    const f = await runFixture(db);
    try {
      const before = await f.rows();
      const unknown = f.runInput({ definitionSha256: 'f'.repeat(64) });
      await assert.rejects(
        () =>
          f.create(
            { definitionSha256: 'f'.repeat(64) },
            {
              request: async () => ({
                action: 'create_run',
                payload: { ...unknown, graphSha256: '0'.repeat(64) },
              }),
            },
          ),
        { code: 'WORKFLOW_DEFINITION_UNKNOWN', status: 422 },
      );
      const fixed = {
        request: async () => ({
          action: 'create_run',
          payload: { ...f.runInput(), graphSha256: '0'.repeat(64) },
        }),
      };
      // Same hash reported by another machine only.
      await f.seedApplied(
        f.boundB.id,
        workflowStatus((status) => {
          status.superpowers.projections.claude = missingSlot;
        }),
      );
      await f.seedApplied(f.otherC.id, workflowStatus());
      await assert.rejects(() => f.create({}, fixed), { code: 'WORKFLOW_DEFINITION_UNKNOWN', status: 422 });
      // Slot not current, even though the definition bytes are present.
      await f.seedApplied(
        f.boundB.id,
        workflowStatus((status) => {
          status.superpowers.projections.claude.state = 'mismatch';
        }),
      );
      await assert.rejects(() => f.create({}, fixed), { code: 'WORKFLOW_DEFINITION_UNKNOWN', status: 422 });
      // Stored digest no longer recomputes over the slot pins and skills.
      await f.seedApplied(
        f.boundB.id,
        workflowStatus((status) => {
          status.superpowers.projections.claude.definition?.skills.pop();
        }),
      );
      await assert.rejects(() => f.create({}, fixed), { code: 'WORKFLOW_DEFINITION_UNKNOWN', status: 422 });
      // A BMAD definition cannot drive a Superpowers path.
      await f.seedApplied(f.boundB.id, workflowStatus());
      await assert.rejects(
        () =>
          f.create(
            { definitionSha256: bmadHash },
            {
              request: async () => ({
                action: 'create_run',
                payload: { ...f.runInput({ definitionSha256: bmadHash }), graphSha256: '0'.repeat(64) },
              }),
            },
          ),
        { code: 'WORKFLOW_PATH_MISMATCH', status: 422 },
      );
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

test('assistant workflows: createRun accepts only the operation written for this exact run request', async () =>
  withDatabase(async (db) => {
    const f = await runFixture(db);
    try {
      const before = await f.rows();
      const denied = { code: 'ORCHESTRATION_REQUEST_MISMATCH', status: 403 };
      const input = inputTicket(f.project.id, 'step', f.root.id);
      // An operation written for another tool or for a single mutation.
      await assert.rejects(
        () =>
          f.create({}, { request: async () => ({ action: 'read_docs', payload: { path: 'README.md' } }) }),
        denied,
      );
      await assert.rejects(
        () => f.create({}, { request: async () => ({ action: 'create_ticket', payload: input }) }),
        denied,
      );
      // A create_run operation for another path, or carrying a caller-chosen graph digest.
      await assert.rejects(
        () =>
          f.create(
            {},
            {
              request: (tx, operationId) =>
                f.runs.createRunRequest(tx, operationId, f.runInput({ path: 'bounded' })),
            },
          ),
        denied,
      );
      await assert.rejects(
        () =>
          f.create(
            {},
            {
              request: async () => ({
                action: 'create_run',
                payload: { ...f.runInput(), graphSha256: 'a'.repeat(64) },
              }),
            },
          ),
        denied,
      );
      // The digest is derived from this operation: another operation's request does not fit.
      await assert.rejects(
        () => f.create({}, { request: (tx) => f.runs.createRunRequest(tx, randomUUID(), f.runInput()) }),
        denied,
      );
      assert.deepEqual(await f.rows(), before);
      const run = await f.create();
      assert.equal(run.path, 'architectural');
    } finally {
      await f.close();
    }
  }));

test('assistant workflows: architectural path follows the pinned brainstorming → writing-plans → execution chain', async () =>
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
      const criteria = (await assertGraph(db, f, run)) as StepCriteria[];
      assertCitations(run, criteria);
      for (const step of run.steps) assert.equal(step.sourceSha256, skillSha('superpowers', step.sourcePath));
      assert.ok(isChain(run), 'mặc định tuần tự: mỗi bước chỉ chờ bước trước');
      // brainstorming: design sections, then written spec; its only exit is writing-plans.
      const exit = /Invoke the ([a-z-]+) skill/.exec(sourceLines('skills/brainstorming/SKILL.md').join('\n'));
      assert.deepEqual(
        run.steps.slice(0, 3).map((step) => step.skill),
        ['brainstorming', 'brainstorming', exit?.[1]],
      );
      assert.deepEqual(
        criteria.slice(0, 3).map((item) => item.gates.map((gate) => gate.kind)),
        [['design_approval'], ['spec_approval'], ['plan_approval_execution_method']],
      );
      // Execution: the owner picks one of writing-plans' REQUIRED SUB-SKILLs at the plan gate.
      const execution = criteria[3] as StepCriteria;
      const choices = requiredSubSkills('skills/writing-plans/SKILL.md');
      assert.deepEqual([...new Set(choices)], ['subagent-driven-development', 'executing-plans']);
      assert.deepEqual(
        execution.executionChoices?.map((choice) => choice.skill),
        [...new Set(choices)],
      );
      for (const choice of execution.executionChoices ?? []) {
        assert.equal(choice.sourcePath, `skills/${choice.skill}/SKILL.md`);
        assert.equal(choice.sourceSha256, skillSha('superpowers', choice.sourcePath));
      }
      assert.equal(execution.resolvedByGateId, criteria[2]?.gates[0]?.id);
      assert.equal(run.steps[3]?.sourcePath, 'skills/writing-plans/SKILL.md');
      assert.equal(run.steps[3]?.role, 'implement');
      // Both execution skills hand off to the same finishing skill; it is the last step.
      const finishing = new Set(
        ['skills/subagent-driven-development/SKILL.md', 'skills/executing-plans/SKILL.md'].flatMap((path) =>
          sourceLines(path)
            .filter((line) => /Final review clean.*->/.test(line))
            .flatMap(skillsIn),
        ),
      );
      assert.deepEqual([...finishing], ['finishing-a-development-branch']);
      assert.equal(run.steps.length, 5);
      assert.equal(run.steps[4]?.skill, 'finishing-a-development-branch');
      assert.equal(run.steps[4]?.sourcePath, 'skills/finishing-a-development-branch/SKILL.md');
      assert.ok(!run.steps.some((step) => step.skill === 'test-driven-development'));
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

test('assistant workflows: bounded, bug and spike paths map their pinned sources', async () => {
  for (const path of ['bounded', 'bug', 'spike'] as const)
    await withDatabase(async (db) => {
      const f = await runFixture(db);
      try {
        const run = await f.create({ path });
        const criteria = (await assertGraph(db, f, run)) as StepCriteria[];
        assertCitations(run, criteria);
        assert.ok(isChain(run), path);
        assert.equal(
          run.steps[0]?.sourcePath,
          path === 'bug' ? 'skills/systematic-debugging/SKILL.md' : 'skills/brainstorming/SKILL.md',
        );
        for (const step of run.steps)
          assert.equal(step.sourceSha256, skillSha('superpowers', step.sourcePath));
        const kinds =
          await db`select id,kind,outputs from tickets where id in ${db(run.steps.map((step) => step.ticketId))}`;
        if (path === 'bounded') {
          // brainstorming:127 — bounded implements through the normal workflow, TDD applies, no plan.
          assert.match(
            cited(criteria[0]?.citation as string),
            /approves the short in-chat design|short design/,
          );
          assert.match(sourceLines('skills/brainstorming/SKILL.md')[126] as string, /TDD applies/);
          assert.equal(run.steps[1]?.sourcePath, 'skills/test-driven-development/SKILL.md');
          assert.ok(!run.steps.some((step) => step.skill === 'writing-plans'));
          assert.deepEqual(
            criteria.map((item) => item.gates.map((gate) => gate.kind)),
            [['design_approval'], [], [], []],
          );
        }
        if (path === 'bug') {
          // The four phases in order, each step citing its own phase heading.
          const phases = criteria.slice(0, 4).map((item) => /### Phase (\d)/.exec(cited(item.citation))?.[1]);
          assert.deepEqual(phases, ['1', '2', '3', '4']);
          const fix = criteria[3] as StepCriteria;
          assert.deepEqual(
            fix.gates.map((gate) => [gate.kind, gate.trigger]),
            [['architecture_discussion', 'after_three_failed_fixes']],
          );
          for (const item of criteria.filter((entry) => entry !== fix))
            for (const gate of item.gates) assert.equal(gate.trigger, 'on_stage');
        }
        if (path === 'spike') {
          // A spike answers a question: research tickets, no code output, no spec or plan.
          assert.match(cited(criteria[0]?.citation as string), /Present question \+ probe/);
          assert.deepEqual(
            [...new Set(kinds.map((row) => row.kind))],
            ['research'],
            'spike không hoàn tất mã sản phẩm',
          );
          for (const step of run.steps) {
            assert.equal(step.role, 'research');
            assert.ok(
              !step.outputKinds.includes('code') && !step.outputKinds.includes('test'),
              step.outputKinds.join(),
            );
          }
          for (const row of kinds) assert.ok(!(row.outputs.kinds as string[]).includes('code'));
          assert.deepEqual(
            criteria.map((item) => item.gates.map((gate) => gate.kind)),
            [['probe_approval'], []],
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
    state?: 'active' | 'uncertain';
    data?: Record<string, unknown>;
    kind?: string;
  },
  run: WorkflowRun,
) {
  const commandId = randomUUID(),
    attemptId = randomUUID(),
    evidenceId = randomUUID();
  const [existing] =
    await db`select id from attempts where ticket_id=${input.ticketId} and state in ('active','uncertain')`;
  const attempt = existing?.id ?? attemptId;
  if (!existing) {
    await db`insert into commands(id,machine_id,ticket_id,binding_revision,type,payload,state)
      values(${commandId},${input.machineId},${input.ticketId},${input.bindingRevision ?? 2},'start','{}','received')`;
    await db`insert into attempts(id,ticket_id,machine_id,command_id,fence,binding_revision,process_instance_id,state,lease_expires_at,workflow_pin)
      values(${attemptId},${input.ticketId},${input.machineId},${commandId},1,${input.bindingRevision ?? 2},${randomUUID()},
      ${input.state ?? 'active'},now()+interval '60 seconds','{}')`;
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

// Official step chain of bmad-build: FIRST STEP of workflow.md, then each step's NEXT link.
function bmadChain(): string[] {
  const dir = 'src/bmm-skills/ship/bmad-build/';
  const link = /\[\[bmad-snapshot:([a-z0-9-]+\.md)\]\]/;
  const first = sourceLines(`${dir}workflow.md`).join('\n').split('## FIRST STEP')[1] ?? '';
  const chain: string[] = [];
  let next = link.exec(first)?.[1];
  while (next && !chain.includes(next)) {
    chain.push(next);
    const tail = sourceLines(`${dir}${next}`).join('\n').split('## NEXT')[1];
    next = tail ? link.exec(tail)?.[1] : undefined;
  }
  return chain;
}

test('assistant workflows: bmad-dispatch run waits for a verified render latch', async () =>
  withDatabase(async (db) => {
    const f = await runFixture(db, { workflow: 'bmad' });
    try {
      const run = await f.create();
      const criteria = (await assertGraph(db, f, run)) as StepCriteria[];
      assertCitations(run, criteria);
      assert.deepEqual(
        run.steps.map((step) => step.sourcePath),
        bmadChain().map((name) => `.claude/skills/bmad-build/${name}`),
      );
      assert.deepEqual(
        criteria.map((item) => item.gates.map((gate) => gate.kind)),
        [[], ['spec_approval'], [], [], []],
      );
      for (const step of run.steps) assert.equal(step.sourceSha256, skillSha('bmad', step.sourcePath));
      assert.ok(isChain(run));
      assert.equal(run.renderedArtifactId, null);
      assert.deepEqual(run.projection, vector.bmad.projection);
      const [first, second, third, fourth] = run.steps;
      const latch = (evidenceId: Id) =>
        db.begin((tx) => f.runs.latchRenderedArtifact(tx, run.id, evidenceId));
      const conflict = { code: 'WORKFLOW_RENDER_RECEIPT_INVALID', status: 409 };
      const good = { ticketId: first?.ticketId as Id, machineId: f.boundB.id };
      const denied: Id[] = [];
      // Attempt by a machine other than the current binding.
      denied.push(await seedReceipt(db, { ticketId: second?.ticketId as Id, machineId: f.otherC.id }, run));
      // Attempt under an older binding revision of the same machine.
      denied.push(
        await seedReceipt(
          db,
          { ticketId: third?.ticketId as Id, machineId: f.boundB.id, bindingRevision: 1 },
          run,
        ),
      );
      // Attempt that is no longer active.
      denied.push(
        await seedReceipt(
          db,
          { ticketId: fourth?.ticketId as Id, machineId: f.boundB.id, state: 'uncertain' },
          run,
        ),
      );
      // Attempt on a ticket outside this run.
      denied.push(await seedReceipt(db, { ticketId: f.a.id, machineId: f.boundB.id }, run));
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
      const criteria = (await assertGraph(db, f, run)) as StepCriteria[];
      assertCitations(run, criteria);
      // step-02's early exit for the oneshot route.
      const plan = sourceLines('src/bmm-skills/ship/bmad-build/step-02-plan.md');
      const exit = plan.find((line) => line.includes("route: 'oneshot'") && line.includes('EARLY EXIT'));
      const oneshot = /\[\[bmad-snapshot:([a-z0-9-]+\.md)\]\]/.exec(
        (exit ?? '').split('EARLY EXIT')[1] ?? '',
      )?.[1];
      const [first, second] = bmadChain();
      assert.deepEqual(
        run.steps.map((step) => step.sourcePath),
        [first, second, oneshot].map((name) => `.claude/skills/bmad-build/${name}`),
      );
      assert.deepEqual(
        criteria.map((item) => item.gates.length),
        [0, 0, 0],
      );
      assert.equal(run.renderedArtifactId, null);
      // A Superpowers path cannot use the BMAD definition.
      await assert.rejects(
        () =>
          f.create(
            { path: 'bounded' },
            {
              request: async () => ({
                action: 'create_run',
                payload: { ...f.runInput({ path: 'bounded' }), graphSha256: '0'.repeat(64) },
              }),
            },
          ),
        { status: 422 },
      );
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

test('assistant workflows: createRun is all-or-nothing when a later write fails', async () =>
  withDatabase(async (db) => {
    const f = await runFixture(db);
    try {
      const before = await f.rows();
      const marker = randomUUID();
      // The caller keeps using its transaction after createRun fails, then commits.
      const attempt = (runs: typeof f.runs, request?: RequestFor) =>
        f.inTurn(
          request ??
            ((tx, operationId) => f.runs.createRunRequest(tx, operationId, f.runInput({ path: 'bounded' }))),
          async (tx, proof) => {
            let code: unknown = null;
            try {
              await runs.createRun(tx, proof, f.runInput({ path: 'bounded' }));
            } catch (error) {
              code = `${String((error as { code?: unknown }).code)}:${(error as Error).message}`;
            }
            await tx`insert into evidence(id,ticket_id,attempt_id,kind,data)
              values(${randomUUID()},${f.root.id},null,'test_marker',${tx.json({ marker })})`;
            return code;
          },
        );
      // JS error from the port after the run row and the first tickets exist.
      const failingPort: WorkflowOrchestrationPort = {
        ...f.port,
        async authorizeGraph(tx, actor, proof, request, graph) {
          const session = await f.port.authorizeGraph(tx, actor, proof, request, graph);
          return {
            createTicket: (t, key, input) => session.createTicket(t, key, input),
            dependency: async () => {
              throw new ApiError('INJECTED_PORT_FAILURE', 409, 'Lỗi tiêm cho kiểm thử');
            },
            close: (t) => session.close(t),
          };
        },
      };
      const injected = createWorkflowRuns({ port: failingPort, resolver: f.resolver });
      assert.match(String(await attempt(injected)), /^INJECTED_PORT_FAILURE:/);
      // Database error after the run row exists (test-only trigger on the step table).
      await db`create function test_only_fail_step() returns trigger language plpgsql as $$
        begin if NEW.skill='requesting-code-review' then raise exception 'TEST_ONLY_STEP_FAILURE'; end if; return NEW; end $$`;
      await db`create trigger test_only_fail_step before insert on workflow_steps for each row execute function test_only_fail_step()`;
      try {
        assert.match(String(await attempt(f.runs)), /TEST_ONLY_STEP_FAILURE/);
      } finally {
        await db`drop trigger test_only_fail_step on workflow_steps`;
        await db`drop function test_only_fail_step()`;
      }
      // Both callers committed their own marker; createRun left nothing behind.
      assert.equal(
        (await db`select 1 from evidence where kind='test_marker' and data->>'marker'=${marker}`).length,
        2,
      );
      assert.deepEqual(await f.rows(), before);
      // The same root still accepts a complete run afterwards.
      const run = await f.create({ path: 'bounded' });
      assert.equal(run.steps.length, 4);
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

test('assistant workflows: parallel needs an exact owner approval of this root, sequential otherwise', async () =>
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
      // The same deny inside createRun itself: the operation row exists before the call, so
      // the denial cannot come from deriving the request.
      const fixedRequest = {
        request: async () => ({
          action: 'create_run',
          payload: { ...f.runInput({ path: 'bounded' }), graphSha256: '0'.repeat(64) },
        }),
      };
      await assert.rejects(() => f.create({ path: 'bounded' }, fixedRequest), {
        code: 'WORKFLOW_PARALLEL_APPROVAL_INVALID',
        status: 403,
      });
      await setParallelApproval(db, await insertDecision(db, f.root.id, owner, 'assessment', scope));
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
      await assert.rejects(() => f.create({ path: 'bounded' }, fixedRequest), {
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

test('assistant workflows: owner approval of another root leaves this run sequential', async () =>
  withDatabase(async (db) => {
    const f = await runFixture(db);
    try {
      // Owner approval for the fixture's other root; the global policy still points at it.
      const elsewhere = await insertDecision(db, f.request.id, owner, 'approval', {
        parallel: {
          rootTicketId: f.request.id,
          path: 'bounded',
          definitionSha256: superpowersHash,
          units: [
            { key: 'api', title: 'API', ownershipKeys: ['a.ts'] },
            { key: 'web', title: 'Web', ownershipKeys: ['b.tsx'] },
          ],
        },
      });
      await setParallelApproval(db, elsewhere);
      const run = await f.create({ path: 'bounded' });
      assert.equal(run.parallelApprovalId, null);
      assert.ok(isChain(run));
      assert.equal(run.steps.length, 4);
    } finally {
      await f.close();
    }
  }));

// Gates: owner questions on the reserved gates of a run and the owner's answers.

const textSha = (text: string) => createHash('sha256').update(text).digest('hex');
// The scope digests are a contract: domain tag plus the canonical context, recomputed here
// independently of gates.ts.
const gateScopeOracle = (context: Record<string, unknown>) =>
  createHash('sha256')
    .update(canonicalJson(['crew-v2:workflow-gate-scope:1', context]))
    .digest('hex');
const questionScopeOracle = (context: Record<string, unknown>) =>
  createHash('sha256')
    .update(canonicalJson(['crew-v2:owner-question-scope:1', context]))
    .digest('hex');

async function gateFixture(db: Db, options: RunFixtureOptions = {}) {
  const f = await runFixture(db, { ...options, tools: ['create_run', 'ask_owner'] });
  const gates = createWorkflowGates({ resolver: f.resolver });
  const [turn] = await db`select conversation_id from assistant_turns where id=${f.fence.turnId}`;
  const conversationId = String(turn?.conversation_id);
  // The tools route stand-in writes the pending `ask_owner` row for this exact proposal.
  const ask = (proposal: QuestionProposal, opts: { request?: RequestFor; scopeId?: Id } = {}) =>
    f.inTurn(
      opts.request ?? (async () => ({ action: 'ask_owner', payload: proposal })),
      (tx, proof) => gates.createOwnerQuestion(tx, proof, proposal),
      opts.scopeId,
    );
  const answer = (actor: Actor, input: RecordGateAnswerInput) =>
    f.mutation(randomUUID(), (tx) => gates.recordGateAnswer(tx, actor, input));
  const advance = (questionId: Id, decisionId: Id) =>
    f.mutation(randomUUID(), async (tx) => {
      await gates.answerGate(tx, questionId, decisionId);
      return null;
    });
  // Artifact evidence as an attempt registers it: a finished attempt of `machineId` on the
  // step ticket under the given binding revision (current binding: B, revision 2).
  const artifact = async (
    ticketId: Id,
    sha256: string,
    opts: { machineId?: Id; bindingRevision?: number; kind?: string } = {},
  ) => {
    const machineId = opts.machineId ?? f.boundB.id;
    const bindingRevision = opts.bindingRevision ?? 2;
    const commandId = randomUUID(),
      attemptId = randomUUID(),
      evidenceId = randomUUID();
    await db`insert into commands(id,machine_id,ticket_id,binding_revision,type,payload,state)
      values(${commandId},${machineId},${ticketId},${bindingRevision},'start','{}','completed')`;
    await db`insert into attempts(id,ticket_id,machine_id,command_id,fence,binding_revision,process_instance_id,state,
      lease_expires_at,workflow_pin,stopped_at,stop_reason,finalized_at)
      values(${attemptId},${ticketId},${machineId},${commandId},
      (select coalesce(max(fence),0)+1 from attempts where ticket_id=${ticketId}),${bindingRevision},${randomUUID()},
      'stopped',now(),'{}',now(),'exit',now())`;
    await db`insert into evidence(id,ticket_id,attempt_id,kind,data)
      values(${evidenceId},${ticketId},${attemptId},${opts.kind ?? 'artifact'},
      ${db.json({ locator: 'docs/plans/artifact.md', sha256, sourceCommit: null, verification: 'reported' })})`;
    return evidenceId;
  };
  const gateRows = async () => ({
    gates: await db`select * from workflow_gates order by id`,
    questions: await db`select * from assistant_questions order by id`,
    answers: await db`select * from assistant_answers order by id`,
    decisions: await db`select * from decisions order by id`,
  });
  return { ...f, gates, conversationId, ask, answer, advance, artifact, gateRows };
}
type GateFixture = Awaited<ReturnType<typeof gateFixture>>;
type GateTarget = {
  step: number;
  gate?: number;
  kind: string;
  trigger?: 'on_stage' | 'after_three_failed_fixes';
  artifactSha256: string;
  cycleId?: Id | null;
};

/** Exact gate context the server must recompute from the persisted run, step and definition. */
function gateContext(run: WorkflowRun, target: GateTarget) {
  const step = run.steps[target.step];
  assert.ok(step);
  return {
    rootTicketId: run.rootTicketId,
    runId: run.id,
    stepId: step.id,
    gateId: step.gateIds[target.gate ?? 0],
    kind: target.kind,
    requiredActor: 'owner',
    trigger: target.trigger ?? 'on_stage',
    sourcePath: step.sourcePath,
    sourceSha256: step.sourceSha256,
    artifactSha256: target.artifactSha256,
    cycleId: target.cycleId ?? null,
    definitionSha256: run.definitionSha256,
    customizationSha256: run.customizationSha256,
    renderedArtifactId: run.renderedArtifactId,
  };
}
function gateProposal(
  f: GateFixture,
  run: WorkflowRun,
  target: GateTarget,
  extra: Partial<QuestionProposal> = {},
): QuestionProposal {
  const context = gateContext(run, target);
  return {
    conversationId: f.conversationId,
    ticketId: run.steps[target.step]?.ticketId as Id,
    runId: run.id,
    stepId: context.stepId,
    gateId: context.gateId as Id,
    cycleId: context.cycleId,
    artifactSha256: target.artifactSha256,
    question: 'Chủ dự án duyệt artifact này?',
    options: ['Duyệt', 'Yêu cầu sửa'],
    scopeSha256: gateScopeOracle(context),
    ...extra,
  };
}
const approve = (extra: Partial<GateAnswer> = {}): GateAnswer => ({
  verdict: 'approve',
  option: 'Duyệt',
  executionMethod: null,
  parallel: null,
  text: 'Đồng ý với artifact này',
  ...extra,
});
const independentUnits = () => ({
  units: [
    { key: 'api', title: 'API', ownershipKeys: ['v2/server/src/a.ts'], dependsOn: [] as string[] },
    { key: 'web', title: 'Web', ownershipKeys: ['v2/web/src/b.tsx'], dependsOn: [] as string[] },
  ],
  sharedInputSha256: [textSha('plan v1')],
});
const designTarget = (artifactSha256: string): GateTarget => ({
  step: 0,
  kind: 'design_approval',
  artifactSha256,
});

test('assistant gates: a gate without a verified artifact has no row; the artifact materializes the gate, then its question', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const [design, spec] = run.steps;
      assert.ok(design && spec);
      const designSha = textSha('design v1');
      const proposal = gateProposal(f, run, designTarget(designSha));
      const before = await f.gateRows();
      await assert.rejects(() => f.ask({ ...proposal, artifactSha256: null }), {
        code: 'WORKFLOW_ARTIFACT_REQUIRED',
        status: 409,
      });
      await assert.rejects(() => f.ask(proposal), { code: 'WORKFLOW_ARTIFACT_UNVERIFIED', status: 409 });
      // Same bytes reported by another machine, under an older binding, on another step, or
      // as another evidence kind are no verified artifact of this gate.
      await f.artifact(design.ticketId, designSha, { machineId: f.otherC.id });
      await f.artifact(design.ticketId, designSha, { bindingRevision: 1 });
      await f.artifact(spec.ticketId, designSha);
      await f.artifact(design.ticketId, designSha, { kind: 'review_result' });
      await assert.rejects(() => f.ask(proposal), { code: 'WORKFLOW_ARTIFACT_UNVERIFIED', status: 409 });
      assert.deepEqual(await f.gateRows(), before);
      await f.artifact(design.ticketId, designSha);
      await assert.rejects(() => f.ask({ ...proposal, scopeSha256: 'f'.repeat(64) }), {
        code: 'WORKFLOW_QUESTION_SCOPE_MISMATCH',
        status: 409,
      });
      await assert.rejects(() => f.ask({ ...proposal, gateId: randomUUID() }), {
        code: 'WORKFLOW_GATE_UNKNOWN',
        status: 409,
      });
      // The spec gate is reserved on another step.
      await assert.rejects(() => f.ask({ ...proposal, gateId: spec.gateIds[0] as Id }), {
        code: 'WORKFLOW_GATE_UNKNOWN',
        status: 409,
      });
      await assert.rejects(() => f.ask({ ...proposal, ticketId: spec.ticketId }), {
        code: 'WORKFLOW_GATE_UNKNOWN',
        status: 409,
      });
      // An on-stage gate has no repair cycle.
      await assert.rejects(() => f.ask({ ...proposal, cycleId: randomUUID() }), {
        code: 'VALIDATION',
        status: 400,
      });
      assert.deepEqual(await f.gateRows(), before);
      const question = await f.ask(proposal);
      assert.deepEqual(question, { id: question.id, ...proposal, revision: 1, state: 'open' });
      const gates = await db`select * from workflow_gates where run_id=${run.id}`;
      assert.equal(gates.length, 1);
      assert.deepEqual(
        { ...gates[0] },
        {
          id: design.gateIds[0],
          run_id: run.id,
          step_id: design.id,
          kind: 'design_approval',
          source_path: design.sourcePath,
          source_sha256: design.sourceSha256,
          artifact_sha256: designSha,
          scope_sha256: proposal.scopeSha256,
          required_actor: 'owner',
          decision_id: null,
          state: 'pending',
        },
      );
      const [stored] = await db`select * from assistant_questions where id=${question.id}`;
      assert.deepEqual(
        { ...stored },
        {
          id: question.id,
          conversation_id: f.conversationId,
          ticket_id: design.ticketId,
          run_id: run.id,
          step_id: design.id,
          gate_id: design.gateIds[0],
          cycle_id: null,
          artifact_sha256: designSha,
          question: proposal.question,
          options: proposal.options,
          scope_sha256: proposal.scopeSha256,
          revision: 1,
          state: 'open',
        },
      );
      const updates = [
        () =>
          db`update workflow_gates set artifact_sha256=${'1'.repeat(64)} where id=${design.gateIds[0] as Id}`,
        () =>
          db`update workflow_gates set scope_sha256=${'1'.repeat(64)} where id=${design.gateIds[0] as Id}`,
        () => db`update assistant_questions set revision=2 where id=${question.id}`,
        () => db`update assistant_questions set scope_sha256=${'1'.repeat(64)} where id=${question.id}`,
        () => db`delete from workflow_gates where id=${design.gateIds[0] as Id}`,
      ];
      for (const update of updates) await assert.rejects(update, /ASSISTANT_RECORD_IMMUTABLE/);
    } finally {
      await f.close();
    }
  }));

test('assistant gates: ask_owner needs its own pending operation for this exact proposal, turn and scope', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const designSha = textSha('design v1');
      await f.artifact(run.steps[0]?.ticketId as Id, designSha);
      const proposal = gateProposal(f, run, designTarget(designSha));
      const before = await f.gateRows();
      await assert.rejects(
        () =>
          f.ask(proposal, {
            request: async () => ({ action: 'ask_owner', payload: { ...proposal, question: 'Câu khác' } }),
          }),
        { code: 'ORCHESTRATION_REQUEST_MISMATCH', status: 403 },
      );
      await assert.rejects(
        () => f.ask(proposal, { request: async () => ({ action: 'create_run', payload: proposal }) }),
        { code: 'ORCHESTRATION_REQUEST_MISMATCH', status: 403 },
      );
      // A scope of the same turn without the ask_owner tool.
      const narrow = randomUUID();
      await db`insert into assistant_scopes(id,turn_id,root_ticket_id,message_id,project_id,actions,tool_names,
        input_snapshot_id,scope_sha256,owner_authorization_id,expires_at)
        values(${narrow},${f.fence.turnId},${f.root.id},null,${f.project.id},${db.json(['create_ticket'])},
        ${db.json(['create_run'])},${f.snapshotId},${'a'.repeat(64)},${randomUUID()},clock_timestamp()+interval '60 seconds')`;
      await assert.rejects(() => f.ask(proposal, { scopeId: narrow }), {
        code: 'ORCHESTRATION_ACTION_NOT_IN_SCOPE',
        status: 403,
      });
      // The question belongs to the conversation of the asking turn.
      const other = await f.submitMessage('Hội thoại khác');
      await assert.rejects(() => f.ask({ ...proposal, conversationId: other.conversation.id }), {
        code: 'WORKFLOW_QUESTION_SCOPE_MISMATCH',
        status: 409,
      });
      // A ticket under another root is outside the scope.
      const elsewhere: QuestionProposal = {
        conversationId: f.conversationId,
        ticketId: f.a.id,
        runId: null,
        stepId: null,
        gateId: null,
        cycleId: null,
        artifactSha256: null,
        question: 'Câu hỏi ngoài phạm vi',
        options: [],
        scopeSha256: questionScopeOracle({
          conversationId: f.conversationId,
          rootTicketId: f.request.id,
          ticketId: f.a.id,
          runId: null,
          stepId: null,
        }),
      };
      await assert.rejects(() => f.ask(elsewhere), { code: 'NOT_FOUND', status: 404 });
      // An operation committed by an earlier transaction is not this call's operation.
      const committed = await f.seedToolOperation(db, {
        turnId: f.fence.turnId,
        snapshotId: f.snapshotId,
        request: { action: 'ask_owner', payload: proposal },
      });
      await assert.rejects(
        () =>
          f.mutation(randomUUID(), (tx) =>
            f.gates.createOwnerQuestion(
              tx,
              { fence: f.fence, scopeId: f.scopeId, operationId: committed },
              proposal,
            ),
          ),
        { code: 'ASSISTANT_OPERATION_NOT_FOUND', status: 404 },
      );
      // One operation asks once.
      await assert.rejects(
        () =>
          f.inTurn(
            async () => ({ action: 'ask_owner', payload: proposal }),
            async (tx, proof) => {
              await f.gates.createOwnerQuestion(tx, proof, proposal);
              return f.gates.createOwnerQuestion(tx, proof, proposal);
            },
          ),
        { code: 'ASSISTANT_OPERATION_CONSUMED', status: 409 },
      );
      assert.deepEqual(await f.gateRows(), before);
      assert.equal((await f.ask(proposal)).revision, 1);
    } finally {
      await f.close();
    }
  }));

test('assistant gates: only the owner answers; a machine self-answer or another decision cannot advance the gate', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const design = run.steps[0];
      assert.ok(design);
      const designSha = textSha('design v1');
      await f.artifact(design.ticketId, designSha);
      const question = await f.ask(gateProposal(f, run, designTarget(designSha)));
      const input: RecordGateAnswerInput = {
        questionId: question.id,
        expectedRevision: 1,
        scopeSha256: question.scopeSha256,
        artifactSha256: designSha,
        answer: approve(),
      };
      const before = await f.gateRows();
      for (const actor of [f.assistantA, f.boundB])
        await assert.rejects(() => f.answer(actor, input), { code: 'OWNER_REQUIRED', status: 403 });
      assert.deepEqual(await f.gateRows(), before);
      const scope = {
        questionId: question.id,
        questionRevision: 1,
        gateId: question.gateId,
        runId: run.id,
        stepId: design.id,
        artifactSha256: designSha,
        scopeSha256: question.scopeSha256,
        verdict: 'approve',
      };
      // Decisions that are not the owner's approval cannot advance a mandatory owner gate.
      for (const [actor, kind] of [
        [f.assistantA, 'approval'],
        [f.assistantA, 'delegated'],
        [owner, 'owner_answer'],
      ] as const) {
        const decisionId = await insertDecision(db, design.ticketId, actor, kind, scope);
        await assert.rejects(() => f.advance(question.id, decisionId), {
          code: 'WORKFLOW_GATE_DECISION_INVALID',
          status: 403,
        });
      }
      // The owner's approval with the exact scope but without the recorded owner answer.
      const bare = await insertDecision(db, design.ticketId, owner, 'approval', scope);
      await assert.rejects(() => f.advance(question.id, bare), {
        code: 'WORKFLOW_ANSWER_REQUIRED',
        status: 403,
      });
      const after = await f.gateRows();
      assert.deepEqual(
        { gates: after.gates, questions: after.questions, answers: after.answers },
        { gates: before.gates, questions: before.questions, answers: before.answers },
      );
    } finally {
      await f.close();
    }
  }));

test('assistant gates: the exact owner answer advances the gate once; stale inputs and replay are 409', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const design = run.steps[0];
      assert.ok(design);
      const designSha = textSha('design v1');
      await f.artifact(design.ticketId, designSha);
      const proposal = gateProposal(f, run, designTarget(designSha));
      const question = await f.ask(proposal);
      const input: RecordGateAnswerInput = {
        questionId: question.id,
        expectedRevision: 1,
        scopeSha256: question.scopeSha256,
        artifactSha256: designSha,
        answer: approve(),
      };
      const before = await f.gateRows();
      await assert.rejects(() => f.answer(owner, { ...input, expectedRevision: 2 }), {
        code: 'WORKFLOW_QUESTION_STALE',
        status: 409,
      });
      await assert.rejects(() => f.answer(owner, { ...input, scopeSha256: 'e'.repeat(64) }), {
        code: 'WORKFLOW_QUESTION_SCOPE_MISMATCH',
        status: 409,
      });
      await assert.rejects(() => f.answer(owner, { ...input, artifactSha256: textSha('design v2') }), {
        code: 'WORKFLOW_GATE_ARTIFACT_MISMATCH',
        status: 409,
      });
      await assert.rejects(() => f.answer(owner, { ...input, answer: approve({ option: 'Không có' }) }), {
        code: 'VALIDATION',
        status: 400,
      });
      await assert.rejects(() => f.answer(owner, { ...input, answer: approve({ verdict: 'answer' }) }), {
        code: 'VALIDATION',
        status: 400,
      });
      // Execution method and parallel units belong to the plan gate only.
      await assert.rejects(
        () => f.answer(owner, { ...input, answer: approve({ executionMethod: 'native' }) }),
        { code: 'VALIDATION', status: 400 },
      );
      await assert.rejects(
        () => f.answer(owner, { ...input, answer: approve({ parallel: independentUnits() }) }),
        { code: 'WORKFLOW_PARALLEL_SCOPE_MISMATCH', status: 409 },
      );
      assert.deepEqual(await f.gateRows(), before);
      const result = await f.answer(owner, input);
      assert.deepEqual(result, {
        questionId: question.id,
        revision: 1,
        answerId: result.answerId,
        decisionId: result.decisionId,
        gateId: design.gateIds[0],
        gateState: 'approved',
      });
      const [gate] =
        await db`select state,decision_id from workflow_gates where id=${design.gateIds[0] as Id}`;
      assert.deepEqual({ ...gate }, { state: 'approved', decision_id: result.decisionId });
      const [asked] = await db`select state from assistant_questions where id=${question.id}`;
      assert.equal(asked?.state, 'answered');
      const [decision] =
        await db`select ticket_id,actor_kind,actor_id,kind,content,sources,scope from decisions where id=${result.decisionId}`;
      assert.deepEqual(
        { ...decision },
        {
          ticket_id: design.ticketId,
          actor_kind: 'owner',
          actor_id: 'owner',
          kind: 'approval',
          content: 'Đồng ý với artifact này',
          sources: [],
          scope: {
            questionId: question.id,
            questionRevision: 1,
            gateId: design.gateIds[0],
            runId: run.id,
            stepId: design.id,
            artifactSha256: designSha,
            scopeSha256: question.scopeSha256,
            verdict: 'approve',
          },
        },
      );
      const [answer] =
        await db`select question_id,question_revision,body,actor_kind,decision_id from assistant_answers where id=${result.answerId}`;
      assert.deepEqual(
        { ...answer },
        {
          question_id: question.id,
          question_revision: 1,
          body: approve(),
          actor_kind: 'owner',
          decision_id: result.decisionId,
        },
      );
      // Replay of the answer or of the gate advance changes nothing.
      const settled = await f.gateRows();
      await assert.rejects(() => f.answer(owner, input), { code: 'WORKFLOW_QUESTION_ANSWERED', status: 409 });
      await assert.rejects(() => f.advance(question.id, result.decisionId), {
        code: 'WORKFLOW_QUESTION_ANSWERED',
        status: 409,
      });
      assert.deepEqual(await f.gateRows(), settled);
      const other = await insertDecision(db, design.ticketId, owner, 'approval', {});
      await assert.rejects(
        () => db`update workflow_gates set decision_id=${other} where id=${design.gateIds[0] as Id}`,
        /ASSISTANT_RECORD_LATCHED/,
      );
      // An approved gate resumes at the next stage: the same gate is never asked again.
      await assert.rejects(() => f.ask(proposal), { code: 'WORKFLOW_GATE_DECIDED', status: 409 });
    } finally {
      await f.close();
    }
  }));

test('assistant gates: a superseding question makes the earlier revision stale; the gate keeps its artifact', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const design = run.steps[0];
      assert.ok(design);
      const designSha = textSha('design v1');
      await f.artifact(design.ticketId, designSha);
      const proposal = gateProposal(f, run, designTarget(designSha));
      const first = await f.ask(proposal);
      const second = await f.ask({ ...proposal, question: 'Duyệt thiết kế đã giải thích thêm?' });
      assert.equal(second.revision, 2);
      assert.equal(second.state, 'open');
      const [old] = await db`select state from assistant_questions where id=${first.id}`;
      assert.equal(old?.state, 'superseded');
      const input = (questionId: Id, expectedRevision: number): RecordGateAnswerInput => ({
        questionId,
        expectedRevision,
        scopeSha256: proposal.scopeSha256,
        artifactSha256: designSha,
        answer: {
          verdict: 'reject',
          option: 'Yêu cầu sửa',
          executionMethod: null,
          parallel: null,
          text: 'Cần tách phần dữ liệu',
        },
      });
      await assert.rejects(() => f.answer(owner, input(first.id, 1)), {
        code: 'WORKFLOW_QUESTION_STALE',
        status: 409,
      });
      await assert.rejects(() => f.answer(owner, input(second.id, 1)), {
        code: 'WORKFLOW_QUESTION_STALE',
        status: 409,
      });
      // A newer artifact cannot be approved through a gate pinned to the first one.
      const revisedSha = textSha('design v2');
      await f.artifact(design.ticketId, revisedSha);
      await assert.rejects(() => f.ask(gateProposal(f, run, designTarget(revisedSha))), {
        code: 'WORKFLOW_GATE_ARTIFACT_MISMATCH',
        status: 409,
      });
      const result = await f.answer(owner, input(second.id, 2));
      assert.equal(result.gateState, 'rejected');
      const [gate] =
        await db`select state,artifact_sha256 from workflow_gates where id=${design.gateIds[0] as Id}`;
      assert.deepEqual({ ...gate }, { state: 'rejected', artifact_sha256: designSha });
      const states = await db`select id,state from assistant_questions order by revision`;
      assert.deepEqual(
        states.map((row) => row.state),
        ['superseded', 'answered'],
      );
    } finally {
      await f.close();
    }
  }));

test('assistant gates: a changed definition blocks the answer and a failed write leaves no answer behind', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const design = run.steps[0];
      assert.ok(design);
      const designSha = textSha('design v1');
      await f.artifact(design.ticketId, designSha);
      const question = await f.ask(gateProposal(f, run, designTarget(designSha)));
      const input: RecordGateAnswerInput = {
        questionId: question.id,
        expectedRevision: 1,
        scopeSha256: question.scopeSha256,
        artifactSha256: designSha,
        answer: approve(),
      };
      const before = await f.gateRows();
      // Machine B now reports another customization for the same pins: the run's definition
      // is no longer current.
      await f.seedApplied(
        f.boundB.id,
        workflowStatus((status) => {
          const definition = status.superpowers.projections.claude.definition;
          assert.ok(definition);
          definition.customizationSha256 = 'e'.repeat(64);
        }),
      );
      await assert.rejects(() => f.answer(owner, input), { code: 'WORKFLOW_DEFINITION_STALE', status: 409 });
      assert.deepEqual(await f.gateRows(), before);
      await f.seedApplied(f.boundB.id, workflowStatus());
      // A database failure after the decision exists: nothing of the answer remains and the
      // caller's transaction stays usable.
      await db`create function test_only_fail_answer() returns trigger language plpgsql as $$
        begin raise exception 'TEST_ONLY_ANSWER_FAILURE'; end $$`;
      await db`create trigger test_only_fail_answer before insert on assistant_answers for each row execute function test_only_fail_answer()`;
      const marker = randomUUID();
      try {
        const code = await f.mutation(randomUUID(), async (tx) => {
          let failure: string | null = null;
          try {
            await f.gates.recordGateAnswer(tx, owner, input);
          } catch (error) {
            failure = (error as Error).message;
          }
          await tx`insert into evidence(id,ticket_id,attempt_id,kind,data)
            values(${randomUUID()},${f.root.id},null,'test_marker',${tx.json({ marker })})`;
          return failure;
        });
        assert.match(String(code), /TEST_ONLY_ANSWER_FAILURE/);
      } finally {
        await db`drop trigger test_only_fail_answer on assistant_answers`;
        await db`drop function test_only_fail_answer()`;
      }
      assert.equal(
        (await db`select 1 from evidence where kind='test_marker' and data->>'marker'=${marker}`).length,
        1,
      );
      assert.deepEqual(await f.gateRows(), before);
      assert.equal((await f.answer(owner, input)).gateState, 'approved');
    } finally {
      await f.close();
    }
  }));

test('assistant gates: the plan gate approval resolves one official execution choice against the run definition', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const plan = run.steps[2];
      const execute = run.steps[3];
      assert.ok(plan && execute);
      const planSha = textSha('plan v1');
      await f.artifact(plan.ticketId, planSha);
      const question = await f.ask(
        gateProposal(
          f,
          run,
          { step: 2, kind: 'plan_approval_execution_method', artifactSha256: planSha },
          { options: [] },
        ),
      );
      const input = (answer: Partial<GateAnswer>): RecordGateAnswerInput => ({
        questionId: question.id,
        expectedRevision: 1,
        scopeSha256: question.scopeSha256,
        artifactSha256: planSha,
        answer: approve({ option: null, text: 'Kế hoạch đã review', ...answer }),
      });
      const before = await f.gateRows();
      await assert.rejects(() => f.answer(owner, input({})), { code: 'VALIDATION', status: 400 });
      await assert.rejects(() => f.answer(owner, input({ executionMethod: 'turbo' })), {
        code: 'VALIDATION',
        status: 400,
      });
      // Parallel units after the written plan: disjoint, independent and with shared-input hashes.
      const overlapping = independentUnits();
      overlapping.units[1]?.ownershipKeys.push('v2/server/src/a.ts');
      await assert.rejects(
        () => f.answer(owner, input({ executionMethod: 'native', parallel: overlapping })),
        { code: 'WORKFLOW_PARALLEL_OWNERSHIP_CONFLICT', status: 409 },
      );
      const dependent = independentUnits();
      dependent.units[1]?.dependsOn.push('api');
      await assert.rejects(() => f.answer(owner, input({ executionMethod: 'native', parallel: dependent })), {
        code: 'WORKFLOW_PARALLEL_DEPENDENCY',
        status: 409,
      });
      await assert.rejects(
        () =>
          f.answer(
            owner,
            input({ executionMethod: 'native', parallel: { ...independentUnits(), sharedInputSha256: [] } }),
          ),
        { code: 'VALIDATION', status: 400 },
      );
      // The choice's source hash must still be the run definition's bytes.
      const [ticket] = await db`select criteria from tickets where id=${execute.ticketId}`;
      const tampered = structuredClone(ticket?.criteria);
      tampered.workflowRun.executionChoices[1].sourceSha256 = '0'.repeat(64);
      await db`update tickets set criteria=${db.json(tampered)} where id=${execute.ticketId}`;
      await assert.rejects(() => f.answer(owner, input({ executionMethod: 'native' })), {
        code: 'WORKFLOW_EXECUTION_CHOICE_INVALID',
        status: 409,
      });
      await db`update tickets set criteria=${db.json(ticket?.criteria)} where id=${execute.ticketId}`;
      assert.deepEqual(await f.gateRows(), before);
      const units = independentUnits();
      const result = await f.answer(owner, input({ executionMethod: 'native', parallel: units }));
      assert.equal(result.gateState, 'approved');
      const [decision] = await db`select kind,scope from decisions where id=${result.decisionId}`;
      assert.equal(decision?.kind, 'approval');
      assert.deepEqual(decision?.scope, {
        questionId: question.id,
        questionRevision: 1,
        gateId: plan.gateIds[0],
        runId: run.id,
        stepId: plan.id,
        artifactSha256: planSha,
        scopeSha256: question.scopeSha256,
        verdict: 'approve',
        executionChoice: {
          method: 'native',
          skill: 'executing-plans',
          sourcePath: 'skills/executing-plans/SKILL.md',
          sourceSha256: skillSha('superpowers', 'skills/executing-plans/SKILL.md'),
        },
        parallel: units,
      });
    } finally {
      await f.close();
    }
  }));

test('assistant gates: the architecture discussion gate opens only after three failed fixes', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create({ path: 'bug' });
      const fix = run.steps[3];
      const review = run.steps[4];
      assert.ok(fix && review);
      const fixSha = textSha('three failed fixes');
      await f.artifact(fix.ticketId, fixSha);
      const result = async (classification: string, passed: boolean) => {
        const cycleId = randomUUID(),
          evidenceId = randomUUID();
        await db`insert into evidence(id,ticket_id,attempt_id,kind,data)
          values(${evidenceId},${review.ticketId},null,'review_result',${db.json({ cycleId })})`;
        await db`insert into repair_results(check_step_id,cycle_id,classification,passed,evidence_id)
          values(${review.ticketId},${cycleId},${classification},${passed},${evidenceId})`;
        return cycleId;
      };
      const propose = (cycleId: Id | null) =>
        gateProposal(f, run, {
          step: 3,
          kind: 'architecture_discussion',
          trigger: 'after_three_failed_fixes',
          artifactSha256: fixSha,
          cycleId,
        });
      const notYet = { code: 'WORKFLOW_GATE_NOT_TRIGGERED', status: 409 };
      await assert.rejects(() => f.ask(propose(null)), notYet);
      await result('initial_review', false);
      const second = await result('repair_review', false);
      await assert.rejects(() => f.ask(propose(second)), notYet);
      // Infrastructure failures and passed reviews are no failed fixes.
      await result('infrastructure', false);
      await result('repair_review', true);
      await assert.rejects(() => f.ask(propose(second)), notYet);
      const third = await result('repair_review', false);
      // The cycle must be a failed fix of this run.
      await assert.rejects(() => f.ask(propose(randomUUID())), notYet);
      assert.equal((await db`select 1 from workflow_gates`).length, 0);
      const question = await f.ask(propose(third));
      assert.equal(question.cycleId, third);
      const [gate] = await db`select kind,step_id from workflow_gates where id=${fix.gateIds[0] as Id}`;
      assert.deepEqual({ ...gate }, { kind: 'architecture_discussion', step_id: fix.id });
    } finally {
      await f.close();
    }
  }));

test('assistant gates: a ticket question without a gate takes one owner answer', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const scopeSha256 = questionScopeOracle({
        conversationId: f.conversationId,
        rootTicketId: f.root.id,
        ticketId: f.root.id,
        runId: null,
        stepId: null,
      });
      const proposal: QuestionProposal = {
        conversationId: f.conversationId,
        ticketId: f.root.id,
        runId: null,
        stepId: null,
        gateId: null,
        cycleId: null,
        artifactSha256: null,
        question: 'Dùng cơ sở dữ liệu nào?',
        options: ['PostgreSQL', 'SQLite'],
        scopeSha256,
      };
      await assert.rejects(() => f.ask({ ...proposal, ticketId: null }), {
        code: 'WORKFLOW_QUESTION_TICKET_REQUIRED',
        status: 422,
      });
      await assert.rejects(() => f.ask({ ...proposal, artifactSha256: textSha('x') }), {
        code: 'VALIDATION',
        status: 400,
      });
      const question = await f.ask(proposal);
      assert.deepEqual(question, { id: question.id, ...proposal, revision: 1, state: 'open' });
      assert.equal((await db`select 1 from workflow_gates`).length, 0);
      const input: RecordGateAnswerInput = {
        questionId: question.id,
        expectedRevision: 1,
        scopeSha256,
        artifactSha256: null,
        answer: {
          verdict: 'answer',
          option: 'PostgreSQL',
          executionMethod: null,
          parallel: null,
          text: 'Dùng PostgreSQL',
        },
      };
      await assert.rejects(
        () => f.answer(owner, { ...input, answer: { ...input.answer, verdict: 'approve' } }),
        {
          code: 'VALIDATION',
          status: 400,
        },
      );
      await assert.rejects(
        () => f.answer(owner, { ...input, answer: { ...input.answer, option: 'MySQL' } }),
        {
          code: 'VALIDATION',
          status: 400,
        },
      );
      await assert.rejects(() => f.answer(f.assistantA, input), { code: 'OWNER_REQUIRED', status: 403 });
      const result = await f.answer(owner, input);
      assert.deepEqual(
        { gateId: result.gateId, gateState: result.gateState },
        { gateId: null, gateState: null },
      );
      const [decision] =
        await db`select ticket_id,actor_kind,kind,scope from decisions where id=${result.decisionId}`;
      assert.deepEqual(
        { ...decision },
        {
          ticket_id: f.root.id,
          actor_kind: 'owner',
          kind: 'owner_answer',
          scope: {
            questionId: question.id,
            questionRevision: 1,
            gateId: null,
            runId: null,
            stepId: null,
            artifactSha256: null,
            scopeSha256,
            verdict: 'answer',
          },
        },
      );
      await assert.rejects(() => f.answer(owner, input), { code: 'WORKFLOW_QUESTION_ANSWERED', status: 409 });
    } finally {
      await f.close();
    }
  }));

test('assistant gates: a BMAD gate needs the latched render of its run', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db, { workflow: 'bmad' });
    try {
      const run = await f.create();
      const [first, plan] = run.steps;
      assert.ok(first && plan);
      const specSha = textSha('bmad spec');
      await f.artifact(plan.ticketId, specSha);
      const target: GateTarget = { step: 1, kind: 'spec_approval', artifactSha256: specSha };
      await assert.rejects(() => f.ask(gateProposal(f, run, target)), {
        code: 'WORKFLOW_RENDER_REQUIRED',
        status: 409,
      });
      assert.equal((await db`select 1 from workflow_gates`).length, 0);
      const receipt = await seedReceipt(db, { ticketId: first.ticketId, machineId: f.boundB.id }, run);
      const latched = await db.begin((tx) => f.runs.latchRenderedArtifact(tx, run.id, receipt));
      // The render identity is part of the gate scope.
      await assert.rejects(() => f.ask(gateProposal(f, run, target)), {
        code: 'WORKFLOW_QUESTION_SCOPE_MISMATCH',
        status: 409,
      });
      const question = await f.ask(gateProposal(f, latched, target));
      assert.equal(question.scopeSha256, gateScopeOracle(gateContext(latched, target)));
      const [gate] = await db`select kind,scope_sha256 from workflow_gates where id=${plan.gateIds[0] as Id}`;
      assert.deepEqual({ ...gate }, { kind: 'spec_approval', scope_sha256: question.scopeSha256 });
    } finally {
      await f.close();
    }
  }));

test('assistant gates: only the newest artifact of the step is asked or approved; a superseded one can still be rejected', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const design = run.steps[0];
      assert.ok(design);
      const first = textSha('design v1');
      await f.artifact(design.ticketId, first);
      const question = await f.ask(gateProposal(f, run, designTarget(first)));
      const input: RecordGateAnswerInput = {
        questionId: question.id,
        expectedRevision: 1,
        scopeSha256: question.scopeSha256,
        artifactSha256: first,
        answer: approve(),
      };
      // The step now has a newer artifact: the pinned bytes are no longer what runs next.
      await f.artifact(design.ticketId, textSha('design v2'));
      const before = await f.gateRows();
      const superseded = { code: 'WORKFLOW_ARTIFACT_SUPERSEDED', status: 409 };
      await assert.rejects(() => f.answer(owner, input), superseded);
      await assert.rejects(() => f.ask(gateProposal(f, run, designTarget(first))), superseded);
      assert.deepEqual(await f.gateRows(), before);
      const [gate] =
        await db`select state,decision_id from workflow_gates where id=${design.gateIds[0] as Id}`;
      assert.deepEqual({ ...gate }, { state: 'pending', decision_id: null });
      // Re-registering the pinned bytes makes them the newest again.
      await f.artifact(design.ticketId, first);
      assert.equal((await f.answer(owner, input)).gateState, 'approved');
    } finally {
      await f.close();
    }
  }));

test('assistant gates: a reject of the superseded artifact closes the gate without approving it', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const design = run.steps[0];
      assert.ok(design);
      const first = textSha('design v1');
      await f.artifact(design.ticketId, first);
      const question = await f.ask(gateProposal(f, run, designTarget(first)));
      await f.artifact(design.ticketId, textSha('design v2'));
      const result = await f.answer(owner, {
        questionId: question.id,
        expectedRevision: 1,
        scopeSha256: question.scopeSha256,
        artifactSha256: first,
        answer: approve({ verdict: 'reject', option: 'Yêu cầu sửa', text: 'Đã có bản mới' }),
      });
      assert.equal(result.gateState, 'rejected');
    } finally {
      await f.close();
    }
  }));

test('assistant gates: a gate of a run superseded by a newer run of the same root is closed', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const design = run.steps[0];
      assert.ok(design);
      const designSha = textSha('design v1');
      await f.artifact(design.ticketId, designSha);
      const proposal = gateProposal(f, run, designTarget(designSha));
      const question = await f.ask(proposal);
      // A newer run of the same root (journal order of its step tickets), seeded in SQL
      // because the superseding producer belongs to a later slice.
      const newerStep = await f.mutation(randomUUID(), (tx) =>
        f.services.createTicket(
          tx,
          inputTicket(f.project.id, 'step', f.root.id, { title: 'Run mới' }),
          owner,
        ),
      );
      const newerRun = randomUUID();
      await db`insert into workflow_runs(id,root_ticket_id,source,projection,definition_sha256,customization_sha256,path,revision)
        values(${newerRun},${f.root.id},${db.json(run.source as never)},${db.json(run.projection as never)},
        ${run.definitionSha256},${run.customizationSha256},'bounded',1)`;
      await db`insert into workflow_steps(id,run_id,ticket_id,skill,source_path,source_sha256,predecessor_ids,acceptance,
        output_kinds,gate_ids,ownership_keys,role)
        values(${randomUUID()},${newerRun},${newerStep.id},'brainstorming','skills/brainstorming/SKILL.md',
        ${design.sourceSha256},'[]','[]','[]','[]','[]','research')`;
      const before = await f.gateRows();
      const supersededRun = { code: 'WORKFLOW_RUN_SUPERSEDED', status: 409 };
      await assert.rejects(
        () =>
          f.answer(owner, {
            questionId: question.id,
            expectedRevision: 1,
            scopeSha256: question.scopeSha256,
            artifactSha256: designSha,
            answer: approve(),
          }),
        supersededRun,
      );
      await assert.rejects(() => f.ask({ ...proposal, question: 'Hỏi lại' }), supersededRun);
      assert.deepEqual(await f.gateRows(), before);
    } finally {
      await f.close();
    }
  }));

test('assistant gates: recordGateAnswer holds the journal cursor before it waits for the root', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const design = run.steps[0];
      assert.ok(design);
      const designSha = textSha('design v1');
      await f.artifact(design.ticketId, designSha);
      const question = await f.ask(gateProposal(f, run, designTarget(designSha)));
      let release: () => void = () => {};
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => {};
      const rootLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holder = db.begin(async (tx) => {
        await tx`select id from tickets where id=${f.root.id} for update`;
        locked();
        await released;
      });
      await rootLocked;
      // A bare transaction, not mutate(): the service itself takes the cursor first.
      const answering = db.begin((tx) =>
        f.gates.recordGateAnswer(tx, owner, {
          questionId: question.id,
          expectedRevision: 1,
          scopeSha256: question.scopeSha256,
          artifactSha256: designSha,
          answer: approve(),
        }),
      );
      answering.catch(() => {});
      try {
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          const [row] = await db`select 1 from pg_stat_activity where datname=current_database()
            and wait_event_type='Lock' and query like '%from tickets%for update%' limit 1`;
          waiting = !!row;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.ok(waiting, 'recordGateAnswer waits for the root lock');
        await assert.rejects(
          () => db.begin((tx) => tx`select value from event_cursor where singleton=true for update nowait`),
          (error: { code?: string }) => error.code === '55P03',
        );
      } finally {
        release();
        await holder;
      }
      assert.equal((await answering).gateState, 'approved');
    } finally {
      await f.close();
    }
  }));

test('assistant gates: parallel ownership is compared on normalized paths and directory nesting', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const plan = run.steps[2];
      assert.ok(plan);
      const planSha = textSha('plan v1');
      await f.artifact(plan.ticketId, planSha);
      const question = await f.ask(
        gateProposal(
          f,
          run,
          { step: 2, kind: 'plan_approval_execution_method', artifactSha256: planSha },
          { options: [] },
        ),
      );
      const withKeys = (api: string[], web: string[]) => {
        const units = independentUnits();
        (units.units[0] as { ownershipKeys: string[] }).ownershipKeys = api;
        (units.units[1] as { ownershipKeys: string[] }).ownershipKeys = web;
        return {
          questionId: question.id,
          expectedRevision: 1,
          scopeSha256: question.scopeSha256,
          artifactSha256: planSha,
          answer: approve({ option: null, executionMethod: 'native', parallel: units }),
        };
      };
      const conflict = { code: 'WORKFLOW_PARALLEL_OWNERSHIP_CONFLICT', status: 409 };
      await assert.rejects(() => f.answer(owner, withKeys(['./src/a.ts'], ['src/a.ts'])), conflict);
      await assert.rejects(() => f.answer(owner, withKeys(['src/db'], ['src/db/011.sql'])), conflict);
      await assert.rejects(() => f.answer(owner, withKeys(['src/db/'], ['src/./db/x.ts'])), conflict);
      for (const bad of ['../src/a.ts', 'src/../b.ts', '/src/a.ts', 'src//a.ts', 'src\\a.ts'])
        await assert.rejects(() => f.answer(owner, withKeys([bad], ['web/b.tsx'])), {
          code: 'VALIDATION',
          status: 400,
        });
      // Sibling names sharing a prefix are not nested.
      assert.equal((await f.answer(owner, withKeys(['src/db'], ['src/dbx/a.ts']))).gateState, 'approved');
    } finally {
      await f.close();
    }
  }));

test('assistant workflows: bounded parallel approval applies the shared unit rules', async () =>
  withDatabase(async (db) => {
    const f = await runFixture(db);
    try {
      const scope = (units: unknown[]) => ({
        parallel: { rootTicketId: f.root.id, path: 'bounded', definitionSha256: superpowersHash, units },
      });
      const before = await f.rows();
      await setParallelApproval(
        db,
        await insertDecision(
          db,
          f.root.id,
          owner,
          'approval',
          scope([
            { key: 'api', title: 'API', ownershipKeys: ['./src/db'] },
            { key: 'web', title: 'Web', ownershipKeys: ['src/db/x.ts'] },
          ]),
        ),
      );
      await assert.rejects(() => f.create({ path: 'bounded' }), {
        code: 'WORKFLOW_PARALLEL_OWNERSHIP_CONFLICT',
        status: 409,
      });
      await setParallelApproval(
        db,
        await insertDecision(
          db,
          f.root.id,
          owner,
          'approval',
          scope([
            { key: 'api', title: 'API', ownershipKeys: ['src/a.ts'] },
            { key: 'web', title: 'Web', ownershipKeys: ['web/b.tsx'], dependsOn: ['api'] },
          ]),
        ),
      );
      await assert.rejects(() => f.create({ path: 'bounded' }), {
        code: 'WORKFLOW_PARALLEL_DEPENDENCY',
        status: 409,
      });
      await setParallelApproval(
        db,
        await insertDecision(
          db,
          f.root.id,
          owner,
          'approval',
          scope([
            { key: 'api', title: 'API', ownershipKeys: ['../a.ts'] },
            { key: 'web', title: 'Web', ownershipKeys: ['web/b.tsx'] },
          ]),
        ),
      );
      await assert.rejects(() => f.create({ path: 'bounded' }), {
        code: 'WORKFLOW_PARALLEL_SCOPE_MISMATCH',
        status: 409,
      });
      const after = await f.rows();
      assert.deepEqual(
        { runs: after.runs, steps: after.steps, tickets: after.tickets },
        { runs: before.runs, steps: before.steps, tickets: before.tickets },
      );
    } finally {
      await f.close();
    }
  }));

test('assistant gates: a decision of another gate or another root cannot advance this question', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const [design, spec] = run.steps;
      assert.ok(design && spec);
      const designSha = textSha('design v1');
      await f.artifact(design.ticketId, designSha);
      const first = await f.ask(gateProposal(f, run, designTarget(designSha)));
      const answered = await f.answer(owner, {
        questionId: first.id,
        expectedRevision: 1,
        scopeSha256: first.scopeSha256,
        artifactSha256: designSha,
        answer: approve(),
      });
      const specSha = textSha('spec v1');
      await f.artifact(spec.ticketId, specSha);
      const second = await f.ask(
        gateProposal(f, run, { step: 1, kind: 'spec_approval', artifactSha256: specSha }),
      );
      const scope = {
        questionId: second.id,
        questionRevision: 1,
        gateId: second.gateId,
        runId: run.id,
        stepId: spec.id,
        artifactSha256: specSha,
        scopeSha256: second.scopeSha256,
        verdict: 'approve',
      };
      const mismatch = { code: 'WORKFLOW_QUESTION_SCOPE_MISMATCH', status: 409 };
      // An owner approval with this question's scope, recorded on a ticket of another root.
      const elsewhere = await insertDecision(db, f.a.id, owner, 'approval', scope);
      const before = await f.gateRows();
      // The answered decision of the design gate.
      await assert.rejects(() => f.advance(second.id, answered.decisionId), mismatch);
      await assert.rejects(() => f.advance(second.id, elsewhere), mismatch);
      // The answered question cannot be advanced again with the other gate's decision either.
      await assert.rejects(() => f.advance(first.id, elsewhere), {
        code: 'WORKFLOW_QUESTION_ANSWERED',
        status: 409,
      });
      assert.deepEqual(await f.gateRows(), before);
    } finally {
      await f.close();
    }
  }));

test('assistant gates: ask_owner is a member of the tagged operation request form', () => {
  const payload: QuestionProposal = {
    conversationId: randomUUID(),
    ticketId: randomUUID(),
    runId: null,
    stepId: null,
    gateId: null,
    cycleId: null,
    artifactSha256: null,
    question: 'Câu hỏi',
    options: [],
    scopeSha256: 'a'.repeat(64),
  };
  const request: OperationRequest = { action: 'ask_owner', payload };
  assert.equal(
    operationRequestSha256(request),
    createHash('sha256')
      .update(canonicalJson({ schema: 'crew-v2:operation-request:1', action: 'ask_owner', payload }))
      .digest('hex'),
  );
});

test('assistant gates: parallel ownership conflicts ignore case, Unicode form and percent-encoding', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      const run = await f.create();
      const plan = run.steps[2];
      assert.ok(plan);
      const planSha = textSha('plan v1');
      await f.artifact(plan.ticketId, planSha);
      const question = await f.ask(
        gateProposal(
          f,
          run,
          { step: 2, kind: 'plan_approval_execution_method', artifactSha256: planSha },
          { options: [] },
        ),
      );
      const units = (api: string[], web: string[]) => {
        const value = independentUnits();
        (value.units[0] as { ownershipKeys: string[] }).ownershipKeys = api;
        (value.units[1] as { ownershipKeys: string[] }).ownershipKeys = web;
        return value;
      };
      const input = (parallel: ReturnType<typeof units>): RecordGateAnswerInput => ({
        questionId: question.id,
        expectedRevision: 1,
        scopeSha256: question.scopeSha256,
        artifactSha256: planSha,
        answer: approve({ option: null, executionMethod: 'native', parallel }),
      });
      const conflict = { code: 'WORKFLOW_PARALLEL_OWNERSHIP_CONFLICT', status: 409 };
      const before = await f.gateRows();
      await assert.rejects(() => f.answer(owner, input(units(['Src/A.ts'], ['src/a.ts']))), conflict);
      await assert.rejects(() => f.answer(owner, input(units(['docs/café.md'], ['docs/café.md']))), conflict);
      await assert.rejects(() => f.answer(owner, input(units(['src%2Fdb'], ['src/db/x.ts']))), conflict);
      await assert.rejects(() => f.answer(owner, input(units(['src/%61.ts'], ['src/a.ts']))), conflict);
      assert.deepEqual(await f.gateRows(), before);
      // The stored approval keeps the keys exactly as the owner wrote them.
      const kept = units(['Src/A.ts'], ['web/B.tsx']);
      const result = await f.answer(owner, input(kept));
      const [decision] = await db`select scope from decisions where id=${result.decisionId}`;
      assert.deepEqual(decision?.scope.parallel, kept);
    } finally {
      await f.close();
    }
  }));

test('assistant gates: a run whose journal order is unknown fails closed', async () =>
  withDatabase(async (db) => {
    const f = await gateFixture(db);
    try {
      // A step ticket and run restored without any `ticket.created` event.
      const ticketId = randomUUID();
      await db`insert into tickets select (jsonb_populate_record(null::tickets,
        to_jsonb(t) || jsonb_build_object('id', ${ticketId}::text, 'parent_id', ${f.root.id}::text,
          'root_id', ${f.root.id}::text, 'level', 'step'))).* from tickets t where t.id=${f.root.id}`;
      const runId = randomUUID(),
        stepId = randomUUID();
      await db`insert into workflow_runs(id,root_ticket_id,source,projection,definition_sha256,customization_sha256,path,revision)
        values(${runId},${f.root.id},${db.json(vector.superpowers.source as never)},
        ${db.json(vector.superpowers.projection as never)},${superpowersHash},
        ${vector.superpowers.definition.customizationSha256},'bounded',1)`;
      await db`insert into workflow_steps(id,run_id,ticket_id,skill,source_path,source_sha256,predecessor_ids,acceptance,
        output_kinds,gate_ids,ownership_keys,role)
        values(${stepId},${runId},${ticketId},'brainstorming','skills/brainstorming/SKILL.md',${'a'.repeat(64)},
        '[]','[]','[]','[]','[]','research')`;
      const before = await f.gateRows();
      await assert.rejects(
        () =>
          f.ask({
            conversationId: f.conversationId,
            ticketId,
            runId,
            stepId,
            gateId: null,
            cycleId: null,
            artifactSha256: null,
            question: 'Run này còn hiện hành?',
            options: [],
            scopeSha256: questionScopeOracle({
              conversationId: f.conversationId,
              rootTicketId: f.root.id,
              ticketId,
              runId,
              stepId,
            }),
          }),
        { code: 'WORKFLOW_RUN_SUPERSEDED', status: 409 },
      );
      assert.deepEqual(await f.gateRows(), before);
    } finally {
      await f.close();
    }
  }));
