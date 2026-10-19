# Review gói `superpowers-mac`: SP-2 (`3adaeb6`), SP-3 (`efd03c5`)

- Ngày: 2026-10-07 (Asia/Ho_Chi_Minh). Nhánh `r1-2/crew-mac`, worktree `.worktrees/crew-r12-mac`, HEAD = `efd03c5`.
- Phạm vi: `git diff a15e4fc..efd03c5` (28 file, +1754/−33). Đối chiếu với `superpowers-mac.md` (SP-2, SP-3), `spike-superpowers.md`, `plan.md` (Interface "Pin Superpowers trên Mac"), `sdd-ledger.md` (O6 và ruling SP-1/SP-2/SP-3), `sp-2-report.md`, `sp-3-report.md`.
- Đã chạy lại:
  - `vitest run` cho `workflows-pin`, `workflows-inventory`, `workflow-check`, `crew-claude-run`, `setup`, `doctor`: **94 passed**.
  - `crew-docs check --range a15e4fc..efd03c5`: ok.
- Kiểm thực tế, chỉ đọc:
  - Mô phỏng phần quét nguồn của `workflow-check` (`git ls-files` / `--others`) trên checkout Crew (`~/Documents/projects/crew`) và `my-crew`: hiện **không có** nguồn nào bị `blocked`. Cả hai repo đều commit `enabledPlugins: {"superpowers@claude-plugins-official": true}`.
  - Thử `git ls-files --others` trong repo tạm (đã xóa): file bị ignore (`__pycache__/*.pyc`) **có** trong kết quả.
  - Cây owner `~/.claude/plugins/cache/.../superpowers/6.4.1` có 51 file thực thi; hook SessionStart gọi trực tiếp `"${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd"`.
- Không chạy `setup` thật, không ghi `~/.crew`, không sửa code.
- Report không đánh số concern (1)–(4). Em xét hai mục "Còn mở" của `sp-3-report.md` và concern (4) theo mô tả của lead.

## Verdict

| Ticket | Verdict | Lý do chính |
|---|---|---|
| SP-2 | **APPROVE** | Copy ghim nguyên tử, chỉ đọc `~/.claude/plugins`, checksum khớp thuật toán; còn 2 minor |
| SP-3 | **CHANGES_REQUESTED** | M1: chặn nhầm worktree hợp lệ vì file ignore/rác macOS. M2: owner nâng Superpowers thì mọi run của repo Crew thoát 78 mà doctor vẫn `ok` |

## Đã kiểm, đạt

- **Copy ghim nguyên tử** (`workflows/install.ts:59-101`):
  - Chọn nguồn theo `version` + `gitCommitSha` + checksum cây.
  - `cpSync` vào `<dir>.tmp-<pid>` (cùng thư mục cha, nên cùng filesystem), kiểm lại checksum bản tạm rồi `renameSync`; `finally` xóa bản tạm.
  - Thư mục ghim có sẵn mà lệch checksum thì từ chối ghi đè.
  - Chỉ đọc `~/.claude/plugins` (`readFileSync`, `cpSync` từ nguồn), không ghi gì vào đó. `.in_use` ở cấp gốc bị lọc, khớp với thuật toán checksum.
  - Setup gọi bước này trước mọi file khác (`setup.ts`).
- **Checksum ổn định** (`workflows/tree-checksum.ts`):
  - Sắp theo byte bằng `Buffer.compare`, tương đương `LC_ALL=C sort`.
  - Gặp symlink (kể cả gốc là symlink) hay loại file khác thì lỗi.
  - Thư mục rỗng không tính, đúng với thuật toán shell.
  - Implementer báo đã chạy trên cây thật, ra `3f0ff8c8…bd9a` / 231 file.
  - Quyền file **không** nằm trong checksum, xem S1.
