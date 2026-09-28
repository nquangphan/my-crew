---
title: "Phase 3: Event Delivery and Machine Auth"
status: completed
priority: P1
effort: 10h
dependsOn: [2]
---

# Phase 3: Event Delivery and Machine Auth

<!-- Updated: Validation Session 3 - projects/folders chosen in the local app; takeover needs owner approval; app can create projects -->
<!-- Updated: Desktop App 2026-09-28 - see phase 9 -->
<!-- Updated: Red Team 2026-09-28 - owner-set pairing claims, cursor-only delivery (acks dropped), revoke closes streams, token expiry, heartbeat sweeper -->

## Overview

Daemons sit behind NAT, so they connect out to the VPS. This phase adds:
- Owner-controlled machine pairing.
- Hashed, revocable, expiring device tokens.
- One SSE stream per machine, using cursor replay only.
- The REST endpoints daemons use to act on tickets.
- A heartbeat sweeper that flags offline machines.

The web app gets an owner SSE stream that supports `Last-Event-ID`.

## Key Insights

- SSE push plus REST writes is enough for this volume (research 02 §1).
- **Delivery is cursor-only.** Events for a machine are replayed when `id > cursor`, and the daemon saves the cursor in the same SQLite transaction that enqueues the job (Phase 6). There are no acks, no delivery table and no redelivery timer. Delivery is at least once, and duplicates are absorbed by the one-job-per-ticket rule plus idempotency keys.
- Because one project belongs to one machine, each machine is the only consumer of its own stream.

## Requirements

**Pairing** (authenticates the machine only):
- The owner creates a pairing code on the web (requires TOTP, 10 min TTL, single use). The code carries no claims.
- The desktop app (Phase 9) or `crewd pair --code` calls `POST /v1/machines/pair` with the machine name, hostname, OS, CPU/RAM and skill inventory.
- It returns a 256-bit opaque token, once. Only the SHA-256 hash is stored, with `expires_at` (90 days), `revoked_at` and `last_seen_at`.
- `crewd rotate-token` (or the app) swaps the token before expiry.

**Claims from the local app** (owner decision: the machine chooses its projects and folders locally):
- `GET /v1/daemon/projects` lists every project with its owner state: mine, unowned, or owned by another machine.
- `POST /v1/daemon/claims {projectKey}` and `POST /v1/daemon/claims {hostsAssistant: true}`:
  - **Unowned project, or no assistant host yet:** bound at once (`projects.owner_machine_id`, or `machines.hosts_assistant`). Emits `machine.claimed` to the owner inbox with an audit row.
  - **Held by another machine:** creates a `claim_requests` row (`pending`) and emits `claim.requested`. The owner approves or rejects on the web (TOTP required). On approval, the old owner loses the claim, open tickets and undelivered events are re-targeted, and both machines get `claim.changed`. A rejection notifies the requesting machine.
- `DELETE /v1/daemon/claims/:projectKey` (or `.../assistant`) releases a claim immediately. Open tickets of that project stay put and show in the inbox as "unowned project" until another machine claims it.
- `POST /v1/daemon/projects {key, name, description, repoUrl, defaultBranch}` creates a new project owned by the calling machine, and notifies the owner inbox. The key must be unique, and `repoUrl` must be `https://` or `git@`. The description is typed by the owner in the app. It is never prefilled from repo content, because triage trusts only owner-written descriptions.
- A machine cannot edit or delete projects it does not own. Budgets and other project settings stay owner web actions.

**Machine auth guard:**
- `Authorization: Bearer` is checked against the hash, `revoked_at` and `expires_at` on every request.
- Scope: a machine may read or write only tickets whose project it owns, or `request` tickets when it is the assistant host.
- Only the assistant host may create a `pm_task`, and only under an existing request ticket.

**`GET /v1/daemon/stream`:**
- Resumes from the SSE `Last-Event-ID` header or `?cursor`.
- Subscribes to the in-process bus first and buffers, then queries events for the machine with `id > cursor`, then flushes the buffer with dedupe by id. This leaves no gap.
- Postgres `LISTEN events_new` wakes the bus. A 5 s poll is the fallback, and a heartbeat comment goes out every 20 s.
- The token is re-checked on every heartbeat. Revoking a token closes that machine's open streams at once through the bus's per-machine connection map.

