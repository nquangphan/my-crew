# Desktop onboarding fixes and app log: implementation report

Date: 2026-09-29 (Asia/Saigon). Status: done, not committed.

## 1. Root cause of "cannot add project"

**Evidence.** The production API log shows `POST /v1/machines/pair` at 10:05:49. After that there is no
`POST /v1/daemon/projects` and no `POST /v1/daemon/claims` before the wizard finished at 10:07:06
(`setupCompletedAt`; "crewd started" is at 10:07:06.977). The owner says: "t có chọn trên ui app nhưng ko thấy
có tác dụng". Then the create at 10:08:14 returned 201, and the retries at 10:09:03 and 10:10:05 returned 409.

**Cause 1: the wizard dropped the drafted project.** The wizard project step has two separate actions:

- "Thêm project mới từ thư mục" opens a form that has its own "Tạo project" button.
- "Lưu và nhận project" only sent `projects.apply` for the ticked projects that already exist on the server.

The form's own button was silently disabled until key, name, repo URL and description were all set. The
description is empty by default, and nothing said what was missing. So an owner who filled the form and
pressed the step's main button got a successful apply of nothing (no API call at all). "Tiếp" became
enabled, and the wizard finished with zero projects.

I reproduced this in the Electron E2E: the old wizard lets you draft KIDYSCHOOL, press "Lưu và nhận
project", and go on without any create.

**Cause 2: the later create looked like a failure.** The create from Settings → Projects saved the folder
but did not install the crew-docs hooks. The hooks were only installed in the wizard's hooks step, which the
owner had already passed. The quick health run that follows every project change therefore reported
`repos.KIDYSCHOOL.hooks` red ("Hook crew-docs chưa được cài"). The summary also counted the yellow
docs/device/app.version rows as failing. The machine turned red, a macOS "sức khỏe máy chuyển đỏ"
notification fired, and the web showed the machine as failing. The owner read this as "the add failed" and
created again, which hit 409 "Key đã có trên server".

This also explains why `repos.KIDYSCHOOL.hooks` was red: it was a missing install, not a runtime mismatch.
The hooks that `crewd doctor` later installed used the CLI's node.

## 2. Fixes

