# T2 Slice B2a — independent task review (spec + quality)

Phạm vi: `340851c..213cc5d`, đọc qua `task-2-slice-b2a-review-package.diff` (6 file: `assistant-access.ts` mới, `decisions.ts`, `dependencies.ts`, `service.ts`, `assistant-mutations.test.ts` mới, `v2/docs/flows/server-tickets.md`). Đối chiếu brief `task-2-slice-b2-preflight.md` (chỉ phần B2a) và report `task-2-slice-b2a-report.md`. Không chạy lại test/Node/PG (theo yêu cầu PM). Kiểm tra ngoài diff, mỗi rủi ro một lần:

- Thứ tự lock (deadlock): `tickets/authorization.ts:4–29` khóa root → ticket → project FOR UPDATE; `projects/service.ts:101`, `docs/import.ts:389`, `execution/attempts.ts:155,342`, `execution/commands.ts:142` đều khóa project sau root/ticket hoặc không khóa ticket sau project. Prefix scoped root → các ticket đã sort → project nhất quán, không tạo chiều ngược lại.
- Wiring production: `createTicketServices(` chỉ được gọi ở `tickets/routes.ts:177`, `execution/attempts.ts:204,530`, `attachments/routing.ts:86` và `service.ts:471–472`; không chỗ nào truyền `assistant` → production mặc định từ chối (503).
- `DocsSourceReader` là kiểu hàm (`tickets/contracts.ts:83`), nên giữ tham chiếu lúc tạo factory là đủ để capture.
- Cột `events.ticket_id` là `uuid` (`migrations/002_journal.sql:11`), nên `ticketId` viết hoa không làm lệch identity.
- `v2/docs/flows.yaml:110–129` (HEAD) đã đăng ký `assistant-access.ts` và `assistant-mutations.test.ts`; ba file nguồn đã sửa chỉ thuộc flow `server-tickets` → R2/R3 thỏa.

### Spec Compliance

**Thiếu:** không có. Đã có đủ hai entry `assistantRecordDecision(tx,actor,proof,ticketId,input)` và `assistantAddDependency(tx,actor,proof,ticketId,predecessorId,expectedRevision): Promise<void>` (`service.ts:753–754`, `decisions.ts:428–450`, `dependencies.ts:584–614`).

Đối chiếu từng ràng buộc:

| Ràng buộc | Kết quả | Bằng chứng |
|---|---|---|
| Payload chính xác: decision `{ticketId,input}`, dependency `{ticketId,predecessorId,expectedRevision}`; SHA256 tuple canonical | ✅ | `decisions.ts:441`, `dependencies.ts:594–598`, `assistant-access.ts:124–128,173`; test viết hoa (`test:1162–1180`) chứng minh hash giữ nguyên chữ gốc và từ chối replay viết thường |
| Chụp actor/input/proof trước await đầu tiên | ✅ | `captureAssistantOperation` chạy đồng bộ và đóng băng sâu (`assistant-access.ts:159–177`); test thay đổi ngay và trì hoãn (`test:1066–1120`) |
| Khóa root → ticket đã sort → project trước verify | ✅ | `assistant-access.ts:231–244` trước `authorize` (`:254–264`); test NOWAIT (`test:1041–1064`) |
| Token private, cùng Tx, chỉ dùng một lần | ✅ (chỉ qua đọc code, xem M3) | `preparations`/`permissions` là WeakMap (`:154–155`); `authorized` được đặt trước verify; `permissions.delete` trước khi kiểm (`:274–275`) |
| Một core persistence dùng chung cho generic và assistant | ✅ | `persistDecision`/`persistDependency` là INSERT/event duy nhất; generic `recordDecision`/`addDependency` đi qua chúng mà không có permission |
| Test allowlist không thành quyền production; resolver default-deny; không bịa owner actor | ✅ | Trust chỉ có trong `testTrust()` của test; owner actor → 403 `ORCHESTRATION_MACHINE_REQUIRED` |
| Không nới ACL generic; A→B qua generic route vẫn 404 | ✅ | `routes.ts`/`authorization.ts` không đổi; test HTTP thật (`test:1183–1225`) |
| Không có authority → 503 | ✅ | `assistant-access.ts:203`, chạy trước mọi truy vấn DB |
| Decision kiểm source và kind chỉ dành cho owner trước authority; dependency giữ luật DAG/revision/status/duplicate | ✅ | `prepareDecision` chạy trước `authorize` (`decisions.ts:446–447`); `validateDependency` chạy trước `authorize` (`dependencies.ts:603–608`); matrix 11 + 9 case khẳng định `observed.length===0` hoặc state không đổi |
| Audit ghi actor máy thật | ✅ decision / ⚠️ dependency | Decision INSERT `actor=operation.actor` (A). Dependency không có cột actor; provenance nằm ở journal do caller sở hữu (xem ⚠️) |
| Migration 001–011 frozen; không đổi DTO public | ✅ | Không có SQL hay `contracts.ts` trong diff |
| Docs flow `server-tickets.md` | ✅ (xem M5) | `server-tickets.md:25,46–47` |

