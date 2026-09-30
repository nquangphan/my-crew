# Phase 1 implementation report: server-managed settings (and the scope extension)

Date: 2026-09-30. Branch: `main` (uncommitted working tree, nothing staged). Status: done, including the
2026-09-30 scope extension (web as the source of truth, desktop app as a gateway).

## What moved to the server

| Setting | Before | Now |
|---|---|---|
| Role prompts and partials | `apps/daemon/src/roles/prompts/*.md` only | Server revision per prompt name (kind `prompt`, global); the bundled file is the default and the fallback |
| Guard path rules (docs paths, protected paths, docs_update write scope) | Code constants | Kind `policy` (global); `guard-hook.ts`, the QC UI-test rule and the docs-first check read the lists from it |
| QC UI-test rule | Code | `policy.qcUiTestOnlyForNonDocs` + `policy.docsPaths` |
| Complexity map, model allowlist | Local `config.yaml` | Kind `models`, global with an optional per-machine override |
| Per-run cost cap (`perJobUsd`) | Local `config.yaml` | Kind `budgets`, global with an optional per-machine override (ticket-tree and daily budgets stay on the project) |
| Machine resources | Local `config.yaml` | Kind `resources`, per machine |
| Per-project disabled MCP servers | Local `config.yaml` | Kind `project_mcp`, per project (applies on the owning machine) |
| Project folders and shared paths (extension) | Local `config.yaml` | Kind `project_folders`, per machine; the daemon validates each folder locally |

Stays local: API URL, machine token, project test command (a shell command, so never editable from the web), the macOS
folder permission, log files. Owner invariants stay in code and no setting can change them: docs work always runs on
sonnet (`model-policy.ts`), Fable is never selectable (`SelectableModel` everywhere), `AGENTS.md` / `CLAUDE.md` are
always protected and never docs (`guard-hook.ts`), and the pre-push gate keeps the bundled crew-docs R6 list.

## Shared schemas (`packages/shared/src/settings-schemas.ts`)

`SettingsKind`, `SettingsScope`, `KIND_SCOPES`, `SettingsKey`, content schemas (`PromptContent`, `GuardPolicy` with safe
repo-relative `PathGlob`s, `ModelSettings` — sonnet required, every complexity model must be allowed —,
`ResourceSettings`, `BudgetSettings`, `ProjectMcpSettings`, `ProjectFolders`), `PROMPT_CATALOG`, `PROMPT_VARIABLES`,
`validatePromptTemplate` (unknown variable, unknown partial, nested partial, empty), glob matcher, `lineDiff`,
`EffectiveSettings`, `MachineSettingsState`, import/put request schemas. `packages/shared/src/machine-command-schemas.ts`
holds the remote-action whitelist. Events: `settings.changed`, `machine.settings_applied`, `machine.command`,
`machine.command_updated`. Heartbeat carries `settings`; running jobs carry `settingsRevision`; `Machine.settings`
shows reported/expected revision; `AgentActivity.settingsRevision`.

## API

- Migration `apps/api/drizzle/0008_server_settings_and_machine_commands.sql` (additive): `settings_revisions`
  (kind, scope, machine_id, project_id, name, version, content jsonb or null, note, author, restored_from, created_at;
  unique per key+version, the highest version is the active one), `machines.settings_state`, `machine_commands`.
- Owner routes (`routes/settings-routes.ts`): `GET /v1/settings` (bundled prompt defaults, variables, defaults, active
  revisions), `GET /v1/settings/history`, `POST /v1/settings/validate`, `POST /v1/settings` (validation with the shared
  schemas; `baseVersion` → 409 when stale; `content: null` removes an override), `GET /v1/settings/revisions/:id`,
  `GET /v1/settings/diff?from&to`, `POST /v1/settings/revisions/:id/restore` (saves the old content as a new version).
- Daemon routes: `GET /v1/daemon/settings` (global ← machine/project override, owned projects only, folders with the
  project default branch, content-hash revision as ETag, 304 on match), `POST /v1/daemon/settings/import` (stores each
  local value only where the key has no revision), `PUT /v1/daemon/settings/projects/:key/mcp`,
  `PUT|DELETE /v1/daemon/settings/project-folders/:key`.
- Remote actions (`routes/machine-command-routes.ts`): owner `POST/GET /v1/machines/:id/commands[/:commandId]`, daemon
  `POST /v1/daemon/commands/:id/start|result` (idempotent; wrong-shaped results stored as failures; pending > 10 min →
  expired).
- The API image now ships `apps/daemon/src/roles/prompts` (`deploy/Dockerfile`, `.dockerignore`) for the prompt
  defaults; without them the web shows "no default" but everything else works.

## Daemon: merge, fallback, cache, import

- `apps/daemon/src/settings/settings-store.ts`: fetch at start, on `settings.changed`, on every stream (re)connect, on
  project changes and hourly; ETag conditional GET; cache `~/.crew/settings-cache.json` (0600) after each good fetch.
  Server unreachable → cached copy; no cache → bundled defaults. Every part is re-validated; an invalid part falls back
  to its bundled default and is reported (`rejected`, e.g. `prompt:qc`, `policy`). Concurrent refreshes coalesce with one
  follow-up fetch (found a race where a change landing during an in-flight fetch was missed).
