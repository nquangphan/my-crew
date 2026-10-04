/**
 * Pure state of the “Tạo yêu cầu” form and the per-tab form drafts (request fields, ticket comment text).
 *
 * Invariants:
 * - The form owns `RequestFormFields`; `makeRequestSubmission` maps them to exactly the strict producer
 *   `CreateTicket` body. Nothing is read from previews or inferred from the description.
 * - `criteria.workflowChoice` is the owner's root preference (`server/src/tickets/service.ts:141` defaults it
 *   to Superpowers). It never replaces a run pin: `workflowPin` stays null here.
 * - Drafts live per session in memory and in the tab storage the composer uses: kept across view changes,
 *   dialog close, reload and re-authentication, wiped when the owner logs out (the boundary at which Task2
 *   wipes pending payloads).
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

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const draftPrefix = 'crew-v2:form-draft:';
const requestKey = `${draftPrefix}create-request`;
const commentPrefix = `${draftPrefix}comment:`;
const kinds = new Set<string>(['code', 'research', 'docs', 'deploy']);
const workflowChoices = new Set<string>(['superpowers', 'bmad']);

/** Tab storage boundary: only a well-formed `RequestFormFields` record is restored. */
function parseRequest(raw: string | null): RequestFormFields | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (
      typeof record.projectId !== 'string' ||
      typeof record.kind !== 'string' ||
      !kinds.has(record.kind) ||
      typeof record.title !== 'string' ||
      typeof record.description !== 'string' ||
      typeof record.workflowChoice !== 'string' ||
      !workflowChoices.has(record.workflowChoice)
    )
      return null;
    return {
      projectId: record.projectId,
      kind: record.kind as RequestFormFields['kind'],
      title: record.title,
      description: record.description,
      workflowChoice: record.workflowChoice as RequestFormFields['workflowChoice'],
    };
  } catch {
    return null;
  }
}

/**
 * Form drafts of one session, written through to the tab storage that also holds the composer's draft
 * record and pending operation (`sessionStorage`). After a reload the fields therefore match the frozen
 * body the composer will replay. Only owner-typed content is stored, never credentials. Storage failures
 * (quota, privacy mode) degrade to memory only.
 */
export class FormDrafts {
  readonly #storage: DraftStorage | null;
  #request: RequestFormFields | null;
  readonly #comments = new Map<string, string>();

  constructor(storage: DraftStorage | null) {
    this.#storage = storage;
    this.#request = parseRequest(this.#read(requestKey));
    for (const key of this.#keys())
      if (key.startsWith(commentPrefix)) {
        const text = this.#read(key);
        if (text) this.#comments.set(key.slice(commentPrefix.length), text);
      }
  }

  get request(): RequestFormFields | null {
    return this.#request;
  }

  set request(next: RequestFormFields | null) {
    this.#request = next;
    this.#write(requestKey, next === null ? null : JSON.stringify(next));
  }

  comment(ticketId: string): string {
    return this.#comments.get(ticketId) ?? '';
  }

  setComment(ticketId: string, text: string): void {
    if (text === '') this.#comments.delete(ticketId);
    else this.#comments.set(ticketId, text);
    this.#write(`${commentPrefix}${ticketId}`, text === '' ? null : text);
  }

  clear(): void {
    this.#request = null;
    this.#comments.clear();
    for (const key of this.#keys()) if (key.startsWith(draftPrefix)) this.#write(key, null);
  }

  #keys(): string[] {
    const keys: string[] = [];
    try {
      const storage = this.#storage;
      if (storage) for (let index = 0; index < storage.length; index++) keys.push(storage.key(index) ?? '');
    } catch {
      return [];
    }
    return keys;
  }

  #read(key: string): string | null {
    try {
      return this.#storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  #write(key: string, value: string | null): void {
    try {
      if (value === null) this.#storage?.removeItem(key);
      else this.#storage?.setItem(key, value);
    } catch {
      // Memory copy stays authoritative for this page; nothing else to do.
    }
  }
}

type SessionSource = Pick<SessionController, 'subscribe' | 'snapshot'>;
const draftsBySession = new WeakMap<SessionSource, FormDrafts>();

/** The browser tab storage, or null where none exists (Node tests, blocked storage). */
export function browserTabStorage(): DraftStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The draft store of one session, cleared on logout (`logging_out`/`guest`, memory and tab storage), kept on
 * `expired` so re-authentication resumes the same draft.
 */
export function formDrafts(session: SessionSource, storage: DraftStorage | null): FormDrafts {
  const existing = draftsBySession.get(session);
  if (existing) return existing;
  const drafts = new FormDrafts(storage);
  draftsBySession.set(session, drafts);
  const clearOnLogout = () => {
    const state = session.snapshot().state;
    if (state === 'logging_out' || state === 'guest') drafts.clear();
  };
  session.subscribe(clearOnLogout);
  clearOnLogout();
  return drafts;
}
