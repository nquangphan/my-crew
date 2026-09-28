import type { AgentRole, RoleStage, Ticket, TicketDetailResponse, TicketStatus } from '@crew/shared';
import type { JobKind, JobRow, StateDb } from '../state-db.js';

/** One step of a role: its prompt, the ticket it runs on, and the status paths it may walk. */
export interface StageContract {
  stage: RoleStage;
  role: AgentRole;
  /** Prompt template under `prompts/`. */
  prompt: string;
  /** Vietnamese label shown to the agent in the capability preflight. */
  label: string;
  /**
   * Status paths the stage walks, each a sequence of agent transitions. Every edge must be legal under
   * `canTransition('agent', …)`; the role-contracts test replays them all.
   */
  paths: readonly (readonly TicketStatus[])[];
}

export const STAGES: Record<RoleStage, StageContract> = {
  assistant_triage: {
    stage: 'assistant_triage',
    role: 'assistant',
    prompt: 'assistant-triage',
    label: 'trợ lý định tuyến yêu cầu',
    paths: [
      ['todo', 'triage', 'in_progress'],
      ['todo', 'triage', 'needs_input'],
    ],
  },
  assistant_close: {
    stage: 'assistant_close',
    role: 'assistant',
    prompt: 'assistant-close',
    label: 'trợ lý tổng hợp và đóng yêu cầu',
    paths: [
      ['in_progress', 'in_review'],
      ['in_progress', 'done'],
    ],
  },
  pm_analyze: {
    stage: 'pm_analyze',
    role: 'pm',
    prompt: 'pm-analyze',
    label: 'PM phân tích yêu cầu và chia việc',
    paths: [
      ['todo', 'triage', 'in_progress'],
      ['todo', 'triage', 'needs_input'],
    ],
  },
  pm_monitor: {
    stage: 'pm_monitor',
    role: 'pm',
    prompt: 'pm-monitor',
    label: 'PM theo dõi subtask và tài nguyên',
    paths: [['in_progress', 'needs_input']],
  },
  pm_accept: {
    stage: 'pm_accept',
    role: 'pm',
    prompt: 'pm-accept',
    label: 'PM nghiệm thu, merge và đẩy lên',
    paths: [
      ['in_progress', 'in_review', 'done'],
      ['in_progress', 'blocked'],
    ],
  },
  dev: {
    stage: 'dev',
    role: 'dev',
    prompt: 'dev',
    label: 'dev viết code và test',
    paths: [['todo', 'in_progress', 'needs_input']],
  },
  docs_update: {
    stage: 'docs_update',
    role: 'dev',
    prompt: 'docs-update',
    label: 'cập nhật docs và commit',
    paths: [['in_progress', 'done']],
  },
  qc: {
    stage: 'qc',
    role: 'qc',
    prompt: 'qc',
    label: 'QC kiểm thử và review',
    paths: [
      ['todo', 'in_progress', 'done'],
      ['todo', 'in_progress', 'blocked'],
    ],
  },
  docs_init: {
    stage: 'docs_init',
    role: 'dev',
    prompt: 'docs-init',
    label: 'khởi tạo docs theo chuẩn',
    paths: [['todo', 'in_progress', 'done']],
  },
};

/** Paths every stage may take through the failure policy (the daemon blocks the ticket for the owner). */
export const FAILURE_PATHS: readonly (readonly TicketStatus[])[] = [['in_progress', 'blocked']];

const TERMINAL = new Set<TicketStatus>(['done', 'cancelled']);
export const isTerminal = (ticket: Pick<Ticket, 'status'>) => TERMINAL.has(ticket.status);

/** Children the PM plans, runs and accepts (docs-init is the daemon's own gate, not planned work). */
export const workChildren = (children: readonly Ticket[]) =>
  children.filter((child) => child.type === 'dev' || child.type === 'qc' || child.type === 'bug');

/**
 * True while the PM has not finished its breakdown: an earlier analyze run of this ticket asked the owner, hit
 * a cap, crashed or failed. The ticket's local job history decides; without any (another machine planned
 * it), existing work children mean the breakdown is done.
 */
function breakdownOpen(state: StateDb, ticketId: string, currentJobId: string): boolean {
  // The current job counts when it already ran as analyze (a restart after a crash mid-breakdown).
  const analyzed = state.jobsForTicket(ticketId).filter((job) => job.stage === 'pm_analyze');
  if (analyzed.length === 0) return false;
  return !analyzed.some((job) => job.id !== currentJobId && job.status === 'done' && !job.askedOwner);
}

/**
 * The stage a job runs, from the ticket, its children and the job kind (not from the trigger alone, so a
 * wake-up after a crash, an owner comment or a retry lands on the right step).
 */
export function resolveStage(input: {
  job: Pick<JobRow, 'id'>;
  kind: JobKind;
  detail: TicketDetailResponse;
  state: StateDb;
}): RoleStage {
  const { job, kind, detail, state } = input;
  const { ticket, children } = detail;
  switch (ticket.type) {
    case 'request': {
      const pmTasks = children.filter((child) => child.type === 'pm_task');
      return pmTasks.length > 0 && pmTasks.every(isTerminal) ? 'assistant_close' : 'assistant_triage';
    }
    case 'pm_task': {
      const work = workChildren(children);
      if (work.length === 0 || breakdownOpen(state, ticket.id, job.id)) return 'pm_analyze';
      return work.every(isTerminal) ? 'pm_accept' : 'pm_monitor';
    }
    case 'dev':
    case 'bug':
      return kind === 'docs_update' ? 'docs_update' : 'dev';
    case 'qc':
      return 'qc';
    case 'docs_init':
      return 'docs_init';
  }
}
