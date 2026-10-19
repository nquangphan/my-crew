# BA R3 — UI Crew mới hoàn toàn

Ngày 10/10/2026 (Asia/Ho_Chi_Minh). Agent BA (opus), chỉ đọc. Không sửa code, không commit.

Yêu cầu gốc: [plan stock-first, mục "R3 — UI Crew mới hoàn toàn"](../../261006-0805-crew-v3-stock-first/plan.md).
Ảnh chụp prod (chỉ đọc, đăng nhập bằng form, tài khoản board trong `.env` VPS đọc qua stdin, không in mật khẩu,
không nạp cookie qua tool, không bấm nút ghi): [`shots/`](shots/), 36 ảnh, company `2P Solutions` (TPS).

## 0. Bối cảnh đã kiểm (bằng chứng)

| Sự thật | Nguồn |
|---|---|
| Prod chạy `v2026.1005.0-crew-c301d7608`, UI stock do server phục vụ (`SERVE_UI=true`, đọc `server/ui-dist` trước, rồi `ui/dist`) | `GET /api/health`; `server/src/app.ts:972-1030`; compose VPS |
| Prod dùng giao diện **streamlined** (`enableStreamlinedUi: true`, `enableStreamlinedLeftNavigation: true`), không phải `ProductionLayout`. Mặc định code cũng là streamlined (`enableStreamlinedUi !== false`) | `GET /api/instance/settings/experimental`; `ui/src/hooks/useStreamlinedUiEnabled.ts` |
| `enableEnvironments: false` nên trang Settings → Environments chỉ có một dòng chữ (ảnh `21-environments.png`), dù company có 13 environment SSH tạo qua REST | GET experimental; `GET /api/companies/:id/environments` |
| Sidebar prod: New Task, Search, Dashboard, Inbox; Work: Tasks, Projects, Routines, Artifacts, Crew, Hướng dẫn; Org: Agents, Skills, Connectors, Audit; menu company (switcher + Create organization), menu tài khoản | `shots/01-dashboard.png`, dump control |
| 2 company: `Crew Spike Policy` (CREA, spike) và `2P Solutions` (TPS). 9 agent `claude_local` ở TPS (5 agent R1 + 4 agent `p-2ps-landing-*` do app Mac tạo), 3 project, label duy nhất `research`, 0 approval Paperclip, plugin `crew.core` ready | GET companies/agents/projects/labels/approvals/plugins |
| Vai trò theo project đã nằm trong DB plugin: `2ps-landing` có `assistant/executor×1/reviewer/integrator`; `Spike Mac` chưa có dòng → dùng vai trò file `CREW_POLICY_CONFIG` | `GET /api/plugins/crew.core/api/projects/:id/roles` |
| Agent Crew = `claude_local`, `command=~/.crew/bin/crew-claude-run`, `extraArgs=[--setting-sources project,local, --plugin-dir ~/.crew/workflows/superpowers/<ver>]`, heartbeat tắt, `maxConcurrentRuns 1`, `defaultEnvironmentId` = environment SSH riêng (`in_place`, `crewLoadGate {maxLoad1 8, maxWaitMinutes 60}`, checkout `~/crew-agents/<project>/<role>`) | `GET /api/agents/:id`, `GET /api/environments/:id` (chỉ in key) |
| Hook lõi 5/5: H1 `beforeClaim` (cổng tải + resume gói), H2 `beforeIssueWrite` (cổng stage/docs/push, khóa policy với agent, cấm agent hủy, cấm agent giao việc cho reviewer/integrator), H3 `onRunLeaseReleased` (dừng việc trên Mac), H4 `beforeIssueCreate` (gắn template policy, cấm agent tạo issue gốc, giới hạn override model), H5 `beforeAgentMutation` (agent không sửa `command/extraArgs/env/model`, không đổi adapter, không rollback) | `crew/release/core-hooks.json`, `server/src/crew/*` |
| **Board vượt được cổng:** H2 với actor board trả `override` (cho ghi, chỉ ghi activity `crew.policy.board_override`); board đổi được `executionPolicy`; H4 giữ nguyên policy board gửi lúc tạo (không gắn template Crew) | `issue-gate.ts:149-290`, `issue-create-policy.ts:decideCreatePolicy` |
| Company không có trong `CREW_POLICY_CONFIG` → H2/H4/H5 không áp gì (Paperclip gốc) | `issue-policy.ts:loadCrewCompanyConfig` |
| App macOS (nhánh `r22/agents`) đã có luồng **thêm project từ folder repo có sẵn**: git config `crew-docs.bundle` → tạo project → `crew-mac status add-repo` → mỗi vai trò: worktree + environment SSH + agent + `AGENTS.md` theo template → `roles.set` → `doctor`/`workflow-check`; gỡ project: pause agent, archive environment, xóa vai trò | `apps/mac-app/src/main/projects/add-project.ts`, `paperclip/client.ts` |

Phát hiện phụ (đưa vào kế hoạch R3, không phải câu hỏi):

- `tro-ly` có `permissions.canCreateAgents=true`, `canCreateSkills=true`. H5 chỉ chặn khi body có key ghim; agent vẫn
  `POST /companies/:id/agents` được với cấu hình mặc định. UI Crew ẩn tab Permissions; kế hoạch R3 nên quyết có tắt
  hai quyền này không.
- `POST /companies/:id/projects` chỉ kiểm `assertCompanyAccess` nên agent cũng tạo được project (inventory route).
- UI stock gần như không có i18n: 40 file locale nhưng chỉ dịch `app.noCompanies.*`; mọi chuỗi khác gắn cứng tiếng Anh.
  Không clone được lớp dịch, phải tự dựng.

## 1. Màn hình, nút và flow của UI Crew

Quy ước:
- **Quyền**: `board` = người dùng đăng nhập (owner). UI Crew chỉ dành cho board; agent không dùng UI. Cột ghi thêm
  khi server cho cả agent gọi (để test âm).
- **API**: đường dẫn có tiền tố `/api`. `plugin data` = `POST /api/plugins/crew.core/data/<key>` (board,
  `assertBoardOrgAccess`). `plugin route` = `/api/plugins/crew.core/api/...` (manifest `apiRoutes`, `auth: board`).
  Mục ghi **(mới)** là route plugin chưa có, R3 phải thêm.
- **Ca PW**: mã ca Playwright. Mỗi ca chạy trên API/DB thật của một company E2E riêng (xem Q5) và kiểm tác dụng bằng
  GET API hoặc truy vấn DB sau khi bấm, không chỉ kiểm giao diện.
- Nút chỉ đổi giao diện (mở/đóng panel, lọc, sắp xếp, copy, phóng to map) không ghi DB nhưng có tác dụng thấy được;
  vẫn có ca PW kiểm giao diện.

