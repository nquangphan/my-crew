# CREWV2-701 / Task 3 — S3a: giao diện đọc ticket (bảng, danh sách, chi tiết, hộp thoại, lịch sử)

BASE `43792f1`, worktree `my-crew-v2`, nhánh `codex/crew-v2-server`, Node v24.21.0, pnpm 10.32.1, Asia/Ho_Chi_Minh.
Brief `execution-phase07/task-3-brief.md`, dòng S3a. Worker Claude (web-s3a); không dispatch subagent/reviewer.

**Phạm vi được claim:** chỉ S3a (source + interface đọc, đã tự review). **Không** claim S3b (create-request, composer), **không** claim A3.

## 1. Tiền kiểm producer (chỉ đọc, không sửa server)

| Route | Nguồn | Có ở HEAD |
|---|---|---|
| GET `/v2/tickets?projectId&status&kind&rootId&cursor&limit` (≤100, mặc định 50, xếp theo `id`) | `v2/server/src/tickets/routes.ts:199-239` | có |
| GET `/v2/tickets/:id` | `routes.ts:241` | có |
| GET `/v2/tickets/:id/graph` (cả root) | `routes.ts:245`, `dependencies.ts:153` | có |
| GET `/v2/tickets/:id/comments`, `/decisions` (cursor UUID, xếp theo `id`) | `routes.ts:337-428` | có |
| Projection máy/model/độ khó/lượt chạy/bằng chứng (G1/G3) | — | **chưa có** |
| History projection đầy đủ: review/fallback/artifact/commit/docs sync (G1/G3) | — | **chưa có** |
| Phân trang theo request root (G1) | — | **chưa có** (list không có filter `level`) |
| Ticket → docs refs (G1) | chỉ có PUT `/docs-links` (`routes.ts:453`) | **chưa có route đọc** |
| Attachment của ticket (G2) | `attachments/routes.ts`, chưa mount | **chưa mount** |

Phần thiếu được hiển thị là “Chưa có dữ liệu — máy chủ chưa cung cấp thông tin này.” hoặc ghi chú tương ứng. Web không bịa route và không suy dữ liệu từ `criteria` hay prose.

## 2. File

Mới (đều nằm trong danh sách “Files mới” của brief, phần S3a):

- `v2/web/src/tickets/status.ts`: `statusLabels` (đúng 7 nhãn của brief), `statusOrder`, `statusIcons`, `levelLabels`, `kindLabels`, `isTerminal`, `mergeTicketPages`, `requestRoots`, `groupByStatus`, `pickReturnFocus`, `waitReasonLabel`.
- `v2/web/src/tickets/queries.ts`: `parseTicketFilters`, `ticketListPath`, `fetchTicketPage`, `ticketListOptions`, `ticketQueryOptions` (revision guard), `fetchAllPages` (chặn cursor lặp), `buildLegacyTimeline`, `formatTime`, `actorLabel`, cùng các hook `useTicket`, `useTicketList`, `useTicketHistory`, `useTicketGraph`. Hook nhận `OwnerClient` từ component (`useRuntime().client`), nên module chạy được trong `node:test`.
- `v2/web/src/tickets/detail.tsx` (`TicketDetail`, `StatusBadge`), `dialog.tsx` (`TicketDialog`), `history.tsx` (`TicketHistory`), `list.tsx` (`TicketList`, `TicketFilterBar`, `TicketPagination`), `board.tsx` (`TicketBoard`).
- `v2/web/test/tickets.test.ts`, `v2/web/e2e/tickets.spec.ts`.
- Docs: `v2/docs/flows/web-tickets.md`, mục `web-tickets` trong `v2/docs/flows.yaml`, khối generated trong `v2/docs/index.md`/`files.md`.

Không tạo `requests.tsx`, `create-request.tsx`, `create-request-state.ts`, `create-request.test.ts` và không import `compose/*`; các phần đó thuộc S3b. `requestRoots` được đặt trong `status.ts` để Task4 và S3b dùng lại. Không sửa `main.tsx`, `router.tsx`, `styles.css`, `app-runtime.ts`, `auth/lib/contracts`, harness hay server. Style nằm inline trong component, vì `styles.css` thuộc controller.

