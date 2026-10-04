# Phase03 Task4 — FIX WAVE1/5, candidate khôi phục

Trạng thái: DONE_WITH_CONCERNS, final candidate sẵn sàng cho PM serialize và independent scoped re-review. Original review candidate `4cbf581ec581040df6ca87950cf139e9bc490cd6`; recovery dispatch HEAD `e94f2e1`, verification HEAD `07ccdc4e3db16af0389cad1691833ac74e77d7ff` có peer changes được giữ nguyên. Infrastructure usage-limit interruption không tăng/reset semantic fix counter; đây vẫn FIX1/5.

Báo cáo này thay trạng thái candidate cũ: các actual artifacts được bổ sung trong wave này; report/review/evidence gốc vẫn xác định historical snapshot. Không stage/commit, không sửa shared manifest/generated index/package/dependency declarations, app/server hoặc Task2 native journal/resources. Không subagent, model/live call, global install, credential hoặc service owner.

## Findings và kết quả

| Finding gốc | Sửa và chứng cứ |
|---|---|
| P1 actual BMAD Claude installer/API artifact | Exact package-local official installer chạy thật trong owned stage, frozen dependencies/environment/native lifetime authority, two-build canonical pins; BMAD Claude/API và Superpowers API artifacts thật. Fresh covering xác nhận bốn BMAD executions exit0/no fork/exact-ID+inode receipts, renderer byte giữ nguyên và API official policy. |
| P2 stage/retry/GC | Native FD identity/quarantine/no-follow delete, durable closure hoặc genuine executor receipt, restart reserve/create/rename/quarantine/receipt recovery, byte accounting, cap8 unresolved stages, cleanup/retry và published GC giữ current/dependencies/recovered refs. |
| P2 cached cancellation A sau current B | Abort trước operation và ngay trước activation/cached return; actual A/B regression và abort-during-verification đều PASS, current B không rewind. |
| Gap API extensionless script khi khôi phục | `scripts` trước chỉ nhận suffix; meaningful RED bắt thiếu official `sdd-workspace`/`review-package`. Thêm executable entries từ audited manifest, refresh riêng Superpowers API expected pin; focused GREEN và final covering PASS. Không source rewrite/alias/router/role prompt. |

Native Superpowers Codex recipe contract đã được reviewer độc lập READY tại `superpowers-codex-native-recipe-review.md` và approved03 addendum. Artifact candidate mới được build/kiểm trong scope đó; implementation vẫn cần code/native/spec re-review, runtime UNVERIFIED.

## Files và interfaces

Production `v2/gateway/src/workflows/{pins,fetch,stage,registry,audit,api-policy,builder,operations,retention,native-projection}.ts`, `operation-native.c`. Frozen core SourcePin/ProjectionPin/hash formulas/005/007 contracts không đổi. Registry methods cũ giữ nguyên; thêm `reclaim`, `collectPublished`, `retentionInventory`, durable operation records. `RegistryOptions` là trusted application audit input, không endpoint nhận arbitrary builder/owner path.

Tests: `workflow-registry.test.ts`, `workflow-fix.test.ts`, `workflow-build.test.ts`, `workflow-native-projection.test.ts`, `workflow-operations.test.ts`. Support: `workflow-archives.ts`, `workflow-crash-worker.ts`, `audit-dependency-content.ts`, `audit-dependency-provenance.ts`, `freeze-dependencies.py`, `freeze-real-projections.ts`, `compare-real-builds.py`, `probe-bmad-build.ts`, **`reclaim-proven-build-probes.ts`**. Recovery sửa helper receipt ABI sang protected `receipts/<operationId>.json` và kiểm ID/device/inode; historical legacy cleanup evidence không bị viết lại. Biome null-body warnings được sửa ở audit helpers.

