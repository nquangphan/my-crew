# Ghim Superpowers và BMAD, chặn nạp chéo trên Mac

> Flow `mac-workflows`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-workflows` in ra đúng danh sách đó.

## Mục đích

Agent `claude_local` trên Mac chỉ được nạp đúng một bản Superpowers đã ghim. Bản ghim là bản owner đang cài
(`superpowers@claude-plugins-official` 6.4.1, revision `5bf4e78011075bcfc0dc295f0724994cd123ee71`), không phải bản V2
(6.4.2): agent dùng đúng workflow mà owner đang dùng. Run không bao giờ đọc thẳng cache plugin của owner, vì cache
đó đổi mỗi khi owner nâng plugin; run chỉ đọc một bản copy riêng có checksum cố định.

Cạnh Superpowers, Crew ghim **BMAD** cho agent lập epic/story: repo chính thức `bmad-plugins`
(`https://github.com/bmad-code-org/bmad-plugins.git`) ở revision `d009608292d8a2ea4df846de7dca2f0d78a9e22d`
(6.13.0-next). Hai cây skill `plugins/method/skills` (bmad-method, 21 skill) và `plugins/toolbox/skills` (bmad-toolbox,
8 skill) được lắp thành **một** plugin tên `bmad` (tên plugin = id workflow, vì `run-init` so tên plugin trong
`system/init` với `pin.workflow`), cộng `.claude-plugin/plugin.json` do Crew sinh. Bản ghim không theo HEAD của
marketplace `bmad` owner đã thêm: owner kéo marketplace mới không được đổi skill mà agent đang chạy, và mọi Mac phải ra
đúng cùng một cây (258 file, checksum `7f62e5cb6033…`).

Sổ workflow đã chứng nhận (`registry.ts`) có đúng hai mục, thứ tự cố định: `superpowers` (mặc định; design/plan/task,
code, review, merge) và `bmad` (epic/story); cả hai chỉ chạy runtime `claude_local`.

## Điểm vào

- `crew-mac setup` gọi `installSuperpowersPin` rồi `installBmadPin` (flow `mac-setup`) và in `adapterConfig.extraArgs`
  cho agent thường và agent vai bmad.
- `crew-mac workflows list [--json]`: in sổ workflow. Mỗi workflow một dòng
  `<id> <version> rev=<rev12> <đã cài|chưa cài|lệch checksum> <mặc định|->`; `--json` in mảng
  `{id, version, revision, checksum, runtimes, isDefault, purpose, dir, installed}` (`installed` = thư mục ghim có và
  đúng checksum).
- `crew-mac workflows install`: chỉ cài hai bản ghim (Superpowers trước, BMAD sau) rồi in
  `extraArgs (vai thường): […]` và `extraArgs (vai bmad): […]`. Không đụng sshd, launchd hay file nào khác, nên chạy
  được khi app 2P Crew đang giữ sshd agent. Lỗi cài thì in `crew-mac: <câu lỗi>` và thoát 1; sai cách dùng thoát 2.
  (`workflows gc` có trong cách dùng, chưa làm.)
- `crew-mac doctor` kiểm bản ghim (check `superpowers-pin`, `bmad-pin`).
- `crew-mac bmad setup-project --root <dir>`: agent BMAD gọi khi repo chưa có `_bmad/scripts`; dựng `_bmad/` bằng
  `setup.py` của bản ghim (mục "BMAD trong repo dự án").
- `crew-mac bmad stories --root <dir> --file <file.md> [--rev <sha>] [--json]`: agent BMAD, reviewer và Trợ Lý gọi để
  đọc file epic/story (mục "Đọc file epic/story").
- `crew-mac workflow-check --root <worktree> --plugin-dir <dir>`: wrapper `crew-claude-run` gọi trước mỗi run
  Paperclip. Workflow của run là workflow có thư mục ghim trùng `--plugin-dir`. In
  `crew-workflow ok pin=<id>@<version> rev=<rev12> sum=<checksum12> project=<n> pinned-dup=<n>` (ví dụ
  `pin=bmad@6.13.0-next rev=d009608292d8 sum=7f62e5cb6033`) và thoát 0, hoặc mỗi nguồn bị chặn một dòng
  `crew-workflow blocked: <đường dẫn> (<lý do>)` và thoát 78. Đầu vào sai thì thoát 2.
- `crew-mac run-init-check --root <worktree> --log <file stream-json | ->`: kiểm sau run (nghiệm thu, điều tra), đọc
  dòng `system/init` của log run, tự nhận workflow của run theo tên plugin. Mã thoát giống `workflow-check`; log không
  đọc được thì thoát 1.

## Các bước

1. `apps/crew-mac/src/workflows/pin.ts`: `SUPERPOWERS_PIN` giữ version, revision, checksum cây của bản ghim và
   `executables` (hook và script skill phải có bit thực thi; checksum chỉ băm nội dung nên quyền kiểm riêng).
   `superpowersPinDir(home)` = `~/.crew/workflows/superpowers/<version>-<12 ký tự đầu của revision>`
   (hiện là `6.4.1-5bf4e7801107`). `agentExtraArgs(dir)` = `["--setting-sources","project,local","--plugin-dir",dir]`.
   `WorkflowId` = `superpowers | bmad`; `pinDir(home, pin)` = `~/.crew/workflows/<workflow>/<version>-<rev12>` cho
   mọi workflow (`superpowersPinDir` gọi `pinDir`).
2. `apps/crew-mac/src/workflows/install.ts` → `installSuperpowersPin`:
   - Trước hết xóa mọi bản tạm `<dir>.tmp-*` còn sót của lần setup bị ngắt (mọi pid).
   - Thư mục ghim có sẵn và đúng checksum thì chỉ đặt lại bit thực thi theo `executables` nếu mất (không đổi
     checksum). Có sẵn mà lệch checksum (hoặc là symlink) thì báo lỗi, không ghi đè. Owner xóa tay rồi chạy lại setup.
   - Chưa có thì tìm trong `~/.claude/plugins/installed_plugins.json` (`readInstalledPlugins`) một entry
     `superpowers@claude-plugins-official` có đúng version, đúng `gitCommitSha` và cây đúng checksum.
   - Copy cây đó sang `<dir>.tmp-<pid>` (bỏ `.in_use` ở gốc, giữ mode từng file), kiểm lại checksum, đặt bit thực thi
     theo `executables` rồi `rename` sang thư mục ghim. Copy hỏng thì xóa bản tạm.
