# Phase04 Task3 — Runtime boundary và logical effect receipts

> Candidate sau amendment workspace đã được kiểm chứng ngày 2026-10-03: build/strict/Biome PASS và exact affected cover **22/22 PASS**. Cover105 bên dưới chỉ thuộc historical candidate trước amendment, không cộng với22 và không dùng để chứng minh current source. Freeze mới tại `task-3-evidence/workspace-amendment/owned-final-sha.json`.

Status: **DONE_WITH_CONCERNS — chờ PM mapping/commit và independent SPEC/QUALITY/security review. Production runtime chưa enabled/certified.**

BASE `5c6fbaf`. Worktree `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`. Không commit/index/Git mutation; không sửa peer attachment/parser. Prepared-label được PM dispatch override. Telemetry dispatch19:18 idle79.52%, load2.45/2.31/2.43,disk35GiB; PM19:20 load2.03/2.20/2.37,disk35GiB; PM19:48 pressure warn: hoàn tất cover hiện hành, không tạo thêm native/PG workload sau đó.

## Scope và producer thực tế

- Own năm file `gateway/src/runtime/{contracts,launch,tool-policy,effect-ledger,isolation}.ts`, năm test files, bốn support TS + scoped strict config, flow `gateway-runtime`. Cộng additive bridge và gateway-host đã chuyển quyền: **18 files** cuối.
- PM transfer19:20 cho additive `gateway/src/execution/ticket-command-bridge.ts` + `gateway-host` R3. Diff producer **26 lines (+25/-1)**, không sửa launcher, ProcessJournal, native, registry, migrations005/007/008 hay server.
- Read docs/index,v2/docs/index, gateway-host/workflows/server-models, actual ProcessJournal/AtomicRecords/Bridge/registry/preflight/contracts. Không `.codegraph`. `crew-docs` bundled path bị context optimization hook chặn (`dist`), không đổi ignore config; PM làm manifest/generate/check. TDD/executing-plans/verification-before-completion đã đọc; không child agent theo dispatch.
- Registry `resolve` trả actual manifest/path nhưng không exposed official source→projection entrypoint mapping. PM ruling giữ producer không đổi, dùng captured trusted catalogue defaultdeny, exact pin context. Không lấy raw recipe source entrypoint hoặc đoán regex làm authority.

## Thay đổi

1. `RuntimeAdapter` đúng bảy methods và RuntimePin/Checkpoint theo contract. EffectId là lowercase SHA256 hex64, UUID cho run/step/attempt/operation.
2. Existing bridge READY→005claim→accepted007companion→captured `beforeRelease` hook→existing launcher.release. Callback nhận actual immutable/frozen record+attempt+companion+fresh scopedcommand; false/nonvoid/throw deny. Không secondlauncher. RuntimeLaunch chỉ ghi trong hook; direct startReleased ngoài hook deny. ModelChoice, selection, machine/fence/process/source/projection/derivation và admission được so trước ghi immutable companion/fsync; replay đổi pin/input/credential bị conflict.
3. Trusted entrypoint catalogue mặc định absent→deny. Exact source/projection/derivation+skillName mapping→relativepath/hash; actual manifest membership, realpath containment, fileFD no-follow/linkcount/size/hash. Runtime receipt lưu canonical absolute path cho adapter so với actual native `skills/list` item sau này. Tests wrong existing nonentrypoint, missingcatalogue, traversal, wronghash và actual byte tamper đều chặn RELEASE.
4. RuntimeIsolation không có observer mặc định→deny. Exact source/projection/derivation/binary/OS/policy context hash theo accepted server fixed order. Measured FAIL hoặc missing fulltree→deny. Certified cần fresh exact receipt và đủ positive/negative surfaces. Testcert cần admitted exact claimtuple+nonce/context/budget, UNVERIFIED preflight; không fake PASS/mint receipt.
5. DurableEffectLedger: immutable append-only intent + attempt/fence/toolCallId binding + done receipt + uncertain marker trên actual AtomicRecords/ProcessLock. Canonical SHA256 array `[runId,stepOperationId,actionKind,targetIdentity,preconditionSha256]`. AuthorizeOperation Phase06 missing→wait trước intent. Fsync intent trước execute; verifier kiểm receipt/artifact trước complete và return. Same logicaleffect fallback trả cùng verified receipt; changedmetadata/args409; sameargs khác stepOperationIDs độc lập. Pending/reopen→reconcile; không actual targetproof→uncertain/wait, không TTL retry.
6. ToolPolicy giữ trusted allowed/readonly declaration; caller không relabel write→readonly. Native/child bypass broker vẫn thuộc isolation fulltree gate.
7. Amendment dùng captured concrete actual `IsolationWorkspace`; thiếu service mặc định deny, structural fake không được chấp nhận. Actual `get(attemptId)` phải prepared và khớp ownerCommit/attempt/source/projection/observed workspace+home. Actual `withPrepared` reverify filesystem/config/Git/registry/closure; returned operation và identity được so lại, transaction giữ đến RuntimePin companion fsync. Receipt lưu actual workspace summary. Observer chạy trước isolation queue, lock order bridge→runtime→isolation→registry; observer không được re-enter store. Không sửa producer workspace/registry/native.

