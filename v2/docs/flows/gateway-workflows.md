# Registry nguồn và projection workflow bất biến

## Mục đích

Giữ BMAD và Superpowers cạnh nhau trong registry riêng của host. Exact official source bytes, provenance và canonical tree được kiểm trước publish; mỗi runtime có projection pin riêng. Task 4 tạo artifact local, chưa cấp quyền dispatch, gọi model hoặc chứng nhận cách ly runtime.

## Điểm vào

- `registry.ts` → `WorkflowRegistry.open`, `installSource`, `deriveProjection`, `resolve`, `retain`, `release`, `reclaim`, `collectPublished`, `retentionInventory`.
- `audit.ts` → candidate source, Superpowers Claude/API và BMAD installer artifacts; application phải audit/preapprove exact pins.
- `native-projection.ts` → standalone Codex native artifact được review riêng; không phải marketplace package.
- `isolation/preflight.ts` → `createIsolationPreflight` bind registry thật và root riêng; các hàm module chưa bind từ chối. Factory cung cấp `prepareWorkspace`, `preflightSourceIsolation`, `cleanup`, `close`; không cấp quyền launch.

## Các bước

1. `pins.ts`, `fetch.ts`: validate strict SourcePin/ProjectionPin và URL HTTPS exact repository/release/revision; kiểm từng redirect, tối đa ba redirect, archive 32 MiB và download 30 giây. BMAD npm kiểm cả payload SHA-256 và SHA-512 SRI trước extract. URL allowlist không tự chứng minh provenance của stream do caller cung cấp.
2. `stage.ts`: parser tar-stream ghim 3.1.7; chặn traversal, Unicode NFC/case collision, duplicate, special/hardlink entries và executable ngoài audit. Tree tối đa 128 MiB/20.000 entries, gzip có expanded bound. Ghi link sau files/directories; canonical target phải trong tree, không dangling/cycle/escape. Directory 0755, regular file 0644/0755 theo audit, symlink mode null.
3. Canonical entries sort byte UTF-8 theo path slash/NFC. Manifest ghi path/type/mode/bytes/sha256/target; loại filesystem mtime/UID/GID/xattrs/archive order. Source tree hash bind sourceManifestSha256/sourceRevision/packageIntegrity/payloadSha256. Projection tree hash bind sourceTreeSha256/runtime/manifestSha256/derivation tool/version/options/layoutSchema/policySha256. Pin/manifest/current pointer nằm ngoài counted tree. Exact payload khác vẫn tạo source tree pin khác dù manifest giống.
4. `registry.ts`: AtomicRecords OS writer lock và transaction queue serialize reserve/build/publish/activation. Durable intent trước create, ownership marker và device/inode/UID trước build; fsync tree/record/parent rồi rename. Verify immutable path nếu đã tồn tại; không overwrite. Abort được kiểm trước operation và ngay trước activation, kể cả cached source A sau current B; cached projection cũng kiểm cancellation.
5. `builder.ts`: exact BMAD package-local official `bmad-cli.js install --directory <owned> --yes --modules bmm --tools claude-code --no-shims`, fixed user/language inputs. Frozen 13 direct dependencies/99 direct+transitive packages, exact lock/package/payload hashes/SRI/file-byte evidence. Node 24.14.0 và uv 0.11.3 được bind bằng binary hash; không global install. Child HOME/TMP/XDG riêng, không inherited env/credential/proxy/module path. Sandbox deny network/fork, giới hạn writes trong stage. Upstream update/module lookup không được ra ngoài sandbox; installer bytes không sửa.
6. BMAD generated operational dates chỉ normalize tại `_bmad/_config/manifest.yaml`, `_bmad/core/config.yaml`, `_bmad/bmm/config.yaml` về epoch; cập nhật tương ứng hash của đúng các file ấy trong files-manifest.csv. Skill text/config/script/renderer gốc giữ byte. Hai build độc lập phải cho cùng canonical manifest và exact expected pin. `_bmad/scripts/render_skill.py` giữ nguyên; original SKILL vẫn yêu cầu `uv run --no-cache` khi workflow chạy. Task 4 không chạy renderer thay cho runtime hay tuyên bố workflow thực đã PASS.
7. Superpowers Claude giữ `.claude-plugin/plugin.json`, `skills`, `hooks` original. API giữ exact official skill/script/support bytes và adapter-policy có toàn bộ officialInventory, skills, scripts có đuôi và executable không đuôi như `sdd-workspace`/`review-package`. BMAD API giữ output installer/config/renderer cùng policy riêng. Policy bind manifest, effect ledger, per-call grants và certified boundary; model/tool execution disabled, isolationCertificate null. Không prompt PM/dev/QC của Crew.
8. Superpowers Codex native `superpowers-codex-native-skills-v1`: giữ full upstream tree byte/mode, `.agents`/marketplace manifest đã có nguyên vẹn; thêm đúng `.agents/skills` và 15 relative links `<name> -> ../../skills/<name>`. Hai owned build roots kiểm actual hash, target và sibling scripts. Native policy nằm ngoài counted tree, được reverify khi resolve. Consumer cố định: P ở sibling ngoài project CWD/ancestors, scratch `.agents/skills -> P/.agents/skills`; không transplant links, không nạp root AGENTS/hook/marketplace từ P. Không YAML/source rewrite/alias router. Runtime bootstrap/namespace/tools/child/isolation vẫn UNVERIFIED; marketplace 6.4.2 thiếu immutable package/metadata vẫn là gate riêng.
9. `operations.ts`, `operation-native.c`: attested private parent/objects; native FD no-follow traversal/quarantine/delete kiểm device/inode/UID/type, regular nlink1, foreign mount/hardlink fail closed; symlink được unlink như entry. Directory nlink chỉ quan sát. Bounded installer executor 90 giây, disk accounting 256 MiB/30.000 entries/depth128, log/file bound64 MiB. Arm kqueue NOTE_FORK/NOTE_EXIT trước gated exec rồi actual waitpid. Protected receipt bind operation ID + device/inode; bất kỳ fork/lost receipt giữ UNKNOWN. Không sửa Task2 ProcessJournal/ResourceRegistry để giả stopped.
10. Pure operations có closure proof khi exclusive writer được reacquire; restart reconcile reserve/create/rename/receipt/quarantine windows. Completed failed stages có byte accounting và reclaim/retry theo identity; unresolved stages tối đa8 trước STAGING_RETRY_LIMIT. Published GC xử lý projection trước source, giữ current source, projection dependency, registry refs và mọi recovered ProcessJournal refs. `retentionInventory` ghi exact pair/bytes/reason/release requirement; accepted005-finalization producer chưa có thì giữ riêng nhóm process references, không khóa cleanup của pure/unreferenced groups. Heartbeat/stopped/ACK không phải terminal release authority.
   FIX2 admission authority: managed `ProcessJournal.reserve` giữ cùng journal transaction mà GC/recovered publication reclaim giữ xuyên snapshot → native quarantine → delete. Registry queue luôn đứng trước journal queue; reserve validator chỉ resolve immutable pair, không lấy registry queue. GC-first làm reserve sau đó reject trước LaunchRecord nếu pair đã mất; reserve-first ghi durable pin admission intent rồi actual LaunchRecord dưới barrier, nên GC phải thấy protected ref. Bind marker/binding bền vững chặn unbound/reopened journal; bind chờ standalone transaction đang chạy. Missing journal attachment từ chối published GC và giữ recovered publication quarantine, nhưng pure-stage reclaim vẫn có closure authority riêng. `pendingPinAdmissions` bảo vệ intent crash chưa commit, dedupe exact committed records và inventory `durable-pin-admission-intent`; không TTL/closed boolean/fake release. Consumer Task5/04 phải dùng bound registry+journal cùng host root; cross-process writers vẫn bị OS guard loại trừ.
