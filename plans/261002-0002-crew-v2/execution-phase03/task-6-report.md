# Task 6 — candidate isolation preflight, chưa có runtime certificate

Implementation trong phạm vi Phase03 đã chuẩn bị cho independent SPEC/QUALITY/security review. Không enable runtime: kết quả sạch là `UNVERIFIED`, mọi adapter có `productionEnabled:false`. Controller quyết định acceptance sau commit/review; báo cáo này không thay chứng nhận Phase04.

## Scope và authority

Own bốn module `gateway/src/isolation/{workspace,policy,inventory,preflight}.ts`, hai isolation tests, support probe/checker và gateway-workflows R3. PM thêm duy nhất package script `isolation:probe` và gateway-host R3; ruling18:18 mở đúng `retirement-crash.test.ts` để sửa guard race trong test. Danh sách12 file/mode/bytes/SHA ở `task6-evidence/frozen-inventory.json`. Không đổi native helper, OwnedOperations, registry/journal producer, LaunchRecord/proof, Launcher, model, SQL, dependencies hoặc lockfile. Không chạy turn/model/provider, owner auth/Keychain, user config mutation, shared DB/restart/install, Git owner mutation hoặc subagent.

Rulings binding nằm trong `plans/reports/pm-261002-crew-v2-execution.md`:16:55 trusted bound factory/read-only Git/own scratch;17:26 nofork clone-equivalent; fixed stdout redirect và64 MiB native cap;17:48 bounded discovery stdin. PM chấp thuận literal `/` cho dyld và giữ linked owner common-dir ngoài boundary là UNVERIFIED, không mở guessed parent root. Controller serialize docs/manifest/package/commit.

## Kết quả implementation

- Factory bind `WorkflowRegistry` thật với private root, freeze runtime executable targets. Named module functions chưa bind từ chối `ISOLATION_NOT_BOUND`; caller không cung cấp proof hoặc arbitrary projection path.
- Prepare giữ exact source/projection reference trước workspace creation. Git trực tiếp từ CommandLineTools, HOME/config/hooks/template riêng, no network/fork. Xuất reachable graph của exact commit qua immutable commit-input và exclusive stdout pack; header/version/trailer/hash/size được kiểm trước strict single-thread index. Scratch HEAD/tree/common-dir/clean checkout phải khớp; no alternates/hardlinks/nested Git escape. Không sao chép owner config/hooks/refs/index.
- Product docs giữ nguyên. Mỗi discovery exclusion được inventory/hash và chuyển sang sibling riêng. Codex chỉ dùng native geometry đã review `.agents/skills -> P/.agents/skills`; projection P ở ngoài CWD. Git objectdb vẫn có excluded bytes nên policy deny toàn bộ `.git`, probe đọc pack thật phải bị từ chối.
- Mỗi command ghi durable reserved/pending intent trước execute, exact argv/executable SHA/policy SHA/stage identity và protected kernel nofork EXIT+wait receipt. Giới hạn native file64 MiB, wall10s; inventory output2 MiB, file hashing32 MiB. Thiếu receipt/fork giữ UNKNOWN, pins và workspace; reopen không chạy probe mới. Cleanup chỉ nhận genuine receipt. Numeric PID/start không nằm trong reviewed API, evidence ghi unavailable; operation ID + stage tuple là binding thực.
- Candidate sandbox deny file data mặc định, fork/network/securityd, chỉ allow workspace/home/P/stage và system runtime paths. Literal `/` không grant descendants. HOME/CLAUDE_CONFIG_DIR/CODEX_HOME/TMPDIR/CLAUDE_CODE_TMPDIR/XDG đều thuộc scratch. Private baseline config hashes reverify trước/sau. Lock order isolation transaction → registry reads/references; không callback ngược vào isolation.
- Preflight reverify source/projection bytes, exact workspace inventory, own Git inventory, home aliases/config. Canary kiểm selected SKILL bytes và own readable file, rồi absolute/`..`/symlink/Git config/Git pack denied. Cross-source alias/hardlink/config/pin/bytes tamper fail trước runtime. API chỉ audit official artifact inventory và policy từ registry, không model call. Router source null và disabled.

## Actual no-model matrix và giới hạn

Raw evidence giữ exact argv/policy/paths/receipts; sanitized matrix tách `$WORKSPACE`, `$ATTEMPT_HOME`, `$PROJECTION`. Các PASS dưới đây là từng phép đo, không phải overall certificate.