Fixtures: original `workflows/{bmad-6.12.0.tgz,superpowers-6.4.2.tgz,official-audits.json}`; `workflow-builder/{dependencies.tgz,dependencies.json,package.json,pnpm-lock.yaml,provenance.json,verified-content.json,independent-builds.json,real-projections.json}`. R3 flow `v2/docs/flows/gateway-workflows.md` đã cập nhật actual behavior/limits và đủ helper/fixture paths. PM map manifest/generate/index/checks serially; worker không sửa shared mapping.

`task-4-evidence/fix-candidate-inventory.json` freeze từng owned file gồm bytes/mode/SHA-256; `fix-evidence-inventory.json` freeze logs/receipts/accounting/provenance. Inventory chứa cả frozen dependencies, manifests và mọi helper, không chỉ tracked diff. Package fixture/lock dưới workflow-builder là frozen builder input, không thay package gateway hoặc shared lock.

## Exact source provenance giữ nguyên

| Nguồn | Source revision | Payload SHA-256 | Source manifest SHA-256 | Source tree SHA-256 |
|---|---|---|---|---|
| BMAD npm6.12.0,842394B/499entries | `05bfbd46d00766ec88eb9b42e76be2c575d64d7b` | `ac05c93f0b3c4256bb4072e6e1ff181eaad6cc0a64a27a63893bfb2b0b64aed2` | `bf966209b9abf05b2585a1225f6c176d1aaa9f0262248282adc5bad6b78bef68` | `45227836f9983671126b31255cab949aeb61611a959d1042f7a2ca679f8f9317` |
| Superpowers Git6.4.2,641346B/296entries | `8ca22dba9a94f28898bbce59f2537ff4d87c747d` | `29714b2c4c727ecc6600f9e5982a0dcbb829860ba79626f1941a0f233e85331a` | `e5cf239cc4fd5757338fb435de881d6246948cd1d902fa21b4498a63d5a10dc2` | `76972851ae1f527b6e323866cf9562d6f07f0b44af656e7f453224699507ac46` |

BMAD SRI `sha512-gbbHo32TxCPwo4Yy70kqykFRwN5UdYqfnDKTsKAsF9m5qtLeoiCgEawj/LuzLBHLrYA0WTOyL/XWtXpgyDonMQ==`. npm gitHead/tag relationship và npm archive bytes vẫn là provenance khác nhau; không claim npm byte tương đương Git. Golden hashes đã được independent Python kiểm trong candidate gốc, unchanged source retained evidence; không tải/rerun lại phần đã kiểm chỉ để phục hồi usage-limit.

## Actual BMAD build và frozen supply chain

Exact official invocation: package-local Node `tools/installer/bmad-cli.js install --directory <owned-project> --yes --modules bmm --tools claude-code --no-shims --set core.user_name=Crew --set core.communication_language=Vietnamese --set core.document_output_language=Vietnamese`. Upstream bytes không patch, không npx/latest. Fixed `claude-code` installer là BMAD Claude recipe; API inventory lấy official installed skill/config/script tree cùng adapter policy riêng, không giả BMAD Codex recipe.

Frozen input có 13 direct exact packages; 99 direct+transitive packages đã primary npm exact-version metadata/tarball SRI verification và **1889 upstream regular file bytes** được đối chiếu. `provenance.json`/`verified-content.json` là evidence của acquisition đã hoàn thành; wave recovery không lặp network audit. Lifecycle scripts không chạy lúc freeze acquisition. Dependency archive SHA256 `ff6e59d25dd89eeaaffe323fbb377cb8546fd70e8b30ceadbdfea3b8cab92e8d`; fixture lock `ccc762cfa971fff173b6c877ef4fd78e9e30bf9088b381b6f4b33c8ea7ef2ab0`; fixture package `5c80b23975e50279019cd6adba298e53e10934556c1f733583d2f83879e871e3`. Exact versions/SRIs toàn bộ trong fixture lock và provenance, executable allowlist21 entries trong dependencies.json.

