# Báo cáo P-G1a: read route additive cho web (G1 phần a) và latest cursor

BASE `31ced2bac08c115a6441b85429f1d91f15bf5bbf`. Commit code `fa8ccbc`. Node v24.21.0, pnpm 10.32.1. Không migration, không sửa 004/005, không đụng assistant/service/decisions/dependencies/assistant-access/app/attachments/gateway/web.

## Endpoint thêm (tất cả GET, xác thực như read ticket hiện có; ticket ngoài scope trả 404 qua `requireTicket`)

1. `GET /v2/tickets?level=request|step|task` (thêm vào filter cũ `projectId,rootId,status,kind,cursor,limit`). Response không đổi: `{items: Ticket[], nextCursor: uuid|null}`, keyset theo `id`, `limit` 1..100 (mặc định 50). `level=request` cho danh sách request root phân trang ổn định. Giá trị khác enum: 400.
2. `GET /v2/tickets/:id/history?cursor=<decimal>&limit=<1..100, mặc định 50>` trả `{items: [{cursor: string, type: string, occurredAt: ISO, actor: {kind:'owner'|'machine', id: string} | null, data: object}], nextCursor: string | null}`. Thứ tự tăng theo journal cursor (chuỗi bigint, `cursor` mặc định `0`, `nextCursor` = cursor của item cuối khi còn trang). Nguồn: event của chính ticket (ticket.created/changed, comment.created, decision.created, repair.recorded, dependency.added, attempt/command, attachment.* nếu có ticketId). `actor` lấy từ bảng comments/decisions cho `comment.created`/`decision.created`, các event khác `null`. Không có nội dung comment/decision/rationale: chỉ `data.commentId`, `data.decisionId`, `data.kind`. Owner thấy mọi event của ticket; máy chỉ thấy event không audience hoặc audience là chính máy đó. Đọc trong transaction REPEATABLE READ READ ONLY cùng kiểm scope. `cursor` sai (âm, chữ, > 2^63-1), `limit` ngoài khoảng, query lạ: 400.
3. `GET /v2/tickets/:id/docs-links?cursor=<opaque>&limit=<1..100, mặc định 20>` trả `{items: [{snapshotId: uuid, path: string}], nextCursor: string | null}`, keyset theo `(snapshot_id, path COLLATE "C")`, cursor là base64url của `[snapshotId, path]` (client coi là mờ). Cursor hỏng: 400 `CURSOR_INVALID`. Là mặt đọc của PUT docs-links hiện có.
4. `GET /v2/events/latest` (không nhận query, có xác thực) trả `{cursor: string}` là `event_cursor.value` dạng chuỗi thập phân (`"0"` khi trống, kiểm với `9007199254740993`). Cursor chỉ tăng khi transaction event commit nên mọi event ≤ giá trị đã nhìn thấy; tab mới dùng làm `after`/`Last-Event-ID`.

Code: `v2/server/src/tickets/history.ts` (mới, `readTicketHistory`, `readTicketDocsLinks`), `routes.ts` tickets/journal. Test mới `v2/server/test/ticket-reads.test.ts` (5 test). Docs: `flows.yaml`, `files.md` (sinh lại bằng bản sao tạm có `v2/` làm Git root, diff đúng 2 dòng), `flows/server-tickets.md` (bước 11, bảng Files), `flows/server-journal.md` (bước 10, bảng Files). `crew-docs check --staged` và `check --all`: ok.

## RED (`producer-g1a-red.log`)
Chạy trên route HEAD gốc (tạm khôi phục hai file routes của chính slice, rồi đưa bản mới lại): 5 test, 0 pass, 5 fail, exit 1, 786ms. Lý do: 404 thay vì 200 cho history/docs-links/latest, và `level` bị schema 400. Không có lỗi setup/import.

