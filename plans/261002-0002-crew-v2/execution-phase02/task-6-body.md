## Task 6: Preserved docs import, independent validator and checksum audit

**Owner:** docs-ingest worker. **Files:** create `src/docs/{contracts,checksum,manifest,validator,links,import}.ts`, `migrations/006_docs.sql`, `test/docs-validator.unit.test.ts`, `test/docs-import.test.ts`, `test/support/docs.ts`, fixture directory `test/fixtures/legacy-docs/` (nonsecret text), `scripts/docs-import.ts`. Docs `server-docs-import.md`.

**Interfaces:**

```ts
export type DocsFile={path:string;bytesBase64:string;sha256:string;contentClass:'implemented'|'workflow_artifact'};
export type AuditIssue={code:string;path:string;message:string;severity:'error'|'warning'};
export type DocsImport={sourceSystem:'crew-v1';backupManifestSha256:string;bundleSha256:string;
  inventory:{legacyProjectId:string;key:string;name:string;repositoryUrl:string|null;
    sourceCommit:string|null;snapshotSha256:string;files:DocsFile[]}[]};
export type ImportResult={importId:Id;projects:{projectId:Id;legacyProjectId:string;
  snapshotId:Id;auditState:'unverified'|'invalid';issues:AuditIssue[]}[]};
export type DocsSync={sourceCommit:string;snapshotSha256:string;files:DocsFile[];
  attemptId:Id;fence:string};
export type DocsValidationInput={files:Map<string,Buffer>;contentClasses:Map<string,DocsFile['contentClass']>;trackedSourcePaths:string[];
  mode:'legacy_import'|'checkout_sync'};
export type DocsValidationResult={issues:AuditIssue[];valid:boolean;links:DocLink[]};
export type DocLink={fromPath:string;occurrence:number;originalHref:string;toPath:string;fragment:string|null;
  status:'ok'|'missing'|'external'|'unverified'};
export function hashBytes(bytes:Buffer):string;
export function snapshotHash(files:DocsFile[]):string;
export function validateDocs(input:DocsValidationInput):DocsValidationResult;
export function importDocs(tx:Tx,input:DocsImport,actor:Actor):Promise<ImportResult>;
export function syncDocs(tx:Tx,projectId:Id,input:DocsSync,actor:Actor):Promise<Id>;
```

