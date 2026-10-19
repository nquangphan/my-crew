# SP-0 — Đo bridge stock (cổng G0)

- Giờ (theo `date`, Asia/Ho_Chi_Minh): bắt đầu 19:54, run đo 20:01:27–20:03:17, dọn xong 20:11.
- Model: opus (agent general-purpose). Agent đo trên prod: `claude_local`, `claude-sonnet-5`, `engine=cli`.
- Prod `https://crew.2p-solutions.com` image `v3-c301d7608`. Backup trước khi tạo bản ghi: **`20261009-1956`** (`backup 20261009-1956 ok: 9.7M total, builtin=ok`). `active-runs.sh` rỗng trước khi giao issue và sau khi dọn.
- Báo cáo này thay cho `probe-report.md` mà `probe.md` nhắc tới (Trợ Lý chỉ định đường dẫn này).

## Kết luận

**G0: A** (bridge stock). Cả 9 lần tải của 1 MB, 5 MB và 9,5 MB đều xong dưới 25 000 ms (chậm nhất 5 198 ms) và sha256 khớp. Lần chậm nhất còn cách ngưỡng 4,8 lần.

`ANCESTOR_VIA_BRIDGE = yes`, nên đường A cũng đọc được file của issue cha. Không có hệ quả nào buộc phải cân nhắc đường B. Trợ Lý bỏ SV-1 và FL-B. `ATTACHMENT_TRANSPORT = 'bridge'`.

Spec §4.2 đoán bridge file-queue không chở nổi file vài trăm KB (57 kết nối SSH cho 1 MB). Số đo bác dự đoán này: 9,5 MB chỉ mất khoảng 4–5 giây. Em không đọc lại code bridge để giải thích vì sao nhanh, vì việc này ngoài phạm vi SP-0.

## Bảng 12 lần tải (trong run, qua `$PAPERCLIP_API_URL`, token bridge, timeout 40 s mỗi lần)

| File | Cỡ (byte) | Lần | HTTP | ms | Byte nhận | sha256 khớp | Lỗi |
|---|---|---|---|---|---|---|---|
| p300k.png | 307 628 | 1 | 200 | 1 220 | 307 628 | có | — |
| p300k.png | 307 628 | 2 | 200 | 1 320 | 307 628 | có | — |
| p300k.png | 307 628 | 3 | 200 | 1 426 | 307 628 | có | — |
| p1m.png | 1 048 652 | 1 | 200 | 1 425 | 1 048 652 | có | — |
| p1m.png | 1 048 652 | 2 | 200 | 1 939 | 1 048 652 | có | — |
| p1m.png | 1 048 652 | 3 | 200 | 1 329 | 1 048 652 | có | — |
| p5m.png | 5 241 265 | 1 | 200 | 4 021 | 5 241 265 | có | — |
| p5m.png | 5 241 265 | 2 | 200 | 3 608 | 5 241 265 | có | — |
| p5m.png | 5 241 265 | 3 | 200 | 2 393 | 5 241 265 | có | — |
| p95m.png | 9 962 452 | 1 | 200 | 4 059 | 9 962 452 | có | — |
| p95m.png | 9 962 452 | 2 | 200 | 5 198 | 9 962 452 | có | — |
| p95m.png | 9 962 452 | 3 | 200 | 4 066 | 9 962 452 | có | — |

Sha256 được so với trường `sha256` của `GET /api/issues/:id/attachments`. Mẫu là PNG ảnh nhiễu, IDAT không nén (sinh bằng Node), cỡ lệch đích dưới 0,14 %.

Upload lên prod bằng board multipart từ VPS: 300 KB 201–308 ms, 1 MB 232 ms, 5 MB 292 ms, 9,5 MB 644 ms.

Mỗi lời gọi JSON qua bridge mất khoảng 1,3–2,6 s: `heartbeat-context` 1 339 ms, `issue` 1 621 ms, `attachments` 2 634 ms, `comments` 1 621 ms. `crew-mac files` gọi vài lời như vậy mỗi lượt, nên FL-3 cần tính khoản chi phí cố định khoảng 1,5 s mỗi request này.

## READ_LIMITS

Đo bằng Claude Code 2.1.295, model `claude-sonnet-5` trên Mac mini.

