# Spike gói `upgrade` (S6)

## S6: Diễn tập nâng upstream Paperclip với toàn bộ phần Crew đi kèm

Thời điểm: 06/10/2026, 13:31 đến 13:37 (Asia/Ho_Chi_Minh). Chạy trên MacBook (máy dev), không đụng VPS, Mac mini hay server spike.

**Kết luận: ĐẠT** về kỹ thuật nâng (0 conflict ở file nguồn, 1 file test conflict giải trong khoảng 45 giây, test và typecheck xanh). **Cần owner xem lại ngân sách vá lõi**: nếu đếm mọi chỗ đụng lõi theo đơn vị logic thì là 6, vượt mức 5 của tiêu chí go; nếu chỉ đếm hook một dòng thì là 2 (hoặc 3, xem mục "Đếm chỗ vá").

### Bản upstream đích

- Base: tag `v2026.1001.0` = `8f8a0ab7e` (pin của nhánh `v3` trong fork).
- Không có stable nào mới hơn. Nguồn: `git fetch upstream --tags` (tag `v*` mới nhất vẫn là `v2026.1001.0`, chỉ có thêm `canary/v2026.1006.0-canary.2` đến `.10`), và `gh release list -R paperclipai/paperclip` trả `v2026.1001.0  Latest  2026-10-02T01:54:00Z`.
- Vì vậy dùng `upstream/master` = `f85820716` (2026-10-05 22:54 -0700, "Guard routine UUID lookups without narrowing valid inputs (#15313)"). Khoảng cách: 296 commit, 2200 file đổi, +192 760/−24 814 dòng.
- Upstream đổi mạnh đúng các file bị vá: `heartbeat.ts` +1954 dòng (tổng thay đổi), `issues.ts` 409, `environment-runtime.ts` 354, `claude-local execute.ts` 104, `execute.remote.test.ts` 101.

### Nhánh và commit (fork, chỉ cục bộ, không push)

Worktree tạm `<scratchpad>/upgrade-rehearsal`, detached tại `v2026.1001.0`, kiểm `git rev-parse --show-toplevel` trước mỗi lệnh ghi. Nhánh `spike/upgrade-rehearsal` (giữ lại làm bằng chứng, đỉnh `799f7173f`):

| SHA | Nội dung |
|---|---|
| `cbb214216` | cherry-pick `ce8c96206`: `claude_local` chạy `in_place` + SSH driver trả metadata `in_place` |
| `acb5678db` | cherry-pick `5f28832b2`: test |
| `32cd0675d` | cherry-pick `6ab1aa8c6`: `sessionCodec` giữ `remoteExecution` |
| `bccb870be` | cherry-pick `acfa0cffa`: H1 `crewBeforeClaim` + `crew-load-gate.ts` |
| `e849d304f` | A3: thêm `!canResumeSession &&` vào nhánh else-if thứ hai của log resume trong `execute.ts` |
| `a11750c15` | H2: một dòng `await crewCoreHooks.beforeIssueWrite({ tx, issueId: id, existing, patch, actorAgentId, actorUserId });` ở đầu `runUpdate`, registry no-op trong `server/src/services/crew-core-hooks.ts`, import ở cuối `issues.ts` |
| `071bb61ef` | D1: một dòng `await crewStopRemoteRunOnRelease(input);` ở đầu `releaseRunLease` của SSH driver, hàm no-op trong `server/src/services/crew-remote-stop.ts`, import ở cuối `environment-runtime.ts` |
| `5d94fd8ed` | Plugin rỗng `packages/crew-plugin/` (manifest `crew.core`, category `automation`, capability `issues.read`, worker `definePlugin({ setup() {} })`) và `crew/release/core-hooks.json` (7 mục, có `anchor` để script kiểm) |
| `6f15450ce` | Merge `upstream/master` `f85820716` |
| `799f7173f` | Thêm importer `packages/crew-plugin` vào `pnpm-lock.yaml` |

Cherry-pick 4 commit spike vào `v2026.1001.0` không conflict.

### Conflict khi merge

Lệnh: `git merge --no-ff --no-edit upstream/master`. Git tự merge `execute.ts`, `environment-runtime.ts`, `heartbeat.ts`, `issues.ts`.

- **1 file, 4 hunk conflict**, đều ở `packages/adapters/claude-local/src/server/execute.remote.test.ts`. **0 conflict ở file nguồn.**
- Nguyên nhân: cả hai bên cùng thêm test ở cuối `describe("claude remote execution")`. Upstream thêm test "reselects the full assignment and bootstrap guidance after a failed resume".

