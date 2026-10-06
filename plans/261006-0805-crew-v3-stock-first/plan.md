# Crew v3 stock-first trên Paperclip — Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chạy Crew trên Paperclip gần như nguyên bản để vẫn nâng cấp được theo mỗi bản stable của upstream. Agent chạy trên Mac, làm trực tiếp trên repo của Mac, có gate review, gate của owner và docs gate.

**Architecture:** Paperclip stock giữ vai trò lõi: issue, run, scheduler, session, review/approval stage và giao diện web. Mac là một SSH environment của Paperclip, kết nối qua Tailscale và chạy adapter có sẵn (`claude_local` ở R1), workspace ở chế độ `in_place`. Phần riêng của Crew nằm ngoài lõi: plugin Paperclip, skill/agent instructions và một công cụ dòng lệnh cài đặt trên Mac. Lõi chỉ được vá dưới dạng hook một dòng có registry, và mục tiêu là không có hook nào.

**Tech Stack:** Paperclip `v2026.1001.0` (Node ≥ 24.11, pnpm 9.15.4 qua Corepack, embedded PostgreSQL khi dev), Paperclip plugin SDK `packages/plugins/sdk` 1.0.0, Tailscale, OpenSSH (macOS Remote Login), Claude Code CLI, Superpowers skills, Crew `packages/docs-kit`.

**Spec:** [Thiết kế v3](../../docs/superpowers/specs/2026-10-05-crew-v3-paperclip-design.md) cho yêu cầu sản phẩm, [đánh giá khả thi stock-first](../reports/feasibility-261006-0805-crew-v3-paperclip-stock-first.md) cho kiến trúc. Khi hai tài liệu khác nhau về kiến trúc, đánh giá khả thi và kế hoạch này được ưu tiên. Spec sẽ được cập nhật sau khi spike đạt (Task S7).

**Thay thế:** Kế hoạch này thay [kế hoạch 261005-2154](../261005-2154-crew-v3-paperclip/plan.md). Thư mục cũ được giữ làm tài liệu tham chiếu và nguồn bằng chứng. Các task 00-04/00-05 cũ (remote adapter, transport, patch P1–P4) bị hủy.

## Quyết định của owner (06/10/2026)

1. Kết nối Mac bằng Tailscale + SSH environment của upstream, không tự viết gateway/transport.
2. Repo bắt buộc nằm trên Mac, dùng workspace realization `in_place`.
3. Các module v2 về transport, journal process và ACK/replay do upstream thay thế. Telemetry/resource check, policy, workflow registry/isolation, docs-kit và UI map vẫn được giữ, port khi cần.
4. R1 làm mỏng: Superpowers × Claude Code chạy xuyên suốt. BMAD, Codex, API OpenAI-compatible, file/ảnh, signed macOS app và updater chuyển sang R2.
5. Vẫn giữ khả năng nâng Paperclip theo mỗi bản stable của upstream.

## Global Constraints

- Không sửa file lõi Paperclip, trừ hook một dòng ở đầu hàm. Mỗi hook có mục trong `crew/release/core-hooks.json` và có test kiểm hook còn tồn tại. Import của hook đặt ở cuối file.
- Hook đã chốt (owner duyệt 06/10/2026): **H2** `beforeIssueWrite` ở đầu `runUpdate` trong `server/src/services/issues.ts`, chặn ghi `done` khi chưa qua đủ stage của execution policy. Lý do: upstream chỉ áp execution policy ở REST route, còn plugin host, native runtime và service nội bộ gọi thẳng `issueService.update`. Hook dự phòng: **H1** `beforeClaim` ở đầu `claimQueuedRun` trong `heartbeat.ts`, chỉ thêm nếu S5 cho thấy plugin lease không giữ được run ở trạng thái queued.
- Không tạo scheduler, queue hay bảng ticket thứ hai. Paperclip là nguồn trạng thái duy nhất cho issue/run/session.
- Credential AI (login Claude/Codex, API key) chỉ nằm trên Mac. VPS chỉ giữ auth của Paperclip, SSH key để vào Mac và secret DB.
- UI/docs tiếng Việt, identifier/path tiếng Anh, giờ hiển thị Asia/Ho_Chi_Minh.
- Backup DB trước mọi migration hoặc thay đổi dữ liệu. Không dùng cổng 5432. DB dev của repo Crew giữ ở `127.0.0.1:55432`.
- Spike chạy trên máy dev và một VPS thử. Không deploy production khi chưa có approval của owner.
- Mỗi process nền (server Paperclip, container) ghi lệnh/PID/cổng vào `plans/261006-0805-crew-v3-stock-first/processes.md` và dừng khi xong task.
- Không đổi sang cách tiếp cận khác nếu spike thất bại. Báo kết quả và hỏi owner.

