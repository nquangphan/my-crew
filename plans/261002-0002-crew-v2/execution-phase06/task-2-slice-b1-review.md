# T2 Slice B1 — independent review

## Spec Compliance

**SPEC: ❌ Issues found. QUALITY: Needs fixes.** Hai lỗi Important B1-F1/B1-F2 bên dưới nằm trong contract B1 đã release; không có finding về B2–B5 hoặc positive production admission.

- Đối tượng review: base `29e7265` → frozen working candidate, đúng hai modified paths và một new test. Đã đọc toàn bộ diff một lượt theo ba đoạn; không đọc lại changed source ngoài diff, không chạy Git/Node/PostgreSQL/tests hoặc tạo subagent.
- Diff SHA256: `eaa02c221da7aa76b36f52ac6b8a3207593d40ac53dc15573a05f2f424755c02`; implementer report SHA256: `ca4992a84200a3b261fa30711771328912a29facfdbafb10e93530664c6119bb`. Cả hai khớp handoff.
- B1-F1 vi phạm phân biệt canonical UUID identity và exact submitted hash tại `task-2-slice-b-preflight.md:64,75`; B1-F2 chưa từ chối toàn bộ accessor/prototype input theo `task-2-slice-b-preflight.md:68`.
- ⚠️ Production authority/current input/fence/admission và B2–B5 vẫn pending theo ruling. Thành công trong test là exact test-only trust port; review này không xác nhận positive production authorization. Docs flow integration do controller serialize sau review.

## Strengths

- `v2/server/src/tickets/contracts.ts:85`, `v2/server/src/tickets/service.ts:292,448`: dependency optional và method additive; capture đúng method tại factory creation, absent authority trả named503. Generic signature/ACL vẫn qua shared core tại `service.ts:242,266`.
- `service.ts:220,296,310`: hash dùng tuple/action/full submitted snapshot trước business defaults; input, actor, proof được copy/freeze trước await đầu tiên. `test/assistant-orchestration.test.ts:378,402` kiểm immediate caller mutation và omitted-versus-null/default behavior.
- `service.ts:162,163,312,314`: root → parent → project locks có trước authority verify. Test `assistant-orchestration.test.ts:353` dùng peer connection `FOR UPDATE NOWAIT` và actual55P03, không dùng sleep làm bằng chứng thứ tự.
- `service.ts:242,252,314`: capability registry module-private, minted sau verify, bind Tx/actor/input/action/hash/project/root và bị consume trước insertion; generic input không nhận bypass. `assistant-orchestration.test.ts:196,231` kiểm generic404 và exact trust-port mismatch; token không bị export chỉ để test.
- `service.ts:272` giữ audit actorA trong cùng INSERT, reuse hierarchy/pin/deploy invariants; `assistant-orchestration.test.ts:188,529` kiểm actual persisted audit/journal và exact owner deploy approval. Không synthetic owner hoặc copied INSERT pipeline.

## Issues

### Critical (Must Fix)

Không có.

### Important (Should Fix)

**B1-F1 — UUID project khác case bị hiểu nhầm thành khác cây.** `v2/server/src/tickets/service.ts:164` (được scoped wrapper gọi tại `:311`). UUID regex cho phép uppercase; PostgreSQL trả `parentRow.project_id` dạng lowercase, nhưng shared preparation so sánh trực tiếp với `input.projectId` giữ nguyên spelling. Với child input hợp lệ có `projectId = actualProjectId.toUpperCase()`, lookup parent/root vẫn thành công rồi wrapper trả `TICKET_HIERARCHY`409 trước khi gọi authority. New-root path lại canonical-check project tại capability consumption, nên cùng ID có behavior không nhất quán. Đây là so sánh cũ được reuse vào entry mới, nhưng B1 contract đã yêu cầu canonical identity riêng với exact payload hash. Sửa so sánh identity bằng canonical UUID trong preparation mà không rewrite captured payload/hash. Thêm regression child/task uppercase được cấp đúng hash riêng thì thành công; lowercase allowance không được reuse cho uppercase payload. Test trust-port phải lưu canonical expected DB project identity riêng với exact input.

