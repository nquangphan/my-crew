# Review toàn nhánh R1-2 (lượt cuối) — 07/10/2026, Asia/Ho_Chi_Minh

Phạm vi: fork `crew/r1-2` `ad7935763` (`git diff v3..HEAD`, 45 file) và repo Crew `r1-2/crew-mac` `a520c16` (32 file). Em đọc plan (Global Constraints, Review Focus, Interface, Nghiệm thu), spec R1-2 gates, ledger O1–O8 và các ruling, mục kết luận của mọi `reports/*-review.md`. Finding đã đóng hoặc đã chấp nhận bằng ruling thì không nhắc lại. Em không chạy lại test. Lệnh duy nhất em chạy: `crew-docs check --range v3..HEAD` trên `r1-2/crew-mac`, kết quả `ok (9 commits)`, exit 0 (R3 đạt).

## Verdict: CHANGES_REQUESTED

Finding mới: **1 critical, 3 major, 6 minor.** Cả bốn finding chặn đều nằm ở chỗ nối giữa các gói. Review từng gói không thấy được vì mỗi gói chỉ test phía mình (plugin mock `ctx`, instructions chỉ là văn bản, ops không biết tới `CREW_POLICY_CONFIG`).

## Critical

### C1. Run integrator do plugin đánh thức không ghi được gì lên Paperclip: mọi comment và PATCH bị 403. Bước push sau khi owner duyệt (O5) không chạy được
- Nơi nối: `packages/crew-plugin/src/integrator-wake.ts` `registerIntegratorWake` ↔ `crew/agents/integrator.md` mục "Sau khi owner duyệt" (bước 1 "comment một lần", bước 4 bằng chứng mới, bước 7 `crew-merge`, bước 8 `PATCH blocked`).
- Bằng chứng trong lõi:
  - `server/src/services/plugin-host-services.ts` `invoke` gọi `heartbeat.wakeup` với `payload: { prompt }` và `contextSnapshot` chỉ có `wakeReason` và `paperclipAgentMessage`. Không có `issueId` hay `taskId`.
  - `heartbeat.ts` (khoảng dòng 7085) chỉ bù `contextSnapshot.issueId` từ `payload.issueId/taskId`, nên run này không có issue nguồn.
  - `routes/issues.ts` gọi `assertCrossIssueInfluenceWithinRunCap` ở POST comment (dòng 17411) và ở PATCH (13026 loại `update`, 13036 loại `comment`).
  - `services/cross-issue-influence-limit.ts` `observeCrossIssueInfluence` có dòng `if (!sourceIssueId) throw crossIssueInfluenceRunContextError();`. Dòng này nằm **trước** phần kiểm `log_only`/`enforce`, nên agent nào không có issue nguồn cũng nhận 403 `cross_issue_influence_run_context_required` khi ghi. Bỏ header run id cũng vậy (`!req.actor.runId` ném cùng lỗi).
- Hậu quả:
  - Integrator đọc được (GET) nhưng không đăng được bằng chứng ở bước 4. Theo instructions thì không được push, nên không bao giờ push. Nếu agent vẫn push thì không còn `crew-merge` hay bằng chứng nào.
  - Push lỗi thì không chuyển được `blocked`. Owner không thấy gì: issue nằm `done`, không có comment.
  - Cổng 2 của AC-2 ("board ép `done` → integrator được đánh thức nhưng KHÔNG push") đạt chỉ vì lý do sai: comment "không push" cũng 403.
  - Review PG-2 m2 và roles n1 có nêu "wake không mang issue context" nhưng để AC-2 xác minh. Giờ đã xác minh được bằng code: chắc chắn hỏng.
- Cách sửa (chọn một, không sửa lõi):
  1. **Owner @mention integrator ngay trong comment của lệnh duyệt** (wake stock `issue_comment_mentioned` mang `issueId` của issue gốc). Plugin bỏ `invoke`, hoặc giữ `invoke` chỉ làm nhắc. Runbook, `integrator.md` và mục "Sau khi owner duyệt" ghi rõ đường này. Cần đo một lần trên spike rằng wake do mention trên issue `done` giao cho user vẫn chạy và mang `contextSnapshot.issueId`.
  2. Tìm một đường wake stock có issue context mà plugin gọi được qua SDK (`ctx.issues.*`). Không đổi `plugin-host-services.ts`, vì đó là file lõi không phải hook một dòng; muốn đổi phải hỏi owner.
  - Dù chọn cách nào: test `crew-integrator-wake.test.ts` hiện chỉ khẳng định đã gọi `invoke`. Cần thêm một test DB/route chứng minh run được đánh thức có `contextSnapshot.issueId` bằng id issue gốc, hoặc ghi rõ đây là kiểm tay ở AC-2.

