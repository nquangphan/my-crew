# DP-1 Phòng Marketing: deploy `crew/guest-approval` @ `33d7e2242` và nghiệm thu

- Thời gian: 11/10/2026 11:30 → 12:27 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent opus.
- Kết quả: **DONE_WITH_CONCERNS.**
  - Prod chạy `crew-v3/paperclip:v3-33d7e2242`. Plugin `crew.core` ready, migration 0013 đã áp.
  - Đã tạo 2 tài khoản Phòng Marketing bằng luồng mời thật:
    - `anh.pham@2p-solutions.com` ở **2P Solutions**;
    - `e2e-marketing@crew-e2e.local` ở **Crew E2E**.
  - Đăng ký chỉ mở **2 phút 14 giây** (12:05:23 → 12:07:37). Compose đã khôi phục đúng từng byte, đăng ký lại trả 400.
  - AC1–AC12 đều đạt (mục 6).
  - Đã gắn tag annotated cục bộ `crew/v3.4` trên `33d7e2242`. Chưa push.
  - Concern ở mục 8.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-38580c5d7` (tag `crew/v3.3`) |
| Image sau | `crew-v3/paperclip:v3-33d7e2242` (tag `crew/v3.4`) |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261011-113833`, đưa về `v3-38580c5d7`. Không cần gỡ 0013: bảng chỉ được thêm, bản cũ không đọc tới |
| Backup DB | `20261011-1137` (làm tay trước deploy, 37M, builtin ok) và `20261011-1138` (`deploy.sh` tự tạo, 37M, builtin ok) |
| Backup compose | `docker-compose.yml.bak-signup-20261011-120452` (trước khi mở đăng ký, sha256 `339f814064df1de8…`). Compose hiện tại trùng từng byte với bản này (`cmp` ok). Bản `deploy.sh` tạo: `docker-compose.yml.bak-20261011-113833` |
| `.env` VPS | Bản sao trước khi thêm biến e2e: `.env.bak-dp1-ga` (600 root). `.env` hiện có thêm 2 dòng `CREW_E2E_CONTRIBUTOR_EMAIL` và `CREW_E2E_CONTRIBUTOR_PASSWORD`, quyền vẫn 600 root |
| Script ops VPS | Không đổi. 22 file `ops/*` trên VPS trùng sha256 với fork |

## 1. Cổng kiểm

Worktree `.worktrees/paperclip-r3-dp` chạy `git checkout --detach crew/guest-approval`, ra `33d7e2242`, sạch.

`crew/release/verify.sh` FULL chạy 11:33:01 → 11:36:22, rc 0, **XANH**:

| Mục | Kết quả |
|---|---|
| check-core-hooks | `Hook một dòng: 5/5; vá lõi: 8; mục: 20; lỗi: 0` |
| Test vá (core-hooks, plugin-state, policy-config, upgrade, compose, pull-backup) | 0 fail |
| Server crew | 684 test / 33 file, gồm `crew-contributions.db`, `crew-contributions-agent-blind`, `crew-plugin-data-viewer`, `crew-viewer-write-matrix` |
| Adapter claude / codex / opencode | 17 / 10 / 12 |
| Plugin | 434 test / 53 file |
| Agents | xanh |
| tsc (server, 3 adapter, plugin) | 0 lỗi |
| Bundle plugin | không có `require("react")` trần |

Kiểm thêm:
- ops `node --test crew/ops/*.test.mjs`: 75/75.
- crew-web:
  - `test`: 135 file, 1125 pass, 1 todo;
  - `typecheck`: sạch;
  - `lint` (biome): 505 file sạch;
  - `build`: chạy trong `overlay-source.sh`, mốc `crew-ui` đúng commit.
- `ipcs -m` trước và sau giống nhau.

## 2. Deploy

1. **Chuẩn bị.**
   - `active-runs.sh` rỗng.
   - Backup `20261011-1137` ok.
   - DB (chỉ đọc):
     - Postgres 17.11;
     - board là `owner` `active` ở Crew E2E, 2P Solutions và Crew Spike Policy;
     - có `crew_project_roles` trong namespace `plugin_crew_core_0433ea20b6`.
2. **overlay-source** `33d7e2242`: 31 file server, tarball 164 mục.
   - Có `0013_contributions.sql`.
   - Có `server/src/crew/{contributions,contribution-routes,plugin-data-scope}.ts`, `app.ts` và `routes/plugins.ts`.
