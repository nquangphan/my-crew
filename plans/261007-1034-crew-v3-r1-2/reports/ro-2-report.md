# Báo cáo RO-2 — integrator merge và push sau khi owner duyệt

- SHA: `6cbddead5cd9fe48ca0027459b9803309ef64772` (nhánh `crew/r12-roles`, trên RO-1 `99b49c7c0`).
- File: `crew/agents/integrator.md` (mục "Sau khi owner duyệt: merge vào nhánh mặc định và push"), `crew/agents/instructions.test.mjs` (5 test: dòng mẫu `crew-docs-check`, `crew-commit`, `crew-merge` khớp regex; có mã lỗi; không dặn push ép).

```
$ node --test crew/agents/*.test.mjs
RED: ✖ dòng mẫu crew-merge của integrator đúng định dạng (trước khi viết mục merge)
GREEN: ℹ tests 14 / ℹ pass 14 / ℹ fail 0
```

## Quy trình đã viết

Kiểm chưa có comment `crew-merge` và `crew/req/<id>` còn đúng `commit=` của bằng chứng docs; fetch; nếu nhánh mặc định đã đi tiếp thì merge nó vào nhánh yêu cầu rồi chạy lại test + docs một lần; `git push origin HEAD:refs/heads/<mặc định>` không ép; comment dòng đầu `crew-merge sha=<40 hex> branch=<mặc định> pushed=<yes|no>`; `pushed=no` thì `blocked` kèm lý do.

## Đánh thức integrator: NEEDS_CONTEXT

Đã tìm trong fork: stock chỉ có hai đường đánh thức agent không phải assignee.

1. `@<tên integrator>` trong comment (route `issue_comment_mentioned`, `server/src/routes/issues.ts` ~14727, ~18153; docs `docs/guides/agent-developer/comments-and-communication.md`). Owner gõ mention ngay trong comment lúc bấm duyệt. Không cần code, nhưng phụ thuộc owner nhớ gõ.
2. Plugin: manifest cho phép capability `agents.invoke` (`packages/plugins/sdk/src/types.ts` ~1668: `ctx.agents.invoke(agentId, companyId, { prompt, reason })`). Stock không tự đánh thức khi issue gốc sang `done`.

Em không sửa `packages/crew-plugin/`. Đề xuất cho PG-1/owner:

- `manifest.ts`: thêm capabilities `agents.read`, `agents.invoke`, `issue.comments.read` (nếu chưa có).
- `worker.ts`: `registerIntegratorWake(ctx)` đăng ký sự kiện `issue.updated`; khi issue không có `parentId`, `status` chuyển sang `done`, company có `integratorAgentId` trong `CREW_POLICY_CONFIG` (dùng lại `loadCrewCompanyConfig`) và chưa có comment `crew-merge`: gọi `ctx.agents.invoke(integratorAgentId, companyId, { prompt: "Issue <identifier> đã được owner duyệt: merge crew/req/<identifier> và push theo instructions.", reason: "crew_merge" })`. Idempotency: bỏ qua nếu đã có run `crew_merge` cho issue. Test: sự kiện done của issue gốc → một lần invoke; issue con hoặc company không cấu hình → không invoke.
- Hệ quả cần biết: `invoke` ném lỗi khi integrator đang paused/terminated; worker nên ghi activity chứ không nuốt lỗi.

Chờ owner chọn (1) hoặc (2). Phần instructions integrator đã xong và dùng được với cả hai đường.

## Giả định và lệch plan

- Chưa kiểm tay đường `POST /comments` trên issue `done` không mở lại issue (chỉ đọc route: reopen chỉ khi cờ `reopen`/PATCH có comment đưa về `todo`); instructions dặn không gửi cờ đó. AC-2 nên kiểm.
- Issue `done` → `blocked` kích hoạt `crew.gate.cycle_reset` và xóa `executionState` (H2): ghi trong ledger là hệ quả chấp nhận.
- Integrator có thể không đẩy được vào nhánh bảo vệ của GitHub; instructions dẫn tới `pushed=no` + `blocked`.

## Sửa sau review

