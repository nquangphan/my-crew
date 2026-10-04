# CREWV2-701 / A5 (đường chỉ có văn bản) và phần văn bản của A3 — E2E trên API/PostgreSQL thật

BASE `82415118ab7f88a0d20717875d58b6b54992397c` (nhánh `codex/crew-v2-server`), Node v24.21.0, pnpm 10.32.1, Asia/Ho_Chi_Minh. Worker web-a5a3, không dispatch subagent hay reviewer. **Trạng thái: DONE_WITH_CONCERNS** (xem mục 5).

## 1. Phạm vi và file

- Mới: `v2/web/e2e/compose.spec.ts`. Sửa docs: `v2/docs/flows/web-attachments.md` (bullet E2E, thay câu “chưa có”), `v2/docs/flows/web-tickets.md` (câu cuối bullet E2E), manifest `v2/docs/flows.yaml` (+1 dòng test của flow `web-attachments`), `v2/docs/files.md` (+1 dòng, bản generated không đổi sau `generate`).
- `v2/web/e2e/tickets.spec.ts` **không sửa**: dialog/realtime/draft đã có sẵn, còn tạo yêu cầu và bình luận từ board/dialog được `compose.spec.ts` phủ bằng chính `TicketBoard` + `TicketDialog` thật.
- Host trong spec chỉ mount component production (`TicketBoard` kèm “Tạo yêu cầu”, `TicketDialog`) vào `createAppRuntime` thật; không mock mạng, entity hay receipt. Phần dựng host là bản chép của `tickets.spec.ts` (spec không import được spec khác; file support dùng chung nằm ngoài danh sách được sửa).

## 2. Kịch bản và bằng chứng DB

| # | Kịch bản | Bằng chứng |
|---|---|---|
| 1 | Tạo yêu cầu chỉ có chữ rồi bình luận trong dialog | 1 POST `/v2/attachment-compose` rỗng, body `attachmentIds: []`, `assistantRead: 'none'`; DB: 1 ticket (đúng project, `kind=research`, mô tả, `criteria.workflowChoice=bmad`), 1 receipt `POST:/v2/attachment-submissions/tickets`, 1 event `ticket.created`, 0 tệp liên kết; dialog mở đúng `ticket.id` trả về; bình luận: 1 dòng `comments`, 1 receipt `POST:/v2/tickets/<id>/attachment-comments`, 1 event `comment.created`, hiện trong timeline |
| 2 | Mất response sau commit → hết phiên → đăng nhập lại → replay (ticket) | Route chỉ `route.fetch()` rồi `abort('connectionreset')` (4 lần máy chủ trả 201, trình duyệt không nhận). Form khóa `ambiguous`; DB 1 ticket/1 receipt ngay trước khi hết phiên; `sessions.expires_at` đẩy về quá khứ qua DB fixture; nút gửi lại → 401 → màn hình đăng nhập lại, không lộ tiêu đề; đăng nhập lại cùng owner, mở lại form thấy bản nháp khóa, gửi lại → thành công. 6 POST, một Idempotency-Key, một body, CSRF cuối khác CSRF đầu; DB 1 ticket, 1 receipt, 1 event `ticket.created`; `pending.list()` rỗng, không còn recovery panel |
| 3 | Như 2 cho bình luận trong dialog | 6 POST cùng key/body, DB 1 comment, 1 receipt, 1 event `comment.created` |
| 4 | Bỏ bản nháp khi chưa xác nhận | Cảnh báo “có thể tạo bản trùng”; “Giữ lại” không đổi gì; “Vẫn bỏ bản nháp” xóa form; DB vẫn 1 ticket/1 receipt; khóa cũ vẫn nằm trong `PendingStore`; mọi POST dùng đúng một key |
| 5 | Gửi kèm PNG khi chưa chứng nhận extractor | File qua hash worker, reserve, PUT thật tới `ready`; submit trả 503 `EXTRACTION_NOT_CONFIGURED`, UI hiện “Chưa cấu hình xử lý tệp”; 4 POST cùng key/body; DB: 0 ticket, 0 receipt, 0 tệp liên kết; form vẫn khóa kèm nút “Gửi lại đúng yêu cầu cũ” |

## 3. Kiểm chứng

Mọi lệnh chạy trong `v2/web`, concurrency 1 (`workers: 1`, `serial`), `NODE_OPTIONS=--max-old-space-size=384`, watchdog Python 500 giây.

