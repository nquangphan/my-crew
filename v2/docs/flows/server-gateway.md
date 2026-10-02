# Cổng máy: heartbeat, workflow và lệnh quản trị Crew v2

## Mục đích

Lưu cấu hình mong muốn, trạng thái cài từng nguồn/runtime, heartbeat và lệnh đồng bộ bền vững cho máy.
Heartbeat chỉ là lời báo của host; mất kết nối hoặc lời báo process dừng không thay attempt, fence hoặc
execution guard của migration 005. Route projection lưu cặp source/runtime của một attempt đã được
server cho phép; authority production mặc định vẫn từ chối đến phase06.

## Điểm vào

- `server/src/gateway/routes.ts` → `registerGatewayRoutes`: namespace `/v2/gateway`.
- `server/src/gateway/service.ts` → `authorizeGatewayMutation`, `registerBoot`, `saveHeartbeat`,
  `writeGatewayConfig`, `saveInstallReport`, `saveAttemptProjection`.
- `server/src/gateway/contracts.ts`: DTO và schema HTTP đóng, không nhận trường dư.
- `server/migrations/007_gateway.sql`: namespace riêng, không sửa SQL 001–006.

## Các bước

1. `registerGatewayRoutes` xác thực bearer machine hoặc owner session. Owner PUT cần Origin/CSRF;
   mỗi mutation cần `Idempotency-Key` qua journal 002. `authorizeGatewayMutation(tx)` chạy trước cả
   cached replay: lấy khóa entity 005 nếu có projection, khóa máy, kiểm actual credential hiện hành;
   owner giữ khóa session đọc. Máy chưa gắn project được quản trị workflow của chính mình; quyền
   đọc/ghi project vẫn dùng scope cũ. Read recheck actual credential trong snapshot repeatable-read.
2. `POST /v2/gateway/boots` CAS `{bootId,previousGeneration}` dưới khóa máy. Boot generation tăng,
   retirement giữ lịch sử; current boot replay generation/time ban đầu. Boot mới với CAS cũ hoặc
   boot đã retired bị từ chối, không thay boot mới. Cached logical operation vẫn giữ response gốc.
3. `POST /v2/gateway/heartbeat` kiểm receipt `(machine,generation,sequence)` và body hash trước khi
   kiểm current boot. Receipt đã commit replay bất biến kể cả retired boot; hash khác 409. Receipt
   mới bắt buộc current boot và sequence tăng. `receivedAt`/`serverTime` từ clock server; observedAt
   chỉ tham khảo. Inventory/error được giới hạn và làm sạch, không đụng applied/005.
4. `GET /v2/gateway/config` trả config cùng applied summary. Trước owner cấu hình, trả
   `{desiredConfig:null,applied:null}`; server không tạo source pin giả. Owner
   `PUT /v2/gateway/machines/:id/config` CAS `expectedRevision` (0 cho lần đầu), nhận đủ cả hai
   sources và ba projection slot nullable. URL chỉ HTTPS repository/archive hoặc BMAD npm tarball
   thuộc allowlist version/revision cố định; registry yêu cầu packageIntegrity, Git archive là null.
   Projection phải đúng runtime slot và source tree. Config thực sự đổi mới tăng revision, append
   metadata event và queue `sync_workflows` chứa configRevision, không chứa URL hay secret.
5. `GET /v2/gateway/commands?after=<cursor>&limit=<n>` đọc tất cả command sau cursor theo thứ tự
   commit bền vững, default 50/max100; nextCursor là cursor cuối trả hoặc đầu vào nếu rỗng. Cursor
   bigint thập phân thuộc namespace 007, khác page anchor UUID của 005. Command giữ offline và
   cả state completed trong lịch sử. ACK received/completed tại `/commands/:id/ack` chỉ đúng máy;
   completion trực tiếp ghi cả received/completed time. Received sau completed không hạ state;
   completion khác result bị `COMMAND_ACK_CONFLICT`. Details nhận object/string/array lồng tối đa 4 lớp, mỗi collection 20 mục; string tối đa 200 ký tự, từ chối control character, path và secret/token trong key/value.
6. `POST /v2/gateway/install-reports` replay reportId/hash đã commit trước current boot/config check,
   không đổi status/applied khi replay. Report mới phải đúng current boot và config revision. So toàn
   bộ SourcePin (kể cả sourceUrl/provenance) và ProjectionPin/derivation; slot current lệch pin được
   ghi mismatch. Chỉ cả hai source và mọi desired projection khác null đúng mới advance applied.
   Partial/error giữ revision/appliedAt cũ, nhưng ghi per-slot status mới. Raw lastError được thay bằng
   mã/thông báo cố định cả khi lưu report. `latest_report_id` là pointer nội bộ có FK cùng máy; không
   chọn current report bằng timestamp/UUID. Receipt và report không TTL, DB chặn update/delete.
7. `POST /v2/gateway/attempts/:id/projection` kiểm current binding, active guard, exact fence/process
   dưới khóa entity trước cached response. Row companion cùng attempt/cùng pin replay bất biến;
   đổi pair 409. Row mới gọi `GatewayProjectionPolicy.authorize(tx,{attemptId,actor})`, mặc định
   `SELECTION_NOT_CONFIGURED` 503. Selection trả về phải khớp payload command và scope dispatch
   decision đúng ticket, report accepted cùng máy/revision, domain Pin của attempt và projection.
   Policy phase06 phải chứng minh authority tại claim và current config/report lúc claim; report
   lịch sử đơn lẻ không cấp quyền. Config đổi sau claim được phép vẫn giữ cặp đã được authorizer
   xác nhận. Private fixture lưu proof trong bảng test, không có bypass production.
