/**
 * “Tạo yêu cầu”: project/kind/title/workflow fields owned here plus the description textarea and files of
 * the shared Task5 composer (`AttachmentComposer`, never cloned). Fields lock whenever the composer leaves
 * `editing`, so an unconfirmed request is only ever replayed with its original key and body. The draft is
 * kept in the runtime's tab storage across dialog close, view change, reload and re-authentication; only
 * “Bỏ bản nháp yêu cầu” (a whole-draft discard through the composer handle) or a confirmed create clears it.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRuntime } from '../app-runtime.ts';
import { AttachmentComposer, type ComposerHandle } from '../compose/composer.tsx';
import {
  type ComposeDraft,
  type ComposeReceipt,
  type ComposeSubmission,
  codePoints,
  submissionLimits,
} from '../compose/state.ts';
import { isUuid } from '../contracts/http.ts';
import type { Ticket } from '../contracts/tickets.ts';
import {
  type DraftStorage,
  defaultRequestFields,
  discardMode,
  type FormDrafts,
  formDrafts,
  makeRequestSubmission,
  type RequestFormFields,
  requestFormLocked,
  workflowOptions,
} from './create-request-state.ts';
import { failureText, projectsQueryOptions } from './queries.ts';
import { kindLabels } from './status.ts';

const DraftStorageContext = createContext<DraftStorage | null>(null);

/**
 * Supplies the runtime's tab storage (the same one given to `ComposeServicesProvider`) to the form and
 * comment drafts. Without it drafts stay in memory, like the composer with `storage: null`.
 */
export function TicketDraftStorageProvider({
  storage,
  children,
}: {
  storage: DraftStorage | null;
  children: ReactNode;
}) {
  return <DraftStorageContext.Provider value={storage}>{children}</DraftStorageContext.Provider>;
}

/** The session's form/comment draft store over the runtime's tab storage. */
export function useTicketDrafts(): FormDrafts {
  return formDrafts(useRuntime().session, useContext(DraftStorageContext));
}

/** Owner-facing result of a whole-draft discard through the composer handle (null: nothing to say). */
export function discardMessage(result: 'discarded' | 'blocked' | 'unconfirmed'): string | null {
  if (result === 'blocked') return 'Đang gửi nên chưa bỏ được bản nháp. Chờ kết quả rồi thử lại.';
  if (result === 'unconfirmed')
    return 'Chưa xác nhận được việc bỏ bản nháp với máy chủ; nội dung vẫn được giữ. Bấm bỏ lần nữa để thử lại.';
  return null;
}

export type DraftDiscardProps = {
  /** Button text, e.g. “Bỏ bản nháp yêu cầu”. */
  label: string;
  state: ComposeDraft['state'];
  /** The composer handle, or null when no composer is mounted (then there is nothing beyond the text). */
  handle: () => ComposerHandle | null;
  /** Clears the form's own fields/text; called only after the composer reported `discarded`. */
  onDiscarded: () => void;
};

/**
 * Whole-draft discard for the request form and the comment box: drops compose session, files and key
 * through `discardDraft()`, then the form's own fields. Asks for confirmation of the duplicate risk while
 * the previous send is unconfirmed; never calls the handle while the receipt is being collected.
 */
