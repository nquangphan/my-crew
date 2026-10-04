# Re-review độc lập Phase03 Task4 — FIX1/5

**Spec READY: NO. Quality READY: NO. Overall READY: NO.** Artifact producer đã xử lý finding P1 cũ và cancellation đã xử lý finding P2 cũ. Vòng đời stage có reclamation thật, nhưng GC mới có race làm mất projection đã được journal reserve bền vững; cần FIX2 hẹp trước nghiệm thu.

Candidate `b1172c8`, base `4cbf581ec581040df6ca87950cf139e9bc490cd6`. Freeze inventory SHA-256 `433ef8ae903ec9b1749b07f73efdc893b8f20f5eacc1860594f00f7f8c4e690a`: **37/37** đường dẫn khớp bytes, mode và SHA-256 hiện tại. Gói diff source-scoped dài **440250 B**, SHA-256 `32708067200f1ed9e0abc71c0d4b7ac7a1a92550a57a9b832c8f79c0118288ba`; gồm owned surface và ba manifest/index generated paths bổ sung. Evidence inventory **34/34** khớp bytes/SHA-256. Không review source/model/attachments ngoài gói này; không sửa source, package, manifest hay peer changes.

Đã đọc finding gốc, brief, report cập nhật, approved Global Constraints/frozen pin/hash/ownership, flow docs, native recipe proposal/review và addendum. Review code thay đổi, actual builder/native C/receipt/GC/API/native projection, tests/support và fixture/provenance inventories; source pins giữ nguyên. PM đã xác nhận chưa có binding consumer contract bắt buộc `registry.retain` trước `ProcessJournal.reserve`, nên không dùng giả định đó để bỏ qua race.

## 1. Blocking finding mới — P1: GC xóa projection sau concurrent durable reservation

**Vị trí:** `v2/gateway/src/workflows/registry.ts:751–754,784–786,792–800`; đường đọc reference ở `694–701`. `ProcessJournal.reserve` dùng store riêng tại `v2/gateway/src/journal/process-journal.ts:99–132`.

`collectPublished()` lấy `refs` đúng một lần trong transaction của **workflow registry** rồi dùng snapshot đó để quyết định quarantine/delete. Transaction này không khóa writer của ProcessJournal. Vì vậy một reservation có thể commit sau khi `processes()` đã đọc nhưng trước khi native deletion bắt đầu. Snapshot rỗng vẫn được dùng để xóa projection, dù journal hiện đã có exact source/projection pair. Native FD/inode check chứng minh đúng object bị xóa, nhưng không chứng minh object hết reference tại thời điểm xóa.

**Reproducer reviewer đã chạy:** `node plans/261002-0002-crew-v2/execution-phase03/task-4-evidence/re-review/gc-reservation-race.mjs` → exit 0. Probe dùng synthetic source chỉ cho matrix mechanics, registry thật và ProcessJournal thật; barrier ở public `processes()` chỉ giữ một interleaving xác định: đọc snapshot rỗng → **actual `journal.reserve` transaction fsync pair** → trả snapshot → GC. Không chế tạo reference/receipt/stop boolean, không spawn workflow/runtime/model.

Output tại `task-4-evidence/re-review/gc-reservation-race.log`:

```json
{
  "finding": "GC_DELETED_DURABLY_RESERVED_PROJECTION",
  "collection": {"deleted": ["c81b3ba9-d856-43ec-9777-cc607a6ee848"], "retained": ["1f360d44-a24a-4409-8cfe-870e9b2a70ca"], "failed": []},
  "durableReferenceCount": 1,
  "exists": false,
  "resolveError": "CHECKSUM_MISMATCH",
  "processesSpawned": 0
}
```

Reservation chưa có READY/stop proof vẫn phải bảo vệ immutable pair theo contract; đây chính là nhóm mà existing GC test bảo vệ nếu reserve **trước** snapshot. Nếu launch tiếp tục sau reserve, projection đã mất. Test sequential hiện tại không bao phủ race này. Đây là breakage của GC mới trong FIX1, không phải yêu cầu runtime/Phase04 ngoài scope.

**Sửa hẹp:** tạo authority chung/enforceable admission giữa durable pin reservation và GC, để hoặc reservation đã bảo vệ pair trước delete, hoặc GC loại pair khỏi admission trước reserve và reservation bị từ chối. Một lần re-read ngay trước unlink vẫn còn cửa sổ race nếu reserve không tham gia cùng authority. Áp dụng invariant cho published GC và recovered quarantine deletion. Có thể thêm producer admission giữ registry reference trước reserve, nhưng ordering phải được API thực thi và phục hồi qua crash; chỉ ghi hứa hẹn trong docs chưa đủ. Không sửa frozen DTO/005 semantics hay dùng caller boolean để thả process refs.

