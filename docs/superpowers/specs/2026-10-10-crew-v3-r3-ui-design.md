# Crew v3 R3 — UI Crew mới hoàn toàn

Ngày: 10/10/2026 00:40, Asia/Ho_Chi_Minh. Trạng thái: spec đã viết, plan ở
[plans/261010-0020-crew-v3-r3/plan.md](../../../plans/261010-0020-crew-v3-r3/plan.md). Owner vắng tới sáng 10/10:
cả 8 câu hỏi của BA đang **tạm theo phương án BA khuyên** (mục 12). Owner phủ quyết thì đổi theo bảng ở mục 12.

Nguồn yêu cầu: mục "R3 — UI Crew mới hoàn toàn" của
[kế hoạch stock-first](../../../plans/261006-0805-crew-v3-stock-first/plan.md) (owner chốt 09/10/2026). Phân tích nghiệp
vụ: [BA R3](../../../plans/261010-0020-crew-v3-r3/ba/ba-report.md) (mục 1: danh sách màn hình, nút, flow và ca
Playwright; mục 2: feature Paperclip không có trong Crew; mục 3: phần riêng của Crew; mục 4: đề xuất cấu trúc; mục 5:
câu hỏi). Spec này **không chép lại** bảng nút của BA. Bảng đó là danh mục chuẩn: mã `S0.1`…`S19`, `F1`…`F9` và mã ca
`PW-…` trong spec, plan và test đều trỏ về đó. Spec chỉ ghi phần thay đổi so với BA (mục 5) và phần thiết kế BA chưa
chốt.

## 1. Mục tiêu

1. Owner mở `https://crew.2p-solutions.com` thì thấy UI Crew, không còn UI Paperclip. Mọi nút và màn hình đều làm
   được việc thật trong Crew: đổi DB (qua REST Paperclip hoặc plugin `crew.core`) hoặc đổi trạng thái trên Mac. Không
   có nút bấm mà không có tác dụng.
2. Giữ flow và cách chia màn hình của Paperclip (company → project → issue, agent, run, inbox). Chỉ bỏ những thao tác
   không có tác dụng (BA mục 2) và thêm phần riêng của Crew (BA mục 3).
3. Có design system bắt buộc: token, component, widget. Màn hình chỉ được ghép từ đó, không tự đặt style. Code clone từ
   Paperclip cũng phải chuyển sang dùng design system.
4. Có hai ngôn ngữ: tiếng Việt (bản gốc) và tiếng Anh, người dùng tự chuyển. Mọi chuỗi hiển thị đi qua lớp dịch.
5. Những việc hiện phải làm bằng script trở thành luồng làm đủ bước trên UI: thêm project, tạo agent, sửa vai trò,
   thêm skill và đồng bộ skill về Mac. Agent hoặc project chưa đủ bước thì hiện "Chưa sẵn sàng", kèm bước còn thiếu và
   nút "Làm tiếp".
6. Bịt các lỗ hổng quyền BA tìm ra, và truy nốt các route chưa được kiểm.
7. Vẫn nâng được Paperclip theo mỗi bản stable. Không thêm hook (giữ 5/5). UI chỉ gọi REST Paperclip và plugin Crew.

## 2. Hiện trạng đã kiểm (bằng chứng)

| Sự thật | Nguồn |
|---|---|
| Prod chạy fork `crew/r2-2` @ `f862b7b20` (image `crew-v3/paperclip:v3-f862b7b20`, mốc rollback `20261010-003110`). Plugin `crew.core` ready, migration 0001–0005 | ledger R2-2 dòng DP-1 00:33 |
| Server ưu tiên `server/ui-dist/index.html`, sau đó mới tới `ui/dist`, khi `uiMode === "static"`. Image stock build UI vào `/app/ui/dist` và **không có** `server/ui-dist` | fork `server/src/app.ts:972-1030`, `Dockerfile:134` |
| `readBrandedStaticIndexHtml` chỉ thay khối giữa các mốc `<!-- PAPERCLIP_FAVICON_* -->`, `<!-- PAPERCLIP_RUNTIME_BRANDING_* -->`. Không có mốc thì giữ nguyên HTML | `server/src/ui-branding.ts` |
| `overlay-source.sh` từ chối file đổi ngoài `server/src/`, `packages/adapters/claude-local/src/`, `packages/crew-plugin/`, `crew/`, `pnpm-lock.yaml`, `*.md` | `crew/ops/overlay-source.sh:18` |
| UI stock: React 19, react-router-dom 7, TanStack Query 5, Tailwind 4, Radix, cva, lucide, i18next 26 + react-i18next 17 (đã có trong lockfile). Có 21 component `ui/src/components/ui/*` kiểu shadcn | `ui/package.json`, `ui/src/components/ui` |
| Route plugin (`apiRoutes`) có `auth: board`, `agent`, `board-or-agent`. Với `board`, host gọi `assertBoard`. Board API key do app Mac lấy qua `cli-auth` cũng là actor board | `server/src/routes/plugins.ts:636-652` |
| Data plugin `POST /api/plugins/:id/data/:key` chỉ cho board (`assertBoardOrgAccess`) | `plugins.ts:1585` |
| Plugin đọc được SQL các bảng lõi: `companies, projects, goals, agents, issues, issue_documents, issue_relations, issue_comments, heartbeat_runs, cost_events, approvals, issue_approvals, budget_incidents`. **Không đọc được** `environments`, `company_skills`, instructions bundle | `packages/shared/src/constants.ts:1439` |
| `canCreateAgents` ngoài quyền tạo agent còn **cấp luôn `canAssignTasks`** (`taskAssignSource: "agent_creator"`). Tắt nó mà không cấp grant `tasks:assign` thì Trợ Lý mất quyền giao việc | `server/src/routes/agents.ts:1596-1625`, `:4972` |
| `canCreateSkills` mặc định `true` cho mọi agent | `server/src/services/agent-permissions.ts:47` |
| `POST /companies/:id/projects` chỉ kiểm `assertCompanyAccess`, nên agent cũng tạo được project. Không có hook nào trên đường này | `server/src/routes/projects.ts:233`; BA mục 0 |
| Bản tin máy `MachineReport` v1: `superpowers {pinned, ownerInstalled}`, `checks`, `app?`. Chưa có danh sách checkout và tên skill Superpowers. Bản tin gửi cho **một** company | `apps/crew-mac/src/status/report.ts` (nhánh `r2-2`) |
| Wrapper `crew-claude-run.sh` đã có biến `CREW_CLAUDE_BIN` (dùng cho test) và cổng `workflow-check` | `apps/crew-mac/assets/crew-claude-run.sh` |
| App Mac có sẵn luồng thêm project từ folder (`inspectFolder`, worktree, exclude `.paperclip-runtime`, environment, agent, `AGENTS.md`, vai trò, pause khi lỗi, chạy tiếp) | `apps/mac-app/src/main/projects/{add-project,folder,instructions,progress}.ts` |
| App đang ký bằng Apple Development, chưa có Developer ID. Updater tự tắt nếu chưa ký Developer ID; bản app mới phải cài tay | ledger R2-1 dòng 118–120, 176 |

