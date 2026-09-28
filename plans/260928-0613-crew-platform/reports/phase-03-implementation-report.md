# Phase 3 (Event Delivery and Machine Auth): Implementation Report

Date: 2026-09-28 · Status: done · Scope: `apps/api/**`, `packages/shared/src/**`. No new dependencies.

## What was built

- **Migration** `apps/api/drizzle/0001_machine_auth_and_delivery.sql` adds these tables:
  - `pairing_codes`, `machine_tokens` and `machine_skills` (a skill and MCP inventory per machine and project;
    `project_id` null is the machine-level inventory);
  - `claim_requests`, with a check constraint that each row is either a project or the assistant role, and one
    pending request per machine and target.

  It also adds columns:
  - on `machines`: heartbeat state, health, hardware, online, paused and `revoked_at`;
  - on `tickets`: `agent_model` and `agent_effort`;
  - on `events`: `seq`, the delivery sequence.
- **Commit-ordered event sequence.** A bigserial id is assigned at insert time. If a transaction that
  inserted earlier commits later, a cursor reader would skip its event for good. A deferred constraint trigger
  therefore assigns `events.seq` at commit, under a transaction-scoped advisory lock. As a result, whoever
  sees `seq = n` has seen every committed event below `n`.
  - `EventEnvelope.id` is now `seq`, and it is the SSE cursor.
  - `appendEvents` issues `pg_notify('events_new')`, which is delivered at commit.
  - The existing rows are backfilled with `seq = id`.
- **Pairing and tokens** (`services/machine-service.ts`, `auth/machine-auth.ts`):
  - Pairing codes require a fresh TOTP, last 10 minutes, work once and are rate limited (5/min). Only a
    SHA-256 of the code is stored.
  - `POST /v1/machines/pair` is public and rate limited (10/min). It returns a `crew_mt_` + 256-bit token
    once, and only its SHA-256 is stored. Tokens expire after 90 days.
  - On rotation, the old token keeps working for up to 10 minutes and then stops.
  - Revoking a machine revokes all its tokens and releases its claims.
- **Machine guard.**
  - The bearer token is checked against the stored hash, `revoked_at`, `expires_at` and the machine's
    `revoked_at` on every request, and `last_seen_at`/`online` are updated (at most every 30 s).
  - Daemon routes ignore cookies, and owner routes ignore bearer tokens.
  - Scope is read fresh on every request: the machine owns the ticket's project, or it hosts the assistant for
    `request` tickets. Only the host may create a `pm_task`, and only under a request.
- **Claims** (`services/claim-service.ts`):
  - A target nobody holds is bound at once. This writes a `granted` audit row and sends `machine.claimed` to
    the owner.
  - A target held by another machine gets a `pending` request plus `claim.requested`. The owner approves or
    rejects it with a TOTP.
  - Approval moves the claim and the scope's open tickets, and sends `claim.changed` to both machines.
    Rejection sends it to the requester only.
  - Release, withdrawal, owner reassignment and project creation from a folder are also implemented.
  - Lock order everywhere is the claimed scope first, then claim-request rows, then machine rows.
- **Event bus and SSE** (`realtime/event-bus.ts`, `realtime/sse.ts`):
  - `LISTEN events_new` wakes the bus; postgres.js re-listens after a dropped connection, and the re-listen
    triggers a catch-up read. A 5 s poll is the fallback.
  - The bus keeps a per-machine connection map.
  - Each stream subscribes (and buffers) first, then replays `seq > cursor`, then flushes the buffer with
    dedupe by sequence.
  - A heartbeat comment goes out every 20 s and re-checks the token (or the owner session). A client more
    than 8 MB behind is dropped, and it resumes from its cursor.
  - Revoking a machine closes its streams inside the revoking transaction, before the commit, and refuses new
    ones.
- **Daemon REST** (`routes/daemon-routes.ts`) reuses the Phase 2 services with `actor='agent'`, and every
  write goes through `replyIdempotent`.
- **Heartbeat sweeper** (`jobs/heartbeat-sweeper.ts`) runs every minute. It marks machines silent for more
  than 5 minutes offline and sends one `machine.offline`. The next authenticated request brings a machine
  back online and does nothing else.
- **Owner routes** (`routes/machine-routes.ts`, `routes/stream-routes.ts`) cover pairing codes, the machine
  list and detail, revoke, claim-request list, approve and reject, reassignment, and `GET /v1/stream`.
- **Shared contracts**:
  - `packages/shared/src/machine-schemas.ts` is new and holds every request and response above.
  - `event-schemas.ts` adds the stream cursor and heartbeat constant, the new event types and the claim scope
    fields.
  - `api-schemas.ts` adds the `CLAIM_PENDING` error code, `Ticket.agentModel`/`agentEffort` and the
    `machineId` list filter.
