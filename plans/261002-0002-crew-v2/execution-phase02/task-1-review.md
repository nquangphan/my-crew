### Spec Compliance

- ❌ Có một điểm chưa đạt: runner không bảo đảm dọn container khi test con giữ sống sau SIGINT/SIGTERM; handler chỉ gửi tín hiệu rồi tiếp tục đợi `close`, nên `finally` không chạy (`v2/server/scripts/test-db.ts:34-38,76-99`). Đây là yêu cầu cleanup khi bị ngắt trong brief.
- ✅ Các phần còn lại khớp hợp đồng Task 1: package v2 độc lập và strict TS (`v2/server/package.json:1-26`, `v2/server/tsconfig.json:1-13`); URL v2 và cổng DB dùng chung bị chặn (`v2/server/src/platform/config.ts:8-23`, `v2/server/src/db/client.ts:4-14`); migration set được chụp và đóng băng, kiểm tra checksum/marker rồi ghi cùng transaction (`v2/server/src/db/migrate.ts:21-87`); fixture chỉ tạo/xóa logical DB riêng trong container test đã đối chiếu (`v2/server/test/support/db.ts:12-63`); flow/docs tiếng Việt đã được bổ sung (`v2/docs/flows/server-platform.md:1-53`).
- ⚠️ Backup và restore trên DB triển khai thật chưa thể xác minh từ diff; Task 1 chỉ diễn tập trong container test (`v2/server/test/platform.test.ts:164-207`), phù hợp phạm vi chưa deploy. Trước khi chạy CLI trên DB có dữ liệu, controller cần kiểm tra bằng chứng backup/restore của chính môi trường đó.

### Strengths

- Migration kiểm tra toàn bộ ledger trước khi chạy phần còn thiếu, giữ advisory lock và transaction bao quanh cả schema lẫn checksum (`v2/server/src/db/migrate.ts:56-87`). Test có kiểm tra chạy đồng thời, drift và rollback SQL lỗi (`v2/server/test/platform.test.ts:42-48,109-146`).
- Fixture xác thực URL, tên và cổng container trước khi tạo DB; pool đóng trước khi `DROP DATABASE` (`v2/server/test/support/db.ts:17-63`). Test backup/restore đọc lại cả marker và dữ liệu (`v2/server/test/platform.test.ts:164-207`).

### Issues

#### Critical (Must Fix)

- Không có.

#### Important (Should Fix)

- `v2/server/scripts/test-db.ts:34-38,76-99`: SIGINT/SIGTERM chỉ gọi `child.kill(signal)` rồi chờ `close` vô hạn. Nếu test con giữ handler tín hiệu hoặc không thoát, runner không vào `finally`, để container test tồn tại và không trả quyền điều khiển. Cần giới hạn thời gian chờ sau tín hiệu, cưỡng bức kết thúc test con nếu cần, rồi luôn dừng đúng container ID đã ghi; kiểm tra bằng test con cố tình bỏ qua tín hiệu.

#### Minor (Nice to Have)

- Không có.

### Assessment

**Task quality:** Needs fixes

**Reasoning:** Nền tảng DB và fixture có kiểm tra hành vi thực, các tuyên bố chính trong report được diff hỗ trợ. Đường ngắt với test con không hợp tác vẫn thiếu bảo đảm cleanup nên chưa thể duyệt Task 1.
