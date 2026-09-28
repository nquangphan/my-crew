# Red Team: Assumption Destroyer + Scope Auditor

Plan: `plans/260928-0613-agent-jira-platform/` · Reviewed 2026-09-28 (Asia/Saigon)
Evidence: line numbers from `cat -n` / `grep -n` on the plan and research files.

## Finding 1: QC can never start, because it waits for a dev ticket that only QC can move to `done`
- **Severity:** Critical
- **Location:** phase-06-local-daemon.md:49-56, phase-07-agent-workflow.md:35-36, phase-02-backend-core.md:34,73
- **Flaw:** The scheduler gates a job until every `depends_on` ticket is `done`. The dev contract ends at `in_review`. The QC subtask "depends on dev", and only a QC pass moves the dev subtask to `done`. That is a circular wait. Even without the cycle, the daemon has no way to learn that a dependency changed. The dispatcher handles only `ticket.assigned`, `ticket.comment_added`, `subtask.completed` and `ticket.cancelled`. `subtask.completed` targets the *parent's* role (the PM), not the dependent sibling. `ticket.status_changed` is emitted but never dispatched. So QC reopening the dev subtask (`in_review → in_progress`) wakes no dev job either. Agent comments emit no event, because `comment_added` fires "only for owner comments".
- **Failure scenario:** In the Phase 7 live scenario (phase-07:86-93), the dev reaches `in_review` and the QC job sits in the queue forever. This fails plan.md:72, plan.md:74 and phase-07:108. If a QC run did happen and failed, the reopened dev subtask would never run again, so the "QC reopen loop" (phase-07:102) cannot happen.
- **Evidence:** phase-06:56 "A job becomes runnable when all `depends_on` tickets are `done`." · phase-07:35 "`submit_report` (files, commits, tests, skills), then `in_review`" · phase-07:36 "qc | `ticket.assigned` (qc), depends on dev … Pass → the dev subtask moves to `done`" · phase-06:50-53 (the dispatcher map, with no `status_changed`) · phase-02:73 "`ticket.comment_added`: only for owner comments"
- **Suggested fix:** Define a readiness state separate from `done` (e.g. QC depends on dev reaching `in_review`), or gate on the dev *job* finishing with a report. Emit a `dependency.satisfied` event (or dispatch `ticket.status_changed`) to the machine that owns each dependent ticket. Map "dev subtask reopened" to a dev resume job. Add a test in which QC depends on dev and dev and QC run on different machines.

## Finding 2: Role contracts require status transitions that `allowedTransitions` forbids, and the docs-init ticket can never reach `done`
- **Severity:** Critical
- **Location:** phase-01-monorepo-foundation.md:54-61, phase-07-agent-workflow.md:31-38, phase-06-local-daemon.md:66
- **Flaw:** New tickets start in `todo`, and `todo` can only go to `triage|in_progress`. Four contract steps break that table:
  - `ask_owner` moves the ticket to `needs_input` directly, which from `todo` is illegal. That is the most likely first action for both the assistant and the PM.
  - PM accept does "`submit_report`, then `done`" from `in_progress`, but `in_progress` cannot go to `done` directly.
  - The QC pass moves "QC to `done`" from `in_progress`, which is also illegal.
  - The docs-init contract has no `submit_report` step and no transition at all, yet `done` needs a report (phase-02:34), and every other job on the project waits for that ticket to be `done` (phase-07:38, 109).
- **Failure scenario:** On the first question from any agent, `ask_owner` gets a 409. On an undocumented project, the docs_init agent commits and exits, the ticket stays `in_progress`, and every queued PM, dev and QC job on that project is blocked forever. This fails plan.md:71, plan.md:75 and phase-07:109.
- **Evidence:** phase-01:55 "`todo→triage|in_progress`" · phase-01:58 "`in_progress→needs_input|in_review|blocked`" · phase-06:66 "`ask_owner` (comment and move to `needs_input`, then end the run)" · phase-07:37 "`submit_report`, then `done`" · phase-07:38 "commit … set `initializedAt`, sync. Other jobs for the project wait on this ticket"
- **Suggested fix:** Have each MCP tool (`ask_owner`, `update_status`) walk a legal path, or add explicit agent edges and test them. Add a table-driven test that replays every role contract's status sequence through `canTransition()`. Add `submit_report` plus `in_review→done` (who closes it?) to the docs-init contract.

