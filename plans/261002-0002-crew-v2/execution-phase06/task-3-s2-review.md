# Review S5 — T3-S2 gates (`2bdc332`)

Reviewer: code-reviewer (độc lập, spec + quality, lăng kính bảo mật). Phạm vi: `v2/server/src/assistant/gates.ts` (mới, 812 dòng), `v2/server/test/assistant-workflows.test.ts` (+898), docs flow. Đọc thêm caller/callee: `tickets/decisions.ts` (`recordDecision`, `prepareDecision`), `journal/mutation.ts`, `journal/events.ts`, `assistant/operation-request.ts`, `assistant/runs.ts` (`createRun`, `parallelApproval`, `units`, `latchRenderedArtifact`), `assistant/orchestration.ts` (`authorizeGraph`), `assistant/authority.ts` (resolver), `execution/attempts.ts:321` (producer evidence `artifact`), `migrations/011_assistant.sql:114–160, 281–343`. Không chạy lại test (theo brief).

### Spec Compliance

| Yêu cầu (memo S5 / A7 / preflight / ledger) | Kết quả |
|---|---|
| Machine self-answer 403 (`recordGateAnswer` chặn non-owner trước mọi query, `gates.ts:770`) | ✅ |
| Decision sai kind / actor không owner / `delegated` / approval không có answer → 403 (`gates.ts:598–611`) | ✅ |
| Stale / superseded question 409; sai revision/scope/artifact 409 (`gates.ts:775–780`) | ✅ |
| Đúng owner answer advance một lần, replay 409 (UPDATE có điều kiện + latch SQL, `gates.ts:632–639`) | ✅ |
| Gate chưa có artifact → không row, câu hỏi gate-bound bị từ chối; artifact đã xác minh → gate bất biến rồi mới question (`gates.ts:721–761`) | ✅ |
| Parallel approval unit phụ thuộc / trùng path → deny (`gates.ts:516–531`) | ✅ (⚠️ so khớp chuỗi thô, xem M2) |
| A7: một Tx, lock root → step ticket → gate → question; `recordDecision` generic với owner; kind theo `required_actor`; scope 7 trường; insert `assistant_answers`; gọi `answerGate` frozen | ✅ (scope rộng hơn — chấp nhận, xem Security trace) |
| Preflight: `answerGate` từ chối assistant/self, wrong root/kind/revision/artifact, stale question, changed customization, replay | ✅ |
| Preflight: "reused/**superseded artifact** … deny" | ❌ approve artifact cũ sau khi bước đã có artifact mới vẫn thành công (I1) |
| Ledger I2/N1: execute step resolved bằng plan-gate owner decision có SHA | ✅ choice ∈ `spec.executionChoices`, SHA = skill của definition hiện hành (`gates.ts:445–485`) |
| Ledger W5: artifact/path mới → run mới; gate không ghim lại | ✅ trong phạm vi lát (superseding run thuộc lát sau) |
| Ledger W7: parallel chỉ sau written plan + shared-input hashes | ✅ hình thức; ⚠️ hash input dùng chung không được đối chiếu với gì |
| Ledger M2: `architecture_discussion` sau ba lần sửa thất bại | ✅ (đếm cycle thất bại trên toàn run) |
| Request hash tag `crew-v2:operation-request:1`, tách miền theo action | ✅ (qua cast, xem Security trace) |
| phase-06:226 "ask_owner → createOwnerQuestion … + wait intent" | ⚠️ không có wait intent; không nằm trong RED của S5 |
| Production deny, không route HTTP | ✅ |

### Security trace