3. `apps/crew-mac/src/workflows/tree-checksum.ts` → `treeChecksum`: checksum cây (thuật toán bên dưới).
3a. `apps/crew-mac/src/workflows/bmad-pin.ts`: `BMAD_SOURCE` (repo https, thư mục marketplace tương đối HOME
   `.claude/plugins/marketplaces/bmad`, revision, hai cây), `BMAD_PLUGIN_JSON` (đúng byte, kết thúc một `\n`) và
   `BMAD_PIN` (version `6.13.0-next`, checksum `7f62e5cb6033d039505afdce2a1d411cbff064a83f13df1d467987f698cd82d2`,
   `executables` = `skills/bmad/scripts/resolve_customization.py`, số đo ngày 10/10/2026). Thư mục ghim
   `~/.crew/workflows/bmad/6.13.0-next-d009608292d8`.
3b. `apps/crew-mac/src/workflows/bmad-install.ts` → `installBmadPin(ctx, source?)`:
   - Xóa bản tạm `<dir>.tmp-*` còn sót (mọi pid). Thư mục ghim có sẵn đúng checksum thì chỉ bù bit thực thi và trả
     `source: 'existing'` (không gọi git); lệch checksum thì báo `WORKFLOW_SOURCE_MISMATCH`, không ghi đè.
   - Chưa có: tạo `<dir>.tmp-<pid>` (700). Nếu marketplace `bmad` của owner có commit ghim
     (`git -C <marketplace> cat-file -e <rev>^{commit}`) thì `git archive --format=tar -o <tmp>/.src.tar <rev> <hai cây>`
     từ đó (`source: 'marketplace'`, chỉ đọc repo của owner). Không thì
     `git clone --filter=blob:none --no-checkout <repoUrl> <tmp>/.clone` (120 giây, `GIT_TERMINAL_PROMPT=0`), archive
     từ clone rồi xóa clone (`source: 'github'`). Cả hai không được thì báo
     `không lấy được BMAD <version> (<rev12>): cần mạng tới github.com hoặc marketplace bmad có commit này`.
   - `tar -x` vào `<tmp>/.src`, chuyển từng `<cây>/<skill>` lên `<tmp>/skills/<skill>`; tên trùng giữa hai cây là lỗi
     `tên skill trùng giữa bmad-method và bmad-toolbox: <tên>`. Ghi `plugin.json`, đặt bit thực thi theo pin, kiểm
     checksum (lệch thì `WORKFLOW_SOURCE_MISMATCH`), rồi `rename` sang thư mục ghim. Lỗi ở bất kỳ bước nào thì xóa bản
     tạm. Mọi lệnh ngoài (`/usr/bin/git`, `/usr/bin/tar`) đi qua `ctx.runner`; lệnh khác clone hạn 30 giây.
3c. `apps/crew-mac/src/workflows/registry.ts`: `certifiedWorkflows(ctx)` trả sổ hai workflow (pin lấy từ
   `ctx.superpowersPin`, `ctx.bmadPin`, test thay được). `pluginKeys`: superpowers → `^superpowers@`; bmad → `^bmad@`,
   `^bmad-method@`, `^bmad-toolbox@`. `workflowForPluginDir(ctx, dir)` trả workflow có thư mục ghim trùng `dir` (so
   bằng `comparablePath`, bỏ `/` cuối, không phân biệt hoa thường), hoặc null (marketplace, cache owner).
4. `apps/crew-mac/src/workflows/policy.ts`: `samePin` và `assertSkillAllowed` (ném `WORKFLOW_SOURCE_MISMATCH` khi
   bản sắp nạp khác bản ghim).
5. **Wrapper** `apps/crew-mac/assets/crew-claude-run.sh`, khi có `PAPERCLIP_RUN_ID`:
   - Đếm `--plugin-dir <dir>` và `--plugin-dir=<dir>` trong tham số. Khác đúng một thì in `crew-workflow blocked: cần
     đúng một --plugin-dir…` và thoát 78.
   - Sau đó chạy `~/.crew/bin/crew-mac workflow-check --root "$PWD" --plugin-dir <dir>`, in ra stderr để vào log run.
     Lệnh này khác 0 hoặc không có `crew-mac` thì thoát 78.
   - Thoát 78 thì không chạy agent, không ghi `pgid`/`started`.
   - Run id hợp lệ (chỉ hex và `-`): sau `pgid`/`started`, ghi dấu đang dùng `<plugin_dir>/.in_use/<runId>` =
     `<pid> <started>\n` (`pid` là `$$`, cũng là pid của `claude` sau `exec`), ghi file tạm rồi `mv`. Dấu này nằm ngoài
     checksum (bỏ `.in_use` ở gốc) và để dọn bản ghim cũ biết bản nào còn run sống. Không ghi được (thư mục chỉ đọc)
     thì vẫn chạy agent.
   - **Khe `pgid` muộn:** `pgid`/`started` giờ ghi SAU `workflow-check` (khởi động node, hai lệnh git, checksum 231
     file), thường muộn 0,3–2 giây. Trong khe này H3 `crew-mac stop-run` chưa thấy `pgid` và cũng chưa có `claude` để
     bắt, nên run có thể vẫn `exec claude` sau lệnh dừng; reaper dọn nó khi quá ngưỡng mồ côi (60 giây). `started`
     vẫn là thời điểm sinh process nên hợp đồng với reaper không đổi.
6. `apps/crew-mac/src/commands/workflow-check.ts` → `workflowCheck(ctx, { root, pluginDir })`:
   - `workflowForPluginDir` tìm workflow có thư mục ghim trùng `--plugin-dir` (so bằng `comparablePath`); đó là workflow
     của run. Không có thì một dòng `--plugin-dir <dir> không phải bản ghim của workflow nào đã chứng nhận (<thư mục
     ghim superpowers>, <thư mục ghim bmad>)` và không quét worktree.
   - Thư mục ghim phải đúng checksum, không thì `WORKFLOW_SOURCE_MISMATCH`; file trong `executables` phải có bit
     thực thi, không thì `thiếu bit thực thi: …`.
   - Sau đó gọi `discoverSources(ctx, root, pin của workflow đó)`, có nguồn `blocked` nào thì chặn run. Dòng ok có
     `rev=`/`sum=` (12 ký tự đầu revision và checksum của pin) để log run cho biết đúng bản nào đã nạp.
