# Phase 8 implementation report: Deploy and E2E

Date: 2026-09-29 · Status: done with concerns (see the end) · Branch: `worktree-agent-acedf5eeaabb6e2cc`
(fast-forwarded to `main` at `c716067` before work started; one commit on top, not pushed).

The VPS has no Caddy: the shared edge nginx `2ps-landing-nginx` owns ports 80/443, so every Caddy item of
the phase file is replaced by a site attached to that nginx. The VPS itself was not touched; the controller
deploys with the runbook below.

## Artifacts

| Path | What it is |
|------|------------|
| `deploy/compose.yml` | Compose project `crew`: `crew-api`, `crew-web`, `crew-postgres` (postgres:17), `crew-backup`. No `ports:` anywhere. Networks `crew-net` (→ `crew_crew-net`, joined by the shared nginx; api and web) and `crew-db` (`internal: true`; api, postgres, backup). Healthchecks everywhere, `restart: unless-stopped`, log rotation 10 MB × 5, `no-new-privileges`, api/web `read_only` and `cap_drop: [ALL]`. |
| `deploy/Dockerfile` | One multi-target file (`api`, `web`, `backup`) built from the repo root. `api`: node:22-bookworm-slim, production deps only, user `node`. `web`: `nginxinc/nginx-unprivileged` serving the built SPA on 8080. `backup`: postgres:17 plus the backup script, user `postgres`. `pnpm install --ignore-scripts`: better-sqlite3 (a drizzle-orm peer resolved for the daemon) would otherwise need a compiler, and neither image loads it. |
| `deploy/web/nginx.conf` | crew-web: SPA fallback, immutable `/assets/`, `/healthz`. |
| `deploy/backup/backup.sh` | `crew-backup loop` (nightly `pg_dump -Fc` at `BACKUP_HOUR`=2, Asia/Ho_Chi_Minh, then prune after `BACKUP_KEEP_DAYS`=14), plus `once <label>`, `prune`, `list`, `latest`, `restore <file> <db>`, `counts <db>`. |
| `deploy/nginx/crew-http.conf`, `crew-https.conf`, `crew-locations.inc` | Site templates for the shared nginx, rendered by `scripts/lib/render-nginx.sh`: `__CREW_DOMAIN__` and one shared locations block. Runtime resolver `127.0.0.11` + variables (nginx starts and reloads while crew is down). ACME webroot `/var/www/certbot`. `/v1/` is SSE-safe (`proxy_buffering off`, `proxy_cache off`, `proxy_request_buffering off`, 3600 s read/send timeouts, HTTP/1.1, `Connection ''`, gzip off, `client_max_body_size 4m`, X-Forwarded-*). HTTPS: `http2 on`, `/etc/letsencrypt/live/$CREW_DOMAIN/`, TLS 1.2/1.3, HSTS, 80 → 443 redirect except ACME. |
| `deploy/tools/nginx-override.mjs` | Adds the conf mount and the external network to `/opt/2ps-landing/docker-compose.override.yml` with comment-preserving YAML edits; runs inside the crew-api image (reuses its `yaml`). |
| `deploy/compose.test.yml` | Test layer for E2E: `crew-edge` (nginx:alpine rendering `crew-http.conf` exactly like attach does, on `127.0.0.1:18180`), `COOKIE_SECURE=false`, backup off. |
| `deploy/.env.example` | Names only for secrets (`POSTGRES_PASSWORD`, `SESSION_SECRET` empty), `CREW_DOMAIN`/`PUBLIC_ORIGIN` default `crew.2p-solutions.com`. |
| `scripts/lib/common.sh` | Shared helpers: `compose()` pinned to project `crew`, `.env` checks without sourcing it, `net_get` (HTTP from a throwaway container on crew-net). |
| `scripts/deploy.sh` | See the runbook; pre-migrate dump only when a schema exists; rollback instructions on any failure. |
| `scripts/attach-nginx.sh [http\|https]` | Override backup + edit + `docker compose config -q`, then `docker network connect`, conf copy (or in-place update of the bind-mounted file after a recreate), `nginx -t`, `nginx -s reload`; on `nginx -t` failure the previous conf and the override backup are restored. Idempotent. |
| `scripts/enable-https.sh` | A record check, webroot probe through `http://$CREW_DOMAIN/.well-known/acme-challenge/`, `certbot certonly --webroot --cert-name $CREW_DOMAIN --keep-until-expiring` in `2ps-landing-certbot`, then `attach-nginx.sh https` and an HTTPS health check. |
| `scripts/restore.sh <dump>` | `latest`, a volume file name or a host file; scratch DB `crew_restore_check` with a live-vs-restored row count table (`--expect-match` for drills), or `--target crew --yes` for the live DB (api and backup stopped meanwhile). |
| `scripts/seed-owner.sh <username> [--reset]` | Refuses without a TTY; hidden prompt inside crew-api; never a default password. |
| `.github/workflows/ci.yml` | Jobs `check` (Postgres 17 service on 55432; install, typecheck, lint, crew-docs bundle, `check --range`, `check --all`, `pnpm -r test` incl. the scripted lifecycle matrix, web build, daemon build, desktop build, shellcheck), `e2e`, and `release` on `v*` tags (macOS). `actionlint` clean. |
| Stuck-ticket alarm | `apps/api/src/jobs/stuck-ticket-alarm.ts` (+ wiring, see "Files changed in apps"). |
| `e2e/` (workspace package `@crew/e2e`) | Playwright against the real stack deployed by `scripts/deploy.sh` with `deploy/compose.test.yml`, plus a real daemon (`fixtures/run-daemon.ts`, config `fixtures/daemon-test-config.yaml`, scripted runs, no model). |
| Docs | `docs/flows/deployment.md`, `docs/flows/daemon-setup.md` (new flows, `flows:` section only), R3 updates of 9 flow docs, `docs/architecture.md` deployment section. Written by a sonnet subagent (owner decision), then checked against source; I corrected 8 factual slips. |

