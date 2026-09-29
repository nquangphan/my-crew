# No Fable (Validation Session 18) and the PM `rate_subtask` tool: Implementation Report

Date: 2026-09-29 · Status: done · Branch: `main`, uncommitted (as asked) · Scope: `packages/shared`, `apps/api`,
`apps/daemon`, `apps/desktop`, `docs/`, `phase-07-agent-workflow.md`.

No run can resolve to Fable any more, no input accepts it, and the desktop app no longer offers it. The database
enum is unchanged, so no migration is needed. The PM has a new tool, `rate_subtask`, that rates an existing
subtask in place. When the subtask was blocked because it had no rating, the tool also puts it back in the queue.
The full suite, lint, build, the web E2E and the desktop Electron E2E all pass. The commit gate passes on a
temporary index built from HEAD plus this change, with no trailer.

## 1. Fable is not used

- **Shared schemas.** `SelectableModel` (`haiku | sonnet | opus`) is new in `agent-schemas.ts`. Its error message
  is "model phải là haiku, sonnet hoặc opus: Fable không được dùng (quyết định của chủ dự án)." These inputs now
  use it: `CreateSubtaskRequest.model`, the new `RateSubtaskRequest.model`, and the desktop IPC `ModelSettings`
  (allowlist and complexity map). `DOCS_MODEL` is typed with it too. `ModelAlias` still includes `fable`, but only
  for stored values: `Ticket.model` in the DTO and the Postgres column.
- **API.** A subtask create request or a rating with `model: 'fable'` gets 400 `VALIDATION_FAILED`, with
  `details: [{ path: 'model', message: … }]`. The owner request and `PATCH /v1/tickets/:id` never accepted a
  model, so they did not change.
- **Postgres enum.** `modelAliasEnum` now lists its values explicitly: `['haiku', 'sonnet', 'opus', 'fable']`. It
  is type-checked with `satisfies [ModelAlias, ...ModelAlias[]]` and no longer derived from the TS enum. Running
  `drizzle-kit generate` reports "No schema changes", so there is no migration. A test pins these values.
- **`model-policy.ts`.** The strength ladder is now `opus > sonnet > haiku`, typed with `SelectableModel`, so
  `resolveModel` and `clampModel` can only return a selectable model. A legacy ticket whose stored model is
  `fable` runs on `opus`, with the notice comment "Ticket này còn đặt model `fable` từ trước, nhưng Fable không
  còn được dùng, nên lượt chạy dùng `opus`." The allowlist clamp still applies after that, and both notices are
  posted when both apply. `chooseModel()` in `job-runner.ts` also maps fable to opus.
- **Daemon config.** `models.allow` and complexity map entries still accept a stored `fable`, and the parse cleans
  it up. `fable` is removed from `allow`, and a map entry on fable becomes opus with the same effort. The parsed
  `DaemonConfig` type therefore only contains selectable models. `loadConfig(path, warn?)` warns once per file:
  by default as a JSON line on stderr, and in the desktop host as an app-log entry with the event
  `config-legacy-model`. `saveConfig` writes the parsed values, so the next save rewrites the file without
  fable. An allowlist of only `[fable]` is still invalid, because it has no sonnet, as before.
- **Desktop.** The resource form builds its model list from `SelectableModel.options`. The allowlist checkboxes
  and the complexity-map selects offer only haiku, sonnet and opus.
- **PM prompt.** `pm-analyze.md` no longer mentions Fable. It says the models are haiku, sonnet and opus, and that
  the strongest is opus (for `large`).

## 2. `rate_subtask`: the PM rates an existing subtask in place

- **Route.** `POST /v1/daemon/tickets/:id/rate-subtask`, where `:id` is the PM's own pm_task. It goes through the
  existing `ticketWrite` helper, which applies the machine scope and requires an `Idempotency-Key` whose stored
  response is replayed on retry. The body is `RateSubtaskRequest`:
  `{ ticket (id or key), complexity, complexityReason, model?, effort? }`. Its Vietnamese messages match the
  ones on create.
- **Service `rateSubtask()` in `ticket-service.ts`.** It locks the pm_task and then the child, top-down, like
  every other writer. It refuses the request in these cases:
  - the `:id` ticket is not a pm_task (403 `FORBIDDEN`), so a dev or QC run cannot rate, even a sibling;
  - the target is not a `dev`, `qc` or `bug` child of that pm_task (403): `docs_init`, the pm_task itself, and
    tickets in other trees or projects are refused;
  - the target is `done` or `cancelled` (409 `TICKET_CLOSED`);
  - another machine calls it (403, from the existing scope check).
- **What a rating changes.** The new rating replaces the old one. A model or effort override that is not given
  again is cleared, so an earlier override (including a stored `fable`) cannot silently defeat the new rating.
  The service emits `ticket.updated` with `change: 'fields'` on the owner stream, and the web Details box
  updates live, as it already did for that event. A job that is already running keeps its model. The next run
  resolves the new rating, because the model is chosen when a job launches.
- **Re-queue.** When the target is `blocked` and has no rating (the `MissingComplexityError` crash path), the
  same transaction moves it to `in_progress`. It then emits `ticket.status_changed` and `ticket.unblocked` to the
  machine that owns the ticket. The daemon's dispatcher already enqueues an agent job on `ticket.unblocked`, so
  the ticket runs on the new model without the owner. A ticket that is blocked for another reason (it already
  had a rating) stays blocked.
