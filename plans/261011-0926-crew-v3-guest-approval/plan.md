---
title: "Crew v3 — Phòng Marketing (contributor): yêu cầu và bình luận chờ owner duyệt"
description: "Thành viên khách góp ý (viewer ở lõi, có dấu Crew) xem mọi thứ, gửi yêu cầu và bình luận vào bảng chờ crew_contributions. Agent không thấy gì cho tới khi owner bấm Duyệt. Lúc duyệt, trình duyệt owner đăng qua route stock của board, nên wake giống hệt board đăng. Thêm vá lõi C7 (router Crew) và C8 (viewer đọc data crew.core), không có migration lõi."
status: pending
priority: P2
effort: 26h
branch: v3
tags: [crew-v3, contributor, approval, crew-web, crew-plugin, core-patch, c7, c8]
created: 2026-10-11
---

# Crew v3 — Phòng Marketing chờ duyệt — Kế hoạch

Ngày: 11/10/2026 09:43 (Asia/Ho_Chi_Minh).
Spec: [2026-10-11-crew-v3-guest-approval-design.md](../../docs/superpowers/specs/2026-10-11-crew-v3-guest-approval-design.md).
Mọi chi tiết thiết kế (bảng, API, quyền, UI, AC) nằm ở spec. Plan này chỉ ghi thứ tự, file, cách kiểm.

> **Cho agent thi công:** dùng superpowers:subagent-driven-development hoặc superpowers:executing-plans, làm từng
> ticket một. Mỗi lúc **tối đa 2 agent**. Hai ticket chạy song song không bao giờ sửa chung file (bảng §3).

**Kết quả:**
- Owner mời được khách góp ý.
- Khách xem mọi project/issue, gửi yêu cầu và bình luận.
- Agent không thấy nội dung đang chờ.
- Owner bấm Duyệt thì nội dung vào lõi qua route stock (như board đăng). Bấm Từ chối thì mục giữ nhãn "Bị từ chối".

**Kiến trúc tóm tắt (spec §2):**
- Nội dung chờ nằm ở bảng plugin `crew_contributions` (migration `0013`). Chỉ router Crew của server đọc/ghi bảng này.
- Khách là `viewer` ở lõi, nên mọi route ghi lõi chặn bằng code stock.
- **C7** gắn `crewContributionRoutes(db)` vào `server/src/app.ts`.
- **C8** cho viewer gọi `POST /api/plugins/crew.core/data/:key`.
- Duyệt gồm 3 bước: `approve` (khóa) → route stock (khóa idempotent) → `approve/complete` (server tự tìm bản ghi).

## 0. Nền, nhánh, worktree

| Repo | Nền | Nhánh mới | Worktree |
|---|---|---|---|
| Fork Paperclip | `38580c5d7` (tag `crew/v3.3`, = prod) | `crew/guest-approval` | `~/Documents/projects/crew/.worktrees/paperclip-guest` (tạo từ kho chung `.worktrees/paperclip-v3`) |
| Repo Crew | `v3` | không cần nhánh code (chỉ plan/spec, controller commit) | — |

- Không sửa `.worktrees/paperclip-r3-dp`, đó là bản prod để đọc.
- Đọc mã: `docs` không có ở fork. Bắt đầu từ spec §2–§8.
- Lệnh kiểm chung trong fork:
  - `corepack pnpm --filter @paperclipai/server exec vitest run <file>`
  - `corepack pnpm --filter @crew/paperclip-plugin exec vitest run --config vitest.config.ts <file>`, chạy **từng
    file DB**, kiểm `ipcs -m` trước và sau
  - `corepack pnpm --filter @crew/paperclip-web test`, `… typecheck`, `… lint`
  - `node crew/release/check-core-hooks.mjs`
- Commit theo Conventional Commits, không nhắc mã ticket/plan trong code, test hay message (luật repo).

## 1. Ticket

