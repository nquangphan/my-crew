# Red Team: Scope & Complexity Critic + Contract Verifier

Plan: /Users/admin/Documents/Projects/AI-company/plans/260928-0613-agent-jira-platform/
Date: 2026-09-28 (Asia/Saigon)

## Finding 1: The dev/QC dependency deadlocks, so no subtask ever reaches done
- **Severity:** Critical
- **Location:** phase-06-local-daemon.md:56, phase-07-agent-workflow.md:35-36, plan.md:72
- **Flaw:** The scheduler only starts a job once every `depends_on` ticket is `done`. The dev exit condition ends in `in_review`, and only QC moves the dev subtask to `done`. QC `depends on dev`, so QC waits for dev to be `done`, and dev waits for QC to mark it `done`.
- **Failure scenario:** The PM creates dev PRJ-5 and qc PRJ-6 with `depends_on:[PRJ-5]`. Dev finishes and sits in `in_review`. PRJ-6 is never runnable. No `subtask.completed` event fires, so the PM accept job never runs and the request never closes. The Phase 7 live scenario (7:86-93) fails on its first run.
- **Evidence:** 6:56 "A job becomes runnable when all `depends_on` tickets are `done`." 7:35 dev "`submit_report` ..., then `in_review`". 7:36 qc "depends on dev ... Pass → the dev subtask moves to `done` and QC to `done`".
- **Suggested fix:** Define the gating state per edge in one place (`@aj/shared`): a dependency is satisfied when the dependency is `done` or, for a qc→dev edge, `in_review`. The simpler alternative is for dev to move itself to `done` with its report and for QC failure to create a new dev fix subtask. Pick one and update 6:56, 7:35-36 and the scheduler test at 6:102.

## Finding 2: The QC worktree cannot see the dev commits, and QC cannot write to the dev ticket or wake the dev agent
- **Severity:** Critical
- **Location:** phase-06-local-daemon.md:75, :49-53; phase-03-event-delivery.md:32; phase-02-backend-core.md:73; phase-07-agent-workflow.md:36
- **Flaw:** Four contracts conflict with the QC role.
  (a) Each QC job gets a new worktree at `-b aj/<qc-ticket-key> <base>`, so it contains no dev commits to review.
  (b) The machine scope only allows writes to tickets assigned to the calling machine. `(project, role)` ownership is unique, so dev and qc can be owned by different machines, and QC's transition of the dev subtask gets 403.
  (c) On a fail, QC reopens the dev subtask to `in_progress` and comments on it. That comment is an agent comment, and `ticket.comment_added` only fires for owner comments. The dispatcher also has no mapping for `ticket.status_changed`.
  (d) The ticket MCP server is "bound to the job's ticket and scope" (6:65), so a QC run cannot comment on the dev ticket at all.
- **Failure scenario:** QC reviews an empty diff and passes. Or it fails the work, and the dev agent never wakes up, so the dev ticket stays `in_progress` forever with no running job.
- **Evidence:** 6:75 "`git worktree add <repo>/.aj/worktrees/<ticket-key> -b aj/<ticket-key> <base>` for dev and QC jobs". 3:32 "a machine can only read or write tickets whose `assignee_machine_id` is itself". 2:73 "`ticket.comment_added`: only for owner comments". 6:49-53 dispatcher lists assigned/comment_added/subtask.completed/cancelled only. 6:135 "an agent cannot comment on unrelated tickets".
- **Suggested fix:** QC checks out the dev branch (`aj/<dev-key>`) read-only, with no new branch. The QC verdict goes onto the QC ticket's report, and the server applies the dev transition as a side effect of the QC transition, which avoids cross-machine writes. Emit a `ticket.reopened` event targeting the dev assignee, and map it in the dispatcher to resume the dev session.