### S0. Khung chung (shell)

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S0.1 | Sidebar: Yêu cầu mới, Tìm kiếm, Tổng quan, Hộp thư (badge), Yêu cầu, Project, Agent, Skills, Máy, Docs, Hướng dẫn, Cài đặt | Điều hướng. Badge: `GET /companies/:c/sidebar-badges` | board | PW-S0-1: mỗi link mở đúng route, không 404; badge = số mục chưa đọc của `GET /companies/:c/issues?...unread` |
| S0.2 | Chọn company | Đổi company đang xem; chỉ liệt kê company có cấu hình Crew (Q5). `GET /companies` | board | PW-S0-2: company không có trong `CREW_POLICY_CONFIG` không xuất hiện |
| S0.3 | Đổi ngôn ngữ VI/EN | Lưu lựa chọn ở trình duyệt (localStorage), mọi chuỗi đổi theo; không gọi API | board | PW-S0-3: đổi EN → tiêu đề, nút, nhãn trạng thái đều tiếng Anh; tải lại vẫn giữ; không còn chuỗi VI gắn cứng (quét DOM) |
| S0.4 | Command palette (Cmd/Ctrl+K) | Điều hướng + tìm issue nhanh `GET /companies/:c/issues?q=` | board | PW-S0-4: gõ mã TPS-xx mở đúng issue |
| S0.5 | Cập nhật trực tiếp | WebSocket `/api/companies/:c/events/ws`; trạng thái issue/run tự đổi | board | PW-S0-5: đổi status issue qua API ở tab khác → trang đang mở cập nhật trong 5 s |
| S0.6 | Menu tài khoản → Đăng xuất | `POST /api/auth/sign-out`, xóa phiên | board | PW-S0-6: sau đăng xuất `GET /api/auth/get-session` trả null, vào trang trong bị chuyển về đăng nhập |

### S1. Đăng nhập và duyệt đăng nhập CLI

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S1.1 | Form Email/Mật khẩu → Đăng nhập | `POST /api/auth/sign-in/email`, tạo phiên | công khai | PW-S1-1: đúng thông tin vào Tổng quan; sai báo lỗi; không có link "Tạo tài khoản" (đăng ký đã tắt) |
| S1.2 | Trang `/cli-auth/:id`: Cho phép / Hủy | `POST /cli-auth/challenges/:id/approve` hoặc `/cancel`. Đây là bước app 2P Crew trên Mac dùng để lấy board key (AP-4) — **bắt buộc giữ** | board | PW-S1-2: tạo challenge bằng API (`POST /api/cli-auth/challenges`), mở trang, bấm Cho phép → `GET challenge` trả `approved`; Hủy → `cancelled` |

### S2. Tổng quan (Dashboard)

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S2.1 | Thẻ số: agent đang chạy/tạm dừng, yêu cầu đang mở/kẹt, **chờ bạn duyệt** | Đọc `GET /companies/:c/dashboard`, `GET /companies/:c/issues`; thẻ "chờ bạn duyệt" đếm issue ở stage `approval` có participant là user hiện tại | board | PW-S2-1: số trên thẻ khớp truy vấn API |
| S2.2 | Run gần đây, link "Xem run" | Đọc `GET /companies/:c/heartbeat-runs`, `GET /companies/:c/live-runs`; link tới S12 | board | PW-S2-2 |
| S2.3 | Widget Máy | `plugin data crew.machines` | board | PW-S2-3: thẻ máy khớp `crew.machines` |
| S2.4 | Yêu cầu gần đây | `GET /companies/:c/issues` (issue gốc Crew) | board | PW-S2-4 |

Bỏ khỏi Dashboard: thẻ chi phí/ngân sách, "Resume all", banner Connectors, onboarding (xem mục 2).

### S3. Hộp thư (Inbox)

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S3.1 | Tab **Chờ tôi duyệt** (mới) | Lọc issue có `executionState.currentParticipant = user hiện tại` (stage owner) và issue có interaction chờ trả lời | board | PW-S3-1: issue ở stage owner xuất hiện; duyệt xong biến mất |
| S3.2 | Tab Của tôi / Chưa đọc / Đang kẹt / Tất cả | `GET /companies/:c/issues` với bộ lọc | board | PW-S3-2 |
| S3.3 | Đánh dấu đã đọc / chưa đọc / tất cả đã đọc | `POST`/`DELETE /issues/:id/read` | board (route chặn agent) | PW-S3-3: sau bấm, `GET issue` đổi `isUnreadForMe`; badge S0.1 giảm |
| S3.4 | Lưu trữ / bỏ lưu trữ | `POST`/`DELETE /issues/:id/inbox-archive` | board | PW-S3-4: mục rời tab, `GET` còn issue (không xóa) |
| S3.5 | Tìm, lọc, nhóm | Chỉ giao diện / query | board | PW-S3-5 |

### S4. Danh sách yêu cầu (Tasks)

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S4.1 | Danh sách, lồng issue con dưới issue gốc, mở/thu issue con | `GET /companies/:c/issues?view=compact` | board | PW-S4-1: số dòng khớp API; con nằm dưới đúng gốc |
| S4.2 | Tìm, lọc (trạng thái, project, người làm, loại Code/Bug/Nghiên cứu), sắp xếp, nhóm, cột | Query / giao diện | board | PW-S4-2 |
| S4.3 | Cột "Giai đoạn Crew" và "x/y con xong" | `plugin data crew.roots` | board | PW-S4-3: khớp `crew.roots` |
| S4.4 | Nút "Yêu cầu mới" | Mở S5 | board | — |

Không có: đổi trạng thái/người làm ngay trên dòng, kéo thả Kanban (mục 2).

### S5. Dialog Yêu cầu mới

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S5.1 | Chọn **Project** (chỉ project "sẵn sàng": có vai trò đủ, agent không `terminated`, máy đã dựng xong) | Không ghi; quyết định assignee và vai trò | board | PW-S5-1: project chưa sẵn sàng không có trong danh sách |
| S5.2 | Chọn **Loại**: Code / Bug / Nghiên cứu | Nghiên cứu gửi `labelIds:[research]` lúc tạo → H4 gắn template `[reviewer, owner]`; Code/Bug → template gốc 4 stage | board | PW-S5-2: tạo loại Nghiên cứu → `GET issue.executionPolicy.stages` = review+approval; Code → 4 stage |
| S5.3 | Tiêu đề, mô tả (markdown), đính kèm file | Upload: `POST /companies/:c/issues/:issueId/attachments` sau khi tạo. Hiện cảnh báo trước khi gửi nếu đuôi file nằm ngoài danh sách `ALLOWED_EXTENSIONS` (cùng luật plugin `attachments/rules.ts`) | board | PW-S5-3: file `.png` lên đủ; file `.zip` hiện cảnh báo, gửi vẫn được và sau ≤1 phút có comment cảnh báo của job `attachments-audit` |
| S5.4 | **Người nhận** hiển thị cố định = Trợ Lý của project (không chọn) | Body `assigneeAgentId = roles.assistantAgentId` | board | PW-S5-4: issue tạo ra có assignee là assistant của project |
| S5.5 | Nút Tạo | `POST /companies/:c/issues` `{title, description, projectId, assigneeAgentId, status:"todo", labelIds?}`; H4 gắn policy; agent Trợ Lý được đánh thức trên Mac | board | PW-S5-5: 201; `executionPolicy` khớp vai trò project (reviewer/integrator theo bảng plugin), owner = user; có run `queued` của Trợ Lý trong `GET /companies/:c/heartbeat-runs` |
| S5.6 | Lưu nháp (chưa giao) | Tạo với `status:"backlog"` (agent không được đánh thức). Chỉ giữ nếu owner muốn (mặc định khuyên giữ, ghi rõ "chưa chạy") | board | PW-S5-6: status `backlog`, không có run mới |
| S5.7 | Hủy / đóng dialog | Không ghi | board | PW-S5-7: không có issue mới |