| Ticket | Việc | Phụ thuộc | Model gợi ý | Ước lượng |
|---|---|---|---|---|
| **T0** | Kiểm giả định trên prod (chỉ đọc) | — | controller | 0,5h |
| **PL-1** | Migration plugin `0013_contributions.sql` + test | — | sonnet | 1h |
| **SV-2** | C8: viewer đọc data `crew.core` + ma trận viewer bị chặn ghi | — | opus | 2h |
| **SV-1** | Router Crew góp ý (C7) + test DB + test agent không thấy | PL-1 | opus | 4h |
| **WB-1** | crew-web nền: client API, `useCompanyAccess`, chế độ chỉ đọc, khung route/nav mới | SV-1 (chỉ hợp đồng API, xem chú thích) | sonnet | 3h |
| **WB-2** | crew-web phía khách: dialog gửi yêu cầu, composer góp ý, trang Góp ý, badge | WB-1 | sonnet | 3h |
| **WB-4** | crew-web trang Thành viên: mời, duyệt tham gia, bật/gỡ dấu | WB-1 | sonnet | 3h |
| **WB-3** | crew-web phía owner: duyệt/từ chối, nhóm Chờ duyệt ở danh sách issue, popup, thẻ dashboard, Hướng dẫn | WB-2 | opus | 4h |
| **E2E-1** | Playwright `s20-contributions.spec.ts`, phiên khách, mã BA S20 | WB-3, WB-4 | sonnet | 3h |
| **RV-1** | Review toàn bộ diff | E2E-1, SV-1, SV-2 | opus (code-reviewer) | 1h |
| **DP-1** | Build, deploy, tạo tài khoản khách e2e, chạy T2, nghiệm thu AC1–AC12 | RV-1 | controller + owner | 2h |

Chú thích:
- WB-1 chạy song song với SV-1 vì code theo **hợp đồng API ở spec §5**. Test của WB-1 mock HTTP, không cần server.
- Đọc và kiểm hợp đồng chung nằm ở `src/api/crew/contributions.ts`. Nếu SV-1 phải đổi hợp đồng thì sửa spec §5 trước,
  sau đó báo WB.

## 2. Đợt chạy (tối đa 2 agent cùng lúc)

| Đợt | Agent A | Agent B | Ghi chú |
|---|---|---|---|
| 0 | T0 (controller) | — | Kết quả T0 có thể sinh câu hỏi Q2 cho owner. Không chặn code |
| 1 | PL-1 | SV-2 | Khác file hoàn toàn. `core-hooks.json` chỉ SV-2 sửa ở đợt này |
| 2 | SV-1 | WB-1 | SV-1 sửa `core-hooks.json` sau khi SV-2 đã merge vào nhánh |
| 3 | WB-2 | WB-4 | Khác thư mục feature. File dùng chung (router, nav, locale gốc) đã do WB-1 dựng xong |
| 4 | WB-3 | — | |
| 5 | E2E-1 | — | |
| 6 | RV-1 → DP-1 | — | |

Mỗi đợt: agent làm trên worktree riêng rẽ từ `crew/guest-approval`. Controller merge (fast-forward/rebase) trước khi mở
đợt sau.

## 3. Sở hữu file