## Review Focus

1. Mất kết nối Tailscale/SSH khi agent đang chạy: run không được báo thành công, không bị chạy lại song song, và process trên Mac không bị bỏ mồ côi. Kiểm ở Task S3.
2. Agent hoặc API tự chuyển issue sang `done` để bỏ qua review, gate của owner hoặc docs: phải bị runtime chặn hoặc chuyển về `in_review`. Kiểm ở Task S4.
3. Repo trên Mac có thay đổi chưa commit của owner khi agent bắt đầu chạy `in_place`: không được ghi đè hoặc xóa. Kiểm ở Task S2.
4. Mac quá tải hoặc offline khi có run mới: không spawn và run phải chờ. Kiểm ở Task S5.
5. Nâng Paperclip lên bản mới: plugin Crew vẫn load, hook còn đủ, dữ liệu Crew không mất. Kiểm ở Task S6.

---

## Phần 1 — Spike khả thi (gate go/no-go)

Mục tiêu: chứng minh bằng chạy thật rằng kiến trúc stock-first đáp ứng năm điểm trong Review Focus mà không cần vá lõi, hoặc chỉ cần một vài hook một dòng. Spike không viết tính năng sản phẩm. Kết quả ghi vào `plans/261006-0805-crew-v3-stock-first/spike-report.md`, mỗi task một mục: lệnh đã chạy, kết quả, bằng chứng (log, ảnh chụp, ID issue/run) và kết luận đạt/không đạt.

**Tiêu chí go:** S1–S4 và S6 đạt. S5 đạt hoặc cần tối đa 3 hook một dòng. Tổng số hook lõi không quá 5.
**Tiêu chí no-go:** Một trong các điểm S2/S3/S4 chỉ giải được bằng patch sâu trong `heartbeat.ts`/`issues.ts`, hoặc conflict khi nâng không tự động hóa được. Khi đó dừng và báo owner.

Giao việc theo gói ngữ cảnh ở [tickets.md](tickets.md); trong lúc spike mỗi gói ghi file `spike-<gói>.md` riêng, S7 gom về `spike-report.md`.

Thứ tự: S1 → S2 → S3 → S4 → S5 → S6 → S7. S4 và S6 không phụ thuộc Mac, có thể chạy song song với S2/S3 nếu tài nguyên máy cho phép (không chạy hai server Paperclip cùng lúc trên máy 24 GB).

### Task S1: Dựng Paperclip stock và nối Mac làm SSH environment

**Files:**
- Create: `plans/261006-0805-crew-v3-stock-first/spike-report.md`
- Create: `plans/261006-0805-crew-v3-stock-first/processes.md`
- Không sửa file nào trong fork.

- [ ] **Step 1: Chuẩn bị máy chủ đóng vai VPS.** Dùng VPS thử nếu có. Nếu không, chạy Paperclip trong container Linux trên chính Mac và coi container là VPS. Ghi lựa chọn vào spike-report.
- [ ] **Step 2: Khởi động Paperclip ở bản pin.**

```bash
cd /Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-v3
git status --short   # chỉ được thấy .crew-setup/
git log -1 --format=%H   # 8f8a0ab7effbd6a0584107d8038736c134ee5047
corepack pnpm dev:once
```

Kỳ vọng: API ở `http://localhost:3100`, embedded PostgreSQL tự tạo. Ghi PID/cổng vào `processes.md`.

- [ ] **Step 3: Bật Remote Login trên Mac và cài Tailscale trên cả Mac lẫn máy chủ.** Mac: System Settings → General → Sharing → Remote Login, chỉ cho user chạy agent. Tạo SSH key riêng cho Paperclip, thêm public key vào `~/.ssh/authorized_keys` của user đó. Kiểm tra từ máy chủ:

```bash
ssh -i <paperclip-key> <user>@<mac-tailscale-name> 'echo ok && which claude && claude --version'
```

Kỳ vọng: `ok` và phiên bản Claude Code. Nếu `claude` không có trong PATH của phiên SSH không tương tác, ghi lại và sửa `~/.zshenv`, không sửa adapter.

- [ ] **Step 4: Tạo company, project, environment SSH và agent `claude_local` trên UI Paperclip.** Environment trỏ tới Mac qua tên Tailscale. Agent dùng environment đó. Chạy probe environment trên UI. Kỳ vọng probe pass.
- [ ] **Step 5: Ghi kết quả S1 vào spike-report** gồm phiên bản, tên host đã ẩn danh, kết quả probe và ảnh chụp màn hình.

### Task S2: Chạy issue thật ở chế độ `in_place` trên repo của Mac

**Files:**
- Modify: `plans/261006-0805-crew-v3-stock-first/spike-report.md`
- Đọc: `server/src/services/workspace-realization.ts`, `server/src/services/environment-runtime.ts`, `server/src/services/environment-run-orchestrator.ts` trong fork.

- [ ] **Step 1: Tạo repo thử trên Mac** tại `~/crew-spike/repo-a`: `git init`, một commit có `README.md`, cộng một file `owner-wip.txt` chưa commit để kiểm Review Focus 3.
- [ ] **Step 2: Tìm cách bật `in_place` cho SSH environment.** Đọc nơi `workspaceRealization.mode` và `remoteCwd` được đọc từ lease/provider metadata. Ghi rõ một trong ba kết luận: (a) cấu hình được qua UI/API của environment hoặc project workspace; (b) cần sandbox provider plugin tự trả metadata `in_place`; (c) không làm được nếu không vá lõi.
- [ ] **Step 3: Tạo issue "Thêm dòng 'hello from crew' vào README.md và commit"**, giao cho agent `claude_local`. Theo dõi run tới khi kết thúc.
- [ ] **Step 4: Kiểm trên Mac.**

```bash
cd ~/crew-spike/repo-a && git log --oneline -3 && git status --short && cat owner-wip.txt
```

Kỳ vọng: có commit mới của agent, `owner-wip.txt` còn nguyên. Trên server: log/transcript của run hiển thị trên issue và không có bản sao repo trên VPS (nếu là `in_place`).

- [ ] **Step 5: Kiểm credential** bằng cách tìm trên máy chủ trong thư mục dữ liệu Paperclip và biến môi trường của process server: không có file credential Claude và không có `ANTHROPIC_API_KEY`. Ghi lệnh và kết quả.
- [ ] **Step 6: Ghi kết luận S2.** Nếu kết luận là (c), dừng spike và báo owner.

### Task S3: Mất kết nối, restart server và hủy run

**Files:**
- Modify: `plans/261006-0805-crew-v3-stock-first/spike-report.md`

- [ ] **Step 1: Issue chạy lâu.** Tạo issue yêu cầu agent chạy `sleep 120 && echo done >> long.txt` rồi commit.
- [ ] **Step 2: Ngắt mạng khi đang chạy.** Sau khoảng 20 giây, tắt Tailscale trên máy chủ trong 60 giây rồi bật lại. Ghi trạng thái run theo thời gian (UI và `GET` run từ API). Trên Mac ghi `ps -o pid,ppid,command -U <user> | grep -i claude` trước, trong và sau khi ngắt.
- [ ] **Step 3: Restart server khi đang chạy.** Lặp lại Step 1, dừng process Paperclip ở giây 20, khởi động lại. Ghi trạng thái run và process trên Mac.
- [ ] **Step 4: Hủy run.** Lặp lại Step 1, bấm cancel trên UI. Kiểm process trên Mac đã dừng trong 30 giây.
- [ ] **Step 5: Đánh giá theo Review Focus 1.** Ba câu cần trả lời có/không kèm bằng chứng: run có bị báo thành công sai không, có run thứ hai chạy song song cùng issue không, có process mồ côi trên Mac không. Ghi rõ hành vi nào là upstream mặc định chấp nhận được và hành vi nào cần xử lý (cần hook ở `reapOrphanedRuns`/`cancelRunInternal` hay chỉ cần dọn process bằng công cụ trên Mac).

