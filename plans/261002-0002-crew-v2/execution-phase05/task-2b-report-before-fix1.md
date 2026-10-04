# Task05/2b — Consumer source freeze

**SOURCE_FROZEN_FOR_INDEPENDENT_CONSUMER_REVIEW.** Final explicit cover51/51, strict types và scoped Biome PASS. Chưa independent SPEC/QUALITY acceptance; Task3/API/grant/access/runtime/extraction/recovery vẫn gated. Không commit/stage, tạo agent/worktree, sửa package/manifest/app/host/global/shared service hoặc import unfinished gateway/model/isolation/extractor peer source.

Đã đọc task-2b brief, approved Task2/S1–S3/R1, docs index và flows. Baseline readonly `f58f27dc96b964d034697a67c5677fb1d3bbacb2:v2` + exact ec02ac0 ba FIX1 files + f6d3728 sáu producer/010 files + PM228f9e4 ba event producer files + own tám paths. Producer contracts/decisions/service và migrations001–010 byte-identical với accepted candidates được kiểm trước/sau final source freeze.001–009 không rewrite;010 SHA `aa2a308ba8a180186e57fb08f93fac7195fc6c0468b821f96c107f4e13ccf59d`;009 SHA `fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a`;008 SHA `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f`.

## Source inventory

`task-2b-source-inventory.json` có bytes/SHA từng owned source và001–010, accepted overlay IDs; SHA `8b3929aacbe9e2245b61f6a3f658d481d79c156ab263849ed70ff2533d40c281`.

- NEW `v2/server/src/attachments/submissions.ts`
- NEW `v2/server/src/attachments/messages.ts`
- NEW `v2/server/src/attachments/routing.ts`
- NEW `v2/server/test/attachments-submissions.test.ts`
- NEW `v2/server/test/attachments-messages.test.ts`
- NEW `v2/server/test/attachments-routing.test.ts`
- `v2/server/test/support/attachments.ts` — exclusively transferred fixture; actual readyCompose/guard port và UID/resource receipts, original native support giữ nguyên.
- `v2/docs/flows/server-attachments.md` — R3, entries/files/state/authority/integration limits.

Own patch `task-2b-task-only.patch` SHA `7fefb008859a102a6cede0571e88b3980a2e3f69087af244aff17da64e108a77`. Parent producer228 overlay: journal/event-contracts.ts, attachments-events.unit.test.ts, server-journal R3; producer có inventory riêng. PM serialize R2 manifest/generate/staged check, Git và full independent consumer review; worker không sửa manifest.

## Consumer và trusted ports

PM port ruling được dùng đúng scope: readonly BlobStore.verify; captured actual createTicketServices factory được cấu hình với bound linkSelection callback; optional immutable queuePolicy từ trusted composition. Không sửa frozen producer hoặc request-controlled callback. Factory capture verify/factory/clock/authority; policy copy được Object.freeze. Files mặc định503 nếu policy chưa cấu hình. Test version `fixture-pending-only` và config hash chỉ chứng minh protocol queue pending; production phải bind worker/config đã review thật, chưa certified extraction output.

Ticket/comment wrappers chạy toàn bộ trong caller journal mutator Tx. `authorizeSubmission` phải đặt vào Mutator.context.authorize để kiểm trước cached replay; wrapper kiểm lại current owner/scope trước per-compose replay. Malformed target UUID trả400 trước PostgreSQL. Sorted root/affected descendants/project/input locks trước compose/uploads; owner quota lock cùng key với reviewed reserve. Exact active set/revision/purpose/target/expiry, duplicate400, foreign404, omitted/stale409, unavailable422. Chỉ abandoned được loại; mọi reserved/receiving/rejected/missing/deleting/deleted slot vẫn thuộc active set và không thể omission. Original phải real ready+durable, matching closed receiver/stop proof ID/generation/writer instance, readonly verify bytes/hash/length. Không mutation filesystem trong Tx.

Normalized hash gồm complete ticket hoặc text/target, selection revision, sorted unique IDs, assistantRead defaultnone. Immutable per-compose response được kiểm trước fresh selection; same body/new key trả exact receipt, changed body/permission409. Replay không authorize thêm, tạo target/event/job hoặc sửa quota. Linker INSERT links/retain/job trước producer comment.created; failure rollback comment/link/event/receipt/latches/counters.009 là writer duy nhất tăng inherited comment input; wrappers không bump lần hai. linked_at/quota_released_at được latch cùng committed selected submission, original được retained vĩnh viễn qua revoke, pending jobs unique original/version/config. Selected-inputs chỉ tạo exact owner authorization target ticket/message, submitted-inputs, allowOriginal=false, expiry24h; không grant/session/proof.