Node `v24.14.0`, binary SHA256 `20a18709f0154d668f1bd6f6ea8c2a7ae001447b4b2c339732f22e57a8767a55`; actual uv0.11.3 SHA256 `4424f8430c3cb3990daaa68268af640bdc61190f2e5c276197e3473358b1e4e8`. Runtime path là audited host input, binary bytes/version được rechecked trước builder execution; missing/tampered dependencies/uv/policy không publish. Không install/upgrade global tool. UV đã có; không báo thiếu UV.

Child có owned HOME/TMP/XDG, PATH cố định và không inherited credentials/proxy/module env. Sandbox deny process-fork/network, writes chỉ stage, user/cache/temp bên ngoài bị deny; official update/latest check không được spawn/network. Native executor arm kqueue FORK/EXIT trước gated exec, actual waitpid exact child; deadline90s, stage accounting256MiB, entry/depth bounds30000/128, output-file bound64MiB. Any fork/lost receipt = UNKNOWN, không PID/groupempty-only proof.

Normalize riêng operational dates trong manifest.yaml/core config.yaml/bmm config.yaml về epoch, cập nhật exact corresponding rows trong files-manifest.csv bằng SHA256 mới. Skill/config/script/renderer còn lại giữ byte. Timestamp nội dung khác filesystem mtime: policy normalize được bind vào derivation policy, không bỏ qua tất cả timestamp tùy tiện. Hai independent original build roots có canonical pre-policy manifest `7502ca9770a26196464d594834265ff40c8fb4800cee2c175a2fbcd49c4c805d`,328entries trong independent-builds.json. Fresh final suite chạy lại hai executions cho mỗi BMAD Claude/API, so actual output và expected pin; toàn bộ four build stages có real current protected receipt và deleted/bytes0. Actual IDs/inodes/receipts được trích `recovery-verified-builds.json` từ final log.

Renderer `_bmad/scripts/render_skill.py` byte bằng original `src/scripts/render_skill.py`; original bmad-build SKILL giữ yêu cầu `uv run --no-cache ...` khi workflow chạy. Installer artifact test không chạy renderer/workflow/model và không cấp renderer/tool runtime certificate. Phase04 tiếp nhận certified execution boundary/interpreter/runtime input policy.

## Runtime artifact pins

| Candidate | Manifest SHA-256 | Projection tree SHA-256 | Policy SHA-256 |
|---|---|---|---|
| BMAD Claude | `cc532075e2a4af3f189b359188b534a71cdb2f38912333135b8530d0fc1d1567` | `3d67e8d6fada5cd20e41922c3cf761ce73e63a61691f1e536579badae1aed54a` | `a0ac56ece4b964da4e5481cd16f75dfb74d05425ef0b5c33bfb176e82926bd26` |
| BMAD API | `033f75b208c17b60bd84c5c761660267d3a458312052624a4a95fa0536d619f7` | `dda623e8b695d2d3d6cff365a9ffa86137b89246e86d434cf1948da2186dbe30` | `98bf91438c455d526fb6fc2cecedb351930ea4325389a433fb4081ca432de623` |
| Superpowers Claude unchanged | `b87eaf7d6404ed4fd92650e98d3f20a3060a18de6a3192781de4f1f2871b0347` | `2cc167b34d987b4c87b8b311434cad0131213d53dbdf5552f4c7d9e3de70d3f4` | `552a23187fa99ddefb9a4c82fccf2b653e5e9e8f13bfd0a9eecf6913cf8eb4aa` |
| Superpowers API final | `8c76b92343e5afb5f18a1ab8c267da2754b9c369d2a26634fecbe20da84f0c5b` | `ec4631651e859dc1bf850d2980d0d8a3937d428b3d787e29ffdbe05b4a11720d` | `23e33930a7e86e9d317b6e59dd3976024a98e24aefc7baefcb2be8970ca693ca` |
| Superpowers Codex native | `f01a3cbde8fd3998e616dad4eba8b0fce6836229ddc905cfb6ed6908908e9a51` | `a07b17957970b190b7071f7585c1454f5cfc110ed004dcd6503a94c40e69a639` | `2fcc58b1687cc9b8b7c47ad6215249138cd70734fb063089ea8683f531b20558` |

