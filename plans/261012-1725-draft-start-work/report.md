# Nút "Bắt đầu làm" cho yêu cầu nháp

- Ngày 12/10/2026, giờ Asia/Ho_Chi_Minh. Agent làm, Trợ Lý ghi lại vì agent không được ghi file báo cáo.
- Kết quả: DONE_WITH_CONCERNS. Chưa push, chưa deploy.

## Commit (nhánh `crew/project-access`)
- `4b38a63d8` test(crew): khóa đường server của Bắt đầu làm yêu cầu nháp
- `e4076ae91` feat(crew-web): nút Bắt đầu làm cho yêu cầu nháp

## Server: có đánh thức agent, không cần sửa
- Cổng Crew `evaluateIssueGate` (`server/src/crew/issue-gate.ts`) cho board (owner, operator) đổi `backlog → todo`.
- Route PATCH stock (`server/src/routes/issues.ts`) đánh thức assignee với lý do `issue_status_changed` khi issue rời `backlog`.
- `execution_reconciliation_required` chỉ áp khi issue có run lỗi cần đối soát; nháp chưa chạy lần nào nên không dính.
- Test `server/src/__tests__/crew-draft-start-work.db.test.ts` (Postgres nhúng, route thật, chỉ stub adapter): 3/3 pass.
  Tạo nháp không đánh thức ai; PATCH `todo` của owner và operator tạo đúng một wake và một run của Trợ Lý; PATCH lại không đánh thức thêm.

## Web
- `src/features/issues/detail/start-work.tsx` (mới): nút chỉ hiện trên nháp có agent nhận việc, ẩn với viewer và khách góp ý.
  Đọc lại issue trước khi gửi; hết là nháp thì không gửi.
- Nút ở header trang chi tiết và popup, và ở dòng nháp trong danh sách (chỉ desktop). Board kéo thẻ sang "Cần làm" đã có sẵn.
- Báo kết quả bằng thông báo nổi (crew-web không có toast). Thành công tự ẩn sau 6 giây.
- Trạng thái `backlog` đổi tên hiển thị thành "Nháp"/"Draft" toàn app. Trang chi tiết có khung "Yêu cầu nháp: agent chưa làm".
- Hướng dẫn: mục "Giao một yêu cầu mới" thêm bước 8; dòng "Yêu cầu không chạy" trỏ tới nút.
- E2E mới `s6-draft-start.spec.ts` (BA S6.19).

## Kiểm
| Lệnh | Kết quả |
|---|---|
| server vitest `crew-draft-start-work.db.test.ts` | 3/3 pass |
| crew-web typecheck, biome | sạch |
| vitest `start-work`, `issue-popup`, `issues-page` | 10/10, 12/12, 25/25 |
| T1 e2e PW-S6-19a, PW-S6-19b, PW-S0-5, PW-S4-1, PW-S4-2 | pass |

## Chưa kiểm
- PW-S6-19c (run thật của Trợ Lý sau khi bấm) cần T2 prod; chưa chạy.
- Issue từng chạy lỗi rồi bị kéo về `backlog` vẫn có thể gặp `execution_reconciliation_required`.

Ảnh: `draft-desktop.png`, `draft-phone.png`, `draft-list.png`.
