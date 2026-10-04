# Trích xuất attachment trong worker có giới hạn

## Mục đích

Giữ original bất biến, trích xuất ngoài tiến trình HTTP và kiểm chứng bytes derivative ở parent. Boundary kỹ thuật và corpus parser có gate riêng. Task4 cung cấp protocol, job fencing và diagnostic; Task5 cung cấp bounded parsers và CLI extract private. `ExtractorRunner.start` mặc định trả `PRODUCTION_CORPUS_REQUIRED` khi thiếu trusted authority từ evidence đã review; corpus pre-cert không tự cấp chứng nhận production.

## Điểm vào

- `server/src/attachments/jobs.ts` → `createExtractionJobs`: factory nội bộ nhận DB, BlobStore, runner và config/root tin cậy. Entry `processExtraction` cũ từ chối `EXTRACTION_CONFIG_REQUIRED`; không đọc root từ môi trường hay registry toàn cục.
- `server/src/attachments/worker-runner.ts` → `runExtractorDiagnostic`: chạy đúng image local immutable bằng helper container chung; `createDockerExtractorRunner` kiểm config và cấp inspect/stop/result với identity exact.
- `server/src/attachments/worker-entry.ts` → CLI: đọc request và original chỉ đọc, kiểm hash và giới hạn 25 MiB, chọn mode từ argv của parent. `WorkerInput.original` không có byteLength; parent kiểm length DB khi copy, entry kiểm hash độc lập.

## Các bước

1. `jobs.ts` → `createExtractionJobs`: chụp config/limits bất biến, chỉ capacity1. `process` khóa admission advisory và extraction/upload trong SQL009, yêu cầu ready/durable/once-linked original và đúng accepted config hash. Config cũ không có projection tương ứng trả `CONFIG_NOT_AVAILABLE`; không tái dựng bằng giới hạn mới.
2. `jobs.ts` → `process`: ghi generation, deterministic worker name và lease trước bytes/spawn. `worker-runner.ts` → `prepareWorkerDirectory` tạo private job scratch độc quyền với nonce/dev/ino/UID; jobs ghi GC journal trước stage bytes. Original được đọc từ actual BlobStore, đếm/băm toàn bộ và copy riêng; chỉ thư mục input của lượt này có mode0755 và file0444 cho UID65532 trong bind chỉ đọc.
3. `worker-runner.ts` → `spawnWorkerContainer`: fsync start intent gồm nonce/name/image/source và đường dẫn/hash binary Docker trước create. Không dùng shell, request CLI override, writable host mount hoặc `--rm`. Container networknone, rootfs readonly, capdropALL, no-new-privileges, UID65532, RAM+swap512MiB, CPU1, pids32, tmpfs/tmp16MiB và/output100MiB. `--log-driver=none` chặn daemon spool stdout/stderr; attach vẫn chuyển framed bytes cho parent. Inspect chỉ nhận exact ID/name/nonce/source/image; thiếu hoặc mismatch giữ unknown. State created chưa chứng minh đã dừng vì attach có thể start trễ.
4. `worker-protocol.ts` → `readWorkerFrames`, `validateWorkerResult`: file-start/chunk/end/result, chunk decoded tối đa64KiB, line thường128KiB, terminal8MiB, output100MiB, units100000 và files10000. Tạo stage exclusive/nofollow; băm/đếm bytes thực, đối chiếu terminal, generation/original/job/config/extractor, filename, MIME/modality và unit coverage. Missing/truncated/duplicate/path/hash/size sai không publish; code vấn đề allowlist, message cố định tiếng Việt.
5. `jobs.ts` → `process`: optional `runPublication` được controller chụp vào factory, nhận original/extraction/generation bất biến và bọc nguyên CAS cuối. Composition cấp input cho claim phải dùng wrapper đã review; fallback `db.begin` chỉ giữ port diagnostic/protocol độc lập, không chứng nhận linearization snapshot. `references.ts` → `createAttachmentPublication` khóa trực tiếp `event_cursor` trước scope (background không giả actor owner/consent) rồi khóa root/ticket/project/message/input trước extraction; publication cùng transaction tăng một revision mỗi target có live ref và descendant bị ảnh hưởng bởi ancestry, thu hồi grant/session cũ và phát event metadata tới audience grant. Rollback publication cũng rollback counter. Controller chưa nối production.

   Terminal hợp lệ và actual container stopped trước đọc output và publish qua BlobStore/fsync. Kiểm generation/worker trước từng file và trong transaction cuối; rollback hoặc stale sau publication giữ owned orphan cho Task7. Không xóa file có thể đã được ref. Manifest dùng canonical JSON; verified là kiểm kỹ thuật, không chứng minh model hiểu nội dung.
