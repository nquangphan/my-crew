# Chạy agent qua Agent SDK

> Flow `agent-runs`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow agent-runs` in ra
> đúng danh sách đó.

## Mục đích

Chạy một job từ đầu đến cuối: lên kế hoạch (prompt, model), chuẩn bị workspace, gọi Claude Code qua Agent SDK
với bộ công cụ ticket riêng theo vai trò và một guard chặn ghi ngoài phạm vi, rồi xử lý kết quả (xong, tạm
dừng chờ retry, chặn, lỗi, hủy) và dọn dẹp.

## Điểm vào

- `apps/daemon/src/runner/job-runner.ts` → `JobRunner.launch()` — được `Scheduler` gọi khi một job được phép
  chạy (flow `daemon-scheduling`).

## Các bước

1. `apps/daemon/src/runner/job-runner.ts` → `JobRunner.launch()`: đánh dấu job `running` ngay (đồng bộ, để
   scheduler đếm đúng slot, xoá `waitReason`/`waitDetail` cũ) rồi chạy `execute()` trong nền; nếu `execute()`
   ném lỗi bất ngờ (planner, dựng prompt, chuẩn bị worktree — trước đây một lỗi worktree kết thúc job âm thầm,
   API) mà daemon chưa `halted()`, job được chuyển `failed` với `crashText()` (tên lớp lỗi, mã errno như
   `ENOENT`, thông điệp, đã `scrubSecrets()`, tối đa 500 ký tự), `foldWakeups()` chạy, rồi `reportCrash()` đăng
   bình luận lỗi này lên ticket (kèm `(cài đặt bản <job.settingsRevision>)` khi job đã snapshot cài đặt server,
   flow `server-settings`, trước khi crash) và chuyển ticket `blocked` khi `canTransition('agent', status,
   'blocked')` cho phép (không thì chỉ bình luận, chờ owner tự bình luận để chạy lại) trước khi `cleanup()` —
   nên không job
   nào kẹt ở trạng thái `running` mãi mãi, và owner luôn thấy lỗi này trên ticket như một lượt chạy thất bại.
   Owner mở chặn (`ticket.unblocked` — phát khi owner tự đổi trạng thái, hoặc khi owner bình luận trên ticket
   `blocked` không tag `@pm`, flow `ticket-lifecycle`) sau đó tự đưa ticket vào hàng đợi job mới.
2. `apps/daemon/src/runner/job-runner.ts` → `JobRunner.execute()` → `planner.plan()`: `RolePlanner` là điểm
   mở rộng vai trò (prompt, policy, dữ liệu report, follow-up); `rolePlanner` (flow `agent-roles`) là bản
   `createDaemon()` dùng mặc định, `defaultPlanner` (trong file này) là bản chung tối giản còn lại cho test.
   `plan()` nhận thêm `PlannerContext` (VPS client, state, `crewDocs`, `JobWriter` idempotent riêng của job,
   đường dẫn `STANDARD.md`, `settings: ActiveSettings` — cài đặt server job này chạy với, snapshot một lần lúc
   `execute()` bắt đầu, flow `server-settings`) và trả `PlannedRun.stage` (ghi vào job) cộng `notices` (bình
   luận đăng trước khi chạy) hoặc `skip` (không chạy: job kết thúc `skipped`/`blocked` ngay với lý do, ví dụ
   một cổng chờ hay chặn);
   `PlannedRun.requiredMcps` hẹp hơn `ticket.requiredMcps` khi có (lượt QC review diff chỉ đổi docs đặt rỗng,
   flow `agent-roles`) — `execute()` dùng nó thay ticket gốc cho tool ticket, report và done-gate (bước 8).
   `chooseModel()` (dùng bởi `defaultPlanner`) chọn model/effort: `docs_init`/`docs_update` luôn `sonnet`/
   `high`; job khác ưu tiên lựa chọn của ticket, rồi bản đồ độ phức tạp của config. `dev`/`qc` không còn mặc
   định theo vai trò — ticket chưa được PM chấm `complexity` làm `chooseModel()` ném `MissingComplexityError`
   (`model-policy.ts`, flow `agent-roles`); `assistant`/`pm` vẫn rơi về mặc định vai trò khi ticket chưa có
   độ phức tạp; một lựa chọn `fable` cũ (không còn được dùng, quyết định của chủ dự án) cũng được ánh xạ sang
   `opus` ở đây như `resolveModel()`. `rolePlanner` dùng chính sách chi tiết hơn của nó (`resolveModel()`,
   flow `agent-roles`).
3. `apps/daemon/src/runner/job-runner.ts` → `execute()` → `workspace()`: dựng worktree (flow
   `agent-workspace`); QC bắt đầu tại `head_sha` của report dev đã ghép cặp (`qcBase()`); tạo thư mục tạm
   riêng của job và thư mục con socket (`ensureJobTmpDir()`, đường dẫn ngắn dưới `/tmp/crew-<uid>/…` để vừa
   giới hạn socket Unix của macOS, flow `resource-hygiene`); env qua `agentEnv()` (bỏ `ANTHROPIC_API_KEY`, thêm
   `CREW_JOB_ID`, `TMPDIR`/`TMP`/`TEMP`, `PWTEST_SOCKETS_DIR` (nơi Playwright, MCP server agent tự khởi động,
   đặt socket của nó), `~/.crew/bin` lên đầu `PATH`). Ngay sau đó `planner.prepare?.()` chạy (worktree đã có
   nhưng agent chưa bắt đầu) — hook tuỳ chọn để role planner chuẩn bị thêm (ví dụ merge head nền, cài hook
   docs-init, flow `agent-roles`); nó cũng có thể trả `skip` (job kết thúc ngay) hoặc một `note` được nối vào
   cuối prompt. `plan.notices` (nếu có) được đăng thành bình luận trước khi chạy.
4. `apps/daemon/src/runner/agent-runner.ts` → `createSdkRunner()`: gọi `query()` của Agent SDK với
   `settingSources: ['user', 'project', 'local']`, `permissionMode: 'dontAsk'` cộng `allowedTools` theo vai
   trò, `disallowedTools` là `mcp__<server>__*` của mọi MCP server bị chủ dự án tắt cho project
   (`disallowedToolsFor()`, bước 9) — gỡ hẳn tool của server đó khỏi context model, khác với chỉ bỏ ra khỏi
   `allowedTools` (server cấp user hay server plugin/connector vẫn khởi động và tool của nó vẫn lọt vào context
   nếu thiếu deny glob này) — cộng `settings.deniedMcpServers` (map `serverName` theo đúng tên trong inventory;
   theo tài liệu Claude Code, danh sách chặn này gộp từ mọi settings scope và một server bị chặn thì không
   được nạp — nhưng khớp đúng nhãn, nên một server plugin đăng ký dưới nhãn khác vẫn khởi động, chỉ tool của nó
   bị `disallowedTools` ẩn đi), MCP server ticket in-process (`mcpServers.tickets`), hook `PreToolUse` inline là
   guard, env có `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2`,
   `settings.enabledMcpjsonServers`/`disabledMcpjsonServers`, `spawnClaudeCodeProcess` tự spawn tiến trình con
   trong process group riêng (`detached: true`), để cleanup (flow `resource-hygiene`) có thể gửi tín hiệu tới
   cả process group/cây tiến trình mà agent khởi động. `prompt` truyền cho `query()` là một luồng do daemon
   điều khiển (`createPromptStream()`, `PromptStream`), không còn là một chuỗi: prompt của lượt chạy là tin
   nhắn đầu, `send()` xếp thêm tin nhắn (lời nhắc bước dưới) vào luồng đang mở, `close()` mới đóng input — với
   `prompt` dạng chuỗi runtime Claude Code đóng stdin ngay, nên một lệnh nền còn sống quá 5 giây sau `result`
   đầu tiên bị kill. `apps/daemon/src/runner/background-session.ts` → `BackgroundSession` (không phụ thuộc
   SDK, dùng chung với `createScriptedRunner()`, bước 6, qua cùng `SessionPort`: `send`/`stopTask`/`close`) giữ
   tập tác vụ nền đang sống, rỗng khi tiến trình khởi động và được thay toàn bộ mỗi message
   `system/background_tasks_changed` (`tasksChanged()`); ở mỗi `result` (`turnEnded()`): hết tác vụ nền thì
   đóng input và lượt chạy kết thúc như cũ; còn tác vụ thì giữ phiên mở chờ runtime giao thông báo tác vụ xong
   để agent chạy lượt tiếp, trong một trần chờ (`run.backgroundWaitMs`, `JobRunner` cấp từ
   `DaemonConfig.backgroundWaitMinutes`, flow `daemon-runtime`, bước 2); `result` lỗi, tool đã gọi
   `RunControl.requestEnd()` (bước 5), hay `run.workDone?.()` trả `true` (tuỳ chọn `JobRunner` cấp, đọc trạng
   thái ticket, `true` khi ticket đã rời `in_progress` — `done`/`in_review`/`cancelled`/`needs_input`/`blocked`)
   đều không chờ. Hết trần mà còn tác vụ, daemon gửi đúng một tin nhắn tiếng Việt (`reminderText()`) vào chính
   phiên đang mở rồi chờ thêm một trần — lời nhắc này cũng được tính là một lượt nợ; lượt trả lời lời nhắc mà
   còn tác vụ thì không chờ nữa. `BackgroundSession` đếm số lượt runtime có thể còn nợ (`owed`): mỗi tác vụ rời
   tập tác vụ — dù đang chạy lượt hay đang chờ, kể cả tác vụ bị dừng chứ không qua thông báo — và lời nhắc vừa
   nói đều cộng thêm 1; đây là cận trên (một lượt có thể mang nhiều thông báo, còn tác vụ bị dừng thì không có
   lượt thông báo). Một lượt chỉ có thể trả nợ khi nó *bắt đầu* lúc đã có nợ (`payable`, ghi ở cạnh chưa chạy →
   đang chạy của `turnStarted()`); khi lượt đó kết thúc bằng một `result` thật, nó trả tối đa một lượt nợ —
   `result` rỗng (`num_turns: 0`, runtime phát khi hai tác vụ nền xong cùng lúc rồi mới tới lượt mang thông báo
   thật) không trả lượt nợ nào và không được tính là lượt trả lời lời nhắc. Hết tác vụ nền mà còn nợ (`owed >
   0`) thì phiên không đóng ngay: nó chờ thêm một khoảng lắng (`settleMs`, tuỳ chọn
   `SdkRunnerOptions.backgroundSettleMs` truyền xuống, mặc định `DEFAULT_SETTLE_MS` 10 giây) để runtime phát
   lượt trả nợ; đóng `idle` ngay chỉ khi hết cả tác vụ lẫn nợ, còn nếu khoảng lắng trôi qua mà không có lượt
   nào thì nợ còn lại bị xoá (`owed = 0`) — hết tác vụ thì đóng `idle` như cũ, còn nếu tác vụ mới xuất hiện
   trong lúc lắng thì chuyển sang chờ đủ một trần như bình thường. Vì `owed` là cận trên, khi runtime gộp thông
   báo của nhiều tác vụ vào một lượt, phiên có thể đóng muộn thêm một khoảng lắng sau lượt cuối thay vì đóng
   ngay — đây là đánh đổi được chấp nhận, model thật đã xác nhận đúng điều này. Mọi đường đóng phiên — hết tác
   vụ, `result` lỗi, tool yêu cầu kết thúc, hết trần nhắc thêm một lần,
   abort, hay khối `finally` khi tiến trình đi mất — đều gọi `Query.stopTask()` cho từng tác vụ còn sống trước
   khi đóng input (lỗi của `stopTask` hay không trả lời trong 5 giây không chặn việc đóng). Vì phiên chạy nhiều
   lượt trên cùng một tiến trình, `system/init` tới ở đầu **mỗi** lượt (runner chỉ nhận lượt đầu cho
   `sessionId`/skill/MCP server/`apiKeySource`) và `result.total_cost_usd`/`modelUsage` là cộng dồn của cả
   tiến trình nên runner lấy từ `result` cuối cùng, còn `num_turns`/`duration_ms` tính theo từng lượt nên được
   cộng dồn qua mọi `result` của lượt chạy (không tính thời gian chờ giữa các lượt) vào `RunCapture`/
   `AgentRunResult`. Tiến trình chết khi phiên còn mở (giữa lượt, hoặc đang chờ tác vụ nền) khiến lượt chạy
   thành lỗi (`resultSubtype: null`) thay vì mang `success` của lượt trước đó. `AgentRunResult.backgroundTasksLeft`
   báo đúng tác vụ nền còn sống lúc đóng phiên (rỗng sau một kết thúc sạch) và `reminded` báo daemon đã nhắc
   hay chưa; tác vụ `ambient` (`ambient: true` của payload — tác vụ không thuộc phần việc của phiên, ví dụ
   watcher riêng của runtime) không bao giờ được chờ và không vào `backgroundTasksLeft`, nhưng vẫn bị
   `stopTask` khi đóng. Runner thu thêm message `system/api_retry`, `system/compact_boundary` (đếm số lần
   context bị nén) như trước. Mỗi message `assistant` của agent chính (bỏ qua subagent) được
   `captureAssistant()`/`recordTool()` (`run-trace.ts`) gom vào `RunCapture`: tin nhắn văn bản cuối cùng và tối
   đa 5 lời gọi tool cuối (chỉ tên tool và mục tiêu — `file_path`/`notebook_path`/`path` tương đối trong
   worktree, hoặc tên skill của `Skill`; không bao giờ ghi dòng lệnh Bash) — dữ liệu này dùng để chẩn đoán một
   lượt chạy kết thúc xấu (bước 10). `createScriptedRunner()` (bước 6) ghi capture tương tự qua cùng
   `recordTool()`, cộng bước kịch bản `say: <text>` (một tin nhắn văn bản của agent, qua cùng bộ giải template)
   làm tin nhắn cuối.
5. `apps/daemon/src/runner/agent-runner.ts` → `RunControl.requestEnd()`: khi tool `ask_owner` hoặc
   `handoff_docs` gọi `requestEnd()`, runner `interrupt()` turn hiện tại ngay sau message `assistant` tiếp
   theo — kết thúc này được coi là bình thường (`isError` không bật) dù turn bị ngắt; `BackgroundSession` coi
   đây là lý do đóng `end_requested` (bước 4): mọi tác vụ nền còn sống bị `stopTask` trước khi phiên đóng,
   không chờ. `interrupt()` ở chế độ luồng vẫn khiến `q` trả về một `result` lỗi (`error_during_execution`)
   nhưng không tự dừng tác vụ nền nào, nên đường kết thúc này vẫn cần `BackgroundSession` dừng tác vụ trước khi
   đóng như mọi đường khác.
6. `apps/daemon/src/runner/scripted-runner.ts` → `createScriptedRunner()`: test double cùng interface
   `AgentRunner`, đọc kịch bản YAML (bước `tool`/`bash`/`write`/`skill`/`sleep`/`say`/`apiError`/`fail`/`crash`,
   cộng `Edit` phát lại đúng `old_string`/`new_string`/`replace_all` như Claude Code thật) và thật sự phát lại
   qua guard hook, tool log, ticket tools; `script` có thể là hàm `async` (đọc trạng thái ticket trước khi chọn
   kịch bản) và một `resolve()` tuỳ chọn điền input của từng bước ngay trước khi chạy (ví dụ id một ticket bước
   trước vừa tạo); phiên giả (`SessionState`) giữ chi phí lũy kế của session và tiến độ theo từng job
   (`completed[jobId]`) — resume đúng job đó (ví dụ sau khi daemon khởi động lại) tiếp tục từ bước cuối job đó
   đã hoàn thành, còn một job mới dùng chung session (job id khác) chạy lại kịch bản từ đầu và cộng dồn vào chi
   phí session đã có; chỉ dùng cho test vòng đời, production dùng `createSdkRunner()`.
7. `apps/daemon/src/runner/guard-hook.ts` → `evaluateToolCall()`: `Edit`/`Write`/`MultiEdit`/`NotebookEdit` bị
   từ chối khi ra ngoài `cwd` hoặc đi qua symlink ra ngoài `cwd` (trừ shared path đã link); ghi `AGENTS.md` hay
   `CLAUDE.md` ở gốc repo (`ROOT_AGENT_FILES`, so khớp không phân biệt hoa thường vì worktree macOS không phân
   biệt) bị chặn ở mọi loại job — dev, QC, PM, assistant, `docs_update` — trừ `docs_init`, với lý do nêu rõ đây
   là hướng dẫn agent được bảo vệ (owner invariant, luôn đúng dù cài đặt server ghi gì): chỉ job `docs_init`
   được ghi; cần đổi thì ghi đề xuất vào bình luận để chủ dự án duyệt; khi chạm đường dẫn được bảo vệ khác
   (`policy.protectedPaths` của cài đặt server job này chạy với — flow `server-settings`, mặc định
   `DEFAULT_GUARD_POLICY`: `.claude/**`, `.githooks/**`, `CLAUDE.md`, `AGENTS.md`, `.husky/**`, cấu hình
   lefthook, file CI crew-docs — `isProtectedPath(rel, policy)` được export cho `merge-policy.ts`, nhưng cổng
   pre-push ở đó luôn dùng danh sách mặc định, không đọc cài đặt job, flow `local-merge`) — trừ job `docs_init`
   — hoặc khi sửa mục `source`/`shared`/`unassigned` của `docs/flows.yaml`; job `docs_update` chỉ được ghi
   theo `policy.docsUpdateWritePaths` (mặc định mọi thứ dưới `docs/` và file Markdown ở gốc repo trừ
   `AGENTS.md`, `CLAUDE.md`); một lượt `dev` (`codeOnly`, theo `stage`, flow `agent-roles`) không được ghi
   đường dẫn thuộc `policy.docsPaths` (`isDocsPath(rel, policy)`, mặc định gồm `README.md`) **và** không được
   `git commit` (chỉ job `docs_update` sau đó mới commit code, test và docs cùng nhau). `Bash` bị chặn khi `git push --force`, `git commit` của lượt `codeOnly`, `rm -rf` ra
   ngoài `cwd`/thư mục tạm job, hay
   đổi `core.hooksPath`. Một lời gọi được phép không trả quyết định gì, nên `dontAsk` + `allowedTools` vẫn áp
   dụng sau đó; mọi lời gọi được ghi vào `tool_log`.
8. `apps/daemon/src/tools/ticket-mcp-server.ts` → `buildTicketTools()`: dựng bộ công cụ ticket theo vai trò
   (`tool-scopes.ts` → `ticketToolsFor()`); mọi ghi đi qua `JobWriter.write()` — Idempotency-Key
   `<jobId>:<seq>` chỉ commit `toolSeq` sau khi server trả lời, nên một câu trả lời bị mất (mạng, crash) được
   gửi lại với cùng key và server phát lại thay vì tạo bản ghi thứ hai; mọi bình luận/report bị
   `scrubSecrets()` (định nghĩa ở `packages/shared/src/secret-scrubber.ts`, export qua `@crew/shared`;
   `apps/daemon/src/runner/secret-scrubber.ts` chỉ re-export để nhật ký `app.log` của app desktop dùng chung
   một bộ luật) ẩn credential trước khi rời máy; `get_ticket`/`list_children` bọc mọi văn bản chủ dự án
   không tự viết bằng `wrapTicketDetail()`/`wrapUntrusted()` (flow `agent-roles`); `comment` nhận thêm `ticket`
   (id/key) tuỳ chọn — mặc định là ticket của lượt chạy; chỉ một lượt PM trên chính `pm_task` mới được nhắm tới
   ticket khác, và chỉ tới subtask của đúng `pm_task` đó (`ownTreeTicket()`, không thì lỗi tool), dùng để trả
   lời owner ngay trên ticket họ vừa gắn thẻ `@pm` (flow `ticket-lifecycle`); `submit_report` gọi
   `ctx.reportOverlay()` (do role planner cấp: `docsFirst`, skill/MCP thiếu, tài nguyên để lại, `headSha`/
   `commits` cho job commit) và đăng cảnh báo nếu có, còn lượt `dev` (`codeOnly`) không được `submit_report`
   hay `update_status` sang `done`/`in_review`. Bốn tool mới của flow `agent-roles`/`local-merge`:
   `select_capabilities` (ghi lựa chọn skill/MCP có lý do), `return_to_dev` (job docs trả việc về dev kèm
   output hook), `reject_work` (PM từ chối một ticket dev/bug đã xong, gọi `fileBug()`), `merge_and_push` (PM
   gọi `mergeAndPush()`, flow `local-merge`); `create_subtask` từ chối MCP server bị dự án tắt và tự thêm
   `docs_init` (nếu có) vào `dependsOn`; subtask `dev`/`qc` bắt buộc `complexity` và `complexityReason` (không
   có model mặc định cho hai loại này, flow `ticket-lifecycle`/`agent-roles`); `model` chỉ nên đặt khi PM cố ý
   ghi đè bảng độ phức tạp, chỉ nhận `haiku`/`sonnet`/`opus` (không có Fable). `rate_subtask` (PM-only) đánh
   giá lại `complexity`/`complexityReason`/`model`/`effort` của một subtask `dev`/`qc`/`bug` đã có của chính
   PM task này, ngay tại chỗ thay vì tạo subtask thay thế — kể cả để đánh thức một ticket đang `blocked` vì
   chưa từng có đánh giá (`rateSubtask()`, flow `ticket-lifecycle`). `retry_subtask` (PM-only) chuyển một subtask
   `blocked` của chính pm_task này về `in_progress` (`retrySubtask()`, flow `ticket-lifecycle`) khi nguyên nhân
   chặn khác `complexity` đã hết; bị từ chối (lỗi tool, không ném) trừ khi lượt chạy hiện tại đang trả lời một
   lời gọi `@pm` đã ghi nhận (`answersOwnerCall()`: `ctx.state.pmMentions(job.eventIds)` không rỗng, flow
   `daemon-scheduling`) — PM không tự ý mở lại một ticket `blocked` ngoài luồng đó. `CHILD_CAP_EXCEEDED`/`BUDGET_HOLD` từ
   `create_subtask` và `BUG_CYCLE_CAP` từ `file_bug` kết thúc lượt chạy cho chủ dự án thay vì ném lỗi; PM không đóng ticket
   (`update_status` sang `done`/`in_review`) khi cây ticket còn tiến trình sống (`treeOrphans()`); QC không
   đóng ticket (`update_status` sang `done`) khi MCP server bắt buộc của lượt chạy (`TicketToolContext.requiredMcps`,
   điền từ `PlannedRun.requiredMcps` nếu role planner thu hẹp nó, không thì từ `ticket.requiredMcps`, ở
   `job-runner.ts`) chưa có lời gọi công cụ nào trong bất kỳ lượt nào của ticket (`unusedUiServers()`, đọc
   `tool_log`) — QC không thể âm thầm bỏ qua kiểm thử UI dù server có kết nối; diff chỉ đổi docs khiến danh
   sách đó rỗng nên không chặn gì (flow `agent-roles`);
   `create_pm_ticket` nhận thêm `complexity`; `errorText()` nối thêm `details` của lỗi server (ví dụ trường nào
   sai) vào thông báo cho agent tự sửa input. `createDocsInitTicket()` là hàm nội bộ của daemon (không phải
   tool agent): tạo ticket con `docs_init` của một `pm_task`.
9. `apps/daemon/src/tools/tool-scopes.ts` → `allowedToolsFor()`: cộng tool xây sẵn theo vai trò
   (`builtinToolsFor`), tool ticket theo vai trò, và `mcp__<server>__*` của mọi MCP server đang bật trong kho
   inventory (server bị chủ dự án tắt cho project thì bị loại, nên `dontAsk` từ chối tool của nó).
   `disallowedToolsFor()`: cùng `mcp__<server>__*` cho mọi server bị tắt, dùng làm `disallowedTools` của lượt
   chạy (bước 4) — trước đây một server bị tắt chỉ bị loại khỏi `allowedTools`, nên server cấp user hay
   plugin/connector vẫn khởi động và tool của nó vẫn tốn context model; deny glob này gỡ hẳn tool khỏi context.
   Việc dò inventory (`probeInventory`, flow `agent-workspace`) vẫn cố ý khởi động mọi server kể cả server bị
   tắt, để check MCP (flow `daemon-health`) thấy đúng trạng thái của nó và cho "Bật lại" — `disallowedTools`/
   `deniedMcpServers` chỉ áp dụng cho lượt chạy job thật, không áp dụng cho lượt dò.
   `ticketToolsFor()`: mọi vai trò có `select_capabilities`; PM có thêm `reject_work`/`merge_and_push`; dev có
   `handoff_docs` (chỉ `kind='agent'`, lượt `dev`) và `return_to_dev` (chỉ `kind='docs_update'`, lượt
   `docs_update` — hai tool loại trừ nhau theo `KIND_ONLY`).
10. `apps/daemon/src/runner/job-runner.ts` → `execute()` (sau khi run xong): `buildRunTrace()` (`run-trace.ts`)
    dựng `RunTrace` từ `result.capture` (scrub credential trước, rồi cắt tin nhắn cuối còn 1500 ký tự) và được
    lưu vào cột `run_trace` của job (flow `daemon-runtime`) bất kể lượt chạy thành hay bại, để mọi lượt sau vẫn
    thấy chẩn đoán lượt trước. `afterRun()` của role planner trả `comments` (đăng trước khi kết thúc), `block`
    (chuyển ticket `blocked`) và `status` tuỳ chỉnh (mặc định
    `done`); job hủy hoặc `aborted` → `finish(status: 'cancelled')`; lỗi API thuộc lớp backoff
    (`retry-classifier.ts` → `classifyRetry()`: `rate_limit`/`overloaded`/`billing_error`/`account_on_hold`,
    `retry_at = now + min(5 phút·2^attempt, 60 phút)`, kèm bình luận) → `backoff`, tới lần thứ 4 thì `blocked`
    (chuyển ticket sang `blocked`); lỗi khác → `failed` (bình luận "Lượt chạy lỗi (...)" kèm lỗi đã scrub, cộng
    khối chẩn đoán `traceMarkdown()` — số lượt/thời gian/chi phí, kết quả SDK, giai đoạn, context có bị nén,
    tin nhắn cuối trích dẫn, và các bước cuối — chỉ khi `afterRun()` của role planner chưa tự đăng bình luận
    thất bại nào, tránh lặp hai khối chẩn đoán; kèm `, cài đặt bản <job.settingsRevision>` khi có, flow
    `server-settings`; thường chuyển ticket `blocked` trừ khi có `followUp`); còn lại → `done`. `bookCost()` ghi chi phí đúng một lần: `total_cost_usd` cuối của session trừ đi phần các run trước
    của cùng session đã ghi. `liveProcesses()` đếm tiến trình còn sống của job (theo
    process group và thẻ `CREW_JOB_ID`) cho `reportOverlay()` tính `leftResources`.
11. `apps/daemon/src/runner/job-runner.ts` → `finish()`: trạng thái cuối, job tiếp theo (follow-up) và
    `foldWakeups()` chạy trong **một transaction**; sau đó `cleanup()`; worktree bị gỡ khi ticket đã
    `done`/`cancelled` (`releaseWorkspace()`); `cleanup()` trả về bản ghi dọn dẹp (`CleanupRecord`, flow
    `resource-hygiene`) và daemon gọi `JobRunnerDeps.onCleaned?.()` với nó — `createDaemon()` dùng móc này để
    đánh thức PM khi một subtask để lại tiến trình/cổng/container (flow `daemon-runtime`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/daemon/src/runner/job-runner.ts` | Chạy một job từ đầu đến cuối | `JobRunner`, `defaultPlanner`, `chooseModel`, `crashText`, `RolePlanner`, `PlannerContext`, `PlannedRun`, `AfterRunDecision` |
| `apps/daemon/src/runner/agent-runner.ts` | Runner SDK thật | `createSdkRunner`, `createPromptStream`, `PromptStream`, `RunControl`, `agentEnv`, `AgentRunResult`, `SdkRunnerOptions` |
| `apps/daemon/src/runner/background-session.ts` | Máy trạng thái phiên: chờ tác vụ nền, đếm lượt còn nợ, nhắc một lần, dừng rồi đóng — dùng chung bởi runner thật và runner kịch bản | `BackgroundSession`, `SessionPort`, `BackgroundTask`, `CloseReason`, `EndedTurn`, `reminderText` |
| `apps/daemon/src/runner/scripted-runner.ts` | Runner kịch bản YAML cho test | `createScriptedRunner`, `Script`, `ScriptedCrash` |
| `apps/daemon/src/runner/run-trace.ts` | Thu và dựng chẩn đoán một lượt chạy | `RunCapture`, `recordTool`, `buildRunTrace`, `RunTrace`, `traceMarkdown`, `traceSummary` |
| `apps/daemon/src/runner/guard-hook.ts` | Chặn ghi/Bash ngoài phạm vi | `evaluateToolCall`, `createGuardHook`, `isDocsPath`, `isProtectedPath` |
| `apps/daemon/src/runner/skill-usage.ts` | Skill/MCP dùng trong run, từ tool log | `skillsInvoked`, `mcpServersUsed`, `mcpToolPrefix`, `slashCommandsIn` |
| `apps/daemon/src/runner/retry-classifier.ts` | Phân loại lỗi API thành backoff/blocked | `classifyRetry`, `isBackoffError`, `BACKOFF_ERRORS` |
| `packages/shared/src/secret-scrubber.ts` | Luật ẩn credential dùng chung (daemon + app desktop) | `scrubSecrets`, `ScrubResult` |
| `apps/daemon/src/runner/secret-scrubber.ts` | Re-export `scrubSecrets` từ `@crew/shared` cho code cũ trong daemon | `scrubSecrets` |
| `apps/daemon/src/tools/ticket-mcp-server.ts` | MCP server ticket theo vai trò | `buildTicketTools`, `createTicketMcpServer`, `JobWriter`, `createDocsInitTicket`, `unusedUiServers` |
| `apps/daemon/src/tools/tool-scopes.ts` | Phạm vi tool theo vai trò | `ticketToolsFor`, `allowedToolsFor`, `disallowedToolsFor`, `builtinToolsFor`, `TICKET_TOOL_NAMES` |

## Dữ liệu

- Bảng: ghi `jobs` (trạng thái, chi phí, `modelUsage`, `skillsInvoked`, `handoff`, `run_trace`…), `tool_log`
  (mọi lời gọi tool), `pending_wakeups` (qua `foldWakeups`) của `apps/daemon/src/state-db.ts` (flow
  `daemon-runtime`).
- Sự kiện: không tự phát sự kiện daemon nội bộ; kết quả job (bình luận, report, chuyển trạng thái, subtask
  mới) đi qua các route ghi của flow `daemon-api` nên làm phát sinh sự kiện phía server (flow
  `event-delivery`).
- Gọi ngoài: Agent SDK (`@anthropic-ai/claude-agent-sdk` → tiến trình Claude Code, đăng nhập gói đăng ký của
  chủ dự án, không dùng `ANTHROPIC_API_KEY`); VPS API qua `VpsClient` (comment, transition, submit report,
  file bug, agent-meta, create subtask).

## Flow liên quan

- daemon-scheduling: `Scheduler.launch()` gọi `JobRunner.launch()`.
- daemon-runtime: `JobRunner` được tạo trong `createDaemon()`; chi phí và trạng thái job đọc/ghi
  `state-db.ts`; `JobRunner.execute()` truyền `config.backgroundWaitMinutes` (khóa cục bộ, mặc định 30 phút,
  flow đó) xuống runner làm `backgroundWaitMs` của bước 4.
- agent-workspace: `workspace()`/`releaseWorkspace()` dùng `ensureWorktree`/`removeWorktree`;
  `probeInventory()` cấp danh sách skill/MCP cho `allowedToolsFor()`.
- resource-hygiene: mỗi lần job kết thúc, `JobRunner.cleanup()` gọi `cleanupJob()`; PM dùng
  `resource_report`/`cleanup_resources` (từ `ResourceOps`, được lắp trong `JobRunnerDeps.resourceOps`).
- daemon-api / ticket-lifecycle: mọi ghi ticket của tool ticket gọi các route agent phía server.
- agent-roles: `rolePlanner` (bản `RolePlanner` mặc định) và mọi tool/guard mới ở đây (stage, capability
  preflight, docs-first, thất bại/thử lại) được định nghĩa ở flow đó; trang này chỉ mô tả nền tảng chạy job
  chung mà nó cắm vào.
- local-merge: tool `merge_and_push` gọi `mergeAndPush()` của flow đó.
- server-settings: `JobRunner.execute()` snapshot `ActiveSettings` (flow đó) một lần vào `PlannerContext.settings`
  và cột `jobs.settings_revision`; bình luận crash/lỗi nêu kèm bản cài đặt đó.

## Tests

- `apps/daemon/test/daemon.test.ts`: dừng đúng tiến trình job khi kết thúc mà không đụng tiến trình không
  gắn thẻ; sống sót qua crash giữa run (không mất sự kiện, một job hoạt động mỗi ticket, không tạo bản ghi
  trùng); job QC bắt đầu ngay sau `dependency.resolved` và resume session khi chủ dự án bình luận; run bị rate
  limit tạm dừng ở backoff với `retry_at` tăng dần rồi `blocked` sau 4 lần; job đang chạy bị hủy khi ticket bị
  hủy và worktree được gỡ; job được re-queue khi daemon dừng nhẹ nhàng và resume ở lần chạy sau (dừng xong
  không còn thư mục tạm nào, gốc thư mục tạm rỗng cũng bị xóa); một job crash
  trước khi agent chạy xong (lỗi khi chuẩn bị) đăng bình luận lỗi, chuyển ticket `blocked`, báo qua
  `failedJobs` trong heartbeat tới khi owner mở chặn cho job mới chạy xong; một ticket dev cũ chưa có
  `complexity` (tạo trước khi bắt buộc đánh giá) đi qua đúng đường crash này với `MissingComplexityError` thay
  vì tự chọn model mặc định, bình luận lỗi hướng PM dùng `rate_subtask`; PM đánh giá ticket đó xong (`rateSubtask()`)
  thì ticket tự chạy lại (không cần owner mở chặn) trên model theo mức mới.
- `apps/daemon/test/agent-runner.test.ts`: `query()` chạy với đúng `settingSources`, `dontAsk`, allowlist,
  `disallowedTools`, `settings.deniedMcpServers` (map sang `{serverName}`), guard hook và env sạch; truyền đúng
  `resume` và ngân sách, báo đúng lớp lỗi API cuối; ngắt turn sau khi một tool yêu cầu kết thúc run và coi đó là
  kết thúc bình thường; run không có message `result` bị đánh dấu lỗi; `RunCapture` gom đúng `num_turns`,
  `duration_ms`, số lần `compact_boundary`, tin nhắn cuối của agent chính (bỏ qua message của subagent) và tối
  đa 5 lời gọi tool cuối. Nhóm "background tasks" (`query` giả phát message theo kịch bản): `prompt` truyền cho
  `query()` là một `AsyncIterable`, tin nhắn đầu mang đúng prompt của lượt chạy; `result` hết tác vụ nền đóng
  input và kết thúc lượt chạy như cũ; còn tác vụ nền thì giữ input mở và lượt tiếp cộng dồn chi phí/`num_turns`/
  `duration_ms`/capture vào kết quả chung tới khi tập rỗng; một tác vụ rời tập giữa câu trả lời cuối của lượt
  vẫn được chờ thêm lượt thông báo; tiến trình chết trong lúc phiên còn mở (giữa lượt, hoặc đang chờ tác vụ
  nền) làm lượt chạy thành lỗi (`resultSubtype: null`) thay vì mang `success` của lượt trước; hết trần chờ thì
  daemon gửi đúng một tin nhắn nhắc, lượt trả lời còn tác vụ nền thì `stopTask` được gọi cho từng tác vụ rồi
  phiên đóng, lời nhắc không khởi động được lượt nào trong thêm một trần cũng đóng; `result` lỗi,
  `RunControl.requestEnd()` (`ask_owner`/`handoff_docs`), abort, hay tùy chọn `workDone()` trả `true` đều kết
  thúc ngay và dừng tác vụ còn sống trước khi đóng; `AgentRunResult.backgroundTasksLeft` báo đúng tác vụ còn
  sống lúc đóng (rỗng khi kết thúc sạch) và `reminded` báo daemon đã nhắc hay chưa; một lượt thông báo bắt đầu
  sau khi phiên đã đóng không chạy tiếp. Hai tác vụ xong cùng lúc như runtime 2.1.283 (`init`, rồi một `result`
  rỗng `num_turns: 0`, rồi `init` của lượt thông báo thật, dùng `SdkRunnerOptions.backgroundSettleMs` để rút
  ngắn khoảng lắng của test): `result` rỗng đó không đóng phiên, lượt thông báo vẫn chạy và chi phí/`numTurns`/
  `durationMs` được gộp đúng cả lượt đó; một lượt thông báo riêng cho tác vụ thứ hai (khi runtime không gộp
  chung một lượt) vẫn được chạy tiếp trước khi đóng; ngược lại, `result` rỗng mà không có lượt nào theo sau thì
  phiên vẫn đóng sạch sau khi khoảng lắng trôi qua.
- `apps/daemon/test/background-session.test.ts`: máy trạng thái của `BackgroundSession` độc lập SDK, qua một
  `SessionPort` giả (`send`/`stopTask`/`close`) — tập tác vụ rỗng lúc khởi động và được thay toàn bộ mỗi
  `tasksChanged()`; chờ khi còn tác vụ, đóng khi tập về rỗng sau một lượt; không chờ sau `result` lỗi,
  `endRequested()`, hay `workDone()` trả `true` (và dừng tác vụ trước khi đóng trong cả ba trường hợp); nhắc
  đúng một lần khi hết trần rồi đóng sau lượt trả lời; đóng luôn nếu lời nhắc không khởi động được lượt nào
  trong thêm một trần; một lượt bắt đầu kết thúc trần ngay, không cần nhắc; một tác vụ rời tập giữa lượt (không
  qua thông báo) được cho thêm một khoảng lắng (`settleMs`) thay vì chờ hết cả trần, kể cả khi việc đó lặp lại
  hoặc không có tác vụ mới xuất hiện trong khoảng lắng đó; `result` lỗi hay `endRequested()` cắt luôn khoảng
  lắng đó; tác vụ `ambient` không bao giờ được chờ nhưng vẫn bị dừng khi đóng; việc đóng vẫn xảy ra khi
  `stopTask` lỗi hay không trả lời; đóng chỉ chạy một lần (gọi lại `turnEnded()`/`shutdown()` sau đó không làm
  gì thêm); một `turnEnded()` đang đọc trạng thái run (`workDone()` chậm) không giữ `shutdown()` lại và không
  làm phiên mở lại sau khi đã đóng. Mô hình lượt còn nợ (`EndedTurn`, `owed`): một lượt rỗng (`empty: true`,
  hai tác vụ xong cùng lúc) không trả lượt nợ nào, và mỗi lượt thật chỉ trả tối đa một lượt nợ đã có lúc nó bắt
  đầu; một lượt nợ không có lượt nào tới trả thì phiên vẫn đóng sạch sau khoảng lắng; lời nhắc tự nó là một
  lượt nợ riêng, nên một tác vụ xong sau khi đã nhắc vẫn được cấp đúng lượt thông báo của nó; một lượt rỗng
  không được tính là lượt trả lời lời nhắc (`reminded` vẫn chờ một lượt thật).
- `apps/daemon/test/guard-hook.test.ts`: từ chối ghi ngoài `cwd` và vào `.githooks` dù có file settings được
  cài đặt cho phép; lời gọi được phép không trả quyết định (để `dontAsk`/`allowedTools` vẫn áp dụng); đường
  dẫn được bảo vệ theo từng loại job (job `docs_update` được ghi `docs/` và Markdown gốc như `README.md`,
  `CHANGELOG.md`, `CONTRIBUTING.md` nhưng không được ghi `AGENTS.md`/`CLAUDE.md`/Markdown lồng trong `src/`;
  job `docs_init` vẫn được ghi `CLAUDE.md`); `AGENTS.md`/`CLAUDE.md` ở gốc repo bị chặn ở mọi job trừ
  `docs_init`, không phân biệt hoa thường, với lý do nêu rõ R6 và job `docs_init`, kể cả qua `Edit` của một lượt
  `codeOnly` và qua một `AGENTS.md` đã link vào worktree (`sharedPaths`); `src/AGENTS.md` (không phải gốc repo)
  không bị bảo vệ; các mẫu Bash bị chặn (force push, `rm -rf` ngoài phạm vi, đổi
  `core.hooksPath`). Nhóm "path rules from the server policy": một `policy` tuỳ biến đổi đúng danh sách
  protected/docs/docs-update-write dùng ở trên (một đường dẫn không còn trong `protectedPaths` tuỳ biến hết
  bị chặn); `AGENTS.md`/`CLAUDE.md` vẫn luôn được bảo vệ và không bao giờ là docs dù `policy` truyền vào ghi
  gì khác (owner invariant, flow `server-settings`).
- `apps/daemon/test/ticket-tools.test.ts`: mỗi vai trò có đúng bộ tool ticket riêng (kể cả `return_to_dev` chỉ
  cho `docs_update`, `handoff_docs` chỉ cho lượt `dev`); mọi tool của MCP server đã bật được phép, server bị
  tắt thì không; bình luận ẩn credential, `ask_owner` kết thúc run; `handoff_docs` ghi bàn giao vào job và kết
  thúc run; PM tạo subtask idempotent (câu trả lời bị mất, gửi lại sau khi daemon khởi động lại chỉ tạo đúng
  một ticket) và bị từ chối khi yêu cầu MCP server đã bị dự án tắt; tool tài nguyên PM-only bị từ chối ngoài
  ngữ cảnh PM; lượt `dev` (`codeOnly`) không `submit_report`/đóng ticket được; QC không đóng ticket được khi
  một MCP server bắt buộc chưa có lời gọi công cụ nào trong nhật ký (`unusedUiServers`), đóng được sau khi gọi;
  QC của một diff chỉ đổi docs đóng được ngay không cần gọi MCP nào (`requiredMcps: []` của lượt chạy);
  lỗi server kèm `details` xuất hiện trong thông báo trả về agent; PM đánh giá lại một subtask tại chỗ qua
  `rate_subtask`, tool này không nhận `model: 'fable'`, một dev/QC không phải PM bị `FORBIDDEN` và không thấy
  tool này trong danh sách của vai trò mình. PM `comment` được vào một subtask của chính pm_task mình (dùng
  `ticket`) nhưng bị từ chối trên ticket của cây khác; một vai trò không phải PM không `comment` được vào ticket
  khác ticket của lượt chạy; `retry_subtask` bị từ chối ngoài lượt trả lời `@pm`, thành công khi
  lượt chạy đang trả lời một lời gọi đã ghi nhận.
- `apps/daemon/test/live-smoke.test.ts`: worktree của repo có `.claude` bị gitignore vẫn thấy đúng skill
  project như checkout chính; đăng nhập gói đăng ký hoạt động và không tính phí qua API key; một job haiku
  dùng đúng ticket tools, bị guard kiểm soát, và ghi đúng `total_cost_usd`. Với model thật (haiku): một lệnh
  nền (`sleep 12`) sống quá 5 giây sau `result` đầu tiên (runtime đóng stdin của prompt dạng chuỗi sẽ kill nó
  ở giây thứ 5), runtime giao thông báo tác vụ xong và agent chạy lượt tiếp, thật sự ghi file
  (`cat done.txt > seen.txt`); `AgentRunResult` gộp đúng `total_cost_usd` (của `result` cuối, cộng dồn của cả
  phiên) và `capture.numTurns`/`capture.durationMs` (tổng theo từng `result`), `backgroundTasksLeft` rỗng và
  `reminded` là `false` sau một kết thúc sạch; một lệnh nền ngắn hơn (`sleep 3`) có thể đã kết thúc trước khi
  `result` đầu tiên tới (tuỳ tốc độ model viết câu trả lời) vẫn được cấp đúng lượt thông báo ở một lượt sau và
  phiên vẫn kết thúc sạch. Hai lệnh nền cùng chờ một file `go` (`backgroundRun()` nhận thêm tuỳ chọn
  `goAfterFirstResultMs`, tạo file đó bằng đúng khoảng thời gian sau `result` đầu tiên để hai lệnh thoát cùng
  lúc) đều được ghi vào `seen.txt`, phiên kết thúc sạch và `totalCostUsd`/`capture.numTurns` đúng, dù runtime có
  phát `result` rỗng (`num_turns: 0`) hay không.
- `apps/daemon/test/run-trace.test.ts`: `buildRunTrace()` ẩn credential trong tin nhắn cuối và mục tiêu tool
  rồi mới cắt còn 1500 ký tự (không cắt lộ nửa chuỗi credential); giữ đúng 5 lời gọi tool cuối với đường dẫn
  tương đối; hiện rõ khi không có kết quả/tin nhắn/tool nào; `decideFailure()` (flow `agent-roles`) nối đúng
  khối chẩn đoán vào cả bình luận thử lại và bình luận chặn; `failedJobText()` cho đúng dòng heartbeat (lý do
  bằng lời cộng chẩn đoán, tối đa 500 ký tự); cột `run_trace` được lưu trên `jobs` và được `StateDb.migrate()`
  thêm vào một state DB cũ còn thiếu cột.
