# Task05/2a — Producer và migration010 source freeze

**SOURCE_FROZEN_FOR_INDEPENDENT_PRODUCER_AND_010_REVIEW.** Actual PostgreSQL producer/schema verification GREEN; chưa Task2a accepted. Consumer Task2b MUST chờ independent SPEC+QUALITY review cả producer và010. Worker dừng ở source/report freeze, không triển khai consumer hoặc public routes.

Brief `task-2a-brief.md`, approved Task2 và PM addendum16:53 được đọc. Baseline thử nghiệm `f58f27dc96b964d034697a67c5677fb1d3bbacb2:v2` + exact ba Task1 FIX1 file được review tại ec02ac0 + own producer/010. Chỉ sáu path ở inventory dưới đây được sửa; không revert/import unfinished gateway/model peers, stage/commit, tạo agent/worktree, sửa dependency/package/app/routes/manifests/shared support/global settings/hooks hoặc accepted001–009.

## Producer đã triển khai

- `CommentAttachmentInput {composeSessionId,selectionRevision,attachmentIds}`, `CommentAttachmentLinker(tx,{commentId,ticketId,attachments},actor):Promise<void>` và `AppendAttachmentComment` bổ sung vào tickets contracts; optional TicketServiceDependencies.commentAttachments.
- Factory giữ reference callback trong immutable dependency snapshot lúc tạo. Caller thay callback sau đó không thay hành vi; factory tạo khi thiếu callback vẫn từ chối dù caller bổ sung callback sau. New method mặc định503 ATTACHMENT_LINKER_NOT_CONFIGURED trước INSERT.
- New method yêu cầu text là string<=32768, và text.trim có nội dung hoặc requested IDs không rỗng. Requested IDs chỉ cho phép đi tới trusted linker, không chứng minh ready set. Linker do controller inject, không request dependency/allowEmpty/count/dummy space. Original legacy appendComment giữ nguyên signature và body: whitespace được chấp nhận, chuỗi rỗng vẫn400 VALIDATION; CreateTicket không đổi.
- Trong caller Tx: requireTicket scope → INSERT comment → trusted actual-ready linker → một existing comment.created event `{commentId}` với project/ticket metadata. Linker thấy comment trong cùng Tx nhưng chưa có producer event. Failure propagate tới caller mutator, rollback comment/links/event và input fanout. Producer không tự begin/commit hoặc tăng input revision;009 trigger là writer duy nhất.

Test-owned linker dùng actual StageServices reserve+receive, durable ready rows, exact compose selection và store.verify original bytes, rồi insert links trong cùng Tx. Nó không là consumer selection/replay/submission/retention/accounting/grants/extraction implementation; chưa kiểm Task2b races hoặc quota release.

## Actual schema finding và ruling

Prefix9 đã chứng minh comments_text_check của frozen004 chỉ nhận length(text)1..32768, khiến empty attachment-only INSERT lỗi23514 trước callback. Không làm giả success bằng whitespace và không sửa accepted004/009. PM ruling16:53 chuyển ownership NEW010 forward-only vào batch producer: chỉ DROP/ADD comments_text_check thành length0..32768. NOT NULL, max32768, columns/FKs và009 triggers không đổi; file001–009 byte-identical được so với baseline và assert checksum trong tests.

010 hiện cho phép lưu zero-length text ở mức DB. Legacy API vẫn từ chối empty; new method cần configured trusted linker kiểm actual ready selection trước commit. Không thêm generic empty HTTP route. Consumer và controller wiring phải được review trước khi tích hợp.

`010_attachment_comment_text.sql`:253bytes, SHA256 `aa2a308ba8a180186e57fb08f93fac7195fc6c0468b821f96c107f4e13ccf59d`. Future numbering011/012/013 do PM amend, worker không sửa plan/schema tương lai.

## TDD và kiểm chứng cuối

Exact commands, exits, counts, log SHA và source manifests trong `task-2a-evidence-final.json`; mọi failed log giữ nguyên, không suy hợp các lần chạy thành pass.

| Log dưới logs/ | Exit / counts / ý nghĩa |
|---|---|
| task-2a-red.log |1,9total1pass8fail: legacy whitespace PASS, new method thiếu nên assertion fail đúng feature |
| task-2a-green.log |1,9total5pass4fail: actual prefix9 schema23514; before-insert deny, legacy, mixed/whitespace, invalid/max và32768 PASS |
| task-2a-prefix10-green.log |1,10total9pass1fail: cả9 producer PASS; own restore fixture so tên internal RI trigger chứa OID nên fail khi restore cấp OID mới |
| task-2a-migration-green.log |0,1/1 whole forward/restore case sau scope assertion named noninternal009 triggers |
| task-2a-cover-final.log |0,29/29,5.287s: final explicit tickets/dependencies/completion/repair/new producer files; gồm final stable FK pg_constraint definition assertions |
| task-2a-input-revision-final.log |0,1/1: existing accepted prefix9 legacy appendComment root/descendant single fanout và rollback |
| task-2a-typecheck-source-freeze.log |0, strict types trên final frozen checkout |
| task-2a-biome-source-freeze.log |0,4 own TS files, no diagnostics/no fixes |
| git diff --check trên own tracked TS/R3 |0 |