## Major

### M1. Stage reviewer của issue gốc không có hướng dẫn: issue gốc chỉ gồm issue con sẽ bị reviewer "cần sửa" tới vòng 5
- Nơi nối: template gốc `buildCrewPolicy("root", …)` (`server/src/crew/issue-policy.ts`, stage 1 = reviewer) và spec ("Reviewer: review issue con và issue gốc") ↔ `crew/agents/reviewer.md`.
- `reviewer.md` bước 1 đọc `crew-commit` mới nhất của executor. Bước 2 coi "thiếu dòng `crew-commit`" là lý do request changes.
- Theo interface R1-3, Trợ Lý là assignee của issue gốc và chuyển `done` khi các con xong. Issue gốc khi đó không có `crew-commit` của chính nó. Reviewer theo đúng instructions sẽ request changes, issue quay về Trợ Lý, tới vòng 5 thì leo thang cho owner. Mọi yêu cầu nhiều issue con đều kẹt ở đây.
- Sửa: thêm mục "Issue gốc" vào `reviewer.md`. Với mỗi issue con: issue `done`, `completedStageIds` chứa stage đầu, có `crew-review` hợp lệ khớp `crew-commit` mới nhất. Ngoài ra kiểm acceptance criteria của issue gốc có được các con phủ đủ không. Approve bằng dòng tổng hợp (ví dụ `crew-review root children=<id,…> verdict=approved`) hoặc theo sha khi chính issue gốc có `crew-commit`. Thêm khẳng định tương ứng vào `instructions.test.mjs`.

### M2. Điều kiện Gộp của integrator không bao giờ đúng cho issue gốc có việc của chính nó: kịch bản Cổng 4 của AC-2 sẽ kẹt
- `crew/agents/integrator.md:9`: "Với mỗi issue (gốc hoặc con)… chỉ khi issue đó `status=done` với `executionState.completedStageIds` chứa id stage đầu".
- Lúc integrator làm Gộp, issue gốc đang `in_review` ở stage integrator (stage 1 đã nằm trong `completedStageIds`, nhưng `status` ≠ `done`). Vậy `crew-commit`/`crew-review` của chính issue gốc luôn bị loại, và integrator request changes "issue chưa `done`".
- Cổng 4 của AC-2 (executor làm thẳng issue gốc, reviewer approve, integrator merge) rơi đúng vào ca này.
- Sửa: tách điều kiện. Issue con: `done` cộng stage đầu đã qua. Issue gốc: là issue đang giao cho ME ở stage integrator (`executionState.status=pending`, `currentParticipant.agentId=ME`) và `completedStageIds` chứa stage đầu. Thêm test chuỗi cho nhánh issue gốc.

### M3. `CREW_POLICY_CONFIG` không được nối vào deploy: deploy "ok" với mọi gate tắt
- Interface (plan.md, O8): "RO-1 ghi file này; deploy mount file read-only vào container"; ledger O8: "PG-1/ops (mount file, deploy kiểm file tồn tại)".
- `git grep CREW_POLICY_CONFIG` trong fork chỉ thấy `server/src/crew/issue-policy.ts` và comment ở `crew/agents/*`. `crew/ops/deploy.sh` và `compose-set-image.py` không đặt env, không mount file, không kiểm file có tồn tại và parse được.
- Khi thiếu env, `loadCrewCompanyConfig` trả `absent`: H2/H4 không áp gì, kể cả O7. Dấu hiệu duy nhất là một dòng `warn` lúc server khởi động (`reportCrewPolicyConfigAtStartup`).
- `deploy.sh` vẫn in `plugin crew.core healthy` và `deploy ok`. Bước "D1 → deploy" của AC-2 sẽ qua, rồi Cổng 2a sẽ thấy agent `done` thẳng.
- Sửa trong `crew/ops/deploy.sh`:
  - (a) Trước khi đổi image: đòi compose có `CREW_POLICY_CONFIG` và volume `:ro` trỏ tới file trên host, và file đó là JSON có `companies`.
  - (b) Sau health: kiểm log container có dòng `crew policy config enabled`, hoặc gọi một lệnh đọc thử. Không đạt thì thoát mã mới (ví dụ 7) kèm gợi ý rollback.
