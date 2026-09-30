---
title: "2P Crew"
description: "Jira/Confluence-like ticket and docs system where a human owner assigns tickets to an assistant agent, which routes them through per-project PM, dev and QC Claude Code agents running on local machines."
status: completed
priority: P1
effort: 132h
tags: [feature, backend, frontend, api, database, auth, infra, docs]
blockedBy: []
blocks: []
created: 2026-09-28
---

# 2P Crew

## Overview

One owner uses a web app on a VPS to create tickets and assign them to an **assistant agent**. A TypeScript
**daemon** on each local machine connects out to the VPS, knows which projects that machine owns, and runs
Claude Code agents through the Agent SDK. The assistant triages a ticket to a project and hands it to that
project's **PM agent**. The PM clarifies requirements with the owner in the ticket's comment thread, then splits
the work into dev and QC subtasks. Each subtask gets a complexity rating, a model, the required skills and its
dependencies. The daemon schedules subtasks against machine resources. Dev and QC agents implement the work,
update status and file reports. The PM accepts the result and reports back to the assistant, which closes the
original ticket. A ticket cannot reach Done without a report.
Every project follows one docs standard with a per-flow file index. Agents read the docs before they read code.
After the initial docs init, a pre-commit hook and CI reject any commit that changes code without updating the
flow docs. Docs snapshots sync to the web for read-only viewing.

Diagrams (local file): [diagrams/system-diagrams.html](./diagrams/system-diagrams.html) covers the VPS ↔ machine data flow, the ticket lifecycle and the commit gate.

Research: [Claude Code headless](./research/researcher-01-claude-code-headless-report.md) ·
[Backend, realtime, docs standard](./research/researcher-02-backend-realtime-docs-report.md)

## Accepted decisions (owner, 2026-09-28)

- Product name: **2P Crew** (company 2P Solutions). The web runs at `https://crew.2p-solutions.com`. Code names: packages `@crew/*`, CLIs `crew-docs` and `crewd`, local config `~/.crew`, branch prefix `crew/`, commit trailers `Crew-*`.

- Agent runtime: Claude Code through the TypeScript Agent SDK `query()` (same binary as `claude -p`).
- Stack: pnpm TS monorepo. The API uses Fastify, Drizzle and PostgreSQL. The web app uses React, Vite and TanStack Router/Query. The daemon runs on Node.
- Scale: one human owner and several local machines. Each machine owns one or more projects, and exactly one machine hosts the assistant.
- Docs: the repo is the source of truth. The daemon syncs snapshots to the web, which shows them read-only (with search).
- Each project is owned by exactly one machine, and all of its roles (PM, dev, QC) run there. Exactly one machine hosts the assistant.
- Each dev ticket has one paired QC ticket. QC files bugs as new `bug` tickets for dev, each with a paired QC retest, capped at 3 cycles.
- PM accept merges locally and pushes, with no human review. The mandatory pre-push gate (tests, `crew-docs` R1–R7, protected paths) is the safety net.
- Agents run as the owner's OS user and may use local credentials. Credentials must never leave the machine (R7 secret scan, comment/report scrubbing).
- Owner login uses password plus TOTP.
- On each machine the owner installs only the **2P Crew** Electron desktop app: a universal dmg with Node bundled, a setup wizard, a health dashboard with one-click fixes, a menu bar icon and start at login. It embeds the daemon. The CLI remains for headless Linux.
- In the app the owner chooses which projects this machine runs, the folder for each, and whether it hosts the assistant. The app can also create a new project from a folder. A project or assistant role that is unowned is claimed at once. Taking one over from another machine needs owner approval on the web (TOTP).
- Claude auth: the owner's subscription login on each machine. The daemon runs as a user LaunchAgent and strips `ANTHROPIC_API_KEY`.
- GitHub hosts the repos (GitHub Actions for CI). There is no default cost budget; only the child-ticket cap is enforced by default.
- All docs, ticket comments and reports are in Vietnamese. Code identifiers and paths stay English.
- All documentation work runs on the **sonnet** model, whatever the complexity map or the PM picks: the docs-init ticket, and a docs-update job that follows every dev and bug run and commits code and docs together.

