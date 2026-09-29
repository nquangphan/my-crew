# Implementation report: root Markdown as docs, QC UI test only for non-docs diffs, board badge overflow

Plan: `plans/260928-0613-crew-platform/plan.md`, Validation Session 22 (owner decisions 1-3). Status: done, not
committed. The crew-docs checks pass on a temporary index built from HEAD plus this change.

## 1. Root Markdown files are docs

- `apps/daemon/src/runner/guard-hook.ts`: there is now one shared predicate, `isDocsPath(rel)`. It matches
  `docs/**` and Markdown files directly at the repo root, except `AGENTS.md` and `CLAUDE.md`. The match is
  case-insensitive because macOS worktrees are.
  - `docs_update` may write any docs path.
  - A `codeOnly` dev or bug run may write none of them. Its deny message names README.md and the other root
    Markdown files.
  - All other guard rules are unchanged. `CLAUDE.md` stays R6-protected (only `docs_init` may write it).
    `AGENTS.md` is still writable by a dev run and not by the docs job, which is the same as before.
- `apps/daemon/src/roles/docs-first-check.ts`: reading a docs path, including the root README, no longer counts
  as a source read. It uses the same predicate.
- Prompts:
  - `dev.md`: defines what counts as docs, and says a docs-only subtask calls `handoff_docs` right away with an
    empty `files` and a summary of what the docs job must write.
  - `docs-update.md`: the docs job writes README and the other root Markdown files.
  - `pm-analyze.md`: the PM breakdown never asks dev to write README or docs.
  - `_shared-rules.md` is unchanged because nothing in it needed updating.
- Handoff and commit path: I checked it and nothing needed fixing. `DocsHandoff.files` already defaults to `[]`.
  The default `source.include` does not cover a root README, so R2 and R3 do not apply. A commit that changes
  only `README.md` passes the real hooks, as the lifecycle scenario shows.

## 2. QC UI-test MCP only for UI changes

- `role-planner.ts`:
  - `diffNeedsUiTest(repo, base, head)` runs `git diff --name-only --no-renames -z <base>...<head>`. The diff
    needs the UI test when any changed file is not a docs path. If the diff cannot be proven docs-only (git
    error, unknown commit or empty diff), the UI test is still required.
  - `qcNeedsUiTest()` compares the paired dev or bug report's `head_sha` with the project's default branch, in
    `repoPath`. That is the same diff QC is told to review.
- For a docs-only diff:
  - The pre-run "MCP chưa kết nối" block is skipped.
  - The `{{ui_test}}` prompt text says a static review is enough and that the report must contain exactly
    "Không có thay đổi giao diện (chỉ docs) nên không chạy test UI." (`DOCS_ONLY_QC_NOTE`).
  - The plan returns `requiredMcps: []`.
- `job-runner.ts`: the new field `PlannedRun.requiredMcps` produces a `runTicket`, which is the ticket with the
  narrower MCP list. It is used by:
  - the tool context, which feeds the `unusedUiServers` done-gate;
  - `reportOverlay`, `reportFields` and `defaultReportFields`;
  - `afterRun`.

  As a result, a docs-only QC run gets no "MCP bắt buộc chưa dùng" warning and its `mcpsMissing` is empty. The
  ticket's own `required_mcps` on the server is unchanged.
- There is no server-side QC gate in `apps/api`, so nothing changed there.
- `qc.md`, step 4: the UI test is required when the diff changes source files.

## 3. Board card project badge overflow

- `project-badge.tsx`: `ProjectBadge` is now `inline-block min-w-0 max-w-full truncate` instead of
  `shrink-0 whitespace-nowrap`. It shrinks to an ellipsis, and the tooltip still shows the full key.
- `ticket-card.tsx`: the key/badge row wraps (`flex-wrap min-w-0`) and the card has `min-w-0`.
- The list rows and the ticket tree use the same badge, so they get the same fix.
- E2E (`cross-project-views.spec.ts`):
  - The second project now uses 10-character keys (the maximum).
  - `expectBadgeInside()` checks the badge's bounding box against the board card, the list row or cell, and the
    tree row, at phone, tablet and desktop.
  - Before the fix, the check failed on desktop: the badge's right edge was at 1080 against a card edge of 1016.
    After the fix it passes at all three viewports.

## Tests

- New and updated tests:
  - `guard-hook.test.ts`: the docs job may write README, CHANGELOG and CONTRIBUTING, and may not write
    `AGENTS.md`, `agents.md`, `CLAUDE.md`, `src/notes.md` or `src/…`. `docs_init` may still write `CLAUDE.md`.
  - `role-policies.test.ts`: `diffNeedsUiTest` cases (docs-only, source file, `AGENTS.md`, nested `.md`, a rename
    out of `src`, an empty diff, an unknown commit). Also checks that dev cannot write README or CHANGELOG.
  - `ticket-tools.test.ts`: QC with `requiredMcps: []` can close. The existing test still covers a QC with
    required servers being blocked.
  - `docs-first-check.test.ts`.
  - New lifecycle scenario `19-docs-only-readme.yaml`, which checks the whole path:
    - dev is denied README and hands off without touching code;
    - the docs job commits `README.md` alone through the hooks;
    - QC closes without Playwright (not connected on the machine) and its report contains the note;
    - PM merges and pushes.

    With the docs-only check disabled, this scenario fails.
  - Scenario 14, `qc-mcp-missing`, is unchanged and still passes: a source diff is still blocked when the UI MCP
    is missing.
- Gate results, all passing:

  | Check | Result |
  |---|---|
  | `pnpm -r typecheck` | pass |
  | `pnpm -r --workspace-concurrency=1 test` | pass |
  | `pnpm lint` | pass |
  | `pnpm -r build` | pass |
  | Web E2E | 20/20 |
  | Desktop Electron E2E (after restaging the app) | 6/6 |

- Nothing was left running.

## Docs

- A sonnet subagent wrote the Vietnamese updates to `docs/flows/agent-runs.md`, `docs/flows/agent-roles.md`,
  `docs/flows/web-tickets.md` and `phase-07-agent-workflow.md`. I checked them against the diff and fixed two
  sentences.
- `crew-docs generate`: `docs/index.md` and `docs/files.md` are unchanged.
- On a temporary index built from HEAD plus this change, `check --staged` and `--commit-msg` both pass with no
  trailer.

## Open questions

- Session 22 says `AGENTS.md` and `CLAUDE.md` "stay R6-protected". Only `CLAUDE.md` is in the guard and crew-docs
  R6 lists; `AGENTS.md` never was, so a dev run can still edit it. I left that unchanged. Adding it to R6 would
  change both the guard and crew-docs.
- A docs-only QC run drops every required MCP of the QC ticket, not just the UI-test ones. The existing gate
  already treats all of a QC ticket's required MCP servers as UI-test servers.
