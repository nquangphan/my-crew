#!/usr/bin/env bash
# Publishes 2P Crew through the VPS's shared edge nginx (container 2ps-landing-nginx), without recreating
# or restarting it. From the deploy root (/opt/crew), after scripts/deploy.sh:
#
#   scripts/attach-nginx.sh [http|https]     (default http; https needs the certificate, see enable-https.sh)
#
# 1. Persists the site in /opt/2ps-landing/docker-compose.override.yml (timestamped backup first): a
#    read-only mount of /opt/crew/edge/crew.conf and the external network <project>_crew-net, so a
#    future recreate of the nginx keeps serving crew.
# 2. Applies it to the running container: docker network connect, the conf into
#    /etc/nginx/conf.d/crew.conf, nginx -t, nginx -s reload. If nginx -t fails, the previous conf and the
#    override backup are put back and nginx keeps running on its old config.
# Idempotent: running it again with the same mode changes nothing.
#
# Overridable: NGINX_CONTAINER (2ps-landing-nginx), LANDING_DIR (/opt/2ps-landing), CREW_DOMAIN (.env).
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

MODE="${1:-http}"
[[ "$MODE" == "http" || "$MODE" == "https" ]] || die "usage: scripts/attach-nginx.sh [http|https]"
NGINX_CONTAINER="${NGINX_CONTAINER:-2ps-landing-nginx}"
LANDING_DIR="${LANDING_DIR:-/opt/2ps-landing}"
OVERRIDE="$LANDING_DIR/docker-compose.override.yml"
CONF_HOST="$CREW_ROOT/edge/crew.conf"
CONF_LIVE="/etc/nginx/conf.d/crew.conf"
DOMAIN=$(crew_domain)

require_docker_compose
[[ "$(docker inspect -f '{{.State.Running}}' "$NGINX_CONTAINER" 2>/dev/null)" == "true" ]] ||
  die "container $NGINX_CONTAINER is not running"
docker network inspect "$CREW_NET" >/dev/null 2>&1 || die "network $CREW_NET does not exist; run scripts/deploy.sh first"
[[ -f "$OVERRIDE" ]] || die "$OVERRIDE not found"
if [[ "$MODE" == "https" ]]; then
  docker exec "$NGINX_CONTAINER" test -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ||
    die "no certificate for $DOMAIN in $NGINX_CONTAINER; run scripts/enable-https.sh"
fi
service=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$NGINX_CONTAINER")
[[ -n "$service" ]] || die "$NGINX_CONTAINER is not a compose container; cannot persist the site"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
"$CREW_ROOT/scripts/lib/render-nginx.sh" "$MODE" "$DOMAIN" "$CREW_ROOT/deploy/nginx" >"$work/crew.conf"
log "site: $DOMAIN ($MODE) -> $NGINX_CONTAINER:$CONF_LIVE"

# --- 1. Persist in the landing override -------------------------------------------------------------
edit_override() {
  docker run --rm --network none --user 0 -v "$LANDING_DIR:/work" --entrypoint node crew-api:latest \
    /app/deploy-tools/nginx-override.mjs --file /work/docker-compose.override.yml --service "$service" \
    --volume "$CONF_HOST:$CONF_LIVE:ro" --network-key crew-net --network-name "$CREW_NET" "$@"
}
override_backup=""
set +e
edit_override
status=$?
set -e
if ((status == 10)); then
  override_backup="$OVERRIDE.bak-$(date +%Y%m%d-%H%M%S)"
  cp -p "$OVERRIDE" "$override_backup"
  log "override backup: $override_backup"
  set +e
  edit_override --write
  status=$?
  set -e
  ((status == 10)) || die "editing the override failed (exit $status); it is unchanged"
  if ! (cd "$LANDING_DIR" && docker compose config -q); then
    cp -p "$override_backup" "$OVERRIDE"
    die "the edited override does not validate; restored $override_backup"
  fi
  log "override updated: conf mount and network crew-net ($CREW_NET)"
elif ((status == 0)); then
  log "override already has the crew mount and network"
else
  die "cannot edit $OVERRIDE (exit $status); nothing was changed"
fi
restore_override() {
  if [[ -n "$override_backup" ]]; then
    cp -p "$override_backup" "$OVERRIDE"
    warn "override restored from $override_backup"
  fi
}

# --- 2. Apply to the running container ----------------------------------------------------------------
if docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$NGINX_CONTAINER" |
  grep -qx "$CREW_NET"; then
  log "$NGINX_CONTAINER is already on $CREW_NET"
else
  docker network connect "$CREW_NET" "$NGINX_CONTAINER"
  log "connected $NGINX_CONTAINER to $CREW_NET"
fi

# After a recreate the conf is a bind mount of $CONF_HOST: update that file in place (same inode, so the
# mount sees it). Before that, the conf is a plain file copied into the container.
mount_source=$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$CONF_LIVE\"}}{{.Source}}{{end}}{{end}}" "$NGINX_CONTAINER")
mkdir -p "$(dirname "$CONF_HOST")"
had_live=0
if docker exec "$NGINX_CONTAINER" test -f "$CONF_LIVE"; then
  had_live=1
  docker cp "$NGINX_CONTAINER:$CONF_LIVE" "$work/previous.conf"
fi
if [[ -f "$CONF_HOST" ]]; then cp -p "$CONF_HOST" "$work/previous-host.conf"; fi

if ((had_live)) && cmp -s "$work/previous.conf" "$work/crew.conf"; then
  cat "$work/crew.conf" >"$CONF_HOST"
  log "live conf is already up to date; nothing to reload"
  exit 0
fi

install_conf() { # <file>
  cat "$1" >"$CONF_HOST"
  chmod 0644 "$CONF_HOST"
  if [[ -z "$mount_source" ]]; then docker cp "$1" "$NGINX_CONTAINER:$CONF_LIVE"; fi
}
install_conf "$work/crew.conf"

if ! docker exec "$NGINX_CONTAINER" nginx -t 2>"$work/nginx-t.txt"; then
  cat "$work/nginx-t.txt" >&2
  warn "nginx -t rejected the crew conf; putting the previous state back"
  if ((had_live)); then
    install_conf "$work/previous.conf"
  else
    docker exec "$NGINX_CONTAINER" rm -f "$CONF_LIVE"
    if [[ -f "$work/previous-host.conf" ]]; then cat "$work/previous-host.conf" >"$CONF_HOST"; else rm -f "$CONF_HOST"; fi
  fi
  restore_override
  docker exec "$NGINX_CONTAINER" nginx -t && docker exec "$NGINX_CONTAINER" nginx -s reload
  die "crew site not installed; nginx keeps serving its previous configuration"
fi
docker exec "$NGINX_CONTAINER" nginx -s reload
# The reload is asynchronous; give the new workers a moment before callers probe the site.
sleep 2
log "nginx reloaded with the crew site ($MODE)"
