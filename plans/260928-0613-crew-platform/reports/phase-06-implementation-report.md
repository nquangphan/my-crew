# Phase 6 (Local Daemon Core): Implementation Report

Date: 2026-09-29 · Status: done · Scope: `apps/daemon/**`, `docs/flows.yaml` (the `flows` section only),
`docs/flows/*.md`, `docs/index.md`, `docs/architecture.md`, `docs/files.md` (generated), root `package.json`
and the lockfile. `packages/shared` and `apps/api` are unchanged.

## What was built

`crewd`, the daemon, lives in `apps/daemon/src/`. It is both a CLI and a library (`createDaemon()`).

- **Config, secrets, state** (`config.ts`, `secrets.ts`, `state-db.ts`).
  - `~/.crew/config.yaml` (or `$CREW_HOME`) is validated with zod: `apiUrl`, `machineName`, `machineId`,
    `projects[{key, repoPath, defaultBranch, testCommand, sharedPaths, disabledMcpServers}]`,
    `resources`, `models{allow, complexityMap}`, `budgets.perJobUsd` (null by default) and
    `autoCloseRequests`. An `allow` list without `sonnet` is rejected. Saves are atomic and 0600.
  - The machine token lives in the macOS Keychain through `security -i`. The command goes in on stdin, so
    the token never appears in `argv`. Linux uses a 0600 file, and `CREW_TOKEN_STORE=file` forces the file
    (tests, headless macOS).
  - `~/.crew/state.db` is SQLite (better-sqlite3, WAL, `synchronous=FULL`). It holds these tables:
    - `meta`: the cursor, the token expiry and the cached inventories;
    - `jobs`: `kind agent|docs_update|docs_init`, `status`, `session_id`, `worktree`, `model`, `effort`,
      `attempts`, `retry_at`, `cost_usd`, `model_usage`, `result_subtype`, skills listed and invoked,
      `handoff`, `tool_seq`, `pgid` and more. A partial unique index `jobs_one_active_per_ticket` covers
      `queued`, `running` and `backoff`;
    - `pending_wakeups`, `tool_log` and `job_cleanup`.
- **VPS client** (`api/vps-client.ts`). Every endpoint from the Phase 3 and Phase 5 reports is typed and
  validated with the shared schemas. Transient failures are retried, and writes carry the caller's
  Idempotency-Key.
- **Stream client and dispatcher** (`stream/stream-client.ts`, `stream/dispatcher.ts`).
  - The client resumes with `Last-Event-ID`, reconnects with jittered backoff, and has an idle watchdog.
    Each event is dispatched and advances the cursor inside **one SQLite transaction**. Duplicates below
    the cursor are skipped, and an event type this daemon cannot parse still advances the cursor.
  - These events create a job or wake one: `ticket.assigned`, `comment_added`, `children.all_done`,
    `reopened`, `unblocked` and `dependency.resolved`.
  - One job per ticket: a queued or backoff job absorbs a new event. A running job keeps the event in
    `pending_wakeups`, and `foldWakeups` turns everything waiting into one follow-up run when the job ends.
  - `ticket.cancelled` cancels a queued job and aborts a running one.
  - On `claim.changed` the daemon refreshes its project view, then stops or drops the jobs of a project it
    lost.
  - A heartbeat goes out every 30 s. It carries the resources, the running jobs, `orphansCleaned`, the
    `paused` flag and the Claude runtime version.
- **Scheduler** (`scheduler/scheduler.ts`, `scheduler/resource-monitor.ts`).
  - Free slots = `min(maxConcurrentJobs, floor(cpus/2))`. They drop to 0 when available memory is below
    `minFreeMemGb` or load per CPU is above `maxLoadPerCpu`. Available memory comes from `vm_stat` or
    `/proc/meminfo`, because `os.freemem()` makes a Mac look full.
  - PM and assistant jobs get a reserved extra slot.
  - Before a job starts, the daemon checks that it owns the project and has a local folder for it (a
    pending claim just waits), that the ticket is not closed, that every `depends_on` is `done` (otherwise
    `waitingDeps`), and the budget endpoint.
  - Waiting jobs are re-checked on `dependency.resolved`, on every reconnect and every 60 s. The scheduler
    ticks every 5 s.
