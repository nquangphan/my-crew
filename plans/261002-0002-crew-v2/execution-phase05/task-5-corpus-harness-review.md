# Task5 — review độc lập tĩnh của harness corpus

Ngày review: 2026-10-03, Asia/Ho_Chi_Minh. Phạm vi duy nhất: ba artifact dưới đây, 37 corpus hiện có và năm diagnostic hiện có, trước launch. Đây không phải nghiệm thu parser đầy đủ hoặc kết luận hoàn tất Task5.

| Gate cho bounded harness launch | Kết luận |
|---|---|
| SPEC | **NOTREADY** — challenge không giữ cùng corpus SHA sau serialize/parse; kiểm chứng attach closure chuyển lỗi quan sát thành stopped; đường parent chưa kiểm hết symlink components |
| QUALITY | **NOTREADY** — golden raster PDF nhận nhầm nội dung; durability recipe chưa đầy đủ; polling có thể bỏ lỡ lượt rất ngắn |
| Launch | **Chưa được chạy**; sửa artifact và review lại trước khi PM cấp approval cụ thể |
| Production admission/certificate | **Không có**; review này không cấp permit hoặc authority |

Allocation và selected-parser wall challenge là **UNVERIFIED_OMITTED**, đúng phạm vi PM đã thu hẹp. Không coi hai gate được bỏ rõ ràng này là lỗi harness. Existing memory/timeout diagnostic không thay thế chúng.

## Artifact đã đọc toàn bộ và đối chiếu

Worktree tham chiếu: `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`. Markdown mới duy nhất thuộc reviewer là báo cáo canonical này. Reviewer không sửa source/test/schema/parser/PM docs, không thay Git, không tạo child agent, không chạy `--prepare`, `--plan`, `--run`, PostgreSQL, container, model hoặc native/parser workload.

| Artifact | Bytes | SHA256 đã tính lại |
|---|---:|---|
| Canonical `task-5-corpus-harness-report.md` | 16124 | `437930e0a6724a0a5412663eaed6bdff3488f060734a6e91f14c5490572e28ba` |
| Worktree `task-5-corpus-harness.mjs` | 29407 | `89c2a871380ee0a18eb987fd0845c27394e48bee1f24110a157b21dd91f0802d` |
| Worktree `task-5-parent-fixture.py` | 7238 | `3b62cc89954e518a5a1836d74208e0e515a23d36376606f01f267953058020ba` |

Các artifact nằm trong `plans/261002-0002-crew-v2/execution-phase05/` ở root tương ứng. Đã đọc root `docs/index.md`, `v2/docs/index.md`, flow `attachment-extraction` trước related source. Worktree không có `.codegraph/`; không indexing. Đã dùng nguyên tắc `verification-before-completion`: chỉ gọi những kiểm tra có output đọc được là đã xác minh.

## Findings cần sửa trước launch

### F1 — [P1] Corpus SHA đổi khi plan được canonical hóa, verifier luôn từ chối challenge

Nguồn: [harness dòng174](/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/plans/261002-0002-crew-v2/execution-phase05/task-5-corpus-harness.mjs:174), dòng175,178,264,270; frozen `worker-runner.ts` dòng604. Báo cáo harness dòng94,96 mô tả workflow prepare → plan → approval → run.

`originals` được dựng với thứ tự key `sha256,mime`. `corpusSha256` băm `JSON.stringify(originals)` theo thứ tự đó. Sau đó `exclusive(plan.json, canonical(plan))` sắp xếp key lồng nhau thành `mime,sha256`. Khi `--run` đọc lại plan, helper thật băm `JSON.stringify(challenge.originals)` theo thứ tự mới, khác corpus SHA đã lưu; constructor `createExtractorCorpusVerifier` ném `WORKER_CORPUS_CHALLENGE_INVALID` trước cả diagnostic đầu tiên. `challengeSha256` canonical vẫn khớp nên không phát hiện lỗi trước constructor.

