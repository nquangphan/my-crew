# RV-X — Review R3X trước deploy

Người review: RV-X (opus, subagent). Giờ Asia/Ho_Chi_Minh theo `date`: bắt đầu 09:28, xong 09:38 ngày 10/10/2026.

## Kết luận: ĐẠT CÓ ĐIỀU KIỆN

0 Blocker, 1 Major, 9 Minor. Các cam kết an toàn chính đều giữ đúng: environment không bao giờ bị `DELETE`, không
terminate agent, checkout không bao giờ bị xóa cưỡng bức (có `realpath` và kiểm symlink), xóa skill không chạm
Superpowers, route Ép Done chỉ cho board, H2 chỉ đổi thân hàm (hook 5/5, vá lõi 6), migration 0011 an toàn với dữ liệu
prod và lui image được. Full suite hai repo xanh.

Điều kiện để deploy:

1. Sửa **M1** (đổi thứ tự trong `runForceDone`: gọi route trước rồi mới hủy con) trước DP-X1. Nếu không sửa thì phải
   ghi rõ đây là rủi ro đã chấp nhận và AC-X phải kiểm AX1/AX2 bằng `heartbeat_runs`.
2. DP-X1 dùng **m1**: plugin phải về `ready` sau khi restart, không phải `upgrade_pending`. Không tự duyệt capability.

## Phạm vi đã đọc

- Fork `06e04053b..crew/r3x` (`0f58f38ac`): 17 commit, 116 file. Gồm FX-NHO (`a294fc2e2` overlay cho `ui/`,
  `64d613037` audit chỉ quét company Crew đã lưu, `23990e2a5` `multiCompanyConfig`, `0bec7d1cc` tiêu đề h1) và R3X
  (DS-X1, SEC-X1, PL-X1, PL-X2, WK-X1, OR-X1, WZ-X1, OR-X2).
- Repo Crew `d3cc389..r3x` (`c3f0f69`): 13 file (`apps/mac-app/src/main/jobs/{remove,executors,register,types,validate}.ts`,
  `utility/ops.ts`, test, docs flow).
- Đối chiếu với: plan R3X (Review Focus, Global Constraints, IX1–IX5, AX11), spec R3X §2–§10, các quyết định owner
  ("Đại Ca đã chốt" 07:35: Q1 bật sẵn hủy con, Q2 gỡ agent chỉ pause, Q3 giữ yêu cầu mở, Q5 giữ checkout bẩn, Q4 theo
  khuyên), và mọi dòng "tự quyết" trong ledger.

## Full suite (worktree chỉ đọc mới)

| Repo / bước | Kết quả |
|---|---|
| Fork `.worktrees/paperclip-r3x-rv` @ `0f58f38ac` (detached), `crew/release/verify.sh` | **XANH** (exit 0). `check-core-hooks`: hook một dòng 5/5, vá lõi 6, 15 mục, 0 lỗi (10 cảnh báo "chưa có PR upstream", như cũ). Test node: check-core-hooks 13/13, plugin-state 5/5, policy-config 10/10, upgrade/compose/pull-backup 18/18. Server crew 25 file / 508 test. Adapter claude-local 3 file / 17 test. Plugin 44 file / 325 test. `crew/agents` 104/104. `tsc` server, adapter, plugin: 0 lỗi. Plugin build, UI bundle không có `require("react")` trần |
| Fork `@crew/paperclip-web` | test 113 file / 858 test xanh (1 todo). `tsc -b --noEmit` 0 lỗi. `vite build` (CREW_UI_COMMIT=`0f58f38ac`) ok. `biome check src test` 397 file sạch |
| Repo Crew `.worktrees/crew-r3x-rv` @ `c3f0f69` (detached) | `pnpm install --frozen-lockfile --prefer-offline` ok. `crew-docs` build ok. `pnpm -r test`: docs-kit 43/43, crew-mac 963/963, mac-app 545/545 + node --test 24/24. `pnpm -r typecheck` ok. `pnpm lint` 326 file sạch |
| `ipcs -m` | Trước: 1 segment (`65536`, PID 3066, có từ trước). Sau: vẫn `65536` cộng `69337089` của Postgres T1 của E2E-X1 (PID 83013, `.worktrees/paperclip-r3-e2e`, cổng 54329). Không rò segment nào từ RV-X. Không đụng stack 3199 |

34 dòng lỗi `tsc` crew-plugin mà DS-X1 nghi ngờ (ledger 09:05) không còn khi đã build plugin-sdk: đúng là do worktree
thiếu bản build.

