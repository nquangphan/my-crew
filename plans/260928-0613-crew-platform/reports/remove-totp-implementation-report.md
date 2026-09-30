# Remove TOTP: implementation report

Date: 2026-09-30. Decision: plan.md, Validation Session 25 (owner removes TOTP everywhere).

## Outcome

TOTP and recovery codes are gone from the API, the web app, the desktop app text, the shared schemas, the
seed CLI and every test suite. Login is one step, sensitive owner actions are a confirm click, and a password
change needs only the current password.

## Behaviour

- `POST /v1/auth/login` takes `{ username, password }` (`LoginRequest`) and returns the session
  (`{ owner, csrfToken }`) with the cookies set. Origin check, login rate limit, same 401 for unknown user
  and wrong password, and session rotation are kept. `/v1/auth/login/totp`, the signed login challenge and
  `recoveryCodesLeft` are removed.
- `POST /v1/auth/password` takes `{ currentPassword, newPassword }`; the new password must have 12+ chars and
  differ from the current one. All sessions are deleted and the caller gets a rotated one. A wrong current
  password returns 401 `invalid password`. The login rate limit still applies.
- `POST /v1/machines/pairing-codes`, `/v1/claim-requests/:id/approve|reject` and
  `/v1/project-change-requests/:id/approve|reject` need only the owner session, Origin and CSRF token. They read
  no body, so a `code` field from an older client is ignored. `ChangePasswordRequest` and `LoginRequest` are
  plain zod objects, which also drop an extra `code`.
- The seed CLI sets the password only and prints one line. It writes `''`, `null` and `{}` into the unused
  `totp_secret`, `totp_last_step` and `recovery_code_hashes` columns, so no old secret stays stored. `--reset`
  still signs every session out. The columns remain; there is no migration.
- `otplib` is removed from `@crew/api`, `@crew/web` and `@crew/e2e`; `apps/api/src/auth/totp.ts` is deleted.
- Web: the login page is one form, `TotpDialog` is replaced by `ConfirmDialog` (Hủy plus a confirm button; the
  API error is shown and the dialog stays open), the account form lost the code field and the recovery toggle,
  and the account menu no longer shows the remaining recovery codes. The generic `UNAUTHORIZED` text no longer
  mentions a code.

## Tests

- API: password-only login (success with hardened cookies, wrong password, unknown user, malformed body,
  foreign Origin, ignored `code`, old route 404, rate limit including the correct password after the limit),
  seed CLI stores no two-factor data and prints no TOTP (runs the CLI `main()`), `--reset` clears old
  two-factor data, password change without TOTP (success, ignored `code`, wrong current password, validation,
  session/Origin/CSRF, rate limit), pairing codes and both decision routes without a code (401 without a
  session, 403 without CSRF).
- Web component tests: login, account, inbox and pairing dialog assert that no code field exists and that no
  body is sent.
- Web E2E (phone, tablet, desktop): 23 passed. Deploy E2E (`e2e/`): its global setup now fails if the seed
  output contains any TOTP text. It typechecks, but it was not run because it deploys the full Docker stack.
  The desktop E2E was also updated and typechecks, but it was not run because it needs the staged Electron app.
- `pnpm -r typecheck`, `pnpm -r --workspace-concurrency=1 test`, `pnpm lint` and `pnpm -r build` pass.

## Files outside the listed ownership

- `apps/daemon/test/daemon-extras.test.ts`: it imported the removed `freshTotp` helper from the API tests, so
  the approval call now sends no code. This is a test-only edit, and the daemon suite would not compile without
  it.
- `apps/desktop/test/**` (host-service test and desktop E2E helpers and spec): the same helper and the old
  login route. These are test-only edits.

## Left for the controller

- `docs/architecture.md`, `docs/index.md` and `deploy/.env.example` still mention TOTP or "login challenges".
  They were outside the allowed files. The accurate replacements are "password login" and "signs CSRF tokens".
- The test databases `crew_nototp_test`, `crew_nototp_daemon_test`, `crew_nototp_desktop_test` and
  `crew_nototp_e2e_test` remain on the dev Postgres and can be dropped.
