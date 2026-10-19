# WB-3 — Phía owner: duyệt, từ chối góp ý (báo cáo)

Worktree `~/Documents/projects/crew/.worktrees/paperclip-ga-wb3`, nhánh `crew/ga-wb3`. Ngày 11/10/2026 (Asia/Ho_Chi_Minh).

## Commit
- `2b9d848f8` fix(crew-web): gọi loại tài khoản là Phòng Marketing ở trang Thành viên
- `1350f22d3` feat(crew-web): owner duyệt, từ chối góp ý của Phòng Marketing

## Kết quả lệnh
- `test`: 135 file, 1103 test xanh, 1 todo có sẵn. Chạy 2 lần, không flake. Trước ticket: 130 file, 1066 test.
- `typecheck` và `lint` (biome) đều sạch.
- `vite build` xanh với `CREW_UI_COMMIT` = HEAD `1350f22d3`, xuất ra thư mục scratch ngoài repo.
- Không còn dev server hay tiến trình nào chạy.

## Đã làm
- `approve-flow.ts` (hàm thuần): `approveContribution(companyId, c, choices, deps)` chạy theo thứ tự `approve` → route stock → `complete`.
  - Issue gửi kèm `idempotencyKey`. Bình luận gửi `clientRequestId` và không có cờ reopen/resume.
  - Bước 2 lỗi thì ném `ApproveError(step='post')` và không gọi `complete`.
  - Lỗi kiểm lựa chọn (loại Nghiên cứu nhưng thiếu nhãn) ném ra trước khi khóa.
  - `contributionErrorKey` chọn câu báo theo mã lỗi. `contributionFromError` đọc mục mới nhất từ body 409.
- Hook `useApproveContribution` và `useRejectContribution` (trong `use-contributions.ts`). Khi xong, hoặc khi lỗi, hook làm tươi góp ý, số đếm, danh sách issue và bình luận. Riêng lỗi 409 có kèm `contribution` thì hook thay mục đó vào cache ngay.
- `approve-issue-dialog.tsx`:
  - hiện tiêu đề, mô tả, người gửi (chỉ đọc);
  - owner chọn project, loại, **agent nhận việc** (mặc định Trợ Lý của project qua `roles.get`, đổi project thì quay về mặc định) và ô Lưu nháp.
- `reject-confirm.tsx` dùng `ConfirmDialog`.
- `contribution-actions.tsx`: chỉ owner thấy. Mục chờ có Duyệt / Từ chối. Mục `approving` có nhãn "Đang duyệt dở", Duyệt lại và Từ chối. Bấm Duyệt với yêu cầu thì mở dialog; với bình luận thì chạy luôn.
- Gắn nút ở:
  - luồng bình luận (`comments.tsx`, prop `actions` của `PendingComment`);
  - trang Chờ duyệt: tiêu đề và link "Xem" mở popup;
  - nhóm "Chờ duyệt" đầu trang Yêu cầu, kèm chip "Chờ duyệt (n)" (`?pending=1` chỉ hiện nhóm này). Khách chỉ thấy mục của mình, không có nút.
- Popup `?contribution=<id>`: `contribution-popup-host.tsx` nạp lười và được gắn ở `shell.tsx` cạnh `IssuePopupHost`. Link sang issue thay hẳn popup này bằng popup issue.
- Tổng quan có thẻ "Góp ý chờ duyệt", chỉ owner thấy và chỉ owner gọi `summary`.
- Hướng dẫn vi/en thêm mục **15. Phòng Marketing** (mời, gửi, duyệt, từ chối, agent không thấy gì) và một dòng thuật ngữ. Mục 15–18 cũ dời thành 16–19, các câu dẫn "mục N" sửa theo.
- `buildCreateBody` nhận thêm `idempotencyKey` (kiểu `CreateBodyInput`).
- Đổi tên loại tài khoản ở trang Thành viên:
  - "Mời khách góp ý" thành "Mời Phòng Marketing";
  - "Bật/Gỡ góp ý" thành "Đặt/Gỡ Phòng Marketing";
  - "Lời mời khách góp ý" thành "Lời mời Phòng Marketing";
  - câu báo lỗi đổi theo;
  - bản en dùng "Marketing".

  Các chữ nói về nội dung ("Góp ý của tôi", "Góp ý của X") giữ nguyên.
- Mã lỗi theo spec §5.4 (tin của controller) có câu tiếng Việt riêng: `not_materialized`, `decided`, `locked`, `not_approving`, `already_approved`, `invalid`, `invalid_target`, `forbidden`, cùng 404 của router. Lỗi route stock ở bước đăng thì hiện nguyên văn.

## Test mới
- `test/features/contributions/approve-flow.test.ts` (12 ca): thứ tự gọi, khóa idempotent, lỗi bước 2, 409 khi complete, giữ lại khóa cũ khi duyệt lại, ánh xạ mã lỗi.
- `approve-dialog.test.tsx` (5 ca): mặc định Trợ Lý; Lưu nháp tạo `backlog` kèm `idempotencyKey`; không nháp tạo `todo`; 409 complete; project chưa có Trợ Lý.
- `approve-actions.test.tsx` (7 ca): duyệt bình luận đủ 3 bước; lỗi bước đăng; 409 locked; trạng thái "Đang duyệt dở"; Từ chối có xác nhận; 409 `already_approved` cập nhật mục; khách không có nút.
- `approve-popup.test.tsx` (5 ca): hợp đồng URL, popup owner và khách, link sang issue, nút Đóng.
- `test/features/issues/issues-page-pending.test.tsx` (6 ca): nhóm Chờ duyệt, chip lọc, mở popup, dialog duyệt, khách, operator không gọi route góp ý.

## Lệch / lưu ý
- Chữ ký hàm là `approveContribution(companyId, c, choices, deps)`. Plan ghi `(c, choices, deps)`, nhưng `Contribution` không có `companyId` nên phải thêm tham số.
- Sửa thêm vài file ngoài danh sách sở hữu của WB-3, đúng phạm vi task giao: `comments.tsx`, `contributions-page.tsx`, `use-contributions.ts`, `index.ts`, locale contributions; file members và test members (chỉ đổi chuỗi); `test/features/dashboard/dashboard-page.test.tsx` (ca "4 thẻ" giờ chạy với vai trò operator vì owner có thẻ thứ 5).
- Badge trạng thái dùng chung vẫn hiện "Chờ duyệt" cho `approving`. Owner thấy thêm nhãn "Đang duyệt dở" ở cụm nút.
- Spec §1 ghi nhãn en là "Contributor". Theo yêu cầu của owner, nhãn en dùng "Marketing".
- Chưa chạy tay trên stack T1 (gửi → duyệt → bình luận thật). Mọi HTTP là mock theo spec §5 và §5.4. Không rebase lên `d6c5d3f6a` vì crew-web không phụ thuộc mã server.

Status: DONE_WITH_CONCERNS
Summary: Phía owner đã xong: duyệt 3 bước, xử lý duyệt dở và mã lỗi, nhóm và chip ở danh sách, popup, thẻ dashboard, Hướng dẫn, và đổi tên "Phòng Marketing". Test, typecheck, lint và build đều xanh.
Concerns/Blockers: chưa chạy tay một vòng thật trên stack T1 với router thật.