**Thừa:** không có thay đổi hành vi ngoài phạm vi. `immutableSnapshot`/`orchestrationTargetHash` được trích từ B1 sang helper đúng như brief đề xuất; token create của B1 vẫn ở `service.ts`. Hai factory `createAssistantDecisionRecorder`/`createAssistantDependencyWriter` được export để `service.ts` import. Vì core persist là private và chỉ nhận permission từ closure của chính factory, việc export này không mở đường mint quyền mới (tương đương gọi `createTicketServices({assistant})`).

**Hiểu sai:** không có. Refactor generic `addDependency` có đổi nhẹ trình tự: khóa ticket trước khi kiểm closed, và thêm SELECT kiểm duplicate trước INSERT. Mã lỗi và kết quả không đổi; 23505 vẫn được giữ làm fallback.

⚠️ Không kiểm được từ diff:
- Dependency không có actor ở bảng hay event. Việc "actor máy thật" phụ thuộc vào composer tương lai (B3) có journal bằng actor A hay không. Test hiện chỉ chứng minh điều đó qua fixture `mutate`.
- Lỗi trả về trước authority (404 / 409 DEPENDENCY_SCOPE / REVISION_CONFLICT / DEPENDENCY_EDIT_NOT_ALLOWED / SOURCE_UNVERIFIED) cho phép một máy dò sự tồn tại và trạng thái ticket trước khi scope được xác minh. Đây là hệ quả do plan bắt buộc (validate trước verify). Rủi ro thấp vì UUID v4 và máy thuộc owner, nhưng B3 cần ghi nhận khi mở port ra transport.
- Report nói GREEN 118/118, tsc và Biome đều pass. Em không chạy lại; hash trong log chưa được đối chiếu.

### Strengths

- Capability được cắt đúng chỗ: `prepare` chỉ mint context dựa trên ID lấy từ payload đã capture (so khớp với `ticketIds` sau khi canonicalize, dedup và sort). `authorize` gắn với factory `owner` và cùng `tx`. `consume` tính lại hash và kiểm membership root/project. Kiểu brand cộng WeakMap/WeakSet không mint được từ JSON hay cast.
- Không có lock hay callback nào chạy sau verify: docs reader chạy trước verify và đúng một lần (test `trace ['docs','verify']`), không gọi lại trong persist.
- Cả bốn đường lỗi chính đều có test khẳng định state (decisions/dependencies/revisions/events) không đổi, và với invariant thì khẳng định verify không được gọi. Test ACL generic dùng bearer máy thật và authenticator thật, không dùng mock.
- Case self-edge khác chữ hoa/thường đã có test: ID gửi lên được dedup nhưng CTE vẫn bắt được cycle (409).
- Việc thay non-null assertion là chấp nhận được. Hai nhánh `if (!first)` (`assistant-access.ts:225–226`) và `if (!ticket)` (`decisions.ts:444–445`) đều không reachable, vì `submitted.length` đã được chặn bằng VALIDATION và mỗi ID đều có row hoặc ném 404. Khi bị vi phạm, chúng từ chối thay vì cho đi tiếp. Hành vi các đường reachable không đổi.

### Issues

#### Critical
Không có.

#### Important
Không có.

#### Minor

**M1 — `assistant-access.ts:225–226`, `decisions.ts:444–445`: guard không reachable trả 403 nghiệp vụ.**
- Vấn đề: lỗi invariant nội bộ được báo thành `ORCHESTRATION_SCOPE_INVALID` 403, trông giống một lần từ chối scope bình thường.
- Tại sao: nếu sau này refactor làm nhánh này reachable, bug sẽ bị che dưới dạng lỗi quyền và khó chẩn đoán.
- Sửa (tùy chọn): giữ nguyên vì fail-closed là đúng, hoặc ném `new Error('ASSISTANT_PREPARED_EMPTY')` (500) và thêm comment "unreachable: prepare rejects empty submitted".

