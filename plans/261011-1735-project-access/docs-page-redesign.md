# Làm lại trang Docs (crew-web)

Commit `e52fd0ecf` trên nhánh `crew/project-access` (worktree `paperclip-issues-ui`), chưa push, chưa deploy.

## Đã đổi

- **Bố cục ba cột** theo trang Hướng dẫn và trang Docs v1:
  - Thanh bên trái dính khi cuộn, gồm hộp chọn **Project** (Select, thay cho hàng nút), ô **Tìm trong tài liệu** và cây
    tài liệu thật. Cây có icon thư mục, thu gọn và mở được, thụt lề bằng padding (bỏ tiền tố "– "), trang đang xem
    được tô đậm. Mỗi trang là link thật nên chép link hay mở tab mới được.
  - Ở giữa là bài đọc: tiêu đề lớn, dòng đường dẫn file, commit và giờ nhận. Markdown có chữ dễ đọc, bảng và code cuộn
    ngang trong khung riêng. Heading `# …` đầu bài trùng tiêu đề thì bị bỏ để không lặp.
  - Cột phải **Trên trang này** lấy từ heading h2/h3 (id kiểu GitHub nên link `#neo` trong repo vẫn đúng) và tô mục
    đang đọc theo vị trí cuộn. Dưới mốc `xl` cột này thành khối thu gọn ở đầu bài. Màn hẹp xếp một cột, cây cao tối đa
    nửa màn hình, không cuộn ngang (đo ở 390 px: 0 px tràn).
- **Trang mặc định:** chưa chọn trang thì mở `index.md` hoặc `README.md` nông nhất (`index` trước `README`), không có
  thì mở trang đầu tiên của cây. Thông báo "Chọn một trang" đã bỏ.
- **URL:** dùng `?project=…&path=…`. Gửi link mở đúng project và trang, nút Lùi/Tới hoạt động. Project lạ hoặc không
  được xem thì về project đầu tiên. Trang mặc định không ghi lên URL.
- **Giữ nguyên hành vi cũ:** lọc project bằng `useVisibleProjects`, tìm từ 2 ký tự kèm số kết quả (bấm kết quả mở
  trang), link nội bộ mở trong trang, link hỏng báo trong khung nổi có nút Đóng, danh sách liên kết
  (ok/thiếu/chưa kiểm) dời xuống cuối bài cho gọn, file bị bỏ do quét bí mật ở cuối thanh bên, và đủ các trạng thái
  tải, lỗi, trống. Project chưa có bản docs vẫn đổi sang project khác được. Đổi trang khi đầu bài đã cuộn khuất thì
  cuộn về đầu bài mới.
- **Design system** (`src/ds`):
  - `DocLayout` thêm `aside` tùy chọn. Trang Hướng dẫn không truyền nên không đổi.
  - Widget mới: `DocTree`, `DocPageList`, `DocToc` + `useDocHeadings`, `DocArticle`, `DocAppendix`.
  - `MarkdownView` thêm `variant="document"`. Renderer dùng plugin rehype gắn id và components khai báo một lần, nên
    DOM markdown không bị dựng lại khi trang cha render lại.
  - Thêm icon `FolderOpen`.
- **Hướng dẫn:** sửa mục Docs (vi, en) cho đúng UI mới và chụp lại `img/{vi,en}/docs.webp` bằng `guide-shots`.
- **API/plugin:** không đổi `api.crew.docs*`.

## File

- Mới: `src/ds/widgets/doc-tree.tsx`, `src/ds/widgets/doc-toc.tsx`, `src/ds/widgets/heading-slug.ts`,
  `src/features/docs/docs-paths.ts`, `test/features/docs/docs-paths.test.ts`.
- Sửa: `src/ds/{icons.ts,index.ts}`, `src/ds/widgets/{doc-layout,markdown-renderer,markdown-view}.tsx`,
  `src/features/docs/{docs-page,docs-nav,docs-reader}.tsx`, `src/features/docs/locales/{vi,en}.json`,
  `src/features/guide/content/{huong-dan.vi,guide.en}.md`, `src/features/guide/img/{vi,en}/docs.webp`,
  `test/features/docs/docs-page.test.tsx`.

## Kiểm

- `pnpm --filter @crew/paperclip-web test`: 142 file, 1271 ca đạt, 1 todo. Trong đó có guard design system và guard
  i18n. Riêng trang Docs có 19 ca: trang mặc định, hộp chọn, cây và trang đang xem, URL và nút Lùi, mở bằng link,
  project không được xem, đổi project, thu gọn thư mục rồi tự mở lại, mục lục và neo, tô mục đang đọc khi cuộn, cuộn
  về đầu bài, link nội bộ và link hỏng, danh sách liên kết, file bị bỏ, tìm, 0 kết quả, các trạng thái trống và lỗi.
  Thêm 7 ca cho hàm thuần (trang mặc định, bỏ tiêu đề, slug).
- `typecheck` đạt. `biome check src test e2e` sạch.
- `vite build` với `CREW_UI_COMMIT=539ee5fe576522af9fd654e9949e9b4bae862d6f` (HEAD trước commit), xuất ra thư mục
  scratch: đạt.
- E2E: thư mục `e2e/specs` chỉ có `guide-shots` (recipe `docs`) và `s0-shell` (link menu) nhắc tới Docs; cả hai không
  phải sửa. Đã chạy `CREW_GUIDE_SHOTS_ONLY=docs pnpm guide:shots` trên T1 (`~/crew-ga-t1`, `FORK` trỏ worktree này):
  3/3 đạt, ảnh vi và en đã chụp lại. Không chạy cả bộ e2e.
- Đã dừng server T1 (3199) và vite dev (5183) bằng SIGTERM. Các cổng 3199, 5183, 54329 đều trống.

## Ảnh

- `docs-page-redesign-desktop-home.png`: 1440×900, trang mặc định `docs/index.md` mở sẵn.
- `docs-page-redesign-desktop-toc.png`: 1440×900, đủ ba cột, có mục lục bên phải. **Lưu ý:** dữ liệu mẫu 2P Demo không
  có trang nào có heading, nên khi chụp ảnh này em chặn response `crew.docs.page` trong trình duyệt và thay thân bài
  "Luồng thanh toán" bằng một bài dài hơn. Code và dữ liệu thật không đổi.
- `docs-page-redesign-phone.png`, `docs-page-redesign-phone-scrolled.png`: 390×844, phần đầu trang và phần bài sau khi
  cuộn (có khối "Trên trang này" thu gọn).

## Lưu ý

- Ở bề rộng điện thoại, sidebar của app (240 px) vẫn hiện nên vùng nội dung chỉ còn khoảng 150 px. Đây là hành vi của
  shell chung (`AppFrame`), không thuộc trang Docs, và em không sửa. Trang Docs không cuộn ngang.
- Chưa làm ngăn kéo (drawer) cho cây trên điện thoại như v1. Thay vào đó cây cao tối đa 45vh và cuộn riêng.
- Bản tiếng Anh của Hướng dẫn ghi "Files skipped by the secret scan", còn locale ghi "Files dropped by the secret scan".
  Lệch này có từ trước, em để nguyên.
