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
   bình luận lỗi này lên ticket và chuyển ticket `blocked` khi `canTransition('agent', status, 'blocked')` cho
   phép (không thì chỉ bình luận, chờ owner tự bình luận để chạy lại) trước khi `cleanup()` — nên không job
   nào kẹt ở trạng thái `running` mãi mãi, và owner luôn thấy lỗi này trên ticket như một lượt chạy thất bại.
   Owner mở chặn (`ticket.unblocked`) sau đó tự đưa ticket vào hàng đợi job mới.
2. `apps/daemon/src/runner/job-runner.ts` → `JobRunner.execute()` → `planner.plan()`: `RolePlanner` là điểm
   mở rộng vai trò (prompt, policy, dữ liệu report, follow-up); `rolePlanner` (flow `agent-roles`) là bản
   `createDaemon()` dùng mặc định, `defaultPlanner` (trong file này) là bản chung tối giản còn lại cho test.
   `plan()` nhận thêm `PlannerContext` (VPS client, state, `crewDocs`, `JobWriter` idempotent riêng của job,
   đường dẫn `STANDARD.md`) và trả `PlannedRun.stage` (ghi vào job) cộng `notices` (bình luận đăng trước khi
   chạy) hoặc `skip` (không chạy: job kết thúc `skipped`/`blocked` ngay với lý do, ví dụ một cổng chờ hay chặn).
   `chooseModel()` (dùng bởi `defaultPlanner`) chọn model/effort: `docs_init`/`docs_update` luôn `sonnet`/
   `high`; job khác ưu tiên lựa chọn của ticket, rồi bản đồ độ phức tạp của config. `dev`/`qc` không còn mặc
   định theo vai trò — ticket chưa được PM chấm `complexity` làm `chooseModel()` ném `MissingComplexityError`
   (`model-policy.ts`, flow `agent-roles`); `assistant`/`pm` vẫn rơi về mặc định vai trò khi ticket chưa có
   độ phức tạp. `rolePlanner` dùng chính sách chi tiết hơn của nó (`resolveModel()`, flow `agent-roles`).
3. `apps/daemon/src/runner/job-runner.ts` → `execute()` → `workspace()`: dựng worktree (flow
   `agent-workspace`); QC bắt đầu tại `head_sha` của report dev đã ghép cặp (`qcBase()`); tạo thư mục tạm
   riêng của job (`jobTmpDir`); env qua `agentEnv()` (bỏ `ANTHROPIC_API_KEY`, thêm `CREW_JOB_ID`,
   `TMPDIR`/`TMP`/`TEMP`, `~/.crew/bin` lên đầu `PATH`). Ngay sau đó `planner.prepare?.()` chạy (worktree đã có
   nhưng agent chưa bắt đầu) — hook tuỳ chọn để role planner chuẩn bị thêm (ví dụ merge head nền, cài hook
   docs-init, flow `agent-roles`); nó cũng có thể trả `skip` (job kết thúc ngay) hoặc một `note` được nối vào
   cuối prompt. `plan.notices` (nếu có) được đăng thành bình luận trước khi chạy.
4. `apps/daemon/src/runner/agent-runner.ts` → `createSdkRunner()`: gọi `query()` của Agent SDK với
   `settingSources: ['user', 'project', 'local']`, `permissionMode: 'dontAsk'` cộng `allowedTools` theo vai
   trò, MCP server ticket in-process (`mcpServers.tickets`), hook `PreToolUse` inline là guard, env có
   `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2`, `settings.enabledMcpjsonServers`/`disabledMcpjsonServers`,
   `spawnClaudeCodeProcess` tự spawn tiến trình con trong process group riêng (`detached: true`), để cleanup
   (flow `resource-hygiene`) có thể gửi tín hiệu tới cả process group/cây tiến trình mà agent khởi động; thu
   message `system/init` (session id, skill, MCP server, apiKeySource),
   `system/api_retry`, và `result` (subtype, chi phí, `modelUsage`).
