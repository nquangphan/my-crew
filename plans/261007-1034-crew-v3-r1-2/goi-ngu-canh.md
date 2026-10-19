# Gói ngữ cảnh R1-2 (và sơ bộ R1-3) — Crew v3

Lập 07/10/2026 (Asia/Ho_Chi_Minh) bằng cách đọc code, chưa chạy gì. Viết tắt: `FORK` = `.worktrees/paperclip-v3` (nhánh `v3`, `e1c3dd2db`),
`CREW` = repo Crew (nhánh `v3`), `V2` = `/Volumes/CORSAIR/Projects/my-crew-v2/v2`. Tên file/symbol đã grep xác minh; không ghi số dòng.
Đối chiếu "7 việc bắt buộc" theo `plans/261006-1355-crew-v3-r1-1/plan.md` mục cuối: (1) retry kiểm tiến độ, (2) H3 fallback khi stop-run exit 2,
(3) cổng tải mốc deadline bền, (4) uninstall từ chối khi còn run, (5) doctor chỉ fail TCC của claude/node agent, (6) bundle plugin + health, (7) H2 logic thật.

## Phát hiện chính (đọc trước khi cắt ticket)

- **Rule "tối đa 5 vòng sửa" stock đã có**: `maxReviewRounds` (`packages/shared/src/validators/issue.ts`, 1–50) + `DEFAULT_MAX_REVIEW_ROUNDS = 3` /
  `resolveMaxReviewRounds` trong `FORK/server/src/services/issue-execution-policy.ts`. Vòng đủ số thì stage giữ `pending` nhưng giao cho
  `reviewEscalationUserId` (ưu tiên `responsibleUserId`, rồi `createdByUserId`); reviewer agent gửi tiếp nhận 422. Spike CREA-8: 5 vòng đúng, vòng 6 → 422.
  Nên "plugin áp rule 5 vòng" thực chất là **ép `maxReviewRounds: 5` trong mọi policy** (template + H2 chuẩn hóa/từ chối), không phải plugin đếm.
- **Plugin không có event riêng cho quyết định review**; chỉ `issue.updated` (activity) mang `executionState.changesRequestedCount` / `lastDecisionOutcome`
  (`PLUGIN_EVENT_TYPES` trong `FORK/packages/shared/src/constants.ts`). Còn `agent.run.cancelled`, `issue.comment.created`. Cần đếm riêng thì đọc `changesRequestedCount`, không tự đếm.
- **H2 đã có điểm cắm no-op** ở `issueService.update.runUpdate` (`FORK/server/src/services/issues.ts`), registry ở `FORK/server/src/crew/core-hooks.ts`
  (`implementations.beforeIssueWrite = async () => {}`). Lúc hook chạy, `patch` đã gộp `transition.patch` của route (status + executionState + executionPolicy),
  nên H2 kiểm được trạng thái cuối. `existing` đọc trước khóa dòng; muốn chắc phải đọc lại qua `tx` với `.for("update")` (ghi ở docstring `BeforeIssueWriteInput`).
- **Dữ liệu `previous run` bị xóa sau khi dừng**: cả `crew-mac stop-run` (`apps/crew-mac/src/commands/stop-run.ts`, `rmSync` thư mục run) lẫn script fallback
  (`CREW_REMOTE_STOP_SCRIPT` trong `FORK/server/src/crew/remote-stop.ts`, `rm -rf "$dir"`) xóa `.paperclip-runtime/runs/<runId>/` khi `remaining=0`.
  Vậy việc 1 **không nên dựa vào file `started` trên Mac**; dùng `heartbeat_runs.startedAt` của run trước (DB, `packages/db/src/schema/heartbeat_runs.ts`).
- **Superpowers đã là plugin Claude** (`superpowers@claude-plugins-official` trong `~/.claude/plugins/installed_plugins.json` của owner, user-scope). Agent chạy
  `--setting-sources project,local` nên plugin user-scope **không** nạp; phải bật ở project/local hoặc `--settings` (luôn áp dụng) / `--plugin-dir` (chưa kiểm).

