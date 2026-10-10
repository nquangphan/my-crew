# Crew v3 R3X — Ép Done, sửa/xóa skill, gỡ agent/project trên web

Ngày: 10/10/2026 07:28, Asia/Ho_Chi_Minh. Trạng thái: spec đã viết, plan ở
[plans/261010-0720-crew-v3-r3x/plan.md](../../../plans/261010-0720-crew-v3-r3x/plan.md).

Nguồn yêu cầu: owner chốt sáng 10/10 (`plans/reports/cho-dai-ca-261010.md`, mục "Đại Ca đã chốt", dòng R3 BA câu 3, 6,
7). Ba việc này **đảo** ba giả định của spec R3
([2026-10-10-crew-v3-r3-ui-design.md](2026-10-10-crew-v3-r3-ui-design.md), nằm trên nhánh `v3`): §4.9 "không có nút ép
xong", §11 "không gỡ agent hay project trên web", §12 Q3/Q6/Q7. Phần còn lại của spec R3 giữ nguyên. R3X là phần mở
rộng của R3: cùng nhánh tích hợp `crew/r3` (fork) và `r3` (repo Crew), cùng Global Constraints, cùng tag cuối R3.

Mã mới tiếp nối danh mục BA R3: `S6.17` Ép Done, `S6.18` Lịch sử issue, `S14.5` Sửa skill, `S14.6` Cập nhật/tạo bản sửa
được, `S14.7` Xóa skill, `S8.7` Gỡ project, `S11.9` Gỡ agent, `F10` gỡ project đầu-cuối.

## 1. Mục tiêu

1. **Ép Done (S6.17).** Owner đóng được một yêu cầu đang kẹt ở bất kỳ trạng thái mở nào, kể cả khi chưa qua đủ stage
   review/duyệt/docs/push. Bắt buộc nhập lý do. Server ghi `crew.policy.board_override` như hiện nay, cộng một activity
   riêng có lý do. Lịch sử issue (S6.18) hiện rõ lần ép, ai ép, lý do, các cổng bị bỏ qua.
2. **Sửa/xóa skill (S14.5–S14.7).** Board sửa thông tin và nội dung skill, cập nhật skill từ nguồn GitHub, tạo bản sửa
   được từ skill GitHub, và xóa skill. Xóa thì gỡ skill khỏi mọi agent đang bật và dọn bản chép trên Mac qua hàng đợi
   việc máy. Agent vẫn không sửa/xóa được skill (skill policy deny giữ nguyên). Skill Superpowers (và workflow ghim khác)
   không sửa/xóa được từ web.
3. **Gỡ agent/project (S8.7, S11.9).** Tương đương "Gỡ khỏi Mac" của app, cộng archive project và dọn checkout trên
   Mac qua hàng đợi việc máy. Không xóa dữ liệu: agent chỉ pause, environment chỉ archive (không bao giờ `DELETE`),
   project chỉ archive, nhánh git và folder gốc giữ nguyên. Có xác nhận bằng cách gõ tên.

## 2. Hiện trạng đã kiểm (bằng chứng)

Đường dẫn fork tính từ commit `f569bf4a5` (`crew/r3`, prod đang chạy). Repo Crew: nhánh `r3` @ `94b8dff`.

### 2.1. Cổng issue

| Sự thật | Nguồn |
|---|---|
| Route `PATCH /issues/:id` chạy transition của stock **trước** khi ghi; truyền `allowBoardOverride: req.actor.type === "board"` | `server/src/routes/issues.ts:13130-13151` |
| Board gửi `status:'done'` khi issue đang chờ một stage mà board **không** là người tham gia: transition xóa `executionState`, giữ `done` → H2 thấy vào `done` thiếu stage/docs/push → `override` | `server/src/services/issue-execution-policy.ts:912-916`; `server/src/crew/issue-gate.ts:336` |
| Board **là** người tham gia stage approval: `done` được hiểu là **Duyệt** (bắt buộc comment), chuyển sang stage kế, không đóng issue | `issue-execution-policy.ts:786-840` |
| Issue **không** chờ stage nào (`todo`, `in_progress`, `blocked`, `changes_requested`): `done` **bắt đầu workflow** ở stage đầu, issue thành `in_review`, giao cho reviewer (đánh thức agent) | `issue-execution-policy.ts:966-1044` |
| `updateIssueSchema` không nhận `executionState`. Đổi `executionPolicy: null` thì mất policy, mở lại sau đó agent bị chặn `policy_missing` | `packages/shared/src/validators/issue.ts:873-897`; `issue-gate.ts:252-333` |
| H2 ghi `crew.policy.board_override` với `{violations, toStatus}`, **không có lý do**. Không bắt buộc comment | `issue-gate.ts:532-534` |
| H2 chỉ được sửa `patch` ở một chỗ (xóa `executionState` khi rời `done/cancelled`, trả việc cho executor) | `issue-gate.ts:42`, `:503-520` |
| `actorOf`: có `actorAgentId` → agent; chỉ `actorUserId` → board | `issue-gate.ts:342-346` |
| Plugin `ctx.issues.update(id, patch, companyId, {actorUserId})` gọi thẳng `issueService.update` (H2 vẫn chạy), **không** đi qua transition của route. Ghi activity `issue.updated` với actor user | `server/src/services/plugin-host-services.ts:1957-1990`; SDK `packages/plugins/sdk/src/types.ts:1458-1486` |
| SDK có `createComment(..., {actorUserId})` (capability `issue.comments.create_human_attributed`) và `requestWakeup` (capability `issues.wakeup`). Plugin hiện có `issues.update`, `issue.comments.create`, `activity.log.write`, chưa có hai capability kia | `types.ts:1502-1544`; `packages/crew-plugin/src/manifest.ts` |
| Đóng issue không có luật chặn khi còn con mở. Con cuối cùng xong thì route đánh thức assignee của cha (`issue_children_completed`) — chỉ ở route, không ở service | `server/src/routes/issues.ts:14810-14840`; `services/issues.ts:9140-9170` |
| `done` không hủy run đang chạy (chỉ `cancelled` mới hủy) | `routes/issues.ts:13072`, `:13767-13790` |
| Plugin `crew.core` không nghe sự kiện issue đổi trạng thái | `packages/crew-plugin/src` (chỉ `agent.run.cancelled`, sự kiện agent/project/goal) |
| `GET /issues/:id/activity` có sẵn; `crew-web` chưa dùng; trang issue chưa có lịch sử | `server/src/routes/activity.ts:341-348`; `packages/crew-web/src/api/endpoints.ts` |
| Thao tác cổng hiện có trong `crew-web`: Duyệt `{status:'done', comment}`, Yêu cầu sửa, Hủy, Mở lại; đọc lại issue trước khi gửi | `packages/crew-web/src/features/issues/detail/crew/{gate-actions.ts,actions-slot.tsx,gate-dialogs.tsx}`; ledger R3 WK-3 (I7 chốt) |

