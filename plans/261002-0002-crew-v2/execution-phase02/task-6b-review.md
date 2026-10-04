# Review độc lập Task 6 — Stage B

**Candidate:** `f2b9b3f45ad73bfee07b7c1283a70398409ace70`  
**Base:** `226120a`  
**Phạm vi:** 13 file, 1816 dòng thêm/8 dòng xóa của gói `.superpowers/sdd/phase-02-server-docs/review-226120a..f2b9b3f.diff`.  
**READY: NO** — cần sửa hai finding P2 bên dưới. Không có finding P0/P1.

Review đối chiếu `task-6b-brief.md`, báo cáo producer `task-6b-report.md`, các yêu cầu docs/import của spec được duyệt, root/v2 docs index và các flow docs-import/journal/execution/platform. Đã đọc migration 006, importer/sync/CLI, thay đổi whitelist, tests/support và metadata docs của candidate. Các file implementation được repro vẫn byte-identical candidate. Stage A đã reviewed và Task 5 đã reviewed được dùng làm dependency; không mở rộng review sang gateway hoặc Task 7.

## Findings

### P2 — F1: Nội dung UTF-8 chứa NUL qua validation nhưng không thể lưu bản gốc

**Vị trí:** `v2/server/src/docs/import.ts:198–200`, cụ thể câu INSERT tại dòng 200; các cột text liên quan tại `v2/server/migrations/006_docs.sql:33–35`.

`checkedFiles` chấp nhận byte UTF-8 hợp lệ chứa U+0000. `storeSnapshot` giữ bytea đúng nhưng đồng thời chuyển toàn bộ nội dung sang `search_text` PostgreSQL, và heading sang `title`. PostgreSQL text không nhận NUL nên một file đã qua checksum/UTF-8/size validation làm cả batch rollback. Điều này vi phạm yêu cầu giữ nguyên dữ liệu legacy kể cả khi nội dung không đạt cấu trúc; CLI dry-run cũng chưa phát hiện lỗi storage này. Import HTTP khi được lắp ghép sẽ nhận lỗi DB thay vì kết quả audit.

**Bằng chứng trực tiếp:** own fixture migration prefix 006, path `docs/superpowers/specs/probe.md`, class `workflow_artifact`, bytes `Buffer.from('# Artifact\nvalid UTF-8\u0000tail\n')` (28 byte). `validateDocsImport(input)` trả về thành công; `importWithKey` thất bại với SQLSTATE `22021`, message `invalid byte sequence for encoding "UTF8": 0x00`. Sau lỗi có 0 imports/files/idempotency keys.

**Sửa hẹp:** tạo projection phục vụ title/search có biểu diễn an toàn cho PostgreSQL, giữ nguyên `bytes`, SHA và snapshot identity. Nếu gặp NUL thì ghi nhận giới hạn biểu diễn/audit rõ ràng; không sửa byte gốc hoặc chỉ biến lỗi thành reject và gọi đó là bảo toàn dữ liệu. Rà các metadata lấy từ nội dung như href/fragment/audit message để không chuyển cùng lỗi sang cột text/jsonb khác.

**Regression cần thêm:** import UTF-8 có NUL ở body và heading, xác nhận import thành công, bytes/SHA round-trip đúng, projection an toàn và rerun không thêm snapshot/event. Một batch có project bình thường và project chứa NUL vẫn phải nhập trọn vẹn theo hợp đồng bảo toàn.

### P2 — F2: Generated FTS có thể từ chối tài liệu nhỏ hơn giới hạn 1 MiB

**Vị trí:** `v2/server/migrations/006_docs.sql:35` (`to_tsvector('simple',search_text)`); điểm kích hoạt INSERT `v2/server/src/docs/import.ts:200`.

Giới hạn byte của file không bảo đảm tsvector dưới giới hạn 1 MiB của PostgreSQL. Một artifact hoặc docs có nhiều từ khác nhau được validation chấp nhận, nhưng generated column vượt giới hạn và làm toàn bộ batch thất bại. Byte gốc không sai và chưa vượt bất kỳ giới hạn công bố nào. `storeSnapshot` dùng chung cho import/sync nên cả hai đường đều chịu lỗi storage này.

**Bằng chứng trực tiếp:** `Buffer.from(Array.from({length:120000}, (_,i) => 'w'+i.toString(36)).join(' '))`, cùng path/class artifact như F1, dài **672,011 byte**. `validateDocsImport` thành công; `importWithKey` thất bại SQLSTATE `54000`, message `string is too long for tsvector (1106616 bytes, max 1048575 bytes)`. Sau lỗi có 0 imports/files/idempotency keys.

**Sửa hẹp:** tách khả năng lưu byte gốc khỏi giới hạn của FTS. Dùng projection/chunk có giới hạn an toàn cho vector và quy định rõ phạm vi tìm kiếm; nếu cần giữ tìm kiếm toàn văn đầy đủ thì index theo chunk. Không hạ giới hạn file một cách ngầm định hoặc bỏ dữ liệu gốc để né lỗi. Flow docs phải mô tả giới hạn thực tế nếu projection tìm kiếm được giới hạn.