- **Wrapper 78 trước `pgid`/`started`** (`assets/crew-claude-run.sh:10-49`):
  - Đếm `--plugin-dir` (cả dạng `=`), cần đúng 1, rồi gọi `workflow-check`. Lệnh này khác 0 hoặc không có `crew-mac` thì `exit 78`, đều **trước** khối ghi `pgid`/`started`.
  - Khối ghi giữ nguyên. `started` vẫn tính từ `etime` (thời điểm sinh), nên chờ thêm vì `workflow-check` không làm lệch hợp đồng với reaper/stop-run.
  - Có test cho cả 5 nhánh, kể cả "không có `PAPERCLIP_RUN_ID` thì không gọi crew-mac".
- **`run-init-check` chỉ báo:** chỉ có trong CLI (`cli.ts`, thoát 0/78), wrapper không gọi. Không chặn run nào. `BUILTIN_SKILLS` lỗi thời chỉ gây báo nhầm, đúng như report nói.
- **Docs:** `mac-workflows.md` mới khớp code (bảng phân loại, mã 78, `run-init-check`). `crew-docs check` đạt.

## Findings

### M1. [major] SP-3: `isTracked` coi file bị ignore và rác macOS là "nguồn lạ", chặn nhầm cả worktree
- Vị trí: `apps/crew-mac/src/workflows/inventory.ts:43-50` (`ls-files --others` không có `--exclude-standard`) và `:105` (`readdirSync(dir)` lấy mọi entry).
- Đã kiểm bằng git thật:
  - (a) Skill đã commit có script Python: agent chạy một lần là sinh `.claude/skills/x/scripts/__pycache__/*.pyc` (bị ignore nhưng `--others` vẫn liệt kê). Skill `x` thành `blocked`, **mọi run sau** của worktree thoát 78.
  - (b) `.claude/skills/.DS_Store` (Finder tự tạo khi owner mở thư mục) là một entry riêng, `ls-files` rỗng, nên `blocked`.
  - (c) Tương tự với `node_modules` trong skill có script JS.
- Lead đã nói chặn nhầm nặng hơn lọt. Ở đây chặn nhầm sinh ra từ chính hoạt động bình thường của agent và của macOS.
- Cách sửa:
  1. Bỏ qua rác của hệ điều hành ở cả hai chỗ (entry `readdirSync` và đầu ra `--others`): `.DS_Store`, `._*`, `Icon\r`.
  2. Phân biệt file bị ignore và file chưa track: dùng `git ls-files --others --exclude-standard` cho "thả thêm file", còn file bị ignore thì xếp `warn` (hoặc chỉ chặn khi đuôi là `.md`/`SKILL.md`/`.json`, những file claude thật sự nạp). Ruling SP-3 ("kể cả ignore") cần lead chỉnh lại; đây là quyết định đã ghi, em chỉ đưa ra lựa chọn.
  3. Gộp thành **một** lệnh `git -C <root> ls-files -z --others -- .claude` và một lệnh `ls-files -z -- .claude`, thay cho 2 lệnh git cho mỗi entry, để đỡ trễ lúc khởi động mỗi run.
  4. Test: skill đã commit có thêm `__pycache__/x.pyc` (bị ignore) và `.DS_Store`, kỳ vọng `project`/không chặn.

