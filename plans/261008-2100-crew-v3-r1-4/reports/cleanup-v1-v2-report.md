# Báo cáo dọn code v1/v2 (nhánh cleanup-v1-v2, từ v3 @ 95ee19d)

Worktree: /Users/phannhatquang/Documents/projects/crew/.worktrees/crew-cleanup. Không push.

## Commit
- 29ab2d4 refactor(docs-kit): đưa schema flows.yaml vào docs-kit, bỏ phụ thuộc @crew/shared
- 49e5c7d chore: gỡ code v1 và v2 không còn dùng (trailer Crew-Owner-Approved: CREWV3-2; 613 file, +933/-130401)
- 52355af docs: mô tả đúng repo sau khi gỡ v1 và v2 (trailer CREWV3-2)

## Đã xóa (file đã track)
apps/api 124, apps/web 142, apps/daemon 145, apps/desktop 79, packages/shared 27, e2e 15, deploy 11, scripts 7,
v2/ 18, docs/v2 1, docs/guides 5, docs/crew-v2-project-guide.md, docker-compose.dev.yml, .dockerignore, .env.example,
26 trang docs/flows của v1 (kể cả daemon-setup rỗng). Thư mục node_modules mồ côi của các app đã xóa bằng rm -rf đường dẫn cụ thể.
Kiểm rg: crew-mac/docs-kit/.githooks/.claude không tham chiếu tới các đường dẫn này (chỉ ví dụ minh họa trong STANDARD.md).

## Chuyển từ packages/shared sang docs-kit
docs-kit chỉ dùng FlowsManifest, FlowId, FLOWS_MANIFEST_PATH, flowsForPath (docs-schemas.ts). Chuyển sang
packages/docs-kit/src/flows-schema.ts + test/flows-schema.test.ts (từ test flowsForPath cũ). Thêm dependency zod ^4.6.5,
bỏ @crew/shared, alias esbuild, paths tsconfig, alias vitest. Phần schema snapshot/web không chuyển (chỉ web/api dùng).

## Cấu hình gốc
pnpm-workspace.yaml bỏ e2e; package.json bỏ khối pnpm.onlyBuiltDependencies (better-sqlite3 không còn); .gitignore bỏ mục desktop/edge/e2e;
.github/workflows/ci.yml chỉ còn job check (typecheck, lint, bundle crew-docs, check --range/--all, test, build), bỏ Postgres, e2e, release, runtime-release, tag trigger;
pnpm-lock.yaml cập nhật (-678 package). Biome sắp lại import trong docs-kit/src/manifest.ts.

## Docs
docs/flows.yaml: giữ 5 flow (docs-check, docs-hooks, mac-setup, mac-orphan-reaper, mac-workflows); bỏ include apps/api/drizzle; shared: {} và unassigned: [].
Viết lại docs/index.md (mục đích/stack/bản đồ module, bỏ mục Hướng dẫn), docs/architecture.md, README.md, AGENTS.md (mô tả + Lệnh), docs/CONTRIBUTING.md; sửa docs-check.md, mac-setup.md, STANDARD.md; crew-docs generate cập nhật files.md/index.md.

## Kiểm
- pnpm install --frozen-lockfile: OK
- pnpm -r build, pnpm -r typecheck: OK
- pnpm -r test: docs-kit 43/43 (3 file), crew-mac 301 test (22 file). Một lần chạy song song đỏ crew-claude-run.test.ts (lỗi chập chờn có sẵn); chạy riêng 11/11 đạt.
- crew-docs check --staged / --commit-msg (hook trong 3 commit): OK; check --all: OK; check --range v3..HEAD: OK (3 commits).
- pnpm lint: ĐỎ do lỗi có sẵn ngoài phạm vi: file kit .agents/** và .codex/** (format), apps/crew-mac/src/status/tcc.ts và test/status-tcc.test.ts (organizeImports/format). Phần tôi đụng đã sạch.

## Giữ lại và lý do
.agentkit, .codex, .agents, .claude, .githooks, .github (cấu hình kit/agent/hook); .nvmrc; vitest.workspace.ts (['apps/*','packages/*'] vẫn đúng); tsconfig.base.json; biome.json (không tham chiếu thư mục đã xóa);
docs/superpowers/specs (đặc tả thiết kế lịch sử, gồm spec v2 10-01) và plans/ (không đụng); docs/CONTRIBUTING.md (đã sửa).

## Rủi ro còn lại
- pnpm lint toàn repo vẫn đỏ (lỗi có sẵn, 5 lỗi ở crew-mac tcc + file kit); nếu CI chạy lint sẽ đỏ cho tới khi sửa.
- docs/superpowers/specs/2026-10-01-crew-v2-design.md và plans/ còn nhắc v1/v2 (lịch sử, cố ý giữ).
- docs/flows/mac-setup.md còn nhắc "~/.crew của crewd" (hành vi uninstall giữ dữ liệu cũ, vẫn đúng).
- Chưa push; nhánh cần owner xem trước khi merge vào v3.
