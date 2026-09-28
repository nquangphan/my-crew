# Tổng quan

## Mục đích

<Dự án làm gì, cho ai.>

## Stack

- <ngôn ngữ, framework, cơ sở dữ liệu>

## Bản đồ module

| Thư mục | Vai trò |
|---------|---------|
| `<đường dẫn>` | <vai trò> |

## Danh sách flow

<!-- crew-docs:flows:start -->
<!-- crew-docs:flows:end -->

## Cách dùng docs

- `docs/architecture.md`: thành phần, nơi lưu dữ liệu, dịch vụ bên ngoài, cách triển khai.
- `docs/flows/<id>.md`: mỗi flow nghiệp vụ hoặc kỹ thuật có một trang.
- `docs/flows.yaml`: nguồn sự thật flow ↔ file, cho máy đọc.
- `docs/files.md`: tra ngược file → flow, sinh tự động bằng `crew-docs generate`.
