# Re-review Task 5 S5a: vòng sửa 2 (`99cbff8` → `8c5ce41`)

Phạm vi: phần web của commit `8c5ce41` (source compose/attachments, test, test support, `package.json`) và mục 9 của report. Các file server trong khoảng `99cbff8..8c5ce41` thuộc commit G2 khác nên nằm ngoài phạm vi. Đã đối chiếu thêm:

- `producer-g2-review.md` (7 mismatch);
- `server/src/attachments/{submissions,staging,comment-refs,routes}.ts`.

Không chạy lại test.

## Verdict theo finding

- **N1 (Important): ADDRESSED.**
  - “Ours” giờ được xác định bằng `pending.get(id)` qua `#ownsSubmit`.
  - Controller subscribe `PendingStore`. Khi khóa biến mất mà không có `#frozen`, `#onPendingChange` chuyển draft sang `SUBMIT_UNCONFIRMED` và GET compose. Kết quả là compose `submitted` dẫn tới `SUBMITTED_ELSEWHERE` (có discard), còn compose `open` thì draft về `editing`.
  - Bấm gửi trong lúc đó chỉ chờ GET, không gửi gì.
  - Có test “panel khôi phục replay sau khi composer dựng lại…”, đã RED trước khi sửa.
- **N2: ADDRESSED.** `#unlockUnconfirmed` xóa `#assistantRead`, `#lastSubmitId` và `#frozen` ở cả hai chỗ mở khóa. Có test cho việc consent cũ không còn bị khóa.
- **N3: ADDRESSED.**
  - `discard()` return khi state là `sending`; `discardable` và `showDiscard` cùng loại `sending`.
  - Có bộ đếm `#generation`. Test dùng `hold`/`release` để chứng minh kết quả trả về sau vẫn thuộc đúng draft đang gửi.
  - Còn một khe hở trong chính `discard`, xem B2.
- **N4: ADDRESSED.** `discard` abandon compose còn mở, rồi nhả khóa reserve/remove của lượt đó. Test assert compose cũ là `abandoned` và trong panel chỉ còn khóa submit.
- **N5: ADDRESSED.** Tên test không còn mã finding.
- **I5: ADDRESSED.**
  - `composer-dom.test.ts` có 6 test, chạy component thật qua provider thật, với `OwnerClient`/`PendingStore` thật trên fake producer. Mutation log cho thấy 6 đột biến nối dây đều bị bắt.
  - Đã phủ các khoảng trống lần trước:
    - paste: `preventDefault` thật, chèn chữ tại con trỏ, chuỗi `onSubmissionChange`, paste chữ thường không bị chặn;
    - dragOver/drop khi khóa;
    - `readOnly`;
    - checkbox consent `checked`/`disabled`, và `submit` truyền đúng consent lên dây;
    - chuỗi receipt `onAccepted` một lần → `startNew` → consent reset;
    - `onStateChange`;
    - `disabled` và nhãn của nút gửi;
    - discard cùng cảnh báo;
    - hiển thị lý do 503.
  - Khoảng trống còn lại, đều nhỏ:
    - vòng đời theo `draftKey`: unmount/đổi key thì `dispose` (worker terminate, gỡ subscribe `PendingStore`), và StrictMode;
    - `reconcile` khi phiên quay lại `authenticated` sau đăng nhập lại (test chỉ đi tới chiều expire);
    - invalidate query sau receipt (không assert key nào bị invalidate);
    - nút “Bỏ bản nháp tệp” (`abandon`), ô chọn lại tệp (`NEEDS_RESELECT`), reset `input.value`;
    - `onDrop` có `preventDefault` khi khóa hay không (test chỉ assert không có tệp được thêm).

## 7 mismatch G2 (`producer-g2-review.md`)

1. **by-comment: khớp.**
   - Decoder `{items:[{commentId,attachments}],nextCursor}` khớp `comment-refs.ts:13-14,51-52`. `limit=100` nằm trong giới hạn server (`routes.ts:322-325`).
   - Nhóm rỗng (G2 M3) bị lọc.
   - Fake sắp keyset theo `commentId`, giống `order by l.comment_id`.
   - Query key nằm dưới `attachments(ticketId)`, nên invalidate sau comment vẫn trúng.