- Mount nên là thư mục chứa file (không phải file đơn) để `cat >` tại chỗ (ruling RO-1) và cả `mv` đều thấy được. Ghi vào runbook.

## Minor

- **m1. `deploy.sh` nhận image thiếu H4.** Điều kiện `'^issues crewCoreHooks=[01]$'` chặn khi đếm < 2. Nhưng `v3` (R1-1, chỉ H2 stub) đã đếm được 2, còn HEAD đếm được 3 (import + H2 + H4; em đã đo bằng `git show v3:… | grep -c`). Image dựng nhầm từ nhánh cũ vẫn qua. Sửa thành `!= 3`, hoặc kiểm riêng chuỗi `beforeIssueCreate` trong `issues.js`.
- **m2. `apply-roles.sh agent` không kiểm `adapterConfig.command` là wrapper.** `merge-agent-config.mjs` `mergeAgentConfig` chỉ đòi `command` khác rỗng. Agent có `command: "claude"` vẫn được ghim `--plugin-dir` và báo thành công, nhưng không đi qua `crew-claude-run`, nên không có `workflow-check` và không có exit 78 (Review Focus 5 bị lách). Sửa: từ chối khi `command` không kết thúc bằng `/.crew/bin/crew-claude-run`.
- **m3. `policy-config.mjs` `buildPolicyConfig` không kiểm `companyId` là uuid và không chuẩn hóa hoa thường.** Ghi `ABC…` lên file đã có `abc…` sẽ sinh hai key. Server (`parseCrewPolicyConfig`) trả `invalid` cho company đó, tức fail closed cho tới khi sửa tay. Sửa: kiểm uuid, viết thường key, xóa key trùng khi bỏ hoa thường trước khi gộp.
- **m4. H4 đọc issue nguồn ngoài transaction của caller.** Dòng hook truyền `db` (không phải `dbOrTx`). `crewBeforeIssueCreate` → `loadSourceExecutorAgentIds(input.db, …)` đọc bản đã commit. Một đường stock vừa đổi assignee hay `returnAssignee` của issue nguồn rồi tạo issue recovery trong cùng `tx` sẽ được so với dữ liệu cũ, và có thể miễn policy nhầm. Xác suất thấp. Ghi ruling chấp nhận, hoặc đổi dòng hook sang `db: dbOrTx` (vẫn là một dòng, cập nhật `anchor` trong `core-hooks.json`).
- **m5. Còn mã plan trong code (Global Constraint).** `apps/crew-mac/src/workflows/inventory.ts:270` có "(đo ở spike SP-1)". Đổi thành "(đo trên claude 2.1.289)".
- **m6. Regex `crew-docs-check` được chép tay** trong `crew/agents/instructions.test.mjs:25` thay vì lấy từ `CREW_DOCS_CHECK_RE`. Server đổi regex thì test instructions vẫn xanh. Nên đọc regex từ `server/src/crew/issue-policy.ts` bằng cách parse văn bản, hoặc ghi chú hai chỗ phải đổi cùng nhau.

## Đã kiểm xuyên gói, khớp (không phải finding)