## 3. Phạm vi

- **Có trong R3:** màn hình `S0`–`S19` và flow `F1`–`F8` của BA mục 1, với các thay đổi ở mục 5. `F9` (máy quá tải)
  không bắt buộc: chỉ chạy khi còn thời gian và không tốn quota.
- **Không có trong R3:** mọi dòng ở BA mục 2. Hướng dẫn trong UI có mục "Vì sao không có nút X" lấy đúng bảng này (VI
  và EN).
- **Không làm:** xem mục 11.

## 4. Kiến trúc

### 4.1. Vị trí và package

- Package mới trong fork: `packages/crew-web/`, tên `@crew/paperclip-web` (đặt tên giống `@crew/paperclip-plugin`; không
  lấy tên `@crew/web` vì trùng package web của repo Crew). Dùng chung lockfile và các phiên bản React, Tailwind, Radix,
  i18next đang có, nên không thêm dependency runtime mới, trừ `@xyflow/react` (plugin đã dùng). Riêng dev có thể thêm
  `@testing-library/react`, `jsdom`, `@playwright/test` nếu lockfile chưa có.
- Kiểu dữ liệu API import từ `@paperclipai/shared` (`workspace:*`), nên hợp đồng REST được typecheck theo đúng bản ghim.
- **Không import `ui/src/**`.** Component cần dùng được chép (clone) vào `packages/crew-web/src/ds/`. Mỗi file chép ghi
  nguồn ở dòng đầu: `// clone: ui/src/components/ui/button.tsx @ v2026.1005.0`.
- Code thuần (không React) đang nằm trong plugin thì dùng lại, không chép: layout và chiếu dữ liệu map
  (`src/ui/map/{layout,project}.ts`), cây docs (`src/ui/docs/tree.ts`), định dạng thẻ máy (`src/ui/machines/*` phần
  thuần), luật đuôi file (`src/attachments/rules.ts`). Plugin export các module này qua `exports` subpath
  `@crew/paperclip-plugin/shared/*`. Component React dựng lại bằng design system.
- Slot UI của plugin (`CrewPage`, `CrewIssueTab`…) giữ nguyên trong R3. Khi UI stock không còn được phục vụ, các slot
  này không hiện ở đâu; giữ lại để rollback về image cũ vẫn chạy. Gỡ ở R sau.

```
packages/crew-web/
  package.json  vite.config.ts  tsconfig.json  index.html  playwright.config.ts
  src/
    main.tsx
    app/        router.tsx, shell/ (sidebar, header, company switcher, account menu, command palette),
                providers.tsx (QueryClient, i18n, live events), auth/ (login, cli-auth, guard)
    ds/         tokens.css, components/ (clone + chỉnh), widgets/ (ghép riêng Crew), index.ts, README.md
    i18n/       index.ts, vi.json, en.json, format.ts (giờ Asia/Ho_Chi_Minh theo ngôn ngữ)
    api/        http.ts, paperclip/*.ts (REST stock), crew/*.ts (plugin data + route), queryKeys.ts
    features/   dashboard, inbox, issues, runs, search, projects, agents, skills, machines, docs, guide,
                settings, readiness, wizards
  test/         guards/ (design system, i18n, nút chết), unit theo feature
  e2e/          support/ (đăng nhập, fixture Crew E2E, DB check, stub), specs/<màn hình>.spec.ts,
                flows/*.spec.ts, coverage.json
```

### 4.2. Design system

- **Token** (`ds/tokens.css`): chép phần `:root`, `.dark` và `@theme inline` của `ui/src/index.css`, cùng
  `motion-tokens.css`. Bản đầu dùng giá trị của Paperclip; đổi tên thương hiệu và logo sang 2P Crew (Q8). Đổi giao
  diện về sau chỉ sửa token.
