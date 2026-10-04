# Phase06/T3 — Báo cáo lát S6b-ii (gateway): executor execute-tree, materialize BMAD trong prepare, prerequisites install report

Ngày 04/10/2026 (Asia/Ho_Chi_Minh). Nhánh `codex/crew-v2-server`, BASE `eb16cbded5b3d4ec3150da4d7cd87956853fa0cc`. Ruling áp dụng: `pm-s6b-rulings-memo-261004.md` (Q2, N1, Q3–Q7, mục 6 lát S6b-ii) và ràng buộc ledger 09:30, 12:05 trong `progress.md`.

## Kết quả

Trạng thái: DONE_WITH_CONCERNS. Ba commit, mỗi mục một commit sau khi xanh:

| Mục | Commit | Nội dung |
|---|---|---|
| 1 | `b3ec7a8` | `render-executor.ts`: `executeTree`, `UV_PYTHON`, `witness.python`, journal bền, BUSY/GUARD_INVALID, N3 `.leader`, Q6 + S6a R1/R2/R3 |
| 2 | `33a209f` | `workspace.ts`/`inventory.ts`: materialize tập con N1, render trong `prepareWorkspace` trước audit `after`, bản ghi `render-{op}`, ngưỡng đối soát, khai báo injected |
| 3 | `8689125` | `probeRenderPrerequisites` + `GatewaySync` option `prerequisites` + type additive `ReportedProjectionSlot.prerequisites` |

Không sửa `operation-native.c`, `operations.ts`, server hay web.

## Mục 1 — executor

- `createRenderExecutor({operations, journal, prerequisites: {uv, python}, clock, timeoutSeconds?})`. `ExecutableIdentity = {path, realpath, sha256, version}` đúng hình dạng install report (Q7). Trước spawn: `realpath(path) === realpath` đã ghi và SHA-256 (≤256 MiB) khớp, cho cả `uv` (`RENDER_UV_UNAVAILABLE`) và Python (`RENDER_PYTHON_UNAVAILABLE`); identity sai dạng là `RENDER_REQUEST_INVALID`. `argv[0]` là realpath `uv`; env thêm `UV_PYTHON={realpath Python}` (argv không đổi). `witness.python = {path, sha256, version}`.
- `RenderOperations` dùng `executeTree`. `EXECUTOR_BUSY` → `RENDER_OPERATION_BUSY`, `EXECUTOR_GUARD_INVALID` (và helper thoát 24 ở `absent`/`create`) → `RENDER_OPERATION_GUARD_INVALID` mới; cả hai thu hồi stage ngay, không giữ. `EXECUTOR_LIFETIME_UNKNOWN`/lỗi khác giữ stage và `.leader`. Không có code kill nào được thêm.
- Journal (`RenderJournal.blocked()/record()`): `reserved` trước `create`, `pending` sau, `complete` (receipt + nội dung `.leader`) hoặc `unknown`, `deleted` sau thu hồi. `blocked()` đúng → `RENDER_RECONCILE_REQUIRED` trước mọi thao tác. Ghi `pending` lỗi → thu hồi stage, không spawn.
- N3: `absent('receipts', 'render-{op}.leader')` trước spawn (còn sót → `RENDER_OPERATION_REUSED`); thu hồi xóa `.leader` (lstat: file thường, một link, cùng uid) sau khi xóa stage; `.json` giữ làm bằng chứng đã chạy. `reclaimRenderStage` export cho cleanup của workspace.
- Q6: `log = {sha256, firstLine, lastLine}`, dòng không rỗng đầu và cuối (cửa sổ 4 KiB; dòng cuối dài hơn cửa sổ trả rỗng thay vì mảnh giữa dòng). R2: đuôi sau path đã biết chỉ giữ `[A-Za-z0-9._/-]`, nên `?token=…` vẫn bị che. R3: `key` chỉ tính khi là từ riêng (`api_key`, `ACCESS_KEY`) hoặc hậu tố camel (`apiKey`); `KeyError`, `keyword`, `monkey` giữ nguyên, và quét lại ngay sau tên bị bỏ qua để không sót credential nằm trong giá trị. R1: stamp gồm project root, `.claude`, `.claude/skills`, từng file trực tiếp trong `_bmad`, `_bmad/scripts`, `_bmad/custom` và mọi file trong cây skill (dev/ino/mtime/ctime/size).

