# Gói `env` — dựng Trợ Lý và executor thứ hai trên spike (EN-1)

Trợ Lý (phiên điều phối) làm, model sonnet. Không sửa file repo; mọi id, lệnh và kết quả ghi vào [sdd-ledger.md](sdd-ledger.md) mục "Tiến độ". Owner đã duyệt kiểu R1-2 cho việc tạo agent/environment, sửa `~/crew-agents`, cấu hình agent: không hỏi lại. Không đổi `/opt/crew-v3-spike/crew-policy/crew-policy.json` (Trợ Lý và executor không có trong file).

## Bối cảnh đã xác minh

- Spike hiện có (ac-2-report "Dựng vai trò"): executor `mac-claude` `37a9e834-6aaf-4970-8f89-95dbc8a019f2` (environment `mac-mini` `f92f5dd8…`), reviewer `946f1a73-…`, integrator `b7cd2d89-…`, environment riêng mỗi agent (cùng host, cổng 2222, secret key, knownHosts, `in_place`, `crewLoadGate` 8/60). Paperclip không có cwd riêng theo agent trên SSH: `remoteCwd` = `remoteWorkspacePath` của environment.
- Worktree agent cùng một kho git (repo thử `~/crew-spike/repo-a`, `origin` bare `~/crew-spike/repo-a-origin.git`), tạo bằng `git worktree add -b <nhánh> ~/crew-agents/<tên> origin/main`.
- Lệnh API trên VPS: `/opt/crew-v3-spike/api.sh <METHOD> <path không có /api> [body JSON]` (cách `apply-roles.sh` gọi). VPS không có `node`: chạy `apply-roles.sh` trên Mac với `CREW_SPIKE_ROOT` trỏ shim gọi `api.sh` qua ssh (như AC-2).
- Route: `POST /companies/:companyId/environments` (`routes/environments.ts:1014`), `POST /environments/:id/probe` (l.1382), `POST /companies/:companyId/agents` (`routes/agents.ts:4724`), `POST /companies/:companyId/labels` (`routes/issues.ts:8393`).

## Các bước

- [ ] **Step 1: Tài nguyên và backup.** Trên Mac: `uptime`, `memory_pressure | tail -1`, `df -h /`. Ghi vào bảng Tài nguyên của ledger. Trên VPS: `crew/ops/backup.sh` (như R1-2), ghi tên bản backup.

- [ ] **Step 2: Worktree trên Mac.**

```bash
cd ~/crew-agents/mac-claude && git fetch origin
git worktree add -b agent/mac-claude-2 ~/crew-agents/mac-claude-2 origin/main
git worktree add -b agent/assistant ~/crew-agents/assistant origin/main
git -C ~/crew-agents/mac-claude-2 rev-parse --git-common-dir   # phải trùng kho của mac-claude
grep -n paperclip-runtime "$(git -C ~/crew-agents/mac-claude rev-parse --git-common-dir)/info/exclude"
```

Kỳ vọng: hai worktree sạch; `info/exclude` có `.paperclip-runtime/` (dùng chung kho). `git config --get crew-docs.bundle` trong worktree mới in đúng bundle (config của kho).

- [ ] **Step 3: Environment.** Đọc `GET /environments/<id mac-mini>`; tạo hai environment chép nguyên `driver`, `config` (host, cổng, secret, knownHosts) và `metadata` (`workspaceRealizationMode: "in_place"`, `crewLoadGate: {"maxLoad1":8,"maxWaitMinutes":60}`), chỉ đổi tên và `remoteWorkspacePath`: `mac-mini-executor-2` → `/Users/phannhatquang/crew-agents/mac-claude-2`, `mac-mini-assistant` → `/Users/phannhatquang/crew-agents/assistant`. `POST /environments/<id>/probe` từng cái: `ok: true`, `remoteCwd` đúng thư mục.