- **Tests**: 50 new tests in 6 files, all against real Postgres. The API total is 121 tests in 14 files.
  - `pairing` covers the TOTP gate, the rate limit, the hash-only storage, single-use and expired codes, the
    401 cases, cookie and bearer separation, and rotation grace.
  - `claims` covers an immediate bind with the inbox event and audit row, a takeover pending until approval
    with TOTP (then the tickets move), rejection, withdrawal, the second assistant host (409), release,
    project creation (409 on a duplicate key), the daemon project view, and owner reassignment and revoke.
  - `machine-scope` sends 403 to machine B on all 9 ticket endpoints of machine A's project. It also covers
    the host-only `pm_task` and catalog, an idempotent retry that replays the stored response, the cost
    contract, the budget endpoint, the heartbeat red alert and the inventory.
  - `daemon-stream` runs on a real listening server with LISTEN/NOTIFY:
    - kill, append 5 events and reconnect: all 5 arrive in order;
    - only events targeted at the machine are delivered, and the poll fallback works;
    - a killed LISTEN connection recovers;
    - no event is lost when transactions commit out of id order;
    - `?cursor` is accepted;
    - an owner web request reaches the assistant host in under 1 s;
    - the owner stream handles live events, `Last-Event-ID` and auth.
  - `revoke-stream`: a revoke closes the open stream at once, and the next event is not delivered. An
    expired token closes its stream within one heartbeat. Logging out closes the owner stream.
  - `sweeper` covers marking a machine offline once, coming back online, and skipping revoked machines.

`pnpm -r typecheck && pnpm -r test && pnpm lint` pass from the root, and the `@crew/shared` and `@crew/api` builds compile. The only
lint output is an info notice about a deprecated `biome.json` setting, which was already there.

## Decisions and deviations

1. **Cost contract for `PATCH .../agent-meta`: delta only.** Each run's cost is booked exactly once:
   - in the report's `costUsd` when the run files a report;
   - otherwise in agent-meta's `costDeltaUsd` (for example a run that ends in `ask_owner`).

   Both amounts are deltas, added through `addCost`, and the Idempotency-Key absorbs retries. The contract is
   documented on `AgentMetaRequest` and tested: a report of 1.5 plus a delta of 0.5 gives 2.0 on the ticket
   and in daily usage, and a retry changes nothing. Agent-meta writes the run's model and effort to the new
   columns `agent_model`/`agent_effort`, so a docs_update run on sonnet does not overwrite the model the PM
   planned.
2. **"A second assistant host returns 409" under the Session 3 claim flow.** Claiming a target that another
   machine holds returns **409 `CLAIM_PENDING`** after the pending request is committed. `details` carry
   `claimRequestId`, and the idempotency layer stores and replays the response. The same code is used for
   projects. The DB also keeps the partial unique index, so two hosts can never exist.
3. **Re-targeting "undelivered events."** With cursor-only delivery, the server does not know another
   machine's cursor, and it cannot re-target old event rows, because their `seq` may be below the new
   machine's cursor. On every claim transfer the scope's open tickets change assignee instead, and those in
   `todo`, `triage` or `in_progress` get a fresh `ticket.assigned` with `reassigned: true` on the new
   machine. Tickets waiting on someone else (`needs_input`, `blocked`, `in_review`) get their next wake-up on
   the new machine, because events target the current assignee.
4. **Release and revoke leave tickets unowned.** Released tickets keep their status and get
   `assignee_machine_id = null`, so their events go to the owner stream only. The next claim moves them.
   Revoking a machine also releases its projects and the assistant role and withdraws its pending requests,
   so a retired laptop never pins work.
5. **Idempotency-Key exemptions:**
   - the heartbeat, a full-state replace sent every 30 s;
   - `POST /v1/daemon/token/rotate`, because its response is a secret that must never be stored;
   - the public `POST /v1/machines/pair`, where the single-use code gives the same protection.

   Every other daemon write requires the key, including claims, project creation and `PUT skills`.
6. **Idempotency fingerprint fix (a Phase 2 file).** The fingerprint used the route pattern, so one key sent
   to a different ticket would have replayed the first ticket's response. It now uses the concrete path. It
   also stores JSON `null` for 204 responses, which previously hit a NOT NULL violation.
7. **`POST /v1/daemon/projects` also requires `platform`** (optional `uiTestMcp`). The column is NOT NULL,
   and it decides the QC UI-test MCP servers, so a guessed default would be wrong. Phase 9's form must send
   it.
8. **The catalog includes `id`** as well as key, name and description, because `pm_task` creation takes a
   `projectId`. It still carries no text derived from the repo.
9. **Additive shared changes.**
   - New event types: `machine.released`, `project.created` and `machine.unhealthy` (the red-health alert).
   - `claim.requested`/`claim.changed` gain `projectId`, `assistant`, `machineId` and `previousMachineId`,
     so a daemon knows what changed without an extra read.
   - The Phase 9 heartbeat health summary is defined now in `machine-schemas.ts` as
     `{status: green|yellow|red, failing: [{id, title}]}`. Phase 9 may extend it.
10. **The sweeper's "affected tickets" list** is served by the new `GET /v1/tickets?machineId=` filter,
    rather than by growing the `machine.offline` payload.