## Kiểm chứng candidate hiện tại — amendment workspace

PM giải phóng heavy slot ngày 2026-10-03 16:33; fresh gate trước snapshot và từng stage: pressure2 WARN, available **4,782,276,608–4,872,306,688 bytes**, idle81.49–87.17%, disk khoảng34GiB, đạt ruling pressure1/2 + available≥4GiB + idle≥50% + disk≥8GiB. `resource-gates.jsonl` giữ actual samples. Một job tuần tự, `NODE_OPTIONS=--max-old-space-size=384`, không PG/provider. Heap384 chỉ giới hạn Node heap, không phải full-tree RSS cap; memory của native preparation helper chưa được chứng nhận, chỉ bounded fixture nhỏ thực tế.

Snapshot mới kiểm identity +307 hashes của historical BASE5c6fbaf trước copy, giữ historical snapshot bất biến; RED chỉ thêm hai test/support workspace mới vào consumer cũ. Sau đó overlay exact16 owned source/test/support files; hash drift0. Thêm hai R3 docs thành final18file inventory. Snapshot review giữ tại `workspace-amendment/root.json`.

| Command trong frozen amendment root | Kết quả riêng |
|---|---|
| `node --test test/runtime-workspace.test.ts` với historical consumer | expected RED exit1: `Missing expected rejection` cho same-shaped wrong workspaceCommit |
| `pnpm --dir v2/gateway build` | exit0 |
| `pnpm --dir v2/gateway exec tsc --noEmit -p test/support/runtime-typecheck.json` | strict exit0 |
| `node --test --test-concurrency=1 test/runtime-boundary.test.ts test/runtime-crash.test.ts test/runtime-workspace.test.ts test/effect-ledger.test.ts test/isolation-runtime.test.ts test/isolation-workspace.test.ts` (cwd `v2/gateway`) | **22/22 PASS**,0fail/skip/cancel,53178.869708ms,exit0 |
| `pnpm exec biome check` exact15 owned source/test/support files ngoài unchanged bridge | exit0,15files,no fixes/warnings |

Actual prepared API workspace positive dùng real owned Git và actual producer. Negatives: same-shaped wrong commit, wrong/absent attempt, source/projection, observed workspace/home, preparing/retained/deleted durable states và stale after cleanup. Actual get/withPrepared result được đối chiếu ownerCommit/identity; cleanup race bị giữ đến callback xong. Bridge asserts actual persisted workspace summary; invalid commit chặn trước fsync/RELEASE. Six crash windows vẫn giữ pins và không duplicate launch; effect ledger regression included. Protocol-only model/admission observations không phải native certificate.

