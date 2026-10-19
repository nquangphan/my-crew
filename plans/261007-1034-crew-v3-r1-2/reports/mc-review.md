# Review gói `mac-cli`: MC-1 (`811e0c9`), MC-2 (`bf5114a`)

- Ngày: 2026-10-07 (Asia/Ho_Chi_Minh). Nhánh `r1-2/crew-mac`, worktree `.worktrees/crew-r12-mac`, HEAD = `bf5114a`, cây sạch.
- Phạm vi: `git diff v3..bf5114a` (8 file, +262/−29): `uninstall.ts`, `cli.ts`, `doctor.ts`, test `uninstall`/`cli`/`doctor`, `fake-mac.ts`, `docs/flows/mac-setup.md`.
- Đã chạy lại (log trong report không cho biết chạy ở SHA nào sau MC-2):
  - `pnpm --filter @crew/mac exec vitest run test/uninstall.test.ts test/cli.test.ts test/doctor.test.ts` cho 3 file, **42 passed** (39 của MC-1 + 3 test crew-docs của MC-2, khớp report).
  - `node "$(git config --get crew-docs.bundle)" check --range v3..bf5114a` in `ok (2 commits)`, exit 0.
- Kiểm thực tế, chỉ đọc: `ps -E -axww` trên máy này. Mọi process `claude`/`node` thật đều có env đọc được (30/30; 3 dòng thiếu env là `/bin/zsh` có chữ claude trong argv). Process `/bin`, `/usr` (binary Apple) thì chỉ 5/152 đọc được env. Bẫy đã biết là có thật, nhưng hiện nó chỉ dính vào binary Apple.
- Bước RED: implementer không chạy. Em xét theo logic: các test cốt lõi đều sẽ FAIL trên code `v3` (từ chối khi còn run, từ chối khi không đọc được `ps`, Orca chỉ `warn`, import `isAgentTccSubject`, mọi test `crew-docs`). Hai test `--force thì gỡ` và `claude -p thủ công` vẫn pass trên code cũ, nên chỉ có giá trị hồi quy. Chấp nhận được.

## Verdict

| Ticket | Verdict | Lý do chính |
|---|---|---|
| MC-1 | **CHANGES_REQUESTED** | Finding 1: kiểm "còn run" mở cửa khi không đọc được env, trên một lệnh phá hủy |
| MC-2 | **CHANGES_REQUESTED** | Finding 2: check chạy trong ngữ cảnh của doctor chứ không phải của agent, nên `ok` giả khi repo/bundle nằm dưới `~/Documents` (đúng như checkout hiện tại) |

## Findings

### 1. [major] MC-1: `liveRunIds` mở cửa khi env không đọc được. Dùng "đúng tiêu chí reaper" ở đây là đảo chiều an toàn
- `apps/crew-mac/src/commands/uninstall.ts:35-38`, dùng `isClaudePrint` (`src/reaper/run-members.ts:40-44`) và `extractRunId` (`src/reaper/process-table.ts:81-84`).
- Ở reaper, khi `ps -E` không trả env thì `runId = null`, nghĩa là **không giết**: lỗi an toàn. Ở uninstall, cùng tiêu chí đó lại cho ra **không có run → bootout sshd agent, xóa wrapper/launcher**. Run đang chạy mất phiên SSH giữa chừng.
- Các trường hợp bị lừa: (a) khoảng trước `exec` của wrapper: `sshd-session → zsh` nạp profile của owner `→ /bin/sh crew-claude-run`, toàn binary Apple nên `ps -E` không trả env; (b) claude cài bằng npm hoặc `CREW_CLAUDE_BIN` trỏ tới script, khi đó exe là `node …/cli.js` và `isClaudeExe` sai; (c) bất kỳ lúc nào `ps -E` trả dòng không kèm env (`withEnv === argvOnly`). Không test nào phủ ca "env không đọc được".
- Cách sửa (nhỏ, không đụng `process-table.ts`/`run-members.ts`): trong `liveRunIds`/`uninstall`, ngoài các run id tìm được, coi là "không chắc" và từ chối (trừ `--force`) khi:
  1. có process con cháu của sshd agent: `sshd-session` không tty, cha là PID của job `SSHD_LABEL` (lấy qua `launchctl print`, hoặc so `comm` + cổng manifest). Phiên qua sshd agent chính là hoạt động của Paperclip, và uninstall sẽ cắt nó. Tín hiệu này không phụ thuộc env; **hoặc**
  2. có `claude --print`/`-p` với `tty === '??'`, `runId === null` và dòng `-E` trùng nguyên argv (env không đọc được).
