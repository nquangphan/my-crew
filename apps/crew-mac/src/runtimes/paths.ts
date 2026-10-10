import { join } from 'node:path';

/**
 * Đường dẫn của runtime Codex/OpenCode trên Mac. Wrapper nằm cạnh `crew-claude-run` trong `~/.crew/bin`; trạng thái
 * riêng từng agent (CODEX_HOME, XDG của OpenCode) nằm dưới `~/.crew/runtimes`.
 */
export function runtimePaths(home: string) {
  const bin = join(home, '.crew', 'bin');
  const root = join(home, '.crew', 'runtimes');
  return {
    codexWrapper: join(bin, 'crew-codex-run'),
    opencodeWrapper: join(bin, 'crew-opencode-run'),
    /** Hai wrapper nạp file này bằng `.` theo đường dẫn tính từ `$0`. */
    runMark: join(bin, 'crew-run-mark.sh'),
    runtimesRoot: root,
    /** Thư mục Superpowers ghim hiện hành; wrapper export thành `CREW_SUPERPOWERS_DIR`. */
    superpowersDirFile: join(root, 'superpowers-dir'),
    /** Có file này nghĩa là server đã có vá chạy OpenCode đúng worktree (bước deploy ghi). */
    opencodeInPlaceFile: join(root, 'opencode-in-place'),
    /** CODEX_HOME của một agent (`shared` cho lệnh ngoài run). */
    codexHome: (slot: string) => join(root, 'codex', slot),
    opencodeHome: (slot: string) => join(root, 'opencode', slot),
    claudeSkillsDir: join(home, '.claude', 'skills'),
  };
}

export type RuntimePaths = ReturnType<typeof runtimePaths>;