### M2. [major] SP-3: owner nâng Superpowers thì mọi run của repo Crew thoát 78, doctor không báo trước (concern 4)
- Vị trí: `apps/crew-mac/src/workflows/inventory.ts:137-153` (`matchesPin` đọc `~/.claude/plugins/installed_plugins.json` ở **mỗi run**), `apps/crew-mac/src/commands/doctor.ts` `checkSuperpowersPin` (chỉ in `bản owner đang cài: …` trong detail, status vẫn `ok`).
- Bằng chứng: repo Crew và `my-crew` đều commit `enabledPlugins` `superpowers@claude-plugins-official`. Chỉ cần owner `/plugin update` (hoặc marketplace tự cập nhật) lên 6.4.2, là không còn entry nào khớp pin. Nguồn đó thành `blocked` (`WORKFLOW_SOURCE_MISMATCH`) và **mọi** run trong worktree của repo này thoát 78. Owner xóa plugin cũng cho kết quả như vậy.
- Tức là tính sẵn sàng của agent phụ thuộc vào thao tác tương tác của owner ở `~/.claude`, và doctor không cảnh báo gì.
- Cách sửa (cần cả hai):
  - (a) Doctor: thêm check (hoặc mở rộng `superpowers-pin`) chạy `discoverSources` cho từng worktree cấp 1 dưới `worktreeRoot` (cùng cách `checkCrewDocs` quét). Có nguồn `blocked` thì `fail` kèm đường dẫn và lý do. Ngoài ra, khi bản owner cài không chứa `pin.version` mà có worktree bật `superpowers@*`, thì `warn` ngay cả khi chưa có worktree nào: "nâng/xóa Superpowers ở ~/.claude sẽ chặn mọi run của repo bật plugin này".
  - (b) Cần lead/owner quyết hướng. Spike SP-3 đo thấy repo bật superpowers cộng `--plugin-dir` chỉ nạp **một** bản (`@inline`) khi **cùng version**; khác version thì chưa đo. Hai lựa chọn:
    - đo thêm một lượt haiku với cache owner ở bản khác. Nếu `@inline` vẫn thắng thì xếp nguồn này là `pinned` (`run-init-check` vẫn bắt nạp đôi);
    - giữ chặn nhưng ghi vào `mac-workflows.md` và runbook: "không nâng Superpowers ở ~/.claude khi chưa nâng pin (Q7)".

### Minor SP-3

- **m3. Nguồn trong worktree chưa được kiểm kê (có thể lọt).** `inventory.ts:91-157` chỉ quét `skills/agents/commands`, `settings.json`, `settings.local.json`. Chưa quét:
  - `.claude/hooks/*`, `.claude/rules`, `output-styles`, `.mcp.json`: `settings.json` đã track có thể gọi script hook chưa track hoặc bị ignore; `.mcp.json` chưa track vẫn được cho qua theo nguồn `project` trong init (report đã nêu `.mcp.json`);
  - file đã track nhưng đang sửa dở (dirty) vẫn được tính là `project`;
  - symlink đã track trỏ ra ngoài worktree (ví dụ `~/.claude/skills/x`) được xếp `project` theo đường dẫn của link, trong khi claude theo link để nạp nội dung.
  - Sửa: quét thêm thư mục `hooks` cùng các script mà `settings.json` tham chiếu, và `.mcp.json`; `realpath` từng nguồn trước khi gọi `classifyOrigin`. Vì O6 tin nội dung đã commit, phần dirty chỉ cần ghi chú.
- **m4. Lỗi git bị báo thành "không được git track".** `inventory.ts:46-49`: `/usr/bin/git` lỗi (thiếu Command Line Tools, timeout 10 giây khi git dir nằm dưới `~/Documents` gặp TCC) trả mã khác 0, ra `tracked=false`, `blocked` với lý do `không được git track`. Chặn như vậy là đúng hướng (fail-closed) nhưng thông báo dẫn sai hướng. Sửa: phân biệt `code !== 0` / `timedOut` và in lý do thật.
- **m5. Khe trước `pgid`.** `crew-claude-run.sh:32`: `pgid`/`started` giờ ghi sau `workflow-check` (node khởi động, các lệnh git, checksum 231 file; thường 0,3–2 giây). Trong khe này, H3 `stop-run` không có `pgid` và chưa có `claude` để bắt theo nhánh (a), nên run có thể vẫn `exec claude` sau lệnh dừng, tới khi reaper dọn (ngưỡng mồ côi 60 giây). Plan yêu cầu thứ tự này. Đề nghị ghi khe này vào `mac-orphan-reaper.md`/`mac-workflows.md`. Muốn đóng hẳn thì ghi `pgid`/`started` trước rồi kiểm sau: file thừa của run bị 78 vô hại, vì reaper (c) đã kiểm leader cùng lúc sinh.

