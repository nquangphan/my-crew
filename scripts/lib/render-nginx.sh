#!/bin/sh
# Renders the 2P Crew site for the shared edge nginx to stdout:
#   render-nginx.sh <http|https> <domain> [<template dir, default deploy/nginx>]
# POSIX sh and awk only, so it also runs inside nginx:alpine (deploy/compose.test.yml).
set -eu

mode="${1:-}"
domain="${2:-}"
dir="${3:-$(dirname "$0")/../../deploy/nginx}"

case "$mode" in
  http | https) ;;
  *)
    echo "usage: render-nginx.sh <http|https> <domain> [template-dir]" >&2
    exit 2
    ;;
esac
if ! printf '%s' "$domain" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'; then
  echo "render-nginx.sh: invalid domain '$domain'" >&2
  exit 2
fi
template="$dir/crew-$mode.conf"
locations="$dir/crew-locations.inc"
for file in "$template" "$locations"; do
  [ -f "$file" ] || {
    echo "render-nginx.sh: missing $file" >&2
    exit 2
  }
done

awk -v inc="$locations" -v domain="$domain" '
  /# @crew-locations/ {
    while ((getline line < inc) > 0) { gsub(/__CREW_DOMAIN__/, domain, line); print line }
    close(inc)
    next
  }
  { gsub(/__CREW_DOMAIN__/, domain); print }
' "$template"
