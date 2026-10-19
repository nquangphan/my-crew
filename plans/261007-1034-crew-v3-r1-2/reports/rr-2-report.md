# Báo cáo RR-2 — retry sau mất kết nối kiểm commit trước khi chạy lại

- Worktree: `.worktrees/paperclip-r12-retry`, nhánh `crew/r12-retry` (trên RR-1 `68bf8128d`).
- Commit: `d5630e6f5` — `feat(crew): tell a retried run which commits its lost predecessor already made`.

## File đổi

- `server/src/crew/retry-progress.ts` (mới): `RETRY_PROGRESS_TIMEOUT_MS`, `RETRY_SINCE_SLACK_MS`, `RetryCommit`, `RetryProgress`, `RetryProgressSshRunner`, `buildRetryProgressCommand`, `parseRetryCommits`, `retryProgressComment`, `createRetryProgressChecker`.
- `server/src/crew/load-gate.ts`: `BeforeClaimDeps` thêm `retryChecked`, `checkRetryProgress`, `recordRetryProgress`; nhánh `claim` của `evaluateBeforeClaim` kiểm tiến độ retry, lỗi thì đi tiếp vào nhánh `wait`/`expire` với lý do `kiểm tiến độ lần chạy trước lỗi: …`; `defaultBeforeClaimDeps` cài ba dep (comment `Crew: lần chạy lại` chỉ khi có commit, rồi activity `crew.retry_progress.checked`).
- `server/src/__tests__/crew-retry-progress.test.ts` (mới): 4 test thuần + 5 test embedded PG.
- `server/src/__tests__/crew-load-gate.test.ts`: dep mặc định trong `harness`, `retryHarness`, 6 test retry.

## Lệnh test

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-retry-progress.test.ts   # trước khi có file: FAIL không load được module
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts        # trước sửa cổng: 4 failed | 24 passed
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts src/__tests__/crew-retry-progress.test.ts src/__tests__/crew-before-claim.test.ts src/__tests__/crew-remote-stop.test.ts
 Test Files  4 passed (4)
      Tests  68 passed (68)