3. **Build.** `overlay-job.sh 33d7e2242`: `JOB_EXIT rc=0`, `min_avail=5331MiB`.
4. **inspect-image.sh trên VPS:** rc 0.
   - `crewCoreHooks` heartbeat 2, environment-runtime 2, issues 3.
   - Đủ 12 file crew, `plugin events delivered as call ok`, `crew-ui=33d7e2242…`.
   - Vá adapter P2–P7 ok.
   - Chỉ có `WARNING host adapter check SKIPPED`, đúng như mong đợi.
   - **inspect-image.sh không kiểm 3 file server mới** (`crew/contributions.js`, `crew/contribution-routes.js`, `crew/plugin-data-scope.js`). Em kiểm tay trong image:
     - đủ 3 file;
     - `app.js` có `crewContributionRoutes` 2 lần (C7);
     - `routes/plugins.js` có `crewViewerPluginDataScope` 2 lần (C8);
     - migrations tới `0013_contributions.sql`.
   - Theo chỉ đạo, em không sửa script ops.
   - **Manifest không thêm capability.** Bộ (version + capabilities) của image cũ và mới có cùng sha256 `d9906527…`.
5. **inspect-image.sh từ Mac** (`DOCKER_HOST=ssh://nhamoiplatform`, commit `33d7e2242`): 0 MISSING, FAIL hay WARN.
6. **Deploy.** `active-runs` rỗng. `deploy.sh crew-v3/paperclip:v3-33d7e2242` chạy 11:38:25 → 11:39:00, rc 0, in `deploy ok: … v3-38580c5d7 -> … v3-33d7e2242, rollback TS=20261011-113833`.

## 3. Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `ok`, commit `33d7e22428c9…`, databaseBackup ok |
| Plugin | `plugin-state.sh` trả `healthy`. Dòng `plugins` của `crew.core` là `ready`, không có `upgrade_pending` |
| Migration 0013 | `0013_contributions.sql` `applied` lúc 11:38:56 |
| Bảng mới | Có `crew_contributions` và `crew_contributors`. Ràng buộc `{kind_check,pkey,result_ck,shape_ck,status_check}`. Index `{author_idx,status_idx,target_idx}` |
| Site | Đều 200: crew `/` (mốc `crew-ui=33d7e2242…`), `/cli-auth/x`, `/paperclip/` (title Paperclip), `/paperclip/invite/x`, `2p-solutions.com`, `kidyschool.com` |
| `check-crew-companies.sh` | `ok 2 company` |
| Router mới, owner | `GET /access` 200 (`owner, canApprove true`); `summary` 200; `contributors` 200 ở cả Crew E2E và 2P Solutions |
| Log từ lúc deploy đến 12:27 | 0 token (`access_token`/`refresh_token`/`id_token`/`Bearer`/`sk-`). 0 `config.get`, `host refused`, `INVOCATION_SCOPE_DENIED`. **0 dòng chứa nội dung góp ý** (đã tìm tiêu đề và nội dung của các mục thử) |
| Log level 50 | 3 dòng "Legacy controller lease lost" lúc 12:19. Đây là run stub Crew E2E bị ca T2 hủy (90 phút qua chỉ có 13 run cancelled và 6 run succeeded, đều ở Crew E2E). Không có run nào của 2P Solutions |
| Sau mỗi lần recreate (mở hoặc đóng đăng ký) | health ok, plugin healthy, `CREW_POLICY_CONFIG=/crew-policy/crew-policy.json`, image vẫn `v3-33d7e2242` |

## 4. Mở đăng ký tạm và tạo tài khoản

**Lần đầu (11:40) thất bại.**
- `POST /api/auth/sign-up/email` trả `400 EMAIL_PASSWORD_SIGN_UP_DISABLED` (ảnh `01`).
- Nguyên nhân: `docker-compose.yml` dòng 34 đặt `PAPERCLIP_AUTH_DISABLE_SIGN_UP: "true"`.
- T0 chỉ đọc `.env` nên kết luận nhầm là "unset". Lần sau T0 phải kiểm bằng `printenv` trong container.
- Em đã thu hồi 2 lời mời thử dư và gỡ biến e2e khỏi `.env`.

**Owner chốt Q2: mở tạm rồi đóng.**

