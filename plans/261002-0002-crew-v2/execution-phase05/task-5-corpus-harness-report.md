# Task5 — harness corpus tĩnh, chờ PM duyệt

Trạng thái **STATIC_READY_FOR_REVIEW**. Chỉ chuẩn bị recipe và mã harness cho **37 corpus hiện có + 5 diagnostic hiện có**. Chưa chạy parent harness, container, parser, native decoder, PostgreSQL, provider hoặc workload nặng. Không tạo production permit/certificate. Kiểm chứng allocation và wall của parser vẫn **UNVERIFIED**, được bỏ khỏi phạm vi sau chỉ đạo PM17:28. Không tạo fixture allocation, canary mới, không thử lại hay chuyển provider.

## Artifact và ownership

Chỉ ba file mới thuộc worker này; không sửa production source, docs flow, package/lock, index hoặc Git:

| Artifact | Đường dẫn tuyệt đối | SHA256 |
|---|---|---|
| Harness Node | `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/plans/261002-0002-crew-v2/execution-phase05/task-5-corpus-harness.mjs` | `89c2a871380ee0a18eb987fd0845c27394e48bee1f24110a157b21dd91f0802d` |
| Recipe frozen parent | `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/plans/261002-0002-crew-v2/execution-phase05/task-5-parent-fixture.py` | `3b62cc89954e518a5a1836d74208e0e515a23d36376606f01f267953058020ba` |
| Báo cáo này | `/Users/phannhatquang/Documents/projects/crew/plans/261002-0002-crew-v2/execution-phase05/task-5-corpus-harness-report.md` | Hash độc lập khi PM freeze báo cáo; không tự băm nội dung chứa chính hash đó |

NEW Markdown đặt trong canonical project `plans/` theo chỉ đạo PM17:33. Không tạo thêm Markdown ở worktree. Không có own scratch root; `root=null`, không có own nonce/dev/ino/PID/CID mới. Hai lần đọc recipe đầu thất bại trước bước tạo root: alias macOS `/tmp` là symlink; README trong snapshot cũ khác docs hiện tại. Đã sửa recipe resolve đúng `/private/tmp` và chỉ copy closure executable/binary, loại README khỏi closure. Không xóa snapshot/evidence của peer.

## Nguồn đóng băng và provenance

Đã đọc root/v2 docs index, attachment-extraction flow, Task5 brief/report, fixture README và make-fixtures trước source. Worktree không có `.codegraph/`; không chạy indexing. Script chuẩn bị không đọc executable từ working tree peer.

- Canonical inventory36 file: `85d06b02ce6dcc388fdd0d01ada17ca1cd9d867cfb6119458e390ec56e6d6d09`, SHA canonical files-array với sorted keys/compact UTF8. Documentation được giữ trong inventory gốc, không đưa vào parent import closure.
- Frozen snapshot đọc đúng `/private/tmp/crew-v2-attachments-parser-b953796e-f601-4a6a-9311-38bd9f79c43d`; owner nonce `b953796e-f601-4a6a-9311-38bd9f79c43d`, dev16777229/ino64075091/UID501. Recipe kiểm identity và hash từng file; chỉ đọc, không nhận quyền xóa root đó. PID53755 trong marker là dữ liệu lịch sử, không được hiểu là process đang chạy.
- Runner `7c28d38d321cb8ffa51d53b46b690cf5e22c7777abfd9e9052678d6f5faeca1e`; protocol `96fbee3bd5e7a9023ae141642e1c137c9e00351b2bae57dd5e2194cfaf92308f`; make-fixtures `a84d481c5b7b3aa8a811c0a98b2bfa7db96fcf8e37a6009dd95928b35d11aee7`.
- Storage từ actual accepted `b670d82` Git blob, SHA `b252f6b1f97fd08359c9f369bebf2f680fce2abc0a23793cd63d8eb678c9db2c`.
- Config/canonical/errors/package từ actual accepted `0c838d2` Git blobs; hash cứng trong Python, không dùng version động. Cả21 file gồm2 runner/protocol,14 make-fixtures/binary fixtures và5 accepted blobs đã được recipe describe đối chiếu size/SHA. Parent Node không cài dependency, không tạo link `node_modules`; type-only imports không cần copy absent type files.
- Image candidate `sha256:8f2eec2f52fd3ed6c2c42215cad5ce81bee8989a9db3c8bd97f689aed998988a`, sourceTree `5d40c2d9ce6c1137d1dc476988f28b981ee8ea027c6fc8ad6795a9f01c7764f5`. Receipt PM `task-5-production-image-receipt.json` SHA `d9c16b3eded2f3ca29270de4610dfdacdbd65a8557c30fefbc947c95181da3da` được kiểm đúng trước chuẩn bị. Linux/amd64/glibc/Node24.14, UID65532, `/extractor`; image/import probe receipt không thay cho corpus/boundary certificate. Recipe không sửa/xóa lịch sử failed EXDEV/EACCES.

## Bảng kỳ vọng độc lập để PM duyệt

