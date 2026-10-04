# Review độc lập Task05/2a — producer và migration010

**SPEC: READY. QUALITY: READY.** Không có finding cần sửa trong sáu path của candidate `f6d3728077dcb53ef7544acdfa86d34f4eadd91e`. Producer attachment-comment và forward migration010 đáp ứng scope Task2a cùng ruling PM16:53. Consumer Task2b có thể được PM mở gate sau nghiệm thu này; báo cáo không chứng nhận implementation consumer, public routes hoặc toàn phase05.

## Scope và tính nguyên vẹn

Đã đọc full brief Task2a, phần Task2 của approved phase05 plan, report/inventory/evidence/cleanup/freeze, schema-plan amendment, PM rulings16:41/16:53/17:10 và flow server-tickets trước source. Đã review toàn bộ sáu-path patch gồm contracts, decisions, factory, new producer test, flow và010; đối chiếu actual legacy appendComment, scope helper, caller mutator, migration runner và trigger009 đã review. Không tính peer model/gateway/isolation code giữa baseline và candidate vào kết luận.

- Task-only patch SHA256 `ecf4fd182d4cc8e6b0128972204938088cb4752404069fecd1c9de929497b846`, đúng6 files.
- Cả6 own SHA/bytes khớp candidate và live source. Accepted migration001–009 và3 file Task1 FIX1 tại ec02ac0 cũng khớp inventory; không sửa accepted SQL.
- Đã kiểm5 frozen artifact hashes và10 captured run log hashes. Source manifest233 entries đối chiếu từng entry với Git:223 baseline f58 files,3 accepted ec02ac0 overlays,6 candidate own files,1 saved wrapper. Exact covering5 files; không lấy unfinished peer source hoặc glob test suite.
- Migration010 SHA256 `aa2a308ba8a180186e57fb08f93fac7195fc6c0468b821f96c107f4e13ccf59d`,253 bytes. Full prefix001–009 được ghim trong test và inventory.

## SPEC — producer và transaction

`CommentAttachmentInput`, `CommentAttachmentLinker`, `AppendAttachmentComment` được thêm đúng port contract; dependency `commentAttachments` optional. `createTicketServices` chụp reference callback vào immutable dependencies lúc tạo. Thay property callback của caller sau đó không thay authority; factory ban đầu thiếu callback tiếp tục default-deny. Không sửa CreateTicket hoặc public legacy appendComment signature/body semantics.

New method kiểm linker trước INSERT và trả503 `ATTACHMENT_LINKER_NOT_CONFIGURED` nếu chưa cấu hình. Text phải là string, dài tối đa32768, có text.trim hoặc requested attachmentIds không rỗng. Requested IDs chỉ đi tới trusted callback, không là ready proof; không có client allowEmpty/count/dummy whitespace authority. Việc validate compose/revision/exact ready originals thuộc linker tin cậy, không bị thay bằng số lượng IDs do request khai.

Thứ tự source đúng `requireTicket` → INSERT comment → `await linker` → một existing `comment.created` `{commentId}` → response, tất cả dùng cùng Tx caller. Producer không begin/commit riêng, không bump input revision và không phát nội dung text/file trong event. Linker có thể đọc inserted comment nhưng chưa thấy producer event; khi linker throw, lỗi propagate về actual mutator để rollback comment/link/event/input counters.009 BEFORE INSERT trigger vẫn là sole fanout writer. Test xác nhận root/descendants tăng đúng một lần, unrelated root không bump và callback failure sau link/event write rollback đầy đủ.

Legacy appendComment vẫn chấp nhận whitespace và từ chối empty string400; new method từ chối whitespace-only khi không có requested originals, nhưng giữ nguyên whitespace nếu có valid ready selection. Text đúng32768 được nhận; over-limit/non-string bị chặn trước callback. Actual test-owned linker kiểm compose target/revision/state/exact set, actual `ready`/`durable_at` rows và bytes qua reviewed BlobStore, rồi INSERT links cùng Tx. Fake UUID, missing và reserved originals không được dùng để commit attachment-only comment.

Test-owned linker là evidence cho port/transaction, không là consumer được nghiệm thu. Scope/current binding authorization, lockSubmissionScope, selection race/replay, retained latches/quota/extraction/authorizations vẫn thuộc Task2b/3/6. Caller phải dùng mutator transaction và không nuốt linker failure rồi commit partial work; điều kiện này được ghi rõ trong handoff.

## SPEC — forward-only010 và numbering