SHA `4f9dfc5f75f47163148774654b73861415a2d109`. Test: `node --test crew/agents/*.test.mjs` → pass 26, fail 0.

- C1: mục push mở đầu bằng "Xác minh qua API": `GET /api/agents/me`, `GET /api/issues/<id>`, `GET …/comments`. Chỉ push khi issue `done`, không `parentId`, `executionState.status = completed`, `lastDecisionOutcome = approved`, id stage cuối (loại `approval`) nằm trong `completedStageIds`, và bằng chứng `crew-docs-check exit=0|3` do chính integrator viết (`authorAgentId` = ME) khớp `git rev-parse crew/req/<id>`. Prompt đánh thức và comment của người khác không tính. Thiếu điều kiện thì không push, comment một lần `Integrator: không push — <lý do>`. Mốc vòng: H2 xóa `executionState` khi issue rời `done`, nên `completed` chỉ có trong vòng hiện tại.
- M1: chỉ `crew-merge … pushed=yes` đúng SHA hiện tại mới chặn; `pushed=no` cũ không chặn.
- M2: integrator chỉ merge đúng `sha` trong `crew-review sha=<40 hex> verdict=approved`; khác `crew-commit` mới nhất hoặc thiếu dòng này thì request changes. Test mẫu cập nhật (`crew-review` khớp regex, câu "Chỉ merge đúng `sha`").
- M3: không dán output thô, không chạy `git remote -v`; ghi mã thoát và tối đa 5 dòng lỗi đã lọc bằng `sed` đổi `scheme://user:pass@` thành `://***@` rồi `grep` các dòng `error|fatal|!|remote:`. Test kiểm câu cấm và mẫu `://***@`.
- Đã sửa nhỏ: `--no-edit` cho merge, E=2 kiểm `test -f`, vế phải của range, `origin/HEAD` dự phòng.

## Cho AC-2

Chép nguyên từ review (m8 và câu hỏi chưa giải quyết), thêm mục 8 từ phần sửa:

1. (m8a) reviewer/integrator `git show <sha>` được commit của executor — cần worktree cùng một kho git.
2. (m8b) `POST /comments` lên issue `done` không mở lại issue.
3. (m8c) agent `PATCH` được `done → blocked` và đăng comment khi không `checkout` issue, vì issue đã giao cho user owner, không phải agent; `integrator.md` cấm checkout; nếu API đòi checkout thì bước `blocked` thất bại và issue kẹt `done` kèm comment `pushed=no`.
4. (m8d) H2 cho agent chuyển rời `done` (`crew.gate.cycle_reset` ghi trong ledger là hệ quả chấp nhận, nhưng chưa có test DB cho actor là integrator).
5. API nào cho agent integrator thấy quyết định stage `approval` của owner (`executionState` hoặc decisions) để thực hiện C1? Instructions hiện dựa vào `executionState.status/completedStageIds/lastDecisionOutcome` trong `GET /api/issues/<id>`; AC-2 xác nhận agent đọc được các trường này, nếu không thì sửa điều kiện C1.
6. `api.sh` có `curl -f` (thoát khác 0 khi HTTP lỗi) không? Script đã tự kiểm thân trả về nên không phụ thuộc, nhưng cần biết để rõ mức nghiêm trọng.
7. Worktree reviewer/integrator có chung kho git với executor? (m8a)
8. `GET /api/issues/<id>/comments` trả `authorAgentId` và dòng đầu comment đầy đủ cho agent (C1 dựa vào đó); `GET /api/agents/me` trả `id`.

## Sửa sau re-review

SHA `7af4d280a4d08a65c2ef7aa3c6d188cedf1c482f`. Test: `node --test crew/agents/*.test.mjs` → pass 28, fail 0; `bash -n apply-roles.sh` sạch.