### Task S4: Gate review, owner và docs bằng execution policy

**Files:**
- Modify: `plans/261006-0805-crew-v3-stock-first/spike-report.md`
- Đọc: `docs/guides/execution-policy.md` trong fork.

Task này chạy được với agent local trên máy chủ, không cần Mac.

- [ ] **Step 1: Tạo ba agent:** `executor`, `reviewer` và `integrator` (đóng vai gate docs/merge). Tạo issue có `executionPolicy` gồm ba stage theo thứ tự: review (`reviewer`), review (`integrator`), approval (user owner).
- [ ] **Step 2: Đường thuận.** Executor chuyển `done` → kỳ vọng thành `in_review` và giao cho reviewer. Reviewer approve → giao integrator. Integrator approve → chờ owner. Owner approve → `done`. Ghi bảng `issue_execution_decisions`.
- [ ] **Step 3: Thử bỏ qua gate.** Dùng token của agent executor gọi API `PATCH` issue sang `done` khi đang ở stage reviewer. Thử thêm agent reviewer tự review chính task mình thực thi. Kỳ vọng cả hai bị chặn hoặc chuyển hướng. Ghi request/response (đã ẩn token).
- [ ] **Step 4: Vòng sửa.** Reviewer chọn changes requested sáu lần liên tiếp. Ghi lại xem plugin có nhận được event cho mỗi quyết định không (dùng plugin mẫu của SDK hoặc log activity) để làm cơ sở cho rule "tối đa 5 vòng rồi chuyển owner".
- [ ] **Step 5: Blockers.** Tạo issue B bị chặn bởi issue A. Kiểm B không được wake trước khi A `done`.
- [ ] **Step 6: Dùng chung session giữa hai issue.** Session của agent được giữ theo `(agent, adapter, taskKey)`, mặc định `taskKey` = issue id (`deriveTaskKey` trong `heartbeat.ts`), nên hai issue giao cùng agent mặc định chạy hai session riêng. Tạo hai issue A → B (B bị chặn bởi A) cùng giao `executor`, thử đặt cùng một `taskKey` cho cả hai qua đường API/wake context mà stock cho phép. Kỳ vọng run của B resume session của A (kiểm `agent_task_sessions` và session id trong log run). Ghi rõ một trong ba kết luận: làm được qua API stock; cần plugin; cần hook lõi.
- [ ] **Step 7: Ghi kết luận S4.** Liệt kê gate nào runtime chặn đồng bộ, gate nào chỉ quan sát được sau commit, các đường bypass còn lại (ví dụ board user), và cách dùng chung session ở Step 6.

### Task S5: Kiểm tải của Mac trước khi spawn

**Files:**
- Modify: `plans/261006-0805-crew-v3-stock-first/spike-report.md`
- Đọc: `server/src/services/plugin-environment-driver.ts`, `server/src/services/environment-probe.ts`, `packages/plugins/sdk/src/types.ts` trong fork.

- [ ] **Step 1: Đọc hợp đồng sandbox provider plugin** (acquire/resume lease, probe) và xác định plugin có thể trả lỗi "chờ" khi Mac quá tải mà run vẫn ở hàng đợi, không bị đánh fail rồi retry vòng.
- [ ] **Step 2: Thử nghiệm tối thiểu.** Nếu Step 1 khả thi, viết plugin thử trong scratchpad (không commit) đọc `sysctl vm.loadavg` qua SSH và từ chối lease khi load vượt ngưỡng đặt thấp có chủ đích. Nếu không khả thi, thử hook một dòng ở đầu `claimQueuedRun` trên worktree tạm và đo.
- [ ] **Step 3: Mac offline.** Tắt Tailscale trên Mac, tạo issue mới. Kỳ vọng run chờ hoặc lỗi rõ ràng, không bị chuyển sang environment khác.
- [ ] **Step 4: Ghi kết luận S5** gồm cách làm được chọn, số hook cần (0–3) và hành vi khi offline.

### Task S6: Diễn tập nâng upstream với phần Crew đi kèm