`GOLDENS` trong harness là bảng tường minh, không gọi actual parser để sinh expected, không tự cập nhật golden khi output sai. Bảng này suy từ nội dung fixture đã viết, recipe ReportLab/PIL/ZIP và hợp đồng source locator; PM phải review trước launch. `make-fixtures.status` chỉ được đối chiếu với bảng, không làm nguồn kỳ vọng runtime. Mỗi case plan sẽ ghi exact original SHA/bytes/MIME và UUID job/attachment/generation1 trước bất kỳ container nào.

Các ca terminal negative bên dưới đều kỳ vọng **zero units, zero files** và đúng problem code. Các ca complete không có problem/missing. Mỗi available unit phải có đúng một file đúng modality; file byteLength/SHA băm lại từ bytes nhận qua actual framed protocol. Missing unit phải có problem liên kết đúng unitId. Thừa/thiếu locator, trang, text, output hoặc byte/hash đều dừng sau closure/cleanup, không đổi expected.

| # | Existing case | Status / problem | Available/missing coverage và nội dung phải đúng |
|---:|---|---|---|
| 1 | zip-zero-compressed | failed / LIMIT_EXCEEDED | 0/0 |
| 2 | zip-invalid-crc | corrupt / CORRUPT_DOCUMENT | 0/0 |
| 3 | zip-2001-entries | failed / LIMIT_EXCEEDED | 0/0 |
| 4 | xml-depth-limit | failed / LIMIT_EXCEEDED | 0/0 |
| 5 | embedded-ole-docx | blocked / ACTIVE_CONTENT_BLOCKED | 0/0 |
| 6 | launch-escaped-pdf | blocked / ACTIVE_CONTENT_BLOCKED | 0/0 |
| 7 | launch-incremental-pdf | blocked / ACTIVE_CONTENT_BLOCKED | 0/0 |
| 8 | launch-compressed-pdf | blocked / ACTIVE_CONTENT_BLOCKED | 0/0; existing stored fixture only |
| 9 | launch-pdf | blocked / ACTIVE_CONTENT_BLOCKED | 0/0 |
| 10 | javascript-pdf | blocked / ACTIVE_CONTENT_BLOCKED | 0/0 |
| 11 | executable-pdf | blocked / ACTIVE_CONTENT_BLOCKED | 0/0 |
| 12 | portfolio-pdf | partial / UNSUPPORTED_VISUAL | 2 available +1 missing; page1 raster/text và missing collection locator `[0,0,0,0]` |
| 13 | rotated-pdf | complete | page1 vision/text rotation90, PNG288×288 |
| 14 | exif6-jpeg | complete | image vision2×3, original3×2/orientation6/rotation90/reflected=false; ảnh đỏ RGB254/0/0 ±2 do JPEG |
| 15 | truncated-png | corrupt / CORRUPT_DOCUMENT | 0/0 |
| 16 | huge-png | blocked / ACTIVE_CONTENT_BLOCKED | 0/0; existing generator fixture, không ca allocation mới |
| 17 | malformed-csv | corrupt / CORRUPT_DOCUMENT | 0/0 |
| 18 | utf16le-text | complete | byteStart0/byteEnd20, line1..2; UTF8 output literal `Việt Nam\n` |
| 19 | binary-text | unsupported / UNSUPPORTED_TYPE | 0/0; dispatcher, không bypass sang pure text parser |
| 20 | zip-traversal | corrupt / CORRUPT_DOCUMENT | 0/0 |
| 21 | zip-case-collision | corrupt / CORRUPT_DOCUMENT | 0/0 |
| 22 | zip-encrypted | blocked / ACTIVE_CONTENT_BLOCKED | 0/0 |
| 23 | zip-symlink | corrupt / CORRUPT_DOCUMENT | 0/0 |
| 24 | xml-dtd | blocked / ACTIVE_CONTENT_BLOCKED | 0/0; existing inert stored recipe |
| 25 | docx-unsupported-drawing | partial / UNSUPPORTED_VISUAL | missing vision component unsupported-visual/index1 + available empty paragraph1 text, part `word/document.xml`; table/row/cell null |
| 26 | vietnamese-docx | complete | paragraph1/body part/table-row-cell null; exact `Xin chào Việt Nam` |
| 27 | hidden-xlsx | complete | Hiện/A1:B1/hidden=false, Ẩn/A1:A1/hidden=true; exact cell JSON, Việt Nam, formula literal1+1/cached2 và hidden value7 |
| 28 | scan-pdf | complete | page1 vision ONLY, PNG288×288/nonblank; không text unit giả |
| 29 | text-pdf | complete | page1 vision + supplementary exact `Crew fixture text`, PNG288×288/nonblank |
| 30 | mixed-pdf | complete | page1 vision+text, page2 vision ONLY; cả2 PNG288×288/nonblank |
| 31 | encrypted-pdf | encrypted / PASSWORD_REQUIRED | 0/0 |
| 32 | corrupt-pdf | corrupt / CORRUPT_DOCUMENT | 0/0 |
| 33 | png | complete | image3×2/box `[0,0,1,1]`, opaque black pixel golden |
| 34 | code | complete | original whole byte span, line1..3; exact `const secret = "literal";\n// Việt Nam\n` |
| 35 | quoted-csv | complete | rows1 và2 riêng, columns1..2; row1 name/value, row2 quoted `a\nb` và raw literal `=1+1`, không tính công thức |
| 36 | macro-docx | blocked / ACTIVE_CONTENT_BLOCKED | 0/0 |
| 37 | formula-missing-xlsx | partial / FORMULA_CACHE_MISSING | available Hiện/A1:A1 raw formula1+1/cached=null; missing calculated-value/index1 tại Hiện/A1; hidden Ẩn/A1:A1 value7 vẫn available |