## Architecture

```
Owner browser ──HTTPS──► Caddy ─┬─► web (static SPA)
                                └─► api (Fastify) ──► PostgreSQL (tickets, comments, reports, events=outbox, docs snapshots)
                                        ▲  │ SSE /v1/daemon/stream (cursor replay)
                          REST writes   │  ▼
                 ┌──────── daemon (machine A: assistant + project X) ────────┐
                 │ SSE client → dispatcher → scheduler (resource slots)      │
                 │ agent runner = Agent SDK query() + in-process ticket MCP  │
                 │ git worktrees per subtask · docs-kit hooks in each repo    │
                 └────────────────────────────────────────────────────────────┘
                 daemon (machine B: project Y, Z) ... same shape
                 each daemon runs inside the 2P Crew desktop app (setup wizard, health dashboard, tray)
```

## Phases

| # | Phase | Status | Depends on |
|---|-------|--------|------------|
| 1 | [Monorepo Foundation](./phase-01-monorepo-foundation.md) | Completed | — |
| 2 | [Backend Core](./phase-02-backend-core.md) | Completed | 1 |
| 3 | [Event Delivery and Machine Auth](./phase-03-event-delivery.md) | Completed | 2 |
| 4 | [Web App](./phase-04-web-app.md) | Completed | 2, 3 |
| 5 | [Docs Standard and Enforcement](./phase-05-docs-standard.md) | Completed | 1, 3, 4 |
| 6 | [Local Daemon Core](./phase-06-local-daemon.md) | Completed | 3, 5 |
| 7 | [Agent Workflow](./phase-07-agent-workflow.md) | Completed | 6 |
| 8 | [Deploy and E2E](./phase-08-deploy-and-e2e.md) | Completed | 4, 7, 9 |
| 9 | [Local Desktop App](./phase-09-local-desktop-app.md) | Completed | 6 (can run in parallel with 7) |

## Success Criteria

- [ ] The owner creates a ticket on the web and assigns it to the assistant. Within 10s the assistant daemon picks it up, and no event is lost across disconnects or crashes.
- [ ] The assistant routes the ticket, using only owner-entered project descriptions, and creates a PM ticket on the machine that owns the project.
- [ ] The PM asks in the ticket (`needs_input`), and the owner's reply resumes the same session.
- [ ] The PM creates dev tickets, each with a paired QC ticket, and each with complexity, model, effort, skills and dependencies. The daemon runs them within its resource slots, one worktree per ticket and one active job per ticket.
- [ ] QC bugs become new dev tickets with a paired retest. The chain stops at 3 cycles and asks the owner.
- [ ] Every agent run, for every role and task (triage, analysis, breakdown, dev, QC, acceptance, docs-init), first checks the machine's and project's skills **and MCP servers**, then picks and uses the relevant ones and reports what it chose and why. QC always tests UI with **Maestro MCP (mobile)** or **Playwright MCP (web)**. Every other MCP is the agent's choice. The PM also sees every skill installed on the machine (name, source, description), exactly as dev and QC will see them in their worktrees, even when `.claude/` is gitignored. It picks the right skills per subtask from that list, and no skill kit is forced.
- [ ] Each run records the skills invoked and whether docs were read first. The PM rejects runs that miss either one.
- [ ] The API refuses `done` without a report. Completion propagates dev/QC → PM → assistant through server events (`dependency.resolved`, `children.all_done`).
- [ ] A project without docs gets a docs-init ticket before any other subtask. After that, the pre-commit and pre-push hooks and CI reject commits that change code without updating flow docs (R3), change protected config (R6), or contain credentials (R7).
- [ ] The web is responsive (phone, tablet, desktop) and works like Jira: project sidebar, board with a side-panel ticket view, a list view, a Details box, quick search and shortcuts. Docs work like a Confluence space: page tree, breadcrumbs, table of contents, and flow pages linked both ways with tickets. Everything shows the latest synced commit.
- [ ] On a Mac without Node, installing the 2P Crew dmg and completing the setup wizard gives an all-green health dashboard. Health is also visible on the web Machines page, and broken checks offer a one-click fix.
- [ ] Nothing is left behind after a task. Processes started by agents are tagged and stopped when their job ends, temp files are deleted, and worktrees are removed. The PM checks and cleans with `resource_report` and `cleanup_resources` and lists the cleanup in its report. A 10-minute sweep catches anything missed.
- [ ] The scripted lifecycle matrix (bug loop, cancel, crash, backoff, budget cap, docs-init) passes in CI with no stuck tickets.
- [ ] The stack deploys with `docker compose up -d` on the VPS behind HTTPS, with nightly Postgres backups and a tested restore.

