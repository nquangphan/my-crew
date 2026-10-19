# Crew v3 R2-2: gói `probe` (SP-0, cổng G0), kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đo trên prod xem bridge callback stock có chở nổi attachment 1–9,5 MB tới Mac mini trong hạn không. Ghi kết quả vào `probe-report.md` để Trợ Lý chọn đường A (bridge) hoặc B (đẩy qua SSH sau H1). Cùng run đó đo thêm những giả định spec §10 còn bỏ ngỏ.

**Architecture:** Bản ghi thử tự dọn trên prod:
- project `r22-probe` trong company TPS (company của R1);
- environment SSH `r22-probe` dùng chung secret SSH của environment R1, `remoteCwd` là `~/crew-r22-probe/ws`;
- agent `claude_local` `r22-probe`, `engine=cli`, model `sonnet`, `maxConcurrentRuns = 1`, instructions chỉ là quy trình đo;
- một issue có 7 attachment, giao cho agent đó.

Một run duy nhất chạy script đo `~/crew-r22-probe/bridge-probe.mjs`. Script tải từng attachment qua `$PAPERCLIP_API_URL` với token bridge, rồi agent `Read` các file mẫu. Đo xong thì dọn: agent bị xóa, environment archive (giống SP-2 R2-1), project và issue xóa, thư mục tạm xóa.

**Tech Stack:** Node ≥ 22 trên Mac (`/opt/homebrew/bin/node`), `curl` trên VPS (upload multipart), shim `api.sh` của VPS (cách R2-1 SP-2/DP-3), `sips`, PDFKit qua `osascript -l JavaScript`.

**Spec:** [plan.md](plan.md) (Global Constraints, G0, Interface I3) và spec §4.2, §5.2, §7 bước 0, §10.

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng SP-0:

- Không dùng project `2ps-landing` và không giao issue cho agent R1. Chỉ một run thật. Nếu run hỏng vì lỗi dựng (không phải do bridge), được sửa và chạy lại tối đa 1 lần. Ghi lý do vào ledger.
- Backup trước khi tạo bản ghi: `/opt/crew-v3-spike/ops/backup.sh`, ghi mã backup vào ledger. Kiểm `active-runs.sh` rỗng trước khi giao issue.
- Mọi body JSON và file gửi lên VPS đi bằng `scp` vào `/tmp/crew-r22-probe/`, rồi lệnh trên VPS đọc `"$(cat file)"` hoặc `curl -F file=@…`. Không nhúng nội dung vào chuỗi lệnh `ssh`.
- Không in, ghi log hay ghi ledger bất kỳ key/token/cookie nào. Script đo không in `PAPERCLIP_API_KEY`.
- Ghi mọi bản ghi tạm (id rút gọn 8 ký tự) và thư mục tạm vào [processes.md](processes.md) ngay khi tạo; đánh "đã gỡ" khi dọn.

---

### Task 1 (SP-0): Đo bridge, giới hạn `Read`, quyền đọc tổ tiên

**Files:**
- Create (ngoài repo, xóa cuối task): `~/crew-r22-probe/bridge-probe.mjs`, `~/crew-r22-probe/make-samples.sh`, `~/crew-r22-probe/samples/*`, `~/crew-r22-probe/ws/` (thư mục làm việc của environment), VPS `/tmp/crew-r22-probe/*`
- Create: `plans/261009-1945-crew-v3-r2-2/probe-report.md`
- Modify: `plans/261009-1945-crew-v3-r2-2/{sdd-ledger.md,processes.md}`

**Interfaces:**
- Consumes: không có.
- Produces (ghi trong `probe-report.md`, các ticket sau đọc):
  - `G0: A` hoặc `G0: B` kèm bảng số đo;
  - `READ_LIMITS`: cỡ ảnh tối đa `Read` nhận, PDF có cần `pages` khi > 10 trang không, số trang tối đa một lần;
  - `ANCESTOR_VIA_BRIDGE`: `yes`/`no`;
  - `LINK_FORMS`: chuỗi link thật mà UI chèn cho ảnh và cho file thường;
  - `LISTING_FIELDS`: các trường của `GET /api/issues/:id/attachments` và của `heartbeat-context.attachments`, có hay không có `issueCommentId`, `sha256`;
  - `COMMENT_ORDER`: thứ tự mặc định của `GET /api/issues/:id/comments`.