7. `apps/crew-mac/src/workflows/inventory.ts` → `discoverSources`: phân loại nguồn claude nạp trong worktree
   (`classifyOrigin`, bảng dưới):
   - **Chỉ file nguồn nạp được xét:**
     - `SKILL.md` của `.claude/skills/<tên>/`;
     - `*.md` trong `.claude/agents/`, `.claude/commands/`;
     - script trong `.claude/hooks/`: theo đuôi (`.sh`, `.js`, `.cjs`, `.py`…) hoặc có bit thực thi. File và thư mục
       chấm như `.logs/` bỏ qua, vì hook của repo Crew ghi `.claude/hooks/.logs/hook-log.jsonl` (bị ignore) mỗi run;
     - `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`.
   - Mọi file khác (script phụ của skill, output tạm, `__pycache__`, `*.pyc`, `.DS_Store`, `._*`) bỏ qua.
   - Một file nguồn nạp bị chặn (run thoát 78) khi:
     - chưa track (`không được git track…`) hoặc bị ignore (`bị git ignore…`), với mọi loại nguồn;
     - là symlink đã track trỏ ra ngoài worktree;
     - là `settings*.json`, script hook hoặc `.mcp.json` đã track mà đang sửa dở hoặc mới `git add`
       (`đã sửa so với commit…`): đó là đường chạy lệnh.
   - `SKILL.md`, `.claude/agents|commands/*.md` đã track mà sửa dở **chỉ cảnh báo**: `workflow-check` vẫn thoát 0 và in
     thêm `crew-workflow warn: …`. Agent làm việc trên repo có skill (như chính repo Crew) là việc hợp lệ, và một run bị
     ngắt giữa chừng không được làm mọi lần chạy lại kẹt 78.
   - Mỗi dòng chặn/cảnh báo có lệnh xử lý cụ thể (`DiscoveredSource.fix`, `describeSource`). `<root>` và `<file>` được
     quote bằng `shQuote`, nên chạy nguyên văn được cả khi đường dẫn có dấu cách hay nháy đơn:
     - sửa dở: `Xem: git -C <root> diff HEAD -- <file>; bỏ: git -C <root> checkout HEAD -- <file>, hoặc commit.`
       Với file mới `git add`: `diff --cached`, `rm --cached`;
     - chưa track: `commit (git -C <root> add -- <file> rồi commit) hoặc xóa file đó` (`add -f` khi bị ignore).
   - Git lỗi hay quá hạn 10 giây thì mọi nguồn bị chặn với lý do `không kiểm được git: …`.
   - Ba lệnh git cho cả cây, có `--no-optional-locks` để không tranh lock index với git của run:
     - `rev-parse --show-prefix`: `--root` là thư mục con của repo vẫn khớp. Không tự tính từ `--show-toplevel`, vì
       APFS không phân biệt hoa thường: git trả `…/Projects/crew` trong khi run ở `…/projects/crew`;
     - `ls-files --full-name -s -z`;
     - `status --porcelain -z --ignored=matching --untracked-files=all`.
     - Hai lệnh sau giới hạn trong `.claude` và `.mcp.json` (thêm `_bmad` khi run là BMAD). Worktree không có cái nào
       thì không gọi git. Trên checkout Crew và `my-crew` mất khoảng 50 ms.
   - **Nạp chéo qua `enabledPlugins`:** key bật trong `.claude/settings.json` khớp `pluginKeys` của workflow khác
     workflow của run thì `blocked` (`bật workflow <id> khác với workflow của run (nạp chéo)`, hằng
     `CROSS_WORKFLOW_REASON` là phần đuôi), kèm `Bỏ "<key>" khỏi enabledPlugins của .claude/settings.json (commit),
     hoặc giao issue cho agent của workflow <id>.`. Key `<id>@*` của chính workflow là `pinned`. Key cùng workflow mà
     khác tên plugin ghim (`bmad-method@*`, `bmad-toolbox@*` trong run BMAD) cũng `blocked`
     (`bật plugin <tên> ngoài bản ghim, nạp song song với workflow của run`, `PARALLEL_PLUGIN_REASON`): `--plugin-dir`
     chỉ thay plugin trùng tên, nên plugin đó sẽ nạp song song với bản ghim nếu owner cài nó ở user scope.
   - **`_bmad/` (chỉ run BMAD, `judgeBmad`):**
     - `_bmad/scripts/**` (bỏ rác, symlink là khác) phải có đúng tập file và từng byte của
       `<thư mục ghim bmad>/skills/bmad/scripts/**` (`compareBmadScripts`, export cho `crew-mac bmad`). Khác thì một
       nguồn `blocked` `BMAD_SCRIPT_MISMATCH_REASON` kèm lệnh `git status`/`checkout HEAD -- _bmad/scripts` hoặc xóa rồi
       chạy `crew-mac bmad setup-project`. Giống thì `project` khi mọi file đã commit sạch, `pinned` khi còn file chưa
       track hay sửa dở (run trước bị ngắt ngay sau `setup-project`).
     - `_bmad/config.toml`, `_bmad/custom/**/*.toml` (trừ `*.user.toml`) xét như `settings.json`: chưa track, bị ignore
       hay sửa dở đều chặn (lý do `UNTRACKED_REASON`, `IGNORED_REASON`, `DIRTY_REASON`).
     - `_bmad/**/*.user.toml` (lớp cá nhân, trừ `scripts/`, `memory/`) chưa track, bị ignore hay sửa dở thì `blocked`
       `BMAD_PERSONAL_REASON`, kèm `xóa <file> (lớp cá nhân không dùng trong run agent), hoặc commit nếu cố ý dùng cho
       cả nhóm`.
     - `_bmad/memory/**` và `_bmad-output/**` là dữ liệu skill ghi ra, không xét.
   - Run Superpowers không xét `_bmad/` (không có nguồn `kind: 'bmad'`).