corepack pnpm --filter @paperclipai/server exec tsc --noEmit   # exit=0
```

Phần DB (Step 8) dựng được trên embedded PG, **không** dời sang Cổng 4: seed company, agent, issue, environment `ssh` (config không secret nên `resolveEnvironmentDriverConfigForRuntime` không cần secret), run trước `startedAt = 2026-10-07T09:15:00Z`, lease `metadata.remoteCwd`, run retry. Kiểm: lệnh `git -C '/Users/a/crew-agents/mac-claude' log --since='2026-10-07T09:14:30.000Z' …` đi tới đúng host; git thoát 128 trả `error` với stderr; không có lease thì `none`; `recordRetryProgress` thật ghi đúng một comment `Crew: lần chạy lại…` + activity có danh sách sha, `retryChecked` chuyển `true`; không có commit thì không comment.

Cổng 4 của AC-2 vẫn cần kiểm SSH thật tới Mac mini (git log trong worktree agent, kịch bản mất mạng S3).

## Giả định

- Lỗi DB ở `retryChecked`/`checkRetryProgress` trước khi cổng quyết giữ run: `checkRetryProgress` bắt mọi lỗi thành `error` (giữ run); `retryChecked` ném thì `crewBeforeClaim` fail open như mọi lỗi DB khác của cổng hiện nay (xem ruling).
- Đường `remoteCwd` có ký tự xuống dòng bị từ chối như đường tương đối (lỗi → giữ run).

## Lệch plan

- Plan ghi "PASS (5 test)" cho Step 4, nhưng khối test Step 1 chỉ có 4 test; số đúng là 4 test thuần, cộng 5 test DB ở Step 8.
- `createRetryProgressChecker` nhận `RetryProgressSshRunner` có kiểu `SshConnectionConfig` (lấy từ `Parameters<typeof runSshCommand>[0]`) thay cho `config: unknown` + ép `as unknown as` — bỏ được cast, test DB kiểm `config.host`.
- Tên test trong `crew-load-gate.test.ts` viết tiếng Anh cho đồng bộ với file; thêm test "expires a retry whose progress check keeps failing past maxWaitMinutes" ngoài plan (Review Focus 4: hết hạn chót thì hủy và `blocked`).
- Tên environment trong seed DB có hậu tố id vì `environments.name` là unique.

## Sửa sau review

Review: [rr-review.md](rr-review.md), RR-2 CHANGES_REQUESTED. Sửa trong một commit **`2ae7d77c3`** — `fix(crew): never claim a retry blind and stop its predecessor before reading commits` (trên `d5630e6f5`). File: `server/src/crew/{load-gate,retry-progress}.ts`, `server/src/__tests__/{crew-load-gate,crew-retry-progress}.test.ts`.

| Mục | Sửa |
|---|---|
| M1 | Lỗi đọc/ghi marker kiểm (`retryState`, `recordRetryProgress`) đi vào nhánh chờ có mốc + hạn chót (lý do `kiểm tiến độ lần chạy trước lỗi: …`). Catch của `crewBeforeClaim` trả `true` cho run `queued` có `retryOfRunId` (log `failed closed for a retry`), run thường vẫn fail open. Lỗi ở `loadTarget`/`firstNoticeAt` trước nhánh retry rơi vào catch này nên chỉ giữ run một tick; tick có DB thì mốc + hạn chót được ghi. |
| M2 | `buildRetryProgressCommand(previousRunId, cwd)` = `buildRemoteStopCommand(previousRunId, cwd) && echo "crew-retry-clock $(date +%s)" && git -C … log …` trong một lệnh SSH. `parseRetryProgressOutput` đọc dòng tổng kết bằng `parseRemoteStopOutput`; thiếu dòng tổng kết, `remaining > 0`, thiếu giờ Mac, hoặc lệnh thoát khác 0 → `error` → giữ run. `RETRY_PROGRESS_TIMEOUT_MS = REMOTE_STOP_TIMEOUT_MS + 5_000` = 17 giây. |
| M3 | `git log --branches --source --format='%H%x09%ct%x09%cI%x09%S%x09%s' -n 50`; `RetryCommit.branch`; comment ghi `- <sha8> (<nhánh>) <tiêu đề>`. |
| m3 | Bỏ `--since`; lọc `ct >= startedAt + (giờ Mac − điểm giữa giờ VPS quanh lệnh SSH) − 30 giây`. |
| m1 | Retry: activity `crew.retry_progress.checked` ghi **trước** (details có `comment` khi có commit và có issue), rồi comment + marker `crew.retry_progress.comment`; còn `checked` mà thiếu marker comment thì tick sau chỉ thử lại comment, không SSH. Cổng tải và retry: trước khi `addComment` kiểm issue đã có comment bắt đầu bằng prefix riêng của run (`Run \`<id>\` đang chờ máy` / `đã chờ máy` / `Crew: lần chạy lại sau run \`<prev>\``) thì không đăng lại. |
| m4 | Comment ghi lý do từ `contextSnapshot.retryReason` (bảng chữ cho `transient_failure`, `missing_issue_comment`, `workspace_busy`, `ai_connection_busy`, `max_turns_continuation`, `interaction_continuation_infra_retry`; mã lạ ghi nguyên văn; thiếu thì "không rõ"), câu chung "run đó dừng giữa chừng". Vẫn bắt đầu bằng `Crew: lần chạy lại`. |
| m6 | Comment hết hạn của run có `retryOfRunId` thêm câu: Crew chưa kiểm và báo được commit của run trước, chạy `git log --branches` trong worktree agent trước khi chuyển `todo`. |
| m7 | Dùng `shellQuote` của `@paperclipai/adapter-utils/ssh`. |
| m2, m5 | Không sửa, ruling chấp nhận trong ledger. Riêng m2: dedupe theo prefix comment (m1) cũng làm hai claim song song không ra hai comment; vẫn có thể SSH/ghi activity hai lần. |

**RED** (bản nguồn `d5630e6f5`, test mới):

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts src/__tests__/crew-retry-progress.test.ts
 Test Files  2 failed (2)
      Tests  22 failed | 28 passed (50)
