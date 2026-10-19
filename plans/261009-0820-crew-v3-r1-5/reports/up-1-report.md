# UP-1 — Nâng fork lên Paperclip `v2026.1005.0`

Ngày 09/10/2026 (giờ Asia/Ho_Chi_Minh). Người làm: implementer UP-1 (Claude opus).

## Nhánh, worktree, HEAD

- Nhánh sync: `sync/paperclip-v2026.1005.0`, tách từ `v3` @ `703ddfa02`. Nhánh `v3` không bị sửa. Chưa push.
- Worktree: `/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-sync-1005`. Truyền `--worktree` để worktree không nằm trong `$TMPDIR`.
- HEAD: `cb760f611`. Các commit:
  - `deeea5338` chore(sync): merge Paperclip v2026.1005.0 into v3 (merge `467125faf`)
  - `e99ce6fb9` chore(sync): restore Crew lockfile importer
  - `cb760f611` chore(release): rebase core hooks on v2026.1005.0 and verify plugin and agents
- Cây làm việc sạch.

## Merge và xung đột

1. Lần chạy đầu `crew/release/upgrade.sh v2026.1005.0` dừng với `fatal: stash failed`, và không có file conflict nào. Script đã tự `merge --abort`.
   - Nguyên nhân không phải xung đột. Khi không chỉ định strategy, `git merge` của Apple Git 2.54.0 gọi `git stash create` để lưu trạng thái (thấy qua `GIT_TRACE`).
   - Trên cây sạch, lệnh `git stash create` này trả mã 1 (đã chạy tay để kiểm), nên merge chết.
   - Cách sửa: thêm `-s ort` vào lệnh merge trong `upgrade.sh`. Đây là sửa script Crew, không phải lõi.
2. Merge lại bằng `-s ort` thì chỉ `pnpm-lock.yaml` xung đột. Cả 6 file lõi có hook/patch đều tự merge sạch (`heartbeat.ts`, `issues.ts`, `environment-runtime.ts`, `agents.ts`, `claude-local execute.ts`, `index.ts`).
   - Xử lý lockfile đúng nhánh của script: lấy bản upstream (`--theirs`). Sau đó `pnpm install` trong verify thêm lại importer `packages/crew-plugin` (+96/−1 dòng) và được commit riêng.
3. Không phải đặt lại hook nào bằng tay, cũng không sửa lõi ngoài hook. `core-hooks.json` chỉ đổi `base` sang `v2026.1005.0`. Anchor, head và importLine giữ nguyên vì vẫn khớp, và checker vẫn kiểm điều kiện "lệnh đầu tiên của symbol".

## Vị trí 5 hook trên cây mới

| Hook | File:dòng | Symbol |
|---|---|---|
| H1 | `server/src/services/heartbeat.ts:17249` | `claimQueuedRun`, dòng đầu |
| H2 | `server/src/services/issues.ts:10898` | `update` → `runUpdate`, dòng đầu |
| H3 | `server/src/services/environment-runtime.ts:1220` | SSH driver `releaseRunLease` |
| H4 | `server/src/services/issues.ts:9742` | `create`, dòng đầu |
| H5 | `server/src/routes/agents.ts:540` | `router.use` ngay sau `Router()` |

- P1 nằm ở `environment-runtime.ts:1214`. P2, P3, P4 vẫn khớp anchor.
- Import nằm cuối file: `heartbeat.ts:30279`, `issues.ts:13405`, `environment-runtime.ts:4473-4474`, `agents.ts:7637`.
- Kết quả checker: `Hook một dòng: 5/5; mục: 9; lỗi: 0`, kèm 4 cảnh báo P1–P4 "chưa có PR upstream" như trước.

## Thay đổi `crew/release/verify.sh` (và `upgrade.sh`)

- `run 4 corepack pnpm --filter "@paperclipai/plugin-sdk..." build`: build `shared` và `plugin-sdk` trước khi build plugin.
- Vitest server thêm `src/crew/`. Trước đây `server/src/crew/crew-bundle-resume.cancelled.test.ts` (54 test) không nằm trong bộ lọc `src/__tests__/crew-`.
- `run 5 corepack pnpm --filter @crew/paperclip-plugin test`: vitest plugin.
- `run 5 node --test crew/agents/*.test.mjs`.
- `run 6 no_bare_react_require`: đọc `packages/crew-plugin/dist/ui/index.js`. Thiếu file hoặc grep thấy `require("react` thì bước này đỏ.
- Giữ nguyên hai bước đã có cho plugin: typecheck `tsc --noEmit` và `build`.
- `upgrade.sh`: đổi `git merge` thành `git merge -s ort` (lý do ở mục Merge).

## Kết quả verify

Đã chạy `bash crew/release/verify.sh` trọn vẹn trong worktree sync, kết quả **XANH**, exit 0.