| Bước | Giờ | Ghi chú |
|---|---|---|
| Backup compose `docker-compose.yml.bak-signup-20261011-120452` | 12:04:52 | `active-runs` rỗng |
| Đổi dòng 34 thành `"false"`, `docker compose up -d --no-deps server` | → **12:05:23 đăng ký MỞ** (health ok) | `printenv` trả `false` |
| Tạo `anh.pham@2p-solutions.com` | 12:05:31 → 12:05:34 | sign-up 200, accept invite 202 |
| Tạo `e2e-marketing@crew-e2e.local` | 12:06:41 → 12:06:45 | sign-up 200, accept invite 202 |
| `cp -p` bản backup về `docker-compose.yml` (`cmp` trùng), recreate server | → **12:07:37 đăng ký ĐÓNG** (health ok) | `printenv` trả `true`. Gọi thử sign-up trả `400 EMAIL_PASSWORD_SIGN_UP_DISABLED` |

- Trong cửa sổ mở chỉ có đúng 2 user mới được tạo (kiểm bảng `user`).
- Cả hai lần recreate đều làm lúc 0 run.

**Luồng của mỗi tài khoản** (Playwright Node, trace tắt):
1. Owner bấm **Mời Phòng Marketing** ở trang Thành viên UI Crew. Link mời có dạng `…/paperclip/invite/[redacted]`.
2. Người mới mở link ở UI stock, chọn Create account, rồi trang tự gửi yêu cầu tham gia.
3. **Phát hiện:** server **tự duyệt** yêu cầu tham gia (`join_requests.status=approved` ngay lúc accept). Membership `viewer` `active` được tạo luôn, nên trang Thành viên không có dòng "chờ duyệt" để owner bấm. Spec §3.4 bước 4 giả định yêu cầu ở `pending_approval`. Xem concern 2.
4. Owner bấm **Đặt Phòng Marketing** trên dòng thành viên: `PUT …/contributors/:userId` 204, dòng đổi `data-role` từ `viewer` sang `contributor` (ảnh `04`, `08`).

**Mật khẩu:**
- `anh.pham`: đọc từ Keychain (`security … -w`) vào biến môi trường của process, không in, không ghi file.
- e2e: sinh bằng `openssl rand`, đi qua ssh stdin vào `.env`.
- Board: đọc từ `.env` VPS qua pipe.

**Kiểm bằng chính tài khoản `anh.pham`** (12:08):
- Đăng nhập 200.
- `GET /access` = `{membershipRole: viewer, contributor: true, canApprove: false}`.
- Thấy 5/5 project chưa gỡ của 2P Solutions (ảnh `06`).
- Sidebar chỉ có: Yêu cầu mới, Tìm kiếm, Tổng quan, Yêu cầu, Góp ý của tôi, Project, Docs, Cài đặt, Hướng dẫn. Không có Agent, Run, Máy, Skill, Hộp thư hay Thành viên.
- `/agents`, `/runs`, `/costs`, `/inbox`, `/machines`, `/skills`, `/members` đều chuyển về `/TPS/dashboard`.
- 0 phản hồi 403 khi duyệt trang.
- DB: viewer `active`, có dấu, dấu còn hiệu lực (`granted_at >= updated_at`).
- `crew_contributions` của 2P Solutions có **0 dòng**: không tạo góp ý nào ở company thật.

## 5. T2 (Playwright prod, Crew E2E, stub)

Mọi lượt T2 đều chạy với `CREW_E2E_BASE_KEY=e2e-base4`, vì khóa `e2e-base` đã gỡ. Global-setup đã dựng project nền "E2E base 5" (`782962c4…`) bằng wizard.

**Lượt chạy cuối** (12:08:26 → 12:22:38, có tài khoản khách): **77 passed, 2 failed, 18 skipped, 1 did not run.**

