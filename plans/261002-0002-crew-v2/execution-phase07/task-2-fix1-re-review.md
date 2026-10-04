# Re-review vòng sửa 1 — web Task 2

Base `2b958b8` → head `a69ea3b`. Chỉ xét `v2/web/**` và `v2/docs/flows/web-data.md`, bỏ qua mọi thay đổi docs khác. Đọc delta một lần, gồm `api.ts`, `session.ts`, `session-boundary.tsx`, flow doc và tên các test mới. Không chạy lại test.

## Finding Verdicts

**I1 — `api.ts:210-213` (403 CSRF/ORIGIN nhả key): ADDRESSED.**

- **403 CSRF/ORIGIN:** `api.ts:250-258`. `staleCredential` (`api.ts:93-96`) chuyển operation sang `markSuspended`, gọi `refreshCsrf()` đúng một lần nhờ cờ `refreshed`, rồi replay cùng key/body (`attempt--`). Nếu lần sau vẫn 403, operation giữ `suspended` và vẫn còn key. Nếu refresh gặp 401 hoặc owner khác, `session.ts:312-326` gọi `expire()`; hook `suspendAll` giữ key. Nếu refresh lỗi transport thì ném `SESSION_REFRESH_FAILED`, operation vẫn `suspended`. Multi-tab không còn bị kẹt: `GET /v2/auth/session` trả về CSRF của cookie hiện tại (`server auth/routes.ts:141-145`).
- **Phân loại 4xx còn lại:** `api.ts:179,206,222,236,260`.
  - `uncertain` bắt đầu bằng `current.state !== 'pending'`. Nhờ vậy operation đang ambiguous/suspended, operation reload (`parseRecord` đổi `pending` thành `ambiguous`) và operation `resume` (`suspended`) đều được tính là có thể đã commit.
  - Trong một lượt gọi, transport error, 2xx không đọc được và 5xx đều bật `uncertain`.
  - 403 stale **không** bật `uncertain`. Đúng, vì `requireOwner` chặn request trước khi vào mutator.
  - Với `uncertain && !bodyDeterministic` thì operation chuyển `markAmbiguous` và giữ key; ngược lại thì `reject`.
  - Đối chiếu `journal/mutation.ts:33-41`: `authorize` chạy trước bước lookup và `work` throw thì rollback, nên domain 4xx trên operation chưa từng gửi mơ hồ đúng là terminal.
- **400/413/415 coi là terminal:** đúng với operation gửi lại **cùng bytes** (`bodyJson` frozen). Không đúng với operation `resume` từ tombstone, xem New Breakage N1.

## New Breakage

**N1 — Important — `api.ts:260` + `pending-operation.ts:277-286, 309-314`: 400/413/415 trên payload nhập lại từ tombstone vẫn nhả key cũ.**

- `bodyDeterministic` dựa trên giả định “cùng bytes đã fail ở các lần gửi trước”, như comment ở `api.ts:98-102`. Với operation `resume`, bytes là payload owner **nhập lại** và có thể khác bản gốc đã commit.
- Server kiểm schema/body (400), body limit (413) và content-type (415) **trước** mutator. Vì vậy request bị trả 400 mà không đi tới bước so `body_hash`, và không có 409.
- Kịch bản: lần gửi gốc commit nhưng mất response, rồi logout tạo tombstone. Owner nhập lại sai và vi phạm schema, ví dụ title vượt giới hạn hoặc field rỗng. Server trả 400, `pending.reject(id)` xóa luôn tombstone (`#resumed` cũng bị xóa), `begin` cùng intent cấp key mới, và kết quả là bản ghi trùng.
- Trường hợp này cùng lớp duplicate-action với I1, và trái brief: “IDEMPOTENCY_CONFLICT giữ tombstone… không đổi key để thoát lỗi”. Payload nhập sai mà fail schema cũng phải giữ tombstone như vậy.
- **Fix:** nếu operation là bản resumed, coi mọi 4xx không chứng minh được (kể cả 400/413/415) như `pending.conflict(id)` để nó trở về tombstone, không gọi `reject`. Cần expose `pending.isResumed(id)` hoặc cho `conflict` nhận cờ. Thêm unit test: resume, nhận 400, tombstone vẫn còn, `begin` cùng intent ném `IntentUnresolvedError`.

