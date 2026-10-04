# Kho bền vững của Trợ lý

## Mục đích

Phase06/T1 lưu inbox, lượt Trợ lý và các chứng từ điều phối trong PostgreSQL. Inbox tích lũy khi máy offline hoặc chưa designation; chỉ fence hiện hành mới claim hoặc ACK. Paid budget mặc định bằng 0. Lượt chưa biết đã dừng hay chưa giữ quyền chiếm chỗ, không tự giải phóng theo TTL.

## Điểm vào

`assistant/inbox.ts` cung cấp `enqueueWork`, `ingestEvents`, `reconcileWork`, `claimWork`, `ackWork`. `assistant/store.ts` kiểm fence và cấp generation trong transaction. `assistant/contracts.ts` khai báo DTO và runtime schema strict cho toàn bộ DTO serializable, kể cả dữ liệu lồng trong routing tool/event/result, workflow, assessment, capacity và chứng từ R1–R4. Function port không có JSON schema. T1 chưa đăng ký route, driver, admission hoặc lời gọi model.

## Các bước

1. Ingestion khóa `event_cursor` rồi monitor, đọc event đã commit theo trang 200, chèn work và tiến cursor trong cùng transaction. Rollback giữ cả work và cursor ở trạng thái trước đó. Event duplicate vẫn cho cursor tiến; work đã claim/ACK không bị ghi đè.
2. `assistant.message.created` và message `attachment.input.changed` đọc revision từ message009. Ticket `attachment.input.changed`, `attachment.changed` đọc counter009 của đích. `comment.created` đọc cây con hiện tại và revision của từng descendant; không tăng counter thêm lần nữa. Ticket lifecycle `ticket.created/changed`, `dependency.added`, `decision.created`, `repair.recorded`, command và attempt events tạo work cursor riêng với `input_revision=null`. Event khác chỉ tiến cursor.
3. Input wake khử trùng trên `(target_kind,target_id,input_revision)` khi revision khác null. `reconcileWork` quét revision message/ticket thực để bù wake mất, dùng cùng khóa dedup và giữ logical key/source cursor ban đầu. Các hàm này không tạo turn hay quyền inference.
4. Ticket claim/ACK khóa event cursor và root trước các khóa authority. Message bắt đầu ở authority và không khóa root về sau. Guard calibration, machine, config, designation, turn và generation hiện hành đều phải khớp exact TurnFence. Claim chỉ nhận reserved/running; ACK nhận running/finalizing/stopped. Uncertain bị giữ lại. Replay cùng fence không tăng attempts hoặc sửa ACK terminal.
5. `allocateAssistantGeneration(tx)` khóa guard chung và tăng bigint monitor bằng UPDATE RETURNING, không reset hoặc wrap. Caller admission T2 phải bind giá trị với đúng normal turn hoặc calibration launch trong cùng transaction thành công; đọc/cấp generation tự nó không cấp quyền.
6. SQL011 bảo vệ liên kết conversation/message, một turn sống, chứng từ bất biến, scope cụ thể, hex64 effect và ordinal hành động persist trong target identity. R1 tách challenge/certification và measured routing receipt khỏi certificate workflow008. R2 giữ thứ tự tool call và kết quả terminal. R3 chỉ nối derived authorization đúng route với parent còn hiệu lực, không tăng expiry/allowOriginal hoặc mở rộng reference original.
7. R4 hook trên INSERT attempt kiểm launch đúng command/machine/process, chưa hết hạn hoặc retired, rồi bind attempt và active reservation nguyên tử. Release attempt cần stopped và finalized. Unclaimed release cần retirement cùng proof never-authorized hoặc launch đóng với exact identity và stop/journal chứng từ. UUID artifact không chứng minh đã dừng.

## Files

| Đường dẫn từ `v2/` | Vai trò |
|---|---|
| `server/migrations/011_assistant.sql` | Persistence Assistant và ràng buộc R1–R4 |
| `server/src/assistant/contracts.ts` | Hợp đồng typed nhập từ producer đã có |
| `server/src/assistant/store.ts` | Fence và generation persistence |
| `server/src/assistant/inbox.ts` | Cursor, reconciliation, claim và ACK |
| `server/test/assistant-store.test.ts` | PostgreSQL constraints, durable inbox và backup/restore |
| `server/test/support/assistant.ts` | Fixture009 và SQL preconditions chỉ dùng kiểm thử |

## Dữ liệu

Migrations001–010 giữ nguyên. SQL011 lưu config/designation/monitor/guard, routing certification, turns/selections/scopes, inbox, workflows/gates/questions/answers, assessments/dispatches, capacity/reservations, interventions/operation IDs, text/budget/route/retirement/launch/tool/doc receipts. Khóa ngoại dùng bảng thực và ON DELETE RESTRICT; các vòng phụ thuộc được kiểm deferred trong transaction.

`request_sha256` và `receipt_sha256` là SHA256 lowercase hex64 của toàn bộ DTO CapacityRequest/CapacityReceipt qua `canonicalJson`, không bao gồm hash tự thân hoặc linkage `receipt_id` ngoài DTO. Trusted producer T4 tính tại insert; T5 tiêu thụ. Hash không chứng nhận telemetry hay cấp admission. Consent producer phải kiểm identity/hash/current scope trước tạo linkage; artifact UUID chưa có registry generic trong001–010 nên trusted producer T2/native phải xác minh artifact và stop proof thực. Thiếu producer thì mặc định từ chối; fixture UNVERIFIED không phải production certificate.

Schema reject trường ngoài DTO, discriminator lạ, hash/UUID lỗi, số revision không an toàn và decimal bigint vượt 9223372036854775807. SourcePin/ProjectionPin dùng schema exported của producer hiện có. CreateTicket/SourceRef phản ánh shape type/route accepted; serialized CreateTicket bắt buộc workflowPin nullable, còn ticket HTTP route cũ có thể bỏ field và producer chuẩn hóa. Chỉ criteria/inputs/outputs/payload/result là JSON record theo đúng DTO producer; schema kiểm JSON đệ quy và cấm prototype keys, producer vẫn kiểm safeTicketJson/depth và business authority. Consumer phải cấu hình validator không xóa field dư, không ép kiểu hoặc chèn default.

## Flow liên quan

`server-journal` cấp event cursor và mutation transaction. `server-attachments` cấp conversation/message, authorization, snapshot và input revision009. `server-tickets` cấp ticket tree/lifecycle; `server-execution` cấp command/attempt và finalization. `server-models` và `server-gateway` cấp ModelKey, capabilities và pin thực. T2–T7 còn chịu trách nhiệm admission, grants, model routing, capacity, driver và HTTP assembly.

## Tests

`assistant-store.test.ts` chạy với private PostgreSQL18.6 và accepted baseline `0c838d2` cộng đúng source T1. Kiểm duplicate/restart, rollback cursor, concurrent ingestion, descendant revision, event/reconcile dedup, fence stale/unknown, generation rollback/overflow, bất biến linkage/receipt, effect ordinal, budget uncertain, R3 consent và R4 prelaunch/retirement. Pure validation dùng public compiler thực của Fastify, kiểm mọi DTO/variant cùng các negative nested, không mở HTTP/socket/model. Backup prefix010 được restore trước upgrade; prefix011 có dữ liệu cũng được dump/restore rồi đối chiếu SHA256 toàn bộ bảng và từng migration. Report Phase06/T1 ghi lần chạy cuối, các RED và identity/cleanup; các fixture SQL không chứng minh HTTP/admission/certification production. Typecheck frozen baseline, Biome các file sở hữu và kiểm đúng bảy H2 đi cùng source freeze.
