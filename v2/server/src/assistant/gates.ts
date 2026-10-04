import { createHash, randomUUID } from 'node:crypto';
import { validPath } from '../docs/manifest.ts';
import { canonicalJson } from '../journal/canonical.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { immutableSnapshot, uuid } from '../tickets/assistant-access.ts';
import type { DecisionInput } from '../tickets/contracts.ts';
import { recordDecision } from '../tickets/decisions.ts';
import type { PersistedAssistantActorResolver } from './authority.ts';
import type {
  OrchestrationProof,
  OwnerQuestion,
  QuestionProposal,
  Sha256,
  WorkflowRun,
} from './contracts.ts';
import { operationRequestSha256 } from './operation-request.ts';
import type { DefinitionLookup, GateSpec, StepSpec, WorkflowDefinitionRecord } from './workflows.ts';
import { createDefinitionLookup, workflowSteps } from './workflows.ts';

/** One owner-approved parallel unit; an absent `dependsOn` means no dependency. */
export type ParallelUnitApproval = {
  key: string;
  title: string;
  ownershipKeys: string[];
  dependsOn?: string[];
};
/** Owner approval of independent units after the written plan, with the plan inputs they share. */
export type ParallelPlanApproval = { units: ParallelUnitApproval[]; sharedInputSha256: Sha256[] };
/**
 * Owner answer body. A gate question takes `approve`/`reject`; a question without a gate takes
 * `answer`. `executionMethod` and `parallel` exist only on the gate that resolves the
 * execution step (the written-plan gate).
 */
export type GateAnswer = {
  verdict: 'approve' | 'reject' | 'answer';
  option: string | null;
  executionMethod: string | null;
  parallel: ParallelPlanApproval | null;
  text: string;
};
export type RecordGateAnswerInput = {
  questionId: Id;
  expectedRevision: number;
  scopeSha256: Sha256;
  artifactSha256: Sha256 | null;
  answer: GateAnswer;
};
export type RecordedGateAnswer = {
  questionId: Id;
  revision: number;
  answerId: Id;
  decisionId: Id;
  gateId: Id | null;
  gateState: 'approved' | 'rejected' | null;
};
export type WorkflowGates = {
  /** `ask_owner`: the persisted Assistant asks through its own pending operation of this Tx. */
  createOwnerQuestion(tx: Tx, proof: OrchestrationProof, proposal: QuestionProposal): Promise<OwnerQuestion>;
  /**
   * Owner decision, immutable answer and gate advance in one all-or-nothing write. Takes the
   * journal `event_cursor` row lock first (as mutate() does), then root → project → ticket →
   * gate → question, so a caller must not hold any of those locks out of this order.
   */
  recordGateAnswer(tx: Tx, owner: Actor, input: RecordGateAnswerInput): Promise<RecordedGateAnswer>;
  answerGate(tx: Tx, questionId: Id, decisionId: Id): Promise<void>;
};
export type WorkflowGateDependencies = {
  resolver: PersistedAssistantActorResolver;
  lookup?: DefinitionLookup;
};

/** Context of a gate scope; every field comes from persisted rows, never from the caller. */
export type GateScope = {
  rootTicketId: Id;
  runId: Id;
  stepId: Id;
  gateId: Id;
  kind: string;
  requiredActor: GateSpec['requiredActor'];
  trigger: GateSpec['trigger'];
  sourcePath: string;
  sourceSha256: Sha256;
  artifactSha256: Sha256;
  cycleId: Id | null;
  definitionSha256: Sha256;
  customizationSha256: Sha256;
  renderedArtifactId: Id | null;
};
/** Context of a question that is bound to no gate. */
export type QuestionScope = {
  conversationId: Id;
  rootTicketId: Id;
  ticketId: Id;
  runId: Id | null;
  stepId: Id | null;
};

export function gateScopeSha256(scope: GateScope): Sha256 {
  return sha256(['crew-v2:workflow-gate-scope:1', scope]);
}
export function questionScopeSha256(scope: QuestionScope): Sha256 {
  return sha256(['crew-v2:owner-question-scope:1', scope]);
}

type ExecutionChoice = { method: string; skill: string; sourcePath: string; sourceSha256: Sha256 };
type Resolved = {
  verdict: GateAnswer['verdict'];
  executionChoice: ExecutionChoice | null;
  parallel: ParallelPlanApproval | null;
};
type Row = Record<string, unknown>;
type GateContext = {
  gate: Row;
  run: Row;
  step: Row;
  spec: StepSpec;
  gateSpec: GateSpec;
  record: WorkflowDefinitionRecord;
};
type QuestionContext = { root: Row; project: Row; question: Row; gate: GateContext | null };

const digest = /^[0-9a-f]{64}$/;
const unitKey = /^[a-z0-9][a-z0-9-]{0,63}$/;
const sha256 = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const plainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const same = (left: unknown, right: unknown) => {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
};
const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.length >= 1 && value.length <= max;
const nullableId = (value: unknown): value is Id | null =>
  value === null || (typeof value === 'string' && uuid.test(value));
const lower = (value: Id | null) => (value === null ? null : value.toLowerCase());
const idOrNull = (value: unknown): Id | null =>
  value === null || value === undefined ? null : String(value);

