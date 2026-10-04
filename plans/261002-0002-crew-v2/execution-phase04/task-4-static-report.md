# Task4 — chuẩn bị tĩnh Claude/Codex adapters

Thời điểm đối chiếu: 2026-10-03T10:23:48Z. Phạm vi: brief Task4 đã đọc toàn bộ, actual accepted RuntimeAdapter và các producer liên quan; chỉ đọc source/tài liệu primary và ghi báo cáo/evidence. Không chạy native CLI, model/provider, credential, install, PG/container, test/build, Git/index; không sửa production/test/flow/manifest. Telemetry 17:19:50 là thông tin PM bàn giao, không phải admission còn hiệu lực cho lượt sau.

**Kết quả: có thiết kế và ma trận RED để PM duyệt; chưa có adapter implementation hoặc protocol/native PASS.** Runtime4db2d9e là acceptance do PM bàn giao, không được em kiểm lại bằng Git. Actual producer đọc trong lượt này khớp DTO bảy method của brief. Source/projection của attempt hiện tại luôn bất biến. Production vẫn default deny.

PM ruling nhận sau fresh17:28 telemetry (CPU66.9% idle, available~6.27GiB, disk31GiB): tiếp tục STATIC protocol/design-only. Được thiết kế constructor-captured trusted released-channel port trong owned adapters, absent→default deny, bind actual launchId/RuntimePin/RuntimeRecord/process identity/current release proof. Không SDK query independent spawn; actual producer channel/host wiring chờ explicit integration ownership sau báo cáo. Chưa cấp source/TDD/native/model slot. Telemetry này không tự cấp admission.

## Producer đã đối chiếu

| Producer thực tế | Hành vi thấy trong source | Handoff còn thiếu |
|---|---|---|
| `v2/gateway/src/runtime/contracts.ts` | Bảy methods; RuntimePin giữ attempt/command/process/fence/source/projection/selection/modelChoice/admission/commit; checkpoint giữ receipt/effect/artifact/attachment IDs | DTO không mang released process channel, launch ID, canonical entrypoint, lifecycle result hay usage. Không thêm field tùy tiện |
| `runtime/launch.ts:60,72` | `beforeRelease` capture context; exact journal READY, registry.resolve, trusted catalogue, canonical no-follow bytes; isolation verification và fsync companion trước RELEASE | `startReleased` chỉ persist companion; không gọi adapter. `read(launchId)` có receipt entrypoint/workspace nhưng adapter chưa được trusted composition truyền launchId/record đã kiểm |
| `runtime/isolation.ts:6,108` | Observer + concrete IsolationWorkspace bắt buộc; full-tree context; admission/certificate expiry kiểm trước/sau action | Không có production observer/admission read/full-tree authority. Test-certification không là certified production |
| `workflows/registry.ts:659` | `resolve` kiểm source/projection bytes và trả roots/manifest của exact pins | Manifest không cấp quyền chọn skill; catalogue source→projection entrypoint vẫn cần trusted producer |
| `isolation/workspace.ts:104,590` | get/withPrepared kiểm exact owned workspace/home/commit/identity, pin và byte inventory | Trong lúc runtime sửa workspace, không gọi lại prelaunch verifier như thể workspace vẫn nguyên. Handoff cần runtime-aware confinement observation riêng |
| `journal/process-journal.ts:439,454` và `journal/gated-helper.ts` | Launcher duy nhất nhận command; helper READY→RELEASE; native supervisor chứng cứ stop. Helper stdout hiện dành cho JSON tree proof, bound4096 | Chưa có port bidirectional stdin/stdout/stderr tách khỏi stop-proof channel. Adapter không được tự spawn process thứ hai |
| `runtime/tool-policy.ts:25`, `effect-ledger.ts:84,136,170` | Default deny; missing logical metadata→wait; missing authorizeOperation→wait; receipt verifier và target reconciler trước complete/replay | Phase06 chưa cấp stepOperationId/action/target/precondition authority. Provider call ID hoặc hash args không thay nguồn này |
| `models/contracts.ts`, `models/inventory.ts:15` | ProbeResult dùng exact ModelKey/context; CLI catalogue qua composition; offline prober | Inventory adapter cần machine/provider/context/catalogue ports trusted. Discovery không cấp entitlement/capability/certificate |

Đã đọc root/v2 docs index, `gateway-runtime`, `gateway-models`, `gateway-workflows`, `gateway-host`. Producer byte fingerprints đọc tĩnh được lưu ở `task-4-evidence/static-source-inventory.json`; chúng mô tả bytes đã đọc, không là commit/certification.

## Primary protocol và độ mới bằng chứng

### Codex