- N1: mục Gộp chỉ tính `crew-review` do agent reviewer viết (`authorAgentId` bằng participant của stage đầu trong policy của chính issue đó), mới nhất, khi issue đó `done` và `completedStageIds` chứa stage đầu; comment của executor hay người khác bị bỏ qua, issue thiếu thì không merge và request changes kèm lý do. Test kiểm các cụm `authorAgentId`, `completedStageIds`, `bị bỏ qua` nằm trong mục Gộp. Test không giả lập được comment executor (instructions là văn bản); AC-2 nên thử một comment `crew-review` giả của executor.
- n1: dặn lấy `(id <uuid>)` của prompt làm id issue gốc, đối chiếu `identifier`, lệch thì dừng.
- n2: thêm `sed` che `ghp_/gho_/ghu_/ghs_/ghr_`, `github_pat_`, `glpat-`, `xox[abp]-` ngoài phần URL, trước `grep`. Test kiểm các tiền tố có trong lệnh.
- n3: SHA so khớp là tip `crew/req/<id>` (`T`) sau merge cuối. Có `crew-merge sha=T … pushed=yes` của chính integrator thì dừng im trước mọi điều kiện khác. Bằng chứng docs khớp khi `commit=` bằng `T` hoặc bằng `T^1` (khi `T` là merge commit từ `origin/<mặc định>` của lần chạy trước), nên retry sau `pushed=no` không bị từ chối nhầm.
- n4: `executor.md` bỏ `--ignored`; chỉ xử lý `settings*.json`, script hook, `SKILL.md`, `.claude/agents|commands/*.md`, `.mcp.json` chưa track hoặc sửa dở; để nguyên log bị ignore (`.claude/hooks/.logs/`); có `crew-mac` thì chạy `crew-mac workflow-check`. Test cập nhật (không còn `--ignored`).

Thêm vào mục "Cho AC-2":

9. Board override không tạo `executionState` hoàn tất: sau `crew.policy.board_override`, `GET /issues/<id>` không được có `completed` kèm stage cuối trong `completedStageIds`.
10. `PUT instructions-bundle/file` trả JSON object (giả định của `verify-result.mjs`).
11. Comment `crew-review verdict=approved` do executor tự đăng trên issue của nó phải bị integrator bỏ qua (N1).

## Sửa sau re-review 2

SHA `5d274b8efbab7b291722dac14294f0e650c121d6`. Test: `node --test crew/agents/*.test.mjs` → pass 30, fail 0; `bash -n apply-roles.sh` sạch.

- N2: bỏ hẳn nhánh `T^1`. Integrator không tin tip hiện tại của `crew/req/<id>`: lấy `E` = `commit=` của bằng chứng `crew-docs-check` mới nhất do chính nó viết (chưa có thì dựng lại từ các `sha` `crew-review` hợp lệ), `git switch -C crew/req/<id> "$E"`, luôn merge lại `origin/<mặc định>`, chạy test + docs check trên tip mới `T`, ghi bằng chứng mới cho `T`, rồi push đúng `T` (kiểm `HEAD` vẫn bằng `T` ngay trước push). "Đã xong" nay đối chiếu bằng remote: có `crew-merge sha=X … pushed=yes` của chính nó và `X` là tổ tiên của `origin/<mặc định>` thì dừng im. Test kiểm thứ tự: dựng lại từ `E` < merge mặc định < bằng chứng cho `T` < push `$T:…`, và không còn cụm `$T^1`.
- n5: issue con đã leo thang cho owner sau 5 vòng: chấp nhận `crew-review … verdict=approved` do user owner viết (`authorUserId` bằng `responsibleUserId` hoặc user participant), vẫn đòi issue `done` và stage đầu trong `completedStageIds`; owner duyệt mà chưa có dòng đó thì không merge và comment nhờ owner đăng dòng đó. Em giữ yêu cầu dòng `crew-review` có `sha` vì không có đường khác lấy SHA đã duyệt từ decision.
- n6: `executor.md` bắt buộc chạy `crew-mac workflow-check --root <worktree> --plugin-dir <thư mục ghim>` trước khi báo xong (công cụ đã xét cả file ignore), không tự liệt kê bằng `git status`. Giả định: `crew-mac` nằm cùng thư mục với wrapper `crew-claude-run`; AC-2 xác nhận agent gọi được.

Thêm vào "Cho AC-2":

