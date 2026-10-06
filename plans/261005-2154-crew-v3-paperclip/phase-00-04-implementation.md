# Crew remote prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development theo PM đã được owner giao, hoặc superpowers:executing-plans nếu PM giao inline. Theo từng gate có checkbox; worker core giữ context, reviewer độc lập. Không tự spawn/commit/qua successor. Plan này chưa được thực thi; independent review trước coding.

**Goal:** Chứng minh Paperclip tạo và giữ một run thực qua gateway Mac outbound, với workspace riêng, log/result/session, cancel và restart không chạy trùng.

**Architecture:** Paperclip là scheduler/state authority duy nhất. Crew sidecars giữ machine binding, reservation và delivery/replay evidence tham chiếu core run; adapter Promise theo dõi run, gateway chỉ thực thi envelope đã cấp quyền. Prototype chạy Node fixture process miễn phí trên Mac; không giả đây là chứng nhận Claude/Codex/API provider hoặc production VPS.

**Tech Stack:** Paperclip stablev2026.1001.0 SHA`8f8a0ab7effbd6a0584107d8038736c134ee5047`, Node24.14.0, Corepack pnpm9.15.4, TypeScript7.0.2, Vitest4.1.11, actual Express/Drizzle/PostgreSQL, native Node child process + HTTP long-poll outbound.

**Spec:** [design](../../docs/superpowers/specs/2026-10-05-crew-v3-paperclip-design.md), [baseline](baseline.md), [seams](phase-00-core-findings.md), [reuse map](implementation-map.md), [setup](phase-00-03-report.md). Scope là00-04, không thay toàn roadmap R1/R2.

## Global Constraints

- Code chỉ ở `/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-v3`, branch `v3`; prose/report chỉ primary plan folder. Giữ sourcev2 SHA`51907858d0c8cdb7329759f22104f0727dbe6751`.
- Một scheduler; mỗi project đúng một execution machine. Unknown process không được release reservation/spawn replacement. Event replay không cấp thêm quyền.
- Credential AI ở Mac; gateway device credential tách agentJWT. Optional token thiếu thì task cần API access fail closed trước dispatch. Không log secret hoặc tải ambient provider key.
- UI/docs tiếng Việt, identifiers tiếng Anh, timestamps Asia/Ho_Chi_Minh. Prototype không UI/production/VPS deploy.
- DB chỉ localhost disposable, cấm5432/55432; backup trước mutation/migration, restore sang target mới; không reset shared DB.
- Một heavy job tại một thời điểm, fresh resource admission cho install/build/DB/native. Stop khi pressure warning/critical; không tự retry vòng lặp.
-00-01/02 accepted và00-03 scopedsetup accepted là prerequisites; native runner binaries chưa ready. Không chạy `paperclip_runner`, Rust hoặc fullsuite chỉ để làm fixture.

## Review Focus

1. Core không đọc/clone/provision/finalize repo chỉ Mac; OS denial test trước lifecycle test — task04-B.
2. Token thiếu/sai scope và cross-company/device replay không được mở process —04-A/C.
3. Cancel trong khoảng spawn chưa READY hoặc ACK mất phải giữ ownership tới physical stop proof —04-D.
4. Server/gateway restart, old epoch/event/result không tạo run/session/provider mới —04-E.
5. Backup/restore và teardown không mất evidence hoặc xóa/kill process ngoài task —04-B/E.

## Source delta đã trace

Tất cả line dưới là pinnedSHA trên, không master inference:

| Exact existing seam | Đã xác minh | Quyết định |
|---|---|---|
| `server/src/services/environment-run-orchestrator.ts:346–416` `realizeForRun(input): Promise<EnvironmentRealizationResult>` | Chuẩn bị request→driver.realizeWorkspace→persist→target | Không gọi adapter rồi giả workspace core đã đúng |
| `environment-runtime.ts:3474–3502`; `plugin-environment-driver.ts:500–518` | Plugin RPC `environmentRealizeWorkspace` tồn tại | Có thể reuse driver lifecycle nhưng chưa đủ target/outbound |
| `environment-execution-target.ts:223–254,630–654` | local→local; sandbox branch; cuối chỉ SSH, plugin thường→null | Không giả `transport:crew` đã tồn tại; quyết định patch riêng04-B |
| `heartbeat.ts:12464–12487,21384–21476,21665,22114–22162` | Anchor resolution/host realization trước environment target | Bypass chỉ một helper cuối không đủ Mac-only isolation |
| `workspace-runtime.ts:124–174,3198–3243` | RealizedExecutionWorkspace chứa cwd/strategy/ownership; project_primary trả baseCwd không Gitworktree | Cwd là tọa độ Mac có provenance, không tạo placeholder cwd trên server |
| `legacy-controller-lease.ts:6–8,13–68` | BootUUID; claim60s/renew10s; CAS revoke expiry chỉ cấp cleanup | Cần CAS adoption hook; expiry không là stopped proof |
| `heartbeat.ts:19930–19937,19017–19147` | executeRun options hiện chỉ native recovery; orphan legacy có thể process_lost | `crewRecovery` là API MỚI nếu được review, không SDK hiện hữu |
| `routes/adapters.ts:303–405` | install instanceadmin, localPath, load+registry+persist | Dùng actual route registration trong integration |
| `packages/db/src/test-embedded-postgres.ts:273–312` | helper tự createDB+migrate trước return | Không gọi helper này rồi mới backup để claim backup-before-mutation |
| `packages/db/src/backup-lib.ts:16–44`; db index exports | runDatabaseBackup/Restore có JS engine | Không cần cài pg_dump; explicit JS backup |
| `__tests__/helpers/runner-api-server.ts:22–40` | createApp authenticated/private, actualHTTP localhost0 | Reuse pattern, không fixture native manually inserted run của helper |

