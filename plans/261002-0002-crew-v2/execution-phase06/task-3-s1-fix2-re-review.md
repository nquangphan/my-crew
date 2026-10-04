# Re-review S4 FIX2 (follow-up N3/N4) — `e4b8cd3..01367a9`

Reviewer: code-reviewer. Phạm vi đọc: `v2/server/src/assistant/operation-request.ts`, `v2/server/test/assistant-orchestration-port.test.ts`, `v2/server/test/assistant-workflows.test.ts`, flow `server-assistant.md` và `assistant-workflows.md`. Không chạy lại test.

## Verdict

| Mục | Verdict | Bằng chứng |
|---|---|---|
| N3 — tag schema trong canonical hash | ADDRESSED | `operationRequestSha256` giờ băm `canonicalJson({schema:'crew-v2:operation-request:1', action, payload})`. Tag là hằng export `operationRequestSchema`. Tìm toàn `v2/server` và `v2/gateway` không còn nơi nào tự băm `{action, payload}` không tag; port và fixture `seedToolOperation` đều gọi đúng hàm này. Test mới (`port.test.ts:1152`) dùng oracle độc lập (helper `hash` chỉ là canonicalJson + sha256): hash có tag ≠ hash không tag ≠ hash của tag `:2`. Row ghi hash không tag bị 403 `ORCHESTRATION_REQUEST_MISMATCH` và state không đổi. Flow mục 11 ghi rõ B3 phải băm mọi tool bằng hàm này. |
| N4 — ca deny của chính `createRun` với request cố định | ADDRESSED | `workflows.test.ts:969-980,993-996`: row op được ghi trước với request cố định (`graphSha256` toàn số 0), nên `createRunRequest` không chạy. Deny 403 `WORKFLOW_PARALLEL_APPROVAL_INVALID` và 409 `WORKFLOW_PARALLEL_OWNERSHIP_CONFLICT` vì vậy phải đến từ `planRun` bên trong `createRun`, và `planRun` chạy trước `authorizeGraph`, tức trước khi so hash. Sau đó `rows()` của runs/steps/operations/tickets được so với trạng thái trước. |

## Breakage

Không thấy breakage.
- Đổi công thức hash không phá giá trị persisted nào: chưa có transport production ghi `request_hash`, và mọi test seed đều đi qua `operationRequestSha256`.
- Graph digest (`crew-v2:orchestration-graph:1`) không đổi.
- Logic port và runs không đổi; diff chỉ chạm hàm hash, test và docs.

Ghi chú nhỏ, không chặn: ca `assessment` (decision cùng root nhưng sai kind) vẫn chỉ được kiểm qua `createRunRequest`. Nhánh deny này trùng với ca owner-actor đã có request cố định trong cùng hàm `parallelApproval`, nên không cần thêm.

## Assessment

**Task quality:** Approved. N3 và N4 đều ADDRESSED.