| Ticket | Được sửa / tạo |
|---|---|
| PL-1 | `packages/crew-plugin/migrations/0013_contributions.sql`; `packages/crew-plugin/src/__tests__/migration-0013.db.test.ts`; `packages/crew-plugin/src/__tests__/contributions-isolation.test.ts` |
| SV-2 | `server/src/crew/plugin-data-scope.ts`; `server/src/routes/plugins.ts` (đúng 1 dòng + 1 import cuối file); `server/src/__tests__/crew-plugin-data-viewer.test.ts`; `server/src/__tests__/crew-viewer-write-matrix.test.ts`; `crew/release/core-hooks.json` (mục C8) |
| SV-1 | `server/src/crew/contributions.ts`; `server/src/crew/contribution-routes.ts`; `server/src/app.ts` (đúng 1 dòng + 1 import cuối file); `server/src/__tests__/crew-contributions.db.test.ts`; `server/src/__tests__/crew-contributions-agent-blind.test.ts`; `crew/release/core-hooks.json` (mục C7) |
| WB-1 | `packages/crew-web/src/api/crew/contributions.ts`, `src/api/crew/types.ts`, `src/api/endpoints.ts`, `src/api/queryKeys.ts`, `src/api/index.ts`, `src/api/paperclip/comments.ts` (thêm `clientRequestId`), `src/api/paperclip/issues.ts` (nếu cần cho `idempotencyKey`), `src/api/paperclip/members.ts` (mới: members, invites, join-requests, user-directory); `src/features/access/*` (mới: `use-company-access.ts`); `src/app/routes-util.ts`, `src/app/router.tsx`, `src/app/shell/sidebar.tsx`, `src/app/shell/command-palette.tsx`; `src/i18n/locales/{vi,en}.json` (nhãn nav); khung `src/features/contributions/{index.ts,routes.tsx,contributions-page.tsx,locales/*}` và `src/features/members/{index.ts,routes.tsx,members-page.tsx,locales/*}` (trang có tiêu đề và trạng thái trống thật, chưa có dữ liệu); các điểm ẩn nút ghi: `src/features/issues/detail/{issue-detail.tsx,title-editor.tsx,properties-panel.tsx,attachments.tsx,issue-runs.tsx}`, `src/features/issues/detail/crew/*-slot.tsx`, `src/features/issues/popup/issue-popup.tsx` (bỏ markRead), `src/features/projects/detail/{project-page.tsx,roles-tab.tsx}`, `src/features/projects/list/projects-page.tsx`, `src/features/runs/run-page.tsx`; test `packages/crew-web/test/features/access/*`, `test/api/contributions.test.ts`, `test/api/endpoints.test.ts` |
| WB-2 | `src/features/contributions/**` (trừ phần owner do WB-3 thêm), gồm `new-contribution-dialog.tsx`, `contribution-composer.tsx`, `contribution-badge.tsx`, `pending-comments.tsx`, `use-contributions.ts`; `src/features/issues/detail/composer.tsx` (chọn composer theo access); `src/features/issues/detail/comments.tsx` (chèn `PendingComments`); `src/features/issues/new/new-request-dialog.tsx` (chỉ chỗ mở dialog góp ý khi khách); test `test/features/contributions/*` |
| WB-4 | `src/features/members/**`; test `test/features/members/*` |
| WB-3 | `src/features/contributions/{approve-flow.ts,approve-issue-dialog.tsx,reject-confirm.tsx,contribution-actions.tsx,contribution-popup.tsx,contribution-popup-host.tsx}`; `src/features/issues/list/issues-page.tsx`; `src/features/dashboard/dashboard-page.tsx` (+ locale dashboard); `src/app/shell/shell.tsx` (gắn popup host); `src/features/issues/new/use-create-request.ts` (xuất `buildCreateBody` nhận `idempotencyKey`); `src/features/guide/content/{huong-dan.vi.md,guide.en.md}`, `src/features/guide/shots.ts` nếu có ảnh; test `test/features/contributions/approve-*.test.ts`, `test/features/issues/*` liên quan |
| E2E-1 | `packages/crew-web/e2e/specs/s20-contributions.spec.ts`; `e2e/support/{login.ts,env.ts,global-setup.ts,fixtures.ts,run-e2e.sh}` (thêm phiên khách); `e2e/ba-ids.json`; `e2e/coverage.json`; `e2e/README.md` (mục tài khoản khách) |

`sidebar.tsx` (WB-1) lấy badge qua hook `useContributionsSummary` của `src/features/contributions/use-contributions.ts`.
WB-1 tạo file này kèm hàm đọc `summary` thật. WB-2 thêm hàm khác vào cùng file, vì WB-1 và WB-2 chạy nối tiếp.

## 4. Chi tiết ticket

### T0 — Kiểm giả định trên prod (controller, chỉ đọc)

- [ ] `ssh nhamoiplatform`:
  - đọc **giá trị** `PAPERCLIP_AUTH_DISABLE_SIGN_UP` trong `/opt/crew-v3-spike/.env`, chỉ in `true`/`false`/`unset`,
    không in dòng khác;
  - đọc thêm `auth.disableSignUp` trong config file nếu có.
- [ ] `curl -s -o /dev/null -w '%{http_code}' https://crew.2p-solutions.com/paperclip/invite/x` → 200 (SPA stock).
  `…/invite/x` trả SPA Crew (not-found).
- [ ] `psql` chỉ đọc (`e2e/support/db.ts`):
  - tài khoản `PAPERCLIP_BOARD_EMAIL` có `membership_role='owner'` ở company Crew E2E và company TPS;
  - `SELECT to_regclass('plugin_crew_core_0433ea20b6.crew_project_roles')` khác null (namespace đúng);
  - `SHOW server_version` ≥ 13 (`gen_random_uuid`).