**M2 — DRY: `decisions.ts:394,445`, `dependencies.ts:550` dựng `new ApiError('ORCHESTRATION_SCOPE_INVALID', …)` inline, trong khi `assistant-access.ts:157` đã có `invalidScope` (private).**
- Thêm: regex `uuid` bị lặp giữa `assistant-access.ts:156` và `service.ts` (B1).
- Sửa: export `invalidScope` (và `uuid`) từ `assistant-access.ts`, rồi dùng lại ở hai producer và ở B1.

**M3 — `test/assistant-mutations.test.ts:1122–1160`: tên test "denies cross-Tx token reuse" nói quá những gì test chứng minh.**
- Vấn đề: lần từ chối ở Tx thứ hai đến từ allowlist của test (không có entry cho tx đó → `TEST_TRUST_DENIED`), không đến từ các kiểm tra `preparations.tx` / `permissions.tx` / dùng-một-lần / `owner` của token private.
- Tại sao: các kiểm tra của token (`assistant-access.ts:256,274–288`) hiện không có test nào chạm tới. Một regression ở đó (ví dụ bỏ `permissions.delete`) sẽ vẫn GREEN.
- Sửa: thêm một unit test nhỏ trên các hàm đã export: `createAssistantAccess(stub)` → `prepare` ở tx1 → `authorize` ở tx2 phải ra `ORCHESTRATION_SCOPE_INVALID`; `authorize` hai lần phải bị từ chối; `consumeAssistantScope` hai lần phải bị từ chối; dùng `prepared` của factory khác phải bị từ chối. Đồng thời đổi tên test hiện tại thành "captures factory authority; unlisted Tx denied by authority".

**M4 — `decisions.ts:443–446`: decision scoped chỉ validate tĩnh (kind/content/rationale/owner-only) sau khi đã lấy root/ticket/project FOR UPDATE.**
- Vấn đề: một request `owner_answer`/`approval` từ máy, hoặc input sai, vẫn giữ lock project trong một khoảng ngắn trước khi bị 403/400.
- Tại sao: brief chỉ yêu cầu "trước authority" nên spec vẫn thỏa; nhưng phần kiểm thuần đồng bộ có thể từ chối trước khi tranh lock.
- Sửa (tùy chọn): tách phần kiểm đồng bộ của `prepareDecision` (shape, kind chỉ dành cho owner) ra chạy ngay sau `captureAssistantOperation`. Phần deploy và source vẫn để sau `prepare`.

**M5 — `v2/docs/flows/server-tickets.md:25,47`: flow evergreen chứa trạng thái tạm.**
- Vấn đề: các cụm "GREEN118 (5 file test)…, independent review còn chờ", "GREEN đã pass, review còn chờ" và chi tiết lint "không dùng non-null assertion" là trạng thái báo cáo, không phải mô tả hành vi.
- Tại sao: quy tắc documentation-management coi report/trạng thái là record có trạng thái; các dòng này sẽ sai ngay sau review.
- Sửa: chỉ giữ mô tả hành vi và invariant (entry, capture, lock prefix, 503, core dùng chung, ACL không nới). Bỏ count/trạng thái review và chi tiết lint.

**M6 — `decisions.ts` (`prepareDecision`, truy cập `input.kind`): `input === null` đi qua snapshot rồi ném `TypeError` (500) thay vì 400 `VALIDATION`.**
- Tương tự với một phần tử `null` trong `sources` nếu `safeTicketJson` không chặn nó.
- Tại sao: port nội bộ có kiểu chặt nên khó xảy ra. Generic `recordDecision` cũng có lỗi này từ trước (route đã chặn bằng schema). Với entry scoped không có schema, đây là 500 thay vì 4xx.
- Sửa: thêm `!input || typeof input !== 'object'` vào đầu điều kiện VALIDATION của `prepareDecision`, và kiểm từng `source` là object.

### Assessment

**Task quality:** Approved

**Reasoning:** B2a làm đúng và đủ phạm vi đã release, không có phần B2b–B5. Hash payload chính xác, snapshot đồng bộ, prefix lock root → ticket đã sort → project trước verify (nhất quán với thứ tự lock hiện có), 503 khi thiếu authority, chỉ máy được gọi. Core persistence dùng chung, token private cùng Tx và chỉ dùng một lần. Không đổi ACL generic, SQL hay DTO, và production vẫn từ chối mặc định. Test matrix kiểm hành vi thật trên DB thật, kiểm rollback state và kiểm verify không bị gọi khi invariant fail. Việc thay non-null assertion bằng guard fail-closed là hợp lệ vì các nhánh đó không reachable. Sáu finding còn lại đều là Minor (DRY, test token private chưa được chạm trực tiếp, trạng thái tạm trong flow doc, input null trả 500), không làm task mất tin cậy. Nên xử lý M3 và M5 trước khi chốt merge-review của cả nhánh.
