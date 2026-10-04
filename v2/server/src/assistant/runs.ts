import { createHash, randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { samePin } from '../../../src/workflow-policy.ts';
import { toDomainPin } from '../gateway/contracts.ts';
import { canonicalJson } from '../journal/canonical.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { uuid } from '../tickets/assistant-access.ts';
import type { CreateTicket, Ticket } from '../tickets/contracts.ts';
import type { PersistedAssistantActorResolver } from './authority.ts';
import type { OrchestrationProof, Sha256, SkillStep, WorkflowRun } from './contracts.ts';
import type { RunGraph, WorkflowOrchestrationPort } from './orchestration.ts';
import { runGraphSha256 } from './orchestration.ts';
import type { DefinitionLookup, StepSpec, WorkflowPath } from './workflows.ts';
import {
  createDefinitionLookup,
  stepSources,
  workflowOfPath,
  workflowPaths,
  workflowSteps,
} from './workflows.ts';

export type CreateRunInput = { rootTicketId: Id; path: WorkflowPath; definitionSha256: Sha256 };
export type WorkflowRunDependencies = {
  port: WorkflowOrchestrationPort;
  resolver: PersistedAssistantActorResolver;
  lookup?: DefinitionLookup;
};
export type WorkflowRuns = {
  createRun(tx: Tx, proof: OrchestrationProof, input: CreateRunInput): Promise<WorkflowRun>;
  latchRenderedArtifact(tx: Tx, runId: Id, evidenceId: Id): Promise<WorkflowRun>;
};

type ParallelUnit = { key: string; title: string; ownershipKeys: string[] };
type PlannedStep = {
  spec: StepSpec;
  stepId: Id;
  operationId: Id;
  gateIds: Id[];
  predecessors: number[];
  ownershipKeys: string[];
  title: string;
};

const digest = /^[0-9a-f]{64}$/;
const sha256 = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const sha256Text = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const renderConflict = (message: string) => new ApiError('WORKFLOW_RENDER_RECEIPT_INVALID', 409, message);
const plainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Phase04 logical effect identity, recomputed from the persisted operation fields. */
export function workflowEffectId(input: {
  runId: Id;
  stepOperationId: Id;
  actionKind: string;
  targetIdentity: string;
  preconditionSha256: Sha256;
}): Sha256 {
  return sha256([
    input.runId,
    input.stepOperationId,
    input.actionKind,
    input.targetIdentity,
    input.preconditionSha256,
  ]);
}

function validateInput(input: CreateRunInput): CreateRunInput {
  if (
    !plainObject(input) ||
    Object.keys(input).length !== 3 ||
    typeof input.rootTicketId !== 'string' ||
    !uuid.test(input.rootTicketId) ||
    !workflowPaths.includes(input.path) ||
    typeof input.definitionSha256 !== 'string' ||
    !digest.test(input.definitionSha256)
  )
    throw new ApiError('VALIDATION', 400, 'Yêu cầu tạo run không hợp lệ');
  return {
    rootTicketId: input.rootTicketId.toLowerCase(),
    path: input.path,
    definitionSha256: input.definitionSha256,
  };
}

function units(scope: unknown, input: CreateRunInput): ParallelUnit[] {
  const parallel = plainObject(scope) ? scope.parallel : undefined;
  if (
    !plainObject(parallel) ||
    parallel.rootTicketId !== input.rootTicketId ||
    parallel.path !== input.path ||
    parallel.definitionSha256 !== input.definitionSha256 ||
    !Array.isArray(parallel.units) ||
    parallel.units.length < 2 ||
    parallel.units.length > 16
  )
    throw new ApiError('WORKFLOW_PARALLEL_SCOPE_MISMATCH', 409, 'Duyệt song song không khớp run');
  const result: ParallelUnit[] = [];
  const owned = new Set<string>();
  const keys = new Set<string>();
  for (const unit of parallel.units) {
    if (
      !plainObject(unit) ||
      typeof unit.key !== 'string' ||
      !/^[a-z0-9][a-z0-9-]{0,63}$/.test(unit.key) ||
      keys.has(unit.key) ||
      typeof unit.title !== 'string' ||
      unit.title.length < 1 ||
      unit.title.length > 120 ||
      !Array.isArray(unit.ownershipKeys) ||
      unit.ownershipKeys.length < 1 ||
      unit.ownershipKeys.some((key) => typeof key !== 'string' || !key || key.length > 512)
    )
      throw new ApiError('WORKFLOW_PARALLEL_SCOPE_MISMATCH', 409, 'Duyệt song song không khớp run');
    // Same path, index or migration in two units forbids overlap even with approval.
    for (const key of unit.ownershipKeys as string[]) {
      if (owned.has(key))
        throw new ApiError('WORKFLOW_PARALLEL_OWNERSHIP_CONFLICT', 409, 'Các phần song song trùng sở hữu');
      owned.add(key);
    }
    keys.add(unit.key);
    result.push({ key: unit.key, title: unit.title, ownershipKeys: [...(unit.ownershipKeys as string[])] });
  }
  return result;
}

/**
 * Owner parallel approval from the Assistant policy. It must be an owner `approval`
 * decision inside this root naming this exact run request; anything else denies.
 */
async function parallelApproval(
  tx: Tx,
  input: CreateRunInput,
): Promise<{ id: Id; units: ParallelUnit[] } | null> {
  const [config] = await tx`select policy from assistant_config where singleton=true`;
  const id: unknown = plainObject(config?.policy) ? config.policy.parallelApprovalId : null;
  if (id === null || id === undefined) return null;
  const denied = () =>
    new ApiError('WORKFLOW_PARALLEL_APPROVAL_INVALID', 403, 'Duyệt song song cần quyết định của chủ dự án');
  if (typeof id !== 'string' || !uuid.test(id)) throw denied();
  const [decision] = await tx`select d.id,d.actor_kind,d.actor_id,d.kind,d.scope,t.root_id
    from decisions d join tickets t on t.id=d.ticket_id where d.id=${id.toLowerCase()} for share of d`;
  if (!decision) throw denied();
  if (
    decision.actor_kind !== 'owner' ||
    decision.actor_id !== 'owner' ||
    decision.kind !== 'approval' ||
    decision.root_id !== input.rootTicketId
  )
    throw denied();
  if (input.path !== 'architectural' && input.path !== 'bounded')
    throw new ApiError('WORKFLOW_PARALLEL_SCOPE_MISMATCH', 409, 'Đường workflow này chạy tuần tự');
  return { id: String(decision.id), units: units(decision.scope, input) };
}

// Ordered official stages; with an exact owner approval the implementation stage
// splits into disjoint units that the review stage joins.
function plan(path: WorkflowPath, parallel: ParallelUnit[] | null): PlannedStep[] {
  const steps: PlannedStep[] = [];
  let previous: number[] = [];
  for (const spec of workflowSteps(path)) {
    const expand = parallel && spec.key === 'implement' ? parallel : [null];
    const added: number[] = [];
    for (const unit of expand) {
      steps.push({
        spec,
        stepId: randomUUID(),
        operationId: randomUUID(),
        gateIds: spec.gates.map(() => randomUUID()),
        predecessors: previous,
        ownershipKeys: unit ? unit.ownershipKeys : [],
        title: unit ? `${spec.title}: ${unit.title}` : spec.title,
      });
      added.push(steps.length - 1);
    }
    previous = added;
  }
  return steps;
}

function mapRun(row: Record<string, unknown>, steps: SkillStep[]): WorkflowRun {
  return {
    id: String(row.id),
    rootTicketId: String(row.root_ticket_id),
    source: row.source as WorkflowRun['source'],
    projection: row.projection as WorkflowRun['projection'],
    definitionSha256: String(row.definition_sha256),
    customizationSha256: String(row.customization_sha256),
    renderedArtifactId: row.rendered_artifact_id === null ? null : String(row.rendered_artifact_id),
    path: row.path as WorkflowRun['path'],
    revision: Number(row.revision),
    steps,
    parallelApprovalId: row.parallel_approval_id === null ? null : String(row.parallel_approval_id),
  };
}

async function readRun(tx: Tx, runId: Id): Promise<WorkflowRun> {
  const [row] = await tx`select * from workflow_runs where id=${runId}`;
  if (!row) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy run');
  // Creation order of the step tickets is their journal order.
  const rows = await tx`select s.* from workflow_steps s
    where s.run_id=${runId}
    order by (select min(e.cursor) from events e where e.type='ticket.created' and e.ticket_id=s.ticket_id),s.id`;
  const order = new Map<string, number>();
  const pending = rows.map((step) => ({
    id: String(step.id),
    ticketId: String(step.ticket_id),
    skill: String(step.skill),
    sourcePath: String(step.source_path),
    sourceSha256: String(step.source_sha256),
    predecessorIds: step.predecessor_ids as Id[],
    acceptance: step.acceptance as string[],
    outputKinds: step.output_kinds as string[],
    gateIds: step.gate_ids as Id[],
    ownershipKeys: step.ownership_keys as string[],
    role: step.role as SkillStep['role'],
  }));
  // Topological order: a step follows every predecessor; ties keep creation order.
  const sorted: SkillStep[] = [];
  while (sorted.length < pending.length) {
    const next = pending.find(
      (step) => !order.has(step.id) && step.predecessorIds.every((id) => order.has(id)),
    );
    if (!next) throw new Error('WORKFLOW_GRAPH_CYCLE');
    order.set(next.id, sorted.length);
    sorted.push(next);
  }
  return mapRun(row, sorted);
}

/**
 * Server run graph from a pinned official definition. The Actor is always the persisted
 * Assistant resolved from the proof; every child ticket and edge goes through the one
 * graph authorization of the pending `create_run` operation.
 */
export function createWorkflowRuns(deps: WorkflowRunDependencies): WorkflowRuns {
  const port = deps?.port;
  const resolver = deps?.resolver;
  if (!port || typeof port.authorizeGraph !== 'function' || typeof resolver !== 'function')
    throw new Error('WORKFLOW_RUN_DEPENDENCIES_INVALID');
  const lookup = deps.lookup ?? createDefinitionLookup();
  return Object.freeze({
    async createRun(tx: Tx, proof: OrchestrationProof, request: CreateRunInput): Promise<WorkflowRun> {
      const input = validateInput(request);
      // Lock order matches the scoped ticket writers: root → project → persisted Actor.
      const [root] = await tx`select * from tickets where id=${input.rootTicketId} for update`;
      if (!root || root.root_id !== root.id || root.level !== 'request')
        throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
      const [project] = await tx`select id,machine_id from projects where id=${root.project_id} for update`;
      if (!project) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy dự án');
      const actor: Actor = await resolver(tx, proof);
      if (root.status === 'done' || root.status === 'cancelled')
        throw new ApiError('TICKET_CLOSED', 409, 'Cây ticket đã kết thúc');
      if (project.machine_id === null)
        throw new ApiError('PROJECT_NOT_BOUND', 409, 'Dự án chưa gắn máy thực thi');
      const record = await lookup(tx, String(project.machine_id), input.definitionSha256);
      if (!record)
        throw new ApiError('WORKFLOW_DEFINITION_UNKNOWN', 422, 'Máy dự án chưa báo definition này');
      if (record.source.name !== workflowOfPath(input.path))
        throw new ApiError('WORKFLOW_PATH_MISMATCH', 422, 'Đường workflow không thuộc definition');
      const sources = stepSources(input.path, record.definition.skills);
      const rootPin = root.workflow_pin as Ticket['workflowPin'];
      const choice = plainObject(root.criteria) ? root.criteria.workflowChoice : undefined;
      if (
        (rootPin && !samePin(rootPin, toDomainPin(record.source))) ||
        (choice !== undefined && choice !== record.source.name)
      )
        throw new ApiError('WORKFLOW_PIN_MISMATCH', 409, 'Workflow khác yêu cầu gốc');
      const [existing] = await tx`select id from workflow_runs where root_ticket_id=${input.rootTicketId}`;
      if (existing) throw new ApiError('WORKFLOW_RUN_EXISTS', 409, 'Yêu cầu đã có run');
      const parallel = await parallelApproval(tx, input);
      const runId = randomUUID();
      const steps = plan(input.path, parallel?.units ?? null);
      const inputs: CreateTicket[] = steps.map((step) => ({
        projectId: String(root.project_id),
        parentId: input.rootTicketId,
        level: 'step',
        kind: step.spec.kind,
        title: step.title,
        description: `Nguồn chính thức: ${step.spec.citation}`,
        mandatory: true,
        criteria: {
          workflowRun: {
            runId,
            path: input.path,
            stepKey: step.spec.key,
            stepOperationId: step.operationId,
            sourcePath: step.spec.sourcePath,
            gates: step.spec.gates.map((gate, index) => ({
              id: step.gateIds[index],
              kind: gate.kind,
              requiredActor: gate.requiredActor,
              citation: gate.citation,
            })),
          },
        },
        inputs: {},
        outputs: { kinds: step.spec.outputKinds },
        skill: step.spec.skill,
        workflowPin: null,
      }));
      const edges = steps.flatMap((step, index) =>
        step.predecessors.map((predecessor) => ({
          key: randomUUID(),
          ticketKey: step.operationId,
          predecessorKey: steps[predecessor]?.operationId as Id,
          index,
          predecessor,
        })),
      );
      const graph: RunGraph = {
        runId,
        rootTicketId: input.rootTicketId,
        tickets: steps.map((step, index) => ({
          key: step.operationId,
          input: inputs[index] as CreateTicket,
        })),
        edges: edges.map(({ key, ticketKey, predecessorKey }) => ({ key, ticketKey, predecessorKey })),
      };
      const graphSha256 = runGraphSha256(graph);
      const session = await port.authorizeGraph(tx, actor, proof, graph, graphSha256);
      await tx`insert into workflow_runs(id,root_ticket_id,source,projection,definition_sha256,customization_sha256,
        rendered_artifact_id,path,revision,parallel_approval_id)
        values(${runId},${input.rootTicketId},${tx.json(record.source)},${tx.json(record.projection)},
        ${record.definition.sha256},${record.definition.customizationSha256},null,${input.path},1,${parallel?.id ?? null})`;
      const tickets: Ticket[] = [];
      for (const [index, step] of steps.entries()) {
        const ticket = await session.createTicket(tx, step.operationId, inputs[index] as CreateTicket);
        tickets.push(ticket);
        await tx`insert into workflow_steps(id,run_id,ticket_id,skill,source_path,source_sha256,predecessor_ids,
          acceptance,output_kinds,gate_ids,ownership_keys,role)
          values(${step.stepId},${runId},${ticket.id},${step.spec.skill},${step.spec.sourcePath},
          ${sources.get(step.spec.sourcePath) as string},${tx.json(step.predecessors.map((p) => steps[p]?.stepId as Id))},
          ${tx.json(step.spec.acceptance)},${tx.json(step.spec.outputKinds)},${tx.json(step.gateIds)},
          ${tx.json(step.ownershipKeys)},${step.spec.role})`;
        await insertOperation(
          tx,
          runId,
          step.stepId,
          step.operationId,
          'create_ticket',
          ticket.id,
          graphSha256,
        );
      }
      const revisions = new Map(tickets.map((ticket) => [ticket.id, ticket.revision]));
      for (const edge of edges) {
        const ticket = tickets[edge.index] as Ticket;
        const predecessor = tickets[edge.predecessor] as Ticket;
        const revision = revisions.get(ticket.id) as number;
        await session.dependency(tx, ticket.id, predecessor.id, revision);
        revisions.set(ticket.id, revision + 1);
        await insertOperation(
          tx,
          runId,
          (steps[edge.index] as PlannedStep).stepId,
          edge.key,
          'dependency',
          `${ticket.id}:${predecessor.id}`,
          graphSha256,
        );
      }
      session.close(tx);
      return readRun(tx, runId);
    },

    /**
     * Latches the verified render receipt of a BMAD run once. The receipt must be
     * `workflow_render_receipt` evidence of an attempt on a step ticket of this run, made
     * by the project's current machine binding, for the run's exact definition and
     * customization, with a generation path derived from its own project root.
     */
    async latchRenderedArtifact(tx: Tx, runId: Id, evidenceId: Id): Promise<WorkflowRun> {
      if (
        typeof runId !== 'string' ||
        !uuid.test(runId) ||
        typeof evidenceId !== 'string' ||
        !uuid.test(evidenceId)
      )
        throw new ApiError('VALIDATION', 400, 'Định danh không hợp lệ');
      const [run] =
        await tx`select r.*,t.project_id from workflow_runs r join tickets t on t.id=r.root_ticket_id
        where r.id=${runId.toLowerCase()} for update of r`;
      if (!run) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy run');
      if (run.path !== 'bmad-dispatch' && run.path !== 'bmad-oneshot')
        throw new ApiError('WORKFLOW_RENDER_NOT_REQUIRED', 409, 'Run này không dùng render BMAD');
      if (run.rendered_artifact_id !== null)
        throw new ApiError('WORKFLOW_RENDER_ALREADY_LATCHED', 409, 'Run đã ghim render');
      const [project] =
        await tx`select machine_id,binding_revision from projects where id=${run.project_id} for share`;
      const [evidence] = await tx`select id,ticket_id,attempt_id,kind,data from evidence
        where id=${evidenceId.toLowerCase()} for share`;
      if (!evidence) throw renderConflict('Receipt render không hợp lệ');
      if (evidence.kind !== 'workflow_render_receipt' || evidence.attempt_id === null)
        throw renderConflict('Receipt render không hợp lệ');
      const [attempt] = await tx`select a.id,a.ticket_id,a.machine_id,a.binding_revision from attempts a
        join workflow_steps s on s.ticket_id=a.ticket_id and s.run_id=${run.id}
        where a.id=${evidence.attempt_id} for share of a`;
      if (!attempt || attempt.ticket_id !== evidence.ticket_id)
        throw renderConflict('Receipt không thuộc attempt của run');
      if (
        !project ||
        project.machine_id === null ||
        attempt.machine_id !== project.machine_id ||
        Number(attempt.binding_revision) !== Number(project.binding_revision)
      )
        throw renderConflict('Receipt không đến từ máy dự án hiện hành');
      const data: unknown = evidence.data;
      if (
        !plainObject(data) ||
        data.definitionSha256 !== run.definition_sha256 ||
        data.customizationSha256 !== run.customization_sha256
      )
        throw renderConflict('Receipt không khớp definition của run');
      if (!renderPathMatches(data.projectRoot, data.generationPath))
        throw renderConflict('Receipt không khớp project root');
      const [updated] =
        await tx`update workflow_runs set rendered_artifact_id=${evidence.id},revision=revision+1
        where id=${run.id} and rendered_artifact_id is null returning id`;
      if (!updated) throw new ApiError('WORKFLOW_RENDER_ALREADY_LATCHED', 409, 'Run đã ghim render');
      return readRun(tx, String(run.id));
    },
  });
}

async function insertOperation(
  tx: Tx,
  runId: Id,
  stepId: Id,
  operationId: Id,
  actionKind: 'create_ticket' | 'dependency',
  targetIdentity: string,
  preconditionSha256: Sha256,
): Promise<void> {
  const effectId = workflowEffectId({
    runId,
    stepOperationId: operationId,
    actionKind,
    targetIdentity,
    preconditionSha256,
  });
  await tx`insert into assistant_operation_ids(id,run_id,step_id,action_kind,target_identity,precondition_sha256,effect_id)
    values(${operationId},${runId},${stepId},${actionKind},${targetIdentity},${preconditionSha256},${effectId})`;
}

// Official renderer destination: {root}/_bmad/render/bmad-build/{slug}-{sha256(root)[:12]}/{20 hex}.
function renderPathMatches(projectRoot: unknown, generationPath: unknown): boolean {
  if (
    typeof projectRoot !== 'string' ||
    typeof generationPath !== 'string' ||
    projectRoot.length > 4096 ||
    !posix.isAbsolute(projectRoot) ||
    posix.normalize(projectRoot) !== projectRoot ||
    projectRoot.endsWith('/') ||
    projectRoot.includes('\\') ||
    projectRoot.includes('\0')
  )
    return false;
  const baseName = posix.basename(projectRoot);
  if (
    [...baseName].some(
      (character) => (character.codePointAt(0) ?? 0) < 32 || (character.codePointAt(0) ?? 0) > 126,
    )
  )
    return false;
  const cleaned =
    baseName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project';
  const slug = cleaned.slice(0, 80).replace(/-$/g, '') || 'project';
  const prefix = `${projectRoot}/_bmad/render/bmad-build/${slug}-${sha256Text(projectRoot).slice(0, 12)}/`;
  return generationPath.startsWith(prefix) && /^[0-9a-f]{20}$/.test(generationPath.slice(prefix.length));
}