## Dependencies

- Claude Code CLI (v2.1.277 or newer) and a pinned `@anthropic-ai/claude-agent-sdk` on every machine, with the owner's Claude subscription logged in (`/login`) on each machine.
- A Linux VPS with Docker (confirmed by the owner), plus DNS for `crew.2p-solutions.com` pointing to it, and Node 22 LTS or newer on the local machines.

## Red Team Review

### Session — 2026-09-28
**Findings:** 15 after dedupe, from 40 raw findings by 4 reviewers. 15 accepted: 11 as proposed, 2 modified by the owner, 2 applied with owner decisions. Parts of findings were rejected: the owner approval gate on assistant-created tickets, and cutting docs search, systemd or `autoCloseRequests` (the owner kept them).
**Severity breakdown:** 6 Critical, 7 High, 2 Medium.
Reports: [security](./reports/red-team-security.md) · [failure modes](./reports/red-team-failure-modes.md) · [assumptions](./reports/red-team-assumptions.md) · [scope/contracts](./reports/red-team-scope-contracts.md)

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Dev↔QC deadlock, no wake-up events | Critical | Accept (modified: paired QC plus bug tickets) | 1, 2, 6, 7 |
| 2 | QC worktree empty; cross-machine access | Critical | Accept (plus the one-project-one-machine decision) | 2, 3, 6, 7 |
| 3 | Status workflow gaps (cancel, ask_owner, done paths, docs-init report) | Critical | Accept | 1, 2, 4, 6, 7 |
| 4 | `canUseTool` bypass; repo settings widen permissions | Critical | Accept | 5, 6, 7 |
| 5 | Agents can leak credentials | Critical | Accept (modified: local credentials allowed; no-credential-push rule) | 5, 6 |
| 6 | Cross-project prompt injection with an unreviewed push | Critical | Accept (the owner kept local merge; pre-push gate) | 3, 5, 7 |
| 7 | Pairing trusts machine claims; revocation leaves streams open | High | Accept (modified in Validation Session 3: claims come from the local app; takeovers need owner approval) | 2, 3, 4, 9 |
| 8 | `initializedAt` self-SHA; hooks in worktrees; change-log conflicts | High | Accept | 5, 6, 7 |
| 9 | Duplicate jobs per ticket or session; non-idempotent retries | High | Accept | 2, 3, 6, 7 |
| 10 | Stuck states (backoff, blocked, offline machine, fan-out cost) | High | Accept | 2, 3, 6, 7, 8 |
| 11 | Event delivery had four overlapping mechanisms | Medium | Accept (cursor only) | 3, 6 |
| 12 | Skill inventory misses plugin skills | High | Accept | 6, 7 |
| 13 | Owner auth is a single factor; CSRF client-side only | High | Accept (TOTP) | 2, 4 |
| 14 | Tests cannot catch lifecycle failures | Medium | Accept (scripted runner matrix) | 6, 7, 8 |
| 15 | Gold plating | Medium | Partial: OpenAPI, rclone and keytar cut; docs search, systemd and `autoCloseRequests` kept | 2, 4, 6, 8 |

