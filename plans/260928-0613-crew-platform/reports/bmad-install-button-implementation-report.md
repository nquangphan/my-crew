# "Cài BMAD": install a project's BMAD setup on another machine (Validation Session 19): Implementation Report

Date: 2026-09-29 · Status: done · Branch: `worktree-agent-a442fe5879dd4e4b8` (one commit, not pushed) · Scope:
`apps/api`, `apps/daemon`, `apps/desktop`, `apps/web` (project settings only), `packages/shared` (additive),
`docs/flows.yaml` (flows section only), nine flow docs, `docs/files.md` (generated).

A machine that holds a project with `_bmad/_config/manifest.yaml` now reports the project's BMAD profile to the
server. Settings → Projects in the desktop app shows that profile next to this machine's install and offers a
manual "Cài BMAD" button that runs the same `bmad-method` installer non-interactively. The web project settings
page shows the profile read-only. Typecheck, the full test suite, lint, build, the web E2E and the desktop Electron
E2E pass. The opt-in live test installed a real `bmad-method@6.12.0` into a temp git repo.

## 1. Profile capture (daemon, shared, API)

- **Shared schema** `packages/shared/src/bmad-schemas.ts`: `BmadProfile` holds the installer version,
  `lastUpdated`, module codes (`core` included), tools/IDEs, the communication and document languages, the output
  folder (relative), and every other team-scope answer as `settings[{module, key, value}]` for `--set`. Validation
  refuses `user_name`, `user_skill_level` and `communication_language` as settings, credential-like keys, absolute
  paths and control characters. `Project.bmadProfile` and `DaemonProject.bmadProfile` carry it (nullable, default
  null, so older servers and clients still parse).
- **Reader** `apps/daemon/src/skills/bmad-profile.ts`: the manifest gives version, `lastUpdated`, modules and
  `ides`. Team answers come from `_bmad/config.toml` (`[core]` and `[modules.<installed>]`; `[agents.*]` is
  ignored) or, for the 6.0 layout, `_bmad/core/config.yaml`. The personal file `_bmad/config.user.toml` is read
  for `communication_language` only. `_bmad/custom` and `_bmad/memory` are never read. TOML is parsed with the new
  `smol-toml` dependency of `@crew/daemon`, which the desktop bundle compiles in.
- **Report**: `refreshInventory(key)` first calls `reportBmadProfile`. It runs when this machine owns the project,
  and it sends only when the profile differs from the last one it sent (state meta `bmad-profile:<KEY>`). So the
  profile refreshes at every inventory probe: at start, after a config change, after "Làm mới", when a run sees new
  skills, and after "Cài BMAD". A failure is logged and never blocks the probe.
- **API**: migration `0007_project_bmad_profile.sql` adds the nullable `projects.bmad_profile` jsonb. The route
  `PUT /v1/daemon/projects/:projectKey/bmad-profile` lives in a new file registered in the machine scope. It
  needs an idempotency key and validates the body strictly. The service answers 403 to a machine that does not
  own the project and 404 to an unknown project.
- **Newest install wins.** The profile is not cleared when the holding machine has no `_bmad`. A profile older
  than the stored one is not stored either; the answer is `{stored: false, profile: <stored>}`. Without this rule,
  a machine that took the project over with an outdated `_bmad` would overwrite the setup it is supposed to
  install.

## 2. "Cài BMAD" (desktop)

- **Decision** (`apps/desktop/src/daemon-host/bmad-install.ts`, `bmadInstallPlan`):
  - `no_profile`: the button is disabled and the card says "Chưa có cấu hình BMAD (máy đang giữ project chưa có
    BMAD)".
  - `skip`: this version with every profile module is already installed. The result is "Đã có BMAD <version> với
    đủ module".
  - `install`: there is no `_bmad` here.
  - `update`: the local install is an older version or misses modules.
  - `newer`: the local install is newer than the profile. The app never downgrades, so the button is disabled
    and the host refuses the request.
- **Argv** (`bmadInstallerArgs`): `npx -y bmad-method@<version> install --yes --directory <repo> --modules
  <modules without core> --tools <tools> [--communication-language …] [--document-output-language …]
  [--output-folder …] [--set <module>.<key>=<value> …] [--action update]`. `--action update` is added when any
  install exists. On an update, `--modules` and `--tools` also keep what is already installed here, because the
  installer removes unselected modules. A fresh `--yes` install requires `--tools`, so an empty tool list becomes
  `claude-code`. `--user-name` is never passed, so the installer uses the system user name.
