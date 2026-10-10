# AC-X R3X: nghiệm thu T2 trên prod `v3-c55a16a0c`, company Crew E2E

- Thời gian: 2026-10-10 10:45 → 11:15 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent opus.
- Môi trường: prod `crew-v3/paperclip:v3-c55a16a0c`, plugin `crew.core` ready; app 2P Crew `r3x` @ `b827114` trên Mac
  mini. Company **Crew E2E** `a7132a14…` (prefix `CRE`). TPS chỉ đọc, không ghi gì.
- Backup DB trước khi làm: `20261010-1047 ok: 25M total, builtin=ok`.
- Kết quả: **8 Đạt (AX1–AX6, AX8, AX9), AX7 Đạt nhưng còn 1 ca phụ chưa làm, AX10 Không đạt** (lỗi bố cục FX-AC1).
  AX11 do RV-X chấm (Đạt).
- Run phát sinh: **4 run**, đều của `e2e-base-assistant` chạy stub (marker `crew-e2e-stub`, phiên `crew-e2e-stub`, cost 0,
  token 0): 2 xong, 1 bị hủy sau 3 giây (đang ở stub), 1 `scheduled_retry` em hủy trước khi nó chạy. **0 run Claude thật.**
  Cuối phiên còn 0 run active (cả prod).

## Cách chạy

- Đăng nhập UI bằng Playwright Node qua `run-e2e.sh --project=t2`. Mật khẩu đọc từ `.env` VPS qua stdin, không in ra.
  Trace tắt. Sau mỗi lượt, script quét `test-results` và báo "không chứa mật khẩu" (lượt nào cũng sạch).
- Trước AC-X, Crew E2E chưa từng chạy T2: 0 project, 0 issue, 0 run, 2 agent giữ chỗ. Global-setup T2 cần project nền
  `e2e-base`, nên em dựng nó bằng wizard Thêm project trên UI (`~/crew-e2e/repo`, 2 executor, 20 giây). Ngay sau wizard em
  bật stub 5 giây cho cả 5 checkout. Wizard không sinh run nào (heartbeat tắt).
- Spec T2 của E2E-X1 (`s6-force-done`, `negative-r3x`, `s14-skill-edit`) chạy nguyên bản trong worktree
  `paperclip-r3-e2e`, `--retries=0 --trace=off`.
- Những ca T2 chưa có spec chạy được (AX2 với Trợ Lý, AX4/AX5 skill GitHub, AX7, AX8, AC5 khi bỏ nút EN) em viết spec
  Playwright tạm trong scratchpad. Spec này dùng chung helper `e2e/support/*` và cùng `run-e2e.sh`, không sửa file nào
  trong repo.
- AX8 chạy trước, rồi đến AX7 trên chính `e2e-base`, để luồng gỡ dọn luôn project thử. Spec `s8`/`s11` gốc không chạy
  vì mỗi spec tự tạo thêm một project `e2e-rm-*` (5 agent mỗi project).

## Bảng AX