### Whole-Plan Consistency Sweep
- Searched every file for superseded terms: `initializedAt`, `machine_projects`, `event_deliveries`, ack route, `seen_events`, `keytar`, `canUseTool`, `acceptEdits`, the per-commit change log, `subtask.completed`, `docs-check.yml`, swagger, rclone, `mergePolicy`. They remain only in history notes and in this table.
- Checked every role-contract status path in Phase 7 against the Phase 1 actor table: all legal.
- Event names match across Phases 1, 2, 3, 6 and 7. The phase dependency for 5 → 4 is fixed in the table.
- No unresolved contradictions.

## Validation Log

### Session 1 — 2026-09-28
**Trigger:** post red-team validation. **Questions asked:** 4

1. **Claude auth per machine.** Answer: the owner logs into the subscription on each local machine. Phase 6 now runs the daemon as a user LaunchAgent (Keychain access), strips `ANTHROPIC_API_KEY`, and `doctor` checks the login. Running one subscription on several machines at once stays an accepted risk.
2. **Git host.** Answer: GitHub. There is no change; `crew-docs ci-workflow` generates GitHub Actions.
3. **Default budget.** Answer: no default limit. In Phases 2, 6 and 7 the budgets are nullable, and only the child cap (12) and the cycle and attempt caps are always on.
4. **Language.** Answer: all Vietnamese. Phase 5 docs prose and headings are Vietnamese, while identifiers, paths and keys stay English. Phase 7 prompts carry a language rule.

### Verification Results
- Claims checked: the repo is greenfield, so every file path is a planned create; there is no existing code to verify against.
- Verified: 0 | Failed: 0 | Unverified: 2 (Phase 6: the SDK init field that lists skills, and the `dontAsk` semantics, tagged `[UNVERIFIED]` to confirm against the pinned SDK)
- Tier: Full (8 phases)

### Whole-Plan Consistency Sweep
- Searched for `agent.env`, `CLAUDE_CODE_OAUTH_TOKEN`, budget defaults and the English-only doc headings. `CLAUDE_CODE_OAUTH_TOKEN` remains only in the research report, and the plan no longer relies on it. No contradictions remain.

### Session 2 — 2026-09-28 (owner follow-up)
- **Gap raised by the owner:** the plan had no installable local app with a UI.
- **Decision:** an Electron desktop app, added as Phase 9. It covers the setup wizard, health dashboard, tray, login item, bundled Node and updater.
- **Propagated:**
  - Phase 6: `createDaemon()` library entry; `doctor` uses the shared health checks; the macOS launchd plist is replaced by the app's login item.
  - Phase 5: the hook runtime path is explicit.
  - Phases 3 and 4: heartbeat health summary shown on the web.
  - Phase 8: the CI desktop build and dmg release, and 8 now depends on 9.
- **Consistency sweep:** `launchd` remains only in Phase 9, as the removed file. Effort is now 120h.

### Session 3 — 2026-09-28 (owner follow-up)
- **Owner request:** the local app sets which projects the machine runs, and which folder each uses.
- **Decisions:** claims come from the app. Unowned projects and an unheld assistant role are bound at once, with an inbox notice. Taking over from another machine needs owner approval on the web (TOTP). The app may create a new project from a folder; the owner types the description, which is never read from the repo. Pairing codes no longer carry claims.
- **Propagated:**
  - Phase 1: claim events.
  - Phase 3: claim endpoints, `claim_requests`, project creation.
  - Phase 4: claim approval in the inbox; pairing without claims.
  - Phase 6: config written by the app or CLI.
  - Phase 9: the wizard's project and folder step, and Settings → Projects.
- **Consistency sweep:** "owner-set claims" and "pairing with claims" were replaced in Phases 3, 4 and 9. The Red Team #7 row is annotated as modified.

