# Cây ticket, phụ thuộc và bằng chứng hoàn tất

## Mục đích

Flow ticket Crew v2 lưu yêu cầu → bước → công việc trong cùng dự án và cùng gốc, các cạnh phụ thuộc không có chu trình, timeline bình luận/quyết định, và lịch sử vòng sửa. Trạng thái hoàn thành phụ thuộc vào bằng chứng được ghi nhận và xác minh; request của người dùng không thể tự gửi trạng thái `done`.

## Điểm vào

- `server/src/tickets/routes.ts` → `registerTicketRoutes`: tạo, đọc, nối phụ thuộc, gửi tín hiệu hợp lệ, bình luận, quyết định, repair result và liên kết docs.
- `server/src/tickets/service.ts` → `createTicketServices`: gắn các reader/authority bất biến theo ứng dụng; mặc định từ chối cổng chưa được tích hợp.
- `server/src/tickets/dependencies.ts` → `addDependency`, `readGraph`: lưu DAG và trả dữ liệu sơ đồ thực tế.

## Các bước

1. `server/src/tickets/service.ts` → `createTicket` kiểm tra quyền dự án, ba cấp cha con, workflow pin của cha rồi chèn ticket. Sau khi khóa root, service đọc lại root/cha và từ chối tạo con nếu một trong hai đã hoàn tất hoặc hủy. Request tự trỏ `root_id` và mặc định chọn Superpowers trong criteria nếu chưa chọn. Event `ticket.created` chỉ mang revision/trạng thái.
2. `server/src/tickets/dependencies.ts` → `addDependency` khóa root trước khi kiểm tra hai đầu cạnh và duyệt CTE đệ quy theo predecessor. Hai transaction thêm cạnh ngược chiều không thể cùng commit. Không sửa dependency của ticket đã `ready`, `running` hoặc kết thúc; Task 5 còn kiểm tra lại predecessor khi claim.
3. `server/src/tickets/decisions.ts` → `appendComment`, `recordDecision` lưu nội dung trong bảng riêng và phát event chỉ chứa ID metadata. Nguồn quyết định phải là ticket/owner decision/artifact đã ghi nhận trong cùng gốc, hoặc trang docs được reader xác minh. Máy không thể ghi owner answer hoặc approval.
4. `server/src/tickets/service.ts` → `signalTicket` cho HTTP chỉ nhận `dependencies_ready`, `wait_owner`, `resume`. Phụ thuộc phải `done`. Với ticket đang chạy, `wait_owner` gọi authority tạo ý định dừng/command trong transaction. Trước khi có stop proof, ticket vẫn `running`; nếu stop proof đã có, callback có thể finalize ngay thành `needs_input`. Event `ticket.changed` lấy trạng thái và revision từ row sau callback, khớp DB/response. Root lock nối tuần tự completion với việc thêm con. Khi finalize vòng sửa thứ năm, lý do `repair_limit` được giữ nguyên.
5. `server/src/tickets/deploy.ts` → `deployTicketFingerprint`, `readDeployAuthorization` chứng minh provenance của từng hành động deploy. Owner tạo request deploy chỉ cấp quyền cho chính request đó, không cấp quyền thừa kế cho hậu duệ. Máy không tạo request deploy gốc và mọi deploy child do máy tạo phải có approval owner khớp SHA-256 canonical của toàn bộ input có ý nghĩa, gắn đúng root; đổi title, target hoặc body đều bị từ chối. Quyết định được gắn vào một ticket. Gate thực thi Task 5 phải đọc cùng hàm này trước khi chạy deploy.
6. `server/src/tickets/completion.ts` → `readCompletionFacts` kiểm tra mọi hậu duệ bắt buộc, loại evidence `verification='verified'` và loại bổ sung trong `criteria.requiredEvidenceKinds`. Request code cần merge evidence đã xác minh và snapshot docs khớp commit; request research cần artifact đã xác minh; deploy root do owner tạo tự có quyền, mọi deploy child cần approval đúng ticket kể cả khi owner trực tiếp tạo child. Bước/công việc khác đạt theo evidence riêng. Reader docs mặc định trả null tới khi Task 7 nối snapshot thật. Phase 08 bổ sung authority kiểm chứng merge.
7. `server/src/tickets/repair.ts` → `recordRepairResult` xác minh attempt/fence trước cả khi trả cycle lặp, lưu kết quả/evidence và nhánh fix cùng gốc. Initial review, lỗi hạ tầng và đổi model không tăng bộ đếm; chỉ `repair_review` thất bại tăng tới 5. Lần thứ 5 lưu cycle đang chờ duyệt và thời điểm, lý do `repair_limit`, gọi authority lưu ý định/command dừng. Nếu host đã xác nhận dừng, authority có thể finalize ngay thành `needs_input`; bản ghi repair chỉ cập nhật counter/reason/revision, không ghi đè status bằng snapshot `running` cũ. `owner_answer` phải cùng cycle, ghi sau thất bại; `resume` tiêu quyết định một lần dưới khóa root/step, giữ counter 5.
8. `server/src/tickets/docs-links.ts` → `linkDocs` chỉ ghi liên kết trang sau khi reader docs xác minh từng path trong snapshot. Mặc định không có reader nên từ chối.