| AX | Kết quả | Bằng chứng |
|---|---|---|
| AX1 Ép Done | **Đạt** | (a) PW-S6-17a, CRE-1 và (b) PW-S6-17b, CRE-2 xanh trên T2: `done`, `executionState` null, 1 `board_override`, 1 `force_done` có `reason`, comment "**Ép Done**" do user viết, 0 `issue_execution_decisions`, 0 run mới của reviewer, Lịch sử có "Lý do: …" và "Đã ép Done". (c) PW-S6-17c đỏ vì kỳ vọng chỉ đúng ở T1 (xem FX-AC4). Em làm lại tay: CRE-14 `in_progress` trong project Crew (workflow Crew 4 stage) → dialog liệt kê 4 cổng; sau ép thì `done`, `executionState` null, 1 override với 6 vi phạm (`stage_unapproved:*`×4, `docs_missing`, `push_missing`), 1 `force_done` (`fromStatus in_progress`, `fromStageId` null), comment của user, 0 decision, 0 run (ảnh `acx-shots/ax1c.png`). PW-S6-18 (Lịch sử gộp, ẩn read/inbox) xanh |
| AX2 Ép Done con/cha | **Đạt** (có ghi chú) | Cha CRE-17 do `e2e-base-assistant` (Trợ Lý, stub) giữ, ép con cuối CRE-18 → plugin gửi `plugin_wakeup` tới Trợ Lý (`contextSource plugin.issue.requestWakeup`). Lúc đó Trợ Lý đã có một run `issue_disposition_repair` đang chờ, nên lời đánh thức gộp vào run này: run `dc76df98` mang `wakeReason = issue_children_completed` (`agent_wakeup_requests` ghi `issue_execution_same_name/coalesced`). Cha không bị đóng theo; UI không báo "còn việc phụ". "Hủy luôn": PW-S6-17e xanh, 2 con `cancelled`, 0 run queued/running (con giao agent giữ chỗ nên không có run để hủy). PW-S6-17f (bỏ "Hủy luôn", con giữ nguyên) xanh. PW-S6-17d đỏ vì kỳ vọng sai trên prod (FX-AC4), nhưng DB có wakeup idem `force-done:<con>` |
| AX3 Ca âm Ép Done | **Đạt** | PW-S6-17g xanh: token agent 403; lý do 9 ký tự 400 `reason_invalid`, DB không đổi (status, executionState, số activity, số comment); body có trường lạ 400; ép lần hai 409 `issue_terminal`. PW-S6-7R xanh: Duyệt thường cho 0 `board_override`, 0 `force_done` |
| AX4 Sửa skill | **Đạt** | PW-S14-5 xanh: sửa SKILL.md → `GET …/files` ra nội dung mới, có `skill-sync` mới `done` với sha256 khác. PW-S14-5b xanh (sửa mô tả, giữ tên/slug). PW-S14-5c xanh: đổi `name:` thành `brainstorming` thì bị chặn, nút Lưu tắt, 0 PATCH. PW-S14-6 xanh với skill bundled `first-task`. Skill GitHub thật `anthropics/skills` → `algorithmic-art` (`sourceType github`, `editable false`): không có ô sửa nội dung (chỉ khối hiển thị), có "Kiểm cập nhật" và "Tạo bản sửa được". Tạo bản sửa ra `algorithmic-art-fork` (`local_path`), agent chuyển từ `github/…/algorithmic-art` sang `company/…/algorithmic-art-fork` (ảnh `ax4-gh-skill.png`) |
| AX5 Xóa skill | **Đạt** | PW-S14-7 xanh với skill local: gỡ khỏi agent, 404, `~/.crew/skills/<cid>/<slug>` mất, `crew.skillSync` còn 0 cặp. Skill GitHub `algorithmic-art`: bật cho agent, đồng bộ về Mac (thư mục có), xóa trên UI (gõ slug) → 404, agent hết khóa, mục nguồn `skills/algorithmic-art/SKILL.md` thành `excluded`, `POST …/refresh` 200 và không tạo lại skill, bản chép trên Mac mất, việc `skill-remove` `done`, `crew.skillSync` còn 0 |
| AX6 Ca âm skill | **Đạt** | PW-X-AX6 xanh: token agent sửa file 403 `skill_policy_denied`, DELETE 403, fork 403, tự sync 422. PW-X-AX6b xanh: `skill-remove` slug `../workflows` → 400. Payload sửa tay qua DB: theo spec chỉ cần test đơn vị app (MC-X1), AC-X không làm lại. Khối "Skill ghim" có 0 nút (DP-X1); AC5 `/skills` xanh |
| AX7 Gỡ project (F10) | **Đạt**, còn 1 ca phụ chưa làm | Gỡ `E2E base` trên UI: dialog hiện checkout executor "có việc chưa commit, sẽ giữ lại" (sau khi máy báo lại; xem FX-AC3). Gõ sai tên thì nút tắt, gõ đúng thì bật. Sau gỡ: 4 agent `paused`; 5 environment `e2e-base-*` `archived`; 13 environment khác, gồm `crew-e2e-template` và mọi environment TPS, vẫn `active`; không có request DELETE nào tới environment/project/agent (chỉ có DELETE roles, đúng thiết kế); roles trống; `archivedAt` 04:11:03Z. Kết quả `remove-checkouts`: `kept [executor:dirty]`, `removed` assistant/reviewer/integrator, `absent [executor-2]`. Tệp bẩn còn; nhánh `crew/e2e-base/*` còn đủ 5; `~/crew-e2e/repo` nguyên vẹn; `status-repos.json` không còn project; banner "Project đã gỡ lúc …" có (ảnh `ax7-*.png`). **Chưa làm:** ca "lỗi ở bước checkouts khi app tắt → Chạy tiếp" — không tắt app thật vì app đang nhận việc cho TPS (test đơn vị WZ-X1 đã phủ). Bộ lọc "Đã gỡ" ở danh sách project rỗng: FX-AC2 |
| AX8 Gỡ agent | **Đạt** | Reviewer: nút "Gỡ agent" tắt, có lý do "Agent đang là reviewer của …", link "Đổi vai trò". Gỡ `e2e-base-executor-2`: gõ sai tên thì tắt; xong thì vai trò còn đúng 1 executor; AGENTS.md của Trợ Lý (instructions-bundle) trước có id agent, sau không còn; agent `paused`; environment `e2e-base-executor-2` `archived`; checkout `executor-2` mất, `executor` còn; nhánh `crew/e2e-base/executor-2` còn; danh sách agent mặc định ẩn agent, bộ lọc "Đã gỡ" hiện lại (ảnh `ax8-*.png`) |
| AX9 Ca âm gỡ | **Đạt** | PW-X-AX9 xanh: token agent PATCH archivedAt bị chặn, pause agent khác 403, route `setup-runs`/`machine-jobs` 403. PW-X-AX9b xanh: `remove-checkouts` `projectKey ../x` → 400 |
| AX10 Không nút chết, i18n, DS | **Không đạt** | AC5 (`no-dead-controls`) chạy nguyên bản trên prod: **18 đỏ, 4 bỏ qua**, mọi route đỏ cùng một chỗ. Nút "EN" (Tiếng Anh) ở chân sidebar bị khung `main` che vì tên "Crew Spike Admin" dài đẩy nút ra ngoài 240px (FX-AC1, lỗi của R3 chứ không phải R3X). Khi bỏ riêng nút này, AC5 chạy 22 route: 18 xanh, 4 bỏ qua vì thiếu tham số (`runs/:runId`, `issues/:ref`, `skills/:skillId`), gồm các màn mới `/projects/remove`, `/agents/remove`, `/projects/:ref`, `/agents/:ref`, `/skills`. AC3/AC4: `test/guards/{design-system,i18n}.test.ts` ở `c55a16a0c` xanh. `coverage.json` có đủ 8 mã mới (S6.17, S6.18, S14.5–7, S8.7, S11.9, F10); chế độ STRICT còn đỏ 72 mã cũ của R3 (không thuộc R3X) |

