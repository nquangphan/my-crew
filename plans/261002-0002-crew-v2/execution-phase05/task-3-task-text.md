## Task 3: Authorized routes, descendant refs và revocation

**Files:** Task3 row. **Consumes:** stage/submissions/types, phase02 auth/journal/ticket scope and actual execution attempt fields, phase03 binding revision. **Produces:**

```ts
export type AttachmentExecutionGate = (tx:Tx,actor:Actor,context:AttemptReadContext)=>Promise<void>;
export interface AttachmentInputServices {
  buildManifest(tx:Tx,input:{context:AttemptReadContext;decisionId:Id;required:RequiredInput[];
    inputRevision:string;snapshotId:Id;snapshotSha256:Sha256},actor:Actor):Promise<InputManifest>;
  appendReceipt(tx:Tx,input:InputReceipt,actor:Actor):Promise<Id>;
}
export function authorizeAttachment(tx:Tx,actor:Actor,input:{attachmentId:Id;
  context:AttemptReadContext|null;derivativeId:Id|null;manifestId:Id|null},
  gate:AttachmentExecutionGate):Promise<BlobHandle>;
export function inheritAttachmentLinks(tx:Tx,ticketId:Id,sourceLinkIds:Id[],actor:Actor):Promise<Id[]>;
export function registerAttachmentRoutes(app:FastifyInstance,options:ServerOptions,
  deps:RouteDependencies,services:{stage:StageServices;submissions:AttachmentSubmissions;
    store:BlobStore;executionGate:AttachmentExecutionGate;config:AttachmentConfig;inputs?:AttachmentInputServices}):void;
```

Task3 registers input-manifest/receipt routes với optional inputs producer; thiếu Task6 injection thì409 INPUT_SERVICES_NOT_CONFIGURED trước mutation, không import source chưa tồn tại. Task6 controller injects InputServices methods closing gate+selection authority. Gate mặc định ném lỗi `ATTACHMENT_EXECUTION_NOT_CONFIGURED`409. Controller's execution-owned implementation checks actor machine current/revocation, current project.machine_id+binding_revision, context ticket project/root, attempt machine/project/ticket/fence/processInstanceId and active guard, state active with valid lease (or exact allowed uncertain read needed for reconcile explicitly read-only under existing authority), no browser owner forging machine proof. For normal consume require active lease; uncertain/stopped attempt download denied409 ATTEMPT_NOT_ACTIVE. Resume creates fresh authorized attempt references same manifest original IDs; no permanent ACL on historical machine assignment. Source/workflow projection policy at runtime fetch boundary must still authorize attachment tool; server project grant doesn't bypass it.

- [ ] **Step 1 RED:** build API fixture using owner session/CSRF from identity app; register own routes on test app only. `machineContextFixture` explicitly persists phase02 claim + phase03 companion + reviewed fake test authorizer; no production default replaced. Test default-deny without gate separately.

```ts
test('attachment access never follows a matching checksum across projects', async()=>{
  await databaseFixture(9)(async db=>{
    const f=await attachmentAccessFixture(db); // Task3 support extension, definition below
    try {
      const a=await f.linkFile('A',Buffer.from('same bytes'));
      const b=await f.linkFile('B',Buffer.from('same bytes'));
      assert.equal(a.sha256,b.sha256); assert.notEqual(a.attachmentId,b.attachmentId);
      const denied=await f.machineDownload('A',b.attachmentId);
      assert.equal(denied.statusCode,404);
      assert.equal((await f.machineDownload('A',a.attachmentId)).statusCode,200);
    } finally {await f.close();}
  });
});
```

`attachmentAccessFixture(db)` extends Task1 support under controller ownership transfer (not concurrent edits): creates two projects A/B, two registered machines using real provision+bind APIs, active test attempts; methods `linkFile(project:'A'|'B',bytes):Promise<AttachmentRef>`, `machineDownload(project,id):Promise<LightMyRequestResponse>`, `rebindAfterStop(project):Promise<void>`, `close`. Tokens generated at runtime and redacted. Tests descendants source ancestor valid; sibling/nonancestor/tree/project mismatch denied; direct link to child shouldn't copy blob row; no public hash endpoint; revoked token401, old machine after rebind404, stale fence409, wrong context project404, derivative of another original404; owner unlinked compose allowed, machine unlinked404; all unknown fields400/unsupported MIME415/limits413.
- [ ] **Step 2 RED run:** `pnpm --dir v2/server test --test-name-pattern='attachment access|attachment routes|attachment references'`; first missing symbols → expected RED.
- [ ] **Step 3 GREEN:** implement complete HTTP table, strict schemas, route normalization/idempotency; child refs via recursive ancestor query under same root lock. Recheck current authorization on every GET, including conditional requests; no 304 before permission. For streaming, open FD after auth then before first byte confirm binding revision/token/attempt once more in short transaction. Bind/revoke commits after stream starts invalidate future chunks: revalidate per64KiB chunk or <=1s whichever first and abort on mismatch. Cannot retract bytes already delivered; document precise semantics and test mid-stream stop. Do not retain global long-lived auth cache. Immutable original never auto-deleted after link.

```ts
// routes.ts parser lives in scoped plugin; never buffer raw upload in Fastify.
app.register(async uploadApp=>{
  uploadApp.addContentTypeParser('application/octet-stream',(request,payload,done)=>done(null,payload));
  // PUT handler authenticates/CSRF before service lease; service meters every chunk.
  // request.body is narrowed by route-local stream guard before stage.receive(...).
});
```

Define route-local `isByteStream(value:unknown):value is AsyncIterable<Uint8Array>` by asyncIterator callable, no client object executable path (actual Fastify parser object only). Unexpected request content-type rejected, request aborted closes stream+lease generation. On repeated ready PUT fully meter/hash body then return existing result; no overwrite. Blob response content-length exact stored bytes, attachment disposition; MIME remains detected safe mapping, never original untrusted header. Deployed reverse proxy must forward auth and enforce bounded timeout/size >= configured max (phase09 handoff).
- [ ] **Step 4 GREEN run:** focused tests and middleware regressions/typecheck. Slow-stream test with barrier lets rebind/revoke commit between chunks; first old bytes received is permitted, later chunks denied; next request404. Test cache-control headers and no storage keys/token in response/events/log capture.
- [ ] **Step 5 docs/review/commit:** server-attachments + server-identity/server-tickets pages only when respective source changed; controller commit `feat(attachments): enforce scoped downloads and descendant references`.

