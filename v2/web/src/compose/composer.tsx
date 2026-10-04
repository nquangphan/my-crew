/**
 * Shared composer for ticket create, ticket comment and Assistant message. The form (Task3/Task6) owns the
 * `ComposeSubmission`; this component edits only `ticket.description`/`text` through `onSubmissionChange`
 * and owns files, the compose session and the submit operation per `draftKey`.
 *
 * Wiring: the app provides `ComposeServicesProvider` (owner client, pending store, session, tab storage)
 * inside the authenticated boundary and a TanStack `QueryClientProvider`.
 */
import { useQueryClient } from '@tanstack/react-query';
import {
  type ClipboardEvent,
  createContext,
  type DragEvent,
  type JSX,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { formatBytes, LocalImagePreview } from '../attachments/preview.tsx';
import { attachmentPolicyQuery, attachmentQueryKeys } from '../attachments/queries.ts';
import type { OwnerClient } from '../lib/api.ts';
import type { PendingStore, TabStorage } from '../lib/pending-operation.ts';
import { queryRoots } from '../lib/query-keys.ts';
import type { SessionController } from '../lib/session.ts';
import { ComposeController, type ComposeView, type DiscardResult } from './controller.ts';
import { createWorkerHasher, type FileHasher } from './file-hash.ts';
import {
  type ComposeDraft,
  type ComposeReceipt,
  type ComposeSubmission,
  codePoints,
  composeLocks,
  type DraftFile,
  fileActions,
  filesFromTransfer,
  pasteDecision,
  receiptSummary,
  submissionLimits,
} from './state.ts';

export type ComposeServices = {
  client: OwnerClient;
  pending: PendingStore;
  session: SessionController;
  /** Tab storage for draft metadata (normally `sessionStorage`); null keeps drafts in memory only. */
  storage: TabStorage | null;
  /** Injected for tests; defaults to the owned SHA-256 worker. */
  createHasher?: () => FileHasher;
};

const ComposeServicesContext = createContext<ComposeServices | null>(null);

export function ComposeServicesProvider({
  services,
  children,
}: {
  services: ComposeServices;
  children: ReactNode;
}) {
  return <ComposeServicesContext.Provider value={services}>{children}</ComposeServicesContext.Provider>;
}

export type ComposerProps = {
  draftKey: string;
  submission: ComposeSubmission;
  onSubmissionChange: (next: ComposeSubmission) => void;
  onStateChange: (state: ComposeDraft['state']) => void;
  onAccepted: (receipt: ComposeReceipt) => void;
  /** Receives the handle the form uses to drop the whole draft (text is cleared only on `discarded`). */
  onHandle?: (handle: ComposerHandle) => void;
};

export type ComposerHandle = { discardDraft(): Promise<DiscardResult> };

const stateLabels: Record<DraftFile['state'], string> = {
  selected: 'Đã chọn',
  hashing: 'Đang kiểm tra tệp',
  reserved: 'Đã giữ chỗ',
  uploading: 'Đang tải lên',
  ready: 'Sẵn sàng',
  failed: 'Lỗi',
  removing: 'Đang bỏ',
  unknown: 'Chưa xác nhận',
};

const messages: Record<string, string> = {
  ATTACHMENT_FILE_TOO_LARGE: 'Tệp vượt giới hạn dung lượng của máy chủ.',
  ATTACHMENT_TYPE_UNSUPPORTED: 'Loại tệp chưa được hỗ trợ.',
  ATTACHMENT_FILE_NAME_INVALID: 'Tên tệp không hợp lệ.',
  ATTACHMENT_COMPOSE_QUOTA: 'Lượt gửi vượt số tệp hoặc tổng dung lượng cho phép.',
  ATTACHMENT_OWNER_QUOTA: 'Dung lượng tạm của bạn đã đầy.',
  ATTACHMENT_LIMIT_INVALID: 'Kích thước tệp không hợp lệ.',
  CLIENT_HASH_LIMIT: 'Tệp vượt giới hạn xử lý của trình duyệt này.',
  DUPLICATE_LOCAL: 'Trùng nội dung với tệp đã chọn. Hãy bỏ tệp này.',
  NEEDS_RESELECT: 'Trang đã tải lại nên cần chọn lại đúng tệp này để tiếp tục.',
  RESELECT_MISMATCH: 'Tệp chọn lại khác tệp ban đầu (kích thước hoặc nội dung).',
  UPLOAD_UNCONFIRMED: 'Chưa xác nhận tải lên. Thử lại sẽ gửi lại đúng tệp này.',
  RESERVE_UNCONFIRMED: 'Chưa xác nhận giữ chỗ. Thử lại sẽ kiểm tra máy chủ trước.',
  UPLOAD_ABANDONED: 'Máy chủ đã bỏ tệp này. Thử lại để tải lên lần nữa.',
  ATTACHMENT_MISSING: 'Máy chủ không còn tệp này.',
  ATTACHMENT_MAGIC_MISMATCH: 'Nội dung tệp không khớp loại tệp.',
  ATTACHMENT_REPLAY_MISMATCH: 'Dữ liệu gửi lại khác tệp ban đầu.',
  FILES_NOT_READY: 'Còn tệp lỗi hoặc chưa xác nhận. Bỏ hoặc thử lại tệp đó trước khi gửi.',
  FILES_PENDING: 'Đang xử lý tệp. Chờ tất cả tệp sẵn sàng rồi gửi.',
  TEXT_OR_FILES_REQUIRED: 'Nhập nội dung hoặc đính kèm ít nhất một tệp.',
  TITLE_REQUIRED: 'Cần nhập tiêu đề.',
  TITLE_TOO_LONG: 'Tiêu đề dài quá 200 ký tự.',
  DESCRIPTION_TOO_LONG: 'Mô tả dài quá 65.536 ký tự.',
  TEXT_TOO_LONG: 'Nội dung dài quá 32.768 ký tự.',
  TARGET_MISMATCH: 'Biểu mẫu không khớp đích gửi.',
  TARGET_INVALID: 'Đích gửi không hợp lệ.',
  TARGET_CHANGED: 'Đã đổi đích gửi: tệp được chuyển sang lượt gửi mới.',
  PREVIOUS_COMPOSE_KEPT: 'Không bỏ được lượt gửi cũ; máy chủ sẽ tự hết hạn lượt đó.',
  COMPOSE_CLOSED: 'Lượt gửi trên máy chủ đã đóng; tệp được chuyển sang lượt mới.',
  SELECTION_CHANGED: 'Danh sách tệp trên máy chủ đã thay đổi. Kiểm tra lại rồi gửi.',
  ATTACHMENT_SELECTION_STALE: 'Danh sách tệp đã thay đổi ở nơi khác. Đã đọc lại từ máy chủ.',
  ATTACHMENT_NOT_READY: 'Có tệp chưa sẵn sàng trên máy chủ.',
  COMPOSE_ALREADY_SUBMITTED: 'Lượt gửi này đã được dùng cho một nội dung khác.',
  IDEMPOTENCY_CONFLICT:
    'Nội dung khác yêu cầu cũ. Yêu cầu cũ vẫn được giữ; hãy nhập lại đúng nội dung ban đầu.',
  SECRET_PAYLOAD: 'Nội dung có trường giống thông tin bí mật nên không được lưu hay gửi.',
  UNAUTHENTICATED: 'Phiên đăng nhập đã hết hạn. Đăng nhập lại để tiếp tục; yêu cầu vẫn giữ khóa cũ.',
  SESSION_REQUIRED: 'Cần đăng nhập để tiếp tục; yêu cầu vẫn giữ khóa cũ.',
  SESSION_ENDED: 'Phiên đăng nhập đã kết thúc; yêu cầu vẫn giữ khóa cũ.',
  UNCONFIRMED: 'Chưa xác nhận kết quả. Gửi lại sẽ dùng đúng yêu cầu cũ.',
  RESPONSE_SHAPE_INVALID: 'Máy chủ trả dữ liệu không đúng định dạng. Gửi lại sẽ nhận lại đúng kết quả cũ.',
  UPLOAD_RECEIVING: 'Máy chủ vẫn đang nhận tệp này từ lần gửi trước. Thử lại để kiểm tra lại.',
  NOT_FOUND: 'Máy chủ không còn một tệp trong lượt gửi. Bỏ tệp bị thiếu rồi gửi lại.',
  ORIGIN_INVALID:
    'Máy chủ không nhận nguồn gửi của tab này. Yêu cầu vẫn giữ khóa cũ; tải lại trang rồi thử lại.',
  OWNER_REQUIRED: 'Phiên hiện tại không phải chủ sở hữu nên không được gửi.',
  DISCARD_UNCONFIRMED:
    'Chưa xác nhận được việc bỏ lượt gửi trên máy chủ. Bản nháp và yêu cầu bỏ vẫn được giữ; bấm bỏ bản nháp lần nữa để gửi lại đúng yêu cầu đó.',
  COMPOSE_EXPIRED: 'Lượt gửi đã hết hạn; tệp được chuyển sang lượt gửi mới.',
  ATTACHMENT_UPLOAD_EXPIRED: 'Lượt tải tệp đã hết hạn.',
  ATTACHMENT_COMPOSE_CLOSED: 'Lượt gửi đã đóng.',
  SUBMIT_UNCONFIRMED: 'Chưa xác nhận lần gửi trước. Đang kiểm tra với máy chủ; nội dung vẫn khóa.',
  SUBMITTED_ELSEWHERE:
    'Lượt gửi này đã được máy chủ lưu nhưng tab này không còn kết quả. Xem ở danh sách; bỏ bản nháp nếu muốn soạn mới.',
};

function describe(code: string | null): string | null {
  if (!code) return null;
  return messages[code] ?? `Không thực hiện được (${code}).`;
}

const statusText: Record<ComposeDraft['state'], string | null> = {
  editing: null,
  sending: 'Đang gửi…',
  ambiguous: 'Chưa xác nhận kết quả. Nội dung đã khóa; gửi lại sẽ dùng đúng yêu cầu cũ.',
  suspended: 'Tạm dừng. Đăng nhập lại rồi gửi lại đúng yêu cầu cũ.',
  accepted: 'Đã xác nhận.',
};

const submitLabels: Record<ComposeSubmission['kind'], string> = {
  ticket: 'Tạo ticket',
  comment: 'Gửi bình luận',
  assistant_message: 'Gửi tin nhắn',
};

function textOf(submission: ComposeSubmission): string {
  return submission.kind === 'ticket' ? submission.ticket.description : submission.text;
}

function withText(submission: ComposeSubmission, text: string): ComposeSubmission {
  return submission.kind === 'ticket'
    ? { ...submission, ticket: { ...submission.ticket, description: text } }
    : { ...submission, text };
}

const noSubscribe = () => () => undefined;
const noView = () => null;

function FileRow({
  file,
  controller,
  locked,
}: {
  file: DraftFile;
  controller: ComposeController;
  locked: boolean;
}) {
  const reselectId = useId();
  const local = controller.localFile(file.localId);
  const actions = fileActions(file, {
    hasBytes: local !== null,
    active: controller.isActive(file.localId),
    locked,
  });
  return (
    <li
      data-local-id={file.localId}
      data-state={file.state}
      style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}
    >
      {local && <LocalImagePreview file={local} label={file.name} />}
      <div style={{ display: 'grid', gap: '0.25rem', flex: 1 }}>
        <span>
          <strong>{file.name}</strong> · {formatBytes(file.size)} · {stateLabels[file.state]}
        </span>
        {file.errorCode && <span role="status">{describe(file.errorCode)}</span>}
      </div>
      {!locked && (
        <span style={{ display: 'flex', gap: '0.5rem' }}>
          {actions.retry && (
            <button type="button" onClick={() => void controller.retryFile(file.localId)}>
              Thử lại
            </button>
          )}
          {actions.reselect && (
            <>
              <label htmlFor={reselectId}>Chọn lại tệp</label>
              <input
                id={reselectId}
                type="file"
                style={{ width: '9rem' }}
                onChange={(event) => {
                  const chosen = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (chosen) void controller.reselectFile(file.localId, chosen);
                }}
              />
            </>
          )}
          {actions.remove && (
            <button type="button" onClick={() => void controller.removeFile(file.localId)}>
              Bỏ tệp
            </button>
          )}
        </span>
      )}
    </li>
  );
}

