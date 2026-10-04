# Onboarding owner trên web Crew v2

## Mục đích

Flow này cho owner đã đăng nhập tự dựng môi trường làm việc từ trình duyệt: đăng ký một máy, tạo dự án và gắn thư mục checkout của dự án vào máy đó. Chỉ dùng các API đã nghiệm thu của server (`POST /v2/machines`, `POST /v2/projects`, `PUT /v2/projects/:id/binding`), không phụ thuộc gate G3/G4. Công tắc nguồn model, model pool, cài workflow và telemetry máy thuộc phần Task 7 sau, chưa có ở đây.

## Điểm vào

- `web/src/machines/onboarding.tsx` → `MachineOnboarding`: trang “Đăng ký máy” tại `/crew-v2/machines` (mục “Máy” ở thanh bên).
- `web/src/projects/setup.tsx` → `ProjectSetup`: trang “Tạo dự án và gắn máy” tại `/crew-v2/setup/projects` (mục “Tạo dự án/Gắn máy” ở nhóm Dự án).
- `web/src/machines/onboarding-state.ts`: luật nhập tên máy, truy vấn danh sách máy, `submitIntent` (một khóa cho mỗi intent) và các thông báo lỗi tiếng Việt dùng chung cho hai trang.
- `web/src/projects/setup-state.ts`: luật nhập mã dự án, tên, URL repository và đường dẫn checkout, khớp `projects/routes.ts` và `projects/service.ts` của server.

## Các bước

