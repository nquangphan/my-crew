# Worktree và kho skill, MCP của agent

> Flow `agent-workspace`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow
> agent-workspace` in ra đúng danh sách đó.

## Mục đích

Chuẩn bị nơi agent làm việc (một git worktree riêng mỗi ticket, có config chia sẻ nhưng cách ly khỏi checkout
chính) và biết agent trong đó có thể dùng skill/MCP server nào, để daemon cấp đúng `allowedTools` và đồng bộ
danh mục lên server. Cũng là cầu nối chạy `crew-docs` bên trong worktree và đồng bộ snapshot docs.

## Điểm vào

- `apps/daemon/src/git/worktree-manager.ts` → `ensureWorktree()` — được `JobRunnerDeps.workspace` (flow
  `agent-runs`) và probe inventory của `daemon.ts` (flow `daemon-runtime`) gọi.

## Các bước

1. `apps/daemon/src/git/worktree-manager.ts` → `ensureWorktree()`: tái dùng worktree đã có, hoặc branch đã có
   (`crew/<key>`), hoặc tạo `<repo>/.crew/worktrees/<key>` trên branch mới từ `base` (mặc định nhánh mặc định
   của project; QC dùng `head_sha` của report dev đã ghép cặp; probe dùng `detach: true` — worktree tách rời
   không tạo branch, key cố định `_probe`, giữ lại theo `apps/daemon/src/git/probe-worktree.ts`, xem bước 11).
2. `apps/daemon/src/git/worktree-manager.ts` → `detectSharedPaths()`: agent config thường không được track
   (`.claude`, `CLAUDE.md`, `AGENTS.md` mặc định, cộng `sharedPaths` chủ dự án khai trong project) — chỉ path
   tồn tại ở checkout chính **và chưa được git track** mới được coi là shared; path đã track thì worktree có
   bản riêng của nó, không link.
3. `apps/daemon/src/git/worktree-manager.ts` → `ensureWorktree()` (tiếp): mỗi shared path được symlink từ
   checkout chính vào worktree; `addExcludes()` thêm mục neo (không có `/` cuối, vì symlink không phải thư
   mục với git) vào `info/exclude` của **git dir chung** (`commonGitDir()`), nên `.crew/` và các symlink không
   bao giờ hiện trong `git status` ở bất kỳ worktree nào.
4. `apps/daemon/src/git/worktree-manager.ts` → `removeWorktree()`/`worktreeKeys()`: gỡ worktree (branch được
   giữ lại để PM accept merge theo `head_sha`); liệt kê key hiện có dưới `.crew/worktrees` để daemon sweep
   (flow `resource-hygiene`) và báo cáo tài nguyên.
5. `apps/daemon/src/skills/bmad-profile.ts` → `readBmadProfile()`: đọc `_bmad/_config/manifest.yaml` (phiên
   bản installer, module, `ides` là `tools`) của checkout chính cộng câu trả lời phạm vi nhóm trong
   `_bmad/config.toml` (bản 6.9+, chỉ bảng `[core]` và `[modules.*]` của module đã cài, bỏ `[agents.*]`) hoặc
   `_bmad/core/config.yaml` (bố cục 6.0); từ `_bmad/config.user.toml` (cá nhân) chỉ đọc `communication_language`.
   Không bao giờ đọc `_bmad/custom` hay `_bmad/memory`; bỏ câu trả lời cá nhân, key giống credential và đường
   dẫn tuyệt đối trước khi trả về `BmadProfile` (`packages/shared/src/bmad-schemas.ts`, flow `project-claims`)
   — daemon dùng nó để báo hồ sơ cài BMAD lên server (`daemon.ts` → `reportBmadProfile()`, flow
   `daemon-runtime`) cho tính năng "Cài BMAD" trên máy khác.
6. `apps/daemon/src/skills/skill-inventory.ts` → `probeInventory()`: mở một session Agent SDK **không gửi
   turn nào** (không tốn chi phí model) trong worktree probe, đọc `initializationResult().commands` (lệnh
   không phải built-in → skill kèm mô tả SKILL.md và nguồn project/user/plugin qua `skillsFromCommands()`) và
   `mcpServerStatus()` (`mcpServersFromStatus()`); daemon chạy hàm này ở worktree `_probe` rồi gửi
   `PUT /v1/daemon/skills`. Một run thật có skill lạ trong `system/init` (chưa có trong kho) kích hoạt probe
   lại (`onInit` trong `daemon.ts`).
7. `apps/daemon/src/skills/skill-inventory.ts` → `createToolLister()`: với MCP server stdio hoặc http/sse,
   kết nối trực tiếp qua MCP client để lấy mô tả từng tool (`listTools()`); server dạng connector chỉ giữ tên.
8. `apps/daemon/src/git/docs-kit-bridge.ts` → `installCrewDocs()`: chép bundle `crew-docs.cjs` (đóng gói cùng
   `@crew/docs-kit`) vào `~/.crew/bin` và viết wrapper shell `crew-docs` (`ELECTRON_RUN_AS_NODE=1`), để agent
   và hook luôn gọi một đường dẫn tuyệt đối cố định — dùng được từ cả CLI Node lẫn app desktop (Electron chạy
   như Node).
9. `apps/daemon/src/git/docs-kit-bridge.ts` → `runCrewDocs()`: chạy bundle với runtime tuyệt đối; các tool
   `docs_flow`/`docs_where` (flow `agent-runs`) gọi hàm này trong `cwd` của worktree.
10. `apps/daemon/src/git/docs-kit-bridge.ts` → `docsSnapshot()`: đọc cây `docs/` và `AGENTS.md` tại một commit
    của worktree, đóng gói cho `PUT /v1/daemon/projects/:key/docs` (đồng bộ docs lên server, flow
    `docs-sync-viewer` phía server).
11. `apps/daemon/src/git/probe-worktree.ts` → `ProbeWorktreeKeeper`: giữ worktree `_probe` của một project
    thêm `PROBE_WORKTREE_TTL_MS` (một giờ) sau lần probe gần nhất, để các lần probe gần nhau tái dùng cùng
    worktree thay vì tạo/gỡ liên tục. `used(projectKey, {arm})` ghi lại thời điểm probe (meta
    `probeWorktreeUsedAt:<projectKey>`) và đặt lại timer; `expire(projectKeys)` gỡ worktree đã quá giờ hoặc
    chưa từng ghi thời điểm (state DB cũ hơn luật này) — bỏ qua project đang có một probe chạy (worktree đó
    được `busy()` giữ), và đặt lại timer cho phần thời gian còn lại của project chưa tới hạn; `stop()` huỷ mọi
    timer đang chờ. `daemon.ts` (flow `daemon-runtime`) gọi `used()` sau mỗi probe và `expire()` trong mỗi
    `sweep()`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/daemon/src/git/worktree-manager.ts` | Tạo/gỡ worktree, link config chia sẻ | `ensureWorktree`, `removeWorktree`, `detectSharedPaths`, `worktreeKeys`, `git` |
