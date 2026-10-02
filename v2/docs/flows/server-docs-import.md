# Nhập và kiểm tra docs nguyên trạng

## Mục đích

Giữ nguyên byte của tài liệu nhập từ Crew v1, phân biệt tài liệu mô tả hệ thống đã triển khai với artifact workflow, và báo cáo lỗi cấu trúc/link theo chuẩn `packages/docs-kit/STANDARD.md`. Bản nhập hợp lệ về cấu trúc vẫn ở trạng thái chưa xác minh so với source checkout. Migration 006 lưu snapshot và receipt bất biến; importer chỉ nhận bundle đã allowlist, CLI kiểm tra backup cục bộ trước khi tải lên. Đồng bộ checkout giữ audit unverified cho đến khi phase 08 có verifier tin cậy.

## Điểm vào

- `server/src/docs/validator.ts` → `validateDocs`: kiểm tra một tập Buffer và phân loại file, trả issue cùng từng lần xuất hiện link.
- `server/src/docs/checksum.ts` → `hashBytes`, `snapshotHash`, `sourceTreeHash`, `bundleHash`: băm byte gốc và danh sách canonical.
- `server/src/docs/import.ts` → `validateDocsImport`, `importDocs`, `authorizeDocsSync`, `syncDocs`: validation, transaction import và sync có fence.
- `server/src/docs/import.ts` → `projectStorageText`, `auditDocsForStorage`: biểu diễn PostgreSQL an toàn trên dữ liệu dẫn xuất, audit vẫn dùng byte gốc.
- `server/scripts/docs-import.ts` → `verifyBackupBundle`, `runDocsImport`: kiểm tra export/backup riêng, dry-run hoặc POST tới server v2.

## Các bước

1. `server/src/docs/checksum.ts` → `hashBytes`: tính SHA-256 trực tiếp trên Buffer, không đổi CRLF, Unicode hay encoding.
2. `server/src/docs/checksum.ts` → `snapshotHash`: kiểm tra base64 chuẩn, checksum, UTF-8 và file trùng; băm danh sách tuple path/checksum/kích thước/class đã sắp xếp.
3. `server/src/docs/manifest.ts` → `parseManifest`: đọc YAML có bắt khóa trùng, chặn khóa/prototype nguy hiểm, kiểm tra schema, path, mapping và source glob.
4. `server/src/docs/validator.ts` → `validateDocs`: áp dụng STANDARD khi snapshot có trang implemented, kiểm tra mọi marker bước đánh số kể cả dòng rỗng trong đúng phần `Các bước`, heading ngoài fenced code, block sinh tự động, manifest và độ phủ source khi có danh sách source checkout. Snapshot chỉ có workflow artifact được kiểm tra toàn vẹn mà không bị ép có trang STANDARD; bản nhập legacy có manifest phát cảnh báo `SOURCE_TREE_UNVERIFIED`.
5. `server/src/docs/links.ts` → `auditLinks`: duyệt Markdown inline/reference/shortcut-reference/image, giữ nhãn có inline code, bỏ code độc lập và marker checkbox của list dạng dấu, số `.`/`)`, kể cả trong blockquote/list lồng, khỏi stream link; giải đường dẫn tương đối, kiểm tra fragment và giữ `occurrence` cho từng link thật. Cú pháp chưa hỗ trợ được đánh dấu unverified.

