# SP-3 report

- **SHA:** `efd03c5` trên nhánh `r1-2/crew-mac`. `crew-docs check --range a15e4fc..HEAD` ok (2 commit SP-2, SP-3).
- **File:**
  - Tạo `apps/crew-mac/src/workflows/inventory.ts` (`classifyOrigin`, `discoverSources`), `src/workflows/run-init.ts` (`findInitEvent`, `checkInitEvent`, `BUILTIN_SKILLS`, `BUILTIN_AGENTS`), `src/commands/workflow-check.ts` (`workflowCheck`, `runInitCheck`).
  - Sửa `src/cli.ts` (case `workflow-check`, `run-init-check`, help, mã 78) và `assets/crew-claude-run.sh`.
  - Test: tạo `test/workflows-inventory.test.ts`, `test/workflow-check.test.ts`; sửa `test/crew-claude-run.test.ts`.
  - Docs: `docs/flows.yaml` (chỉ flow `mac-workflows`), `docs/flows/mac-workflows.md`, `docs/flows/mac-setup.md`, `docs/index.md` và `docs/files.md` (sinh bằng `generate`).
- **RED:** `pnpm --filter @crew/mac exec vitest run test/workflows-inventory.test.ts test/workflow-check.test.ts test/crew-claude-run.test.ts`
  ```
  × gọi crew-mac workflow-check với worktree hiện tại và --plugin-dir rồi mới exec agent
  × nhận dạng --plugin-dir=<dir>
  × thiếu --plugin-dir thì exit 78, không chạy agent, không ghi pgid
  × hai --plugin-dir thì exit 78 (chỉ được nạp đúng bản ghim)
  × workflow-check từ chối hoặc không có crew-mac thì exit 78, không chạy agent
  FAIL test/workflow-check.test.ts  Cannot find module '../src/commands/workflow-check.js'
  FAIL test/workflows-inventory.test.ts  Cannot find module '../src/workflows/inventory.js'
  Test Files  3 failed (3)   Tests  5 failed | 6 passed (11)
  ```
- **GREEN:** 9 file (inventory, workflow-check, crew-claude-run, cli, workflows-pin, setup, doctor, uninstall, stop-run) → `Test Files 9 passed (9)`, `Tests 138 passed (138)`, chạy 2 lần liền đều đạt. Typecheck `@crew/mac` sạch, biome sạch. Không chạy `pnpm --filter @crew/mac build` (hook scout-block chặn chữ `build`); typecheck đã phủ `src`. Không chạy full suite.
- **Đo thật:** 1 lượt `claude -p --model haiku` trong `/private/tmp/claude-501/`, không có `PAPERCLIP_RUN_ID`, đã dọn cả transcript. Repo commit `enabledPlugins` superpowers cộng `--plugin-dir` chỉ nạp một superpowers (`@inline`). Kết quả ghi trong ledger.
- **Giả định:**
  - Skill Paperclip nằm dưới `<root>/.paperclip-runtime/**/SKILL.md`, bỏ `runs/`, tối đa 6 cấp; tên lấy từ thư mục và từ `name:` trong frontmatter.
  - Paperclip đặt cwd của run là worktree, vì wrapper dùng `$PWD`.
- **Lệch plan** (lý do ghi trong ledger):
  - Thêm `run-init-check` và `run-init.ts`.
  - "Được track" chặt hơn plan: thêm `ls-files --others`.
  - Wrapper đòi đúng một `--plugin-dir` và nhận cả dạng `--plugin-dir=`.
  - `settings.local.json` hỏng cũng `blocked`.
  - Lỗi đầu vào CLI đi qua `UsageError` (mã 2, in kèm cách dùng).
  - Test PGID của wrapper đổi `sleep(400)` cố định sang chờ file, vì chập chờn khi wrapper gọi thêm `workflow-check`.
- **Không đồng bộ** fixture wrapper của fork (đúng ruling của plan).
- **Còn mở:**
  - `BUILTIN_SKILLS` sẽ lỗi thời khi CLI nâng bản: `run-init-check` báo nhầm, không chặn run.
  - `.mcp.json` của repo mới được cho phép theo nguồn `project` trong init; `discoverSources` chưa phân loại nó.

## Sửa sau review

- **SHA:** `3a4b374`. `crew-docs check --range a15e4fc..HEAD` ok (3 commit).
- **M1:** `discoverSources` chỉ xét file nguồn nạp và bỏ qua rác.
  - Hai lệnh git cho cả cây: `ls-files -s -z` và `status --porcelain -z --ignored=matching --untracked-files=all`, cả hai có `--no-optional-locks` và giới hạn trong `.claude`, `.mcp.json`.
  - Ignored và untracked có lý do riêng, cả hai đều chặn.
  - Lệch chữ so với chỉ đạo: hook chỉ tính script (theo đuôi hoặc bit x), không phải file/thư mục chấm. Đo thật trên `/Volumes/CORSAIR/Projects/my-crew` (chỉ đọc), bản theo đúng chữ chặn nhầm `.claude/hooks/.logs`, nơi hook ghi `hook-log.jsonl` mỗi run. Ruling ghi trong ledger.
  - Sau khi sửa, quét chỉ đọc checkout Crew và `my-crew` ra 0 nguồn `blocked`, 38 nguồn, khoảng 35 ms mỗi repo.