8. `apps/crew-mac/src/commands/workflow-check.ts` → `runInitCheck`, với `apps/crew-mac/src/workflows/run-init.ts`:
   - `findInitEvent` lấy dòng `type=system, subtype=init` đầu tiên, không lấy dòng đầu: khi có hook SessionStart,
     dòng đầu là `system/hook_started`.
   - `selectInitWorkflow` nhận workflow của run: plugin không `@builtin` có tên là id workflow đã chứng nhận
     (`superpowers`, `bmad`). Không có cái nào thì `không nạp workflow ghim nào`; có cả hai thì
     `nạp nhiều hơn một workflow (bmad, superpowers)`; cả hai là vi phạm, dừng ở đó.
   - `checkInitEvent` so dòng đó với danh sách cho phép của workflow đã nhận:
     - **plugin:** `*@builtin`; plugin tên `<id>` có `path` là thư mục ghim và đúng `version` (bắt buộc có, không thì
       `không nạp <id> từ bản ghim <dir>`). Một plugin `<id>` khác chỉ được phép nếu đúng version và checksum cây (khi
       nạp đôi), không thì `WORKFLOW_SOURCE_MISMATCH`; plugin `enabledPlugins` của `settings.json` đã commit (không
       thuộc workflow nào) cũng được phép. Run BMAD báo plugin `bmad`, `source: "bmad@inline"`, skill `bmad:*` (đo SP-0
       trên claude 2.1.295; `BUILTIN_SKILLS`, `BUILTIN_AGENTS` vẫn khớp).
     - **skill:** `BUILTIN_SKILLS` của CLI; tên skill `.claude/skills` đã commit; skill Paperclip (`SKILL.md` dưới
       `.paperclip-runtime`); `<plugin>:<skill>` của plugin được phép.
     - **agent:** `BUILTIN_AGENTS`; `.claude/agents` đã commit; `<plugin>:…`.
     - **mcp:** nguồn `claudeai` (connector tài khoản) và `project`; với nguồn `dynamic` chỉ đúng hai MCP Paperclip
       tự gắn vào mọi run (`PAPERCLIP_DYNAMIC_MCP`: `Paperclip projects`, `Paperclip connections`, đo trên log run thật
       07/10/2026). MCP `dynamic` tên khác, hay tên Paperclip mà nguồn khác, vẫn bị chặn.
   - Không xét `slash_commands`.
   - CLI nâng bản mà thêm skill dựng sẵn thì `run-init-check` báo `skill <tên>: không rõ nguồn`: thêm tên đó vào
     `BUILTIN_SKILLS`.

**Phân loại nguồn** (`classifyOrigin`, `discoverSources`):

| Nguồn | Origin |
|---|---|
| `--plugin-dir` = thư mục ghim, đúng checksum | `pinned` |
| Dưới `<root>/.paperclip-runtime/` (skill Paperclip qua `--add-dir`) | `paperclip` |
| File nguồn nạp trong `.claude/{skills,agents,commands,hooks}/*`, `.claude/settings.json`, `.mcp.json` đã commit và sạch | `project` (owner cho phép agent nạp `.claude/` mà repo đã commit) |
| Cùng các file đó nhưng chưa track, bị ignore, hoặc là symlink trỏ ra ngoài worktree | `blocked` |
| `settings*.json`, script hook, `.mcp.json` đã track mà sửa dở | `blocked` |
| `SKILL.md`, agent/command `*.md` đã track mà sửa dở | `project` kèm `warning` (dòng `crew-workflow warn`, không chặn) |
| `<root>/.claude/settings.local.json` có `enabledPlugins` hoặc `hooks`, hoặc không đọc được | `blocked` |
| `enabledPlugins` của `settings.json` có `<id workflow của run>@*` | `pinned`: run chỉ nạp bản `--plugin-dir`, kể cả khi bản owner khác version (đo 07/10/2026); không đọc `installed_plugins.json` mỗi run |
| `enabledPlugins` có key của workflow khác (`superpowers@*` trong run BMAD; `bmad@*`, `bmad-method@*`, `bmad-toolbox@*` trong run Superpowers) | `blocked` (nạp chéo) |
| `enabledPlugins` có `bmad-method@*`, `bmad-toolbox@*` trong run BMAD | `blocked` (nạp song song với bản ghim) |
| Plugin khác trong `enabledPlugins` của `settings.json` đã commit | `project` |
| Run BMAD: `_bmad/scripts/**` giống từng byte bản ghim, đã commit sạch | `project` |
| Run BMAD: `_bmad/scripts/**` giống từng byte bản ghim, còn file chưa commit | `pinned` |
| Run BMAD: `_bmad/scripts/**` khác bản ghim (một byte, thừa/thiếu file, symlink) | `blocked` |
| Run BMAD: `_bmad/config.toml`, `_bmad/custom/**/*.toml` chưa track, bị ignore hay sửa dở | `blocked` |
| Run BMAD: `_bmad/**/*.user.toml` chưa track, bị ignore hay sửa dở | `blocked` (lớp cá nhân) |

**Đọc log khi run bị chặn:** run fail và stderr của nó có các dòng
`crew-workflow blocked: <đường dẫn> (<lý do>). <lệnh xử lý>`. Chạy đúng lệnh in ra trong worktree rồi retry.
`crew-mac doctor` (check `worktree-workflows`) quét trước mọi worktree cấp 1 dưới thư mục worktree: `fail` khi worktree
nào sẽ làm run thoát 78, `warn` khi chỉ có cảnh báo, kèm cùng lệnh xử lý.

- `không được git track trong worktree agent`: commit hoặc xóa đường dẫn đó trong worktree.
- `settings.local.json bật plugin hoặc hook`: bỏ `enabledPlugins`/`hooks` khỏi file đó.
- `WORKFLOW_SOURCE_MISMATCH`: thư mục ghim bị sửa (xóa rồi chạy `crew-mac setup`).
- `bị git ignore` hay `đã sửa so với commit`: làm theo lệnh in kèm (xem diff, `checkout HEAD --` hoặc commit).
- `thiếu bit thực thi`: chạy lại `crew-mac setup`.
- `không kiểm được git`: kiểm `/usr/bin/git` (Command Line Tools) và quyền TCC của git dir.
- `không phải bản ghim của workflow nào đã chứng nhận` hay `cần đúng một --plugin-dir`: sửa `adapterConfig.extraArgs`
  theo `crew-mac workflows list` (thư mục ghim) hoặc dòng `extraArgs` mà `crew-mac workflows install` in ra.
