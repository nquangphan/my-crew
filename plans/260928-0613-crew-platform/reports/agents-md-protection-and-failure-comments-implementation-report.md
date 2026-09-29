# AGENTS.md protection, failure diagnosis comments, MCP disable fixes — implementation report

Date: 2026-09-29 · Plan: `plans/260928-0613-crew-platform/plan.md` Validation Session 23 (+ two owner-reported
bugs relayed by the controller for release 0.1.5). Nothing committed.

## Status

All four items are implemented, tested and documented. Typecheck, the full sequential test run, lint, build,
web E2E (20/20) and desktop Electron E2E (6/6) pass.

## 1. AGENTS.md is R6-protected

- `packages/docs-kit/src/rules/r6-protected.ts`: `AGENTS.md` (repo root only) added to `PROTECTED_PATTERNS`.
  The docs-init commit stays exempt, and the `Crew-Owner-Approved: <ticket-key>` trailer allows the change.
- `apps/daemon/src/runner/guard-hook.ts`: `isProtectedPath` now includes `AGENTS.md`. `checkWrite` denies root
  `AGENTS.md` and `CLAUDE.md` for every job kind except `docs_init`, case-insensitively because a macOS worktree
  is case-insensitive. The reason reads "… là hướng dẫn agent được bảo vệ (R6): chỉ job docs_init được ghi; nếu
  cần đổi, ghi đề xuất vào comment để chủ dự án duyệt". The pre-push protected-path gate in `merge-policy.ts`
  reuses `isProtectedPath`, so it also stops a branch that bypassed the hooks.
- Tests:
  - `packages/docs-kit/test/rules.test.ts`: root AGENTS.md fails without the trailer and passes with it (both
    `--commit-msg` and `--range`), a nested AGENTS.md is not protected, and docs-init is exempt.
  - `apps/daemon/test/guard-hook.test.ts`: every non-init kind is denied in any case, `codeOnly` Edit is denied,
    a linked shared AGENTS.md is denied, and `src/AGENTS.md` is allowed.
  - `apps/daemon/test/merge-policy.test.ts`: the gate refuses AGENTS.md as well as `.claude/settings.json`.
- Bundle rebuilt (`pnpm --filter @crew/docs-kit build`), so this repo's hooks use the new rule.
- Verified on a temporary index (HEAD plus a changed AGENTS.md blob, via `GIT_INDEX_FILE`):
  - `check --commit-msg` without the trailer gives exit 1 with `R6 AGENTS.md: protected path changed`.
  - With `Crew-Owner-Approved: CREW-0` it gives exit 0.
- The real index was never touched.

## 2. Richer comment when a run ends without finishing

- New `apps/daemon/src/runner/run-trace.ts`:
  - `RunCapture` holds the turns and duration from the SDK result, the number of compactions (from
    `compact_boundary` events), the main agent's last text, and the last 5 tool calls. Each call keeps only its
    name and target: a repo-relative path or a skill name, never a Bash command line.
  - `buildRunTrace()` scrubs secrets first, then trims the message to 1500 characters.
  - `traceMarkdown()` renders the Vietnamese block: "Số lượt / thời gian / chi phí", "Trạng thái" (SDK subtype,
    stage, compaction), "Tin nhắn cuối của agent" as a quote with line breaks kept, and "Các bước cuối".
  - `traceSummary()` produces the one-line heartbeat text.
- Capture:
  - `agent-runner.ts` records from the SDK stream and skips subagent messages.
  - `scripted-runner.ts` records its tool steps and gains a new `say:` step.
- `job-runner.ts` builds the trace after every run and stores it in the new additive `jobs.run_trace` column
  (`state-db.ts`, which an older DB gets through `migrate()`).
  - The runner-error comment now scrubs the error text.
  - It carries the block only when the planner posted no failure comment, so the block is never duplicated.
- `failure-policy.ts`:
  - `decideFailure()` appends the block to both the retry comment ("Lần thử 1/2 …") and the block comment. This
    covers every reason: `not_finished`, `budget`, runner errors including `error_max_turns`, `no_handoff` and
    `docs_rejected`.
  - `failedJobText()` feeds the heartbeat `failedJobs[].error`: the reason in words plus the short diagnosis,
    at most 500 characters. The schema is unchanged and the web already shows this text, so no API or web
    change was needed.
- Tests:
  - `apps/daemon/test/run-trace.test.ts` covers scrubbing (AWS key and GitHub token), trimming, the last-5 rule,
    the empty case, both comments, the heartbeat line and the migration.
  - `agent-runner.test.ts` covers capture from SDK messages.
  - New lifecycle scenario `apps/daemon/test/lifecycle/20-docs-init-not-finished.yaml`: a scripted docs-init
    ends twice without submitting. Both comments carry the last message with the quoted credential scrubbed, and
    the last 5 steps; the job row keeps the trace.

## 3. Bug A: "Tắt cho project này" for plugin/connector MCP servers