- **Vai trò:** `parseCrewPolicyConfig` (uuid, reviewer ≠ integrator, owner khác rỗng, key không phân biệt hoa thường) khớp `buildPolicyConfig`. Plugin lấy integrator từ stage 2 của policy đã ghim (`integratorAgentIdOf`). Policy bị H2 khóa trước agent nên nguồn này tin được.
- **Mã lỗi** H2/H4 khớp bảng ở `executor.md`. Comment retry `Crew: lần chạy lại sau run …`, "dừng giữa chừng", "danh sách bị cắt" khớp `executor.md` bước 2.
- **Pin:** `extraArgs` `--setting-sources project,local --plugin-dir <pin>` (`mergeAgentConfig`) ↔ wrapper đòi đúng một `--plugin-dir` ↔ `workflowCheck` so `comparablePath` với `superpowersPinDir`. Adapter claude_local nối `extraArgs` vào cuối (`execute.ts:918`) và không tự thêm `--plugin-dir`.
- **Reopen:** comment của owner không mở lại issue gốc sau khi duyệt, vì assignee lúc đó là user owner (`buildCompletedState` không đổi assignee) mà `shouldImplicitlyMoveCommentedIssueToTodo` đòi `assigneeAgentId`. Với issue con leo thang (giao owner), comment `crew-review` của owner (n7) cũng không mở lại.
- **Global Constraints:** H4 có mục registry, `anchor` khớp dòng 9639 `issues.ts`, import ở cuối file (13230), ngân sách 4/5. Không có scheduler/queue/bảng mới (state plugin chỉ là mốc theo issue). Không có cổng 5432 trong diff. Không có credential AI trên server. Tên `PAPERCLIP_RUN_ID` và `~/crew-agents` chỉ xuất hiện trong fixture test. R3 trên `r1-2/crew-mac` đạt.
- **An toàn vận hành:** script H3 dùng chung cho bước stop của retry, nhắm theo `PAPERCLIP_RUN_ID=<run trước>` hoặc pgid đã ghi có kiểm thời điểm leader, nên không đụng run khác cùng worktree. Exit 2 rơi xuống fallback (đã ruling). `rollback.sh` báo trạng thái plugin, không chặn. `installSuperpowersPin` không ghi đè bản ghim lệch checksum.

## AC-2 phải kiểm thêm

1. (C1) Sau khi sửa: run integrator sau lệnh duyệt có `contextSnapshot.issueId` = issue gốc, đăng được `crew-docs-check` và `crew-merge`. Ca push lỗi: issue chuyển `blocked` có comment. Trước khi sửa: chạy một lần để xác nhận 403 `cross_issue_influence_run_context_required`.
2. (M3) Trước D1: compose có `CREW_POLICY_CONFIG` cùng mount `:ro`, log khởi động có `crew policy config enabled`, và `apply-roles.sh policy-config … <file>` ghi vào đúng file mà container thấy (đọc lại file trong container).
3. (M1/M2) Một yêu cầu có 2 issue con và issue gốc không commit, cùng một yêu cầu mà executor làm thẳng issue gốc. Cả hai đi qua reviewer stage 1 và integrator Gộp mà không bị request changes oan.
4. (m2) Cả ba agent có `adapterConfig.command` = `…/.crew/bin/crew-claude-run`. Đọc lại bằng `GET /agents/<id>` sau `apply-roles.sh`.
5. Worktree `~/crew-agents/{reviewer,integrator}` không có git common dir hay `crew-docs.bundle` dưới `~/Documents`. Hiện `crew-docs.bundle` của checkout repo Crew là `/Users/phannhatquang/Documents/projects/crew/packages/docs-kit/dist/crew-docs.cjs`, nên doctor `crew-docs` sẽ fail, và integrator chạy qua sshd sẽ treo ở TCC hoặc ra `DOCS_EXIT=2`. Chọn repo dự án đặt ngoài vùng TCC trước D2.
6. (m1) Đọc dòng `issues crewCoreHooks=` của `inspect-image.sh` trên overlay: phải là 3.

Status: DONE
Summary: CHANGES_REQUESTED — 1 critical (run integrator do plugin đánh thức không có issue context nên mọi lệnh ghi bị 403, O5 không push được), 3 major (stage reviewer issue gốc không có hướng dẫn; điều kiện Gộp của integrator không bao giờ đúng với issue gốc; deploy không nối `CREW_POLICY_CONFIG` nên mọi gate tắt mà vẫn "deploy ok"), 6 minor.

---

# Re-review (fork `ad7935763..faf7d346d`, repo Crew `a520c16..2ce11c9`) — 07/10/2026

