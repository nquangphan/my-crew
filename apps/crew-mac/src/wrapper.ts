import { fileURLToPath } from 'node:url';

/** Nguồn wrapper crew-claude-run; src/ và bản build cùng nằm ngay dưới apps/crew-mac nên đường dẫn tương đối như nhau. */
export const WRAPPER_SOURCE = fileURLToPath(new URL('../assets/crew-claude-run.sh', import.meta.url));
