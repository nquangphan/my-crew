# Phase06/T3-S6a — scoped re-review, vòng sửa 1 (lens bảo mật)

Phạm vi: `d577085..d2ab486`, chỉ đọc `render-executor.ts` (diff), phần cuối `task-3-s6a-report.md`, `journal/native.ts` (`NativeHelper.run`), `operation-native.c` (mã thoát), fixture projection BMAD thật `v2/gateway/test/fixtures/workflow-definitions/bmad-claude-projection.json`. Không chạy lại test.

## Verdict từng mục

| Mục | Verdict | Ghi chú |
|---|---|---|
| I1 closure | **ADDRESSED** (mục tiêu bảo mật) | `checkClosure` chạy trước khi reserve (`RENDER_INPUT_MISMATCH`) và sau khi chạy (`RENDER_ARTIFACT_MISMATCH`); `_bmad/scripts` đúng 2 tên, có đệ quy nên `__pycache__/*.pyc` và `pkg/__init__.py` đều bị bắt; symlink và file đặc biệt bị từ chối; `.claude`/`.claude/skills` là symlink vẫn bị chặn nhờ `readContained` cùng guard. Còn kẽ TOCTOU (N2) và có breakage hợp đồng với projection thật (N1). |
| I2 report | **ADDRESSED** | Concerns 1–2 đã ghi đúng chứng cứ đo, đánh dấu giả định D bị bác bỏ, và chặn grant integration S6b sau Q1+Q2. |
| M1 | **ADDRESSED** (absent/create) | `execFile` promisify trả `.code` là exit status; 22 → `REUSED`, 20 → `BUSY`, còn lại → `UNAVAILABLE`. Còn lại: lock bận lúc `execute` (helper thoát 20 trước khi spawn) vẫn ra `RENDER_OPERATION_UNAVAILABLE` và giữ stage dù không có child nào (N5). |
| M2 | **ADDRESSED** | `lexicalPath(stage)` + `realpath(operations.root) === operations.root` trước mọi thao tác. |
| M3 | **ADDRESSED** | `realpath` → `lexicalPath` → `digestFile` (O_NOFOLLOW, ≤256 MiB, đọc từng khối, phát hiện file lớn lên) → exec đúng path đã resolve. Đổi đích symlink sau khi hash không còn ảnh hưởng. TOCTOU thay file tại path đã resolve vẫn còn (đã khai). |
| M6 | **ADDRESSED một phần** | Digest + dòng đầu có; trước khi spawn không có `log`; tính trước khi reclaim. Bộ lọc dòng đầu còn để lộ path trong backtick (N3). |

## Lens

**TOCTOU closure ↔ spawn.** Child không ghi được `_bmad/scripts` hay skill dir (sandbox chỉ cho ghi stage và `_bmad/render`), nên kẽ hở chỉ đến từ writer bên ngoài cùng uid. Cửa sổ từ `checkClosure` tới `execve` gồm đọc input, hash uv (tới 256 MiB) và 3 lời gọi helper. Một writer có thể thêm `_bmad/scripts/json.py` ngay sau lần kiểm đầu rồi xóa trước lần kiểm sau: lần kiểm sau chỉ so tập tên ở thời điểm đó nên bỏ sót. Inspector sẽ bắt output giả nếu có, nhưng code đã chạy (đọc được mọi file, mở XPC). → N2.

**Dòng đầu đã lọc có lộ không.** Path đã biết và `NAME=value` được xử lý tốt. Lộ:
- Path tuyệt đối đứng sau ký tự không nằm trong `[\s'"(:,=]`. `uv` và Python bọc path trong backtick (`` `/Users/<user>/.local/share/uv/...` ``), `[`, `<`, `{` → giữ nguyên, lộ username và layout home.
- Path `~/…` và path tương đối (vd. giá trị config chưa resolve trong `RenderError`) không bị lọc.
- Token dạng `Bearer xyz` hoặc `token: xyz` (không có `=`) không bị lọc. Với renderer đã pin thì ít khả năng xảy ra, nhưng hàm lọc tự xưng là "safe".
- Dòng đầu là text không tin cậy (ASCII in được); nếu đưa vào ngữ cảnh LLM thì phải bọc như dữ liệu.

→ N3.

