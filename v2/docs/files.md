# Tra cứu file

File nào thuộc flow nào. Dùng `crew-docs where <file>` để tra từ dòng lệnh.

<!-- crew-docs:files:start -->
> Sinh tự động bởi `crew-docs generate` từ `docs/flows.yaml`. Không sửa tay.

| File | Flows |
|------|-------|
| `desktop/package.json` | [desktop-shell](flows/desktop-shell.md) (file) |
| `desktop/pnpm-lock.yaml` | [desktop-shell](flows/desktop-shell.md) (file) |
| `desktop/src/main/client.ts` | [desktop-shell](flows/desktop-shell.md) (file) |
| `desktop/src/main/index.ts` | [desktop-shell](flows/desktop-shell.md) (điểm vào) |
| `desktop/src/main/security.ts` | [desktop-shell](flows/desktop-shell.md) (file) |
| `desktop/src/preload/index.cjs` | [desktop-shell](flows/desktop-shell.md) (file) |
| `desktop/src/preload/index.d.cts` | [desktop-shell](flows/desktop-shell.md) (file) |
| `desktop/src/renderer/index.html` | [desktop-shell](flows/desktop-shell.md) (file) |
| `desktop/src/renderer/index.js` | [desktop-shell](flows/desktop-shell.md) (file) |
| `desktop/src/renderer/style.css` | [desktop-shell](flows/desktop-shell.md) (file) |
| `desktop/test/electron-lifecycle.test.ts` | [desktop-shell](flows/desktop-shell.md) (test) |
| `desktop/test/shell.test.ts` | [desktop-shell](flows/desktop-shell.md) (test) |
| `desktop/tsconfig.build.json` | [desktop-shell](flows/desktop-shell.md) (file) |
| `desktop/tsconfig.json` | [desktop-shell](flows/desktop-shell.md) (file) |
| `gateway/package.json` | [gateway-host](flows/gateway-host.md) (file) |
| `gateway/pnpm-lock.yaml` | [gateway-host](flows/gateway-host.md) (file) |
| `gateway/src/host/gateway-host.ts` | [gateway-host](flows/gateway-host.md) (file) |
| `gateway/src/host/main.ts` | [gateway-host](flows/gateway-host.md) (điểm vào) |
| `gateway/src/host/status.ts` | [gateway-host](flows/gateway-host.md) (file) |
| `gateway/src/ipc/server.ts` | [gateway-host](flows/gateway-host.md) (file) |
| `gateway/test/host-lifecycle.test.ts` | [gateway-host](flows/gateway-host.md) (test) |
| `gateway/test/support/host.ts` | [gateway-host](flows/gateway-host.md) (test) |
| `gateway/test/support/ui-client.ts` | [gateway-host](flows/gateway-host.md) (test) |
| `gateway/tsconfig.build.json` | [gateway-host](flows/gateway-host.md) (file) |
| `gateway/tsconfig.json` | [gateway-host](flows/gateway-host.md) (file) |
| `server/migrations/001_platform.sql` | [server-platform](flows/server-platform.md) (file) |
| `server/migrations/002_journal.sql` | [server-journal](flows/server-journal.md) (file) |
| `server/migrations/003_identity.sql` | [server-identity](flows/server-identity.md) (file) |
| `server/migrations/004_tickets.sql` | [server-tickets](flows/server-tickets.md) (file) |
| `server/package.json` | [server-platform](flows/server-platform.md) (file) |
| `server/scripts/test-db-signals.mjs` | [server-platform](flows/server-platform.md) (file) |
| `server/scripts/test-db.ts` | [server-platform](flows/server-platform.md) (file) |
| `server/src/auth/bootstrap.ts` | [server-identity](flows/server-identity.md) (file) |
| `server/src/auth/machine.ts` | [server-identity](flows/server-identity.md) (file) |
| `server/src/auth/password.ts` | [server-identity](flows/server-identity.md) (file) |
| `server/src/auth/routes.ts` | [server-identity](flows/server-identity.md) (điểm vào) |
| `server/src/auth/session.ts` | [server-identity](flows/server-identity.md) (file) |
| `server/src/db/client.ts` | [server-platform](flows/server-platform.md) (file) |
| `server/src/db/migrate.ts` | [server-platform](flows/server-platform.md) (điểm vào) |
| `server/src/docs/checksum.ts` | [server-docs-import](flows/server-docs-import.md) (file) |
| `server/src/docs/contracts.ts` | [server-docs-import](flows/server-docs-import.md) (file) |
| `server/src/docs/links.ts` | [server-docs-import](flows/server-docs-import.md) (file) |
| `server/src/docs/manifest.ts` | [server-docs-import](flows/server-docs-import.md) (file) |
| `server/src/docs/validator.ts` | [server-docs-import](flows/server-docs-import.md) (điểm vào) |
| `server/src/journal/canonical.ts` | [server-journal](flows/server-journal.md) (file) |
| `server/src/journal/event-contracts.ts` | [server-journal](flows/server-journal.md) (file) |
| `server/src/journal/events.ts` | [server-journal](flows/server-journal.md) (file) |
| `server/src/journal/mutation.ts` | [server-journal](flows/server-journal.md) (file) |
| `server/src/journal/routes.ts` | [server-journal](flows/server-journal.md) (điểm vào) |
| `server/src/platform/config.ts` | [server-platform](flows/server-platform.md) (file) |
| `server/src/platform/contracts.ts` | [server-platform](flows/server-platform.md) (file) |
| `server/src/platform/errors.ts` | [server-platform](flows/server-platform.md) (file) |
| `server/src/platform/picomatch.d.ts` | [server-platform](flows/server-platform.md) (file) |
| `server/src/platform/thread-stream.d.ts` | [server-platform](flows/server-platform.md) (file) |
| `server/src/projects/routes.ts` | [server-identity](flows/server-identity.md) (điểm vào) |
| `server/src/projects/service.ts` | [server-identity](flows/server-identity.md) (file) |
| `server/src/tickets/completion.ts` | [server-tickets](flows/server-tickets.md) (file) |
| `server/src/tickets/contracts.ts` | [server-tickets](flows/server-tickets.md) (file) |
| `server/src/tickets/decisions.ts` | [server-tickets](flows/server-tickets.md) (file) |
| `server/src/tickets/dependencies.ts` | [server-tickets](flows/server-tickets.md) (file) |
| `server/src/tickets/deploy.ts` | [server-tickets](flows/server-tickets.md) (file) |
| `server/src/tickets/docs-links.ts` | [server-tickets](flows/server-tickets.md) (file) |
| `server/src/tickets/repair.ts` | [server-tickets](flows/server-tickets.md) (file) |
| `server/src/tickets/routes.ts` | [server-tickets](flows/server-tickets.md) (điểm vào) |
| `server/src/tickets/service.ts` | [server-tickets](flows/server-tickets.md) (file) |
| `server/test/auth.test.ts` | [server-identity](flows/server-identity.md) (test) |
| `server/test/completion.test.ts` | [server-tickets](flows/server-tickets.md) (test) |
| `server/test/dependencies.test.ts` | [server-tickets](flows/server-tickets.md) (test) |
| `server/test/deploy.test.ts` | [server-tickets](flows/server-tickets.md) (test) |
| `server/test/docs-validator.unit.test.ts` | [server-docs-import](flows/server-docs-import.md) (test) |
| `server/test/fixtures/legacy-docs/crlf-unicode.md` | [server-docs-import](flows/server-docs-import.md) (test) |
| `server/test/journal-scope.test.ts` | [server-journal](flows/server-journal.md) (test) |
| `server/test/journal.test.ts` | [server-journal](flows/server-journal.md) (test) |
| `server/test/platform.test.ts` | [server-platform](flows/server-platform.md) (test) |
| `server/test/projects.test.ts` | [server-identity](flows/server-identity.md) (test) |
| `server/test/repair.test.ts` | [server-tickets](flows/server-tickets.md) (test) |
| `server/test/support/db.ts` | [server-platform](flows/server-platform.md) (test) |
| `server/test/support/docs.ts` | [server-docs-import](flows/server-docs-import.md) (test) |
| `server/test/support/identity-app.ts` | [server-identity](flows/server-identity.md) (test) |
| `server/test/support/tickets.ts` | [server-tickets](flows/server-tickets.md) (test) |
| `server/test/ticket-events.unit.test.ts` | [server-tickets](flows/server-tickets.md) (test) |
| `server/test/tickets.test.ts` | [server-tickets](flows/server-tickets.md) (test) |
| `server/tsconfig.json` | [server-platform](flows/server-platform.md) (file) |
| `src/completion-policy.ts` | [domain-foundation](flows/domain-foundation.md) (file) |
| `src/model-policy.ts` | [domain-foundation](flows/domain-foundation.md) (file) |
| `src/ticket-policy.ts` | [domain-foundation](flows/domain-foundation.md) (file) |
| `src/workflow-policy.ts` | [domain-foundation](flows/domain-foundation.md) (file) |
| `test/completion-policy.test.ts` | [domain-foundation](flows/domain-foundation.md) (test) |
| `test/model-policy.test.ts` | [domain-foundation](flows/domain-foundation.md) (test) |
| `test/ticket-policy.test.ts` | [domain-foundation](flows/domain-foundation.md) (test) |
| `test/workflow-policy.test.ts` | [domain-foundation](flows/domain-foundation.md) (test) |
| `test/workspace.test.ts` | [domain-foundation](flows/domain-foundation.md) (test) |
<!-- crew-docs:files:end -->