Đã xác minh bằng phép serialize/hash thuần với original minh họa SHA `a`×64/MIME `text/plain`: trước canonical `3f6b361a34703e6d0f672f18a7a396ce9fcf50e647325b257f562c2cf7d23555`, sau canonical `c3e785748b0e023e79d04ee9cae4960e0ed0dd338cd5d36b8e9e89e898a23d19`. Không import/chạy harness hoặc sinh fixture.

Khuyến nghị: tính corpus SHA từ đúng ordered object representation sẽ đọc lại từ plan, tương thích helper frozen hiện tại; kiểm lại quan hệ `corpusSha256 === sha(JSON.stringify(parsedPlan.challenge.originals))` bằng static serialization check trước nhận approval. Không sửa helper/parser của peer để che lỗi này. Artifact/plan thay đổi phải được freeze/review mới.

### F2 — [P1] Lỗi `ps` được coi là chứng cứ attach đã đóng

Nguồn: [harness dòng236](/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/plans/261002-0002-crew-v2/execution-phase05/task-5-corpus-harness.mjs:236), dòng237–240; báo cáo harness dòng100. Helper frozen dòng303–312,503,538–540,655–673 cung cấp actual container stop và await owned child closure trong những đường có run handle.

Mọi rejection của `ps` đều trở thành `{stdout:''}`. Dòng237 diễn giải stdout rỗng là `attachClosed=true`, rồi gọi exact rm. Rejection vì timeout, maxBuffer, process-spawn failure hoặc lỗi hệ thống không chứng minh PID không còn tồn tại. Đặc biệt khi helper ném trước khi trả run handle hoặc closure chưa được chứng minh, harness có thể ghi closed dù quan sát attach là unknown. Final assert về `attachBirth` không giải quyết lỗi này nếu birth trước đó đã được lấy.

Khuyến nghị: chỉ chấp nhận kết quả quan sát absent xác định của `ps`, hoặc receipt actual child-close từ helper đã được ràng buộc exact PID/birth/CID. Timeout/lỗi công cụ phải giữ `UNKNOWN_RETAINED`, không tiếp tục cleanup/case kế tiếp. Kiểm marker `.attach.json` gồm PID integer dương, nonce/workerId/containerId khớp owned case; birth command phải là exact Docker binary `start --attach <fullCID>`, không chỉ lưu bất kỳ command tại PID đó. Không dùng lỗi đọc làm stop proof.

### F3 — [P2] Golden raster PDF chỉ kiểm nonblank, nhận cả raster sai hoặc hoán đổi trang

Nguồn: [harness dòng43](/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/plans/261002-0002-crew-v2/execution-phase05/task-5-corpus-harness.mjs:43), dòng61–62,77–79,101–126,143–145; báo cáo harness dòng63–65,74. Recipe fixture hiện có trong frozen README mô tả scan là hình RGB(30,90,180) tại rectangle `(10,10,100,100)` trên trang144×144; mixed trang1 chữ, trang2 scan.

Mọi PDF vision hiện chỉ có golden `288×288, nonblank=true`. Hai màu bất kỳ thỏa dòng126. Nếu mixed page1/page2 raster bị hoán đổi nhưng locator giữ đúng page, hoặc renderer trả cùng một ảnh nonblank sai ở mọi trang, golden vẫn nhận. Băm lại file từ bytes protocol xác minh tự nhất quán manifest, không chứng minh bytes có nội dung đúng. Supplementary text không bù được nội dung raster của scan hoặc thứ tự raster mixed.

Khuyến nghị: bổ sung pixel/region/orientation expectations độc lập từ chính recipe và fixture đã lưu, phân biệt trang text/scan và rotation90; không thêm payload/fixture/canary mới. Ít nhất scan phải có vùng màu và nền trắng đúng vị trí, mixed từng trang phải đối chiếu khác nhau. Không lấy hash expected từ parser được kiểm. Hàm `closeEnough` dòng96 cũng cần kiểm `typeof actual === 'number'` và finite trước trừ, vì JSON numeric string hiện có thể vượt check PDF supplementary dù báo cáo dòng74 nói kiểm type exact.

### F4 — [P2] Parent verification chưa từ chối symlink của các thư mục trung gian/receipt

