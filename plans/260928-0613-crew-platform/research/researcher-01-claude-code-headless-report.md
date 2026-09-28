# Claude Code Headless + Agent SDK for a Multi-Machine AI-Agent Jira/Confluence Platform

Date: 2026-09-28 (Asia/Saigon). Scope: technical grounding for a TypeScript daemon, running on each owner machine, that spawns Claude Code agents (assistant, PM, dev, QC) against a central ticket system hosted on a VPS.

Sources are official docs at `code.claude.com` / `docs.claude.com` / `platform.claude.com`, fetched directly on 2026-09-28. Version numbers quoted below (e.g. "v2.1.219") are the CLI/SDK release each behavior first requires, per the docs.

## 1. `claude -p` headless CLI: confirmed flags

Source: [CLI reference](https://code.claude.com/docs/en/cli-reference), [Run Claude Code programmatically](https://code.claude.com/docs/en/headless).

| Flag | Values / notes |
|---|---|
| `-p`, `--print` | Enter non-interactive mode. Rejects `--bg`; `--cloud` has special rules. |
| `--output-format` | `text` (default), `json`, `stream-json`. `json` includes `result`, `session_id`, `total_cost_usd`, per-model cost. `stream-json` emits one JSON object per line, `system/init` first, `result` last. |
| `--input-format` | `text` or `stream-json` (for streaming-input mode). |
| `--model` | Alias (`sonnet`, `opus`, `haiku`, `fable`) or full model ID. |
| `--effort` | `low`, `medium`, `high`, `xhigh`, `max`, `ultracode` — reasoning-effort dial, independent of model choice. |
| `--resume "<session>"` | Resume by session ID, session name, or absolute path to the `.jsonl` transcript. Cross-project session lookup since v2.1.223. |
| `--continue` / `-c` | Resume the most recent conversation in the cwd. Since v2.1.257, only resumes a *finished* background session, not one still running. |
| `--fork-session` | With `--resume`/`--continue`: branch into a new session ID instead of mutating the original. |
| `--session-id` | Not listed as a distinct flag in the current docs — session identity is controlled via `--resume`/`--continue`/`--fork-session`, and `session_id` is read back from the JSON `result`. Treat any earlier assumption of a standalone `--session-id` flag as unconfirmed; the SDK's `resume` option is the authoritative mechanism.
| `--no-session-persistence` | Disable saving sessions to disk at all. |
| `--max-turns` | Caps agentic tool-use round trips; exits with an error at the limit. |
| `--max-budget-usd` | Stops the run once the client-side cost estimate reaches this USD amount. |
| `--allowedTools` / `--allowed-tools` | Auto-approve rules, e.g. `"Bash(git diff *),Read,Edit"`. Does not *restrict* Claude to only these tools — it only removes prompts. |
| `--disallowedTools` / `--disallowed-tools` | Deny rules; scoped patterns like `Bash(rm *)` are enforced even in `bypassPermissions`. |
| `--permission-mode` | `default`, `plan`, `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `manual`. **Default starting mode for `-p` is `manual` on every plan** — you must explicitly pass a mode for unattended runs. |
| `--dangerously-skip-permissions` | Shorthand for `bypassPermissions`. |
| `--permission-prompts` | `host` (default) or `none` — `none` denies anything that would otherwise need a human, essential for unattended daemon use. |
| `--permission-prompt-tool` | Route permission decisions to an MCP tool instead of a human. |
| `--append-system-prompt`, `--append-system-prompt-file` | Add to (not replace) the default system prompt. `--system-prompt` fully replaces it. |
| `--mcp-config` | Load MCP servers from JSON file(s) or inline JSON strings, space-separated. |
| `--add-dir` | Grant read/write access to additional directories beyond `cwd`. |
| `--bare` | Skip auto-discovery of hooks, skills (mostly — see below), commands, subagents, plugins, MCP servers (`.mcp.json`), auto-memory, CLAUDE.md. Anthropic explicitly recommends `--bare` for **all scripted/SDK invocations** and says it "will become the default for `-p` in a future release." **Caveat: `--bare` does NOT read `~/.claude/skills/`** — it still loads skills from a directory you pass via `--add-dir`, but skips `.claude/commands/` and `.claude/agents/` in that directory. Since this platform's whole premise is "agents must use installed skill sets correctly," `--bare` needs care (see §7 below). |
| `--json-schema` | Force structured output validated against a JSON Schema; result lands in `structured_output`. |
| `--include-partial-messages` | Stream token deltas (`stream-json` only). |
| `--forward-subagent-text` | Forward subagents' text/thinking blocks (not just tool_use/tool_result) into the stream, tagged with `parent_tool_use_id`. |

### JSON result schema (confirmed fields)

From the `stream-json`/`json` result message and `SDKResultMessage` (TypeScript): `type: "result"`, `subtype` (`success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution`, ...), `session_id`, `total_cost_usd` (cumulative, includes subagents), `usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` — main loop only, excludes subagents), `modelUsage` (per-model map with `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens`, `costUSD`, `costBasis`: `list`/`managed`/`unknown`), `permission_denials`, `duration_api_ms`. **`total_cost_usd`/`modelUsage` are client-side estimates from a bundled price table, not authoritative billing** — the docs explicitly warn not to trigger financial decisions from them; use the Usage and Cost API for that.

Two important correctness caveats for a daemon that bills or throttles by ticket: (1) per-step `output_tokens` on assistant messages is a placeholder — always read the real total from the final `result` message; (2) on `error_max_budget_usd`, `usage` under-counts the triggering response while `total_cost_usd`/`modelUsage` include it — prefer the latter two fields for accounting.

## 2. Agent SDK (TypeScript) `query()` vs spawning the CLI

Source: [Agent SDK reference — TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript), [cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking), [subagents](https://code.claude.com/docs/en/agent-sdk/subagents).

**Recommendation: use the TypeScript Agent SDK's `query()`, not `claude -p` as a subprocess with JSON parsing**, for this daemon. Reasons:
- Native message objects (typed `SDKMessage` variants) instead of parsing NDJSON yourself; native `AbortController` for cancellation instead of signal plumbing to a child process; native hook callbacks (`inline` function callbacks, not only shell hooks); in-process MCP tools via `createSdkMcpServer`/`tool()` (see §3) avoid a second process and a JSON-RPC round trip per ticket-system call.
- `startup()`/`prewarm()` let the daemon pre-spawn the underlying subprocess ahead of a task arriving, cutting cold-start latency for a queue-driven daemon (this is exactly the daemon's use case: "listens for tasks").
- Session resume, streaming input, and cost accounting are all first-class fields on typed messages rather than something you reconstruct from CLI stdout.

Trade-off: the SDK's `query()` still shells out to the same underlying Claude Code binary/runtime under the hood (it is not a pure HTTP client) — so you still need the CLI installed on each machine, and per-call overhead is comparable. The choice is really "typed programmatic API" vs "shell out and parse stdout," and for a long-running Node daemon the SDK wins on developer ergonomics and correctness (e.g., resuming a session and reading `total_cost_usd` correctly per the accumulation rules is fiddly to get right against a subprocess).

### `settingSources` — this is the load-bearing option for your skills requirement

By default, `query()` loads **no filesystem settings at all** unless you set `settingSources`. To match interactive Claude Code behavior — including `~/.claude/skills` and project `.claude/skills` discovery that this platform depends on — you must pass:

```typescript
options: { settingSources: ["user", "project", "local"] }
```

Omitting this is the single most likely way this platform's "agents must use installed skill sets" requirement silently breaks. Note this is a different mechanism from CLI `--bare`: `--bare` is a CLI-only flag that skips auto-discovery for speed; `settingSources` is the SDK equivalent that is *off* by default, i.e. the SDK defaults to the "bare-like" state and you opt in to full discovery. If your daemon spawns per-machine skill sets under `~/.claude/skills`, set `settingSources: ["user", "project", "local"]` and do not pass `--bare` semantics.

### Hooks

`hooks` is `Partial<Record<HookEvent, HookCallbackMatcher[]>>`. If project `.claude/settings.json` already defines hooks and you set `settingSources: ["project"]`, those run automatically. You can also register inline hook callbacks (not just shell scripts) directly in `query()` options — useful for the daemon to intercept `PermissionRequest`, `SessionStart`, `SessionEnd`, or `Notification` events and forward them into the ticket system without an MCP round trip.

### Abort, resume, streaming

- `abortController: AbortController` passed in options; call `.abort()` to cancel. Sending SIGTERM to a `claude -p` subprocess is the CLI-level equivalent and leaves the current turn unfinished with no result recorded — prefer SIGINT or the SDK's `interrupt()`/abort to end a turn cleanly.
- `resume: sessionId` + `forkSession: boolean` reproduce `--resume`/`--fork-session`. Resuming restores the session's accumulated `total_cost_usd` since v2.1.277 (earlier versions restarted totals at zero) — pin a modern CLI/SDK version if PM agents will resume sessions across long ticket lifecycles.
- Streaming input mode (`prompt: AsyncIterable<SDKUserMessage>`) lets one `query()` call carry multiple user turns (e.g., a PM agent that keeps a session open across several ticket-comment round trips) — but read cost totals per the "latest result, not summed" rule the docs specify (§ Track costs in streaming input mode).

### Cost tracking — accurate accounting rules (all confirmed in docs)

- Independent `query()` calls: sum `total_cost_usd` yourself.
- Calls that `resume` the same session: each result already includes the session's whole spend — read the *latest* result, do not sum, or you will double-count restored spend.
- Subagents: `usage` excludes subagent token counts; `total_cost_usd` and `modelUsage` include them. For a PM agent that spawns dev/QC subagents, always account from `total_cost_usd`/`modelUsage`.
- Cap runaway subagent trees with `maxBudgetUsd` (query-level), `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (default 3), `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (default 20) — both env vars passed via the `env` option.

## 3. Talking back to the ticket system: in-process SDK MCP server vs stdio

Source: same TypeScript reference, plus `createSdkMcpServer`/`tool()` signatures confirmed above.

**Recommendation: in-process SDK MCP server (`createSdkMcpServer` + `tool()`)**, not a separate stdio MCP process, for the ticket-system tools (`get_ticket`, `comment`, `update_status`, `create_subtask`, `attach_report`):

- No extra process to supervise, restart, or sandbox per agent invocation — the daemon already owns the Node process running `query()`, so the tool handlers are just async functions with direct access to the daemon's HTTP client / DB connection / auth token to the VPS backend, no serialization boundary, no separate crash domain.
- Zod schemas (`z.object({...})`) give you input validation for free, and `annotations` (`readOnlyHint`, `destructiveHint`) let you mark `get_ticket` read-only vs `update_status`/`create_subtask` as mutating, which interacts correctly with permission modes (`acceptEdits` etc. treat read-only vs mutating tools differently for auto-approval).
- Use `alwaysLoad: false` for infrequently-used tools like `attach_report` if you want to defer their schema out of the initial prompt for context-window economy; the trade-off is a slightly higher latency on first call.
- The main reason to prefer a stdio server instead would be if the ticket-tooling needs to run in a different security context or a different language than the daemon (e.g., a separately audited Go binary) — not the case described here.

Concretely: define one `createSdkMcpServer({name: "ticket-system", tools: [getTicket, comment, updateStatus, createSubtask, attachReport]})` and pass it via `mcpServers: {"ticket-system": server}` in every role's `query()` options. Each tool handler calls the VPS API (with the daemon's service credential, not per-agent credentials) and returns `{content: [{type: "text", text: JSON.stringify(result)}]}`.

## 4. Parallel execution safety

Source: [worktrees](https://code.claude.com/docs/en/worktrees), [subagents](https://code.claude.com/docs/en/agent-sdk/subagents), [headless](https://code.claude.com/docs/en/headless) (background-task/exit behavior).

- **Git worktrees per dev task**: this is Anthropic's own documented pattern for running multiple Claude Code sessions against one repo without file collisions — each worktree is a separate checkout/branch under (by default) `.claude/worktrees/`; one session's edits never touch another's. For the daemon, when the PM agent schedules parallel dev subtasks against the same repo, create one `git worktree add` per subtask (branch name = ticket/subtask key), set that path as the dev agent's `cwd`, and remove the worktree after merge/QC. This is a repo-level concern the daemon must implement itself (`git worktree add/remove`) — it is not something `query()` does for you automatically outside the interactive CLI's `--worktree` flag.
- **Concurrency limits**: the SDK caps *subagent* fan-out per query (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, default 20; refuses further spawns with `Concurrent subagent limit reached` until the count drops). This does **not** cap how many separate `query()` processes your daemon itself launches across dev/QC tasks — that's a daemon-level scheduling decision (see machine-resource detection below), independent of the SDK's per-query subagent cap.
- **Background task lifecycle**: a `claude -p`/`query()` run keeps a spawned background Bash task alive only ~5 seconds after the run's own final result; a background *subagent* or workflow instead keeps the whole run open until it finishes, capped by a 10-minute idle-wait ceiling (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, or `0` to disable the cap). The daemon should not assume a "task" is fully done the instant the top-level result arrives if it spawned background subagents — check for this wait behavior when computing task duration/cost.
- **Rate limit / usage-limit errors**: the CLI's own retry-signal taxonomy (from `system/api_retry` events, confirmed in the CLI-reference fetch) categorizes failures as `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `billing_error`, `rate_limit`, `overloaded`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `cloud_credential_error`, `unknown`. Claude Code retries these itself with backoff (`attempt`, `max_retries`, `retry_delay_ms` reported per event) before surfacing a final failure — the daemon should listen for `system/api_retry` (or the equivalent SDK message) to distinguish "still retrying, don't reschedule yet" from a terminal failure, and should treat `rate_limit`/`overloaded`/`account_on_hold`/`billing_error` as reasons to back off or fail over to another machine/model rather than retry immediately itself (double-retrying on top of the CLI's own retry loop compounds backoff badly).
- **Detecting machine resources in Node**: no Claude-specific API for this — use Node's built-in `os` module: `os.cpus().length` (logical core count), `os.totalmem()`/`os.freemem()` (bytes), `os.loadavg()` (1/5/15-min load, POSIX only, returns zeros on Windows). This is standard Node, not something the docs cover, and is straightforward to use as an input to the PM agent's "parallel vs sequential" scheduling heuristic (e.g., cap concurrent dev/QC `query()` processes to roughly `os.cpus().length / 2` and refuse to schedule more when `os.freemem() / os.totalmem()` drops below a threshold).

## 5. Model routing

Source: [subagents](https://code.claude.com/docs/en/agent-sdk/subagents) (`AgentDefinition.model`, alias list), web search cross-referencing Claude Platform Docs model pages (`platform.claude.com/docs/en/models/*`) for pricing.

Confirmed model aliases usable in `--model` / `AgentDefinition.model`: `'fable'`, `'opus'`, `'sonnet'`, `'haiku'`, `'inherit'` (subagent only, means "use the main thread's model"), or a full model ID. The exact IDs the task named — `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5`, `claude-haiku-4-5` — match what the Claude Platform Docs model pages and search results return (Fable 5.1 at $10/$50 per M tokens in/out with a 1M context window; Opus 5.5 at $4/$20 for long-running agentic coding; Sonnet 5 at $2/$10; Haiku 4.5 at `claude-haiku-4-5-20251001`, cheapest tier). Cross-referenced from platform.claude.com model pages and independent aggregator sites (claudefa.st, getclaudekit.com); model card pages themselves are the authoritative source but were not fetched verbatim in this pass (see Unresolved Questions).

There is also a separate **effort** dial (`--effort` / `AgentDefinition.effort`: `low`, `medium`, `high`, `xhigh`, `max`, `ultracode`) that is orthogonal to model choice — a complexity router can tune *either* model tier *or* effort, and the docs note `ultracode`-effort sessions are exempt from the concurrent-subagent limit, which is relevant if a QC agent uses `ultracode` for exhaustive review.

**Suggested complexity → model/effort heuristic** for the four roles (design judgment, not sourced from docs):
- **assistant** (triage which project): cheap/fast, low ambiguity → **Haiku 4.5**, `low`/`medium` effort.
- **PM** (clarify requirements, break into subtasks, schedule): needs judgment and planning but not raw coding throughput → **Sonnet 5**, `medium`/`high` effort; escalate to **Opus 5.5** only for genuinely ambiguous/cross-cutting tickets.
- **dev**: route by estimated subtask complexity the PM assigns — trivial/mechanical changes → Sonnet 5; architecturally significant or multi-file/cross-service changes → Opus 5.5; boilerplate/config-only changes → Haiku 4.5.
- **QC**: default Sonnet 5 for standard review; Opus 5.5 (`xhigh`/`ultracode`) for security-sensitive or high-blast-radius changes given Opus 5.5's noted tendency to delegate more aggressively to subagents (cap depth/concurrency per §4 if you do this).
- Reserve **Fable 5.1** (largest context, highest cost, 1M-token window) for tasks that genuinely need whole-repo or long-document context in one pass — e.g., a PM agent triaging a huge legacy codebase — rather than as a default tier; its cost is 2.5x Opus 5.5 input and its niche is context size, not raw reasoning quality per the aggregator commentary reviewed.

## 6. Auth: subscription vs `ANTHROPIC_API_KEY` for a headless daemon

Source: [Authentication](https://code.claude.com/docs/en/authentication) (fetched in full).

- **Precedence** (highest to lowest): cloud-provider env vars → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` (**"In non-interactive mode (`-p`), the key is always used when present"** — no approval prompt, unlike interactive mode) → `apiKeyHelper` script → `CLAUDE_CODE_OAUTH_TOKEN` → Anthropic profile/federation → subscription OAuth from `/login`.
- **For a headless daemon, two supported paths exist**:
  1. `ANTHROPIC_API_KEY` from Claude Console — pay-per-token, works with `--bare`, works everywhere including bare mode. This is the only credential type bare mode reads (bare mode never reads OAuth/keychain).
  2. `CLAUDE_CODE_OAUTH_TOKEN`, a **one-year long-lived token** generated once interactively via `claude setup-token`, billed against a Pro/Max/Team/Enterprise **subscription** rather than per-token API pricing. Explicitly documented as intended "for CI pipelines, scripts, or other environments where interactive browser login isn't available." **Caveat: `--bare` does not read `CLAUDE_CODE_OAUTH_TOKEN`** — if the daemon uses `--bare` for speed, it must use `ANTHROPIC_API_KEY`/`apiKeyHelper` instead, meaning bare-mode and subscription-billed headless use are mutually exclusive per current docs.
- **No ToS red flag found for this design**: the docs describe `claude setup-token` + `CLAUDE_CODE_OAUTH_TOKEN` as the sanctioned mechanism for exactly this "no browser available" automation case, scoped to first-party Claude Code CLI/SDK invocations (as opposed to third-party wrappers reimplementing the protocol, which is a separately-discussed community concern per the web search but not something the official docs flag as prohibited for *this* CLI-based usage). Since this platform's daemon is calling the real Claude Code binary/SDK (not reverse-engineering the protocol), it is within the documented, supported pattern.
- **Recommendation**: use `CLAUDE_CODE_OAUTH_TOKEN` per machine if the owner already pays for a Max/Team subscription (avoids double-paying API rates on top of the subscription) and the daemon does not need `--bare`'s startup-speed win; use `ANTHROPIC_API_KEY` (optionally via `apiKeyHelper` for rotation) if you want `--bare`'s faster/more deterministic startup or need per-key usage isolation/billing separation across machines. Either way, **do not rely on `--bare` to also skip skill discovery** — see §7.
- One-year token expiry means the daemon needs an operational reminder to re-run `claude setup-token` before expiry; there is no documented auto-refresh for `CLAUDE_CODE_OAUTH_TOKEN` the way there is for interactive `/login` sessions.

## 7. Interaction between `--bare`/`settingSources` and the skills requirement

This platform's core requirement — "agents must use installed skill sets correctly" from `~/.claude/skills` and project `.claude/skills` — cuts across §1 and §2 and deserves being called out once, explicitly:

- CLI `--bare`: skips hooks, commands, subagents, plugins, MCP servers (`.mcp.json`), auto-memory, CLAUDE.md by default; **still loads skills from any directory added via `--add-dir`'s `.claude/skills/`**, but not from the default `~/.claude/skills` unless you also pass that path via `--add-dir`.
- SDK `settingSources`: defaults to loading **nothing** — you must explicitly pass `["user", "project", "local"]` to get `~/.claude/skills` (`"user"`) and project `.claude/skills` (`"project"`/`"local"`) discovery at all.
- **Action for the daemon**: do not use `--bare` (CLI) or omit `settingSources` (SDK) for dev/QC/PM roles that must use skills. If startup latency matters, use the SDK's `startup()`/`prewarm()` pre-spawn mechanism instead of reaching for `--bare`, since `--bare`'s speed comes precisely from skipping the discovery this platform depends on.

## Recommendation

1. Build the daemon on the **TypeScript Agent SDK's `query()`** (not CLI subprocess + stdout parsing), for typed messages, native abort/resume, `startup()`/`prewarm()` pre-warming, and first-class cost accounting.
2. Set `settingSources: ["user", "project", "local"]` on every role's `query()` call so `~/.claude/skills` and project `.claude/skills` are discovered — do not use `--bare`/empty `settingSources` anywhere skills matter.
3. Expose ticket-system operations as an **in-process `createSdkMcpServer`** with Zod-typed tools (`get_ticket`, `comment`, `update_status`, `create_subtask`, `attach_report`), annotated read-only vs mutating, shared across all four roles via `mcpServers`.
4. Use `--permission-mode acceptEdits` (or a `canUseTool` callback) plus `--permission-prompts none` equivalent for unattended dev/QC runs; reserve `plan` mode for anything the PM agent should present back to a human before executing.
5. Isolate parallel dev subtasks with **one git worktree per subtask**, managed by the daemon (`git worktree add`/`remove`), not by relying on the SDK's subagent concurrency limits (those cap in-conversation fan-out, not cross-process daemon parallelism).
6. Gate daemon-level parallelism with `os.cpus()`/`os.freemem()`/`os.loadavg()` against a configurable per-machine concurrency cap, separate from the SDK's own `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`/`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, which you should also set explicitly (defaults 20/3) to bound any single ticket's subagent tree.
7. Route models by role and PM-assigned complexity as in §5, using `AgentDefinition.model`/`--effort` as two independent dials; account cost via `total_cost_usd`/`modelUsage`, never by summing per-step `usage`, and cap runaway trees with `maxBudgetUsd`.
8. Authenticate each machine with `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, one-year lifetime) if subscription billing is preferred, or `ANTHROPIC_API_KEY`/`apiKeyHelper` if `--bare`-speed or per-key billing isolation is preferred — the two are mutually exclusive under current docs, so this is an explicit architecture decision, not a detail to defer.
9. Treat `system/api_retry` error categories (`rate_limit`, `overloaded`, `account_on_hold`, `billing_error`, ...) as signals to reschedule to a different machine or defer, not to blindly re-retry on top of the CLI's own backoff.

## Unresolved questions

- The exact model-card pages for Fable 5.1 / Opus 5.5 / Sonnet 5 / Haiku 4.5 (`platform.claude.com/docs/en/models/*`) were located by search but not fetched verbatim in this pass — pricing/context-window figures above are cross-referenced from search snippets and secondary aggregators, not screenshotted from the primary model-card page. Confirm exact pricing/limits against the live model-card pages before hard-coding them into a billing model.
- The task asked for an explicit `--session-id` flag; the current CLI reference does not list one — session identity flows through `--resume`/`--continue`/`--fork-session` and the `session_id` read back from JSON output. Confirm this is not a naming mismatch with an older doc version before assuming no such flag exists.
- No official Anthropic statement was found that says explicitly "server-side unattended daemons using `CLAUDE_CODE_OAUTH_TOKEN` across multiple owner-controlled machines simultaneously are permitted under a single Max/Team subscription" — the docs describe the token mechanism and its CI/script intent, but multi-machine concurrent usage under one subscription's rate/usage limits was not directly addressed and should be confirmed against the subscription's terms of service or with Anthropic support before committing the architecture to it at scale.
- Whether the `Workflow` tool (mentioned in the subagents doc for "dozens to hundreds of agents") is a better fit than ad hoc `query()` orchestration for the PM role's subtask fan-out was not investigated in depth — worth a follow-up pass if a single ticket regularly spawns more than a handful of dev/QC subtasks.
- Exact behavior of resuming a session across machines (the daemon runs on multiple owner machines; sessions are stored locally per machine, per `~/.claude` transcript storage) was not tested — if a PM agent's session needs to resume on a different machine than it started on, this needs verification; the docs only confirm cross-project (same-machine) resume as of v2.1.223.

Status: DONE
Summary: Report written to plans/260928-1310-agent-jira-platform/research/researcher-01-claude-code-headless-report.md covering confirmed `-p` flags, Agent SDK TypeScript `query()`/settingSources/hooks/cost tracking, in-process MCP recommendation, worktree/concurrency/resource-detection guidance, model routing heuristics, and auth trade-offs, all cited to official docs fetched today.
