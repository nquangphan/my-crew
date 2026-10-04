# Review S4 — T3-S1: `createRun` graph, `latchRenderedArtifact` và port delta (graph authorization)

Reviewer: code-reviewer (độc lập, G1 security lens + official-source mapping). Commit `0d4f984` (diff `0d4f984^..0d4f984`, logs loại trừ). Đọc trực tiếp: `v2/server/src/assistant/{orchestration,runs,workflows}.ts`, `v2/server/test/assistant-{orchestration-port,workflows}.test.ts`, `v2/server/migrations/011_assistant.sql`, flow docs, report, memo A4–A7/S4, ruling 17:35, T3 (`phase-06:287–297`). Bytes nguồn đọc từ archive pin `v2/gateway/test/fixtures/workflows/superpowers-6.4.2.tgz` (SHA `29714b2c…331a`) và `bmad-6.12.0.tgz` (SHA `ac05c93f…aed2`), giải nén vào scratchpad; SHA skill khớp `install-report-vector.json`. Không chạy lại test.

Caller trace: `authorizeGraph`, `createWorkflowRuns`, `createRun`, `latchRenderedArtifact`, `runGraphSha256` chỉ có caller trong 2 file test. Không có wiring app/route. Production vẫn default deny.

## Spec Compliance

| Yêu cầu | Kết quả |
|---|---|
| Memo S4 RED (1): hash không có ở máy B → 422, không row | ✅ (`assistant-workflows.test.ts:295`) |
| (2) resolver 503/403 → không row | ✅ (`:341`) |
| (3) architectural `steps[0].sourcePath='skills/brainstorming/SKILL.md'`, design→spec approval→plan+execution method→implement, gate reserved | ✅ chuỗi gate; ⚠️ nguồn bước implement (I2) |
| (3) bounded/bug/spike đúng mapping | ✅ bounded (thiết kế ngắn, không spec/plan), bug (4 pha systematic-debugging), spike (probe approval + research). Spike "không hoàn tất mã sản phẩm" chỉ được mã hóa bằng `kind:'research'`, chưa test (M3) |
| (4) BMAD run `rendered_artifact_id=null`; latch sai máy/attempt/definition/projectRoot → 409; đúng → revision+1; lần hai → 409 | ✅ máy/attempt/definition/customization/kind/lần hai; ⚠️ projectRoot chỉ kiểm nhất quán nội bộ root↔generationPath, chưa ràng vào workspace record (A5.2 yêu cầu); binding_revision lệch chưa test (M1) |
| (5) SQL bất biến | ✅ (`:709`) |
| (6) child `created_actor=A`, DAG đúng, mặc định tuần tự | ✅ (`assertGraph`, `isChain`) |
| (7) `parallelApprovalId` không phải owner → 403 | ✅; nhưng root khác → 403 chặn toàn deployment (I3) |
| Ruling 17:35 (B): pending op cùng Tx (xmin) authorize đúng một tập đã băm, tiêu một lần | ✅ |
| Ngoài tập → 403, dùng lại → 409, Tx khác → 404 | ✅ (`port.test.ts` 4 biến thể ngoài tập, reuse ticket/cạnh, close thiếu, op đã commit, session mang sang Tx khác) |
| `create_run` authorization không dùng được cho mutation đơn lẻ và ngược lại | ❌ chỉ đúng khi cả hai cùng nằm trong một Tx và một bên đã tiêu operation trước (I1) |
| Ghi `assistant_operation_ids` sau mỗi ticket/step/cạnh | ✅; `effect_id` cùng công thức `deriveEffectId` (`gateway/src/runtime/effect-ledger.ts:31-33`) |
| Single-mutation authorization giữ nguyên | ✅ nhánh cũ không đổi; nhánh graph chỉ chạy khi `binding.element` do session đặt |
| Global: không test-trust port, actor A, gate UUID không có `workflow_gates`, migrations freeze, S3b slot `current` + so pin slot, BMAD chỉ `claude` | ✅ |

## Security trace (port delta)

