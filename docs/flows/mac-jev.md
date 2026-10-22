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
   `node_modules`) và gọi `runGate`. Mọi lỗi đều thoát 0, chỉ in JSON khi gate quyết chặn.
2. `apps/crew-mac/src/jev/config.ts` → `readJevConfig`, `selectCompany`: đọc `~/.crew/jev/config.json` (mục company sai
   dạng thì bỏ). Company là `PAPERCLIP_COMPANY_ID` của run. Không có biến thì lấy company duy nhất. Biến không khớp, hoặc
   có nhiều company mà không có biến, thì không làm gì.
3. `apps/crew-mac/src/jev/gate.ts` → `runGate` (theo bảng fail-open bên dưới):
   - Sự kiện không phải `Bash`: không làm gì. JSON hỏng, hoặc `Bash` mà không có `command`: ghi `error/bad_event`.
   - `shadow`, tiến trình chính: tách nền ngay (`spawnGateBackground`: `node <cli.js> jev gate-bg`, `detached` nên nằm
     ngoài nhóm process của run, chờ ghi xong stdin rồi `unref`). Không phân nhóm, không chạy git, không đọc Keychain.
     Đo trên bản build: khoảng 85 ms mỗi lệnh.
   - `enforce`: phân nhóm (`dangerCategory`). Lệnh có `git push` thì đọc thêm thông tin git của worktree (`readGitFacts`).
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
     `request timed out` thành `timeout`. Hint "thiếu câu trả lời" thành `bad_response`. Còn lại là `unreachable`.
4. `apps/crew-mac/src/jev/classify.ts` → `splitCommands`, `dangerCategory`: tách lệnh theo `;` `&&` `||` `|` `&`, xuống
   dòng, ngoặc, `$(` và backtick (giữ nguyên chuỗi trong nháy). Bỏ tiền tố `sudo`, `env X=`, gán biến, `nohup`, `time`,
   `command`, `exec`, `xargs`. Tách tiếp `bash|sh|zsh -c`, `eval` và `find -exec`. Kết quả là nhóm đầu tiên khớp:

   | `category` | Khớp |
   |---|---|
   | `rm_recursive` | `rm` có `-r`/`-R`/`--recursive` (kể cả `-rf`, `-fr`); `find … -delete`; `find -exec rm -r…` |
   | `no_verify` | `--no-verify` ở lệnh `git`; `git commit -n` (kể cả cụm như `-anm`, bỏ qua giá trị của `-m`); `git -c core.hooksPath=…` |
   | `force_push` | `git push` có `-f` (kể cả cụm `-uf`), `--force`, `--force-with-lease*`, `--force-if-includes`, `--mirror`, hoặc refspec bắt đầu bằng `+` |
   | `push_default` | origin ở GitHub và `git push` nhắm nhánh mặc định: đích của refspec (sau `:`, bỏ `refs/heads/`) là nhánh mặc định, hoặc `HEAD`/không refspec khi đang đứng ở nhánh mặc định |
   | `pr_merge` | `gh pr merge`; `gh api …/pulls/<n>/merge` |
   | `credential` | `security find-generic-password`, `find-internet-password`, `dump-keychain`; đọc/chép `~/.ssh/id_*`, `*.pem`, `*.p12`, `.env*` (trừ `.env.example`, `.env.sample`), `~/.config/gh/hosts.yml`, `~/.claude/.credentials*`; mọi lệnh chạm `~/.crew/jev/`; `printenv`/`env` không đối số; `echo`/`printf` một biến tên có KEY/TOKEN/SECRET/PASSWORD |

   Với `credential`: file đích của `cp`/`mv`/`scp`/`rsync` và của chuyển hướng ghi (`>`) không tính là đọc, nên
   `cp .env.example .env` không khớp. `ls`, `stat`, `chmod`, `ssh`, `ssh-add`, `ssh-keygen`, `touch`, `mkdir`, `rm` không
   tính là đọc file khóa. Không khớp: `curl -H "Authorization: Bearer $PAPERCLIP_API_KEY" …`,
   `git push origin crew/...`, `rm file.txt`.
   `readGitFacts` chạy song song ba lệnh `git -C <cwd>` (`symbolic-ref` của `origin/HEAD` và `HEAD`,
   `remote get-url origin`), mỗi lệnh hạn 1 giây. Lỗi thành giá trị rỗng, nên `push_default` không khớp.
