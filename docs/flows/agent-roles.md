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
   qua lượt chạy (chờ chủ dự án) — **trừ khi** job mang theo một lời gọi `@pm` đã ghi nhận
   (`state.pmMentions(job.eventIds)`, flow `daemon-scheduling`, chỉ áp dụng khi ticket là `pm_task`): job đó vẫn
   chạy, ở bước `pm_monitor` (ghi đè bước đã `resolveStage()` chọn), để trả lời owner mà không đổi trạng thái
   pm_task đang chờ; một lần thức dậy không mang lời gọi nào của cùng ticket đang chờ vẫn bị bỏ qua như trước.
   `pm_analyze` chạy cổng `docsInitGate()`; một lượt `dev` (ticket `dev` hoặc `bug`, không phải `docs_update`)
   đang `todo` tự chuyển ticket sang `in_progress` ngay tại đây — trước khi dựng prompt — bằng
   `ctx.writer.write()` gọi `ctx.vps.transition()` (cùng cơ chế idempotent `<jobId>:<seq>` các ghi khác trong
   file này), gác bằng `canTransition('agent', ticket.status, 'in_progress')` giống mẫu `JobRunner.transition()`
   (`to: 'blocked'`, flow `agent-runs`); ticket không còn `todo` (đã `in_progress`, hoặc job resume/retry) thì bỏ
   qua, không gọi API. Nhờ vậy `dev.md` không còn bước thủ công `update_status` đầu tiên — agent luôn nhận
   ticket đã `in_progress`. `qc` trước tiên gọi `qcNeedsUiTest()` (nội bộ) — chỉ khi
   `ctx.settings.policy.qcUiTestOnlyForNonDocs` (`GuardPolicy` của cài đặt server job này chạy với, flow
   `server-settings`, mặc định `true`) mới xét, tắt cờ này thì luôn cần kiểm thử UI: thay đổi của riêng
   ticket đang được QC (`head_sha` của report dev ghép cặp) có đổi gì ngoài `policy.docsPaths` không
   (`diffNeedsUiTest()`, dùng `isDocsPath()` của flow `agent-runs`, cũng đọc `policy.docsPaths`). Thay đổi riêng của ticket là các commit trên nhánh cha-đầu-tiên
   (`--first-parent`) của `head` không tới được từ nhánh mặc định lẫn từ `builtOn` (head của ticket anh em đã
   xong cùng pm_task, trừ ticket ghép cặp — docs-init, dependency, các bug trước của chuỗi; một head đã chứa
   sẵn `head` của chính ticket này bị bỏ qua vì không dùng làm mốc được) — thường chính là `head^..head` vì job
   docs gộp code/test/docs vào một commit, nên một lần re-commit chỉ đổi docs sau đó không che được commit code
   trước; một commit merge chỉ tính phần khác với mọi nhánh cha (`git diff-tree --cc`) — merge sạch một head
   nền không thêm gì, merge xung đột được job docs gộp cùng code khi kết luận thì tính. Lỗi git, commit lạ,
   không có commit riêng nào hay thay đổi rỗng luôn tính là cần kiểm thử UI (mặc định an toàn) — chỉ khi có
   mới chạy cổng `missingUiServers()`
   trước khi chạy (MCP bắt buộc chưa kết nối hoặc bị tắt thì không chạy — khác với cổng lúc đóng ticket,
   `unusedUiServers()` ở `ticket-mcp-server.ts`, chặn QC đóng khi MCP đã kết nối nhưng chưa từng được gọi, xem
   flow `agent-runs`) — `missingUiServers()` chỉ tính trên `requiredMcps` của ticket, mà server chỉ gắn MCP kiểm
   thử UI khi phương án PM chọn (`testKinds`) có `ui_web`/`ui_mobile`, nên một QC không có loại UI không bao giờ
   chạm cổng này dù MCP đó chưa kết nối trên máy. Cổng chặn (nội bộ, không export) đăng bình luận nêu MCP còn
   thiếu và nhắc thêm đường gỡ: thay đổi của ticket dev đi kèm không có giao diện thì gắn thẻ `@pm` để PM đổi
   phương án bằng `plan_qc_test` (không tự mở chặn) rồi `retry_subtask`; diff chỉ đổi docs thì bỏ qua cổng này,
   prompt QC nêu rõ lý do không cần kiểm thử UI và
   yêu cầu report ghi đúng câu cố định (`DOCS_ONLY_QC_NOTE`), còn `PlannedRun.requiredMcps` của lượt chạy đó
   đặt rỗng (flow `agent-runs`); cần kiểm thử UI thì `uiTestText()` dựng đoạn hướng dẫn QC dùng từng MCP bắt
   buộc — nhánh Playwright (`/playwright/i.test(server)`) nói rõ server chạy headless/nền (không chiếm màn
   hình máy) nên QC không nên kỳ vọng thấy cửa sổ trình duyệt thật, cứ dựa vào accessibility snapshot/kết quả
   tool trả về; còn lại gọi `resolveModel()`, dựng biến prompt (`promptVars()`) và
   `renderPrompt()`; với
   một ticket `bug`,
   `worktreeBase` được tính từ `baseHeadsFor()` của chuỗi bug. `promptVars()` → `ownerRequest()`: ba bước PM
   (`pm_analyze`/`pm_monitor`/`pm_accept`) nhận thêm nguyên văn yêu cầu gốc của chủ dự án (tiêu đề, mô tả và
   bình luận của ticket `request` cha) nối vào `header` — **không bọc** vì chủ dự án tự viết, khác với mô tả
   `pm_task` (tóm tắt của assistant, vẫn bị `wrapUntrusted()`). Cùng lúc `ownerRequest()` trả thêm mô tả và
   bình luận owner của ticket `request` đó làm `imageTexts` (`ImageText[]`, flow `agent-runs`) — nguồn ảnh
   thứ ba mà lượt chạy quét, cộng với mô tả/bình luận của chính ticket job này (luôn quét, mọi bước); `plan()`
   gắn `imageTexts` vào `PlannedRun` khi không rỗng, để `JobRunner.execute()` tải và gửi kèm ảnh chủ dự án dán
   trong yêu cầu gốc cho cả ba bước PM. Bước `assistant_triage`/`assistant_close` không cần cơ chế này vì đã
   chạy thẳng trên ticket `request` (đã nằm trong nguồn luôn quét). `promptVars()` → `testPlanText()`/
   `testKindsText()`: biến `test_plan` (mục 4 bước 3 của `qc.md`) render phương án PM đã chọn cho ticket QC
   kind theo kind từ bảng dùng chung `TEST_KIND_INFO` (`@crew/shared`) cộng `testReason` (bọc
   `<untrusted-data source="ticket KEY testReason">`) và danh sách MCP bắt buộc khi `requiredMcps` không rỗng
   (giữ nguyên chỉ dẫn Playwright/Maestro của `uiTestText()`); ticket QC tạo trước khi có phương án (`testKinds`
   là `null`) hoặc diff chỉ đổi docs giữ nguyên văn bản `uiTestText()` cũ. Biến `test_kinds` (mục "Phương án kiểm
   thử của QC" của `pm-analyze.md`, và bước 4 của `pm-monitor.md`) là bảng loại kiểm thử ↔ công cụ cùng nguồn,
   cộng dòng loại UI mà `platform` của dự án dùng được (`isTestKindSupported()`) — `platform` lấy qua
   `projectPlatform()` (nội bộ, gọi `ctx.vps.listProjects()`, chỉ ở `pm_analyze`/`pm_monitor`; không đọc được
   thì `testKindsText()` in câu chung "Server từ chối loại UI mà platform của dự án không hỗ trợ."). Biến `ui_test`
   vẫn được điền như cũ cho một prompt ghi đè trên web còn dùng `{{ui_test}}`. `promptVars()` → `ownerCallsNote()`: khi job có
   lời gọi `@pm`, thêm mục `## Chủ dự án gọi PM (@pm)` vào đầu ghi chú prompt (mọi bước PM) — mỗi lời gọi (mới
   nhất 5, `MAX_OWNER_CALLS`) nêu ticket được tag (key/loại/trạng thái/`complexity`; riêng ticket `qc` thêm một
   dòng phương án kiểm thử hiện tại và MCP bắt buộc), lỗi job gần nhất của daemon
   trên ticket đó (`lastJobError()`, bọc `<untrusted-data source="job error of KEY">`), bình luận agent/system
   gần nhất khi ticket đang `blocked` (bọc `source="last agent comment on KEY"`), và nguyên văn bình luận của
   owner — **không bọc**, vì owner tự viết — cộng danh sách việc PM có thể làm (`rate_subtask` khi thiếu
   `complexity`, `plan_qc_test` cộng `retry_subtask` khi QC `blocked` vì MCP kiểm thử UI mà thay đổi không có
   giao diện, `retry_subtask` khi nguyên nhân chặn khác đã hết, `create_subtask` khi cần việc mới, `ask_owner`
   khi cần huỷ hay chưa rõ ý owner) và luôn `comment` lại trên ticket được tag.
3. `apps/daemon/src/roles/model-policy.ts` → `resolveModel()`: `docs_init`/`docs_update` luôn `sonnet`/`high`
   (`DOCS_MODEL`, quyết định của chủ dự án, không phụ thuộc ticket hay allowlist máy); `dev`/`qc` (kể cả `bug`)
   không có mặc định — lấy bản đồ độ phức tạp của máy theo `complexity` PM đã chấm cho subtask, model/effort
   PM tự đặt trên subtask (ghi đè có chủ đích) thắng bản đồ đó; ticket chưa có `complexity` (subtask cũ tạo
   trước khi bắt buộc đánh giá) làm `resolveModel()` ném `MissingComplexityError`, rơi vào đường crash của
   `job-runner.ts` (flow `agent-runs`) thay vì âm thầm chọn một model — bình luận báo lỗi này hướng PM đánh giá
   ngay bằng tool `rate_subtask` (flow `agent-runs`), không tạo subtask thay thế; PM chạy `sonnet`, hoặc `opus`
   khi `pm_task.complexity === 'large'`; một model ngoài `models.allow` bị `clampModel()` kẹp xuống model được
   phép mạnh nhất ngay dưới nó kèm một bình luận thông báo. **Fable không được dùng (quyết định của chủ dự
   án): `opus` là model mạnh nhất chọn được** — một ticket cũ còn đặt model `fable` (giá trị enum chỉ còn giữ
   cho hàng cũ) chạy trên `opus` kèm bình luận giải thích, rồi mới qua bước kẹp allowlist ở trên.
4. `apps/daemon/src/roles/prompt-templates.ts` → `renderPrompt(name, vars, overrides)`: `{{> partial}}` chèn
   `prompts/<partial>.md` (một lớp), rồi `{{var}}` thay giá trị của `vars`; thiếu biến là lỗi (không để
   `{{…}}` lọt tới agent), giá trị chèn vào không bao giờ được quét lại nên không tự mở rộng thành template.
   Template nằm cạnh module này (`prompts/<name>.md`) — vẫn là bản mặc định; `overrides` (từ
   `ctx.settings.prompts`, cài đặt server theo tên prompt, flow `server-settings`) thay bản đóng gói theo
   tên trước khi ghép partial/biến, nên một prompt được sửa trên web áp dụng từ job kế tiếp mà không cần cài
   lại app. `setPromptsDir()` cho app đóng gói daemon trỏ tới bản đã chép (build chép qua
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
8. `apps/daemon/src/roles/docs-first-check.ts` → `docsFirst(logs, cwd, policy)`: `true` khi lần Read/Grep file
   nguồn đầu tiên trong worktree đến sau một lần tra docs (`docs_flow`, `docs_where`, `crew-docs flow|where`,
   hoặc Read `docs/index.md`); Read ngoài worktree, dưới `docs/`, file Markdown ở gốc repo như `README.md`
   (`isDocsPath()` của flow `agent-runs`, theo `policy.docsPaths` của cài đặt server job này chạy với — mặc
   định `DEFAULT_GUARD_POLICY` khi không có, flow `server-settings`), `.claude/`, `.crew/`, `AGENTS.md`,
   `CLAUDE.md` không tính là đọc nguồn. Không đọc file nguồn nào thì mặc định đạt.
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
    khác lặp lại đúng loại job cũ. Cả bình luận thử lại ("Lần thử …/2 không thành: …") lẫn bình luận chặn
    ("Ticket bị chặn: …") đều nối thêm khối chẩn đoán `traceMarkdown()` của lượt vừa chạy (`run-trace.ts`, flow
    `agent-runs`) khi lượt đó để lại một `RunTrace` — áp dụng cho mọi lý do (`not_finished`, `budget`, lỗi
    runner kể cả `error_max_turns`, `no_handoff`, `docs_rejected`), nên một ticket dừng giữa chừng mà không nộp
    report vẫn để lại số lượt/thời gian/chi phí, tin nhắn cuối và các bước cuối của agent, không chỉ một dòng lý
    do. `failedJobText()` dựng dòng `failedJobs[].error` của heartbeat cùng cách: lý do bằng lời cộng
    `traceSummary()` một dòng, tối đa 500 ký tự.
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
    luồng trạng thái hợp lệ khớp với `STAGES` của bước 1. `pm-monitor.md` (bước 5, "bình luận và lời gọi @pm của
    chủ dự án"): xử lý mục "Chủ dự án gọi PM" trước, theo đúng ticket được tag rồi `comment` lại trên nó, trước
    khi trả lời bình luận thường khác trên chính pm_task. `assistant-triage.md` (bước tạo `pm_task`) và
    `pm-analyze.md` (bước tạo subtask) đều dặn giữ nguyên link `![…](/v1/attachments/<id>)` trong mô tả ticket
    con khi ảnh đó cần cho việc con, không đổi id hay đường dẫn — nhờ vậy `ticketImageTexts()` (flow `agent-runs`,
    luôn quét mô tả ticket của job) tìm thấy đúng ảnh cho lượt chạy của ticket con, nên dev/QC cũng nhận được
    ảnh dù không phải là ticket `request`. `pm-analyze.md` (bước 4, "chia việc"): trước mỗi
    `create_subtask` loại `qc`, mục "Phương án kiểm thử của QC" bắt buộc PM xem subtask dev đi kèm đổi gì (API,
    logic daemon, CLI, schema dùng chung, giao diện web, màn hình mobile, hay chỉ docs), chọn `testKinds` theo
    bảng `{{test_kinds}}`, theo luật chọn loại UI (chỉ chọn `ui_web`/`ui_mobile` khi có giao diện chạy được và
    tiêu chí nghiệm thu cần thao tác trên đó; có giao diện thì phải có loại UI tương ứng; không chọn loại UI
    platform dự án không có), viết `testReason` một dòng, và điền mục "## Phương án kiểm thử" bốn dòng bắt buộc
    (loại kiểm thử, công cụ/lệnh, công cụ UI, tiêu chí nghiệm thu ↔ cách kiểm) vào mô tả subtask QC; phương án
    của một QC đã tạo chưa hợp thì `plan_qc_test`, không tạo lại. Bảng ví dụ chấm `complexity` QC không còn gắn
    cố định với Playwright (QC `medium` có thể là "gọi 4 endpoint qua HTTP" chứ không chỉ "kiểm 3 flow UI"), và
    không còn câu "ngoài MCP kiểm thử UI mặc định của QC mà server tự thêm" — server chỉ gắn MCP kiểm thử UI khi
    phương án có loại UI. `qc.md` (mục 4 bước 3): `{{test_plan}}` thay câu "Kiểm thử UI bằng MCP bắt buộc…" cố
    định cũ; bước 4 yêu cầu report ghi từng loại kiểm thử đã chạy kèm kết quả, `testsRun` có ít nhất một dòng
    mỗi loại. `pm-monitor.md` (bước 4, "đánh giá lại subtask và phương án kiểm thử"): QC `blocked` vì MCP kiểm
    thử UI chưa kết nối/chưa được gọi mà thay đổi không có giao diện thì `plan_qc_test` đổi phương án, rồi
    `retry_subtask` khi đang trả lời `@pm` hoặc `comment` báo chủ dự án mở chặn khi không; bảng `{{test_kinds}}`
    liệt kê các loại chọn được.
13. Ma trận vòng đời kịch bản (`apps/daemon/test/lifecycle.test.ts` + `apps/daemon/test/lifecycle/*.yaml`) và
    kịch bản thật (`apps/daemon/test/live-workflow.test.ts`), xem mục Tests.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/daemon/src/roles/role-planner.ts` | `RolePlanner` mặc định: prompt, cổng, model, report, follow-up theo bước | `rolePlanner`, `missingUiServers`, `diffNeedsUiTest`, `uiTestText`, `DOCS_ONLY_QC_NOTE`, `cleanupLines`, `ownerRequest`, `ownerCallsNote`, `testPlanText`, `testKindsText` |
| `apps/daemon/src/roles/role-registry.ts` | Bảng bước, đường trạng thái hợp lệ, chọn bước | `STAGES`, `resolveStage`, `isTerminal`, `workChildren` |
| `apps/daemon/src/roles/prompt-templates.ts` | Nạp và render template Markdown | `renderPrompt`, `loadPrompt`, `setPromptsDir` |
| `apps/daemon/src/roles/model-policy.ts` | Model/effort theo bước, kẹp theo allowlist | `resolveModel`, `clampModel`, `MissingComplexityError` |
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

- agent-runs: `JobRunner` gọi bốn hook của `rolePlanner`; `stage`, `notices`, `skip`, `requiredMcps` của
  `PlannedRun` và `AfterRunDecision` (comment/block/status) được định nghĩa ở đó; `guard-hook.ts` (`isDocsPath()`)
  chặn dev ghi docs (`docs/**` và Markdown gốc) hay `git commit` khi `stage === 'dev'` (`codeOnly`); công cụ
  ticket `select_capabilities`, `return_to_dev`, `reject_work`, `merge_and_push` gọi vào các hàm của flow này.
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
- server-settings: `ctx.settings.policy`/`ctx.settings.prompts` (cài đặt server job này chạy với) điều khiển
  cổng UI-test của QC, `docsFirst()`, `isDocsPath()`/`isProtectedPath()` và nội dung prompt render ra; owner
  invariant (docs luôn sonnet, không Fable, `AGENTS.md`/`CLAUDE.md` luôn được bảo vệ) vẫn nằm trong code ở
  đây và ở `model-policy.ts`, không setting nào đổi được.

## Tests

- `apps/daemon/test/role-contracts.test.ts`: mọi đường trong `STAGES[...].paths` và `FAILURE_PATHS` hợp lệ
  với `canTransition('agent', …)`; `resolveStage()` cho từng tổ hợp loại ticket/con/job; template render đúng
  partial và biến, báo lỗi khi thiếu biến. Prompt QC theo `testPlanText()`: không loại UI thì liệt kê từng
  loại từ `TEST_KIND_INFO` và không nhắc MCP, `ui_web`/`ui_mobile` nhắc đúng Playwright/Maestro, ticket
  `testKinds: null` và diff chỉ đổi docs giữ nguyên văn bản `uiTestText()` cũ (`DOCS_ONLY_QC_NOTE` vẫn còn).
  Prompt `pm-analyze`/`pm-monitor` có mục phân tích phương án, bảng loại ↔ công cụ đúng `TEST_KIND_INFO` (nhãn/
  công cụ mỗi dòng, cột MCP kéo theo), luật chọn loại UI, dòng platform từ `testKindsText()`, mẫu mục "Phương án
  kiểm thử" bốn dòng, và không còn câu "server tự thêm"/"MCP kiểm thử UI mặc định". Không file `.ts`/`.md` nào
  dưới `apps/daemon/src` chép tay nhãn hay công cụ của `TEST_KIND_INFO`; mọi prompt đóng gói (`STAGES`) qua được
  `validatePromptTemplate()`, `qc.md` còn `{{test_plan}}` và `pm-analyze.md` còn `{{test_kinds}}`.
- `apps/daemon/test/model-policy.test.ts`: docs luôn `sonnet`/`high` bất kể lựa chọn; dev/qc theo đúng bản đồ
  độ phức tạp của máy, model/effort PM tự đặt trên subtask thắng bản đồ; dev/qc không `complexity` ném
  `MissingComplexityError` dù có đặt `model`; pm theo đúng thứ tự ưu tiên; kẹp model ngoài allowlist xuống
  model mạnh nhất còn được phép; không bao giờ chọn `fable` — ticket cũ đặt `fable` luôn chạy `opus` kèm bình
  luận thông báo.
- `apps/daemon/test/skill-enforcement.test.ts`: skill/MCP dùng thật từ nhật ký công cụ và slash command; gộp
  lựa chọn nhiều lượt của cùng ticket; khoảng trống bắt buộc/đã chọn trừ đã dùng; nội dung cảnh báo.
- `apps/daemon/test/docs-first-check.test.ts`: docs trước code đạt/không đạt theo thứ tự Read/Grep thật, Read
  ngoài worktree hay dưới `docs/` (kể cả `README.md` ở gốc repo) không tính, một run không đọc gì mặc định đạt.
- `apps/daemon/test/docs-init-gate.test.ts`: dự án chưa có docs tạo đúng một `docs_init` con (idempotent), dự
  án đã có docs cho `pm_analyze` chạy ngay.
- `apps/daemon/test/docs-update-handoff.test.ts`: `handoff_docs` xếp đúng job `docs_update` tiếp theo;
  `return_to_dev`, thiếu `handoff_docs`, ticket chưa đóng đều thành lượt thất bại đúng lý do; `decideFailure()`
  thử lại rồi chặn ở `MAX_ATTEMPTS`.
- `apps/daemon/test/role-policies.test.ts`: bọc dữ liệu không tin cậy và vô hiệu hoá delimiter bên trong; QC
  phát hiện đúng MCP bắt buộc chưa kết nối/bị tắt; `diffNeedsUiTest()` đọc đúng `docsPaths` của cài đặt server
  truyền vào (một `policy` tuỳ biến coi thêm `handbook/**` là docs); `diffNeedsUiTest()` coi diff chỉ đổi `README.md`,
  `CHANGELOG.md` hay `docs/` là không cần kiểm thử UI, còn đổi bất kỳ file nào ngoài docs (file nguồn, `AGENTS.md`,
  một file `.md` lồng trong `src/`) hay khi không suy ra được (lỗi git, diff rỗng) vẫn cần; guard giữ lượt dev
  ngoài docs (`docs/`, `README.md`, Markdown gốc khác) và tránh `git commit`; `uiTestText()` cho nhánh Playwright
  nêu đúng từ "headless" và "không chiếm màn hình máy", không còn câu "mở ứng dụng trong trình duyệt" cũ. Nhóm
  "QC docs-only check looks at
  the ticket's own commits": một commit chỉ đổi `README.md` trên nền commit docs-init chưa merge vào nhánh
  chính vẫn tính là docs-only khi biết `builtOn`, còn tính là cần kiểm thử UI khi không biết head đó; merge
  sạch một head nền không thêm gì, merge xung đột được job docs kết luận cùng code thì tính; một bug fix được
  xét theo đúng commit riêng của nó chứ không phải commit dev nó xây trên, và một head sau (một fix đã xong,
  xây trên chính ticket đang xét) không dùng được làm mốc cho ticket đó. Nhóm "dev run auto-transitions a todo
  ticket": `plan()` gọi `transition(ticketId, 'in_progress', key)` đúng một lần và trả về ticket đã
  `in_progress` khi ticket `dev` hoặc `bug` đang `todo`; ticket `dev` đã `in_progress` (mô phỏng resume/retry)
  thì không gọi `transition`, `plan()` không lỗi. Nhóm "QC run follows the PM test plan of its ticket": phương
  án không loại UI chạy được dù Playwright chưa kết nối và ticket không mang MCP nào; phương án `ui_web` vẫn bị
  chặn khi Playwright chưa kết nối (bình luận nhắc `plan_qc_test`) và nêu đúng chỉ dẫn Playwright khi đã kết
  nối; ticket không có phương án (`testKinds: null`) giữ nguyên văn bản `uiTestText()` cũ; một prompt QC ghi đè
  trên web còn dùng `{{ui_test}}` vẫn render đúng cho cả phương án có và không có loại UI.
- `apps/daemon/test/lifecycle.test.ts` (kịch bản dưới `apps/daemon/test/lifecycle/*.yaml`, mỗi file có
  `description` riêng): toàn bộ vòng đời qua API và daemon thật, runner kịch bản (không tốn phí model), git
  worktree và hook crew-docs thật — happy path, docs bị hook từ chối rồi commit lại, capability preflight, dọn
  tài nguyên và đánh thức PM, nhiều bug liên tiếp, chạm trần chu kỳ bug, huỷ ticket giữa lúc dev đang chạy,
  crash giữa lúc PM chia việc, resume sau backoff, xung đột block docs sinh tự động khi merge, dự án chưa có
  docs, chạm trần con, budget hold, QC thiếu MCP bắt buộc, PM từ chối một ticket dev, PM chấm dev/QC riêng
  (`16-qc-own-rating.yaml`: dev `large` chạy `opus`, QC `trivial` chạy `haiku`, bug kế thừa mức của dev, retest
  kế thừa mức của QC), owner gọi PM bằng `@pm` (`18-owner-calls-pm.yaml`, kịch bản `owner-calls-pm`: một dev mất
  đánh giá độ phức tạp, lượt chạy tiếp theo không chọn được model nên `blocked`; owner tag `@pm` trên dev đó —
  chỉ PM được đánh thức, dev không đổi trạng thái; PM chạy ở `pm_monitor`, `rate_subtask` rồi trả lời trên chính
  dev đó; dev chạy lại theo mức mới qua `ticket.unblocked`, cả cây xong; trợ giúp kịch bản `clearRating` của
  `apps/daemon/test/helpers/lifecycle.ts` xoá đánh giá đã có trước bước này), subtask chỉ về docs
  (`19-docs-only-readme.yaml`: subtask dev "Viết mục cài đặt trong README" bị guard từ chối ghi `README.md` nên
  bàn giao ngay không đụng code, job `docs_update` commit một mình `README.md` và qua đúng hook crew-docs, QC
  được PM lập phương án `ui_web` nên ticket mang `playwright` (không phải server tự thêm) nhưng review tĩnh diff
  chỉ đổi docs, report ghi đúng câu `DOCS_ONLY_QC_NOTE` và
  `mcpsUsed`/`mcpsMissing` rỗng), docs-init kết thúc hai lần liền mà không nộp report
  (`20-docs-init-not-finished.yaml`: mỗi lượt chỉ đọc vài file rồi để lại một tin nhắn `say` chưa xong việc —
  cả bình luận thử lại lẫn bình luận chặn đều mang đủ khối chẩn đoán, tin nhắn cuối đã bị ẩn credential trích
  dẫn trong đó), ảnh dán trong ticket (`21-ticket-images.yaml`, kịch bản `ticket-images`, flow `agent-runs`:
  chủ dự án dán ảnh vào mô tả request rồi dán ảnh khác vào bình luận trả lời câu hỏi `ask_owner` của PM —
  assistant và lượt `pm_analyze` đầu đều nhận ảnh của mô tả request qua nguồn quét luôn bật; lượt `pm_analyze`
  resume sau khi chủ dự án trả lời chỉ nhận ảnh mới trong bình luận, không gửi lại ảnh phiên đó đã nhận; subtask
  dev giữ nguyên link ảnh trong mô tả (theo câu dặn của `pm-analyze.md`) nên cũng nhận ảnh và `Read` đúng file
  trong thư mục tạm của job đó; QC không có link ảnh trong mô tả nên chạy như một lượt không ảnh), QC theo phương
  án không giao diện trên dự án `web`
  (`21-qc-api-plan.yaml`: PM lập phương án `[api, integration]` cho một thay đổi chỉ có route và truy vấn DB —
  ticket QC không mang MCP kiểm thử UI dù Playwright chưa kết nối trên máy, QC không bị chặn, chạy đúng phương
  án và đóng `done` mà không gọi MCP UI nào, cả cây xong), gỡ QC kẹt vì chọn nhầm loại UI
  (`22-qc-plan-changed.yaml`: PM lập phương án `ui_web` cho một thay đổi chỉ có API, QC bị chặn ngay vì
  Playwright chưa kết nối; owner gắn thẻ `@pm` trên ticket QC, PM `plan_qc_test` đổi sang `[api]`,
  `retry_subtask` mở lại rồi `comment` báo đã đổi phương án; QC chạy lại với `requiredMcps` rỗng, đóng `done`
  không gọi MCP UI nào, cả cây xong) — mỗi kịch bản kết thúc ở trạng
  thái ổn định, không ticket nào bị kẹt (`stuckTickets()`).
- `apps/daemon/test/pm-mention.test.ts`: PM chạy với đúng ghi chú "Chủ dự án gọi PM" (ticket được tag, trạng
  thái/complexity, lỗi job gần nhất và bình luận agent gần nhất bọc `<untrusted-data>`, bình luận owner nguyên
  văn không bọc) và không đánh thức job nào trên ticket được tag; một pm_task đang chờ owner
  (`needs_input`/`blocked`/`in_review`) vẫn chạy ở `pm_monitor` khi job mang lời gọi `@pm`, không đổi trạng thái
  pm_task; một wake-up không mang tag của cùng pm_task đang chờ (`in_review`) vẫn bị bỏ qua (`skipped`) như
  trước; bình luận owner trên pm_task `blocked` mở chặn nó nên PM chạy ngay, job có trigger `ticket.unblocked` và
  gộp cả sự kiện `ticket.comment_added` (hai sự kiện).
- `apps/daemon/test/live-workflow.test.ts` (tuỳ chọn `CREW_LIVE_AGENT_TESTS=1`): toàn bộ luồng trên model
  thật (đăng nhập gói đăng ký), một repo fixture có docs, skill và MCP Playwright của dự án.
