# Quy trình ticket

Đọc trước [Hướng dẫn sử dụng](user-guide.md) nếu chỉ cần biết cách dùng web. Trang này dành cho chủ dự án và
dev muốn hiểu một yêu cầu đi qua những bước nào, từ lúc tạo tới lúc code được merge.

## Tổng quan luồng

1. Chủ dự án tạo ticket `request` trên web, giao cho trợ lý.
2. Trợ lý phân loại (`assistant_triage`) và định tuyến ticket `request` tới một hoặc nhiều dự án, tạo ticket
   `pm_task` con cho mỗi dự án.
3. PM phân tích (`pm_analyze`) yêu cầu, hỏi lại chủ dự án nếu cần (ticket chuyển "Chờ bạn"), rồi chia việc
   thành các subtask `dev`/`qc` (kèm `docs_init` nếu dự án chưa có docs).
4. Dev triển khai code và test trên subtask `dev`.
5. Dev bàn giao cho job cập nhật docs (`docs_update`, job riêng chạy ngay sau đó, model cố định `sonnet`) —
   job này cập nhật docs khớp code rồi commit code + test + docs trong cùng một commit.
6. QC kiểm thử subtask `qc` ghép cặp với dev đó.
7. QC báo lỗi hoặc PM từ chối lúc nghiệm thu thì tạo nhánh `bug` (dev sửa lại, QC retest), lặp tối đa 3 chu kỳ.
8. PM nghiệm thu (`pm_accept`) toàn bộ cây khi mọi subtask đã xong.
9. Merge cục bộ, chạy cổng trước khi đẩy (pre-push gate), rồi push lên nhánh mặc định.
10. Trợ lý tổng hợp và đóng (`assistant_close`) ticket `request` gốc.

## Bảng loại ticket và ai xử lý

| Loại (`TicketType`) | Ai xử lý |
|---|---|
| `request` | Trợ lý (assistant) |
| `pm_task` | PM agent |
| `dev` | Dev agent |
| `qc` | QC agent |
| `bug` | Dev agent (sửa lại) rồi QC agent (retest) |
| `docs_init` | Job docs — model `sonnet` cố định, không phải một vai trò chọn được |

## Bảng trạng thái và chuyển trạng thái hợp lệ

8 trạng thái (`TicketStatus`) và nhãn hiện trên web:

| Trạng thái | Nhãn trên web |
|---|---|
| `todo` | Cần làm |
| `triage` | Đang phân tích |
| `needs_input` | Chờ bạn |
| `in_progress` | Đang làm |
| `in_review` | Review |
| `done` | Xong |
| `blocked` | Bị chặn |
| `cancelled` | Đã hủy |

Chuyển trạng thái hợp lệ theo actor (nguồn: schema workflow trong `packages/shared/src/status-workflow.ts`).
Đây là danh sách đầy đủ — không có cạnh nào khác ngoài các cạnh dưới đây (ví dụ agent không tự chuyển
`in_review` sang `blocked`), và không cạnh nào cho phép giữ nguyên trạng thái (`from === to`).

**Agent** (`AGENT_EDGES`):

| Từ | Sang |
|---|---|
| `todo` | `triage`, `in_progress`, `needs_input` |
| `triage` | `in_progress`, `needs_input` |
| `needs_input` | `in_progress` |
| `in_progress` | `needs_input`, `in_review`, `done`, `blocked` |
| `in_review` | `done`, `in_progress` |
| `blocked` | `in_progress` |

**Chủ dự án** (`OWNER_EDGES`, cũng là các lựa chọn trong dropdown trạng thái trên trang chi tiết ticket):

| Từ | Sang |
|---|---|
| `todo` | `cancelled` |
| `triage` | `cancelled` |
| `needs_input` | `in_progress`, `cancelled` |
| `in_progress` | `cancelled` |
| `in_review` | `done`, `in_progress`, `cancelled` |
| `blocked` | `in_progress`, `cancelled` |
| `done` | `in_progress` (chủ dự án mở lại) |

**Hệ thống** (cascade cancel khi ticket cha bị hủy): mọi trạng thái chưa `cancelled` → `cancelled`.

`done` và `cancelled` là hai trạng thái kết thúc (`TERMINAL_STATUSES`).

## Vai trò agent và giới hạn