- `bật workflow <id> khác với workflow của run (nạp chéo)`: bỏ key đó khỏi `enabledPlugins` của
  `.claude/settings.json` rồi commit, hoặc giao issue cho agent của workflow `<id>`.
- `bật plugin <tên> ngoài bản ghim, nạp song song…`: bỏ key đó khỏi `enabledPlugins` rồi commit.
- `khác bản ghim BMAD; …`: xem `git status -- _bmad/scripts`; khôi phục bằng `git checkout HEAD -- _bmad/scripts`,
  hoặc xóa `_bmad/scripts` rồi chạy `crew-mac bmad setup-project`.
- `lớp cá nhân của BMAD chưa commit`: xóa file `*.user.toml` đó, hoặc commit nếu cả nhóm dùng.
- `run-init-check`: `nạp nhiều hơn một workflow` (repo hay user scope nạp thêm workflow khác) hoặc
  `không nạp workflow ghim nào` (thiếu `--plugin-dir`).

Bản sao wrapper trong fork Paperclip (`server/src/__tests__/fixtures/crew-claude-run.sh`) không có bước kiểm này. Test
H3 chỉ cần hợp đồng `pgid`/`started`.

**BMAD trong repo dự án** (`bmad/setup-project.ts`, `crew-mac bmad setup-project --root <dir>`):

1. Đã có `<root>/_bmad/scripts/resolve_config.py` thì in `crew-bmad setup: skipped (đã có _bmad/scripts)`, không làm gì
   (không update, không hạ cấp).
2. Bản ghim BMAD phải có và đúng checksum (thiếu: chạy `crew-mac workflows install`; lệch: `WORKFLOW_SOURCE_MISMATCH`).
3. Tìm `uv` bằng `/bin/sh -c 'command -v uv'` (PATH hiện tại cộng `~/.local/bin`); không có thì lỗi `thiếu uv trong PATH`.
4. `uv run --no-cache <pin>/skills/bmad/scripts/setup.py --project-root <root> --skill <pin>/skills/bmad
   --list-config-questions` (120 giây, `NO_COLOR=1`) in mảng JSON `{module, key, prompt, default}`. Bản ghim hiện tại
   trả `[]` (SP-0).
5. Câu trả lời = `default` của từng câu, riêng `communication_language`/`document_output_language` là `Vietnamese`; mọi
   câu qua `checkBmadAnswers` (luật port từ v2 `packages/shared/src/bmad-schemas.ts`: không khóa cá nhân `user_name`,
   `user_skill_level`, `communication_language` trừ khi cho phép ngôn ngữ; không khóa giống credential; module/khóa
   đúng định dạng; giá trị ≤ 500 ký tự, không ký tự điều khiển, không bắt đầu `/` hay `~`, không có đoạn `..`). Không
   đạt thì lỗi `câu trả lời BMAD không hợp lệ: <module>.<key>: <lý do>` và không chạy setup.
6. Chạy cùng lệnh không `--list-config-questions`. Chỉ khi có câu hỏi mới thêm `--module-answers <file>`: file TOML
   `[modules."<m>"]` ghi vào thư mục tạm ngoài repo, mode 0600, xóa ngay sau. Không câu hỏi mà vẫn truyền khóa thì
   `setup.py` thoát 1. Setup thành công không in gì: kết quả dựa vào mã thoát (khác 0 thì lỗi
   `setup.py lỗi (mã <n>): <dòng stderr cuối>`).
7. Xóa mọi `_bmad/**/*.user.toml` (lớp cá nhân). `_bmad/scripts` phải giống từng byte `<pin>/skills/bmad/scripts` (gồm
   `tests/`; bỏ `.DS_Store`, `__pycache__`, `*.pyc`), khác thì lỗi `script _bmad sau setup khác bản ghim`.
8. In `crew-bmad setup: ok files=<n>` rồi mỗi file một dòng: file chưa track hoặc đã đổi dưới `_bmad`
   (`git ls-files --others --modified --exclude-standard -- _bmad`, tính từ root). Bản ghim hiện tại tạo 12 file
   (`_bmad/config.toml`, 6 script, 5 test). Agent commit đúng các file này (`chore(bmad): dựng BMAD cho dự án`). Lỗi
   thì một dòng `crew-bmad setup: <câu>` và thoát 1; đối số sai thoát 2.

**Đọc file epic/story** (`bmad/epics.ts`, `crew-mac bmad stories`):

