# Báo cáo cài đặt: deploy tự động sau khi owner duyệt

- Thời gian: 12/10/2026 15:00 → 15:25 (Asia/Ho_Chi_Minh). Người làm: agent. Kế hoạch: `plan.md` cùng thư mục.
- Kết quả: **DONE_WITH_CONCERNS**. Code, test và dry-run xong. Chưa rollout: không push, không deploy prod, không
  sửa instructions live, không ghi gì lên prod (chỉ đọc).

## 1. Commit (worktree `.worktrees/paperclip-issues-ui`, nhánh `crew/project-access`, chưa push)

| Commit | Nội dung |
|---|---|
| `2ebe474b7` feat(ops) | `crew/ops/auto-deploy.mjs`, `crew/ops/auto-deploy-vps.sh` và 2 file test, `crew/release/auto-deploy.json` |
| `7d18a08da` feat(agents) | `crew/agents/integrator.md` thêm bước 7b, test, fixture render `integrator.md` |
| `820d7fa13` fix(agents) | `${T}:` thay cho `$T:` trong ref git (zsh hiểu `$T:r`, `$T:c` là modifier), gồm cả lệnh push có sẵn ở bước 5 |
| `2e8dce852` fix(ops) | CLI chạy được khi gọi qua đường dẫn symlink (`mktemp -d` trên macOS) |

Chỉ add đúng đường dẫn của mình (`git commit -- <paths>`), không đụng file crew-web của agent Roadmap ngoài fixture
`packages/crew-web/test/lib/instructions/__fixtures__/rendered/integrator.md`.

## 2. Thiết kế đã làm (tóm tắt, chi tiết ở `plan.md`)

- **Bật theo repo**: `crew/release/auto-deploy.json` đọc ở đúng commit `T`. Repo không có file thì bước 7b không chạy gì
  và không comment (test `enqueue` exit 3, không body).
- **Integrator bước 7b** (sau `crew-merge … pushed=yes`, trước `PATCH done`): `git show "${T}:crew/ops/auto-deploy.mjs"`
  vào thư mục tạm rồi `enqueue`; đăng nguyên body JSON lệnh viết (`crew-deploy sha=<T> status=queued` hoặc `failed`).
  Lỗi deploy không chặn chuyển stage.
- **Job tách khỏi run**: `launchctl bootstrap gui/<uid>` một plist `RunAtLoad`, `KeepAlive=false`,
  `AbandonProcessGroup`, env chỉ `PATH/HOME/LANG` (không `PAPERCLIP_*`, không JWT). Script chạy là bản sao lấy từ
  commit đã duyệt trong `~/.crew/auto-deploy/<repoKey>/bin/`.
- **Worker** (`node`): kiểm commit trên `origin/crew/v3.5` + comment `crew-merge … pushed=yes` của agent → không deploy
  lùi (bản đang chạy phải là tổ tiên) → worktree `~/crew-deploy/paperclip` sạch, `pnpm install --frozen-lockfile` →
  cổng kiểm crew-web (test, typecheck, `biome check src test e2e`), thêm `verify.sh` và `node --test crew/ops/*.test.mjs`
  khi đổi file ngoài `packages/crew-web/`/`*.md` → `overlay-source.sh` + `overlay-job.sh` (dùng lại image nếu có) →
  `inspect-image.sh` (MISSING/FAIL, `crewCoreHooks=3`, `crew-ui=<sha>`, dòng manifest crew.core giống image đang chạy)
  → chờ hết run → `deploy.sh` → kiểm sau (health commit, plugin healthy, `/` và `/paperclip/` 200, crew-ui trong
  index.html, claim 2xx) tối đa 3 phút → xấu thì `rollback.sh <TS>` tự động.
- **Chờ run**: trên VPS, lượt 600 giây, 2 giây hỏi `active-runs.sh` một lần, rỗng là khởi `deploy.sh` ngay trong
  cùng lệnh, tách khỏi phiên ssh (`setsid nohup`, giữ `flock` tới khi deploy xong). Tối đa `maxWaitMinutes` (180).
  `deploy.sh` rc 2 (run chen vào) → chờ tiếp. Commit mới hơn tới trong lúc chờ → làm lại cho commit mới nhất, deploy
  một lần, comment cho mọi issue có commit nằm trong bản đó.
