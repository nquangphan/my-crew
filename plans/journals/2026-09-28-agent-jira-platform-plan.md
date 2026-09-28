---
title: Agent Jira platform plan
date: 2026-09-28
summary: Hard-mode plan with red team and validation for the agent Jira/Confluence platform
---

# Agent Jira platform plan

## Context
Planned a greenfield Jira/Confluence-like platform. An owner assigns tickets to an assistant agent. Local daemons run Claude Code agents (assistant, PM, dev, QC) through the Agent SDK, and one docs standard is enforced by pre-commit, pre-push and CI.

## Decisions
- Stack: TS pnpm monorepo. The API uses Fastify, Drizzle and Postgres. The web app uses Vite, React and TanStack. Deploy is Docker Compose with Caddy.
- Delivery: SSE push plus REST writes. A Postgres events table is both outbox and audit log, with cursor-only replay.
- Each project is owned by one machine, with all roles there. Each dev ticket has a paired QC ticket, QC bugs become new dev tickets, and the chain is capped at 3 cycles.
- PM accept merges locally and pushes, with a pre-push gate (tests, aj-docs R1–R7, protected paths). Agents run as the owner user. Credentials must never leave the machine.
- Docs standard: `docs/flows.yaml` manifest plus a flow doc per flow and a generated file→flow index. R3 requires every code commit to touch its flow docs. Docs are written in Vietnamese.

## Red team lessons
- The first draft deadlocked: QC waited for dev `done`, and only QC could mark dev done. Wake-up events and the status table must be replayed per role contract in tests.
- `canUseTool` does not guard auto-approved calls. Enforcement belongs in an inline PreToolUse hook, because `settingSources` loads repo settings.
- A commit cannot contain its own SHA. The docs-init commit is identified by a trailer instead.

## Open risks
- Running one Claude subscription on several machines at once is unconfirmed officially.
- Two SDK details are unverified: the init field that lists skills, and `dontAsk` semantics.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