- Khuôn là `templates/epics-template.md` của `bmad-create-epics-and-stories`; heading và từ khóa giữ tiếng Anh, nội dung
  tiếng Việt được:
  - `## Epic N: <tên>`, đoạn văn đầu sau heading là `goal`. `### Epic N:` trong mục "Epic List" không tính.
  - `### Story N.M: <tên>`; `body` là toàn bộ markdown tới heading cấp 1–3 kế tiếp.
  - Sau dòng `**Acceptance Criteria:**`: mỗi dòng `**Given**` mở một tiêu chí, `**When**`/`**Then**`/`**And**` nối vào
    bằng `; ` (bỏ `**`), dòng thường nối tiếp bằng dấu cách; mỗi mục `- …` là một tiêu chí riêng.
  - CRLF, khoảng trắng cuối dòng được chuẩn hóa; heading trong khối ```` ``` ````/`~~~` bị bỏ qua.
- Câu vấn đề cố định: `không có "## Epic N: <tên>" nào`; `epic <n>: số thứ tự phải là <k>`;
  `epic <n>: tên rỗng hoặc dài hơn 200 ký tự`; `epic <n>: không có story nào`; `story <N.M> không nằm dưới epic nào`;
  `story <N.M> nằm dưới Epic <k>` (story đó không được tính); `story <N.M>: số thứ tự phải là <N.k>`;
  `story <N.M>: tên rỗng hoặc dài hơn 200 ký tự`; `story <N.M>: thiếu Acceptance Criteria`;
  `<n> story, vượt trần 30` (`BMAD_MAX_STORIES`).
- `--file` là đường dẫn tương đối trong `--root` (tuyệt đối), không có `..`, đuôi `.md`. Không `--rev`: đọc file trên
  đĩa (symlink hay trỏ ra ngoài root bị từ chối). Có `--rev` (đủ 40 hex, phải là commit): đọc blob ở commit đó bằng
  `git ls-tree -l` + `git show <rev>:./<file>` (so số byte, nên file không phải UTF-8 bị từ chối).
- `digest` = sha256 hex của bytes file. `scriptsMatchPin`: `_bmad/scripts` (trên đĩa, hoặc ở `--rev` qua
  `git ls-tree -r`) giống từng byte bản ghim (`compareBmadScripts`, bỏ rác); `null` khi không có `_bmad/scripts`;
  `false` khi khác, có symlink hay file không đọc được.
- `--json` in `{"digest","file","rev","scriptsMatchPin","epics","stories","problems"}`. Không `--json`: dòng
  `crew-bmad stories file=<file> epics=<n> stories=<m> digest=<64 hex> scripts=<match|mismatch|none>` rồi mỗi vấn đề
  một dòng `crew-bmad problem: <câu>`.
- Mã thoát: 0 khi không có vấn đề và `scriptsMatchPin !== false`; 3 khi có vấn đề hoặc script khác bản ghim; 2 khi đối
  số sai (đường dẫn tuyệt đối, `..`, không `.md`, `--rev` không phải 40 hex hay không phải commit, file không có); 1 lỗi
  git nội bộ. Đối số sai in `crew-bmad stories: <câu>` kèm cách dùng ra stderr.
- Agent BMAD comment dòng đầu `crew-bmad-result sha=<40 hex> file=<đường dẫn> epics=<n> stories=<m> digest=<64 hex>`;
  reviewer và Trợ Lý chạy lại `crew-mac bmad stories --rev <sha> --file <file> --json` và so `digest`.

**Thuật toán checksum cây:**

- Duyệt mọi file thường dưới thư mục gốc, bỏ entry `.in_use` ở cấp gốc.
- Gốc là symlink, có symlink hay loại file khác bên trong thì báo lỗi.
- Sắp đường dẫn tương đối (dấu `/`) theo byte. Với mỗi file nối `<đường dẫn>\0<sha256 hex của nội dung>\n`.
- Checksum là sha256 hex của toàn chuỗi.

Shell tương đương:

```bash
cd "$DIR" && find . -type f ! -path './.in_use/*' | LC_ALL=C sort | while IFS= read -r f; do
  printf '%s\0%s\n' "${f#./}" "$(shasum -a 256 "$f" | cut -d' ' -f1)"; done | shasum -a 256
```

**`extraArgs` đã được đo trên Mac mini** (claude 2.1.289, 07/10/2026). Với `--setting-sources project,local` và
`--plugin-dir <thư mục ghim>`:

- **Được nạp:**
  - Superpowers từ thư mục ghim. `system/init` có `plugins[]` với `source: "superpowers@inline"`, `path` là thư mục
    ghim, `version: "6.4.1"`.
  - Skill `.claude/` mà repo dự án commit.
- **Không nạp:** skill trong `~/.claude/skills`, plugin `enabledPlugins` user-scope và hook trong
  `~/.claude/settings.json`.
- **Không chặn được bằng `--setting-sources`:**
  - Skill và plugin dựng sẵn của CLI (`*@builtin`).
  - Connector MCP của tài khoản claude.ai (`source: "claudeai"`).
- Claude không ghi gì vào thư mục plugin khi chạy, kể cả hook SessionStart của Superpowers, nên checksum ổn định
  giữa các run.

**Owner nâng Superpowers ở `~/.claude` trước khi nâng pin:** agent không bị ảnh hưởng, vẫn nạp bản ghim kể cả
trong repo commit `enabledPlugins` superpowers. `doctor` (`superpowers-pin`) báo `warn` khi bản owner đang cài khác
bản ghim (hoặc không còn cài).

**Nâng bản BMAD:**

1. Chọn revision mới của `bmad-plugins`; sửa `BMAD_SOURCE.revision`, version trong `BMAD_PLUGIN_JSON` và `BMAD_PIN`.
2. Lắp thử (`git archive` hai cây, hợp vào `skills/`, thêm `plugin.json`), đo checksum bằng thuật toán trên và liệt kê
   file có bit `x` cho `executables`; cập nhật test `workflows-registry`.
3. Chạy `crew-mac workflows install` trên mọi Mac (bản mới nằm cạnh bản cũ).
4. `apply-roles.sh agent <id> bmad <thư mục ghim mới>` cho từng agent BMAD.

**Nâng bản Superpowers:**

1. Owner cài bản mới qua `/plugin`.
2. Sửa `SUPERPOWERS_PIN` (version, revision, checksum: chạy thuật toán trên thư mục cài; `executables`: file có
   bit `x` dưới `hooks/` và `skills/`) và cập nhật test pin.
3. Chạy `crew-mac setup` trên mọi Mac (thư mục ghim mới nằm cạnh bản cũ).
4. Cập nhật `adapterConfig.extraArgs` của mọi agent theo dòng setup in ra.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/crew-mac/src/workflows/install.ts` | Copy bản owner đã cài vào thư mục ghim | `installSuperpowersPin`, `readInstalledPlugins` |
| `apps/crew-mac/src/workflows/pin.ts` | Bản ghim, thư mục ghim, `extraArgs` | `WorkflowId`, `WorkflowPin`, `SUPERPOWERS_PIN`, `SUPERPOWERS_PLUGIN_KEY`, `pinDir`, `superpowersPinDir`, `agentExtraArgs` |
| `apps/crew-mac/src/workflows/bmad-pin.ts` | Nguồn và bản ghim BMAD | `BMAD_SOURCE`, `BMAD_PLUGIN_JSON`, `BMAD_PIN` |
| `apps/crew-mac/src/workflows/bmad-install.ts` | Lắp bản ghim BMAD từ marketplace hoặc clone https | `installBmadPin` |
| `apps/crew-mac/src/workflows/registry.ts` | Sổ workflow đã chứng nhận | `certifiedWorkflows`, `workflowForPluginDir`, `CertifiedWorkflow` |
| `apps/crew-mac/src/commands/workflows.ts` | Lệnh `workflows list|install` | `workflowsCommand`, `WORKFLOWS_USAGE` |
| `apps/crew-mac/src/commands/bmad.ts` | Lệnh `bmad stories|setup-project` | `bmadCommand`, `BMAD_USAGE` |
| `apps/crew-mac/src/bmad/epics.ts` | Đọc file epic/story BMAD | `parseEpics`, `BMAD_MAX_STORIES`, `BmadEpic`, `BmadStory`, `EpicsParse` |
| `apps/crew-mac/src/bmad/answers.ts` | Luật câu trả lời module (port v2) | `checkBmadAnswers`, `BMAD_PERSONAL_KEYS`, `BmadAnswer` |
| `apps/crew-mac/src/bmad/setup-project.ts` | Dựng `_bmad/` bằng `setup.py` của bản ghim | `setupProject`, `readScriptsDir`, `isBmadJunk`, `SetupProjectResult` |
| `apps/crew-mac/src/workflows/policy.ts` | So bản ghim | `samePin`, `assertSkillAllowed` |
| `apps/crew-mac/src/workflows/tree-checksum.ts` | Checksum cây | `treeChecksum` |
| `apps/crew-mac/src/workflows/inventory.ts` | Phân loại nguồn trong worktree theo workflow của run (nạp chéo, `_bmad/`) | `classifyOrigin`, `discoverSources`, `describeSource`, `compareBmadScripts`, `CROSS_WORKFLOW_REASON`, `PARALLEL_PLUGIN_REASON`, `BMAD_SCRIPT_MISMATCH_REASON`, `BMAD_PERSONAL_REASON`, `Origin`, `DiscoveredSource` |
| `apps/crew-mac/src/workflows/run-init.ts` | Kiểm `system/init` của run | `findInitEvent`, `selectInitWorkflow`, `checkInitEvent`, `BUILTIN_SKILLS`, `BUILTIN_AGENTS`, `PAPERCLIP_DYNAMIC_MCP` |
| `apps/crew-mac/src/commands/workflow-check.ts` | Lệnh `workflow-check`, `run-init-check` | `workflowCheck`, `runInitCheck` |
| `apps/crew-mac/assets/crew-claude-run.sh` | Wrapper gọi `workflow-check` trước run, ghi dấu `.in_use/<runId>` vào thư mục ghim (flow `mac-setup` giữ phần `pgid`/`started`) | — |

