# Review Task 5 S5a — composer chung và tệp đính kèm (commit `aa98e43`)

Phạm vi: diff `aa98e43^..aa98e43` (14 file, +4216). Đối chiếu với `task-5-brief.md`, `task-5-s5a-report.md` và lib Task2 (`lib/pending-operation.ts`, `lib/api.ts`). Named-risk check, mỗi mục một lần: `server/src/attachments/{routes,staging,submissions,contracts}.ts`, `auth/session-boundary.tsx`. Không chạy lại test.

### Spec Compliance

- ✅ `freezeSubmission`/`submissionRequest` đủ ba discriminant, đúng path/body, không đưa `kind/target/draftKey` vào body. Validate title 1–200 code point, description ≤65536, text ≤32768, enum kind/level/workflow, text và file không cùng rỗng. Ticket không file mở compose với `attachmentIds: []`.
- ✅ Frozen body không đổi khi form đổi: `setSubmission` bị từ chối khi khác `editing`. Test cũng kiểm retry giữ `assistantRead` gốc. Retry cùng key/body; sau reauth giữ `clientMessageId`.
- ✅ File lỗi chặn gửi dù có text; comment chỉ có ảnh được gửi. Reserve/remove nối tiếp theo revision (test `[1,2]`, `[3,4]`). DELETE gặp 409 thì refetch. Mất phản hồi reserve thì nhận lại upload qua GET.
- ✅ Một luồng nhận file cho paste/drop/input. Ảnh clipboard có tên `anh-dan-<giờ HCM>-n.<ext>`. Policy kiểm trước khi băm, không gắn cứng 25 MiB. `CLIENT_HASH_LIMIT` được báo ra, không bỏ qua âm thầm.
- ✅ Worker băm tuần tự; abort/dispose terminate worker và gỡ listener. Object URL bị revoke.
- ✅ Preview chỉ nhận PNG/JPEG theo magic bytes và chỉ hiện bytes khớp SHA/size/MIME của record. PDF/OOXML chỉ cho tải về. Text do React escape, cắt ở 64 Ki ký tự. Không iframe/object.
- ✅ Draft record ở sessionStorage không chứa text, bytes hay secret (có test).
- ✅ Không import module `tickets` (chỉ import type từ `contracts/tickets.ts`). Không sửa server.
- ❌ “receiving/busy/unknown chờ và retry cùng bytes”: sau reload/reauth/retry, upload `receiving` bị kẹt ở `uploading`, không có nút thao tác (I4).
- ❌ “Logout tombstone … nhập lại đúng nội dung … không tạo key mới”: chỉ chạy được khi không có file. Có file thì không bao giờ gửi được (I2).
- ❌ “Đổi target/project dùng compose mới”: nếu đang có reserve chưa giải quyết thì file kẹt vĩnh viễn (I3).
- ❌ “Một accepted operation chỉ tạo một ticket/comment/message”: còn một đường tạo bản trùng (I1).
- ❌ Quy trình TDD: source viết trước test; RED thật chỉ có cho 1/29 test (I5).
- ⚠️ A5 BLOCKED: đã kiểm, `registerAttachmentRoutes`/`registerInputScopeRoutes` không được gọi ngoài `attachments/routes.ts`. `compose.spec.ts` không được viết, không có authority giả. Chấp nhận là blocked đúng cách.
- ⚠️ Nhóm refs theo comment và nhãn nguồn request/step/comment chờ projection G2. UI hiện danh sách phẳng kèm ghi chú, không suy nhóm từ thứ tự. Đúng hướng.
- ⚠️ `freezeSubmission` là hàm thuần; controller không gọi nó mà dùng `submissionRequest` + `PendingStore.begin` (key do Task2 cấp). Test đã chứng minh hai đường cho bytes giống nhau. Lệch interface brief, cần controller quyết.
- ⚠️ File ngoài danh sách brief: `test/support/compose-server.ts`. `decodeAssistantMessage` nằm trong `compose/state.ts`; đã đối chiếu và khớp `server/src/attachments/contracts.ts:270`.
- ⚠️ Docs nằm ở `v2/docs/flows/web-attachments.md` (brief ghi `docs/v2/web-attachments.md`). Tham chiếu dòng `routes.ts:328,650` trong docs đã cũ.
- ⚠️ B1 (Task2): composer không làm rủi ro này sâu thêm trực tiếp, vì composer validate lại trước `resume` nên khó có 400. Nhưng I1 khuếch đại mọi lần key bị nhả sai, B1 là một ví dụ.
- ⚠️ Secret: text comment/message/description vẫn nằm trong `bodyJson` mà PendingStore lưu ở sessionStorage. Đây là thiết kế Task2 đã accept (`containsSecret` chỉ xét key), S5a không đổi.

### Strengths

