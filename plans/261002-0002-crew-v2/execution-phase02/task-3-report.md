# Task 3 — identity worker report

## Scope and contract

Implemented only Task 3 files: owner bootstrap/auth/session, machine provisioning, project create/read/binding, migration 003, local identity test fixture/tests, and `v2/docs/flows/server-identity.md`. No commit, manifest, index, shared platform, package or v1 files changed by this worker. PM's frozen HTTP correction is applied: `POST/GET/DELETE /v2/auth/session`, `PUT /v2/projects/:id/binding`, project list `{items,nextCursor}` with UUID cursor and 1–100/default 50. Journal producer payloads contain only reviewed metadata.

## TDD evidence

- Initial `pnpm --dir v2/server test --test-file .../test/auth.test.ts` exited 1: three auth tests failed at `createAuthenticator` with `NOT_IMPLEMENTED` after migration 002 was ready. The preceding run first exposed an owned test import error (`ApiError` imported from contracts), which was corrected before treating the subsequent RED as behavior evidence.
- After implementation and HTTP correction, focused `pnpm --dir v2/server test --test-name-pattern='auth|provision|binding|project list'` exited 0: 12/12.
- `binding guard cho phép đổi máy sau đối chiếu và xóa commit checkout cũ` RED: actual `expected_commit` remained a 40-character old commit; expected null. After clearing it in the binding update, focused test exited 0: 1/1.
- `project key trùng báo conflict rõ ràng và không tạo thêm project` RED: HTTP 500; expected 409. After mapping PostgreSQL `projects_key_key` unique violation to `PROJECT_KEY_CONFLICT`, focused test exited 0: 1/1.

## Final verification

- `pnpm --dir v2/server test`: exit 0, 38/38, 0 failures. Includes auth, journal, platform and project tests on private PostgreSQL 18.6 fixture; no shared DB touched.
- `pnpm --dir v2/server typecheck`: exit 0.
- Original root `node_modules/.bin/biome check v2/server/src/auth v2/server/src/projects v2/server/test/auth.test.ts v2/server/test/projects.test.ts v2/server/test/support/identity-app.ts`: exit 0, 10 files, no fixes.
- `pnpm --dir v2 test`: exit 0, 14/14 domain tests.

## Security and behavior reviewed

- Password uses async `scrypt` (`N=32768,r=8,p=1,maxmem=64MiB`) with 16-byte salt; compare uses `timingSafeEqual` only for equal-sized hashes. Bootstrap takes stdin, advisory-locks the owner row, rejects repeats, and never prints a credential.
- Session/machine credentials are independent random 32-byte values. DB stores SHA-256 hashes; CSRF ciphertext and idempotent machine response use AES-256-GCM. Codec AAD binds actor, route and key. Test verifies provision replay returns the same token to authenticated owner, rejects different payload under the same key, and confirms `pg_dump --data-only` lacks the raw password, cookie secret, CSRF and machine token.
- Owner mutations require cookie, exact Origin and CSRF. Login limits five failures per five minutes per hashed request IP. Machine bearer cannot use owner routes; cookie cannot use machine-only route. Session survives app restart when runtime key is retained, and expiry/logout reject access. Test app explicitly disables Fastify's `removeAdditional`, so forbidden fields return 400.
- Project row lock and revision check guard concurrent binding; one same-revision request succeeds and one gets 409. Default three-argument `bindProject` denies rebind. PM approved backward-compatible optional fourth `BindingGuard`; route passes its required guard, which runs after row lock and target-machine check only for existing binding. Task 5 will supply attempts query; current fixture uses `denyRebinding`. Rebinding clears `expected_commit` from old checkout. Revoked machine gets 404. Project event scope exposes only currently bound project events to a machine.

## Files

`v2/server/migrations/003_identity.sql`; `v2/server/src/auth/{password,session,machine,bootstrap,routes}.ts`; `v2/server/src/projects/{service,routes}.ts`; `v2/server/test/{auth,projects}.test.ts`; `v2/server/test/support/identity-app.ts`; `v2/docs/flows/server-identity.md`.

