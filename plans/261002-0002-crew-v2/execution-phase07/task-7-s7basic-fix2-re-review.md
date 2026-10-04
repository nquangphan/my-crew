# Re-review vòng sửa 2 S7basic (2f94ed3..3b202e9)

Đã đọc diff, đối chiếu `server/src/journal/mutation.ts`. Không chạy test.

### Verdict
- **Important 1 (câu thông báo): ADDRESSED.** Câu mới “Máy đã được đăng ký nhưng không hiển thị được token. Hãy đăng ký một máy mới với tên khác.” chỉ dẫn việc làm được (server và web không có thu hồi máy); test khẳng định có câu mới và không còn “thu hồi”. Máy mồ côi vẫn hiện “Đang dùng” (giới hạn đã biết, chờ thu hồi ở S7full/server), tên khác giúp phân biệt.
- **Minor 1 (Bỏ cho tombstone + IDEMPOTENCY_CONFLICT): ADDRESSED.** Nút hiện theo `entry` (cả tombstone), `pending.reject(entry.id)` theo id, trường đang nhập được giữ (chỉ ghi đè từ `heldBody` khi có payload); test đi đủ chuỗi tombstone → nhập khác → 409 conflict → Bỏ → khóa mới. Test chỉ phủ form máy; project/bind dùng cùng đoạn mã nhưng chưa có test tombstone riêng (Minor).
- **Minor 2 (guard issued): ADDRESSED.** `onSubmit` bỏ qua khi `issued !== null && held === null`, khớp với `disabled` của nút; test dùng `fireEvent.submit` trực tiếp và khẳng định chỉ 1 POST.

### FakeServer 409 IDEMPOTENCY_CONFLICT
Đúng về hành vi cần thiết, lệch nhỏ về chi tiết:
- Khớp: receipt tra theo (route, key) trước khi chạy xử lý; cùng key khác body → 409 `IDEMPOTENCY_CONFLICT`; cùng body → phát lại response gốc; receipt được lưu trước khi giả lập mất phản hồi (commit rồi mất), tương ứng `createMutator` (`journal/mutation.ts:35-39`).
- Lệch (Minor): server băm `canonicalJson(body)` (bất biến theo thứ tự khóa), fake so sánh chuỗi thô. Client luôn gửi cùng `JSON.stringify` nên không ảnh hưởng test; server thật còn kiểm schema (400) và auth trước mutator, fake không có. Không làm test sai kết luận.

### Findings
- Minor: thiếu test tombstone + Bỏ cho `project:create` và bind.
- Minor: fake so body thô thay vì canonical, nên ghi chú trong test để không dùng nó chứng minh thứ tự khóa.
- Không thấy breakage mới.