## AX11 Lõi: ĐẠT

- `check-core-hooks.mjs` 5/5, `base` = `v2026.1005.0` (`crew/release/core-hooks.json:3`).
- Trong lõi, diff fork chỉ chạm `server/src/crew/issue-gate.ts` (+10/−1, thân H2) và
  `server/src/__tests__/crew-issue-gate.db.test.ts`. `core-hooks.json` chỉ đổi `description` của H2; `anchor`, `head`,
  `file` giữ nguyên. Phần còn lại nằm trong `packages/crew-plugin/**`, `packages/crew-web/**`, `crew/ops/**`. Không
  chạm `packages/plugins`, `packages/shared`, `packages/adapters`, `ui/`.

## Soi các điểm được yêu cầu

| Điểm | Kết quả | Bằng chứng |
|---|---|---|
| Environment không bao giờ `DELETE` | Đạt | `endpoints.ts` không có `DELETE` nào tới `/environments`, `/projects/:id`, `/agents/:id`. `environments.archive` = `PATCH {status:'archived'}` (`api/paperclip/environments.ts:10-11`). `exclusiveEnvironments` chỉ chọn environment checkout `<khóa>-<ô>` ở `~/crew-agents/<khóa>/<ô>`, đang `active`, không agent nào ngoài phạm vi (chưa terminated) dùng (`features/wizards/remove/exclusive-environments.ts:27-64`) |
| Không terminate agent | Đạt | Không có lời gọi `terminate` hay xóa agent trong `crew-web/src` và `crew-plugin/src`. Gỡ dùng `POST /agents/:id/pause` (`remove-project.ts` bước `pause-agents`, `remove-agent.ts` bước `pause-agent`) |
| Checkout không xóa cưỡng bức, `realpath` + symlink | Đạt | `apps/mac-app/src/main/jobs/remove.ts`: `lstat` symlink hoặc `realpath ≠ checkoutPath(realHome)` → `kept not_worktree`; `show-toplevel` phải là chính thư mục đó; `git-dir ≠ git-common-dir`; `lsof -t +D` (mã khác 0/1 → giữ `busy`); `git status --porcelain` rỗng; HEAD tách rời có commit lạc → giữ `dirty`; `git --git-dir <common> worktree remove <path>` không `--force`. Không `prune`, không xóa nhánh. `rmdir` chỉ khi thư mục khóa rỗng và là thư mục thật |
| skill-remove không chạm Superpowers | Đạt | `removeSkill` (`remove.ts`): `slug` phải khớp `^[a-z0-9][a-z0-9-]{0,63}$` ở cả hai phía; `realpath` phải đúng `realHome/.crew/skills/<companyId>/<slug>`, không thì `folder_forbidden`; `rmSync` không đi theo symlink bên trong. Web: khối "Skill ghim" không có nút; sửa `name:` hay fork thành tên trùng Superpowers đều bị chặn (`frontmatter.ts`, `fork-skill-dialog.tsx:56`) |
| Route force-done chỉ board | Đạt | Manifest `auth: "board"` (`manifest.ts`, route `issues.force-done`); host `assertBoard` (`server/src/routes/plugins.ts:636-640`); handler kiểm lại `actorType !== "user"` → 403 `board_only` (`issues/force-done.ts`) |
| H2 chỉ đổi thân | Đạt | `issue-gate.ts:536-540`: chỉ khi `override`, đang vào `done` và patch chưa có `executionState` thì đặt `null`. 5 ca mới trong `crew-issue-gate.db.test.ts` (chờ stage agent, chờ owner duyệt mà không thành Duyệt, chưa vào stage, patch có sẵn `executionState`, agent bị `crew_gate_blocked`); 508 test crew server xanh |
| Agent không gọi được route mới | Đạt (theo code) | `issues.force-done`, `setup.*`, `jobs.*`, `roles.*` đều `auth: "board"`. Skill write dùng rule `crew-deny-agent-skill-writes`, không đổi. Ca âm thật để E2E-X1/AC-X |
| 2 quyền mới và `upgrade_pending` | **Nhận định của PL-X2 sai**, xem m1 | — |
| Migration 0011 an toàn, lui image được | Đạt | Xem mục dưới |
| Hợp đồng plugin ↔ web ↔ app | Đạt | `kind`, payload và result của `remove-checkouts` và `skill-remove` khớp nhau ở cả ba nơi. `setup.create` nhận id project trong `input`, không ở cấp trên cùng (WZ-X1 đã sửa client). Route force-done khớp `{companyId, reason}` |
| Câu lỗi validate app và plugin | Khớp | Cùng câu: `projectId phải là uuid`, `projectKey không hợp lệ`, `roles phải là mảng`, `role không hợp lệ`, `roles phải có 1 đến 5 vai trò`, `role <x> bị trùng`, `removeStatusRepo phải là boolean`, `skillId phải là uuid`, `slug không hợp lệ`. Cùng `SLUG` và `KEY_RE`. Chỉ khác thứ tự kiểm: app kiểm `removeStatusRepo` trước `projectKey`, nên payload sai nhiều chỗ có thể báo câu đầu tiên khác nhau. Không ảnh hưởng gì |
| Lưu skill không kiểm phiên bản | Đúng như ledger | Server không có `baseHash`. UI chỉ bắt 409 nếu server trả; thực tế người lưu sau thắng (m7) |

