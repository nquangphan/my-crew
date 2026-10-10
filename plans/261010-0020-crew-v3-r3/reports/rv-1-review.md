# RV-1 — Review toàn nhánh R3 (Crew v3)

- Thời gian: 2026-10-10 05:28–05:43 (Asia/Ho_Chi_Minh, theo `date`). Reviewer: opus (1 điều phối + 5 mảng đọc song song, chỉ đọc).
- Phạm vi:
  - Fork: `git diff crew/r2-5..crew/r3`, crew/r3 = `3244b8a9b`, 457 file, +38 873 dòng. Plan ghi `crew/r2-2..`, nhưng crew/r3 rẽ từ crew/r2-5 `eef987b01` (ledger 03:59).
  - Repo Crew: `git diff r2-5..r3`, r3 = `e7625aa`, 45 file.
- Worktree chỉ đọc (detach):
  - `.worktrees/paperclip-r3-rv`
  - `.worktrees/crew-r3-rv`
- Không sửa code, không commit, không push, không deploy, không ghi prod.

## Kết luận: **ĐẠT CÓ ĐIỀU KIỆN**

- Không có Blocker. Có **9 Major** và **39 Minor**.
- Ràng buộc cứng đều đạt:
  - hook lõi 5/5, chỉ đổi `description`;
  - không file lõi nào bị đổi;
  - full suite hai repo xanh.
- Điều kiện để DP-1 lên prod:
  1. **Sửa trước DP-1:**
     - WEB-M1, WEB-M2: cổng duyệt từ trạng thái cũ thành `board_override` (Review Focus 2).
     - WEB-M3: vòng lặp 401.
     - WZ-M1: khóa bước 5 phút ngắn hơn hạn job 10 phút, gây pause nhầm agent.
     - PL-M1: run add-project hỏng giữ khóa project vĩnh viễn.
     - SEC-M1, SEC-M2: lách luật giao việc D10 qua `projectId`.
  2. **Sửa trước E2E-4 / AC-B:**
     - WZ-M2: ô khóa project của wizard tạo agent.
     - E2E-M1: T3 chạy nhầm stub, báo xanh giả.
  3. **Owner quyết** các mục (d) của SEC-1 còn mở: D5, D6, D7, D12. Xem mục "Chờ owner".
  4. Minor sửa theo FX gom theo gói. Không chặn deploy.

## Kết quả full suite

| Repo | Lệnh | Kết quả |
|---|---|---|
| Fork | `pnpm --filter @crew/paperclip-web test` | 87 file, 585 ca xanh + 1 todo |
| Fork | `pnpm --filter @crew/paperclip-web typecheck` | 0 lỗi |
| Fork | `CREW_UI_COMMIT=3244b8a9b681e3e03f2e938798b37b6803569c63 pnpm --filter @crew/paperclip-web build` | OK. `dist/index.html` có `crew-ui` đúng SHA. Không có chunk `/ds` |
| Fork | `biome check .` (crew-web) | sạch (356 file) |
| Fork | `crew/release/verify.sh` | **XANH**: check-core-hooks 5/5, lỗi 0, `base v2026.1005.0`; server `crew-` 23 file / 463 ca; adapter 17; plugin 41 file / 223; `crew/agents` node --test; tsc server / adapter / plugin; build plugin; không có `require("react")` trần. `ipcs -m` trước và sau: không còn đoạn nào của verify |
| Crew | `pnpm -r test` | crew-mac 55 file / 963, mac-app 43 / 479, docs-kit 3 / 43, đều xanh |
| Crew | `pnpm -r typecheck` | 0 lỗi |
| Crew | `pnpm lint` | sạch (321 file) |
| Crew | `crew-docs check --range r2-5..r3` | ok (3 commit) |

### AC3–AC6 bản chạy cục bộ

- **AC3:** đạt.
  - Test luật design system xanh.
  - `grep -rn "style={" src/features src/app` ra 0 dòng.
  - Guard có lỗ, xem DS-m4.
- **AC4:** đạt phần test. Key VI/EN khớp và quét AST xanh trong suite. Guard bỏ sót một số thuộc tính và `ds/components`, xem DS-m5. `PW-S0-3` để AC-A chạy.
- **AC5:** **chưa chạy cục bộ ở RV-1**. Stack T1 (cổng 3199/5183) đang do E2E-2/3 giữ. Theo lệnh, em không đụng vào stack đó và không dựng stack thứ hai trên cổng cố định. E2E-1 đã chạy T1 5/5, gồm ca nút chết của shell. Ca đầy đủ chạy ở AC-A.
- **AC6:** đạt.
  - check-core-hooks 5/5, `base` = `v2026.1005.0`.
  - `git diff crew/r2-5..crew/r3 --name-only` không có đường nào ngoài Global Constraints.
  - Không có diff nào trong `ui`, `server/src/routes`, `server/src/services`, `packages/shared`, `packages/plugins`.
- **AC10 (thêm):** đo cục bộ.
  - JS khởi đầu (gzip, entry cùng modulepreload) ≈ **269 KB**, dưới ngưỡng 700 KB.
  - Map, wizard và trang feature tải lười.
  - Markdown **không** tải lười, xem DS-m10.