## Dữ liệu

- **Đọc:** `~/.claude/plugins/installed_plugins.json` và cây plugin owner đã cài (`installPath`). Không ghi gì dưới
  `~/.claude`.
- **Đọc (BMAD):** marketplace `~/.claude/plugins/marketplaces/bmad` bằng `git cat-file`/`git archive` (chỉ đọc), hoặc
  mạng tới `github.com` khi clone.
- **Ghi:** `~/.crew/workflows/superpowers/<version>-<rev12>/` và `~/.crew/workflows/bmad/<version>-<rev12>/` (mode thư
  mục cha 700; bản tạm `<dir>.tmp-<pid>` chỉ tồn tại trong lúc cài). Uninstall để nguyên các thư mục này, vô hại.
- **`workflow-check`:** ba lệnh `/usr/bin/git` cho cả worktree và chỉ đọc file trong worktree và thư mục ghim.
- **Wrapper ghi:** `<thư mục ghim>/.in_use/<runId>` = `<pid> <started epoch giây>\n` (ngoài checksum).
- **`bmad setup-project`:** chạy `uv` với `setup.py` của bản ghim (không mạng: script không có dependency), ghi
  `_bmad/` trong repo dự án, file câu trả lời tạm 0600 dưới thư mục tạm hệ thống (xóa ngay). **`bmad stories`:** chỉ
  đọc (file, `git ls-tree`/`git show`/`git cat-file`).
- **Mã thoát 78** (`EX_CONFIG`) là hợp đồng giữa wrapper và `workflow-check`/`run-init-check`.

## Flow liên quan

- `mac-setup`: `setup` cài hai bản ghim và in `extraArgs`; `doctor` có check `superpowers-pin`, `bmad-pin`, `agent-uv`;
  wrapper `crew-claude-run`.
- `mac-orphan-reaper`: đọc `pgid`/`started`. Run bị chặn ở bước kiểm workflow thì không có hai file này.

## Tests

- `apps/crew-mac/test/workflows-pin.test.ts`:
  - `treeChecksum` khớp thuật toán shell, `.in_use` chỉ bỏ ở gốc, từ chối symlink.
  - Hằng số pin, `agentExtraArgs`, `assertSkillAllowed`.
  - `readInstalledPlugins` với file thiếu hoặc hỏng.
  - `installSuperpowersPin`: copy đúng và lần hai không đổi; owner cài bản khác; cây owner bị sửa; thư mục ghim lệch
    checksum; bản tạm dở dang của lần trước và bản tạm cũ của pid khác; giữ và đặt lại bit thực thi.
- `apps/crew-mac/test/workflows-registry.test.ts`: `pinDir` theo workflow; `BMAD_SOURCE` chỉ https đúng repo và
  revision; `BMAD_PLUGIN_JSON` đúng byte; `BMAD_PIN` đúng số đo; sổ hai workflow, mặc định, runtime; `workflowForPluginDir`
  (hoa thường, `/` cuối, marketplace, cache owner); `pluginKeys`.
- `apps/crew-mac/test/workflows-bmad-install.test.ts` (repo git thật trong HOME giả, git/tar thật qua `FakeRunner`):
  lắp từ marketplace (checksum, `plugin.json`, bit x, không rác, không ghi thêm gì dưới `~/.claude`); lần hai không gọi
  git; marketplace đã sang commit mới; không có marketplace thì clone; trùng tên skill; thư mục ghim lệch checksum;
  bản tạm cũ; cả hai nguồn lỗi; cây tải về lệch checksum.
- `apps/crew-mac/test/workflows-command.test.ts`: `workflows list` (JSON và dòng, chưa cài, lệch checksum),
  `workflows install` (hai dòng `extraArgs`, không gọi `launchctl`/`sshd`, lỗi thoát 1), qua CLI và lệnh con lạ thoát 2.
