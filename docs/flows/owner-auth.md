# Đăng nhập chủ dự án

> Flow `owner-auth`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow owner-auth` in ra
> đúng danh sách đó.

## Mục đích

Xác thực owner (chủ dự án, người dùng con người duy nhất của hệ thống) bằng mật khẩu, quản lý phiên đăng nhập
server-side và CSRF cho mọi route owner, cấp tài khoản owner ban đầu qua CLI, và cho phép owner tự đổi mật khẩu.

## Điểm vào

- `apps/api/src/routes/auth-routes.ts` — `POST /v1/auth/login`, `GET /v1/auth/session`,
  `POST /v1/auth/logout`, `POST /v1/auth/password`.
- `apps/web/src/routes/login.tsx` — trang `/login` trên web.
- `apps/web/src/routes/account.tsx` — trang `/account` ("Tài khoản") với form đổi mật khẩu.

## Các bước

1. `apps/web/src/routes/login.tsx` → `LoginForm`: một bước — gọi `api.login(username, password)`, lưu
   `csrfToken` trả về qua `setCsrfToken()` rồi `queryClient.setQueryData(keys.session, session)`.
2. `apps/api/src/routes/auth-routes.ts` → `POST /v1/auth/login`: kiểm tra Origin (`assertAllowedOrigin`),
   validate body bằng `LoginRequest`, gọi `login()`, huỷ session cookie cũ nếu có (`destroySession`), rồi
   `setSessionCookies()` với session mới.
3. `apps/api/src/auth/owner-auth.ts` → `checkPassword()`: so `verifyPassword()` (argon2id); nếu username
   không tồn tại vẫn chạy `verifyAgainstDummy()` để thời gian phản hồi không lộ việc username có tồn tại hay
   không — mật khẩu sai và username lạ trả về cùng một 401 "invalid username or password".
4. `apps/api/src/auth/owner-auth.ts` → `login()` gọi `issueSession()` (private) ngay sau khi mật khẩu đúng:
   tạo session mới (id ngẫu nhiên 32 byte, chỉ lưu hash SHA-256 vào bảng `sessions`), trả về
   `SessionResponse { owner: { username }, csrfToken }`.
5. `apps/api/src/auth/owner-auth.ts` → `ownerGuard()`: hook `onRequest` cho mọi route owner — đọc cookie
   `crew_session`, phân giải phiên còn hiệu lực (`resolveSession`, kiểm tra TTL tuyệt đối 7 ngày và TTL rảnh
   12h), và với method có side effect (`isMutating`) còn gọi `assertAllowedOrigin()` +
   `assertCsrfToken()` (từ `apps/api/src/auth/csrf.ts`) trước khi gán `request.ownerSession`.
6. `apps/api/src/auth/csrf.ts` → `assertCsrfToken()`: token double-submit ký theo session
   (`csrfTokenFor`), phải khớp cả header `CSRF_HEADER` lẫn cookie `crew_csrf`.
7. `apps/api/src/cli/seed-owner.ts` → `seedOwner()`: tạo (hoặc với `--reset` thay) tài khoản owner duy nhất —
   chỉ băm mật khẩu (argon2id); ghi rỗng vào các cột xác thực hai bước cũ (`totp_secret`, `totp_last_step`,
   `recovery_code_hashes` — không còn dùng, xem flow `api-platform`) để một secret hay mã cũ không còn sót
   lại, xoá session cũ khi reset; in đúng một dòng `Owner "<name>" saved. Existing sessions were signed out.`
   (không còn in secret hay mã khôi phục nào).
8. `apps/web/src/routes/account.tsx` → `ChangePasswordForm`: validate cục bộ trước khi gọi API — mật khẩu
   hiện tại bắt buộc, mật khẩu mới ≥ `MIN_PASSWORD_LENGTH` (12) và khác mật khẩu hiện tại, nhập lại phải khớp;
   sau đó gọi `api.changePassword()` (`quiet401: true` nên sai mật khẩu hiện tại không tự đăng xuất owner —
   khi gặp 401, form hiện "Mật khẩu hiện tại không đúng." rồi kiểm tra lại session và chỉ chuyển `/login` nếu
   phiên đã thật sự mất). Thành công: `setCsrfToken()` với token mới, `queryClient.setQueryData(keys.session,
   …)`, toast "Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị đăng xuất.", `router.invalidate()`.
9. `apps/api/src/routes/auth-routes.ts` → `POST /v1/auth/password`: đứng sau `ownerGuard` (session + Origin +
   CSRF) và dùng cùng giới hạn tần suất theo IP với đăng nhập (`loginRateLimitPerMinute`); validate
   `ChangePasswordRequest` (bỏ qua field lạ như `code` mà client cũ còn gửi; định nghĩa cùng
   `packages/shared/src/api-schemas.ts` với `Ticket`/`CreateSubtaskRequest`/`RateSubtaskRequest`/
   `RetrySubtaskRequest` của flow `ticket-lifecycle` — các schema ticket đó, kể cả `RateSubtaskRequest`/
   `RetrySubtaskRequest` mà PM dùng để đánh giá lại hay mở lại một subtask tại chỗ, `Comment.mentions` (tag
   `@pm` của owner), mã lỗi `PM_NOT_AVAILABLE`, `ListTicketsQuery.projectIds` (lọc nhiều dự án cho
   board/danh sách "Tất cả dự án"), `TicketTreeResponse` (cây hậu duệ của `GET /v1/tickets/:id/tree`) và
   `SearchQuery`/`DocsOverviewResponse`/`CrossDocsSearchQuery` (bộ lọc `projectIds` của tìm kiếm nhanh và
   trang chủ docs, flow `docs-sync-viewer`), không ảnh hưởng gì tới schema này; 400 khi mật khẩu mới quá ngắn
   hoặc trùng mật khẩu hiện tại), gọi `changeOwnerPassword()` rồi `setSessionCookies()` với session mới. Không
   dùng `Idempotency-Key` (route owner không dùng cơ chế này).
10. `apps/api/src/auth/owner-auth.ts` → `changeOwnerPassword()`: xác minh mật khẩu hiện tại trước; sai thì trả
    401 với thông điệp "invalid password". Sau đó `hashPassword()` (argon2id) và trong một transaction: chỉ
    cập nhật `owner.password_hash` nếu vẫn khớp hash vừa xác minh (đổi đồng thời → một bên thắng), xoá mọi
    session của owner, rồi gọi lại `issueSession()` (hàm dùng chung với `login()`) để cấp session mới. Kết
    quả: thiết bị đang đổi tiếp tục với session id và CSRF token mới; các thiết bị khác bị đăng xuất (stream
    SSE đang mở của chúng kết thúc ở lần kiểm tra heartbeat kế tiếp qua `sessionStillValid`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/auth-routes.ts` | Route đăng nhập/đăng xuất/đọc phiên/đổi mật khẩu | `authRoutes` |
