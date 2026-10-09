# RV-1 — Review toàn nhánh R2-2 (file đính kèm)

- Người review: agent code-reviewer (opus). Chỉ đọc và chạy test, không sửa code, không commit, không push.
- Thời gian (theo `date`, Asia/Ho_Chi_Minh): bắt đầu 09/10/2026 21:03, chạy lệnh 21:03–21:06, đọc code tới 10/10/2026 00:13.
- Phạm vi:
  - Repo Crew: `git diff r2-1..r2-2` (`r2-2` @ `3e27917`, 7 commit, 69 file, +8763/−14), worktree `.worktrees/crew-r22-files`.
  - Fork: `git diff crew/r2-1..crew/r2-2` (`dae04c439`, 12 file, +721), worktree `.worktrees/paperclip-r21-plugin` (nhánh `crew/r22-plugin` = `dae04c439`).
- Ghi chú: trong lúc viết báo cáo, ledger có dòng 00:12/00:13 cho thấy Trợ Lý đã giao lại RV-1 cho agent khác vì tưởng lượt này đứng. Lượt này vẫn chạy đủ; hai báo cáo có thể trùng file, Trợ Lý chọn bản nào thì dùng bản đó.

## 1. Kết quả lệnh

| Lệnh | Nơi chạy | Kết quả |
|---|---|---|
| `pnpm -r typecheck` | crew-r22-files | xanh: 0 lỗi (crew-mac, mac-app, docs-kit) |
| `pnpm -r test` | crew-r22-files | xanh: crew-mac 43 file/737 test; docs-kit 3/43; mac-app 38/403. Có dòng `error: No such remote 'origin'` in ra từ test cũ của crew-mac (không làm đỏ) |
| `pnpm lint` | crew-r22-files | xanh: biome 283 file, không lỗi |
| `node packages/docs-kit/dist/crew-docs.cjs check --range r2-1..r2-2` | crew-r22-files | `crew-docs check --range: ok (6 commits)` |
| `bash crew/release/verify.sh` | paperclip-r21-plugin (`dae04c439`) | `XANH`, exit 0, 21:04:52–21:06:45. Hook 5/5, lỗi 0; server crew 22 file/418 test; adapter 3/17; plugin 21 file/57 test; `crew/agents` 81/81; tsc server, adapter, plugin 0 lỗi; build plugin xong; không có `require("react")` trần |
| `ipcs -m` | trước và sau verify | 1 segment cũ (`0x5110a261`), không đổi; shmmni 32 |
| `git status` | cả hai worktree sau khi chạy | sạch |

Tôi chạy thêm vài phép thử bằng bundle `dist/files-worker.cjs` đã build, trong scratchpad (không đụng `~/.crew`):

- Text UTF-16LE (có BOM) chứa khóa AWS mẫu: bản ra là UTF-8, `[ĐÃ CHE: aws-access-key-id]`, 0 lần lộ khóa, finding dòng 2.
- CSV UTF-16LE: kết quả giống hệt.
- 2 MB toàn dòng dòng mở đầu khóa PEM không có dòng END: worker che xong trong khoảng 6 giây. Ước tính 10 MB mất khoảng 30 giây, vẫn dưới hạn 60 giây. Nếu quá hạn thì file ra `trinh_doc_loi` (đóng kín), nên không lộ gì.

## 2. Kết luận

**Deploy được, có điều kiện.** Không có blocker. Mọi cổng tầng phát hành đều xanh. Lõi Paperclip không bị sửa. Hook vẫn 5/5. Tôi không tìm thấy đường nào làm lộ credential ra stdout, manifest, log hay comment plugin. Parser chạy trong process con: không có env thừa, không có module mạng, có giới hạn RAM và thời gian, và chặn được zip bomb, DTD, zip-slip, symlink.

Điều kiện:

1. DP-1 làm đúng trình tự Global Constraints. Sau deploy, kiểm plugin `crew.core` healthy và có job `attachments-audit`. Plugin cài theo đường local nên khi có capability mới, loader nạp lại manifest (`refreshPluginManifestFromPackage`), không vào `upgrade_pending`. `upgrade_pending` chỉ áp cho plugin distribution. Dù vậy vẫn phải nhìn trạng thái thật.
2. Cài `crew-mac` từ build `r2-2` (`pnpm --filter @crew/mac build`) và kiểm có đủ `dist/files-worker.cjs` và `dist/files/pdf-info.js`. Không phát hành app nào build từ trước `r2-2`. Lý do: `installCrewMacFrom` chỉ so `hashTree`, không so phiên bản, nên app R2-1 cài lại bản cũ sau mỗi lần update hay chạy setup (rủi ro 4 của plan).
3. Owner xác nhận AG-2 (sửa `apps/mac-app` khi chưa có lời cho phép rõ, Trợ Lý tự quyết với quyền phủ quyết sáng 10/10) trước khi DP-1 PUT `AGENTS.md` cho 4 agent `2ps-landing`. Phần fork và agent R1 không phụ thuộc điều kiện này.
4. Finding major M1 không chặn AC, vì AC chạy trên issue gốc của Trợ Lý. Nhưng phải có ticket sửa (FX) trước khi dùng thật luồng executor nhận file của issue cha.
5. AC phải đọc đúng đường thật:
   - Bản trích nằm ở `derived/<sha>/v1/extract/<tên>.{md,txt,csv}`, không phải `v1/*.md` (AC7 trong plan ghi sai).
   - Ảnh và PDF nằm ở `derived/<sha>/v1/<sha>.<đuôi>`.
   - AC1 với 11 file staged xác nhận luôn mục m6.

## 3. Finding

Mức độ: blocker (chặn deploy) / major (sai chức năng quan trọng, cần FX) / minor (nên sửa) / info.

### Blocker

Không có.

### Major

**M1. Agent trên issue con không bao giờ được dặn chạy `crew-mac files`, nên tính năng "issue cha" gần như không tới được.** (gói `agents`: AG-1 fork + AG-2 template; cần Trợ Lý hoặc owner chọn cách sửa)

- Chỗ: `crew/agents/{assistant,executor,reviewer,integrator}.md`, khối I8 dòng đầu ("Khi `heartbeat-context` có `attachments`, hoặc mô tả/comment có link `/api/attachments/…`"). Bản chép giống hệt nằm ở `apps/mac-app/src/main/projects/templates/*.md`.
- Kịch bản lỗi:
  1. Owner đính mockup hoặc ảnh chụp vào issue gốc. Trợ Lý đọc được.
  2. Trợ Lý tạo issue con cho executor. Body mẫu trong `assistant.md` mục "Tạo issue con" không chép link đính kèm.
  3. `heartbeat-context.attachments` của issue con chỉ có file của chính nó (SP-0, `sp-0-probe.md` dòng 60), nên rỗng. Mô tả con không có link.
  4. Executor, reviewer và integrator không chạy lệnh, nên không thấy file của issue cha.
  - Hệ quả: nhánh `relation: 'ancestor'` / `issue cha <KEY>` trong `run.ts` (dòng 244–275) chỉ chạy khi agent tự ý gọi lệnh. Đây là lỗi thiết kế của I8 (plan/spec 5.5). Code làm đúng plan.
- Đề xuất, chọn một:
  - (a) Thêm vào I8 điều kiện "issue có `parentId`" (issue con thì luôn chạy). Mỗi lượt tốn khoảng 6–8 giây gọi bridge. Lưu ý issue con thường mới tạo dưới 2 phút nên còn cộng 15 giây chờ liệt kê lại. Có thể bỏ chờ khi chính issue không có attachment nào.
  - (b) Dặn Trợ Lý ghi vào description của con một dòng "Issue gốc có file đính kèm: chạy `crew-mac files`", và để I8 nhận cả dòng đó.
  - Kèm theo: test `instructions.test.mjs` và `projects-instructions.test.ts` khẳng định điều kiện mới.

### Minor

**m1. Nhãn kiểu cấm của Mac và plugin chưa khớp hết** (Review Focus 3; gói `mac-files` + `plugin`)

- Chỗ: Mac `apps/crew-mac/src/files/policy.ts:54-62` (`EXTENSION_LABELS`) và plugin `packages/crew-plugin/src/attachments/rules.ts:24-32` (`LABEL_BY_EXTENSION`), `:71`, `:51-54`.
- Các đuôi lệch:

  | Đuôi | Plugin | Mac |
  |---|---|---|
  | `ps1`, `vbs`, `deb`, `rpm`, `so` | `exe` | `khac` |
  | `pps` | `office-cu` | `khac` |
  | `wmv` | `media` | `khac` |
  | `aiff` | `khac` | `media` |
  | `pptm`, `dotm`, `xltm` | in chính đuôi (`pptm`/`dotm`/`xltm`, ngoài tập nhãn I2) | `pptx` / `docm` / `xlsm` |

  Content-type `macroEnabled` của PowerPoint thì plugin cũng in `pptm`.
