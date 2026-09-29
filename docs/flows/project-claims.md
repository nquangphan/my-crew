# Dự án và quyền sở hữu máy

> Flow `project-claims`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow project-claims`
> in ra đúng danh sách đó.

## Mục đích

Quản lý project (CRUD cho owner) và quyền sở hữu: mỗi project (và vai trò assistant) thuộc đúng một máy tại một
thời điểm. Một scope chưa ai giữ được gán ngay khi một máy claim; một scope máy khác đang giữ tạo yêu cầu chờ
owner duyệt bằng TOTP. Khi quyền sở hữu đổi, các ticket đang mở của scope đó chuyển theo. Máy đang sở hữu một
project cũng chỉ được tự đề nghị đổi loại project (`platform`) và MCP test UI (`ui_test_mcp`) của nó — thay đổi
không có hiệu lực ngay, chỉ áp dụng sau khi owner xác nhận cùng bằng TOTP. Một yêu cầu đổi còn `pending` bị tự
rút (`withdrawn`) ngay khi máy hỏi nó không còn giữ project đó nữa (chuyển máy được duyệt, owner gán lại, máy tự
trả, hoặc máy bị thu hồi) — chỉ máy đang sở hữu mới được đổi loại project.

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
4. `apps/api/src/services/claim-service.ts` → `bindScope()`: gán chủ mới (`ownerMachineId`, hay `hostsAssistant`
   cho vai trò assistant); khi scope là một project, cùng transaction gọi
   `apps/api/src/services/project-change-service.ts` → `withdrawProjectChanges(tx, projectId, to)` — mọi yêu
   cầu đổi platform/MCP test UI còn `pending` của project đó từ máy khác `to` (hoặc mọi máy, nếu `to` là `null`)
   chuyển `withdrawn` (`decided_at` = lúc này), mỗi yêu cầu bị rút phát một `project.change_decided {requestId,
   projectId, machineId, status: 'withdrawn'}` nhắm đúng máy đã hỏi. Rồi `retargetOpenTickets()`: gán lại
   `assignee_machine_id` cho mọi ticket chưa ở trạng thái kết thúc (`TERMINAL_STATUSES`) trong scope; ticket
   đang `todo`/`triage`/`in_progress` (`REDISPATCH`) nhận `ticket.assigned {reassigned: true}` trên máy mới, vì
   máy mới chưa từng thấy sự kiện cũ của ticket đó.
5. `apps/api/src/services/claim-service.ts` → `decideClaimRequest()`: route `machine-routes.ts` xác nhận TOTP
   owner trước khi gọi. Approve: `bindScope()` sang máy yêu cầu (rút luôn yêu cầu đổi project đang chờ của máy
   cũ, xem bước 4), phát `claim.changed` cho cả máy cũ và máy mới. Reject: chỉ đổi trạng thái, phát
   `claim.changed` cho máy yêu cầu — không gọi `bindScope()` nên không rút gì, project giữ nguyên chủ.
6. `apps/api/src/services/claim-service.ts` → `ownerAssign()`: owner gán thẳng một project/assistant cho một
   máy (route `POST /v1/machines/:id/claims`), ghi nhận như một claim `approved`, cùng hiệu ứng với approve
   (`bindScope()`, xem bước 4).
7. `apps/api/src/services/claim-service.ts` → `release()`/`withdrawPending()`: máy tự trả scope đang giữ
   (`bindScope(..., null)`, cũng rút yêu cầu đổi project đang chờ của chính máy đó — xem bước 4 — rồi phát
   `machine.released`) hoặc rút yêu cầu claim đang chờ.
8. `apps/api/src/services/claim-service.ts` → `releaseEverything()`: dùng khi thu hồi máy (flow
   `machine-pairing`) — giải phóng mọi project và vai trò assistant (qua `bindScope()`, nên yêu cầu đổi project
   đang chờ của máy bị rút luôn — xem bước 4), rồi rút mọi yêu cầu claim đang chờ.
9. `apps/api/src/services/claim-service.ts` → `createDaemonProject()`: máy tạo project mới từ một thư mục cục
   bộ (mô tả do owner gõ trong app, không đọc từ repo), owner sở hữu ngay, phát `project.created`.
10. `apps/api/src/services/claim-service.ts` → `listDaemonProjects()`, `projectCatalog()`: view cho daemon —
    danh sách project kèm `ownerState` (`mine`/`unowned`/`other`), trạng thái claim đang chờ, `pendingChange`
    (yêu cầu đổi platform/MCP test UI đang chờ của chính máy đó) và `lastChange` (yêu cầu đổi mới nhất của
    chính máy đó cho project, dù trạng thái là gì — `pending`/`approved`/`rejected`/`withdrawn`); cả hai đọc từ
    `project-change-service.ts` → `changesOf()` (một câu `DISTINCT ON (project_id)` theo máy, `pendingChange`
    chỉ là `last` khi còn `pending`); catalog rút gọn (id, key, name, description) cho assistant dùng khi định
    tuyến ticket, không bao giờ đọc nội dung repo.
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
    hỏi (owner stream vẫn nhận như mọi sự kiện nên danh sách chờ duyệt trên web tự làm mới; không phải loại
    thông báo trong `NOTICE_EVENT_TYPES`).
13. `apps/api/src/services/project-change-service.ts` → `listProjectChanges()`, `getProjectChange()`: đọc cho
    trang Inbox trên web (`GET /v1/project-change-requests?status=`) và cho `decideProjectChange()` trả về.
14. `apps/api/src/services/bmad-profile-service.ts` → `putBmadProfile()`: gọi bởi
    `PUT /v1/daemon/projects/:projectKey/bmad-profile` (flow `daemon-api`) khi máy sở hữu project báo cáo hồ sơ
    cài BMAD (`_bmad/`) nó đọc được, để máy khác cài lại đúng bộ đó qua nút "Cài BMAD". Không phải máy sở hữu
    thì `FORBIDDEN` (403); project không tồn tại thì `NOT_FOUND` (404). Bản ghi mới nhất thắng: một hồ sơ có
    `lastUpdated` cũ hơn hồ sơ đã lưu không được ghi đè (trả `{stored: false, profile: <hồ sơ đang lưu>}`), nên
    một máy nhận project với `_bmad` cũ hơn không xoá mất hồ sơ mới máy khác đã báo. `packages/shared/src/bmad-schemas.ts`
    → `BmadProfile`: từ chối câu trả lời cá nhân (`user_name`, `user_skill_level`, `communication_language` ở
    dạng setting), key giống credential, đường dẫn tuyệt đối và ký tự điều khiển trước khi lưu.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/project-routes.ts` | Route CRUD project (owner) | `projectRoutes` |