- **Component** (`ds/components/`): bản clone của `button, input, textarea, label, select, checkbox, toggle-switch,
  dialog, alert-dialog, sheet, popover, dropdown-menu, tooltip, tabs, badge, card, avatar, separator, skeleton,
  scroll-area, command, breadcrumb, collapsible`. Thêm `Table`, `EmptyState`, `ErrorState`, `Spinner`, `Field`
  (nhãn, gợi ý, lỗi) dựng từ token.
- **Widget** (`ds/widgets/`): `StatusBadge`, `StageBadge`, `ReadinessBadge`, `IssueRow`, `RunRow`, `AgentRow`,
  `MachineCard`, `MarkdownView`, `Transcript`, `ConfirmDialog`, `Wizard` (các bước, tiến độ, lỗi, nút "Chạy tiếp"),
  `CrewSummary`, `CrewMap`, `DocsCheckPanel`, `PropertyList`, `PageHeader`, `FilterBar`, `AttachmentPicker`.
- **Luật** (test chạy trong `pnpm --filter @crew/paperclip-web test`, đỏ là chặn merge):
  1. Trong `src/features/**` và `src/app/**` không được có `style={…}`.
  2. `className` ngoài `src/ds/**` chỉ được dùng class bố cục trong danh sách cho phép (`flex`, `grid`, `gap-*`,
     `col-span-*`, `items-*`, `justify-*`, `min-w-0`, `truncate`, `hidden`, `sm:/md:/lg:` của các class này). Cấm class
     màu (`bg-*`, `text-<màu>`, `border-<màu>`), cỡ chữ, bo góc, bóng, khoảng cách tùy ý (`p-[..]`, `m-[..]`).
  3. `src/features/**` không import thẳng `radix-ui`, `@base-ui/react`, `class-variance-authority`; chỉ import từ
     `@/ds`.
  4. Trang `/ds` (chỉ build dev, `import.meta.env.DEV`) hiện mọi component và widget ở cả hai theme.

### 4.3. Hai ngôn ngữ

- Dùng `i18next` + `react-i18next`. Key viết tiếng Anh theo dạng `<feature>.<chỗ>.<ý>`. `vi.json` là bản gốc, `en.json`
  là bản dịch. Ngôn ngữ lưu ở `localStorage['crew.lang']`, mặc định `vi`.
- Ngày giờ hiển thị theo `Asia/Ho_Chi_Minh` qua `i18n/format.ts` (`Intl.DateTimeFormat`, `vi-VN` hoặc `en-GB`).
- **Test chặn:**
  1. Hai file có đúng cùng một tập key.
  2. Quét AST (TypeScript compiler) mọi file `.tsx` trong `src/features/**`, `src/app/**`, `src/ds/widgets/**`. Không
     được có JSX text hay thuộc tính `title|placeholder|aria-label|alt` là chuỗi chứa chữ cái, trừ danh sách cho phép
     (ký hiệu, tên riêng `Crew`, `Paperclip`, `Claude`).
  3. Ca `PW-S0-3`: ở chế độ EN, quét DOM không còn chuỗi tiếng Việt gắn cứng. Dữ liệu từ API (tên issue, comment) không
     tính.
- Lỗi do server trả về (ví dụ câu lỗi tiếng Việt của plugin) hiện nguyên văn trong `ErrorState`, có tiêu đề đã dịch.
  Plugin không phải dịch.

### 4.4. Lớp dữ liệu

- `api/http.ts` dùng `fetch` cùng origin, `credentials: "include"`. Lỗi 401 chuyển về `/login?next=`. Lỗi 4xx/5xx trả
  `ApiError {status, code?, message}`.
- `api/paperclip/*` chỉ gồm các endpoint có trong cột "Tác dụng thật" của BA mục 1. Test liệt kê: không có hàm gọi
  endpoint nằm ngoài danh sách đó (so với `api/endpoints.ts`, một bảng hằng duy nhất).
- `api/crew/*` gọi data plugin (`POST /api/plugins/crew.core/data/<key>`) và route plugin
  (`/api/plugins/crew.core/api/...`).
- Cập nhật trực tiếp: WebSocket `/api/companies/:c/events/ws` như UI stock. Sự kiện về thì invalidate query theo
  `queryKeys`.
- Company hiển thị: chỉ company có trong `instanceConfig.companies` của plugin (data mới `crew.companies`). Lúc deploy,
  script kiểm danh sách này khớp với `CREW_POLICY_CONFIG` (mục 4.10). Lý do: worker plugin không đọc được file policy
  của server. Hai danh sách vốn phải khớp vì webhook máy cần secret theo company.

### 4.5. Plugin `crew.core` thêm gì

Plugin giữ worker, data, route, webhook, job, migration như cũ. R3 thêm:

| Thêm | Loại | Mục đích |
|---|---|---|
| Migration `0006_machine_jobs.sql`: bảng `crew_machine_jobs` | DB | Hàng đợi việc trên máy (mục 4.6) |
| Migration `0007_setup_runs.sql`: bảng `crew_setup_runs` | DB | Tiến độ wizard, chạy tiếp từ bước dở, nguồn cho trạng thái sẵn sàng |
| Route `machine-jobs` (tạo, liệt kê, nhận việc, báo kết quả, thử lại) | `apiRoutes`, `auth: board` | Web tạo việc; app Mac nhận việc và báo kết quả bằng board key |
| Route `setup-runs` (tạo, ghi bước, đọc) | `apiRoutes`, `auth: board` | Web ghi tiến độ wizard |
| Data `crew.companies`, `crew.machineJobs`, `crew.setupRuns`, `crew.skillSync` | data | Đọc cho UI |
| Bản tin máy nhận thêm key tùy chọn `checkouts`, `superpowers.skills`, `jobsAgent` | webhook `machine-status` | Trạng thái sẵn sàng, chặn skill trùng tên, biết app có đang nhận việc không |
| Export subpath `shared/*` (map, docs tree, machine card, rules) | package | Web dùng lại logic thuần |

Mọi route mới kiểm lại actor ngay trong handler (không chỉ dựa vào host), giống `roles/api.ts`. Lỗi DB không trả SQL
cho client.

### 4.6. Hàng đợi "việc cần làm trên máy"

- **Ai nhận việc:** app 2P Crew trên Mac (Q2). App đã có board key qua `cli-auth` và client REST. Cứ 5 giây (khi cửa sổ
  ẩn thì 15 giây) app gọi `POST …/machine-jobs/claim {companyId, machineId}` cho từng company trong danh sách đích của
  bản tin máy. Danh sách đó là một nguồn duy nhất trên Mac: `~/.crew/status.json` có thêm `targets[]`, mỗi đích gồm
  company, webhook secret ref trong Keychain và machine id.
- **Loại việc:**

| `kind` | Payload | App làm gì | Kết quả |
|---|---|---|---|
| `inspect-folder` | `{folder}` (đường tuyệt đối) | `inspectFolder` có sẵn: gốc git, nhánh, remote, `crew-docs.bundle`, cây sạch, đường bị cấm (TCC) | `{root, branch, remote, docsBundle, clean}` |
| `prepare-checkouts` | `{projectKey, folder, roles:[{role, branch}]}` | Với mỗi vai trò: worktree `~/crew-agents/<key>/<role>`, exclude `.paperclip-runtime`, `git config crew-docs.bundle`, rồi `crew-mac status add-repo` | `{checkouts:[{role, path, head}]}` |
| `agent-workspace` | `{projectKey, role, folder}` | Một checkout cho một agent thêm sau (executor thứ 2) | `{path, head}` |
| `skill-sync` | `{skillId, slug, version}` | Lấy file skill qua REST, ghi `~/.crew/skills/<companyId>/<slug>/` (0700), băm cây | `{sha256, files}` |
| `check` | `{projectKey}` | `crew-mac doctor --no-probe` và `workflow-check` trên từng checkout của project | `{items:[{id, status, title}]}` |

- **Vòng đời:** `queued → claimed → done | failed`, cộng `cancelled` (board hủy). Việc ở trạng thái `claimed` có lease 10
  phút. Hết lease thì lần `claim` sau trả việc về `queued`, `attempts + 1`; quá 3 lần thì thành `failed`, mã
  `lease_expired`. Board bấm "Thử lại" thì việc `failed` về `queued`.
- **Lỗi** trả về là mã cố định cộng một câu tiếng Việt đã làm sạch: bỏ ký tự điều khiển, cắt 300 ký tự, không có
  credential (dùng chung `SECRET_RULES`). Không chép stderr thô của git.
- App không chạy lệnh nào ngoài 5 loại trên. Payload kiểm chặt: khóa project theo `KEY_RE`, đường tuyệt đối, không
  có `..`, không nằm dưới thư mục cấm TCC (`forbiddenRootReason`). Server không SSH vào Mac để chạy lệnh.
- UI hiện "Chờ app 2P Crew trên <máy>" khi việc còn `queued` mà bản tin gần nhất không có `jobsAgent` (app không chạy)
  hoặc bản tin đã cũ hơn 3 phút.

### 4.7. Wizard

Wizard chạy trong trình duyệt bằng phiên của owner. Các bước gọi REST stock và route plugin; phần làm trên Mac đi qua
hàng đợi máy. Mỗi bước ghi kết quả (id tạo ra, hash) vào `crew_setup_runs`, nên bấm "Chạy tiếp" thì làm tiếp từ bước
dở, kể cả khi mở từ trình duyệt khác. Lỗi ở bước nào thì pause các agent wizard đã tạo (`POST /agents/:id/pause`),
hiện lỗi và nút "Chạy tiếp".

- **Thêm project (S9).** Port từ `apps/mac-app/src/main/projects/add-project.ts`.

  | Bước | Việc | Gọi |
  |---|---|---|
  | 1 | Chọn máy, gõ đường folder repo trên Mac, khóa project, tên, số executor (1–2). Bấm "Kiểm folder" | job `inspect-folder` |
  | 2 | Tạo project | `POST /companies/:c/projects` |
  | 3 | Dựng checkout trên Mac | job `prepare-checkouts` |
  | 4 | Mỗi vai trò một environment SSH, dùng lại secret SSH và known hosts của environment mẫu, `in_place`, `crewLoadGate` | `POST /companies/:c/environments` |
  | 5 | Mỗi vai trò một agent `claude_local` (I9 trong plan) cộng `AGENTS.md` render từ template vai trò | `POST /companies/:c/agents`, `PUT /agents/:id/instructions-bundle/file` |
  | 6 | Ghi vai trò | `POST …/projects/:id/roles` |
  | 7 | Kiểm trên Mac | job `check` |

