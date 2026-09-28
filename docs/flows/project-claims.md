# Dự án và quyền sở hữu máy

> Flow `project-claims`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow project-claims`
> in ra đúng danh sách đó.

## Mục đích

Quản lý project (CRUD cho owner) và quyền sở hữu: mỗi project (và vai trò assistant) thuộc đúng một máy tại một
thời điểm. Một scope chưa ai giữ được gán ngay khi một máy claim; một scope máy khác đang giữ tạo yêu cầu chờ
owner duyệt bằng TOTP. Khi quyền sở hữu đổi, các ticket đang mở của scope đó chuyển theo. Máy đang sở hữu một
project cũng chỉ được tự đề nghị đổi loại project (`platform`) và MCP test UI (`ui_test_mcp`) của nó — thay đổi
không có hiệu lực ngay, chỉ áp dụng sau khi owner xác nhận cùng bằng TOTP.

## Điểm vào

- `apps/api/src/routes/project-routes.ts` — `GET/POST /v1/projects`, `GET/PATCH /v1/projects/:id`,
  `GET /v1/project-change-requests`, `POST /v1/project-change-requests/:id/approve|reject` (owner).
- Route claim nằm ở `apps/api/src/routes/machine-routes.ts` (`POST /v1/machines/:id/claims`,
  `GET /v1/claim-requests`, `POST /v1/claim-requests/:id/approve|reject` — owner) và
  `apps/api/src/routes/daemon-routes.ts` (`POST/DELETE /v1/daemon/claims*`, `GET/POST /v1/daemon/projects`,
  `POST /v1/daemon/projects/:projectKey/change-requests`, `GET /v1/projects/catalog` — daemon; xem flow
  `daemon-api`).

## Các bước

1. `apps/api/src/routes/project-routes.ts` → `projectRoutes`: validate `CreateProjectRequest`/
   `UpdateProjectRequest`, gọi `project-service.ts`.
2. `apps/api/src/services/project-service.ts` → `createProject()`/`updateProject()`: insert/update bảng
   `projects`; key trùng (`isUniqueViolation`) trả `CONFLICT`.
3. `apps/api/src/services/claim-service.ts` → `claim()`: trong transaction, `lockTarget()` khoá đúng một hàng
   (project theo key, hoặc advisory lock `crew.assistant` cho vai trò assistant) rồi đọc `holder` hiện tại.
   - `holder === machineId`: trả `already_owned`.
   - `holder === null`: ghi một `claim_requests` trạng thái `granted` (audit), gọi `bindScope()` để gán chủ và
     dời ticket đang mở, phát `machine.claimed`.
   - `holder` là máy khác: tạo (hoặc tái dùng) `claim_requests` `pending`, phát `claim.requested`; route trả
     202 `{status: pending, claimRequestId}`.
4. `apps/api/src/services/claim-service.ts` → `bindScope()` → `retargetOpenTickets()`: gán lại
   `assignee_machine_id` cho mọi ticket chưa ở trạng thái kết thúc (`TERMINAL_STATUSES`) trong scope; ticket
   đang `todo`/`triage`/`in_progress` (`REDISPATCH`) nhận `ticket.assigned {reassigned: true}` trên máy mới, vì
   máy mới chưa từng thấy sự kiện cũ của ticket đó.
5. `apps/api/src/services/claim-service.ts` → `decideClaimRequest()`: route `machine-routes.ts` xác nhận TOTP
   owner trước khi gọi. Approve: `bindScope()` sang máy yêu cầu, phát `claim.changed` cho cả máy cũ và máy mới.
   Reject: chỉ đổi trạng thái, phát `claim.changed` cho máy yêu cầu.
6. `apps/api/src/services/claim-service.ts` → `ownerAssign()`: owner gán thẳng một project/assistant cho một
   máy (route `POST /v1/machines/:id/claims`), ghi nhận như một claim `approved`, cùng hiệu ứng với approve.
7. `apps/api/src/services/claim-service.ts` → `release()`/`withdrawPending()`: máy tự trả scope đang giữ
   (`bindScope(..., null)`, phát `machine.released`) hoặc rút yêu cầu đang chờ.
8. `apps/api/src/services/claim-service.ts` → `releaseEverything()`: dùng khi thu hồi máy (flow
   `machine-pairing`) — giải phóng mọi project và vai trò assistant máy đó giữ, rút mọi yêu cầu đang chờ.
9. `apps/api/src/services/claim-service.ts` → `createDaemonProject()`: máy tạo project mới từ một thư mục cục
   bộ (mô tả do owner gõ trong app, không đọc từ repo), owner sở hữu ngay, phát `project.created`.
10. `apps/api/src/services/claim-service.ts` → `listDaemonProjects()`, `projectCatalog()`: view cho daemon —
    danh sách project kèm `ownerState` (`mine`/`unowned`/`other`), trạng thái claim đang chờ và
    `pendingChange` (yêu cầu đổi platform/MCP test UI đang chờ của chính máy đó, từ `pendingChangesOf()`);
    catalog rút gọn (id, key, name, description) cho assistant dùng khi định tuyến ticket, không bao giờ đọc
    nội dung repo.
11. `apps/api/src/services/project-change-service.ts` → `requestProjectChange()`: máy sở hữu project gọi qua
    `POST /v1/daemon/projects/:projectKey/change-requests` — không phải máy sở hữu thì `FORBIDDEN` (403); đã
    có yêu cầu `pending` cùng giá trị thì trả lại yêu cầu đó, khác giá trị thì `CONFLICT` (409, kèm
    `details.requestId`); giá trị bằng với project hiện tại thì trả `{status: 'unchanged', requestId: null}`
    (200) mà không ghi gì; ngược lại ghi một `project_change_requests` `pending` và phát `project.change_requested`
    (owner stream) rồi trả 202 `{status: 'pending', requestId}`. Ràng buộc unique một `pending` mỗi project ở
    tầng DB giữ tính bất biến này ngay cả khi có ghi đồng thời.
12. `apps/api/src/services/project-change-service.ts` → `decideProjectChange()`: route
    `project-routes.ts` xác nhận TOTP owner trước khi gọi. Yêu cầu không còn `pending` thì `CONFLICT`. Approve
    cập nhật `projects.platform`/`ui_test_mcp` ngay (QC ticket tạo sau đó dùng `qcDefaultMcps` mới); cả hai
    quyết định đều phát `project.change_decided {requestId, projectId, machineId, status}` nhắm đúng máy đã
    hỏi (không phải owner stream).
13. `apps/api/src/services/project-change-service.ts` → `listProjectChanges()`, `getProjectChange()`: đọc cho
    trang Inbox trên web (`GET /v1/project-change-requests?status=`) và cho `decideProjectChange()` trả về.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/project-routes.ts` | Route CRUD project (owner) | `projectRoutes` |