8. `server/src/tickets/authorization.ts` → `authorizeTicketMutation`: Mọi ticket mutation create/dependencies/signals/comments/decisions/repair-results/docs-links có authorize(tx) trước cached replay; helper khóa root/ticket/project rồi kiểm tra machine hiện hành dưới FOR SHARE. Rebind/thu hồi commit trước guard khiến replay scoped 404. App nối execution authority và docs source/completion readers. HTTP acceptance kiểm tra mọi family, race hai pool và lần repair thứ năm giữ guard đến physical stop.

## Files

| Đường dẫn từ `v2/` | Vai trò |
|---|---|
| `server/migrations/004_tickets.sql` | Bảng ticket, DAG, timeline, evidence, repair và liên kết docs |
| `server/src/tickets/contracts.ts` | Hợp đồng ticket và callback authority/reader |
| `server/src/tickets/service.ts` | Tạo ticket, scope, tín hiệu và factory |
| `server/src/tickets/dependencies.ts` | Cạnh phụ thuộc và sơ đồ |
| `server/src/tickets/deploy.ts` | Chứng minh owner intent và fingerprint deploy |
| `server/src/tickets/decisions.ts` | Bình luận, quyết định và kiểm tra nguồn |
| `server/src/tickets/completion.ts` | Sự thật hoàn tất từ DB/reader |
| `server/src/tickets/repair.ts` | Kết quả kiểm tra và tối đa năm vòng sửa |
| `server/src/tickets/docs-links.ts` | Liên kết ticket với snapshot đã xác minh |
| `server/src/tickets/authorization.ts` | Tx scope/current machine guard trước cached replay |
| `server/src/tickets/routes.ts` | HTTP validation, scope và idempotency |
| `server/test/support/tickets.ts` | Fixture dự án/ticket qua service và mutator |
| `server/test/tickets.test.ts` | Schema, route, quyết định và liên kết docs |
| `server/test/dependencies.test.ts` | Cây và cạnh đồng thời |
| `server/test/deploy.test.ts` | Quyền deploy của root và approval đúng định nghĩa |
| `server/test/completion.test.ts` | Cổng bằng chứng và commit docs |
| `server/test/repair.test.ts` | Bộ đếm, ý định dừng và fence |
| `server/test/ticket-events.unit.test.ts` | Payload event metadata hợp lệ |

## Dữ liệu

`tickets.root_id` của request bằng ID chính nó; khóa ngoại root được trì hoãn đến commit. `created_actor_kind/id`, `deploy_definition_hash` và `deploy_approval_decision_id` là provenance bền vững cho cổng deploy. `dependencies` giữ cặp ticket–predecessor, `repair_links` nối bước kiểm tra với công việc sửa theo cycle. `repair_limit_cycle_id`/`repair_limit_at` chỉ cycle mới nhất đang chờ; `repair_limit_consumed_decision_id` ghi quyết định đã dùng. `evidence.data.verification='reported'` chỉ là lời báo; cổng hoàn tất chỉ nhận `verified` do authority nội bộ tạo. `repair_cycles` nằm trên chính bước kiểm tra và không reset khi đổi model hay thêm ticket sửa. Event journal không chứa nội dung comment/quyết định/evidence.

## Flow liên quan

`server-platform` cấp DB và transaction; `server-journal` cấp mutation idempotent và event; `server-identity` cấp scope máy/dự án. Task 5 nối execution authority để kiểm chứng attempt/fence và hoàn tất ý định dừng; Task 7 nối reader snapshot docs đã xác minh. Hai dependency này mặc định chặn khi chưa được nối.

## Tests

`pnpm --dir v2/server test` chạy PostgreSQL container riêng với DB prefix `crew_v2_test_`. Các bài test kiểm tra cây ba cấp, cạnh đối nghịch đồng thời, completion tranh chấp với tạo con, trạng thái dependency sau khi ready, deploy child dưới owner root vẫn cần approval đúng title/body, bằng chứng code/research/docs, owner answer theo cycle, 5 vòng repair, stale fence, schema event và route từ chối field dư. `server/test/attempts.test.ts` còn kiểm tra lần sửa thứ năm đến sau stop proof: ticket giữ `needs_input`, `repair_limit` và revision tăng. `pnpm --dir v2/server typecheck` và Biome kiểm tra kiểu/định dạng.