- **Tạo agent (S13).** Dùng cho executor thứ 2 hoặc thay agent một vai trò. Các bước: tạo agent (I9), ghim
  Superpowers và upload `AGENTS.md`, environment, job `agent-workspace`, ghi vai trò, rồi render lại `AGENTS.md` của Trợ
  Lý nếu danh sách executor đổi.
- **Template `AGENTS.md`:** web dùng thẳng `crew/agents/{assistant,executor,reviewer,integrator}.md` của fork (import
  `?raw` lúc build) và port `crew/agents/render-instructions.mjs` sang TypeScript. Đây là bản gốc. App Mac giữ bản chép
  có test sha256 như R2-2 AG-2. Test của web khẳng định nội dung render cho cùng đầu vào trùng với
  `render-instructions.mjs`.
- **Render lại `AGENTS.md`** (S8.3, S11.2, S13 bước 6): `GET` file lấy `hash`, rồi `PUT` kèm `baseHash`. Server trả xung
  đột thì báo "Có người vừa sửa, tải lại", không ghi đè.

### 4.8. Trạng thái sẵn sàng

Tính ở web bằng module thuần `features/readiness/compute.ts` (có unit test), từ: agent (`GET /agents/:id`),
environment (`GET /environments/:id`), vai trò (route plugin), bản tin máy (`crew.machines`, gồm `checkouts`) và
`crew_setup_runs`. Không tính ở plugin vì plugin không đọc được bảng `environments` (mục 2).

| Mã | Kiểm (agent) | Bước "Làm tiếp" |
|---|---|---|
| `A1` | `adapterType = claude_local`, `engine = cli`, `env = {}`, `maxConcurrentRuns = 1`, heartbeat tắt | S13 bước 1 (sửa bằng `PATCH`, merge) |
| `A2` | `command` = wrapper Crew, `extraArgs` = `--setting-sources project,local --plugin-dir <bản ghim của máy>` | S13 bước 2 |
| `A3` | `AGENTS.md` có, render từ đúng template vai trò (hash lưu ở setup run; agent do app tạo thì chỉ cần file có) | S13 bước 2 |
| `A4` | `defaultEnvironmentId` trỏ environment `active`, driver `ssh`, `in_place`, `remoteWorkspacePath` = checkout của agent | S13 bước 3 |
| `A5` | Checkout có trong `checkouts` của bản tin máy mới nhất | S13 bước 4 (job) |
| `A6` | Agent giữ một vai trò trong một project | S13 bước 5 |
| `A7` | Không `terminated`. `paused` hiện "Tạm dừng", không tính là chưa sẵn sàng | — |

Project sẵn sàng khi có dòng vai trò (hoặc dùng vai trò trong file, như `repo-a` của R1) và mọi agent trong vai trò
đều qua `A1`–`A7`. Hộp chọn project ở S5 và hộp chọn agent ở S8.3 chỉ có mục đã sẵn sàng.

### 4.9. Thao tác theo cổng trên issue

| Nút | Hiện khi | Gọi | Ghi chú |
|---|---|---|---|
| Duyệt (S6.7) | stage hiện tại là `approval` và người tham gia là user đang đăng nhập | `PATCH /issues/:id {status, comment}` theo đúng cách server hoàn tất stage approval | WK-3 đọc `server/src/services/issue-execution-policy*` và route `issues.ts` để chốt body trước khi cài. Test khẳng định không có activity `crew.policy.board_override` |
| Yêu cầu sửa (S6.8) | như trên; bắt buộc nhập lý do | `PATCH` trả về người làm vòng trước (theo code server) | Tăng vòng sửa `n/5` |
| Hủy yêu cầu (S6.10) | issue chưa `done/cancelled` | `PATCH {status:"cancelled"}` có xác nhận | H3 dừng run trên Mac |
| Mở lại (S6.11) | `done` hoặc `cancelled` | `PATCH {status:"todo"}` | H2 đặt lại vòng |
| Trả lời câu hỏi (S6.9) | có interaction đang chờ | `POST /issues/:id/interactions/:iid/{respond,accept,reject}` | |

Không có nút ép xong, đổi người làm, đổi reviewer/approver hay đổi trạng thái tự do (Q3, BA mục 2).

### 4.10. Build và deploy

- `overlay-source.sh`: thêm `packages/crew-web/` vào danh sách được phép, chạy `pnpm --filter @crew/paperclip-web build`,
  chép `dist/` vào `$WORK/app/server/ui-dist/`. `index.html` phải có `<meta name="crew-ui" content="<commit 40 hex>">`.
  Thiếu mốc hoặc commit lệch thì dừng.
- `overlay-job.sh`: thêm `RUN test -s /app/server/ui-dist/index.html && grep -q 'name="crew-ui"' …`.
  `inspect-image.sh` in commit trong mốc.
- Image stock không có `server/ui-dist`, nên rollback về image trước là về UI stock. Không đụng nginx dùng chung của
  VPS (Q1).
- Deploy theo đúng trình tự R2-2 DP-1 (mục Global Constraints của plan). Kiểm thêm: `GET /` có mốc `crew-ui` đúng
  commit; `/cli-auth/<id>` trả HTML của UI Crew; data `crew.companies` khớp `CREW_POLICY_CONFIG` (script
  `crew/ops/check-crew-companies.sh`, chỉ in id).