**Hệ quả:** không làm được Ép Done chỉ bằng `PATCH` stock cho mọi trạng thái. Hai trong ba trường hợp (board là người
duyệt; issue chưa vào stage) sẽ thành Duyệt hoặc mở workflow và đánh thức reviewer. Cách chọn ở mục 4.1.

### 2.2. Skill

| Sự thật | Nguồn |
|---|---|
| Route sửa: `PATCH /companies/:c/skills/:id` (chỉ metadata: description, tagline, icon, color, categories…; không đổi tên/slug), `PATCH …/files {path, content}`, `DELETE …/files {path, target}` | `server/src/routes/company-skills.ts:1184,1215,1252`; `packages/shared/src/validators/company-skill.ts:218-227` |
| Chỉ skill nguồn `local_path` (tạo trên Paperclip, hoặc bản fork) sửa được nội dung. Skill `github`, `url`, `catalog`, `skills_sh` chỉ đọc: `updateFile` trả 422 kèm `editableReason` | `server/src/services/company-skills.ts:2684-2770`, `:4673`, `:4735` |
| `POST …/skills/:id/fork {name?, slug?, reassignAgentIds?}` tạo bản sửa được và chuyển agent sang bản mới; `GET …/fork-precheck` đếm agent đang dùng | `company-skills.ts` route `:464`, `:939`; validator `:178-200` |
| `GET …/skills/:id/update-status`, `POST …/install-update` cập nhật skill GitHub theo `trackingRef` (409 nếu đường dẫn không còn được chọn hoặc đã mất khỏi repo) | route `:1096`, `:1477` |
| Không có route đổi URL repo hay `trackingRef` của một nguồn đã tạo. `PATCH /skill-sources/:id` chỉ nhận `{revision, selectedPaths, excludedFolders}` | `routes/company-skills.ts:385`; `validators/skill-source.ts:20-25` |
| `DELETE …/skills/:id`: **422** nếu còn agent khai skill trong `adapterConfig.paperclipSkillSync.desiredSkills` (trả `usedByAgents`), 409 nếu skill đổi giữa chừng; xóa version, cache runtime, thư mục materialize | `services/company-skills.ts:7113-7184` |
| Xóa skill nguồn GitHub mà mục nguồn còn `selection = selected` thì lần refresh nguồn sau **tạo lại** skill | `services/skill-sources.ts:86-106` |
| Gán skill cho agent: `POST /agents/:id/skills/sync` (H5 chặn agent; board được) | `routes/agents.ts:3930`; `server/src/crew/agent-config-gate.ts:31-32,93` |
| Skill policy deny của Crew: rule `crew-deny-agent-skill-writes` (subject `all_agents`, 8 action `skills.create/import/install/edit/update/test/reset/remove`). Board theo mặc định allow. DP-1 đã áp lên TPS và Crew E2E | `crew/ops/agent-permissions.sh:29-32,139-152`; ledger R3 DP-1 |
| Superpowers/BMAD **không** là company skill: bản ghim `~/.crew/workflows/<tên>/<bản>`, nạp qua `--plugin-dir`. Web chỉ chặn trùng tên khi thêm (`superpowersNameClash`) | `packages/crew-web/src/lib/instructions/agent-config.ts:31-50`; `features/skills/name-guard.ts` |
| Lúc chạy, agent nhận skill qua `.paperclip-runtime/claude/skills` do adapter chuẩn bị từ `desiredSkills`. `~/.crew/skills/<companyId>/<slug>` (job `skill-sync`) **không** được đọc lúc chạy; đó là bản chép để soát và hiện trạng thái đồng bộ | `packages/adapters/claude-local/src/server/execute.ts:535-550`; repo Crew `apps/mac-app/src/main/jobs/executors.ts:218-251` |
| Hàng đợi máy: CHECK `kind IN ('inspect-folder','prepare-checkouts','agent-workspace','skill-sync','check')`, chưa migration nào đổi. Migration plugin mới nhất `0010` | `packages/crew-plugin/migrations/0006_machine_jobs.sql:5` |
| `crew.skillSync` trả việc mới nhất theo cặp skill/máy, kể cả của skill đã xóa | `packages/crew-plugin/src/skills/sync-data.ts` |

