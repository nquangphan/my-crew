# Phase 9 (Local Desktop App): Implementation Report

Date: 2026-09-29 · Status: done with concerns (signing, release CI) · Branch: `worktree-agent-a649eeef1ad82a272`

Scope: `apps/desktop/**` (new), `apps/daemon/src/health/**`, `apps/daemon/src/commands/doctor.ts`,
`apps/daemon/src/daemon.ts`, `apps/daemon/src/library.ts`, `apps/daemon/test/health-groups.test.ts` (new),
`packages/shared/src/{desktop-ipc,health-schemas,index}.ts`, `docs/**` (flows section only), root `.gitignore`
and the lockfile.

## What was built

**Electron app `apps/desktop` (Electron 44.4.5, electron-vite 5, React 19, Tailwind 4, the web mockup palette).**

- **Process layout.**
  - Main process (`src/main/index.ts`): window, tray, login item, updater, notifications, Terminal launcher,
    single-instance lock and the daemon supervisor. It never loads the daemon library or a native module.
  - Daemon host (`src/daemon-host/`): an Electron `utilityProcess`. It runs `createDaemon()` plus every
    operation that touches git, the Keychain or the API (wizard steps, health checks and fixes, Settings →
    Projects, jobs, logs). A UI crash, a closed window or a renderer reload never touches it (E2E-verified:
    same pid).
  - Renderer (`src/renderer/`): sandboxed, `contextIsolation`, no Node, strict CSP, only bundled files,
    no window opening, no navigation, every permission denied.
  - Typed IPC: `packages/shared/src/desktop-ipc.ts` defines every request (input and output zod schemas),
    event and the host protocol (`ToHost`/`FromHost`). Main validates each renderer call against the schema
    and the sender URL (`ipc-handlers.ts`), answers app-level calls itself and forwards the rest to the host
    over its MessagePort. The machine token never reaches the renderer.
- **Supervisor** (`daemon-supervisor.ts`): forks the host, restarts it on a crash with backoff
  (1 s, 2 s, 4 s … 30 s; reset after 60 s stable), starts the daemon again and re-applies the pause, rejects
  requests in flight, and stops gracefully in `drain` (no new jobs, wait for running ones) or `requeue` mode.
  Killing the daemon process: restarted and running again well under 10 s (E2E).
- **Setup wizard** (7 steps, each validates before "Tiếp"):
  1. server URL (prefilled `https://crew.2p-solutions.com`), `GET /v1/health`, https required outside
     loopback, TLS errors and a missing `/v1` reported;
  2. pairing code → token in the Keychain (file store in tests), `machineId` in the config;
  3. Claude: SDK runtime version, CLI version, haiku login probe, `ANTHROPIC_API_KEY` flag, "Đăng nhập
     Claude" opens Terminal running `claude`, "Kiểm tra lại";
  4. projects and folders: every server project with "của máy này" / "chưa có máy" / "đang thuộc máy X" /
     "Đang chờ duyệt trên web"; tick + folder picker; each folder validated (git repo, origin matches the
     project URL in any ssh/https form, default branch, `git push --dry-run --no-verify` to a scratch ref,
     working tree state); unowned → claimed at once, held elsewhere → **202 pending** shown as "Đang chờ duyệt
     trên web" and saved locally, so it runs once approved (tested: approval on the web makes it runnable
     without a restart); "Máy này làm trợ lý"; "Thêm project mới từ thư mục" prefilled from `origin` and the
     default branch, with the owner-typed description, type and UI-test MCP names;
  5. docs and hooks: installs the crew-docs hooks with the app binary as runtime, shows the docs status
     ("docs-init sẽ chạy trước");
  6. resources and models: defaults suggested from CPU/RAM, allowlist with **sonnet always required**
     (UI, IPC schema and daemon config validation), complexity map, saved to `~/.crew/config.yaml`;
  7. finish: login item on, daemon started, dashboard opened.
- **Health dashboard**: all eight groups, green/yellow/red, Vietnamese text, one-click fixes; runs on open,
  on demand ("Kiểm tra ngay", tray) and every 5 minutes (quick mode: no paid login probe, no push dry run,
  no checkout probe; the last probe rows are kept). The summary goes out in the heartbeat right away when
  it changes, and the web Machines page shows it (E2E: `GET /v1/machines` returns the same green status).
  App-level fixes run in main (Terminal login, login item, update, restart daemon); navigation fixes open
  the wizard pairing step, Settings → Projects for a folder, the resource limits, or the API-key guide.
- **Settings → Projects**: folder change (validated, not saved when red), project type and MCP mapping
  (read-only, see deviations), skill and MCP inventory (name, source, description; status and tools) with
  a per-server on/off switch (the required QC server cannot be switched off), shared worktree paths
  (auto-detected + add/remove), claim more, create from a folder, release with confirmation, assistant
  toggle. Every change is saved and applied to the running daemon at once, then a quick health run follows.