## FX tìm thấy (không sửa code)

- **FX-AC1 (crew-web, shell R3, chặn AX10).** Chân sidebar xếp `AccountMenu` và `LanguageSwitch` trên một hàng. Khi tên
  hiển thị dài ("Crew Spike Admin"), nút "EN" tràn ra ngoài cột 240px và bị `main` che, nên không bấm được.
  - File: `packages/crew-web/src/app/shell/sidebar.tsx` (`SidebarFooter`), `app/shell/language-switch.tsx`.
  - Tái hiện: đăng nhập prod bằng tài khoản board, chạy `run-e2e.sh --project=t2 e2e/specs/no-dead-controls.spec.ts`.
    Mọi route đỏ ở `locator.click` nút `aria-label="Tiếng Anh"` với lỗi "`<main>` intercepts pointer events". Ảnh chụp
    lúc lỗi cho thấy "EN" nằm ở x≈244.
- **FX-AC2 (crew-web, OR-X2).** Bộ lọc "Đã gỡ" ở danh sách project luôn rỗng ("Chưa có project nào đã gỡ").
  - Nguyên nhân: `api.projects.list` gọi `GET /api/companies/:c/projects` mà không có `includeArchived=true`, nên server
    bỏ project đã archive (`server/src/routes/projects.ts:213`). Bộ lọc ở `features/projects/list/projects-page.tsx:88`
    vì thế không bao giờ có dữ liệu.
  - File: `src/api/paperclip/projects.ts:5`, `src/api/endpoints.ts` (`projects.list`).
  - Tái hiện: gỡ một project, mở `/CRE/projects`, bấm "Đã gỡ" (ảnh `ax7-list-removed.png`).
  - Ca s8 của E2E-X1 sẽ bắt được lỗi này khi chạy T2.
- **FX-AC3 (crew-web, WZ-X1, nhỏ).** Dialog Gỡ project/agent lấy trạng thái checkout từ báo cáo máy gần nhất
  (`machine_latest`, khoảng 1 phút một lần). Tệp vừa sửa vẫn hiện "sạch, sẽ gỡ". App vẫn kiểm `git status` khi gỡ và giữ
  checkout bẩn (đã thấy `kept dirty`), nên không mất dữ liệu, nhưng lời báo trong dialog có thể sai.
  - File: `src/features/wizards/remove/use-removal-data.ts` (`checkoutsOf`), `remove-buttons.tsx` (`CheckoutLines`).
  - Gợi ý: ghi rõ mốc giờ của báo cáo, hoặc xếp một việc kiểm trước khi mở dialog.