| `apps/api/src/services/claim-service.ts` | Claim, duyệt, thu hồi, dời ticket theo scope | `claim`, `release`, `decideClaimRequest`, `ownerAssign`, `releaseEverything`, `listDaemonProjects`, `createDaemonProject`, `projectCatalog` |
| `apps/api/src/services/project-change-service.ts` | Máy xin đổi platform/MCP test UI, owner duyệt bằng TOTP | `requestProjectChange`, `decideProjectChange`, `listProjectChanges`, `getProjectChange`, `pendingChangesOf` |
| `apps/api/src/services/project-service.ts` | CRUD project và DTO | `createProject`, `updateProject`, `listProjects`, `getProject`, `toProjectDto` |
| `packages/shared/src/project-schemas.ts` | Schema project, `qcDefaultMcps`, giới hạn mặc định, tên MCP server | `CreateProjectRequest`, `UpdateProjectRequest`, `Project`, `qcDefaultMcps`, `McpServerName` |

## Dữ liệu

- Bảng: `projects`, `claim_requests`, `project_change_requests` (`current_platform`/`current_ui_test_mcp` chụp
  lại giá trị lúc hỏi, `platform`/`ui_test_mcp` là giá trị xin đổi, `status` enum `project_change_status`
  `pending`/`approved`/`rejected`, unique index chỉ một hàng `pending` mỗi project), `machines`
  (`hosts_assistant`, `owner_machine_id`), `tickets` (`assignee_machine_id` bị dời khi scope đổi chủ).