6. `jobs.ts`, `worker-runner.ts`: lease hết hạn không là stop proof. Retry cần cả container stopped và private publisher closed ACK của generation cũ; thiếu ACK trả `WORKER_PUBLISHER_UNKNOWN`, không cấp generation mới. ACK chỉ sau pending result và mọi FD/work settle. Native recovery của publisher bị chết mà chưa ACK thuộc Task7 và vẫn mặc định từ chối. Timeout/overflow gửi stop rồi inspect; unknown giữ lease/resource/intent và không cleanup hay replacement. Chỉ sau exact container stopped mới đóng pipes và dừng chính Docker attach CLI do parent spawn, rồi await actual client closure; giữ lỗi overflow đầu tiên thay vì để watchdog sau đó ghi đè.
7. `worker-diagnostic.ts` → `diagnosticMain`: selected original đọc được, output riêng ghi được, rồi kiểm network/foreign host/source/original/credential-env/socket/UID/native PNG. Các lượt riêng kiểm pids, cgroup memory, stdout bomb và timeout. DiagnosticReport không phải WorkerResult và không cấp corpus PASS. `removeStoppedWorkerContainer` ghi reconciliation receipt rồi chỉ rm exact stopped ID; caller giữ scratch khi stop unknown.

### Parser và provenance Task5

`extract/index.ts` phân loại bằng chữ ký bytes và chuyển cho parser theo định dạng. Text UTF8/UTF16 fatal giữ byte span/dòng và escape control; CSV RFC4180 giữ literal công thức, quoted newline và dải row/column. `zip.ts` kiểm toàn bộ central/local paths, offsets, overlap, encryption/method/Unix attrs và CRC trước khi dùng yauzl stream; đếm expanded bytes thực và compression ratio. `xml.ts` dùng saxes public API có kiểm runtime, namespace URI, từ chối DTD/entity và áp giới hạn depth/text. Facade saxes tách lỗi declaration generic TS7 của bản6.0.0; không sửa dependency hay bật skipLibCheck.

`image.ts` kiểm dimension và cấu trúc PNG/CRC/IEND trước native load, tạo PNG sạch metadata, ghi EXIF transform nếu ảnh xoay/lật. `pdf.ts` luôn render vision cho từng trang144DPI theo crop/rotation; text là supplementary, có tọa độ. Password → encrypted. Public parsed object graph của pdf-lib kiểm action, decoded names, reference, graph/depth và retained stream Length/filter trước phát trang; JavaScript/Launch/embedded executable → blocked. XFA/collection/embedded tài liệu → missing/partial; parse ambiguity/unsupported stream không complete. Object-stream inflation xảy ra trong parser và chịu hard memory/wall worker boundary, không có pre-inflate application byte counter trong public API. Không tải URL hoặc chạy script.

`docx.ts` dùng part+paragraph/table/row/cell thực, gồm header/footer/footnote/endnote/comment, giữ nhãn insert/delete. Drawing chưa hỗ trợ và external resource có paragraph thật tạo missing coverage; hyperlink chỉ lấy chữ. Body-level altChunk/external chưa có paragraph thật trả unsupported/zero available; không dùng paragraph0 làm part-root giả. `xlsx.ts` đọc hidden/veryHidden, raw/cached/formula/style/merged/comments và ảnh nội bộ theo cell anchor thực; shared formula giữ base source để tham chiếu, không tính lại công thức. Workbook-level pivot/externalLinks không có anchor thật trả unsupported; ZIP/XML limit trước anchor trả failed/LIMIT_EXCEEDED, không tạo locator giả. Component tùy chọn trên DOCX/sheet phân biệt ảnh, calculated-value, comment, external và visual chưa hỗ trợ trong cùng nguồn; protocol vẫn nhận locator v1 cũ và kiểm các key/index mới chặt chẽ. EXIF transform chỉ là presentation metadata, không tạo nguồn mới để né kiểm duplicate.