Nguồn: [harness dòng155](/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/plans/261002-0002-crew-v2/execution-phase05/task-5-corpus-harness.mjs:155), dòng156–162,166–167,268; Python dòng37–53 có kiểm components cho nguồn, nhưng kiểm đó không được dùng cho owned parent trong Node.

`verifyRoot` kiểm realpath root và `lstat` leaf từng payload, rồi dùng `readFile` và dynamic import. Một thư mục trung gian như `v2/server/src/attachments` có thể là symlink ra ngoài root, trong khi leaf vẫn là regular file đúng hash. Node sẽ resolve import từ path thực ngoài owned parent; những relative import kế tiếp có thể không còn nằm trong frozen closure đã kiểm. `owner.json` và `frozen-parent.json` cũng được đọc bằng hàm `json()` theo symlink. Root mode0700 giảm tác nhân khác UID nhưng không chứng minh yêu cầu “không symlinked paths” và frozen import provenance.

Khuyến nghị: trước đọc/import kiểm toàn bộ path components từ owned root đến mọi marker/payload; yêu cầu resolved path vẫn nằm đúng owned root, regular leaf mở NOFOLLOW và UID/mode phù hợp. Kiểm current UID với recorded owner UID nếu môi trường launch hỗ trợ. Không sửa `storage.ts` của peer: harness có thể dùng helper noSymlinkComponents đã accepted hoặc kiểm thuần tương đương. Giữ identity và bytes của snapshot peer; không nhận quyền cleanup nó.

### F5 — [P2] Recipe fsync file nhưng không fsync directory trước dữ liệu subordinate

Nguồn: [recipe dòng55](/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/plans/261002-0002-crew-v2/execution-phase05/task-5-parent-fixture.py:55), dòng56–64,114–126; báo cáo harness dòng92.

`write_exclusive` fsync FD của file rồi đóng; không fsync parent directory sau `mkdir` hoặc tạo file. Vì vậy sau `owner.json` đã fsync, directory entry của marker chưa được chứng minh durable trước khi tạo subordinate payloads. Sau crash có thể giữ dữ liệu mà mất marker/manifest; điều này không đáp ứng claim owner identity được persist trước file con. Đây là khoảng thiếu durability tĩnh, chưa có crash thực nghiệm trong lượt này.

Khuyến nghị: fsync parent của root sau mkdtemp, fsync owned root ngay sau owner marker, fsync directory của mọi entry tạo độc quyền và các thư mục mới; giữ error receipt/unknown root khi có lỗi. Không dùng retry/prune hoặc xóa root thiếu marker.

## Polling lượt ngắn: gap quan sát đã được khai báo, không suy thành runtime failure

Nguồn: harness dòng194–205,231,246–247; báo cáo harness dòng112.

Observer polling ngoài helper nên không có đảm bảo nhận birth/running PID của diagnostic hoặc negative corpus rất ngắn. Nó còn đặt `seenAttach=true` trước khi `ps` thành công ở dòng199, nên lỗi tạm thời lượt đầu ngăn retry birth trong lượt đó. `ps` và `docker inspect` chạy tuần tự với timeout2s/5s; sleep10ms không đồng nghĩa cadence10ms. Helper settlement khiến observer dừng; assertions dòng246–247 sẽ halt sau cleanup nếu thiếu evidence. Đây là fail-closed về kết luận match, không false PASS và reviewer không khẳng định nó đã xảy ra.

Cần cơ chế quan sát lifecycle đáng tin cậy/ACK được review trong phạm vi existing helper/harness trước kỳ vọng thu đủ42 observations, hoặc quyết định PM rõ về xử lý short-case gap. Không kéo dài diagnostic bằng payload/canary mới. Thiếu running PID/birth không được tự điền bằng PID lịch sử, không gọi lại dưới provider khác.

## Những ràng buộc đã đối chiếu tĩnh