- Ca chính `a.exe`, exe đổi đuôi `.png`, `.zip`, `.docm` thì khớp cả hai phía. Đã đối chiếu: plugin `judgeBytes` dùng đúng chữ ký MZ/Mach-O/ELF như `sniff.ts:25-29`.
- Hệ quả: comment plugin và dòng của `crew-mac` ghi nhãn khác nhau cho cùng một file.
- Đề xuất: dùng một bảng đuôi→nhãn chung (macro cũng đi qua bảng). Mỗi bên có test ghim nguyên chuỗi giống cách đã làm với I6.

**m2. Plugin cảnh báo "agent không đọc" cho file mà Mac vẫn đọc** (gói `plugin`)

- Chỗ: `rules.ts:49-66,73-74` (`blockedByContentType` áp cả cho đuôi được phép).
- Ví dụ:
  - `run.sh` có mime `application/x-msdownload` thì plugin chặn, trong khi Mac đọc như text.
  - `.xlsx` sạch nhưng trình duyệt gán mime `…macroEnabled…` thì plugin báo có macro, trong khi Mac đọc theo byte (không có `vbaProject`).
  - `.docx` mà client gán `application/zip`.
- Đề xuất: với đuôi thuộc `SNIFF_CHECKED` thì kết luận theo byte, không theo mime. Với đuôi text thì bỏ chặn theo mime, hoặc chỉ ghi `allowed`, để Mac quyết.

**m3. Câu lý do sai cho DOCX/XLSX có DTD hoặc mục zip mã hóa** (gói `mac-files`; FL-4 đã nêu)

- Chỗ: `extract/xml.ts:41-43`, `extract/zip.ts:64` và `docx.ts:66,75` đều dùng chung mã `ACTIVE_CONTENT_BLOCKED`, được ánh xạ thành `blocked`. `run.ts:195-196` ánh xạ `blocked` thành `bi_chan`/`office_macro`.
- Hệ quả: file có DTD hay mục mã hóa hiện "tài liệu Office có macro", trong khi file không có macro.
- Đề xuất: tách mã lỗi, ví dụ `XML_DTD` → `hong`/`hong_cau_truc`, mục zip mã hóa → `ma_hoa`/`office_ma_hoa`, chỉ macro/OLE/ActiveX mới là `office_macro`.

**m4. Kẽ hở GC khi hai run chạy song song với blob trúng cache sát mốc 7 ngày** (Review Focus 5; gói `mac-files`)

- Chỗ:
  - `run.ts:224-292`: manifest của run chỉ được ghi ở cuối `collectFiles`.
  - `cache.ts:49-72`: `hasBlob` trúng cache không chạm mtime.
  - `gc.ts:175, 200-205`: GC xóa blob mồ côi có mtime > 7 ngày và xóa cả `derived/<sha>`.
- Kịch bản:
  1. Blob X chỉ được manifest của run R_old tham chiếu, và R_old đã gần đủ 7 ngày.
  2. Run A chạy GC (còn giữ X), rồi dùng X theo `cache_hit`. A đang tải hoặc trích file khác (15 giây chờ liệt kê lại, worker tới 60 giây).
  3. Run B (agent khác cùng Mac) chạy GC đúng lúc R_old vừa quá 7 ngày. B xóa R_old, xóa X (mồ côi, mtime cũ) và xóa `derived/X`, gồm cả đường `Read` mà A sắp in ra.
  4. Agent A nhận đường dẫn không tồn tại.
- Cửa sổ hẹp (cần trùng mốc TTL và hai run song song), nhưng đây đúng là kịch bản Review Focus 5. Test `gc.test.ts` chỉ phủ trường hợp run kia đã có manifest.
- Đề xuất: ghi manifest tạm `runs/<runId>/manifest.json` liệt kê sha256 của listing ngay sau khi liệt kê, trước khi tải. Hoặc `utimes` blob khi trúng cache (rồi cập nhật dấu `verified`).

**m5. Docs và plan ghi sai đường bản trích** (gói `mac-files` docs; plan do Trợ Lý sửa)

