# Phase 7 (Agent Workflow): Implementation Report

Date: 2026-09-29 · Status: done with concerns (see "Left undone") · Scope: `apps/daemon/**`,
`packages/shared/src/**` (additive), `apps/api/**` (four genuine gaps, listed below), `docs/**`
(flows section of the manifest only). Nothing is committed.

## What was built

The role workflow sits on the Phase 6 runtime as the default `RolePlanner` of `createDaemon()`
(`apps/daemon/src/roles/role-planner.ts`, exported as `rolePlanner`). The generic Phase 6 planner stays
available and the Phase 6 runtime tests still use it.

- **Stages and contracts** (`roles/role-registry.ts`). `resolveStage()` picks the step from the ticket, its
  children and the job kind, not from the trigger alone, so a restart, an owner comment or a retry lands on
  the right step: `assistant_triage`, `assistant_close`, `pm_analyze` (stays until a breakdown run finished:
  owner question, cap or crash), `pm_monitor`, `pm_accept`, `dev`, `docs_update`, `qc`, `docs_init`. `STAGES`
  holds each stage's prompt, label and status paths; `role-contracts.test.ts` replays every path through
  `canTransition('agent', …)`. `RoleStage` and `DOCS_MODEL` are new in `@crew/shared`.
- **Prompts** (`roles/prompts/*.md`, rendered by `roles/prompt-templates.ts`). One file per stage plus two
  shared partials: `_capability-preflight.md` (every stage) and `_shared-rules.md` (language, untrusted data,
  headless interactive skills, `ask_owner`, protected paths). Each prompt has a docs-first procedure, the
  report schema where the stage files a report, and the resource rule for dev and QC. A missing variable is
  an error; values are never re-expanded. `scripts/copy-prompts.mjs` copies the templates next to the compiled
  code at build time; `setPromptsDir()` lets a bundling app (Phase 9) point elsewhere. PM runs also get the
  owner's original request verbatim (the pm_task description is the assistant's summary and stays wrapped).
- **Policies**: `model-policy.ts` (docs-init and docs-update always sonnet/high; assistant haiku; PM sonnet,
  opus for a `large` pm_task; dev/QC from the subtask, then the complexity map; clamp to the allowlist with a
  comment), `failure-policy.ts` (two attempts, then blocked; the job budget blocks at once), `skill-enforcement.ts`,
  `docs-first-check.ts`, `untrusted-wrap.ts`, `docs-update-handoff.ts`, `docs-init-gate.ts`,
  `merge-policy.ts`, `workspace-prep.ts`.
- **Capability preflight.** New tool `select_capabilities` (all roles) records picks with reasons on the job;
  picks and reports are checked against the run's inventory. The daemon computes `skills_used`,
  `skills_missing` (required skills counted only from dev runs, plus picks never used), `mcps_used`,
  `mcps_missing`, `docs_first` (over all runs of the ticket, in order) and `left_resources` (processes left
  twice), and posts a warning comment. The "no preflight" warning is per session. QC closes only after every
  required UI-test MCP server was used (`update_status done` is refused otherwise).
- **Assistant**: triage (catalog, `create_pm_ticket`, now with `complexity`), close (report, `in_review` or
  `done` with `autoCloseRequests`).
- **PM**: analyze with the `ask_owner` → resume loop and the docs-init gate; breakdown with dev/QC pairing,
  `resource_report`, and a stop for the owner on `CHILD_CAP_EXCEEDED` / `BUDGET_HOLD`; monitor (woken by the
  daemon when a finished child left processes, ports or containers); accept with `reject_work` (bug ticket
  for dev) and `merge_and_push`.