| Ràng buộc | Kết quả và giới hạn |
|---|---|
| Canonical inventory36 | Canonical sorted-key/compact UTF8 SHA `85d06b02ce6dcc388fdd0d01ada17ca1cd9d867cfb6119458e390ec56e6d6d09` tính lại khớp. Inventory vẫn có docs; parent closure loại README theo phạm vi đã công bố |
| Frozen snapshot | Real root `/private/tmp/crew-v2-attachments-parser-b953796e-f601-4a6a-9311-38bd9f79c43d`; nonce `b953796e-f601-4a6a-9311-38bd9f79c43d`, dev16777229/ino64075091/UID501 khớp marker. PID53755 là lịch sử; không kiểm process hoặc suy quyền xóa |
| Parent21 payloads | Hai runner/protocol + make-fixtures và13 binary fixtures + năm accepted Git blobs; mọi size/SHA của21 payload khớp. Type-only imports không kéo contracts/parser/deps vào Node parent; runtime import closure dùng built-ins và config/canonical/errors/storage đã copy |
| Actual accepted Git blobs | `b670d82:storage.ts`15312B SHA `b252f6b1f97fd08359c9f369bebf2f680fce2abc0a23793cd63d8eb678c9db2c`; config/canonical/errors/package từ `0c838d2`, lần lượt3804/1447/333/843B, khớp tất cả SHA hardcoded trong recipe23–28 |
| Frozen runner/protocol | Runner25728B SHA `7c28d38d321cb8ffa51d53b46b690cf5e22c7777abfd9e9052678d6f5faeca1e`; protocol19753B SHA `96fbee3bd5e7a9023ae141642e1c137c9e00351b2bae57dd5e2194cfaf92308f`; current worktree bytes khớp frozen |
| Image/source/receipt | Image literal `sha256:8f2eec2f52fd3ed6c2c42215cad5ce81bee8989a9db3c8bd97f689aed998988a`; sourceTree16 SHA tính lại `5d40c2d9ce6c1137d1dc476988f28b981ee8ea027c6fc8ad6795a9f01c7764f5`. Receipt112469B SHA `d9c16b3eded2f3ca29270de4610dfdacdbd65a8557c30fefbc947c95181da3da` khớp Python pins; state `candidate-image-held-not-certified` |
| Source16 + Linux package/lock | Tất cả18 context file bytes khớp receipt và stage hiện giữ đúng dev/ino/UID. Storage/diagnostic đối chiếu actual `b670d82` blobs; parser/entry/protocol đối chiếu frozen snapshot. Diagnostic5612B SHA `eb9100e61b9fc5587c7aaafed21ad65b96a4578727c15d1a8827564ff4f28a8b` |
| Production dependency binding | Package868B SHA `a721662a2c34e9cbc7043421039ec44ddc9ef9192200f6e6d1bf7e30be85b39e`; Linux lock26671B SHA `9e4a9700ea99cdae3b4ca2a145c6cc6d78373657fba2258b2073cf81a5365106` khớp. Exact parser versions pdfjs6.3.289/canvas1.0.3/yauzl3.4.0/saxes6.0.0/pdf-lib1.17.1; frozen scripts-disabled production-install recipe. Không install hoặc probe lại deps |
| Runtime privilege/path | Receipt lưu UID65532:65532, cwd `/extractor`, entry `node --max-old-space-size=384 src/attachments/worker-entry.ts`; base Node24.14 Bookworm pinned digest `d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8`. Chỉ đọc receipt, chưa Docker inspect hiện tại |
| Sandbox resource limits | Frozen helper248–276 create image immutable/pullnever, networknone, readonly, capdropALL, no-new-privileges, memory+swap512MiB, CPU1/pids32, tmpfs/tmp16MiB và/output100MiB, input bind readonly, lognone. Harness exactClosed kiểm các controls chính và closed PID0; chưa đo enforcement thực |
| Serial/case budget | Một await mỗi case; verifier clone challenge và giữ active, maxCases37, original SHA+MIME/config/extractor binding; fsynced exclusive ordinal reservation trước create. F1 phải sửa để challenge sử dụng được. Không retry/replay hoặc production runner authority |
| Golden37/source scope |37 tên và status/problem/missing/locator expectations được viết tường minh từ existing fixture recipe; literal text/CSV/Office, UTF byte span, PDF supplementary coordinates, image pixels/EXIF independent. Không parser-generated text oracle. F3 giới hạn chất lượng PDF vision; corpus không bao phủ hết Office positive/visual |
| Fresh admission | Harness180–188 đo pressure1/2, available≥4GiB theo free+inactive+speculative, CPU idle≥50%, disk≥8GiB; ghi admission trước mỗi case và assert deny; approval expiry/frozen-root/Docker binary SHA kiểm mỗi lượt. Chưa đo telemetry thực tại bất kỳ create nào trong review |
| Stop/cleanup | Helper kiểm exact name/fullCID/nonce/image/source; created không coi stopped; stop rồi actual child closure trong handle đã nhận; exact non-force rm sau reconciliation receipt. Harness giữ original SHA/MIME/job/generation/config, result/bytes và final state/error. F2 là lỗ hổng quan sát attach cần sửa |

