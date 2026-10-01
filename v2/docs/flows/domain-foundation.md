# Hợp đồng miền Crew v2

## Mục đích

Giữ các quy tắc miền của Crew v2 trong một package độc lập để server và host dùng cùng một kết quả quyết định.

## Điểm vào

Các module `src/` xuất hàm thuần để server/host sử dụng; không có network hoặc database ở đây.

- `src/model-policy.ts` → `eligibleModels`.

- `src/workflow-policy.ts` → `samePin, workflowsReady, assertSkillAllowed`.

## Các bước

1. `test/workspace.test.ts` → `workspace v2 không có dependency ứng dụng v1`: đọc manifest package và kiểm tra tên, dependency runtime.
2. `package.json` → `test`, `typecheck`: chạy kiểm thử Node và kiểm tra kiểu TypeScript riêng cho `v2/`.

3. `src/model-policy.ts` → `eligibleModels`: Loại model khác máy, không khả dụng, nguồn tắt, thiếu capability hoặc chưa áp dụng revision công tắc; trả các ứng viên để Trợ lý xếp hạng.

4. `src/workflow-policy.ts` → `samePin, workflowsReady, assertSkillAllowed`: Kiểm tra máy có đủ hai bộ đúng pin và chặn nguồn skill khác workflow/version/revision/checksum của run. Đây là gate metadata, không thay sandbox runtime.

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

## Dữ liệu

Không có cơ sở dữ liệu, sự kiện hoặc lời gọi ra ngoài trong phần khởi tạo.

## Flow liên quan

Các quy tắc model, workflow, ticket và hoàn tất sẽ được thêm vào flow này ở những phần tiếp theo. Server xử lý giao dịch và lease ngoài thư viện.

## Tests

`test/workspace.test.ts` kiểm tra package đúng tên và không khai báo dependency runtime.

`test/model-policy.test.ts`: Máy khác, nguồn tắt, config cũ và fallback thiếu vision/tools bị loại.

`test/workflow-policy.test.ts`: Thiếu bộ, checksum sai, target trùng và skill khác revision/workflow bị từ chối.
