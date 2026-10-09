# UP-2 — Review nhánh sync `sync/paperclip-v2026.1005.0`

Ngày 09/10/2026, giờ Asia/Ho_Chi_Minh. Người review: Claude opus. Chỉ đọc code và chạy test, không sửa file nào.

- Worktree: `/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-sync-1005`.
- HEAD: `cb760f611`. Sau khi chạy verify, cây làm việc vẫn sạch.
- Tag so sánh là `v2026.1001.0`, `v2026.1005.0` và `703ddfa02`. Đường dẫn dưới đây tính từ gốc worktree.

## Tóm tắt

| # | Mức | Phát hiện |
|---|---|---|
| F1 | **major** | `crew/agents/apply-roles.sh agent …` giờ luôn hỏng với lỗi 422 `INSTRUCTION_BASE_REQUIRED` khi upload `AGENTS.md`. |
| F2 | minor | Có lối 422 sau khi run đã tự hủy: sau đó mọi lệnh ghi đều trả 403 `agent_run_cancelled`, và issue có thể kẹt. Lỗi này có từ trước, giờ thì xảy ra chắc chắn. |
| F3 | minor | Issue không có title thì nhận chỉ thị gọi `PUT /api/issues/:id/title`, nhưng route này không có trong allowlist của callback bridge. |
| F4 | minor | `verify.sh` bỏ sót vài test của Crew. `pnpm install` không có `--frozen-lockfile`. |

Không có blocker. F1 cần sửa (UP-3) trước khi cần chạy lại apply-roles, ví dụ sau khi UP-3 đổi file `crew/agents/*.md`. Luồng 4 stage ở happy path không bị 403 làm hỏng.

## 1. Lỗi 403 `agent_run_cancelled` cho run đã hủy

**Kết luận:** happy path không hỏng. Còn một lối hiếm (F2), nhưng hậu quả của nó vẫn như ở bản `v2026.1001.0`.

**Điều kiện chặn.** Hàm `agentRunWritesRevoked` (`server/src/agent-run-cancellation.ts:6-13`) chặn khi:
- `status === "cancelled"`, với bất kỳ `errorCode` nào, kể cả `issue_reassigned`;
- hoặc `resultJson.executionCancellation.state === "requested"`.

Trạng thái `cancelling` hay `errorCode` riêng không được xét.

**Hai lớp kiểm tra:**
- Middleware `server/src/middleware/auth.ts:395-407` chặn mọi method khác GET/HEAD/OPTIONS bằng JWT của run. Nó kiểm **lúc request đến**.
- Trong transaction, `assertAgentRunWriteAllowed` kiểm lại ở:
  - `server/src/services/issues.ts:10909-10914`, ngay sau H2;
  - `issue-thread-interactions.ts:158`;
  - `confirmation-comment-resolution.ts:35`.

**PATCH tự hủy run vẫn đi qua.** Đây là chỗ executor/reviewer/integrator/assistant `PATCH done` để chuyển stage:
- Lời gọi `applyIssueExecutionPolicyTransition` được `Object.assign` vào `updateFields` (`routes/issues.ts:13130-13171`). Vì vậy `assigneeWillChange` thành true khi policy giao issue cho reviewer hoặc owner.
- Route hủy chính run đó bằng `issue_reassigned` và `issueMutationStopId` (`:13381-13412`).
- `actorRunStopId` được truyền vào update (`:13491`).
- `assertAgentRunWriteAllowed` cho qua vì có `stoppedForThisMutation` (`agent-run-cancellation.ts:26-28`).
- Comment trong body của chính PATCH đó vẫn được ghi. Nó đi qua `svc.addComment` trong cùng request (`:13657`), không qua middleware lần nữa.

**Các agent còn ghi gì sau PATCH chuyển stage không:**
- `crew/agents/executor.md:61-64`: comment `crew-commit` trước, rồi `PATCH done` là lệnh cuối. Issue research cũng vậy (`:53`). `PATCH blocked` (`:36`, `:49`) không đổi assignee nên không hủy run.
- `reviewer.md:49-56`: quyết định nằm trong một PATCH có comment. Không ghi gì thêm.
- `integrator.md`: stage 2 thì comment `crew-docs-check` trước, rồi PATCH (bước 1→2). Stage 4 thì comment `crew-merge` (bước 7) trước PATCH (bước 8). Không ghi gì sau PATCH thành công.
- `assistant.md:45-47`: tạo interaction rồi `PATCH blocked`, không đổi assignee. `:122` thì `PATCH done` là lệnh cuối.
- Không có instruction nào gọi release checkout, work product hay interaction sau một PATCH đổi người.

