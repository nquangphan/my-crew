# Review độc lập Phase05 Task1 — candidate f58f27d

**SPEC: NOT READY. QUALITY: NOT READY.** Có hai finding P2 cần sửa trong một batch trước nghiệm thu. Không tìm thấy blocker bổ sung trong schema009, publication/receiver protocol hoặc phần mở rộng HTTP test-only đã review. Kết luận này chỉ dành cho candidate dưới đây; không chứng nhận toàn phase05 hay production integration.

- Candidate: `f58f27dc96b964d034697a67c5677fb1d3bbacb2`.
- Task-only baseline: `556cd8d106715b0c3ccc5893e8383b44083230db`; original dispatch `ccb3498` được giữ trong brief. Không coi shared model changes đã review trước là Task1 mới.
- Full review package: `task-1-review-package-f58f27d.diff`, 19 files, 207145 bytes. Đã kiểm đúng inventory16 file nguồn/test/flow, cả bytes tại candidate và working tree đều khớp SHA/size frozen. SHA256 inventory: `94b7b85b060dadfaa17d2d8e69503a204a9d039ebec7e5b30ee4ea009e52cbb7`.
- Migration008: `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f`; migration009: `fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a`. Candidate không sửa001–008.
- Đã đọc root/v2 docs index, các flow attachment/journal/docs-view trước source; đọc full brief, frozen report, task source/test/support và diff integration. Không sửa source/Git/package/manifest/shared service; không tạo subagent, không broad test rerun.

## Findings — batch đầy đủ

### F1 [P2] PUT replay của original ready bỏ qua giới hạn thời gian đã chấp nhận

**Vị trí:** `v2/server/src/attachments/staging.ts:298–315`, đặc biệt vòng đọc body ở302–310; deadline/accepted policy chỉ được tạo sau branch này ở320–325.

Khi upload đã `ready`, service vẫn nhận và băm toàn bộ body để xác minh retry. Tuy nhiên branch đó chỉ kiểm signal caller; nó không dùng `accepted_config.uploadMaxWallMs` và không kiểm deadline trước khi trả success. Owner có thể gửi lại đúng original rất chậm, vượt max wall của policy đã lưu, rồi vẫn nhận `ready`. Nếu upstream không phát abort, nhánh này không tự đặt bất kỳ giới hạn thời gian nào. Điều này trái giới hạn upload max wall5min có thể giảm bởi operator trong brief; việc replay không mở writable FD không loại bỏ chi phí giữ request và băm bytes.

**Proof mới, hẹp:** gọi actual `createStageServices` với SQL/store/receiver ports hoàn toàn trong bộ nhớ, upload row `ready`, policy hợp lệ `uploadMaxWallMs=10`, body đúng `ok` đợi45ms rồi yield. Kết quả thực tế: `ready`, elapsed48ms. Không dựa trên HTTP fixture hoặc việc giả lập native receiver để suy production identity. Source branch trên tự xác nhận nguyên nhân.

**Sửa cần có:** dùng accepted deadline cho cả ready replay; giữ full-body length/hash verification và kiểm abort/deadline trước success. Quá hạn phải fail, original ready vẫn nguyên trạng. Không gán stop proof hoặc thu hồi quota vì timeout của replay. Thêm regression delayed replay vượt policy, replay đúng trong hạn, caller-abort; bảo đảm bounded owned stream được kết thúc đúng và không để timer/iterator lọt ra sau test.

### F2 [P2] Text một byte control được bỏ qua bước kiểm binary-text

**Vị trí:** `v2/server/src/attachments/staging.ts:408–411`; guard trong393–403 chỉ chạy khi decoder đã được khởi tạo từ prefix dài ít nhất2 bytes.

Với `note.txt`, declared `text/plain`, body chỉ chứa byte `0x01`, decoder chưa tồn tại trong vòng đọc. Cuối stream, code decode prefix nhưng bỏ kết quả, nên không chạy kiểm control character. `detect()` chỉ chặn NUL cho text không BOM; `0x01` vì vậy qua type gate và đến publication. Cùng dữ liệu control lặp hai bytes (`0x0101`) lại bị415. Đây là lỗ hổng cụ thể trong yêu cầu chặn binary masquerading as text trước publication, không liên quan đến extractor cấu trúc thuộc task sau.

