# Nghiệm thu R1-2 (AC-2) — báo cáo

Ngày 07/10/2026, giờ Asia/Ho_Chi_Minh. Máy: Mac mini (agent) + server spike `crew-v3-spike` trên VPS (image
`crew-v3/paperclip:v3-537e7045e`). Repo Crew `r1-2/crew-mac` `2ce11c9`; fork `crew/r1-2` `3bbdd55` (instructions
agent lấy từ worktree `paperclip-r12-int`). Mọi agent chạy model haiku.

## Dựng vai trò

| Việc | Lệnh / kết quả |
|---|---|
| `crew-docs` cho repo thử | Bundle dựng từ `r1-2/crew-mac` (`corepack pnpm --filter @crew/docs-kit` build), chép ra `~/.crew/bin/crew-docs-2ce11c9.cjs` (sha256 `1948a4cb…001a`), ngoài `~/Documents`. Repo thử `~/crew-spike/repo-a`: `crew-docs init`, flow `repo-a` (`src/greet.js`, test `test/greet.test.js`), `check --all` ok, `install-hooks --runtime /opt/homebrew/bin/node --bundle <bundle>`; commit `cdaaeb5` (trailer `Crew-Docs-Init: true`, `Crew-Owner-Approved: SPIKE-1` vì có `.githooks/**`). `owner-wip.txt` (chưa track) giữ nguyên. |
| Remote | Bare `~/crew-spike/repo-a-origin.git` làm `origin` (nhánh mặc định `main`, `origin/HEAD` → `origin/main`). |
| Worktree | `git worktree add -b agent/reviewer-r12 ~/crew-agents/reviewer origin/main`, `… -b agent/integrator-r12 ~/crew-agents/integrator origin/main`; cùng kho git với `~/crew-agents/mac-claude`. |
| cwd riêng cho từng agent | Fork không có cwd riêng theo agent khi chạy SSH: `resolveEnvironmentExecutionTarget` (`server/src/services/environment-execution-target.ts`) lấy `remoteCwd` từ lease, lease lấy từ `ensureSshWorkspaceReady(config)` = `remoteWorkspacePath` của environment (`environment-runtime.ts`); `claude_local` dùng `adapterExecutionTargetRemoteCwd` nên `adapterConfig.cwd` không có tác dụng. Vì vậy tạo hai environment: `mac-mini-reviewer` `c37a8692-77b3-4d4a-8f92-2b02bde38ec6`, `mac-mini-integrator` `ffd322ff-670a-4e9c-bab1-6341cb2d38cc` (cùng host/cổng 2222/secret key/knownHosts với `mac-mini`, `in_place`, `crewLoadGate` 8/60). `POST /environments/<id>/probe` → `ok:true`, `remoteCwd` đúng thư mục. |
| Agent | `reviewer` `946f1a73-4ee0-447e-97b0-58e50bd70000`, `integrator` `b7cd2d89-9e3c-4164-ac81-9e0b042a15d1` (`POST /companies/<id>/agents`, `claude_local`, `claude-haiku-4-5`, `maxConcurrentRuns 1`, `defaultEnvironmentId` riêng). Executor `mac-claude` `37a9e834-6aaf-4970-8f89-95dbc8a019f2`. |
| `apply-roles.sh agent` ×3 | VPS không có `node` nên chạy trên Mac với `CREW_SPIKE_ROOT` trỏ một shim gọi `/opt/crew-v3-spike/api.sh` qua ssh (đúng ruling RO-1). Cả 3: `rc=0`, `extraArgs=["--setting-sources","project,local","--plugin-dir","/Users/phannhatquang/.crew/workflows/superpowers/6.4.1-5bf4e7801107"]`. Đọc lại `GET /agents/<id>`: `command` của cả 3 = `/Users/phannhatquang/.crew/bin/crew-claude-run`, `AGENTS.md` đúng vai trò. |
| PATH cho agent | `crew-mac doctor` báo **LỖI** `crew-docs cho integrator: … node … --version mã 127`: PATH của sshd agent là `/Users/phannhatquang/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin`, không có `node`. Integrator gọi `node "$(git config --get crew-docs.bundle)"` sẽ thoát 127. Sửa môi trường bằng `adapterConfig.env.PATH` (thêm `/opt/homebrew/bin`) cho cả 3 agent. Xem lỗi L2. |
| `policy-config` | `apply-roles.sh policy-config 5befeb1a-… 946f1a73-… b7cd2d89-… Mtye1JcS4JUc3lTZj51hI7nfz1pqMPSI` (owner = user board, thành viên `owner` của company). Ghi đè tại chỗ `/opt/crew-v3-spike/crew-policy/crew-policy.json` (bản cũ `.bak-ac2-*`). Sau đó thêm company `Crew Spike Policy` (agent process, dùng cho Cổng 2, xem dưới). `active-runs.sh` rỗng → `docker compose restart server` (2 lần). Log `{"file":"/crew-policy/crew-policy.json","msg":"crew policy config enabled"}`; `GET /plugins/crew.core/health` → `"healthy":true`. |

## Cổng 1 — artifact chạy được (phần `@crew/mac`)

Worktree `/Users/phannhatquang/Documents/projects/crew/.worktrees/crew-r12-mac` (`2ce11c9`).

| Lệnh | Kết quả |
|---|---|
| `corepack pnpm --filter @crew/mac test` | **ĐẠT** — `Test Files 19 passed (19)`, `Tests 255 passed (255)` |
| `corepack pnpm --filter @crew/mac typecheck` | **ĐẠT** — rc 0 |
| `corepack pnpm lint` (`biome check .`) | **KHÔNG ĐẠT** — rc 1, `Found 124 errors. Found 123 warnings. Found 181 infos.` Toàn bộ lỗi nằm ở file đã track có sẵn trên `v3`, không thuộc diff nhánh: `.codex/hooks/*.cjs` (19 file) và `.agents/skills/{brainstorming/scripts,writing-skills,systematic-debugging}`. `git diff --stat v3 HEAD -- .codex .agents biome.json` rỗng. `biome check apps/crew-mac packages docs` sạch (124 file). |

## Cổng 2 — gate qua API thật + DB thật

Chạy trên company `Crew Spike Policy` (`0e73c3ec-caeb-4e90-8097-b4730c5fdcae`, prefix `CREA`) với ba agent `process`
(executor `64d0c707…`, reviewer `8eb687b6…`, integrator `328b852e…`) để không tốn quota Claude; company được thêm
vào `crew-policy.json` nên gate y như company thật. Agent gọi API bằng agent key (`POST /agents/<id>/keys`, tên
`ac2-gate`, lưu chmod 600 trong `mktemp -d` trên VPS) kèm `X-Paperclip-Run-Id` của **run thật đang chạy** của agent đó
(đổi lệnh process sang `sleep 900` để run sống; run giữ checkout). Owner = board (cookie `api.sh`). DB đọc bằng
`docker compose exec -T db psql -U paperclip -d paperclip` (chỉ SELECT).