## Đối chiếu các điểm soi đặc biệt

| Điểm | Kết quả |
|---|---|
| Claim bằng UPDATE có điều kiện thay `SKIP LOCKED` (PL-1) | **Chấp nhận**. Host `plugin-database.ts:565-570` chỉ trả `rowCount`. `query` cấm `update`/`insert` kể cả trong CTE (`:259-262`), nên không dùng được RETURNING hay transaction. Dưới READ COMMITTED, so-và-đặt `WHERE id=$1 AND status='queued'` đảm bảo một việc chỉ một máy nhận. Trả lease quá hạn chạy song song không tăng `attempts` hai lần. Đã có đột biến test. Sót nhỏ: PL-m2 |
| Luật giao việc SEC-2 khác SEC-1 | **Chấp nhận hướng** vì template integrator/executor có bước giao executor, đã đọc `crew/agents/*.md`. Bàn giao workflow, `returnAssignee` và chuyển stage vẫn qua. **Phải sửa** hai lỗ qua `projectId` (SEC-M1, SEC-M2). Nên thu hẹp "giao cho chính mình" (SEC-m1) |
| Hook vẫn 5/5, chỉ đổi thân | **Đạt**. `core-hooks.json` chỉ đổi `description` H2/H4/H5. Không đổi anchor/head/file/importLine |
| Duyệt/Yêu cầu sửa dùng Dialog; không có nút Duyệt khi owner được leo thang ở stage review (WK-3) | **Chấp nhận cả hai**. Dialog vẫn từ `@/ds`, giữ được lời nhắn bắt buộc. Duyệt ở stage review thiếu bằng chứng sẽ thành `board_override` (`issue-gate.ts:316`). Nhưng nhận định "UI không bao giờ gửi done ngoài nhánh participant" chỉ đúng khi cache mới, xem WEB-M1, WEB-M2 |
| Readiness A3 (FX-O1) | **Chấp nhận**. Lỗi A3 có thật, cách sửa không làm A3 luôn xanh: chỉ BMAD lấy từ file, template và executor lấy từ bảng vai trò. Còn sót cho vai trò khác Trợ Lý (WZ-m1) và hai bộ đọc BMAD lệch nhau (WZ-m2) |
| Bảo mật UI | **Đạt, kèm Minor**. Không có `rehype-raw`, `dangerouslySetInnerHTML`, `innerHTML`. react-markdown chặn `javascript:`. Lỗi job làm sạch ở cả app và plugin. `next=` chặn `//`, `/\`, `https:`, `javascript:` (còn hở ký tự điều khiển: DS-m1). Không có `console.*`, mật khẩu không lưu, không có token trên URL |
| Wizard không bao giờ DELETE environment/agent | **Đạt**. `endpoints.ts` chỉ có 3 DELETE: `issues.markUnread`, `issues.unarchive`, `attachments.delete`. Lỗi chỉ dẫn tới pause, bỏ qua agent paused/terminated/pending_approval |
| Stub E2E chỉ chạy dưới `~/crew-agents/e2e-*` (MC-1) | **Đạt**. So `pwd -P` với HOME đã realpath. Symlink `e2e-x` trỏ sang checkout thật thì không stub. Marker ở `--absolute-git-dir` của đúng worktree. Khối stub nằm sau workflow-check và ghi pgid, trong nhánh `PAPERCLIP_RUN_ID`. `CREW_E2E_STUB_BIN` không mở thêm gì so với `CREW_CLAUDE_BIN` có từ R2. Rủi ro còn lại nằm ở harness: E2E-M1, E2E-m1, E2E-m2 |
| Secret webhook Crew E2E lưu file trên VPS (OP-2) | **Chấp nhận** (thư mục 700, file 600; VPS vốn giữ `.env` và khóa SSH). Nên xóa file sau DP-2. Phải sửa thứ tự rotate (OPS-m1) |

## Phát hiện

Mã: `PL` plugin, `SEC` security, `WEB` = `DS`/`WK` (ds/work), `WZ` wizards/org, `MAC`, `OPS`, `E2E`. Đường dẫn tính từ gốc fork, trừ chỗ ghi "Crew:".

### Blocker

Không có.

### Major

| Mã | File:dòng | Kịch bản lỗi | Đề xuất sửa | Gói |
|---|---|---|---|---|
| WEB-M1 | `packages/crew-web/src/features/issues/detail/crew/actions-slot.tsx:47-57`; server `services/issue-execution-policy.ts:912-916`, `crew/issue-gate.ts:316` | Owner mở dialog Duyệt rồi gõ lời nhắn. Trong lúc đó stage đổi (duyệt ở tab khác, hoặc issue đã sang integrator/push) mà cache chưa làm mới. Bấm Duyệt thì gửi `PATCH {status:'done'}` với quyền board khi owner không còn là participant. Server xóa `executionState` và cho `done`, H2 ghi `crew.policy.board_override`. Yêu cầu sửa từ trạng thái cũ cũng xóa `executionState`. Phụ: `actions` đổi khi dialog mở thì `run()` không làm gì, dialog treo | Trong `mutationFn`, `api.issues.get` trước rồi kiểm lại `awaitingMyApproval(fresh, me)`. Đã đổi thì không gửi, báo "Trạng thái đã đổi, tải lại". Thêm ca vitest và ca PW: đổi stage ở tab khác trong lúc dialog mở | work |
| WEB-M2 | `packages/crew-web/src/app/live/live-events.ts:46-51,60-64`; `features/issues/detail/use-issue.ts:10` | Trang chi tiết dùng key `issue(<mã TPS-xx>)`. Nhiều activity của server không mang `identifier` (`routes/issues.ts` mở lại do comment, `issue.thread_interaction_answered`, `heartbeat.ts` escalate), `heartbeat.run.*` chỉ có uuid. Trang không làm mới, nút cổng không theo `executionState` mới, tạo điều kiện cho WEB-M1 | Thiếu `identifier` thì `invalidateQueries({predicate: q => q.queryKey[0]==='issue' && q.state.data?.id === entityId})`, làm cả cho run có `issueId`. Đây là cách của `ui/src/context/LiveUpdatesProvider.tsx:229-273` | ds |
| WEB-M3 | `packages/crew-web/src/api/http.ts:112-115`, `src/app/router.tsx:60`, `src/app/hooks.ts:40`, `src/app/auth/login-page.tsx:44` | Phiên bị thu hồi khi cache phiên còn mới (staleTime 60 s). Trang gặp 401 sang `/login`; `/login` thấy `session.data` trong cache nên `Navigate` về `next`; query 401 lại; lặp tới 60 s, bắn request liên tục, trình duyệt có thể chặn vì `replaceState` quá nhiều | Trong handler 401, `queryClient.setQueryData(queryKeys.session, null)` hoặc `removeQueries` trước khi điều hướng. Thêm test "phiên trong cache + 401 → hiện form" | ds |
| WZ-M1 | `packages/crew-plugin/src/setup/types.ts:17` (`SETUP_LOCK_MINUTES=5`); `packages/crew-web/src/features/wizards/add-project/run-step.ts:110-115` (`JOB_TIMEOUT_MS` 10 phút), `:492-506`, `:519` | Tab 1 chờ job `check`/`prepare-checkouts` hơn 5 phút. Server coi khóa hết hạn (`runningStep` null), tab 2 "Chạy tiếp" begin thành công. Tab 1 xong: resume agent rồi finish `done`. Tab 2 finish thì 409, `finish failed` cũng 409 (bị nuốt), rồi `onFail` gọi `pauseAgents` với mọi `agent_*`. Kết quả: run `done` nhưng 4–5 agent bị pause. Wizard tạo agent dính tương tự. `finish` chỉ so `running_step`, không so chủ khóa (`setup/data.ts:78-90`) | (a) Khóa dài hơn hạn job (≥ 12 phút), hoặc gia hạn khóa trong `waitJob`. (b) Web: `finish` trả 409 thì coi là người khác đã chạy, ném `StepBusyError`, KHÔNG gọi `onFail`. (c) Plugin: `begin` trả `runningSince`, `finish` bắt buộc gửi lại để so (gộp PL-m1) | wizards + plugin |
| WZ-M2 | `packages/crew-web/src/features/wizards/add-agent/add-agent-page.tsx:184,388`; plugin `setup/api.ts` không đối chiếu `projectKey` với `projectId` | Ô "Khóa project" sửa tay được. Owner gõ khóa của project B, hoặc project do app tạo không suy được khóa. Environment và job `agent-workspace` dựng checkout ở `~/crew-agents/<khóa B>/<ô>`: agent của A làm trong checkout của B, hoặc lỗi `checkout_exists`. Ở Crew E2E, gõ khóa không `e2e-` thì checkout nằm ngoài vùng stub | Suy được khóa (từ run add-project hoặc từ checkout) thì khóa ô lại, chỉ cho nhập khi không suy được. Plugin: `setup.create add-agent` kiểm `projectKey` trùng với run add-project cùng `projectId` nếu có | wizards (+ plugin) |
| PL-M1 | `packages/crew-plugin/src/setup/api.ts:161-164`, `migrations/0007_setup_runs.sql:17` (`WHERE status <> 'done'`) | Chọn nhầm máy/folder nên bước `inspect` hỏng, run `failed`. Tạo lại cùng khóa nhận 409 kèm `setupRunId`. "Chạy tiếp" chạy lại đúng input sai (input và máy cố định). Khóa project bị chiếm vĩnh viễn, chỉ gỡ được bằng SQL tay trên prod. Web (`add-project-page.tsx:94-97`) không có lối thoát | Thêm trạng thái kết thúc `abandoned` (nới CHECK, loại khỏi index): `setup.abandon`, hoặc `setup.create` được bỏ run `failed` chưa có `project_id` rồi tạo mới. Web thêm nút "Bỏ lần dở" chỉ khi run `failed` và chưa có project. Không xóa gì | plugin (+ wizards) |
| SEC-M1 | `server/src/crew/issue-create-policy.ts:156` (`if (data.projectId != null) return data.projectId`), `:233-235`; `project-roles.ts:219` | Executor gọi `POST /companies/<c>/issues {parentId:<issue của mình>, projectId:<project không có dòng crew.core>, assigneeAgentId:<bất kỳ trừ reviewer/integrator>}`. Lõi cho con khác project của cha (`routes/issues.ts:12072`). Luật D10 đọc vai trò của project mới, null nên cho qua. Project không có dòng vai trò luôn có sẵn (vai trò file của TPS, hoặc project agent tự tạo vì D6 còn mở) | Agent tạo con có `parentId` trong company Crew mà `projectId` khác project của cha thì 422. Hoặc kiểm D10 theo cả project của cha. Không template nào gửi `projectId`. Chỉ đổi thân hook H4 | security |
| SEC-M2 | `server/src/crew/issue-gate.ts:320` (`GATE_KEYS` không có `projectId`), `:347`, `:361` | Agent gửi `PATCH /issues/:id {projectId:P'}` (thoát hook), rồi `PATCH {assigneeAgentId:X}`. Lần hai đọc vai trò của P', không có dòng nên giao tự do. Gửi chung một lệnh thì đã bị chặn | Trong company Crew, actor agent đổi `projectId` thì 422 (thêm `projectId` vào điều kiện vào gate). Chỉ đổi thân H2. Thêm 2 ca âm | security |
| E2E-M1 | `packages/crew-web/e2e/support/global-setup.ts:46,55`; `global-teardown.ts:6-7` | Lượt T2 bị ngắt (Ctrl-C, crash) nên teardown không chạy, marker stub còn. T3 (AC-B, claude thật) `return` sớm ở global-setup mà không gỡ marker. Run thật biến thành stub in `success`, AC9 xanh giả | Ở t3: `stub.off` mọi khóa rồi kiểm không còn checkout nào `isOn`; còn thì dừng lượt. AC-B ghi bằng chứng "0 marker" vào ledger | e2e |

### Minor

| Mã | File:dòng | Kịch bản / vấn đề | Đề xuất | Gói |
|---|---|---|---|---|
| PL-m1 | `crew-plugin/src/setup/data.ts:65-72,78-90` | Khóa không có mã chủ; tab sau nhả khóa của tab trước | Gộp vào WZ-M1(c) | plugin |
| PL-m2 | `crew-plugin/src/jobs/data.ts:120-122` | Lease hết hạn, máy claim lại cùng việc, kết quả của lần nhận cũ tới sau được nhận như của lần mới. App chạy tuần tự nên hiếm | Result gửi kèm `claimedAt`, WHERE so `claimed_at` | plugin |
| PL-m3 | `crew-plugin/src/jobs/api.ts:131-135` | `result` khi `done` chỉ kiểm `kind` và kích thước. `{kind:'check', items:"x"}` lưu được, web `items.map` vỡ | Validator tối thiểu theo từng `JobResult` | plugin |
| PL-m4 | `crew-plugin/src/jobs/sanitize.ts:5-21` | Không che `scheme://user:pass@` (stderr git hay in remote). Plugin là ranh giới tin cậy theo I1, `setup.finish.error` từ trình duyệt cũng qua đây | Thêm mẫu userinfo URL, cắt tới `@` cuối trước `/` (xem MAC-m3) | plugin |
| PL-m5 | `crew-plugin/src/companies/data.ts:23-28`; host `routes/plugins.ts:728-737` | `crew.companies` không kèm companyId chỉ instance admin gọi được. Board user không phải admin thì cả shell báo lỗi | Ghi vào giả định chờ owner (Q5). Đổi khi có thành viên không phải admin | plugin |
| SEC-m1 | `server/src/crew/project-roles.ts:222` | "Giao cho chính mình" cho executor/BMAD tự nhận issue rảnh đang giao Trợ Lý hoặc executor khác (lõi `allowVisibleIssueWrite`) | Chỉ cho tự giao khi issue chưa có `assigneeAgentId` | security |
| SEC-m2 | `server/src/crew/agent-config-gate.ts` | H5 không phủ `PATCH /agents/:id/permissions` (agent `ceo`, mà D5 vẫn tạo được ceo) và `POST /agents/:id/resume` (bỏ pause plugin vừa đặt) | Thêm hai đường vào regex H5, chỉ đổi thân | security |
| SEC-m3 | `crew-plugin/src/security/guards.ts:7-13` | `project.deleted` không phải sự kiện plugin, nên phần (c) của D6 không bắt được việc xóa | Ghi vào D6 (chờ owner) | security |
| SEC-m4 | `issue-gate.ts:363` và `issue-create-policy.ts:235` | Lỗi đọc bảng vai trò: H2 cho qua, H4 trả 503. Lệch nhau | Thống nhất fail-closed cho actor agent | security |
| SEC-m5 | plugin pause (ledger 04:35) | Pause không hủy run đang chạy, nên biện pháp tạm cho D5/D6 yếu | Kèm SEC-m2; chờ owner (d) | security |
| DS-m1 | `crew-web/src/app/routes-util.ts:5-8` | `safeNext` không chặn ký tự điều khiển: `next=/%09/evil.com` thành `//evil.com` khi phân tích. Hiện chỉ làm crash trang (`replaceState` khác origin ném lỗi) | So `new URL(next, origin).origin === origin` và từ chối `[\x00-\x1f\\]` | ds |
| DS-m2 | `crew-web/src/ds/widgets/markdown-view.tsx:14-27` | `![](https://x/t.png)` trong mô tả hay bình luận do agent viết sẽ tải ảnh ngoài, lộ IP và referrer của owner | Component `img` với `referrerPolicy="no-referrer"`, hoặc chỉ nhận ảnh cùng origin | ds |
| DS-m3 | `crew-web/src/api/paperclip/attachments.ts:20`, `src/app/live/live-events.ts:17` | `/api/attachments/:id/content` và WS `/events/ws` không có trong bảng ENDPOINTS | Thêm dòng, đánh dấu "không qua call" | ds |
| DS-m4 | `crew-web/test/guards/design-system.test.ts:7,31` | Bỏ qua mọi `className={cn(...)}`; regex import chỉ khớp đúng `radix-ui`/`lucide-react`, không khớp `@radix-ui/*`, `cmdk`, `@xyflow/react`. Hiện chưa có vi phạm | Kiểm đối số chuỗi của `cn` ngoài `ds/`; regex theo tiền tố | ds |
| DS-m5 | `crew-web/test/guards/i18n.test.ts:6` | `TEXT_ATTRS` thiếu `description/message/body/hint`; không quét `src/ds/components`, còn `Close`/`More` cứng ở `dialog.tsx:75,113`, `sheet.tsx:81`, `command.tsx:66`, `breadcrumb.tsx:97` | Mở rộng thuộc tính và phạm vi quét, dịch các chuỗi đó | ds |
| DS-m10 | `crew-web/src/ds/index.ts:47` (`export * from './widgets/markdown-view'`) | Barrel `@/ds` kéo react-markdown và micromark vào chunk `hooks-*.js` được modulepreload từ shell. AC10 ghi "markdown tải lười" (đo 269 KB, vẫn dưới 700 KB) | Bọc `MarkdownView` bằng `lazy()` trong ds, hoặc tách export | ds |
| WK-m1 | `crew-web/src/features/issues/detail/issue-page.tsx:46-52` | `/TPS/issues/CRE-5` vẫn tải và cho thao tác cổng. WS nghe company TPS nên lọc mất event của CRE, yêu cầu con hỏi sai company | `issue.companyId !== company.id` thì chuyển prefix đúng hoặc 404 | work |
| WK-m2 | `crew-web/src/features/issues/new/use-create-request.ts:37` | Chuỗi lỗi tiếng Việt viết cứng, lọt khỏi guard | Qua `t()` | work |
| WK-m3 | `use-create-request.ts:71` | queryKey tự đặt `['issues', c, 'research-label']`, nên mỗi event issue lại refetch nhãn | Dùng `queryKeys.labels` | work |
| WK-m4 | `crew-web/src/features/runs/run-page.tsx:152-155` | Chạy lại run gắn chat: server 202 `runId:null` mà UI báo "bị bỏ qua", dễ bấm lại thành hai lần | Phân biệt 202 null với `skipped` | work |
| WK-m5 | `features/inbox/use-inbox-issues.ts:6`, `features/dashboard/use-dashboard.ts:21` | "Chờ bạn duyệt" chỉ đếm trong 200 issue mới nhất | Lọc phía server hoặc ghi giới hạn trên UI | work |
| WZ-m1 | `crew-web/src/features/readiness/use-readiness.ts:134-138` | `instructionsRendered` chỉ tính cho Trợ Lý. Executor/reviewer/integrator vẫn báo A3 sau "Render lại" nếu template đổi giữa hai bản phát hành | Tính cho mọi vai trò bằng `renderInstructions(role,{agentId})` | wizards |
| WZ-m2 | `features/readiness/assistant-instructions.ts:9-16` và `src/lib/instructions/render.ts:64-78` | Hai bộ đọc mục BMAD (`indexOf` và `lastIndexOf` có neo). File có heading lặp thì readiness và wizard đọc khác nhau | Gộp về `assistantListsOf` | wizards |
| WZ-m3 | `src/lib/instructions/agent-config.ts:31`; plugin `machines/webhook.ts:63` | `SUPERPOWERS_PIN_RE` và `absolutePath` cho `..` và ký tự lạ trong home. Không chèn lệnh được (SSH quote) nhưng trỏ command ra ngoài home được | Cấm `/..`, dùng bộ ký tự an toàn | wizards + plugin |
| WZ-m4 | `features/wizards/add-project/run-step.ts:224-239,255-256` | `pickTemplate` không đòi `knownHosts`, nhưng body đặt `strictHostKeyChecking:true` với `knownHosts:null`. Environment hỏng lúc chạy, A4 không bắt | Bắt buộc `knownHosts` chuỗi khi chọn template | wizards |
| WZ-m5 | `features/wizards/add-agent/run-step.ts:301-307` | Thay Trợ Lý bằng wizard thì Trợ Lý cũ vẫn giữ `tasks:assign` | `setPermissions({canAssignTasks:false})` cho Trợ Lý cũ nếu không còn giữ ô Trợ Lý ở project nào. Không xóa gì | wizards |
| WZ-m6 | `features/wizards/setup-progress.tsx:59-62`; `add-project-page.tsx:257`; `add-agent-page.tsx:465,468` | Key `setup.get` không gồm company. Link "Mở project/agent" lấy prefix của company đang chọn, sai khi đổi company giữa chừng (ghi vẫn đúng company) | Dựng link theo `run.companyId` | wizards |
| WZ-m7 | `features/readiness/use-readiness.ts:105-115` | Project vai trò file chưa có yêu cầu Crew nào bị P1. "Làm tiếp" cho agent vai trò file dẫn vào wizard rồi bị chặn `projectNoRoles`: ngõ cụt | Coi project chưa có yêu cầu là `untracked`; ẩn "Làm tiếp" cho vai trò file | wizards |
| WZ-m8 | `features/wizards/add-agent/run-step.ts:231-236` | Chế độ sửa chạy từ bước `agent`/`pin` ghi đè AGENTS.md (mất nội dung owner sửa tay) dù A3 đang đạt | Chỉ ghi khi A3 hỏng, hoặc hỏi xác nhận | wizards |
| WZ-m9 | `features/wizards/add-agent/add-agent-page.tsx` (Select project/slot ở `?fix=`) | Ở chế độ sửa vẫn đổi được project và ô; đặt một agent vào hai ô thì server 400 | Khóa hai ô khi agent đang giữ vai trò | wizards |
| MAC-m1 | Crew: `apps/mac-app/src/main/jobs/executors.ts:257,275` (FX-M1) | `wrapper` fail giờ chỉ là `warn`: check qua, project "sẵn sàng" nhưng mọi run không khởi động. Ngược lại, `worktree-workflows` quét cả `~/crew-agents` (`crew-mac/src/commands/doctor.ts:632-700`), nên project khác lỗi vẫn làm check `failed` | `wrapper` thành error. `worktree-workflows` hạ warn (đã có `workflow:<ô>` kiểm đúng checkout). Giữ `worktree-root` là error | mac |
| MAC-m2 | Crew: `apps/mac-app/src/main/jobs/register.ts:35-39`, `poller.ts:63-90` | Hết 8 phút khi đang `prepare` (Main tải skill): báo `failed` nhưng `prepare` xong vẫn gọi `runMachineJob`, skill được ghi sau khi đã báo lỗi. Giết utility không giết `git` con | Cờ hủy sau timeout; `AbortSignal` cho `prepare`; giết theo process group | mac |
| MAC-m3 | Crew: `apps/mac-app/src/main/jobs/sanitize.ts:22` (plugin dùng cùng mẫu) | `[^/\s@'"]+@` dừng ở `@` đầu: `https://u:p@ss@host` thành `https://ss@host`, lộ một phần mật khẩu | `[^/\s'"]*@` (tới `@` cuối trước `/`) | mac (+ plugin) |
| OPS-m1 | `crew/ops/e2e-company.sh:315-325` | Ghi file secret mới rồi mới rotate. Rotate lỗi thì `die`, lần sau thấy file có sẵn nên "present": file và server lệch mãi, webhook 401 | Ghi `.tmp`, rotate thành công rồi `mv` | ops |
| OPS-m2 | `crew/ops/check-crew-companies.sh:15,31` | Id phía policy không đưa về chữ thường nên báo "lệch" sai. `GET /companies` lỗi trả mã 1 thay vì 2 | `.lower()` trong `list_companies`; danh sách rỗng hoặc lỗi thì exit 2 | ops |
| E2E-m1 | `crew-web/e2e/support/stub.ts:59-65`, `global-setup.ts:55` | `stub.projectKeys()` theo `readdir ~/crew-agents/e2e-*`, không theo company. Project thật khóa `e2e-foo` thêm từ app (app và plugin đều nhận khóa đó) sẽ bị bật stub ở T2 | Lấy khóa từ `crew.setupRuns` của Crew E2E; cân nhắc plugin chặn `e2e-*` ngoài Crew E2E | e2e (+ plugin) |
| E2E-m2 | `crew-web/e2e/support/stub.ts:27-34` | `~/crew-agents/e2e-x` là symlink tới project thật thì vẫn ghi marker vào git dir của checkout thật. Wrapper không stub ở đó nên vô hại, nhưng trái hợp đồng | Kiểm `realRoot` nằm dưới `realpath(agentsRoot)/e2e-` | e2e |
| E2E-m3 | `crew-web/e2e/support/api.ts:20-25`, `env.ts:26` | Chặn ghi TPS chỉ dò chuỗi id company: `PATCH /api/issues/<id issue TPS>` vẫn lọt. `isProd()` so đúng hostname nên alias (dấu chấm cuối, IP) tắt mọi chặn | Trên prod, lời gọi ghi chỉ cho path `/api/companies/<E2E>/` hoặc route plugin kèm companyId E2E; còn lại GET xác minh companyId trước | e2e |
| E2E-m4 | `crew-web/e2e/support/db.ts` | psql chạy bằng `POSTGRES_USER` (superuser). `default_transaction_read_only` chặn ghi nhưng `SELECT pg_terminate_backend(...)` vẫn lọt | Dùng role chỉ đọc (`pg_read_all_data`), hoặc từ chối hàm `pg_*` trong câu | e2e |

## Chờ owner (không tính vào Major, là điều kiện deploy)

Các mục (d) của SEC-1 vẫn mở. Đã xác nhận không có file lõi nào đổi.

| Mục | Rủi ro | Đề xuất cho DP-1 |
|---|---|---|
| D5 onboarding-seed | Cao: agent tạo agent `ceo` kèm project và issue gốc; plugin chỉ pause khi run bắt đầu, run đầu chạy trọn | Owner ghi chấp nhận rủi ro để deploy, hoặc duyệt patch `assertBoard` một dòng (`onboarding-seed.ts:41`). Làm SEC-m2 để thu hẹp thiệt hại |
| D6 project | Trung bình–cao: là điều kiện để SEC-M1/M2 khai thác được; xóa project không phát hiện được (SEC-m3) | Sửa SEC-M1/M2 thì phần giao việc đóng; phần tạo/sửa/xóa project chờ owner |
| D7 DELETE/checkout issue | Trung bình | Đo N15/N16 trên Crew E2E ở AC-A |
| D12 execution-workspaces | Thấp–trung bình | Chấp nhận tạm (cwd thật lấy từ environment) |

## Phán xét các quyết định "tự quyết" trong ledger

Mặc định là **Chấp nhận**. Chỉ ghi lý do ngắn, hoặc **Phải sửa** kèm mã phát hiện.

**Trợ Lý (03:59): r3/crew/r3 rẽ từ r2-5**
- Chấp nhận. Đã gồm r2-3, cần cho MC-1/SEC-2/WZ-1.

**DS-1** (1) biome riêng, (2) ThemeScope, (3) icons, (4) exclude e2e (đã gỡ), (5) cổng 5183, (6) bớt component
- Chấp nhận cả 6.

**DS-2** (a) alias `ts-api`, (b) biome root, (c) lock
- Chấp nhận cả 3.

**DS-3**
- (1) ENDPOINTS dạng object khóa: Chấp nhận. `call()` không gọi được khóa lạ. Bảng thiếu 2 đường, xem DS-m3.
- (2) `activity.logged` → invalidate: **Phải sửa** (WEB-M2).
- (3)–(7): Chấp nhận.

**DS-4, FX-DS1..FX-DS4, FX-W1**
- Chấp nhận tất cả.

**PL-1**
- (1) claim UPDATE có điều kiện: Chấp nhận (lý do ở bảng trên).
- (2)–(10): Chấp nhận. (5) thiếu kiểm dạng result, xem PL-m3. (8) thiếu che URL userinfo, xem PL-m4.

**PL-2**
- (1): Chấp nhận, kèm PL-m5.
- (2) run `failed` giữ khóa: **Phải sửa** (PL-M1).
- (3), (6), (7), (8): Chấp nhận.
- (4), (5): Chấp nhận, nhưng khóa cần mã chủ và thời hạn dài hơn hạn job (WZ-M1).

**PL-3, FX-P1, FX-P2**
- Chấp nhận.

**MC-1** (1)–(7)
- Chấp nhận cả 7. (1) so realpath HOME chặt hơn I4.

**MC-2**
- (1)–(8), (10): Chấp nhận. (1) folder repo dưới `/Volumes`, `~/Documents`: folder chỉ đọc, checkout luôn ở `~/crew-agents`. (5): chấp nhận, kèm MAC-m2.
- (9): đã được FX-M1 thay.

**FX-M1**
- **Phải sửa (Minor)**: MAC-m1.

**OP-1** (1)–(3)
- Chấp nhận.

**OP-2**
- (1) hai agent giữ chỗ, (2) prefix `CRE`, (3) secret webhook lưu file VPS 600: Chấp nhận.
- (3) kèm sửa OPS-m1 và xóa file sau DP-2.

**SEC-1**
- Báo cáo `sec-1-routes.md` thay `sec-1-authz.md`: Chấp nhận.
- Đính chính spec §2 về `tasks:assign` mặc định: Chấp nhận, đã đối chiếu code.

**SEC-2**
- D10 khác SEC-1: chấp nhận hướng, **Phải sửa** SEC-M1, SEC-M2 (nên làm SEC-m1).
- Cờ `--assistant`: Chấp nhận. Đổi vai trò ở S8 phải chạy lại script.
- Áp cho mọi adapter, bỏ terminated: Chấp nhận.
- Bắt D5 ở `agent.run.started`: Chấp nhận là biện pháp tạm (SEC-m5).
- Capability mới: Chấp nhận. DP-1 phải kiểm plugin `ready` sau nâng cấp.
- Biome không áp cho server: Chấp nhận tạm (tsc và test đã chạy).

**WZ-1**
- (1)–(8): Chấp nhận.
- (3) vai trò file: sửa nhẹ theo WZ-m7.

**WZ-2**
- (1)–(5), (7), (8): Chấp nhận.
- (6) template ưu tiên crewLoadGate: **Phải sửa** phần bắt buộc `knownHosts` (WZ-m4).

**WZ-3**
- (1), (2), (4)–(7): Chấp nhận.
- (3) giữ agent cũ của ô: **Phải sửa** phần quyền (WZ-m5).

**OR-1** (1)–(5)
- Chấp nhận. "Tải lại và ghi lại" ghi đè theo ý người bấm; 409 thực tế hiếm vì `putInstructions` GET hash ngay trước PUT.

**OR-2** (1)–(7)
- Chấp nhận. Skills sync `replace` gửi đủ danh sách, không mất skill khác.

**OR-3** (1)–(7), **OR-4** (1)–(4)
- Chấp nhận.

**FX-O1**
- Chấp nhận. Mở rộng theo WZ-m1, WZ-m2.

**WK-1** (1)–(9), **WK-2** (1)–(7)
- Chấp nhận.

**WK-3**
- (1) Dialog thay ConfirmDialog: Chấp nhận.
- (2) lời nhắn duyệt mặc định: Chấp nhận.
- (3) không có nút Duyệt khi owner được leo thang ở stage review: Chấp nhận.
- (4)–(7): Chấp nhận.
- Nhận định I7 "UI không bao giờ gửi done ngoài nhánh participant": **Phải sửa** (WEB-M1, WEB-M2).

**WK-4**
- (1)–(10): Chấp nhận.
- (2)/(3) awaiting_me rộng hơn BA S2.1: nên ghi bổ sung vào BA.
- (7): kèm WK-m4.
- (9) href tìm kiếm: chỉ nhận cùng origin, không có open redirect.

**E2E-1**
- `db.ts` qua `docker exec psql` read-only thay `api.sh psql`: Chấp nhận, kèm E2E-m4.
- (1) no-dead-controls chặn non-GET, (2) project t1/t2/t3, (4) `resetAgentSessions`, (6) T1 chưa có policy: Chấp nhận.
- (3) chữ ký `stub.on`: Chấp nhận. Phạm vi khóa phải sửa: E2E-M1, E2E-m1, E2E-m2.
- (5) `env.ts`: Chấp nhận. `api.ts`: phải làm chặt (E2E-m3).
- Trace tắt trong file điền mật khẩu và quét sau lượt: Chấp nhận. Lượt bị ngắt thì trace có thể còn trên đĩa (`test-results` đã gitignore).

## Đề xuất FX (gom theo gói)

| FX | Gói | Nội dung | Mã | Hạn |
|---|---|---|---|---|
| FX-RV-W | work (opus) | Kiểm lại trạng thái trước khi Duyệt/Yêu cầu sửa; dialog treo; WK-m1..m4 | WEB-M1, WK-m1..m4 | trước DP-1 |
| FX-RV-D | ds (opus) | Invalidate khi thiếu identifier; xóa cache phiên khi 401; DS-m1..m5, m10 | WEB-M2, WEB-M3, DS-m* | trước DP-1 (M), Minor tùy |
| FX-RV-P | plugin (opus) | `abandoned`/`setup.abandon`; mã chủ khóa và thời hạn khóa; kiểm `projectKey` add-agent; PL-m2..m4; userinfo URL | PL-M1, WZ-M1(c), WZ-M2 (plugin), PL-m* | trước DP-1 |
| FX-RV-Z | wizards (opus) | `finish` 409 thì không `onFail`; khóa ô khóa project; nút "Bỏ lần dở"; WZ-m1..m9 | WZ-M1, WZ-M2, WZ-m* | trước DP-1 (M) |
| FX-RV-S | security (opus) | H4 `projectId` khác cha; H2 chặn agent đổi `projectId`; SEC-m1, m2, m4; ca âm mới | SEC-M1, SEC-M2, SEC-m* | trước DP-1 |
| FX-RV-E | e2e (sonnet) | t3 gỡ marker và kiểm 0 marker; khóa theo setupRuns; symlink; `api.ts` chặt; role chỉ đọc | E2E-M1, E2E-m* | trước AC-A (m), AC-B (M) |
| FX-RV-M | mac (sonnet) | `wrapper` là error, `worktree-workflows` là warn; hủy thật khi timeout; regex userinfo | MAC-m1..m3 | trước DP-2 |
| FX-RV-O | ops (sonnet) | Rotate an toàn; check-crew-companies lower/exit 2 | OPS-m1, m2 | trước DP-1 (chép script lên VPS) |

Sau FX: chạy lại phần suite của gói, không cần RV-1 lần hai nếu reviewer của từng FX đối chiếu với bảng trên.

## Tài nguyên

- Worktree tạo: `.worktrees/paperclip-r3-rv` và `.worktrees/crew-r3-rv` (detach, chỉ đọc). Gỡ bằng `git worktree remove` (đã ghi `processes.md`).
- Không có process nền còn chạy. Stack T1 của E2E không bị đụng tới.
- Log nằm ở scratchpad của phiên (không commit).