## Diagnostic và các gate còn giữ UNVERIFIED

Chỉ có năm scenario hiện có trong DIAGNOSTICS, trước corpus và chạy serial: boundary10s, pids10s, memory20s, stdout-bomb2s, timeout2s. Exact diagnostic check-name lists khớp accepted diagnostic source. Boundary dùng đường `/extractor` đúng, selected original bằng literal8B, host-only sentinel không mount vào worker.

Memory đòi đúng `WORKER_DIAGNOSTIC_INVALID` và actual `OOMKilled=true`, closed/PID0; generic crash/no-result không được nhận thành protection PASS. Stdout-bomb/timeout đòi đúng helper error, noOOM và closure. Report giữ actual exit/OOM/HostConfig trong observation; direct Linux cgroup path và `memory.events` chưa được đo. Tên field `cgroup` trong polling chứa HostConfig values, không phải counter đọc trực tiếp từ cgroup. Không ghi chúng thành measured counters.

Thiếu mới owned parent root, plan/corpus-list/challenge SHA thực, UUID cases, outputs và per-case telemetry là đúng vì chưa prepare/plan/run; reviewer không cấp launch approval. Parent heap384MiB là V8 heap, không hard RSS limit, đúng report và launch-intent fields. Allocation/parser-wall vẫn omitted/unverified dù sau này42 existing observations có thể matched. Không application pre-inflate protection claim, không dùng failed parse làm capacity proof, không tạo certificate/admission.

## Kiểm tra thực tế trong lượt review

1. Đọc tĩnh toàn bộ114 dòng report,288 dòng mjs và135 dòng Python, cùng flow/related frozen source đã chỉ định.
2. SHA/byte comparison bằng Python standard library, Git `show` read-only; đối chiếu21 parent payloads, toàn bộ frozen non-doc inventory files,16 image sources và hai Linux package/lock bytes, stage identity và sourceTree16 hash. Không thực thi recipe default/prepare.
3. `node --check <worktree>/plans/261002-0002-crew-v2/execution-phase05/task-5-corpus-harness.mjs`: exit0; không import/execution harness.
4. Python `ast.parse` recipe: valid; không py_compile/pycache. Static key-order serialization chứng minh F1; không chạy helper/parser và không sinh fixture.

Không có own scratch/CID/PID runtime mới để cleanup. Không mở workload sau review. Nội dung báo cáo này không tự chứa hash của chính nó; PM có thể hash artifact sau khi đọc.

## Câu hỏi/gate chưa giải quyết

- PM/worker cần xử lý F1–F5 và lifecycle observer gap, rồi freeze/review lại chính artifact thay đổi; hiện chưa thể cấp safe bounded launch.
- PM cần review golden PDF có nội dung phân biệt từng trang từ existing recipe, rồi review plan/approval cụ thể và sole-heavy slot. Chưa có approval/plan để reviewer đối chiếu.
- Direct `memory.events`, actual42 observations, allocation/selected-parser wall và production authority vẫn chưa xác minh; review tĩnh này không hoàn tất các gate đó.

## FIX1 — independent scoped re-review F1–F5

