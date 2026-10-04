# Phase06/T3 — Review lát S6b-ii (gateway) — spec + chất lượng + phase03-owner

Ngày 04/10/2026 (Asia/Ho_Chi_Minh). Nhánh `codex/crew-v2-server`, phạm vi `eb16cbd → 8689125`, chỉ ba commit của lát:
`b3ec7a8` (executor), `33a209f` (workspace/inventory), `8689125` (probe + sync). Các commit web/server khác trong range
(`531892b`, `accba5a`, `03150b9`, …) ngoài phạm vi. Chỉ đọc code tại `8689125`; không chạy lại suite (theo yêu cầu),
kết quả test dựa vào log trong báo cáo. Căn cứ: `pm-s6b-rulings-memo-261004.md` (Q2–Q7, N1, mục 6), `progress.md`
09:30 / 12:05 / 13:05.

### Spec Compliance

| Yêu cầu | Kết quả | Bằng chứng |
|---|---|---|
| Executor dùng `executeTree` | ✅ | `render-executor.ts` `RenderOperations` Pick `executeTree`; lời gọi `operations.executeTree(...)` |
| `UV_PYTHON=<realpath>` từ prerequisite, argv không đổi | ✅ | env layer thêm `UV_PYTHON=${pythonExecutable}`; `pythonExecutable = verifyExecutable(python)` (realpath === recorded realpath + SHA-256 ≤256 MiB) |
| Python sha lệch → không spawn | ✅ | `guard('RENDER_PYTHON_UNAVAILABLE', …)` trước `create`; test `isolation-render.test.ts:358` |
| `witness.python = {path, sha256, version}` | ✅ | `measure()` witness |
| `EXECUTOR_BUSY` / `EXECUTOR_GUARD_INVALID` không giữ stage | ✅ ⚠️ | `abandon()` (`:762`) thu hồi ngay; nếu chính `remove` cũng bận thì stage còn ở `complete` và được cleanup thu hồi sau — xem ⚠️4 |
| N3: `absent(.leader)` trước spawn, xóa `.leader` khi reclaim | ✅ | `absent('receipts', '${stageName}.leader')`; `reclaimRenderStage` → `removeLeader` (`:568-590`) |
| Q6 digest + dòng đầu/cuối đã lọc; R1/R2/R3 | ✅ | `logLines`, `sanitizeLine` (`labelSuffix`, `credentialName`), `closureStamps` mở rộng file + root/.claude |
| Materialize đúng tập N1 (2 script + layer có mặt + cây bmad-build, file thường; không memlog/resolve_*/.gitignore) | ✅ | `materializeRenderInputs` (`workspace.ts`) chỉ lặp `selectedProjectionSha256` + `layers` ≠ null; test `:226-247` khẳng định không có 4 file cấm |
| Render trước audit `after`; injected gồm `_bmad/render` cả khi HALT | ✅ | `workspace.ts:687-711`; `record.injected` được `put` trước render; catch ghi `retained` + `render.halt`; test `:305-322` |
| Bản ghi bền `render-{op}` + ngưỡng 1 → `RENDER_RECONCILE_REQUIRED` | ✅ ⚠️ | `renderJournal().blocked()`; `reconcileRenders()` lúc `open`; test `:423` — xem ⚠️1 |
| `verify` từ chối render chưa chứng minh | ✅ | `PROCESS_CLOSURE_UNVERIFIED` khi có render không `complete`/`deleted` |
| Install report `prerequisites.{uv,python}` đo bằng `uv python find --script …` trong env owner (path, realpath, sha256 trên realpath, version) | ✅ ⚠️ | `probeRenderPrerequisites` (`:1042`); opt-in qua `SyncOptions.prerequisites` — xem ⚠️2 |
| **Mặc định từ chối khi owner checkout track `_bmad/`** (memo mục 4, PM 13:05) | ❌ | Không có `BMAD_TRACKED_IN_CHECKOUT` trong `gateway/src`; `_bmad` tracked bị exclude rồi thay bằng tập con; test chính (`isolation-render.test.ts:133,174`) còn mã hóa hành vi này như kỳ vọng — xem Issue I1 |
| Non-BMAD prepare không đổi | ✅ | `injected` undefined → `declaration()` trả null; UUID check chỉ khi có render; test xác nhận không có `injected`/`render` |

