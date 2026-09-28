# Owner follow-ups (Validation Session 14, decisions 3, 4, 6, 8): Implementation Report

Date: 2026-09-29 · Status: done · Branch: `main`, uncommitted (as asked) · Scope: `apps/api`, `apps/web`,
`apps/daemon`, `apps/desktop`, `packages/shared` (additive), `docs/`.

All four decisions are implemented and tested. The full suite, both E2E suites and the Phase 7 live run pass.
The commit gate passes on a temporary index built from HEAD plus this change, with no approval trailer.

## Decision 3: one dmg per architecture

- `apps/desktop/electron-builder.yml`:
  - the mac target is now `dmg` with `arch: [arm64, x64]`;
  - `dmg.artifactName` is `2P-Crew-${version}-${arch}.${ext}`;
  - the universal-only `x64ArchFiles` is removed.
- `scripts/stage-app.mjs`:
  - the packaging staging folder outside the pnpm workspace is kept;
  - the flag `--universal` is renamed `--both-archs`. It still stages both Claude Code SDK binaries.
- `scripts/package-mac.mjs`:
  - one electron-builder run packs both architectures, so `latest-mac.yml` lists both dmgs;
  - an `afterPack` hook (`keepOnlyArch`) runs before signing. It removes the other architecture's Claude
    Code package and every better-sqlite3 prebuild except the app's own `darwin-<arch>.node`;
  - the hook fails the build if the app's own binary or prebuild is missing.
- Updater (`src/main/updater.ts`):
  - new `dmgAssetName(version, arch)`;
  - the unsigned fallback link now opens this machine's dmg, at
    `…/releases/download/v<version>/2P-Crew-<version>-<arch>.dmg`, instead of the tag page;
  - electron-updater picks the arm64 file by the `arm64` in its name;
  - a test checks that `artifactName` in electron-builder.yml matches `dmgAssetName`.
  - The Settings text now says which dmg to download (arm64 for Apple Silicon, x64 for Intel).
- The signing notes in `docs/flows/desktop-app.md` are updated:
  - both apps are signed and notarized in the same run;
  - `afterPack` runs before signing;
  - Squirrel.Mac needs a per-arch `zip` target once signing is turned on.

### Build results

`pnpm --filter @crew/desktop package:mac` was run on this arm64 Mac. The outputs are in `release/`, which is
gitignored:

| Artifact | Size | Unpacked app |
|---|---|---|
| `apps/desktop/release/2P-Crew-0.1.0-arm64.dmg` | 224 MB (233,209,149 B) | 549 MB |
| `apps/desktop/release/2P-Crew-0.1.0-x64.dmg` | 240 MB (244,474,071 B) | 563 MB |
| `apps/desktop/release/latest-mac.yml` | lists both dmgs | — |

The previous universal dmg was 443 MB (779 MB unpacked).

Each app was checked for its own architecture:

| Check | arm64 app | x64 app |
|---|---|---|
| Main binary and Electron Framework (`lipo`) | arm64 only | x86_64 only |
| Claude Code packages | `claude-agent-sdk-darwin-arm64` only, which reports `2.1.283 (Claude Code)` | `claude-agent-sdk-darwin-x64` only, which reports `2.1.283 (Claude Code)` |
| better-sqlite3 prebuilds | `darwin-arm64.node` only | `darwin-x64.node` only |

Both apps are ad-hoc signed (`TeamIdentifier=not set`), and `codesign --verify --deep --strict` passes.

The desktop Electron E2E (3 specs) passes against three builds:
- the staged app;
- the packaged arm64 app;
- the packaged x64 app, run under Rosetta.

## Decision 4: a machine changes its project's type and MCP mapping only after owner confirmation

- **Storage.** A new table `project_change_requests` stores:
  - the values when the machine asked, the requested values, and the status `pending|approved|rejected`;
  - at most one pending request per project, enforced by a unique partial index.

  It is added by the migration `apps/api/drizzle/0003_project_changes_and_notice_reads.sql`.
- **Service** (`apps/api/src/services/project-change-service.ts`):
  - `requestProjectChange` locks the project.
    - A machine other than the owner gets 403 `FORBIDDEN`.
    - Asking again with the same pending values returns the same `requestId`.
    - Other values while a request is pending get 409 `CONFLICT` with `details.requestId`.
    - Values equal to the project's current ones get 200 `{status:'unchanged'}`.
    - Otherwise it stores a pending row, sends `project.change_requested` to the owner stream (the event is
      also a notice type), and answers 202 `{status:'pending', requestId}`.
  - `decideProjectChange` locks the project first, then the request row, the same order as claims.
    - Only an approval updates `projects.platform` and `ui_test_mcp`, so new QC tickets get the new
      `qcDefaultMcps`.
    - Both decisions send `project.change_decided` to the requesting machine.
