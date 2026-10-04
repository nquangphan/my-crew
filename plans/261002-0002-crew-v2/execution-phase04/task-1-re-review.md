# Phase04 Task1 — scoped re-review FIX1

Ngày 2026-10-02. Original candidate `e94f2e1e992371be50e8f34adbffadd7cc8e195b`; FIX1 `d249a820c744b3e61853f09caa4363be4e4f0d9e`.

**SPEC: READY. QUALITY: READY. READY: YES — trong phạm vi Phase04 Task1 và batch FIX1 R1–R4.** Cả bốn finding gốc được đóng; không phát hiện finding mới cần sửa trong diff này. Verdict không chứng nhận toàn Phase04, native runtime/Keychain, production RELEASE hay migration009.

## Phạm vi và provenance

- Đọc `docs/index.md`, `v2/docs/index.md` trước source; các flow `server-models`, `server-gateway`, `server-execution`; full binding `task-1-review.md`, `task-1-fix-brief.md`, `task-1-fix-report.md`, và `execution-phase04/progress.md`, gồm PM ruling R2/R3. Không có `.codegraph/` tại worktree này.
- Review đúng bảy file: migration008, `models/catalog.ts`, `models/config.ts`, `models/secret-envelopes.ts`, hai test model certification/secret và flow `server-models.md`. Đọc source hiện hành ở các boundary được sửa, test regressions và integration auth/lock liên quan. Original full review vẫn binding; không replay toàn bộ original diff hoặc review peer workflow/attachments.
- Package `task-1-fix1-review-package-d249a82.diff` SHA256 `d317eb365ee2749a241b78edfe9a8400a1c8d5a9fe0cee804f5fb9b7fa3daa01`; xác nhận package chứa nguyên exact committed seven-file diff với `--unified=10`. Diff chuẩn cùng bảy file dài 82.991 byte, SHA256 `3b62bb184f9dbbb945f515af9c4d6153184ba855481ce81ae36bb8d5f864a226`, khớp captured `fix1.diff`.
- Đối chiếu trực tiếp SHA của cả **21** original inventory files với blob tại e94f2e1, d249a82 và file hiện hành: tất cả khớp `source-inventory.json`; chỉ bảy file trên đổi. HEAD đã tiến tới `d9aec4d32f2593254aeed90481031409cacd5fce` bởi PM evidence/docs; diff d249a82→HEAD của bảy owned files là **0 byte**.
- Kiểm lại cả **28** file trong `checksums.json`: byte length/SHA256 đều khớp. Đây là kiểm provenance của evidence đã lưu, không phải rerun test. Reviewer không chạy DB/security/native/model probe, không dùng credential thật, không sửa source/test, không stage/commit hay Git mutation. Chỉ tạo report này.

## R1 — CLOSED: exact source selection trước fresh claim

`catalog.ts:323–324` so `payload.selection.sourceTreeSha256` với cả current SourcePin và exact selected probe context. Logic trước đó vẫn yêu cầu command/decision có cùng selection và modelChoice, current domain pin, exact report/revision/projection/probe/certificate/capabilities; vì vậy thêm hai phép so đóng đúng lỗ hổng hai stored copies cùng sai source. Kiểm chạy dưới machine lock trong transaction của caller, trước khi claim tạo attempt.

Regression `model-certification.test.ts:479–513` giữ certified positive service gate, tạo command và decision cùng source hash sai, assertion trực tiếp đòi `MODEL_UNAVAILABLE`, rồi gọi HTTP fresh005 claim qua authority dùng chính `assertModelDispatch`. Claim409, attempt/guard/event counts không đổi, ticket vẫn ready. Không lấy companion rejection sau claim để thay cổng này. RED lưu `Missing expected rejection`; final covering chạy đủ nhánh boot1 và boot2. **R1 đã đóng.**

## R2 — CLOSED: historical message không còn provider write authority

Migration008 thêm `current_operation_id` và SAME-machine/provider FK tới envelope operation (`008_model_pool.sql:91–93`); CHECK giữ stored/ref và pending/pointer nhất quán. `provisionSecret` khóa machine rồi provider, insert envelope trước khi gán pointer; accepted server order quyết định authority, không UUID hoặc clock. Retry operation có sẵn trả metadata sớm và không gán lại pointer.

