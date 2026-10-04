# Task 6B — Fix round 1/5, F1/F2

Candidate base `f2b9b3f45ad73bfee07b7c1283a70398409ace70`. Đọc đầy đủ `task-6b-review.md`; hai finding được sửa cùng wave theo PM. Candidate correction đã freeze, sẵn sàng scoped review F1/F2; agent không stage/commit, không tự cấp READY thay reviewer.

## Diff hẹp

Sửa đúng 7 file sở hữu: `v2/server/src/docs/import.ts`, `v2/server/migrations/006_docs.sql`, `v2/server/scripts/docs-import.ts`, `v2/server/test/docs-import.test.ts`, `v2/server/test/docs-import-cli.unit.test.ts`, `v2/docs/flows/server-docs-import.md`, `v2/docs/flows/server-journal.md`. Không file nguồn mới, không schema 001–005, không shared manifest/generated docs/index/lock, không app/Task 7, không Stage A hoặc gateway. Peer gateway changes được giữ nguyên.

### F1 — NUL trong dữ liệu dẫn xuất

`import.ts` thêm hai exports hẹp, không đổi signatures import/sync:

- `projectStorageText(value: string): string`: chuyển U+0000 sang chuỗi literal backslash-u0000 chỉ cho PostgreSQL text/jsonb projection.
- `auditDocsForStorage(files: DocsFile[], buffers: Map<string,Buffer>, mode: 'legacy_import'|'checkout_sync', trackedSourcePaths?: string[]): DocsValidationResult`: validator vẫn chạy trên byte nguyên. Sau security checks, chuyển issue path/message và link fromPath/originalHref/toPath/fragment sang projection an toàn; thêm warning khi byte nguồn hoặc metadata sau decode fragment có NUL. `valid` và link status vẫn là kết luận của audit trên nguyên byte, không audit nội dung đã normalize để làm pass.

`storeSnapshot` giữ bytea, file SHA, snapshot SHA và source provenance nguyên trạng; title/search_text dùng projection. Report của import/snapshot/idempotency chỉ nhận derived strings đã biểu diễn an toàn, tránh cả PostgreSQL text `22021` lẫn JSONB `22P05`. Schema, path allowlist và security-link reject vẫn giữ nguyên; không lén hạ giới hạn file hoặc reject body NUL UTF-8 hợp lệ.

Warning `STORAGE_NUL_PROJECTION` mô tả khác biệt biểu diễn. Audit report thêm:

```text
storageProjection = {
  version: 1,
  nulEncoding: 'literal-backslash-u0000',
  rawByteColumn: 'docs_files.bytes',
  indexedPrefixCharacters: 8192,
  fullSearchText: true
}
```

Projection không phải raw original text và không phải encoding có thể đảo ngược độc lập: literal backslash-u0000 vốn có trong tài liệu có thể trùng biểu diễn NUL. Muốn byte/href gốc phải đọc bytea và raw content với checksum. Null commit/class/snapshot identity không đổi. Checkout structural-invalid vẫn reject DOCS_INVALID; structural-valid vẫn unverified, không có trusted upgrade/latest_verified hoặc completion mới.

CLI dùng cùng auditDocsForStorage, nên dry-run warning count thấy NUL projection/FTS limit thay vì báo như không có giới hạn biểu diễn. Backup/hash/export byte checks giữ nguyên; không log nội dung hoặc credential.

### F2 — Vector có giới hạn riêng

Draft006 đổi đúng generated expression thành:

```sql
search_vector tsvector generated always as
  (to_tsvector('simple',left(search_text,8192))) stored
```

SHA256 draft006 mới: **`8c48a69a27205ff95d11be8b966ffffcd079f62e537f5263777cd867325b75ae`**. Không chỉnh migration đã áp dụng trên service thật; các DB test riêng tạo lại từ exact prefix 6. Không auto-bootstrap hoặc migrate future SQL.

Vector chỉ nhận 8192 Unicode code point đầu projection. Tập đầu vào vector nhỏ và bị chặn độc lập với raw file limit, tránh vector vượt 1 MiB. File raw vẫn được nhận tới 1 MiB; search_text chứa toàn bộ projection và bytea đầy đủ. Warning `FTS_PREFIX_ONLY` cho trang ngoài cap, kể cả nếu projection dài hơn do NUL escape. Không claim FTS lập chỉ mục toàn file.

**Task 7 handoff:** reader/search phải dùng prefix FTS hoặc fallback literal case-insensitive trên full search_text, ví dụ:

```sql
search_vector @@ plainto_tsquery('simple',q)
or strpos(lower(search_text),lower(q))>0
```

Normalize q qua projectStorageText trước bind SQL. Query q 1–256 ký tự, scope actor/project/snapshot, pagination 1–100 và LIMIT limit+1, statement timeout hữu hạn; timeout trả lỗi rõ, không giả vờ không có hit. Không gọi to_tsvector toàn search_text trong fallback. Mỗi raw file tối đa 1 MiB; NUL projection worst-case tối đa 6 MiB. Đây là contract handoff, chưa lắp HTTP/search routes Task 7. Full literal fallback được kiểm chứng bằng SQL thật có snapshot scope/LIMIT trong regression; terms ở phần ngoài vector cap vẫn tìm được.