Interface khớp brief: `TicketDetail({ ticketId, presentation: 'page' | 'dialog' })`, `TicketDialog({ ticketId, onClose, returnFocus })`, `requestRoots(tickets)`, `statusLabels`.

## 3. RED → GREEN

Mọi lệnh chạy trong `v2/web`, heap 384 MiB, khi đang giữ sole heavy slot.

| Lệnh | Kết quả | Log, SHA-256 |
|---|---|---|
| RED `node --test test/tickets.test.ts` trên scaffold sai hành vi (nhãn rỗng, filter rỗng, timeline rỗng, `pickReturnFocus` → null…) | exit 1, 16/16 fail, đều do assertion hoặc thiếu hành vi; không có lỗi import | `task-3-s3a-red.log` `1d0dfc2b97399144232e329497f8db21d15ad645232094c1fac983e250de402d` |
| GREEN cùng lệnh, trên source cuối | exit 0, 16/16 | `task-3-s3a-green-focused.log` `7a110537f9d956446d35291eca3c65eecaae6bd3c85f17d1c1d0ce678821faf3` |
| `node --test test/*.test.ts` | 69 test: 68 pass, 1 fail. Test fail là `test/compose-submit.test.ts` của S5a (chưa commit, import `receiptSummary` chưa có); không thuộc Task3 | `task-3-s3a-unit-full.log` `d35c795de994b1e24378256180bfb357d5f8daa5e9d4ab299ca8a76dc607d729` |
| `pnpm build` | `tsc` fail, chỉ do 4 lỗi trong `test/compose-submit.test.ts` (S5a) | `task-3-s3a-build.log` (cùng file) |
| `tsc --noEmit -p` một tsconfig tạm (extends `tsconfig.json`, chỉ exclude `test/compose-submit.test.ts`; đã xóa sau khi chạy), rồi `vite build` | tsc exit 0; vite exit 0 | `task-3-s3a-build.log` `0e5ae972c3ee49e70736d0f042a9183d28dc024eacd5369748855566f91b7555` |
| `biome check` 9 file của S3a (từ gốc repo) | exit 0, không còn diagnostic | `task-3-s3a-biome.log` `8318d2aabc321577309d464077a6235eaeab0a3531e2152595335c714d5fd36b` |
| `playwright test e2e/tickets.spec.ts` | exit 0, 1 passed (3,6 giây) | `task-3-s3a-e2e.log` `5e4781bcc7b57ae55ca8ac6a6998f933264dbc9400b2eff805674e7d37b34e2b` |
| `crew-docs generate` và `check --all` trong bản sao tạm có `v2/` làm Git root | chỉ thêm các dòng `web-tickets`. `check` còn 4 lỗi R2 cho `web/src/compose/*` của S5a (chưa vào flow); không có lỗi nào của S3a | ghi tại đây |

E2E (API, PostgreSQL và Vite thật của fixture Task1; dữ liệu tạo qua API owner; không mock mạng): harness dựng bằng `createAppRuntime` + `RuntimeContext` thật, mount `TicketBoard`/`TicketList`/`TicketDialog` vào root `#tickets-harness` do test sở hữu. Dữ liệu seed: project; hai yêu cầu gốc trùng tiêu đề; một bước bắt buộc; lần lượt bình luận → quyết định → bình luận. Test kiểm:

- 7 cột trạng thái và 3 thẻ; danh sách báo “Đã tải hết”.
- Hộp thoại có tên bằng tiêu đề, đúng `data-ticket-id`, mô tả nhiều dòng, ticket con, phần “Chưa có dữ liệu”, timeline đúng thứ tự comment/decision/comment kèm lý do.
- Nền `aria-hidden`; Tab 6 lần vẫn ở trong hộp thoại.
- Bình luận tạo trong lúc hộp thoại mở xuất hiện qua event SSE thật, focus vẫn ở nút Đóng.
- Escape trả focus về thẻ.
- Danh sách cùng revision với bảng; mở từ dòng, X trả focus về dòng.
- Filter loại `research` thu hẹp cả danh sách lẫn bảng khi đổi view.

