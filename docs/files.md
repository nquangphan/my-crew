# Tra cứu file

File nào thuộc flow nào. Dùng `crew-docs where <file>` để tra từ dòng lệnh.

<!-- crew-docs:files:start -->
> Sinh tự động bởi `crew-docs generate` từ `docs/flows.yaml`. Không sửa tay.

| File | Flows |
|------|-------|
| `apps/crew-mac/src/authorized-keys.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/cli.ts` | [mac-setup](flows/mac-setup.md) (điểm vào) |
| `apps/crew-mac/src/commands/doctor.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/commands/setup.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/commands/status.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/commands/stop-run.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (điểm vào) |
| `apps/crew-mac/src/commands/uninstall.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/commands/workflow-check.ts` | [mac-workflows](flows/mac-workflows.md) (điểm vào) |
| `apps/crew-mac/src/context-factory.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/context.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/fs-util.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/index.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/install-cli.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/launchctl.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/launcher.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/manifest.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/paths.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/plist.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/reaper/process-table.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (file) |
| `apps/crew-mac/src/reaper/reap.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (điểm vào) |
| `apps/crew-mac/src/reaper/run-members.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (file) |
| `apps/crew-mac/src/reaper/select.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (file) |
| `apps/crew-mac/src/reaper/stop.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (file) |
| `apps/crew-mac/src/sshd-config.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/sshd-owner.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/status/app-state.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/status/docs.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/status/report.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/status/sign.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/status/tcc.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/system.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/tailscale.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/workflows/install.ts` | [mac-workflows](flows/mac-workflows.md) (điểm vào) |
| `apps/crew-mac/src/workflows/inventory.ts` | [mac-workflows](flows/mac-workflows.md) (file) |
| `apps/crew-mac/src/workflows/pin.ts` | [mac-workflows](flows/mac-workflows.md) (file) |
| `apps/crew-mac/src/workflows/policy.ts` | [mac-workflows](flows/mac-workflows.md) (file) |
| `apps/crew-mac/src/workflows/run-init.ts` | [mac-workflows](flows/mac-workflows.md) (file) |
| `apps/crew-mac/src/workflows/tree-checksum.ts` | [mac-workflows](flows/mac-workflows.md) (file) |
| `apps/crew-mac/src/wrapper.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/zshenv.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/test/authorized-keys.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/cli.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/crew-claude-run.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/doctor.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/index.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/install-cli.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/launcher.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/reaper-reap.test.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (test) |
| `apps/crew-mac/test/reaper-select.test.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (test) |
| `apps/crew-mac/test/render.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/run-members.test.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (test) |
| `apps/crew-mac/test/setup.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/sshd-owner.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/status-app.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/status-docs.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/status-tcc.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/status.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/stop-run.test.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (test) |
| `apps/crew-mac/test/stop.test.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (test) |
| `apps/crew-mac/test/system-wrappers.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/system.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/uninstall.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/workflow-check.test.ts` | [mac-workflows](flows/mac-workflows.md) (test) |
| `apps/crew-mac/test/workflows-inventory.test.ts` | [mac-workflows](flows/mac-workflows.md) (test) |
| `apps/crew-mac/test/workflows-pin.test.ts` | [mac-workflows](flows/mac-workflows.md) (test) |
| `apps/crew-mac/test/zshenv.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/mac-app/electron-builder.yml` | [mac-app-update](flows/mac-app-update.md) (file) |
| `apps/mac-app/scripts/release-lib.mjs` | [mac-app-update](flows/mac-app-update.md) (file) |
| `apps/mac-app/scripts/release-lib.test.mjs` | [mac-app-update](flows/mac-app-update.md) (test) |
| `apps/mac-app/scripts/release.mjs` | [mac-app-update](flows/mac-app-update.md) (điểm vào), [mac-app-update](flows/mac-app-update.md) (file) |
| `apps/mac-app/src/main/app-context.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/app-log.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/app-state.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/health.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/index.ts` | [mac-app](flows/mac-app.md) (điểm vào), [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/ipc.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/login-item.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/logs.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/notifications.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/ops-bridge.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/paperclip/cli-auth.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (file) |
| `apps/mac-app/src/main/paperclip/client.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (điểm vào) |
| `apps/mac-app/src/main/paperclip/keychain.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (file) |
| `apps/mac-app/src/main/paperclip/register.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (điểm vào) |
| `apps/mac-app/src/main/paperclip/types.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (file) |
| `apps/mac-app/src/main/projects/add-project.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (điểm vào) |
| `apps/mac-app/src/main/projects/folder.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (file) |
| `apps/mac-app/src/main/projects/instructions.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (file) |
| `apps/mac-app/src/main/projects/ipc.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (file) |
| `apps/mac-app/src/main/projects/progress.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (file) |
| `apps/mac-app/src/main/projects/register.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (file) |
| `apps/mac-app/src/main/projects/remove-project.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (điểm vào) |
| `apps/mac-app/src/main/projects/templates/assistant.md` | [mac-app-paperclip](flows/mac-app-paperclip.md) (file) |
| `apps/mac-app/src/main/projects/templates/executor.md` | [mac-app-paperclip](flows/mac-app-paperclip.md) (file) |
| `apps/mac-app/src/main/projects/templates/integrator.md` | [mac-app-paperclip](flows/mac-app-paperclip.md) (file) |
| `apps/mac-app/src/main/projects/templates/reviewer.md` | [mac-app-paperclip](flows/mac-app-paperclip.md) (file) |
| `apps/mac-app/src/main/quit-guard.ts` | [mac-app-sshd](flows/mac-app-sshd.md) (file) |
| `apps/mac-app/src/main/register-health.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/runs.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/setup/disk-access.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/setup/import-existing.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/setup/machine-check.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/setup/machine-step.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/setup/register.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/setup/sshd-handoff.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/setup/types.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/setup/v2-removal.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/setup/wizard.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/sshd/active-runs.ts` | [mac-app-sshd](flows/mac-app-sshd.md) (file) |
| `apps/mac-app/src/main/sshd/backoff.ts` | [mac-app-sshd](flows/mac-app-sshd.md) (file) |
| `apps/mac-app/src/main/sshd/register.ts` | [mac-app-sshd](flows/mac-app-sshd.md) (điểm vào), [mac-app-sshd](flows/mac-app-sshd.md) (file) |
| `apps/mac-app/src/main/sshd/supervisor.ts` | [mac-app-sshd](flows/mac-app-sshd.md) (file) |
| `apps/mac-app/src/main/sshd/system-deps.ts` | [mac-app-sshd](flows/mac-app-sshd.md) (file) |
| `apps/mac-app/src/main/sshd/takeover.ts` | [mac-app-sshd](flows/mac-app-sshd.md) (file) |
| `apps/mac-app/src/main/tray-state.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/tray.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/main/update/drain.ts` | [mac-app-update](flows/mac-app-update.md) (file) |
| `apps/mac-app/src/main/update/probation.ts` | [mac-app-update](flows/mac-app-update.md) (file) |
| `apps/mac-app/src/main/update/register.ts` | [mac-app-update](flows/mac-app-update.md) (điểm vào), [mac-app-update](flows/mac-app-update.md) (file) |
| `apps/mac-app/src/main/update/rollback-helper.sh` | [mac-app-update](flows/mac-app-update.md) (file) |
| `apps/mac-app/src/main/update/rollback.ts` | [mac-app-update](flows/mac-app-update.md) (file) |
| `apps/mac-app/src/main/update/updater.ts` | [mac-app-update](flows/mac-app-update.md) (file) |
| `apps/mac-app/src/main/update/versions.ts` | [mac-app-update](flows/mac-app-update.md) (file) |
| `apps/mac-app/src/main/window.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/preload/index.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/renderer/app.tsx` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/renderer/components/check-row.tsx` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/renderer/components/ui.tsx` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/renderer/components/wizard-step.tsx` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/renderer/index.html` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/renderer/lib/ipc.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/renderer/main.tsx` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/renderer/routes/health.tsx` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/renderer/routes/logs.tsx` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/renderer/routes/projects.tsx` | [mac-app-paperclip](flows/mac-app-paperclip.md) (điểm vào) |
| `apps/mac-app/src/renderer/routes/runs.tsx` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/renderer/routes/setup.tsx` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/renderer/routes/update.tsx` | [mac-app-update](flows/mac-app-update.md) (file) |
| `apps/mac-app/src/renderer/styles.css` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/shared/ipc-contract.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/src/utility/ops.ts` | [mac-app](flows/mac-app.md) (file) |
| `apps/mac-app/test/app-log.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/app-state.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/health.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/ipc-contract.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/logs.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/main-startup-order.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/notifications.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/ops-bridge.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/paperclip-cli-auth.test.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (test) |
| `apps/mac-app/test/paperclip-client.test.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (test) |
| `apps/mac-app/test/paperclip-fake-server.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (test) |
| `apps/mac-app/test/paperclip-keychain.test.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (test) |
| `apps/mac-app/test/projects-add.test.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (test) |
| `apps/mac-app/test/projects-fixture.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (test) |
| `apps/mac-app/test/projects-folder.test.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (test) |
| `apps/mac-app/test/projects-instructions.test.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (test) |
| `apps/mac-app/test/projects-ipc.test.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (test) |
| `apps/mac-app/test/projects-remove.test.ts` | [mac-app-paperclip](flows/mac-app-paperclip.md) (test) |
| `apps/mac-app/test/quit-guard.test.ts` | [mac-app-sshd](flows/mac-app-sshd.md) (test) |
| `apps/mac-app/test/renderer/app.test.tsx` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/renderer/health.test.tsx` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/renderer/projects.test.tsx` | [mac-app-paperclip](flows/mac-app-paperclip.md) (test) |
| `apps/mac-app/test/renderer/setup.test.tsx` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/renderer/update.test.tsx` | [mac-app-update](flows/mac-app-update.md) (test) |
| `apps/mac-app/test/runs.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/setup-disk-access.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/setup-fakes.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/setup-import.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/setup-sshd-handoff.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/setup-wizard.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/sshd-backoff.test.ts` | [mac-app-sshd](flows/mac-app-sshd.md) (test) |
| `apps/mac-app/test/sshd-supervisor.test.ts` | [mac-app-sshd](flows/mac-app-sshd.md) (test) |
| `apps/mac-app/test/sshd-system-deps.test.ts` | [mac-app-sshd](flows/mac-app-sshd.md) (test) |
| `apps/mac-app/test/sshd-takeover.test.ts` | [mac-app-sshd](flows/mac-app-sshd.md) (test) |
| `apps/mac-app/test/tray-state.test.ts` | [mac-app](flows/mac-app.md) (test) |
| `apps/mac-app/test/update-drain.test.ts` | [mac-app-update](flows/mac-app-update.md) (test) |
| `apps/mac-app/test/update-probation.test.ts` | [mac-app-update](flows/mac-app-update.md) (test) |
| `apps/mac-app/test/update-rollback.test.ts` | [mac-app-update](flows/mac-app-update.md) (test) |
| `apps/mac-app/test/update-updater.test.ts` | [mac-app-update](flows/mac-app-update.md) (test) |
| `apps/mac-app/test/update-versions.test.ts` | [mac-app-update](flows/mac-app-update.md) (test) |
| `packages/docs-kit/src/bin.ts` | [docs-check](flows/docs-check.md) (điểm vào) |
| `packages/docs-kit/src/cli.ts` | [docs-check](flows/docs-check.md) (điểm vào) |
| `packages/docs-kit/src/commands/check.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/commands/ci-workflow.ts` | [docs-hooks](flows/docs-hooks.md) (điểm vào) |
| `packages/docs-kit/src/commands/flow.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/commands/generate.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/commands/init.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/commands/install-hooks.ts` | [docs-hooks](flows/docs-hooks.md) (điểm vào) |
| `packages/docs-kit/src/commands/io.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/commands/lookup.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/commands/where.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/flows-schema.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/generate.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/git.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/hook-installer.ts` | [docs-hooks](flows/docs-hooks.md) (file) |
| `packages/docs-kit/src/manifest.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/raw-imports.d.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/rules/r1-manifest.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/rules/r2-coverage.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/rules/r3-freshness.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/rules/r4-generated.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/rules/r5-initialized.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/rules/r6-protected.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/rules/r7-secrets.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/rules/types.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/secret-scan.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/templates.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/tree.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/src/version.ts` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/templates/AGENTS.md` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/templates/architecture.md` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/templates/crew-docs.yml` | [docs-hooks](flows/docs-hooks.md) (file) |
| `packages/docs-kit/templates/flow.md` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/templates/flows.yaml` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/templates/index.md` | [docs-check](flows/docs-check.md) (file) |
| `packages/docs-kit/test/flows-schema.test.ts` | [docs-check](flows/docs-check.md) (test) |
| `packages/docs-kit/test/hook-installer.test.ts` | [docs-hooks](flows/docs-hooks.md) (test) |
| `packages/docs-kit/test/rules.test.ts` | [docs-check](flows/docs-check.md) (test) |
<!-- crew-docs:files:end -->