**B1-F2 — Snapshot thực thi array accessors/iterators trước validation.** `v2/server/src/tickets/service.ts:234,296` gọi `canonicalJson` trước khi kiểm original input. Named outside check `v2/server/src/journal/canonical.ts:12–14` xác nhận array branch dùng `Array.from(current, ...)` trước prototype/symbol/descriptor checks của object branch. Vì vậy `input.inputs.items` là array có own getter ở index0 trả string sẽ chạy getter rồi biến thành plain frozen array; validation sau snapshot chấp nhận nó. Array có custom `Symbol.iterator` hoặc custom prototype cũng được normalize qua nhánh này. Getter có thể sửa caller-owned actor/proof trước snapshots tại `service.ts:297,298`, làm assertion “exact originally captured input/actor/proof” yếu hơn contract. Test accessor tại `assistant-orchestration.test.ts:494` chỉ đặt getter trên plain object nên không bao phủ đường này. Sửa tại B1 boundary bằng kiểm tra descriptor/prototype/symbol của cả arrays trước serialization, không invoke getters/iterators; không cần mở rộng sửa global journal canonicalizer nếu chưa được release. Thêm regressions non-throwing array getter/custom iterator: getter/iterator không được chạy, trả VALIDATION400 trước authority và không write; giữ supported ordinary JSON arrays hoạt động.

Hai finding trên dựa trên đường code tĩnh cụ thể, chưa chạy repro do reviewer không có heavy slot và đã được chỉ định không chạy Node/tests.

### Minor (Nice to Have)

Không có finding thêm.

## Named outside checks

1. **Rủi ro snapshot/hash helper tự normalize non-JSON source trước validation:** đọc đúng `v2/server/src/journal/canonical.ts` để xét descriptor handling của helper mới được import. Kết quả: object branch kiểm descriptor nhưng array branch đọc trực tiếp và bỏ qua prototype/symbol checks; tạo B1-F2. Không crawl journal hoặc các callers khác.
2. **Rủi ro lệch frozen authority signature/return contract:** đọc định nghĩa `OrchestrationProof`, `OrchestrationAction`, `ProjectOrchestrationAuthority` và adjacent port tại `v2/server/src/assistant/contracts.ts:89–119`. Optional capture gọi đúng `(tx, actor, proof, action, targetSha256): Promise<void>`; không thêm field/wire shape hoặc sửa frozen port.

## Evidence checked

- Đọc `docs/index.md` rồi `v2/docs/flows/server-tickets.md` trước code; đọc task reviewer prompt chính thức, preflight B1, last B1 ruling trong progress và implementer report. Không có `.codegraph/` tại worktree.
- Source SHA256 khớp report: contracts `c09baf6dd6c866747a491f2846a3338b0a9ba38aa10719af933119dbc8128f03`; service `5b86e667024048818f38ab173f8a47b4d4bc6ff2b63d31a9043763a766dc1911`; test `407ef38ad38b673efb0042c7ea2092cfa384a4fa8b5034523ae7e3658fc8ebff`.
- Đã hash-check toàn bộ tám raw evidence files so với report; khớp. Đọc full GREEN log: một run55 tests,55 pass,0 fail/cancelled/skipped,9797.940292ms, gồm39 B1 +16 existing regressions. Không warning trong GREEN output. RED summary/log excerpt xác nhận39 tests/12 pass/27 fail và semantic404-versus403 mismatch; không tái chạy để tạo evidence.
- GREEN resource log ghi test exit0 tại dòng127, scoped tsc exit0 tại168; typecheck raw file rỗng đúng SHA256 đã báo. Biome raw ghi exit output `Checked 3 files in 28ms. Fixed 2 files.` trước frozen test run. Chỉ scoped strict/import closure, không full-server typecheck PASS.
- Cleanup log được đọc và hash-check; review không khẳng định live process/container state vì không kiểm runtime. Không chạy lại test suite để review.

## Assessment

**Task quality: Needs fixes.** Cấu trúc shared core/private capability và regression chính phù hợp B1; cần khép hai input-boundary defects trước approval. Sau sửa chỉ cần targeted regression cho B1-F1/B1-F2 và affected validation trong slot do controller cấp, rồi scoped re-review exact delta.

Unresolved questions: không có; B2–B5/production admission là scope pending đã xác định, không phải blocker mới của review này.