### Migration 0011 với dữ liệu prod

- Bỏ rồi thêm lại CHECK `kind` của hai bảng. Tập mới chứa trọn tập cũ, nên mọi dòng prod hiện có đều qua kiểm.
  0009 đã dùng cùng cách và chạy được trên prod. Tên constraint đã được PL-X1 chốt bằng `pg_constraint`.
- Hai chỉ mục duy nhất một phần chỉ lọc `kind IN ('remove-project','remove-agent')`. Prod chưa có dòng nào thuộc hai
  `kind` này, nên tạo chỉ mục không thể trùng.
- Test chạy qua chính `pluginDatabaseService` của host (`src/__tests__/plugin-host-db.ts:6`), áp 0011 lên DB đã có dữ
  liệu 0001–0010.
- **Lui image được.** Bộ chạy migration chỉ duyệt các file có trong thư mục migration
  (`server/src/services/plugin-database.ts:483-523`), không đòi mọi migration đã áp phải còn file. Plugin cũ chỉ ghi
  `kind` cũ, mà CHECK mới đã gồm các `kind` cũ, nên vẫn chạy. Chỉ có dòng `kind` mới tạo sau deploy là plugin cũ không
  đọc được: `setup.begin` của run gỡ sẽ lỗi 500 (`SETUP_STEPS[kind]` không có), còn việc máy `kind` mới thì không nộp
  được kết quả. Mức độ chấp nhận được với một lần rollback. Nên ghi vào thủ tục rollback: "lần gỡ đang dở để sau khi
  deploy lại".

## Phát hiện

### Blocker

Không có.

### Major

**M1. Bật "Hủy luôn con" làm route stock đánh thức assignee của chính yêu cầu đang bị Ép Done**

- **Vị trí:** `packages/crew-web/src/features/issues/detail/crew/force-done.ts:107-113`. Gói sở hữu: `work`.
- **Cơ chế:**
  1. `runForceDone` hủy từng con bằng `PATCH` stock, rồi mới hủy run và gọi route.
  2. Khi hủy con mở cuối cùng, route stock thấy `becameTerminal && issue.parentId` và gọi
     `getWakeableParentAfterChildCompletion` (`server/src/routes/issues.ts:14796-14845`). Lúc đó cha vẫn đang mở, nên
     route đánh thức `assigneeAgentId` của cha với `issue_children_completed`. `cancelled` cũng được tính
     (`services/issues.ts:9140`).
  3. Wakeup chạy kiểu fire-and-forget sau response (`routes/issues.ts:14849-14851`), nên rất dễ lọt qua
     `listActiveRuns` ở bước kế.
- **Kịch bản:**
  - Issue đang chờ stage review của agent, có 2 con mở. Owner Ép Done với ô "Hủy luôn" bật sẵn (mặc định theo Q1).
    Hủy con thứ hai thì reviewer được đánh thức, và một `heartbeat_runs` mới của reviewer được tạo ngay quanh lúc ép.
  - Với gốc do Trợ Lý giữ, Trợ Lý được đánh thức trên một yêu cầu sắp `done`.
  - Kết quả: tốn quota, đi ngược ý Q1, và trái AX1 ("không có run mới nào… sau thời điểm bấm") cũng như mục tiêu của
    AX2.