**F2 (minor) — lối 422 sau khi run đã tự hủy.** Run bị hủy (`:13392`) **trước** `svc.update` (`:13650`), mà H2 chạy trong update.

Kịch bản:
1. Integrator ở stage 2 `PATCH done` khi thiếu bằng chứng docs hoặc bằng chứng đã cũ.
2. Transition giao issue cho owner (`assigneeUserId`), nên `assigneeWillChange` là true.
3. Run của integrator bị cancel với `issue_reassigned` và `suppressImmediateRecovery`.
4. H2 ném 422 `crew_gate_blocked` (`docs_missing`/`docs_stale`, `issue-gate.ts:236-243`) và transaction rollback. Issue vẫn ở tay integrator, nhưng run đã `cancelled`.

Hậu quả:
- `integrator.md` mục "Lỗi server" bảo agent ghi lại bằng chứng rồi `PATCH` lần nữa. Bước 8 cũng bảo "sửa thứ tự đăng một lần". Giờ cả comment và PATCH đó đều chắc chắn bị 403.
- Executor và assistant ("comment lại nguyên văn rồi dừng") cũng bị 403 nếu rơi vào lối này.
- Plugin `run-cancelled.ts:18-20` bỏ qua `issue_reassigned`. Stock cũng không recovery, nên issue có thể nằm im tới khi owner comment.

Đây là lỗi có từ `v2026.1001.0`. Ở bản đó run cũng bị hủy trước H2 (đã đối chiếu bản cũ của `routes/issues.ts`), và process bị giết nên lệnh ghi sau gần như chắc chắn không tới. Chỉ khác là trước đây có thể còn kịp trong vài giây, giờ thì không.

**Đề xuất cho F2 (UP-3, tùy owner chọn):**
- (a) Sửa instructions. Nếu một PATCH chuyển stage nhận 422 thì đừng ghi thêm, vì run đã kết thúc. Bỏ câu "PATCH một lần nữa" ở integrator. Thay vào đó, ghi bằng chứng đúng **trước** khi PATCH.
- (b) Trong Crew, ở `agent.run.cancelled` với `errorCode=issue_reassigned`, nếu issue vẫn giao cho chính agent đó (handoff không xảy ra) thì ghi comment hệ thống nêu lý do và đánh thức lại agent một lần. Có thể làm cùng kiểu với `handoff-rewake.ts`.
- Nên có ít nhất một test route: PATCH done → H2 422 → kiểm trạng thái run và issue.

**Các phần ghi phía server không dùng token agent (đã xác nhận):**
- `handoff-rewake.ts`: dùng `db` và `logActivity` với `actorType: "system"`, rồi gọi `heartbeatService.wakeup`.
- `remote-stop.ts`: dùng SSH, `logActivity` và `environmentService.releaseLease`.
- `load-gate.ts`: comment `authorType: "system"`. `neverStartedCancelOptions` ghi `executionCancellation.state = "acknowledged"`, không phải `requested`, cho run chưa từng chạy.
- `bundle-resume.ts`: chỉ dùng `db`.
- Plugin `run-cancelled.ts`: gọi `ctx.issues.update` và `createComment` mà không có `actorAgentId`/`actorRunId`, nên `assertAgentRunWriteAllowed` bỏ qua (`issues.ts:10909`).
- `crew-mac` (repo Crew) không dùng `PAPERCLIP_API_KEY`.

## 2. `claimQueuedRun` bắt lỗi mới

**Kết luận:** ngữ nghĩa không đổi.

- H1 nằm ở `heartbeat.ts:17249`. Khi trả `true` thì `return null`.
  - Vòng claim (`:20059-20073`) chỉ đưa vào `claimedRuns` khi có kết quả, nên run vẫn `queued`.
  - `executeRun` (`:20215-20220`) cũng `return` khi nhận `null`.
- Lỗi mới chỉ được bắt khi là `HttpError`:
  - 403 thì cancel với `queued_run_claim_rejected`;
  - 4xx khác thì giữ run `queued` (`:19902-19914`).