1. **Đăng ký máy.** Owner nhập tên (1–200 ký tự sau khi bỏ khoảng trắng hai đầu). Trang gửi `POST /v2/machines` `{ name }` qua `PendingOperation` với intent cố định `machine:create`. Kết quả `{ machine, token }` được giải mã và đặt vào state của component. Token không vào query cache, `PendingStore`, `sessionStorage`/`localStorage` hay log. Panel “Token máy vừa đăng ký” có nút “Sao chép token” và “Đã lưu token, đóng”; token bị xóa khi đóng, khi component unmount, khi phiên hết hạn hoặc đăng xuất và khi tab ẩn (`pagehide`). Sau khi token đã mất thì không xem lại được.
2. **Mất phản hồi khi đăng ký.** Yêu cầu chưa xác nhận giữ nguyên khóa và nội dung; ô tên khóa lại và nút đổi thành “Gửi lại đúng yêu cầu cũ”, gửi đúng khóa và byte cũ nên không đăng ký máy thứ hai (server phát lại kết quả cũ). Sau khi tải lại tab, yêu cầu còn trong tab storage được xử lý giống vậy. Nếu chỉ còn tombstone (đăng xuất giữa chừng), nhập lại tên rồi gửi sẽ dùng lại khóa cũ.
3. **Danh sách máy.** `machinesQueryOptions` đọc hết các trang `GET /v2/machines` (key `queryKeys.machines()`), hiện tên, “Đang dùng/Đã thu hồi” và tám ký tự đầu của ID. Trạng thái online/telemetry chưa hiện vì chờ producer G4.
4. **Tạo dự án.** Mã khớp `^[A-Z][A-Z0-9_-]{1,31}$`, tên 1–200 ký tự, URL repository để trống (null) hoặc HTTPS/SSH có tên máy chủ và không chứa tài khoản/mật khẩu. Gửi `POST /v2/projects` `{ key, name, repositoryUrl }`, intent `project:create`. `409 PROJECT_KEY_CONFLICT` giữ nguyên các trường đã nhập và khóa được nhả để gửi lại với mã khác bằng khóa mới.
5. **Gắn hoặc đổi máy.** Mỗi dự án có một khối “Gắn máy cho dự án …” hiện máy đang gắn, đường dẫn và `bindingRevision` thật đọc từ `GET /v2/projects`. Owner chọn máy chưa thu hồi và nhập đường dẫn POSIX tuyệt đối trên máy dự án (text, bắt đầu bằng `/`, tối đa 4096 ký tự, không NUL); `C:\`, UNC và đường dẫn tương đối bị từ chối ở client với lý do bằng tiếng Việt, vì server kiểm theo luật POSIX. Gửi `PUT /v2/projects/:id/binding` `{ machineId, checkoutPath, expectedRevision }` với `expectedRevision` là revision đang hiển thị, intent `project-bind:<projectId>`. Sau mỗi lần gửi trang đọc lại danh sách dự án.
6. **Xung đột.** `409 REVISION_CONFLICT` (tab khác đã đổi) hiện lý do, giữ máy và đường dẫn đã nhập, tải lại revision mới; khóa cũ đã bị từ chối nên bấm lại sẽ gửi revision mới bằng khóa mới. `409 ACTIVE_EXECUTION` (còn attempt `active`, `uncertain` hoặc `finalizing`) hiện lý do cần đối chiếu tác vụ ở trang ticket, giữ các trường, không đổi binding và giao diện không tự tạm dừng, hủy hay kết thúc tác vụ. Yêu cầu chưa xác nhận được giữ khóa cũ và gửi lại đúng byte. Trường nhập được chốt lúc gửi, nên 409 không làm trường đổi theo giá trị server mới (giá trị mới chỉ hiện ở dòng trạng thái). Lỗi 400 của server hiện đúng lý do server trả.
7. **Lối thoát khi yêu cầu treo.** Cả ba form có nút “Bỏ yêu cầu cũ” khi đang giữ một yêu cầu chưa xác nhận (kể cả khi gửi lại bị 409). Owner phải xác nhận cảnh báo có thể tạo bản trùng (với gắn máy: áp dụng lại trên revision mới). Sau đó yêu cầu cũ bị bỏ bằng `PendingStore.reject`, các trường được giữ, danh sách dự án được đọc lại để lấy revision mới, và lần gửi kế tiếp dùng khóa mới. Phản hồi 2xx sai định dạng khi đăng ký máy báo rõ máy đã được đăng ký nhưng không hiển thị được token, nên đăng ký một máy mới với tên khác (giới hạn: `OwnerClient` đã xác nhận yêu cầu trước khi giải mã; thu hồi máy chưa có ở server/web). “Bỏ yêu cầu cũ” cũng hiện khi chỉ còn tombstone (payload gốc đã mất sau đăng xuất) và lần nhập lại bị `IDEMPOTENCY_CONFLICT`. Submit trực tiếp bị chặn khi panel token còn mở. Không đăng ký máy mới khi panel token còn mở.
8. **Trạng thái trống.** Chưa có máy: trang dự án hướng dẫn mở “Đăng ký máy” và nút gắn bị khóa. Chưa có dự án: hướng dẫn tạo dự án trước. Owner chưa khởi tạo được báo ngay ở màn hình đăng nhập; trang không tự lấy ID fixture hay token v1.

## Dữ liệu

DTO `Machine`, `ProvisionedMachine` và `Project` lấy từ `web/src/contracts/machines.ts`. Dữ liệu duy nhất trong query cache là danh sách máy và danh sách dự án, không có credential. Tab storage chỉ giữ `PendingOperation` của `machine:create`, `project:create` và `project-bind:*` (nội dung không chứa bí mật). Bản nháp chưa gửi nằm trong state component, nên mất khi đóng trang nhưng trường đã nhập vẫn còn sau lỗi.

## Flow liên quan

`web-data.md` sở hữu `OwnerClient`, `PendingOperation`, query key và đồng bộ sự kiện (`project.bound`/`project.created` làm mới danh sách). `web-shell.md` sở hữu router và thanh bên mount hai trang này. Phía server: `server-platform.md` (đăng ký máy, `auth/routes.ts`) và flow dự án/thực thi (`projects/service.ts` `bindProject`, `execution/attempts.ts` `assertNoActiveProjectExecution`).

## Tests

- `web/test/onboarding.test.ts` (jsdom + RTL, fake server theo route): luật nhập; đăng ký máy gửi một POST có khóa, token không nằm trong storage, query cache hay pending và biến mất khi đóng hoặc hết phiên; mất phản hồi rồi gửi lại đúng khóa/byte không tạo máy thứ hai; mã dự án trùng giữ trường rồi gửi khóa mới; gắn máy gửi revision thật và bỏ máy đã thu hồi; hai tab 409 giữ trường rồi áp dụng lại bằng khóa mới; `ACTIVE_EXECUTION` giữ trường, không gọi route dừng; trạng thái trống; replay giữ khóa cho dự án và gắn máy, lối thoát “Bỏ yêu cầu cũ” sau 409, tombstone dùng lại khóa, trường giữ khi 409 không sửa gì, đường dẫn Windows/UNC, 400 hiện lý do, phản hồi 2xx sai định dạng.
- `web/e2e/onboarding.spec.ts` (API/PostgreSQL/Vite thật): đăng nhập bằng UI, đăng ký máy, tạo dự án, gắn checkout, tải lại giữ đúng máy/đường dẫn/revision và không có token hay mật khẩu trong storage, IndexedDB, CacheStorage, cookie, console và DOM; hai tab với route chỉ làm chậm GET để tab thứ hai thật sự cũ nhận 409 rồi áp dụng lại; mỗi test tự dựng dữ liệu nên chạy độc lập; attempt `uncertain` và `active` ghi vào DB fixture làm rebind 409 `ACTIVE_EXECUTION` và binding trong DB không đổi.