Không có trong dialog: chọn reviewer/approver/watchdog, Auto/Plan/Ask mode, chọn assignee tự do, chọn model (mục 2).

### S6. Chi tiết issue (gốc và con)

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S6.1 | Dòng tóm tắt Crew "x/y con xong · giai đoạn · docs" + **Mở/Đóng map** | `plugin data crew.map`, `crew.docsCheck`; map React Flow (port từ plugin) | board | PW-S6-1: số con, giai đoạn, kết quả docs khớp dữ liệu plugin; map có đủ nút/cạnh như `crew.map` |
| S6.2 | Map: phóng to/thu nhỏ, bấm ô mở issue | Giao diện / điều hướng | board | PW-S6-2 |
| S6.3 | Panel kiểm docs (commit, range, tác giả, lúc) | `crew.docsCheck` | board | PW-S6-3 |
| S6.4 | Luồng bình luận + transcript run trực tiếp (thu gọn) | `GET /issues/:id/comments`, run trực tiếp qua WS | board | PW-S6-4 |
| S6.5 | Gửi bình luận | `POST /issues/:id/comments`; nếu assignee là agent thì đánh thức agent đó trên Mac | board | PW-S6-5: comment có trong `GET comments`; issue đang giao cho agent có run mới |
| S6.6 | Đính kèm vào bình luận / issue; xóa file của mình (có xác nhận) | `POST .../attachments`, `DELETE /attachments/:id` | board | PW-S6-6 |
| S6.7 | **Duyệt** (chỉ hiện ở stage owner, user là participant) | `PATCH /issues/:id {status:"done", comment}` → stage approval hoàn tất, workflow chuyển integrator push. H2 kiểm docs/stage | board | PW-S6-7: sau bấm `executionState.completedStageIds` có stage owner, assignee chuyển integrator; không có activity `crew.policy.board_override` |
| S6.8 | **Yêu cầu sửa** (stage owner, bắt buộc ghi lý do) | `PATCH /issues/:id {status:"in_progress", comment}` → về người làm vòng trước, tính một vòng sửa | board | PW-S6-8: status `in_progress`, comment có lý do, assignee = executor/Trợ Lý vòng trước |
| S6.9 | Thẻ câu hỏi của Trợ Lý: chọn phương án / "Khác" + gửi; chấp nhận/từ chối thẻ xác nhận | `POST /issues/:id/interactions/:iid/respond` (hoặc `/accept`, `/reject`) → Trợ Lý chạy tiếp | board | PW-S6-9: interaction `resolved`, có run mới của Trợ Lý |
| S6.10 | **Hủy yêu cầu** (có xác nhận, chỉ board) | `PATCH /issues/:id {status:"cancelled"}`; H3 dừng run đang chạy trên Mac | board (H2 cấm agent hủy) | PW-S6-10: status `cancelled`; run đang chạy → `cancelled`; ca âm: agent key gọi cùng PATCH → 422 `agent_cancel_forbidden` |
| S6.11 | Mở lại yêu cầu đã hủy/xong (chỉ khi owner muốn) | `PATCH {status:"todo"}`; H2 reset vòng (state=null) | board | PW-S6-11 |
| S6.12 | Đổi tiêu đề, sửa mô tả | `PUT /issues/:id/title`, `PATCH /issues/:id {description}` | board | PW-S6-12 |
| S6.13 | Panel thuộc tính (chỉ đọc): trạng thái, người làm, project, loại, cha/con, blocked-by, các stage và người duyệt, vòng sửa `n/5`, model đã chọn (`crew-model`), thời gian | `GET /issues/:id` | board | PW-S6-13: hiển thị khớp API; không có control sửa |
| S6.14 | Tài liệu của issue (plan, spec agent ghi) — chỉ đọc | `GET /issues/:id/documents`, `/documents/:key` | board | PW-S6-14 |
| S6.15 | Run của issue: mở run, **Dừng run** | `POST /heartbeat-runs/:runId/cancel` (board); H3 dừng tiến trình trên Mac | board | PW-S6-15: run `cancelled`; trên Mac không còn process `crew-claude-run` của run đó (kiểm qua bản tin máy / `active-runs`) |
| S6.16 | Copy mã, copy link, đánh dấu đã đọc khi mở | Giao diện; `POST /issues/:id/read` | board | PW-S6-16 |

Không có: đổi trạng thái tự do, đổi assignee/project/label/parent/blocked-by, sửa reviewer/approver/watchdog, chọn
model trong ô soạn, Helpful/Needs work, thêm issue con, queued comment/steer/interrupt, khóa tài liệu (mục 2).

### S7. Danh sách project

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S7.1 | Danh sách project kèm **trạng thái sẵn sàng** (Sẵn sàng / Thiếu bước X / Theo dõi) | `GET /companies/:c/projects` + `GET plugin route roles` + **(mới)** `plugin data crew.projectReadiness` (vai trò đủ, agent sống, environment active, máy báo checkout xong, docs đồng bộ) | board | PW-S7-1: project thiếu vai trò hiện "Thiếu vai trò" và nút làm tiếp |
| S7.2 | Nút **Thêm project** | Mở wizard S9 | board | — |
| S7.3 | Gắn sao project | `sidebar-preferences` (lưu thứ tự/sao) | board | PW-S7-3: sao giữ sau tải lại |

### S8. Chi tiết project

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S8.1 | Tab Yêu cầu: danh sách issue của project | `GET /companies/:c/issues?projectId=` | board | PW-S8-1 |
| S8.2 | Tab **Vai trò** (mới): xem 4 vai trò | `GET plugin route /projects/:id/roles?companyId=` | board (route trả 403 cho agent) | PW-S8-2: khớp API; ca âm: agent key → 403 |
| S8.3 | Sửa vai trò (chọn agent cho assistant, executor 1–2, reviewer, integrator) → Lưu | `POST plugin route /projects/:id/roles` (kiểm: khác nhau, cùng company, không terminated, không chéo vai trò giữa project); sau đó nếu danh sách executor đổi → render lại `AGENTS.md` của Trợ Lý: `PUT /agents/:assistant/instructions-bundle/file {path:"AGENTS.md", content, baseHash}` | board | PW-S8-3: `GET roles` trả bộ mới; issue mới tạo sau đó có `executionPolicy` dùng reviewer mới; `AGENTS.md` của Trợ Lý chứa danh sách executor mới; ca âm: chọn reviewer = integrator → lỗi 400 hiện trên form, DB không đổi |
| S8.4 | Tab **Docs** của project | `plugin data crew.docs.tree/page/search` (lọc theo project) | board | như S16 |
| S8.5 | Tab **Sẵn sàng**: danh sách bước, bước thiếu có nút "Làm tiếp" | Gọi lại bước tương ứng của wizard S9 | board | PW-S8-5 |
| S8.6 | Đổi tên, mô tả, biểu tượng/màu | `PATCH /projects/:id {name, description, color, icon}` | board | PW-S8-6 |