PDF supplementary golden: transform `[12,0,0,12,10,100]`, box `[10,100,86.688,12]`, width86.688/height12; số từ independent Helvetica AFM character advances ×12/1000 của câu fixture. Numeric tolerance1e-5; keys/type/locator/missing state kiểm exact. Raster page box `[0,0,1,1]`; original rotation0 trừ rotated90. Geometry dựa pagesize144×144 và DPI144 của recipe. PNG reader độc lập kiểm CRC/chunk/IEND, bitdepth8/RGB hoặc RGBA/filter0..4, inflated size đúng geometry, opaque alpha; từ chối text/EXIF/time metadata; pixel/nonblank expectations không lấy hash encoder từ output thực.

XLSX body JSON kiểm toàn bộ schema/cells, ref/type/style/formula/formulaAttrs/value/inline/sharedFormulaSource/raw/cached cùng merged/styles empty của fixture. DOCX kiểm structural part/paragraph thật; không invented pages. Text byte span tính original encoding, derivative literal giữ UTF8. Corpus còn thiếu positive DOCX header/footer/footnote và nhiều Office visual cases; unit tests riêng của Task5 không được ghi thành actual image coverage ở đây.

## Năm diagnostic hiện có, luôn chạy serial trước corpus

| Existing scenario | Wall | Kỳ vọng sau actual closure và exact rm |
|---|---:|---|
| boundary | 10000ms | Exactly11 diagnostic check names đều pass: selected original/read-only, output writable, network denied, foreign host absent, readonly source, no credential/db/workflow env, no Docker socket, no host source, UID65532 và native PNG; container exit0/noOOM |
| pids | 10000ms | Exactly pids-limit/pass, exit0/noOOM; actual HostConfig PidsLimit32 |
| memory | 20000ms | Actual OOMKilled=true, stopped/PID0; no diagnostic JSON, helper WORKER_DIAGNOSTIC_INVALID. Generic crash/parse failure không thay cho OOM proof |
| stdout-bomb | 2000ms | Actual helper WORKER_OUTPUT_LIMIT, closed/noOOM/exact rm |
| timeout | 2000ms | Actual helper WORKER_TIMEOUT, closed/noOOM/exact rm; chỉ kiểm watchdog diagnostic, chưa chứng minh selected parser wall challenge |

Canary/scenario implementation lấy từ existing image/accepted diagnostic, không tạo variant hoặc payload mới. Host-only sentinel phục vụ existing foreign-path check chỉ được tạo khi PM launch recipe được duyệt, không mount sentinel vào worker.

## Launch recipe đang khóa, không chạy trong lượt này

Python mặc định chỉ describe và đối chiếu21 bytes từ frozen snapshot/Git. `--prepare` mới tạo root riêng bằng mkdtemp/nonceUUID, mode0700, owner dev/ino/UID được fsync trước file con, copy readonly/hash từng file; không Node/Docker/PG/parser execution, không deps/link. Exception giữ root cùng preparation-failed receipt. Không có cleanup/prune/TTL command trong script.

Future PM workflow sau review: chạy Python `--prepare`, đọc root/manifest receipt; dùng Node24 `--max-old-space-size=384 <root>/harness.mjs --plan <root>` để ghi static37 originals/challenge/expected plan; băm plan và review artifact cụ thể trước khi cấp launch approval. `--plan` chỉ import frozen config và fixture generator thuần, không production extract/native/parser, không container. Mỗi original hiện có được fsync/read-only; maxCases37 và ordinal fsynced reservation của real corpus helper tính cả retry/replay. Không autorenew challenge hoặc fallback skip.

`--run <root> <approval.json>` yêu cầu external PM approval bind exact planSHA/harnessSHA/rootNonce/image/source/independentReviewSHA, launchApproved=true/soleHeavy=true, expiresAt chưa hết. Hàm này không tạo file approval, không authorize production; chỉ PM quyết định thời điểm slot. Đổi file/image/plan/root/challenge/budget cần review mới. Parent heap384MiB là V8 heap, **không hard RSS cap**. Job37 corpus dùng cùng challenge config mặc định và wall30000ms; diagnostic có wall riêng như bảng. Worker helper thật giữ512MiB memory+swap, CPU1/pids32, readonly/netnone/capdropALL/no-new-privileges, UID65532, output/tmp tmpfs bounded. Không builder/services/dependencies global.

