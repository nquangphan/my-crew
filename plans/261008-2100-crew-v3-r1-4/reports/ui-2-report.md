# UI-2 — map yêu cầu, tab và trang Crew

Status: DONE_WITH_CONCERNS

## Summary

- Port phép chiếu và layout cây từ map v2 sang `src/ui/map/**`, nhận trực tiếp `CrewMap`: đủ nút gốc/con, cạnh parent/dependency/repair, stage từ `executionState`, assignee, kind, bundle và vòng sửa. React Flow dùng `@xyflow/react` được bundle vào UI; React/React DOM vẫn external. Card dùng màu token host và link issue qua `useHostNavigation().linkProps()`.
- Tab `CrewIssueTab` hiển thị map của gốc cho cả issue con và làm nổi issue hiện tại. Các panel từ `getIssuePanels()` nằm sau map, mỗi panel có error boundary. Dữ liệu lỗi hiện trong khung của tab.
- `crew.roots` đọc PostgreSQL theo company, dùng cùng `isCrewRoot` với `crew.map`, trả gốc mới nhất trước, tiến độ con done/tổng và stage từ `executionState`. Trang `CrewPage` có mục Yêu cầu đang mở và render `getPageSections()` bên dưới, với error boundary riêng; slot `page` id/routePath `crew` và capability `ui.page.register` đã khai đúng một lần.
- Commit `03c31af76` — `feat(plugin): add Crew map and requests page`. Không push, deploy hay SSH.

## TDD và kiểm chứng

- Đỏ: `corepack pnpm --filter @crew/paperclip-plugin test -- roots.data.test.ts project.test.ts` thất bại vì chưa có `handlers/roots.js` và `ui/map/project.js` (2 suite). Test render card ban đầu thất bại vì gói chưa có React làm dev dependency.
- Xanh: `corepack pnpm --filter @crew/paperclip-plugin test` — 6 suite, 14/14 test đạt. Test mới gồm PostgreSQL embedded với 2 company, hai gốc Crew và tiến độ con; phép chiếu/layout CRE-36 có ba con, CRE-37 → CRE-38 dependency và một cạnh repair; render card React Flow thật với stage, assignee, bundle, vòng sửa, link và đánh dấu nút hiện tại.
- `corepack pnpm --filter @crew/paperclip-plugin typecheck` và `build` — đạt.
- `node crew/release/check-core-hooks.mjs` — hook 5/5, lỗi 0 (cảnh báo PR upstream có sẵn).
- `git diff --check` — đạt. Trước test embedded, `ipcs -m` có 5 segment; không gỡ segment nào.
- `dist/ui/index.js`: 410.394 byte thô, 91.017 byte gzip, dưới 1,5 MB. CSS React Flow được nhúng vào JS để host tải cùng entrypoint.
- Sau commit, `git status --ignored --short packages/crew-plugin` chỉ hiện `dist/` và `node_modules/`; không có source bị bỏ qua.

## Concerns

- Theo giới hạn chỉ sửa `packages/crew-plugin/**`, không cập nhật `pnpm-lock.yaml` ở gốc. `package.json` đã thêm `@xyflow/react` và React/React DOM + type packages làm dev dependency; nhánh tích hợp cần cập nhật lockfile trước khi chạy frozen install/CI.
- Chưa chạy cổng trình duyệt trên instance thật; nghiệm thu Playwright thuộc AC-4 sau khi gộp UI-3/UI-4. Không chạy full suite theo luật Mac mini dùng chung.