Exact commands/PID/start/exit tại `workspace-amendment/commands.json`: RED18610 exit1, build18760/strict18845/cover18890 exit0. Runner exit0. Closure audit không process tham chiếu snapshot hoặc16 fixture roots;16logged roots gồm9absent và7retained (6runtime UNKNOWN crash +1actual prior-producer fixture), mọi present identity dev/inode/UID khớp log. Không tạo container. Native receipt/stageIdentity/argv trong original logs; UNKNOWN giữ nguyên, không suy proof từ process scan. Heavy slot trả PM ngay sau closure. `resource-audit.json`, `process-closure.json` giữ audit; snapshot review retained.

## Historical cover trước amendment — không xác minh current source

Frozen snapshot: `BASE5c6fbaf:v2` + **14 owned source/test/support files**, **307 captured files**, before/after hash drift **0**. R3 docs hoàn tất sau run, không source/test sửa sau snapshot. Own final16file SHA/bytes tại `task-3-evidence/owned-final-sha.json`.

| Command trong frozen root | Kết quả |
|---|---|
| `pnpm --dir v2/gateway build` | exit0 |
| `pnpm --dir v2/gateway exec tsc --noEmit -p test/support/runtime-typecheck.json` | strict exit0 |
| `node --test --test-concurrency=1` +17 explicit files trong `covering-manifest.json` (cwd frozen `v2/gateway`) | **105/105 PASS,0fail/skip/cancel**,135386.904916ms,exit0 |
| Scoped `pnpm exec biome check` own13files | exit0,0warnings,no fixes |
| Biome modified existing bridge | exit0,3 pre-existing noNonNullAssertion warnings at untouched code; không claim clean producer lint |

17 files: journal, http-operations, execution-bridge, execution-bridge-db, execution-crash, stop-control, pin-retirement, retirement-crash, workflow-admission, isolation, isolation-workspace, model-probe, current-credential-resolver, runtime-boundary, runtime-crash, effect-ledger, isolation-runtime. Explicit frozen cover này không phải toàn monorepo suite. Active peer attachment access/parser tests không copied hoặc included. `CREW_ISOLATION_SKIP_DISCOVERY=1` giữ frozen no-model acceptance subset, không lặp CLI discovery; actual native/invoke status vẫn UNVERIFIED.

Cover có actual005/007 PostgreSQL/HTTP producer bridge tests, actual journal/registry/launcher, real SIGKILL6windows của runtime và prior producer crash matrix. Runtime admission/confinement catalogue fixture là protocol-only trusted ports, không native certification hoặc real server-admitted Task3 runtime model.

RED→GREEN evidence: ledger-red→ledger-green; isolation-red→isolation-green; bridge-red (missing rejection vì RELEASE chạy)→bridge-green; runtime-red→runtime-green; tool-declaration-red (write relabel→allow)→green; entrypoint-red (wrongpath vẫn tới fsync)→entrypoint-green. Additional target-specific reconciliation kiểm actual owned file bytes/hash, concurrent reservation chỉ một execute, artifact tamper→wait.

## Failures giữ riêng

- `ledger-red.log`:5 expected feature-missing failures;4 empty owned roots được xóa exact identity, không process created.
- `isolation-red.log`: feature stubs fail; context hash test ban đầu mirror fixture được thay independent Node crypto expectation trước finalcover.
- `bridge-red.log`: expected missing rejection trước producer hook, fixture closed/stopped rồi cleanup.
- `runtime-red.log`: expected stub open failure, nhưng test setup trước finally giữ writer process; runner child PID30489, parent30488,start19:31:50,command exact runtime-boundary test được kiểm và SIGTERM. Root `crew-runtime-21de8100-befe-459d-be67-c90f6ca18039-MjIC5o` giữ riêng, không suy closure để xóa. Không có runtime launch/claim trước stub này; report vẫn không coi cleanup xong.
- `typecheck-first.log`:4 nullable admission fixture errors, sửa bằng assertions; subsequent scoped strict và final strict0.
- `biome-first.log`: own warnings/format plus3 baseline producer warnings; own warning sửa, baseline giữ scope.
- `frozen-preparation-failure.log`: system Python tarfile không hỗ trợ filter keyword; empty snapshot được identity-verified removed (`frozen-preparation-failure-root.json`), runner sửa dùng trusted base archive path validation. Đây là harness failure trước build/test, không gộp thành cover xanh.
- Amendment static strict đầu tiên TS2339 (async callback assignment làm closure attempt narrowed never); assertion sửa sang actual producer `get`; `workspace-amendment/strict-static.log` và frozen strict sau đó exit0. Static Biome optional-chain suggestion đã sửa trước freeze; final15files clean.
- Amendment `red-historical-consumer.log` expected wrong-commit rejection missing; actual fixture closed và root cleanup trước exit1. RED không nhập vào22PASS hoặc105historical.
- Không dấu fail từ cover: finalcover105/105 thực tế, logs/argv/exit riêng trong `frozen-commands.json`, không unionPASS.