### Minor SP-2

- **S1. Checksum bỏ qua quyền file.** `workflows/tree-checksum.ts:26-31`: chỉ băm nội dung. Hook SessionStart gọi trực tiếp `hooks/run-hook.cmd`. Bản ghim mất bit thực thi (agent cùng uid ghi được `~/.crew/workflows`, hoặc bị copy lại bằng công cụ khác) vẫn khớp checksum, nhưng hook không chạy được: Superpowers mất ngữ cảnh khởi động mà không ai thấy. `cpSync` giữ quyền nên lúc cài không sao. Sửa: giữ nguyên số checksum của plan, thêm một kiểm phụ trong `workflowCheck`/doctor, ví dụ danh sách file phải có bit `x` (lấy từ cây owner lúc cài, lưu trong pin) hoặc `chmod -R a-w` thư mục ghim sau khi cài.
- **S2. Bản tạm của pid khác không được dọn.** `workflows/install.ts:83-84`: chỉ xóa `<dir>.tmp-<pid hiện tại>`. Setup bị giết giữa chừng để lại `…tmp-<pid cũ>` (231 file) mãi mãi. Không cản lần cài sau (đã có test). Sửa: trước khi copy, xóa mọi `${basename(dir)}.tmp-*` trong thư mục cha.

## Tổng

- SP-2: APPROVE, 2 minor (S1, S2).
- SP-3: CHANGES_REQUESTED, 2 major (M1, M2) và 3 minor (m3–m5).
- Toàn gói: 0 critical, 2 major, 5 minor.

## Câu hỏi còn mở

1. M2(b): đo thêm một lượt để biết `--plugin-dir` có thắng `enabledPlugins` của repo khi **khác version** không, hay giữ chặn và đưa vào runbook?
2. M1: lead có chấp nhận nới ruling SP-3 "`--others` kể cả ignore" thành "chỉ file chưa track, không tính file ignore", kèm danh sách rác hệ điều hành bỏ qua không?

## Re-review (`efd03c5..3a4b374`, 2026-10-07)

- Phạm vi:
  - commit `3a4b374` (13 file, +656/−137);
  - mục "Sửa sau review" của `sp-2-report.md`, `sp-3-report.md`;
  - mục "Đo khác version" trong `spike-superpowers.md`;
  - các ruling M1/M2/m4/S1/S2 và ruling hook mà lead xác nhận, ở cuối `sdd-ledger.md`. Em không đặt lại câu hỏi về giới hạn hook chỉ tính file script.
- RED: log có 15 test fail trên `efd03c5`, khớp danh sách test mới.
- GREEN: em chạy lại `vitest run` cho `workflows-inventory`, `workflows-pin`, `workflow-check`, `doctor`, `crew-claude-run` ở `3a4b374`, được **88 passed**. `crew-docs check --range efd03c5..3a4b374`: ok.
- Kiểm thực tế, chỉ đọc:
  - `find hooks skills -type f -perm +111` trên cây owner 6.4.1 ra **đúng 11 file**, trùng `SUPERPOWERS_PIN.executables`.
  - `git status --ignored=matching --untracked-files=all -- .claude/hooks` trên `my-crew` (hook của kit chạy liên tục trong phiên này) chỉ ra `!! .claude/hooks/.logs/`; checkout Crew sạch. Với luật mới, cả hai đều ra 0 `blocked`, khớp report.

### Verdict

| Ticket | Verdict |
|---|---|
| SP-2 | **APPROVE** (S1, S2 đóng) |
| SP-3 | **CHANGES_REQUESTED**, chỉ còn M3 bên dưới. Nếu lead chấp nhận M3 như một rủi ro vận hành (sửa theo hướng (b)+(c), không đổi luật), thì chuyển APPROVE |

### Các finding cũ