5. `apps/daemon/src/runner/agent-runner.ts` → `RunControl.requestEnd()`: khi tool `ask_owner` hoặc
   `handoff_docs` gọi `requestEnd()`, runner `interrupt()` turn hiện tại ngay sau message `assistant` tiếp
   theo — kết thúc này được coi là bình thường (`isError` không bật) dù turn bị ngắt.
6. `apps/daemon/src/runner/scripted-runner.ts` → `createScriptedRunner()`: test double cùng interface
   `AgentRunner`, đọc kịch bản YAML (bước `tool`/`bash`/`write`/`skill`/`sleep`/`apiError`/`fail`/`crash`,
   cộng `Edit` phát lại đúng `old_string`/`new_string`/`replace_all` như Claude Code thật) và thật sự phát lại
   qua guard hook, tool log, ticket tools; `script` có thể là hàm `async` (đọc trạng thái ticket trước khi chọn
   kịch bản) và một `resolve()` tuỳ chọn điền input của từng bước ngay trước khi chạy (ví dụ id một ticket bước
   trước vừa tạo); phiên giả (`SessionState`) giữ chi phí lũy kế của session và tiến độ theo từng job
   (`completed[jobId]`) — resume đúng job đó (ví dụ sau khi daemon khởi động lại) tiếp tục từ bước cuối job đó
   đã hoàn thành, còn một job mới dùng chung session (job id khác) chạy lại kịch bản từ đầu và cộng dồn vào chi
   phí session đã có; chỉ dùng cho test vòng đời, production dùng `createSdkRunner()`.
7. `apps/daemon/src/runner/guard-hook.ts` → `evaluateToolCall()`: `Edit`/`Write`/`MultiEdit`/`NotebookEdit` bị
   từ chối khi ra ngoài `cwd` hoặc đi qua symlink ra ngoài `cwd` (trừ shared path đã link), khi chạm đường dẫn
   được bảo vệ (`.claude/**`, `.githooks/**`, `CLAUDE.md`, `.husky/**`, cấu hình lefthook, file CI crew-docs,
   `isProtectedPath()` được export cho `merge-policy.ts` dùng lại ở cổng pre-push) — trừ job `docs_init` — hoặc
   khi sửa mục `source`/`shared`/`unassigned` của `docs/flows.yaml`; job `docs_update` chỉ được ghi dưới
   `docs/`; một lượt `dev` (`codeOnly`, theo `stage`, flow `agent-roles`) không được ghi dưới `docs/` **và**
   không được `git commit` (chỉ job `docs_update` sau đó mới commit code, test và docs cùng nhau). `Bash` bị
   chặn khi `git push --force`, `git commit` của lượt `codeOnly`, `rm -rf` ra ngoài `cwd`/thư mục tạm job, hay
   đổi `core.hooksPath`. Một lời gọi được phép không trả quyết định gì, nên `dontAsk` + `allowedTools` vẫn áp
   dụng sau đó; mọi lời gọi được ghi vào `tool_log`.
