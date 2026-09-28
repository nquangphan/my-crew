---
title: "Phase 1: Monorepo Foundation"
status: todo
priority: P1
effort: 6h
dependsOn: []
---

# Phase 1: Monorepo Foundation

<!-- Updated: Red Team 2026-09-28 - actor-aware status workflow, bug/qc ticket types, effort, new event types -->

## Overview

Set up the pnpm TypeScript monorepo and the shared contract package that every other phase imports. The API,
web app and daemon share one set of Zod schemas for tickets, events and agent roles, and one status workflow
table, so shapes and rules cannot drift between them.

## Key Insights

- The web app, the API and the daemon consume the same event and ticket shapes. One `@crew/shared` package is the DRY boundary.
- The status workflow is actor-aware: `canTransition(actor, from, to)`. The owner and agents are allowed different edges. The table is replayed in tests against every role contract in Phase 7.

## Requirements

- pnpm workspaces with Node 22 LTS or newer, TypeScript strict mode, ESM only. Workspace layout: `apps/api`, `apps/web`, `apps/daemon`, `packages/shared`, `packages/docs-kit`.
- Shared lint and format config (Biome) plus a Vitest workspace.
- `@crew/shared` exports:
  - `TicketStatus`: `todo | triage | needs_input | in_progress | in_review | done | blocked | cancelled`.
  - `TicketType`: `request | pm_task | dev | qc | bug | docs_init`.
  - `AgentRole`: `assistant | pm | dev | qc`.
  - `Complexity`: `trivial | small | medium | large`.
  - `ModelAlias`: `haiku | sonnet | opus | fable`.
  - `Effort`: `low | medium | high | xhigh | max`.
  - The `EventEnvelope` schema `{id, type, ticketId, projectId, targetMachineId, targetRole, payload, createdAt}`.
  - The event payload union:
    - `ticket.assigned`
    - `ticket.comment_added` (owner comments only)
    - `ticket.status_changed` (owner stream only)
    - `dependency.resolved`
    - `machine.claimed`, `claim.requested`, `claim.changed`
    - `children.all_done`
    - `ticket.reopened`
    - `ticket.unblocked`
    - `ticket.cancelled`
    - `machine.offline`
    - `budget.exceeded`
    - `docs.synced`
  - Request and response schemas for every endpoint, including the `Idempotency-Key` header contract.
  - `canTransition(actor: 'owner'|'agent'|'system', from, to)`.

## Status Workflow (single source of truth)

| From | Agent may go to | Owner may go to |
|------|-----------------|-----------------|
| todo | triage, in_progress, needs_input | cancelled |
| triage | in_progress, needs_input | cancelled |
| needs_input | in_progress (the server applies this when the owner comments) | in_progress, cancelled |
| in_progress | needs_input, in_review, done, blocked | cancelled |
| in_review | done, in_progress | done, in_progress, cancelled |
| blocked | in_progress (daemon retry) | in_progress, cancelled |
| done | — | in_progress (reopen) |
| cancelled | — | — |

The `system` actor is the server's sweeper and cascade logic. It may do agent edges plus `* → cancelled` during a cascade.
Every transition into `done` requires a report, enforced on the server (Phase 2).

## Related Code Files

Create (repo root `/Users/admin/Documents/Projects/AI-company`):
- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `vitest.workspace.ts`, `.gitignore`, `.nvmrc`, `.env.example`
- `packages/shared/package.json`, `packages/shared/src/index.ts`
- `packages/shared/src/ticket-schemas.ts`, `event-schemas.ts`, `status-workflow.ts`, `agent-schemas.ts`, `docs-schemas.ts`
- `packages/shared/src/status-workflow.test.ts`
- Empty package skeletons: `apps/api`, `apps/web`, `apps/daemon`, `packages/docs-kit`

## Implementation Steps

1. `git init`, add the root configs, and pin the package manager.
2. Create the workspace packages, each with a `tsconfig.json` extending the base config and `build`/`test`/`typecheck` scripts.
3. Write the schemas in `@crew/shared`. Every exported type is `z.infer` of a schema.
4. Encode the status table above in `status-workflow.ts`.
5. Add root scripts: `pnpm -r build`, `pnpm -r test`, `pnpm -r typecheck`, `pnpm lint`.

## Todo

- [ ] Workspace, root configs, git init
- [ ] `@crew/shared` schemas and actor-aware status workflow
- [ ] Table-driven tests: every edge per actor is allowed, and one forbidden edge per state is rejected
- [ ] Root scripts green

## Success Criteria

- `pnpm install && pnpm -r typecheck && pnpm -r test` passes from a clean clone.
- `canTransition('owner','in_progress','cancelled')` is true. `canTransition('agent','todo','done')` is false.

## Risk Assessment

- Schema churn later. Changes are additive, and breaking changes land with every consumer in the same PR.

## Security Considerations

- `.env.example` holds only variable names. `.gitignore` covers `.env*`, `*.pem` and token files.
