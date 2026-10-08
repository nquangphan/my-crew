# Bàn giao Crew v3 cho Codex (chạy trên MacBook)

Viết 08/10/2026 (Asia/Ho_Chi_Minh) bởi phiên Claude Code chạy trên Mac mini. Người đọc: Codex chạy trên **MacBook** của owner. Đọc hết file này trước khi đụng vào máy thật. Mọi thông tin dưới đây đã kiểm trên máy lúc viết; chỗ nào chưa kiểm được thì ghi rõ "chưa kiểm".

Owner gọi là **Đại Ca**, agent xưng **em**, báo cáo bằng tiếng Việt, kết luận trước, số liệu sau, ngắn.

---

## 0. Tóm tắt một đoạn

Crew v3 là Paperclip gần như nguyên bản ("stock-first") cộng một ít code Crew: hook một dòng có registry, plugin `crew.core`, CLI `crew-mac` trên Mac, instructions vai trò agent. **R1-1 (nền + kết nối Mac) và R1-2 (workflow Superpowers + gate) đã xong và đã push.** **R1-3 (Trợ Lý — agent tách yêu cầu thành issue con) đã có spec + plan chi tiết, CHƯA bắt đầu code.** Việc tiếp theo: chốt 4 câu hỏi với owner (mục 8), rồi làm R1-3 theo plan.

---

## 1. Máy và vai trò

| Máy | Tailscale | Vai trò |
|---|---|---|
| **MacBook** (`phans-macbook-pro`) | `100.100.157.19` | Máy owner. **Codex chạy ở đây.** Có bản clone repo Crew cũ — phải `git pull`. |
| **Mac mini** (`phans-mac-mini`, user `phannhatquang`, 10 CPU, 16 GB) | `100.102.189.67` | **Máy chạy agent Paperclip.** Có sshd agent cổng 2222 (chỉ cho key Paperclip), `crew-mac`, worktree agent, repo thử. Owner cũng dùng máy này cho dự án khác (emulator Android/iOS, Orca, các phiên Claude khác) — **tải thường 15–25**. |
| **VPS** `nhamoiplatform` (`14.225.224.88`, Tailscale `100.105.105.12`, Ubuntu 24.04, 7,8 GB RAM) | | Chạy **server Paperclip spike** (`/opt/crew-v3-spike`) cạnh **prod** (crew v1 `/opt/crew`, kidy, 2ps-landing). Chỉ được đụng `/opt/crew-v3-spike` và compose project `crew-v3-spike`. |

Truy cập từ MacBook:
- VPS: `ssh nhamoiplatform` (alias đã có trên MacBook từ R1-1; root). Nếu thiếu, thêm vào `~/.ssh/config`: `Host nhamoiplatform / HostName 14.225.224.88 / User root`.
- UI/API Paperclip spike: `http://100.105.105.12:3100` (chỉ qua Tailscale). Tài khoản board trong `/opt/crew-v3-spike/.env` (chmod 600, **không in ra**). Helper gọi API trên VPS: `/opt/crew-v3-spike/api.sh METHOD PATH [JSON]` (tự thêm `/api`, dùng cookie board; `curl -sS` **không** `-f` → tự đọc mã HTTP/thân trả về).
- Mac mini: **chưa kiểm** MacBook có SSH vào Mac mini bằng tài khoản owner (cổng 22, Remote Login) không. Cổng 2222 là sshd agent, **chỉ nhận key Paperclip** — không dùng để làm việc, không tắt/sửa. Việc phải làm trên Mac mini (cài `crew-mac`, `setup`, `doctor`, tạo worktree agent) thì: (a) SSH cổng 22 nếu owner bật, hoặc (b) nhờ owner chạy lệnh trên màn hình Mac mini. `crew-mac setup`/`uninstall` **phải chạy trong phiên desktop của Mac mini**, không qua sshd agent.

---

## 2. Repo, nhánh, commit

| Repo | Remote | Nhánh làm việc | HEAD lúc viết | Ghi chú |
|---|---|---|---|---|
| Crew | `git@github.com:nquangphan/my-crew.git` | **`v3`** | (commit chứa file này, sau `2aedac0`) | `apps/crew-mac`, docs flow, spec, plan. Nhánh `main` là v1/v2 — không làm R1-3 trên `main`. |
| Fork Paperclip | `git@github.com:nquangphan/crew-paperclip.git` (public), `upstream` = `https://github.com/paperclipai/paperclip.git` (MIT) | **`v3`** | `6c20d406c` | Gốc tag `v2026.1001.0` (`8f8a0ab7e`). Owner chốt **không mở PR upstream**. |
| v2 (tham chiếu, chỉ đọc) | cùng repo Crew | `codex/crew-v2-server` | — | Trên MacBook: `~/.codex/worktrees/crew-v2-server/crew`. |

