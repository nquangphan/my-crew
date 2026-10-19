# Crew v3 — Phòng Marketing (`contributor`): xem mọi thứ, gửi yêu cầu và bình luận chờ owner duyệt

Ngày: 11/10/2026 09:43, Asia/Ho_Chi_Minh (theo `date`).
Trạng thái: bản thiết kế, chờ owner đọc. Kế hoạch thi công:
[`plans/261011-0926-crew-v3-guest-approval/plan.md`](../../../plans/261011-0926-crew-v3-guest-approval/plan.md).

Nền đọc: fork Paperclip `~/Documents/projects/crew/.worktrees/paperclip-r3-dp` @ `38580c5d7` (= prod, tag
`crew/v3.3`). Mọi `file:line` dưới đây là của commit này.

## 0. Yêu cầu và quyết định owner (chốt)

Owner muốn một loại thành viên người mới, gọi là **khách góp ý**:
- xem được mọi project và issue của company;
- tạo issue và bình luận trên mọi issue;
- mỗi issue hay bình luận người này tạo đều nằm ở trạng thái **chờ duyệt** cho tới khi owner bấm **Duyệt**. Chỉ khi
  được duyệt thì agent mới bắt đầu làm, giống như board vừa đăng.

Owner đã chốt:
1. Trong lúc chờ duyệt, agent **không thấy** nội dung ở bất cứ đâu: API agent đọc, danh sách issue, danh sách bình
   luận, ngữ cảnh run, prompt, mọi lần agent fetch. Không đánh thức agent thôi thì chưa đủ.
2. Chỉ thành viên có role `owner` của company được duyệt hay từ chối.
3. Tài khoản này chỉ được xem, tạo issue (tiêu đề và mô tả) và bình luận. Không đổi trạng thái, không giao việc, không
   sửa, không xóa, không checkout. Owner giao agent lúc duyệt hoặc sau khi duyệt.
4. Bị từ chối thì vẫn giữ mục đó, gắn nhãn "Bị từ chối". Chỉ tác giả và owner thấy, agent không bao giờ thấy.

Spec này quyết thêm: khách được **chọn project** khi tạo yêu cầu. Lý do: trong Crew, project là bắt buộc với yêu cầu
(`packages/crew-web/src/features/issues/new/use-create-request.ts:28-41`). Lúc chờ duyệt, project chỉ là một cột
trong bảng chờ duyệt, nên không làm gì thêm. Loại yêu cầu (code/bug/nghiên cứu), người nhận và nháp do owner chọn lúc
duyệt.

## 1. Tên role: `contributor` ("Phòng Marketing")

- Khóa tiếng Anh là `contributor`: người ngoài đội góp nội dung, không điều hành gì.
  - `guest` dễ hiểu thành ẩn danh.
  - `reporter` chỉ đúng với việc tạo issue, không có bình luận.
- Nhãn UI: **Phòng Marketing** (vi), **Contributor** (en).
- `contributor` là **role mức Crew**, không phải giá trị `membership_role` mới của lõi. Ở lõi, khách là thành viên
  `viewer`, Crew đánh dấu thêm người này là khách góp ý. Lý do ở §3.1.

## 2. Kiến trúc chọn: nội dung chờ duyệt nằm ngoài bảng lõi

### 2.1. Ba hướng đã cân nhắc

| Hướng | Cách làm | Kết luận |
|---|---|---|
| A. Cột chờ duyệt trên `issues` và `issue_comments` | Thêm cột `crew_review_state`, lọc ở mọi chỗ agent đọc, chặn wake ở mọi chỗ ghi | **Loại.** Phải lọc rất nhiều đường đọc: list, get, comments, heartbeat-context, search, activity, plugin host, wake context, MCP. Activity log còn ghi `title` và `bodySnippet` (ví dụ `plugin-host-services.ts:1938`, `:2401-2404`), nên sót một chỗ là lộ nội dung. Thêm nữa phải có migration lõi (`packages/db`), sau này rebase upstream sẽ đụng |
| B. Dùng bảng `approvals` | Mỗi mục chờ là một approval | **Loại.** `APPROVAL_TYPES` là tập đóng (`packages/shared/src/constants.ts:689-694`). Agent đọc được approval qua `GET /companies/:companyId/approvals` (`server/src/routes/approvals.ts:205-212`, chỉ `assertCompanyAccess`). Duyệt xong route lại đánh thức `requestedByAgentId`, sai ngữ nghĩa. Nội dung issue/bình luận cũng vẫn phải để ở đâu đó |
| C. **Bảng chờ riêng của Crew** | Nội dung chờ nằm ở bảng `crew_contributions` (namespace plugin). Lúc duyệt, owner đăng nội dung qua **chính route stock của board** | **Chọn** |

`issues.hiddenAt` cũng không dùng được:
- nó chỉ lọc danh sách (`server/src/services/issues.ts:899`);
- `GET /issues/:id`, bình luận, activity vẫn trả nội dung;
- `issue_comments` không có cột tương tự.

### 2.2. Vì sao C là cách nhỏ và chắc nhất

- **Agent không thể thấy thứ không có trong bảng lõi.** Mọi đường agent đọc (§6) đều đọc bảng lõi. Mục chờ duyệt và
  mục bị từ chối không bao giờ vào bảng lõi. Không cần sửa đường đọc nào.
- **Duyệt giống hệt board đăng.** Lúc duyệt, trình duyệt của owner gọi đúng route stock mà UI Crew đang dùng khi
  owner tự đăng:
  - `POST /api/companies/:companyId/issues` (`server/src/routes/issues.ts:11514`);
  - `POST /api/issues/:id/comments` (`:17211`).

  Mọi wake đi theo stock, không phải chép lại:
  - wake người nhận (`queueIssueAssignmentWakeup`, `:11980`);
  - wake bình luận (`shouldWakeAssigneeForIssueComment`, `:18042`);
  - giao tin hội thoại (`deliverConversationComments`, `:17253`);
  - wake khi mở lại, wake dependent và parent (`:18100-18200`);
  - H4 gắn policy Crew.
- **Wake theo @mention:** ở commit này lõi **không có nơi nào sinh** `issue_comment_mentioned`. Lý do này chỉ xuất
  hiện trong danh sách lý do (`server/src/routes/issues.ts:1411`, `server/src/services/heartbeat.ts:1265`) và bảng
  map nguồn (`server/src/services/issue-tree-control.ts:84`). Vì C đi qua route stock, upstream sau này có thêm wake
  mention thì bình luận được duyệt cũng tự có, không cần sửa Crew.
- **Lặp lại an toàn (idempotent) bằng cơ chế stock có sẵn:**
  - issue: `idempotencyKey` (`packages/shared/src/validators/issue.ts:767-776`; bảng
    `issue_create_idempotency_keys`, giữ 7 ngày, `server/src/services/issues.ts:236`, `:9806-9850`);
  - bình luận: `clientRequestId` (uuid) với UNIQUE `(issue_id, author_user_id, client_request_id)`
    (`packages/db/src/schema/issue_comments.ts:48`; service trả lại bình luận cũ ở `server/src/services/issues.ts:12195`).
- **Thêm hai vá lõi nhỏ, không có migration lõi:**
  - **C7** gắn router Crew vào `app.ts`;
  - **C8** cho thành viên `viewer` đọc data của plugin `crew.core` (§3.3).

