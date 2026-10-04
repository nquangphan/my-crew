# Task 3 — re-review fix round 1

**Kết luận: hai finding đã được sửa; không thấy lỗi mới trong diff sửa lỗi `033a572..51e562e`.** Review chỉ xét thay đổi vòng này và bằng chứng worker báo cáo; reviewer không chạy lại test.

1. **P1 login đồng thời — resolved.** `v2/server/src/auth/routes.ts:79-138` đặt `pending++` đồng bộ trước DB query/scrypt và kiểm tra `failures.length + pending >= 5`; `finally` trả chỗ, login sai ghi timestamp, login đúng xóa các lỗi đã hoàn tất. Cùng IP không thể vượt ngưỡng bằng các request đồng thời trong một process. Map được quét theo TTL và giới hạn 10.000 IP, giải quyết cả việc giữ IP hết hạn vô hạn. Test dùng barrier cho 12 request đồng thời, xác nhận 5 lần 401, 7 lần 429 và lần tiếp theo 429; test thêm cửa sổ hết hạn và reset sau login đúng.

2. **P2 danh sách máy — resolved.** `v2/server/src/auth/routes.ts:179-207` nhận đúng `limit` và UUID `cursor`, cấm query lạ, giới hạn 1–100/mặc định 50, truy vấn theo ID với `limit + 1`, trả `{items,nextCursor}` và chỉ metadata. Test xác nhận ba trang, mặc định 50, input sai 400 và response không chứa token/hash.

**Bằng chứng kiểm tra do worker cung cấp:** auth 13/13, project 6/6, toàn server 51/51, typecheck đạt, Biome 3 file sạch; docs R3/staged check được controller báo đạt. Không có thay đổi source ngoài auth route, auth test, fixture và flow doc trong diff này. Các điều kiện tích hợp Task 5 guard và Task 7 codec từ review đầu vẫn áp dụng.