export function DraftDiscard({ label, state, handle, onDiscarded }: DraftDiscardProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mode = discardMode(state);
  if (mode === 'hidden') return null;
  const run = async () => {
    setConfirming(false);
    setBusy(true);
    try {
      const current = handle();
      const result = current ? await current.discardDraft() : 'discarded';
      setNotice(discardMessage(result));
      if (result === 'discarded') onDiscarded();
    } catch {
      setNotice(discardMessage('unconfirmed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'grid', gap: '0.4rem' }}>
      <div>
        <button
          type="button"
          style={buttonStyle}
          disabled={busy || confirming}
          onClick={() => (mode === 'confirm' ? setConfirming(true) : void run())}
        >
          {label}
        </button>
      </div>
      {confirming && (
        <div role="alertdialog" aria-label="Xác nhận bỏ bản nháp" style={{ display: 'grid', gap: '0.4rem' }}>
          <p style={{ margin: 0 }}>
            Lần gửi trước chưa được xác nhận và có thể đã được máy chủ lưu. Nếu bỏ bản nháp rồi gửi nội dung
            mới, có thể tạo bản trùng. Khóa của lần gửi cũ vẫn nằm trong “Tiếp tục yêu cầu chưa xác nhận”.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" style={buttonStyle} onClick={() => void run()}>
              Vẫn bỏ bản nháp
            </button>
            <button type="button" style={buttonStyle} onClick={() => setConfirming(false)}>
              Giữ lại
            </button>
          </div>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}

/** Fixed composer draft key: one “new request” draft per tab, whatever view or project opened it. */
const requestDraftKey = 'create-request';

const fieldStyle: CSSProperties = { display: 'grid', gap: '0.25rem' };
const buttonStyle: CSSProperties = {
  font: 'inherit',
  padding: '0.35rem 0.7rem',
  borderRadius: '0.5rem',
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
};

export type CreateRequestFormProps = {
  /** Project preselected for a new draft (normally the current view's project). */
  initialProjectId?: string;
  /** Called once per confirmed create with the ticket ID returned by the producer. */
  onCreated: (ticketId: string) => void;
};

export function CreateRequestForm({ initialProjectId, onCreated }: CreateRequestFormProps) {
  const { client } = useRuntime();
  const drafts = useTicketDrafts();
  const handle = useRef<ComposerHandle | null>(null);
  const initial = useRef<RequestFormFields | null>(null);
  if (initial.current === null) {
    const stored = drafts.request;
    initial.current =
      stored && (stored.projectId || !initialProjectId)
        ? stored
        : { ...(stored ?? defaultRequestFields()), projectId: initialProjectId ?? '' };
  }
  const latest = useRef<RequestFormFields>(initial.current);
  const [fields, setFieldsState] = useState<RequestFormFields>(initial.current);
  const [composeState, setComposeState] = useState<ComposeDraft['state']>('editing');
  const locked = requestFormLocked(composeState);
  const projects = useQuery(projectsQueryOptions(client));
  const ids = { project: useId(), kind: useId(), title: useId(), workflow: useId() };

  const save = (next: RequestFormFields | null) => {
    const value = next ?? defaultRequestFields(latest.current.projectId);
    latest.current = value;
    drafts.request = next;
    setFieldsState(value);
  };
  const update = (patch: Partial<RequestFormFields>) => {
    if (!locked) save({ ...latest.current, ...patch });
  };

  const submission = useMemo(() => makeRequestSubmission(fields), [fields]);
  const onSubmissionChange = (next: ComposeSubmission) => {
    // The composer edits only the description; every other field stays owned by this form.
    if (next.kind === 'ticket') save({ ...latest.current, description: next.ticket.description });
  };
  const onAccepted = (receipt: ComposeReceipt) => {
    if (receipt.kind !== 'ticket') return;
    save(null);
    onCreated(receipt.ticket.id);
  };

  const titleLength = codePoints(fields.title);
  const projectReady = isUuid(fields.projectId);
  return (
    <form
      aria-label="Biểu mẫu tạo yêu cầu"
      style={{ display: 'grid', gap: '0.9rem' }}
      onSubmit={(event) => event.preventDefault()}
    >
      <div style={fieldStyle}>
        <label htmlFor={ids.project}>Dự án</label>
        <select
          id={ids.project}
          value={fields.projectId}
          disabled={locked || !projects.data}
          onChange={(event) => update({ projectId: event.currentTarget.value })}
        >
          <option value="">Chọn dự án</option>
          {projects.data?.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name} ({project.key})
            </option>
          ))}
        </select>
        {projects.isPending && <span role="status">Đang tải danh sách dự án…</span>}
        {projects.error && (
          <span role="alert">
            Không tải được dự án: {failureText(projects.error)}{' '}
            <button type="button" style={buttonStyle} onClick={() => void projects.refetch()}>
              Thử lại
            </button>
          </span>
        )}
      </div>
      <div style={fieldStyle}>
        <label htmlFor={ids.kind}>Loại</label>
        <select
          id={ids.kind}
          value={fields.kind}
          disabled={locked}
          onChange={(event) => update({ kind: event.currentTarget.value as Ticket['kind'] })}
        >
          {(Object.keys(kindLabels) as Ticket['kind'][]).map((kind) => (
            <option key={kind} value={kind}>
              {kindLabels[kind]}
            </option>
          ))}
        </select>
      </div>
      <div style={fieldStyle}>
        <label htmlFor={ids.title}>Tiêu đề</label>
        <input
          id={ids.title}
          type="text"
          value={fields.title}
          disabled={locked}
          aria-describedby={`${ids.title}-count`}
          onChange={(event) => update({ title: event.currentTarget.value })}
        />
        <span id={`${ids.title}-count`} style={{ justifySelf: 'end' }}>
          {titleLength.toLocaleString('vi-VN')}/{submissionLimits.titleMax.toLocaleString('vi-VN')} ký tự
        </span>
      </div>
      <fieldset disabled={locked} style={{ display: 'grid', gap: '0.4rem' }}>
        <legend>Workflow</legend>
        {workflowOptions.map((option) => (
          <div key={option.value}>
            <input
              id={`${ids.workflow}-${option.value}`}
              type="radio"
              name={ids.workflow}
              value={option.value}
              checked={fields.workflowChoice === option.value}
              disabled={locked}
              aria-describedby={`${ids.workflow}-${option.value}-note`}
              onChange={() => update({ workflowChoice: option.value })}
            />{' '}
            <label htmlFor={`${ids.workflow}-${option.value}`}>{option.label}</label>
            <p id={`${ids.workflow}-${option.value}-note`} style={{ margin: '0.15rem 0 0 1.6rem' }}>
              {option.note}
            </p>
          </div>
        ))}
      </fieldset>
      {projectReady ? (
        <AttachmentComposer
          draftKey={requestDraftKey}
          submission={submission}
          onSubmissionChange={onSubmissionChange}
          onStateChange={setComposeState}
          onAccepted={onAccepted}
          onHandle={(next) => {
            handle.current = next;
          }}
        />
      ) : (
        <p role="status">Chọn dự án để nhập mô tả, đính kèm tệp và gửi yêu cầu.</p>
      )}
      <DraftDiscard
        label="Bỏ bản nháp yêu cầu"
        state={composeState}
        handle={() => (projectReady ? handle.current : null)}
        onDiscarded={() => save(null)}
      />
    </form>
  );
}

const overlayStyle: CSSProperties = { position: 'fixed', inset: 0, background: 'rgb(15 23 42 / 0.45)' };
const contentStyle: CSSProperties = {
  position: 'fixed',
  top: '4vh',
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(48rem, calc(100vw - 2rem))',
  maxHeight: '92vh',
  overflow: 'auto',
  boxSizing: 'border-box',
  padding: '1.5rem',
  borderRadius: '0.75rem',
  background: 'Canvas',
  color: 'CanvasText',
  boxShadow: '0 1.5rem 3rem rgb(15 23 42 / 0.3)',
};

export type CreateRequestActionProps = {
  projectId?: string;
  /** Opens the shared ticket dialog for the created request (the trigger is the return-focus target). */
  onOpenTicket: (ticketId: string, trigger: HTMLElement) => void;
};

/** “Tạo yêu cầu” button for board, list and request views; the form opens in a Radix dialog. */
export function CreateRequestAction({ projectId, onOpenTicket }: CreateRequestActionProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button ref={trigger} type="button" style={buttonStyle}>
          Tạo yêu cầu
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay style={overlayStyle} />
        <Dialog.Content style={contentStyle} data-testid="create-request-dialog">
          <Dialog.Close style={{ ...buttonStyle, float: 'right' }} aria-label="Đóng">
            <span aria-hidden="true">×</span>
          </Dialog.Close>
          <Dialog.Title style={{ marginTop: 0 }}>Tạo yêu cầu</Dialog.Title>
          <Dialog.Description>
            Đóng hộp thoại vẫn giữ bản nháp; chỉ “Bỏ bản nháp yêu cầu” mới xóa nội dung đã nhập.
          </Dialog.Description>
          <CreateRequestForm
            initialProjectId={projectId}
            onCreated={(ticketId) => {
              setOpen(false);
              if (trigger.current) onOpenTicket(ticketId, trigger.current);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