## Gói 1 — `policy` (opus)

Việc: **(7)**, template `executionPolicy` reviewer/integrator/owner, rule 5 vòng, chặn bypass đã xác nhận ở S4 (CREA-2 xóa policy, CREA-3 rút gọn, CREA-5 stage review chỉ có executor).
Chạm hook lõi H2 nên dùng opus.
- `FORK/server/src/crew/core-hooks.ts` — `BeforeIssueWriteInput`, `implementations.beforeIssueWrite` (thay no-op bằng gọi file mới, ví dụ `server/src/crew/issue-gate.ts`; implementation không import registry).
- `FORK/server/src/services/issues.ts` — `issueService.update` → `runUpdate`; `issueService.create` (đường tạo issue **không** qua H2).
- `FORK/server/src/services/issue-execution-policy.ts` — `applyIssueExecutionPolicyTransition`, `normalizeIssueExecutionPolicy`, `canAutoSkipPendingStage` (logic auto-skip), `resolveMaxReviewRounds`.
- `FORK/server/src/routes/issues.ts` — handler `PATCH /issues/:id` (`allowBoardOverride: req.actor.type === "board"`), đường tự duyệt `isApprovalReviewComment` ở `POST /issues/:id/comments`.
- `FORK/packages/db/src/schema/issue_execution_decisions.ts` và cột `executionPolicy`/`executionState` trong `.../schema/issues.ts` (bảng quyết định; H2 có thể đọc để chứng minh "đủ stage").
- Test: sửa `FORK/server/src/__tests__/crew-core-hooks.test.ts` (đang khẳng định `beforeIssueWrite` mặc định không chặn gì) và thêm test hành vi như `crew-before-claim.test.ts` (embedded PG). Cập nhật mục H2 trong `FORK/crew/release/core-hooks.json` (mục `tests`).
Bẫy:
- Người gọi `update` ngoài route là **không có actor**: `load-gate.ts` `blockIssue` → `issueService(db).update(id, {status:"blocked"})`, plugin `ctx.issues.update` (`run-cancelled.ts`) cũng actor null. H2 không được chặn các ghi `blocked`; chỉ chặn `done`/sửa `executionPolicy`.
- Board vẫn ép `done` được (S4 CREA-4, owner chấp nhận cho R1); H2 phải phân biệt board (có `actorUserId`) với agent/plugin/system.
- Chặn `executionPolicy` do agent sửa **và** kiểm `done` thiếu stage; thiếu vế đầu thì bypass 1–2 vẫn mở (`spike-policy.md`, "Kết luận Step 7").
- Stage review mà participant duy nhất là executor bị auto-skip lặng lẽ (0 decision): chặn ở template/H2, không ở lõi.
- `existing` đọc trước khóa; không ghi activity ở đây vì 422 không ghi activity. SSH trong H2 sẽ giữ khóa dòng issue (xem gói 2, câu hỏi docs-gate).
- Mọi agent ghi cần `X-Paperclip-Run-Id` (403 `cross_issue_influence_run_context_required`): test bằng run id thật hoặc run đã kết thúc.

## Gói 2 — `runtime-retry` (opus)

