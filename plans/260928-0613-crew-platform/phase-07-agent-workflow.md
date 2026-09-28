---
title: "Phase 7: Agent Workflow"
status: todo
priority: P1
effort: 17h
dependsOn: [6]
---

# Phase 7: Agent Workflow

<!-- Updated: Validation Session 11 - docs-init runs on a fixed model: sonnet -->

<!-- Updated: Validation Session 9 - MCP servers join the capability inventory and preflight; QC defaults Maestro (mobile) / Playwright (web) -->

<!-- Updated: Validation Session 7 - PM chooses from the machine's real skill inventory; no forced kit; headless rule for interactive skills -->

<!-- Updated: Validation Session 6 - resource hygiene: per-job process tagging, temp dirs, orphan sweep, PM cleanup duty -->

<!-- Updated: Validation Session 1 - all agent-written content in Vietnamese; no default budget -->
<!-- Updated: Red Team 2026-09-28 - dev/QC pairing with bug tickets, legal status paths, docs-init as child ticket, local merge + pre-push gate, injection-safe prompts, scripted lifecycle matrix, docs-first check -->

## Overview

Build the roles on top of the daemon runtime: assistant, PM, dev, QC and docs-init. Each role has a prompt file,
a tool scope, a model and effort default, and fixed entry and exit states that `canTransition` allows. This
phase wires the whole ticket lifecycle end to end:

owner request → assistant triage → PM clarify → PM breakdown → dev → paired QC (bug loop) → PM accept and local merge → assistant close.

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
| pm (breakdown) | same run once clear | same | `create_subtask` per unit. Each dev subtask gets its paired QC subtask (`pairs_with`, `depends_on`). Each subtask has a description, acceptance criteria, `complexity`, `model`, `effort`, `required_skills` (from this machine's inventory; the server validates them), `depends_on`, and the flows touched (saved to `tickets.flows[]`). Comment on the execution plan (parallel groups vs sequence, from the resource snapshot). `triage→in_progress` |
| dev (and bug) | `ticket.assigned` (dev or bug) | from subtask | `todo→in_progress`. Work in the worktree. Docs first. Invoke every `required_skills` entry. Update code, tests and flow docs, and commit through the hooks. `submit_report` (files, commits, `head_sha`, tests). `in_progress→done` |
| qc | `dependency.resolved` (paired dev done) | sonnet / high; opus/xhigh when security sensitive | `todo→in_progress`. Worktree at the dev `head_sha`. Run the tests, review the diff **and the accuracy of the docs against the code**. Call `file_bug` once per defect. `submit_report` listing the bugs, or "pass". `in_progress→done` |
| pm (accept) | `children.all_done` | same as analyze | Verify every acceptance criterion against the reports; reject a skipped required skill unless it was justified. Merge each dev `head_sha` into `crew/<pm-key>` in dependency order, then into the default branch. Run `crew-docs generate` and commit. Push (the pre-push gate runs). Sync docs. `submit_report`. `in_progress→in_review→done`. On a merge conflict, `create_subtask` a dev "resolve conflicts" ticket instead of accepting |
| docs-init | Created by the daemon as a child of the pm_task when `crew-docs check` exits 3 | **sonnet / high (fixed)** | `todo→in_progress`. Follow STANDARD.md, write every file, `crew-docs install-hooks`, `crew-docs ci-workflow`, pass `check --all`, commit with the `Crew-Docs-Init: true` trailer, sync. `submit_report`. `in_progress→done`. Every other subtask of that pm_task `depends_on` it |

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
  - Fable only when the PM justifies needing whole-repo context.
  - The daemon clamps any choice outside the allowlist and comments the change.
- **Docs model** (owner decision): a docs-init ticket always runs on `sonnet`. The complexity map, the PM and the allowlist clamp never change it, and `model-policy.ts` returns `sonnet` for `docs_init` regardless of input. Dev and bug runs still update flow docs inside their own run, on the ticket's model.
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
- `prompts/assistant-triage.md`, `prompts/assistant-close.md`, `prompts/pm-analyze.md`, `prompts/pm-accept.md`, `prompts/dev.md`, `prompts/qc.md`, `prompts/docs-init.md`
- `prompts/_capability-preflight.md` (shared partial included by every role prompt)
- `model-policy.ts`, `skill-enforcement.ts`, `docs-first-check.ts`, `merge-policy.ts` (local merge, generate, push), `docs-init-gate.ts`, `failure-policy.ts`, `untrusted-wrap.ts`
- `test/role-contracts.test.ts` (replays every contract path through `canTransition`), `test/model-policy.test.ts`, `test/skill-enforcement.test.ts`, `test/docs-first-check.test.ts`, `test/docs-init-gate.test.ts`
- `test/lifecycle/*.yaml` and `test/lifecycle.test.ts`: `ScriptedRunner` against the real API and daemon, in default CI

Modify:
- `apps/daemon/src/stream/dispatcher.ts`: route events to roles.
- `apps/daemon/src/tools/ticket-mcp-server.ts`: the context block.
- `packages/shared/src/agent-schemas.ts`: subtask plan and report fields.

## Implementation Steps

1. Role registry and prompts (docs-first, skills, untrusted wrapping).
2. Model, failure and merge policies, and the docs-first and skill checks, with unit tests. `model-policy.test.ts` asserts that docs-init resolves to `sonnet` for every complexity and PM choice.
3. Assistant triage and close.
4. PM analyze (the `ask_owner` → resume loop), breakdown with dev/QC pairing, and accept with local merge and the pre-push gate.
5. Dev and QC flows, with `file_bug` and QC worktrees at `head_sha`.
6. Docs-init gate as a child ticket.
7. Cancellation and cleanup.
8. **Scripted lifecycle matrix** (in CI, no model cost). Scenarios:
   - happy path
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
   - Invariant after each: no non-terminal ticket is left without an active job, pending owner input, or a scheduled `retry_at`.
9. **Live scenario** (`CREW_LIVE_AGENT_TESTS=1`), on a fixture repo with docs plus a plugin skill:
   - request "add /health"
   - one PM question answered
   - dev, then QC passes
   - local merge and push to a bare fixture remote
   - the assistant closes
   - Assert: reports at every level, `docs_first=true`, docs updated, costs recorded.

## Todo

- [ ] Role registry and prompts (docs-first, skills, untrusted data)
- [ ] Model, failure and merge policies; docs-first and skill checks
- [ ] Assistant flows
- [ ] PM flows (clarify loop, breakdown with pairing, accept with local merge and gate)
- [ ] Dev and QC flows with the bug loop
- [ ] Docs-init child ticket gate
- [ ] Cancellation
- [ ] Scripted lifecycle matrix green in CI
- [ ] Live scenario passes

## Success Criteria

- Every run of every role starts with the capability preflight. On a web fixture, QC drives the page through the Playwright MCP, and `mcps_used` shows it. On the live fixture repo, which has a project skill for its domain, the PM analyze run selects and invokes that skill, and its report shows it in `skills_selected` with a reason.

- Every scenario in the scripted matrix passes in CI and satisfies the no-stuck-ticket invariant.
- The live scenario completes with one owner answer as the only manual step. Every ticket in the tree has a report. The request shows the chain of reports.
- A project without `docs/flows.yaml` runs docs-init before any other subtask of that pm_task, and that job's recorded model is `sonnet`.
- A dev run that skips a required skill, or reads source before docs, is rejected at PM accept, and that creates a bug ticket.

## Risk Assessment

- **Prompt quality drives outcomes.** Prompts are versioned files, and the live scenario is the regression gate.
- **Runaway cost.** The owner chose no default budget, so the always-on controls are the child cap (Phase 2), the bug-cycle cap, the attempt caps and a spawn depth of 2. Per-job `maxBudgetUsd` and the project budgets apply only when configured.
- **No human review before push (owner decision).** The pre-push gate (tests, R1–R7, protected paths) is mandatory and cannot be skipped by agents, because the guard denies changes to `core.hooksPath` and `--no-verify` pushes are caught by CI.

## Security Considerations

- Text the owner did not write is wrapped as untrusted data. The catalog uses only owner-entered descriptions. Tools stay role-scoped.
- Credentials never leave the machine: R7 in hooks and the MCP scrubber.
