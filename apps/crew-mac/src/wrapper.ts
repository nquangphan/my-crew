import { fileURLToPath } from 'node:url';

/** Nguồn wrapper crew-claude-run; src/ và bản build cùng nằm ngay dưới apps/crew-mac nên đường dẫn tương đối như nhau. */
export const WRAPPER_SOURCE = fileURLToPath(new URL('../assets/crew-claude-run.sh', import.meta.url));
/** Hàm chung (ghi nhóm process của run, kiểm agent/workflow, `CREW_SUPERPOWERS_DIR`) mà hai wrapper runtime nạp bằng `.`. */
export const RUN_MARK_SOURCE = fileURLToPath(new URL('../assets/crew-run-mark.sh', import.meta.url));
/** Wrapper `crew-codex-run` cho agent codex_local (executor và reviewer). */
export const CODEX_WRAPPER_SOURCE = fileURLToPath(new URL('../assets/crew-codex-run.sh', import.meta.url));
/** Wrapper `crew-opencode-run` cho agent opencode_local. */
export const OPENCODE_WRAPPER_SOURCE = fileURLToPath(
  new URL('../assets/crew-opencode-run.sh', import.meta.url),
);
