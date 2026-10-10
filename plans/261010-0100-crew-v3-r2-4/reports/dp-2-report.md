# DP-2 R2-4: deploy `crew/r24` @ `8fdd145c3` (FX-OPS4 + FX-WR) lên prod

- Thời gian: 2026-10-10 15:53 → 16:04 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent opus.
- Phạm vi:
  - FX-OPS4: `f96b0fa00` (overlay-source cho đóng gói adapter-patch) và `08d62c170` (inspect-image kiểm vá adapter).
  - FX-WR: `f33949c34` (readiness A1 nhận `CODEX_HOME` bị che, A5 nhận thư mục agent kiểu cũ).
  - Không có migration mới. Không cài lại app Mac (code app không đổi). Codex giữ TẮT. OpenCode vẫn hoãn.
- Kết quả: **DONE_WITH_CONCERNS.**
  - Prod chạy `crew-v3/paperclip:v3-8fdd145c3`, plugin `crew.core` ready. Không phải rollback.
  - `overlay-source.sh` GỐC chấp nhận commit (FX-OPS4 đạt, không cần bản chép).
  - `repo-a` hết đỏ: tab Sẵn sàng "Mọi mục đều đạt", tab Vai trò chọn được agent.
  - 1 concern về `inspect-image.sh` trên VPS (concern 1).

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-826a49ea6` |
| Image sau | `crew-v3/paperclip:v3-8fdd145c3` |
| Lệnh rollback prod | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261010-155958`, đưa về `v3-826a49ea6`. Không có migration mới nên không cần gỡ gì trong DB |
| Backup DB | `20261010-1558` (làm tay), `20261010-1559` (`deploy.sh`). Cả hai 26M, builtin ok |
| Script ops VPS cũ | `/opt/crew-v3-spike/ops.bak-dp2-r24/` |
| Tag cục bộ | `crew/v3.3-rc3` (annotated) trên `8fdd145c3`. Chưa push |

## Bước 1: cổng kiểm

Worktree `.worktrees/paperclip-r3-dp` chạy `git checkout --detach crew/r24` (`8fdd145c3`, sạch).

**verify.sh** chạy 15:54:04 → 15:57:08, rc 0, **XANH**.

| Mục | Kết quả |
|---|---|
| Hook, vá lõi | mốc hook đủ, test vá đạt |
| Server crew | 616 |
| Adapter claude / codex / opencode | 17 / 10 / 12 |
| Plugin | 429 |
| Agents | 136 |
| tsc | 0 lỗi |
| Bundle | không có `require("react")` trần |

**Kiểm thêm:**
- ops `node --test crew/ops/*.test.mjs`: 70/70 (DP-1: 62, FX-OPS4 thêm 8).
- crew-web `vitest run`: 118 file, 974 ca xanh (1 todo). `tsc -b` 0 lỗi.
- `ipcs -m` trước và sau giống nhau, không rò.

## Bước 2: deploy prod

1. **Chuẩn bị.**
   - `active-runs.sh` rỗng. Image đang chạy `v3-826a49ea6`.
   - `backup.sh` → `20261010-1558` ok.
   - Sao lưu `ops/` vào `ops.bak-dp2-r24`.
2. **overlay-source.sh GỐC** (`crew/ops/overlay-source.sh 8fdd145c3`, không bản chép): **chấp nhận**, rc 0, 15:58:59 → 15:59:04.
   - Upload ok, 26 file server.
   - Tarball có `packages/adapters/{claude,codex,opencode}-local/src/server/*.ts`, `crew-commit.txt` = `8fdd145c3c8d…`.
   - Lỗi FX-OPS4 của DP-1 đã hết.
3. **Build.** `overlay-job.sh 8fdd145c3` chạy 15:59:13 → 15:59:26, `JOB_EXIT rc=0`, `min_avail=5312MiB`.
4. **inspect-image.sh `<image> 8fdd145c3`** (bản mới của fork), rc 0, không có dòng MISSING hay FAIL:
   - `issues crewCoreHooks=3`, đủ 12 file crew, `plugin events delivered as call ok`;
   - `crew-ui=8fdd145c3c8d888a8dc8c9ef7cdd00772b54e3e6`;
   - phần vá adapter:

   | Vá | File | Kết quả |
   |---|---|---|
   | P2 | `claude-local/src/server/execute.ts` | ok (sha256 `5dacb403c40b`, anchor 1x) |
   | P3 | `claude-local/src/server/index.ts` | ok (sha256 `b9137edc44c1`, anchor 2x) |
   | P4 | `claude-local/src/server/execute.ts` | ok (sha256 `5dacb403c40b`, anchor 1x) |
   | P5 | `codex-local/src/server/index.ts` | ok (sha256 `e316122c757c`, anchor 2x) |
   | P6 | `opencode-local/src/server/execute.ts` | ok (sha256 `cfd9bfe88d57`, anchor 1x) |
   | P7 | `opencode-local/src/server/index.ts` | ok (sha256 `99fbe9031a51`, anchor 2x) |

   **Chạy ở đâu:** trên Mac, với `DOCKER_HOST=ssh://nhamoiplatform`. Lệnh `docker run` chạy trên VPS, còn `node` và `git` chạy trên Mac. Lý do: VPS **không có `node`**, và `inspect-adapters.mjs` cần cả `node` lẫn git của fork (xem concern 1).
