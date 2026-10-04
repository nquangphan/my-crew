/**
 * Pure state of the “Tạo yêu cầu” form and the per-tab form drafts (request fields, ticket comment text).
 *
 * Invariants:
 * - The form owns `RequestFormFields`; `makeRequestSubmission` maps them to exactly the strict producer
 *   `CreateTicket` body. Nothing is read from previews or inferred from the description.
 * - `criteria.workflowChoice` is the owner's root preference (`server/src/tickets/service.ts:141` defaults it
 *   to Superpowers). It never replaces a run pin: `workflowPin` stays null here.
 * - Drafts live in memory per session: kept across view changes, dialog close and re-authentication, wiped
 *   when the owner logs out (the same boundary at which Task2 wipes pending payloads).
 */
import type { ComposeDraft, ComposeSubmission } from '../compose/state.ts';
import type { Ticket } from '../contracts/tickets.ts';
import type { SessionController } from '../lib/session.ts';

export type RequestFormFields = {
  projectId: string;
  kind: Ticket['kind'];
  title: string;
  description: string;
  workflowChoice: 'superpowers' | 'bmad';
};

export type RequestSubmission = Extract<ComposeSubmission, { kind: 'ticket' }>;

export function makeRequestSubmission(fields: RequestFormFields): RequestSubmission {
  return {
    kind: 'ticket',
    target: { purpose: 'ticket', projectId: fields.projectId, ticketId: null },
    ticket: {
      projectId: fields.projectId,
      parentId: null,
      level: 'request',
      kind: fields.kind,
      title: fields.title,
      description: fields.description,
      mandatory: true,
      criteria: { workflowChoice: fields.workflowChoice },
      inputs: {},
      outputs: {},
      skill: null,
      workflowPin: null,
      deployApprovalDecisionId: null,
    },
  };
}

export function defaultRequestFields(projectId = ''): RequestFormFields {
  return { projectId, kind: 'code', title: '', description: '', workflowChoice: 'superpowers' };
}

/**
 * Workflow choices. BMAD has a definition only for the `claude` runtime (phase06 ruling); the form says so
 * instead of implying it runs on Codex.
 */
export const workflowOptions: readonly {
  value: RequestFormFields['workflowChoice'];
  label: string;
  note: string;
}[] = [
  { value: 'superpowers', label: 'Superpowers', note: 'Mặc định cho mọi yêu cầu.' },
  {
    value: 'bmad',
    label: 'BMAD',
    note: 'Chọn rõ khi cần. Hiện chỉ máy chạy Claude Code có định nghĩa BMAD; máy dùng Codex chưa chạy được BMAD.',
  },
];

/** Form fields are editable only while the shared composer is editing; otherwise the key/body is frozen. */
export function requestFormLocked(state: ComposeDraft['state']): boolean {
  return state !== 'editing';
}

export class FormDrafts {
  request: RequestFormFields | null = null;
  readonly comments = new Map<string, string>();

  clear(): void {
    this.request = null;
    this.comments.clear();
  }
}

type SessionSource = Pick<SessionController, 'subscribe' | 'snapshot'>;
const draftsBySession = new WeakMap<SessionSource, FormDrafts>();

/** The draft store of one session, cleared on logout (`logging_out`/`guest`), kept on `expired`. */
export function formDrafts(session: SessionSource): FormDrafts {
  const existing = draftsBySession.get(session);
  if (existing) return existing;
  const drafts = new FormDrafts();
  draftsBySession.set(session, drafts);
  session.subscribe(() => {
    const state = session.snapshot().state;
    if (state === 'logging_out' || state === 'guest') drafts.clear();
  });
  return drafts;
}