- **Báo kết quả**: dòng đầu `crew-deploy sha=<40hex> status=<queued|deployed|failed|rolled_back>`; `deployed` kèm bảng
  kiểm và lệnh `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh <TS>`.
- **Vì sao không dùng phiên board để comment kết quả**: comment của user trên issue đã `done` mà còn
  `assigneeAgentId` bị server tự chuyển về `todo` và đánh thức agent (`shouldImplicitlyMoveCommentedIssueToTodo`,
  `server/src/routes/issues.ts`). Đã kiểm trên prod (chỉ đọc): TPS-112 `done` vẫn giao `p-2ps-landing-integrator`.
  Comment của agent thì không bao giờ tự mở lại. Nên kết quả được đăng bằng **API key của `paperclip-integrator`**
  để ở VPS `/opt/crew-v3-spike/.deploy-agent-key` (0600), gửi bằng `curl -H @file` (key không lên dòng lệnh, test xác
  nhận không in ra). Thiếu key → `NO_KEY`, không comment, chỉ ghi `worker.log`/`history.jsonl` trên Mac.

## 3. Bằng chứng

### 3.1 Cơ chế tách job (đo trên Mac mini, từ sshd của app cổng 2222, cùng sshd với agent)

| Thử | Kết quả |
|---|---|
| `launchctl managername` trong phiên sshd 2222 | `Aqua` (sshd do app 2P Crew sinh nên phiên ở gui domain) |
| `launchctl submit` một lệnh thoát 0 | chạy **3 lần trong 25 giây** (KeepAlive ngầm) → loại |
| `launchctl bootstrap gui/501 <plist>` lệnh `sleep 40` | chạy đúng 1 lần, `ppid=1`, pgid riêng, sống sau khi ssh thoát, `last exit code = 0` |
| Job launchd main=`node` | đọc `/Volumes/CORSAIR/...`, chạy `git`, `ssh nhamoiplatform` đều ok |
| Job launchd main=`bash` | `git --git-dir=/Volumes/CORSAIR/...` báo `not a git repository` (TCC theo main) |
| Job launchd đọc `~/Documents/...` | bị từ chối (rc 1) |
| `crew-mac reap --dry-run` khi worker đang chạy | không chọn gì |

### 3.2 Dry-run trọn luồng (lệnh đúng như bước 7b, chạy trong `zsh` qua sshd 2222)

Origin là một bare repo tạm trong scratchpad (dựng từ repo `/Volumes/CORSAIR/Projects/2p-crew/paperclip`, nhánh
`crew/v3.5` trỏ `2e8dce852`), nên không push đi đâu. Env phiên có `PAPERCLIP_RUN_ID`/`PAPERCLIP_API_KEY` giả.

1. **Lần 1** (bỏ): clone tạm mượn object từ `~/Documents` → `git fetch` trong job treo 5 phút (TCC), worker báo đúng
   `failed … rc 124` rồi thoát. Lỗi của cách dựng clone thử, không của thiết kế; dẫn tới quyết định không dùng
   `~/Documents` (mục 3.1).
2. **Lần 2** `--dry-run --simulate-merge-ok --max-wait-min 5`: enqueue rc 0, body `crew-deploy sha=2e8dce852… status=queued`;
   phiên ssh thoát ngay. Worker: `pid 91795, ppid 1, pgid 91795, PAPERCLIP_RUN_ID không có`. Chọn cổng đầy đủ (vì đổi
   `crew/ops`), in các lệnh worktree/cổng/build/inspect/deploy sẽ chạy; đọc thật `active-runs` (15:19:27 rỗng); kiểm
   sau trên bản đang chạy: health ok `6e249660b…`, plugin `healthy`, `/` 200, `/paperclip/` 200, claim 472 lần 2xx, 0
   lần 5xx, 0 dòng lỗi. In comment `crew-deploy sha=2e8dce852… status=deployed` thay vì đăng. `last exit code = 0`.
3. **Lần 3** không `--simulate-merge-ok`, issue giả: đọc comment trên prod → không có `crew-merge` → in comment
   `crew-deploy sha=… status=failed` "không thấy comment `crew-merge …`", không chạy cổng hay build.

