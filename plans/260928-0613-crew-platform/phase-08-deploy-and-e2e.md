---
title: "Phase 8: Deploy and E2E"
status: completed
priority: P1
effort: 6h
dependsOn: [4, 7, 9]
---

# Phase 8: Deploy and E2E

<!-- Updated: Desktop App 2026-09-28 - see phase 9 -->
<!-- Updated: Red Team 2026-09-28 - rclone dropped, single CI workflow incl. crew-docs, scripted lifecycle in CI, stuck-ticket alarm -->

## Overview

Ship the VPS stack with Docker Compose behind Caddy (automatic HTTPS), add nightly Postgres backups and a
migration script that backs up first, add CI, and prove the system end to end with Playwright against a
compose stack plus a real daemon.

## Requirements

- **Target (owner-confirmed):** a Linux VPS with Docker and the Compose plugin already installed. `scripts/deploy.sh` checks `docker compose version` and ports 80/443 before deploying.

- **Compose services:**
  - `caddy` serves the web `dist` at **`crew.2p-solutions.com`** (automatic HTTPS; DNS A record → VPS), proxies `/v1/*` to `api:3000`, and handles SSE: `flush_interval -1`, no buffering.
  - `api`
  - `postgres:17`: an internal network only, no host port.
  - `backup`: nightly `pg_dump -Fc` to a mounted volume, with 14-day rotation.
- **Deploy script** `scripts/deploy.sh`: pull, build, `pg_dump` (pre-migrate backup), `drizzle-kit migrate`, `up -d`, health check `/v1/health`, and rollback instructions printed on failure.
- **Restore runbook** `scripts/restore.sh <dump>`, tested once against the staging volume.
- **CI (GitHub Actions), a single `ci.yml`:** install, typecheck, lint, test (with a Postgres service), the scripted lifecycle matrix from Phase 7, web build, `crew-docs check --range` and `check --all`, a daemon bundle build, and the desktop app build. A release job on `v*` tags publishes the universal dmg to GitHub Releases (Phase 9).
- **Stuck-ticket alarm:** an API job runs every 5 min. Any non-terminal ticket with no activity for over 30 min, and no `needs_input`, `retry_at` or active job reported in heartbeats, becomes an inbox alert.
- **E2E (Playwright)** runs against `docker compose -f compose.test.yml` plus a daemon started with a test config:
  - login
  - create a ticket
  - assign it to the assistant
  - observe the live status change
  - answer a `needs_input` comment
  - the Done-without-report error
  - the docs viewer
  - The whole suite runs at the phone, tablet and desktop viewports (Phase 4).
  - The full agent chain runs in the live scenario of Phase 7 (`CREW_LIVE_AGENT_TESTS=1`), not in default CI, because of cost.
- **Operational docs:** the platform `docs/` gets a deployment flow and a daemon-setup flow, per the standard.

## Related Code Files

Create:
- `deploy/compose.yml`, `deploy/compose.test.yml`, `deploy/Caddyfile`, `deploy/api.Dockerfile`, `deploy/backup/backup.sh`
- `scripts/deploy.sh`, `scripts/restore.sh`
- `.github/workflows/ci.yml`
- `e2e/playwright.config.ts`, `e2e/tests/ticket-lifecycle.spec.ts`, `e2e/tests/docs-viewer.spec.ts`, `e2e/fixtures/daemon-test-config.yaml`
- `docs/flows/deployment.md`, `docs/flows/daemon-setup.md` (and update `docs/flows.yaml`)

## Implementation Steps

1. Dockerfile for the API (multi-stage, non-root) and the static web build copied into the Caddy image or volume.
2. Compose files, Caddyfile and the backup container, verified with a local `compose up`.
3. Deploy and restore scripts, then a backup and restore drill.
4. CI workflow.
5. Playwright suite against the test stack.
6. Deployment and daemon setup docs, which follow the docs standard and pass `crew-docs check`.

## Todo

- [x] Dockerfiles, compose, Caddy (SSE-safe)
- [x] Backup container and deploy/restore scripts with a restore drill
- [x] CI workflow green (including the scripted lifecycle matrix)
- [x] Stuck-ticket alarm
- [x] Playwright E2E green
- [x] Deployment and daemon setup flow docs

## Success Criteria

- On a fresh VPS, `scripts/deploy.sh` brings up HTTPS at the domain, and `/v1/health` returns 200.
- An SSE event reaches the browser through Caddy in under 2 s, with no buffering.
- A restore from last night's dump into a scratch DB succeeds, and the row counts match.
- CI is green, including `crew-docs check --range`.

## Risk Assessment

- **A migration fails in prod.** Recover with the pre-migrate dump and restore script, and check migrations in CI against a copy of the schema.
- **Losing the only VPS.** Backups sit on a volume on the same VPS, per the owner's decision. Copy a dump off the VPS manually if needed.

## Security Considerations

- Postgres is never exposed. Secrets come from a `.env` on the VPS (0600) that is never committed. Caddy sets HSTS.
- The owner password is seeded through the CLI over SSH, never from a default value.
