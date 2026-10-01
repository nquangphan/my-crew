# Hợp đồng miền Crew v2

## Mục đích

Giữ các quy tắc miền của Crew v2 trong một package độc lập để server và host dùng cùng một kết quả quyết định.

## Điểm vào

Các module `src/` xuất hàm thuần để server/host sử dụng; không có network hoặc database ở đây.

- `src/model-policy.ts` → `eligibleModels`.

- `src/workflow-policy.ts` → `samePin, workflowsReady, assertSkillAllowed`.

- `src/ticket-policy.ts` → `transition, recordRepairFailure`.

- `src/completion-policy.ts` → `canComplete, canDeploy`.

## Các bước

1. `test/workspace.test.ts` → `workspace v2 không có dependency ứng dụng v1`: đọc manifest package và kiểm tra tên, dependency runtime.
2. `package.json` → `test`, `typecheck`: chạy kiểm thử Node và kiểm tra kiểu TypeScript riêng cho `v2/`.
3. `src/model-policy.ts` → `eligibleModels`: Loại model khác máy, không khả dụng, nguồn tắt, thiếu capability hoặc chưa áp dụng revision công tắc; trả các ứng viên để Trợ lý xếp hạng.
4. `src/workflow-policy.ts` → `samePin, workflowsReady, assertSkillAllowed`: Kiểm tra máy có đủ hai bộ đúng pin và chặn nguồn skill khác workflow/version/revision/checksum của run. Đây là gate metadata, không thay sandbox runtime.
5. `src/ticket-policy.ts` → `transition, recordRepairFailure`: Chuyển trạng thái theo signal hợp lệ; chỉ nhận khóa status/signal thuộc chính đối tượng, từ chối khóa kế thừa như `toString` và `constructor`. Caller xác nhận process/lease trước signal confirmed. Đếm thất bại của vòng sửa đã thực hiện; đến vòng năm hỏi owner, không đếm lỗi model hay review ban đầu.
6. `src/completion-policy.ts` → `canComplete, canDeploy`: Kiểm tra bằng chứng và các bước bắt buộc; code cần docs đúng commit merge, nghiên cứu cần artifact, docs cần snapshot. Deploy cần ticket deploy hoặc approval đã xác thực.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `package.json` | Cấu hình package và lệnh kiểm tra | `test`, `typecheck` |
| `tsconfig.json` | Bật strict types, type stripping tương thích và không phát sinh mã | `compilerOptions` |
| `test/workspace.test.ts` | Kiểm tra tính độc lập của workspace | `workspace v2 không có dependency ứng dụng v1` |
| `src/model-policy.ts` | Quy tắc miền | `eligibleModels`; `Model, Selection` |
| `test/model-policy.test.ts` | Kiểm chứng hành vi policy | node:test |
| `src/workflow-policy.ts` | Quy tắc miền | `samePin, workflowsReady, assertSkillAllowed`; `Workflow, Pin` |
| `test/workflow-policy.test.ts` | Kiểm chứng hành vi policy | node:test |
| `src/ticket-policy.ts` | Quy tắc miền | `transition, recordRepairFailure`; `Status, Signal` |
| `test/ticket-policy.test.ts` | Kiểm chứng hành vi policy | node:test |
| `src/completion-policy.ts` | Quy tắc miền | `canComplete, canDeploy`; `Completion` |
| `test/completion-policy.test.ts` | Kiểm chứng hành vi policy | node:test |

## Dữ liệu

Các hàm nhận dữ liệu do caller cung cấp và không lưu trạng thái. Package không có cơ sở dữ liệu, sự kiện hoặc lời gọi ra ngoài.

## Flow liên quan

Server và host sẽ gọi các policy này khi tích hợp Crew v2. Giao dịch, lease, đối chiếu tiến trình và xác thực approval nằm ngoài thư viện.

## Tests

`test/workspace.test.ts` kiểm tra package đúng tên và không khai báo dependency runtime.

`test/model-policy.test.ts`: Máy khác, nguồn tắt, config cũ và fallback thiếu vision/tools bị loại.

`test/workflow-policy.test.ts`: Thiếu bộ, checksum sai, target trùng và skill khác revision/workflow bị từ chối.

`test/ticket-policy.test.ts`: Không start/resume running khi chưa reconcile; pause/resume theo gate; từ chối status/signal kế thừa; vòng năm hỏi owner và không reset số vòng.

`test/completion-policy.test.ts`: Docs stale chặn đóng yêu cầu code; docs cần snapshot; mọi loại việc cần đủ bước và bằng chứng; nghiên cứu không cần merge; deploy cần quyền rõ ràng.