### S9. Wizard Thêm project (flow nhiều bước)

Port từ `apps/mac-app/src/main/projects/add-project.ts`. Phần chạy trên Mac đi qua hàng đợi "việc cần làm trên máy"
(Q2). Mỗi bước ghi tiến độ vào DB plugin để chạy lại tiếp từ bước dở.

| Bước | Thao tác | Tác dụng thật | Ca PW |
|---|---|---|---|
| 1 | Chọn máy + folder repo (danh sách repo git Mac báo lên), khóa project, số executor 1–2 | **(mới)** `plugin data crew.machineRepos` (Mac báo trong bản tin) | PW-S9-1: chỉ hiện repo Mac đã báo |
| 2 | Tạo project | `POST /companies/:c/projects {name}` | PW-S9-2: project có trong DB |
| 3 | Việc trên Mac: git config `crew-docs.bundle`, worktree mỗi vai trò `~/crew-agents/<key>/<role>`, exclude `.paperclip-runtime`, `crew-mac status add-repo` | **(mới)** `POST plugin route /machine-jobs {kind:"add-project", ...}`; Mac kéo việc, làm, báo kết quả qua webhook ký | PW-S9-3: job chuyển `done`; bản tin máy có repo mới; trên Mac có thư mục checkout (kiểm qua kết quả job) |
| 4 | Mỗi vai trò: environment SSH (dùng lại secret SSH và known hosts của environment mẫu, `metadata {workspaceRealizationMode:"in_place", crewLoadGate}`) | `POST /companies/:c/environments` | PW-S9-4: environment `active`, `remoteWorkspacePath` đúng checkout |
| 5 | Mỗi vai trò: agent `claude_local` (command wrapper, `extraArgs` ghim Superpowers, model mặc định theo vai trò, heartbeat tắt, `maxConcurrentRuns 1`, `defaultEnvironmentId`) + `AGENTS.md` theo template vai trò | `POST /companies/:c/agents`, `PUT /agents/:id/instructions-bundle/file` | PW-S9-5: agent có đủ key ghim; `AGENTS.md` khớp template |
| 6 | Ghi vai trò | `POST plugin route /projects/:id/roles` | PW-S9-6 |
| 7 | Kiểm trên Mac (`doctor`, `workflow-check`) | **(mới)** machine job `kind:"check"` | PW-S9-7: kết quả hiện từng mục |
| Lỗi | Bước lỗi: tạm dừng agent đã tạo (`POST /agents/:id/pause`), hiện lỗi + nút "Chạy tiếp" | — | PW-S9-8: giả lỗi bước 4 → agent bước trước `paused`; Chạy tiếp hoàn tất |

### S10. Danh sách agent

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S10.1 | Danh sách: tên, vai trò Crew theo project, trạng thái chạy, **Sẵn sàng / Chưa sẵn sàng (thiếu bước X)** | `GET /companies/:c/agents` + roles + readiness | board | PW-S10-1 |
| S10.2 | Lọc Đang chạy / Tạm dừng / Lỗi | Giao diện | board | PW-S10-2 |
| S10.3 | **Tạm dừng / Tiếp tục** agent | `POST /agents/:id/pause` (hủy run đang chạy, H3 dừng trên Mac) / `/resume` | board (resume: agent cần quyền riêng) | PW-S10-3: status `paused`/`idle`; issue giao cho agent paused không tạo run mới |
| S10.4 | Nút **Tạo agent** | Mở wizard S13 | board | — |

### S11. Chi tiết agent

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S11.1 | Tổng quan: run gần nhất, issue đang làm, environment/máy, vai trò ở các project | `GET /agents/:id`, `GET /companies/:c/heartbeat-runs?agentId=`, roles | board | PW-S11-1 |
| S11.2 | Tab Hướng dẫn: xem `AGENTS.md` (chỉ đọc) + nút **Render lại theo vai trò** | `GET /agents/:id/instructions-bundle/file`; render template vai trò → `PUT .../file {baseHash}` | board | PW-S11-2: sau render, nội dung = template + danh sách executor hiện tại; `baseHash` sai → báo xung đột, không ghi |
| S11.3 | Tab Skills: bật/tắt skill company cho agent | `GET /agents/:id/skills`, `POST /agents/:id/skills/sync` | board | PW-S11-3: skill bật xuất hiện trong `GET skills`; run kế tiếp có skill trong `.paperclip-runtime/claude/skills` (kiểm log run) |
| S11.4 | Tab Cấu hình chạy (chỉ đọc): adapter, command, extraArgs (Superpowers bản ghim), environment, máy | `GET /agents/:id` | board | PW-S11-4 |
| S11.5 | Đổi **model mặc định** (chỉ chọn trong bảng `CREW_COMPLEXITY_MODEL`) | `PATCH /agents/:id {adapterConfig:{model}}` (merge, không `replaceAdapterConfig`) | board (H5 chặn agent) | PW-S11-5: `adapterConfig.model` đổi, `command/extraArgs` giữ nguyên; ca âm: agent key PATCH → 422 `crew_agent_config_forbidden` |
| S11.6 | Tab Run: danh sách run | `GET /companies/:c/heartbeat-runs?agentId=` | board | PW-S11-6 |
| S11.7 | Đổi tên hiển thị, biểu tượng | `PATCH /agents/:id {name, icon}` | board | PW-S11-7 |
| S11.8 | "Chưa sẵn sàng": danh sách bước thiếu + **Làm tiếp** | Gọi bước tương ứng của S13 | board | PW-S11-8 |

### S12. Chi tiết run

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S12.1 | Transcript, sự kiện, log, issue liên quan | `GET /heartbeat-runs/:id`, `/events`, `/log`, `/heartbeat-runs/:id/issues` | board | PW-S12-1 |
| S12.2 | **Dừng run** (queued/running, có xác nhận) | `POST /heartbeat-runs/:id/cancel`; H3 dừng trên Mac | board | PW-S12-2: như PW-S6-15 |
| S12.3 | **Chạy lại** run lỗi/timeout | `POST /agents/:id/wakeup {reason:"retry_failed_run", failedRunId}` | board | PW-S12-3: có run mới `queued` cùng issue |
| S12.4 | **Tiếp tục run bị mất tiến trình** (`process_lost`) | `POST /agents/:id/wakeup {reason:"resume_process_lost_run"}` | board | PW-S12-4 |

### S13. Wizard Tạo agent (6 bước theo plan R3)