- [ ] **Step 4: Agent.** Đọc `GET /agents/37a9e834-…` (executor hiện có). Tạo `mac-claude-2` và `tro-ly` bằng `POST /companies/<c>/agents`: `adapterType: "claude_local"`, `adapterConfig` chép từ `mac-claude` (`command` = wrapper `/Users/phannhatquang/.crew/bin/crew-claude-run`, `model: "claude-sonnet-5"`, `env: {}`), `runtimeConfig.heartbeat.maxConcurrentRuns = 1`, `defaultEnvironmentId` = environment vừa tạo. Kiểm `mac-claude` cũng có `maxConcurrentRuns = 1` (đọc lại; sai thì `PATCH`).

- [ ] **Step 5: Vai trò.** Sau khi image `crew/r1-3` đã deploy (AC-3 Cổng 1), từ worktree fork `crew/r1-3` trên Mac:

```bash
crew/agents/apply-roles.sh agent <id mac-claude-2> executor "$HOME/.crew/workflows/superpowers/6.4.1-5bf4e7801107"
crew/agents/apply-roles.sh agent <id mac-claude> executor "$HOME/.crew/workflows/superpowers/6.4.1-5bf4e7801107"
crew/agents/apply-roles.sh agent <id reviewer> reviewer "$HOME/.crew/workflows/superpowers/6.4.1-5bf4e7801107"
crew/agents/apply-roles.sh agent <id integrator> integrator "$HOME/.crew/workflows/superpowers/6.4.1-5bf4e7801107"
crew/agents/apply-roles.sh agent <id tro-ly> assistant "$HOME/.crew/workflows/superpowers/6.4.1-5bf4e7801107" <id mac-claude>,<id mac-claude-2>
```

Kỳ vọng: rc 0 cả năm; đọc lại `GET /agents/<id>`: `command` là wrapper, `extraArgs` kết thúc `--plugin-dir …/6.4.1-5bf4e7801107`; sha256 `AGENTS.md` trên server của Trợ Lý = `assistant.md` + mục "Executor của company" có đúng hai id.

- [ ] **Step 6: Nhãn research.** `POST /companies/<c>/labels` `{"name":"research","color":"#6b7280"}`; đã có thì bỏ qua (unique theo company).

- [ ] **Step 7: Doctor.** Trên Mac: `crew-mac doctor` đạt (worktree mới nằm dưới `~/crew-agents`, không dưới `~/Documents`); `crew-mac workflow-check --root ~/crew-agents/<tên> --plugin-dir <pin>` sạch cho `mac-claude-2` và `assistant`.

- [ ] **Step 8: Ghi ledger.** Id agent, environment, nhãn, lệnh và kết quả mỗi bước; ghi rõ "owner duyệt sẵn (R1-2), không hỏi lại".

## Rủi ro

| Rủi ro | Khả năng × ảnh hưởng | Giảm thiểu |
|---|---|---|
| Mac tải cao (emulator) nên cổng tải 8 giữ run lâu | Cao × Trung bình | Chạy AC-3 lúc tải thấp; quá 60 phút liền thì hỏi owner tạm tắt emulator (không tự nâng `maxLoad1`) |
| Hai executor cùng lúc làm tải vượt 8 trước lần thăm dò sau (khe A1/A3 R1-2) | Trung bình × Thấp | Chỉ 2 executor; prompt nhỏ |
| Quota dùng chung với owner | Trung bình × Trung bình | Prompt nhỏ trên `repo-a`; theo dõi quota tuần trong ledger; dừng khi gần ngưỡng |

**Rollback:** pause `tro-ly` và `mac-claude-2` (`PATCH /agents/<id>` `status: paused` bằng board), xóa hai environment nếu không dùng tiếp, `git worktree remove ~/crew-agents/{mac-claude-2,assistant}` sau khi chắc không còn process (theo process-management). Restore DB từ backup Step 1 chỉ khi dữ liệu hỏng.