- Test chạy trên `OwnerClient`/`PendingStore`/`SessionController` thật qua fake fetch, assert trên hành vi quan sát được trên dây: header idempotency-key, body bytes, số entity phía server. Không chỉ mirror implementation.
- Kiểm đột biến bắt được 3/4 mutant và lộ ra một lỗi thật. Lỗi đó được sửa kèm RED→GREEN có log.
- Fake producer khớp hợp đồng server ở các điểm composer phụ thuộc (đã đối chiếu):
  - replay submission theo compose + payload hash (`submissions.ts:238-242`);
  - `SELECTION_CHANGED` khi tập active lệch (`submissions.ts:135-146`);
  - PUT `receiving` → `ATTACHMENT_UPLOAD_BUSY`, `ready` → 200 (`staging.ts:381-389`);
  - CAS revision cho DELETE.

### Issues

#### Critical

Không có.

#### Important

- **I1 — `compose/controller.ts:396-404` + `652-656`: compose đã `submitted` bị coi là “đóng”, file bị chuyển sang compose mới, mở đường tạo entity trùng.**
  - Đường lỗi: 201 decode lỗi (`RESPONSE_SHAPE_INVALID`) → draft về `editing`, `submitOperation=null` (op đã accept nên key đã nhả) → form mở khóa, owner sửa text → gửi lại với key mới và body khác → server 409 `COMPOSE_ALREADY_SUBMITTED` (`submissions.ts:242`) → status 409, pending nên bị `reject` → `#refresh` thấy session `submitted` mà không có op/tombstone → `#detachFromSession('COMPOSE_CLOSED')` → file trong memory tự reserve vào compose mới (ticket không file thì mở compose mới khi submit) → lần bấm kế tiếp tạo ticket/comment thứ hai.
  - Mọi đường làm mất op cục bộ trong khi server đã commit đều rơi vào nhánh này (ví dụ B1). Message `RESPONSE_SHAPE_INVALID` hứa “Gửi lại sẽ nhận lại đúng kết quả cũ” nhưng form lại cho sửa.
  - Fix:
    - Trong `#refresh`, session `submitted` không có op cục bộ là trạng thái terminal “đã gửi ở nơi khác/không xác nhận”: khóa draft, không detach, không reschedule. Chỉ thoát bằng `abandon`/`startNew` mà owner bấm rõ ràng.
    - Ở nhánh decode lỗi, giữ draft khóa (`ambiguous` + body cũ) thay vì `editing`.
    - Thêm test cho cả hai.
- **I2 — `controller.ts:654`, `1025`, `540-548` và `composer.tsx:293`, `392-397`: nhập lại sau logout (tombstone) không gửi được khi draft có file.**
  - Sau remount, file có `uploadId` được khôi phục ở `unknown`. Nếu lần gửi gốc đã commit (đúng ca cần replay), `#refresh` return sớm vì `submitted && tombstoneId`, nên file mãi ở `unknown`. `selectionOf` khi đó trả null và `submittable` luôn false.
  - Ngoài ra checkbox consent `disabled={state !== 'editing'}` trong khi state là `suspended`, còn `allowRead` reset về `false` khi remount. Body gốc có `selected-inputs` thì không tái tạo được: `resume` → `IDEMPOTENCY_CONFLICT` → quay lại tombstone, lặp vô hạn. Nút “Bỏ bản nháp” cũng bị ẩn khi `reentry`, nên owner kẹt hẳn với `draftKey` này.
  - Test logout chỉ phủ comment không file.
  - Fix:
    - Ở nhánh tombstone/`submitted`, map file từ GET compose (server là authority) hoặc lấy selection từ record đã persist mà không đòi `ready`.
    - Persist `assistantRead` (không phải secret) trong draft record, hoặc mở checkbox khi `needsPayload`.
    - Có lối thoát rõ ràng cho owner.
    - Thêm test tombstone có file và có consent.
- **I3 — `controller.ts:1004-1006`, `616-627`, `958-962`: intent reserve không gắn với compose session.**
  - `#reserveIntent = ${intentId}:reserve:${localId}`. Khi đổi target (`#retarget`) hoặc `COMPOSE_CLOSED` mà một reserve còn unresolved, `#detachFromSession` đưa file về `selected` và reschedule. `begin` ném `IntentUnresolvedError`, nên op cũ được dùng lại, POST vào **compose cũ** (đã abandoned). Server trả 409 `ATTACHMENT_COMPOSE_CLOSED`; op đang `uncertain` nên chỉ bị `markAmbiguous` và vẫn unresolved. File thành `unknown`.
  - Ở compose mới, `expectedRevisionOf` (revision của session cũ) so với revision mới không chứng minh được gì. Retry lặp lại đúng op hỏng, nên file kẹt vĩnh viễn.
  - Fix: đưa sessionId vào intent reserve, hoặc khi detach thì `pending.reject` các reserve unresolved sau khi đã abandon session thành công (bằng chứng: session cũ đã đóng). Thêm test đổi project khi reserve chưa xác nhận.
