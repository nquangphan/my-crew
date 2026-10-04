# Crew v2 — Lộ trình triển khai

**Spec đã duyệt:** [/Users/phannhatquang/Documents/projects/crew/docs/superpowers/specs/2026-10-01-crew-v2-design.md](/Users/phannhatquang/Documents/projects/crew/docs/superpowers/specs/2026-10-01-crew-v2-design.md).
**Trạng thái:** phần 01 đã triển khai và review đạt; các phần 02–09 cần kế hoạch chi tiết riêng.

## Cách chia việc

V2 xây độc lập trong `v2/` ở giai đoạn phát triển, có package, cấu hình và docs riêng. Không import app,
scheduler, role prompt, schema nghiệp vụ hoặc database v1. Thư mục tạm này giúp tránh làm hỏng v1 đang
chạy; khi nghiệm thu, đóng gói/deploy v2 riêng. Không xóa hay migrate prod trong task bootstrap.

Đây là lộ trình toàn sản phẩm, không phải kế hoạch thực thi một lần. Mỗi phần có kế hoạch chi tiết và
review riêng, dựa vào hợp đồng phần trước. Chỉ [phần nền tảng](phase-01-domain-foundation.md) đã có
kế hoạch task/code cụ thể trong lần lập kế hoạch này.

## Các phần và điều kiện nghiệm thu

| Phần | Kết quả chạy được | Nghiệm thu và phụ thuộc |
|---|---|---|
| 01. Hợp đồng miền | Thư viện v2 độc lập, test ticket/model/workflow/docs gates | Kế hoạch chi tiết kèm theo; không cần DB hoặc model thật |
| 02. Server và docs | API single-owner, projects, machine binding, ticket/event store, docs import/search | DB v2 riêng, backup trước schema/data change; nhập docs không đổi v1, đối chiếu checksum và chạy lại không trùng |
| 03. Cổng macOS và workflow | App/host riêng, heartbeat, command ack, registry/install và session isolation | Đóng cửa sổ không dừng job; reconnect không chạy trùng; cài đủ hai bộ, ghim run, chặn skill chéo thực sự |
| 04. Runtime và model pool | Claude Code, Codex, API tool loop; công tắc từng máy; fallback | Thực thi task thật trên checkout thử nghiệm, giữ artifact khi đổi runtime; nguồn tắt không dispatch mới |
| 05. Attachment | Upload tạm, ticket/comment linking, đọc ảnh/file có nguồn | Paste trước tạo ticket, retry không trùng, PDF scan/DOCX/XLSX/CSV; lỗi hoặc đọc thiếu phải được báo |
| 06. Trợ lý và workflow runs | Đọc docs mọi dự án, định tuyến, đánh giá ticket, chọn model, hỏi owner | Superpowers mặc định; BMAD lấy bước từ release; gates giữ nguyên; monitoring sự kiện + mỗi 5 phút |
| 07. Web | Hội thoại, board/list/flow chart, docs space, máy/model/runtime switches | Một nguồn trạng thái; sơ đồ nhánh và vòng sửa, deep-link ticket, attachment ở cả create/comment, responsive |
| 08. Tích hợp và docs gates | Review/test/docs trước merge, sync theo commit, deploy approval | Merge conflict phải kiểm chứng lại; crash sau merge không merge lại; docs stale không đóng yêu cầu |
| 09. App update và vận hành | Web trigger, signed package, drain, health check, rollback, VPS release | Giữ identity ký app, không mất checkpoint; v2 deploy cần owner duyệt hoặc ticket deploy |

## Hợp đồng xuyên phần

- Ticket và model policy dùng API miền phần 01; phần server thêm validation đầu vào và transaction.
- Server là nguồn trạng thái bền vững; lease có fencing token và idempotency key. Host mất mạng không
  đồng nghĩa process chết. Không cấp attempt thay thế trước đối chiếu process/artifact.