| Bước | Kết quả |
|---|---|
| check-core-hooks | 5/5 hook, 0 lỗi |
| node test check-core-hooks / plugin-state / policy-config | 9/9, 5/5, 8/8 |
| pnpm install, ensure-build-deps, runner build:typescript, plugin-sdk... build | đạt |
| vitest server (`src/__tests__/crew-` + plugin-loader) | 19 file, 330 test đạt |
| vitest adapter-claude-local (3 file crew/remote) | 3 file, 17 test đạt |
| vitest `@crew/paperclip-plugin` | 14 file, 27 test đạt |
| `node --test crew/agents/*.test.mjs` | 61/61 |
| tsc server, adapter-claude-local, crew-plugin | đạt |
| build crew-plugin | đạt; `dist/ui/index.js` có, 0 file `._*` |
| no_bare_react_require | đạt (0 dòng) |

- Sau khi thêm `src/crew/` vào bộ lọc, em chạy lại riêng bước vitest server bằng đúng lệnh mới: 20 file, 384 test đạt.
- Lúc bắt đầu, load 1 phút là 21.5. Em chờ đến 8.87 rồi mới chạy.
- `ipcs -m` chỉ có 5 segment, không phải dọn.

## Thay đổi upstream `v2026.1001.0..v2026.1005.0` có thể đụng Crew

1. **Plugin SDK / manifest.**
   - Thêm `onEnvironmentStopLease` và `resourceDisposition: "stop_and_retain"` (`packages/plugins/sdk/src/define-plugin.ts:390`, `protocol.ts:665,1381`). Thêm `defaultAcquireTimeoutMs` cho environment driver (`packages/shared/src/validators/plugin.ts:187`). Thêm slot `organizationSwitcher` với capability `ui.sidebar.register` (`server/src/services/plugin-capability-validator.ts:167`).
   - Tất cả đều là trường hoặc method tùy chọn. Crew plugin không khai báo environment driver và không dùng slot mới, nên **không hỏng**. Typecheck và build plugin đều xanh.
2. **UI slots (`ui/src/plugins/slots.tsx`).**
   - `usePluginSlots` giờ chỉ nạp module của những plugin có slot khớp bộ lọc (`:694`). Trước đây nó nạp mọi contribution.
   - `PluginSlotMount` nhận thêm `componentProps` và `fallback` (`:876`). Error boundary có `key` theo plugin/version/slot.
   - Không đổi: cách mount `taskDetailView` và `detailTab` trong `ui/src/pages/IssueDetail.tsx` (diff không đụng các dòng slot `:3430`, `:7425`, `:8118`), `bridge.ts`/`bridge-init.ts` (bridge React), và phần rewrite bare specifier.
   - Kết luận: **không hỏng**. Tab và widget của Crew chỉ còn chờ module của chính nó. Vẫn nên kiểm trên trình duyệt ở Cổng 3.
3. **`server/src/services/plugin-database.ts`.**
   - Không đổi giữa hai tag (`git diff --quiet` rc=0). Cách bind `$n` mà Crew dùng với `string_to_array($n, ',')::uuid[]` (`packages/crew-plugin/src/handlers/map.ts:129,139`, `src/docs/data.ts:35`) giữ nguyên. **Không hỏng.**
4. **Webhook route plugin.**
   - `server/src/routes/plugins.ts` không đổi. Upstream có thêm `server/src/services/app-webhook.ts` và `fireflies-webhook.ts`, nhưng đó là luồng tích hợp app riêng, không thuộc `webhooks.receive` của plugin. **Không hỏng.** Năm ca 502/`failed` vẫn nên kiểm ở Cổng 2.
5. **Heartbeat.**
   - (a) Lỗi HttpError ném ra từ `claimQueuedRun` giờ được bắt (`heartbeat.ts:19906-19913`, vòng claim ~`:20058`). Lỗi 403 thì cancel run với `queued_run_claim_rejected`. Lỗi 4xx khác thì để run queued và chạy tiếp hàng đợi.
     - Ảnh hưởng: nếu H1 `beforeClaim` (load-gate/bundle-resume) ném HttpError 4xx, run sẽ không làm kẹt hàng đợi nữa. Một lỗi 403 từ H1 thì sẽ **cancel run**.
     - Hiện Crew giữ run bằng cách trả `true`, không ném lỗi, nên **không hỏng**. Ghi lại để UP-2 soát `load-gate.ts`.
   - (b) Resume session: `resumeSessionParams` và `forceFreshSession` trong heartbeat có cùng số lần xuất hiện ở hai tag (3 và 20). Phần mới (warm instruction copy theo `taskSessionForRun.lastRunId`) chỉ cộng thêm. Test `crew-bundle-resume` và `crew-claim-resume-contract` xanh.
   - (c) `issue_reassigned`: code `stopTaskForReassignment` chỉ thụt lề lại, giữ `errorCode: "issue_reassigned"`, `suppressImmediateRecovery`, `reassignmentStopConfirmed`. Test `crew-bundle-resume.cancelled` (54) xanh.