5. **So hash và scp script ops.** So sha256 của `ops/*.sh`, `*.py`, `nginx-crew.conf` và `inspect-adapters.mjs` giữa VPS và fork. Có 3 file lệch: `inspect-image.sh`, `overlay-source.sh`, và `inspect-adapters.mjs` (VPS chưa có).
   - Đã scp `overlay-source.sh` và `inspect-adapters.mjs`. sha256 trên VPS khớp fork (`87399861…`, `8c2c3047…`).
   - **Không scp `inspect-image.sh` mới.** Lý do: `deploy.sh` chạy `INSPECT=$("$ROOT/ops/inspect-image.sh" "$NEW" 2>&1)` dưới `set -euo pipefail`. Bản mới gọi `node` ở cuối, VPS không có `node`, nên script trả 1 và `deploy.sh` sẽ dừng.
   - VPS giữ `inspect-image.sh` bản `826a49ea6` (sha256 `761b2265…`). Phần kiểm image của bản này giống hệt bản mới, chỉ thiếu 3 dòng gọi `inspect-adapters.mjs`.
6. **Deploy.** `active-runs.sh` rỗng lần 2. `deploy.sh crew-v3/paperclip:v3-8fdd145c3` chạy 15:59:52 → 16:00:30, rc 0, in `deploy ok: crew-v3/paperclip:v3-826a49ea6 -> crew-v3/paperclip:v3-8fdd145c3, rollback TS=20261010-155958`.

**Kiểm sau deploy:**

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `status ok`, commit `8fdd145c3c8d…` |
| Plugin | `crew.core` status `ready`, `plugin-state.sh` trả healthy |
| Migration | Không có migration mới (diff `826a49ea6..8fdd145c3` chỉ đổi `crew/ops` và `crew-web`) |
| Site | Đều 200: `crew /` (mốc crew-ui `8fdd145c3`), `/cli-auth/x`, `/paperclip/` (title Paperclip), `2p-solutions.com`, `kidyschool.com` |
| `check-crew-companies.sh` | `ok 2 company` |
| `agent-permissions.sh` | TPS `--check --assistant 6c27410e-7a14-4439-9e07-cbbfa2a743fd`: rc 0. `--all-crew --check` cùng cờ: rc 0 |
| App Mac | `POST …/machine-jobs/claim` 68 lần từ lúc deploy, tất cả 204, 0 lần khác 204 |
| Log server từ lúc deploy (361 dòng) | 0 `access_token`/`refresh_token`/`id_token`. 0 `config.get`, `host refused`, `INVOCATION_SCOPE_DENIED`. 0 error. 2 warn đều do script xem UI của em: `get-session` 401 trước khi đăng nhập, `/api/companies` 403 sau khi đăng xuất |
| Run | `active-runs.sh` rỗng trước deploy, sau deploy và lúc kết thúc |

## Bước 3: xem UI (Playwright Node, chỉ xem)

- Đăng nhập Crew Spike Admin. Mật khẩu lấy từ `.env` VPS, truyền qua stdin, không trace.
- Không bấm Lưu, không gạt công tắc. Request ghi duy nhất là `POST /api/auth/sign-in/email`, rồi đăng xuất (200).
- File phiên `state-dp2.json` đã tự xóa. Quét ledger, output và script: 0 file chứa mật khẩu.
- Ảnh nằm ở `reports/dp2-shots/` (01–06).

| Mục | Kết quả |
|---|---|
| Mốc crew-ui | `8fdd145c3c8d…` |
| Công tắc trang Máy (01), trước và sau khi xem | Claude `true`, **Codex `false`**, OpenCode `false` |
| Tab Vai trò `repo-a` (02–04) | **Chọn được agent.** Cả 8 ô mở được, không ô nào bị khóa. Mỗi ô Trợ Lý, Executor 1/2, Reviewer, Integrator đều có 5 agent R1 (tro-ly, mac-claude, mac-claude-2, reviewer, integrator). Executor Codex và Reviewer Codex có "Không có", `repo-a-executor-codex`, `repo-a-reviewer-codex`. Executor OpenCode chỉ có "Không có" (chưa có agent OpenCode, đúng). Cả 7 ô đã gán đều "Sẵn sàng" |
| Tab Sẵn sàng `repo-a` (05) | **"Mọi mục đều đạt."** `repo-a-executor-codex` đạt A1. Ở DP-1, hai agent Codex trượt A1 và 5 agent R1 trượt A5; nay đã hết |
| Tab Sẵn sàng `2ps-landing` (06), để đối chứng | "Mọi mục đều đạt." |