- **I4 — `controller.ts:337`, `416-421` và `composer.tsx:170-171`: upload `receiving` bị kẹt.**
  - `fromServer('receiving')` → `uploading`. `reconcile` chỉ reschedule `reserved/selected`, còn `retryFile` bỏ qua `uploading`, và `FileRow` không hiện “Thử lại” cho `uploading`.
  - Hậu quả: sau reload/reauth, hoặc sau khi vòng backoff hết lượt và owner bấm “Thử lại” trong lúc server còn `receiving` (lease của writer cũ, `staging.ts:387`), file đứng ở “Đang tải lên”. Không có tiến trình nào chạy và submit bị chặn; owner chỉ còn cách bỏ tệp.
  - Brief yêu cầu “receiving/busy/unknown chờ và retry cùng bytes”.
  - Fix: `reconcile`/`retryFile` reschedule cả `uploading` khi còn bytes (`#upload` vốn đã chờ, refresh rồi retry cùng ID), hoặc hiện nút “Thử lại” cho `uploading` không có tiến trình. Thêm test reload khi server ở `receiving`.
- **I5 — Quy trình TDD bị vi phạm; nhiều nhánh idempotency/retry không có test.**
  - Lượt đầu 25/25 PASS, nghĩa là không có RED. Chỉ 1 test có RED thật. Mutation check bù được một phần, nhưng chỉ có 4 mutant.
  - Các nhánh chưa test, đều thuộc idempotency/retry nên tối thiểu Important:
    - decode lỗi sau 201 (I1);
    - đổi target khi còn op unresolved (I3);
    - `abandon()`/`#abandonSession` kèm vòng `ATTACHMENT_SELECTION_STALE`;
    - PUT gặp 401 → `unknown` → reconcile;
    - `IDEMPOTENCY_CONFLICT` khi `resume`;
    - tombstone có file (I2);
    - op bị replay ở panel khôi phục (docs bước 9 khẳng định nhưng không có test);
    - nhánh reject của remove unresolved (`revision > expected`);
    - `reconcileAfterSubmit` (`SELECTION_CHANGED` → refresh).
  - `composer.tsx` không có test nào: chèn text tại caret khi paste, `preventDefault` chỉ khi có file, readonly khi khóa, checkbox consent, `onAccepted` đúng một lần, `onStateChange`.
  - Fake chưa mô phỏng compose hết hạn (TTL), target mismatch (`submissions.ts:129`), quota và sniff-reject. Các nhánh map lỗi tương ứng vì vậy chưa được chạm.
  - Fix: bổ sung test cho các nhánh trên (component test bằng jsdom/RTL hoặc Playwright component). Các test cho I1–I4 phải RED trước khi sửa.

#### Minor

- **M1 — `state.ts:316-338`:** `freezeSubmission` không có caller production; chỉ test dùng. Hàm cũng không kiểm “selectionRevision hiện hành / mọi upload ready” như brief, vì phần đó nằm ở `canSubmit`. Hoặc cho controller gọi nó (dùng `operation.id` từ `begin` để assert bytes khớp), hoặc ghi rõ trong interface rằng đây là đặc tả tham chiếu.
- **M2 — `controller.ts:376-385`:** `state='sending'` chỉ được đặt sau `await #submitOperation`, và nút vẫn bật trong khoảng đó. Double-click làm lần gọi thứ hai nhận `OPERATION_IN_FLIGHT`, đổi state sang `ambiguous`; hoặc nhận `OPERATION_UNKNOWN`, đè `accepted` thành `editing`. Không tạo bản trùng (claim chặn) nhưng UI nhấp nháy. Fix: cờ in-flight đồng bộ ngay đầu `submit()`.
- **M3 — `controller.ts`:** controller không subscribe `PendingStore`. Khi panel `session-boundary.tsx:122-125` replay op, composer vẫn hiện `ambiguous` cho tới lần bấm kế tiếp.
- **M4 — `file-hash.ts:124-127`:** `dispose()` terminate worker nhưng không reject promise `hash` đang chạy, nên promise treo mãi. Controller tránh được vì abort `#life` trước. Fix: reject các lượt pending khi dispose.
- **M5 — `compose-submit.test.ts:228`:** tên test nói “ambiguous chỉ retry op cũ” nhưng chỉ assert `ambiguous` + `submitOperation=null` → false. Thiếu ca `ambiguous` + op → true.
- **M6 — `queries.ts:230`:** `response.arrayBuffer()` đọc hết body trước khi so `expectedBytes`; không có trần nếu server trả nhiều hơn. Nên kiểm `content-length` hoặc đọc theo stream có trần `previewMaxBytes`.
- **M7 — `v2/docs/flows/web-attachments.md`:** tham chiếu `routes.ts:328,650` đã cũ (policy ở 344, submission ở 453/461).

### Assessment

S5a có lõi idempotency đúng cho các đường chính: lost-response replay, reauth, reload và reserve chưa xác nhận. A5 bị chặn đúng cách. Tuy vậy còn 4 lỗi trạng thái thực ở các đường phục hồi: một đường tạo entity trùng, nhập lại tombstone có file bị kẹt, reserve kẹt khi đổi target, và upload `receiving` kẹt. Các lỗi này nằm đúng những nhánh không có test, hệ quả của việc viết source trước test.

**Task quality:** Needs fixes