- **Đề xuất:**
  - Đổi thứ tự thành: đọc lại issue → hủy run của issue → route force-done → hủy con chưa xong. Khi cha đã `done`,
    `getWakeableParentAfterChildCompletion` trả `null` (trừ `onboarding_first_task`), nên không còn wakeup.
  - Lỗi khi hủy con sau route vẫn hiện trong dialog: yêu cầu đã đóng, bấm lại thì `stale`. Cần thêm nút "Hủy các con
    còn lại", hoặc hiện danh sách con chưa hủy.
  - Sửa test `force-done.test.ts` (thứ tự gọi). Spec §4.1 bước 4–6 cũng đổi thứ tự theo.
  - AC-X kiểm bằng `heartbeat_runs`/`agent_wakeup_requests` sau mốc bấm.

### Minor

**m1. Ghi chú deploy về `upgrade_pending` sai (ledger 09:15, PL-X2 và Trợ Lý)**

- **Gói:** `ops` (DP-X1) và ledger.
- PL-X2 dẫn `plugin-lifecycle.ts:672-681`, nhưng đường đó là `upgradePlugin`, mà deploy không đi qua. Plugin
  `crew.core` cài theo đường local. Khi activate, `refreshPluginManifestFromPackage` ghi manifest mới mà không đòi
  duyệt (`server/src/services/plugin-loader.ts:1386-1413`). Chặn capability mới chỉ áp cho plugin distribution: guard
  `return` sớm ở `distribution-plugin-catalog.ts:73`.
- Thực tế prod khớp với điều này: R2-2 DP-1 (thêm 4 quyền) và R3 DP-1 (thêm 3 quyền) đều về `ready`, không vào
  `upgrade_pending` (ledger R2-2 00:33, ledger R3 07:01).
- **Đề xuất cho DP-X1:**
  - Chờ `plugin-state.sh` = `healthy`, và `GET /plugins/crew.core` có đủ `issues.wakeup` và
    `issue.comments.create_human_attributed` (28 capability) cùng route `issues.force-done`.
  - Nếu gặp `upgrade_pending` thì dừng và báo owner. Không tự duyệt (luật R2-2 fork.md:227). Bỏ câu "phải duyệt ngay
    trong deploy".
  - Trong lúc plugin chưa `ready`, mọi route `crew.core` trả 503 (`routes/plugins.ts:1845-1848`).

**m2. Agent đã gỡ chưa bị ẩn khỏi các hộp chọn agent**

- **Gói:** `org`.
- Spec §4.5 ghi "mặc định ẩn khỏi danh sách và mọi hộp chọn agent". Nhưng `removalState` chỉ được dùng ở
  `features/agents/list/agents-page.tsx` và các nút gỡ. Form vai trò (`projects/detail/roles-form.tsx`), hộp chọn
  assignee và wizard vẫn hiện agent đã gỡ (trạng thái `paused`).
- **Kịch bản:** owner gán vai trò hoặc giao việc cho một agent đã gỡ. Agent không chạy vì đang pause, và việc nằm im.
- **Đề xuất:** lọc thêm bằng `removalState(...).status === 'removed'` ở các hộp chọn, hoặc ghi rõ là để R3 sau.

**m3. Lịch sử có thêm 2 dòng khó hiểu sau mỗi lần Ép Done**

- **Vị trí:** `features/issues/detail/history-format.ts:120-129`. Gói: `work`.
- Host ghi `issue.updated` của plugin với `details.patch.status` và `_previous`, không có `details.status`
  (`plugin-host-services.ts:1970-1983`). Vì vậy dòng đó chỉ hiện "Cập nhật", không hiện "từ X sang Done".
- Comment của plugin có action `issue.comment.created` (khác `issue.comment_added` của route), nên dòng này hiện mã gốc.
- Cả hai dòng đều đứng tên "Crew" (`actorType` = `plugin`).
- **Đề xuất:**
  - Đọc thêm `details.patch.status`.
  - Map `issue.comment.created` sang `commentAdded`.
  - Với bản ghi plugin có `initiatingUserId` thì hiện người đó.

**m4. Đánh thức cha trong route lệch luật của stock**

- **Vị trí:** `packages/crew-plugin/src/issues/force-done.ts:86-107`. Gói: `plugin`.
- Stock bỏ qua cha có `conversationAgentId` (`services/issues.ts:9140`); plugin không kiểm điều này.
- Host `requestWakeup` ném lỗi khi cha còn blocker chưa xong (`plugin-host-services.ts:2174-2177`). Lỗi đó thành cảnh
  báo `wakeup_failed` hiện cho owner, dù đây là trường hợp bình thường.
- **Đề xuất:** bỏ qua cha có `conversationAgentId`; coi "blocked by unresolved blockers" là không đánh thức, không phải
  lỗi.

**m5. Run gỡ không bỏ được, và máy của run cố định**

