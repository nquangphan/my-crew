# Re-review Task 5 S5a: vòng sửa 1 (`aa98e43` → `99cbff8`)

Phạm vi: diff source/test của `controller.ts`, `state.ts`, `composer.tsx`, `test/compose*.test.ts`, `test/support/compose-server.ts`, cùng mục 8 của report. Đã đối chiếu thêm `server/src/attachments/staging.ts:381-394,600-610` và `messages.ts:84-112`. Không chạy lại test.

## Verdict theo finding

- **I1: ADDRESSED.**
  - Body đóng băng `#frozen` (gồm cả `assistantRead`) được giữ trong bộ nhớ. Khi khóa biến mất, controller gửi lại đúng body đó trên cùng compose, và server trả lại kết quả đã lưu theo payload hash (`submissions.ts:238-242`).
  - Khi decode 201 lỗi, draft giữ `ambiguous`.
  - Compose đã `submitted` mà không có op cục bộ, hoặc gặp 409 `COMPOSE_ALREADY_SUBMITTED`: draft chuyển `SUBMITTED_ELSEWHERE`, không detach, không mở compose mới.
  - Có test cho decode lỗi, cho trường hợp reload sau khi panel đã replay, và cho trường hợp panel replay ngay trong tab.
  - Còn một lỗ ở trường hợp panel replay **sau** khi controller đã dựng lại; xem N1.
- **I2: ADDRESSED.**
  - Compose `submitted` vẫn lấy trạng thái file từ server qua `#mergeFiles(view, false)` và giữ revision của body gốc.
  - `assistantRead` được persist và dùng khi `resume`. Consent hiện ở dạng đã khóa.
  - Có nút “Bỏ bản nháp này” làm lối thoát.
  - Test phủ cả tombstone có file, consent `selected-inputs` và `IDEMPOTENCY_CONFLICT` khi nhập sai nội dung.
- **I3: ADDRESSED.**
  - Intent reserve giờ gồm `sessionId`. `#detachFromSession` reject các khóa reserve/remove của compose cũ.
  - Test “đổi project khi reserve chưa xác nhận” đã có RED (`TIMEOUT:moved`) trước khi sửa.
- **I4: ADDRESSED.**
  - `retryFile` và `reconcile` lập lịch lại file `uploading`; guard `isActive` chặn chạy trùng.
  - Không còn bytes thì `#stalled` đổi file sang `unknown`/`UPLOAD_RECEIVING`, có nút Thử lại.
  - Đã kiểm phía server: `receiving` chỉ đi tới `ready` hoặc `rejected` (`staging.ts:394,606`), không quay về `reserved`. Vì vậy file không thể kẹt ở `reserved` mà không có bytes.
- **M5: ADDRESSED.** Đã thêm hai assert `ambiguous`/`suspended` có op cho kết quả `true`.
- **I5: PARTIAL.**
  - Các nhánh controller đã nêu ở review trước nay đều có test:
    - SELECTION_CHANGED dẫn tới refresh;
    - PUT gặp 401, sau reauth thì reconcile;
    - nhả khóa DELETE chưa tới server;
    - abandon gặp stale;
    - panel replay, tombstone có file, IDEMPOTENCY_CONFLICT khi resume, đổi target khi còn reserve chưa giải quyết.
  - Mutation log cho thấy mỗi nhánh mới làm đúng test của nó fail.
  - Ba helper thuần (`pasteDecision`, `fileActions`, `composeLocks`) phủ được **logic quyết định** của UI.
  - Phần nối dây trong `composer.tsx` vẫn chưa được kiểm (owner quyết chuyện jsdom/RTL, nên mục này không tính là finding):
    - `onPaste`: đọc `selectionStart/End` từ `event.currentTarget`, có gọi `preventDefault()` thật hay không, rồi chuỗi `changeText → onSubmissionChange`.
    - `onDragOver`/`onDrop`: không có helper. `onDrop` gọi `preventDefault` cả khi `filesLocked`.
    - Ràng `readOnly={locked}`, `checked/disabled` của checkbox, và `submit()` truyền `locks.consent`.
    - Effect vòng đời controller: tạo/dispose theo `draftKey`, StrictMode double-mount, `reconcile` khi phiên chuyển `authenticated`, effect `setSubmission`.
    - Effect receipt: `takeReceipt` → invalidate query → `onAccepted` → `startNew`. Chỉ `takeReceipt` có unit test; chuỗi effect thì không.
    - Effect `onStateChange`, điều kiện `disabled` của nút gửi (`!submittable || !authenticated`), nhãn nút, nút discard/abandon cùng cảnh báo, cách tính `hasDraft`, việc reset input file/reselect.

## Breakage mới

