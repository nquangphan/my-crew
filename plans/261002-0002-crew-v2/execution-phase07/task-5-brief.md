## Task 5: Composer chung cho create/comment/hội thoại

**Files mới:** `v2/web/src/compose/state.ts`, `v2/web/src/compose/controller.ts`, `v2/web/src/compose/composer.tsx`, `v2/web/src/compose/file-hash.worker.ts`, `v2/web/src/compose/file-hash.ts`, `v2/web/src/attachments/preview.tsx`, `v2/web/src/attachments/queries.ts`, `v2/web/test/compose.test.ts`, `v2/web/test/compose-submit.test.ts`, `v2/web/e2e/compose.spec.ts`. Worker chỉ sửa các file đã liệt kê; controller tích hợp shared files. Docs canonical `docs/v2/web-attachments.md`.

**Interfaces:**

```ts
type DraftFile = { localId: string; name: string; size: number; sha256: string | null;
  uploadId: string | null; state: 'selected' | 'hashing' | 'reserved' | 'uploading'
    | 'ready' | 'failed' | 'removing' | 'unknown'; errorCode: string | null };
type ComposeSubmission =
  | { kind: 'ticket'; target: Extract<ComposeTarget, { purpose: 'ticket' }>; ticket: CreateTicket }
  | { kind: 'comment'; target: Extract<ComposeTarget, { purpose: 'comment' }>; text: string }
  | { kind: 'assistant_message'; target: Extract<ComposeTarget, { purpose: 'assistant_message' }>;
      conversationId: string; clientMessageId: string; text: string };
type ComposeDraft = {
  submission: ComposeSubmission; sessionId: string | null; selectionRevision: number | null;
  files: DraftFile[]; submitOperation: PendingOperation | null;
  state: 'editing' | 'sending' | 'ambiguous' | 'suspended' | 'accepted';
};
type ComposeReceipt =
  | { kind: 'ticket'; ticket: Ticket; attachmentIds: string[] }
  | { kind: 'comment'; comment: Comment; attachmentIds: string[] }
  | { kind: 'assistant_message'; message: AssistantMessage };
function canSubmit(draft: ComposeDraft): boolean;
function freezeSubmission(input: { submission: ComposeSubmission; selection: Selection;
  assistantRead: 'none' | 'selected-inputs'; operationId: string; intentId: string }): PendingOperation;
type ComposerProps = { draftKey: string; submission: ComposeSubmission;
  onSubmissionChange: (next: ComposeSubmission) => void;
  onStateChange: (state: ComposeDraft['state']) => void;
  onAccepted: (receipt: ComposeReceipt) => void };
function AttachmentComposer(props: ComposerProps): React.JSX.Element;
```

ComposeTarget/ComposeSession/Attachment/Selection/AssistantMessage mirror009 `v2/server/src/attachments/contracts.ts:28`,32,47,56,270 vào contracts của Task2. PendingOperation dùng đúng Task2, không duplicate state/client. ComposeSubmission là controlled discriminated input: Task3/Task6 giữ một submission object và onSubmissionChange cập nhật cùng object; Task5 giữ file/session/operation state theo draftKey. Không shadow-copy title/kind/workflow/description vào form hoặc client khác. Textarea của shared composer sửa ticket.description hoặc text qua onSubmissionChange. Task5 onStateChange cấp trạng thái đọc cho form Task3/Task6 để khóa field; controller Task5 vẫn kiểm state và từ chối submission/selection change khi không editing. Form/textarea readonly khi sending/ambiguous/suspended; frozen payload không đổi khi props hoặc realtime đổi.

| Kind | Form owner/fields | Exact body do Task5 freeze | Result |
|---|---|---|---|
|ticket|Task3 create-request: project/kind/title/workflow; composer edit description/files. makeRequestSubmission tạo full CreateTicket.|POST `/v2/attachment-submissions/tickets` `{ticket,selection,assistantRead}`. Không file vẫn dùng open compose/attachmentIds=[]; retry không đổi endpoint.|201 `{ticket,attachmentIds}`→ComposeReceipt.ticket|
|comment|Task3 detail cấp projectId/ticketId; composer edit text/files.|POST `/v2/tickets/:ticketId/attachment-comments` `{text,selection,assistantRead}`; text rỗng + readyfile hợp lệ.|201 `{comment,attachmentIds}`→ComposeReceipt.comment|
|assistant_message|Task6 cấp conversationId/clientMessageId cố định cho ý định; composer edit text/files.|POST `/v2/attachment-submissions/messages` `{conversationId,clientMessageId,text,selection,assistantRead}`.|201 AssistantMessage→ComposeReceipt.assistant_message; receipt input không phải reply|

freezeSubmission kiểm target.purpose/project/ticket/conversation khớp body, current selectionRevision và toàn bộ active uploads ready; serialize body một lần thành PendingOperation POST/ownerId từ session/storage=tab, giữ route/key/intentId. Không gửi kind/target/draftKey/onAccepted trong HTTP body. clientMessageId/operationId tạo một lần, không tạo lại sau retry/reauth. Validate ticket title1–200, description≤65536 và kind/workflow enum; comment/message text≤32768, text/files không cùng rỗng. Task3 không gửi partial ticket; Task5 không suy title/kind/workflow từ ComposeTarget hoặc description. Sources: `CreateTicket`, `v2/server/src/tickets/contracts.ts:7`; strict atomic schema `v2/server/src/attachments/routes.ts:117`; routes453/461/685.

