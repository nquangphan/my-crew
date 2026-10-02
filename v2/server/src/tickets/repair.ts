import { randomUUID } from 'node:crypto';
import { recordRepairFailure } from '../../../src/ticket-policy.ts';
import { appendEvent } from '../journal/events.ts';
import type { Actor, Id, Tx } from '../platform/contracts.ts';
import { ApiError } from '../platform/errors.ts';
import type { ExecutionAuthority, RepairResultInput, Ticket } from './contracts.ts';
import { createTicket, mapTicket, requireTicket, safeTicketJson } from './service.ts';

export async function recordRepairResult(
  tx: Tx,
  input: RepairResultInput,
  actor: Actor,
  execution?: ExecutionAuthority,
): Promise<Ticket> {
  if (actor.kind !== 'machine') throw new ApiError('MACHINE_REQUIRED', 403, 'Cần máy thực thi');
  if (!execution) throw new ApiError('EXECUTION_PROOF_REQUIRED', 409, 'Thiếu xác nhận attempt và fence');
  if (
    !['initial_review', 'repair_review', 'infrastructure', 'model'].includes(input.classification) ||
    typeof input.passed !== 'boolean' ||
    typeof input.fence !== 'string' ||
    !/^[1-9][0-9]*$/.test(input.fence) ||
    !input.evidence ||
    typeof input.evidence !== 'object' ||
    Array.isArray(input.evidence) ||
    !safeTicketJson(input.evidence)
  )
    throw new ApiError('VALIDATION', 400, 'Kết quả kiểm tra không hợp lệ');
  const [scope] = await tx`select root_id from tickets where id=${input.ticketId}`;
  if (!scope) throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy ticket');
  await tx`select id from tickets where id=${scope.root_id} for update`;
  const ticket = await requireTicket(tx, input.ticketId, actor, true);
  if (ticket.level !== 'step') throw new ApiError('REPAIR_STEP_REQUIRED', 409, 'Vòng sửa thuộc ticket bước');
  if (ticket.status !== 'running') throw new ApiError('REPAIR_NOT_RUNNING', 409, 'Bước kiểm tra chưa chạy');
  await execution.verifyRepairResult(tx, input);
  const [existing] = await tx`select r.classification,r.passed,e.attempt_id from repair_results r
    join evidence e on e.id=r.evidence_id
    where r.check_step_id=${ticket.id} and r.cycle_id=${input.cycleId}`;
  if (existing) {
    if (
      existing.classification !== input.classification ||
      existing.passed !== input.passed ||
      existing.attempt_id !== input.attemptId
    )
      throw new ApiError('REPAIR_CYCLE_CONFLICT', 409, 'Cycle đã có kết quả khác');
    return ticket;
  }
  let repairCycles = ticket.repairCycles;
  const nextStatus = ticket.status;
  let waitReason = ticket.waitReason;
  let limitCycleId: Id | null = null;
  if (!input.passed && input.classification === 'repair_review') {
    const failure = recordRepairFailure(repairCycles);
    repairCycles = failure.cycles;
    if (failure.action === 'ask_owner') {
      waitReason = 'repair_limit';
      limitCycleId = input.cycleId;
      await execution.requestTerminalIntent(tx, ticket.id, 'needs_input', 'repair_limit');
    }
  }
  const evidenceId = randomUUID();
  await tx`insert into evidence(id,ticket_id,attempt_id,kind,data)
    values(${evidenceId},${ticket.id},${input.attemptId},'review_result',
      ${tx.json({
        ...input.evidence,
        verification: 'reported',
        classification: input.classification,
        passed: input.passed,
        cycleId: input.cycleId,
      })})`;
  await tx`insert into repair_results(check_step_id,cycle_id,classification,passed,evidence_id)
    values(${ticket.id},${input.cycleId},${input.classification},${input.passed},${evidenceId})`;
  if (
    !input.passed &&
    repairCycles < 5 &&
    (input.classification === 'initial_review' || input.classification === 'repair_review')
  ) {
    const fix = await createTicket(
      tx,
      {
        projectId: ticket.projectId,
        parentId: ticket.id,
        level: 'task',
        kind: ticket.kind,
        title: `Sửa kết quả kiểm tra ${input.cycleId.slice(0, 8)}`,
        description: 'Công việc sửa theo kết quả kiểm tra đã ghi nhận',
        mandatory: true,
        criteria: { repairCycleId: input.cycleId },
        inputs: { reviewEvidenceId: evidenceId },
        outputs: {},
        skill: ticket.skill,
        workflowPin: ticket.workflowPin,
      },
      actor,
    );
    await tx`insert into repair_links(check_step_id,fix_ticket_id,cycle_id)
      values(${ticket.id},${fix.id},${input.cycleId})`;
  }
  const [updated] = await tx`update tickets set repair_cycles=${repairCycles},status=${nextStatus},
    wait_reason=${waitReason},revision=revision+1,
    repair_limit_cycle_id=coalesce(${limitCycleId}::uuid,repair_limit_cycle_id),
    repair_limit_at=case when ${limitCycleId}::uuid is not null then clock_timestamp() else repair_limit_at end,
    repair_limit_consumed_decision_id=case when ${limitCycleId}::uuid is not null then null
      else repair_limit_consumed_decision_id end
    where id=${ticket.id} returning *`;
  await appendEvent(tx, {
    type: 'repair.recorded',
    projectId: ticket.projectId,
    ticketId: ticket.id,
    audienceMachineId: null,
    data: {
      cycleId: input.cycleId,
      classification: input.classification,
      passed: input.passed,
      repairCycles,
    },
  });
  return mapTicket(updated as Record<string, unknown>);
}
