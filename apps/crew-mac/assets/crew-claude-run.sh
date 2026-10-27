#!/bin/sh
# Crew wrapper for claude_local on the Mac (adapterConfig.command).
# Records this run's process group so the server (H3) and the crew-mac orphan reaper can stop
# the whole run later, then becomes the agent CLI. The SSH session already gives
# this process its own group, and every exec in the chain keeps the same PID.
#
# Runs started by Paperclip must load exactly one --plugin-dir (the pinned copy of one certified workflow:
# Superpowers or BMAD) and nothing from outside the allow-list: `crew-mac workflow-check` decides, and any refusal
# exits 78 without starting the agent. An accepted run leaves <plugin_dir>/.in_use/<run id> ("<pid> <started>") so
# the pin GC keeps that copy while the run lives; failing to write it never blocks the run.
# CREW_MAC_BIN, CREW_CLAUDE_BIN and CREW_E2E_STUB_BIN exist for tests only.
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
    echo "crew-workflow blocked: cần đúng một --plugin-dir (bản workflow đã ghim) trong adapterConfig.extraArgs, có $plugin_dirs; chạy \"crew-mac workflows list\" để xem giá trị" >&2
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
      # $$ is the pid that execs claude below.
      if mkdir -p "$plugin_dir/.in_use" 2>/dev/null; then
        printf '%s %s\n' "$$" "$(cat "$dir/started" 2>/dev/null || echo 0)" 2>/dev/null > "$plugin_dir/.in_use/$PAPERCLIP_RUN_ID.tmp" \
          && mv "$plugin_dir/.in_use/$PAPERCLIP_RUN_ID.tmp" "$plugin_dir/.in_use/$PAPERCLIP_RUN_ID" 2>/dev/null
      fi
      ;;
  esac
  # Acceptance-test stub: never calls the model. Runs only when the REAL path of the checkout is under
  # $HOME/crew-agents/e2e-* AND its git dir holds a crew-e2e-stub marker (an agent cannot reach this from a real
  # project: a symlinked e2e-* path resolves to the real checkout). Placed after workflow-check and the process-group
  # record so the server (H3) and the reaper still see this run.
  real_pwd=$(pwd -P)
  real_home=$(cd "$HOME" 2>/dev/null && pwd -P)
  case "$real_pwd" in
    "$real_home"/crew-agents/e2e-*)
      gitdir=$(git -C "$real_pwd" rev-parse --absolute-git-dir 2>/dev/null || true)
      if [ -n "$real_home" ] && [ -n "$gitdir" ] && [ -f "$gitdir/crew-e2e-stub" ]; then
        exec "${CREW_E2E_STUB_BIN:-$HOME/.crew/app/crew-mac/assets/crew-e2e-stub.sh}" "$gitdir/crew-e2e-stub"
      fi
      ;;
  esac
fi
exec "${CREW_CLAUDE_BIN:-claude}" "$@"
