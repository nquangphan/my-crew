# Phase04 Task1 — FIX1 semantic wave1/5

Batch R1–R4 đã sửa và đóng băng để PM review lại; **chưa có verdict READY của reviewer**, chưa mở Task2/009 và không chứng nhận toàn Phase04. Reviewed candidate `e94f2e1e992371be50e8f34adbffadd7cc8e195b`; dispatch HEAD `07ccdc4`. Không stage/commit, subagent, dependency/manifest/Git edit, paid/live model, credential owner, Keychain/global HOME/shared DB/service. Production authority vẫn deny/UNVERIFIED và test issuer không có trong production.

## Findings binding và kết quả

- **R1 [P1] Fresh model dispatch nhận selection có source hash sai:** `assertModelDispatch` nay so sourceTreeSha256 của command/decision selection với current SourcePin và exact probe context, trong cùng claim transaction. Cả hai stored selection cùng sai source nhưng model choice/report/revision/projection/cert đúng bị MODEL_UNAVAILABLE; fresh HTTP claim409 giữ counts attempt/guard/event và ticket ready. Certified positive gate vẫn qua.
- **R2 [P2] Envelope cũ có thể xoá credential đã được operation mới lưu:** provider giữ `current_operation_id` bền vững, SAME-machine/provider FK tới envelope operation. Provision mới gán pointer theo server-accepted order dưới machine/provider locks; old retry không lấy lại authority. ACK pending cũ vẫn ghi receipt lịch sử nhưng chỉ current operation được ghi status/ref. A pending→B ACK newer-ref→A late ACK/loss/replay giữ B stored/newer-ref; ACK B/reopen vẫn giữ authority. Hai operation có UUID đảo thứ tự và cùng timestamp chứng minh không suy UUID/time.
- **R3 [P2] Báo mất active key nhưng server vẫn mã hoá secret mới cho key đó:** loss retire đúng reported key, `lost_at` phân biệt loss với normal rotation. Mọi pending envelope của lost key thành key_lost/expired, xoá ciphertext/tag, giữ metadata/không tạo ACK giả. Chỉ provider có current pending operation dùng key đó thành missing. Newer credential đã ACK giữ nguyên ngay cả cùng lost key; active key khác không bị đổi. Provision mới vào lost key409, replay confirmation không re-activate; key mới giải challenge/confirm rồi resend/ACK mới200. Retired normal rotation còn private key vẫn ACK pending lịch sử được.
- **R4 [P2] Test admission actual005 dùng install report của boot đã retired:** 008 hook join latest accepted install report với current007 boot_generation. Boot1 report + boot2 inventory/full applied/fresh model choice bị503 từ frozen SQL guard, rollback attempt/guard/event, ticket ready/challenge issued. Boot2 accepted install + matching selection mới201; admitted A/claim replay/companion vẫn đúng, B denied. Historical report replay không thay current pointer.

## Lifecycle ruling và chi phí

Theo PM ruling: current operation được gán khi provision succeeds, không UUID/host-clock heuristic. Config revision mới expire pending cũ và detach pointer; giữ stored credential nếu endpoint/protocol không đổi, endpoint/protocol đổi thành missing theo rule cũ. Historical ACK/loss không khôi phục/xoá credential mới. CHECK bảo đảm stored tương ứng credentialRef, pending có pointer và key có lost_at chỉ retired; FK bảo đảm operation đúng machine/provider. Loss update tất cả affected pending trong cùng machine lock, không động ACK history hoặc unrelated key.

Cost: new provisioning operation có presentation pending/credentialRef=null như policy hiện hành, không tự khôi phục secret cũ khi new pending mất key; frontend/host Task2 có thể cần phân biệt history/current presentation sau này. Confirmation/key-lost replay giữ wire receipt lịch sử (active/pending respectively) và không trở thành current provisioning authority. SQL008 đang chưa accepted nên amend tại chỗ; DB nào đã áp candidate008 sẽ nhận MIGRATION_DRIFT, không tự upgrade live. Không sửa DTO005/007, frozen execution/guards, ServerOptions, app/event whitelist hay peer gateway/attachments.

## RED/GREEN và final verification

Durable commands/exits/logs: `task-1-fix1-evidence/`.

| Run | Kết quả |
|---|---|
| RED actual PG/HTTP trước source | exit1, 0/6; R1 missing rejection, R4 201 thay503, lateACK rewinds older-ref, loss rewinds missing/null, lost key new provision200 thay409, old-key loss rewinds new pending |
| First GREEN attempt | exit1, 5/11; provision503 do implementation SQL typo `for update` trên UPDATE; sửa đúng statement, giữ log failure |
| Focused after correction | exit0, 11/11, 5625.897834ms; trước thêm revision/history assertions cuối |
| **One final corrected candidate covering** | exit0, **215/215**, 0fail/0cancel, 40607.3265ms; gồm final22 model tests và exact24 candidate server files |
| Final typecheck | exit0 |
| Final Biome | exit0,14 files/no fixes |
| Final owned diff whitespace | exit0 |
| Protected candidate diff | zero bytes cho 001–007, execution, gateway, platform/contracts, app, event-contracts |