`verify.ts` tạo hash/byte count từ derivative bytes, kiểm modality, coverage, tên tương đối, duplicate origin/component và metadata bounds. `complete` chỉ nói trích xuất đủ các phần parser nhận diện, không nói model hiểu hoặc đã đọc. Native memory/CPU/wall gate phải được chứng minh bằng actual worker, unit corpus không tự cấp chứng nhận.

CLI `extract` gọi `extractToFrames`, phát file-start/chunk/end với chunk64KiB và terminal WorkerResult. `createExtractorCorpusVerifier` chỉ phục vụ challenge riêng đã bind immutable image/source/original list/config/budget, ghi reservation fsync exclusive, chạy cùng private sandbox helper và xác nhận actual container/attach closure. Hàm trả kết quả để PM đối chiếu golden, không publish job hoặc ghi corpus PASS. `createDockerExtractorRunner(config, authority?)` default deny khi thiếu trusted local ProductionExtractorAuthority. Authority phải kiểm evidence đã review độc lập và trả permit bind exact image/source/parent runner SHA/policy SHA/toàn bộ WorkerConfig SHA, cùng lock/native/boundary/corpus evidence. Runner lưu permit trước spawn, active tối đa1; missing/changed binding hoặc UNKNOWN không được admit. Corpus helper không tạo authority; diagnostic vẫn tách khỏi corpus.

## Files

| Đường dẫn từ `v2/` | Vai trò và symbol |
|---|---|
| `server/src/attachments/jobs.ts` | Job admission/CAS/config, `createExtractionJobs`, entry cũ default deny |
| `server/src/attachments/worker-runner.ts` | Owned intent, Docker controls, diagnostic, inspect/stop/reconciliation |
| `server/src/attachments/worker-protocol.ts` | WorkerInput, bounded frames và parent result validation |
| `server/src/attachments/worker-entry.ts` | CLI request/original hash và mode gate |
| `server/src/attachments/worker-diagnostic.ts` | Canaries độc lập parser, không import Task5 |
| `server/extractor.Dockerfile` | Linux glibc Node24.14 pinned digest, private pnpm prefix, frozen scripts-disabled install/native probe |
| `server/extractor.dockerignore` | Loại host dependencies/env/storage/cache/workspace files khỏi context |
| `server/test/attachments-worker.test.ts` | Pure protocol/filesystem và actual private PostgreSQL009 CAS/config/fencing |
| `server/test/attachments-worker-live.test.ts` | Opt-in target-image canaries và closure receipts |
| `server/src/attachments/extract/index.ts` | Typed dispatch, bounded result và progressive frames |
| `server/src/attachments/extract/formats.ts` | Byte signatures và finite encrypted OLE directory |
| `server/src/attachments/extract/zip.ts` | Strict OOXML ZIP paths/offset/CRC/actual stream budget |
| `server/src/attachments/extract/xml.ts` | Checked saxes facade, namespace events và XML budgets |
| `server/src/attachments/extract/text.ts` | Fatal UTF decoding, byte spans và missing tail |
| `server/src/attachments/extract/csv.ts` | RFC4180 literal cells và grouped range units |
| `server/src/attachments/extract/image.ts` | Pre-decode dimensions/PNG structure, normalized PNG và EXIF provenance |
| `server/src/attachments/extract/pdf.ts` | Parsed action guard, page vision và supplementary text |
| `server/src/attachments/extract/docx.ts` | Actual part/paragraph/table/component locators |
| `server/src/attachments/extract/xlsx.ts` | Hidden sheets, literal cached/shared formula, comments/anchored images |
| `server/src/attachments/extract/verify.ts` | Independent byte manifests, coverage và metadata validation |
| `server/src/attachments/extract/yauzl.d.ts` | Narrow public yauzl runtime declarations |
| `server/test/attachments-formats.unit.test.ts` | Task5 deterministic parser/provenance regressions |
| `server/test/attachments-text-csv.unit.test.ts` | Task5 deterministic parser/provenance regressions |
| `server/test/attachments-pdf-image.unit.test.ts` | Task5 deterministic parser/provenance regressions |
| `server/test/attachments-ooxml.unit.test.ts` | Task5 deterministic parser/provenance regressions |
| `server/test/fixtures/attachments/make-fixtures.ts` | Deterministic corpus37 cases, independent ZIP/PNG generators |