Em đọc diff của đợt sửa, dòng O9 cùng các ruling mới cuối ledger, rồi đối chiếu `issue-gate.ts` với transition stock trong `issue-execution-policy.ts`: `applyIssueExecutionStageTransition`, `buildPendingState`, `buildChangesRequestedState`, `buildCompletedState`. Em không chạy lại test (dựa vào kết quả verify của lead). Em chạy lại `crew-docs check --range v3..HEAD` trên `2ce11c9`: `ok (10 commits)`, exit 0. `issues.ts` đếm `crewCoreHooks` = 3.

## Verdict: CHANGES_REQUESTED

- Finding cũ: C1, M1, M2, M3, m1, m2, m3, m5, m6 **đóng**. m4 chấp nhận bằng ruling.
- Finding mới: **0 critical, 2 major, 2 minor.** Cả hai major nằm ở đường lỗi (push hỏng, sửa code thẳng trên issue gốc). Đường vui chạy đúng.

## Đi lại end-to-end issue gốc 4 stage

**Đường vui, cả hai biến thể (executor làm thẳng issue gốc; issue gốc gồm 2 issue con): không kẹt, không lách.**

1. Executor (hoặc Trợ Lý) `done` thì stock giao stage 1 cho reviewer. Với issue gốc chỉ gồm con, reviewer có mục "Issue gốc" mới (M1 đóng).
2. Reviewer approve thì stage 2 giao integrator. H2 không xét gì thêm vì stage 1 không phải stage docs hay stage push.
3. Integrator gộp. Issue gốc được tính theo `in_review` + `currentParticipant` = ME (M2 đóng). Integrator approve, H2 kiểm docs theo `docsGateStages` (stage review thứ hai, trước `approval`) và `approvedInThisWrite`. Stage 3 giao owner.
4. Owner approve, H2 không xét gì. `nextPendingStageAfter` chọn stage 4; `selectStageParticipant` chỉ loại `returnAssignee`, nên integrator được giao và stock đánh thức kèm issue context (C1 đóng theo O9; AC-2 vẫn xác nhận wake chạy qua route thật).
5. Integrator ghi bằng chứng cho `T`, push, ghi `crew-merge … pushed=yes`, rồi `done`. H2 vào nhánh `enteringDone` và xét đủ 4 stage:
   - Stage 1–3: approval đã lưu.
   - Stage 2: integrator không bị loại khỏi người ký, nhờ `assigneeIsPendingParticipant`.
   - Stage 4: `approvedInThisWrite`.
   - Docs: lấy bằng chứng mới nhất, chính là bằng chứng cho `T`.
   - Push: phải mới hơn approval của owner trong vòng hiện tại, và `sha` bằng `commit=` của bằng chứng mới nhất. Thứ tự bước 4 → 5 → 7 → 8 trong `integrator.md` khớp đúng điều kiện này.

**Lách:** em không tìm thấy đường mới. Executor là `returnAssignee` nên không ký được stage nào. Agent không sửa được policy. Bằng chứng và `crew-merge` chỉ tính comment của participant stage tương ứng (`latestComment`). Comment mới nhất là `pushed=no` thì parse ra null, thành `push_missing`. Board ép thì có `crew.policy.board_override`.

## Major mới