- H1 không bao giờ ném lỗi:
  - `crewBeforeClaim` có try/catch (`load-gate.ts:706-719`). Run retry hoặc run còn marker never-started thì fail closed, còn lại fail open.
  - `applyBundleResumeSafely` có try/catch và trả `"skipped"` (`bundle-resume.ts:339-348`). Lỗi DB trong bundle-resume vẫn fail open.
- Wake của `handoff-rewake` dùng `requestedByActorType: system` và `triggerDetail` của wake bị skip. Đó không phải manual wake, nên không chạm 403 của `explicitOperatorRunIdentity`. Issue Crew luôn có `responsibleUserId`, nên cũng không gặp 422 `responsible_user_unresolved` (`heartbeat.ts:11061-11079`).

## 3. Các điểm Crew phụ thuộc

**H1–H5, P1–P4:**
- `check-core-hooks.mjs` báo `5/5; mục 9; lỗi 0`.
- Các dòng `+/-` của Crew trên 6 file lõi **giống hệt từng dòng** giữa `v2026.1001.0..703ddfa02` và `v2026.1005.0..HEAD` (đã so bằng diff).
- Số `crewCoreHooks` trong `issues.ts` vẫn là 3, nên điều kiện `inspect-image.sh` vẫn đúng.

**H2:** vẫn là dòng đầu `runUpdate`, chạy trước khóa dòng và trước `assertAgentRunWriteAllowed`. `actorRunStopId` được tách ra trước `patch` (`issues.ts:10632`), nên `patch` mà H2 nhận không chứa key lạ.

**H3:**
- SSH driver vẫn chỉ có `releaseRunLease` (không có `destroyRunLease`), nên H3 vẫn được gọi.
- Nhánh `stop_and_retain` mới chỉ áp cho driver `sandbox`.
- Nhánh `keep_running` + `reuse_by_environment` bỏ qua driver như trước. Nó đã có từ 1001, không phải mới.

**H5:** route mới `instructions-bundle/candidates/:runId/resolve` và `restore` không ghi `adapterConfig` được bảo vệ. `connection-intents/.../adopt` cần board. Bộ lọc ở `agent-config-gate.ts:33-41` vẫn đủ.

**Plugin SDK/UI:**
- `slots.tsx` chỉ nạp module của plugin có slot khớp. `PluginSlotMount` có thêm `componentProps`/`fallback`.
- `bridge.ts` và `bridge-init.ts` không đổi. Phần rewrite bare specifier (`slots.tsx:257-380`) không đổi.
- `IssueDetail.tsx` không đổi các dòng `PluginSlot`.
- `routes/plugins.ts`, `plugin-ui-static.ts`, `plugin-loader.ts`, `plugin-host-services.ts` và `plugin-database.ts` không đổi giữa hai tag. Vì vậy bind `string_to_array($n, ',')` và webhook route giữ nguyên.

**Callback bridge:** allowlist không đổi. Diff chỉ đụng phần upload file tạm.

**claude-local:**
- `canResumeSession` và `hasMatchingMcpServers` không đổi (`execute.ts:775-790`). `runtimeMcpIdentity` vẫn là `JSON.stringify({name,url,connectionId}[])` (`:551`), nên `bundle-resume.ts:163-184` vẫn khớp.
- Prompt giờ dựng trong `runAttempt`:
  - `selectPaperclipPromptSections` tương đương `selectPaperclipTaskMarkdown` cộng `renderPaperclipWakePrompt` cũ (`adapter-utils/src/server-utils.ts:2226-2246`);
  - khi resume vẫn dùng prompt delta.
- P2 `in_place` vẫn có `syncWorkspace: false`. `collectBeforeRestore` chạy trước restore, mà `in_place` không có restore.

**Execution policy:** `issue-execution-policy.ts`, `execution-policy-bootstrap.ts` và `issue-review-policy.ts` không đổi (theo UP-1). Self-stop khi đổi người đã có từ 1001; bản mới chỉ thêm `issueMutationStopId`.

**Auth/exposure:**
- `config.ts` chỉ tách hàm `resolveDeploymentMode`, cùng logic: env, rồi file, rồi `local_trusted`.
- `server/src/auth/**` không đổi. Cookie `__Secure-` và trusted origins vẫn như cũ.
- `routes/auth.ts` chỉ thêm `sentryEnvironment`.

