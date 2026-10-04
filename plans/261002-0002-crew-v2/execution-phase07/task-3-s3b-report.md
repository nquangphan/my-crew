# CREWV2-701 / Task 3 — S3b: form tạo yêu cầu, view yêu cầu, composer bình luận trong chi tiết

BASE `51ccdf8` (S3a `167f79c`, S5a `8c5ce41`), worktree `my-crew-v2`, nhánh `codex/crew-v2-server`, Node v24.21.0, pnpm 10.32.1, Asia/Ho_Chi_Minh. Worker web-s3b; không dispatch subagent/reviewer.

**Trạng thái: S3b DONE_WITH_CONCERNS. A3 pending.** Commit `60f546e` (source, test, docs, manifest) và `f1cda08` (nhúng editor docs-links theo yêu cầu bổ sung của PM, cùng E2E).

## 1. Phạm vi và file

- Mới: `v2/web/src/tickets/create-request-state.ts` (`makeRequestSubmission`, `defaultRequestFields`, `workflowOptions`, `requestFormLocked`, `formDrafts`), `create-request.tsx` (`CreateRequestForm`, `CreateRequestAction`), `requests.tsx` (`RequestList`).
- Sửa: `detail.tsx` (composer bình luận, `TicketAttachments` chung, `TicketDocsLinksEditor`, `waitNotice`), `queries.ts` (`canonicalTicketId`, filter `level`, `requestListFilters`, `historyQueryOptions`, `projectsQueryOptions`, `failureText` chuyển về đây), `status.ts` (`waitNotice`), `history.tsx`, `list.tsx` (ô lọc “Cấp”, nút “Tạo yêu cầu”), `board.tsx` (nút “Tạo yêu cầu”).
- Test: `v2/web/test/tickets.test.ts` (+6), `create-request.test.ts` (9), `ticket-detail-dom.test.ts` (7), `test/support/dom-events.ts`, `v2/web/e2e/tickets.spec.ts`.
- Docs: `v2/docs/flows/web-tickets.md`; thêm 6 path vào flow `web-tickets` trong `flows.yaml`, sinh lại `files.md` (giữ manifest lock từ lúc đọc HEAD `92775b4` tới khi commit; `git show 60f546e -- v2/docs/flows.yaml` chỉ có 6 dòng thêm của em). Lock đã trả.
- Không sửa compose/*, docs/*, auth/lib/contracts, router/main/app-runtime/harness hay server.

## 2. Hành vi

- `makeRequestSubmission` map đúng `{projectId,parentId:null,level:'request',kind,title,description,mandatory:true,criteria:{workflowChoice},inputs:{},outputs:{},skill:null,workflowPin:null,deployApprovalDecisionId:null}`, target `{purpose:'ticket',projectId,ticketId:null}`. Superpowers là mặc định, BMAD phải chọn rõ. Form ghi rõ chỉ máy chạy Claude Code có định nghĩa BMAD, Codex chưa chạy được (đúng ruling phase06). `workflowPin` luôn null; root preference không thay run pin.
- Mô tả và tệp do `AttachmentComposer` quản lý (draft key `create-request`). Field form bị khóa khi composer khác `editing`, nên một request chưa xác nhận chỉ được gửi lại đúng key/body cũ. Sau receipt, form đóng hộp thoại và gọi `onOpenTicket(ticket.id, trigger)`.
- Bản nháp nằm trong `formDrafts(session)`, chỉ ở bộ nhớ tab. Nó còn khi đóng hộp thoại, đổi view, refetch hay hết phiên rồi đăng nhập lại, và bị xóa khi đăng xuất. Chỉ “Bỏ bản nháp yêu cầu” hoặc “Bỏ bản nháp bình luận” mới xóa phần chữ; tệp vẫn bỏ bằng nút “Bỏ bản nháp tệp” của composer.
- Chi tiết: ticket chưa kết thúc có “Bình luận mới” (composer chung, draft key `comment:<id>`, draft theo ticket). Ticket done/cancelled không có ô bình luận.
- `RequestList` đọc `level=request` của P-G1a, phân trang tới `nextCursor` null; `requestRoots` vẫn kiểm cấu trúc.
- Minor S3a đã sửa: M1 `canonicalTicketId` (key, path, revision guard, history, graph); M2 `failureText` có câu riêng cho local (`TICKET_ID_INVALID` → “Đường dẫn ticket không hợp lệ.”) và aborted; M4 `waitNotice` hiện “Lý do chờ: …” ở mọi trạng thái, chỉ needs_input mới thêm “Đang chờ bạn.”.

## 3. TDD và kiểm chứng

Mọi lệnh chạy trong `v2/web`, heap 384 MiB. Script lấy heavy slot rồi đọc JSON telemetry; chỉ chạy khi `heavyEligible` là true, nếu không thì trả lock (đã áp dụng từ lượt chạy đầu tiên). Mỗi log có dòng TELEMETRY (khoảng 4,4–5,2 GiB, pressure 1, idle 74–85%, đĩa 750 GiB).

| Bước | Kết quả | Log, SHA-256 |
|---|---|---|
| RED trên scaffold sai hành vi (stub trả giá trị sai, không lỗi import) | 35 test: 15 pass (S3a cũ), 20 fail. DOM detail fail vì realm Event của jsdom/Radix | `task-3-s3b-red.log` `b42fe67d…4a31` |
| RED DOM sau khi sửa môi trường (`dom-events.ts`) | 13 test: 12 fail theo hành vi; “ticket done không có composer” pass ngay (test chặn) | `task-3-s3b-red-dom.log` `7aaed217…f1ae` |
| RED view yêu cầu + `TicketAttachments` | 2/2 fail (TIMEOUT) | `task-3-s3b-red-requests.log` `5d467dd3…dc5f` |
| GREEN focused | 36/37. Test deep link chữ hoa sai fixture (UUID toàn số, chữ hoa = chữ thường) nên đã đổi sang UUID hex | `task-3-s3b-green-focused.log` `97fe2e5c…dfc2` |
| Đột biến M1 (bỏ lowercase) trên test deep link | control pass 1; đột biến fail 1; source đã khôi phục | `task-3-s3b-mutation.log` `c1bcc96c…5627` |
| RED editor docs-links (yêu cầu bổ sung) | 1/1 fail (TIMEOUT:editor) | `task-3-s3b-red-docs-links.log` `c02aad96…c737` |
| Web unit (mọi `test/*.test.ts` trừ `fixture-lifecycle` cần DB) + `tsc --noEmit` + `vite build` | 189/189; tsc exit 0; vite exit 0 | `task-3-s3b-unit-full.log` `6dc88824…ccd4` |
| `tsc --noEmit` (trước commit đầu) | exit 0 | `task-3-s3b-typecheck.log` `14bad5df…5fc2` |
| Biome 14 file | exit 0 | `task-3-s3b-biome.log` `40df2db7…03fb` |
| E2E `e2e/tickets.spec.ts` (API/PG/Vite thật của fixture Task1) | 2 passed (9,2 giây) | `task-3-s3b-e2e.log` `68ce94b5…2842` |
| `crew-docs generate` + `check --all` (bản sao HEAD có `v2/` làm root) và hook `check --staged`/`--commit-msg` | ok | — |

Sau lượt full, Biome chỉ format lại `ticket-detail-dom.test.ts`; E2E chạy sau đó.

E2E kiểm: bản nháp bình luận giữ giá trị và focus qua event realtime thật, vẫn còn sau khi đóng/mở; nút “Tạo yêu cầu” trên bảng mở form với dự án mặc định theo view, Superpowers được chọn sẵn, có ghi chú BMAD; Escape trả focus về nút; mở lại từ danh sách vẫn còn field; “Bỏ bản nháp yêu cầu” đưa form về mặc định. Docker trước/sau giống nhau, không còn `test-results`, lock không còn.

## 4. Còn mở / concerns

1. **A3 tạo yêu cầu qua API thật: BLOCKED.** Fixture ở HEAD (`e2e-fixture.ts:551`) chưa truyền `AttachmentAssembly`, nên POST `/v2/attachment-compose` trả 404. Bản sửa fixture của controller đang dở trong working tree nên em không dùng. Luồng gửi text-only/PNG, mất response → đăng nhập lại → gửi lại cùng key, và một entity chỉ được chứng minh trên producer giả trong bộ nhớ (component test). Cần viết E2E khi harness mount attachments.
2. **Wiring controller:** app phải bọc vùng đã xác thực bằng `ComposeServicesProvider`, vì `TicketDetail`/`CreateRequestForm` gọi composer; thiếu provider thì composer ném `COMPOSE_SERVICES_MISSING`. Cần route cho `RequestList`; caller số 3 (chọn yêu cầu) nằm ở `requests.tsx` (nút trong mỗi `li`).
3. **Va chạm scratchpad:** scratchpad của session này dùng chung với worker khác. Một lần `retry.sh` của em bị script cùng tên của worker `s4-t3s1` ghi đè. Lần chạy đó đã chạy script của họ (tạo rồi dọn container `crew-v2-test-7a7f…`, kết thúc `after-stop: 0 containers`) dưới slot của họ. Sau đó em chuyển sang thư mục riêng `scratchpad/web-s3b/` với tên `s3b-*.sh`.
4. `test/support/dom-events.ts` (`useDomEventConstructors`) đã được `docs-space-dom.test.ts` của S6docs import (commit `2eb8936`) trước khi file này được commit. HEAD trong khoảng `2eb8936..60f546e` thiếu file đó.
5. Lịch sử đầy đủ (`/history`) chưa đọc vì contracts chưa có decoder (Task2). Minor S3a M3/M5/M6 vẫn deferred.
6. Bỏ bản nháp yêu cầu/bình luận chỉ xóa phần chữ. Tệp phải bỏ bằng nút của composer, vì composer không cho gọi abandon từ ngoài.
