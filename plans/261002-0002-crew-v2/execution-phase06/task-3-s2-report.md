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

## Vòng sửa 1 (theo `task-3-s2-review.md` và ruling PM)

Commit `4653b89`. Mọi mục đều có RED trước khi sửa source.

| Mục | Sửa | Test |
|---|---|---|
| I1 | `artifactState` lấy artifact mới nhất của bước theo `fence` của attempt rồi `created_at` của evidence, chỉ tính attempt của binding hiện hành; nếu nhiều row cùng mốc thì tất cả phải cùng SHA. Hỏi hoặc duyệt bytes cũ trả 409 `WORKFLOW_ARTIFACT_SUPERSEDED`, gate vẫn `pending`. `reject` bytes cũ vẫn được, để gate không bị kẹt. | approve X sau khi Y xuất hiện → 409 và không ghi row nào; hỏi lại X → 409; ghi lại X thì duyệt được; reject X sau Y → `rejected`. |
| W7 | Schema không có quan hệ supersede hay cột thời gian trên `workflow_runs`. "Run mới hơn" lấy theo thứ tự journal: `min(events.cursor)` của các `ticket.created` thuộc ticket bước, cùng cách `readRun` đang sắp bước. Không thêm cột. Run có run mới hơn trên cùng root trả 409 `WORKFLOW_RUN_SUPERSEDED`, cả khi hỏi (mọi câu hỏi gắn run) lẫn khi trả lời. | seed run mới hơn bằng SQL (producer supersede thuộc lát sau) → trả lời và hỏi đều 409, không ghi row nào. |
| M1 | `recordGateAnswer` khóa `event_cursor` trước root. Precondition ghi trong JSDoc và docs flow (bước 17). | Tx trần chờ khóa root; một kết nối khác `select … event_cursor for update nowait` nhận `55P03`. |
| M2 | `ownershipPath` theo quy ước path của server docs (`validPath`, phân biệt hoa thường): bỏ segment `./` và một `/` cuối; từ chối `..`, path tuyệt đối, `//`, `\`. Hai unit xung đột khi path bằng nhau hoặc là cha/con. | `./src/a.ts` với `src/a.ts`, `src/db` với `src/db/011.sql`, `src/db/` với `src/./db/x.ts` → 409; 5 key xấu → 400; `src/db` với `src/dbx/a.ts` → hợp lệ. |
| M3 | Thêm `parallelUnits(value, shapeError)` export từ `gates.ts`, dùng cho cả gate kế hoạch lẫn `runs.ts units()`. `runs.ts` giờ chỉ còn kiểm identity của run. | Run `bounded`: path lồng nhau → 409 CONFLICT; `dependsOn` → 409 DEPENDENCY; `../a.ts` → 409 SCOPE_MISMATCH. Toàn bộ test song song cũ của S4 vẫn xanh. |
| M4 | Union `OperationRequest` thêm `{action:'ask_owner'; payload: QuestionProposal}`; `gates.ts` bỏ cast. Hash vẫn giữ tag `crew-v2:operation-request:1`. | RED là lỗi tsc TS2322 trên một `OperationRequest` có kiểu `ask_owner`; GREEN so hash với oracle có tag. |
| M5 | Không đổi source: các ca này đã bị từ chối sẵn. | Decision đã trả lời của gate thiết kế dùng cho câu hỏi gate spec → 409; approval của owner mang scope câu hỏi nhưng nằm trên ticket ở root khác → 409; câu hỏi đã trả lời → 409. Không ghi row nào. Ca (d) của review không xảy ra được, vì state được kiểm dưới khóa và hai UPDATE có điều kiện chạy trong cùng savepoint của `recordGateAnswer`; gọi `answerGate` trần thì caller nhận lỗi và phải rollback Tx của mình. |

**Hành vi S4 đã thay đổi trong `runs.ts`** (chỉ những chỗ hai luật trước đây lệch nhau):
1. Ownership so trên path đã chuẩn hóa, và path lồng nhau giữa hai unit giờ là xung đột.
2. Ownership key phải là path tương đối hợp lệ, mỗi unit tối đa 64 key. Trước đây chấp nhận mọi chuỗi 1–512 ký tự.
3. Unit có field lạ giờ bị 409 `WORKFLOW_PARALLEL_SCOPE_MISMATCH`. Trước đây field lạ bị bỏ qua.
4. Key trùng trong cùng một unit giờ là lỗi shape (409 `WORKFLOW_PARALLEL_SCOPE_MISMATCH`). Trước đây là 409 `WORKFLOW_PARALLEL_OWNERSHIP_CONFLICT`.
5. Run giờ nhận diện `dependsOn`: danh sách không rỗng trả 409 `WORKFLOW_PARALLEL_DEPENDENCY`.

Phía gate cũng có một thay đổi: `dependsOn` trở thành tùy chọn (không có nghĩa là `[]`). `ownershipKeys` vẫn được lưu nguyên như owner gửi; chuẩn hóa chỉ dùng khi so xung đột.

**TDD và kiểm tra**

| Lượt | Kết quả | Log SHA (16) |
|---|---|---|
| RED run1 | Test khóa M1 treo đến timeout 120 s, vì test không nhả khóa khi assert sai. Đã dừng đúng process của lát (SIGTERM); container và lock đã được dọn. Test M5 sai thứ tự snapshot (`before` chụp trước khi seed decision). Sửa cả hai test, không đụng source. | `2800acafdba60cd6` |
| RED | 29 test: 24 pass, 5 fail đúng ngữ nghĩa (I1, W7, M1, M2 gate, M2/M3 run). Các ca M5, reject sau Y và runtime `ask_owner` vốn đã pass (là test bổ sung độ phủ). | `d0dbebfb3fd07667` |
| RED tsc (M4) | TS2322 `'ask_owner'` | `eea92583ec1d33c4` |
| GREEN run1 | 29/29 | `06927dc16955ec7b` |
| GREEN (8 tệp S2/S4/S5) | 235/235 (227 cộng 8 mới) | `5e05469fcb4a5985` |
| Hồi quy | 102/102 | `8ce4f2607a217b50` |
| Biome (gates, runs, operation-request, test) | 0 lỗi, 0 warning | `7eca6ebe0b0e2fdf` |
| tsc strict scoped | exit 0, log rỗng | `e3b0c44298fc1c14` |

Docs: cập nhật `assistant-workflows.md` (bước 11, 15, 17, 18 và phần test) và `server-assistant.md` (mục 11: `ask_owner` trong danh sách payload). Không đổi manifest. `crew-docs` `generate` (không thay đổi), `check --all` và `check --staged` đều ok trên mirror; hook commit cũng ok.

Tài nguyên: mọi lượt nặng đều giữ lock với owner `s5-gates` và có `heavyEligible=true`. Sau mỗi lượt: 0 DB, 0 container, không còn `node --test` của lát.

**Concerns vòng 1**
- Chuẩn hóa path phân biệt hoa thường theo quy ước server docs. Trên FS không phân biệt hoa thường (macOS), `Src/A.ts` và `src/a.ts` vẫn lọt. Cần T7 đối chiếu với tập file thực tế.
- Thứ tự "mới nhất" của artifact dựa vào `fence` rồi `created_at` (`now()` của Tx ghi). Vì evidence không có cột thứ tự riêng, các row cùng mốc được xử lý thận trọng: phải cùng SHA mới coi là hiện hành.
- `WORKFLOW_RUN_SUPERSEDED` suy từ thứ tự journal vì schema không có quan hệ supersede. Lát superseding sau này nên ghi quan hệ tường minh, hoặc đóng các gate của run cũ.
- W1–W6: chuyển ledger theo chỉ đạo, không làm trong lát này.

## Vòng sửa 2 (follow-up của `task-3-s2-fix1-re-review.md`)

Commit `cb02a7d`. Test viết trước source.

| Mục | Sửa | Test |
|---|---|---|
| N3 | Trước đây `assertRunCurrent` coi run là hiện hành khi không xác định được thứ tự (fail-open). Giờ hàm đọc cursor `ticket.created` đầu tiên của từng run trên root và trả 409 `WORKFLOW_RUN_SUPERSEDED` khi run này không có cursor, khi một run khác của root không có cursor, hoặc khi có run mới hơn. | Một run và ticket bước được seed bằng SQL, không có event nào. Câu hỏi gắn run → 409, không ghi row nào. |
| N2 | `assertRunCurrent` và `readRun` thêm điều kiện `e.project_id = <project của root>` để dùng index `events_project_cursor_idx` sẵn có. Không thêm index, không thêm migration. | Đây là thay đổi hiệu năng, không đổi hành vi. Các test thứ tự bước của S4 (DAG, chuỗi path) vẫn xanh. |
| N4 | Chỉ khi so xung đột, key được so theo `decodeURIComponent(path).normalize('NFC').toLowerCase()`, áp cho cả trùng trong một unit lẫn path lồng nhau giữa các unit. `validPath` vẫn kiểm cả dạng đã decode. Giá trị lưu không đổi. | `Src/A.ts` với `src/a.ts`, NFD với NFC, `src%2Fdb` với `src/db/x.ts`, `src/%61.ts` với `src/a.ts` → 409, không ghi row nào. Duyệt hợp lệ lưu `scope.parallel` đúng như owner gửi (`Src/A.ts`, `web/B.tsx`). |
| N1 | Theo ruling PM, không đổi code. Docs flow ghi: mỗi gate có đúng một artifact hiện hành; bước sinh nhiều file phải gói thành một artifact. | — |

| Lượt | Kết quả | Log SHA (16) |
|---|---|---|
| RED | 31 test: 29 pass, 2 fail đúng ngữ nghĩa (N4, N3) | `ebc6801f00512fb7` |
| GREEN (8 tệp S2/S4/S5) | 237/237 (235 cộng 2 mới) | `423fa10800b0ff81` |
| Hồi quy | 102/102 | `761402c3b20648c3` |
| Biome (4 file) | 0 lỗi, 0 warning | `3f4bb0fad1fdaf80` |
| tsc strict scoped | exit 0, log rỗng | `e3b0c44298fc1c14` |

Docs: `assistant-workflows.md` (bước 15 và 17, phần test). `crew-docs check --all` và `--staged` ok trên mirror; hook commit cũng ok. Tài nguyên giữ như các vòng trước: lock owner `s5-gates`, `heavyEligible=true`, sau mỗi lượt còn 0 DB, 0 container, 0 `node --test`.

**Concerns vòng 2**
- N5: `workflow_steps.ownership_keys` vẫn lưu key thô. Consumer T7 phải dùng cùng quy tắc so xung đột. Hàm `conflictKey` hiện là private trong `gates.ts`; nên export khi T7 nối, hoặc ghi vào checklist T7.
- Một run được restore mà thiếu event `ticket.created` sẽ khóa mọi gate của root đó (đóng an toàn). Muốn gỡ thì phải khôi phục event hoặc tạo run mới.
