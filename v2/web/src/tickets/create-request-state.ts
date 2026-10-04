/**
 * Pure state of the “Tạo yêu cầu” form and the per-tab form drafts (request fields, ticket comment text).
 *
 * Invariants:
 * - The form owns `RequestFormFields`; `makeRequestSubmission` maps them to exactly the strict producer
 *   `CreateTicket` body. Nothing is read from previews or inferred from the description.
 * - `criteria.workflowChoice` is the owner's root preference (`server/src/tickets/service.ts:141` defaults it
 *   to Superpowers). It never replaces a run pin: `workflowPin` stays null here.
 * - Drafts live in the runtime's tab storage (the composer's; memory when none): kept across view changes,
 *   dialog close, reload and re-authentication, wiped on logout by `clearTicketDrafts` (the boundary at
 *   which Task2 wipes pending payloads).
 */
import type { ComposeDraft, ComposeSubmission } from '../compose/state.ts';
import type { Ticket } from '../contracts/tickets.ts';
import type { TabStorage } from '../lib/pending-operation.ts';
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

/** The Task2 tab storage shape (the composer's); enumeration is optional. */
export type DraftStorage = TabStorage & Partial<Pick<Storage, 'key' | 'length'>>;

const draftPrefix = 'crew-v2:form-draft:';
const requestKey = `${draftPrefix}create-request`;
const commentPrefix = `${draftPrefix}comment:`;
/** Keys written by this module, so a storage without enumeration can still be wiped completely. */
const indexKey = `${draftPrefix}index`;
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

function safeGet(storage: DraftStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeRemove(storage: DraftStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing more can be done for a storage that refuses removal.
  }
}

function readIndex(storage: DraftStorage): string[] {
  try {
    const value: unknown = JSON.parse(safeGet(storage, indexKey) ?? '[]');
    return Array.isArray(value)
      ? value.filter((key): key is string => typeof key === 'string' && key.startsWith(draftPrefix))
      : [];
  } catch {
    return [];
  }
}

/**
 * Removes every form/comment draft from a tab storage: the keys this module indexed, plus any key with the
 * `crew-v2:form-draft:` prefix when the storage can be enumerated. Called by the app on logout, whether or
 * not a draft store exists in the current page.
 */
export function clearTicketDrafts(storage: DraftStorage | null): void {
  if (!storage) return;
  const keys = new Set(readIndex(storage));
  try {
    const length = typeof storage.length === 'number' ? storage.length : 0;
    for (let index = 0; index < length; index++) {
      const key = storage.key?.(index);
      if (key?.startsWith(draftPrefix)) keys.add(key);
    }
  } catch {
    // Index-listed keys are still removed.
  }
  keys.add(indexKey);
  for (const key of keys) safeRemove(storage, key);
}

/** In-memory tab storage for runtimes without one (`storage: null`), like the composer's memory mode. */
class MemoryDraftStorage implements DraftStorage {
  readonly #map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, value);
  }
  removeItem(key: string): void {
    this.#map.delete(key);
  }
}

/**
 * Form drafts of one session, read and written through the runtime's tab storage — the same storage the
 * composer keeps its draft record and pending operation in — so after a reload the fields match the
 * frozen body the composer will replay. Without a storage they live in memory only. Only owner-typed
 * content is stored, never credentials. Storage failures degrade to "no draft".
 */
/**
 * How the form offers a whole-draft discard through the composer handle:
 * - `hidden` while `accepted` (the receipt is being collected; the handle must not be called);
 * - `confirm` while `ambiguous`/`suspended`: the old request may already be stored, so the owner first
 *   confirms the duplicate warning (the composer itself only warns in its locked/tombstone states);
 * - `direct` otherwise (`sending` is refused by the composer with `blocked`).
 */
export function discardMode(state: ComposeDraft['state']): 'hidden' | 'confirm' | 'direct' {
  if (state === 'accepted') return 'hidden';
  if (state === 'ambiguous' || state === 'suspended') return 'confirm';
  return 'direct';
}

export class FormDrafts {
  readonly #storage: DraftStorage;

  constructor(storage: DraftStorage | null) {
    this.#storage = storage ?? new MemoryDraftStorage();
  }

  get request(): RequestFormFields | null {
    return parseRequest(safeGet(this.#storage, requestKey));
  }

  set request(next: RequestFormFields | null) {
    this.#write(requestKey, next === null ? null : JSON.stringify(next));
  }

  comment(ticketId: string): string {
    return safeGet(this.#storage, `${commentPrefix}${ticketId}`) ?? '';
  }

  setComment(ticketId: string, text: string): void {
    this.#write(`${commentPrefix}${ticketId}`, text === '' ? null : text);
  }

  clear(): void {
    clearTicketDrafts(this.#storage);
  }

  #write(key: string, value: string | null): void {
    const index = new Set(readIndex(this.#storage));
    try {
      if (value === null) {
        this.#storage.removeItem(key);
        index.delete(key);
      } else {
        this.#storage.setItem(key, value);
        index.add(key);
      }
      if (index.size === 0) this.#storage.removeItem(indexKey);
      else this.#storage.setItem(indexKey, JSON.stringify([...index]));
    } catch {
      // Quota or blocked storage: the draft is not kept; nothing else depends on it.
    }
  }
}

type SessionSource = Pick<SessionController, 'subscribe' | 'snapshot'>;
const draftsBySession = new WeakMap<SessionSource, FormDrafts>();

/**
 * The draft store of one session over the runtime's tab storage (memory when null). Logout also clears it
 * here for the memory case; the app's logout hook calls `clearTicketDrafts` for the tab storage.
 */
export function formDrafts(session: SessionSource, storage: DraftStorage | null): FormDrafts {
  const existing = draftsBySession.get(session);
  if (existing) return existing;
  const drafts = new FormDrafts(storage);
  draftsBySession.set(session, drafts);
  session.subscribe(() => {
    const state = session.snapshot().state;
    if (state === 'logging_out' || state === 'guest') drafts.clear();
  });
  return drafts;
}