- PNG 9 962 452 byte, 1822×1822: tool `Read` báo "đọc được, kích thước 1822×1822". Không lỗi.
- HEIC (218 809 byte, đổi từ `p1m.png`) chuyển sang JPEG bằng `sips -s format jpeg`, rồi `Read` file JPEG: đọc được, 591×591.
- PDF 30 trang, đọc không kèm `pages`, bị từ chối. Lỗi nguyên văn: `This PDF has 30 pages, which is too many to read at once. Use the pages parameter to read specific page ranges (e.g., pages: "1-5"). Maximum 20 pages per request.`
- `pages: "1-20"` đọc được trang 1 / 30 tới 20 / 30. `pages: "21-30"` đọc được trang 21 / 30 tới 30 / 30.
- Tóm lại:
  - ảnh cỡ ≤ 9,5 MB, cạnh 1822 px thì `Read` nhận;
  - PDF trên 20 trang bắt buộc kèm `pages`;
  - mỗi lần `Read` tối đa 20 trang.

  Lần này không có PDF từ 11 đến 20 trang, nên chưa biết PDF trong khoảng đó có bắt buộc kèm `pages` không. Thông báo lỗi chỉ nêu "too many" khi có 30 trang. Ngưỡng ảnh mà `Read` từ chối cũng chưa tìm ra, vì mẫu lớn nhất 9,5 MB vẫn qua. FL-2 nên giữ luật thu nhỏ ảnh trên 5 MB hoặc cạnh trên 8000 px theo plan.
- Agent tự đọc thêm ảnh dán trong comment 1 (`cmt.png`, tải qua bridge `/api/attachments/714f2a36…/content`, HTTP 200, 307 628 byte). Kết quả: đọc được, 320×320.

## ANCESTOR_VIA_BRIDGE: `yes`

- `heartbeat-context` có `issue.parentId` và `ancestors` (1 phần tử).
- Agent gọi `GET /api/issues/<cha>/attachments` qua bridge: HTTP 200, 1 file, 1 629 ms.
- Agent tải `p300k.png` của issue cha: HTTP 200, 1 533 ms, sha256 khớp.
- `heartbeat-context.attachments` chỉ chứa attachment của chính issue đó (`svc.listAttachments(issue.id)`, `server/src/routes/issues.ts` l.8414–8460), không có file của tổ tiên. Vì vậy `crew-mac files` phải tự gọi listing cho từng issue tổ tiên.

## LINK_FORMS

Rút từ fork `c301d7608`:

- **Ảnh trong mô tả.** `InlineEditor` → `MarkdownEditor` `imageUploadHandler` (`ui/src/pages/IssueDetail.tsx` l.7383–7386) trả `attachment.contentPath`. MDXEditor chèn `![<alt>](/api/attachments/<uuid>/content)`. Link là đường dẫn tương đối, không có origin.
- **Ảnh trong comment.** Nút kẹp giấy (`CommentThread.tsx` l.915–931) chỉ nhận `image/png,image/jpeg,image/webp,image/gif`. Nó chèn `![<tên file, [] được escape>](/api/attachments/<uuid>/content)`. Dán hoặc kéo ảnh vào editor đi qua `imageUploadHandler`, cũng ra dạng `![…](/api/attachments/<uuid>/content)`.
- **File thường (không phải ảnh).** Kéo vào mô tả thì gọi `onDropFile` (`MarkdownEditor.tsx` l.1449–1466 → `uploadAttachment`). Hàm này chỉ upload, **không chèn link nào**. File chỉ có mặt trong danh sách attachment của issue, với `issueCommentId = null`.

  Hệ quả cho provenance (FL-3): file thường không có link trong mô tả, nên phải xếp nó là "đính kèm issue" theo listing. Không được coi nó là mồ côi.
- **Hộp thoại tạo issue.** `NewIssueDialog.tsx` l.698 cũng trả `asset.contentPath`, cùng dạng.
- Trong lần đo, mô tả được PATCH bằng API với `![p300k.png](/api/attachments/<id>/content)` và `[p1m.png](/api/attachments/<id>/content)`. Dạng thứ hai là giả lập link file thường; UI không tự sinh dạng này.

## LISTING_FIELDS

- `GET /api/issues/:id/attachments` (board và bridge giống nhau). Trường:

  `assetId, byteSize, companyId, contentPath, contentType, createdAt, createdByAgentId, createdByUserId, downloadPath, id, issueCommentId, issueId, objectKey, openPath, originalFilename, originatingRunId, provider, sha256, updatedAt`

  Có **`sha256`** và có **`issueCommentId`**. Thứ tự: mới nhất trước.
