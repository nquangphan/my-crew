import { createHash } from 'node:crypto';
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
import type { OperationRequest } from './operation-request.ts';
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
  /**
   * Exact request the tools transport must hash into the pending `create_run` operation:
   * the run input plus the digest of the graph this operation would create. Pure read.
   */
  createRunRequest(
    tx: Tx,
    operationId: Id,
    input: CreateRunInput,
  ): Promise<Extract<OperationRequest, { action: 'create_run' }>>;
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

// Every ID of a run is derived from its operation, so the graph (and its digest) is a
// pure function of the operation, the request and the persisted rows it reads.
function derivedId(operationId: Id, ...parts: (string | number)[]): Id {
  const hex = sha256(['crew-v2:workflow-run-id:1', operationId.toLowerCase(), ...parts]);
  const variant = ((Number.parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

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
 * Owner parallel approval from the Assistant policy. A decision of another root is no
 * override for this root (sequential). Inside this root it must be an owner `approval`
 * naming this exact run request; anything else denies.
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
  if (decision.root_id !== input.rootTicketId) return null;
  if (decision.actor_kind !== 'owner' || decision.actor_id !== 'owner' || decision.kind !== 'approval')
    throw denied();
  // Architectural units need the written plan first; that approval belongs to the plan gate.
  if (input.path !== 'bounded')
    throw new ApiError('WORKFLOW_PARALLEL_SCOPE_MISMATCH', 409, 'Đường workflow này chạy tuần tự');
  return { id: String(decision.id), units: units(decision.scope, input) };
}

// Ordered official stages; with an exact owner approval the implementation stage
// splits into disjoint units that the review stage joins.
function plan(operationId: Id, path: WorkflowPath, parallel: ParallelUnit[] | null): PlannedStep[] {
  const steps: PlannedStep[] = [];
  let previous: number[] = [];
  for (const spec of workflowSteps(path)) {
    const expand = parallel && spec.key === 'implement' ? parallel : [null];
    const added: number[] = [];
    for (const unit of expand) {
      const index = steps.length;
      steps.push({
        spec,
        stepId: derivedId(operationId, 'step', index),
        operationId: derivedId(operationId, 'step-operation', index),
        gateIds: spec.gates.map((_, gate) => derivedId(operationId, 'gate', index, gate)),
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
  // Deterministic plan of one run for one operation: the same rows give the same graph.
  async function planRun(
    tx: Tx,
    operationId: Id,
    input: CreateRunInput,
    root: Record<string, unknown> | undefined,
    project: Record<string, unknown> | undefined,
  ) {
    if (!root || !project || root.root_id !== root.id || root.level !== 'request')
      throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
    if (root.status === 'done' || root.status === 'cancelled')
      throw new ApiError('TICKET_CLOSED', 409, 'Cây ticket đã kết thúc');
    if (project.machine_id === null)
      throw new ApiError('PROJECT_NOT_BOUND', 409, 'Dự án chưa gắn máy thực thi');
    const record = await lookup(tx, String(project.machine_id), input.definitionSha256);
    if (!record) throw new ApiError('WORKFLOW_DEFINITION_UNKNOWN', 422, 'Máy dự án chưa báo definition này');
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
    const runId = derivedId(operationId, 'run');
    const steps = plan(operationId, input.path, parallel?.units ?? null);
    const gateOf = (stepKey: string, gateKind: string) => {
      const owner = steps.find((step) => step.spec.key === stepKey);
      const index = owner?.spec.gates.findIndex((gate) => gate.kind === gateKind) ?? -1;
      return owner?.gateIds[index] ?? null;
    };
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
          citation: step.spec.citation,
          gates: step.spec.gates.map((gate, index) => ({
            id: step.gateIds[index],
            kind: gate.kind,
            requiredActor: gate.requiredActor,
            trigger: gate.trigger,
            citation: gate.citation,
          })),
          ...(step.spec.executionChoices
            ? {
                executionChoices: step.spec.executionChoices.map((option) => ({
                  ...option,
                  sourceSha256: sources.get(option.sourcePath) as string,
                })),
                resolvedByGateId: step.spec.resolvedBy
                  ? gateOf(step.spec.resolvedBy.stepKey, step.spec.resolvedBy.gateKind)
                  : null,
              }
            : {}),
        },
      },
      inputs: {},
      outputs: { kinds: step.spec.outputKinds },
      skill: step.spec.skill,
      workflowPin: null,
    }));
    const edges = steps.flatMap((step, index) =>
      step.predecessors.map((predecessor) => ({
        key: derivedId(operationId, 'edge', index, predecessor),
        ticketKey: step.operationId,
        predecessorKey: steps[predecessor]?.operationId as Id,
        index,
        predecessor,
      })),
    );
    const graph: RunGraph = {
      runId,
      rootTicketId: input.rootTicketId,
      tickets: steps.map((step, index) => ({ key: step.operationId, input: inputs[index] as CreateTicket })),
      edges: edges.map(({ key, ticketKey, predecessorKey }) => ({ key, ticketKey, predecessorKey })),
    };
    const graphSha256 = runGraphSha256(graph);
    const request = {
      action: 'create_run' as const,
      payload: {
        rootTicketId: input.rootTicketId,
        path: input.path,
        definitionSha256: input.definitionSha256,
        graphSha256,
      },
    };
    return { runId, steps, inputs, edges, graph, graphSha256, record, sources, parallel, request };
  }
  return Object.freeze({
    async createRunRequest(tx: Tx, operationId: Id, request: CreateRunInput) {
      const input = validateInput(request);
      if (typeof operationId !== 'string' || !uuid.test(operationId))
        throw new ApiError('VALIDATION', 400, 'Định danh thao tác không hợp lệ');
      const [root] = await tx`select * from tickets where id=${input.rootTicketId}`;
      const [project] = root ? await tx`select id,machine_id from projects where id=${root.project_id}` : [];
      return (await planRun(tx, operationId, input, root, project)).request;
    },
    async createRun(tx: Tx, proof: OrchestrationProof, request: CreateRunInput): Promise<WorkflowRun> {
      const input = validateInput(request);
      // Lock order matches the scoped ticket writers: root → project → persisted Actor.
      const [root] = await tx`select * from tickets where id=${input.rootTicketId} for update`;
      const [project] = root
        ? await tx`select id,machine_id from projects where id=${root.project_id} for update`
        : [];
      if (!root || !project) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
      const actor: Actor = await resolver(tx, proof);
      const planned = await planRun(tx, proof.operationId, input, root, project);
      const { runId, steps, inputs, edges, graph, graphSha256, record, sources, parallel } = planned;
      // All-or-nothing: any failure after the first write rolls back every write of this
      // call (and the operation's single use) while the caller's transaction stays usable.
      return tx.savepoint(async (sp) => {
        const session = await port.authorizeGraph(sp, actor, proof, input, graph);
        await sp`insert into workflow_runs(id,root_ticket_id,source,projection,definition_sha256,customization_sha256,
          rendered_artifact_id,path,revision,parallel_approval_id)
          values(${runId},${input.rootTicketId},${sp.json(record.source)},${sp.json(record.projection)},
          ${record.definition.sha256},${record.definition.customizationSha256},null,${input.path},1,${parallel?.id ?? null})`;
        const tickets: Ticket[] = [];
        for (const [index, step] of steps.entries()) {
          const ticket = await session.createTicket(sp, step.operationId, inputs[index] as CreateTicket);
          tickets.push(ticket);
          await sp`insert into workflow_steps(id,run_id,ticket_id,skill,source_path,source_sha256,predecessor_ids,
            acceptance,output_kinds,gate_ids,ownership_keys,role)
            values(${step.stepId},${runId},${ticket.id},${step.spec.skill},${step.spec.sourcePath},
            ${sources.get(step.spec.sourcePath) as string},${sp.json(step.predecessors.map((p) => steps[p]?.stepId as Id))},
            ${sp.json(step.spec.acceptance)},${sp.json(step.spec.outputKinds)},${sp.json(step.gateIds)},
            ${sp.json(step.ownershipKeys)},${step.spec.role})`;
          await insertOperation(
            sp,
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
          await session.dependency(sp, ticket.id, predecessor.id, revision);
          revisions.set(ticket.id, revision + 1);
          await insertOperation(
            sp,
            runId,
            (steps[edge.index] as PlannedStep).stepId,
            edge.key,
            'dependency',
            `${ticket.id}:${predecessor.id}`,
            graphSha256,
          );
        }
        session.close(sp);
        return readRun(sp, runId);
      });
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
      const [attempt] =
        await tx`select a.id,a.ticket_id,a.machine_id,a.binding_revision,a.state from attempts a
        join workflow_steps s on s.ticket_id=a.ticket_id and s.run_id=${run.id}
        where a.id=${evidence.attempt_id} for share of a`;
      if (!attempt || attempt.ticket_id !== evidence.ticket_id)
        throw renderConflict('Receipt không thuộc attempt của run');
      // The receipt is registered while its attempt holds the workspace, before the runtime starts.
      if (attempt.state !== 'active') throw renderConflict('Attempt của receipt không còn hoạt động');
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
