# Trang Yêu cầu: chế độ Bảng Kanban (crew-web)

- Worktree: `/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-issues-ui`, nhánh `crew/project-access`
- Commit: `05e4539f6` feat(crew-web): trang Yêu cầu có chế độ Bảng Kanban như Paperclip (chưa push, chưa deploy)

## Đã chép từ stock

- **Nút Danh sách/Bảng** (`IssuesList.tsx`): hai nút dính liền, icon `List` / `SquareKanban`, đứng đầu nhóm nút bên phải
  thanh công cụ. Trạng thái nằm trong URL `?view=board`; mặc định là Danh sách (không có tham số).
- **Ở chế độ Bảng, thanh công cụ giống stock**: ẩn Sắp xếp và Nhóm, hiện bốn nút mật độ bảng là Thẻ gọn (`ChevronsDownUp`),
  Thu cột lạnh (`PanelTopClose`), Số thẻ mỗi cột 10/25/50 (`ListCollapse`) và Đặt lại (`RotateCcw`). Các giá trị này nằm
  trong URL qua `density`, `lanes`, `per`.
- **Ngưỡng nhiều thẻ**: quá 100 thẻ (`KANBAN_BOARD_HIGH_VOLUME_THRESHOLD`) thì mật độ "tự động" chuyển sang thẻ gọn.
- **Bảng** (`KanbanBoard.tsx`):
  - Cột theo thứ tự backlog, todo, in_progress, in_review, blocked, done, cancelled. Mỗi cột có màu riêng, glyph trạng
    thái và số đếm.
  - Cột lạnh thu thành thanh dọc. Mỗi cột hiện từng trang thẻ, có nút "Hiện thêm N" và dòng "Đang hiện x/y".
  - Thẻ có mã, badge "Cần bước tiếp" (successfulRunHandoff), chấm Đang chạy, badge "n con đang chạy", tiêu đề tối đa 2
    dòng và người làm.
  - Kéo thả dùng `@dnd-kit`: PointerSensor với khoảng cách 5px, DragOverlay. Đích thả là một cột hoặc một thẻ trong cột đó.
- Bảng nằm ở `packages/crew-web/src/ds/widgets/kanban-board.tsx`, dựng lại bằng component và token của ds crew-web,
  không import `ui/src`. Các token `--sz-52px/120px/220px/260px` đã có sẵn trong `tokens.css`.

## Phần Crew giữ lại

- Thẻ có chip giai đoạn Crew (`StageBadge`) và "x/y con xong" của yêu cầu gốc.
- **Chờ duyệt**: mục chờ duyệt là góp ý (contribution), chưa phải issue và không có trạng thái, nên không có thẻ để gắn
  dấu. Nút chip "Chờ duyệt (n)" và nhóm Chờ duyệt vẫn nằm trên bảng y như ở danh sách.
- Tìm kiếm và mọi bộ lọc (trạng thái, người làm, project, loại Nghiên cứu/Code) áp dụng như danh sách. Thứ tự thẻ trong
  mỗi cột theo kiểu sắp xếp đang đặt trong URL.
- Kéo thẻ gọi `api.issues.update(id, { status })`, tức PATCH `/api/issues/:id`. Endpoint này đã có sẵn nên không thêm
  endpoint id. Thẻ sang cột mới ngay khi thả.
  - Server nhận: làm mới danh sách issue, issue đó và dữ liệu Crew.
  - Server từ chối (vd. 422): thẻ về cột cũ và hiện `ErrorState` "Không đổi được trạng thái của TPS-x" kèm nguyên văn câu
    lỗi của server. Không thử lại.
- Người chỉ đọc (`useCompanyAccess().readOnly`, gồm cả lúc đang tải vai trò) thấy bảng nhưng không có `DndContext` và
  không có thẻ kéo được.
- Danh sách không đổi.

## Khác stock và lý do

- **Tải dữ liệu**: stock gọi 7 truy vấn, mỗi trạng thái một truy vấn tối đa 200 thẻ, kèm dòng báo "đạt giới hạn cột".
  Crew dùng lại đúng truy vấn của danh sách (compact, tối đa 1000). Cách này giữ bảng và danh sách cùng dữ liệu, cùng bộ
  lọc trạng thái phía server, và mỗi lần mở trang chỉ tốn một request. Vì vậy không có dòng báo giới hạn cột.
- **Cột lạnh**: stock có thêm chế độ `auto` (tự thu cột lạnh khi quá 100 thẻ), nhưng UI không chọn được chế độ này và mặc
  định của stock là `expanded`. Crew chỉ có mở/thu.
