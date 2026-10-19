# FX mac-perms: app Mac đặt lại quyền agent khi thêm project

- Worktree: `~/Documents/projects/crew/.worktrees/crew-roles-fix`, nhánh `r24`
- Commit: `ed5bd3f fix(mac-app): thêm project đặt lại quyền agent Crew trước khi resume` (chưa push)
- Status: DONE

## Kết quả

"Thêm project" của app Mac giờ đặt quyền agent Crew cho mọi agent của project, trước khi resume:
`canCreateAgents: false`, `canCreateSkills: false`, `canAssignTasks` chỉ `true` cho Trợ Lý. Đây đúng là bộ quyền của
`run-step.ts` (`CREW_AGENT_PERMISSIONS`) và `crew/ops/agent-permissions.sh` trong fork, gửi qua
`PATCH /api/agents/:id/permissions`. Bước `check` đọc lại quyền và dừng (không resume) với lời tiếng Việt, ví dụ:
"Quyền của agent landing-executor-1 chưa bị giới hạn (còn được tạo agent, còn được tạo skill, còn được giao việc): bấm
Chạy tiếp để đặt lại".

## Thiết kế

- Việc đặt quyền chạy trong `AddRun.all()` ngay trước bước `check`, khi `check` chưa có trong `done`. Lúc đó agent còn
  `paused`. Việc này không ghi vào `done`, nên mỗi lần Chạy tiếp đều PATCH lại (idempotent). Nhờ vậy:
  - tiến độ của bản app cũ, đã qua mọi bước `role:*` mà chưa đặt quyền, vẫn được đặt khi Chạy tiếp;
  - `ProgressStep`/`app.json` không đổi kiểu, màn hình Project không cần nhãn bước mới;
  - project đã xong (`check` trong `done`) chạy lại vẫn không ghi gì (test cũ vẫn đúng).
- Lúc kiểm, quyền đọc lại từ `GET /api/agents/:id` theo cùng cách `agent-permissions.sh` đọc. `canAssignTasks` tính
  theo việc có grant `tasks:assign` trong `access.grants`, không theo `access.canAssignTasks`, vì server trả `true` cho
  mọi thành viên `active` (`simple_default`). `canCreateSkills` chỉ tính là tắt khi giá trị đúng là `false`, vì mặc
  định của server là cho tạo skill. Response thiếu `access.grants` thì app báo lỗi.

## File đã sửa

- `apps/mac-app/src/main/paperclip/types.ts`: thêm `AgentPermissions`, `setAgentPermissions`, `getAgentPermissions`.
- `apps/mac-app/src/main/paperclip/client.ts`: cài đặt hai hàm trên.
- `apps/mac-app/src/main/projects/add-project.ts`: thêm `crewPermissions`, `restrictPermissions` và `permissionMismatch`, rồi nối việc kiểm quyền vào `check`.
- `apps/mac-app/test/projects-fixture.ts`: Paperclip giả giờ cho agent mới quyền mặc định như server và có route PATCH
  permissions.
- `apps/mac-app/test/projects-add.test.ts`: thêm 3 test. Test chạy đủ cũng kiểm thêm quyền và thứ tự PATCH trước
  resume.
- `apps/mac-app/test/paperclip-client.test.ts`: thêm 2 test.
- `docs/flows/mac-app-paperclip.md`: sửa bảng REST, bảng các bước thêm project và mục Tests (luật R3).

## Kiểm tra

- `npx vitest run` (apps/mac-app): 45 file, 564 test đều đạt.
- `npx tsc --noEmit -p tsconfig.json`: không có lỗi.
- `biome check` trên các file đã sửa: không có lỗi.
- `crew-docs check --staged` và `check --range 3ef7a88..HEAD`: đạt.
- Không đụng `apps/crew-mac`, không build hay cài app.

## Câu hỏi còn mở

- Agent `role: ceo` vượt mọi kiểm quyền. App không tạo agent role ceo nên không chặn riêng trường hợp này. Nếu server
  ép quyền thì `check` vẫn báo lệch grant `tasks:assign`.
- Skill policy và inbox policy của company (phần còn lại của `agent-permissions.sh`) không nằm trong phạm vi việc này.
