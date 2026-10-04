# Phase06/T3-S6a — executor render BMAD ở gateway (unit)

Trạng thái: **DONE_WITH_CONCERNS, chờ independent review**. Lát S6a theo ruling 07:00 (`progress.md`), memo A4/A5/S6. Base `f4fc153`, nhánh `codex/crew-v2-server`, commit `d577085`. Không chạy `uv` thật, renderer thật, DB, provider hay network. Không chạm `workspace.ts`, `inventory.ts`, launch hay server (S6b).

## Thay đổi

- `v2/gateway/src/assistant/render-executor.ts` (mới): `createRenderExecutor({operations, uv, clock, timeoutSeconds?})` → `render({definition, projectRoot, attemptId, operationId})` → `{receipt}` | `{halt: true, reason}`.
  - Trước mọi effect: định nghĩa không có `render` → `RENDER_NOT_BMAD` (không gọi thao tác nào). Kiểm UUID, path tuyệt đối đã chuẩn hóa của `projectRoot`/`uv.path` (không ký tự điều khiển, `"`, `\`; tên thư mục project ASCII in được) → `RENDER_REQUEST_INVALID`. Chụp định nghĩa, gọi `validateRenderDefinition`, tính lại `customizationSha256` và `sha256` theo công thức adapter → `RENDER_DEFINITION_MISMATCH`. `projectRoot` phải là thư mục thật, bằng `realpath` của nó → `RENDER_PROJECT_ROOT_MISMATCH`. Đọc file được chọn + 7 layer trong workspace, không theo symlink ở mọi cấp, file thường một link, có giới hạn byte; so hash và vắng/có → `RENDER_INPUT_MISMATCH`. Bytes `uv` khớp SHA-256 đã ghi → nếu không `RENDER_UV_UNAVAILABLE`.
  - Chạy đúng một lần qua `OwnedOperations` (`absent` receipt/stage → `create` → `execute` → `remove`), stage `stages/render-{operationId}`; operation đã dùng → `RENDER_OPERATION_REUSED`. Lệnh: `/usr/bin/env UV_OFFLINE=1 UV_NO_CONFIG=1 UV_PYTHON_DOWNLOADS=never PYTHONDONTWRITEBYTECODE=1 /usr/bin/sandbox-exec -f {stage}/render.sb` + argv chính thức `uv run --no-cache {root}/_bmad/scripts/render_skill.py --project-root {root} --skill {root}/.claude/skills/bmad-build`. Profile: `(deny network*)`, chỉ ghi vào stage, `{root}/_bmad/render` và `/dev/null`. Timeout mặc định 60 s (1–120). Env riêng (HOME/XDG/TMPDIR trong stage, PATH cố định) do primitive cấp.
  - `EXECUTOR_LIFETIME_UNKNOWN` → `RENDER_LIFETIME_UNKNOWN`; lỗi helper khác → `RENDER_OPERATION_UNAVAILABLE`; hai trường hợp này giữ stage. `timedOut` → `RENDER_TIMED_OUT`; exit 127 → `RENDER_UV_UNAVAILABLE`; exit ≠ 0 → `RENDER_EXIT_NONZERO`. Stage chỉ thu hồi khi `execute` đã chứng minh process con đóng; thu hồi lỗi → `RENDER_CLEANUP_FAILED`.
  - `execution.log` (≤ 64 KiB, UTF-8 strict) phải đúng một dòng `read and follow {G}/workflow.md\n` (định dạng `render_skill.py:396` trong archive đã pin), `G = {root}/_bmad/render/bmad-build/{slug}-{sha256(root)[:12]}/{20 hex}`, `{G}/workflow.md` là file thường → nếu không `RENDER_STDOUT_MISMATCH`. Thư mục generation chỉ chứa `manifest.json` + đúng output; đọc lại input sau khi chạy; đưa toàn bộ bytes cho inspector D1 → lệch là `RENDER_ARTIFACT_MISMATCH`. Executor không ghi vào generation.
  - Receipt: `{kind: 'workflow_render_receipt', attemptId, data: {definitionSha256, customizationSha256, projectRoot, generationPath, inspection, witness: {uvPath, uvSha256, uvVersion, argv, exitCode, stdoutPath, startedAt, endedAt, operationId}}}` đúng A5.2. `witness.argv` là argv `uv` chính thức (không gồm lớp `env`/`sandbox-exec`). Không I/O tới server.
- `v2/gateway/src/assistant/render-artifacts.ts`: tách `checkDefinition` dùng chung cho `capture` (hành vi inspector không đổi, 23 test cũ vẫn pass) và export `validateRenderDefinition(definition, fileBytes?)` — cùng luật pin/cây chấp nhận/≤128 file/tên ≤512 chuẩn hóa/layer; có `fileBytes` thì thêm cap 16 MiB/file, 32 MiB tổng và tập path phải khớp đúng.
- `v2/gateway/src/assistant/workflow-manifest.ts`: D2 M2 — gọi validator với `entry.bytes` trước khi đọc bytes; `readPinnedFile` từ chối kích thước thật ≠ kích thước đã pin trước khi so hash. D2 M1 — script `_bmad/scripts/*.py` không phải file → `WORKFLOW_SKILL_MISMATCH`.
- Docs: `v2/docs/flows/assistant-workflows.md` (Điểm vào, bước 7 với 3 mục con, Files, Dữ liệu, Tests), `v2/docs/flows.yaml` (+ executor và test vào `assistant-workflows`), `v2/docs/files.md` sinh lại.

## Test double

`FakeOperations` trong `render-executor.test.ts` mô phỏng hợp đồng `OwnedOperations` thật (`operations.ts`, `operation-native.c`): `absent` ném khi tên tồn tại; `create` tạo `stages/{id}` 0700 độc quyền, trả identity; `execute` đòi đúng identity stage, timeout 1–120, lệnh tuyệt đối, ghi stdout/stderr gộp vào `stages/{id}/execution.log` (O_EXCL), ghi receipt độc quyền `receipts/{id}.json`, fork → `EXECUTOR_LIFETIME_UNKNOWN`, helper lỗi → `EXECUTOR_RECEIPT_MISSING`, timeout là receipt `timedOut` exit 137; `remove` chỉ xóa đúng identity. Process con là renderer giả theo hành vi `render_skill.py` (identity Python-canonical, đường dẫn generation, so byte và không ghi đè generation có sẵn, in entry). Định nghĩa được dựng qua chính adapter trên cây `bmad-build` tổng hợp không token với source pin BMAD 6.12.0 thật.

## Ánh xạ RED (unit) của memo S6

| RED | Test |
|---|---|
| Không spawn khi không phải BMAD | `refuses a non-BMAD definition without reserving or spawning anything` |
| Manifest/path lệch → không receipt | `halts when the printed generation does not match its measured bytes` (generation giả ở hash khác, output đổi/thừa/thiếu/symlink, layer đổi khi render); `refuses drifted workspace inputs before reserving or spawning` (6 biến thể); `refuses an inconsistent or unacceptable definition` |
| nonzero/timeout/unknown → HALT | `halts without a receipt on nonzero, unavailable, timed-out or unknown children` (6 case, kèm kiểm stage chỉ thu hồi khi vòng đời đã chứng minh) |
| stdout path lệch | `halts when stdout does not name exactly the rendered workflow entry` (9 biến thể) |
| projectRoot ≠ workspace → deny | `binds the project root to the canonical workspace directory` (alias symlink, root vắng, 5 dạng lexical sai). Đối chiếu với bản ghi workspace thật thuộc S6b. |
| Chạy một lần / không ghi đè | `runs the official uv argv once and returns the exact workflow render receipt`; `leaves an existing byte-identical generation untouched on a second render` (inode/mtime/bytes); `never runs one operation twice` |
| D2 M1/M2 | `workflow definition rejects a BMAD renderer script that is not a regular file with the stable code`; `workflow definition refuses a BMAD selection the render artifact inspector would reject` (128 ok, 129 → TOO_LARGE, tên 513 → MISMATCH); `render definition validator applies the inspector limits ...` |

## Chứng cứ

Mọi lần chạy Node/tsc giữ slot `$TMPDIR/crew-v2-heavy-slot.lock` (`owner=s6a`), telemetry `heavyEligible` đạt, `NODE_OPTIONS=--max-old-space-size=384`; slot nhả ngay sau mỗi lệnh.

| Bước | Lệnh (cwd `v2/gateway`) | Kết quả | Log SHA-256 |
|---|---|---|---|
| RED adapter | `node --test --test-name-pattern=... test/workflow-manifest.test.ts` | exit 1; M1 nhận `ELOOP` thô thay `WORKFLOW_SKILL_MISMATCH`, M2 "Missing expected rejection" — lỗi ngữ nghĩa | `task-3-s6a-red-manifest.log` `e495f358…5856` |
| RED executor | `node --test test/render-executor.test.ts` trên stub trả `NOT_IMPLEMENTED` | exit 1, 12/12 fail, toàn `AssertionError` (không lỗi import/compile) | `task-3-s6a-red-executor.log` `396a9f3c…03c5` |
| GREEN | `node --test test/render-executor.test.ts test/render-artifacts.test.ts test/workflow-manifest.test.ts test/sync.test.ts` | exit 0, **61/61 pass** (sync là consumer của adapter) | `task-3-s6a-green.log` `6fab03bc…e78c` |
| Typecheck / build | `tsc --noEmit`; `tsc -p tsconfig.build.json` (outDir tạm, đã xóa) | exit 0 / exit 0 | trong `task-3-s6a-green.log` |
| Biome | `biome check` 6 file (cwd `v2`) | 0 lỗi, 0 warning | — |
| Docs | mirror `git archive HEAD:v2` + overlay 8 file, `crew-docs generate` (cập nhật `files.md`), `check --all` ok, `check --staged` ok; hook commit `check --staged`/`--commit-msg` ok | ok | mirror đã xóa |

Lần GREEN đầu đã pass, không cần vòng sửa. Ghi chú TDD: `validateRenderDefinition` được viết trước test riêng của nó; RED ngữ nghĩa của phần này đến từ test adapter M1/M2 (chạy trước khi nối validator vào adapter). SHA-256 nguồn cuối: `render-executor.ts` `a888c47f…a7b8`, `render-artifacts.ts` `ab3d9d84…6cfa`, `workflow-manifest.ts` `cd1ece51…f046`.

## Concerns cho S6b / PM

1–2. **(Đã sửa ở fix round 1, theo chứng cứ đo của review.) Với cấu hình hiện tại, mọi render thật đều HALT, vì hai lý do độc lập.** (a) Thiếu interpreter: `render_skill.py` đã pin khai PEP 723 `requires-python = ">=3.11"`; `/usr/bin/python3` của CLT là 3.9.6; `uv` 0.12.13 chạy trong env của executor (`PATH=/usr/bin:/bin`, HOME trong stage, `UV_OFFLINE=1`, `UV_NO_CONFIG=1`, `UV_PYTHON_DOWNLOADS=never`) thoát mã 2 với `No interpreter found for Python >=3.11`. (b) Python là process con của `uv` (đã đo `getppid()`), nên primitive thấy `NOTE_FORK`, `execute` ném `EXECUTOR_LIFETIME_UNKNOWN`, executor dừng `RENDER_LIFETIME_UNKNOWN`. Vì primitive kiểm vòng đời trước exit code, nhánh (a) trên thực tế cũng báo `RENDER_LIFETIME_UNKNOWN`. Giả định D của memo ("`uv run --no-cache` không cần network khi Python đã có trên B", trung bình) **bị bác bỏ** với env hiện tại. Executor giữ fail-closed và không đổi argv. Đây là **phần chặn của S6b**: cần ruling S6b Q1 (process closure cho cây process có giới hạn) và Q2 (nguồn Python ≥3.11 cho `uv` mà không đổi argv) trước bất kỳ grant integration nào.
3. Profile sandbox `(allow default)` vẫn cho đọc mọi file; chỉ chặn network và ghi ngoài stage/`_bmad/render`. Hash `uv` rồi exec có khoảng TOCTOU, giống `runBmadInstaller`.
4. stdout bắt buộc đúng một dòng; mọi cảnh báo `uv` trên stderr (gộp vào log) sẽ HALT. Đây là fail-closed có chủ ý, cần đo lại với `uv` thật.
5. Chưa có bản ghi bền cho stage `render-*` (crash giữa chừng để lại stage không ai đối soát). Việc journal/reconcile thuộc S6b/T7.
6. `projectRoot ≡ workspace` mới chỉ kiểm canonical/realpath. Đối chiếu với bản ghi workspace của attempt thuộc S6b.

## Fix round 1 (review `task-3-s6a-review.md`)

Commit `d2ab486`. Mỗi mục có RED ngữ nghĩa trước: `task-3-s6a-fix1-red.log` (`682b08dc…5423`), 9 test fail, toàn `AssertionError` (receipt được trả thay vì HALT, thiếu `log`, sai mã), không lỗi import/compile. GREEN `task-3-s6a-fix1-green.log` (`4c7c2450…9d66`): **67/67 pass** (executor, render-artifacts, workflow-manifest, sync), typecheck exit 0; biome sạch; crew-docs `generate` (không đổi), `check --all`, `check --staged` ok. Mọi lần chạy giữ slot nặng (`owner=s6a`) và kiểm gate bằng parse JSON `heavyEligible`.

- **I1 — closure quanh renderer.** `checkClosure` chạy trước khi đặt chỗ (lỗi → `RENDER_INPUT_MISMATCH`, không gọi thao tác nào) và sau khi chạy (→ `RENDER_ARTIFACT_MISMATCH`). `_bmad/scripts/` phải đúng `{render_skill.py, config_utils.py}`; `_bmad/` chỉ có `scripts`, `render`, `custom` và layer config đã khai; `_bmad/custom/` chỉ có layer đã khai; thư mục skill đúng tập file được chọn. Symlink hay file đặc biệt bị từ chối (dùng `readdir` kiểu lstat). Test âm: `json.py`, `__pycache__/`, symlink trong scripts, file thừa trong skill (cả cấp con), file/thư mục lạ trong `_bmad`, `.gitignore` trong `_bmad/custom`, `_bmad/render` là symlink; và ba file thừa xuất hiện trong lúc render. Hệ quả cho S6b: materialization không được copy `_bmad/custom/.gitignore` hay thư mục `_bmad` khác của installer, nếu không executor sẽ dừng.
- **I2 — report.** Mục Concerns 1–2 đã sửa theo chứng cứ đo (xem trên).
- **M1 — lock bận.** `absent`/`create` lỗi: helper thoát 22 → `RENDER_OPERATION_REUSED`; 20 (flock `.operations.guard` bận) → `RENDER_OPERATION_BUSY`; khác → `RENDER_OPERATION_UNAVAILABLE`. Double ném lỗi kiểu execFile có `code` như `NativeHelper.run` thật.
- **M6 — chẩn đoán khi HALT.** Mọi HALT sau khi `execution.log` tồn tại trả `log: {sha256, firstLine}`, tính trước khi stage bị thu hồi. Digest là SHA-256 của cả log (≤64 MiB, đúng trần `RLIMIT_FSIZE`). Dòng đầu: path đã biết (`projectRoot`, stage, owned root, `uv`) thành nhãn, `NAME=value` thành `NAME={redacted}`, path tuyệt đối khác thành `{path}`, chỉ ASCII in được, ≤256 ký tự. HALT trước khi spawn không có `log`.
- **M3 — `uv` symlink.** `realpath(uv.path)` → file thật phải qua `lexicalPath`, ≤256 MiB (kiểm size trước khi đọc, đọc từng khối, phát hiện file lớn lên), hash khớp; chính path đã resolve được chạy và là `witness.argv[0]`; `witness.uvPath` giữ path đã ghi trong install report. TOCTOU giữa hash và exec vẫn còn (như `runBmadInstaller`).
- **M2 — stage canonical.** Trước khi đặt chỗ, owned root phải bằng `realpath` của nó và path stage phải qua `lexicalPath`; nếu không → `RENDER_OPERATION_UNAVAILABLE`, không gọi thao tác nào.

M4, M5, M7, M8 do PM ghi ledger cho S6b, không sửa ở đây.