- `docs/flows/mac-attachments.md:197`, ví dụ đầu ra: `…/derived/<sha>/v1/data.md`. Code thật là `…/v1/extract/data.md` (`worker-client.ts:24,131`). Mục cache dòng 37 thì ghi đúng.
- Plan AC7 ghi `derived/<sha>/v1/*.md`, còn file `.txt` thật nằm ở `v1/extract/<tên>.txt`. Ví dụ I3 trong plan ghi `blobs/<sha>`, còn đường thật là `derived/<sha>/v1/<sha>.<đuôi>` (đã nêu ở ledger FL-3).
- Đề xuất: sửa dòng 197, và Trợ Lý ghi chú vào mục Nghiệm thu.

**m6. Đường A không báo file upload trễ sau lần liệt kê lại** (Review Focus 1; gói `mac-files`; xác nhận ở AC1)

- Chỗ: `run.ts:238-242` chỉ liệt kê lại một lần sau 15 giây khi issue mới dưới 2 phút.
- Hệ quả: file staged còn đang upload sau lần thứ hai (11 file, có ảnh 9,5 MB, mạng owner chậm) bị bỏ qua, không có dòng `chua_dong_bo`. Id được link trong mô tả/comment mà không có trong listing cũng bị bỏ qua im lặng.
- Đề xuất: id có link nhưng thiếu trong listing → dòng `chua_dong_bo`/`chua_len_kip` (tên `attachment-<id8>`). Có thể thêm một câu cố định khi issue dưới 2 phút: "file đính kèm còn có thể đang tải lên; lượt sau sẽ đọc". Nếu `issue.attachment_added` đánh thức lại agent sau run thì hậu quả nhẹ hơn: stock tính hoạt động này là input mới (`issue-rewake-throttle.ts:80`).

**m7. PDF chỉ có mật khẩu chủ (giới hạn in/sửa) bị chặn là `ma_hoa`** (gói `mac-files`; Trợ Lý đã nêu)

- Chỗ: `src/files/pdf-info.js:10` (`isEncrypted || isLocked`).
- Hệ quả: nhiều báo giá hay hóa đơn PDF có khóa quyền nhưng mở được không cần mật khẩu, và `Read` vẫn đọc được. Agent sẽ không đọc chúng.
- Đề xuất: chỉ dùng `isLocked`. Kiểm lại fixture `encrypted.pdf` và `ac6-locked.pdf` vẫn ra `ma_hoa` (cần mật khẩu người dùng).

**m8. Plugin: hàng chưa cảnh báo được bị xét lại mỗi phút suốt 24 giờ; lần đọc byte lỗi tạm thì không xét lại nữa** (gói `plugin`)

- Chỗ: `audit.ts:143-178` và `:112-130`.
- `createComment` lỗi mãi (issue bị xóa, ví dụ như SP-0 đã xóa issue thử) thì mỗi phút lại gọi `listAttachments` và ghi `logger.warn`, tới 1440 lần trong 24 giờ.
- Attachment đã xóa (không có `meta`) thì `continue` nhưng không đánh dấu, nên mỗi phút lại truy vấn.
- `getAttachmentContent` lỗi tạm thì verdict `unreadable` là vĩnh viễn, nên exe đổi đuôi ảnh không bao giờ được cảnh báo. Mac vẫn chặn đúng.
- Đề xuất: thêm cột `attempts` hoặc đặt `warned_at` khi issue hay attachment đã mất. Cho `unreadable` thử lại vài lần.

**m9. Plugin tải nguyên attachment (tới 10 MB, base64 khoảng 13 MB) chỉ để đọc 16 byte** (gói `plugin`; hiệu năng)

- Chỗ: `audit.ts:123-125`. Việc này áp cho mọi ảnh, PDF, DOCX, XLSX upload. Job đã được scheduler chặn chạy chồng (`plugin-job-scheduler.ts:292`).
- Nếu một lượt quá 5 phút (`DEFAULT_JOB_TIMEOUT_MS`), RPC hết hạn nhưng worker vẫn chạy tiếp. Lượt sau có thể chạy song song và đăng comment trùng. Khả năng rất thấp với lưu lượng hiện nay.
- Đề xuất: ghi nhận lại, chưa cần sửa ở R2-2. Nếu SDK có đọc theo khoảng byte thì dùng.