| `apps/api/src/services/claim-service.ts` | Claim, duyệt, thu hồi, dời ticket theo scope | `claim`, `release`, `decideClaimRequest`, `ownerAssign`, `releaseEverything`, `listDaemonProjects`, `createDaemonProject`, `projectCatalog` |
| `apps/api/src/services/project-change-service.ts` | Máy xin đổi platform/MCP test UI, owner duyệt bằng TOTP, rút yêu cầu khi máy mất project | `requestProjectChange`, `decideProjectChange`, `listProjectChanges`, `getProjectChange`, `changesOf`, `withdrawProjectChanges` |
| `apps/api/src/services/project-service.ts` | CRUD project và DTO | `createProject`, `updateProject`, `listProjects`, `getProject`, `toProjectDto` |
| `apps/api/src/services/bmad-profile-service.ts` | Lưu hồ sơ cài BMAD do máy sở hữu project báo cáo, chỉ máy sở hữu mới ghi, bản mới nhất thắng | `putBmadProfile` |
| `packages/shared/src/project-schemas.ts` | Schema project, `qcDefaultMcps`, giới hạn mặc định, tên MCP server | `CreateProjectRequest`, `UpdateProjectRequest`, `Project`, `qcDefaultMcps`, `McpServerName` |
| `packages/shared/src/bmad-schemas.ts` | Schema hồ sơ cài BMAD dùng chung server/daemon/desktop, từ chối câu trả lời cá nhân/credential/đường dẫn tuyệt đối | `BmadProfile`, `BmadSetting`, `PutBmadProfileResponse`, `BMAD_PERSONAL_KEYS` |