11. `resolve` recheck full pins, payload/SRI, manifest/tree và native policy/geometry. HTTP desired/applied/boot/dispatch/companion integration thuộc Task3/5; Task4 không mutate server state hoặc bypass admission.
12. Task6 clone độc lập tại exact HEAD bằng Git trực tiếp, không fork: xuất reachable pack qua stdin commit bất biến và stdout độc quyền, kiểm giới hạn64 MiB/header/trailer, index strict single-thread, update-ref/checkout chỉ trong scratch. HEAD/tree/common-dir/clean checkout và no-alternates/no-hardlink được kiểm trước loại discovery. Giữ product docs; inventory từng đường dẫn `.agents`, `.claude`, `.codex`, `_bmad`, instruction/config bị chuyển ra sibling `excluded`. Git object database vẫn chứa bytes bị loại; policy chặn toàn bộ `.git` và probe đo denial trực tiếp. Owner linked-worktree ngoài read root hiện fail closed; trusted common-dir binding cần composition/review riêng.
13. Private HOME/config/TMP/XDG, frozen source/projection/policy/executable identities; sandbox deny data mặc định, network/fork và securityd, chỉ grant paths hệ thống cần chạy cùng workspace/home/P/stage riêng. Literal `/` phục vụ dyld openat, không grant descendants. Nofork kernel EXIT+wait receipt của `OwnedOperations` là authority; PID/start numeric không có trong API này nên evidence ghi unavailable. Intent command bền vững trước execute; missing receipt giữ workspace/pins và chặn probe sau reopen. Lock order isolation queue → registry read/reference; registry không gọi ngược isolation.
14. No-model probes đọc exact selected SKILL bytes và canaries; absolute, symlink, `..`, Git config/objectdb bị deny, alias/hardlink/config/pin tamper fail trước runtime. Claude CLI plugin list chỉ thấy selected Superpowers, SDK control initialize chưa trả inventory trong bounded run. Codex stdin initialize trả metadata nhưng EOF chưa có skills/list/hooks/list/config/read responses. Lịch sử Unix socket EPERM không chứng minh runtime thiếu hỗ trợ IPC. Native Read/Skill/MCP/child/renderer invoke/full-tree đều UNVERIFIED; overall luôn UNVERIFIED khi các canary sạch, FAIL khi integrity/cross-source lỗi, `productionEnabled:false`. API chỉ inventory artifact; không gọi provider/model.