1. **Đường vào authority.** `withTarget` và `authorizeGraph` nội bộ không được export; `binding.element` chỉ do closure `session` đặt; `createPersistedOrchestrationAuthority` (bare) không đặt được element → nhánh graph không chạm được từ bên ngoài. ✅
2. **Thứ tự kiểm.** Shape (400) → hash (403, trước mọi truy vấn) → một graph/Tx → actor phải là machine → khóa root FOR UPDATE → project FOR UPDATE → resolver → scope là root scope đúng root/project → `tool_names ∋ create_run`, `actions ⊇ needed` → op pending, cùng turn, `xmin = pg_current_xact_id()` FOR UPDATE → snapshot input khớp → tiêu op trong tập `consumed` chung. Không có ghi trước khi tất cả pass. ✅
3. **Từng phần tử.** `session.createTicket` so hash input với hash đã băm trên `immutableSnapshot` (không TOCTOU); `verify` kiểm lại binding (action/target hash/identity), rồi `verifyGraphElement`: graph của chính Tx, chưa đóng, actor/proof đúng graph, phần tử chưa dùng, resolver chạy lại, scope action và membership root đọc lại từ row. Cạnh so ID ticket đã được tạo trong chính session. ✅
4. **Hash canonical.** `runGraphSha256 = sha256(canonicalJson(['crew-v2:orchestration-graph:1', graph]))` có domain separation; key UUID chữ thường duy nhất trên cả ticket lẫn cạnh, cặp cạnh không lặp. Thứ tự mảng nằm trong hash nhưng không gây mơ hồ vì graph không được so với giá trị persisted nào. Va chạm chỉ ở mức SHA-256. Điểm yếu thật: `graphSha256` do chính caller tính từ chính payload, nên phép so chỉ chống caller tự mâu thuẫn, không ràng graph vào request đã submit (⚠️W1). Graph được server dẫn xuất từ `{rootTicketId,path,definitionSha256}` cùng row persisted nên chấp nhận được, miễn op được ràng vào đúng input `create_run` (I1).
5. **Tiêu một phần / rollback.** Phần tử bị đánh dấu `used` trong `verify` trước khi service ghi; nếu ghi lỗi thì `ticketId` vẫn null → cạnh phụ thuộc 403, `close` 409 → fail closed. Phần tử còn lại vẫn "authorized" trong Tx nhưng không có tham chiếu nào ra ngoài `createRun` (M4). `createRun` không dùng savepoint: lỗi JS (`ApiError`) sau `insert workflow_runs` để lại row dở nếu caller bắt lỗi rồi commit (⚠️W4). Trạng thái `consumed`/`graphs` khóa theo object Tx; handle savepoint của postgres.js là object khác trên cùng xact (⚠️W3).
6. **Loại operation.** `assistant_tool_operations` (011:244–252) không có cột tool name. Port không phân biệt op của `create_run` với op của tool khác. Xem I1.
7. **Actor.** `createRun` không nhận actor của caller: nó truyền actor do resolver trả vào `authorizeGraph`, nên phép so actor caller ↔ designation (S2 RED 7) thành tautology ở lớp này (⚠️W2).
8. **Dò tồn tại.** `authorizeGraph` và `createRun` khóa root, trả 404 trước resolver, giống nhánh đơn lẻ của S2. Vẫn thuộc ruling A2/B3 (⚠️W9).
9. **Lock order.** createRun khóa root → project → resolver → authorizeGraph (cùng lock, re-entrant) → services (root → ticket → project). Test bọc trong `mutate()` nên giữ `event_cursor` trước, đúng ruling W4 của S2. Caller production phải làm như vậy.

## Official-source mapping verdict

Đối chiếu dòng trích dẫn với bytes đã pin: brainstorming `:44-49` (HARD-GATE từng path), `:65-84` (3 path), `:115-138` (checklist), `:171-189` (flow, terminal state), `:237-261` (spec + User Review Gate); writing-plans `:179-204`; systematic-debugging `:14-20,48,120,143,168-212`; verification `:14-36`; requesting-code-review `:12-18`; BMAD `workflow.md:82-84`, `step-02-plan.md:15-22,36-58`. Trích dẫn đúng dòng.