Trước mỗi case/container, parent đo fresh pressure1 hoặc2, available>=4GiB, idle>=50%, disk>=8GiB; available theo `(free+inactive+speculative)*page_size` dùng PM recipe. Admission receipt có timestamp. Gate fail hoặc approval expire dừng, giữ case pending; không chạy vô điều kiện. Giữa case kiểm lại frozen source và Docker binary hash. Parent Node import closure từ owned frozen root; chỉ original input job được bind vào actual candidate image. Gọi actual `prepareWorkerDirectory`, `runExtractorDiagnostic`, `createExtractorCorpusVerifier` và `removeStoppedWorkerContainer`; không fake generic production runner/permit.

Observation theo job có intent trước runner, actual job/generation/ownerNonce/dev/ino/UID, original SHA/length, image/source, attach PID/birth command, actual fullCID/running PID/HostConfig memory-swap-CPU-pids/cgroupns, terminal WorkerResult/file bytes, closed state/PID0/OOM/exit và exact cleanup. Kỳ vọng output chỉ kiểm sau helper settlement, actual stopped/PID0 + owned attach closure và exact non-force rm trong finally. UNKNOWN giữ scratch/reservation/capacity/evidence và dừng mọi case còn lại. Không TTL hay prefix prune. Summary luôn certificate=false/productionPermitCreated=false và giữ allocation/parserWall UNVERIFIED, kể cả cả42 existing observations matched.

## Kiểm tra tĩnh đã thực hiện

- `node --check task-5-corpus-harness.mjs`: exit0 sau sửa cuối; không import/execution harness.
- Python `ast.parse`: syntax valid; không pycache/prepare/launch.
- Python default describe: exit0, đối chiếu21 source/corpus/accepted blob size/SHA và inventory/image receipt; kết quả root=null, staticGitBlobReads5, heavyWorkloadsOrContainersCreated0. Có Git read subprocess thuần; không tuyên bố toàn bộ lượt không có process shell/CLI.
- Chưa chạy `--prepare`, `--plan` hoặc `--run`. Chưa có challenge/corpus-list SHA cụ thể, rootnonce mới, case UUID, output manifest, telemetry per-case hay OS-boundary evidence từ harness này. Syntax/hash checks không thay semantic runtime acceptance.

## Câu hỏi/gate còn lại

1. PM độc lập duyệt bảng golden37 và launch artifact chính xác, sau đó cấp sole-heavy slot và approval cụ thể; hiện chưa được launch.
2. Polling attach `.attach.json`/inspect có thể bỏ lỡ birth/runningPID của diagnostic rất ngắn. Harness dừng fail-closed nếu thiếu; không suy đoán PID/birth. PM cần review khả năng quan sát trước chạy. HostConfig và OOM là actual Docker evidence; chưa đọc trực tiếp Linux cgroup `memory.events`/path, không ghi thành measured cgroup counters.
3. Allocation protection của actual selected parser và selected parser wall challenge **UNVERIFIED/omitted**. Existing diagnostic OOM/timeout không lấp hai gate này, malformed/generic failure không được chấp nhận thành protection PASS. Không application pre-inflate cap claim.
4. Future production admission/certificate thuộc review authority độc lập của PM. Harness này chỉ trả observation để review; không final PASS và không có production authority.

## FIX1 — batch F1–F5 sau independent review tĩnh

Phần trước được giữ nguyên làm lịch sử trước FIX1; các mô tả nonblank-only, cleanup khi thiếu birth và SHA cũ không còn là hành vi cuối. Đã đọc toàn bộ review canonical `task-5-corpus-harness-review.md`,18873B/SHA `c37a7f660a16241d3964c045ec2f46ca62e006b8b26a0660a436f5ef21487bea`. FIX1 chỉ thay hai script và append báo cáo này; không peer source/manifest/index/Git, không children, không payload/canary mới.