## Finding 3: Cancel is unreachable from most states, and the cancel event reaches only one machine
- **Severity:** High
- **Location:** phase-01-monorepo-foundation.md:54-61; phase-04-web-app.md:37; phase-07-agent-workflow.md:58; phase-06-local-daemon.md:53
- **Flaw:** The transition table allows `cancelled` only from `triage` and `blocked`. The web "cancel" action and the "abort running jobs" flow assume you can cancel an `in_progress` ticket. You cannot cancel from `todo`, `needs_input`, `in_progress` or `in_review`. Separately, `ticket.cancelled` is one events row with one `target_machine_id`, but Phase 7 aborts "the ticket and its children", and those children may belong to other machines.
- **Failure scenario:** The owner clicks Cancel on a runaway `in_progress` request. `canTransition` returns false and the API returns 409. Agents keep spending money. If the cancel did go through, dev jobs on machine B would never get the event.
- **Evidence:** 1:55-60 (no `in_progress→cancelled`, `todo→cancelled`, `needs_input→cancelled` or `in_review→cancelled`). 4:37 "Actions: cancel, reopen." 7:58 "aborts the running jobs of the ticket and its children".
- **Suggested fix:** Allow owner-only `* → cancelled` from every non-terminal state in `allowedTransitions`. The ticket service should cascade the cancel to descendants and append one `ticket.cancelled` event per descendant, each targeting that descendant's assignee machine. Add both cases to the 2:78-83 tests.

## Finding 4: The `machine_projects` schema cannot hold its own unique index, and `hosts_assistant` is used one phase before it exists
- **Severity:** High
- **Location:** phase-02-backend-core.md:43-46, :68; phase-03-event-delivery.md:66
- **Flaw:** The table is declared as `machine_projects(machine_id, project_id, roles[])`, then "a unique index on `machine_projects(project_id, role)`". There is no scalar `role` column, and Postgres cannot unique-index array elements across rows. Phase 2 also resolves assistant tickets through `hosts_assistant` and says to "create a ticket, resolving the assignee machine ... (or the assistant host)". That column only appears in the Phase 3 migration, and nothing makes only one machine the assistant host.
- **Failure scenario:** The implementer either writes an array column with no uniqueness guarantee, so two machines can both claim `PRJ/dev` and the "no competing consumers" premise (3:20) breaks, or improvises a schema. The Phase 2 ticket-create tests have no assistant machine to resolve to. Two paired machines with `hostsAssistant: true` split the assistant tickets between them.
- **Evidence:** 2:43 "`machine_projects(machine_id, project_id, roles[])`". 2:45 "unique index on `machine_projects(project_id, role)`". 2:46 "resolve to the machine flagged `hosts_assistant`". 3:66 "add ... `machines.hosts_assistant`".
- **Suggested fix:** Use one row per role, `machine_projects(machine_id, project_id, role)` with `UNIQUE(project_id, role)`. Move `hosts_assistant` into the Phase 2 schema with a partial unique index `WHERE hosts_assistant`. Also define what happens when no machine owns a role: reject at create time or leave the ticket unassigned.

## Finding 5: The docs_init ticket and the hierarchy rule do not fit the ticket contract
- **Severity:** High
- **Location:** phase-02-backend-core.md:30-31, :102; phase-03-event-delivery.md:40; phase-07-agent-workflow.md:38, :84
- **Flaw:**
  - `depends_on[]` holds "sibling ticket IDs", but the docs_init ticket the daemon creates is not a sibling of the queued PM or dev tickets.
  - The daemon create endpoint covers only "a subtask or PM ticket".
  - There is no stated parent or role for docs_init, and no `(project, role)` owner for it.
  - The hierarchy rule says "only two levels" but lists three (request → PM task → subtask). An implementer enforcing "two levels" would reject every dev subtask.
  - The "make queued jobs depend on it" gate exists only in the daemon's local `jobs.depends_on` (6:43), so the server and web show nothing blocking the project.
- **Failure scenario:** The daemon calls `POST /v1/daemon/tickets` with `type: docs_init` and no parent, and the service rejects it or assigns it to nobody. Or the gate is local only, and a second machine owning `qc` for the same project starts before the docs exist.
- **Evidence:** 2:31 "`depends_on[]` (sibling ticket IDs)". 2:102 "only two levels are allowed (assistant request → PM task → dev/QC subtask)". 3:40 "`POST /v1/daemon/tickets` (create a subtask or PM ticket)". 7:84 "create a docs_init ticket and make the queued jobs depend on it".
- **Suggested fix:** Make docs_init a child of the PM ticket that triggered it, assigned to role `dev`, so it reuses the existing sibling `depends_on`. Allow `docs_init` explicitly in the create schema. Reword 2:102 to "max depth 3 (depth 0..2)".

