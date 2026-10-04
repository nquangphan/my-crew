# Task 6 STAGE B — Báo cáo triển khai

Candidate sẵn sàng review độc lập. Chưa stage/commit, chưa hoàn thành gate review của PM. Producer baseline `9dca04e`; HEAD trong lúc chạy được PM cập nhật docs roadmap tới `226120a`, không đổi producer. Brief `execution-phase02/task-6b-brief.md`, Stage A reviewed `05b6758`, Task 5/schema 005 reviewed tới `9dca04e`. Flow thực tế `v2/docs/flows/server-docs-import.md`; `server-docs.md` trong handoff là tên nhầm, PM xác nhận.

## Phạm vi và ownership

File mới:

- `v2/server/migrations/006_docs.sql`
- `v2/server/src/docs/import.ts`
- `v2/server/scripts/docs-import.ts`
- `v2/server/test/docs-import.test.ts`
- `v2/server/test/docs-import-cli.unit.test.ts`
- `v2/server/test/docs-events.unit.test.ts`

File sửa: `v2/server/test/support/docs.ts`, `v2/server/src/journal/event-contracts.ts`, `v2/docs/flows/server-docs-import.md`, `v2/docs/flows/server-journal.md`. Journal extension và receipt column được PM duyệt trực tiếp trong session. PM sở hữu manifest/generated docs/index/Git index/commit; agent không sửa các file đó. Không sửa Stage A contracts/checksum/manifest/validator/links/unit tests, domain, schema 001–005, execution, app/main, Task 7 routes/read/search, gateway hoặc lock/package. Không spawn subagent, gọi model, cài global dependency, deploy hoặc đụng shared service.

## Exports và hợp đồng bàn giao

`src/docs/import.ts`:

- `validateDocsImport(input: unknown): asserts input is DocsImport`: allowlist toàn bộ input, kiểm tra identity/repository URL/path/class/byte/base64/UTF-8/checksum/limits trước ghi DB. Legacy structural errors được lưu; lỗi toàn vẹn/security bị reject.
- `importDocs(tx: Tx, input: DocsImport, actor: Actor): Promise<ImportResult>`: owner-only, toàn bộ batch cùng transaction, project mới unbound. Mapping `(source_system,legacy_id)` không nhận project khác hoặc ghi đè key/repository; cùng bundle trả report cũ không event mới. Snapshot reuse giữ audit đã lưu; khác commit không reuse sai provenance.
- `authorizeDocsSync(tx: Tx, projectId: Id, input: DocsSync, actor: Actor): Promise<void>`: Task 7 **phải** truyền callback này vào `MutationContext.authorize`, để authority chạy trước cached idempotency response. Scope gồm project/attempt/ticket/root/machine, current binding và command binding, guard/fence, state/lease/terminal intent, merged commit và scoped evidence.
- `syncDocs(tx: Tx, projectId: Id, input: DocsSync, actor: Actor): Promise<Id>`: gọi lại authority, validate source-list checksum và checkout audit, lưu structural-valid snapshot `unverified`, receipt riêng attempt/commit. Same exact input replay ổn định; altered input 409; attempt mới cùng byte/class/commit reuse snapshot nhưng có receipt/event riêng.

`DocsSync` giữ kiểu Stage A: sourceCommit, snapshotSha256, files, attemptId, fence, trackedSourcePaths, sourceTreeSha256, verificationEvidenceId. Evidence provenance hiện yêu cầu `kind='docs_verification'`, cùng ticket/attempt, `data.sourceCommit` và `data.sourceTreeSha256` đúng input. Field `data.verification:'verified'` do host báo **không** cấp quyền verified. Evidence producer/trusted attestation thuộc phase 08.

`server/scripts/docs-import.ts`:

- `verifyBackupBundle(bundlePath: string, manifestPath: string): Promise<DocsImport>`: hash raw backup manifest, verify source backup và mọi file inventory, so commit/hash/size/class, từ chối symlink/path escape.
- `runDocsImport(args: string[], env?: NodeJS.ProcessEnv): Promise<Record<string, unknown>>`: `--bundle <file> --backup-manifest <file> [--dry-run]`. Summary counts/checksums/violations/warnings; dry-run không mạng/ghi. Upload dùng `CREW_V2_SERVER_URL`, session cookie `CREW_V2_OWNER_SESSION`, CSRF `CREW_V2_OWNER_CSRF`; fallback stdin JSON `{sessionCookie,csrfToken}`. Secret không được nhận qua CLI args. Origin chính xác, stable key `docs-import-<bundle SHA>`, không follow redirect, chỉ HTTPS hoặc HTTP loopback, không log response body/credential.

`test/support/docs.ts`: thêm `legacyBundle`, `rehashBundle`, `importWithKey`; giữ `validDocs` và `docsValidationFixture`. Fixture defaults chỉ phân loại known path, unknown docs path cần class cụ thể. Runtime export fixture tạo từ supplied valid docs trong thư mục riêng, không đọc export/v1 DB thật.