- **Run**: the install waits for the folder-access guard (`HostContext.folderAccess`, the macOS Documents prompt)
  first. `npx` runs in its own process group with `CI=1 NO_COLOR=1`. After 7 minutes it is stopped (SIGTERM, then
  SIGKILL of the group), which stays under the 10-minute limit of a forwarded app request. Every output line goes
  to the UI (host event `bmad.progress`, forwarded by the main process) and to app.log as `bmad-install-output`,
  capped at 400 lines. Start, finish and failures are logged too.
- **Errors in Vietnamese**: npx missing (ENOENT), network (ENOTFOUND, EAI_AGAIN, `fetch failed` and similar in the
  output), installer exit code with its last lines, timeout, and a manifest that does not match the profile after
  a successful exit.
- **No commit.** The result counts the files the install added or changed (a `git status` diff against the state
  before the install). It names the ones crew-docs R6 protects, for example `.claude/skills/…`, and says they stay
  uncommitted until the owner allows them. One install per project runs at a time.
- **Afterwards** the inventory is re-probed, waiting up to 90 s. That re-probe also reports the new profile. When
  the daemon is not running, or the probe is slow, the result text says so.
- **UI**: a "BMAD" card in the project panel shows the profile (version, modules, tools, languages), this
  machine's state with a lozenge (Chưa cài, Khớp cấu hình, Khác cấu hình, Mới hơn cấu hình), the button, the live
  installer output and the result.

## 3. Web

`apps/web/src/routes/project-settings.tsx` has a small read-only "BMAD" section. It shows the version with the
install time (Asia/Ho_Chi_Minh), modules, tools, languages, output folder and the number of module settings. When
there is no profile it shows the same "Chưa có cấu hình BMAD…" text.

## 4. Tests

- `apps/daemon/test/bmad-profile.test.ts` covers fixtures for 6.12, 6.11, 6.10 and 6.0
  (`test/fixtures/bmad-installs.ts`). It checks the exact profiles and that no personal field leaks: user name,
  skill level, a credential-like key, an absolute path, agent names, `_bmad/custom` or `_bmad/memory`. It also
  checks that the daemon reports once per manifest change on the inventory probe.
- `apps/api/test/bmad-profile.test.ts` covers:
  - storing the profile and showing it to the owner and to other machines;
  - 403 for another machine or an unowned project, 404 for an unknown key, 400 for a bad key;
  - 400 for personal, secret, absolute or unknown fields;
  - newest-wins;
  - the idempotency key and replay.
- `apps/desktop/test/bmad-install.test.ts` covers:
  - version ordering;
  - the plan for every case;
  - the exact argv for install and update;
  - host operations against the real API with a stub runner: no profile, install with streamed progress and no
    commit, R6 note, skip on a second click, update with `--action update`, and refusal to downgrade;
  - errors for missing npx, a network failure, an installer failure, a timeout and a mismatch.
- The opt-in `CREW_LIVE_BMAD_TEST=1` case ran once. It installed `bmad-method@6.12.0` (core, bmm, claude-code)
  into a temp git repo in about 2 s: 234 untracked files, 214 of them under `.claude/`, HEAD unchanged. A second
  run skipped. The temp repo was removed.
- `apps/desktop/test/e2e/project-bmad.spec.ts` (Electron):
  - with no profile, the button is disabled;
  - with a `_bmad` in the folder, "Làm mới" reports the profile and "Cài BMAD" skips;
  - after `_bmad` is removed, the button installs through the test-mode stand-in runner (`fakeBmadRunner`, which
    downloads nothing) and shows the output, the R6 note and "Khớp cấu hình".
  The E2E pairing-code pool grows from 8 to 9.
- `apps/web/src/routes/project-settings.test.tsx` covers the read-only section with and without a profile.

Commands run in the worktree, one suite at a time, on my own databases (`crew_bmad_*`):

- `pnpm -r typecheck`, `pnpm -r test` (all pass; 4 skipped are the existing live tests plus the opt-in BMAD one),
  `pnpm lint`, `pnpm -r build`.
- `pnpm --filter @crew/web test:e2e`: 14 passed.
- `pnpm --filter @crew/desktop stage && test:e2e`: 6 passed.

## 5. Decisions and deviations

- External module versions are not pinned: the installer resolves each external module on its stable channel for
  the profile's installer version. The skip rule compares the installer version and the module list, as asked.
  `--pin <code>=<tag>` could reproduce module tags later if the owner wants that.
- `core.project_name` is replayed with `--set`. It is a team answer, and the target folder may be named
  differently.
- `--set` writes values verbatim, so TOML booleans come back as strings (`"true"`). This is the installer's
  documented behaviour for `--set`.
- Docs were updated by a sonnet subagent (owner decision) and checked with `crew-docs check --staged`.

## Unresolved questions

- Should the button also pin external module tags (`--pin`) so modules match exactly, not only the installer
  version?