| Surface | Đã đo | Kết quả và giới hạn |
|---|---|---|
| Independent clean clone | Actual ordinary Git, exact commit/tree, product docs/exclusions, private common-dir | PASS trên owned normal repo; owner linked-worktree có common-dir ngoài read root fail closed/UNVERIFIED. Trusted exact binding thuộc composition03/7 và review riêng. |
| Selected filesystem read | Exact official Superpowers SKILL hash, own canary | PASS; chưa Skill invocation hoặc renderer invocation. |
| Other origin / Git objects | Absolute/`..`/symlink/config/actual pack read; preflight hardlink/alias tamper | Kernel denial hoặc FAIL trước execute, không chỉ prompt assertion. |
| Claude2.1.284 | Version, strict empty MCP/settings, selected plugin CLI list | CLI chỉ thấy selected Superpowers6.4.2 tại verified P. Không chứng minh loaded hooks/Skill/MCP/child. |
| Claude SDK initialize | Fixed immutable stdin chứa control initialize duy nhất | Timeout exit137 trong10s, empty inventory, genuine nofork receipt. UNVERIFIED, không gửi prompt. |
| Codex0.159.3 | Stdio app-server initialize + initialized + skills/list + hooks/list + config/read | Initialize trả metadata/remote-control disabled; EOF trước replies skills/hooks/config. UNVERIFIED, không thread/turn/auth/provider request. |
| Codex Unix lịch sử | Exact owned socket attempts dưới sandbox | Exit134 trước dyld correction; sau correction exit1 với `Error: Operation not permitted (os error 1)`. Chưa có syscall-specific denial trace nên nguyên nhân IPC/policy chưa được chứng minh. Không kết luận Codex inherently unsupported. Final production không có Unix grant/socket transport. |
| API | Actual verified Superpowers adapter projection inventory | PASS artifact audit; actual model/tool loop UNVERIFIED. |
| Native Read/Skill/MCP/child/fulltree/renderer invoke | Không thể chứng nhận trong no-model spike | Tất cả UNVERIFIED; descendant policy requirement được ghi, không dùng shell receipt làm chứng nhận toàn runtime. |
| BMAD runtime / common-system skills | Không đo actual load/invoke inventory trong Task6 | UNVERIFIED. Baseline actual installer/build tests không thay runtime evidence. Không gán BMAD Codex unavailable thành unsupported. |

Exact binary identities nằm trong command evidence: Codex SHA `4d210f7c5a18fd0386434df23b5bdbb8c0e7257d3e8a2b30b0769c8bbe99a878`, Claude SHA `50a14c2f50f56668380fdda490167f1d3630d5cc18fb8aed3073c2c7ea7314fe`. OS/kernel/architecture và source/projection/derivation pins được ghi trong mỗi result.

## RED → GREEN và chẩn đoán giữ nguyên

`red.log`/`preflight-factory-red.log` ghi missing implementation trước GREEN. Strict sandbox ban đầu làm dyld abort134 kể cả owned cat; `/System/Library/Sandbox/Profiles/dyld-support.sb` lines53–59 giải thích libignition mở literal `/` làm openat root. File SHA/relevant lines ở `dyld-source.json`. Thêm đúng literal root cho owned cat RED→GREEN; không import system profile hay allow subpath `/`.

`/usr/bin/git` là shim cần xcrun shared temporary access và thất bại71; dùng exact CLT Git. Ordinary clone bị denied fork128; không nới fork. Pack output-prefix thử ghi temporary pack vào owner objectdb bị denied128; đổi fixed exec-only stdout redirect theo PM. Lần thử ulimit131072 sai đơn vị/hard cap bị từ chối; shell dùng1024-byte units, sửa soft65536 khớp native hard/soft64 MiB. Không owner mutation thành công. Logs giữ mọi attempt và receipt.

Six focused tests PASS trước final freeze; actual negative regressions gồm hardlink/symlink/home alias, private config, own Git config, wrong pin, selected bytes, changed product bytes, missing runtime và durable reserved-intent/reopen. Negative intent không tạo process và không bịa STOP: cleanup vẫn retained, registry ref còn, không command mới. Native receipt authority không đổi.

## Validation frozen

Snapshot readonly `9182e89:v2` +13 exact accepted `7c7c719` file overlays +9 own Task6 source/test/support/R3 files. Archive member type/path được kiểm; source hashes trước/sau, nonce/device/inode/UID và commands/exits được lưu. Chỉ resolve bare external `tar-stream` qua ordinary gateway dependencies bằng approved exact loader, TS paths duy nhất đến existing `@types/tar-stream`; không wildcard/skipLibCheck/install/copy dependency/hook/config mutation. Strict và library checking giữ nguyên.