### N1. Push lỗi ở stage 4 làm Crew không bao giờ tự push lại được; issue cũng không chuyển `blocked`
- Stock coi mọi `status` khác `done`/`in_review` mà **participant đang chờ** gửi lên là **request changes** (`applyIssueExecutionStageTransition`, nhánh `requestedStatus && requestedStatus !== "in_review"`): `status = in_progress`, giao lại cho `returnAssignee` (executor/Trợ Lý), `changesRequestedCount + 1`. Vì vậy `PATCH blocked` ở `integrator.md` bước 1 ("Thiếu một điều kiện") và bước 9 (`PUSHED=no`) không ra `blocked`, không tới owner. Câu "Issue rời `in_review` thì server mở lại vòng duyệt" cũng sai: H2 chỉ reset vòng khi rời `done`/`cancelled`.
- Executor gửi lại thì stock đưa thẳng về stage 4 (`CHANGES_REQUESTED_STATUS && currentStage`). Nhưng `buildPendingState` giữ `lastDecisionOutcome: "changes_requested"` từ lần trước.
- Bước 1 của `integrator.md` đòi `lastDecisionOutcome` là `approved`, nên từ lần thứ hai trở đi luôn thiếu điều kiện. Integrator comment "không push", `PATCH blocked`, tức lại một lần request changes. Vòng lặp chạy tới vòng 5 thì stock giao stage 4 cho owner. Owner approve thì thành board override `push_missing`: issue `done` mà **không push**.
- `executor.md` không có hướng dẫn cho comment `Integrator: chưa push được …`.
- Sửa:
  - (a) Bước 1 bỏ điều kiện `lastDecisionOutcome`. Thay bằng `executionState.currentStageId` = id stage `review` sau `approval`, `currentParticipant.agentId` = ME, và id stage owner nằm trong `completedStageIds`.
  - (b) `PUSHED=no` hoặc thiếu điều kiện: **không đổi `status`**. Comment `crew-merge … pushed=no` kèm lý do và gọi owner. Owner sửa xong thì comment để đánh thức lại assignee (integrator); comment của người dùng trên issue `in_review` giao cho agent sẽ đánh thức assignee, AC-2 cần đo. Nếu muốn giữ `blocked` thì phải dặn trong `executor.md`/Trợ Lý cách xử lý comment `Integrator: chưa push được`, và chấp nhận mất một vòng.
  - Thêm test chuỗi: bước 1 không còn `lastDecisionOutcome`, và nhánh `PUSHED=no` không `PATCH` status.

### N2. Integrator yêu cầu sửa code thẳng trên issue gốc thì kẹt tới vòng 5
- Kịch bản: executor làm thẳng issue gốc. Ở stage 2 integrator thấy test xấu do code của executor và `PATCH in_progress` "Integrator: cần sửa" (`integrator.md` bước 3 mục Kiểm). Executor sửa, đăng `crew-commit` mới, rồi `done`.
- Stock đưa issue về **stage 2** (stage đã yêu cầu sửa), không chạy lại stage 1 (reviewer). Stage 1 vẫn nằm trong `completedStageIds`.
- Integrator áp đúng luật bước 1: `crew-review sha` ≠ `crew-commit` mới nhất, tức "commit chưa được review", nên lại request changes. Không còn đường nào đưa reviewer quay lại issue này, nên vòng lặp chạy tới vòng 5 rồi leo thang cho owner.
- Lỗi có từ thiết kế 3 stage (không do O9), nhưng nằm đúng biến thể "executor làm thẳng issue gốc" mà lead yêu cầu đi lại. Issue con không bị: Trợ Lý mở lại con, H2 reset vòng, con quay lại reviewer.
- Sửa (chỉ đổi instructions): `integrator.md` bước 3 và `executor.md` mục vòng sửa ghi rõ rằng phần sửa cho code của chính issue gốc phải làm trong **một issue con mới** (`parentId` = issue gốc, có template con nên qua reviewer). Integrator merge `crew-review sha` cũ của issue gốc cộng `sha` đã review của con. Thêm test chuỗi.

## Minor mới

- **n1.** Issue gốc 3 stage tạo trước O9 không còn đường push nào (không có stage push, plugin đánh thức đã gỡ). AC-2 không dùng lại issue gốc thử cũ; cần thì board gửi lại policy 4 stage.
- **n2.** `instructions.test.mjs` tự khai regex `crew-merge … pushed=(yes|no)`, chưa đối chiếu với `CREW_MERGE_RE` của server như đã làm cho `CREW_DOCS_CHECK_RE`. Thêm một test cùng kiểu.
- Ghi nhận, không phải finding: cùng ngữ nghĩa stock ở N1, các chỗ `blocked` khác do participant gửi đều thành request changes về executor, tốn một vòng. Đó là `integrator.md:5` (fetch lỗi), `:9` (chờ owner đăng `crew-review`), `:30` (`DOCS_EXIT=2`) và `reviewer.md` ("Việc không làm được thì `blocked`"). Nên sửa chữ cho đúng hành vi thật cùng đợt với N1.

## Deploy (M3, m1): đóng

- `policy-env.sh` mount thư mục `:ro` qua override, `COMPOSE_FILE` ghi vào `.env`.
- `deploy.sh` thoát 7 khi file thiếu hoặc lỗi. Sau health nó kiểm `printenv` và `test -r` trong container, cùng log có cảnh báo "gate Crew".
- `inspect-image.sh` và `deploy.sh` đòi `crewCoreHooks=3`.
- `rollback.sh` giữ mount khi file còn hợp lệ.

