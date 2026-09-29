# Đăng nhập chủ dự án

> Flow `owner-auth`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow owner-auth` in ra
> đúng danh sách đó.

## Mục đích

Xác thực owner (chủ dự án, người dùng con người duy nhất của hệ thống) bằng mật khẩu cộng TOTP hai bước, quản
lý phiên đăng nhập server-side và CSRF cho mọi route owner, cấp tài khoản owner ban đầu qua CLI, và cho phép
owner tự đổi mật khẩu.

## Điểm vào

- `apps/api/src/routes/auth-routes.ts` — `POST /v1/auth/login`, `POST /v1/auth/login/totp`,
  `GET /v1/auth/session`, `POST /v1/auth/logout`, `POST /v1/auth/password`.
- `apps/web/src/routes/login.tsx` — trang `/login` trên web.
- `apps/web/src/routes/account.tsx` — trang `/account` ("Tài khoản") với form đổi mật khẩu.

## Các bước

1. `apps/web/src/routes/login.tsx` → `LoginForm`: bước 1 gọi `api.login(username, password)`; bước 2 gọi
   `api.loginTotp({challenge, code | recoveryCode})`, lưu `csrfToken` trả về qua `setCsrfToken()` rồi
   `queryClient.setQueryData(keys.session, session)`.
2. `apps/api/src/routes/auth-routes.ts` → `POST /v1/auth/login`: kiểm tra Origin
   (`assertAllowedOrigin`), validate body bằng `LoginPasswordRequest`, gọi `checkPassword()`, trả về
   `issueChallenge()`.
3. `apps/api/src/auth/owner-auth.ts` → `checkPassword()`: so `verifyPassword()` (argon2id); nếu username
   không tồn tại vẫn chạy `verifyAgainstDummy()` để thời gian phản hồi không lộ việc username có tồn tại hay
   không.
4. `apps/api/src/auth/owner-auth.ts` → `issueChallenge()`: ký HMAC-SHA256 một challenge chứa `ownerId` và hạn
   `LOGIN_CHALLENGE_TTL_MS` (5 phút).
5. `apps/api/src/routes/auth-routes.ts` → `POST /v1/auth/login/totp`: validate `LoginTotpRequest`, gọi
   `completeLogin()`, huỷ session cookie cũ nếu có (`destroySession`), rồi `setSessionCookies()`.
6. `apps/api/src/auth/owner-auth.ts` → `completeLogin()`: giải mã challenge (`readChallenge`, so sánh chữ ký
   bằng `timingSafeEqual`), xác thực bằng `verifyOwnerTotp()` hoặc `consumeRecoveryCode()`, tạo session mới
   (id ngẫu nhiên 32 byte, chỉ lưu hash SHA-256 vào bảng `sessions`).
7. `apps/api/src/auth/totp.ts` → `verifyTotp()`: kiểm tra mã 6 số qua `otplib`, dung sai ±30s, và từ chối mã
   có `timeStep` không lớn hơn `totp_last_step` đã lưu (chặn replay).
8. `apps/api/src/auth/owner-auth.ts` → `ownerGuard()`: hook `onRequest` cho mọi route owner — đọc cookie
   `crew_session`, phân giải phiên còn hiệu lực (`resolveSession`, kiểm tra TTL tuyệt đối 7 ngày và TTL rảnh
   12h), và với method có side effect (`isMutating`) còn gọi `assertAllowedOrigin()` +
   `assertCsrfToken()` (từ `apps/api/src/auth/csrf.ts`) trước khi gán `request.ownerSession`.
9. `apps/api/src/auth/csrf.ts` → `assertCsrfToken()`: token double-submit ký theo session
   (`csrfTokenFor`), phải khớp cả header `CSRF_HEADER` lẫn cookie `crew_csrf`.
10. `apps/api/src/cli/seed-owner.ts` → `seedOwner()`: tạo (hoặc với `--reset` thay) tài khoản owner duy nhất —
    băm mật khẩu, sinh `totpSecret` và 10 mã khôi phục (`generateRecoveryCodes`, chỉ lưu hash), xoá session cũ
    khi reset.
11. `apps/web/src/routes/account.tsx` → `ChangePasswordForm`: validate cục bộ trước khi gọi API — mật khẩu
    hiện tại bắt buộc, mã TOTP 6 số (`TotpCode`) hoặc mã khôi phục (`RecoveryCode`) tuỳ chế độ, mật khẩu mới
    ≥ `MIN_PASSWORD_LENGTH` (12) và khác mật khẩu hiện tại, nhập lại phải khớp; sau đó gọi
    `api.changePassword()` (`quiet401: true` nên sai mật khẩu/mã không tự đăng xuất owner — khi gặp 401, form
    kiểm tra lại session và chỉ chuyển `/login` nếu phiên đã thật sự mất). Thành công: `setCsrfToken()` với
    token mới, `queryClient.setQueryData(keys.session, …)`, toast "Đã đổi mật khẩu. Các phiên đăng nhập khác đã
    bị đăng xuất.", `router.invalidate()`. Có nút chuyển sang dùng mã khôi phục thay TOTP.
12. `apps/api/src/routes/auth-routes.ts` → `POST /v1/auth/password`: đứng sau `ownerGuard` (session + Origin +
    CSRF) và dùng cùng giới hạn tần suất theo IP với đăng nhập (`loginRateLimitPerMinute`); validate
    `ChangePasswordRequest` (định nghĩa cùng `packages/shared/src/api-schemas.ts` với `Ticket`/
    `CreateSubtaskRequest`/`RateSubtaskRequest` của flow `ticket-lifecycle` — các schema ticket đó, kể cả
    `RateSubtaskRequest` mà PM dùng để đánh giá lại một subtask tại chỗ, không ảnh hưởng gì tới schema này;
    400 khi mật khẩu mới quá ngắn hoặc trùng mật khẩu hiện tại), gọi
    `changeOwnerPassword()` rồi `setSessionCookies()` với session mới. Không dùng `Idempotency-Key` (route
    owner không dùng cơ chế này).
13. `apps/api/src/auth/owner-auth.ts` → `changeOwnerPassword()`: xác minh mật khẩu hiện tại trước (để một
    session bị đánh cắp một mình không thể đốt bước TOTP hay mã khôi phục), rồi `verifyOwnerTotp()` (không cho
    dùng lại) hoặc `consumeRecoveryCode()`; bất kỳ bước nào sai đều trả 401 với cùng thông điệp chung "invalid
    password or verification code". Sau đó `hashPassword()` (argon2id) và trong một transaction: chỉ cập nhật
    `owner.password_hash` nếu vẫn khớp hash vừa xác minh (đổi đồng thời → một bên thắng), xoá mọi session của
    owner, rồi gọi `issueSession()` (hàm nay dùng chung với `completeLogin()`) để cấp session mới. Kết quả:
    thiết bị đang đổi tiếp tục với session id và CSRF token mới; các thiết bị khác bị đăng xuất (stream SSE
    đang mở của chúng kết thúc ở lần kiểm tra heartbeat kế tiếp qua `sessionStillValid`).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/auth-routes.ts` | Route đăng nhập/đăng xuất/đọc phiên/đổi mật khẩu | `authRoutes` |