00-03 reviewer lưu ý ENOENT binlinks cho native runner/eval/proxy/sidecar/SDK devserver sau install.04-A kiểm đúng TS/module closure cần dùng; không dùng các bins này. Adapter-utils workspace exports sourceTS; Node launch qua existing tsx executable do `corepack pnpm --filter @paperclipai/server exec tsx` resolve, không đọc dependency path bị hook chặn.

## File ownership map

Mọi worker biết không làm một mình, không revert edits. PM serialize shared files/lock/schema/Git. Các path dưới relative fork.

| Gate | NEW files | Existing files có thể sửa sau gate |
|---|---|---|
|04-A|`packages/crew-remote-adapter/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/contracts.ts,src/codec.ts,src/transport.ts,src/adapter.test.ts}`|`pnpm-lock.yaml` chỉ PM khi workspace manifest thực cần đổi; `pnpm-workspace.yaml` không cần vì `packages/*` đã include |
|04-B|`server/src/crew/remote/{workspace.ts,store.ts,contracts.ts,migrations/001_remote.sql}`, `server/src/__tests__/{crew-remote-workspace.test.ts,helpers/crew-remote-harness.ts,helpers/crew-remote-server.ts,helpers/crew-backup-db.ts,helpers/crew-remote-runner.mjs}`|`server/src/services/heartbeat.ts`; environment files chỉ nếu patch decision ghi rõ bắt buộc; `server/src/app.ts` composition sau04-C |
|04-C|`server/src/crew/remote/{routes.ts,admission.ts,events.ts}`, `packages/crew-remote-adapter/src/{gateway.ts,journal.ts,fixture-process.ts}`, `server/src/__tests__/crew-remote-integration.test.ts`|`server/src/app.ts` route mount; `server/src/middleware/auth.ts` exact device-path credential boundary; `heartbeat.ts` claim/dispatch bridge |
|04-D|`packages/crew-remote-adapter/src/stop.ts`, `server/src/crew/remote/cancel.ts`, `server/src/__tests__/crew-remote-cancel.test.ts`|`heartbeat.ts` cancellation bridge |
|04-E|`server/src/crew/remote/recovery.ts`, `server/src/__tests__/crew-remote-recovery.test.ts`|`heartbeat.ts` reaper/executeRun options; `legacy-controller-lease.ts` typedCAS adoption nếu cần |

Không sửa `.claude/**`, `.githooks/**`, `CLAUDE.md`, `AGENTS.md`, `.github/**` hoặc primary docsflows. Fork chưa áp dụng Crew docs-kit/R2/R3: upstream AGENTS là authority, không tự tạo flows.yaml. Upstream development policy giao lockfile cho CI; nếu new workspace importer cần lockdelta, PM chốt fork lock policy và review exact diff trước install, không chạy no-frozen để che stale lock. Mỗi gate ghi report/proposed patchregistry ở primary, không Markdown trong fork. Source commit chỉ PM sau review/docs checks, không auto commit từ skill.

## New contracts (đề xuất phải review, không phải upstream exports)

`packages/crew-remote-adapter/src/contracts.ts` định nghĩa:

```ts
export type RemoteIdentity = {
  companyId: string; projectId: string; issueId: string; runId: string;
  agentId: string; machineId: string; reservationId: string; epoch: number;
  workflowDigest: string; runtime: "node_fixture";
};
export type SessionPin = RemoteIdentity & { sessionId: string };
export type RemoteEvent = { identity: RemoteIdentity; sequence: number;
  kind: "ready" | "stdout" | "stderr" | "result" | "stopped";
  digest: string; payload: Record<string, unknown> };
export type StopProof = { identity: RemoteIdentity; executionNonce: string;
  rootStopped: true; descendantsStopped: true; journalSequence: number };
export interface RemoteTransport {
  attach(identity: RemoteIdentity, afterSequence: number, token: string): AsyncIterable<RemoteEvent>;
  cancel(identity: RemoteIdentity, requestId: string, token: string): Promise<void>;
}
```