Việc: **(1), (2), (3)**. Chạm scheduler/process lifecycle nên dùng opus. Không cần hook mới (ngân sách hiện 3/5).
- `FORK/server/src/crew/load-gate.ts` — `evaluateBeforeClaim`, `decideGate`, `defaultBeforeClaimDeps` (`firstNoticeAt`, `postNotice`, `scheduleCancel`, `blockIssue`). **(3)**: `waitingSince` lấy từ activity `crew.load_gate.waiting`; `postNotice` comment trước activity sau, nên comment lỗi → không có activity → `waitingSince = now` mỗi tick → chờ vô hạn.
- `FORK/server/src/crew/remote-stop.ts` — `CREW_REMOTE_STOP_SCRIPT`, `stopRemoteRunOnRelease`, `classifyStopError`. **(2)**: launcher `~/.crew/bin/crew-mac stop-run` thoát 2 (root ngoài worktreeRoot, hoặc chưa có manifest) chỉ rơi vào fallback khi `rc` là 126/127; exit 2 đang `exit "$rc"` → kết quả `failed`.
- `FORK/server/src/crew/core-hooks.ts` — H1 `beforeClaim` (đã có `run.contextSnapshot`, đã SSH trong gate) là chỗ hợp lý cho **(1)** khi `contextSnapshot.retryOfRunId` có giá trị; không thêm hook thứ tư.
- `FORK/server/src/services/heartbeat.ts` — `scheduleBoundedRetryForRun` (đặt `retryOfRunId`, `BOUNDED_TRANSIENT_HEARTBEAT_RETRY_REASON`), `enqueueProcessLossRetry` (restart/mất process), `reapOrphanedRuns`, `cancelRunInternal`, `readHeartbeatRunErrorFamily` (`claude_transient_upstream` = nhóm retry khi mất mạng). Đọc theo symbol, không đọc cả file.
- `FORK/packages/db/src/schema/environment_leases.ts` — lease cũ có `metadata.remoteCwd` (nguồn worktree, như `readRemoteCwd` trong remote-stop.ts); `heartbeat_runs.startedAt` cho mốc thời gian run trước.
- `CREW/apps/crew-mac/assets/crew-claude-run.sh` — hợp đồng `pgid`/`started` (chỉ để hiểu; `started` có thể đã bị xóa, xem Phát hiện chính).
- Test mẫu: `FORK/server/src/__tests__/crew-load-gate.test.ts`, `crew-remote-stop.test.ts`, `crew-before-claim.test.ts`; script nghiệm thu thật `FORK/crew/ops/watch-run.sh`, `active-runs.sh`.
Bẫy (ledger/AC-1):
- Mất mạng → process cũ kịp commit lúc 16:20:43 trước khi reaper giết 16:20:54, retry sau ~5 phút làm lại: kiểm "commit kể từ `startedAt` của run trước trong `remoteCwd`" qua SSH (`git log --since=...`), ghi kết quả dưới dạng comment/activity để agent retry thấy.
- Retry có thể xảy ra khi Mac còn unreachable: kiểm tiến độ lỗi thì phải giữ `queued` hay cho chạy? (câu hỏi bên dưới).
- Tick bị chặn tới 5s mỗi 15s/máy khi Mac không tới được (RT-2 minor C3); thêm SSH vào H1 làm nặng hơn → dùng chung `createProbeCache`.
- `claimQueuedRun` chạy dưới khóa start của agent: không `await` việc hủy trong hook (đã có `scheduleCancel` bằng `setImmediate`).
- Hai lỗi cùng lúc ở nhánh hết hạn vẫn có thể mở cổng (RT-2 minor); test crew-run-cancelled đặt tên todo nhưng thực tế blocked (R1-2 minor trong ledger).

## Gói 3 — `mac-cli` (sonnet, bám khuôn; việc 4 chạm process nên có reviewer opus)