- Test cần thêm: `LIVE_PS` có dòng `env` giống hệt `argv` (không có env) với tty `??`, kỳ vọng `rejects.toThrow(/không chắc|không đọc được/)`. Claude thủ công có tty `ttys001` vẫn được cho qua.
- Ghi chú: rủi ro này plan đã chấp nhận ở mức "Thấp × Trung bình" (bảng rủi ro, mac-cli.md). Em vẫn xếp major vì đây là đúng cái bẫy mà lead yêu cầu kiểm, cách sửa rẻ, và lỗi rơi vào lệnh không hoàn tác được. Nếu lead giữ quyết định của plan thì hạ xuống minor và ghi lại vào ledger.

### 2. [major] MC-2: `checkCrewDocs` kiểm bằng process của doctor, không kiểm bằng agent: TCC và `node` lệch
- `apps/crew-mac/src/commands/doctor.ts:366-401` (`git -C` dòng 377, `existsSync(bundle)` dòng 384, `ctx.nodePath` dòng 389).
- Bằng chứng ngay trên máy này: `git config --get crew-docs.bundle` trả `/Users/phannhatquang/Documents/projects/crew/packages/docs-kit/<thư mục build>/crew-docs.cjs`. Worktree của agent tạo từ checkout này thì dùng chung git dir **và** bundle dưới `~/Documents`, một thư mục TCC bảo vệ. Doctor chạy trong Terminal (đã có quyền) báo `ok`. Integrator chạy qua sshd agent thì `git`/`node` của nó (process chịu trách nhiệm là `claude`) gặp hộp thoại Documents và **treo im lặng**. Đây là đúng lỗi mà check được viết ra để chặn trước D2/RO-1.
- Thêm nữa: hợp đồng ở `plan.md` là `node "$(git config …)"`, tức `node` theo PATH của phiên sshd agent, còn check dùng `ctx.nodePath` của crew-mac.
- Cách sửa (ưu tiên a):
  - (a) Chạy qua sshd agent như `checkWrapper` (`doctor.ts:233-236`): `ssh … 'cd <dir> && b=$(git config --get crew-docs.bundle) && test -f "$b" && node "$b" --version'`, có timeout. Có `timedOut` thì `fail` kèm hint trỏ sang `tcc-pending`.
  - (b) Tối thiểu: lấy `git -C <dir> rev-parse --git-common-dir` cùng đường dẫn bundle, rồi `fail` khi một trong hai nằm dưới `~/Documents`, `~/Desktop`, `~/Downloads` hay `/Volumes`. Hint: build/cài bundle ra ngoài vùng bảo vệ, clone repo cho agent ngoài `~/Documents`.
  - Ghi chú ngoài phạm vi: `forbiddenRootReason` (`src/paths.ts:87-102`) chặn Desktop/Downloads/Volumes nhưng **không chặn `~/Documents`**. Nên mở ticket riêng.

### 3. [minor] MC-1: một cờ `--force` hai nghĩa, nhưng thông báo lỗi không nói
- `apps/crew-mac/src/cli.ts:171`, `apps/crew-mac/src/commands/uninstall.ts:52,58`. Help (`cli.ts:21`) và docs đã nói rõ, nhưng hai thông báo lỗi đều chỉ bảo "thêm --force". Agent (hoặc owner qua SSH) làm theo thông báo chặn sshd sẽ bỏ luôn kiểm run, và ngược lại. Hậu quả: cắt chính phiên đang chạy giữa lúc uninstall dở dang và giết run.
- Gộp chung hai nghĩa vào một cờ là quyết định đã ghi (ruling ledger), không đảo. Sửa: mỗi thông báo ghi đủ hai hệ quả, ví dụ "`--force` bỏ qua CẢ kiểm phiên sshd agent LẪN kiểm run Paperclip".

### 4. [minor] MC-1: TOCTOU giữa lúc kiểm và lúc bootout
- `uninstall.ts:46-61`. Paperclip vẫn có thể dispatch run mới qua sshd agent ngay sau khi kiểm xong. Cửa sổ ngắn (vài giây), chấp nhận được. Chỉ đề nghị ghi một câu trong `mac-setup.md` ("nên tạm dừng agent trên Paperclip trước khi uninstall"). Không bắt sửa code.

