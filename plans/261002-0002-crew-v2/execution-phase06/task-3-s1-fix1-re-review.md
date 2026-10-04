# Re-review S4 FIX1 (scoped, lens G1) — `0d4f984..e4b8cd3`

Reviewer: code-reviewer. Phạm vi đọc:
- Diff fix: `v2/server/src/assistant/{operation-request,orchestration,runs,workflows}.ts`, `v2/server/test/{assistant-orchestration-port,assistant-workflows}.test.ts`, `v2/server/test/support/assistant.ts`, flow docs `server-assistant.md` và `assistant-workflows.md`.
- Ruling PM 20:45 (`progress.md`).
- Đối chiếu bytes Superpowers 6.4.2 đã pin cho citation mới.

Không chạy lại test. Phần web trong cùng range thuộc worker khác, không nằm trong phạm vi.

## Verdict từng mục

| Mục | Verdict | Bằng chứng |
|---|---|---|
| I1 + W1 | ADDRESSED | `orchestration.ts` nhánh đơn lẻ kiểm `operation.request_hash === operationRequestSha256(binding.target)` trước khi tiêu op. `authorizeGraph` tự tính `runGraphSha256(graph)` và so `request_hash` với `{action:'create_run', payload:{...request, graphSha256}}`. Không còn tham số hash do caller truyền. Nhánh phần tử graph trả về trước bước kiểm request (op đã được graph tiêu), đúng thiết kế. Test `port.test.ts:847,883` phủ graph lệch, `create_run`↔đơn lẻ↔`read_docs` ở cả hai chiều. |
| I2 | ADDRESSED (kèm N1) | architectural = design → spec → plan → `execute` (`source_path` = writing-plans, `executionChoices` = SDD / executing-plans có SHA, `resolvedByGateId` = gate kế hoạch) → `finish` (finishing-a-development-branch). Citation `subagent-driven-development:120,487`, `executing-plans:104,304` khớp đúng dòng "Use superpowers:finishing-a-development-branch" trong bytes pin. `stepSources` bắt buộc có cả hai lựa chọn. bounded giữ TDD. Test lấy oracle từ archive (`tar`, marker gate, `REQUIRED SUB-SKILL`). |
| I3 | ADDRESSED | `runs.ts parallelApproval`: decision thuộc root khác → `null` (chạy tuần tự). Cùng root nhưng không phải owner/approval → 403. Path khác `bounded` → 409. Việc thu hẹp architectural sang 409 khớp ruling W7 (cần written plan). |
| W3 | ADDRESSED | Trạng thái tiêu op lưu trong `set_config('crew.assistant_consumed_operations', …, true)`, là GUC cục bộ của transaction nên mọi handle savepoint đều thấy. `ROLLBACK TO SAVEPOINT` hoàn lại GUC cùng lúc với các ghi bị hủy. Test `port.test.ts:1107` kiểm hai savepoint cùng op → 409. |
| W4 | ADDRESSED | Toàn bộ ghi của `createRun` nằm trong `tx.savepoint`. Test `workflows.test.ts:874` kiểm lỗi JS của port và lỗi DB (trigger chỉ dùng trong test): caller vẫn commit marker riêng của mình, `rows()` không đổi, root vẫn tạo run được sau đó. |
| M1 | ADDRESSED | Kiểm `attempt.state === 'active'`. Test có thêm case `binding_revision=1` và attempt `uncertain`. |
| M2 | ADDRESSED | `GateSpec.trigger` (`on_stage` hoặc `after_three_failed_fixes`) được ghi vào criteria và có test. |
| M3 | ADDRESSED | Test kiểm từng citation trên bytes archive, kiểm marker của gate, kiểm `REQUIRED SUB-SKILL` khớp `executionChoices`, và kiểm spike không có output `code`/`test`. |

## Kết quả theo từng lens

- **Canonicalization.** `canonicalJson({action, payload})` sắp key, nên thứ tự key không gây mơ hồ. Thứ tự mảng là ngữ nghĩa thật. Trường `action` tách miền giữa `create_ticket`, `decision`, `dependency`, `signal` và `create_run`. Payload của `create_run` chứa `graphSha256`, và digest này có tag `crew-v2:orchestration-graph:1`. Không thấy va chạm giữa các action. Rủi ro còn lại nằm ở transport B3, xem N3.
- **ID dẫn xuất tất định.** `derivedId = sha256(['crew-v2:workflow-run-id:1', operationId, kind, index…])`, định dạng UUIDv8.
  - Không va chạm giữa các turn: `operation_id` là PK duy nhất, và muốn trùng một ID có sẵn phải tìm được preimage SHA-256.
  - Đoán trước được ID: đúng, nhưng không có invariant nào dựa vào việc ID khó đoán. Gate ID vốn đã lộ trong criteria. Cố chiếm trước các ID này cần chính op đó, mà op chỉ dùng được một lần.
  - Lợi ích phụ: replay là idempotent, vì cùng op cho ra cùng graph.
