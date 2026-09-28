---
title: "Phase 9: Local Desktop App"
status: completed
priority: P1
effort: 16h
dependsOn: [6]
---

# Phase 9: Local Desktop App

<!-- Updated: Validation Session 9 - MCP servers join the capability inventory and preflight; QC defaults Maestro (mobile) / Playwright (web) -->
<!-- Updated: Validation Session 3 - projects/folders chosen in the local app; takeover needs owner approval; app can create projects -->
<!-- Added: 2026-09-28 - owner request: install one local app with a setup UI and health checks -->

## Overview

`2P Crew` is an Electron desktop app, the only thing the owner installs on each local machine. It:
- bundles the daemon runtime from Phase 6 and its own Node, so the machine needs no Node install;
- guides first-time setup in a wizard;
- keeps a health dashboard where every check shows a clear status and a one-click fix;
- runs the daemon in the background from a menu bar icon, and starts at login.

The UI is in Vietnamese. The Phase 6 CLI stays for headless Linux machines and uses the same code.

## Key Insights

- **One source for the checks.** The health checks live in the daemon package (`apps/daemon/src/health/`). The CLI `doctor` and the desktop dashboard only render them.
- **The daemon runs in an Electron `utilityProcess`, not the main process.** A UI crash or window close does not kill running agent jobs, and a daemon crash is restarted by the main process with backoff.
- **Login item instead of a LaunchAgent plist.** `app.setLoginItemSettings({openAtLogin: true})` runs in the owner's session, so the Claude subscription in the login Keychain works (validation decision). The macOS launchd generator from Phase 6 is not needed.
- **Bundled Node for hooks.** The `crew-docs` git hooks call the app's own binary with `ELECTRON_RUN_AS_NODE=1` through an absolute path. They work whatever Node the owner has, or none.

## Requirements

**Packaging:**
- `apps/desktop`, built with electron-vite and electron-builder.
- A universal macOS `.dmg` (arm64 + x64), published to GitHub Releases by CI.
- `better-sqlite3` is rebuilt for Electron's ABI.
- The `crew-docs` bundle is shipped as an app resource and copied to `~/.crew/bin` on first run and on every update.

**Setup wizard** (first run, and reachable later from Settings). Each step validates before "Next":
1. **Server:** the VPS URL (prefilled `https://crew.2p-solutions.com`), checked with `GET /v1/health` (TLS valid, API version compatible).
2. **Pairing:** enter the code from the web. The token is stored in the Keychain.
3. **Claude:**
   - Checks that the Claude Code runtime used by the Agent SDK is present and meets the minimum version.
   - Runs a haiku probe to confirm the subscription login works, and flags `ANTHROPIC_API_KEY` in the environment.
   - If not logged in, "Đăng nhập Claude" opens Terminal running `claude` so the owner can `/login`, then "Kiểm tra lại" re-checks.
4. **Projects and folders** (this machine decides what it runs):
   - A list of every project from the server, marked "của máy này", "chưa có máy" or "đang thuộc máy X".
   - Tick the projects this machine should run, and pick a local folder for each with a folder picker.
   - "Thêm project mới từ thư mục": pick a folder. The app reads `origin` and the default branch to prefill key, name, repo URL and branch. The owner types the description, which the assistant uses for routing. The app then creates the project.
   - A toggle "Máy này làm trợ lý".
   - Unowned projects, or no current assistant, are claimed at once. Anything held by another machine shows "Đang chờ duyệt trên web" until the owner approves it. The wizard can finish with pending items; they activate when approved.
   - Validation per folder:
     - It is a git repo, and its `origin` matches the project's repo URL.
   - The default branch exists.
   - Push access works (`git push --dry-run` to a scratch ref, or `git ls-remote` plus a credential helper check).
   - The working tree state is shown.
   - Folder paths are stored only locally (`~/.crew/config.yaml`), never on the server.
5. **Docs and hooks** per repo:
   - Installs the `crew-docs` hooks (the Phase 5 installer, which chains with husky or lefthook).
   - Shows the docs status. When docs are missing, it says a docs-init ticket will run first.
6. **Resources and models:** max concurrent jobs (defaulting from CPU and RAM), min free RAM, load limit, model allowlist and complexity map. All values are saved to `~/.crew/config.yaml`.
7. **Finish:** turns on start at login, starts the daemon, and opens the dashboard.

**Health dashboard.** Checks run on open, every 5 minutes, and on demand. Each shows green/yellow/red, a Vietnamese explanation, and a fix action where possible:

