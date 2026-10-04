# Review P-G1a2 (148875a)

### Spec Compliance
- ✅ readGraph đọc nodes/dependencies/repair links trong một `REPEATABLE READ READ ONLY` transaction; snapshot bắt đầu ở `requireTicket` (query đầu, SELECT).
- ✅ Response shape + ACL không đổi (cùng `requireTicket`/`requireProjectScope`, nay nằm trong snapshot).
- ✅ Hàm assistant/mutation không bị sửa; `routes.ts` không đổi.
- ✅ RED tất định (xem dưới); docs/flows/files cập nhật.
- ⚠️ RED/GREEN chỉ dựa vào báo cáo implementer (không chạy lại theo yêu cầu).

### Callers trace
- `readGraph` có đúng 1 caller production: `routes.ts:256` qua `services.readGraph` (`service.ts:597`) với `options.db`.
- Chữ ký `readGraph(db: Db, ...)`, `Db = Sql` (`contracts.ts:9`), không nhận `Tx` -> không có caller truyền Tx, không có nested BEGIN, không đổi isolation giữa chừng, không phụ thuộc uncommitted writes. Assistant/journal/orchestration không gọi readGraph (grep toàn v2 ngoài src/test: không có).
- Test caller: chỉ `ticket-graph-snapshot.test.ts`.

### Strengths
- Thay đổi tối thiểu 1 dòng; READ ONLY khoá luôn khả năng ghi nhầm trong read path.
- Error/pool: `sql.begin` của postgres.js tự ROLLBACK + trả connection khi callback throw (404 từ requireTicket đi qua đường này); không có connection thủ công.
- Test tất định: hook `await`-ed ngay sau query `where root_id=` (nodes) trên kết nối khác, commit xong mới trả kết quả; trước fix, nodes cũ + dependencies mới -> edge trỏ node vắng (fail xác định); sau fix snapshot (đã bắt đầu từ requireTicket, trước hook) không thấy ghi chen. Không dùng timer/sleep. Khẳng định thêm đọc sau thấy đủ -> chứng minh ghi thực sự commit.

### Issues
**Critical:** none.
**Important:** none.
**Minor:**
- `ticket-graph-snapshot.test.ts:10-26` — Proxy nhận query bằng `strings.join('?').includes('where root_id=')`: phụ thuộc text SQL; nếu ai đổi câu nodes query (ví dụ `where t.root_id =`) hook không bao giờ nổ nhưng test vẫn có thể pass sai ở chiều "no torn read" — chỉ có `assert.ok(added)` bắt được (đã có, nên fail to-loud, chấp nhận). Fix tuỳ chọn: ghi chú coupling vào comment.
- `dependencies.ts:162` — comment tiếng Anh đúng quy ước identifier/comment? Repo docs tiếng Việt, comment code OK; không cần sửa.

### Assessment
**Task quality:** Approved