- **Vị trí:** `setup/data.ts` (`abandonSetupRun` chỉ cho `add-project`), chỉ mục 0011. Gói: `plugin` và `wizards`.
- Một lần gỡ `failed` mà máy đã bị thu hồi hoặc không còn app thì kẹt mãi ở trạng thái "Chạy tiếp". Chỉ mục duy nhất
  cũng chặn mọi lần gỡ mới của project hay agent đó.
- **Đề xuất:** cho phép bỏ run gỡ khi bước máy chưa xong, hoặc đổi máy của run. Trước mắt ghi vào Hướng dẫn.

**m6. `git worktree remove` không `--force` vẫn xóa tệp bị ignore**

- **Vị trí:** `apps/mac-app/src/main/jobs/remove.ts` (luồng `removeOne`). Gói: `mac`.
- `git status --porcelain` không liệt kê tệp bị ignore, mà `worktree remove` thì xóa chúng.
- **Kịch bản:** `.env.local`, dữ liệu cục bộ hay cache build owner tự đặt trong checkout agent sẽ mất mà không báo.
- Đúng với spec (tiêu chí là "không có việc chưa commit"), nhưng nên nói rõ.
- **Đề xuất:** thêm một câu vào dialog Gỡ và vào Hướng dẫn. Tùy chọn: báo số tệp ignore (`status --porcelain
  --ignored`) trong kết quả để owner biết.

**m7. Lưu file skill không kiểm phiên bản (người lưu sau thắng)**

- **Gói:** `org`.
- Đã ghi cho owner (ledger 09:21). Server không có `baseHash`.
- Rủi ro thấp vì chỉ có owner sửa. Giữ như đã ghi, nêu trong Hướng dẫn mục 11 nếu chưa có.

**m8. Lệnh tự gỡ hiện trên trang tiến độ chạy sai chỗ**

- **Vị trí:** `features/wizards/remove/remove-pages.tsx:16`. Gói: `wizards`.
- Trang hiện `git worktree remove "<path>"`. Đã thử: chạy lệnh này từ thư mục ngoài repo thì báo
  `fatal: not a git repository` (mã 128). Chạy từ trong worktree thì được.
- **Đề xuất:** đổi thành `git -C "<path>" worktree remove "<path>"`.

**m9. Có thể hủy cả con mà owner không nhìn thấy trong dialog**

- **Vị trí:** `force-done-dialog.tsx:53,96`, `force-done.ts:107-109`. Gói: `work`.
- Ô "Hủy luôn" luôn được đặt `true` khi mở dialog, kể cả lúc không có con nào để hiện (ô ẩn đi). `runForceDone` đọc
  lại danh sách con mới nhất rồi hủy hết.
- **Kịch bản:** một con được tạo sau khi trang tải sẽ bị hủy, dù owner chưa từng thấy nó.
- **Đề xuất:** chỉ hủy những id đã hiện trong dialog. Hoặc khi danh sách mới khác danh sách đã hiện thì dừng và báo.

## Phán xét các dòng "tự quyết" trong ledger

