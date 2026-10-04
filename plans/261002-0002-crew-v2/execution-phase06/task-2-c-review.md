# Review độc lập S2 / T2-C — resolver Actor persisted + `ProjectOrchestrationPort` (G1 authority, lăng kính bảo mật)

Phạm vi: `3fddbeb^ → 3fddbeb` (14 file, +1316/−111), đối chiếu memo `pm-next-slices-memo-261004.md` §A2, §A3, §A7, §S2 và ledger `progress.md` (11:05 license gộp signal; 15:00 ruling captured target / request_hash). Đọc thêm ngoài diff: `tickets/assistant-access.ts` (toàn bộ), `tickets/service.ts` (create/signal), `assistant/store.ts` (`assertCurrentTurnFence`), `assistant/inbox.ts`, `journal/mutation.ts`, `journal/events.ts`, `attachments/{routing,grants,references}.ts`, migration 009/011. Không chạy lại test.

### Spec Compliance

| Yêu cầu | Kết quả |
|---|---|
| A3.1 `admission_id` null → 503 `ASSISTANT_ADMISSION_NOT_CONFIGURED` | ✅ `authority.ts:146-147`; test port `S2 turn without admission stays 503…` |
| A3.2 session `reserved/running`, `expires_at>clock_timestamp()` sau lock, machine/process/designation revision/model selection khớp | ✅ `authority.ts:150-185` (session FOR SHARE, đo hạn sau khi khóa ở statement riêng `:165-171`). Thêm chặt: `read_session_id`, `snapshot_id = scope.input_snapshot_id`, `policy_receipt_id` khớp selection (đúng A2 input↔turn) |
| A3.3 receipt PASS, chưa revoke, chưa hết hạn, `deployment_id = assistant_config.deployment_id`, `verifier_build_sha256 =` pin inject; capability current | ✅ `authority.ts:186-193`; pin kiểm hex64 lúc assembly `:127-129`. Thêm `receipt.machine_id = designation.machine_id` |
| A3.4 mọi lệch → 403, không fallback | ✅ một nhánh `admissionDenied()` duy nhất, không có đường trả Actor khác |
| A3.5 trả `{kind:'machine', id: designation.machine_id}` | ✅ `authority.ts:195-196` (frozen) |
| A2 fence → Actor suy từ designation, caller actor phải bằng | ✅ `orchestration.ts:151-153` (so khớp chính xác) |
| A2 scope: turn, hạn, `actions ∋ action` | ✅ resolver + `orchestration.ts:154-158` |
| A2 operationId: pending, cùng turn, cùng snapshot scope, **"ghi cùng Tx, trước khi gọi port"** | ❌ một phần — pending/turn/snapshot ✅, nhưng row từ Tx trước được chấp nhận và test còn khóa hành vi đó (`assistant-orchestration-port.test.ts:354-356`). Xem I1 |
| A2 input↔turn (`read_session_id`, snapshot, admission, process) | ✅ |
| A2 new root: decision `routing` cùng Tx, body `{operationId,scopeId,ticketSha256}` = targetSha256, snapshot, input revision hiện hành | ✅ `orchestration.ts:54-92` (xmin = `pg_current_xact_id()`, kiểm actor A và `sha256` theo `digest`) |
| A2 child: membership `scope.root_ticket_id` | ✅ `orchestration.ts:96-128` |
| A2 ⚠️ dependency provenance = tool operation + journal actor A | ✅ có test journal actor A cho cả 4 action |
| A7 positive Actor qua A3; `command` gộp T4 | ✅ `command` → 503 `ORCHESTRATION_COMMAND_NOT_RELEASED` (`orchestration.ts:272-274`) |
| S2 RED (1)–(9) | ✅ đủ map; (3) thiếu nhánh capability hết hạn, session sai máy, sai snapshot, receipt sai máy (M1) |
| Production không inject port (app 503) | ✅ chỉ test gọi `createProjectOrchestrationPort` / `createPersistedAssistantActorResolver` / `createPersistedOrchestrationAuthority`; `createTicketServices(...)` trong `routes.ts:177`, `attachments/routing.ts:86`, `execution/attempts.ts:204,530` không có `assistant` |
| Deny production đến từ thiếu receipt PASS, không từ stub | ✅ không còn `throw` cố định; nhánh deny là dữ liệu |
| Không test-trust port trong test S2 | ✅ port test dùng resolver + port thật trên PG |
| Snapshot trước await | ✅ port `immutableSnapshot` đồng bộ, entry scoped chụp lại; test `S2 port snapshots caller arguments…` |
| Lock order root → sorted tickets → project trước verify | ✅ (xem Security trace) |
| Generic ACL không nới | ✅ `prepareSignal` generic giờ bắt buộc `actor` (bỏ nhánh `null`), test generic 404 qua Fastify |
| Migration đóng băng | ✅ không có SQL/migration mới |
| Unification signal (license 11:05): `access.prepare/authorize` + `consumeAssistantScope`, `invalidScope` dùng chung, `uuid` export | ✅ `service.ts:514-556`, `decisions.ts`, `dependencies.ts`; bỏ WeakMap `verifiedSignals` |