- `heartbeat-context.attachments[]`. Trường:

  `byteSize, contentPath, contentType, createdAt, filename, id`

  **Không có `sha256`, không có `issueCommentId`**, và tên file nằm ở `filename`, không phải `originalFilename`. Vì vậy cần sha256 hay provenance thì phải gọi listing.
- `heartbeat-context` có các khóa gốc:

  `ancestors, attachments, commentCursor, continuationSummary, currentExecutionWorkspace, documentReviewContext, goal, issue, planReviewContext, project, wakeComment`

  `issue` có `parentId` và `description`.
- **`issueCommentId` được gán thế nào.**
  - Route upload (`issues.ts` l.18373–18460) nhận `issueCommentId` trong multipart metadata (`createIssueAttachmentMetadataSchema`). Upload không kèm trường này thì giá trị là `null`.
  - Khi tạo comment với `attachmentIds: [...]`, server gán `issueCommentId` cho các attachment đó.
  - Đo thật: upload `cmt.png` ra `null`. Sau `POST /issues/:id/comments {body, attachmentIds:[714f2a36…]}`, listing trả `issueCommentId = 75518edc` (id comment).
  - UI comment gửi `attachmentIds` (`IssueDetail.tsx` l.6297 `addComment.mutateAsync({ body, reopen, attachmentIds, … })`).
  - Bản ghi comment trong `GET /comments` không có trường `attachments`.

## COMMENT_ORDER

`GET /api/issues/:id/comments` mặc định trả **`desc`** (mới nhất trước), đo qua bridge và qua board đều vậy. Server chỉ đổi sang `asc` khi có `?order=asc` (`issues.ts` l.15216). Route còn nhận `after`/`afterCommentId` và `limit`.

Trường của comment:

`authorAgentId, authorType, authorUserId, body, clientRequestId, companyId, conversationSessionGeneration, createdAt, createdByRunId, deletedAt, deletedByAgentId, deletedByRunId, deletedByType, deletedByUserId, derivedAuthorAgentId, derivedAuthorSource, derivedCreatedByRunId, id, issueId, metadata, onBehalfOfUserId, presentation, sourceTrust, updatedAt`

## Cách dựng và quyết định kỹ thuật em tự chốt (owner vắng)

1. **Mẫu PDF.** Em sinh PDF 30 trang bằng Node (PDF tối giản, Helvetica, mỗi trang "Trang N / 30") thay cho ghép bằng JXA PDFKit. PDFKit mở được file này và đọc được trang 30 ("30 Trang 30 / 30"). Có text thật nên đọc kiểm được từng trang.
2. **Cấu hình agent đo.** `adapterConfig = {engine:"cli", model:"claude-sonnet-5", env:{}, extraArgs:["--setting-sources","project,local"]}`.
   - Model trùng agent R1 `mac-claude`.
   - Không dùng `command` wrapper `crew-claude-run` và `--plugin-dir` Superpowers của R1: wrapper bắt `workflow-check` trên `ws` không phải repo.
   - Giữ `--setting-sources project,local` để không nạp hook và plugin trong `~/.claude` của owner.
   - `runtimeConfig = {heartbeat:{enabled:false, maxConcurrentRuns:1}}`.
3. **Environment.** `r22-sp0-env`: SSH `in_place`, dùng chung secret `fa7b4847`, `remoteWorkspacePath=/Users/phannhatquang/crew-r22-probe/ws`, có `crewLoadGate` như R1. Lúc giao issue, H1 giữ run khoảng 50 giây vì tải 1 phút của máy là 8,66, vượt ngưỡng 8. Tải cao do một phiên khác đang chạy `flutter_tester`, không phải của em, nên em không đụng tới. Run tự chạy lúc 20:01:27.
4. **Timeout.** Mỗi lần tải đặt timeout 40 s thay cho 60 s, để cả 12 lần tải (tối đa 8 phút) vừa trần 10 phút của tool Bash trong run. Bridge vốn chờ response 30 s (`DEFAULT_BRIDGE_RESPONSE_TIMEOUT_MS`), nên 40 s không làm mất số đo nào.
5. **Comment kết quả.** Agent đăng comment bằng script nhỏ `post-comment.mjs` (POST comment qua bridge). Script đo và script đăng không in token. Bảng số trong comment trùng `result.json`.