`createServerAdapter(): ServerAdapterModule` vẫn zero-argument theo loader; execute tạo HTTP transport từ server-validated run config, không nhận agent-chosen destination URL. Export `createRemoteAdapter(transport: RemoteTransport): ServerAdapterModule` chỉ dependency-injection unit seam, factory production gọi với HTTPimplementation. Codec export `sessionCodec: AdapterSessionCodec`; reject reused params khác company/project/machine/workflow/runtime hoặc active session khác run.

New server interface:

```ts
export type Admission = { kind: "admitted"; identity: RemoteIdentity }
  | { kind: "wait"; reason: "offline" | "stale_telemetry" | "capacity" | "ownership" };
export type Adoption = { kind: "adopted"; identity: RemoteIdentity; afterSequence: number }
  | { kind: "hold"; reason: string } | { kind: "terminal"; proof: StopProof };
```

`reserveRemoteRun(tx, runId): Promise<Admission>` transaction đọc locked core run + machinebinding, insert/update reservation unique active machine capacity (prototype capacity1), TTL telemetry≤15s. `adoptRemoteRun(tx, runId, expectedEpoch): Promise<Adoption>` CAS core controller + sidecar epoch, không INSERT heartbeatRuns. Mỗi sidecar query mang company/run guard; API body không được sửa authority fields.

Sidecar schema `crew_remote` chỉ `machines`, `project_bindings`, `reservations`, `deliveries`, `events`, `session_pins`; FK company/project/issue/run về core. Unique(company,run), unique(reservation,epoch,sequence); payload digest conflict409, identical duplicate return originalACK. Delivery chỉ projection của coreadmitted run, không timer chọn task hoặc independent runnablequeue. Current epoch increment lúc controller adoption, executionNonce giữ identityprocess; replay đổi epoch chỉ khi gateway nhận verified adoption, không sinhprocess.

##04-A — Adapter contract/auth/session (score8=1+3+2+2, A high)

Prereq00-03 accepted + plan independent review. Samecoreworker; independent reviewer trước04-B.

- [ ] Tạo newpackage source/manifest dùng existing adapter-utils workspace dependency, new `vitest.config.ts` export defineConfig({test:{include:["src/**/*.test.ts"],maxWorkers:1}}); kiểm import `createServerAdapter` và exacttypes trước làm runtime. Package mới không thêm network dependency.
- [ ] Viết test đầu với transportspy; contextfixture `makeContext(overrides)` trả đủ AdapterExecutionContext và valid coreUUIDs, signal/new AbortController, onCancellationReady spy, onLog async no-op, agent/runtime minimal đúng actualtypes. Đây là test helper mới, không API upstream.

```ts
it("missing API token never starts delivery", async () => {
  const attach = vi.fn();
  const adapter = createRemoteAdapter({ attach, cancel: vi.fn() });
  const result = await adapter.execute(makeContext({ authToken: undefined }));
  expect(result.errorCode).toBe("crew_remote_auth_required");
  expect(attach).not.toHaveBeenCalled();
});
it("codec rejects changed project binding", () => {
  const pin = makeSessionPin();
  expect(validateSessionPin(pin, { ...pin, projectId: otherProjectId })).toBe(false);
});
```

`makeSessionPin(): SessionPin`, `validateSessionPin(pin:SessionPin,current:RemoteIdentity):boolean`, `otherProjectId` fixtureuuid đều tạo trong task. Meaningful RED: install factory skeleton returns adapter; execute wrongfully attach without auth yields spyassertion fail, rồi implement failclosed. Không coi importerror đơn thuần là behavioral RED.

- [ ] Thêm tablecases: validtoken, missingtoken, cancellation alreadyaborted, cancelreadiness rejected, project mismatch, workflow mismatch, machine mismatch, cumulativeusage replay = ít nhất8 named cases. `supportsLocalAgentJwt:true` chỉ legacy; token verification server-side thật ở04-C, không unitdecode claim thành authority.
- [ ] Cwd fork root: `corepack pnpm --filter @crew/remote-adapter exec vitest run --maxWorkers=1` (Vitest root dependency existing). Trước test, `corepack pnpm --filter @paperclipai/server exec tsx --version` và `corepack pnpm exec vitest --version`; nếu bin/module thiếu, checkpoint PM, không tự nativebuild/install. Không skip test ngoài include.
- [ ] Verify factory qua existing `loadExternalAdapterPackage` với localpath + registrationroute body `{packageName:absolutePackageDir,isLocalPath:true}` ở04-C. Review testcount8+, capabilityflags, sessioncodec và zero-secretlog. Không dùng nativebin.