| Chỗ vá | File conflict | Hunk |
|---|---|---|
| H1 `beforeClaim` | 0 | 0 |
| H2 `beforeIssueWrite` | 0 | 0 |
| D1 dừng process khi trả lease | 0 | 0 |
| D2 metadata `in_place` của SSH driver | 0 | 0 |
| A1 `in_place` của `claude_local` (test của `ce8c96206`/`5f28832b2`) | 1 (test) | 2 (hunk 1 và nửa đầu hunk 2) |
| A2 codec (test của `6ab1aa8c6`) | cùng file test | 3 (nửa sau hunk 2, hunk 3, hunk 4) |
| A3 sửa log | 0 | 0 |
| Plugin rỗng, `core-hooks.json` | 0 | 0 |

Cách giải: lấy bản của upstream, chèn nguyên hai test của Crew ("runs in place at the authoritative root…", "resumes an in-place SSH session whose params went through the session codec") vào trước dấu đóng `describe`, và thêm lại `import { sessionCodec } from "./index.js";` (lần giải đầu làm rơi import này, phát hiện nhờ đối chiếu `git diff v2026.1001.0 HEAD`). Sau đó kiểm từng hook vẫn nằm đầu hàm (`claimQueuedRun`, `runUpdate`, `releaseRunLease` của SSH driver) và chạy kiểm `anchor` trong `core-hooks.json`: cả 7 mục có mặt.

### Thời gian

| Bước | Từ | Đến |
|---|---|---|
| Tạo worktree, cherry-pick, thêm vá (3)–(6), commit | 13:31:25 | 13:33:22 |
| Fetch upstream, chọn bản đích | 13:33:22 | 13:33:40 |
| Merge, giải conflict, commit merge | 13:33:40 | 13:34:26 (giải conflict khoảng 45 giây) |
| `pnpm install` | 13:34:32 | 13:34:55 (22,8 giây, store đã ấm) |
| Test và typecheck (kể cả build phụ thuộc) | 13:35:05 | 13:36:17 |
| Commit lockfile, gỡ worktree | 13:36:45 | 13:37:02 |

Tổng khoảng 6 phút máy. Lần nâng thật sẽ lâu hơn vì thêm smoke test trên Mac, backup DB và migrate bản sao (bước 3–4 của "Quy trình nâng Paperclip").

### Test và typecheck trên kết quả merge (`6f15450ce`, rồi `799f7173f` chỉ thêm lockfile)

Trước khi chạy: `memory_pressure` báo free 60%, load 4,16. `CI= corepack pnpm install --prefer-offline` (pnpm 9.15.4) thoát 0, chỉ có cảnh báo không tạo được bin vì `dist` của `paperclip-runner`/`plugin-sdk` chưa build.

| Lệnh | Kết quả |
|---|---|
| `corepack pnpm --filter @paperclipai/server exec vitest run src/adapters/plugin-loader.test.ts src/__tests__/workspace-realization-ssh-in-place.test.ts` (lần 1) | `plugin-loader` đạt; `workspace-realization-ssh-in-place` lỗi nạp: `Failed to resolve entry for package "@paperclipai/plugin-sdk"` (chưa có `dist`) |
| `corepack pnpm --filter @paperclipai/plugin-sdk ensure-build-deps` | Build `shared` và `plugin-sdk`, thoát 0 |
| Chạy lại lệnh vitest server | **2 file, 9 test đạt** |
| `corepack pnpm --filter @paperclipai/adapter-claude-local exec vitest run src/server/execute.remote.test.ts src/server/session-codec.test.ts` | **2 file, 18 test đạt** (gồm test `in_place`, test resume qua codec và test mới của upstream) |
| `corepack pnpm --filter @paperclipai/server exec tsc --noEmit` (lần 1) | 124 dòng lỗi, 0 lỗi nằm ở file bị vá; nguyên nhân là `@paperclipai/paperclip-runner` chưa build (29 dòng TS2307 thiếu module, phần còn lại là TS7006 kéo theo vì kiểu thành `any`) |
| `corepack pnpm --filter @paperclipai/paperclip-runner run build:typescript` | Thoát 0, không cần `cargo` (máy không có `cargo`) |
| `corepack pnpm --filter @paperclipai/server exec tsc --noEmit` (lần 2) | **Thoát 0, 0 lỗi** |
| `corepack pnpm --filter @paperclipai/adapter-claude-local exec tsc --noEmit` | **Thoát 0** |
| `corepack pnpm --filter @crew/paperclip-plugin exec tsc --noEmit` | **Thoát 0** |
| Kiểm manifest plugin Crew bằng `pluginManifestV1Schema.safeParse` (script tsx tạm trong `server/`, đã xóa) | `MANIFEST_OK crew.core` |

Không chạy full suite. A3 (sửa log) không có test riêng; nó chỉ đổi điều kiện in log.