- `packages/shared/src/project-schemas.ts` → `McpServerName`: tên MCP server đúng như Claude Code báo cáo
  (chữ, số, dấu cách, `_ . : @ / -`, 1-200 ký tự, không khoảng trắng đầu/cuối) — chấp nhận cả server plugin có
  namespace (`plugin:claude-mem:mcp-search`) và connector claude.ai có dấu cách (`claude.ai Figma`); trước đó
  một report có `mcpsUsed` chứa tên như vậy bị server từ chối. Dùng lại bởi `UiTestMcp` ở đây và bởi schema
  report/ticket của `packages/shared/src/api-schemas.ts` (flow `ticket-lifecycle`).
- `packages/shared/src/machine-schemas.ts` → `InventoryMcpServer.disabled` là cờ dùng chung với flow
  `machine-pairing`/`daemon-api`, không thuộc file của flow này: nguồn của nó là `ProjectConfig.disabledMcpServers`
  cục bộ trên máy (`apps/daemon/src/config.ts`, flow `daemon-runtime`), không phải bảng `projects` hay claim ở
  đây; daemon đánh dấu nó khi báo cáo inventory và server dùng để từ chối ticket yêu cầu server đó cho project
  này.
- Sự kiện: `machine.claimed`, `claim.requested`, `claim.changed`, `machine.released`, `project.created`,
  `ticket.assigned {reassigned: true}`, `project.change_requested {requestId, projectId, machineId}` (owner
  stream, cũng là một loại thông báo trong `NOTICE_EVENT_TYPES`), `project.change_decided {requestId,
  projectId, machineId, status}` (nhắm đúng máy đã hỏi, không phải owner stream).
- Gọi ngoài: không.

## Flow liên quan

- machine-pairing: `revokeMachine()` gọi `releaseEverything()` ở đây khi thu hồi máy.
- daemon-api: route `/v1/daemon/claims*`, `/v1/daemon/projects`, `/v1/daemon/projects/:projectKey/change-requests`,
  `/v1/projects/catalog` gọi thẳng các hàm của flow này với `actor='agent'`, qua `replyIdempotent()`.
- ticket-lifecycle: `retargetOpenTickets()` cập nhật `assignee_machine_id` của ticket khi quyền sở hữu project
  đổi.
- daemon-scheduling: `dispatchEvent()` ánh xạ `project.change_decided` (như `claim.changed`) sang effect
  `refresh_projects`, để daemon của máy đã hỏi thấy `platform`/`ui_test_mcp` mới ngay.
- desktop-app, desktop-ui: `requestTestSetup()`/`TestSetupSection` gọi route change-requests và hiển thị
  trạng thái đang chờ/kết quả duyệt của máy này.
- web-admin: trang Dự án và Máy hiển thị owner, nút chuyển máy; Inbox có ô duyệt/từ chối chuyển máy và ô duyệt/
  từ chối đổi loại project (TOTP).

## Tests

- `apps/api/test/claims.test.ts`: gán ngay khi chưa ai giữ (kèm event và audit row), yêu cầu chờ duyệt TOTP
  (rồi ticket dời theo), từ chối, rút yêu cầu, gán trùng vai trò assistant thứ hai bị chặn, giải phóng, tạo
  project trùng key bị chặn, view project phía daemon, owner gán lại/thu hồi.
- `apps/api/test/project-changes.test.ts`: chờ duyệt TOTP rồi mới đổi `platform`/`ui_test_mcp` (QC ticket tạo
  sau đó dùng MCP mới); từ chối giữ nguyên project và báo cho máy; máy không sở hữu bị `FORBIDDEN`; idempotent
  — request lại phát lại response, cùng giá trị trả lại yêu cầu đang chờ, giá trị khác `CONFLICT`; giá trị
  bằng hiện tại trả `unchanged`, body sai bị validate, bắt buộc session owner khi duyệt/từ chối.
- `packages/shared/src/project-schemas.test.ts`: `McpServerName` chấp nhận tên plugin có namespace và
  connector claude.ai có dấu cách như Claude Code thật báo cáo, từ chối tên rỗng/có khoảng trắng đầu-cuối/ký
  tự điều khiển; một report với `mcpsUsed`/`mcpsSelected` chứa các tên đó được schema report chấp nhận.
