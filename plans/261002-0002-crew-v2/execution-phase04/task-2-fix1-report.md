# Phase04 Task2 — FIX1/5, batch R1–R6

Ngày 2026-10-02. Candidate gốc `f687fe3`; reviewed core dùng cho verification `556cd8d`. Đây là báo cáo implementation chờ độc lập review, chưa tuyên bố toàn gateway READY. Không commit/stage, không chạy subagent. Original task-2-report/evidence được giữ nguyên.

## Phạm vi và thay đổi

8 file thay đổi trong own23: bốn production gateway models, ba test hiện có và gateway-models R3. `task-2-fix1-evidence/fix1-source-inventory.json` ghi SHA trước/sau từng file so với f687fe3 và toàn own23. Không sửa server production/test, native bridge, migration001–009, manifests/dependencies/generated, HTTP journal hoặc producers khác. Snapshot cuối là archive556 + own23, không lấy peer HTTP retry7c7c719 hay attachments/ticket edits.

| Finding | Fix và regression |
|---|---|
| R1 | Upper expiry dùng estimated server now = receipt + monotonic elapsed, rồi cộng bounded TTL. Pure-clock test giữ expired/backwards/stale fail-closed; actual crypto registration fixture phát challenge sau receipt50ms xác nhận không bị từ chối nhầm. |
| R2 | accept kiểm immutable envelope hash/ACK intent trước fresh revision/expiry/decrypt; syncPending tự replay cùng body/key/ref sau restart, expiry và revision change. broker.assertStored trước HTTP; không có intent, envelope đổi hoặc local ref mất bị từ chối. Không rewrite secret hoặc tạo intent mới. Self-review amendment đã được PM đồng ý: ACK lịch sử chỉ dọn queue cũ, current pending giữ pending tới GET stored; test public reconnect bao gồm bước này. |
| R3 | Chụp config/boot trước collect và body trước await durable journal. Barrier test cho GET revision1 collect chậm, revision2 collect hoàn tất trước, boot đổi in-place: report cũ giữ nguyên revision/boot, shared sequence không relabel; replay nguyên report và boot mới bắt đầu sequence riêng. Đây là model reporter fixture, không phải host composition completion. |
| R4 | Raw byte bound trước BOM/line normalization; LF/CRLF/bareCR/mixed cùng accepted, thiếu blank terminator hoặc oversize fail. Responses và Chat đều có regression. |
| R5 | Bounded Responses state correlates response ID, item ID/output index, function call ID/name, argument fragments/done, text/content parts/done với completed. Reject orphan/duplicate/conflict/missing-done/failure-before-success; allow explicit lifecycle/usage/logprobs/nullable annotation metadata. Official function variant thiếu item status và dùng response_id có compat RED/GREEN riêng. Không ignore tùy ý response.*; modality ngoài text/function subset fail. completed-only payload compatibility giữ nguyên. |
| R6 | Closed transport outcome giữ TOOL_PROTOCOL/MODEL_MISMATCH/PROTOCOL/STREAM_PROTOCOL/RESPONSE_TOO_LARGE/SSRF_DENIED/TRANSIENT qua broker. Unknown callback vẫn fixed CREDENTIAL_TRANSPORT_FAILED. Actual broker + loopback transport + prober kiểm tool/model/size,401/429/503/network, loopback DNS SSRF, không retry, redaction và owned credential buffers zero. |

## Evidence và verification

Primary protocol evidence có links và disposition tại `task-2-fix1-evidence/protocol-evidence.md`; đối chiếu WHATWG/OpenAI trước implementation và trước compat amendment. Không gọi provider/paid model thật.

- `red/focused.log`: 24 test,18 pass,6 fail đúng R1–R6; command exit1.
- `green/focused.log`: 24/24 pass, exit0.
- `compat-red/focused.log`:25 test,24 pass,1 fail documented function status/response_id. `compat-green/focused.log`:25/25 pass.
- `state-red/focused.log`:25 test,24 pass,1 fail historical ACK incorrectly promoted current pending. `preflight/focused.log`:26/26 pass, typecheck0; bao gồm nullable annotation positive.
- Mỗi run có exact argv/cwd/exit, frozen source inventory, source stability, nonce root creation/dev/ino/uid/removal receipts. RED scripts cố ý giữ runner sống để capture cleanup; test command exit1 không bị gọi PASS.
- Final `final/focused.log`: **113/113 PASS**,0 fail/cancel/skip, exit0,75087ms. Build/typecheck/scoped Biome (15 gateway TypeScript files) exit0. Final manifest explicit17 files; không chạy wildcard/unreviewed peer tests. `final-verification.json` xác nhận source ổn định toàn23, mọi snapshot root của7 lượt đã removed đúng identity và absent. Historical failures bên dưới không bị thay bằng kết quả lượt này.

Không chạy lại full server vì server production không đổi. Own server current-binding4 test và actualPG evidence của candidate trước giữ nguyên, không gọi là fresh FIX1 run. ACK replay FIX1 dùng actual crypto/AtomicRecords/baseline HttpOperationJournal và bounded fake authenticated wire; không tuyên bố đây là newly-run PG roundtrip. Server historical ACK/current reauth contract không đổi.

## Evidence cũ và giới hạn giữ nguyên

Original server cover218/219, old HTTP EPIPE case và narrow old fail vẫn giữ; PM-accepted f58 test-only context có repaired whole case1/1 riêng, không cộng thành219PASS. Original gateway missing compiled entrypoint infra93/104 được giữ; rebuilt103/104 với baseline lifecycle ECONNREFUSED và unchanged narrow1/1 riêng, không cộng thành104PASS. FIX1 final là lượt riêng và không xóa lịch sử flake.

No live Keychain, signed native helper, CLI subscription auth, provider-paid execution, permit/admission hoặc new authority. Sampled current binding không là atomic network lease. sync_models consume/ACK và host composition vẫn là later explicit handoff. Peer Task05 retry producer chưa được consume. CodeGraph không có trong worktree; PM giữ docs manifest/generate/check và commit/full review.

## Cleanup và handoff

Snapshot roots có nonce riêng, archive member validation và exact device/inode/UID kiểm trước cleanup; chỉ xóa root đã tạo/ghi nhận. Fixture helper in creation/removal receipt; không sweep prefix hoặc chạm user/shared resources. Hai initial unreceipted roots zQeH26/DTjkSU tiếp tục RETAIN. FIX1 không tạo Docker container, không chạy server listener ngoài loopback test, không thay global config/services. Evidence cũ có baseline DB cleanup attribution UNKNOWN giữ nguyên trong original report.

PM cần review toàn batch R1–R6 trên source inventory8 và baseline context, rồi quyết định commit/accept. Đây là semantic wave1/5; compat/state amendments nằm cùng batch trước final cover, không tự tuyên bố independent review PASS.