- **M2:** đo 1 lượt haiku (ghi trong `spike-superpowers.md`, mục "Đo khác version"): chỉ bản `--plugin-dir` (`6.4.1-test`, `@inline`) được nạp.
  - Repo bật `superpowers@*` giờ luôn là `pinned`, bỏ `matchesPin`, không đọc `installed_plugins.json` mỗi run.
  - Doctor `superpowers-pin` báo `warn` khi bản owner khác pin.
- **m3:** file nguồn nạp đã track mà sửa dở hoặc mới `git add` thì chặn (`đã sửa so với commit`). Symlink đã track trỏ ra ngoài worktree thì chặn; trỏ trong worktree thì cho qua. `.claude` là symlink ra ngoài thì chặn. Đã quét thêm `.claude/hooks` và `.mcp.json` (kind `hook`, `mcp`).
- **m4:** git lỗi hoặc quá hạn thì chặn với lý do `không kiểm được git: <lỗi>`.
- **m5:** ghi khe `pgid` muộn 0,3–2 giây vào `mac-workflows.md` và `mac-orphan-reaper.md`.
- **RED** (test mới chạy trên `efd03c5`), lệnh `pnpm --filter @crew/mac exec vitest run test/workflows-inventory.test.ts test/workflows-pin.test.ts test/doctor.test.ts test/workflow-check.test.ts`:
  ```
  × rác hệ điều hành, __pycache__ và file không phải nguồn nạp trong skill đã commit không chặn
  × SKILL.md bị ignore hoặc chưa track thì chặn, kể cả trong thư mục skill đã commit
  × nguồn nạp đã track mà đang sửa dở thì chặn
  × symlink đã track trỏ ra ngoài worktree thì chặn; trỏ trong worktree thì cho qua
  × hook và .mcp.json chưa track thì chặn, đã commit thì là project
  × superpowers bật trong repo luôn là pinned (run chỉ nạp bản --plugin-dir), không đọc cài đặt của owner; plugin khác là project
  × settings.json không được track thì blocked
  × git lỗi hoặc quá hạn thì chặn với lý do "không kiểm được", không nói sai là chưa track
  × chỉ gọi git cố định số lần cho cả cây, không theo số nguồn
  × file thực thi của bản ghim mất bit x thì blocked
  × superpowers-pin: file thực thi mất bit x thì fail; bản owner khác pin thì warn
  (+ 4 test S1/S2 của workflows-pin)
  Test Files  4 failed (4)   Tests  15 failed | 62 passed (77)
  ```
  Trường hợp `.claude/hooks/.logs` được thêm vào test hook sau khi đo thật. Em không chạy RED riêng cho nó; bằng chứng là lần quét chỉ đọc `my-crew` với bản sửa đầu, ra `blocked` đúng đường dẫn `.claude/hooks/.logs` (lý do `bị git ignore`).
- **GREEN:** 9 file (inventory, workflow-check, crew-claude-run, cli, workflows-pin, setup, doctor, uninstall, stop-run) → `Test Files 9 passed (9)`, `Tests 150 passed (150)`. Typecheck và biome sạch.

## Sửa sau re-review

- **SHA:** `7ffc03a`. `crew-docs check --range a15e4fc..HEAD` ok (4 commit).
- **M3 (a):** `SKILL.md` và `.claude/agents|commands/*.md` đã track mà sửa dở chỉ cảnh báo: `DiscoveredSource.warning`; `workflow-check` thoát 0 kèm dòng `crew-workflow warn: …`.
  - `settings*.json`, script hook và `.mcp.json` sửa dở vẫn chặn 78.
  - Nguồn chưa track hoặc bị ignore, và symlink ra ngoài worktree, vẫn chặn với mọi loại nguồn.
- **M3 (b):** mỗi dòng in `<đường dẫn> (<lý do>). <lệnh>` qua `describeSource` / `DiscoveredSource.fix`:
  - sửa dở: `Xem: git -C <root> diff HEAD -- <file>; bỏ: git -C <root> checkout HEAD -- <file>, hoặc commit.`;
  - file mới `git add`: dùng `diff --cached` / `rm --cached`;
  - chưa track: `Xử lý: commit (git -C <root> add [-f] -- <file> rồi commit) hoặc xóa file đó.`
  - Doctor có check mới `worktree-workflows`, gọi sau `worktree-root`: quét `discoverSources` cho từng worktree cấp 1 dưới `worktreeRoot`, `fail` hoặc `warn`, hint là các lệnh xử lý. Danh sách "máy khỏe" đã thêm id này.
- **N3:** `readGit` dùng `rev-parse --show-prefix` và `ls-files --full-name`; porcelain của `status` vốn tính từ gốc repo.
  - Bản đầu dùng `--show-toplevel` rồi tự tính prefix. Quét thật chỉ đọc trên `~/Documents/projects/crew` thì hỏng: git trả `…/Projects/crew`, khác hoa thường do APFS, nên mọi nguồn thành `không kiểm được git`. Vì vậy em chuyển sang `--show-prefix`.
  - Có 2 test mới: worktree là thư mục con của repo, và đường dẫn khác hoa thường.
  - Worktree không có `.claude` lẫn `.mcp.json` thì không gọi git.
