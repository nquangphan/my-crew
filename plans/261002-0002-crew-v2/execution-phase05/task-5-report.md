# Task5 — parsers và provenance

Trạng thái: **candidate source đã freeze; 76/76 unit + strict TypeScript + Biome PASS**, chờ PM actual worker boundary/corpus và review độc lập. **Chưa có nghiệm thu production**. PM phải tạo candidate image, chạy boundary/corpus thực, cấp authority từ evidence đã review độc lập và cập nhật phần kết quả cuối. Unit/typecheck không phải production certificate, complete extraction không chứng minh model đã đọc.

## Phạm vi và producer

Baseline fixture đọc từ accepted `b670d82`; không dùng source chưa review của Task2b/Task3/Assistant. Chỉ overlay extractor, bốn unit files, fixtures và producer được PM chuyển quyền: worker-entry/runner/protocol; contracts chỉ SourceLocator + SourceComponent. Không sửa jobs/storage/config/SQL/manifests/package/lock hoặc Git/index. Task3 giữ jobs publication wrapper và đoạn flow step5.

PM phê duyệt SourceLocator image.transform và docx/sheet.component dạng đóng, giữ version1 và locator cũ. Source locator thay cho dòng kế hoạch yêu cầu Problem metadata vì Problem producer chỉ có code/message/unitIds. Pre-anchor ZIP/XML limit trả failed/LIMIT_EXCEEDED không available; workbook-level pivot/external link không có tọa độ thực trả unsupported, không tạo worksheet/A1 giả.

Actual producer gaps đã báo và xử lý trong phạm vi chuyển quyền: entry extract và runner.start vốn hard-deny; WorkerInput không có filename nên dùng byte signature+MIME, không thêm field; XML saxes6 public type declarations lỗi TS2344 dưới TS7; PDFjs6 getAttachments trả Map, loadingTask.destroy thay document.destroy, không nhận isEvalSupported trong parameter type. Ordinary checked createRequire facade cho saxes được PM duyệt, không sửa dependency/types/skipLibCheck. Native decoder đã SIGSEGV với PNG cắt cụt: giữ evidence, bổ sung CRC/chunk/IEND check trước decoder, không đổi kiến trúc hoặc dependency để né lỗi.

PDFjs public getOpenAction/getJSActions/fieldObjects không phát hiện Launch fixture; metadata không phát hiện Collection rỗng. Đã giữ RED và API probe thật; PM đã audit/built pin `pdf-lib@1.17.1`; public parsed object graph được inspect trước phát trang. Launch/Collection/escaped-name/incremental/compressed-object-stream regressions đã PASS trên target Linux. PDFjs vẫn là renderer. Không dùng raw regex làm chứng nhận an toàn PDF.

## API nhận diện/chạy worker

`createExtractorCorpusVerifier(config, challenge)` dành cho trusted pre-certification; challenge version1 chứa exact imageDigest/sourceTreeSha256/corpusSha256, toàn bộ WorkerConfig, allowed original SHA+MIME và maxCases 1..1000. corpusSha256 = SHA256(JSON.stringify(originals)) theo thứ tự đã chốt; challengeSha256 dùng JSON canonical recursive sorted keys. Mỗi lần verify đối chiếu request đã lưu, original/MIME/config/extractorVersion; exclusive fsynced root reservation theo challenge+ordinal đếm cả replay; intent được lưu trước cùng private spawn helper mode extract. Trả actual WorkerResult và observation sau bounded framed stream + actual closed/STOP, không queue/publish/PASS. UNKNOWN giữ capacity.

`createDockerExtractorRunner(config, authority?)`: thiếu authority mặc định PRODUCTION_CORPUS_REQUIRED. `ProductionExtractorAuthority.authorize(binding)` là trusted local composition port, không HTTP/request flag. Binding gồm exact image/source, SHA256 byte file parent runner thực, extractorVersion, policy SHA và SHA canonical **toàn bộ WorkerConfig**. Permit thêm reviewedEvidenceSha256/lockSha256/nativeIntegrity/boundaryEvidenceSha256/corpusEvidenceSha256. Root authority phải xác minh independently reviewed actual files; định dạng hash trong runner không tự chứng minh review. Permit được lưu trước spawn. Cùng private container helper, active<=1, bounded stream chạy ngay và kết quả chỉ có sau actual closure; UNKNOWN giữ slot. Không có permit production nào do worker tự tạo.

