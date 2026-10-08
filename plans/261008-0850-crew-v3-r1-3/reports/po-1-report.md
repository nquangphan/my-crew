# PO-1 — lọc override của agent

- SHA: `2b9b85e27` (`feat(crew): restrict agent issue adapter overrides`).
- File đổi: `server/src/crew/{model-policy.ts,issue-create-policy.ts,issue-gate.ts}`; `server/src/__tests__/{crew-model-policy.test.ts,crew-issue-create-policy.test.ts,crew-issue-gate.test.ts,crew-issue-gate.db.test.ts}`.
- Kết quả: H4 và H2 từ chối override ngoài `adapterConfig.model`/`effort` với HTTP 422, `crew_override_forbidden`, danh sách `violations`; board và company không cấu hình giữ đường stock. Bảng model chỉ có Sonnet 5 và Opus 5.

## TDD

ĐỎ:

```text
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-model-policy.test.ts
FAIL  src/__tests__/crew-model-policy.test.ts
Error: Cannot find module '../crew/model-policy.ts'
Test Files  1 failed (1)

corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts
FAIL  ... > decideCreatePolicy > agent không thể đặt command, extraArgs, env hay model ngoài bảng
AssertionError: expected { kind: 'set', template: 'child' } to deeply equal { kind: 'reject', … }
Test Files  1 failed (1); Tests 1 failed | 12 passed | 18 skipped

corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-gate.test.ts -t 'chặn override của agent trước đường trả về sớm'
AssertionError: promise resolved "undefined" instead of rejecting
Test Files  1 failed (1); Tests 1 failed | 44 skipped
```

XANH:

```text
corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-model-policy.test.ts
Test Files  1 passed (1); Tests 4 passed (4)

corepack pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-model-policy.test.ts src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts src/__tests__/crew-issue-gate.db.test.ts
Test Files  3 passed | 1 skipped (4)
Tests  62 passed | 49 skipped (111)
```

## Kiểm tra và giới hạn

- `crew-issue-gate.db.test.ts` tự skip toàn bộ; các ca DB trong `crew-issue-create-policy.test.ts` cũng skip do probe embedded PostgreSQL không hỗ trợ trên máy này. Ca H2 không cần DB xác nhận hook ném 422 trước đường trả về sớm; DB không đổi chưa được chứng minh tại đây.
- `corepack pnpm --filter @paperclipai/server typecheck` dừng ở bước build runner vì `sh: cargo: command not found`.
- `corepack pnpm --filter @paperclipai/server exec tsc --noEmit` thất bại ở các import `@paperclipai/plugin-sdk` chưa build và lỗi kéo theo trong file ngoài phạm vi; không thấy lỗi của file Crew trong phần log đã xem.
- Giả định: `createdByAgentId`/`actorAgentId` là dấu nhận diện actor do service stock cung cấp; hook H4/H2 bao trùm các đường ghi service như plan. Không lệch thiết kế; thêm unit test H2 vì suite DB skip.
