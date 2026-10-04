# Task 6 — Stage A: pure docs validator

**Trạng thái:** `READY_FOR_INTEGRATION`. Task 6 chưa `DONE`; chờ PM xác nhận Task 5 migration 005/contract trước khi viết 006, import service, CLI và DB tests.

## Phạm vi đã làm

- `v2/server/src/docs/contracts.ts`: kiểu `DocsFile`, `DocsImport`, `DocsSync`, `DocsValidationInput`, `DocsValidationResult`, `AuditIssue`, `DocLink`; `DocsSync` có `trackedSourcePaths`, `sourceTreeSha256`, `verificationEvidenceId` cho bước đồng bộ sau.
- `checksum.ts`: `hashBytes(bytes:Buffer):string`, `decodeFileBytes(file:DocsFile):Buffer`, `snapshotHash(files:DocsFile[]):string`, `sourceTreeHash(paths:string[]):string`, `bundleHash(input:Omit<DocsImport,'bundleSha256'>):string`. Hash trên byte gốc; snapshot hash từ tuple sorted path/checksum/decoded length/class; base64 canonical, checksum và UTF-8 được kiểm tra trước hash snapshot.
- `manifest.ts`: `parseManifest(text)` trả manifest hoặc issue; bắt duplicate YAML keys, alias limit, schema/khóa dư, khóa prototype, path và mapping; `sourceMatcher` dùng picomatch `dot:true`; dựng hai block chuẩn và so với block hiện có.
- `validator.ts`: `validateDocs(input:DocsValidationInput):DocsValidationResult` kiểm tra required implemented pages, heading flow, generated blocks, mapping/source coverage, UTF-8, path và content class. Legacy import phát `SOURCE_TREE_UNVERIFIED` warning; `valid` chỉ biểu thị không có lỗi cấu trúc, không xác minh code freshness.
- `links.ts`: `auditLinks(files:Map<string,string>)` trả từng link với `occurrence` 0-based, href/fragment/status; xử lý inline/reference/image, code fences/inline code, heading trùng, đường dẫn tương đối và escape; link hỏng là error, artifact thiếu/cú pháp chưa hỗ trợ là warning.
- Fixture CRLF/Unicode thật ở `v2/server/test/fixtures/legacy-docs/crlf-unicode.md`; fixture chuẩn và 16 unit tests trong `test/support/docs.ts`, `test/docs-validator.unit.test.ts`; trang flow `v2/docs/flows/server-docs-import.md`.

## Bằng chứng TDD và kiểm tra

- RED đầu: `node --test test/docs-validator.unit.test.ts` thất bại do chưa có module docs. RED bổ sung: manifest nhận khóa `constructor`; link `../` hợp lệ bị gắn unverified; heading slug chưa biết bị coi thiếu; nested Markdown thiếu warning; `CLAUDE.md` có dòng trắng thừa được nhận. Từng ca được sửa và chạy GREEN.
- GREEN cuối: `pnpm --dir v2/server test:unit` — 16/16 pass, 0 fail.
- `pnpm --dir v2/server typecheck` — exit 0.
- `pnpm exec biome check v2/server/src/docs v2/server/test/docs-validator.unit.test.ts v2/server/test/support/docs.ts --reporter=summary` — 7 files, 0 errors/warnings.
- Fixture byte đầu `23 20 54 c3 a0 ... 0d 0a` xác nhận CRLF vẫn hiện diện; unit test dùng `readFileSync` và SHA-256 trực tiếp trên Buffer.

## Tự rà soát và phần chờ tích hợp

- Không gọi DB, không sửa migration hay test prefix hiện hữu, không import runtime/schema `@crew/shared`/docs-kit v1, không dùng mạng, không normalize bytes fixture.
- Link parser đánh dấu cú pháp Markdown lồng/custom là `UNVERIFIED_LINK_SYNTAX`; chưa khẳng định đã kiểm tra mọi cú pháp Markdown. Heading slug ngoài tập hỗ trợ được đánh dấu unverified khi không tìm được fragment.
- Stage B cần kiểm tra backup inventory/file checksum và bundle checksum tại ranh giới nhập; giới hạn tổng batch 16 MiB/100 project, transaction rollback, provenance/idempotency, 006 SQL, DB test cho byte và link occurrence; không được coi `sourceTreeHash` hoặc commit do caller gửi là bằng chứng đáng tin. DB docs sync cần reader/verifier fail-closed đối chiếu project/attempt/merged commit.
- PM/controller sẽ thêm flow mapping trong `v2/docs/flows.yaml`, generated index/files và review Task 6 toàn phần sau Stage B. Không có commit từ worker này.

## Stage A — vòng sửa review 1 (base `7fc6cec`)

Review `task-6a-review.md` nêu ba lỗi: link hợp lệ có nhãn inline-code và shortcut reference bị bỏ qua; artifact-only bị ép đủ trang STANDARD; chỉ bước đánh số đầu tiên của flow được xét. Em thêm bốn unit tests mục tiêu trước sửa: hai link hỏng cùng trang phải giữ occurrence `[0,1]`, href/fragment riêng và `valid:false` trong khi Buffer CRLF không đổi; artifact-only đạt integrity nhưng mixed thiếu `docs/index.md` vẫn lỗi; bước thứ hai sai trong phần `Các bước` phải bị bắt, còn ví dụ trong fenced code và mục đánh số ở phần khác được bỏ qua. Lần chạy RED: 17/20 pass, đúng ba test chính thất bại.

