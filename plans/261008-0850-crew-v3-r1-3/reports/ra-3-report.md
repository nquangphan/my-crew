# RA-3 — Research và nhánh xếp chồng

- SHA: `3400c1b5f0abc1254be40b0a3e1cc04399c3bdb5`
- File đổi: `crew/agents/executor.md`, `crew/agents/reviewer.md`, `crew/agents/integrator.md`, `crew/agents/instructions.test.mjs`.
- ĐỎ: `node --test crew/agents/instructions.test.mjs` (exit 1). Đuôi log: `tests 35; pass 30; fail 3; skipped 2`; assertion thiếu cụm “không gửi assigneeAdapterOverrides” trong `integrator.md`. Cả ba test mới đều thất bại trước khi sửa instructions.
- XANH: `node --test crew/agents/*.test.mjs` (exit 0). Đuôi log: `tests 55; pass 53; fail 0; skipped 2`.
- Giả định: SHA của `crew-review … verdict=approved` trên issue nền là commit để executor dựng nhánh và reviewer so diff, như ruling hiện tại.
- Lệch plan: bước đầu executor đọc issue trước khi quyết định tạo nhánh, để issue research thật sự không chạy thao tác nhánh; vẫn chọn nền trước mọi sửa file.
- Phụ thuộc quyết định owner: `crew-stack on=<identifier>` hiện triển khai theo plan/ruling nhưng owner chưa gật mục này. Nếu owner chọn cách khác, cần sửa instructions và test trước khi dùng luồng nhánh xếp chồng trong nghiệm thu.

## Sửa F3–F5 (08/10/2026, Asia/Ho_Chi_Minh)

- SHA mới: `d7680140526638382e961e4b076a0e5ebfb2a4c7` trên `crew/r13-roles`.
- File đổi: `crew/agents/assistant.md`, `crew/agents/executor.md`, `crew/agents/reviewer.md`, `crew/agents/instructions.test.mjs`.
- F3: executor và reviewer cùng kiểm A/B có chung gốc, gói, blocker trực tiếp; A done và stage reviewer hoàn tất; `crew-review` đúng tác giả và SHA khớp `crew-commit` mới nhất. Ngoại lệ owner escalation đòi bằng chứng rõ. Executor ghi SHA nền trên B, reviewer đối chiếu và kiểm quan hệ tổ tiên trước diff.
- F4: Trợ Lý đăng comment `crew-plan` chứa payload mọi con và khóa ổn định trước POST đầu. Mỗi wake đối soát mọi revision với mọi con, retry bằng `idempotencyKey` của `createChild`, rồi mới xét đóng gốc.
- F5: `changes_requested` và comment quyết định trên gốc được xử lý trước nhánh mọi con done. Mỗi quyết định có lô sửa riêng, chọn model theo bảng, tạo con sửa và đợi review trước submit lại.

ĐỎ — `node --test crew/agents/instructions.test.mjs` (exit 1), trước khi sửa instructions:

```text
✖ crew-stack: executor và reviewer chỉ nhận cùng SHA nền đã được duyệt
✖ assistant: lưu kế hoạch đầy đủ trước POST đầu, đối soát và tạo tiếp bằng khóa ổn định
✖ assistant: yêu cầu sửa gốc được xử lý trước khi đóng lại
ℹ tests 38
ℹ pass 33
ℹ fail 3
ℹ skipped 2
```

XANH — `node --test crew/agents/*.test.mjs` (exit 0):

```text
ℹ tests 58
ℹ pass 56
ℹ fail 0
ℹ skipped 2
ℹ duration_ms 120.878042
```