## Bootstrap isolation bắt buộc cho 04-B–E (closure F1)

NEW `server/src/__tests__/helpers/crew-remote-runner.mjs` chỉ import Node builtins. Chạy bằng Node từ fork root; không import app/registry/Vitest config trước tạo owned root. Runner có bảng gate/test-file/scenario-name cố định, validate gate và chạy từng scenario trong Vitest child riêng bằng `--testNamePattern` exact escaped name, `--maxWorkers=1`; scenario mới → home/instance mới. Không nhận arbitrary test path/DSN/env override. Worker B phải freeze bảng scenario names khi viết tests; missing manifest entry là error, không skip.

Trước spawn test child, tạo marker/root/home/tmp/config/logdir, `PAPERCLIP_HOME=<owned root>/paperclip`, `PAPERCLIP_INSTANCE_ID=<scenario UUID>`, `HOME=<owned root>/home`, `TMPDIR=<owned root>/tmp`, `NODE_ENV=test`, `LANG=C`, `TZ=Asia/Ho_Chi_Minh`. Child env là object allowlist xây mới, KHÔNG spread process.env; PATH chỉ Node/Corepack executable directories đã resolve cùng `/usr/bin:/bin:/usr/sbin:/sbin`. Sinh riêng random signing secrets `PAPERCLIP_AGENT_JWT_SECRET` và `BETTER_AUTH_SECRET`; chỉ chuyển bằng child env, không argv/log. Không truyền ambient DATABASE_URL/PAPERCLIP_TEST_DATABASE_URL, provider keys, NODE_OPTIONS hoặc user config variables. Runner test có env này **trước import Vitest config/test modules**; API child dùng explicit allowlist của scenario và connection string generated bởi owned DB helper. Gateway child có allowlist riêng loại cả hai signing secrets và DB connection; chỉ nhận device credential task-owned và run JWT do API cấp qua authenticated transport khi cần. Không set env muộn trong beforeEach.

API child phải assert root marker/canonical home/instance trước dynamic import app/registry. Restart trong một scenario giữ nguyên home, instance, signing secrets và DB; process mới tạo fresh controller boot UUID. Sau registration assert adapter-plugins.json/settings/log/config đều nằm trong owned root; đối chiếu hash/stat user home không thay đổi (không đọc credential contents). Scenario mới có root mới; cleanup chỉ marker-owned root. Bootstrap imports registry có thể load external adapters: first import phải thấy empty owned store. Unit thuần04-A không import registry/app và chưa bắt buộc DB harness; registration test04-C bắt buộc wrapper này.

Các command B–E dưới chỉ được chạy sau runner isolation + backup bootstrap review; runner không thay thế contract backup của helper. Timeout runner theo F3 bên dưới. Chỉ worker implementation tạo runner, lượt plan này không có file executable mới.

##04-B — Workspace patch decision + backed-up harness (score9=1+3+3+2, A high)

Đây là gate độc lập: reviewer có thể reject patchchoice dù04-A đạt. Không mở transportintegration trước review gate này.

- [ ] Tạo isolatedharness APIchild + gateway child riêng, API chạy `/usr/bin/sandbox-exec` profile `(version 1)(allow default)(deny file-read* file-write* (subpath "GATEWAY_ROOT"))`; thay GATEWAY_ROOT bằng path mkdtemp đã escape, không userinput. OS test APIchild `readFile(repoSentinel)` phải EPERM; gatewaychild đọc được cùng file. sandbox-exec hiện có trên host, nhưng chạy profile là gate mới; nếu unsupported/failsclosed thì stop gate, không đổi sang fakecwd để xanh.
- [ ] API dùng actual `createApp(db, options)`; new `createHarnessAppOptions(): Parameters<typeof createApp>[1]` phải cấp đủ uiMode="none", deploymentMode="authenticated", deploymentExposure="private", bindHost/allowedHostnames=127.0.0.1, serverPort=0, storageService(task-owned root), authReady=true, companyDeletionEnabled=false, instanceId=task UUID, localPluginDir=taskdir, managedPluginAutoInstall=[], decisionServiceOptions và real betterAuthHandler/resolveSession; reuse options pattern helper existing, dùng real BetterAuthsession/board credential setup, không inject alwaysadmin resolveSession cho acceptance.
- [ ] Với existing pluginenvironment RPC, viết RED thử repo Mac-only không mount/copy vào API. Existing `resolveEnvironmentExecutionTarget` trảnull cho ordinaryplugin là assertion evidence. Freeze decision: prototype chọn adapter-specific workspacebranch trong `heartbeat.ts` trước `resolveWorkspaceForRun`; server đọc verifiedbinding/receipt, không chạy Git/hostprovision/cleanup trên Mac cwd. Không mở rộng targetunion theo phỏng đoán. Nếu commonpostprocessing còn đòi localIO, test phải fail và worker đưa exact additionalcallsite vào patchregistry cho re-review trước continue.