### 2.3. Luồng dữ liệu

```
Khách (viewer + dấu Crew)
  └─ UI Crew ── POST /api/crew/companies/:cid/contributions ──► server/src/crew/contribution-routes.ts
                                                                 └─ INSERT crew_contributions (status=pending)
Owner
  ├─ UI Crew ── GET  …/contributions?status=pending ──► (owner: mọi mục; khách: chỉ mục của mình)
  ├─ Duyệt:
  │   1. POST …/contributions/:id/approve            → pending→approving (khóa), trả payload + khóa idempotent
  │   2. POST /api/companies/:cid/issues {…, idempotencyKey:"crew-contribution:<id>"}   (route stock, actor = owner)
  │      hoặc POST /api/issues/:target/comments {body, clientRequestId:<id>}            (route stock, actor = owner)
  │      → stock tạo bản ghi, ghi activity, đánh thức agent như board đăng
  │   3. POST …/contributions/:id/approve/complete   → server tự tìm bản ghi ở bảng lõi → approved + result_*_id
  └─ Từ chối: POST …/contributions/:id/reject        → rejected (giữ dòng, không bao giờ vào bảng lõi)
Agent: không route nào trả crew_contributions; router Crew chặn mọi actor agent (403).
```

## 3. Role, quyền và cách mời

### 3.1. Vì sao không thêm `membership_role = "contributor"` ở lõi

Lõi so sánh role với `"viewer"` ở hơn 50 chỗ. Phần lớn có dạng "khác viewer thì được ghi", ví dụ:
- `server/src/services/authorization.ts:503`, `:518`, `:1698`, `:1728`, `:1767`, `:1809`;
- `server/src/services/chat-channels.ts:9985`, `:10345`;
- `server/src/services/tool-access.ts:14810`, `:15198`;
- `server/src/services/slack-board-authority.ts:38`;
- `server/src/routes/ai-connections.ts:112`;
- `server/src/services/git-credentials.ts:488`.

Một role mới **không phải** `"viewer"` sẽ lọt qua tất cả các kiểm tra đó và được ghi. Ngược lại, giữ khách ở
`viewer` thì mọi lệnh ghi của lõi đều bị chặn bằng code stock. Phần cho phép thêm duy nhất là router Crew.

### 3.2. Lưu dấu khách góp ý

Bảng `crew_contributors (company_id, user_id)` (§4) ghi người nào là khách góp ý. Một user là khách góp ý của company
C khi thỏa **cả hai** điều kiện:
- có membership `active`, `principal_type='user'`, `membership_role='viewer'` trong C (đọc trực tiếp DB mỗi request,
  không tin cache phiên);
- có dòng trong `crew_contributors`.

Cách này đóng khi lỗi:
- owner nâng người đó lên role khác thì dấu hết tác dụng (role khác `viewer`);
- owner gỡ dấu thì người đó còn là viewer thuần, chỉ xem;
- dấu chỉ có hiệu lực khi bật **sau** lần đổi membership gần nhất (`crew_contributors.granted_at >=
  company_memberships.updated_at`). Lõi ghi `updated_at` ở mọi lần đổi role hay status, nên người bị gỡ rồi mời lại,
  hay bị nâng rồi hạ về viewer, không tự thành khách góp ý: owner phải bật lại. `GET /contributors` chỉ liệt kê dấu
  còn hiệu lực. Bật lại (`PUT`) làm mới `granted_at` (không nhỏ hơn `updated_at` của membership).

### 3.3. Ma trận quyền

| Việc | Phòng Marketing | Owner | Admin/Operator | Viewer thuần | Agent |
|---|---|---|---|---|---|
| Xem project, issue, bình luận (GET lõi) | Có (viewer) | Có | Có | Có | Có |
| Đọc data plugin `crew.core` (`POST /api/plugins/crew.core/data/:key`) | Có (**C8**) | Có | Có | Có (**C8**) | Như stock |
| Ghi bất kỳ route lõi nào (PATCH/POST/PUT/DELETE) | **403** stock `Viewer access is read-only` (`server/src/routes/authz.ts:117`) | Có | Theo stock | 403 | Theo stock và C1–C6 |
| Tạo mục góp ý (`POST /api/crew/.../contributions`) | Có | 403 | 403 | 403 | 403 |
| Xem mục chờ/bị từ chối/đã duyệt | Chỉ mục của mình | Mọi mục | 403 | 403 | 403 |
| Duyệt / Từ chối | 403 | **Có** | 403 | 403 | 403 |
| Bật/gỡ dấu khách góp ý | 403 | Có | 403 | 403 | 403 |

"Owner" là membership `active` có `membership_role='owner'` của chính company đó, đọc từ DB. Instance admin không
phải owner và `local_implicit` (không có `userId`) đều nhận 403.

**C8 cần vì sao.** UI Crew đọc data plugin bằng `POST /api/plugins/crew.core/data/:key`. Trong số đó có
`crew.companies`, dùng để lọc company switcher (S0.2): `packages/crew-web/src/api/endpoints.ts:179-183`. Route này gọi
`assertPluginBridgeScope` → `assertCompanyAccess` (`server/src/routes/plugins.ts:1624`, `:728-738`). Request là
POST, nên viewer nhận 403. Hôm nay **UI Crew không dùng được với bất kỳ viewer nào**.

C8 chỉ thay dòng `server/src/routes/plugins.ts:1624` của route data, và chỉ khi đủ mọi điều kiện sau:
- plugin là `crew.core`, và data key nằm trong allowlist `CREW_VIEWER_DATA_KEYS` (`server/src/crew/plugin-data-scope.ts`):
  các key UI Crew đọc ở trang viewer vào được (`crew.companies`, `crew.roots`, `crew.map`, `crew.docsCheck`,
  `crew.runtimeDecisions`, `crew.machines`, `crew.setupRuns`, `crew.docs.projects|tree|page|search`). Key mới của
  plugin không tự mở cho viewer; `crew.machineJobs`, `crew.skillSync`, `crew.storage`, `crew.usage.*`,
  `crew.docs.graph|history|status` giữ kiểm tra stock;
- actor là board, có `userId`;
- company là company Crew và cấu hình Crew đọc được (`loadCrewCompanyConfig` trả `ok`; file hỏng thì đóng);
- actor có membership `active` với role `viewer` trong company đó.

Khi đó route trả `companyId` mà không qua kiểm tra ghi. Mọi trường hợp khác giữ stock. Không đụng route
`bridge/data`, `bridge/action`, `actions/:key`.

Các data key của `crew.core` (`packages/crew-plugin/src/*/data.ts`, 19 khóa) đều là đọc. Riêng `crew.companies` có
ghi cache danh sách company Crew (`packages/crew-plugin/src/companies/data.ts:51-59`), vô hại.

### 3.4. Mời khách (UI Crew, trang **Thành viên** mới, chỉ owner)

1. Owner bấm **Mời khách góp ý**. UI gọi route stock `POST /api/companies/:cid/invites`
   (`server/src/routes/access.ts:3320`) với:
   ```json
   { "allowedJoinTypes": "human", "humanRole": "viewer", "defaultsPayload": { "crew": { "role": "contributor" } } }
   ```
   `defaultsPayload` là bản ghi tự do (`packages/shared/src/validators/access.ts:15`), được giữ khi gộp
   (`server/src/routes/access.ts:2075-2097`).