## Kiểm chứng đã chạy và lỗi giữ lại

Mỗi JSON trong `task-5-evidence` chứa argv đầy đủ, immutable image, source overlay manifest SHA/bytes, nonce, parent/attach PID, full CID, docker actual state/hostConfig, exit, sourceStable và exact cleanup. `.log` cùng UUID là stdout/stderr. Không gộp các lần thành “all pass”. Những run trước source cuối chỉ là lịch sử:

| Evidence UUID | Kết quả/ý nghĩa |
|---|---|
| 90fdcf92 / 7f246427 (xem prefix file evidence) | Native SIGSEGV khi fixture PNG cắt cụt tới decoder; giữ nguyên failure |
| 43b059c3 / e062a1bf | Native valid PNG encode/decode probes PASS |
| cf666c9a | Strict lỗi upstream saxes TS2344 và API6/ambient/module context; không phải semantic review round |
| 027dc0e1 | 37/37 unit trước các regression bổ sung |
| 472facda | UTF16 missing-tail lineEnd RED |
| e52186b6 | Dispatcher chưa tồn tại RED |
| 09573b38 | EXIF6 normalization và PDF attachment Map regressions RED |
| 62171a1 | 45/45 unit tại source lúc đó |
| e11be7a6 | Corpus factory construction meaningful RED |
| 96552658 | 51/51 unit tại source lúc đó |
| 572919c4 | Metadata missing-tail coverage RED |
| 59a33bc4 | 55/55 unit tại source lúc đó |
| 36f6f124 | Production authority wrong-permit/full config binding RED |
| 1b0a4cfa | 58/58 unit tại source lúc đó |
| 6182fb8d | 59/61: Launch/portfolio RED |
| 1e854491 | CSV emoji bytecap thêm RED |
| c7f061d7 | 60/62: CSV fix/C4 actual anchor PASS; Launch/portfolio vẫn RED |
| 68fcf055 | Actual PDFjs public API probe: Launch actions null, portfolio flag absent |
| 42fa360a | 54/64: coordinate/namespace meaningful RED + pdf-lib dependency chưa trong old image (8 failures), không gọi là parser GREEN |
| bedd35a4 / b698c876 / e8cd909c | Strict PASS các source trước producer/parser thay đổi cuối, không thay cho final strict |

Biome đã chạy scoped 21 files, exit0, sửa format/import; informational useTemplate đã sửa và lần scoped tiếp theo exit0 không diagnostics. Final exact source tests/types/Biome đã chạy như bảng dưới; actual production-image worker corpus **chưa chạy trong worker này**.

## Fixture/provenance

README fixture ghi recipe, tác giả và SHA, primary ReportLab BSD/license/encryption API và pypdf official license. ReportLab4.4.9/PIL/pypdf6.10.0 đã có trong bundled runtime, không host-install. Encrypted PDF do StandardEncryption 128-bit thật tạo; independent pypdf kiểm wrong password fail/correct password decrypt; deterministic regen byte-for-byte nằm `pdf-provenance.json`. Không tự viết encryption/PDF writer. Escaped-name và incremental Launch fixtures do pypdf tạo, strict independent reader xác nhận action thật; immutable original prefix giữ trong incremental file. Macro/JS/executable/URL chỉ inert data, không thực thi. Source golden giữ explicit statuses, literal Vietnamese/formulas và locators, không tự update snapshot.

## Resource ownership và cleanup hiện tại

Owned fixture root `/tmp/crew-v2-attachments-parser-b953796e-f601-4a6a-9311-38bd9f79c43d`, nonce b953796e-f601-4a6a-9311-38bd9f79c43d, dev16777229/ino64075091/uid501, owner identity lưu trước tạo resources. Baseline archive và overlay source được hash trước/sau, mount readonly vào `/fixture/v2/server/src`, test, domain src/package và tsconfig, không che dependency image bằng host directory.

