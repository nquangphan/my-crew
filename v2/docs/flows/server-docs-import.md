# Nhập và kiểm tra docs nguyên trạng

## Mục đích

Giữ nguyên byte của tài liệu nhập từ Crew v1, phân biệt tài liệu mô tả hệ thống đã triển khai với artifact workflow, và báo cáo lỗi cấu trúc/link theo chuẩn `packages/docs-kit/STANDARD.md`. Bản nhập hợp lệ về cấu trúc vẫn ở trạng thái chưa xác minh so với source checkout. Phần kiểm tra thuần của flow được triển khai trước; nhập DB và đồng bộ snapshot thực hiện sau khi migration execution sẵn sàng.

## Điểm vào

- `server/src/docs/validator.ts` → `validateDocs`: kiểm tra một tập Buffer và phân loại file, trả issue cùng từng lần xuất hiện link.
- `server/src/docs/checksum.ts` → `hashBytes`, `snapshotHash`, `sourceTreeHash`, `bundleHash`: băm byte gốc và danh sách canonical.

## Các bước

1. `server/src/docs/checksum.ts` → `hashBytes`: tính SHA-256 trực tiếp trên Buffer, không đổi CRLF, Unicode hay encoding.
2. `server/src/docs/checksum.ts` → `snapshotHash`: kiểm tra base64 chuẩn, checksum, UTF-8 và file trùng; băm danh sách tuple path/checksum/kích thước/class đã sắp xếp.
3. `server/src/docs/manifest.ts` → `parseManifest`: đọc YAML có bắt khóa trùng, chặn khóa/prototype nguy hiểm, kiểm tra schema, path, mapping và source glob.
4. `server/src/docs/validator.ts` → `validateDocs`: áp dụng STANDARD khi snapshot có trang implemented, kiểm tra từng bước đánh số trong đúng phần `Các bước`, heading ngoài fenced code, block sinh tự động, manifest và độ phủ source khi có danh sách source checkout. Snapshot chỉ có workflow artifact được kiểm tra toàn vẹn mà không bị ép có trang STANDARD; bản nhập legacy có manifest phát cảnh báo `SOURCE_TREE_UNVERIFIED`.
5. `server/src/docs/links.ts` → `auditLinks`: duyệt Markdown inline/reference/shortcut-reference/image, giữ nhãn có inline code, bỏ code độc lập, giải đường dẫn tương đối, kiểm tra fragment và giữ `occurrence` cho từng link. Cú pháp chưa hỗ trợ được đánh dấu unverified.

## Files

| Đường dẫn từ `v2/` | Vai trò | Symbol chính |
|---|---|---|
| `server/src/docs/contracts.ts` | Kiểu dữ liệu snapshot, audit và link | `DocsValidationInput`, `DocsValidationResult`, `DocLink` |
| `server/src/docs/checksum.ts` | Checksum byte và canonical tuple | `hashBytes`, `snapshotHash`, `sourceTreeHash`, `bundleHash` |
| `server/src/docs/manifest.ts` | YAML, path, source glob và block chuẩn | `parseManifest`, `sourceMatcher`, `expectedFlowBlock`, `expectedFilesBlock` |
| `server/src/docs/validator.ts` | Kết hợp kiểm tra cấu trúc và source | `validateDocs` |
| `server/src/docs/links.ts` | Link/fragment audit theo từng occurrence | `auditLinks` |
| `server/test/docs-validator.unit.test.ts` | Unit tests không DB | — |
| `server/test/support/docs.ts` | Snapshot fixture hợp lệ | `docsValidationFixture` |
| `server/test/fixtures/legacy-docs/crlf-unicode.md` | Fixture byte CRLF và Unicode | — |

## Dữ liệu

Stage A chỉ nhận `Map<string, Buffer>` và metadata do caller cung cấp; không đọc DB hay mạng. Validator giữ byte gốc trong input và chỉ decode UTF-8 để audit. `valid` phản ánh kiểm tra cấu trúc/toàn vẹn, không phải cờ đủ điều kiện docs gate: snapshot chỉ có workflow artifact có thể `valid: true` nhưng không thể chứng minh docs triển khai. Snapshot trộn vẫn phải có đủ trang STANDARD implemented. Checksum và danh sách path từ caller tự chúng chưa chứng minh commit nguồn hoặc nội dung code đúng. Stage B sẽ lưu snapshot bất biến, provenance và report trong DB khi migration 005 cùng contract execution đạt.

## Flow liên quan

`server-platform` cung cấp kiểu ID/transaction; `server-journal` cung cấp canonical JSON cho checksum. Flow `docs-check` của v1 là chuẩn dữ liệu tham chiếu, không phải dependency runtime. Flow execution cần cung cấp schema attempt/fence và bằng chứng đối chiếu commit trước khi docs sync được tích hợp.

## Tests

`node --test server/test/docs-validator.unit.test.ts` (chạy từ `v2/`) kiểm tra CRLF/Unicode, checksum, YAML trùng khóa, case/path traversal, artifact-only/mixed, source coverage, từng bước flow, generated block và link lặp/fragment/shortcut reference. `pnpm --dir v2/server typecheck` và Biome kiểm tra kiểu/định dạng. DB import, chạy lại và rollback batch thuộc Stage B; chưa được xác nhận ở Stage A.