2. UI hiện link để chép: `<origin>/paperclip/invite/<token>`.
   - Server trả `invitePath = /invite/<token>` (`access.ts:1117`). Nhưng ở prod, `/` dẫn tới UI Crew, không có trang
     invite (`crew/ops/nginx-crew.conf:64`).
   - Trang nhận lời mời và đăng ký nằm ở UI stock `/paperclip/` (`nginx-crew.conf:48-50`).
3. Khách mở link, đăng ký hoặc đăng nhập ở UI stock rồi gửi yêu cầu tham gia. Yêu cầu nằm ở `pending_approval`
   (`access.ts:3643+`).
4. Ở trang Thành viên, owner thấy yêu cầu tham gia (`GET /companies/:cid/join-requests`, `access.ts:4185`), có nhãn
   "Lời mời khách góp ý" khi invite tương ứng có `defaultsPayload.crew.role = "contributor"`. Owner bấm **Duyệt**:
   - UI gọi `POST …/join-requests/:id/approve` (`access.ts:4199`). Membership được tạo với role `viewer` theo invite
     (`access.ts:4229-4239`).
   - Ngay sau đó UI gọi `PUT /api/crew/companies/:cid/contributors/:userId`.
   - Bước hai lỗi thì người đó là viewer thuần (đóng khi lỗi). Trang hiện nút **Bật góp ý** để làm lại.
5. Danh sách thành viên (`GET /companies/:cid/members`, `access.ts:4481`) hiện role. Thành viên `viewer` có dấu thì
   hiện "Phòng Marketing", có nút **Gỡ góp ý**. Viewer thuần có nút **Bật góp ý**. Đổi các role khác vẫn làm ở UI stock,
   ngoài phạm vi.

## 4. Mô hình dữ liệu: migration plugin `0013_contributions.sql`

Namespace: `plugin_crew_core_0433ea20b6` (như `packages/crew-plugin/migrations/0012_runtimes.sql:1`).

```sql
CREATE TABLE plugin_crew_core_0433ea20b6.crew_contributors (
  company_id uuid NOT NULL,
  user_id text NOT NULL,
  granted_by_user_id text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id)
);

CREATE TABLE plugin_crew_core_0433ea20b6.crew_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('issue','comment')),
  author_user_id text NOT NULL,
  project_id uuid,                  -- kind=issue
  target_issue_id uuid,             -- kind=comment
  title text,                       -- kind=issue
  body text,                        -- issue: mô tả (có thể NULL); comment: bắt buộc
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approving','approved','rejected')),
  decided_by_user_id text,
  approving_at timestamptz,
  decided_at timestamptz,
  result_issue_id uuid,
  result_comment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_contributions_shape_ck CHECK (
    (kind = 'issue' AND project_id IS NOT NULL AND title IS NOT NULL AND target_issue_id IS NULL)
    OR (kind = 'comment' AND target_issue_id IS NOT NULL AND body IS NOT NULL AND project_id IS NULL AND title IS NULL)),
  CONSTRAINT crew_contributions_result_ck CHECK (
    status <> 'approved'
    OR (kind = 'issue' AND result_issue_id IS NOT NULL)
    OR (kind = 'comment' AND result_comment_id IS NOT NULL))
);
CREATE INDEX crew_contributions_status_idx ON plugin_crew_core_0433ea20b6.crew_contributions (company_id, status, created_at);
CREATE INDEX crew_contributions_author_idx ON plugin_crew_core_0433ea20b6.crew_contributions (company_id, author_user_id, created_at);
CREATE INDEX crew_contributions_target_idx ON plugin_crew_core_0433ea20b6.crew_contributions (target_issue_id) WHERE kind = 'comment';
```

- Đặt tên constraint rõ ràng, không để Postgres tự sinh (bài học 0011/0012).
- Không có FK tới bảng lõi, như các bảng plugin khác.
- Có trước khi build: kiểm `gen_random_uuid()` chạy được trên Postgres nhúng của test và Postgres prod (PG ≥ 13).
  Không có thì server tự sinh id bằng `randomUUID()` và bỏ `DEFAULT`.
- Plugin (`crew.core` worker) **không đọc, không ghi** hai bảng này và không đăng ký data key hay `apiRoutes` nào
  trỏ tới chúng. Chỉ server (router Crew) đọc/ghi, đúng mẫu `crew_runtime_waits`.
- Server đọc/ghi bảng plugin bằng SQL thô, kiểm `to_regclass` trước, như `server/src/crew/project-roles.ts:40-47`.
  Bảng chưa có (plugin chưa áp 0013) thì router trả `503 crew_contributions_unavailable`.

**Đổi trạng thái** (server, mỗi lần đổi là một `UPDATE … WHERE status = …` có điều kiện):

| Từ | Sang | Ai | Điều kiện |
|---|---|---|---|
| (mới) | `pending` | khách | tạo |
| `pending` | `approving` | owner | `approve`; ghi `decided_by_user_id`, `approving_at = now()` |
| `approving` | `approving` | owner | `approve` lại: cùng người, hoặc người khác khi `approving_at` quá 10 phút. Trước khi giành lại luôn chạy bước tìm bản ghi đã tạo |
| `approving` | `approved` | owner hoặc tự lành | tìm thấy bản ghi đã tạo ở bảng lõi (§5.3) |
| `pending` | `rejected` | owner | `reject` |
| `approving` | `rejected` | owner | `reject`, khi **không** tìm thấy bản ghi đã tạo. Tìm thấy thì chuyển `approved` và trả 409 |
| `rejected` (đã qua `approving`) | `approved` | tự lành, hoặc `approve`/`complete`/`reject` sau đó | tìm thấy bản ghi đã tạo: owner từ chối trong lúc request đăng của bước 2 chưa commit. Agent đã thấy nội dung, nên `approved` mới đúng. Log chỉ ghi id |
| `approved` | — | — | trạng thái cuối, không đổi nữa |
| `rejected` từ `pending` | — | — | trạng thái cuối (chưa từng có payload đăng, không thể lên lõi) |

Khách không sửa, không xóa, không rút mục của mình (quyết định 3).

## 5. API router Crew (vá **C7**)

File mới:
- `server/src/crew/contributions.ts`: truy cập dữ liệu, kiểm quyền, đổi trạng thái;
- `server/src/crew/contribution-routes.ts`: router Express.

Gắn router bằng một dòng ở `server/src/app.ts`, ngay sau `api.use(approvalRoutes(…))` (`app.ts:774`):
```ts
  api.use(crewContributionRoutes(db));
```
Import nằm cuối file:
```ts
import { crewContributionRoutes } from "./crew/contribution-routes.js";
```

Router nằm sau `boardMutationGuard()` (`app.ts:644`), nên POST từ trình duyệt vẫn phải đúng origin như route stock.

Luật chung của mọi endpoint:
- `req.actor.type !== "board"`, `req.actor.source !== "session"` hoặc thiếu `req.actor.userId` →
  `403 crew_contribution_forbidden`. Agent luôn bị chặn ở đây. Board API key (`board_key`) và `local_implicit` cũng
  bị chặn: board key của owner nằm trên chính máy chạy agent, và UI Crew là trình duyệt nên chỉ cần phiên đăng nhập.
