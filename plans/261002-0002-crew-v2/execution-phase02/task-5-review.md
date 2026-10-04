# Task 5 — review độc lập

**Ready: no.** Review phạm vi `163c37c..7a246cb` (21 files), theo `task-5-brief.md` và addendum PM về artifact/reconnect. Có 4 lỗi được tái hiện bằng fixture PostgreSQL riêng, migration prefix 5. Không sửa source, stage, commit, chạy dịch vụ chung hay gọi model trả phí.

## Findings

### R1 — P1: Page anchor mất độ chính xác timestamp và lặp trang

- Vị trí: `v2/server/src/execution/commands.ts:197–205`, trọng tâm dòng 205.
- `created_at` PostgreSQL có microsecond nhưng anchor được đọc thành JavaScript `Date` rồi gửi lại, mất phần nhỏ hơn millisecond. Với command còn outstanding có timestamp `2026-10-02T00:00:00.123456Z`, điều kiện `(created_at,id) > (.123000Z, anchorId)` vẫn chọn chính anchor.
- Probe: tạo 2 command outstanding, `limit=1`, đọc tiếp bằng `nextCursor`. Trang hai trả lại ID trang một và chính cursor cũ, thay vì command thứ hai. Host có thể lặp vô hạn, command phía sau không được xử lý. Test hiện hữu hoàn thành anchor trước khi đọc tiếp nên che mất lỗi này.
- Sửa hẹp: giữ so sánh anchor hoàn toàn trong SQL (subquery/CTE lấy `(created_at,id)` của anchor đã kiểm quyền), hoặc truyền timestamp dạng text giữ đầy đủ microsecond. Giữ hành vi completed anchor, scope 404 và poll lại từ null.
- Regression: ít nhất 2 outstanding command, anchor còn queued/received, timestamp microsecond cố định, `limit=1`; duyệt hết trang và khẳng định không lặp ID/cursor.

### R2 — P1: Lệnh pause mới có thể nhắm attempt cũ

- Vị trí: `v2/server/src/execution/attempts.ts:565–569`.
- `setTerminalIntent` tái dùng command chỉ theo ticket/type/state, không theo `payload.attemptId` hay binding revision. Nếu attempt A đã được pause và reconcile stopped nhưng ACK completed của command pause chưa đến, ticket có thể resume và claim attempt B. Owner pause B nhận lại command của A, payload vẫn chứa attempt A. Ý định trên B đã đổi nhưng host không nhận command đúng tiến trình để dừng B.
- Probe đi qua API service thật cho pause → stop → resume → dependencies_ready → claim B → pause B. Kết quả `firstPause.id === secondPause.id`, `secondPause.payload.attemptId === A.id`, khác B.id. Không cần sửa DB status để tạo race này.
- Sửa hẹp: chỉ tái dùng command thuộc đúng active attempt, machine và binding revision hiện hành; nếu không có, tạo command mới. Không đổi payload bất biến của command cũ và không lấy ACK làm stop proof.
- Regression: stop proof tới trước/mất ACK của pause A; resume/claim B rồi pause B phải tạo command nhắm B. Kiểm tra lặp pause trên cùng B vẫn không tạo thêm command không cần thiết.

### R3 — P2: Artifact ghi mới được chấp nhận sau khi lease đã hết

- Vị trí: `v2/server/src/execution/attempts.ts:297–301`.
- Artifact writer từ chối `state='uncertain'` nhưng không kiểm tra `lease_expires_at`. Trạng thái chỉ được chuyển uncertain khi gọi checkpoint; host mất heartbeat có thể gọi thẳng artifact route lúc attempt vẫn ghi `active` dù lease đã hết, và vẫn chèn evidence mới. Điều này không khớp hợp đồng lease hết hạn chặn tiến độ mới trước reconcile; ngoại lệ đã duyệt là artifact trễ khi `finalizing` còn giữ guard.
- Probe: claim, làm lease hết hạn trong fixture, gọi `registerArtifactEvidence` với fence/process hợp lệ. Bản ghi được tạo thành công (`EXPIRED_ARTIFACT_ACCEPTED true`).
- Sửa hẹp: kiểm tra thời hạn cho active attempt, giữ guard và chặn ghi artifact mới tới khi reconcile; nếu ghi uncertain cùng lỗi HTTP, bảo đảm state không bị rollback như bài học checkpoint. Giữ đăng ký trễ ở finalizing và exact durable replay đã được cấp quyền lại.
- Regression: active hết lease → không tăng số evidence; reconcile running → ghi được; finalizing với lease hết hạn → vẫn ghi được theo addendum.

### R4 — P2: Callback finalize đồng bộ làm event mới nhất sai trạng thái