Sửa `links.ts` giữ token khi inline code nằm trong nhãn, nhận shortcut/collapsed reference từ định nghĩa và gắn warning khi còn cấu trúc link chưa phân tích. Sửa `validator.ts` chỉ bắt trang STANDARD khi snapshot có implemented, đồng thời duyệt từng mục đánh số trong đúng phần `Các bước` ngoài fenced code. Không thêm dependency parser Markdown hoặc thay bytes fixture. Trang flow nêu rõ `valid` artifact-only là toàn vẹn, không phải quyền vượt docs gate; Stage B phải kiểm tra aggregate contentClass riêng.

Thêm một RED nhỏ khi tự rà soát: heading `## Ví dụ` trong fenced code làm sai thứ tự heading dù bước hợp lệ. `validator.ts` nay cùng bỏ fenced code khi đọc heading và các bước; test tập trung sau sửa 21/21 pass. Cổng cuối vòng sửa: `pnpm --dir v2/server test:unit` — 22/22 pass (21 docs + 1 journal unit từ worker khác), `pnpm --dir v2/server typecheck` — exit 0, Biome trên 7 TS file sở hữu — exit 0/no fixes, `git diff --check` — exit 0. Fixture CRLF vẫn có byte `0d 0a`; không thay fixture. Stage A tiếp tục `READY_FOR_INTEGRATION`, Task 6 chưa `DONE`.

## Stage A — vòng sửa review 2 (base `ca9e12e`)

Theo `task-6a-re-review.md`, thêm hai test trước sửa: marker `2. ` rỗng sau một bước hợp lệ phải tạo `FLOW_STEPS_INVALID`; checkbox `- [x]` và `- [ ]` đứng trước link hỏng không được tạo hàng link/warning và link thật phải có `occurrence:0`, href/fragment gốc, Buffer CRLF giữ nguyên. RED tập trung `node --test test/docs-validator.unit.test.ts`: 21/23 pass, đúng hai test mới fail.

Sửa `validator.ts` để nhận marker số trước rồi kiểm tra nội dung (kể cả chuỗi rỗng); sửa `links.ts` loại marker task-list ở đầu dòng khỏi stream token trước khi cấp occurrence, giữ nội dung link cùng dòng. GREEN tập trung `node --test test/docs-validator.unit.test.ts`: 23/23 pass. Tự rà soát: regex marker chỉ áp dụng trong `## Các bước` ngoài fence; regex checkbox chỉ bỏ `[x]`, `[X]`, `[ ]` ở đầu mục unordered/ordered, không bỏ shortcut reference trong văn xuôi. Không sửa fixture byte, schema DB, shared manifest hoặc runtime v1.

Cổng cuối vòng sửa: từ `v2/server`, `node --test test/docs-validator.unit.test.ts` — 23/23 pass; `pnpm typecheck` — exit 0. Từ repo root, `pnpm exec biome check v2/server/src/docs/links.ts v2/server/src/docs/validator.ts v2/server/test/docs-validator.unit.test.ts --reporter=summary` — 3 file, no fixes; `git diff --check` — exit 0. Fixture CRLF vẫn có `0d 0a` ở byte 14–15. Files sửa: `links.ts`, `validator.ts`, `docs-validator.unit.test.ts`, `v2/docs/flows/server-docs-import.md` và báo cáo này. Stage A tiếp tục `READY_FOR_INTEGRATION`; Task 6 chưa `DONE` và không có kiểm thử DB trong vòng này.

## Stage A — vòng sửa review 3 (base `e518e64`)

Re-review vòng 2 còn P2: checkbox task-list trong ordered list `1)` hoặc blockquote `> -` vẫn bị coi là shortcut reference. Em thêm test dạng bảng cho 10 prefix: `-`, `+`, `*`, `1.`, `1)`, blockquote một/hai cấp, khoảng trắng đầu dòng và list lồng. Mỗi case có checkbox, link thật, shortcut reference thật và link có nhãn inline code; kiểm `occurrence [0,1,2]`, href/fragment, ba status `missing`, không warning giả và Buffer CRLF không đổi. RED `node --test test/docs-validator.unit.test.ts`: 23/24 pass; case `1) [x]` tạo bốn hàng thay vì ba.

`links.ts` nay loại checkbox sau chuỗi prefix list/blockquote ở đầu dòng (dấu `-+*`, số với `.` hoặc `)`) trước khi token hóa, giữ link thật trên dòng. GREEN cuối từ `v2/server`: `node --test test/docs-validator.unit.test.ts` — 24/24 pass; `pnpm typecheck` — exit 0. Từ repo root: `pnpm exec biome check v2/server/src/docs/links.ts v2/server/test/docs-validator.unit.test.ts --reporter=summary` — 2 file, no fixes; `git diff --check` — exit 0. Fixture gốc còn byte `0d 0a` ở offset 13–14 (0-based). Chỉ `links.ts`, unit test, `v2/docs/flows/server-docs-import.md` và báo cáo này được sửa. Stage A `READY_FOR_INTEGRATION`; Task 6 chưa `DONE`.