- **FX-AC4 (e2e harness, E2E-X1).** Các lỗi của spec và helper, không phải lỗi sản phẩm:
  - `r3x-project.ts` `addProjectViaWizard`: `getByLabel('Máy')` khớp cả ô "Folder repo trên máy" (strict mode). Phải dùng
    `getByRole('combobox', {name:'Máy', exact:true})`. Vì vậy s8/s11 không chạy được trên T2.
  - PW-S6-17c: chờ chữ "không có stage nào", nhưng project Crew trên prod luôn có workflow 4 stage.
  - PW-S6-17d: tìm `reason='issue_children_completed'`, nhưng cha giao agent giữ chỗ `wakeOnDemand:false`, nên stock ghi
    `heartbeat.wakeOnDemand.disabled/skipped`. Cần kiểm theo `payload.mutation='plugin_wakeup'` hoặc idem
    `force-done:<id>`, hoặc giao cha cho Trợ Lý stub.
  - Dọn skill bằng `dropSkill` (DELETE API trực tiếp) không xếp `skill-remove`, nên bỏ lại bản chép trên Mac
    (`e2e-edit-*`, `*-fork`). PW-S14-6 xóa bản fork trước khi app tải xong, sinh một `skill-sync failed` (HTTP 404).
  - `findBaseProject` (global-setup) không loại project đã archive: sau AC-X, `e2e-base` đã gỡ. Lượt T2 sau (ví dụ AC-A)
    cần dựng lại project nền (chưa thử dùng lại khóa `e2e-base` sau khi gỡ) hoặc lọc `archivedAt`.

## Ghi nhận (không phải lỗi)

- Activity `crew.issue.force_done` luôn có `violations: []`, vì plugin không đọc được activity. Đây là phương án dự phòng
  trong IX3 (cảnh báo `violations_unread`). Lịch sử lấy danh sách cổng bị bỏ từ `board_override`, nên vẫn hiển thị đúng.
- Ở chế độ stub, run không đổi trạng thái issue, nên stock tự đánh thức lại Trợ Lý bằng `issue_disposition_repair`. Lần
  đánh thức của Ép Done vì thế bị gộp vào run đang chờ (xem AX2). Nếu thấy run "dư", đó là hành vi stock.
- `DELETE /skill-sources/:id` của stock chỉ ngắt nguồn (`enabled=false`), không xóa bản ghi.

## Dọn dẹp (cuối phiên 11:15)

- Issue Crew E2E: 18, tất cả `done` (11) hoặc `cancelled` (7), không còn issue mở.
- Project: `E2E base` đã gỡ bằng luồng gỡ (archived). `e2e-neg-*` do spec âm tạo, đã archived.
- Agent: 5 agent `e2e-base-*` `paused`. Các agent giữ chỗ `crew-e2e-worker`, `crew-e2e-skill-agent`, `crew-e2e-reviewer`,
  `crew-e2e-integrator` `idle`, không heartbeat, không wakeOnDemand. Đây là fixture của harness, không chạy được nên em
  giữ nguyên.
- Environment: 5 environment `e2e-base-*` `archived`, không DELETE. `crew-e2e-template` vẫn `active`.
- Setup run: `add-project`, `remove-agent`, `remove-project` của `e2e-base` đều `done`. `crew_project_roles` của Crew E2E
  còn 0 dòng.
- Skill: 0 skill thử, chỉ còn 8 skill bundled. Nguồn `anthropics/skills` đã ngắt (`enabled=false`), mọi mục `excluded`.
  `~/.crew/skills/a7132a14…/` rỗng: 2 bản chép mồ côi do `dropSkill` của spec để lại đã được gỡ qua nút "Gỡ bản chép" ở
  khối "Bản chép của skill đã xóa".
- Mac: `~/crew-agents/e2e-*` không còn.
  - Checkout bẩn `executor` được giữ đúng thiết kế. Em xóa tệp thử `dirty-e2e.txt` (do chính em tạo), `git status` sạch,
    rồi chạy đúng lệnh tự gỡ `git -C <path> worktree remove <path>` (không `--force`).
  - Sau đó `rmdir ~/crew-agents/e2e-base`.
  - `git worktree list` của `~/crew-e2e/repo` chỉ còn `main`; các nhánh `crew/e2e-base/*` giữ nguyên.
- Stub: 0 marker còn lại, vì không còn checkout `e2e-*`.
- Run: 0 queued/running/scheduled_retry trên toàn prod.
- Không có process nền nào do em khởi động còn chạy. Playwright và Chromium tự đóng sau mỗi lượt.
- Không `rm -rf`, không DELETE environment/project/agent, không push, không sửa code.
- Spec tạm và log để ở scratchpad phiên, ngoài repo. Ảnh bằng chứng ở `reports/acx-shots/`.
