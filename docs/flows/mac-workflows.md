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
- `crew-mac workflow-check --root <worktree> --plugin-dir <dir>`: wrapper `crew-claude-run` gọi trước mỗi run
  Paperclip. In `crew-workflow ok pin=superpowers@6.4.1 project=<n> pinned-dup=<n>` và thoát 0, hoặc mỗi nguồn bị
  chặn một dòng `crew-workflow blocked: <đường dẫn> (<lý do>)` và thoát 78. Đầu vào sai thì thoát 2.
- `crew-mac run-init-check --root <worktree> --log <file stream-json | ->`: kiểm sau run (nghiệm thu, điều tra), đọc
  dòng `system/init` của log run. Mã thoát giống `workflow-check`; log không đọc được thì thoát 1.

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
   - **Khe `pgid` muộn:** `pgid`/`started` giờ ghi SAU `workflow-check` (khởi động node, hai lệnh git, checksum 231
     file), thường muộn 0,3–2 giây. Trong khe này H3 `crew-mac stop-run` chưa thấy `pgid` và cũng chưa có `claude` để
     bắt, nên run có thể vẫn `exec claude` sau lệnh dừng; reaper dọn nó khi quá ngưỡng mồ côi (60 giây). `started`
     vẫn là thời điểm sinh process nên hợp đồng với reaper không đổi.
6. `apps/crew-mac/src/commands/workflow-check.ts` → `workflowCheck`:
   - `--plugin-dir` phải trỏ đúng thư mục ghim (so bằng `comparablePath`), không thì `không phải bản ghim`.
   - Thư mục ghim phải đúng checksum, không thì `WORKFLOW_SOURCE_MISMATCH`; file trong `executables` phải có bit
     thực thi, không thì `thiếu bit thực thi: …`.
   - Sau đó gọi `discoverSources`, có nguồn `blocked` nào thì chặn run.
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
     - Hai lệnh sau giới hạn trong `.claude` và `.mcp.json`. Worktree không có cả hai thì không gọi git. Trên checkout
       Crew và `my-crew` mất khoảng 50 ms.
8. `apps/crew-mac/src/commands/workflow-check.ts` → `runInitCheck`, với `apps/crew-mac/src/workflows/run-init.ts`:
   - `findInitEvent` lấy dòng `type=system, subtype=init` đầu tiên, không lấy dòng đầu: khi có hook SessionStart,
     dòng đầu là `system/hook_started`.
   - `checkInitEvent` so dòng đó với danh sách cho phép:
     - **plugin:** `*@builtin`; `superpowers` có `path` là thư mục ghim và đúng `version` (bắt buộc có). Một
       `superpowers` khác chỉ được phép nếu đúng version và checksum cây (khi nạp đôi); plugin `enabledPlugins` của
       `settings.json` đã commit cũng được phép.
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
| `enabledPlugins` của `settings.json` có `superpowers@*` | `pinned`: run chỉ nạp bản `--plugin-dir`, kể cả khi bản owner khác version (đo 07/10/2026); không đọc `installed_plugins.json` mỗi run |
| Plugin khác trong `enabledPlugins` của `settings.json` đã commit | `project` |

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
- `không phải bản ghim` hay `cần đúng một --plugin-dir`: sửa `adapterConfig.extraArgs` theo dòng `crew-mac setup` in ra.

Bản sao wrapper trong fork Paperclip (`server/src/__tests__/fixtures/crew-claude-run.sh`) không có bước kiểm này. Test
H3 chỉ cần hợp đồng `pgid`/`started`.

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
| `apps/crew-mac/src/workflows/policy.ts` | So bản ghim | `samePin`, `assertSkillAllowed` |
| `apps/crew-mac/src/workflows/tree-checksum.ts` | Checksum cây | `treeChecksum` |
| `apps/crew-mac/src/workflows/inventory.ts` | Phân loại nguồn trong worktree | `classifyOrigin`, `discoverSources`, `describeSource`, `Origin`, `DiscoveredSource` |
| `apps/crew-mac/src/workflows/run-init.ts` | Kiểm `system/init` của run | `findInitEvent`, `checkInitEvent`, `BUILTIN_SKILLS`, `BUILTIN_AGENTS`, `PAPERCLIP_DYNAMIC_MCP` |
| `apps/crew-mac/src/commands/workflow-check.ts` | Lệnh `workflow-check`, `run-init-check` | `workflowCheck`, `runInitCheck` |
| `apps/crew-mac/assets/crew-claude-run.sh` | Wrapper gọi `workflow-check` trước run (flow `mac-setup` giữ phần `pgid`/`started`) | — |

## Dữ liệu

- **Đọc:** `~/.claude/plugins/installed_plugins.json` và cây plugin owner đã cài (`installPath`). Không ghi gì dưới
  `~/.claude`.
- **Đọc (BMAD):** marketplace `~/.claude/plugins/marketplaces/bmad` bằng `git cat-file`/`git archive` (chỉ đọc), hoặc
  mạng tới `github.com` khi clone.
- **Ghi:** `~/.crew/workflows/superpowers/<version>-<rev12>/` và `~/.crew/workflows/bmad/<version>-<rev12>/` (mode thư
  mục cha 700; bản tạm `<dir>.tmp-<pid>` chỉ tồn tại trong lúc cài). Uninstall để nguyên các thư mục này, vô hại.
- **`workflow-check`:** gọi `/usr/bin/git -C <root> ls-files` cho từng nguồn và chỉ đọc file trong worktree.
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
  - git lỗi hoặc quá hạn; số lệnh git cố định; lệnh xử lý quote đường dẫn có dấu cách và nháy đơn (chạy thật lệnh `checkout`); worktree là thư mục con của repo; đường dẫn khác hoa thường (APFS);
  - sửa dở: `SKILL.md`/agent chỉ cảnh báo, `settings.json`/script hook chặn, kèm lệnh xử lý; nguồn chưa track kèm lệnh.
- `apps/crew-mac/test/workflow-check.test.ts`:
  - `workflowCheck`: sạch, `--plugin-dir` là cache owner, thư mục ghim bị sửa, mất bit thực thi hoặc chưa cài, skill
    chưa track (dòng chặn kèm lệnh xử lý), `SKILL.md` sửa dở (ok kèm dòng `warn`).
  - `runInitCheck`: init sau dòng hook; skill cá nhân, plugin user-scope, Superpowers từ cache owner, agent lạ, MCP
    `user`; thiếu bản ghim; log không có init; plugin project và skill Paperclip được phép.
  - `runInitCheck` với `system/init` thật của run Paperclip (`test/fixtures/paperclip-run-init.json`, đã ẩn định
    danh): hai MCP Paperclip `dynamic` được phép; MCP `dynamic` khác tên hay tên Paperclip với nguồn khác bị chặn.
  - CLI: mã 0/2/78/1.
