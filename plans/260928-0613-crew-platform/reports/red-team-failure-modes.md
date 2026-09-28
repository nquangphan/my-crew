# Red Team: Failure Mode Analysis (Flow Tracer)

Date: 2026-09-28 (Asia/Saigon)
Scope: plan.md, phase-01..08, research/*.md
Traced lifecycle: owner request → assistant triage → PM analyze/ask_owner → PM breakdown → dev/QC → PM accept/merge → assistant close.

## Finding 1: The dev/QC handoff deadlocks, and the QC reopen loop has no wake-up event
- **Severity:** Critical
- **Location:** phase-07 Role Contracts (dev, qc rows); phase-06 Scheduler and Dispatcher; phase-02 event types
- **Flaw:** A QC job is runnable only when its `depends_on` tickets are `done`. The dev subtask never reaches `done` by itself. It stops at `in_review` and waits for QC to move it to `done`. QC depends on dev, so QC never starts. Even if gating accepted `in_review`, the reopen loop still breaks. QC's fail comment is an agent comment, and agent comments emit no event. The dispatcher also ignores `ticket.status_changed`. A reopened dev subtask therefore never gets a new job. After a dev fix, nothing re-triggers QC, because its `ticket.assigned` event was already consumed and deduped. The plan also never says what state QC's own ticket takes on a fail, so the PM never gets a `subtask.completed` for it.
- **Failure scenario:** The PM creates DEV-1 and QC-1 (depends_on DEV-1). DEV-1 finishes and moves to `in_review`. The QC-1 job waits forever on "DEV-1 done". Suppose the gate is relaxed and QC fails. DEV-1 goes back to `in_progress` with no job on any machine. The ticket tree freezes with no error and no timeout.
- **Evidence:**
  - phase-06-local-daemon.md:56 "A job becomes runnable when all `depends_on` tickets are `done`."
  - phase-07-agent-workflow.md:35 "dev ... `submit_report` ... then `in_review`"
  - phase-07-agent-workflow.md:36 "qc | `ticket.assigned` (qc), depends on dev ... Pass → the dev subtask moves to `done` and QC to `done`. Fail → comment on the dev subtask and reopen it `in_progress`"
  - phase-02-backend-core.md:73 "`ticket.comment_added`: only for owner comments"
  - phase-06-local-daemon.md:49-53: the dispatcher maps only `ticket.assigned`, `ticket.comment_added`, `subtask.completed` and `ticket.cancelled`. `ticket.status_changed` has no mapping.
  - Scope: phase-06-local-daemon.md:65 "bound to the job's ticket and scope", and phase-03-event-delivery.md:32 "a machine can only read or write tickets whose `assignee_machine_id` is itself". The QC job's tools cannot transition the dev ticket, and if dev and QC run on different machines (phase-02-backend-core.md:45 makes ownership per `(project, role)`), the call gets a 403.
- **Suggested fix:**
  - Define QC gating on the dev report existing (`in_review` plus report), not on `done`.
  - Give QC an explicit cross-ticket tool, `qc_verdict(devTicketId, pass|fail)`. The server executes it and emits `ticket.reopened` targeted at the dev assignee, and on a later dev `in_review` it emits `ticket.ready_for_qc` targeted at the QC assignee.
  - Specify QC's own ticket state on fail (for example `blocked` awaiting the dev fix, with an event exit).
  - Add a dispatcher mapping for every status edge that needs an agent reaction.

## Finding 2: Dependency gating has no source of truth across machines
- **Severity:** Critical
- **Location:** phase-06 Scheduler; phase-02 `subtask.completed`; phase-07 docs-init gate
- **Flaw:** The scheduler gates on remote ticket status, but no event tells the machine running the dependent job that a dependency finished. `subtask.completed` targets only the parent's assignee (the PM). `ticket.status_changed` is emitted but never dispatched, and it goes to one `target_machine_id` (the ticket's own assignee). A dev machine waiting on a sibling dev subtask, or on the docs_init ticket, is never told. The plan also never says whether the daemon polls, how often, or what happens when the dependency sits on a different machine.
- **Failure scenario:** DEV-2 depends on DEV-1. Both are on machine B. DEV-1 reaches `done` (through QC). The only event goes to the PM machine A. Machine B's local `jobs.depends_on` never re-evaluates, and DEV-2 stays queued forever. The same thing happens to every job queued behind a docs_init ticket.
- **Evidence:**
  - phase-02-backend-core.md:34 "When a subtask reaches `done`, the API appends a `subtask.completed` event targeting the parent's assignee role."
  - phase-02-backend-core.md:44 `events(... target_machine_id, target_role ...)`: a single target per event.
  - phase-06-local-daemon.md:43 the local `jobs(... depends_on ...)` table, and :56 the gating rule.
  - phase-07-agent-workflow.md:84 "On exit 3, create a docs_init ticket and make the queued jobs depend on it."
- **Suggested fix:** On every transition to `done`, the server fans out a `dependency.resolved` event to each machine that owns a ticket listing this one in `depends_on`. `event_deliveries` already supports one delivery row per machine. The scheduler also re-validates dependencies against `GET /v1/daemon/tickets/:id` on reconnect and on a periodic tick. Add a test with dev and QC on different machines.

## Finding 3: The status workflow has no edges for cancellation or for the transitions the agents actually perform
- **Severity:** Critical
- **Location:** phase-01 status workflow; phase-04 cancel action; phase-06/07 cancellation, `ask_owner`, PM accept
- **Flaw:** `cancelled` can only be reached from `triage` or `blocked`. A ticket that is running (`in_progress`), waiting on the owner (`needs_input`), in review, or still `todo` cannot be cancelled. The "`ticket.cancelled` aborts running jobs" path is therefore unreachable for the one state where it matters. The agent tools also depend on edges that do not exist. `ask_owner` moves a fresh ticket from `todo` to `needs_input`, which is not allowed. The PM goes "`submit_report`, then `done`" from `in_progress`, which is not allowed either. The plan also never says who moves `needs_input` back to `in_progress` when the owner replies. Cancel cascades to "the ticket and its children", but the event has a single `target_machine_id`, so children on other machines keep running.
- **Failure scenario:** A dev agent loops and burns budget. The owner clicks Cancel and the API returns an invalid-transition error. The only route is to wait for `blocked`. In another case the assistant calls `ask_owner` on a `todo` request: the tool errors, the run ends, and the ticket is stuck in `todo`. If the owner cancels a PM ticket in `triage`, dev jobs on machine B are not aborted and their worktrees leak.
- **Evidence:**
  - phase-01-monorepo-foundation.md:55-61: `todo→triage|in_progress`, `triage→needs_input|in_progress|cancelled`, `needs_input→triage|in_progress`, `in_progress→needs_input|in_review|blocked`, `in_review→in_progress|done`, `blocked→in_progress|cancelled`.
  - phase-04-web-app.md:37 "Actions: cancel, reopen."
  - phase-07-agent-workflow.md:58 "a `ticket.cancelled` event aborts the running jobs of the ticket and its children, then removes the worktrees."
  - phase-06-local-daemon.md:66 "`ask_owner` (comment and move to `needs_input`, then end the run)"
  - phase-07-agent-workflow.md:37 "`submit_report`, then `done`"
- **Suggested fix:**
  - Allow `* → cancelled` (owner only) from every non-terminal state.
  - Make cancel a server-side cascade: mark the whole subtree and emit one `ticket.cancelled` per distinct child assignee machine.
  - Have MCP tools perform the compound transitions atomically (`ask_owner` = todo/triage/in_progress → needs_input; owner comment on `needs_input` → server moves it to `in_progress` and emits the resume event).
  - Add a test that walks the full lifecycle through `canTransition()`.

## Finding 4: `blocked`, `backoff`, capped attempts and offline machines are dead ends with no exit event and no timeout
- **Severity:** High
- **Location:** phase-06 agent runner and heartbeat; phase-07 failure handling; phase-03 key insight "no lease"
- **Flaw:**
  - A job in `backoff` has no retry trigger, timer, or maximum duration.
  - A ticket in `blocked` can only go to `in_progress`, and nothing turns that transition into a job, because `status_changed` is not dispatched.
  - "Then the PM is notified" has no event type, since agent comments emit nothing.
  - If a machine dies or goes offline, its tickets sit in `in_progress` indefinitely. Heartbeats are collected, but the plan defines no server-side staleness rule. There is also no owner-facing "reassign to another machine" path, because `assignee_machine_id` is resolved once at creation.
  - An owner reopen (`done→in_progress`) likewise wakes no agent, and the parent's completion chain is not re-opened.
- **Failure scenario:** The shared subscription hits a rate limit at night. Three dev jobs go to `backoff`, and a comment is posted. The limit resets an hour later, but no job ever resumes. In another case, the laptop that owns project Y is retired. Its tickets and undelivered events remain pinned to the revoked machine, the owner cannot move them, and a re-paired machine gets a new id and receives nothing.
- **Evidence:**
  - phase-06-local-daemon.md:64 "the job goes to `backoff` and a comment is posted"
  - phase-07-agent-workflow.md:60-61 "Runner error, or max budget reached → `blocked` ... Attempts are capped at 2 per job, then the PM is notified."
  - phase-02-backend-core.md:73 (owner-only comment events)
  - phase-02-backend-core.md:68 "resolving the assignee machine from `machine_projects`" (resolved at create time)
  - phase-03-event-delivery.md:29 "the owner must release it first", with no reassignment of existing tickets or events.
  - phase-01-monorepo-foundation.md:61 "done ... can only be reopened by the owner, to `in_progress`"
- **Suggested fix:**
  - Give `backoff` a `retry_at`, with a scheduler tick and a cap after which the job goes to `blocked` and the owner is notified.
  - Emit `ticket.unblocked` or `ticket.reopened` events targeted at the assignee.
  - Add `agent.escalation` events targeted at the parent's assignee.
  - Add a server-side stale-machine sweeper (for example, no heartbeat for 10 min → flag the tickets and surface them in the owner inbox).
  - On project release or re-pair, re-resolve `assignee_machine_id` for open tickets and re-target their undelivered `event_deliveries`.

## Finding 5: Concurrent jobs resume the same session and run PM accept, including merges, more than once
- **Severity:** High
- **Location:** phase-06 dispatcher and scheduler; phase-07 pm (accept) row
- **Flaw:** Dedupe is by event id, not by (ticket, session). Several distinct events can target the same session at once:
  - A QC pass moves both the dev and QC subtasks to `done`, producing two `subtask.completed` events.
  - An owner can post two comments in quick succession.
  - An owner can comment while the PM job is still running.

  Each event becomes a separate job that runs `resume: session_id` in parallel. Nothing serializes jobs per ticket. The "all children done" condition is described as the trigger, but the event fires per child, so the condition must be evaluated inside the job, and two jobs can both see "all done".
- **Failure scenario:** QC passes. Two PM accept jobs start within a second, both resuming the PM session. Both merge `aj/DEV-1` into the integration branch and then into main, both push, and both sync docs. At best one fails with a non-fast-forward error and moves the PM ticket to `blocked`. At worst there are double merge commits and a corrupted session transcript from two concurrent writers.
- **Evidence:**
  - phase-06-local-daemon.md:42 "`seen_events(id)` for dedupe"
  - phase-06-local-daemon.md:51-52 "`ticket.comment_added` → resume the assignee's session", "`subtask.completed` → a PM re-evaluation job"
  - phase-07-agent-workflow.md:36-37 "Pass → the dev subtask moves to `done` and QC to `done`", "pm (accept) | `subtask.completed` (all children done)"
  - research/researcher-02-backend-realtime-docs-report.md:25 "Add a lease/visibility-timeout only if multiple daemons could ever race to claim the same ticket". The race here is within one daemon, which the plan's "no lease" argument (phase-03-event-delivery.md:20) does not cover.
- **Suggested fix:**
  - Enforce one active job per ticket in the daemon: a unique partial index on `jobs(ticket_id) WHERE status IN ('queued','running')`.
  - Coalesce new triggers into a `pending_wakeups` counter that re-runs once after the current job ends.
  - Evaluate "all children done" on the server, and emit a single `children.all_done` event, idempotent per ticket version.
  - Make merge an idempotent step keyed by `(pm_ticket, dev_branch_sha)`.

## Finding 6: "Resume running jobs after restart" replays non-idempotent side effects and cannot restart cleanly
- **Severity:** High
- **Location:** phase-06 Scheduler (restart), stream client, worktree manager; Success Criteria
- **Flaw:**
  - A crash between `query()` start and persisting the `init` `session_id` leaves `session_id` NULL, so there is nothing to resume.
  - A resumed session has no record of which MCP side effects already landed. `create_subtask`, `create_pm_ticket` and `comment` have no idempotency keys, so a re-run creates duplicate subtasks and PM tickets.
  - A retry, or attempt 2, calls `git worktree add ... -b aj/<key>` again, and it fails because the branch and path already exist.
  - The cursor is persisted after enqueue, but the plan does not say that enqueue, `seen_events` and the cursor share one SQLite transaction. A crash between them either loses the event (cursor advanced) or double-enqueues it.
  - The success criterion "no event is lost or double-processed" is asserted, but no mechanism guarantees it.
- **Failure scenario:** The daemon is killed by an OS update while the PM breakdown is halfway through, after creating 3 of 5 subtasks. On restart the session resumes, and the PM re-plans and creates 5 more. The server now has 8 subtasks and duplicate dev jobs. Separately, dev attempt 2 dies immediately with `fatal: a branch named 'aj/PRJ-14' already exists` and burns the last attempt, so the ticket goes to `blocked`.
- **Evidence:**
  - phase-06-local-daemon.md:58 "After a restart, jobs left `running` are resumed with their session id."
  - phase-06-local-daemon.md:61 "captures `session_id` from init"
  - phase-06-local-daemon.md:46 "persists the cursor after a job is enqueued, then acks"
  - phase-06-local-daemon.md:75 "`git worktree add <repo>/.aj/worktrees/<ticket-key> -b aj/<ticket-key> <base>`"
  - phase-06-local-daemon.md:121 "no event is lost or double-processed, and running jobs resume through their session id"
  - research/researcher-01-claude-code-headless-report.md:159: resume behaviour across machines is "not tested".
- **Suggested fix:**
  - Commit the job insert, the `seen_events` row and the cursor in one SQLite transaction before acking.
  - Add a client-generated `idempotency_key` (job id + tool call ordinal) to every mutating daemon endpoint, with a server-side unique constraint.
  - Make the worktree manager reuse or reset an existing worktree and branch.
  - When `session_id` is NULL, restart fresh with a prompt that includes the current server-side children and comments ("reconcile, don't recreate").
  - Add a crash-injection test at each of these boundaries.

## Finding 7: PM merge and QC review assume the branches exist on their machine
- **Severity:** High
- **Location:** phase-06 worktree manager; phase-07 merge policy, qc and pm (accept) rows
- **Flaw:**
  - Dev branches `aj/<key>` are created in a local worktree and are only pushed under the `pr` policy. With `local-merge`, a PM on another machine has nothing to merge.
  - Role ownership is per `(project, role)`, so dev, QC and PM can legitimately sit on different machines.
  - QC worktrees are also created with `-b aj/<qc-key> <base>`. `<base>` is not defined as the dev branch, so QC can end up testing the default branch without the dev changes and pass it.
  - Worktree removal "after the merge" needs a trigger on the dev machine, and there is none. Worktrees and branches accumulate.
- **Failure scenario:** PM is on machine A and dev and QC are on machine B, with `mergePolicy: local-merge`. PM accept runs `git merge aj/PRJ-15` and gets `merge: aj/PRJ-15 - not something we can merge`. The PM moves to `blocked`, or the agent improvises and pushes. Or QC on B, based on `main`, runs the tests green on unchanged code, marks the dev ticket `done`, and PM merges untested work.
- **Evidence:**
  - phase-06-local-daemon.md:75-76 "`git worktree add ... -b aj/<ticket-key> <base>` for dev and QC jobs ... Removed after the merge or cancel (Phase 7)."
  - phase-07-agent-workflow.md:37 "Merge `aj/<key>` branches into the ticket integration branch, then into the default branch"
  - phase-07-agent-workflow.md:54-56 "`local-merge`: fast-forward or merge into the default branch locally, then push."
  - phase-02-backend-core.md:45 unique `machine_projects(project_id, role)`: roles can be split across machines.
- **Suggested fix:**
  - Require dev to push `aj/<key>` to the remote before `in_review`, under both policies, and record the head SHA in the report.
  - Create the QC worktree from the dev report's commit SHA.
  - Have PM merge by SHA from the remote.
  - Emit a `ticket.closed` event to each child assignee's machine so it removes its worktree, and add a daemon-start GC for worktrees whose tickets are terminal.
  - Alternatively, enforce same-machine placement for dev, QC and PM per project at pairing time.

## Finding 8: The docs standard guarantees merge conflicts between parallel dev branches, and conflict resolution can fail R3
- **Severity:** High
- **Location:** phase-05 flow template, R3/R4, `check --range`; phase-07 merge-conflict risk
- **Flaw:**
  - Every code commit must modify the affected flow doc, and each flow doc has a "Change log: one line per commit" section.
  - The generated blocks in `index.md`/`files.md` must match `generate` output exactly.
  - Two parallel dev subtasks touching the same flow therefore always both append at the same place in the same file, and conflict textually. A PR-level text conflict always reaches this point.
  - The PM's answer is a "resolve conflicts" dev subtask. The resolver's merge commit, or a follow-up commit that touches source files, must itself satisfy R3 per commit under `check --range`. Those new flow-doc edits collide with any other in-flight branch, producing a loop.
  - Separately, `initializedAt` must hold the SHA of the docs-init commit, which cannot contain its own SHA. The pre-commit hook on the init commit meets R5 or an unset manifest, and the plan does not define the order.
- **Failure scenario:** The PM splits the work into DEV-1 (API route) and DEV-2 (service change), both in flow `ticket-assignment`. Both append Change log lines, and merging DEV-2 conflicts on `docs/flows/ticket-assignment.md`. The PM creates DEV-3 "resolve conflicts". Meanwhile DEV-4 from the next ticket also edits that flow doc, and so on, so throughput collapses to serial work. Separately, the docs-init job cannot produce a commit that both passes the hook and records its own SHA, so docs_init never reaches `done` and every job on the project stays gated (Finding 2).
- **Evidence:**
  - phase-05-docs-standard.md:69 "Change log: one line per commit that touched the flow"
  - phase-05-docs-standard.md:77 "R3 freshness | ... `docs/flows/<id>.md` of an affected flow is not modified in the same commit"
  - phase-05-docs-standard.md:78 "R4 generated | The flow list block ... differs from `aj-docs generate` output"
  - phase-05-docs-standard.md:83 "`check --range` ... each commit is checked on its own."
  - phase-05-docs-standard.md:43 "initializedAt: <commit sha of docs init>", and :86 "The docs-init commit is exempt from R3 and is identified by the manifest's `initializedAt`."
  - phase-07-agent-workflow.md:116 "On a conflict it creates a dev subtask 'resolve conflicts' instead of forcing."
- **Suggested fix:**
  - Drop the in-file per-commit change log, since git log already provides it. Otherwise register a `merge=union` driver in `.gitattributes` for `docs/flows/*.md` changelog sections, and have `aj-docs generate` run as a post-merge step instead of being hand-merged.
  - Define R3 for merge commits (compare against the first parent, and exempt clean merges).
  - Set `initializedAt` to the parent SHA ("docs are enforced for commits after X"), or use a `docs-init: true` commit trailer instead of a self-referencing SHA.
  - Add a two-parallel-devs-same-flow case to the Phase 7 live scenario.

## Finding 9: Cursor and ack are two competing delivery contracts, so a failed handler can lose an event
- **Severity:** Medium
- **Location:** phase-03 stream and ack; phase-06 stream client
- **Flaw:** Replay sends "unacked events with `id > cursor`", which intersects the two conditions. Redelivery of events unacked for 60 s happens only "on the open stream". The daemon persists the cursor per event after enqueue.
  - If event 41's handler throws (for example, a transient SQLite lock or a dispatcher bug) while event 42 succeeds, the cursor moves to 42. On reconnect event 41 falls below the cursor and is never replayed.
  - If the stream is down at the 60 s mark, redelivery waits for the next connect, which filters by cursor again.
  - The owner stream (`/v1/stream`) has no cursor at all, so the web misses events across a reconnect with no signal to refetch.
- **Failure scenario:** The daemon's disk is briefly full. The enqueue for a `ticket.assigned` event throws, and the next `ticket.comment_added` event enqueues fine and advances the cursor. After a restart the assignment is gone for good, and the ticket sits in `todo` with no job.
- **Evidence:**
  - phase-03-event-delivery.md:34 "replays unacked events for the machine with `id > cursor`"
  - phase-03-event-delivery.md:37 "Unacked events older than 60 s are re-sent on the open stream."
  - phase-06-local-daemon.md:46 "persists the cursor after a job is enqueued, then acks."
  - phase-03-event-delivery.md:48 "Owner SSE `GET /v1/stream` pushes every event": no cursor or replay.
- **Suggested fix:** Make the ack the single source of truth. On connect, replay all events with `delivered_at IS NULL` for the machine regardless of cursor, and keep the cursor only as a live-stream optimization. Persist the cursor as the low-water mark of contiguous handled ids, not the latest id. Add `Last-Event-ID` support or a "refetch all" signal on reconnect for the owner stream. Add a test that injects a handler failure between two events.

## Finding 10: The end-to-end tests cannot catch any of the above
- **Severity:** Medium
- **Location:** phase-07 step 8 live scenario; phase-08 E2E; plan.md Success Criteria
- **Flaw:**
  - The only full-chain test is a single-machine, single-dev, happy-path scenario that is opt-in (`AJ_LIVE_AGENT_TESTS=1`) and outside CI.
  - The default E2E mocks the chain down to a login, a status change, and one `needs_input` answer.
  - No test covers:
    - a QC fail and reopen
    - cross-machine roles
    - two parallel devs touching one flow
    - cancelling an `in_progress` ticket
    - a crash mid-breakdown
    - a rate-limit `backoff` recovery
    - owner re-pairing
  - The Success Criteria claim properties such as "no event is lost or double-processed" and "Completion propagates dev/QC → PM → assistant" that only these untested paths would exercise.
- **Failure scenario:** Everything ships green. The first real ticket with a QC failure, or with dev on a second laptop, freezes silently in production, and the owner discovers it days later through an empty inbox.
- **Evidence:**
  - phase-07-agent-workflow.md:86-93 (a single happy path: "dev implements, QC passes")
  - phase-08-deploy-and-e2e.md:35 "The full agent chain runs in the live scenario of Phase 7 (`AJ_LIVE_AGENT_TESTS=1`), not in default CI"
  - phase-06-local-daemon.md:121, plan.md:74
- **Suggested fix:**
  - Add a deterministic agent stub (a scripted `runAgent` that calls MCP tools per a fixture) so the full lifecycle runs in default CI at zero cost. Real models are still used in the live gate.
  - Build a scenario matrix: QC fail→reopen→pass; dev and QC on machine B with PM on machine A; cancel while `in_progress`; kill -9 during breakdown; backoff→resume; project release and re-pair.
  - Add a "no ticket non-terminal without an active job or pending owner input for more than N minutes" invariant check as a CI assertion and a production alarm.

---

Status: DONE
Summary: Ten findings. Three are Critical: the dev/QC gating deadlock with no reopen events; no cross-machine dependency notification; and a status workflow that cannot cancel active tickets or perform the transitions agents rely on. Together they mean the traced lifecycle cannot complete once QC or a second machine is involved.
Unresolved questions:
- Are dev, QC and PM for one project expected to run on the same machine? If so, enforce it at pairing, which removes much of Findings 2 and 7.
- Is the per-commit "Change log" in flow docs a hard owner requirement, or can git history replace it?
