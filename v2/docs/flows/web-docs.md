# Không gian tài liệu chỉ đọc trên web Crew v2

## Mục đích

Flow này cho owner đọc tài liệu của một dự án: cây trang, nội dung markdown, tìm kiếm và liên kết giữa các trang. Mọi thứ chỉ đọc, bám đúng `snapshotId` mà cây tài liệu trả về, và luôn hiện commit, thời điểm nhận, trạng thái kiểm tra, trạng thái tài liệu và loại nội dung. Phần Trợ lý/câu hỏi/việc cần xử lý không thuộc flow này vì chờ gate G3.

## Điểm vào

- `web/src/docs/space.tsx` → `DocsSpace({ projectId, path, onPathChange, onOpenTicket? })`: trang tài liệu của một dự án. `path` và `onPathChange` do caller giữ (router có thể đưa vào URL); khi `path` là `null`, hiện trang mặc định `docs/index.md`, rồi `README.md`, rồi trang đầu tiên.
- `web/src/docs/page.tsx` → `DocsPageView`: một trang, gồm khối thông tin phiên bản, cảnh báo, markdown và ticket liên quan.
- `web/src/docs/search.tsx` → `DocsSearch`: ô tìm kiếm trên đúng snapshot đang xem.
- `web/src/docs/links.ts` → `resolveDocLink(...)`: hàm thuần biến một `href` thành trang trong snapshot, liên kết ngoài hoặc liên kết bị chặn kèm lý do.
- `web/src/docs/queries.ts`: hook đọc tree, page, search, trạng thái tài liệu của dự án và docs-links của ticket.
- `web/src/docs/ticket-links.tsx` → `TicketDocsLinksEditor({ ticketId })`: sửa các trang tài liệu gắn với một ticket. `TicketDetail` nhúng bằng `<TicketDocsLinksEditor ticketId={ticket.id} />`; chưa nhúng vì `web/src/tickets/*` đang do S3b sửa.

## Các bước

1. `useDocsTree` đọc GET `/v2/projects/:id/docs/tree` (bản mới nhất), key `queryKeys.docsTree(projectId, null)`. Cây dựng theo `parentPath` của máy chủ, không tự suy ra từ đường dẫn. Trang có `contentClass = workflow_artifact` được ghi “(Thiết kế/kế hoạch)”. Dự án không có tài liệu (404) hiện trạng thái rỗng rõ ràng, không phải lỗi.
2. `snapshotId` của cây được ghim cho mọi lần đọc tiếp theo: `useDocsPage` gọi `/docs/page?snapshotId=…&path=…` và `useDocsSearch` gọi `/v2/docs/search?q&projectId&snapshotId`. Đường dẫn và `q` luôn qua `URLSearchParams`, nên Unicode và ký tự dành riêng được mã hóa đúng; cursor tìm kiếm là chuỗi mờ, chỉ gửi lại nguyên văn.
3. Đổi dự án đặt `key` mới cho view nên truy vấn cũ bị hủy bằng `AbortSignal`, ô tìm kiếm được xóa và không có byte nào của dự án cũ hiện dưới commit mới. Khi cây được đồng bộ sang snapshot mới, trang được đọc lại theo snapshot mới.
4. `DocsPageView` luôn hiện khối “Thông tin phiên bản tài liệu”: commit (hoặc “Không có commit”), giờ nhận theo Asia/Ho_Chi_Minh, trạng thái kiểm tra (`auditState`), trạng thái tài liệu (`docsState` đọc từ GET `/v2/projects/:id`) và loại nội dung. “Hiện hành” chỉ hiện khi `docsState = current`. Tài liệu `stale`, chưa xác minh, không hợp lệ hoặc không xác định được trạng thái đều có cảnh báo; HTTP 200 không làm tài liệu thành hiện hành. Trang thiết kế/kế hoạch không bao giờ được ghi “Đã triển khai”.
5. Markdown dùng `react-markdown` + `remark-gfm`, không bật `rehype-raw`, nên HTML thô không thành phần tử. Mỗi liên kết đi qua `resolveDocLink`: giải theo thư mục của trang hiện hành, giải mã percent một lần (tiếng Việt, khoảng trắng), giữ nguyên chữ hoa/thường của fragment, ghim `projectId` và `snapshotId` đầu vào. Quy tắc khớp bộ audit liên kết của máy chủ (`server/src/docs/links.ts`): `%2e`, `%2f`, `%5c`, đường dẫn bắt đầu bằng `/`, ký tự `?`, dấu `\`, dấu `/` cuối (thư mục) và thoát khỏi thư mục gốc đều bị chặn, không có dự phòng thư mục → `index.md`; mọi giao thức khác `http(s)` (`javascript:`, `data:`, `file:`, ký tự điều khiển, `//host`) cũng bị chặn. Trang không có trong snapshot bị chặn kèm lý do, không đoán đích. Markdown dùng `defaultUrlTransform` cho mọi URL trừ `href` của `<a>`, vốn do `resolveDocLink` quyết định. Liên kết ngoài mở tab mới với `rel="noopener noreferrer nofollow"`. Ảnh không bao giờ được tải; chỉ hiện mô tả và, với ảnh http(s), một liên kết mở ảnh gốc.
6. Lỗi 422 `DOCS_ENCODING_INVALID` hiện thông báo rõ và không hiện nội dung nào, kể cả nội dung của trang trước đó. Khối thông tin phiên bản vẫn hiện (commit, kiểm tra, trạng thái tài liệu, loại nội dung lấy từ cây; “Nhận lúc” ghi chưa đọc được), cùng cảnh báo trong một vùng `role=alert`. Cảnh báo kiểm tra của trang vẫn hiện khi trạng thái tài liệu không phải hiện hành, trừ khi lặp lại đúng trạng thái đó. 404 của cây được phân biệt theo thông điệp máy chủ: “không tìm thấy dự án” khác “chưa có tài liệu”. Các lỗi khác hiện lý do theo `docsFailureText`.
7. Ticket liên quan hiện đúng danh sách `relatedTicketIds` mà máy chủ trả về. Máy chủ giới hạn 20 nên khi đủ 20, giao diện nói rõ danh sách có thể chưa đầy đủ. `useTicketDocsLinks` đọc phân trang GET `/v2/tickets/:id/docs-links` (limit 20, cursor mờ) và là nguồn của `TicketDocsLinksEditor`.
8. `TicketDocsLinksEditor` gửi `PUT /v2/tickets/:id/docs-links` với `{ snapshotId, paths, expectedRevision }`: `snapshotId` là snapshot của cây, `paths` chọn từ cây đó (1 đến 100 trang, máy chủ thay toàn bộ tập), `expectedRevision` là revision ticket đang đọc. Mỗi lần lưu là một `PendingOperation` (intent `ticket-docs-links:<ticketId>`) qua `OwnerClient.mutate`, nên mất phản hồi rồi bấm lại gửi đúng khóa và đúng byte. Nút Lưu chỉ bật khi đã đọc hết các trang liên kết hiện có; liên kết thuộc snapshot cũ được báo là sẽ bị thay. Bản nháp nằm trong state của component và không mất khi lỗi: 409 `REVISION_CONFLICT` giữ nguyên lựa chọn, đọc lại ticket và lần lưu sau dùng revision mới với khóa mới; chỉ lần lưu xác nhận đúng byte của bản nháp mới xóa nó. Có nút “Bỏ lần gửi treo” khi một lần lưu chưa xác nhận.

