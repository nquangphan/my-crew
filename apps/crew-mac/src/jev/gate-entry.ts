// Entry gom bằng esbuild thành `dist/jev-gate.cjs` (kèm jev-use): bản cài `~/.crew/app/crew-mac` và bản app mang theo
// chỉ có `dist/**`, không có node_modules. `cli.ts` nạp file này chỉ khi Jev đang bật cho company của run.
export { runGate } from './gate.js';
