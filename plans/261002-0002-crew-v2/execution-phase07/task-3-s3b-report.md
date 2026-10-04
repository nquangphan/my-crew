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

## 5. Vòng sửa 1 (review `task-3-s3b-review.md`)

**Trạng thái: I1, I2, M1, M2, M3, M6 đã sửa — commit `d9216cc`. I3: NEEDS_CONTEXT.** M4/M5 do PM ghi vào ledger. Script nằm trong `$TMPDIR/crew-v2-web-s3b/`; chỉ chạy khi giữ heavy slot và `heavyEligible` là true. Trước commit đã kiểm: mọi import tương đối trong các file staged đều trỏ tới file đã track.

| Finding | Sửa | Test (RED trước) |
|---|---|---|
| I1 | `<CommentComposer key={ticket.id} …>` (`detail.tsx`) | “trang ticket đổi ticketId mà không remount” — RED `TIMEOUT:A restored` (chữ của B hiện trên A) |
| I2 | `FormDrafts` ghi đồng thời vào bộ nhớ và tab storage (`browserTabStorage()` = `sessionStorage`, cùng nơi với draft record và `PendingStore`). Key `crew-v2:form-draft:create-request` và `…:comment:<id>`. Đọc lại có kiểm kiểu. Xóa khi `logging_out`/`guest` (cả lúc tạo kho). Field đã lưu được ưu tiên hơn project của view | Thuần: lưu/đọc lại, bỏ bản ghi hỏng. DOM: mất response → tải lại trang (session/pending/client mới trên cùng storage) → field bị khóa, project/kind/title/description/workflow khớp byte body; gửi lại cùng key/body, một ticket. Bình luận: ô nội dung khôi phục, chỉ đọc, bằng `text` của body; gửi lại cùng key/body, một comment |
| M1 | Nhãn `owner_input` (“Cần bạn trả lời hoặc quyết định.”), comment ghi nguồn `service.ts:420,486` | unit `waitNotice` |
| M2 | (code đã đúng từ `60f546e`) | DOM: `getQueryData(ticket(lower))` có dữ liệu, key chữ hoa không có; invalidate `queryRoots.ticket(lower)` làm detail mở bằng ID chữ hoa refetch (rev 5); response rev 3 không ghi đè. Pass ngay vì code đã đúng; đột biến key giữ chữ hoa làm test fail |
| M3 | Bọc `TicketDocsLinksEditor` trong `<fieldset disabled={terminal}>`, không sửa `docs/*` | DOM: mọi input/button của editor ở trạng thái `:disabled` trên ticket `done` |
| M6 | `CommentComposer` luôn được mount. Trên ticket kết thúc, nó chỉ ẩn khi composer ở `editing`; nếu không thì hiện kèm ghi chú | DOM: đang `ambiguous` thì ticket chuyển `done` qua invalidation; nút “Gửi lại đúng yêu cầu cũ” còn, gửi lại tạo một comment, rồi composer ẩn |

**I3 — NEEDS_CONTEXT (thiếu API S5a, không sửa compose/\*):** `AttachmentComposer` không đưa controller ra ngoài: `ComposerProps` không có handle hay prop nào để form ra lệnh bỏ, nên form không gọi được `discard()`/`abandon()`. Nếu có handle thì hai hàm này cũng chưa đủ để bỏ trọn:
- `discard()` thoát ngay khi không có tombstone/`lockReason` (`controller.ts` `discard`), tức là không làm gì ở `editing` và ở `ambiguous` còn op;
- `abandon()` chỉ chạy ở `editing`.

API cần có, ví dụ `ComposerProps.onHandle?(handle: { discardDraft(): Promise<'discarded' | 'blocked' | 'unconfirmed'> })`. Hàm này phải:
- từ chối khi `sending`;
- ở `editing`: abandon compose session và tệp, rồi `startNew()`;
- ở `ambiguous`/`suspended`/tombstone/`SUBMIT_UNCONFIRMED`/`SUBMITTED_ELSEWHERE`: làm như `discard()` hiện tại (khóa submit giữ trong panel Task2, có cảnh báo trùng owner đã duyệt);
- trả kết quả, để form chỉ xóa field/chữ sau khi bỏ thành công.

Hiện nút “Bỏ bản nháp yêu cầu/bình luận” vẫn chỉ xóa chữ, và tệp vẫn bỏ bằng “Bỏ bản nháp tệp” của composer. Hành vi này đã ghi trong docs flow.

| Bước | Kết quả | Log, SHA-256 (8 ký tự đầu) |
|---|---|---|
| RED | 46 test: 39 pass, 7 fail theo hành vi/assertion | `task-3-s3b-fix1-red.log` `6eebf218` |
| GREEN focused | 46/46 | `task-3-s3b-fix1-green-focused.log` `33130cd3` |
| Đột biến (M2 key chữ hoa, I1 bỏ key, M3 fieldset enabled, M6 ẩn khi terminal) | control 4/4; mỗi đột biến fail 1; source đã khôi phục | `task-3-s3b-fix1-mutation.log` `868b2f35` |
| Unit web (trừ fixture-lifecycle) + tsc + vite build | 197/197; tsc 0; vite 0 | `task-3-s3b-fix1-unit-full.log` `ce1c8055` |
| Biome 14 file | exit 0 | `task-3-s3b-fix1-biome.log` `e35f9a6d` |
| E2E `tickets.spec.ts` (fixture thật) | 2 passed | `task-3-s3b-fix1-e2e.log` `11b689b9` |

Docker trước/sau giống nhau; đã xóa `test-results`; lock đã trả. Manifest không đổi (không có file mới).