Chuẩn bị trên MacBook (repo Crew đã có ở `/Users/phannhatquang/Documents/projects/crew`):

```sh
cd ~/Documents/projects/crew
git fetch origin && git checkout v3 && git pull --ff-only
# fork nằm trong .worktrees/ (repo git riêng, KHÔNG phải submodule)
ls .worktrees/                       # trên MacBook có thể còn worktree cũ (paperclip-r1-1 đã gỡ)
# nếu chưa có .worktrees/paperclip-v3:
git clone git@github.com:nquangphan/crew-paperclip.git .worktrees/paperclip-v3
git -C .worktrees/paperclip-v3 remote add upstream https://github.com/paperclipai/paperclip.git
git -C .worktrees/paperclip-v3 fetch origin && git -C .worktrees/paperclip-v3 checkout v3 && git -C .worktrees/paperclip-v3 pull --ff-only
corepack pnpm install --frozen-lockfile                       # repo Crew
(cd .worktrees/paperclip-v3 && corepack pnpm install --frozen-lockfile)   # fork, ~2 GB RSS lúc cài
```

Git hook của repo Crew (`.githooks`, chạy `crew-docs`): `git config core.hooksPath .githooks`, `git config crew-docs.runtime <node tuyệt đối>`, `git config crew-docs.bundle <đường dẫn crew-docs.cjs>`. Bundle build bằng `corepack pnpm --filter @crew/docs-kit build` → `packages/docs-kit/dist/crew-docs.cjs`. Trên MacBook có thể còn cấu hình cũ trỏ `~/.crew/bin/crew-docs.cjs` của app v1 — kiểm `git config --get crew-docs.bundle` và build lại nếu cần. Hook pre-commit chạy `crew-docs check --staged`, commit-msg kiểm R6, pre-push kiểm R3 trên cả lần push.

**Trước mọi lệnh git ghi trong script: kiểm `git rev-parse --show-toplevel`.** Repo Crew chứa fork (repo khác) trong `.worktrees/`. Từng có script chạy nhầm thư mục tạo commit rác trên fork.

---

## 3. Đã xong

### R1-1 (06/10) — nền và kết nối Mac
Bàn giao: `plans/261006-1355-crew-v3-r1-1/handover.md` (môi trường, bẫy — **vẫn đúng**). Hook H1 `claimQueuedRun` (cổng tải), H2 `runUpdate` (gate ghi issue), H3 `releaseRunLease` của SSH driver (dừng process trên Mac); vá adapter/driver P1–P4 (`crew/release/core-hooks.json`); `crew-mac setup/doctor/uninstall/reap/stop-run`; backup/restore VPS.

### R1-2 (07/10) — workflow Superpowers và gate
Plan/ledger/report: `plans/261007-1034-crew-v3-r1-2/` (`plan.md` mục "Kết quả", `sdd-ledger.md` = mọi quyết định O1–O11 và ruling, `ac-2-report.md` = nghiệm thu máy thật, `handover.md`).

