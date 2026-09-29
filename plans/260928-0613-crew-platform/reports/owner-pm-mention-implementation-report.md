# Owner wakes the PM with `@pm` (Validation Session 20): Implementation Report

Date: 2026-09-29 · Status: done · Branch: `main`, uncommitted (as asked) · Scope: `apps/api`, `apps/daemon`,
`apps/web` (ticket view and comments), `packages/shared` (additive), `docs/`, `phase-07-agent-workflow.md`.

An owner comment that tags `@pm` on any ticket of a pm_task tree now wakes that tree's PM, and only the PM. The
PM run gets the owner's comment and the tagged ticket as context, handles the call and replies on the tagged
ticket. The web suggests `@pm` while typing and marks tagged comments. No database migration was needed. Lint,
typecheck, every package's tests, the build and the full web E2E pass, and the commit gate passes on a temporary
index built from HEAD plus this change, with no trailer.

## Decisions (chosen and documented)

1. **New event, not a field.** `ticket.pm_mentioned` is added to the event union (additive):
   `data: { ticketId: <pm_task>, sourceTicketId, sourceTicketKey, commentId }`, envelope `ticketId` = pm_task,
   `targetMachineId` = the project's owner machine (the pm_task's assignee machine as a fallback),
   `targetRole: 'pm'`. A separate type keeps `ticket.comment_added` meaning "wake this ticket's agent" and lets
   the daemon wake a different ticket (the pm_task) with the normal one-job-per-ticket rules.
2. **The tag replaces the ticket's own wake-up.** A tagged comment emits only `ticket.pm_mentioned`: the tagged
   ticket's agent is not woken and its status is not touched (a `needs_input` dev stays `needs_input`, so it
   cannot end up `in_progress` with no job). A tag on the pm_task itself also does the usual owner answer there
   (`needs_input → in_progress`, cap or budget hold lifted), because the PM is that ticket's own agent. A tag on
   a closed subtask of an open tree still wakes the PM (the owner may be reporting a problem with finished work).
3. **No tree, no call: 400.** A tag on a ticket without a pm_task tree (an assistant `request`) or whose pm_task
   is `done`/`cancelled` returns 400 with the new code `PM_NOT_AVAILABLE`; nothing is stored or woken. The web
   shows "Không gọi được PM: ticket này không thuộc PM task nào đang mở. Bỏ @pm để gửi bình luận thường." and
   keeps the text. The composer does not suggest `@pm` on request tickets.
4. **`mentions` is read, not stored.** `Comment.mentions` (`['pm']` or `[]`, zod default `[]`) is computed from
   owner comment text by the shared `parseMentions`. Because a tagged comment is only stored when a PM was woken,
   the read value is exact, and no migration was needed (this also keeps clear of the BMAD branch's `0007`).
5. **A waiting pm_task still answers the call.** A PM job that carries a mention is not skipped when the pm_task
   is `needs_input`, `blocked` or `in_review`; it runs in `pm_monitor` (the stage that replies to the owner)
   and the prompt tells the PM not to change the pm_task's status. Untagged wake-ups of a waiting pm_task are
   still skipped. Otherwise the stage is resolved as before, with the call section added to the prompt.
6. **Unblock/retry needed a tool.** The PM had no way to send a blocked subtask back to work, so it gets
   `retry_subtask` (route `POST /v1/daemon/tickets/:id/retry-subtask`): a blocked dev/qc/bug/docs_init child of
   its pm_task moves `blocked → in_progress` and its agent is woken with `ticket.unblocked`. The daemon refuses
   the tool unless the current job answers an owner `@pm` call.
7. **Replies land on the tagged ticket.** The `comment` tool takes an optional `ticket`; only a PM run on a
   pm_task may use it, and only for that pm_task's own subtasks.

## What changed

- **Shared.** `comment-mentions.ts` (`CommentMention`, `parseMentions`: case-insensitive whole-word `@pm`;
  ignores fenced code blocks, inline code spans, e-mail addresses and URLs). `Comment.mentions`,
  `RetrySubtaskRequest`, error code `PM_NOT_AVAILABLE`, event `ticket.pm_mentioned`.
- **API.** `addComment` resolves the pm_task (`governingPmTask`), refuses or emits the PM wake-up, and shares the
  `needs_input` answer with the untagged path (`answerNeedsInput`). `toCommentDto` is the single comment
  mapper for the owner route, the daemon route and the ticket detail. `retrySubtask` service and daemon route.
- **Daemon.** The dispatcher treats `ticket.pm_mentioned` as a wake event of the pm_task's PM (new job resuming
  the PM session, absorbed by a queued job, or folded into `pending_wakeups` when the PM job is running) and
  records the call in the new local table `pm_mentions`. The role planner adds "## Chủ dự án gọi PM (@pm)" to the
  PM prompt: per call (newest five) the tagged ticket's key, type, status and rating, its title (wrapped unless
  owner-written), the daemon's last job error and, when blocked, the last agent or system comment (both wrapped
  as untrusted), and the owner's comment verbatim (not wrapped), then what the PM may do (`rate_subtask`,
  `retry_subtask`, `create_subtask`, `ask_owner` to confirm a cancel or clarify) and that it must reply with
  `comment` on the tagged ticket. `pm-monitor.md` step 5 points at that section.