Message factory giữ caller Tx signatures createConversation/submitAssistantMessage/persistMessageInputDecision. Conversation owner mutation idempotent. Message canonical client UUID identity không phụ thuộc compose; digest gồm conversation/text/sorted original IDs+hashes/permission. Same client/payload dưới compose/key khác trả immutable original response; unused retry compose giữ open, không giữ thêm original/quota/authorization. Changed client payload409. Message bytes/text/client/hash immutable, không tạo ticket lúc gửi inbox. Một actual registered assistant.message.created chỉ `{messageId,inputRevision}` với project/ticket/audience null. Consent none không authority.

Persisted message decisions có target/revision/body digest riêng. Owner explicit routing có thể null snapshot/grant/receipt, body pin full ticket+expectedRouteRevision. Future machine/scope/reply bridge defaultdeny INPUT_DECISION_NOT_CONFIGURED; machine còn cần grant/snapshot/all-selected receipt matching revision và trusted authority xác minh lifecycle thật. Không tạo giả grant/session/snapshot/receipt hoặc thay phase02 decision bằng fake ticket.

Routing factory default INPUT_ROUTING_NOT_CONFIGURED. `authorizeMessageRouting`/factory authorize dành cho Mutator pre-cache guard; actual actor/project binding và persisted decision target/revision/actor/canonical body/digest được kiểm trước receipt replay. New route gọi actual createTicket, links cùng original UUID. Correction CAS message input/route revision; khóa sorted old/new roots, targets, project/input/message; active/uncertain/finalizing attempt dù lease expired hoặc running/unknown session ⇒ ROUTE_IN_USE. Missing retirement ⇒ ROUTE_CORRECTION_NOT_CONFIGURED. Trusted retirement bridge phải dùng service authority; tests dùng actual signalTicket(wait_owner), không direct workflow UPDATE. Old route links/grants revoke cùng Tx, old descendants/message counters tăng; immutable snapshots stale qua counters, không update/delete. Audit/originals giữ. Route replay trả acceptance receipt revokedAt=null; không cấp current read authority. Chưa có actual authorized Assistant designation trong composition nên không phát attachment.input.changed audience giả; ticket.created có scope ticket thật.

## Verification và failure history

`task-2b-evidence-final.json` ghi exact commands/child exits/counts/log SHA/source manifests; SHA `f8f1915b7e7f6a63882990923b18875eef88d66d6116191f7d6b46290fde164a`. Không hợp các run thành union PASS.

| Logs/task-2b-* | Child exit / kết quả |
|---|---|
| red |1,3/3 feature failures: consumer chưa tồn tại trong real migrated fixtures |
| submissions-green |0,3/3: exact selection, rollback, canonical replay, concurrent once/accounting |
| messages-red; routing-red |1 mỗi run, actual57P03 startup trước feature; không gọi feature RED |
| routing-red-feature |1, actual fixture migrated, routing module chưa tồn tại |
| messages-routing-green |1,1/2: fixture kỳ vọng MESSAGE conflict cho changed body cùng compose, actual correct COMPOSE conflict |
| inbox-routing-green2 |0,2/2; fixture thêm different-compose changed client payload để kiểm MESSAGE conflict riêng |
| submissions-negative |1, cancelled1: worker đặt nhầm block test trong selection helper gây recursive registration; exact owned CLI bị SIGTERM, không production finding |
| routing-lifecycle |1,5/6: CAS assertions đã đúng; fixture cuối query ticket.status thay vì actual ticket.changed |
| consumer-focused |0,16/16 sau sửa test placement/event query; tất cả thất bại giữ log |
| typecheck-pre-freeze |1, own5 type errors; corrected discriminated target/readonly array/JSON narrowing |
| typecheck-green |0 |
| terminal-selection-red → green |1→0, ready row + nonterminal receiver must reject trước retain/quota; focused actualPG1/1 |
| cover-final; typecheck-final; biome-final |0,50/50 + types/Biome trước target validation concern |
| target-validation-red → green |1→0: actual22P02 malformed UUID trước producer → VALIDATION400 trước SQL/cache, focused1/1 |
| cover-source-freeze |0,51/51,9.032s; final after last production change |
| typecheck-source-freeze; biome-source-freeze |0; final strict types và7 own TS files không diagnostics/fixes |

