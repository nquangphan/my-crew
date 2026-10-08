# PO-3 — đóng đường sửa cấu hình thực thi agent

Ngày 08/10/2026, 15:09 Asia/Ho_Chi_Minh. Worktree `paperclip-r13-policy`, nhánh `crew/r13-policy`.

- Merge theo yêu cầu trước triển khai: `ac7b3ba97` — `git merge --no-ff crew/r13-session`, không conflict; status sạch sau merge, log có `b1ce9b8fc` và `8ba201d31`.
- Commit sửa: `362bdaa8403153d607145a9bbdb08c4927c50e97` — `fix(crew): protect agent execution config across mutation routes`.
- Worktree sạch sau commit. Không push, deploy, SSH hoặc thao tác `~/crew-agents`; không dùng `rm -rf`.

## Thay đổi

| File | Nội dung |
|---|---|
| `server/src/crew/agent-config-gate.ts` | Guard request theo actor/company, chặn key cấu hình thực thi và thao tác thay toàn bộ cấu hình. |
| `server/src/crew/core-hooks.ts` | Interface, implementation và wrapper `beforeAgentMutation`. |
| `server/src/routes/agents.ts` | Chỉ thêm **một dòng middleware hook** sau khi tạo router và một import cuối file. |
| `crew/release/core-hooks.json` | H5 với anchor, đầu callback middleware, mô tả và hai file test. |
| `server/src/__tests__/crew-agent-config.test.ts` | Test HTTP qua router stock, service và PostgreSQL thật; test tồn tại một hook và registry 5 mục hook. |
| `server/src/__tests__/crew-core-hooks.test.ts` | Chuyển nguyên input, truyền lỗi guard và board bỏ qua trước DB. |

`assertNoAgentAdapterConfigMutation` hiện tại không được rollback gọi; service create không có actor chung. Vì vậy H5 dùng một middleware chung trước các handler trong agent router, không thêm hook tại từng route. Hook nhận resolver stock để UUID/shortname/query company giữ hợp đồng hiện tại.

Agent trong company có `loadCrewCompanyConfig` trả `ok` hoặc `invalid` bị HTTP 422, `details.code = crew_agent_config_forbidden`, `details.keys` liệt kê tên key. Không đưa giá trị command/env/model vào lỗi. Các đường được phủ: `PATCH /agents/:id`, `POST /companies/:companyId/agents`, `POST /companies/:companyId/agent-hires`, `POST /agents/:id/config-revisions/:revisionId/rollback`.

Board bỏ qua guard. Company absent giữ stock. Target query kiểm đồng thời id và company, nên agent company khác vẫn nhận 404. Các ca alias, id percent-encoded, path không phân biệt hoa thường và slash cuối đều bị chặn như UUID thường.

## Phạm vi bảo thủ và ruling

Ngoài bốn key `adapterConfig.command/extraArgs/env/model`, PATCH của agent bị chặn khi gửi `adapterType` hoặc `replaceAdapterConfig: true` cùng object cấu hình; mọi rollback snapshot của agent trong company Crew cũng bị chặn. Kể cả gửi lại `adapterType` hiện tại hoặc rollback chỉ khác tên vẫn bị chặn. Board vẫn làm các thao tác này được; agent có thể PATCH name (khi có grant stock) hoặc effort.

Lý do: replacement/rollback có thể xóa key được ghim chỉ bằng bỏ key khỏi snapshot. So sánh snapshot rồi để stock ghi sau đó không nguyên tử với thay đổi board. Phương án bảo thủ đã được nêu qua câu hỏi tùy chọn và commentary, chưa có phản hồi yêu cầu thu hẹp tại thời điểm commit; đây là lựa chọn kỹ thuật được ghi append vào ledger, không coi im lặng là phê duyệt mới của owner. Nếu muốn cho agent rollback không đổi bốn key, cần boundary kiểm nguyên tử và cập nhật phạm vi được phép sửa lõi.

## TDD ĐỎ

Lệnh:

```sh
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-agent-config.test.ts
```

Trước khi thêm H5, các request tấn công trả 200/201. Đuôi log (exit 1):

```text
Test Files  1 failed (1)
     Tests  28 failed | 11 passed (39)
  Start at  15:01:39
  Duration  18.34s
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command failed with exit code 1
```

Các ca self/peer PATCH, create/hire, rollback, replacement, đổi adapter, alias/encoded URL đều ĐỎ; các ca đối chứng stock đã pass. Log đầy đủ: [po-3-red.log](po-3-red.log). Sau đó bổ sung một ca self-update không grant kiểm đủ key và không lộ giá trị; ca này chạy trong lượt XANH cuối.

## XANH và typecheck

```sh
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-agent-config.test.ts src/__tests__/crew-core-hooks.test.ts
```

Đuôi log (exit 0):

```text
Test Files  2 passed (2)
     Tests  49 passed (49)
  Start at  15:07:02
  Duration  22.81s
```

Không skip. Log đầy đủ: [po-3-green.log](po-3-green.log). Snapshot trước/sau lệnh bị từ chối kiểm các bảng `agents`, `agent_config_revisions`, `approvals`, `activity_log` của company không đổi. Model ngoài bảng chỉ là input trong fixture với adapter process, không được invoke.

```sh
node --test crew/release/check-core-hooks.test.mjs
```

```text
tests 9
pass 9
fail 0
skipped 0
```

```sh
node crew/release/check-core-hooks.mjs
```

```text
Hook một dòng: 5/5; mục: 9; lỗi: 0
```

Bốn cảnh báo P1–P4 chưa có PR upstream là cảnh báo cũ.

```sh
corepack pnpm --filter @paperclipai/server exec tsc --noEmit
```

Exit 0, không diagnostic; [po-3-typecheck.log](po-3-typecheck.log) rỗng vì tsc thành công. `git diff --check` cũng exit 0. Không chạy full suite hoặc E2E theo phạm vi implementer.

## Tài nguyên và giới hạn

- Kiểm `memory_pressure`: RAM trống 45% trước test.
- Kiểm `ipcs -m` trước mỗi lượt DB: 5/32 segment, không đầy nên không gỡ segment nào. Sau test vẫn đúng 5 segment ban đầu, các DB test đã cleanup.
- Test chạy ngoài sandbox với PostgreSQL nhúng và router/service thật. Chưa thực hiện API trên spike hoặc gọi agent thật; thuộc AC-3.
- Guard này là boundary HTTP trong `agents.ts`. Không khẳng định chặn caller nội bộ/plugin gọi thẳng agent service ngoài router; đó không phải đường F1 đã giao.
- Sử dụng hết ngân sách hook 5/5. Khi upstream đổi route cần cập nhật matcher và test tương ứng trong module Crew.

Status: DONE
Summary: F1 đã có H5 ở một điểm chung; commit `362bdaa84`, 49/49 server test, 9/9 checker test, typecheck server xanh và checker 5/5 lỗi 0. Phạm vi replacement/rollback bảo thủ được nêu rõ ở trên.