### 3.3 Test

- `node --test crew/ops/*.test.mjs`: 107 pass, 0 fail (24 test mới cho auto-deploy, 8 cho phần VPS, gồm: deploy
  tách phiên vẫn chạy xong khi process group của bên gọi bị kill; comment gửi đúng header từ file, không in key).
- `node --test crew/agents/*.test.mjs`: 138 pass, 0 fail.
- `node --test crew/release/*.test.mjs`: 21 pass. `check-core-hooks.mjs`: 0 lỗi.
- crew-web `vitest run test/lib/instructions/render.test.ts`: 18 pass (fixture integrator khớp).

## 4. Việc foreman làm để rollout

1. **Review và merge** 4 commit ở mục 1 vào `crew/v3.5` như mọi lần (file cấu hình `crew/release/auto-deploy.json`
   đi cùng; chưa có tác dụng cho tới bước 4). Deploy bản này lên prod theo quy trình tay như cũ (không đổi server).
2. **Tạo API key cho `paperclip-integrator`** (`9662b498-f44e-424c-b055-48c057e77944`) trên VPS, ghi thẳng vào file,
   không in token:
   ```sh
   ssh nhamoiplatform 'cd /opt/crew-v3-spike && umask 077 && ./api.sh POST /agents/9662b498-f44e-424c-b055-48c057e77944/keys "{\"name\":\"auto-deploy\"}" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.stdout.write(d[\"token\"]); print(\"key id:\", d[\"id\"], file=sys.stderr)" > .deploy-agent-key && ls -l .deploy-agent-key'
   ```
   Ghi lại `key id` để thu hồi sau này. Kiểm danh tính bằng key (chỉ đọc, không in key):
   ```sh
   ssh nhamoiplatform 'cd /opt/crew-v3-spike && umask 077 && h=$(mktemp) && printf "Authorization: Bearer %s\n" "$(cat .deploy-agent-key)" > "$h" && curl -sS -H @"$h" https://crew.2p-solutions.com/api/agents/me | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get(\"id\"), d.get(\"name\"))"; rm -f "$h"'
   ```
   Phải in `9662b498-… paperclip-integrator`.
3. **Kiểm comment bằng key không mở lại issue** (một lần, trên issue đã đóng thuộc project paperclip đang giao
   `paperclip-integrator`, hoặc đợi deploy thật đầu tiên): sau comment, `GET /issues/<id>` vẫn `status=done`. Nếu bị mở
   lại thì xóa key (`DELETE /api/agents/9662b498-…/keys/<keyId>` và file) và báo lại em.
4. **Cập nhật instructions live của integrator** bằng bản `crew/agents/integrator.md` mới, ít nhất cho
   `paperclip-integrator`; nên áp cả các integrator khác vì có sửa lỗi zsh ở lệnh push (bước 7b là no-op ở repo không
   có file cấu hình). Dùng công cụ sẵn có trên VPS (đã đọc file hiện tại để lấy `baseHash`, rồi
   `PUT /api/agents/:id/instructions-bundle/file`):
   `apply-roles.sh agent <integratorId> integrator <thư mục Superpowers đã ghim trên Mac>` (sau khi chép
   `crew/agents/` mới lên VPS như các lần trước). Kiểm lại bằng `GET /api/agents/<id>/instructions-bundle/file?path=AGENTS.md`
   có chuỗi `7b. **Deploy tự động`.
5. **Mac mini**: không cần cài gì. Lần deploy đầu worker tự tạo worktree `~/crew-deploy/paperclip` (từ repo
   `/Volumes/CORSAIR/Projects/2p-crew/paperclip`) và chạy `pnpm install` (lâu hơn các lần sau). Không dùng
   `paperclip-r3-dp` dưới `~/Documents` vì job launchd không đọc được `~/Documents`.
