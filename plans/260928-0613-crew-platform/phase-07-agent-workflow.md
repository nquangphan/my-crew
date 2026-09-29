---
title: "Phase 7: Agent Workflow"
status: completed
priority: P1
effort: 19h
dependsOn: [6]
---

# Phase 7: Agent Workflow

<!-- Updated: Validation Session 11 - all docs work runs on sonnet: docs-init, plus a docs-update job after every dev and bug run -->

<!-- Updated: Validation Session 9 - MCP servers join the capability inventory and preflight; QC defaults Maestro (mobile) / Playwright (web) -->

<!-- Updated: Validation Session 7 - PM chooses from the machine's real skill inventory; no forced kit; headless rule for interactive skills -->

<!-- Updated: Validation Session 6 - resource hygiene: per-job process tagging, temp dirs, orphan sweep, PM cleanup duty -->

<!-- Updated: Validation Session 1 - all agent-written content in Vietnamese; no default budget -->
<!-- Updated: Red Team 2026-09-28 - dev/QC pairing with bug tickets, legal status paths, docs-init as child ticket, local merge + pre-push gate, injection-safe prompts, scripted lifecycle matrix, docs-first check -->

## Overview

Build the roles on top of the daemon runtime: assistant, PM, dev, docs-update, QC and docs-init. Each role has a prompt file,
a tool scope, a model and effort default, and fixed entry and exit states that `canTransition` allows. This
phase wires the whole ticket lifecycle end to end:

owner request → assistant triage → PM clarify → PM breakdown → dev → docs-update → paired QC (bug loop) → PM accept and local merge → assistant close.

Every step leaves a comment or report in the ticket.

## Key Insights

- The owner-agent conversation *is* the comment thread. `ask_owner` ends the run in `needs_input`. The owner's reply moves the ticket back to `in_progress` on the server and resumes the same session.
- **Owner decision: each dev ticket has one paired QC ticket.** Dev finishes to `done` on its own, with a report and a `head_sha`, and then QC runs. QC files every bug as a new `bug` ticket for dev, with its own paired QC retest. The server caps the chain at 3 cycles.
- **Owner decision: one project is owned by one machine,** so branches, worktrees, sessions and the resource snapshot the PM uses are all local.
- **Owner decision: local merge then push.** Nobody reviews before the push, so the pre-push gate is the safety net: tests, `crew-docs check --range` (R1–R7) and a protected-path diff check.

## Role Contracts

Every status path below is legal under `canTransition('agent', …)`. A test replays each one.