2. **503 `EXTRACTION_NOT_CONFIGURED`: khớp.** Fake trả lỗi này ở đúng vị trí trong thứ tự kiểm của `submissions.ts:147`. Task2 đổi thành `UNCONFIRMED` và giữ khóa; view hiện message của server.
3. **Id lạ trong selection: khớp.** Fake trả 404 `NOT_FOUND` khi id không thuộc compose, đúng thứ tự của `submissions.ts:138-140`. Composer refresh và đánh dấu `ATTACHMENT_MISSING`.
4. **`ORIGIN_INVALID`/`OWNER_REQUIRED`: khớp ở mức fake.**
   - Test ORIGIN chỉ chạm bước **mở compose** (op `suspended`, retry cùng key); nhánh ORIGIN ở chính bước submit chưa có test riêng.
   - Bù lại, Task2 xử lý `staleCredential` chung cho mọi mutation và đã có test ở Task2. Nên ghi chú, không tính là finding.
5. **Login 200: khớp.**
6. **Hết hạn: khớp.**
   - Server `readCompose` trả `mapSession` với `state:'open'` và `expiresAt` đã qua (`staging.ts:657-661`). Fake mô phỏng đúng như vậy.
   - Nhánh `SELECTION_CHANGED`, `ATTACHMENT_COMPOSE_CLOSED` khi giữ chỗ và `ATTACHMENT_UPLOAD_EXPIRED` khi PUT đều có test.
   - Phía web suy ra “hết hạn” bằng đồng hồ client, xem B1.
7. **401 `SESSION_INVALID`: khớp.** Phiên hết hạn, đăng nhập lại (200) rồi gửi lại cùng khóa.

## Test loader, kỳ vọng bị đổi, `gcTime`/`after(closeDom)`

- **`test/support/tsx-loader.ts`.** Hook chỉ đổi URL `file:` có đuôi `.tsx`, nên `.ts` vẫn do Node tự strip, nhất quán với các test hiện có. Hook được đăng ký trong `installDom()` trước mọi `await import(...)` động, và `composer-dom.test.ts` dùng import động đúng cách. Không ảnh hưởng production. Hai rủi ro (B3):
  - đây là cơ chế biên dịch thứ hai, độc lập với config Vite thật mà `app-wiring.test.ts` dùng qua `createServer`/`ssrLoadModule`;
  - hook có hiệu lực cho toàn process.
- **`dom.ts`.** Chỉ đưa lên global những thuộc tính của jsdom mà Node chưa có. `Event`, `AbortController`, `Blob`, `File`, `fetch` vẫn là bản của Node. Đây là môi trường trộn realm. RTL dựng event qua `ownerDocument.defaultView` nên chạy đúng, và các test hiện tại không phụ thuộc `instanceof` chéo realm. Chấp nhận được.
- **Kỳ vọng `COMPOSE_EXPIRED`.** Đây là mã UI mới thay cho `SELECTION_CHANGED` chung chung. Chuỗi xử lý: `#unlockUnconfirmed` xóa lỗi, rồi `#detachFromSession` đặt `COMPOSE_EXPIRED`. Test vẫn assert chỉ có một comment. Đổi đúng.
- **Kỳ vọng ORIGIN ở bước mở compose.** Kỳ vọng ban đầu sai vì fake trả 403 cho mọi mutation, và mutation đầu tiên là mở compose. Kỳ vọng mới phản ánh đúng hành vi: op mở compose ở `suspended`, retry dùng cùng key, `composes.size === 1`. Kỳ vọng không bị nới để test qua. Tên test nói “giữ khóa ở trạng thái tạm dừng”, đúng với op mở compose, nhưng có thể gây hiểu nhầm là submit.
- **`gcTime: Infinity` và `after(closeDom)`.** Cả hai chỉ có trong test: mỗi `mount` tạo một `QueryClient` riêng nên không rò cache giữa các test. `cleanup` sau mỗi test unmount và dispose controller. Production không đổi. Không có vấn đề.

