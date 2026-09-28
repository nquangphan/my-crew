---
title: "Phase 2: Backend Core"
status: completed
priority: P1
effort: 16h
dependsOn: [1]
---

# Phase 2: Backend Core

<!-- Updated: Validation Session 4 - Jira/Confluence-style UX spec -->

<!-- Updated: Validation Session 1 - budgets nullable, no default limit; child cap stays -->
<!-- Updated: Red Team 2026-09-28 - one project = one machine, TOTP, CSRF, cascade cancel, children.all_done, bug/qc pairing, budgets, idempotency, counters -->

## Overview

Build the Fastify API with Drizzle and PostgreSQL. It provides owner login (password plus TOTP), projects, the
ticket hierarchy, comments, reports, actor-aware transitions, budgets and idempotent writes. Every business
write appends its `events` rows in the same transaction. That table is both the audit log and the delivery
outbox that Phase 3 streams to daemons.

## Key Insights

- **Owner decision: one project is owned by exactly one machine**, and all of its roles (PM, dev, QC) run there. Assignee resolution is `project.owner_machine_id`, and assistant tickets resolve to the single `hosts_assistant` machine.
- "Done needs a report" and the lifecycle wake-ups (`dependency.resolved`, `children.all_done`, cancel cascade) are applied on the server inside the transaction. Agents never have to coordinate these themselves.
- One `events` table serves both audit and outbox. An event aimed at several machines becomes one row per target.

## Requirements

**Owner auth:**
- Password (argon2id) plus TOTP (`otplib`) with 10 one-time recovery codes. Both are set up with the seed CLI over SSH.
- Server-side sessions: httpOnly, Secure, SameSite=Lax cookie; 12 h idle and 7 day absolute TTL. The session id rotates on login.
- CSRF: a double-submit token plus an `Origin` allow-list, checked on the server for every mutating owner route.
- `trustProxy` is limited to the Caddy network, and login is rate limited.
- Creating a pairing code requires re-entering the TOTP.

**Projects:**
- Fields: key, name, **owner-entered description** (the only text used for assistant triage), repo URL, default branch, `owner_machine_id` (nullable until paired), `docs_status`, and `platform` (`web | mobile | web_mobile | backend`), which is set when the project is created (web or app) and decides the QC default MCP.