**N2 — Minor — `api.ts:179`: `uncertain` suy từ `state` nên sai khi hai lượt `mutate` chạy song song trên cùng operation.**

- Lượt B bắt đầu lúc lượt A đang gửi, nên B thấy `state === 'pending'` và đặt `uncertain = false`. Nếu B nhận domain 4xx thì key bị nhả, trong khi A có thể commit.
- `RecoveryPanel` đã chặn bằng `busy`, nhưng `OwnerClient.mutate` là API công khai cho các composer sau này (G2).
- **Fix:** thêm guard in-flight theo `operation.id` trong client (ném `OPERATION_IN_FLIGHT`), hoặc đánh dấu “đã từng gửi” trong `PendingStore` thay vì suy từ `state`.

**N3 — Minor — `session-boundary.tsx:96-100`: nhãn của operation giữ `suspended` vì 403 dễ gây hiểu nhầm.**

Panel hiển thị “Tạm dừng vì hết phiên” dù phiên vẫn `authenticated`. Message mới “Máy chủ chưa nhận mã bảo vệ…” đúng, nhưng nhãn thì sai.

**N4 — Minor — `api.ts:250-258`: nhánh refresh của 403 không kiểm `request.signal`.**

Caller đã abort trong lúc chờ refresh thì vẫn bị replay một lần. Request vẫn cùng key/body nên an toàn về idempotency, chỉ là không tôn trọng abort. **Fix:** kiểm `request.signal?.aborted` sau `await refreshCsrf()`.

**Các điểm đã kiểm, không phát hiện lỗi:**

- **Logout làm mới CSRF rồi retry DELETE một lần (`session.ts:277-295`).** `createSessionClient` đọc trực tiếp field `#csrf`, không qua getter `csrf()` (getter trả null khi `logging_out`), nên lần DELETE thứ hai dùng token mới. Chỉ retry đúng một lần. Nếu restore trả 401, `error = null` và về guest, đúng. Wipe vẫn chạy sau cùng.
- **Upload gặp 403 thì refresh rồi ném lỗi (`api.ts:291-296`).** Không tự gửi lại. Nếu refresh lỗi, lỗi của refresh thay thế lỗi 403; chấp nhận được.
- **`session.refresh()` (`session.ts:303-326`).** Single-flight qua `#refreshing`. Gắn với epoch nên epoch đổi giữa chừng thì ném lỗi. Chỉ gọi `expire()` khi 401 hoặc `OWNER_MISMATCH`. `#set({...snapshot})` có kích hoạt `events.start()`, nhưng hàm này idempotent nên vô hại. Giới hạn “một lần mỗi call” nằm ở cờ `refreshed` trong `mutate`.

## Out-of-Scope

- **Chưa có cách bỏ một request ambiguous.** Khi một 4xx phụ thuộc trạng thái giữ operation `ambiguous` (ví dụ ticket đã bị xóa, 404 từ `authorize`), intent bị khóa vĩnh viễn trong tab. Owner chỉ có thể gửi lại, và lần gửi lại tiếp tục nhận 404. Cần quyết định UX từ chủ dự án: hành động “Bỏ yêu cầu này” có xác nhận rõ rằng owner chấp nhận rủi ro trùng, hoặc tra receipt khi server có endpoint. Không chặn task này.
- Các Minor trong review gốc (`task-2-review.md`) chưa được sửa ở vòng này, đúng như report nêu.

## Checks

- Đọc toàn bộ diff `2b958b8..a69ea3b` trong phạm vi web. Đối chiếu một lần với producer `journal/mutation.ts:33-41` và `auth/routes.ts:41-50,141-145`.
- Đã thấy 5 test mới trong `client.test.ts:400-530` và `auth-recovery.test.ts`. Không chạy lại. Report ghi RED 5/27, GREEN 27/27, unit 43/43, E2E 3/3, typecheck và Biome exit 0; em chưa xác minh độc lập.
- Chưa có test cho N1: resume, nhận 400, kiểm tombstone còn.

## Verdict

I1 ADDRESSED. Tuy vậy, delta để lộ N1: 400 trên payload nhập lại từ tombstone vẫn nhả key, cùng lớp duplicate-action với I1.

**Task quality:** Needs fixes (N1).