```ts
it("core cannot read Mac repo yet the gateway realizes it", async () => {
  const h = await createWorkspaceHarness();
  try {
    expect(await h.apiCanReadGatewayRepo()).toBe(false);
    const probe = await h.realizeWorkspaceProbe();
    expect(probe.hostRepositoryOperations).toEqual([]);
    expect(probe.gatewaySentinel).toBe(h.sentinel);
  } finally { await h.close(); }
});
```

04-B probe dùng actual API sandbox child và gateway child qua private IPC để nhận receipt, gọi workspace bridge thật; chưa claim core run lifecycle. 04-C mới nối full dispatch và kiểm lại cùng OS boundary. Các methods thuộc **new harness contract** dưới; invokeFixture POSTactual `/api/agents/:id/heartbeat/invoke` (có issuecontext), waitFor polls actualHTTP/DB bounded30s, operationtrace captures core filesystem/Git entrypoints và OSdenial; không mock their successfulresults. `close()` theo teardown dưới. Host scratch/logdir được phép, hostrepositoryoperations phải0.

- [ ] New workspacebridge trả existing RealizedExecutionWorkspace shape với tọa độ Mac và branchCreatedByRuntime=false; receipt chứa company/project/run/machine/epoch + canonicalgatewaypath. Server không xem Macpath là localaccessiblegrant; fail nếu thiếu receipt hoặc machinebinding. Prototype chỉ `project_primary`, không gitmerge/deploy/runtimeprovision; các capability này explicitunsupported, không giả đã test.
- [ ] New DBhelper không gọi startEmbeddedPostgresTestDatabase trực tiếp vì nó migrate trước backup. Dùng cùng embeddedconstructor pattern existing, reserve socket port0→đọc assigned port→close socket→truyền explicit port cho PostgreSQL (PostgreSQL không tự nhận port0), exclude5432/55432/54329; bind race EADDRINUSE phải checkpoint, không đụng server có sẵn. Trước initialize archive empty taskdir + manifest `databaseAbsent:true`; trước CREATE DATABASE/migration tạo JSlogicalbackup database tương ứng, checksumarchive. BeforeEach mutation group backup migratedemptyDB; test assertions checkbackup completed precedes writes. Không snapshot từng internalSQL trong transaction; backup boundary là mỗi test scenario trước bất kỳ scenario mutation.
- [ ] `runDatabaseBackup({connectionString,backupDir,retention:{dailyDays:365,weeklyWeeks:0,monthlyMonths:0},backupEngine:"javascript"})`; restore via `runDatabaseRestore({connectionString:separateTarget,backupFile})`, compare schema/migrationledger/company fixture. Blob/journal snapshot cùng checkpoint ID khi mọi writer stopped. Không dùng userDBconnection hoặc printDSN.
- [ ] Cwd fork root: `node server/src/__tests__/helpers/crew-remote-runner.mjs --gate workspace`; tối thiểu3cases: OSdenied+remote succeeds, wrongbindingdeny, backuprestoreverified. Compile closure theo missingmodule evidence; don'tfullbuild. Record exact patchlist trước reviewer, gate này có thể blocked mà không claim planproofcomplete.

##04-C — Admission + actual outbound lifecycle (score9=1+3+3+2, A high)

- [ ] Add `crewRemoteRoutes(db)` tại new routes.ts, mount `/api/crew/remote` trong app.ts. Existing `actorMiddleware` (auth.ts:221–270) sẽ diễn giải device bearer như agent key; thêm duy nhất POST exact-path allowlist `/api/crew/remote/poll`, `/api/crew/remote/events`, `/api/crew/remote/stop-proof`, đặt actor=none rồi next tới device handler bắt buộc. Không prefix bypass; OPTIONS/GET/adapter paths giữ normal actor middleware. Negative test token sai, missing, path suffix và session ambient phải deny. Device ingress kiểm hashed device token owncompany/machine, không diễn giải thành board/agent privilege. Device auth handler riêng, không bypass existing `/api` chung. Endpoints: machine `POST /poll`, `POST /events`, `POST /stop-proof`; adapter `POST /runs/:id/attach`, `POST /runs/:id/cancel`, `GET /runs/:id/events?after=N`. Routes dành adapter verify actual JWT/actor/core run membership; machinebody IDs chỉ để đối chiếu serverbinding.
- [ ] Patch claimQueuedRun transaction admission trước queued→running; haiagents/machine capacity1. Commondispatch recheck epoch/binding trước cả legacy/native wrapper; prototype chỉ crew_remote legacy, unauthorizednative configured rejected. Offline/staletelemetry giữ queued, không failed/retryloop.
- [ ] Implement gateway initiates longpoll HTTP to loopbackAPI only; no inboundTCP listener trên Mac. Local fixture IPC UNIXsocketmode0600 chỉ runtimecontrol, không server→Mac connection. Fixture command cố định `process.execPath` với file JavaScript fixture đã compile bằng package-scoped TypeScript vào task outputdir; preflight stat/import file trước spawn, không chạy .ts trực tiếp khi dependency graph có TS imports, args pinvalidated, no arbitraryshell command from agentbody. Fixture emits stdout/result/session and holds until release command to exercise disconnect.
- [ ] Journal writes atomic temp+fsync+rename before spawn; reserve identity/run unique; ACK lost means replay identicalenvelope with zeroextraspawn. RemoteEventsequence perrun monotonic; identicaldigest dedup; conflict/gap rejected, request replay from lastpersistedcursor. Core run logs/results persist same coreID, sessioncodec returned opaqueparams excludes token.

