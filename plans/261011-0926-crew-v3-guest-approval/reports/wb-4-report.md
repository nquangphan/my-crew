# WB-4 — Trang Thành viên (báo cáo)

Worktree `~/Documents/projects/crew/.worktrees/paperclip-ga-wb4`, nhánh `crew/ga-wb4`. Ngày 11/10/2026.

## Commit
- `946c47ab2a` feat(crew-web): trang Thành viên mời khách góp ý, duyệt tham gia và bật gỡ dấu Phòng Marketing

## Kết quả lệnh
- `test`: 130 file, 1066 test xanh (1 todo có sẵn). `typecheck`, `lint` sạch.
- `vite build`: xanh (`CREW_UI_COMMIT` = HEAD, ra thư mục tạm ngoài repo). Không để dev server nào chạy.

## Đã làm
- `members-model.ts` (hàm thuần): `inviteLink` (`<origin>/paperclip/invite/<token>`), `isContributorInvite`, `pendingJoins` (nối yêu cầu với lời mời bằng `inviteId`, chỉ lấy yêu cầu của người đang `pending_approval`), `displayRole` (viewer có dấu thành "Phòng Marketing"), `approveJoin` (duyệt rồi bật dấu).
- `use-members.ts`: query thành viên, dấu khách, lời mời, yêu cầu tham gia; các mutation làm mới đúng danh sách.
- `members-section.tsx`: bảng thành viên với role; nút Bật góp ý (viewer thuần), Gỡ góp ý (khách).
- `invites-section.tsx`: nút Mời khách góp ý (body đúng spec §3.4), link kèm nút chép, danh sách lời mời còn hiệu lực, Thu hồi có xác nhận.
- `join-requests-section.tsx`: yêu cầu chờ duyệt, nhãn "Lời mời khách góp ý", Duyệt / Từ chối. Duyệt lời mời khách thì gọi `approve` rồi `PUT contributors/:userId`; bước hai lỗi thì hiện cảnh báo, người đó vẫn là viewer thuần và có nút Bật góp ý. Mục ẩn khi không có yêu cầu.
- Locale vi/en đủ khóa. Link mời chỉ giữ trong state của trang, token không ghi log.

## Lệch / lưu ý
- Sửa `test/features/access/skeleton-pages.test.tsx` (ngoài danh sách WB-4, của WB-1): trang giờ gọi API thật nên test cũ phải mock bốn danh sách rỗng. Chỉ đổi đoạn Thành viên.
- Thêm nút Từ chối yêu cầu tham gia (client `joinRequests.reject` có sẵn, owner cần cách bỏ yêu cầu).
- Lấy lời mời bằng `invites.listAll` (limit 100) để nối cả lời mời đã `accepted`; danh sách hiển thị lọc `state==='active'`. Quá 100 lời mời thì lời mời cũ có thể mất nhãn khách góp ý. Không xử lý phân trang.
- Chỉ hiện yêu cầu `requestType==='human'`; yêu cầu tham gia của agent không thuộc trang này.
- Giả định dạng trả về stock theo client WB-1: `{members}`, `{invites}`, mảng `join-requests`. Chưa chạy với server thật; mock HTTP theo spec §5.
- Nút cuối hàng căn trái (guard design-system cấm `text-right`).

Status: DONE