- **N2:** không sửa, lead đưa vào Cổng 4.
- **RED** (test mới chạy trên `3a4b374`), lệnh `pnpm --filter @crew/mac exec vitest run test/workflows-inventory.test.ts test/workflow-check.test.ts test/doctor.test.ts`:
  ```
  × skill chưa track trong worktree thì blocked kèm lý do
  × SKILL.md đã track mà sửa dở thì run vẫn chạy, in dòng warn kèm lệnh xem
  × SKILL.md và agent đã track mà sửa dở chỉ cảnh báo; settings.json và script hook sửa dở thì chặn
  × nguồn chưa track vẫn chặn, kèm cách xử lý
  × worktree là thư mục con của repo: đường dẫn git tính từ gốc repo vẫn khớp
  × máy đã cài và khỏe thì mọi check đạt
  × worktree-workflows: worktree sẽ bị chặn thì fail kèm lệnh xử lý; chỉ sửa dở SKILL.md thì warn
  Test Files  3 failed (3)   Tests  7 failed | 59 passed (66)
  ```
  Test "đường dẫn khác hoa thường" được thêm sau, khi quét thật phát hiện lỗi. Em không chạy RED riêng cho nó; bằng chứng là lần quét thật nói trên.
- **GREEN:** 9 file (inventory, workflow-check, crew-claude-run, cli, workflows-pin, setup, doctor, uninstall, stop-run) → `Test Files 9 passed (9)`, `Tests 155 passed (155)`. Typecheck và biome sạch.
  - Quét chỉ đọc checkout Crew và `my-crew`: 0 nguồn chặn, 0 cảnh báo, 38 nguồn, khoảng 50 ms.

## Sửa sau re-review 2

- **SHA:** `a520c16`. `crew-docs check --range a15e4fc..HEAD` ok (5 commit).
- **N4:** chuyển `shQuote` từ `doctor.ts` sang `src/system.ts` để dùng chung. Mọi lệnh xử lý trong `fileIssue` giờ quote `root` và đường dẫn file, ví dụ `git -C '<root>' checkout HEAD -- '<file>'`.
  - Test mới: worktree nằm trong thư mục có dấu cách và nháy đơn (`crew inv it's-…/work tree`), skill tên `my skill`. Test chạy thật lệnh `checkout` in ra bằng `/bin/sh -c`, rồi kiểm nguồn hết bị chặn.
  - Các test cũ có so lệnh xử lý đã cập nhật theo dạng có quote.
- **N5:** `checkWorktreeWorkflows` dừng ngay sau worktree đầu tiên có lý do chứa `git quá hạn` (hằng `GIT_TIMEOUT` trong `inventory.ts`), kèm dòng `git quá hạn ở <tên>, dừng kiểm các worktree còn lại (…)`. Ngoài ra có trần tổng 60 giây, giống `checkCrewDocs`.
  - Test mới: ba worktree, git giả quá hạn; kỳ vọng `fail`, có dòng dừng, và git chỉ được gọi cho worktree đầu.
- **RED** (test mới và test đã cập nhật chạy trên `7ffc03a`), lệnh `pnpm --filter @crew/mac exec vitest run test/workflows-inventory.test.ts test/workflow-check.test.ts test/doctor.test.ts`:
  ```
  × skill chưa track trong worktree thì blocked kèm lý do
  × SKILL.md đã track mà sửa dở thì run vẫn chạy, in dòng warn kèm lệnh xem
  × SKILL.md và agent đã track mà sửa dở chỉ cảnh báo; settings.json và script hook sửa dở thì chặn
  × lệnh xử lý quote đường dẫn có dấu cách và nháy đơn, chạy nguyên văn được
  × nguồn chưa track vẫn chặn, kèm cách xử lý
  × worktree-workflows: worktree sẽ bị chặn thì fail kèm lệnh xử lý; chỉ sửa dở SKILL.md thì warn
  × worktree-workflows: git quá hạn ở worktree đầu thì dừng, không kiểm các worktree còn lại
  Test Files  3 failed (3)   Tests  7 failed | 62 passed (69)
  ```
  - Fixture của test N5 sau đó được bổ sung `SKILL.md`: worktree chỉ có `.claude` rỗng thì không có nguồn nạp, nên không thấy lỗi git.
  - Em chạy lại RED riêng cho test N5, với `doctor.ts` của `7ffc03a`: fail đúng chỗ (`expected 'run trong worktree sẽ thoát 78: a: …' to contain 'dừng kiểm các worktree còn lại'`). Sau đó trả lại bản mới.
- **GREEN:** 10 file (inventory, workflow-check, crew-claude-run, cli, workflows-pin, setup, doctor, uninstall, stop-run, system) → `Test Files 10 passed (10)`, `Tests 161 passed (161)`. Typecheck và biome sạch.