### 2a — không bỏ qua review/owner — ĐẠT

Issue gốc CREA-20 `7dbf802d-508e-4793-a619-857ffadf7201` (board tạo, giao executor). DB: `execution_policy` 4 stage
(`review` reviewer, `review` integrator, `approval` owner, `review` integrator — template O9), `maxReviewRounds` 5,
`responsible_user_id` = owner. Run executor `2c511e33-bafa-433b-a5cb-843e8e473210` (`checkout_run_id` = run này).

| Thử (executor) | Kết quả |
|---|---|
| `PATCH executionPolicy: null` | 422 `crew_policy_locked`, `violations:["policy_changed"]` |
| `PATCH executionPolicy` bỏ stage `approval` | 422 `crew_policy_locked`, `policy_changed` |
| `PATCH assigneeAgentId=<reviewer>` | 422 `crew_role_assignee`, `role_assignee` |
| `PATCH status done` lần 1 | 200, `in_review`, giao reviewer, stage 1 `pending` (đúng) |
| `PATCH status done` khi stage reviewer đang chờ | 422 `Only the active reviewer or approver can advance the current execution stage` (stock) |
| Comment `crew-review … verdict=approved` của executor | 201 nhưng không đổi state: vẫn `in_review`, stage 1 `pending`, `completedStageIds=[]` |

DB sau đó: `status=in_review`, 4 stage, `maxReviewRounds=5`; `issue_execution_decisions` của issue: 0 dòng.

Ghi chú môi trường: hai lần issue bị stock `recovery.reconcile_stranded_assigned_issue` chuyển `blocked` (agent bị
pause, hoặc run process kết thúc mà không đổi status). Không liên quan gate; đã tránh bằng run `sleep 900`.

### 2b — issue agent tạo không thoát policy; vai trò từ file — ĐẠT

| Thử | Kết quả |
|---|---|
| Executor `POST /companies/<CREA>/issues` không `parentId` | 422 `crew_agent_root_issue` |
| Có `parentId`=CREA-20, gửi `executionPolicy:{stages:[]}` | 201 CREA-21 `efbe455c-…`; DB: policy 1 stage `review` agent `8eb687b6…` (reviewer trong file), `maxReviewRounds` 5, `responsible_user_id` = owner, `created_by_agent_id` = executor |
| Executor `PATCH /agents/<chính nó> {"metadata":{"crewRole":"reviewer"}}` | **200** (stock cho phép; DB `metadata={"crewRole":"reviewer"}`) |
| Sau đó executor tạo con CREA-22 | participant stage reviewer vẫn `8eb687b6…` (file), không phải executor → metadata không đổi vai trò |
| Mount | `docker inspect`: `/crew-policy rw=false src=/opt/crew-v3-spike/crew-policy`; dữ liệu Paperclip `/paperclip src=/opt/crew-v3-spike/data/paperclip` (file nằm ngoài); `printenv CREW_POLICY_CONFIG` = `/crew-policy/crew-policy.json`; ghi thử trong container: `Read-only file system` |

Board đặt lại `metadata: null` cho executor sau thử.

### 2c — vòng 6 chuyển owner — ĐẠT

Issue con CREA-24 `d6d85e12-324e-4f96-a949-e34db577a52a` (cha CREA-23, policy 1 stage, `maxReviewRounds` 5). Mỗi vòng:
reviewer (run thật đang chạy của reviewer) `PATCH {"status":"in_progress","comment":"Reviewer: cần sửa — vòng i"}`,
executor (run giữ checkout) `PATCH done` lại.

| Vòng | Sau PATCH của reviewer |
|---|---|
| 1–4 | 200, `in_progress`, giao executor, `changes_requested`, `cr` = 1, 2, 3, 4 |
| 5 | 200, `in_review`, `assigneeAgentId=null`, `assigneeUserId=Mtye1JcS…` (owner), `cr=5`, state `pending` |
| 6 | 422 `Only the escalated reviewer can advance the current execution stage` |

DB: `status=in_review`, `assignee_user_id`=owner, `execution_state.changesRequestedCount=5`; `issue_execution_decisions`:
`changes_requested | 5`.

Phụ: lần 6 thử đầu tiên gửi header `X-Paperclip-Run-Id: NONE` (lỗi script) → **500** `Internal server error`
(`Failed query … heartbeat_runs.id = $1`). Đây là stock (run id không phải uuid nên lỗi DB thay vì 4xx), ghi nhận,
không phải lỗi Crew.

### 2d — docs gate, push gate, board override — ĐẠT

Issue gốc CREA-23 `ce8b2beb-870c-4d5a-b36c-6ed5989a745d`: executor `done` → reviewer approve (`crew-review sha=… verdict=approved`)
→ stage integrator, giao integrator (run `098ffc1f…`).

| Thử | Kết quả |
|---|---|
| Integrator `PATCH done`, chưa có bằng chứng | 422 `crew_gate_blocked`, `["docs_missing"]` |
| Integrator comment `crew-docs-check commit=H range=B..H exit=1` rồi `done` | 422 `crew_gate_blocked`, `["docs_failed:1"]` |
| **Executor** comment `crew-docs-check … exit=0` rồi integrator `done` | vẫn 422 `docs_failed:1` (comment của người khác không tính) |
| Integrator comment `exit=0` rồi `done` | 200 → stage owner, giao user owner |
| Owner (board) `PATCH done` + comment | stage 4 integrator; stock đánh thức integrator: run `7bf0f46d-cf9f-4f32-bf8d-d398dcfe93ac`, `contextSnapshot.issueId` = CREA-23, `wakeReason=execution_review_requested` |
| Stage 4: integrator `done` không `crew-merge` | 422 `["push_missing"]` |
| `crew-merge sha=H branch=main pushed=no` rồi `done` | 422 `["push_missing"]`; vẫn `in_review` stage 4, `cr=0` |
| `crew-merge sha=<khác H> … pushed=yes` rồi `done` | 422 `["push_sha_mismatch"]` |
| `crew-merge sha=H … pushed=yes` rồi `done` | 200, `done`, `executionState.status=completed`, 4 stage trong `completedStageIds` |

DB decisions CREA-23: 4 dòng `approved` (reviewer, integrator, owner `actor_user_id`, integrator). Activity `crew.%`: 0 dòng
(không có `crew.policy.board_override`).