### 5. [minor] MC-1: phân loại TCC chỉ dựa vào `subject`; thiếu test ca hỗn hợp
- `doctor.ts:357-360`. Cùng dòng log còn có `Resp:{TCCDProcess: identifier=com.anthropic.claude-code}` (xem `TCC_LOG`, `test/doctor.test.ts:24`), một tín hiệu bền hơn basename khi đường dẫn cài claude lạ (cask, tên khác). Có thể bắt thêm `identifier=com.anthropic.claude-code` trong `PROMPT_RE`. Không bắt buộc.
- Hiện đã đúng: `…/claude/versions/<bản>` là `fail`, `~/.local/bin/claude` là `fail`, `node` (Homebrew/Cellar/nvm/volta, nhờ so basename) là `fail`, `Claude.app`/`Orca.app` là `warn`, `<private>` là `warn` (unparsed).
- Thiếu test: có cả hộp thoại agent lẫn app khác thì phải `fail`, detail có `app khác:`, và hint chỉ có của agent (`doctor.ts:419-428`).

### 6. [minor] MC-2: chạy tuần tự, không dedupe, thông báo timeout mơ hồ
- `doctor.ts:376-390`. Mỗi worktree một lệnh `git` (timeout 10 giây) và một lệnh `node --version` (15 giây), chạy nối tiếp. Bình thường khoảng 0,1–0,3 giây mỗi worktree nên không chậm. Xấu nhất (TCC treo) là N × 25 giây và doctor như bị treo. Worktree cùng repo dùng chung bundle mà vẫn bị chạy `--version` N lần.
- Sửa: cache kết quả `--version` theo đường dẫn bundle (`Map<string, RunResult>`). Gặp `version.timedOut` thì ghi rõ "quá 15 giây (có thể do hộp thoại quyền)" thay vì `mã 137`. Có thể dừng sớm sau timeout đầu tiên của cùng một bundle.

### 7. [minor] MC-2: `readdirSync` ném lỗi làm sập cả doctor; symlink bị bỏ qua
- `doctor.ts:370-371`. `worktreeRoot` là file (`checkWorktreeRoot`, `doctor.ts:285-297`, vẫn báo `ok`) hoặc gặp `EACCES` thì `doctor()` ném lỗi, owner mất toàn bộ kết quả các check còn lại. Bọc `try` và trả `fail` kèm thông điệp. `Dirent.isDirectory()` trả false với symlink trỏ tới thư mục, nên worktree dạng symlink bị lặng lẽ bỏ qua. Dùng `statSync(path).isDirectory()`, hoặc ghi rõ giới hạn này trong docs.

## Docs (R3)

`docs/flows/mac-setup.md` khớp code: lệnh `uninstall [--force]`, bước 4 (từ chối khi còn run hoặc `ps` lỗi, `--force` bỏ cả hai kiểm), bước 3 (`checkCrewDocs`, quy tắc `tcc-pending`, đường dẫn tuyệt đối `sysctl`/`memory_pressure`), mục "Gọi ngoài" (`/usr/bin/git`, `/bin/ps`), bảng Files (`liveRunIds`, `checkCrewDocs`), mục Tests. `crew-docs check --range v3..bf5114a` đạt. Sửa finding 1, 2, 3 thì cập nhật bước 3/4 tương ứng. Thiếu một chi tiết nhỏ: chưa có thư mục worktree thì `crew-docs` báo `warn`.

## Kiểm đúng yêu cầu của lead

- Nhận diện run giống reaper (`PAPERCLIP_RUN_ID` lấy từ env, không từ argv; `claude --print`/`-p`): **đúng**. `claude -p` thủ công không có env run id thì không tính. Ca **không đọc được env** thì **bị lừa theo hướng mở cửa** (finding 1).
- `--force` bỏ cả kiểm phiên sshd: help/docs nói rõ, thông báo lỗi chưa nói (finding 3). Bản thân việc này không an toàn (có thể cắt chính phiên giữa chừng), là rủi ro owner chấp nhận có chủ ý.
- `tcc-pending`: phân loại claude/node đúng, kể cả bản `versions/<bản>` và `node` qua Homebrew/Cellar (finding 5 là phần nâng cấp thêm).
- `crew-docs` với nhiều worktree: không treo ở điều kiện bình thường, xấu nhất là N × 25 giây (finding 6). Lỗi lớn hơn là ngữ cảnh chạy (finding 2).

## Câu hỏi còn mở