| Bước | Thao tác | Tác dụng thật | Ca PW |
|---|---|---|---|
| 1 | Tên, project, vai trò (assistant/executor/reviewer/integrator), model mặc định trong `CREW_COMPLEXITY_MODEL`, máy | `POST /companies/:c/agents` (`claude_local`, heartbeat tắt, `maxConcurrentRuns 1`) | PW-S13-1: agent tạo ra có đúng key |
| 2 | Ghim Superpowers (`extraArgs` từ bản tin máy) + upload `AGENTS.md` theo vai trò | `PATCH /agents/:id {adapterConfig}`, `PUT .../instructions-bundle/file` (port `merge-agent-config.mjs`/`render-instructions.mjs`) | PW-S13-2 |
| 3 | Environment SSH riêng, `in_place`, trỏ checkout riêng, dùng chung secret SSH | `POST /companies/:c/environments`, `PATCH /agents/:id {defaultEnvironmentId}` | PW-S13-3 |
| 4 | Dựng checkout + `git config crew-docs.bundle` trên Mac | **(mới)** machine job `kind:"agent-workspace"`; Mac kéo, làm, báo lại | PW-S13-4: job `done`, readiness bước 4 xanh |
| 5 | Ghi vai trò trong project | `POST plugin route /projects/:id/roles` | PW-S13-5 |
| 6 | Thêm executor → render lại `AGENTS.md` của Trợ Lý | `PUT /agents/:assistant/instructions-bundle/file` | PW-S13-6: `AGENTS.md` Trợ Lý có executor mới |
| — | Agent chưa xong 6 bước: trạng thái "Chưa sẵn sàng", không có trong lựa chọn người nhận ở đâu cả | readiness | PW-S13-7: agent dở không có trong S5.4, S8.3 |

### S14. Skills

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S14.1 | Danh sách skill company + nội dung `SKILL.md` | `GET /companies/:c/skills`, `GET .../skills/:id` | board | PW-S14-1 |
| S14.2 | Thêm skill (từ GitHub repo / nguồn đã nối) | `skill-sources` discover/preview/create rồi chọn skill; từ chối tên trùng skill Superpowers ghim (Q6) | board | PW-S14-2: skill mới có trong `GET skills`; tên trùng `brainstorming` → lỗi, không tạo |
| S14.3 | Bật skill cho agent (từ trang skill) | `POST /agents/:id/skills/sync` | board | như PW-S11-3 |
| S14.4 | Trạng thái sync theo máy ("đã có trên mac-mini, hash …" / lỗi) | **(mới)** machine job `kind:"skill-sync"` + `plugin data crew.skillSync` | board | PW-S14-4: thêm skill → trong 2 phút máy báo hash khớp |

### S15. Máy

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S15.1 | Thẻ máy: trực tuyến/mất liên lạc, lần cuối, tải/CPU, RAM, biểu đồ 24 giờ, hộp thoại TCC đang chờ, Claude (bản, đăng nhập, gói), app 2P Crew (bản, sshd, cập nhật), Superpowers, cảnh báo doctor | `plugin data crew.machines`, tự làm mới 30 s | board | PW-S15-1: khớp `machine_latest`; dừng job gửi tin 3 phút → "Mất liên lạc" (ca chạy trên Mac thật như AC-4) |
| S15.2 | Hàng đợi việc trên máy (mới): việc đang chờ/đang làm/lỗi, nút **Thử lại** việc lỗi | **(mới)** `plugin data crew.machineJobs`, `POST plugin route /machine-jobs/:id/retry` | board | PW-S15-2 |

### S16. Docs

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S16.1 | Chọn project, cây tài liệu, mở trang, link nội bộ, link hỏng "thiếu trang", danh sách file bị bỏ do secret-scan | `crew.docs.projects/tree/page` | board | PW-S16-1 (như AC-4 cổng 3) |
| S16.2 | Ô tìm kiếm (có nhãn, placeholder — sửa nợ AC-4) | `crew.docs.search` | board | PW-S16-2: tìm "greet" hiện đủ số kết quả API trả |

### S17. Hướng dẫn

Trang tĩnh trong UI Crew (port `huong-dan.md` + ảnh), cập nhật theo UI mới, có mục "Vì sao không có nút X" lấy từ
mục 2. PW-S17-1: mọi ảnh tải được, mọi link nội bộ mở đúng trang.

### S18. Cài đặt

| # | Nút / thao tác | Tác dụng thật | Quyền | Ca PW |
|---|---|---|---|---|
| S18.1 | Hồ sơ: tên, ảnh đại diện | `PATCH /api/auth/profile`, upload asset | board | PW-S18-1 |
| S18.2 | Ngôn ngữ (như S0.3) | localStorage | board | PW-S0-3 |
| S18.3 | Thông tin hệ thống (chỉ đọc): bản server, commit, backup gần nhất | `GET /api/health` | board | PW-S18-3 |

### S19. Tìm kiếm

`GET /companies/:c/search?q=` → issue, comment, tài liệu. PW-S19-1: kết quả mở đúng issue.

### Flow đầu-cuối (nghiệm thu)

| Flow | Bước | Ca PW |
|---|---|---|
| F1 Yêu cầu code | S5 tạo (Code) → Trợ Lý tách con (map có con) → executor → reviewer → integrator docs → S3.1 "Chờ tôi duyệt" → S6.7 Duyệt → integrator push → Đã xong | PW-F1 (chạy trên Mac thật, một yêu cầu nhỏ trên repo thử) |
| F2 Yêu cầu sửa | Như F1 tới stage owner → S6.8 Yêu cầu sửa → vòng mới → Duyệt | PW-F2 |
| F3 Nghiên cứu | S5 loại Nghiên cứu → reviewer → owner duyệt, không push | PW-F3 |
| F4 Trợ Lý hỏi lại | Yêu cầu thiếu thông tin → thẻ câu hỏi → S6.9 trả lời → chạy tiếp | PW-F4 |
| F5 Hủy | S6.10 khi run đang chạy → run dừng trên Mac | PW-F5 |
| F6 Thêm project | S9 đủ 7 bước → S5 chọn được project mới → F1 chạy được trên project đó | PW-F6 |
| F7 Tạo agent | S13 thêm executor thứ 2 → `AGENTS.md` Trợ Lý đổi → yêu cầu mới có thể giao cho executor đó | PW-F7 |
| F8 Thêm skill | S14 thêm skill → máy báo đã sync → run kế có skill | PW-F8 |
| F9 Máy quá tải | Tải > 8 → run chờ (H1), thẻ máy hiện tải; giảm tải → chạy | PW-F9 (tùy, như S5 spike) |

## 2. Feature Paperclip không có trong Crew (đưa vào docs)

Mã lý do: **KD** = Crew không dùng; **HK** = bị hook H1–H5 chặn hoặc làm hỏng luồng mà hook bảo vệ (board vượt cổng);
**CL** = chưa có luồng làm đủ bước; **RS** = để R sau.

### Điều hướng và tổng quan