## RED → GREEN

Trước sửa, 3 repro test mới chạy trên actual prefix6 đều RED:

- NUL trong body/heading/external href/fragment/unknown-scheme audit: JSONB **22P05 unsupported Unicode escape sequence** tại import report.
- 120000 lexeme/672011 bytes dưới 1 MiB: **54000 string is too long for tsvector**.
- Checkout NUL: PostgreSQL text **22021 invalid byte sequence UTF8 0x00**.

Sau correction, cùng 3 tests GREEN. Expanded regression còn gồm encoded-only `%00` fragment không có NUL literal trong raw page, audit state invalid vẫn được legacy lưu; batch gồm project thường và project NUL/high-lexeme đều nhập, replay không event/snapshot trùng. Raw byte/SHA round-trip và raw snapshot SHA sync giữ nguyên; header/body/links/fragment/audit JSONB đều an toàn. Test FTS kiểm tra prefix term `w1` có hit, tail `w2klb` không có trong vector, full literal fallback tìm được tail. EXPLAIN với local enable_seqscan=off chứng minh GIN docs_files_search được planner dùng, rồi thực thi indexed query có hit. File vượt 1 MiB vẫn reject trong suite hiện có.

CLI regression dùng NUL artifact và chính high-lexeme artifact: warnings gồm source-unverified + storage limitation (2), violations 0, digest đúng; export raw bytes trước/sau equal. Các contract env/stdin/redirect/no-secret/dry-run trước đó vẫn PASS.

## Kiểm chứng cuối

| Lệnh | Kết quả |
|---|---|
| `pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/docs-import.test.ts --test-name-pattern='NUL\|high-lexeme'` trước/sau | RED 3/3 đúng lỗi storage → GREEN 3/3 |
| `pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/docs-import.test.ts` | **22/22 PASS**, 0 fail/skip; target covering |
| `node --test --test-name-pattern='NUL projection' v2/server/test/docs-import-cli.unit.test.ts` | **1/1 PASS** |
| `pnpm --dir v2/server test --test-concurrency=1` | **157/157 PASS**, 0 fail/skip, khoảng 18.4 giây; đúng một full suite sau production correction |
| `pnpm --dir v2/server typecheck` | Exit 0 |
| `pnpm exec biome check v2/server/src/docs/import.ts v2/server/scripts/docs-import.ts v2/server/test/docs-import.test.ts v2/server/test/docs-import-cli.unit.test.ts` | 4 files, no diagnostics/fixes |
| `git diff --check` | Exit 0 |

Full suite gồm 22 import DB, 6 CLI, docs event, 24 pure-validator tests và các server suites còn lại. Không chạy lại domain14 vì domain/pure contracts không đổi.

Kiểm tra cấu trúc owned flow pages: Node stdin đọc từng trang vào docsValidationFixture flow sample, validateDocs checkout_sync. `server-docs-import` PASS; `server-journal` ban đầu báo FLOW_STEPS_INVALID vì các bước hiện có thiếu dấu colon sau symbol. Chỉ sửa punctuation 5 bước của journal page cho đúng STANDARD; cuối cùng **hai trang valid:true, issues:[]**. Đây là kiểm tra cấu trúc heading/steps/link của trang, không thay crew-docs staged/mapping gate hay review nội dung của PM. Không production edit sau lượt full suite; các chỉnh sau chỉ prose/report.

Byte check bằng raw git show f2b9b3f so file hiện tại: Stage A contracts/checksum/manifest/validator/links/docs-validator.unit.test.ts tất cả equal. CRLF fixture 36 bytes vẫn SHA **`8463548e313aa8a34ca11e7ae4bacc2a6e7aefc00e15eb63b128ca1d121c7c94`**, không sửa. Digest của raw bytes/hash tuple/provenance không đổi theo projection.

## Tài nguyên và cleanup

Target runner container chính xác **`11ca31e7ba72fdd8cde3f8d241d04fd6caf86f5c0ac7df8a5e4f400753f8ab4a`**, loopback **127.0.0.1:52776**. Sau target completion, exact docker inspect exit1/no such object chứng minh đã xóa container này.

Full runner exit0; runner đăng ký exact own container ID/UUID name, fixture validate name/port, drop đúng logical DB UUID/pools và stop own ID trong finally. Full stdout tool bị cắt đoạn giữa nên full container diagnostic ID không được giữ trong output đọc được: **không claim independent exact-ID inspect cho lượt full**, không suy ownership từ global docker delta và không lặp suite chỉ để lấy ID. Đây là bằng chứng cleanup lifecycle/exit0 riêng, khác với exact inspect trực tiếp của target.

Repro rounds dùng cùng own runner/finally; CLI fixture thư mục mkdtemp riêng, cleanup đúng dir; HTTP test servers/pools đóng theo lifecycle. Không shared DB/service restart, không 5432/55432, không global kill/prune, không model/dependency/global install/subagent. PM còn serial commit + scoped review F1/F2; agent chưa stage/commit.
