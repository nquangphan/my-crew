# WB-2 — Phía khách góp ý (báo cáo)

Worktree `~/Documents/projects/crew/.worktrees/paperclip-ga-wb2`, nhánh `crew/ga-wb2`. Ngày 11/10/2026.

## Commit
- Một commit `feat(crew-web): khách góp ý gửi yêu cầu, bình luận chờ duyệt và xem trang Góp ý của tôi` (hash: `git log -1` trên nhánh).

## Kết quả lệnh
- `test`: 128 file, 1043 test xanh (chạy 2 lần, không flake). `typecheck`, `lint` sạch. `vite build` xanh (CREW_UI_COMMIT = HEAD trước commit, ra thư mục tạm).

## Đã làm
- `new-contribution-dialog.tsx`: project (bỏ project đã archive), tiêu đề (tối đa 240), mô tả; gửi `POST contributions` `{kind:'issue',projectId,title,description?}`; xong hiện "Đã gửi, chờ owner duyệt"; invalidate toàn bộ `contributions(c)` (danh sách + summary). `NewRequestDialog` đọc `access`: khách thì mở dialog này, owner giữ dialog cũ, đang tải vai trò thì chưa render gì (không chớp dialog sai, không gọi route chỉ owner).
- `contribution-composer.tsx`: `Composer` chọn theo `isContributor`; khách gửi `{kind:'comment',issueId,body}`, không đính kèm, không gọi route bình luận stock.
- `pending-comments.tsx` + `comments.tsx`: bình luận chờ/đang duyệt dở/bị từ chối xếp xen bình luận thật theo `createdAt` (thật đứng trước khi trùng giờ), badge, tên tác giả từ user-directory; chip "Góp ý của <tên>" dưới bình luận thật có `resultCommentId`. Chỉ owner và khách gọi `contributions?issueId=`. `PendingComment` có prop `actions` (chỗ gắn nút của WB-3).
- `contributions-page.tsx`: ba tab Chờ duyệt / Bị từ chối / Đã duyệt (đếm theo tab; `approving` tính là chờ), dữ liệu thật, mục đã duyệt có link tới issue/bình luận thật; owner thấy tên tác giả; không có nút Duyệt/Từ chối.
- `contribution-badge.tsx` (ds `Badge`), `use-contributions.ts` thêm `useContributions`, `useIssueContributions`, `useCreateContribution`, `useAuthorNames`. Locale vi/en đủ khóa.

## Lệch / lưu ý
- Guard design-system cấm class ngoài layout, nên "nền mờ" của bình luận chờ không làm được bằng `opacity`; phân biệt bằng badge. Nếu muốn mờ thật cần thêm biến thể ở `src/ds` (ngoài phạm vi).
- Badge `approving` hiện cùng nhãn "Chờ duyệt"; nhãn "Đang duyệt dở" của owner để WB-3 làm cùng nút Duyệt lại.
- Link tới issue dùng id (uuid) làm tham chiếu `IssueLink`; route stock `GET /issues/:id` nhận cả id lẫn mã, nhưng chưa thử trên server thật.
- Sửa hai test của WB-1 vì hành vi đổi theo đúng ticket: `read-only.test.tsx` (khách thấy "Gửi để owner duyệt", không thấy "Gửi bình luận") và `skeleton-pages.test.tsx` (trang giờ gọi list thật, mock rỗng).
- Mọi HTTP trong test là mock theo spec §5; chưa chạy với router thật.

Status: DONE