| Ledger | Quyết định | Phán xét |
|---|---|---|
| 09:05 DS-X1 | Chữ ký IX5 theo route thật: không có `api.skills.files`, `update` không có `name`, tách `api.skillSources` | Đồng ý (đúng route server) |
| 09:05 DS-X1 | Sửa 1 dòng `readiness/compute.ts` ngoài gói `ds` | Đồng ý (chỉ kiểu, không đổi hành vi) |
| 09:07 SEC-X1 | `has()` coi `executionState: undefined` là chưa đặt | Đồng ý, nhất quán với cả H2 |
| 09:08 PL-X1 | Thêm 2 chỉ mục duy nhất một phần chống hai tab tạo hai run gỡ | Đồng ý. An toàn trên prod; hệ quả ở m5 |
| 09:08 PL-X1 | Run gỡ không `abandon` được; `finish` chỉ nhận `projectId` ở add-project; khóa `agent-<8 hex>` | Đồng ý có lưu ý (m5) |
| 09:08 PL-X1 | Bỏ key lạ trong kết quả; `detail` rỗng sau làm sạch thì bỏ | Đồng ý |
| 09:09 MC-X1 | `lsof -t +D` thay `+d`; không tin mã thoát | Đồng ý (chặt hơn; quá giờ hay lỗi thì giữ `busy`) |
| 09:09 MC-X1 | Không `worktree prune` | Đồng ý. `worktree remove` tự dọn mục của nó; `prune` chạm cả worktree khác của owner |
| 09:09 MC-X1 | Giữ `dirty` khi HEAD tách rời có commit lạc | Đồng ý (an toàn hơn spec) |
| 09:09 MC-X1 | Câu lỗi validate app | Đồng ý. Plugin dùng cùng câu (đã đối chiếu) |
| 09:11–09:12 PL-X2 | Body chặt (`body_invalid`); `violations` luôn `[]` kèm `violations_unread`; activity đứng tên plugin, có `actorUserId`; routeKey `issues.force-done` | Đồng ý. Lệch spec §4.1 có lý do (host không cho plugin đọc activity; schema routeKey chữ thường) |
| 09:15 PL-X2 | Chỉ tính con trực tiếp; bỏ qua cha `backlog/done/cancelled` | Đồng ý có lưu ý (m4) |
| 09:15 PL-X2 / Trợ Lý | "2 quyền mới → `upgrade_pending`, phải duyệt ngay trong deploy" | **Không đồng ý** (m1). Prod cài theo đường local, plugin về `ready` |
| 09:18–09:19 WK-X1 / Trợ Lý | Ẩn 4 action đọc/hộp thư; nút hiện cho mọi phiên (chỉ có board); gộp theo `details.actorUserId` trong 5 giây | Đồng ý |
| 09:18 WK-X1 | Thứ tự hủy con → hủy run → route (theo spec) | **Không đồng ý** (M1). Đổi thứ tự |
| 09:20–09:21 OR-X1 / Trợ Lý | Không có kiểm phiên bản khi lưu; 422 thì gỡ lại agent rồi thử một lần; 404 coi như đã xóa; Q4 ghép ba lối; fork xếp `skill-sync` | Đồng ý (m7 chỉ là ghi chú) |
| 09:23 WZ-X1 | Sửa client `setup.create`; thêm `roles.delete` và `api.roles.remove`; thêm `SetupStepId` `checkout` | Đồng ý (vá chỗ thiếu của DS-X1) |
| 09:23 WZ-X1 | Chỉ archive environment checkout `<khóa>-<ô>` không ai ngoài phạm vi dùng; gỡ checkout cả 5 ô của khóa | Đồng ý (chặt hơn spec; ô không có thì `absent`) |
| 09:23 WZ-X1 | Agent đã gỡ mà owner chạy lại tay (không còn paused) thì về `none` | Đồng ý |
| 09:28 OR-X2 | Bộ lọc "Đã gỡ" chỉ ở danh sách agent và project; Hướng dẫn 6.1/10.1/11 | Đồng ý có thiếu (m2) |
| FX-NHO | Overlay cho `ui/`; audit chỉ quét company Crew đã lưu; `multiCompanyConfig: true`; tiêu đề h1 | Đồng ý. SDK có `multiCompanyConfig` (`define-plugin.ts:264`, `worker-rpc-host.ts:1828`) |

## Ghi chú cho các bước sau

- **DP-X1:**
  - Plugin (migration 0011) trước, app sau.
  - Kiểm `plugin_migrations` có `0011_removal_kinds.sql` applied, và có 2 chỉ mục
    `crew_setup_runs_active_remove_{project,agent}_idx`.
  - Kiểm manifest đủ 2 quyền mới. Kiểm `GET /` mốc `crew-ui`.
  - Cửa sổ trước DP-X2: app cũ nhận việc `kind` mới sẽ `failed app_error`. Đừng thử gỡ hay xóa skill trong lúc này.
- **AC-X:**
  - AX1(a)(b) và AX2 kiểm `heartbeat_runs` của reviewer/Trợ Lý sau mốc bấm (M1).
  - AX7: đọc kết quả `kept` và nhánh còn.
  - AX5: refresh nguồn thật.
- **Worktree review để lại** (chỉ đọc, detached; Trợ Lý tự gỡ khi cần, không có tiến trình nền nào còn chạy):
  - `~/Documents/projects/crew/.worktrees/paperclip-r3x-rv`
  - `~/Documents/projects/crew/.worktrees/crew-r3x-rv`

Status: DONE_WITH_CONCERNS
Summary: R3X đạt có điều kiện: 0 Blocker, 1 Major, 9 Minor; full suite hai repo xanh, AX11 đạt.
Concerns/Blockers: M1 (bật "Hủy luôn con" khiến route stock đánh thức assignee của yêu cầu đang bị ép; phải đổi thứ tự trước deploy). m1 (DP-X1 phải chờ `ready` chứ không chờ `upgrade_pending`, không tự duyệt).