**Kiểm chứng FIX2:** actual concurrent durable reservation tại snapshot/quarantine/delete boundaries; pair phải còn resolve được hoặc reserve phải reject trước launch. Kiểm restart giữa admission/ref/reserve và khi quarantine đã rename. Giữ regression sequential released/unreferenced GC và recovered references. Không cần lặp native/model certificate tests để sửa race này.

## 2. Disposition từng finding gốc

| Finding gốc | Disposition | Bằng chứng và giới hạn |
|---|---|---|
| P1 actual BMAD Claude installer / API artifact-policy | **ADDRESSED** | Exact package-local official installer được execute trong owned stage, frozen dependencies/binary policy; hai build mỗi BMAD Claude/API có protected exact-ID/device/inode no-fork wait receipts. Actual BMAD API và Superpowers API giữ skill/script/config/renderer inventories và policy hash, disabled tool/model. Không dùng copy synthetic thay installer. |
| P2 stage/retry/GC | **NOT ADDRESSED đầy đủ** | Malformed completed stages, crash windows, FD quarantine/delete, byte inventory/cap và truly unreferenced cleanup đã có đường thật. Historical leak reproducer đã được regression xử lý. Tuy nhiên new GC chưa bảo vệ pair trước concurrent ProcessJournal reservation, theo finding 1; phần reclamation đạt không đủ để chấp nhận toàn nhóm lifecycle/reference safety. |
| P2 cached cancellation A sau current B | **ADDRESSED** | Abort trước đọc/archive/transaction và ngay trước activation; cached projection kiểm sau verify. Tests A/B và abort-during-verify giữ B. Không xóa immutable A/B để chữa cancellation. |

ProcessJournal references chưa có genuine accepted-005-FINALIZED release producer được giữ riêng dưới lý do `accepted-finalization-producer-unavailable`, có exact pair/process/authorization và measured bytes. Đây là handoff Task5 đã công bố, được chấp nhận trong scope này; không đòi Task4 fabricate authenticated terminal receipt hay sửa ProcessJournal của Task2. Finding mới là **xóa pair trong khi reservation hiện tồn tại**, khác với việc giữ thận trọng nhóm chưa có release authority.

## 3. Artifact, supply chain và native review

- Source BMAD/Superpowers vẫn là frozen revision/payload/manifest/tree trước đó: tree `45227836…f9317` và `76972851…7ac46`; independent canonical source formula khớp cả hai. npm SRI/payload với Git revision vẫn là provenance riêng, không claim byte equivalence. `fetch.ts`, `pins.ts`, `stage.ts` không đổi trong fix diff.
- BMAD builder gọi exact official `tools/installer/bmad-cli.js`, fixed bmm/claude-code/no-shims/user/language inputs; official bytes không patch. Dependency archive SHA `ff6e59d2…2e8d`, exact package/lock hashes được bind policy. Saved primary npm/SRI ledger có **99 packages**, content ledger có **99 packages / 1889 regular files**; đây là số file được đối chiếu byte, không phải tổng bytes. Không lặp network acquisition. Attempt kiểm lại package roots trong archive bằng shell bị context hook chặn do keyword dependency-directory; không đổi ignore/config hay né chặn. Đã kiểm payload/freeze hashes và đọc acquisition/content-audit code cùng saved ledgers.
- Node24.14.0/uv0.11.3 binary hashes được production builder recheck; missing/tampered input hoặc policy fail trước executor. Owned HOME/TMP/XDG, env không kế thừa credential/module/proxy, sandbox deny fork/network và writes ngoài stage. Đây là confinement của installer cụ thể; không suy thành process-wide native runtime certificate.
- Metadata epoch chỉ áp dụng exact manifest/core/bmm operational date fields, rồi cập nhật corresponding files-manifest.csv hashes. Renderer giữ original bytes; skill vẫn yêu cầu uv ở runtime. `independent-builds.json` có **328 entries**, canonical manifest `7502ca97…805d` được reviewer tính lại khớp. Không có renderer replacement hay custom role prompt.
- Final saved log chứa **bốn** BMAD supervised build identities, tất cả receipt ID/device/inode trùng identity, exit0/no-fork/treeEmpty/timedOut=false; reviewer đối chiếu cả sáu BMAD/native IDs với final log. Hai native stage device/inode khác nhau. Đây là actual installer evidence, không phải fake native session.
- API policy liệt kê extensionless executables `sdd-workspace`/`review-package`; meaningful saved RED thiếu script và GREEN1/1 sau fix có assertion thực. OfficialInventory hashes bind output; build inputs/policy hash bind derivation. `modelRequestsEnabled=false`, `toolExecutionEnabled=false`, `isolationCertificate=null` vẫn giữ.
- Native Superpowers Codex đúng reviewed standalone recipe: full upstream **296 entries** giữ byte/mode, thêm đúng directory `.agents/skills` + **15** internal links, không duplicate `.agents`, YAML/frontmatter/name/hooks/role/source rewrite hoặc alias router. Geometry code và actual test kiểm canonical targets/sibling resources qua P và scratch directory symlink, root AGENTS tamper reject; policy ngoài counted tree được recheck ở resolve. Independent projection formula/policy checks **4/4** khớp cho BMAD Claude/API và Superpowers API/native.
- Không phát hiện blocking artifact/builder/native C/receipt-protection finding khác trong scoped review này. Native receipt ở attested `receipts/` ngoài stage writable grant, O_EXCL/no-follow, bind exact operation/dev/inode; child gate trước arm kqueue, actual waitpid, bất kỳ fork/lost receipt vẫn UNKNOWN. Pure-stage closure dựa exclusive writer reacquisition riêng, không fake executor stopped.