Ghi chú về lockfile: `pnpm install` thêm importer `packages/crew-plugin` (commit `799f7173f`) và đồng thời xóa một dòng `cpu: [arm64, x64]` của `opencode-ai@1.18.34`. Dòng sau là nhiễu của pnpm cục bộ nên không commit. Khi làm thật, lockfile là nguồn conflict có thể gặp mỗi lần nâng; giải bằng cách lấy lockfile của upstream rồi chạy `pnpm install` lại.

### Đếm chỗ vá

Theo Global Constraints, "hook một dòng" là một dòng ở đầu hàm, import ở cuối file, có mục trong `core-hooks.json`.

| ID | Loại | File lõi | Kích thước trong lõi | Đúng khuôn hook một dòng? |
|---|---|---|---|---|
| H1 | hook một dòng | `server/src/services/heartbeat.ts` `claimQueuedRun` | 1 dòng + 1 import cuối file | Có |
| H2 | hook một dòng | `server/src/services/issues.ts` `runUpdate` | 1 dòng + 1 import cuối file | Có |
| D1 | vá driver | `server/src/services/environment-runtime.ts` `releaseRunLease` (SSH) | 1 dòng + 1 import cuối file | Có về hình thức (dòng đầu hàm, logic nằm trong module Crew). Có thể đăng ký lại thành hook H3 |
| D2 | vá driver | `environment-runtime.ts` (spread metadata trong `acquireRunLease`, sửa import) + `workspace-realization.ts` (hàm `sshLeaseWorkspaceRealization`, 13 dòng) | 2 dòng + 13 dòng | Không (nằm giữa object literal, thêm hàm trong file lõi) |
| A1 | vá adapter | `packages/adapters/claude-local/src/server/execute.ts` | 5 dòng | Không |
| A2 | vá adapter | `packages/adapters/claude-local/src/server/index.ts` `sessionCodec` | 10 dòng | Không |
| A3 | vá adapter | `execute.ts` | 1 dòng | Không (sửa điều kiện) |

- Hook một dòng có trong registry: **2** (H1, H2), hoặc **3** nếu xếp D1 là hook.
- Vá adapter/driver: **5** chỗ theo dòng (D1, D2, A1, A2, A3), hoặc **4** nếu D1 tính là hook.
- File lõi bị đụng: **6** (`heartbeat.ts`, `issues.ts`, `environment-runtime.ts`, `workspace-realization.ts`, `claude-local execute.ts`, `claude-local index.ts`).
- Theo đơn vị logic như cách owner đã chốt trong [can-dai-ca-chot.md](can-dai-ca-chot.md) (vá `in_place` là một khoản, codec là một khoản): H1, H2, `in_place` (A1+D2), codec (A2), dừng process khi trả lease (D1), sửa log (A3) = **6 khoản**.

So với tiêu chí go:
- S5 ≤ 3 hook: **đạt** (S5 cần 1 hook, H1).
- Tổng hook lõi ≤ 5: **đạt** nếu chỉ đếm hook một dòng (2–3). **Vượt 1** (6/5) nếu đếm mọi khoản đụng lõi như ngân sách owner đã ghi. Về lại 4 nếu upstream nhận A2 và A3 (cả hai là sửa bug thuần, đã ghi là ứng viên gửi upstream). Đây là câu hỏi cho owner ở S7.
- Chưa tính hook tùy chọn đầu `enqueueWakeup` (S4 Step 6), chỉ cần nếu muốn chuỗi issue tự kế thừa session.

### Rủi ro cho từng chỗ vá khi upstream đổi