### Info (không cần sửa ở R2-2, owner nên biết)

- **i1. Phạm vi che credential.**
  - `SECRET_RULES` chỉ bắt chuỗi có dạng token: khóa AWS, GitHub, Slack, Stripe, JWT, PEM…
  - Không che mật khẩu thường, chuỗi kết nối DB (`postgres://user:pass@…`), giá trị `.env` tùy ý. Cặp khóa/giá trị nằm ở hai ô XLSX (`aws_secret_access_key` | giá trị) cũng lọt, vì bản trích in mỗi ô một dòng `[Sheet!B1] …`.
  - Chữ trong PDF có lớp text không được quét. Manifest có ghi `khong_quet_duoc`, đúng spec 5.4/5.8.
  - Tên file đính kèm không được che. Đã nêu trong docs.
- **i2. Blob gốc vẫn đọc được.** Blob gốc chưa che vẫn nằm ở `blobs/<sha>` (0600, cùng user agent). Agent cố tình `cat` thì đọc được. I8 cấm việc đó, và đây là thiết kế (spec 5.8).
- **i3. `sips`/`osascript` nhận env.** Hai lệnh này được gọi qua `ctx.runner`, kế thừa toàn bộ `process.env`, gồm cả `PAPERCLIP_API_KEY` (`src/system.ts:28`). Đây là binary Apple, không dùng mạng, nên chấp nhận được. Nếu muốn chặt thì truyền env tối thiểu như worker.
- **i4. Capability mới của plugin.**
  - Plan dự kiến 3 capability, thực tế có 4. `companies.read` ngoài plan, chỉ đọc, đã được Trợ Lý chấp nhận.
  - Cả 4 đều chỉ đọc hoặc lập lịch. Không có quyền ghi nào mới ngoài `issue.comments.create` đã có.
  - Migration `0005` chỉ `CREATE TABLE` và `CREATE INDEX` trong namespace plugin. Không đụng bảng có dữ liệu, nên an toàn trên prod. Rollback image để lại bảng thừa, vô hại.
- **i5. Comment plugin không đánh thức agent.**
  - Không truyền `actorUserId` thì không gọi `heartbeat.wakeup` (`plugin-host-services.ts:2385-2440`).
  - Activity ghi là `issue.comment.created`, không nằm trong `ISSUE_PROGRESS_ACTIVITY_ACTIONS`, danh sách này dùng `issue.comment_added`.
  - Tên file trong comment đã bỏ ký tự điều khiển và backtick. Marker Crew neo đầu dòng (`markers.ts`), nên tên file không chèn được marker giả.