## Mục 2 — workspace

- `prepareWorkspace(owner, attemptId, source, projection, render?)`; `render = {definition, prerequisites}`. Kiểm trước khi đặt chỗ: attempt là UUID (`INVALID_ATTEMPT_ID`), source `bmad`, runtime `claude`, `definition.render.source/projection` đúng cặp pin (`RENDER_DEFINITION_BINDING_MISMATCH`).
- `materializeRenderInputs` (một nguồn sự thật `definition.render`): copy `selectedProjectionSha256` cộng layer có mặt, đọc projection không theo symlink, so SHA-256 rồi ghi file thường O_EXCL 0644; tạo thư mục cha và `_bmad/render`. Không copy `memlog.py`, `resolve_*.py`, `.gitignore`, file không `.md` trong skill. Executor xác minh lại (Q3).
- Render chạy trên owned root `operations` của isolation, trong transaction prepare, sau exclusion và trước audit `after` (Q5). HALT → `RENDER_HALTED:{reason}`, workspace `retained`, `render.halt = {reason, log?}`, `injected` vẫn khai `_bmad/render`. Thành công → `render.receipt` trong bản ghi workspace cho S6b-iii.
- Bản ghi `render-{op}` (`kind: 'isolation-render'`) trong store isolation; `open()` chuyển `reserved`/`pending` thành `unknown` (khóa store độc quyền nên không render nào đang chạy). Ngưỡng 1: còn bản ghi không `complete`/`deleted` → `RENDER_RECONCILE_REQUIRED`. `verify` → `PROCESS_CLOSURE_UNVERIFIED`, `cleanup` → `retained` nếu attempt có render chưa chứng minh; stage `complete` thu hồi lỗi trước đó được thu hồi lại lúc cleanup.
- `auditWorkspace(..., injected)`: đường dẫn đã khai là `selected` (`render-input`/`render-output`); trong root `_bmad`/`.claude` của khai báo, không khai → `UNDECLARED_INJECTION`, khác bytes → `INJECTED_BYTES`, symlink → `INJECTED_SYMLINK`, thiếu → `INJECTED_MISSING`. Không có `render` thì prepare không đổi (test xác nhận không có `injected`/`render`, không có `_bmad`/`.claude`).

## Mục 3 — install report

- `probeRenderPrerequisites({uvPath, projectionRoot, run?})` trong môi trường owner, `execFile` không shell, env owner + `UV_OFFLINE=1`, `UV_PYTHON_DOWNLOADS=never`, ≤10 s, ≤64 KiB: realpath/SHA-256/`--version` của `uv`; `uv python find --script {projectionRoot}/_bmad/scripts/render_skill.py`; realpath/SHA-256 và `sys.version` của Python. Bắt buộc CPython ≥3.11 (`RENDER_PYTHON_UNSUPPORTED`), output một dòng ASCII, path tuyệt đối chuẩn hóa (`RENDER_PREREQUISITE_INVALID`).
- `GatewaySync` option `prerequisites(projectionRoot)` chỉ gọi cạnh definition có `render`; gắn `prerequisites` additive vào slot, không đổi `definition`; đo lỗi chỉ bỏ trường.

## Kiểm chứng