12. Sau khi một agent ghi `git update-ref refs/heads/crew/req/<id>` sang một commit con của `E` (trong kho dùng chung), integrator phải không push commit đó: nhánh được dựng lại từ `E`, `git log origin/<mặc định>` không chứa commit con.
13. Issue con bị leo thang sau 5 vòng và owner duyệt: integrator chỉ merge khi owner đã đăng dòng `crew-review sha=… verdict=approved`.
14. `crew-mac workflow-check` gọi được từ shell của agent trong run thật.

## Sửa sau re-review 3

SHA `8178de75c3bcf74ccf577b9f6c6986539c7c956f`. Test: `node --test crew/agents/*.test.mjs` → pass 31, fail 0.

- N3: "đã xong" chỉ khi comment `crew-merge … pushed=yes` của chính integrator **mới hơn** bằng chứng `crew-docs-check` mới nhất của nó và `X` là tổ tiên của `origin/<mặc định>`. Push của vòng duyệt trước cũ hơn bằng chứng vòng này nên không tính. Test kiểm cụm "pushed=yes mới hơn bằng chứng".
- n7: owner duyệt issue con leo thang nhưng thiếu dòng `crew-review`: ngoài comment, integrator `PATCH` issue gốc `blocked` kèm "chờ owner đăng crew-review sha=<sha> cho <issue con>".
- n8: `git fetch origin` lỗi thì dừng, không merge hay push bằng ref local; comment lý do đã lọc credential rồi `blocked`.
- n9: commit bằng chứng đổi thành `EVIDENCE`, mã thoát docs thành `DOCS_EXIT`; không còn ký hiệu `E` hai nghĩa (test kiểm không còn `E=<số>`, `$E`, `<E>`).

Thêm vào "Cho AC-2":

15. Issue đã push (`crew-merge … pushed=yes`), owner mở lại, giao thêm việc, duyệt lại tới `done`: integrator phải push vòng 2 (bằng chứng vòng 2 mới hơn `crew-merge` vòng 1).
16. Owner duyệt issue con leo thang mà chưa đăng `crew-review`: issue gốc chuyển `blocked` kèm lý do.
17. `git fetch origin` lỗi (ví dụ ngắt mạng): integrator không merge, comment lý do và `blocked`.

## Sửa sau review toàn nhánh

SHA `e227f0894d2b409247535a7a8866ddac3d31d3ba`. Test: `node --test crew/agents/*.test.mjs` → pass 35, fail 0, skipped 1 (test so regex với server, bỏ qua vì nhánh này chưa có `issue-policy.ts`). Em đã chạy thử test đó với bản `issue-policy.ts` của nhánh policy chép tạm vào cây: đạt, rồi hoàn nguyên cây (`git checkout -- server`, vì lệnh dọn dẹp lỡ xóa thư mục `server/` đã track; không còn thay đổi nào ngoài `crew/agents/`).

- M1: `reviewer.md` có mục "Issue gốc". Issue gốc chỉ gồm issue con: review tổng, không đòi `crew-commit` trên issue gốc; mỗi con phải `done`, stage reviewer đầu trong `completedStageIds`, có `crew-review` hợp lệ khớp `crew-commit` mới nhất; kiểm acceptance criteria của gốc được phủ; approve bằng `crew-review root children=<id,…> verdict=approved`. Issue gốc executor làm thẳng: review như issue con.
- M2: bước Gộp nhận việc của chính issue gốc khi nó `in_review` ở stage integrator (`currentParticipant.agentId` là ME) và stage đầu nằm trong `completedStageIds`, không đòi `done`. Issue gốc không có `crew-commit` thì không có gì để merge từ nó; có thì merge theo `crew-review sha=`. Issue con vẫn đòi `done`.
- m2: `mergeAgentConfig` (nên `apply-roles.sh agent` thoát 2) từ chối `adapterConfig.command` không phải đường dẫn tuyệt đối kết thúc `/.crew/bin/crew-claude-run`.
- m3: `policy-config.mjs` đòi `companyId` là uuid, ghi key viết thường, thay entry cũ khác hoa thường, từ chối file cũ đã có hai key trùng khi bỏ hoa thường.
- m6: giữ regex chép tay trong test và thêm test đọc `server/src/crew/issue-policy.ts` bằng văn bản, so chuỗi `CREW_DOCS_CHECK_RE` với regex của test; bỏ qua khi file chưa có (nhánh chưa tích hợp), chạy khi nhánh tích hợp `crew/r1-2`.