Journal closed metadata: `docs.imported` global owner scope `{importId,projectCount}` với count 1–100; `docs.synced` project scope `{snapshotId,sourceCommit,auditState}`. Không page content, audit issues hoặc credential trong event.

## Schema 006 và dữ liệu

Checksum file SQL: `e281528a422c5c5e85db1957d2877d4ae8d4a91f019a08b3ceb52d10b02e390b`.

- `docs_imports(id,source_system,backup_manifest_sha,bundle_sha,report,created_at)`; unique sourceSystem/bundle SHA.
- `docs_snapshots(id,project_id,import_id,source_commit,snapshot_sha,source_kind,audit_state,audit_report,content_class,received_at)`; unique `(project_id,source_kind,snapshot_sha,content_class,coalesce(source_commit,''))`, unique id/project pair. Legacy cannot audit verified. Audit report `{issues}` plus first sync proof `{sourceTreeSha256,verificationEvidenceId,inputSha256}`.
- `docs_files(snapshot_id,path,content_class,bytes,sha,title,search_text,search_vector)`; original bytea, primary snapshot/path, generated FTS simple + GIN. Title/search text decode phục vụ đọc/tìm, không thay byte gốc.
- `docs_links(snapshot_id,from_path,occurrence,original_href,to_path,fragment,status)`; primary snapshot/from/occurrence giữ link trùng và fragment riêng.
- `docs_sync_receipts(attempt_id,merged_commit,snapshot_id,input_sha256)`; primary attempt/mergedCommit. **PM approved extension** input_sha256 char(64) là hash canonical toàn bộ DocsSync, gồm attempt và merged commit. Snapshot reused không thể giữ retry fingerprint riêng cho nhiều attempt; regression đã RED trước sửa này.
- Project thêm latest_imported_snapshot_id/latest_verified_snapshot_id với composite FK snapshot/project, tránh pointer cross-project. Import chỉ sửa imported pointer, không đổi verified pointer. ticket_docs(snapshot_id,path) composite FK tới docs_files.
- Trigger chặn UPDATE/DELETE trên imports/snapshots/files/links/receipts; service chỉ tạo snapshot mới trong transaction. Phân loại từng page vẫn implemented/workflow_artifact, aggregate có thể mixed. Không nâng artifact page thành code proof.

Giới hạn: 100 projects/import, 2000 files/project, file 1 MiB, total decoded 16 MiB, encoded canonical JSON 24 MiB. Canonical snapshot hash không gồm commit; provenance unique index có commit. Null source commit vẫn null; không đoán SHA. API lưu backup manifest digest caller khai báo, không giả vờ nhìn thấy external backup; CLI mới kiểm chứng backup cục bộ.

## RED → GREEN và kiểm chứng cuối

RED đầu tiên: importer chưa tồn tại; sau stub, DB prefix 6 chạy **10/10 fail NOT_IMPLEMENTED**, nên schema/FK đã thực sự được migrate trước GREEN. Docs event test fail EVENT_INVALID trước whitelist. CLI 3 tests fail CLI_NOT_IMPLEMENTED trước CLI thật. Receipt regression mới fail DOCS_SYNC_CONFLICT khi attempt thứ hai reuse snapshot rồi replay; PM duyệt receipt column, test sau sửa GREEN.

Các lỗi development khác đã xử lý: test giả định collation path bytewise trong DB (đổi truy vấn fixture sang COLLATE C, cả hai filename vẫn nguyên); test formatting guard làm mất biến fixture x và TS inference stdout trong child exec (đã sửa test). Không che hoặc bỏ qua failure; lượt kiểm chứng cuối không failure/skip.

Lệnh cuối trên cùng candidate:

| Lệnh | Kết quả |
|---|---|
| `pnpm --dir v2/server test --test-concurrency=1` | **153/153 PASS**, 0 fail/skip, khoảng 18.1 giây; một covering toàn server sau batch |
| `pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/docs-import.test.ts` | **19/19 PASS**, 0 fail/skip, khoảng 2.8 giây; đúng một absolute --test-file |
| `node --test v2/server/test/docs-import-cli.unit.test.ts v2/server/test/docs-events.unit.test.ts` | **6/6 PASS** (5 CLI + 1 events) |
| `pnpm --dir v2 test` | **14/14 PASS**, 0 fail/skip |
| `pnpm --dir v2 typecheck` | Exit 0 |
| `pnpm --dir v2/server typecheck` | Exit 0 |
| `pnpm exec biome check v2/server/src/docs/import.ts v2/server/src/journal/event-contracts.ts v2/server/test/support/docs.ts v2/server/test/docs-import.test.ts v2/server/test/docs-import-cli.unit.test.ts v2/server/test/docs-events.unit.test.ts v2/server/scripts/docs-import.ts` | 7 files, no diagnostics/fixes |
| `git diff --check` | Exit 0 |

