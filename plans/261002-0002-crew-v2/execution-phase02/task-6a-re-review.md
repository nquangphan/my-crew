# Re-review Task 6 — Stage A, fix round 1

**Phạm vi:** chỉ đối chiếu ba finding trong `task-6a-review.md` với diff `7fc6cec..ca9e12e` (`task-6a-fix-diff.txt`), brief Task 6 và lỗi mới do diff tạo ra. Stage B (SQL 006, import service/CLI, DB tests) chưa thuộc review này.

## Đối chiếu finding gốc

1. **ADDRESSED — link có nhãn inline code và shortcut reference.** `v2/server/src/docs/links.ts:64-68` giữ một token nhãn khi code span nằm trong `[...]`; `:96-100` nhận shortcut/collapsed reference và tra definition. Test `v2/server/test/docs-validator.unit.test.ts:232-260` xác nhận hai link thiếu có `occurrence` `[0,1]`, href/fragment riêng, hai `LINK_MISSING`, `valid:false`, đồng thời Buffer CRLF không đổi. Đây giải quyết đúng hai ca lỗi gốc. Regression checkbox ở dưới là finding mới của nhánh shortcut.
2. **ADDRESSED — snapshot chỉ có workflow artifact.** `v2/server/src/docs/validator.ts:85-91` bỏ yêu cầu sáu trang STANDARD khi mọi file là `workflow_artifact`; snapshot trộn vẫn phải có trang implemented. Test `v2/server/test/docs-validator.unit.test.ts:271-291` kiểm cả artifact-only `valid:true` và mixed thiếu `docs/index.md` `valid:false`. `v2/docs/flows/server-docs-import.md` nói rõ `valid` chỉ là kiểm tra toàn vẹn, không phải điều kiện docs gate; Stage B vẫn phải kiểm tra class tổng hợp trước khi dùng làm bằng chứng code.
3. **NOT FULLY ADDRESSED — kiểm tra từng bước đánh số.** `v2/server/src/docs/validator.ts:39-55` đã duyệt mọi bước có nội dung trong phần `## Các bước`; test `v2/server/test/docs-validator.unit.test.ts:293-329` bắt bước thứ hai sai và bỏ ví dụ trong fence/phần khác. Tuy nhiên regex dòng 50 cần `(.+)`, nên bước rỗng `2. ` bị bỏ qua. Tái hiện trên fixture chuẩn: thêm dòng `2. ` ngay sau bước đầu hợp lệ; `validateDocs` vẫn trả `valid:true`, không có `FLOW_STEPS_INVALID`. STANDARD yêu cầu mỗi bước nêu file và symbol. Xem finding P2 thứ nhất dưới đây.
4. **ADDRESSED — heading trong fenced code (bổ sung của vòng sửa).** `v2/server/src/docs/validator.ts:24-37,106-115` dùng cùng phần văn bản ngoài fence cho heading và bước; test `v2/server/test/docs-validator.unit.test.ts:331-352` xác nhận `## Ví dụ` và `2. thiếu symbol` trong code fence không gây lỗi giả.

## Findings còn lại / mới từ fix diff

1. **P2 — bước đánh số rỗng không bị audit.** `v2/server/src/docs/validator.ts:50-53` chỉ tăng `count` khi regex tìm được ít nhất một ký tự sau dấu cách. Với `## Các bước` chứa bước hợp lệ rồi `2. `, bước thứ hai bị bỏ qua và trang vẫn `valid:true`. Cần nhận diện marker đánh số trước, sau đó kiểm định nội dung (kể cả rỗng); thêm ca này vào test từng bước.
2. **P2 — checkbox Markdown bị nhận nhầm thành shortcut reference, làm sai occurrence.** Nhánh `!?\[...\](?!\(|\[|:)` tại `v2/server/src/docs/links.ts:96-100` áp lên toàn văn bản, gồm `- [x]` và `- [ ]`; khi không có definition, `:103-119` ghi hai link giả và hai warning. Tái hiện `auditLinks(new Map([['docs/a.md', '- [x] done\n- [ ] todo\n[real](missing.md)\n']]))`: output có ba link, checkbox chiếm occurrence `0,1`, link thật thành `2` thay vì `0`. Điều này sai hợp đồng “occurrence theo từng link token” và làm bẩn báo cáo/table của docs workflow. Cần bỏ task-list marker khỏi nhận diện shortcut trước khi cấp occurrence; test trộn checkbox với link thật.

## Verdict và bằng chứng