| `apps/daemon/src/skills/skill-inventory.ts` | Đọc kho skill/MCP qua một phiên SDK không tốn turn | `probeInventory`, `skillsFromCommands`, `mcpServersFromStatus`, `createToolLister` |
| `apps/daemon/src/skills/bmad-profile.ts` | Đọc hồ sơ cài BMAD (`_bmad/`) của checkout chính | `readBmadInstall`, `readBmadProfile`, `BMAD_MANIFEST`, `BmadInstall` |
| `apps/daemon/src/git/docs-kit-bridge.ts` | Cầu nối chạy crew-docs và đồng bộ docs | `installCrewDocs`, `runCrewDocs`, `hookStatus`, `installHooks`, `docsSnapshot` |
| `apps/daemon/src/git/probe-worktree.ts` | Giữ rồi gỡ worktree probe theo TTL | `ProbeWorktreeKeeper`, `PROBE_WORKTREE_KEY`, `PROBE_WORKTREE_TTL_MS` |

## Dữ liệu

- Bảng: không sở hữu bảng nào; kết quả `probeInventory()` được `daemon.ts` lưu vào `meta` (`inventory:<key>`,
  flow `daemon-runtime`); thời điểm probe gần nhất của mỗi project cũng nằm ở `meta`
  (`probeWorktreeUsedAt:<key>`), do `ProbeWorktreeKeeper` ghi.
