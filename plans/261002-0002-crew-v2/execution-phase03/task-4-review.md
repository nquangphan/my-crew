# Review độc lập Phase03 Task 4

Candidate: `4cbf581ec581040df6ca87950cf139e9bc490cd6`; 11 file của producer đều khớp SHA-256 trong `task-4-evidence/candidate-inventory.json`. Đã đọc full source/tests/support, archive/audit fixtures, report/evidence, root/v2 docs và kế hoạch thực tế `phase-03-macos-workflows.md`, Task 4 brief cùng producer Task 2 đã review. PM serialize package/lock/mapping riêng; đây là review candidate, không phải chứng nhận runtime.

**Spec READY: NO. Quality READY: NO. Overall READY: NO.** Ba nhóm finding dưới đây cần sửa; không có finding về việc giữ fork/UNKNOWN theo giới hạn Task 2 đã chấp nhận.

## 1. P1 — Builder chỉ copy nên chưa tạo được artifact workflow thực theo Task 4

**Vị trí:** `v2/gateway/src/workflows/registry.ts:261–285,303–306`; `audit.ts:51–109`; `test/fixtures/workflows/official-audits.json:23–26`.

`project` chỉ copy mappings và thêm một policy string; chạy copy hai lần không thể thực thi recipe installer chính thức. Candidate thật có cả ba projection BMAD null, Superpowers API null; positive API/Claude+Codex matrix chỉ dùng source synthetic. Vì thế source package BMAD đã cài nhưng chưa có output `_bmad`/config/skills/renderer của recipe Claude đã được Task 4 nêu rõ. API cũng chưa có artifact inventory/policy thực để Task 6 kiểm no-model rồi Phase04 chứng nhận tool loop. Việc Phase04 chịu trách nhiệm gọi model/chứng nhận runtime không thay thế yêu cầu sản xuất projection ở Task 4.

Đã kiểm byte archive ghim: BMAD package-local `tools/installer/bmad-cli.js`, platform `claude-code` và `codex` có trong `tools/installer/ide/platform-codes.yaml`; `core/manifest-generator.js` dòng 348–349,376–377 tạo installDate/lastUpdated từ clock. `uv` hiện có tại `/Users/phannhatquang/.local/bin/uv`, version `0.11.3`. Evidence/report xác nhận 13 direct dependency ranges, chưa có frozen transitive lock/executor, ancestor/HOME/network discovery chưa được cô lập và raw installer output có timestamp trong nội dung. Đây là phần triển khai/audit còn thiếu, không phải thiếu quyền hay thiếu uv. Copy source hoặc đổi discovery directory không tương đương installer/renderer.

**Sửa hẹp trong một wave:** thêm producer được audit cho exact BMAD package-local official recipe trong owned staging: frozen dependency versions/integrities, child HOME/cache/config/input/network policy riêng, bounded executor và operation authority thật; ghi rõ policy ổn định hóa generated operational metadata mà không phá runtime references. Chạy hai build độc lập để chứng minh output deterministic, rồi lưu projection pin/golden fixture. Tạo artifact API từ official skills/scripts/config/renderer và policy manifest được audit; tool loop/model/native certification tiếp tục disabled đến Phase04. Có thể dùng external certified builder với immutable output/receipt được kiểm chứng nếu giữ đúng contract; không giả một copy transform là installer.

**Kiểm chứng:** official BMAD Claude build hai owned roots với môi trường/clock khác nhưng cùng frozen inputs cho cùng canonical projection; đổi input/recipe/dependency policy phải đổi pin hoặc fail; thiếu uv/dependency, subprocess failure/timeout/unknown không publish. Actual API artifact giữ được official entrypoints, scripts/config và policy hash; không dùng fixture synthetic để tuyên bố recipe production đã audit.

### Kết luận rõ từng slot unavailable

