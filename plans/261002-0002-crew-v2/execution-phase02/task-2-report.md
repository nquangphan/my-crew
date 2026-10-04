# Task 2 — journal/idempotency/events/SSE

## Phạm vi và giao diện

Đã thêm migration `002_journal.sql`, `src/journal/{canonical,event-contracts,mutation,events,routes}.ts`, `test/journal.test.ts` và `v2/docs/flows/server-journal.md`. Không sửa nguồn v1, contracts nền tảng, manifest, package, index hoặc Git. Exports: `canonicalJson`; `createMutator`, `mutate`; `appendEvent`, `readEvents`, `ownerOnlyEventScope`, `EventScopeReader`; `registerEventRoutes(app,options,deps,scope)`.

`GET /v2/events` trả `{items,cursor}`. `GET /v2/events/stream` xác thực trước `hijack`, dùng `Last-Event-ID` ưu tiên hơn query `after`, phát SSE theo cursor. Event whitelist ban đầu: `machine.provisioned {machineId}`, `project.created {revision}`, `project.bound {machineId,bindingRevision}`; `probe` nội bộ cho test. Payload lạ/nhạy cảm bị từ chối.

## RED → GREEN

- Test journal đầu tiên RED do các module chưa tồn tại (`ERR_MODULE_NOT_FOUND` ở `canonical.ts`), sau migration và implementation, 7/7 test service GREEN. Đây là RED cấu trúc, không tính là bằng chứng nhánh hành vi.
- Test SSE RED do `routes.ts` chưa tồn tại; sau route implementation, focused journal 8/8 GREEN. Đây cũng là RED cấu trúc.
- `event read từ chối query lạ và cursor không hợp lệ`: RED rõ hành vi `200 !== 400` với query `extra=1`; thêm kiểm tra khóa query và own property, GREEN 1/1.
- `event read trả items và cursor cuối cùng của trang`: RED rõ wire shape `['events']` thay vì `['items','cursor']`; sửa route trả cursor cuối trang hoặc cursor đầu vào khi trang rỗng, GREEN trong focused journal 10/10.

## Kiểm tra cuối

- `pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/journal.test.ts`: 10/10 pass, 0 fail, 0 warning.
- `pnpm --dir v2/server test`: 28/28 pass, 0 fail, 0 warning; gồm auth, platform, projects và journal trong một lượt đầy đủ sau edits ổn định.
- `pnpm --dir v2 test`: 14/14 domain pass, 0 fail.
- `pnpm --dir v2/server typecheck`: exit 0, không diagnostics. Có lượt typecheck trung gian fail vì file auth/test helper đang viết đồng thời; lượt cuối sau đồng bộ đã sạch.
- `node_modules/.bin/biome check v2/server/src/journal v2/server/test/journal.test.ts`: 6 files, no fixes applied, exit 0.
- `git diff --check`: exit 0.

## Tự rà soát

- Cursor dùng một hàng `event_cursor` khóa trong transaction. Hai mutation khác key không thể nhận cursor theo thứ tự ngược commit; rollback không để lại event hoặc khóa replay.
- Advisory lock theo `(actor.kind, actor.id, route, key)` chỉ cho một request cùng khóa chạy `work`; body hash canonical chống đổi payload. Codec nhận context để auth mã hóa credential với AAD đúng route/key; test journal chỉ kiểm tra cơ chế codec, còn auth suite kiểm tra mã hóa thật.
- Machine chỉ nhận event cho project được scope cấp hoặc event có `audience_machine_id` đúng ID; targeted event của máy khác không đi qua project scope. Public route lấy actor từ `deps.auth.authenticate`.
- SSE đọc hết backlog theo trang rồi poll 1 giây, heartbeat 15 giây, đóng socket khi buffered bytes vượt 64 KiB, dừng poll khi socket/app đóng. Reconnect qua DB sau app restart đã được test.
- Rủi ro tích hợp còn lại: `EventScopeReader` và query `events` là hai lệnh đọc ở READ COMMITTED, nên quyết định scope phản ánh trạng thái tại thời điểm reader chạy. Nếu phase sau cho phép revoke/rebind project ngay giữa một lượt đọc, cần đánh giá snapshot/transaction của quyền đọc cùng route tích hợp. Phase02 hiện binding từ chối đổi máy khi đã bound.

## Fix round 1 — scope và event cùng snapshot

Independent review tại `task-2-review.md` xác nhận P1: `projectEventScope` đọc binding máy A ở statement đầu; sau khi rebind sang máy B commit, statement SELECT `events` ở READ COMMITTED thấy event mới của B nhưng vẫn dùng danh sách project cũ của A. Bản ghi mới có thể bị lộ cho A.

Test `journal-scope.test.ts` dùng migration prefix 3, `projectEventScope` thật và hai kết nối. Barrier dừng sau khi scope đọc project; kết nối khác chạy `bindProject` với guard đã đối chiếu, commit event `project.bound`, rồi mới nhả lượt đọc cũ. RED trước fix: máy A nhận `['1']` thay vì `[]` (exit 1); B thấy event mới khi đọc lại. Không dùng sleep/timing đoán.

Fix: `readEvents` mở transaction `REPEATABLE READ READ ONLY` và truyền cùng `Tx` cho `EventScopeReader`, sau đó SELECT events trên `Tx` đó. Contract reader đổi `Db` → `Db | Tx`; chỉ chữ ký `projectEventScope` trong `projects/service.ts` đổi tương ứng, không đổi logic query. Snapshot được xác lập khi scope SELECT; event commit sau đó không xuất hiện trong lượt đọc cũ. Focused GREEN: `journal-scope.test.ts` 1/1, exit 0.

Kiểm tra bao phủ cuối sau fix: `pnpm --dir v2/server test` 39/39 pass, 0 fail, 0 warning; `pnpm --dir v2/server typecheck` exit 0, không diagnostics; `node_modules/.bin/biome check v2/server/src/journal/events.ts v2/server/src/projects/service.ts v2/server/test/journal-scope.test.ts` kiểm 3 file, no fixes applied; `git diff --check` exit 0. Flow `server-journal.md` và `server-identity.md` đã mô tả contract snapshot theo R3. Chưa commit/stage.

Lifecycle SSE còn là quyết định tích hợp riêng: stream hiện xác thực actor một lần trước `hijack` và giữ actor đó khi poll. Revocation trong lúc stream đang mở chưa làm stream tự đóng hoặc xác thực lại từng poll. PM/Task5 cần chốt cơ chế kết thúc hoặc xác thực lại stream theo vòng đời credential; fix này chỉ khóa quyền project/event trong một lượt đọc.