1. Hook pre-commit trong worktree của executor chạy `crew-docs.runtime` (`ELECTRON_RUN_AS_NODE=1 <runtime>`, `packages/docs-kit/src/hook-installer.ts:37-41`), không phải `node`. Doctor không kiểm `crew-docs.runtime`. Nếu runtime là binary riêng của owner (Electron/app) thì commit của agent có thể fail hoặc treo vì TCC. MC-2 có nên kiểm luôn không?
2. Worktree của agent có luôn nằm ở cấp 1 dưới `worktreeRoot` không (`~/crew-agents/integrator`), hay Paperclip tạo workspace lồng sâu hơn? Hiện check chỉ quét cấp 1.
3. Lead có giữ mức rủi ro "Thấp" của plan cho finding 1 không? Nếu giữ thì MC-1 chuyển APPROVE và finding 1 thành minor.

## Re-review (`bf5114a..deb8503`, 2026-10-07)

- Phạm vi: chỉ commit `deb8503` (6 file, +465/−99) và mục "Sửa sau review" trong `mc-1-report.md`, `mc-2-report.md`.
- RED: log có 15 test fail trên code cũ. Danh sách test fail khớp với các test mới trong diff, nên RED lần này đáng tin.
- GREEN: em chạy lại `vitest run test/uninstall.test.ts test/cli.test.ts test/doctor.test.ts` ở `deb8503`, được **56 passed**, khớp report.
- Không chạy uninstall/setup thật, không sửa code.

### Verdict

| Ticket | Verdict |
|---|---|
| MC-1 | **APPROVE** (kèm minor R1, nên sửa trước AC-2) |
| MC-2 | **APPROVE** (kèm minor R2) |

### Finding 1 (major, MC-1): đã đóng
- Nhánh dựa trên sshd agent (`uninstall.ts` `scanUninstallBlockers`):
  - `serviceState` đọc `pid = …` từ `launchctl print gui/<uid>/<label>`. Job sshd chạy `/usr/sbin/sshd -D` (`setup.ts` `sshdPlistSpec`), nên pid này là sshd master, sống lâu dài.
  - Phiên vừa mở là `sshd-session` có ppid trỏ về master, nên `descendants` bắt được ngay khi phiên có trong snapshot `ps`. Tín hiệu này đi qua cây PPID, không cần env, nên bẫy `ps -E` với binary Apple không ảnh hưởng.
  - Phiên mở **sau** snapshot `ps` thì không thấy. Đây là khe TOCTOU đã ghi trong docs (minor 4 cũ), chấp nhận được.
  - Hai label `SSHD_LABEL` và `SPIKE_LABEL` đều được quét. Có test cho cả ca có phiên (từ chối, pid 4500) lẫn ca không có phiên (cho qua).
- Chặn nhầm vĩnh viễn qua nhánh sshd: **không**.
  - Terminal của owner (`Terminal → login → zsh`) và SSH hệ thống cổng 22 (`/usr/sbin/sshd` của launchd hệ thống) không phải con cháu job `gui/<uid>/com.2p…sshd`.
  - Process do agent bỏ lại thành mồ côi được chuyển về launchd (ppid 1), nên rời khỏi cây.
  - Chỉ có chặn tạm thời khi một `crew-mac doctor` đang SSH vào sshd agent cùng lúc. Chấp nhận được.
- Claude cài bằng npm (exe là `node`) đã được nhận. Có test.

### Finding 2 (major, MC-2): đã đóng
- `checkCrewDocs` chạy qua `sshArgs` (sshd agent, key doctor), dùng `node` theo PATH của agent và runtime của hook (`ELECTRON_RUN_AS_NODE=1`). Bundle, runtime hoặc git common dir nằm dưới `~/Documents`, `~/Desktop`, `~/Downloads`, `/Volumes` thì `fail` (`tccProtectedReason`). Nhờ kiểm tĩnh này, checkout hiện tại dưới `~/Documents` bị bắt ngay, kể cả khi lệnh qua SSH không treo.
- Thời gian tối đa của check:
  - đọc config quá hạn (30 giây) thì dừng ngay các worktree còn lại;
  - `--version` được cache theo cặp runtime/bundle, mỗi lệnh tối đa 20 giây.
  - Một repo bình thường (mọi worktree dùng chung bundle) xấu nhất khoảng **70 giây**: lần đầu hai lệnh `--version` treo (40 giây), worktree kế tiếp treo lúc đọc config (30 giây) rồi dừng. Bình thường chỉ khoảng 0,3 giây mỗi worktree. Chấp nhận được, xem R2.