- Kết quả ghi vào `plans/261011-0926-crew-v3-guest-approval/reports/t0.md`. Prod tắt đăng ký thì hỏi owner câu Q2
  (spec §13).

### PL-1 — Migration `0013_contributions.sql`

- [ ] Viết SQL đúng spec §4: hai bảng, hai CHECK có tên, ba index, namespace `plugin_crew_core_0433ea20b6`. Tên index
  không thêm tiền tố namespace (như 0012).
- [ ] `migration-0013.db.test.ts` theo khuôn `migration-0012.db.test.ts`:
  - áp 0001–0012, chèn dữ liệu vào `crew_project_roles`, áp 0013;
  - dữ liệu cũ còn;
  - `pg_constraint` có `crew_contributions_shape_ck`, `crew_contributions_result_ck`;
  - INSERT sai shape → lỗi;
  - `UPDATE … SET status='approved'` khi thiếu `result_*` → lỗi;
  - PK `crew_contributors` trùng → lỗi;
  - `id` tự sinh.
- [ ] `contributions-isolation.test.ts`: quét `packages/crew-plugin/src/**/*.ts` (trừ `__tests__`), không file nào chứa
  `crew_contributions` hay `crew_contributors`. Plugin không đọc bảng này.
- Kiểm:
  - hai file test xanh, chạy riêng từng file;
  - `ipcs -m` sạch;
  - `corepack pnpm --filter @crew/paperclip-plugin typecheck`.
- Rollback: xóa file migration trước khi deploy. Đã áp trên prod thì để nguyên (chỉ thêm bảng).

### SV-2 — C8 và ma trận viewer

- [ ] `server/src/crew/plugin-data-scope.ts`:
  ```ts
  export async function crewViewerPluginDataScope(db: Db, req: Request, pluginKey: string, companyId: unknown): Promise<string | undefined>
  ```
  `db` là tham số của `pluginRoutes(db, …)`, đã có trong scope.
  Trả `companyId` khi đủ mọi điều kiện:
  - `pluginKey === "crew.core"`;
  - `req.actor.type === "board"`, có `userId`;
  - `companyId` là chuỗi khác rỗng;
  - `hasCompanyAccess(req, companyId)`;
  - `loadCrewCompanyConfig(companyId).kind !== "absent"`;
  - membership `active`, role `viewer`, đọc **từ DB**.

  Trường hợp khác trả `undefined`.
- [ ] Thay đúng dòng `server/src/routes/plugins.ts:1624` bằng anchor C8 (spec §8). Thêm import ở cuối file.
- [ ] Thêm mục **C8** vào `crew/release/core-hooks.json`: `kind: "core-patch"`, `symbol`, `anchor`, `importLine`,
  `description` tiếng Anh, `upstreamPr: null`, `tests`.
- [ ] `crew-plugin-data-viewer.test.ts`: các ca ở spec §9.1, dựng app Express với `pluginRoutes` và worker manager giả
  (xem các test plugin route có sẵn trong `server/src/__tests__` hoặc `server/src/routes/*.test.ts`).
- [ ] `crew-viewer-write-matrix.test.ts`: 11 route ở spec §9.1 với actor board viewer (`memberships` role `viewer`)
  → 403. Thêm một ca operator → khác 403 ở `POST /issues/:id/comments` để chứng minh test không chặn nhầm.
- Kiểm:
  - hai test xanh;
  - `node crew/release/check-core-hooks.mjs` → lỗi 0, vá lõi 7;
  - `pnpm --filter @paperclipai/server typecheck`.
- Rollback: revert commit.

### SV-1 — Router Crew góp ý (C7)

- [ ] `server/src/crew/contributions.ts`:
  - đọc membership (owner, viewer có dấu);
  - CRUD bảng plugin bằng `db.execute(sql…)`, kiểm `to_regclass` như `project-roles.ts`;
  - đổi trạng thái bằng `UPDATE … WHERE status = …`;
  - `findMaterialized(contribution)` (spec §5.3);
  - `selfHeal(companyId)`;
  - kiểm đầu vào bằng zod, dùng lại `multilineTextSchema` của `@paperclipai/shared`.
- [ ] `server/src/crew/contribution-routes.ts`: 11 endpoint ở spec §5, luật chung spec §5. Không ghi activity, không
  `publishActivity`.