- **Local merge and pre-push gate** (`merge-policy.ts`, tool `merge_and_push`): acceptance rules
  (`docs_first=false` always refused; missing skills and `left_resources` unless the PM accepts the dev's
  justification), dependency order, merge of the default branch then every dev/bug/docs-init `head_sha` into
  `crew/<pm-key>`, generated-docs conflicts resolved by regeneration, `crew-docs generate` + commit, the gate
  (`testCommand`, `crew-docs check --range`, protected-path check with trailers), push to `origin` through the
  `pre-push` hook, local default branch moved without touching a dirty owner checkout, docs snapshot synced.
  A failed gate comments the output, blocks the pm_task and ends the run; nothing is pushed.
- **Dev → docs-update → QC.** The dev run may not write under `docs/`, `git commit`, file a report or close
  (guard + tools). `handoff_docs` queues a `docs_update` job on the same worktree in a fresh sonnet session;
  it commits code, tests and docs in one commit through the hooks, and the daemon fills `head_sha`/`commits`
  from the worktree (refused while dirty). A refused commit comes back through `return_to_dev` and becomes a
  new dev job carrying the hook output (counts against the attempt cap). Dev/bug worktrees merge the heads
  they build on (finished docs-init, finished dependencies, earlier bugs of the chain). QC starts at the dev
  `head_sha` (Phase 6) and is blocked, without a run, when its UI-test MCP is not connected.
- **Docs-init** as a daemon-created child (sonnet/high) when `crew-docs check` exits 3; the PM waits for it,
  every later subtask depends on it (`create_subtask` adds the dependency). The daemon runs
  `crew-docs install-hooks` in the main checkout (it refuses in worktrees), copies the hook files into the
  docs-init worktree and restores the main checkout; `STANDARD.md` is installed next to crew-docs for the
  prompt.
- **Cancellation**: `ticket.cancelled` names only the root; the daemon now aborts or cancels every local job
  whose ticket is cancelled and removes its worktree.
- **Runtime changes** (`job-runner.ts`, `daemon.ts`, `dispatcher.ts`, `state-db.ts`, …): planner context,
  `skip`/`prepare`/`reportOverlay` hooks, richer after-run decisions, the PM wake-up (`wakeTicket`), owner
  answers resuming the job kind that asked (`resumeKind`), over-budget jobs deferred instead of dropped, new job
  columns with an in-place migration, and server error details in tool errors.

## Tests

- New unit tests: `role-contracts`, `model-policy` (docs stages resolve to sonnet for every complexity, model,
  effort and allowlist), `skill-enforcement`, `docs-first-check`, `docs-init-gate` (real API and bundle),
  `docs-update-handoff`, `role-policies`, `merge-policy` (real git, crew-docs and bare origin: failing tests,
  protected path without trailer, conflicts), a dispatcher routing case, and the QC close guard in
  `ticket-tools`. API: PM rejection in `bug-loop`, capability validation and the request read scope in
  `machine-scope`. Shared: `project-schemas.test.ts`.
- **Scripted lifecycle matrix** (`test/lifecycle.test.ts`, 15 scenarios in `test/lifecycle/*.yaml`, no model
  cost, ~2 min): real API and daemon, role planner, scripted runner, real worktrees, real crew-docs hooks, bare
  origin. Happy path; R7 rejection → new dev job → commit; capability preflight per role (incl. Figma and
  Playwright use, a refused report pick, web/mobile/web+mobile/backend QC defaults); nohup server + temp files
  cleaned, PM woken and the cleanup listed in its report; QC with two bugs; bug-cycle cap; owner cancel
  mid-dev; crash mid-breakdown (no duplicate subtask); backoff and resume; two devs on one flow (generated
  docs conflict regenerated, `check --all` on the pushed head); a project without docs; child cap; budget
  hold (jobs wait queued); QC blocked without its MCP; PM rejection → bug → merge. After each scenario the
  no-stuck-ticket invariant holds.

## Live scenario (`CREW_LIVE_AGENT_TESTS=1`, `test/live-workflow.test.ts`)