| Ca | Kết quả |
|---|---|
| PW-S20-1, 2, 3, 4, 5 | **Xanh** (lần đầu và lần retry đều xanh) |
| PW-S20-6 | **Đỏ do lỗi harness, không do sản phẩm.** Guard ghi prod `assertWriteAllowed` (`e2e/support/api.ts:28-53`) không có tiền tố `/api/crew/companies/<E2E>/`, nên chặn chính lệnh `contributorApi.post` của ca này trước khi gửi (222 ms). T1 không có guard nên xanh. Phần ca này kiểm, em đã làm tay (mục 6) |
| PW-S20-7 | Không chạy, vì chuỗi serial dừng sau S20-6. Đã làm tay (mục 6) |
| `no-dead-controls` `/machines` | **Có từ trước, không sửa** theo chỉ đạo. Nút "OpenCode trên Phans-Mac-mini.local" bị khóa mà không có lý do hiển thị. OpenCode đang khóa vì chưa có key. Trang Máy không đổi trong nhánh này |

- Mọi ca còn lại đều xanh, gồm `no-dead-controls` của `/contributions` và `/members`.
- `run-e2e.sh`: 4 trace đã quét, không chứa mật khẩu.

Hai lượt trước (để tham chiếu):
- 11:42: global-setup đỏ vì `e2e-base` đã gỡ. Không sinh gì.
- 11:47 (chưa có khách): 72 passed. S20-3 đỏ vì S20-1/2 bị skip.

## 6. Nghiệm thu AC1–AC12 (prod, Crew E2E)

Script tay chạy 12:24–12:25. Nó tạo 3 mục ở Crew E2E, dán nhãn rõ `PW-DP1 …`:
- 2 mục đã **từ chối** và để lại;
- 1 mục AC10 đã duyệt, issue `CRE-158` sinh ra đã được **hủy**.

| AC | Kết quả | Bằng chứng |
|---|---|---|
| AC1 mời, đăng ký, duyệt, hiện "Phòng Marketing" | **Đạt** (kèm concern 2) | Mục 4. DB có `viewer` `active` cùng dòng `crew_contributors` cho cả hai tài khoản. Dòng thành viên hiện `contributor` (ảnh `04`, `08`). Tay (S20-7): tạo lời mời có link `/paperclip/invite/`, thu hồi xong link bị xóa. Gỡ dấu thì `/access.contributor=false`, POST góp ý trả 403, dòng về `viewer`. Đặt lại thì `contributor=true` (ảnh `11`) |
| AC2 khách thấy mọi thứ, không nút ghi, không 403 | **Đạt** | Khách e2e duyệt dashboard, issues, projects, docs, contributions và một trang issue: 0 phản hồi 403. Trang issue có 0 nút "Gửi bình luận", "Ép Done", "Hủy yêu cầu"; có 1 nút "Gửi để owner duyệt". `anh.pham` trên 2P Solutions cũng 0 phản hồi 403 (mục 4) |
| AC3 khách gửi yêu cầu và bình luận, hai phía đều thấy "Chờ duyệt" | **Đạt** | PW-S20-1, 2, 3 xanh trên T2. Tay: tạo issue và comment đều trả 201 `pending` |
| AC4 lúc chờ, agent không thấy, không có wake | **Đạt** | PW-S20-1, 2 xanh (token agent không thấy qua 6 đường). DB `agent_wakeup_requests`: bình luận góp ý tạo lúc 12:16:51 không sinh wake nào, wake `mutation: comment` chỉ xuất hiện lúc duyệt (12:17:01) |
| AC5 chỉ owner duyệt hay từ chối được | **Đạt** | Khách gọi `approve`, `reject`, `PUT contributors` đều nhận 403 `crew_contribution_forbidden`. Test server (verify.sh) phủ admin, operator, agent, board key |
| AC6 duyệt bình luận ra bình luận owner, agent được đánh thức như board | **Đạt** | PW-S20-4 xanh. Lúc duyệt, `result_comment_id` `e7f75ebb` sinh wake `source automation, mutation comment, commentId e7f75ebb` cho người nhận, đúng đường stock của board. Wake bị `skipped` chỉ vì agent giữ chỗ tắt `wakeOnDemand` |
| AC7 duyệt yêu cầu ra issue thật, có policy Crew, người nhận theo lựa chọn | **Đạt** | PW-S20-5 xanh. `CRE-118` và `CRE-120` (từ góp ý đã duyệt) có `execution_policy` khác null, có assignee, `created_by_user_id` là owner |
| AC8 từ chối giữ mục, nhãn "Bị từ chối", agent không thấy | **Đạt** | Tay: owner bấm Từ chối trên UI cho cả 2 mục. API owner trả `comment:rejected, issue:rejected`. Khách ở tab Bị từ chối thấy dòng `data-status=rejected`, nhãn "Bị từ chối", 0 nút (ảnh `10`). Lõi có 0 issue và 0 comment mang dấu của mục. Ca T2 tương ứng đỏ do harness |
| AC9 khách ghi thẳng lõi thì 403 | **Đạt** | PATCH status, PATCH assignee, PATCH title, DELETE, POST comments, POST issues đều 403. Checkout với body hợp lệ cũng 403 `Viewer access is read-only` (body thiếu thì 400 ở bước validate trước) |
| AC10 duyệt đứt giữa chừng không trùng | **Đạt** | Tay: approve (`approving`, khóa `crew-contribution:<id>`), POST issue stock trả 201 `CRE-158`, **không gọi complete**. Lần đọc danh sách sau đó tự lành thành `approved`, `resultIssueId` khớp. Đăng lại cùng khóa trả 200 cùng issue, lõi chỉ có 1 issue. Test server tự lành cũng xanh |
| AC11 UI stock không hiện mục chờ hay bị từ chối | **Đạt** | Lúc có mục chờ, `/paperclip/CRE/issues` không chứa tiêu đề chờ, `/paperclip/CRE/issues/CRE-119` không chứa bình luận chờ (ảnh `09`). Tìm trong lõi theo dấu ra 0 |
| AC12 hook 5/5, vá lõi 8, lỗi 0, typecheck và test xanh | **Đạt** | Mục 1 |