### 2.3. Gỡ agent/project

| Sự thật | Nguồn |
|---|---|
| "Gỡ khỏi Mac" của app (R2-1 PJ-2): pause agent (`POST /agents/:id/pause`), archive environment `active` (`PATCH /environments/:id {status:'archived'}`, không `DELETE` vì xóa kéo theo secret SSH dùng chung), bỏ repo docs khỏi bản tin (`removeStatusRepo`), xóa vai trò (plugin `DELETE /projects/:p/roles`), xóa tiến độ trong `app.json`. **Không** archive project, **không** xóa checkout: chỉ hiện lệnh `git worktree remove` cho owner tự chạy. Xác nhận bằng `window.confirm` | repo Crew `apps/mac-app/src/main/projects/remove-project.ts:12-59`, `progress.ts:60-74`, `renderer/routes/projects.tsx:220-234`; plan R2-1 `:335` |
| `POST /agents/:id/pause`: board, hủy run đang chạy (`cancelActiveForAgent`). `terminate` không đảo ngược, thu hồi key. `DELETE /agents/:id` 500 khi đã có `cost_events` | `server/src/routes/agents.ts:5611-5623`, `:5758-5800`, `:5828`; `services/agents.ts:954,1024-1047` |
| Archive project: `PATCH /projects/:id {archivedAt}`. `DELETE /projects/:id` 500 khi có `cost_events`. Hiện agent gọi được cả hai (D6) — **CORE-P đang vá** để chỉ board làm được | `server/src/routes/projects.ts:324-339`, `:775`; ledger R3 07:20 |
| `PATCH /environments/:id` cần `assertCanAccessInstanceEnvironments` (board + instance admin hoặc `local_implicit`) — cùng kiểm với `POST` mà wizard Thêm project đã dùng được trên prod | `server/src/routes/environments.ts:353,423,1125` |
| Plugin security bỏ qua thao tác project của actor `user` (board archive không bị log/pause) | `packages/crew-plugin/src/security/guards.ts:34,45,89` |
| Vai trò: một agent chỉ giữ vai trò ở một project (route vai trò chặn chéo) | BA R3 S8.3; `packages/crew-plugin/src/roles/api.ts` |
| Bản tin máy có `checkouts[] {path, head, clean}` (`~/crew-agents/<key>/<role>`) | `packages/crew-plugin/src/machines/webhook.ts:14-15,66-71` |
| App: `checkoutPath(home,key,role)`, `machineGuardReason`, `ensureWorktree`; không có hàm gỡ worktree | `apps/mac-app/src/main/jobs/validate.ts:121-141`; `projects/folder.ts:217` |
| `crew_setup_runs.kind IN ('add-project','add-agent')`; status thêm `abandoned` (0009) | `migrations/0007_setup_runs.sql:4`, `0009_setup_runs_abandon.sql` |
| `ConfirmDialog` có `requireText` (gõ đúng chuỗi mới bật nút) và `destructive` | `packages/crew-web/src/ds/widgets/confirm-dialog.tsx` |
| Readiness: project `archivedAt` → `untracked` và bị lọc khỏi danh sách; agent `paused` hiện "Tạm dừng" | `packages/crew-web/src/features/readiness/compute.ts:166-238`; `use-readiness.ts:96` |

## 3. Phạm vi

- **Có:** S6.17, S6.18, S14.5–S14.7, S8.7, S11.9, F10 như mục 4; hai `kind` việc máy mới; hai `kind` setup run mới; một
  route plugin mới; mở rộng thân H2 một chỗ; cập nhật Hướng dẫn (VI/EN, mục "Vì sao không có nút X").
- **Không có:** xem mục 9.

## 4. Thiết kế

### 4.1. Ép Done (S6.17) và Lịch sử (S6.18)

**Cách chọn: một route plugin cho mọi trường hợp**, không dùng `PATCH` stock. Lý do (mục 2.1): `PATCH {status:'done'}`
của board chỉ thành ép ở một trong ba trường hợp; hai trường hợp còn lại thành Duyệt hoặc mở workflow và đánh thức
reviewer (tốn quota, sai ý owner). Gửi `executionPolicy: null` thì mất policy, mở lại sẽ kẹt `policy_missing`. Gọi
`issueService.update` qua `ctx.issues.update` của plugin thì bỏ qua transition của route mà H2 vẫn chạy và vẫn ghi
`board_override`.

**Route:** `POST /api/plugins/crew.core/api/issues/:issueId/force-done` (`auth: "board"`, `companyResolution` lấy từ
body).

| Body | Kiểu |
|---|---|
| `companyId` | uuid, bắt buộc |
| `reason` | chuỗi đã `trim`, 10–1000 ký tự, bắt buộc |

| Trả | Khi |
|---|---|
| 200 `{issue, violations: string[]}` | Đã đóng. `violations` là danh sách H2 bỏ qua (rỗng nếu issue không có policy) |
| 400 `{error:'reason_invalid'}` | Lý do thiếu, ngắn, dài, có ký tự điều khiển |
| 403 | Actor không phải board (host chặn; handler kiểm lại như `roles/api.ts`) |
| 404 | Issue không có hoặc khác company |
| 409 `{error:'issue_terminal', status}` | Issue đã `done` hoặc `cancelled` (muốn đóng lại thì Mở lại trước) |

**Handler (thứ tự):**