Fixture: a small web app with docs and hooks, a project skill `health-endpoints` (tracked `.claude/skills`),
a project Playwright MCP server (`npx @playwright/mcp@0.0.82 --headless`), a bare `origin`, temp crew home,
owner's subscription login, `models.allow: [haiku, sonnet]`, `perJobUsd: 3`. Three attempts, about **$9.9 in
total** (cumulative session costs as recorded by the daemon):

| Run | Result | Cost |
|-----|--------|------|
| 1 | Full chain: triage (haiku) → PM analyze (sonnet) → dev (haiku) → docs_update (**sonnet**, one commit with code, test and `docs/flows/app.md`) → QC (haiku, **drove the page through `mcp__playwright__*`, `mcps_used: [playwright]`**) → PM accept (merge, gate, push) → close (`in_review`). Every report `docs_first=true`; the PM picked **and invoked** `health-endpoints` with a reason. Failed one assertion: the PM never asked the owner, because the owner's "ask me one question" reached it only inside the assistant's (untrusted) summary. Fixed: PM prompts now carry the owner's request verbatim. | ≈ $2.4 |
| 2 | The PM asked exactly one question, the owner answered, the session resumed, dev → docs_update → QC → merge and push to `origin` succeeded. Two defects surfaced and were fixed: every PM report was refused by the server (`McpServerName` rejected `plugin:…`/`claude.ai …` names in `mcps_used`), and the haiku QC closed without using Playwright (QC can no longer close before using its UI-test MCP). The run was stopped once it could only idle. | ≈ $3.7 |
| 3 | One question and answer, dev → sonnet docs job → QC: the new guard refused QC's first `done`, QC then used `browser_navigate` / `browser_run_code_unsafe` and closed. PM accept refused to merge (the dev had picked skills it never used), rejected the ticket through `reject_work`, and the bug fix had passed dev and its sonnet docs job when **the Docker engine on the machine stopped** (Postgres 55432 unreachable), which ended the test. | ≈ $3.8 |

No run completed with every assertion green; together they exercised every step and criterion of the live
scenario at least once (see "Left undone").

## Deviations and decisions

1. **The PM is woken after a child only when the child left something** (processes, ports or containers
   that the end-of-job cleanup had to stop). Waking a sonnet PM after every child just to see an empty
   `resource_report` costs a run for nothing; the cleanup records are the evidence, and the PM checks and
   lists them at accept anyway (the daemon appends a "Dọn dẹp tài nguyên" section when the PM omits it).
2. **Docs-init runs before PM analysis, not alongside it**: the gate creates the child and the PM waits, so the
   PM reads real docs and plans against real flows. Every later subtask still depends on the docs-init ticket.
3. **PM rejections use the bug route** (`POST /v1/daemon/tickets/:id/bugs` on a done dev/bug ticket) instead of
   a new ticket type.
4. **`merge_and_push` is a daemon tool**, so merging, the gate and the push are deterministic and testable;
   the PM decides acceptance and handles conflicts.
5. **Dev/bug worktrees start from the heads they build on** (not only the default branch), otherwise work
   after docs-init or after a dependency would not see it.