API contains exact officialInventory/skills/scripts hashes, original support/config/renderer, transport per-call grants/effect ledger and no Crew role prompts. Extensionless executable scripts included after new RED→GREEN; each officialInventory file checked against disk bytes. Policy modelRequestsEnabled=false, toolExecutionEnabled=false, isolationCertificate=null; manifest grants no runtime certification.

Native artifact keeps all296 upstream entries byte/mode identical and adds exactly16 entries: missing `.agents/skills` plus15 relative links `../../skills/<name>`, no duplicate existing `.agents`. Actual two distinct owned build identities, all15 canonical targets, SKILL bytes, sibling sdd-workspace/review-package/code-reviewer resource paths and fixed scratch directory symlink were verified. Native policy stored outside counted tree and rechecked at resolve; root AGENTS tamper rejects. P remains outside CWD/ancestor; P root AGENTS/marketplace/harness/hooks are provenance bytes, inactive in consumer policy. No YAML/metadata/frontmatter/name changes or namespaced alias router. Marketplace6.4.2 immutable-package/15th metadata gate unchanged and independent. Native candidate is Crew-audited projection of official source, not upstream-recommended native installer/package equivalent.

BMAD Codex remains null pending own audited recipe; upstream supports codex/.agents/skills. All actual runtime availability/certification, bootstrap-before-work, namespaced transitions, native Read/Bash/MCP/child/SDD/compaction and API tool loop remain **UNVERIFIED/disabled**.

## Durable lifetime, reclamation và references

Stage durable reservation before exclusive create; .operation-owner marker binds ID/device/inode. Parent/root layout attested with private UID/dev/inode; no-follow FD native operations refuse parent swaps/foreign devices/hardlink aliases and unlink symlinks themselves. Directory child-count nlink may vary; regular files require nlink1. Pure builder closure after reacquired exclusive writer does not require fake process receipt. Subprocess requires actual protected receipt whose operation ID/device/inode match object, treeEmpty true and forkObserved false.

Restart recovers absent reservation, pre-attestation create by marker, renamed publish intent without current activation, quarantined object and detached executor receipt. Malformed installs reclaim exact completed stages automatically before retry or explicit `reclaim`; residual unresolved stage cap8 prevents unlimited new stage growth. Inventory counts actual stage bytes, unknown bytes remain null rather than fabricated zero; successful deletion bytes0/durable state. Published GC handles projections before sources; current source, projection-source dependencies, retained registry pairs and recovered ProcessJournal pairs are protected. Recovered quarantine rechecks refs before finishing delete. Unreferenced/released projection has actual deletion path with retry, leaving current source.

Process references remain specifically `accepted-finalization-producer-unavailable`: retentionInventory reports run/launch/process/authorization/source/projection, exact measured source/projection bytes and requires genuine authenticated005-finalization of same attempt/fence/process/pair + actual local stop + no refs. No caller closed boolean, heartbeat/ACK/stopped shortcut or fake accepted005FINALIZED receipt. This group does not block pure/unreferenced cleanup. Task5 must add reviewed genuine release producer; existing ProcessJournal format/authority unchanged.

## Verification và cleanup

Final production change: api-policy includes audited executable scripts lacking suffix. Existing already verified code was recovered, not blindly rebuilt. Prior failed build-focused log is historical (old policy injection mismatch); current Superpowers API passes and no new failure is hidden.