6. `server/src/docs/import.ts` → `validateDocsImport`: kiểm tra toàn bộ batch trước ghi DB: khóa allowlist, identity, path, class, UTF-8, base64, checksum và giới hạn 100 project/2000 file mỗi project/1 MiB mỗi file/16 MiB byte giải mã/24 MiB JSON. Lỗi cấu trúc legacy được giữ cùng bytes; path/link escape hoặc dữ liệu transport sai bị từ chối.
7. `server/src/docs/import.ts` → `importDocs`: khóa journal trước entity, chỉ owner được nhập. Provenance `(source_system,legacy_id)` chỉ dùng mapping đã tồn tại của chính legacy project; mã project trùng khác identity trả conflict. Tạo project unbound, snapshot/audit/files/links/import report và event trong cùng transaction. Cùng bundle trả report đã lưu, không tạo event; khác backup có thể dùng lại snapshot cùng provenance, còn commit mới giữ snapshot riêng.
8. `server/src/docs/import.ts` → `authorizeDocsSync`: callback bắt buộc của `MutationContext.authorize` cho route sync tương lai, chạy trước replay. Giữ khóa root ticket, attempt/guard/command, project và machine để kiểm tra project, binding revision của command/attempt, guard/fence, máy chưa revoked, active lease hoặc finalizing vẫn reserved, terminal intent complete, merged commit và evidence thuộc đúng ticket/attempt.
9. `server/src/docs/import.ts` → `syncDocs`: audit source path list có checksum, lỗi cấu trúc trả 422. Receipt `(attempt_id,merged_commit,input_sha256)` giữ hash canonical toàn bộ request riêng từng attempt; input giống trả snapshot cũ, input đổi trả conflict. Snapshot cùng byte/class/commit có thể dùng lại bởi attempt khác. Host evidence chỉ là provenance: audit luôn unverified, không nâng latest_verified pointer hoặc đóng ticket. Event mới phát khi tạo receipt; replay không phát lại.
10. `server/scripts/docs-import.ts` → `verifyBackupBundle`: băm byte manifest JSON gốc, so inventory commit/path/hash/size/class, kiểm tra source backup và mọi file export dưới `projects/<legacyProjectId>/<doc path>` tính từ thư mục manifest. Từ chối symlink ở mọi thành phần đường dẫn backup. Không đọc v1 DB hoặc credential.
11. `server/scripts/docs-import.ts` → `runDocsImport`: nhận duy nhất `--bundle`, `--backup-manifest`, `--dry-run`. Dry-run chỉ xuất counts/checksums/số vi phạm, không ghi hoặc gọi mạng. Upload đọc session cookie và CSRF từ env/stdin, gửi Origin chính xác và idempotency key theo bundle SHA; chỉ HTTPS hoặc HTTP loopback, không theo redirect, không in secret hay response body.

## Files

| Đường dẫn từ `v2/` | Vai trò | Symbol chính |
|---|---|---|
| `server/src/docs/contracts.ts` | Kiểu dữ liệu snapshot, audit và link | `DocsValidationInput`, `DocsValidationResult`, `DocLink` |
| `server/src/docs/checksum.ts` | Checksum byte và canonical tuple | `hashBytes`, `snapshotHash`, `sourceTreeHash`, `bundleHash` |
| `server/src/docs/manifest.ts` | YAML, path, source glob và block chuẩn | `parseManifest`, `sourceMatcher`, `expectedFlowBlock`, `expectedFilesBlock` |
| `server/src/docs/validator.ts` | Kết hợp kiểm tra cấu trúc và source | `validateDocs` |
| `server/src/docs/links.ts` | Link/fragment audit theo từng occurrence | `auditLinks` |
| `server/src/docs/import.ts` | Import và sync transaction, replay authority | `validateDocsImport`, `importDocs`, `authorizeDocsSync`, `syncDocs`, `projectStorageText`, `auditDocsForStorage` |
| `server/migrations/006_docs.sql` | Snapshot/file/link, provenance, receipt, FTS và FK | — |
| `server/scripts/docs-import.ts` | CLI kiểm tra backup tại chỗ và upload v2 | `verifyBackupBundle`, `runDocsImport` |
| `server/test/docs-import.test.ts` | DB prefix 6, byte/race/retry/rollback/backup restore | — |
| `server/test/docs-import-cli.unit.test.ts` | CLI dry-run/backup/transport/secret, export fixture riêng | — |
| `server/test/docs-events.unit.test.ts` | Whitelist metadata docs event | — |
| `server/test/docs-validator.unit.test.ts` | Unit tests không DB | — |
| `server/test/support/docs.ts` | Snapshot fixture hợp lệ | `docsValidationFixture` |
| `server/test/fixtures/legacy-docs/crlf-unicode.md` | Fixture byte CRLF và Unicode | — |

## Dữ liệu