Thêm vào "Cho AC-2":

18. Một yêu cầu có 2 issue con và issue gốc không commit, và một yêu cầu executor làm thẳng issue gốc: cả hai đi qua reviewer stage 1 và integrator Gộp mà không bị request changes oan.
19. Chạy `node --test crew/agents/*.test.mjs` trên nhánh tích hợp để test so regex không bị skip.

## O9

SHA `7eca19838738a58ef6bcd8510765ccc10028236f`. Test: `node --test crew/agents/*.test.mjs` → pass 35, fail 0, skipped 1 (so regex với server, chỉ chạy khi có `issue-policy.ts`). Mục "Đánh thức integrator" phía trên không còn hiệu lực: stock đánh thức integrator ở stage 4, không plugin, không @mention.

- `integrator.md` đổi mục push thành "Stage 4": chạy khi issue gốc `in_review`, `currentParticipant.agentId` là ME, stage owner (`approval`) nằm trong `completedStageIds` và `lastDecisionOutcome` là `approved`. Id issue lấy từ context run (issue đang giao cho bạn). Bỏ phần đọc prompt plugin và `(id <uuid>)`.
- Quy trình: dựng lại nhánh từ `EVIDENCE`, merge lại `origin/<mặc định>`, test + docs, **bằng chứng mới cho tip `T` ghi trước push và trước `crew-merge`** (H2 so `sha` với `commit=` bằng chứng mới nhất), push đúng `T`, comment `crew-merge sha=<T> branch=<mặc định> pushed=yes`, rồi `PATCH done` (approve stage 4). Push lỗi: `crew-merge … pushed=no` + `blocked`.
- "Đã xong" giữ như N3 (`crew-merge pushed=yes` mới hơn bằng chứng mới nhất và `X` là tổ tiên của `origin/<mặc định>`), nhưng thay vì dừng im thì nhảy tới bước `PATCH done` để hoàn tất stage mà không push lại (trường hợp push xong nhưng PATCH lỗi).
- Thiếu điều kiện xác minh: comment lý do + `blocked`, không push. Mục Gộp ghi rõ là stage 2 (stage owner chưa trong `completedStageIds`).
- Test: dòng mẫu `crew-merge` (điền `yes`) khớp `^crew-merge sha=([0-9a-f]{40}) branch=(\S+) pushed=yes$`; thứ tự bằng chứng mới < `crew-merge` < `PATCH done`; không còn chữ plugin, mention, prompt, `(id <uuid>)`.

Thêm vào "Cho AC-2":

20. Stage 4 thật: sau khi owner duyệt, stock đánh thức integrator kèm issue context; integrator push, comment `crew-merge … pushed=yes` và `PATCH done` được (H2 chấp nhận); tip đổi so với bằng chứng cũ vẫn qua nhờ bằng chứng mới ghi trước.
21. Push lỗi (ví dụ nhánh bảo vệ): `crew-merge … pushed=no` rồi `blocked`, không có `done`.
22. Integrator ở stage 4 đọc được `executionState.currentParticipant` và biết issue đang giao cho mình từ context run.

## Sửa sau re-review toàn nhánh

SHA `2f9003a23312168804a3e9253b7fba67b4419030`. Test: `node --test crew/agents/*.test.mjs` → pass 37, fail 0, skipped 2 (hai test so regex với server, bỏ qua vì nhánh này chưa có `issue-policy.ts`). Em chạy lại bộ test trên một bản sao trong `mktemp -d` kèm `issue-policy.ts` của nhánh policy: pass 22, fail 0, skipped 0, tức cả `CREW_DOCS_CHECK_RE` lẫn `CREW_MERGE_RE` khớp. Không có file tạm nào trong cây làm việc.

