# Sourced by crew-codex-run and crew-opencode-run (not executed on its own).
# crew_run_mark records this run's process group under <worktree>/.paperclip-runtime/runs/<run id>/ so the server
# (H3) and the crew-mac orphan reaper can stop the whole run later. Same block as crew-claude-run.sh: $$ is the pid
# that execs the agent CLI, and every exec in the chain keeps the same PID.
crew_run_mark() {
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
}

# crew_runtime_slot <runtime>: in a Paperclip run, PAPERCLIP_AGENT_ID must be a UUID (it names the per-agent state
# directory) and `crew-mac workflow-check --runtime <runtime>` must accept the worktree; any refusal exits 78 before
# the agent CLI starts. Sets $slot to the agent id, or to "shared" outside a run (the adapter probing --version).
# CREW_SUPERPOWERS_DIR is exported first so workflow-check verifies the same pinned copy the agent will read.
crew_runtime_slot() {
  crew_superpowers_dir
  slot=shared
  [ -n "${PAPERCLIP_RUN_ID:-}" ] || return 0
  if ! printf '%s' "${PAPERCLIP_AGENT_ID:-}" | grep -q '^[0-9a-fA-F]\{8\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{4\}-[0-9a-fA-F]\{12\}$'; then
    echo "crew-runtime blocked: thiếu PAPERCLIP_AGENT_ID (cần UUID của agent)" >&2
    exit 78
  fi
  slot=$PAPERCLIP_AGENT_ID
  "${CREW_MAC_BIN:-$HOME/.crew/bin/crew-mac}" workflow-check --runtime "$1" --root "$PWD" >&2 || {
    echo "crew-workflow blocked: crew-mac workflow-check từ chối run này (xem các dòng trên)" >&2
    exit 78
  }
}

# crew_superpowers_dir: exports CREW_SUPERPOWERS_DIR (pinned Superpowers copy) from the file `crew-mac setup` writes.
crew_superpowers_dir() {
  sp_file="$HOME/.crew/runtimes/superpowers-dir"
  if [ -r "$sp_file" ]; then
    CREW_SUPERPOWERS_DIR=$(cat "$sp_file")
    export CREW_SUPERPOWERS_DIR
  fi
}
