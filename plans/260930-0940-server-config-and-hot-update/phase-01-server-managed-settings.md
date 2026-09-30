---
title: "Phase 1: Server-managed settings"
status: in-progress
priority: P1
effort: 12h
dependsOn: []
---

# Phase 1: Server-managed settings

## What moves to the server

| Setting | Today | Server model |
|---|---|---|
| Role prompts and partials (`apps/daemon/src/roles/prompts/*.md`) | Bundled in the app | Versioned text per prompt name; the bundled copy is the default and fallback |
| Guard path rules: docs paths (`docs/**`, root `*.md`), protected paths (`CLAUDE.md`, `AGENTS.md`, `.claude/**`, `.githooks/**`), docs_update write scope | Code constants | Versioned policy document; the guard reads lists from it (the enforcement code stays) |
| QC UI-test rule (UI test required only for non-docs changes) | Code | Policy flag + the same docs-path list |
| Complexity → model/effort map, model allowlist | Local `config.yaml` per machine | Global default on the server; optional per-machine override |
| Machine resources (`maxConcurrentJobs`, `minFreeMemGb`, `maxLoadPerCpu`) | Local `config.yaml` | Per machine on the server |
| Per-project disabled MCP servers | Local `config.yaml` | Per project on the server (applies to whichever machine owns it) |
| Budgets | Local `config.yaml` + server | Server |

Stays local: API URL, machine token, project folder paths, shared (untracked) paths, anything machine-private.
The docs model rule (docs work always on sonnet) and "no Fable" stay enforced in code as owner invariants; settings
cannot override them.

## Requirements

- API: `settings_revisions` (id, kind, scope — global / machine / project, content jsonb or text, author, created_at),
  with one active revision per (kind, scope). Owner routes to read, validate, save (creates a revision), list history,
  diff two revisions, and restore one. Daemon route to fetch the effective settings for this machine (merged:
  bundled default ← global ← machine/project override), with an ETag. Server-side validation with the shared zod schemas
  (prompt variables used must be known; paths are safe globs; model names are selectable models; numbers in range).
- Event `settings.changed` on the owner stream and to affected machines.
- Daemon: fetch effective settings at start and on `settings.changed` (and hourly as a safety net); cache the last good
  copy on disk; if the server is unreachable use the cache, else the bundled defaults. Apply to the next job start;
  running jobs keep what they started with. Record the settings revision id on each job (visible in activity/comments).
- One-time migration: on first start of the new daemon, upload the machine's current local values (e.g. the owner's
  `maxConcurrentJobs: 5`, each project's `disabledMcpServers`) as that machine's/project's override if the server has none,
  then stop reading them from `config.yaml` (keep the file for local-only fields).
- Web: "Cài đặt hệ thống" area: Prompts (list, Markdown editor with preview, variables help, diff vs previous and vs
  default, save with a change note), Quy tắc (guard/QC lists), Models, per-machine Resources (also reachable from the
  Machines page), per-project MCP disables (also reachable from project settings). History with restore. Saving shows
  which machines have picked the revision up (from heartbeats).
- Desktop app: its Settings screens for resources and MCP disables edit the server settings (through the daemon) instead
  of the local file.
- Docs and tests (API, daemon merge/fallback/cache, guard reading policy, web editors, E2E: edit a prompt on the web →
  next job uses it).

## Risks

- A bad prompt or policy edit breaks every machine: validation, preview, history + restore, and the bundled defaults as
  a fallback when a revision fails validation on the daemon.
