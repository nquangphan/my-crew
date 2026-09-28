# Phase 2 (Backend Core) — Implementation Report

Date: 2026-09-28 · Status: done · Scope: `apps/api/**`, `packages/shared/src/**`, `docker-compose.dev.yml`, lockfile.

## What was built

- **Shared contracts (additive)**: `packages/shared/src/project-schemas.ts` has the project platform, docs status,
  `ui_test_mcp` mapping and the `qcDefaultMcps()` helper, plus the project create, update and response schemas.
  `packages/shared/src/api-schemas.ts` has the error body and codes, the two-step login, session, ticket,
  subtask, bug, transition, list query (CSV filters and cursor), comment, report, detail, search and health
  schemas. The existing exports and tests are unchanged.
- **Database**: `apps/api/src/db/schema.ts` defines 11 tables with the indexes from the phase file. They
  include the partial unique index on `machines.hosts_assistant`, one current report per ticket, events indexed
  on `(target_machine_id, id)`, and GIN indexes on `depends_on` and `flows`. The first migration is
  `apps/api/drizzle/0000_init.sql`, and `pnpm --filter @crew/api db:migrate` applies it.
- **Owner auth**:
  - Passwords use argon2id (`@node-rs/argon2`, OWASP parameters, 12 characters minimum). TOTP uses `otplib`
    v13 with ±1 step of tolerance and replay protection (`totp_last_step`).
  - There are 10 recovery codes of 80 bits each. They are stored as SHA-256 hashes, and each works once.
  - Login is two steps. `POST /v1/auth/login` checks the password and returns a signed challenge that is valid
    for 5 minutes. `POST /v1/auth/login/totp` takes that challenge plus a code or a recovery code.
  - Sessions are stored server-side as a SHA-256 of the cookie. The cookie is httpOnly, Secure (configurable)
    and SameSite=Lax. Sessions expire after 12 h idle or 7 days absolute, and the session id rotates on login.
  - CSRF uses a signed double-submit token bound to the session, plus an Origin allow-list, on every mutating
    owner route. Login checks the Origin too.
  - Both login routes are rate limited (`@fastify/rate-limit`). `trustProxy` is limited to the `TRUST_PROXY`
    CIDRs.
  - `verifyOwnerTotp()` is exported so the Phase 3 pairing-code route can re-confirm the TOTP.
  - Seed CLI: `pnpm --filter @crew/api seed:owner --username <name> [--reset]`. It reads the password from
    `CREW_OWNER_PASSWORD` or a hidden prompt.
- **Services**: `ticket-service.ts` owns every mutation. It covers creation (machine resolution, key
  allocation, hierarchy, sibling dependencies, QC pairing and default MCPs), comments, transitions and the bug
  loop. Supporting services are `budget-service.ts`, `report-service.ts`, `project-service.ts`,
  `event-service.ts` (`appendEvents` validates each payload against the shared union), `idempotency.ts` and
  `ticket-query-service.ts` (list, detail and search).
- **Owner routes**:
  - Auth: `/v1/auth/{login,login/totp,session,logout}`
  - Projects: `GET/POST /v1/projects`, `GET/PATCH /v1/projects/:id`
  - Tickets: `GET/POST /v1/tickets`, `GET /v1/tickets/:id` (uuid or key), `POST /v1/tickets/:id/transition`,
    `POST /v1/tickets/:id/comments`, `GET /v1/tickets/:id/report`
  - Also `GET /v1/search`, and `GET /v1/health` (public)
- **Tests**: 8 files and 71 tests, all against real Postgres. Each run recreates the schema from the
  migrations, and every test truncates the tables.
  - `ticket-service`: the first key is `AST-1`; keys stay unique under concurrent creation.
  - `transition`: the full per-actor matrix, `REPORT_REQUIRED`, and the HTTP error codes.
  - `lifecycle-effects`: `dependency.resolved`; exactly one `children.all_done` for back-to-back and for
    concurrent transactions; cascade cancel with one `ticket.cancelled` per machine; owner wake-ups; atomic
    rollback.
  - `bug-loop`: the loop, including the cap at cycle 4.
  - `budget`: the child cap and the tree and daily budgets, each moving the pm_task to `needs_input`, plus
    owner approval.
  - `idempotency`, `auth` (TOTP required, replay, recovery codes, TTLs, rotation, rate limit) and `csrf`.
  - I checked the concurrency test against a broken build: with the parent-row lock removed, it fails.

## Key decisions and deviations

1. **Agent write routes are not exposed over HTTP yet.** These are `createSubtask`, `fileBug`, `submitReport`
   and agent comments or transitions. The services are complete and tested, and Phase 3 wires them into
   `/v1/daemon/*` with machine auth and `replyIdempotent()`. That covers the `POST /tickets/:id/bugs` endpoint
   the phase file names: QC is an agent, so its route is the daemon route in Phase 3. Owner routes only create
   `request` tickets.
