# Re-review vòng sửa 2 — web Task 2

Base `a69ea3b` → head `6c35218`. Phạm vi source đổi gồm `v2/web/src/lib/api.ts`, `v2/web/src/lib/pending-operation.ts`, `v2/web/test/client.test.ts` và flow `web-data`. Đọc delta một lần, không chạy lại test.

## Finding Verdicts

- **N1 (Important) — ADDRESSED.**
  - `api.ts:277-281`: operation có `pending.isResumed(id)` (`pending-operation.ts:290`) gặp bất kỳ 4xx nào lọt qua các nhánh trước đều đi `pending.conflict(id)`, tức trả về tombstone với key cũ và bỏ payload nhập sai. Nhánh `bodyDeterministic` không còn được xét cho operation resumed.
  - Thứ tự nhánh hợp lý:
    - 401 → `suspended` và giữ cờ resumed.
    - 409 `IDEMPOTENCY_CONFLICT` → `conflict`.
    - 403 stale → suspended, refresh rồi replay; cờ resumed vẫn giữ.
    - 4xx khác → tombstone.
    - 5xx/transport → ambiguous; một 4xx sau đó vẫn dẫn về tombstone.
  - Lưu ý: cờ `#resumed` chỉ sống trong memory, nên reload làm mất nó (xem New Breakage B1).
- **N2 (Minor, PM nâng vào vòng này) — ADDRESSED.** `api.ts:180-185` gọi `claim` rồi `deliver` trong `try/finally release`, dựa trên `pending-operation.ts:295-303`. Không có đường nào kẹt `#sending`:
  - `requireSession`/`OPERATION_UNKNOWN` ném **trước** `claim`, nên không có gì để release.
  - Mọi throw bên trong `deliver` đều đi qua `finally`: transport, abort, 401 + `expire()`, refresh lỗi, sleep bị abort (raw reason), conflict/reject.
  - Sau khi session hết hạn, vòng lặp ra khỏi `sleep` thì `requireSession` ném lỗi và `finally` chạy.
  - Lượt trùng nhận `OPERATION_IN_FLIGHT` (`local`), không gửi request và không đổi state.
- **N4 (Minor) — ADDRESSED.** `api.ts:266-272` kiểm `request.signal` trước và sau `refreshCsrf()`. Nếu đã abort thì chuyển `markAmbiguous`, ném `ABORTED/aborted`, không replay và giữ key. Refresh là single-flight dùng chung, không bị caller abort cắt ngang; chấp nhận được.
- **N3 (Minor) — vẫn HOÃN.** `session-boundary.tsx` không đổi trong delta. Operation bị giữ vì 403 vẫn hiện nhãn “Tạm dừng vì hết phiên”. Đã có trong ledger của PM.

## New Breakage

- **B1 — Minor — `pending-operation.ts:166,278-288,414-` (`#commit`/`parseRecord`): cờ resumed không được persist.**
  - Operation `storage:'tab'` tạo bằng `resume()` được ghi vào sessionStorage như một operation thường, còn `#resumed` chỉ nằm trong memory. Sau khi reload, `parseRecord` khôi phục nó thành operation `suspended`/`ambiguous` **không** còn cờ resumed.
  - Nếu lần gửi kế tiếp nhận 400/413/415, `uncertain && bodyDeterministic` dẫn tới `reject`, nhả key. Đây đúng là lỗ N1, chỉ là đi qua đường reload.
  - Cửa sổ hẹp: cần `resume`, rồi lần gửi lỗi trước khi tới server (transport) hoặc reload chen giữa `resume` và `mutate`, rồi reload, rồi payload nhập lại không hợp lệ. Vì vậy em xếp Minor.
  - **Fix:** persist `resumed: true` trong record (tăng `storageVersion` hoặc thêm field additive được `parseRecord` đọc), hoặc chỉ persist operation resumed dưới dạng tombstone cho tới khi có kết quả xác nhận, giống cách làm với operation memory.
- **B2 — Minor/UX — `session-boundary.tsx` (không đổi) và nhánh resumed → tombstone.** Panel hiện “Máy chủ từ chối yêu cầu (code)” vì `kept=false` sau khi operation đã thành tombstone, trong khi dòng tombstone ngay dưới vẫn còn. Câu chữ ngụ ý yêu cầu đã bị từ chối hẳn. Report cũng tự nêu; nên xử lý cùng nhóm với N3.

Không phát hiện breakage nào khác. `#sending` không cần dọn khi logout/`tombstoneAll`, vì request đang chạy bị abort theo epoch và `finally` sẽ release. Guard chỉ có hiệu lực trong một tab, nhưng sessionStorage cũng riêng cho mỗi tab nên không có lỗ cross-tab với operation tab.

## Out-of-Scope

- Vẫn chưa có cách bỏ một operation ambiguous hoặc một tombstone. Khi bị 4xx thật mà key gốc chưa bao giờ commit, tombstone hoặc ambiguous sẽ khóa intent vĩnh viễn trong tab. Cần chủ dự án quyết định UX, như đã ghi ở vòng 1.
- Các Minor trong review gốc chưa sửa vẫn còn trong ledger.

## Checks

- Đọc diff `a69ea3b..6c35218` (3 file web và flow doc). Truy lại mọi đường throw trong `deliver` so với `finally release`.
- Đối chiếu `parseRecord`/`#commit` để kiểm việc persist cờ resumed; tìm ra B1.
- Report ghi RED 3/19, GREEN 19/19, unit 46/46, E2E 3/3, tsc và Biome exit 0. Em chưa xác minh độc lập. Chưa có test cho tình huống reload giữa `resume` và lần gửi bị 400.

## Verdict

N1, N2 và N4 đều ADDRESSED; N3 vẫn hoãn theo ledger. Delta không có breakage mức Important. B1 là biến thể hẹp của N1 qua đường reload, nên vào ledger Minor hoặc sửa nhanh nếu PM muốn đóng hẳn lớp lỗi này.

**Task quality:** Approved (B1 và B2 là Minor, đưa vào ledger).
