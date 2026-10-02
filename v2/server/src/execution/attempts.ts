import { randomUUID } from 'node:crypto';
import { samePin } from '../../../src/workflow-policy.ts';
import { canonicalJson } from '../journal/canonical.ts';
import { appendEvent } from '../journal/events.ts';
import type {
  Actor,
  AuthorizeDispatch,
  Db,
  DispatchPermit,
  Id,
  ServerOptions,
  Tx,
} from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import { readCompletionFacts } from '../tickets/completion.ts';
import type { DocsCompletionReader, ExecutionAuthority, RepairResultInput } from '../tickets/contracts.ts';
import { recordDecision } from '../tickets/decisions.ts';
import { readDeployAuthorization } from '../tickets/deploy.ts';
import { createTicketServices, requireTicket } from '../tickets/service.ts';
import type { Attempt, AttemptResultInput, Checkpoint, Command, TerminalIntent } from './contracts.ts';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fencePattern = /^[1-9][0-9]*$/;
const commitPattern = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const pendingCodes = new Set([
  'FINAL_VERIFICATION_PENDING',
  'FINAL_RESULT_NOT_VERIFIED',
  'COMPLETION_GATE',
  'DOCS_NOT_VERIFIED',
]);
export type FinalResultVerifier = ServerOptions['verifyFinalResult'];
export const denyDispatch: AuthorizeDispatch = async () => {
  throw new ApiError('DISPATCH_NOT_CONFIGURED', 503, 'Chưa cấu hình kiểm tra quyền thực thi');
};
export const denyFinalResult: FinalResultVerifier = async () => {
  throw new ApiError('FINAL_VERIFICATION_PENDING', 503, 'Chưa cấu hình kiểm chứng kết quả cuối');
};

export function mapAttempt(row: Record<string, unknown>): Attempt {
  return {
    id: row.id as Id,
    ticketId: row.ticket_id as Id,
    machineId: row.machine_id as Id,
    commandId: row.command_id as Id,
    fence: String(row.fence),
    bindingRevision: Number(row.binding_revision),
    processInstanceId: row.process_instance_id as string,
    state: row.state as Attempt['state'],
    leaseExpiresAt: (row.lease_expires_at as Date).toISOString(),
    workflowPin: row.workflow_pin as Attempt['workflowPin'],
    checkpoint: row.checkpoint as Checkpoint,
    terminalIntent: row.terminal_intent as TerminalIntent,
    terminalReason: row.terminal_reason as string | null,
    terminalResult: row.terminal_result as AttemptResultInput | null,
    stoppedAt: row.stopped_at ? (row.stopped_at as Date).toISOString() : null,
    finalizedAt: row.finalized_at ? (row.finalized_at as Date).toISOString() : null,
  };
}

function machine(actor: Actor): Id {
  if (actor.kind !== 'machine') throw new ApiError('MACHINE_REQUIRED', 403, 'Cần máy thực thi');
  return actor.id;
}
function assertFence(
  row: Record<string, unknown>,
  fence: string,
  processInstanceId: string,
  actor: Actor,
): void {
  if (
    !fencePattern.test(fence) ||
    String(row.fence) !== fence ||
    row.process_instance_id !== processInstanceId ||
    row.machine_id !== machine(actor)
  )
    throw new ApiError('STALE_FENCE', 409, 'Attempt hoặc fence đã cũ');
}
async function lockedAttempt(tx: Tx, id: Id, actor: Actor): Promise<Record<string, unknown>> {
  const [scope] =
    await tx`select a.ticket_id,t.root_id from attempts a join tickets t on t.id=a.ticket_id where a.id=${id}`;
  if (!scope) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy attempt');
  await tx`select id from tickets where id=${scope.root_id} for update`;
  const [row] =
    await tx`select a.*,t.project_id,t.revision as ticket_revision,t.status as ticket_status,t.wait_reason,p.machine_id as bound_machine_id,p.binding_revision as current_binding_revision,m.revoked_at,g.active_attempt_id from attempts a join tickets t on t.id=a.ticket_id join projects p on p.id=t.project_id join machines m on m.id=a.machine_id join execution_guards g on g.ticket_id=a.ticket_id where a.id=${id} for update of t,g,a`;
  if (!row || row.machine_id !== machine(actor) || row.bound_machine_id !== actor.id || row.revoked_at)
    throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy attempt');
  return row;
}
async function assertCurrent(
  tx: Tx,
  row: Record<string, unknown>,
  fence: string,
  processInstanceId: string,
  actor: Actor,
): Promise<void> {
  assertFence(row, fence, processInstanceId, actor);
  if (row.active_attempt_id !== row.id) throw new ApiError('STALE_FENCE', 409, 'Attempt đã bị thay thế');
  const [project] =
    await tx`select machine_id,binding_revision from projects where id=${row.project_id as Id}`;
  if (
    !project ||
    project.machine_id !== actor.id ||
    Number(project.binding_revision) !== Number(row.binding_revision)
  )
    throw new ApiError('STALE_BINDING', 409, 'Liên kết máy đã đổi');
}

