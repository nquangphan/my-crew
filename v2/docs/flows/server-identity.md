# Đăng nhập owner, cấp máy và gắn project

## Mục đích

Flow này xác thực một owner đã bootstrap, cấp token mới cho máy macOS và gắn mỗi project với đúng một máy. Máy v1 và credential v1 không được nhập lại. Mọi project mới ở trạng thái chưa gắn máy; việc gắn lại bị chặn theo mặc định cho đến khi có guard đối chiếu tác vụ đang chạy ở phần sau.

## Điểm vào

- `server/src/auth/bootstrap.ts` → `bootstrapOwner`: tạo duy nhất owner từ mật khẩu stdin.
- `server/src/auth/routes.ts` → `registerAuthRoutes`, `createAuthenticator`: route phiên, cấp máy và xác thực request.
- `server/src/projects/routes.ts` → `registerProjectRoutes`: route tạo, đọc và gắn project.
- `server/src/projects/service.ts` → `createProject`, `bindProject`, `projectEventScope`: nghiệp vụ và phạm vi event.

## Các bước

1. `server/src/auth/bootstrap.ts` → `bootstrapOwner`: băm mật khẩu bằng `scrypt` với salt ngẫu nhiên rồi ghi trong transaction có advisory lock. CLI chỉ nhận mật khẩu từ stdin và từ chối lần bootstrap thứ hai.
2. `server/src/auth/routes.ts` → `registerAuthRoutes`: `POST /v2/auth/session` kiểm tra Origin và mật khẩu, giới hạn năm lần sai mỗi năm phút theo IP đã băm; tạo session 12 giờ với cookie `HttpOnly`, `SameSite=Strict`, `Secure` ở môi trường HTTPS. `GET` trả owner và CSRF; `DELETE` cần Origin cùng CSRF rồi thu hồi session.
3. `server/src/auth/session.ts` → `createSession`, `credentialResponseCodec`: chỉ lưu SHA-256 của session và CSRF; CSRF dùng AES-256-GCM để đọc lại cho phiên hợp lệ. Response cấp máy được mã hóa AES-256-GCM theo phạm vi actor, route và idempotency key trước khi journal lưu để owner cùng phiên có thể replay token mà DB không chứa token gốc.
4. `server/src/auth/machine.ts` → `provisionMachine`: tạo UUID và token 32 byte ngẫu nhiên, lưu hash, phát `machine.provisioned` chỉ có machineId. Route máy chỉ trả metadata khi đọc danh sách; máy đã bị thu hồi không xác thực được.
5. `server/src/projects/service.ts` → `createProject`: kiểm tra key, tên, URL HTTPS/SSH không có userinfo; tạo project chưa gắn máy và phát `project.created` chỉ có revision.
6. `server/src/projects/service.ts` → `bindProject`: khóa dòng project, kiểm tra revision và máy còn hiệu lực, gọi guard trong cùng transaction nếu project đã gắn máy, cập nhật một machineId/checkoutPath, xóa commit checkout cũ và tăng bindingRevision; phát `project.bound` chỉ có machineId và bindingRevision. Chữ ký ba tham số mặc định từ chối gắn lại; tham số guard thứ tư tùy chọn cho Task5 kiểm tra attempt `active`, `uncertain`, `finalizing` sau khi các bảng đó có mặt.
7. `server/src/projects/service.ts` → `projectEventScope`: nhận `Db | Tx` để journal đọc binding và event trong cùng transaction snapshot; máy chỉ đọc sự kiện của project gắn với máy tại snapshot đó, owner đọc toàn bộ. Danh sách project dùng ID cursor, tối đa 100 mục/trang.

## Files

| Đường dẫn từ `v2/` | Vai trò |
|---|---|
| `server/migrations/003_identity.sql` | Owner, session, machine, project và liên kết legacy ID |
| `server/src/auth/password.ts` | `scrypt` và so sánh hash có thời gian cố định |
| `server/src/auth/session.ts` | Cookie, CSRF, mã hóa kết quả replay |
| `server/src/auth/machine.ts` | Cấp máy và event metadata |
| `server/src/auth/bootstrap.ts` | Bootstrap owner bằng stdin |
| `server/src/auth/routes.ts` | Route auth/machine và kiểm tra quyền |
| `server/src/projects/service.ts` | Project, binding và phạm vi event |
| `server/src/projects/routes.ts` | Route project với schema cấm trường dư |
| `server/test/support/identity-app.ts` | Fastify fixture với DB riêng, cookie và CSRF thật |
| `server/test/auth.test.ts`, `server/test/projects.test.ts` | Kiểm thử hành vi auth và binding |

## Dữ liệu

DB lưu password salt/hash, hash của session/token/CSRF và ciphertext của CSRF/idempotent machine response. Token gốc chỉ có ở phản hồi cấp máy cho owner đã xác thực; không có trong event hoặc backup DB. `projects.machine_id` và `checkout_path` cùng null hoặc cùng có giá trị; bản nhập docs cũ có thể giữ project ở trạng thái chưa gắn. `docsState` hiện là `missing` cho project mới; flow docs nhập liệu cập nhật trạng thái khi có snapshot.

## Flow liên quan

`server-platform` cấp PostgreSQL và fixture test riêng. `server-journal` giữ mutation, event và replay. Flow execution phần tiếp theo sẽ cung cấp guard đối chiếu attempt trước khi cho phép đổi binding.

## Tests

`pnpm --dir v2/server test --test-name-pattern='auth|provision|binding|project'` kiểm tra quyền owner/machine, CSRF/Origin, throttle, session qua app restart, hết hạn và logout, credential không có trong `pg_dump`, replay idempotent mã hóa, giới hạn input, phân trang và binding đồng thời. `pnpm --dir v2/server typecheck` và Biome kiểm tra kiểu/định dạng cho source, test của flow.