1. Kiểm actor board, đọc issue (`ctx.issues.get`), kiểm company, kiểm trạng thái.
2. `ctx.issues.update(issueId, {status:'done'}, companyId, {actorUserId})`. H2 chạy trong transaction của service:
   board vào `done` thiếu cổng → `override`, ghi `crew.policy.board_override {violations, toStatus}`.
3. **Mở rộng thân H2 (một chỗ):** khi `verdict.kind === 'override'`, đang vào `done`, và `patch` không có
   `executionState` thì đặt `patch.executionState = null`. Giống hệt kết quả của stock ở `issue-execution-policy.ts:912-916`
   (board ép issue đang chờ stage), để issue `done` không còn stage `pending` treo. Cập nhật `description` của H2 trong
   `crew/release/core-hooks.json`, không đổi `anchor/head/file`.
4. `ctx.issues.createComment(issueId, "**Ép Done** — <lý do>", companyId, {actorUserId})` (comment đứng tên owner).
5. `ctx.activity.log` action `crew.issue.force_done`, `details {reason, fromStatus, fromStageId, fromStageType,
   violations}`.
6. **Báo Trợ Lý:** nếu issue có cha, cha giao cho agent, và mọi con của cha đều `done/cancelled` sau lần ghi này thì
   `ctx.issues.requestWakeup(parentId, companyId, {reason:'issue_children_completed', idempotencyKey:'force-done:<issueId>'})`
   — bù cho đoạn đánh thức chỉ có ở route (mục 2.1). Issue gốc (không cha) thì không đánh thức ai: yêu cầu đã xong.

Bước 4–6 lỗi thì vẫn trả 200 (issue đã đóng), kèm `warnings[]`; log lỗi đã làm sạch. Manifest thêm capability
`issue.comments.create_human_attributed`, `issues.wakeup`.

**Web (thứ tự trong trình duyệt, phiên owner):**

1. Nút **Ép Done** ở `PageHeader.actions` khi `status ∉ {done, cancelled}`. Nút kiểu destructive, đứng sau các nút cổng.
2. Dialog: tóm tắt cổng sẽ bị bỏ qua (stage đang chờ, người đang giữ, các stage chưa duyệt theo `executionPolicy` và
   `executionState.completedStageIds`), số run đang chạy của issue, số issue con chưa xong (kèm danh sách). Ô **Lý do**
   bắt buộc ≥ 10 ký tự. Ô chọn **"Hủy luôn n issue con chưa xong"** (mặc định bật, xem Q1). Nút "Ép Done" chỉ bật khi lý
   do hợp lệ.
3. Bấm: đọc lại issue (như Duyệt). Đã `done/cancelled` thì báo "Yêu cầu vừa đổi trạng thái", đóng dialog, không gửi.
4. Nếu chọn hủy con: `PATCH /issues/<con> {status:'cancelled'}` cho từng con chưa xong (stock, board → hủy run, H3 dừng
   trên Mac; cháu của con thì để Trợ Lý/owner xử lý như hủy thường).
5. `POST /heartbeat-runs/:runId/cancel` cho từng run đang chạy của chính issue.
6. `POST …/force-done {companyId, reason}`.
7. Lỗi ở bước nào thì dừng, hiện lỗi nguyên văn trong dialog, giữ lý do. Bấm lại thì làm lại từ đầu (các bước đều chạy lại
   an toàn: con đã hủy và run đã dừng được bỏ qua).
8. Thành công: invalidate như `useRefreshAfterGate` cộng `issueActivity(id)`.

**Lịch sử (S6.18):** khối "Lịch sử" trên trang issue, đọc `GET /api/issues/:id/activity` (thêm vào `endpoints.ts`).
Hiện giờ (`Asia/Ho_Chi_Minh`), người làm (user/agent), hành động đã dịch. `crew.issue.force_done` và
`crew.policy.board_override` hiện nổi bật (badge "Ép Done", lý do, danh sách cổng bỏ qua dịch sang câu: thiếu duyệt stage
X, thiếu docs, push cũ…). Hai bản ghi của cùng một lần ép (cách nhau ≤ 5 giây, cùng user) gộp thành một dòng. Action
không biết thì hiện mã gốc. Panel thuộc tính thêm badge "Đã ép Done" khi bản ghi `force_done` mới nhất sau lần mở lại gần
nhất.

**Agent không ép được:** route `auth: "board"` (host `assertBoard`); agent `PATCH {status:'done'}` vẫn bị H2 chặn
`crew_gate_blocked` như cũ.

### 4.2. Sửa skill (S14.5, S14.6)

Trang chi tiết skill (`skills/:skillId`) thêm các thao tác, **chỉ hiện cho company skill**:

| Thao tác | Hiện khi | Gọi | Sau đó |
|---|---|---|---|
| Sửa thông tin (mô tả, tagline, nhóm) | mọi skill | `PATCH /companies/:c/skills/:id` | — |
| Sửa nội dung: trình sửa `SKILL.md` và từng file text; thêm/xóa file | skill sửa được (`editable` theo server) | `PATCH …/files {path, content}`, `DELETE …/files {path, target:'file'}` | Xếp `skill-sync` cho mọi máy (như khi thêm) |
| Kiểm cập nhật / **Cập nhật từ nguồn** | skill nguồn GitHub | `GET …/update-status`, `POST …/install-update` | Xếp `skill-sync` |
| **Tạo bản sửa được** | skill chỉ đọc | `GET …/fork-precheck` → `POST …/fork {name, reassignAgentIds: <agent đang dùng>}` | Mở bản mới; bản cũ còn thì gợi ý Xóa |

Luật:

- Không có đổi tên/slug (slug là khóa trong `desiredSkills` của agent và tên thư mục trên Mac). Bản fork lấy tên mới
  qua `superpowersNameClash`: trùng tên skill Superpowers ghim thì chặn, như khi thêm.
- Sửa `SKILL.md`: đọc `name:` trong frontmatter; đổi `name` thành tên trùng Superpowers thì chặn trước khi gửi.
- Lưu dùng `baseHash`/phiên bản nếu server có; nếu server trả 409 thì báo "Có người vừa sửa, tải lại", không ghi đè.
- "Sửa nguồn" (đổi repo/nhánh) stock không có route. Làm bằng: thêm skill từ nguồn mới (S14.2), bật cho agent, rồi xóa
  bản cũ. Hướng dẫn ghi rõ (Q4).
- Skill sửa nội dung có hiệu lực ở run kế tiếp của agent đang bật (adapter dựng lại `.paperclip-runtime`).

### 4.3. Xóa skill (S14.7)

Nút **Xóa skill** (destructive) trên trang chi tiết. `ConfirmDialog requireText = <slug>`; dialog liệt kê agent đang
bật skill và máy đã có bản chép.

Các bước (trình duyệt, phiên owner; mỗi bước chạy lại an toàn):

1. Với mỗi agent có skill trong `desiredSkills`: `GET /agents/:id/skills` → `POST /agents/:id/skills/sync
   {desiredSkills: <danh sách bỏ skill này>, mode:'replace'}` (cùng cách tab Skills S11.3).
2. Skill có nguồn GitHub quản lý (`metadata.skillSourceId`): `GET /skill-sources/:id` → `PATCH /skill-sources/:id
   {revision, selectedPaths: <bỏ đường dẫn skill>, excludedFolders}` để lần refresh sau không tạo lại skill. 409 sai
   `revision` → đọc lại, làm lại một lần, vẫn lỗi thì báo.
3. `DELETE /companies/:c/skills/:id`. 422 còn agent dùng → hiện `usedByAgents`, quay lại bước 1. 409 → tải lại.
4. Với mỗi máy có việc `skill-sync` của skill này (từ `crew.skillSync`): `jobs.create {kind:'skill-remove', payload:
   {skillId, slug}}`. App xóa `~/.crew/skills/<companyId>/<slug>`. Máy chưa nhận thì hiện "Chờ app 2P Crew trên <máy>".
5. Về danh sách skill. `crew.skillSync` không trả cặp skill/máy có việc mới nhất là `skill-remove` đã `done`.

**Superpowers đã ghim:** không phải company skill nên không có trong `GET /companies/:c/skills` và không route nào ở
trên chạm tới. Bảo đảm thêm ba lớp: (a) trang Skills hiện danh sách skill ghim (từ `superpowers.skills` của bản tin máy)
ở khối riêng chỉ đọc, không có nút; (b) không tạo/fork/đổi `name` thành tên trùng; (c) executor `skill-remove` chỉ xóa
trong `~/.crew/skills/<companyId>/`, không bao giờ đụng `~/.crew/workflows/**` (kiểm `realpath`).

**Agent vẫn bị chặn:** token agent gọi `PATCH/DELETE …/skills/:id`, `…/files`, `…/fork`, `…/install-update` → 403
`skill_policy_denied` (rule `crew-deny-agent-skill-writes`); `POST /agents/:id/skills/sync` → 422
`crew_agent_config_forbidden` (H5). R3X không đổi rule. Vì `fork` dùng action `skills.create`, `install-update` dùng
`skills.update` — cả hai đã có trong rule.

### 4.4. Gỡ project (S8.7, F10)

Nút **Gỡ project** (destructive) ở trang chi tiết project. `ConfirmDialog requireText = <tên project>`. Dialog hiện:
agent trong vai trò, số issue chưa xong (giữ nguyên, xem Q3), số run đang chạy (sẽ dừng), checkout trên máy kèm cờ
`clean` (từ bản tin).

Chạy như một setup run mới `kind:'remove-project'` (route `setup-runs` có sẵn, khóa bước, "Chạy tiếp" khi lỗi):

| Bước | Việc | Gọi |
|---|---|---|
| `pause-agents` | Pause mọi agent trong vai trò chưa `paused/terminated` (hủy run đang chạy) | `POST /agents/:id/pause` |
| `roles` | Xóa dòng vai trò | `DELETE /api/plugins/crew.core/api/projects/:p/roles?companyId=` |
| `environments` | Archive environment `defaultEnvironmentId` của các agent đó nếu `active` **và** không agent nào ngoài project này (chưa `terminated`) còn trỏ tới nó. Environment mẫu (giữ secret SSH) không bao giờ bị chạm. **Không bao giờ `DELETE`** | `PATCH /environments/:id {status:'archived'}` |
| `checkouts` | Job `remove-checkouts {projectId, projectKey, roles, removeStatusRepo:true}`; đợi `done` | hàng đợi máy |
| `project` | Archive project | `PATCH /projects/:id {archivedAt: <now ISO>}` |

- Thứ tự cố ý: pause trước khi gỡ checkout (không gỡ thư mục đang chạy), archive project sau cùng (lỗi giữa chừng thì
  project vẫn hiện để "Chạy tiếp").
- Kết quả job có `kept[]` (checkout bẩn/đang dùng/không phải worktree) thì bước vẫn `done`, hiện cảnh báo kèm đường dẫn
  và lệnh `git worktree remove` để owner tự quyết. Dữ liệu chưa commit không bao giờ bị xóa.