**Tickets:**
- Fields: `key`, title, description, `type`, `parent_id`, `project_id` (null for `request`), `assignee_role`, `assignee_machine_id` (resolved), `status`, `priority`.
- Agent fields: `complexity`, `model`, `effort`, `required_skills[]`, `required_mcps[]`, `depends_on[]` (sibling ids), `pairs_with` (a QC ticket's dev ticket), `origin_dev_id` (the root dev ticket of a bug chain), `bug_cycle` (int), `flows[]` (flow ids touched, set by the PM or dev and shown as docs links), `agent_session_id`, `cost_usd`.
- Creating a QC ticket adds the platform's default UI-test MCP to `required_mcps`: `maestro` for mobile, `playwright` for web, both for `web_mobile`. It cannot be removed. The project's `ui_test_mcp` mapping (default server names `maestro` and `playwright`, editable in the app) says which inventory server plays each role.
- Hierarchy is at most 3 levels: request → pm_task → {dev, qc, bug, docs_init}.
- Keys come from the `ticket_counters(scope, next)` table. The scope is a project key, or the reserved `AST` for requests.

**Comments and reports:**
- `comments`: `author_kind` (`owner | agent | system`), `author_role`, `body`.
- `ticket_reports`: one current report plus history. Fields: `summary_md`, `files_changed[]`, `commits[]`, `head_sha`, `skills_selected[{name, reason}]` and `mcps_selected[{server, reason}]` (what the agent chose for its own task, and why), `mcps_used[]` (daemon-recorded), `skills_used[]` and `skills_missing[]` (daemon-recorded only, never agent input), `docs_first`, `tests_run`, `bugs_filed[]`, `cost_usd`.

**Transitions** (`POST /v1/tickets/:id/transition`, and the daemon variant in Phase 3):
- Validates `canTransition(actor, from, to)`.
- `done` without a report returns 409 `REPORT_REQUIRED`.
- Server side effects in the same transaction:
  - To `done`: emit `dependency.resolved` for each sibling whose `depends_on` includes this ticket. If this was the last open child, emit a single `children.all_done` to the parent's machine.
  - Owner comment on a `needs_input` ticket: move it to `in_progress` and emit `ticket.comment_added` to the assignee.
  - Owner `done→in_progress`: emit `ticket.reopened`. Owner `blocked→in_progress`: emit `ticket.unblocked`.
  - Owner cancel: cascade `cancelled` over every non-terminal descendant, and emit `ticket.cancelled` per affected machine.

**QC bug loop** (owner decision): each dev ticket has one paired QC ticket (`pairs_with`, `depends_on` = [dev]). QC files bugs through `POST /tickets/:id/bugs`, which:
- creates a `bug` ticket (dev role, `origin_dev_id`, `bug_cycle+1`) plus a paired QC retest ticket that depends on it, under the same pm_task;
- when `bug_cycle > 3`, creates nothing and moves the pm_task to `needs_input` with an owner-visible comment instead.

**Budgets and caps:**
- Configured per project: `maxChildrenPerTicket` (default 12, always enforced), plus `ticketTreeBudgetUsd` and `dailyBudgetUsd`, which are **null by default (no limit)** per the owner's decision and are enforced only when set.
- Creating a child above the cap, or reporting cost that exceeds a budget, moves the pm_task to `needs_input` and emits `budget.exceeded`. The owner approves by commenting, or raises the limits.

**Idempotency:**
- Every daemon write takes an `Idempotency-Key`. Responses are stored in the `idempotency_keys(key, machine_id, response, created_at)` table for 7 days.

**Reads:**
- `GET /v1/tickets` with filters (project, status, type, role, priority, `flow`, free-text `q` over key and title), sorting, and cursor pagination.
- `GET /v1/search?q=` returns tickets by key or title and docs pages by title, for the quick-search box (top 10 each).
- `GET /v1/tickets/:id` returns the ticket with its children, comments, report and events.
- `GET /v1/health`.

## Architecture

Tables:
- `owner`, `sessions`
- `projects`, `machines` (`hosts_assistant` bool with a partial unique index where true)
- `tickets`, `ticket_counters`, `comments`, `ticket_reports`
- `events(id bigserial, type, ticket_id, project_id, target_machine_id, target_role, payload jsonb, created_at)`, indexed on `(target_machine_id, id)`
- `idempotency_keys`, `budgets_usage(project_id, day, cost_usd)`

`ticket-service.ts` owns every mutation and the side effects, and calls `appendEvents(tx, [...])`. Routes stay thin.

## Related Code Files

Create under `apps/api/`:
- `src/server.ts`, `src/app.ts` (`buildApp()` for tests), `src/config.ts`
- `src/db/schema.ts`, `src/db/client.ts`, `drizzle.config.ts`, `drizzle/`
- `src/auth/owner-auth.ts`, `src/auth/password.ts`, `src/auth/totp.ts`, `src/auth/csrf.ts`
- `src/services/ticket-service.ts`, `event-service.ts`, `project-service.ts`, `report-service.ts`, `budget-service.ts`, `idempotency.ts`
- `src/routes/auth-routes.ts`, `project-routes.ts`, `ticket-routes.ts`, `comment-routes.ts`, `report-routes.ts`
- `src/cli/seed-owner.ts`
- `test/helpers/test-db.ts`, `test/ticket-service.test.ts`, `test/transition.test.ts`, `test/lifecycle-effects.test.ts`, `test/bug-loop.test.ts`, `test/budget.test.ts`, `test/auth.test.ts`, `test/csrf.test.ts`

## Implementation Steps

1. Config, DB client, Drizzle schema and indexes, first migration.
2. Owner auth: seed CLI (password, TOTP secret, recovery codes), login (password then TOTP), sessions, CSRF, rate limit, trustProxy.
3. Project service.
4. Ticket service: create (resolve the machine, allocate the key), comment, report, transition with the side effects, the bug endpoint, the cancel cascade, and budget and cap checks. All in one transaction with `appendEvents`.
5. Idempotency middleware for daemon routes (it is wired to the routes in Phase 3).
6. Integration tests against real Postgres:
   - the transition matrix per actor
   - `REPORT_REQUIRED`
   - atomic events with rollback
   - `dependency.resolved` and a single `children.all_done` when the last two children finish together
   - cascade cancel
   - the bug loop, including the cap at cycle 4
   - budget and cap moving the ticket to `needs_input`
   - the first `AST-1` key
   - CSRF rejection
   - TOTP required

## Todo

- [x] Schema and migration
- [x] Owner auth: password, TOTP, sessions, CSRF, rate limit
- [x] Ticket service with server-side lifecycle effects
- [x] QC bug loop and cycle cap
- [x] Budgets, child cap, idempotency
- [x] Integration tests green

## Success Criteria

- `pnpm --filter api test` passes against real Postgres.
- Two children reaching `done` in back-to-back transactions produce exactly one `children.all_done`.
- An owner cancel on an `in_progress` pm_task cancels every open descendant and emits one `ticket.cancelled` per affected machine.
- A mutating request without the CSRF token or Origin gets 403. Login without a valid TOTP fails.

## Risk Assessment

- **Races on the "last child done" check.** Lock the parent row (`SELECT ... FOR UPDATE`) inside the transition transaction.
- **Key races.** `UPDATE ticket_counters ... RETURNING` inside the transaction.

## Security Considerations

- Owner routes use the session plus CSRF. Daemon routes (Phase 3) use bearer tokens only and ignore cookies.
- Markdown is stored raw and sanitized when the web renders it. Report skill fields accept daemon-recorded values only.
