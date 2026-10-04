# Re-review Task 5 S5a: API `discardDraft`/`onHandle` (commit `bdf277d`)

Phạm vi: phần compose của `bdf277d` (`controller.ts`, `composer.tsx`, `compose-submit.test.ts`, `composer-dom.test.ts`) và mục 11 của report. Các commit khác trong khoảng `cccbae1..bdf277d` (S3b, S4, S6docs) nằm ngoài phạm vi. Không chạy lại test.

## Đối chiếu với ruling

- ✅ **`blocked` khi `sending` hoặc đang `#discarding`.** Không đổi gì.
  - Controller chưa sẵn sàng (đang remount) thì handle cũng trả `blocked`. Chấp nhận được.
- ✅ **Ở `editing`: `DELETE /v2/attachment-compose/:id`.** Server abandon compose cùng mọi upload của nó (test assert cả compose lẫn upload là `abandoned`). Sau đó nhả khóa reserve/remove, `startNew()`, trả `discarded`. Bản nháp trống cũng trả `discarded`.
- ✅ **DELETE chưa xác nhận: `unconfirmed`.**
  - Giữ bản nháp và khóa DELETE, báo `DISCARD_UNCONFIRMED`.
  - Lần gọi sau gửi lại cùng key (test assert idempotency-key giống nhau).
  - File còn bytes ở `selected`/`reserved` được lập lịch lại.
- ✅ **Locked/tombstone: hành xử như `discard()`.** `discard()` chỉ còn là guard (`tombstone || lockReason`) rồi gọi `discardDraft`. Test tombstone assert trong panel chỉ còn tombstone submit.
- ⚠️ **Handle rộng hơn `discard()`.** Handle còn cho bỏ draft `ambiguous`/`suspended` đang có op sống (không có lockReason hay tombstone); test “khóa submit vẫn ở panel” phủ nhánh này.
  - Về dữ liệu thì an toàn: nếu submit chưa commit, abandon làm nó không thể commit muộn nữa; nếu đã commit, DELETE nhận stale, đọc lại compose rồi dừng.
  - Nhưng owner có thể tạo bản trùng khi soạn lại. Cảnh báo trùng của composer chỉ hiện khi `showDiscard`, nên S3b phải tự hiện cảnh báo trước khi gọi `discardDraft` ở trạng thái `ambiguous`/`suspended`. Đây là trách nhiệm của caller; cần ghi vào hợp đồng.

## Fix trước khi dùng chung đường

- **B2: còn nguyên.**
  - `#discarding` vẫn bật đồng bộ trước `await`, chặn `submit`/`submittable`/`discardable`.
  - Lỗi DELETE không còn bị nuốt. Trước đây `abandon()` nuốt lỗi rồi vẫn `startNew()` khi DELETE lỗi; giờ đổi thành `unconfirmed` và giữ draft. Đây là cải thiện.
- **C2: không đổi, vẫn Minor mở.** Khóa abandon thành tombstone sau đăng xuất thì `discardDraft` trả `unconfirmed` mãi.
  - Nay lỗi này chạm cả nút “Bỏ bản nháp tệp” và handle của S3b, vì cả hai đi qua cùng đường.
- **C3: không đổi.** Hai lần stale liên tiếp, hoặc stale rồi GET lỗi, vẫn bị coi là đã bỏ xong.

## Hai concern worker tự nêu

- **(a) Test “blocked khi đang gửi” có RED yếu: chấp nhận.**
  - Trên stub, test này PASS vì stub trả `blocked` cho mọi trường hợp.
  - Đột biến bỏ nhánh `sending` làm đúng test đó fail (`fix4-mutation.log`). Test cũng assert state vẫn `sending` và receipt về đúng. Đột biến là bằng chứng đủ.