1. **Machine giả đường quyết định của owner.** `recordGateAnswer` chặn `owner.kind/id` trước query. `answerGate` (export, chữ ký frozen) đọc decision từ DB và yêu cầu `actor_kind='owner' AND actor_id='owner'`, đúng kind, cùng `ticket_id`, có row `assistant_answers` cùng `(question_id, revision)` trỏ đúng decision, `actor_kind='owner'`, và `decision.scope` bằng scope dựng lại từ row + answer body. Machine không ghi được `approval`/`owner_answer` (`decisions.ts:140–143`). Row answer bất biến, unique theo revision, và chỉ `recordGateAnswer` insert. Kết luận: không có đường giả mạo. Owner tự ghi decision `approval` qua route generic cũng không mở được gate nếu thiếu answer (test 1391).
2. **Answer của gate/run/root này advance gate khác.** Scope của decision có `questionId`+`questionRevision`+`gateId`+`runId`+`stepId`. Gate lấy từ `question.gate_id`, run từ gate, và `run.root_ticket_id === root.id`. Không đi chéo được. Chưa có test trực tiếp cho `advance(questionB, decisionA)` (M5).
3. **Artifact cũ / customization đã đổi.** Customization: `currentDefinition` tra lại lookup của máy dự án hiện hành mỗi lần load (`gates.ts:372–385`) ✅. Rebind máy hoặc binding revision mới: evidence cũ không còn xác minh ✅. **Artifact bị thay trên cùng bước: ❌ (I1).**
4. **Replay qua Tx/savepoint.** Question ID dẫn xuất từ `operationId`, operation phải có `xmin = pg_current_xact_id()`. Gate/question dùng UPDATE có điều kiện cộng latch SQL. Savepoint rollback để lại Tx của caller dùng được (test 1627). ✅ An toàn tiếp tục phụ thuộc ruling N2 (transport không UPDATE lại row pending cũ).
5. **Execution choice ngoài `executionChoices` hoặc sai SHA.** `choices.find(method)` chỉ trên danh sách dựng từ `workflowSteps(path)` (code) và đối chiếu từng phần tử criteria. SHA lấy từ `record.definition.skills` của definition hiện hành. Method lạ → 400; SHA bị sửa → 409. Choice đã chọn được ghi vào `decision.scope`. ✅
6. **Lock order / deadlock với `createRun`.** `createRun`: event_cursor (mutate) → root FOR UPDATE → project FOR UPDATE → resolver. Gates: root FOR UPDATE → project FOR SHARE → resolver → ticket → gate → questions → run FOR SHARE. Cùng thứ tự prefix, không có chu trình. `latchRenderedArtifact` khóa run trước và không khóa root, nhưng không chờ gì mà gates đang giữ, nên không có chu trình. Điều kiện còn hở: `recordDecision` → `appendEvent` UPDATE `event_cursor` **sau** khi đã giữ root, nên caller phải giữ event_cursor trước như `mutate()` (M1).
7. **Concern (1) — hash `ask_owner` qua cast.** `operationRequestSha256` chỉ đọc `action` và `payload`, rồi băm `{schema tag, action, payload}` canonical. Chuỗi `'ask_owner'` không trùng action nào của union, nên các miền vẫn tách nhau. Cast chỉ ảnh hưởng type. Nếu transport chuẩn hóa payload khác đi thì lỗi theo hướng đóng (403). Đánh giá: sound. Nên thêm member vào union (M4).
8. **Concern (2) — "verified" = evidence do máy tự báo.** Mức này chấp nhận được cho lát: authority thật là owner duyệt đúng SHA, còn máy chỉ khẳng định bytes. ⚠️ UI/route phải cho owner xem đúng bytes có SHA đó, nếu không thì owner duyệt mù.
9. **Concern (3) — scope rộng hơn A7.** Đúng hướng: `verdict`, `executionChoice`, `parallel` buộc vào decision mà N1/W7 cần. Không trùng shape với `scope.parallel` mà `runs.ts:units()` đọc (cần `rootTicketId/path/definitionSha256`), nên một gate decision không thể bị dùng làm `parallelApprovalId` cho run bounded (bị 409). ⚠️ Chưa có consumer nào hiện thực hóa parallel cho run architectural: `workflow_steps` bất biến và `createRun` đã từ chối parallel cho non-bounded.
10. **Caller identity.** `createOwnerQuestion` không nhận Actor (chữ ký frozen) và bỏ qua giá trị trả về của `resolver` (`gates.ts:663`). `authorizeGraph` thì so `actor.id === resolved.id`. Ràng buộc "máy gọi = máy Trợ lý" hiện chỉ dựa vào việc transport ghi row pending trong cùng Tx (⚠️ cho B3).

### Strengths

- Mọi kiểm tra ở thời điểm trả lời đều đọc lại row dưới lock, trong đó có definition hiện hành, artifact, spec chính thức và digest scope. Không tin bất kỳ giá trị nào caller gửi lên.
- Ghi theo kiểu all-or-nothing trong savepoint, có test lỗi DB chèn giữa chừng chứng minh không để lại row và Tx của caller còn dùng được.
- Test dùng oracle digest độc lập với `gates.ts` và assert `deepEqual` trên toàn bộ row trước/sau mỗi lần bị từ chối, không phải test phantom.
- Fixture `runFixture`/`inTurn` chỉ thêm tham số tùy chọn với default giữ nguyên, nên các test cũ không bị nới.

### Issues

**Critical:** không có.

**Important**

- **I1 — Approve được artifact đã bị thay thế.** `gates.ts:394–402` (`artifactVerified`), dùng ở `:630` và `:733`.
  - **Vấn đề:** chỉ kiểm tra *có tồn tại* một evidence `artifact` với SHA đã ghim. Sau khi gate ghim X, máy ghi artifact Y mới trên cùng ticket bước (bản plan/spec sửa lại); owner vẫn approve X thành công. Test 1568 có tạo Y nhưng chỉ đi nhánh `reject`.
  - **Vì sao quan trọng:** preflight yêu cầu "reused/superseded artifact … deny" và T3 "Mandatory gate cannot accept … stale artifact approval". T4 (N1) sẽ thực thi theo plan tại locator trong workspace, mà lúc đó nội dung đã là Y, khác bản owner đã duyệt.
  - **Sửa:**
    - Lúc trả lời (và lúc hỏi), từ chối 409 `WORKFLOW_ARTIFACT_SUPERSEDED` khi có evidence `artifact` mới hơn trên ticket bước, cùng locator, SHA khác, từ attempt của binding hiện hành. Thứ tự lấy theo `attempts.fence` hoặc `evidence.created_at`.
    - Thêm RED: ghim X → ghi Y → approve X → 409, gate vẫn `pending`.
    - Nếu PM coi nhiều artifact trên một bước là hợp lệ thì cần ruling định nghĩa "artifact hiện hành" (theo locator).

