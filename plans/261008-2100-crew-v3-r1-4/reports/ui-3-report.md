# UI-3 — Docs trong crew.core

Status: DONE_WITH_CONCERNS

## Summary

- Thêm migration namespace `plugin_crew_core_0433ea20b6`: `docs_snapshots`, `docs_current` (khóa company/project), `docs_pages`, `docs_links`. Host migration validator thật chấp nhận tất cả câu SQL.
- Webhook `docs-snapshot` dùng `authenticateCrewWebhook` (5 MiB), kiểm schema v1, project thuộc company và secret ref từ config. Chỉ công bố snapshot sau khi ghi đủ trang và link; xóa snapshot cũ sau khi chuyển con trỏ. Mọi từ chối ném lỗi.
- Data `crew.docsCheck`, `crew.docs.projects`, `crew.docs.tree`, `crew.docs.page`, `crew.docs.search`; kiểm company trên mọi truy vấn. `docsCheck` đi từ issue con lên gốc, lấy marker hợp lệ mới nhất. Search escape `%`, `_`, `\\` và giới hạn 50.
- `DocsCheckPanel` và `DocsSection` đăng ký vào registry với id/order theo interface. UI có chọn project, cây docs, đọc Markdown bằng host `MarkdownBlock`, link nội bộ qua audit, link missing hiển thị rõ, tìm kiếm, commit, giờ Asia/Ho_Chi_Minh, auditState và path bị secret-scan.

## TDD và xác minh

- Đỏ: test mới thất bại vì chưa có `src/docs/data.js` (Vitest 1 suite fail). Sau đó viết implementation, test parser/schema/search xanh.
- Test PostgreSQL embedded thật: webhook ký đúng ghi snapshot; thiếu/sai/stale/quá 5 MiB/company lạ/project khác company/schema sai đều ném và DB không đổi; thay snapshot cùng project chỉ còn một snapshot; đọc tree/page, search escape; marker mới nhất trên issue gốc. Migration đi qua validator host.
- `corepack pnpm --filter @crew/paperclip-plugin test`: 5 suite, 15 test đạt.
- `corepack pnpm --filter @crew/paperclip-plugin typecheck`: đạt.
- `corepack pnpm --filter @crew/paperclip-plugin build`: đạt. UI bundle gzip 3.086 byte.
- `node crew/release/check-core-hooks.mjs`: 5/5, lỗi 0. `git diff --check`: đạt.
- Trước DB test, `ipcs -m` có 5 segment, không gỡ gì. Chạy `corepack pnpm install --frozen-lockfile` một lần và build SDK nội bộ để có `dist` cho typecheck.

## Concerns

- SDK `ctx.db.execute` không có transaction. Snapshot đang ghi được staging trước; `docs_current` chỉ đổi sau khi ghi đủ. Nếu ghi lỗi giữa chừng, snapshot staging có thể còn lại nhưng không hiển thị. Hai webhook đồng thời có thể để lại snapshot staging/orphan, dù con trỏ current vẫn chỉ một ảnh. Cần host transaction hoặc job dọn staging để bảo đảm vật lý chỉ một snapshot trong mọi tình huống.
- Không có registry máy đã được đăng ký trong UI-1; webhook kiểm `machineId` là UUID nhưng chưa thể xác thực danh tính máy riêng biệt ngoài HMAC company. Đối chiếu khi UI-4 thêm dữ liệu máy.
- Chưa chạy trình duyệt hoặc deploy trong phạm vi ticket. UI-2 sẽ nhúng các component đã đăng ký vào tab/trang Crew.
