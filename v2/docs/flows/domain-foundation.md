# Hợp đồng miền Crew v2

## Mục đích

Giữ các quy tắc miền của Crew v2 trong một package độc lập để server và host dùng cùng một kết quả quyết định.

## Điểm vào

Chưa có điểm vào runtime trong phần khởi tạo. Các phần tiếp theo sẽ thêm hàm xuất từ `src/`.

## Các bước

1. `test/workspace.test.ts` → `workspace v2 không có dependency ứng dụng v1`: đọc manifest package và kiểm tra tên, dependency runtime.
2. `package.json` → `test`, `typecheck`: chạy kiểm thử Node và kiểm tra kiểu TypeScript riêng cho `v2/`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `package.json` | Cấu hình package và lệnh kiểm tra | `test`, `typecheck` |
| `tsconfig.json` | Bật strict types, type stripping tương thích và không phát sinh mã | `compilerOptions` |
| `test/workspace.test.ts` | Kiểm tra tính độc lập của workspace | `workspace v2 không có dependency ứng dụng v1` |

## Dữ liệu

Không có cơ sở dữ liệu, sự kiện hoặc lời gọi ra ngoài trong phần khởi tạo.

## Flow liên quan

Các quy tắc model, workflow, ticket và hoàn tất sẽ được thêm vào flow này ở những phần tiếp theo. Server xử lý giao dịch và lease ngoài thư viện.

## Tests

`test/workspace.test.ts` kiểm tra package đúng tên và không khai báo dependency runtime.
