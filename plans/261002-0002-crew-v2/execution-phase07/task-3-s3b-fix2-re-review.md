# CREWV2-701 / Task 3 — S3b fix2: re-review theo phạm vi

Phạm vi: `d9216cc..ab1bb3a` (`task-3-s3b-fix2-review-package.diff`) và mục 6 của `task-3-s3b-report.md`. Đối
chiếu với API S5a ở HEAD: `ComposerHandle`/`onHandle` tại `composer.tsx:76-79,316-333`,
`ComposeController.discardDraft` tại `controller.ts:513-541`, và `composeLocks` tại `state.ts:663-675`.
Không chạy lại test.

## Verdict từng finding

| Finding | Verdict | Bằng chứng |
|---|---|---|
| B1: `clearTicketDrafts` | **ADDRESSED (hàm + hợp đồng)** | Hàm xóa các key có trong index và thêm mọi key có tiền tố `crew-v2:form-draft:` khi storage liệt kê được, kể cả chính index. Không phụ thuộc việc đã tạo kho trong lần tải trang hiện tại. Mỗi `removeItem` được bọc riêng nên một key lỗi không chặn các key khác. Unit test có cả storage không liệt kê được lẫn storage có key lạc. Controller vẫn phải gọi hàm này trong `session.onLogout`; khi chưa nối thì B1 chưa có tác dụng trong app. |
| B2: storage theo runtime | **ADDRESSED** | `useTicketDrafts()` lấy storage từ `TicketDraftStorageProvider`; không có thì dùng `MemoryDraftStorage`. Đã bỏ `globalThis.sessionStorage`. DOM test kiểm `window.sessionStorage` rỗng. Phụ thuộc controller wiring (⚠️ W1). |
| B4: read-only list, “Thử lại” dùng được | **ADDRESSED** | Ticket terminal render `TerminalDocsLinks`: danh sách chỉ đọc qua cùng query `useTicketDocsLinks`, “Thử lại” và “Tải thêm” không bị disable, không có control nào sửa dữ liệu. Không còn `fieldset`. Có DOM test cho trường hợp lỗi 500 → Thử lại → danh sách hiện ra. |
| I3: discard trọn qua handle | **ADDRESSED** | `DraftDiscard` gọi `handle.discardDraft()` và chỉ chạy `onDiscarded` khi kết quả là `'discarded'`. Với `blocked`/`unconfirmed`/exception thì giữ field và hiện thông báo. `discardMode`: `accepted` → ẩn, `ambiguous`/`suspended` → phải xác nhận qua `alertdialog` (“Vẫn bỏ bản nháp”/“Giữ lại”), còn lại gọi trực tiếp (`sending` nhận `blocked`). Test cho thấy “Giữ lại” không gửi DELETE và xác nhận thì bỏ được. Cả form và bình luận đều có test bỏ trọn, kể cả trường hợp `unconfirmed`. |

## Kiểm thêm

- **Index lệch với storage thật:**
  - `#write` ghi key trước rồi mới ghi index, nên nếu crash hoặc hết quota giữa hai bước thì key có thể không có trong index.
  - Với `sessionStorage` (liệt kê được), `clearTicketDrafts` vẫn quét theo tiền tố nên không sót.
  - Storage không liệt kê được chỉ là storage bộ nhớ, mất theo lần tải trang, nên không có dư lượng.
  - Index chứa key không còn tồn tại thì vô hại.
  - Nhiều tab: `sessionStorage` riêng theo tab, kể cả tab nhân bản (bản sao độc lập), nên không có ghi tranh chấp. Trong một tab, JS chạy đơn luồng và read-modify-write là đồng bộ.
  - Kết luận: không có đường nào để sót dữ liệu sau logout, miễn là controller gọi hàm.
- **Assertion cũ bị đổi** (`create-request.test.ts`, test “mất response rồi hết phiên”): `queryByRole('button', /Bỏ bản nháp yêu cầu/) === null` được thay bằng “không có `alertdialog` tự mở”. Việc đổi này đúng theo hợp đồng mới (nút hiện ở ambiguous nhưng phải qua bước xác nhận), và hành vi xác nhận đã có test riêng. Assertion mới hơi yếu: nó không khẳng định nút có hiện, cũng không khẳng định bấm nút thì chỉ mở xác nhận. Test riêng đã bù phần đó nên chấp nhận được.