- Meaningful extensionless-script RED: `recovery-api-script-red.log`, missing official script assertion. GREEN focused1/1: `recovery-api-script-green.log`.
- **Final covering after last production change:** `pnpm --dir v2/gateway test` → build plus **68/68 PASS**, fail/skip/cancel0,74056.019209ms; `recovery-gateway-policy-final.log`. Prior recovery covering68/68 is retained historical evidence, followed by justified new policy regression/fix and final covering.
- Doc closeout trong FIX1: exact heading order `Mục đích`, `Điểm vào`, `Các bước`, `Files`, `Dữ liệu`, `Flow liên quan`, `Tests` được kiểm trên flow thực; giữ nguyên mọi section body/limits, không source/test/index mutation và không broad rerun. PM re-stage doc và rerun canonical docs gate trước commit.
- `pnpm --dir v2/gateway typecheck` → exit0; `recovery-typecheck.log`.
- Biome owned TS sources/tests/support → exit0,22files/no fixes/no warnings; `recovery-biome.log`.
- `/usr/bin/clang -Wall -Wextra -Werror -fsyntax-only .../operation-native.c` → exit0; `recovery-native-werror.log`. Native source unchanged during recovery; actual suite also compiles/runs helper.
- `git diff --check --` owned tracked source/test/flow → exit0; new untracked TS parsed/typechecked/Biome. Python helpers syntax parse verified without executing acquisition/network/freeze side effects.
- Focused original7/7 operations/cancellation/crash/GC and native2/2 logs retained; final covering runs all again as part required suite. No server/desktop/domain broad suites repeated.

Final test owns/tears down BMAD supervised four stages, native two build stages and ordinary temporary roots through fixture finally; exact closure/receipt/accounting checked before rm. Fork UNKNOWN roots intentionally remain from original focused + recovery pre-policy + final covering. All three exact roots/dev/inode/UID/bytes/reasons are in `recovery-owned-scratch-inventory.json`, no broad prefix scan or forced deletion. Latest root ends `crew-task4-lifetime-pAy3zv`,48541B; other two47888B/48541B.

Historical six actual probe stages were reclaimed before interruption; `probe-cleanup.json` records each exact root, receipt and bytes0 (total123929365B reclaimed). Their remaining six evidence/native-cache roots are inventoried (~0.7MiB) and retained, no fabricated authority for deleting unrelated parent contents. Frozen dependency acquisition root `crew-task4-dependencies-gm01zv4k` remains55582679B: historical `parentStopped:true` is not native process-tree proof, so recovery does not promote it into stop authority. No owner paths/services/config/credential caches cleaned.

## PM handoff / unresolved questions

1. Map all frozen inventory paths into v2 flow manifest, generate/check nested+root staged docs serially, then commit candidate; worker has not changed index. Freeze inventory is the full source/test/helper/fixture review surface.
2. Independent scoped FIX1 re-review must cover all originalP1/P2, new native C/FD/receipt/sandbox/build-policy/API extensionless script manifest and native artifact mapping. No Task4 acceptance claim before reviewer evidence.
3. Genuine accepted005FINALIZED same-attempt/pair release producer is still absent; keep exact ProcessJournal referenced group/bytes/reason, unrelated completed cleanup is implemented.
4. Runtime certification/namespace/bootstrap/interpreter/tool/child/native source isolation and BMAD Codex own recipe remain gated. Native marketplace gate independent. No enable/model/live authority implied.
5. Acquisition root/fork UNKNOWN/evidence-cache parent remnants are explicitly retained with byte inventory; do not replace missing full-tree proof with historical boolean or force recursive cleanup.

## Candidate tiếp nối — FIX2/5 GC/admission

FIX1 artifact/cancellation đã qua scoped re-review ADDRESSED; newP1 concurrent ProcessJournal.reserve/GC được sửa trong FIX2 theo `task-4-fix2-brief.md`, không semantic reset. Báo cáo current candidate: `task-4-fix2-report.md`; inventory41 files và final77/77 tại `task-4-evidence/fix2-*`. Narrow additive ProcessJournal binding/intent/barrier, registry GC/recovered quarantine cùng journal queue, old LaunchRecord/version/native/005007/artifact hashes unchanged. GC-first deny trước launch, reserve-first và crash intent bảo vệ exact resolvable pair; không caller ordering promise. PM chưa nghiệm thu trước independent scoped FIX2 review; Task5 terminal release và mọi runtime certificate vẫn gated.