**Files:**
- Create (trên worktree tạm, không phải nhánh `v3`): plugin rỗng `packages/crew-plugin/` và các hook kết luận từ S3/S5.
- Modify: `plans/261006-0805-crew-v3-stock-first/spike-report.md`

- [ ] **Step 1: Tạo worktree tạm tại scratchpad, kiểm tra thư mục trước khi làm bất cứ gì.**

```bash
REPO=/Users/phannhatquang/Documents/projects/crew/.worktrees/paperclip-v3
WT=<scratchpad>/upgrade-rehearsal
git -C "$REPO" worktree add --detach "$WT" v2026.1001.0
cd "$WT" && test "$(git rev-parse --show-toplevel)" = "$WT" || exit 1
```

- [ ] **Step 2: Thêm plugin rỗng và các hook đã chọn**, commit trên worktree tạm.
- [ ] **Step 3: Merge `upstream/master`** (hoặc stable mới nhất nếu đã có bản sau `v2026.1001.0`). Ghi số file và hunk conflict.
- [ ] **Step 4: Chạy lại plugin loader test và typecheck server** trên kết quả merge:

```bash
corepack pnpm --filter @paperclipai/server exec vitest run src/adapters/plugin-loader.test.ts
corepack pnpm --filter @paperclipai/server typecheck
```

- [ ] **Step 5: Gỡ worktree tạm** (`git worktree remove --force "$WT"`) và kiểm `git -C "$REPO" log -1` vẫn là `8f8a0ab7e`.
- [ ] **Step 6: Ghi kết luận S6** gồm thời gian thực hiện, conflict và đề xuất nhịp nâng (mỗi stable hay mỗi tháng).

### Task S7: Kết luận go/no-go và cập nhật tài liệu

**Files:**
- Modify: `plans/261006-0805-crew-v3-stock-first/spike-report.md`
- Modify: `docs/superpowers/specs/2026-10-05-crew-v3-paperclip-design.md` (mục 2, 3, 5, 8, 9) khi kết quả là go
- Modify: `plans/261006-0805-crew-v3-stock-first/plan.md` (Phần 2) khi kết quả là go

- [ ] **Step 1: Tổng hợp** bảng S1–S6: đạt/không, bằng chứng, số hook.
- [ ] **Step 2: Kết luận go/no-go** theo tiêu chí ở đầu Phần 1.
- [ ] **Step 3: Nếu go,** cập nhật spec cho kiến trúc stock-first và viết detailed plan cho Phase R1-1 theo đúng định dạng task của skill writing-plans (exact path/type/test lấy từ kết quả spike). Nếu no-go, ghi các lựa chọn cho owner và dừng.
- [ ] **Step 4: Dừng mọi process** ghi trong `processes.md` và xác nhận không còn process nào.
- [ ] **Step 5: Commit** trên nhánh `v3` của repo Crew (không phải fork) các tài liệu trong thư mục plan này, report và spec:

```bash
git add plans/261006-0805-crew-v3-stock-first plans/reports/feasibility-261006-0805-crew-v3-paperclip-stock-first.md docs/superpowers/specs/2026-10-05-crew-v3-paperclip-design.md
git commit -m "docs(v3): kế hoạch stock-first và kết quả spike Paperclip"
```

---

## Phần 2 — Lộ trình sau spike

Mỗi phase dưới đây chỉ được bắt đầu khi đã có detailed plan riêng, viết sau S7 từ bằng chứng spike. Danh sách dưới là phạm vi và tiêu chí nghiệm thu, không phải hướng dẫn code.

### Vị trí code Crew

| Đường dẫn | Nơi | Trách nhiệm |
|---|---|---|
| `packages/crew-plugin/` | fork Paperclip | Plugin: rule 5 vòng sửa, leo thang owner, lease gate theo máy (nếu S5 chọn plugin), UI extension (map yêu cầu, docs, máy) |
| `crew/release/` | fork Paperclip | `core-hooks.json`, script nâng upstream, test kiểm hook |
| `crew/skills/` | fork Paperclip hoặc repo Crew | Instructions cho agent Trợ Lý, executor, reviewer, integrator theo Superpowers |
| `packages/docs-kit/` | repo Crew (đã có) | Validator docs dùng trong gate integrator |
| `apps/crew-mac/` | repo Crew | CLI `crew-mac doctor/setup`: Tailscale, Remote Login, login Claude, Superpowers đã ghim, telemetry |

