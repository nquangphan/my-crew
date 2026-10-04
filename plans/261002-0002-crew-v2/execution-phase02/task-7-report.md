# Phase02 Task7 — READY for independent review

Triển khai worker xong trên worktree `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`, branch `codex/crew-v2-server`, producer HEAD/BASE `832c9a3`. Worker không stage/commit; PM chịu candidate commit, manifest/generated docs và review độc lập. Phạm vi hiện tại có bằng chứng test; trạng thái production authority phần06/08 vẫn **chưa được kiểm chứng/không được cấu hình**.

## Files và exports thực tế

Source mới (6):

- `v2/server/src/app.ts`: `AppOptions`, `buildApp(input: AppOptions): Promise<FastifyInstance>`. `AppOptions = Omit<ServerOptions,'authorizeDispatch'|'verifyFinalResult'> & Partial<Pick<ServerOptions,'authorizeDispatch'|'verifyFinalResult'>>`; mọi full `ServerOptions` cũ được nhận. Hai callback thiếu dùng producer `denyDispatch`/`denyFinalResult`; không env flag/boolean bypass.
- `v2/server/src/main.ts`: `main(env=process.env): Promise<void>`. Main guard chỉ chạy khi file được gọi trực tiếp, cổng mặc định **8792**, host `127.0.0.1`; migration không tự chạy. Wrapper giữ `loadConfig` producer ngoài main có default8788, không sửa config/package/.env/migration.
- `v2/server/src/docs/read.ts`: types `AuditState`, `DocsPage`, `DocsTree`; `requireDocsScope`, `selectSnapshot`, `readDocsTree`, `readDocsPage`, `docsSourceReader`, `docsCompletionReader`, `readProjectDocsState`.
- `v2/server/src/docs/search.ts`: `DocsHit`, `SearchInput`, `searchDocs`.
- `v2/server/src/docs/routes.ts`: `registerDocsRoutes`.
- `v2/server/src/tickets/authorization.ts`: `authorizeTicketMutation`. Owner no-op giữ producer business policy; machine giữ root/ticket/project rồi machine FOR SHARE, kiểm tra current binding/revocation trước cached replay.

Source sửa (5): `v2/server/src/auth/routes.ts` (additive `authenticateCurrentCredential(Db|Tx,request,now)`), `v2/server/src/journal/routes.ts` (additive optional fifth current-credential callback, per-page/poll snapshot reauth, preClose socket cleanup, safe error-code logging), `v2/server/src/projects/routes.ts` (additive optional fifth docsState reader cho GET list/detail), `v2/server/src/projects/service.ts` (projectEventScope từ chối revoked machine trước targeted audience reads), `v2/server/src/tickets/routes.ts` (Tx guard trên cả7 mutation families).

Tests/fixture mới (3): `v2/server/test/docs-read.test.ts` (3 substantive tests), `v2/server/test/api-acceptance.test.ts` (9 substantive tests), `v2/server/test/support/http.ts` (real Node fetch listener port0, bootstrap/login cookie-CSRF, identity/authority/restart helpers).

R3 flow pages sửa (6): `v2/docs/flows/server-platform.md`, `server-journal.md`, `server-identity.md`, `server-tickets.md`, `server-execution.md`, `server-docs-import.md`; thêm `v2/docs/flows/server-docs-view.md` với đúng7 heading STANDARD. Integration paragraphs mô tả symbols/hành vi thật. PM cần map 6 source mới/3 test mới vào server-docs-view (authorization thuộc server-tickets), cập nhật shared consumer mapping nếu cần và chạy standalone mirror generate/check theo brief. Worker không viết manifest/index/files generated.

Không sửa journal/events.ts, ticket completion/business/repair policy, 001–006, platform contracts, gateway/planner/desktop, v1, protected files, lockfiles hoặc credentials. Frozen006 SHA xác nhận `8c48a69a27205ff95d11be8b966ffffcd079f62e537f5263777cd867325b75ae`.

## HTTP/status/search/read contract

Docs route mới: GET `/v2/projects/:id/docs/tree`, GET `/v2/projects/:id/docs/page?path=...`, GET `/v2/docs/search?q=...`; owner POST `/v2/docs/imports`; machine POST `/v2/projects/:id/docs/sync`. App đăng ký auth/project/tickets/execution/events producer cùng docs; binding guard dùng `assertNoActiveProjectExecution`, ticket factory dùng immutable execution/docs source/completion callbacks; execution routes nhận docs completion reader.