```ts
it("lost dispatch ACK replays one actual process", async () => {
  const h = await createRemoteHarness();
  try {
    h.dropNextAck("dispatch");
    const run = await h.invokeFixture();
    await h.waitFor(run.id, "ready");
    await h.reconnectGateway();
    await h.finishFixture(run.id);
    expect(await h.spawnCount(run.id)).toBe(1);
    expect(await h.coreRunIdsFor(run.id)).toEqual([run.id]);
    expect(await h.resultSessionRun(run.id)).toBe(run.id);
  } finally { await h.close(); }
});
```

Methods extend same newharness; dropNextAck fault proxy drops response after persisted delivery, không fakeprovider. Atleast6cases: normal, lostACK, duplicateevent, staleepoch, crosscompany, capacitycollision. Result success không tự issueDone; mutation invariant future fullCrewcompletion gate chưa scopeaccepted.
- [ ] Run `node server/src/__tests__/helpers/crew-remote-runner.mjs --gate integration`; assertion existing run created through API, gateway realPID+nonce, dbrows/logcursor and finalsession. Review before04-D.

##04-D — Cancel and physical stop (score9=1+3+3+2, A high)

- [ ] UnitRED cancellation must await onCancellationReady before delivery; abort afterREADY persists cancelintent then waits physicalproof, not socketACK. Abort during uncertain startup retainsreservation. Distinguish operatorcancel from controllerleaselost: latter holds/reconnects samephysicalexecution, không phát cancel mù.
- [ ] Fixture starts childdescendant; each owned process provides challenge response over privateUDS using executionNonce held in memory. Gateway accepts stop only matching fullidentity+epoch; original ChildProcess handle can signal own group; after gatewayrestart require challenge/proof, never signal reusednumericPID. Unknown/lostsocket retainshold and asksreconcile; no fabricated stoppedproof.

```ts
it("disconnect during cancel cannot release the machine early", async () => {
  const h = await createRemoteHarness();
  try {
    const run = await h.invokeFixture(); await h.waitFor(run.id, "ready");
    await h.disconnectGateway(); await h.requestCoreCancel(run.id);
    expect(await h.reservationActive(run.id)).toBe(true);
    expect(await h.anyOwnedProcessAlive(run.id)).toBe(true);
    await h.reconnectGateway(); await h.waitFor(run.id, "stopped");
    expect(await h.anyOwnedProcessAlive(run.id)).toBe(false);
    expect(await h.reservationActive(run.id)).toBe(false);
  } finally { await h.close(); }
});
```

- [ ] Atleast4cases: cancelbeforeREADY, cancelafterREADY, disconnectedcancel, staleproof/PIDidentitymismatch. Physical checks processroot+descendants and terminaljournalsequence. Run `node server/src/__tests__/helpers/crew-remote-runner.mjs --gate cancel` từ fork root. Patch `cancelRunInternal` only crew_remote persistedstopintent before awaits; no generic SDK.cancel invention. Review before04-E.

##04-E — Server/gateway restart adoption and restore (score10=1+3+3+3, A high)

