# Task05/2b — Independent SPEC + QUALITY/security review

**SPEC: NOT READY. QUALITY: NOT READY.** Một finding P2 trong consumer; không có P1 được xác nhận. Root metadata producer `228f9e4` không có finding riêng. Cần một batch sửa và scoped re-review trước acceptance; báo cáo của implementer và cover51 không tự cấp acceptance.

## Candidate và phạm vi đã đọc

- Consumer candidate `615025490214b68ced67650c8d8dabd481bcbc8d`, task-only base `703b922`; tám owned paths đúng inventory. Đã đọc toàn bộ `submissions.ts`, `messages.ts`, `routing.ts`, ba test consumer, diff support fixture và R3 server-attachments.
- Root adaptation `228f9e44e73784de3006dd280b1fb2b1498c2645`: toàn bộ diff event-contracts, test attachments-events.unit và R3 server-journal. Không suy event registration thành authority.
- Đã đọc Task2, S1–S3/R1 và task-specific acceptance trong approved phase05, brief, report đầy đủ, PM ports17:26/event adaptation/18:18 failure-history rulings và approved phase06 R3 lines231–243; docs index và các flow attachments/tickets/journal. Đối chiếu actual tickets factory/authorization, journal transaction/cache, attachment types/receiver producer và schema009/010. Không dùng CodeGraph hoặc source Task4/model/gateway/isolation chưa thuộc candidate.
- Accepted Task1 `ec02ac0`, producer `f6d3728` và migrations001–010 chỉ đọc. Không sửa schema/producer/source, Git/index/manifest/package hoặc shared service.

Hash binding được reviewer kiểm bằng SHA-256 của file hiện tại và `git show` candidate, không chỉ tin cờ boolean trong report:

| Artifact | SHA-256 |
|---|---|
| task-2b-report.md | `2e5d93565b1236d9892a5f20dc3ccde3cdd86e7246661f6503ec34dbe2321771` |
| task-2b-source-inventory.json | `8b3929aacbe9e2245b61f6a3f658d481d79c156ab263849ed70ff2533d40c281` |
| task-2b-task-only.patch | `7fefb008859a102a6cede0571e88b3980a2e3f69087af244aff17da64e108a77` |
| task-2b-evidence-final.json | `f8f1915b7e7f6a63882990923b18875eef88d66d6116191f7d6b46290fde164a` |
| task-2b-cleanup-final.json | `538d832919d6535da61f52c9114d94fb0a37d4a8f04e6be3b9185e65fc004441` |
| task-2b-events-producer-inventory.json | `03eacce590869675fa1da9f2b9d50fb91aeb779d45346ff7b3a78d0565b159aa` |

Tám owned source/current/candidate/inventory khớp cả bytes và SHA. Mười migrations khớp inventory và candidate; ba frozen tickets producer files byte-identical với f6d3728. Root ba source và bốn evidence files khớp inventory. Cả cover-source-freeze và typecheck-source-freeze có 240 entries, đối chiếu toàn bộ không mismatch: 220 f58 baseline + 2 ec code/test + 6 f6 + 3 root228 + 8 own615 + một ownership marker. ec R3 thứ ba đã được own consumer R3 thay thế đúng phạm vi; đây vẫn là frozen f58 + ec3 + f6six + rootthree + owneight composition.

## Findings — complete batch

### F1 — P2: Receiver validator nhận loại stop proof không tồn tại trong producer contract

**Vị trí:** `v2/server/src/attachments/submissions.ts:172–173`; đối chiếu `v2/server/src/attachments/contracts.ts:199–206` và `v2/server/src/attachments/receivers.ts:346–357`.

`createSelectionServices.lock` cho phép `['closed-ack', 'process-gone']`. Actual `WriterStopProof.kind` chỉ có `closed-ack | native-process-gone`; producer tạo đúng `native-process-gone`. Nhánh `process-gone` còn bỏ qua so khớp `closed_ack_sha256`. Vì vậy một persisted row có tuple/closed fields phù hợp nhưng proof mang discriminator không được producer định nghĩa vẫn đi đến blob verification và được coi là selected ready original. Ngược lại, discriminator native thật bị từ chối. Đây là lỗi validation tại consumer boundary, không phải bằng chứng rằng caller HTTP hiện có thể tự viết DB hay process đang sống được STOP.

Reviewer chạy một canary in-memory trực tiếp function candidate, chỉ thay discriminator trên cùng compose/upload/receiver tuple, không tạo DB/blob/process fixture:

```json
{"kind":"closed-ack","result":"accepted","verified":1}
{"kind":"native-process-gone","result":"ATTACHMENT_NOT_READY","verified":0}
{"kind":"process-gone","result":"accepted","verified":1}
```

