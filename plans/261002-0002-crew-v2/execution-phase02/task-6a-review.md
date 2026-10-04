# Review Task 6 — Stage A, pure docs validator

**Kết luận:** cần sửa Stage A trước khi nhận quality gate. Phạm vi review là `task-6a-diff.txt` (base `51e562e`, head `7fc6cec`), brief Task 6 và `packages/docs-kit/STANDARD.md` như hợp đồng dữ liệu. Stage B (SQL 006, import service/CLI, DB tests) cố ý chưa triển khai vì phụ thuộc Task 5; đây không phải finding.

## Findings

1. **P1 — Link Markdown hợp lệ bị bỏ qua, khiến snapshot có link hỏng vẫn `valid: true`.** `v2/server/src/docs/links.ts:64` xóa đoạn inline code trước khi nhận diện link, nên ``[`Thiết kế`](missing.md)`` biến thành `[](missing.md)` và không khớp regex ở dòng 92. Regex ở dòng 92 cũng chỉ nhận reference dạng `[label][id]`, bỏ qua shortcut reference `[Thiết kế]` dù có định nghĩa `[Thiết kế]: missing.md`. Cả hai ca tập trung trả `links: []`, không có `UNVERIFIED_LINK_SYNTAX`, `valid: true`. Điều này vi phạm yêu cầu audit từng occurrence, link hỏng phải làm invalid, cú pháp chưa hỗ trợ phải có warning. Cần token hóa Markdown đủ để giữ link với code trong nhãn và shortcut reference; tối thiểu mọi cú pháp không nhận diện được phải phát warning thay vì âm thầm bỏ qua. Thêm test có đích thiếu cho hai dạng trên.

2. **P1 — Snapshot chỉ có workflow artifact bị đánh dấu lỗi cấu trúc STANDARD.** `v2/server/src/docs/validator.ts:50-53` luôn đòi sáu trang implemented. Input chỉ gồm `docs/superpowers/specs/design.md` với class `workflow_artifact` và UTF-8 hợp lệ trả sáu `REQUIRED_DOC_MISSING`, `valid: false`. Brief Task 6 quy định STANDARD chỉ áp dụng cho implemented standard docs, và artifact-only có thể đạt integrity audit nhưng vẫn không được thỏa project docs gate. Cần tách kết quả integrity audit khỏi điều kiện đủ trang implemented của docs gate; test artifact-only và mixed snapshot để tránh nâng artifact thành bằng chứng code.

3. **P2 — Chỉ bước đầu của flow được kiểm tra định dạng.** `v2/server/src/docs/validator.ts:75-76` dùng regex một lần cho toàn trang. Trang có `1. \`src/a.ts\` → \`run\`: ...` rồi `2. làm gì đó` vẫn `valid: true`. STANDARD yêu cầu *mỗi bước* nêu file và symbol. Cần duyệt từng mục đánh số trong phần `## Các bước`, tránh nhận một bước hợp lệ che các bước sai; thêm test cho bước thứ hai sai.

## Bằng chứng và phần đạt

- Chạy các ca tập trung bằng `node --input-type=module` trực tiếp lên `validateDocs`: artifact-only trả sáu lỗi; shortcut reference và link có nhãn inline-code đều không có link/issue; flow có bước thứ hai sai vẫn `valid: true`. Không chạy lại suite vì report worker đã ghi `test:unit` 16/16, typecheck và Biome sạch, và không có thay đổi source trong review này.
- Đọc toàn bộ diff một lượt; phần output bị cắt ở hunk `links.ts`/`manifest.ts`, nên chỉ đọc lại hai hunk đó với số dòng và `validator.ts`/`checksum.ts` để xác định vị trí finding. Không sửa source/fixture. Fixture CRLF có byte `0d 0a` cố ý; giữ nguyên, không format.
- Không thấy sai lệch cụ thể ở hash byte gốc, canonical Base64, UTF-8 fatal, duplicate YAML key, path case-sensitive và kiểm tra traversal trong các ca được review. Phần import boundary của Stage B vẫn phải từ chối path/class/checksum sai trước ghi DB, đối chiếu backup manifest cục bộ, giữ transaction và provenance theo brief; review Stage A không xác nhận các hành vi đó.
