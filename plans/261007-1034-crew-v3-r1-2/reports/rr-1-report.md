# Báo cáo RR-1 — H3 fallback khi stop-run thoát 2, mốc chờ bền của cổng tải

- Worktree: `.worktrees/paperclip-r12-retry`, nhánh `crew/r12-retry` (từ `v3` `e1c3dd2db`).
- Commit: `68bf8128d` — `fix(crew): fall back when crew-mac refuses a stop and keep the wait deadline durable`.

## File đổi

- `server/src/crew/remote-stop.ts`: script fallback khi launcher thoát 2/126/127; comment đầu file; `export function readRemoteCwd`.
- `server/src/crew/load-gate.ts`: `NoticeKind`; `BeforeClaimDeps` bỏ `postNotice`, thêm `recordNotice` (chỉ activity mốc) và `postComment` (comment rồi activity `crew.load_gate.<kind>_comment`); `evaluateBeforeClaim` ghi mốc trước, comment sau, thử lại comment chờ/hết hạn ở tick sau; `waitingBody`/`expiredBody` thuần (nội dung tiếng Việt giữ nguyên).
- `server/src/__tests__/crew-remote-stop.test.ts`: test fallback phủ exit 2, 126, 127.
- `server/src/__tests__/crew-load-gate.test.ts`: harness theo dep mới, sửa test cũ, thêm 5 test (mốc trước comment, thử lại comment chờ, thử lại comment hết hạn, ghi mốc lỗi, comment lỗi).

## Lệnh test

```
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-remote-stop.test.ts   # trước sửa: 1 failed | 26 passed
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts     # trước sửa: 7 failed | 15 passed
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-load-gate.test.ts src/__tests__/crew-before-claim.test.ts src/__tests__/crew-remote-stop.test.ts
 Test Files  3 passed (3)
      Tests  53 passed (53)
corepack pnpm --filter @paperclipai/server exec tsc --noEmit   # exit=0
```

`crew-before-claim` chạy thật trên embedded PG (macOS), không bị skip.

## Giả định

- Comment hết hạn khi đã có mốc `expired` (tick sau) dùng `expiredBody` không có phần `(detail)` vì lý do lúc hết hạn không còn trong tay; test kiểm không có `()` thừa.
- Đọc marker `_comment` (`firstNoticeAt`) nằm trong `logFailure`: lỗi DB lúc đó chỉ log, run vẫn bị giữ.

## Lệch plan

- `crew-before-claim.test.ts` không cần sửa: dep vẫn tên `firstNoticeAt`, test đã trả mốc cho `"waiting"` và `null` cho kind khác; kiểu `NoticeKind` rộng hơn nên vẫn compile. Không commit file này.
- Tên test mới viết tiếng Anh cho đồng bộ với các test có sẵn trong file (plan đưa tên tiếng Việt); nội dung kiểm giống plan.
- Thêm 2 test ngoài plan: "keeps the run queued when writing the waiting marker fails" và "retries a failed expiry comment while retrying the cancel".
- Lệnh vitest/tsc chạy bằng `corepack pnpm exec` trong `server/` (tương đương `--filter @paperclipai/server exec`).