Việc: **(4), (5)**; thêm kiểm `crew-docs` và Superpowers vào `setup`/`doctor` (nếu gói 4/5 cần).
- `CREW/apps/crew-mac/src/commands/uninstall.ts` — `uninstall(ctx)`: thêm kiểm run sống trước khi `bootout`; cờ `--force` đã có ở `CREW/apps/crew-mac/src/cli.ts` (case `uninstall`, hiện `--force` chỉ bỏ qua cảnh báo sshd — cần quyết định dùng chung hay tách cờ).
- `CREW/apps/crew-mac/src/reaper/{process-table.ts,run-members.ts}` — `listProcesses`, `readRunStarts`, `collectRunMembers`, `selectRunMembers` để nhận biết run còn sống; `manifest.worktreeRoot` từ `src/manifest.ts`.
- `CREW/apps/crew-mac/src/commands/doctor.ts` — `parsePendingTccPrompts` (trả `PendingPrompt.subject` là đường dẫn app), `checkTccPending`, `tccHint`. **(5)**: lọc theo `subject` thuộc claude/node agent → `fail`, app khác → `warn`.
- Test: `CREW/apps/crew-mac/test/{uninstall,doctor,cli}.test.ts`, helper `test/helpers/fake-runner.ts`, `fake-mac.ts`.
- Docs đi kèm (luật R3): `CREW/docs/flows/mac-setup.md` (+ `mac-orphan-reaper.md` nếu đụng reaper); không sửa mục `source/shared/unassigned` của `docs/flows.yaml` khi chưa có `Crew-Owner-Approved`.
Bẫy: `uninstall` không được cắt phiên đang đi qua sshd 2222 (đã có chặn); "run còn sống" chỉ tính process của run Paperclip, không tính `claude` thủ công của owner (bài học MS-2: `extractRunId` từng giết nhầm); `doctor` đọc `log show` rất chậm (timeout 240s).
Minor hoãn đáng làm cùng: hint `load` còn chữ mã plan, `uninstall` chưa gỡ `~/.crew/app`, `sysctl` theo PATH. `assets/crew-claude-run.sh` không thuộc flow nào (R6, cần owner).

## Gói 4 — `superpowers-mac` (opus)

Việc: cài/ghim Superpowers trên Mac + chặn nạp skill chéo port từ v2. Thiết kế khó (cách ly), cần chọn cơ chế trước khi cắt ticket.
- V2 pin: `V2/gateway/src/workflows/pins.ts` — `releases.superpowers` (version `6.4.2`, revision `8ca22dba9a94f28898bbce59f2537ff4d87c747d`, repo `obra/superpowers`), `officialSourceUrl`, `validateSourcePin`, `toDomainPin`.
- V2 policy thuần: `V2/src/workflow-policy.ts` (`samePin`, `workflowsReady`, `assertSkillAllowed` → `WORKFLOW_SOURCE_MISMATCH`), tương tự `V2/src/model-policy.ts` (`eligibleModels`), `V2/src/completion-policy.ts` (`canComplete`, `canDeploy`) — 18–25 dòng mỗi file, port nguyên được.
- V2 registry/tải: `V2/gateway/src/workflows/{registry.ts (WorkflowRegistry), fetch.ts (readArchive, verifyPayload, fetchSource), stage.ts (parseArchive, scanTree, manifestHash)}`.
- V2 cách ly: `V2/gateway/src/isolation/inventory.ts` (`classifyOrigin`, `auditWorkspace`, `discoveryReason`), `policy.ts` (`isolationPolicy` sandbox-exec; `routerPolicy` ghi `productionEnabled: false`, blockers `INVOCATION_CERTIFICATE_MISSING`), `workspace.ts`, `preflight.ts`.
- Fork: `FORK/packages/adapters/claude-local/src/server/execute.ts` (`buildClaudeArgs` có `--setting-sources`/`--add-dir`/`extraArgs`; `config.extraArgs`), `.../skills.ts` (`buildClaudeSkillSnapshot`, thư mục `~/.claude/skills`), `FORK/server/src/services/company-skills.ts`, `runtime-skill-cache.ts`.
- Mac: `CREW/apps/crew-mac/src/commands/setup.ts`, `doctor.ts` (nơi gắn bước cài/ghim và kiểm), `~/.claude/plugins/installed_plugins.json` và `known_marketplaces.json` (trạng thái hiện có), `plans/261006-0805-crew-v3-stock-first/spike-claude-mac.md` mục D2 (CLAUDE.md cha, 3 plugin builtin `cc-plugin-*`, `--settings` luôn áp dụng).
Bẫy:
- V2 isolation rất nặng (workspace.ts ~860 dòng, sandbox-exec, "invocation certificate" chưa có) và đã ghi production chưa bật: **không port nguyên khối**; chỉ lấy pin + `assertSkillAllowed` + kiểm kê nguồn (`classifyOrigin`).
- R1 chỉ Superpowers (BMAD sang R2): giản lược `workflowsReady` về một workflow.
- Plugin Superpowers trong tài khoản owner khác bản ghim (không biết bản đang cài): doctor phải so version/revision/checksum với pin.
- `--setting-sources project,local` không chặn dò `CLAUDE.md` của thư mục cha (owner đã chốt cho phép) nhưng hook/plugin cá nhân thì bị chặn: đây là cơ sở của "chặn nạp chéo" và cũng là lý do plugin Superpowers user-scope không tự có trong run.
- Quota tài khoản Claude `congtu.kids` từng 96%: thử trên haiku.

