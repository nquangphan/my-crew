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
  TurnFence,
  WorkflowRun,
} from '../src/assistant/contracts.ts';
import type { OperationRequest } from '../src/assistant/operation-request.ts';
import type { WorkflowOrchestrationPort } from '../src/assistant/orchestration.ts';
import { createProjectOrchestrationPort } from '../src/assistant/orchestration.ts';
import type { CreateRunInput } from '../src/assistant/runs.ts';
import { createWorkflowRuns, workflowEffectId } from '../src/assistant/runs.ts';
import { provisionMachine } from '../src/auth/machine.ts';
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
  // The tools route stand-in: a pending operation row written in the same Tx as the call,
  // carrying the request hash the transport computes for it.
  const inTurn = async <T>(
    request: RequestFor,
    work: (tx: Tx, proof: OrchestrationProof) => Promise<T>,
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
        return { status: 201, body: { value: (await work(tx, { fence, scopeId, operationId })) as unknown } };
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