- [ ] **Step 1: Chuẩn bị mẫu trên Mac.** `make-samples.sh` tạo trong `~/crew-r22-probe/samples/`:
  - `p300k.png`, `p1m.png`, `p5m.png`, `p95m.png`: PNG ảnh nhiễu, cỡ đúng 300 KB / 1 MiB / 5 MiB / 9,5 MiB (±1%). Sinh bằng Node: IDAT không nén (zlib level 0) chứa byte ngẫu nhiên, kích thước ảnh chọn theo cỡ.
  - `photo.heic`: từ `p1m.png` bằng `sips -s format heic`.
  - `doc30.pdf`: 30 trang, mỗi trang một dòng "Trang N / 30". Ghép bằng JXA PDFKit: `PDFDocument.alloc.init`, `insertPageAtIndex` từ PDF một trang do `sips -s format pdf` tạo.
  - Ghi `shasum -a 256` của từng mẫu vào `samples/SHA256SUMS`.
- [ ] **Step 2: Script đo** `bridge-probe.mjs`. Script chạy trong run, đọc env `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_TASK_ID` và không in chúng.
  1. `GET /api/issues/$TASK/heartbeat-context`, `GET /api/issues/$TASK`, `GET /api/issues/$TASK/attachments`, `GET /api/issues/$TASK/comments`. Mỗi lệnh ghi mã HTTP, thời gian, và **tên các trường** của JSON (không ghi giá trị text).
  2. Với từng attachment PNG theo thứ tự 300 KB → 1 MB → 5 MB → 9,5 MB, mỗi cái 3 lần liên tiếp: `GET /api/attachments/<id>/content` (header `Authorization: Bearer …`, `AbortSignal.timeout(60000)`). Ghi `ms`, mã HTTP, số byte nhận, sha256 so với `sha256` trong listing. Lỗi thì ghi tên lỗi (`TimeoutError`, `fetch failed`…), không ghi thân.
  3. Đọc `parentId`/ancestors từ heartbeat-context. Với issue cha (Step 4 tạo, có 1 attachment `p300k.png`): `GET /api/issues/<parent>/attachments`, rồi tải attachment đó. Ghi mã HTTP.
  4. Ghi `/tmp` không được: viết kết quả JSON vào `~/crew-r22-probe/out/result.json` và in ra stdout dạng bảng markdown.
- [ ] **Step 3: Agent đo tạm.** Trên VPS, qua `api.sh`, body bằng scp:
  1. Tạo environment SSH `r22-probe` (dùng chung secret SSH của environment R1, cách SP-2 R2-1), `remoteCwd` = `/Users/<user>/crew-r22-probe/ws`, mode `in_place`.
  2. Tạo agent `r22-probe` `claude_local` với `adapterConfig: { engine: "cli", model: "sonnet", env: {} }`, `runtimeConfig` chép từ agent R1 trừ `extraArgs` riêng của R1, `maxConcurrentRuns: 1`, `defaultEnvironmentId` = environment trên.
  3. PUT `AGENTS.md` có nội dung:
     - Bước 1. Chạy `node ~/crew-r22-probe/bridge-probe.mjs`, dán nguyên văn bảng kết quả vào một comment.
     - Bước 2. `Read` `~/crew-r22-probe/samples/p95m.png` và ghi "đọc được, kích thước W×H" hoặc nguyên văn lỗi tool.
     - Bước 3. Chạy `sips -s format jpeg ~/crew-r22-probe/samples/photo.heic --out ~/crew-r22-probe/out/photo.jpg`, `Read` file jpg, ghi kết quả.
     - Bước 4. `Read` `~/crew-r22-probe/samples/doc30.pdf` không `pages`, ghi kết quả. Rồi `Read` với `pages: "1-20"` và `"21-30"`, ghi số trang thấy được.
     - Bước 5. Đăng một comment kết quả rồi dừng; không sửa file nào khác, không đổi trạng thái issue.
  Ghi id rút gọn vào `processes.md`.