- **Routes:**
  - daemon: `POST /v1/daemon/projects/:projectKey/change-requests`. It uses `replyIdempotent`, and the
    Idempotency-Key is required;
  - owner: `GET /v1/project-change-requests?status=` and `POST /v1/project-change-requests/:id/approve|reject`
    with `{code}`. The TOTP is checked and the rate limit is 5/min;
  - `GET /v1/daemon/projects` now returns `pendingChange` for each project.
- **Daemon:**
  - `VpsClient.requestProjectChange`;
  - the dispatcher maps `project.change_decided` to `refresh_projects`, the same as `claim.changed`.
- **Desktop:**
  - new IPC `projects.requestTestSetup` and `ProjectDetail.pendingChange`;
  - host `requestTestSetup()` turns a 403 or 409 into a Vietnamese message;
  - Settings → Projects (`TestSetupSection`) has an editable type select and MCP names, and a "Gửi yêu cầu
    đổi" button;
  - while a request is pending, the fields are locked, the panel shows "Đang chờ chủ dự án xác nhận…", and it
    re-reads the project every 5 s;
  - once the owner decides, it shows "Chủ dự án đã xác nhận…" or "…đã từ chối…".
- **Web inbox:**
  - a new group "Yêu cầu đổi loại dự án cần duyệt", with approve and reject in `TotpDialog`;
  - the badge counts these requests;
  - live invalidation runs on both events.
- **Tests:**
  - API (`test/project-changes.test.ts`, 5 tests): a request stays pending until the owner approves with a
    TOTP, a wrong code gets 401, and QC tickets created after the approval carry the new MCP. A rejection
    notifies the machine, and deciding twice gets 409. A machine that does not own the project, or an unowned
    project, gets 403. Idempotency: a replay, the same values, and different values (409). Also the
    unchanged case, body validation, a missing key, and a machine token on the owner routes;
  - web unit test: approval with a TOTP;
  - web E2E: a machine request is approved in the inbox with a TOTP, and a second one is rejected;
  - desktop host test against the real API: pending state, 409, not the owner, and the project detail after
    approval;
  - Electron E2E (`test/e2e/project-settings.spec.ts`): pick a type in the UI, see the pending text and locked
    fields, approve through the owner API, then see "đã xác nhận" and the new required MCP.

## Decision 6: the `_probe` worktree is kept for 1 hour

- New `apps/daemon/src/git/probe-worktree.ts` with `ProbeWorktreeKeeper` and an injectable `ProbeClock`:
  - `used()` stores the last probe time in the state DB meta (`probeWorktreeUsedAt:<key>`) and arms a 1-hour
    timer;
  - `expire()` removes a worktree that is older than 1 hour or has no recorded time. It never removes one a
    probe is using, and it re-arms a timer for the rest of the hour for younger ones.
- `daemon.ts`:
  - calls `used()` after every project probe. While stopping, it only records the time;
  - `sweep()`, which runs at daemon start and every 10 minutes, calls `expire()`. The removal is not counted
    in `orphansCleaned`;
  - `stop()` and `halt()` cancel the timers;
  - new timings `probeWorktreeTtlMs` and `probeClock`.
- **Tests** (controllable clock): `test/probe-worktree.test.ts` has 4 tests:
  - the worktree is kept for an hour and a re-probe restarts the hour;
  - expiry at start or sweep, and a timer for the rest of the hour;
  - no recorded time, and a busy probe;
  - `stop()`.

  A daemon-level case in `daemon-extras.test.ts` covers a real probe → removed at +60 min → re-probed →
  stopped → a restart removes it.

## Decision 8: inbox read state on the server

- **Storage.** A new table `notice_reads`, keyed by `(owner_id, event_seq)`, in the same migration.
- **Service** (`apps/api/src/services/notice-read-service.ts`):
  - `listOwnerNotices` returns each item with `read`, plus `unread` for the whole history;
  - `markNoticesRead(ids)` ignores ids that are not notices;
  - `markAllNoticesRead(throughId?)`;
  - each mark sends `inbox.read {unread}` to the owner stream.
- **Routes:**
  - `GET /v1/notices` now returns `{items: Notice[], unread}`. This is additive: each `Notice` is an
    `EventEnvelope` plus `read`;
  - `POST /v1/notices/read` takes `{ids}`, 1 to 200 ids;
  - `POST /v1/notices/read-all` takes `{throughId?}`;
  - both need the owner session and CSRF.