8. Owner `GET /v2/gateway/machines/:id/status` trả current boot, desired/applied revisions, các source
   và runtime slot, command chờ, process running/unknown. Trạng thái offline sau 60 giây dựa trên
   receipt server; boot mới chưa heartbeat cũng offline. Không route nào chạy model, cấp permit,
   reconcile process dừng hoặc nhả guard.

## Files

| Đường dẫn từ `v2/` | Vai trò |
|---|---|
| `server/migrations/007_gateway.sql` | 9 bảng, FK/CHECK/UNIQUE, retired boot và immutable receipts/report/pair |
| `server/src/gateway/contracts.ts` | SourcePin, ProjectionPin, GatewayConfig, GatewayHeartbeat, InstallReport, DispatchSelection, AttemptProjectionPin, GatewayStatus, schemas |
| `server/src/gateway/service.ts` | Boot/config CAS, replay, apply, ACK và fenced companion |
| `server/src/gateway/routes.ts` | HTTP auth, strict schemas, mutation authorization và read snapshot |
| `server/test/support/gateway.ts` | HTTP owner/machine thật, pin/status fixtures và private DB-backed claim/selection authority |
| `server/test/gateway.test.ts` | Protocol, scope, replay races, restart, DB constraints và backup/restore |

## Dữ liệu

`gateway_command_cursor` cấp cursor trong transaction, sau khóa journal/máy; không dùng sequence cấp
trước commit. Boot, heartbeat, config và report serialize theo máy. Companion giữ thứ tự khóa journal
cursor → root/ticket/project/attempt/guard 005 → machine → 007; không lấy machine trước root/project.
`gateway_applied.revision=0` biểu diễn chưa có lần fully-applied; appliedAt null. Report mới nhất có thể
partial trong khi revision vẫn là lần áp dụng trước, vì vậy validator không suy readiness từ revision
đơn lẻ. JSON report/receipt giữ response gốc vô hạn, có body hash canonical; lịch sử không cấp quyền
cho credential bị rotate/revoked hoặc binding đã đổi.

Migration chỉ chạy khi caller chọn prefix 7. BuildApp không auto-migrate/listen. Không có credential
field, ticket_id hoặc command execution type trong bảng quản trị gateway. Server xác nhận pin được
máy báo khớp desired; tải byte, checksum archive/tree và kiểm redirect từng hop thuộc host registry.

## Flow liên quan

`server-platform` cấp migrate/DB fixture; `server-journal` cấp auth-before-cache transaction, cursor và
metadata-only events; `server-identity` cấp bearer/session/project scope; `server-execution` giữ claim,
process identity, fence và guard; `server-docs-view` ghép route với default dispatch/final/projection deny.
Host sync/launcher ở các task tiếp theo tiêu thụ DTO, không được biến heartbeat thành stop proof.

## Tests

`pnpm --dir v2/server test --test-file <absolute gateway.test.ts>` dùng đúng một test file trong runner,
container PostgreSQL18.6 riêng và logical DB prefix7. Tests chứng minh boot CAS race, retired immutable
replay, receipt thứ tự/hash/server clock, config CAS/Origin/CSRF/URL/schema, command ACK/cursor,
partial/failed slots, exact source/projection/derivation, report/config/boot cũ, default selection deny,
DB-backed claim proof, null runtime, stale fence và giữ pair sau update. HTTP race giữ event_cursor,
rotate token/expire session giữa prehandler và mutation, xác nhận cached response bị chặn ở cả năm
machine family. Close/reopen pool và pg_dump/pg_restore xác nhận durable receipts. Diễn tập backup
prefix6, restore6, migrate7, restore7 giữ receipt và checksum; fixture drop đúng logical DB trong finally,
runner dừng đúng container đã tạo, không dùng 5432/55432 hoặc shared DB. Covering server suite,
server typecheck và Biome kiểm tra sau batch cuối.

Consumer Task 5 ở gateway dùng machineTransport và HttpOperationJournal cho boot/heartbeat/ACK/report/
companion. GatewaySync persist command/cursor/report trước network, retry partial trên cùng command với report
mới và xử lý SUPERSEDED bất biến. TicketCommandBridge dùng scoped005 read trước RELEASE/retirement; fresh
claim và companion phải được actual stored command/decision authority chấp thuận. Actual DB prefix8 tests
kiểm lost reply, stale/disabled/missing selection, config update sau claim, pause/cancel native STOP, finalizing
guard và đúng một terminal event. Test authorizer/final receipt table chỉ sống trong logical DB riêng; không
thay default dispatch/selection/final verifier production, SQL005/007/008 hay authority model.

Task5 FIX1 consumer: command revision lớn hơn snapshot desired được hoãn qua reconnect;
503/500/502/504 đã xác nhận được retry hữu hạn mỗi pass với chính idempotency key/body cũ và lịch
backoff durable, kể cả lỗi quan sát xuất hiện sau actual commit. Journal giữ response đầu và retry
history riêng. Kiểm thử prefix8 chứng minh boot/heartbeat/ACK/report không tạo mutation trùng.
Lifecycle boot mới dùng actual bridge reconciliation với prior generation CAS007; exact UNKNOWN
active/uncertain vẫn giữ guard005 và local pin, không tự cấp STOP. Retired history có immutable receipt
được skip sau project rebind; history chưa retired 404 fail closed riêng attempt, control ticket khác
vẫn tiến triển. Không sửa schema hoặc authority005/007/008.

Report pending qua chuyển boot replay key cũ trước; actual committed receipt được trả theo007. Nếu server xác nhận BOOT_RETIRED cho report chưa chấp nhận và consumer đã bind tuple boot mới, pass sau tạo observation/report mới từ verified registry; giữ nguyên lịch sử HTTP cũ và không đổi key cho reply ambiguous/503.
