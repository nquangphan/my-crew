## Re-review P-G4r fix1 (947ffb5..f100caf)

**Verdict:** I1 ADDRESSED (kèm 1 Minor mới), M1 ADDRESSED.

### I1 lease received
- ADDRESSED: `received` quá 5 phút không còn chặn; `queued` luôn là command mở; hằng `RECEIVED_COMMAND_LEASE_MS` ở service.ts, test chứng minh young trả lại command, stale xếp command mới (2 hàng).
- Khớp daemon: backoff tối đa `min(60000, 1000*2^6) * 1.25 = 75s` (gateway-sync.ts:285) đúng như claim. Nhưng backoff chỉ là khoảng nghỉ giữa các lần thử, không phải giới hạn thời gian của một lần cài; không có lease/timeout 5 phút nào trong v2/gateway để "khớp". 5 phút là heuristic của server, không phải hợp đồng với daemon.
- Điểm yếu: ack `received` lặp lại ở mỗi lần process, nhưng server trả lại hàng cũ khi đã `received` (không refresh `received_at`, service.ts ack dòng `received && phase==='received'`). Lease đo từ lần nhận đầu, không phải lần hoạt động gần nhất. Command đang được daemon thử lại liên tục (report không accepted, attempts++) quá 5 phút sẽ bị coi là stale dù còn sống.
- Có hai `sync_workflows` song song không: có thể có hai command mở cùng revision (một received-stale + một queued mới; lần retry thứ ba gặp `queued` nên dedupe, tối đa 2). Không chạy song song thực sự: daemon xử lý tuần tự trong `store.transaction` (atomic-records.ts:130, hàng đợi `tail`), và một máy một boot. Hai command cùng revision chạy lần lượt, mỗi cái một reportId; report thứ hai chỉ lặp lại công việc, không sai trạng thái. Command cũ không bị hủy phía server nên vẫn có thể hoàn tất sau.

### M1 CONFIG_DISABLED
- ADDRESSED: 409 `CONFIG_DISABLED` sau khi kiểm tra chưa cấu hình và revision lệch, trước khi truy vấn/xếp command; test xác nhận không tăng số command. Thứ tự hợp lý (revision lệch được ưu tiên báo, disabled không làm lộ thêm thông tin vì owner đã đọc được config).

### Issues
- Minor N1 service.ts requestWorkflowRetry: lease dựa trên `received_at` không được làm mới nên có thể cắt nhầm command còn sống (xem trên). Fix thấp chi phí: giữ nguyên (hậu quả chỉ là một command trùng, tuần tự, vô hại) và ghi chú trong comment/docs rằng 5 phút là heuristic server-side; hoặc làm mới `received_at` khi nhận lại ack received.
- Minor N2 comment/docs/report nói "5 phút đủ cho cài chậm" như thể gắn với daemon; nên sửa lời để không khẳng định hợp đồng không tồn tại.

**Task quality:** Approved.