- Workflow registry gồm name/version/revision/checksum; nguồn đã cài và cấu hình mong muốn riêng.
- Runtime adapter cung cấp inventory, start, checkpoint, cancel và reconcile; mỗi attempt ghim workflow.
- Attachment có ID bền vững, checksum, quyền và trạng thái đọc; checkpoint tham chiếu ID thay vì context cũ.
- Trợ lý chọn model trong các ứng viên đủ khả năng, lưu rationale; policy không thay suy luận chọn độ mạnh.
- Web đọc cùng ticket/event store với Trợ lý; approval ghi vào decision log, không chỉ là comment text.
- Docs có commit nguồn và trạng thái audit. Spec/story/plan không được coi là docs đã phản ánh code.

## Khảo sát kỹ thuật trước các phần có rủi ro

Trước phần 03, kiểm tra release BMAD chính thức, danh mục workflow được hỗ trợ và cơ chế cài ghim version.
Thử cách ly Claude/Codex khỏi skill/plugin user và project; ghi bằng chứng từ init/tool calls, không chỉ
prompt. Nếu runtime không chặn được nguồn skill thì chưa nghiệm thu adapter đó.

Trước phần 04, xác minh giao diện runtime và tool calling của từng API cấu hình; không giả định mọi
endpoint tương thích hỗ trợ vision/tool calls giống nhau. Trước phần 07, chốt mockup Jira/Confluence
và flow chart với owner. Trước phần 09, xác minh app signing/updater bằng máy macOS thử nghiệm.

Chọn stack cho server/web/desktop và release dependency khi lập kế hoạch tương ứng, từ tài liệu chính
thức. Cùng thư viện phổ biến với v1 không đồng nghĩa tái dùng code v1. Không ghim phiên bản BMAD chưa
được khảo sát hoặc tự bịa các bước BMAD.

## Coverage của spec

| Mục spec | Phần chịu trách nhiệm |
|---|---|
| 1–2 phạm vi, thành phần, chuyển docs | 01–03, 09 |
| 3 Trợ lý và quyền | 06, 07 |
| 4 pool model, API, switches, multimodal | 01, 04–06 |
| 5 workflow/version/isolation | 01, 03, 06 |
| 6 ticket, trạng thái, năm vòng | 01, 02, 06–08 |
| 7 merge/deploy/phục hồi | 02–04, 08–09 |
| 8 giám sát năm phút | 06, 07 |
| 9 chuẩn docs và sync | 02, 08 |
| 10 Jira/Confluence/flow chart/attachment | 05, 07 |
| 11 signed remote update | 09 |
| 12 import và kiểm thử | mọi phần; hệ thống tích hợp ở 09 |

## Review và thực thi

**Bổ sung MVP2 đã chốt ngày 04/10/2026:** [Docs, graph flow, lưu trữ, token usage và vòng đời agent](mvp2-docs-storage-usage.md).
Tài liệu này bổ sung phạm vi yêu cầu, chưa phải phần đã triển khai hoặc nghiệm thu.

Đọc spec, lộ trình và kế hoạch phần 01. Chọn native hoặc subagent-driven trước khi thực thi.
Không bắt đầu phần kế tiếp chỉ vì phần trước xong: cần kế hoạch chi tiết được review cho phần đó.
Không coi lộ trình này là đã hoàn thành kế hoạch task/code cho toàn bộ chín phần.

## Yêu cầu bổ sung đã chốt khi thực thi phần 01

Trợ lý v2 làm PM: chia task, review độc lập từng task, chạy song song theo phụ thuộc/ownership,
kiểm tra telemetry trước mọi implement/review/fix dispatch và cleanup tài nguyên run. Yêu cầu này
đã ghi vào spec; phần 03 xây telemetry/resource registry, phần 06 xây điều phối, phần 09 nghiệm thu
cleanup/recovery. Thư viện miền phần 01 chưa triển khai những chức năng runtime này.