Stage A chỉ nhận `Map<string, Buffer>` và metadata do caller cung cấp; không đọc DB hay mạng. Validator giữ byte gốc trong input và chỉ decode UTF-8 để audit. `valid` phản ánh kiểm tra cấu trúc/toàn vẹn, không phải cờ đủ điều kiện docs gate: snapshot chỉ có workflow artifact có thể `valid: true` nhưng không thể chứng minh docs triển khai. Snapshot trộn vẫn phải có đủ trang STANDARD implemented. Checksum và danh sách path từ caller tự chúng chưa chứng minh commit nguồn hoặc nội dung code đúng. Migration 006 lưu docs_imports, docs_snapshots, docs_files, docs_links và docs_sync_receipts; trigger từ chối update/delete những bảng này. Bytea giữ byte gốc, title/search_text là bản decode phục vụ tra cứu; FTS dùng simple, không phải stemmer tiếng Việt; generated vector chỉ nhận `left(search_text,8192)` (8192 Unicode code point đầu của projection), không tuyên bố lập chỉ mục toàn file. `search_text` giữ toàn văn projection; giới hạn file raw vẫn 1 MiB. U+0000 trong title/search/link/fragment/audit message được biểu diễn bằng chuỗi literal `\u0000`, không gửi NUL tới PostgreSQL text/jsonb. Metadata này là projection, không phải original text; có thể trùng với literal escape sẵn trong tài liệu nên muốn nội dung nguyên trạng phải đọc `docs_files.bytes` và SHA. Audit report có `storageProjection:{version:1,nulEncoding:'literal-backslash-u0000',rawByteColumn:'docs_files.bytes',indexedPrefixCharacters:8192,fullSearchText:true}`. Warning `STORAGE_NUL_PROJECTION` ghi rõ khác biệt biểu diễn kể cả khi NUL chỉ xuất hiện sau decode fragment `%00`; `FTS_PREFIX_ONLY` ghi rõ giới hạn chỉ mục. Validator chạy trên nguyên byte trước projection, không thay đổi kết luận valid/invalid hay cấp trust từ bước này. Snapshot unique theo project/source_kind/hash/class/coalesce(commit), FK latest pointer có project ID để chặn cross-project. Chỉ latest_imported được cập nhật khi import, không đụng latest_verified. Audit report lưu issues và provenance source tree/evidence cho sync đầu tiên; input_sha256 trên receipt giữ retry identity riêng từng attempt. Snapshot artifact-only có thể hợp lệ nhưng không cung cấp bằng chứng triển khai.

## Flow liên quan

`server-platform` cung cấp kiểu ID/transaction; `server-journal` cung cấp canonical JSON cho checksum. Flow `docs-check` của v1 là chuẩn dữ liệu tham chiếu, không phải dependency runtime. Flow execution cung cấp schema 005 attempt/guard/command/fence và reserve finalizing. Task 7 sở hữu HTTP routes/read/search/app assembly; khi tích hợp sync phải truyền authorizeDocsSync vào mutator. Task 7 phải dùng vector prefix **hoặc** fallback case-insensitive literal substring trên toàn `search_text`, ví dụ `search_vector @@ plainto_tsquery('simple',q) OR strpos(lower(search_text),lower(q))>0`; q được `projectStorageText` trước bind SQL, không dùng `to_tsvector` toàn file ở fallback. Query phải giới hạn q 1–256 ký tự, scope theo actor/project/snapshot, phân trang 1–100 với LIMIT limit+1, và đặt statement timeout hữu hạn; lỗi deadline cần trả lỗi rõ thay vì báo không có kết quả. Mỗi file raw tối đa 1 MiB; projection NUL worst-case tối đa 6 MiB. Fallback đảm bảo từ ở phần ngoài vector prefix vẫn tìm được, không tuyên bố FTS phủ toàn văn. Phase 08 sở hữu verifier tin cậy và docs final gate; không được suy luận verified từ field host tự báo.

## Tests

`node --test server/test/docs-validator.unit.test.ts` (chạy từ `v2/`) kiểm tra CRLF/Unicode, checksum, YAML trùng khóa, case/path traversal, artifact-only/mixed, source coverage, từng bước flow kể cả marker rỗng, generated block và link lặp/fragment/shortcut reference/checkbox. `pnpm --dir v2/server typecheck` và Biome kiểm tra kiểu/định dạng. `docs-import.test.ts` dùng đúng databaseFixture(6), gồm race hai pool, rollback sau import rồi retry cùng key, replay bị revoke/binding/fence chặn, receipt giữa hai attempt dùng lại snapshot, commit mới cùng bytes, trigger bất biến và cross-project FK. Rehearsal tạo backup prefix 5 trước 006, restore/migrate 006; dump sau import restore và chạy lại giữ byte/class/checksum. Regression F1/F2 kiểm tra body/heading NUL, external href/toPath/fragment/audit jsonb, encoded-only NUL fragment, mixed batch/replay, sync validity/trust giữ nguyên, và artifact 672011 byte chứa 120000 lexeme: prefix index tìm từ đầu, vector không chứa từ cuối, literal fallback có scope/LIMIT vẫn tìm từ cuối. CLI unit test kiểm tra warnings projection/FTS với bytes export trước/sau, tạo export riêng rồi chạy dry-run hai lần với so byte trước/sau, corruption/class/symlink/credential args và HTTP loopback upload thực. Test runner sở hữu container UUID/port loopback ngẫu nhiên và xóa theo container ID; các fixture tạo/xóa đúng DB và thư mục riêng.
