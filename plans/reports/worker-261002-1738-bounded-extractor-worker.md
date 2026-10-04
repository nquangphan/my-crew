# Task4 — Bounded extractor-worker boundary

Phạm vi triển khai: đúng chín file source/test/Docker Task4 và flow mới `v2/docs/flows/attachment-extraction.md`. Không Git/index/package/lock/shared support/schema/host edits; không Task2b import, không parser Task5, không paid model hoặc shared DB. PM quản lý Linux lock, context, image và mapping/commit/review. Candidate cần review độc lập SPEC+QUALITY; báo cáo này không cấp nghiệm thu production.

## Kết quả

- WorkerInput/Result version1; identity/generation/original/config/extractor và coverage được kiểm trước publication. Bounded frames64KiB decoded/128KiB line/8MiB terminal/100MiB output; file paths exclusive/nofollow, parent hash/size/mime/unit verification. Canonical locator identity không phụ thuộc thứ tự JSON key; problem codes allowlist và message tiếng Việt cố định.
- Factory `createExtractionJobs({db,runner,store,config,now})` đã được PM cho phép để bổ sung trusted root/config bị thiếu trong signature kế hoạch. Entry `processExtraction` mặc định từ chối `EXTRACTION_CONFIG_REQUIRED`; config SHA cũ thiếu projection tương ứng trả `CONFIG_NOT_AVAILABLE`; capacity1. SQL009 admission/name/generation/lease trước bytes; GC intent trước scratch bytes, actual BlobStore publication/fsync và final CAS. Rollback/stale giữ orphan cho Task7.
- Durable private nonce/dev/ino/UID start intent, Docker binary realpath+hash, exact local image/name/source/nonce/ID. CREATED không là STOP; lease expiry không là stop proof. Retry cần parent publisher closed ACK và worker stopped; thiếu/native crash proof giữ `WORKER_PUBLISHER_UNKNOWN` cho Task7, không replacement. Closed ACK sau all FD/work/pending-result settle.
- SAME private Docker helper: networknone/readonly/capdropALL/nnp/UID65532/512MiB RAM+swap/CPU1/pids32/tmpfs16+100MiB/readonly own input. PM chấp thuận thêm `--log-driver=none` để chặn daemon spool. Sau container stopped mới đóng own attach pipes và signal chính client được spawn rồi await actual close; unknown giữ resource. Không writable host mount hoặc `--rm`.
- Diagnostic độc lập Task5; actual selected original/read and private-output/write, foreign/network/source/original/env/socket/nonroot/nativePNG, pids/memory/stdout/timeout. Parser extract mặc định `PRODUCTION_CORPUS_REQUIRED` cả runner và CLI; diagnostic không trả WorkerResult/corpus PASS.

## Verification riêng từng gate

| Gate | Kết quả đã quan sát |
|---|---|
| Final Task4 focused frozen PostgreSQL + pure | exit0;18 tests,18PASS,0FAIL,0SKIP; `task-4-targeted-final.log` |
| Strict TypeScript frozen703b922+exactTask4 overlays | exit0; original strict tsconfig, no `any`/skipLibCheck, không peer source fallback |
| Biome final | exit0;7 own TS files, no fixes/errors/warnings |
| Target Linuxamd64/glibc Docker build | PM exit0; Node24.14 pinned base/native canvas PNG probe, frozen lock audited; actual image `sha256:8df553bd040016ddf36a547d32d0e7d4986bfc54f60e0355a21e9c28462316a0`, tree `bc04c6013acce13533f7e6c179aa9eeae53b643f23358c437777a691f31b5b38` |
| Actual final diagnostic | exit0;1 test với5 sequential canaries, required11 boundary checks và pids check PASS, actual memory OOMKilled=true/exit137, stdout WORKER_OUTPUT_LIMIT/exit137, timeout WORKER_TIMEOUT/exit137; every containerPid0/loggingnone/exactID removed và own root removed; `task-4-live-final.log` giữ checks/evidence hashes |
| Historical broad frozen server covering | exit1;293 tests,289PASS,1FAIL,3SKIP. FAIL duy nhất: `attachment staging Linux native receiver uses actual private PostgreSQL and replays terminal ACK` — frozen native mount thiếu ordinary postgres dependency. Không báo toàn293PASS. `task-4-frozen-cover-9c0308d2.log` |
| Exact whole native case after fixture dependency repair | exit0;1PASS/1. PM cho phép launcher test-only với same original controls/image/native entry, readonly ancestor dependency resolution và frozen relative imports; không runtime isolation certificate. `task-4-native-repair-fix1.log` + wrapper log. Không cộng thành union293PASS |