| Slot | Kết luận so với kế hoạch |
|---|---|
| BMAD Claude | **Chưa đạt Task 4**: recipe chính thức đã xác định; candidate chưa thực hiện installer và chưa có deterministic artifact. |
| BMAD Codex | Null là trạng thái fail-closed hợp lệ **cho tới khi audit recipe riêng**, đúng ngoại lệ trong plan. Upstream hỗ trợ `codex`/`.agents/skills`; không được báo là upstream unsupported. Producer gap dependency/executor/determinism cần xử lý cùng BMAD rồi audit slot riêng trước enable. |
| BMAD API | **Chưa hoàn tất artifact/policy của Task 4**; cần renderer/config/script inventory thật. Phase04 tiếp nhận chứng nhận tool loop, không phải lý do bỏ artifact producer. |
| Superpowers Claude | Actual candidate có source/projection hash, entrypoints và byte-preserving copy phù hợp layout plugin đã audit; chưa có runtime certificate. |
| Superpowers Codex | Null hợp lệ theo plan: package script ghim yêu cầu `--metadata-source` từ prior official package và `skills/*/agents/openai.yaml` chưa nằm trong source fixture. Không fabricate metadata. Chỉ enable sau khi thu được exact immutable official package/provenance và audit riêng. |
| Superpowers API | **Chưa hoàn tất artifact/policy của Task 4**. Có source scripts/skills để audit; không phụ thuộc giả Codex metadata, không cần model call để tạo artifact inventory/policy. |

## 2. P2 — Stage thất bại và cây hết tham chiếu không có vòng đời reclamation

**Vị trí:** `registry.ts:127–150,160–179,183–185,354–407`; `v2/docs/flows/gateway-workflows.md:22` mô tả đẩy toàn bộ cleanup sang Phase09.

Mỗi retry tạo UUID stage mới, mọi record có `deletionEligible:false`; failure giữ tree, `bytes:null`, và open không reconcile hoặc reclaim. `release` chỉ đổi reference state; `retained()` cộng mọi ProcessJournal row, kể cả stopped, không có đường terminal ownership release. Không có GC/cleanup cho stage đã kết thúc transformation hay cây unreferenced. Giữ UNKNOWN là đúng nhưng giữ vĩnh viễn cả operation đã biết kết thúc chưa thực hiện yêu cầu rollback staging/GC-consults-recovered-refs của Task 4. Phase09 trong approved plan là packaging/signing/update, không có ruling chuyển toàn bộ local operation cleanup sang đó.

**Reproducer reviewer:** private fixture có source bytes/hash đúng, một file 128 KiB và internal symlink dangling. Gọi `installSource` ba lần: cả ba trả `SYMLINK_ESCAPE`; disk có ba stage tree, ba record `failed, bytes:null, deletionEligible:false`. Đóng/mở registry vẫn có ba. Không subprocess/model nào được tạo bởi transform này. Per-archive 32 MiB/per-tree 128 MiB không chặn tổng disk tăng theo retry; unknown byte counters còn làm inventory thấp hơn dữ liệu đã ghi.

**Sửa:** tạo durable operation lifecycle/authority phù hợp producer này, receipt no-subprocess completion hoặc genuine executor stop khi đã có installer. Reconcile reserve/create/rename/receipt sau restart; cleanup owned failed stage bằng identity/FD/no-follow, unlink symlink như entry chứ không đi theo target. Chỉ reclaim published pair khi mọi recovered reference/operation cho phép; unknown/retention/ref vẫn giữ. Nếu chưa thể reclaim một nhóm cụ thể, công bố blocker đúng nhóm, bounded retry/disk accounting; không fake READY/stopped hoặc recursive-rm path không được chứng minh.

**Kiểm chứng:** lỗi/extract/cancel lặp nhiều lần không tăng staging vô hạn sau proven operation completion; kill tại reserve/create/rename/receipt và recover exact identity; swap/symlink/hardlink/reference/UNKNOWN không xóa nhầm; released old projection còn process ref phải giữ, truly releasable tree có đường cleanup/retry. Test đọc disk bytes và durable trạng thái thực, không chỉ assertion `deletionEligible:false`.

## 3. P2 — Abort bị bỏ qua khi source đã publish, current pointer vẫn bị đổi