Frozen build và full strict types PASS. Scoped Biome kiểm9 source/test/support/package files PASS, không warning/error; initial formatting diagnostics đã sửa và giữ log. Cover cuối explicit21 gateway tests đã review +2 own isolation tests, private PostgreSQL migration prefix8; không peer model/attachment candidate hoặc009+. Exact command/manifest/count/exit nằm trong `cover-final-command.json`, `cover-manifest.json`, `verification-exits.json`, `cover-final.log`.

Lần cover frozen đầu:126/127 PASS,264,97s; toàn bộ Task6 PASS. Baseline `retirement-crash.test.ts` checkpoint after-write lỗi `Host guard unavailable (75)` khi mở ngay sau SIGKILL worker. Rerun đúng3 tests trên cùng snapshot:2/3 PASS, after-filter gặp cùng lỗi. Worker exit không đồng nghĩa separate lockf/Node guard holder đã nhận EOF và nhả lock. Đã báo PM trước mọi sửa ngoài ownership; không đổi ProcessLock/native hay dùng dead PID làm STOP. PM18:18 duyệt test-only repair: trước mở workflowFixture, bounded retry actual AtomicRecords acquisition cho exact `process-journal` và `workflows`, deadline1500ms/backoff10→100ms, chỉ exact lỗi75. Mỗi successful kernel guard acquisition được release/await thật; mọi lỗi khác propagate. Không retry whole fixture để tránh journal mở dở nếu registry còn lock. Installed lockf manual xác định EX_TEMPFAIL khi locked; installed SDK sysexits.h định nghĩa75. Sau đúng một test overlay vào snapshot, full strict types PASS và toàn bộ3-case file PASS3/3 một lần trong7,79s. Biome test PASS. Original broad126/127 và narrow2/3 failures giữ nguyên; theo PM không rerun127 cho test-only repair, không ghi all127 PASS.

PM package script và gateway-host R3 được thêm sau snapshot bắt đầu; chỉ script/docs, không dependencies. Chúng nằm trong final12-file inventory và review. Snapshot cover dùng package baseline; actual package CLI commands được kiểm riêng. Không lặp broad cover cho thay đổi script/docs.

Hai exact `pnpm --dir v2/gateway isolation:probe -- --runtime codex|claude --no-model` đều exit0 (15,22s/26,84s). `matrix-sanitized.json` có7 actual runtime/API results từ cover và hai probes, tất cả overall UNVERIFIED. Snapshot source trước/sau không đổi; chỉ thêm hai compiler fixture configs đã inventory.

## Resources và handoff

`resources-final.json` đối chiếu exact roots từ creation nonce/dev/ino/UID và genuine native receipts; không prefix/global cleanup. Durable missing-receipt fixtures giữ nguyên cùng pin/history. Baseline fork UNKNOWN của accepted gateway tests vẫn giữ theo producer authority; PID absence/group empty không được nâng thành STOP. Private DB/container và frozen snapshot có reconciliation riêng. Frozen snapshot đã identity-check, kiểm source delta duy nhất approved test repair và xóa sau mọi runner hoàn tất; `snapshot-cleanup.json` ghi exact identity/bytes. Không đụng tài nguyên của lượt Task5 hoặc peer trước đó.

Reconciliation Task6 đầu:15 roots được xóa sau genuine receipts;4 durable reserved-intent negative roots giữ24.217.120 bytes. Bốn historical Unix diagnostic scripts đã `Object.assign` stage identity lên field root identity, làm mất durable original root tuple. Child stages đã có genuine receipt và xóa, nhưng outer roots giữ nguyên vì thiếu creation identity; không suy authority từ current stat, byte accounting phần này unknown. Đây là lỗi evidence của diagnostic fixture, được giữ nguyên script/log cho review, không sửa lịch sử để che. Baseline cover/rerun có50 root identities:39 absent,11 retained (gồm9 UNKNOWN và2 guard-race failure roots), cùng1 baseline genuine-fork fixture retained. Container `271a1c7a430e4959a3128b5c0906c5eebeaf255381e189f381956ce3c82df168` đã absent.

Current resource reconciliation có15 absent,4 reserved-intent UNKNOWN và4 historical identity gaps. First per-root receipt table bị overwrite khi chạy reconciliation lần hai; script kiểm receipt trước15 deletions, stdout/count và raw native command logs vẫn còn, nhưng original full cleanup receipt table không còn. `resource-reconciliation-history.json` ghi rõ giới hạn evidence này.

Nguồn/report/evidence đã freeze chờ controller commit và independent full scoped review. Phase04 phải giải quyết đầy đủ selected/unselected native load+invoke, native Read/Skill/Bash/MCP/child inheritance, hooks/system skill inventory và full-tree boundary trước bật dispatch. Task6 không cung cấp certificate để lách các gate đó.

