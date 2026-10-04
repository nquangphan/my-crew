# Code Review Summary — Phase05 Task4

## Scope

- Review độc lập SPEC + QUALITY: base `f6ca0a4`, candidate `b670d82`; đúng 16 file, **2.487 additions / 1 deletion**. Không review lại consumer Task2b/Task3, không sửa source/Git/config.
- Own source: `v2/server/src/attachments/{jobs,worker-runner,worker-protocol,worker-entry,worker-diagnostic}.ts`; `extractor.Dockerfile`, `extractor.dockerignore`; `test/{attachments-worker,attachments-worker-live}.test.ts`; `v2/docs/flows/attachment-extraction.md`.
- PM producer: `v2/server/{package.json,pnpm-lock.yaml}`, `v2/docs/{flows.yaml,files.md,index.md}`, `v2/docs/flows/server-platform.md`.
- Đọc brief, approved phase05-r2/global/Task4, worker report, source thực tế và Task1 BlobStore/config/SQL009; đối chiếu producer receipts và logs. Không có plan mutation.
- Không có `.codegraph` ở worktree. Skill `scout`/`code-review` không có trong catalog và các skill/plugin roots đã tìm; áp dụng trực tiếp protocol được giao. Không spawn reviewer khác. Edge-case scout qua data flow trước kết luận: retry sau lease expiry; unknown/created container; publisher còn pending sau timeout; stale generation ở publication; malformed frames/path/symlink/hash/coverage; image/context drift; cleanup sau failure.

## Overall Assessment

**SPEC: READY cho đúng Task4 boundary/diagnostic, với production tiếp tục disabled.**

**QUALITY: READY — không xác lập finding blocking trong diff này.**

Đây không phải nghiệm thu production extraction, parser accuracy/corpus, full crash recovery, host composition hoặc deployment isolation. `createDockerExtractorRunner.start` luôn từ chối `PRODUCTION_CORPUS_REQUIRED` (runner:351–353); CLI extract cũng từ chối trước parser (entry:30). Không có import/wiring worker trong app/main hiện tại. Gate Task5/Task7 được giữ đóng, không chuyển diagnostic thành WorkerResult hoặc certificate.

## Integrity và build provenance

- 10/10 source + 9/9 evidence trong `task-4-final-manifest.json` khớp SHA256 và byte size; 10 source cũng khớp Git candidate. Kiểm lại cuối review: không đổi SHA source.
- Manifest SHA256: `b5719f5179a16d27d6f2ef234191f6859d9fb6f79196597018d4d1860ea8cb15`.
- Review package khớp chính xác `git diff -U10 f6ca0a4 b670d82`: SHA256 `2e7fc4c402411bc287acda895d277bebac0172fec002abe074b62a0b4941f1e6`. Khác default diff chỉ do context width.
- Retained context `crew-v2-extractor-context-qduvjkzp`: stat dev/ino/UID khớp owner receipt; inventory đúng 10 file, không symlink và không extra file. Mọi byte/hash khớp source producer; package/lock trong context khớp candidate. Không COPY Darwin dependencies.
- Aggregate được tính lại độc lập: sort theo path, mỗi record chỉ `{path,sha256,bytes}`, JSON sort keys, separators `(',',':')`, UTF-8 không newline; 1.251 byte → `bc04c6013acce13533f7e6c179aa9eeae53b643f23358c437777a691f31b5b38`.
- Đúng bốn direct pin mới: pdfjs-dist6.3.289, canvas1.0.3, yauzl3.4.0, saxes6.0.0. Tự đối chiếu 75 package records nền giữ nguyên; 17 records mới có integrity khớp retained official-registry audit. Linux x64 glibc native canvas pin/integrity khớp receipt. Không fetch/install lại dependency hoặc đọc dependency source.
- Dockerfile ghim Node24.14.0 bookworm index `d8e448…`; production install giữ `--prod --frozen-lockfile --ignore-scripts`. Build log canonical có native PNG RUN exit0 và exported image `sha256:8df553bd040016ddf36a547d32d0e7d4986bfc54f60e0355a21e9c28462316a0`.
- Read-only live image inspect xác nhận exact image ID, `linux/amd64`, user65532:65532 và entrypoint node/max-old-space-size384/worker-entry. Arm64 chưa được chứng nhận. Root context/image được giữ nguyên.