## Sự cố: vượt "chỉ 1 run" và R1 bị đánh thức

Issue con thuộc TPS, nên workflow stage của `crew.core` áp lên nó như mọi issue khác của company. Run đo kết thúc mà issue vẫn ở `in_progress` không có disposition. Từ đó Crew tự chạy tiếp, ngoài ý muốn. Issue có **5 run**:

| Run | Agent | Nguồn | Trạng thái | Giờ (UTC) |
|---|---|---|---|---|
| `566b599b` | r22-sp0-probe | assignment | succeeded | 13:01:27–13:03:17 (run đo duy nhất do em giao) |
| `35486e00` | r22-sp0-probe | automation | cancelled | 13:03:18–13:04:50: ghi "Nguyên nhân: … deliberate_wait_without_target", chuyển issue `done` |
| `aa256809` | **reviewer `946f1a73` (R1)** | assignment | cancelled | 13:04:52–13:06:29: "Reviewer: cần sửa", đòi bước đọc `cmt.png` |
| `16f42b14` | r22-sp0-probe | assignment | cancelled | 13:06:31–13:08:06: đọc thêm `cmt.png`, đăng lại comment |
| `2d57a1a0` | **reviewer `946f1a73` (R1)** | assignment | succeeded | 13:08:08–13:09:26: "Reviewer: approve", issue `done` |

Hậu quả:

- Tốn thêm 4 run quota Claude. Mỗi run khoảng 1,5 phút.
- Agent R1 `reviewer` đã nhận issue thử, trái luật "không giao issue cho agent R1". Không phải em giao: workflow tự giao.
- Không mất dữ liệu đo: số liệu của run 1 giữ nguyên trong cả hai comment.
- Agent `reviewer` vẫn `idle`. Worktree `~/crew-agents/reviewer` sạch (`git status` rỗng, HEAD `cdaaeb5` 07/10). Không có run active.

Bài học cho AC và mọi lần đo sau:

- Đo trong TPS thì instructions của agent đo phải tự đặt disposition cuối (chuyển issue `done` hoặc `blocked`), nếu không plugin sẽ tự đánh thức lại.
- Hoặc dùng company không có policy stage, ví dụ CREA, nếu ở đó có environment SSH tới Mac.
- `probe.md` bước 3.5 ("không đổi trạng thái issue") chính là chỗ gây vòng lặp này.

## Dọn

Xong lúc 20:11. Mọi dòng trong `processes.md` đã đánh dấu "đã gỡ".

- Agent `f06f9096` (`r22-sp0-probe`): pause 200, rồi `DELETE` trả 500. Log server ghi `update or delete on table "heartbeat_runs" violates foreign key constraint "cost_events_heartbeat_run_id_heartbeat_runs_id_fk" on table "cost_events"`. Em chuyển sang `POST /agents/:id/terminate` (route stock), agent về `terminated` và không chạy được nữa. Em không xóa thẳng trong DB, để giữ `cost_events`.
- Issue con TPS-79 `3f76aeeb` và issue cha TPS-78 `e01d3613`: `DELETE` xong, GET 404. Attachment cũng mất: `GET /api/attachments/0b786b54…/content` và `d943b7a8…` đều trả 404.
- Project `24d2b71b` (`r22-sp0-probe`): `DELETE` trả 500, `violates foreign key constraint "cost_events_project_id_projects_id_fk"`. Em archive bằng `PATCH {archivedAt}`.
- Environment `023a0e01` (`r22-sp0-env`): chỉ `PATCH {"status":"archived"}`. Không DELETE. Secret `fa7b4847` còn, environment `mac-mini` vẫn `active`.
- Thư mục tạm `~/crew-r22-probe` (Mac) và `/tmp/crew-r22-probe` (VPS) đã xóa. Bản sao `result.json` và `comment.md` nằm trong scratchpad của phiên.
- Không sửa repo nào, không commit, không push. Không đụng `2ps-landing` và agent của nó.

Lưu ý cho AC: agent và project nào đã có run thì API stock không xóa được (FK `cost_events`). Bản ghi thử lúc nghiệm thu chỉ dọn được bằng terminate và archive.