- `hasCompanyAccess(req, companyId)` sai, company không phải company Crew, hoặc cấu hình Crew hỏng (đóng khi lỗi) → `404`.
- **Không gọi `assertCompanyAccess`**, vì hàm đó chặn viewer ghi. Router tự kiểm role từ DB theo §3.3.
- **Không ghi `activity_log`, không phát live event, không phát event plugin.** Agent đọc được activity
  (`server/src/routes/activity.ts:222`). Dấu vết nằm ngay trong dòng `crew_contributions`. Log pino chỉ ghi id.
- Body của request góp ý không bao giờ vào log hay báo lỗi: router dời `req.body` sang `res.locals` trước mọi bước kiểm,
  vì logger HTTP chép `req.body` vào log của mọi phản hồi ≥ 400 và error handler chép nó vào ngữ cảnh lỗi 5xx. Lỗi DB
  khi lưu góp ý (message của drizzle có tham số câu lệnh) đổi thành `500 crew_contribution_store_failed` cố định,
  không kèm `cause`; log chỉ ghi id company và mã SQLSTATE.
- Lỗi trả `{ error: "<câu tiếng Việt>", code }` như `crewAssertBoardOnly`.

| Method, path (`/api/crew/companies/:companyId/…`) | Ai | Body / query | Trả |
|---|---|---|---|
| `GET /access` | mọi thành viên board của company | — | `{ userId, membershipRole, contributor: boolean, canApprove: boolean }` |
| `GET /contributions` | owner (mọi mục), khách (mục của mình) | `status?` (`pending` gồm cả `approving`), `kind?`, `issueId?` (bình luận của một issue), `before?` (id, con trỏ trang) | `{ items: Contribution[], nextBefore: string \| null }`, mới nhất trước, 200 mục mỗi trang |
| `GET /contributions/summary` | owner, khách | — | `{ pending: number }`. Owner: mọi mục; khách: mục của mình |
| `GET /contributions/:id` | owner, tác giả | — | `Contribution` |
| `POST /contributions` | khách | `{ kind:"issue", projectId, title, description? }` hoặc `{ kind:"comment", issueId, body }` | `201 Contribution` |
| `POST /contributions/:id/approve` | owner | — | `{ contribution, materialize }`, xem dưới |
| `POST /contributions/:id/approve/complete` | owner | — | `Contribution` (`approved`) hoặc `409 crew_contribution_not_materialized` |
| `POST /contributions/:id/reject` | owner | — | `Contribution` (`rejected`), hoặc `409` khi đã duyệt |
| `GET /contributors` | owner | — | `{ items: [{ userId, grantedAt, grantedByUserId }] }` |
| `PUT /contributors/:userId` | owner | — | `204`. `409 crew_contributor_requires_viewer` khi user không phải viewer `active` |
| `DELETE /contributors/:userId` | owner | — | `204` (không có cũng là `204`) |

`Contribution` = `{ id, kind, status, authorUserId, projectId, targetIssueId, title, body, createdAt, decidedAt,
decidedByUserId, resultIssueId, resultCommentId }`. Tên người lấy ở UI qua route stock
`GET /companies/:cid/user-directory` (`access.ts:4494`, viewer đọc được).

**Kiểm đầu vào khi tạo:**
- `projectId` phải thuộc company và chưa archive.
- `issueId` phải thuộc company, chưa xóa và không bị ẩn (`hiddenAt IS NULL`).
- `title` trim, dài 1–240 ký tự (như `setIssueTitleSchema`, `packages/shared/src/validators/issue.ts:810-814`).
- `body`/`description` dùng `multilineTextSchema` của shared (như `addIssueCommentSchema.body`,
  `issue.ts:1054-1056`). Bình luận cần ít nhất 1 ký tự.
- Không nhận trường nào khác: không assignee, status, priority, label, parent, đính kèm. Gửi kèm thì trả `400`.

### 5.1. `approve`: trả payload để trình duyệt owner đăng

```json
{ "contribution": { … "status": "approving" },
  "materialize": { "kind": "issue", "companyId": "…", "projectId": "…", "title": "…", "description": "…",
                   "idempotencyKey": "crew-contribution:<id>" } }
```
Với bình luận: `{ "kind": "comment", "issueId": "<target>", "body": "…", "clientRequestId": "<id>" }`.

### 5.2. Bước đăng (trình duyệt owner, route stock)

- **Issue.** UI dựng body bằng chính `buildCreateBody` của dialog Yêu cầu mới
  (`packages/crew-web/src/features/issues/new/use-create-request.ts:28-42`), rồi thêm `idempotencyKey`. Owner chọn
  trong dialog duyệt:
  - loại (code/bug/nghiên cứu);
  - người nhận, mặc định là **Trợ Lý của project** như yêu cầu board thường;
  - "Lưu nháp" (`backlog`, chưa đánh thức).

  Sau đó gọi `POST /api/companies/:cid/issues`. H4 và wake người nhận chạy theo stock.
- **Bình luận.** Gọi `POST /api/issues/:target/comments` với `{ body, clientRequestId }`. Cờ giống composer của owner
  (`packages/crew-web/src/features/issues/detail/composer.tsx:22`): không `reopen`, `resume`, `interrupt`.
- Nội dung đăng **đúng nguyên văn** khách viết, không thêm dòng ghi tác giả. Tác giả ở lõi là owner, nên agent đọc
  như board viết, đúng ý "như board đăng". UI Crew hiện chip "Góp ý của <tên>" nhờ `result_*_id` (§7).

### 5.3. `approve/complete` và tự lành

Server tự tìm bản ghi trong bảng lõi, không tin id do client gửi:
- issue: `SELECT issue_id FROM issue_create_idempotency_keys WHERE company_id = $1 AND idempotency_key = 'crew-contribution:' || $id`,
  sau đó kiểm `issues.company_id`;
- bình luận: `SELECT id FROM issue_comments WHERE issue_id = $target AND client_request_id = $id LIMIT 1`. Không lọc
  theo tác giả, để bắt được cả trường hợp owner khác đã đăng trước khi giành lại.

Tìm thấy → `approved`, ghi `result_*_id`, `decided_at`. Không thấy → `409`, mục giữ `approving`.

**Tự lành:** `GET /contributions` và `GET /contributions/summary` chạy bước tìm này cho các dòng `approving` của
company, và cho các dòng `rejected` đã qua `approving` (`approving_at IS NOT NULL`), trước khi trả. Nhờ vậy, nếu tab owner đóng giữa bước 2 và bước 3, lần đọc sau mục vẫn thành `approved`. Bước
`approve` và `reject` cũng chạy bước tìm này trước.

### 5.4. Chi tiết chốt khi thi công (bổ sung, không đổi hình dạng ở trên)

- `GET /access`:
  - người không có membership `active` (vd. instance admin) nhận `200` với `membershipRole: null`, `contributor: false`,
    `canApprove: false`; mọi endpoint khác trả `403` cho người này;
  - vẫn trả khi bảng góp ý chưa có (`contributor: false`). Các endpoint khác trả `503`.
