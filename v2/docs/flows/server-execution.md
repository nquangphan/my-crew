# Lệnh bền vững và đối chiếu tiến trình Crew v2

## Mục đích

Server lưu lệnh và attempt theo máy đang gắn với dự án. Một ticket chỉ có một attempt giữ quyền tại một thời điểm; fence tăng khi một lần chạy mới được cấp. Mất heartbeat hay hết lease chỉ làm tiến trình cần đối chiếu, không chứng minh nó đã dừng. Việc hoàn tất ticket chỉ xảy ra sau quan sát dừng từ máy và kiểm chứng kết quả trong cùng transaction.

## Điểm vào

- `server/src/execution/routes.ts` → `registerExecutionRoutes` mở API lệnh, claim, đăng ký artifact, checkpoint, result, reconcile và đọc trạng thái cho máy.
- `server/src/execution/attempts.ts` → `claimAttempt`, `reconcileAttempt`, `submitAttemptResult`, `recheckFinalization`, `assertNoActiveProjectExecution` là các điểm nối cho gateway và binding guard.

## Các bước

1. `server/src/execution/commands.ts` → `createCommand` khóa cây ticket và dự án, lưu target cùng binding revision hiện tại rồi phát event metadata. `listCommands` phân trang lệnh còn chờ theo `(created_at,id)`; `after` là page anchor, kể cả khi lệnh neo đã completed. So sánh timestamp anchor diễn ra trong SQL để giữ microsecond, tránh lặp trang khi anchor còn queued. Gateway bắt đầu mỗi lượt poll từ `null` và tự khử trùng lệnh bằng journal của máy. `readCommand` cho phép đọc lại trạng thái sau khi mất phản hồi.
2. `server/src/execution/attempts.ts` → `claimAttempt` khóa root/ticket/project/guard, kiểm tra binding, revision, dependency, workflow pin, quyền deploy và permit còn hạn. Callback `authorizeDispatch` phải xác minh quyền thật trong transaction; mặc định `denyDispatch` trả 503. Cùng command và launch ID trả cùng attempt sau mất phản hồi, launch ID khác nhận 409. Một lần cấp mới tăng fence và chuyển ticket `ready → running` qua `TicketServices`.
3. `server/src/execution/attempts.ts` → `registerArtifactEvidence` nhận locator tương đối trong lần chạy, SHA-256 và source commit do máy báo cáo, kiểm tra machine/binding/guard/fence/launch ID rồi ghi evidence cùng attempt với `verification='reported'`. Route dùng idempotency key và transactional ACL; cùng key trả lại ID đã ghi nếu binding còn hợp lệ. Attempt `active` hết lease từ chối artifact mới và giữ guard đến khi reconcile `running`; vẫn cho phép đăng ký trễ khi guard đang `finalizing`, từ chối tạo mới sau finalized. Server không đọc file hay chứng thực byte từ hash client. `saveCheckpoint` đối chiếu sequence và chỉ nhận artifact IDs đã đăng ký trong attempt này. Hết lease ghi `uncertain`, không chấp nhận tiến độ mới; máy phải reconcile. `readAttempt` chỉ trả bản ghi của binding hiện hành.
4. `server/src/execution/attempts.ts` → `reconcileAttempt` nhận quan sát `running` hoặc `stopped` từ máy đã xác thực với launch ID và fence, ghi provenance vào `reconciliation_observations`. Quan sát dừng ghi `stopped_at` và giữ guard ở `finalizing`; lý do dừng khác bản đã ghi bị từ chối. Lệnh pause/cancel chỉ được tái dùng nếu payload nhắm đúng attempt, machine và binding revision hiện hành; lệnh cũ giữ payload bất biến. `submitAttemptResult` lưu kết quả bất biến; kết quả hỏi owner ghi decision có scope attempt. Hai tín hiệu có thể đến khác thứ tự. `recheckFinalization` dùng khóa idempotency mới để kiểm chứng lại kết quả đã lưu.
5. `server/src/execution/attempts.ts` → `finalizeAttempt` chỉ giải phóng guard sau khi có stop proof và terminal intent hợp lệ. Kết quả complete/retry gọi `verifyFinalResult`; mặc định `denyFinalResult` giữ `finalizing`. Complete còn đi qua `readCompletionFacts` và `TicketServices.applyExecutionSignal` để kiểm tra bằng chứng/merge/docs. Pause, cancel, needs input cũng dùng chuyển trạng thái nội bộ của ticket. Event chỉ chứa ID, fence, sequence hoặc tín hiệu, không có checkpoint/result/decision text.
6. `server/src/execution/commands.ts` → `readCommand`, `ackCommand`, `authorizeCommandMutation`, `authorizeCreateCommandMutation` và `server/src/execution/attempts.ts` → `readAttempt`, `authorizeAttemptMutation` kiểm tra revocation và binding revision hiện tại. Route truyền callback phân quyền vào journal để khóa scope trong cùng transaction trước khi tra idempotency cache; cùng máy đổi checkout/revision không nhận replay cũ. `ackCommand` hoàn thành lệnh không tự xác nhận tiến trình đã dừng.