## Finding 3: QC's tools and machine scope cannot touch the dev ticket that the QC contract tells it to transition
- **Severity:** High
- **Location:** phase-03-event-delivery.md:32, phase-06-local-daemon.md:65,135, phase-07-agent-workflow.md:36
- **Flaw:** The ticket MCP server is "bound to the job's ticket and scope", and the security section says an agent "cannot comment on unrelated tickets". QC's job ticket is the QC subtask. Its contract, though, requires it to move the *dev* subtask to `done`, or to comment on the dev subtask and reopen it. On the server, a machine may only write tickets "whose `assignee_machine_id` is itself". The unique `(project, role)` index lets dev and QC belong to different machines.
- **Failure scenario:** When QC passes, `update_status(devTicketId)` is rejected by the tool binding, or by a 403 when QC and dev are on different machines. The dev subtask stays `in_review`, the PM accept never fires, and plan.md:74 fails.
- **Evidence:** phase-06:65 "bound to the job's ticket and scope" · phase-06:135 "an agent cannot comment on unrelated tickets" · phase-03:32 "a machine can only read or write tickets whose `assignee_machine_id` is itself"
- **Suggested fix:** Add a QC-only tool `review_verdict(pass|fail, notes)` that the *server* applies to the dev sibling listed in QC's `depends_on`, with the authorization rule stated explicitly. Test it with dev and QC on two machines.

## Finding 4: Events fan out into concurrent jobs on the same ticket and session, with no per-ticket serialization
- **Severity:** High
- **Location:** phase-02-backend-core.md:34, phase-06-local-daemon.md:51-52,58, phase-07-agent-workflow.md:37
- **Flaw:** `subtask.completed` fires once for every child that reaches `done`, and each one maps to "a PM re-evaluation job". A QC pass moves dev and QC to `done` at almost the same moment, so two PM accept jobs are queued. Nothing dedupes by ticket, and the PM has a reserved slot, so both can run. Both see "all children done", merge the `aj/<key>` branches, push, sync and submit reports.

  In the same way, `ticket.comment_added` means "resume the assignee's session" even while that session is still running, which gives two `query()` processes on one session transcript. After a daemon restart, "jobs left `running` are resumed with their session id". If the crash happened before the init message was captured, there is no session id. If it happened mid-tool-call, the worktree is half edited and no resume prompt is defined.
- **Failure scenario:** The merge runs twice or conflicts with itself, two reports are written, and the assistant gets two `subtask.completed` events and posts two close reports. A resumed session gets corrupted or forks unpredictably. This fails phase-06:121 ("no event is lost or double-processed").
- **Evidence:** phase-06:52 "`subtask.completed` → a PM re-evaluation job" · phase-06:51 "`ticket.comment_added` → resume the assignee's session" · phase-06:57 "PM and assistant jobs get a reserved slot" · phase-06:58 "After a restart, jobs left `running` are resumed with their session id"
- **Suggested fix:** Allow one active job per ticket in the scheduler. Coalesce pending events into the next run, so a comment that arrives during a run is appended to the next resume prompt. Make PM accept idempotent with a server-side "accepting" guard. Define the restart path: no session id means restart from scratch, and a session id means resume with an explicit "you were interrupted; inspect `git status`" prompt.