| Finding | Sửa trong artifact sở hữu | Kết luận kiểm tra thuần |
|---|---|---|
| F1 P1 | `canonicalOriginals` dựng mime/sha theo đúng thứ tự key của parsed canonical plan; `assertChallengeSerialization` kiểm corpus SHA bằng chính JSON.stringify(parsed originals) và challenge canonical SHA trước lưu plan và trước approval/helper constructor | Actual serialize/parse relation GREEN; old key-order SHA bị từ chối |
| F2 P1 | Phân biệt ps absent xác định (exit1/stdout+stderr empty/no kill/no signal), present có birth+command hợp lệ, unknown mọi timeout/maxBuffer/spawn/tool error. Marker PID positive/nonce/workerId/fullCID phải khớp; birth capture chỉ nhận exact trusted Docker binary start--attach CID. Closure đòi birth witness và definite absent hoặc PID đã reuse với birth khác; cùng birth/khác command là unknown | UNKNOWN không đi vào rm; exact marker và reused PID checks GREEN. Thiếu running witness cũng giữ UNKNOWN_RETAINED trước rm |
| F3 P2 | PDF raster dùng pixel/region/rotation golden độc lập từ recipe hiện có; không còn nonblank-only. Scan interior24..215/72..263 phải blue30/90/180 ±2, exterior ngoài18..221/66..269 white>=250. Text grayscale, white exterior, dark ink trong ba word regions và white word gaps; rotation90 map (287-y,x). Strict typeof number + finite trước numeric tolerance | Mock existing-recipe text/scan/rotated positives GREEN; swapped pages, missing text, wrong color/spatial/rotation đều rejected. Không PNG/PDF mới, không actual renderer oracle |
| F4 P2 | Mọi owned marker/payload/output read dùng full component lstat, root confinement/canonical path, same current UID, private directory0700/file modes0600/0444/0400, no symlink; FD mở O_RDONLY|O_NOFOLLOW, đối chiếu dev/ino/UID/mode với pre-open stat. Owned harness import.meta phải là đúng root/harness.mjs. External approval kiểm hết components + regular NOFOLLOW/same UID/non-group/world-writable | Mock confined-positive và intermediate/receipt symlink, wrong UID/mode/outside-root negatives GREEN; actual filesystem launch chưa chạy |
| F5 P2 | Python fsync parent của mkdtemp root và root trước owner; durable_mkdir sync parent+directory mới; exclusive file sync FD/close rồi directory. Owner entry durable trước subordinate data. Nếu error cả failure receipt ghi không được, vẫn in exact identity/root retained; không prune/delete | Owner write ordering, directory FD flags, source ordering GREEN bằng mocks/static checks |

**Artifact cuối FIX1**: harness36959B/SHA `b40d99dd3f2028204781d16c5dc02bed40aee32a4a4b3d4ecc2da5f457cbb71c`; Python8014B/SHA `15e161fdf2dc1b3703fb57b43885999ecfb041419f63a8f7d35e7a3fcb28e835`. Canonical report hash do PM tính sau append; không tự chứa hash chính nó.

PDF region provenance được tính độc lập từ existing pagesize144×144/DPI144/drawString(10,100)/drawImage(10,10,100,100). AFM advances at scale2: Crew ends75.992; fixture starts82.664/ends148.016; text starts154.688/ends193.376. Golden word regions `[20,68,77,90]`, `[82,68,149,90]`, `[154,68,195,90]`; white gaps x77..80 và150..152. Pure mocks kiểm vùng/trang/orientation, không chứng minh từng hình dạng glyph hoặc actual renderer đã nghiệm thu.

Observer đã bỏ `seenAttach=true` trước ps thành công; còn retry witness trong cùng actual lượt nếu phép quan sát đầu chưa đủ, không tạo case/budget mới. **Short-case observation gap vẫn UNVERIFIED** vì polling không đảm bảo nhận birth/runningPID trước kết thúc. Hiện thiếu witness làm retain exact stopped container/root/evidence và halt; không cleanup dựa lịch sử hoặc lời đoán. Narrow proposal nếu PM cần guarantee: riêng producer ownership transfer cho frozen worker-runner tạo durable lifecycle ACK bind owned ChildProcess reference/PID/argv/nonce/CID và actual close event; running-worker witness cần producer-approved observation/handshake tại launch. Proposal chưa triển khai, không sửa helper/entry/diagnostic, không tự đổi required witness hoặc kéo dài case.

Không có new owned root/nonce/PID/CID; không `--prepare`, `--plan`, `--run`, helper/native/parser/container/PG/model. Allocation và selected-parser wall vẫn UNVERIFIED_OMITTED. Final12 Node pure checks +3 Python mock/static checks +Node syntax/Python AST exit0 chỉ kiểm sửa artifact, không là42 runtime PASS, launch approval hoặc production certificate.

### Raw commands và output FIX1 (evidence inline, không tạo file thứ tư)

Mỗi block là đúng command đã chạy từ worktree; source được import bằng data URL chỉ để gọi pure functions, guard main không khớp URL và không chạy harness modes. RED F2 tái hiện đúng expression fallback cũ; RED F4 kiểm guard vắng trong actual artifact. Python chỉ exec định nghĩa với __name__ khác main và mock OS/paths. Command hashes:
```text
fix1RedNodeCmd 3f7dfa7d5d74c088e9d6c47de588afab716b9fbf80d5cd46d5fd4adafc8c5ea1
fix1RedPyCmd d1f861b3006be722a785ac4650ccb3e1ce99ea34dbc6910e8ddf9952db348ace
fix1GreenNodeCmd 09aeba3f107e217428fbe0d840e70f3122603a4df09026e17a777cb3c9877823
fix1GreenPyCmd 1d50140924599f4abb3356cc82ed1727f00f51c987af14551021362eda034c27
```