8. `apps/daemon/src/tools/ticket-mcp-server.ts` → `buildTicketTools()`: dựng bộ công cụ ticket theo vai trò
   (`tool-scopes.ts` → `ticketToolsFor()`); mọi ghi đi qua `JobWriter.write()` — Idempotency-Key
   `<jobId>:<seq>` chỉ commit `toolSeq` sau khi server trả lời, nên một câu trả lời bị mất (mạng, crash) được
   gửi lại với cùng key và server phát lại thay vì tạo bản ghi thứ hai; mọi bình luận/report bị
   `scrubSecrets()` (định nghĩa ở `packages/shared/src/secret-scrubber.ts`, export qua `@crew/shared`;
   `apps/daemon/src/runner/secret-scrubber.ts` chỉ re-export để nhật ký `app.log` của app desktop dùng chung
   một bộ luật) ẩn credential trước khi rời máy; `get_ticket`/`list_children` bọc mọi văn bản chủ dự án
   không tự viết bằng `wrapTicketDetail()`/`wrapUntrusted()` (flow `agent-roles`); `submit_report` gọi
   `ctx.reportOverlay()` (do role planner cấp: `docsFirst`, skill/MCP thiếu, tài nguyên để lại, `headSha`/
   `commits` cho job commit) và đăng cảnh báo nếu có, còn lượt `dev` (`codeOnly`) không được `submit_report`
   hay `update_status` sang `done`/`in_review`. Bốn tool mới của flow `agent-roles`/`local-merge`:
   `select_capabilities` (ghi lựa chọn skill/MCP có lý do), `return_to_dev` (job docs trả việc về dev kèm
   output hook), `reject_work` (PM từ chối một ticket dev/bug đã xong, gọi `fileBug()`), `merge_and_push` (PM
   gọi `mergeAndPush()`, flow `local-merge`); `create_subtask` từ chối MCP server bị dự án tắt và tự thêm
   `docs_init` (nếu có) vào `dependsOn`; subtask `dev`/`qc` bắt buộc `complexity` và `complexityReason` (không
   có model mặc định cho hai loại này, flow `ticket-lifecycle`/`agent-roles`); `model` chỉ nên đặt khi PM cố ý
   ghi đè bảng độ phức tạp. `CHILD_CAP_EXCEEDED`/`BUDGET_HOLD` từ `create_subtask` và
   `BUG_CYCLE_CAP` từ `file_bug` kết thúc lượt chạy cho chủ dự án thay vì ném lỗi; PM không đóng ticket
   (`update_status` sang `done`/`in_review`) khi cây ticket còn tiến trình sống (`treeOrphans()`); QC không
   đóng ticket (`update_status` sang `done`) khi MCP server bắt buộc của ticket (`TicketToolContext.requiredMcps`,
   điền từ `ticket.requiredMcps` ở `job-runner.ts`) chưa có lời gọi công cụ nào trong bất kỳ lượt nào của
   ticket (`unusedUiServers()`, đọc `tool_log`) — QC không thể âm thầm bỏ qua kiểm thử UI dù server có kết nối;
   `create_pm_ticket` nhận thêm `complexity`; `errorText()` nối thêm `details` của lỗi server (ví dụ trường nào
   sai) vào thông báo cho agent tự sửa input. `createDocsInitTicket()` là hàm nội bộ của daemon (không phải
   tool agent): tạo ticket con `docs_init` của một `pm_task`.
9. `apps/daemon/src/tools/tool-scopes.ts` → `allowedToolsFor()`: cộng tool xây sẵn theo vai trò
   (`builtinToolsFor`), tool ticket theo vai trò, và `mcp__<server>__*` của mọi MCP server đang bật trong kho
   inventory (server bị chủ dự án tắt cho project thì bị loại, nên `dontAsk` từ chối tool của nó).
   `ticketToolsFor()`: mọi vai trò có `select_capabilities`; PM có thêm `reject_work`/`merge_and_push`; dev có
   `handoff_docs` (chỉ `kind='agent'`, lượt `dev`) và `return_to_dev` (chỉ `kind='docs_update'`, lượt
   `docs_update` — hai tool loại trừ nhau theo `KIND_ONLY`).
