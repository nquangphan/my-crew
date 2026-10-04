# Task 3 — review spec và chất lượng

**Kết luận: cần sửa trước khi nghiệm thu.** Diff `41c3807..e81f08e` đáp ứng phần lớn hợp đồng auth/binding: cookie phiên, kiểm tra Origin và CSRF cho mutation, bearer machine tách quyền owner, scrypt, hash token, mã hóa response cấp máy với AAD, khóa hàng project và tăng binding revision. Báo cáo worker ghi 38/38 test server, 14/14 test domain, typecheck và Biome đạt; reviewer chỉ đọc diff, không chạy lại các suite đó.

## Findings

1. **P1 — Có thể vượt giới hạn đăng nhập sai bằng request đồng thời** — `v2/server/src/auth/routes.ts:96-110`. Handler đọc `failed.get(ipHash)` và kiểm tra ngưỡng trước hai thao tác `await` (query owner và `verifyPassword` dùng scrypt); sau đó mỗi request ghi lại mảng `recent` riêng. Nhiều request sai mật khẩu cùng IP khởi chạy đồng thời đều thấy số lỗi cũ dưới 5, đều được thử, rồi ghi đè lần tăng của nhau. Vì vậy giới hạn 5 lần/5 phút trong brief không được thực thi khi có concurrency. Cần đặt chỗ lượt thử một cách nguyên tử trước khi chờ xác minh (hoặc serialize theo IP), hoàn lại/điều chỉnh đúng khi thành công, và thêm test nhiều login sai song song rồi xác nhận request tiếp theo nhận 429. `failed` cũng không xóa các IP đã hết hạn nếu IP đó không quay lại, nên cần TTL/bounded cleanup khi sửa cơ chế này.

2. **P2 — Danh sách máy không tuân hợp đồng phân trang chung** — `v2/server/src/auth/routes.ts:157-159`. `GET /v2/machines` đọc toàn bộ bảng, không nhận `limit`/`cursor`, không trả `nextCursor`. Brief yêu cầu pagination 1–100, mặc định 50, thứ tự ID/cursor ổn định cho HTTP list; response hiện có thể tăng không giới hạn theo số máy được provision. Bổ sung schema query cấm field lạ, giới hạn 1–100 và cursor theo ID, kèm test trang kế tiếp. Vẫn chỉ trả metadata, không token/hash.

## Điều kiện tích hợp và phạm vi

- Task 7 phải gắn `credentialResponseCodec(sessionEncryptionKey)` vào production `createMutator`; fixture Task 3 đã làm đúng. Nếu dùng codec mặc định, token máy sẽ nằm dạng rõ trong journal response. Đây là điểm bàn giao đã được worker ghi nhận, không phải lỗi của file Task 3.
- Task 5 phải truyền guard kiểm tra attempt `active`, `uncertain`, `finalizing` trong cùng transaction khi project đã bound. Default `denyRebinding` hiện fail closed; không chặn Task 3 vì bảng attempt chưa thuộc migration 003.
- `docsState` của project đang cố định `missing`; Task 6/7 cần thay read model khi snapshot docs xuất hiện. Việc kiểm tra scope event/journal theo transaction thuộc Task 2 và đang được xử lý riêng, nên review này không lặp finding đó.