- `apps/daemon/src/health/types.ts` `parseFixId()` takes the arg as everything after the second colon. It is
  used by `mcp.ts`, `repos.ts` and `skills.ts`.
- Leftover bad entries are cleaned up. On the next disable or enable save, `mcp.ts` drops any `disabledMcpServers`
  entry that matches no server but is the `<entry>:` prefix of one. This removes exactly the `plugin` junk the
  old parser stored and leaves real names alone, even for servers missing from the inventory.
- `apps/desktop/src/renderer/routes/health.tsx` was checked and left unchanged. It reads only the action and the
  project key, and every fix id it handles (`repair`, `repick-folder:<key>`, `adjust-limits`, `api-key-help`)
  is safe.
- Test in `apps/daemon/test/health-groups.test.ts`:
  - Disabling `plugin:engineering:asana` and `plugin:engineering:google calendar` stores the full names.
  - Both checks then disappear.
  - The `plugin` fragment is dropped, the unrelated `gone` entry is kept, and enable removes the right name.

## 4. Bug B: disabled MCP servers still reached the model

- `tool-scopes.ts` `disallowedToolsFor()` builds `mcp__<server>__*` with the same `mcpToolPrefix` that
  `allowedTools` uses, and never includes `tickets`. For example, `plugin:engineering:asana` becomes
  `mcp__plugin_engineering_asana__*`.
- `job-runner.ts` passes two options through `agent-runner.ts` to `query()`:
  - `disallowedTools` with those globs.
  - `settings.deniedMcpServers: [{ serverName }]` for every disabled name.
- What the SDK and CLI documentation says (pinned SDK 0.3.283, Claude Code 2.1.283):
  - `Options.disallowedTools` is documented as "removed from the model's context".
  - The permissions docs say deny rules accept tool-name globs and "a tool matched by a bare-name glob deny rule
    is removed from Claude's context". `mcp__server__*` is a documented form.
  - Plugin tools are named `mcp__plugin_<plugin>_<server>__<tool>`, with every other character replaced by `_`.
    This matches `mcpToolPrefix` applied to `plugin:<plugin>:<server>`.
  - `deniedMcpServers` exists in the SDK `Settings` type. The managed-MCP docs say the denylist "merges from
    every scope" and that a matching server is not loaded, with `serverName` as an exact label match.
- Not verified live: whether the plugin server's `serverName` label is the `plugin:<plugin>:<server>` string the
  inventory reports.
  - If the label is different, the server may still start, but `disallowedTools` hides its tools either way.
  - The docs updates record this.
- The inventory probe is deliberately unchanged. It must keep starting every server so the health check can show
  a disabled server's status and offer "Bật lại", and it does not put tools into a job's context.
- Tests:
  - `ticket-tools.test.ts` covers glob building for plugin and connector names, dedupe, and exclusion of
    `tickets`.
  - `agent-runner.test.ts` covers the SDK options: `disallowedTools` and `settings.deniedMcpServers`, and neither
    is set when nothing is disabled.
  - `daemon-extras.test.ts` checks that job-runner wires in the project's disabled servers.

## Docs

Written by a sonnet subagent and checked against the source:
- `packages/docs-kit/STANDARD.md` (R6 row) and `packages/docs-kit/templates/AGENTS.md` (the template for new
  repos, not this repo's AGENTS.md).
- Flow docs: `docs/flows/agent-runs.md`, `agent-roles.md`, `daemon-runtime.md`, `daemon-health.md`,
  `local-merge.md` and `docs-check.md`.
- Short Session 23 notes in `phase-05-docs-standard.md` and `phase-07-agent-workflow.md`.
- `docs/flows.yaml` changed in its flows section only: `run-trace.ts` and `run-trace.test.ts` added to
  `agent-runs`. `docs/files.md` was regenerated.

## Verification

- `pnpm -r typecheck`, `pnpm -r --workspace-concurrency=1 test`, `pnpm lint` and `pnpm -r build` all pass.
- Web E2E: 20 passed.
- Desktop E2E: 6 passed after restaging the app (`node scripts/stage-app.mjs`), because `--if-missing` would
  have tested an old stage.
  - One earlier full desktop run had `first-project.spec.ts` fail once.
  - That test passed when run alone, and the next full run passed 6/6. It was not investigated further.
- On a temporary index built from HEAD plus this change (36 files, excluding the controller's `plan.md` edit),
  `crew-docs check --staged` and `--commit-msg` both pass with no trailer. `check --all` passes.

## Unresolved / follow-ups

- This repo's own `AGENTS.md` (line on R6) still lists the protected paths without `AGENTS.md`. It was not
  edited, as instructed. Updating it needs a commit with `Crew-Owner-Approved: CREW-0`.
- Blocked jobs (the second `not_finished`) are not in the heartbeat `failedJobs`, which only lists
  `status = 'failed'` jobs, as before. Their diagnosis is on the ticket comment and in `jobs.run_trace`.
- Whether a denied plugin server is kept from starting depends on its `serverName` label (see item 4). Checking
  it needs a live run on the owner's machine.