- Vị trí thay đổi kích hoạt: `v2/server/src/execution/attempts.ts:387–391`; consumer cần sửa hẹp: `v2/server/src/tickets/service.ts:262–270`.
- Khi host đã báo stopped và attempt đang finalizing, `signalTicket(wait_owner)` gọi authority Task 5 và ticket chuyển ngay sang needs_input. Consumer tiếp tục tăng revision rồi phát `ticket.changed` với hằng `status:'running'`. Event có revision mới nhất vì vậy mâu thuẫn với DB/response `needs_input`; client replay SSE có thể quay về running dù guard đã giải phóng.
- Probe: claim → reconcile stopped → services.signalTicket(wait_owner). Response status `needs_input`; event cuối `{"status":"running","revision":4}`. Đây là lỗi tích hợp callback mới, không phải phàn nàn về việc Task 7 chưa lắp route.
- Sửa hẹp: event của outer mutation dùng status từ row sau callback, hoặc tránh phát event thừa theo snapshot cũ. Cập nhật `server-tickets.md` bước 4: wait_owner có thể finalize ngay nếu stop proof đã có; chỉ giữ running khi process chưa được xác nhận dừng.
- Regression: wait_owner trước stop và sau stop; event revision cuối phải có status giống row/response, guard và trạng thái attempt phải khớp.

## Bằng chứng kiểm thử và giới hạn

- Chấp nhận bằng chứng worker/controller: server 117/117, unit 26/26, typecheck, Biome 13 files, docs nested `--all`/`--staged` và root staged sạch. Không chạy lại suite rộng.
- Probe review: `/tmp/crew-task5-review-probe.test.ts`; lệnh `pnpm --dir v2/server test --test-file /tmp/crew-task5-review-probe.test.ts`. Kết quả 4 tests / 4 failures, từng assertion trên tái hiện đúng hành vi sai. Fixture sử dụng `databaseFixture(5)`, logical DB tạm trong Docker riêng; runner cleanup riêng. Probe nằm ngoài source/test của repo.
- Source review xác nhận một guard và partial unique index giữ chỗ active/uncertain/finalizing; fence bigint có chặn tràn; ACK không là stop proof; stop và result lưu độc lập; complete/retry dùng callback fail closed; finalization gọi TicketServices và completion facts trước giải phóng guard.
- ACL route execution chạy trong journal transaction trước cache/work, giữ root/ticket/project; commands/attempts đối chiếu binding revision kể cả cùng machine; GET hiện trạng không tạo permit. Callback journal bất biến theo request, không phải quyền do client gửi. Claim recheck predecessor và exact deploy authorization trước cấp attempt. Migration mới chỉ 005, không thay applied migration 001–004.
- Artifact route dùng idempotency/current guard/fence/process, locator tương đối và reported evidence, không nâng hash do máy báo thành verified; references checkpoint/result phải cùng attempt. Quy tắc terminal cancel/needs_input/pause có thứ tự ưu tiên trong source. Sửa stale status ở repair giữ được needs_input sau lần lỗi thứ năm.
- Bộ test Task 5 hiện chưa chứng minh đầy đủ các acceptance ghi trong brief: đóng/mở lại pool để replay, hai pool độc lập claim, stale checkpoint sau replacement, đồng thời stop/result đúng một finalize, owner cancel/pause thắng passed result, append-only attestation sau restart rồi recheck, và negative claim cho deploy/predecessor/permit. Không suy ra các case này đã pass từ tổng 117 tests. Bổ sung những case đã cam kết khi sửa, tập trung regression trên trước.

## Handoff bắt buộc cho Task 7 và các phase sau

1. Lắp `assertNoActiveProjectExecution` vào binding guard; lắp `createExecutionAuthority()` vào ticket service và route; giữ default `denyDispatch`/`denyFinalResult` cho tới authority thật Phase 06/08.
2. Các machine mutation khác ngoài execution phải có transactional ACL trước cached replay; SSE phải xác thực lại revocation/binding khi stream đang mở. Đây là assembly được PM xác định trước, không tính thành regression Task 5 trong findings.
3. Nối docs completion/source reader thật; Phase 03 phải đối chiếu tiến trình thật và materialize artifact; Phase 08 xác minh receipt/evidence thực tế. Không coi authenticated machine attestation hay reported checksum là bằng chứng byte/process độc lập.
4. Gateway reset `after:null` mỗi poll pass, dedupe qua durable journal, dùng GET command/attempt để lấy hiện trạng và replay đúng key/body khi reply mơ hồ. Command page anchor khác cursor journal Phase 03.

Chỉ review lại phần sửa R1–R4 và test liên quan sau khi worker xử lý; không cần lặp toàn bộ review scoped diff nếu không có thay đổi ngoài phạm vi đó.