**Recovery:** `successfulRunHandoffRetried` mới gắn `retryOfRunId`. Run retry này vẫn đi qua load-gate (fail closed) và `retry-progress` như mọi retry.

### F1 (major) — `apply-roles.sh` hỏng vì upload instructions cần base

**Thay đổi upstream:**
- `PUT /agents/:id/instructions-bundle/file` cho **entry file** (mặc định là `AGENTS.md`, `services/agent-instructions.ts:10`) giờ bắt buộc có `baseRevisionId` hoặc `baseHash`. Nếu thiếu thì trả 422 `INSTRUCTION_BASE_REQUIRED` (`server/src/routes/agents.ts:5198-5202`).
- Schema giờ là `.strict()`, có thêm hai trường này (`packages/shared/src/validators/agent.ts:36-42`).
- Bản 1001 không có nhánh này.

**Phía Crew:**
- `crew/agents/apply-roles.sh:58` gửi body do `render-instructions.mjs:33` tạo, chỉ có `{path:"AGENTS.md", content}`.
- `verify-result.mjs` thấy trường `error` nên `die`. Lúc đó PATCH `extraArgs` (`:57`) đã chạy rồi, nên vai trò chỉ được áp một nửa.
- Test `crew/agents/*.test.mjs` không gọi server nên vẫn xanh.

**Kịch bản:** UP-3 hoặc owner sửa `executor.md` rồi chạy `apply-roles.sh agent <id> executor <pin>` trên server mới. Kết quả là die và AGENTS.md không đổi.

**Đề xuất sửa:**
- Trong nhánh `agent` của `apply-roles.sh`, trước PUT:
  1. Gọi `GET /agents/$AGENT/instructions-bundle/file?path=AGENTS.md`.
  2. Lấy `contentHash`. Nếu GET trả lỗi hoặc file chưa có thì dùng `null`.
  3. Thêm `"baseHash": <hash|null>` vào body. Route đổi `baseHash` thành token bằng `agentFileTokenFromHash`, khớp với `currentRow.id = agentFileToken(bytes)` (`agent-file-store.ts:56-61`, `agent-instruction-revisions.ts:155-166`).
- Nên làm `render-instructions.mjs` nhận thêm tham số base, hoặc ghép bằng node trong `apply-roles.sh`.
- Thêm test cho `verify-result.mjs` với 409 `INSTRUCTION_REVISION_CONFLICT`.
- Nên chạy thử một lần trên project restore ở UP-4 hoặc khi nghiệm thu, vì nội dung giống hệt sẽ trả `changed:false` (`agent-instruction-revisions.ts:272-275`).

## 4. Title có thể bỏ trống khi có description

**Kết luận:** không hỏng hiển thị. Có một điểm phụ (F3).

- DB không bao giờ lưu title rỗng. `create` lấy 120 ký tự đầu của description làm title tạm và đặt `titleNeedsGeneration` (`services/issues.ts:9759-9766`). Cột `title` vẫn `notNull`.
- Plugin dùng `issue.title` ở `ui/map/ticket-node.tsx:33-34`, `ui/page.tsx:24` và `handlers/map.ts:53`. Title tạm vẫn hiển thị được, chỉ có thể là đoạn đầu description (ví dụ dòng marker `crew-…`).
- Instructions đều gửi `title` khi tạo con: `executor.md:20`, `integrator.md:21`, `assistant.md:82`. H4 không đọc `title`.
- Chú ý: khi `allowDuplicate === false` và title được gửi tường minh thì dedupe theo title (`:9765`). Hành vi này không đổi với Crew, vì assistant dùng `idempotencyKey`.

**F3 (minor).**
- Issue có `titleNeedsGeneration` (ví dụ owner tạo issue gốc chỉ bằng mô tả) sẽ nhận chỉ thị trong prompt: gọi `PUT /api/issues/<id>/title` (`heartbeat.ts:8738-8744`).
- Route này **không có** trong `DEFAULT_SANDBOX_CALLBACK_BRIDGE_ROUTE_ALLOWLIST` (`packages/adapter-utils/src/sandbox-callback-bridge.ts:124-226`). Nếu run SSH đi qua bridge thì lệnh này bị "Route not allowed".
- Assistant đang được dặn "không bỏ qua lỗi curl", nên có thể dừng.

