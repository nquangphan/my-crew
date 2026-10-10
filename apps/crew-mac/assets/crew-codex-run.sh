#!/bin/sh
# Crew wrapper for codex_local on the Mac (adapterConfig.command); executor and reviewer agents use the same file.
# The credential stays on the Mac: each agent gets its own CODEX_HOME under ~/.crew/runtimes/codex/<agent id> whose
# auth.json is a symlink to ~/.codex/auth.json, and the adapter's CODEX_HOME asset is never given an auth.json, so
# the lease-release copy-back has nothing to send to the server.
# Exits 78 with a "crew-runtime blocked:" / "crew-workflow blocked:" line on stderr; never prints env values.
# CREW_CODEX_BIN and CREW_MAC_BIN exist for tests only.
here=$(cd "$(dirname "$0")" && pwd)
. "$here/crew-run-mark.sh"
crew_runtime_slot codex_local
if [ ! -e "$HOME/.codex/auth.json" ]; then
  echo 'crew-runtime blocked: Codex chưa đăng nhập trên máy (chạy "codex login" trong phiên desktop)' >&2
  exit 78
fi
asset=${CODEX_HOME:-}
dest="$HOME/.crew/runtimes/codex/$slot"
umask 077
mkdir -p "$dest/sessions" || exit 78
chmod 700 "$dest" 2>/dev/null
if [ -n "$asset" ] && [ "$asset" != "$dest" ]; then
  if [ -f "$asset/config.toml" ]; then
    cp "$asset/config.toml" "$dest/config.toml.tmp" && mv "$dest/config.toml.tmp" "$dest/config.toml" || exit 78
  fi
  if [ -d "$asset/skills" ]; then
    rm -f "$dest/skills"
    ln -s "$asset/skills" "$dest/skills" || exit 78
  fi
fi
ln -sfn "$HOME/.codex/auth.json" "$dest/auth.json" || exit 78
CODEX_HOME=$dest
export CODEX_HOME
crew_superpowers_dir
[ -n "${PAPERCLIP_RUN_ID:-}" ] && crew_run_mark
exec "${CREW_CODEX_BIN:-codex}" "$@"
