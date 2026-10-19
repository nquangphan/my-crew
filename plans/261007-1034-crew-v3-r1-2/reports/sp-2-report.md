# SP-2 report

- **SHA:** `3adaeb6` trên nhánh `r1-2/crew-mac`. Commit này gồm cả nit N1: JSDoc của `extractRunId` về đúng chỗ, `isEnvReadable` có JSDoc riêng.
- **File:**
  - Tạo `apps/crew-mac/src/workflows/{pin,policy,tree-checksum,install}.ts`.
  - Sửa `src/context.ts` (`superpowersPin`), `src/paths.ts` (`workflowsRoot`, comment `~/.crew`), `src/cli.ts` (gán `SUPERPOWERS_PIN`, in `extraArgs`), `src/commands/setup.ts` (`installSuperpowersPin` trước mọi file, `SetupReport.superpowers`), `src/commands/doctor.ts` (`checkSuperpowersPin`, id `superpowers-pin`, gọi ngay sau `checkLauncher`), `src/reaper/process-table.ts` (N1).
  - Test: tạo `test/workflows-pin.test.ts`; sửa `test/helpers/fake-mac.ts` (`FIXTURE_PIN`, `seedOwnerPlugin`, `installedPluginsFile`, option `ownerSuperpowers` mặc định true), `test/setup.test.ts`, `test/doctor.test.ts` (thêm `superpowers-pin` vào danh sách "máy khỏe"), `test/cli.test.ts`.
  - Docs: `docs/flows.yaml` (chỉ thêm flow `mac-workflows`), `docs/flows/mac-workflows.md` (mới), `docs/flows/mac-setup.md`, `docs/flows/mac-orphan-reaper.md` (cho luật R3 vì sửa `process-table.ts`), `docs/index.md` và `docs/files.md` (sinh bằng `generate`).
- **RED:** `pnpm --filter @crew/mac exec vitest run test/workflows-pin.test.ts test/setup.test.ts test/doctor.test.ts test/cli.test.ts`
  ```
  × setup đọc key từ file .pub và in việc đã làm
  FAIL test/doctor.test.ts  Error: Cannot find module '../src/workflows/pin.js'
  FAIL test/setup.test.ts   Error: Cannot find module '../src/workflows/pin.js'
  FAIL test/workflows-pin.test.ts  Error: Cannot find module '../src/workflows/install.js'
  Test Files  4 failed (4)
  ```
- **GREEN:** cùng 4 file, thêm uninstall, stop-run, run-members, reaper-select → `Test Files 8 passed (8)`, `Tests 141 passed (141)`. Typecheck `@crew/mac` sạch. `biome check apps/crew-mac` sạch. `crew-docs check --all`, `--staged` và `--commit-msg` đều ok.
- **Kiểm trên bản thật:** chạy `treeChecksum` (bản TypeScript) trên `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1` ra `{ checksum: 3f0ff8c8…bd9a, files: 231 }`, khớp `SUPERPOWERS_PIN`. Lệnh chỉ đọc, chạy bằng test tạm đã xóa. Checksum giả `887ad97e…` cũng khớp thuật toán shell.
- **Giả định:** chỉ nhận bản owner cài nếu entry trong `installed_plugins.json` có `gitCommitSha` trùng đúng revision của pin; thiếu `gitCommitSha` thì không nhận.
- **Lệch plan** (lý do ghi trong ledger):
  - Pin truyền qua `MacContext.superpowersPin`, không qua `SetupOptions`/`DoctorOptions`.
  - `setup` trả `SetupReport.superpowers` thay vì in qua `ctx.out`.
  - Test thêm: `.in_use` dưới thư mục con vẫn được tính, cây owner bị sửa, bản tạm dở dang, `readInstalledPlugins` với file hỏng, doctor gặp symlink.
  - Sửa thêm `context.ts`, `cli.ts` và `mac-orphan-reaper.md`, không có trong danh sách file của plan.
- **Không chạy:** `crew-mac setup` thật, không ghi `~/.crew` thật.

## Sửa sau review

- **SHA:** `3a4b374` (chung commit với phần sửa SP-3).
- **S1:** checksum đã ghim không đổi. `WorkflowPin` có thêm `executables`: 11 file có bit x dưới `hooks/` và `skills/` của 6.4.1, trong đó có `hooks/run-hook.cmd` và `hooks/session-start`; danh sách này không nằm trong `samePin`.
  - `installSuperpowersPin` giữ mode khi copy (`cpSync`) và đặt lại bit theo danh sách, cho cả cây owner đã mất bit lẫn bản ghim có sẵn bị mất bit (khi đó `changed: true`, checksum vẫn như cũ).
  - Doctor `superpowers-pin` báo `fail` kèm `thiếu bit thực thi: …`; `workflow-check` chặn run.
  - Test mới: giữ và đặt lại bit; cây owner mất bit; doctor `fail` và `warn`; workflow-check chặn.
- **S2:** đầu `installSuperpowersPin` xóa mọi `<dir>.tmp-*` (mọi pid). Test có bản tạm `.tmp-99999`, chạy cả lần cài mới lẫn lần không đổi gì.
- **RED/GREEN:** xem mục "Sửa sau review" của `sp-3-report.md` (cùng lệnh, 4 test pin fail trên `efd03c5`).