## Bước 4: tag

`crew/v3.3-rc3` (annotated, cục bộ) trên `8fdd145c3`. Chưa push.

## Concern

1. **FX-OPS5: `inspect-image.sh` mới không chạy được trên VPS.** Script đã có sẵn trong fork (lệch FX-OPS4), không do DP-2 làm hỏng.
   - `inspect-adapters.mjs` cần `node` và repo git của fork (`git -C <fork> show <commit>:…`). VPS `/opt/crew-v3-spike` không có `node` và không phải repo git.
   - `deploy.sh` gọi `inspect-image.sh "$NEW"` dưới `set -e`. Nếu scp bản mới lên VPS, mọi lần deploy sẽ dừng ở bước kiểm image. Việc dừng này xảy ra trước backup và trước khi đổi compose, nên không làm hỏng prod, nhưng deploy bị chặn.
   - Cách em làm lần này:
     - giữ bản `826a49ea6` trên VPS;
     - chạy bản mới trên Mac qua `DOCKER_HOST=ssh://nhamoiplatform`, P2–P7 đều ok.
   - Gợi ý sửa, một trong hai cách:
     - (a) chạy phần adapter bên trong container (image có node; so với sha256 lấy từ tarball `crew-commit.txt` hoặc từ manifest đi kèm overlay), không cần git;
     - (b) tách hẳn: `deploy.sh` trên VPS chỉ kiểm image, còn `inspect-adapters.mjs` là bước bắt buộc chạy trên Mac với `DOCKER_HOST=ssh://…`, ghi rõ trong runbook.
   - Cần thêm test cho trường hợp không có `node` hoặc không có git.
2. **Quan sát, không do deploy: bản tin máy Mac lúc có lúc không có runtime.** Trang Máy lúc xem (bản tin 16:01) hiện Codex "Phiên bản chưa rõ · chưa rõ" và OpenCode "chưa rõ".
   - Trong DB, các bản tin 15:54:58, 15:56:29, 15:58:15, 16:01:06 có `runtimes` rỗng. Các bản tin 15:59:38 và 16:02:34 có `codex-cli 0.161.0, loggedIn true`.
   - Hiện tượng bắt đầu từ trước khi deploy (15:54, đúng lúc em chạy verify.sh). Lúc DP-1 chạy verify cũng có 7 bản tin rỗng.
   - Em đoán do máy Mac bận (tải 1 phút khoảng 5), các lệnh đọc phiên bản trong crew-mac quá giờ. Trang Máy còn có thêm cảnh báo "Không đọc kịp log TCC".
   - Không ảnh hưởng run, vì Codex tắt. Nên xem lại thời hạn đọc phiên bản của crew-mac, hoặc giữ giá trị cũ khi đọc trượt, trước khi bật Codex cho AC-C.

Vẫn mở từ DP-1 và RV-1:
- AC-C chờ owner bật công tắc Codex (m9 đo `gpt-6-sol` ở run Codex đầu);
- m12 chưa gạt thử trên T1;
- AC-O chờ key OpenCode.

## Không làm

- Không sửa code repo, không commit, không push.
- Không bật công tắc nào, không chạy run Codex, không tạo issue.
- Không chạy migration, không cài lại app Mac hay crew-mac.
- Không `rm -rf`. Chỉ `rmSync` file phiên Playwright của chính script trong scratchpad.
- Không in secret.

## Process và thư mục

- Không còn process nền do em khởi động. Các process Playwright MCP đang chạy trên Mac thuộc phiên khác, em không đụng.
- Worktree `paperclip-r3-dp` đang detached `8fdd145c3`, sạch. Đã ghi vào `processes.md`.

Status: DONE_WITH_CONCERNS
Summary: Prod chạy crew-v3/paperclip:v3-8fdd145c3 (rollback: `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261010-155958` về v3-826a49ea6). overlay-source.sh gốc chấp nhận, adapter P2–P7 ok, plugin ready. repo-a "Mọi mục đều đạt", tab Vai trò chọn được agent, Codex vẫn tắt. Tag cục bộ crew/v3.3-rc3.
Concerns/Blockers: (1) inspect-image.sh mới cần node và git fork mà VPS không có, nên chưa scp lên VPS (nếu scp, deploy.sh sẽ dừng ở bước kiểm image) và đã chạy bản mới từ Mac qua DOCKER_HOST=ssh → cần FX-OPS5. (2) Bản tin máy Mac lúc có lúc không có runtime khi máy bận (có từ trước deploy) → nên xem lại thời hạn đọc trong crew-mac trước AC-C.
