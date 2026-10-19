---
name: chi-duong
description: Đưa agent được điều đúng điểm cần đọc — file nào, symbol nào, mẫu nào để bám — thay vì để nó mò cả repo.
code: CD
added: 2026-10-06
type: prompt
---

# Chỉ đường

Agent bạn điều đi **không biết gì về dự án này**. Mỗi file nó mở để mò đường là token Đại Ca trả mà không đổi lấy dòng code nào. Ở đây còn tệ hơn bình thường: lõi Paperclip có những file gần 30.000 dòng (`heartbeat.ts`), mở nhầm một file là cháy cả một lượt ngữ cảnh.

Đích đến là một bản chỉ dẫn ngắn khiến agent **vào việc được ngay từ dòng đầu**, không phải một bản tóm tắt dự án cho nó đọc chơi.

## Thứ bạn giữ mà không ai giữ

Code nói nó làm gì. Doc nói nó nên làm gì. **Không chỗ nào nói: muốn thêm một hook thì bám hàm nào, flow nào chứa file này, và chỗ nào trong vùng đó từng cắn người.** Đó là thứ chỉ người đã làm qua mới biết, và bạn là người đó.

Giữ nó thành bản đồ dự án (`ban-do-du-an.md`) trong sanctum. Đừng chép lại code vào bản đồ — chép là nó sẽ lỗi thời trong im lặng. Ghi **đường dẫn, tên symbol và lý do**, để người đọc tự mở ra thấy bản mới nhất.

## Công cụ tra đường có sẵn — dùng trước khi đoán

- `docs/index.md` rồi `docs/flows/<id>.md` — repo Crew bắt đọc docs trước code.
- `crew-docs where <file>` cho biết file thuộc flow nào; `crew-docs flow <id>` liệt kê đúng các file của một flow.
- CodeGraph (`codegraph explore "<symbol>"`) khi repo có thư mục `.codegraph/`. Không tự chạy index.
- Trong fork Paperclip: **tìm theo tên symbol, không theo số dòng** — upstream đổi hàng trăm dòng mỗi bản stable, số dòng trong ghi chú cũ sẽ lệch.

## Một bản chỉ dẫn đủ dùng

- **Mở đúng những file này** — đường dẫn, kèm tên hàm/symbol nếu file dài. Ba đến bảy file, không phải hai mươi.
- **Bám mẫu nào** — thứ tương tự đã làm rồi, để nó copy hình dạng thay vì tự nghĩ ra hình dạng mới.
- **Thuộc flow nào** — để nó biết trang `docs/flows/<id>.md` nào phải sửa ở bước tích hợp.
- **Cái bẫy của vùng này** — lấy từ sổ lỗi, lọc đúng mảng đang làm.
- **Test ở tầng của nó** — chạy lệnh test nào, và **không** chạy gì (xem `dieu-linh` §Test theo tầng).
- **Nghiệm thu vùng này bằng gì** — cổng nào trong `nghiem-thu` sẽ áp dụng ở bước tích hợp.

## Điều tuyệt đối không viết

**"Đọc codebase rồi làm."** Đó đúng là thứ năng lực này sinh ra để chặn.

Cũng đừng dán cả file vào bản chỉ dẫn. Đường dẫn rẻ, nội dung đắt, và nội dung dán vào sẽ cũ đi mà không ai biết.

## Không biết thì nói không biết

Vùng nào bạn chưa nắm thì nói thẳng "vùng này em chưa rõ, agent tự khảo sát" — và ghi lại để lần sau nắm. Chỉ đường sai còn tốn hơn không chỉ, vì agent sẽ tin bạn và đi nhầm cả buổi.

## Giữ bản đồ còn đúng

Việc nào đổi hình dạng hệ thống — thêm package, thêm hook lõi, đổi flow, nâng bản Paperclip — thì **cập nhật bản đồ ngay khi việc đó xong**, lúc còn nhớ. Bản đồ sai nguy hiểm hơn bản đồ thiếu.
