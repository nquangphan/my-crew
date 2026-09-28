#!/usr/bin/env bash
# Builds and (re)deploys the 2P Crew stack on the VPS, from the deploy root (/opt/crew):
#
#   scripts/deploy.sh
#
# Steps: check docker compose and .env, build the images, back up the database (skipped on the first
# deploy, when there is no schema yet), apply migrations, start everything, then check /v1/health from
# inside crew-net. On failure it prints how to roll back. It publishes no host port and only touches the
# compose project "crew".
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

IMAGES=(crew-api crew-web crew-backup)
PRE_MIGRATE_DUMP=""
STAGE="checks"

rollback_help() {
  local status=$?
  ((status == 0)) && return
  cat >&2 <<EOF

[crew] DEPLOY FAILED during: $STAGE (exit $status)
[crew] Nothing outside the compose project "$CREW_PROJECT" was changed. To investigate and roll back:
  1. Logs:            docker compose -p $CREW_PROJECT -f deploy/compose.yml --env-file .env logs --tail 200 crew-api
  2. Previous images: for i in ${IMAGES[*]}; do docker image inspect \$i:previous >/dev/null 2>&1 && docker tag \$i:previous \$i:latest; done
                      docker compose -p $CREW_PROJECT -f deploy/compose.yml --env-file .env up -d --no-build --wait
EOF
  if [[ -n "$PRE_MIGRATE_DUMP" ]]; then
    cat >&2 <<EOF
  3. Database:        if migrations already ran, restore the pre-migrate dump taken by this deploy:
                      scripts/restore.sh $(basename "$PRE_MIGRATE_DUMP") --target crew --yes
EOF
  else
    echo "  3. Database:        no pre-migrate dump was taken (first deploy, or the failure came before it)." >&2
  fi
}
require_docker_compose
check_env_file
trap rollback_help EXIT

# Guard: the stack must never publish host ports (the shared nginx owns 80/443).
if docker compose -p "$CREW_PROJECT" -f "$CREW_COMPOSE_FILE" --env-file "$CREW_ENV_FILE" config --format json |
  grep -q '"published"'; then
  die "deploy/compose.yml publishes a host port; refusing to deploy"
fi

STAGE="build"
for image in "${IMAGES[@]}"; do
  if docker image inspect "$image:latest" >/dev/null 2>&1; then docker tag "$image:latest" "$image:previous"; fi
done
log "building images"
compose build

STAGE="database start"
log "starting crew-postgres"
compose up -d --wait crew-postgres

STAGE="pre-migrate backup"
has_schema=$(compose exec -T crew-postgres psql -U crew -d crew -XAtc \
  "select to_regclass('drizzle.__drizzle_migrations') is not null")
if [[ "$has_schema" == "t" ]]; then
  log "backing up the database before migrating"
  PRE_MIGRATE_DUMP=$(compose run --rm --no-deps -T crew-backup once pre-migrate | tail -n 1)
  [[ "$PRE_MIGRATE_DUMP" == /backups/crew-*.dump ]] || die "pre-migrate backup did not report a dump file"
  log "pre-migrate dump: $PRE_MIGRATE_DUMP"
else
  log "first deploy: the database is empty, no pre-migrate backup"
fi

STAGE="migrations"
log "applying migrations"
compose run --rm --no-deps -T crew-api node dist/db/migrate.js

STAGE="start"
log "starting the stack"
compose up -d --wait

STAGE="health check"
health=""
for _ in $(seq 1 20); do
  if health=$(net_get "http://crew-api:8787/v1/health" 2>/dev/null) && [[ "$health" == *'"status":"ok"'* ]]; then break; fi
  health=""
  sleep 3
done
[[ -n "$health" ]] || die "GET http://crew-api:8787/v1/health from $CREW_NET did not return status ok"
net_get "http://crew-web:8080/healthz" >/dev/null || die "crew-web did not answer on $CREW_NET"
log "health: $health"

STAGE="done"
compose ps --format 'table {{.Service}}\t{{.Status}}'
log "deployed. Next: scripts/attach-nginx.sh http (first time), scripts/seed-owner.sh <username> (once)."
