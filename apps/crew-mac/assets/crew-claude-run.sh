#!/bin/sh
# Crew wrapper for claude_local on the Mac (adapterConfig.command).
# Records this run's process group so the server (H3) and the crew-mac orphan reaper can stop
# the whole run later, then becomes the agent CLI. The SSH session already gives
# this process its own group, and every exec in the chain keeps the same PID.
#
# Runs started by Paperclip must load exactly one --plugin-dir (the pinned Superpowers copy) and nothing from
# outside the allow-list: `crew-mac workflow-check` decides, and any refusal exits 78 without starting the agent.
# CREW_MAC_BIN and CREW_CLAUDE_BIN exist for tests only.
if [ -n "${PAPERCLIP_RUN_ID:-}" ]; then
  plugin_dir=""
  plugin_dirs=0
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "--plugin-dir" ]; then
      plugin_dir=$arg
      plugin_dirs=$((plugin_dirs + 1))
    else
      case "$arg" in
        --plugin-dir=*)
          plugin_dir=${arg#--plugin-dir=}
          plugin_dirs=$((plugin_dirs + 1))
          ;;
      esac
    fi
    prev=$arg
  done
  if [ "$plugin_dirs" -ne 1 ]; then
    echo "crew-workflow blocked: cần đúng một --plugin-dir (bản Superpowers đã ghim) trong adapterConfig.extraArgs, có $plugin_dirs; chạy \"crew-mac setup\" để xem giá trị" >&2
    exit 78
  fi
  "${CREW_MAC_BIN:-$HOME/.crew/bin/crew-mac}" workflow-check --root "$PWD" --plugin-dir "$plugin_dir" >&2 || {
    echo "crew-workflow blocked: crew-mac workflow-check từ chối run này (xem các dòng trên)" >&2
    exit 78
  }
  case "$PAPERCLIP_RUN_ID" in
    *[!0-9a-fA-F-]*) ;;
    *)
      dir="$PWD/.paperclip-runtime/runs/$PAPERCLIP_RUN_ID"
      if mkdir -p "$dir" 2>/dev/null; then
        # started = the time THIS process was born (epoch seconds), not the time this line runs:
        # the SSH session sources the owner's profile before exec'ing the wrapper, and a slow
        # profile would otherwise push started past the birth of the session leader.
        elapsed=$(ps -o etime= -p $$ | awk -F'[-:]' '{ n = NF; s = $n + $(n-1) * 60; if (n >= 3) s += $(n-2) * 3600; if (n >= 4) s += $(n-3) * 86400; print s }')
        echo $(( $(date +%s) - ${elapsed:-0} )) > "$dir/started.tmp" && mv "$dir/started.tmp" "$dir/started"
        ps -o pgid= -p $$ | tr -d ' ' > "$dir/pgid.tmp" && mv "$dir/pgid.tmp" "$dir/pgid"
      fi
      ;;
  esac
fi
exec "${CREW_CLAUDE_BIN:-claude}" "$@"