- Sự kiện: không phát/nhận sự kiện.
- Gọi ngoài: git CLI (worktree, `info/exclude`), Agent SDK (`query()` không gửi turn), MCP client trực tiếp
  tới server stdio/http/sse của project, `PUT /v1/daemon/skills` và `PUT /v1/daemon/projects/:key/docs` qua
  `VpsClient`.

## Flow liên quan

- agent-runs: `workspace()`/`releaseWorkspace()` của `JobRunner` gọi `ensureWorktree`/`removeWorktree`;
  `allowedToolsFor()` dùng kho inventory đã probe; `docs_flow`/`docs_where` gọi `runCrewDocs()`.
- daemon-runtime: `createDaemon()` gọi `probeInventory()`/`refreshInventory()` lúc khởi động và sau khi
  `system/init` thấy skill lạ; cài `crew-docs` qua `installCrewDocs()` lúc start; `daemon.ts` lắp
  `ProbeWorktreeKeeper` và gọi `used()`/`expire()`/`stop()` của nó theo vòng đời daemon.
- resource-hygiene: `worktreeKeys()`/`removeWorktree()` được dùng khi sweep worktree của ticket đã đóng và
  trong `resource_report`/`cleanup_resources`.
- docs-sync-viewer: `docsSnapshot()` là nguồn của `PUT /v1/daemon/projects/:key/docs` phía server.
- project-claims: `readBmadProfile()` trả về `BmadProfile` (`packages/shared/src/bmad-schemas.ts`), daemon gửi
  lên `PUT /v1/daemon/projects/:key/bmad-profile` qua `daemon.ts` → `reportBmadProfile()` (flow
  `daemon-runtime`).

## Tests

- `apps/daemon/test/worktree-manager.test.ts`: tạo `crew/<key>` từ base rồi tái dùng cả worktree lẫn branch;
  worktree QC bắt đầu đúng `head_sha` của dev và giữ `.crew` ngoài git; link agent config chưa track vào
  worktree, không bao giờ link path đã track, và `git status` không bao giờ thấy các link; checkout được một
  worktree probe tách rời không tạo branch; gỡ được thư mục còn sót mà git không còn biết.
- `apps/daemon/test/skill-inventory.test.ts`: ánh xạ lệnh sang skill kèm mô tả và nguồn, bỏ qua lệnh built-in;
  ghi nhận MCP server kèm nguồn, trạng thái và mô tả tool đọc qua MCP; probe một phiên không gửi turn nào và
  chấp thuận đúng server project được cấp.
- `apps/daemon/test/probe-worktree.test.ts`: giữ worktree một giờ sau lần probe cuối rồi timer tự gỡ; `expire()`
  gỡ worktree đã quá giờ (khởi động lại daemon, sweep) và giữ nguyên worktree còn trong hạn; gỡ worktree không
  có thời điểm probe ghi lại nhưng không đụng worktree một probe đang dùng; `stop()` huỷ mọi lượt gỡ đang chờ.
- `apps/daemon/test/bmad-profile.test.ts`: đọc đúng version/module/tools/ngôn ngữ/thư mục kết quả và câu trả
  lời nhóm của bản 6.10-6.12 lẫn bố cục 6.0; bỏ đường dẫn tuyệt đối, key giống credential và câu trả lời của
  module chưa cài; không bao giờ đọc `_bmad/custom`/`_bmad/memory` hay câu trả lời cá nhân; `null` khi không có
  manifest; daemon báo hồ sơ project mình sở hữu lên server mỗi lần probe, chỉ khi manifest đổi.
