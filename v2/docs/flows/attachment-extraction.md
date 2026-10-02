# Trích xuất attachment trong worker có giới hạn

## Mục đích

Giữ original bất biến, trích xuất ngoài tiến trình HTTP và kiểm chứng bytes derivative ở parent. Boundary kỹ thuật và corpus parser có gate riêng. Task4 cung cấp protocol, job fencing và diagnostic; chưa có parser Task5 hoặc chứng nhận production, nên `ExtractorRunner.start` và CLI mode `extract` mặc định trả `PRODUCTION_CORPUS_REQUIRED`.

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
6. `jobs.ts`, `worker-runner.ts`: lease hết hạn không là stop proof. Retry cần cả container stopped và private publisher closed ACK của generation cũ; thiếu ACK trả `WORKER_PUBLISHER_UNKNOWN`, không cấp generation mới. ACK chỉ sau pending result và mọi FD/work settle. Native recovery của publisher bị chết mà chưa ACK thuộc Task7 và vẫn mặc định từ chối. Timeout/overflow gửi stop rồi inspect; unknown giữ lease/resource/intent và không cleanup hay replacement. Chỉ sau exact container stopped mới đóng pipes và dừng chính Docker attach CLI do parent spawn, rồi await actual client closure; giữ lỗi overflow đầu tiên thay vì để watchdog sau đó ghi đè.
7. `worker-diagnostic.ts` → `diagnosticMain`: selected original đọc được, output riêng ghi được, rồi kiểm network/foreign host/source/original/credential-env/socket/UID/native PNG. Các lượt riêng kiểm pids, cgroup memory, stdout bomb và timeout. DiagnosticReport không phải WorkerResult và không cấp corpus PASS. `removeStoppedWorkerContainer` ghi reconciliation receipt rồi chỉ rm exact stopped ID; caller giữ scratch khi stop unknown.

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

## Dữ liệu

SQL009 `attachment_extractions`, `attachment_derivatives`, `attachment_gc` giữ immutable identity/config/manifest và generation. Job scratch `jobs/<uuid>/<generation>` có `.owner.json`, `.publisher.intent.json`, `.publisher.closed.json`, `.start-intent.json`, `.container.json`, `.attach.json`, diagnostic/reconciliation receipts. DB chỉ lưu key tương đối. Raw stderr bị discard và cap64KiB; public lỗi dùng code cố định. Unknown không suy quyền xóa từ TTL/tên đường dẫn.

Build context do PM tạo từ whitelist source hash, audited package và Linux frozen lock; không copy Darwin dependencies. Dockerfile ghim `node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8`, target Linuxamd64/glibc. Arm64 cần receipt riêng. Không thay builder/binfmt/global host settings. Diagnostic receipt luôn corpusunverified; production image tương lai phải rebuild cùng full parser corpus và boundary rồi review.

## Flow liên quan

`server-attachments` cấp actual BlobStore/config/contracts và migration009; `server-platform` cấp DB fixture và migration checksums. Task2/3 không được import khi chưa nghiệm thu. Task5 cấp parser/provenance và final corpus receipt; Task7 cấp native crash/recovery, orphan reconciliation và cleanup. Host composition/supervisor thuộc controller/phase09; chưa nối production trong Task4.

## Tests

Pure: `node --test server/test/attachments-worker.test.ts` từ `v2/` (DB cases skip nếu chưa có fixture). Actual private PG: `pnpm --dir v2/server test --test-file <absolute attachments-worker.test.ts>` từ repo root. Tests dùng raw SQL009 fixture submitted inbox, actual BlobStore và controlled fake runner cho DB protocol; fake không cấp isolation certificate. Không dùng active Task2b hoặc shared attachments support.

Live: `CREW_V2_EXTRACTOR_LIVE_TEST=1 CREW_V2_EXTRACTOR_BUILD_RECEIPT_PATH=<PM absolute receipt.json> node --test v2/server/test/attachments-worker-live.test.ts`. Helper đọc target receipt/image identity, tạo receipt trước own scratch/container, giữ nonce/dev/ino/UID, await actual stopped/attach closure trước rm, unknown giữ lại. Thiếu Docker/image/receipt là unverified, không fallback sang HTTP parser. Kết quả từng gate và source/evidence hashes nằm report Task4; targeted pass không thay full frozen covering, strict types, Biome và review độc lập.