## Finding 6: Delivery bookkeeping has four overlapping mechanisms where one cursor is enough
- **Severity:** Medium
- **Location:** phase-03-event-delivery.md:34, :37, :53-54; phase-06-local-daemon.md:41-42, :46; phase-02-backend-core.md:44
- **Flaw:** Each event already has exactly one `target_machine_id` (2:44), and each machine is the only consumer of its stream (3:20). On top of that the plan adds:
  - an `event_deliveries(event_id, machine_id, delivered_at, attempts)` table that duplicates `events.target_machine_id` 1:1
  - an ack endpoint
  - a 60 s redelivery timer on the open stream
  - a replay filter that mixes "unacked" with "id > cursor"
  - a daemon-side `seen_events` table as well as the cursor

  Research 02 §1 says the write itself can act as the ack (research-02:25).
- **Failure scenario:** The two replay rules disagree. An event with id ≤ cursor that was never acked (the daemon crashed between persisting the cursor and acking, 6:46) is neither replayed nor, once reconnected, clearly covered by the redelivery timer. Or it is redelivered and dedupe carries the whole correctness load. There are more states to test and no extra guarantee.
- **Evidence:** 3:34 "replays unacked events for the machine with `id > cursor`". 3:37 "Unacked events older than 60 s are re-sent on the open stream." 3:53 "`event_deliveries(event_id, machine_id, delivered_at, attempts)`". 6:42 "`seen_events(id)` for dedupe".
- **Suggested fix:** Use the cursor alone: replay `WHERE target_machine_id=$m AND id > $cursor`, and have the daemon persist the cursor in the same SQLite transaction that enqueues the job. That transaction is the idempotency boundary. Drop `event_deliveries`, the ack route and the redelivery timer. If the owner wants a "delivered" view, derive it from `machines.last_cursor` reported in the heartbeat.

## Finding 7: The phase order and file ownership contradict each other: the docs viewer is built before the web app, the pre-push hook is never created, and CI is duplicated
- **Severity:** Medium
- **Location:** plan.md:61-62; phase-05-docs-standard.md:87, :95, :115-116; phase-08-deploy-and-e2e.md:26, :43
- **Flaw:**
  - Phase 5 creates `apps/web/src/routes/project-docs.tsx` and `flow-view.tsx`, but it depends only on phases 1 and 3. The router, API client and markdown view are created in Phase 4, which Phase 5 does not depend on. Phase 4 even says "The docs viewer UI is added in Phase 5" (4:15).
  - Phase 5 relies on "the daemon's pre-push run of `check --range`", but `install-hooks` writes only `pre-commit`, and phases 6 and 7 never add a pre-push hook.
  - `.github/workflows/docs-check.yml` (Phase 5) and `.github/workflows/ci.yml` (Phase 8) both run `aj-docs check --range`.
- **Failure scenario:** Phases 4 and 5 run in parallel (both unblock after Phase 3), and Phase 5 hand-builds a second fetch client and markdown renderer. `--no-verify` commits pushed by agents under `local-merge` (7:56) skip the promised pre-push gate. Two CI workflows drift apart.
- **Evidence:** plan.md:62 "| 5 | ... | 1, 3 (sync endpoint) |". 5:115 "`apps/web/src/routes/project-docs.tsx`". 5:87 "the daemon's pre-push run of `check --range`". 5:95 "writes `.githooks/pre-commit`". 5:116 "`.github/workflows/docs-check.yml`". 8:26 "CI ... `aj-docs check --range`".
- **Suggested fix:** Make Phase 5 depend on Phase 4 (or move the viewer into Phase 4 and keep only the sync endpoint in Phase 5). Have `install-hooks` also write `.githooks/pre-push` → `aj-docs check --range @{u}..HEAD`. Keep one CI workflow (`ci.yml`), with Phase 5 creating it and Phase 8 extending it.

## Finding 8: Several features go beyond the request
- **Severity:** Medium
- **Location:** phase-02-backend-core.md:77; phase-05-docs-standard.md:104; phase-06-local-daemon.md:33, :37; phase-07-agent-workflow.md:32, :54-56; phase-08-deploy-and-e2e.md:23
- **Flaw:** None of these trace to the request (read-only docs view, one owner):
  - OpenAPI dump via `@fastify/swagger`. The shared Zod package is already the contract.
  - Server-side docs search (`ILIKE`). The request is a read-only view.
  - Native `keytar` Keychain storage with a file fallback. keytar is a native module that is no longer maintained, and the plan already has the 0600 file path.
  - Both a launchd and a systemd service generator.
  - Two merge policies (`pr` and `local-merge`).
  - An `autoCloseRequests` switch that no config schema defines.
  - An rclone off-box target.
