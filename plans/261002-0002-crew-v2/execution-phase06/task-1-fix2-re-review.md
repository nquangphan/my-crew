T1-F1-N1 — **ADDRESSED / CLOSED**.

SPEC: **READY trong phạm vi FIX2**. QUALITY: **READY trong phạm vi FIX2**. S1–S5 giữ **CLOSED** theo review trước; không mở lại các finding đó.

## Finding verdict

- `v2/server/src/assistant/inbox.ts:155` đổi đúng predicate `s.expires_at>now()` thành `s.expires_at>clock_timestamp()`. Nó đọc thời gian thực tại câu kiểm scope, nên transaction bắt đầu trước expiry không còn dùng timestamp cũ để vượt deadline.
- Vị trí helper được giữ nguyên từ FIX1: claim gọi sau lockWorkRoot/current fence và trước replay tại `inbox.ts:164–166`; ACK gọi cùng thứ tự tại `:183–185`. FIX2 không đổi lock order, identity predicates, state transitions, replay hay producer. Không xuất hiện root lock mới trên message path.
- `v2/server/test/assistant-store.test.ts:1207–1261` thêm bốn case: pending→claim, claimed→claim replay, claimed→ACK, acked→ACK replay. Mỗi case mở transaction trước deadline, tạo scope TTL100ms bằng server wall clock, chờ chính `expires_at` qua `pg_sleep_until`, rồi assert `now()<expires_at` và `clock_timestamp()>=expires_at` trước gọi operation.
- Test yêu cầu exact error code `ASSISTANT_WORK_SCOPE_MISMATCH`, không chỉ generic rejection; sau đó deepEqual toàn bộ work row với bản trước transaction, bao gồm state/attempts/turn/generation/acked_at. Các positive scope/fence cases vẫn nằm trong affected cover.
- Đây là long-transaction reproduction được đề nghị ở review FIX1, không phải mô phỏng hai pool tranh khóa. Nó tái hiện trực tiếp nguyên nhân `now()` giữ mốc đầu transaction; thứ tự check sau khóa và trước replay đã được kiểm tĩnh, không cần thêm một vòng DB concurrency để đóng thay đổi một predicate này.

## New breakage trong fix diff

- **Không có** Critical/Important/Minor mới được phát hiện trong ba hunk source/test/doc. Production chỉ đổi một predicate. SQL011, contracts, store và support helper giữ nguyên FIX1.
- `v2/docs/flows/server-assistant.md:52` mô tả đúng wall-clock check và phạm vi affected evidence; không gọi lượt10 test là full suite, không cộng với35 test/restore lịch sử.

## Checks và evidence

- Đã đọc đầy đủ true FIX2 diff6553B, SHA256 `73b968c57fc6ad88bf84bfa75f715443157d072fdeefec9229b8f72ed6f6d082`, cùng phần FIX2 trong appended report22011B SHA256 `0f033f990bd5656a6296b211e29ed117efe4e11d1a3ff018c85257aa56fa2bb7` và freeze8862B SHA256 `f25ccbd54379594988b91e8b9c406c2dda417ef7a212921a775e1a7581943ef2`.
- RED thật `task-1-evidence/logs/task-1-fix2-red-2.log`: SHA256 `d730daf091c9541bf9b9a07cd6638a5a5f8dc28a27fc9519ef55d9a60cd55ef3`;4 tests/0PASS/4FAIL với bốn `Missing expected rejection`, không phải lỗi harness. Cả bốn DB witnesses đều start<expiry≤wall clock.
- GREEN cuối `task-1-evidence/logs/task-1-fix2-affected-cover.log`: SHA256 `6c9c652164045599832d3dbc01fb6861ff05a310facf4b74191b6725e566ea92`;10/10PASS,0FAIL,0skipped. Có bốn expiry cases, hai S1 scope cases và bốn fence/uncertain cases. Bốn witnesses GREEN tại log dòng36/42/48/54 đều xác nhận scope thực sự hết hạn trong transaction.
- Types log SHA256 `b884d8ddeaaaefedaa43528db434c070974b3d50e72d2593e8e79f3fb3c78569`, Biome log SHA256 `3864fb5d4a5ceaf85a38661f67b6be07139de072d5bbfd0dd7871b249c844bc5` khớp freeze; typecheck exit0, Biome5files/no fixes. Không có warning trong các raw logs đã kiểm.
- Source freeze ghi inbox SHA256 `133f47e8dbb08a4c07d8a6dd371203205e3c7dc7de7991d9f1399a71c7c4bdc0`; SQL011 giữ `fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841`. Root đã reconstruct exact FIX1 baseline bằng private index và đối chiếu7paths theo dispatch; reviewer không chạy Git/index hoặc lặp lại đối chiếu đó.
- Áp dụng scoped re-review template đã đọc; chỉ kiểm N1 và regression từ diff. Không chạy lại tests, PG, container, native/browser/model; không spawn child hoặc sửa source/index. Chỉ tạo report này. Evidence35/35 và restore FIX1 giữ là lịch sử cho source SQL/helper không đổi, không phải một lượt full validation mới.

## Out-of-scope observations

- **Không có observation mới.** T2–T7 producer, HTTP/model/driver/native certification vẫn pending/default-deny; verdict này không cấp production authority hoặc thay controller acceptance/commit gate.

## Verdict

**Fix round: All findings addressed, no new Critical/Important breakage.** T1-F1-N1 đóng; không còn finding mở trong FIX2. S1–S5 giữ CLOSED.

**Câu hỏi chưa giải quyết:** không có.