## Dữ liệu

- Bảng: `projects.bmad_profile` (jsonb, nullable, migration `apps/api/drizzle/0007_project_bmad_profile.sql`,
  flow `api-platform` sở hữu việc migrate) lưu `BmadProfile` mới nhất mà máy sở hữu project báo cáo; đọc lại
  qua `toProjectDto()` (owner) và `listDaemonProjects()` (mọi máy, trường `DaemonProject.bmadProfile`, flow
  `daemon-api`).
- Bảng: `projects`, `claim_requests`, `project_change_requests` (`current_platform`/`current_ui_test_mcp` chụp
  lại giá trị lúc hỏi, `platform`/`ui_test_mcp` là giá trị xin đổi, `status` enum `project_change_status`
  `pending`/`approved`/`rejected`/`withdrawn` — `withdrawn` thêm ở migration `0004_project_change_withdrawn.sql`,
  gán bởi `withdrawProjectChanges()` khi `bindScope()` đổi chủ project sang máy khác máy đang giữ yêu cầu, unique
  index chỉ một hàng `pending` mỗi project), `machines` (`hosts_assistant`, `owner_machine_id`), `tickets`
  (`assignee_machine_id` bị dời khi scope đổi chủ).
- `packages/shared/src/project-schemas.ts` → `McpServerName`: tên MCP server đúng như Claude Code báo cáo
  (chữ, số, dấu cách, `_ . : @ / -`, 1-200 ký tự, không khoảng trắng đầu/cuối) — chấp nhận cả server plugin có
  namespace (`plugin:claude-mem:mcp-search`) và connector claude.ai có dấu cách (`claude.ai Figma`); trước đó
  một report có `mcpsUsed` chứa tên như vậy bị server từ chối. Dùng lại bởi `UiTestMcp` ở đây và bởi schema
  report/ticket của `packages/shared/src/api-schemas.ts` (flow `ticket-lifecycle`).
- `packages/shared/src/machine-schemas.ts` → `InventoryMcpServer.disabled` là cờ dùng chung với flow
  `machine-pairing`/`daemon-api`, không thuộc file của flow này: nguồn của nó là `ProjectConfig.disabledMcpServers`
  cục bộ trên máy (`apps/daemon/src/config.ts`, flow `daemon-runtime`), không phải bảng `projects` hay claim ở
  đây; daemon đánh dấu nó khi báo cáo inventory và server dùng để từ chối ticket yêu cầu server đó cho project
  này. Cùng file còn có `WaitingJob` (nay thêm `waitReason`/`waitDetail`) và `FailedJob` mới, cạnh
  `HeartbeatRequest.waitingJobs`/`failedJobs`, cũng không thuộc claim/project ở đây — dùng bởi cảnh báo
  "ticket đứng yên" và bởi `AgentActivity` mà owner đọc trên ticket, cả hai của flow `ticket-lifecycle` (xem
  flow `daemon-api`).
- Sự kiện: `machine.claimed`, `claim.requested`, `claim.changed`, `machine.released`, `project.created`,
  `ticket.assigned {reassigned: true}`, `project.change_requested {requestId, projectId, machineId}` (owner
  stream, cũng là một loại thông báo trong `NOTICE_EVENT_TYPES`), `project.change_decided {requestId,
  projectId, machineId, status}` (nhắm đúng máy đã hỏi, owner stream vẫn nhận như mọi sự kiện nên danh sách chờ
  duyệt trên web tự làm mới; không phải loại thông báo trong `NOTICE_EVENT_TYPES`) — `status` là `approved`/
  `rejected` khi owner quyết định, hoặc `withdrawn` khi `withdrawProjectChanges()` tự rút yêu cầu vì máy mất
  project.
- Gọi ngoài: không.

## Flow liên quan

