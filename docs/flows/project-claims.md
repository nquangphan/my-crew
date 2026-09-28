# Dự án và quyền sở hữu máy

> Flow `project-claims`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow project-claims`
> in ra đúng danh sách đó.

## Mục đích

Quản lý project (CRUD cho owner) và quyền sở hữu: mỗi project (và vai trò assistant) thuộc đúng một máy tại một
thời điểm. Một scope chưa ai giữ được gán ngay khi một máy claim; một scope máy khác đang giữ tạo yêu cầu chờ
owner duyệt bằng TOTP. Khi quyền sở hữu đổi, các ticket đang mở của scope đó chuyển theo.

## Điểm vào

- `apps/api/src/routes/project-routes.ts` — `GET/POST /v1/projects`, `GET/PATCH /v1/projects/:id` (owner).
- Route claim nằm ở `apps/api/src/routes/machine-routes.ts` (`POST /v1/machines/:id/claims`,
  `GET /v1/claim-requests`, `POST /v1/claim-requests/:id/approve|reject` — owner) và
  `apps/api/src/routes/daemon-routes.ts` (`POST/DELETE /v1/daemon/claims*`, `GET/POST /v1/daemon/projects`,
  `GET /v1/projects/catalog` — daemon; xem flow `daemon-api`).

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
    danh sách project kèm `ownerState` (`mine`/`unowned`/`other`) và trạng thái claim đang chờ; catalog rút gọn
    (id, key, name, description) cho assistant dùng khi định tuyến ticket, không bao giờ đọc nội dung repo.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/project-routes.ts` | Route CRUD project (owner) | `projectRoutes` |
| `apps/api/src/services/claim-service.ts` | Claim, duyệt, thu hồi, dời ticket theo scope | `claim`, `release`, `decideClaimRequest`, `ownerAssign`, `releaseEverything`, `listDaemonProjects`, `createDaemonProject`, `projectCatalog` |
| `apps/api/src/services/project-service.ts` | CRUD project và DTO | `createProject`, `updateProject`, `listProjects`, `getProject`, `toProjectDto` |
| `packages/shared/src/project-schemas.ts` | Schema project, `qcDefaultMcps`, giới hạn mặc định | `CreateProjectRequest`, `UpdateProjectRequest`, `Project`, `qcDefaultMcps` |

## Dữ liệu

- Bảng: `projects`, `claim_requests`, `machines` (`hosts_assistant`, `owner_machine_id`), `tickets`
  (`assignee_machine_id` bị dời khi scope đổi chủ).
- Sự kiện: `machine.claimed`, `claim.requested`, `claim.changed`, `machine.released`, `project.created`,
  `ticket.assigned {reassigned: true}`.
- Gọi ngoài: không.

## Flow liên quan

- machine-pairing: `revokeMachine()` gọi `releaseEverything()` ở đây khi thu hồi máy.
- daemon-api: route `/v1/daemon/claims*`, `/v1/daemon/projects`, `/v1/projects/catalog` gọi thẳng các hàm của
  flow này với `actor='agent'`.
- ticket-lifecycle: `retargetOpenTickets()` cập nhật `assignee_machine_id` của ticket khi quyền sở hữu project
  đổi.
- web-admin: trang Dự án và Máy hiển thị owner, nút chuyển máy, và ô duyệt/từ chối trong Inbox.

## Tests

- `apps/api/test/claims.test.ts`: gán ngay khi chưa ai giữ (kèm event và audit row), yêu cầu chờ duyệt TOTP
  (rồi ticket dời theo), từ chối, rút yêu cầu, gán trùng vai trò assistant thứ hai bị chặn, giải phóng, tạo
  project trùng key bị chặn, view project phía daemon, owner gán lại/thu hồi.