- [ ] `server/src/app.ts`: thêm dòng anchor C7 sau `api.use(approvalRoutes(…))` (dòng 774), import ở cuối file.
- [ ] Mục **C7** trong `core-hooks.json`:
  - `symbol: "createApp api router (Crew contribution routes)"`;
  - mô tả nói rõ server ghi bảng plugin `crew_contributions`/`crew_contributors`, là bảng plugin thứ hai server ghi
    sau `crew_runtime_waits`. Sửa câu "the only plugin table the server writes" trong mô tả H1 cho đúng.
- [ ] `crew-contributions.db.test.ts`: mọi ca ở spec §9.1. Tạo bảng bằng SQL của `0013` như
  `crew-runtime-switch.db.test.ts:53`, `:160`.
- [ ] `crew-contributions-agent-blind.test.ts`: ca ở spec §9.1, dùng `issueRoutes`, `activityRoutes` thật và
  `heartbeat` thật hoặc ghi lại lời gọi `heartbeat.wakeup`, theo mẫu test route issue có sẵn. Chuỗi đánh dấu duy
  nhất, `JSON.stringify(body).includes(marker) === false`.
- Kiểm:
  - hai test xanh;
  - `vitest run src/__tests__/crew-` (cả bộ Crew) xanh;
  - `check-core-hooks` lỗi 0, vá lõi 8, hook 5/5;
  - typecheck server.
- Rollback: revert commit. Router mất, dữ liệu ở bảng plugin nằm yên.

### WB-1 — Nền crew-web

- [ ] `src/api/crew/contributions.ts` và `types.ts`: kiểu `Contribution`, `CompanyAccess`, hàm cho 11 endpoint. Thêm
  vào `endpoints.ts` (mã BA S20.x) và `__endpoints`.
- [ ] `src/api/paperclip/members.ts`: `members.list`, `invites.create/list/revoke`, `joinRequests.list/approve/reject`,
  `userDirectory.list`, đúng route stock ở spec §3.4.
- [ ] `src/api/paperclip/comments.ts`: `add(issueId, body, attachmentIds?, clientRequestId?)`.
  `issues.create` nhận được `idempotencyKey` trong body (đã là body tự do thì không đổi).
- [ ] `src/features/access/use-company-access.ts`: query `access`, trả `{ isOwner, isContributor, readOnly, loading }`.
  Đang tải thì coi là `readOnly`, để không chớp nút ghi.
- [ ] Ẩn nút ghi khi `readOnly` ở các file của WB-1 (bảng §3). Bỏ `issues.markRead` khi `readOnly`. Route bị cấm
  chuyển về dashboard.
- [ ] Nav:
  - `routes-util.ts` thêm `contributions` (nhóm `work`), `members` (nhóm `system`);
  - `sidebar.tsx` lọc theo access: khách bỏ inbox/agents/skills/machines; `members` chỉ owner; `contributions` cho
    owner và khách;
  - badge `contributions` = `summary.pending`.
- [ ] Khung trang `contributions-page.tsx` và `members-page.tsx`: tiêu đề, `EmptyState` thật, gắn route.
- [ ] Test:
  - `use-company-access` (owner, khách, viewer, operator);
  - sidebar lọc mục;
  - `endpoints.test.ts`;
  - client contributions (đúng method/path/body);
  - guard design-system, i18n.
- Kiểm: `pnpm --filter @crew/paperclip-web test && typecheck && lint`.

### WB-2 — Phía khách

- [ ] `new-contribution-dialog.tsx`: chọn project, tiêu đề (1–240), mô tả. Gửi `POST contributions`, báo thành công,
  invalidate `summary` và list. Ở `new-request-dialog.tsx`/nav: nếu `isContributor` thì mở dialog này.
- [ ] `contribution-composer.tsx`: thay composer khi `isContributor`. Gửi xong mục hiện ngay ở `PendingComments`.
- [ ] `pending-comments.tsx`:
  - lấy `contributions?issueId=`, trộn với bình luận thật theo `createdAt` trong `comments.tsx`;
  - badge `Chờ duyệt`/`Bị từ chối`;
  - chip "Góp ý của <tên>" trên bình luận thật có `resultCommentId`;
  - có chỗ trống `actions` để WB-3 gắn nút.