export function AttachmentComposer(props: ComposerProps): JSX.Element {
  const services = useContext(ComposeServicesContext);
  if (!services) throw new Error('COMPOSE_SERVICES_MISSING');
  const queryClient = useQueryClient();
  const { draftKey, submission } = props;
  const latest = useRef(props);
  latest.current = props;
  const [controller, setController] = useState<ComposeController | null>(null);

  useEffect(() => {
    const { client, pending, storage } = services;
    const created = new ComposeController({
      draftKey,
      submission: latest.current.submission,
      client,
      pending,
      storage,
      hasher: (services.createHasher ?? createWorkerHasher)(),
      loadPolicy: () => queryClient.fetchQuery(attachmentPolicyQuery(client)),
    });
    setController(created);
    void created.reconcile();
    return () => {
      created.dispose();
      setController((current) => (current === created ? null : current));
    };
  }, [draftKey, services, queryClient]);

  const subscribe = useCallback(
    (listener: () => void) => controller?.subscribe(listener) ?? (() => undefined),
    [controller],
  );
  const read = useCallback((): ComposeView | null => controller?.view() ?? null, [controller]);
  const view = useSyncExternalStore(controller ? subscribe : noSubscribe, controller ? read : noView);

  // Controlled submission → controller (refused while frozen, so the frozen body never changes).
  useEffect(() => {
    controller?.setSubmission(submission);
  }, [controller, submission]);

  const state = view?.draft.state ?? 'editing';

  // Reconcile the compose session after (re)authentication.
  const sessionState = useSyncExternalStore(
    useCallback((listener: () => void) => services.session.subscribe(listener), [services]),
    () => services.session.snapshot().state,
  );
  useEffect(() => {
    if (sessionState === 'authenticated') void controller?.reconcile();
  }, [sessionState, controller]);

  // Deliver an accepted receipt exactly once (the controller hands it out once), invalidate affected
  // views, then start a fresh draft.
  const pendingReceipt = view?.receipt ?? null;
  useEffect(() => {
    if (!pendingReceipt || !controller) return;
    const receipt = controller.takeReceipt();
    if (!receipt) return;
    if (receipt.kind === 'ticket') {
      void queryClient.invalidateQueries({ queryKey: queryRoots.tickets });
      void queryClient.invalidateQueries({ queryKey: queryRoots.ticket(receipt.ticket.id) });
    } else if (receipt.kind === 'comment') {
      const ticketId = receipt.comment.ticketId;
      void queryClient.invalidateQueries({ queryKey: queryRoots.comments(ticketId) });
      void queryClient.invalidateQueries({ queryKey: attachmentQueryKeys.ticket(ticketId) });
      void queryClient.invalidateQueries({ queryKey: queryRoots.ticket(ticketId) });
    }
    latest.current.onAccepted(receipt);
    // Consent belongs to one intent: the next draft starts without it.
    setAllowRead(false);
    controller.startNew();
  }, [pendingReceipt, controller, queryClient]);

  const [allowRead, setAllowRead] = useState(false);
  // One stable handle per mount; it always talks to the current controller.
  const controllerRef = useRef<ComposeController | null>(null);
  controllerRef.current = controller;
  const handle = useMemo<ComposerHandle>(
    () => ({
      async discardDraft() {
        const current = controllerRef.current;
        if (!current) return 'blocked';
        const result = await current.discardDraft();
        if (result === 'discarded') setAllowRead(false);
        return result;
      },
    }),
    [],
  );
  useEffect(() => {
    if (controller) latest.current.onHandle?.(handle);
  }, [controller, handle]);
  const [notice, setNotice] = useState<string | null>(null);
  const inputId = useId();
  const textId = useId();
  const consentId = useId();
  const authenticated = sessionState === 'authenticated';
  const reentry = view?.needsPayload ?? false;
  const files = view?.draft.files ?? [];
  const locks = composeLocks(
    {
      state,
      needsPayload: reentry,
      assistantRead: view?.assistantRead ?? null,
      discardable: view?.discardable ?? false,
      hasDraft: Boolean(view?.draft.sessionId) || files.length > 0,
    },
    { ready: controller !== null, authenticated, localConsent: allowRead },
  );
  const locked = locks.textLocked;
  const filesLocked = locks.filesLocked;
  // Re-entry for a tombstoned key needs the form editable again (the payload was wiped at logout).
  const reportedState = locks.reportedState;
  useEffect(() => {
    latest.current.onStateChange(reportedState);
  }, [reportedState]);
  const text = textOf(submission);
  const max = submission.kind === 'ticket' ? submissionLimits.descriptionMax : submissionLimits.textMax;
  const length = codePoints(text);

  const changeText = (next: string) => {
    if (locked) return;
    latest.current.onSubmissionChange(withText(latest.current.submission, next));
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const transfer = filesFromTransfer(event.clipboardData);
    const decision = pasteDecision({
      ...transfer,
      value: text,
      start: event.currentTarget.selectionStart,
      end: event.currentTarget.selectionEnd,
      filesLocked: filesLocked || !controller,
    });
    if (!decision.prevent) return; // ordinary paste stays native
    // Handle exactly what this paste carried: the files, plus its text inserted at the caret.
    event.preventDefault();
    if (decision.nextValue !== null) changeText(decision.nextValue);
    void controller?.addFiles(decision.files, 'clipboard');
  };

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!filesLocked && Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
  };
  const onDrop = (event: DragEvent<HTMLElement>) => {
    const dropped = filesFromTransfer(event.dataTransfer).files;
    if (dropped.length === 0) return;
    event.preventDefault();
    if (!filesLocked && controller) void controller.addFiles(dropped, 'drop');
  };

  const submit = async () => {
    if (!controller) return;
    setNotice(null);
    const result = await controller.submit(locks.consent ? 'selected-inputs' : 'none');
    if (result) setNotice(receiptSummary(result));
  };

  const retrying = state === 'ambiguous' || state === 'suspended';
  return (
    <section
      aria-label="Soạn nội dung"
      data-compose-state={state}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ display: 'grid', gap: '0.75rem' }}
    >
      <label htmlFor={textId}>{submission.kind === 'ticket' ? 'Mô tả' : 'Nội dung'}</label>
      <textarea
        id={textId}
        value={text}
        readOnly={locked}
        aria-readonly={locked}
        rows={6}
        onChange={(event) => changeText(event.currentTarget.value)}
        onPaste={onPaste}
      />
      <span aria-live="polite" style={{ justifySelf: 'end' }}>
        {length.toLocaleString('vi-VN')}/{max.toLocaleString('vi-VN')} ký tự
      </span>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor={inputId}>Đính kèm tệp</label>
        <input
          id={inputId}
          type="file"
          multiple
          disabled={filesLocked}
          onChange={(event) => {
            const chosen = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            if (controller) void controller.addFiles(chosen, 'input');
          }}
        />
        <span>Có thể dán ảnh từ clipboard vào ô nội dung hoặc kéo thả tệp vào đây.</span>
      </div>
      {files.length > 0 && controller && (
        <ul
          aria-label="Tệp đính kèm"
          style={{ display: 'grid', gap: '0.5rem', margin: 0, paddingLeft: 0, listStyle: 'none' }}
        >
          {files.map((file) => (
            <FileRow key={file.localId} file={file} controller={controller} locked={filesLocked} />
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <div>
          <input
            id={consentId}
            type="checkbox"
            checked={locks.consent}
            disabled={locks.consentLocked}
            onChange={(event) => setAllowRead(event.currentTarget.checked)}
          />{' '}
          <label htmlFor={consentId}>Cho phép Trợ lý đọc các tệp đã chọn trong lượt gửi này</label>
          <p style={{ margin: '0.25rem 0 0' }}>
            Khi bật, Trợ lý chỉ được đọc đúng các tệp trong danh sách trên (bản trích xuất đã xác minh), không
            đọc tệp khác. Khi tắt, tệp vẫn được lưu cùng nội dung nhưng Trợ lý không được cấp quyền đọc.
          </p>
        </div>
      )}
      {!authenticated && <p role="status">Cần đăng nhập để gửi hoặc tải tệp.</p>}
      {statusText[state] && <p aria-live="polite">{statusText[state]}</p>}
      {reentry && (
        <p role="status">
          Yêu cầu cũ chưa được xác nhận và nội dung đã bị xóa khỏi trình duyệt khi đăng xuất. Nhập lại đúng
          nội dung ban đầu để gửi bằng khóa cũ; không tạo yêu cầu mới.
        </p>
      )}
      {view?.errorCode && (
        <p role="alert">
          {describe(view.errorCode)}
          {view.errorMessage ? ` Máy chủ báo: ${view.errorMessage}.` : ''}
        </p>
      )}
      {notice && <p aria-live="polite">{notice}</p>}
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button
          type="button"
          className="compose-submit"
          disabled={!view?.submittable || !authenticated}
          onClick={() => void submit()}
        >
          {state === 'sending'
            ? 'Đang gửi…'
            : retrying && !reentry
              ? 'Gửi lại đúng yêu cầu cũ'
              : submitLabels[submission.kind]}
        </button>
        {locks.showAbandon && (
          <button type="button" disabled={!authenticated} onClick={() => void handle.discardDraft()}>
            Bỏ bản nháp tệp
          </button>
        )}
        {locks.showDiscard && (
          <button type="button" onClick={() => void controller?.discard()}>
            Bỏ bản nháp này
          </button>
        )}
      </div>
      {locks.showDiscard && (
        <p>
          Bỏ bản nháp chỉ xóa bản nháp trên trình duyệt; yêu cầu cũ vẫn nằm trong “Tiếp tục yêu cầu chưa xác
          nhận”. Nếu yêu cầu cũ đã được máy chủ lưu, gửi một nội dung mới sẽ tạo thêm một mục khác.
        </p>
      )}
    </section>
  );
}
