#!/usr/bin/env bash
# Switches 2P Crew to HTTPS once DNS points at this VPS. From the deploy root (/opt/crew), after
# scripts/attach-nginx.sh http:
#
#   scripts/enable-https.sh            (optional: CERTBOT_EMAIL=you@example.com for a new ACME account)
#
# 1. The A record of CREW_DOMAIN must resolve, and a probe file written to the certbot webroot must be
#    served back at http://<domain>/.well-known/acme-challenge/ (proves the challenge path reaches this nginx).
# 2. certbot (container 2ps-landing-certbot, webroot /var/www/certbot) issues or keeps the certificate.
# 3. scripts/attach-nginx.sh https installs the HTTPS site with the HTTP -> HTTPS redirect.
# Idempotent. If a check or the issuance fails, it stops and the HTTP site stays as it was.
#
# Overridable: CERTBOT_CONTAINER (2ps-landing-certbot), NGINX_CONTAINER, LANDING_DIR, CREW_DOMAIN.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

CERTBOT_CONTAINER="${CERTBOT_CONTAINER:-2ps-landing-certbot}"
NGINX_CONTAINER="${NGINX_CONTAINER:-2ps-landing-nginx}"
WEBROOT=/var/www/certbot
DOMAIN=$(crew_domain)

require_docker_compose
command -v curl >/dev/null 2>&1 || die "curl is required"
[[ "$(docker inspect -f '{{.State.Running}}' "$CERTBOT_CONTAINER" 2>/dev/null)" == "true" ]] ||
  die "container $CERTBOT_CONTAINER is not running"
docker exec "$NGINX_CONTAINER" test -f /etc/nginx/conf.d/crew.conf ||
  die "the crew site is not on $NGINX_CONTAINER yet; run scripts/attach-nginx.sh http first"

# --- 1. DNS and the challenge path ------------------------------------------------------------------
resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{ print $1 }' | sort -u | tr '\n' ' ' || true)
[[ -n "${resolved// /}" ]] || die "$DOMAIN has no A record yet; create it (A -> this VPS) and retry"
local_ips=$(hostname -I 2>/dev/null || true)
public_ip=$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
log "$DOMAIN resolves to: $resolved(this host: ${public_ip:-unknown public IP}; interfaces: ${local_ips:-?})"
if [[ -n "$public_ip" && " $resolved " != *" $public_ip "* ]]; then
  die "$DOMAIN does not point at this VPS ($public_ip) yet; wait for DNS and retry"
fi

token="crew-probe-$(date +%s)-$RANDOM"
probe_path="$WEBROOT/.well-known/acme-challenge/$token"
cleanup_probe() { docker exec "$CERTBOT_CONTAINER" rm -f "$probe_path" >/dev/null 2>&1 || true; }
trap cleanup_probe EXIT
docker exec "$CERTBOT_CONTAINER" sh -c "mkdir -p '$WEBROOT/.well-known/acme-challenge' && printf '%s' '$token' > '$probe_path'"
served=$(curl -fsS --max-time 10 "http://$DOMAIN/.well-known/acme-challenge/$token" 2>/dev/null || true)
[[ "$served" == "$token" ]] ||
  die "http://$DOMAIN/.well-known/acme-challenge/ does not reach this nginx's webroot; certificate not requested"
log "challenge path OK"

# --- 2. Certificate -------------------------------------------------------------------------------
account=(--register-unsafely-without-email)
if [[ -n "${CERTBOT_EMAIL:-}" ]]; then account=(-m "$CERTBOT_EMAIL"); fi
log "requesting the certificate (kept as is while it is not due for renewal)"
if ! docker exec "$CERTBOT_CONTAINER" certbot certonly --webroot -w "$WEBROOT" -d "$DOMAIN" --cert-name "$DOMAIN" \
  --non-interactive --agree-tos --keep-until-expiring "${account[@]}"; then
  die "certificate issuance failed; the HTTP site is unchanged (see the certbot output above)"
fi

# --- 3. HTTPS site -------------------------------------------------------------------------------
"$CREW_ROOT/scripts/attach-nginx.sh" https
if health=$(curl -fsS --max-time 10 "https://$DOMAIN/v1/health"); then
  log "https://$DOMAIN/v1/health -> $health"
else
  die "HTTPS site installed but https://$DOMAIN/v1/health failed; check: docker exec $NGINX_CONTAINER nginx -T"
fi
log "HTTPS enabled. Certificates renew in $CERTBOT_CONTAINER; nginx must reload to serve a renewed one."