- **M1: đóng.** `inventory.ts` giờ chỉ xét file claude nạp (`SKILL.md`, `*.md` của agents/commands, script trong hooks, `settings*.json`, `.mcp.json`).
  - `isJunk` bỏ `.DS_Store`, `._*`, `Icon\r`, `__pycache__`, `*.pyc`; `walkFiles` bỏ thư mục chấm.
  - Chỉ còn 2 lệnh git cho cả cây, có `--no-optional-locks`.
  - Test có `__pycache__` và `.DS_Store` trong skill đã commit (cho qua), `SKILL.md` bị ignore hoặc chưa track (chặn), và số lệnh git cố định.
- **M2: đóng.** Bỏ `matchesPin`, nên workflow-check không còn đọc `~/.claude/plugins` mỗi run. Owner nâng hay gỡ Superpowers không còn chặn run. Doctor `warn` khi bản owner khác pin.
- **m3/m4/m5: đã sửa như mô tả.** m4: lý do `không kiểm được git: …` đúng chỗ. m5: khe trước `pgid` đã ghi trong docs.
- **S1: đóng, không chặn nhầm.**
  - `missingExecutables` chỉ xét 11 file cố định trong thư mục ghim, thư mục mà agent không có lý do sửa.
  - `cpSync` giữ mode; `ensureExecutables` đặt lại bit cả khi cài mới lẫn khi bản ghim có sẵn đã mất bit (checksum không đổi).
  - Chặn chỉ xảy ra khi bản ghim thật sự mất bit, mà khi đó hook Superpowers cũng không chạy được, nên chặn là đúng.
  - Khi nâng pin, `executables` phải cập nhật theo; thiếu file thì setup báo rõ.
- **S2: đóng.** `removeStaleTemps` xóa mọi `.tmp-*`.

### Câu hỏi của lead: máy không cài Superpowers mà repo bật plugin

- **Bằng chứng có sẵn:** lượt đo "khác version" chạy trong repo tạm ngoài `my-crew`, trong khi bản owner cài theo scope **project** cho `my-crew`. Vậy với repo tạm này, `enabledPlugins` `superpowers@claude-plugins-official` trỏ tới plugin không áp dụng được. Kết quả: run thoát 0, `system/init` chỉ có `superpowers@inline`. Worktree `~/crew-agents/*` ở đúng tình huống này: không có lỗi khởi động, chỉ nạp bản ghim.
- **Chưa đo:**
  - (i) Mac mà marketplace `claude-plugins-official` chưa được đăng ký;
  - (ii) tác dụng phụ: `claude -p` có tự cài plugin mà repo bật vào `~/.claude/plugins` hay không. Spike chỉ so checksum của cây ghim và cây owner, không so `installed_plugins.json`.
- **Đề nghị (minor N2):** ở Cổng 4 (AC-2), chụp `~/.claude/plugins/installed_plugins.json` (sha256) trước và sau run thật đầu tiên, và chạy `crew-mac run-init-check` trên log run. Có thể thêm vào doctor một phép thử `claude -p` dùng `agentExtraArgs` trong repo tạm có commit `enabledPlugins` superpowers, để bắt lỗi khởi động trên từng Mac.

### Finding mới