Hệ thống sau R1-2:
- **Template issue gốc 4 stage** (owner/board tạo): `[review: reviewer] → [review: integrator (merge + crew-docs check)] → [approval: owner] → [review: integrator (push)]`, `maxReviewRounds: 5` (vòng 6 → owner). **Issue con** (agent tạo, có `parentId`): 1 stage reviewer, 5 vòng. Issue do routine/hệ thống tạo: gốc → 4 stage, con → template con; watchdog/recovery không policy (trừ khi giao lại executor của issue nguồn).
- **Hook lõi: 4/5** (H1, H2, H3, **H4 `beforeIssueCreate`** đầu `issueService.create`). Trần 5 chỉ đếm hook một dòng có registry. Còn **1** chỗ (dự kiến H5 nếu spike R1-3 SP-1 đỏ).
- **H2 chặn** (`server/src/crew/issue-gate.ts`): agent/hệ thống sửa/xóa `executionPolicy`; `done` khi thiếu stage, tự duyệt, docs thiếu/lỗi (stage 2 cần comment integrator dòng đầu `crew-docs-check commit=<40hex> range=<a>..<b> exit=<0|1|2|3>`), stage 4 cần `crew-merge sha=<40hex> branch=<b> pushed=yes` mới hơn decision owner và sha = commit của bằng chứng docs mới nhất; agent chuyển `cancelled` (O7); agent giao issue cho reviewer/integrator. Mở lại issue (`done`/`cancelled` → khác) thì xóa `executionState`, ghi mốc vòng `crew.gate.cycle_reset`, tự giao lại `returnAssignee` (O11). Board ép `done` được nhưng ghi activity `crew.policy.board_override`.
- **H4 chặn** (`issue-create-policy.ts`): agent tạo issue gốc (`crew_agent_root_issue`), tạo ở `done/cancelled/in_review`, giao reviewer/integrator (`crew_role_assignee`); thay mọi `executionPolicy` agent gửi bằng template con.
- **Vai trò** đọc từ file JSON chỉ đọc `CREW_POLICY_CONFIG` (O8): `{ "companies": { "<companyId>": { "reviewerAgentId", "integratorAgentId", "ownerUserId" } } }`. Company vắng → hành vi stock hoàn toàn. File lỗi → company đó fail-closed. Sinh bằng `crew/agents/apply-roles.sh policy-config …`.
- **Cổng tải H1** (`load-gate.ts`): `metadata.crewLoadGate { maxLoad1, maxWaitMinutes }` trên environment; quá tải → run giữ `queued` (activity `crew.load_gate.waiting`), hết hạn → hủy, issue `blocked`. Gắn dấu "chưa bắt đầu" lên run nó giữ (tránh hold `process_identity_missing`), gọi stale gate stock trước khi xóa dấu. Retry kiểm tiến độ: run có `retryOfRunId` → dừng run cũ + đếm commit trên mọi nhánh kể từ `startedAt − 30s` qua SSH, comment `Crew: lần chạy lại sau run …`.
- **H3** (`remote-stop.ts`, `handoff-rewake.ts`): ghi `crew.remote_stop.started` → nhả lease ngay → dừng process nền (≤20 s) → **phát lại đúng một lần wake bị stock bỏ** (`execution_reconciliation_required`) cho assignee kế tiếp (lỗi L1 của AC-2: route đánh thức participant trước khi lease nhả). Cổng giữ claim tối đa 120 s khi còn lệnh dừng chưa có kết quả (sống qua restart).
- **Plugin `crew.core`** (`packages/crew-plugin/`): bundle esbuild, chỉ còn xử lý run bị hủy thật (`errorCode` rỗng/`cancelled`) → `blocked`. Không còn đánh thức integrator (O9 thay bằng stage 4).
- **`crew-mac`** (`apps/crew-mac`, repo Crew): ghim Superpowers 6.4.1 vào `~/.crew/workflows/superpowers/6.4.1-5bf4e7801107` (checksum cây `3f0ff8c8…bd9a`, 231 file); wrapper `~/.crew/bin/crew-claude-run` gọi `crew-mac workflow-check` — run có `PAPERCLIP_RUN_ID` mà `--plugin-dir` sai/thiếu, có nguồn skill chưa track, settings/hook sửa dở → **thoát 78**; `run-init-check` đọc `system/init`; `doctor` 16 mục (gồm `superpowers-pin`, `worktree-workflows`, `crew-docs`, `agent-node`); `uninstall` fail-closed khi còn run.
- **Instructions vai trò** (fork `crew/agents/`): `executor.md`, `reviewer.md`, `integrator.md`; áp bằng `apply-roles.sh agent <agentId> <role> <pinDir>` (ghép `extraArgs`, upload AGENTS.md, kiểm `command` là wrapper). Dòng giao tiếp: `crew-commit sha= branch= tests= result=`, `crew-review sha= verdict=approved`, `crew-fix base=<sha>`, `crew-docs-check …`, `crew-merge …`. Mẫu gọi API trong instructions: `curl -fsS -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_URL/api/…"` (biến URL **không** kèm `/api`).

Nghiệm thu AC-2 (máy thật): Cổng 2a–2d đạt; Cổng 4 đạt sau 3 lần (luồng 4 stage tự tới `done` + push thật; `crew-fix` với conflict thật; O11; retry sau mất mạng không commit trùng; push lỗi → owner comment → integrator push lại; H3 fallback); Cổng 5 đạt; Cổng 1 test/typecheck đạt, **`pnpm lint` đỏ do file có sẵn trên `v3` (`.codex/hooks`, `.agents/skills`) — ngoài diff**.