### R1 / v3.0 — Superpowers × Claude Code chạy xuyên suốt

**R1-1 Nền và kết nối Mac.** Fork được pin. Có script nâng upstream và test hook. Có `crew-mac doctor/setup`. Kiểm tải theo máy (theo kết luận S5). Backup/restore DB và thư mục dữ liệu Paperclip trên VPS.
*Nghiệm thu:* Mac mới cài từ đầu bằng `crew-mac setup` và chạy được issue thử. Restore từ backup ra instance mới đọc đúng issue/run cũ.

**R1-2 Workflow Superpowers và gate.** Superpowers được cài và ghim phiên bản trên Mac, kèm cách chặn nạp skill chéo (port registry/isolation từ v2). Template `executionPolicy` gồm reviewer, integrator và owner. Plugin áp rule 5 vòng sửa. Integrator merge, chạy docs-kit trên merged commit và chỉ approve khi docs hợp lệ.
*Nghiệm thu:* Agent không bỏ qua được review/owner/docs qua API. Vòng sửa thứ 6 được chuyển cho owner. Merge mà docs lỗi thì issue chưa `done`.

**R1-3 Trợ Lý.** Agent Trợ Lý chạy trên Mac, đọc docs dự án, dùng skill Superpowers (brainstorm, plan) để tách yêu cầu thành issue con có blockers và execution policy qua API Paperclip, hỏi owner khi thiếu thông tin. Chia issue con theo gói ngữ cảnh: ticket cùng gói thì gộp, gộp quá lớn thì giao cùng một agent chạy lần lượt (blocker nối tiếp) và dùng chung session theo cách S4 Step 6 đã kiểm. Port các policy thuần từ v2 (`model-policy`, `workflow-policy`, `completion-policy`) nếu còn phù hợp.
*Nghiệm thu:* Một yêu cầu nhỏ, một bug và một yêu cầu research đi từ text trên web tới issue con, thực thi, review, merge và docs-sync. Một yêu cầu có hai issue con cùng gói thì hai issue đó do cùng một agent làm lần lượt, và run thứ hai resume đúng session của run thứ nhất.

**R1-4 UI Crew trong Paperclip.** UI extension qua plugin: map yêu cầu và issue con với dependency và vòng sửa (port từ `v2/web/src/graph`), trạng thái docs, trạng thái máy. Không làm lại board/list/dialog đã có trong Paperclip.
*Nghiệm thu:* Playwright với API/DB thật: tạo yêu cầu, mở map, mở dialog issue, owner trả lời approval.

**R1-5 Nâng upstream thật và phát hành.** Nâng fork lên một bản stable mới hơn bản pin bằng script R1-1, chạy lại toàn bộ nghiệm thu R1 và diễn tập restore. Whole-branch review. Owner duyệt deploy.
*Nghiệm thu:* Tag `v3.0` trên đúng commit đã kiểm. Báo cáo nâng cấp có số conflict và thời gian.

### R2 / v3.1 — Mở rộng

- BMAD (cài, ghim, cách ly; đề xuất epic/story qua Trợ Lý).
- `codex_local` và `opencode_local` với endpoint OpenAI-compatible; công tắc runtime theo máy; chọn model theo độ khó và lưu lý do; fallback cùng máy.
- Ảnh/file trong yêu cầu và comment (port extractor v2), dùng attachment của Paperclip.
- Docs graph/dedup, thống kê dung lượng, usage rollup.
- App macOS có chữ ký (bọc `crew-mac`), updater từ xa.
- Nghiệm thu lại toàn bộ R1 sau mỗi lần nâng upstream.

### Quy trình nâng Paperclip (giữ suốt R1/R2)

1. Mỗi khi upstream ra stable mới: tạo nhánh `sync/paperclip-<tag>` từ nhánh tích hợp và merge tag đó vào.
2. Chạy script kiểm hook (`crew/release/`): mọi hook trong `core-hooks.json` phải còn đúng vị trí. Nếu thiếu thì áp lại theo neo.
3. Chạy typecheck, plugin loader test, test của plugin Crew và một issue thử trên Mac.
4. Backup DB, migrate bản sao, chạy lại smoke test, rồi mới merge vào nhánh tích hợp.
5. Không tự deploy. Owner duyệt từng lần lên production.