| Role | Trigger | Default model / effort | Path and exit duties |
|------|---------|------------------------|----------------------|
| assistant (triage) | `ticket.assigned` (request) | haiku / medium | `todo→triage`. Pick a project using `get_project_catalog` (owner descriptions only), or `ask_owner`. `create_pm_ticket` with an overview (goal, scope, acceptance hints). Comment the routing. `triage→in_progress` |
| assistant (close) | `children.all_done` on the request | haiku / low | Read the PM report. `submit_report` with a summary and links. `in_progress→in_review`, or `→done` when `autoCloseRequests` is set |
| pm (analyze) | `ticket.assigned` (pm_task) | sonnet / high; opus for large or cross-cutting work | Docs-init gate first (below). `todo→triage`. Read `docs/index.md`, then `crew-docs flow`, then the listed files. Write a detailed requirement comment. When unclear: `ask_owner`. When clear: post "Requirement confirmed" |
| pm (breakdown) | same run once clear | same | `create_subtask` per unit. Each dev subtask gets its paired QC subtask (`pairs_with`, `depends_on`). Each dev and QC subtask requires `complexity` and a one-line `complexityReason` — QC is rated separately on its own testing effort, never copied from dev; the server refuses a subtask missing either field. `model`/`effort` are optional, deliberate overrides of the complexity map, with the override reason in `complexityReason`. Each subtask also has a description, acceptance criteria, `required_skills` (from this machine's inventory; the server validates them), `depends_on`, and the flows touched (saved to `tickets.flows[]`). Comment on the execution plan (parallel groups vs sequence, from the resource snapshot). `triage→in_progress` |
| dev (and bug) | `ticket.assigned` (dev or bug) | no default; from the machine's complexity map keyed by the PM's rating | `todo→in_progress`. Work in the worktree. Docs first. Invoke every `required_skills` entry. Update code and tests, run the tests, and **do not edit or commit docs**. End with `handoff_docs` (files, tests, flows touched, a Vietnamese summary of the change). The ticket stays `in_progress`. A bug ticket inherits its complexity, model and effort from the origin dev ticket the chain started from |
| docs-update | The dev or bug job succeeds with a `handoff_docs` | **sonnet / high (fixed)** | Same ticket and worktree, a new job of kind `docs_update`. Read the handoff and `git diff`, then the affected flow docs (`crew-docs where` for each changed file). Update `docs/flows/*.md` and the non-protected sections of `docs/flows.yaml`, run `crew-docs check --staged`, and commit code, tests and docs together through the hooks. `submit_report` (dev handoff plus the docs changed, commits, `head_sha`). `in_progress→done` |
| qc | `dependency.resolved` (paired dev done) | no default; from the machine's complexity map keyed by the PM's own QC rating | `todo→in_progress`. Worktree at the dev `head_sha`. Run the tests, review the diff **and the accuracy of the docs against the code**. Call `file_bug` once per defect. `submit_report` listing the bugs, or "pass". `in_progress→done`. A retest QC ticket inherits its complexity, model and effort from the QC ticket that filed the bug (for a PM rejection, the rejected ticket's own QC) |
| pm (accept) | `children.all_done` | same as analyze | Verify every acceptance criterion against the reports; reject a skipped required skill unless it was justified. Merge each dev `head_sha` into `crew/<pm-key>` in dependency order, then into the default branch. Run `crew-docs generate` and commit. Push (the pre-push gate runs). Sync docs. `submit_report`. `in_progress→in_review→done`. On a merge conflict, `create_subtask` a dev "resolve conflicts" ticket instead of accepting |
| docs-init | Created by the daemon as a child of the pm_task when `crew-docs check` exits 3 | **sonnet / high (fixed)** | `todo→in_progress`. Follow STANDARD.md, write every file, `crew-docs install-hooks`, `crew-docs ci-workflow`, pass `check --all`, commit with the `Crew-Docs-Init: true` trailer, sync. `submit_report`. `in_progress→done`. Every other subtask of that pm_task `depends_on` it |

**Owner decision (Validation Session 20): the owner can wake the PM from any ticket of its tree.** An owner
comment tagging `@pm` on the pm_task itself or on one of its dev/qc/bug/docs_init subtasks (open or already
closed) wakes only that tree's PM instead of the tagged ticket's own agent — the tagged ticket's status and
assignee are left untouched (a tag on the pm_task itself still answers its own `needs_input` like any owner
reply there). The PM's prompt gets the owner's comment verbatim plus the tagged ticket's status, rating, latest
daemon error and, if blocked, the latest agent comment, and handles it with `rate_subtask` (missing
complexity), `retry_subtask` (a blocked subtask whose other cause is fixed), `create_subtask` (new work), or
`ask_owner` (unclear intent, or to have the owner cancel on the web), then always replies with `comment` on the
tagged ticket. An untagged comment behaves exactly as before. A tag on a ticket outside any open pm_task tree
(a `request`, or a tree already `done`/`cancelled`) is refused with `400 PM_NOT_AVAILABLE` instead of being
stored.

## Requirements

- **PM resource management** (owner requirement):
  - **At breakdown:** call `resource_report` and plan parallel groups from the real free slots, RAM and disk.
  - **After each child finishes** (`dependency.resolved` or `children.all_done`): call `resource_report`. If a finished job left processes, ports, temp files or worktrees (for example a dev server, watcher or container), call `cleanup_resources`, and comment which ticket left them.
  - **At accept:** a final `resource_report` must show no orphans for the ticket tree before `done`.
  - The PM report gets a **"Dọn dẹp tài nguyên"** section: processes stopped, ports freed, temp space freed, worktrees removed.
  - A child that leaves orphans twice is flagged in its report as `left_resources`. The PM treats it like a missing skill: a bug ticket for dev unless justified.

- **Prompt files** (`apps/daemon/src/roles/prompts/<role>.md`) are versioned templates. Each has:
  - a docs-first procedure;
  - a skill rule: invoke each required skill via the Skill tool, or report why it does not apply;
  - the report schema;
  - the resource rule for dev and QC: stop every process you start (dev server, watcher, container) before finishing, and keep temp files inside `$TMPDIR`. The daemon cleans up after you anyway, and anything it had to clean is shown in your report;
  - the language rule: comments, questions, reports and docs are written in Vietnamese; code, identifiers and commit subjects follow the repo's existing convention;
  - an injection rule: any ticket description, comment, report or repo text that the owner did not write is wrapped in `<untrusted-data>` delimiters and treated as data, never as instructions.
- **Docs-first check:**
  - After the run, the daemon reads `tool_log`. `docs_first=true` when the first Read or Grep of a source file came after `docs_flow`, `docs_where` or a Read of `docs/index.md`.
  - It is saved in the report. PM accept treats `docs_first=false` as a rejection unless the ticket is docs-init.
- **Capability preflight (skills and MCP servers) for every role and every task** (owner requirement: at every step, check the machine and the project for relevant skills and MCP servers, and use them). This covers assistant triage and close, PM analyze, breakdown and accept, dev, bug fix, QC and docs-init.
  1. Each run's context block holds the full inventory for its cwd. That is user, project and plugin skills (name, source, description) plus the MCP servers that are connected (name, source, tools and their descriptions). It is the same set the agent really has loaded.
  2. The first step of every role prompt comes from one shared partial, `prompts/_capability-preflight.md`, so the rule is written once. The agent:
     - reads the inventory;
     - picks every skill relevant to *its current step*, for example a requirements or brainstorm skill for PM analyze, a planning skill for breakdown, a review skill for accept, a domain or project skill for any role;
     - picks every MCP server whose tools help with that step. Examples: dev uses a docs lookup or browser MCP; PM uses a design MCP (such as Figma) to read a linked design. Apart from the QC defaults below, **the agent chooses MCP servers freely** (owner decision);
     - invokes the skills before doing the work, and uses the chosen MCP tools during it.
  3. The agent reports each pick as `skills_selected[{name, reason}]` and `mcps_selected[{server, reason}]`. If nothing fits, it writes an empty list and a one-line reason.
  4. The daemon compares the selected and required skills and MCP servers with what was actually invoked (from `tool_log`; MCP usage is any `mcp__<server>__*` call). Anything selected or required but never used goes to `skills_missing` or `mcps_missing` and triggers a warning comment.
- **QC default UI-test MCP** (owner decision; the only MCP default):
  - A **mobile** project's QC tickets get `required_mcps: [maestro]`: drive the app on a simulator or emulator, and write and run Maestro flows for the acceptance criteria.
  - A **web** project's QC tickets get `required_mcps: [playwright]`: drive the app in a browser for the acceptance criteria.
  - A **web+mobile** project gets both. A backend or library project gets none.
  - The server adds the default when it creates the QC ticket, and the PM cannot remove it.
  - If the default server is not connected on the machine, QC comments that, moves to `blocked`, and the app's health check shows the fix. It never silently skips UI testing.
  - QC reports the flows or scripts it ran and attaches their result summary.
  - **Owner decision (Validation Session 22): the UI-test MCP is required only when the diff under QC review changes more than docs.** `diffNeedsUiTest()` treats `git diff --name-only <base>...<head>` (base = the default branch, head = the paired dev report's `head_sha`) as docs-only when every changed path is docs (`isDocsPath()`); a git error, an unknown commit or an empty diff still counts as needing the UI test (conservative default). For a docs-only diff, the pre-run MCP-connectivity gate is skipped, the run's required MCP servers narrow to none (`PlannedRun.requiredMcps`, read by the done-gate and the report fields instead of the ticket's own `required_mcps`, which is left unchanged), and the report must state the fixed reason (`DOCS_ONLY_QC_NOTE`) instead of a UI-test summary.
- **The PM also chooses skills and MCP servers for its subtasks:** at breakdown it sets `required_skills` and, beyond the QC defaults, any extra `required_mcps` for each dev and QC subtask from the same inventory, with a one-line reason each. The dev or QC agent still runs its own preflight and may add more skills, but cannot drop required ones. No kit is forced; picking no skill is allowed when the PM says why, and a skill or MCP server that is not in the inventory, or that is disabled, is rejected by the server.
- **Interactive skills** (skills that normally greet the user or show a menu): the prompt tells the agent to run them headless. It treats the ticket as the approved requirement, and any question goes through `ask_owner`.
- **Skill enforcement:**
  - `required_skills` minus the invoked skills is saved as `report.skills_missing`, and the daemon posts a warning comment.
  - The PM rejects a missing skill unless the dev justified it in a comment. A rejection creates a `bug` ticket for dev, which uses the same loop.
- **Complexity → model map** (per machine):
  - trivial → haiku/low
  - small → sonnet/medium
  - medium → sonnet/high
  - large → opus/high
  - **Owner decision (Validation Session 17): the PM rates every dev and QC subtask, and there is no default model for either.** `complexity` plus a one-line `complexityReason` is required on `create_subtask`; the server refuses a dev or QC subtask missing either one. `model`/`effort` on the subtask are only a deliberate override of this map, with the override's reason in `complexityReason`. The PM re-rates an existing dev/QC/bug subtask in place with the `rate_subtask` tool instead of creating a replacement one.
  - A ticket that reaches a run without a complexity rating (a legacy subtask created before the rating was required) is not given a default model: the run fails through the crash path, and the daemon comments asking the PM to rate it in place with `rate_subtask`. Rating a `blocked` ticket that had no rating moves it back to `in_progress` and it runs again automatically, without the owner unblocking it.
  - **Owner decision (Validation Session 20):** for a subtask `blocked` for a reason other than a missing rating, the PM instead uses `retry_subtask` to move it back to `in_progress`, but only when answering an owner `@pm` call — it is refused outside that.
  - **Owner decision: Fable is not used at all.** `opus` is the strongest selectable model; a legacy ticket that still names `fable` runs on `opus` instead, with a notice comment.
  - The daemon clamps any choice outside the allowlist and comments the change.
- **Docs model** (owner decision): all documentation work runs on `sonnet`. That is the docs-init ticket and every `docs_update` job. The complexity map, the PM and the allowlist clamp never change it, and `model-policy.ts` returns `sonnet` for `docs_init` and `docs_update` regardless of input. The dev model chosen by the PM covers code and tests only.
- **Docs-update job** (owner decision: docs are never written by the dev model):
  - The dev run does not commit. R3 would reject a code commit without its flow docs, so the code stays uncommitted in the worktree until the docs job commits everything in one commit. R3 keeps its meaning and needs no bypass.
  - When the dev job ends successfully with a `handoff_docs` call, the daemon queues a `docs_update` job on the same ticket and worktree. The one-active-job-per-ticket index still holds because the jobs run one after the other.
  - A dev run that ends without `handoff_docs` (and without `ask_owner`) counts as a failed attempt under the failure policy.
  - The guard lets the docs job write only docs (`docs/**` and root Markdown, see the Session 22 decision below). It cannot change code or tests.
  - **Owner decision (Validation Session 22): docs are `docs/**` plus root Markdown files** (`README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, …), except `AGENTS.md` and `CLAUDE.md` (agent config, case-insensitive match). The guard's `isDocsPath()` covers both; only the `docs_update` job may write them, and a `codeOnly` dev/bug run may write neither (the deny message names `README.md` as an example). A docs-only subtask (for example writing the README) is still a normal dev subtask: the dev run makes no code change and calls `handoff_docs` right away, describing in the summary exactly what the docs job must write; the docs job then writes it and commits alone.
  - If the commit fails for a reason the docs job cannot fix within `docs/` (tests, R6, R7), it comments the hook output and the daemon queues a new dev job with that output. This counts against the 2-attempt cap, and the next dev run again ends with `handoff_docs`.
  - The docs job runs the capability preflight and the docs-first check like every other run.
  - QC still reviews the accuracy of the docs against the code; a docs defect is filed as a normal bug, whose fix again goes through a docs-update job.
- **Pre-push gate** (the `pre-push` hook from Phase 5 plus the PM prompt):
  - `testCommand` passes on the merged tree.
  - `crew-docs check --range origin/<default>..HEAD` passes.
  - The diff touches no R6 path without the trailer.
  - On failure: no push, and the pm_task goes to `blocked` with the gate output.
- **Cancellation:** `ticket.cancelled` aborts the ticket's job and removes its worktree. The server has already cascaded to the children.
- **Failure handling:**
  - A runner error, or reaching `maxBudgetUsd` → `blocked`, plus a comment with the error class and cost.
  - The owner unblocks the ticket (`ticket.unblocked`) to resume it.
  - Retry attempts are capped at 2 per job before `blocked`.

## Related Code Files

Create under `apps/daemon/src/roles/`:
- `role-registry.ts`
- `prompts/assistant-triage.md`, `prompts/assistant-close.md`, `prompts/pm-analyze.md`, `prompts/pm-accept.md`, `prompts/dev.md`, `prompts/docs-update.md`, `prompts/qc.md`, `prompts/docs-init.md`
- `prompts/_capability-preflight.md` (shared partial included by every role prompt)
- `model-policy.ts`, `skill-enforcement.ts`, `docs-first-check.ts`, `merge-policy.ts` (local merge, generate, push), `docs-init-gate.ts`, `docs-update-handoff.ts` (queues the docs job after a dev handoff), `failure-policy.ts`, `untrusted-wrap.ts`
- `test/role-contracts.test.ts` (replays every contract path through `canTransition`), `test/model-policy.test.ts`, `test/skill-enforcement.test.ts`, `test/docs-first-check.test.ts`, `test/docs-init-gate.test.ts`, `test/docs-update-handoff.test.ts`
- `test/lifecycle/*.yaml` and `test/lifecycle.test.ts`: `ScriptedRunner` against the real API and daemon, in default CI

Modify:
- `apps/daemon/src/stream/dispatcher.ts`: route events to roles.
- `apps/daemon/src/tools/ticket-mcp-server.ts`: the context block.
- `packages/shared/src/agent-schemas.ts`: subtask plan and report fields.

## Implementation Steps

1. Role registry and prompts (docs-first, skills, untrusted wrapping).
2. Model, failure and merge policies, and the docs-first and skill checks, with unit tests. `model-policy.test.ts` asserts that docs-init and docs-update resolve to `sonnet` for every complexity and PM choice.
3. Assistant triage and close.
4. PM analyze (the `ask_owner` → resume loop), breakdown with dev/QC pairing, and accept with local merge and the pre-push gate.
5. Dev, docs-update and QC flows, with `handoff_docs`, `file_bug` and QC worktrees at `head_sha`.
6. Docs-init gate as a child ticket.
7. Cancellation and cleanup.
8. **Scripted lifecycle matrix** (in CI, no model cost). Scenarios:
   - happy path (every dev and bug ticket runs a `docs_update` job on `sonnet` before `done`, and its single commit holds code and docs)
   - a docs-update commit rejected by R7 in dev code: a new dev job gets the hook output, then docs-update commits
   - capability preflight: for each role (assistant, PM analyze, breakdown, accept, dev, QC, docs-init), the scripted run reports `skills_selected` and `mcps_selected`; a selected skill or MCP server never used is flagged; a QC ticket of a web project gets `playwright` and a mobile one gets `maestro` automatically
   - a dev run that leaves a `nohup` server and temp files: auto-cleaned; PM sees it in `resource_report` and its report lists the cleanup
   - QC finds 2 bugs, retest passes
   - bug loop hits the cycle cap
   - owner cancels mid-dev
   - daemon crash mid-breakdown (no duplicate subtasks)
   - backoff and resume
   - two dev tickets on one flow (merge and generate)
   - a project without docs (docs-init first)
   - a budget or child cap is exceeded
   - the PM rates dev and QC separately (`16-qc-own-rating.yaml`): dev large runs `opus`/high, QC trivial runs `haiku`/low, the bug QC files inherits the dev rating, and the retest inherits the QC rating
   - Invariant after each: no non-terminal ticket is left without an active job, pending owner input, or a scheduled `retry_at`.
9. **Live scenario** (`CREW_LIVE_AGENT_TESTS=1`), on a fixture repo with docs plus a plugin skill:
   - request "add /health"
   - one PM question answered
   - dev, then docs-update, then QC passes
   - local merge and push to a bare fixture remote
   - the assistant closes
   - Assert: reports at every level, `docs_first=true`, docs updated, costs recorded.

## Todo

- [x] Role registry and prompts (docs-first, skills, untrusted data)
- [x] Model, failure and merge policies; docs-first and skill checks
- [x] Assistant flows
- [x] PM flows (clarify loop, breakdown with pairing, accept with local merge and gate)
- [x] Dev, docs-update and QC flows with the bug loop
- [x] Docs-init child ticket gate
- [x] Cancellation
- [x] Scripted lifecycle matrix green in CI
- [x] Live scenario passes

## Success Criteria

- Every run of every role starts with the capability preflight. On a web fixture, QC drives the page through the Playwright MCP, and `mcps_used` shows it. On the live fixture repo, which has a project skill for its domain, the PM analyze run selects and invokes that skill, and its report shows it in `skills_selected` with a reason.

- Every scenario in the scripted matrix passes in CI and satisfies the no-stuck-ticket invariant.
- The live scenario completes with one owner answer as the only manual step. Every ticket in the tree has a report. The request shows the chain of reports.
- A project without `docs/flows.yaml` runs docs-init before any other subtask of that pm_task, and that job's recorded model is `sonnet`.
- Every dev and bug ticket reaches `done` only through a `docs_update` job whose recorded model is `sonnet`, and the dev job itself never writes under `docs/`.
- A dev run that skips a required skill, or reads source before docs, is rejected at PM accept, and that creates a bug ticket.

## Risk Assessment

- **Prompt quality drives outcomes.** Prompts are versioned files, and the live scenario is the regression gate.
- **Runaway cost.** The owner chose no default budget, so the always-on controls are the child cap (Phase 2), the bug-cycle cap, the attempt caps and a spawn depth of 2. Per-job `maxBudgetUsd` and the project budgets apply only when configured.
- **No human review before push (owner decision).** The pre-push gate (tests, R1–R7, protected paths) is mandatory and cannot be skipped by agents, because the guard denies changes to `core.hooksPath` and `--no-verify` pushes are caught by CI.

## Security Considerations

- Text the owner did not write is wrapped as untrusted data. The catalog uses only owner-entered descriptions. Tools stay role-scoped.
- Credentials never leave the machine: R7 in hooks and the MCP scrubber.