---

## 4. Môi trường đang chạy (kiểm 08/10 13:35)

### VPS `/opt/crew-v3-spike`
- Compose project `crew-v3-spike`: `server` = image **`crew-v3/paperclip:v3-6c20d406c`** (= fork `v3` `6c20d406c`), `db` = `postgres:17-alpine`. Image rollback giữ lại: `v3-9ccdb83e0`. `.env` có `COMPOSE_FILE=docker-compose.yml:docker-compose.crew-policy.yml` (override mount `/opt/crew-v3-spike/crew-policy` → `/crew-policy:ro`, env `CREW_POLICY_CONFIG=/crew-policy/crew-policy.json`). **Luôn recreate server bằng `ops/deploy.sh`/`ops/rollback.sh`** hoặc `docker compose` trong thư mục đó (đã có `.env`), không bằng lệnh khác.
- `crew-policy.json` hiện có đúng company **Crew Spike** (`5befeb1a-1578-4656-b913-267494592e53`): reviewer `946f1a73-4ee0-447e-97b0-58e50bd70000`, integrator `b7cd2d89-9e3c-4164-ac81-9e0b042a15d1`, owner user `Mtye1JcS4JUc3lTZj51hI7nfz1pqMPSI`. Bản cũ cạnh file (`*.bak-*`). Đổi file → `docker compose restart server` → kiểm log `crew policy config enabled` + `./api.sh GET /plugins/crew.core/health` có `"healthy": true`.
- Backup: systemd timer `crew-v3-spike-backup` 03:30 hằng ngày → `/opt/crew-v3-spike/backups/`; LaunchAgent `com.2p.crew-backup-pull` trên Mac mini kéo về `~/crew-backups/vps/` (mới nhất `20261008-0330`). `deploy.sh` tự backup trước khi đổi image.
- **Không bao giờ build image đầy đủ trên VPS** (thiếu RAM); chỉ overlay. Dừng khi RAM khả dụng < 2 GB (`overlay-job.sh` tự canh).

### Paperclip spike (dữ liệu)
| Company | Agent | id | adapter | model | trạng thái |
|---|---|---|---|---|---|
| Crew Spike | `mac-claude` (executor) | `37a9e834-6aaf-4970-8f89-95dbc8a019f2` | `claude_local`, `command` = `/Users/phannhatquang/.crew/bin/crew-claude-run` | `claude-sonnet-5` | idle |
| Crew Spike | `reviewer` | `946f1a73-4ee0-447e-97b0-58e50bd70000` | như trên | `claude-sonnet-5` | idle |
| Crew Spike | `integrator` | `b7cd2d89-9e3c-4164-ac81-9e0b042a15d1` | như trên | `claude-sonnet-5` | idle |
| Crew Spike Policy | 4 agent thử (process/haiku) | — | — | — | **paused**, không còn trong `crew-policy.json`; owner chưa bảo xóa |

| Environment (SSH tới Mac mini cổng 2222, `in_place`) | id | `remoteWorkspacePath` | `crewLoadGate` |
|---|---|---|---|
| `mac-mini` (executor) | `f92f5dd8-fd34-47df-95a8-6adb87e49ec8` | `/Users/phannhatquang/crew-agents/mac-claude` | `{maxLoad1: 8, maxWaitMinutes: 60}` |
| `mac-mini-reviewer` | `c37a8692-77b3-4d4a-8f92-2b02bde38ec6` | `/Users/phannhatquang/crew-agents/reviewer` | như trên |
| `mac-mini-integrator` | `ffd322ff-670a-4e9c-bab1-6341cb2d38cc` | `/Users/phannhatquang/crew-agents/integrator` | như trên |
| `mac-mini-policy` | `00ca623e-…` | `/Users/phannhatquang/crew-spike/policy-repo` | — (cũ, không dùng) |

**Paperclip không có cwd riêng theo agent khi chạy SSH** — mỗi agent cần một environment riêng (đã kiểm theo `resolveEnvironmentExecutionTarget`). R1-3 cần thêm environment cho Trợ Lý và executor thứ hai.

