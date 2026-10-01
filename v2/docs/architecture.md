# Kiến trúc Crew v2: thư viện miền và nền tảng server

## Thành phần

`v2/` là package TypeScript độc lập. Các module trong `src/` cung cấp hàm thuần để đánh giá quy tắc miền;
`test/` chạy trực tiếp bằng `node:test`. Thư viện không import ứng dụng Crew v1 và không dùng dependency runtime.

## Ranh giới xử lý

Thư viện trả về quyết định dựa trên dữ liệu đầu vào. Package `server/` có nền tảng cấu hình, pool PostgreSQL riêng và migration tường minh. Các task còn lại phần 02 xây xác thực request,
giao dịch cơ sở dữ liệu, lease, lưu trạng thái và điều phối công việc. Thư viện không mô phỏng các trách nhiệm đó
bằng trạng thái trong bộ nhớ.

## Dữ liệu và dịch vụ ngoài

Thư viện miền không có bảng dữ liệu, credential hoặc lời gọi mạng. Nền tảng server kết nối DB v2 riêng, kiểm tra marker/tên DB và checksum migration; fixture kiểm thử tạo rồi xóa đúng DB/container do lượt chạy sở hữu. Migration không tự chạy khi import hay khởi động app. Khóa session được cấp qua biến môi trường v2, không lấy cấu hình v1. Khi chạy, Node.js dùng type
stripping; TypeScript chỉ kiểm tra kiểu và không phát sinh mã JavaScript.

## Kiểm tra

Từ gốc repo, chạy `pnpm --dir v2 test` và `pnpm --dir v2 typecheck`. Lockfile trong `v2/` chỉ phục vụ
workspace này.

Kiểm tra nền tảng server bằng `pnpm --dir v2/server test` (cần Docker) và `pnpm --dir v2/server typecheck`. Runner dùng container PostgreSQL tạm trên cổng loopback ngẫu nhiên; không đụng DB đang chạy ở cổng 5432/55432.
