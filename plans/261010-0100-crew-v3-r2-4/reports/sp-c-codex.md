# SP-C — Đo Codex (C1, C2, C3, A1, A2, A3, A4, A15)

Ngày: 10/10/2026, 12:43–13:24 (Asia/Ho_Chi_Minh, theo `date`). Agent Claude (opus). Fork đọc ở `f4a8b30a6`
(= `crew/r24`, worktree `paperclip-r3-wizards`, chỉ đọc). Thư mục tạm `~/crew-r24-probe/` (đã dọn bằng `trash`).

Quota: **đúng 1** `codex exec` (12:46:40–12:46:49, rc=0). Không chạy `-m gpt-6-sol`. Ngoài ra có 1 lần
`codex app-server` (stdin là ống `sleep 8`, **không gửi yêu cầu model**) chỉ để kiểm `ps -E` đọc được env của binary
codex — xem A4.

Không đọc nội dung `auth.json` (chỉ `stat`: quyền `600`, `4203` byte). Không có token trong báo cáo.

## Bảng kết quả

| # | Kết quả | Bằng chứng ngắn |
|---|---|---|
| C1 / A15 | **ĐẠT** | Qua sshd Crew (cổng 2222, khóa doctor): `codex login status` → `Logged in using ChatGPT`, `rc=0`; desktop cũng `Logged in using ChatGPT`, `rc=0`. Câu trạng thái in ra **stderr** (stdout rỗng) |
| A1 | **ĐẠT (gpt-6-luna)** / `gpt-6-sol` **CHỜ** | `codex exec -m gpt-6-luna -c model_reasoning_effort=low` trả `ok`, rc=0, 2.640 token. `gpt-6-sol` có trong `models_cache.json` (visibility `list`, effort tới `ultra`) nhưng chưa chạy thật |
| A2 / C2 | **KHÔNG ĐẠT** (giả định sai) — có phương án | `restore` ném lỗi khi asset `home` thiếu `auth.json` qua SSH → run thành công bị đánh failed. Asset có `auth.json` = `{}` thì `kept-host`, không ghi gì. Chi tiết dưới |
| C2 (phụ) | **KHÔNG ĐẠT** — phát hiện mới, chặn trước cả `restore` | VPS không có `auth.json` + CODEX_HOME managed → server chặn `configuration_incomplete` trước dispatch, adapter cũng ném. Cần `env.CODEX_HOME` ngoài cây managed. Chi tiết dưới |
| C2 (CODEX_HOME) | **ĐẠT** | `CODEX_HOME` adapter truyền xuống = `<authoritativeRoot>/.paperclip-runtime/codex/home`, đường tuyệt đối trên Mac |
| A3 / C3 | **ĐẠT**, có lưu ý | `rate_limits.primary.used_percent`, `window_minutes`, `resets_at` (epoch giây) trong sự kiện `event_msg`/`token_count`. Không cần token |
| A4 | **ĐẠT có điều kiện** | `ps -E -axww` đọc được env của binary codex qua sshd (thấy `PAPERCLIP_RUN_ID`). Chụp `ps` lúc `exec` **hụt** (lỗi của SP-C, xem dưới); fixture dựng từ argv đã chạy + bằng chứng `app-server` |

## C1 / A15 — đăng nhập qua sshd

Lệnh (sshd Crew đang nghe `100.102.189.67:2222`, không phải `127.0.0.1` như `probe.md` ghi; `known_hosts` của
`~/.crew-mac` khớp host đó):

```
ssh -F /dev/null -p 2222 -i ~/.crew-mac/doctor_ed25519 -o BatchMode=yes -o IdentitiesOnly=yes \
  -o UserKnownHostsFile="$HOME/.crew-mac/known_hosts" "$USER@100.102.189.67" \
  '~/.local/bin/codex login status; echo rc=$?; ~/.local/bin/codex --version'
```

Đầu ra: `SSH_CONNECTION` có; `Logged in using ChatGPT`; `rc=0`; `codex-cli 0.161.0`; `HOME=/Users/phannhatquang`;
`~/.codex/auth.json` quyền `600`.

**Cho MR-4 / MR-1 doctor:** câu `Logged in using ChatGPT` nằm ở **stderr**, stdout rỗng (đo: stdout 0 byte, stderr 24
byte). Parser phải đọc cả stderr (hoặc `2>&1`), quyết định chính bằng mã thoát.

`~/.local/bin/codex` là symlink → `~/.codex/packages/standalone/releases/0.161.0-aarch64-apple-darwin/bin/codex`
(Mach-O arm64, hardened runtime, TeamIdentifier `2DC432GLL2`).