- [ ] `contributions-page.tsx`: ba tab, dữ liệu thật. Khách thấy "Góp ý của tôi".
- [ ] `contribution-badge.tsx` dùng `Badge` của ds.
- [ ] Test: dialog gửi đúng body; composer; trộn bình luận; trang tab; khách không thấy nút Duyệt.
- Kiểm như WB-1.

### WB-4 — Trang Thành viên (owner)

- [ ] Danh sách thành viên:
  - role hiển thị: owner/admin/operator/viewer; `viewer` có dấu thì hiện "Phòng Marketing";
  - nút **Bật góp ý** (viewer thuần), **Gỡ góp ý** (khách).
- [ ] **Mời khách góp ý:** tạo invite (body ở spec §3.4), hiện link `${location.origin}/paperclip/invite/${token}`, nút
  chép. Danh sách invite còn hiệu lực, nút thu hồi.
- [ ] Yêu cầu tham gia `pending_approval`:
  - nhãn "Lời mời khách góp ý" khi invite của yêu cầu có `defaultsPayload.crew.role === 'contributor'` (nối bằng
    `inviteId` với danh sách invite);
  - Duyệt → `approve`, rồi `PUT contributors/:userId` nếu là lời mời khách;
  - lỗi bước hai thì báo và để nút Bật góp ý.
- [ ] Test: dựng body invite; nối yêu cầu tham gia với invite; duyệt + bật dấu; lỗi bước hai.
- Kiểm như WB-1.

### WB-3 — Phía owner

- [ ] `approve-flow.ts`, hàm thuần dễ test:
  ```ts
  approveContribution(c, choices, deps): Promise<Contribution>
  ```
  - Thứ tự: `approve` → nếu là issue: `issues.create(buildCreateBody({...choices, title, description, projectId}) + idempotencyKey)`;
    nếu là bình luận: `comments.add(issueId, body, undefined, clientRequestId)` → `complete`.
  - Bước 2 lỗi thì ném lỗi, không gọi `complete`.
  - `complete` trả 409 thì báo "Chưa thấy bản ghi, bấm Duyệt lại".
- [ ] `approve-issue-dialog.tsx`: loại, người nhận (mặc định Trợ Lý qua `rolesApi.get`, như `new-request-dialog.tsx`),
  ô "Lưu nháp". Dùng lại `RequestKind`, `findResearchLabelId`.
- [ ] `reject-confirm.tsx` (`ConfirmDialog`). `contribution-actions.tsx` (Duyệt/Từ chối/Duyệt lại theo trạng thái)
  gắn vào `PendingComments` và trang Góp ý.
- [ ] `issues-page.tsx`: nhóm "Chờ duyệt" đầu trang và chip lọc "Chờ duyệt (n)" (owner và khách). Khách chỉ thấy mục
  của mình, không có nút.
- [ ] `contribution-popup.tsx` + host `?contribution=<id>` gắn ở `shell.tsx` cạnh `IssuePopupHost`.
- [ ] Dashboard: thẻ "Góp ý chờ duyệt" (chỉ owner).
- [ ] Hướng dẫn: thêm mục "Phòng Marketing" vào `huong-dan.vi.md` và `guide.en.md`: mời, gửi, duyệt, từ chối, agent không
  thấy gì khi chờ.
- [ ] Test:
  - `approve-flow` (thứ tự, khóa, lỗi bước 2, 409 complete);
  - dialog duyệt (mặc định Trợ Lý, nháp → `backlog`);
  - nhóm Chờ duyệt ở danh sách;
  - popup;
  - thẻ dashboard chỉ owner.
- Kiểm như WB-1. Thêm chạy tay ở stack T1 (`e2e/README.md` mục Stack T1): một vòng gửi → duyệt → bình luận thật.

### E2E-1 — Playwright

- [ ] `e2e/support`:
  - biến `CREW_E2E_CONTRIBUTOR_EMAIL`, `CREW_E2E_CONTRIBUTOR_PASSWORD`; `run-e2e.sh` đọc từ `/opt/crew-v3-spike/.env`
    qua ssh như mật khẩu board, không echo;
  - `global-setup.ts` lưu thêm `storageState` của khách;
  - fixture `contributorPage`.
  - T1 dùng tài khoản tạm trong `~/crew-r3-t1/board.env`.
- [ ] `s20-contributions.spec.ts`: PW-S20-1..7 theo spec §9.3. File đăng nhập bằng mật khẩu đặt
  `test.use({ trace: 'off' })`.