- [ ] New recovery bridge in reaper before generic process_lost, conditional adaptertype validated core record. After oldlease expiry and journalchallenge, CAS claim same heartbeat_run from exact oldboot/epoch; update controllerBootId to currentcore boot UUID, lease expiry using DBclock. Core emits newepochauthority to existinggatewayexecution; no INSERT heartbeatRuns or providerrestart.
- [ ] **Actual core bootstrap (F2):** NEW `crew-remote-server.ts` tạo fresh API child/boot UUID với cùng scenario home/instance; await registry load và app setup hoàn tất. Harness quan sát persisted legacy lease qua actual DB clock, chờ lease thật hết hạn (không sửa expiry/clock). Sau đó gửi private harness IPC trigger vào API child để gọi chính `await heartbeatService(db).reapOrphanedRuns({ staleThresholdMs: 0 })`; import factory từ existing `server/src/services/heartbeat.ts`, dùng cùng service dependencies/options như API bootstrap. Đây là actual exported core reaper (`heartbeat.ts:18744,29440`), tương ứng startup path `index.ts:1488`, không gọi sidecar adopt trực tiếp. `createApp` tự nó không chạy reaper; không dùng periodic threshold5 phút (`index.ts:1761`). Capture reaper invocation → lease/CAS evidence → same-run adapter reattach; no adoption trước expiry. Private trigger chỉ harness IPC, không public route. Reaper có ancillary native work: fixture DB không có native records; missing required module dừng gate, không mock reaper thành success.
- [ ] Extend internal executeRun options with typed `crewRecovery: {reservationId:string;epoch:number;afterSequence:number}` server-only. New recoverybranch skips workspace/provision/spawn, reattachesadapter/logsink at persistedcursor and uses existingcommonfinalizer/session update. Worker must map every normalsetupskip/commonfinalizer dependency in patchregistry and re-review if more than named heartbeat/leasefiles need touching. Never expose caller-set recoveryoptions in publicbody.

```ts
it("core restart adopts same run and never starts a replacement", async () => {
  const h = await createRemoteHarness();
  try {
    const run = await h.invokeFixture(); await h.waitFor(run.id, "ready");
    const nonce = await h.executionNonce(run.id);
    await h.restartCoreAfterLeaseExpiry();
    await h.waitForAdoption(run.id);
    expect(await h.executionNonce(run.id)).toBe(nonce);
    expect(await h.spawnCount(run.id)).toBe(1);
    await h.finishFixture(run.id);
    expect(await h.coreRunIdsFor(run.id)).toEqual([run.id]);
  } finally {
    try { await h.abortPending("recovery test finally"); }
    finally { await h.close(); }
  }
}, 240_000);
```

- [ ] **Bounded timeouts (F3):** recovery Vitest child argv gồm `run src/__tests__/crew-remote-recovery.test.ts --maxWorkers=1 --testTimeout=240000 --hookTimeout=60000` cộng exact scenario `--testNamePattern`. Explicit snippet timeout240000ms overrides upstream15000ms. Bootstrap bound30s, real-expiry/adoption wait90s, final assertions15s, close bound45s; outer runner watchdog300s gồm termination grace. Hook≤60s; không đặt 60s lease wait trong hook. Mọi HTTP poll/IPC/timer dùng scenario AbortController, `abortPending(reason)` abort và drain pending promises trước close (bound5s tính trong cleanup45s, drain timeout được ghi nhận nhưng vẫn chạy close qua nested finally); factory failure cũng abort/close partial resources. Finally luôn abort trước cleanup, cleanup timeout giữ evidence và báo cleanup incomplete; không để async assertion chạy sang scenario khác. Lease vẫn60s thật.
- [ ] Atleast5cases: coreSIGKILLafterREADY, gatewaySIGKILLafterspawn-beforeACK, duplicatecontrolleradoptionrace, unknownexecutionhold, backuprestoretoseparatetarget. Preserve usage/eventcursor dedup and sessionpin; no providercharge fixture. Run `node server/src/__tests__/helpers/crew-remote-runner.mjs --gate recovery` từ fork root serialized; actual60s lease expiry is expected runtime, avoid replacing DBclock with mockedtime for acceptance.
- [ ] **Upstream regression DB BLOCKED (F4):** không chạy trực tiếp `heartbeat-process-recovery.test.ts`, không đưa ambient `PAPERCLIP_TEST_DATABASE_URL` vào test. Existing suite tự support-probe embedded DB và migrate trước backup, nên runner env isolation hay backup của new tests không đủ. Gate regression giữ blocked cho tới khi PM freeze thêm exact owned runner/setup-hook/source paths, reviewer xác nhận mọi probe/CREATE DB/migration/scenario mutation đi qua owned backup helper, localhost/port/marker checks và restore evidence. Chưa có safe hook thì ghi regression not run/blocked, không gọi toàn04-E verification complete. Không cấp lệnh chạy suite này trong plan hiện tại.
- [ ] Loader-only regression chỉ sau04-B wrapper review: thêm gate `loader` của cùng new runner, fixed file `src/adapters/plugin-loader.test.ts`; lệnh fork root `node server/src/__tests__/helpers/crew-remote-runner.mjs --gate loader`. Runner vẫn isolated home trước imports; test kiểm không có DB mutation trước khi admit. Cwd fork root typecheck: `corepack pnpm --filter @crew/remote-adapter exec tsc --noEmit` và `corepack pnpm --filter @paperclipai/server typecheck`. Missing module/nativebin phải report, không thay bằng mock để claim regression. Final reviewer phân biệt prototype cases đạt với blocked upstream DB regression.