## Controller runbook (VPS, in order)

Run as root (or a docker-group user) on the VPS unless stated.

1. Upload (dev machine, from the repo at the commit to deploy):
   `git archive --format=tar.gz -o crew.tar.gz HEAD && scp crew.tar.gz <vps>:/tmp/`
   VPS: `mkdir -p /opt/crew && tar -xzf /tmp/crew.tar.gz -C /opt/crew`
2. First time only, secrets:
   ```
   cd /opt/crew && cp deploy/.env.example .env && chmod 600 .env
   sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
   sed -i "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" .env
   ```
   Keep `CREW_DOMAIN=crew.2p-solutions.com` and `PUBLIC_ORIGIN=https://crew.2p-solutions.com` (owner-confirmed).
   Nothing else is required.
3. `cd /opt/crew && scripts/deploy.sh` (builds on the VPS; first build takes a few minutes).
4. First time only: `scripts/attach-nginx.sh http`, then check
   `curl -s -H 'Host: crew.2p-solutions.com' http://127.0.0.1/v1/health` → `{"status":"ok","db":"ok"}`.
   It backs up `/opt/2ps-landing/docker-compose.override.yml` to `…override.yml.bak-<time>` first.
5. Once: `ssh -t <vps> 'cd /opt/crew && scripts/seed-owner.sh <username>'`; store the printed TOTP secret
   and recovery codes. (Login itself needs HTTPS: cookies are Secure and the Origin must be https.)
6. After the A record `crew.2p-solutions.com` → VPS resolves: `scripts/enable-https.sh`
   (optionally `CERTBOT_EMAIL=… scripts/enable-https.sh` if the certbot container has no ACME account yet).
   Then log in at `https://crew.2p-solutions.com`.
7. Later deploys: steps 1 and 3 only (`.env` and `/opt/crew/edge/` are not in the archive, so they survive).

Rollback, if `deploy.sh` fails it prints the exact commands: retag `crew-{api,web,backup}:previous` →
`:latest` and `up -d --no-build`, and when migrations may have run, `scripts/restore.sh <pre-migrate dump>
--target crew --yes`.

## Local drill results (Docker Desktop, 2026-09-29)