```

**GREEN:**

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts src/__tests__/crew-retry-progress.test.ts src/__tests__/crew-before-claim.test.ts src/__tests__/crew-remote-stop.test.ts
 Test Files  4 passed (4)
      Tests  81 passed (81)
corepack pnpm --filter @paperclipai/server exec tsc --noEmit   # exit=0
```

Thêm một lần chạy tay chuỗi lệnh sinh ra bằng `/bin/sh` trên repo thử trong scratchpad (HOME tạm, run id giả nên chỉ chạy fallback, không khớp process nào): in `crew-stop … via=fallback`, `crew-retry-clock <epoch>`, các commit kèm nhánh, thoát 0; thư mục không tồn tại thì thoát 128.

**Ảnh hưởng gói khác:**
- `roles` (RO-1): comment giờ là `Crew: lần chạy lại sau run \`<id>\` (bắt đầu …), run đó dừng giữa chừng, lý do: …`, mỗi commit có `(<nhánh>)`. Câu "mất kết nối" trong `roles.md` dòng ~141 nên đổi thành "dừng giữa chừng" (file của gói `roles`, em không sửa).
- Interface thêm activity `crew.retry_progress.comment`. `crew.retry_progress.checked` đổi `details.commits` thành `[{ sha, branch }]` và có thêm `details.comment`.
- Cổng 4 của AC-2: lệnh kiểm giờ gọi `crew-mac stop-run` cho run trước trước khi đọc git; kiểm trên Mac mini rằng nó không đụng run đang chạy khác.

## Sửa sau re-review

Re-review (mục "Re-review" của [rr-review.md](rr-review.md)): RR-2 APPROVE, còn 4 minor. Sửa n1–n3 trong commit **`8b800e395`** — `fix(crew): include a detached HEAD, flag a cut commit list and only dedupe system comments` (trên `2ae7d77c3`). File: `server/src/crew/{retry-progress,load-gate}.ts`, `server/src/__tests__/{crew-retry-progress,crew-load-gate}.test.ts`.

| Mục | Sửa |
|---|---|
| n1 | `git -C … log --branches HEAD --source …`: commit trên HEAD tách (rebase dở, checkout sha) có nhãn nguồn `HEAD`. |
| n2 | `parseRetryProgressOutput` trả `truncated` = git trả đủ 50 dòng và commit cũ nhất vẫn trong cửa sổ; `RetryProgress.checked.truncated`, activity `checked` có `details.truncated`. Comment: "Có [ít nhất ]N commit trong worktree kể từ khi run trước bắt đầu (`<cwd>`, mọi nhánh local, có thể gồm nhánh của việc khác)", khi bị cắt thêm "danh sách bị cắt ở N commit mới nhất, xem thêm bằng `git log --branches HEAD`". Bỏ câu "Run đó đã có N commit". Không làm phần "đưa nhánh `crew/<identifier>` lên đầu" (không có trong yêu cầu của lead). |
| n3 | `hasCommentWithPrefix` chỉ tính comment `authorType = 'system'`, `authorAgentId`/`authorUserId` null, `deletedAt` null. |
| n4 | Không sửa, ruling chấp nhận trong ledger. |

**RED** (test mới trên nguồn `2ae7d77c3`):

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-retry-progress.test.ts src/__tests__/crew-load-gate.test.ts
 Test Files  1 failed | 1 passed (2)
      Tests  6 failed | 47 passed (53)
```

**GREEN:**

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts src/__tests__/crew-retry-progress.test.ts src/__tests__/crew-before-claim.test.ts src/__tests__/crew-remote-stop.test.ts
 Test Files  4 passed (4)
      Tests  84 passed (84)
corepack pnpm --filter @paperclipai/server exec tsc --noEmit   # exit=0
```

Chạy tay lệnh sinh ra trên repo thử có HEAD tách (scratchpad, HOME tạm, run id giả, chỉ đi fallback): commit `detached` có nhãn `HEAD`, nằm cùng các commit trên `crew/ABC-1` và `main`, thoát 0. Test n1 trong suite chỉ kiểm chuỗi lệnh, phần chạy git thật để Cổng 4.
