# Task 6 S6docs — review độc lập (spec + chất lượng + bảo mật)

Phạm vi: commit `2eb8936` (`v2/web/src/docs/{links,queries,page,space,search}.ts(x)`, `v2/web/test/docs-*.test.ts`,
docs flow `web-docs`). Đối chiếu brief `task-6-brief.md` dòng 16–19 và phần docs của dòng 27; producer
`v2/server/src/docs/{read,search,links,manifest,routes}.ts`, `v2/server/src/tickets/routes.ts`. Không chạy lại test.

### Spec Compliance

- ✅ `resolveDocLink` đúng chữ ký brief; ghim `projectId/snapshotId` đầu vào; chặn `javascript:/data:/file:/vbscript:/blob:`,
  `//host`, `\`, ký tự điều khiển, `..` ra ngoài root (kể cả `%2e%2e` ra ngoài root), page thiếu có lý do; fragment giữ hoa/thường.
- ✅ Tree dùng `parentPath` của server (`read.ts:59-81`); page/search ghim `snapshotId` của tree; mọi GET mang `AbortSignal`;
  đổi project hủy GET cũ (test `docs-space-dom.test.ts:310` chứng minh abort thật).
- ✅ ReactMarkdown 10.1.0 + remark-gfm, không rehype-raw; raw HTML bị react-markdown chuyển thành text
  (`node_modules/react-markdown/lib/index.js:360-366`); `<a>`/`<img>` bị override; external `noopener noreferrer nofollow`;
  không bao giờ dựng `<img>`.
- ✅ Metadata commit/giờ/audit/docsState/contentClass hiện cạnh trang thành công; workflow artifact nhãn “Thiết kế/kế hoạch”;
  docsState lấy từ Project DTO, không suy từ HTTP 200; docsState lỗi → “Chưa xác định”.
- ✅ 422 `DOCS_ENCODING_INVALID` hiện rõ, không hiện nội dung cũ.
- ✅ Search cursor mờ chỉ echo lại; tham số `q/projectId/snapshotId/after/limit` khớp `docs/routes.ts:59-72`.
- ✅ Related tickets hiện đúng danh sách server trả, nói rõ giới hạn 20.
- ❌ Brief dòng 19 “Ticket-doc links snapshot thật/paths CAS, 409 giữ draft”: server có `PUT /v2/tickets/:id/docs-links`
  (`tickets/routes.ts:132,502`, body `snapshotId/paths/expectedRevision`) nhưng web không có editor/CAS/409; báo cáo không
  khai mục này trong “Không làm”.
- ⚠️ “Percent-encoded tricks” chỉ chặn khi ra ngoài root; encoded traversal trong root vẫn được chấp nhận, lệch với
  producer (xem Important #2).
- ⚠️ “Commit/time/... luôn hiển thị”: khi page lỗi (422/404) không còn metadata nào (commit của tree cũng ẩn).
- ⚠️ “Switch snapshot cancels GET cũ”: chỉ test đổi project; đổi snapshot cùng project (tree refetch ra snapshot mới) chưa có test.
- ⚠️ Unicode path NFC/NFD: resolver và producer đều không normalize; link NFC tới file NFD (macOS) sẽ bị chặn “không có trong
  phiên bản” — chưa xác minh dữ liệu thật.
- ⚠️ A6docs E2E, cuộn fragment, tải ảnh/nhị phân: không làm, đã khai trong báo cáo (route chưa mount, chưa có API).

### Security

- XSS qua raw HTML: không khả thi — không rehype-raw, `raw` node thành text; test DOM xác nhận không có `script/img/[onerror]`.
- URL nguy hiểm: mọi `href` đi qua `resolveDocLink`; nhánh `external` chỉ nhận `http:/https:` sau `new URL`; nhánh `page` render
  `href="#<encodeURI(path)>"` nên không có sink scheme. Ảnh: không bao giờ `<img>`, chỉ link “Mở ảnh gốc” khi `^https?://`.