| Feature Paperclip | Ở đâu | Lý do | Ghi chú |
|---|---|---|---|
| Routines (lịch chạy định kỳ, trigger, webhook công khai) | `/routines` | KD | Crew chạy theo yêu cầu, không chạy định kỳ; issue do routine tạo sẽ nhận template gốc và chờ owner |
| Artifacts | `/artifacts` | KD | Crew đọc kết quả qua comment/commit/docs |
| Connectors / Apps / gateways / AI connections / managed profiles | `/apps/*` | KD | Credential AI chỉ nằm trên Mac; agent Crew không dùng tool qua gateway của server |
| Audit (activity feed, agent actions CSV), Costs, Budgets, budget incident | `/activity/*` | KD | Chi phí là gói Claude trên Mac, Paperclip ghi $0; run xem ở agent và issue |
| Org chart, "Reports to", chain of command | `/org` | KD | Crew tổ chức theo vai trò trong project, không theo cây báo cáo |
| Goals | `/goals` | KD | — |
| Timeline, Dashboard live riêng | `/timeline`, `/dashboard/live` | KD | Run trực tiếp hiện ở Tổng quan và issue |
| Chats với agent, Board chat, Conference room | `/chats`, `/board-chat` | KD | Agent Crew làm việc qua issue; cờ thử nghiệm đang tắt |
| Decisions, Status cards, Summaries, Cases, Pipelines, Review queue, Learnings | nhiều route | KD | Cờ thử nghiệm tắt; owner duyệt qua stage owner của issue |
| Workspaces / execution workspaces / project workspaces (runtime services, reconcile, close) | `/workspaces`, `/execution-workspaces/*` | KD | Crew dùng environment SSH `in_place`, mỗi agent một checkout trên Mac |
| Onboarding wizard, announcement Connectors | `/onboarding`, popup | KD | Company đã dựng sẵn |
| Design guide, UX lab, perf lab, smoke lab | `/design-guide`, `/ux-lab/*` | KD | Trang nội bộ upstream |
| Hồ sơ người dùng công khai | `/u/:slug` | KD | Một người dùng |

### Issue

| Feature | Ở đâu | Lý do | Ghi chú |
|---|---|---|---|
| Chọn assignee tự do khi tạo / đổi assignee | dialog New Task, Properties | HK | Giao cho reviewer/integrator làm sai vai trò (H4 chỉ chặn agent, board vẫn ghi được); yêu cầu luôn đi qua Trợ Lý |
| Chọn Reviewer / Approver / Monitor / Watchdog | dialog, Properties | HK | Board gửi policy thì H4 bỏ template Crew; đổi policy sau khi tạo làm lệch cổng |
| Đổi trạng thái tự do, kéo thả Kanban (board view) | danh sách, Properties | HK | Board đặt `done` sẽ được H2 cho qua dạng `board_override`, bỏ qua review/docs/push; thay bằng Duyệt / Yêu cầu sửa / Hủy |
| Đổi project, label, parent, blocked-by sau khi tạo | Properties | HK | Policy chốt lúc tạo; đổi project không đổi vai trò; nhãn `research` gắn sau không có tác dụng; quan hệ do Trợ Lý quản |
| Auto / Plan / Ask mode | dialog | KD | Trợ Lý dùng Superpowers brainstorm/plan |
| Chọn model/effort trong ô soạn comment | composer | HK | Model chọn theo độ khó cho từng issue (O14, `crew-model`) |
| Thêm issue con từ UI | Edit subtasks | CL | Trợ Lý tách việc, gắn gói/bundle và blocker; issue con board tạo tay không có gói |
| Queued comment: sửa, xếp lại, steer, interrupt | issue | KD | — |
| Helpful / Needs work (feedback vote), chia sẻ dữ liệu feedback | issue | KD | `feedbackDataSharingEnabled=false`, không ai đọc |
| Khóa/mở/xóa/khôi phục tài liệu issue, work products, low-trust promotion | issue | KD | Tài liệu chỉ đọc trong UI Crew |
| Monitor check-now, scheduled retry, recovery actions, stalled review decision | issue | KD | Recovery của hệ thống giữ hành vi stock, không cần nút |
| Xóa issue, xóa label | — | KD | Dùng Hủy |

### Agent

| Feature | Ở đâu | Lý do | Ghi chú |
|---|---|---|---|
| Tạo agent trơn (chọn adapter, command, extra args, environment tự do) | `/agents/new` | CL | Thay bằng wizard 6 bước S13 |
| Run now / Run with provider trace (đánh thức không gắn issue) | header agent | KD | Agent Crew chỉ chạy theo issue; heartbeat tắt |
| Assign Task từ trang agent | header agent | HK | Yêu cầu đi qua Trợ Lý của project |
| Sửa Harness/Runtime tự do (command, extraArgs, env, adapter type), Revisions + rollback | tab Runtime, Revisions | HK | Xóa ghim Superpowers/wrapper; H5 chỉ chặn agent, board vẫn phá được. Chỉ cho đổi model mặc định |
| Sửa `AGENTS.md` tay, thêm/xóa file instructions, đổi chế độ bundle | tab Instructions | HK | Bị ghi đè khi render lại theo vai trò; chỉ có "Render lại" |
| Secrets & variables của agent | tab | KD | Credential nằm trên Mac |
| Tools (connector installs) | tab | KD | — |
| Permissions / Trust (canCreateAgents, canCreateSkills, canAssignTasks) | tab | HK | Quyền tạo agent của agent đi vòng qua wizard; xem phát hiện phụ ở mục 0 |
| API keys của agent | tab | KD | Agent dùng token run; app Mac dùng board key qua cli-auth |
| Duplicate agent, Reset sessions, Clear error | menu | HK | Bản sao không có checkout/vai trò; reset session phá resume gói (H1) |
| Terminate, xóa agent | menu | CL | Vai trò trỏ agent terminated làm project fail closed; gỡ agent cần luồng sửa vai trò + archive environment (Q7) |
| Approve hire, Approvals page (hire_agent, budget) | `/approvals` | KD | `requireBoardApprovalForNewAgents=false`; owner duyệt trong issue |
| Join / follow agent, sao agent ở sidebar | sidebar | KD | — |
| Built-in agents | — | KD | Cờ tắt |

### Project

| Feature | Ở đâu | Lý do | Ghi chú |
|---|---|---|---|
| Create project trơn | dialog Add Project | CL | Thay bằng wizard S9 |
| Repositories (Add GitHub repo), Set local folder, env vars của project, Codebase help | tab Configuration | KD | Repo nằm trên Mac, agent chạy trong checkout của environment riêng |
| Archive / delete project | Configuration | CL | Phải pause agent, archive environment, xóa vai trò (app Mac đã có "Gỡ khỏi Mac"); Q7 |
| Budget tab | project | KD | — |
| Workspaces tab, runtime start/stop | project | KD | — |

### Company và cài đặt