### Security trace

- **Path traversal / symlink — nguồn copy.** `readPinnedInput` `lstat` từng cha (phải là thư mục, không symlink), mở file cuối `O_NOFOLLOW|O_NONBLOCK`, yêu cầu file thường, `nlink === 1`, ≤16 MiB, đọc đủ `size`, rồi so SHA-256 với pin. Cửa sổ lstat→open tồn tại nhưng nguồn là projection immutable trong registry của chính gateway → chấp nhận.
- **Path traversal / symlink — đích.** Path phải `posix.normalize`-ổn định, không phần rỗng/`.`/`..`, charset `[A-Za-z0-9._/-]`, prefix `_bmad/` hoặc `.claude/skills/bmad-build/`. Thư mục tạo bằng `mkdir` không recursive (EEXIST nếu có sẵn — kể cả symlink), file `O_CREAT|O_EXCL|O_NOFOLLOW`. Không thoát được workspace.
- **TOCTOU materialize → render → audit.** Giữa các bước không có tiến trình ngoài nào chạy trong workspace (git đã xong, toàn bộ nằm trong `store.transaction`). Renderer bị Seatbelt chặn ghi ngoài stage và `_bmad/render`; `closureStamps` (dev/ino/mtime/ctime/size cho file + thư mục) bắt cả sửa-rồi-hoàn; audit `after` so bytes từng file đã khai (`INJECTED_BYTES`), cấm symlink, file lạ (`UNDECLARED_INJECTION`), thiếu (`INJECTED_MISSING`). Đủ.
- **Owner data loss ("dời file owner").** Đã kiểm `workspace.ts:671-680`: `rename(join(workspace, entry.path), base/excluded/...)` thao tác trên **bản clone do Crew sở hữu** dưới `operations/stages/{op}/workspace`, không chạm checkout của owner. Không có mất dữ liệu trực tiếp. Rủi ro thật là gián tiếp: runtime thấy file `_bmad` tracked bị xóa và thay bằng tập con; một `git add -A && commit` của agent sẽ đưa "xóa `_bmad` của owner" vào nhánh kết quả. Đó chính là lý do ruling yêu cầu từ chối (I1).
- **Env leakage vào `UV_PYTHON`.** Giá trị là realpath đã khớp bản ghi, qua `lexicalPath`; đi vào `/usr/bin/env` như một phần tử argv riêng nên không có injection. Probe dùng `process.env` của gateway cho `uv`/Python của chính owner — cùng uid, cùng lớp "đọc metadata" đã chấp nhận ở phase04; output chỉ là path/version một dòng ASCII, không gửi env ra ngoài.
- **Prerequisite spoofing.** Lúc chạy, executor xác minh `realpath(path) === realpath` đã ghi và SHA-256 trên realpath cho cả `uv` lẫn Python → binary bị thay sau report thì HALT trước spawn (fail-closed). `version` là pass-through không đo lại (đúng Q2/N4). Gateway không tự ràng buộc `render.prerequisites` truyền vào `prepareWorkspace` với lần đo của chính nó; ràng buộc đó thuộc server ở S6b-iii (so `witness.*sha256` với `gateway_applied`) — xem ⚠️3. Cửa sổ hash→exec của Python cùng lớp với M3 của `uv` đã chấp nhận.
- **Journal crash consistency.** `reserved` trước `create`, `pending` sau, `complete`/`unknown`/`deleted`. Crash ở bất kỳ điểm nào để lại `reserved`/`pending` → `open()` chuyển `unknown` → chặn. Ghi `pending` lỗi → `abandon` thu hồi, không spawn. Ghi `complete` lỗi sau spawn → thu hồi + HALT, bản ghi còn `pending` → `unknown` lần mở sau. Fail-closed ở mọi nhánh đã đọc.
- **Reconcile threshold bypass.** `createRenderExecutor` chỉ có một caller (`workspace.ts:694`) và journal là tham số bắt buộc; `blocked()` đọc trong cùng `store.transaction` với prepare/cleanup, store khóa độc quyền một tiến trình. Không tìm thấy đường vòng.
- **Diagnostics.** Path đã biết (project root, stage, operations root, uv/python path + realpath) thành nhãn, đuôi chỉ giữ `[A-Za-z0-9._/-]`; mọi `/…`/`~/…` khác thành `{path}`; credential `name[:=]value`, `NAME=value`, `Bearer` bị che; ASCII in được, ≤256 ký tự. Phần dư: tên người dùng/hostname xuất hiện ngoài dạng path vẫn lọt — chấp nhận, đã ghi là "untrusted text".

