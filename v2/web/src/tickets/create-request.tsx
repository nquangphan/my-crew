/**
 * “Tạo yêu cầu”: project/kind/title/workflow fields owned here plus the description textarea and files of
 * the shared Task5 composer (`AttachmentComposer`, never cloned). Fields lock whenever the composer leaves
 * `editing`, so an unconfirmed request is only ever replayed with its original key and body. The draft is
 * kept per session across dialog close, view change and re-authentication; only “Bỏ bản nháp yêu cầu”
 * (or a confirmed create) clears it.
 */
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, useId, useMemo, useRef, useState } from 'react';
import { useRuntime } from '../app-runtime.ts';
import { AttachmentComposer } from '../compose/composer.tsx';
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
  defaultRequestFields,
  formDrafts,
  makeRequestSubmission,
  type RequestFormFields,
  requestFormLocked,
  workflowOptions,
} from './create-request-state.ts';
import { failureText, projectsQueryOptions } from './queries.ts';
import { kindLabels } from './status.ts';

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
  const { client, session } = useRuntime();
  const drafts = formDrafts(session);
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
        />
      ) : (
        <p role="status">Chọn dự án để nhập mô tả, đính kèm tệp và gửi yêu cầu.</p>
      )}
      {!locked && (
        <div>
          <button type="button" style={buttonStyle} onClick={() => save(null)}>
            Bỏ bản nháp yêu cầu
          </button>
        </div>
      )}
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