## A1 / C3 — một `codex exec`

Dựng đúng dạng wrapper: `CODEX_HOME` tạm (0700) chỉ có `auth.json` → symlink `~/.codex/auth.json`, không
`config.toml`; HOME thật; cwd là một repo git tạm (tránh lỗi "not inside a trusted directory" làm phí lượt).
Chạy qua sshd Crew:

```
PAPERCLIP_RUN_ID=<uuid thử> CODEX_HOME=<tạm> ~/.local/bin/codex exec -m gpt-6-luna \
  -c model_reasoning_effort=low "Trả lời đúng một chữ: ok" </dev/null
```

- stdout: `ok`. rc=0. Thời gian 9 giây.
- stderr (rút gọn): `OpenAI Codex v0.161.0`, `model: gpt-6-luna`, `provider: openai`, `approval: never`,
  `sandbox: read-only`, `reasoning effort: low`, `tokens used 2,640`. Không có lỗi 400 như 08/10.
- Sau run `auth.json` trong CODEX_HOME tạm **vẫn là symlink** (Codex không thay bằng file). `grep` chuỗi
  `access_token|refresh_token|eyJhbGci` trong CODEX_HOME tạm (trừ `auth.json`): 0 file.
- Codex tự tạo trong CODEX_HOME: `sessions/`, `*.sqlite`, `models_cache.json`, `cache/`, `plugins/`, `skills/`,
  `installation_id`, `.sandbox_migration`.

**Quota (A3):** session `sessions/2026/10/10/rollout-…-01a12459-….jsonl`, dòng có `type: "event_msg"`,
`payload.type: "token_count"`, `payload.rate_limits`:

```
"rate_limits":{"limit_id":"codex","limit_name":null,
 "primary":{"used_percent":19.0,"window_minutes":10080,"resets_at":1792155590},
 "secondary":null,"credits":{"has_credits":false,"unlimited":false,"balance":"0"},
 "individual_limit":null,"spend_control_reached":null,"plan_type":"prolite","rate_limit_reached_type":null}
```

`resets_at` 1792155590 = 16/10/2026 19:59. Lưu ý cho MR-4:
- Session cũ nhất gần đây ở `~/.codex/sessions` (08/10) có `plan_type: "free"`, `window_minutes: 43200`. Gói và cửa sổ
  đã đổi → **đọc `window_minutes`**, đừng giả định 5 giờ/tuần; lấy sự kiện `token_count` **mới nhất** theo
  `timestamp` trên mọi file.
- Run qua wrapper ghi session vào `~/.crew/runtimes/codex/<agentId>/sessions/`, **không** vào `~/.codex/sessions`.
  MR-4 phải quét cả `~/.crew/runtimes/codex/*/sessions/**/*.jsonl` lẫn `~/.codex/sessions`, lấy bản mới nhất.
- `secondary` có thể `null`; `rate_limit_reached_type` khác `null` nghĩa là đã chạm trần.

## C2 / A2 — `restore` asset `home` khi thiếu `auth.json`

Đường code (fork `f4a8b30a6`):
- `packages/adapter-utils/src/remote-managed-runtime.ts:238–256`: `restoreWorkspace` gọi `asset.restore` với
  `readFile = readRemoteFile` (`:77–82`, chạy `base64 < <path>` qua `runSshCommand`).
- `packages/adapter-utils/src/ssh.ts:192–220`: lệnh thoát khác 0 → `execFile` reject, `error.code` = **mã thoát số**
  (`1`), không phải `"ENOENT"`.
- `packages/adapters/codex-local/src/server/codex-auth-copyback.ts`: chỉ nuốt lỗi `code === "ENOENT"`; lỗi khác ném lại.
- `packages/adapters/codex-local/src/server/execute.ts:848–851`: `restore` của asset `home` gọi `copyBackCodexAuth`.
- `execute.ts:1590–1604`: `restoreRemoteWorkspace` lỗi → log `Failed to restore workspace changes…`, rồi
  `if (executionError === null) throw error` → **run Codex thành công bị đánh failed**.

Test tạm (scratchpad, không commit, đã dọn), chạy `vitest 4.1.11` của fork:
1. `runSshCommand` thật tới sshd Crew, `base64 < <asset-home>/auth.json` (file không có) → lỗi
   `{ code: 1, stderr: "sh: …/auth.json: No such file or directory" }`. `copyBackCodexAuth` với `readSandboxAuth` đó →
   **ném** `code: 1`, log rỗng, thư mục host không bị ghi.
