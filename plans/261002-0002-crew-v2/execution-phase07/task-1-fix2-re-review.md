# Task 1 FIX2 re-review (web phase07)

Phạm vi: chỉ diff `task-1-fix1-baseline/` -> HEAD 8dcfa28 (2 file: `v2/web/scripts/e2e-fixture.ts`, `v2/web/test/fixture-lifecycle.test.ts`) và log FIX2. Không chạy lại test.

## Finding Verdicts

- **I1 (cleanup có hạn, không destructive sau UNKNOWN): ADDRESSED.** `v2/web/e2e/support/fixture.ts:35-55` `boundedCleanupStep` gọi `controller.abort()` tại deadline rồi reject `CleanupDeadline`; `closeOwnedResource` (:87-91) trả `unknown('REMOVE_DEADLINE')`. Nay callback scratch tôn trọng signal: `v2/web/scripts/e2e-fixture.ts:89-101` `createScratchRemoval` kiểm `signal.aborted` ngay sau `await port.stat` và trước identity check/`rm`; production dùng chính helper (:428). Khoảng hở duy nhất FIX1 còn để lại đã đóng. Các remove DB/Docker đã kiểm abort từ FIX1 (không đổi trong diff này).
- **F1 (scratch `remove` bỏ qua AbortSignal): ADDRESSED.** Bằng chứng: test mới `test/fixture-lifecycle.test.ts` (case "scratch REMOVE hết hạn rồi stat trả trễ") dùng chính `createScratchRemoval` với `stat` bị trì hoãn qua deadline 250ms, nhả `stat`, khẳng định `removeCalls === 0` và registry còn. RED trên hành vi cũ: `task-1-fix2-red.log` fail `1 !== 0` tại test:214 (đúng lý do); GREEN focused `task-1-fix2-green-focused.log` pass 1/1; final `task-1-fix2-lifecycle-final.log` 6/6 pass (case này 252ms), typecheck exit0. Test `finally` chỉ xóa scratch tự tạo sau khi kiểm dev:ino, an toàn.
- **M1 (Minor, falsy rejection trong withFixture): STILL DEFERRED.** `e2e/support/fixture.ts:112-115` vẫn dùng `if (runError && cleanupError)` / `if (runError)` — không đổi, đúng ruling PM; không chặn.

## New Breakage in the Fix Diff

Không có.
- Việc export `createScratchRemoval` và import `scripts/e2e-fixture.ts` từ test không có side effect: entrypoint được bọc `process.argv[1] === import.meta.url` (e2e-fixture.ts:629).
- Hành vi `stat` ném lỗi (ENOENT) vẫn lan ra `step` -> `CLEANUP_ERROR` -> UNKNOWN, giữ nguyên như trước.
- Biome: 2 warning là `noNonNullAssertion` tại e2e-fixture.ts:318 và :391, ngoài hunk của diff (hunk ở ~:74-110 và ~:418-428) -> không do fix. 29 info đều `useTemplate` (style, không chặn); vài cái nằm trong dòng mới (e2e-fixture.ts:97, test ~:158/:166/:224/:229) nhưng cùng pattern nối chuỗi `String(dev) + ':' + String(ino)` đã có khắp file, chỉ là info.

## Out-of-Scope Observations

- Như báo cáo FIX2 đã nêu: operation (`rm`/`docker rm`/DROP) đã được gửi TRƯỚC deadline mà mất phản hồi vẫn cần reconcile thủ công; fix chỉ chặn operation khởi chạy mới sau UNKNOWN. Chấp nhận được, đã ghi UNKNOWN.
- Kiểm abort là check-then-act; cửa sổ giữa `signal.aborted` và `rm` là đồng bộ (không có await xen giữa) nên không còn race trong Node đơn luồng.
- Info `useTemplate` có thể dọn riêng sau nếu PM muốn.

## Checks and Evidence

- Diff đọc đủ; logs: red / green-focused / lifecycle-final (6 pass, raw_exit=0) / typecheck-final (exit0) / biome-final (0 error, 2 warning, 29 info).
- Final checks báo SHA ba file khớp freeze FIX2 và cleanup độc lập sạch (container/port/tmp). Không chạy lại gì theo yêu cầu.
- Lưu ý nhỏ: final checks ghi HEAD 6040292, các commit sau (d3f092f, 8dcfa28) chỉ là docs; `git diff 6040292 HEAD -- v2` trống về source theo phát biểu của báo cáo (em chỉ đối chiếu qua diff package, không băm lại file).

## Verdict

All findings addressed (M1 vẫn hoãn theo PM).
