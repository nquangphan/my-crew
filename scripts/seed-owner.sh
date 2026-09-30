#!/usr/bin/env bash
# Creates the single owner account (or, with --reset, replaces its password and signs out every session) on
# the running stack. Interactive only: run it over `ssh -t` from the deploy root (/opt/crew):
#
#   scripts/seed-owner.sh <username> [--reset]
#
# The password is typed twice at a hidden prompt inside crew-api; it is never passed on the command line,
# read from a file or defaulted.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

username="${1:-}"
[[ "$username" =~ ^[A-Za-z0-9._-]{1,100}$ ]] || die "usage: scripts/seed-owner.sh <username> [--reset] (A-Z a-z 0-9 . _ -)"
extra=()
case "${2:-}" in
  "") ;;
  --reset) extra=(--reset) ;;
  *) die "unknown option ${2}" ;;
esac
[[ -t 0 && -t 1 ]] || die "needs an interactive terminal: ssh -t <vps> 'cd /opt/crew && scripts/seed-owner.sh $username'"

require_docker_compose
check_env_file
compose ps --status running --services | grep -qx crew-api || die "crew-api is not running; run scripts/deploy.sh first"

# An empty CREW_OWNER_PASSWORD makes the CLI prompt instead of reading a password from the environment.
compose exec -it -e CREW_OWNER_PASSWORD= crew-api node dist/cli/seed-owner.js --username "$username" ${extra[@]+"${extra[@]}"}