| Group | Checks | Fix action |
|-------|--------|------------|
| Server | VPS reachable; token valid and days to expiry; SSE connected with the last event time | Reconnect; rotate token; re-pair |
| Claude | Runtime version; subscription login probe; no `ANTHROPIC_API_KEY` | Open Terminal login; guide to remove the env var |
| MCP | Every MCP server per project and whether it connects in a job-like run. A web project requires Playwright MCP; a mobile project requires Maestro MCP plus a booted simulator or emulator | Install the missing server (`claude mcp add` with the official package); show the server's error; disable for this project |
| Skills | Inventory loaded per project, as seen inside a job worktree (count and names, including plugin namespaces); the worktree inventory matches the main checkout | Refresh inventory; re-detect shared paths |
| Repos | Path exists; git ok; origin matches; push access; hooks installed with a current `crew-docs` version; docs initialized; orphan worktrees | Re-pick folder; reinstall hooks; clean worktrees |
| Machine | CPU, RAM and load now; free slots; disk space for worktrees (warns below 10 GB) | Adjust limits |
| Resources | Orphan tagged processes and their ports; temp dirs of finished jobs; worktrees of closed tickets; containers created by jobs | Clean up now (same `job-cleanup` code) |
| App | Daemon process alive; start at login on; app version and update available | Restart daemon; enable login item; install update |

- A summary of the health results goes to the server in the heartbeat (`health: {status, failing[]}`), so the web Machines page shows it and a red status reaches the owner inbox.

**Settings → Projects** (at any time):
- **Skill & MCP của project:** a read-only list of the skills (name, source, description) and MCP servers (name, source, status, tools) agents see for this project, the same inventory the PM uses. Each MCP server has an on/off switch.
- **Loại project** (web / mobile / web+mobile / backend), plus the **MCP test UI** mapping. The defaults are Maestro for mobile and Playwright for web, and it can be pointed at a differently named server.
- **Thư mục dùng chung cho worktree:** the auto-detected untracked agent config (`.claude/`, `CLAUDE.md`…), with add and remove.
- Add a project, create one from a folder, change a folder, or release a project (with confirmation; its open tickets become unowned until claimed).
- Turn the assistant role on or off.
- Changes take effect live without restarting the daemon.
- The health checks re-run for the affected repos.

**Status and control:**
- A job list (running, queued, backoff) with the ticket key and title, role, model, elapsed time and cost. "Mở trên web" links to the ticket.
- "Tạm dừng nhận việc": the daemon stops starting new jobs, running jobs finish, and the heartbeat reports `paused`.
- A log viewer that tails the daemon log with a filter by ticket.

**Menu bar icon:**
- A status dot (green/yellow/red) and the number of running jobs.
- Items: Open dashboard, Pause/Resume, Run health check, Quit. Quit asks for confirmation while jobs are running.

**Notifications:** a macOS notification when health turns red, or when a job goes to `blocked`.

**Updates:** `electron-updater` from GitHub Releases, applied when no job is running. Automatic updates on macOS need a signed and notarized app (see the open question). Unsigned builds fall back to "a new version is available", with a download link.

## Architecture

```
Electron main ── tray, windows, login item, updater, daemon supervisor
   │  MessagePort (typed IPC: @crew/shared desktop-ipc schemas)
   ├─► utilityProcess: daemon runtime (Phase 6 createDaemon()) ── SSE/REST ► VPS
   │                                                        └─ Agent SDK query() ► Claude runtime
   └─► renderer (React, sandboxed) ◄─ preload exposes only typed IPC calls
```

## Related Code Files

Create under `apps/desktop/`:
- `electron.vite.config.ts`, `electron-builder.yml`, `package.json`
- `src/main/index.ts`, `src/main/daemon-supervisor.ts`, `src/main/tray.ts`, `src/main/login-item.ts`, `src/main/updater.ts`, `src/main/notifications.ts`, `src/main/terminal-launcher.ts`
- `src/preload/index.ts`
- `src/renderer/main.tsx`, `src/renderer/routes/setup-wizard.tsx`, `src/renderer/routes/health.tsx`, `src/renderer/routes/jobs.tsx`, `src/renderer/routes/logs.tsx`, `src/renderer/routes/settings.tsx`
- `src/renderer/components/health-check-row.tsx`, `src/renderer/components/wizard-step.tsx`, `src/renderer/components/folder-picker.tsx`, `src/renderer/components/project-picker.tsx`, `src/renderer/components/new-project-form.tsx`, `src/renderer/routes/settings-projects.tsx`
- `test/e2e/onboarding.spec.ts`, `test/e2e/health.spec.ts` (Playwright `_electron`), `test/daemon-supervisor.test.ts`

Create under `apps/daemon/src/`:
- `daemon.ts` (`createDaemon(config)` library entry: start, stop, pause, resume and status events)
- `health/health-runner.ts`, `health/checks/{server,claude,skills,repos,machine,app}.ts`, `health/types.ts`
- `test/health-checks.test.ts` (real tmp git repos, a real test API)

