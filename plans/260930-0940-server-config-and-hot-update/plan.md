---
title: "Server-managed settings and signed hot updates"
description: "Move rules, prompts and machine/project settings to the server (editable on the web), and update the daemon, host and UI code without reinstalling the app."
status: in-progress
priority: P1
effort: 24h
tags: [feature, backend, frontend, daemon, desktop, security]
blockedBy: []
blocks: []
created: 2026-09-30
---

# Server-managed settings and signed hot updates

## Why

Between 2026-09-29 and 2026-09-30 the owner had to reinstall the desktop app eight times (0.1.0 → 0.1.7). Each reinstall
also re-triggers the macOS Documents permission prompt, because the app is ad-hoc signed. About half of those releases only
changed rules or prompts (README counts as docs, QC UI-test rule, protected paths, prompt wording); the other half fixed
code bugs (fix-id schema, missing prompts in the bundle, socket path length, host start-up hang).

## Outcome

1. **Rules, prompts and settings live on the server** and are edited on the web. The daemon picks up a change without
   an app update.
2. **Code fixes to the daemon, the daemon host and the UI arrive as signed hot updates**: no dmg reinstall and no new
   Documents prompt (the app binary does not change).

## Owner decisions (2026-09-30)

- Do step 1 and step 2 now. Apple Developer ID signing stays a later step.

## Phases

| # | Phase | Status | Depends on |
|---|-------|--------|------------|
| 1 | [Server-managed settings](./phase-01-server-managed-settings.md) | In progress | — |
| 2 | [Signed hot updates](./phase-02-signed-hot-updates.md) | Pending | 1 |

## Acceptance criteria

- Changing a role prompt, a guard path list, the QC UI-test rule, the complexity→model map, a machine's slots, or a
  project's disabled MCP servers on the web takes effect for the next job on the machines without reinstalling the app.
  Every change is versioned with author and time, and one click restores an earlier version.
- A new daemon/host/UI build published by CI reaches a running app, is verified against a pinned signature key, and is
  applied without reinstalling the app and without a new macOS permission prompt. Running jobs resume. A build that
  fails to start rolls back automatically to the previous one. An unsigned or tampered bundle is refused.
- The owner can see each machine's running runtime version and pin or roll back a machine from the web.