**Vị trí:** `registry.ts:214–236`; signal chỉ được kiểm trong nhánh `publish` ở dòng 165/167.

Nhánh `present(final)` verify source rồi ghi `current-${pin.name}` mà không kiểm signal. Một sync đã bị hủy/superseded có thể kích hoạt lại source cũ nếu source đó đã có trên disk; test cancellation hiện tại chỉ thử source mới chưa publish nên không bắt được.

**Reproducer reviewer trực tiếp:** mở registry với AbortController; install source A rồi B; abort signal; gọi installSource(A) lần nữa. Kết quả `{aborted:true,result:'success',currentIsCancelledOldSource:true}`: pointer quay từ B về A thay vì AbortError và giữ B.

**Sửa:** kiểm cancellation trước khi bắt đầu operation và trong transaction ngay trước thay đổi current pointer, kể cả immutable source đã tồn tại; áp dụng semantics tương ứng cho cached projection path. Cân nhắc kiểm trước reserve stage để aborted request không tạo residue. Không cần xóa immutable A/B để xử lý.

**Kiểm chứng:** A/B đã published, abort rồi reinstall A phải reject và current vẫn B; abort trong verify trước activation không được đổi pointer; immutable paths/retained refs giữ nguyên. Existing-source success khi không aborted vẫn idempotent.

## Supply chain, hash và chất lượng phần đã có

- Raw archive fixture hashes khớp inventory: BMAD `ac05c93f…aed2`, Superpowers `29714b2c…31a`; source manifests/golden độc lập 499/296 entries được ghi trong evidence. Saved primary npm metadata/tag-object chain phân biệt npm SRI/payload với Git revision; không có claim byte Git/npm tương đương.
- URL validator bind exact release/version/revision/repository và kiểm từng redirect; downloader có byte/time/redirect bound. Payload SHA-256 và npm SRI kiểm trước parse. `RegistryOptions` là trusted audited application input, không phải URL/recipe authority từ owner endpoint.
- Parser chặn traversal/backslash/control, normalized NFC/case collision, special/hardlink và unapproved executable mode; expanded gzip/tree/entry bounds hiện diện. Symlink được tạo sau files/dirs và realpath kiểm escape/cycle/dangling; scan regular-file nlink, modes, payload/manifests được recheck khi resolve. Không phát hiện bypass archive-driven cụ thể trong review này.
- OS writer lock/transaction serialize duplicate operations; source và projection keys tách, expected hashes kiểm trước rename/current update. Receipt-stage thiếu reclamation/reconciliation là finding 2; không khẳng định mất current hoặc xóa run cũ chỉ từ thiếu cleanup.
- Source API không tự đổi server desired/applied/attempt guard; actual source/projection certification vẫn được báo unavailable/UNVERIFIED đúng phần đã làm. Fork/escaped descendant/receipt missing của Task2 vẫn giữ UNKNOWN, không phải lý do nới stop proof.
- `tar-stream@3.1.7`, `@types/tar-stream@3.1.4` được pin exact; lock có exact transitive versions/SRI. PM staged mapping thêm flow/source/tests/fixtures và generated docs; không phát hiện source ngoài ownership trong candidate snapshot.

## Kiểm chứng và giới hạn review

- Đọc producer logs: gateway build + **56/56**, typecheck exit 0, Biome 7 files; không lặp broad suite. Những test này chứng minh source/matrix/security mechanics và Superpowers Claude candidate, không chứng minh các projection thật còn null.
- Reviewer chỉ chạy hai probe hẹp cho findings 2/3 ở owned `crew-task4-review-*`; tất cả journal được close, exact fixture root được xóa trong finally. Không subprocess installer/model, không owner LaunchAgent/config/cache/shared service/DB. Không sửa/stage/commit source/package/manifest.
- Không có crash-kill publish test mới trong review; wave sửa operation authority cần bổ sung bằng chứng này. Không dùng việc thiếu test làm một finding security giả định riêng.
- Chỉ tạo báo cáo này. Candidate inventory SHA khớp cả 11 file, package/mapping được PM serialize; findings phải xử lý rồi review lại trước Task 4 acceptance.