- **Jobs, logs, tray, notifications, login item.** Jobs view (running/queued/backoff, ticket key and title,
  role, model, elapsed, cost, "Mở trên web"); log viewer tailing `~/.crew/logs/daemon.log` (JSON lines,
  one rotation at 10 MB) with a ticket filter and live lines; "Tạm dừng nhận việc" persisted across
  restarts (heartbeat reports `paused`); tray with a colored dot, running-job count, open / pause-resume /
  health / quit; quit asks while jobs run (wait / stop and resume later / cancel); notifications when
  health turns red and when a job goes `blocked`; login item via `app.setLoginItemSettings`, and a launch
  from it opens the menu bar only.
- **Hooks on the bundled runtime**: the crew-docs bundle ships as `resources/crew-docs.cjs`, is copied to
  `~/.crew/bin` at every host and daemon start, and hooks/wrapper call `app.getPath('exe')` with
  `ELECTRON_RUN_AS_NODE=1` (new `createDaemon({crewDocsRuntime})` option; the utility process's own
  `execPath` is the Helper binary). The launcher also imports the login shell's PATH, so git, claude, npx
  and maestro are found when the app starts from Finder or at login.
- **Updater** (`updater.ts`): electron-updater from GitHub Releases (`nquangphan/my-crew`), no auto
  download; a Developer ID–signed build downloads, waits until no job runs, then installs; an unsigned
  build shows "có bản mới" with a link to the release page. Disabled in dev and test mode.

**Daemon health (shared with `crewd doctor`).** New checks `mcp.ts` (every inventory server per project,
QC's required Playwright/Maestro server by project type and mapping, booted simulator or Android device;
fixes: `claude mcp add --scope user` with the official package, disable/enable for the project, open
Simulator, re-probe), `skills.ts` (inventory count and names incl. plugin namespaces; worktree vs main
checkout comparison; fixes: refresh, re-detect shared paths), `resources.ts` (orphan tagged processes and
ports, finished jobs' temp dirs, closed tickets' worktrees, containers report-only; fix: the same
`ResourceOps` cleanup the PM uses). Server gains the SSE row (connected, last event) and rotate/reconnect/
re-pair fixes; Claude gains the SDK runtime row; Repos gains origin, branch, push, working tree, hook
files present and current, docs initialized, orphan worktrees (+ clean fix); App gains daemon, login item
and version/update rows when the app supplies its facts. `applyHealthFix()` dispatches one fix; doctor uses
the shared group titles. Check result types come from `packages/shared/src/health-schemas.ts`.

## Tests

- Desktop unit/integration (vitest, own DB `crew_desktop_test`, real API): 19 tests — supervisor restart
  with backoff, pause re-applied, in-flight rejection, drain stop, manual restart; IPC validation (unknown
  method, bad input, no-sonnet config, injected fix id, trusted sender, preload channel sync); quit guard;
  notifications; tray view; state and test login item; updater signed/unsigned/disabled; the whole host
  flow against the real API (server check incl. https and incompatible API, pairing, wrong-origin refusal,
  unowned claim + **202 pending** takeover + assistant claim, hooks with the app runtime, resources,
  daemon start, approval on the web → project runnable, health with the live daemon, heartbeat summary equal
  to the web's, deleted hook red → fix green, Claude logout red, log tail, stop), project creation from a
  folder, duplicate key, live settings edits, release.
- Daemon: `test/health-groups.test.ts` (12 tests: URL normalization, key suggestion, wrong origin,
  missing branch, no push access, deleted hook file, orphan worktree + clean fix, docs missing, MCP required
  server + `claude mcp add` + disable, skills match, resource cleanup, SSE reconnect, app facts, order).
- Electron E2E (Playwright `_electron`, real API on port 8799, DB `crew_desktop_e2e_test`):
  - `onboarding.spec.ts`: the full wizard through the UI (pair, pick a fixture repo, create a project from
    a folder, assistant, hooks, resources, finish) → all-green dashboard → the web Machines API shows green;
  - `health.spec.ts`: delete a repo hook → red → "Cài lại hook" → green; Claude logout → red →
    "Đăng nhập Claude" launches Terminal (recorded) → green; renderer reload and window close keep the same
    daemon pid; SIGKILL of the daemon → restarted and running again < 10 s; revoke the machine on the web →
    token red → "Ghép lại máy" opens the pairing step → re-pair → green.
  - Both specs pass against the staged app **and against the packaged universal `.app`**
    (`CREW_E2E_EXECUTABLE`).
- Root: `pnpm -r typecheck`, `pnpm -r test` (shared 13, web 58, docs-kit 36, api 136, daemon 94 + 3
  skipped, desktop 19), `pnpm lint`, `pnpm -r build` pass. `crew-docs check --all` passes.

## Universal dmg

- `pnpm --filter @crew/desktop package:mac` → **succeeded**:
  `apps/desktop/release/2P-Crew-0.1.0-universal.dmg`, **443 MB** (the app is 779 MB unpacked: two 225 MB
  Claude Code binaries, arm64 and x64). `release/` is gitignored.
- Main binary is fat (x86_64 + arm64); both SDK binaries are present; the x64 slice boots under Rosetta,
  runs the host and installs crew-docs; `claude-agent-sdk-darwin-x64/claude --version` → 2.1.283.
- Signature: ad-hoc (`identity: "-"`, `TeamIdentifier=not set`), hardened runtime off, not notarized.
- Screenshots (outside the repo):
  `/private/tmp/claude-501/-Users-phannhatquang-Documents-projects-crew/2a7c667a-cb0d-453f-92de-961ca559b0ea/scratchpad/screenshots/`
  (staged app) and `…/scratchpad/screenshots-packaged/` (packaged universal app):
  `wizard-projects.png`, `dashboard-all-green.png`.

## Deviations and decisions

1. **The host process also runs the wizard operations**, not only the daemon, so the main process never
   loads native modules or blocks on git/network (the push dry run can take seconds).
2. **API, web and docs-kit changes listed in the phase file were already in place**: the heartbeat
   `health` field and `machines.health` (Phase 3), the web Machines health display (Phase 4) and
   `install-hooks --runtime` (Phase 5). Verified end to end, so those files are unchanged.
3. **Release CI job not created**: `.github/workflows/` is outside this phase's file ownership (Phase 8 owns
   CI). The job only needs `pnpm install`, `pnpm --filter @crew/docs-kit build`, then
   `pnpm --filter @crew/desktop exec electron-vite build && node apps/desktop/scripts/package-mac.mjs
   --publish` on `macos-latest` for tags, with `GH_TOKEN` (and the signing secrets below).