Compose project `crew-deploytest` with a throwaway 0600 env file; a stand-in for `/opt/2ps-landing`
(`nginx:alpine` container `crew-drill-landing-nginx` with certbot volumes, an override file with a comment and
another site) on 127.0.0.1:18080/18443 (ports checked free first).

- `deploy.sh` first deploy: images built, "first deploy: the database is empty, no pre-migrate backup",
  migrations applied, all four services healthy, `/v1/health` from crew-net OK.
- `attach-nginx.sh http`: override edited (comment kept, mount and `crew-net` added), network connected,
  reload OK; `/v1/health` 200 and the SPA route `/projects/X/board` 200 through the nginx; the other site
  unaffected. Re-run: "already up to date; nothing to reload".
- SSE: owner logged in through the nginx, opened `/v1/stream`, created a ticket: the event reached the client
  **16 ms** after the POST (HTTP) and **39 ms** over HTTPS/HTTP2.
- Backup and restore: `crew-backup once drill`, then `restore.sh latest --expect-match`: row counts match on
  all 18 tables. Host-file restore (0600 dump) also matched. Live restore `--target crew --yes`: deleted
  rows came back, health OK. Prune: a 15-day-old dump deleted, a 13-day-old one kept.
- Redeploy: pre-migrate dump `crew-…-pre-migrate.dump` taken, migrations, health OK.
- `attach-nginx.sh https` with an unusable certificate: `nginx -t` failed; the live conf and the override
  were restored byte-for-byte (md5 unchanged) and the site kept serving. With a self-signed certificate:
  HTTP/2 200, HSTS header, 80 → 301 to https, ACME path served from the webroot.
- Force-recreating the stand-in nginx kept serving crew over HTTPS from the override mount; a following
  `attach-nginx.sh http` updated the bind-mounted file in place.
- Teardown: both stacks `down -v`; no containers, volumes or networks left (checked). Images `crew-api`,
  `crew-web`, `crew-backup` remain in the local image cache.
- `shellcheck -S warning` clean on all scripts.

`enable-https.sh` could not be exercised locally (it needs public DNS and the real certbot container); its
parts (probe, certbot flags, attach https) are small, and attach https was verified above.

## Tests

- `pnpm -r typecheck`, `pnpm lint`, `pnpm -r build`: pass.
- `pnpm -r test` with `TEST_DATABASE_URL=…/crew_p8_test`, `DAEMON_TEST_DATABASE_URL=…/crew_p8_daemon_test`,
  `DESKTOP_TEST_DATABASE_URL=…/crew_p8_desktop_test` (created on `crew-dev-postgres`): shared 16, web 58,
  docs-kit 36, api 148, daemon 147 + 4 skipped (incl. the 15-scenario lifecycle matrix), desktop 19.
- New: `apps/api/test/stuck-ticket-alarm.test.ts` (9), a heartbeat test in `apps/daemon/test/daemon-extras.test.ts`,
  a `ticket.stuck` case in `apps/web/src/lib/live-events.test.ts`.
- E2E `pnpm --filter @crew/e2e test:e2e`: **6 passed** (2 specs × phone/tablet/desktop), 36 s after the
  image cache is warm. `ticket-lifecycle.spec.ts`: login with TOTP, create a request (assigned to the
  assistant), the daemon's question and the Chờ bạn status appear live, the owner answers, the daemon resumes
  and routes it (pm_task child and comment appear live), Done without a report is refused. `docs-viewer.spec.ts`:
  space home, page tree, flow page breadcrumbs, table of contents. The daemon talks to the API through the
  edge nginx (SSE included). Teardown leaves nothing behind (checked).
- `crew-docs check --all`: ok.

## Stuck-ticket alarm

Every 5 min the API reports each non-terminal ticket quiet for over 30 min (last field change or any event
except the alert itself) that is not waiting for the owner (`needs_input`, `blocked`, a request in
`in_review`), has no open child and no open dependency, and that no online machine runs (`runningJobs`) or
holds queued/in backoff. It sends one `ticket.stuck` notice per quiet spell (owner stream, `/v1/notices`,
inbox with a ticket link, ticket timeline). `retry_at` is not a server field, so the daemon heartbeat now
sends `waitingJobs` (queued and backoff jobs, with `retryAt`); the API keeps them in memory per machine for
2 min (`WaitingJobsRegistry`), because a new column would need a migration while the other agent may be
adding one (migration numbering conflict).