- **Menu Cột** vẫn hiện ở chế độ Bảng như stock, nhưng chỉ ảnh hưởng dòng của danh sách.
- **Ưu tiên**: không hiện, vì stock cũng ẩn (`SHOW_TASK_PRIORITY_UI`).
- **Người làm**: dùng `Identity` của ds thay cho `AgentIdentity` của stock.
- **Thẻ không gọn**: chấm Đang chạy có thêm chữ `sr-only` để trình đọc màn hình đọc được.
- **Mở thẻ**: dùng popup/trang như dòng danh sách (`useIssueOpener`), không dùng route `/issues/:id` của stock.

## File

- `packages/crew-web/src/ds/widgets/kanban-board.tsx` (mới): `KanbanBoard`, `KanbanToolbarControls`, các hằng số và
  `resolveKanbanTargetStatus`.
- `packages/crew-web/src/ds/widgets/issue-list.tsx`: thêm `ToolbarViewToggle`. `src/ds/index.ts`: export widget mới.
- `packages/crew-web/src/features/issues/list/issues-board.tsx` (mới): nối dữ liệu, mutation và lỗi; `boardLayout`.
- `packages/crew-web/src/features/issues/list/issues-page.tsx`: nút chuyển chế độ, nút mật độ bảng, ẩn Sắp xếp/Nhóm khi
  ở Bảng.
- `use-issues.ts`: thêm `view`, `density`, `lanes`, `pageSize` vào trạng thái URL. `list-view.ts`: thêm
  `subtreeLiveCounts`, `needsNextStep`.
- `locales/vi.json` và `en.json`: thêm nhóm khóa `board`.
- `package.json` và `pnpm-lock.yaml`: thêm `@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10.0.0`,
  `@dnd-kit/utilities ^3.2.2`, cùng phiên bản với `ui`.
- `packages/crew-web/test/features/issues/issues-board.test.tsx` (mới).

## Kiểm tra

- `tsc --noEmit -p packages/crew-web`: đạt (exit 0).
- biome trên các file đã sửa: đạt.
- `vitest run test/features/issues/issues-board.test.tsx`: 10/10 đạt. Các ca kiểm:
  - nút chuyển ghi/bỏ `?view=board`;
  - cột theo thứ tự và thẻ đúng cột, có số đếm;
  - thẻ có mã, người làm, chip giai đoạn và link;
  - bảng theo tìm kiếm và bộ lọc;
  - kéo thả gửi PATCH `{status}` và thẻ sang cột mới ngay;
  - thả lên thẻ thì lấy cột của thẻ đó, thả cùng cột thì không gửi;
  - 422 làm thẻ về cột cũ, hiện nguyên văn câu lỗi và chỉ có 1 PATCH;
  - viewer không có DndContext và không có thẻ kéo được;
  - đọc trạng thái URL;
  - ngưỡng 100 thẻ và thu cột lạnh.
- Kéo thả trong jsdom: không đo được vị trí phần tử, nên test giữ `DndContext` thật, lấy `onDragEnd` và gọi nó để giả cú
  thả.
- Bộ liên quan `test/features/issues`, `test/guards`, `test/api/endpoints.test.ts`, `test/i18n`, `test/e2e-coverage.test.ts`,
  `test/ds`: 322 đạt, 1 todo, **1 lỗi có từ trước**.
  - Lỗi đó là `design-system.test.ts`, ca "className ngoài ds chỉ dùng class bố cục". Nó báo các class trong
    `issues/detail/attachments.tsx`, `issues/detail/comments.tsx` và `issues/new/new-request-dialog.tsx`, từ các commit
    trước như `f33c11b72`. Không có file nào của thay đổi này.
- Không chạy Playwright. Không chụp ảnh so sánh, vì cần API thật có phiên đăng nhập.

Status: DONE_WITH_CONCERNS
Summary: Đã thêm nút Danh sách/Bảng và bảng Kanban chép từ stock, kéo thả đổi trạng thái qua PATCH; lỗi thì thẻ về cột cũ và hiện nguyên văn câu lỗi, viewer không kéo được. Commit 05e4539f6, chưa push.
Concerns/Blockers: Guard design-system đang đỏ từ trước vì class trong attachments/comments/new-request-dialog, không do thay đổi này. Bảng dùng một truy vấn chung (tối đa 1000) thay cho 7 truy vấn theo cột của stock. Chưa có ảnh so sánh.