Final new10 tests chứng minh: default deny trước INSERT; legacy whitespace/empty; actual attachment-only/mixed; whitespace-only không attachments từ chối; maxtext; fake/missing/reserved IDs không cấp empty authority; callback sau link/event write lỗi rollback; callback replacement không đổi factory; root/descendants fanout đúng một lần và unrelated root không bump; upgrade9→10 và backup restore.

Migration rehearsal dump9→restore→upgrade10 giữ existing comments/timestamps/input revisions; actual empty producer sau upgrade thành công; dump10→restore giữ empty comment cùng metadata. Prefix checksums001–010, idempotent migrate, deliberate correct-hash010 drift bị MIGRATION_DRIFT. NOT NULL và over32768 vẫn bị DB23502/23514. Named009 trigger function/timing/event definitions và stable FK names/definitions trước/sau upgrade/restore bằng nhau; không so generated internal RI OID names. Dump buffers bounded4MiB trong memory, không dumpfile/credential export.

## Isolation và cleanup

`task-2a-source-manifest-final.json`:233 frozen files + private root marker; git archive member path/type validated, readonly files/dirs; accepted ec3 và own6 overlays. Normal pnpm/ancestor dependency resolution, không dependency copy/symlink/install. Before/after SHA giữ nguyên; exact test imports không lấy current peer source. Existing regression fixtures dùng prefix4 theo baseline của chúng; new producer dùng prefix10, forward test bắt đầu9, separate legacy input test9. Không gọi blanket server glob.

PM resource receipts16:41 RAM40%free CPU81.11%idle38GiB;16:53:32 RAM37%free46.13%idle38GiB. Đây là sample từ PM, không runtime certification. Actual tests dùng private PostgreSQL18.6/random127.0.0.1port/crew_v2_test_*; không shared55432/default5432 ngoài private container, provider/model/live service/ownersecret/Keychain/globalHOME mutations. macOS test-owned receiver port chứng minh storage/terminal protocol đã review, không native process-gone/certification mới.

`task-2a-cleanup-final.json`:6 exact full container IDs inspect exit1 no such object;40 scratch roots đều created/removed và host absent;5 restore databases có created/drop receipts. New fixture receipts ghi exact container/port/database/PID/command, root nonce hash/dev/ino/UID trước stage work. Accepted legacy fixture giữ nonce/dev/inode checks nội bộ. Snapshot233 SHA verified, children closed, exact nonce/dev/ino/UID đối chiếu trước chỉ chmod own dirs và xóa exact snapshot. Không patternkill/container delta/shortID delete/prune shared image hoặc xóa resource peer.

## Frozen owned inventory

| Path | SHA256 | Bytes |
|---|---|---|
| v2/server/src/tickets/contracts.ts |352f831eb2d23d96dccefd07b45ec41e3e2a82c25912307c2cea1eaea3ff485a|3156|
| v2/server/src/tickets/decisions.ts |93ffcd5601bbeb3754778bfab12907f0d62bf6ec2a726623ae98c17a2f46aa5c|7009|
| v2/server/src/tickets/service.ts |e235e098fea042ce9be79b9bfc9e61a5f7c9b4f85c141bb6049463f5d24e619c|16424|
| v2/server/test/attachments-comment-factory.test.ts |1e887655dc5d15aa6c3d44e6bd9d3d5b46955e18a903eb7730ac2c3a020aedd2|22759|
| v2/docs/flows/server-tickets.md |393858020f7b19929f5217b10616a1f498f490cf4f782ec2f9c05c99b1a0b55d|11178|
| v2/server/migrations/010_attachment_comment_text.sql |aa2a308ba8a180186e57fb08f93fac7195fc6c0468b821f96c107f4e13ccf59d|253|

Full immutable001–009 and accepted ec3 hashes, exact five covering file hashes và separate input revision pattern trong `task-2a-source-inventory.json`; original Task1 report/inventory không đổi. R3 server-tickets cập nhật producer và010; PM map new test/010, generate/staged docs và Git serialize. Worker không bypass known compiled-docs hook restriction.

## Handoff và gate còn lại

Controller inject trusted CommentAttachmentLinker vào createTicketServices khi có consumer đã review. Method `appendAttachmentComment(tx,ticketId,{text,attachments},actor)` chỉ được dùng trong caller-owned mutator Tx với actual selection validator, không generic request-controlled dependency. Existing appendComment/CreateTicket vẫn như trước. Caller rollback là điều kiện của port; không catch lỗi linker rồi commit partial comment.

Task2a chưa accepted; independent review phải bao gồm full six-path diff, default-deny/immutable factory/legacy behavior, actual010 upgrade/max/NOTNULL/FK/trigger invariants và atomic event/fanout rollback. Semantic review fix waves consumed0. Task2b consumer, replay hashes, retention/quota/grants/extraction và app wiring chưa thực hiện; gate giữ đóng đến SPEC+QUALITY READY.