11. **The owner stream without a cursor** starts at the newest event (live only). The machine stream without
    a cursor starts at 0. The owner-stream heartbeat re-checks the session without extending it, so an open
    tab alone does not keep an idle session alive.

## Endpoints for Phase 6 (daemon) and Phase 9 (app)

Every endpoint takes `Authorization: Bearer <token>`. Writes take `Idempotency-Key` (8–200 characters),
except where noted.

| Method and path | Body, response |
|---|---|
| `POST /v1/machines/pair` (public, no key) | `PairMachineRequest` → 201 `{machineId, token, expiresAt}` |
| `POST /v1/daemon/token/rotate` (no key) | → 201 `{machineId, token, expiresAt}` |
| `GET /v1/daemon/stream` | SSE with `id: <seq>` and `data: EventEnvelope`. Resume with `Last-Event-ID` or `?cursor=`. `: ping` every 20 s |
| `POST /v1/daemon/heartbeat` (no key) | `HeartbeatRequest` → `{serverTime, tokenExpiresAt}` |
| `PUT /v1/daemon/skills` | `PutSkillsRequest` (`projectKey` null = machine level) → 204 |
| `GET /v1/daemon/projects` | → `DaemonProjectsResponse` (`ownerState` mine, unowned or other; `pendingClaim`; assistant state) |
| `POST /v1/daemon/projects` | `DaemonCreateProjectRequest` → 201 `Project` (409 on a duplicate key) |
| `POST /v1/daemon/claims` | `{projectKey}` or `{hostsAssistant: true}` → 200 `{status: granted \| already_owned}`, or 202 `{status: pending, claimRequestId}` |
| `DELETE /v1/daemon/claims/:projectKey`, `DELETE /v1/daemon/claims/assistant` | → `{status: released \| withdrawn}`; 409 when nothing is held |
| `GET /v1/projects/catalog` (host only) | → `{items: [{id, key, name, description}]}` |
| `GET /v1/daemon/tickets/:id` (uuid or key) | → `TicketDetailResponse` |
| `GET /v1/daemon/budget/:ticketId` | → `BudgetStatusResponse` (tree and daily lines, `hold`, `overBudget`) |
| `POST /v1/daemon/tickets` | `CreateSubtaskRequest` → 201 `Ticket` |
| `POST /v1/daemon/tickets/:id/comments` | `{body, role?}` → 201 `Comment` |
| `POST /v1/daemon/tickets/:id/transition` | `{to}` → `Ticket` |
| `PUT /v1/daemon/tickets/:id/report` | `SubmitReportRequest` → `Report` |
| `POST /v1/daemon/tickets/:id/bugs` | `FileBugRequest` → 201 `{bug, retest}` |
| `PATCH /v1/daemon/tickets/:id/agent-meta` | `{sessionId?, model?, effort?, costDeltaUsd?}` → `Ticket` |

The event types the daemon should handle, besides the Phase 1 ones:
- `claim.changed`: refresh the projects view; stop jobs of a project it lost;
- `ticket.assigned` with `reassigned: true`: a job for a ticket inherited from another machine.

## Endpoints for Phase 4 (web)

These use the owner session cookie. Mutating requests also need the Origin and CSRF headers.

| Method and path | Notes |
|---|---|
| `GET /v1/stream` | SSE with every event; `Last-Event-ID`; without a cursor it starts live |
| `POST /v1/machines/pairing-codes` | `{code: TOTP}` → 201 `{pairingCode, expiresAt}`; 5/min |
| `GET /v1/machines`, `GET /v1/machines/:id` | `Machine` (online, `streamConnected`, paused, health, resources, jobs, `tokenExpiresAt`, `projectKeys`); the detail adds `inventories` |
| `POST /v1/machines/:id/revoke` | → `Machine` |
| `POST /v1/machines/:id/claims` | Reassign: `{projectId}` or `{hostsAssistant: true}` → `ClaimResponse` |
| `GET /v1/claim-requests?status=` | → `{items: ClaimRequest[]}` |
| `POST /v1/claim-requests/:id/approve` and `.../reject` | `{code: TOTP}` → `ClaimRequest`; 401 on a bad code; 409 when already decided |
| `GET /v1/tickets?machineId=` | The affected tickets of an offline machine |

The inbox listens for these owner-stream events: `claim.requested`, `machine.claimed`, `machine.released`,
`project.created`, `machine.offline`, `machine.unhealthy` and `budget.exceeded`.

## Left undone

- Nothing in the phase scope. `plans/` was off limits except for this report, so the phase file's todo boxes
  are unchanged. Please tick them when you update the plan status.
- Caddy `flush_interval -1` for SSE belongs to Phase 8, as the phase file says.

## Unresolved questions

- Is 409 `CLAIM_PENDING` for a takeover the contract you want (decision 2), or should a pending request be
  202 Accepted? Changing it touches only `claim()` and the tests.
- Should revocation release the machine's claims (decision 4)? The alternative is to keep them pinned to the
  revoked machine until the owner reassigns them.
