# Ghim Superpowers và chặn nạp skill chéo trên Mac

> Flow `mac-workflows`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-workflows` in ra đúng danh sách đó.

## Mục đích

Agent `claude_local` trên Mac chỉ được nạp đúng một bản Superpowers đã ghim. Bản ghim là bản owner đang cài
(`superpowers@claude-plugins-official` 6.4.1, revision `5bf4e78011075bcfc0dc295f0724994cd123ee71`), không phải bản V2
(6.4.2): agent dùng đúng workflow mà owner đang dùng. Run không bao giờ đọc thẳng cache plugin của owner, vì cache
đó đổi mỗi khi owner nâng plugin; run chỉ đọc một bản copy riêng có checksum cố định.

## Điểm vào

- `crew-mac setup` gọi `installSuperpowersPin` (flow `mac-setup`) rồi in `adapterConfig.extraArgs` cho agent.
- `crew-mac doctor` kiểm bản ghim (check `superpowers-pin`).
- `crew-mac workflow-check --root <worktree> --plugin-dir <dir>`: wrapper `crew-claude-run` gọi trước mỗi run
  Paperclip. In `crew-workflow ok pin=superpowers@6.4.1 project=<n> pinned-dup=<n>` và thoát 0, hoặc mỗi nguồn bị
  chặn một dòng `crew-workflow blocked: <đường dẫn> (<lý do>)` và thoát 78. Đầu vào sai thì thoát 2.
- `crew-mac run-init-check --root <worktree> --log <file stream-json | ->`: kiểm sau run (nghiệm thu, điều tra), đọc
  dòng `system/init` của log run. Mã thoát giống `workflow-check`; log không đọc được thì thoát 1.

## Các bước

1. `apps/crew-mac/src/workflows/pin.ts`: `SUPERPOWERS_PIN` giữ version, revision và checksum cây của bản ghim.
   `superpowersPinDir(home)` = `~/.crew/workflows/superpowers/<version>-<12 ký tự đầu của revision>`
   (hiện là `6.4.1-5bf4e7801107`). `agentExtraArgs(dir)` = `["--setting-sources","project,local","--plugin-dir",dir]`.
2. `apps/crew-mac/src/workflows/install.ts` → `installSuperpowersPin`:
   - Thư mục ghim có sẵn và đúng checksum thì không làm gì. Có sẵn mà lệch checksum (hoặc là symlink) thì báo lỗi,
     không ghi đè. Owner xóa tay rồi chạy lại setup.
   - Chưa có thì tìm trong `~/.claude/plugins/installed_plugins.json` (`readInstalledPlugins`) một entry
     `superpowers@claude-plugins-official` có đúng version, đúng `gitCommitSha` và cây đúng checksum.
   - Copy cây đó sang `<dir>.tmp-<pid>` (bỏ `.in_use` ở gốc), kiểm lại checksum rồi `rename` sang thư mục ghim.
     Copy hỏng thì xóa bản tạm.
3. `apps/crew-mac/src/workflows/tree-checksum.ts` → `treeChecksum`: checksum cây (thuật toán bên dưới).
4. `apps/crew-mac/src/workflows/policy.ts`: `samePin` và `assertSkillAllowed` (ném `WORKFLOW_SOURCE_MISMATCH` khi
   bản sắp nạp khác bản ghim).
5. **Wrapper** `apps/crew-mac/assets/crew-claude-run.sh`, khi có `PAPERCLIP_RUN_ID`:
   - Đếm `--plugin-dir <dir>` và `--plugin-dir=<dir>` trong tham số. Khác đúng một thì in `crew-workflow blocked: cần
     đúng một --plugin-dir…` và thoát 78.
   - Sau đó chạy `~/.crew/bin/crew-mac workflow-check --root "$PWD" --plugin-dir <dir>`, in ra stderr để vào log run.
     Lệnh này khác 0 hoặc không có `crew-mac` thì thoát 78.
   - Thoát 78 thì không chạy agent, không ghi `pgid`/`started`.
6. `apps/crew-mac/src/commands/workflow-check.ts` → `workflowCheck`:
   - `--plugin-dir` phải trỏ đúng thư mục ghim (so bằng `comparablePath`), không thì `không phải bản ghim`.
   - Thư mục ghim phải đúng checksum, không thì `WORKFLOW_SOURCE_MISMATCH`.
   - Sau đó gọi `discoverSources`, có nguồn `blocked` nào thì chặn run.
7. `apps/crew-mac/src/workflows/inventory.ts` → `discoverSources`: phân loại `.claude/{skills,agents,commands}/*`,
   `.claude/settings.local.json` và `.claude/settings.json` (kể cả từng plugin trong `enabledPlugins`) của worktree
   (`classifyOrigin`, bảng dưới). "Được git track" nghĩa là `git ls-files` có file dưới đường dẫn đó và
   `git ls-files --others` (kể cả file ignore) rỗng. Vì vậy thả thêm một file vào thư mục skill đã commit cũng bị
   chặn, còn sửa file đã commit thì không.
8. `apps/crew-mac/src/commands/workflow-check.ts` → `runInitCheck`, với `apps/crew-mac/src/workflows/run-init.ts`:
   - `findInitEvent` lấy dòng `type=system, subtype=init` đầu tiên, không lấy dòng đầu: khi có hook SessionStart,
     dòng đầu là `system/hook_started`.
   - `checkInitEvent` so dòng đó với danh sách cho phép:
     - **plugin:** `*@builtin`; `superpowers` có `path` là thư mục ghim và đúng `version` (bắt buộc có). Một
       `superpowers` khác chỉ được phép nếu đúng version và checksum cây; plugin `enabledPlugins` của
       `settings.json` đã commit cũng được phép.
     - **skill:** `BUILTIN_SKILLS` của CLI; tên skill `.claude/skills` đã commit; skill Paperclip (`SKILL.md` dưới
       `.paperclip-runtime`); `<plugin>:<skill>` của plugin được phép.
     - **agent:** `BUILTIN_AGENTS`; `.claude/agents` đã commit; `<plugin>:…`.
     - **mcp:** nguồn `claudeai` (connector tài khoản) và `project`.
   - Không xét `slash_commands`.
   - CLI nâng bản mà thêm skill dựng sẵn thì `run-init-check` báo `skill <tên>: không rõ nguồn`: thêm tên đó vào
     `BUILTIN_SKILLS`.

**Phân loại nguồn** (`classifyOrigin`, `discoverSources`):

| Nguồn | Origin |
|---|---|
| `--plugin-dir` = thư mục ghim, đúng checksum | `pinned` |
| Dưới `<root>/.paperclip-runtime/` (skill Paperclip qua `--add-dir`) | `paperclip` |
| `<root>/.claude/{skills,agents,commands}/*`, `<root>/.claude/settings.json` được git track | `project` (owner cho phép, O6) |
| Cùng các chỗ trên nhưng không được git track (hoặc có file chưa track bên trong) | `blocked` |
| `<root>/.claude/settings.local.json` có `enabledPlugins` hoặc `hooks`, hoặc không đọc được | `blocked` |
| `enabledPlugins` của `settings.json` có `superpowers@*` mà không bản cài nào trùng pin | `blocked` (`WORKFLOW_SOURCE_MISMATCH`) |
| `enabledPlugins` có `superpowers@*` trùng đúng pin | `pinned` (trùng bản, vô hại) |
| Plugin khác trong `enabledPlugins` của `settings.json` đã commit | `project` |

**Đọc log khi run bị chặn:** run fail và stderr của nó có các dòng `crew-workflow blocked: <đường dẫn> (<lý do>)`.

- `không được git track trong worktree agent`: commit hoặc xóa đường dẫn đó trong worktree.
- `settings.local.json bật plugin hoặc hook`: bỏ `enabledPlugins`/`hooks` khỏi file đó.
- `WORKFLOW_SOURCE_MISMATCH`: thư mục ghim bị sửa (xóa rồi chạy `crew-mac setup`), hoặc repo bật Superpowers bản
  khác (bỏ `enabledPlugins` đó hoặc nâng pin).
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

**Nâng bản Superpowers:**

1. Owner cài bản mới qua `/plugin`.
2. Sửa `SUPERPOWERS_PIN` (version, revision, checksum: chạy thuật toán trên thư mục cài) và cập nhật test pin.
3. Chạy `crew-mac setup` trên mọi Mac (thư mục ghim mới nằm cạnh bản cũ).
4. Cập nhật `adapterConfig.extraArgs` của mọi agent theo dòng setup in ra.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/crew-mac/src/workflows/install.ts` | Copy bản owner đã cài vào thư mục ghim | `installSuperpowersPin`, `readInstalledPlugins` |
| `apps/crew-mac/src/workflows/pin.ts` | Bản ghim, thư mục ghim, `extraArgs` | `SUPERPOWERS_PIN`, `SUPERPOWERS_PLUGIN_KEY`, `superpowersPinDir`, `agentExtraArgs` |
| `apps/crew-mac/src/workflows/policy.ts` | So bản ghim | `samePin`, `assertSkillAllowed` |
| `apps/crew-mac/src/workflows/tree-checksum.ts` | Checksum cây | `treeChecksum` |
| `apps/crew-mac/src/workflows/inventory.ts` | Phân loại nguồn trong worktree | `classifyOrigin`, `discoverSources`, `Origin`, `DiscoveredSource` |
| `apps/crew-mac/src/workflows/run-init.ts` | Kiểm `system/init` của run | `findInitEvent`, `checkInitEvent`, `BUILTIN_SKILLS`, `BUILTIN_AGENTS` |
| `apps/crew-mac/src/commands/workflow-check.ts` | Lệnh `workflow-check`, `run-init-check` | `workflowCheck`, `runInitCheck` |
| `apps/crew-mac/assets/crew-claude-run.sh` | Wrapper gọi `workflow-check` trước run (flow `mac-setup` giữ phần `pgid`/`started`) | — |

## Dữ liệu

- **Đọc:** `~/.claude/plugins/installed_plugins.json` và cây plugin owner đã cài (`installPath`). Không ghi gì dưới
  `~/.claude`.
- **Ghi:** `~/.crew/workflows/superpowers/<version>-<rev12>/` (mode thư mục cha 700). Uninstall để nguyên thư mục này,
  vô hại.
- **`workflow-check`:** gọi `/usr/bin/git -C <root> ls-files` cho từng nguồn và chỉ đọc file trong worktree.
- **Mã thoát 78** (`EX_CONFIG`) là hợp đồng giữa wrapper và `workflow-check`/`run-init-check`.

## Flow liên quan

- `mac-setup`: `setup` cài bản ghim và in `extraArgs`; `doctor` có check `superpowers-pin`; wrapper `crew-claude-run`.
- `mac-orphan-reaper`: đọc `pgid`/`started`. Run bị chặn ở bước kiểm workflow thì không có hai file này.

## Tests

- `apps/crew-mac/test/workflows-pin.test.ts`:
  - `treeChecksum` khớp thuật toán shell, `.in_use` chỉ bỏ ở gốc, từ chối symlink.
  - Hằng số pin, `agentExtraArgs`, `assertSkillAllowed`.
  - `readInstalledPlugins` với file thiếu hoặc hỏng.
  - `installSuperpowersPin`: copy đúng và lần hai không đổi; owner cài bản khác; cây owner bị sửa; thư mục ghim lệch
    checksum; bản tạm dở dang của lần trước.
- `apps/crew-mac/test/workflows-inventory.test.ts`: `classifyOrigin`; `discoverSources` trên repo git thật:
  - skill đã commit, skill chưa track, file lạ trong skill đã track;
  - `settings.local.json` bật hook hoặc chỉ có quyền;
  - `settings.json` chưa track;
  - plugin project đúng pin, lệch pin (`WORKFLOW_SOURCE_MISMATCH`), plugin khác.
- `apps/crew-mac/test/workflow-check.test.ts`:
  - `workflowCheck`: sạch, `--plugin-dir` là cache owner, thư mục ghim bị sửa hoặc chưa cài, skill chưa track.
  - `runInitCheck`: init sau dòng hook; skill cá nhân, plugin user-scope, Superpowers từ cache owner, agent lạ, MCP
    `user`; thiếu bản ghim; log không có init; plugin project và skill Paperclip được phép.
  - CLI: mã 0/2/78/1.