Nhịp mặc định: nâng mỗi bản stable. Nếu một lần nâng tốn quá một ngày công thì ghi lại nguyên nhân và cân nhắc nâng theo tháng.

### Tận dụng v2

| Giữ hoặc port | Upstream thay thế | Bỏ |
|---|---|---|
| Policy thuần (model, workflow, completion), workflow registry/isolation, docs-kit/validator, telemetry macOS, UI graph/map, extractor (R2), test và findings v2 làm regression | Transport, journal process, ACK/replay, scheduler, ticket server/DB, auth, board/list | Remote adapter tự viết, patch P1–P4, ticket map HTML offline của PM |

Nhánh `codex/crew-v2-server` được giữ nguyên làm nguồn tham chiếu.

### Chính sách test theo tầng

Áp dụng cho cả agent của Crew khi làm dự án của owner lẫn khi phát triển chính Crew. Mục tiêu: mỗi loại test chỉ chạy **một lần ở đúng tầng**, không chạy lại cùng một suite ở nhiều bước.

| Tầng | Ai chạy | Chạy gì | Không chạy |
|---|---|---|---|
| Task | executor | Test của file/module vừa đổi và test mới cho tiêu chí nghiệm thu, typecheck package bị đổi. Ghi lệnh, kết quả và commit SHA vào comment của issue. | Full suite, E2E |
| Review task | reviewer | Đọc diff và log test của executor. Chỉ chạy lại test khi log không khớp SHA hoặc nghi ngờ kết quả. | Chạy lại toàn bộ test của executor |
| Commit (git hook) | máy | Lint file staged và `crew-docs check --staged`, tổng cộng vài giây. | Bất kỳ test nào |
| Tích hợp yêu cầu | integrator | Một lần trên merged tree: test của các package bị đổi và các package phụ thuộc, docs-kit theo merged commit. | Test của package không liên quan |
| Phát hành / nâng upstream | release | Full suite upstream + Crew, E2E Playwright, smoke trên Mac. | — |

Quy tắc kèm theo:

- Kết quả test gắn với commit SHA. SHA không đổi thì không chạy lại.
- Sửa sau review chỉ cần chạy lại test liên quan tới phần sửa. Reviewer chỉ review lại phần sửa.
- Docs được cập nhật một lần ở bước integrator cho cả yêu cầu, không bắt cập nhật docs ở mỗi commit của executor.
- Không có model call định kỳ để "kiểm tra hệ thống". Monitor 5 phút chỉ là truy vấn trạng thái.

### Cách vận hành công việc

- Mỗi task: một implementer, một reviewer độc lập, test theo bảng trên. Bỏ ledger tài nguyên/quota theo phút, bỏ re-review tài liệu kế hoạch, bỏ ticket map HTML. Kiểm tải máy do gate tự động đảm nhiệm, không do PM ghi chép.
- Sau R1-1, theo dõi công việc bằng chính Paperclip: mỗi task trong plan là một issue, đúng mục tiêu sản phẩm.
- ETA chỉ đưa ra sau spike và sau khi đo được thời gian của R1-1.

## Self-review

- Mọi quyết định owner ngày 06/10 đều có chỗ trong kế hoạch: Tailscale/SSH (S1, R1-1), repo trên Mac (S2), thay module v2 (bảng tận dụng), R1 mỏng (R1/R2), giữ khả năng nâng cấp (S6, quy trình nâng).
- Năm điểm Review Focus đều có task kiểm: S3, S4, S2, S5, S6.
- Yêu cầu sản phẩm của spec v3 §4 không bị bỏ. Các phần chuyển sang R2 được liệt kê rõ. Signed installer chuyển từ R1 sang R2 theo quyết định R1 mỏng.
- Phần 2 cố ý không có code chi tiết. Detailed plan cho từng phase được viết sau S7 từ bằng chứng thật, vì exact API của environment/plugin chỉ chốt được khi spike xong.