## Critical Issues

Không có defect critical được xác lập trong phạm vi đã review.

## High Priority

Không có finding high blocking được xác lập. Production gates còn đóng là requirement của giai đoạn này, không được tính như đã hoàn thành.

## Medium / Low Priority — informational

1. **Bằng chứng strict/Biome gốc thiếu command log riêng.** Manifest/report chỉ ghi exit0; không xem boolean đó là captured command proof. Đã đóng gap bằng một lượt kiểm tra độc lập dưới đây. Không dùng kiểm tra mới để viết lại lịch sử của worker.
2. **Recovery vẫn default deny khi không chứng minh được publisher đã đóng.** Jobs:69–88 đòi actual stopped + closed ACK; catch:291–307 chỉ ghi ACK sau pending result settle. Với crash trước ACK hoặc Docker inspection không có bằng chứng, job/capacity có thể giữ lại cho Task7. Không tự giải phóng qua TTL. Cần giữ nguyên điều kiện này khi Task7 bổ sung recovery.
3. **Live evidence chỉ đo 5 diagnostic scenarios.** Protocol/fencing/publication DB dùng actual BlobStore/PostgreSQL nhưng controlled runner; không chứng minh parser production hoặc cross-process publisher crash recovery. Không có runtime end-to-end extract được chứng nhận khi start còn default deny.

## Edge Cases và behavioral checklist

| Area | Đối chiếu cụ thể / kết luận |
|---|---|
| Concurrency | Jobs:90–130 dùng advisory admission + row lock/generation/worker CAS; capacity1 xuyên factory. Kiểm lại trước từng publication và transaction cuối:198–205,265–278. Active set chỉ là lớp local bổ sung. Lease expiry không tự cấp generation. |
| Stop / publisher ordering | Worker name/start intent durable trước spawn; `created` không được coi là stopped. Timeout/overflow stop exact container rồi inspect; chỉ stopped mới đóng own attach pipes/client và await close. Unknown giữ resource; ACK sau pending settle và FD close. |
| Error boundaries | Fixed worker codes, CLI stderr cố định, stderr daemon cap64KiB; raw content không đưa vào public Problem.message. Promise result được observe; failure giữ orphan/intent thay vì unlink file có thể đã referenced. Storage/DB errors được propagate với fixed worker code. |
| Contracts / compatibility | WorkerInput/Result giữ version1/exact keys; UUID/hash/generation/limits được validate. Factory là amendment PM cho phép vì wrapper cũ không có trusted config/root; wrapper cũ default deny. Không đổi migration/shared contracts hoặc exported producer khác. |
| Input / filesystem | 64KiB decoded chunk,128KiB ordinary line,8MiB terminal,100MiB total; wire/file/unit count bounded. Exact path regex, exclusive nofollow writes, full byte count/hash; terminal files phải khớp frames. Jobs chỉ publish sau validated terminal và actual stopped. |
| Coverage / leakage | Identity/config/extractor/generation exact; locators canonical không bypass qua JSON key ordering; unit refs/modality/available coverage được kiểm. Problem code allowlist + fixed Vietnamese copy. Semantic parser/provenance accuracy còn Task5. |
| Auth / trust | Factory nhận internal trusted Db/runner/BlobStore/config; không thêm public route hay request-controlled Docker flags/root/image. Upload phải ready/durable/once-linked/owner và original hash khớp. Không cấp quyền đọc hoặc bypass authz ở consumer. |
| Queries | Các lookup/final CAS dùng job/upload PK; capacity count status có index SQL009. Per-file operations tuyến tính và bị chặn bởi files≤10000/output≤100MiB; không có unbounded loop trên DB input. Chưa có benchmark latency ở cực đại. |
| Container boundary | networknone/read-only/capdropALL/nnp/nonroot65532;512MiB memory+swap,CPU1,pids32,tmpfs16+100MiB; chỉ own readonly input bind; không host socket/credentials/writable mount/--rm. LogConfig none ngăn daemon spool. |
| Plan claims | File paths/symbols/gates được đối chiếu source; đúng R2 mapping và R3 flow docs. Không đánh dấu task plan hoặc sửa TODO. |