- App Mac: bản mới (nhận việc, bản tin thêm key) build từ nhánh `r3`, ký Apple Development như bản đang chạy, **cài tay
  lên Mac mini** khi 0 run active. Giữ bản cũ ở `~/crew-r3-app-prev/` để quay lui. Đường lui sshd:
  `crew-mac setup --sshd-owner launchd`. Updater chưa dùng được vì chưa có Developer ID.

### 4.11. Bảo mật và quyền

- **Đã biết, sửa trong R3:**
  1. `tro-ly` (và mọi agent Crew) có `canCreateAgents = true`. Tắt đi, cấp grant `tasks:assign` cho Trợ Lý để nó vẫn
     giao việc được (mục 2: `canCreateAgents` kéo theo `canAssignTasks`). Agent tạo mới qua wizard có
     `canCreateAgents: false`, `canCreateSkills: false`.
  2. `canCreateSkills` mặc định `true`: tắt cho mọi agent của company Crew.
  3. Agent tạo được project qua `POST /companies/:id/projects`. Đường này không có hook. Cách xử lý chọn sau khi truy
     route (mục 4.11 ý 4), theo thứ tự ưu tiên: (a) cấu hình/quyền; (b) mở rộng thân hook có sẵn H2/H4/H5 trong
     `server/src/crew/**` nếu đường gọi đi qua hook đó; (c) plugin phát hiện rồi trả lại (archive project do agent tạo,
     ghi log); (d) cần sửa lõi thì dừng, ghi ledger, chờ owner; (e) chấp nhận rủi ro kèm lý do.
- **Truy nốt route:** một ticket opus đọc code, lập bảng mọi route ghi mà token agent (run JWT hoặc agent API key) gọi
  được, mỗi route ghi dòng kiểm quyền, rủi ro với bất biến của Crew và cách xử lý (a)–(e). Bắt buộc có các route BA
  chưa truy tới dòng kiểm: xóa project, xóa workspace, `inbox-archive`, `/children`, xóa attachment, adapters, goals.
  Thêm các nhóm: agents (tạo, permissions, keys, instructions bundle của agent khác, terminate, pause/resume, wakeup
  agent khác), environments, secrets, company skills (tạo, sync cho agent khác, skill-sources), routines, labels,
  approvals, company settings, plugin routes, heartbeat-runs cancel.
- Mỗi lỗ hổng sửa trong R3 phải có ca âm chạy bằng token agent thật của company Crew E2E.

## 5. Thay đổi so với BA (có lý do)

1. **S9 bước 1:** owner gõ đường folder, app kiểm bằng job `inspect-folder`, không có danh sách repo do Mac báo lên.
   Lý do: quét đĩa tìm repo vướng TCC (`~/Documents`, `/Volumes`) và lộ cây thư mục lên server. App đã có
   `inspectFolder` đã nghiệm thu. Web gợi ý các folder đã dùng ở các job trước. Ca `PW-S9-1` đổi thành: folder không
   phải repo git hoặc nằm dưới thư mục cấm thì báo lỗi, không tạo project.
2. **Trạng thái sẵn sàng tính ở web** (mục 4.8), không có data plugin `crew.projectReadiness`/`crew.agentReadiness`. Lý
   do: plugin không đọc được `environments`.
3. **Danh sách company** lấy từ cấu hình plugin, có kiểm khớp lúc deploy (mục 4.4).
4. **Bản tin máy** gửi cho nhiều company (`targets[]`). Lý do: company Crew E2E cần thẻ máy và hàng đợi máy riêng, mà
   máy thì vẫn là một.
5. **Chế độ stub cho nghiệm thu** (mục 7): wrapper chạy stub thay cho `claude` khi checkout thuộc project E2E và có tệp
   đánh dấu. BA chưa có cách nghiệm thu mà không tốn quota.
6. **Tắt `canCreateAgents` phải đi kèm grant `tasks:assign`** (mục 2). BA chỉ hỏi có tắt hay không.
7. **Route vai trò giữ `POST`** như R2-1 (plugin không có `PUT`).

## 6. Dữ liệu và hợp đồng

Chi tiết schema SQL, payload, kiểu TypeScript nằm ở mục Interface của plan (I1–I10). Spec chốt các điểm sau:

- `crew_machine_jobs`, `crew_setup_runs` nằm trong namespace DB plugin, chỉ thêm migration mới, không sửa 0001–0005.
- Bản tin máy vẫn `version: 1`. Key mới đều tùy chọn. Plugin cũ gặp key lạ thì 502 (bài học PG-2 R2-1), nên **deploy
  plugin trước, cài app/`crew-mac` sau**.
- Agent do wizard tạo có cấu hình giống hệt agent do app tạo (cùng hằng số `command`, `extraArgs`, model theo vai trò,
  `engine: "cli"`, `env: {}`, `maxConcurrentRuns: 1`, heartbeat tắt), cộng quyền ở mục 4.11.

## 7. Nghiệm thu (đo được)

Bốn tầng. Mỗi tầng chỉ chạy một lần ở đúng chỗ (chính sách test theo tầng của plan stock-first).

