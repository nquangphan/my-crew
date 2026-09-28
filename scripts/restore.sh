#!/usr/bin/env bash
# Restores a pg_dump custom-format dump of the 2P Crew database, from the deploy root (/opt/crew):
#
#   scripts/restore.sh <dump> [--target <db>] [--yes] [--expect-match]
#
#   <dump>          "latest", a file name in the crew-backups volume (see: scripts/restore.sh --list),
#                   or a path to a .dump file on the host
#   --target <db>   database to (re)create; default crew_restore_check, a scratch copy next to the live
#                   database. "crew" replaces the live database: crew-api is stopped during the restore and
#                   --yes is required.
#   --expect-match  after a scratch restore, exit 3 unless every table has the same row count as the live
#                   database (for a restore drill right after a fresh dump)
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

dump="" target="crew_restore_check" yes=0 expect_match=0
while (($#)); do
  case "$1" in
    --target) target="${2:-}"; shift 2 ;;
    --yes) yes=1; shift ;;
    --expect-match) expect_match=1; shift ;;
    --list) dump="--list"; shift ;;
    -h | --help) usage ;;
    -*) die "unknown option $1" ;;
    *) [[ -z "$dump" ]] || usage; dump="$1"; shift ;;
  esac
done
[[ -n "$dump" ]] || usage
[[ "$target" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "invalid --target '$target'"

require_docker_compose
check_env_file

backup() { compose run --rm --no-deps -T "$@"; }

if [[ "$dump" == "--list" ]]; then
  backup crew-backup list
  exit 0
fi

mount_args=()
if [[ "$dump" == "latest" ]]; then
  dump_path=$(backup crew-backup latest | tail -n 1)
elif [[ -f "$dump" ]]; then
  host_dir=$(cd "$(dirname "$dump")" && pwd)
  dump_path="/restore/$(basename "$dump")"
  # Root inside the one-off container, so a 0600 root-owned dump on the host stays readable.
  mount_args=(--user root -v "$host_dir:/restore:ro")
elif [[ "$dump" =~ ^crew-[A-Za-z0-9-]+\.dump$ ]]; then
  dump_path="/backups/$dump"
else
  die "dump '$dump' is not 'latest', a crew-*.dump name in the backup volume, or a file on this host"
fi
log "dump: $dump_path -> database $target"

if [[ "$target" == "crew" ]]; then
  ((yes)) || die "restoring into the live database needs --yes (crew-api is stopped meanwhile)"
  log "stopping crew-api and crew-backup"
  compose stop crew-api crew-backup
  backup ${mount_args[@]+"${mount_args[@]}"} crew-backup restore "$dump_path" crew
  log "starting crew-api and crew-backup"
  compose up -d --wait crew-api crew-backup
  health=$(net_get "http://crew-api:8787/v1/health") || die "crew-api is not healthy after the restore"
  log "restored into the live database; health: $health"
  log "if the dump predates the current code's migrations, run scripts/deploy.sh (it migrates) or roll the images back"
  exit 0
fi

backup ${mount_args[@]+"${mount_args[@]}"} crew-backup restore "$dump_path" "$target"
live=$(backup crew-backup counts crew)
restored=$(backup crew-backup counts "$target")
printf '%-45s %12s %12s\n' "table" "live" "restored"
mismatch=0
while read -r table count; do
  other=$(awk -v t="$table" '$1 == t { print $2 }' <<<"$restored")
  mark=""
  if [[ "$other" != "$count" ]]; then
    mark="  <- differs"
    mismatch=1
  fi
  printf '%-45s %12s %12s%s\n' "$table" "$count" "${other:-missing}" "$mark"
done <<<"$live"
if ((mismatch)); then
  log "row counts differ (expected when the live database changed after the dump was taken)"
  ((expect_match)) && exit 3
else
  log "row counts match for every table"
fi
log "scratch database $target kept for inspection; drop it with:"
log "  docker compose -p $CREW_PROJECT -f deploy/compose.yml --env-file .env exec crew-postgres dropdb -U crew $target"