## Breakage mới

- **B1 — Minor — `controller.ts` `#refresh`, nhánh `Date.parse(view.session.expiresAt) <= this.#now()`: nhả khóa submit dựa trên đồng hồ client.**
  - `#releaseSubmit` gọi `pending.reject` cho op/tombstone chưa giải quyết, rồi detach sang compose mới.
  - Lập luận “compose `open` đã hết hạn thì không thể commit” chỉ đúng theo đồng hồ server. Nếu client chạy nhanh hơn server, có hai hậu quả:
    - compose còn hạn ở server vẫn bị bỏ;
    - nếu draft đang `ambiguous`/`sending` và request cũ còn đang xử lý ở server, request đó vẫn có thể commit, trong khi tab đã nhả khóa và mở compose mới. Đó là đường tạo bản trùng.
  - `#releaseSubmit` cũng không chặn khi state là `sending`: một refresh chen vào (reconcile khi auth, retry file) sẽ đưa draft về `editing` giữa lúc đang gửi.
  - Cửa sổ hẹp (cần lệch giờ và request chậm), nên xếp Minor.
  - Fix:
    - Không release khi đang `sending`.
    - So với giờ server (header `Date` của response GET), hoặc cộng một biên lệch giờ.
    - Hoặc chỉ detach file, giữ khóa submit cho tới khi server từ chối thật.
- **B2 — Minor — `controller.ts` `discard()`: trong lúc `await` abandon, draft không có cờ nào chặn submit.**
  - Ở trạng thái re-entry, nút gửi vẫn bật. Nếu owner bấm gửi trong khe này, `resume` gửi đi trong lúc `discard` chạy tiếp và gọi `startNew()`. `#generation` tăng nên kết quả trả về bị bỏ qua âm thầm.
  - Nếu POST tới server trước DELETE, entity được tạo nhưng không có receipt, không invalidate, và draft đã bị xóa. Owner không biết.
  - Cũng trong `discard`: lỗi transport của DELETE bị nuốt (`.catch(() => undefined)`), nên khóa abandon còn treo trong panel dưới intent cũ.
  - Fix: đặt một cờ discarding (`submittable = false`, khóa nút) ngay đầu `discard`. Báo lỗi abandon thay vì nuốt, hoặc nhả khóa abandon khi GET cho thấy compose đã đóng.
- **B3 — Minor — `test/support/tsx-loader.ts` / `dom.ts` (chỉ ảnh hưởng hạ tầng test):**
  - `transformWithOxc` chạy với option tối thiểu. Vite config thật (plugin React, `define`/`import.meta.env`, alias) không được áp dụng, nên `.tsx` dùng `import.meta.env` hoặc alias sẽ chạy khác giữa test và build. Đây là cơ chế thứ hai song song với Vite SSR trong `app-wiring.test.ts`.
  - `register()` và các global của jsdom có hiệu lực cho toàn process. Hiện an toàn vì `node --test` cô lập mỗi file một process, nhưng sẽ rò nếu ai đó chạy `--test-isolation=none`.
  - Peer bắt buộc `@testing-library/dom` chỉ có trong lock nhờ auto-install-peers, không được khai báo trong `package.json`.
  - Fix: khai báo `@testing-library/dom` 10.4.2 trong devDependencies. Ghi chú trong `dom.ts`: chỉ dùng cho component không phụ thuộc `import.meta.env`/alias, hoặc chuyển sang `ssrLoadModule` dùng chung config Vite.

## Assessment

N1–N5 và I5 đều ADDRESSED, có RED trước khi sửa hoặc có đột biến chứng minh. Bảy mismatch G2 khớp với server ở mức fake và mức xử lý của composer. Các kỳ vọng test bị đổi đều có lý do chính đáng, không phải nới test để qua. Còn 3 breakage Minor, không có Important mới.

**Task quality:** Approved (B1–B3 Minor, đưa vào ledger; A5 vẫn BLOCKED theo handoff fixture)
