# PO-2 — template research theo nhãn

- SHA: `c7aeef17d` (`feat(crew): route research issues through reviewer and owner`).
- File đổi: `server/src/crew/{issue-policy.ts,issue-create-policy.ts}`; `server/src/__tests__/{crew-issue-gate.test.ts,crew-issue-create-policy.test.ts}`.
- Kết quả: board tạo issue gốc với nhãn `research` cùng company, không gửi `executionPolicy`, nhận `[review reviewer, approval owner]` và 5 vòng review. Issue con, agent, hệ thống và policy board gửi riêng giữ nhánh trước đó. Policy hai stage không có docs/push gate.

## TDD

ĐỎ:

```text
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-create-policy.test.ts -t research
FAIL ... > decideCreatePolicy > board tạo gốc có nhãn research nhận hai stage; con vẫn nhận template con
AssertionError: expected template 'root' to equal template 'research'
FAIL ... > buildCrewPolicy > research qua reviewer rồi owner, không có gate docs hay push
AssertionError: expected [ ['review', …] ] to deeply equal [ ['review', …], ['approval', …] ]
FAIL ... > buildCrewPolicy > research cần owner
AssertionError: expected [Function] to throw an error
Test Files 2 failed (2); Tests 3 failed | 78 skipped (81)
```

XANH:

```text
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-create-policy.test.ts
Test Files 2 passed (2)
Tests 61 passed | 20 skipped (81)
```

## Kiểm tra và giới hạn

- Hai ca DB cho nhãn `Research` và nhãn company khác nằm trong suite tự skip. Probe riêng: `getEmbeddedPostgresTestSupport()` trả `supported: false` sau 5 lần, PostgreSQL init dừng ở `running bootstrap script`. Truy vấn `lower(name)` cùng `companyId` chưa được chạy trên DB ở máy này.
- `corepack pnpm --filter @paperclipai/server typecheck` chưa chạy trọn vì thiếu `cargo`; `corepack pnpm --filter @paperclipai/server exec tsc --noEmit` thất bại do `@paperclipai/plugin-sdk` chưa build và lỗi kéo theo ngoài file Crew. Log lọc không có lỗi `src/crew/` hay test Crew.
- Giả định: `labelIds` đã được stock xác nhận thuộc company sau hook tạo; hook chỉ dùng nhãn để chọn template, không tự hợp thức hóa nhãn lạ. Không lệch plan.