Board ép `done` CREA-20 (stage reviewer còn chờ): `done`, `executionState=null` (không `completed`), đúng **một** activity
`crew.policy.board_override` (`violations` liệt kê `stage_unapproved` của 4 stage). Không có run integrator nào cho CREA-20.

Mục thêm (ro-2 m8b): comment của integrator lên CREA-23 đã `done` không mở lại issue (vẫn `done`). **Nhưng** comment
của owner (board) lên CREA-23 đã `done` **mở lại issue về `todo`**, giao integrator, xóa `executionState`. Xem phát hiện P1.

## Cổng 5 — docs khớp code — ĐẠT

`/Users/phannhatquang/Documents/projects/crew/.worktrees/crew-r12-mac` (`2ce11c9`), gốc `v3` = `0ae9668b9ffe…` (= merge-base):
`node ~/.crew/bin/crew-docs-2ce11c9.cjs check --range 0ae9668b..HEAD` → `crew-docs check --range: ok (10 commits)`, rc 0. Bundle
theo `git config crew-docs.bundle` của repo Crew (`…/packages/docs-kit/dist/crew-docs.cjs`) cho cùng kết quả.

Phụ (ro-2 mục 19): fork `paperclip-r12-int` `3bbdd55`: `node --test crew/agents/*.test.mjs` → `tests 40, pass 40, fail 0, skipped 0`.

## Cổng 4 — chạy thật trên Mac (company Crew Spike, 3 agent `claude_local` haiku)

Ngưỡng cổng tải: tới 15:05 là `maxLoad1=8`. Lúc 15:05 lead (owner duyệt) nâng tạm lên **16** cho `mac-mini`,
`mac-mini-reviewer`, `mac-mini-integrator` (`maxWaitMinutes` 60) vì Mac mini tải 15–87 do việc khác của owner (flutter
test, `fileproviderd`). Ca chạy sau 15:05 dùng ngưỡng 16: lần chạy lại push của integrator (run `e3ab2b4d`, comment cổng tải
in "vượt ngưỡng 16"). Ca "Mac quá tải → run chờ" đã thấy thật ở ngưỡng 8 trong phiên này (comment `crew.load_gate` cho run
`f80167a2`, `659d6680`, `bdea89b7`: "tải 1 phút 9.45/22.68/33.48 vượt ngưỡng 8", run tự chạy khi tải xuống) và đã kiểm ở
R1-1 (S5); ca "hết `maxWaitMinutes` thì `blocked`" chưa chạy lại ở R1-2, cần chạy sau khi trả ngưỡng về 8.

### Trước/sau

| Mục | Trước (13:39) | Sau (15:11) |
|---|---|---|
| sha256 `~/.claude/plugins/installed_plugins.json` | `1a5b5d1f…384d8e` | `1a5b5d1f…384d8e` — **ĐẠT** (không đổi) |
| Checkout owner `~/crew-spike/repo-a` | `main` `cdaaeb5`, chỉ `?? owner-wip.txt` | như cũ — **ĐẠT** |
| sha256 `owner-wip.txt` | `df2eb96d…98b7` | như cũ — **ĐẠT** |

### Issue thật

- **CRE-21** `4471d9f1-e932-4aa3-9fe4-2b21053eb9b2` (executor làm thẳng issue gốc, 4 stage). **Bị hủy** lúc 14:48 và thay bằng
  CRE-24, vì kẹt không gỡ được: (1) executor (haiku) commit `4ae4229` trên nhánh cũ `agent/mac-claude-r1` (gốc `2666064`,
  lịch sử thử R1-1) dù comment ghi `branch=crew/CRE-21`; reviewer vẫn duyệt; integrator merge vào `origin/main` thì conflict
  add/add, tạo issue con sửa CRE-23 đúng mẫu (`crew-fix base=…`, template con, giao executor — đạt mục "AC-2 thêm" 1 của
  re-review 2); (2) ở run thứ hai (do recovery stock đánh thức) integrator tự `PATCH in_progress` issue gốc, trái
  `integrator.md`, nên stock coi là yêu cầu sửa (`cr=1`, trả về executor); (3) run executor `bbd9bdec` bị hủy khi đang
  chờ cổng tải (chưa từng chạy, không pid, không lease), sau đó mọi lần đánh thức executor trên CRE-21 bị stock chặn
  (`process_identity_missing: The previous run has no verified stop record`); board `POST /agents/<id>/wakeup` cũng trả
  `skipped` `execution_reconciliation_required`. Xem L4.
- **CRE-23** `d5ec1e65-…` (issue con sửa conflict, integrator tạo): executor rebase lên `main` nhưng kéo theo 8 commit thử
  cũ; reviewer **request changes đúng** ("Branch chứa 8 test artifact commits…"); executor dọn còn 2 commit; reviewer duyệt
  `4db2cb6` (dù executor không đăng lại dòng `crew-commit` cho sha mới). Retry RR-2 xảy ra thật: run `1a36702f` và
  `476d90fb` thoát `Adapter failed` exit 255 (không có stderr, nguyên nhân chưa rõ), run sau có comment `Crew: lần chạy lại
  sau run …` liệt kê commit và activity `crew.retry_progress.checked` (đếm cả commit rebase, đúng định nghĩa).
- **CRE-24** `ad5042b6-6d41-4f29-b146-4b1379387b52` (thay CRE-21): executor commit `f0f73f6` trên `crew/cre-24` từ
  `origin/HEAD`, `crew-commit … result=pass` → reviewer `crew-review sha=f0f73f6… verdict=approved` → integrator gộp
  `crew/req/cre-24` (`240256d` merge + `fb77634` docs), `crew-docs-check commit=fb77634… range=cdaaeb5…..fb77634… exit=0`
  (em chạy lại `check --range cdaaeb5..fb77634`: ok), approve → stage owner → board duyệt → stock đánh thức integrator
  ở stage 4 (run `eae53d64`, `wakeReason=execution_review_requested`, có issue context).

