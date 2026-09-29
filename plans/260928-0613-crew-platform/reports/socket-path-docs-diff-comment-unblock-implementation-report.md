# Implementation report: short job temp dir, own-commit docs-only check, comment unblocks

Date: 2026-09-29 (Asia/Saigon). Source: plan.md Validation Session 24. Status: implemented, not committed.

## 1. Short per-job temp dir and `PWTEST_SOCKETS_DIR` (daemon)

- `homePaths(home).tmp` is now `jobTmpRoot(home)` = `/tmp/crew-<uid>/<first 8 hex of sha256(home)>`
  (`apps/daemon/src/config.ts`). The root is outside `~/.crew` and has a fixed length. One root per OS user
  and daemon home means a test daemon never sweeps the real daemon's dirs.
- A job's dir is `<root>/<first 8 chars of the job id>` (`jobTmpTag`/`jobTmpDir`), with a `pw/` sub-dir.
  `ensureJobTmpDir` creates both with mode 0700. `ensurePrivateDir` refuses a dir that is a symlink, is not
  owned by the user, or grants group/other access, because `/tmp` is world-writable
  (`apps/daemon/src/runner/job-cleanup.ts`).
- The job env sets `TMPDIR`/`TMP`/`TEMP` to the job dir and `PWTEST_SOCKETS_DIR=<job dir>/pw`
  (`job-runner.ts`). MCP servers spawned by the agent inherit it.
- Sweep and `resource_report` map a short dir name back to its job with `StateDb.getJobByIdPrefix`, and still
  report it as `tmp:<full job id>`. Dirs under the daemon's own root with no known job are still deleted.
- Daemon start calls `ensureTmpRoot` and deletes the legacy `<home>/tmp`. Daemon stop removes the root when it
  is empty.
- Worst-case socket path: `/private/tmp/crew-4294967295/xxxxxxxx/xxxxxxxx/pw/` + a 40-byte name is 91 bytes.
  A test asserts it is under 100 bytes.

## 2. The QC docs-only check looks at the ticket's own commits

`diffNeedsUiTest(repo, defaultBranch, head, builtOn)` in `apps/daemon/src/roles/role-planner.ts`:

- It takes the commits on `head`'s first-parent line that are not reachable from the default branch or from
  `builtOn`. `builtOn` holds the heads of the finished sibling dev/bug/docs_init tickets, except the paired
  ticket. A head that already contains `head` is ignored.
- It reads each commit's files with `git diff-tree --cc`. A clean merge of a base head adds nothing. A
  conflicted merge that the docs job concluded together with code counts.
- This is normally `head^..head`. A later docs-only re-commit does not hide the code commit.
- It falls back to "UI test required" on a git error, an unknown commit, no own commit or an empty change.

I chose this over a plain `head^..head` because of how the daemon merges base heads. It uses a plain
`git merge`, which fast-forwards onto the docs-init commit. It can also leave a conflicted merge for the docs
job to conclude. A plain `head^..head` would give a false "docs-only" after a docs-only re-commit.

## 3. An owner comment on a blocked ticket unblocks it

- `addComment` → `unblockByComment` in `apps/api/src/services/ticket-service.ts`. An owner comment without
  `@pm` on a `blocked` ticket moves it to `in_progress` and emits `ticket.status_changed` and
  `ticket.unblocked`, then `ticket.comment_added`. The daemon absorbs both into one job with trigger
  `ticket.unblocked`, and the prompt tells the agent to read the latest comment.
- Decision: a comment tagged `@pm` on a blocked ticket does not unblock it. It only wakes the PM, which decides
  (for example with `retry_subtask`). The web hint is hidden while the text tags `@pm`. `needs_input`
  behaviour is unchanged.
- Web: `CommentComposer` has a new `unblocks` prop. `TicketView` passes it for `blocked` tickets. The prop
  shows the hint "Bình luận sẽ mở chặn ticket", linked with `aria-describedby`.

## Tests

- New tests:
  - `resources.test.ts`: "short per-job temp dirs" (path length, 0700, unsafe-root refusal, report/sweep).
  - `role-policies.test.ts`: the own-commits cases (docs-init plus a README-only commit gives docs-only; a src
    commit, a docs re-commit, a conflicted merge, bug chains).
  - API `lifecycle-effects.test.ts` and `pm-mention.test.ts`.
  - Daemon `pm-mention.test.ts`: an unblock run carries both events.
  - Web `comment-thread.test.tsx` and `ticket-view.test.tsx`.
- Tests I adjusted:
  - `daemon.test.ts`: the temp root is removed on stop.
  - `health-groups.test.ts`: uses `jobTmpDir`.
  - `daemon-extras.test.ts`: asserts `PWTEST_SOCKETS_DIR`.
  - Daemon `pm-mention.test.ts`: the "skipped untagged wake-up" case now uses `in_review`, because a blocked
    ticket is now unblocked.
- Gates:
  - `pnpm -r typecheck`, `pnpm lint`, `pnpm -r build`: pass.
  - `pnpm -r --workspace-concurrency=1 test`: all pass. I ran it on dedicated `crew_s24_*_test` databases,
    because another session's worktree tests were wiping the shared `crew_test`/`crew_daemon_test` mid-run.
    Those databases have been dropped.
  - Web E2E: 20 passed. Desktop Electron E2E: 6 passed, after restaging `.stage/app` with the current build.
  - `crew-docs check --staged` and `--commit-msg` (no trailer): ok, on a temporary index built from HEAD plus
    this change, excluding plan.md.

## Docs

The sonnet subagent wrote the Vietnamese updates, and I checked them against the code:

- `docs/flows/`: resource-hygiene, agent-runs, daemon-runtime, daemon-health, agent-roles, ticket-lifecycle,
  web-tickets.
- Short notes in phase-06 and phase-07.
- `crew-docs generate`: no change (no new files).

## Concerns

- The first start of the new daemon deletes the owner's `~/.crew/tmp` (temp dirs from older versions). The
  pid lock guarantees they belong to that daemon.
- The QC prompt still tells the agent to review `git diff <default>...HEAD`. That diff includes the docs-init
  commit. Only the UI-test gate changed.