- Mọi `409` của mục góp ý trả `{ error, code, contribution }` (`contribution` là trạng thái hiện tại). Các mã:
  - `crew_contribution_decided`: `approve` trên mục đã `approved`/`rejected`, gồm cả trường hợp bước tìm vừa thấy bản
    ghi và chuyển `approved`;
  - `crew_contribution_locked`: owner khác đang giữ khóa `approving` chưa quá 10 phút. Áp dụng cho cả `approve` và
    `reject`, để không từ chối mục người khác đang đăng;
  - `crew_contribution_not_materialized`: `complete` khi chưa thấy bản ghi;
  - `crew_contribution_not_approving`: `complete` trên mục `pending`/`rejected`;
  - `crew_contribution_already_approved`: `reject` trên mục đã có bản ghi hoặc đã `approved`.
- `complete` trên mục đã `approved`, và `reject` trên mục đã `rejected`, trả `200` với mục như cũ (gọi lại an toàn).
- Lỗi đầu vào:
  - body sai hoặc thừa trường → `400 crew_contribution_invalid`;
  - project/issue không thuộc company, project đã lưu trữ, issue ẩn hoặc không có → `422 crew_contribution_invalid_target`;
  - `status`/`kind`/`issueId` sai ở `GET /contributions` → `400`.
- Mục không tồn tại, id sai định dạng, hoặc khách đọc mục của người khác → `404`.
- `materialize.description` là `string | null`. Mô tả rỗng hoặc chỉ có khoảng trắng lưu thành `null`.
- `GET /contributions?status=` nhận `pending` (gồm `approving`), `approving`, `approved`, `rejected`.
- Phân trang `GET /contributions`: trả `nextBefore` (id mục cuối) khi còn mục cũ hơn, `null` khi hết. Gọi lại với
  `?before=<nextBefore>` cùng bộ lọc để đọc trang kế. Con trỏ không thuộc phạm vi đọc của người gọi (company khác, hay
  mục của khách khác) cho trang rỗng; `before` sai định dạng → `400`.
- `title`, `description`, `body` chứa ký tự điều khiển (C0 trừ tab/LF/CR, DEL, C1; gồm `\u0000` mà Postgres từ chối)
  → `400 crew_contribution_invalid`, không chạm DB.
- Lỗi DB khi tạo góp ý → `500 crew_contribution_store_failed`, câu lỗi cố định.
- Board API key và `local_implicit` → `403 crew_contribution_forbidden` ở mọi endpoint, kể cả `/access`.
- Từ chối đua với bước đăng: `reject` một mục `approving` chạy đúng bước tìm của `complete`. Thấy bản ghi thì mục thành
  `approved` và trả `409 crew_contribution_already_approved`; không thấy thì từ chối. Nếu request đăng commit muộn hơn,
  mục `rejected` đó thành `approved` ở lần tự lành kế tiếp (hoặc khi gọi `approve` → `409 crew_contribution_decided`,
  `complete` → `200`, `reject` → `409 crew_contribution_already_approved`).
- Bước tìm không lọc bình luận đã xóa hay issue đã ẩn, và đó là chủ ý: bản ghi đã từng lên lõi thì agent đã thấy, nên
  `approved` là trạng thái thật. Route bình luận stock cũng trả lại đúng bình luận đã xóa khi đăng lại cùng
  `clientRequestId`, nên lọc sẽ làm mục kẹt `approving`.

## 6. Đường ghi và đường đọc

### 6.1. Mọi đường ghi của khách đều bị chặn bằng code stock

Khách là `viewer`. Mọi route ghi theo company đều đi qua `assertCompanyAccess` (`server/src/routes/authz.ts:75-119`),
trực tiếp hoặc qua `getAccessibleResource` (`authz.ts:182-194`). Request không an toàn của viewer nhận
`403 Viewer access is read-only` (`authz.ts:116-117`).

Bảng dưới liệt kê route ghi trong `server/src/routes/issues.ts` (đếm bằng script ngày 11/10, 58 route, route nào cũng
có cổng):

| Nhóm | Route (dòng) | Cổng |
|---|---|---|
| Tạo issue, issue con, tách kế hoạch | `POST /companies/:companyId/issues` (11514), `POST /issues/:id/children` (12002), `POST /issues/:id/accepted-plan-decompositions` (12255) | `assertCompanyAccess` / `getAccessibleResource` |
| Sửa issue | `PATCH /issues/:id` (12727), `PUT /issues/:id/title` (12708), watchdog (8861, 8923), runner-goal (8357), recovery (8993, 9005), monitor/retry/stalled (12507, 12535, 12574) | `getAccessibleResource` |
| Xóa, checkout, nhả | `DELETE /issues/:id` (14912), `POST /issues/:id/checkout` (14959), `/release` (15114), `/admin/force-release` (15153) | `getAccessibleResource` |
| Bình luận | `POST /issues/:id/comments` (17211), `DELETE …/comments/:commentId` (16849), queued-comments (15297, 15329, 15359, 15429, 15700), feedback-votes (18249) | `getAccessibleResource` |
| Tương tác | `POST /issues/:id/interactions` (15752) và resolve/accept/reject/respond/verdicts/withdraw/skip/cancel (15918–16724) | `getAccessibleResource` |
| Tài liệu, work product | documents (9797–10519), work-products (10626–11149), low-trust (10878) | `getAccessibleResource` |
| Đính kèm, nhãn, approval của issue | attachments (18375, 18630), labels (8277, 8301), `/issues/:id/approvals` (11437, 11479) | như trên |
| Đánh dấu đọc, lưu trữ hộp thư | `/issues/:id/read` (11193, 11232), `/inbox-archive` (11334, 11380) | `getAccessibleResource` → **viewer cũng 403**, UI phải bỏ lời gọi này (§7.1) |

Ngoài `issues.ts`:
- route plugin có scope: `assertCompanyAccess` ở `server/src/routes/plugins.ts:1877`;
- `bridge/action`, `actions/:key`: `assertPluginBridgeScope`, `plugins.ts:1530`, `:1714`;
- project: `routes/projects.ts`, có thêm C2;
- agent: `routes/agents.ts`, H5 với agent, `assertCompanyPermission` với board.

Các service còn lọc viewer riêng (§3.1). Test `crew-viewer-write-matrix.test.ts` (§9) khóa hành vi này để rebase
upstream không mở lỗ.

### 6.2. Đường đọc của agent: không cần lọc, kèm lý do

| Đường agent đọc | Vị trí | Vì sao không lộ |
|---|---|---|
| Danh sách issue, tìm kiếm | `routes/issues.ts:7779`, `:7731` | đọc `issues`; mục chờ không nằm ở đó |
| Chi tiết issue, heartbeat-context | `:8742`, `:8414` | như trên |
| Bình luận | `:15201` | đọc `issue_comments` |
| Activity, audit | `routes/activity.ts:222`, `:238` | router Crew không ghi activity |
| Ngữ cảnh wake và prompt run | `services/heartbeat.ts:7137-7162` (`wakeCommentIds`), `:10979` | id bình luận chỉ có sau khi duyệt |
| Host plugin (`issues.list/get/listComments`) | `services/plugin-host-services.ts:1900-1914`, `:2375-2380` | bảng lõi |
| SQL của plugin khác | `services/plugin-database.ts:246-276` (`validatePluginRuntimeQuery`) | mỗi plugin chỉ đọc namespace của mình và `coreReadTables` |
| Chính plugin `crew.core` | không có data key hay apiRoute nào đọc `crew_contributions` | luật của spec, có test kiểm (§9) |
| MCP agent | `packages/mcp-server/src/tools.ts` gọi REST bằng token agent | đi qua các route trên |
| Router Crew | `server/src/crew/contribution-routes.ts` | actor agent → 403 |
| Live events | `/api/companies/:cid/events/ws` | router Crew không phát event |