## GREEN (`producer-g1a-green.log`)
Một lần fail đầu do lỗi test của em (`recordDecision` trả string id, không phải `{id}`), đã sửa test. Lần cuối trên source cuối: 37 test (5 mới + tickets, dependencies, journal, journal-scope, api-acceptance), 37 pass, 0 fail, 0 cancelled, 0 skipped, exit 0, 9886ms.
Phủ: phân trang root 3 mục limit 2; level step; level sai; history thứ tự/phân trang/không lộ chuỗi "BÍ MẬT"/không lẫn ticket khác/tham số sai/404; machine bound không thấy event audience máy khác, owner thấy; machine lạ bị từ chối; docs-links 26 mục qua 2 trang không trùng/mất, ticket khác không lẫn, rỗng, cursor hỏng; latest "0" và bigint 2^53+1.
Typecheck strict phạm vi (recipe B2a, thêm 3 file `.d.ts`): exit 0, output rỗng. Biome 2.5.14 từng file: 0 lỗi/0 warning (`producer-g1a-lint.log`).

## Lệnh
```sh
NODE_OPTIONS=--max-old-space-size=384 CREW_V2_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/crew_v2_test CREW_V2_TEST_CONTAINER_ID=<id> /opt/homebrew/bin/node --test --test-concurrency=1 --test-timeout=60000 v2/server/test/ticket-reads.test.ts v2/server/test/tickets.test.ts v2/server/test/dependencies.test.ts v2/server/test/journal.test.ts v2/server/test/journal-scope.test.ts v2/server/test/api-acceptance.test.ts
pnpm --dir v2/server exec tsc --noEmit --ignoreConfig --skipLibCheck --target ESNext --module NodeNext --strict --allowImportingTsExtensions --erasableSyntaxOnly --verbatimModuleSyntax --types node <3 .d.ts> src/tickets/history.ts src/tickets/routes.ts src/journal/routes.ts test/ticket-reads.test.ts
pnpm dlx @biomejs/biome@2.5.14 check <từng file>
```

## Hash SHA-256
| File | SHA-256 |
|---|---|
| tickets/history.ts | `7b9d9b57891a0d242537a7564b8c1c775db6890ea67f3904d820960869783dc5` |
| tickets/routes.ts | `8a36728cc017672ca61f2d038fef459a60a31d4cae626a1dc944865b2a301d0e` |
| journal/routes.ts | `bc7e09d9138520e5e97020d0dd50ed2917863210abe033c070bbb7174ec64029` |
| test/ticket-reads.test.ts | `df4e90bd85262059a083a13a6011cc99a054400579edb1576e4a144f961c4316` |
| producer-g1a-red.log | `4f8973b4cf7dd693a64be0a455d9b662404d5328ca2b4e17957161f71b04cfe6` |
| producer-g1a-green.log | `364c6897cee076d70d51ce21db2fa00c0ca56915d9845d38134bc67fa319ae88` |

## Tài nguyên và dọn dẹp
Heavy slot lấy 11:49 (sau khi web-s5a-fix2 trả), telemetry heavyEligible=true trước PG và trước GREEN (`producer-g1a-telemetry.log`: pressure 1, 4.6GiB, idle 84%, disk 751GiB). Container `crew-v2-test-10a11d71-cc99-4812-b972-61bb9843aabd`, ID `7a9bcdcf576c8e969477a1732b29b209293c704c48fe6207af98b9d80aec214c`, postgres:18.6, 256MiB/1CPU/pids64, cổng loopback 50363 (không phải 5432/55432). Đã `docker stop` (--rm), `docker ps -a` không còn, không tiến trình node còn lại, DB test do fixture tự drop. Manifest lock giữ từ khi đọc HEAD tới commit; heavy slot và manifest lock đã `rm -rf` đúng của em; bản sao docs tạm đã xóa.

## Giới hạn và việc còn lại
- Chưa làm "coherent full-root graph": `readGraph` (`dependencies.ts`, ngoài ownership) chạy ba query READ COMMITTED. Cần sửa thành REPEATABLE READ READ ONLY ở file đó (hoặc cấp quyền sửa).
- History chỉ là timeline từ journal hiện có; chưa có review/fallback/artifact/commit/docs-sync typed (G1b/G3) vì event chưa tồn tại.
- Test dùng migration 004 nên `ticket_docs` chưa có FK docs_files (006); route không phụ thuộc FK.
- Chưa có caller production cho `/v2/events/latest`: web `lib/events.ts` cần dùng nó (việc consumer).
