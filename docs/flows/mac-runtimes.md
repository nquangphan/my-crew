# Runtime Codex và OpenCode Go trên Mac (wrapper, key Keychain, crew-mac runtimes)

> Flow `mac-runtimes`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-runtimes` in ra đúng danh sách đó.

## Mục đích

Ngoài `claude_local`, Mac chạy được agent `codex_local` (executor và reviewer Codex) và `opencode_local` (executor
OpenCode Go). Mỗi runtime có một wrapper đặt vào `adapterConfig.command` của agent, giống `crew-claude-run`:

- giữ credential trên Mac: không có `auth.json` hay key nào đi lên server;
- tách trạng thái từng agent (session Codex, dữ liệu OpenCode) dưới `~/.crew/runtimes`;
- ghi nhóm process của run cho hook H3 và bộ dọn (flow `mac-orphan-reaper`);
- chặn run khi thiếu đăng nhập, thiếu key hoặc `workflow-check` từ chối (thoát 78).

Lệnh `crew-mac runtimes` cho owner nạp key OpenCode Go vào Keychain và cho app 2P Crew đọc trạng thái runtime
(việc máy `runtimes-setup`).

## Điểm vào

- `~/.crew/bin/crew-codex-run`, `~/.crew/bin/crew-opencode-run`: Paperclip chạy qua sshd agent với env của run
  (`PAPERCLIP_RUN_ID`, `PAPERCLIP_AGENT_ID`, `CODEX_HOME`/`XDG_CONFIG_HOME` do adapter đưa vào).
- `crew-mac runtimes key opencode`: owner chạy trong Terminal trên màn hình Mac.
- `crew-mac runtimes status [--json]`, `runtimes skills-checksum`, `runtimes key-fingerprint opencode`.
- `crew-mac setup` cài các wrapper (flow `mac-setup`); `crew-mac doctor` có bốn mục runtime.

## Các bước

1. `apps/crew-mac/assets/crew-run-mark.sh` (hai wrapper nạp bằng `.` theo đường dẫn tính từ `$0`):
   - `crew_runtime_slot <runtime>`: trong run, `PAPERCLIP_AGENT_ID` phải là UUID, rồi gọi
     `crew-mac workflow-check --runtime <runtime> --root "$PWD"`; ngoài run (adapter gọi `--version`) đặt ô `shared`;
   - `crew_run_mark`: chép nguyên khối ghi `pgid`/`started` của `crew-claude-run.sh`;
   - `crew_superpowers_dir`: export `CREW_SUPERPOWERS_DIR` từ `~/.crew/runtimes/superpowers-dir`.
2. `apps/crew-mac/assets/crew-codex-run.sh`:
   - thiếu `~/.codex/auth.json` thì chặn;
   - `CODEX_HOME` mới `~/.crew/runtimes/codex/<agentId>/` (0700): chép `config.toml` của asset (0600), `skills` là
     symlink tới asset, `auth.json` là symlink tới `~/.codex/auth.json`, `sessions/` giữ qua các run;
   - asset gốc (`$CODEX_HOME` adapter đưa vào) không bị thêm file nào, nên copy-back lúc trả lease không có
     `auth.json` để gửi lên server;
   - executor và reviewer Codex dùng cùng wrapper, khác thư mục vì khác `agentId`.
3. `apps/crew-mac/assets/crew-opencode-run.sh`:
   - đọc key bằng `${CREW_SECURITY_BIN:-/usr/bin/security} find-generic-password -s crew.opencode-go -a crew -w`
     vào biến shell, lỗi của security bị bỏ;
   - export `CREW_OPENCODE_GO_KEY` và `OPENCODE_API_KEY` (provider `opencode-go` tự đọc biến này) cho process
     opencode, rồi `unset` biến tạm;
   - `OPENCODE_CONFIG_CONTENT` =
     `{"provider":{"opencode-go":{"options":{"apiKey":"{env:CREW_OPENCODE_GO_KEY}"}}},"permission":{"edit":"allow","bash":"allow","external_directory":"allow"}}`;
   - `XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME` = `~/.crew/runtimes/opencode/<agentId>/{data,state,cache}`;
     `XDG_CONFIG_HOME` giữ giá trị adapter đưa vào, không có thì `…/config`;
   - lệnh `run` thêm `--print-logs` (nếu chưa có): OpenCode tự retry 429 tối đa 5 lần im lặng theo `retry-after`,
     cờ này đưa dòng `ERROR` ("Go usage limit exceeded", "API key is missing") ra stderr ngay.
4. `apps/crew-mac/src/runtimes/keychain.ts`: `keychainKeyState` (không `-w`: 0 có, 44 không, mã khác `null`),
   `keychainHasKey`, `keychainKeyFingerprint` (12 hex đầu sha256 của key, key chỉ nằm trong bộ nhớ process),
   `SAVE_KEY_ARGS`.
5. `apps/crew-mac/src/runtimes/command.ts` → `runtimesCommand`:
   - `key opencode`: cần TTY (không thì thoát 2 `runtimes: cần chạy trong Terminal của owner`), chạy
     `security add-generic-password -U -s crew.opencode-go -a crew -w` với `stdio: 'inherit'`; `-w` đứng cuối không
     giá trị nên security tự hỏi key (gõ ẩn, hai lần). Key không đi qua argv hay qua crew-mac. Mã 0 in `đã lưu …`;
   - `key-fingerprint opencode`: in 12 hex, chưa có key thì thoát 1 kèm gợi ý;
   - `status`: ba dòng `claude_local: <bản> · đăng nhập <có|không>`, `codex_local: …`,
     `opencode_local: <bản> · key <có|không>` (chưa cài thì `chưa cài`, không xác định thì `không rõ`);
   - `status --json`: đúng hợp đồng việc máy `runtimes-setup` (`RuntimesStatus`):
     `{ wrappers: { codex, opencode }, codex: { version, loggedIn }, opencode: { version, keyPresent } }`;
     không có key, token hay đường `auth.json`;
   - `skills-checksum`: sha256 của cây `~/.claude/skills` (`skillsChecksum`; symlink tính theo đích của link, không
     theo link, vì skill của owner hay là symlink), thiếu thư mục thì `không có`. Dùng để so trước/sau một run.
   - Lệnh CLI của agent (`claude`, `codex`, `opencode`) chạy qua `/bin/zsh -c` (`AGENT_SHELL`): zsh đọc `~/.zshenv`
     nên thấy cùng PATH với sshd agent, kể cả khi app gọi crew-mac với PATH launchd tối thiểu. Mỗi lệnh quá hạn 15 giây.
6. `apps/crew-mac/src/runtimes/paths.ts` → `runtimePaths(home)`: đường wrapper, `crew-run-mark.sh`, `~/.crew/runtimes`,
   `superpowers-dir`, `opencode-in-place`, `~/.claude/skills`.
7. Doctor (flow `mac-setup`, `doctor.ts`): bốn mục chỉ `warn`, không bao giờ `fail` (check job của app chỉ thất bại
   theo mục bắt buộc của Claude):
   - `codex-auth`: `codex login status` qua sshd agent, chỉ dùng mã thoát (câu trạng thái ra stderr, không in);
   - `wrapper-codex`, `wrapper-opencode`: file có, có bit x, `crew-<cli>-run --version` qua sshd agent chạy được,
     giống bản trong repo; `wrapper-opencode` còn đòi `~/.crew/runtimes/opencode-in-place` (bước deploy ghi khi server
     đã có vá chạy OpenCode đúng worktree);
   - `opencode-key`: `keychainKeyState`, không đọc key.

   CLI chưa cài trong PATH của sshd agent thì `warn` "chưa cài" (máy không dùng runtime đó).

## Mã thoát 78 của wrapper

| Dòng stderr | Khi nào |
|---|---|
| `crew-runtime blocked: thiếu PAPERCLIP_AGENT_ID (cần UUID của agent)` | Trong run mà `PAPERCLIP_AGENT_ID` không phải UUID |
| `crew-workflow blocked: crew-mac workflow-check từ chối run này (xem các dòng trên)` | `workflow-check --runtime` từ chối |
| `crew-runtime blocked: Codex chưa đăng nhập trên máy (chạy "codex login" trong phiên desktop)` | Thiếu `~/.codex/auth.json` |
| `crew-runtime blocked: thiếu key OpenCode Go trong Keychain (service crew.opencode-go); owner chạy "crew-mac runtimes key opencode" trong Terminal của Mac` | Keychain không trả key |

Không dòng nào in giá trị env. Không tạo được thư mục trạng thái cũng thoát 78.

## Dữ liệu

- Keychain: service `crew.opencode-go`, account `crew` (login Keychain của owner). Owner nạp bằng
  `crew-mac runtimes key opencode` hoặc `security add-generic-password -U -s crew.opencode-go -a crew -w`.
- `~/.crew/bin/crew-codex-run`, `crew-opencode-run` (0755), `crew-run-mark.sh` (0644): `setup` chép từ `assets/`.
- `~/.crew/runtimes/` (0700): `superpowers-dir` (0600, `setup` ghi), `opencode-in-place` (deploy ghi),
  `codex/<agentId|shared>/` (CODEX_HOME), `opencode/<agentId|shared>/{data,state,cache,config}`.
- Biến chỉ cho test: `CREW_CODEX_BIN`, `CREW_OPENCODE_BIN`, `CREW_SECURITY_BIN`, `CREW_MAC_BIN`.

## Ranh giới credential

- `~/.codex/auth.json` chỉ được symlink, không chép, không đọc nội dung; asset của adapter không bao giờ có
  `auth.json`.
- Key OpenCode Go chỉ có trong Keychain và trong env của process opencode. Không vào argv, file, stdout, stderr, bản
  tin máy hay kết quả việc máy. crew-mac chỉ đọc key để tính fingerprint.
- Không có đường nạp key từ web hay qua hàng đợi việc máy.

## Giả định cần kiểm khi có key OpenCode và trên Mac thật

- Biến key: `{env:CREW_OPENCODE_GO_KEY}` trong `OPENCODE_CONFIG_CONTENT` và `OPENCODE_API_KEY` (đọc mã OpenCode
  1.18.35); kiểm bằng một run thật.
- `permission.external_directory=allow` đủ cho `git commit` với gitdir ngoài worktree.
- `opencode run --print-logs` đưa dòng lỗi quota/auth ra stderr như đọc mã.
- `codex login status` thoát 0 khi đã đăng nhập, kể cả khi chạy qua sshd agent.
- Codex refresh token ghi qua symlink `auth.json` (nếu Codex thay file bằng rename thì bản mới nằm trong
  `~/.crew/runtimes/codex/<agentId>/auth.json` và lần chạy sau bị symlink đè; cần kiểm sau một lần refresh).

## Flow liên quan

- `mac-setup`: `setup` cài wrapper, `doctor` gọi các mục runtime, `cli.ts` chuyển `runtimes`.
- `mac-workflows`: `workflow-check --runtime` mà wrapper gọi trước mỗi run.
- `mac-orphan-reaper`: đọc `pgid`/`started` mà `crew_run_mark` ghi.

## Tests

- `apps/crew-mac/test/crew-codex-run.test.ts`: CODEX_HOME riêng theo agent (symlink `auth.json`/`skills`, chép
  `config.toml` 0600, thư mục 0700, `sessions/` giữ qua lần chạy sau), asset không thêm file, argv giữ nguyên,
  `workflow-check --runtime codex_local`, `CREW_SUPERPOWERS_DIR`, thiếu đăng nhập, agent id sai, workflow-check từ
  chối (đều 78, không chạy codex), ngoài run dùng `shared` và không ghi marker.
- `apps/crew-mac/test/crew-opencode-run.test.ts`: chuỗi mốc key chỉ có trong env của opencode (không argv, stdout,
  stderr, file dưới `~/.crew` hay worktree), security gọi đúng service/account, `OPENCODE_CONFIG_CONTENT`,
  `--print-logs` cho `run`, XDG riêng theo agent và giữ `XDG_CONFIG_HOME` của adapter, thiếu key thì 78 với câu cố
  định, agent id sai hay workflow-check từ chối thì không đọc Keychain.
- `apps/crew-mac/test/runtimes-keychain.test.ts`: kiểm có key không dùng `-w`, mã 44/lạ, fingerprint 12 hex, lỗi
  không kèm đầu ra security.
- `apps/crew-mac/test/runtimes-command.test.ts`: `key opencode` (argv kết thúc bằng `-w`, `stdio: 'inherit'`, không
  TTY thì 2), `key-fingerprint`, `status` (ba dòng, `--json` đúng hợp đồng, CLI chưa cài/chưa đăng nhập/không key,
  qua `/bin/zsh -c`), `skills-checksum` (thiếu thư mục, symlink, đổi khi cây đổi), nhánh CLI.
- `apps/crew-mac/test/setup.test.ts`, `apps/crew-mac/test/doctor.test.ts` (flow `mac-setup`): cài wrapper đúng mode;
  bốn mục doctor runtime (chưa cài, thiếu file/bit x, chặn 78, chưa đăng nhập, thiếu `opencode-in-place`, khác bản,
  Keychain lỗi) đều chỉ `warn`.