Create in `packages/shared/src/`:
- `desktop-ipc.ts` (IPC request, response and event schemas)
- `health-schemas.ts` (check result and heartbeat health summary)

Modify:
- `apps/daemon/src/cli.ts`: `start` uses `createDaemon`.
- `apps/daemon/src/commands/doctor.ts`: renders `health-runner` results.
- No `service/launchd.ts` is created (Phase 6 already dropped it): macOS autostart is the app's login item.
- `apps/api` heartbeat route and the `machines` table: store the health summary.
- `apps/web/src/routes/machines.tsx`: show health.
- `packages/docs-kit/src/hook-installer.ts`: accept an explicit runtime path (the app binary with `ELECTRON_RUN_AS_NODE=1`).
- `.github/workflows/ci.yml` (Phase 8): the desktop build, and the release job on tags.

## Implementation Steps

1. Extract `createDaemon()` from the Phase 6 CLI. Move the doctor checks into `health/` and add the missing checks (push access, origin match, disk, orphan worktrees, login item, app version).
2. Scaffold `apps/desktop` (electron-vite, React renderer, sandboxed preload, typed IPC) and rebuild the native modules.
3. The daemon supervisor: `utilityProcess` fork, restart with backoff, graceful stop that waits for jobs or asks, and pause/resume.
4. The setup wizard, steps 1–7, with validation per step and save to `~/.crew/config.yaml` and the Keychain. The project step uses the Phase 3 claim and create endpoints. Then Settings → Projects, with live reconfiguration of the daemon (`createDaemon().updateProjects()`).
5. The health dashboard with fix actions, the 5-minute schedule, and the heartbeat health summary (API and web changes).
6. The jobs and logs views, the tray, notifications and the login item.
7. The hook runtime path: `crew-docs` hooks call the app binary with `ELECTRON_RUN_AS_NODE=1`.
8. Packaging: universal dmg, the GitHub Releases publish job, and the updater with the unsigned fallback.
9. Tests:
   - health checks against tmp repos covering a missing hook, a wrong origin, no push access and orphan worktrees;
   - the supervisor restarts a crashed daemon;
   - Playwright `_electron` onboarding against the Phase 8 test stack (pair, choose a fixture repo, hooks installed, dashboard all green);
   - quitting while a job runs asks for confirmation.

## Todo

- [x] `createDaemon()` library entry; health checks shared with `doctor`
- [x] Electron scaffold with sandboxed renderer and typed IPC
- [x] Daemon supervisor in utilityProcess (restart, pause, graceful stop)
- [x] Setup wizard (server, pairing, Claude login, projects and folders with claims and project creation, hooks, resources, finish)
- [x] Settings → Projects: add, create, change folder, release, assistant toggle, applied live
- [x] Health dashboard with fix actions, and the health summary to the server and web
- [x] Jobs view, logs view, tray, notifications, login item
- [x] Hooks use the bundled runtime
- [x] Universal dmg, release job, updater
- [x] Unit and Electron E2E tests green

## Success Criteria

- On a Mac with no Node installed, installing the dmg and completing the wizard gives an all-green dashboard. In the app, the owner picks which projects the machine runs and which folder each uses, and can create a new project from a folder.
- Claiming a project owned by another machine stays pending until the owner approves it on the web. After approval, that project's tickets run on the new machine. Only the pairing code, the Claude `/login` and the repo folder choices are manual.
- The daemon starts at login without opening a window, and the menu bar shows its status.
- Breaking something turns the check red and offers a fix that makes it green again. Test cases: delete a repo hook, log out of Claude, revoke the token.
- Closing the window or reloading the renderer does not interrupt a running job. Killing the daemon process restarts it within 10 s.
- The web Machines page shows the same health status as the app.
- `crewd doctor` on the CLI prints the same checks as the dashboard.

## Risk Assessment

- **The SDK spawns the Claude runtime with a Node binary.** Inside Electron, the SDK must be pointed at the app binary with `ELECTRON_RUN_AS_NODE=1`, or at a bundled runtime path. [UNVERIFIED] Confirm the exact SDK option (executable or runtime path) against the pinned SDK in step 1. The fallback is requiring a system Claude CLI, detected by the Claude check.
- **Native module ABI mismatch** (`better-sqlite3`): electron-builder `install-app-deps`, plus CI launching the packaged app.
- **Unsigned app:** Gatekeeper asks for right-click → Open on first launch, and auto-update is unavailable. Resolved by the signing decision (open question).

## Security Considerations

- The renderer runs with `contextIsolation`, `sandbox` and no `nodeIntegration`, and loads only local bundled files. There is no remote content and a strict CSP.
- The machine token stays in the Keychain and the daemon process. It is never sent to the renderer, and the UI only sees the expiry and validity.
- Fix actions run fixed, whitelisted operations; there is no arbitrary shell from the UI. The Terminal launcher only opens `claude`.