- [ ] **Step 4: Issue đo.**
  1. Tạo project `r22-probe`, issue cha "R2-2 đo cha" (không giao ai). Upload `p300k.png` vào issue cha.
  2. Tạo issue con "R2-2 đo bridge" (`parentId` = issue cha, chưa giao). Upload lần lượt `p300k.png`, `p1m.png`, `p5m.png`, `p95m.png` (multipart `curl -F file=@…` trên VPS, file đưa lên bằng scp).
  3. PATCH mô tả issue con có một link ảnh `![](/api/attachments/<id p300k>/content)` và một link file thường như UI chèn. Đọc mã `ui/src/pages/IssueDetail.tsx` để biết dạng link cho file không phải ảnh, ghi vào `LINK_FORMS`.
  4. Thêm 1 comment board có ảnh dán (upload kèm `issueCommentId` nếu route nhận; không nhận thì ghi `issueCommentId` luôn null khi upload qua route issue).
  5. Kiểm `active-runs.sh` rỗng, rồi giao issue con cho `r22-probe` (status `todo`). Ghi `date`.
- [ ] **Step 5: Theo dõi run** bằng `crew/ops/watch-run.sh` hoặc poll `GET /api/heartbeat-runs/<id>` mỗi 20 giây, tối đa 15 phút. Run xong thì đọc comment kết quả, chép bảng số vào `probe-report.md`. Run kẹt quá 15 phút thì cancel. Đường lui là ghi "không đo được", báo Trợ Lý.
- [ ] **Step 6: Đối chiếu ngoài run (không tốn quota).**
  - Đọc `server/src/routes/issues.ts` (upload l.18373) để biết `issueCommentId` được gán thế nào khi dán ảnh vào comment.
  - Đọc `heartbeat-context` l.8414 để biết `attachments[]` có thuộc ancestors hay không.
  - Ghi vào `LISTING_FIELDS`.
- [ ] **Step 7: Dọn.**
  - Pause rồi xóa agent `r22-probe` (GET 404).
  - Archive environment (không DELETE, vì xóa sẽ xóa secret dùng chung).
  - Xóa issue con, issue cha, project (GET 404).
  - `rm -rf ~/crew-r22-probe /tmp/crew-r22-probe` (VPS: `ssh … 'rm -rf /tmp/crew-r22-probe'`).
  - `active-runs.sh` rỗng.
  - Đánh dấu "đã gỡ" trong `processes.md`.
- [ ] **Step 8: Viết `probe-report.md`.** Gồm:
  - bảng 12 lần tải (cỡ × lần: ms, HTTP, byte, sha khớp);
  - kết luận G0 theo luật "mọi lần của 1 MB, 5 MB, 9,5 MB < 25 000 ms và sha khớp → `G0: A`, ngược lại `G0: B`" (300 KB chỉ để tham khảo);
  - `READ_LIMITS`, `ANCESTOR_VIA_BRIDGE`, `LINK_FORMS`, `LISTING_FIELDS`, `COMMENT_ORDER`;
  - backup, giờ bắt đầu/kết thúc theo `date`, danh sách bản ghi đã dọn.
  
  Nếu `ANCESTOR_VIA_BRIDGE = no` mà `G0: A`, ghi rõ hệ quả: đường A không đọc được file issue cha, nên Trợ Lý phải cân nhắc B hoặc chấp nhận. Trợ Lý quyết, ghi ledger.
- [ ] **Step 9: Ghi ledger** một dòng: giờ, model, kết quả G0, đường dẫn report. Không commit (plan nằm trong repo Crew nhưng Trợ Lý commit plan sau).

Kết thúc bằng `Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`.