- [ ] RED tests freezeSubmission đủ ba discriminants, exact body/path, metadata giữ qua paste/retry, invalid target bị chặn, empty selection hợp lệ cho ticket không file. Kiểm frozen body không đổi khi form/realtime đổi, original key/clientMessageId giữ sau reauth.

- [ ] RED tests file lỗi blocks send dù có text, chỉ ảnh ready comment allowed, text và files cùng rỗng bị từ chối, reserve/remove queue revision, mất phản hồi sau commit replay oneID, receipt partial không show “đã đọc”.
- [ ] Dùng một luồng nhận file cho clipboard.items, drop và input multiple. Paste có text và ảnh phải giữ cả hai; preventDefault chỉ phần đã xử lý, không chặn paste thường. Clipboard unnamed image tên local dễ hiểu/extension. Count/bytes/extensions/MIME theo policy visible trước hashing; server sniff lại. Không gắn cứng25MiB khi policy khác.
- [ ] Hash một File mỗi lượt trong owned worker bằng subtle.digest trên policy-bounded bytes; không bản sao base64, release arrays sau hash. Cancel/close dừng worker, bỏ listeners và revoke object URLs. Hash+size trùng local đưa lựa chọn bỏ file, server ID authoritative. Ngân sách memory trước hash; nếu policy vượt browser budget thì báo giới hạn xử lý client, không bỏ qua âm thầm hash/file.
- [ ] Create compose trước ticket; reserves serialized revision hiện hành. PUT cùng upload ID, tiến độ theo XHR thật upload event nếu cần, credentials/CSRF cùng contract, không tạo phần trăm giả. Abort/ambiguous GET compose: ready thắng; receiving/busy/unknown chờ và retry cùng bytes, không reservation mới khi writer chưa phân giải.
- [ ] Remove abort local rồi DELETEupload expectedRevision/refetch khi409. Confirmed rejected terminal có thể abandon reservation cũ rồi reserve new; kết quả transport chưa xác nhận giữ original reservation. Selection phải bằng mọi active upload ready; không filter file lỗi và gửi ticket thiếu file. Đổi target/project dùng compose mới sau giữ/abandon compose cũ rõ ràng, không reuse target.
- [ ] Atomic ticket/comment/message payload theo freezeSubmission ở bảng contract; metadata/form và selection đóng băng cùng một ý định trước transport. Owner consent giải thích selected inputs cho Trợ lý; chỉ gửi selected-inputs khi owner chọn phạm vi đó, không suy consent từ config/test flag. While sending/ambiguous lock edits; ID đã accept clear draft đúng một lần/invalidate.
- [ ] Retry submit cùng PendingOperation. Reload khi còn session hoặc sau same-owner reauth giữ compose IDs/revision/pending body nonsecret và original operation key; không File bytes. GET compose reconcile sau authentication; khi deliberate logout chỉ tombstone theo Task2, không tạo compose/key mới cho intent unresolved. File không còn/ chưa ready yêu cầu reselect đúng SHA/size trước đó, không attachment trùng. Password/API secret/credential thô không qua persistence/composer.
- [ ] Hiển thị refs kế thừa và nhóm refs theo comment bằng projection G2. Nhãn child nguồn request/step/comment; flattened attachment order không suy commentId. Preview chỉ authorized bytes safe raster/verified normalized derivative/ảnh từ Blob local. Original PDF/OOXML download; no iframe HTML/SVG/PDF cùng origin; text escape và giới hạn size, formulas/macros literal. Check original/derivative SHA/MIME from manifest, not filename.
- [ ] Extraction UI actual pending/running/complete/partial/encrypted/corrupt/unsupported/blocked/failed, problems/coverage còn thiếu/page/sheet/cell/span and mức tin cậy đã đọc. Byte đã verify không là model đã đọc/hiểu. Source links survive resume/runtime fallback bằng IDs, không copy upload cho descendants.
- [ ] A5 real G2 E2E trong compose.spec.ts với fixture host và API/DB thật, không chờ Task3/8: commit ticket/comment rồi mất response và expire session, UI reauth cùng owner replay đúng key/body chỉ tạo một entity/receipt; paste hai PNG và PDF trước create, bỏ một file, transport lỗi thật rồi retry, mất phản hồi sau commit→one ticket/links. Same comment trong dialog text rỗng + ảnh và conversation. Assert IDs trả về/DB thật commentId refs, wake/input revision tăng đúng một lần; producer receiver/corpus/native evidence riêng. Mock upload smoke không chứng minh hoàn thành.
- [ ] Scoped unit/types/Biome; canonical 7H2 docs+mapping/commit; independent reviewer kiểm lifetime/retry/access/render.

**Success:** Không gửi thiếu file đã chọn; một accepted operation chỉ tạo một ticket/comment/message; target sai bị từ chối; preview không thực thi script hoặc tự gọi mạng. **Risk:** H×H dataloss/duplicate/XSS, mitigation selection chính xác/idempotency/safebytes. **Rollback:** Revertcomposer; accepted originals/refs/receipts giữ. Compose đang mở thuộc lượt này abandon qua API; không delete storage/cleanup coi TTL là STOP.