- **Web.** The composer suggests `@pm` after `@`, `@p` or `@pm` (Enter, Tab or click inserts `@pm `, Escape
  hides it). Tagged comments show "Đã gọi PM" and, on a subtask, "Xem <pm_task key>", which opens the pm_task
  where the existing agent activity line shows the PM job. The pm_task history shows "Bạn gọi PM (@pm) từ
  <key>". Live events refresh ticket views on the new event.

## Tests

- **API** `apps/api/test/pm-mention.test.ts`: the tag wakes the tree's PM from the pm_task, dev, qc, bug and
  docs_init tickets with the right target machine and role, and never emits `ticket.comment_added`; a
  `needs_input` child is left alone; the pm_task's own `needs_input` is answered; a closed subtask of an open
  tree still wakes the PM; tags in code, inside words and in e-mail addresses are ignored; agent comments never
  count; the HTTP responses and the ticket detail carry `mentions`; 400 `PM_NOT_AVAILABLE` on a request and on a
  closed tree with nothing stored; `retrySubtask` rules and the idempotent daemon route.
- **Shared** `comment-mentions.test.ts`: 20 parsing cases.
- **Daemon** `dispatcher.test.ts` (enqueue, absorb, fold into one follow-up, recorded once),
  `ticket-tools.test.ts` (reply on a subtask, refusal outside the tree and for other roles, `retry_subtask`
  refused without a call and allowed with one), new `pm-mention.test.ts` (prompt context with the owner's text
  unwrapped and the rest wrapped, no job for the tagged ticket, a waiting pm_task answered in `pm_monitor`
  without a status change, an untagged wake-up of a waiting pm_task still skipped), and lifecycle scenario
  `18-owner-calls-pm.yaml`: a dev ticket loses its rating, its run after the owner's answer cannot choose a
  model and is blocked, the owner tags `@pm` on it, only the PM wakes, runs `rate_subtask` and replies on the
  dev, and the dev reruns on the new rating (`ticket.unblocked`) until the tree is done.
- **Web** `comment-thread.test.tsx` (suggestion, Enter, click, Escape, no suggestion where no PM can be called,
  refused-tag message, label and opening the pm_task) and E2E `e2e/pm-mention.spec.ts` at the three viewports
  (suggestion, label, "Xem" opens the pm_task whose activity line shows the running PM job, history line).

## Verification

- `pnpm lint`, `pnpm -r typecheck`, `pnpm -r build`: pass.
- Tests (run one package at a time): shared 36, api 200, web 74, docs-kit 39, daemon 177 (+4 skipped live
  tests), desktop 41: all pass. Web E2E: 17 passed.
- Commit gate on a temporary index built from HEAD plus this change (`plan.md` excluded, real index untouched):
  `crew-docs check --staged` ok and `crew-docs check --commit-msg` ok with a plain conventional subject and no
  trailer. `crew-docs check --all` ok.

## Docs

Written by a sonnet subagent (owner decision) and checked against the code: `docs/flows/` `ticket-lifecycle`,
`event-delivery`, `daemon-scheduling`, `daemon-runtime`, `agent-roles`, `agent-runs`, `daemon-api`,
`api-platform`, `owner-auth`, `web-tickets`, `web-shell`, and the Role Contracts and Requirements of
`phase-07-agent-workflow.md`. `docs/flows.yaml` (flows section only) lists `comment-mentions.ts` under
`ticket-lifecycle` and the new tests; `docs/files.md` regenerated with `crew-docs generate`. Three inaccuracies
were corrected on review (a split code span, a wrong step reference, a test described as checking idempotency).

## Residual concerns

- A legacy unrated subtask that is still `todo` when its run fails cannot be moved to `blocked` by the crash
  path (no agent edge `todo → blocked`); it keeps `todo` with the crash comment. `rate_subtask` requeues only a
  `blocked` unrated ticket, so after the PM rates such a `todo` ticket nothing reruns it until the owner comments
  on it (untagged). Unchanged behaviour from Session 17; a fix would be to let `rate_subtask` also wake an
  unrated `todo` ticket.
- The "Xem <key>" button in the comment meta line is text-sized on phones (below the 44 px touch target), like
  the other meta-line controls there.