| Feature | Ở đâu | Lý do | Ghi chú |
|---|---|---|---|
| Create organization, company khác ngoài cấu hình Crew | menu company | CL | Company không có trong `CREW_POLICY_CONFIG` bỏ qua mọi cổng (Q5) |
| Members, invites, join requests, instance access, board claim | Settings | RS | Một người dùng; thêm người dùng để R sau |
| Secrets | Settings | CL | Secret SSH, webhook do wizard/app Mac tạo; không sửa tay |
| Environments | Settings | CL | Cờ tắt; environment do wizard tạo |
| Experimental, Adapters, Plugins (cài/gỡ/bật/tắt, config, jobs) | Settings | KD | Quản trị instance, đổi bằng ops (`crew/ops`) |
| Export / Import company | Settings | KD | Backup/restore bằng `crew/ops` |
| Instance general (censor username, backup retention, AI feedback) | Settings | KD | Ops |
| Skill Studio (viết/test/fork/version skill), catalog, beta skills | `/skills/studio`, tab | RS | R3 chỉ list, thêm từ nguồn, bật cho agent, trạng thái sync |
| Đăng ký tài khoản | `/auth` | KD | `PAPERCLIP_AUTH_DISABLE_SIGN_UP=true` |

## 3. Phần riêng của Crew phải thêm

| Phần | Nội dung | Nguồn hiện có | Việc mới |
|---|---|---|---|
| Tóm tắt + map yêu cầu/issue con | Dòng tóm tắt, React Flow map, vòng sửa, gói | plugin `ui/summary.tsx`, `ui/map/*`, `crew.map` | Port sang component DS, i18n |
| Kiểm docs | Panel kết quả `crew-docs-check` | plugin `ui/docs`, `crew.docsCheck` | Port |
| Trang Yêu cầu | Danh sách yêu cầu Crew đang mở | plugin `page.tsx`, `crew.roots` | Gộp vào S4 (cột giai đoạn) |
| Máy | Thẻ máy, biểu đồ tải, TCC, app, Superpowers | plugin `ui/machines`, `crew.machines` | Port + hàng đợi việc trên máy |
| Docs | Cây, trang, tìm kiếm, link hỏng, file bị bỏ | plugin `ui/docs`, `crew.docs.*` | Port, sửa nhãn ô tìm |
| Hướng dẫn | `huong-dan.md` + ảnh | plugin `ui/guide` | Viết lại theo UI mới, thêm mục "Vì sao không có nút X", bản EN (Q4) |
| Duyệt / Yêu cầu sửa | Hai nút ở stage owner, tab "Chờ tôi duyệt" | hướng dẫn mục 5.5 (hiện làm bằng đổi status) | Mới |
| Vai trò theo project | Xem/sửa 4 vai trò, kiểm chéo | plugin `roles/api.ts`, migration `0004` | UI mới; render lại `AGENTS.md` Trợ Lý khi executor đổi |
| Sẵn sàng của project/agent | Bước thiếu + Làm tiếp | — | `crew.projectReadiness`, `crew.agentReadiness` (mới) |
| Wizard thêm project | 7 bước, chạy lại được | `apps/mac-app/src/main/projects/add-project.ts`, `instructions.ts`, templates | Port logic REST sang web; phần git/Mac qua hàng đợi máy |
| Wizard tạo agent | 6 bước | `apply-roles.sh`, `merge-agent-config.mjs`, `render-instructions.mjs` | Port sang TS gọi REST bằng phiên owner |
| Hàng đợi "việc cần làm trên máy" | `add-project`, `agent-workspace`, `skill-sync`, `check` | kênh webhook ký `machine-status` | Bảng job trong DB plugin; route board tạo/thử lại; Mac kéo việc và báo kết quả (Q2) |
| Trạng thái sync skill theo máy | hash theo máy | — | Mới |
| Đính kèm | Cảnh báo file agent không đọc | plugin `attachments/*` | Cảnh báo ngay khi chọn file (cùng luật) |
| App macOS | Đăng nhập cli-auth, thêm/gỡ project, run đang chạy, health, cập nhật | `apps/mac-app` | Web giữ trang `/cli-auth/:id`; app trở thành nơi kéo hàng đợi (Q2) |
| Hai ngôn ngữ | VI/EN, lớp dịch, không gắn cứng | — | Mới (stock không có i18n thật) |

## 4. Đề xuất cấu trúc, build, deploy, clone và design system

### Vị trí

- **Fork, package mới `packages/crew-web/`** (pnpm workspace đã gồm `packages/*`). Lý do: dùng chung lockfile và
  phiên bản React/Tailwind/Radix với UI stock nên clone component không phải đổi dependency; import kiểu từ
  `@paperclipai/shared` để hợp đồng API được typecheck theo đúng bản ghim; deploy cùng overlay hiện có. Repo Crew
  (`apps/`) không có source Paperclip để clone và không có kiểu API.
- Không import trực tiếp `ui/src/**` của upstream. Clone (copy) vào `packages/crew-web/src/` để nâng upstream không
  làm vỡ UI Crew; UI Crew chỉ phụ thuộc REST API.
- Port code UI của plugin (`map`, `machines`, `docs`, `guide`) sang `crew-web`. Plugin giữ worker, data handler,
  route, webhook, job, migration. Slot UI của plugin gỡ dần khi UI stock không còn được phục vụ.

```
packages/crew-web/
  package.json            # @crew/web, vite build -> dist/
  vite.config.ts          # proxy /api sang server dev
  src/
    app/                  # router (react-router-dom 7, như stock), shell, providers (TanStack Query 5, live events WS)
    ds/                   # design system
      tokens.css          # màu, chữ, khoảng cách, bo góc, bóng, motion (clone từ ui/src/index.css + motion-tokens.css)
      components/         # Button, Input, Select, Dialog, Tabs, Badge, Card, Table, Tooltip, Popover, Command... (clone ui/src/components/ui/*)
      widgets/            # StatusBadge, StageBadge, IssueRow, RunRow, MachineCard, MarkdownView, Transcript, EmptyState, ErrorState, ConfirmDialog, Wizard
      README.md           # luật dùng DS, nguồn clone (đường dẫn upstream + tag v2026.1005.0)
    i18n/                 # i18next, vi.json, en.json; test quét chuỗi gắn cứng
    api/                  # client REST (clone ui/src/api/* phần dùng) + client plugin (data/route)
    features/             # issues, projects, agents, runs, inbox, skills, machines, docs, guide, settings, wizards
  e2e/                    # Playwright: một file mỗi màn hình + flows/
```

### Build và deploy

- `overlay-source.sh` hiện từ chối file ngoài `server/src/`, `packages/adapters/claude-local/src/`,
  `packages/crew-plugin/`, `crew/`. Thêm `packages/crew-web/` vào danh sách, build `pnpm --filter @crew/web build`,
  chép `dist/` vào `server/ui-dist/` trong overlay. Server stock đã ưu tiên `server/ui-dist` khi `SERVE_UI=true`
  (`app.ts:975`), nên **không sửa lõi** và không đụng nginx dùng chung của VPS.
- `inspect-image.sh` thêm kiểm: `server/ui-dist/index.html` là bản Crew (có marker), asset tồn tại.
- Rollback: như hiện nay, về image trước (UI stock). Đường lui khi cần UI stock: Q1.
- Không cần route mới phía server ngoài route plugin (manifest `apiRoutes`) và data handler plugin. Hook vẫn 5/5.
- WS live events, cookie phiên, `/cli-auth/:id` cùng origin `crew.2p-solutions.com`.

