#!/usr/bin/env bash
# Shared helpers of the 2P Crew VPS scripts (deploy, restore, seed-owner, attach-nginx, enable-https).
# Sourced, never executed. Every docker call goes through the compose project $CREW_PROJECT only, so the
# scripts never touch another project's containers.
#
# Overridable for drills and E2E (defaults are the VPS values):
#   CREW_ROOT            deploy root holding deploy/ and scripts/ (default: the checkout of these scripts)
#   CREW_ENV_FILE        secrets file (default: $CREW_ROOT/.env, mode 0600)
#   CREW_PROJECT         compose project name (default: crew)
#   CREW_COMPOSE_EXTRA   one extra compose file layered on deploy/compose.yml (E2E only)

CREW_ROOT="${CREW_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CREW_ENV_FILE="${CREW_ENV_FILE:-$CREW_ROOT/.env}"
CREW_PROJECT="${CREW_PROJECT:-crew}"
CREW_NET="${CREW_PROJECT}_crew-net"
CREW_COMPOSE_FILE="$CREW_ROOT/deploy/compose.yml"

log() { printf '[crew] %s\n' "$*" >&2; }
warn() { printf '[crew] WARNING: %s\n' "$*" >&2; }
die() {
  printf '[crew] ERROR: %s\n' "$*" >&2
  exit 1
}

compose() {
  local files=(-f "$CREW_COMPOSE_FILE")
  if [[ -n "${CREW_COMPOSE_EXTRA:-}" ]]; then files+=(-f "$CREW_COMPOSE_EXTRA"); fi
  docker compose -p "$CREW_PROJECT" "${files[@]}" --env-file "$CREW_ENV_FILE" "$@"
}

require_docker_compose() {
  command -v docker >/dev/null 2>&1 || die "docker is not installed"
  local version
  version=$(docker compose version --short 2>/dev/null) || die "the docker compose plugin is missing ('docker compose version' failed)"
  [[ "${version#v}" =~ ^([2-9]|[1-9][0-9])\. ]] || die "docker compose v2 or newer is required (found $version)"
  docker info >/dev/null 2>&1 || die "cannot talk to the docker daemon (run as root or a docker-group user)"
  log "docker compose $version"
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"
}

# Reads KEY from the env file without sourcing it (the file is data, never executed).
env_get() {
  local key="$1" line
  line=$(grep -E "^${key}=" "$CREW_ENV_FILE" | tail -n 1 || true)
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  printf '%s' "$line"
}

# The .env must exist, be private (0600) and hold every required secret in a usable shape.
check_env_file() {
  [[ -f "$CREW_ENV_FILE" ]] || die "$CREW_ENV_FILE is missing; create it from deploy/.env.example (chmod 600)"
  local mode
  mode=$(file_mode "$CREW_ENV_FILE")
  [[ "$mode" == "600" ]] || die "$CREW_ENV_FILE has mode $mode; run: chmod 600 $CREW_ENV_FILE"
  local password secret domain origin
  password=$(env_get POSTGRES_PASSWORD)
  secret=$(env_get SESSION_SECRET)
  domain=$(env_get CREW_DOMAIN)
  origin=$(env_get PUBLIC_ORIGIN)
  [[ "$password" =~ ^[A-Za-z0-9]{24,}$ ]] ||
    die "POSTGRES_PASSWORD must be 24+ letters/digits (it is embedded in DATABASE_URL); generate: openssl rand -hex 24"
  ((${#secret} >= 32)) || die "SESSION_SECRET must be at least 32 characters; generate: openssl rand -hex 32"
  valid_domain "$domain" || die "CREW_DOMAIN '$domain' is not a valid host name"
  [[ "$origin" =~ ^https?://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "PUBLIC_ORIGIN '$origin' must look like https://$domain"
}

valid_domain() {
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$ ]]
}

crew_domain() {
  local domain="${CREW_DOMAIN:-}"
  [[ -n "$domain" ]] || domain=$(env_get CREW_DOMAIN)
  [[ -n "$domain" ]] || domain="crew.2p-solutions.com"
  valid_domain "$domain" || die "invalid CREW_DOMAIN '$domain'"
  printf '%s' "$domain"
}

# GET <url> from a throwaway container on crew-net, i.e. the way the edge nginx reaches the stack.
# Prints the body; fails unless the status is 2xx.
net_get() {
  docker run --rm --network "$CREW_NET" --entrypoint node crew-api:latest -e "
    fetch(process.argv[1]).then(async (r) => {
      const body = await r.text();
      process.stdout.write(body);
      process.exit(r.ok ? 0 : 1);
    }, (e) => { console.error(String(e)); process.exit(1); });" "$1"
}
