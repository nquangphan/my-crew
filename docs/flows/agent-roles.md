# Vai trò agent và quy trình ticket

> Flow `agent-roles`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow agent-roles` in ra
> đúng danh sách đó.

## Mục đích

Định nghĩa hành vi theo vai trò của mọi agent (assistant, PM, dev, QC) chạy trên nền tảng chạy job chung của
flow `agent-runs`: bước nào ứng với trạng thái nào của ticket, prompt và model của từng bước, cổng docs-init
và cổng MCP kiểm thử UI trước khi chạy, dữ liệu daemon tự ghi vào report (docs-first, skill/MCP đã dùng, tài
nguyên để lại), chính sách thử lại khi một lượt chạy thất bại, và việc bọc mọi văn bản chủ dự án không tự viết
thành dữ liệu không tin cậy. `rolePlanner` là `RolePlanner` mặc định cắm vào `JobRunner`
(`docs/flows/agent-runs.md`).

## Điểm vào

- `apps/daemon/src/roles/role-planner.ts` → `rolePlanner` — `RolePlanner` mặc định của `createDaemon()`
  (`docs/flows/daemon-runtime.md`), gồm bốn hook `plan`/`prepare`/`reportOverlay`/`afterRun`.

## Các bước

1. `apps/daemon/src/roles/role-registry.ts` → `resolveStage()`: chọn `RoleStage` của lượt chạy từ loại ticket,
   ticket con và loại job (`JobKind`) — không chỉ từ trigger, để một lần thức dậy sau crash, sau bình luận chủ
   dự án hay sau retry luôn rơi đúng bước. `request` → `assistant_triage`/`assistant_close`; `pm_task` →
   `pm_analyze` (chưa có subtask, hoặc lượt phân tích trước hỏi chủ dự án/crash/chạm trần —
   `breakdownOpen()`) / `pm_monitor` / `pm_accept`; `dev`/`bug` → `dev` hoặc `docs_update` theo `JobKind`;
   `qc` → `qc`; `docs_init` → `docs_init`. `STAGES` giữ prompt, nhãn và các đường trạng thái hợp lệ của từng
   bước, được `role-contracts.test.ts` replay qua `canTransition('agent', …)`.
2. `apps/daemon/src/roles/role-planner.ts` → `plan()`: ticket đang `needs_input`/`blocked`/`in_review` thì bỏ
   qua lượt chạy (chờ chủ dự án); `pm_analyze` chạy cổng `docsInitGate()`; `qc` chạy cổng `missingUiServers()`
   trước khi chạy (MCP bắt buộc chưa kết nối hoặc bị tắt thì không chạy — khác với cổng lúc đóng ticket,
   `unusedUiServers()` ở `ticket-mcp-server.ts`, chặn QC đóng khi MCP đã kết nối nhưng chưa từng được gọi, xem
   flow `agent-runs`); còn lại gọi `resolveModel()`, dựng biến prompt (`promptVars()`) và `renderPrompt()`; với
   một ticket `bug`,
   `worktreeBase` được tính từ `baseHeadsFor()` của chuỗi bug. `promptVars()` → `ownerRequest()`: ba bước PM
   (`pm_analyze`/`pm_monitor`/`pm_accept`) nhận thêm nguyên văn yêu cầu gốc của chủ dự án (tiêu đề, mô tả và
   bình luận của ticket `request` cha) nối vào `header` — **không bọc** vì chủ dự án tự viết, khác với mô tả
   `pm_task` (tóm tắt của assistant, vẫn bị `wrapUntrusted()`).
3. `apps/daemon/src/roles/model-policy.ts` → `resolveModel()`: `docs_init`/`docs_update` luôn `sonnet`/`high`
   (`DOCS_MODEL`, quyết định của chủ dự án, không phụ thuộc ticket hay allowlist máy); `dev`/`qc` lấy
   model/effort của subtask, rồi bản đồ độ phức tạp của máy, rồi mặc định theo bước; PM chạy `sonnet`, hoặc
   `opus` khi `pm_task.complexity === 'large'`; một model ngoài `models.allow` bị `clampModel()` kẹp xuống
   model được phép mạnh nhất ngay dưới nó kèm một bình luận thông báo.
4. `apps/daemon/src/roles/prompt-templates.ts` → `renderPrompt()`: `{{> partial}}` chèn `prompts/<partial>.md`
   (một lớp), rồi `{{var}}` thay giá trị của `vars`; thiếu biến là lỗi (không để `{{…}}` lọt tới agent), giá
   trị chèn vào không bao giờ được quét lại nên không tự mở rộng thành template. Template nằm cạnh module này
   (`prompts/<name>.md`); `setPromptsDir()` cho app đóng gói daemon trỏ tới bản đã chép (build chép qua
   `apps/daemon/scripts/copy-prompts.mjs`).
5. `apps/daemon/src/roles/workspace-prep.ts` → `prepare()` (qua `role-planner.ts` → `prepare()`): `dev`/`bug`
   merge các head nền (`mergeBaseHeads()`) — docs-init đã xong, `dependsOn` đã xong, các bug trước của cùng
   chuỗi (`baseHeadsFor()`); xung đột được để nguyên trong worktree kèm ghi chú cho agent tự giải quyết. PM
   merge head docs-init đã xong vào worktree của mình. Riêng `docs_init`:
   `installHooksForInit()` chạy `crew-docs install-hooks` ở main checkout (lệnh từ chối chạy trong worktree
   linked), rồi chép file hook vừa sinh vào worktree docs-init và khôi phục main checkout.
6. `apps/daemon/src/roles/docs-init-gate.ts` → `docsInitGate()`: `crew-docs check --all` (qua
   `docs-kit-bridge.ts`) trả exit 3 (`NOT_INITIALIZED`) thì daemon (không phải agent) tạo ticket con
   `docs_init` của `pm_task` bằng `createDocsInitTicket()` (model/effort cố định `sonnet`/`high`, ghi qua
   `JobWriter` nên idempotent), bình luận giải thích, chuyển `pm_task` sang `triage` nếu đang `todo`. PM
   `pm_analyze` bỏ qua lượt chạy cho tới khi `docs_init` xong; mọi subtask PM tạo sau đó tự phụ thuộc ticket
   này (`create_subtask` ở `docs/flows/agent-runs.md`).
7. `apps/daemon/src/roles/role-planner.ts` → `reportOverlay()`: gộp `capabilityUse()`/`capabilityGaps()` từ
   `apps/daemon/src/roles/skill-enforcement.ts` trên nhật ký công cụ của **mọi** job của ticket — skill bắt
   buộc chỉ tính trên các lượt `dev` thật (không tính job docs) — cộng `docsFirst()` (bước 8) và
   `leftResources` (job của ticket để lại tiến trình/cổng từ hai lần trở lên, kể cả job đang chạy hiện tại).
   Job docs/`docs_init` phải có worktree sạch mới lấy được `headSha`/`commits` (`git rev-parse`,
   `git rev-list`); report `pm_accept` lấy `headSha`/`commits` từ `merge_and_push` (`docs/flows/local-merge.md`)
   và tự thêm mục "## Dọn dẹp tài nguyên" khi PM quên viết. `skillsSelected`/`mcpsSelected` mà agent ghi vào
   report phải có trong kho skill/MCP của lượt chạy (không tính server đã tắt); ngoài kho thì report bị từ chối
   để agent ghi lại.
8. `apps/daemon/src/roles/docs-first-check.ts` → `docsFirst()`: `true` khi lần Read/Grep file nguồn đầu tiên
   trong worktree đến sau một lần tra docs (`docs_flow`, `docs_where`, `crew-docs flow|where`, hoặc Read
   `docs/index.md`); Read ngoài worktree, dưới `docs/`, `.claude/`, `.crew/`, `AGENTS.md`, `CLAUDE.md` không
   tính là đọc nguồn. Không đọc file nguồn nào thì mặc định đạt.
9. `apps/daemon/src/roles/role-planner.ts` → `afterRun()`: một lượt kết thúc mà không nộp report và không
   `handoff_docs` (các bước không nộp report: assistant/PM ngoài `pm_accept`) vẫn bị đối chiếu skill/MCP —
   cảnh báo tính theo **phiên**, không theo từng job: một lượt resume một phiên đã `select_capabilities` ở
   job trước (ví dụ chạy tiếp sau khi chủ dự án trả lời) không bị coi là thiếu preflight. Rồi gọi
   `apps/daemon/src/roles/docs-update-handoff.ts` → `afterDevRun()`/`afterDocsRun()` theo `stage`: `dev` kết
   thúc bằng `handoff_docs` xếp tiếp một job `docs_update` trên cùng worktree, phiên mới, model `sonnet`;
   không `handoff_docs`/`ask_owner` là một lượt thất bại (`no_handoff`). `docs_update` kết thúc bằng
   `return_to_dev` là thất bại (`docs_rejected`); ticket chưa `done` khi hết lượt là thất bại (`not_finished`).
   `qc`/`docs_init` thất bại nếu ticket chưa đóng (trừ khi đã `ask_owner`); `docs_init` xong thì đồng bộ
   snapshot docs (`syncInitDocs()`) để web thấy ngay.
10. `apps/daemon/src/roles/failure-policy.ts` → `decideFailure()`: `budget` chặn ticket ngay (`blocked`, chờ
    chủ dự án); các lý do khác được thử lại tới `MAX_ATTEMPTS` (2) lần thì mới chặn; một `docs_rejected` được
    thử lại bằng một job `dev` mới trên phiên dev cũ, mang theo nguyên văn output hook bị từ chối, mọi lý do
    khác lặp lại đúng loại job cũ.
11. `apps/daemon/src/roles/untrusted-wrap.ts` → `wrapUntrusted()`/`wrapTicketDetail()`: mọi văn bản chủ dự án
    không tự viết (mô tả ticket agent tạo, bình luận agent/system, report, nội dung repo) được bọc trong
    `<untrusted-data source="…">…</untrusted-data>`; delimiter bên trong bị vô hiệu hoá
    (`<untrusted-data` → `‹untrusted-data`) để không đóng khối sớm và chèn chỉ thị giả sau đó. Chỉ ticket
    `request` (chủ dự án viết trên web) là văn bản tin cậy.
12. `apps/daemon/src/roles/prompts/_shared-rules.md`, `_capability-preflight.md`: mọi prompt vai trò include
    hai partial này trước — ngôn ngữ, dữ liệu không tin cậy, skill tương tác chạy chế độ không hỏi,
    `ask_owner`, đường dẫn được bảo vệ; rồi bước bắt buộc kiểm tra skill/MCP (`get_ticket` →
    `context.capabilities` → `select_capabilities` với lý do từng mục → gọi skill qua công cụ `Skill` trước
    khi làm việc). Từng prompt theo vai trò (`assistant-triage`, `assistant-close`, `pm-analyze`, `pm-monitor`,
    `pm-accept`, `dev`, `docs-update`, `qc`, `docs-init`) thêm bước docs-trước-code, việc riêng của bước, và
    luồng trạng thái hợp lệ khớp với `STAGES` của bước 1.
13. Ma trận vòng đời kịch bản (`apps/daemon/test/lifecycle.test.ts` + `apps/daemon/test/lifecycle/*.yaml`) và
    kịch bản thật (`apps/daemon/test/live-workflow.test.ts`), xem mục Tests.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/daemon/src/roles/role-planner.ts` | `RolePlanner` mặc định: prompt, cổng, model, report, follow-up theo bước | `rolePlanner`, `missingUiServers`, `cleanupLines`, `ownerRequest` |
| `apps/daemon/src/roles/role-registry.ts` | Bảng bước, đường trạng thái hợp lệ, chọn bước | `STAGES`, `resolveStage`, `isTerminal`, `workChildren` |
| `apps/daemon/src/roles/prompt-templates.ts` | Nạp và render template Markdown | `renderPrompt`, `loadPrompt`, `setPromptsDir` |
| `apps/daemon/src/roles/model-policy.ts` | Model/effort theo bước, kẹp theo allowlist | `resolveModel`, `clampModel` |
| `apps/daemon/src/roles/skill-enforcement.ts` | Skill/MCP đã dùng so với bắt buộc/đã chọn | `capabilityUse`, `capabilityGaps`, `capabilityWarning`, `mergeChoices` |
| `apps/daemon/src/roles/docs-first-check.ts` | Kiểm tra đọc docs trước code | `docsFirst` |
| `apps/daemon/src/roles/docs-init-gate.ts` | Cổng docs-init của PM analyze | `docsInitGate` |
| `apps/daemon/src/roles/docs-update-handoff.ts` | Bàn giao dev → docs, phán quyết cuối lượt | `afterDevRun`, `afterDocsRun` |
| `apps/daemon/src/roles/failure-policy.ts` | Thử lại hay chặn ticket sau lượt thất bại | `decideFailure`, `MAX_ATTEMPTS`, `FailureReason` |
| `apps/daemon/src/roles/untrusted-wrap.ts` | Bọc văn bản không tin cậy | `wrapUntrusted`, `wrapTicketDetail`, `ownerWroteTicketText` |
| `apps/daemon/src/roles/workspace-prep.ts` | Merge head nền, cài hook cho docs-init | `mergeBaseHeads`, `baseHeadsFor`, `installHooksForInit` |
| `apps/daemon/src/roles/prompts/_capability-preflight.md` | Partial: bước kiểm tra skill/MCP bắt buộc | — |
| `apps/daemon/src/roles/prompts/_shared-rules.md` | Partial: quy tắc chung mọi vai trò | — |
| `apps/daemon/src/roles/prompts/assistant-triage.md` | Prompt assistant định tuyến yêu cầu | — |
| `apps/daemon/src/roles/prompts/assistant-close.md` | Prompt assistant tổng hợp và đóng yêu cầu | — |
| `apps/daemon/src/roles/prompts/pm-analyze.md` | Prompt PM phân tích và chia việc | — |
| `apps/daemon/src/roles/prompts/pm-monitor.md` | Prompt PM theo dõi subtask/tài nguyên | — |
| `apps/daemon/src/roles/prompts/pm-accept.md` | Prompt PM nghiệm thu, merge, đẩy lên | — |
| `apps/daemon/src/roles/prompts/dev.md` | Prompt dev viết code và test | — |
| `apps/daemon/src/roles/prompts/docs-update.md` | Prompt cập nhật docs và commit | — |
| `apps/daemon/src/roles/prompts/qc.md` | Prompt QC kiểm thử và review | — |
| `apps/daemon/src/roles/prompts/docs-init.md` | Prompt khởi tạo docs theo chuẩn | — |

## Dữ liệu

- Bảng: đọc/ghi `jobs` của `apps/daemon/src/state-db.ts` (flow `daemon-runtime`) — cột riêng của flow này:
  `stage`, `failed_attempts`, `capabilities` (lựa chọn skill/MCP của `select_capabilities`), `return_to_dev`.
  Đọc `job_cleanup`/`tool_log` để dựng `cleanupLines()` và `capabilityUse()`.
- Sự kiện: không tự phát; mọi ghi ticket (bình luận, transition, report, subtask) đi qua công cụ ticket của
  flow `agent-runs`, nên làm phát sinh sự kiện phía server (flow `ticket-lifecycle`/`event-delivery`).
- Gọi ngoài: `git` cục bộ (merge head nền, kiểm tra worktree sạch); `crew-docs check --all` và
  `crew-docs install-hooks` qua `docs-kit-bridge.ts` (flow `docs-check`/`docs-hooks`).

## Flow liên quan

- agent-runs: `JobRunner` gọi bốn hook của `rolePlanner`; `stage`, `notices`, `skip` của `PlannedRun` và
  `AfterRunDecision` (comment/block/status) được định nghĩa ở đó; `guard-hook.ts` chặn dev ghi `docs/` hay
  `git commit` khi `stage === 'dev'` (`codeOnly`); công cụ ticket `select_capabilities`, `return_to_dev`,
  `reject_work`, `merge_and_push` gọi vào các hàm của flow này.
- local-merge: `merge_and_push` (tool PM) gọi `mergeAndPush()`; `pm-accept.md` mô tả đúng luồng nghiệm thu đó.
- daemon-runtime: `rolePlanner` là `RolePlanner` mặc định của `createDaemon()`; cột job của flow này sống
  trong `state-db.ts` (migration cộng cột, không phá schema cũ).
- agent-workspace: `prepare()` merge head vào worktree `ensureWorktree()` đã dựng; `select_capabilities` đối
  chiếu với kho skill/MCP `probeInventory()` cấp.
- resource-hygiene: `cleanupLines()` đọc `job_cleanup` để đưa vào prompt PM; PM cảnh báo `leftResources` dựa
  trên cùng bảng.
- ticket-lifecycle: `create_subtask` (flow `agent-runs`) thêm `docs_init` vào `dependsOn`; PM `reject_work` gọi
  `fileBug()` với một dev/bug đã `done` (nhánh từ chối của PM, không phải QC báo lỗi).
- docs-sync-viewer: `syncInitDocs()` đồng bộ snapshot ngay sau khi `docs_init` xong.

## Tests

- `apps/daemon/test/role-contracts.test.ts`: mọi đường trong `STAGES[...].paths` và `FAILURE_PATHS` hợp lệ
  với `canTransition('agent', …)`; `resolveStage()` cho từng tổ hợp loại ticket/con/job; template render đúng
  partial và biến, báo lỗi khi thiếu biến.
- `apps/daemon/test/model-policy.test.ts`: docs luôn `sonnet`/`high` bất kể lựa chọn; dev/qc/pm theo đúng thứ
  tự ưu tiên; kẹp model ngoài allowlist xuống model mạnh nhất còn được phép.
- `apps/daemon/test/skill-enforcement.test.ts`: skill/MCP dùng thật từ nhật ký công cụ và slash command; gộp
  lựa chọn nhiều lượt của cùng ticket; khoảng trống bắt buộc/đã chọn trừ đã dùng; nội dung cảnh báo.
- `apps/daemon/test/docs-first-check.test.ts`: docs trước code đạt/không đạt theo thứ tự Read/Grep thật, Read
  ngoài worktree hay dưới `docs/` không tính, một run không đọc gì mặc định đạt.
- `apps/daemon/test/docs-init-gate.test.ts`: dự án chưa có docs tạo đúng một `docs_init` con (idempotent), dự
  án đã có docs cho `pm_analyze` chạy ngay.
- `apps/daemon/test/docs-update-handoff.test.ts`: `handoff_docs` xếp đúng job `docs_update` tiếp theo;
  `return_to_dev`, thiếu `handoff_docs`, ticket chưa đóng đều thành lượt thất bại đúng lý do; `decideFailure()`
  thử lại rồi chặn ở `MAX_ATTEMPTS`.
- `apps/daemon/test/role-policies.test.ts`: bọc dữ liệu không tin cậy và vô hiệu hoá delimiter bên trong; QC
  phát hiện đúng MCP bắt buộc chưa kết nối/bị tắt; guard giữ lượt dev ngoài `docs/` và tránh `git commit`.
- `apps/daemon/test/lifecycle.test.ts` (kịch bản dưới `apps/daemon/test/lifecycle/*.yaml`, mỗi file có
  `description` riêng): toàn bộ vòng đời qua API và daemon thật, runner kịch bản (không tốn phí model), git
  worktree và hook crew-docs thật — happy path, docs bị hook từ chối rồi commit lại, capability preflight, dọn
  tài nguyên và đánh thức PM, nhiều bug liên tiếp, chạm trần chu kỳ bug, huỷ ticket giữa lúc dev đang chạy,
  crash giữa lúc PM chia việc, resume sau backoff, xung đột block docs sinh tự động khi merge, dự án chưa có
  docs, chạm trần con, budget hold, QC thiếu MCP bắt buộc, PM từ chối một ticket dev — mỗi kịch bản kết thúc ở
  trạng thái ổn định, không ticket nào bị kẹt (`stuckTickets()`).
- `apps/daemon/test/live-workflow.test.ts` (tuỳ chọn `CREW_LIVE_AGENT_TESTS=1`): toàn bộ luồng trên model
  thật (đăng nhập gói đăng ký), một repo fixture có docs, skill và MCP Playwright của dự án.
