# Báo cáo S5 — T3-S2: gate workflow (`createOwnerQuestion`, `recordGateAnswer`, `answerGate`)

Worker: s5-gates (Claude Opus 5.5). Commit lát: `2bdc332`. Worktree `/Volumes/CORSAIR/Projects/my-crew-v2`, nhánh `codex/crew-v2-server`, BASE `bbfebaf`. Node v24.21.0, pnpm 10.32.1.

## Kết quả

**DONE_WITH_CONCERNS.** `v2/server/src/assistant/gates.ts` (mới) cung cấp `createWorkflowGates({resolver, lookup?})`, trả về ba hàm: `createOwnerQuestion(tx, proof, proposal)`, `recordGateAnswer(tx, owner, {questionId, expectedRevision, scopeSha256, artifactSha256, answer})` và `answerGate(tx, questionId, decisionId)` với chữ ký giữ nguyên như đã đóng băng. Module còn export hai hàm thuần `gateScopeSha256` và `questionScopeSha256`. Không sửa source đã nghiệm thu (authority, orchestration, runs, workflows, operation-request), không thêm migration, không mở route. Production vẫn bị từ chối: chưa inject resolver, port hay route trả lời.

Test: GREEN 227/227 (217 cũ cộng 10 test gate mới). Hồi quy 102/102. Scoped strict tsc exit 0, log rỗng. Biome 0 lỗi, 0 warning. `crew-docs check --all` và `--staged` đều ok.

## Hành vi

**`createOwnerQuestion` (tool `ask_owner`)**
- Câu hỏi bắt buộc gắn một ticket; thiếu thì 422 `WORKFLOW_QUESTION_TICKET_REQUIRED`.
- Thứ tự khóa root → project → resolver Actor persisted. Sau đó scope của proof phải đúng root/project và có tool `ask_owner`, nếu không thì 403.
- Row operation pending phải ghi trong chính Tx (`xmin`), cùng turn và snapshot với scope, và có `request_hash = operationRequestSha256({action:'ask_owner', payload})` tính trên đúng proposal đã gửi. Hash lệch trả 403; row của Tx trước trả 404.
- ID câu hỏi dẫn xuất từ `operationId`, nên mỗi operation chỉ hỏi được một lần (lần hai 409 `ASSISTANT_OPERATION_CONSUMED`). `conversationId` phải là hội thoại của turn.
- Câu hỏi gắn gate:
  - gate ID phải nằm trong `gate_ids` của bước, và stage trong criteria phải khớp bảng nguồn đã pin cùng row bước bất biến (409 `WORKFLOW_GATE_UNKNOWN`);
  - thiếu artifact trả 409 `WORKFLOW_ARTIFACT_REQUIRED`; artifact chưa xác minh trả 409 `WORKFLOW_ARTIFACT_UNVERIFIED`;
  - definition không còn hiện hành trả 409 `WORKFLOW_DEFINITION_STALE`; BMAD chưa latch render trả 409 `WORKFLOW_RENDER_REQUIRED`;
  - trigger chưa đủ trả 409 `WORKFLOW_GATE_NOT_TRIGGERED`.
- Digest phạm vi do server tự tính và phải bằng `scopeSha256` của proposal (409). Lần hỏi đầu insert row `workflow_gates` bất biến, rồi mới insert câu hỏi. Câu hỏi mới cho cùng gate đánh dấu câu đang mở là `superseded` và lấy revision kế tiếp. Gate đã ghim artifact khác trả 409; gate đã quyết định trả 409 `WORKFLOW_GATE_DECIDED`, nên không phỏng vấn lại.

**`recordGateAnswer`**
- Actor phải là owner, nếu không thì 403 `OWNER_REQUIRED` trước mọi truy vấn.
- Thứ tự khóa root → project → ticket → gate → câu hỏi.
- Câu hỏi đã trả lời trả 409; bị thay hoặc lệch revision trả 409; lệch scope hoặc artifact trả 409.
- `answer = {verdict, option, executionMethod, parallel, text}`.
- Trong một savepoint, server lần lượt:
  1. gọi `recordDecision` generic với Actor owner: kind `approval` cho gate, `owner_answer` cho câu hỏi thường;
  2. ghi `assistant_answers`;
  3. gọi `answerGate`.

  Lỗi ở bất kỳ bước nào hoàn tác toàn bộ, còn Tx của caller vẫn dùng được.

