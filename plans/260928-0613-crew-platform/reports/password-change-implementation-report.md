# Owner password change: implementation report

Date: 2026-09-29. Status: done, not committed.

## Outcome

The owner can change the password from the web app, and the API has a matching route. Everything in the
gate passes: typecheck, all tests, lint, build, and the web E2E at the three viewports. The crew-docs
`--staged` and `--commit-msg` checks also pass on a temporary index built from HEAD plus this change, with no
approval trailer.

## API

- `POST /v1/auth/password` is in `apps/api/src/routes/auth-routes.ts`. It runs behind `ownerGuard`, so it
  needs a session, an allowed Origin and the CSRF token. It uses the same per-IP rate limit as login
  (`loginRateLimitPerMinute`). The body is validated with `ChangePasswordRequest`. On success the route sets
  the new session cookies and returns a `SessionResponse`.
- `changeOwnerPassword()` is in `apps/api/src/auth/owner-auth.ts` and runs these steps in order:
  1. It verifies the current password first, so a stolen session alone cannot burn TOTP steps or recovery
     codes.
  2. It then checks the TOTP code (`verifyOwnerTotp`, which rejects reused codes) or a recovery code
     (`consumeRecoveryCode`, which consumes it).
  3. Either failure returns 401 with the same generic message: "invalid password or verification code".
  4. It hashes the new password with argon2id.
  5. In one transaction it updates the hash, but only if the stored hash still matches the one just verified,
     so two concurrent changes cannot both succeed. It then deletes every session of the owner and issues a
     new one.
- As a result, the other devices are signed out. Their open SSE streams end at the next heartbeat check.
- The new `issueSession()` helper is now used by both `completeLogin()` and the password change.
- There is no Idempotency-Key, because only daemon writes use one in this codebase.
- Additions to `packages/shared/src/api-schemas.ts`:
  - `MIN_PASSWORD_LENGTH` (12) and `MAX_PASSWORD_LENGTH` (1024).
  - `ChangePasswordRequest`, which accepts either a TOTP code or a recovery code, and rejects a new password
    equal to the current one with a 400 on the `newPassword` path.
- `apps/api/src/auth/password.ts` now re-exports `MIN_PASSWORD_LENGTH` from `@crew/shared`, so the seed CLI
  keeps working.

## Web

- The app had no global settings page; the only one was the per-project "Cài đặt project". So I added a
  `/account` route ("Tài khoản") and reached it from a new "Tài khoản" item in the owner menu.
- The form is `ChangePasswordForm` in `apps/web/src/routes/account.tsx`, with these fields: mật khẩu hiện tại,
  mã TOTP (a toggle switches to mã khôi phục), mật khẩu mới, nhập lại mật khẩu mới.
- It checks the input before sending (length, match, differs from the current password, code format), so
  mistakes do not spend a TOTP code.
- On success it takes over the rotated CSRF token and updates the cached session. It then shows the toast
  "Đã đổi mật khẩu. Các phiên đăng nhập khác đã bị đăng xuất."
- `api.changePassword` uses `quiet401`, so a wrong password shows a generic error instead of logging the owner
  out. After a 401 the form re-checks the session and goes to `/login` only if the session is really gone.
- I checked the layout on phone, tablet and desktop screenshots. None of the three scrolls sideways.

## Tests

- `apps/api/test/password-change.test.ts` has 9 cases:
  - success with an argon2id re-hash; the calling session rotates and the other sessions are revoked.
  - a wrong password gives the generic 401 and does not spend the TOTP code.
  - a wrong TOTP code is rejected.
  - a reused TOTP code is rejected, both the code from login and the code from a previous change.
  - a recovery code works once.
  - a new password that is too short, equal to the current one, or sent without any code is rejected.
  - the route requires a session, an allowed Origin and the CSRF token.
  - the rate limit counts wrong passwords and wrong codes.
- `apps/web/src/routes/account.test.tsx` has 4 cases:
  - local validation without calling the API.
  - success, including the toast and the rotated CSRF token being used by the next request.
  - a generic error that keeps the owner signed in.
  - a recovery code sent instead of a TOTP code.
- `apps/web/e2e/account-password.spec.ts` runs at the phone, tablet and desktop viewports. It changes the
  password and checks that the other device is signed out. It then logs out, confirms the old password is
  rejected, and logs in with the new one. At the end it restores the prepared password, because the other
  specs log in with it.

## Docs

- In `docs/flows.yaml` (flows section only), `account.tsx` becomes an `owner-auth` entrypoint and the three
  new test files are listed under that flow. I then ran `crew-docs generate` to refresh `docs/index.md` and
  `docs/files.md`.
- A sonnet subagent wrote the prose for `docs/flows/owner-auth.md`, `docs/flows/web-shell.md` and a
  one-sentence note in `docs/flows/ticket-lifecycle.md`. That note was required by rule R3, because
  `api-schemas.ts` is shared between flows. I reviewed the prose against the code.

## Processes

The E2E API and web servers were started and stopped by Playwright. I checked afterwards that ports 8798 and
4178 are free. Nothing else was started. I did not touch port 5432 or the VPS.

## Unresolved questions

None.