**M3. [major] SP-3: thay đổi dở trong `.claude/` của một run bị ngắt làm mọi lần chạy lại thoát 78, không tự hồi phục**
- Vị trí: `apps/crew-mac/src/workflows/inventory.ts:113-134` (`fileReason`: `DIRTY_REASON` cho mọi mã status khác `!!`; `UNTRACKED_REASON`/`IGNORED_REASON`), chặn ở `workflow-check` qua wrapper.
- Kịch bản: issue sửa `.claude/agents/*.md`, `.claude/skills/x/SKILL.md`, `.claude/settings.json` hay script hook (repo Crew có sẵn `.claude/agents` và `hooks/*.cjs`, nên việc này dễ xảy ra). Run bị ngắt trước khi commit (mất mạng, quota, cancel), và đó chính là lúc Paperclip retry. File còn ở trạng thái ` M`/`A ` hoặc chưa track, nên mọi retry, và mọi issue sau dùng cùng worktree, đều `exit 78` tới khi có người vào commit hoặc revert tay.
- Doctor không quét nguồn của worktree, nên tình trạng kẹt này không hiện ở đâu ngoài stderr của run.
- Phần "chưa track thì chặn" có từ plan. M3 nặng hơn vì m3 thêm "đã track mà sửa dở", trong khi review vòng trước em chỉ đề nghị ghi chú phần này (O6 tin nội dung đã commit).
- Cách sửa, cần lead chọn:
  - (a) **Đổi luật:** file đã track mà sửa dở thì không chặn, chỉ in `crew-workflow warn: <path> đã sửa chưa commit` (nội dung do chính agent của worktree viết, không phải nạp chéo từ owner). Chỉ giữ chặn cho `settings*.json` và script hook đang sửa dở, vì đó là phần chạy lệnh.
  - (b) **Giữ luật, thêm đường ra:** dòng `crew-workflow blocked` in kèm lệnh xử lý cụ thể (`git -C <root> stash push -- <path>` hoặc commit), và doctor quét `discoverSources` cho từng worktree cấp 1 dưới `worktreeRoot`, `fail` khi có nguồn `blocked`.
  - (c) Ghi vào runbook của Trợ Lý/RO-1: run thoát 78 với `đã sửa so với commit`/`không được git track` thì người xử lý dọn worktree trước khi retry.
  - Test cần có: worktree có `.claude/agents/a.md` sửa dở, kỳ vọng theo luật lead chọn.

**N2. [minor]** Xem mục câu hỏi của lead ở trên (đo plugin bật trong repo trên máy không cài hoặc không có marketplace, kèm tác dụng phụ lên `installed_plugins.json`).

**N3. [nit]** `inventory.ts:70`: `readGit` giả định `root` là gốc repo. Nếu Paperclip đặt cwd là thư mục con, `git status --porcelain` trả đường dẫn tính từ gốc repo, không khớp với `ls-files`, và sửa dở sẽ lọt (lọt, không chặn nhầm). Có thể truyền `-- :/.claude` hoặc lấy `rev-parse --show-toplevel` để thống nhất.

### Tổng
- M1, M2, m3–m5, S1, S2: đóng.
- Mới: 0 critical, 1 major (M3), 1 minor (N2), 1 nit (N3).
- SP-2 APPROVE. SP-3 CHANGES_REQUESTED, chỉ vì M3.

## Re-review 2 (`3a4b374..7ffc03a`, 2026-10-07, vòng 3/5 của SP-3)

- Phạm vi: commit `7ffc03a` (8 file, +321/−78) và mục "Sửa sau re-review" trong `sp-3-report.md`. Lead đã chốt M3 theo hướng (a)+(b).
- RED: log có 7 test fail trên `3a4b374`, khớp test mới. Test "khác hoa thường" thêm sau, có bằng chứng từ quét thật.
- GREEN: em chạy lại `vitest run` cho `workflows-inventory`, `workflow-check`, `doctor` ở `7ffc03a`, được **67 passed**. `crew-docs check --range 3a4b374..7ffc03a`: ok.
- Kiểm thực tế, trong repo tạm đã xóa: `cd "<repo>/sub dir"` (gõ khác hoa thường so với thư mục thật `Sub Dir`), `git rev-parse --show-prefix` vẫn trả `Sub Dir/`, tức đúng chữ như trong index.

### Verdict

| Ticket | Verdict |
|---|---|
| SP-3 | **APPROVE** (còn 2 minor, không chặn) |

### Kiểm theo yêu cầu của lead