5. `apps/crew-mac/src/jev/gate.ts` → `jevState`: state gửi Jev viết bằng tiếng Anh và cố định: cwd, nhánh mặc định,
   origin có phải GitHub không, và sáu luật viết thành câu. Câu luật nói rõ xóa thư mục `mktemp -d` của chính lệnh là
   dọn bắt buộc. Không gửi prompt, mô tả issue hay env. `jev-use` tự che credential trong lệnh trước khi gửi.
6. `apps/crew-mac/src/jev/log.ts` → `appendGateLog`, `formatGateLine`: một dòng JSONL v1, ghi bằng một lần append
   (0600, thư mục 0700). `command` che bằng `redactSecrets` của jev-use và cắt 2000 ký tự. Lệnh còn bị cắt tiếp cho tới
   khi cả dòng dưới 4000 byte (atomic với `O_APPEND`). `cwd` cắt 500 ký tự.
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
8. `apps/crew-mac/src/jev/sync.ts` → `pushJevEvents`: đọc `gate.log` từ con trỏ riêng của company trong `gate.cursor`
   (`{"v":1,"offsets":{"<cid>": <byte>}}`). Chỉ lấy dòng JSON hợp lệ có `companyId` của đích. Dòng chưa có xuống dòng
   để lượt sau. Mỗi lô ≤ 500 dòng và body ≤ 256 KiB:
   `{"version":1,"companyId","machineId","sentAt","events":[<dòng log nguyên văn>]}`, POST ký tới
   `/jev/machine/events`. Chỉ tiến con trỏ khi 2xx, tối đa 64 lô mỗi lượt. Khi đã đẩy hết, file > 5 MiB và con trỏ của
   mọi đích đã tới cuối file thì cắt file về 0 và xóa con trỏ.
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
| Tách tiến trình nền lỗi, mọi exception khác | thoát 0 | `error/internal` |
| Claude giết hook sau 5 giây | Claude coi là lỗi không chặn | không có dòng |

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/crew-mac/src/jev/gate-entry.ts` | Entry esbuild → `dist/jev-gate.cjs` (gom jev-use) | `runGate` |
| `apps/crew-mac/src/jev/gate.ts` | Quyết định của hook, gọi Jev, tách tiến trình nền, state và câu chặn | `runGate`, `GateOptions`, `jevState`, `denyOutput`, `interpretGateResult`, `spawnGateBackground` |
| `apps/crew-mac/src/jev/classify.ts` | Tách lệnh shell và phân nhóm nguy hiểm, đọc thông tin git | `dangerCategory`, `splitCommands`, `needsGitFacts`, `readGitFacts`, `Category`, `GitFacts` |
| `apps/crew-mac/src/jev/config.ts` | `config.json` theo company, chọn company, Keychain `crew.jev.<cid>` | `readJevConfig`, `writeJevConfig`, `parseCompanyConfig`, `selectCompany`, `readJevKey`, `jevKeyPresent`, `deleteJevKey`, `keyFingerprint`, `jevKeychainService` |
| `apps/crew-mac/src/jev/log.ts` | Dòng `gate.log` JSONL v1 | `appendGateLog`, `formatGateLine`, `redactCommand`, `GateLogEntry` |
| `apps/crew-mac/src/jev/sync.ts` | Kéo cấu hình, đẩy log, đếm dòng chưa đẩy | `pullJevConfig`, `pushJevEvents`, `pendingJevEvents`, `JevSyncError` |

`gate.ts`, `log.ts` và `gate-entry.ts` import `jev-use` (devDependency ghim `0.8.0`). Chúng nằm ngoài `tsc` build
(`tsconfig.build.json`) và chỉ tới máy qua bundle `jev-gate.cjs` (`build-files.mjs`). `cli.ts`, `status.ts` và
`doctor.ts` chỉ import `config.ts` và `sync.ts`, không import jev-use.

## Dữ liệu

- File trên Mac (dưới `~/.crew/jev/`, thư mục 0700):
  - `settings.json` (0644, flow `mac-setup`);
  - `config.json` (0600): `{companies: {<cid>: {version, enabled, gateMode, model, threshold, timeoutMs, keyFingerprint, pulledAt}}}`, không có key;
  - `gate.log` (0600, JSONL v1, mẫu bên dưới);
  - `gate.cursor` (0600).
- Keychain: `crew.jev.<companyId>` (account `crew-mac`) chứa key OpenRouter. Hook và tiến trình nền đọc trực tiếp.
  Key không bao giờ vào env của `claude`/agent, argv hay file.
- Dòng log:
  `{"v":1,"eventId":"<uuid>","ts":"…Z","companyId","runId|null","agentId|null","cwd","mode":"shadow|enforce","category|null","blocking","verdict":"allow|deny|escalate|error","applied":"allow|deny","confidence|null","reason|null","errorCode":"no_key|timeout|unreachable|bad_response|bad_event|internal|null","latencyMs","model","command":"<đã che, ≤ 2000 ký tự>"}`.
  `runId`/`agentId` lấy từ `PAPERCLIP_RUN_ID`/`PAPERCLIP_AGENT_ID` (không phải UUID thì null). `latencyMs` tính từ lúc
  hook bắt đầu tới khi có verdict.
- Gọi ngoài:
  - `https://openrouter.ai/api/alpha/decisions` (qua jev-use, Bearer key);
  - `<origin>/api/crew/companies/<cid>/jev/machine/pull` và `/jev/machine/events`, header `X-Crew-Timestamp`,
    `X-Crew-Signature: sha256=<hex HMAC(secret đích, ts + "." + body)>`, hạn 10 giây;
  - `/usr/bin/security`, `security -i`, `git -C <cwd>`.
