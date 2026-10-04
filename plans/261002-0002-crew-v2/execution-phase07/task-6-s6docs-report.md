# Task 6 S6docs — báo cáo

BASE `1574c1e1d2293a716cd20ffc2b3f769de88ed735`. Phạm vi: không gian tài liệu chỉ đọc (tree, page, search, link). Phần Trợ lý/câu hỏi/việc cần xử lý chờ G3 và không nằm trong lượt này.

## Đã làm (TDD: RED là lỗi thiếu module, rồi GREEN)
- `v2/web/src/docs/links.ts`: `resolveDocLink` đúng chữ ký của brief, `isRemoteImage`, `externalLinkRel`.
- `v2/web/src/docs/queries.ts`: tree/page/search/project docsState/ticket docs-links (phân trang P-G1a), `docsFailureText`; page và search ghim `snapshotId` của tree, mọi GET mang `AbortSignal`.
- `v2/web/src/docs/{space,page,search}.tsx`: cây theo `parentPath`, markdown GFM không rehype-raw, link/ảnh an toàn, metadata (commit, giờ Asia/Ho_Chi_Minh, audit, docsState, contentClass) luôn hiện, cảnh báo stale/chưa xác minh/thiết kế-kế hoạch, 422 UTF-8 hiện rõ, trạng thái rỗng, ticket liên quan hiện đúng danh sách máy chủ trả và nói rõ giới hạn 20.
- Tests: `web/test/docs-links.test.ts` (14), `web/test/docs-space-dom.test.ts` (11, jsdom/RTL).
- Docs: `v2/docs/flows/web-docs.md`, flow `web-docs` trong `flows.yaml`, `files.md`, `index.md` sinh bằng bundle `crew-docs generate`.

## Kiểm chứng
- `node --test test/docs-links.test.ts test/docs-space-dom.test.ts`: 25/25 pass.
- Toàn bộ `test/*.test.ts` web: 182/185; 3 fail đều ở test ticket của S3b đang làm dở (deep link chữ hoa, danh sách yêu cầu, tệp đính kèm trong chi tiết), không liên quan docs.
- `tsc --noEmit`: sạch. `pnpm build`: pass. Biome trên file của slice: sạch.
- `crew-docs generate` và `check --all` trên bản sao có `v2/` làm Git root: không còn lỗi nào của `web-docs`; còn 6 R2 của file chưa vào flow thuộc worker khác (`server/src/assistant/workflows.ts`, `web/scripts/e2e-attachment-receivers.ts`, `web/src/ticket-routes.tsx`, `web/src/tickets/create-request*.ts(x)`, `requests.tsx`).

## Không làm / chưa đạt
- `web/e2e/docs-assistant.spec.ts` chưa viết, A6docs không claim: route tài liệu chưa được controller mount, fixture Task1 chưa seed snapshot tài liệu (cần import `POST /v2/docs/imports` hoặc sync có attempt/fence thật).
- Cuộn tới fragment chưa làm (đích giữ `fragment`); chưa có tải ảnh/tệp nhị phân vì máy chủ chưa có API.

## Controller cần làm
1. Mount route, ví dụ `/projects/$projectId/docs?path=…`, render `<DocsSpace projectId path onPathChange onOpenTicket />`; thêm mục điều hướng “Tài liệu”.
2. `onOpenTicket(ticketId, trigger)` gọi `TicketDialog` dùng chung.
3. Ticket detail có thể dùng `useTicketDocsLinks(client, ticketId)` (key `['v2','ticket',id,'docs-links']`, nằm dưới prefix event của ticket).
4. Fixture E2E: seed một snapshot tài liệu để mở A6docs.