Broad covering chạy trước attach/log-driver final changes; final scoped18 tests, strict types, Biome và5 canaries chạy sau final source mutation. Mutable all-server typecheck từng fail ở active messages/submissions và their tests; không sửa peer, không dùng mutable PASS thay cho frozen gate.

TDD observed RED: protocol initial3 assertions; owned-directory/default extract2; factory/default-root/config/CAS/stale/unknown4; missing publisher closure; unterminated line cap; fixed problem copy/allowlist; key-order duplicate locator; CREATED late-start handling. Corresponding focused GREEN observed. Controlled CLI/fake runner tests chỉ chứng minh protocol, không cấp Docker certificate.

## Failures giữ nguyên

1. Initial missing modules và NOT_IMPLEMENTED assertions xuất hiện trước implementation; terminal transcripts giữ RED.
2. Fixture draft truyền Promise vào node:test callback và GC upload row trước FK gây async-activity error; sửa fixture callback/defer cùng FK order, rerun meaningful4RED rồi GREEN. Không dùng draft false PASS.
3. Host Python3 không hỗ trợ tar `extractall(filter=...)`; giữ owner scratch, validate every member nonlink/nonabsolute/no traversal rồi reuse exact owner root. Không nguồn fallback.
4. Historical broad native dependency mount FAIL giữ nguyên; exact native whole case được chạy lại bằng wrapper đã cho phép. Lần wrapper đầu dùng sai supplied nonce SHA bị chặn trước native create (`task-4-native-repair.log`); sửa SHA khớp owner rồi PASS.
5. Initial actual stdout canary trả TIMEOUT thay OUTPUT_LIMIT vì attach backpressure/closure và late watchdog masking (`task-4-live-20074d30.log`). Sửa own client closure chỉ sau exact stopped proof + giữ first overflow; FIX1 tất cả5PASS. Sau approved log-drivernone và required check-set guard chạy final5PASS, không xóa failure hay reuse source/image receipt cũ.

## Freeze và cleanup

`execution-phase05/task-4-final-manifest.json` liệt kê toàn bộ source/evidence SHA256 và bytes, precise verification gates và ownership receipt. Final runner SHA `5080d8182fbd59e984f6e7856cf063a147221308fda5fe1f0de1a99f51f0cf48`; protocol `836615d455854469acc8280c3d66e97adff1b190df7a2ece234e101b1d156aa5`. Runtime image files/types/Docker hashes nằm manifest và PM context audit; old image build có receipt historical riêng, không dùng cho final candidate.

Owned verification scratch nonce043539d1-a6b6-4aa0-9193-bb3bffffeb83/dev16777229/ino64003020/UID501 đã xóa sau all sessions/PG/native/live đóng và đối chiếu owner. All own live fixture roots + exact containers được close/inspect Pid0/remove; unknown thực tế không có ở cuối. PM image/context giữ riêng cho review, PM chịu trách nhiệm cleanup; worker không xóa resource của PM. Logs/manifests/reports giữ làm bằng chứng. No Git/package/manifests/shared-support mutation.

## Còn mở

- Review độc lập SPEC+QUALITY, PM R2/R3 mapping/generated docs/candidate commit chưa do worker thực hiện.
- Task5 parser/final production corpus receipt và integration enable chưa có; production vẫn từ chối.
- Publisher crash không closed ACK/native cross-process recovery thuộc Task7; hiện explicit default deny, không giả lease/stop/cleanup.
- Full historical covering có1 environment FAIL và riêng repaired exact case PASS; không phải một run toàn suite PASS.