Em không thấy lỗi mới ở phần này.

## AC-2 thêm

1. Sau khi owner duyệt: integrator được đánh thức qua route thật, run có `contextSnapshot.issueId` = issue gốc, ghi được comment, `done` đóng được issue.
2. (N1, sau khi sửa) Push bị từ chối một lần (ví dụ nhánh bảo vệ), owner sửa rồi comment: integrator chạy lại và push được. Kiểm `changesRequestedCount` không tăng.
3. (N2, sau khi sửa) Integrator yêu cầu sửa code của chính issue gốc: phần sửa đi qua issue con, có reviewer, rồi được merge.
4. Owner là thành viên company trước khi giao stage approval (ledger).

Status: DONE
Summary: CHANGES_REQUESTED. C1, M1–M3 và các minor cũ đã đóng; đường vui 4 stage không kẹt, không lách. Mới: 0 critical, 2 major (N1 push lỗi ở stage 4 thành request changes về executor và `lastDecisionOutcome` kẹt nên không bao giờ tự push lại; N2 sửa code thẳng trên issue gốc ở stage 2 không quay lại reviewer nên kẹt tới vòng 5), 2 minor.

---

# Re-review 2 (fork `faf7d346d..537e7045e`, chỉ `crew/agents/**`) — 07/10/2026

Em đọc diff 4 file (`integrator.md`, `executor.md`, `reviewer.md`, `instructions.test.mjs`), đối chiếu với các đường stock sau:
- `applyIssueExecutionStageTransition` (participant gửi status khác: request changes);
- `getWakeableParentAfterChildCompletion` cùng đoạn wake `issue_children_completed` trong `routes/issues.ts`;
- `assertCanAssignTasks` và `authorization.ts`, nhánh agent của `tasks:assign`;
- `crewBeforeIssueCreate` (H4).

Em không chạy lại test; lead báo 39/39, 0 skip.

## Verdict: CHANGES_REQUESTED

N1, N2 (phần chặn kẹt vòng) và n2 **đóng**. Finding mới: **0 critical, 1 major, 2 minor.**

## N1: đóng

- Bước 1 của stage 4 không còn đòi `lastDecisionOutcome`. Điều kiện giờ là `currentStageId` = stage `review` cuối, đứng sau `approval`, cộng id stage owner nằm trong `completedStageIds`.
- `PUSHED=no` và "thiếu điều kiện" chỉ comment, không đổi status. Issue nằm yên ở stage 4, giao integrator, và lần chạy sau (do owner comment) bắt đầu lại từ bước 1.
- Không còn `PATCH blocked` hay `in_progress` nào của participant đang duyệt, trừ một chỗ đúng ngữ nghĩa: `reviewer.md` "Cần sửa" dùng `in_progress`, và trên issue con thì đó chính là request changes. Các chỗ cũ (fetch lỗi, chờ owner đăng `crew-review`, `DOCS_EXIT=2`, reviewer gặp lỗi môi trường) đều đã đổi sang "chỉ comment".

## N2: phần kẹt vòng đóng; còn một chỗ hở về liveness (N3)

Đi lại đường issue con do integrator tạo:

1. Integrator ở stage 2 gọi `POST /issues/<gốc>/children`, giao cho executor của issue gốc.
   - H4: `createdByAgentId` có, `parentId` có, assignee không phải role, nên gắn template con. Gửi `executionPolicy` thì cũng bị thay.
   - `tasks:assign`: agent ở simple mode được phép, trừ khi company bật policy giao việc `restricted` (AC-2 kiểm).
   - Cross-issue influence: issue nguồn của run là issue gốc, nên đếm 1 trong 20, cho qua.
