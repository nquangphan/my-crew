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