- **architectural:** chuỗi gate design (từng phần) → spec viết + duyệt → plan review + chọn execution method khớp `brainstorming:46-49` và `writing-plans:181-198`. **Bước implement map sang `test-driven-development` là lệch nguồn** (I2). `writing-plans:200-204` ghi rõ "**REQUIRED SUB-SKILL**: superpowers:subagent-driven-development" hoặc "superpowers:executing-plans". Hai skill này bọc TDD và còn quy định review từng task, review toàn nhánh và `finishing-a-development-branch` (`subagent-driven-development/SKILL.md:8,88-120`; `executing-plans/SKILL.md:75-104,149`). Lý do "cả hai đều bắt buộc TDD" đúng nhưng chưa đủ: bước nạp source đúng lúc sẽ nạp TDD chứ không nạp skill thực thi chính thức. Tôi **không xác nhận** câu hỏi mở 1 của report cho architectural.
- **bounded:** implement → TDD đúng nguồn (`brainstorming:127` "normal development workflow (TDD applies); no plan document"). Review/verify là phần Crew thêm theo T3. ✅
- **bug:** thứ tự 4 pha đúng. Gate `architecture_discussion` (`:190-212`) có điều kiện (≥3 lần sửa hỏng), nhưng criteria của step không ghi điều kiện này (M2).
- **spike:** probe approval (`:44,118`) → investigate/report (`:119-120,188-189`), không có spec/design doc. ✅
- **bmad-dispatch:** step01→05 và CHECKPOINT 1 là gate owner duy nhất. ✅ **bmad-oneshot:** step-01 → step-02 → step-oneshot, không có gate. ✅ Nguồn chọn route tại runtime (⚠️W5).

Kết luận: mapping đúng cho 5/6 path. architectural cần sửa hoặc có ruling PM (I2).

## Test independence

- Report tự nêu lệch TDD: source viết trước, RED chạy trên scaffold `NOT_IMPLEMENTED`, GREEN đạt ngay lượt đầu.
- Test port graph (`port.test.ts:705-961`) kiểm hành vi bằng row thật: actor A, cạnh, không row khi deny, mã lỗi. Phần lớn tương ứng với spec.
- Ngoại lệ là test `:914` "never stand in for each other". Test này chỉ chứng minh **thứ tự tiêu trong một Tx**, tức hành vi mà implementation có, chứ không chứng minh tính độc quyền mà ruling yêu cầu. Đây là dấu hiệu rõ nhất của test soi theo implementation (I1).
- Test mapping (`workflows.test.ts:358,510,585,671`) so với bảng outline literal, chép lại đúng quyết định trong `workflows.ts`. Oracle độc lập duy nhất là `sourceSha256` lấy từ vector S3b. Loại test này không bắt được lỗi chọn nguồn; bằng chứng là I2 vẫn GREEN.
- Test latch kiểm đủ các nhánh deny. Helper `generationPath` của test là bản đơn giản hóa độc lập, không có `slice(0,80)` và không strip dấu `-`. Fixture `projectRoot` chỉ phủ trường hợp basename sạch.
- Kết luận: bộ test đủ tin cho authorization và DB invariant. Chưa đủ cho mapping và tính độc quyền của loại operation. Lệch TDD là vi phạm quy trình (⚠️W8), không tự nó làm hỏng kết quả, nhưng làm hai lỗ hổng trên lọt qua.

## Strengths

- Nhánh graph tách hẳn, chỉ chạy được qua closure. Nhánh single-mutation của S2 giữ nguyên từng dòng.
- Mọi deny xảy ra trước lần ghi đầu tiên. Mọi phần tử resolve lại Actor/scope/membership từ row.
- `createDefinitionLookup` đúng hợp đồng S3b (slot `current`, so pin slot, tính lại digest, đúng một kết quả, BMAD chỉ `claude`).
- Gate UUID chỉ reserve. `assistant_operation_ids` mỗi ticket/cạnh có `effect_id` tương thích gateway.

## Issues

### Critical
Không có.

### Important

**I1 — Operation `create_run` không độc quyền với mutation đơn lẻ.** `v2/server/src/assistant/orchestration.ts:366-411` (graph) và `:252-284` (single).
- **Vấn đề.** Port không biết op pending được ghi cho tool nào; 011 không có cột tool name, chỉ có `request_hash`. Hệ quả:
  - Một op pending bất kỳ trong scope có `tool_names ∋ create_run` (ví dụ op của `route_message`/`assess_ticket`) authorize được cả graph.
  - Một op viết cho `create_run` authorize được một `createTicket`/`decision`/`dependency` đơn lẻ, miễn trong Tx đó không gọi `authorizeGraph` trước.
  - Test `:914` và flow `server-assistant.md` mục 12 ("operation của `create_run` không authorize được mutation đơn lẻ và ngược lại") đang nói quá so với code.