1. **M3 đóng.**
   - `judge` (`inventory.ts`): `SKILL.md` và `agents|commands/*.md` đã track mà sửa dở (` M`, `M `, `A `…) chỉ ghi `warning`. `workflow-check` thoát 0 kèm `crew-workflow warn: …`.
   - Một run bị ngắt giữa chừng mà để lại skill/agent sửa dở không còn làm retry thoát 78.
   - `settings*.json`, script hook, `.mcp.json` sửa dở vẫn chặn, kèm lệnh xem/gỡ. Nguồn chưa track, bị ignore, symlink ra ngoài vẫn chặn với mọi loại, đúng luật của plan.
   - Trường hợp còn kẹt (skill hay agent **mới**, chưa track, do run bị ngắt tạo ra) giờ hiện trong doctor `worktree-workflows` (`fail` kèm lệnh xử lý), đúng hướng (b).
2. **Lệnh xử lý in ra.**
   - Lệnh nào cũng chỉ nhắm đúng một file: `diff HEAD -- <file>` / `checkout HEAD -- <file>`; `diff --cached` / `rm --cached -- <file>`; `add [-f] -- <file>`, hoặc "xóa file đó".
   - Không có lệnh phá dữ liệu trên diện rộng (`reset --hard`, `clean`, `checkout .`, `stash` cả cây).
   - `checkout HEAD -- <file>` bỏ thay đổi chưa commit của **đúng file đó**, và được ghi là "bỏ:" bên cạnh lựa chọn "hoặc commit". Chấp nhận được. Ca `UU` (conflict) cũng rơi vào lệnh này, vẫn chỉ trong phạm vi một file.
   - Đường dẫn chưa được quote, xem N4.
3. **N3 đúng.**
   - `rev-parse --show-prefix`, `ls-files --full-name` và porcelain v1 đều tính từ gốc repo, khóa so khớp là `prefix/rel`.
   - `rel` lấy bằng `relative(root, abs)` với `abs = join(root, …)`, nên cùng chữ với `root`. Prefix git trả đúng chữ như trong index (đã kiểm ở trên).
   - Hai test mới: worktree là thư mục con, và đường dẫn khác hoa thường. Thư mục không phải git có `.claude` thì vẫn ra `không kiểm được git`, chặn, đúng hướng fail-closed. Không có `.claude` lẫn `.mcp.json` thì không gọi git.
4. **Doctor `worktree-workflows`.**
   - Bình thường: 3 lệnh git cho mỗi worktree, report đo khoảng 50 ms/repo, nên không chậm.
   - Xấu nhất: git treo (ví dụ git dir dưới `~/Documents` khi doctor chạy qua SSH và gặp TCC) thì `rev-parse` quá hạn 10 giây rồi trả sớm. Mỗi worktree tốn khoảng 10 giây, **không có trần tổng** như `crew-docs` (60 giây), xem N5. Không treo vô hạn.

### Finding mới

- **N4. [minor] Lệnh xử lý chưa quote đường dẫn.** `inventory.ts`, `fileIssue`: `git -C ${root} … -- ${rel}` ghép chuỗi thô. Worktree hay file có dấu cách (ví dụ `my skill/SKILL.md`) thì lệnh in ra khi copy-paste sẽ tách sai tham số. `checkout HEAD -- .claude/skills/my skill/SKILL.md` sẽ khôi phục nhầm hai đường dẫn khác, nếu chúng tồn tại. Sửa: dùng `shQuote` (đã có trong `doctor.ts`, chuyển sang module dùng chung) cho `root` và `rel`.
- **N5. [minor] `worktree-workflows` không có trần tổng.** `doctor.ts`, `checkWorktreeWorkflows`: git quá hạn ở worktree đầu thì vẫn thử tiếp các worktree sau, mỗi cái 10 giây. Sửa giống `checkCrewDocs`: dừng sau lần quá hạn đầu tiên (`git quá hạn` trong `reason`), hoặc đặt trần 60 giây, kèm dòng "dừng kiểm các worktree còn lại".

### Tổng
- M3 và N3 đóng.
- Mới: 0 critical, 0 major, 2 minor (N4, N5).
- SP-3 **APPROVE**; SP-2 giữ APPROVE.