## Gói 5 — `plugin` (sonnet, bám khuôn `run-cancelled.ts`)

Việc: **(6)** bundle `crew.core` bỏ phụ thuộc tsx loader dev + kiểm `/plugins/<id>/health` sau mỗi deploy. Rule 5 vòng nếu cần quan sát (xem Phát hiện chính).
- `FORK/packages/crew-plugin/package.json` (`paperclipPlugin.manifest/worker`, script `build` = `tsc`), `src/{manifest.ts, worker.ts, run-cancelled.ts}`, `tsconfig.json`.
- `FORK/server/src/services/plugin-loader.ts` — `DEV_TSX_LOADER_PATH` và đoạn đặt `workerOptions.execArgv = ["--import", loader]` khi plugin có `packagePath`; đường tìm `@paperclipai/plugin-sdk` của worker.
- `FORK/server/src/routes/plugins.ts` — `GET /plugins/:pluginId/health` (kiểu phản hồi khai báo trong cùng file).
- `FORK/crew/ops/{overlay-source.sh, overlay-job.sh, inspect-image.sh, deploy.sh, rollback.sh}` — nơi đóng gói plugin (tsc → overlay), symlink SDK, kiểm tsx loader ("tsx loader MISSING" là điều kiện hiện tại phải bỏ), health sau deploy (`deploy.sh` thoát 3 khi health không ok, chưa kiểm plugin).
- Test: `FORK/server/src/__tests__/crew-plugin-manifest.test.ts`, `crew-run-cancelled.test.ts`; `FORK/crew/release/verify.sh` (tsc plugin).
Bẫy: plugin phụ thuộc mã TS của `@paperclipai/shared` (ledger RT-4 deferred) nên bundle phải gộp hoặc tách phần dùng; `inspect-image.sh` và `overlay-source.sh` gắn cứng đường dẫn MacBook (`FORK=...paperclip-r1-1` trong handover mục 0, chưa sửa); capabilities hiện `events.subscribe, issues.read, issues.update, issue.comments.create` — thêm tính năng mới phải thêm capability; deploy cần backup trước (RT-3) và image rollback `in-place-6ab1aa8`; cập nhật `core-hooks.json` không cần nếu không đụng hook.

## Gói 6 — `roles` (sonnet; phần viết hướng dẫn có thể haiku)