Canary chứng minh nhánh validator thực thi; không chứng nhận native proof hoặc recovery. Producer `proveStopped` hiện ghi native proof nhưng không tự chuyển receiver thành closed/ready. Do đó không được sửa bằng cách coi native process-gone hay PID absent là đủ cho ready, cũng không được bỏ các closed/durable/identity gates. Sửa validator bám actual typed proof và fail closed với mọi unknown discriminator; nếu native proof chưa đủ điều kiện ở pipeline hiện tại, từ chối rõ ràng đến Task7. Bổ sung regression qua actual staging/DB consumer để unknown kind không link/release quota, closed ACK thật vẫn thành công; chỉ nhận native variant khi có reviewed producer transition/identity evidence tương ứng. Không rewrite accepted009.

## Cross-machine routing — gate được giao phase06, không là finding Task2b

Đã kiểm `routing.ts:50–52`, `authorizeTicketMutation` và actual `createTicket/requireProjectScope`: actor machine A khác project-bound B bị NOT_FOUND trước InputRoutingAuthority. Canary in-memory gọi actual guard xác nhận `authorityCalls=0`. Điều này ban đầu có vẻ không tương thích S1/S3 tổng thể, nhưng **approved phase06 R3 lines231–243** đã chỉ rõ ownership transfer và adapter tương lai: “default remains generic/deny for cross-project machine”. Vì vậy không tính thành P2 và không yêu cầu Task2b bỏ scope gate.

R3 chuyển routing/routes/grants sau review009 để thêm `createMessageRouter` với injected `RouteTicketCreator` tại existing createTicket callsite, cùng caller Tx; Assistant branch dùng exact decision/TurnFence/OrchestrationProof và ProjectOrchestrationPort, giữ actorA thật. Derived owner authorization chỉ cùng selected refs, expiry không tăng; absent bridge fail closed. Owner branch giữ generic creator. Actual A≠B/offlineB, replay/rollback, parent-consent revoke và generic A→B denied thuộc phase06 T2 integration tests. Không giả owner, nới generic ACL hay đòi bật authority chưa có trong Task2b. Source observation được giữ nhưng **disposition: DEFERRED BY APPROVED R3, NOT A FINDING**.

## SPEC/QUALITY/security đã kiểm ngoài findings

- Submission owner-only; target UUID validation trước SQL, scope hiện hành trước per-compose receipt. `authorizeSubmission` là port cho `Mutator.context.authorize`, vốn chạy sau journal locks nhưng trước cached response. Public route wiring chưa có và vẫn là Task3 gate; consumer không tự chứng nhận credential integration.
- Normalized selection lowercase/sorted unique UUID, exact active set/revision/purpose/target/expiry; chỉ abandoned bị loại. Reserved/receiving/rejected/missing/deleting/deleted không được bỏ lén. Ready + durable marker + receiver closure + readonly actual bytes/hash/length verification trước retention. F1 là ngoại lệ proof discriminator nêu trên.
- Caller transaction và global journal cursor giữ serialization. Owner quota lock dùng cùng namespace với reserve. Existing root/affected tickets/project/input locks lấy trước compose/uploads; 009 comment trigger tái lấy cùng affected set. Original verification chỉ đọc; không di chuyển/xóa bytes trong Tx.
- Actual configured tickets factory capture bound linker. Comment INSERT → linker → một comment.created trong cùng Tx; 010 cho empty attachment-only, legacy empty/whitespace semantics giữ nguyên. Trigger009 sole comment fanout; wrapper không bump lần hai. Failure rollback target/link/event/revision/receipt/retained/quota đồng thời.
- Immutable hash gồm complete ticket hoặc text/target, selection revision/IDs, normalized assistantRead. Same body/new key trả exact stored response; changed body/permission409; replay không cấp lại authorization, quota hoặc job. Pending extraction unique attachment/version/config; captured queuePolicy default deny files khi thiếu. Fixture policy chỉ chứng minh queue pending.
- Inbox owner-only, client UUID cùng canonical conversation/text/original IDs+hashes/permission bắt retry khác compose; same payload trả receipt cũ, unused new compose giữ open. Message commit không tạo ticket; event owner-only exact metadata. `selected-inputs` chỉ tạo owner authorization exact submitted refs/target, allowOriginal=false, expiry24h; không grant/session/receipt delivery.
- Decisions check current input revision; owner explicit route null proof vẫn pin full ticket+route revision. Machine requires matching grant/snapshot/all-selected receipt và trusted decision authority; absent bridge deny. Future authority còn phải xác minh designation/session/current permission thật, không lấy metadata receipt làm quyền tự cấp.
- Route CAS và persisted decision digest được kiểm trước replay; authority captured. Old attempts phải stopped + stopped_at + finalized_at, không suy hết lease là dừng. Running/unknown Assistant read sessions chặn correction. Missing retirement deny; tests gọi actual signalTicket(wait_owner), rollback event/workflow khi retirement ném lỗi. Revoke old direct route links/grants và tăng old affected/message counters cùng commit, snapshots immutable stale qua revision. Historical route receipt revokedAt=null là receipt tại acceptance, không read authority mới. Cross-machine A→B vẫn giữ default deny theo approved phase06 R3 nêu trên.
- Root events whitelist exact keys/UUID/canonical positive bigint bounded int64: inbox event all-null scope, input wake đòi machine audience cụ thể và target scope khớp. Không bytes/text/path/extrakey. Consumer không fabricate audience khi chưa designated issuer; không phát event là quyền đọc mới.
- Support delta chỉ actual readyCompose, pre-cache fixture guard, resource identity receipt/UID cleanup; không sửa receiver native protocol hoặc production bằng fake ready count. R3 mô tả rõ public/access/runtime/recovery gates. Không có source edit nào do reviewer thực hiện.

