#!/bin/sh
# Crew wrapper for opencode_local on the Mac (adapterConfig.command). The OpenCode Go key lives only in the owner's
# Keychain (service crew.opencode-go, account crew): it is read here into the environment of the opencode process and
# never goes on argv, into a file, or to stdout/stderr.
# Exits 78 with a "crew-runtime blocked:" / "crew-workflow blocked:" line on stderr; never prints env values.
# CREW_OPENCODE_BIN, CREW_SECURITY_BIN and CREW_MAC_BIN exist for tests only.
here=$(cd "$(dirname "$0")" && pwd)
. "$here/crew-run-mark.sh"
crew_runtime_slot opencode_local
key=$("${CREW_SECURITY_BIN:-/usr/bin/security}" find-generic-password -s crew.opencode-go -a crew -w 2>/dev/null) || key=""
if [ -z "$key" ]; then
  echo 'crew-runtime blocked: thiếu key OpenCode Go trong Keychain (service crew.opencode-go); owner chạy "crew-mac runtimes key opencode" trong Terminal của Mac' >&2
  exit 78
fi
# The config below reads {env:CREW_OPENCODE_GO_KEY}; the opencode-go provider also reads OPENCODE_API_KEY itself.
CREW_OPENCODE_GO_KEY=$key
OPENCODE_API_KEY=$key
unset key
export CREW_OPENCODE_GO_KEY OPENCODE_API_KEY
base="$HOME/.crew/runtimes/opencode/$slot"
umask 077
mkdir -p "$base/data" "$base/state" "$base/cache" "$base/config" || exit 78
XDG_DATA_HOME="$base/data"
XDG_STATE_HOME="$base/state"
XDG_CACHE_HOME="$base/cache"
export XDG_DATA_HOME XDG_STATE_HOME XDG_CACHE_HOME
if [ -z "${XDG_CONFIG_HOME:-}" ]; then
  XDG_CONFIG_HOME="$base/config"
  export XDG_CONFIG_HOME
fi
OPENCODE_CONFIG_CONTENT='{"provider":{"opencode-go":{"options":{"apiKey":"{env:CREW_OPENCODE_GO_KEY}"}}},"permission":{"edit":"allow","bash":"allow","external_directory":"allow"}}'
export OPENCODE_CONFIG_CONTENT
crew_superpowers_dir
[ -n "${PAPERCLIP_RUN_ID:-}" ] && crew_run_mark
# OpenCode retries a 429 silently (up to 5 times, honouring retry-after); --print-logs puts the ERROR line
# ("Go usage limit exceeded", "API key is missing") on stderr right away so the server sees why the run stalls.
if [ "${1:-}" = run ]; then
  shift
  has_logs=0
  for arg in "$@"; do
    [ "$arg" = --print-logs ] && has_logs=1
  done
  if [ "$has_logs" -eq 1 ]; then
    set -- run "$@"
  else
    set -- run --print-logs "$@"
  fi
fi
exec "${CREW_OPENCODE_BIN:-opencode}" "$@"