- **Vì sao quan trọng.** Đây là bất biến ruling 17:35 nêu đích danh. Vi phạm nó cho phép một tool call được duyệt cho mục đích A tạo ra mutation của mục đích B, khi transport dispatch sai.
- **Sửa (chọn một, cần PM):**
  - (a) Định nghĩa ngay hàm canonical `toolRequestSha256(tool, input)` ở contracts. `authorizeGraph` nhận thêm `CreateRunInput` (createRun đã có sẵn) và yêu cầu `operation.request_hash === toolRequestSha256('create_run', input)`. Nhánh đơn lẻ từ chối op có `request_hash` bằng hash của `create_run` cùng input, hoặc tốt hơn là B3 ràng `request_hash` cho mọi tool.
  - (b) Nếu giữ ràng `request_hash` cho B3: ghi thành yêu cầu bắt buộc B3 cho cả hai chiều, sửa tên/nội dung test `:914` và flow mục 12 thành "không dùng hai lần trong một Tx".
- Thêm RED: op của tool khác + `authorizeGraph` một mình → deny; op `create_run` + `createTicket` đơn lẻ một mình → deny.

**I2 — architectural: bước implement map sang `skills/test-driven-development/SKILL.md` thay vì skill thực thi chính thức.** `v2/server/src/assistant/workflows.ts:147-162,262`.
- **Vấn đề.** Theo `writing-plans/SKILL.md:200-204`, sub-skill bắt buộc là `subagent-driven-development` hoặc `executing-plans`, chọn ở gate kế hoạch. TDD chỉ là gate từng task bên trong hai skill này. Runtime nạp source đúng lúc sẽ nhận TDD, nên mất review từng task (SDD), review toàn nhánh trên model mạnh nhất (Native) và `finishing-a-development-branch`. T3 (`phase-06:295`, "SDD single plan remain sequential") và T4 ("SDD escalation/final review") cũng giả định SDD là nguồn được biểu diễn.
- **Sửa.** Cột `workflow_steps.source_path` bất biến và chỉ có một giá trị, nên cần ruling PM. Đề xuất:
  - Step implement của architectural trỏ `skills/writing-plans/SKILL.md` (handoff `:179-204`).
  - Criteria `workflowRun.executionMethods = {subagent-driven:{sourcePath:'skills/subagent-driven-development/SKILL.md', sha256}, native:{sourcePath:'skills/executing-plans/SKILL.md', sha256}}` lấy từ definition; `stepSources` bắt buộc cả hai.
  - Dispatch (T4) chọn theo decision của gate `plan_approval_execution_method`. Thêm `finishing-a-development-branch` làm bước cuối nếu PM coi là bắt buộc.
- bounded giữ TDD.

**I3 — `parallelApprovalId` toàn cục trỏ quyết định của root khác làm mọi `createRun` 403.** `v2/server/src/assistant/runs.ts:136-151`.
- **Vấn đề.** Kể cả sau khi run song song đã tạo xong, policy vẫn trỏ root cũ, nên mọi root khác bị chặn cho tới khi owner xóa policy. Owner chỉ duyệt song song được một root tại một thời điểm.
- **Đánh giá.** Không phải lỗ hổng bảo mật vì chỉ owner ghi được policy. Đây là lỗi correctness/availability chắc chắn xảy ra trong vận hành bình thường. Đây cũng là contract của plan (`phase-06:62`), không phải do implementer tự đặt ra.
- **Sửa.**
  - Ngay: decision **khác root** coi là "không có override cho root này", tức trả `null` và chạy tuần tự. Đây là mặc định an toàn, không nới quyền. Decision cùng root nhưng không phải owner/approval vẫn 403 (giữ RED 7).
  - Ở S5/T7 (ruling PM): tra theo root, ví dụ decision `approval` của owner trên root có `scope.parallel` khớp, thay cho con trỏ toàn cục.
  - Thêm RED: policy trỏ root X → `createRun` root Y tạo run tuần tự.

### Minor

