# Crew Jev trên Mac (gate lệnh Bash, log, đồng bộ cấu hình với server)

> Flow `mac-jev`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-jev` in ra đúng danh sách đó.

## Mục đích

Mỗi lệnh `Bash` của agent `claude_local` trên Mac đi qua hook `PreToolUse` của Crew. Hook ghi một dòng log cho mọi
lệnh và đẩy log lên server Crew v3 (trang `/jev` của owner). Ở chế độ `shadow` hook chỉ ghi log và luôn cho chạy. Ở chế
độ `enforce` hook chặn (`deny`) khi có đủ hai điều kiện: lệnh thuộc một nhóm nguy hiểm (luật cục bộ, lấy từ mục "Không
bao giờ" của vai trò) và Jev (mô hình phán đoán của TypeSafe, gọi qua OpenRouter) trả `deny`. Mọi lỗi đều cho lệnh chạy
(fail-open): thiếu key, quá hạn, mạng hỏng, trả sai dạng, sự kiện hỏng hay exception. Hook không bao giờ thoát mã 2.

Chế độ, model, ngưỡng và timeout do owner đặt trên web. Mac kéo cấu hình về trong mỗi lượt `crew-mac status send`
(60 giây). Key OpenRouter chỉ nằm trong Keychain của Mac, không vào env, argv hay file.

## Điểm vào

- `~/.crew/jev/settings.json` do `crew-mac setup` ghi (flow `mac-setup`). Wrapper `crew-claude-run` thêm
  `--settings <file>` cho run Paperclip, nên Claude gọi `~/.crew/bin/crew-mac jev gate` (stdin là sự kiện hook, Claude
  giết hook sau 5 giây) trước mỗi lệnh Bash.
- `crew-mac jev gate-bg`: tiến trình nền do `jev gate` tách ra (stdin là sự kiện).
- `crew-mac jev status`: in cấu hình theo company, vân tay key trong Keychain và số dòng log chưa đẩy. Không in key.
- `crew-mac status send` (LaunchAgent 60 giây) gọi `pullJevConfig` rồi `pushJevEvents` cho từng đích đã nhận bản tin máy.
- `crew-mac doctor`: mục `jev`.

## Các bước

1. `apps/crew-mac/src/cli.ts` → `jevGateCommand`: xử lý `jev gate` và `gate-bg` trước mọi lệnh khác. Đọc stdin, dựng
   context, chọn company (`selectCompany`). Jev tắt hay chưa có cấu hình thì thoát 0 ngay, không nạp bundle. Còn lại thì
   nạp `dist/jev-gate.cjs` (bản build: esbuild gom cả `jev-use` từ `src/jev/gate-entry.ts`, nên bản cài không cần
   `node_modules`) và gọi `runGate`. Mọi lỗi đều thoát 0, chỉ in JSON khi gate quyết chặn. `gate-bg` đọc stdin dạng
   `{"v":1,"event":"<sự kiện hook nguyên văn>","env":{PAPERCLIP_COMPANY_ID,PAPERCLIP_RUN_ID,PAPERCLIP_AGENT_ID}}`
   (`decodeBackgroundInput`; sai dạng thì không làm gì) và xóa ô `~/.crew/jev/bg/<pid>` của nó khi xong.
2. `apps/crew-mac/src/jev/config.ts` → `readJevConfig`, `selectCompany`: đọc `~/.crew/jev/config.json` (mục company sai
   dạng thì bỏ). Company là `PAPERCLIP_COMPANY_ID` của run. Không có biến thì lấy company duy nhất. Biến không khớp, hoặc
   có nhiều company mà không có biến, thì không làm gì. `isJevActive`: company chỉ có hiệu lực khi `enabled` và
   `pulledAt` không cũ hơn 30 phút (`CONFIG_MAX_AGE_MS`). Cấu hình cũ hơn thì coi như tắt: không gọi Jev, không chặn,
   không ghi log (máy mất liên lạc có thể kéo dài nhiều ngày, ghi mỗi lệnh một dòng chỉ làm phình log; doctor đã cảnh
   báo từ 10 phút).
3. `apps/crew-mac/src/jev/gate.ts` → `runGate` (theo bảng fail-open bên dưới):
   - Sự kiện không phải `Bash`: không làm gì. JSON hỏng, hoặc `Bash` mà không có `command`: ghi `error/bad_event`.
   - `shadow`, tiến trình chính: tách nền ngay. Không phân nhóm, không chạy git, không đọc Keychain. Đo trên bản build:
     80–105 ms mỗi lệnh.
   - `spawnGateBackground` tách `node <cli.js> jev gate-bg` hoàn toàn khỏi run, để bộ kiểm mồ côi
     (`workflow-check --require-no-orphans`, reaper; flow `mac-orphan-reaper`) không coi nó là process của run khi hook
     đã thoát và nó thành con của launchd:
     - `detached` (nhóm process mới);
     - cwd `~/.crew/jev` (ngoài worktree);
     - env tối thiểu (`backgroundEnv`: `HOME`, `PATH`, `USER`, `LOGNAME`, `TMPDIR`, `LANG`, `LC_ALL`, biến chứng chỉ TLS),
       không có `PAPERCLIP_*`;
     - sự kiện và ba biến của run đi qua stdin (`encodeBackgroundInput`); chờ ghi xong stdin rồi `unref`.
     Reaper còn loại thêm theo argv (`isJevGateBackground`). Mỗi tiến trình nền có một ô `~/.crew/jev/bg/<pid>`. Đã có
     `MAX_BACKGROUND` (4) ô còn sống (`liveBackgroundSlots` xóa ô của pid đã chết hay cũ hơn 30 giây) thì không tách thêm
     mà ghi `error/skipped_bg`.
   - `enforce`: phân nhóm (`dangerCategory`). Lệnh có `git push` thật thì đọc thông tin git (`readGitFacts`) của đúng
     repo được push (`gitPushDir`: theo `cd <dir>` đứng trước và `git -C <dir>`).
     Không thuộc nhóm thì tách nền như `shadow`. Thuộc nhóm thì chặn đồng bộ: đọc key
     (`readJevKey`, `security find-generic-password -s crew.jev.<cid> -w`, hạn 1 giây), rồi gọi
     `Jev.gate(state, {tool: 'Bash', input: {command}}, {confidenceThreshold})` với
     `OpenRouterBackend({timeoutMs, maxRetries: 0})`, bọc thêm `Promise.race` theo `timeoutMs`. Tổng một lượt chặn không
     quá 3 giây (`HARD_DEADLINE_MS`).
   - `gate-bg`: luôn gọi Jev, ghi log, không bao giờ chặn.
   - Chỉ in `deny` khi `applied = deny`, với lý do
     `Crew Jev chặn: <nhóm> (độ tin <x>). Lệnh này nằm trong mục "Không bao giờ" của vai trò.`
   - `escalate` (Jev không chắc) thì cho chạy (không dùng `ask`, vì run nền không có người bấm).
   - `interpretGateResult`: jev-use trả lỗi backend thành `escalate/unreachable` kèm hint. Hint
     `request timed out` thành `timeout`. Hint "thiếu câu trả lời" hoặc body không phải JSON (`SyntaxError`) thành
     `bad_response`. Còn lại là `unreachable`.
4. `apps/crew-mac/src/jev/classify.ts` → `splitCommands`, `dangerCategory`:
   - Tách lệnh theo `;` `&&` `||` `|` `&`, xuống dòng, ngoặc, `$(` và backtick, giữ nguyên chuỗi trong nháy. Thân
     heredoc (`<<EOF` … `EOF`) bị bỏ vì là dữ liệu. `$` trong nháy đơn là chữ thường (`LITERAL_DOLLAR`).
   - Bỏ tiền tố (so theo basename, nên `/usr/bin/env`, `/usr/bin/sudo` cũng tính) cùng cờ và giá trị cờ của chúng:
     gán biến, `env`, `sudo` (`-u -g -h -p -C -U -D -r -t -T` nhận giá trị), `doas`, `nohup`, `time`, `command`, `exec`,
     `nice`, `ionice`, `caffeinate`, `stdbuf`, `timeout`/`gtimeout` (thêm thời lượng), `xargs`.
   - Bỏ từ khóa shell đứng đầu đoạn: `if then else elif while until do ! { }`.
   - Tách tiếp `bash|sh|zsh -c`, `eval` và `find -exec`.
   Kết quả là nhóm đầu tiên khớp:

   | `category` | Khớp |
   |---|---|
   | `rm_recursive` | `rm` có `-r`/`-R`/`--recursive` (kể cả `-rf`, `-fr`); `find … -delete`; `find -exec rm -r…`. Trừ khi mọi đối số của `rm` là `$D`/`${D}`/`$D/<đường không có ..>` với `D` được gán đúng một lần trong cùng lệnh bằng `$(mktemp -d …)` và không bị `read`/`for` gán lại (`mktempDirVars`) |
   | `no_verify` | `--no-verify` ở lệnh `git`; `git commit -n` (kể cả cụm như `-anm`, bỏ qua giá trị của `-m`); `git -c core.hooksPath=…` |
   | `force_push` | `git push` có `-f` (kể cả cụm `-uf`), `--force`, `--force-with-lease*`, `--force-if-includes`, `--mirror`, hoặc refspec bắt đầu bằng `+` |
   | `push_default` | origin ở GitHub và `git push` nhắm nhánh mặc định: đích của refspec (sau `:`, bỏ `refs/heads/`) là nhánh mặc định, hoặc `HEAD`/không refspec khi đang đứng ở nhánh mặc định. Repo thiếu `origin/HEAD` cục bộ thì coi `main` và `master` là nhánh mặc định |
   | `pr_merge` | `gh pr merge` (kể cả `gh -R o/r pr merge`, `gh pr --repo o/r merge`); đối số chứa `pulls/<n>/merge` hay `mergePullRequest` ở bất kỳ lệnh nào (`gh api`, `curl`, `wget`…) |
   | `credential` | `security find-generic-password`, `find-internet-password`, `dump-keychain`; đọc/chép `~/.ssh/id_*`, `*.pem`, `*.p12`, `.env*` (trừ `.env.example`, `.env.sample`), `~/.config/gh/hosts.yml`, `~/.claude/.credentials*`; glob trong `~/.ssh/` (`id*`, `*`) và `.env*`; cả thư mục `~/.ssh` làm đối số của `tar`/`zip`/`7z`/`cp`/`scp`/`rsync`/`ditto`; mọi lệnh chạm `~/.crew/jev/`; in toàn bộ env (`env`, `printenv`, `export`, `set` không đối số, `export -p`, `declare -x|-p`, `typeset -x`); `printenv <tên có KEY/TOKEN/SECRET/PASSWORD>`; `echo`/`printf` một biến tên có KEY/TOKEN/SECRET/PASSWORD (trong nháy đơn thì không tính) |

   Với `credential`: file đích của `cp`/`mv`/`scp`/`rsync` và của chuyển hướng ghi (`>`) không tính là đọc, nên
   `cp .env.example .env` không khớp. `ls`, `stat`, `chmod`, `ssh`, `ssh-add`, `ssh-keygen`, `touch`, `mkdir`, `rm` không
   tính là đọc file khóa. Không khớp: `curl -H "Authorization: Bearer $PAPERCLIP_API_KEY" …`,
   `git push origin crew/...`, `rm file.txt`.
   `readGitFacts` chạy song song ba lệnh `git -C <repo>` (`symbolic-ref` của `origin/HEAD` và `HEAD`,
   `remote get-url origin`), mỗi lệnh hạn 1 giây. Lỗi thành giá trị rỗng. `needsGitFacts`/`gitPushDir` dùng chính bộ
   tách lệnh, nên `echo "git push"` không kéo theo lệnh git nào.
5. `apps/crew-mac/src/jev/gate.ts` → `jevState`: state gửi Jev viết bằng tiếng Anh và cố định: cwd, TMPDIR của máy,
   nhánh mặc định, origin có phải GitHub không, và sáu luật viết thành câu. Luật 1 khớp vai trò executor: xóa thư mục
   tạm mà run đã tạo bằng `mktemp -d` (dưới TMPDIR hay `/tmp`), ở lệnh này hay lệnh trước, là dọn bắt buộc. Không gửi
   prompt, mô tả issue hay env. `jev-use` tự che credential trong lệnh trước khi gửi.
6. `apps/crew-mac/src/jev/log.ts` → `appendGateLog`, `formatGateLine`, `redactCommand`: một dòng JSONL v1, ghi bằng một
   lần append (0600, thư mục 0700) trong khóa ghi `gate.log.lock` (`acquireLock` bằng `mkdir`; chờ tối đa 300 ms rồi
   ghi luôn, khóa cũ hơn 5 giây bị gỡ). `command` được che mật khẩu dính cờ `-p` của client MySQL trước, rồi che bằng
   `redactSecrets` của jev-use, cắt 2000 ký tự. Lệnh còn bị cắt tiếp cho tới khi cả dòng dưới 4000 byte (atomic với
   `O_APPEND`). `cwd` cắt 500 ký tự.
7. `apps/crew-mac/src/jev/sync.ts` → `pullJevConfig`: đọc secret của đích (`readKeychainSecret`, giống bản tin máy), vân
   tay key hiện có trong Keychain (12 hex đầu sha256) và version đã áp. POST ký `signCrewBody` tới
   `<url>/api/crew/companies/<cid>/jev/machine/pull` với body
   `{version: 1, companyId, machineId, sentAt, appliedVersion, keyFingerprint}`. Response 2xx phải có
   `{version, enabled, gateMode, model, threshold, timeoutMs, hasKey}` (trường khác như `serverShadow`,
   `keyFingerprint` thì bỏ qua) và có thể có `apiKey`. Sai dạng (model không phải `typesafe/jev-…`, ngưỡng ngoài
   0,3–0,95, timeout ngoài 500–3000, key không phải một dòng 20–200 ký tự) thì `bad_response` và không ghi gì. Có
   `apiKey` thì ghi Keychain `crew.jev.<cid>` (`writeKeychainSecret`, qua stdin của `security -i`). `hasKey: false` mà
   máy còn key thì `security delete-generic-password`. Cuối cùng ghi mục company vào `config.json` (giữ company khác)
   kèm `keyFingerprint` và `pulledAt`.
   Pull nhận 403 (máy bị gỡ) hay 404 (server chưa có route Jev, hoặc đã rollback) thì `disableJevCompany`: đặt
   `enabled:false` và xóa key Keychain của company (đã tắt và không còn key thì lượt sau không gọi `security` nữa). Lỗi
   khác (401, 5xx, mạng) giữ nguyên cấu hình; trần 30 phút lo phần còn lại.
   Trong `status send` (flow `mac-setup`): bản tin máy của một đích trả 403 thì cũng `disableJevCompany` (khi đó không
   pull). Cuối lượt, `pruneJevCompanies` xóa mục `config.json` và key của company không còn là đích bản tin.
8. `apps/crew-mac/src/jev/sync.ts` → `pushJevEvents`: đọc `gate.log` từ con trỏ riêng của company trong `gate.cursor`
   (`{"v":1,"offsets":{"<cid>": <byte>}}`). Chỉ lấy dòng JSON hợp lệ có `companyId` của đích. Dòng chưa có xuống dòng
   để lượt sau. Mỗi lô ≤ 500 dòng và body ≤ 256 KiB:
   `{"version":1,"companyId","machineId","sentAt","events":[<dòng log nguyên văn>]}`, POST ký tới
   `/jev/machine/events`. Chỉ tiến con trỏ khi 2xx, tối đa 64 lô mỗi lượt. Đọc log theo cửa sổ 1 MiB (`logLines`),
   không nạp cả file. Cả lượt giữ khóa đồng bộ `gate.log.sync.lock`; lượt `status send` khác đang giữ thì bỏ qua. Trả
   thêm `rejected` (số dòng server báo đã loại) để `status send` in ra.
   Cuối lượt, và một lần nữa ở cuối `status send` (`maintainGateLog`, kể cả khi mọi đích lỗi), `compactGateLog` nén log
   trong khóa ghi. Chỉ tính con trỏ của các company có cấu hình Jev (không có cấu hình nào thì tính mọi đích):
   - file > 5 MiB và mọi con trỏ đã tới cuối: cắt về 0;
   - file > 20 MiB (`LOG_MAX_BYTES`, một đích lỗi lâu): giữ 10 MiB cuối (`LOG_KEEP_BYTES`), hoặc từ con trỏ chậm nhất
     nếu gần hơn, cắt ở đầu dòng. Company nào mất dòng chưa đẩy thì thêm một dòng `error/dropped` có
     `reason` = `dropped:<số dòng>`.
   Phần giữ lại được chép sang file mới rồi `rename` đè, con trỏ trừ đi phần đã bỏ.
9. `apps/crew-mac/src/commands/doctor.ts` → `checkJev` (flow `mac-setup`): không gọi mạng, không đọc key (chỉ
   `find-generic-password` không `-w`). Chưa có cấu hình hoặc Jev tắt thì `ok`. Jev bật mà thiếu key, Keychain lỗi,
   thiếu `jev-gate.cjs` cạnh `cli.js`, hoặc `pulledAt` cũ hơn 10 phút thì `warn`.

### Fail-open

| Tình huống | Hook làm gì | Log |
|---|---|---|
| Không có config, `enabled=false`, company không khớp, tool không phải Bash | thoát 0, không in gì | không |
| stdin hỏng, Bash thiếu `command` | thoát 0 | `error/bad_event` |
| Không đọc được key ở Keychain | thoát 0 | `error/no_key` |
| Jev quá `timeoutMs` (hoặc hết 3 giây của lượt chặn) | thoát 0 | `error/timeout` |
| Mạng, 4xx/5xx | thoát 0 | `error/unreachable` |
| Response thiếu câu trả lời | thoát 0 | `error/bad_response` |
| `escalate` | thoát 0 | `escalate` |
| Đã đủ 4 tiến trình nền đang chạy | thoát 0, không tách thêm | `error/skipped_bg` |
| Tách tiến trình nền lỗi, mọi exception khác | thoát 0 | `error/internal` |
| Claude giết hook sau 5 giây | Claude coi là lỗi không chặn | không có dòng |

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/crew-mac/src/jev/gate-entry.ts` | Entry esbuild → `dist/jev-gate.cjs` (gom jev-use) | `runGate` |
| `apps/crew-mac/src/jev/gate.ts` | Quyết định của hook, gọi Jev, tách tiến trình nền, state và câu chặn | `runGate`, `GateOptions`, `jevState`, `denyOutput`, `interpretGateResult`, `spawnGateBackground`, `BackgroundBusy`, `liveBackgroundSlots`, `MAX_BACKGROUND` |
| `apps/crew-mac/src/jev/classify.ts` | Tách lệnh shell và phân nhóm nguy hiểm, đọc thông tin git | `dangerCategory`, `splitCommands`, `stripHeredocs`, `mktempDirVars`, `gitPushDir`, `needsGitFacts`, `readGitFacts`, `defaultBranches`, `Category`, `GitFacts` |
| `apps/crew-mac/src/jev/config.ts` | `config.json` theo company, chọn company, Keychain `crew.jev.<cid>` | `readJevConfig`, `writeJevConfig`, `parseCompanyConfig`, `selectCompany`, `readJevKey`, `jevKeyPresent`, `deleteJevKey`, `keyFingerprint`, `jevKeychainService`, `encodeBackgroundInput`, `decodeBackgroundInput`, `backgroundEnv`, `acquireLock`, `releaseLock`, `isJevActive`, `CONFIG_MAX_AGE_MS` |
| `apps/crew-mac/src/jev/log.ts` | Dòng `gate.log` JSONL v1 | `appendGateLog`, `formatGateLine`, `redactCommand`, `GateLogEntry` |
| `apps/crew-mac/src/jev/sync.ts` | Kéo cấu hình, đẩy log, đếm dòng chưa đẩy | `pullJevConfig`, `pushJevEvents`, `compactGateLog`, `maintainGateLog`, `disableJevCompany`, `pruneJevCompanies`, `pendingJevEvents`, `JevSyncError` |

`gate.ts`, `log.ts` và `gate-entry.ts` import `jev-use` (devDependency ghim `0.8.0`). Chúng nằm ngoài `tsc` build
(`tsconfig.build.json`) và chỉ tới máy qua bundle `jev-gate.cjs` (`build-files.mjs`). `cli.ts`, `status.ts` và
`doctor.ts` chỉ import `config.ts` và `sync.ts`, không import jev-use.

## Dữ liệu

- File trên Mac (dưới `~/.crew/jev/`, thư mục 0700):
  - `settings.json` (0644, flow `mac-setup`);
  - `config.json` (0600): `{companies: {<cid>: {version, enabled, gateMode, model, threshold, timeoutMs, keyFingerprint, pulledAt}}}`, không có key;
  - `gate.log` (0600, JSONL v1, mẫu bên dưới);
  - `gate.cursor` (0600);
  - `bg/<pid>`: ô của mỗi `gate-bg` đang chạy;
  - khóa `gate.log.lock` (ghi và nén log), `gate.log.sync.lock` (một lượt đồng bộ).
- Keychain: `crew.jev.<companyId>` (account `crew-mac`) chứa key OpenRouter. Hook và tiến trình nền đọc trực tiếp.
  Key không bao giờ vào env của `claude`/agent, argv hay file.
- Dòng log:
  `{"v":1,"eventId":"<uuid>","ts":"…Z","companyId","runId|null","agentId|null","cwd","mode":"shadow|enforce","category|null","blocking","verdict":"allow|deny|escalate|error","applied":"allow|deny","confidence|null","reason|null","errorCode":"no_key|timeout|unreachable|bad_response|bad_event|internal|skipped_bg|dropped|null","latencyMs","model","command":"<đã che, ≤ 2000 ký tự>"}`.
  `runId`/`agentId` lấy từ `PAPERCLIP_RUN_ID`/`PAPERCLIP_AGENT_ID` (không phải UUID thì null; ở `gate-bg` lấy từ
  stdin). `latencyMs` tính từ lúc hook bắt đầu tới khi có verdict. Dòng `dropped` có `command` rỗng, `model` null và
  `reason` = `dropped:<số dòng>`.
- Gọi ngoài:
  - `https://openrouter.ai/api/alpha/decisions` (qua jev-use, Bearer key);
  - `<origin>/api/crew/companies/<cid>/jev/machine/pull` và `/jev/machine/events`, header `X-Crew-Timestamp`,
    `X-Crew-Signature: sha256=<hex HMAC(secret đích, ts + "." + body)>`, hạn 10 giây;
  - `/usr/bin/security`, `security -i`, `git -C <repo>`.
- Mã lỗi đồng bộ in trong `status.log`: `no_machine`, `keychain`, `network`, `http_<mã>`, `bad_response`,
  `keychain_write`, `local_io`.

## Flow liên quan

- `mac-setup`: `setup` ghi `settings.json`; wrapper thêm `--settings`; `status send` gọi đồng bộ; `doctor` có mục
  `jev`; `cli.ts` có ba lệnh `jev`; `paths.ts` có các đường dẫn `jev*`; `uninstall` xóa mục Keychain `crew.jev.*` và
  thư mục `~/.crew/jev/`.
- `mac-orphan-reaper`: tiến trình nền của gate sống tối đa khoảng 5 giây, ở nhóm process riêng, cwd `~/.crew/jev`, không
  có run id, nên reaper và `--require-no-orphans` không tính nó; `isJevGateBackground` loại thêm theo argv.

## Tests

- `apps/crew-mac/test/jev-classify.test.ts`:
  - mọi dòng của bảng nhóm, kể cả tiền tố (`sudo -u`, `/usr/bin/env`, `nice`, `timeout`, `caffeinate`, `command`,
    `exec`), từ khóa shell (`if/then`, `for/do`, `while`, `{ }`, `( )`, `!`), `gh -R/--repo`, merge qua `curl` và
    GraphQL, `printenv <secret>`, nén/chép `~/.ssh`, glob `~/.ssh/*` và `.env*`, `export -p`/`set`/`declare -x`;
    `rm -rf "$D"` khi `D` bị gán lại, không phải `mktemp -d`, có `..` hay kèm đường khác thì vẫn khớp;
  - các ca không được khớp: `rm -rf "$D"` với `D=$(mktemp -d)` trong cùng lệnh, `git push origin crew/req/…`, `curl`
    có Bearer `$PAPERCLIP_API_KEY`, `cp .env.example .env`, thân heredoc, `echo '$X_TOKEN'`, `set -euo pipefail`,
    `printenv HOME`, `nice -n 5 pnpm test`…;
  - `needsGitFacts` chỉ đúng với `git push` thật (không tính `echo "git push"`); `gitPushDir` theo `cd` và `git -C`;
    `readGitFacts` dùng `git -C` hạn 1 giây, git lỗi thì trả rỗng.
- `apps/crew-mac/test/jev-gate.test.ts` (backend giả):
  - không config, Jev tắt, tool khác Bash hay company không khớp thì không làm gì; không có biến company thì dùng
    company duy nhất; cấu hình cũ hơn 30 phút thì không tách nền, không gọi Jev, không log (đúng 30 phút vẫn hiệu lực);
  - `shadow` tách nền mà không gọi Jev hay Keychain; `gate-bg` ghi `deny` nhưng `applied` là `allow`;
  - `enforce` có nhóm và Jev `deny` thì in đúng JSON deny tiếng Việt; Jev `allow` hay `escalate` thì cho chạy;
  - `enforce` không có nhóm thì không chờ Jev; lệnh không có `git push` thì không chạy git; state chứa cwd, nhánh mặc
    định, câu `mktemp -d` và không chứa key;
  - fail-open: timeout (cả race lẫn backend tự báo), unreachable, no_key, bad_event, tách nền lỗi là internal, config
    hỏng; body không phải JSON là `bad_response`; đủ tiến trình nền thì `skipped_bg`;
  - state có TMPDIR và luật thư mục tạm của run ở lệnh này hay lệnh trước; thiếu `origin/HEAD` thì ghi main/master;
  - dòng log che key và mật khẩu `mysql -p…`, cắt 2000 ký tự, dưới 4 KiB; người ghi đợi khóa nén log rồi vẫn ghi;
  - đếm ô tiến trình nền (pid chết thì xóa ô);
  - spawn thật (macOS): hook tách `gate-bg` có cwd `~/.crew/jev`, env không có `PAPERCLIP_*`, nhóm process riêng, có
    ô đếm, dữ liệu run qua stdin; `orphanCheck` thật của run ngay sau đó trả ok. Đủ 4 tiến trình nền thật đang sống thì
    không tách thêm.
- `apps/crew-mac/test/jev-sync.test.ts` (fetch và Keychain giả):
  - pull: chữ ký đúng HMAC, body đúng; chỉ ghi Keychain khi có `apiKey`, qua stdin; config 0600 không có key; lần sau
    gửi vân tay và version; `hasKey:false` thì xóa key; không 2xx hay sai dạng thì không ghi gì; lỗi mạng, Keychain;
    giữ company khác; 403/404 thì tắt company và xóa key (lượt sau không gọi `security` thêm), 401/500 thì giữ nguyên;
    `pruneJevCompanies` chỉ dọn company không còn là đích;
  - push: chỉ dòng của company đích; con trỏ chỉ tiến khi 2xx; lô 500/500/200; lô theo 256 KiB; dòng ghi dở để lượt
    sau; > 5 MiB thì cắt về 0 (chỉ chờ company có cấu hình Jev); > 20 MiB vì một đích lỗi lâu thì giữ 10 MiB cuối, toàn
    dòng nguyên vẹn, kèm dòng `dropped` đúng số dòng bị bỏ (`mode` theo cấu hình của company); khóa đồng bộ đang bị giữ thì bỏ qua; trả `rejected` của
    server; không có log thì không gửi.
- Test của `cli.ts`, `setup.ts`, `status.ts`, `doctor.ts` và wrapper liên quan tới Jev nằm ở flow `mac-setup`.