### Mac mini
- `crew-mac` bản **`42a2503`** cài ở `~/.crew/app/crew-mac` (gói `~/.crew/app/crew-mac-42a2503.tgz` + `.sha256`; bản trước `crew-mac.old-2ce11c9`, `crew-mac.old-2f0f5c5d`). Launcher `~/.crew/bin/crew-mac`, wrapper `~/.crew/bin/crew-claude-run`. `~/.zshenv` có khối `crew-mac path` thêm `/opt/homebrew/bin` (node cho sshd agent). Doctor 16/16 lúc cài.
- Cài lại `crew-mac`: trên Mac mini, từ repo Crew `v3`: `corepack pnpm --filter @crew/mac run build`, `tar czf ~/.crew/app/crew-mac-<sha>.tgz -C apps/crew-mac assets dist package.json`, đổi tên `~/.crew/app/crew-mac` → `crew-mac.old-<sha cũ>`, giải nén gói mới vào `~/.crew/app/crew-mac`, rồi `/opt/homebrew/bin/node ~/.crew/app/crew-mac/dist/cli.js setup --paperclip-key ~/.crew/app/paperclip.pub` và `… doctor`. (Repo Crew trên Mac mini: `~/Documents/projects/crew`.)
- LaunchAgent: `com.2p.crew-mac-sshd` (sshd phiên desktop, `100.102.189.67:2222`), `com.2p.crew-mac-reaper` (dọn `claude -p` mồ côi có `PAPERCLIP_RUN_ID`, 60 s), `com.2p.crew-backup-pull`. Mac mini phải **đang đăng nhập màn hình** thì sshd agent mới chạy.
- Repo thử: `~/crew-spike/repo-a` (gốc), remote bare `~/crew-spike/repo-a-origin.git`. Worktree agent: `~/crew-agents/mac-claude` (`agent/mac-claude-r1`), `~/crew-agents/reviewer` (`agent/reviewer-r12`), `~/crew-agents/integrator` (`agent/integrator-r12`) — đều sạch. `~/.crew/bin/crew-docs-2ce11c9.cjs` là bundle crew-docs đặt ngoài `~/Documents` cho repo thử (TCC).
- Tài khoản Claude trên Mac mini: `congtu.kids` (Max) — **dùng chung quota với agent Paperclip**. Lần đo cuối (07/10 17:40): 5h 6%, tuần ~30%.

---

## 5. Quyết định của owner (không tự đổi)

Đầy đủ ở `plans/261006-0805-crew-v3-stock-first/can-dai-ca-chot.md`, `plans/261006-1355-crew-v3-r1-1/sdd-ledger.md`, `plans/261007-1034-crew-v3-r1-2/sdd-ledger.md`, `plans/261008-0850-crew-v3-r1-3/sdd-ledger.md`. Những điều dễ vi phạm:

- **Không bao giờ dùng model `fable`** (kể cả agent `kongming`/`advisor` — đã chuyển sang opus). Mạnh nhất được tự dùng: **opus**.
- Không token đăng nhập Claude; agent dùng login Keychain sẵn có trên Mac mini. Agent chạy `--setting-sources project,local`, **được** nạp `~/.claude/CLAUDE.md` cá nhân và `.claude/` mà repo dự án commit (O6).
- Lõi Paperclip chỉ đổi bằng hook một dòng có registry, trần 5 (đang 4/5). Vá adapter/driver theo dõi riêng trong `crew/release/core-hooks.json`. Không scheduler/queue/bảng ticket thứ hai.
- Repo agent làm việc là git worktree riêng dưới `~/crew-agents`, không bao giờ là checkout của owner.
- O1 reviewer, integrator là hai agent riêng. O2 owner chỉ duyệt cuối trên issue gốc. O3 docs gate server ép. O4 H4. O5/O9 integrator tự merge + push sau owner duyệt qua stage 4. O6 nạp `.claude/` repo. O7 agent không cancel. O8 vai trò trong file server. O10 agent thật chạy **sonnet** (haiku làm trái instructions ở AC-2). O11 mở lại → giao lại executor.
- **R1-3:** O12 chung session — spike đặt resume trong H1 trước; không được thì H5 `beforeWakeup` (owner duyệt sẵn). O13 **2 executor** song song. O14 Trợ Lý chọn sonnet/opus cho từng issue con, không haiku cho code, override chỉ `model`/`effort`. O15 research: template 2 stage reviewer → owner.
- Push repo Crew/fork: **chỉ khi owner nói "push"**. "commit" thì chỉ commit. Deploy ngoài `/opt/crew-v3-spike`, xóa thứ không do mình tạo, sửa `.claude/**`, `.githooks/**`, `AGENTS.md`, `CLAUDE.md`, mục `source`/`shared`/`unassigned` của `docs/flows.yaml` → **hỏi owner**; commit sửa file bảo vệ cần trailer `Crew-Owner-Approved: <KEY-số>` (ví dụ đã dùng: `CREWV3-1`; regex `^[A-Z][A-Z0-9]{1,9}-\d+$`).
- Không dùng trang theo dõi online; tiến độ ghi vào ledger của plan trong repo.
- UI/docs tiếng Việt; identifier/path tiếng Anh; giờ Asia/Ho_Chi_Minh; Conventional Commits, không nhắc AI, không mã plan/ticket trong commit message/tên test/comment code.