**Node RED — exit0**

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const source=fs.readFileSync('plans/261002-0002-crew-v2/execution-phase05/task-5-corpus-harness.mjs','utf8');
const mod=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {canonical,closeEnough};').toString('base64'));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const results=[];
function red(name,fn){try{fn();results.push(name+': UNEXPECTED_GREEN');}catch(e){results.push(name+': RED '+e.message.split('\n')[0]);}}
red('F1 serialized challenge',()=>{const originals=[{sha256:'a'.repeat(64),mime:'text/plain'}]; const plan={challenge:{originals,corpusSha256:sha(JSON.stringify(originals))}}; const parsed=JSON.parse(mod.canonical(plan));assert.equal(parsed.challenge.corpusSha256,sha(JSON.stringify(parsed.challenge.originals)));});
red('F2 ps error UNKNOWN',()=>{const failure={code:'ETIMEDOUT',killed:true,stdout:'',stderr:''}; const captured={stdout:'',exitCode:failure.code}; const before=captured.stdout.trim()===''; assert.equal(before,false);});
red('F3 strict finite number',()=>assert.throws(()=>mod.closeEnough('12',12,'typed numeric golden')));
red('F3 PDF page-specific raster',()=>{for(const name of ['scan-pdf','text-pdf','mixed-pdf','rotated-pdf']) for(const u of mod.GOLDENS[name].units.filter(u=>u.needs==='vision')) assert.ok(u.body.raster,'recipe raster region absent');});
red('F4 owned full-components',()=>assert.ok(source.includes('assertOwnedComponents'),'guard absent from actual artifact'));
console.log(results.join('\n'));
assert.ok(results.every(x=>x.includes(': RED ')));
JS
```

```text
F1 serialized challenge: RED Expected values to be strictly equal:
F2 ps error UNKNOWN: RED Expected values to be strictly equal:
F3 strict finite number: RED Missing expected exception.
F3 PDF page-specific raster: RED recipe raster region absent
F4 owned full-components: RED guard absent from actual artifact
```

**Python RED — exit0**

```sh
python3 <<'PY'
from pathlib import Path
from unittest.mock import Mock
p=Path('plans/261002-0002-crew-v2/execution-phase05/task-5-parent-fixture.py')
ns={'__name__':'pure_static_test'}
exec(compile(p.read_text(),str(p),'exec'),ns)
events=[]
class Parent:
    def mkdir(self,**kw): events.append('mkdir')
class File:
    parent=Parent()
    def __fspath__(self): return 'mock-owner.json'
class Handle:
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def write(self,b): events.append('write')
    def flush(self): events.append('flush')