**Regression cần thêm:** file nhiều lexeme dưới 1 MiB phải lưu/replay được, raw bytes/SHA nguyên vẹn, index/search hành xử theo hợp đồng đã ghi; vẫn từ chối file vượt 1 MiB như hiện tại. Kiểm tra artifact này trong batch nhiều project để chứng minh FTS không làm mất khả năng nhập cả batch.

## Kết luận tuân thủ đặc tả

**Chưa đạt hoàn toàn** do F1/F2: tập dữ liệu importer chấp nhận rộng hơn tập storage có thể giữ, trong khi yêu cầu chính là bảo toàn byte legacy.

Các phần còn lại được đọc thấy phù hợp:

- Allowlist dữ liệu import, checksum/raw-byte/class, source identity `(source_system,legacy_id)`, project mới unbound và từ chối key/provenance collision.
- Transaction toàn batch; journal lock trước entity lock, duplicate bundle trả report cũ, snapshot giữ commit riêng, receipt fingerprint riêng từng attempt, rollback/retry/concurrency có test DB tương ứng.
- FK latest pointer cùng project, immutable rows, giữ link occurrence riêng, không cập nhật latest_verified từ import hoặc sync chưa được chứng thực.
- `authorizeDocsSync` là hook thực tại importer: kiểm tra current machine revocation, project/command/attempt binding, guard/fence, lease/finalizing/terminal intent, merged commit và evidence scope. `MutationContext.authorize` chạy trước cached response; test cached binding/fence và race revocation có quan sát pg lock wait. Flow ghi rõ Task 7 bắt buộc gắn callback này.
- CLI kiểm tra manifest byte hash, backup hash và inventory bytes/size/class/commit, đường dẫn relative và symlink dưới root, dry-run, env/stdin credential, HTTPS hoặc HTTP loopback, không follow redirect và không in secret/server response body. Không đọc DB/credential v1.
- Docs flow/manifest/generated file map khớp các file mới. Journal metadata không mang nội dung docs.

Snapshot và receipt mặc định unverified, bất biến; phase 08 phải bổ sung trusted attestation/verifier cùng đường hoàn tất phù hợp. Đây là staged dependency đã được PM chấp nhận, **không phải finding thiếu production verifier**. Field host tự báo verified không được dùng làm chứng thực. Task 7 routes/read/search/tree/app và UI phase 07 nằm ngoài scope review này.

## Kết luận chất lượng và kiểm chứng

**Quality verdict: cần sửa F1/F2 trước khi READY.** Mô hình transaction, provenance và phân quyền có cấu trúc rõ, tests bao phủ nhiều nhánh lỗi thực tế. Hai lỗi mới là khe hở giữa giới hạn transport và PostgreSQL derived representation, chưa có trong suite hiện tại.

Theo chỉ đạo PM, không chạy lặp covering suite. Đã đọc tests và sử dụng bằng chứng producer: server 153/153, owned import 19/19, CLI/events 6/6, domain 14/14, hai typecheck, Biome và diff check đều đạt. Đây là kết quả do producer báo cáo, không gắn nhãn reviewer tự chạy lại. Reviewer chỉ chạy hai repro mới cùng một own database fixture(6), qua `node --input-type=module` stdin, không tạo file test/source hoặc thay đổi schema candidate.

Repro đầu bị hạ tầng `57P03 the database system is starting up` trước khi test dữ liệu, do readiness qua Unix socket bắt temporary init server. Đã sửa cách chờ trong script tạm sang `pg_isready -h 127.0.0.1`, rồi chạy lại đúng hai ca và nhận lỗi storage như trên. Không sửa runner hoặc tính lỗi startup là finding Task 6B.

## Tài nguyên và ranh giới

- Lượt startup chưa chạy repro: container `0df20b81330ad40989335ec13241b1aedc46a9b13a2c1beae1f001247508c0ce`, `127.0.0.1:65259`.
- Lượt repro thành công: container `6c150652846f12cbf0965077f6443d1c3ffcd269bc724eb0dbd08f98d6af83c5`, `127.0.0.1:49685`.
- Cả hai tạo `postgres:18.6 --rm`, tên `crew-v2-test-UUID`; databaseFixture tạo/drop logical DB UUID và đóng pool trong finally. Dừng đúng ID container; `docker inspect <exact-id>` sau đó exit 1/no such object ở cả hai lượt. Không global kill/prune, không DB 5432/55432, không shared restart.
- Reviewer chỉ tạo báo cáo này; không sửa source, Stage A, plan, test, manifest, Git index; không commit, install, model call, deploy hoặc spawn subagent. Các thay đổi của peer được giữ nguyên.

**Gate cuối: READY NO.** Sau sửa, review lại hai regression cùng narrow diff; không cần mở lại các staged dependency đã chấp nhận.