Full suite gồm 19 DB import/sync, 5 CLI, 1 docs-events mới và 24 validator unit Stage A. Covering thực: byte CRLF/Unicode/null commit/case; repeated link 0/1/2 status ok/missing/ok; bad checksum/base64/UTF8/field/class/path/securitylink; malformed/colliding later project rollback; mapping collision; new backup reuse; new imported/sync commit same bytes preserve history; unrelated verified pointer unchanged; independent pool bundle/receipt races; transaction failure rollback bytes/events/key then same-key retry; fence/guard/binding/commit/scope conflicts; reserved finalizing; cancel denial; revoke racing cached replay observes real pg lock wait; immutable rows and cross-project FK; altered receipt input conflict; new attempt same snapshot replay succeeds.

Backup/restore rehearsal thực trong own container: source prefix 5 backup → empty fixture restore → migrate exact prefix 6; source then migrate 6/import mixed fixture → custom pg_dump → empty fixture pg_restore → import rerun gives same report, original raw bytes/SHA/class và một snapshot/import. Không backup/restore service dùng chung.

CLI fixture: supplied validDocs + workflow artifact CRLF/Unicode tạo 8 file ở `projects/<legacyProjectId>/<doc path>`; sourceBackup.path là relative regular file dưới thư mục manifest (layout PM approved). Hai dry-run cho cùng export, trước/sau mọi docs Buffer equal. Tests corruption/source backup, doc bytes, manifest class disagreement, symlink, secret args; upload HTTP loopback thật kiểm tra cookie/CSRF/payload/stable key; env và stdin đều hoạt động; redirect từ chối và không log server secrets.

Byte pre/post với fixture gốc trong checkout so baseline `9dca04e`:

`v2/server/test/fixtures/legacy-docs/crlf-unicode.md`: 36 byte, 2 CRLF; SHA trước/sau cùng `8463548e313aa8a34ca11e7ae4bacc2a6e7aefc00e15eb63b128ca1d121c7c94`. Stage A contracts/checksum/manifest/validator/links/docs-validator.unit.test.ts cũng byte-identical baseline (kiểm tra raw git show và file bytes bằng SHA256), không sửa source validator.

## Tài nguyên sở hữu và cleanup

Full covering runner: container ID `3fbc38a30683e766511aaa6d8d64eeffcfad32e33ce8da13b6cb28463c2933f9`, endpoint `127.0.0.1:62500`. Owned import final runner: `4004b007dc370d4f74e74603dffff11335fdb34c36c6dac698114f4c0cf20bf0`, endpoint `127.0.0.1:63135`. Runner tạo tên crew-v2-test-UUID, --rm và stop đúng ID trong finally; test helpers validate exact container name/port, tạo/drop đúng random crew_v2_test_UUID logical databases. Cả hai exact-ID `docker inspect` sau completion trả **no such object** (expected exit 1), chứng minh container đã dọn. Không dùng global docker delta/kill/prune.

CLI tạo `mkdtemp(crew-v2-docs-cli-*)`, ghi source fixture copy/manifest/bundle trong own directory và remove đúng dir trong finally. HTTP server/process thuộc tests, close sau completion; pg_dump/restore buffer chỉ nằm memory, không file backup tồn dư. Peer pools end trong finally. Các lượt RED/intermediate cũng qua own runner finally cleanup; không tài nguyên shared bị restart/recreate.

## Giới hạn và gate còn lại

- Không có owner v1 export thật, không credential/v1 DB/service access. Chỉ fixture được cấp; import toàn dự án thật chưa được thực hiện.
- Structural-valid legacy/checkout đều unverified; invalid legacy được lưu byte nguyên và audit issues, invalid sync bị reject. Không claim source tree/commit/freshness từ hash host tự khai.
- **Phase 08 handoff:** snapshot/receipt unverified hiện immutable, không tự trở thành verified hoặc latest_verified. Trusted attestation/verifier tương lai phải định nghĩa docs state/completion trung thực và đường xác minh phù hợp, giữ byte/provenance gốc. Task 6 không cung cấp upgrade verifier hoặc docs completion.
- Artifact-only snapshot không đáp ứng gate docs triển khai; mixed snapshot không đổi class của page. R3 chỉ flow prose cập nhật cùng code; cần review nội dung độc lập.
- Task 7 HTTP docs routes/read/search/tree/page/app assembly chưa viết; integration phải dùng authorizeDocsSync callback trước replay, body allowlist/removeAdditional:false và scope đúng actor.
- PM còn serialize manifest/generated docs, crew-docs staged check và commit; agent không stage/commit. Review độc lập chưa chạy khi report này được viết.
