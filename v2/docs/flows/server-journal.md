# Nhật ký sự kiện và mutation bền vững

## Mục đích

Journal Crew v2 lưu mutation và sự kiện trong cùng giao dịch PostgreSQL. Khóa gửi lại giúp một request thành công chỉ chạy một lần; cursor sự kiện theo thứ tự commit để client đọc tiếp sau khi mất kết nối. Dữ liệu event chỉ chứa metadata đã khai báo, không chứa credential.

## Điểm vào

- `server/src/journal/mutation.ts` → `createMutator`, `mutate`: ghi idempotency và chạy công việc trong transaction.
- `server/src/journal/events.ts` → `appendEvent`, `readEvents`, `ownerOnlyEventScope`: phát cursor và đọc theo quyền.
- `server/src/journal/routes.ts` → `registerEventRoutes`: HTTP đọc event và SSE.

## Các bước

1. `server/src/journal/canonical.ts` → `canonicalJson`: sắp xếp key JSON, từ chối giá trị không thể biểu diễn an toàn. `server/src/journal/mutation.ts` → `createMutator` băm body SHA-256, kiểm tra khóa ASCII in được, rồi khóa phạm vi `(actor, route, key)` bằng advisory lock trong transaction.
2. `server/src/journal/mutation.ts` → `createMutator`: khóa `event_cursor`, rồi gọi callback `MutationContext.authorize(tx)` nếu route cung cấp. Callback kiểm tra scope và giữ khóa project trong cùng transaction trước cả khi đọc response idempotency đã lưu. Cùng hash trả response qua `ResponseCodec`; khác hash trả 409. Request mới chạy `work`, ghi response, rồi commit. Lỗi rollback cả công việc, event và response. Route không cung cấp callback giữ hành vi cũ; route máy execution bắt buộc cung cấp callback này để replay không vượt binding hiện hành.
3. `server/src/journal/event-contracts.ts` → `validateEventInput`: từ chối key nhạy cảm lồng sâu, type và payload chưa khai báo. Các hợp đồng gồm `machine.provisioned`, `project.created`, `project.bound`, metadata ticket `ticket.created/changed`, `dependency.added`, `comment.created`, `decision.created`, `repair.recorded`, và metadata execution `command.created/acknowledged`, `attempt.claimed/checkpoint/stopped/finalized`; docs `docs.imported` chỉ có importId/projectCount (1–100), `docs.synced` chỉ có snapshotId/sourceCommit/auditState trong project scope; `probe` chỉ phục vụ test nội bộ. Event docs không chứa page bytes, text hoặc audit issues. Nội dung comment/quyết định/evidence/checkpoint/result không đi vào event. `server/src/journal/events.ts` → `appendEvent` tăng `event_cursor` và chèn event trong transaction của caller.
4. `server/src/journal/events.ts` → `readEvents`: đọc scope và event trong cùng transaction `REPEATABLE READ READ ONLY`, tránh lấy binding cũ rồi thấy event mới sau một rebind. Event được trả sau cursor theo thứ tự tăng. Owner đọc toàn bộ; máy chỉ đọc project được `EventScopeReader` cấp và event gửi đích danh máy đó. Event gửi máy khác không lọt qua project scope. Phase 02 giữ journal vô hạn.
5. `server/src/journal/routes.ts` → `registerEventRoutes`: xác thực trước khi đọc hoặc mở stream. `GET /v2/events` trả `{items,cursor}`; cursor là event cuối trang hoặc cursor đầu vào khi trang rỗng. SSE lấy `Last-Event-ID` khi nối lại, đọc hết backlog theo trang rồi poll mỗi giây; heartbeat 15 giây. Socket chậm vượt 64 KiB bị đóng để client phát lại từ cursor cuối; socket đóng hoặc app shutdown dừng vòng poll.

8. `server/src/journal/routes.ts` → `registerEventRoutes`: Tham số currentCredential tùy chọn cho assembly recheck actual credential trong cùng repeatable-read snapshot với scope/events, mỗi backlog page/poll; stream owner hết hạn/machine thu hồi bị đóng. Hook preClose phá socket SSE trước server shutdown; log stream chỉ code, không ghi raw error. HTTP acceptance chứng minh revocation/expiry không phát event mới, race snapshot và shutdown.

9. `server/src/journal/event-contracts.ts` whitelist thêm gateway.config.changed, gateway.booted, gateway.install.reported, gateway.command.created và gateway.command.acknowledged. Event chỉ chứa revision/UUID/generation/type/phase/accepted, audience đích danh máy, project/ticket null; từ chối raw inventory, URL, result, error hay secret. Gateway service append cùng transaction CAS/ACK/report; heartbeat receipt không phát event và không thay attempt. Authorization recheck actual credential chạy trước cached replay, máy chưa gắn project chỉ đọc event dành riêng mình theo scope hiện hành.