2. **Refusals that commit side effects.** Exceeding the child cap or the bug-cycle cap must still move the
   pm_task to `needs_input`, but the request is refused. The service commits those side effects and then throws
   `ApiError(..., sideEffectsCommitted = true)`. `withIdempotency` stores and replays that response. Ordinary
   errors roll back and are not stored.
3. **Idempotency runs in the handler's own transaction.** An advisory lock is taken on `(machine, key)`, and
   the response is stored in the same transaction as the write. A crash therefore cannot leave a write without
   its stored response. Each key also stores a fingerprint (method, route and body hash), and reusing a key for
   a different request returns 422.
4. **Owner approval of caps and budgets.** A hold sets `tickets.budget_hold` (`children` or `cost`). While a
   hold is set, agents cannot leave `needs_input` or add children (`BUDGET_HOLD`). An owner comment, or an owner
   `needs_input → in_progress`, clears the hold and sets `child_cap_lifted` or `cost_budget_lifted` on that
   pm_task tree. Repeated holds of the same kind do not post a duplicate comment or event. The bug-cycle cap
   parks the ticket without a hold. It emits `budget.exceeded` with kind `bug_cycles`, a kind the shared enum
   already had.
5. **Cost accounting.** `report.costUsd` is the cost of the runs that the report covers. It is added to
   `tickets.cost_usd` and to `budgets_usage` for the day in `BUDGET_TIMEZONE` (default `Asia/Ho_Chi_Minh`).
   The tree budget sums the pm_task and its children. Phase 3's `PATCH agent-meta` must not add the same cost
   again: use `addCost()` for deltas only.
6. **Wake-up extensions beyond the phase text**, so that owner actions never strand an agent:
   - Owner `in_review → in_progress` also emits `ticket.reopened`.
   - Owner `needs_input → in_progress` without a comment emits `ticket.unblocked`.
   - `children.all_done` fires whenever the last open child closes, whether it closed as `done` or
     `cancelled`, unless the parent itself is closed.
   - Owner comments on terminal tickets do not wake agents.
7. **Lock order.** Every writer locks the parent row first, then the ticket. A cascade locks descendants level
   by level from the top down. This prevents both the "last child" race and lock-order deadlocks.
8. **Added ticket fields** that the Phase 4 create dialog needs: `project_hint_id` and `allow_config_change`
   (the "cho phép sửa config" checkbox, inherited by child tickets). `docs_init` tickets go to the `dev`
   role.
9. **Report fields** include the Phase 7 extras `mcps_missing` and `left_resources`. `tests_run` is
   `[{name, passed, summary?}]`. The phase says skill fields are "daemon-recorded only", but at the API layer
   the daemon is the only report writer, so this stays a daemon-side contract.
10. **Search.** `GET /v1/search` returns `docs: []` until Phase 5 adds `docs_files`. The response shape is
    final.
11. **Build and typecheck without a prior shared build.** `apps/api/tsconfig.json` (typecheck, `noEmit`)
    maps `@crew/shared` to its sources, and vitest aliases it the same way. `tsconfig.build.json` resolves the
    built package, and `pnpm -r build` builds `shared` first. TypeScript 7 (tsgo) caused no problems.
12. **Choices not fixed by the phase file.** The default API port is 8787. The TOTP secret is stored in
    plaintext: it is needed to verify codes, and encrypting it at rest would be a later hardening step.

## How to run

```bash
docker compose -f docker-compose.dev.yml up -d --wait   # container crew-dev-postgres, 127.0.0.1:55432
pnpm install && pnpm -r typecheck && pnpm -r test && pnpm lint
# dev DB: postgres://crew:crew@127.0.0.1:55432/crew ; tests: .../crew_test (created by apps/api/docker/init-test-db.sql)
DATABASE_URL=postgres://crew:crew@127.0.0.1:55432/crew pnpm --filter @crew/api db:migrate
DATABASE_URL=... pnpm --filter @crew/api seed:owner --username owner
```

`TEST_DATABASE_URL` overrides the test database. The test setup refuses any database whose name does not end
in `_test`. `apps/api/.env.example` lists every API variable.

## Left for later phases

- Phase 3: daemon routes that use these services with `replyIdempotent`; `pg_notify` in `appendEvents`;
  pairing codes that call `verifyOwnerTotp`.
- Phase 4: owner ticket edits (inline title and priority), if the web needs them; there is no PATCH ticket
  route yet.
- Phase 5: docs search results in `/v1/search`, and updates to `projects.docs_status`.

## Unresolved questions

- Should an owner approval lift the cap or budget for the rest of that pm_task tree, which is what happens now,
  or grant only one more batch? The owner can still lower the limits afterwards.