Import source contract JSON only allowlisted fields; unknown ticket/machine/token fields rejected400 rather than silently imported. File paths allow `AGENTS.md`, `CLAUDE.md`, `docs/**` and `_bmad-output/**` explicitly inventoried as workflow_artifact. Every file carries contentClass, original bytes/path retained. Known workflow prefixes `docs/superpowers/specs/**`, `docs/superpowers/plans/**`, `docs/bmad/**`, `docs/artifacts/**`, `_bmad-output/**` must be workflow_artifact (wrong class422); standard `AGENTS.md`, `CLAUDE.md`, docs/index,architecture,files,flows.yaml,flows/** must be implemented. Other inventoried docs/** paths require explicit exporter class; never infer mixed bundle all implemented. CLI backup inventory includes same per-file class and enforces class agreement. A snapshot aggregate class is implemented if all files implemented, workflow_artifact if all artifact, mixed otherwise. Validator applies STANDARD structure/headings/generated blocks only to implemented standard docs; original workflow format remains unchanged. Links resolve across both classes in the same immutable snapshot. Snapshot audit invalid/unverified never upgrades artifact page to implemented code proof. audit_state verified on mixed snapshot means implemented STANDARD subset and commit verified; workflow artifact pages remain contentClass workflow_artifact, never satisfy required implemented pages. Artifact-only snapshots cannot satisfy project docs gate even if artifact-specific integrity audit passes. Path must relative POSIX, no leading slash/backslash/empty segment/`.`/`..`/NUL/percent-decoded traversal; path length<=1024, each file<=1MiB decoded, <=2000 files/project, <=100 projects/import, total<=16MiB. Distinct case-sensitive paths preserved, reject duplicate exact paths. UTF8 strict via TextDecoder fatal; raw bytes not decode→encode before hash. Reject symlink information or files outside allowlist. No network fetch of repositoryUrl/Markdown links.

`backupManifestSha256` must match local backup inventory checksum, imported CLI verifies backup files before upload; API records proof checksum without pretending it can see external backup. Bundle sha is SHA256 UTF8 canonicalJson({sourceSystem,backupManifestSha256,inventory}) excluding bundleSha field. snapshot hash SHA256 canonicalJson(sorted tuples `[path,sha256,decodedByteLength,contentClass]`); order-independent, metadata sourceCommit not part bytes hash. Same bytes at new commit must not reuse old sourceCommit silently: unique `(project_id,source_kind,snapshot_sha,content_class,coalesce(source_commit,''))` expression index, replacing initial table UNIQUE that omits commit. Imported immutable source provenance identity `(source_system,legacy_id)` maps existing project only if same previous mapping; project key collision different legacy id409, never promotes/overwrites unrelated project.

- [ ] Before DB RED: Task5 SQL/integration gate passed, controller freezes schema prefix006 and checks FK ticket_docs/attempts exist. Source unit validator tests may run in parallel with4/5 via `node --test test/docs-validator.unit.test.ts`; create this unit test filename instead of docs-validator.test.ts for non-DB checks. Full006 migration creation/application and import DB RED/GREEN serialize after5; no docs worker rewrites earlier migrations. Then write RED preservation/rerun tests:

```ts
test('import giữ CRLF/Unicode và chạy lại không trùng',async()=>withDatabase(async db=>{
  const raw=Buffer.from('# Tài liệu\r\nNội dung tiếng Việt 😀\r\n','utf8');
  const bundle=legacyBundle({'docs/index.md':raw}); // computes backup/snapshot/bundle checksums
  const a=await importWithKey(db,bundle,'import-a');
  const b=await importWithKey(db,bundle,'import-b');
  assert.equal(a.importId,b.importId);
  const saved=await db`select bytes,sha from docs_files where path='docs/index.md'`;
  assert(Buffer.from(saved[0]!.bytes).equals(raw));
  assert.equal(saved[0]!.sha,hashBytes(raw));
  assert.equal(a.projects[0]?.auditState,'invalid'); // missing required manifest; preserved with violations
  assert.equal((await db`select count(*)::int as n from projects`)[0]?.n,1);
}));
test('checksum sai rollback toàn bộ batch',async()=>withDatabase(async db=>{
  const bundle=legacyBundle({'docs/index.md':Buffer.from('# Docs')});
  bundle.inventory[0]!.files[0]!.sha256='0'.repeat(64);
  await assert.rejects(()=>importWithKey(db,bundle,'bad-hash'),{code:'CHECKSUM_MISMATCH'});
  assert.equal((await db`select count(*)::int as n from docs_imports`)[0]?.n,0);
  assert.equal((await db`select count(*)::int as n from projects`)[0]?.n,0);
}));
```

Fixtures defined Task6: `legacyBundle(files:Record<string,Buffer>,classes?:Record<string,DocsFile['contentClass']>):DocsImport` (known paths classified deterministically by default, supplied classes override only in fixture to construct negative inputs; helper recomputes all checksums, production importer enforces known-path classification; unknown path requires classes entry), `importWithKey(db,input,key):Promise<ImportResult>` uses journal mutate; `.fixtures` contains valid AGENTS/CLAUDE/index/architecture/manifest/files/flow required headings and generated blocks. Add fixtures duplicate YAML flow keys, source unmapped, wrong heading order, stale block, link missing/traversal, CRLF, invalid UTF8, mixed-case filename, corruption second project; no v1 DB connection.

- [ ] RED `pnpm --dir v2/server test --test-name-pattern='import|checksum|heading|manifest|link'`.
- [ ] Implement byte verification before database changes, transaction rollback entire batch, snapshot immutable. Legacy import invalid docs stores audit errors and bytes with state invalid; valid structural import stores unverified because no checkout comparison. `sourceCommit:null` remains null; no guessed commit. Rerun same bundle returns stored report no new event/snapshot/project, even with new idempotency key; different backup manifest/bundle produces new import record, identical immutable snapshot reused if provenance matches. Multiple snapshots retain history, project latest pointer can advance only expected source provenance, not overwrite newer verified snapshot with old import.

```ts
for(const f of project.files){
  const bytes=Buffer.from(f.bytesBase64,'base64');
  if(bytes.toString('base64')!==f.bytesBase64)throw new ApiError('INVALID_BASE64',400,'Mã hóa file không hợp lệ');
  if(hashBytes(bytes)!==f.sha256)throw new ApiError('CHECKSUM_MISMATCH',422,'Checksum file không khớp');
  new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
const [known]=await tx`select id,report from docs_imports where source_system=${input.sourceSystem}
  and bundle_sha=${input.bundleSha256}`;
if(known)return known.report as ImportResult;
```

Manifest v2 independent TypeScript shape `Manifest={version:1,source:{include:string[],exclude:string[]},flows:Record<string,{title:string,doc:string,entrypoints:string[],files:string[],tests:string[]}>,shared:Record<string,string[]>,unassigned:{path:string,reason:string}[]}`; yaml `parseDocument(text,{uniqueKeys:true})`, toJS with alias count max50, bounded length before parse, catch parser RangeError into issue. Reject inherited/prototype keys and unexpected keys, flow id `^[a-z][a-z0-9-]*$`; lists string and no duplicates. Implement STANDARD R1/R2/R4 snapshot checks plus headings in fixed order, all mapped files present in `trackedSourcePaths` for checkout_sync, no unassigned overlap, shared target exists. Import has docs only, so unavailable source existence/coverage must generate `SOURCE_TREE_UNVERIFIED` warning, never valid code freshness. No R3 claim from snapshot alone; final diff/review gate phase08.

Generator independently emits exact STANDARD tables/markers, sort paths and flow IDs deterministic, compares blocks preserving surrounding prose; source coverage uses picomatch dot:true include minus exclude. `validateDocs` checkout_sync needs host trackedSourcePaths field: extend `DocsSync` with `trackedSourcePaths:string[]`, `sourceTreeSha256:string`, `verificationEvidenceId:Id`; checksum source list computed sorted canonical JSON, evidence must reference same merged commit/project/attempt and trusted verifier. Until phase08 server default evidence verifier denies audit_state verified; sync can store unverified structural-valid result, invalid sync422, imported invalid retained. No source code content sent, only paths.

`links.ts`: resolve relative links using URL/path.posix anchored from docs source directory; decode URL path once, reject escape/query path tricks, split fragment; external http/https/mailto tagged external not fetched. Support inline/reference Markdown links, images and heading anchors, skip fenced/inline code; unsupported nested/custom Markdown syntax yields `UNVERIFIED_LINK_SYNTAX` audit warning rather than asserting all links checked. Preserve original content, originalHref and occurrence (zero-based order of parsed link token in each source page) in audit report/table. Multiple fragments to same destination are separate rows and audited separately, fully repeated link occurrences also retained. fragment missing marks that occurrence missing; duplicate headings deterministic anchor suffix mapping recorded; unknown slug syntax unverified rather than falsely ok. Broken required internal link marks invalid; references to workflow artifacts outside snapshot warning `EXTERNAL_ARTIFACT_NOT_IMPORTED`. Security path traversal always rejected before content import; ordinary broken link is retained/audited.

`docs-import.ts` receives `--bundle` and `--backup-manifest` filenames, verifies both locally; requires existing owner session/CSRF read from stdin/env, never CLI args/log. `--dry-run` produces counts/checksums/violations without network writes. Backup inventory manifest `{version:1,sourceSystem:'crew-v1',exportedAt,sourceBackup:{path,sha256},projects:[{legacyProjectId,sourceCommit,files:[{path,sha256,size,contentClass}]}]}` created outside server, immutable file; verify sourceBackup path and all docs file hashes before accepting checksum. Export production v1 requires owner authorized backup separate operation; implementation uses provided export fixture and never reads v1 credentials/DB. Run rerun test against copied export folder, checksum source folder before/after byte identical.

- [ ] Add RED/GREEN mixed-bundle and fragment identity fixtures before committing Task6; Task7 consumes the same fixture for real HTTP tree/search:

```ts
test('mixed docs/artifact giữ byte và class riêng',async()=>withDatabase(async db=>{
  const flow=Buffer.from('# Flow đã triển khai\r\nNội dung máy Mac');
  const spec=Buffer.from('# Thiết kế dự kiến\nMáy Mac chưa triển khai');
  const bundle=legacyBundle({'docs/flows/machine.md':flow,
    'docs/superpowers/specs/design.md':spec});
  const imported=await importWithKey(db,bundle,'mixed');
  const rows=await db`select path,content_class,bytes from docs_files order by path`;
  assert.equal(rows[0]?.content_class,'implemented');
  assert.equal(rows[1]?.content_class,'workflow_artifact');
  assert(Buffer.from(rows[0]!.bytes).equals(flow));assert(Buffer.from(rows[1]!.bytes).equals(spec));
  assert.equal((await db`select content_class from docs_snapshots`)[0]?.content_class,'mixed');
  const bad=legacyBundle({'docs/superpowers/plans/p.md':spec},
    {'docs/superpowers/plans/p.md':'implemented'}); // helper hashes exact supplied classes
  await assert.rejects(()=>importWithKey(db,bad,'wrong-class'),{code:'CONTENT_CLASS_MISMATCH'});
}));
test('hai fragment và link lặp cùng trang không mất audit',()=>{
  const input=docsValidationFixture({'docs/a.md':Buffer.from('[Một](b.md#one) [Sai](b.md#absent) [Lặp](b.md#one)'),
    'docs/b.md':Buffer.from('# One')});
  const links=validateDocs(input).links.filter(x=>x.fromPath==='docs/a.md');
  assert.equal(links.length,3);assert.deepEqual(links.map(x=>x.occurrence),[0,1,2]);
  assert.deepEqual(links.map(x=>x.status),['ok','missing','ok']);
});
```

`docsValidationFixture(files:Record<string,Buffer>):DocsValidationInput` owned support/docs.ts supplies remaining required docs from valid fixture, classes available in DocsValidationInput through new `contentClasses:Map<string,DocsFile['contentClass']>` property. DB link fixture asserts three rows keyed occurrence survive roundtrip/reimport. Task7 tree/search/page test searches `Máy Mac` in mixed snapshot, asserts both distinct labels/sourceCommit/checksums, per-page original bytes and tree class mixed; phase07 UI consumes per-page label, never aggregate as page label.

- [ ] GREEN byte+checksum+rereun tests, full validator fixture tests, import forbidden-field test rejects token/machine/ticket400, malformed later project leaves zero partial imports. Commit `feat(v2): import preserved project docs with checksum audit`, flow doc includes structural/audit limitations; independent review on data loss/checksum trust/path escapes.