| Lệnh | Kết quả | Log, SHA-256 |
|---|---|---|
| `playwright test e2e/compose.spec.ts` (lần 1, spec cuối) | exit 0, 5 passed, 44,2 giây | `a5-a3-e2e-green-run1.log` `655651541148558cd28481a0c03a54f8c51ad6918e45805656ca98503b73aa4a` |
| cùng lệnh (lần 2) | exit 0, 5 passed, 44,3 giây | `a5-a3-e2e-green-run2.log` `246b4f9c24ca73d017825bf7ec71d09110778be8caeae63b736c67b066bf48f8` |
| `tsc --noEmit` | exit 0, không output | scratch, SHA rỗng `e3b0c442…b855` |
| `biome check v2/web/e2e/compose.spec.ts` | exit 0 sạch (đã xóa một import thừa) | trên console |
| `crew-docs generate` + `check --all` trên bản sao có `v2/` làm Git root | `unchanged index.md/files.md`, `check --all: ok` | trên console |

Không có RED trước: spec là test nghiệm thu trên producer đã có, nên lượt chạy đầu có thể xanh; tôi không chứng minh bằng đột biến vì không được sửa product code. Lượt chạy xanh đầu tiên chỉ sau khi sửa một kỳ vọng sai của chính tôi (text-only vẫn mở đúng một compose rỗng, xem log `a5-a3-e2e-first-run-without-slot.log`, fail ở assert đó).

## 4. Tài nguyên, slot, cleanup

- **Sai sót quy trình:** lượt chạy đầu (`a5-a3-e2e-first-run-without-slot.log`, 2,4 giây, 1 fail do kỳ vọng sai của tôi, 4 chưa chạy) chạy **khi tôi chưa giữ heavy slot**: tôi nhả slot vì telemetry tụt dưới ngưỡng, chờ eligible, rồi `mkdir` thất bại (worker b3a vừa lấy) nhưng lệnh tiếp theo của tôi vẫn chạy do viết `;` thay vì `&&`. Fixture đã tự đóng sau 2,4 giây; không chạm lock hay tài nguyên của b3a. Các lần chạy sau đều giữ slot (owner `web-a5a3`, lock lấy 07:12:52Z sau khi lock của b3a được nhả và `heavyEligible` true).
- Telemetry khi lấy slot: 07:12:52Z và lúc kết thúc, trong `a5-a3-e2e-telemetry.log` (gate eligible; cuối chạy: bộ nhớ trống đủ, pressure 1).
- Heavy slot và manifest lock đều đã trả bằng `rm -rf` đúng thư mục; `ls` xác nhận không còn. Fixture tự dọn DB/container/scratch theo `withFixture` (không còn tiến trình `e2e-fixture` hay Chromium của tôi; các tiến trình `playwright-mcp` còn thấy là của phiên khác). Scratch `$TMPDIR/crew-v2-web-a5a3/` (bản sao docs, log gốc) sẽ xóa sau commit.

## 5. Concern và phần còn bị chặn

**Phát hiện product (không sửa, chuyển PM):**
1. `v2/web/src/lib/api.ts:248-256` (nhánh `response.status >= 500`): mọi 5xx, kể cả 503 `EXTRACTION_NOT_CONFIGURED` mang tính tất định, bị coi là “chưa xác nhận” và tự gửi lại 3 lần có backoff (repro: scenario 5, 4 POST cùng key). Không tạo thêm entity vì key giữ nguyên, nhưng UI đi vào trạng thái `ambiguous` (“Chưa xác nhận kết quả…”) thay vì báo thẳng lỗi cấu hình, và tốn 3 request vô ích. Đề xuất: Task2 nhận diện code `EXTRACTION_NOT_CONFIGURED` là lỗi dừng (giữ key, không retry tự động) — cần quyết định của PM.
2. Quan sát (không phải lỗi): text-only vẫn mở một compose session rỗng trước khi submit (`controller.ts:613`); ghi vào docs.

**Còn bị chặn (không tính PASS):**
- Gửi thành công kèm tệp (PNG/PDF, bỏ một tệp, transport lỗi rồi retry, mất response → one ticket + links, ảnh-only trong dialog, bình luận conversation, wake/input revision): chờ extractor đã chứng nhận (phase05). Chỉ phần 503 được kiểm.
- Nhóm tệp theo bình luận, lịch sử và câu hỏi: chờ projection G3. Attempt/model: G1b.
- A3 đầy đủ (graph, pause/cancel, request done) chưa thuộc lượt này.
- Còn mở từ review trước (không đụng): N1 tombstone re-entry không xác nhận trùng, B3 key comment ticket terminal chưa dọn, M4 tạo thành công không mở ticket khi trigger null.

## 6. Commit

Một commit chỉ gồm `compose.spec.ts`, hai trang flow, hunk manifest/`files.md` của tôi (index dựng từ HEAD + hunk của tôi, vì `flows.yaml`/`files.md` còn hunk chưa commit của worker b3a) và report/log `a5-a3-e2e-*`.
