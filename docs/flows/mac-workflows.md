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

## Dữ liệu

- **Đọc:** `~/.claude/plugins/installed_plugins.json` và cây plugin owner đã cài (`installPath`). Không ghi gì dưới
  `~/.claude`.
- **Ghi:** `~/.crew/workflows/superpowers/<version>-<rev12>/` (mode thư mục cha 700). Uninstall để nguyên thư mục này,
  vô hại.

## Flow liên quan

- `mac-setup`: `setup` cài bản ghim và in `extraArgs`; `doctor` có check `superpowers-pin`.

## Tests

- `apps/crew-mac/test/workflows-pin.test.ts`:
  - `treeChecksum` khớp thuật toán shell, `.in_use` chỉ bỏ ở gốc, từ chối symlink.
  - Hằng số pin, `agentExtraArgs`, `assertSkillAllowed`.
  - `readInstalledPlugins` với file thiếu hoặc hỏng.
  - `installSuperpowersPin`: copy đúng và lần hai không đổi; owner cài bản khác; cây owner bị sửa; thư mục ghim lệch
    checksum; bản tạm dở dang của lần trước.