---

## 6. Cách làm việc owner muốn

- **Chia theo gói ngữ cảnh** (`.agents/skills/tro-ly/references/nhan-viec.md`, `dieu-linh.md`): vẽ gói trước, ticket chỉ trong một gói; cùng gói một worker làm nối tiếp; song song chỉ giữa gói khác nhau, file ghi rời nhau. Reviewer theo gói, không review việc mình làm.
- **Quy trình Superpowers** (skill trong `.agents/skills/`: `writing-plans`, `subagent-driven-development`, `test-driven-development`, `requesting-code-review`, `verification-before-completion`, …): TDD (RED rồi GREEN, dán log), review mỗi ticket, review toàn nhánh cuối bằng opus, một đợt sửa. Tối đa 5 vòng sửa cho một gate; vòng 5 vẫn đỏ → báo owner.
- **Test theo tầng**: implementer chạy test file mình đổi + typecheck package; reviewer đọc diff + log, chỉ chạy lại khi nghi; tích hợp chạy một lần (`crew/release/verify.sh` trong fork, `crew-docs check --range` repo Crew); full suite chỉ khi phát hành.
- **Ledger**: mỗi plan có `sdd-ledger.md`; mọi quyết định tự chốt ghi `Ruling: … — vì … — sai thì …`; bảng tài nguyên/tiến độ (R1-3 đã có mẫu).
- **Chỉ hỏi owner** khi: quyết định sản phẩm, hành động khó lùi (push, deploy ngoài spike, xóa thứ không do mình tạo, sửa file bảo vệ, thêm hook lõi), hai cách đọc yêu cầu khác hẳn nhau. Còn lại tự quyết, ghi ruling.
- **Nghiệm thu thật** (`.agents/skills/tro-ly/references/nghiem-thu.md`): test xanh chưa đủ. R1-2 lần 1 có 7 lỗi chỉ lộ trên máy thật. Đừng nói "xong" khi chưa chạy Cổng 4 trên Mac mini.
- Báo cáo nói rõ giao việc gì, model nào, vì sao.

**Codex khác Claude Code**: skill `tro-ly` (persona, sanctum) viết cho Claude Code; Codex đọc `AGENTS.md` và có thể đọc các `SKILL.md` trong `.agents/skills/` như hướng dẫn quy trình. Hook `scout-block` của Claude Code (chặn lệnh có chữ `node_modules`, `dist`, `build`) **không áp** cho Codex. Hook git của repo vẫn áp.

---

## 7. Bẫy đã gặp (đọc kỹ)

**Máy và công cụ**
- **APFS không phân biệt hoa thường**: `git rev-parse --show-toplevel` trả `~/Documents/Projects/crew` (P hoa) trong khi `pwd` là `projects`. So chuỗi đường dẫn sẽ sai → so bằng inode/`pwd -P`/`--show-prefix`. `verify.sh`, `upgrade.sh` đã sửa.
- **TCC macOS**: Claude Code tự cập nhật → macOS hỏi lại quyền thư mục bảo vệ (`~/Documents`, `~/Desktop`, `~/Downloads`, `/Volumes`); chưa ai bấm thì `claude` treo im ở 0% CPU. Bundle/git dir mà agent dùng không đặt dưới các thư mục đó. `crew-mac doctor` phát hiện hộp thoại chờ.
- Bash tool chạy shell trong process group + session riêng; `ps -E` không đọc env của binary Apple → dừng run phải qua `crew-mac stop-run` (cây cha–con + worktree).
- Hook R7 pre-commit chặn chuỗi giống header private key, kể cả trong test mẫu → ghép chuỗi lúc chạy.
- zsh không tách biến chưa quote thành nhiều tham số.
- Lõi Paperclip lớn (`heartbeat.ts` ~30k dòng, `issues.ts` lớn): **tìm theo symbol, không theo số dòng**.
- `docker compose exec` chỉ chạy được trên VPS.
- Một worker từng `rm -rf` nhầm thư mục `server/` đã track khi dọn file chép tạm → file tạm chỉ đặt trong `mktemp -d`, không chép vào cây làm việc, không `rm -rf` trong worktree.