## Verification

| Gate | Evidence / phạm vi |
|---|---|
| Worker final focused | `task-4-targeted-final.log`:18 tests,18PASS,0FAIL,0SKIP; source/test hashes khớp manifest. Không rerun broad DB suite. |
| Independent strict | `task-4-review-strict.log`: exit0. Frozen baseline703b922 + exact candidate Task4 TS/package/lock overlays; original server strict tsconfig, không skipLibCheck/any/ambient workaround; Node24.14.0. |
| Independent Biome | `task-4-review-biome.log`: exit0, checked đúng7 TS files, no fixes. |
| Actual boundary canaries | `task-4-live-final.log`:1 test/5 sequential scenarios PASS. Boundary required11 checks; pids actual deny; memory OOMKilled=true/exit137; stdout WORKER_OUTPUT_LIMIT/exit137; timeout WORKER_TIMEOUT/exit137. Test source asserts LogConfig none and resource controls. Mỗi container actualPid0/exactID removed; own root removed. |
| Historical broad run | `task-4-frozen-cover-9c0308d2.log`:293 tests,289PASS,1FAIL,3SKIP. Failure là native staging fixture không resolve postgres package; giữ nguyên thất bại này. |
| Exact repaired case | `task-4-native-repair-fix1.log` + wrapper log:1/1PASS với ancestor dependency resolution readonly, frozen relative imports và original native controls. Không cộng thành293PASS; không dùng làm extraction isolation certificate. |
| Docs | Standalone reviewed docs validator, cwd v2, `check --all`: exit0. Lần thử thêm unsupported `--root` trả exit2 rồi sửa invocation; không sửa validator/config. |

Strict snapshot và command/exits/source inventories nằm `task-4-review-validation.json`; source hashes trước/sau giống nhau. Own scratch nonce `7e07612c-49b9-4cad-bd0b-c38b28027a53` được xóa sau subprocesses đóng và đối chiếu exact nonce/dev/ino/UID. Không đụng tài nguyên root/peer/shared service; không live providers/owner credential/global install.

Evidence SHA256:

- `task-4-review-validation.json`: `715bd30e2ebf53e9fbfdb99298434cac3da97e574fae668f99561ae08735f694`.
- `task-4-review-strict.log`: `a19a43daf42c4fc60d83240a2472b6dc804deca544f86dff6950b2c869b65101`.
- `task-4-review-biome.log`: `b7cc8153450c5bc72ea1e086b2e793b9372a939cab8f1f12fb3168dd94a91191`.

## Recommended Actions / Plan follow-up

1. PM có thể chấp nhận Task4 bounded boundary tại candidate này, giữ rõ production disabled. Protocol/job tests, target diagnostic build, five canaries, strict/Biome/docs gates đã có evidence; commit/mapping của PM nằm trong candidate.
2. Task5 phải đưa actual parser, version/image/corpus receipt và rebuild/full parser corpus+boundary trước khi mở extract. Diagnostic source/hash hoặc native1×1PNG không thay thế gate đó.
3. Task7 phải nghiệm thu native publisher crash recovery, orphan reconciliation và ownership cleanup; không suy STOP từ lease hoặc xóa tài nguyên unknown.
4. Không công bố all-server293PASS từ lịch sử broad+repair; final evidence chỉ có scoped18/18 và riêng repaired1/1.

## Metrics

- Type coverage: không đo phần trăm; strict compile exit0 trong frozen scope nêu trên.
- Test coverage: không có instrumentation percentage;18/18 focused +1 live test/5 scenarios đã đối chiếu.
- Linting issues:0 trong7 own TS files.
- Blocking findings:0; production acceptance:chưa được cấp.

## Unresolved Questions

Không có câu hỏi chặn Task4 scope. Task5 parser/corpus, Task7 cross-process recovery và production composition/deployment còn ngoài nghiệm thu này.
