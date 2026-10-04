# Phase06/T3-S6a — independent review (spec + quality, lens bảo mật)

Commit `d577085` (`d577085^ → d577085`), nhánh `codex/crew-v2-server`. Đọc: `render-executor.ts` (toàn bộ), diff `render-artifacts.ts`, `workflow-manifest.ts`, test `render-executor.test.ts` (các case chính), `workflows/operations.ts`, `workflows/operation-native.c` (`execute_owned`, `safe_name`, `dir_at`, quarantine/delete), memo A4/A5/S6, plan D1, report S6a. Không chạy lại test. Có một probe thực nghiệm `uv` thật trong scratchpad ngoài repo (không đụng project, không sandbox, đã xóa) để kiểm hai concern của report.

## Chứng cứ thực nghiệm (mới)

- Renderer đã pin (`execution-phase03/task-4-evidence/bmad-recipe-source.json`, body `render_skill.py`) khai báo inline PEP 723 `# /// script / requires-python = ">=3.11"`, import `argparse, hashlib, json, os, re, shutil, sys, tempfile, pathlib, typing` rồi `from config_utils import ...` (script dir = `sys.path[0]`); `render()` dùng `project_root.resolve(strict=True)` cho `root_hash`; `_publish` trả về sớm khi destination đã tồn tại (`_verify_existing`) — khẳng định hành vi "không ghi đè" ở mã thật.
- Máy này: `/usr/bin/python3 --version` → `Python 3.9.6`; `uv 0.12.13` ở `~/.local/bin/uv` (file thường).
- `env -i HOME/TMPDIR/XDG_*=<scratch> PATH=/usr/bin:/bin LANG=C UV_OFFLINE=1 UV_NO_CONFIG=1 UV_PYTHON_DOWNLOADS=never uv run --no-cache <script requires-python>=3.11>` → **exit 2**, `error: No interpreter found for Python >=3.11 ...`.
- Cùng env + Python 3.12 do uv quản lý → exit 0, log chỉ đúng một dòng stdout (không có chatter stderr ở non-TTY). Python in `getppid()` = PID của `uv` → `uv run` **spawn Python làm process con** (→ `NOTE_FORK` → `forkObserved`).

## Spec Compliance