### Minor cũ (3, 5, 6, 7): đã sửa đúng
- Minor 3: thông báo ở cả `cli.ts:171` và `FORCE_NOTE` ghi rõ "CẢ … LẪN …". Có test.
- Minor 4: docs đã ghi khe TOCTOU và khuyên tạm dừng agent trước khi uninstall.
- Minor 5: thêm `PendingPrompt.identifier`; `com.anthropic.claude-code` được coi là agent. Có test ca hỗn hợp và ca identifier. Regex `(?:.*?TCCDProcess: identifier=…)?` khớp đúng dòng log thật.
- Minor 6: có cache, có thông báo quá hạn và dừng sớm.
- Minor 7: lỗi `readdirSync` giờ ra `warn` thay vì làm sập doctor; dùng `statSync` nên worktree symlink được theo link. Có test.
- Docs `mac-setup.md` khớp code.

### Finding mới

**R1. [minor] MC-1: nhánh "không chắc" không kiểm env thật sự không đọc được, có thể chặn nhầm kéo dài và thông báo sai**
- Vị trí: `apps/crew-mac/src/commands/uninstall.ts`, `scanUninstallBlockers`, dòng `else if (p.tty === '??') unknownPids.push(p.pid)`.
- Code coi là "không chắc" **mọi** `claude`/`node` có `--print`/`-p`, không tty, không có run id, kể cả khi env đọc được bình thường. Thông báo lại nói "không đọc được env".
- Các ca chặn nhầm:
  - `claude -p` nền của owner (job launchd/cron, script, IDE);
  - `node -p "<expr>"`: `-p` ở đây là cờ eval của node, rất phổ biến trong script build, nên gây chặn nhầm thoáng qua;
  - có thể cả `crewd` v2 (Agent SDK) nếu SDK gọi claude với `--print`.
- Hệ quả: chặn suốt thời gian các process đó còn sống. Thông báo đẩy owner sang dùng `--force`, mà `--force` lại tắt luôn kiểm phiên sshd.
- Kiểm trên máy này: hiện có 0 process rơi vào nhánh này.
- Test `uninstall.test.ts` ("env không đọc được") đặt `env === argv`, nên không phân biệt được hai trường hợp.
- Cách sửa:
  1. Chỉ coi là "không chắc" khi dòng `ps -E` không dài hơn argv (env thật sự không đọc được). Cần thêm cờ `envReadable` vào `ProcInfo`, mà plan chỉ cho import `process-table.ts`, nên cần lead duyệt. Hoặc trong `uninstall.ts` gọi thêm `/bin/ps -E` một lần và so bằng `parsePsCommands` đã export.
  2. Với `node`, chỉ tính khi argv có script claude (`…/claude-code/cli.js` hoặc `…/claude`) đứng trước `-p`/`--print`.
  3. Thêm test: env đọc được nhưng không có run id, tty `??`, thì cho qua.

**R2. [minor] MC-2: `--version` quá hạn không dừng vòng lặp**
- Vị trí: `doctor.ts` `checkCrewDocs`, `versionProblem`.
- Chỉ timeout lúc đọc config mới đặt `hung` và `break`. Khi các worktree có bundle khác nhau, mỗi cặp vẫn tốn tới 2 × 20 giây, nên tổng không bị chặn trên theo N.
- Sửa: khi `r.timedOut` thì cũng đặt `hung = true` và `break` (hoặc giới hạn tổng thời gian cả check, ví dụ 60 giây).

**R3. [nit] `liveRunIds` không còn ai gọi**
- `uninstall.ts:58` vẫn export, `mac-setup.md` (bảng Files) vẫn liệt kê, nhưng không còn chỗ nào trong `src` hay `test` gọi tới.
- Sửa: xóa hàm và cập nhật bảng Files, hoặc giữ lại nếu có kế hoạch dùng.

### Tổng
- 2 major cũ đã đóng; mọi minor cũ đã sửa.
- Mới: 0 critical, 0 major, 2 minor (R1, R2), 1 nit (R3).
- Câu hỏi còn mở: Agent SDK mà `crewd` v2 dùng có truyền `--print` cho claude không? Nếu có thì R1 nên sửa trước AC-2 trên Mac của owner.

## Re-review 2 (`deb8503..a15e4fc`, 2026-10-07)

