# Tra cứu file

File nào thuộc flow nào. Dùng `crew-docs where <file>` để tra từ dòng lệnh.

<!-- crew-docs:files:start -->
> Sinh tự động bởi `crew-docs generate` từ `docs/flows.yaml`. Không sửa tay.

| File | Flows |
|------|-------|
| `.dockerignore` | [deployment](flows/deployment.md) (file) |
| `.github/workflows/ci.yml` | [deployment](flows/deployment.md) (file) |
| `apps/api/drizzle/0000_init.sql` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/drizzle/0001_machine_auth_and_delivery.sql` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/drizzle/0002_docs_snapshots.sql` | [docs-sync-viewer](flows/docs-sync-viewer.md) (file) |
| `apps/api/drizzle/0003_project_changes_and_notice_reads.sql` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/drizzle/0004_project_change_withdrawn.sql` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/drizzle/0005_machine_job_activity.sql` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/drizzle/0006_pm_complexity_reason.sql` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/drizzle/0007_project_bmad_profile.sql` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/drizzle/0008_server_settings_and_machine_commands.sql` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/drizzle/0009_runtime_releases.sql` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/drizzle/0010_attachments.sql` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/drizzle/0011_attachments_nullable_ticket_id.sql` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/drizzle/0012_qc_test_plan.sql` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/src/app.ts` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/src/auth/csrf.ts` | [owner-auth](flows/owner-auth.md) (file) |
| `apps/api/src/auth/machine-auth.ts` | [machine-pairing](flows/machine-pairing.md) (file) |
| `apps/api/src/auth/owner-auth.ts` | [owner-auth](flows/owner-auth.md) (file) |
| `apps/api/src/auth/password.ts` | [owner-auth](flows/owner-auth.md) (file) |
| `apps/api/src/cli/seed-owner.ts` | [owner-auth](flows/owner-auth.md) (file) |
| `apps/api/src/config.ts` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/src/db/client.ts` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/src/db/migrate.ts` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/src/db/schema.ts` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/src/errors.ts` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/src/index.ts` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/src/jobs/heartbeat-sweeper.ts` | [machine-pairing](flows/machine-pairing.md) (file) |
| `apps/api/src/jobs/runtime-import.ts` | [runtime-updates](flows/runtime-updates.md) (file) |
| `apps/api/src/jobs/stuck-ticket-alarm.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (file) |
| `apps/api/src/realtime/event-bus.ts` | [event-delivery](flows/event-delivery.md) (file) |
| `apps/api/src/realtime/sse.ts` | [event-delivery](flows/event-delivery.md) (file) |
| `apps/api/src/routes/attachment-routes.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (điểm vào) |
| `apps/api/src/routes/auth-routes.ts` | [owner-auth](flows/owner-auth.md) (điểm vào) |
| `apps/api/src/routes/bmad-profile-routes.ts` | [daemon-api](flows/daemon-api.md) (file) |
| `apps/api/src/routes/comment-routes.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (điểm vào) |
| `apps/api/src/routes/daemon-routes.ts` | [daemon-api](flows/daemon-api.md) (điểm vào) |
| `apps/api/src/routes/docs-routes.ts` | [docs-sync-viewer](flows/docs-sync-viewer.md) (điểm vào) |
| `apps/api/src/routes/machine-command-routes.ts` | [machine-control](flows/machine-control.md) (điểm vào) |
| `apps/api/src/routes/machine-routes.ts` | [machine-pairing](flows/machine-pairing.md) (điểm vào) |
| `apps/api/src/routes/project-routes.ts` | [project-claims](flows/project-claims.md) (điểm vào) |
| `apps/api/src/routes/report-routes.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (điểm vào) |
| `apps/api/src/routes/route-deps.ts` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/src/routes/runtime-routes.ts` | [runtime-updates](flows/runtime-updates.md) (điểm vào) |
| `apps/api/src/routes/settings-routes.ts` | [server-settings](flows/server-settings.md) (điểm vào) |
| `apps/api/src/routes/stream-routes.ts` | [event-delivery](flows/event-delivery.md) (điểm vào) |
| `apps/api/src/routes/ticket-routes.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (điểm vào) |
| `apps/api/src/server.ts` | [api-platform](flows/api-platform.md) (điểm vào) |
| `apps/api/src/services/agent-activity-service.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (file) |
| `apps/api/src/services/attachment-service.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (file) |
| `apps/api/src/services/bmad-profile-service.ts` | [project-claims](flows/project-claims.md) (file) |
| `apps/api/src/services/budget-service.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (file) |
| `apps/api/src/services/claim-service.ts` | [project-claims](flows/project-claims.md) (file) |
| `apps/api/src/services/docs-service.ts` | [docs-sync-viewer](flows/docs-sync-viewer.md) (file) |
| `apps/api/src/services/event-service.ts` | [event-delivery](flows/event-delivery.md) (file) |
| `apps/api/src/services/idempotency.ts` | [daemon-api](flows/daemon-api.md) (file) |
| `apps/api/src/services/like-pattern.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (dùng chung), [docs-sync-viewer](flows/docs-sync-viewer.md) (dùng chung) |
| `apps/api/src/services/machine-command-service.ts` | [machine-control](flows/machine-control.md) (file) |
| `apps/api/src/services/machine-service.ts` | [machine-pairing](flows/machine-pairing.md) (file) |
| `apps/api/src/services/notice-read-service.ts` | [event-delivery](flows/event-delivery.md) (file) |
| `apps/api/src/services/pg-errors.ts` | [api-platform](flows/api-platform.md) (file) |
| `apps/api/src/services/project-change-service.ts` | [project-claims](flows/project-claims.md) (file) |
| `apps/api/src/services/project-service.ts` | [project-claims](flows/project-claims.md) (file) |
| `apps/api/src/services/report-service.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (file) |
| `apps/api/src/services/runtime-service.ts` | [runtime-updates](flows/runtime-updates.md) (file) |
| `apps/api/src/services/settings-service.ts` | [server-settings](flows/server-settings.md) (file) |
| `apps/api/src/services/ticket-query-service.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (file) |
| `apps/api/src/services/ticket-service.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (file) |
| `apps/api/test/agent-activity.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `apps/api/test/attachment.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `apps/api/test/auth.test.ts` | [owner-auth](flows/owner-auth.md) (test) |
| `apps/api/test/bmad-profile.test.ts` | [project-claims](flows/project-claims.md) (test) |
| `apps/api/test/budget.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `apps/api/test/bug-loop.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `apps/api/test/claims.test.ts` | [project-claims](flows/project-claims.md) (test) |
| `apps/api/test/cross-project-tickets.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `apps/api/test/csrf.test.ts` | [owner-auth](flows/owner-auth.md) (test) |
| `apps/api/test/daemon-stream.test.ts` | [event-delivery](flows/event-delivery.md) (test) |
| `apps/api/test/docs-overview.test.ts` | [docs-sync-viewer](flows/docs-sync-viewer.md) (test) |
| `apps/api/test/docs-sync.test.ts` | [docs-sync-viewer](flows/docs-sync-viewer.md) (test) |
| `apps/api/test/idempotency.test.ts` | [daemon-api](flows/daemon-api.md) (test) |
| `apps/api/test/lifecycle-effects.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `apps/api/test/machine-commands.test.ts` | [machine-control](flows/machine-control.md) (test) |
| `apps/api/test/machine-scope.test.ts` | [daemon-api](flows/daemon-api.md) (test) |
| `apps/api/test/owner-web-support.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `apps/api/test/pairing.test.ts` | [machine-pairing](flows/machine-pairing.md) (test) |
| `apps/api/test/password-change.test.ts` | [owner-auth](flows/owner-auth.md) (test) |
| `apps/api/test/pm-mention.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `apps/api/test/project-changes.test.ts` | [project-claims](flows/project-claims.md) (test) |
| `apps/api/test/rate-subtask.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `apps/api/test/revoke-stream.test.ts` | [event-delivery](flows/event-delivery.md) (test) |
| `apps/api/test/runtime.test.ts` | [runtime-updates](flows/runtime-updates.md) (test) |
| `apps/api/test/settings.test.ts` | [server-settings](flows/server-settings.md) (test) |
| `apps/api/test/shutdown.test.ts` | [api-platform](flows/api-platform.md) (test) |
| `apps/api/test/stuck-ticket-alarm.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `apps/api/test/sweeper.test.ts` | [machine-pairing](flows/machine-pairing.md) (test) |
| `apps/api/test/ticket-service.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `apps/api/test/transition.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `apps/crew-mac/src/authorized-keys.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/cli.ts` | [mac-setup](flows/mac-setup.md) (điểm vào) |
| `apps/crew-mac/src/commands/doctor.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/commands/setup.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/commands/status.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/commands/stop-run.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (điểm vào) |
| `apps/crew-mac/src/commands/uninstall.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/commands/workflow-check.ts` | [mac-workflows](flows/mac-workflows.md) (điểm vào) |
| `apps/crew-mac/src/context.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/fs-util.ts` | [mac-setup](flows/mac-setup.md) (file) |
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
| `apps/crew-mac/src/status/docs.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/status/report.ts` | [mac-setup](flows/mac-setup.md) (file) |
| `apps/crew-mac/src/status/sign.ts` | [mac-setup](flows/mac-setup.md) (file) |
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
| `apps/crew-mac/test/launcher.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/reaper-reap.test.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (test) |
| `apps/crew-mac/test/reaper-select.test.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (test) |
| `apps/crew-mac/test/render.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/run-members.test.ts` | [mac-orphan-reaper](flows/mac-orphan-reaper.md) (test) |
| `apps/crew-mac/test/setup.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
| `apps/crew-mac/test/status-docs.test.ts` | [mac-setup](flows/mac-setup.md) (test) |
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
| `apps/daemon/src/api/vps-client.ts` | [daemon-runtime](flows/daemon-runtime.md) (file) |
| `apps/daemon/src/cli.ts` | [daemon-runtime](flows/daemon-runtime.md) (điểm vào) |
| `apps/daemon/src/commands/doctor.ts` | [daemon-health](flows/daemon-health.md) (điểm vào) |
| `apps/daemon/src/config.ts` | [daemon-runtime](flows/daemon-runtime.md) (file) |
| `apps/daemon/src/daemon.ts` | [daemon-runtime](flows/daemon-runtime.md) (điểm vào) |
| `apps/daemon/src/git/docs-kit-bridge.ts` | [agent-workspace](flows/agent-workspace.md) (file) |
| `apps/daemon/src/git/probe-worktree.ts` | [agent-workspace](flows/agent-workspace.md) (file) |
| `apps/daemon/src/git/worktree-manager.ts` | [agent-workspace](flows/agent-workspace.md) (điểm vào) |
| `apps/daemon/src/health/checks/app.ts` | [daemon-health](flows/daemon-health.md) (file) |
| `apps/daemon/src/health/checks/claude.ts` | [daemon-health](flows/daemon-health.md) (file) |
| `apps/daemon/src/health/checks/machine.ts` | [daemon-health](flows/daemon-health.md) (file) |
| `apps/daemon/src/health/checks/mcp.ts` | [daemon-health](flows/daemon-health.md) (file) |
| `apps/daemon/src/health/checks/repos.ts` | [daemon-health](flows/daemon-health.md) (file) |
| `apps/daemon/src/health/checks/resources.ts` | [daemon-health](flows/daemon-health.md) (file) |
| `apps/daemon/src/health/checks/server.ts` | [daemon-health](flows/daemon-health.md) (file) |
| `apps/daemon/src/health/checks/skills.ts` | [daemon-health](flows/daemon-health.md) (file) |
| `apps/daemon/src/health/health-runner.ts` | [daemon-health](flows/daemon-health.md) (file) |
| `apps/daemon/src/health/project-views.ts` | [daemon-health](flows/daemon-health.md) (file) |
| `apps/daemon/src/health/repo-probe.ts` | [daemon-health](flows/daemon-health.md) (file) |
| `apps/daemon/src/health/types.ts` | [daemon-health](flows/daemon-health.md) (file) |
| `apps/daemon/src/library.ts` | [daemon-runtime](flows/daemon-runtime.md) (file) |
| `apps/daemon/src/remote/machine-commands.ts` | [machine-control](flows/machine-control.md) (file) |
| `apps/daemon/src/roles/docs-first-check.ts` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/docs-init-gate.ts` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/docs-update-handoff.ts` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/failure-policy.ts` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/merge-policy.ts` | [local-merge](flows/local-merge.md) (điểm vào) |
| `apps/daemon/src/roles/model-policy.ts` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/prompt-templates.ts` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/prompts/_capability-preflight.md` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/prompts/_shared-rules.md` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/prompts/assistant-close.md` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/prompts/assistant-triage.md` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/prompts/dev.md` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/prompts/docs-init.md` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/prompts/docs-update.md` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/prompts/pm-accept.md` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/prompts/pm-analyze.md` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/prompts/pm-monitor.md` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/prompts/qc.md` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/role-planner.ts` | [agent-roles](flows/agent-roles.md) (điểm vào) |
| `apps/daemon/src/roles/role-registry.ts` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/skill-enforcement.ts` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/untrusted-wrap.ts` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/roles/workspace-prep.ts` | [agent-roles](flows/agent-roles.md) (file) |
| `apps/daemon/src/runner/agent-runner.ts` | [agent-runs](flows/agent-runs.md) (file) |
| `apps/daemon/src/runner/background-session.ts` | [agent-runs](flows/agent-runs.md) (file) |
| `apps/daemon/src/runner/guard-hook.ts` | [agent-runs](flows/agent-runs.md) (file) |
| `apps/daemon/src/runner/job-cleanup.ts` | [resource-hygiene](flows/resource-hygiene.md) (điểm vào) |
| `apps/daemon/src/runner/job-runner.ts` | [agent-runs](flows/agent-runs.md) (điểm vào) |
| `apps/daemon/src/runner/resource-report.ts` | [resource-hygiene](flows/resource-hygiene.md) (file) |
| `apps/daemon/src/runner/resource-tracker.ts` | [resource-hygiene](flows/resource-hygiene.md) (file) |
| `apps/daemon/src/runner/retry-classifier.ts` | [agent-runs](flows/agent-runs.md) (file) |
| `apps/daemon/src/runner/run-trace.ts` | [agent-runs](flows/agent-runs.md) (file) |
| `apps/daemon/src/runner/scripted-runner.ts` | [agent-runs](flows/agent-runs.md) (file) |
| `apps/daemon/src/runner/secret-scrubber.ts` | [agent-runs](flows/agent-runs.md) (file) |
| `apps/daemon/src/runner/skill-usage.ts` | [agent-runs](flows/agent-runs.md) (file) |
| `apps/daemon/src/runner/ticket-images.ts` | [agent-runs](flows/agent-runs.md) (file) |
| `apps/daemon/src/scheduler/resource-monitor.ts` | [daemon-scheduling](flows/daemon-scheduling.md) (file) |
| `apps/daemon/src/scheduler/scheduler.ts` | [daemon-scheduling](flows/daemon-scheduling.md) (file) |
| `apps/daemon/src/secrets.ts` | [daemon-runtime](flows/daemon-runtime.md) (file) |
| `apps/daemon/src/service/systemd.ts` | [daemon-runtime](flows/daemon-runtime.md) (file) |
| `apps/daemon/src/settings/settings-store.ts` | [server-settings](flows/server-settings.md) (file) |
| `apps/daemon/src/skills/bmad-profile.ts` | [agent-workspace](flows/agent-workspace.md) (file) |
| `apps/daemon/src/skills/skill-inventory.ts` | [agent-workspace](flows/agent-workspace.md) (file) |
| `apps/daemon/src/state-db.ts` | [daemon-runtime](flows/daemon-runtime.md) (file) |
| `apps/daemon/src/stream/dispatcher.ts` | [daemon-scheduling](flows/daemon-scheduling.md) (file) |
| `apps/daemon/src/stream/stream-client.ts` | [daemon-scheduling](flows/daemon-scheduling.md) (điểm vào) |
| `apps/daemon/src/tools/ticket-mcp-server.ts` | [agent-runs](flows/agent-runs.md) (file) |
| `apps/daemon/src/tools/tool-scopes.ts` | [agent-runs](flows/agent-runs.md) (file) |
| `apps/daemon/test/agent-runner.test.ts` | [agent-runs](flows/agent-runs.md) (test) |
| `apps/daemon/test/background-session.test.ts` | [agent-runs](flows/agent-runs.md) (test) |
| `apps/daemon/test/bmad-profile.test.ts` | [agent-workspace](flows/agent-workspace.md) (test) |
| `apps/daemon/test/cli.test.ts` | [daemon-runtime](flows/daemon-runtime.md) (test) |
| `apps/daemon/test/daemon-extras.test.ts` | [daemon-runtime](flows/daemon-runtime.md) (test) |
| `apps/daemon/test/daemon.test.ts` | [agent-runs](flows/agent-runs.md) (test) |
| `apps/daemon/test/dispatcher.test.ts` | [daemon-scheduling](flows/daemon-scheduling.md) (test) |
| `apps/daemon/test/docs-first-check.test.ts` | [agent-roles](flows/agent-roles.md) (test) |
| `apps/daemon/test/docs-init-gate.test.ts` | [agent-roles](flows/agent-roles.md) (test) |
| `apps/daemon/test/docs-update-handoff.test.ts` | [agent-roles](flows/agent-roles.md) (test) |
| `apps/daemon/test/guard-hook.test.ts` | [agent-runs](flows/agent-runs.md) (test) |
| `apps/daemon/test/health-checks.test.ts` | [daemon-health](flows/daemon-health.md) (test) |
| `apps/daemon/test/health-groups.test.ts` | [daemon-health](flows/daemon-health.md) (test) |
| `apps/daemon/test/lifecycle.test.ts` | [agent-roles](flows/agent-roles.md) (test) |
| `apps/daemon/test/live-smoke.test.ts` | [agent-runs](flows/agent-runs.md) (test) |
| `apps/daemon/test/live-workflow.test.ts` | [agent-roles](flows/agent-roles.md) (test) |
| `apps/daemon/test/machine-commands.test.ts` | [machine-control](flows/machine-control.md) (test) |
| `apps/daemon/test/merge-policy.test.ts` | [local-merge](flows/local-merge.md) (test) |
| `apps/daemon/test/model-policy.test.ts` | [agent-roles](flows/agent-roles.md) (test) |
| `apps/daemon/test/pm-mention.test.ts` | [agent-roles](flows/agent-roles.md) (test) |
| `apps/daemon/test/probe-worktree.test.ts` | [agent-workspace](flows/agent-workspace.md) (test) |
| `apps/daemon/test/resources.test.ts` | [resource-hygiene](flows/resource-hygiene.md) (test) |
| `apps/daemon/test/role-contracts.test.ts` | [agent-roles](flows/agent-roles.md) (test) |
| `apps/daemon/test/role-policies.test.ts` | [agent-roles](flows/agent-roles.md) (test) |
| `apps/daemon/test/run-trace.test.ts` | [agent-runs](flows/agent-runs.md) (test) |
| `apps/daemon/test/scheduler.test.ts` | [daemon-scheduling](flows/daemon-scheduling.md) (test) |
| `apps/daemon/test/settings.test.ts` | [server-settings](flows/server-settings.md) (test) |
| `apps/daemon/test/skill-enforcement.test.ts` | [agent-roles](flows/agent-roles.md) (test) |
| `apps/daemon/test/skill-inventory.test.ts` | [agent-workspace](flows/agent-workspace.md) (test) |
| `apps/daemon/test/stream-atomicity.test.ts` | [daemon-scheduling](flows/daemon-scheduling.md) (test) |
| `apps/daemon/test/stream-client.test.ts` | [daemon-scheduling](flows/daemon-scheduling.md) (test) |
| `apps/daemon/test/test-cleanup.test.ts` | [daemon-runtime](flows/daemon-runtime.md) (test) |
| `apps/daemon/test/ticket-images.test.ts` | [agent-runs](flows/agent-runs.md) (test) |
| `apps/daemon/test/ticket-tools.test.ts` | [agent-runs](flows/agent-runs.md) (test) |
| `apps/daemon/test/units.test.ts` | [daemon-runtime](flows/daemon-runtime.md) (test) |
| `apps/daemon/test/worktree-manager.test.ts` | [agent-workspace](flows/agent-workspace.md) (test) |
| `apps/desktop/electron.vite.config.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/electron.vite.host.config.ts` | [runtime-updates](flows/runtime-updates.md) (file) |
| `apps/desktop/src/daemon-host/activity.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/daemon-host/bmad-install.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/daemon-host/folder-access.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/daemon-host/health-ops.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/daemon-host/host-context.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/daemon-host/host-main.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/daemon-host/host-service.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/daemon-host/index.ts` | [desktop-app](flows/desktop-app.md) (điểm vào) |
| `apps/desktop/src/daemon-host/setup-ops.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/daemon-host/test-seams.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/main/app-log.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/main/daemon-supervisor.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/main/desktop-state.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/main/full-disk-access.ts` | [runtime-updates](flows/runtime-updates.md) (file) |
| `apps/desktop/src/main/index.ts` | [desktop-app](flows/desktop-app.md) (điểm vào) |
| `apps/desktop/src/main/ipc-handlers.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/main/login-item.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/main/notifications.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/main/quit-guard.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/main/runtime-archive.ts` | [runtime-updates](flows/runtime-updates.md) (file) |
| `apps/desktop/src/main/runtime-manager.ts` | [runtime-updates](flows/runtime-updates.md) (điểm vào) |
| `apps/desktop/src/main/runtime-store.ts` | [runtime-updates](flows/runtime-updates.md) (file) |
| `apps/desktop/src/main/runtime-verify.ts` | [runtime-updates](flows/runtime-updates.md) (file) |
| `apps/desktop/src/main/shell-env.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/main/terminal-launcher.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/main/tray-view.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/main/tray.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/main/updater.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/main/window.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/preload/index.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `apps/desktop/src/renderer/app.tsx` | [desktop-ui](flows/desktop-ui.md) (điểm vào) |
| `apps/desktop/src/renderer/components/folder-picker.tsx` | [desktop-ui](flows/desktop-ui.md) (file) |
| `apps/desktop/src/renderer/components/full-disk-access.tsx` | [desktop-ui](flows/desktop-ui.md) (file) |
| `apps/desktop/src/renderer/components/health-check-row.tsx` | [desktop-ui](flows/desktop-ui.md) (file) |
| `apps/desktop/src/renderer/components/ui.tsx` | [desktop-ui](flows/desktop-ui.md) (file) |
| `apps/desktop/src/renderer/components/wizard-step.tsx` | [desktop-ui](flows/desktop-ui.md) (file) |
| `apps/desktop/src/renderer/index.html` | [desktop-ui](flows/desktop-ui.md) (file) |
| `apps/desktop/src/renderer/lib/format.ts` | [desktop-ui](flows/desktop-ui.md) (file) |
| `apps/desktop/src/renderer/lib/ipc.ts` | [desktop-ui](flows/desktop-ui.md) (file) |
| `apps/desktop/src/renderer/main.tsx` | [desktop-ui](flows/desktop-ui.md) (điểm vào) |
| `apps/desktop/src/renderer/routes/setup-wizard.tsx` | [desktop-ui](flows/desktop-ui.md) (file) |
| `apps/desktop/src/renderer/routes/status.tsx` | [desktop-ui](flows/desktop-ui.md) (file) |
| `apps/desktop/src/renderer/styles.css` | [desktop-ui](flows/desktop-ui.md) (file) |
| `apps/desktop/test/app-log.test.ts` | [desktop-app](flows/desktop-app.md) (test) |
| `apps/desktop/test/bmad-install.test.ts` | [desktop-app](flows/desktop-app.md) (test) |
| `apps/desktop/test/codesign.test.ts` | [runtime-updates](flows/runtime-updates.md) (test) |
| `apps/desktop/test/daemon-supervisor.test.ts` | [desktop-app](flows/desktop-app.md) (test) |
| `apps/desktop/test/e2e/health.spec.ts` | [desktop-app](flows/desktop-app.md) (test) |
| `apps/desktop/test/e2e/onboarding.spec.ts` | [desktop-ui](flows/desktop-ui.md) (test) |
| `apps/desktop/test/e2e/project-bmad.spec.ts` | [desktop-ui](flows/desktop-ui.md) (test) |
| `apps/desktop/test/e2e/runtime-update.spec.ts` | [runtime-updates](flows/runtime-updates.md) (test) |
| `apps/desktop/test/folder-access.test.ts` | [desktop-app](flows/desktop-app.md) (test) |
| `apps/desktop/test/full-disk-access.test.ts` | [runtime-updates](flows/runtime-updates.md) (test) |
| `apps/desktop/test/host-service.test.ts` | [desktop-app](flows/desktop-app.md) (test) |
| `apps/desktop/test/main-logic.test.ts` | [desktop-app](flows/desktop-app.md) (test) |
| `apps/desktop/test/role-prompts-bundle.test.ts` | [desktop-app](flows/desktop-app.md) (test) |
| `apps/desktop/test/runtime-update.test.ts` | [runtime-updates](flows/runtime-updates.md) (test) |
| `apps/web/e2e/account-password.spec.ts` | [owner-auth](flows/owner-auth.md) (test) |
| `apps/web/e2e/agent-activity.spec.ts` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/e2e/core-flows.spec.ts` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/e2e/cross-project-views.spec.ts` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/e2e/docs-across-projects.spec.ts` | [docs-sync-viewer](flows/docs-sync-viewer.md) (test) |
| `apps/web/e2e/docs-space.spec.ts` | [docs-sync-viewer](flows/docs-sync-viewer.md) (test) |
| `apps/web/e2e/owner-admin.spec.ts` | [web-admin](flows/web-admin.md) (test) |
| `apps/web/e2e/pm-mention.spec.ts` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/e2e/system-settings.spec.ts` | [server-settings](flows/server-settings.md) (test) |
| `apps/web/src/components/agent-activity.test.tsx` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/src/components/agent-activity.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/board-view.test.ts` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/src/components/board-view.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/cancel-dialog.test.tsx` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/src/components/cancel-dialog.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/comment-thread.test.tsx` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/src/components/comment-thread.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/confirm-dialog.tsx` | [web-admin](flows/web-admin.md) (file) |
| `apps/web/src/components/details-box.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/docs-page-tree.tsx` | [docs-sync-viewer](flows/docs-sync-viewer.md) (file) |
| `apps/web/src/components/docs-page-view.tsx` | [docs-sync-viewer](flows/docs-sync-viewer.md) (file) |
| `apps/web/src/components/docs-project-switcher.test.tsx` | [docs-sync-viewer](flows/docs-sync-viewer.md) (test) |
| `apps/web/src/components/docs-project-switcher.tsx` | [docs-sync-viewer](flows/docs-sync-viewer.md) (file) |
| `apps/web/src/components/docs-toc.tsx` | [docs-sync-viewer](flows/docs-sync-viewer.md) (file) |
| `apps/web/src/components/event-timeline.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/file-lookup.tsx` | [docs-sync-viewer](flows/docs-sync-viewer.md) (file) |
| `apps/web/src/components/filter-menu.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/flow-view.tsx` | [docs-sync-viewer](flows/docs-sync-viewer.md) (file) |
| `apps/web/src/components/issue-table.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/machine-control.test.tsx` | [machine-control](flows/machine-control.md) (test) |
| `apps/web/src/components/machine-control.tsx` | [machine-control](flows/machine-control.md) (điểm vào) |
| `apps/web/src/components/machine-runtime.tsx` | [runtime-updates](flows/runtime-updates.md) (file) |
| `apps/web/src/components/markdown-editor.test.tsx` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/src/components/markdown-editor.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/markdown-view.test.tsx` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/src/components/markdown-view.tsx` | [web-tickets](flows/web-tickets.md) (dùng chung), [docs-sync-viewer](flows/docs-sync-viewer.md) (dùng chung) |
| `apps/web/src/components/model-settings-form.tsx` | [server-settings](flows/server-settings.md) (file) |
| `apps/web/src/components/new-ticket-dialog.test.tsx` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/src/components/new-ticket-dialog.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/pairing-dialog.test.tsx` | [web-admin](flows/web-admin.md) (test) |
| `apps/web/src/components/pairing-dialog.tsx` | [web-admin](flows/web-admin.md) (file) |
| `apps/web/src/components/project-badge.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/project-filter.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/project-form.tsx` | [web-admin](flows/web-admin.md) (file) |
| `apps/web/src/components/related-tickets.tsx` | [docs-sync-viewer](flows/docs-sync-viewer.md) (file) |
| `apps/web/src/components/report-panel.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/role-avatar.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/setting-editor.tsx` | [server-settings](flows/server-settings.md) (file) |
| `apps/web/src/components/status-dropdown.test.tsx` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/src/components/status-dropdown.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/status-lozenge.tsx` | [web-tickets](flows/web-tickets.md) (dùng chung), [docs-sync-viewer](flows/docs-sync-viewer.md) (dùng chung) |
| `apps/web/src/components/subtask-tree.test.tsx` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/src/components/subtask-tree.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/ticket-card.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/ticket-side-panel.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/ticket-tree.test.tsx` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/src/components/ticket-tree.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/ticket-view.test.tsx` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/src/components/ticket-view.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/type-icon.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/components/ui/button.tsx` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/components/ui/dialog.tsx` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/components/ui/dropdown-menu.tsx` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/components/ui/field.tsx` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/components/ui/info-tip.tsx` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/components/ui/tabs.tsx` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/components/ui/toast.tsx` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/layout/app-shell.tsx` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/layout/breadcrumbs.tsx` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/layout/project-sidebar.test.tsx` | [web-shell](flows/web-shell.md) (test) |
| `apps/web/src/layout/project-sidebar.tsx` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/layout/quick-search.test.tsx` | [web-shell](flows/web-shell.md) (test) |
| `apps/web/src/layout/quick-search.tsx` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/layout/shell-context.ts` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/lib/api-client.test.ts` | [web-shell](flows/web-shell.md) (test) |
| `apps/web/src/lib/api-client.ts` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/lib/cn.ts` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/lib/docs-links.ts` | [docs-sync-viewer](flows/docs-sync-viewer.md) (file) |
| `apps/web/src/lib/docs-space.test.ts` | [docs-sync-viewer](flows/docs-sync-viewer.md) (test) |
| `apps/web/src/lib/docs-space.ts` | [docs-sync-viewer](flows/docs-sync-viewer.md) (file) |
| `apps/web/src/lib/format.test.ts` | [web-shell](flows/web-shell.md) (test) |
| `apps/web/src/lib/format.ts` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/lib/inbox.ts` | [web-admin](flows/web-admin.md) (file) |
| `apps/web/src/lib/live-events.test.ts` | [event-delivery](flows/event-delivery.md) (test) |
| `apps/web/src/lib/live-events.ts` | [event-delivery](flows/event-delivery.md) (file) |
| `apps/web/src/lib/paste-image.ts` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/lib/queries.test.tsx` | [web-shell](flows/web-shell.md) (test) |
| `apps/web/src/lib/queries.ts` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/lib/search-params.test.ts` | [web-shell](flows/web-shell.md) (test) |
| `apps/web/src/lib/search-params.ts` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/lib/shortcuts.test.ts` | [web-shell](flows/web-shell.md) (test) |
| `apps/web/src/lib/shortcuts.ts` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/lib/ui-state.ts` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/main.tsx` | [web-shell](flows/web-shell.md) (điểm vào) |
| `apps/web/src/router.tsx` | [web-shell](flows/web-shell.md) (điểm vào) |
| `apps/web/src/routes/account.test.tsx` | [owner-auth](flows/owner-auth.md) (test) |
| `apps/web/src/routes/account.tsx` | [owner-auth](flows/owner-auth.md) (điểm vào) |
| `apps/web/src/routes/all-board.tsx` | [web-tickets](flows/web-tickets.md) (file) |
| `apps/web/src/routes/all-projects.test.tsx` | [web-tickets](flows/web-tickets.md) (test) |
| `apps/web/src/routes/board.tsx` | [web-tickets](flows/web-tickets.md) (điểm vào) |
| `apps/web/src/routes/docs-home.test.tsx` | [docs-sync-viewer](flows/docs-sync-viewer.md) (test) |
| `apps/web/src/routes/docs-home.tsx` | [docs-sync-viewer](flows/docs-sync-viewer.md) (file) |
| `apps/web/src/routes/home.tsx` | [web-shell](flows/web-shell.md) (file) |
| `apps/web/src/routes/inbox.test.tsx` | [web-admin](flows/web-admin.md) (test) |
| `apps/web/src/routes/inbox.tsx` | [web-admin](flows/web-admin.md) (điểm vào) |
| `apps/web/src/routes/list.tsx` | [web-tickets](flows/web-tickets.md) (điểm vào) |
| `apps/web/src/routes/login.test.tsx` | [owner-auth](flows/owner-auth.md) (test) |
| `apps/web/src/routes/login.tsx` | [owner-auth](flows/owner-auth.md) (điểm vào) |
| `apps/web/src/routes/machines.test.tsx` | [web-admin](flows/web-admin.md) (test) |
| `apps/web/src/routes/machines.tsx` | [web-admin](flows/web-admin.md) (điểm vào) |
| `apps/web/src/routes/my-requests.tsx` | [web-tickets](flows/web-tickets.md) (điểm vào) |
| `apps/web/src/routes/project-docs.test.tsx` | [docs-sync-viewer](flows/docs-sync-viewer.md) (test) |
| `apps/web/src/routes/project-docs.tsx` | [docs-sync-viewer](flows/docs-sync-viewer.md) (điểm vào) |
| `apps/web/src/routes/project-settings.test.tsx` | [web-admin](flows/web-admin.md) (test) |
| `apps/web/src/routes/project-settings.tsx` | [web-admin](flows/web-admin.md) (điểm vào) |
| `apps/web/src/routes/projects.tsx` | [web-admin](flows/web-admin.md) (điểm vào) |
| `apps/web/src/routes/settings-machine.tsx` | [server-settings](flows/server-settings.md) (file) |
| `apps/web/src/routes/settings-project-mcp.tsx` | [server-settings](flows/server-settings.md) (file) |
| `apps/web/src/routes/settings-prompt.tsx` | [server-settings](flows/server-settings.md) (file) |
| `apps/web/src/routes/system-settings.test.tsx` | [server-settings](flows/server-settings.md) (test) |
| `apps/web/src/routes/system-settings.tsx` | [server-settings](flows/server-settings.md) (điểm vào) |
| `apps/web/src/routes/ticket-detail.tsx` | [web-tickets](flows/web-tickets.md) (điểm vào) |
| `apps/web/src/styles/app.css` | [web-shell](flows/web-shell.md) (file) |
| `deploy/.env.example` | [deployment](flows/deployment.md) (file) |
| `deploy/Dockerfile` | [deployment](flows/deployment.md) (file) |
| `deploy/backup/backup.sh` | [deployment](flows/deployment.md) (file) |
| `deploy/compose.test.yml` | [deployment](flows/deployment.md) (file) |
| `deploy/compose.yml` | [deployment](flows/deployment.md) (file) |
| `deploy/nginx/crew-http.conf` | [deployment](flows/deployment.md) (file) |
| `deploy/nginx/crew-https.conf` | [deployment](flows/deployment.md) (file) |
| `deploy/nginx/crew-locations.inc` | [deployment](flows/deployment.md) (file) |
| `deploy/tools/nginx-override.mjs` | [deployment](flows/deployment.md) (file) |
| `deploy/web/nginx.conf` | [deployment](flows/deployment.md) (file) |
| `e2e/tests/docs-viewer.spec.ts` | [deployment](flows/deployment.md) (test) |
| `e2e/tests/ticket-lifecycle.spec.ts` | [deployment](flows/deployment.md) (test) |
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
| `packages/docs-kit/test/hook-installer.test.ts` | [docs-hooks](flows/docs-hooks.md) (test) |
| `packages/docs-kit/test/rules.test.ts` | [docs-check](flows/docs-check.md) (test) |
| `packages/shared/src/agent-schemas.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (file) |
| `packages/shared/src/api-schemas.ts` | [owner-auth](flows/owner-auth.md) (dùng chung), [ticket-lifecycle](flows/ticket-lifecycle.md) (dùng chung) |
| `packages/shared/src/bmad-schemas.ts` | [project-claims](flows/project-claims.md) (file) |
| `packages/shared/src/comment-mentions.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `packages/shared/src/comment-mentions.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (file) |
| `packages/shared/src/desktop-ipc.ts` | [desktop-app](flows/desktop-app.md) (file) |
| `packages/shared/src/docs-schemas.test.ts` | [docs-sync-viewer](flows/docs-sync-viewer.md) (test) |
| `packages/shared/src/docs-schemas.ts` | [docs-sync-viewer](flows/docs-sync-viewer.md) (dùng chung), [docs-check](flows/docs-check.md) (dùng chung) |
| `packages/shared/src/event-schemas.ts` | [event-delivery](flows/event-delivery.md) (file) |
| `packages/shared/src/health-schemas.test.ts` | [daemon-health](flows/daemon-health.md) (test) |
| `packages/shared/src/health-schemas.ts` | [daemon-health](flows/daemon-health.md) (file) |
| `packages/shared/src/index.ts` | [api-platform](flows/api-platform.md) (file) |
| `packages/shared/src/machine-command-schemas.ts` | [machine-control](flows/machine-control.md) (file) |
| `packages/shared/src/machine-schemas.ts` | [machine-pairing](flows/machine-pairing.md) (dùng chung), [project-claims](flows/project-claims.md) (dùng chung), [daemon-api](flows/daemon-api.md) (dùng chung) |
| `packages/shared/src/project-schemas.test.ts` | [project-claims](flows/project-claims.md) (test) |
| `packages/shared/src/project-schemas.ts` | [project-claims](flows/project-claims.md) (file) |
| `packages/shared/src/runtime-schemas.test.ts` | [runtime-updates](flows/runtime-updates.md) (test) |
| `packages/shared/src/runtime-schemas.ts` | [runtime-updates](flows/runtime-updates.md) (file) |
| `packages/shared/src/secret-scrubber.ts` | [agent-runs](flows/agent-runs.md) (file) |
| `packages/shared/src/settings-schemas.test.ts` | [server-settings](flows/server-settings.md) (test) |
| `packages/shared/src/settings-schemas.ts` | [server-settings](flows/server-settings.md) (file) |
| `packages/shared/src/status-workflow.test.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (test) |
| `packages/shared/src/status-workflow.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (file) |
| `packages/shared/src/ticket-schemas.ts` | [ticket-lifecycle](flows/ticket-lifecycle.md) (file) |
| `scripts/attach-nginx.sh` | [deployment](flows/deployment.md) (file) |
| `scripts/deploy.sh` | [deployment](flows/deployment.md) (điểm vào) |
| `scripts/enable-https.sh` | [deployment](flows/deployment.md) (file) |
| `scripts/lib/common.sh` | [deployment](flows/deployment.md) (file) |
| `scripts/lib/render-nginx.sh` | [deployment](flows/deployment.md) (file) |
| `scripts/restore.sh` | [deployment](flows/deployment.md) (file) |
| `scripts/seed-owner.sh` | [deployment](flows/deployment.md) (file) |
<!-- crew-docs:files:end -->