| Bước | Lệnh | Kết quả | Log |
|---|---|---|---|
| RED mục 1 | `node --test test/render-executor.test.ts` trên executor S6a | exit 1, 28/30 fail toàn `ERR_ASSERTION` | `task-3-s6b-ii-item1-red.log` `cb99aa93…0042` |
| GREEN mục 1 | `tsc --noEmit`; executor + render-artifacts + workflow-manifest + sync | tsc 0; 79/79 | `task-3-s6b-ii-item1-green.log` `b9c5d469…b0d9` |
| RED mục 2 | `node --test test/isolation-render.test.ts`, scaffold `renders()` rỗng | exit 1, 6/7 fail (thiếu file materialize ENOENT, còn lại `ERR_ASSERTION`) | `task-3-s6b-ii-item2-red.log` `b64b7e16…cb49` |
| GREEN mục 2 | `tsc`; isolation-render + isolation-workspace (`CREW_ISOLATION_SKIP_DISCOVERY=1`) + isolation-runtime + isolation + runtime-workspace + runtime-boundary + render-executor | tsc 0; 57/57 | `task-3-s6b-ii-item2-green.log` `950527a0…d41e` |
| RED mục 3 | probe + sync prerequisites, stub `NOT_IMPLEMENTED` | exit 1, 4/4 fail | `task-3-s6b-ii-item3-red.log` `3fb69e0d…d9bd` |
| GREEN mục 3 | `tsc`; executor + sync + render-artifacts + workflow-manifest + isolation-render | tsc 0; 90/90 | `task-3-s6b-ii-item3-green.log` `f9014855…a1c4` |
| Regression cuối | `CREW_ISOLATION_SKIP_DISCOVERY=1 node --test test/*.test.ts` tại `8689125` | 294/330 pass; cả 36 fail đều do môi trường, không chạm file của lát: 23 cần `CREW_V2_TEST_DATABASE_URL` (real route, execution bridge, prefix8), 11 cần `dist/` đã build (host lifecycle/frame/lock, journal built entrypoint; lệnh không chạy `pnpm build`), 2 `BUILDER_INPUT_MISMATCH` do pin node/uv của builder đóng băng (`builder.ts` không đổi). Mọi test render/isolation/sync xanh | `task-3-s6b-ii-final-regression.log` `a439e5ce…3649` |

Mọi lệnh test/tsc chạy trong slot `$TMPDIR/crew-v2-heavy-slot.lock` (`owner=s6b-ii`) sau khi telemetry trả `heavyEligible=true`, `NODE_OPTIONS=--max-old-space-size=384`; slot nhả bằng `rm -rf` sau mỗi lệnh. Biome sạch trên file đã sửa (cảnh báo `noExplicitAny` có sẵn trong `sync.test.ts`, không thuộc hunk của lát). Docs: `assistant-workflows.md`, `gateway-workflows.md` (bước 15 + Files + test), `gateway-host.md`, `flows.yaml` thêm `isolation-render.test.ts` và `support/bmad-render-double.ts`; `crew-docs generate` (cập nhật `files.md`), `check --all`, `check --staged` ok trên mirror; hook commit `check --staged`/`--commit-msg` ok; `flows.yaml` sửa dưới `crew-v2-manifest.lock`. Sau mỗi lượt `ps` không còn tiến trình của lát.

Test workspace dùng Git thật qua helper owned và `executeTree` thật; `uv` là script Node giả (`support/bmad-render-double.ts`) chỉ render khi `UV_PYTHON` đúng realpath Python đã ghi. Không chạy `uv`/Python thật, không network, không provider.

## Lệch và quyết định trong phạm vi

- Server chưa được sửa (ngoài ownership), mà schema install report của server là strict (`additionalProperties: false`), nên một report có `prerequisites` sẽ bị server từ chối. Vì vậy `prerequisites` là option của `GatewaySync`, mặc định không cấp, và host production hiện chưa dựng `GatewaySync`. S6b-iii phải mở schema/type `server/src/gateway/contracts.ts` trước khi cấp option.
- Probe bắt buộc Python ≥3.11 thay vì chỉ ghi phiên bản: renderer pin cần `tomllib`; ghi một interpreter không chạy được chỉ dời lỗi sang lúc render.
- `.leader` được xóa bằng Node (`lstat` rồi `unlink` trong `receipts/` 0700 của owner) vì helper không có verb xóa file; cửa sổ giữa hai syscall nằm trong thư mục riêng của user.
- Journal là tham số bắt buộc của executor (API đổi so với S6a; không có caller nào khác).

## Concerns

1. Lệnh reconcile cho bản ghi `unknown` (bridge) chưa có; một stage `unknown` chặn mọi render BMAD trên root tới khi có đường đối soát (T7/bridge). Theo câu hỏi mở của S6b-i, reconcile không nên dựa `getsid(pid)==leader` sau khi helper đã thoát; bản ghi chỉ lưu `pid start-time`.
2. Mặc định `BMAD_TRACKED_IN_CHECKOUT` (memo N1, PM chốt) chưa có ruling nên chưa hiện thực: `_bmad`/`.claude` tracked của owner bị loại ra `excluded` rồi tập con được materialize; `git status` trong workspace sẽ thấy thay đổi.
3. `prepareWorkspace` với render lỗi trả `Error('RENDER_HALTED:{reason}')`; chẩn đoán Q6 nằm trong `render.halt` của bản ghi workspace, S6b-iii đọc từ `get(attemptId)` để gửi lên server.