Trong quá trình chạy phát hiện thư viện `aria-hidden` của Radix giữ lại tổ tiên của phần tử `[aria-live]`, khiến `main` phía sau không bị ẩn. Đã đổi các vùng trạng thái sang `role="status"`; sau đó E2E PASS.

Telemetry khi lấy slot: 5,189 GiB khả dụng / pressure 1 / CPU idle 84,51% / đĩa 752,3 GiB (đạt gate). Slot do web-wiring giữ trước đó, đã chờ rồi lấy lại. Đã `rm -rf` đúng thư mục lock và `ls` xác nhận lock không còn. Cleanup: danh sách `docker ps -a` trước và sau trùng nhau; không có container `crew-v2-web*`, không còn `crew-v2-web-*` trong TMPDIR, không còn listener trên 62505/63387/64798; `test-results` đã xóa. Các process `playwright-mcp` đang chạy không phải của worker này. Không có screenshot (không bắt buộc).

## 4. Đối chiếu checkbox S3a của brief

- [x] Bảy nhãn đúng; root `level==='request' && id===rootId && parentId===null`; ID trùng lấy revision mới. Fixture có hai root trùng tiêu đề, bước mồ côi, con bắt buộc, done/cancelled; không suy root từ trang đầu hay tiêu đề.
- [x] List/board chỉ dùng filter producer hỗ trợ; cursor UUID đi tới `null` qua nút “Tải thêm” rõ ràng; không tuyên bố danh sách root đầy đủ. Nhóm trạng thái có chữ + biểu tượng; không kéo thả. Filter giữ qua đổi view: component nhận filter từ caller; giữ trong URL là việc của router controller.
- [x] Chi tiết dùng chung tải ticket, comment, decision và graph bằng cùng ID. Máy/model/độ khó/lượt chạy/bằng chứng/attachment/docs refs hiện rõ là chưa có (chờ G1/G2/G3).
- [x] Timeline cũ đọc hết trang trước khi sắp theo `createdAt`/`id`, không dùng thứ tự UUID làm thứ tự thời gian. Phần review/fallback/artifact/commit/docs sync chờ G1/G3.
- [x] Một Radix dialog dùng chính `TicketDetail` (Title/Description, giữ focus, nền trơ, Escape/X). Focus trả về trigger, hoặc `[data-focus-fallback]`, rồi `#main-content`; realtime không giành focus. **Chưa có** draft per ticket: không có ô nhập nào trước S3b. Draft và composer được inject ở S3b sau S5a/A5.
- [ ] Sáu caller: S3a có hai (thẻ `v2/web/src/tickets/board.tsx:67`, dòng `v2/web/src/tickets/list.tsx:150`); bốn còn lại (chọn request S3b, node graph Task4, link docs Task6, link Trợ lý Task6) chờ controller/task tương ứng.
- [ ] A3 (deep link/reload 404, zoom 200%, draft khi có event, needs_input/repair5 trong trình duyệt, tạo yêu cầu): **pending**. Cần S3b, A5, G1, router controller; history/question cần G3.

## 5. Wiring đề xuất cho controller (không tự sửa router)

- Route `/projects/$projectId/tickets` với search `{ view?: 'board' | 'list', status?, kind?, rootId? }`. Lấy filter bằng `parseTicketFilters({ projectId, ...search })`, render `TicketBoard` hoặc `TicketList` với `onFiltersChange` ghi lại search (giữ `view`), cùng một `TicketDialog` có state `{ ticketId, trigger }` (hoặc search `ticket=<id>` nếu muốn mở dialog bằng link).
- Route `/tickets/$ticketId` cho deep link/reload: `<TicketDetail ticketId={ticketId} presentation="page" />`. ID không phải UUID hoặc 404 hiện panel lỗi trong detail.
- Component phải nằm dưới `RuntimeContext` và `QueryClientProvider` (đã có ở `main.tsx`).