## Dữ liệu

DTO lấy từ `web/src/contracts/docs.ts` (`DocsTree`, `DocsPage`, `DocsHit`) và `web/src/contracts/machines.ts` (`Project.docsState`), không khai báo lại. Query key dùng `queryKeys.docsTree/docsPage/docsSearch`; trạng thái tài liệu của dự án nằm dưới `docsStateKey(projectId)` = `['v2','docs',projectId,'state']`, cùng prefix docs của dự án. Nhờ đó cả `docs.synced` (theo dự án) lẫn `docs.imported` (`queryRoots.allDocs`) làm mới tree, page và trạng thái tài liệu, nên sau import không còn hiện “Hiện hành” từ cache cũ (flow `web-data`). Không có dữ liệu nào ngoài query cache; không lưu nội dung tài liệu vào storage.

Giới hạn đã biết:

- Fragment được giữ trong đích liên kết nhưng chưa cuộn tới tiêu đề.
- Máy chủ chưa có API tải ảnh/tệp nhị phân của tài liệu, nên không có tải về.
- Danh sách ticket của một trang bị giới hạn 20 và chưa có phân trang phía docs → ticket.
- Phần “Trợ lý”, câu hỏi và việc cần xử lý chờ gate G3.

## Flow liên quan

`web-data.md` sở hữu `OwnerClient`, query key và event invalidation. `web-shell.md` sở hữu router và app runtime (controller mount route tài liệu và truyền `onOpenTicket` tới `TicketDialog` của `web-tickets.md`). `server-docs-view.md` là nguồn đọc tree/page/search; `server-tickets.md` định nghĩa docs-links của ticket.

## Tests

- `web/test/docs-links.test.ts`: bộ resolver (thư mục hiện hành, `../`, percent-encoding tiếng Việt và khoảng trắng, fragment, trang thiếu, bảng đối chiếu từng trường hợp với kết quả chạy audit của máy chủ, thoát root kể cả `%2e%2e`, các URL nguy hiểm và biến thể che dấu, cùng path khác snapshot), rel của liên kết ngoài, đường dẫn tìm kiếm Unicode và cursor mờ, đường dẫn docs-links của ticket, thông báo lỗi 422.
- `web/test/docs-ticket-links-dom.test.ts`: PUT với CAS và khóa cố định, 409 giữ bản nháp rồi lưu lại với revision mới, gửi lại đúng khóa và byte sau khi mất phản hồi, bắt buộc đọc hết liên kết hiện có, báo liên kết snapshot cũ, chặn danh sách rỗng.
- `web/test/docs-space-dom.test.ts`: component thật với jsdom/RTL trên fake server theo route của máy chủ: cây theo `parentPath`, đủ metadata, nhãn thiết kế/kế hoạch, docs cũ/không rõ trạng thái, HTML thô và URL nguy hiểm, liên kết nội bộ ghim snapshot, 422, trạng thái rỗng, docsState đọc lại sau `docs.imported`, metadata và cảnh báo vẫn hiện khi trang lỗi, 404 dự án khác chưa có tài liệu, đổi dự án hủy GET cũ, tìm kiếm Unicode có phân trang, ticket liên quan giới hạn 20.
- E2E trên API và PostgreSQL thật chưa chạy: route tài liệu chưa được controller mount và fixture chưa seed snapshot tài liệu.