`ackSecret` vẫn ghi receipt ACK của pending historical operation nhưng provider update có điều kiện `current_operation_id=r.operation_id` (`secret-envelopes.ts:208`). Loss chỉ thay presentation của provider có **current pending** envelope dùng lost key (`:221`), nên không xoá stored B. `setSourceConfig:81–82` expire pending và detach pointer trong revision mới; stored/ref được giữ khi endpoint/protocol không đổi, rule endpoint/protocol cũ vẫn làm missing. HTTP config mutation và secret mutation cùng dùng actual `authorizeGatewayMutation` machine lock trước callback; helper lock mới giữ cùng serialization cho direct secret service callers.

Regression `model-secret.test.ts:420–478` kiểm A pending→B stored→late A ACK/loss/replay, replay B, retry A và reopen; B giữ status/ref/pointer. A/B có UUID đảo thứ tự và timestamp bằng nhau. Invalid FK bị23503. Test revision tại `:568–617` kiểm pointer detached, late pending ACK409, old ACK/loss không ghi đè credential revision mới. RED lưu cả older-ref overwrite và missing/null overwrite; final covering PASS. **R2 đã đóng theo PM ruling.**

## R3 — CLOSED: lost transport key được retire, stored credential được giữ

`lost_at` chỉ được có trên retired key; provision mới đòi active và `lost_at is null`. Loss dưới machine lock retire **đúng key của envelope**, xoá ciphertext/tag và chuyển mọi pending envelope cùng key sang key_lost/expired theo TTL, giữ metadata và không tạo ACK giả (`secret-envelopes.ts:218–221`). Không đụng ACK history. Provider stored B không bị xoá kể cả B dùng cùng lost key; current pending dùng key khác cũng không bị đổi.

Confirmation đã consumed vẫn trả receipt lịch sử trước update nên replay không kích hoạt lại key lost. Normal rotation retire key với `lost_at=null`, còn pending ACK được giữ theo contract; loss sau đó mới vô hiệu pending của đúng old key. New provisioning operation vẫn có pending/null presentation như policy đã chốt, không suy stored từ việc còn generic secret cũ.

Regression `model-secret.test.ts:484–565` kiểm lost K→fresh provision409, GET không còn pending boxes, pending ACK409, cả hai ciphertext/tag bị xoá/ack_hash null, old confirm replay vẫn không cho provision. K2 phải registration/challenge confirmation rồi resend/ACK mới200. Replay old loss sau K2/reopen giữ new ref và K2 active. R2 loss branch kiểm giữ **already-stored B trên cùng lost K**; normal rotation branch kiểm historical ACK còn được chấp nhận trước loss và lost old key không xoá new pending/new active key. RED lưu fresh provision200 và old-key loss rewind; final covering PASS. **R3 đã đóng.**

## R4 — CLOSED: admission dùng current boot install report

`008_model_pool.sql:133` bổ sung `ir.boot_generation=gb.boot_generation` vào join từ authoritative `gateway_applied.latest_report_id`. `gb` đã buộc model inventory ở boot chưa retired; các checks existing giữ report accepted, current config/applied, exact selection/source/projection/probe/challenge. Không đổi claim005, companion007 hoặc mở authority mặc định.

Regression `model-certification.test.ts:251–326` dựng boot1 accepted install, boot2 inventory/full applied/fresh probe và vẫn trỏ boot1 report. Actual HTTP claim005 trả503 bởi SQL guard; transaction rollback attempts/guards/events, ticket ready và challenge issued. Sau boot2 accepted install + matching selection mới201; toàn bộ assertions admitted A, lost claim replay A, companion/fence, B denied và certification boundary của test gốc vẫn chạy trên cả hai nhánh. RED lưu201 thay503; final covering PASS. **R4 đã đóng.**