const invalid = () => new ApiError('VALIDATION', 400, 'Câu hỏi hoặc câu trả lời không hợp lệ');
const notFound = () => new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
const scopeMismatch = () =>
  new ApiError('WORKFLOW_QUESTION_SCOPE_MISMATCH', 409, 'Phạm vi câu hỏi không khớp');
const gateUnknown = () => new ApiError('WORKFLOW_GATE_UNKNOWN', 409, 'Gate không thuộc bước của run');
const artifactUnverified = () =>
  new ApiError('WORKFLOW_ARTIFACT_UNVERIFIED', 409, 'Artifact của gate chưa được xác minh');
const artifactMismatch = () =>
  new ApiError('WORKFLOW_GATE_ARTIFACT_MISMATCH', 409, 'Artifact không khớp gate');
const gateDecided = () => new ApiError('WORKFLOW_GATE_DECIDED', 409, 'Gate đã được quyết định');
const decisionInvalid = () =>
  new ApiError('WORKFLOW_GATE_DECISION_INVALID', 403, 'Quyết định không phải câu trả lời của chủ dự án');
const choiceInvalid = () =>
  new ApiError('WORKFLOW_EXECUTION_CHOICE_INVALID', 409, 'Lựa chọn thực thi không khớp definition của run');
const questionStale = () => new ApiError('WORKFLOW_QUESTION_STALE', 409, 'Câu hỏi đã có bản mới hơn');
const questionAnswered = () => new ApiError('WORKFLOW_QUESTION_ANSWERED', 409, 'Câu hỏi đã được trả lời');

// Question IDs derive from the operation, so one operation can ask exactly once.
function questionIdOf(operationId: Id): Id {
  const hex = sha256(['crew-v2:owner-question-id:1', operationId.toLowerCase()]);
  const variant = ((Number.parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const proposalKeys = [
  'conversationId',
  'ticketId',
  'runId',
  'stepId',
  'gateId',
  'cycleId',
  'artifactSha256',
  'question',
  'options',
  'scopeSha256',
] as const;

function validOptions(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 32 &&
    value.every((option) => text(option, 2000)) &&
    new Set(value).size === value.length
  );
}

function validateProposal(proposal: QuestionProposal): {
  submitted: QuestionProposal;
  input: QuestionProposal;
} {
  if (!plainObject(proposal) || !exactKeys(proposal, proposalKeys)) throw invalid();
  const submitted = immutableSnapshot(proposal);
  if (
    typeof submitted.conversationId !== 'string' ||
    !uuid.test(submitted.conversationId) ||
    !nullableId(submitted.ticketId) ||
    !nullableId(submitted.runId) ||
    !nullableId(submitted.stepId) ||
    !nullableId(submitted.gateId) ||
    !nullableId(submitted.cycleId) ||
    (submitted.artifactSha256 !== null &&
      (typeof submitted.artifactSha256 !== 'string' || !digest.test(submitted.artifactSha256))) ||
    !text(submitted.question, 32768) ||
    !validOptions(submitted.options) ||
    typeof submitted.scopeSha256 !== 'string' ||
    !digest.test(submitted.scopeSha256) ||
    (submitted.stepId !== null && submitted.runId === null) ||
    (submitted.gateId !== null && submitted.stepId === null) ||
    // Artifact and repair cycle exist only on a gate question.
    (submitted.gateId === null && (submitted.artifactSha256 !== null || submitted.cycleId !== null))
  )
    throw invalid();
  return {
    submitted,
    input: {
      ...submitted,
      conversationId: submitted.conversationId.toLowerCase(),
      ticketId: lower(submitted.ticketId),
      runId: lower(submitted.runId),
      stepId: lower(submitted.stepId),
      gateId: lower(submitted.gateId),
      cycleId: lower(submitted.cycleId),
    },
  };
}

// Ownership key in the server docs path convention (case-sensitive, relative, no `.`/`..`
// segment); `./` segments and one trailing `/` are dropped first. Invalid keys give null.
function ownershipPath(key: unknown): string | null {
  if (typeof key !== 'string' || key.length < 1 || key.length > 512) return null;
  const parts = key.split('/').filter((part) => part !== '.');
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  const path = parts.join('/');
  return validPath(path) ? path : null;
}
// Conflict comparison only: percent-decoded, NFC and lower case, because the project file
// system may fold case and Unicode form. Stored keys stay exactly as submitted.
const conflictKey = (path: string) => decodeURIComponent(path).normalize('NFC').toLowerCase();
const nested = (left: string, right: string) =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);

/**
 * Shared rule for owner-approved parallel units (gate answer and run policy): 2–16 units with
 * unique keys and titles, valid ownership paths, optional `dependsOn` naming other units. Two
 * units owning the same or a nested path, or any dependency between units, deny parallel
 * even with the owner's approval. Shape errors use the caller's error.
 */
export function parallelUnits(value: unknown, shapeError: () => ApiError): ParallelUnitApproval[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 16) throw shapeError();
  const keys = new Set<string>();
  const units: (ParallelUnitApproval & { paths: string[] })[] = [];
  for (const unit of value) {
    if (
      !plainObject(unit) ||
      !Object.keys(unit).every((field) => ['key', 'title', 'ownershipKeys', 'dependsOn'].includes(field)) ||
      typeof unit.key !== 'string' ||
      !unitKey.test(unit.key) ||
      keys.has(unit.key) ||
      !text(unit.title, 120) ||
      !Array.isArray(unit.ownershipKeys) ||
      unit.ownershipKeys.length < 1 ||
      unit.ownershipKeys.length > 64 ||
      (unit.dependsOn !== undefined && !Array.isArray(unit.dependsOn))
    )
      throw shapeError();
    const valid = unit.ownershipKeys.map(ownershipPath);
    if (valid.some((path) => path === null)) throw shapeError();
    const paths = (valid as string[]).map(conflictKey);
    if (new Set(paths).size !== paths.length) throw shapeError();
    keys.add(unit.key);
    units.push({
      key: unit.key,
      title: unit.title as string,
      ownershipKeys: [...(unit.ownershipKeys as string[])],
      dependsOn: [...((unit.dependsOn as unknown[] | undefined) ?? [])] as string[],
      paths,
    });
  }
  for (const unit of units)
    if (
      unit.dependsOn?.some((key) => typeof key !== 'string' || key === unit.key || !keys.has(key)) ||
      new Set(unit.dependsOn).size !== unit.dependsOn?.length
    )
      throw shapeError();
  for (const [index, unit] of units.entries())
    for (const other of units.slice(index + 1))
      if (unit.paths.some((path) => other.paths.some((otherPath) => nested(path, otherPath))))
        throw new ApiError('WORKFLOW_PARALLEL_OWNERSHIP_CONFLICT', 409, 'Các phần song song trùng sở hữu');
  if (units.some((unit) => (unit.dependsOn?.length ?? 0) > 0))
    throw new ApiError('WORKFLOW_PARALLEL_DEPENDENCY', 409, 'Các phần song song phụ thuộc nhau');
  return units.map(({ paths: _paths, ...unit }) => unit);
}