## Breakage mới / cảnh báo

### Minor

- **N1: re-entry tombstone được bỏ mà không cần xác nhận cảnh báo trùng.**
  - Vị trí: `create-request-state.ts` `discardMode`, kết hợp `state.ts:673` (`reportedState: needsPayload ? 'editing' : …`).
  - Với key bị tombstone sau logout, composer báo `'editing'`, nên `discardMode` trả `'direct'` và form bỏ bản nháp ngay. Rủi ro trùng lại giống hệt ambiguous: key cũ có thể đã được lưu. Giảm nhẹ: đoạn cảnh báo của composer (`showDiscard`) vẫn hiện ngay bên cạnh, và hợp đồng PM chỉ nêu ambiguous/suspended.
  - Sửa: xin S5a đưa `needsPayload`/`discardable` ra ngoài (qua `onStateChange` hoặc handle), rồi dùng `confirm` khi `discardable`.
- **N2: bỏ bản nháp trước khi handle sẵn sàng thì composer không bị bỏ.**
  - Vị trí: `create-request.tsx` (`DraftDiscard.run`, `handle() === null → 'discarded'`).
  - Ngay sau khi mount, controller chưa sẵn sàng nên `onHandle` chưa được gọi. Khi đó bấm bỏ chỉ xóa field, còn draft composer khôi phục từ storage (session/tệp) vẫn còn. Với form, khi `projectReady` là false thì composer không mount, nên draft composer `create-request` cũ (nếu có) cũng không bị abandon.
  - Cửa sổ ngắn, nhưng trái với mục tiêu “bỏ trọn”. Sửa: khi `handle()` null mà composer đang hoặc sẽ mount thì disable nút (hoặc trả `blocked`), không coi là `discarded`.
- **N3: nút “Bỏ bản nháp bình luận” luôn hiện, kể cả khi trống.** Vị trí: `detail.tsx` (`CommentComposer` → `DraftDiscard`). Trước đây nút chỉ hiện khi `text !== ''`, giờ hiện trên mọi ticket mở, kể cả khi không có chữ hay tệp. Gây nhiễu, và vô hại vì bỏ draft trống chỉ gọi `startNew`. Sửa: ẩn khi `text === ''` và composer không có draft (cần `hasDraft` từ S5a, hoặc chấp nhận).
- **N4: trạng thái xác nhận bị treo lại.** Vị trí: `create-request.tsx` (`DraftDiscard`, state `confirming`). Khi đang mở xác nhận mà state chuyển sang `accepted`, component trả `null` nhưng `confirming` vẫn là true. Lần sau quay lại `ambiguous`, hộp xác nhận tự hiện, và nút chính bị disable cho đến khi bấm “Giữ lại”. Sửa: reset `confirming` khi `mode !== 'confirm'`.
- **N5: kho bị khóa vào storage của lần gọi đầu tiên.** Vị trí: `create-request-state.ts` (`formDrafts`, WeakMap theo session). Lần gọi đầu quyết định storage của kho; các lần gọi sau với storage khác đều bị bỏ qua. Nếu có một cây con nằm ngoài provider render trước, toàn bộ phiên sẽ chạy bằng bộ nhớ. Hiện chưa gặp vì provider bọc toàn bộ vùng đã đăng nhập. Sửa: key theo `(session, storage)`, hoặc assert cùng storage.

### ⚠️ Wiring / còn mở

- **W1:** I2 (persist qua reload) và B2 chỉ có tác dụng khi controller bọc `TicketDraftStorageProvider storage={runtime storage}`. Nếu thiếu, app rơi về chế độ bộ nhớ và field lại lệch body frozen sau reload, tức là I2 quay lại. B1 cũng chỉ có tác dụng khi controller gọi `clearTicketDrafts(storage)` trong `session.onLogout`. Cả hai cần controller review.
- **W2:** B3 (draft bình luận của ticket terminal tích lũy trong storage), M6 (ticket terminal ngay khi tải trang thì đi qua panel Task2), D3 phía S5a và A3 BLOCKED vẫn mở như report ghi.

## Kết luận

**Task quality:** Approved với điều kiện. B1, B2, B4 và I3 đều ADDRESSED. Không có breakage Critical hay Important; N1–N5 là Minor. Controller phải làm phần wiring ở W1 thì I2 và B1 mới có hiệu lực trong app.