## Files

| Đường dẫn | Vai trò |
|---|---|
| `gateway/src/workflows/pins.ts`, `fetch.ts`, `stage.ts` | Frozen DTO/URL/hash/download/parser/tree |
| `gateway/src/workflows/registry.ts`, `retention.ts` | Publish/recover/reclaim/GC/reference inventory |
| `gateway/src/workflows/audit.ts`, `api-policy.ts`, `native-projection.ts` | Official artifact audit và policy từng runtime |
| `gateway/src/workflows/builder.ts`, `operations.ts`, `operation-native.c` | Frozen actual installer và native operation authority |
| `gateway/test/workflow-registry.test.ts`, `workflow-fix.test.ts`, `workflow-admission.test.ts` | Matrix/supply chain/cached cancellation/repeated stage failures |
| `gateway/test/workflow-build.test.ts`, `workflow-native-projection.test.ts`, `workflow-operations.test.ts` | Actual builds/policy/native links/lifetime/crash/FD cleanup/GC |
| `gateway/test/support/workflow-archives.ts`, `workflow-crash-worker.ts`, `workflow-admission-crash-worker.ts` | Synthetic matrix và actual crash checkpoints |
| `gateway/test/support/audit-dependency-content.ts`, `audit-dependency-provenance.ts` | Primary npm exact metadata/SRI/file byte audits |
| `gateway/test/support/freeze-dependencies.py`, `freeze-real-projections.ts`, `compare-real-builds.py` | Frozen dependency payload/two-build pins/comparison |
| `gateway/test/support/probe-bmad-build.ts`, `reclaim-proven-build-probes.ts` | Owned actual installer probe và identity-bound receipt cleanup |
| `gateway/test/fixtures/workflows/*` | Exact official archives và original source/Claude golden |
| `gateway/test/fixtures/workflow-builder/*` | Frozen dependencies/lock/provenance/file hashes/real projection golden |
| `gateway/src/isolation/workspace.ts`, `policy.ts`, `inventory.ts`, `preflight.ts` | Bound clean workspace, candidate sandbox và no-model evidence |
| `gateway/test/isolation.test.ts`, `isolation-workspace.test.ts`, `support/isolation-probe.ts`, `support/isolation-typecheck.json` | Actual canary/discovery, durable missing-proof/reopen và strict scoped checker |

## Dữ liệu