6. **Theo dõi / dừng khẩn**:
   - Trạng thái: `cat ~/.crew/auto-deploy/paperclip/status.json ~/.crew/auto-deploy/paperclip/queue.json`;
     log: `tail -f ~/.crew/auto-deploy/paperclip/worker.log`; lịch sử: `history.jsonl`.
   - Dừng job: `launchctl bootout gui/$(id -u)/com.2p.crew.auto-deploy.paperclip` (nếu đang trong `deploy.sh` thì
     deploy trên VPS vẫn chạy tiếp; xem `ops/auto-deploy-<short>-<epoch>.log` và `.rc` trên VPS).
   - Thử lại bằng tay (dry-run) từ worktree integrator sau khi merge:
     `T=$(git rev-parse origin/crew/v3.5); D=$(mktemp -d); git show "${T}:crew/ops/auto-deploy.mjs" > "$D/a.mjs"; node "$D/a.mjs" enqueue --repo "$PWD" --issue <id issue thật> --sha "$T" --dry-run --max-wait-min 10`
     (label `….paperclip.dry`, không ghi gì lên prod; xóa `~/.crew/auto-deploy/paperclip-dry` bằng `trash` sau đó).
7. **Tắt tính năng**: commit `"enabled": false` trong `crew/release/auto-deploy.json`, hoặc trả instructions integrator
   về bản cũ; thu hồi key (`DELETE /api/agents/9662b498-…/keys/<keyId>`, xóa `/opt/crew-v3-spike/.deploy-agent-key`).

## 5. Dọn dẹp

- Đã `launchctl bootout` mọi job thử (`ltest-*`, `auto-deploy.paperclip.dry`); `launchctl list` chỉ còn
  `com.2p.crew-mac-status`, `com.2p.crew-backup-pull`, `com.2p.crew-mac-reaper` của owner.
- Đã `trash` `~/.crew/auto-deploy/paperclip-dry` và các repo tạm trong scratchpad (log 3 lần dry-run giữ trong scratchpad
  của phiên). Không có file mới trên VPS (helper chạy từ file tạm và tự xóa).
- Đã thêm một dòng `known_hosts` cho `[100.102.189.67]:2222` khi ssh thử vào sshd của app.
- Process `vitest run src/__tests__/crew- src/crew/` trong `paperclip-issues-ui/server` không phải của em (agent
  Roadmap); em không đụng.

## 6. Concern

1. **Lệnh push có sẵn ở bước 5 của integrator hỏng dưới zsh** (`"$T:refs/heads/$DEFAULT"` thành `<sha>efs/heads/…`).
   Đã sửa trong commit `820d7fa13`, nhưng instructions live hiện tại vẫn mang lỗi tới khi foreman áp bước 4. Các vai
   trò khác không có mẫu `"$X:` nào.
2. **API key dài hạn của agent** là secret mới trên VPS (cạnh cookie board). Đã giới hạn: chỉ ở VPS 0600, không lên
   dòng lệnh, không in. Hướng gọn hơn về sau: một route plugin `crew.core` cho comment hệ thống (plugin comment không
   kèm `actorUserId` không đánh thức agent) — cần đổi plugin nên ngoài phạm vi lần này.
3. **Chưa chạy thử trên VPS** các lệnh ghi (`deploy-when-idle`, `rollback`, `comment`): chỉ test bằng ROOT giả trên Mac
   (cùng code, `setsid` được thay bằng perl khi thiếu). Lần deploy thật đầu tiên nên có foreman theo dõi.
4. **TCC theo file chạy chính**: worker dựa vào việc `node` của Homebrew đã có quyền đọc `/Volumes/CORSAIR`. Khi node
   nâng cấp đổi đường dẫn (`/opt/homebrew/Cellar/node@24/<ver>`), quyền có thể phải cấp lại; triệu chứng là `git fetch`
   lỗi hoặc treo và comment `failed`.
5. Cổng kiểm chạy trên Mac mini cùng lúc với agent (verify.sh đầy đủ ~3 phút + crew-web ~2 phút): có thể làm chậm run
   khác trong lúc đó.

Status: DONE_WITH_CONCERNS
Summary: Đã cài deploy tự động (launchd job tách khỏi run, chờ hết run, cổng kiểm, build, deploy, kiểm sau, tự rollback, comment bằng key agent) và bước 7b của integrator, test xanh, dry-run từ sshd 2222 chứng minh job sống sau khi run kết thúc và in đúng comment.
Concerns/Blockers: Cần foreman tạo API key agent trên VPS và cập nhật instructions live; lệnh push hiện có của integrator hỏng dưới zsh (đã sửa trong commit, chưa live).