- **Spec:** chưa đạt Stage A vì quy tắc mỗi bước và định danh occurrence của link chưa được giữ ở hai ca trên. Hai ca lỗi link gốc và artifact-only đã được sửa; chưa có bằng chứng Stage B nên Task 6 vẫn chưa `DONE`.
- **Quality:** cần fix round 2 rồi re-review có mục tiêu; không có lỗi mới khác được xác nhận trong phần diff đã giới hạn.
- Em chạy hai phép tái hiện read-only bằng `node --input-type=module -e` trên fixture/hàm hiện tại: bước `2. ` trả `valid:true`, `stepIssues:[]`; checkbox trả ba hàng link với occurrence `[0,1,2]`. Không chạy lại suite/typecheck/Biome: report implementer đã ghi `test:unit` 22/22 (21 docs + 1 journal), typecheck và Biome 7 file xanh ở commit này; hai phép tái hiện là nghi vấn cụ thể ngoài suite.

## Re-review vòng 2 — `ca9e12e..e518e64`

**Phạm vi:** chỉ hai P2 còn mở ở trên và lỗi trong `task-6a-fix2-diff.txt`; không mở rộng sang source Stage B hay file không đổi.

1. **ADDRESSED — marker bước rỗng.** `v2/server/src/docs/validator.ts:50-53` nay nhận `2.` và `2. ` trước khi kiểm định nội dung; chuỗi rỗng không khớp mẫu file → symbol nên phát `FLOW_STEPS_INVALID`. Test `v2/server/test/docs-validator.unit.test.ts:354-368` đúng ca đã tái hiện ở vòng 1. Không thấy hồi quy mới trong hunk validator này.
2. **PARTIALLY ADDRESSED — checkbox làm sai link occurrence.** `v2/server/src/docs/links.ts:69-76` đã loại `- [x]`, `- [ ]` (và `+`, `*`, `1.` tương tự) ở đầu list; test `v2/server/test/docs-validator.unit.test.ts:370-398` xác nhận link thật còn occurrence `0`, không có warning giả và Buffer CRLF giữ nguyên. Tuy nhiên regex chỉ nhận list marker `[-+*]` hoặc `\d+.` ở đầu dòng. Task list hợp lệ dạng `1) [x] done` hoặc trong blockquote `> - [x] done` vẫn giữ `[x]` trong stream shortcut reference. Tái hiện read-only với mỗi dòng đó theo sau bởi `[real](missing.md)`: `auditLinks` trả link giả `[x]` ở occurrence `0`, link thật `missing.md` ở `1`, kèm `UNVERIFIED_LINK_SYNTAX`. Đây là phần còn lại của P2 checkbox; cần nhận diện marker list trong các ngữ cảnh này trước khi cấp occurrence và thêm test có link thật phía sau.

**Verdict vòng 2:** Spec/quality Stage A **chưa đạt** do P2 checkbox còn tái hiện ở task list đánh số `)` và blockquote; P2 marker bước rỗng đã đóng. Report implementer ghi test docs 23/23, typecheck và Biome 3 file xanh; em không chạy lại suite hay các cổng nặng, chỉ chạy hai phép `auditLinks` read-only trên các biến thể còn nghi vấn. Task 6 vẫn `READY_FOR_INTEGRATION`, Stage B chưa được review.

## Re-review vòng 3 — `e518e64..05b6758`

**ADDRESSED — P2 checkbox còn sót.** `v2/server/src/docs/links.ts:69-79` nhận chuỗi prefix list với dấu `-+*`, số kết thúc `.` hoặc `)`, kể cả sau dấu blockquote; chỉ bỏ token checkbox trước khi scan link của cả dòng. Test mới `v2/server/test/docs-validator.unit.test.ts:400-448` kiểm 10 prefix, link inline, shortcut reference, nhãn inline code, thứ tự occurrence/href/fragment, warning và byte CRLF. Phép kiểm tra read-only độc lập bằng `auditLinks` xác nhận `1) [x] done [real](missing.md)` và `> - [x] done [real](missing.md)` mỗi ca chỉ có link thật `occurrence:0`, không warning; `> 2) [ ] todo [shortcut]` vẫn giữ shortcut thật ở `occurrence:0`. Không thấy breakage mới trong ba file của diff vòng 3.

**Verdict vòng 3:** ba finding gốc và các P2 phát hiện ở re-review đã **ADDRESSED** trong phạm vi Stage A; **spec/quality Stage A đạt** để tích hợp phần validator thuần. Dựa trên diff, phép kiểm tra đích danh ở trên và report implementer RED 23/24 → GREEN 24/24, typecheck/Biome hai file cùng `git diff --check` xanh; em không chạy lại suite. Task 6 vẫn `READY_FOR_INTEGRATION`, chưa `DONE`: SQL 006, import service/CLI, DB tests và docs gate của Stage B chưa được review.