### Session 4 — 2026-09-28 (owner follow-up)
- **Owner request:** make the web UI feel like Jira and Confluence, so it is easy to use.
- **Propagated:**
  - Phase 4: a UX spec covering the app shell, sidebar, board with side panel, list view, ticket layout, create dialog, quick search, shortcuts and a Jira-like theme. Effort is now 20h.
  - Phase 5: a Confluence-like space viewer. Effort is now 18h.
  - Phase 2: the `tickets.flows[]` field, list filters and the `/v1/search` endpoint.
- **Consistency sweep:** `flows[]` is used in Phases 2, 4 and 5. The PM breakdown (Phase 7) already records the flows touched and now writes them to `flows[]`.
- **Mockup approved by the owner (2026-09-28):** `mockups/web-ui-mockup.html` is the visual reference for Phase 4 and the Phase 5 docs viewer.

### Session 5 — 2026-09-28 (owner follow-up)
- **Rename:** the placeholder "AJ" (Agent Jira) is replaced by **2P Crew**, with the domain `crew.2p-solutions.com`. Every plan file, the mockup and the diagrams now use the new names. The plan folder is renamed to `260928-0613-crew-platform`. The research and red-team reports keep the old names as historical records.

### Session 6 — 2026-09-28 (owner follow-up)
- **Owner requirement:** the project's PM manages resources, clears temp files when a task finishes, and checks that nothing started during work is left running.
- **Propagated:**
  - Phase 6: `CREW_JOB_ID` process tagging, a per-job `TMPDIR`, automatic end-of-job cleanup (SIGTERM then SIGKILL, temp dir removal), a 10-minute orphan sweep, and the PM tools `resource_report` and `cleanup_resources`. Only tagged processes are ever touched, and Docker containers are report-only.
  - Phase 7: PM duties at breakdown, after each child and at accept; a "Dọn dẹp tài nguyên" report section; the `left_resources` flag; a resource rule in the dev and QC prompts; a new lifecycle scenario.
  - Phase 9: a Resources health group with a cleanup button.
- **Effort:** 129h.

### Session 7 — 2026-09-28 (owner follow-up, corrected)
- **Owner intent:** BMAD and AgentKit were only examples. No kit is forced. Whatever skills a machine has, the PM must know them and choose.
- **Gap found while scouting:** a project with `.claude/` gitignored would give worktrees none of its project skills.
- **Propagated:**
  - Phase 6: untracked agent config (auto-detected `.claude/`, `CLAUDE.md`, `AGENTS.md`, plus owner-added paths) is symlinked into every worktree; the inventory is probed inside a job-like worktree and carries each skill's description and source.
  - Phase 7: the PM gets the full inventory and picks per subtask with a one-line reason; a headless rule for interactive skills.
  - Phase 9: a read-only skill list per project and the shared-paths setting.
- **Removed:** the per-project "role default skills" setting added earlier in this session. It forced skills, which the owner did not want.

### Session 8 — 2026-09-28 (owner follow-up)
- **Owner requirement:** the skill check applies to every task type, not only dev and QC. For example, PM requirement analysis must also look for relevant skills on the machine or in the project and use them.
- **Propagated:**
  - Phase 7: a shared `_skill-preflight.md` partial in every role prompt, `skills_selected` with reasons, a daemon check of selected versus invoked skills, a scripted scenario per role, and a live criterion for PM analyze.
  - Phase 6: the inventory goes in every role's context block.
  - Phase 2: the report field `skills_selected`.

### Session 9 — 2026-09-28 (owner follow-up)
- **Owner requirements:**
  - Also check the MCP servers the machine or project has, and use them.
  - QC defaults to Maestro MCP for mobile and Playwright MCP for web.
  - Every other MCP is the agent's choice.
- **Propagated:**
  - Phase 6: an MCP inventory from every source, with status and tools; headless auto-approval of the project servers in the inventory ([UNVERIFIED] against the SDK); MCP tools in `allowedTools`; a per-project disable switch; stdio servers cleaned up with the job.
  - Phase 7: the capability preflight (skills and MCP); `mcps_selected`, `required_mcps`, `mcps_missing`; the QC default rule with `blocked` when the default server is missing.
  - Phase 2: `projects.platform`, the `ui_test_mcp` mapping, the QC default added on creation, and the report and ticket fields.
  - Phase 9: the project type and MCP mapping in the app, and the MCP health check (Playwright or Maestro plus device).