## Files

| Đường dẫn từ `v2/` | Vai trò |
|---|---|
| `server/migrations/002_journal.sql` | Bảng cursor, event và idempotency; index cho project và máy |
| `server/src/journal/canonical.ts` | JSON canonical cho hash và kiểm tra payload |
| `server/src/journal/mutation.ts` | Transaction, khóa gửi lại và response codec |
| `server/src/journal/event-contracts.ts` | Whitelist event metadata |
| `server/src/journal/events.ts` | Ghi và đọc event theo actor/scope |
| `server/src/journal/routes.ts` | Endpoint đọc event và SSE |
| `server/test/journal.test.ts` | Kiểm thử cạnh tranh, rollback, scope và reconnect |
| `server/test/journal-scope.test.ts` | Kiểm thử rebind commit giữa hai bước đọc scope/event |
| `server/test/ticket-events.unit.test.ts` | Kiểm thử whitelist metadata ticket và chặn nội dung dư |
| `server/test/execution-events.unit.test.ts` | Kiểm thử whitelist metadata execution và chặn dữ liệu nhạy cảm |

## Dữ liệu

`event_cursor` có một hàng `singleton=true`, bắt đầu ở 0. `events.cursor` là bigint tăng trong transaction, không dùng sequence cấp trước commit. `idempotency` có khóa chính `(actor_kind, actor_id, route, key)` và giữ response thành công vô hạn trong giai đoạn này. `MutationContext.authorize` là callback bất biến theo mutation do route truyền, không được lưu như body hay cho client điều khiển. Response credential do `ResponseCodec` của module auth mã hóa trước khi lưu; journal không giải mã hoặc ghi token vào event. Cursor API là chuỗi thập phân không âm. Docs import/sync chuyển NUL trong audit/link metadata sang projection literal trước khi report vào JSONB/idempotency; journal giữ response đã biểu diễn an toàn, không sửa hay lưu byte nguồn trong event. Byte gốc và hash nguồn thuộc immutable docs_files; issue projection/FTS nằm trong audit report, không phát nội dung vào event.

## Flow liên quan

`server-platform` cấp migration, fixture, hợp đồng `Actor`, `Tx`, `ResponseCodec`. Flow identity cung cấp authenticator, codec mã hóa credential và project scope; các flow ticket, execution và docs sau đó dùng mutation/event journal.

## Tests

`pnpm --dir v2/server test` dùng PostgreSQL container riêng. `journal.test.ts` kiểm tra replay đồng thời, payload khác trả 409, rollback không tiêu cursor, hai kết nối commit theo cursor, máy không thấy global/project lạ, event nhạy cảm bị chặn và SSE xác thực/nối lại sau restart. `journal-scope.test.ts` dùng migration 003, tạm dừng sau khi scope đọc binding, commit rebind từ kết nối khác rồi xác nhận máy cũ không thấy event mới. `commands.test.ts` xác nhận hook phân quyền chạy trước cached replay và giữ khóa project để rebind không chen giữa. `ticket-events.unit.test.ts`, `execution-events.unit.test.ts` và `docs-events.unit.test.ts` chặn event có text/result/bytes/issues hoặc trường dư; event docs cũng kiểm tra commit, audit enum và giới hạn projectCount. `pnpm --dir v2/server typecheck` cùng Biome kiểm tra kiểu và định dạng.

Phase04 model pool thêm `source.desired {revision}` và `source.applied {revision,reportId}`: revision dương, UUID report, project/ticket null và audience máy bắt buộc. `gateway.command.created` thêm literal `sync_models`; supersede phát acknowledged metadata một lần. Event không nhận provider endpoint, catalogue, probe/certificate evidence hoặc secret/envelope bytes. Mutation models reauthorize actual credential trong cùng transaction trước cache; secret owner response chỉ operation/status, ciphertext không ở generic journal response.

Phase05 Task1 đăng ký `attachment.changed` với đúng `{attachmentId,state,extraction}`: UUID hợp lệ, state/extraction thuộc enum và không chấp nhận trường dư, bytes, path hay nội dung. Event chỉ owner-only với project/ticket/audience null cho draft chưa live link, hoặc project và ticket cùng có giá trị khi live link tồn tại; không gửi audience máy. Staging ghi event cùng ready CAS transaction, giữ original/intent khi transaction thất bại. `server/test/attachment-event.test.ts` kiểm metadata hợp lệ và các ca từ chối; flow `server-attachments` quản lý file test mới.
