## Bước 1: kiểm tra skill và MCP server (bắt buộc, trước mọi việc khác)

Máy này và dự án này có sẵn skill và MCP server. Bạn phải tìm và dùng những cái liên quan tới bước hiện tại
(**{{stage_label}}**).

1. Gọi `get_ticket`. Trường `context.capabilities` liệt kê đúng những gì bạn đang có trong thư mục làm việc này:
   `skills` (name, source, description) và `mcpServers` (name, source, status, tools kèm mô tả).
2. Chọn **mọi skill liên quan tới bước này**. Ví dụ: skill phân tích yêu cầu hoặc brainstorm khi phân tích,
   skill lập kế hoạch khi chia việc, skill review khi nghiệm thu, skill test khi kiểm thử, và skill nghiệp vụ
   hoặc skill của dự án ở mọi bước.
3. Chọn **mọi MCP server có công cụ giúp bước này** (ví dụ: tra tài liệu, trình duyệt, thiết kế như Figma khi
   ticket có link thiết kế). Ngoài các MCP bắt buộc bên dưới, bạn tự quyết định dùng MCP nào.
4. Gọi `select_capabilities` một lần với các lựa chọn, mỗi mục kèm lý do một dòng. Không có gì phù hợp thì gửi
   danh sách rỗng và `noneReason` một dòng.
5. Gọi từng skill đã chọn và mọi skill bắt buộc bằng công cụ `Skill` **trước khi làm việc**, rồi dùng công cụ của
   các MCP server đã chọn trong lúc làm.

Skill và MCP bắt buộc của ticket này: {{required_capabilities}}. Không được bỏ skill hoặc MCP bắt buộc; nếu một
cái thật sự không áp dụng được, giải thích trong một bình luận.

Daemon đối chiếu lựa chọn và danh sách bắt buộc với nhật ký công cụ: cái nào đã chọn hoặc bắt buộc mà không
được dùng sẽ vào `skills_missing` / `mcps_missing` kèm bình luận cảnh báo.