Final explicit nine files: tickets, dependencies, completion, repair, attachments-comment-factory, attachments-submissions, attachments-messages, attachments-routing, attachments-events.unit. `--test-concurrency=2`; ordinary pnpm exec node --test từ readonly snapshot. New consumer19 trước malformed case, final20; accepted ticket regressions19 + producer10 + root event2 ⇒51. New consumer fixtures prefix10; accepted ticket fixtures dùng prefix của chúng; producer forward/backup case bắt đầu9 rồi migrate10. Full51 có real reserve+receive bytes, actual store missing fault, nonready/deleting slots, abandonment/expiry, quota full→retained→new reserve, latch invariance, event failure rollback, cached guard, client UUID concurrent once, actual wait_owner retirement rollback/CAS, actual claim record + expired lease still in-use, policy/verify capture và defaultdeny. Producer test giữ legacy whitespace/empty và009 single fanout; forward/restore/prefix hashes vẫn PASS. Không broad server/peer suite hoặc native runtime test mới.

Cover50 trước target fix được giữ nguyên. Actual new22P02 concern là lý do sửa own production và cover51 sau đó; không rerun chỉ để xanh. Source inventory trước target fix giữ riêng. Final source hash đúng frozen manifest240 files, trước/sau chạy không đổi.

## Resources, cleanup và giới hạn chứng cứ

PM samples17:17:35 RAM47%free/CPU78%idle/disk38GiB;17:43 RAM45%/CPU63.91%/disk37GiB. Samples không runtime certification. Private PostgreSQL18.6 bound random127.0.0.1 port, own full container ID/name/nonce label, memory256m/CPU1/pids64. Evidence-only launcher kiểm actual TCP SQL select1 trước feature vì socket pg_isready của baseline có temporary-server startup race; không sửa baseline scripts/support db. Host Node24.14.0; không claim immutable Linux/native execution mới.

Archive members validated path/type trước extraction; exact nonce/dev/ino/UID root trước scratch, chmod readonly, ancestor dependency resolution, không dependency copy/symlink/install/hook bypass. Child argv/PID/exit và private DB ID/port/command nằm per-run evidence; after child closure đối chiếu source SHA+marker+identity trước cleanup. Docker --rm removal có thể asynchronous; launcher poll exact ID bounded để quan sát absence, không patternremove/shared cache cleanup.

`task-2b-cleanup-final.json` SHA `538d832919d6535da61f52c9114d94fb0a37d4a8f04e6be3b9185e65fc004441`:14 captured full IDs inspect no such object;880 recorded roots host absent;4 restore DB create/drop receipts; mọi tracked readonly snapshot absent. Interrupted recursive fixture có784 root receipts:783 đã tự remove,1 residual được cleanup chỉ sau exact owned nodes18206/18207 absent và marker nonce hash/dev/ino/UID khớp. Own CLI18206 argv xác minh đúng frozen nonce path trước SIGTERM; worker đã đóng cùng parent, không patternkill hoặc fabricate terminal native ACK. Initial Python3 extractall(filter=) unsupported tạo một empty root; exact path/dev16777229/ino63906863/UID501/empty contents verified trước rmdir. Case-sensitive rồi asynchronous Docker absence assertions giữ failed evidence; exact roots được SHA/nonce identity reconciliation sau actual container absence. Không ảnh hưởng production bytes.

**Hai startup57P03 run dùng original reviewed launcher không in full private container ID.** Original finally-stop exit không báo cleanup failure; worker không có full-ID absence proof cho hai run này và không suy14 captured IDs bao phủ chúng. Limitation được giữ trong evidence/cleanup, không tìm/xóa container bằng prefix. Subsequent own launcher có exact IDs, SQL readiness và cleanup observations.

Actual claim-in-use test chỉ tạo durable record bằng actual claim API với private fixture authorization; không launch native process/model/provider, không certified stop/read/extraction. macOS receiver fixture chỉ protocol; accepted Task1 Linux evidence riêng không tính thành Task2b native proof. Không shared dev55432/default host5432, owner secret/globalHOME/Keychain, live provider/paid call hoặc peer source mutation.

## PM handoff

Full independent SPEC+QUALITY consumer review gồm own eight paths, fixture/test diff, PM228 producer three paths và accepted producer/schema contracts. PM mapping/Git/consumer acceptance trước Task3/public integration. Wiring tương lai phải sử dụng pre-cache guards, reviewed actual worker/config identity, authorized Assistant/grant/session decision lifecycle và actual retirement authority; absence vẫn fail closed. Chưa có API/access/grant/extractor/recovery certification hoặc deployment claim.