### Clone component và design system

1. Bước 0: clone token (`index.css` phần `:root`/`.dark`/`@theme inline`, `motion-tokens.css`) thành `ds/tokens.css`;
   clone `components/ui/*` cần dùng (shadcn: cva + Radix + lucide). Ghi nguồn từng file.
2. Bước 1: dựng widget Crew từ component (StatusBadge, StageBadge, IssueRow…), có Storybook hoặc trang `/ds` nội bộ
   chỉ bật ở dev.
3. Màn hình chỉ ghép từ `ds/`. Luật kiểm tự động: Biome/ESLint rule hoặc test quét `features/**` cấm `className` có
   màu/khoảng cách tùy ý (chỉ cho class layout), cấm `style={{…}}` ngoài `ds/`.
4. Clone màn hình stock theo thứ tự giá trị: Issues list → Issue detail (bỏ phần mục 2) → Agents list/detail → Run
   detail → Projects → Inbox → Dashboard. Mỗi màn hình clone xong phải chuyển sang component `ds/`.
5. i18n: mọi chuỗi qua `t()`, key tiếng Anh; test fail khi có text node chữ cái trong JSX của `features/**`.
   Ngày giờ theo `Asia/Ho_Chi_Minh`, định dạng theo ngôn ngữ đang chọn.

### Nghiệm thu Playwright

- Company E2E riêng có trong `CREW_POLICY_CONFIG`, project trên repo thử, máy Mac mini thật; ca đọc/ghi DB kiểm bằng
  API GET và `psql` trên bản DB thật.
- Mỗi nút trong mục 1 có ca; ca âm cho các route H2/H4/H5 và route vai trò (agent key → 403/422).
- Quét tự động: mỗi màn hình không có `button`/`a` nào thiếu handler/href, không có control disabled vĩnh viễn.

## 5. Câu hỏi cho owner

1. **UI Crew thay UI Paperclip ở đâu?** Phương án khuyên: thay hẳn ở `crew.2p-solutions.com` bằng cách chép bản build
   vào `server/ui-dist` qua overlay; khi cần UI stock thì deploy image trước (rollback vài phút), không chạy hai UI
   song song. Lý do: không sửa lõi, không đụng nginx chung; SPA fallback của server chỉ phục vụ một UI. Phương án
   khác: thêm subdomain cho UI stock qua nginx chung (rủi ro cho site khác trên VPS).
2. **Ai kéo hàng đợi "việc cần làm trên máy"?** Khuyên: app 2P Crew trên Mac (đã có board key qua cli-auth, client
   REST và toàn bộ logic thêm/gỡ project), `crew-mac` CLI chỉ gửi bản tin như hiện nay. Lý do: dùng lại code đã nghiệm
   thu, không cấp thêm quyền cho LaunchAgent. Đổi lại: app phải đang chạy thì việc mới được làm; UI hiện "Chờ app trên
   máy X".
3. **Board có được vượt cổng trên UI không?** (ép Done khi chưa đủ stage, sửa reviewer/approver của issue). Khuyên:
   không có nút; cần thì nhờ Trợ Lý hoặc script. Lý do: UI chỉ hiện thao tác đúng quy trình; H2 cho board override nên
   một nút sai là bỏ qua review/docs/push.
4. **Trang Hướng dẫn có bản tiếng Anh không?** Khuyên: có, viết ở cuối R3 từ bản VI (VI là bản gốc), vì Hướng dẫn là
   một phần UI và UI có hai ngôn ngữ. Docs dự án vẫn chỉ tiếng Việt.
5. **Company hiển thị và company test.** Khuyên: UI chỉ liệt kê company có trong `CREW_POLICY_CONFIG`; ẩn `Crew
   Spike Policy` (CREA); thêm một company "Crew E2E" trong cấu hình để Playwright chạy không làm bẩn TPS. Không có nút
   tạo company ở R3. Lý do: company ngoài cấu hình bỏ qua mọi cổng.
6. **Skill trùng tên Superpowers và phạm vi trang Skills.** Khuyên: chặn thêm skill trùng tên skill Superpowers đã
   ghim; R3 chỉ list, thêm từ nguồn GitHub, bật cho agent, trạng thái sync; Skill Studio để R sau. Lý do: skill
   Superpowers nạp qua `--plugin-dir` có namespace `superpowers:` còn skill company nạp qua `--add-dir` không namespace,
   nên không đè nhau mà cùng tồn tại hai bản, model có thể chọn nhầm (BA suy từ cơ chế nạp, chưa chạy thử).
7. **Gỡ agent / gỡ project trên web.** Khuyên: R3 chưa có; gỡ bằng app Mac ("Gỡ khỏi Mac" đã có: pause agent, archive
   environment, xóa vai trò). Lý do: terminate agent đang giữ vai trò làm project fail closed; luồng gỡ đủ bước cần
   thêm thời gian. Phương án khác: làm luồng "Gỡ" trên web dùng chung hàng đợi máy.
8. **Nhận diện hình ảnh.** Khuyên: R3 dùng token và component của Paperclip làm bản đầu của design system Crew (đổi tên,
   logo 2P), đổi màu thương hiệu sau bằng token. Lý do: clone nhanh, owner đã thấy bố cục Paperclip rõ ràng; design
   system cho phép đổi giao diện sau mà không sửa từng màn hình.

## Phụ lục — ảnh chụp

| Ảnh | Màn hình |
|---|---|
| 01–05 | Dashboard, Tasks, dialog New Task, issue gốc TPS-76 (có "Mở map"), issue con TPS-77 |
| 06–10 | Projects, project `2ps-landing` (Tasks, Configuration, Budget) |
| 11–13 | Agents, agent `tro-ly` (tab Overview), New agent |
| 14–17 | Approvals, Inbox, trang Crew (Yêu cầu, Máy, Docs), Hướng dẫn |
| 18–25 | Settings: General, Members, Secrets, Environments (trống vì cờ tắt), Experimental, Plugins, Adapters, Access |
| 26–36 | Skills, Routines, Artifacts, Connectors, Audit, Costs, Goals, Workspaces (chuyển về Dashboard vì cờ tắt), Search, Org (chuyển về Agents), Dashboard live |

Nguồn đọc: fork `crew/r2-2` (`dae04c439`) qua `git archive` (`ui/src`, `server/src/routes`, `server/src/crew`,
`packages/crew-plugin`, `crew/`); repo Crew nhánh `r22/agents` (`apps/mac-app`), `r22/mac-files` (`apps/crew-mac`);
`plans/261008-2100-crew-v3-r1-4/ac-4-report.md`, ledger R2-1/R2-2. Inventory route/nút chi tiết của UI stock do 3
agent Explore lập (issue/project, agent/run/approval, settings/khác); một số authz route (xóa project, xóa workspace,
inbox-archive, `/children`, xóa attachment, adapters, goals) chưa truy tới dòng kiểm.