⚠️ W1 — Test "receipt from another deployment" dùng `session_replication_role=replica` để đặt deployment lạ: chấp nhận được. FK 011:44 (`deployment_id references assistant_config(deployment_id)`) khiến row này chỉ có thể xuất hiện qua import/restore bỏ ràng buộc, đúng mối đe dọa mà kiểm tra deployment nhắm tới; test chỉ dùng bypass trong Tx tamper riêng, không chạm Tx dưới test.

⚠️ W2 — Manifest: `flows.yaml` +2 dòng (source/test trong flow `server-assistant`, không chạm mục `source/shared/unassigned` bị R6 khóa), `files.md` +2 dòng sinh lại. Đúng R2/R3, không vượt quyền.

⚠️ W3 — Sửa sau RED chỉ ở test (đổi tên `a/b` đè ticket fixture; bọc response `{value}`). Đã kiểm diff: không có thay đổi source sau RED liên quan tới hai lỗi này; RED vẫn semantic (503 thay vì mã kỳ vọng).

### Security trace

**Caller.** `createPersistedAssistantActorResolver`: chỉ `test/assistant-authority.test.ts`, `test/assistant-orchestration-port.test.ts`. `createProjectOrchestrationPort`, `createPersistedOrchestrationAuthority`: chỉ port test. Không có `src/` nào inject `assistant` vào `createTicketServices`. Bề mặt hiện tại trong production = 0.

**Captured target (claim 1).** `persistedAuthority()` tạo một `bindings: WeakMap<Tx,Binding>` riêng cho mỗi instance. `createPersistedOrchestrationAuthority` trả authority của một instance mà `withTarget` bị bỏ đi, nên map luôn rỗng và mọi `verify` → 403 (`orchestration.ts:141-149`; có test). Trong port, `authority` chỉ được đưa vào `services` nội bộ (không export). `withTarget` từ chối Tx đã có binding (`:188`), nên hai lời gọi song song trên cùng Tx không thể dùng target của nhau. Binding bị xóa ở `finally` (`:198-200`), dùng một lần (`used`), và phải khớp `action`, `targetSha256` (do port tự tính từ payload đã snapshot), `canonicalJson(actor)` và `canonicalJson(proof)` với operation mà entry scoped tự capture. Membership kiểm trên `binding.target`, mà payload này buộc vào cùng hash với operation đang verify. Kết luận: target của lời gọi/Tx này không thể authorize lời gọi/Tx khác. Bản thân record không cấp quyền: quyền vẫn cần resolver PASS, actor = designation, scope action, operation row, membership/routing decision. Claim 1 đúng.

**Lock order thực tế (decision/dependency/signal).** `mutate()` (journal): advisory → `event_cursor` FOR UPDATE (`journal/mutation.ts:31-32`) → `access.prepare`: root FOR UPDATE → tickets sắp xếp FOR UPDATE → project FOR UPDATE → CAS/prepare → `authorize` → `verify` → resolver: calibration guard → machine → config → designation → turn → monitor (`store.ts:49-61`) → session/selection/receipt/capability FOR SHARE → đo `clock_timestamp()` → `assistant_tool_operations` FOR UPDATE → đọc membership/decision → persist → `appendEvent` (`update event_cursor`, đã giữ). Create: root → parent → project (B1) rồi cùng chuỗi. Khớp plan `phase-06:144` (event_cursor → root → tickets → project → machine/config/designation/turn → grant/session → task rows) và `claimWork` (event_cursor → root → fence). Xem W4.