ns['os']=Mock(O_WRONLY=1,O_CREAT=2,O_EXCL=4,O_NOFOLLOW=8)
ns['os'].open.return_value=7
ns['os'].fdopen.return_value=Handle()
ns['os'].fsync.side_effect=lambda fd:events.append('file-fsync')
ns['os'].close.side_effect=lambda fd:events.append('close')
ns['write_exclusive'](File(),b'owner')
print('F5 RED trace:',events)
assert 'directory-fsync' not in events
print('F5 RED reproduced: owner entry directory not persisted')
PY
```

```text
F5 RED trace: ['mkdir', 'write', 'flush', 'file-fsync', 'close']
F5 RED reproduced: owner entry directory not persisted
```

**Node GREEN final — exit0**

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
const source=fs.readFileSync('plans/261002-0002-crew-v2/execution-phase05/task-5-corpus-harness.mjs','utf8');
const mod=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {canonical};').toString('base64'));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
let count=0;
async function check(name,fn){await fn();count++;console.log('GREEN '+name);}
await check('F1 actual serialized parsed challenge relation',()=>{const originals=mod.canonicalOriginals([{sha256:'a'.repeat(64),mime:'text/plain'}]);const challenge={version:1,originals,corpusSha256:sha(JSON.stringify(originals))};const parsed=mod.assertChallengeSerialization({challenge,challengeSha256:sha(mod.canonical(challenge))});assert.equal(parsed.challenge.corpusSha256,sha(JSON.stringify(parsed.challenge.originals)));assert.deepEqual(Object.keys(parsed.challenge.originals[0]),['mime','sha256']);});
await check('F1 reject old key-order SHA',()=>{const originals=[{sha256:'a'.repeat(64),mime:'text/plain'}],challenge={originals,corpusSha256:sha(JSON.stringify(originals))};assert.throws(()=>mod.assertChallengeSerialization({challenge,challengeSha256:sha(mod.canonical(challenge))}),/SERIALIZED_CORPUS_HASH/);});
const pid=42,command='/trusted/docker start --attach '+'b'.repeat(64),birth={state:'present',pid,birth:'Sat Oct  3 17:00:00 2026',command};
await check('F2 timeout/maxBuffer/spawn/tool errors stay UNKNOWN',()=>{for(const sample of [{code:'ETIMEDOUT',killed:true},{code:'ENOBUFS'},{code:'ENOENT'},{code:2},{code:1,stderr:'permission denied'}]){const probe=mod.classifyPs({stdout:'',stderr:'',...sample},pid);assert.equal(probe.state,'unknown');assert.equal(mod.classifyAttachClosure(probe,birth),'unknown');}});
await check('F2 definite ps absence and exact birth/reuse',()=>{const absent=mod.classifyPs({code:1,stdout:'',stderr:''},pid);assert.equal(mod.classifyAttachClosure(absent,birth),'closed');assert.equal(mod.classifyAttachClosure(absent,null),'unknown');const present=mod.classifyPs({code:0,stderr:'',stdout:birth.birth+' '+command},pid);assert.deepEqual(present,birth);assert.equal(mod.classifyAttachClosure(present,birth),'running');assert.equal(mod.classifyAttachClosure({...present,birth:'Sat Oct  3 17:00:02 2026'},birth),'closed');assert.equal(mod.classifyAttachClosure({...present,command:'unrelated'},birth),'unknown');});
await check('F2 exact attach marker binding',()=>{const owner={nonce:'n'},input={jobId:'j',generation:'1'},cid='b'.repeat(64),marker={pid,nonce:'n',workerId:'crew-v2-extract-j-1',containerId:cid};mod.assertAttachMarker(marker,owner,input,cid);for(const changed of [{pid:0},{nonce:'wrong'},{workerId:'wrong'},{containerId:'c'.repeat(64)}])assert.throws(()=>mod.assertAttachMarker({...marker,...changed},owner,input,cid));});
await check('F3 numeric strings/nonfinite rejected',()=>{mod.closeEnough(12,12,'finite');for(const n of ['12',NaN,Infinity,null])assert.throws(()=>mod.closeEnough(n,12,'finite'));});
const white=[255,255,255],blue=[30,90,180],black=[0,0,0];
const scan=(x,y)=>x>=20&&x<220&&y>=68&&y<268?blue:white;
const text=(x,y)=>y>=70&&y<88&&((x>=22&&x<73)||(x>=84&&x<146)||(x>=157&&x<191))?black:white;
const rotated=(x,y)=>text(y,287-x);
await check('F3 independent existing-recipe region positives',()=>{mod.assertRasterGolden(scan,288,288,{kind:'scan',rotation:0});mod.assertRasterGolden(text,288,288,{kind:'text',rotation:0});mod.assertRasterGolden(rotated,288,288,{kind:'text',rotation:90});});
await check('F3 swapped/missing/color/spatial/orientation negatives',()=>{for(const [pixels,golden] of [[scan,{kind:'text',rotation:0}],[text,{kind:'scan',rotation:0}],[text,{kind:'text',rotation:90}],[(x,y)=>scan(x+12,y),{kind:'scan',rotation:0}],[()=>white,{kind:'text',rotation:0}],[(x,y)=>x<144?blue:white,{kind:'scan',rotation:0}]])assert.throws(()=>mod.assertRasterGolden(pixels,288,288,golden));});
await check('F3 per-page expected raster mapping',()=>{assert.equal(mod.GOLDENS['mixed-pdf'].units.filter(u=>u.needs==='vision')[0].body.raster.kind,'text');assert.equal(mod.GOLDENS['mixed-pdf'].units.filter(u=>u.needs==='vision')[1].body.raster.kind,'scan');assert.equal(mod.GOLDENS['rotated-pdf'].units[0].body.raster.rotation,90);});
const fileInfo=(dir,uid=501,mode=dir?0o700:0o600,symlink=false)=>({uid,mode,dev:1,ino:2,isDirectory:()=>dir,isFile:()=>!dir&&!symlink,isSymbolicLink:()=>symlink});
function io(changed={}){return {lstat:async p=>changed[p]??fileInfo(!p.endsWith('.ts')&&!p.endsWith('.json')),realpath:async p=>p};}
await check('F4 full-component confined positive',()=>mod.assertOwnedComponents('/owned','/owned/v2/server/src/leaf.ts',io(),501));
await check('F4 intermediate/receipt symlink rejection',async()=>{for(const path of ['/owned/v2/server/src','/owned/owner.json'])await assert.rejects(()=>mod.assertOwnedComponents('/owned',path.endsWith('.json')?path:'/owned/v2/server/src/leaf.ts',io({[path]:fileInfo(false,501,0o600,true)}),501),/OWNED_SYMLINK_COMPONENT/);});
await check('F4 UID/mode/root escape rejection',async()=>{await assert.rejects(()=>mod.assertOwnedComponents('/owned','/outside/file.ts',io(),501),/OWNED_PATH_ESCAPE/);await assert.rejects(()=>mod.assertOwnedComponents('/owned','/owned/file.ts',io({'/owned/file.ts':fileInfo(false,502)}),501),/OWNED_COMPONENT_UID/);await assert.rejects(()=>mod.assertOwnedComponents('/owned','/owned/file.ts',io({'/owned/file.ts':fileInfo(false,501,0o666)}),501),/OWNED_FILE_MODE/);});
console.log('STATIC_ONLY '+count+' bounded pure GREEN checks; no fixture/parser/native/helper/prepare/plan/run/container');
JS
```

