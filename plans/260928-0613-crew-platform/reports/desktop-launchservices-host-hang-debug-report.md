# Desktop 0.1.1: daemon host never ready when launched through LaunchServices

Date: 2026-09-29 (Asia/Saigon). Base: `main` @ 9a0545c (0.1.1 candidate). Changes uncommitted.

## Executive summary

The host did not crash and no module failed to load. It was blocked **inside `new HostService()`**, before
`post({kind:'ready'})`. The constructor ran `repairBrokenHooks()`, which calls `git config --get …`
synchronously (`execFileSync`, no timeout) with the cwd set to each project repo. Those repos live under
`~/Documents/projects/…`, a folder protected by macOS privacy controls (TCC). When the app is launched
through LaunchServices it is its own TCC "responsible process". The app is ad-hoc signed, so the 0.1.1
rebuild has a new cdhash. The Documents grant the owner gave 0.1.0 at 11:09 no longer matched, and macOS
showed a fresh "allow access to Documents" prompt. Nobody answered it, so git blocked in `getcwd()`, the
host's event loop froze, `ready` never arrived, and every IPC call timed out after 15 s. When the binary is
exec'd from a terminal, the terminal is the responsible process and already has the permission, so nothing
blocks. `repairBrokenHooks()` already ran in the constructor in 0.1.0 (7f5a6be). The trigger for this
incident was the signature change, not new code.

Fix: the host reports ready before any disk or repo work. Synchronous repo git waits asynchronously for
folder access (on a libuv worker thread, never the event loop). Failures are now visible: host stdio goes
to app.log, crash handlers are registered before any library loads, and a host that never reports ready
is killed and restarted.

## Evidence chain

| Time (+07) | Evidence |
|---|---|
| 11:09:04 | tccd: `Failed to match existing code requirement for subject com.2p-solutions.crew and service kTCCServiceSystemPolicyDocumentsFolder`, then `AUTHREQ_PROMPTING msgID=30621.82`. At 11:09:07, `AUTHREQ_RESULT authValue=2` (allowed). This is why 0.1.0 worked. |
| 12:25:00 | 0.1.1 via `open`: `AUTHREQ_PROMPTING msgID=37086.2`, accessing binary `/opt/homebrew/…/git`. **No AUTHREQ_RESULT ever.** app.log shows `daemon-host starting`, then 15 s IPC timeouts. |
| 12:27:25 | Direct exec: host `running` after 1 s, `daemon-started` at 12:27:37. |
| 12:32:01 | Another PROMPTING (pid 51861 = a blocked `git config`). |
| 12:33:15 | Instrumented copy (`trace0.js` imported first plus body markers, launched with `open -a`): markers reach `body-start` and `prompts-set`, but never `service-built`. The 5 s `alive` timer never fired (JS thread blocked). Host fds 0-2 = `/dev/null`, cwd `/`. |
| 12:33:40 | Host's only child: `git config --get crew-docs.runtime`, cwd `~/Documents/projects/2ps-landing`. `sample`: `main → init_git → strbuf_getcwd → __getcwd → open`. |
| 12:34 | `kill -TERM` on that git: the host immediately blocks in the next one (`git config --get crew-docs.bundle`), so a bounded or asynchronous wait is effective. |
| now | A UserNotificationCenter window at layer 8 was on screen (the unanswered consent dialog). |

Hypotheses eliminated with evidence:
- **Module-evaluation error or EPIPE on closed stdio.** Markers passed module evaluation, and no `early-uncaught` or `exit` marker appeared. stdio was `/dev/null` (writes succeed there).
- **`ready` posted but lost.** The `before-ready` marker was never reached.
- **Environment, cwd, or quarantine.** The controller's `env -i`/cwd=`/` direct-exec runs worked. The app has no quarantine attribute (`com.apple.provenance` only). The only difference between the working and failing launches was the TCC responsible process.

## Changes (apps/desktop, docs)