- **PM**: phân tích yêu cầu, chia subtask, chấm độ phức tạp, phân tích phương án kiểm thử cho mỗi QC, nghiệm
  thu và merge — không có công cụ ghi code, chỉ dùng các tool ticket (`create_subtask`, `rate_subtask`,
  `plan_qc_test`, `retry_subtask`, `reject_work`, `merge_and_push`, `comment`, …). Trước mỗi subtask `qc`, PM
  xem subtask dev đi kèm đổi gì (API, logic, CLI, schema dùng chung, giao diện web, màn hình mobile hay chỉ
  docs) rồi chọn `testKinds` (`static_review`/`unit`/`integration`/`api`/`ui_web`/`ui_mobile`) và viết
  `testReason`; **chỉ `ui_web`/`ui_mobile` mới kéo theo MCP kiểm thử UI** (Playwright/Maestro) — một ticket chỉ
  đổi API hay logic không còn bị ép kiểm thử giao diện. Phương án của một QC chưa đóng chưa hợp thì
  `plan_qc_test` đổi tại chỗ, không tạo QC thay thế.
- **Dev**: viết code và test trên subtask `dev`/`bug` — bị guard chặn ghi `docs/**` hay Markdown ở gốc repo và
  chặn `git commit`; kết thúc lượt chạy bằng bàn giao cho job docs (`handoff_docs`).
- **QC**: kiểm thử theo tiêu chí nghiệm thu của subtask, làm đúng từng loại kiểm thử trong phương án PM đã
  chọn (report ghi loại nào đã chạy và kết quả); không đóng được ticket khi một MCP server bắt buộc của lượt
  chạy chưa từng được gọi công cụ nào (trừ khi thay đổi đang xét chỉ đổi docs). QC `blocked` vì MCP kiểm thử UI
  chưa kết nối mà thay đổi thật ra không có giao diện: gắn thẻ `@pm` trên ticket QC, PM đổi phương án bằng
  `plan_qc_test` rồi mở lại bằng `retry_subtask`.
- **Trợ lý**: chỉ định tuyến ticket `request` và tổng hợp lúc đóng, không viết code hay docs.

## Cặp dev↔QC, `dependsOn` và vòng lặp bug

- Mỗi subtask `qc` bắt buộc ghép cặp (`pairsWith`) với đúng một subtask `dev`/`bug` còn sống và chưa có QC
  khác đảm nhận.
- `dependsOn` chỉ được trỏ tới ticket anh em (cùng `pm_task`), dùng để chờ một subtask khác xong trước khi bắt
  đầu.
- QC báo lỗi hoặc PM từ chối một ticket `dev`/`bug` đã xong thì tạo một ticket `bug` mới (kế thừa `complexity`/
  `model`/`effort` của dev gốc, kèm lý do "kế thừa từ …") cộng một `qc` retest (kế thừa cấu hình của QC đang
  kiểm), tăng dần số chu kỳ. Vượt quá 3 chu kỳ (`MAX_BUG_CYCLES`) thì dừng tạo bug mới và tạm dừng cả cây
  `pm_task`, chờ chủ dự án.

## Docs đi cùng code

- **Cổng docs-init**: trước khi PM chia việc, hệ thống kiểm tra dự án đã có chuẩn docs chưa (`crew-docs check
  --all`); chưa có thì tự tạo một ticket `docs_init` (model `sonnet` cố định) để khởi tạo docs trước, PM chờ
  ticket đó xong mới chia subtask.
- **Job cập nhật docs sau mỗi dev**: dev không được ghi `docs/**`/Markdown gốc và không được `git commit`; khi
  xong việc, dev bàn giao cho một job `docs_update` riêng (model `sonnet` cố định) — job này cập nhật docs
  khớp code rồi commit code + test + docs trong cùng một commit.
- **Thứ tự "docs trước code"**: mọi agent phải tra docs (`docs/index.md`, trang flow liên quan) trước khi đọc
  file nguồn lần đầu trong worktree của lượt chạy.

## Độ phức tạp và chọn model

PM bắt buộc chấm `complexity` (`trivial`/`small`/`medium`/`large`) và một dòng lý do cho mỗi subtask `dev`/
`qc` — không có model mặc định nếu chưa chấm. Máy áp bảng mặc định sau, sửa được ở "Cài đặt hệ thống → Models"
(chung mọi máy) hoặc "Cài đặt hệ thống → Máy → tên máy" (riêng một máy):