```text
GREEN F1 actual serialized parsed challenge relation
GREEN F1 reject old key-order SHA
GREEN F2 timeout/maxBuffer/spawn/tool errors stay UNKNOWN
GREEN F2 definite ps absence and exact birth/reuse
GREEN F2 exact attach marker binding
GREEN F3 numeric strings/nonfinite rejected
GREEN F3 independent existing-recipe region positives
GREEN F3 swapped/missing/color/spatial/orientation negatives
GREEN F3 per-page expected raster mapping
GREEN F4 full-component confined positive
GREEN F4 intermediate/receipt symlink rejection
GREEN F4 UID/mode/root escape rejection
STATIC_ONLY 12 bounded pure GREEN checks; no fixture/parser/native/helper/prepare/plan/run/container
```

**Python GREEN final — exit0**

```sh
python3 <<'PY'
from pathlib import Path
from unittest.mock import Mock
p=Path('plans/261002-0002-crew-v2/execution-phase05/task-5-parent-fixture.py')
ns={'__name__':'pure_static_test'}
exec(compile(p.read_text(),str(p),'exec'),ns)
events=[]
class Parent: pass
class File:
    parent=Parent()
    def __fspath__(self): return 'mock-owner.json'
class Handle:
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def write(self,b): events.append('write')
    def flush(self): events.append('flush')
ns['os']=Mock(O_WRONLY=1,O_CREAT=2,O_EXCL=4,O_NOFOLLOW=8,O_RDONLY=16,O_DIRECTORY=32)
ns['os'].open.return_value=7
ns['os'].fdopen.return_value=Handle()
ns['os'].fsync.side_effect=lambda fd:events.append('file-fsync')
ns['os'].close.side_effect=lambda fd:events.append('close')
ns['durable_mkdir']=lambda parent:events.append('durable-mkdir')
original_sync=ns['sync_directory']
ns['sync_directory']=lambda parent:events.append('directory-fsync')
ns['write_exclusive'](File(),b'owner')
assert events==['durable-mkdir','write','flush','file-fsync','close','directory-fsync'],events
print('GREEN F5 exclusive owner write trace:',events)
events.clear()
original_sync(Parent())
assert events==['file-fsync','close']
assert ns['os'].open.call_args.args[1]==16|32|8
print('GREEN F5 directory FD O_RDONLY|O_DIRECTORY|O_NOFOLLOW fsync then close')
source=p.read_text()
start=source.index('    try:\n        os.chmod(root')
owner=source.index("write_exclusive(root / 'owner.json'",start)
payload=source.index('for path, data, entry in payloads:',owner)
assert start<source.index('sync_directory(root.parent)',start)<source.index('sync_directory(root)',start)<owner<payload
print('GREEN F5 parent/root entries durable before owner and subordinate data')
print('STATIC_ONLY 3 bounded Python mock/static GREEN checks; no root/files created')
PY
```

```text
GREEN F5 exclusive owner write trace: ['durable-mkdir', 'write', 'flush', 'file-fsync', 'close', 'directory-fsync']
GREEN F5 directory FD O_RDONLY|O_DIRECTORY|O_NOFOLLOW fsync then close
GREEN F5 parent/root entries durable before owner and subordinate data
STATIC_ONLY 3 bounded Python mock/static GREEN checks; no root/files created
```

Final syntax commands:
```sh
node --check plans/261002-0002-crew-v2/execution-phase05/task-5-corpus-harness.mjs
python3 -c 'import ast; from pathlib import Path; ast.parse(Path("plans/261002-0002-crew-v2/execution-phase05/task-5-parent-fixture.py").read_text()); print("Python AST GREEN")'
```
Output: Node exit0/no stdout; Python exit0/`Python AST GREEN`. Không pycache/fixture/root được tạo.

Remaining gates: PM independent re-review of FIX1; short-case lifecycle witnesses vẫn UNVERIFIED/fail-closed; actual42 boundary/corpus chưa chạy; allocation/parser-wall omitted; direct Linux memory.events/cgroup path và production authority chưa kiểm chứng.

Evidence output hashes (đúng stdout UTF8 gồm trailing newline; exit0 từng record). Bundle băm canonical sorted-key compact UTF8 array gồm name/command/output/exit/sourceSha256 của bốn record trên; không thể thay command/output/source mà giữ SHA:

```text
Node RED outputSHA256=2e90e4fadb8ab2144cf0d55c5b2b5fd0a44992a4c81f9f239cde58ec2b02d8f0
Python RED outputSHA256=83339fee94c453d5f164642ee38b91676dd569ecf1a8f4fb1984d6c3be15a3db
Node GREEN final outputSHA256=491c1775676fe8ddf97a8192a7a04fa4495246b9441641bcabe4db814d26cb7e
Python GREEN final outputSHA256=7bd1b83d0a66a3782b2ed18e0e880bbbcbd700d60037c57cd3100a3e3d805b6c
canonicalEvidenceBundleSHA256=a3b46c9a5e8bb4c027edc91369d91a6c0bc44ce1f22fb84ea8e294260a63ddf4
```