| `apps/api/src/auth/owner-auth.ts` | Session, guard owner, đăng nhập, đổi mật khẩu | `login`, `checkPassword`, `ownerGuard`, `changeOwnerPassword`, `resolveSession`, `purgeExpiredSessions` |
| `apps/api/src/auth/csrf.ts` | CSRF double-submit + Origin allow-list | `assertCsrfToken`, `assertAllowedOrigin`, `csrfTokenFor` |
| `apps/api/src/auth/password.ts` | Băm/so mật khẩu argon2id (độ dài tối thiểu re-export từ `@crew/shared`) | `hashPassword`, `verifyPassword`, `verifyAgainstDummy` |
| `apps/api/src/cli/seed-owner.ts` | CLI tạo/reset tài khoản owner | `seedOwner` |
| `apps/web/src/routes/login.tsx` | UI đăng nhập một bước | `LoginForm`, `LoginPage` |
| `apps/web/src/routes/account.tsx` | UI đổi mật khẩu owner | `AccountPage`, `ChangePasswordForm` |

## Dữ liệu

- Bảng: `owner` (mật khẩu; `totp_secret`, `totp_last_step`, `recovery_code_hashes` vẫn còn cột nhưng không
  còn được đọc hay ghi bởi flow nào — xem flow `api-platform`; `password_hash` bị ghi đè khi đổi mật khẩu),
  `sessions` (chỉ lưu `id_hash`, `expires_at`, `last_seen_at`; toàn bộ dòng của owner bị xoá và thay bằng một
  dòng mới khi đổi mật khẩu).
- Sự kiện: không phát sự kiện realtime nào.
- Gọi ngoài: không.

## Flow liên quan

- api-platform: `ownerGuard` được gắn vào nhóm route owner trong `buildApp()`; cột TOTP/mã khôi phục cũ của
  bảng `owner` sống trong `apps/api/src/db/schema.ts` nhưng không flow nào còn dùng.
- machine-pairing: tạo mã pairing chỉ cần session owner đã đăng nhập cộng CSRF, không còn xác nhận lại bằng
  mã hai bước.
- web-shell: trang login là điểm vào duy nhất trước khi vào app shell; route guard của router chuyển hướng 401
  về `/login?redirect=…`; mục "Tài khoản" trong menu owner (`OwnerMenu`) dẫn tới `/account` để đổi mật khẩu.

## Tests

- `apps/api/test/auth.test.ts`: seed CLI không còn tạo hay in secret/mã khôi phục; đăng nhập một bước đặt
  cookie hardened đúng thuộc tính; mật khẩu sai và username lạ trả cùng 401 (dummy hash, không tạo session);
  field lạ (`code`) của client cũ bị bỏ qua; route `/v1/auth/login/totp` cũ trả 404; giới hạn tần suất đăng
  nhập theo IP; TTL rảnh/tuyệt đối của session; xoay session id khi đăng nhập lại.
- `apps/api/test/csrf.test.ts`: từ chối thiếu/sai Origin, thiếu/sai token CSRF trên method có side effect.
- `apps/api/test/password-change.test.ts`: đổi mật khẩu thành công rehash argon2id, xoay session của thiết bị
  đang đổi và đăng xuất mọi thiết bị khác; field lạ (`code`) của client cũ bị bỏ qua; sai mật khẩu hiện tại
  trả 401 chung mà vẫn giữ session; mật khẩu mới quá ngắn hoặc trùng mật khẩu hiện tại bị từ chối (400); thiếu
  session/Origin/CSRF; giới hạn tần suất tính cả lần sai như đăng nhập.
- `apps/web/src/routes/login.test.tsx`: đăng nhập một bước, không còn trường mã xác thực hay mã khôi phục,
  sai mật khẩu, giới hạn tần suất.
- `apps/web/src/routes/account.test.tsx`: validate cục bộ (độ dài, khác mật khẩu hiện tại, nhập lại khớp)
  không gọi API; đổi mật khẩu thành công lấy CSRF token mới và hiện toast; lỗi 401 hiện thông điệp chung mà
  vẫn giữ owner đăng nhập; chỉ hỏi mật khẩu hiện tại và mật khẩu mới hai lần, không có trường mã xác thực.
- `apps/web/e2e/account-password.spec.ts`: đổi mật khẩu tại `/account`, thiết bị khác bị đăng xuất ngay, đăng
  xuất thiết bị đang đổi, mật khẩu cũ bị từ chối khi đăng nhập lại, đăng nhập lại bằng mật khẩu mới; cuối bài
  khôi phục mật khẩu ban đầu qua API để các spec E2E khác vẫn đăng nhập được.