Ngày re-review: 2026-10-03, Asia/Ho_Chi_Minh; dispatch sau resource snapshot PM18:27. Phần review gốc phía trên giữ nguyên bằng chứng lịch sử. Kết luận FIX1 dưới đây thay verdict cũ **chỉ cho artifact đã sửa và phạm vi F1–F5**, không thay gate runtime/launch/production.

| Gate | Verdict FIX1 |
|---|---|
| SPEC artifact, scoped F1–F5 | **READY** — năm finding đã được xử lý trong artifact sở hữu; không thấy blocker/regression mới ở các đường gọi được sửa |
| QUALITY artifact, scoped F1–F5 | **READY** — có serialization guard, unknown-safe closure, page-specific raster regions, full-components reads và directory durability; kết luận là static review |
| Guaranteed birth/running witnesses của42 existing observations | **UNVERIFIED** — polling chưa bảo đảm nhận lượt ngắn; không cấp kết luận42 runtime PASS |
| Launch approval | **Chưa cấp** — PM phải duyệt owned root/plan/approval cụ thể và sole-heavy slot; READY artifact không tự chạy hoặc cấp quyền launch |
| Allocation/parser-wall | **UNVERIFIED_OMITTED**, giữ nguyên đúng phạm vi |
| Production certificate/admission | **Không cấp**; Task5 chưa được nghiệm thu bởi báo cáo này |

### Bytes/SHA frozen cho FIX1

| Artifact | Bytes | SHA256 tính lại |
|---|---:|---|
| Worktree `task-5-corpus-harness.mjs` |36959| `b40d99dd3f2028204781d16c5dc02bed40aee32a4a4b3d4ecc2da5f457cbb71c` |
| Worktree `task-5-parent-fixture.py` |8014| `15e161fdf2dc1b3703fb57b43885999ecfb041419f63a8f7d35e7a3fcb28e835` |
| Canonical `task-5-corpus-harness-report.md` |35311| `4e452699990a454c514eb21c339e51881df6cea6c86b439f75a5a60327231c5d` |
| Review gốc trước append FIX1 |18873| `c37a7f660a16241d3964c045ec2f46ca62e006b8b26a0660a436f5ef21487bea` |

Đã đọc toàn bộ368 dòng harness,161 dòng recipe và333 dòng report hiện tại. Append FIX1 là mutation duy nhất của reviewer. Không source/test/schema/parser/PM doc/Git changes, children, scratch root hoặc workload mới.

### Kết quả từng finding và regression liên quan

| Finding cũ | Kết luận FIX1 | Đường sửa và đối chiếu tĩnh |
|---|---|---|
| F1 P1 — corpus SHA sau serialization | **RESOLVED_STATIC** | Harness224–237 dựng `originals` qua `JSON.parse(canonical(...))`, nên thứ tự key trước băm giống parsed canonical plan (`mime,sha256`). `assertChallengeSerialization` kiểm cả corpus JSON.stringify SHA và canonical challenge SHA trước write229 và trước approval/constructor342. Frozen helper604 vẫn dùng JSON.stringify; representation mới tương thích, không sửa helper |
| F2 P1 — ps errors → closed | **RESOLVED_STATIC** | Harness252–271 phân biệt definite absent (exit1/stdout+stderr rỗng/no kill/signal), parsed present và unknown; timeout/maxBuffer/spawn/tool errors không thành absent.263–277 bind PID>0/nonce/workerId/fullCID và exact Docker start--attach command; `seenAttach` chỉ true sau capture thành công.311–319 yêu cầu exact stopped/PID0, attach closure dựa birth và running witness **trước rm**. Unknown/missing witness giữ default UNKNOWN_RETAINED và halt325; không fallback lịch sử hoặc error→closed |
| F3 P2 — PDF nonblank-only/type coercion | **RESOLVED_STATIC** | Harness71,105–107 bind page-specific raster kind: mixed page1 text/page2 scan, rotated90.129–148 kiểm scan blue interior/white exterior từ rectangle recipe, text grayscale/white exterior/three word regions/word gaps, rotation mapping `(287-y,x)`. PNG decode175 gọi checker trên actual pixels.124 đòi numeric actual type và finite. Hoán đổi text/scan không còn thỏa cả hai predicates. Golden không dùng renderer output để sinh expected |
| F4 P2 — intermediate symlinks | **RESOLVED_STATIC** | Harness32–54 kiểm path confinement, full lstat components, canonical path, current UID, root/private dirs0700, allowed regular file modes; NOFOLLOW FD được đối chiếu dev/ino/UID/mode.204–212 dùng readOwned cho owner/manifest/harness/closure payloads; verify exact import.meta root/harness.mjs209. Marker/output/plan reads dùng cùng guard; approval55–59 kiểm external components/regular UID/mode. Helper output file0600 ở frozen worker-protocol425–428 tương thích. Input được chmod0755 ở301 nhưng không đi qua readOwned, nên không có regression deterministic vì mode input |
| F5 P2 — owner directory fsync | **RESOLVED_STATIC** | Python55–84 dùng directory FD O_RDONLY/O_DIRECTORY/O_NOFOLLOW và fsync/close; durable_mkdir sync parent+directory mới; exclusive file sync rồi parent directory.139–148 sync mkdtemp parent/root trước owner; owner write+directory sync xong mới subordinate payload loop. Failure149–156 giữ identity/root và báo failure-receipt error nếu không persist được, không prune/delete |