- **Hoàn op khi rollback savepoint.** Không tạo được đường tiêu hai lần. Op được hoàn cùng lúc với toàn bộ ghi của nó. Sau đó op chỉ khớp lại đúng `request_hash` `create_run` của graph đó: hash lệch với mọi mutation đơn lẻ, còn graph tất định nên sinh lại đúng run cũ. Tối đa một lần ghi tồn tại; `WORKFLOW_RUN_EXISTS` và PK chặn lần thứ hai. `GraphEntry` của handle savepoint cũ chỉ còn trong closure của `createRun`, không lộ ra ngoài.
- **Wrapper của test.**
  - Không che lỗi.
  - `f.port` (lazy seed) băm đúng lời gọi, tương đương một transport đúng. Các ca lệch hash có test riêng dùng `realPort` và request tường minh.
  - `catch` trong test all-or-nothing ghi lại mã lỗi và message rồi assert bằng `match`, và kiểm marker = 2.
  - Ghi chú (N4): các ca deny song song giờ nổ trong `createRunRequest`, trước khi có op. Nhánh deny của chính `createRun` vì vậy không được thực thi trong các ca này.
- **`source_path` cố định ở writing-plans.** Hiện chưa có dispatcher nào đọc trường này, nên chưa gây hỏng. Nhưng T4 sẽ dispatch sai nếu đọc `workflow_steps.source_path` hoặc `skill`, vì `skill='plan-execution'` không phải skill có thật trong archive (N1). Cần chốt thành hợp đồng T4.

## Finding mới (đều là Minor, không chặn)

- **N1 — bước `execute` có `skill='plan-execution'` (không tồn tại) và `source_path` = writing-plans.** `workflows.ts` (`key:'execute'`). `executionChoices` chỉ nằm trong `tickets.criteria`, cột này không có trigger bất biến (dù hiện không có writer nào). Yêu cầu bắt buộc cho brief T4:
  - Step có `executionChoices` thì không dispatch khi gate `resolvedByGateId` chưa có decision owner.
  - Khi đã có decision, nạp `sourcePath` của lựa chọn và kiểm SHA với `definition.skills` của run, không tin criteria.
  - Không bao giờ dispatch theo `workflow_steps.skill` hoặc `source_path` của step này.
  - Thêm RED tương ứng ở T4.
- **N2 — `createRunRequest` là planner chạy trước authorization.** Nó chưa qua resolver, nhưng đã khóa FOR SHARE trên `gateway_applied` và `decisions`, và trả 404/409/422. Kết quả là một oracle dò tồn tại và giữ khóa trước khi xác thực. Brief B3: chỉ gọi sau khi resolve proof → scope (A2), bên trong `mutate()` (sau `event_cursor`), và phải coi lỗi của nó là lỗi của tool call.
- **N3 — `operationRequestSha256` chưa có tag schema/version.** Tách miền giữa các tool khác (ví dụ `route_message`, `read_docs`) và các action điều phối chỉ đúng nếu B3 băm **mọi** tool bằng đúng hàm này, với `action` là nhãn riêng của tool, không băm raw body. Nên thêm tag `'crew-v2:operation-request:1'` ngay bây giờ: chưa có giá trị persisted nào phụ thuộc vào hash, nên đổi bây giờ chỉ tốn một lần sửa test. Ghi thành yêu cầu B3.
- **N4 — test deny song song đi qua `createRunRequest`.** `workflows.test.ts` (test parallel). Nên thêm một ca dùng request cố định, như các test 422, để nhánh deny trong `createRun` cũng được thực thi.

## Breakage

Không thấy breakage mới trong đường điều phối. Tôi đã kiểm cụ thể:
- Thứ tự khóa: `gateway_applied` FOR SHARE, sau đó root/project. Đường install report khóa `machines` rồi `gateway_applied`, không chờ ticket/project, nên không tạo chu trình.
- Nhánh S2 đơn lẻ chỉ thêm điều kiện request hash.
- GUC dùng `is_local=true` nên tự reset theo transaction; không rò sang pool connection.

## Assessment

**Task quality:** Approved. I1, I2, I3, W3, W4, M1, M2, M3 đều ADDRESSED. N1–N4 là Minor; N1, N2, N3 cần được ghi vào brief T4/B3.
