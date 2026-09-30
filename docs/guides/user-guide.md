# Hướng dẫn sử dụng

Hướng dẫn này dành cho **chủ dự án** (owner) dùng 2P Crew qua giao diện web — không cần biết code. Mỗi mục nêu
màn hình cần mở và thao tác cần bấm để hoàn thành một việc. Muốn hiểu một yêu cầu đi qua những bước nào từ lúc
tạo tới lúc code được merge, xem [Quy trình ticket](workflow.md).

## Khái niệm

- **Chủ dự án (owner)**: người dùng con người duy nhất của hệ thống, đăng nhập bằng mật khẩu.
- **Dự án (project)**: một repo, có `key` riêng (ví dụ `CREW2PS`), ngân sách và giới hạn ticket con riêng.
- **Máy (machine)**: một máy tính cục bộ chạy daemon `crewd` (hoặc app desktop), ghép vào hệ thống bằng mã
  pairing, sở hữu một hoặc nhiều dự án.
- **Trợ lý (assistant)**: vai trò agent nhận và định tuyến mọi ticket loại `request` (yêu cầu gốc chủ dự án
  tạo) tới đúng dự án; mỗi thời điểm chỉ một máy giữ vai trò này.
- **PM, dev, QC**: ba vai trò agent còn lại — PM phân tích yêu cầu và chia việc, dev viết code, QC kiểm thử.
  Chi tiết vai trò và giới hạn từng vai trò xem ở [Quy trình ticket](workflow.md).
- **Ticket**: đơn vị công việc, có 6 loại (`request`, `pm_task`, `dev`, `qc`, `bug`, `docs_init`), 8 trạng thái
  và 4 mức ưu tiên (`urgent`/`high`/`medium`/`low`) — bảng đầy đủ ở [Quy trình ticket](workflow.md).

## Đăng nhập và đổi mật khẩu