**Proof mới, hẹp:** actual staging generator được consume bởi store port trong bộ nhớ. `0x01` đi hết checkedBody, qua current-writer check và chạm `PUBLICATION_BOUNDARY_REACHED`; `0x0101` bị `ATTACHMENT_BINARY_TEXT` trước boundary. Probe cố ý dừng ở boundary, không tuyên bố đã tạo original trên filesystem hay commit DB ready.

**Sửa cần có:** áp dụng cùng validator cho mọi string trả từ decoder, gồm prefix cuối stream và flush, hoặc kiểm text hợp nhất có cùng hiệu lực. Regression cho từng control byte không hợp lệ trong file1 byte; giữ empty text, ASCII1 byte, tab/LF/CR hợp lệ và split UTF16 BOM hiện có. Assert original chưa publish, terminal receiver đóng và quota vẫn giữ khi reject.

## Đối chiếu SPEC và chất lượng còn lại

| Nhóm | Kết luận trong Task1 và giới hạn |
|---|---|
| Config/types | Root tuyệt đối không default HOME, canonical policy hash, maxima/lower bound và deep freeze limits/extensions có mặt. DB accepted policy loại storageRoot. BlobStore/StageServices/ReceiverRegistry và S1–S3 shared types hiện hữu. F1 là thiếu enforcement trong replay, không phải thiếu config. |
| Durable bytes | Mỗi upload UUID có original/key riêng; không dedup theo checksum. Intent/owner marker trước bytes, exclusive stage, SHA/count, file fsync/close và directory fsync; hard-link exclusive không đè destination khác inode, kể cả digest giống. Stage/final cùng directory, symlink bị từ chối. Derivative cần trusted persistIntent trước byte write. Fault sau publication giữ original/intent. |
| Writer identity và ACK | Linux host/boot/PID namespace/PID/startTicks; parser field22 xử lý comm có ngoặc. Unknown/namespace mismatch fail closed. Operation phải settle và socket đóng trước durable closed ACK; replay sau local map release kiểm durable exact-operation proof. Không takeover/release chỉ vì lease hết. mac fixture chỉ là protocol port, không native proof. |
| Staging/quota/CAS | Owner checks nằm trong service, reserve khóa accounting/revision/scope và ghi identity/policy trước receive. Heartbeat không giữ transaction suốt network stream. Ready kiểm current generation/receiver/compose/abort/exact closed ACK và original presence. Abandon/reject giữ quota; SQL latch chặn original từng linked bị automatic deleting/deleted và chặn mở lại quota/identity. F2 là thiếu kiểm text cuối stream. |
| Journal | `attachment.changed` đúng ba metadata fields, UUID/enum/type/exactKeys; draft/inbox chưa live link owner-only; linked scope project+ticket đi cùng nhau, audience null. Ready append cùng mutation, event failure không xóa published original. Không có bytes/path/compose ID trong event. |
| Schema009 S1–S3 | Inbox conversations/messages/routes/decisions, unique client-message identity, input revisions, immutable snapshots/manifests/receipts/submission responses, authorizations scope submitted-inputs, grants/sessions/admission/provenance, extraction/derivative/GC/dispatch pins hiện hữu. Các composite scope/canonical hash/current grant/expiry/receipt-semantic checks thuộc service Task2/3/6; FK đơn lẻ không được dùng làm chứng nhận các gate đó. |
| R1 | Additive BEFORE INSERT trigger trên actual comments khóa root, affected descendants theo UUID và revision rows; lazy1→2, mỗi descendant một bump; không tạo event phụ hoặc sửa public appendComment/004. Captured actual legacy appendComment/rollback test hỗ trợ producer invariant. Claim/reply/child-create races với actual consumer vẫn là gate Task2/3/6. |
| Phạm vi/docs | Có flow attachments bảy heading, journal/docs-view cập nhật cùng code/test; controller manifest/generated docs bổ sung vào candidate. Không app/public route/extraction/access/dispatch source mới trong task-only candidate. Không yêu cầu mở rộng scope để đóng hai findings. |

`readCompose` hiện trả cả abandoned rows (lọc duy nhất deleted). Không xếp thành finding Task1 vì StageServices return type không hứa active-only; Task3 phải đáp ứng HTTP contract `active Attachment[]` khi map ra route. Tương tự, giá trị metadata extraction của staging là pending; API sau phải dùng extraction producer hiện hành. Đây là handoff gate, không bằng chứng API hiện có đã sai.

## HTTP test-only ruling và captured evidence