Đề xuất:
- Thêm vào `assistant.md` một câu: lỗi ở bước đặt title thì bỏ qua và làm tiếp.
- Hoặc chỉ dùng tool `set_task_title` nếu có.
- Ở Cổng 4, kiểm thử bằng một issue gốc tạo không có title.

## 5. `verify.sh` mới

- Có chạy đủ phần Crew chính:
  - vitest server với `src/__tests__/crew-`, `src/crew/` và `plugin-loader`;
  - adapter `*.crew.test.ts` và `execute.remote.test.ts`;
  - plugin (`vitest.config.ts`);
  - `node --test crew/agents/*.test.mjs`;
  - typecheck 3 package, build plugin, và kiểm `require("react` (`crew/release/verify.sh:33-50`).

**F4 (minor):**
- Không chạy `crew/release/upgrade.test.mjs`, `crew/ops/compose-set-image.test.mjs` và `crew/ops/pull-backup.test.mjs`. Nên thêm `run 3 node --test …` cho 3 file này.
- `run 4 corepack pnpm install` không có `--frozen-lockfile`, nên lockfile lệch có thể bị sửa im lặng thay vì làm verify đỏ. Nên dùng `--frozen-lockfile`. UP-1 đã commit importer, nên giờ chạy được.
- Không kiểm file `._*` trong `dist`. `inspect-image.sh` đã kiểm việc này cho image, nên chấp nhận được.

**Lần chạy:**
- Load lúc bắt đầu `{ 5.98 10.76 11.23 }`, dưới 12. `ipcs -m` có 5 segment.
- Chạy `bash crew/release/verify.sh` từ gốc worktree, lúc 08:39–khoảng 08:50. Kết quả **XANH, exit 0**.

| Bước | Kết quả |
|---|---|
| check-core-hooks | 5/5 hook, 0 lỗi |
| Test check-core-hooks / plugin-state / policy-config | 9/9, 5/5, 8/8 |
| vitest server | 20 file, 384 test |
| vitest claude-local | 3 file, 17 test |
| vitest `@crew/paperclip-plugin` | 15 file, 30 test (UP-1 ghi 14/27, có thể đếm trước khi thêm test) |
| `crew/agents` | 61/61 |
| tsc 3 package, build plugin, no_bare_react_require | đạt |

- `git status` sau khi chạy vẫn sạch.

## Đã kiểm, không vấn đề

- Self-stop PATCH vẫn ghi được, kèm comment trong body. Instructions không ghi gì sau PATCH chuyển stage ở happy path.
- `handoff-rewake`, `remote-stop`, `load-gate`, `bundle-resume` và plugin `run-cancelled` không dùng token agent.
- H1 trả `true` vẫn giữ run `queued`. Lỗi trong load-gate và bundle-resume vẫn không thoát ra ngoài (fail open hoặc closed như thiết kế).
- Delta Crew trên lõi giống hệt bản trước. Vị trí và ngữ nghĩa H1–H5, P1–P4 đúng.
- Plugin SDK/UI, bridge, rewrite bare specifier, plugin-database, webhook route và callback bridge allowlist đều không có thay đổi gây hỏng.
- Resume claude-local và `mcpServerIdentity` khớp `bundle-resume.ts`.
- Auth/exposure, cookie `__Secure-` và trusted origins không đổi.
- Sự kiện `agent.run.cancelled` không đổi payload.

## Câu hỏi còn mở

- Với F2, owner chọn (a) chỉ sửa instructions, hay (a)+(b) có thêm Crew re-wake?
- Run SSH của Crew gọi API trực tiếp qua domain hay qua callback bridge? Câu này quyết định F3 có xảy ra thật không.

Status: DONE_WITH_CONCERNS
Summary: Nhánh sync giữ nguyên các hook và patch Crew, verify.sh XANH. Phát hiện một lỗi major: apply-roles.sh bị 422 vì upstream bắt buộc baseHash khi upload AGENTS.md. Có thêm ba điểm minor: 403 sau lối 422 khi run đã tự hủy, route title ngoài allowlist, và verify.sh còn sót test.
Concerns/Blockers: F1 cần sửa ở UP-3 trước khi phải chạy lại apply-roles.