## Finding 5: `aj-docs install-hooks` in a worktree rewrites the shared repo config and silently drops enforcement in foreign repos
- **Severity:** High
- **Location:** phase-05-docs-standard.md:22,87,95, phase-06-local-daemon.md:75, phase-06-local-daemon.md:37
- **Flaw:** The plan makes six load-bearing assumptions that are false or never specified:
  1. `git config core.hooksPath` run inside a linked worktree writes to the *shared* `.git/config`, because `extensions.worktreeConfig` is off by default. It therefore changes every checkout of the owner's repo.
  2. It overwrites any existing `core.hooksPath` (husky, lefthook) in foreign repos. Their lint and test hooks silently stop running.
  3. `.githooks/pre-commit` is written into one worktree. If it is not committed, the main checkout and other worktrees resolve a relative `.githooks` that does not exist, and git silently skips missing hooks. That means no enforcement for the owner's own commits.
  4. The hook calls `aj-docs` "from PATH", but `~/.aj/bin` and a nvm-managed `node` are not on the PATH of launchd or systemd services or of the owner's IDE shells. That gives exit 127, so commits are blocked, or the hook is written to tolerate a missing binary, so enforcement silently passes.
  5. The "daemon's pre-push run of `check --range`" is never defined. `install-hooks` writes only pre-commit, and no phase step creates a pre-push hook.
  6. For project repos, the CI check is only "printed" as a snippet. Nothing installs it, and nothing covers repos that are not on GitHub.
- **Failure scenario:** The first dev worktree disables the project's husky hooks. The owner's manual `--no-verify` commits, or commits where the hooks directory is missing, go through with no CI and no pre-push catch. That breaks the user requirement "every commit after init must update docs" and plan.md:75.
- **Evidence:** phase-05:95 "sets `core.hooksPath=.githooks` … It also prints a CI snippet" · phase-05:87 "`--no-verify` commits are still caught by CI and by the daemon's pre-push run" · phase-06:75 "then `aj-docs install-hooks` in the worktree" · phase-05:22 "hooks call it from PATH". `grep -n pre-push` finds only phase-05:87.
- **Suggested fix:**
  - Install the hooks once per repo, in the main checkout, and commit `.githooks/`.
  - Detect an existing `core.hooksPath` or husky setup and chain to it instead of replacing it.
  - Write the hook with absolute paths to `node` and `aj-docs.mjs`, and fail closed with a clear message.
  - Actually define and install pre-push.
  - Have docs-init commit the CI workflow into the project repo.
  - Add success criteria covering a husky repo, an owner commit from the main checkout, and a hook run under launchd.

## Finding 6: `initializedAt` must contain the SHA of the commit that contains it
- **Severity:** High
- **Location:** phase-05-docs-standard.md:43,86, phase-07-agent-workflow.md:38
- **Flaw:** The docs-init commit is exempt from R3 "identified by the manifest's `initializedAt`", which is "<commit sha of docs init>". A commit cannot contain its own SHA. Setting it needs a second commit, or an amend, which changes the SHA again. The docs-init contract lists "commit … set `initializedAt`" in that order. The follow-up commit that edits only `flows.yaml` is fine, but the exempt commit is now the *previous* commit. Any rebase or squash-merge of the init branch rewrites that SHA, and the exemption is lost.
- **Failure scenario:** On the next CI run, `check --range` iterates the docs-init commit. That commit adds or changes nothing in `docs/flows/*.md` relative to a previous doc, but it may add source-adjacent files, or the recorded SHA is a pre-rebase value, so R3 or R2 fails permanently on a legitimate history. The phase-08:69 "CI is green, including `aj-docs check --range`" criterion then fails for the platform repo itself.
- **Evidence:** phase-05:43 "`initializedAt: <commit sha of docs init>`" · phase-05:86 "The docs-init commit is exempt from R3 and is identified by the manifest's `initializedAt`. There is no other bypass." · phase-07:38 "commit `docs: initialize agent docs`, set `initializedAt`"
- **Suggested fix:** Identify the init commit by a rule that survives rewriting. Examples: "the commit that adds `docs/flows.yaml`" (via `git log --diff-filter=A`), or R3 skipping commits whose parent has no `flows.yaml`. Add a fixture test covering rebase or squash of the init commit.