Actual prefix9 failure23514 được giữ nguyên làm bằng chứng cận dưới1 của `004.comments_text_check` chặn empty INSERT trước linker. Ruling16:53 cho phép đúng NEW010. SQL mới chỉ drop/re-add cùng named check thành `length(text) between 0 and32768`; không sửa column, NOT NULL, FK, max length hoặc009 triggers. Migration runner hiện có bọc toàn migration transaction và kiểm prefix checksum, nên không có khoảng committed schema thiếu check. Không yêu cầu rewrite004/009 đã nghiệm thu.

DB sau010 cho phép zero-length text; semantics attachment-only được giữ ở default-deny producer và actual-ready callback. Không có generic empty-comment HTTP route mới trong candidate. Legacy service guard vẫn bảo toàn hành vi public cũ.

Actual rehearsal bắt đầu9: giữ existing comment rows gồm text/timestamps và input revisions qua upgrade10; backup9→restore→migrate10 và backup10→restore giữ metadata/empty comment; migrate lặp idempotent; altered010 với recomputed hash vẫn bị `MIGRATION_DRIFT`. DB null/over32768 vẫn trả23502/23514. Test so stable FK names/definitions và named noninternal009 trigger timing/event/function definitions qua upgrade/restore. Việc bỏ so generated internal RI trigger OID names là sửa assertion fixture phù hợp; không bỏ kiểm FK thực tế.

Đã đọc amendment và đối chiếu recorded after-SHA với current plans05/06/08/09: khớp cả4. Ruling dành010 cho phần05 và chuyển numbering future Assistant/integration/operations thành011/012/013; không tạo các migration tương lai hoặc thay đổi authority của chúng trong Task2a. Historical approval hashes được giữ theo ledger/addendum. Consumer phải dùng prefix10 cho attachment-only producer; ví dụ Task2 cũ prefix9 không thay thế điều kiện mới này.

## QUALITY — kiểm thử và evidence

| Captured run | Kết quả và ý nghĩa |
|---|---|
| `task-2a-red.log` |9 total,1 legacy PASS,8 missing-method failures: RED đúng feature. |
| `task-2a-green.log` |9 total,5 PASS/4 failure23514: phát hiện actual prefix9 prerequisite, được giải quyết bằng forward010. |
| `task-2a-prefix10-green.log` |10 total,9 PASS/1 restore assertion failure do generated internal trigger names; failure giữ nguyên. |
| `task-2a-migration-green.log` |Whole corrected forward/restore case1/1 PASS riêng. |
| `task-2a-cover-final.log` |**29/29 PASS**, exact tickets/dependencies/completion/repair/new producer files; gồm final stable FK/009 trigger assertions. |
| `task-2a-input-revision-final.log` |**1/1 PASS riêng**, accepted prefix9 actual legacy root/descendant fanout/rollback. |
| Source-freeze types/Biome |Strict typecheck exit0;4 owned TS files Biome sạch/no fixes. |

29/29 là final captured covering thật, không phải hợp các focused runs. Legacy1/1 được báo riêng; không nâng thành full-server hoặc30-case cover. Review đọc nguồn test và log/assertions, không chỉ dựa worker self-report. Existing tickets tests dùng baseline prefix4; new producer uses10, forward test starts9 và legacy fanout uses9 đúng mục đích từng case. Không cần narrow canary mới hoặc redundant broad rerun vì không phát hiện gap cụ thể chưa có chứng cứ.

## Cleanup, handoff và unresolved

Cleanup receipt kê6 exact full private PG IDs inspect absent,40 owned roots có create/remove và host-absence proof,5 restore databases có create/drop receipts. Root nonce/dev/ino/UID và process/container/port/command provenance được ghi; snapshot233 hashes được kiểm, children closed rồi exact identity verified trước removal. Đây là captured cleanup evidence đã kiểm hash, không phải live global sweep của reviewer. Không có image prune, unknown-resource deletion hoặc shared-service cleanup được reviewer thực hiện.

Reviewer chỉ dùng read-only source/Git/hash/evidence inspection và tạo báo cáo này; không sửa source/Git/package/manifests/DB, không spawn agent, không tạo fixture/container/socket/scratch và không gọi live/provider/owner credential. Không có tài nguyên mới cần dọn.

Không có finding hoặc câu hỏi unresolved trong Task2a. Consumer Task2b/public routes/grants/extraction/quota/replay/races vẫn chưa được nghiệm thu. Stage/storage accepted ec02ac0 tiếp tục là producer prerequisite; verdict Task2a không thay thế các gate còn lại của phase05.
