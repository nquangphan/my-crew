# Sửa nốt lease SSH kẹt `pending_cleanup` và Stop của run legacy trên SSH

Ngày 12/10/2026. Commit `4ed96172f` (nối tiếp `30ccbd18b`), chưa deploy.

- **Lease kẹt `pending_cleanup` (kiểu TPS-123):** driver SSH gốc thiếu `retryPendingSandboxTeardown` nên vòng dọn báo `destroy_failed` mãi. Vá driver P8 (một dòng trong `createSshEnvironmentDriver`) gọi `server/src/crew/ssh-pending-teardown.ts`: trả biên nhận "stopped" khi run chưa từng khởi chạy (không cần SSH) hoặc lệnh dừng Crew xác minh không còn process. Chưa xác minh được: lỗi cố định, mỗi lần ghi activity `crew.remote_stop`, lần thứ 5 ghi đúng một `crew.remote_stop.escalated`, sau đó chỉ log. Lease kẹt từ trước được nhả ở lần quét kế tiếp.
- **Stop run legacy trên SSH:** vá lõi C9 export `acknowledgeRemoteStop` từ `heartbeatService`; Crew gọi nó sau khi ghi biên nhận rồi mới `resumeRemoteStopComments`.
- P8, C9 đăng ký trong `crew/release/core-hooks.json`; core-hooks 0 lỗi.
- Test: `server/src/__tests__/crew-ssh-pending-teardown.db.test.ts` 6 ca Postgres thật (gỡ vá thì ca 1, 2, 6 đỏ). Crew suites + continuation 254/254; wake/comment 417/419 (2 ca `issue-comment-reopen-routes` chập chờn khi chạy song song, chạy riêng 235/235); `tsc` sạch.
- Còn mở: `crew/ops/inspect-image.sh` chưa liệt kê `remote-termination`, `ssh-pending-teardown`; ngưỡng 5 chép từ `PENDING_CLEANUP_SWEEP_ATTEMPT_CAP` (lõi không export); nên mở issue upstream.
