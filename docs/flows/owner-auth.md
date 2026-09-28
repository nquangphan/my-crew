# Đăng nhập chủ dự án

> Flow `owner-auth`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow owner-auth` in ra
> đúng danh sách đó.

## Mục đích

Xác thực owner (chủ dự án, người dùng con người duy nhất của hệ thống) bằng mật khẩu cộng TOTP hai bước, quản
lý phiên đăng nhập server-side và CSRF cho mọi route owner, và cấp tài khoản owner ban đầu qua CLI.

## Điểm vào

- `apps/api/src/routes/auth-routes.ts` — `POST /v1/auth/login`, `POST /v1/auth/login/totp`,
  `GET /v1/auth/session`, `POST /v1/auth/logout`.
- `apps/web/src/routes/login.tsx` — trang `/login` trên web.

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

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/auth-routes.ts` | Route đăng nhập/đăng xuất/đọc phiên | `authRoutes` |
| `apps/api/src/auth/owner-auth.ts` | Session, challenge, guard owner | `ownerGuard`, `completeLogin`, `issueChallenge`, `resolveSession`, `purgeExpiredSessions` |
| `apps/api/src/auth/csrf.ts` | CSRF double-submit + Origin allow-list | `assertCsrfToken`, `assertAllowedOrigin`, `csrfTokenFor` |
| `apps/api/src/auth/password.ts` | Băm/so mật khẩu argon2id | `hashPassword`, `verifyPassword`, `verifyAgainstDummy` |
| `apps/api/src/auth/totp.ts` | TOTP và mã khôi phục | `verifyTotp`, `generateRecoveryCodes`, `hashRecoveryCode` |
| `apps/api/src/cli/seed-owner.ts` | CLI tạo/reset tài khoản owner | `seedOwner` |
| `apps/web/src/routes/login.tsx` | UI đăng nhập hai bước | `LoginForm`, `LoginPage` |

## Dữ liệu

- Bảng: `owner` (mật khẩu, `totp_secret`, `totp_last_step`, `recovery_code_hashes`), `sessions` (chỉ lưu
  `id_hash`, `expires_at`, `last_seen_at`).
- Sự kiện: không phát sự kiện realtime nào.
- Gọi ngoài: không.

## Flow liên quan

- api-platform: `ownerGuard` được gắn vào nhóm route owner trong `buildApp()`.
- machine-pairing: `verifyOwnerTotp()` (định nghĩa ở đây) được route pairing-code dùng để xác nhận lại owner.
- web-shell: trang login là điểm vào duy nhất trước khi vào app shell; route guard của router chuyển hướng 401
  về `/login?redirect=…`.

## Tests

- `apps/api/test/auth.test.ts`: yêu cầu TOTP bắt buộc, chặn replay mã, mã khôi phục dùng một lần, TTL
  challenge/session, xoay session id khi đăng nhập, giới hạn tần suất đăng nhập.
- `apps/api/test/csrf.test.ts`: từ chối thiếu/sai Origin, thiếu/sai token CSRF trên method có side effect.
- `apps/web/src/routes/login.test.tsx`: sai mã, thành công, dùng mã khôi phục, sai mật khẩu.
