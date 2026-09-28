#!/usr/bin/env bash
# Postgres dumps of the 2P Crew database, run inside the crew-backup image (PG* variables point at
# crew-postgres). Dumps are custom-format (`pg_dump -Fc`) files in /backups named crew-<time>-<label>.dump.
#
#   crew-backup loop              nightly dump at BACKUP_HOUR (local TZ), then prune (the service command)
#   crew-backup once <label>      one dump now; prints its path (deploy.sh uses label pre-migrate)
#   crew-backup prune             delete dumps older than BACKUP_KEEP_DAYS days
#   crew-backup list              dumps, newest first
#   crew-backup latest            path of the newest dump
#   crew-backup restore <file> <db>   recreate <db> and restore the dump into it
#   crew-backup counts <db>       "schema.table rows" for every table of <db>
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_HOUR="${BACKUP_HOUR:-2}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

log() { printf '%s crew-backup: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2; }
die() {
  log "error: $*"
  exit 1
}

valid_db() { [[ "$1" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || die "invalid database name: $1"; }

dump_once() {
  local label="${1:-manual}"
  [[ "$label" =~ ^[a-z0-9-]{1,40}$ ]] || die "invalid label: $label"
  local file
  file="$BACKUP_DIR/crew-$(date +%Y%m%d-%H%M%S)-$label.dump"
  # Explicit checks: callers use `dump_once || …`, which switches off `set -e` inside the function.
  if ! pg_dump -Fc -f "$file.partial"; then
    rm -f "$file.partial"
    log "error: pg_dump failed"
    return 1
  fi
  mv "$file.partial" "$file" || return 1
  log "dump written: $file ($(du -h "$file" | cut -f1))"
  printf '%s\n' "$file"
}

prune() {
  [[ "$BACKUP_KEEP_DAYS" =~ ^[0-9]+$ ]] && ((BACKUP_KEEP_DAYS >= 1)) || die "BACKUP_KEEP_DAYS must be >= 1"
  # -mmin keeps exactly BACKUP_KEEP_DAYS x 24 h of dumps; stale .partial files from a crash go too.
  find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'crew-*.dump' -o -name 'crew-*.dump.partial' \) \
    -mmin "+$((BACKUP_KEEP_DAYS * 24 * 60))" -print -delete | while read -r gone; do log "pruned $gone"; done
}

seconds_until_next_run() {
  [[ "$BACKUP_HOUR" =~ ^([01]?[0-9]|2[0-3])$ ]] || die "BACKUP_HOUR must be 0-23"
  local now target
  now=$(date +%s)
  target=$(date -d "today $BACKUP_HOUR:00" +%s)
  ((target > now)) || target=$(date -d "tomorrow $BACKUP_HOUR:00" +%s)
  echo $((target - now))
}

loop() {
  trap 'log "stopping"; exit 0' TERM INT
  log "nightly dumps at $BACKUP_HOUR:00 ($TZ), keeping $BACKUP_KEEP_DAYS days in $BACKUP_DIR"
  while true; do
    local wait_s
    wait_s=$(seconds_until_next_run)
    log "next dump in ${wait_s}s"
    sleep "$wait_s" &
    wait $!
    # A failed night is logged and retried the next night; the loop never exits on it.
    dump_once nightly >/dev/null || log "error: nightly dump failed"
    prune || log "error: prune failed"
  done
}

counts() {
  local db="$1"
  valid_db "$db"
  psql -X -At -F ' ' -d "$db" -v ON_ERROR_STOP=1 <<'SQL'
select table_schema || '.' || table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables
where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
order by 1;
SQL
}

restore() {
  local file="$1" db="$2"
  valid_db "$db"
  [[ -f "$file" ]] || die "dump not found: $file"
  pg_restore --list "$file" >/dev/null || die "not a readable pg_dump custom-format file: $file"
  log "recreating database $db"
  psql -X -d postgres -v ON_ERROR_STOP=1 -q >/dev/null \
    -c "set client_min_messages = warning" \
    -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$db' and pid <> pg_backend_pid()" \
    -c "drop database if exists \"$db\"" \
    -c "create database \"$db\" owner \"$PGUSER\""
  log "restoring $file into $db"
  pg_restore --exit-on-error --no-owner --role="$PGUSER" -d "$db" "$file"
  log "restore finished"
}

cmd="${1:-loop}"
shift || true
case "$cmd" in
  loop) loop ;;
  once) dump_once "${1:-manual}" ;;
  prune) prune ;;
  latest)
    newest=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'crew-*.dump' -printf '%T@ %p\n' | sort -rn | head -n 1 | cut -d' ' -f2-)
    [[ -n "$newest" ]] || die "no dump in $BACKUP_DIR"
    printf '%s\n' "$newest"
    ;;
  list) find "$BACKUP_DIR" -maxdepth 1 -type f -name 'crew-*.dump' -printf '%TY-%Tm-%Td %TH:%TM  %10s  %f\n' | sort -r ;;
  restore) [[ $# -eq 2 ]] || die "usage: crew-backup restore <file> <db>"; restore "$1" "$2" ;;
  counts) [[ $# -eq 1 ]] || die "usage: crew-backup counts <db>"; counts "$1" ;;
  *) die "unknown command: $cmd" ;;
esac