**`answerGate`**
- Khóa và đọc lại toàn bộ các row liên quan.
- Decision của máy, kind `delegated` hoặc sai kind trả 403 `WORKFLOW_GATE_DECISION_INVALID`. Thiếu answer của owner trỏ tới decision trả 403 `WORKFLOW_ANSWER_REQUIRED`.
- Scope của decision phải đúng bằng scope dựng lại từ các row.
- Gate phải còn `pending`. Digest gate tính lại từ các row hiện hành phải khớp, và artifact phải vẫn được máy hiện hành xác minh.
- Các UPDATE đều có điều kiện, nên gate chỉ tiến một lần; replay trả 409.

**Ruling áp dụng**
- **I2/N1:** gate kế hoạch là gate được `resolvedByGateId` của bước execute trỏ tới. Khi duyệt, phải chọn một `method` trong `executionChoices`. Criteria phải khớp bảng nguồn, và SHA phải bằng skill của definition hiện hành (409 `WORKFLOW_EXECUTION_CHOICE_INVALID`). Lựa chọn đã chọn được ghi vào `scope.executionChoice` của decision.
- **W7:** chỉ gate kế hoạch nhận `parallel = {units:[{key,title,ownershipKeys,dependsOn}], sharedInputSha256}`. Hai phần trùng ownership trả 409; phần có phụ thuộc trả 409; thiếu hash input dùng chung trả 400. Gửi ở gate khác trả 409 `WORKFLOW_PARALLEL_SCOPE_MISMATCH`.
- **M2:** gate `architecture_discussion` chỉ mở khi run có ít nhất ba kết quả `initial_review`/`repair_review` thất bại trên ticket bước của run, và `cycleId` là một trong các cycle đó.
- **W5:** artifact mới không được duyệt qua gate đã ghim artifact cũ; việc đổi artifact hay đổi path cần run mới thay run cũ, nằm ngoài lát này.

## TDD

| Lượt | Nội dung | Kết quả | Log SHA (16) |
|---|---|---|---|
| RED | `assistant-workflows.test.ts`, scaffold chỉ có type, ba hàm ném `NOT_IMPLEMENTED` | 21 test: 11 cũ pass, 10 mới fail đúng ngữ nghĩa (`Error: NOT_IMPLEMENTED` tại lời gọi gate, sau khi fixture đã dựng run thật) | `f54d366f6658fd67` |
| GREEN run1 | cùng file | 21/21 | `51193304c7da5076` |
| GREEN | 8 tệp: workflows, authority, orchestration-port, mutations, orchestration, tickets, deploy, dependencies | 227/227, 54,7 s | `012551fdcc967373` |
| Hồi quy | api-acceptance, assistant-store, attachments-routing, attachments-snapshots, attempts, completion, docs-read, repair | 102/102 | `58977fb5db591fab` |

Test được viết trước source. File source duy nhất có trước RED là scaffold khai báo type, không chứa logic. Lượt check đầu có hai phát hiện Biome (`noUnsafeOptionalChaining`, `useOptionalChain`), đã sửa bằng guard tường minh trước GREEN run1. Lượt cuối: Biome `b54f1072cc144896` (0 lỗi, 0 warning), tsc `e3b0c44298fc1c14` (log rỗng).

Lệnh test: `NODE_OPTIONS=--max-old-space-size=384 CREW_V2_TEST_DATABASE_URL=… CREW_V2_TEST_CONTAINER_ID=… node --test --test-concurrency=1 --test-timeout=120000 <files>`. Typecheck: tsc strict scoped trên `gates.ts`, `workflows.ts`, `runs.ts`, `orchestration.ts`, `operation-request.ts`, hai file test và `support/assistant.ts`.

Mười test mới, nhóm `assistant gates:`:
1. Gate chưa có artifact (hoặc artifact của máy khác, binding cũ, bước khác, kind khác) không tạo row; gate lạ, `cycleId` trên gate on-stage hay scope lệch đều bị từ chối; hỏi đúng thì tạo đúng row gate rồi mới đến câu hỏi; trigger SQL chặn UPDATE/DELETE identity.
2. Operation `ask_owner`: hash lệch, thiếu tool, khác hội thoại, khác root, row đã commit, dùng lại.
3. Máy A/B trả lời bị 403; decision của máy, `delegated`, `owner_answer` trên gate, hoặc approval không có answer đều không làm gate tiến.
4. Câu trả lời đúng tiến một lần: kiểm decision, answer, latch; replay và hỏi lại gate đã duyệt đều 409.
5. Câu hỏi bị thay trả 409; artifact mới bị từ chối ở gate đã ghim; reject.
6. Đổi customization chặn câu trả lời; lỗi DB sau khi decision đã ghi không để lại row nào và caller vẫn commit được.
7. Gate kế hoạch: bắt buộc chọn phương pháp, SHA lựa chọn bị sửa thì 409, phần song song trùng ownership hoặc phụ thuộc nhau thì 409.
8. Ba lần sửa thất bại; review hạ tầng và review đạt không được tính.
9. Câu hỏi không có gate.
10. Gate BMAD cần render đã latch.