- machine-pairing: `revokeMachine()` gọi `releaseEverything()` ở đây khi thu hồi máy.
- daemon-api: route `/v1/daemon/claims*`, `/v1/daemon/projects`, `/v1/daemon/projects/:projectKey/change-requests`,
  `/v1/projects/catalog` gọi thẳng các hàm của flow này với `actor='agent'`, qua `replyIdempotent()`; route
  `PUT /v1/daemon/projects/:projectKey/bmad-profile` gọi `putBmadProfile()` cùng cách.
- daemon-runtime, desktop-app: daemon đọc hồ sơ BMAD từ `_bmad/` cục bộ và gửi lên đây qua `VpsClient.putBmadProfile()`
  mỗi khi đổi; app desktop dùng lại hồ sơ server trả về để chạy trình cài `bmad-method` trên máy khác
  ("Cài BMAD", Settings → Projects).
- ticket-lifecycle: `retargetOpenTickets()` cập nhật `assignee_machine_id` của ticket khi quyền sở hữu project
  đổi.
- daemon-scheduling: `dispatchEvent()` ánh xạ `project.change_decided` (như `claim.changed`) sang effect
  `refresh_projects`, để daemon của máy đã hỏi thấy `platform`/`ui_test_mcp` mới ngay.
- desktop-app, desktop-ui: `requestTestSetup()`/`TestSetupSection` gọi route change-requests và hiển thị
  trạng thái đang chờ/kết quả của máy này — duyệt, từ chối, hoặc tự rút khi máy mất project trước khi owner
  quyết định (`ProjectDetail.lastChange`).
- web-admin: trang Dự án và Máy hiển thị owner, nút chuyển máy; Inbox có ô duyệt/từ chối chuyển máy và ô duyệt/
  từ chối đổi loại project (TOTP).

## Tests

- `apps/api/test/claims.test.ts`: gán ngay khi chưa ai giữ (kèm event và audit row), yêu cầu chờ duyệt TOTP
  (rồi ticket dời theo), từ chối, rút yêu cầu, gán trùng vai trò assistant thứ hai bị chặn, giải phóng, tạo
  project trùng key bị chặn, view project phía daemon, owner gán lại/thu hồi.
- `apps/api/test/project-changes.test.ts`: chờ duyệt TOTP rồi mới đổi `platform`/`ui_test_mcp` (QC ticket tạo
  sau đó dùng MCP mới); từ chối giữ nguyên project và báo cho máy; máy không sở hữu bị `FORBIDDEN`; idempotent
  — request lại phát lại response, cùng giá trị trả lại yêu cầu đang chờ, giá trị khác `CONFLICT`; giá trị
  bằng hiện tại trả `unchanged`, body sai bị validate, bắt buộc session owner khi duyệt/từ chối. Nhóm "a pending
  change of a project the requesting machine loses" (5 test): rút (`withdrawn`, kèm `project.change_decided`
  đúng máy, `lastChange` cập nhật, duyệt/từ chối muộn `CONFLICT` 409 báo "already withdrawn") khi một takeover
  được duyệt chuyển project sang máy khác, khi owner gán lại project cho máy khác, hoặc khi máy tự trả project;
  vẫn `pending` khi owner từ chối takeover (project không đổi chủ); rút khi owner thu hồi máy đang giữ yêu cầu.
- `apps/api/test/bmad-profile.test.ts`: máy sở hữu báo cáo hồ sơ được lưu và thấy ở cả owner lẫn mọi máy; máy
  khác báo cáo bị `FORBIDDEN`, project chưa có bị `NOT_FOUND`, key sai `VALIDATION_FAILED`; câu trả lời cá
  nhân/credential/đường dẫn tuyệt đối/field lạ/version sai định dạng bị từ chối; hồ sơ cũ hơn hồ sơ đã lưu
  không ghi đè; bắt buộc `Idempotency-Key` và phát lại đúng response khi request lại.
- `packages/shared/src/project-schemas.test.ts`: `McpServerName` chấp nhận tên plugin có namespace và
  connector claude.ai có dấu cách như Claude Code thật báo cáo, từ chối tên rỗng/có khoảng trắng đầu-cuối/ký
  tự điều khiển; một report với `mcpsUsed`/`mcpsSelected` chứa các tên đó được schema report chấp nhận.