Tree/page chọn `(received_at DESC,id DESC)` mới nhất mặc định hoặc exact snapshot cùng project. Page strict UTF8 decode original bytea giữ CRLF/BOM/NUL, SHA từ original bytes; JSON raw text không render/execute. Tree không tạo trang duplicate; nearest existing directory index/page ancestor; link occurrence/provenance và per-file class giữ nguyên. Related ticket IDs bounded20/project scope. Project GET state missing/unverified/invalid/current/stale; current chỉ verified non-null sourceCommit khớp non-null expected_commit. Source refs composite project/snapshot/path.

Search parameterized `websearch_to_tsquery('simple',q)`/GIN-rank prefix8192 **OR escaped literal ILIKE full search_text** trên mọi query; không dựng SQL theo q/cursor, không unbounded to_tsvector. NUL query cùng producer projection; literal `%`,`_`,`\` escaped; Unicode accents giữ nguyên, không claim accent folding. Snippet string projection tối đa240 code point không HTML highlight. Q1–256, limit1–100 default50; cursor validated exact tuple score/project/snapshot/path + q/filter hash; sort scoreDESC/project/snapshot/path, có actual tied zero-rank pagination test. Chỉ snapshot mới nhất/project mặc định; explicit snapshot scoped404 nếu foreign.

ApiError giữ status/code/message. JSON/schema/unrecognized fields400 `INVALID_INPUT`, path/q/limit/cursor invalid400, foreign project/snapshot404. Body upload24MiB (ordinary1MiB) excess413, producer decoded16MiB/file1MiB/project100/files2000 unchanged. Unexpected DB errors generic503 `SERVICE_UNAVAILABLE`; raw error/request secrets không log. Owner-only import cần Origin/CSRF, máy sync dùng authorizeDocsSync trước replay.

## RED/GREEN và cuối cùng

- RED kế hoạch `pnpm --dir v2/server test --test-name-pattern='docs tìm kiếm|HTTP persistence|search'`: module app chưa tồn tại,1fail; sau implementation targeted20/20 (2 substantive new docs tests + filtered existing file entries). Log `task-7-evidence/red.log`.
- Meaningful security regression RED: tạm bỏ comment Tx guard và per-page current-credential scope (sau đó restore trong Python finally), `pnpm --dir v2/server test --test-name-pattern='cached replay cannot race|real SSE current'`: **2 substantive failures** — cached response201 sau rebind thay vì404; owner SSE không đóng khi expiry, timeout. Log `security-red.log`. Guards phục hồi và covering run cả hai GREEN.
- Iteration HTTP failure đầu tiên là fixture consumer dùng sai producer DTO (`machine.id`, không `machineId`) và artifact locator `test://...` vi phạm path contract; sửa fixture theo actual producer, không đổi policy. Targeted HTTP25/25 và extra22/22; số này gồm filtered existing file entries, không claim có25/22 new acceptance cases.
- Final covering **một lượt sau batch/self-review**, tất cả exit0:
  - `pnpm --dir v2 test`: **14/14 pass**,0fail.
  - `pnpm --dir v2 typecheck`: exit0.
  - `pnpm --dir v2/server test`: **169/169 pass**,0fail/0cancel/0skip, gồm12 substantive Task7 tests, duration7678.546291ms.
  - `pnpm --dir v2/server typecheck`: exit0.
- `git diff --check`: exit0. Biome targeted check/write14 owned source/test files:0errors sau fix implicit-any declaration, warning còn lại là non-null assertions trong fixture/tests (22 ở lượt cuối3-file check); không claim warning-free. Source được format trước final covering. Logs4 gates + Biome ở `task-7-evidence/`.

## Bằng chứng thật

Final HTTP persistence test listen127.0.0.1 **49167**, close app+original pool, reopen same private logical DB/pool và listen **49216**. Login cookie/CSRF→project→2 fresh machines→bind1→request/step/task+sibling dependency; comments/owner decision durable; import same bundle/key hai lần không duplicate; imported valid state unverified. Claim với explicit test callback, scoped wrong machine404, checkpoint sequence1; pause command ACK completed **ticket vẫn running**, chỉ exact process/fence stopped reconcile mới paused. Reopened graph/digest/docs/command cached result giống trước; mutation mới comment1event, event cursors unique. Real SSE `Last-Event-ID` reconnect sau restart trả exact cùng cursor sequence với GET events, không duplicate. Revoked bearer401; borrowed v1 fields400.