| ID | Rủi ro | Mức | Cách phát hiện |
|---|---|---|---|
| H1 | `heartbeat.ts` đổi rất nhiều mỗi tuần (+1954 dòng trong 296 commit). Nếu upstream đổi tên/tách `claimQueuedRun` hoặc thêm đường claim khác (ví dụ claim theo batch), hook vẫn merge sạch nhưng có thể không còn phủ mọi đường claim | Trung bình | Script kiểm anchor + test "hook còn tồn tại"; đọc diff của `heartbeat.ts` quanh `claim` mỗi lần nâng |
| H2 | `runUpdate` là closure trong `issueService.update`; tên biến `existing`, `patch`, `actorAgentId` có thể đổi, hoặc upstream thêm đường ghi issue không qua `update` (ví dụ ghi thẳng bằng `tx.update(issues)`). Merge sạch nhưng chặn có thể có lỗ | Trung bình–cao | Typecheck bắt đổi tên biến; cần test hành vi của H2 (agent đổi `executionPolicy`, đóng `done` khi thiếu stage) chạy mỗi lần nâng |
| D1 | Upstream có thể tự thêm xử lý `cancelActiveWork` cho SSH driver (driver sandbox đã có). Khi đó vá thừa hoặc dừng process hai lần | Thấp | Đọc diff `createSshEnvironmentDriver`; nếu upstream đã làm thì gỡ D1 |
| D2 | SSH driver đang hardcode `copy`. Nếu upstream thêm hỗ trợ `in_place` cho SSH với cấu hình khác (ví dụ trong `parsed.config` thay vì `environment.metadata`), vá sẽ xung đột ngữ nghĩa | Trung bình | Test `workspace-realization-ssh-in-place.test.ts`; theo dõi PR upstream về SSH `in_place` |
| A1 | `execute.ts` của `claude_local` đổi đều (104 dòng lần này). Tham số `prepareAdapterExecutionTargetRuntime` (`workspaceRemoteDir`, `syncWorkspace`) có thể đổi tên | Trung bình | Typecheck và test `execute.remote.test.ts` |
| A2 | Nếu upstream thêm trường mới vào codec, vá vẫn merge được; rủi ro chính là upstream sửa bug theo cách khác và trùng | Thấp | `session-codec.test.ts`; gửi upstream để bỏ vá |
| A3 | Đoạn log có thể bị viết lại, conflict nhỏ | Thấp | Đọc conflict; gửi upstream để bỏ vá |
| Test của Crew trong file test của upstream | Đây là nguồn conflict duy nhất lần này: cùng thêm test ở cuối `describe` | Cao (gần như chắc chắn lặp lại) | Chuyển test của Crew sang file riêng, ví dụ `execute.remote.crew.test.ts`, `session-codec.crew.test.ts`, để không bao giờ conflict |
| Lockfile | Importer `packages/crew-plugin` và nhiễu do khác bản pnpm | Thấp | Lấy lockfile upstream, chạy `pnpm install` lại |

### Ghi chú môi trường cho quy trình nâng

- Script `typecheck` của server gọi `prepare:runner-vendor` (cần `cargo`). Trên máy không có Rust, chạy thay: `corepack pnpm --filter @paperclipai/plugin-sdk ensure-build-deps`, `corepack pnpm --filter @paperclipai/paperclip-runner run build:typescript`, rồi `corepack pnpm --filter @paperclipai/server exec tsc --noEmit`. Thiếu hai bước build thì tsc báo 124 dòng lỗi giả và test `workspace-realization-ssh-in-place` không nạp được.
- Hook `scout-block` của repo Crew chặn lệnh Bash có chữ `dist`; file có `dist` phải tạo bằng công cụ ghi file.

### Đề xuất nhịp nâng

**Nâng theo mỗi bản stable** (giữ mặc định của plan). Lý do: 296 commit trong 4 ngày sau stable mà chỉ có 1 file test conflict, giải trong dưới 1 phút; các hook một dòng và vá nhỏ merge sạch dù file bị vá đổi hàng nghìn dòng. Upstream ra stable khoảng 1–2 tuần một lần (`v2026.916.0`, `v2026.916.1`, `v2026.1001.0`), nên nâng theo tháng sẽ dồn 2–4 stable và làm diff của `heartbeat.ts`/`issues.ts` lớn hơn nhiều, khó đọc lại xem hook còn phủ đủ đường không. Việc tốn công nhất không phải conflict mà là đọc lại ngữ nghĩa quanh H1/H2 và chạy smoke test trên Mac.

Trước khi áp vào R1 nên làm:
1. Chuyển test của Crew sang file test riêng (bỏ nguồn conflict duy nhất).
2. Viết script kiểm anchor từ `core-hooks.json` (bản thử một dòng Python trong lần diễn tập này đã đủ dùng) và test "hook còn tồn tại" cho từng mục.
3. Gửi A2 và A3 lên upstream để giảm số khoản vá.
4. Chạy một lần thật khi upstream ra stable kế tiếp sau `v2026.1001.0`, vì lần này đích là `master` chứ không phải tag stable.

### Trạng thái sau S6

- Worktree tạm đã gỡ (`git worktree remove --force`, 13:37:02). Hai worktree spike cũ (`paperclip-in-place`, `paperclip-s5`) không đụng.
- Fork: nhánh `v3` vẫn `8f8a0ab7effbd6a0584107d8038736c134ee5047` (`git -C <fork> log -1 v3`), worktree chính sạch (chỉ có `.crew-setup/` chưa track như trước). Nhánh `spike/upgrade-rehearsal` giữ cục bộ tại `799f7173f`. `git fetch upstream --tags` cập nhật remote-tracking ref và tag canary trong fork; không push gì.
- Không có process nền nào còn chạy từ S6.