## 7. Quyền của agent visinote, business-app và nguyên nhân

**Đã sửa** (12:08:36 → 12:08:41): chạy `agent-permissions.sh 5befeb1a… --assistant 6c27410e-7a14-4439-9e07-cbbfa2a743fd` (không `--check`), rc 0. Script áp cho **8** agent tạo lúc 11:18 bởi Phan Nhật Quang (`nquangphan@gmail.com`, owner 2P Solutions):
- 4 agent `visinote-*`;
- 4 agent `business-app-*`, cùng lúc, cùng cách tạo. Lần `--check` đầu chỉ in 15 dòng cuối nên em chưa thấy nhóm này.

Sau khi sửa:
- tạo-agent và tạo-skill đều off;
- `tasks:assign` chỉ còn on ở `visinote-assistant` và `business-app-assistant` (Trợ Lý của project);
- chạy lại `--check` cho TPS: rc 0, `--all-crew --check`: rc 0.

**Nguyên nhân (chỉ đọc, không sửa code):**
- Hai project `business-app` và `visinote` được tạo bằng luồng **Thêm project của app Mac** (`apps/mac-app/src/main/projects/add-project.ts`, đọc ở worktree `crew-r3-dp2`, nhánh `r24`). Không có dòng `crew_setup_runs` nào, tức không qua wizard web. Activity cho mỗi agent chỉ có `agent.created` → `agent.paused` → `agent.files_updated` (AGENTS.md), rồi `agent.resumed` lúc 11:35.
- `client.createAgent` (`apps/mac-app/src/main/paperclip/client.ts:270-297`) gọi stock `POST /api/companies/:id/agents` mà body không có `permissions`.
- Sau đó app **không gọi** `PATCH /api/agents/:id/permissions`.
- Paperclip tự cấp quyền mặc định khi tạo agent (`server/src/services/agent-permissions.ts`, ngữ cảnh "create"): bật tạo agent, tạo skill và `tasks:assign`.
- Wizard web thì có riêng một bước đặt lại quyền (`packages/crew-web/src/features/wizards/add-project/run-step.ts:97`). App Mac thiếu bước tương đương.
- Cần một FX cho app Mac: sau `createAgent`, PATCH permissions như wizard web (`canCreateAgents=false`, `canCreateSkills=false`, `canAssignTasks` chỉ cho assistant). Hoặc chạy `agent-permissions.sh` sau mỗi lần thêm project.

## 8. Concern

1. **Harness T2 chặn route Crew mới.** `assertWriteAllowed` trong `e2e/support/api.ts` thiếu `/api/crew/companies/<E2E>/`, nên PW-S20-6 đỏ và PW-S20-7 không chạy trên T2.
   - Cần FX test: cho phép tiền tố đó khi có id Crew E2E.
   - Em đã làm tay toàn bộ phần hai ca này kiểm (AC1, AC8, AC9).
