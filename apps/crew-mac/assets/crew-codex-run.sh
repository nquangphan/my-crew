#!/bin/sh
# Crew wrapper for codex_local on the Mac (adapterConfig.command); executor and reviewer agents use the same file.
# The credential stays on the Mac: each agent gets its own CODEX_HOME under ~/.crew/runtimes/codex/<agent id> whose
# auth.json is a symlink to ~/.codex/auth.json (see the reconcile step below). The adapter's CODEX_HOME asset only ever
# gets an empty auth.json ("{}", 0600) when it has none: the lease-release copy-back reads that file over SSH after
# codex exits and fails the run if it is missing, while "{}" is kept on the server side as-is. It is left in place on
# exit for that reason.
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
  if [ ! -e "$asset/auth.json" ] && [ ! -L "$asset/auth.json" ]; then
    { printf '{}' > "$asset/auth.json.tmp" && mv "$asset/auth.json.tmp" "$asset/auth.json"; } 2>/dev/null || {
      echo "crew-runtime blocked: không tạo được auth.json rỗng trong CODEX_HOME của adapter ($asset)" >&2
      exit 78
    }
  fi
  if [ -f "$asset/config.toml" ]; then
    cp "$asset/config.toml" "$dest/config.toml.tmp" && mv "$dest/config.toml.tmp" "$dest/config.toml" || exit 78
  fi
  if [ -d "$asset/skills" ]; then
    rm -f "$dest/skills"
    ln -s "$asset/skills" "$dest/skills" || exit 78
  fi
fi
# Codex refreshes tokens by writing a temp file and renaming it over auth.json, which turns the agent's symlink into
# a regular file holding the newest (rotated) refresh token. Relinking blindly would delete that token and leave the
# owner's ~/.codex/auth.json with a revoked one, so a regular file is reconciled first, never printed:
# same content -> relink; agent copy strictly newer and looks like a credential -> copy it back to ~/.codex/auth.json
# atomically (0600 temp file + rename) and relink; owner copy strictly newer (owner logged in again) -> relink;
# anything else (same mtime, unrecognised content, owner auth.json not a regular file) -> block without touching either.
owner="$HOME/.codex/auth.json"
mine="$dest/auth.json"
auth_unsynced() {
  echo "crew-runtime blocked: Codex chưa đăng nhập đồng bộ: $mine đã thành file riêng ($1); owner so với ~/.codex/auth.json, giữ bản đúng rồi xoá $mine, hoặc chạy \"codex login\"" >&2
  exit 78
}
if [ -L "$mine" ]; then
  :
elif [ -f "$mine" ]; then
  if cmp -s "$mine" "$owner"; then
    :
  elif [ "$mine" -nt "$owner" ]; then
    { [ -f "$owner" ] && [ ! -L "$owner" ]; } || auth_unsynced "~/.codex/auth.json không phải file thường"
    grep -q -e '"tokens"' -e '"OPENAI_API_KEY"' "$mine" 2>/dev/null || auth_unsynced "nội dung không giống thông tin đăng nhập"
    tmp="$HOME/.codex/.auth.json.crew-$$"
    { cp "$mine" "$tmp" && chmod 600 "$tmp" && mv -f "$tmp" "$owner"; } 2>/dev/null || {
      rm -f "$tmp"
      auth_unsynced "không ghi được bản mới về ~/.codex/auth.json"
    }
  elif [ "$owner" -nt "$mine" ]; then
    :
  else
    auth_unsynced "không xác định được bản nào mới hơn"
  fi
elif [ -e "$mine" ]; then
  auth_unsynced "không phải file thường"
fi
ln -sfn "$owner" "$mine" || exit 78
CODEX_HOME=$dest
export CODEX_HOME
[ -n "${PAPERCLIP_RUN_ID:-}" ] && crew_run_mark
exec "${CREW_CODEX_BIN:-codex}" "$@"
