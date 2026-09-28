---
title: "Phase 6: Local Daemon Core"
status: todo
priority: P1
effort: 20h
dependsOn: [3, 5]
---

# Phase 6: Local Daemon Core

<!-- Updated: Validation Session 9 - MCP servers join the capability inventory and preflight -->
<!-- Updated: Validation Session 7 - untracked agent config linked into worktrees; PM sees the full skill inventory (no forced kit) -->
<!-- Updated: Validation Session 6 - resource hygiene: per-job process tagging, temp dirs, orphan sweep, PM cleanup duty -->
<!-- Updated: Desktop App 2026-09-28 - see phase 9 -->
<!-- Updated: Validation Session 1 - subscription login per machine, LaunchAgent, nullable budgets -->
<!-- Updated: Red Team 2026-09-28 - PreToolUse guard, one job per ticket, atomic cursor, idempotency, backoff retry_at, SDK-sourced skill inventory, docs-first tracking, scripted runner, keytar removed -->

## Overview

Build `crewd`, a Node service on each local machine. It:
- owns one or more projects, with all their roles, and optionally the assistant;
- pairs with the VPS and keeps the SSE stream with a cursor that is saved atomically;
- turns events into local jobs, one active job per ticket;
- schedules jobs against machine resources;
- runs each job as a Claude Code agent through the Agent SDK `query()`, with guard hooks and the in-process ticket tools.

Phase 7 adds the role behaviour on top.

## Key Insights

