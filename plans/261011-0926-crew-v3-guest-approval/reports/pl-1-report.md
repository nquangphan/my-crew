# Báo cáo PL-1

Commit: b18eb5ca9 (nhánh crew/ga-pl1), 3 file: migration 0013, migration-0013.db.test.ts, contributions-isolation.test.ts.

Lệnh test (từng file, trong worktree):
- `corepack pnpm --filter @crew/paperclip-plugin exec vitest run --config vitest.config.ts src/__tests__/<file>`
- migration-0013.db.test.ts: pass. migration-0012.db.test.ts: pass. contributions-isolation.test.ts: pass.
- `corepack pnpm --filter @crew/paperclip-plugin typecheck`: pass, sau khi build `@paperclipai/plugin-sdk` (dist chưa có sau install; dist bị git ignore).
- ipcs -m: hai segment (65536, 93388801) có sẵn từ trước khi bắt đầu, không đổi sau test; không có tiến trình postgres còn sót.

Lệch spec: SQL giống spec §4, chỉ bỏ các comment tiếng Việt trong cột. Không lệch khác.
Lưu ý: `gen_random_uuid()` chạy được trên Postgres nhúng của test.