## 6. Tự review và lưu ý

- Authority: web không gửi mutation nào. Trạng thái, root, lý do chờ và repair đều đọc từ field DTO của producer. Ghi chú “chỉ xem” cho done/cancelled là ghi chú hiển thị, không phải quyền.
- `waitReasonLabel` chỉ dịch hai mã producer đang ghi (`repair_limit` ở `server/src/tickets/repair.ts:54`, `final_result_pending` ở `server/src/execution/attempts.ts:489`); mã lạ hiện nguyên văn.
- `ChildTickets` đọc graph toàn root. Với cây lớn, việc này tốn tải; khi có projection G1 nên chuyển sang route đó.
- Vite dev phát hiện `@radix-ui/react-dialog` lần đầu nên có thể reload trang. E2E vì vậy warm-up import một lần rồi mở trang mới. Khi router import dialog, Vite sẽ pre-bundle dependency này từ đầu.

## 7. SHA-256 source cuối

| File | SHA-256 |
|---|---|
| `v2/web/src/tickets/board.tsx` | `f3daaa89ba3d5a0a79624629273d5d091a812f59e03dd0f3d3d2835a574c7fc8` |
| `v2/web/src/tickets/detail.tsx` | `f58a5466a46246cb571cdafb7d1d7379d8ed8ae3341b87e6bc7d36c540046472` |
| `v2/web/src/tickets/dialog.tsx` | `1697ee174f8c858fd2bff03be1a32c5340860d4f59b774ca50b1ca50a946d544` |
| `v2/web/src/tickets/history.tsx` | `c27a760e99b51bf08a0034e6f700b1cf2f0d43fe397534daf834b796c655e174` |
| `v2/web/src/tickets/list.tsx` | `865aae4f2c5c6d2566848ed13976e06fb6fe95d2516fec4a74277fc1e5293bb0` |
| `v2/web/src/tickets/queries.ts` | `ee212e93fd29778ec9bf4628f9406ceef5331356934ad1fb37c0019b5df1b58f` |
| `v2/web/src/tickets/status.ts` | `c7ac8284e4517fa61d05ac34550948ffebdc37b8d6b00841d328f3c1eda3e1d7` |
| `v2/web/test/tickets.test.ts` | `eab7196dcb9ce17199746dc8057b178587617781e8b18a60ec5c5de936f2e458` |
| `v2/web/e2e/tickets.spec.ts` | `60e378780e65a62aac067fa37158fe7d0c983c949bbd2b46ea9f8e7055ebd946` |
| `v2/docs/flows/web-tickets.md` | `6b75598e40ce3880a4a9c38e4561ed96be137b23446ef146e4cad8cab87c2287` |

## 8. Commit và sự cố manifest

- `ba58e42` là commit S3a. Patch `-U0` của em áp vào HEAD lúc controller vừa commit nên bị lệch: mục `web-tickets` nằm sau `shared`/`unassigned` (sai cấu trúc YAML), còn các dòng trong `files.md` sai thứ tự. Sau đó `dbeb6da` (worker wiring) ghi đè mục này và `e2dd3e4` đã khôi phục nó.
- `167f79c` là bản sửa: chuyển `web-tickets` lên trước `shared` và sinh lại `files.md` bằng `crew-docs generate` từ bản HEAD mới nhất (có `app-router.spec`); kết quả `check --all: ok`. Lệnh `git diff 167f79c^ 167f79c -- v2/docs/flows.yaml v2/docs/files.md` chỉ cho thấy các hunk sắp lại vị trí của em. HEAD có `web-tickets` tại `flows.yaml:518` và 9 dòng trong `files.md`.
- Quy tắc lock manifest (`$TMPDIR/crew-v2-manifest.lock`) đến sau khi `167f79c` đã commit, nên commit đó chạy không có lock. Commit report này không đụng tới manifest.