- Mã lỗi đồng bộ in trong `status.log`: `no_machine`, `keychain`, `network`, `http_<mã>`, `bad_response`,
  `keychain_write`, `local_io`.

## Flow liên quan

- `mac-setup`: `setup` ghi `settings.json`; wrapper thêm `--settings`; `status send` gọi đồng bộ; `doctor` có mục
  `jev`; `cli.ts` có ba lệnh `jev`; `paths.ts` có các đường dẫn `jev*`.
- `mac-orphan-reaper`: tiến trình nền của gate sống ≤ 3 giây, ở nhóm process riêng, nên reaper và
  `--require-no-orphans` không tính nó.

## Tests

- `apps/crew-mac/test/jev-classify.test.ts`: mọi dòng của bảng nhóm, cộng các ca không được khớp (`curl` có Bearer
  `$PAPERCLIP_API_KEY`, `git push origin crew/req/TPS-1`, `rm file.txt`, `cp .env.example .env`, `-m` chứa `-n`,
  `echo "rm -rf /"`, `printenv PATH`…). `needsGitFacts` chỉ đúng với `git push`. `readGitFacts` dùng `git -C` hạn 1
  giây, git lỗi thì trả rỗng.
- `apps/crew-mac/test/jev-gate.test.ts` (backend giả):
  - không config, Jev tắt, tool khác Bash hay company không khớp thì không làm gì; không có biến company thì dùng
    company duy nhất;
  - `shadow` tách nền mà không gọi Jev hay Keychain; `gate-bg` ghi `deny` nhưng `applied` là `allow`;
  - `enforce` có nhóm và Jev `deny` thì in đúng JSON deny tiếng Việt; Jev `allow` hay `escalate` thì cho chạy;
  - `enforce` không có nhóm thì không chờ Jev; lệnh không có `git push` thì không chạy git; state chứa cwd, nhánh mặc
    định, câu `mktemp -d` và không chứa key;
  - fail-open: timeout (cả race lẫn backend tự báo), unreachable, no_key, bad_event, tách nền lỗi là internal, config
    hỏng;
  - dòng log che key, cắt 2000 ký tự, dưới 4 KiB.
- `apps/crew-mac/test/jev-sync.test.ts` (fetch và Keychain giả):
  - pull: chữ ký đúng HMAC, body đúng; chỉ ghi Keychain khi có `apiKey`, qua stdin; config 0600 không có key; lần sau
    gửi vân tay và version; `hasKey:false` thì xóa key; không 2xx hay sai dạng thì không ghi gì; lỗi mạng, Keychain;
    giữ company khác;
  - push: chỉ dòng của company đích; con trỏ chỉ tiến khi 2xx; lô 500/500/200; lô theo 256 KiB; dòng ghi dở để lượt
    sau; > 5 MiB thì cắt về 0; không có log thì không gửi.
- Test của `cli.ts`, `setup.ts`, `status.ts`, `doctor.ts` và wrapper liên quan tới Jev nằm ở flow `mac-setup`.
