# Sửa crew-docs.runtime trỏ vào binary app và thiếu bundle crew-docs

Commit: `cdbd115` trên nhánh `r25-pair` (chưa push).

## Kết quả

- App mang theo `Contents/Resources/crew-docs.cjs` (build từ `packages/docs-kit`) và mỗi lần mở cài vào
  `~/.crew/bin/crew-docs.cjs` khi chưa có hoặc nội dung khác (ghi file tạm rồi rename).
- `crew-docs.runtime` luôn là node thật: lấy từ cơ chế dò/tải sẵn có (`stableNodePath`, shell đăng nhập,
  `ensureNode` tải vào `~/.crew/node`), không bao giờ là binary trong `.app` hay `process.execPath` dưới Electron.
- Lúc mở app tự sửa repo đã biết, ghi `app.log`; không có node thì để nguyên config, không chặn app.
- Doctor báo `fail` khi runtime là binary của app (không chạy nó, tránh bật cửa sổ) và khi file bundle không tồn tại.
- Không đổi fuse, không thêm bước tay, hộp thoại hay công cụ mới.

## File đổi

- Mới: `apps/mac-app/src/main/projects/docs-runtime.ts` (`runtimeProblem`, `installDocsBundle`, `repairDocsConfig`,
  `repairDocsOnStart`), `apps/mac-app/test/projects-docs-runtime.test.ts`.
- `apps/mac-app/src/main/projects/folder.ts`: `configureDocsBundle` kiểm bundle và runtime độc lập; runtime hỏng thì
  lấy runtime dùng được của repo khác, không có thì `nodePath()`; không có node thì để nguyên, không ném.
- `apps/mac-app/src/utility/ops.ts`, `apps/mac-app/src/main/ops-bridge.ts`: op `docsNodePath`, `repairDocsHooks`.
- `apps/mac-app/src/main/projects/register.ts`: gọi `repairDocsOnStart` (chạy nền) mỗi lần app mở.
- `apps/mac-app/src/main/projects/add-project.ts`, `apps/mac-app/src/main/jobs/executors.ts`: truyền `nodePath`.
- `apps/crew-mac/src/commands/doctor.ts`: runtime trong `.app` thì fail + gợi ý; `CREW_MISSING_BUNDLE` /
  `CREW_MISSING_RUNTIME` thay `CREW_MISSING`.
- Đóng gói: `apps/mac-app/electron-builder.yml` (extraResources), `apps/mac-app/package.json` (script `package` build
  docs-kit), `apps/mac-app/scripts/release-lib.mjs` (bước `build-docs`), `apps/mac-app/scripts/release.mjs` (tự kiểm
  có `Contents/Resources/crew-docs.cjs`).
- Test: `apps/crew-mac/test/doctor.test.ts`, `apps/mac-app/test/ops-bridge.test.ts, projects-add.test.ts, projects-fixture.ts`,
  `apps/mac-app/test/jobs/{executors,remove}.test.ts`, `apps/mac-app/scripts/release-lib.test.mjs`.
- Docs: `docs/flows.yaml` (thêm 2 file vào `mac-app-paperclip`), `docs/files.md` (generate),
  `docs/flows/{mac-app-paperclip,mac-app,mac-app-update,mac-setup}.md`.

## Self-heal quyết định thế nào

Lúc app mở, `registerProjects` → `repairDocsOnStart` → op `repairDocsHooks(<Resources>/crew-docs.cjs)` trong utility:

1. Cài bundle (lỗi, ví dụ bản dev không có Resources, chỉ ghi `docs-bundle-install-failed`).
2. Chưa có `~/.crew/status-repos.json` (máy mới) thì dừng: không dò hay tải node.
3. Lấy node: giá trị nhớ / dò đồng bộ / shell đăng nhập; không có thì tải như `ensureNode`. Vẫn không có thì ghi
   `docs-node-missing`, không đổi config nào.
4. Mỗi repo trong `listStatusRepos`:
   - chưa đặt cả `crew-docs.runtime` lẫn `crew-docs.bundle` (không dùng crew-docs) thì bỏ qua;
   - `crew-docs.bundle` không còn là file thì trỏ về `~/.crew/bin/crew-docs.cjs`;
   - `crew-docs.runtime` chưa đặt, không phải file, không có quyền chạy, nằm trong `.app` (giải symlink) hoặc trùng
     binary Electron thì đặt sang node;
   - giá trị còn dùng được (kể cả owner tự đặt) giữ nguyên;
   - git lỗi thì ghi lý do, sang repo sau.
5. Log: `docs-bundle-installed`, `docs-hooks-repaired` (repo, key, runtime), `docs-hooks-repair-skipped`,
   `docs-repair-failed`. Không bao giờ ném ra Main.

## Test đã chạy

- `apps/mac-app`: `vitest run` cho `ops-bridge`, `projects-add`, `jobs/*`, `projects-folder`, `projects-docs-runtime`,
  `projects-ipc`, `main-startup-order`: 13 file, 211 test đạt. `node --test scripts/release-lib.test.mjs`: 24 đạt.
- `apps/crew-mac`: `vitest run test/doctor.test.ts`: 61 đạt.
- `pnpm --filter @crew/mac-app typecheck`, `pnpm --filter @crew/mac typecheck`: sạch.
- `biome check apps/mac-app apps/crew-mac`: sạch.
- `crew-docs check --staged` và `check --range 3140335..HEAD`: ok.
- Không chạy full suite, không Playwright, không build/release .app.

## Lưu ý cho owner

- Máy có `status-repos.json` mà không có node nào thì lần mở app sẽ tải Node LTS vào `~/.crew/node` (cùng cơ chế bước
  Kiểm tra máy). Tải lỗi chỉ ghi log.
- Dòng hook trong `packages/docs-kit/src/hook-installer.ts` vẫn có `ELECTRON_RUN_AS_NODE=1` (vô hại với node thật);
  không đổi để khỏi đụng flow `docs-hooks`.