## Resource closure và cleanup

- Private PostgreSQL18.6 container ID `5b07538d46a547b00c6c27d3d294ef96285334037edd3f251c9314780aa3058e`, labelnonce `876fd1f0-72d7-4d49-91bb-1380efc7d593`; name/loopback randomport trong `frozen-container.json`. Exactlabel/ID checked trước remove; inspect absent confirmed trong `frozen-container-closure.json`.
- Build PID68000, strict68022, covering68128: waited exit0; no process referencing frozen root tại audit. Exact argv/start/cwd/exit trong commands JSON.
- **37 Task3 runtime roots**,24absent,13present:12 intentional UNKNOWN crash fixtures (6focused+6frozen) và1 failed RED setup hold. Nonce/dev/inode/UID và exact subprocess PID/native birth/argv có trong logs; `resource-audit.json` đối chiếu currentidentity. UNKNOWN không TTL/prune/patternkill. Native helper/kernel exit thiếu proof không được fake STOP dù process group rỗng.
- Finalcover producer fixture inventory **58 logged roots**,42absent,16present (bao gồm6 runtimeUNKNOWN và prior producer UNKNOWN). Chi tiết `frozen-fixture-resource-audit.json`. Không khẳng định mọi prior helper root có đầy đủ independent identity nếu producer log không ghi; original logs giữ đầy đủ.
- Static reviewer snapshot retained tại path trong `frozen-root.json`;307filehash stable,no matching process. Chưa xóa để PMreview/reproduce. Không owner HOME/global/Keychain/cached credential mutation; không paid/live model.

## Blockers/giới hạn trước production

- Phase06 stable logical-operation/binding source chưa có; default wait/deny. RuntimeLaunch không cấp permit hoặc thả server guard.
- Actual server admission/certificate gateway read producer chưa có. Captured trusted observer phải đọc actual admitted state/certificate và verify current constrained descendants; không triển khai fakeGET hoặc client-reported PASS authority.
- Catalogue official entrypoint mapping phải do reviewed actual recipe/build mapping + host composition cung cấp; test mapping không cấp production authority.
- Chưa chứng minh full-tree policy cho nativeRead/Skill/slash/Bash/MCP/child/network trên actual model binary; không có new confinement helper. Current Phase03 preflight vẫn UNVERIFIED, production disabled.
- WorkspaceCommit gap đã đóng bằng actual prepared IsolationWorkspace barrier trong amendment. Host adapter composition vẫn chưa wired; phải truyền concrete trusted service và actual authority ports, absent defaultdeny. Không tự nhận caller HOME/checkout làm ownershipproof.
- Checkpoint hiện same source/projection gate; crossruntime transition/remapping cần Task6/Phase06 verified fallback/terminal contract. Target-specific reconciler interface có; chưa có production target adapter/remote idempotency replay, nên pending không tự execute.
- Independent review bắt buộc cả new runtime và additive bridgehook; PM owns flowmanifest/generated mapping, commit và acceptance. Không đánh dấu fullPhase04/native/runtimecert READY từ105tests.

Unresolved questions: không có yêu cầu hỏi user; các producer/blocker được ghi rõ để PM sở hữu gate và chuyển tiếp Phase06/Task7.