- `effectiveConfig`: local config with server values on top. Until the one-time import succeeded (state meta
  `settings-imported:<machineId>`), missing server values fall back to the local `config.yaml` values (an unreachable
  server never loosens a machine's own limits); afterwards to the bundled defaults.
- One-time import at start: resources, non-default models, a set `perJobUsd`, non-empty MCP switches and the local
  project folders are uploaded; the server keeps them only where it has none (e.g. the owner's `maxConcurrentJobs: 5`).
  `config.yaml` is kept (local fields; legacy values are no longer read after the import).
- Jobs snapshot settings at start (running jobs keep theirs); `jobs.settings_revision` column; heartbeat reports the
  revision; failure and crash comments name "cài đặt bản <rev>"; the web activity line shows it.
- Server folders are checked on the machine (async read first so a macOS permission prompt does not freeze the daemon,
  then git: must be the repo root); unusable ones are left out (the project's jobs wait) and reported as
  `project_folder:KEY: reason`.
- Remote actions: `remote/machine-commands.ts` re-validates the whitelist, applies the action's time limit and reports a
  scrubbed error. Built-in: pause, resume, inventory refresh, job list, project/assistant release. `crewd doctor` uses the
  effective config; the MCP health fix writes the server setting; `crewd project add|release` writes folders through.

## Web

"Cài đặt hệ thống" (sidebar) with `/settings/prompts`, `/settings/prompts/$name` (Markdown editor with preview,
variables and partials help, diff vs active and vs default, change note, reset), `/settings/rules`, `/settings/models`,
`/settings/machines[/$machineId]` (project folders, resources, machine model map, machine budget),
`/settings/projects[/$projectKey]` (MCP switches from the owning machine's reported servers). Every editor shows the
version in use, keeps history with diff-to-previous and one-click restore, and after a save lists the affected machines
and whether each picked the revision up (heartbeats, polled every 3 s; kept across the editor remount). Machines page:
settings state, "Cài đặt máy" link and an "Điều khiển" panel (pause/resume, health checks with fixes, inventory
re-probe, recent jobs, log tail, release a project or the assistant role). Project settings: disabled MCP summary with
"Sửa MCP", and "Cài BMAD trên máy <owner>".

## Desktop app (gateway)

Setup wizard: server, pairing (writes CPU/RAM-suggested resources for the one-time import), Claude, finish. The only
screen afterwards is "Trạng thái máy": daemon state, settings revision/source, waiting macOS folder prompts, health
summary with "Kiểm tra ngay" and local fixes, the machine's projects with their folder and the folder picker (validates
here, writes through to the server, installs hooks), "Mở trên web" links, start at login, updates, log folder, Terminal
for `claude /login`, re-run setup. Removed: health, jobs, logs, settings and project-settings screens, the create-project
form, the project picker and the resource form (and their IPC). The host serves the desktop-only remote actions (health
checks and fixes — app-level fixes go to the main process, a host restart is refused remotely —, BMAD install, log tail);
the main process keeps a web pause/resume across host restarts.

## Tests

- New: `apps/api/test/settings.test.ts`, `apps/api/test/machine-commands.test.ts`, `apps/daemon/test/settings.test.ts`
  (validation, merge, fallback, cache, 304, import, prompt picked up by a live daemon, folders),
  `apps/daemon/test/machine-commands.test.ts`, `packages/shared/src/settings-schemas.test.ts`,
  `apps/web/src/routes/system-settings.test.tsx`, `apps/web/src/components/machine-control.test.tsx`, web E2E
  `apps/web/e2e/system-settings.spec.ts` (edit a prompt on the web → a running scripted daemon picks it up, the web shows
  it picked up, its next job renders the new prompt).
- Updated: guard/QC policy tests, MCP health-fix tests, failure comment, activity text, desktop host/BMAD/supervisor/IPC
  tests, desktop E2E `onboarding`, `health`, `project-bmad` (rewritten for the gateway; `first-project` and
  `project-settings` removed with their features).
- Results: `pnpm -r typecheck` ok, `pnpm lint` ok, `pnpm -r build` ok, web E2E 24/24, desktop Electron E2E 3/3 (after
  `pnpm --filter @crew/desktop stage`; note `test:e2e --if-missing` reuses a stale stage), unit suites: shared 61, daemon
  226, docs-kit 41, web 111, desktop 42 passed. API 241/242: `daemon-stream.test.ts › GET /v1/stream (owner) › carries
  every event…` fails intermittently and also fails on an untouched checkout of HEAD run the same way (a race on
  `bus.currentSeq`; other agents' worktrees share the same test database), so it is not caused by this change.

## Deviations and notes

- One combined additive migration (`0008_server_settings_and_machine_commands`) instead of one per feature.
- Desktop settings screens were removed rather than edited to write through the daemon (per the scope extension).
- "Projects/assistant from the web, the machine confirms": assignment uses the existing owner assign route; releases are
  remote actions the machine performs itself (`project.release`, `assistant.release`). The desktop project-change request
  flow is no longer used (the owner edits type/UI-test MCP directly); its API routes are untouched (another agent is
  removing TOTP there).
- No TOTP was added anywhere; the release uses a plain confirm dialog.
- The root `e2e/` deploy-stack suite was not run (needs the Docker deploy).

## Left undone / follow-ups

- Docs (written by sonnet subagents, checked): new `docs/flows/server-settings.md` and `docs/flows/machine-control.md`,
  every affected flow doc and `docs/architecture.md` updated, generated blocks regenerated. On a temporary index built
  from HEAD + this change, `crew-docs check --staged` and `--commit-msg` (no trailer) both pass; no protected path is
  touched.
- `VpsClient.requestProjectChange()` has no caller any more (the desktop change-request screen was removed); the API
  change-request flow still works. Remove it, or keep it for a future CLI command — owner's call.
- Phase 2 items (runtime version display, Full Disk Access check in the status view) are not part of this phase.