## 4. Reclamation, accounting và giới hạn giữ nguyên

Native cleanup mở parent/object qua FD/no-follow, kiểm UID/device/inode, scan trước quarantine, so lại object sau rename rồi unlink entry không theo symlink; regular nlink1, foreign mounts/hardlinks fail closed. Directory nlink chỉ quan sát. Failed pure stages có accounting/retry; reserved/create/rename/quarantine/executor recovery và timeout/fork được saved tests kiểm bằng operation thật. Stage unresolved cap **8** trước tạo operation mới; source archive32MiB/tree128MiB, executor90s, sampled stage accounting256MiB/30000entries/depth128 và per-file64MiB. Accounting256MiB là ngưỡng quan sát/kill, không phải quota filesystem cứng. Unknown counters giữ null thay vì zero.

Published GC có đường delete projection trước source, giữ current source/known projection dependencies và sequential recovered refs; race ở finding 1 là phần còn thiếu. Không yêu cầu xóa ba fork-UNKNOWN roots (47888/48541/48541B), acquisition root **55582679B** hoặc six evidence/cache parents khi thiếu full-tree stop authority. Inventory lý do/identity/bytes hiện diện; historical `parentStopped:true` không được nâng thành authority.

Marketplace6.4.2 immutable-package/metadata gate vẫn độc lập. BMAD Codex null/unavailable tới recipe audit riêng, không claim upstream unsupported. Native bootstrap-before-work, `superpowers:*` transitions, native Read/Bash/MCP/child/SDD, interpreter policy, reconnect/compaction và API tool loop đều **UNVERIFIED/disabled**. Artifact pin, no-model probe và fake integration không thay Phase04 certificate.

## 5. Verification, ownership và handoff

- Đọc final producer covering log **sau last api-policy source change**: build + **68/68**, fail/skip/cancel0, 74056.019209ms. Đọc typecheck exit0, Biome22files/no warnings, native `-Werror`/Python syntax/diff evidence; không tuyên bố reviewer tự chạy lại các suite này.
- Reviewer chạy đúng một narrow race probe nêu trên; không broad suite/model/global install/service/DB/owner config mutation. Native helper development compilation riêng chỉ phục vụ registry/ProcessJournal fixture; không workflow execution.
- Exact owned scratch `/private/var/folders/6r/7l8l6ytd2fgf91ccj55m73wm0000gn/T/crew-task4-rereview-gc-3hofkZ`, dev16777229/inode63424449/UID501: registry/journal đã close, identity recheck rồi xóa đúng root, ENOENT xác nhận trong log. Không cleanup producer UNKNOWN roots hay prefix/global scan.
- Chỉ thêm báo cáo này và `task-4-evidence/re-review/gc-reservation-race.{mjs,log}`. PM đã kiểm freeze/doc mappings và staged gates riêng; không source/stage/commit ngoài ownership.

**Unresolved Qs:** Không cần owner approval mới. PM/implementer cần chọn enforceable admission/GC authority cho finding 1 trong FIX2; genuine005-finalization release producer vẫn là Task5 handoff, actual runtime certification vẫn thuộc Phase04.