Race2 pools giữ event_cursor: HTTP authenticate đã đi qua rồi pending mutation chờ journal lock; pool khác commit rebind/revocation trước authorize. Cached comment replay404, comments count vẫn1. Các cached create/dependency/signal/comment/decision/docs-link replays đều404 sau rebind; repair replay404 trong fifth-cycle case.

Real SSE targeted machine event sau token revoke và global owner event sau session12h expiry **không được phát**, socket đóng ở poll tiếp theo. Current actual request credential + scope + events dùng cùng repeatable-read snapshot: pool khác revoke/rebind/append targeted event giữa credential/scope và data read; in-flight snapshot không thấy event commit sau đó, fresh read401. App preClose đóng active real SSE và listener; timers abort khi socket đóng.

Production dispatch absent503 `DISPATCH_NOT_CONFIGURED`, attempts count0. Artifact chỉ `reported`; passed result+physical stop vẫn finalizing, active guard retained khi verifier refuse. Test-only research attestation mới (`verification:verified,testAuthority:Task7,originalEvidenceId`) cho finalize→stopped/done; original reported row không sửa. Repaircycle5 giữ running+guard+repair_limit tới physical stop rồi needs_input/count5.

Code completion reader từ chối imported/mixed audit unverified ngay cả có explicit test code/merge evidence. Positive reader fixture tạo **new immutable verified checkout snapshot** cùng implemented standard pages+workflow artifact, pointer/source expected commit và same-project receipt; không promote imported rows. Current/stale-null/stale-mismatch, missing receipt deny, full reader positive đều có assertions. Đây là reader contract test, không production attestation.

## Backup/restore và cleanup

Final runner owned container **`e6359369e174b1d86f23ec3da25143315b65245cb30248611272ab49913a01b6`**, loopback random DB port khác5432/55432, migrated prefix001–006. `docker exec <exactID> pg_dump -U postgres -Fc -d <ownlogicalDB>` tạo dump75009bytes; restore qua pg_restore vào **`crew_v2_restore_6ad0e7341eb84bd69939dd361ecb5406`**. So equality tickets/events/snapshots/commands/attempt counts, event_cursor, snapshot/path/original SHA+byte hex, command states/results; restore DB drop trong finally; logical fixtures close pools/drop đúng DB trong finally. Runner successful exit0 sử dụng existing exact-ID docker stop finally, không cleanup global.

Recorded earlier acceptance containers `4749afe1208901c7bcd3646c5a1cc19cd4c752b8e9202c2dd97259a66a1c93c3` và `ad04cb65cccd329e686a165f90e76f92784d74891c967d0c1b61c91feefebd36` cũng absent khi inspect exact ID. `task-7-evidence/cleanup.json` ghi inspect exit1/no such object của cả3ID. Các targeted/RED runs không ghi ID vào stdout; cleanup được runner finally quản lý, không invent ID cho các lượt đó. Không worker-created custom process/temp Git mirror/subagent. Probe chỉ sửa/restores owned source trong finally; shell mktemp/trap attempt bị tool reject trước khi chạy, sau đó dùng Python in-memory originals. Test processes kết thúc, listeners/pools đóng; retained logs là bằng chứng review, không credential.

## Self-review/rulings và giới hạn

Self-review độc lập pass của worker kiểm tra scope composite, actor/current machine trước replay, lock order, snapshot isolation, cursor parameters/ties, byte projection và no applied migration edit; không thay cho reviewer PM. Owner callback no-op giữ error/business behavior cũ, chỉ machine ACL bổ sung.

Ruling: main wrapper cấp default8792 theo Task7 và giữ default8788 của reviewed platform config ngoài main; cả hai được ghi docs thay vì non-backcompatible producer change. Cost nếu caller ngoài main muốn8792: phải đặt port explicit. Additive route callbacks giữ calls4argument cũ; actual app luôn truyền current-credential callback bên trong snapshot.

Remaining: real dispatch authority/planner06, trusted merge/docs attestation011/08, docs-only final evidence08, physical host/runtime and production deploy09 chưa được chứng minh. Sync producer006 remains unverified/latest_verified không tự advance; completion production fail closed. FTS GIN chỉ8192 prefix, full literal scan fallback không claim full-file ranked coverage. GET project docsState injection giữ factory defaultmissing cho producer-only fixtures; mutation Project receipt DTO giữ producer immutable replay shape. PM chưa chạy manifest/generate/mirror/staged checks hoặc independent review cho Task7; worker không commit/stage/deploy/merge.