Mọi own test container tới final e7cffbd4 đã đóng attach, inspect fullCID+nonce+exactimage+PID0+stopped, rồi remove exactCID. 34 container receipts đều closed/PID0/removeExit0/sourceStable; không OOM trong final sequence. Scratch root giữ có chủ đích qua independent review để tái chạy cùng frozen baseline; không có active process/container. Cleanup deferred tới review, phải kiểm lại dev/ino/UID/nonce và actual closure; không prefix prune. Images ebdbe6bb... và 719dfc5b... thuộc PM và giữ nguyên; old diagnostic 8df553/context qduvjkzp không dùng, đã báo PM. Không chứng nhận fixture mount là production boundary.

## Final verification và source freeze

Dependency image immutable `sha256:719dfc5bd6c6d58712f6b1a49f255e87afbf4b1ce6cf921b9e88d2fa25ae7856`, Linux/amd64, Node24.14.0/TS7.0.2. PM receipt `task-5-pdf-image-receipt.json` bind audited 97-package target lock, package SHA `a721662a2c34e9cbc7043421039ec44ddc9ef9192200f6e6d1bf7e30be85b39e`, lock SHA `9e4a9700ea99cdae3b4ca2a145c6cc6d78373657fba2258b2073cf81a5365106`. Không host install/copy Darwin dependencies. Final launcher receipt ghi fresh pressure1 hoặc2, available>=4GiB, CPU idle>=50%, disk>=8GiB theo PM ruling20:15; đúng một readonly/networknone/capdrop/nonroot container <=512MiB swap=memory/cpu1/pids32.

| Receipt/log trong task-5-evidence | Kết quả |
|---|---|
| `ed6580ef-49c4-48ec-ae65-917ebf3a8720` | 71/75: đúng bốn meaningful RED mới (nested table/header namespace/empty numeric cache/workbook external); mọi PDF guard case PASS |
| `a583ab81-cdb9-4690-a9e9-b72ee95c0ce4` | 75/75 sau narrow fixes |
| `5f43c9bb-ee1d-4347-b292-6d5379c2c48e` | Strict PASS trước thêm committed compressed fixture |
| `500a02ae-d1e8-464c-b0dc-05682ac86660` | Public pdf-lib compressed fixture generator exit0, sourceStable, actual closed/remove |
| `3a6e9b87-6596-420e-9c51-d91a1dee9b66` | **Final four files 76/76 PASS**, exit0, không skip |
| `e7cffbd4-f75b-4291-8047-b416a2fc908b` | **Final strict TS PASS**, exit0, accepted ambient/module context, không skipLibCheck/new ambient |
| `final-biome.json` / `.log` | **21 scoped files PASS**, exit0, no fixes applied, sourceStable |
| `origin-identity-{red,green}.log` + receipt | Host pure-only origin metadata duplicate regression RED→GREEN |
| `missing-bound-{red,green}.log` | Host pure-only missing-unit allocation bound RED→GREEN |
| `metadata-prefix-{red,green}.log`, `metadata-prefix-focused-green.log` | Host pure-only pre-drain metadata cap RED→GREEN; giữ available prefix + missing tail thay vì terminal bỏ bytes đã phát |

`final-source-validation.json` xác minh **34 code/test/binary fixture files** khớp SHA với cả final unit và final strict manifests. README và extraction flow là documentation, hash riêng trong inventory. Canonical inventory hash không phải production image sourceTree hash; PM phải tính riêng đúng whitelist image.