| Tầng | Chạy ở đâu | Gồm | Tốn quota Claude |
|---|---|---|---|
| T0 | Máy dev | Unit, component, luật design system, i18n, nút chết, readiness, render template | 0 |
| T1 | Mac mini: server fork dev cộng Postgres nhúng, plugin, web dev | Ca Playwright không cần Mac thật (đăng nhập, điều hướng, form, lỗi). Dựng tối đa 90 phút; không dựng được thì bỏ T1, ghi ledger | 0 |
| T2 | Prod, company **Crew E2E**, máy Mac mini, chế độ stub | Mọi ca `PW-S*`, `F2`, `F5`, `F7`, `F8` | 0 (stub không gọi `claude`) |
| T3 | Prod, Crew E2E, chạy thật | Đúng **2 yêu cầu**: R-A = `F6` + `F1` (project tạo bằng wizard, yêu cầu code nhỏ, push vào origin bare cục bộ, kiểm skill được nạp); R-B = `F3` + `F4` (nghiên cứu, mô tả thiếu thông tin để Trợ Lý hỏi lại) | ≤ 20 run; vượt thì dừng, báo |

**Chế độ stub.** Wrapper chỉ chạy stub khi cả hai điều kiện sau đúng:

1. `$PWD` bắt đầu bằng `$HOME/crew-agents/e2e-`.
2. Có tệp `$(git rev-parse --git-dir)/crew-e2e-stub`. Tệp này nằm trong thư mục git, không bị track.

Stub (`apps/crew-mac/assets/crew-e2e-stub.sh`) ngủ số giây ghi trong tệp đánh dấu (mặc định 5, tối đa 900), in một kết
quả `stream-json` tối thiểu mà adapter chấp nhận, rồi thoát 0. Stub chạy qua đúng chuỗi stock (SSH, sync skill vào
`.paperclip-runtime`, H1, H3), chỉ không gọi model. Project thật không bao giờ có tiền tố `e2e-` (wizard từ chối khóa
`e2e-*` ở company khác Crew E2E).

**Tiêu chí:**

- **AC1 Phủ nút.** `e2e/coverage.json` ánh xạ mọi mã `S0.1`…`S19`, `F1`…`F8` của BA (đã đổi theo mục 5) sang file spec
  và tên test. Test `coverage.test.ts` đỏ khi thiếu mã nào. F9 ghi `"skip": "<lý do>"`.
- **AC2 T2 xanh.** Toàn bộ ca T2 qua trên prod; mỗi ca thử lại tối đa 1 lần. Mỗi ca ghi kiểm tác dụng bằng `GET` API
  hoặc `psql` (body qua stdin), không chỉ kiểm giao diện.
- **AC3 Design system.** Các test luật ở mục 4.2 xanh. `grep -rn "style={" src/features src/app` ra 0 dòng.
- **AC4 Hai ngôn ngữ.** Bộ key VI và EN khớp 100%. Quét AST ra 0 chuỗi gắn cứng. `PW-S0-3` xanh.
- **AC5 Không nút chết.** Ca Playwright `no-dead-controls.spec.ts` đi qua mọi route. Mỗi `button`, `a`, `[role=menuitem]`
  phải có handler hoặc `href`. Không control nào `disabled` quá 10 giây mà không có lý do hiển thị (tooltip hoặc chữ).
- **AC6 Lõi không đổi.** `node crew/release/check-core-hooks.mjs` báo đủ H1–H5, `base` là `v2026.1005.0`.
  `git diff crew/r2-2..crew/r3 --stat` chỉ có đường dẫn ở Global Constraints của plan.
- **AC7 Quyền.** Báo cáo truy route đủ mọi nhóm ở mục 4.11. Các ca âm bằng token agent của Crew E2E đều qua: tạo agent
  bị từ chối, sửa vai trò 403, hủy issue 422 `agent_cancel_forbidden`, sửa cấu hình agent 422
  `crew_agent_config_forbidden`. Project do agent tạo được xử lý đúng như báo cáo chọn. Trợ Lý vẫn giao việc được
  (`taskAssignSource = explicit_grant`).
- **AC8 Deploy.** `/api/health` ok, đúng commit; plugin `crew.core` ready; `https://2p-solutions.com` và
  `https://kidyschool.com` 200; `GET /` có mốc `crew-ui` đúng commit; app 2P Crew đăng nhập lại qua `/cli-auth` của UI
  mới được (`PW-S1-2` cộng một lần bấm thật từ app).
- **AC9 Chạy thật.** R-A tới `done`, có commit trên origin bare, transcript run executor có skill thử đã bật; R-B tới
  `done` sau một thẻ câu hỏi. Tổng run ≤ 20. `git status` các checkout sạch (không lẫn `.paperclip-runtime`).
- **AC10 Tải trang.** JS khởi đầu (gzip) ≤ 700 KB. Map, markdown và wizard tải lười theo route. Tổng quan trên prod có
  dữ liệu trong ≤ 3 giây (Playwright đo `performance.now()` tới khi thẻ số hiện).

## 8. Rủi ro