## Files

| Đường dẫn từ `v2/` | Vai trò |
|---|---|
| `server/migrations/005_execution.sql` | Commands, binding revision bất biến, guard, fence, attempts, provenance đối chiếu và FK evidence |
| `server/src/execution/contracts.ts` | DTO command, attempt, checkpoint và terminal result |
| `server/src/execution/commands.ts` | Tạo, xác nhận, đọc và phân trang lệnh |
| `server/src/execution/attempts.ts` | Claim, checkpoint, reconcile, finalization và binding guard |
| `server/src/execution/reconcile.ts` | Điểm import ổn định cho gateway gọi reconcile/recheck finalization |
| `server/src/execution/routes.ts` | Route và schema kiểm tra input |
| `server/test/support/execution.ts` | Fixture máy, binding và permit cho test |
| `server/test/commands.test.ts` | Phân trang, ACK bất biến, rebind và replay scope |
| `server/test/attempts.test.ts` | Fencing, lease, stop/result và kiểm chứng cuối |

## Dữ liệu

`commands.binding_revision` là metadata server gắn khi tạo lệnh; cùng máy được gắn lại checkout khác cũng không được đọc hoặc claim lệnh cũ. `execution_guards.active_attempt_id` giữ chỗ qua trạng thái `active`, `uncertain`, `finalizing`; chỉ terminal transition đã kiểm chứng mới xóa. `attempts.process_instance_id` là ID launch bền vững của host, không phải PID hệ điều hành. `reconciliation_observations` lưu máy, launch ID, fence, thời điểm và loại quan sát. `terminal_result` và checkpoint lưu JSONB trong DB v2; event không mang nội dung này. Evidence `artifact` phải là bản ghi cùng attempt, locator NFC tương đối an toàn (không traversal/absolute/URI), SHA-256 lowercase và `verification='reported'`; nguồn khách không chứng minh file tồn tại hay byte đúng. Phase 02 chưa cung cấp chứng thực host thực tế: phase 03 nối gateway/process watcher và producer artifact, phase 08 xác minh receipt. Dispatch và final verification ở production fail closed cho đến phase 06/08; docs completion reader mặc định không xác nhận snapshot khi phase 07 chưa nối.

## Flow liên quan

`server-identity` cung cấp machine authenticator và binding. `server-tickets` cung cấp transition, dependency và deploy authorization. `server-journal` giữ idempotency/event cùng transaction. `server-platform` cấp DB và migration riêng; `server-docs-import` và phase 07 cấp snapshot reader cho completion.

## Tests

`pnpm --dir v2/server test --test-file <đường dẫn tuyệt đối>` chạy test 005 trên PostgreSQL container riêng. `commands.test.ts` kiểm tra anchor queued với microsecond, anchor completed, poll lại từ `null`, ACK result bất biến, đóng/mở pool rồi replay, binding cũ và cached reply. `attempts.test.ts` kiểm tra claim từ hai pool, gate deploy/dependency/permit, lease hết hạn, artifact sau reconcile, pause attempt mới, stop/result đồng thời, attestation sau mở lại pool, stale checkpoint, owner intent thắng passed result và event wait_owner khớp row. `execution-events.unit.test.ts` kiểm tra event whitelist. `pnpm --dir v2/server typecheck` và Biome kiểm tra kiểu/định dạng.