## Files changed in apps/* and packages/* (for the merge with the concurrent owner follow-ups)

- `apps/api/src/app.ts`, `apps/api/src/routes/route-deps.ts`, `apps/api/src/routes/daemon-routes.ts`
  (heartbeat route records `waitingJobs`), new `apps/api/src/jobs/stuck-ticket-alarm.ts`, new
  `apps/api/test/stuck-ticket-alarm.test.ts`.
- `apps/daemon/src/daemon.ts` (heartbeat `waitingJobs`), `apps/daemon/test/daemon-extras.test.ts`.
- `apps/web/src/routes/inbox.tsx` (`ticket.stuck` notice and link), `apps/web/src/lib/format.ts`
  (timeline line), `apps/web/src/lib/live-events.ts` + test (refresh notices).
- `packages/shared/src/machine-schemas.ts` (`WaitingJob`, `HeartbeatRequest.waitingJobs`),
  `packages/shared/src/event-schemas.ts` (`ticket.stuck`, `NOTICE_EVENT_TYPES`).
- `apps/desktop`: none.
- Also `pnpm-workspace.yaml` (+ `e2e`), `pnpm-lock.yaml`, `.gitignore`, `docs/**`.

Likely overlap with the other agent: `inbox.tsx` (server-side read state), `daemon.ts`, `app.ts`,
`daemon-routes.ts` and `docs/flows.yaml` / flow docs; all my edits there are small and additive.

## Deviations

1. Caddy replaced by the shared-nginx attach (plan Validation Session 15 per the task brief; that session
   is not in this branch's `plan.md`, so I did not edit the plan).
2. One `deploy/Dockerfile` with three targets instead of `deploy/api.Dockerfile`; the backup runs from its own
   small image rather than a mounted script (the named volume gets the right owner).
3. `TRUST_PROXY` defaults to `uniquelocal` (private ranges): the nginx IP on crew-net is not fixed and only the
   nginx and crew containers can reach the API. The edge overwrites `X-Forwarded-For` with `$remote_addr`.
4. `deploy/compose.test.yml` is a layer over `compose.yml` (used with `-f compose.yml -f compose.test.yml`),
   not a standalone file, so the E2E runs the same images and wiring; `scripts/deploy.sh` itself deploys it.
5. The E2E daemon runs the real daemon with scripted runs (no model); the full agent chain stays in the
   Phase 7 live scenario.
6. Release job: it runs `pnpm --filter @crew/desktop package:mac --publish` and uploads
   `apps/desktop/release/*.dmg` as artifacts. It does not name the dmgs, because the other agent is switching
   electron-builder to per-architecture dmgs (arm64, x64); whatever that config produces is published. It
   also checks that the tag equals `v<apps/desktop version>`.

## Concerns and open questions

1. **Certificate renewal reload.** The certbot container renews every 12 h, but nginx serves a renewed
   certificate only after a reload. Check whether the 2ps-landing setup already reloads nginx periodically;
   if not, add a host cron `docker exec 2ps-landing-nginx nginx -s reload` (not done: it is outside this repo).
2. **Assumptions about the shared nginx**, checked by the scripts but not verifiable from here: its override's
   nginx service already has a `networks:` key (the kidy example implies it; otherwise the editor stops and
   asks for a manual edit), the certbot webroot is mounted at `/var/www/certbot` in both containers, and
   `docker compose config -q` passes in `/opt/2ps-landing` with its own `.env`.
3. **CI not run on GitHub.** Workflows lint clean and every step passes locally, but the `check` job's desktop
   tests and build run on Linux for the first time, and the `release` job depends on the other agent's
   packaging change. A first push should be watched.
4. `crew-api:previous` rollback tags cover images only; data rollback relies on the pre-migrate dump.
5. The stuck alarm's waiting-job memory is per API process (fine for the single container; revisit if the API
   ever runs more than one replica).