- Phạm vi: commit `a15e4fc` (8 file, +91/−24) và mục "Sửa sau re-review" trong `mc-1-report.md`, `mc-2-report.md`.
- RED: log có 3 test fail trên code cũ, khớp đúng 3 test mới.
- GREEN: em chạy lại `vitest run` cho `uninstall`, `doctor`, `cli`, `run-members`, `reaper-select` ở `a15e4fc`, được **90 passed**, khớp report.

### Verdict

| Ticket | Verdict |
|---|---|
| MC-1 | **APPROVE** |
| MC-2 | **APPROVE** |

### Các điểm trọng tâm

1. **Reaper không đổi hành vi.**
   - `process-table.ts` chỉ thêm field `ProcInfo.envReadable` và hàm thuần `isEnvReadable`.
   - `extractRunId`, `RUN_ID_RE`, `isClaudeExe`, `isClaudePrint` và toàn bộ `run-members.ts`/`select.ts`/`reap.ts` không bị sửa.
   - `grep envReadable apps/crew-mac/src` cho thấy chỉ `uninstall.ts:72` dùng field này.
   - Reaper vẫn chỉ dọn `claude --print`/`-p` có `PAPERCLIP_RUN_ID` lấy từ env, đúng tiêu chí cũ. Test `run-members`/`reaper-select` vẫn pass. Thay đổi trong `run-members.test.ts` chỉ là thêm field vào fixture, cộng một test cho `isEnvReadable`.
   - Ghi chú: plan nói `process-table.ts` "chỉ import, không sửa". Phần sửa này chỉ thêm code, không đổi gì đã có, và docs `mac-orphan-reaper.md` đã cập nhật (R3). Lead nên ghi một dòng vào ledger.
2. **Luật `node` + token "claude" không làm sót agent thật.**
   - Agent `claude_local` chạy qua wrapper, wrapper `exec "${CREW_CLAUDE_BIN:-claude}"`. Argv[0] là `claude` hoặc đường dẫn `…/claude/versions/<bản>`, nên `isClaudeExe` đúng ngay. Luật `node` không bao giờ được xét tới cho agent này.
   - Luật `node` chỉ là đường phụ cho claude cài bằng npm: đường dẫn script `…/@anthropic-ai/claude-code/cli.js` có chứa "claude", và nằm trước `--print`.
   - `node -p <expr>`: `-p` ở vị trí 1 nên `slice(1, 1)` rỗng, không bị tính. Đúng ý.
   - Nhánh run id đọc được vẫn chặn mọi claude hoặc node-chạy-claude có `PAPERCLIP_RUN_ID`. Nhánh sshd vẫn độc lập với env.
3. **Test đổi argv không làm yếu test.**
   - Test "node --print không đọc được env" đổi `/x/cli.js` thành `/x/claude-code/cli.js`. Test vẫn đi qua nhánh "env không đọc được thì chặn" của node-chạy-claude.
   - Ca trước đây (node chạy script không phải claude) giờ được phủ ngược chiều bởi test mới `node -p "<expr>"` (không chặn).
   - Có thêm test "claude -p nền đọc được env, không run id thì cho qua". Test này phân biệt được hai trường hợp mà fixture cũ (`env === argv`) không phân biệt được. R1 đóng.
4. **R2 đóng.** `--version` quá hạn giờ đặt `hung`, bỏ lệnh runtime và `break`. Có thêm trần tổng 60 giây, kiểm ở đầu mỗi vòng lặp. Test: 3 worktree với 3 bundle khác nhau thì chỉ có 2 lệnh ssh. Xấu nhất vượt trần tối đa một lệnh (≤ 30 giây). Chấp nhận được, report đã ghi.
5. **R3 đóng.** Đã bỏ `liveRunIds` và xóa dòng trong bảng Files của `mac-setup.md`.

### Finding mới
- **N1 [nit]** `apps/crew-mac/src/reaper/process-table.ts`: `isEnvReadable` được chèn giữa JSDoc của `extractRunId` và chính hàm `extractRunId`. Comment "Run id chỉ được tìm trong phần env…" giờ nằm phía trên `isEnvReadable`. Sửa: chuyển JSDoc về ngay trên `extractRunId`, và chuyển comment của field `envReadable` (hoặc một dòng ngắn) lên trên `isEnvReadable`. Không chặn merge.

### Tổng
0 critical, 0 major, 0 minor, 1 nit. Hai ticket APPROVE.
