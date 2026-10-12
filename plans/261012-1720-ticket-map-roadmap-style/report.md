# Bản đồ Crew ở chi tiết ticket vẽ như Roadmap

- Ngày 12/10/2026, giờ Asia/Ho_Chi_Minh. Agent làm, Trợ Lý ghi lại vì agent không được ghi file báo cáo.
- Kết quả: DONE_WITH_CONCERNS. Commit `6a274564b` (feat) và `a1660e3ac` (e2e) trên `crew/project-access`.

## Làm gì
- `crew-map.tsx` viết lại trên canvas, thẻ, cạnh, chú thích, chuyển động của Roadmap. `crew-map-flow.tsx` đã xóa.
  `crew-map-level.ts` mới chuyển dữ liệu bản đồ Crew sang dạng Roadmap.
- Cạnh phụ thuộc: nét đứt có mũi tên. Vòng sửa: nét chấm màu "đang duyệt". Chú thích thêm "Vòng sửa", "Việc đang xem".
- Việc đang xem có viền đậm, camera canh vào nó. Bấm thẻ mở issue như cũ.
- Thông tin không hiện trên thẻ thì nằm ở tooltip và nhãn đọc màn hình.
- Không còn lưu viewport vào localStorage.

## Bố cục
- `spread-tree` riêng cho bản đồ Crew: góc tỏa như Roadmap, mỗi tầng trên elip dẹt ngang, nới dần tới khi không chồng thẻ.
- 3 đến 6 việc con vừa khung ở độ phóng ≥ 1. Cây lớn hơn vẫn tỏa tròn; camera không thu dưới 1, nút ⤢ để xem cả cây.
- Roadmap không đổi: phần thêm vào widget dùng chung là tùy chọn; test Roadmap không sửa dòng nào.

## Kiểm
| Lệnh | Kết quả |
|---|---|
| tsc (src, e2e) | sạch |
| biome | sạch |
| vitest crew-web toàn gói | 1361 đạt |
| vite build | đạt |
| e2e T1 `PW-S6-MAP`, `PW-S22` | 4/4 |

## Chưa kiểm / lưu ý
- Cạnh phụ thuộc và vòng sửa trong ảnh là dữ liệu chèn trong trình duyệt; T1 không có dữ liệu thật loại này.
- Trên phone, ô bình luận dính đáy che phần dưới bản đồ (lỗi có từ trước).