- Trước test DB, `ipcs -m` có 5 segment SysV; không cần dọn. Lần thử đầu `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/issues-service.test.ts -t 'createChild applies parent defaults'` không chạy vì thiếu `vitest` (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`). Chạy `corepack pnpm install --frozen-lockfile --offline` thành công; kiểm `ipcs -m` lại (vẫn 5 segment); chạy lại đúng test DB trên embedded Postgres: exit 0, `Test Files 1 passed; Tests 1 passed | 126 skipped; Duration 23.15s`.
- Giả định: `blockedBy[].id` là quan hệ blocker trong response; `blockedByIssueIds` chỉ là input tạo. Stock giữ idempotency key 7 ngày; đối soát marker trước retry xử lý run muộn hơn thời hạn đó. Hai test đối chiếu server vẫn skip trên worktree gói roles, sẽ chạy khi tích hợp.
- Lệch plan cũ: kế hoạch chuyển từ comment sau lô sang trước lô và thêm revision/marker con để phục hồi. O18 đã duyệt `crew-stack on=<identifier>` (ledger 14:06), nên ghi chú "chờ owner" ở phần report lịch sử phía trên không còn là blocker. Chưa chạy nghiệm thu agent thật; cần AC-3 kiểm gián đoạn lô, comment giả và vòng sửa trên API/UI thật.
- Commit sửa tiếp: `9d49582e5d7baa6ca59ff8eb3ecca47d729c4bb2` — trước khi lập lô sửa, đối soát mọi kế hoạch cũ; reviewer nhận diện tác giả marker nền theo tác giả `crew-commit` mới nhất của B (assignee hiện tại đã có thể là reviewer). Test lại `node --test crew/agents/*.test.mjs`: exit 0, `tests 58; pass 56; fail 0; skipped 2`.

## Đổi route tạo con (08/10/2026, Asia/Ho_Chi_Minh)

- SHA mới: `a73ca03746377bc7779cef7e1a9ab93ef3db619f` trên `crew/r13-roles`.
- File đổi: `crew/agents/assistant.md`, `crew/agents/executor.md`, `crew/agents/integrator.md`, `crew/agents/instructions.test.mjs`.
- Assistant tạo con ban đầu, retry tạo nốt và lô sửa đều dùng `POST /api/companies/<companyId>/issues` với `"parentId":"<id gốc>"`. Integrator tạo con sửa và executor khi được yêu cầu tạo con dùng cùng route. `COMPANY_ID` lấy từ `PAPERCLIP_COMPANY_ID`, fallback GET gốc trong cùng shell. Các field cũ trong mẫu assistant được giữ. Không còn chuỗi `/children` trong mọi file vai trò.

ĐỎ — `node --test crew/agents/*.test.mjs` trước sửa instructions (exit 1):

```text
✖ assistant: tạo con có blocker, override và không gửi policy
✖ mọi vai trò tạo issue con qua route company có parentId
ℹ tests 59
ℹ pass 55
ℹ fail 2
ℹ skipped 2
```

ĐỎ bổ sung — sau khi thêm assertion fallback `COMPANY_ID`, cùng lệnh (exit 1): `tests 59; pass 56; fail 1; skipped 2`.

XANH — `node --test crew/agents/*.test.mjs` (exit 0):

```text
ℹ tests 59
ℹ pass 57
ℹ fail 0
ℹ skipped 2
ℹ duration_ms 253.2265
```

- Trước test DB, `ipcs -m` có 5 segment SysV; không cần dọn. `corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/issues-service.test.ts -t 'preserves the parent project when a generic child create inherits workspace linkage'`: exit 0, `Test Files 1 passed; Tests 1 passed | 126 skipped; Duration 33.38s`. Ca này chứng minh generic create gắn `parentId` và kế thừa project/workspace của cha.
- **Phát hiện source đã xử lý theo xác nhận của lead:** probe `createIssueSchema.parse({title, parentId, acceptanceCriteria, blockParentUntilDone, blockedByIssueIds, idempotencyKey})` cho thấy route company bỏ `acceptanceCriteria` và `blockParentUntilDone`. Instructions hiện ghi tiêu chí cuối description và bỏ `blockParentUntilDone`; lead xác nhận stock vẫn phát `issue_children_completed` khi điều kiện parent/child hoàn tất. Probe là lý do cập nhật instructions, không còn là blocker riêng cho gói roles. Test DB nêu trên kiểm quan hệ parent/workspace, không mô phỏng wake.
- Giả định/lệch plan: executor có chỉ dẫn tạo con khi issue yêu cầu nên được thêm mẫu route rõ ràng dù trước đó không có URL cụ thể. Không chạy full suite hoặc E2E theo phạm vi gói.

## Điều chỉnh field child create (08/10/2026, Asia/Ho_Chi_Minh)

- SHA: `cf11c0ed70209184c4761e73afb35061b845f563`.
- Vì route company loại `acceptanceCriteria` và `blockParentUntilDone`, mẫu assistant bỏ hai field; tiêu chí được ghi cuối `description` dưới heading `Tiêu chí nghiệm thu:` (mỗi tiêu chí một dòng `- …`). Executor và reviewer được dặn đọc tiêu chí từ heading đó. Các file vai trò khác không có mẫu tương tự.
- Lead xác nhận stock vẫn wake gốc bằng `issue_children_completed` khi mọi con kết thúc nếu gốc có assignee agent và status không thuộc `backlog/done/cancelled`; không cần gửi `blockParentUntilDone`.
- ĐỎ: `node --test crew/agents/*.test.mjs` — `tests 60; pass 56; fail 2; skipped 2` (assistant còn hai field, executor/reviewer chưa chỉ đọc từ description).
- XANH: cùng lệnh — `tests 60; pass 58; fail 0; skipped 2`.