2. Issue gốc giữ nguyên `in_review` ở stage 2, giao integrator. Không ai sửa được nó: executor là `returnAssignee`, policy bị khóa.
3. Executor làm issue con và `done`, thành `in_review` ở stage reviewer. Reviewer approve, issue con `done`, tức `becameTerminal`.
4. `getWakeableParentAfterChildCompletion`: issue gốc không ở `backlog/done/cancelled`, có `assigneeAgentId` = integrator, **mọi** issue con đã `done/cancelled`. Vì vậy stock đánh thức integrator với `contextSnapshot.issueId` = issue gốc.
5. Integrator vào lại mục Gộp (stage owner chưa nằm trong `completedStageIds`). `crew-review` gốc của issue gốc vẫn khớp `crew-commit` gốc, vì executor được dặn không đụng issue gốc. Issue con có `crew-review` hợp lệ. Integrator merge cả hai, kiểm, ghi bằng chứng mới, approve stage 2.

Không kẹt vòng, không lách: mã sửa bắt buộc qua reviewer của issue con; integrator không ký thay ai.

## Major mới

### N3. Issue con sửa code của issue gốc được dựng từ `origin/HEAD`, không từ `sha` cần sửa
- `executor.md` mục "Cách làm": "chưa có thì `git switch -c crew/<identifier> origin/HEAD`". Mục mới (bước 3 "Trước khi làm") không đổi điểm xuất phát.
- Với issue con do integrator tạo để sửa code của issue gốc (hoặc của một issue con khác), nhánh sửa không chứa đoạn code cần sửa. Executor hoặc sẽ viết lại phần đó (merge vào `crew/req/<id>` bị conflict, integrator lại tạo issue con mới, lặp), hoặc sửa không có tác dụng.
- Kiểu lỗi conflict rơi đúng vào đường mà N2 vừa mở. Không lách được, nhưng là vòng lặp tốn run cho tới khi owner can thiệp.
- Sửa (chỉ đổi chữ):
  - `integrator.md` mục "Yêu cầu sửa": mô tả issue con ghi một dòng cố định `crew-fix base=<sha cần sửa>`, hoặc `base=<tip crew/req/<id> lúc conflict>` khi sửa conflict.
  - `executor.md`: issue có dòng `crew-fix base=…` thì `git switch -c crew/<identifier> <base>`, không dùng `origin/HEAD`.
  - `reviewer.md`: diff `<base>..<sha>` cho loại issue này.
  - Thêm test chuỗi cho cả ba.

## Minor mới

- **n3. Issue con sửa được giao cho "executor của issue gốc".** Với issue gốc gồm nhiều con thì đó là Trợ Lý (`returnAssignee` của issue gốc), không phải executor đã viết đoạn code cần sửa. Trợ Lý phải giao lại cho đúng người, và việc giao lại không bị H2 chặn vì đích không phải role. Ghi rõ: "giao cho assignee hoặc `returnAssignee` của issue có `sha` cần sửa; issue gốc gồm nhiều con thì giao cho executor của issue con đó".
- **n4. Stage 4: test hỏng sau khi merge `origin/$DEFAULT` mới không có đường phục hồi trong instructions.** Mục "Yêu cầu sửa" chỉ áp cho stage 2. Ở stage 4 bước 3 đi thẳng sang `PUSHED=no` và chờ owner, nhưng owner không phải participant của stage 4, nên chỉ còn cách board ép trạng thái. Ghi một dòng runbook cho owner: board gửi lại policy để chạy lại từ stage 2, hoặc board `PATCH in_progress` để xóa state. Hoặc cho integrator tạo issue con sửa ở stage 4 rồi merge cả nó trước khi push (cần đối chiếu thêm với điều kiện bằng chứng docs).

## AC-2 thêm

1. Integrator tạo issue con giao cho executor được 201, nghĩa là `tasks:assign` cho agent ở simple mode. Issue con có template con.
2. Issue con sửa đi qua reviewer, `done` thì integrator được đánh thức (`wakeReason=issue_children_completed`, `issueId` = issue gốc) và approve được stage 2.
3. Push lỗi ở stage 4: issue vẫn `in_review` ở stage 4 và `changesRequestedCount` không đổi. Owner comment thì integrator chạy lại.

Status: DONE
Summary: CHANGES_REQUESTED. N1 và n2 đóng; N2 đóng phần kẹt vòng (issue con do integrator tạo đi hết tới khi issue gốc quay lại stage integrator; không còn `PATCH blocked` của participant). Mới: 0 critical, 1 major (N3: issue con sửa dựng từ `origin/HEAD` thay vì `sha` cần sửa, dễ conflict lặp), 2 minor.