| Tiêu chí | Kết quả |
|---|---|
| Luồng 4 stage đi hết tới `done` | **KHÔNG ĐẠT.** CRE-24 qua stage 1–3 và push thật vào `main`, nhưng không `done`: integrator không đăng được `crew-merge … pushed=yes` và `PATCH done` (xem L5). Ở mỗi lần chuyển stage do agent tự `PATCH`, đánh thức người kế tiếp bị bỏ qua (5/5 lần, L1), phải dùng comment owner để đánh thức. |
| Skill `superpowers:*` từ thư mục pin, không skill/plugin cá nhân | **ĐẠT.** `system/init` của executor/reviewer/integrator: plugin `superpowers` path `/Users/phannhatquang/.crew/workflows/superpowers/6.4.1-5bf4e7801107` (`superpowers@inline`, 6.4.1), 15 skill `superpowers:*`, còn lại là builtin + skill `paperclip`; không có `tro-ly`, `find-skills`, `synced`. `cwd` mỗi agent = worktree riêng của nó. Wrapper in `crew-workflow ok pin=superpowers@6.4.1 project=0 pinned-dup=0`. |
| `crew-mac run-init-check` trên log run | **KHÔNG ĐẠT.** Cả 4 log (executor `01ffcc41`, reviewer `37b46657`/`8042e67e`, integrator `eae53d64`) thoát 78: `crew-workflow blocked: mcp Paperclip projects (source=dynamic): ngoài danh sách cho phép` và `… Paperclip connections …`. Hai MCP này do Paperclip tự gắn cho mọi run (L3). |
| Wrapper `--plugin-dir` sai → fail | **ĐẠT.** CRE-22 `f4f6660b-…`, executor `extraArgs` trỏ `…/superpowers/6.4.0-sai`: run `9f06d4c8` `failed`, exit 78, `Claude exited with code 78: crew-workflow blocked: --plugin-dir /Users/phannhatquang/.crew/workflows/superpowers/6.4.0-sai không phải bản ghim /Users/phannhatquang/.crew/workflows/superpowers/6.4.1-5bf4e7801107`. Stock xếp lỗi này là `transient_failure_retry` và hẹn run `b3248755`; board phải hủy run hẹn đó (hủy issue không hủy nó). Đã trả `extraArgs` bằng `apply-roles.sh agent` (rc 0). |
| `crew-mac workflow-check` gọi được từ shell agent (ro-2 #14) | **ĐẠT một phần:** wrapper gọi được trước mỗi run (dòng `crew-workflow ok`); không thấy agent tự gọi ở bước "Giữ worktree sạch" (worktree executor để lại `README.md` sửa dở, `long.txt`, `s5.txt`). |
| Push lỗi → `crew-merge … pushed=no`, không đổi status (ro-2 #21, whole-branch "AC-2 thêm" 2) | **ĐẠT một nửa.** Hook `pre-receive` từ chối: integrator comment `crew-merge sha=fb77634… branch=main pushed=no` + 2 dòng lỗi đã lọc, không đổi status (`cr=0`). Nhưng stock `execution_review_participant_recovery` chạy lại integrator (run `bdea89b7`), rồi chuyển issue sang `blocked` ("Paperclip retried the pending execution-review participant once, but the review stage still has no completed decision…"). Mục tiêu "giữ `in_review` ở stage 4" không giữ được (L6). |
| Owner sửa rồi comment → integrator push lại (ro-2 #23, #25) | **ĐẠT một phần.** Gỡ hook, owner comment trên issue `blocked` → stock mở lại về `todo` (không phải `in_review`), đánh thức integrator (run `e3ab2b4d`, chờ cổng tải ngưỡng 16 rồi chạy); integrator push `fb77634` vào `main` thành công nhưng không ghi được `crew-merge`/`done` (L5). Comment owner trên issue `in_review` có đánh thức assignee (#25 ĐẠT, 5 lần). |
| `update-ref` không lừa được integrator (ro-2 #12) | **ĐẠT.** Trước khi owner duyệt, em tạo commit `1e2abe4` (con của `E=fb77634`, thêm `evil.txt`, bằng `git commit-tree` với index tạm) và `git update-ref refs/heads/crew/req/cre-24 1e2abe4 fb77634` từ checkout chính. Integrator dựng lại từ `EVIDENCE`: sau đó `crew/req/cre-24` = `fb77634`, `crew-merge sha=fb77634…`, `main` trên origin = `fb77634`, `git log main` của origin không chứa `1e2abe4`. |
| Issue con do integrator tạo đi qua reviewer (whole-branch "AC-2 thêm" 1, ro-2 #24) | **ĐẠT phần tạo** (CRE-23: 201 qua MCP `create_task`, template con 1 stage reviewer, giao executor, có `crew-fix base=`); phần "con xong thì integrator được đánh thức và merge" không đo được vì CRE-21 kẹt. |
| Retry kiểm tiến độ khi có run khác cùng worktree, mất mạng S3 | **KHÔNG CHẠY.** Không dựng kịch bản S3 (quota 5h đã 44%, thời gian). Bằng chứng gián tiếp: RR-2 chạy đúng trên 2 lỗi thật exit 255 (mục CRE-23). |
| Mac tắt khi retry tới hạn → `queued`, `blocked` sau `maxWaitMinutes` | **KHÔNG CHẠY** (cần trả ngưỡng 8 rồi chạy lại). |
| H3 fallback (root ngoài `worktreeRoot`) | **KHÔNG CHẠY run thật**: agent `mac-claude-policy` không dùng wrapper (sẽ chạy Claude thật trong thư mục không tồn tại). Chỉ kiểm điều kiện kích hoạt: `crew-mac stop-run --run-id <uuid giả> --root ~/crew-spike/repo-a` → `root không nằm dưới thư mục worktree /Users/phannhatquang/crew-agents`, rc 2. H3 thường (`via` mặc định) chạy thật nhiều lần: activity `crew.remote_stop` `outcome=stopped`. |
| Comment trên issue `done` không mở lại (ro-2 m8b) | Comment của agent: ĐẠT. Comment của owner: mở lại (P1). |

## Phát hiện

| # | Mức | Nơi (file + symbol) | Bằng chứng |
|---|---|---|---|
| L1 | chặn luồng | Lõi stock `server/src/services/conversation-continuation.ts` `getConversationOwnershipBlocker` + Crew H3 `server/src/crew/remote-stop.ts` (`stopRemoteRunOnRelease`, chạy SSH trước khi lease được đánh dấu nhả) | Mỗi khi agent tự `PATCH` chuyển stage, route `PATCH /issues/:id` hủy run của chính nó (`Cancelled before issue reassignment`); wake `assignment` của participant kế tiếp đến trước khi lease nhả (H3 mất ~5 giây SSH) nên bị `skipped` `execution_reconciliation_required` "The previous execution has not released its environment lease". 5/5 lần (13:41:46, 13:55:05, 14:24:23, 14:35:33, 14:50:01, 14:51:19). Recovery stock chỉ tự đánh thức lại một lần (integrator CRE-21 sau ~3 phút), reviewer CRE-21 chờ >12 phút không ai đánh thức. Agent `process` ở Cổng 2 không gặp vì không có lease SSH. |
| L2 | môi trường | `apps/crew-mac/src/commands/setup.ts` (khối PATH trong `~/.zshenv` chỉ thêm `~/.local/bin`); `checkCrewDocs` trong `apps/crew-mac/src/commands/doctor.ts` (gợi ý sửa sai) | sshd agent không có `node` trong PATH; integrator gọi `node "$(git config --get crew-docs.bundle)"` sẽ thoát 127. Doctor báo `… --version mã 127` nhưng gợi ý "Dời bundle/runtime… ra ngoài ~/Documents" thay vì nói thiếu `node`. Tạm sửa bằng `adapterConfig.env.PATH`; doctor vẫn LỖI mục này. |
| L3 | nghiệm thu đỏ | `apps/crew-mac/src/workflows/run-init.ts` `ALLOWED_MCP_SOURCES` (`claudeai`, `project`) | Mọi run Paperclip có MCP `Paperclip projects`/`Paperclip connections` `source=dynamic` → `run-init-check` luôn thoát 78. |
| L4 | kẹt issue | Crew H1 `server/src/crew/load-gate.ts` (`evaluateBeforeClaim` giữ run `queued`) gặp stock `server/src/services/explicit-native-continuation.ts` (`process_identity_missing`) | Run `bbd9bdec` chờ cổng tải rồi bị stock hủy trước khi chạy (không pid/lease) → mọi wake sau đó trên CRE-21 bị `deferred_issue_execution`/`skipped`, board wakeup cũng `skipped`. |
| L5 | chặn stage 4 | Instructions `crew/agents/integrator.md` (và các file vai trò) chỉ ghi `GET /api/issues/<id>`, không có mẫu URL đầy đủ; `PAPERCLIP_API_URL` của bridge không chứa `/api` (`packages/adapter-utils/src/sandbox-callback-bridge.ts` `DEFAULT_SANDBOX_CALLBACK_BRIDGE_ROUTE_ALLOWLIST` chỉ nhận `/api/...`) | Integrator haiku gọi `$PAPERCLIP_API_URL/issues/…` → `Route not allowed` ở 3/4 run (CRE-21 13:55, CRE-24 15:02, 15:10). Hệ quả an toàn: run `e3ab2b4d` **push vào `main` dù bước "Xác minh qua API" thất bại** (`GET /agents/me` → `Route not allowed`), trái bước 1 stage 4. Executor tự tìm ra `/api` sau 2 lần thử. |
| L6 | thiết kế | Ruling N1 (participant không đổi status khi push lỗi) gặp stock `server/src/services/recovery/service.ts` `reconcileStrandedAssignedIssues` (nhánh `execution_review_participant_recovery`) | Sau `pushed=no` không quyết định, recovery chạy lại integrator một lần rồi chuyển `blocked`; comment owner đưa issue về `todo`, không về `in_review`. |
| L7 | nhỏ | `packages/crew-plugin/src/run-cancelled.ts` `registerRunCancelledHandler` | Không bỏ qua hủy do chuyển giao (`errorCode: issue_reassigned`): mỗi lần agent `done` đều có comment "Crew chuyển issue sang `blocked`…" và một lần ghi `blocked` chen trước khi route ghi `in_review` (activity 13:41:46.613 `patch status blocked`, rồi `from blocked → in_review`). Hiện kết quả cuối vẫn đúng nhờ thứ tự ghi, nhưng là race. |
| P1 | thiết kế | Stock `routes/issues.ts` `shouldImplicitlyMoveCommentedIssueToTodo` sau O9 | Issue gốc `done` sau stage 4 giao cho integrator (agent), nên comment của owner mở lại về `todo` và đánh thức integrator (CREA-23 đo được). Giả định "assignee lúc đó là user owner" trong whole-branch-review chỉ đúng trước O9. |
| P2 | stock, ghi nhận | `X-Paperclip-Run-Id` không phải uuid | trả 500 `Internal server error` thay vì 4xx. |
| A1 | hành vi agent (haiku) | — | Executor commit trên nhánh hiện tại thay vì `crew/<id>` từ `origin/HEAD`, không chạy `workflow-check` khi xong, không đăng lại `crew-commit` sau khi sửa; reviewer duyệt commit lệch nhánh và duyệt sha không có `crew-commit`; integrator `PATCH in_progress` issue gốc. |

## Dọn dẹp

- Issue thử đã `cancelled`: CRE-21, CRE-22, CRE-23, CRE-24 (Crew Spike); CREA-20…CREA-24 (Crew Spike Policy).
- Agent process của Crew Spike Policy: trả `adapterConfig` (`sleep 60` / `true`), `metadata` executor = null, pause lại như trước. Key `ac2-gate` đã xóa (`DELETE /agents/<id>/keys/<keyId>` → `ok:true`); thư mục tạm VPS đã xóa.
- Run hẹn `b3248755` đã hủy; `ops/active-runs.sh` rỗng lúc 15:11.
- Hook `pre-receive` thử đã gỡ. Commit chèn `1e2abe4` chỉ còn là object không ref.
- Giữ lại (cần cho R1-3, owner quyết gỡ): agent `reviewer`/`integrator`, hai environment, worktree `~/crew-agents/{reviewer,integrator}`, remote bare `~/crew-spike/repo-a-origin.git` (`main` = `fb77634`), bundle `~/.crew/bin/crew-docs-2ce11c9.cjs`, `adapterConfig.env.PATH` của 3 agent, company Crew Spike Policy trong `crew-policy.json`. Ngưỡng cổng tải 16 do lead trả về 8.
- Worktree executor `~/crew-agents/mac-claude` đang ở `crew/cre-23`, bẩn (`M README.md`, `?? long.txt`, `?? s5.txt`) do agent; em không dọn (luật không làm việc trong `~/crew-agents`).

## Tổng kết

Cổng 1: test + typecheck ĐẠT, lint KHÔNG ĐẠT (lỗi có sẵn trên `v3`). Cổng 2a–2d: ĐẠT. Cổng 4: KHÔNG ĐẠT (luồng 4 stage không tự
chạy hết: L1, L5; `run-init-check` đỏ: L3); các ca con đạt: pin Superpowers, `installed_plugins.json` không đổi, checkout
owner nguyên, wrapper chặn `--plugin-dir` sai, `update-ref` không lừa được, push lỗi ghi `pushed=no`. Cổng 5: ĐẠT. Cổng 3: không áp dụng.

## Cổng 4 lần 2 (sau đợt sửa, image `crew-v3/paperclip:v3-80f987263`)

### Chuẩn bị (16:16–16:18)

- `crew-mac doctor` (bản `42a2503`): 16/16 ĐẠT, gồm `node trong PATH của sshd agent: /opt/homebrew/bin/node` và `crew-docs cho integrator: 3 worktree, bundle và runtime chạy được qua sshd agent` (L2 đã sửa).
- 3 agent Crew Spike: `model` → `claude-sonnet-5` (O10); `adapterConfig.env` = `{}` (bỏ PATH vá tạm; PATCH bỏ trống key `env` thì server giữ env cũ, phải gửi `"env":{}`); `apply-roles.sh agent` ×3 rc 0. Đọc lại: `command` cả 3 = `/Users/phannhatquang/.crew/bin/crew-claude-run`, `extraArgs` kết thúc `--plugin-dir …/6.4.1-5bf4e7801107`; sha256 `AGENTS.md` trên server = file nguồn (`executor.md` `5ca3a7f7…`, `reviewer.md` `ef10d601…`, `integrator.md` `023dae9d…`, fork `7942ec2`), có mục "Gọi API".
- Model chạy thật: `system/init.model` = `claude-sonnet-5`, `message.model` = `claude-sonnet-5`, Claude Code `2.1.289` (run reviewer `cc76623c`).
- `crewLoadGate.maxLoad1` = 8.

### Issue

- CRE-25 `2569da86-589f-48a2-8b29-ca4cda80ac45` — issue gốc (board tạo, 4 stage, `maxReviewRounds` 5), giao executor, ban đầu `backlog`.
- CRE-26 `ba0f4472-5884-4807-9190-54240ce7e88d` — issue con (board tạo, template con 1 stage reviewer): `greet` dùng `name.trim()` + test.
- CRE-27 `f9f49857-8ce1-4c24-91b1-c946769fbe3b` — issue con sửa conflict do **integrator tạo** (`created_by_agent_id` = integrator), giao executor, template con (reviewer `946f1a73…`), mô tả có dòng riêng `crew-fix base=9102e742ee6bfe5c3a3bcdb6a011d3819e1547ff`.
- Để có conflict thật, sau khi CRE-26 được duyệt owner đẩy `06abb30` ("ghép chuỗi chào bằng toán tử cộng", sửa đúng dòng `return` của `greet` + docs) lên `origin/main` (pre-push `crew-docs check`: ok).

### Số đo từng lần chuyển stage (L1 trên `v3-80f987263`)

| Chuyển | Run trước kết thúc | Wake người kế tiếp | Lease run trước nhả | Kết quả | Cách đi tiếp |
|---|---|---|---|---|---|
| CRE-26 executor → reviewer | `f7172577` 16:20:35.043 | 16:20:35.465 **skipped** (`execution_reconciliation_required`: "The previous execution has not released its environment lease") | 16:20:36.425 (`crew.remote_stop.started` 16:20:36.421, `crew.remote_stop` 16:20:39.963) | không ai đánh thức sau 6 phút | comment owner 16:26:36 → reviewer `cc76623c` chạy ngay |
| CRE-26 reviewer approve → `done` | `cc76623c` 16:27:17.853 | — | 16:27:18.131 | `done`, `completed` | — |
| CRE-25 executor → reviewer | `322a0257` 16:28:37.931 | 16:28:38.172 **skipped** | 16:28:40.546 | kẹt | comment owner 16:28:51 |
| CRE-25 reviewer → integrator (stage 2) | `97d44eb3` 16:29:41.766 | 16:29:41.967 **skipped** | 16:29:42.873 | kẹt | comment owner 16:29:56 |
| CRE-27 executor → reviewer | `d87e87ee` (16:36:4x) | 16:36:43 **skipped** | — | đang chờ (điểm dừng chờ deploy) | — |

Kết luận lần đo này: L1 **chưa sửa** trên `v3-80f987263` (4/4 lần chuyển do agent tự PATCH đều bị bỏ wake; wake luôn đến trước khi nhả lease 0,2–2,4 giây). Lead đã nhận số đo và giao bản sửa thứ hai (`crew.handoff_rewake`).

### Kết quả từng ca tới điểm dừng

| Ca | Kết quả |
|---|---|
| Executor làm đúng nhánh | ĐẠT: CRE-26 commit `9102e74` trên `crew/cre-26` từ `origin/HEAD` (khi đó `fb77634`), `crew-commit … result=pass`, không commit `README.md`/`long.txt`/`s5.txt`. |
| Reviewer duyệt issue con | ĐẠT (nhờ comment owner): `crew-review sha=9102e742… verdict=approved`. |
| Executor gửi issue gốc chỉ gồm con | ĐẠT (do owner chuyển `todo` + comment): executor comment tóm tắt rồi `done`, không tạo commit. |
| Reviewer duyệt tổng issue gốc | ĐẠT (nhờ comment owner): `crew-review root children=CRE-26 verdict=approved`. |
| Integrator gặp conflict → issue con `crew-fix` | ĐẠT (integrator chạy nhờ comment owner): `git merge` 9102e74 vào `origin/main` conflict ở `src/greet.js`, `docs/flows/repo-a.md`; tạo CRE-27 đúng mẫu, không đổi status issue gốc. |
| Issue gốc trong lúc chờ issue con | **KHÔNG ĐẠT**: stock `execution_review_participant_recovery` chạy lại integrator (run `652d403a` 16:33:35, nó chỉ đọc lại và không làm gì — đúng), rồi 16:34:24 chuyển CRE-25 sang `blocked` ("Paperclip retried the pending execution-review participant once, but the review stage still has no completed decision or live reviewer run…"). Cùng cơ chế L6, lần này ở stage 2 khi chờ issue con. |
| `run-init-check` trên log thật | ĐẠT: run reviewer `cc76623c` → `crew-workflow init ok: superpowers@6.4.1 từ bản ghim, 15 skill superpowers:*`, rc 0 (L3 đã sửa). |
| `installed_plugins.json`, checkout owner | trước lần 2: sha256 `1a5b5d1f…384d8e`, `?? owner-wip.txt`, `owner-wip.txt` `df2eb96d…98b7` (đo lại cuối lần 2). |

### Sau deploy `crew-v3/paperclip:v3-9ccdb83e0` (16:39, L1 lần 2: `crew.handoff_rewake`)

Wake reviewer của CRE-27 bị bỏ lúc 16:36:43 (trước bản sửa) nên em **đánh thức tay một lần** bằng comment owner 16:39:47. Từ đó
trở đi không dùng comment owner để đánh thức chuyển stage nữa (các comment owner sau đó là thao tác owner thật: duyệt, sửa
push lỗi, thử mở lại).

| Chuyển (tự chạy) | Run trước kết thúc | Wake bị bỏ | Lease nhả | `crew.handoff_rewake` | Run mới bắt đầu | Trễ |
|---|---|---|---|---|---|---|
| CRE-27 reviewer approve → CRE-25 integrator (`issue_children_completed`) | `f291a5bb` | không | — | không cần | `97d1102a` 16:41:14 | ~1 s |
| CRE-25 owner duyệt → integrator stage 4 | (board) | không | — | không cần | `39c012d8` 16:43:32 (wake 16:43:31.701) | <1 s |
| CRE-25 vòng 2: executor → reviewer | `7c7cd3e1` 17:07:45.390 | 17:07:45.628 | 17:07:46.629 | 17:07:46.692 (một lần) | `464c2cc7` 17:07:47.054 | 1,7 s |
| CRE-25 vòng 2: reviewer → integrator stage 2 | `464c2cc7` 17:08:56.935 | 17:08:57.154 và 17:08:57.812 | 17:08:58.175 | 17:08:58.231 (một lần) | `c0db47fb` 17:08:58.567 | 1,6 s |
| CRE-25 vòng 2: owner duyệt → integrator stage 4 | (board 17:10:24.552) | không | — | không cần | `c9390465` 17:10:24 | <1 s |
| CRE-28: executor (retry) → reviewer | `45e0c558` 17:23:22 | có | — | 17:23:23.174 (một lần) | `6cbd3a00` 17:23:23 | ~1 s |

Không có hai run chồng thời gian trên CRE-25 trong vòng 2 (truy vấn cặp run giao nhau: 0). **L1: ĐẠT** trên `v3-9ccdb83e0`
(mỗi lần bỏ wake có đúng một `crew.handoff_rewake`, trễ ≤ 2 giây).

### Kết quả các ca còn lại

| Ca | Kết quả |
|---|---|
| Luồng 4 stage tới `done` + push thật | **ĐẠT** (CRE-25). Vòng 1: stage 1 và 2 nhờ comment owner (trước deploy), stage 2 → 3 → 4 tự chạy; vòng 2 (sau O11) **tự chạy hết** executor → reviewer → integrator → owner → integrator → `done`. `origin/main` = `d058f17` (merge CRE-27, gồm CRE-26 + `06abb30` của owner). DB decisions CRE-25: `e56d5090` approved reviewer, `f9da9397` approved integrator, `8b1d7d7b` approved owner (`actor_user_id`), `ce2c1d39` approved integrator; `execution_state.status=completed`, `changesRequestedCount=0`. Activity `crew.policy.board_override`: 0. |
| `crew-merge pushed=yes` + `done` | **ĐẠT**: 17:06:50 `crew-merge sha=d058f1737a4f… branch=main pushed=yes` (sau bằng chứng `crew-docs-check commit=d058f17… exit=0` 17:06:42), `PATCH done` 17:06:55 được H2 nhận. Vòng 2: bằng chứng 17:11:13 → `crew-merge … pushed=yes` 17:11:21 → `done` 17:11:27. |
| Push bị từ chối một lần → owner sửa → integrator push lại | **ĐẠT một phần.** Hook `pre-receive` từ chối: integrator (run `39c012d8`) ghi `crew-merge sha=d058f17… branch=main pushed=no` + `! [remote rejected] … (pre-receive hook declined)`, không đổi status, `cr` giữ 0. Nhưng stock recovery chạy lại integrator (`a5d1cd95`, lại `pushed=no`) rồi 16:46:48 chuyển CRE-25 sang **`blocked`** (L6 vẫn còn). Owner gỡ hook + comment 16:47:07 → issue về **`todo`** (không phải `in_review`), integrator chạy (`6e2516ce`) và **từ chối push đúng luật**: "không push — status hiện tại là `todo`, không phải `in_review`…". Owner phải `PATCH status in_review` (16:57:34) thì integrator (`85616488`, chờ cổng tải tới 17:05:58) mới push được. `changesRequestedCount` không tăng (0). |
| Issue con + issue con sửa lỗi `crew-fix base=` | **ĐẠT.** CRE-26 (board tạo) qua reviewer; owner đẩy `06abb30` tạo conflict thật; integrator tạo CRE-27 (`crew-fix base=9102e742…`, template con, giao executor tác giả `crew-commit`); executor merge `crew/cre-26` lên `origin/main` ở `crew/cre-27` (`946d551`); reviewer duyệt (`crew-review sha=946d551…`); stock đánh thức integrator `issue_children_completed` dù issue gốc đang `blocked`; integrator merge `946d551` (`d058f17`), docs exit 0, approve. Trong lúc chờ con, issue gốc bị recovery chuyển `blocked` (L6). |
| O11 — owner comment mở lại issue `done` | **ĐẠT.** 17:07:16 comment owner trên CRE-25 `done` → `todo`, activity `crew.gate.cycle_reset` (`reassignedFromAgentId` integrator → `reassignedToAgentId` executor, `executionStateCleared: true`), executor được đánh thức (run `7c7cd3e1`, `issue_reopened_via_comment`), sau đó tự đi lại 4 stage (bảng trên). |
| `run-init-check` trên log thật | **ĐẠT**: executor `7c7cd3e1`, reviewer `464c2cc7`/`cc76623c`, integrator `c9390465` → `crew-workflow init ok: superpowers@6.4.1 từ bản ghim, 15 skill superpowers:*`. |
| Retry kiểu S3 | **ĐẠT.** CRE-28 `e9206174-ac86-48d2-84fb-f1dee6fd56e3`: executor commit `64da7fe test: retry-1` 17:12:13 rồi `sleep 150`; 17:12:18 `s3-tsdown.sh` tắt Tailscale VPS (bật lại 17:13:18). Run `24e96e9e` `failed` "Claude exited with code 255"; retry `45e0c558` (`transient_failure_retry`, tạo 17:17:15, chạy 17:17:58) có comment `Crew: lần chạy lại sau run 24e96e9e… Có 1 commit … - 64da7fe9 (crew/cre-28) test: retry-1` và activity `crew.retry_progress.checked`; executor báo `crew-commit sha=64da7fe9…` (đúng commit cũ), không commit trùng (`git log --all --grep retry-1`: một commit). |
| H3 fallback | **KHÔNG CHẠY** (không có agent dùng wrapper trỏ thư mục ngoài `~/crew-agents`). |
| `installed_plugins.json`, checkout owner | **ĐẠT**: sau lần 2 (17:12) sha256 vẫn `1a5b5d1f…384d8e`; `~/crew-spike/repo-a` vẫn `main` `cdaaeb5`, chỉ `?? owner-wip.txt`, sha256 `df2eb96d…98b7`. |

### Ghi chú lần 2

- L6 còn: hai lần (16:34:24 khi chờ issue con, 16:46:48 sau push lỗi) stock `execution_review_participant_recovery` chuyển issue gốc sang `blocked`. Sau push lỗi, comment owner đưa về `todo` và integrator (đúng luật) không push; phải board `PATCH in_review` mới đi tiếp. Runbook/instructions cần nói rõ bước này, hoặc cần chặn recovery cho participant đang chờ.
- Lỗi thiết lập repo thử của em: lệnh test `node --test test/` (trong `AGENTS.md`, `package.json` repo thử) lỗi trên Node 24 (`✖ test … 'test failed'`, integrator báo `MODULE_NOT_FOUND`); `node --test` không đối số thì chạy được. Agent tự chuyển sang `node --test test/greet.test.js`. Không phải lỗi Crew.
- Reviewer CRE-27 nói đã chạy test "trong worktree tạm"; `git worktree list` sau đó không có worktree lạ.
- Executor vẫn để lại `README.md` sửa dở, `long.txt`, `s5.txt` trong `~/crew-agents/mac-claude` (từ lần 1); không bị commit.
- Quota: 5h từ 53% (16:16) lên 65% (17:07), reset 17:09; tuần 25% → 29%.

### Dọn lần 2

CRE-25, CRE-26, CRE-27, CRE-28 → `cancelled`; `ops/active-runs.sh` rỗng 17:24; hook `pre-receive` đã gỡ; thư mục tạm VPS `/tmp/ac2b.*` đã xóa;
Tailscale VPS lên lại (`100.105.105.12`). 3 agent giữ `claude-sonnet-5`, `env` rỗng, instructions mới.

### Tổng kết lần 2

Cổng 4: **ĐẠT có điều kiện.** Luồng 4 stage tự chạy tới `done` + push thật, `crew-merge`/`done`, `crew-fix`, O11, `run-init-check`,
retry S3, L1 (sau `v3-9ccdb83e0`) đều đạt. Chưa đạt: ca push lỗi → sửa → push lại cần board `PATCH in_review` do L6 (recovery stock
chuyển `blocked`, comment owner chỉ đưa về `todo`). Không chạy: H3 fallback, "Mac tắt → `blocked` sau `maxWaitMinutes`".

## Cổng 4 lần 3 (image `crew-v3/paperclip:v3-6c20d406c`, instructions `6c20d40`)

Chuẩn bị 17:29: `apply-roles.sh agent` ×3 rc 0; đọc lại: `command` cả 3 = wrapper, model `claude-sonnet-5`, `env` `{}`; sha256
`AGENTS.md` integrator trên server = `integrator.md` nguồn (`20b02717…`). Ngưỡng cổng tải 8 (run đầu chờ tải 11,74 khoảng 1 phút).

### Push lỗi → owner sửa → comment → integrator push lại — ĐẠT

Issue gốc CRE-29 `4890156b-970c-41bc-b25f-85e019f99587` (`greetLoud`, executor làm thẳng issue gốc). Stage 1–3 tự chạy, không comment
owner: executor `3e5fe8c3` (17:30:39–17:33:04) → reviewer `18630e49` bắt đầu 17:33:05 → integrator `90094440` bắt đầu 17:33:42 →
owner (giao 17:34:58).

| Thời điểm | Sự kiện |
|---|---|
| 17:35 | Em cài `~/crew-spike/repo-a-origin.git/hooks/pre-receive` từ chối. |
| 17:35:32 | Owner (board) `PATCH done` = duyệt → stage 4, integrator `f9fad021` bắt đầu 17:35:33. |
| 17:37:28 | `crew-merge sha=21734793c9a3… branch=main pushed=no` + `! [remote rejected] … (pre-receive hook declined)`; không đổi status. |
| 17:37:36 | Stock `execution_review_participant_recovery` chạy lại integrator (`a6c14607`): lại `pushed=no` 17:39:40 (hook còn). |
| 17:39:49 | Stock chuyển CRE-29 sang `blocked` (L6, vẫn có). |
| 17:40:16–22 | Em gỡ hook; owner comment "đã gỡ bảo vệ nhánh main, mời integrator push lại" (17:40:22). Không board `PATCH in_review`. |
| 17:40:22 | Integrator `4eab897f` (`issue_reopened_via_comment`) chạy; `issue.recovery_action_resolved` (`source_revalidation`, `cancelled`). |
| 17:41:02 → 17:41:12 → 17:41:18 | Bằng chứng `crew-docs-check commit=2173479… exit=0` → `crew-merge sha=21734793… branch=main pushed=yes` → `Integrator: approve — đã push …`; issue `done` (run kết thúc 17:41:23). |

DB CRE-29: `status=done`, `execution_state.status=completed`, `changesRequestedCount=0`; decisions `approved | 4`. `origin/main` =
`2173479` (merge CRE-29) — một lần push thành công (hai lần trước bị hook từ chối, không có ref nào khác đổi). Thời gian từ comment
owner tới `done`: 56 giây. Integrator nhận stage 4 dù status là `blocked`/`todo` (instructions mới).

### H3 fallback — ĐẠT

Environment tạm `mac-mini-h3-old` `d6704bb9-d3b5-4010-a311-ca0e2d8c449e` (`remoteWorkspacePath` = `/Users/phannhatquang/crew-spike/worktrees/mac-claude`,
ngoài `worktreeRoot` `~/crew-agents`); executor tạm dùng environment này. Issue CRE-30 `1f25db33-76d3-4296-b886-de50776a699b` (`sleep 240`).
Run `1b34f142-d7c3-474d-b76d-ec19980700b4` (lease `remoteCwd` = thư mục trên) đang chạy, process `python3 … time.sleep(240)` pid 18584
trên Mac lúc 17:41:58. Board `POST /heartbeat-runs/<id>/cancel` 17:42:05 → `crew.remote_stop.started` 17:42:06.223 →
`crew.remote_stop` 17:42:09.463 `{"via":"fallback","killed":0,"matched":2,"outcome":"stopped","remaining":0,"leaseStatus":"expired"}`.
Process `sleep` không còn lúc 17:42:10. Worktree cũ không đổi (`a5bc583`, sạch).

### Dọn lần 3

CRE-29, CRE-30 `cancelled`; hook `pre-receive` gỡ; executor trả `defaultEnvironmentId` = `f92f5dd8…` (`mac-mini`); environment tạm đã xóa;
`/tmp/ac2c.*` trên VPS đã xóa; `ops/active-runs.sh` rỗng. `installed_plugins.json` vẫn `1a5b5d1f…`, checkout owner vẫn chỉ `?? owner-wip.txt`.
Quota sau lần 3: 5h 6%, tuần 30%.

### Tổng kết lần 3

Cả hai ca đạt. L6 vẫn xảy ra (recovery stock chuyển `blocked` sau hai lần `pushed=no`) nhưng không còn chặn luồng: comment của owner
đủ để integrator push lại và đóng issue.