## Finding 7: Agent auth and environment assumptions will fail under a service manager, and the multi-machine subscription question is left open
- **Severity:** High
- **Location:** phase-06-local-daemon.md:33,37,60,129, plan.md:81, research/researcher-01-claude-code-headless-report.md:87,157
- **Flaw:**
  - The runner passes `env` "caps" to `query()`. If the SDK treats `env` as the whole child environment rather than merging it into `process.env`, the CLI loses `PATH`, `HOME` and `CLAUDE_CODE_OAUTH_TOKEN`, so it cannot authenticate or find `git`, `gh` or `aj-docs`. The plan never says to spread `process.env`.
  - `install-service` (launchd/systemd) does not inherit the owner's shell env, so "auth comes from env" has no stated source. Putting the one-year OAuth token in a plist or unit file in plaintext is the default outcome.
  - Research shows `ANTHROPIC_API_KEY` outranks `CLAUDE_CODE_OAUTH_TOKEN` in `-p`. A stray key in the environment silently switches billing to the API.
  - phase-06:129 cites "the validation question on auth", but no such question exists anywhere in the plan. Research 01:157 explicitly flags as unverified that several machines can share one subscription token at the same time.
- **Failure scenario:** The service-managed daemon's first live run fails `authentication_failed`, or cannot run `git`. Or it bills per token without the owner knowing. Or it hits the shared subscription's usage limits, and every job on every machine goes to `backoff`, which fails plan.md:69-74 in steady state.
- **Evidence:** phase-06:60 "`env` caps (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=2`)" · phase-06:33 "Auth comes from env" · phase-06:129 "See the validation question on auth." (`grep -n "validation question"` has only this hit) · research-01:87 "`ANTHROPIC_API_KEY` (… the key is always used when present)" · research-01:157 "No official Anthropic statement was found … across multiple owner-controlled machines simultaneously"
- **Suggested fix:**
  - Specify `env: {...process.env, ...caps}`.
  - Have `install-service` load secrets from the Keychain or a 0600 env file, not the plist.
  - Have `doctor` fail when both credentials are set, and report which credential is actually in effect (from the init message `apiKeySource`).
  - Add a real open question to plan.md: "one subscription token across N machines: allowed, and what are the limits?". Get an owner decision before Phase 6.

## Finding 8: Skill inventory and enforcement miss plugin skills and ignore which machine runs the job
- **Severity:** High
- **Location:** phase-06-local-daemon.md:62,73,123, phase-07-agent-workflow.md:34,46, phase-03-event-delivery.md:27
- **Flaw:**
  - The inventory scans only `~/.claude/skills/*/SKILL.md` and the repo's `.claude/skills/*/SKILL.md`. Skills from plugins (installed under `~/.claude/plugins/...` and namespaced like `ak:scout`, which is how this owner's machine is set up) load through `settingSources`, but they are invisible to the inventory. Their names also will not match the bare names the PM writes into `required_skills`.
  - The PM picks `required_skills` "from the machine inventory", meaning the PM's machine. The dev subtask may run on a different machine (dev and pm are separate `(project, role)` owners) that lacks those skills.
  - The `PreToolUse` hook on the `Skill` tool does not observe skills the model applies from auto-loaded instructions or slash-command expansion, and whether it fires for subagent tool calls is unverified.