function checkPermit(
  permit: DispatchPermit,
  command: Record<string, unknown>,
  ticket: Record<string, unknown>,
  project: Record<string, unknown>,
  actor: Actor,
): void {
  const checked = Date.parse(permit?.checkedAt ?? '');
  const expires = Date.parse(permit?.expiresAt ?? '');
  const now = Date.now();
  if (
    !permit ||
    permit.commandId !== command.id ||
    permit.ticketId !== ticket.id ||
    permit.machineId !== actor.id ||
    permit.bindingRevision !== Number(project.binding_revision) ||
    permit.ticketRevision !== Number(ticket.revision) ||
    !permit.workflow ||
    !samePin(permit.workflow, ticket.workflow_pin as DispatchPermit['workflow']) ||
    !uuid.test(permit.telemetryId) ||
    !uuid.test(permit.decisionId) ||
    !Number.isFinite(checked) ||
    !Number.isFinite(expires) ||
    checked > now + 5000 ||
    expires <= now ||
    expires - checked > 30000 ||
    expires <= checked
  )
    throw new ApiError('DISPATCH_PERMIT_INVALID', 409, 'Giấy phép thực thi không còn hợp lệ');
}

export async function claimAttempt(
  tx: Tx,
  commandId: Id,
  input: { processInstanceId: string; permit: DispatchPermit },
  actor: Actor,
  authorizeDispatch: AuthorizeDispatch,
): Promise<Attempt> {
  const machineId = machine(actor);
  if (!uuid.test(input.processInstanceId))
    throw new ApiError('VALIDATION', 400, 'Mã tiến trình không hợp lệ');
  const [scope] =
    await tx`select t.root_id from commands c join tickets t on t.id=c.ticket_id where c.id=${commandId}`;
  if (!scope) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy lệnh');
  await tx`select id from tickets where id=${scope.root_id} for update`;
  const [command] = await tx`select * from commands where id=${commandId} for update`;
  const [ticket] = await tx`select * from tickets where id=${command?.ticket_id} for update`;
  const [project] = await tx`select * from projects where id=${ticket?.project_id} for update`;
  const [host] = await tx`select revoked_at from machines where id=${machineId}`;
  if (
    !command ||
    !ticket ||
    !project ||
    !host ||
    host.revoked_at ||
    command.machine_id !== machineId ||
    project.machine_id !== machineId ||
    Number(command.binding_revision) !== Number(project.binding_revision)
  )
    throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy lệnh');
  const [prior] = await tx`select * from attempts where command_id=${commandId}`;
  if (prior) {
    if (prior.process_instance_id !== input.processInstanceId)
      throw new ApiError('CLAIM_CONFLICT', 409, 'Lệnh đã được nhận bởi tiến trình khác');
    return mapAttempt(prior);
  }
  await tx`insert into execution_guards(ticket_id) values(${ticket.id}) on conflict do nothing`;
  const [guard] = await tx`select * from execution_guards where ticket_id=${ticket.id} for update`;
  if (guard?.active_attempt_id) {
    const [reserved] = await tx`select state from attempts where id=${guard.active_attempt_id}`;
    if (reserved?.state === 'finalizing')
      throw new ApiError('FINAL_RESULT_PENDING', 409, 'Cần xử lý kết quả của tiến trình đã dừng');
    throw new ApiError('RECONCILE_REQUIRED', 409, 'Cần đối chiếu tiến trình cũ');
  }
  if (String(guard?.fence) === '9223372036854775807')
    throw new ApiError('FENCE_EXHAUSTED', 409, 'Bộ đếm fence đã đạt giới hạn');
  if (
    !['start', 'resume'].includes(String(command.type)) ||
    command.state === 'completed' ||
    ticket.status !== 'ready'
  )
    throw new ApiError('TICKET_NOT_READY', 409, 'Lệnh không còn sẵn sàng');
  const [pending] =
    await tx`select 1 from dependencies d join tickets p on p.id=d.predecessor_id where d.ticket_id=${ticket.id} and p.status<>'done' limit 1`;
  if (pending) throw new ApiError('DEPENDENCIES_NOT_READY', 409, 'Phụ thuộc chưa hoàn thành');
  if (ticket.kind === 'deploy' && !(await readDeployAuthorization(tx, ticket.id as Id)))
    throw new ApiError('DEPLOY_OWNER_INTENT_REQUIRED', 403, 'Cần chủ dự án duyệt deploy');
  if (!ticket.workflow_pin) throw new ApiError('WORKFLOW_PIN_REQUIRED', 409, 'Ticket chưa ghim workflow');
  checkPermit(input.permit, command, ticket, project, actor);
  await authorizeDispatch(tx, actor, input.permit);
  const [next] =
    await tx`update execution_guards set fence=fence+1 where ticket_id=${ticket.id} returning fence`;
  const id = randomUUID();
  const [row] =
    await tx`insert into attempts(id,ticket_id,machine_id,command_id,fence,binding_revision,process_instance_id,state,lease_expires_at,workflow_pin,checkpoint) values(${id},${ticket.id},${machineId},${commandId},${next?.fence},${project.binding_revision},${input.processInstanceId},'active',now()+interval '60 seconds',${tx.json(input.permit.workflow)},${tx.json({ sequence: '0', step: '', artifactIds: [], commit: null, processInstanceId: input.processInstanceId })}) returning *`;
  await tx`update execution_guards set active_attempt_id=${id} where ticket_id=${ticket.id}`;
  const services = createTicketServices({ execution: createExecutionAuthority() });
  await services.applyExecutionSignal(tx, ticket.id as Id, 'start', Number(ticket.revision), null, actor);
  await appendEvent(tx, {
    type: 'attempt.claimed',
    projectId: ticket.project_id as Id,
    ticketId: ticket.id as Id,
    audienceMachineId: machineId,
    data: { attemptId: id, commandId, fence: String(next?.fence) },
  });
  return mapAttempt(row as Record<string, unknown>);
}

