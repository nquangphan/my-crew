# SP-4 report: sửa L2, L3 từ nghiệm thu AC-2

- **SHA:** `42a2503` trên nhánh `r1-2/crew-mac`. `crew-docs check --range a15e4fc..HEAD` ok (7 commit).
- **File:**
  - Sửa `apps/crew-mac/src/zshenv.ts`, `src/commands/setup.ts`, `src/commands/doctor.ts`, `src/workflows/run-init.ts`.
  - Test: sửa `test/zshenv.test.ts`, `test/setup.test.ts`, `test/doctor.test.ts`, `test/workflow-check.test.ts`; tạo `test/fixtures/paperclip-run-init.json`.
  - Docs: `docs/flows/mac-setup.md`, `docs/flows/mac-workflows.md`.

## L2: sshd agent không có `node`

- **Khối PATH:** `pathBlockBody(nodeDir)` ra `export PATH="$HOME/.local/bin:<nodeDir>:$PATH"`, với `nodeDir` đã escape cho chuỗi nháy kép.
  - `nodeDir` nằm trong PATH mặc định (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`) thì giữ dòng cũ.
  - `upsertPathBlock` và `hasPathBlock` nhận `nodeDir`. Setup ghi lại cả khối nên chạy lại không nhân đôi; `writeIfChanged` không ghi nếu nội dung không đổi.
  - `removePathBlock` và phần gỡ dòng PATH của spike không đổi.
- **Setup** dùng `dirname(ctx.nodePath)`. `ctx.nodePath` là `stableNodePath()`: `/opt/homebrew/bin/node` nếu có, không thì `process.execPath`. Đây là đúng node mà launcher và reaper dùng.
  - Lệch nhỏ so với chỉ đạo `dirname(process.execPath)`: trên Homebrew, `process.execPath` có thể là đường dẫn Cellar có số phiên bản, sẽ hỏng khi nâng node. Ví dụ đã nêu trong chỉ đạo (`/opt/homebrew/bin`) đúng là giá trị này cho ra.
- **Doctor:**
  - `zshenv-path` kiểm khối có đúng thư mục node hiện tại.
  - Check mới `agent-node` (sau `wrapper`) chạy `command -v node` qua chính sshd agent; không thấy node thì `fail` kèm gợi ý chạy lại setup.
  - Trong `checkCrewDocs`, `node … --version` mã 127 giờ báo `node không có trong PATH của sshd agent` và gợi ý chạy lại setup.
  - Gợi ý "Dời bundle…" chỉ hiện khi có vấn đề vùng TCC hoặc quá hạn. Gợi ý `install-hooks` chỉ hiện khi thiếu hoặc hỏng `crew-docs.bundle`/`runtime`.

## L3: `run-init-check` luôn thoát 78

- **Log thật** (4 log của AC-2: executor `01ffcc41`, reviewer, integrator `eae53d64`): `mcp_servers` = `Paperclip projects` và `Paperclip connections`, cả hai `status: connected`, `source: dynamic`. Tool của chúng là `mcp__Paperclip_projects__{create_project,create_task,list_project_repositories,list_projects}` và `mcp__Paperclip_connections__{connection_request,connections_search}`. Không có connector `claudeai` trong các run này.
- **Sửa:** thêm `PAPERCLIP_DYNAMIC_MCP` gồm đúng hai tên trên. Một MCP chỉ được phép khi nguồn là `claudeai`/`project`, hoặc nguồn là `dynamic` VÀ tên nằm trong danh sách này. Không mở toàn bộ `dynamic`.
- **Fixture:** `system/init` thật của run executor, đã ẩn định danh. `cwd` thành `__ROOT__`, đường dẫn và version plugin superpowers thành `__PIN__`/`__PIN_VERSION__`; `session_id`, `uuid`, socket, `memory_paths` thay bằng giá trị giả. `apiKeySource` vốn đã là `***REDACTED***`. Đã kiểm file không còn tên user thật.
- **Kiểm trên log thật (chỉ đọc):** chạy `runInitCheck` với `SUPERPOWERS_PIN` thật, root là worktree thật trong `~/crew-agents`. Cả 4 log ra `crew-workflow init ok: superpowers@6.4.1 từ bản ghim, 15 skill superpowers:*`.

## Test

- **RED** (test mới chạy trên `2ce11c9`), lệnh `pnpm --filter @crew/mac exec vitest run test/zshenv.test.ts test/setup.test.ts test/doctor.test.ts test/workflow-check.test.ts`:
  ```
  × thêm thư mục của node vào PATH (sshd agent cần node cho crew-docs); thư mục mặc định thì không
  × cài sshd phiên Aqua, key, PATH, thư mục worktree và manifest
  × hai MCP Paperclip tự gắn (source=dynamic) được cho phép, run sạch đạt
  × MCP dynamic khác tên, hoặc tên Paperclip mà nguồn khác dynamic, vẫn bị chặn
  × máy đã cài và khỏe thì mọi check đạt
  × agent-node: sshd agent không thấy node thì fail kèm cách sửa; khối PATH thiếu thư mục node thì zshenv-path fail
  × crew-docs: node của agent thoát 127 thì gợi ý sửa PATH, không gợi ý dời bundle
  Test Files  4 failed (4)   Tests  7 failed | 74 passed (81)
  ```
  - Test `agent-node` sau đó sửa lại cho dùng `dirname(process.execPath)`, vì `installed()` dùng node đang chạy test.
  - Fixture L3 thêm placeholder version, vì pin giả là 9.9.9.
- **GREEN:** 11 file (zshenv, setup, doctor, workflow-check, workflows-inventory, workflows-pin, crew-claude-run, cli, uninstall, stop-run, system) → `Test Files 11 passed (11)`, `Tests 172 passed (172)`. Typecheck và biome sạch.

## Giả định và việc cho lead

- Không chạy `setup`/`uninstall` thật. Khi lead cài lại, `~/.zshenv` sẽ đổi dòng PATH trong khối crew-mac thành `export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"`.
  - Sau đó có thể bỏ `adapterConfig.env.PATH` đã vá cho 3 agent. Bỏ là tùy chọn: để lại cũng không sao.
  - Kiểm bằng `crew-mac doctor`, check `agent-node` và `crew-docs` phải đạt.
- Sshd agent chạy lệnh qua zsh nên đọc `~/.zshenv`. Khối PATH sẵn có cho `~/.local/bin` cũng dựa vào điều này.