Giới hạn diễn đạt evidence: assertion replay ở `model-certification.test.ts:310–315` gửi historical **model inventory**, không gửi historical install report. Nó chứng minh inventory replay không đổi pointer007; không dùng nó làm bằng chứng mới cho install-report replay. Contract/install replay007 vẫn thuộc original binding review và captured gateway covering; điểm này không làm yếu regression boot-mismatch R4.

## SPEC độc lập

**READY.** Bốn điều kiện bị thiếu trong review gốc đã được bổ sung tại đúng authoritative boundary. Current operation, key loss versus rotation/stored secret, revision invalidation và current boot semantics khớp ruling. DTO/export/route không đổi; migration008 còn amendable theo brief và checksum mới được freeze.

Đối chiếu trực tiếp frozen001–007 với e94f2e1/file hiện hành/captured hashes: **7/7 khớp**. Protected committed diff cho001–007, execution005, gateway007, platform/contracts, app và event-contracts là **0 byte**. 008 mới SHA256 `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f`. Không coi DB đã áp candidate008 có thể upgrade tại chỗ; migration drift vẫn phải từ chối theo contract.

## QUALITY độc lập và validation

**READY.** Changes nhỏ ở production boundary, serialization rõ ràng, receipt/history được giữ và không có test/default authority bypass mới. Diff test certification chủ yếu do bọc test gốc thành hai nhánh; kiểm whitespace-insensitive diff xác nhận các assertions gốc được giữ, regression R1/R4 được thêm. Các regression dùng HTTP/PG và producer thật; fake verifier/issuer vẫn chỉ là protocol fixtures của review gốc.

| Captured evidence trong `task-1-fix1-evidence/` | Kết quả được đọc, không suy diễn |
|---|---|
| `red.json`, `red.log` | exit1;0/6; failures cụ thể đúng bốn lỗi gốc và old/new key boundary |
| `green-initial-sql-failure.*` | Failure SQL của implementation lần đầu được giữ; không thay RED/GREEN cuối |
| `green.json`, `green.log` | exit0;11/11;5.625,897834ms; trước revision assertions cuối |
| `covering.json`, `covering.log` | **exit0;215/215**,0fail/0cancel;40.607,3265ms; có22 model tests cuối, R1 trong certification branches, R2/R3/R4, revision boundary |
| `umbrella-server.test.ts.txt` | Đối chiếu exact import list với e94f2e1 tree:24/24 candidate test files; không attachments peer tests |
| `covering.log` | Actual prefix7 backup→restore7→migrate8→dump/restore8/reopen/checksum/FK/immutable checks,005 claims và prior007 command types PASS |
| `types.*`, `biome.*`, `diff.*` | Captured typecheck exit0;Biome14 files/no fixes exit0;owned whitespace check exit0 |
| `container-cleanup.json`, `umbrella-cleanup.json` | Captured5 exact owned container IDs absent; own umbrella root removed/exists=false |

Bằng chứng final covering gắn với source inventory đã so trực tiếp với committed FIX1; không cộng focused vào covering và không có claim209 hay rerun mới. Scope incident26-file run exit143/accidental private009 application vẫn giữ lịch sử trong fix report/ledger, không là validation009. Unknown exact scratch cleanup của interrupted attachments vẫn là limitation của incident ngoài scoped batch; không tự xoá peer scratch hay dùng final PASS để che incident.

## Handoff và retained gates

Task1 FIX1 đạt cổng review độc lập SPEC/QUALITY. PM có thể tiếp tục dependency handoff theo approved plan; acceptance/integration/consumer tests tiếp theo thuộc controller. Report này không merge/deploy và không tự approve009 hoặc completion toàn Phase04.

Original UNVERIFIED giữ nguyên: independent native/signed observer, live capability/isolation và process-wide negative surfaces, genuine runtime RELEASE, Keychain write/read-back/fsync/ACL/old private-key retention, signing, host DNS pin/redirect/SSRF. Production defaults deny và test protocol PASS không trở thành production certification authority. Không bỏ test hoặc hạ gate để lấy READY.

Unresolved questions: không có câu hỏi cần owner để đóng R1–R4. Ngoài scope: exact-path cleanup evidence của interrupted attachment scratch vẫn chưa có; peer/controller chịu trách nhiệm nếu cần xác minh.