Việc: instructions cho executor/reviewer/integrator theo Superpowers; **quy trình integrator**: merge, chạy docs-kit trên merged commit, chỉ approve khi docs hợp lệ.
- `CREW/packages/docs-kit/src/cli.ts` — `crew-docs check --all` / `--range <base>..<head>` (thoát 0 ok, 1 vi phạm, 2 lỗi dùng, 3 chưa khởi tạo); bundle `packages/docs-kit/dist/crew-docs.cjs` (đóng gói bằng `pnpm --filter @crew/docs-kit` script `build`); `STANDARD.md`.
- `CREW/.agents/skills/` (bộ skill Superpowers điều phối của Trợ Lý, tham khảo định dạng: `requesting-code-review`, `finishing-a-development-branch`, `receiving-code-review`) và `.agents/skills/tro-ly/references/{nhan-viec,dieu-linh,nghiem-thu}.md`.
- Nơi đặt instructions agent: `FORK/server/src/services/agent-instructions.ts` (`instructionsFilePath`, `AGENTS.md` mặc định) hoặc thư mục `crew/skills/` (plan stock-first ghi "fork hoặc repo Crew", chưa tạo).
- Bảng test theo tầng (integrator chạy một lần trên merged tree): `plans/261006-0805-crew-v3-stock-first/plan.md` mục "Chính sách test theo tầng".
Bẫy: không có cách nào để Paperclip tự biết "docs hợp lệ"; nếu chỉ dặn trong prompt thì integrator có thể approve bừa (cần quyết định: ép bằng code hay tin agent). Ép bằng SSH trong H2 sẽ giữ khóa dòng issue vài giây và phụ thuộc Mac; ép bằng plugin sau commit thì chỉ hoàn tác được (mở lại issue). Cần `crew-docs` có trên Mac (hiện không có bước cài trong `crew-mac setup`) và repo dự án đã `crew-docs init` (exit 3 nếu chưa).

## Phụ trợ R1-2 (nhắc, không phải gói riêng)

- Mỗi commit đổi file nguồn phải sửa flow doc tương ứng (R3); file mới phải có trong `CREW/docs/flows.yaml` (R2). Phía fork không có luật này nhưng phải cập nhật `crew/release/core-hooks.json` khi đổi hook/vá và chạy `crew/release/check-core-hooks.mjs`.
- Triển khai: chỉ deploy khi owner duyệt (`crew/ops/deploy.sh`, backup trước); VPS chỉ đụng `/opt/crew-v3-spike`.
- Cấm ghi vào `~/crew-agents`, cấm đặt `PAPERCLIP_RUN_ID` trong phiên làm việc (reaper).

## Sơ bộ R1-3 — Trợ Lý

### Gói `assistant` (opus: thiết kế; sonnet: phần bám khuôn)
- Skill/agent Trợ Lý: `CREW/.agents/skills/tro-ly/` và các skill Superpowers (`brainstorming`, `executing-plans`, `subagent-driven-development`, `dispatching-parallel-agents`).
- V2 tham chiếu: `V2/gateway/src/assistant/{tool-client.ts, workflow-manifest.ts, render-executor.ts, render-artifacts.ts}` và policy thuần ở gói 4 (`workflow-policy`, `completion-policy`, `model-policy`).
- API Paperclip để tạo issue con có blocker + policy: `issueService.create` (`FORK/server/src/services/issues.ts`), `blockedByIssueIds`, `executionPolicy` trong `POST /companies/:companyId/issues`. Phải dùng cùng template của gói 1.
- Hỏi owner khi thiếu thông tin: cơ chế approval/comment sẵn có (`approval.created`/`approval.decided`, `issue.comment.created`); chưa khảo sát kỹ.

### Gói `session-share` (opus nếu thêm hook)
- Dùng chung session giữa hai issue cùng gói: `POST /agents/:id/wakeup` (`handleWakeupRoute`, `wakeAgentSchema` trong `FORK/server/src/routes/agents.ts`) với `payload.issueId` + `payload.resumeFromRunId` (không dùng `taskKey`: ghi đè session của A).
- Muốn tự động: hook đầu `enqueueWakeup` (`heartbeat.ts`; cũng có `deriveTaskKey`, `shouldResetTaskSessionForWake`, `resolveExplicitResumeSessionOverride`) — sẽ là H4 (ngân sách 4/5); wake `issue_assigned` luôn mở session mới nên chỉ `resumeFromRunId` thắng. Plugin SDK không có đường nào (ghi ở `spike-policy.md`).
- Vá P3 `sessionCodec` (`FORK/packages/adapters/claude-local/src/server/index.ts`) là điều kiện tiên quyết; `codex_local` chưa vá (R2).
- Điều kiện kèm: A và B chạy cùng workspace cố định `in_place` (đã có), dòng log "will not be resumed" vẫn in sai (P4 chỉ sửa một nhánh).