- **(b) Guard `#discarding` trong pipeline: không có test, không bảo vệ được ca chính, để lại một trạng thái kẹt.**
  - Kết luận ngắn: không tạo reserve mồ côi trên compose cũ, không để key treo. Nhưng có hai hệ quả, ghi ở D1 và D2.
  - Hàng đợi chạy tuần tự. Reserve xếp sau abandon chỉ chạy khi abandon đã xong. Phần tiếp của `discardDraft` chạy trước reserve: một bước microtask so với hai bước qua `.catch().then()`.
  - Trường hợp `discarded`: `startNew()` đã tắt `#discarding` trước khi reserve chạy, nên guard không có tác dụng.
    - Không thành reserve mồ côi, vì file không còn trong draft và vòng lặp return.
    - Nhưng `#ensureSession()` được gọi **trước** khi kiểm file, nên mở một compose mới cho draft mới (D1).
    - Upload thì không chạy, vì `startNew` đã abort signal.
  - Guard chỉ có tác dụng khi reserve đã được xếp **trước** abandon và chạy lúc `#discarding` còn bật. Reserve bị bỏ qua thì file đứng ở `hashing`:
    - nếu discard thành công, file bị `startNew` xóa, không sao;
    - nếu `unconfirmed`, file kẹt (D2).
  - Reserve đang bay lúc discard bắt đầu thì chạy xong trước abandon, cập nhật revision; DELETE sau đó abandon luôn upload đó. Không mồ côi.
  - Trường hợp `unconfirmed` mà DELETE thực ra đã commit: reserve chạy sau nhận `ATTACHMENT_COMPOSE_CLOSED`, đây là từ chối đã chứng minh nên không treo key. Refresh rồi detach sang compose mới, nhả key reserve/remove của compose cũ. Khóa abandon của compose cũ vẫn ở panel, và DELETE lại sẽ trả stale.

## Breakage mới

- **D1 — Minor — `controller.ts` `#reserve`: `#ensureSession()` chạy trước khi kiểm file còn tồn tại.**
  - Reserve xếp sau abandon chạy khi `startNew()` đã xong, nên mở một compose mới (POST `/v2/attachment-compose`) cho draft vừa reset dù không còn file nào.
  - Draft mới có `sessionId`, nên nút “Bỏ bản nháp tệp” hiện trên một bản nháp trống, và compose rỗng chiếm một lượt tới hết TTL.
  - Fix:
    - trong `#reserve`, kiểm file (còn tồn tại, `uploadId === null`) trước `#ensureSession()`;
    - và/hoặc ghi lại `#generation` khi lập lịch, bỏ qua nếu generation đã đổi;
    - abort hash/upload đang chạy ngay đầu `discardDraft` thay vì chờ `startNew`.
- **D2 — Minor — `controller.ts` `#process`/`#reserve` cùng nhánh `unconfirmed` của `discardDraft`: file kẹt ở `hashing`.**
  - Reserve bị guard `#discarding` bỏ qua, nên file đã có `sha256` nhưng state vẫn `hashing`. `#upload` return vì `uploadId === null`.
  - Nhánh `unconfirmed` chỉ lập lịch lại `selected`/`reserved`, còn `fileActions` không cho “Thử lại” ở `hashing`.
  - Kết quả: submit bị chặn (`FILES_PENDING`), owner chỉ còn cách bỏ tệp.
  - Fix: khi guard bỏ qua, đưa file về `selected`; hoặc nhánh `unconfirmed` lập lịch lại cả `hashing` khi đã có `sha256` và không `isActive`. Thêm test race: hash xong rồi reserve chạy trong lúc discard, sau đó DELETE lỗi.
- **D3 — Minor — `discardDraft` không chặn `accepted`.**
  - Nếu form gọi handle trong khe giữa lúc controller đặt `accepted` và lúc effect của composer `takeReceipt`, `startNew()` xóa `#receipt`.
  - Hậu quả: `onAccepted` không bao giờ được gọi và cache không bị invalidate, dù entity đã được tạo.
  - Fix: trả `blocked` khi `accepted`, hoặc giao receipt trước khi reset.
- **D4 — Minor — `composer.tsx` handle sau unmount.**
  - `controllerRef.current` chỉ cập nhật khi render. Sau khi composer unmount, handle mà S3b còn giữ vẫn trỏ tới controller đã `dispose`.
  - Gọi `discardDraft` khi đó vẫn gửi DELETE và ghi storage, nhưng không có listener.
  - Fix: xóa `controllerRef.current` trong cleanup của effect tạo controller, để handle trả `blocked`.

## Assessment

API đúng ruling, có test cho từng nhánh (discarded, blocked, unconfirmed kèm cùng key, tombstone, ambiguous). DOM test đi qua handle thật. Dùng chung đường không làm hỏng B2, và còn sửa lỗi cũ của `abandon()` nuốt lỗi. C2 và C3 vẫn mở như trước, nay ảnh hưởng thêm nút bỏ tệp và handle. Guard pipeline không có test và gần như không có tác dụng trong ca chính; nó để lại D1 và D2, đều Minor. Không có Important mới.

**Task quality:** Approved (D1–D4 Minor, cùng C2/C3, đưa vào ledger; ghi vào hợp đồng S3b rằng caller phải hiện cảnh báo trùng khi bỏ draft `ambiguous`/`suspended`)