- `apps/crew-mac/test/workflows-inventory.test.ts`: `classifyOrigin`; `discoverSources` trên repo git thật:
  - skill đã commit, skill hay agent chưa track;
  - rác hệ điều hành, `__pycache__`, file phụ trong skill đã commit không chặn; `SKILL.md` bị ignore hoặc chưa track
    thì chặn;
  - file nguồn nạp đang sửa dở; symlink trỏ ra ngoài và trong worktree;
  - hook (bỏ qua `.logs/` và file không phải script), `.mcp.json`;
  - `settings.local.json` bật hook hoặc chỉ có quyền; `settings.json` chưa track;
  - superpowers bật trong repo luôn `pinned` kể cả khi owner gỡ plugin, plugin khác là `project`;
  - theo workflow của run: run BMAD trên repo bật superpowers bị chặn nạp chéo; run Superpowers trên repo bật
    `bmad-method@bmad` bị chặn, superpowers vẫn `pinned`; run BMAD bật `bmad@*` là `pinned`, `bmad-toolbox@*` bị chặn;
  - `_bmad/` (run BMAD): `_bmad/scripts` giống byte đã commit (`project`), chưa commit (`pinned`), khác một byte, thừa
    file, symlink (chặn kèm lệnh); `config.toml` chưa track/sửa dở và `custom/*.toml` chưa track; `*.user.toml` chưa
    track, đã commit, sửa dở; `_bmad/memory/**`, `_bmad-output/**` không xét; run Superpowers bỏ qua `_bmad/`; repo chỉ
    có `_bmad` vẫn gọi git (giới hạn `_bmad`); `compareBmadScripts`;
  - git lỗi hoặc quá hạn; số lệnh git cố định; lệnh xử lý quote đường dẫn có dấu cách và nháy đơn (chạy thật lệnh `checkout`); worktree là thư mục con của repo; đường dẫn khác hoa thường (APFS);
  - sửa dở: `SKILL.md`/agent chỉ cảnh báo, `settings.json`/script hook chặn, kèm lệnh xử lý; nguồn chưa track kèm lệnh.
- `apps/crew-mac/test/workflow-check.test.ts`:
  - `workflowCheck`: sạch (dòng ok đủ `rev=`/`sum=`), thư mục ghim BMAD (dòng `pin=bmad@…`), run BMAD trên repo bật
    superpowers bị chặn còn run Superpowers cùng repo đạt, thư mục ghim BMAD sửa một byte, dấu `.in_use` không đổi
    checksum, `--plugin-dir` là cache owner (câu liệt kê hai thư mục ghim), thư mục ghim bị sửa, mất bit thực thi hoặc chưa cài, skill
    chưa track (dòng chặn kèm lệnh xử lý), `SKILL.md` sửa dở (ok kèm dòng `warn`).
  - `runInitCheck`: init sau dòng hook; skill cá nhân, plugin user-scope, Superpowers từ cache owner, agent lạ, MCP
    `user`; không nạp workflow ghim nào; superpowers chỉ từ cache; log không có init; plugin project và skill
    Paperclip được phép.
  - `runInitCheck` run BMAD: plugin `bmad` từ thư mục ghim và skill `bmad:*` đạt; thêm superpowers từ cache owner thì
    `nạp nhiều hơn một workflow`; plugin `bmad` từ marketplace khác checksum thì `WORKFLOW_SOURCE_MISMATCH`.
  - `runInitCheck` với `system/init` thật của run Paperclip (`test/fixtures/paperclip-run-init.json`, đã ẩn định
    danh): hai MCP Paperclip `dynamic` được phép; MCP `dynamic` khác tên hay tên Paperclip với nguồn khác bị chặn.
  - CLI: mã 0/2/78/1.
- `apps/crew-mac/test/crew-claude-run.test.ts` (flow `mac-setup` liệt kê đủ): câu lỗi khi số `--plugin-dir` khác một;
  dấu `.in_use/<runId>` (pid của `claude`, `started` của run), không ghi khi run id lạ, ghi lỗi không chặn run.
- `apps/crew-mac/test/bmad-epics.test.ts` (fixture `test/fixtures/bmad/epics-{ok,gap,wrong-epic,no-ac}.md`): file chuẩn
  (epic, goal, story, tiêu chí Given/When/Then/And, body); số story nhảy; story dưới epic khác (không tính hai lần);
  thiếu Acceptance Criteria; đúng 30 đạt, 31 vượt trần; không có epic; epic nhảy số, epic rỗng, story ngoài epic, tên
  rỗng/quá dài; heading trong khối code; CRLF và khoảng trắng cuối dòng; tiêu chí dạng danh sách và dòng nối tiếp.
- `apps/crew-mac/test/bmad-answers.test.ts`: khóa cá nhân, ngôn ngữ chỉ khi cho phép và là tên ngôn ngữ, khóa giống
  credential, khóa/module sai định dạng, giá trị tuyệt đối/`~`/`..`/ký tự điều khiển/quá 500 ký tự, `{project-root}`.
- `apps/crew-mac/test/bmad-setup-project.test.ts` (`uv` giả, git thật): đã có script thì skipped; thiếu uv; bản ghim
  chưa cài hoặc lệch checksum; không câu hỏi thì không `--module-answers`; có câu hỏi thì file TOML 0600 ngoài repo,
  ngôn ngữ `Vietnamese`, bị xóa sau; escape TOML; xóa `*.user.toml`; script khác bản ghim; default không đạt luật thì
  không chạy setup; danh sách câu hỏi hỏng; `setup.py` thoát khác 0.
- `apps/crew-mac/test/bmad-command.test.ts` (repo git thật): `stories` đọc đĩa (JSON đúng hợp đồng, `digest`,
  `scriptsMatchPin` null/match/mismatch, rác bị bỏ, symlink); `--rev` đọc theo commit không theo đĩa, scripts theo
  commit; `--root` là thư mục con; file lệch khuôn thoát 3; đối số sai thoát 2 (tuyệt đối, `..`, không `.md`, không
  có, `--rev` sai, không phải commit, file không có ở commit, symlink ra ngoài); `setup-project` in skipped/ok/lỗi;
  CLI chuyển lệnh `bmad`.