- **N1 — Important — `controller.ts` `#submitOperation` (nhánh `state !== 'editing'` → `SUBMIT_UNCONFIRMED`) và `#refresh` (`ours = draft.submitOperation !== null …`): draft kẹt khi panel replay sau khi controller được dựng lại.**
  - Đường lỗi: tải lại tab, hoặc remount composer (đóng rồi mở lại dialog) khi op vẫn còn. Lúc này `#frozen` là null, state `ambiguous`. Sau đó panel “Tiếp tục yêu cầu…” replay op và op được accept.
  - `draft.submitOperation` vẫn trỏ tới object cũ. `canSubmit` trả `true`, nên nút “Gửi lại” vẫn bật, nhưng mỗi lần bấm đều ném `SUBMIT_UNCONFIRMED`.
  - `#refresh` coi object cũ là “ours” nên không chuyển sang `SUBMITTED_ELSEWHERE`. `#lockReason=null` nên `discardable=false`.
  - Kết quả: không receipt, không lối thoát, cho tới khi owner tự reload. Không tạo bản trùng, nhưng là ngõ cụt trong nhánh retry/idempotency và chưa có test.
  - Fix:
    - Trong `#submitOperation`, khi op biến mất mà không có `#frozen`/tombstone, đặt `#lockReason='SUBMIT_UNCONFIRMED'`, xóa `submitOperation` rồi enqueue `#refresh`, giống đường constructor.
    - Trong `#refresh`, xác định “ours” bằng `pending.get(id)` thay vì object cũ trên draft.
    - Thêm test: reload khi op còn, panel replay, rồi bấm gửi lại.
- **N2 — Minor — `controller.ts` `#refresh`, nhánh nhả `SUBMIT_UNCONFIRMED` (compose `open`, hoặc đóng rồi detach): consent vẫn bị khóa ở giá trị của intent cũ.**
  - Khi mở khóa, nhánh này không xóa `#assistantRead` và `#lastSubmitId`. Draft về `editing` nhưng `composeLocks` vẫn trả `consentLocked = true`, `consent = giá trị cũ`.
  - Lần gửi mới vì thế mang consent cũ và owner không đổi được, trái với “chỉ selected-inputs khi owner chọn”. Nhánh “proven rejection” trong `#afterSubmitFailure` thì có xóa.
  - Fix: xóa hai field này ở cả hai chỗ mở khóa.
- **N3 — Minor — `discard()` không chặn khi đang `sending`.**
  - Trong lúc gửi lại sau tombstone, `#tombstoneId` vẫn khác null cho tới khi có kết quả. `discardable` vì vậy là true và nút discard hiện (`showDiscard` không xét state).
  - Nếu bấm discard giữa chừng, `startNew()` tạo intent mới. Sau đó:
    - nếu `mutate` lỗi và op còn được giữ, op cũ lại được gắn vào draft mới ở state `ambiguous`;
    - nếu `mutate` gặp conflict, tombstone được gắn vào draft mới.
  - Quyết định bỏ draft của owner bị đảo ngược âm thầm, và `submitOperationId` được persist dưới intent mới.
  - Fix: `discard()` return khi state là `sending`, và `composeLocks.showDiscard` loại `sending`. Hoặc `#afterSubmitFailure` bỏ qua kết quả của intent đã bị discard.
- **N4 — Minor — `discard()` để lại khóa reserve/remove chưa giải quyết của compose cũ trong `PendingStore`.**
  - Các khóa này hiện trong panel như yêu cầu chờ xác nhận. Compose cũ không bị abandon, nên chiếm quota staging tới hết TTL.
  - Fix: trước `startNew`, reject các khóa reserve/remove của session cũ giống `#detachFromSession`. Khóa submit giữ nguyên, đúng như đã cảnh báo.
- **N5 — Minor — tên test chứa mã finding (`'I1: …'`, `'I5 composer: …'`) trong `compose*.test.ts`.**
  - Vi phạm luật repo “Stable Code Artifacts” (`.claude/rules/review-audit-self-decision.md`): không đặt mã audit/finding trong tên test.
  - Fix: đổi sang mô tả hành vi.

## Ghi chú về `discard()` và consent khi retry

- Về `discard()`: cảnh báo trùng trong UI là đúng. Với `assistant_message`, server có lớp bảo vệ riêng: `client_message_id` là danh tính reconnect (`messages.ts:101-112`), và Task6 chỉ cấp id mới sau `onAccepted`. Vì vậy discard rồi gửi lại tin nhắn không tạo message thứ hai. Ticket/comment không có lớp này, nên quyết định UX vẫn thuộc owner như report đã nêu.
- Về consent khi retry: controller bỏ qua tham số `assistantRead` khi có op còn sống, có `#frozen` hoặc có tombstone (`#assistantRead ?? arg`). `composer.tsx` gửi `locks.consent`, giá trị lấy từ consent đã đóng băng nếu có. Không còn đường nào để consent hiện tại làm đổi body gốc khi retry. Lỗi còn lại nằm ở N2, theo chiều ngược: consent bị đóng băng quá lâu.

## Assessment

I1–I4 và M5 đã được sửa đúng cause, có RED trước khi sửa. I5 phủ đủ các nhánh controller; phần nối dây trong `composer.tsx` còn trống như liệt kê ở trên, chờ owner quyết về môi trường DOM. N1 là ngõ cụt mới trong nhánh retry, mức Important; N2–N5 là Minor.

**Task quality:** Needs fixes (N1)