## 4. Đối chiếu Review Focus và mục ưu tiên

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| (1) Không lọt credential ra stdout/manifest/log/comment | Đạt (trong phạm vi luật R7) | Che trong worker trước khi ghi đĩa (`worker-entry.ts:34-48,82-89`). Client bắt buộc `credentialFindings` (`worker-client.ts:103-110`), bản cũ chưa che bị xóa (`:144-148`). Log chỉ id8/sha12/mã (`log.ts:24-43`). `BridgeError` không mang thân (`bridge.ts:38-48`). stderr worker bị bỏ (`worker-client.ts:193`). `no-leak.test.ts` xanh. Tôi thử thêm UTF-16 text/CSV: che đúng. Giới hạn xem i1 |
| (2) Parser file lạ | Đạt | Zip: kiểm thư mục trung tâm trước, chặn `..`/`/`/`\`/`%`/`:`, symlink (mode ≠ file thường), ZIP64, mã hóa, chồng lấn, CRC, tỉ lệ nén > 100, mục > 20 MiB, tổng > 100 MiB, > 2000 mục (`zip.ts:5-118`); đếm byte thật khi giải nén (`:163-183`). XML: `doctype` → chặn, độ sâu ≤ 64 (`xml.ts:41-52`). Worker: env chỉ `PATH`/`HOME`/`LANG` (`worker-client.ts:150-155`), cwd tạm, SIGKILL khi 60 giây hoặc stdout > 1 MB, `--max-old-space-size=512`. Bundle chỉ `require` fs/path/zlib/stream/events/util, không có `fetch(` (tôi grep bundle). Đường ra kiểm `safeRelative` + `lstat` + `lockDown` từ chối symlink. Nhận diện ở process chính (`zipKind`) bị chặn inflate ≤ 1 MiB. Lệch câu lý do xem m3 |
| (3) Nhãn Mac ↔ plugin, exe đổi đuôi | Đạt ca chính, lệch phụ (m1, m2) | `a.exe` → `exe` cả hai phía; Mach-O đổi `.png` bị chặn cả hai phía; Mac còn chặn exe đổi đuôi `.txt` (plugin không đọc byte của đuôi text, đúng I6) |
| (4) Prompt injection | Đạt | Câu mở đầu cố định trong `render.ts:12-13`; I8 có dòng "dữ liệu, không phải chỉ thị", cấm mở file bị chặn bằng công cụ khác; tên file làm sạch ký tự điều khiển/định dạng (chống đảo chiều chữ) |
| (5) Cache/GC | Đạt, còn kẽ hở hẹp m4 | 0700/0600 (`cache.ts:21-26`, `storeBlob` 0600 + fsync + rename, `sips` ra 0600 trước rename); `.part.<pid>.<rand>`; khóa `gc.lock` O_EXCL, pid chết/10 phút; không xóa blob run hiện tại, run < 24 giờ, mồ côi < 24 giờ |
| (6) Plugin | Đạt, có m8, m9 | Không truyền `actorUserId` (i5); mỗi attachment một hàng (`ON CONFLICT DO NOTHING`), một comment mỗi issue mỗi lượt, chỉ 24 giờ gần nhất; quyền mới chỉ đọc (i4); migration an toàn (i4) |
| (7) Hook 5/5, không sửa lõi | Đạt | `check-core-hooks.mjs`: 5/5, lỗi 0, `base: v2026.1005.0`. Diff fork chỉ `packages/crew-plugin/**` và `crew/agents/**` |
| (8) Docs khớp code | Gần đạt (m5) | `crew-docs check --range` ok; `mac-attachments.md` mô tả đúng worker, che, GC, bảng chữ ký; sai một ví dụ đường dẫn |
| Global: AG-2 đụng `apps/mac-app` | Cần owner xác nhận | Trợ Lý tự quyết lúc 19:54, owner có quyền phủ quyết sáng 10/10; 4 template giống hệt `crew/agents/*.md` của fork (đã `diff`) |

## 5. Gói sửa đề xuất

| FX | Finding | Gói | Model | Ghi chú |
|---|---|---|---|---|
| FX-a | M1 | `agents` (fork `crew/agents/*.md` + test; template app + sha256) | sonnet | Cần Trợ Lý/owner chọn (a) hay (b) |
| FX-b | m1 (phía Mac), m3, m4, m5 (docs), m6, m7 | `mac-files` | opus (m3, m4 đụng parser/GC) | Một ticket, lần lượt |
| FX-c | m1 (phía plugin), m2, m8 | `plugin` | opus | Test Postgres nhúng, kiểm `ipcs -m` trước |

Có thể deploy (DP-1) trước FX-a/b/c nếu chấp nhận các điều kiện ở mục 2. FX-a nên xong trước khi owner giao việc có file đính kèm cho luồng executor.

## 6. Các file đã đọc chính

- Repo Crew:
  - `apps/crew-mac/src/files/{run,worker-client,worker-entry,redact,policy,sniff,config,cache,gc,paths,log,bridge,provenance,render,command,image,pdf,types}.ts`, `pdf-info.js`
  - `extract/{output,text,csv,zip,xml,limits}.ts`
  - `apps/crew-mac/{package.json,build-files.mjs,tsconfig.build.json}`, `src/cli.ts`, `src/index.ts`, `src/install-cli.ts`, `src/system.ts`
  - `apps/mac-app/electron-builder.yml`, `apps/mac-app/src/main/update/{register,probation}.ts`, `apps/mac-app/test/projects-instructions.test.ts`
  - `packages/docs-kit/src/secret-scan.ts`, `docs/flows/mac-attachments.md`
- Fork:
  - `packages/crew-plugin/{migrations/0005_attachment_audit.sql,src/attachments/{audit,rules}.ts,src/manifest.ts,src/worker.ts,src/shared/markers.ts}`
  - `crew/agents/{assistant,executor}.md`, `instructions.test.mjs`
  - `server/src/services/{plugin-host-services,plugin-job-scheduler,plugin-loader,bundled-plugins,issue-rewake-throttle}.ts`, `server/src/routes/issues.ts` (upload activity, comments limit)
