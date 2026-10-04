# Task 6B — Re-review F1/F2, vòng sửa 1

**Candidate:** `832c9a3d015fd750a489f49ff48db36a1501ae62`  
**Base:** `d3c7629`  
**READY: YES**  
**Spec verdict: PASS trong phạm vi F1/F2. Quality verdict: PASS trong phạm vi F1/F2.**

Không có finding mới trong diff sửa và các regression trực tiếp. Hai finding P2 của `task-6b-review.md` được đóng. Các phần Stage B đã review trước giữ nguyên kết luận; không mở rộng sang Stage A, gateway, Task 7 hoặc trusted verifier phase 08.

## Phạm vi và bằng chứng

Đã đọc `task-6b-fix.md`, gói `.superpowers/sdd/phase-02-server-docs/review-d3c7629..832c9a3.diff`, implementation của projection/audit/storage/CLI, biểu thức generated FTS và toàn bộ regression mới. Diff gồm 7 file, 265 dòng thêm/29 dòng xóa. Các file trong phạm vi hiện tại không khác candidate khi đối chiếu bằng Git.

Đã tự kiểm tra SHA256 migration 006 đúng **`8c48a69a27205ff95d11be8b966ffffcd079f62e537f5263777cd867325b75ae`** và `git diff --check d3c7629..832c9a3` exit 0. Không có lý do cụ thể để mở thêm repro DB hoặc lặp covering suite.

## F1 — CLOSED

`v2/server/src/docs/import.ts:116` chuyển NUL sang literal `\u0000` chỉ trên projection. `auditDocsForStorage` tại dòng 126 vẫn gọi validator trên byte gốc trước khi chuyển các issue path/message và link metadata sang chuỗi an toàn cho PostgreSQL; giữ `valid`, status và occurrence. Security checks vẫn chạy trước projection. NUL phát sinh sau decode fragment cũng tạo warning.

Tại dòng 253–260, snapshot audit có metadata `storageProjection`, title/search_text nhận projection nhưng `bytes`, file SHA, snapshot SHA, content class và source provenance tiếp tục dùng nguồn nguyên trạng. Import report và idempotency nhận issues đã biểu diễn an toàn; không còn chuyển NUL trực tiếp vào text/jsonb qua các đường dẫn dữ liệu phát hiện trong F1. Import và sync cùng dùng helper này; sync structural-invalid vẫn từ chối và kết quả hợp lệ vẫn unverified.

Regression `v2/server/test/docs-import.test.ts:653` bao phủ NUL ở body/heading/external href/toPath/fragment/unknown-scheme audit, thêm trường hợp `%00` chỉ xuất hiện sau decode, batch ba project và replay. Assertions kiểm tra raw bytes/SHA, stored metadata, audit invalid được giữ và event cursor không tăng khi replay. Test tại dòng 766 kiểm tra checkout NUL, snapshot identity, unverified/latest_verified và structural-invalid rejection. CLI test tại `v2/server/test/docs-import-cli.unit.test.ts:265` kiểm tra warning count cùng digest/byte trước-sau.

Đã chấp nhận giới hạn biểu diễn được công bố: projection không đảo ngược độc lập được và có thể trùng literal escape vốn có trong tài liệu. Raw `docs_files.bytes` cùng checksum vẫn là nguồn sự thật. Flow docs ghi rõ điều này; không claim metadata projection là bản raw.

## F2 — CLOSED

`v2/server/migrations/006_docs.sql:35` giới hạn đầu vào `to_tsvector` bằng `left(search_text,8192)`. Cap này độc lập với giới hạn raw 1 MiB, đủ nhỏ để ngăn lỗi vector 1 MiB của repro trước. Cột `search_text` vẫn chứa toàn bộ projection và `bytes` vẫn chứa toàn bộ file; không hạ giới hạn file hay cắt raw dữ liệu. Helper đếm Unicode code point cho warning phù hợp cách PostgreSQL `left` đếm ký tự.

Regression `v2/server/test/docs-import.test.ts:717` dùng đúng artifact **672,011 byte/120,000 lexeme** đã làm candidate trước thất bại. Test kiểm tra import batch/replay, byte/SHA/search_text đầy đủ, vector dưới giới hạn, từ đầu có trong index, từ cuối không có trong prefix, và SQL fallback trên full text có snapshot scope/LIMIT tìm thấy từ cuối. EXPLAIN với seqscan tắt kiểm tra GIN index được dùng, sau đó thực thi indexed query. File quá 1 MiB vẫn có regression rejection hiện hữu.

Flow docs nêu `FTS_PREFIX_ONLY`, giới hạn prefix, full projection có thể tới 6 MiB khi mọi NUL được escape, và handoff Task 7: query được projectStorageText, prefix FTS OR case-insensitive literal fallback trên full search_text, giới hạn q/pagination, actor/project/snapshot scope và statement timeout hữu hạn. Không gọi lại `to_tsvector` toàn file để làm fallback. Task 7 chưa được triển khai trong candidate này; SQL regression là bằng chứng khả thi của handoff, không phải claim HTTP search đã hoàn thành.

## Chất lượng, kiểm chứng và cleanup

Implementation sửa đúng tầng storage projection; không thay validator để làm nội dung sai trở thành hợp lệ, không thay raw checksum/provenance/receipt authorization, không nâng verified. CLI tái sử dụng cùng audit helper nên dry-run công bố warning storage/FTS đúng với import. Thay đổi journal flow chỉ bổ sung mô tả projection và sửa punctuation để đạt cấu trúc STANDARD.

Theo chỉ đạo PM, dùng bằng chứng covering producer và không lặp test: target import **22/22**, full server **157/157**, focused CLI **1/1**, typecheck, Biome 4 file đều đạt; hai owned flow checks và root/nested staged docs checks đạt theo báo cáo producer/PM. Reviewer đã đọc assertions mới; không gắn các kết quả suite này thành lượt tự chạy của reviewer.

Cleanup được phân biệt đúng mức bằng chứng: target container `11ca31e7ba72fdd8cde3f8d241d04fd6caf86f5c0ac7df8a5e4f400753f8ab4a`, port `127.0.0.1:52776`, có exact-ID inspect no such object theo producer. Full runner có exit 0/lifecycle finally, diagnostic ID bị cắt nên không claim independent exact-ID inspection. Reviewer không tạo container/process test, không thực hiện cleanup tài nguyên của peer hoặc suy ownership từ global delta.

Reviewer chỉ tạo báo cáo này; không sửa source/docs/plan/test, không stage/commit/install/deploy, không gọi model/spawn subagent và không chạm shared DB/service.

**Gate cuối: READY YES — F1 CLOSED, F2 CLOSED.**