**Mọi đường deny trong một lời gọi port**
1. Snapshot lỗi → 400 `VALIDATION`; actor không phải machine → 403 `ORCHESTRATION_MACHINE_REQUIRED`; Tx đã có binding → 403 `ORCHESTRATION_SCOPE_INVALID`.
2. Entry scoped: thiếu authority → 503; ID không hợp lệ → 400; ticket không có → 404; drift root/project dưới khóa → 403 `ORCHESTRATION_SCOPE_INVALID`; CAS/predecessor/transition → 409 (trước verify, đã có ruling chống dò ở transport B3); `wait_owner` running → 409 `EXECUTION_PROOF_REQUIRED`.
3. `verify`: binding thiếu/đã dùng/lệch action/hash/actor/proof → 403 `ORCHESTRATION_SCOPE_INVALID`.
4. Resolver: fence/scope ID sai → 400/409; scope thiếu hoặc khác turn → 404; fence không hiện hành (guard, machine revoked, config, designation, turn state, monitor) → 409 `ASSISTANT_TURN_STALE`; scope hết hạn → 409; turn không có admission → 503; mọi lệch session/selection/receipt/capability/deployment/verifier/machine → 403 `ASSISTANT_ADMISSION_DENIED`.
5. Actor ≠ máy designation → 403 `ORCHESTRATION_ACTOR_MISMATCH`.
6. Action ∉ `scope.actions` → 403 `ORCHESTRATION_ACTION_NOT_IN_SCOPE`.
7. Operation thiếu/khác turn/không pending → 404; lệch snapshot → 409.
8. Membership: scope message dùng cho ticket đã tồn tại, ticket ngoài root/project → 404; root mới không có scope message, project lệch, thiếu decision cùng Tx/hash/snapshot/revision/actor/sha256 → 403 `ORCHESTRATION_ROUTING_DECISION_REQUIRED`.
9. Persist: `consumeAssistantScope` (Tx, prepared, operation, hash, root/project) → 403 nếu lệch; `persistSignal` kiểm thêm ticket/signal/continuation.
10. `command` → 503 `ORCHESTRATION_COMMAND_NOT_RELEASED`, không ghi gì.

Không thấy nhánh nào trả Actor hoặc persist khi bất kỳ bước trên lỗi. Exception từ mọi bước đều propagate và rollback Tx của `mutate`.

**Claim 3 (scope message chỉ tạo request mới).** Đúng: `verifyMembership` ném 404 khi `rootTicketId` null (`:97`), và root scope tạo root → `routingRequired` (`:61`). Đây là cách hiểu fail-closed hợp lý của `phase-06:283`.

⚠️ W4 — Lock order chỉ an toàn khi caller của port đã giữ `event_cursor` trước root, như `mutate()` hiện làm. Nếu port bị gọi trong Tx trần, resolver khóa `assistant_monitor` rồi `appendEvent` mới cập nhật `event_cursor`. Trong khi đó `ingestEvents` khóa `event_cursor → monitor` (`inbox.ts:101-104`), nên hai Tx có thể deadlock (40P01, chỉ mất tính sẵn sàng, không mất an toàn). Brief B3 phải ghi: transport gọi port bên trong `mutate()` hoặc khóa `event_cursor` đầu tiên.

⚠️ W5 — `verifyNewRoot` dùng `xmin = pg_current_xact_id()::xid`. Nếu router B4 ghi decision trong savepoint (`tx.savepoint`), xmin là subxid nên bị từ chối (fail closed). Router B4 cũng phải ghi decision **trước** khi tăng `input_revision` của message (`routing.ts:162-163` tăng sau khi tạo ticket); nếu đảo thứ tự thì decision lệch revision và bị 403. Brief B4 phải ghi hai ràng buộc thứ tự này.

### Strengths

- Resolver chỉ dựa trên hàng persisted, không có callback hay cờ boolean, và đo hạn ở statement riêng sau khi khóa FOR SHARE. Pin verifier được kiểm lúc assembly.
- Captured target nằm trong closure riêng của port, nên authority dùng trần luôn 403 (có test). Cách này đóng được chỗ thiếu ticket ID trong chữ ký `verify` đã freeze mà không nới hợp đồng.
- Signal đi về đúng prefix B2a (recheck root/project dưới khóa, token một lần). Bỏ được WeakMap riêng và nhánh `actor: null` trong lõi generic, nên bề mặt nhỏ hơn.

### Issues

#### Critical

Không có.

#### Important