**Hành vi stock Paperclip phát hiện qua nghiệm thu**
- Route `PATCH` đánh thức participant stage kế **trước** khi `executeRun` nhả lease → wake bị bỏ `execution_reconciliation_required`, stock không thử lại wake hệ thống (đã vá bằng `handoff-rewake`).
- Stale gate stock (`cancelStaleQueuedRun`, chạy trong `claimQueuedRun`) hủy run còn `queued` khi issue chờ review → nếu run thiếu dấu "chưa bắt đầu" thì recovery sinh hold `process_identity_missing` (đã vá).
- Recovery stock (`reconcileStrandedAssignedIssues`) đổi issue sang `blocked` khi participant chờ (push lỗi, chờ issue con) **mà không đổi `executionState`** → instructions dựa `executionState`, không dựa `status`.
- Agent đang là participant duyệt stage mà `PATCH blocked` = stock coi là yêu cầu sửa, trả về executor → participant chỉ comment khi lỗi môi trường.
- `in_review`/`done` trên issue có `executionPolicy` kích hoạt workflow reviewer → khi chờ owner trả lời dùng `blocked` + interaction.
- Comment của owner trên issue `done` mở lại về `todo` (stock `shouldImplicitlyMoveCommentedIssueToTodo`).
- Owner phải là **thành viên company** thì stock mới giao stage approval cho owner.
- `PAPERCLIP_API_URL` không kèm `/api`.
- Board ép `done` đặt `executionState` = null → mất `returnAssignee`.
- Plugin worker chạy env tối thiểu (không thấy `CREW_POLICY_CONFIG`); `ctx.agents.invoke` không mang `issueId`; comment do plugin viết không kích hoạt @mention.

**Rủi ro đã biết (chấp nhận, ghi ledger R1-2)**: khe vài truy vấn A1/A3 ở cổng tải; retry ≥2 bị stock hủy khi chờ vẫn sinh hold (gỡ: `POST /issues/:id/recovery-actions/resolve`); test `crew-remote-stop` "finds a node process by its PAPERCLIP_RUN_ID token" có dấu hiệu flaky khi chạy chung nặng.

---

## 8. Việc tiếp theo — R1-3 Trợ Lý

**Plan đầy đủ**: `plans/261008-0850-crew-v3-r1-3/` — `plan.md` (Global Constraints, Review Focus, bảng gói/ticket, Interface, Nghiệm thu AC-3), `session.md` (SP-1, BR-1, nhánh dự phòng H5), `policy.md` (PO-1, PO-2), `roles.md` (RA-1 kèm toàn văn `assistant.md`, RA-2, RA-3), `env.md` (EN-1), `goi-ngu-canh.md` (scout), `sdd-ledger.md` (O12–O15, 18+ ruling, Q1–Q3). Spec: `docs/superpowers/specs/2026-10-08-crew-v3-r1-3-assistant.md`.

Ticket:
| ID | Việc | Gói | Phụ thuộc | Model |
|---|---|---|---|---|
| SP-1 | Spike O12 (chỉ test): H1 ghi resume vào run issue B rồi claim, `execute` nhận session của A kể cả wake `issue_assigned` → go (H1) / no-go (H5), ghi `spike-session.md` | `session` | — | opus |
| BR-1 | `server/src/crew/bundle-resume.ts` (`crew-bundle id= seq=`), nối vào `beforeClaim` sau cổng tải | `session` | SP-1 | opus |
| PO-1 | `server/src/crew/model-policy.ts` (`CREW_COMPLEXITY_MODEL`, `checkAgentAdapterOverrides`), 422 `crew_override_forbidden` ở H4 + H2 | `policy` | — | opus |
| PO-2 | Template `research` 2 stage, H4 chọn khi board tạo issue gốc có nhãn `research` | `policy` | PO-1 | opus |
| RA-1 | `crew/agents/assistant.md` + test | `roles` | — | sonnet |
| RA-2 | `apply-roles.sh agent <id> assistant <pin> <executorIds>` + `render-instructions.mjs` | `roles` | RA-1 | sonnet |
| RA-3 | `executor.md`/`reviewer.md`/`integrator.md` cho research, `crew-stack on=`, mã lỗi mới | `roles` | RA-1 | sonnet |
| EN-1 | Dựng trên spike: agent Trợ Lý, executor thứ hai, environment + worktree riêng, nhãn `research` | `env` | — | — |
| AC-3 | Nghiệm thu (cổng 1–5) trên Mac mini + spike, deploy image từ nhánh `crew/r1-3` | — | tất cả | opus điều phối |