| Rủi ro | Giảm |
|---|---|
| Owner sáng 10/10 vào UI mới đang dở | UI Crew chỉ lên prod khi T1 (hoặc RV-1 nếu bỏ T1) cộng ca đăng nhập, cli-auth, tạo yêu cầu, duyệt, hủy đã xanh. Có mốc rollback từng lần; lỗi chặn thì rollback ngay |
| Wizard web và app Mac cùng thêm project, lệch nhau | Cùng hằng số và template (I9); readiness kiểm cả agent do app tạo; test so render với `render-instructions.mjs` |
| App không chạy thì việc trên máy treo | UI hiện "Chờ app"; lease 10 phút; thử lại |
| Cài app tay hỏng sshd 2222 | Chỉ cài khi 0 run active; giữ bản cũ; đường lui `--sshd-owner launchd` |
| Plugin cũ 502 khi bản tin có key mới | Deploy plugin trước app (mục 6) |
| Duyệt gọi sai body thành `board_override` | WK-3 đọc code server trước; ca `PW-S6-7` kiểm không có activity override |
| Stub lọt sang project thật | Hai điều kiện (tiền tố `e2e-` và tệp trong `.git`); test wrapper; wizard chặn khóa `e2e-*` ngoài Crew E2E |
| Quota Claude | T3 đúng 2 yêu cầu, trần 20 run; dừng dispatch khi quota tuần còn 1% |
| Issue thử trong TPS kéo workflow (bài học SP-0) | Mọi thử nghiệm ở company Crew E2E |

## 9. File dự kiến chạm

- Fork: `packages/crew-web/**` (mới), `packages/crew-plugin/**`, `server/src/crew/**` cùng
  `server/src/__tests__/crew-*` (chỉ khi SEC chọn cách (b)), `crew/ops/**`, `crew/release/core-hooks.json` (chỉ
  `description`), `pnpm-lock.yaml`.
- Repo Crew: `apps/mac-app/**` (nhận việc, executor), `apps/crew-mac/**` (bản tin nhiều đích, `checkouts`, tên skill
  Superpowers, stub), `docs/flows/**`, `docs/flows.yaml`.

## 10. Giai đoạn

0. Truy quyền (chỉ đọc) ∥ khung `crew-web` + token + component ∥ bảng hàng đợi máy ∥ bản tin nhiều đích, stub ∥ dựng
   company Crew E2E.
1. Widget, i18n, shell, auth ∥ route `setup-runs`, data mới, export `shared/*` ∥ app nhận việc ∥ sửa quyền.
2. Màn hình công việc (dashboard, inbox, issue, run, search) ∥ màn hình tổ chức (project, agent, skill, máy, docs,
   cài đặt).
3. Readiness, hai wizard, hướng dẫn VI/EN.
4. Overlay ship `ui-dist`, review toàn nhánh, T1.
5. Deploy fork, cài app, T2 → push.
6. T3 → push, tag `crew/v3.3`.

## 11. Không làm

- Không gỡ slot UI của plugin. Không gỡ màn hình thêm/gỡ project của app Mac.
- Không có Skill Studio, routines, connectors, costs, members/invites, tạo company trên web (BA mục 2).
- Không gỡ agent hay project trên web (Q7): gỡ bằng "Gỡ khỏi Mac" của app.
- Không đổi nhận diện màu thương hiệu (Q8): chỉ đổi tên và logo.
- Không nâng Paperclip, không thêm hook, không sửa `ui/**` stock.
- Không dịch docs dự án sang EN (chỉ UI và Hướng dẫn).

## 12. Giả định chờ owner (Trợ Lý tạm chốt theo BA; owner phủ quyết sáng 10/10)

| # | Câu hỏi BA | Đang tạm theo | Nếu owner bác thì đổi ở đâu |
|---|---|---|---|
| Q1 | UI Crew thay UI Paperclip ở đâu | Thay hẳn ở `crew.2p-solutions.com` qua `server/ui-dist`; cần UI stock thì rollback image | Spec 4.10; plan gói `ops` (OP-1, DP-1): thêm ticket nginx subdomain cho UI stock (opus, có backup cấu hình nginx dùng chung) |
| Q2 | Ai nhận việc trên máy | App 2P Crew | Spec 4.6; plan gói `mac` (MC-2 chuyển sang `apps/crew-mac` thành lệnh `crew-mac jobs` chạy theo LaunchAgent, cần thêm board key cho CLI qua Keychain); I1 không đổi |
| Q3 | Board vượt cổng trên UI | Không có nút | Spec 4.9; plan WK-3 thêm nút "Ép xong" có xác nhận hai bước, ghi activity; thêm ca PW |
| Q4 | Hướng dẫn có bản EN | Có, viết cuối R3 từ bản VI | Plan OR-4 bỏ phần EN; AC4 miễn trang Hướng dẫn |
| Q5 | Company hiển thị và company test | Chỉ company trong cấu hình Crew; ẩn `Crew Spike Policy`; thêm company "Crew E2E"; không nút tạo company | Spec 4.4; plan DS-3 (bộ lọc company), OP-2 (dựng Crew E2E), I6 |
| Q6 | Skill trùng tên Superpowers, phạm vi trang Skills | Chặn trùng tên; chỉ liệt kê, thêm từ nguồn GitHub, bật cho agent, trạng thái sync | Plan OR-3, PL-2 (`superpowers.skills`); nếu owner muốn Skill Studio thì thêm gói mới ở R sau |
| Q7 | Gỡ agent/project trên web | Không có ở R3, gỡ bằng app | Plan gói `wizards`: thêm WZ-4 "Gỡ" (pause, archive environment, xóa vai trò, job `remove-checkouts` mới trong I1) |
| Q8 | Nhận diện hình ảnh | Token và component Paperclip làm bản đầu, đổi tên và logo 2P | Plan DS-1 (`tokens.css`); chỉ đổi token, không đổi màn hình |

Các quyết định Trợ Lý tự chốt khi viết spec (mục 5, ý 1–6) cũng do owner phủ quyết. Ý 1 bị bác thì thêm job
`list-repos` vào I1 và cho app quét các gốc do owner chỉ định.