Source BMAD npm6.12.0 revision `05bfbd46d00766ec88eb9b42e76be2c575d64d7b`, payload `ac05c93f0b3c4256bb4072e6e1ff181eaad6cc0a64a27a63893bfb2b0b64aed2`, source tree `45227836f9983671126b31255cab949aeb61611a959d1042f7a2ca679f8f9317`. npm gitHead/tag/SRI là provenance riêng; không khẳng định Git archive byte tương đương. [Exact npm metadata](https://registry.npmjs.org/bmad-method/6.12.0).

Superpowers6.4.2 revision `8ca22dba9a94f28898bbce59f2537ff4d87c747d`, payload `29714b2c4c727ecc6600f9e5982a0dcbb829860ba79626f1941a0f233e85331a`, source tree `76972851ae1f527b6e323866cf9562d6f07f0b44af656e7f453224699507ac46`. [Pinned source](https://github.com/obra/superpowers/tree/8ca22dba9a94f28898bbce59f2537ff4d87c747d).

| Artifact | Projection tree SHA-256 |
|---|---|
| BMAD Claude | `3d67e8d6fada5cd20e41922c3cf761ce73e63a61691f1e536579badae1aed54a` |
| BMAD API | `dda623e8b695d2d3d6cff365a9ffa86137b89246e86d434cf1948da2186dbe30` |
| Superpowers Claude | `2cc167b34d987b4c87b8b311434cad0131213d53dbdf5552f4c7d9e3de70d3f4` |
| Superpowers API | `ec4631651e859dc1bf850d2980d0d8a3937d428b3d787e29ffdbe05b4a11720d` |
| Superpowers Codex native | `a07b17957970b190b7071f7585c1454f5cfc110ed004dcd6503a94c40e69a639` |

BMAD Codex còn null/unavailable tới audit recipe riêng; upstream có hỗ trợ tool codex, không phải unsupported. Mọi artifact ở bảng là candidate; mọi runtime certification UNVERIFIED, không enable.

## Flow liên quan

`gateway-host` cung cấp AtomicRecords/ProcessJournal contract đã review; `domain-foundation` giữ source Pin phase02; `server-gateway` duyệt desired/applied/companion. Task5 cần genuine authenticated005-finalization cùng exact pair và actual local stop để tạo producer release references. Task6/Phase04 kiểm nguồn/consumer/native Read/MCP/child/bootstrap/namespace/tool loop. Phase09 đóng gói helper ký sẵn; local operation cleanup không bị đẩy toàn bộ sang Phase09.
## Tests

`pnpm --dir v2/gateway test` build và chạy gateway suite gồm actual two-build BMAD Claude/API, Superpowers API/native, cached cancellation, recovered references, actual crash checkpoints và fork/timeout receipts; FIX2 kiểm GC/reserve tại snapshot/quarantine/delete và SIGKILL/restart admission/committed/quarantine, cùng unbound/bindtransition/writer exclusion. Focused node command phải đặt `--test-name-pattern` trước file. Logs/pins/inventory ở `plans/261002-0002-crew-v2/execution-phase03/task-4-evidence`. Các fixture fork UNKNOWN được inventory và giữ nguyên; tests không fake completion để xóa chúng. Independent supply-chain/native/code review vẫn bắt buộc trước acceptance. No-model tree/discovery checks không chứng nhận actual native runtime hoặc API tool loop.

Task 5 bổ sung `ProcessJournal.activePinReferences()` dưới admission barrier: chỉ receipt retirement fsync
sau authenticated scoped005 finalized exact tuple + actual native STOP mới lọc committed process ref.
Lịch sử LaunchRecord/admission vẫn nguyên; unknown intent, registry ref khác, current source và dependency
projection vẫn bảo vệ bytes. Tests retirement/GC chứng minh independent ref còn giữ projection sau retirement,
chỉ khi ref cuối được release mới GC; identity retired không được reserve/spawn lại. Native TERM observer của
flow gateway-host giữ chứng cứ no-fork, không nới quyền đối với fork hoặc mất witness.

`WorkflowRegistry.verifySource(pin)` chỉ gọi verifier hiện có trên payload, metadata và source tree; không fetch, không đổi current pointer hoặc recipe/hash. Consumer GatewaySync dùng nó để cache bị sửa không thể báo source current khi desired projections đều null; regression có cache lành offline không tải lại.

Task5 FIX1 giữ history sau rebind: bridge dùng `pinRetirement` kiểm receipt bất biến trước scoped005 read;
receipt chưa có hoặc identity xung đột vẫn giữ reference và lỗi riêng record. Boot mới chỉ ghi nhận
UNKNOWN có exact scoped attempt/companion thành `retained-unknown`, không bỏ pin/guard. Existing
admission barrier kiểm snapshot và orphan intent trước lifecycle receipt; observe chạy trước barrier
vì nó ghi journal, callback dưới barrier không gọi registry queue. Snapshot desired cũ không được
hoàn tất nhầm command mới; cache nguồn/projection và pending report giữ nguyên qua deferred pass.

Task6: `isolation:probe -- --runtime claude|codex --no-model` chỉ nhận exact arguments và chạy owned fixture cho runtime đã chọn cùng API audit. Frozen covering set dùng21 gateway test files đã review cộng2 isolation tests; không lấy peer model/attachment candidate. Evidence `execution-phase03/task6-evidence` giữ RED→GREEN policy/Git attempts, stdin hashes, exact argv/policy/exit/receipt, sanitized matrix và resource identities. Durable reserved-intent negative fixture được giữ vì thiếu closure proof; không xóa history hoặc chế STOP để cleanup. BMAD runtime discovery/invoke, common/system skill inventory và linked owner source chưa được chứng nhận; Phase04 phải đo selected/unselected load+invoke trước enable.