// Outer shape of a plan-gate parallel approval; the units are checked by `parallelUnits`
// once the gate is known to resolve the execution step.
function validateParallel(value: unknown): ParallelPlanApproval {
  if (
    !plainObject(value) ||
    !exactKeys(value, ['units', 'sharedInputSha256']) ||
    !Array.isArray(value.units) ||
    !Array.isArray(value.sharedInputSha256) ||
    value.sharedInputSha256.length < 1 ||
    value.sharedInputSha256.length > 64 ||
    value.sharedInputSha256.some((hash) => typeof hash !== 'string' || !digest.test(hash)) ||
    new Set(value.sharedInputSha256).size !== value.sharedInputSha256.length
  )
    throw invalid();
  return value as ParallelPlanApproval;
}

function validateAnswer(value: unknown): GateAnswer {
  if (
    !plainObject(value) ||
    !exactKeys(value, ['verdict', 'option', 'executionMethod', 'parallel', 'text']) ||
    !['approve', 'reject', 'answer'].includes(value.verdict as string) ||
    (value.option !== null && !text(value.option, 2000)) ||
    (value.executionMethod !== null && !text(value.executionMethod, 64)) ||
    !text(value.text, 32768)
  )
    throw invalid();
  if (value.parallel !== null) validateParallel(value.parallel);
  return value as GateAnswer;
}

function validateAnswerInput(input: RecordGateAnswerInput): RecordGateAnswerInput {
  if (
    !plainObject(input) ||
    !exactKeys(input, ['questionId', 'expectedRevision', 'scopeSha256', 'artifactSha256', 'answer'])
  )
    throw invalid();
  const snapshot = immutableSnapshot(input);
  if (
    typeof snapshot.questionId !== 'string' ||
    !uuid.test(snapshot.questionId) ||
    !Number.isSafeInteger(snapshot.expectedRevision) ||
    snapshot.expectedRevision < 1 ||
    typeof snapshot.scopeSha256 !== 'string' ||
    !digest.test(snapshot.scopeSha256) ||
    (snapshot.artifactSha256 !== null &&
      (typeof snapshot.artifactSha256 !== 'string' || !digest.test(snapshot.artifactSha256)))
  )
    throw invalid();
  validateAnswer(snapshot.answer);
  return { ...snapshot, questionId: snapshot.questionId.toLowerCase() };
}

function mapQuestion(row: Row): OwnerQuestion {
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    ticketId: idOrNull(row.ticket_id),
    runId: idOrNull(row.run_id),
    stepId: idOrNull(row.step_id),
    gateId: idOrNull(row.gate_id),
    cycleId: idOrNull(row.cycle_id),
    artifactSha256: row.artifact_sha256 === null ? null : String(row.artifact_sha256),
    question: String(row.question),
    options: row.options as string[],
    scopeSha256: String(row.scope_sha256),
    revision: Number(row.revision),
    state: row.state as OwnerQuestion['state'],
  };
}

/**
 * Official gate of a reserved gate ID. The step's stage comes from its ticket criteria but
 * is accepted only when it matches the pinned source table for the run's path and the
 * immutable step row (source, skill, reserved gate count and kinds).
 */