**`witness.uvPath` ≠ `argv[0]`.** Không làm giảm độ tin cậy về bytes: `uvSha256` được đo trên chính file đã exec, `uvPath` khớp install report để server đối chiếu. `argv` vốn đã không giống hệt lời gọi của runtime (runtime gọi `uv` theo PATH), nên không mất bất biến nào. Rủi ro thấp: server không có cách kiểm `argv[0]` là realpath của `uvPath`, nên một receipt có `argv[0]` tùy ý vẫn trông hợp lệ nếu server chỉ so `uvPath`/`uvSha256`. → N4: ghi rõ trong flow doc rằng `argv[0]` là path đã resolve, và latch không được coi `argv[0]` là bằng chứng; hoặc kiểm `posix.isAbsolute(argv[0])` và các phần tử `argv[1..]` đúng mẫu chính thức.

## Findings / breakage mới

- **N1 (Important, breakage hợp đồng với S6b/A4):** projection BMAD thật đã pin có `_bmad/scripts/{memlog,resolve_config,resolve_customization}.py` và `_bmad/custom/.gitignore` (fixture `bmad-claude-projection.json`). A4 yêu cầu materialize `_bmad/` (scripts + config) từ projection, mà materialize trung thực thì `checkClosure` luôn dừng. Nếu S6b chỉ copy 2 script, các bước runtime của BMAD gọi script khác có thể hỏng (chưa xác minh — fixture chỉ có path, không có body). Report chỉ nêu `.gitignore`. Hướng sửa: closure = đúng tập `_bmad/scripts/*` + `_bmad/custom/*` đã pin trong projection, kiểm hash từng file (cần definition mang thêm các pin này: đổi adapter/validator, tức đổi digest definition), hoặc PM ruling materialize tập con kèm chứng cứ là runtime không cần. Ba tên thừa không trùng tên stdlib nên rủi ro shadow thấp nếu đã kiểm hash.
- **N2 (Minor):** kẽ TOCTOU thêm-rồi-xóa của closure (xem Lens). Sửa rẻ: lúc kiểm trước, chụp `lstat` (`dev`, `ino`, `mtimeNs`, `ctimeNs`) của `_bmad`, `_bmad/scripts`, `_bmad/custom`, skill dir và các thư mục con, rồi so lại lúc kiểm sau. mtime của thư mục đổi khi thêm/xóa entry nên bắt được cả trường hợp đã xóa. Kèm bất biến S6b: không process nào khác có quyền vào workspace trong lúc render.
- **N3 (Minor):** regex lọc path trong `sanitizeFirstLine` bỏ sót path theo sau `` ` ``, `[`, `<`, `{` và các path `~/`. Sửa: thay mọi chuỗi con khớp `` (?:~|\/)[^\s'"`]* `` (không cần ký tự đứng trước), lọc `Bearer\s+\S+`, `[A-Za-z_-]*(token|secret|key|password)\s*[:=]\s*\S+` (không phân biệt hoa thường). Thêm test với thông điệp lỗi kiểu uv có backtick.
- **N4 (Minor):** server không có ràng buộc nào giữa `argv[0]` và `uvPath`; ghi rõ ngữ nghĩa trong flow doc và trong latch A5 (xem Lens).
- **N5 (Minor):** `execute` gặp flock bận (helper thoát 20 trước khi fork) bị báo `RENDER_OPERATION_UNAVAILABLE` và stage bị giữ như thể vòng đời chưa rõ, dù không có child nào chạy. Phân biệt `close` code 20 trong `OperationsOwned.execute` thuộc S6b (đổi `operations.ts`).
- **N6 (Minor):** `diagnostics()` cũng đọc log khi `LIFETIME_UNKNOWN`, lúc process con có thể vẫn đang ghi. `digestFile` thấy file lớn lên thì ném lỗi và trả `undefined`, nên vô hại. Chỉ ghi nhận.

## Assessment

**Fix quality:** I1, I2, M1, M2, M3 ADDRESSED; M6 ADDRESSED một phần (N3). Không có lỗi bảo mật mới ở mức Critical. N1 là Important nhưng nằm ở ranh giới hợp đồng với S6b: chấp nhận S6a nếu PM ghi N1 thành điều kiện ruling S6b (tập closure ↔ tập materialize A4). Có thể làm N2/N3 ngay trong S6a vì rẻ, hoặc ghi ledger.