## New harness interface và gate implementation

Định nghĩa tại NEW `server/src/__tests__/helpers/crew-remote-harness.ts`; không export từ production SDK. 04-B implement subset probe/DB/close; 04-C/D/E bổ sung respective methods trước tests gate đó, không dùng stub resolving success. `createRemoteHarness(): Promise<RemoteHarness>` chỉ được gọi bởi lifecycle tests từ04-C;04-B dùng `createWorkspaceHarness(): Promise<WorkspaceHarness>` và testcode gateB đổi factory tương ứng. Các reads truy vấn actual core/sidecar DB hoặc process challenge, không test-maintained fake counters.

```ts
type RunRef = { id: string };
type WorkspaceProbe = { hostRepositoryOperations: string[]; gatewaySentinel: string };
interface WorkspaceHarness {
  sentinel: string;
  apiCanReadGatewayRepo(): Promise<boolean>;
  realizeWorkspaceProbe(): Promise<WorkspaceProbe>;
  abortPending(reason: string): Promise<void>;
  close(): Promise<void>;
}
interface RemoteHarness extends WorkspaceHarness {
  invokeFixture(): Promise<RunRef>;
  waitFor(runId: string, event: "ready" | "stopped"): Promise<void>;
  dropNextAck(kind: "dispatch"): void;
  reconnectGateway(): Promise<void>;
  disconnectGateway(): Promise<void>;
  finishFixture(runId: string): Promise<void>;
  spawnCount(runId: string): Promise<number>;
  coreRunIdsFor(runId: string): Promise<string[]>;
  resultSessionRun(runId: string): Promise<string>;
  requestCoreCancel(runId: string): Promise<void>;
  reservationActive(runId: string): Promise<boolean>;
  anyOwnedProcessAlive(runId: string): Promise<boolean>;
  executionNonce(runId: string): Promise<string>;
  restartCoreAfterLeaseExpiry(): Promise<void>;
  waitForAdoption(runId: string): Promise<void>;
}
```

04-C implements invoke/poll/fault/reconnect/finish/read methods;04-D implements disconnect/cancel/physicalproof reads;04-E implements restart/adoption with bounded90s wait (60s lease), actual core reaper trigger F2 và timeout/abort bounds F3. 04-B close owns only workspace/DB children; expanded close tracks each subsequent owned process. `dropNextAck` arms an actual response-drop fault at transport boundary, spawnCount reads durable journal spawn records plus nonce challenge. CoreRunIdsFor selects stored issue/execution correlation, not singleton array constructed from argument. All query methods use test credentials held in memory and exclude secret logs.

## Process registry, evidence và teardown

Harness writes `.crew-setup/phase00-04/processes.json` with taskID/PID/PGID/startnonce/port/cwd/ownerdir/starttime; no token/DSN. Default API port0 localhost, allocatedDB excludesforbiddenports; gatewayfixture no publiclistener. Create each tempdir with ownershipmarker + canonicalrealpath; record archiveDB/blob/journal hashes before mutation, retain backup/report evidence outside teardowntargets.

Teardown order: stop new admission→persist STOP all ownedreservations→verify all knownroots/descendants stopped→close gatewaypolls/core `app.locals.paperclipShutdown()`→destroy ownedHTTPsockets→close HTTPserver→closeRegisteredClients→stop embeddedPostgres→remove only marked tasktempdirs without symlink traversal. If physicalproof unknown, preserve directory/reservation, report PID/port/nextreconciliation; do not killuserprocess or pretend cleanupdone. Restore tests closewriters first and use distinctnewDB. Preserve successful/failingtest stdout/exit/count/skips and interruptedruns; don't overwrite logs.

## Handoff và self-review

Plan covers scoped textfixture lifecycle, identity/auth/workspace/admission/cancel/restart/backup. R1 fullworkflows/modelruntimes/semanticdocs/merge/deploy/UI/nativeinstaller/upgrade remain roadmap gates, not this prototype. Local sandboxedprocess boundary proves real outbound/process/DB, **not productionVPS or Linuxdeployment**; later stagingproof riêng.

Newfunctions/types/harnessmethods above are proposed interfaces, not claims of SDK availability.04-B workspacepatch and04-E recovery internaloptions require exactdiff review before successor. No unsupported builtintransport or recoverhook is assumed. Expected minimum newtests:8+3+6+4+5=26; report actualcounts, not guarantee green. No tests executed while planning. Actual fork docs/lock policy discrepancy handled by PM, no rulefileedit authorized here.

Closure revision round1 (06/10/2026): F1–F4 đã sửa trong plan để scoped re-review; chưa có runtime verification. B/E bounded patch decisions giữ nguyên.