- Điểm yếu phòng thủ chiều sâu: `urlTransform={(url) => url}` tắt `defaultUrlTransform` cho mọi phần tử; an toàn hôm nay chỉ vì
  `a`/`img` là hai phần tử duy nhất mang URL và đều bị override (Minor #1).
- Không có code execution, không lưu nội dung tài liệu ra storage; snippet search render dạng text.

### Strengths

- Resolver thuần, test bao phủ các biến thể che giấu scheme (`\t`, `\n`, `\0`, hoa/thường, khoảng trắng đầu).
- Test abort và “không hiện bytes cũ dưới commit mới” là test hành vi thật, không phantom.

### Issues

#### Critical
- Không có.

#### Important
1. `v2/web/src/docs/queries.ts:82-94` + `v2/docs/flows/web-docs.md:27` — docsState dùng key `queryKeys.project(id)`;
   event `docs.imported` (`v2/web/src/lib/events.ts:81-82`) chỉ invalidate `allDocs/docsSearch/projects`, không chạm
   `['v2','project',id]`. Sau import, tree/page refetch ra snapshot mới (unverified) nhưng metadata vẫn ghi “Trạng thái tài liệu:
   Hiện hành” từ cache cũ — đúng loại “stale/unverified hiện như current” mà brief cấm; flow doc khẳng định sai rằng
   `docs.imported` làm mới view này. Fix: đặt query docsState dưới prefix docs, ví dụ `[...queryRoots.docs(projectId), 'state']`
   (được `allDocs` invalidate), hoặc controller bổ sung `queryRoots.project(projectId)` vào `docs.imported`; sửa câu ở flow doc;
   thêm test import → docsState refetch.
2. `v2/web/src/docs/links.ts:61-97` — resolver lệch producer `server/src/docs/links.ts:150-170`: server coi `%2e/%2f/%5c`,
   path bắt đầu `/`, và `?` là `LINK_PATH_ESCAPE` (error), không fallback `dir → dir/index.md`; client lại giải `%2e%2e/x.md`
   (trong root), `%2Fx`, `/abs`, `a.md?q` và thư mục thành link bấm được. Không thoát root, nhưng UI cho bấm link mà audit của
   server đánh lỗi/missing, trái yêu cầu “reject percent-encoded tricks”. Fix: trên `rawPath` chặn `/%(2e|2f|5c)/i`, `?`;
   quyết định rõ (và ghi doc) việc chấp nhận `/abs` và index fallback, hoặc bỏ để khớp producer; thêm test.
3. Brief dòng 19 (ticket-doc links CAS/409 giữ draft) không được làm và không được khai — xem ❌ ở trên. Fix: hoặc hiện thực
   editor dùng `PUT /v2/tickets/:id/docs-links` với `expectedRevision`, 409 giữ draft, path chọn từ tree của snapshot thật; hoặc
   ghi rõ trong báo cáo là chưa làm/ai sở hữu. `useTicketDocsLinks` (`queries.ts:126`) hiện chưa có consumer.

#### Minor
1. `v2/web/src/docs/page.tsx:226` — `urlTransform` identity bỏ lớp sanitize mặc định; giữ `defaultUrlTransform` cho phần tử
   khác `a/img` (hoặc chỉ trả nguyên url cho `key==='href'` của `a`) để thêm phần tử/plugin sau này không mở sink.
2. `v2/web/src/docs/page.tsx:187-193` — lỗi page (422/404) ẩn toàn bộ metadata; hiện ít nhất commit/audit/contentClass của tree
   (`tree.sourceCommit`, `tree.auditState`, row.contentClass) cạnh thông báo lỗi.
3. `v2/web/src/docs/page.tsx:205` — khi docsState không phải `current`, cảnh báo audit của trang bị nuốt (stale + `invalid`
   chỉ hiện cảnh báo stale); nên hiện cả hai.
4. `v2/web/src/docs/space.tsx:96-100` — mọi 404 tree đều thành “chưa có tài liệu”, nhưng `requireDocsScope` cũng trả 404 khi
   project không tồn tại; phân biệt bằng docsState `missing` hoặc message.
5. `v2/web/src/docs/page.tsx:150` — link nội bộ `href="#docs/…"`: mở tab mới/copy link cho URL vô nghĩa; khi route được mount
   nên dùng href thật của router.
6. `v2/web/src/docs/space.tsx:53` — `new Set(seen)` cho mỗi row là O(n·depth); `parentPath` của server luôn là tổ tiên nên
   không thể có vòng — guard này thừa.
7. Thiếu test đổi snapshot trong cùng project (tree refetch → snapshot mới) cho page/search.

### Assessment

**Task quality:** Needs fixes — bảo mật render markdown/link ổn (không có Critical), nhưng docsState có thể hiện “Hiện hành”
cho snapshot import mới, resolver lệch producer về encoded traversal, và mục CAS/409 của brief bị bỏ mà không khai.