| Độ phức tạp | Model mặc định | Effort |
|---|---|---|
| `trivial` | `haiku` | `low` |
| `small` | `sonnet` | `medium` |
| `medium` | `sonnet` | `high` |
| `large` | `opus` | `high` |

PM có thể tự ghi đè `model`/`effort` trên một subtask, chỉ nhận `haiku`/`sonnet`/`opus` (không có Fable —
quyết định của chủ dự án, `opus` là model mạnh nhất chọn được). `docs_init`/`docs_update` luôn chạy `sonnet`,
không phụ thuộc bảng trên hay lựa chọn của PM.

## Skill và MCP

Trước khi làm việc, mỗi agent đọc `context.capabilities` (từ công cụ `get_ticket`) để biết skill và MCP server
có sẵn trong thư mục làm việc, chọn mọi skill/MCP liên quan tới bước hiện tại qua `select_capabilities` (kèm
lý do từng mục), rồi gọi các skill đã chọn bằng công cụ `Skill` trước khi bắt đầu việc chính. Skill hoặc MCP
**bắt buộc** của ticket mà không được dùng trong lượt chạy sẽ bị ghi vào report kèm bình luận cảnh báo.

MCP kiểm thử UI (Playwright/Maestro) không còn là MCP mặc định của mọi ticket QC: server chỉ thêm nó vào
`requiredMcps` khi phương án kiểm thử PM chọn (`testKinds`) có `ui_web`/`ui_mobile`. QC không đóng được ticket
khi một MCP bắt buộc chưa từng được gọi công cụ nào; QC bị chặn vì MCP kiểm thử UI chưa kết nối trong khi thay
đổi thực ra không có giao diện thì không tự bỏ qua — gắn thẻ `@pm` để PM đổi phương án bằng `plan_qc_test`
(server tính lại `requiredMcps`) rồi mở lại bằng `retry_subtask`.

## Ngân sách, thử lại và khi nào ticket bị chặn chờ chủ dự án

- Ba giới hạn: số ticket con tối đa mỗi ticket cha, ngân sách mỗi cây `pm_task`, ngân sách mỗi ngày của dự án
  — vượt một trong ba thì tạm dừng cả cây `pm_task` (chuyển "Chờ bạn"), cần chủ dự án bình luận hoặc chuyển
  trạng thái để gỡ.
- Một lượt chạy thất bại được thử lại tối đa 2 lần trước khi ticket chuyển "Bị chặn"; riêng lý do hết ngân sách
  chặn ticket ngay, không thử lại.
- Ticket bị chặn chờ chủ dự án khi: hết ngân sách, thử lại hết số lần cho phép, hoặc PM cần chủ dự án quyết
  định một việc không tự quyết được (ví dụ huỷ việc hay chưa rõ ý chủ dự án).

## Nghiệm thu và merge

Khi mọi subtask của một `pm_task` đã xong, PM gọi công cụ `merge_and_push`: merge cục bộ từng ticket theo đúng
thứ tự phụ thuộc, chạy cổng trước khi đẩy (test của dự án, kiểm chuẩn docs trên toàn bộ commit vừa gộp, kiểm
đường dẫn được bảo vệ), rồi push lên nhánh mặc định của `origin` — không có bước nào trong quy trình này để
agent tự chạy `git merge`/`git push` ngoài luồng đó; đây là cách duy nhất một `pm_task` được coi là nghiệm thu
xong, chủ dự án không tự tay merge PR nào. Xem chi tiết ở
[Nghiệm thu: merge cục bộ, cổng pre-push và push](../flows/local-merge.md).

## Đọc thêm

- [Vai trò agent và quy trình ticket](../flows/agent-roles.md) — prompt, model, cổng và dữ liệu report theo
  từng bước agent.
- [Chạy agent qua Agent SDK](../flows/agent-runs.md) — nền tảng chạy một job từ đầu đến cuối.
- [Vòng đời ticket](../flows/ticket-lifecycle.md) — tạo, chuyển trạng thái, bình luận, report, ngân sách.
- [Nghiệm thu: merge cục bộ, cổng pre-push và push](../flows/local-merge.md) — chi tiết bước merge và push.