- `own-source-inventory.json` inventory SHA256: `85d06b02ce6dcc388fdd0d01ada17ca1cd9d867cfb6119458e390ec56e6d6d09`.
- Actual parent `worker-runner.ts` SHA256: `7c28d38d321cb8ffa51d53b46b690cf5e22c7777abfd9e9052678d6f5faeca1e`.
- Code version literal: `crew-extractor-v1+pdfjs6.3.289+canvas1.0.3+yauzl3.4.0+saxes6.0.0+pdf-lib1.17.1+<PM sourceTreeSha256>`.
- CLI runtime closure: worker-entry/worker-diagnostic/worker-protocol/storage/extract/*.ts + pinned public dependencies. config/contracts/runner imports trong CLI closure là type-only; config.ts/canonical.ts chỉ cần ở test generator/parent config, không bắt buộc production entry. PM giữ whitelist hẹp.
- Corpus `corpusCases()` có37 deterministic original cases; pure unit còn negative structural mutations và modified-limit configs. Root sở hữu actual compressed object-stream expansion/timeout challenge và production receipt/authority.

## Giới hạn và phần còn lại do PM nghiệm thu

1. **Chưa chứng minh actual production-image whole corpus, boundary sentinel/STOP, operational production start qua reviewed authority**. Worker helper/port đã có và default-deny khi thiếu authority; không tạo certificate giả để lấp bước này. Pure 76/76 không chứng minh OS sandbox hay model comprehension.
2. pdf-lib inflate object streams trong load trước public graph traversal; **không có application pre-inflate expanded-byte counter** ở public API. Graph count/depth/retained raw stream bytes + Length/filter/refs được bound; hard512MiB/wall của actual worker mới là allocation boundary. PM phải kiểm bomb/timeout trong image candidate; chưa gọi những case đó PASS.
3. DOCX body/altChunk/external chưa có actual paragraph và workbook pivot/externalLinks không có actual cell anchor → unsupported/zero available theo PM ruling; không fabricated paragraph0/package worksheet. Known anchors giữ missing partial. Empty document không có actual paragraph cũng unsupported.
4. Unknown/corrupt parser errors có fixed codes; không giữ file content trong Problem. ZIP64, unknown compression/encrypted ZIP, unsupported Office object/visual không được tự diễn giải thành đầy đủ.
5. Independent SPEC/QUALITY review toàn producer amendment, old-format compatibility, resource/corpus evidence; PM R2 manifest và R3 server-attachments assembly/commit. Worker không Git/index mutation.
6. Scratch fixture retained qua review; `parser-fixture-runner.py` lưu exact launcher recipe để tái chạy, không dùng như production certificate. Cleanup cần actual closure + exact identity; PM images giữ nguyên.

## Inventory SHA256/bytes

| File | Bytes | SHA256 |
|---|---:|---|
| `v2/docs/flows/attachment-extraction.md` | 15524 | `d58f8b29f2d293cf8b68765fa20abcea0a98694260331ab2628a020230c09cf4` |
| `v2/server/src/attachments/contracts.ts` | 12065 | `04c81e230c2cf3ff34eeff6751aaeb4dc508003a66e9ed5b48917b23ded5b305` |
| `v2/server/src/attachments/extract/csv.ts` | 3585 | `7d7a5ea2a483e4cec9f35d3fa56303eb8b2b21ceda1e43b73e7c2036d0234de4` |
| `v2/server/src/attachments/extract/docx.ts` | 10079 | `3baa0fe6ebf6906d5cd5644b1174d8d95c9793e83e9c16169316aa96afe1a258` |
| `v2/server/src/attachments/extract/formats.ts` | 4330 | `ed1e7436f8dac5b17aa673070c5aec6c4fdec4e22efb48fdf31a198705cb3062` |
| `v2/server/src/attachments/extract/image.ts` | 5573 | `b3daa8cc95b203231c10b78d49371a6d83edaccdae35138b2a69526a0e0ab180` |
| `v2/server/src/attachments/extract/index.ts` | 8167 | `6995ee16825c4588ee8ff6107bde1288c7dbb802c82b8e2cf5c8068267c560a8` |
| `v2/server/src/attachments/extract/pdf.ts` | 10620 | `b717abc12cbb2d8546871f5b1288335bc291b18cec79d8ede658c6561ecdd33e` |
| `v2/server/src/attachments/extract/text.ts` | 2790 | `755eac5d075fb9cbc040fb10a315baf53d84a3d335556c3d4f5792a49d012790` |
| `v2/server/src/attachments/extract/verify.ts` | 2572 | `bb004e0feb44fe66bc3d27795df5b2b77f736ddef95a976945fd89aed58ada68` |
| `v2/server/src/attachments/extract/xlsx.ts` | 14763 | `d7f674ea4b534d0fc8fc319b38a98ab8bf036b8aa166273f6ce81b99abc02450` |
| `v2/server/src/attachments/extract/xml.ts` | 3417 | `903f54914903092bddc4862c0e95c9612c3c5c468b0585b895e73db91086da99` |
| `v2/server/src/attachments/extract/yauzl.d.ts` | 843 | `c88278585ba1b66e606aa3e56c1dfd54283c26874f5a134e3fe775a59e033738` |
| `v2/server/src/attachments/extract/zip.ts` | 7446 | `be9e1bf5269be8e7ded32c162215702cf55fcce343ef3a48323b6ac64c7324f0` |
| `v2/server/src/attachments/worker-entry.ts` | 2119 | `c19399d7d9de83a0dc467315672251bc3fb3ccb68511d6483a79073abdc74acf` |
| `v2/server/src/attachments/worker-protocol.ts` | 19753 | `96fbee3bd5e7a9023ae141642e1c137c9e00351b2bae57dd5e2194cfaf92308f` |
| `v2/server/src/attachments/worker-runner.ts` | 25728 | `7c28d38d321cb8ffa51d53b46b690cf5e22c7777abfd9e9052678d6f5faeca1e` |
| `v2/server/test/attachments-formats.unit.test.ts` | 2175 | `eb4dd1800b0609e6c6310912bb80f07291bcbada41243b4a08fd5902e53e914c` |
| `v2/server/test/attachments-ooxml.unit.test.ts` | 16766 | `ca5fd682d7f5b66e998675a2b4b65e695d279ebb463781195af45c64ef382af2` |
| `v2/server/test/attachments-pdf-image.unit.test.ts` | 7630 | `59dcb51b201468b40f9ebe3631bd650a561c7de19f8ea1c5bfdaed8ae9168b7a` |
| `v2/server/test/attachments-text-csv.unit.test.ts` | 12937 | `75248ca0049127cebdf2d0dc4bdb06ce230fd420c4711707fe06dd0d5a87de3e` |
| `v2/server/test/fixtures/attachments/README.md` | 6437 | `128718051dc2620cbb30db1f25e35b5654be882db5a6b186bc949ff242e071f9` |
| `v2/server/test/fixtures/attachments/embedded-executable.pdf` | 1216 | `52d23086fa9f1b7a4be2a46e202ef7e030ff7e86ed0f2f94f0c606ba50476239` |
| `v2/server/test/fixtures/attachments/encrypted.pdf` | 1929 | `e39ff9ad175663b2a603104c88cd80ab2f24f51a18ddc129a1a6bfc2c8bd66b8` |
| `v2/server/test/fixtures/attachments/javascript.pdf` | 1091 | `92a74737af3c07e239fa1818339834c394cb85402782e29ff241641a8f934571` |
| `v2/server/test/fixtures/attachments/launch-compressed.pdf` | 1009 | `8093cee4f0204657115a3fcfed2ee034506711e55340a49cd356988de4c2e143` |
| `v2/server/test/fixtures/attachments/launch-escaped.pdf` | 908 | `8423a553c7dbf71af76d37a1c9963c659405546ff1dd0f96f380e7d04c81e083` |
| `v2/server/test/fixtures/attachments/launch-incremental.pdf` | 1696 | `5e6506f0beb731a67419ec3ef9ac3d819b99808f606e286fb0916f9c2dd174dc` |
| `v2/server/test/fixtures/attachments/launch.pdf` | 934 | `452380707bda4ded5122b3efea542a308a0b720f75981e138dcf2140e8d628fb` |
| `v2/server/test/fixtures/attachments/make-fixtures.ts` | 11762 | `a84d481c5b7b3aa8a811c0a98b2bfa7db96fcf8e37a6009dd95928b35d11aee7` |
| `v2/server/test/fixtures/attachments/mixed.pdf` | 2029 | `e967451dd350be34adcd78a5a44e3d9112b28b051b3e3b32a79fe5848e277fa3` |
| `v2/server/test/fixtures/attachments/orientation-6.jpg` | 669 | `34fbeb44f2ccaddb296d78d415af6444427f5a6206efb3941f15af5b79d76249` |
| `v2/server/test/fixtures/attachments/portfolio.pdf` | 884 | `7158cd617d7ee430792cc03490aa2d4ce3fc708ff61c6175a235f45d0501e9b5` |
| `v2/server/test/fixtures/attachments/rotated.pdf` | 867 | `2b82c523ea3cd2a1caa9fc5d91906c90eca96cf99a450f685208bfa7ce0754a9` |
| `v2/server/test/fixtures/attachments/scan.pdf` | 1645 | `e0dd29c35085b59e7305bcc8dad57fc022671d74871cd1710b738322235c8ad9` |
| `v2/server/test/fixtures/attachments/text.pdf` | 1335 | `42e7fee83fca52e8901f2b48c84cc3ff94d1f22941ca644a8fc9da738343befe` |
