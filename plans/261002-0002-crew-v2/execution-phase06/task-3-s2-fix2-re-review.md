# Re-review S5 FIX2: `4653b89..cb02a7d`

Reviewer: code-reviewer (phạm vi hẹp). Em đọc diff source của `gates.ts` (`conflictKey`, `parallelUnits`, `assertRunCurrent`), `runs.ts` (`readRun`) và mục "Vòng sửa 2" trong report. Em cũng đối chiếu `docs/manifest.ts:36–64` (`validPath`) và `migrations/002_journal.sql:16` (`events_project_cursor_idx`). Em không chạy lại test.

## Verdict

| Mục | Verdict | Căn cứ |
|---|---|---|
| N3: đóng khi không xác định được thứ tự | **ADDRESSED** | `assertRunCurrent` trả 409 khi run này không có row, khi `own.cursor` là null, khi một run khác cùng root có cursor null, hoặc khi có run mới hơn. Cursor được so bằng `BigInt` vì postgres.js trả bigint dưới dạng string. Test có seed run không có event. |
| N2: lọc events theo project | **ADDRESSED** | `assertRunCurrent` và `readRun` đều thêm điều kiện `e.project_id = project của root`, nên dùng được `events_project_cursor_idx`. Lần quét giờ chỉ giới hạn trong journal của project, không còn quét toàn bảng; không cần migration. Muốn có một index riêng `(ticket_id,type)` thì để lát schema sau. |
| N4: so xung đột theo decode, NFC và chữ thường | **ADDRESSED** | `conflictKey` được dùng cho cả kiểm trùng trong một unit lẫn kiểm lồng nhau giữa các unit. Giá trị lưu vẫn là key gốc. Test phủ các ca khác hoa thường, NFD/NFC, `%2F` và `%61`. |

## Hai điểm được yêu cầu kiểm

- **N3 có khóa gate ngoài ý muốn trong luồng bình thường không: không.**
  - Step ticket của run chỉ được tạo qua port. Đường này gọi `createTicket` → `appendEvent('ticket.created', projectId = project của ticket)`, và project đó trùng project của root. Vì vậy mọi run do `createRun` tạo đều có cursor và đều qua được kiểm tra.
  - Run đang được tạo ở Tx khác thì chưa nhìn thấy, và việc ghi run cũng bị tuần tự hóa theo khóa root.
  - Chỉ run được restore hoặc import mà thiếu event mới khóa cả root. Report đã ghi trường hợp này. Hướng hỏng là đóng (fail-closed), và gỡ bằng cách khôi phục event hoặc tạo run mới.
  - Event `ticket.created` của ticket repair không ảnh hưởng, vì ticket repair không phải `workflow_steps`.
- **`decodeURIComponent` gặp percent-encoding sai: không có ngoại lệ lọt ra ngoài.**
  - `conflictKey` chỉ chạy sau khi `ownershipPath` trả về khác null. `ownershipPath` gọi `validPath`, mà `validPath` đã bọc `decodeURIComponent` trong try/catch và trả false. Vì vậy `%E0%A4%A`, `%zz` và các chuỗi tương tự đều thành `shapeError` (400 ở gate, 409 `WORKFLOW_PARALLEL_SCOPE_MISMATCH` ở run), không ném `URIError`.
  - Dạng đã decode cũng được `validPath` kiểm. Các key như `src%2F%2Fdb`, `src%2F.%2Fa.ts`, `%2E%2E%2Fa` và `db%2F` (rỗng, `.`, `..`, `/` cuối) đều bị từ chối trước khi so.
  - Mã hóa kép như `%252e` chỉ được decode một lần thành `%2e`, là một tên literal chứ không phải `..`. Kết quả này chấp nhận được.

## Finding mới

Không có. N5 (export `conflictKey` cho T7) và N1 (đã có ruling PM: một artifact cho mỗi gate) giữ ở ledger.

## Assessment

**Task quality:** Approved. N2, N3, N4 ADDRESSED. Không có breakage mới.