[App Server chính thức](https://learn.chatgpt.com/docs/app-server): schema generator gắn đúng phiên bản CLI; handshake `initialize`→`initialized`; `skills/list` có `forceReload`; skill input dùng `name/path`; thread replies có `instructionSources`; `turn/completed` cần kiểm status; `turn/interrupt` trả lời không là OS stop. Approval là request từ server. Tài liệu hiện có extra roots và dynamic tools; không dùng field/method mới trước khi schema binary đã pin xác nhận.

Evidence Phase03 `superpowers-codex-native-skills-evidence.json`, observedAt 2026-10-02, ghi CLI0.159.3, ba schema hash:

- SkillsListParams: `1d245374e64c5acc9739dfc68a4fe5114c6c9147af04c480886f1846d2ca6239`.
- SkillsListResponse: `230f125d6c36ec1b1514018a0bb6d0627f7308ea82f1ef04cad85490de482bae`.
- TurnStartParams: `2dfcf68705896fadc344ccfeb2e9fe5a6bcbbb8b9a90cf449ce232b636daf05a`.

Schema lịch sử thiếu `perCwdExtraUserRoots`; SkillUserInput lịch sử yêu cầu type/name/path. Không coi ba schema là full protocol bundle hoặc binary hiện hành. `task-6-report.md:31` ghi initialize thành công nhưng EOF trước replies skills/hooks/config; chưa đủ inventory/init certificate.

### Claude

[SDK skills](https://code.claude.com/docs/en/agent-sdk/skills): settingSources/discovery, init skills/slash_commands, skills allowlist không chặn dispatch by name hoặc Read/Bash. Missing slash command có thể thành ordinary model input từ CLI2.1.274; phải kiểm exact command trước send. Init inventory không mang chứng cứ path/hash đầy đủ.

[Sessions](https://code.claude.com/docs/en/agent-sdk/sessions): resume theo session ID; success result khác max-turn/budget/error; fork history không cô lập filesystem. Crew vẫn áp same-runtime/same-pin chặt hơn khả năng resume chung của SDK.

[CLI reference](https://code.claude.com/docs/en/cli-reference): có input/output stream-json, strict-mcp-config, setting sources và permission prompt controls. Các flags/protocol sẽ được kiểm theo binary pin riêng; không suy transport schema từ ví dụ CLI.

[Permissions](https://code.claude.com/docs/en/agent-sdk/permissions): allowedTools/canUseTool có nhánh autoapproval bỏ qua callback; PreToolUse là điểm hook trước permission evaluation. Chỉ nhận lifecycle/tool event sau execute không đủ broker enforcement.

[Sandbox](https://code.claude.com/docs/en/sandboxing): sandbox được mô tả cho shell commands và child của chúng; không chứng minh process-wide native Read/MCP/plugin/child confinement.

`execution-phase03/task-6-report.md:29-34` ghi Claude2.1.284 selected plugin list; SDK initialize timeout137/10s, inventory rỗng, không prompt. Native Read/Skill/MCP/child/fulltree đều UNVERIFIED. Phiên bản Claude đang cài, SDK package/lock/license/declarations và executable byte digest chưa đo lượt này. TypeScript SDK reference fetch không thành công (page too large/internal error); không bịa option hoặc message type từ đó.

### Pin acquisition đề nghị, chưa chạy

1. PM cấp slot serial và telemetry mới; đọc exact owned executable bằng no-follow FD, SHA256 bytes + identity/mode/link count trước/sau command, version bounded và license/distribution record. Không install/update, không đọc owner HOME/auth.
2. Codex: trong scratch đã reserve/attest, offline `app-server generate-json-schema` và `generate-ts`; giữ full bundle+hash từng file+generator argv/exit/timeout+binary digest. Cần initialize/response, model list pagination, skills list, thread start/resume, turn start/steer/interrupt, notifications, server requests/approval/tool/result/error definitions. Schema thiếu field bắt buộc cho policy→variant unavailable; không gửi unsupported field rồi retry bỏ policy.
3. Claude: ưu tiên CLI stream-json candidate vì không cần dependency mới và có thể đặt sau sole launcher. SDK query là alternative chỉ khi PM chấp nhận runner nằm trong released owned tree và review bundled CLI/declarations/package/license/process ownership. Không import SDK tự spawn từ host. Pin CLI control request/response envelope qua package declarations hoặc owned no-model initialization; nếu không có schema current đủ thì giữ unknown. `strictMcpConfig` option SDK chưa được chứng minh ở lượt này; chỉ CLI flag có primary reference.
4. No-model app-server/init là native process khác generator: cần slot, owned HOME/config/CWD, bounded fixed control stdin, no thread/turn/provider/auth, deadline và exact closure proof. Nếu timeout/fork/observer mất witness, retain unknown resources; không cleanup bằng group-empty.
5. Live selected/unselected skill/native/tool/child canaries chỉ sau actual admission+full-tree producer và owner chọn exact model/provider/cost/turn/tool budgets. Static schema/discovery không bù cho live thiếu.

## Thiết kế method và ranh giới authority

Thiết kế normalized types/state machine ở `task-4-evidence/adapter-design.md`. Đây là local design, không là wire schema mới. Không đổi accepted DTO hoặc producers.

| Method | Đề nghị |
|---|---|
| inventory | Registry.resolve exact pair; runtime/projection null hoặc khác pin từ chối. Trusted catalogue + actual prober cung cấp ProbeResult. Catalogue entries chưa entitlement giữ unverified/capabilities rỗng. Missing current binary context trả lỗi đóng, không dùng zero/fake hash |
| prepareIsolation | Consume actual observer/RuntimeIsolation cùng admission; production chỉ certified sau genuine matching receipt. Test admit trả certified:false, có evidence đã kiểm; không upgrade synthetic certificate. Thiếu producer throw |
| start | Consume verified companion+released channel của sole launch; exact pin và canonical entrypoint/hash; kiểm init/source inventory trước input. Runtime session namespaced `claude:`/`codex:`; processIdentity lấy owned observer, không session/PID tự khai. Return sau skill input được transport chấp nhận, không claim task complete |
| sendInput | Serialize theo same pin/session; trusted attachment provenance resolver chỉ mở attachment IDs authorized. Chưa Phase05 mapping thì có attachments→deny, không tự lấy path. Active Codex steering chỉ khi schema/current turn guard được pin; phiên bản thiếu thì wait, không mở turn thứ hai |
| checkpoint | Snapshot sequence/step từ durable run authority; artifacts/commit/receipt/effect IDs từ verified producers. Không dùng provider event counter làm sequence hoặc provider prose làm receipt. Persist theo scoped producer được PM giao ownership; thiếu authority→wait/throw |
| cancel | Persist request reason qua trusted cancellation port; native request gửi một lần cho exact current turn/session. Requested=true không suy stopped; stopped=true chỉ với exact ProcessJournal/full-tree proof và no running/unknown descendants |
| reconcile | Observer+durable session/checkpoint đọc lại exact process/pins; same native session resume chỉ sau stop/lifecycle policy cho phép. Transport loss/terminal failed/interrupted vẫn unknown nếu thiếu stop proof; không spawn replacement. Cross-runtime dùng Crew checkpoint và Task6/Phase06 authority |

**Tool effects:** Đưa normalized tool call vào ToolPolicy trước effect. `allow` chỉ readonly tools trong trusted set. `execute` mới được gọi target; verified receipt complete+fsync trước trả model. `return-receipt` lấy actual verified result qua receipt-reader port (ledger hiện không expose public reader); `reconcile/wait/deny` không execute. Source operation ID do Phase06 cấp; thiếu thì wait. Native autoexec Read/Bash/file edits/MCP/children cần pre-execution mediation và process-wide confinement riêng. Approvals/notification không chứng minh mỗi effect đã đi ledger. Claude callback allow cho native side effect không tự đưa complete/replay logic vào broker; Codex native approvals không có correlation đủ→deny/unavailable. Dynamic/MCP broker tools chỉ chọn sau schema, package và source-policy review.

**Child/fork:** current accepted pins không đổi, mọi child có policy/admission inheritance và owned process identity. Production hiện thiếu full-tree stopped authority; mặc định không enable native child/fork. Fake inherited-pin test chỉ kiểm mapping/state, không thay negative native canary.

## RED→GREEN kế hoạch fixture, chưa chạy

Chỉ hai test files và hai adapter files đã được giao ownership. Test fake transport trong hai test files; nếu phải thêm runner/support/schema validator/generated imports, xin PM ownership trước. Shared runtime fixture hiện có có thể gọi heavy/native workspace setup: phải kiểm entrypoint và nhận slot trước execute, không chạy ngầm từ imports.

| Nhóm | RED có ý nghĩa cần quan sát |
|---|---|
| Default deny | Missing release companion/channel/binary/schema/observer/entrypoint/logical authority: không input, không tool effect, không spawn |
| Claude init | Wrong setting sources/strict MCP/tools hoặc unexpected source; missing/duplicate skill/slash name; init không path/hash authority; projection byte đổi giữa init/invoke; slash missing dù result success phải reject |
| Claude result | Init/assistant text không terminal; success chỉ sau skill accepted + no unresolved effect; max-turn/budget/error/cancel/disconnect→uncertain, không complete/OS stopped; session mismatch/reconnect same pins |
| Codex handshake | initialize exactly once; initialized sau response; no thread/turn trước inventory. model catalogue≠entitlement; list pagination bounded, unsupported required schema fail closed |
| Codex source | skills list errors, disabled/duplicate/wrong canonical path; instructionSources outside audited roots; sourceTree/manifest/derivation mismatch; BMAD Codex null; skills changed invalidate current dispatch |
| Codex lifecycle | turn completed/failed/interrupted cases; wrong thread/turn/request IDs, late old-turn terminal, approval pending across interrupt, duplicate request same ID changed body; resume/fork same pins + source inventory recheck |
| Framing | UTF-8 split across chunks, multiple NDJSON frames/chunk, partial frame EOF, invalid UTF-8/JSON, oversize, deep nesting, excessive events/requests, timeout/backpressure, stdout logs, malformed error envelopes, unknown policy-sensitive event→uncertain/deny |
| Tool receipts | Missing Phase06 operation→wait; readonly/write mislabel→deny; native request without before-effect mediation→deny; actual ledger intent fsync before target, actual verified receipt before response, duplicate verified receipt replay, pending crash no reexecute |
| Stop/checkpoint | cancel ACK/result/EOF/PID exit/group empty không stopped; genuine exact stop only; host restart loses channel→unknown; fallback retains effects/artifacts/attachments and rejects cross-native-session reuse |
| Canaries | Fake selected/unselected Read/child/cross-skill negatives = consumer guard tests. Actual native Read/child/path/network/whole-tree matrix deferred, không ghi PASS từ fake |

Đề nghị bounds review: frame64KiB, aggregate1MiB/turn,4096 events/turn,64 outstanding requests, JSON depth32, startup10s/control3s, explicit backpressure và bounded terminal maps. Đây là application limits đề xuất, không limit upstream; legitimate oversize fail explicit, không truncate thành success. Schema acquisition/control init có bounds riêng; PM quyết định theo actual fixtures.

Meaningful RED gồm behavior assertion against minimal fail-closed adapter skeleton/harness thiếu handling; không coi import/module missing hoặc telemetry block là RED. Test tên chứa `claude adapter`/`codex adapter`. Brief pnpm pattern cần PM kiểm script forwarding; có thể dùng bounded `node --test --test-name-pattern=... <exact-two-files>` sau approved build/fixture preparation, không vô tình chạy full gateway native suite. Chưa chạy lệnh nào trong kế hoạch. Sau RED, PM cấp GREEN slot; scoped tests/typecheck/Biome/build đúng source snapshot, review spec/quality độc lập. Flow docs/manifest/generate do PM serialize cuối.

## File dự định và PM decisions

Đã ghi: báo cáo này, `task-4-evidence/adapter-design.md`, `task-4-evidence/static-source-inventory.json`. Dự kiến sau authorization: `v2/gateway/src/runtime/claude.ts`, `codex.ts`, `v2/gateway/test/claude-adapter.test.ts`, `codex-adapter.test.ts`; R3 `v2/docs/flows/gateway-runtime.md`, `gateway-models.md` chỉ sửa ở slot docs PM cấp. Không thêm shared/support/package/DTO/host/launcher source.

Các quyết định cần PM trả lời trước next step:

1. Cho chọn Claude CLI stream-json candidate sau sole launcher, hay SDK owned runner? Nếu SDK, ai sở hữu dependency/package/runner và bundled CLI pin acquisition?
2. PM đã cho thiết kế constructor-captured port. Ai được giao actual producer bidirectional channel, verified companion/entrypoint handoff và process observer? Launcher/gated-helper hiện không có port đó. Source/TDD vẫn chưa được cấp; injected fixture port không là production implementation proof.
3. Ai cấp current binary/schema/owned config authority, actual admission/certificate observer và descendant confinement? Slot acquire static generators khác slot native control-init khác live canaries; từng lượt cần fresh telemetry/admission.
4. Ai cấp durable session/checkpoint/result/usage sink, verified receipt reader và Phase06 logical-operation/attachment authority? Usage chỉ provider observation, không dispatch/cost-budget authority; không sửa DTO để né gap.
5. Sau khi duyệt báo cáo và các protocol producer gaps, PM cấp explicit source/TDD ownership và serial fixture RED slot nào? Port design đã được cho phép, chưa phải authorization chạy fixture. Native/full-tree/host composition/live acceptance giữ pending.

Không có unresolved câu hỏi UX hoặc workflow-source selection: exact official skill, runtime×workflow projection, v2 independence và accepted globals giữ nguyên. Còn lại là ownership/producer/protocol evidence, không xin thay đổi scope đã duyệt.


<!-- Task4 static continuation: pin preparation, 2026-10-03 -->

# Task4 — recipe acquisition offline và baseline RED

Tiếp tục STATIC theo PM ruling17:30:45. Chọn **Claude CLI stream-json sau sole launcher**, không SDK query hoặc dependency SDK mới. Báo cáo primary `task-4-static-report.md` và research Phase03 giữ nguyên. Lượt này chỉ read metadata/bytes public executable, read accepted source, ghi preparation evidence/report. Không CLI invocation, model/auth/provider, test/build, install, host/source adapter hoặc DTO mutation.

## Current executable file identity, protocol vẫn unknown

`command -v` là shell lookup, không chạy CLI. Đã chỉ đọc exact executable artifacts và exact public standalone release metadata; không đọc owner HOME configuration/auth/history/credentials. Các binary nằm dưới HOME nhưng phạm vi đọc chỉ là public installed distribution paths.

| Runtime | Lookup và canonical executable | Static SHA256 bytes |
|---|---|---|
| Claude | `/Users/phannhatquang/.local/bin/claude` → `/Users/phannhatquang/.local/share/claude/versions/2.1.284` | `50a14c2f50f56668380fdda490167f1d3630d5cc18fb8aed3073c2c7ea7314fe` |
| Codex | `/Users/phannhatquang/.local/bin/codex` → `/Users/phannhatquang/.codex/packages/standalone/releases/0.159.3-aarch64-apple-darwin/bin/codex` | `4d210f7c5a18fd0386434df23b5bdbb8c0e7257d3e8a2b30b0769c8bbe99a878` |

Cả hai là regular file uid501/mode0755/linkCount1; đọc lại bằng O_NOFOLLOW FD, streaming hash1MiB, fstat trước/sau và recheck canonical lookup/path identity. Exact inode/device/size/mtime/ctime ở `task-4-evidence/pin-preparation/installed-executable-identities.json`. Không tuyên bố execution/signing/authenticity/license support từ các metadata này. Version Claude2.1.284 là tên file; Codex0.159.3 được public `codex-package.json` layout1/target aarch64 metadata khai báo. `--version` chưa chạy.

Codex public release root chỉ thấy `codex-path`, `bin`, `codex-resources`, `codex`, `codex-package.json`; resources top-level `voice`, `zsh`, bin có `codex-code-mode-host`. Không đọc resource bodies hoặc helper vì chưa cần generator; runtime helper closure sẽ cần byte/signing/license authority riêng trước native runtime. `/Applications/Codex.app/Contents/Resources/codex` không tồn tại ở path đã kiểm, không thay bằng app path đoán.

Không thấy LICENSE/NOTICE hoặc SDK declarations ở các exact adjacent paths đã kiểm; đây là **missing evidence ở paths đó**, không claim distribution không có license. Không scan binary strings làm schema, không tìm owner package/config root rộng. SDK reference fetch lượt trước không thành công; không dùng ví dụ cũ như current declarations. Schema3 lịch sử Phase03 vẫn chỉ historical regression, chưa là full current schema dù metadata version trùng.

## Recipe concrete, chưa thực thi

Các argv dưới đây chỉ là specification cho controller runner; không bare shell invoke. Một job/slot mới cho từng generator hoặc init cần telemetry fresh và explicit authorization. Không dành lại slot đang thuộc Assistant. Native control-init phải được producer ownership/isolation/whole-tree rõ trước execute. Static file read không tạo server admission/certification.

Controller reserve/attest một scratch root: `/private/tmp/crew-v2-task4-pins-<operationId>` với actual UUID operation và resource identity receipt; không nhận path caller tự cấp. Root có `bin`, `home`, `tmp`, `cwd`, `out/json-schema`, `out/typescript`, `logs`. Không đặt CWD dưới ancestor owner workflow; không inherited env/proxy/auth/config. Actual resource/command/process receipts thuộc controller, Task4 không tự thêm producer.

1. **Copy/identity offline**: qua no-follow source FD, copy exact binary bytes vào scratch `bin/claude` và `bin/codex`; hash source trước/sau, exclusive dest + mode0755 + fsync, no-follow dest/identity hash khớp bảng. Copy không chứng minh license/signature. Không sửa install/current symlink/global HOME. Nếu binary cần relative resources thì dừng lỗi có mã; controller review exact public resource closure, không tự nới read HOME.
2. **Version riêng**: argv `[<scratch>/bin/codex, '--version']`, `[<scratch>/bin/claude, '--version']`; stdout4KiB/stderr4KiB/deadline3s; no retry, no auth/status/model command. Record actual start/exit/closure/binary digest/config/env digest sanitized. `--help` cũng invocation riêng nếu cần, không chạy tự động theo error.
3. **Codex full schema**: argv `[<scratch>/bin/codex, 'app-server', 'generate-json-schema', '--out', '<scratch>/out/json-schema']`; job riêng `[<scratch>/bin/codex, 'app-server', 'generate-ts', '--out', '<scratch>/out/typescript']`. Primary [App Server](https://learn.chatgpt.com/docs/app-server) tài liệu hóa hai generators gắn version CLI. Bounds đề nghị20s/job, stdout/stderr32KiB, tree64MiB/2048 regular files, no symlink/hardlink/executable output, UTF8/readable schema; exceeded→fail, giữ closure evidence. PM chỉnh bounds dựa actual output trước retry, không truncate bundle và gọi full schema.
4. **Schema inventory**: đọc definitions actual emitted (không đoán filename layout) để tạo method→request/response/notification/server-request map. Required methods: initialize/initialized, model/list/pagination, skills/list, thread/start/resume, turn/start/steer/interrupt, final status/error, skill input, instruction source metadata và pre-effect tool/approval support. Method/field missing→variant unsupported; không silently bỏ policy. Ghi hash từng file + sorted tree digest + generator output names + binary SHA + version. TypeScript generation phải cùng binary, không installed SDK/compiler mới.
5. **Claude current declarations**: native executable không expose declarations trong exact adjacent paths đã kiểm. Recipe chờ controller chỉ định artifact công khai hoặc archive/declaration origin+version+integrity+license có cùng native CLI protocol; không npm install/fetch package tự ý. Không lấy latest Agent SDK types rồi giả bundled CLI2.1.284. Nếu approved public declarations không có, cần một current no-model control init transcript để xác lập exact message envelope; transcript không thay license hoặc toàn bộ schema. Chưa pin wire parser dựa trên examples.
6. **No-model control-init tách riêng**: chưa chạy, chưa author fixed stdin guessed wire. Codex sau schema bundle valid sẽ encode exact initialize + initialized + model/skills control requests được PM duyệt; không thread/turn/command-exec/auth/login/provider. Claude sau declarations sẽ dùng CLI stream-json init/control-only được xác nhận, strict owned MCP/settings, không prompt. Source control/hook/native boot có khả năng spawn/read/network nên cần ownership/full-tree evidence; không suy generator offline làm startup harmless. Nếu current protocol không có init-only không-model tương thích, dừng unknown, không gửi `Hello` để ép init.

Environment allowlist phải do runner bind exact runtime requirements, tối thiểu owned HOME/TMP và runtime config dirs; không dùng spread `process.env`. Read-only helper dylib/native runtime resource requirements do confinement producer review; không whitelist cả ownerHOME. Generator và version jobs không cấp native tool/child entitlement. Timeout/kill/no output không chứng minh process tree stopped; unknown giữ resource receipt.

### Evidence destination cố định

Tất cả dưới `plans/261002-0002-crew-v2/execution-phase04/task-4-evidence/pin-acquisition/<operationId>/`:

- `root-identity.json`, `commands.json`, `binary-identities-before.json`, `binary-identities-after.json`.
- `codex-version.stdout`, `claude-version.stdout`, bounded sanitized stderr, actual exit/deadline/resource receipts.
- `codex-json-schema/` và `codex-typescript/` giữ actual output relative paths; `schema-inventory.json`, `protocol-method-map.json`, `protocol-binding.json`.
- `claude-public-declaration-inventory.json`, exact LICENSE/NOTICE source bytes và integrity origin nếu được cấp; thiếu giữ null/unknown, không minted approved license.
- `control-init/*.ndjson` chỉ sau schema+authorization, sanitized transcript byte hashes + exact argv/stdin/exit + closure receipts; `resource-closure.json` giữ unknown nếu chưa stop proof.

`protocol-binding.json` là review evidence proposal, không durable execution schema mới. Nó liên kết runtime/binary SHA/declaration bundle SHA/schema bundle SHA/argv/config/OS/observedAt; không admission/certificate. Version/schema file capture phải repeat byte identity trước consumer start, không cache current symlink làm pin.

## Runner và import side effects

Actual `v2/gateway/package.json`: `test` chạy `pnpm build && node --test test/*.test.ts`. Vì glob, forwarded pattern không bảo đảm chỉ hai file; build typechecks toàn src. Current tsconfig include toàn src+test và server declarations; tránh full test khi chưa slot. Sau authorization dùng exact direct Node test target (không package script glob), được controller quyết định build/typecheck scope:

```text
node --test --test-name-pattern='claude adapter' test/claude-adapter.test.ts
node --test --test-name-pattern='codex adapter' test/codex-adapter.test.ts
```

Working directory exact `v2/gateway`; options trước file. Đây là recipe, chưa execute. Node/runtime/compiler paths cũng phải controller pin, không dùng arbitrary PATH compiler.

Read source import graph: ToolPolicy→effect-ledger→atomic-records→ProcessLock chỉ khai báo classes/functions/constants; không spawn ở module top-level. `new ToolPolicy()` và `deriveEffectId()` là pure/in-memory. `AtomicRecords.open()` gọi ProcessLock.acquire→`lockf`/Node child: **heavy/native**, không dùng trong synthetic-only tests. `RuntimeIsolation` constructor mặc định không observe/open/spawn; `.assert(pin)` thiếu observer từ chối trước workspace. `runtimePinFixture()` chỉ UUID/hash fixture; không use `runtimeRoot`, `workflowFixture`, `runtimeWorkspaceFixture` vì chúng prepare/launch. Existing `runtime-boundary.test.ts` chạy actual workspace/journal/native helpers trong test bodies: không import test module hoặc gọi producer fixtures vào two-file normalized test set. Import source modules không import/execute tests tự động; no dynamic module import from unverified runtime package.

## Meaningful RED baseline đề nghị, chờ source authorization

Chưa author hai test files vì current protocol-pins incomplete và production skeleton chưa được cấp. Không ghi import-missing là RED. Có thể author synthetic normalized tests sau PM chấp nhận baseline mà không wire parse.

**Existing accepted baseline kiểm safety:** ToolPolicy default unknown tool→deny; allowed write thiếu Phase06 metadata→wait; readonly mislabel→deny; proper logical metadata nhưng missing ledger→wait. RuntimeIsolation thiếu observer→ISOLATION_NOT_BOUND. Đây là expected GREEN regression của producer hiện hữu, không adapter implementation RED. Không thêm bộ test producer trùng lặp chỉ để lấy số lượng PASS.

**Explicit fail-closed skeleton proposal** (chưa viết): trong đúng `runtime/claude.ts` và `codex.ts`, implement bảy methods, constructor-captured normalized trusted ports; tất cả unavailable/defaultdeny khi port absent. `start()` ban đầu deny cả valid synthetic released-channel case và chưa gửi skill. Skeleton không parse vendor wire/spawn/durable schema; test transport normalized sequences fake, mark synthetic. Controller cấp source slot cho skeleton trước RED runner, wire support còn gated current schema/declarations.

Meaningful first RED: valid exact synthetic RuntimePin+verified companion/current release descriptor+same-runtime inventory+entrypoint, authorized normalized skill invocation phải gửi **một** selected-skill input tới captured transport và trả namespaced session/exact processIdentity; skeleton deny/no call nên behavioral assertion fails (không module missing). Những input trước initialize, wrong pin/canonical path, missing slash/skill, missing release/observer/logical operation vẫn expected deny/wait và zero calls. `result success` khi skill chưa accepted vẫn reject; cancel ACK không OS stopped. Test giả chỉ xác nhận state machine/consumer guard, không product dispatch/native certification. GREEN chỉ thêm handling tương ứng sau RED observed + explicit slot, không nới runtime authority để làm tests pass.

Synthetic normalized decoder port không được dùng làm raw wire acceptance test. Current schema chưa có→wire-facing subset chờ, không manufacture transcript fields. Nếu không được duyệt skeleton/source, giữ task ở preparation ready; không tự lấy existing producer regression PASS làm Task4 RED/GREEN.

## Next decisions cụ thể

1. Controller cấp serial **offline binary/version/schema acquisition** slot với exact runner/resource ownership hoặc giữ static. Native control-init là authorization khác; full-tree/isolation producer gaps giữ nguyên.
2. Chỉ định current public Claude protocol declarations/license artifacts được phép đọc hoặc chấp nhận gap unknown; Codex license artifact cũng chưa tìm được tại adjacent public paths. Không tự install/download.
3. Sau schema/declaration review, cấp owned skeleton+two test files và exact RED runner slot; trước đó không adapter production source/test execute. Host channel/companion/observer và Phase06 operation/checkpoint/result/receipt/attachment integration vẫn do controller giao riêng, absent default deny.

<!-- Task4 bounded CLI metadata continuation, 2026-10-03 -->

## Bounded offline --version/--help: actual evidence

PM cấp riêng đúng `--version`, `--help` trên hai canonical binary đã hash. Bốn process chạy tuần tự, isolated owned CWD ngoài project, môi trường allowlist với HOME/config/tmp riêng; stdin DEVNULL, deadline10s, stdout/stderr cap4KiB version hoặc64KiB help. No-follow streaming SHA và fd/path identity trước/sau từng CLI khớp pins cũ. Không schema generator, app-server startup/initialize, model/exec/auth/Keychain/install/test/source adapter calls. Existing reports/source producers giữ nguyên.

| Lệnh exact argv sau canonical binary | Exit | Stdout bytes | Stderr | Fresh pressure / RAM available / quota remaining |
|---|---|---|---|---|
| Claude `--version` | 0 | 22 | 0 | 2 / 4.04GiB / 73% |
| Codex `--version` | 0 | 18 | 0 | 2 / 3.98GiB / 73% |
| Claude `--help` | 0 | 22114 | 0 | 2 / 4.25GiB / 73% |
| Codex `--help` | 0 | 5849 | 0 | 2 / 3.22GiB / 73% |

Pressure2 là warn, không critical4; PM cấp scope metadata và yêu cầu critical thì hold. Không dùng dispatch gate thường của production để cấp model execution. Mỗi lượt quota read mới và sample pressure/vm/CPU/disk mới ngay trước spawn, quota age<15s; RAM>=2GiB/disk>=5GiB là ngưỡng implementer tự chọn cùng pressurecheck, **không phải ngưỡng PM đã chỉ định hoặc phê duyệt hồi tố**. Exact timestamps/CPU text/disk/argv/cwd/env/exit/SHA/output hashes nằm trong `task-4-offline-evidence/{claude,codex}-{version,help}.json`; chỉ quota gate summary, không account ID/token. `summary.json` kiểm readback byte lengths/SHA của tất cả outputs. Lượt app-server help tiếp theo dùng strict explicit gate PM mới: pressure1/2, RAM>=4GiB, idle>=50%, disk>=8GiB, quota remaining>25%.

Version **được executable hiện hành báo thật**: `2.1.284 (Claude Code)` và `codex-cli 0.159.3`. Đây là nâng cấp evidence so với path/metadata-only ở phần trước. Không chứng minh binary signing/license/authentication/protocol schema/entitlement.

Claude help xác nhận input/output stream-json, setting-sources, strict-mcp-config, permission-prompts và restricted mode. Có flags không đủ chứng minh message envelope hoặc native enforcement. Help không liệt kê đầy đủ mọi flag theo [CLI reference](https://code.claude.com/docs/en/cli-reference); không suy absence của init-only/control field là unsupported. Không gửi prompt để lấy init. Codex top help dòng16 có `app-server` experimental related tooling; chưa kiểm subcommand help/generator trên binary hiện hành.

## Public protocol/license clarification và next narrow recipe

[App Server](https://learn.chatgpt.com/docs/app-server) vẫn là primary generator contract; [developer commands](https://learn.chatgpt.com/docs/developer-commands) mô tả experimental option khi sinh gated fields. Không tự thêm experimental vào recipe: cần review actual current generated schema subset trước mở tool support. Official current docs là tài liệu public, chưa bind toàn bộ wire vào exact executable SHA. Historical3schema trùng version string vẫn không thay full regenerated bundle.

[Open Source](https://learn.chatgpt.com/docs/open-source) cung cấp danh sách components/source; page đã đọc không xác lập exact release LICENSE/NOTICE cho standalone0.159.3. Giữ exact release license evidence pending, không tự gọi là Apache hoặc đã được phép redistribute. Public repo/license origin cần controller chỉ định exact release/revision trước pin.

[Claude legal/compliance](https://code.claude.com/docs/en/legal-and-compliance) có license/terms theo loại tài khoản và điều kiện đưa Claude Code vào sản phẩm: binary nguyên bản, authentication của end user và billing trực tiếp. Đây là bằng chứng điều kiện public hiện tại, không approval pháp lý cho Crew hoặc quyền redistribute exact2.1.284. Không inspect credential để xác định agreement/account. Exact current CLI stream/control declarations và license artifact vẫn missing; TypeScript SDK reference/Markdown fetch tiếp tục không trả nội dung qua web tool, không lấy types chưa đọc làm wire DTO.

**STOP executable sau bốn lệnh đã được cấp.** Recipe nhỏ nhất tiếp theo để PM duyệt riêng:

1. Exact argv `[/Users/phannhatquang/.codex/packages/standalone/releases/0.159.3-aarch64-apple-darwin/bin/codex, app-server, --help]` trong scratch mới+fresh resource/quota gate+same SHA, deadline10s/cap64KiB; chỉ kiểm generator subcommands. Chưa được chạy trong lượt này.
2. Chỉ sau kết quả step1 và PM release mới: exact binary `app-server generate-json-schema --out <owned scratch>/out/json-schema`, rồi `generate-ts --out <owned scratch>/out/typescript` thành jobs riêng. File receipts và bundle map theo pin-preparation recipe ở trên; không raw app-server/stdio listener, không initialized/thread/turn/model. Nếu help/schema thiếu method/policy cần thiết thì hold unsupported, không đoán field.
3. Claude public declaration bundle cần origin/version/license đủ bind2.1.284; không install SDK, independent query spawn hoặc model init. Các ports channel/observer/logical operation/receipt/checkpoint/attachment giữ default deny và integration ownership riêng.

Four scratch roots exact device/inode/UID đã ghi trong command evidence và giữ nguyên vì chưa có native whole-tree observer chứng nhận closure. Actual CLI subprocess exit/wait là evidence đã reap process trực tiếp, không stopped proof toàn cây. Không xóa owner resources hoặc dùng group-empty làm certificate; scratch retention nhỏ này được bàn giao controller để reconcile. Scope không cấp Task4 production source hoặc tests/RED.


<!-- Task4 current Codex offline schema acquisition, 2026-10-03 -->

## Codex0.159.3: current offline wire pin đã thu được

Đây là continuation thực thi đúng narrow release mới của PM, thay trạng thái chưa chạy của recipe phía trên. PM cho phép `app-server --help`, rồi batch hai generator helps và hai emit-only generators nếu help xác nhận `--out`. Mỗi CLI có fresh strict gate: pressure1/2, availableRAM>=4GiB, CPUidle>=50%, disk>=8GiB, weeklyremaining>25%. Không dùng ngưỡng tự chọn RAM2GiB/disk5GiB của lượt metadata trước để gán PM approval; attribution đã sửa rõ ở phần trước.

Năm CLI chạy tuần tự trên canonical binary `/Users/phannhatquang/.codex/packages/standalone/releases/0.159.3-aarch64-apple-darwin/bin/codex`, SHA `4d210f7c5a18fd0386434df23b5bdbb8c0e7257d3e8a2b30b0769c8bbe99a878`, fd/path device16777229 inode62402722 UID501 size240351424 trước/sau không đổi. CWD/HOME/config/tmp exclusive owned ngoài project; env allowlist, stdin DEVNULL. `app-server --help` deadline10s; batch sau deadline15s/job, stdout/stderr64KiB, output64MiB/2048files/no-symlink. Không thêm `--experimental`, `--prettier`, config override, feature enable, server listen/initialize, model prompt/turn, auth/login, installation hoặc source/test process.

| Exact argv sau binary | Exit | Stdout / stderr bytes | Fresh pressure / availableRAM / idle / weeklyremaining |
|---|---|---|---|
| `app-server --help` | 0 | 3214 / 0 | 2 / 4.40GiB / 64% / 72% |
| `app-server generate-json-schema --help` | 0 | 1075 / 0 | 2 / 5.27GiB / 74% / 71% |
| `app-server generate-ts --help` | 0 | 1176 / 0 | 2 / 5.10GiB / 69% / 70% |
| `app-server generate-json-schema --out /private/tmp/crew-v2-task4-codex-help-8qdyn6gx/json` | 0 | 0 / 0 | 2 / 5.25GiB / 75% / 70% |
| `app-server generate-ts --out /private/tmp/crew-v2-task4-codex-help-tj0dvhjf/ts` | 0 | 0 / 0 | 1 / 5.25GiB / 76% / 70% |

Actual help xác nhận `--out` emit files; TypeScript help có optional `--prettier <PRETTIER_BIN>`, không được dùng. Hai helpers/generator receipts+raw stdout/stderr đầy đủ nằm trong `task-4-offline-evidence/`. [App Server](https://learn.chatgpt.com/docs/app-server) mô tả generators theo CLI version; [developer commands](https://learn.chatgpt.com/docs/developer-commands) giải thích experimental option. Evidence này pin **default output của exact current binary**; không suy default bao phủ mọi experimental feature.

| Complete emitted bundle giữ nguyên bytes | Regular files | Bytes | Sorted inventory SHA256 |
|---|---|---|---|
| `task-4-offline-evidence/protocol-json/` | 314 | 3540819 | `4fbf973e454ab8b8c313817e1367db90072104775e70ed53b0e2f8a38a3c4b6a` |
| `task-4-offline-evidence/protocol-ts/` | 734 | 428142 | `6fa0dd520dd954703fc242ce9e02153e055e06853a2b4b35ccb38d956840ca04` |

Hash definition: SHA256 UTF8 JSON sorted list `[relativePath,bytes,fileSha256]`, separators comma/colon, ensure_ascii=false. Đây là evidence fingerprint, không schema authority/certificate do producer tạo. `codex-json.json`, `codex-ts.json` giữ full per-file generated inventory+argv+before/after FD identity+gate+exit. Sau copy vào evidence, readback từng file và sorted inventory khớp toàn bộ bundle; không truncate output thành ba schemas cũ. `acquisition-summary.json` 8132bytes SHA `a56d9f3debeae3c28de19b5a2e7bfe4d50ee2faff21290c07fd378ea532dcbdf` lưu readback và cleanup pointers.

## Exact generated subset, không manufacture fields

`protocol-method-map.json` 21890bytes SHA `ae29e7596c88d1b0a25411df01d1a021f0cd936f1723dd0384f48122b6792ec7` lấy definitions trực tiếp từ current envelopes và schema files; 21 selected methods đều có mặt. Đây là thiết kế decoder subset, chưa native acceptance. Envelope requests require `id,method,params`; notifications require `method,params`, riêng `initialized` chỉ require `method`.

| Wire direction | Selected actual methods |
|---|---|
| Client request | `initialize`, `model/list`, `skills/list`, `thread/start`, `thread/resume`, `thread/fork`, `turn/start`, `turn/steer`, `turn/interrupt` |
| Client notification | `initialized` |
| Server request | `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/call` |
| Server notification | `skills/changed`, `turn/started`, `turn/completed`, `item/started`, `item/completed`, `serverRequest/resolved`, `item/agentMessage/delta` |

**Initialize/version/capabilities:** `v1/InitializeParams.json` có `clientInfo,capabilities`, chỉ require `clientInfo`; ClientInfo require `name,version`, optional `title`. `InitializeResponse` require `codexHome,platformFamily,platformOs,userAgent`. Actual `protocol-ts/InitializeParams.ts` lại ghi `capabilities: InitializeCapabilities | null` bắt buộc. Đây là khác biệt artifact JSON-vs-TS thật cần review trước binding; không gọi hai bộ tự động tương đương. Decoder/encoder proposal có thể dùng explicit `capabilities:null` sau PM review, nhưng chưa gửi native initialize. UserAgent/version response chưa được quan sát vì không khởi động server.

**Model/skill inventory:** ModelListParams có `cursor,includeHidden,limit`; response require `data`, optional `nextCursor`. Catalogue metadata không cấp model entitlement hoặc cấu hình hợp lệ cho owner. SkillsListParams chỉ có `cwds,forceReload`, không có `perCwdExtraUserRoots`. SkillMetadata require `description,enabled,name,path,scope`; `path` type AbsolutePathBuf không chứng minh pin/bytes/ownership. Current ClientRequest **có** `skills/extraRoots/set`, `skills/config/write` và config mutation methods. Không gọi các methods này; không suy thiếu perCwd field nghĩa mọi extra roots unsupported, cũng không tự dùng setter để sửa projection immutable. Runtime-specific selected-skill source/read proof vẫn cần trusted producer.

**Thread/instruction sources:** ThreadStartParams có `approvalPolicy,approvalsReviewer,baseInstructions,config,cwd,developerInstructions,ephemeral,model,modelProvider,personality,sandbox,serviceName,serviceTier,sessionStartSource,threadSource`; **không có `dynamicTools` trong default generated schema**, không có request `instructionSources`. Response có optional `instructionSources` default empty array, items LegacyAppPathString được mô tả là environment-native loaded instruction paths. Metadata này không cấp OS isolation hoặc chứng minh selected SKILL bytes đã loaded; thiếu/empty→required source proof chưa có. ThreadResumeParams require `threadId`; fork/resume native session quyền truy cập chưa được kiểm thực tế. Không reuse v1 session như current v2 proof.

**Skill invocation/turn lifecycle:** TurnStartParams require `input,threadId`; actual SkillUserInput require `name,path,type` với `type:"skill"`, `path` string. Không đổi syntax này thành invented `{skillId,entrypoint}`. TurnSteerParams require `expectedTurnId,input,threadId`; optional `clientUserMessageId`. TurnInterruptParams require `threadId,turnId`; response empty object. TurnCompletedNotification require `threadId,turn`; Turn require `id,items,status`, status enum `completed,interrupted,failed,inProgress`. `completed` mới là successful native turn status candidate; còn accepted entrypoint/results cần riêng. Interrupt response/turn interrupted không chứng minh OS subtree stopped, không terminalize ledger chỉ vì ACK.

**Approval/tool callbacks:** CommandExecutionRequestApprovalParams require `itemId,startedAtMs,threadId,turnId`; command/cwd/approvalId/environmentId và policy amendment metadata optional. FileChange require cùng item/time/thread/turn; Permissions require `cwd,itemId,permissions,startedAtMs,threadId,turnId`. DynamicToolCallParams require `arguments,callId,threadId,tool,turnId`, optional `namespace`; response require `contentItems,success`. Presence callback không chứng minh broker đăng ký được trong default ThreadStart hoặc phủ mọi native effect. `callId/itemId/turnId` không tự thành stable logical operation/accepted effect receipt. Chính sách accept/session/network/execpolicy unions có trong schema nhưng không phải permission của Crew. Không sản xuất decision accept khi actual ToolPolicy/ledger/logical operation chưa bind; thiếu Phase06→wait/defaultdeny.

`serverRequest/resolved` chỉ require requestId/threadId, không phải durable receipt; agent message deltas và item notifications không phải attachment/result authority. Không mint checkpoint/result/receipt schemas từ vendor fields. Schema map chỉ đủ dựng fixture đúng shape sau được cấp source/test slot; nó không tự cho phép parser production, native round-trip, skill invocation hoặc whole-product PASS.

## Scratch cleanup: metadata ruling và observed outcome

PM làm rõ full-tree production certificate cần cho production admission/release, không bắt buộc cho ordinary bounded metadata scratch deletion. Với exact owned roots, actual directwait/reap exit0 + matching own PID/pgid/argv/birth reconciliation snapshot + exclusive device/inode/UID/no-symlink tree + raw evidence đã persisted đủ cho cleanup phạm vi dev này. Không dùng group-empty làm production stopped proof. Snapshot chỉ persist matches của owned identities, không lưu argv process unrelated.

Intent và receipts đã persist trước mutation. Exact roots dưới đây có device16777229/UID501/mode0700; inode ghi trong bảng và full lstat child inventory trong receipts. Deleted roots được recheck identity từng child/root rồi observed absent. Tất cả matching owned processes tại snapshots rỗng; direct waits đã hoàn tất. Không kill user process hoặc prefix prune.

| Exact owned root | Inode | Observed outcome |
|---|---|---|
| `/private/tmp/crew-v2-task4-claude-version-asxcrhxk` | 64470735 | deleted, absent observed |
| `/private/tmp/crew-v2-task4-codex-version-vdftxo34` | 64470806 | retained: symlink tree |
| `/private/tmp/crew-v2-task4-claude-help-iz_0wiie` | 64470881 | deleted, absent observed |
| `/private/tmp/crew-v2-task4-codex-help-oxa3wnb2` | 64470951 | retained: symlink tree |
| `/private/tmp/crew-v2-task4-codex-help-e3pijnwg` | 64475797 | retained: symlink tree |
| `/private/tmp/crew-v2-task4-codex-help-0u3vs0mo` | 64477810 | retained: symlink tree |
| `/private/tmp/crew-v2-task4-codex-help-52xhk4e2` | 64477896 | retained: symlink tree |
| `/private/tmp/crew-v2-task4-codex-help-8qdyn6gx` | 64477935 | deleted after full generated bundle evidence copy/readback |
| `/private/tmp/crew-v2-task4-codex-help-tj0dvhjf` | 64478646 | deleted after full generated bundle evidence copy/readback |

Codex metadata helpers left `codex-config/tmp/arg0/codex-arg0*/{applypatch,apply_patch,codex-execve-wrapper}` symlinks pointing exact pinned public Codex binary. Link UID/device/inode/target captured; no-symlink cleanup precondition fails, so five roots retained without following/unlinking targets. Generator roots no longer had these links and passed exact tree checks. Total4 roots deleted,5 retained; no claim all resources cleaned. First cleanup attempt selected incorrect output stem and failed FileNotFound before intent/mutation; next attempt deleted Claude version then stopped on symlink assertion. Corrected helper recorded blockers/continued and preserved already written deletion receipt; this is recorded failure handling, not rewritten success history.

`metadata-cleanup-receipt.json` 11442bytes SHA `405928c38715aba4757291596953f9ec0b425ef2ad8e9aac89e8d50895fa2390`; `acquisition-cleanup-receipt.json` 261144bytes SHA `b2d7d263fe6b86fc66c354274cbd5c9b1a3bda28ebfdccc966f490690415485d`. Historical command `scratchRetained:true` remains a capture-time fact, superseded for current cleanup by these receipts; raw CLI outputs/generator file inventories remain unchanged. Production whole-tree stop/host observer/isolation certificates remain UNVERIFIED.

## Ready handoff và còn chờ producer/authorization

Offline **Codex default schema acquisition completed**; exact bundle now replaces old partial protocol samples for decoder design. Không gọi là protocol/native PASS. Next concrete review: choose JSON required/nullable interpretation vs generated TS, accept scoped method map and defaultdeny behavior for unsupported dynamic tool registration, then separately authorize owned failclosed skeleton+synthetic behavioral RED slot if appropriate. Existing test runner import side-effect constraints và meaningful RED proposal phía trên vẫn áp dụng; chưa tạo/run source/tests.

Claude CLI2.1.284 help/version pin current, nhưng current stream-json/control declaration bundle, license origin và no-model init envelope vẫn pending; không dùng SDK query độc lập hoặc latest SDK types giả bundled native wire. Codex exact release LICENSE/NOTICE chưa pin; generated ts-rs header không cấp redistribute license. [Open Source](https://learn.chatgpt.com/docs/open-source) và [Claude legal/compliance](https://code.claude.com/docs/en/legal-and-compliance) là public references đã đọc, không substituted legal approval/exact release artifact. Đây không cản offline batch PM đã cấp, nhưng cần owner/controller giải quyết trước production distribution/admission.

Trusted Launcher sole release-channel+actual current-release/process identity wiring vẫn thiếu producer ownership; no independent spawn. Checkpoint/result/receipt/attachment/host observer và Phase06 stable logical operation/effect authority vẫn defaultdeny hoặc wait khi absent. Không thể mở native skill turn/tool execution chỉ vì đã có schema. PM cần giao rõ integration owner và narrow source/test/native control authorization tiếp theo; Task4 không tự sửa launcher/helper/supervisor/ledger/DTO hoặc cấp quyền cho mình.

## PM cleanup continuation — 2026-10-03

PM matched all five retained roots to prior dev/ino/UID and complete child inventories, direct wait exit0 and no current matching processes. Narrow ruling allows unlinking the fifteen captured owned symlinks themselves without following targets; all five roots are now absent. Exact pinned Codex binary SHA256 remains unchanged. Evidence: task-4-offline-evidence/pm-symlink-cleanup-intent.json and pm-symlink-cleanup-receipt.json (SHA256 d61d5d952f18b7e0c8e140ba960a7fcb4d98da870de811dd59a2a4a4da43827e). First cleanup sorting TypeError occurred before any deletion, then corrected with full identity revalidation. Raw protocol bundles remain needed. This is ordinary development scratch cleanup, not production whole-tree STOP certification.