- `src/daemon-host/index.ts`: now only the entry. It registers `uncaughtException`/`unhandledRejection` first, then `import()`s `host-main.ts`, so the handlers exist before any bundled library evaluates (the entry is 0.8 kB). A load error is written with `writeSync(2, …)` and the process exits 1. `writeSync` is needed because a verified run showed that on macOS a `process.stderr` pipe write is lost when `process.exit` follows.
- `src/daemon-host/host-main.ts` (`runHost`): the former host body. It posts `ready`, then runs `void service.start()`.
- `src/daemon-host/host-service.ts`: the constructor does no I/O. `start()` runs `installShippedCrewDocs`, then `repoAccess()`, then `repairBrokenHooks`. `startDaemon()` awaits `repoAccess()` first.
- `src/daemon-host/folder-access.ts` + `HostContext.repoAccess()`: an async `readdir` of each repo folder, one at a time and memoized per folder. app.log gets `folder-access-waiting` (after 5 s, with an "Allow" hint) and `folder-access-resolved`. `HealthOps.run()` also awaits it.
- `src/main/daemon-supervisor.ts`: `readyTimeoutMs` (30 s) emits `ready-timeout`, kills the host and restarts it with backoff. `lastExit` becomes "không báo sẵn sàng sau 30 giây…". There is a SIGKILL escalation (`forceKill`, after 5 s) that applies only to a host that never reported ready. `host.startDaemon` gets a 30 min timeout, because the first start may wait on the prompt.
- `src/main/index.ts`: the host is forked with `stdio: 'pipe'`. Its lines go to app.log as `host-stdout`/`host-stderr` (via `lineSplitter` in `app-log.ts`), and ready timeouts are logged as `daemon-host-ready-timeout`.
- `scripts/smoke-packaged.mjs` (`pnpm --filter @crew/desktop smoke:mac`): launches the packaged app through `open -n` (stdio `/dev/null`) with a throwaway `CREW_HOME`/userData and asserts the host reaches `running`.
- Docs: `docs/flows.yaml` (desktop-app files/tests), `docs/flows/desktop-app.md` (written by a sonnet subagent and checked against the source), and `docs/files.md` (generated).
- Tests: supervisor ready-timeout with SIGKILL escalation, plus "a ready host is never force-killed"; host-service "the constructor touches no repo; repair happens after `start()`"; `folder-access.test.ts`; `lineSplitter`.

## Verification

- Gate: `pnpm -r typecheck`, `pnpm -r test` (all packages pass; desktop 41 tests), `pnpm lint`, `pnpm -r build`, and desktop Electron E2E 5/5 (restaged). `crew-docs check --staged` and `--commit-msg` both pass on a temporary index with no trailer.
- Packaged app via `open -a` with the Documents prompt pending, 4 runs (12:45:07, 12:46:00, 12:46:16, 13:26:12): the host went from `starting` to `running` in 0.17–0.21 s. `app.info` took 93–203 ms. `folder-access-waiting` appeared at +5 s, and the host stayed idle and responsive with no git children. Quitting while waiting exits cleanly (code 0, about 3 s).
- Direct exec (12:46:36): `running` after 0.29 s. `crewd started` at 12:46:40.221 and `stream connected` at .306, about 3 s after ready (before the fix it took about 10 s).
- Fault injection on a scratch copy: (A) a load error in the host chunk was logged as `host-stderr` lines, including the first host after the `writeSync` change, then exit 1 and restarts after 1 s and 2 s. (B) A host blocked before `ready` produced `daemon-host-ready-timeout` at exactly 30 s, a stop, and a restart.
- `smoke:mac` passed twice (about 4 s each).
- Final build installed in `/Applications`, launched with `open -a` at 13:26:12, and left running. The host was `running` after 0.2 s and waited for the Documents prompt, logging `folder-access-waiting` at 13:26:17. The owner clicked Allow, and at 13:42:59 app.log shows `folder-access-resolved` (ms 1007204, error null). The same host (pid 72661, no restart) then logged `daemon-started` at 13:43:02.544, and daemon.log shows `crewd started` (06:43:02.539Z) and `stream connected` (06:43:02.843Z). The 16.8 min wait exceeded the old 120 s request timeout, so the 30 min `host.startDaemon` bound is what kept `daemonStarted: true` correct.

## Recurrence prevention

- Monitoring gap closed: host stderr, early crashes, ready timeouts and permission waits now all land in app.log.
- Design flaw closed: readiness no longer depends on repo I/O, and synchronous repo git always waits for folder access asynchronously first.
- Root trigger remains: ad-hoc signing makes every update re-prompt for Documents access, and the login-item start will show the dialog at login after each update. Real fix: Developer ID signing (stable designated requirement; `isDeveloperIdSigned` already exists for the updater). This is the owner's decision (certificate and cost). A stable ad-hoc requirement (`-r 'designated => identifier …'`) would also keep the grant, but any binary claiming that identifier would inherit it, so it is not recommended.

## Unresolved / open

1. Other user-initiated host methods (hooks.list, projects.*) still run synchronous git without the access gate. That is only relevant while a prompt is pending after startup. Not changed, to keep scope tight.
2. The renderer logs `unhandled-rejection` when `health.get` fails (a renderer issue that predates this change and was not touched).