**I1 — Operation row không bắt buộc ghi trong cùng Tx và không bị tiêu sau khi dùng** (`v2/server/src/assistant/orchestration.ts:159-164`; test khóa hành vi sai tại `v2/server/test/assistant-orchestration-port.test.ts:354-356`).
- *Vấn đề.* Memo A2 yêu cầu row `assistant_tool_operations` "ghi **cùng Tx, trước khi gọi port**"; `phase-06:224` cũng yêu cầu "operation + service mutation + event + result in one Tx". `verify` hiện chấp nhận mọi row `pending` cùng turn/snapshot, kể cả row đã commit từ Tx trước. Row cũng không bị chuyển state hay đánh dấu đã dùng, nên một `operationId` pending (ví dụ do lời gọi tool trước crash để lại) có thể authorize nhiều mutation khác nhau, cả trong nhiều Tx lẫn nhiều lần trong một Tx. Ruling 15:00 chỉ hoãn việc ràng `request_hash` ↔ `targetSha256` sang B3, không hoãn điều kiện cùng Tx. Test `pending committed earlier still authorizes` biến lệch spec thành hợp đồng mà B3/T3/T4 sẽ dựa vào.
- *Khả năng khai thác.* Hôm nay bằng 0, vì port chưa được inject và chưa có transport. Sau B3, nếu transport chỉ kiểm idempotency theo `(turn, client_sequence)` mà không hoàn tất row trong cùng Tx, model có thể dùng lại một operationId pending với payload khác trong cùng scope.
- *Cách sửa.* Thêm `and xmin=pg_current_xact_id()::xid` vào truy vấn operation (cùng cơ chế với `verifyNewRoot`), sai thì 404 `ASSISTANT_OPERATION_NOT_FOUND`. Thêm tập `operationId` đã dùng theo Tx (WeakMap<Tx,Set>) trong `persistedAuthority` để mỗi operation chỉ authorize một mutation. Đổi test `:354-356` thành assert 404 cho row đã commit trước. Việc ràng `request_hash` để B3 làm theo ruling. Nếu PM muốn giữ semantics cross-Tx cho pending external effect, cần ruling rõ ràng và giới hạn cho các action không phải ticket mutation.

**I2 — Resolver không kiểm grant của session còn hiệu lực** (`v2/server/src/assistant/authority.ts:149-151, 172-193`).
- *Vấn đề.* Session hợp lệ chỉ được xét theo `state`. `revokeAssistantGrant` (`attachments/grants.ts:363-365`) và `references.ts:178-181` đều chuyển session sang `unknown` khi thu hồi grant. Nhưng đường re-route `attachments/routing.ts:141-152` thu hồi grant mà chỉ chặn session `running/unknown`: session `reserved` không bị chặn và cũng không bị đổi state. Vì resolver chấp nhận `reserved`, một turn đã admit nhưng session vẫn `reserved` tiếp tục nhận Actor dương sau khi grant đã bị thu hồi hoặc hết hạn (`attachment_assistant_grants.revoked_at/expires_at`). Theo `phase-06:217`, route mutation phải thu hồi read session cũ. Memo A3 không liệt kê grant, nhưng resolver là authority dương duy nhất, nên không được tin vào việc mọi writer khác đều đồng bộ state.
- *Cách sửa.* Join `attachment_assistant_grants g on g.id=session.grant_id` (FOR SHARE, theo thứ tự plan grant → session hoặc cùng bước), thêm `g.revoked_at is null`, `g.machine_id = turn.machine_id`, `g.snapshot_id = session.snapshot_id` và `g.expires_at > clock_timestamp()` vào statement đo hạn. Thêm test deny cho grant revoked (session vẫn `reserved`) và grant expired. Riêng lỗ hổng session `reserved` ở `routing.ts` thì báo owner T5/phase05.

#### Minor

**M1 — Thiếu test cho một số nhánh deny của resolver** (`v2/server/test/support/assistant.ts:549`, chưa có tham số cho capability). Các nhánh capability hết hạn, `session.machine_id ≠ designation`, `session.snapshot_id ≠ scope`, `read_session_id ≠ session`, `receipt.machine_id ≠ designation` có trong code nhưng chưa có test. Thêm các biến thể này vào `admissionDenials`. Đây là các điều kiện A3/A2 đã nêu ("routing capability receipts current"), nên nếu một refactor sau làm mất chúng thì không test nào phát hiện.

**M2 — `verifyNewRoot` đọc `attachment_messages.input_revision` không khóa** (`orchestration.ts:62-65`). An toàn hôm nay chỉ vì decision phải được ghi cùng Tx và router đã khóa message trong Tx đó. Nên thêm comment nêu điều kiện này, hoặc `for share of m`, để B4 không vô tình làm hỏng nó.

**M3 — Đọc `session` theo `admission_id` rồi mới so `id = turn.read_session_id`** (`authority.ts:149-151`). Đúng nhờ `admission_id` unique (009:179), nhưng truy vấn thẳng `where id=${turn.read_session_id} and admission_id=${turn.admission_id}` rõ ý định hơn. Không phải lỗi.

### Assessment

**Task quality:** Needs fixes

Spec A3, A7, S2 RED, các ràng buộc global và unification signal đều đạt. Captured target không cấp quyền và không rò sang lời gọi hoặc Tx khác (claim 1 đúng), production vẫn 503. Hai lỗi Important đều nằm ở đường authority dương. I1 lệch A2 ("ghi cùng Tx") và test hiện còn khóa hành vi lệch đó. I2 bỏ qua việc grant bị thu hồi khi session còn `reserved`. Cả hai sửa rẻ, cục bộ trong `orchestration.ts`/`authority.ts` và test, không cần SQL mới. Sau đó chỉ cần scoped re-review.