## 7. UI Crew (`packages/crew-web`)

### 7.1. Biết người dùng là ai, và chế độ chỉ đọc

- Hook mới `useCompanyAccess()` đọc `GET /api/crew/companies/:cid/access`, trả
  `{ isOwner, isContributor, readOnly }`, trong đó `readOnly = membershipRole === 'viewer'`.
- Khi `readOnly`, ẩn mọi nút ghi trong UI để không có nút chết (spec `e2e/specs/no-dead-controls.spec.ts`):
  - **Sidebar:** bỏ Hộp thư, Agent, Skill, Máy. "Yêu cầu mới" mở **dialog góp ý** thay cho dialog thường.
  - **Popup issue:** composer stock đổi thành composer góp ý. Ẩn sửa tiêu đề, bảng thuộc tính chỉ đọc, ẩn nút cổng/
    force-done/tương tác/tải đính kèm/hành động run. Bỏ `issues.markRead` khi mở popup.
  - **Trang project:** ẩn đổi tên, lưu vai trò, nút gỡ, wizard.
  - **Trang run:** ẩn hủy run.
  - **Command palette:** bỏ lệnh ghi.
  - **Route** `wizards/*`, `skills`, `machines`, `agents`, `inbox`: chuyển về dashboard.
  - Mọi viewer đều có lợi: hôm nay UI Crew chưa xử lý viewer.

### 7.2. Phía khách

- **Dialog "Gửi yêu cầu (chờ duyệt)":** chọn project, nhập tiêu đề, mô tả. Không có loại, người nhận, nháp, đính kèm.
  Nút **Gửi để owner duyệt**. Gửi xong báo "Đã gửi, chờ owner duyệt".
- **Composer góp ý trong popup issue:** gửi bình luận chờ duyệt. Bình luận chờ hoặc bị từ chối của chính khách hiện
  ngay trong luồng bình luận, nền mờ, badge **Chờ duyệt** hoặc **Bị từ chối**.
- **Trang "Góp ý của tôi"** (route `contributions`, mục sidebar có badge số mục chờ): ba tab Chờ duyệt / Bị từ chối /
  Đã duyệt. Mục đã duyệt có link tới issue hoặc bình luận thật.

### 7.3. Phía owner