- Trang `/login` ("Đăng nhập"): nhập tên đăng nhập và mật khẩu, một bước.
- Trang `/account` ("Tài khoản"): đổi mật khẩu — nhập "Mật khẩu hiện tại", "Mật khẩu mới" (gợi ý: "Ít nhất 12
  ký tự, khác mật khẩu hiện tại.") và "Nhập lại mật khẩu mới". Đổi thành công hiện thông báo "Đã đổi mật khẩu.
  Các phiên đăng nhập khác đã bị đăng xuất." — mọi thiết bị khác đang đăng nhập bị đăng xuất ngay, chỉ thiết bị
  vừa đổi còn phiên hoạt động.

## Dự án

- Tạo hoặc sửa dự án tại trang "Dự án" (`/projects`) hoặc, khi đã chọn một dự án trong sidebar, tại "Cài đặt
  project" (`/projects/$projectKey/settings`) — cùng một form.
- Các trường chính: "Key", "Tên", "Mô tả" (gợi ý: "Trợ lý chỉ dùng mô tả này để chọn dự án cho request. Không
  lấy từ repo."), "Repo", "Nhánh mặc định", "Nền tảng" (gợi ý: "Quyết định MCP test UI của QC."), "MCP
  Playwright", "MCP Maestro".
- Ngân sách và giới hạn ticket con: "Tối đa ticket con" (số subtask tối đa mỗi ticket cha), "Ngân sách mỗi PM
  task ($)" và "Ngân sách mỗi ngày ($)" (cả hai có gợi ý "Để trống: không giới hạn."). Vượt một trong hai ngân
  sách này sẽ tạm dừng cả cây `pm_task` đó — xem mục "Khi ticket bị chặn hoặc hết ngân sách" bên dưới.

## Máy

- **Ghép máy mới**: trang "Máy" (`/machines`) → nút "Ghép máy mới" mở hộp thoại tạo mã pairing một lần (kèm
  đếm ngược); nhập mã đó vào app desktop hoặc CLI `crewd pair` trên máy cần ghép. Xem
  [Cài đặt máy local (daemon)](../flows/daemon-setup.md) để biết cách cài app hoặc CLI từ đầu.
- **Giao dự án cho máy**: hộp thoại chuyển máy (mở từ trang Dự án hoặc trang Máy) — máy chưa giữ dự án nào
  khác thì nhận ngay; máy khác đang giữ thì tạo yêu cầu chờ duyệt.
- **Vai trò máy trợ lý**: trang Máy → nút "Đặt làm máy trợ lý" (hoặc "Thu hồi" để gỡ) trên thẻ máy; mỗi thời
  điểm chỉ một máy giữ vai trò này.
- **Duyệt yêu cầu nhận dự án**: khi một máy khác xin nhận một dự án hoặc vai trò trợ lý đang có chủ, yêu cầu đó
  vào trang "Inbox" (`/inbox`) — bấm duyệt hoặc từ chối bằng một cú nhấp trong hộp thoại xác nhận.

## Tạo yêu cầu

- Hộp thoại tạo ticket (mở từ phím tắt hoặc nút tạo trên board/danh sách): chọn dự án gợi ý, mức ưu tiên, viết
  mô tả markdown, có thể bật "Cho phép sửa config" và "Tạo thêm" để tạo liên tiếp nhiều ticket; ticket luôn
  được giao cho trợ lý xử lý trước.
- **Dán ảnh**: dán ảnh từ clipboard trực tiếp vào ô mô tả ticket hoặc ô bình luận — ảnh được tải lên ngay tại
  vị trí con trỏ (hiện placeholder "Đang tải ảnh..." rồi thay bằng ảnh thật). Chỉ nhận định dạng PNG/JPEG/GIF/
  WebP và tối đa 10MB; ảnh sai định dạng hoặc quá lớn báo lỗi ngay ("Ảnh vượt quá giới hạn 10MB, hãy chọn ảnh
  nhỏ hơn." khi vượt kích thước), không tải lên và không mất nội dung đang soạn.

## Theo dõi

- **Board** (`/projects/$projectKey/board` cho một dự án, `/board` "Tất cả dự án" cho mọi dự án): xem ticket
  theo cột trạng thái, kéo-thả để chuyển trạng thái.
- **Danh sách** (`/projects/$projectKey/list` cho một dự án, `/list` cho "Tất cả dự án"): bảng ticket có lọc,
  sắp xếp, sửa trạng thái/ưu tiên tại chỗ và thao tác hàng loạt.
- **Chi tiết ticket** (`/tickets/$ticketKey`): tiêu đề, mô tả, cây subtask dev↔QC, bình luận, dòng sự kiện,
  report, nút chuyển trạng thái.
- **"Tất cả request của tôi"** (`/requests`): mọi ticket loại `request` chủ dự án đã tạo, trên một board riêng.
- **Lọc theo dự án**: menu "Dự án" trên board, danh sách, Inbox và trang Máy — chọn nhiều dự án cùng lúc, lưu
  trong URL để chia sẻ hoặc bookmark.
- **Tìm kiếm nhanh**: ô tìm kiếm trên thanh điều hướng — tìm ticket theo key/tiêu đề và cả trang docs.

## Trả lời câu hỏi của PM

- Ticket đang chờ trả lời (trạng thái "Chờ bạn") hiện banner vàng trên trang chi tiết — bấm nút "Trả lời" để
  focus ngay vào ô soạn bình luận.
- Gõ `@pm` trong ô bình luận của bất kỳ ticket nào thuộc cây `pm_task` (kể cả ticket con đã đóng) để gọi thẳng
  PM của cây đó thay vì agent của chính ticket đang xem — gõ `@` sẽ hiện gợi ý "@pm — gọi PM của cây ticket
  (thay cho agent của ticket này)", Enter/Tab hoặc click để chèn. Bình luận này chỉ đánh thức PM, không tự mở
  chặn một ticket đang "Bị chặn".

## Inbox và các yêu cầu cần duyệt

Trang "Inbox" (`/inbox`) gộp mọi việc cần chủ dự án xử lý: yêu cầu chuyển máy, yêu cầu đổi loại dự án của máy
đang giữ, ticket đang chờ trả lời, máy offline hoặc lỗi sức khỏe, dự án chưa có máy — cộng nhật ký thông báo
(chuông, số chưa đọc). Có thể lọc theo dự án và đánh dấu đã đọc từng thông báo hoặc tất cả.

## Trang Tài liệu

- Trang chủ docs (`/docs`, "Tài liệu · Tất cả dự án"): liệt kê trạng thái docs của mọi dự án, tìm kiếm xuyên
  dự án.
- Không gian docs từng dự án (`/projects/$projectKey/docs`): cây trang, mục lục, tìm kiếm trong dự án.
- Ticket và trang flow liên kết hai chiều: ticket hiện "Docs liên quan" dẫn tới trang flow, trang flow hiện
  danh sách ticket đang dùng nó.

## Cài đặt hệ thống

Trang "Cài đặt hệ thống" (`/settings/prompts`, sidebar mục "Cài đặt hệ thống") gồm 5 tab — Prompts, Quy tắc,
Models, Máy, Dự án — để sửa prompt từng vai trò agent, quy tắc guard/QC, bảng model theo độ phức tạp, tài
nguyên mỗi máy và MCP server tắt theo dự án. Xem chi tiết ở
[Cài đặt hệ thống trên server](../flows/server-settings.md).

## Điều khiển máy từ web

Nút "Điều khiển" trên mỗi thẻ máy ở trang Máy mở khung điều khiển: tạm dừng/cho chạy tiếp, kiểm tra sức khỏe và
áp fix, dò lại skill/MCP, xem job gần đây và log, gỡ dự án hoặc vai trò trợ lý khỏi máy — không cần SSH vào
máy. Xem chi tiết ở [Điều khiển máy từ web](../flows/machine-control.md).

## Khi ticket bị chặn hoặc hết ngân sách

- **Ticket "Bị chặn"**: bình luận bất kỳ (không tag `@pm`) trên ticket đó sẽ tự mở chặn nó về "Đang làm"; có
  thể bình luận giải thích hướng xử lý trước khi mở chặn.
- **Hết ngân sách** (cây `pm_task` chuyển sang "Chờ bạn"): bình luận, hoặc tự chuyển trạng thái từ "Chờ bạn"
  sang "Đang làm", để gỡ tạm dừng cho toàn bộ cây `pm_task` đó — cần tăng hạn mức thì sửa "Ngân sách mỗi PM
  task ($)"/"Ngân sách mỗi ngày ($)" ở Cài đặt project trước.

Muốn hiểu vì sao một ticket đi tới các trạng thái này, xem [Quy trình ticket](workflow.md).