**Minor**

- **M1 — Precondition lock không được ghi.** `gates.ts:791–797`, kéo theo `decisions.ts:194` → `events.ts:40`. `recordGateAnswer` giữ root rồi mới UPDATE `event_cursor`. Nếu route tương lai gọi trong Tx trần (không qua `mutate()`), nó có thể deadlock với writer đã giữ event_cursor và đang chờ root (cùng loại rủi ro với ruling W4). **Sửa:** ghi rõ precondition trong JSDoc của `WorkflowGates`, hoặc tự `select … from event_cursor … for update` ở đầu `recordGateAnswer`/`createOwnerQuestion`. Ghi vào brief của route.
- **M2 — So khớp ownership song song bằng chuỗi thô.** `gates.ts:519–531`. Trùng ownership chỉ được phát hiện khi chuỗi giống hệt. Các cặp như `src/a.ts` với `./src/a.ts`, `Src/A.ts` (FS không phân biệt hoa thường trên macOS), hay thư mục `src/db` với `src/db/x.ts` đều lọt. Spec yêu cầu từ chối "same path/index/migration … even with approval". **Sửa:** chuẩn hóa key (posix normalize, bỏ `./`, so lowercase) và từ chối quan hệ tiền tố thư mục. Hoặc ghi ruling rằng T7 phải đối chiếu lại với tập file thực tế.
- **M3 — Hai validator parallel lệch nhau.** `gates.ts:232–272` và `runs.ts:105–145`. Shape và luật khác nhau (`dependsOn`, `sharedInputSha256`, dedupe ownership trong cùng unit). **Sửa:** dùng chung một hàm thuần validate/conflict cho phần units khi T7 nối consumer.
- **M4 — Cast `as unknown as OperationRequest`.** `gates.ts:166–168`. Đúng về hash nhưng che mất kiểm tra type. **Sửa:** B3 thêm `{action:'ask_owner'; payload: QuestionProposal}` vào union rồi bỏ cast (đúng như report đề xuất).
- **M5 — Thiếu test.** Chưa có các ca: (a) `answerGate(questionB, decisionA)` khi decision của question/gate khác có answer hợp lệ; (b) question của root khác; (c) approve artifact cũ sau khi có artifact mới (ca của I1); (d) caller không bắt lỗi giữa `UPDATE workflow_gates` và `UPDATE assistant_questions` khi gọi `answerGate` trần. Ca (d) hiện không xảy ra được vì state đã kiểm dưới lock, nhưng nên ghi chú.

### ⚠️ (cần ruling/checklist, không phải lỗi của lát)

- W1: DTO route frozen `phase-06:155` là `answer:string`, response `decisionId:null|string`. `GateAnswer` có cấu trúc `{verdict, option, executionMethod, parallel, text}` và luôn tạo decision. PM cần sửa DTO route (I2 bắt buộc chọn method) trước khi viết controller.
- W2: phase-06:226 "ask_owner … + wait intent" chưa làm, ticket không chuyển `needs_input`/`wait_owner`. Ghi vào checklist B3/T4.
- W3: `sharedInputSha256` do owner khai và không được đối chiếu với artifact/plan nào. Consumer T7 phải so khớp. Parallel của plan gate cho run architectural chưa có cách hiện thực hóa vì steps bất biến; cần thiết kế ở T4/T7.
- W4: `createOwnerQuestion` bỏ qua Actor đã resolve (`gates.ts:663`). Binding "máy gọi = máy Trợ lý" dựa vào transport B3 (cùng nhóm với N2/A2). Lỗi 404 trước resolver cho phép dò sự tồn tại ticket, và đã có ruling chống dò ở transport.
- W5: Câu hỏi không có ticket → 422 là thu hẹp so với `OwnerQuestion.ticketId: Id|null`. Hỏi định tuyến trong hội thoại cần ruling. Chưa phát event question/answer cho web/SSE (đã có `decision.created`).
- W6: "Verified" = máy tự báo (`verification:'reported'`). UI phải hiển thị đúng bytes theo SHA cho owner.
- W7: Run cũ sau superseding (W5 ledger) vẫn còn gate `pending` có thể được duyệt, vì `workflow_runs` không có state. Lát superseding phải đóng các gate của run cũ.

### Assessment

**Task quality:** Needs fixes. Cần sửa I1 kèm RED. M1 nên làm cùng (rẻ). M2–M5 tùy PM. Không có đường để machine giả quyết định của owner, không advance chéo gate/run/root, không replay được, không chọn được execution ngoài danh sách hoặc sai SHA, và không có deadlock với `createRun` khi gọi qua `mutate()`.