function gateSpecOf(
  run: Row,
  step: Row,
  criteria: unknown,
  gateId: Id,
): { spec: StepSpec; gateSpec: GateSpec } {
  const workflowRun = plainObject(criteria) ? criteria.workflowRun : undefined;
  const gateIds = step.gate_ids as Id[];
  const index = gateIds.indexOf(gateId);
  if (!plainObject(workflowRun) || workflowRun.runId !== run.id || index < 0) throw gateUnknown();
  const spec = workflowSteps(run.path as WorkflowRun['path']).find(
    (item) => item.key === workflowRun.stepKey,
  );
  const gateSpec = spec?.gates[index];
  const stated = Array.isArray(workflowRun.gates) ? (workflowRun.gates[index] as unknown) : undefined;
  if (
    !spec ||
    !gateSpec ||
    spec.sourcePath !== step.source_path ||
    spec.skill !== step.skill ||
    spec.gates.length !== gateIds.length ||
    !plainObject(stated) ||
    stated.id !== gateId ||
    stated.kind !== gateSpec.kind
  )
    throw gateUnknown();
  return { spec, gateSpec };
}

/**
 * Creates the gate, question and answer service. `answerGate` keeps the frozen signature;
 * every check re-reads persisted rows under the root lock.
 */
export function createWorkflowGates(deps: WorkflowGateDependencies): WorkflowGates {
  const resolver = deps?.resolver;
  if (typeof resolver !== 'function') throw new Error('WORKFLOW_GATE_DEPENDENCIES_INVALID');
  const lookup = deps.lookup ?? createDefinitionLookup();

  // The run's pinned definition must still be what the project's machine proves now.
  async function currentDefinition(tx: Tx, project: Row, run: Row): Promise<WorkflowDefinitionRecord> {
    const stale = () =>
      new ApiError('WORKFLOW_DEFINITION_STALE', 409, 'Definition của run không còn hiện hành');
    if (project.machine_id === null) throw stale();
    const record = await lookup(tx, String(project.machine_id), String(run.definition_sha256));
    if (
      !record ||
      !same(record.source, run.source) ||
      !same(record.projection, run.projection) ||
      record.definition.customizationSha256 !== run.customization_sha256
    )
      throw stale();
    return record;
  }

  async function stepCriteria(tx: Tx, ticketId: unknown): Promise<unknown> {
    const [row] = await tx`select criteria from tickets where id=${String(ticketId)}`;
    return row?.criteria;
  }

  // Artifact evidence on the gate's step ticket, registered by an attempt of the project's
  // current machine binding. The newest such registration (attempt fence, then evidence time)
  // is the step's current artifact; older bytes are superseded once anything newer differs.
  async function artifactState(
    tx: Tx,
    project: Row,
    step: Row,
    artifactSha256: string,
  ): Promise<'current' | 'superseded' | 'missing'> {
    if (project.machine_id === null) return 'missing';
    const rows = await tx`select e.data->>'sha256' as sha256,a.fence,e.created_at from evidence e
      join attempts a on a.id=e.attempt_id
      where e.ticket_id=${String(step.ticket_id)} and e.kind='artifact' and a.ticket_id=e.ticket_id
        and a.machine_id=${String(project.machine_id)} and a.binding_revision=${Number(project.binding_revision)}
      order by a.fence desc,e.created_at desc`;
    if (!rows.some((row) => row.sha256 === artifactSha256)) return 'missing';
    const [newest] = rows;
    if (!newest) return 'missing';
    const latest = rows.filter(
      (row) =>
        String(row.fence) === String(newest.fence) &&
        (row.created_at as Date).getTime() === (newest.created_at as Date).getTime(),
    );
    return latest.every((row) => row.sha256 === artifactSha256) ? 'current' : 'superseded';
  }
  async function assertArtifact(
    tx: Tx,
    project: Row,
    step: Row,
    artifactSha256: string,
    allowSuperseded: boolean,
  ): Promise<void> {
    const state = await artifactState(tx, project, step, artifactSha256);
    if (state === 'missing') throw artifactUnverified();
    if (state === 'superseded' && !allowSuperseded)
      throw new ApiError('WORKFLOW_ARTIFACT_SUPERSEDED', 409, 'Bước đã có artifact mới hơn');
  }

  // A run stays answerable only while no newer run of the same root exists (journal order
  // of the runs' step tickets, read through the project's event index). An unknown order,
  // for this run or any other run of the root, fails closed.
  async function assertRunCurrent(tx: Tx, run: Row, projectId: unknown): Promise<void> {
    const runs = await tx`select r.id,(select min(e.cursor) from workflow_steps s
        join events e on e.project_id=${String(projectId)} and e.ticket_id=s.ticket_id and e.type='ticket.created'
        where s.run_id=r.id) as cursor
      from workflow_runs r where r.root_ticket_id=${String(run.root_ticket_id)}`;
    const own = runs.find((row) => row.id === run.id);
    if (
      !own ||
      own.cursor === null ||
      runs.some(
        (row) => row.id !== run.id && (row.cursor === null || BigInt(row.cursor) > BigInt(own.cursor)),
      )
    )
      throw new ApiError('WORKFLOW_RUN_SUPERSEDED', 409, 'Run đã có run mới hơn thay thế');
  }

  // Only after three failed fixes, counted as failed initial or repair reviews of this run.
  async function triggerMet(tx: Tx, run: Row, gateSpec: GateSpec, cycleId: Id | null): Promise<void> {
    if (gateSpec.trigger === 'on_stage') {
      if (cycleId !== null) throw invalid();
      return;
    }
    const failed = await tx`select r.cycle_id from repair_results r
      join workflow_steps s on s.ticket_id=r.check_step_id
      where s.run_id=${String(run.id)} and r.passed=false and r.classification in ('initial_review','repair_review')`;
    const cycles = new Set(failed.map((row) => String(row.cycle_id)));
    if (cycleId === null || cycles.size < 3 || !cycles.has(cycleId))
      throw new ApiError('WORKFLOW_GATE_NOT_TRIGGERED', 409, 'Gate chưa đủ điều kiện mở');
  }

  function gateScope(
    root: Row,
    context: Omit<GateContext, 'gate' | 'record'>,
    gateId: Id,
    artifactSha256: string,
    cycleId: Id | null,
  ): GateScope {
    const { run, step, gateSpec } = context;
    return {
      rootTicketId: String(root.id),
      runId: String(run.id),
      stepId: String(step.id),
      gateId,
      kind: gateSpec.kind,
      requiredActor: gateSpec.requiredActor,
      trigger: gateSpec.trigger,
      sourcePath: String(step.source_path),
      sourceSha256: String(step.source_sha256),
      artifactSha256,
      cycleId,
      definitionSha256: String(run.definition_sha256),
      customizationSha256: String(run.customization_sha256),
      renderedArtifactId: idOrNull(run.rendered_artifact_id),
    };
  }

  // Official execution choices of the step this gate resolves, with the definition's hashes.
  async function executionChoicesOf(tx: Tx, context: GateContext): Promise<ExecutionChoice[] | null> {
    const rows = await tx`select s.id,s.skill,s.source_path,t.criteria from workflow_steps s
      join tickets t on t.id=s.ticket_id where s.run_id=${String(context.run.id)} order by s.id`;
    const resolved = rows.filter((row) => {
      const workflowRun = plainObject(row.criteria) ? row.criteria.workflowRun : undefined;
      return plainObject(workflowRun) && workflowRun.resolvedByGateId === context.gate.id;
    });
    if (resolved.length === 0) return null;
    const [row] = resolved;
    if (resolved.length !== 1 || !row) throw choiceInvalid();
    const workflowRun = (row.criteria as Row).workflowRun as Row;
    const spec = workflowSteps(context.run.path as WorkflowRun['path']).find(
      (item) => item.key === workflowRun.stepKey,
    );
    const stated = workflowRun.executionChoices;
    if (
      !spec?.executionChoices ||
      spec.resolvedBy?.stepKey !== context.spec.key ||
      spec.resolvedBy.gateKind !== context.gateSpec.kind ||
      spec.sourcePath !== row.source_path ||
      spec.skill !== row.skill ||
      !Array.isArray(stated) ||
      stated.length !== spec.executionChoices.length
    )
      throw choiceInvalid();
    const skills = new Map(context.record.definition.skills.map((skill) => [skill.path, skill.sha256]));
    return spec.executionChoices.map((choice, index) => {
      const item = stated[index] as unknown;
      const sourceSha256 = skills.get(choice.sourcePath);
      if (
        !plainObject(item) ||
        item.method !== choice.method ||
        item.skill !== choice.skill ||
        item.sourcePath !== choice.sourcePath ||
        !sourceSha256 ||
        item.sourceSha256 !== sourceSha256
      )
        throw choiceInvalid();
      return { method: choice.method, skill: choice.skill, sourcePath: choice.sourcePath, sourceSha256 };
    });
  }

  // Meaning of an answer for this question: verdict, the chosen execution and parallel units.
  async function resolveAnswer(tx: Tx, context: QuestionContext, answer: GateAnswer): Promise<Resolved> {
    const options = context.question.options as string[];
    if (answer.option !== null && !options.includes(answer.option)) throw invalid();
    const gate = context.gate;
    if (!gate) {
      if (answer.verdict !== 'answer' || answer.executionMethod !== null || answer.parallel !== null)
        throw invalid();
      return { verdict: 'answer', executionChoice: null, parallel: null };
    }
    if (answer.verdict === 'answer') throw invalid();
    const choices = await executionChoicesOf(tx, gate);
    if (!choices) {
      if (answer.executionMethod !== null) throw invalid();
      if (answer.parallel !== null)
        throw new ApiError(
          'WORKFLOW_PARALLEL_SCOPE_MISMATCH',
          409,
          'Duyệt song song chỉ thuộc gate kế hoạch',
        );
      return { verdict: answer.verdict, executionChoice: null, parallel: null };
    }
    if (answer.verdict === 'reject') {
      if (answer.executionMethod !== null || answer.parallel !== null) throw invalid();
      return { verdict: 'reject', executionChoice: null, parallel: null };
    }
    const executionChoice = choices.find((choice) => choice.method === answer.executionMethod);
    if (!executionChoice) throw invalid();
    const parallel = answer.parallel === null ? null : validateParallel(answer.parallel);
    if (parallel) parallelUnits(parallel.units, invalid);
    return { verdict: 'approve', executionChoice, parallel };
  }

  function decisionScope(question: Row, resolved: Resolved): Record<string, unknown> {
    return {
      questionId: String(question.id),
      questionRevision: Number(question.revision),
      gateId: idOrNull(question.gate_id),
      runId: idOrNull(question.run_id),
      stepId: idOrNull(question.step_id),
      artifactSha256: question.artifact_sha256 === null ? null : String(question.artifact_sha256),
      scopeSha256: String(question.scope_sha256),
      verdict: resolved.verdict,
      ...(resolved.executionChoice ? { executionChoice: resolved.executionChoice } : {}),
      ...(resolved.parallel ? { parallel: resolved.parallel } : {}),
    };
  }

  /**
   * Locks root → project → question ticket → gate → question, then re-reads the gate's run,
   * step, official spec and current definition.
   */
  async function loadQuestion(tx: Tx, questionId: Id): Promise<QuestionContext> {
    const [located] = await tx`select ticket_id from assistant_questions where id=${questionId}`;
    const [ticket] = located?.ticket_id
      ? await tx`select root_id from tickets where id=${String(located.ticket_id)}`
      : [];
    if (!located || !ticket) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy câu hỏi');
    const [root] = await tx`select * from tickets where id=${String(ticket.root_id)} for update`;
    const [project] = root
      ? await tx`select id,machine_id,binding_revision from projects where id=${String(root.project_id)} for share`
      : [];
    if (!root || !project) throw notFound();
    await tx`select id from tickets where id=${String(located.ticket_id)} for update`;
    const [unlocked] = await tx`select gate_id from assistant_questions where id=${questionId}`;
    const [gate] = unlocked?.gate_id
      ? await tx`select * from workflow_gates where id=${String(unlocked.gate_id)} for update`
      : [];
    const [question] = await tx`select * from assistant_questions where id=${questionId} for update`;
    if (!question) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy câu hỏi');
    if (root.status === 'done' || root.status === 'cancelled')
      throw new ApiError('TICKET_CLOSED', 409, 'Cây ticket đã kết thúc');
    const [run] = question.run_id
      ? await tx`select * from workflow_runs where id=${String(question.run_id)} for share`
      : [];
    if (question.run_id && (!run || run.root_ticket_id !== root.id)) throw notFound();
    if (run) await assertRunCurrent(tx, run, root.project_id);
    if (!gate) return { root, project, question, gate: null };
    const [step] = await tx`select * from workflow_steps where id=${String(gate.step_id)}`;
    if (!run || !step || gate.run_id !== run.id) throw notFound();
    const { spec, gateSpec } = gateSpecOf(run, step, await stepCriteria(tx, step.ticket_id), String(gate.id));
    const record = await currentDefinition(tx, project, run);
    return { root, project, question, gate: { gate, run, step, spec, gateSpec, record } };
  }

  async function answerGate(tx: Tx, questionId: Id, decisionId: Id): Promise<void> {
    if (
      typeof questionId !== 'string' ||
      !uuid.test(questionId) ||
      typeof decisionId !== 'string' ||
      !uuid.test(decisionId)
    )
      throw invalid();
    const context = await loadQuestion(tx, questionId.toLowerCase());
    const { question, gate } = context;
    if (question.state === 'answered') throw questionAnswered();
    if (question.state !== 'open') throw questionStale();
    const [decision] = await tx`select * from decisions where id=${decisionId.toLowerCase()} for share`;
    // A mandatory owner gate takes only the owner's approval; a plain question the owner's answer.
    const expectedKind = gate ? 'approval' : 'owner_answer';
    if (!decision) throw decisionInvalid();
    if (
      decision.actor_kind !== 'owner' ||
      decision.actor_id !== 'owner' ||
      decision.kind !== expectedKind ||
      (gate && gate.gateSpec.requiredActor !== 'owner')
    )
      throw decisionInvalid();
    if (decision.ticket_id !== question.ticket_id) throw scopeMismatch();
    const [answer] = await tx`select * from assistant_answers
      where question_id=${String(question.id)} and question_revision=${Number(question.revision)}`;
    if (!answer || answer.decision_id !== decision.id || answer.actor_kind !== 'owner')
      throw new ApiError('WORKFLOW_ANSWER_REQUIRED', 403, 'Thiếu câu trả lời của chủ dự án');
    const resolved = await resolveAnswer(tx, context, validateAnswer(answer.body));
    if (!same(decision.scope, decisionScope(question, resolved))) throw scopeMismatch();
    if (gate) {
      if (gate.gate.state !== 'pending' || gate.gate.decision_id !== null) throw gateDecided();
      if (
        gate.gate.artifact_sha256 !== question.artifact_sha256 ||
        gate.gate.scope_sha256 !== question.scope_sha256 ||
        gateScopeSha256(
          gateScope(
            context.root,
            gate,
            String(gate.gate.id),
            String(gate.gate.artifact_sha256),
            idOrNull(question.cycle_id),
          ),
        ) !== gate.gate.scope_sha256
      )
        throw scopeMismatch();
      // A superseded artifact may still be rejected, never approved.
      await assertArtifact(
        tx,
        context.project,
        gate.step,
        String(gate.gate.artifact_sha256),
        resolved.verdict === 'reject',
      );
      const [updated] = await tx`update workflow_gates
        set decision_id=${String(decision.id)},state=${resolved.verdict === 'approve' ? 'approved' : 'rejected'}
        where id=${String(gate.gate.id)} and decision_id is null and state='pending' returning id`;
      if (!updated) throw gateDecided();
    }
    const [answered] = await tx`update assistant_questions set state='answered'
      where id=${String(question.id)} and state='open' returning id`;
    if (!answered) throw questionAnswered();
  }

  return Object.freeze({
    async createOwnerQuestion(
      tx: Tx,
      proof: OrchestrationProof,
      proposal: QuestionProposal,
    ): Promise<OwnerQuestion> {
      const { submitted, input } = validateProposal(proposal);
      if (!plainObject(proof) || typeof proof.operationId !== 'string' || !uuid.test(proof.operationId))
        throw invalid();
      const operationId = proof.operationId.toLowerCase();
      if (input.ticketId === null)
        throw new ApiError('WORKFLOW_QUESTION_TICKET_REQUIRED', 422, 'Câu hỏi phải gắn với một ticket');
      // Lock order matches the scoped ticket writers: root → project → persisted Actor.
      const [target] = await tx`select root_id from tickets where id=${input.ticketId}`;
      const [root] = target
        ? await tx`select * from tickets where id=${String(target.root_id)} for update`
        : [];
      const [project] = root
        ? await tx`select id,machine_id,binding_revision from projects where id=${String(root.project_id)} for share`
        : [];
      if (!root || !project) throw notFound();
      await resolver(tx, proof);
      const [scope] = await tx`select turn_id,root_ticket_id,project_id,tool_names,input_snapshot_id
        from assistant_scopes where id=${proof.scopeId}`;
      if (!scope) throw new ApiError('ASSISTANT_SCOPE_NOT_FOUND', 404, 'Không tìm thấy phạm vi Trợ lý');
      if (
        scope.root_ticket_id !== root.id ||
        (scope.project_id !== null && scope.project_id !== root.project_id)
      )
        throw notFound();
      if (!Array.isArray(scope.tool_names) || !scope.tool_names.includes('ask_owner'))
        throw new ApiError('ORCHESTRATION_ACTION_NOT_IN_SCOPE', 403, 'Hành động ngoài phạm vi Trợ lý');
      // The tools route writes the pending row in this same Tx for exactly this proposal.
      const [operation] =
        await tx`select turn_id,state,input_snapshot_id,request_hash from assistant_tool_operations
        where operation_id=${operationId} and xmin=pg_current_xact_id()::xid for update`;
      if (!operation || operation.turn_id !== proof.fence.turnId || operation.state !== 'pending')
        throw new ApiError('ASSISTANT_OPERATION_NOT_FOUND', 404, 'Không tìm thấy thao tác Trợ lý');
      if (operation.input_snapshot_id !== scope.input_snapshot_id)
        throw new ApiError('ASSISTANT_OPERATION_STALE', 409, 'Thao tác Trợ lý không cùng input của phạm vi');
      if (operation.request_hash !== operationRequestSha256({ action: 'ask_owner', payload: submitted }))
        throw new ApiError(
          'ORCHESTRATION_REQUEST_MISMATCH',
          403,
          'Thao tác Trợ lý không được ghi cho yêu cầu này',
        );
      const questionId = questionIdOf(operationId);
      const [asked] = await tx`select id from assistant_questions where id=${questionId}`;
      if (asked) throw new ApiError('ASSISTANT_OPERATION_CONSUMED', 409, 'Thao tác Trợ lý đã được dùng');
      const [turn] = await tx`select conversation_id from assistant_turns where id=${proof.fence.turnId}`;
      if (turn?.conversation_id !== input.conversationId) throw scopeMismatch();
      if (root.status === 'done' || root.status === 'cancelled')
        throw new ApiError('TICKET_CLOSED', 409, 'Cây ticket đã kết thúc');
      const [run] = input.runId
        ? await tx`select * from workflow_runs where id=${input.runId} for share`
        : [];
      if (input.runId && (!run || run.root_ticket_id !== root.id)) throw notFound();
      if (run) await assertRunCurrent(tx, run, root.project_id);
      const [step] = input.stepId
        ? await tx`select * from workflow_steps where id=${input.stepId} and run_id=${input.runId}`
        : [];
      if (input.stepId && (!step || step.ticket_id !== input.ticketId)) throw gateUnknown();
      if (!input.gateId) {
        const expected = questionScopeSha256({
          conversationId: input.conversationId,
          rootTicketId: String(root.id),
          ticketId: input.ticketId,
          runId: input.runId,
          stepId: input.stepId,
        });
        if (input.scopeSha256 !== expected) throw scopeMismatch();
        return tx.savepoint(async (sp) => {
          const [row] =
            await sp`insert into assistant_questions(id,conversation_id,ticket_id,run_id,step_id,gate_id,
            cycle_id,artifact_sha256,question,options,scope_sha256,revision,state)
            values(${questionId},${input.conversationId},${input.ticketId},${input.runId},${input.stepId},null,null,null,
            ${input.question},${sp.json(input.options)},${expected},1,'open') returning *`;
          return mapQuestion(row as Row);
        });
      }
      // Gate question: an exact verified artifact materializes the reserved gate first.
      const gateId = input.gateId;
      if (input.artifactSha256 === null)
        throw new ApiError('WORKFLOW_ARTIFACT_REQUIRED', 409, 'Gate chỉ mở khi đã có artifact');
      const artifactSha256 = input.artifactSha256;
      if (!run || !step) throw gateUnknown();
      await tx`select id from tickets where id=${input.ticketId} for update`;
      const { spec, gateSpec } = gateSpecOf(run, step, await stepCriteria(tx, step.ticket_id), gateId);
      await currentDefinition(tx, project, run);
      if ((run.path === 'bmad-dispatch' || run.path === 'bmad-oneshot') && run.rendered_artifact_id === null)
        throw new ApiError('WORKFLOW_RENDER_REQUIRED', 409, 'Run BMAD chưa ghim render');
      await triggerMet(tx, run, gateSpec, input.cycleId);
      await assertArtifact(tx, project, step, artifactSha256, false);
      const [gate] = await tx`select * from workflow_gates where id=${gateId} for update`;
      if (gate) {
        if (gate.state !== 'pending') throw gateDecided();
        if (gate.artifact_sha256 !== artifactSha256) throw artifactMismatch();
      }
      const expected = gateScopeSha256(
        gateScope(root, { run, step, spec, gateSpec }, gateId, artifactSha256, input.cycleId),
      );
      if (input.scopeSha256 !== expected || (gate && gate.scope_sha256 !== expected)) throw scopeMismatch();
      return tx.savepoint(async (sp) => {
        if (!gate)
          await sp`insert into workflow_gates(id,run_id,step_id,kind,source_path,source_sha256,artifact_sha256,
            scope_sha256,required_actor,decision_id,state)
            values(${gateId},${String(run.id)},${String(step.id)},${gateSpec.kind},${String(step.source_path)},
            ${String(step.source_sha256)},${artifactSha256},${expected},${gateSpec.requiredActor},null,'pending')`;
        // A new question for the gate supersedes the open one; its revision follows the last.
        await sp`select id from assistant_questions where gate_id=${gateId} order by id for update`;
        const [last] =
          await sp`select coalesce(max(revision),0) as revision from assistant_questions where gate_id=${gateId}`;
        await sp`update assistant_questions set state='superseded' where gate_id=${gateId} and state='open'`;
        const [row] =
          await sp`insert into assistant_questions(id,conversation_id,ticket_id,run_id,step_id,gate_id,
          cycle_id,artifact_sha256,question,options,scope_sha256,revision,state)
          values(${questionId},${input.conversationId},${input.ticketId},${String(run.id)},${String(step.id)},${gateId},
          ${input.cycleId},${artifactSha256},${input.question},${sp.json(input.options)},${expected},
          ${Number(last?.revision ?? 0) + 1},'open') returning *`;
        return mapQuestion(row as Row);
      });
    },

    async recordGateAnswer(
      tx: Tx,
      owner: Actor,
      request: RecordGateAnswerInput,
    ): Promise<RecordedGateAnswer> {
      // A machine (the Assistant included) never answers for the owner.
      if (!plainObject(owner) || owner.kind !== 'owner' || owner.id !== 'owner')
        throw new ApiError('OWNER_REQUIRED', 403, 'Cần quyền chủ dự án');
      const input = validateAnswerInput(request);
      // Journal cursor before the root, in mutate()'s order: the decision appends an event.
      await tx`select value from event_cursor where singleton = true for update`;
      const context = await loadQuestion(tx, input.questionId);
      const { question, gate } = context;
      if (question.state === 'answered') throw questionAnswered();
      if (question.state !== 'open' || Number(question.revision) !== input.expectedRevision)
        throw questionStale();
      if (question.scope_sha256 !== input.scopeSha256) throw scopeMismatch();
      if (question.artifact_sha256 !== input.artifactSha256) throw artifactMismatch();
      if (gate && (gate.gate.state !== 'pending' || gate.gate.decision_id !== null)) throw gateDecided();
      const resolved = await resolveAnswer(tx, context, input.answer);
      const decision: DecisionInput = {
        kind: gate ? 'approval' : 'owner_answer',
        content: input.answer.text,
        rationale: `Chủ dự án trả lời câu hỏi ${String(question.id)} bản ${Number(question.revision)}`,
        sources: [],
        scope: decisionScope(question, resolved),
      };
      // All-or-nothing: any failure undoes the decision and answer while the caller's
      // transaction stays usable.
      return tx.savepoint(async (sp) => {
        const decisionId = await recordDecision(sp, String(question.ticket_id), decision, owner);
        const answerId = randomUUID();
        await sp`insert into assistant_answers(id,question_id,question_revision,body,actor_kind,decision_id)
          values(${answerId},${String(question.id)},${Number(question.revision)},${sp.json(input.answer as never)},
          'owner',${decisionId})`;
        await answerGate(sp, String(question.id), decisionId);
        return {
          questionId: String(question.id),
          revision: Number(question.revision),
          answerId,
          decisionId,
          gateId: idOrNull(question.gate_id),
          gateState:
            resolved.verdict === 'approve' ? 'approved' : resolved.verdict === 'reject' ? 'rejected' : null,
        };
      });
    },

    answerGate,
  });
}