- **Web:**
  - `lib/inbox.ts` no longer uses localStorage;
  - opening the inbox marks everything up to the newest shown notice as read, so a notice that arrives
    meanwhile stays unread. Notices that were unread when the page opened keep their dot during that visit;
  - a notice that is still unread on the server shows a "Đã đọc" button;
  - "Đánh dấu tất cả đã đọc" and "N chưa đọc" are shown while any notice is unread;
  - `live-events.ts` refetches notices on `inbox.read`, so other devices update live.
- **Tests:**
  - API (2 tests in `owner-web-support.test.ts`): marking one notice and all notices, `throughId`, a second
    session seeing the same state, the `inbox.read` event, validation, and 401/403;
  - web unit tests: the read-all call on opening with `throughId`, the dots, the per-row button, and live
    invalidation;
  - web E2E: after the desktop page opened the inbox, a second browser context (a phone viewport) sees the
    notices as read. A new notice appears live on both, and reading it on the phone clears it on the desktop.

## Verification

| Check | Result |
|---|---|
| `pnpm lint` | passes |
| `pnpm -r typecheck` | passes |
| `pnpm -r build` | passes |
| `pnpm -r test` | shared 16, web 61, docs-kit 36, api 146, daemon 151 (+4 skipped), desktop 21. All pass; exit 0 |
| `pnpm --filter @crew/web test:e2e` | 8/8 pass |
| Desktop Electron E2E | 3/3 pass, on each of the staged, packaged arm64 and packaged x64 (Rosetta) apps |
| `daemon.test.ts › stops what a job started…` | did not time out in this full run (the daemon suite took 241 s) |
| Phase 7 live scenario (`CREW_LIVE_AGENT_TESTS=1 … test/live-workflow.test.ts`) | passed in 751 s |
| `crew-docs check --all` | ok |
| On a temporary index (`GIT_INDEX_FILE`) from HEAD plus every file of this change except `plans/260928-0613-crew-platform/plan.md`: `check --staged` | ok |
| Same index: `check --commit-msg` with a plain message and no trailer | ok |

### Phase 7 live run

- The cost was **$2.70**, read from the test DB after the run:

  | Ticket | Model | Cost |
  |---|---|---|
  | AST-1 | haiku | $0.23 |
  | WEB-1 (pm) | sonnet | $1.72 |
  | WEB-2 (dev) | sonnet | $0.54 |
  | WEB-3 (qc) | haiku | $0.20 |

  The run's console output is not kept for a passing test, so the figures come from `tickets.cost_usd`.
- QC ran on **haiku** again, which is the fourth run where this happens (decision 2, "to check later").

## Docs

A sonnet subagent wrote the Vietnamese flow docs. I checked them against the code and fixed two points myself:
- the prebuild pruning now keeps only `darwin-<arch>`;
- a wrong step reference.

What changed:
- `docs/flows/` pages: agent-workspace, api-platform, daemon-api, daemon-runtime, daemon-scheduling,
  desktop-app (packaging and signing notes), desktop-ui, event-delivery, machine-pairing, project-claims,
  web-admin and web-shell;
- `docs/architecture.md`: the new tables, and per-arch dmgs;
- `docs/flows.yaml`, flows section only:
  - project-claims: `project-change-service.ts` and its test;
  - event-delivery: `notice-read-service.ts`;
  - api-platform: migration 0003;
  - agent-workspace: `probe-worktree.ts` and its test;
  - desktop-ui: the new E2E spec;
- `docs/files.md` was regenerated.

## Suites not run

None. Every requested suite ran, and so did the desktop Electron E2E.

## Notes and things left undone

- The signed auto-install path still has no zip. Squirrel.Mac installs from a zip, and the build makes only
  dmgs, as Phase 9 did. The unsigned flow works: `latest-mac.yml` exists, so the updater can find new versions,
  and the link opens this machine's dmg. When signing is turned on, add a per-arch `zip` target; this is in the
  signing notes. I did not add it now, because it adds release assets and nothing uses it until the build is
  signed.
- The owner can still approve a project change after the requesting machine has lost the project. It applies,
  because the owner is the authority, like `PATCH /v1/projects/:id`. Pending change requests are not withdrawn
  when a claim moves or a machine is revoked.
- A daemon test found an existing race: stopping a daemon while its SSE stream is still connecting can leave
  the test server unable to close. The new test waits for `connected` before stopping. The daemon code was
  not changed for this, and it may be related to the earlier flaky `stops what a job started…`.
- `plans/260928-0613-crew-platform/plan.md` has uncommitted changes (Session 14) that are not mine. They were
  left out of the gate check index.
- The old universal dmg from Phase 9 is no longer in `apps/desktop/release/`. It was replaced by this build's
  outputs.

## Unresolved questions

- Should a pending project change be withdrawn automatically when the requesting machine loses the project
  (claim moved, release, revoke)?
- Add the per-arch `zip` target now, so the release assets are ready before the Developer ID signing, or
  together with signing?