- **Failure scenario:** Each one adds code, tests and failure modes. keytar in particular breaks `pnpm install` on machines without build tools and Node-ABI matches, which blocks the daemon, a core deliverable. `autoCloseRequests` appears only in 7:32, with no config field (6:28-33) and no owner, so it is either built ad hoc or left out without anyone noticing.
- **Evidence:** 2:77 "an OpenAPI dump (`@fastify/swagger`) for reference". 5:104 "Search does a server-side `ILIKE`". 6:33 "macOS Keychain (`keytar`), falling back to a 0600 file". 6:37 "launchd plist on macOS, systemd user unit on Linux". 7:54-56 two `mergePolicy` modes. 7:32 "or `autoCloseRequests` does". 8:23 "optional rclone target".
- **Suggested fix:** Cut the OpenAPI dump, the docs search, keytar (keep the 0600 file) and `autoCloseRequests` (the owner drags the ticket to done). Keep one merge policy, and ask the owner which one. Generate a service file only for the OS the owner actually uses. Ask the owner whether off-box backup is wanted. These are cut recommendations for additions, not for requested features.

## Finding 9: Status, event and field contracts are partly unused or have no defined type
- **Severity:** Medium
- **Location:** phase-01-monorepo-foundation.md:28, :32, :55-57; phase-02-backend-core.md:31, :71-76; phase-05-docs-standard.md:99; phase-06-local-daemon.md:59; phase-07-agent-workflow.md:31, :47-51
- **Flaw:**
  - The `triage` status has three transition edges, but no role ever enters it. The assistant goes straight to `in_progress` (7:31).
  - `docs.synced` is emitted (5:99), but it is not in the Phase 2 event-type list or the Phase 1 payload union, and it has no target machine or dispatcher mapping.
  - `effort` is a `runAgent` input and part of the complexity map (trivial→haiku/low ...), but tickets store only `model`, so an agent-chosen effort cannot be persisted or resumed.
  - `subtask.completed` fires on every child completion (2:34), and each one starts a PM job (6:52) on sonnet/high or opus. Only the last one does real acceptance (7:37).
- **Failure scenario:** The `EventEnvelope` discriminated union rejects `docs.synced`, so appending it either throws in the docs PUT transaction or the event gets typed as `any`. With N subtasks the PM re-evaluates N times, and N-1 of those runs are wasted paid runs. After a resume the model runs at the default effort instead of the one the PM picked.
- **Evidence:** 1:28 "`todo | triage | ...`". 7:31 assistant exit "Status `in_progress`". 2:71-76 lists five event types without `docs.synced`. 5:99 "appends a `docs.synced` event". 2:31 agent fields have `model` but no effort. 6:59 "`runAgent({role, cwd, model, effort, ...})`".
- **Suggested fix:** Drop `triage`, or make the assistant enter it. Add `docs.synced` to the shared union with `targetMachineId=null` (owner stream only). Add an `effort` column. Have the server emit `subtask.completed` to the parent only when all siblings are terminal (`children.completed`), so the dispatcher needs no PM "re-evaluation" logic.

## Finding 10: The key sequence is per project, but assistant tickets have no project
- **Severity:** Medium
- **Location:** phase-02-backend-core.md:30, :68, :101
- **Flaw:** Keys are generated "per project sequence" from "a per-project counter row". Assistant tickets have `project_id` null and still need `AST-n` keys, and no counter row or project named `AST` is defined.
- **Failure scenario:** The first owner request fails on a missing counter row, or several implementations invent a fake `AST` project. That fake project then appears in `GET /v1/projects/catalog` (3:47), and the assistant can "route" a request to it.
- **Evidence:** 2:30 "`key` (e.g. `PRJ-12`, or `AST-3` for assistant tickets) ... `project_id` (nullable for assistant tickets)". 2:101 "use a per-project counter row updated with `UPDATE ... RETURNING`".
- **Suggested fix:** Use a `ticket_counters(scope text primary key, next int)` table keyed by project key, with `AST` as a reserved scope that is not a project. Add a test for the first assistant ticket's key.

Status: DONE
Summary: 10 findings (2 Critical, 3 High, 5 Medium). The two Critical ones are the dev/QC dependency deadlock and the QC worktree, scope and wake-up contracts. Either one stops the Phase 7 lifecycle before it completes.