## Câu hỏi mở

- PM chốt `BMAD_TRACKED_IN_CHECKOUT` (từ chối hay chấp nhận checkout track `_bmad`).
- S6b-iii: thứ tự mở schema server cho `prerequisites` và nơi cấp `uvPath` của owner cho probe.

## FIX1 (review `task-3-s6b-ii-review.md`)

Commit `cf78d0f`. Mỗi mục có RED trước.

| Mục | Sửa | Test |
|---|---|---|
| I1 | Prepare có render: ngay sau audit `before` (clone sạch nên mọi entry là tracked), entry `_bmad` hay `_bmad/**` → `BMAD_TRACKED_IN_CHECKOUT` trước vòng exclusion; `_bmad` không bị dời/thay, workspace `retained`, không `injected`/`render`/bản ghi `render-*`. Prepare không render giữ hành vi cũ | Fixture tách hai checkout: `owner` chỉ track `.claude` (materialize như cũ, `.claude` bị loại, không exclusion `_bmad`), `trackedOwner` track thêm `_bmad/legacy.toml` (bị từ chối, file còn nguyên trong clone và checkout, cleanup `deleted`); test prepare không render dùng `trackedOwner` để giữ phủ exclusion |
| M1 | `registry.resolve` cho prerequisites nằm trong `try` | Registry bọc làm lần tra sau definition lỗi → slot vẫn `current`, definition giữ, không có `prerequisites` |
| M2 | `ProbeRunner(file, args, {cwd})`; mọi lệnh probe chạy với cwd = `projectionRoot`. Chọn projection root vì `uv` đọc `.python-version`/`.venv` theo cwd và thư mục cha, projection root không có, tương đương workspace của dự án không ghim interpreter; install report đo theo máy nên không có workspace cụ thể | Runner giả ghi cwd của ba lệnh; runner mặc định chạy `uv` giả kiểm `pwd -P` |
| M3 | `reclaimRenderStage`: stage đã vắng thì bỏ `remove`, chỉ dọn `.leader`; cleanup chốt `deleted` | Bản ghi `complete` của stage đã xóa → cleanup `deleted`, workspace đã thu hồi |
| M4 | Probe in `sys.implementation.name` cùng phiên bản, chỉ nhận `cpython` ≥3.11; `version` ghi phần phiên bản | PyPy 3.11, GraalPy 3.11, thiếu implementation → `RENDER_PYTHON_UNSUPPORTED` |
| M5 | Delimiter viết `\uE000`/`\uE001` | Test đọc source: không có ký tự private-use literal |

| Bước | Kết quả | Log |
|---|---|---|
| RED | 8 fail đúng ngữ nghĩa (thiếu rejection I1, quarantine stage đã mất M3, slot `error` M1, cwd/implementation M2/M4, literal M5) | `task-3-s6b-ii-fix1-red.log` `8e1c8603…9b80` |
| GREEN | `tsc` 0; executor + sync + isolation-render + isolation-workspace (`CREW_ISOLATION_SKIP_DISCOVERY=1`) + isolation-runtime + isolation + runtime-workspace + runtime-boundary + render-artifacts + workflow-manifest **113/113** | `task-3-s6b-ii-fix1-green.log` `d6738e06…a79d` |

Slot nặng `owner=s6b-ii` + telemetry trước mọi lệnh; biome sạch; `crew-docs` generate (không đổi), `check --all`/`--staged` ok; không còn tiến trình của lát. Docs: `gateway-workflows.md` bước 15 và test, `gateway-host.md`, `assistant-workflows.md`. Các ⚠️ của review giữ cho PM ghi ledger (reconcile chưa có, cache probe, ràng buộc prerequisites ở server, BUSY khi `remove` cũng bận, upgrade Homebrew cần report mới).