- Use `query()` rather than `claude -p` parsing, for typed messages, abort, `resume`, and cost fields (research 01 §2).
- `settingSources: ["user","project","local"]` is **mandatory**, or no skills load. Because that also loads repo `.claude/settings.json`, the agent guard lives in an **inline `PreToolUse` hook**. That hook runs before any settings-based allow rule or permission mode, so repo settings cannot widen permissions (red team #4). Repo config changes are blocked separately by R6 (Phase 5).
- **Owner decision:** agents run as the owner's OS user and may use local credentials (git, gh). The hard rule is that no credential leaves the machine. R7 blocks it in commits and pushes, and the ticket tools scrub it from comments and reports.
- Cost: read the final `result.total_cost_usd`, never a sum. A resumed session already includes earlier spend.

## Requirements

**Config** (`~/.crew/config.yaml`):
- `apiUrl`, `machineName`
- `projects: [{key, repoPath, defaultBranch, testCommand}]`. It is written by the desktop app (Phase 9) or by `crewd project add|create|release`. The folder mapping is local only. Ownership is what the server has bound: a project whose claim is pending is not run until it is approved.
- `resources: {maxConcurrentJobs, minFreeMemGb, maxLoadPerCpu}`
- `models: {allow, complexityMap}`. Config validation rejects an `allow` list without `sonnet`, because docs-init always runs on `sonnet` (Phase 7).
- `budgets: {perJobUsd}`
- `autoCloseRequests` (bool, default false). When true, the assistant moves a finished request straight to `done`; otherwise to `in_review` for the owner.

Claude auth (owner decision) uses **the Claude subscription the owner logged into interactively on each machine** (`claude` then `/login`). `query()` uses the same stored credentials. The daemon must run in the owner's user session so it can read the login Keychain. On macOS it runs inside the desktop app (Phase 9), started by the app's login item. On Linux it runs as a systemd **user** unit reading `~/.claude`. The daemon never sets `ANTHROPIC_API_KEY`, and it strips `ANTHROPIC_API_KEY` from the agent env so billing cannot silently switch to the API. The machine token is stored in the macOS Keychain through the `security` CLI, or in a 0600 file on Linux.

**CLI:**
- `crewd pair --code X`, `start`, `status`, `rotate-token`
- `install-service` (a systemd user unit, for headless Linux; macOS uses the desktop app from Phase 9)
- The runtime is exported as a library, `createDaemon(config)`, which the CLI `start` and the desktop app (Phase 9) both use.
- `doctor` renders the shared health checks (`health/`, defined in Phase 9) and checks the Claude CLI version, and that the subscription login works: a haiku probe `query()` succeeds and does not report API-key billing. It fails when `ANTHROPIC_API_KEY` is present in the service env. It also checks git, `crew-docs`, the repo paths, hook installation and that the service is a LaunchAgent.

**Local state** (SQLite, `~/.crew/state.db`):
- `cursor`
- `jobs(id, ticket_id, role, kind, status, session_id, worktree, model, effort, attempts, retry_at, cost_usd, …)`, with a **partial unique index on `ticket_id` where status is queued, running or backoff**
- `pending_wakeups(ticket_id, event_ids)`
- `tool_log(job_id, seq, tool, target)`

**Stream client:**
- For each event, in **one SQLite transaction**: enqueue the job, or append to `pending_wakeups` when the ticket already has an active job, and advance the cursor.
- Reconnects with jittered backoff and resumes via `Last-Event-ID`.
- Sends a heartbeat every 30 s.

**Dispatcher:** maps events to jobs.
- `ticket.assigned` → a job for the ticket's role.
- `ticket.comment_added` → resume the assignee's session.
- `dependency.resolved` → re-check a waiting job.
- `children.all_done` → PM accept, or assistant close for requests.
- `ticket.reopened` or `ticket.unblocked` → resume the session.
- `ticket.cancelled` → abort and clean up.

**Scheduler:**
- Free slots = `min(maxConcurrentJobs, floor(cpus/2))`, and 0 while `freemem < minFreeMemGb` or `loadavg[0]/cpus > maxLoadPerCpu`.
- A job becomes runnable when all `depends_on` are `done`. It re-checks on `dependency.resolved`, on reconnect, and every 60 s.
- PM and assistant jobs get a reserved slot.
- After a job finishes, its `pending_wakeups` are folded into one follow-up run.
- Before starting, it checks the budget endpoint when the project has budgets set (none by default). Over budget, the job does not start, because the server has already moved the ticket to `needs_input`.

**Restart:**
- A `running` job with a session id is resumed with a prompt telling the agent to check `git status` and the ticket state first.
- A job without a session id starts fresh with a "reconcile, don't recreate" prompt that includes the existing children, comments and report.

**Agent runner** `runAgent({role, cwd, model, effort, prompt, resumeSessionId, allowedTools, maxBudgetUsd, abortSignal})`:
- Calls `query()` with `settingSources`, `permissionMode: 'dontAsk'` and a per-role `allowedTools` (always including the `mcp__<server>__*` tools of every enabled MCP server in the inventory), `mcpServers: {tickets}` (every other MCP server the agent has comes from the loaded settings, see MCP inventory), and `env: {...process.env, CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: '2'}`.
- The `hooks.PreToolUse` guard (`guard-hook.ts`):
  - Denies Edit, Write or NotebookEdit outside `cwd`.
  - Denies writes to protected paths (`.claude/**`, `.githooks/**`, `CLAUDE.md`, manifest exemption sections), except for docs-init.
  - Denies Bash matching `git push --force|-f|+`, `rm -rf` on paths outside `cwd`, or `git config core.hooksPath`. The Bash patterns are best effort; R6 and R7 remain the hard gates.
  - Logs every call to `tool_log`.
- It captures `session_id` from init, the skills listed in init, and the skills invoked (the Skill tool plus `/skill` commands in the log). It records cost, model usage and the result subtype.
- `system/api_retry` with `rate_limit`, `overloaded`, `billing_error` or `account_on_hold` → the job goes to `backoff` with `retry_at = now + min(5 min · 2^attempt, 60 min)`, and a comment is posted. After 4 attempts it goes to `blocked`. There is no retry on top of the CLI's own.
- A `ScriptedRunner` implements the same interface and replays tool calls from a YAML script. It is a test double for CI lifecycle tests (Phase 7), not used in production.

**Ticket MCP server** (`createSdkMcpServer`, Zod tools, role-scoped, every write sends an `Idempotency-Key` = `jobId:toolCallSeq`):
- PM only: `resource_report` returns CPU, RAM, load, free slots, running jobs, live tagged processes per job with their ports and memory, temp dir sizes, worktrees, recent `job_cleanup` rows, Docker containers created by jobs, and free disk. `cleanup_resources` stops the tagged processes of finished jobs, removes their temp dirs, removes worktrees of closed tickets, and stops a reported Docker container on request. It only acts on items `resource_report` listed.
- All roles: `get_ticket` (includes a context block with the machine's resources, running jobs and **the full capability inventory (skills and MCP servers) for this run's cwd**), `list_children`, `comment`, `ask_owner` (comment and `needs_input`, then end the run), `update_status`, `submit_report`, `docs_flow`, `docs_where`.
- `create_subtask`: PM only.
- `file_bug`: QC only, calls `POST .../bugs`.
- `get_project_catalog` and `create_pm_ticket`: assistant only.
- `create_docs_init`: daemon internal.
- Comment and report bodies go through the secret scrubber before sending.

**Skill inventory:**
- Built from the skills list in the SDK `system/init` message, with full namespaced names (e.g. `ak:scout`). Each skill also carries the `description` from its `SKILL.md` frontmatter (user, project and plugin skills alike) and its source: user, project or plugin. The PM chooses skills by reading these descriptions.
- It covers whatever is installed on the machine. No kit is assumed or required.
- Taken from a startup probe `query()` per project, run **inside a probe worktree prepared exactly like a job worktree** (shared paths linked), so the inventory matches what dev and QC really see. It is refreshed from every real run's init.
- Sent with `PUT /v1/daemon/skills` per project.

**MCP inventory** (owner requirement: agents use the MCP servers the machine or project has, e.g. QC uses Maestro for UI tests):
- **Sources:**
  - user-scope servers (`~/.claude.json`);
  - local-scope servers for that project path;
  - project `.mcp.json`;
  - plugin-provided servers;
  - claude.ai connectors available to the logged-in account.
- **What the probe records:** the probe `query()` above records the `mcp_servers` list (name and connection status) and the MCP tool names from the SDK init message. For stdio and http servers it can reach directly, the daemon also lists tool descriptions with an MCP client (`listTools`). Connectors come with names only.
- **Result:** `mcp_servers[{name, source, status, tools[{name, description}]}]` per project, sent with the skills (`PUT /v1/daemon/skills` carries both).
- **Project `.mcp.json` servers need approval to start.** The daemon auto-approves exactly the servers listed in that project's inventory by passing them in the run's settings (`enabledMcpjsonServers`), so headless runs never stall on an approval prompt. [UNVERIFIED] Confirm how the pinned SDK applies project MCP approval in headless mode during step 4.
- The owner can disable a server per project in the app (Phase 9). A disabled server's tools are left out of `allowedTools`.
- Stdio MCP servers started by a run are child processes that carry `CREW_JOB_ID`, so end-of-job cleanup stops them.

**Resource hygiene** (owner requirement: nothing is left running or lying around after a task):
- **Process tagging:** every agent run gets `CREW_JOB_ID=<job-id>` in its env. Every child process inherits it, so dev servers, test watchers, `nohup` and `setsid` processes are all traceable. Each run also starts in its own process group.
- **Per-job temp dir:** `TMPDIR`, `TEMP` and `TMP` point at `~/.crew/tmp/<job-id>/`, so temp files land somewhere the daemon owns.
- **`resource-tracker.ts`:**
  - Finds live processes whose env carries a `CREW_JOB_ID`. It reads `ps -E` on macOS and `/proc/<pid>/environ` on Linux, same OS user only.
  - Maps them to ports with `lsof -iTCP -sTCP:LISTEN -P` and records each one's start time, command and memory.
  - When Docker is present, it records containers created during the job's time window, from `docker ps --filter since=`.
- **End-of-job cleanup,** which runs automatically on every job end (done, blocked, cancelled, crash):
  1. SIGTERM the job's process group and every process tagged with that job id.
  2. After 10 s, SIGKILL anything still alive.
  3. Delete the job temp dir.
  4. Record what was stopped in `job_cleanup(job_id, pids, ports, bytes_freed)`.

  Docker containers are only reported, never stopped automatically. The daemon never touches processes without a `CREW_JOB_ID` tag, so the owner's own dev servers and apps are safe.
- **Periodic sweep** every 10 min and at startup:
  - tagged processes whose job is no longer running (orphans);
  - temp dirs of finished jobs;
  - worktrees of closed tickets.

  Everything found is cleaned the same way and reported in the heartbeat as `resources.orphans_cleaned`.

**Untracked agent config in worktrees** (found on the owner's machine: one project keeps `.claude/` gitignored, so a plain worktree would have none of that project's skills):
- Each project has `sharedPaths`. By default this is auto-detected: every one of `.claude/`, `CLAUDE.md` and `AGENTS.md` that exists in the main checkout but is **not tracked** by git. In the app the owner can add more, such as a folder a skill kit keeps its config in.
- `ensureWorktree` symlinks each shared path from the main checkout into the worktree, so the agent sees the same project skills and config as the main checkout.
- Tracked paths are never linked, because the worktree already has its own copy on the branch.
- The links are added to the worktree's `info/exclude`, so they are never committed.
- The guard hook still blocks agent writes to `.claude/**`. The other shared paths stay writable, because some skill kits write their outputs there.

**Worktree manager:**
- `ensureWorktree(key, base)` reuses an existing worktree or branch, or runs `git worktree add <repo>/.crew/worktrees/<key> -b crew/<key> <base>`.
- QC worktrees are created from the dev report's `head_sha`.
- Cleanup runs on `done` or `cancelled`, plus a sweep of orphaned worktrees at startup.
- `.crew/` is added to `.git/info/exclude`.
- Hooks come from the repo-level install (Phase 5). `doctor` runs `crew-docs install-hooks` when they are missing.

## Related Code Files

Create under `apps/daemon/src/`:
- `cli.ts`, `config.ts`, `secrets.ts` (the `security` CLI and a 0600 file), `state-db.ts`
- `stream/stream-client.ts`, `stream/dispatcher.ts`
- `api/vps-client.ts` (typed, with idempotency keys)
- `scheduler/resource-monitor.ts`, `scheduler/scheduler.ts`
- `runner/resource-tracker.ts`, `runner/job-cleanup.ts`, `runner/agent-runner.ts`, `runner/scripted-runner.ts`, `runner/guard-hook.ts`, `runner/skill-usage.ts`, `runner/retry-classifier.ts`, `runner/secret-scrubber.ts`
- `tools/ticket-mcp-server.ts`, `tools/tool-scopes.ts`
- `skills/skill-inventory.ts`
- `git/worktree-manager.ts`, `git/docs-kit-bridge.ts`
- `daemon.ts` (`createDaemon`), `service/systemd.ts`, `commands/doctor.ts`
- `test/scheduler.test.ts`, `test/dispatcher.test.ts`, `test/stream-atomicity.test.ts`, `test/worktree-manager.test.ts`, `test/guard-hook.test.ts`, `test/stream-client.test.ts` (against the real API `buildApp()` on a test DB)

## Implementation Steps

1. Config, secrets, state DB, pairing, token rotation.
2. VPS client with idempotency, and the stream client with atomic cursor and job writes.
3. Dispatcher with the one-job-per-ticket rule and wake-up folding. Scheduler with resource monitor, dependency re-check, reserved slot and budget check.
4. Agent runner: settings sources, `dontAsk` plus allowedTools, the guard hook, skill and docs-first logging, cost, retry classification with `retry_at`, and abort. Then the scripted runner.
5. Ticket MCP server with role scopes, idempotency keys and the scrubber.
6. Skill inventory probe, the worktree manager, and installing `crew-docs` into `~/.crew/bin`.
7. `doctor`, `status`, `install-service`.
8. Tests:
   - scheduler math and dependency gating
   - dispatcher folding two wake-ups into one run
   - crash between the job insert and the cursor write (neither persists)
   - worktree reuse
   - guard hook: a repo `.claude/settings.json` with `Bash(*)` and write-outside-cwd is still denied; `.githooks` edits are denied
   - stream replay against the real API
   - a live smoke test with `haiku`, gated by `CREW_LIVE_AGENT_TESTS=1`

## Todo

- [ ] Config, secrets, state DB, pairing, rotate
- [ ] Stream client with atomic cursor; dispatcher with one job per ticket
- [ ] Scheduler (resources, dependencies, budget, reserved slot)
- [ ] Resource hygiene: job tagging, per-job TMPDIR, end-of-job cleanup, 10-minute orphan sweep, `resource_report` and `cleanup_resources` tools
- [ ] Agent runner (settingSources, dontAsk, guard hook, logs, cost, backoff)
- [ ] Scripted runner for CI
- [ ] Ticket MCP server (scopes, idempotency, scrubber)
- [ ] Skill inventory probe, worktree manager, crew-docs install
- [ ] doctor, status, install-service
- [ ] Tests, plus the live smoke test

## Success Criteria

- In a repo where `.claude/` is gitignored, a dev job's init message lists the same project skills as the main checkout. A test proves the linked paths never appear in `git status` of the worktree.

- A scripted job that starts `nohup node server.js &` on port 4321 and writes temp files, then finishes: within 15 s the process is gone, port 4321 is free, the temp dir is deleted, and `job_cleanup` lists them. The owner's own untagged process on another port is untouched.

- Kill the daemon at any point and restart it: no event is lost, no ticket gets two active jobs, and repeated tool calls do not duplicate server records (idempotency).
- With `maxConcurrentJobs=2` and 4 independent dev jobs, at most 2 run at once. A job whose dependency is unmet starts within 60 s after `dependency.resolved`.
- The guard test passes even with a planted permissive project settings file.
- The live smoke run lists plugin skills (namespaced) in the inventory and records `total_cost_usd`.

## Risk Assessment

- **SDK or CLI drift.** Pin `@anthropic-ai/claude-agent-sdk`, and `doctor` enforces the minimum CLI version (v2.1.277 or newer for resume cost restore). [UNVERIFIED] The exact init-message field for the skills list, and the `dontAsk` semantics, are to be confirmed against the pinned SDK in step 4.
- **Subscription usage limits** (each machine uses the owner's subscription login). `rate_limit` backoff with `retry_at` makes this visible on the ticket and in the inbox. Official guidance on running one subscription on several machines at once is unconfirmed (research 01), so this is an accepted owner risk.
- **Bash writing outside the worktree.** Same-user execution is an accepted owner risk. R6 and R7 plus the pre-push gate stop the damage from leaving the machine.

## Security Considerations

- The machine token is never in the agent env. Agents reach the VPS only through the scoped MCP tools.
- Secrets are scrubbed from comment and report bodies. R7 blocks credentials in git.