### Phase03-owner verdict

`workspace.ts`/`inventory.ts` transfer: **chấp nhận có điều kiện**. Đường non-BMAD giữ nguyên ngữ nghĩa (khai báo `injected` vắng → `declaration()` null; `renders()` rỗng nên `verify`/`cleanup` không đổi; `open()` chỉ thêm một transaction chuyển trạng thái record `isolation-render`). Materialize nằm sau exclusion và trước audit `after` đúng Q5; khai báo injected đúng Q3 (copy, không symlink, `_bmad/render` cả khi HALT). Điều kiện: sửa I1 (từ chối `_bmad` tracked trước exclusion) và cập nhật fixture/test tương ứng. M3 (cleanup kẹt) nên sửa cùng lượt vì nằm trong `cleanupWorkspace` của phase03.

### Strengths

- Một nguồn sự thật cho tập materialize (`definition.render`), không có danh sách thứ hai; khớp đúng `checkClosure`.
- Audit injected chặt: khai báo theo file + digest, root-scoped `UNDECLARED_INJECTION`, `INJECTED_MISSING` sau duyệt.
- Mọi nhánh lỗi của executor đều có trạng thái journal xác định và mặc định fail-closed.
- Test workspace dùng Git thật + `executeTree` thật, double `uv` chỉ render khi `UV_PYTHON` đúng — test có nghĩa, không phantom.

### Issues

#### Critical

Không có.

#### Important

**I1 — `_bmad` tracked trong checkout owner bị exclude và thay thế thay vì bị từ chối** — `v2/gateway/src/isolation/workspace.ts:671-680, 686-691`; `v2/gateway/test/isolation-render.test.ts:133, 174-176`.
- Cái gì: Khi owner track `_bmad/**`, prepare BMAD dời nó vào `excluded/` của clone rồi materialize tập con lên cùng chỗ. Không có `BMAD_TRACKED_IN_CHECKOUT`. Fixture chính của test còn khẳng định hành vi này là đúng.
- Vì sao: Memo mục 4 + PM 13:05 chốt "mặc định từ chối, không được dời `_bmad` của owner". Runtime thấy file tracked bị xóa/đổi → `git status` bẩn; agent commit `-A` sẽ đẩy việc xóa `_bmad` của owner vào kết quả.
- Sửa: Trong `prepareWorkspace`, khi `render !== undefined`, ngay sau `before` audit và trước vòng exclusion: `if (before.entries.some((e) => e.path === '_bmad' || e.path.startsWith('_bmad/'))) throw new Error('BMAD_TRACKED_IN_CHECKOUT')` (clone vừa qua `CLONE_NOT_CLEAN` nên mọi entry đều là tracked). Đổi fixture chính sang owner không track `_bmad` (giữ `.claude/settings.json` nếu muốn phủ exclusion), thêm test RED: owner track `_bmad/legacy.toml` → reject `BMAD_TRACKED_IN_CHECKOUT`, workspace `retained`, không có file materialize, không có bản ghi `render-*`. Cập nhật `docs/flows/gateway-workflows.md`.

#### Minor