6. **Budget holds defer jobs** instead of skipping them (a skipped job was lost after the owner's approval).
7. **New prompt files** beyond the phase list: `pm-monitor.md`, `_shared-rules.md`; new module
   `workspace-prep.ts`; new tools `select_capabilities`, `return_to_dev`, `reject_work`, `merge_and_push`.
8. **`McpServerName` widened** (`:`, spaces, `@`, `/`, up to 200 chars): Claude Code names plugin servers
   `plugin:claude-mem:mcp-search` and connectors `claude.ai Figma`; the old pattern made the server refuse every
   report of a run that had used one (found in the live run).
9. **Request read scope**: the project machine may read (not write) the request above its pm_task, so its PM
   sees the owner's own words even when another machine hosts the assistant.

## Files changed outside `apps/daemon/src/roles/`

- `packages/shared/src/agent-schemas.ts` (`RoleStage`, `DOCS_MODEL`), `machine-schemas.ts`
  (`InventoryMcpServer.disabled`), `project-schemas.ts` (`McpServerName`), new `project-schemas.test.ts`.
- `apps/api/src/services/ticket-service.ts` (`fileBug` serves PM rejections), `machine-service.ts`
  (`assertKnownCapabilities`), `apps/api/src/routes/daemon-routes.ts` (capability validation on ticket and bug
  creation, read scope on `GET /v1/daemon/tickets/:id`), `apps/api/src/auth/machine-auth.ts`
  (`assertTicketReadable`); tests `apps/api/test/bug-loop.test.ts`, `machine-scope.test.ts`.
- `apps/daemon/src/daemon.ts`, `library.ts`, `state-db.ts`, `stream/dispatcher.ts`, `runner/job-runner.ts`,
  `runner/agent-runner.ts`, `runner/scripted-runner.ts`, `runner/guard-hook.ts`, `tools/ticket-mcp-server.ts`,
  `tools/tool-scopes.ts`, `apps/daemon/package.json` (build copies prompts), new `apps/daemon/scripts/copy-prompts.mjs`,
  tests and helpers under `apps/daemon/test/`.
- Docs: `docs/flows.yaml` (flows section: new `agent-roles`, `local-merge`; a test added to `project-claims`),
  new `docs/flows/agent-roles.md`, `docs/flows/local-merge.md`; updated `agent-runs`, `daemon-runtime`,
  `daemon-scheduling`, `daemon-api`, `machine-pairing`, `project-claims`, `ticket-lifecycle`; `docs/index.md`,
  `docs/architecture.md`, generated `docs/files.md`. Written by a sonnet agent and checked against the code.
  `AGENTS.md` needed no change.

## Commit gate

On a temporary index built from `HEAD` plus the full change (90 files, this report included), `crew-docs check --staged`,
`crew-docs check --commit-msg` (plain message, no trailer) and `crew-docs check --all` pass.

## Left undone / notes

- **Not re-run after the last changes because the Docker engine went down at about 04:10 and did not come
  back** (the controller asked the owner; Docker was not touched by this agent):
  - the full daemon suite after the last edits (fixture port moved to 4398, lint formatting). The last full
    daemon run, which already included the QC guard, the error details and the `McpServerName` change, had
    133 passed and 1 failed: `daemon.test.ts › stops what a job started…` with a 60 s hook timeout. That test
    passes alone and in the same file combination afterwards; it looked like contention on the shared
    `crew_daemon_test` database (the Phase 9 worktree uses the same test config).
    `pnpm --filter @crew/daemon test`
  - the full API suite after `assertTicketReadable` and the `McpServerName` widening (the two affected files,
    `machine-scope` and `bug-loop`, passed): `pnpm --filter @crew/api test`
  - one clean live run with every assertion green:
    `cd apps/daemon && env -u ANTHROPIC_API_KEY CREW_LIVE_AGENT_TESTS=1 npx vitest run test/live-workflow.test.ts`
    (≈ 15–20 min, ≈ $3–4).
  - Done without the database: `pnpm lint`, `pnpm -r typecheck`, `pnpm -r build`, web (58), docs-kit (36) and
    shared (16) tests, and the three crew-docs gate checks.
- `plans/` was off limits except this report, so the phase file's todo boxes are unchanged.
- The Phase 6 `realTarget()` in `guard-hook.ts` cuts the first character of a path segment directly under `/`
  (only reachable with a non-existent top-level directory); not changed.
- Live costs are high for the PM (sonnet/high reads a lot): about $1–2.6 per accept run.

## Unresolved questions

- Should a pick the agent made but did not use count as `skills_missing` (it does now, and the PM must accept
  the justification or reject)? In live run 3 this made the PM reject a correct dev ticket whose agent had
  picked two optional helpers it then did not need.
- Should the PM be allowed to put QC on haiku? It did so in every live run; the contract default is sonnet/high.