- [ ] `ba-ids.json` thêm S20.1–S20.8; `coverage.json` ánh xạ.
- [ ] README: mục "Tài khoản khách góp ý".
- Kiểm:
  - `bash e2e/support/run-e2e.sh --project=t1 --grep PW-S20` xanh trên stack T1;
  - `pnpm --filter @crew/paperclip-web test` (coverage test) xanh.
  - T2 chạy ở DP-1.

### RV-1 — Review

Agent `code-reviewer` đọc toàn bộ diff `38580c5d7..crew/guest-approval`, tập trung vào:
1. còn chỗ nào lộ nội dung chờ cho agent không (§6.2), kể cả log, activity, event;
2. C7/C8 đúng một dòng, đúng anchor, check-core-hooks sạch;
3. đổi trạng thái có điều kiện, không có đường nào tới `approved` mà thiếu `result_*`;
4. UI không còn nút chết với viewer/khách;
5. không có id plan/ticket trong code, test, commit.

Kết quả ghi `reports/review.md`. Sửa xong mới DP.

### DP-1 — Deploy và nghiệm thu

- [ ] `crew/release/verify.sh` xanh trên nhánh.
- [ ] Build image và deploy theo `crew/ops/deploy.sh` (nâng plugin, migration 0013 tự áp khi plugin nâng). Kiểm
  `plugin-state.sh`: `crew.core` `ready`, không `upgrade_pending`. Manifest không thêm capability.
- [ ] Owner (hoặc controller có owner cho phép) tạo tài khoản khách e2e trong Crew E2E qua trang Thành viên (AC1).
  Lưu mật khẩu vào `/opt/crew-v3-spike/.env` bằng biến `CREW_E2E_CONTRIBUTOR_*`. Agent không cầm mật khẩu.
- [ ] Chạy T2: `bash e2e/support/run-e2e.sh --project=t2 --grep PW-S20`.
- [ ] Đi qua AC1–AC12 (spec §10), ghi bằng chứng vào `reports/acceptance.md`.
- Rollback: spec §12 (`crew/ops/rollback.sh` về image `crew/v3.3`).

## 5. Ma trận test (tóm tắt, chi tiết ở spec §9)

| Tầng | Cái gì |
|---|---|
| Unit server | kiểm đầu vào, quyền, đổi trạng thái, `findMaterialized` |
| Route/DB server | router Crew đầy đủ; C8; viewer bị chặn 11 route ghi; agent không thấy (list, search, get, comments, heartbeat-context, activity, wake) |
| Plugin DB | migration 0013; plugin không nhắc bảng góp ý |
| Unit crew-web | access hook, nav, client, điều phối duyệt, dialog, trộn bình luận, trang Thành viên, guard |
| E2E | PW-S20-1..7 (T1, T2) |
| Nghiệm thu prod | AC1–AC12 |

## 6. Rủi ro theo ticket

| Ticket | Rủi ro chính | Mức | Giảm thiểu |
|---|---|---|---|
| SV-2 | Mở rộng nhầm cho route ghi plugin | Cao nếu xảy ra | Chỉ thay dòng 1624 (route data). Test viewer → 403 ở `bridge/action`, `actions/:key`, route plugin có scope |
| SV-1 | Ghi activity hay event làm lộ nội dung | Cao nếu xảy ra | Test agent không thấy quét activity; review mục 1 |
| SV-1 | Đổi trạng thái đua nhau | Trung bình | `UPDATE` có điều kiện, test 2 owner |
| WB-1 | Bỏ sót nút ghi cho viewer | Trung bình | PW-S20-6 kiểm không nút chết; review mục 4 |
| WB-3 | Duyệt đứt giữa chừng | Trung bình | Khóa idempotent + tự lành ở server; test `approve-flow` |
| WB-4 | Link mời sai đường | Cao | Dựng `/paperclip/invite/`; T0 kiểm; PW-S20-7 |
| DP-1 | Prod tắt đăng ký | Trung bình | T0; câu hỏi Q2 |

## 7. Câu hỏi còn mở

Xem spec §13: Q1 (khách đọc được agent/run/chi phí qua API, chỉ ẩn ở UI) và Q2 (chỉ hỏi khi T0 thấy prod tắt đăng ký).
Không chặn code: mọi ticket đều làm được trước khi có câu trả lời.