- **Agent tool.** `rate_subtask` is a PM-only tool, listed after `create_subtask` in `tool-scopes.ts`. Its
  `model` input is `SelectableModel`, and it calls `VpsClient.rateSubtask()` through the job's `JobWriter`, which
  supplies the `<jobId>:<seq>` Idempotency-Key.
- **Crash comment and prompts.**
  - The `MissingComplexityError` message now tells the PM to rate the ticket in place with `rate_subtask`, not to
    create a replacement, and says that the ticket will then run again.
  - `pm-analyze.md` tells the PM to re-rate a subtask that has not started with `rate_subtask`, and to rate any
    existing unrated subtask instead of recreating it.
  - `pm-monitor.md` has a new "Bước 4: đánh giá lại subtask". It covers a blocked unrated subtask and
    re-rating once the PM learns more, and says that a running job keeps its model.

## 3. Tests

- **API: new file `apps/api/test/rate-subtask.test.ts` (9 tests).** It covers:
  - Fable is refused on create and on a rating, with the message checked, and the stored enum values are pinned;
  - a rating in place clears a legacy `fable`/`max` override, emits one `ticket.updated`, and shows in the
    owner's ticket detail;
  - a QC override with its reason is accepted;
  - an Idempotency-Key replay writes once, and a request without a key is refused;
  - validation: missing fields, a bad complexity value and a blank reason;
  - scoping: another machine, a dev or QC caller, another project's tree, `docs_init`, the pm_task itself,
    `done`, `cancelled` and an unknown key are all refused, and nothing is written;
  - re-queue of a blocked unrated ticket: it goes to `in_progress`, and `ticket.unblocked` targets the owning
    machine with the dev role;
  - a ticket blocked for another reason stays blocked;
  - a bug that QC filed can be rated.
- **Daemon.**
  - `daemon.test.ts`: the legacy-ticket test now goes further. The comment names `rate_subtask`. After the PM
    rates the ticket `large`, the daemon runs it again on its own (trigger `ticket.unblocked`) on opus/high.
  - `ticket-tools.test.ts`: the PM tool list includes `rate_subtask`. The tool rates a ticket through the real
    API. `model: 'fable'` fails the tool's input schema. A dev context is refused with `FORBIDDEN`, and the dev
    role does not see the tool.
  - `model-policy.test.ts`: fable is never resolved. For every stage, stored model and rating, the result is a
    `SelectableModel`. A legacy fable runs on opus with its notice, together with the clamp notice when opus is
    not allowed. The Fable-allowlist case was removed.
  - `units.test.ts`: a `config.yaml` that has fable in `allow` and in `complexityMap.large` loads cleanly. It
    warns once across two loads, names both fields, and a save removes fable from the file.
  - New lifecycle scenario `17-pm-rates-in-place.yaml` (`pm-rates-in-place`). The PM creates two dev subtasks
    rated `small`, the second waiting for the first. It then re-rates the second to `large` by key. There are
    still exactly two dev tickets. The first runs on sonnet/medium and the second on opus/high, and the PM's run
    logged one `rate_subtask` call. The `pm_analyze` macro gained a `rates` list for this.
- **Desktop Electron E2E.** Onboarding step 6 checks that the allowlist has no fable checkbox and that the
  complexity select offers exactly haiku, sonnet and opus.

## 4. Docs

These were written on sonnet (owner decision), then checked against the code and the diff:
- flow docs: `ticket-lifecycle` (a new step for `rateSubtask`, with later steps renumbered), `agent-roles`,
  `agent-runs`, `daemon-api`, `daemon-runtime` and `desktop-app`. `api-platform` (the explicit enum values),
  `desktop-ui` (the model list without Fable) and `owner-auth` (`api-schemas.ts` is shared with that flow) were
  added after the first gate run flagged them under R3;
- `docs/flows.yaml`, flows section only: `apps/api/test/rate-subtask.test.ts` was added under `ticket-lifecycle`;
- `docs/files.md`, regenerated;
- `phase-07-agent-workflow.md`: the "Fable only with a written reason" rule is removed and replaced by the owner
  decision that Fable is not used and opus is the strongest model. The remedy for an unrated ticket is now
  `rate_subtask`.

## 5. Verification

- `pnpm -r typecheck`, `pnpm lint` and `pnpm -r build` pass. The suites were run one at a time: shared 16, api 188,
  daemon 169 (plus 4 skipped live tests), web 70, desktop 41 and docs-kit 39, all passing.
- `crew-docs check --all` passes.
- Web E2E: 14 passed. Playwright started and stopped its own API and web servers.
- Desktop Electron E2E: 5 passed. I re-staged the app first with `stage-app.mjs`, because the `--if-missing`
  stage from 12:57 was stale. Playwright started and stopped its own API on port 8799.
- Commit gate on a temporary index (HEAD plus this change, excluding the controller's `plan.md`):
  `crew-docs check --staged` exits 0, and `--commit-msg` exits 0 with a message that has no trailer.
- No process I started is still running.

## Notes and open questions

- **Nothing wakes the PM when a child is blocked for having no rating.** The crash path blocks the ticket and
  comments on it, but the PM only sees this on its next run: a monitor run, an owner comment on the pm_task, or
  accept. The prompts cover each of these. Waking the pm_task from the crash path would be a small daemon
  change. I did not add it because it was not requested.
- **A re-rating clears an earlier model or effort override** that is not repeated. This follows from "the new
  rating applies", and the tool description tells the PM. Say if overrides should survive instead.
- **Only a blocked ticket with no rating is re-queued.** A ticket that had a rating and was blocked for another
  reason (a crash, or a missing UI-test MCP server) still needs the owner to unblock it.