- `refs` của setup run lưu id agent đã pause, environment đã archive, `jobId`.
- Không archive issue, không hủy issue (Q3). Không xóa nhánh `crew/<key>/<role>`, không đụng folder gốc.
- Sau `done`: project có `archivedAt` nên readiness thành `untracked`, bị lọc khỏi danh sách và hộp chọn project (đã có).
  Trang project đã archive (mở bằng link) hiện banner "Đã gỡ lúc …".

### 4.5. Gỡ agent (S11.9)

Nút **Gỡ agent** ở trang chi tiết agent. `ConfirmDialog requireText = <tên agent>`.

**Điều kiện** (tính ở web từ `roles.get` của mọi project chưa archive):

| Agent đang | Gỡ được? |
|---|---|
| Không giữ vai trò nào | Được |
| Executor, project còn executor khác | Được: bỏ khỏi vai trò, render lại `AGENTS.md` của Trợ Lý |
| Trợ Lý, reviewer, integrator, hoặc executor duy nhất | **Không.** Nút tắt, kèm lý do và lối "Đổi vai trò" (S8.3) hoặc "Gỡ cả project" (S8.7) |
| Đã `terminated` | Không có nút |

Chạy như setup run `kind:'remove-agent'`, `input {agentId, projectId|null, role|null}`:

| Bước | Việc | Gọi |
|---|---|---|
| `roles` (nếu có vai trò) | Ghi bộ vai trò mới bỏ agent này (executor-2 → bỏ; executor-1 → executor-2 lên executor-1), rồi render lại `AGENTS.md` Trợ Lý | dùng lại `useSaveRoles` / `syncAssistantInstructions` (OR-1) |
| `pause-agent` | Pause | `POST /agents/:id/pause` |
| `environment` | Archive environment riêng (như 4.4) | `PATCH /environments/:id {status:'archived'}` |
| `checkout` (nếu có vai trò) | Job `remove-checkouts {projectId, projectKey, roles:[role], removeStatusRepo:false}` | hàng đợi máy |

Agent đã gỡ: `paused`, không vai trò, environment archived. Danh sách agent thêm bộ lọc "Đã gỡ" (agent có setup run
`remove-agent` `done`); mặc định ẩn khỏi danh sách và mọi hộp chọn agent. Muốn dùng lại: "Tiếp tục" (resume) rồi gán
vai trò như agent mới (wizard S13 "Làm tiếp").

### 4.6. Hàng đợi việc máy: hai `kind` mới

Migration plugin số kế tiếp (hiện là `0011`): `DROP/ADD CONSTRAINT` CHECK của `crew_machine_jobs.kind` thêm
`'remove-checkouts','skill-remove'`; CHECK của `crew_setup_runs.kind` thêm `'remove-project','remove-agent'`. Tên
constraint mặc định lấy bằng `\d` trên DB thử (Postgres đặt `<bảng>_kind_check`), như `0009`.

| `kind` | Payload | App làm gì | Kết quả |
|---|---|---|---|
| `remove-checkouts` | `{projectId: uuid, projectKey, roles: CrewRoleSlot[] (1–5, không trùng), removeStatusRepo: boolean}` | Với mỗi vai: `path = checkoutPath(home, key, role)`. Không có → `absent`. `realpath` phải nằm dưới `~/crew-agents/<key>/`, là worktree phụ (`git-dir ≠ git-common-dir`), không có process đang dùng (`lsof -t +d <path>` rỗng), `git status --porcelain` rỗng. Đủ thì `git --git-dir=<common> worktree remove <path>` (không `--force`), rồi `worktree prune`. Thiếu điều kiện thì giữ, ghi lý do. Xong thì `rmdir ~/crew-agents/<key>` nếu rỗng; `removeStatusRepo` → bỏ repo docs khỏi bản tin; xóa tiến độ project trong `app.json` nếu có | `{removed: {role, path}[], kept: {role, path, reason: 'dirty'\|'busy'\|'not_worktree'\|'git_failed', detail?}[], absent: CrewRoleSlot[]}` |
| `skill-remove` | `{skillId: uuid, slug}` | `realpath` của `~/.crew/skills/<companyId>/<slug>` phải nằm dưới `~/.crew/skills/<companyId>/`; xóa đệ quy; không có thì coi như xong | `{removed: boolean}` |

- Validate hai phía (plugin `validate.ts`, app `validate.ts`) theo luật I1 của R3: `projectKey` `KEY_RE`, `slug`
  `^[a-z0-9][a-z0-9-]{0,63}$`, không key lạ.
- Không bao giờ: `--force`, xóa nhánh, xóa folder gốc, xóa ngoài hai gốc trên. Lỗi git làm sạch như I1 (`sanitizeJobError`).
- `JobErrorCode` không thêm mã: "giữ lại" là kết quả `done` có `kept`, không phải `failed`. Lỗi bất ngờ → `app_error`.

### 4.7. Hợp đồng `crew-web` (gói `ds`)

`src/api/endpoints.ts` và client thêm đúng các dòng sau (mỗi dòng ghi mã BA):

| Mã | Method + path |
|---|---|
| S6.18 | `GET /api/issues/:id/activity` |
| S6.17 | `POST /api/plugins/crew.core/api/issues/:id/force-done`; `POST /api/heartbeat-runs/:id/cancel` (đã có) |
| S14.5 | `PATCH /api/companies/:c/skills/:id`, `GET …/files`, `PATCH …/files`, `DELETE …/files` |
| S14.6 | `GET …/update-status`, `POST …/install-update`, `GET …/fork-precheck`, `POST …/fork` |
| S14.7 | `DELETE /api/companies/:c/skills/:id`, `GET /api/companies/:c/skill-sources/:id`, `PATCH …/skill-sources/:id` |
| S8.7, S11.9 | `PATCH /api/environments/:id`, `POST /api/agents/:id/pause` (đã có), `PATCH /api/projects/:id` (đã có, thêm `archivedAt`), roles `DELETE` (đã có) |