- ✅ Refuse non-BMAD không spawn: `render-executor.ts:282-287` trước mọi effect; test `refuses a non-BMAD definition without reserving or spawning anything`.
- ✅ Argv chính thức đúng một lần qua `OwnedOperations` (`absent`×2 → `create` → `execute` → `remove`), `:361-418`; receipt `render-{op}.json` của primitive còn lại vĩnh viễn nên operationId không tái dùng được.
- ✅ Private env: primitive `execve` với environment tường minh (`operation-native.c:121-127`), đóng fd ≥3, stdin `/dev/null`; executor thêm 4 biến UV/PYTHON qua `/usr/bin/env`. Không rò env của gateway.
- ✅ No network (mức syscall): `(deny network*)`; ⚠️ `(allow default)` vẫn mở mach-lookup/XPC, process-exec, signal cùng uid (xem Minor 7).
- ✅ Bounded time/output: timeout 1–120 (`:276-278`, primitive `:107`), `RLIMIT_FSIZE` 64 MiB/file, quét stage 256 MiB, log đọc ≤64 KiB. ⚠️ ghi vào `{root}/_bmad/render` không bị đếm byte (Minor 4).
- ✅ Process closure fail-closed: `forkObserved`/`!treeEmpty` → `EXECUTOR_LIFETIME_UNKNOWN` → `RENDER_LIFETIME_UNKNOWN`, stage giữ lại (`:411-418`).
- ✅ Ghi uv path/sha256/version: sha256 đo lại trên bytes (`:355-359`). ⚠️ `uvVersion` là pass-through từ install report, không đo (chấp nhận được vì ràng qua sha256, nhưng phải ghi rõ).
- ✅ Validator D1 thuần (`render-artifacts.ts` `validateRenderDefinition`): pin + accepted tree + ≤128 file + tên ≤512 chuẩn hóa + layer + cap byte; executor gọi hai lần (định nghĩa và sizes thực đo).
- ✅ stdout path `{root}/_bmad/render/bmad-build/{slug}-{root12}/{gen20}` (`:436-460`): prefix tính độc lập, đuôi đúng 20 hex, một dòng, UTF-8 strict, `workflow.md` là file thường không symlink. Inspector D1 tính lại `generation_hash` và destination.
- ✅ D1 inspector trên toàn bộ bytes đọc lại sau khi chạy, shape generation đúng tập `manifest.json` + outputs (`:462-497`).
- ✅ Không ghi đè lần hai: test inode/mtime/bytes; ⚠️ chỉ chứng minh với renderer giả — mã `_publish` thật khớp (xem chứng cứ), integration thuộc S6b.
- ✅ Receipt đúng A5.2: `kind`, `attemptId`, `data{definitionSha256, customizationSha256, projectRoot, generationPath, inspection, witness{uvPath, uvSha256, uvVersion, argv, exitCode, stdoutPath, startedAt, endedAt, operationId}}` (`:499-520`). ⚠️ `stdoutPath` được hiểu là đường dẫn entry in trên stdout, không phải đường dẫn log; hợp lý nhưng A5 không định nghĩa.
- ✅ nonzero/unavailable/unknown/path mismatch → HALT không receipt; mọi lỗi lạ → `RENDER_UNEXPECTED_FAILURE` (`:524-534`).
- ✅ D2 M1: `workflow-manifest.ts` script `entry.type !== 'file'` → `WORKFLOW_SKILL_MISMATCH`.
- ✅ D2 M2: adapter gọi `validateRenderDefinition` với `entry.bytes` trước khi đọc bytes; `readPinnedFile` thêm `stat.size !== entry.bytes`.
- ✅ Digest definition: công thức `canonicalJson({source, projection, skills, customizationSha256, render})` khớp `definition()` của adapter (`render ?? null` vô hại vì nhánh này luôn có render).
- ⚠️ `projectRoot ≡ workspace` chỉ ở mức canonical/realpath; đối chiếu bản ghi workspace thuộc S6b (đúng phạm vi memo).
- ⚠️ Không có test nào chạy `sandbox-exec` thật, primitive thật hay `uv` thật — đúng memo (integration thuộc S6b), nhưng cú pháp profile SBPL chưa từng được parse.

## Security trace