- N1: stage 4 nhận diện bằng `executionState.currentStageId` = id stage push (stage `review` cuối, sau stage `approval`) cùng `currentParticipant.agentId` = ME và id stage owner trong `completedStageIds`; bỏ điều kiện `lastDecisionOutcome`. Push lỗi hoặc thiếu điều kiện: không đổi status, comment `crew-merge … pushed=no` kèm lý do (đã lọc credential) và nhờ owner xử lý rồi comment để đánh thức lại integrator; lần chạy sau dựng lại từ `EVIDENCE`. Đã bỏ câu "issue rời `in_review` thì mở lại vòng duyệt".
- Rà `PATCH blocked` của participant đang chờ duyệt: bỏ ở `integrator.md` (fetch lỗi, chờ owner đăng `crew-review`, `DOCS_EXIT=2`, push lỗi, thiếu điều kiện xác minh) và `reviewer.md` (không review được vì môi trường). Thay bằng chỉ comment lý do, không đổi status. `in_progress` chỉ còn ở reviewer cho lỗi code của executor. `executor.md` giữ `blocked` (executor không phải participant duyệt).
- N2: `integrator.md` thêm mục "Yêu cầu sửa": không `PATCH in_progress` trên issue gốc; việc cần executor làm thêm (code lỗi, conflict, commit chưa được review) đi qua issue con mới (`parentId` = issue gốc, giao cho executor, không gửi `executionPolicy`, không giao reviewer/integrator), comment trên issue gốc rồi chờ. `executor.md` mô tả issue con đó và dặn không sửa thẳng trên issue gốc. Giả định: con xong thì stock đánh thức lại assignee issue gốc (là integrator); AC-2 kiểm.
- n2: test đối chiếu chuỗi `CREW_MERGE_RE` với `server/src/crew/issue-policy.ts` bằng đọc văn bản (skip khi file không có).

Thêm vào "Cho AC-2":

23. Push bị từ chối một lần, owner sửa rồi comment: integrator chạy lại và push được; `changesRequestedCount` không tăng; status vẫn `in_review`.
24. Integrator tạo issue con sửa code của issue gốc: con qua reviewer, xong thì integrator được đánh thức và merge `sha` đã review của con.
25. Một comment của owner trên issue `in_review` giao cho integrator có đánh thức integrator hay không (giả định của N1).

## Sửa sau re-review 2 toàn nhánh

SHA `d3f4ec5f35ab863f05762cebb0c49e5aab5f1e15`. Test: `node --test crew/agents/*.test.mjs` → pass 38, fail 0, skipped 2 (hai test so regex với server, chỉ chạy khi có `issue-policy.ts`). Chỉ đổi chữ instructions và test mẫu.

- N3: mô tả issue con sửa lỗi do integrator tạo có dòng riêng `crew-fix base=<40 hex sha cần sửa>`. `executor.md`: thấy dòng đó thì `git switch -c crew/<identifier> <base>`, không từ `origin/HEAD`. `reviewer.md`: loại issue này xem `git diff <base>..<sha>` và kiểm điểm cần sửa đã được xử lý. Test mẫu: dòng `crew-fix` khớp `^crew-fix base=[0-9a-f]{40}$`, và ba file dẫn đúng lệnh.
- n3: issue con sửa giao cho executor đã làm issue chứa `sha` cần sửa (tác giả `crew-commit` đó), không mặc định executor của issue gốc.
- n4: xem "Cho runbook của lead" ngay dưới.

## Cho runbook của lead

Test hỏng ở stage 4 sau khi merge nhánh mặc định mới (nhánh mặc định đã đi tiếp làm cây merged hỏng): integrator ở stage 4 chỉ comment lý do `crew-merge … pushed=no`, không đổi status (stock sẽ hiểu là yêu cầu sửa). Owner (board) mở lại vòng bằng cách `PATCH` issue gốc `in_progress` hoặc gửi lại policy; vòng mới đi lại stage 1–4 và integrator dựng lại nhánh từ bằng chứng mới. Việc sửa code do issue con mới đảm nhiệm.