### Session 10 — 2026-09-28 (owner follow-up)
- **Owner requirement:** the web UI must be responsive.
- **Propagated:**
  - Phase 4: a responsive spec with desktop, tablet and phone breakpoints (drawer sidebar, swipe board, full-screen ticket, card list, pinned reply box), touch rules, and viewport E2E criteria.
  - Phase 5: a responsive docs space.
  - Phase 8: E2E at three viewports.
- **Mockup:** tab "5. Mobile" of `mockups/web-ui-mockup.html` shows the phone layouts: swipe board, full-screen ticket with a pinned reply box, and docs with a collapsed table of contents.

### Session 11 — 2026-09-28 (owner follow-up)
- **Owner decision:** all documentation work runs on the `sonnet` model, including the flow-doc updates that come with code changes.
- **Propagated:**
  - Phase 7: docs-init is `sonnet / high (fixed)` (was `opus / high`). A new docs-update step follows every dev and bug run: the dev run ends with `handoff_docs` without committing, and a `docs_update` job on `sonnet` in the same worktree updates the flow docs and commits code and docs together, so R3 needs no bypass. `model-policy.ts` pins both to `sonnet`; unit tests, two lifecycle scenarios and success criteria check it. Effort is now 19h.
  - Phase 6: the `docs_update` job kind, the dev-only `handoff_docs` tool, a guard limiting the docs job to `docs/`, and config validation that requires `sonnet` in `models.allow`. Effort is now 21h.
- **Effort:** 132h.
- **Consistency sweep:** no phase file still says dev writes or commits flow docs, and `opus / high` no longer appears for docs-init.

### Session 12 — 2026-09-28 (owner follow-up)
- **Owner decision:** when the owner approves going past a child cap or budget hold (a comment or resume on the held pm_task), the limit is lifted for the rest of that pm_task's tree, not for a single batch. This is what Phase 2 implemented; see [the Phase 2 report](./reports/phase-02-implementation-report.md).

### Session 13 — 2026-09-28 (owner follow-up)
- **Owner decisions on the Phase 3 claim contract:**
  - A claim on a target that another machine holds returns **202** `{status: 'pending', claimRequestId}` instead of 409 `CLAIM_PENDING`. The error code is removed.
  - Revoking a machine releases its projects and assistant role at once, as implemented.

### Session 14 — 2026-09-29 (owner follow-up)
- **Owner decisions:**
  1. A skill the agent selected but never invoked keeps counting as missing (Phase 7 behaviour unchanged).
  2. **To check later:** in all three live runs the PM put QC on haiku, below the QC contract default (sonnet/high). Decide whether QC needs a minimum model after more live runs.
  3. The desktop app ships **one dmg per architecture** (arm64 and x64) instead of one universal dmg.
  4. A machine may change its own project's type and UI-test MCP mapping from the desktop app, but **only after the owner confirms on the web** (TOTP), like a claim takeover.
  5. Infrastructure changes to this repo's protected paths use the trailer `Crew-Owner-Approved: CREW-0`. The owner approved "CREW-SELF", but R6 only accepts a ticket-shaped key (`[A-Z][A-Z0-9]{1,9}-<number>`), so `CREW-0` stands for it; no real ticket uses number 0.
  6. The `_probe` worktree used for the capability inventory is kept for 1 hour after a probe, then removed.
  7. "Chỉ ticket của tôi" means tickets waiting for the owner (needs_input, blocked, budget hold), as built.
  8. The inbox read state is stored on the server, so every device shares it.

