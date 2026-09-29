# Agent activity and job wait reasons — implementation report

Status: completed. Branch `worktree-agent-a1e0313911bfbed8d` (not pushed).

## Why

AST-1 was assigned at 11:26 and the owner's daemon queued it, but the machine had no free slot (load
22.97 on 12 CPUs with `maxLoadPerCpu` 1.5). The web only showed "Cần làm". The daemon logged nothing about
the deferral, and when the job later crashed (`ENOENT … prompts/assistant-triage.md`) the ticket got no
comment and did not change status.

## What changed

- **Daemon.** The scheduler records why each held job waits (`jobs.wait_reason`/`wait_detail`), writing
  only when the reason changes, and logs "job waiting" with the ticket key once per change of reason.
  `decide()` now returns machine-readable reasons: `project_not_here`, `no_local_folder`,
  `not_assistant_host` and `over_budget`, plus the keys of every unfinished dependency. Other cases are
  `no_slots` (slot blocked), `check_failed` (the start checks threw or the API was unreachable), `paused`
  and `retry_at` (these two are overlaid when the heartbeat is built).
- **Heartbeat.** Running jobs carry stage, model and effort. Waiting jobs carry role, kind, stage, since
  and the wait reason; `no_slots` also carries live load, CPUs, max load, free RAM, the memory floor,
  slots and running jobs. The new `failedJobs` field holds each ticket's latest failed job for 24 h. A
  heartbeat is also sent immediately whenever a job changes status or its wait reason changes, not only
  every 30 s.
- **Job crash policy.** A crash outside the agent run (planner or prompt render, worktree preparation,
  the API) now marks the job `failed` with the scrubbed error class, errno code and message. It posts a
  Vietnamese comment on the ticket and blocks the ticket when `canTransition('agent', status, 'blocked')`
  allows it. The owner's unblock re-queues the ticket; while it cannot be blocked (for example `todo`), an
  owner comment does. A worktree preparation failure used to end the job silently and is now handled the
  same way.
- **API.** New `machines.waiting_jobs` and `machines.failed_jobs` columns (migration 0005). The heartbeat
  diffs each ticket's reported state, ignoring load numbers. When anything changed, it emits one
  owner-stream event, `agent.activity_changed`, and it treats every ticket as changed after a stale
  report. `GET /v1/tickets` and `GET /v1/tickets/:id` (ticket and children) return `agentActivity`:
  - `running`, `queued` or `backoff` when a fresh heartbeat reports the job;
  - `failed` when the ticket's latest job failed;
  - `unknown` when the reporting machine is offline or silent for more than 2 min;
  - `unreported` for a `todo` ticket no machine reports, naming its assigned machine and whether that
    machine is online.
- **Web.** Ticket views (side panel and full page, all viewports) show an activity line, for example:
  - "Đang chạy trên X · sonnet/high · từ 11:32"
  - "X đã nhận, đang chờ slot — máy bận (tải 23/18, 0 slot trống)"
  - "Chờ AST-3 xong"
  - "Chờ thử lại lúc 11:45"
  - "Lỗi khi chạy trên X: …"
  - "Chưa máy nào nhận (máy trợ lý X offline)"
  - "Không rõ — X mất liên lạc"

  Board cards show a waiting, failed or unknown mark; a running job keeps the avatar spinner. The
  machines page lists each machine's running, waiting and failed jobs with ticket keys and reasons. Live
  updates come through `agent.activity_changed`, and the web also treats a heartbeat older than 2 min as
  unknown.

## Decisions

- **Storage.** The per-machine lists are stored as jsonb columns on `machines`, next to `running_jobs`,
  rather than in a new table or in memory. They survive an API restart, and the ticket reads join only
  the owner's few machines.
- **New event.** `agent.activity_changed` has no `ticketId`, so it never appears in a ticket's history
  timeline and does not reset the stuck-ticket timer.
- **Backward compatibility.** The heartbeat fields are additive. An unknown wait reason or a malformed
  detail from a newer daemon is dropped instead of failing the heartbeat.
- **Scope of `unreported`.** It is shown only for `todo` tickets. Other statuses without a report (for
  example a PM task waiting for its children) show nothing rather than a misleading "nobody took it".

## Verification

- `pnpm -r typecheck`, `pnpm lint` and `pnpm -r build` pass.
- `pnpm -r test` passes on isolated databases (`crew_vis_*`). The final daemon run passed on its own
  (157 tests). An earlier run had one failure in a test that binds fixed ports 4321/4322, while another
  agent's daemon suite was running at the same time; see the concerns below.
- The web E2E suite passes: 14 tests at the phone, tablet and desktop viewports, including the new
  `agent-activity.spec.ts`.
- New tests:
  - `apps/api/test/agent-activity.test.ts`
  - the wait-reason case in `apps/daemon/test/scheduler.test.ts`
  - the extended heartbeat case in `apps/daemon/test/daemon-extras.test.ts`
  - the crash-before-run case in `apps/daemon/test/daemon.test.ts`: blocked, commented, reported as
    failed, re-run after unblock
  - `apps/web/src/components/agent-activity.test.tsx`
  - `apps/web/e2e/agent-activity.spec.ts`
- Docs: the Vietnamese flow docs were written by a sonnet subagent and checked; `crew-docs check --staged`
  passes.

## Concerns

- **Shared test resources.** The daemon global setup read `TEST_DATABASE_URL` in the main process and
  ignored `DAEMON_TEST_DATABASE_URL`, so one early run recreated the schema of the default
  `crew_daemon_test`. `apps/daemon/vitest.config.ts` now sets it, the same way the desktop config does.
  Separately, the daemon test "stops what a job started…" uses fixed ports, so it collides when two
  daemon suites run at once.
- **`releaseLostProjects()`.** It changes job status without emitting a `job` event, so those changes
  reach the server on the next timed heartbeat (at most 30 s), not immediately.