## Task6 FIX1/5 — F1/P2 HOME Git metadata exemption

Independent review `task-6-review.md` của candidate `f6ca0a4` có đúng1 P2: root `.git` bị bỏ qua trong shared audit, kể cả HOME được policy grant đọc. FIX1 chỉ sửa `inventory.ts`, ba execution-workspace callers trong `workspace.ts`, `isolation-workspace.test.ts` và gateway-workflows R3; không sửa policy, shared/native/registry/journal/package/model/proof hoặc SQL. Original report bytes giữ trong `task6-fix1-evidence/base-task-6-report.md`, hash khớp original evidence inventory; lịch sử phía trên không bị rewrite.

`auditWorkspace` mặc định từ chối `.git` ở root hoặc nested metadata. Optional separately-audited Git path phải đúng `join(root, '.git')`; chỉ execution workspace truyền path này và vẫn có full Git inventory riêng trước publish/verify. HOME và audit Git metadata không truyền exemption. Không thêm read grant hoặc nhận authority từ caller của preflight.

Actual RED trên frozen `f6ca0a4` cộng chỉ regression test: foreign canary hardlink ở `HOME/.git/foreign-skill` trả UNVERIFIED và chạy7 commands, trong khi expected FAIL/0 commands. Normal project-owned source editing và fixture execution không bị hook chặn; không đổi ignore/config hoặc encoding/đường vòng cho `.git`. Lệnh shell append Markdown report sau validation bị PreToolUse chặn trước chạy vì chuỗi `.git` trong prose; PM xác nhận dùng normal `apply_patch` cho đúng report sở hữu. Denial text được giữ riêng, không thay hook/settings hoặc đọc metadata thật để né chặn.

Actual GREEN: HOME hardlink, HOME `.git` symlink và `HOME/cache/.git` nested symlink đều FAIL/CROSS_WORKFLOW_SOURCE, commands0; các entry fixture được unlink/rmdir sau so device/inode/UID. Nested `.git` ngay trong Git metadata bị GIT_METADATA_CHANGED; sửa pack bytes cũng bị reject trước command. Khôi phục exact bytes cho phép legitimate workspace preflight UNVERIFIED, shell Git objectdb denial PASS. Source/projection hash/tamper, default unbound deny và durable missing-receipt/reopen retention vẫn chạy trong affected suite.

Validation riêng FIX1:2 explicit isolation test files,6/6 PASS,12,97s; strict scoped types exit0; Biome3 changed TS files exit0, không warnings/errors. Snapshot lấy readonly `f6ca0a4:v2` cùng own4-file overlay, không lấy live peer code/package. Approved exact external tar-stream loader và declaration path giữ nguyên, strict/library checking không tắt. `CREW_ISOLATION_SKIP_DISCOVERY=1` chỉ trong test runner để không lặp Claude/Codex init/discovery/API probes; default probe behavior khi flag không đặt giữ nguyên. Không có paid/model/provider request hoặc private DB/container mới. Không chạy lại127-cover, không cộng các lượt thành union PASS: lịch sử broad126/127, pre-repair narrow2/3, guard repair3/3 và7 overall UNVERIFIED phía trên không đổi.

Evidence FIX1 nằm trong `task6-fix1-evidence`: `red-home-metadata.log`, `isolation-green.log`, `verification-final.json`, `biome-final.log`, `frozen-source-inventory.json`. Cleanup dùng one-shot immutable/fsynced `cleanup-plan.json` trước deletion, giữ toàn bộ command/stage identities và protected receipts; `cleanup-result.json` ghi kết quả riêng, không overwrite bảng proof. RED root `/private/tmp/crew6-w-zwmZbY` (nonce eae02eb3-3fa9-4811-96ca-ff63ab778bbe, dev16777229/ino64051971/UID501) đã xóa sau closure. GREEN root `/private/tmp/crew6-w-LfkGix` (nonce9088d6ca-984b-45fc-acbc-e527735630a9, dev16777229/ino64056156/UID501) giữ5.033.559 bytes vì deliberate durable reserved-intent thiếu receipt; pin/history còn nguyên. Không dùng thời gian/PID absence/group empty để xóa. Original UNKNOWN và4 historical identity gaps không bị đụng. Snapshot7.834.955 bytes đã kiểm exact identity/hash stability rồi xóa sau mọi runner hoàn tất; không có runner còn chạy.

FIX1 frozen chờ controller commit và independent full scoped re-review. Overall runtime vẫn UNVERIFIED/disabled; không thay Phase04 invocation gates.