- **M1 — latch chưa kiểm trạng thái attempt, chưa test lệch binding.** `runs.ts:397-408`. Attempt cũ/terminal có cùng `binding_revision` vẫn latch được. Nhánh lệch `binding_revision` chưa có test. Sửa: yêu cầu attempt `active` (hoặc theo hợp đồng S6) và thêm test binding_revision lệch.
- **M2 — gate `architecture_discussion` không mang điều kiện kích hoạt.** `workflows.ts:324-330`. Criteria chỉ có `{id, kind, requiredActor, citation}`, nên S5 không phân biệt được gate có điều kiện với gate owner bắt buộc. Flow docs ghi "chỉ materialize sau ba lần sửa thất bại" nhưng dữ liệu không mã hóa điều đó. Sửa: thêm `trigger: 'after_third_failed_fix'` (hoặc `mandatory:false`) vào GateSpec/criteria.
- **M3 — test mapping chép lại bảng nguồn.** `assistant-workflows.test.ts:373,510`. Spike chưa có assert `kind='research'` và `outputKinds` (T3: "no product-code completion"). Nên thêm assert cho kind/outputKinds và một test đối chiếu `citation` với bytes archive (dòng chứa marker như "REQUIRED SUB-SKILL", "HARD-GATE", "CHECKPOINT 1").
- **M4 — session graph không bị "poison" khi có lỗi; shape không chặn chu trình.** `orchestration.ts:513-552,98-146`. Khi một phần tử ném lỗi, các phần tử còn lại vẫn được authorize trong Tx. Hiện không khai thác được vì session không lộ ra ngoài, nhưng nên đặt `graph.closed = true` trong `catch` của `createTicket`/`dependency`/`verifyGraphElement`. Shape cũng nên từ chối chu trình bằng topo-sort để trả 400 thay cho 409 muộn của service.
- **M5 — resolver chạy 2 + N + K lần mỗi `createRun`.** `runs.ts:252`, `orchestration.ts:342,382`. Mỗi lần khoảng 6 truy vấn FOR SHARE, tức khoảng 13 lần với architectural và tới khoảng 40 lần khi chạy song song. Có giới hạn (≤64 ticket / ≤256 cạnh) nên chấp nhận được. Ghi lại cho đo đạc T7.

## Assessment

**Task quality:** Needs fixes. Phải xử lý I1–I3 trước khi khép. I1 và I3 có thể khép bằng sửa nhỏ, hoặc bằng ruling PM có ghi yêu cầu B3/S5 tương ứng. I2 cần ruling PM về cách biểu diễn execution method. Không có Critical: production chưa nối, mọi deny xảy ra trước khi ghi, nhánh S2 không đổi.

### ⚠️ cần PM ghi nhận (không chặn nếu đã có ruling)

- **W1** `graphSha256` do chính caller tính, không ràng vào row persisted; sự ràng buộc thật phải là `request_hash` của op ↔ input `create_run` (gắn với I1).
- **W2** `createRun` không có actor caller. B3 phải so máy đã xác thực với actor do resolver trả trước khi gọi `createRun`, tương đương S2 RED 7.
- **W3** `consumed`/`graphs` khóa theo object Tx. Handle savepoint của postgres.js cùng xact nhưng là object khác, nên single-use có thể bị vượt qua nếu B3 dùng savepoint. Hướng xử lý: khóa theo `pg_current_xact_id()` đọc trong cùng câu truy vấn op, hoặc cấm savepoint quanh port.
- **W4** `createRun` ghi dở khi gặp `ApiError` sau `insert workflow_runs`. B3 phải rollback toàn Tx, không được ghi response `rejected` rồi commit (nếu cần thì kết hợp W3).
- **W5** BMAD dispatch/oneshot do step-02 quyết lúc chạy (`step-02-plan.md:15-22`); oneshot còn quay về dispatch được (`step-oneshot.md:27`); step-04 loopback về 02/03 (`step-04-review.md:62-64`). `path` lại cố định từ lúc `createRun`, nên cần ruling về supersede/repath ở S5/T5.
- **W6** latch ở mức run, trong khi A4 định nghĩa project-root = workspace của attempt. Latch sai thì vĩnh viễn, không có unlatch. Không được nối latch vào caller nào trước khi S6 ràng `projectRoot` vào workspace record.
- **W7** Unit song song của architectural được duyệt trước khi có written plan; T3 còn yêu cầu shared-input hashes mà `scope.parallel` chưa có. S5 nên đặt duyệt song song sau gate plan.
- **W8** Lệch TDD (source trước test). Cần ruling quy trình; I1/I2 là hệ quả quan sát được.
- **W9** 404 khi khóa root trước resolver cho phép dò tồn tại, giống S2; thuộc ruling A2/B3.