2. `readSandboxAuth` trả `"{}"`, host không có `auth.json` → `kept-host`, log
   `host credential kept (sandbox copy is not a strictly-newer same-identity subscription credential)`, thư mục host
   vẫn rỗng (không tạo `auth.json`). Test xanh.

Kết luận: giả định A2 **sai**. Phương án dự phòng theo replan (MR-1) **phải sửa một chi tiết**: wrapper tạo
`<CODEX_HOME asset>/auth.json` = `{}` quyền 0600 **nếu chưa có** và **để nguyên, không xóa lúc thoát** — `restore`
chạy lúc trả lease, sau khi `codex` đã thoát, nên xóa lúc thoát thì vẫn ném như ca 1. File `{}` không chứa bí mật;
Codex thật dùng CODEX_HOME riêng `~/.crew/runtimes/codex/<agentId>/` nên không bao giờ đọc file này. Hệ quả phụ: copy-back
`mkdir` thư mục `~/.codex` trên VPS và tạo/xóa file tạm trong đó (không để lại `auth.json`).

Phương án khác (cần owner duyệt, không làm trong SP-C): vá `readRemoteFile` dùng `test -e … || exit 3` và map mã thoát
3 → `ENOENT`, hoặc vá `copyBackCodexAuth` nhận lỗi đó như thiếu file.

### Phát hiện mới: chặn credential trước dispatch (chưa có trong spec/replan)

- `server/src/services/heartbeat.ts:1891–1936`: với `codex_local`, target không phải `sandbox`, nếu
  `evaluateCodexCredentialReadiness` trả `managed && !ready` → `ConfigurationIncompleteFailure`
  (`reason: "codex_credentials_missing"`), run không được dispatch.
- `packages/adapters/codex-local/src/server/codex-home.ts:902–935`: `managed` = `env.CODEX_HOME` không đặt **hoặc** nằm
  dưới `<instanceRoot>/companies/<companyId>/`; `ready` = có `auth.json` dùng được ở home đó hoặc ở `~/.codex` (VPS).
- `execute.ts:379–439` (`assertCodexCredentialsLaunchable`): cùng điều kiện, với SSH thì ném
  `no Codex credentials provisioned…`.

Spec yêu cầu VPS **không** có `auth.json` (AC3), nên agent codex mặc định sẽ luôn bị chặn. Cách không vá: đặt
`adapterConfig.env.CODEX_HOME` của agent codex về một đường **ngoài** cây `companies/<companyId>` trên VPS (ví dụ
`<instanceRoot>/crew-codex-home/<agentId>`). Khi đó `managed: false, ready: true` (`codex-home.ts:916–925`), adapter không
seed/không kiểm, chỉ `mkdir` (`execute.ts:712`) và stage allowlist (`config.toml`, `skills`, `auth.json` nếu có —
`codex-home.ts:577–596`) thành asset `home`. Không đặt `OPENAI_API_KEY` (đặt thì `routes/agents.ts:2533–2551` tự gán
CODEX_HOME managed). Ảnh hưởng: SV/AG (tạo agent, wizard WB-2) phải đặt `env.CODEX_HOME` này; MR-1 vẫn cần `{}` ở trên
vì asset sẽ không có `auth.json`.

`CODEX_HOME` truyền xuống lệnh remote: `execute.ts:879–882, 969` → `preparedExecutionTargetRuntime.assetDirs.home`
= `path.posix.join(workspaceRemoteDir, ".paperclip-runtime", "codex", "home")` (`remote-managed-runtime.ts:136, 160`),
với `in_place` là `authoritativeRoot` → đường tuyệt đối trên Mac. ĐẠT.

## A4 — chuỗi `ps` của `codex exec`

**Sai sót của SP-C:** script chụp `ps` lúc `exec` dùng `ps -E -ww` **không có `-ax`**; process chạy nền không có tty
nên không vào bảng → 14 lần chụp đều rỗng. Không chạy `exec` lần hai (đúng lệnh Trợ Lý). Bù bằng:

1. `codex app-server` (không gửi yêu cầu model) với `PAPERCLIP_RUN_ID=envcheck-0001`, `CODEX_HOME` tạm, qua sshd:
   - `ps -axww -o pid=,ppid=,pgid=,command=` → `84299 84297 84297 /Users/phannhatquang/.local/bin/codex app-server`
     (argv[0] giữ đường symlink như lúc gọi; không có process con codex nào khác, kể cả `codex-code-mode-host`);
   - `ps -E -axww -o pid=,command=` → env **đọc được**, có `PAPERCLIP_RUN_ID=envcheck-0001`. Tên env:
     `CODEX_HOME,PAPERCLIP_RUN_ID,SHELL,TMPDIR,SSH_CLIENT,USER,MAIL,PATH,PWD,SHLVL,HOME,LOGNAME,SSH_CONNECTION,_`.
2. Đối chứng: `/bin/sleep` (binary Apple/SIP) → `ps -E` **không** nối env (đúng chú thích `process-table.ts`);
   `/opt/homebrew/bin/node` → nối env, thấy runId.

Lưu ý cho MR-3:
- Adapter dựng argv `exec --json [-c sandbox…] [--skip-git-repo-check] [--dangerously-bypass-approvals-and-sandbox]
  [--model M] [-c model_reasoning_effort="E"] … -` (`codex-args.ts:66–93`). Khi agent bật `search` thì `--search` được
  **unshift trước `exec`** (`codex-args.ts:79`, mặc định `false` ở `:49`) → luật "phần tử kế basename `codex` là `exec`"
  sẽ trượt. Khuyên: tìm `exec` (hoặc alias `e`) là **phần tử không bắt đầu bằng `-` đầu tiên** sau `codex`.
- Wrapper `exec codex "$@"`: argv[0] là `codex` (nếu gọi qua PATH) hoặc đường tuyệt đối; khớp theo basename.
- Prompt đi qua stdin (`-`), nên argv không chứa prompt của owner.
- Run `exec` ở sandbox `read-only`/`workspace-write` có thể sinh process con (`/usr/bin/sandbox-exec` → shell) khi
  agent chạy lệnh; process đó là binary Apple → env **không** đọc được, MR-3 phải nhận nó qua cây `ppid`/`pgid`.
  Lần đo không chạy lệnh shell nên không thấy.

### Fixture đề xuất `test/fixtures/ps/codex-exec.txt` (dựng tay, đánh dấu như vậy trong tên ca test)

Cùng định dạng `process-table.ts` (`-o pid=,ppid=,pgid=,tty=,etime=,comm=`, `pid=,command=`, `-E pid=,command=`).
Giá trị env đã thay `<bỏ>` trừ `PAPERCLIP_RUN_ID` (uuid thử).

```
# tree
84310 84305 84305 ??       00:05 /Users/a/.local/bin/codex
# argv
84310 /Users/a/.local/bin/codex exec --json --dangerously-bypass-approvals-and-sandbox --model gpt-6-luna -c model_reasoning_effort="low" -
# env (ps -E)
84310 /Users/a/.local/bin/codex exec --json --dangerously-bypass-approvals-and-sandbox --model gpt-6-luna -c model_reasoning_effort="low" - CODEX_HOME=<bỏ> PAPERCLIP_RUN_ID=b8d37c86-3edb-4634-953c-64a1a654ab41 SHELL=<bỏ> TMPDIR=<bỏ> SSH_CLIENT=<bỏ> USER=<bỏ> PATH=<bỏ> PWD=<bỏ> SHLVL=<bỏ> HOME=<bỏ> LOGNAME=<bỏ> SSH_CONNECTION=<bỏ> _=<bỏ>
```

Ca nên có thêm: `codex --search exec …` (vẫn là run), `codex app-server` có runId (không phải run in), `codex exec`
không có runId trong env (không bắt), và dòng `sandbox-exec` con không đọc được env.

## Giá trị điền vào plan

- I8 `loggedIn`: `codex login status` mã thoát 0 + câu `Logged in using ChatGPT` (stderr).
- I8 quota Codex: `payload.rate_limits.primary.{used_percent,window_minutes,resets_at}` của `event_msg`/`token_count`
  mới nhất; quét cả `~/.crew/runtimes/codex/*/sessions`.
- I1: `gpt-6-luna` chạy được với tài khoản ChatGPT (gói `prolite`). `gpt-6-sol` chưa đo.
- MR-1: tạo `{}` 0600 trong asset `home` và **giữ lại**; agent codex cần `env.CODEX_HOME` ngoài cây managed trên VPS.
- MR-3: luật khớp `exec` như trên + fixture.

## Dọn

`~/crew-r24-probe` (CODEX_HOME tạm có symlink, repo git tạm, test tạm, script) chuyển vào Thùng rác bằng `trash`.
Không còn process nền (`codex app-server` và `node` thử đã thoát theo `sleep`).
