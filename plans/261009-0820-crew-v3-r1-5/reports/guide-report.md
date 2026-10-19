# Báo cáo: trang Hướng dẫn (crew.core)

Commit: b0799c1ab (nhánh sync/paperclip-v2026.1005.0). Chỉ sửa packages/crew-plugin/**.

## Slot thêm (manifest + capability `ui.sidebar.register`)
- page `crew-guide`, routePath `huong-dan`, export `CrewGuidePage`
- sidebar `crew-guide-link` "Hướng dẫn", export `CrewGuideSidebarLink`
- sidebar `crew-link` "Crew", export `CrewSidebarLink` (host không tự đưa page plugin vào sidebar, nên thêm lối vào)

## Điều hướng
`useHostNavigation().linkProps("/huong-dan")` (host tự thêm tiền tố company, href thật, SPA). Active state qua `useHostLocation`. Class lấy từ mục sidebar của host. Trang Crew có link "Xem hướng dẫn" ở đầu trang.

## Trang hướng dẫn
src/ui/guide/index.tsx: `MarkdownBlock` + mục lục từ 11 heading `##` (bỏ qua trong khối code), bấm cuộn tới h2 tương ứng, max-width 860px, bọc ErrorBoundary. Nội dung huong-dan.md không sửa.

## Bundle/test
- build.mjs: loader `.md` = text; guide.d.ts khai báo `*.md`; vitest.config.ts có plugin nạp .md thành chuỗi.
- Test mới guide.test.ts (heading, mục lục >= 10, link sidebar đúng route); ui-bundle.test.ts kiểm 2 export mới.
- build, typecheck OK; vitest 15 file / 30 test pass (lần chạy đầu roots.data.test timeout 5s do embedded Postgres, chạy lại đều pass).
- `grep -c 'require("react' dist/ui/index.js` = 0; check-core-hooks 5/5.
- dist/ui/index.js: 449044 B, gzip 102226 B.
- `git status --ignored`: chỉ dist/, node_modules/ bị ignore; guide/ đã vào commit.