| Area | Fix | Files |
|------|-----|-------|
| Wizard | "Lưu và nhận project" creates a drafted new project first, then applies the ticked ones. "Tiếp" stays disabled while a draft is not created, with a warning. The form states what is missing ("Còn thiếu mô tả.") instead of silently disabling its button. The automatic re-validation of saved folders no longer un-applies the step. | `renderer/components/new-project-form.tsx`, `renderer/routes/setup-wizard.tsx`, `renderer/components/project-picker.tsx` |
| Idempotent create | On 409, if the key exists, this machine owns it (`ownerState: mine`) and the repo is the same (`sameRepo`), the app saves the folder and returns `already_owned` ("đã được tạo trước đó…"). Any other existing key keeps the clear 409 message. | `daemon-host/setup-ops.ts` `createProject` |
| Hooks installed with the project | `ensureHooks` runs after `projects.create`, `projects.apply` and `projects.setFolder`. Working hooks, whoever installed them, are never rewritten. A failure is shown on the outcome. | `setup-ops.ts` |
| Hook check accepts any working runtime | `inspectHooks` returns one of: `missing`/`incomplete`/`broken` (red), `stale` (yellow: works but runs an older crew-docs than the machine's), or `ok` (green). Any runtime that exists and runs `bundle --version` is accepted. The `install-hooks` fix returns early when the hooks work, and keeps the runtime of a stale but working install, so `crewd doctor` never rewrites a working setup. | `apps/daemon/src/health/checks/repos.ts`, `setup-ops.ts` `hookView` |
| Moved app | At host start, `repairBrokenHooks` reinstalls hooks whose runtime or bundle no longer runs, for example an app run from a mounted dmg or App Translocation and then moved. `app-start` logs `temporaryLocation`. | `setup-ops.ts`, `host-service.ts`, `main/index.ts` |
| Hooks block commits before docs-init | In a repo without `docs/flows.yaml`, `check --staged`, `--commit-msg` and `--pre-push` print one Vietnamese warning line and exit 0. "Without" means missing both in the index and at HEAD; for pre-push, at the pushed tip and at the known remote tip. `--all` and `--range` keep exit 3; the daemon's docs-init gate uses `--all`. Removing the manifest from an adopted repo still exits 3. The docs-init commit passes, and enforcement after it is unchanged. | `packages/docs-kit/src/commands/check.ts`, `src/cli.ts`, `STANDARD.md` |
| Summary semantics | `failing` lists red checks only; yellows alone make the machine yellow. `repos.<KEY>.docs` without docs is **green with a note** (my call: it is expected, not a warning). `mcp.<KEY>.device` stays yellow and is not failing. No API or web change was needed, because the web shows `failing` and alerts only on `red`. | `apps/daemon/src/health/health-runner.ts`, `checks/repos.ts` |
| Updater | electron-updater's "no release yet" answers map to a new `unpublished` state, which the health check shows green: "Chưa có bản phát hành nào; đang dùng 0.1.0". The recognised answers are the `ERR_UPDATER_NO_PUBLISHED_VERSIONS`, `…LATEST_VERSION_NOT_FOUND` and `…CHANNEL_FILE_NOT_FOUND` codes, and a 404. Network errors stay yellow. | `main/updater.ts`, `checks/app.ts`, `shared/desktop-ipc.ts` (`UpdateStatus.state`), `settings.tsx` |
| Health runs | Overlapping runs can no longer let an older report overwrite a newer one. Background runs are tracked and awaited on shutdown. | `daemon-host/health-ops.ts`, `host-service.ts` |

## 3. App log

- **Location:** `~/.crew/logs/app.log`. Rotation at 2 MB keeps `app.log.1` and `app.log.2`. The file is mode
  0600 and the directory 0700. `daemon.log` is unchanged and keeps the job activity.
- **Writer:** only the Electron main process writes the file. The daemon host sends entries over its port
  (`FromHost` kind `log`, shared schema `AppLogEntry`). The renderer forwards `error` and
  `unhandledrejection` events through the new IPC `app.reportError`.
- **Format:** one JSON line per entry, `{at, level, source: main|host|renderer, event, …fields}`. `at` is
  local time with its offset, for example `2026-09-29T10:08:14.729+07:00`.
- **Events:**
  - `app-start`
  - `ipc`: every renderer call, with method, outcome ok/error, ms and the error. Inputs are never logged.
  - `daemon-host`: supervisor state changes.
  - `host-op-failed`
  - `api-error`: method, path, status, errorCode, message and attempts, for every VpsClient call that fails
    for good, in the daemon and in the host.
  - `health-change` and `health-summary`: only checks whose status changed.
  - `hooks-installed`, `hooks-broken`, `hooks-install-failed`
  - `project-create-idempotent`
  - `daemon-started`, `daemon-start-failed`
  - `updater-error`, `updater-unpublished`
  - `health-run-failed`
  - `uncaught-exception` and `unhandled-rejection` in main and host; `uncaught-error` from the renderer.
- **Redaction:**
  - Fields whose name matches token, secret, password, cookie, authorization, pairing, `code`, otp, api key,
    credential or private key are replaced by `[đã ẩn]`. Because of this, the API error code is logged as
    `errorCode`.
  - Strings and depth are capped.
  - The whole line then goes through `scrubSecrets`, which moved to `@crew/shared`. The daemon re-exports it,
    so the patterns are the same everywhere.
- **UI:** a "Mở thư mục log" button in Settings, next to a short note about both log files.

## 4. Tests

- **docs-kit:** R5 tests cover `--all`/`--range` exiting 3, the hook modes warning and passing, and a manifest
  removal still being refused. A real-hook test commits and pushes before docs-init, then makes the docs-init
  commit, then checks that R3 is enforced.
- **daemon:**
  - `summarize` with yellows only and with reds.
  - A hook installed by another working runtime is accepted and not rewritten; a vanished runtime is red and
    gets fixed.
  - Docs row green; `unpublished` green; network error yellow.
  - The VpsClient `onError` hook (no token in the output).
- **desktop unit:**
  - `app-log.test.ts`: redaction, key order, capping, rotation with two backups, mode 0600, tightening an
    existing file's mode, never throwing.
  - `ipcLogEntry`, the supervisor `host-log` event, updater `unpublished`.
  - host-service: the created project gets its hooks, health green, a commit before docs-init passes, a retried
    create returns `already_owned`, a SHOP conflict still returns 409, the log entries, and repair of a
    vanished runtime while a working foreign runtime is left alone.
- **Desktop Electron E2E (real API):** new `test/e2e/first-project.spec.ts`. It creates a docs-less mobile
  KIDYSCHOOL project:
  - Drafted with an empty description: the step button reports the problem and "Tiếp" stays disabled.
  - Saved with the step button after filling the description: the project is created.
  - Hooks installed; a commit in the repo passes; nothing red; the web shows `failing: []`.
  - Created again from the Project page: success.
  - The SHOP conflict message; "Mở thư mục log"; `app.log` contents, no pairing code or token, mode 0600.
- **Gates:** all green.
  - `pnpm -r typecheck`, `pnpm -r test` (shared 16, web 65, docs-kit 39, api 168, daemon 155, desktop 31),
    `pnpm lint`, `pnpm -r build`.
  - Web E2E 11/11 and desktop E2E 5/5.
  - `crew-docs check --staged` and `--commit-msg` on a temporary index built from HEAD plus the change, with
    no trailer: ok.
- **Docs:** the flow pages were written by the sonnet subagent and checked, and `check --all` passes. The pages
  are `docs-check`, `docs-hooks`, `daemon-health`, `daemon-runtime`, `agent-runs`, `api-platform`,
  `desktop-app` and `desktop-ui`, plus `STANDARD.md`. `docs/flows.yaml` (flows only) gained `app-log.ts`, the
  shared scrubber and the new tests; `docs/files.md` was regenerated.

## 5. Artifacts

These are gitignored:

- `apps/desktop/release/2P-Crew-0.1.0-arm64.dmg`
- `apps/desktop/release/2P-Crew-0.1.0-arm64-mac.zip`
- `apps/desktop/release/2P-Crew-0.1.0-x64.dmg`
- `apps/desktop/release/2P-Crew-0.1.0-x64-mac.zip`

No process started for this work is still running.

## 6. Left undone / notes

- The app version is still 0.1.0. The owner has to reinstall the new dmg over the old app; bump the version
  before publishing a release.
- On the owner's machine, `kidy_school` currently has hooks pointing at the CLI's node (written by `crewd
  doctor`). The new check accepts them as long as that node exists, so nothing needs changing there.
- `docs/architecture.md` does not list log files, so it was left unchanged.