Đã review exact helper/test/doc diff. `ownerOversizedPost` chỉ dùng cho hai probe; cookie/Origin/CSRF/idempotency giữ như fixture. Content-Length là actual serialized body length vượt1MiB/24MiB, chỉ gửi64KiB prefix, deadline5s, response cap64KiB, body assertion cap26MiB. Không retry/new key. Chỉ complete HTTP response có status thật mới resolve; reset trước response reject, expected write error sau headers không được chuyển thành status413. Exact413 assertions, valid docs import đầy đủ >1MiB qua fetch thường và SSE socket shutdown assertion được giữ.

**Disposition:** phần sửa test-only đáp ứng ruling và không có finding. Nó đo server rejection theo declared oversized Content-Length. Nó không chứng minh invalid oversized body đã upload đầy đủ, và không sửa/chứng nhận production fetch client.

Đã đọc captured results, không rerun broad suites:

- `logs/server-cover-final.log`:253 tests,250 pass,1 fail,2 platform skips. Lỗi ở HTTP bounded docs upload/SSE là fetch ECONNRESET; Task1 có38 registered cases,36 pass/2 skips theo frozen report và covering inventory.
- `logs/api-baseline-focused.log`: unchanged case thất bại EPIPE với prefix6, ngoài attachment service.
- `logs/http-readonly-proof.log`: actual413 BODY_TOO_LARGE cho cả hai đường trước sửa helper.
- `logs/api-bounded-final.log`: whole repaired case1/1 pass, actual statuses413/413, valid large import và SSE shutdown cùng case. PG fixture ID `b20c8bcaa96195e12ad294232fbf6de3922e985aebf0507b9cfd5f1dc8973581` được ghi rõ.
- `logs/native-db-green.log`, `logs/db-staging-green.log`: Linux native/private PG evidence cho exact birth/terminal ACK replay và socket abort/heartbeat/no TTL takeover. `logs/migration-restore-green.log`: prefix008 restore→009, prefix009 restore, correct-hash altered009 bị MIGRATION_DRIFT. Không lấy các log này làm multi-process kill/reconcile/isolation proof.
- `logs/typecheck-final.log`, `logs/typecheck-http-final.log`, `logs/biome-http-final.log` và frozen report ghi checks sạch. Hai behavioral findings ở trên chưa nằm trong captured regression suite.

Không ghép full cover250/1/2 với focused1/1 thành253PASS. Sau sửa findings, controller cần focused regressions và các check phù hợp với production staging change; acceptance phải dựa candidate mới và review lại batch này.

## Narrow proof mới và cleanup

Lệnh đã chạy: `node --input-type=module` qua stdin tại worktree, import actual `staging.ts`/`config.ts`; không ghi fixture file. SQL port chỉ trả compose/upload/current-writer rows và dùng actual mutator/canonical path. Store port consume actual checkedBody rồi dừng tại publication boundary; ready replay dùng verify port present. Proof output:

```json
{
  "one": {"hex":"01","ready":false,"configuredWallMs":10,"elapsedMs":2,"outcome":"PUBLICATION_BOUNDARY_REACHED","reachedPublication":true},
  "two": {"hex":"0101","ready":false,"configuredWallMs":10,"elapsedMs":0,"outcome":"ATTACHMENT_BINARY_TEXT","reachedPublication":false},
  "replay": {"hex":"6f6b","ready":true,"configuredWallMs":10,"elapsedMs":48,"outcome":"ready","reachedPublication":false}
}
```

Exit0 với assertions cho cả ba outcomes. Review probe không tạo DB, container, filesystem root, socket, child process hay credential; service timers được clear qua finally và process đã exit. Đường `/tmp/unused-review-proof` chỉ là config string, không được tạo. Captured cleanup inventory có13 exact container absence inspections và48 scratch create/remove pairs; đây là bằng chứng worker đã chụp, không phải live inspection mới của reviewer. Giữ nguyên giới hạn narrow baseline fixture không in container ID, không suy cleanup từ global delta hay peer run.

## Gate chưa được nghiệm thu

- F1/F2: mở, cần regression và review candidate sửa; reviewer chưa thực hiện semantic fix wave. Controller quản lý tối đa5 waves.
- Task2/3/6: atomic submit/link/retained quota release, current grants/snapshots/receipt/canonical target validation, actual stale claim/reply gates, public route/auth/active list mapping và runtime bridge chưa được chứng nhận bởi Task1.
- Task7: actual writer process-kill→recovery nhiều process, retained-original recovery và extractor isolation/acceptance chưa được chứng nhận.
- Không còn câu hỏi cần owner trả lời để sửa F1/F2 trong scope hiện tại.