Corrected umbrella file list được so exact với 24 `*.test.ts` từ `git ls-tree e94f2e1 -- v2/server/test`; migration capture cao nhất008. Final covering chạy sau production source cuối và mọi test/assertion cuối. Không broad rerun sau pass; no combined count suy diễn. Suite có actual prefix7 dump→restore7→migrate8→dump/restore8/reopen/replay/checksum drift/FK/immutable proof và prior3 gateway command types/005 claims.

008 mới SHA256: `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f`.

Fixdiff e94f2e1→owned current SHA256: `3b62bb184f9dbbb945f515af9c4d6153184ba855481ce81ae36bb8d5f864a226`.

21 original inventory files đều có candidate/current hash; **chỉ7 own files đổi**. Tám models modules giữ cùng exported names/DTO; không route/manifest/source file mới. Frozen001–007 hashes giữ đúng bảng report gốc và reviewed candidate, captured `frozen-migrations.json`. R3 flow `server-models.md` cập nhật cùng source; PM serialize docs checks/Git.

## Scope interruption — ghi rõ gate violation, không coi 009 được approve

Covering đầu gom nhầm 26 files từ thư mục peer đang active, bao gồm attachments-staging/storage. Đây là lỗi fixture scope của worker. Đã phát hiện và SIGTERM exact current own runner PID36821 sau kiểm command chứa đúng absolute umbrella, không delayed PID-only kill. PID birth chưa được ghi trước signal, không có claim birth verification; test child PID36918 có trong structured log. Runner exit143; giữ nguyên `covering-interrupted-peer-scope.log/json` (19 tests,11pass/7fail/1cancel,29501.618708ms).

Failure được thấy: `HTTP bounded docs upload exceeds ordinary1MiB and app shutdown closes real SSE` (fetch EPIPE; corrected covering PASS), cùng6 attachment staging tests: reserves/ready commit; name/MIME/size; wrong bytes/UTF/binary/magic; split UTF16 BOM; ready replay metadata; generation CAS superseded (RESPONSE_INVALID). Không sửa peer code để làm GREEN. `attachments-storage` chưa có captured completion trước interrupt.

Attachment test callbacks gọi `databaseFixture(9)` và log đã vào receive sau migration: **009 đã được áp trong private logical test DB của mistaken run**, không phải migration missing hoặc approval009. Không chụp schema/checksum9 trước cleanup nên không claim checksum đã-applied. Gate Task2/009 vẫn không được nâng. Đây là scope/infra cost của FIX1, không FIX2, không semantic review reset. Các private DB biến mất cùng exact own container. Interrupted attachment filesystem scratch roots không có identity/path trong retained log, nên không có independent exact-path cleanup proof cho chúng; không xoá thư mục theo prefix hoặc chạm peer scratch.

## Cleanup và evidence freeze

Corrected container `ece55363e170d44b23a9fa640bb7b8d9318cd89c6cc0c2addd512bbac0a37f09`, random loopback port57949. Prefix7 backup source `crew_v2_test_06a677751b364aa5b73ab0f758e74f8c`, restore `crew_v2_test_0b5e6a0cfd86455ebdb345bf6cb7ac42`; finally drop/close captured. Interrupted container `dabd3b09ec5e79c3b27920222ee4d351903a47d8ae5e6658d1a801b94054af7e` cũng absent. Tổng5 exact own container IDs kiểm `docker ps -a --quiet --no-trunc --filter id=EXACT`, exit0/output rỗng, không stop/prune container khác; JSON ghi đủ từng ID.

Một own absolute umbrella root `/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-v2-model-fix1-mzr2137j`, đúng2 files models.test.ts/server.test.ts được copy freeze trong evidence, unlink rồi rmdir; exists=false. Source tests thật giữ nguyên. Checksums.json bao phủ logs/commands/exits/inventory/exports/frozen hashes/fixdiff/umbrella source/cleanup. Không credential thật trong outputs.

## Review handoff và giới hạn

PM stage chính xác7 owned files cùng reports/evidence; original reviewer đọc full binding R1–R4 và **NEW fixdiff** scoped từ e94f2e1, lifecycle ruling, final hashes/logs. Không replay full original3844-line diff hoặc gateway/009 unfinished. Không mark hệ thống READY trước verdict độc lập. Native/live capability/isolation/observer/signing/process-wide negative probes, Keychain write/read-back/ACL, DNS pin/redirect và genuine runtime RELEASE remain UNVERIFIED như report gốc.

Unresolved questions: không có câu hỏi cần owner. Limitation cleanup: interrupted attachment scratch exact-path identity không được captured; cần peer/controller ownership evidence nếu muốn xác minh phần ngoài scope đó.
