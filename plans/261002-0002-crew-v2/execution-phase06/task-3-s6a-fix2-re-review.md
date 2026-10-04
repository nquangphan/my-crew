# Phase06/T3-S6a — re-review follow-up (fix 2, lens bảo mật)

Phạm vi: `d2ab486..10b2e64`, chỉ đọc `render-executor.ts` (diff), câu docs trong `v2/docs/flows/assistant-workflows.md`, phần cuối `task-3-s6a-report.md`. Không chạy lại test.

## Verdict

| Mục | Verdict | Ghi chú |
|---|---|---|
| N3 sanitizer | **ADDRESSED** | Path bất kể ký tự đứng trước (cả backtick, `[`, `<`, `{`, `(`, `~/`, `~user/`); `Bearer`; trường `*token*/*secret*/*key*/*password*` dạng `:`/`=`, có cả giá trị trong nháy; `NAME=value`. Các đoạn đã xử lý được giữ sau delimiter private-use, và delimiter do child in ra bị bỏ trước nên child không giả được chỉ mục `kept`. Còn kẽ nhỏ R2. |
| N2 stamp | **ADDRESSED** | `dev:ino:mtimeNs:ctimeNs` (bigint, lstat, symlink → throw) của `_bmad`, `_bmad/scripts`, `_bmad/custom` (kể cả việc vắng) và mọi thư mục trong cây skill, so lại sau khi chạy. Thêm-rồi-xóa đổi mtime của thư mục; nếu kẻ cùng uid đặt lại mtime bằng `utimes` thì ctime vẫn đổi. Renderer không ghi vào các thư mục đã stamp (`dont_write_bytecode`, sandbox chặn), nên không có false positive từ chính renderer. Còn kẽ R1. |
| N4 docs | **ADDRESSED** | Flow doc ghi `uvPath` giữ path đã ghi, `argv[0]` là path đã resolve và không tự chứng minh gì, bằng chứng là `uvSha256` đo trên file đã thực thi, và server không được coi `argv[0]` là bằng chứng. |

## Đánh giá: tạo trước `{root}/_bmad/render`

Rủi ro thấp, chấp nhận được:

- Thứ tự an toàn: lần ghi chỉ xảy ra sau khi đã kiểm request, digest definition, `projectRoot` bằng realpath và `_bmad` là thư mục thật. Định nghĩa non-BMAD vẫn không có effect nào.
- Có sẵn mà là symlink hoặc file → `EEXIST` bị nuốt, nhưng `checkClosure` bắt `render` phải là directory (dirent của symlink không phải directory) → HALT. Đúng.
- Đây là lần ghi do chính tiến trình gateway thực hiện (không sandbox) vào workspace. Giữa `lstat(_bmad)` và `mkdir` có cửa sổ: thay `_bmad` bằng symlink thì `mkdir` tạo một thư mục rỗng ở chỗ khác. Kẻ đó đã cùng uid nên không có quyền mới; sau đó closure/stamp bắt và HALT. Không đáng sửa.
- Hệ quả hành vi: `RENDER_INPUT_MISMATCH` (closure hay input lệch) giờ để lại một thư mục rỗng `_bmad/render`; trước đây nhánh này không có effect nào. Vô hại, nhưng flow doc và bản kê injected entries của S6b (`auditWorkspace`, A4) phải tính `_bmad/render` là entry hợp lệ ngay cả khi render dừng.
- Renderer chính thức cũng tạo đúng thư mục này (`destination.parent.mkdir(parents=True)`). Mode 0755 theo umask là đúng với mặc định của renderer.

## Đánh giá: sanitizer có cắt mất chẩn đoán không

Các chẩn đoán chính vẫn còn: `error: No interpreter found for Python >=3.11 ...` (không có path; `>=` không bị luật `NAME=` bắt vì có `>` đứng trước `=`), `HALT: missing config value ...`, path trong workspace giữ đuôi tương đối (`{project-root}/_bmad/...`), path trong stage giữ dạng `{stage}/...`. Mất hoặc sai lệch có thể chấp nhận:

- Path hệ thống (interpreter `uv` đã thử, `/usr/bin/python3`) → `{path}`: không còn biết interpreter nào bị từ chối.
- Luật trường `*key*` bắt nhầm `KeyError: 'name'` → `KeyError: {redacted}`, mất đúng tên key — thông tin hữu ích nhất của lỗi đó (R3). Tương tự `monkey: ...`, `keyword: ...`.
- `foo==1.2` → `foo={redacted}`; `and/or`, `N/A`, `https://…` → `{path}`: giảm khả năng đọc, không mất gì quan trọng.
- Đây là giới hạn có từ trước, không do fix 2: chỉ giữ dòng **đầu**. Với traceback Python thì dòng đầu là `Traceback (most recent call last):`, còn dòng có giá trị là dòng **cuối**. Lỗi `uv` và `HALT:` của renderer đều nằm trên một dòng nên không bị ảnh hưởng. Đề xuất S6b: trả cả dòng không rỗng cuối cùng, cùng bộ lọc.

## Findings còn lại

- **R1 (Minor):** stamp chỉ phủ thư mục. (a) Sửa nội dung `render_skill.py`/`config_utils.py` rồi khôi phục ngay trong cửa sổ, cùng inode, không đổi tập entry → stamp thư mục không đổi, và lần hash sau khi chạy khớp. Đây là cùng lớp TOCTOU đã có từ đầu, nhưng giờ dễ đóng: stamp thêm `ino:ctimeNs` của từng file trong closure (2 script, layer, file skill). (b) `projectRoot`, `.claude` và `.claude/skills` không được stamp: nếu đổi tên cả thư mục `_bmad` đi rồi trả lại thì có còn bị bắt hay không phụ thuộc vào việc rename có đổi ctime của inode trên APFS — chưa xác minh. Nên stamp luôn `projectRoot`, `.claude`, `.claude/skills`.
- **R2 (Minor):** đuôi sau một path đã biết được giữ trước khi chạy luật credential, nên `{project-root}/x?token=abc` hay `{stage}/a=b` giữ nguyên giá trị. Sửa: áp luật credential/`NAME=` lên phần đuôi trước khi giữ nó lại, hoặc cắt đuôi ở `?`, `=`, `&`.
- **R3 (Minor):** luật `*key*` bắt nhầm `KeyError` và các từ thường (`monkey`, `keyword`), làm mất tên key trong lỗi Python. Sửa: yêu cầu ranh giới token (`(^|[_-])(api_?)?key([_-]|$)`) hoặc loại trừ `Error$`.

## Assessment

**Fix quality:** N2, N3, N4 ADDRESSED. Không có breakage mới ở mức Important trở lên. Việc tạo trước `_bmad/render` có rủi ro thấp; chỉ cần S6b khai báo nó là injected entry. R1–R3 là Minor, có thể sửa ngay vì rẻ (R1a, R3) hoặc ghi ledger S6b.