## Dữ liệu

SQL009 `attachment_extractions`, `attachment_derivatives`, `attachment_gc` giữ immutable identity/config/manifest và generation. Job scratch `jobs/<uuid>/<generation>` có `.owner.json`, `.publisher.intent.json`, `.publisher.closed.json`, `.start-intent.json`, `.container.json`, `.attach.json`, diagnostic/reconciliation receipts. DB chỉ lưu key tương đối. Raw stderr bị discard và cap64KiB; public lỗi dùng code cố định. Unknown không suy quyền xóa từ TTL/tên đường dẫn.

Build context do PM tạo từ whitelist source hash, audited package và Linux frozen lock; không copy Darwin dependencies. Dockerfile ghim `node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8`, target Linuxamd64/glibc. Arm64 cần receipt riêng. Không thay builder/binfmt/global host settings. Diagnostic receipt luôn corpusunverified; production image tương lai phải rebuild cùng full parser corpus và boundary rồi review.

## Flow liên quan

`server-attachments` cấp actual BlobStore/config/contracts và migration009; `server-platform` cấp DB fixture và migration checksums. Task2/3 không được import khi chưa nghiệm thu. Task5 cấp parser/provenance và final corpus receipt; Task7 cấp native crash/recovery, orphan reconciliation và cleanup. Host composition/supervisor thuộc controller/phase09; chưa nối production trong Task4.

## Tests

Pure: `node --test server/test/attachments-worker.test.ts` từ `v2/` (DB cases skip nếu chưa có fixture). Actual private PG: `pnpm --dir v2/server test --test-file <absolute attachments-worker.test.ts>` từ repo root. Tests dùng raw SQL009 fixture submitted inbox, actual BlobStore và controlled fake runner cho DB protocol; fake không cấp isolation certificate. Không dùng active Task2b hoặc shared attachments support.

Live: `CREW_V2_EXTRACTOR_LIVE_TEST=1 CREW_V2_EXTRACTOR_BUILD_RECEIPT_PATH=<PM absolute receipt.json> node --test v2/server/test/attachments-worker-live.test.ts`. Helper đọc target receipt/image identity, tạo receipt trước own scratch/container, giữ nonce/dev/ino/UID, await actual stopped/attach closure trước rm, unknown giữ lại. Thiếu Docker/image/receipt là unverified, không fallback sang HTTP parser. Kết quả từng gate và source/evidence hashes nằm report Task4; targeted pass không thay full frozen covering, strict types, Biome và review độc lập.

Task5 pure target-Linux: từ server cwd, `node --test --test-concurrency=1 --test-name-pattern=attachment test/attachments-formats.unit.test.ts test/attachments-text-csv.unit.test.ts test/attachments-pdf-image.unit.test.ts test/attachments-ooxml.unit.test.ts`. Final code76/76, strict và scoped Biome receipts nằm Task5 report; actual candidate image boundary/corpus và independent review còn là gate riêng.

### Whitelist image candidate Task5

Dockerfile chỉ COPY16 file của worker import closure: entry/diagnostic/protocol/storage và12 file extract được liệt kê cụ thể; không COPY toàn thư mục attachment chứa services/server. Runtime type-only imports không kéo contracts/config hoặc database vào image. Context do PM hash từ frozen parser bytes cùng accepted storage/diagnostic, package và target Linux lock đã audit; không lấy source khác từ working tree. Candidate dùng đường dẫn `/extractor` thật để diagnostic kiểm đúng file entry hiện hữu. Chưa có production certificate từ bước chuẩn bị context; actual native/import probes, boundary, corpus và review độc lập vẫn bắt buộc.