**Daemon REST endpoints.** They reuse the Phase 2 services, with `actor='agent'` and a required `Idempotency-Key`:
- `GET /v1/daemon/tickets/:id`
- `POST /v1/daemon/tickets` (subtask, pm_task or docs_init, within scope)
- `POST .../comments`, `POST .../transition`, `PUT .../report`, `POST .../bugs`
- `PATCH .../agent-meta` (session id, cost, model, effort)
- `POST /v1/daemon/heartbeat` (resources, running jobs, CLI version, `paused`, and the health summary `{status, failing[]}` from Phase 9). A red health status sends an owner-stream alert.
- `PUT /v1/daemon/skills`
- `GET /v1/daemon/budget/:ticketId` (remaining per-ticket and daily budget)

**Catalog:** `GET /v1/projects/catalog` (assistant host only) returns key, name and the **owner-entered description** only. Repo-derived text is never included, so a repo cannot inject instructions into triage.

**Heartbeat sweeper:** runs every minute on the server.
- A machine with `last_seen_at` older than 5 min is marked offline, and a `machine.offline` event is sent to the owner stream. The owner inbox lists that machine's affected tickets.
- When the machine comes back, it is marked online and nothing else happens; the daemon resumes its own jobs.

**Owner stream `GET /v1/stream`:** carries every event and honours `Last-Event-ID`.

## Related Code Files

Create under `apps/api/src/`:
- `auth/machine-auth.ts`, `services/machine-service.ts` (pairing, tokens, heartbeat, skills, reassignment)
- `realtime/event-bus.ts`, `realtime/sse.ts`, `jobs/heartbeat-sweeper.ts`
- `routes/machine-routes.ts` (owner: pairing codes, list, revoke, claim request approve/reject, reassign), `routes/daemon-routes.ts`, `routes/stream-routes.ts`
- `test/pairing.test.ts`, `test/daemon-stream.test.ts`, `test/machine-scope.test.ts`, `test/revoke-stream.test.ts`, `test/sweeper.test.ts`

Modify:
- `apps/api/src/db/schema.ts`: add `pairing_codes`, `machine_tokens`, `machine_skills`, `claim_requests(id, machine_id, project_id | assistant, status, decided_at)`.
- `apps/api/src/services/event-service.ts`: add `pg_notify`.
- `packages/shared/src/event-schemas.ts`: add the stream schemas.

## Implementation Steps

1. Add the migration for the new tables.
2. Pairing, tokens (hash, expiry, rotate, revoke), and the claim endpoints: immediate bind, takeover request, owner approval with re-targeting, release, and project creation.
3. Machine auth guard and scope checks.
4. Event bus with LISTEN/NOTIFY, and the SSE route with gap-free replay and revoke-closes-stream.
5. Daemon write routes delegating to the Phase 2 services, with the idempotency middleware.
6. Owner stream and the heartbeat sweeper.
7. Tests:
   - claiming an unowned project binds immediately and notifies the inbox
   - claiming a project or the assistant role held by another machine stays pending until the owner approves it (TOTP); after approval the open tickets move to the new machine
   - creating a project with a duplicate key returns 409
   - a second assistant host returns 409
   - a revoked token returns 401, and an open stream closes
   - an expired token returns 401
   - a scope violation returns 403
   - SSE replay after a disconnect loses no events
   - an idempotent retry returns the stored response
   - the sweeper marks a machine offline

## Todo

- [x] Migration, pairing, and claims from the app (immediate, takeover approval, release, create project)
- [x] Token expiry, rotation and revocation, with streams closed on revoke
- [x] Machine auth and scope
- [x] Event bus and cursor replay SSE
- [x] Daemon REST endpoints with idempotency
- [x] Owner stream and sweeper
- [x] Tests green

## Success Criteria

- Kill the SSE connection, append 5 events, reconnect with the last cursor: all 5 arrive, in order.
- Revoke a token while its stream is open. The next event is not delivered, and the stream closes within one heartbeat.
- Machine B gets 403 on any ticket of a project owned by machine A.

## Risk Assessment

- Proxy buffering of SSE: Caddy `flush_interval -1` (Phase 8).
- The LISTEN connection dropping: reconnect with backoff, with the poll fallback covering the gap.

## Security Considerations

- Tokens are shown once and never logged, and they expire. Pairing codes are single use, require TOTP, and are rate limited.
- Daemon endpoints ignore cookies, and owner endpoints ignore bearer tokens.