Test tự tính digest scope một cách độc lập từ tag và context, không gọi hàm của `gates.ts`.

## Tài nguyên

- Mỗi lượt nặng (RED, GREEN×2, hồi quy, check×2) đều lấy `$TMPDIR/crew-v2-heavy-slot.lock` với owner `s5-gates`, và chỉ chạy khi `heavyEligible=true`, cả trước lúc tạo PG lẫn trước lúc chạy Node. Lần đầu không đủ điều kiện (3,86 GiB) thì chờ, không chạy.
- PG `postgres:18.6`, 256m / 1 CPU / pids 64, loopback ngẫu nhiên (24227, 49730, 37359, 48498), container `crew-v2-test-<uuid>` chạy `--rm`. Sau mỗi lượt: 0 DB, 0 container, 0 `node --test`.
- Scratch dùng riêng `$TMPDIR/crew-v2-s5-gates/`.
- Manifest được sửa dưới `$TMPDIR/crew-v2-manifest.lock`, chỉ thêm một dòng `server/src/assistant/gates.ts`. Hunk web chưa commit trong `flows.yaml` là của worker khác; commit chỉ stage hunk của lát này.
- Docs kiểm trên mirror `git archive HEAD:v2` cộng overlay: `generate` cập nhật `docs/files.md` (1 dòng); `check --all` và `--staged` đều ok.

## File

- Tạo mới `v2/server/src/assistant/gates.ts`.
- Sửa `v2/server/test/assistant-workflows.test.ts`:
  - fixture `runFixture` thêm tùy chọn `tools` (mặc định giữ `['create_run']`) và tham số `proofScopeId` cho `inTurn` (mặc định giữ scope của fixture);
  - thêm helper gate và 10 test.
  - Không sửa `test/support/assistant.ts`.
- Docs: `v2/docs/flows/assistant-workflows.md` (bước 14–18, bảng file, dữ liệu, test), `v2/docs/flows.yaml` (một dòng), `v2/docs/files.md` (sinh lại).

## Concerns

1. **Hash `ask_owner`.** Union `OperationRequest` chưa có `ask_owner`, và `operation-request.ts` không thuộc lát này. `gates.ts` vẫn dùng chính `operationRequestSha256` (có tag), qua một cast có ghi chú, nên dạng hash vẫn là một. Đề xuất: B3 thêm `{action:'ask_owner'; payload: QuestionProposal}` vào union rồi bỏ cast.
2. **Thế nào là "artifact đã xác minh".** Định nghĩa dùng ở lát này: evidence `artifact` trên ticket bước, có đúng `data.sha256`, do attempt của máy và `binding_revision` hiện hành ghi. Mức tin cậy chỉ là `verification:'reported'`, tức máy dự án tự báo; server không đọc lại bytes. Nếu cần mạnh hơn thì phải có producer artifact riêng.
3. **Scope của decision rộng hơn danh sách A7.** Ngoài 7 trường của A7, scope còn có `verdict`, cộng `executionChoice` và `parallel` khi có. Lý do: để lựa chọn thực thi và duyệt song song được ràng vào chính quyết định của owner. T4/T7 đọc lựa chọn từ đây.
4. **Giới hạn phạm vi:**
   - câu hỏi không có ticket (ví dụ hỏi định tuyến chỉ trong hội thoại) bị từ chối 422;
   - gate `delegated` chưa có bước nào dùng, nên bị từ chối 403;
   - `cycleId` chỉ dùng cho gate `after_three_failed_fixes`;
   - chưa phát event journal khi hỏi hoặc trả lời, vì type event nằm ngoài ownership; web/SSE sẽ cần event này.
5. **Gate bị reject giữ run đứng yên.** Muốn đi tiếp hoặc đổi artifact phải tạo run mới thay run cũ (W5), việc này thuộc lát sau. Route `POST /v2/assistant/questions/:id/answers` vẫn là controller mỏng cần review sau lát này.