### Session 15 — 2026-09-29 (owner follow-up)
- **Owner decision:** deploy to the VPS reached as `ssh nhamoiplatform`. It already runs two landing pages behind one shared nginx container (`2ps-landing-nginx`, owns host ports 80/443, certbot in `2ps-landing-certbot` with the shared `2ps-landing_certbot-conf` volume). kidyschool.com is attached to it with a mounted conf file plus an external network in `/opt/2ps-landing/docker-compose.override.yml`.
- **Change to Phase 8:** no Caddy. The crew stack lives in `/opt/crew`, publishes no host ports, and joins the shared nginx the same way kidy does. SSE needs `proxy_buffering off` on `/v1/`. Until DNS points at the VPS, only the HTTP server block is installed (a missing certificate would stop the shared nginx and take both landing pages down); `scripts/enable-https.sh` issues the certificate and switches the block to HTTPS once DNS is mapped.
- **Domain (owner-confirmed):** `crew.2p-solutions.com` (company site https://2p-solutions.com/). It is one variable in the deploy config.

### Session 16 — 2026-09-29 (owner follow-up)
- **Owner decisions:**
  1. The VPS reloads the shared nginx daily so renewed certificates are served. Installed as the systemd timer `nginx-cert-reload.timer` (04:17 daily, `Persistent=true`; the service reloads only after `nginx -t` passes). The VPS has no cron installed, so a timer is used. It covers the two landing pages as well.
  2. A pending project settings change request is **withdrawn automatically** when the requesting machine loses the project (claim moved, released, or machine revoked).
  3. The desktop build adds a **zip per architecture** now, so signed auto-install works as soon as the app is signed.

### Session 17 — 2026-09-29 (owner follow-up)
- **Owner decision:** the PM must assess each dev and QC subtask's complexity to choose its model; there are no model defaults for dev or QC.
- **Applied:**
  - `complexity` (with a one-line reason) is required when the PM creates a dev or QC subtask; the server refuses one without it. The model comes from the machine's complexity map; the stage defaults for dev and QC are removed.
  - The PM rates QC on its own testing effort (UI testing, number of flows, risk), not by copying the dev rating.
  - A `bug` ticket filed by QC inherits the complexity of the dev ticket it came from (the PM's assessment).
  - Unchanged: docs work stays fixed on sonnet (Session 11); Fable still needs the PM's written reason.
  - Earlier note to check QC's model after live runs (Session 14, item 2) is resolved by this rule.

### Session 18 — 2026-09-29 (owner follow-up)
- **Owner decision:** Fable is not used at all. No agent run may choose it: the server rejects `model: fable` on any ticket, the model policy never resolves to it, the desktop app does not offer it in the model allowlist, and the PM prompt no longer mentions it. The "Fable only with a written reason" rule from Phase 7 is removed. The strongest model the PM can pick is opus (complexity `large`).

### Session 19 — 2026-09-29 (owner follow-up)
- **AgentKit sharing dropped:** AgentKit activates per device (the owner signs in by email OTP; only a device-bound session is stored, no license key), so copying its install or session to other machines is not done.
- **Owner decision — BMAD on other machines:** BMAD (bmad-method, MIT) is installed per project and mostly not committed. The machine that holds a project records the project's BMAD profile (version, modules, tools, communication/document languages, output folder) from `_bmad/_config/manifest.yaml` and `config.toml` on the server. A **"Cài BMAD" button** in the desktop app's project settings (manual only, no automatic install) installs exactly that profile with `npx bmad-method@<version> install --yes …`, and skips when `_bmad` already has that version and those modules. Only the standard install: `_bmad/custom` and `_bmad/memory` are not copied. The inventory is re-probed afterwards.

### Session 20 — 2026-09-29 (owner follow-up)
- **Owner decision:** the owner can wake the PM from any stuck ticket by tagging it in a comment. An owner comment containing `@pm` on any ticket of a pm_task tree (dev, qc, bug, docs_init, or the pm_task itself) wakes that tree's PM with the comment text and the tagged ticket key as context; an untagged comment keeps waking the ticket's own agent. The web comment box suggests `@pm` and marks tagged comments.
- A PM re-rating (`rate_subtask`) keeps replacing any earlier model override (kept as built).

### Session 21 — 2026-09-29 (owner follow-up)
- **Owner decisions on "Cài BMAD":**
  1. If the machine already has any BMAD install in the project (`_bmad` present), the button does nothing, whatever its version or modules. No update and no downgrade.
  2. A fresh install pins external modules to the exact tags recorded in the profile with the installer's `--pin` option, so every machine gets the same setup.

### Session 22 — 2026-09-29 (owner follow-up)
- **Incident:** no job could write the repo-root `README.md`: the dev run leaves docs to the docs job, and the `docs_update` guard only allowed `docs/`. KIDYLANDIN-3, P2PSLANDIN-3 and KIDYADMIN-5 stopped in `needs_input`. KIDYADMIN-4 (QC) was blocked because the QC Playwright rule applied to a Markdown-only change.
- **Owner decisions:**
  1. Markdown files at the repo root (`README.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, …) count as docs: the `docs_update` job (sonnet) may write `docs/**` and root `*.md`; the dev run may not. `AGENTS.md` and `CLAUDE.md` stay R6-protected.
  2. QC must use its UI-test MCP (Playwright/Maestro) only when the change under test touches UI source files; for a docs-only diff a static review is enough and the report says why.
  3. The project badge on board cards stays inside the card (wraps/truncates instead of overflowing).

### Session 23 — 2026-09-29 (owner follow-up)
- **Owner decisions:**
  1. `AGENTS.md` becomes R6-protected like `CLAUDE.md`: outside a docs-init commit, a change to it needs the `Crew-Owner-Approved: <ticket-key>` trailer, and the agent guard denies writing it (except docs-init).
  2. When a run ends without finishing its ticket (`not_finished` and other failures), the daemon's comment includes the agent's last message (scrubbed, trimmed), the stage and step it was on, turns, duration and cost, so the owner can tell why from the web.

### Session 24 — 2026-09-29 (owner follow-up)
- **Incident:** 8 tickets blocked. (a) Playwright MCP failed in QC worktrees: "Socket directory path is too long (87 bytes); set PWTEST_SOCKETS_DIR" — the per-job `TMPDIR` path is too long for a Unix socket (KIDYLANDIN-6, KIDYLANDIN-18, P2PSLANDIN-6). (b) The docs-only QC rule compared the dev `head_sha` with the default branch, whose diff still includes the unmerged docs-init commit, so docs-only changes kept requiring Playwright (KIDYLANDIN-4, KIDYLANDIN-14, P2PSLANDIN-4, KIDYADMIN-4). (c) Owner comments on `blocked` tickets did not unblock them.
- **Owner decisions:**
  1. Each job gets a short temp dir (e.g. `/tmp/crew/<short id>`) and `PWTEST_SOCKETS_DIR` is set to a short path for MCP servers.
  2. The docs-only check looks only at the commit(s) of the dev/bug ticket under test (the docs job's single commit: `head_sha^..head_sha`, or the ticket's own recorded base), not the default branch.
  3. An owner comment on a `blocked` ticket unblocks it (same as moving it to "Đang làm").

### Session 25 — 2026-09-30 (owner follow-up)
- **Owner decision:** remove TOTP everywhere. Login is password only; pairing a machine, approving a takeover, approving a project type/MCP change and changing the password need no TOTP code (a confirm click, and the current password for a password change). The owner keeps the current password and accepts the risk (the site is public and controls agents that run and push code on the owner's machines); the login rate limit stays. The TOTP secret and recovery-code columns stay in the database unused (no destructive migration).

### Session 26 — 2026-09-30 (owner follow-up)
- **Owner decision:** stop repeated macOS permission prompts: sign every build with one stable self-signed certificate (grants survive updates), guide the owner to grant Full Disk Access once, and rely on hot updates so most updates don't change the binary. Details in plans/260930-0940-server-config-and-hot-update/phase-02-signed-hot-updates.md.