Giới hạn còn lại (đã ghi trong docs):
- Kho bản nháp chỉ tự xóa khi đã được tạo trong lần tải trang hiện tại.
- Ticket đã kết thúc mà còn bình luận chưa xác nhận từ trước khi tải trang: ô bình luận không hiện, owner gửi lại qua panel Task2.
- A3 vẫn BLOCKED vì fixture chưa mount attachments.

## 6. Vòng sửa 2 (re-review `task-3-s3b-fix1-re-review.md`, ruling 20:05, API S5a `bdf277d`, review `task-5-s5a-fix4-re-review.md`)

**Trạng thái: B1, B2, B4, I3 đã sửa — commit `ab1bb3a`.** B3 không có trong danh sách sửa của PM, nên vẫn là giới hạn đã ghi trong docs. Trước commit đã kiểm: import tương đối và các module E2E load đều đã được track; `onHandle` có trong `composer.tsx` ở HEAD.

| Finding | Sửa | Test (RED trước) |
|---|---|---|
| B1 | Export `clearTicketDrafts(storage)`: xóa các key trong chỉ mục `crew-v2:form-draft:index`, và nếu storage liệt kê được thì xóa mọi key có tiền tố `crew-v2:form-draft:`. Không còn phụ thuộc kho đã được tạo trong lần tải trang. **Controller cần gọi hàm này trong `session.onLogout`** (em không sửa app-runtime) | unit: storage chỉ có API `TabStorage` (như `MemoryStorage` của composer) → xóa hết draft, giữ key khác; storage liệt kê được thì xóa cả key lạc. RED: key còn nguyên |
| B2 | `FormDrafts` đọc/ghi thẳng storage do `TicketDraftStorageProvider` cấp (storage của runtime, cùng storage đưa vào `ComposeServicesProvider`); `null` thì dùng bộ nhớ. Bỏ `browserTabStorage()`. **Controller cần bọc `TicketDraftStorageProvider storage={…}`** | DOM: field ghi vào `env.storage`, `window.sessionStorage` rỗng (RED: 1 key). unit: chế độ bộ nhớ |
| B4 | Ticket kết thúc dùng `TerminalDocsLinks`: danh sách chỉ xem, cùng query docs-links, có “Thử lại” và “Tải thêm”. Không còn `fieldset disabled` | DOM: lần đầu đọc 500 → “Thử lại” bấm được → danh sách hiện ra, không có checkbox hay nút Lưu (RED: TIMEOUT) |
| I3 | `DraftDiscard` (dùng cho cả form và bình luận) gọi `ComposerHandle.discardDraft()`. Chỉ khi nhận `discarded` mới xóa field/chữ; `blocked`/`unconfirmed` thì giữ nguyên và báo. Thêm theo hợp đồng bổ sung: `discardMode` ẩn nút ở `accepted`, và yêu cầu xác nhận cảnh báo “có thể tạo bản trùng” ở `ambiguous`/`suspended` (“Vẫn bỏ bản nháp”/“Giữ lại”) | Form: bỏ trọn (compose `abandoned`, hết tệp, field mặc định, yêu cầu sau không mang tệp cũ); DELETE mất kết nối → giữ field + báo; đang gửi → `blocked` + báo; ambiguous → phải xác nhận, “Giữ lại” không gửi DELETE. Bình luận: bỏ trọn, `unconfirmed` giữ chữ, xác nhận cảnh báo trùng. unit `discardMode`. RED: thiếu nút / TIMEOUT / assertion |

| Bước | Kết quả | Log, SHA-256 (8 ký tự đầu) |
|---|---|---|
| RED B1/B2/B4/I3 | 29 test: 6 fail theo hành vi | `task-3-s3b-fix2-red.log` `52b1a636` |
| RED xác nhận cảnh báo trùng (form + unit) | 2 fail theo hành vi. File detail fail vì import đang refactor dở nên không tính | `task-3-s3b-fix2-red-confirm.log` `d62af4ab` |
| RED bình luận (sau khi sửa import) | 2/2 fail theo hành vi | `task-3-s3b-fix2-red-confirm-comment.log` `d9839fdf` |
| GREEN focused | 55/55. Lần đầu OOM vì một assertion cũ (“không có nút bỏ khi ambiguous”) in cả DOM element; assertion đó trái với hợp đồng mới nên đã đổi | `task-3-s3b-fix2-green-focused.log` `8a41e977` |
| Đột biến (confirm→direct, xóa với mọi kết quả, dùng `sessionStorage` toàn cục, bỏ chỉ mục) | control 5/5; mỗi đột biến làm test tương ứng fail | `task-3-s3b-fix2-mutation.log` `662e1250` |
| Unit web (trừ fixture-lifecycle) + tsc + vite build | 212/212; 0; 0 | `task-3-s3b-fix2-unit-full.log` `6926fd5d` |
| Biome 14 file | exit 0 | `task-3-s3b-fix2-biome.log` `aabaee00` |
| E2E `tickets.spec.ts` (harness có thêm `TicketDraftStorageProvider` với `sessionStorage`) | 2 passed | `task-3-s3b-fix2-e2e.log` `a00c9ade` |

Docker trước/sau giống nhau; đã xóa `test-results`; lock đã trả; manifest không đổi.

Wiring controller còn cần làm:
1. Bọc `TicketDraftStorageProvider` với cùng storage của runtime.
2. Gọi `clearTicketDrafts(storage)` trong hook logout.
3. Giữ `ComposeServicesProvider`.

Còn mở:
- B3: draft bình luận của ticket đã kết thúc chỉ mất khi đăng xuất.
- M6: ticket đã kết thúc ngay khi tải trang thì đi qua panel Task2.
- D3 phía S5a: chặn handle ở `accepted`; form đã tự tránh gọi.
- A3 vẫn BLOCKED (fixture chưa mount attachments).