- **Sidebar:** mục **Chờ duyệt** có badge `summary.pending`, tự làm mới mỗi 30 giây và sau mỗi lần duyệt/từ chối.
  Mục dẫn tới trang `contributions`: tab Chờ duyệt / Bị từ chối / Đã duyệt, mọi tác giả. Mỗi dòng có
  **Duyệt**/**Từ chối**.
- **Dashboard:** thẻ "Góp ý chờ duyệt" hiện số mục và link tới trang trên.
- **Danh sách issue:**
  - khi có mục chờ, đầu trang có nhóm **Chờ duyệt** liệt kê yêu cầu góp ý (badge Chờ duyệt, tác giả, project, nút
    Duyệt/Từ chối);
  - thanh lọc có chip **Chờ duyệt (n)**: bật thì chỉ hiện nhóm này.
- **Popup mục góp ý** `?contribution=<id>`, mở từ danh sách hoặc trang Chờ duyệt, cùng khung với popup issue: hiện
  tiêu đề, mô tả, project, tác giả, giờ gửi, badge, nút.
- **Popup issue:**
  - luồng bình luận chèn các bình luận chờ duyệt của mọi khách cho issue đó (`GET contributions?issueId=`), xếp theo
    giờ, có badge và Duyệt/Từ chối;
  - bình luận bị từ chối hiện badge Bị từ chối, không có nút;
  - bình luận thật sinh từ góp ý có chip "Góp ý của <tên>".
- **Dialog duyệt yêu cầu:** loại (code/bug/nghiên cứu), người nhận (mặc định Trợ Lý của project, đọc `roles.get`),
  ô "Lưu nháp". Bấm **Duyệt** thì chạy §5.1 → §5.2 → §5.3.
  - Bước 2 lỗi: hiện lỗi nguyên văn, mục giữ `approving` với nhãn "Đang duyệt dở", có nút **Duyệt lại** và **Từ chối**.
- **Duyệt bình luận:** một lần bấm, chạy đủ ba bước.
- **Từ chối:** hỏi xác nhận trước (`ConfirmDialog`).
- **Trang "Thành viên"** (route `members`, nhóm hệ thống, chỉ owner): §3.4.

Mọi chuỗi mới có ở cả `vi.json` và `en.json` của feature. Chỉ dùng component trong `src/ds` (guard
`test/guards/design-system.test.ts`, `i18n.test.ts`). Endpoint mới có trong `src/api/endpoints.ts` kèm mã BA mới
**S20.x** (§9.3). Trang Hướng dẫn (`features/guide/content/huong-dan.vi.md`, `guide.en.md`) thêm mục "Phòng Marketing".

### 7.4. UI stock `/paperclip/`

- Mục chờ duyệt và bị từ chối **không hiện ở đâu** trong UI stock, vì không nằm trong bảng lõi. Agent cũng không thấy.
- Khách đăng nhập UI stock là viewer thuần. Có thể thấy nút ghi của stock nhưng bấm sẽ nhận 403. Không gửi được góp
  ý từ UI stock. Chấp nhận được, như owner đã cho phép.
- Owner duyệt chỉ ở UI Crew. Nội dung đã duyệt hiện trong UI stock như bình luận/issue của owner, không có chip tác
  giả.

## 8. Vá lõi mới (đăng ký ở `crew/release/core-hooks.json`, `kind: "core-patch"`)

| Id | File | Anchor (một lần) | importLine (cuối file) | Test |
|---|---|---|---|---|
| **C7** | `server/src/app.ts`, symbol `createApp api router (Crew contribution routes)` | `  api.use(crewContributionRoutes(db));` | `import { crewContributionRoutes } from "./crew/contribution-routes.js";` | `server/src/__tests__/crew-contributions.db.test.ts`, `server/src/__tests__/crew-contributions-agent-blind.test.ts` |
| **C8** | `server/src/routes/plugins.ts`, symbol `pluginRoutes POST /plugins/:pluginId/data/:key` | `    const companyId = (await crewViewerPluginDataScope(db, req, plugin.pluginKey, key, body?.companyId)) ?? assertPluginBridgeScope(req, body?.companyId);` | `import { crewViewerPluginDataScope } from "../crew/plugin-data-scope.js";` | `server/src/__tests__/crew-plugin-data-viewer.test.ts`, `server/src/__tests__/crew-viewer-write-matrix.test.ts` |

- Mô tả theo mẫu C1–C6: câu tiếng Anh, nói hành vi, không nói số ticket.
- Hook vẫn là 5/5. `node crew/release/check-core-hooks.mjs` phải báo `lỗi: 0`, vá lõi tăng từ 6 lên 8.
- Kiểm thêm: `symbol` của C7 phải khớp tên hàm thật trong `app.ts`. Implementer đọc rồi ghi đúng.

## 9. Test

### 9.1. Server (fork, Vitest, Postgres nhúng như `crew-agent-board-only-routes.test.ts`)

- `crew-contributions.db.test.ts` (route và DB). Áp `packages/crew-plugin/migrations/0013_contributions.sql` vào
  namespace như `crew-runtime-switch.db.test.ts`. Các ca:
  - quyền tạo: khách 201; viewer không dấu, operator, admin, owner, agent đều 403; company không phải Crew 404;
    project/issue của company khác 404/422; `title` rỗng hoặc dài 241 → 400; trường lạ (`assigneeAgentId`) → 400;
  - quyền đọc: khách chỉ thấy mục của mình; owner thấy tất cả; admin 403;
  - đổi trạng thái: `approve` 2 lần cùng owner → cùng `approving`; owner khác trong 10 phút → 409, sau 10 phút → giành
    được; `complete` khi chưa có bản ghi → 409; có dòng `issue_create_idempotency_keys` → `approved` + `result_issue_id`;
    có bình luận `client_request_id = id` → `approved` + `result_comment_id`; `reject` khi `approving` mà đã có bản
    ghi → `approved` + 409; mục cuối không đổi được;
  - tự lành: dòng `approving` có bản ghi → `GET /contributions` trả `approved`;
  - bảng chưa có (không áp 0013) → 503;
  - contributors: `PUT` cho viewer 204; cho operator 409; `DELETE` 204; sau `DELETE` khách tạo → 403.
- `crew-contributions-agent-blind.test.ts`: chứng minh quyết định 1. Khách tạo yêu cầu (tiêu đề chứa chuỗi đánh dấu
  `crew-blind-<uuid>`) và bình luận chờ trên một issue có agent nhận. Với actor agent:
  - `GET /companies/:cid/issues`, `/search?q=`, `/issues/:id`, `/issues/:id/comments`, `/issues/:id/heartbeat-context`,
    `/companies/:cid/activity` **không chứa** chuỗi đánh dấu;
  - `agent_wakeup_requests` và `heartbeat_runs` không có dòng mới;
  - mọi endpoint Crew → 403.

  Sau khi owner duyệt **qua route stock** (dùng `issueRoutes` thật):
  - bình luận có trong `GET comments`;
  - có `agent_wakeup_requests` reason `issue_commented` cho người nhận;
  - issue duyệt kèm người nhận có wake `issue_assigned`.
- `crew-plugin-data-viewer.test.ts` (C8):
  - viewer gọi `POST /plugins/crew.core/data/crew.companies` cho company Crew → tới worker (200, worker giả);
  - viewer với plugin khác → 403;
  - viewer với company không phải Crew → 403;
  - viewer company khác → 403;
  - operator/owner giữ stock; agent giữ stock.
- `crew-viewer-write-matrix.test.ts`: session viewer nhận 403 ở `POST /companies/:cid/issues`,
  `POST /issues/:id/comments`, `PATCH /issues/:id`, `PUT /issues/:id/title`, `POST /issues/:id/checkout`,
  `DELETE /issues/:id`, `POST /issues/:id/children`, `POST /companies/:cid/issues/:id/attachments`,
  `POST /issues/:id/interactions`, `POST /issues/:id/read`, `POST /plugins/crew.core/api/issues/:id/force-done`.
- `crew/release/check-core-hooks.mjs` chạy sạch. `check-core-hooks.test.mjs` không đổi.

### 9.2. Plugin

`packages/crew-plugin/src/__tests__/migration-0013.db.test.ts`, khuôn của `migration-0012.db.test.ts`:
- áp 0001–0012, ghi dữ liệu, áp 0013;
- dữ liệu cũ còn nguyên;
- hai CHECK có tên đúng (đọc `pg_constraint`): sai shape → lỗi, `approved` thiếu `result_*` → lỗi;
- PK của `crew_contributors`;
- ba index tồn tại.

Thêm một test tĩnh trong plugin: không file `src/**` nào nhắc `crew_contributions` (luật §4).

### 9.3. UI Crew

- Unit (Vitest):
  - `useCompanyAccess`;
  - lọc sidebar cho viewer, khách, owner;
  - điều phối duyệt `approveContribution()`: gọi đúng thứ tự `approve` → route stock (đúng `idempotencyKey`/
    `clientRequestId`) → `complete`; bước 2 lỗi thì không gọi `complete`; gọi lại thì dùng lại khóa cũ;
  - `buildCreateBody` dùng chung;
  - chèn bình luận chờ vào luồng theo giờ;
  - `endpoints.test.ts` gồm endpoint mới;
  - guard design-system và i18n xanh.
- Mã BA mới: S20.1 gửi yêu cầu góp ý, S20.2 gửi bình luận góp ý, S20.3 trang Góp ý, S20.4 duyệt yêu cầu, S20.5 duyệt
  bình luận, S20.6 từ chối, S20.7 badge/đếm sidebar và thẻ dashboard, S20.8 trang Thành viên (mời, duyệt tham gia,
  bật/gỡ góp ý). Thêm vào `e2e/ba-ids.json` và `e2e/coverage.json`.
- Playwright `e2e/specs/s20-contributions.spec.ts`, tầng T2 (prod, company Crew E2E, chế độ stub), hai phiên: board
  (owner) và khách (`CREW_E2E_CONTRIBUTOR_EMAIL`/`_PASSWORD`, đọc như mật khẩu board, `test.use({ trace: 'off' })` ở
  file đăng nhập). Ca:
  1. **PW-S20-1** khách gửi yêu cầu với tiêu đề có đánh dấu. Kiểm:
     - `db.query` không có dòng `issues` nào có tiêu đề đó;
     - có dòng `crew_contributions` `pending`;
     - agent token tạm (`agent-token.ts`) gọi `GET issues?q=` không thấy.
  2. **PW-S20-2** khách bình luận chờ trên issue `e2e-base`. Kiểm:
     - không có trong `GET comments` bằng token agent;
     - không có `heartbeat_runs` mới cho issue đó trong 10 giây.
  3. **PW-S20-3** owner thấy badge sidebar ≥ 2, chip Chờ duyệt trong danh sách issue, bình luận chờ trong popup.
  4. **PW-S20-4** owner duyệt bình luận. Kiểm:
     - có bình luận thật, tác giả owner, `client_request_id` = id mục;
     - có `heartbeat_runs` mới cho người nhận (stub).
  5. **PW-S20-5** owner duyệt yêu cầu, chọn "Lưu nháp". Kiểm: có issue `backlog` trong project, người nhận là Trợ Lý,
     không wake. Giữ nháp để không tốn run; ca T3 tùy chọn bỏ nháp.
  6. **PW-S20-6** owner từ chối mục thứ ba. Kiểm:
     - khách thấy badge Bị từ chối;
     - token agent không thấy;
     - khách không có nút ghi nào (lặp lại kiểm của `no-dead-controls` cho phiên khách).
  7. **PW-S20-7** (T1) trang Thành viên: tạo lời mời khách, link có dạng `/paperclip/invite/…`; bật/gỡ dấu cho một
     viewer.

  Dọn sau ca: `trackIssue` hủy issue đã tạo. Mục góp ý của company e2e ở trạng thái cuối, để lại (nhỏ, có nhãn).

## 10. Tiêu chí nghiệm thu (đo được trên prod)

| AC | Kiểm thế nào |
|---|---|
| AC1. Owner mời một khách ở trang Thành viên UI Crew. Khách đăng ký qua link `/paperclip/invite/…`. Owner duyệt tham gia, người đó hiện "Phòng Marketing" | Làm tay; `psql` chỉ đọc: `company_memberships.membership_role='viewer'` và có dòng `crew_contributors` |
| AC2. Khách thấy mọi project, issue, bình luận ở UI Crew. Không có nút ghi nào, không lỗi 403 nào hiện trên màn hình | PW-S20-6, kèm DevTools không có request 403 khi duyệt 5 trang chính |
| AC3. Khách gửi yêu cầu và bình luận. Cả hai hiện "Chờ duyệt" với khách và owner | PW-S20-1..3 |
| AC4. Lúc chờ, nội dung không có ở bất cứ API nào agent gọi, không có run hay wake nào | PW-S20-1, -2 và `crew-contributions-agent-blind.test.ts` |
| AC5. Chỉ owner duyệt/từ chối được. Admin, operator, khách, agent gọi API duyệt nhận 403 | Test server; T2 thử `api.raw` bằng phiên khách → 403 |
| AC6. Duyệt bình luận → bình luận của owner xuất hiện, agent nhận được đánh thức như board viết | PW-S20-4 |
| AC7. Duyệt yêu cầu → issue thật trong project, policy Crew gắn như yêu cầu board, người nhận theo lựa chọn | PW-S20-5; kiểm `executionPolicy` khác null như issue board |
| AC8. Từ chối → mục còn, nhãn "Bị từ chối", chỉ khách và owner thấy; agent không bao giờ thấy | PW-S20-6 |
| AC9. Khách gọi thẳng route ghi lõi (PATCH status, assign, checkout, DELETE, sửa tiêu đề) nhận 403 | T2 `api.raw` phiên khách |
| AC10. Duyệt bị ngắt giữa chừng (đóng tab sau bước 2) không tạo bản trùng; lần tải sau mục thành "Đã duyệt" | Test server tự lành; T1 làm tay |
| AC11. UI stock `/paperclip/` không hiện mục chờ hay bị từ chối | Làm tay trên prod |
| AC12. `check-core-hooks` báo hook 5/5, vá lõi 8, lỗi 0; `pnpm -r typecheck`, test server/plugin/crew-web xanh | CI cục bộ trước deploy |

## 11. Rủi ro

| Rủi ro | Khả năng × Tác động | Giảm thiểu |
|---|---|---|
| Thêm role lõi mới làm lọt quyền ghi ở hơn 50 chỗ so `!== "viewer"` | — (đã tránh) | Khách là `viewer` ở lõi (§3.1) |
| C8 cho viewer đọc data `crew.core` | Thấp × Trung bình | Chỉ `crew.core`, chỉ key trong allowlist, chỉ company Crew có cấu hình đọc được, chỉ route data. Mọi data key đều là đọc (§3.3). Viewer vốn đọc được dữ liệu tương đương qua GET lõi |
| Trình duyệt owner điều phối duyệt, có thể đứt giữa chừng | Trung bình × Thấp | Trạng thái `approving`, khóa idempotent stock, server tự tìm bản ghi, tự lành khi đọc (§5.3) |
| Khóa idempotent issue chỉ giữ 7 ngày | Rất thấp × Trung bình | Tự lành chạy ở mọi lần đọc danh sách và đếm sidebar, nên `approving` khó sống quá vài phút |
| Hai owner giành duyệt một bình luận | Rất thấp × Thấp | Khóa 10 phút; trước khi giành lại luôn tìm bình luận theo `client_request_id` mọi tác giả. Còn sót: request đăng của owner A treo quá 10 phút rồi mới commit sau khi owner B đã đăng, thì có hai bình luận giống nhau (UNIQUE của stock tính theo tác giả) và agent bị đánh thức hai lần. Chấp nhận; owner xóa bản thừa |
| Owner từ chối trong lúc request đăng của bước 2 chưa commit | Thấp × Trung bình | Nội dung vẫn lên lõi và agent thấy. Không chặn được từ router (route stock không biết trạng thái góp ý); tự lành chuyển mục `rejected` đó thành `approved` để nhãn đúng sự thật (§4, §5.4) |
| Link mời của server là `/invite/<token>`, tới UI Crew (không có trang) | Cao × Trung bình | UI dựng `/paperclip/invite/<token>`. T0 kiểm trên prod |
| Prod tắt đăng ký (`PAPERCLIP_AUTH_DISABLE_SIGN_UP`, `server/src/config.ts:219-223`) thì khách mới không tạo được tài khoản | Trung bình × Cao | T0 đọc giá trị (không in secret). Nếu đang tắt, xem câu hỏi Q2 |
| Khách đọc được mọi thứ viewer đọc được qua API: agent, run, transcript, chi phí, activity | Chắc chắn × tùy owner | UI Crew ẩn mục, nhưng API vẫn trả. Xem Q1 |
| Server ghi bảng plugin thứ hai (sau `crew_runtime_waits`) | Thấp × Thấp | Kiểm `to_regclass`, trả 503 khi chưa có; ghi rõ trong mô tả C7 |
| Rebase upstream làm lệch anchor C7/C8 hoặc mở đường ghi cho viewer | Trung bình × Cao | `check-core-hooks.mjs`, `crew-viewer-write-matrix.test.ts` chạy trong `crew/release/verify.sh` |
| Khách gửi rác hàng loạt | Thấp × Thấp | Owner từ chối hoặc gỡ dấu. Không thêm giới hạn (không ai yêu cầu) |
| Agent nghĩ bình luận đã duyệt là owner viết | Chắc chắn × Thấp | Đúng ý "như board đăng"; chip tác giả chỉ ở UI Crew |

## 12. Rollback

- **UI Crew:** deploy lại image trước (`crew/ops/rollback.sh`). Phần UI góp ý biến mất, dữ liệu còn nguyên.
- **C7/C8:** revert commit fork rồi rollback image. Router Crew mất, khách chỉ còn là viewer thuần. Mục chờ nằm yên
  trong bảng plugin, agent vẫn không thấy. Mục `approving` mà bản ghi đã tạo vẫn là bản ghi board bình thường.
- **Migration 0013:** chỉ thêm bảng, không có migration ngược, để nguyên. Rollback plugin về bản trước không đụng hai
  bảng này.
- **Tắt tính năng mà không deploy:** owner gỡ dấu mọi khách (`DELETE /contributors/:userId`) hoặc gỡ membership.

## 13. Câu hỏi cho owner

- **Q1.** Khách đang có quyền đọc như viewer: ngoài project và issue, qua API khách còn đọc được danh sách agent, run,
  transcript run, chi phí, activity. UI Crew sẽ ẩn các mục đó với khách, nhưng chặn hẳn ở API cần thêm nhiều vá lõi.
  Đại Ca chấp nhận mức "ẩn ở UI" không?
- **Q2.** Chỉ hỏi nếu T0 thấy prod đang tắt đăng ký: mở đăng ký (mọi người có link mời mới đăng ký được, vì vẫn cần
  owner duyệt tham gia), hay owner tạo tài khoản sẵn cho khách?