| Vector | Kết luận | Chứng cứ |
|---|---|---|
| argv injection qua `projectRoot` (space, quote, leading dash, unicode) | An toàn. `execve` argv mảng, không shell. `lexicalPath` bắt tuyệt đối (không thể bắt đầu bằng `-`), normalize, không control/`"`/`\`, well-formed. Space vô hại. Unicode ở thư mục cha được phép; basename phải ASCII. NFC/NFD lệch → `realpath !== projectRoot` → HALT. | `:109-138`, `:342-346` |
| SBPL injection qua profile | `projectRoot` an toàn nhờ lexicalPath + `JSON.stringify`. `stage` **không** qua lexicalPath/realpath (Minor 2). | `:256-264`, `:372` |
| Path traversal generation | Không: prefix cố định + 20 hex chính xác; `..` bị loại (test có variant). Đọc bằng `readContained` không theo symlink. | `:446-451` |
| Symlink race stage/render | Stage: thư mục 0700 thuộc owned root, identity dev/ino do primitive kiểm. Render dir: symlink ở mọi thành phần bị từ chối khi đọc; Seatbelt so path đã resolve nên symlink ra ngoài bị chặn ghi. Còn TOCTOU lstat-cha→open (Minor 5) — rủi ro thấp vì child đã được chứng minh đóng. | `:146-190` |
| Env leakage | Không. Environment tường minh, `HOME/XDG/TMPDIR` trong stage. | native `:121-127` |
| Output flooding | log: RLIMIT_FSIZE + quét stage + đọc ≤64 KiB. `_bmad/render`: không giới hạn tổng (Minor 4). | native `:119,141` |
| Zombie/orphan | Leader được `waitpid`. Mọi fork → HALT, stage giữ. Primitive **không** `kill(-pgid)` sau khi leader thoát bình thường, nên con cháu sót vẫn chạy — chỉ an toàn vì kết quả là HALT; không ai dọn (S6b Q1/Q6). | native `:141-143` |
| Receipt forgery | Trường đều từ dữ liệu đã đo: digests đã tự kiểm, generationPath từ stdout + bytes, inspection từ inspector, uvSha256 đo bytes, exitCode từ receipt primitive. Ngoại lệ: `uvVersion` pass-through, `attemptId` do caller. Executor không chứng minh definition là định nghĩa server đã cấp — đúng thiết kế (latch server so `definitionSha256`). | `:305-339`, `:499-520` |
| Code thực thi ngoài pin | **Hở**: chỉ 2 script pin được kiểm; thư mục `_bmad/scripts/` không kiểm closure → shadow stdlib qua `sys.path[0]` (Important 1). | renderer source |

Đánh giá các concern của report:

1. Fork → `LIFETIME_UNKNOWN`: **đúng và đã xác nhận thực nghiệm** (Python là con của `uv`). Fail-closed là đúng. Thực ra lifetime được kiểm trước exit code (`operations.ts:145-153`), mà uv cũng phải query interpreter, nên ngay cả nhánh "không có Python" cũng sẽ báo `RENDER_LIFETIME_UNKNOWN` thay vì `RENDER_EXIT_NONZERO`. Câu hỏi ruling đã đúng hướng nhưng **chưa đủ** (xem S6b Q1–Q2).
2. Tìm Python: **report sai** khi nói là "đúng giả định trung bình" — giả định đã bị bác bỏ: renderer cần ≥3.11, CLT là 3.9.6, `uv` thật trả exit 2 (Important 2).
3. Profile đọc mở / TOCTOU uv: đúng; mức Minor (Minor 3, 7), nhưng thành khuếch đại cho Important 1.
4. stderr gộp: rủi ro thấp hơn report nghĩ — uv 0.12.13 không in gì ra stderr khi thành công ở non-TTY với script PEP 723. Vẫn fail-closed nếu sau này có cảnh báo. Chấp nhận.
5. Không crash-recovery cho `render-*`: đúng; vì concern 1 nên **mọi** lần render thật hiện sẽ để lại stage (gồm venv tạm của uv trong `tmp/`). Chuyển S6b/T7.
6. projectRoot chỉ realpath: đúng phạm vi S6a.
7. Validator viết trước test riêng: lệch TDD về quy trình; RED ngữ nghĩa có qua test M1/M2 của adapter. Ghi nhận, không chặn.

## Strengths

- Thứ tự fail-closed chặt: mọi kiểm tra (non-BMAD, request, digest, root, input drift, uv bytes) xảy ra trước khi reserve hay spawn; đều có test âm.
- Đọc lại input sau khi render rồi mới inspect, nên drift trong lúc chạy không thừa hưởng identity cũ.
- Stage chỉ thu hồi khi đã chứng minh process đóng; xử lý stage đúng kỷ luật của primitive.

## Issues

### Critical

Không có.

### Important

1. **Closure của `_bmad/scripts/` không được kiểm → chạy code ngoài pin trong renderer.** `render-executor.ts:198-230,348-353,470-472`. Executor chỉ hash các file đã chọn và 7 layer. `render_skill.py` chạy với script dir là `sys.path[0]` và import `argparse/hashlib/json/os/re/shutil/tempfile/pathlib/typing/config_utils`, nên bất kỳ `_bmad/scripts/json.py` (hoặc `re.py`, `tempfile.py`, `__pycache__/` với bytecode) có sẵn trong workspace sẽ chạy thay stdlib, trong sandbox vẫn đọc được toàn bộ home của owner (`~/.ssh`, token), mở mach/XPC, và ghi được dưới `_bmad/render` (tức vào workspace mà runtime/provider đọc sau đó). Inspector bắt được output giả, nhưng code đã chạy và file đã ghi vẫn còn sau HALT. Nguồn ghi: materialization sai, workspace dùng lại/retry, hoặc runtime trước đó. Executor là cổng tin cậy nên phải tự thực thi điều này. **Fix:** trước khi reserve và sau khi chạy, đọc `readdir` không theo symlink của `_bmad/scripts` và bắt tập tên đúng `{render_skill.py, config_utils.py}` (không có `__pycache__`); tương tự với `_bmad/` top-level (chỉ cho phép `scripts`, `render`, `custom`, các file config đã khai báo) và `.claude/skills/bmad-build/` (đúng tập đã chọn + `SKILL.md`). Thêm test âm "file .py thừa trong `_bmad/scripts` → `RENDER_INPUT_MISMATCH`, không spawn".
2. **Report khẳng định sai về prerequisite Python; render thật HALT chắc chắn vì hai lý do độc lập.** `task-3-s6a-report.md:50-51`. `render_skill.py` khai báo `requires-python >=3.11`; với `PATH=/usr/bin:/bin`, HOME trong stage (che các Python do uv quản lý của owner), `UV_PYTHON_DOWNLOADS=never`, uv chỉ thấy CLT 3.9.6 → exit 2 (đã đo). Đồng thời uv spawn Python làm con → `forkObserved` (đã đo). Code fail-closed đúng, nhưng báo cáo phải sửa từ "nhiều khả năng / đúng giả định trung bình" thành "đã xác minh: luôn HALT", và giả định D của memo ("`uv run --no-cache` không cần network khi Python đã có trên B" — trung bình) phải được đánh dấu là đã bị bác bỏ với cấu hình env hiện tại. **Fix:** sửa report; đưa S6b Q1+Q2 thành điều kiện trước bất kỳ grant integration nào.

### Minor

1. **Lỗi helper bị phân loại sai thành `RENDER_OPERATION_REUSED`; lock bị giữ suốt `execute`.** `render-executor.ts:373-376`. `absent` ném lỗi với mọi exit ≠ 0 của helper, kể cả `flock(LOCK_NB)` bận (code 20). `execute_owned` giữ `.operations.guard` tới 120 s, nên hai render song song (hoặc render cùng lúc với prepare/cleanup trên cùng owned root) sẽ báo "REUSED" sai. **Fix:** phân biệt `absent` trả 22 (đã tồn tại) với các lỗi khác (→ `RENDER_OPERATION_UNAVAILABLE`); S6b phải tuần tự hóa.
2. **Đường dẫn stage trong profile không qua kiểm tra lexical hay canonical.** `render-executor.ts:263,372`. Nếu `operations.root` không canonical (`/var` → `/private/var`), Seatbelt so path đã resolve nên ghi vào HOME/TMPDIR bị chặn → HALT khó hiểu; control char → `\uXXXX` không phải escape SBPL hợp lệ. **Fix:** kiểm `lexicalPath(stage)` và `realpath(operations.root) === operations.root` trước `create`.
3. **Identity của uv.** `render-executor.ts:355-359`. `lstat` từ chối uv là symlink (`/opt/homebrew/bin/uv` của Homebrew là symlink → luôn UNAVAILABLE); `readFile` không giới hạn kích thước; TOCTOU giữa hash và exec (giống `runBmadInstaller`); `uvVersion` không được đo. **Fix:** install report ghi realpath; giới hạn byte; hoặc copy uv vào stage, hash bản copy rồi exec bản đó, ghi cả hai path.
4. **Ghi vào `{root}/_bmad/render` không bị giới hạn tổng; HALT không dọn.** Quét byte của primitive chỉ áp cho stage; `.staging-*` và file lạ sau timeout/HALT vẫn ở lại trong workspace. **Fix (S6b):** quét/giới hạn `_bmad/render` sau khi chạy; ghi chính sách dọn khi HALT.
5. **TOCTOU trong `readContained`.** `render-executor.ts:152-170`. Các thư mục cha được `lstat` rồi mới `open` theo path; chỉ thành phần cuối có `O_NOFOLLOW`. **Fix:** sau khi đọc, `lstat` lại từng cha và so `dev/ino`, hoặc đọc qua helper native dùng `openat`.
6. **HALT xóa mất chẩn đoán.** `render-executor.ts:424-427`. Stage (gồm `execution.log`) bị thu hồi, outcome chỉ có mã lý do; với Important 2 thì mọi lần chạy thật đều mất nguyên nhân ("No interpreter found", "HALT: config missing"). **Fix:** trả kèm SHA-256 của log và dòng đầu đã cắt/làm sạch (≤256 byte, ASCII in được), hoặc giữ log trong quarantine.
7. **Profile `(allow default)` chỉ chặn network ở mức syscall.** `render-executor.ts:260-263`. mach-lookup/XPC (vd. dịch vụ URL session của hệ thống), process-exec, signal cùng uid vẫn mở. Với renderer đã pin thì chấp nhận được; với Important 1 thì thành kênh khuếch đại. **Fix:** ghi rõ trong flow doc; cân nhắc `(deny mach-lookup)` kèm allowlist sau khi đo ở S6b.
8. **TDD:** `validateRenderDefinition` được viết trước test trực tiếp của nó (report tự khai). Chỉ ghi nhận.

## S6b ruling questions

1. **Process closure (đã chứng minh uv spawn Python):** cho phép S6b sửa `operation-native.c` (ai sở hữu?) để thêm chế độ `execute` "cây có giới hạn" không? Ví dụ: leader `setpgid`; sau khi leader thoát thì `kill(-pgid, SIGKILL)` vô điều kiện và chứng minh `kill(-pgid,0) == ESRCH` + không còn PID nào trong pgid/session (`sysctl KERN_PROC_PGRP`/`KERN_PROC_SESSION`); con nào `setsid`/`setpgid` thoát nhóm → vẫn `LIFETIME_UNKNOWN`. Hay chọn "cách gọi khác"? Lưu ý A5 bắt argv `uv` chính thức và runtime sau đó cũng gọi đúng argv đó, nên gọi thẳng `python3` sẽ làm receipt không khớp với lời gọi của runtime.
2. **Prerequisite Python ≥3.11 (đã chứng minh CLT 3.9.6 không đạt):** nguồn interpreter nào được phép, và cách để uv tìm thấy nó mà không đổi argv — `UV_PYTHON=<đường dẫn tuyệt đối>` với interpreter được install report ghi path+sha256; hay mount chỉ-đọc `UV_PYTHON_INSTALL_DIR` của owner? Identity interpreter có vào `witness` không (đó là sửa đổi schema A5.2)?
3. **Closure của workspace:** executor (Important 1) hay materialization A4 sở hữu bất biến "`_bmad/scripts` và `.claude/skills/bmad-build` chính xác bằng projection"? Đề xuất: cả hai (materialize chính xác, executor xác minh).
4. **Stage `LIFETIME_UNKNOWN`:** ai journal/reconcile các stage `render-*` (và process sót lại), giới hạn bao nhiêu stage trước khi chặn render tiếp?
5. **Tuần tự hóa:** render dùng owned root nào (registry hay `workspace/operations`), và tuần tự hóa với prepare/cleanup ra sao khi `execute` giữ flock tới 120 s?
6. **Chẩn đoán khi HALT:** có cho phép trả digest log + dòng đầu đã làm sạch ra server/owner không?
7. **Đường dẫn uv:** install report ghi realpath (chấp nhận Homebrew symlink) hay bắt file thường?

## Assessment

**Task quality:** Needs fixes

Lõi executor đúng spec và fail-closed với mọi nhánh, không có lỗ hổng injection/traversal/forgery. Cần sửa Important 1 (kiểm closure của `_bmad/scripts`/skill dir, rẻ, nằm trong phạm vi S6a) và Important 2 (sửa report theo chứng cứ thực nghiệm: hiện mọi lần render thật đều HALT). Các Minor có thể chuyển S6b nếu PM ghi nhận.