Song song: ba gói fork `session`, `policy`, `roles` trên ba worktree riêng (`.worktrees/paperclip-r13-{session,policy,roles}`, nhánh `crew/r13-*` từ `v3`), file ghi rời nhau (bảng sở hữu file trong `plan.md`); `env` không sửa code. Tích hợp vào `crew/r1-3`, chạy `crew/release/verify.sh`, rồi deploy.

**Câu hỏi cần owner chốt trước/trong R1-3** (ghi cả trong ledger):
1. **Q1**: Trợ Lý chạy **sonnet** (O10, plan đang để) hay **opus** (tách việc là lập kế hoạch)? Phiên trước nghiêng opus cho riêng Trợ Lý.
2. **Q2**: nếu AC-3 Cổng 2c thấy agent tự `PATCH /api/agents/<chính nó>` đổi `adapterConfig` được (lách ghim) thì chặn bằng gì — plan dừng hỏi owner khi gặp.
3. **Q3**: lúc chạy AC-3, owner tắt emulator trên Mac mini hay chấp nhận chờ cổng tải (load thường 15–25 > ngưỡng 8, có thể >1 giờ mỗi run)? Ngày 07/10 owner từng cho tạm nâng `maxLoad1` lên 16 (PATCH `metadata.crewLoadGate` của 3 environment qua API) rồi trả về 8.
4. **`crew-stack on=<identifier>`** (planner tự thêm): issue con thứ hai cùng gói dựng nhánh từ commit đã duyệt của con thứ nhất — cần owner gật.

Owner dặn 08/10: **plan xong thì dừng** vì Mac mini đang chạy nhiều dự án. Hỏi owner trước khi bắt đầu code R1-3.

**Còn treo ngoài R1-3**: `forbiddenRootReason` của `crew-mac` chưa chặn `~/Documents`; `pnpm lint` đỏ trên file có sẵn; R2: hook pre-receive phía remote chặn push chưa xác minh; R1-4 UI, R1-5 nâng upstream + phát hành (plan stock-first Phần 2).

---

## 9. Lệnh hay dùng

```sh
# VPS: run đang chạy / kiểm sức khỏe
ssh nhamoiplatform 'sh /opt/crew-v3-spike/ops/active-runs.sh'          # rỗng = không có run
ssh nhamoiplatform 'cd /opt/crew-v3-spike && ./api.sh GET /plugins/crew.core/health'
ssh nhamoiplatform 'cd /opt/crew-v3-spike && docker compose exec -T db psql -U paperclip -d paperclip -Atc "select …"'

# Fork: kiểm tích hợp (chạy từ đúng toplevel)
cd .worktrees/<worktree> && cd "$(git rev-parse --show-toplevel)" && bash crew/release/verify.sh
node --test crew/agents/*.test.mjs; node --test crew/ops/*.test.mjs crew/release/*.test.mjs
node crew/release/check-core-hooks.mjs                                  # in "4/5; lỗi: 0"

# Deploy lên spike (chỉ khi active-runs rỗng; owner đã duyệt kiểu R1-2 cho /opt/crew-v3-spike)
scp crew/ops/*.sh crew/ops/*.py nhamoiplatform:/opt/crew-v3-spike/ops/
bash crew/ops/overlay-source.sh                                         # đóng gói HEAD sạch, đẩy lên VPS
ssh nhamoiplatform 'cd /opt/crew-v3-spike/ops && bash overlay-job.sh <short9> && bash inspect-image.sh crew-v3/paperclip:v3-<short9> && bash deploy.sh crew-v3/paperclip:v3-<short9>'
# rollback: ssh nhamoiplatform 'cd /opt/crew-v3-spike/ops && bash rollback.sh <TS in ra bởi deploy>'

# Repo Crew: docs khớp code
node "$(git config --get crew-docs.bundle)" check --range v3..HEAD
```

Mọi process nền mình bật: ghi lệnh/PID/cổng vào `processes.md` của plan, tắt khi xong. Không giết process của owner hay phiên khác (Mac mini có nhiều phiên Claude khác của owner).