- **Failure scenario:** Dev runs report `skills_missing` for skills that were used, or that could never be installed on that machine. The PM rejects them (phase-07:46), the job loops until the 2-attempt cap and goes `blocked`. plan.md:73 either produces false flags or silently records nothing.
- **Evidence:** phase-06:73 "scan `~/.claude/skills/*/SKILL.md` and each repo's `.claude/skills/*/SKILL.md`" · phase-07:34 "`required_skills` (from the machine inventory)" · phase-07:46 "The PM's acceptance checklist treats missing skills as a reject" · phase-06:62 "A `PreToolUse` hook on the `Skill` tool records the skills used"
- **Suggested fix:** Take the inventory from the SDK itself (the init message's skills list, which already includes plugin skills), not from filesystem globs. Store fully qualified names. Validate `required_skills` on the server against the inventory of the machine that owns the *target* role. Add a live test that invokes a plugin skill and one from a subagent.

## Finding 9: The sandbox claims rely on permission hooks that do not fire for the risky paths, and the machine token can be read by agents
- **Severity:** High
- **Location:** phase-06-local-daemon.md:33,60,130,134,136
- **Flaw:**
  - Under `acceptEdits`, edits are auto-approved, so `canUseTool` is not consulted for them. For Bash, a path guard cannot parse `cd ..; sed -i`, redirects or scripts, so "denies write paths outside `cwd`" is not enforceable.
  - Deny patterns like `Bash(rm -rf /*)` and `Read(~/.aj/*)` are bypassed by `cat ~/.aj/token` or `rm -r -f /`.
  - The token "falls back to a 0600 file" owned by the same user the agent runs as, so the agent can read it.
  - Dev agents process untrusted repo content and web fetches (prompt-injection surface). The assistant machine's token can create PM tickets in *any* project (phase-03:32).
- **Failure scenario:** An injected instruction in a dependency README makes a dev agent `cat` the token file and post it through `comment`, which the owner-facing thread renders, or send it with curl. With that token an attacker can create tickets that drive agents on every machine.
- **Evidence:** phase-06:130 "a `canUseTool` guard denies write paths outside `cwd`" · phase-06:136 "Disallowed tools … `Bash(rm -rf /*)`, and reads of `~/.aj/*`" · phase-06:33 "falling back to a 0600 file" · phase-06:134 "never passed into agent env"
- **Suggested fix:** Treat the Bash deny patterns as advisory, and say so. Require the Keychain (no plaintext fallback) on macOS, or run agents under a separate OS user or sandbox (Claude Code sandbox settings) whose filesystem policy excludes `~/.aj`. Add a test in which an agent tries `cat` on the token file and must fail.

## Finding 10: Scope gaps against the user's request
- **Severity:** Medium
- **Location:** plan.md:67-77, phase-07-agent-workflow.md:25,53,55-56, phase-02-backend-core.md:45
- **Flaw:** Four items from the request have no testable coverage, or rest on an unstated assumption:
  1. **"Agents read docs before code."** This is enforced only by prompt text (phase-07:25). No success criterion measures it. The skill `PreToolUse` machinery could record whether `docs_flow`/`docs_where` ran before the first `Read`/`Grep`, but no phase requires this.
  2. **"PM manages local machine resources."** The unique index allows the PM and dev roles on different machines (phase-02:45). The PM then gets "the machine's current resource snapshot" (phase-07:53) without saying which machine. `local-merge` of `aj/<key>` branches (phase-07:56) assumes those branches exist in the PM's local repo.
  3. **"PM resumes the same session when the owner replies."** Sessions are stored per machine. If the owner releases and re-pairs a project role (phase-04:42), open sessions become unresumable, and research 01:159 marks cross-machine resume as untested. No fallback is defined.
  4. **"Every ticket moved to done must have a report."** `autoCloseRequests` (phase-07:32) appears only once and is never defined in config or tested.
- **Failure scenario:**
  - Agents skip the docs step and no test notices. That is the core premise of the docs requirement.
  - With PM and dev on different machines, PM accept fails to merge branches that exist only on the dev machine.
  - After a machine swap, the owner's reply to `needs_input` fails to resume and the ticket sits stalled.
- **Evidence:** phase-07:25 "Each role prompt starts with 'docs first'" (no matching success criterion in phase-07:106-110 or plan.md:67-77) · phase-07:53 "the PM receives the machine's current resource snapshot" · phase-07:56 "`local-merge`: fast-forward or merge into the default branch locally" · research-01:159 "Exact behavior of resuming a session across machines … was not tested"
- **Suggested fix:**
  - Add success criteria for the first three items: tool-call order for docs-first, PM and dev split across machines, and resume after reassignment.
  - Either require that pm, dev and qc for a project live on one machine (and enforce that at pairing), or push branches and merge from the remote.
  - When resume fails, start a fresh session seeded with the ticket thread.
  - Define `autoCloseRequests`, or drop the reference.

---

Status: DONE
Summary: 10 findings (2 Critical, 7 High, 1 Medium). The main risks are a QC and dev dependency deadlock with no wake-up events, contract steps that break the transition table, a docs-init ticket that can never reach done, `core.hooksPath` damage in worktrees and foreign repos, and a self-referential init SHA.
Unresolved questions:
- Is it allowed to use one subscription `CLAUDE_CODE_OAUTH_TOKEN` on several machines at the same time?
- Must a project's pm, dev and qc roles always live on one machine?