## Self-review and handoff concerns

- PM/Task 7 must wire `createMutator(db, credentialResponseCodec(sessionEncryptionKey))` to these routes; plain journal codec would store machine tokens. The Task 3 fixture does this and tests ciphertext, but production `app.ts` is outside this worker's ownership.
- Task 5 must replace default rebinding denial with an in-transaction guard checking `active`, `uncertain`, and `finalizing` attempts while project row is locked. No such tables exist in migration 003.
- Project `docsState` is `missing` at this migration prefix. Task 6/7 must derive it from docs snapshots when those tables and read model exist; this task does not claim imported docs are current.
- No production deploy, credential import, or database migration on a persistent DB was performed. Controller owns docs manifest/index, staged check, review and commit.

## Fix round 1 — review `task-3-review.md`, base `033a572`

- P1 RED: `pnpm --dir v2/server test --test-file .../auth.test.ts --test-name-pattern='đồng thời|machine list phân trang'` exited 1; 12 simultaneous wrong passwords produced 12 HTTP 401 instead of five 401 and seven 429. The test now arms a `preHandler` barrier for all 12 requests so every handler starts together. Login reserves one per-IP slot synchronously before DB/scrypt awaits, counts in-flight plus recent failures, releases a slot in `finally`, and clears completed failures on success. A bounded map holds at most 10,000 hashed IPs and sweeps expired entries every 64 login calls or at capacity; new IPs fail closed at capacity. No global cross-IP lock.
- P2 RED in the same run: `GET /v2/machines?limit=1` returned 3 items instead of one. Route now accepts only `limit`/UUID `cursor`, rejects invalid or extra fields with 400, uses stable ID order and `limit + 1` to return `{items,nextCursor}`; default 50, maximum 100. No token/hash in the list response.
- GREEN: focused two-test command exited 0, 2/2. Barrier-specific re-run exited 0, 1/1. Auth file run before adding the barrier exited 0, 12/12, including five-minute expiry and default-50 boundary; success resets completed failures, while concurrent pending attempts remain reserved until they finish.
- Covering run after production fix: `pnpm --dir v2/server test` exit 0, 43/43; `pnpm --dir v2/server typecheck` exit 0; root Biome on the then-owned three files exit 0, 3/3.
- After adding the explicit barrier, auth file run exited 0, 13/13. Full server run at that moment exited 1: 43 passing, one import failure in concurrent Task 6 `test/docs-validator.unit.test.ts` because `src/docs/validator.ts` was not present yet. Typecheck also failed on that same missing Task 6 module and its dependent implicit-any diagnostics. Owned Biome remained clean, 3/3. No Task 6 source or test was changed by this worker; PM notified. Final full/typecheck rerun waits for Task 6 file readiness.
- Files changed for this round: `v2/server/src/auth/routes.ts`, `v2/server/test/auth.test.ts`, `v2/server/test/support/identity-app.ts`, `v2/docs/flows/server-identity.md`, this report. Journal correction in commit `033a572` was preserved; no other source ownership changed and no commit was created.

### Final verification after parallel Task 6 source became available

- Auth explicit-file fixture run: exit 0, 13/13; project explicit-file fixture run: exit 0, 6/6. The runner supports one `--test-file` per invocation, so these were separate private-DB runs.
- `pnpm --dir v2/server test`: exit 0, **51/51** across auth, projects, journal, platform and the newly available docs validator tests.
- `pnpm --dir v2/server typecheck`: exit 0 with original strict config.
- Original root `node_modules/.bin/biome check` on three owned auth source/test files: exit 0, 3 files, no fixes. `git diff --check` on owned source/test/flow also exited 0.
- The earlier full-suite and typecheck failure was transient from an in-progress Task 6 test import; no Task 6 file was edited here. A proposed temporary scoped-config command was automatically rejected because it included `rm -f` cleanup; no temporary config was created. Normal full verification succeeded after Task 6 source appeared.