6. **Execution policy.**
   - `issue-execution-policy.ts`, `execution-policy-bootstrap.ts`, `issue-review-policy.ts` không đổi.
   - Lưu ý: `createIssueSchema` và `createChildIssueSchema` cho phép **bỏ `title`** nếu có description (`packages/shared/src/validators/issue.ts:787-816`, `requireTitleOrDescription` `:793`). Có thêm route đặt tiêu đề (`setIssueTitleSchema`).
   - H4 `beforeIssueCreate` không đọc `title` (đã grep `server/src/crew/issue-create-policy.ts`). Phải tự kiểm: chỗ nào trong Crew plugin/map hiển thị tiêu đề rỗng.
7. **Adapter claude-local.**
   - `canResumeSession` không đổi (`execute.ts:780-791`). `mcpServerIdentity` vẫn tham gia `hasMatchingMcpServers`, và `bundle-resume.ts:174-184` vẫn khớp.
   - Prompt giờ dựng lại trong từng `runAttempt` (`execute.ts:907`). Nhờ vậy khi resume thất bại và chạy lại phiên mới, prompt đầy đủ được dựng lại.
   - Thêm `createProviderStoppedBoundary` (`:400`), cùng hàm `collectBeforeRestore` chạy trước khi restore workspace.
   - **Bỏ biến môi trường `PAPERCLIP_WAKE_PAYLOAD_JSON`** cho claude_local. Nội dung wake vẫn đi qua prompt. `crew/**` không dùng biến này. Một bản `SKILL.md` paperclip cũ đã sinh trong `~/crew-agents/*/.paperclip-runtime` còn nhắc tới nó; bản skill hiện tại của upstream thì không. Em không sửa `~/crew-agents`.
   - Model mới `claude-opus-5-5` cần Claude Code ≥ 2.1.280 trên lane CLI (`cli-capabilities.ts:40`). Crew đang dùng `claude-sonnet-5`/`claude-opus-5` (`server/src/crew/model-policy.ts:6-9`) nên không bị ảnh hưởng. Mac đang có 2.1.294.
8. **Callback bridge allowlist (`packages/adapter-utils/src/sandbox-callback-bridge.ts`).**
   - Chỉ đổi upload sang đường dẫn tạm duy nhất theo `randomUUID` và dọn file khi lỗi (~`:704-737`). Allowlist route không đổi, `POST /api/companies/:id/issues` vẫn được phép. **Không hỏng.**
9. **Auth / exposure.**
   - `server/src/middleware/auth.ts:400`: run đã **cancelled**, hoặc đang có `executionCancellation.state = "requested"`, giờ bị chặn mọi request ghi bằng JWT của run đó (403 `agent_run_cancelled`). Trước đây chỉ chặn lượt chat bị hủy. Logic ở `server/src/agent-run-cancellation.ts`.
     - Ảnh hưởng Crew: agent đã bị cancel (load-gate, `remote-stop`, reassignment) không ghi comment hay issue được nữa. Đây là đúng ý đồ, nhưng **skill hoặc hook nào của Crew định ghi "dọn dẹp" bằng token của run đã cancel sẽ nhận 403**. Đề nghị UP-2 soát `handoff-rewake.ts` và `remote-stop.ts`.
   - Thêm route agent mới:
     - `instructions-bundle/candidates/:runId/resolve` (`agents.ts:5281`) và `instructions-bundle/restore` (`:5320`): ghi nội dung instructions, không ghi adapterConfig, nên H5 không cần chặn (giống `PUT .../instructions-bundle/file` đã có).
     - `connection-intents/:interactionId/adopt` (`:5373`): có `assertBoard`, agent không gọi được.
     - Bộ lọc đường dẫn của H5 (`server/src/crew/agent-config-gate.ts:34-39`) vẫn bao create, hire, PATCH, rollback.
   - `cloud-control.ts` và `http-log-redaction.ts` có đổi nhỏ, không liên quan Crew.

## Việc cho bước sau

- UP-2 nên soát hai điểm 5a (HttpError từ H1) và 9 (403 cho run đã cancel), vì có thể chạm luồng Crew. Hai điểm này không làm test đỏ.
- Bản sửa `upgrade.sh` (`-s ort`) mới nằm trên nhánh sync. Nhánh `v3` có được nó khi merge sync.
- Đóng worktree khi xong việc bằng `git worktree remove` (đường dẫn ở trên). Không có process nền nào còn chạy.