export async function saveCheckpoint(
  tx: Tx,
  attemptId: Id,
  input: Checkpoint & { fence: string },
  actor: Actor,
): Promise<Attempt> {
  const row = await lockedAttempt(tx, attemptId, actor);
  await assertCurrent(tx, row, input.fence, input.processInstanceId, actor);
  if (row.state === 'finalizing' || row.state === 'stopped')
    throw new ApiError('PROCESS_STOPPED', 409, 'Tiến trình đã dừng');
  if ((row.lease_expires_at as Date).getTime() <= Date.now()) {
    const [uncertain] = await tx`update attempts set state='uncertain' where id=${attemptId} returning *`;
    return mapAttempt(uncertain as Record<string, unknown>);
  }
  if (
    !/^(0|[1-9][0-9]*)$/.test(input.sequence) ||
    !input.step ||
    input.step.length > 200 ||
    input.artifactIds.length > 100 ||
    input.artifactIds.some((id) => !uuid.test(id)) ||
    (input.commit !== null && !commitPattern.test(input.commit))
  )
    throw new ApiError('VALIDATION', 400, 'Checkpoint không hợp lệ');
  const sequence = BigInt(input.sequence),
    current = BigInt(String(row.checkpoint_sequence));
  if (
    sequence < current ||
    (sequence === current &&
      canonicalJson(row.checkpoint) !==
        canonicalJson({
          sequence: input.sequence,
          step: input.step,
          artifactIds: input.artifactIds,
          commit: input.commit,
          processInstanceId: input.processInstanceId,
        }))
  )
    throw new ApiError('CHECKPOINT_CONFLICT', 409, 'Checkpoint đã cũ hoặc khác dữ liệu');
  if (sequence === current) return mapAttempt(row);
  await assertEvidence(tx, row, input.artifactIds, 'artifact');
  const checkpoint = {
    sequence: input.sequence,
    step: input.step,
    artifactIds: input.artifactIds,
    commit: input.commit,
    processInstanceId: input.processInstanceId,
  };
  const [updated] =
    await tx`update attempts set checkpoint=${tx.json(checkpoint)},checkpoint_sequence=${input.sequence},lease_expires_at=now()+interval '60 seconds',state='active' where id=${attemptId} returning *`;
  await appendEvent(tx, {
    type: 'attempt.checkpoint',
    projectId: row.project_id as Id,
    ticketId: row.ticket_id as Id,
    audienceMachineId: actor.id as Id,
    data: { attemptId, sequence: input.sequence },
  });
  return mapAttempt(updated as Record<string, unknown>);
}

