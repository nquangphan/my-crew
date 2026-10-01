# Kiến trúc Crew v2: thư viện miền

## Thành phần

`v2/` là package TypeScript độc lập. Các module trong `src/` cung cấp hàm thuần để đánh giá quy tắc miền;
`test/` chạy trực tiếp bằng `node:test`. Thư viện không import ứng dụng Crew v1 và không dùng dependency runtime.

## Ranh giới xử lý

Thư viện trả về quyết định dựa trên dữ liệu đầu vào. Server ở các phần sau chịu trách nhiệm xác thực request,
giao dịch cơ sở dữ liệu, lease, lưu trạng thái và điều phối công việc. Thư viện không mô phỏng các trách nhiệm đó
bằng trạng thái trong bộ nhớ.

## Dữ liệu và dịch vụ ngoài

Phần này không có bảng dữ liệu, credential, lời gọi mạng hoặc dịch vụ ngoài. Khi chạy, Node.js dùng type
stripping; TypeScript chỉ kiểm tra kiểu và không phát sinh mã JavaScript.

## Kiểm tra

Từ gốc repo, chạy `pnpm --dir v2 test` và `pnpm --dir v2 typecheck`. Lockfile trong `v2/` chỉ phục vụ
workspace này.