| `apps/api/src/auth/owner-auth.ts` | Session, challenge, guard owner, đổi mật khẩu | `ownerGuard`, `completeLogin`, `changeOwnerPassword`, `issueChallenge`, `resolveSession`, `purgeExpiredSessions` |
| `apps/api/src/auth/csrf.ts` | CSRF double-submit + Origin allow-list | `assertCsrfToken`, `assertAllowedOrigin`, `csrfTokenFor` |
| `apps/api/src/auth/password.ts` | Băm/so mật khẩu argon2id (độ dài tối thiểu re-export từ `@crew/shared`) | `hashPassword`, `verifyPassword`, `verifyAgainstDummy` |
| `apps/api/src/auth/totp.ts` | TOTP và mã khôi phục | `verifyTotp`, `generateRecoveryCodes`, `hashRecoveryCode` |
| `apps/api/src/cli/seed-owner.ts` | CLI tạo/reset tài khoản owner | `seedOwner` |
| `apps/web/src/routes/login.tsx` | UI đăng nhập hai bước | `LoginForm`, `LoginPage` |
| `apps/web/src/routes/account.tsx` | UI đổi mật khẩu owner | `AccountPage`, `ChangePasswordForm` |

## Dữ liệu

- Bảng: `owner` (mật khẩu, `totp_secret`, `totp_last_step`, `recovery_code_hashes`; `password_hash` bị ghi đè
  khi đổi mật khẩu), `sessions` (chỉ lưu `id_hash`, `expires_at`, `last_seen_at`; toàn bộ dòng của owner bị xoá
  và thay bằng một dòng mới khi đổi mật khẩu).
- Sự kiện: không phát sự kiện realtime nào.
- Gọi ngoài: không.

## Flow liên quan

- api-platform: `ownerGuard` được gắn vào nhóm route owner trong `buildApp()`.
- machine-pairing: `verifyOwnerTotp()` (định nghĩa ở đây) được route pairing-code dùng để xác nhận lại owner.
- web-shell: trang login là điểm vào duy nhất trước khi vào app shell; route guard của router chuyển hướng 401
  về `/login?redirect=…`; mục "Tài khoản" trong menu owner (`OwnerMenu`) dẫn tới `/account` để đổi mật khẩu.

## Tests

- `apps/api/test/auth.test.ts`: yêu cầu TOTP bắt buộc, chặn replay mã, mã khôi phục dùng một lần, TTL
  challenge/session, xoay session id khi đăng nhập, giới hạn tần suất đăng nhập.
- `apps/api/test/csrf.test.ts`: từ chối thiếu/sai Origin, thiếu/sai token CSRF trên method có side effect.
- `apps/api/test/password-change.test.ts`: đổi mật khẩu thành công rehash argon2id, xoay session của thiết bị
  đang đổi và đăng xuất mọi thiết bị khác; sai mật khẩu hiện tại trả 401 chung mà không tốn mã TOTP; sai mã
  TOTP; mã TOTP dùng lại bị từ chối; mã khôi phục chỉ dùng được một lần; mật khẩu mới quá ngắn hoặc trùng mật
  khẩu hiện tại bị từ chối (400); thiếu session/Origin/CSRF; giới hạn tần suất tính cả lần sai như đăng nhập.
- `apps/web/src/routes/login.test.tsx`: sai mã, thành công, dùng mã khôi phục, sai mật khẩu.
- `apps/web/src/routes/account.test.tsx`: validate cục bộ (độ dài, khác mật khẩu hiện tại, nhập lại khớp)
  không gọi API; đổi mật khẩu thành công lấy CSRF token mới và hiện toast; lỗi 401 hiện thông điệp chung mà
  vẫn giữ owner đăng nhập; dùng mã khôi phục thay TOTP.
- `apps/web/e2e/account-password.spec.ts`: đổi mật khẩu tại `/account`, thiết bị khác bị đăng xuất ngay, đăng
  xuất thiết bị đang đổi, mật khẩu cũ bị từ chối khi đăng nhập lại, đăng nhập lại bằng mật khẩu mới; cuối bài
  khôi phục mật khẩu ban đầu qua API để các spec E2E khác vẫn đăng nhập được.