- **Restart.** Jobs a previous process left `running` are cleaned up first. A job with a session id is then
  re-queued as `restart_resume`: the prompt tells the agent to check `git status` and the ticket first. A
  job without one becomes `restart_fresh`: a "reconcile, don't recreate" prompt listing the existing
  children, the last comments and the report. A pid lock refuses a second daemon on the same home. A
  graceful `stop()` re-queues running jobs to resume.
- **Agent runner** (`runner/agent-runner.ts`, `runner/job-runner.ts`).
  - `createSdkRunner()` implements
    `runAgent({role, cwd, model, effort, prompt, resumeSessionId, allowedTools, maxBudgetUsd, abortSignal, …})`
    on `query()`. It passes:
    - `settingSources: ['user','project','local']`, `permissionMode: 'dontAsk'` and the role's
      `allowedTools`, which include `mcp__<server>__*` for every enabled inventory server;
    - `mcpServers: {tickets}` and the inline `PreToolUse` guard;
    - `env` with `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2`, `CREW_JOB_ID`, `TMPDIR`/`TMP`/`TEMP` and no
      `ANTHROPIC_API_KEY`;
    - `settings.enabledMcpjsonServers` and `disabledMcpjsonServers`;
    - an own process group, through a detached `spawnClaudeCodeProcess`.
  - From each run it records the session id, the init skills, the skills invoked (Skill tool calls and
    `/commands`), the final `total_cost_usd`, `modelUsage` and the result subtype. An `api_retry` or
    assistant error of class `rate_limit`, `overloaded`, `billing_error` or `account_on_hold` parks the job
    in `backoff` with `retry_at = now + min(5 min·2^attempt, 60 min)` and a comment. The 4th time, the job
    and the ticket go to `blocked`.
  - `JobRunner` runs a job end to end:
    1. plan, through the `RolePlanner` extension point;
    2. prepare the workspace;
    3. run;
    4. decide the outcome;
    5. book the cost once;
    6. commit the terminal status, any follow-up job and the folded wake-ups in one transaction;
    7. clean up;
    8. remove the worktree when the ticket is closed.

    An unexpected error marks the job `failed` instead of leaving it `running`.
- **Guard hook** (`runner/guard-hook.ts`).
  - It denies Edit, Write, MultiEdit and NotebookEdit outside `cwd`, and through a symlink that leads out of
    `cwd` (linked shared paths excepted).
  - It denies writes to protected paths unless the job is docs-init: `.claude/**`, `.githooks/**`,
    `CLAUDE.md`, and R6's wider list (`.husky/**`, lefthook configs, the crew-docs CI files). It also denies
    edits that change the `source`, `shared` or `unassigned` sections of `docs/flows.yaml`.
  - For `docs_update` jobs it denies every write outside `docs/`.
  - In Bash it denies force pushes, `rm -rf` outside `cwd` or the job temp dir, and `core.hooksPath`
    changes.
  - It logs every call to `tool_log`. An allowed call returns *no* decision, so `dontAsk` + `allowedTools`
    still apply after the hook.
- **Scripted runner** (`runner/scripted-runner.ts`). The same interface replays a YAML script (steps `tool`,
  `bash`, `write`, `skill`, `sleep`, `apiError`, `fail` and `crash`) through the real guard, tool log and
  ticket tools. It really runs Bash and writes in the job cwd with the job env. Fake sessions keep a
  cumulative cost and the progress of each job, so resuming the same job after a crash continues after its
  last completed step.