10. `apps/daemon/src/runner/job-runner.ts` → `execute()` (sau khi run xong): `afterRun()` của role planner trả
    `comments` (đăng trước khi kết thúc), `block` (chuyển ticket `blocked`) và `status` tuỳ chỉnh (mặc định
    `done`); job hủy hoặc `aborted` → `finish(status: 'cancelled')`; lỗi API thuộc lớp backoff
    (`retry-classifier.ts` → `classifyRetry()`: `rate_limit`/`overloaded`/`billing_error`/`account_on_hold`,
    `retry_at = now + min(5 phút·2^attempt, 60 phút)`, kèm bình luận) → `backoff`, tới lần thứ 4 thì `blocked`
    (chuyển ticket sang `blocked`); lỗi khác → `failed` (kèm bình luận, thường chuyển ticket `blocked` trừ khi
    có `followUp`); còn lại → `done`. `bookCost()` ghi chi phí đúng một lần: `total_cost_usd` cuối của session
    trừ đi phần các run trước của cùng session đã ghi. `liveProcesses()` đếm tiến trình còn sống của job (theo
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
| `apps/daemon/src/runner/agent-runner.ts` | Runner SDK thật | `createSdkRunner`, `RunControl`, `agentEnv`, `AgentRunResult` |
| `apps/daemon/src/runner/scripted-runner.ts` | Runner kịch bản YAML cho test | `createScriptedRunner`, `Script`, `ScriptedCrash` |
| `apps/daemon/src/runner/guard-hook.ts` | Chặn ghi/Bash ngoài phạm vi | `evaluateToolCall`, `createGuardHook` |
| `apps/daemon/src/runner/skill-usage.ts` | Skill/MCP dùng trong run, từ tool log | `skillsInvoked`, `mcpServersUsed`, `mcpToolPrefix`, `slashCommandsIn` |
| `apps/daemon/src/runner/retry-classifier.ts` | Phân loại lỗi API thành backoff/blocked | `classifyRetry`, `isBackoffError`, `BACKOFF_ERRORS` |
| `packages/shared/src/secret-scrubber.ts` | Luật ẩn credential dùng chung (daemon + app desktop) | `scrubSecrets`, `ScrubResult` |
| `apps/daemon/src/runner/secret-scrubber.ts` | Re-export `scrubSecrets` từ `@crew/shared` cho code cũ trong daemon | `scrubSecrets` |
| `apps/daemon/src/tools/ticket-mcp-server.ts` | MCP server ticket theo vai trò | `buildTicketTools`, `createTicketMcpServer`, `JobWriter`, `createDocsInitTicket`, `unusedUiServers` |
| `apps/daemon/src/tools/tool-scopes.ts` | Phạm vi tool theo vai trò | `ticketToolsFor`, `allowedToolsFor`, `builtinToolsFor`, `TICKET_TOOL_NAMES` |

## Dữ liệu

- Bảng: ghi `jobs` (trạng thái, chi phí, `modelUsage`, `skillsInvoked`, `handoff`…), `tool_log` (mọi lời gọi
  tool), `pending_wakeups` (qua `foldWakeups`) của `apps/daemon/src/state-db.ts` (flow `daemon-runtime`).
- Sự kiện: không tự phát sự kiện daemon nội bộ; kết quả job (bình luận, report, chuyển trạng thái, subtask
  mới) đi qua các route ghi của flow `daemon-api` nên làm phát sinh sự kiện phía server (flow
  `event-delivery`).
- Gọi ngoài: Agent SDK (`@anthropic-ai/claude-agent-sdk` → tiến trình Claude Code, đăng nhập gói đăng ký của
  chủ dự án, không dùng `ANTHROPIC_API_KEY`); VPS API qua `VpsClient` (comment, transition, submit report,
  file bug, agent-meta, create subtask).

## Flow liên quan

- daemon-scheduling: `Scheduler.launch()` gọi `JobRunner.launch()`.
- daemon-runtime: `JobRunner` được tạo trong `createDaemon()`; chi phí và trạng thái job đọc/ghi
  `state-db.ts`.
- agent-workspace: `workspace()`/`releaseWorkspace()` dùng `ensureWorktree`/`removeWorktree`;
  `probeInventory()` cấp danh sách skill/MCP cho `allowedToolsFor()`.
- resource-hygiene: mỗi lần job kết thúc, `JobRunner.cleanup()` gọi `cleanupJob()`; PM dùng
  `resource_report`/`cleanup_resources` (từ `ResourceOps`, được lắp trong `JobRunnerDeps.resourceOps`).
- daemon-api / ticket-lifecycle: mọi ghi ticket của tool ticket gọi các route agent phía server.
- agent-roles: `rolePlanner` (bản `RolePlanner` mặc định) và mọi tool/guard mới ở đây (stage, capability
  preflight, docs-first, thất bại/thử lại) được định nghĩa ở flow đó; trang này chỉ mô tả nền tảng chạy job
  chung mà nó cắm vào.
- local-merge: tool `merge_and_push` gọi `mergeAndPush()` của flow đó.

## Tests

- `apps/daemon/test/daemon.test.ts`: dừng đúng tiến trình job khi kết thúc mà không đụng tiến trình không
  gắn thẻ; sống sót qua crash giữa run (không mất sự kiện, một job hoạt động mỗi ticket, không tạo bản ghi
  trùng); job QC bắt đầu ngay sau `dependency.resolved` và resume session khi chủ dự án bình luận; run bị rate
  limit tạm dừng ở backoff với `retry_at` tăng dần rồi `blocked` sau 4 lần; job đang chạy bị hủy khi ticket bị
  hủy và worktree được gỡ; job được re-queue khi daemon dừng nhẹ nhàng và resume ở lần chạy sau; một job crash
  trước khi agent chạy xong (lỗi khi chuẩn bị) đăng bình luận lỗi, chuyển ticket `blocked`, báo qua
  `failedJobs` trong heartbeat tới khi owner mở chặn cho job mới chạy xong; một ticket dev cũ chưa có
  `complexity` (tạo trước khi bắt buộc đánh giá) đi qua đúng đường crash này với `MissingComplexityError` thay
  vì tự chọn model mặc định.
- `apps/daemon/test/agent-runner.test.ts`: `query()` chạy với đúng `settingSources`, `dontAsk`, allowlist,
  guard hook và env sạch; truyền đúng `resume` và ngân sách, báo đúng lớp lỗi API cuối; ngắt turn sau khi một
  tool yêu cầu kết thúc run và coi đó là kết thúc bình thường; run không có message `result` bị đánh dấu lỗi.
- `apps/daemon/test/guard-hook.test.ts`: từ chối ghi ngoài `cwd` và vào `.githooks` dù có file settings được
  cài đặt cho phép; lời gọi được phép không trả quyết định (để `dontAsk`/`allowedTools` vẫn áp dụng); đường
  dẫn được bảo vệ theo từng loại job; các mẫu Bash bị chặn (force push, `rm -rf` ngoài phạm vi, đổi
  `core.hooksPath`).
- `apps/daemon/test/ticket-tools.test.ts`: mỗi vai trò có đúng bộ tool ticket riêng (kể cả `return_to_dev` chỉ
  cho `docs_update`, `handoff_docs` chỉ cho lượt `dev`); mọi tool của MCP server đã bật được phép, server bị
  tắt thì không; bình luận ẩn credential, `ask_owner` kết thúc run; `handoff_docs` ghi bàn giao vào job và kết
  thúc run; PM tạo subtask idempotent (câu trả lời bị mất, gửi lại sau khi daemon khởi động lại chỉ tạo đúng
  một ticket) và bị từ chối khi yêu cầu MCP server đã bị dự án tắt; tool tài nguyên PM-only bị từ chối ngoài
  ngữ cảnh PM; lượt `dev` (`codeOnly`) không `submit_report`/đóng ticket được; QC không đóng ticket được khi
  một MCP server bắt buộc chưa có lời gọi công cụ nào trong nhật ký (`unusedUiServers`), đóng được sau khi gọi;
  lỗi server kèm `details` xuất hiện trong thông báo trả về agent.
- `apps/daemon/test/live-smoke.test.ts`: worktree của repo có `.claude` bị gitignore vẫn thấy đúng skill
  project như checkout chính; đăng nhập gói đăng ký hoạt động và không tính phí qua API key; một job haiku
  dùng đúng ticket tools, bị guard kiểm soát, và ghi đúng `total_cost_usd`.