2. **Yêu cầu tham gia được server tự duyệt.** Lời mời Phòng Marketing (`humanRole: viewer`) cấp membership `viewer` `active` ngay khi người nhận accept. Owner không cần duyệt, khác spec §3.4 bước 4.
   - Rủi ro thấp: link chỉ dùng được một lần, người vào chỉ là viewer thuần (chỉ xem) cho tới khi owner đặt dấu, và hiện đăng ký đang đóng.
   - Nhưng ai cầm link mời mà đã có tài khoản thì vào xem được ngay.
   - Spec và trang Thành viên cần ghi đúng hành vi này. Nếu owner muốn bắt buộc duyệt thì phải xem lại cấu hình invite.
3. **T0 đọc sai trạng thái đăng ký**, vì cờ nằm trong compose chứ không ở `.env`. Hiện đăng ký đã **đóng** lại. Mời thêm khách mới sau này phải mở tạm lại như mục 4, hoặc dùng tài khoản đã có.
4. **Công tắc OpenCode ở `/machines`** khóa mà không có lý do (`no-dead-controls` đỏ). Lỗi có từ trước, chưa sửa theo chỉ đạo.
5. **`inspect-image.sh` thiếu 3 file server mới** (`crew/contributions.js`, `crew/contribution-routes.js`, `crew/plugin-data-scope.js`). Lần này em kiểm tay. Không sửa script theo chỉ đạo.
6. **App Mac thêm project không hạ quyền agent** (mục 7). Đã sửa dữ liệu cho 8 agent, còn code app chưa sửa.
7. **Nhỏ, ngoài phạm vi.** Trang Project của khách hiện "Chưa sẵn sàng" cho mọi project Crew (ảnh `06`). Có thể vì viewer không đọc đủ dữ liệu readiness. Chỉ là nhãn hiển thị, không chặn gì. Nên ẩn cột Sẵn sàng với viewer.
8. **T2 lượt sau** phải đặt `CREW_E2E_BASE_KEY=e2e-base4`.

## 9. Tag

```
git tag -a crew/v3.4 33d7e22428c9f1dcf07add10a93418ed56a04b93 \
  -m "Crew v3.4: Phòng Marketing (khách góp ý chờ owner duyệt), đã nghiệm thu AC1–AC12 trên prod"
```

`git cat-file -t crew/v3.4` trả `tag`, và `crew/v3.4^{commit}` trỏ `33d7e22428c9…`, đúng commit đang chạy trên prod. Tag chưa push.

## Dọn và an toàn

- Không in mật khẩu nào. Biến `.env` e2e đi qua stdin. Mật khẩu Keychain chỉ nằm trong biến môi trường của process.
- Ảnh `dp1-shots/01–11` có ô mật khẩu bị che.
- 2 lời mời thử dư lúc 11:40 đã thu hồi. Lời mời của S20-7 làm tay cũng đã thu hồi. Crew E2E còn 0 lời mời hiệu lực.
- Mục góp ý để lại, đều ở Crew E2E:
  - 4 mục `approved` của T2, issue sinh ra đã hủy;
  - 2 mục `rejected` (`PW-DP1 thử (sẽ từ chối) …`);
  - 1 mục `approved` của AC10 (`CRE-158` đã hủy).
- 2P Solutions: 0 mục góp ý. Chỉ có thao tác mời và đặt dấu cho `anh.pham`, cùng sửa quyền 8 agent theo lệnh owner.
- `active-runs` rỗng lúc kết thúc. Không còn process nền nào (Playwright, vitest). Worktree `paperclip-r3-dp` đang detached `33d7e2242`, sạch.
- Script dùng lại nằm ở scratchpad phiên (`ga/*.mjs`). Không sửa code, không commit, không push.

Status: DONE_WITH_CONCERNS
Summary: Prod đã chạy crew-v3/paperclip:v3-33d7e2242 (rollback: `ops/rollback.sh 20261011-113833` về v3-38580c5d7), plugin ready, 0013 đã áp. Đã tạo `anh.pham@2p-solutions.com` (2P Solutions) và tài khoản e2e (Crew E2E) bằng luồng mời; đăng ký mở 12:05:23 → 12:07:37 rồi đóng lại đúng từng byte (sign-up trả 400). AC1–AC12 đạt; đã sửa quyền 8 agent visinote và business-app; tag crew/v3.4 cục bộ.