- **Ticket MCP server** (`tools/ticket-mcp-server.ts`, `tools/tool-scopes.ts`).
  - Tools are role-scoped. Every role gets `get_ticket` (with the context block: machine resources, running
    jobs and the full capability inventory for the run's cwd), `list_children`, `comment`, `ask_owner`
    (comment + `needs_input`, then the run ends), `update_status`, `submit_report`, `docs_flow` and
    `docs_where`.
  - The PM adds `create_subtask`, `resource_report` and `cleanup_resources`. QC adds `file_bug`. Dev agent
    runs add `handoff_docs`, which records the handoff on the job and ends the run. The assistant adds
    `get_project_catalog` and `create_pm_ticket`. `createDocsInitTicket` is daemon-internal.
  - Every write goes through `JobWriter`, with Idempotency-Key `<jobId>:<seq>`. The sequence is committed
    only after the server answered, so a write whose answer was lost is re-sent with the same key and
    replayed by the server. Writes of one job are serialized.
  - Comment, question, report, test summary, bug and handoff bodies are secret-scrubbed
    (`runner/secret-scrubber.ts`, mirroring the R7 ruleset).
- **Skill and MCP inventory** (`skills/skill-inventory.ts`).
  - `probeInventory()` opens a real SDK session **without sending a turn**, so it costs nothing. Skills come
    from `initializationResult().commands`: non-built-in commands, with the SKILL.md description and the
    source (project, user or plugin). MCP servers come from `mcpServerStatus()`: name, source, status and
    tools. For stdio, http and sse servers, `createToolLister` adds the tool descriptions over MCP;
    connectors keep names only.
  - The daemon probes each project inside the `_probe` worktree, prepared like a job worktree with the
    shared paths linked. It probes the machine level in `~/.crew/assistant`, then sends `PUT /v1/daemon/skills`.
  - A real run whose init lists a skill the inventory does not have triggers a re-probe.
- **Worktree manager** (`git/worktree-manager.ts`).
  - `ensureWorktree(key, base)` reuses the worktree or the branch, or creates
    `<repo>/.crew/worktrees/<key>` on `crew/<key>`. A QC ticket starts at the paired dev report's
    `head_sha`.
  - `detectSharedPaths` picks each of `.claude`, `CLAUDE.md` and `AGENTS.md` that is untracked, plus the
    owner's extra paths. They are symlinked into the worktree, and tracked paths are never linked. Anchored
    entries in `info/exclude` keep `.crew/` and the links out of `git status`.
  - Worktrees are removed on `done` or `cancelled`, and orphaned ones at startup and in the sweep.
- **crew-docs** (`git/docs-kit-bridge.ts`). At start the bundle is copied to `~/.crew/bin/crew-docs.cjs`,
  with a `crew-docs` wrapper on the agents' `PATH`. The bridge also covers the hook status, `install-hooks`,
  `where` and `flow` calls, and `docsSnapshot()` for `PUT /v1/daemon/projects/:key/docs`.
- **Resource hygiene** (`runner/resource-tracker.ts`, `runner/job-cleanup.ts`, `runner/resource-report.ts`).
  - Every run carries `CREW_JOB_ID`, has its own process group and gets its own `TMPDIR`.
  - The tracker reads `ps -E` (macOS) or `/proc/<pid>/environ` (Linux), for the same user only. A process
    belongs to a job by its tag, by the job's process group, or as a descendant of such a process. Ports
    come from `lsof`, and containers created in the job's time window from `docker ps -a` (report only).
  - End-of-job cleanup runs on every end, including backoff, cancel and failure:
    1. SIGTERM the job's group and every tagged process;
    2. SIGKILL anything still alive after 10 s;
    3. delete the temp dir;
    4. write a `job_cleanup` row.
  - The sweep runs at startup and every 10 min. It stops the tagged processes of jobs this DB knows and
    that are not running, deletes temp dirs, and removes worktrees of closed tickets. The count goes into
    the heartbeat's `orphansCleaned`. Processes without a tag, or tagged by a job this DB does not know,
    are never touched.
  - `ResourceOps` backs `resource_report` and `cleanup_resources`. Cleanup acts only on item ids from the
    latest report that are marked cleanable; containers are stopped only on request.
- **CLI, doctor, service** (`cli.ts`, `commands/doctor.ts`, `health/**`, `service/systemd.ts`).
  - Commands: `crewd pair --code`, `start`, `status`, `rotate-token`, `doctor [--no-fix] [--no-login-probe]`,
    `install-service` (a systemd user unit, Linux only), `project add|create|release` and
    `assistant on|off`.
  - `doctor` renders the shared checks in `health/`:
    - server: reachable, token valid, days to expiry;
    - claude: no `ANTHROPIC_API_KEY`, CLI ≥ 2.1.277, a haiku login probe whose `apiKeySource` must be
      `none`;
    - repos: git, crew-docs installed, each repo path, and the hooks (a missing hook is fixed by running
      `crew-docs install-hooks`, then re-checked);
    - machine: resources, disk ≥ 10 GB;
    - app: the user session on macOS, the systemd user unit on Linux.
- **Library** (`library.ts`, the package `main`): `createDaemon`, config, health, runners, planner types,
  resource ops, the state DB, tool scopes and more (see below).

### Tests

The daemon has 85 tests in 16 files; 3 are live and skipped by default. They run against the real
`buildApp()` on their own database, `crew_daemon_test`, on `crew-dev-postgres`. The global setup creates it
if missing, recreates it from the API migrations and builds the real crew-docs bundle. Worktree tests use
real temp git repos with an isolated git config, and every temp dir and process is cleaned after each test.

- Scheduler: slot math, the reserved slot, dependency gating and re-check, and 4 dev jobs with 2 slots never
  running more than 2 at once.
- Dispatcher: two wake-ups folded into one run, one job per ticket (the index), cancellation, and session
  resume.
- Stream atomicity: a crash between the job insert and the cursor write persists neither.
- Stream client against the real API: disconnect and replay with no loss and no duplicates, and a real
  `ticket.assigned`.
- Worktrees: reuse, branch reattach, QC at a sha, and linked shared paths that never show in `git status`.
- Guard, with a planted permissive `.claude/settings.json` (`Bash(*)`, `bypassPermissions`): write outside
  `cwd` and `.githooks` denied, plus the manifest sections, docs_update scope, symlinks and Bash patterns.
- Daemon end to end with the scripted runner:
  - the `nohup node server.js &` job on port 4321: the process and port are gone, the temp dir deleted and
    `job_cleanup` lists them within 15 s, while the owner's untagged server on 4322 is untouched;
  - a crash mid-run and a restart: no event lost, one active job, no duplicate comments;
  - QC starts at once after `dependency.resolved`;
  - owner reopen and comment resume the same session;
  - rate-limit backoff 5 → 10 → 20 min, then blocked;
  - cancel mid-run;
  - graceful stop and resume;
  - a claim moving away stops the job;
  - inventory probe, heartbeat and pause, assistant jobs, docs tools, docs sync, and QC at `head_sha`.
- Ticket tools against the real API: scopes, scrubbing, `ask_owner`, `handoff_docs`, and a lost response
  re-sent after a restart creating exactly one subtask.
- Units: config, Keychain (via a stub `security`), retry, scrubber, agent runner (a fake `query`), skill
  inventory (a real stdio MCP server for `listTools`), health checks and doctor fix, systemd, CLI (pair,
  project add/create/release, status, rotate).
- **Live** (`CREW_LIVE_AGENT_TESTS=1`, run once): passed.
  - A repo with a gitignored `.claude/` sees the same project skills in the main checkout and in a job
    worktree. There were 17 skills, including 6 namespaced plugin skills (`claude-mem:*`), and 4 MCP servers.
  - The login probe shows `apiKeySource: 'none'`.
  - A haiku job called `mcp__tickets__comment` (allowed), had `git config core.hooksPath` denied by the
    guard, and recorded `total_cost_usd` > 0 on the job and on the ticket through agent-meta.

From the root, `pnpm -r typecheck`, `pnpm -r test` (API 136, web 58, docs-kit 36, shared 13, daemon 82 + 3
skipped), `pnpm lint` and `pnpm -r build` pass. `crew-docs check --all` passes, and so does the full change
checked the way the pre-commit hook runs it (see "Commit gate").

## SDK verification (pinned `@anthropic-ai/claude-agent-sdk` 0.3.283, bundled Claude Code 2.1.283)

1. **Which init field lists the skills.** `SDKSystemMessage.skills: string[]` in `system/init`, with plugin
   skills namespaced (`claude-mem:do`); project skills keep their own names (`ak:scout` here is a project
   skill). `init` is only emitted once a turn starts.
   - `Query.initializationResult().commands` (`SlashCommand {name, description, argumentHint, builtin?}`) is
     available **without a turn**.
   - Each description ends with a source marker: `(project)`, `(user)` or `(claude.ai sync)`. Plugin skills
     have no marker but are namespaced, and Claude Code's own commands have `builtin: true`.
   - The inventory therefore uses the command list (free), and real runs' `init.skills` trigger a
     refresh.
2. **`dontAsk` semantics.** The SDK documents it as "Don't prompt for permissions, deny if not
   pre-approved". Pre-approved means `allowedTools` plus settings allow rules, and settings loaded through
   `settingSources` could widen that, which is why the guard is a hook.
   - A `PreToolUse` hook callback that returns no `permissionDecision` lets the normal flow continue. `deny`
     refuses the call before any rule.
   - The live run confirmed both: the MCP tool listed in `allowedTools` ran, and the guard denied the Bash
     call.
   - The types also accept server-level specs `mcp__server` and `mcp__server__*` (documented for
     `disallowedTools`). The wildcard form for other servers was not exercised live.
3. **MCP approval in headless mode.** Project `.mcp.json` servers **connect in a headless SDK session
   without any approval**, even with an empty `CLAUDE_CONFIG_DIR` (no `enableAllProjectMcpServers`). I
   checked this with a real stdio server and `mcpServerStatus()`, with and without
   `settings.enabledMcpjsonServers`.
   - The daemon still passes `enabledMcpjsonServers` (the inventory's project servers minus the disabled
     ones) and `disabledMcpjsonServers`, so a server the owner switched off does not even start.
   - `mcpServerStatus()` gives tool **names only** (no descriptions), so descriptions come from the daemon's
     own MCP client.
4. **Other findings.**
   - `apiKeySource` is `'none'` on the subscription login. `initializationResult().account` gives
     `subscriptionType` (`Claude Max` here).
   - `total_cost_usd` is cumulative per `query()`, and a resumed session starts from its saved total.
   - User settings hooks (SessionStart) run in probe sessions too.
   - For Phase 9's `[UNVERIFIED]` runtime question: the SDK ships a native Claude Code binary per platform
     (`optionalDependencies` `@anthropic-ai/claude-agent-sdk-darwin-arm64`, …). `pathToClaudeCodeExecutable`
     and `spawnClaudeCodeProcess` are available, and `executable` selects `node | bun | deno` only for a JS
     entry.
   - A `projectConfigRoot` option exists: project settings, `.mcp.json` and the `.claude` trees load from
     the trusted checkout instead of the worktree. It could replace the symlinks for `.claude/`, but not for
     `CLAUDE.md`, `AGENTS.md` or owner-added paths, so it is not used.

## Deviations and decisions

1. **`apps/daemon/src/index.ts` stays the unassigned placeholder.** The manifest's `unassigned` section is
   protected (R6), and the commit must pass without an owner trailer. So the library entry is `library.ts`
   (the package `main`), and `index.ts` is unchanged (`export {};`). The owner should remove the stale
   `unassigned` entry and delete `index.ts` in an approved commit.
2. **Inventory from the command list without a turn**, instead of a paid init turn (SDK finding 1). The
   descriptions come from the same list, and the MCP client adds tool descriptions.
3. **Cost booking.** `submit_report` sends `costUsd: 0`, and the run's cost is booked once at the end through
   agent-meta `costDeltaUsd`. The final cost is only known after the report is sent. For a resumed session
   the delta is the final total minus the most any earlier run of that session booked.
4. **Budget check.** The endpoint is called before every start, because `DaemonProject` carries no budget
   fields. It is one GET per start.
5. **Reserved slot.** PM and assistant jobs may use one slot above the limit, so a full machine can still
   plan and accept. With 0 slots (pressure), nothing starts.
6. **Docker attribution.** `docker ps --filter since=` takes a container, not a time, so containers are
   matched by their `CreatedAt` inside a job's time window.
7. **`info/exclude` is per repository.** Git has no per-worktree exclude file, so the entries go to the
   common dir, anchored and without a trailing slash (a symlink is not a directory to git). An untracked
   `CLAUDE.md` in the main checkout is hidden from its `git status` too.
8. **Process attribution on macOS.** macOS hides the env of platform binaries such as `/bin/sleep`, so a
   process also belongs to a job through its group or ancestry.
9. **Phase 7 boundaries.** The docs-update job after `handoff_docs` is not queued here. `RolePlanner.afterRun()`
   returns `followUp`, which is inserted in the same transaction as the job end, and the wake-ups fold into
   it. The Phase 6 failure policy is minimal: a failed run gets a comment with the error class and cost, and
   the ticket goes to `blocked`.
10. **Additions:** `crewd assistant on|off` (a headless host needs it), `disabledMcpjsonServers`, MultiEdit in
    the guard, R6's wider protected list, `doctor --no-login-probe`, a macOS session check in place of "is
    a LaunchAgent" (on macOS the app runs the daemon, Phase 9), and the `model_usage` column.
11. **Test database and native module.** `crew_daemon_test` is created on the same container, so the API and
    daemon suites never share a database. `better-sqlite3` needs `pnpm.onlyBuiltDependencies` in the root
    `package.json`.

## Interfaces for Phase 7 and Phase 9

- `createDaemon(options)` → `Daemon` offers `start`, `stop` (graceful, re-queues), `halt` (a crash stand-in
  for tests), `pause`, `resume`, `status()`, `events` (`job`, `status`), `updateConfig`, `updateProjects`,
  `refreshProjects`, `refreshInventory(key|null)`, `sweep`, `heartbeat` and `idle`. The options take
  `runner`, `planner`, `query`, `probe`, `health()` (the heartbeat summary), `appVersion`, `tracker`,
  `slots`, `crewDocsSource` and `timings`.
- `RolePlanner { plan(input) → {prompt, model, effort, resumeSessionId, worktreeBase?, appendSystemPrompt?};
  reportFields?(…) → DaemonReportFields; afterRun?(…) → {followUp?} }`. The default is `defaultPlanner`
  plus `chooseModel()`, which pins docs kinds to sonnet/high. `defaultReportFields()` includes a basic
  docs-first check, which Phase 7 can replace.
- Runners: `createSdkRunner()` and `createScriptedRunner({script(run), sessionsDir})`, sharing the
  `AgentRunner` interface. The script format is the `Script` schema, and `ScriptedCrash` stands in for a
  daemon death.
- Tools: `ticketToolsFor(role, kind)`, `allowedToolsFor(...)`, `buildTicketTools(ctx)`, `DocsHandoff` (on
  `jobs.handoff`) and `createDocsInitTicket()`.
- Health: `HEALTH_CHECKS`, `runHealthChecks(ctx, {fix})`, `summarize()` → `HealthSummary`, the types in
  `health/types.ts`, and `doctor()`/`renderHealth()`. Phase 9 adds the mcp, skills, resources and app
  checks.
- Resources: `ResourceOps` / `buildResourceReport()` (the dashboard "Resources" group), `sweepOrphans()`
  and `findOrphans()`.

## Left undone

- The stale `unassigned` entry and the placeholder `apps/daemon/src/index.ts` (decision 1) need an
  owner-approved commit.
- `AGENTS.md` (outside my file list) still calls `apps/daemon` a placeholder.
- Phase 7 work: role prompts, docs-update queueing, model clamp comments, the failure policy with the
  2-attempt cap, and the skill enforcement.
- `plans/` was off limits except for this report, so the phase file's todo boxes are unchanged.

## Unresolved questions

- Should the `_probe` worktree stay between probes (it does now, detached at the default branch) or be
  removed after each probe?