## Verification và giới hạn

Reviewer đọc captured commands, exits, assertions, source manifests và kiểm SHA của toàn bộ logs được index; không rerun broad suite.

| Chứng cứ | Kết quả và giới hạn |
|---|---|
| Final cover-source-freeze | **51/51 PASS**, 0 fail/skip, exit0, 9031.972ms; đúng chín explicit files tickets/dependencies/completion/repair/producer/ba consumer/root events, concurrency2; childClosed=true |
| Final strict types | Frozen 240-file snapshot, `pnpm … typecheck` → `tsc --noEmit`, exit0; không diagnostics |
| Final scoped Biome | 7 own TS files, no fixes/errors |
| Root metadata producer | Separate four-file **7/7 PASS**, 0 skip; root strict checker with existing ambient declarations PASS |
| Reviewer extra canary | Một Node stdin invocation, actual candidate functions + in-memory SQL rows/readonly verify stub; bốn branch observations ở F1 và cross-machine gate, exit0. Không PG/native/end-to-end claim |

Giữ nguyên history: initial feature RED3; hai startup57P03 trước feature; routing feature RED; first messages-routing1/2 do expectation; recursive registration cancelled run; lifecycle5/6 do event query; focused16/16; own type errors rồi corrected; terminal receiver RED→GREEN1/1; historical cover50/50; actual malformed UUID22P02 RED→VALIDATION400 GREEN1/1; cuối cùng cover51 sau lastsource. Root EVENT_INVALID RED2 và initial ambient-declaration type failure cũng giữ. Không union historical runs thành tổng PASS, không gọi failed infra run là feature success.

Test coverage hiện tại chưa bắt F1: receiver negative chỉ nonterminal state. Routing cases dùng owner và một project; current designated A→B là gate phase06 R3 được giao riêng. Những kiểm khác còn giữ gate: Task3 public HTTP/credential/access/download/snapshot/grant/stream revocation, Task6 transport/manifest/receipt integration, phase06 actual issuer/decision/retirement/model admission, Task4/5 worker/parser production certification, Task7 native multi-process kill/recovery. Không yêu cầu implement toàn bộ các task này trong Task2b; chỉ yêu cầu ports Task2b tương thích contract trước acceptance.

## Cleanup và handoff

Captured cleanup có14 full container IDs với exact absence observations,880 roots,20 snapshots và4 restore DB create/drop receipts. Reviewer đọc JSON đầy đủ bằng parser, kiểm lại **880/880 roots và20/20 snapshot roots hiện absent**; không chạy Docker/global cleanup. Interrupted run có784 roots, recorded child PIDs18206/18207 closed,783 self-cleaned và một exact nonce/dev/ino/UID residual được xử lý sau closure. Hai57P03 run thiếu full container IDs vẫn là identity-proof limitation; không gán14 IDs cho chúng, không đoán/xóa resource bằng prefix.

Reviewer chỉ chạy readonly source/hash/log reads và một short-lived Node in-memory canary đã exit0; không tạo DB/container/server/blob/scratch fixture, không còn resource riêng cần cleanup. Chỉ file này được reviewer tạo. Candidate source hashes được kiểm lại trước report; peers được giữ nguyên. PM package/lock edits cho Task4 tới sau snapshot không được dùng trong source binding hoặc canary; Node canary không cài/resolve package mới.

Disposition: **F1 OPEN P2; SPEC NOT READY, QUALITY NOT READY.** Cross-machine observation không là finding nhờ explicit approved phase06 R3. PM giữ consumer acceptance/public integration gate và giao fix validator/proof regression; không cần bật phase06 hay sửa generic tickets producer cho batch này. Capture focused regressions, final affected candidate evidence và failure history; scoped re-review F1 cùng mọi diff mới, không tự nâng report implementer thành acceptance.