**M1 — Lỗi `registry.resolve` trong `GatewaySync.prerequisites` làm hỏng cả slot thay vì chỉ bỏ trường** — `v2/gateway/src/sync/gateway-sync.ts:147-148`. `resolve` nằm ngoài `try`; exception lan lên catch của slot → slot thành lỗi, trái docstring "A failure only omits the field". Sửa: đưa `resolve` vào trong `try`.

**M2 — Probe không đặt `cwd`, khám phá interpreter phụ thuộc thư mục làm việc của gateway** — `v2/gateway/src/assistant/render-executor.ts:991-1004`. `uv python find` đọc `.python-version`/`.venv` theo cwd; runtime chạy `uv run` từ project root. Interpreter đo có thể khác cái runtime chọn (không hỏng identity generation, nhưng sai mục đích của Q2). Sửa: `cwd: projectionRoot` (hoặc owner checkout khi có) và ghi rõ trong docs.

**M3 — Cleanup có thể kẹt vĩnh viễn khi stage đã bị xóa nhưng journal còn `complete`** — `v2/gateway/src/isolation/workspace.ts:828-833`; `render-executor.ts:583-590`. Nếu `operations.remove` thành công nhưng `removeLeader` (`RENDER_LEADER_UNSAFE`) hoặc `note({state:'deleted'})` lỗi, bản ghi giữ `complete` + `stageIdentity`; mỗi lần cleanup gọi lại `remove` trên stage đã mất → throw, attempt không bao giờ về `retained`/`deleted`. Sửa: trước khi reclaim, `absent`/`attest` stage; nếu đã vắng thì chỉ dọn `.leader` và ghi `deleted`.

**M4 — Báo cáo nói "Bắt buộc CPython ≥3.11" nhưng probe không kiểm implementation** — `render-executor.ts:1063-1068`. `sys.version.split()[0]` của PyPy cũng khớp regex. Hoặc sửa claim, hoặc in thêm `sys.implementation.name` và yêu cầu `cpython`.

**M5 — Ký tự private-use U+E000/U+E001 viết literal (vô hình) trong source** — `render-executor.ts:446, 448, 473`. Trước đây là escape ``/``; dạng literal không đọc/diff được và dễ bị editor/formatter làm hỏng. Sửa: trả về escape.

### Assessment

⚠️ Ghi nhận (đã có ruling hoặc phụ thuộc lát sau, không chặn):
1. Ngưỡng 1 + chưa có lệnh reconcile: một crash duy nhất chặn mọi render BMAD trên root cho tới khi bridge/T7 có đường giải tỏa; `cleanupWorkspace` cũng giữ `retained`. Đúng Q4 (fail-closed) nhưng cần đưa reconcile vào S6b-iii/T7 trước khi bật production.
2. `prerequisites` opt-in, mặc định tắt vì schema server strict — đúng PM 13:05; S6b-iii phải mở schema trước khi cấp option, và probe chạy lại mỗi chu kỳ sync (3 spawn + băm `uv` ~MB) — nên cache theo `(path, mtime, size)`.
3. Gateway không ràng buộc `render.prerequisites` truyền vào `prepareWorkspace` với lần đo của chính nó; chống giả mạo dựa vào server so `witness.uvSha256`/`python.sha256` với `gateway_applied` ở S6b-iii.
4. BUSY/GUARD_INVALID: nếu `remove` của `abandon` cũng gặp guard bận, stage còn lại ở `complete` cho cleanup — lệch nhẹ khỏi "không giữ stage", vẫn an toàn.
5. Probe từ chối Python <3.11 — PM đã chấp nhận (renderer cần `tomllib`).
6. Upgrade Homebrew Python/uv sau install report → `RENDER_*_UNAVAILABLE` tới lần report kế tiếp (fail-closed, cần ghi vào thông báo prerequisite cho owner).

**Task quality:** Needs fixes — I1 (từ chối `_bmad` tracked theo ruling PM 13:05) là bắt buộc; M1–M3 nên sửa cùng lượt.