Kiểu `MachineJobKind`, `JobPayload`, `JobResult`, `SetupRun.kind`, `SetupStepId` chép thêm từ plugin.

## 5. Nghiệm thu (đo được)

Giữ bốn tầng của spec R3 §7. Mọi ca chạy ở company **Crew E2E**, chế độ stub, 0 quota Claude.

- **AX1 Ép Done.** Ba ca trên prod:
  (a) issue đang chờ stage review của agent;
  (b) issue đang chờ stage approval của chính owner;
  (c) issue `in_progress` chưa vào stage.
  Sau Ép Done, cả ba có:
  - `status = done`, `executionState = null`;
  - đúng một activity `crew.policy.board_override` và một `crew.issue.force_done` có `reason`;
  - comment "Ép Done — …" đứng tên owner;
  - không có run mới nào được tạo sau thời điểm bấm (`heartbeat_runs` của reviewer);
  - Lịch sử hiện dòng gộp có lý do.

  Ca (b) không có `issue_execution_decisions` mới (không thành Duyệt).
- **AX2 Ép Done với con và cha.** Issue con cuối cùng của một gốc do Trợ Lý giữ được ép xong → có wakeup cho Trợ Lý
  (`agent_wakeup_requests` hoặc run mới với reason `issue_children_completed`). Gốc có con mở + bật "Hủy luôn" → các con
  `cancelled`, run của chúng `cancelled`.
- **AX3 Ca âm Ép Done.** Token agent `POST …/force-done` → 403; lý do 9 ký tự → 400 và DB không đổi; issue `done` → 409.
  Duyệt thường (PW-S6-7) vẫn không có `board_override` (hồi quy).
- **AX4 Sửa skill.** Skill tạo trên Paperclip: sửa `SKILL.md` → `GET …/files` trả nội dung mới, có việc `skill-sync` mới
  `done` với `sha256` khác lần trước. Skill GitHub: nút sửa nội dung không hiện; "Tạo bản sửa được" → skill mới
  `local_path`, agent đang dùng chuyển sang key mới (`GET /agents/:id/skills`). Đổi `name:` thành `brainstorming` → chặn,
  không gọi API.
- **AX5 Xóa skill.** Skill đang bật cho một agent E2E, đã đồng bộ về Mac: xóa → agent không còn skill trong
  `desiredSkills`; `GET skills/:id` 404; mục nguồn không còn `selected`; `POST /skill-sources/:id/refresh` không tạo lại
  skill; trên Mac `~/.crew/skills/<cid>/<slug>` không còn; `crew.skillSync` không còn cặp đó.
- **AX6 Ca âm skill.** Token agent: `PATCH …/files` → 403 `skill_policy_denied`; `DELETE …/skills/:id` → 403;
  `POST …/fork` → 403; `POST /agents/:self/skills/sync` → 422. Executor `skill-remove` với `slug` `../workflows` → 400 ở
  plugin; payload sửa tay qua DB (test đơn vị app) → từ chối, không xóa gì. Trang Skills không có nút nào trên khối skill
  ghim.
- **AX7 Gỡ project (F10).** Project E2E tạo bằng wizard, có một checkout bẩn (tệp chưa commit): gỡ → agent `paused`;
  environment riêng `archived` (environment mẫu vẫn `active`; không có lời gọi `DELETE` nào trong log server); vai trò
  trống; project có `archivedAt`; trên Mac checkout sạch đã mất, checkout bẩn còn nguyên (kết quả `kept: dirty`); nhánh
  `crew/<key>/<role>` vẫn có trong repo gốc; folder gốc nguyên vẹn; `status-repos.json` không còn project. Gõ sai tên → nút
  tắt. Lỗi ở bước `checkouts` (app tắt) → "Chạy tiếp" sau khi bật app thì làm tiếp, không pause lại.
- **AX8 Gỡ agent.** Executor-2 của project E2E: gỡ → vai trò còn một executor; `AGENTS.md` Trợ Lý không còn tên agent;
  agent `paused`, environment `archived`, checkout của vai đó mất. Reviewer: nút tắt, có lý do.
- **AX9 Ca âm gỡ.** Token agent: `PATCH /projects/:id {archivedAt}` → bị chặn theo vá CORE-P (D6); `POST
  /agents/<khác>/pause` → 403; route `setup-runs`, `machine-jobs` → 403. Payload `remove-checkouts` có `projectKey`
  `../x` → 400.
- **AX10 Không nút chết, i18n, design system.** Test luật R3 (AC3, AC4, AC5) xanh với các màn hình mới; `coverage.json`
  có đủ mã mới.
- **AX11 Lõi.** `check-core-hooks.mjs` 5/5, `base` giữ `v2026.1005.0`; diff fork chỉ trong đường dẫn được phép của plan
  R3 (cộng các file CORE-P đã được owner duyệt).

## 6. Rủi ro