4. **Signing and notarization not done** (no certificate). Gatekeeper needs right-click → Open on first
   launch; updates fall back to the download link. Exact later step: Developer ID Application certificate;
   CI secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; in
   `electron-builder.yml` drop `identity: "-"`, set `hardenedRuntime: true`, `notarize: true` and Electron's
   entitlements (allow-jit, allow-unsigned-executable-memory, disable-library-validation). Documented in
   `docs/flows/desktop-app.md`.
5. **Project type and UI-test MCP mapping of an existing project are read-only in the app** with a link to
   the web project settings: the only update route (`PATCH /v1/projects/:id`) is owner-only, and adding a
   daemon route is an `apps/api` change outside this phase. Creating a project from the app sets both.
6. **Packaging**: asar disabled (the SDK spawns its binary and loads files from disk); the app is staged
   outside the pnpm workspace with a flat npm tree (`scripts/stage-app.mjs`, `scripts/package-mac.mjs`),
   because electron-builder otherwise collects the pnpm workspace and drops the x64 Claude binary. The x64
   SDK package is unpacked from its tarball (npm skips it on arm64 even with `--force`).
7. **better-sqlite3 13 ships Node-API prebuilds** (`prebuilds/darwin-<arch>.node`), so it loads in Electron
   without an ABI rebuild; `@electron/rebuild` still runs for the staged app and electron-builder.
8. **SDK runtime inside Electron** (the phase's `[UNVERIFIED]` risk): the SDK spawns its own native
   Claude Code binary from `claude-agent-sdk-darwin-<arch>`, so no Node and no `pathToClaudeCodeExecutable`
   are needed. The E2E uses test seams for the paid login and inventory probes; a live subscription run
   inside the packaged app was not executed here.
9. **MCP install** uses `claude mcp add --scope user` (machine-wide, so every job worktree sees it) and needs
   the `claude` CLI; the dashboard shows a server's SDK status but not an error message (the inventory schema
   has no error field).
10. **Test mode** (`CREW_DESKTOP_TEST_MODE=1`, E2E only): fake login and inventory probes driven by files in
    the test home, file-based login item, recorded Terminal launch. Everything else is real.
11. `apps/desktop/build/icon.png` is a generated placeholder icon (blue square, "2P"); replace it with the
    brand icon.

## apps/daemon files changed

`src/daemon.ts` (option `crewDocsRuntime`, 6 lines), `src/library.ts` (exports), `src/commands/doctor.ts`
(shared group titles), `src/health/types.ts`, `src/health/health-runner.ts`, `src/health/checks/{server,
claude,repos,machine,app}.ts`, new `src/health/checks/{mcp,skills,resources}.ts`,
`src/health/{repo-probe,project-views}.ts`, new `test/health-groups.test.ts`. Nothing under `src/roles/`,
the dispatcher, runners or tool wiring.

## Left undone

- Release CI job (Phase 8 file ownership), signing and notarization (no certificate).
- Editing a project's type and MCP mapping from the app (needs a daemon API route).
- The phase file's todo boxes are unchanged (`plans/` is off limits except this report).

## Unresolved questions

- Should a machine be allowed to change its own project's type and UI-test MCP mapping (a new daemon route),
  or does that stay owner-only on the web?
- The dmg is 443 MB because both Claude Code binaries ship. Ship per-arch dmgs instead of a universal one?