## Thứ tự và song song

Gói 2 (runtime-retry), 3 (mac-cli), 5 (plugin) ghi file rời nhau → song song được. Gói 1 (policy) độc lập code nhưng cùng `core-hooks.ts`/`core-hooks.json` với gói 2 → làm tuần tự hoặc gộp commit tại hai file đó. Gói 4 cần quyết định thiết kế trước khi cắt; gói 6 cần gói 1 (template) và gói 4 (cài Superpowers) xong. Việc 5 `doctor` nên làm trước gói 4 (cả hai sửa `doctor.ts`). Review theo gói, reviewer opus cho 1, 2, 4.

## Câu hỏi sản phẩm cho owner

1. **Integrator là ai?** Một agent riêng chạy trên Mac (claude_local), hay chính Trợ Lý? S4 dùng một agent riêng; nếu dùng Trợ Lý thì policy cho phép reviewer và integrator trùng agent (có phải "reviewer tự duyệt" không)?
2. **Reviewer chạy model gì và chạy ở đâu** (cùng Mac, cùng tài khoản Claude, haiku/sonnet/opus)? Reviewer có được mở worktree của executor hay phải nhận diff qua comment?
3. **Owner duyệt ở stage nào?** Chỉ cuối (sau integrator, như S4) hay còn gate "duyệt plan" trước khi executor chạy? Mọi issue đều có stage owner hay tùy rủi ro/loại ticket (bug nhỏ, research)?
4. **Docs gate ép bằng code hay tin agent?** Ép bằng hook (chạy `crew-docs check` qua SSH trước khi chấp nhận approve của integrator, chịu giữ khóa dòng vài giây và phụ thuộc Mac) hay chỉ dặn trong instructions và phát hiện sau commit? Nếu `crew-docs` báo repo chưa khởi tạo (exit 3) thì chặn hay cho qua?
5. **"Một vòng sửa" tính thế nào?** Stock đếm mỗi lần reviewer chọn changes requested ở một stage, và quyết định của người reset về 0. Đại Ca muốn đếm riêng theo stage (reviewer vs integrator), hay gộp tổng cho cả issue? Vòng 5 chuyển cho owner = `createdByUserId`/`responsibleUserId` — đúng ý?
6. **Ghim Superpowers bản nào?** V2 ghim `6.4.2` (`8ca22dba…`); owner hiện cài từ marketplace chính thức (bản có thể khác). Giữ 6.4.2, hay ghim bản đang cài hôm nay? Cho phép nâng khi nào (theo từng lần nâng Paperclip hay tay)?
7. **Cách bật Superpowers cho agent**: chấp nhận ghi `.claude/settings.json` project-scope vào worktree agent (commit hay exclude), hay chỉ dùng cờ lệnh `--settings`/`--plugin-dir` trong cấu hình agent để repo của owner không bị đổi?
8. **Retry sau mất kết nối khi đã có commit:** nếu run trước đã commit phần việc, nên (a) báo cho agent retry và để agent tiếp tục từ commit đó, (b) tự chuyển issue sang review mà không chạy lại, hay (c) chuyển `blocked` hỏi owner? Mất mạng kéo dài mà không kiểm được tiến độ (Mac unreachable) thì giữ `queued` tới hết hạn chờ hay cho chạy?
9. **Issue do agent tạo (child issue) có bắt buộc policy không?** H2 chỉ phủ `update`, không phủ `create`; Trợ Lý tạo issue con có policy mặc định, nhưng executor tự tạo issue con không policy rồi `done` là lỗ mới. Cấm agent tạo issue, hay chấp nhận ở R1?
10. **Board vẫn ép `done` được** (đã chấp nhận cho R1). R1-2 giữ nguyên, hay cần ghi decision "board override" để có dấu vết?