| Rủi ro | Giảm |
|---|---|
| Ép Done qua service bỏ qua phần route làm khi đóng issue (hết hạn interaction đang chờ, đánh thức cha) | Plugin tự đánh thức cha (4.1 bước 6). Thẻ câu hỏi còn `pending` trên issue đã `done/cancelled` thì web ẩn (WK-X1 thêm điều kiện và test); ghi vào Hướng dẫn |
| Run của executor đang chạy ghi đè sau khi ép | Web hủy run trước khi gọi route; H2 vẫn chặn agent đổi `done` thiếu cổng |
| Mở rộng H2 làm đổi hành vi Duyệt hay ép bằng PATCH | Chỉ chạy khi `override` + vào `done` + `patch` chưa có `executionState`; test hồi quy `crew-issue-gate.db.test.ts` (Duyệt 4 stage = 0 override; ép bằng PATCH như cũ) |
| Xóa skill GitHub bị tạo lại khi refresh nguồn | Bước 2 của 4.3 bỏ đường dẫn khỏi `selectedPaths`; AX5 kiểm bằng refresh thật |
| Xóa nhầm ngoài thư mục cho phép trên Mac | `realpath` + tiền tố cố định; payload kiểm hai phía; test có symlink trỏ ra ngoài |
| Gỡ checkout đang chạy hoặc có việc chưa commit | Pause trước; `lsof` + `git status`; không `--force`; giữ và báo |
| Archive nhầm environment mẫu dùng chung secret SSH | Chỉ archive environment không còn agent nào ngoài phạm vi trỏ tới; AX7 kiểm environment mẫu vẫn `active` |
| Gỡ agent đang giữ vai trò bắt buộc làm project fail closed | Điều kiện 4.5; route vai trò vẫn kiểm |
| CORE-P (vá D6) đổi quyền route project cùng lúc | R3X chỉ dùng phiên board; ticket web/ca âm chạy sau khi CORE-P gộp vào `crew/r3` |
| Plugin cũ gặp `kind` mới | Deploy plugin (migration) trước, cài app sau (như R3) |
| App cũ nhận việc `kind` lạ | App R3 báo `failed app_error` (kind không hỗ trợ) — không hại; web hiện lỗi, cài app mới rồi Thử lại |

## 7. File dự kiến chạm

- Fork: `packages/crew-plugin/**` (migration, jobs, setup, route `force-done`, `manifest.ts`, `worker.ts`,
  `skills/sync-data.ts`), `server/src/crew/issue-gate.ts` + `server/src/__tests__/crew-issue-gate*.test.ts`,
  `crew/release/core-hooks.json` (`description` H2), `packages/crew-web/**` (api, features issues/skills/projects/agents/
  wizards/guide, e2e).
- Repo Crew: `apps/mac-app/src/main/jobs/**`, `apps/mac-app/test/jobs/**`, `docs/flows/mac-app-paperclip.md`.

## 8. Giai đoạn

0. Chờ CORE-P gộp vào `crew/r3` (cho phần chạm route project và H2).
1. Plugin (migration, `kind`, route `force-done`) ∥ H2 ∥ app Mac (hai executor).
2. Client `crew-web` (`ds`).
3. Ép Done + Lịch sử (`work`) ∥ sửa/xóa skill (`org`) ∥ gỡ project/agent (`wizards`).
4. Gắn nút gỡ, bộ lọc "Đã gỡ", Hướng dẫn (`org`); E2E.
5. Review, deploy (plugin trước), cài app, T2.

## 9. Không làm

- Không `DELETE` agent, project, environment, nhánh git, folder gốc. Không `terminate` agent (Q2).
- Không đổi tên/slug skill, không đổi repo/nhánh của nguồn skill tại chỗ, không Skill Studio, không test-run skill.
- Không sửa/xóa skill ghim (Superpowers, BMAD) từ web.
- Không đổi trạng thái tự do, không đổi assignee/reviewer/approver (vẫn như R3 §4.9). Ép Done chỉ đóng `done`.
- Không gỡ project/agent bằng agent hay Trợ Lý.
- Không thêm hook, không nâng Paperclip.

## 10. Câu hỏi cho owner (không chặn; Trợ Lý tạm theo phương án khuyên)

| # | Câu hỏi | Khuyên (đang theo) | Owner bác thì đổi ở đâu |
|---|---|---|---|
| Q1 | Ép Done issue có con chưa xong thì con ra sao? | Ô "Hủy luôn n issue con chưa xong" **bật sẵn**: không để executor chạy tiếp việc của yêu cầu đã đóng (tốn quota). Owner bỏ chọn được | Mặc định ô chọn trong `force-done-dialog.tsx` (WK-X1) |
| Q2 | "Gỡ agent" là pause hay terminate? | **Pause** (đảo ngược được, giữ key, giữ lịch sử run). Paperclip không có archive agent; terminate thu hồi key và không quay lại | WZ-X1 thêm bước `terminate` sau `pause-agent` |
| Q3 | Gỡ project còn issue chưa xong thì sao? | **Giữ nguyên** issue (agent đã pause nên không chạy), dialog báo số lượng | WZ-X1 thêm bước hủy issue mở (PATCH `cancelled`) trước `pause-agents` |
| Q4 | "Sửa nguồn" skill GitHub | Stock không có route đổi repo/nhánh. Làm bằng **Cập nhật từ nguồn**, **Tạo bản sửa được**, hoặc thêm từ nguồn mới rồi xóa bản cũ | Cần đổi tại chỗ thì phải sửa lõi (ngoài phạm vi), hoặc OR-X1 làm luồng "Đổi nguồn" ghép ba bước |
| Q5 | Checkout bẩn khi gỡ | **Giữ lại**, hiện đường dẫn và lệnh tự gỡ; không bao giờ `--force` | Executor `remove-checkouts` thêm cờ `force` (owner tick từng checkout) |