async function assertEvidence(tx: Tx, row: Record<string, unknown>, ids: Id[], kind?: string): Promise<void> {
  if (ids.length > 100 || new Set(ids).size !== ids.length || ids.some((id) => !uuid.test(id)))
    throw new ApiError('VALIDATION', 400, 'Danh sách bằng chứng không hợp lệ');
  if (!ids.length) return;
  const found =
    await tx`select id,kind from evidence where id=any(${tx.array(ids)}::uuid[]) and ticket_id=${row.ticket_id as Id} and attempt_id=${row.id as Id}`;
  if (found.length !== ids.length || (kind && found.some((item) => item.kind !== kind)))
    throw new ApiError('EVIDENCE_SCOPE', 422, 'Bằng chứng không thuộc attempt');
}

export async function registerArtifactEvidence(
  tx: Tx,
  attemptId: Id,
  input: {
    fence: string;
    processInstanceId: string;
    sha256: string;
    locator: string;
    sourceCommit: string | null;
  },
  actor: Actor,
): Promise<{ id: Id; locator: string; sha256: string }> {
  const row = await lockedAttempt(tx, attemptId, actor);
  await assertCurrent(tx, row, input.fence, input.processInstanceId, actor);
  if (row.state === 'stopped') throw new ApiError('PROCESS_STOPPED', 409, 'Attempt đã hoàn tất');
  if (row.state === 'uncertain')
    throw new ApiError('RECONCILE_REQUIRED', 409, 'Cần đối chiếu tiến trình trước khi ghi artifact');
  const locator = input.locator;
  if (
    typeof input.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(input.sha256) ||
    typeof locator !== 'string' ||
    locator.length < 1 ||
    locator.length > 4096 ||
    locator !== locator.normalize('NFC') ||
    locator.startsWith('/') ||
    locator.includes('\\') ||
    /[%?#:]/.test(locator) ||
    [...locator].some((character) => character.charCodeAt(0) < 32) ||
    locator.split('/').some((part) => !part || part === '.' || part === '..') ||
    (input.sourceCommit !== null && !commitPattern.test(input.sourceCommit))
  )
    throw new ApiError('VALIDATION', 400, 'Nguồn artifact không hợp lệ');
  const id = randomUUID();
  await tx`insert into evidence(id,ticket_id,attempt_id,kind,data) values(${id},${row.ticket_id as Id},${attemptId},'artifact',${tx.json({ locator, sha256: input.sha256, sourceCommit: input.sourceCommit, verification: 'reported' })})`;
  return { id, locator, sha256: input.sha256 };
}

export async function readAttempt(db: Db, id: Id, actor: Actor): Promise<Attempt> {
  const machineId = machine(actor);
  const [row] =
    await db`select a.* from attempts a join tickets t on t.id=a.ticket_id join projects p on p.id=t.project_id join machines m on m.id=a.machine_id where a.id=${id} and a.machine_id=${machineId} and p.machine_id=${machineId} and p.binding_revision=a.binding_revision and m.revoked_at is null`;
  if (!row) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy attempt');
  return mapAttempt(row);
}

export async function authorizeAttemptMutation(tx: Tx, id: Id, actor: Actor): Promise<void> {
  const machineId = machine(actor);
  const [scope] =
    await tx`select a.ticket_id,a.machine_id,a.binding_revision,t.root_id,t.project_id from attempts a join tickets t on t.id=a.ticket_id where a.id=${id}`;
  if (!scope || scope.machine_id !== machineId)
    throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy attempt');
  await tx`select id from tickets where id=${scope.root_id} for update`;
  await tx`select id from tickets where id=${scope.ticket_id} for update`;
  const [project] =
    await tx`select machine_id,binding_revision from projects where id=${scope.project_id} for update`;
  const [host] = await tx`select revoked_at from machines where id=${machineId}`;
  if (
    !project ||
    !host ||
    host.revoked_at ||
    project.machine_id !== machineId ||
    Number(project.binding_revision) !== Number(scope.binding_revision)
  )
    throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy attempt');
}

export async function assertNoActiveProjectExecution(tx: Tx, projectId: Id): Promise<void> {
  const [active] =
    await tx`select 1 from execution_guards g join tickets t on t.id=g.ticket_id left join attempts a on a.ticket_id=t.id and a.state in ('active','uncertain','finalizing') where t.project_id=${projectId} and (g.active_attempt_id is not null or a.id is not null) limit 1`;
  if (active) throw new ApiError('ACTIVE_EXECUTION', 409, 'Dự án còn tiến trình chưa đối chiếu');
}

export function createExecutionAuthority(): ExecutionAuthority {
  return {
    async verifySignal(tx, ticketId, signal, evidenceId) {
      const [row] =
        await tx`select a.*,p.machine_id as bound_machine_id,p.binding_revision as current_binding_revision,m.revoked_at from execution_guards g join attempts a on a.id=g.active_attempt_id join tickets t on t.id=g.ticket_id join projects p on p.id=t.project_id join machines m on m.id=a.machine_id where g.ticket_id=${ticketId}`;
      if (
        !row ||
        row.bound_machine_id !== row.machine_id ||
        Number(row.current_binding_revision) !== Number(row.binding_revision) ||
        row.revoked_at
      )
        throw new ApiError('EXECUTION_PROOF_REQUIRED', 409, 'Thiếu attempt đang giữ quyền');
      if (signal === 'start' && row.state === 'active') return;
      if (row.state !== 'finalizing' || !row.stopped_at)
        throw new ApiError('EXECUTION_PROOF_REQUIRED', 409, 'Chưa xác nhận dừng tiến trình');
      const intent = row.terminal_intent;
      const valid =
        (signal === 'passed' &&
          intent === 'complete' &&
          !!row.terminal_result &&
          row.terminal_result.outcome === 'passed') ||
        (signal === 'reconciled_stopped' && intent === 'retry') ||
        (signal === 'wait_owner' && intent === 'needs_input') ||
        (signal === 'pause_confirmed' && intent === 'pause') ||
        (signal === 'cancel_confirmed' && intent === 'cancel');
      if (!valid) throw new ApiError('EXECUTION_PROOF_REQUIRED', 409, 'Ý định kết thúc không khớp');
      if (evidenceId && !(row.terminal_result?.evidenceIds as Id[] | undefined)?.includes(evidenceId))
        throw new ApiError('EVIDENCE_SCOPE', 422, 'Bằng chứng không thuộc kết quả');
    },
    async requestTerminalIntent(tx, ticketId, _intent, reason) {
      await setTerminalIntent(tx, ticketId, 'needs_input', reason, null, { kind: 'owner', id: 'owner' });
      const [reserved] =
        await tx`select a.id,a.state from execution_guards g join attempts a on a.id=g.active_attempt_id where g.ticket_id=${ticketId}`;
      if (reserved?.state === 'finalizing') await finalizeAttempt(tx, reserved.id as Id);
    },
    async verifyRepairResult(tx, input: RepairResultInput) {
      const [row] =
        await tx`select a.*,g.active_attempt_id,t.project_id,p.machine_id as bound_machine_id,p.binding_revision as current_binding_revision,m.revoked_at from attempts a join execution_guards g on g.ticket_id=a.ticket_id join tickets t on t.id=a.ticket_id join projects p on p.id=t.project_id join machines m on m.id=a.machine_id where a.id=${input.attemptId}`;
      if (
        !row ||
        row.ticket_id !== input.ticketId ||
        String(row.fence) !== input.fence ||
        row.active_attempt_id !== row.id ||
        (row.state !== 'active' && !(row.state === 'finalizing' && row.stopped_at)) ||
        row.bound_machine_id !== row.machine_id ||
        Number(row.current_binding_revision) !== Number(row.binding_revision) ||
        row.revoked_at
      )
        throw new ApiError('STALE_FENCE', 409, 'Kết quả sửa không thuộc attempt đang chạy');
    },
  };
}

export async function submitAttemptResult(
  tx: Tx,
  id: Id,
  input: AttemptResultInput,
  actor: Actor,
  verify: FinalResultVerifier = denyFinalResult,
  docsCompletion?: DocsCompletionReader,
): Promise<Attempt> {
  const row = await lockedAttempt(tx, id, actor);
  await assertCurrent(tx, row, input.fence, input.processInstanceId, actor);
  if (row.state === 'stopped') throw new ApiError('PROCESS_STOPPED', 409, 'Attempt đã hoàn tất');
  if (
    !['passed', 'retry', 'needs_input'].includes(input.outcome) ||
    (input.outcome === 'needs_input' && !input.reason) ||
    (input.reason !== null && (typeof input.reason !== 'string' || input.reason.length > 32768))
  )
    throw new ApiError('VALIDATION', 400, 'Kết quả không hợp lệ');
  await assertEvidence(tx, row, input.evidenceIds);
  if (row.terminal_result && canonicalJson(row.terminal_result) !== canonicalJson(input))
    throw new ApiError('RESULT_CONFLICT', 409, 'Kết quả đã được ghi khác');
  if (!row.terminal_result) {
    await tx`update attempts set terminal_result=${tx.json(input)} where id=${id}`;
    if (input.outcome === 'needs_input' && row.terminal_intent !== 'cancel') {
      await recordDecision(
        tx,
        row.ticket_id as Id,
        {
          kind: 'assessment',
          content: input.reason ?? 'Cần chủ dự án trả lời',
          rationale: 'Tiến trình yêu cầu quyết định trước khi tiếp tục',
          sources: [],
          scope: { action: 'needs_input', attemptId: id },
        },
        actor,
      );
      await setTerminalIntent(
        tx,
        row.ticket_id as Id,
        'needs_input',
        input.reason ?? 'owner_input',
        null,
        actor,
      );
    } else if (input.outcome === 'retry' && row.terminal_intent === 'complete')
      await tx`update attempts set terminal_intent='retry' where id=${id}`;
  }
  return finalizeAttempt(tx, id, verify, docsCompletion);
}

export async function recheckFinalization(
  tx: Tx,
  id: Id,
  input: { fence: string; processInstanceId: string },
  actor: Actor,
  verify: FinalResultVerifier = denyFinalResult,
  docsCompletion?: DocsCompletionReader,
): Promise<Attempt> {
  const row = await lockedAttempt(tx, id, actor);
  await assertCurrent(tx, row, input.fence, input.processInstanceId, actor);
  return finalizeAttempt(tx, id, verify, docsCompletion);
}

export async function finalizeAttempt(
  tx: Tx,
  id: Id,
  verify: FinalResultVerifier = denyFinalResult,
  docsCompletion?: DocsCompletionReader,
): Promise<Attempt> {
  const [row] =
    await tx`select a.*,t.kind,t.project_id,t.revision,t.status as ticket_status from attempts a join tickets t on t.id=a.ticket_id where a.id=${id} for update of a,t`;
  if (!row) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy attempt');
  if (row.state === 'stopped') return mapAttempt(row);
  if (row.state !== 'finalizing' || !row.stopped_at) return mapAttempt(row);
  const intent = row.terminal_intent as TerminalIntent;
  const result = row.terminal_result as AttemptResultInput | null;
  if (['complete', 'retry'].includes(intent) && !result) {
    await tx`update tickets set wait_reason='final_result_pending' where id=${row.ticket_id}`;
    return mapAttempt(row);
  }
  if (['complete', 'retry'].includes(intent)) {
    try {
      await verify(tx, {
        attemptId: id,
        ticketId: row.ticket_id as Id,
        kind: row.kind as 'code' | 'research' | 'docs' | 'deploy',
        outcome: result?.outcome as 'passed' | 'retry' | 'needs_input',
        evidenceIds: result?.evidenceIds ?? [],
      });
    } catch (error) {
      if (error instanceof ApiError && pendingCodes.has(error.code)) {
        await tx`update tickets set wait_reason='final_result_pending' where id=${row.ticket_id}`;
        return mapAttempt(row);
      }
      throw error;
    }
  }
  if (intent === 'complete') {
    const ticket = await requireTicket(tx, row.ticket_id as Id, {
      kind: 'machine',
      id: row.machine_id as Id,
    });
    const facts = await readCompletionFacts(tx, ticket, docsCompletion);
    if (!facts.ready) {
      await tx`update tickets set wait_reason='final_result_pending' where id=${row.ticket_id}`;
      return mapAttempt(row);
    }
  }
  const signal =
    intent === 'cancel'
      ? 'cancel_confirmed'
      : intent === 'pause'
        ? 'pause_confirmed'
        : intent === 'needs_input'
          ? 'wait_owner'
          : intent === 'retry'
            ? 'reconciled_stopped'
            : 'passed';
  const services = createTicketServices({ execution: createExecutionAuthority(), docsCompletion });
  await services.applyExecutionSignal(
    tx,
    row.ticket_id as Id,
    signal,
    Number(row.revision),
    result?.evidenceIds[0] ?? null,
    { kind: 'machine', id: row.machine_id as Id },
  );
  const [updated] =
    await tx`update attempts set state='stopped',finalized_at=now() where id=${id} returning *`;
  await tx`update execution_guards set active_attempt_id=null where ticket_id=${row.ticket_id} and active_attempt_id=${id}`;
  await appendEvent(tx, {
    type: 'attempt.finalized',
    projectId: row.project_id as Id,
    ticketId: row.ticket_id as Id,
    audienceMachineId: row.machine_id as Id,
    data: { attemptId: id, signal },
  });
  return mapAttempt(updated as Record<string, unknown>);
}

async function setTerminalIntent(
  tx: Tx,
  ticketId: Id,
  intent: 'pause' | 'cancel' | 'needs_input',
  reason: string,
  decisionId: Id | null,
  actor: Actor,
): Promise<Command | null> {
  const [row] =
    await tx`select a.* from execution_guards g join attempts a on a.id=g.active_attempt_id where g.ticket_id=${ticketId} for update of a`;
  if (!row) throw new ApiError('RECONCILE_REQUIRED', 409, 'Không có attempt đang giữ quyền');
  if (row.terminal_intent === 'cancel' && intent !== 'cancel') return null;
  if (row.terminal_intent === 'needs_input' && intent === 'pause') return null;
  await tx`update attempts set terminal_intent=${intent},terminal_reason=${reason} where id=${row.id}`;
  const type = intent === 'cancel' ? 'cancel' : 'pause';
  const [existing] =
    await tx`select * from commands where ticket_id=${ticketId} and type=${type} and state<>'completed' order by created_at desc limit 1`;
  if (existing) {
    const { mapCommand } = await import('./commands.ts');
    return mapCommand(existing);
  }
  const { createCommand } = await import('./commands.ts');
  return createCommand(
    tx,
    { machineId: row.machine_id as Id, ticketId, type, payload: { attemptId: row.id, decisionId } },
    actor,
  );
}

export async function requestTerminalIntent(
  tx: Tx,
  ticketId: Id,
  input: { intent: 'pause' | 'cancel' | 'needs_input'; reason: string; decisionId: Id },
  actor: Actor,
): Promise<Command | null> {
  if (actor.kind !== 'owner') throw new ApiError('OWNER_REQUIRED', 403, 'Cần chủ dự án');
  if (!uuid.test(input.decisionId) || !input.reason || input.reason.length > 32768)
    throw new ApiError('VALIDATION', 400, 'Yêu cầu dừng không hợp lệ');
  const [decision] =
    await tx`select id from decisions where id=${input.decisionId} and ticket_id=${ticketId} and actor_kind='owner'`;
  if (!decision) throw new ApiError('DECISION_REQUIRED', 409, 'Thiếu quyết định của chủ dự án');
  const command = await setTerminalIntent(tx, ticketId, input.intent, input.reason, input.decisionId, actor);
  const [row] =
    await tx`select a.id,a.state from execution_guards g join attempts a on a.id=g.active_attempt_id where g.ticket_id=${ticketId}`;
  if (row?.state === 'finalizing') await finalizeAttempt(tx, row.id as Id);
  return command;
}

export async function reconcileAttempt(
  tx: Tx,
  id: Id,
  input: {
    fence: string;
    processInstanceId: string;
    observation: 'running' | 'stopped';
    artifacts: Id[];
    stopReason: null | 'pause' | 'cancel' | 'exit';
  },
  actor: Actor,
  verify: FinalResultVerifier = denyFinalResult,
  docsCompletion?: DocsCompletionReader,
): Promise<Attempt> {
  const row = await lockedAttempt(tx, id, actor);
  await assertCurrent(tx, row, input.fence, input.processInstanceId, actor);
  if (
    !['running', 'stopped'].includes(input.observation) ||
    input.artifacts.length > 100 ||
    input.artifacts.some((x) => !uuid.test(x)) ||
    (input.observation === 'stopped' && !input.stopReason) ||
    (input.observation === 'running' && input.stopReason !== null)
  )
    throw new ApiError('VALIDATION', 400, 'Quan sát tiến trình không hợp lệ');
  await assertEvidence(tx, row, input.artifacts, 'artifact');
  if (row.state === 'stopped') return mapAttempt(row);
  if (input.observation === 'running') {
    if (row.state === 'finalizing')
      throw new ApiError('PROCESS_STOPPED', 409, 'Tiến trình đã được xác nhận dừng');
    await tx`insert into reconciliation_observations(id,attempt_id,machine_id,fence,process_instance_id,observation,artifact_ids,stop_reason) values(${randomUUID()},${id},${actor.id},${input.fence},${input.processInstanceId},'running',${tx.json(input.artifacts)},null)`;
    const [updated] =
      await tx`update attempts set state='active',lease_expires_at=now()+interval '60 seconds' where id=${id} returning *`;
    return mapAttempt(updated as Record<string, unknown>);
  }
  if (row.state === 'finalizing' && row.stop_reason !== input.stopReason)
    throw new ApiError('STOP_CONFLICT', 409, 'Lý do dừng không khớp quan sát đã ghi');
  if (row.state !== 'finalizing') {
    await tx`insert into reconciliation_observations(id,attempt_id,machine_id,fence,process_instance_id,observation,artifact_ids,stop_reason) values(${randomUUID()},${id},${actor.id},${input.fence},${input.processInstanceId},'stopped',${tx.json(input.artifacts)},${input.stopReason})`;
    await tx`update attempts set state='finalizing',stopped_at=now(),stop_reason=${input.stopReason} where id=${id}`;
    await appendEvent(tx, {
      type: 'attempt.stopped',
      projectId: row.project_id as Id,
      ticketId: row.ticket_id as Id,
      audienceMachineId: actor.id as Id,
      data: { attemptId: id, reason: input.stopReason },
    });
  }
  return finalizeAttempt(tx, id, verify, docsCompletion);
}
