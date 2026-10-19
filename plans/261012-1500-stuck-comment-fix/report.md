# Sửa lỗi bình luận của owner không đánh thức agent (wake hoãn `remote_cleanup`)

Ngày 12/10/2026. Commit `30ccbd18b` trên `crew/project-access` (fork), chưa deploy.

## Nguyên nhân gốc
Driver SSH gốc không bao giờ ghi biên nhận dừng `metadata.remoteExecutionTermination` lên lease, và `releaseLease` gốc còn xoá biên nhận khi gọi không kèm biên nhận. Cổng tiếp tục hội thoại (`server/src/services/explicit-native-continuation.ts`) đòi mọi lease không local của run trước phải có biên nhận, nên mọi việc đang bị execution recovery giữ mà run cuối chạy qua SSH đều không tiếp tục được bằng bình luận. TPS-127 (run `a0232132…` hủy với `legacy_disposition_repair_suppressed`) là ca dễ thấy nhất. Vòng xét lại định kỳ `resumeExecutionWaitComments` thoát sớm với run legacy thiếu biên nhận nên wake bị giữ mãi.

## Bản vá (chỉ code Crew, không vá lõi)
- `server/src/crew/remote-termination.ts` (mới): sau khi hook H3 dừng run, ghi biên nhận "stopped" khi (a) lệnh dừng trên Mac trả `stopped` và không còn process, hoặc (b) run legacy đã hủy chưa từng khởi chạy (không PID/session, không `adapter.invoke`, hủy trước khi gọi adapter). Bằng chứng ở `metadata.crewRemoteTermination`; ghi xong gọi `resumeRemoteStopComments` để đưa bình luận hoãn vào hàng đợi.
- `server/src/crew/remote-stop.ts`: `startRemoteStopOnRelease` chạy bước ghi biên nhận sau lệnh dừng (kể cả khi dừng quá 20 giây).
- Run đã chạy mà dừng không xác minh được thì vẫn không có biên nhận (giữ quy tắc an toàn).

## Test
- `server/src/__tests__/crew-remote-termination.db.test.ts`: 8 ca Postgres thật (tái hiện, chưa khởi chạy + Mac không tới, đã chạy + dừng xác minh, dừng chưa xác minh, bình luận mới sau biên nhận). Tắt bước ghi biên nhận thì 3 ca đỏ.
- 247 test Crew liên quan + 153 test hàng đợi wake/bình luận xanh; `tsc` sạch; core-hooks 0 lỗi. `verify.sh` bước 5: 693/695, 2 ca plugin timeout không liên quan.

## Còn mở
- TPS-123 (lease kẹt `pending_cleanup` sau `destroy_failed`): driver SSH thiếu `retryPendingSandboxTeardown`; cần vá driver đăng ký trong `crew/release/core-hooks.json`.
- Bấm Stop với run legacy trên SSH: `acknowledgeRemoteStop` chạy trước khi ghi biên nhận; cần vá lõi nhỏ.
- Nên mở issue upstream (driver SSH ghi biên nhận, thêm teardown retry, coi run chưa gọi adapter là đã dừng).