Không có finding mới trong phạm vi FIX1 đã giao. Raster region golden xác minh nội dung/geometry theo recipe ở mức vùng và màu, **không** chứng minh từng glyph hoặc native renderer đã chạy đúng. Ngưỡng/antialias bounds cần được đo khi actual image corpus được PM cho chạy; false rejection khi runtime khác expectation vẫn phải halt, không tự sửa expected.

### Short-case witness và gate ngoài scope vẫn chưa hoàn tất

Report FIX1132,323 khai báo polling birth/running vẫn UNVERIFIED. Harness272–283 là polling bên ngoài helper: tool latency và helper settlement có thể làm mất witness trước khi được quan sát, dù đã sửa lỗi đặt seenAttach quá sớm. Thiếu birth khiến classifyAttachClosure trả unknown; thiếu running witness bị chặn318. Cả hai đều trước319 exact rm và không được summary ghi goldenMatched. Đây là fail-closed artifact behavior, không phải bảo đảm collector sẽ thu đủ42 observations.

Proposal lifecycle ACK/handshake trong report132 chưa triển khai; không nằm trong mutation scope re-review này. PM có thể quyết định một lượt bounded để quan sát với kỳ vọng fail-closed/retention hoặc chờ producer-approved lifecycle witness guarantee, nhưng không được gọi static READY là actual42 acceptance. Nếu unknown, giữ exact evidence/container/resource để reconcile; không retry/canary/provider variant hoặc đổi required witness tự động.

Allocation/selected-parser wall vẫn omitted/unverified. Direct Linux cgroup path/`memory.events` chưa đo. Existing diagnostic OOM vẫn đòi actual OOMKilled và đúng helper error; generic crash/no-result không là protection proof. No production authority/certificate/admission từ append này.

### Verification của reviewer trong FIX1

- SHA/bytes của ba artifact FIX1 và review gốc khớp dispatch trước đọc. Hash/read chỉ dùng standard library, không chạy recipe default.
- `node --check task-5-corpus-harness.mjs`: exit0; Python `ast.parse`: valid, không exec/import recipe và không pycache.
- Đọc tĩnh changed call paths và frozen protocol output modes liên quan F4. Không rerun Node/Python mock checks của worker, không harness modes/tests/parser/native/container/PG/model. Các12+3 pure GREEN claims trong report được xem là evidence của worker, không đổi thành kết quả test độc lập của reviewer.
- Ba input FIX1 được hash lại sau review; nếu SHA đổi, kết luận này không áp dụng cho bytes mới.

Unresolved: exact owned root/plan/approval và launch slot; guaranteed short-case birth/running witnesses; actual42 boundary/corpus measurements; direct cgroup counters; omitted allocation/parser-wall; production authority. Không còn unresolved finding F1–F5 trong phạm vi static artifact FIX1.
