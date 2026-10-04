# Review Task 2 Slice B2b-i — scoped signal (`dependencies_ready`, `wait_owner` chưa chạy)

Phạm vi: commit `e9cdd37` (base `e9cdd37^`), gói diff `task-2-slice-b2b-i-review-package.diff`. Đối chiếu memo `pm-next-slices-memo-261004.md` §A1 và §S1 (binding), pattern B2a (`213cc5d`, `task-2-slice-b2a-review.md`). Không chạy lại test; đọc source tại `e9cdd37` cho các rủi ro được nêu tên (B2a `access.prepare`, call site generic signal, `ProjectOrchestrationPort.signal`, migration 005, bảng `transition`).

### Spec Compliance

| Yêu cầu | Kết quả | Bằng chứng |
|---|---|---|
| Interface `assistantSignalTicket(tx, actor, proof, ticketId, signal, expectedRevision): Promise<Ticket>` | ✅ | `service.ts:509–550`; khớp `ProjectOrchestrationPort.signal` (`assistant/contracts.ts:112–119`) |
| Hash payload `{ticketId, signal, expectedRevision}` theo tuple `['crew-v2:orchestration-target:1','signal',payload]`, đúng spelling gửi lên | ✅ | `captureAssistantOperation(..., 'signal', {...})` (`service.ts:520–524`); test (4) so `targetHash('signal', original)` (`assistant-mutations.test.ts:812`) |
| Actor/proof/payload snapshot trước await | ✅ | capture là lệnh đầu tiên, đồng bộ; test (4) mutate actor/proof/payload trong `afterStart` và hash/journal vẫn khớp bản gốc |
| Lock root → ticket → project trước verify | ✅ | `prepareSignal` khóa root (`:368`), ticket (`:372`), entry khóa project (`:541`), verify ở `:546`; test (10) xác nhận 55P03 cho cả ba trong hook verify |
| Token private, cùng Tx, một lần | ✅ (xem M1, M2) | `verifiedSignals` WeakMap module-private (`:348`), `delete` trước khi kiểm (`:426–427`), kiểm Tx/operation/hash/ticket/signal |
| Core persistence dùng chung generic + scoped | ✅ | `prepareSignal`/`signalTransition`/`persistSignal` dùng cho cả `signalTicketWithDependencies` và entry scoped |
| Generic ACL không nới (A không dùng route generic trên project bind B) | ✅ | routes.ts không đổi; `prepareSignal` với actor ≠ null vẫn qua `requireTicket`; test (1) HTTP thật trả 404 cho cả hai signal (`:729`) |
| Thiếu authority → 503 | ✅ | `:533`, trước mọi đọc DB; test (2) (`:774`) |
| Production resolver default-deny | ✅ | không đổi resolver; chỉ test-trust allowlist |
| Không owner tổng hợp | ✅ | entry không truyền actor owner, không gọi `deps.execution`; test (6) dùng spy execution thật và khẳng định `calls=[]` |
| Running `wait_owner` → 409 `EXECUTION_PROOF_REQUIRED`, không command row, không đổi terminal intent, không event | ✅ (⚠️ W1) | `:543–544`, trước `signalTransition` và verify; test (6) (`:879`) so toàn bộ `state()` gồm `commands`, `attempts`, `events`, revision |
| `resume`/`start`/`passed` 400 | ✅ | `assistantSignals` (`:345`, `:529`); test (8) (`:931`) |
| Repair-limit: scoped không tiêu continuation | ✅ | continuation chỉ tra cho `resume` (bị loại từ runtime); `persistSignal` còn chặn `continuationDecisionId !== null` (`:434`); test (9) (`:946`) giữ `repair_limit_cycle_id`, `consumed_decision_id=null`, `wait_reason='repair_limit'` |
| Không chạm `execution/attempts.ts`, `execution/commands.ts`, migrations | ✅ | `git show --stat e9cdd37` không có các file này |
| Refactor generic giữ hành vi | ✅ | Execution-signal check chuyển ra sau CAS/predecessor/continuation; hai nhánh mới đứng trước chỉ chạy cho `dependencies_ready`/`resume`, rời với `executionSignals`, nên không signal nào đổi thứ tự lỗi. Revision check vẫn đứng trước cả hai như cũ. Hồi quy 102/102 theo báo cáo |
| 10 case RED | ✅ | Map đủ 10 case → 20 test (`:729–1040`) |
| Flow `server-tickets.md` chỉ mô tả hành vi (M5) | ✅ (xem M3) | Đã bỏ "GREEN118/review chờ"; bước 4 và 10 mô tả hành vi |
| M2 (DRY `invalidScope`/`uuid`) | ⚠️ W3 | Làm phần service.ts/assistant-access.ts; `dependencies.ts:88` và `decisions.ts` vẫn inline |

### Strengths

- Nhánh running `wait_owner` fail-closed được đặt **trước** `signalTransition` và verify, độc lập với `deps.execution`. Test (6) dựng execution authority thật dạng spy, nên chứng minh được "không phụ thuộc việc thiếu callback". Đây đúng là điểm memo coi là chốt.
- Lệch so với memo ở case (6) (`terminal_intent` là `'complete'`, không phải `null`) là đúng: migration `005_execution.sql:37` khai báo `not null default 'complete'`. Test khẳng định "không đổi" so với snapshot trước, đúng tinh thần ruling.
- Test (10) chứng minh lock prefix bằng `for update nowait` từ connection khác ngay trong verify. Cách này mạnh hơn chỉ quan sát thứ tự.
- Mọi test fail-invariant đều khẳng định `trust.observed.length === 0` và `state()` không đổi, nên rollback thật được kiểm trên DB thật.

### Issues

#### Critical

Không có.

#### Important

Không có. Đã đánh giá xem việc dựng token và lock song song có phải "duplication security-critical verbatim" hay không: không phải verbatim. Nó là một biến thể hẹp hơn, không tạo đường khai thác được (xem M1).

#### Minor

**M1 — `service.ts:359–376, 509–550`: scoped signal dựng lại cơ chế prepare → verify → consume riêng, không dùng `createAssistantAccess` của B2a. Điều này tạo rủi ro drift.**
- *Cái gì:* B2a `access.prepare` (`assistant-access.ts`) đọc lại row dưới lock và kiểm `root.project_id === projectId && root.root_id === rootId`, `row.root_id === rootId` cho từng ticket, `captures.has(operation)`, cờ `authorized` chống verify lặp, rồi `consumeAssistantScope` kiểm lại tính nhất quán root/project. Signal chỉ khóa `select id ... for update` trên root, không re-check root_id/project_id dưới lock, và dùng `verifiedSignals` riêng.
- *Vì sao chưa phải Important:* `root_id` thực tế bất biến (CHECK ở `004_tickets.sql:32`, không có writer nào UPDATE `root_id`). `operation` và `prepared` không thoát khỏi closure, nên các kiểm bị thiếu không thể bị vượt qua lúc này. Lý do của implementer cũng đúng: `prepare` chỉ nhận `decision`/`dependency`, và license chỉ cho export trong `assistant-access.ts`.
- *Rủi ro:* sau này khi siết `access.prepare` (ví dụ T4 thêm lock union command/attempt, hoặc kiểm project archived), thay đổi đó sẽ không tự áp cho signal.
- *Fix (follow-up cần license sửa `assistant-access.ts`):* thêm `operation.action === 'signal' ? [payload.ticketId]` vào `submitted` trong `prepare`. Entry signal khi đó gọi `access.prepare` → `prepareSignal` nhận ticket đã khóa → `access.authorize` → `consumeAssistantScope` trong `persistSignal`, rồi xóa `verifiedSignals`.

**M2 — `service.ts:423–435` và `assistant-mutations.test.ts`: các guard của token `verifiedSignals` và `continuationDecisionId !== null` không reachable và không có test chạm trực tiếp.** Đây là carry-over của B2a M3. Các guard là fail-closed đúng, nhưng chỉ được chứng minh bằng đọc code. Fix: chấp nhận như B2a, hoặc giải quyết cùng M1 (khi đó token B2a đã có test riêng).

**M3 — `v2/docs/flows/server-tickets.md:22,24,28,30`: flow có hai bước số "8.", một đoạn không đánh số ("Factory còn có…") kẹp giữa bước 9 và 10, và chữ dính "trả503".** Phần lớn có từ trước, nhưng lát này sửa đúng vùng đó. Fix: đánh số lại 8–11, gộp đoạn B2a thành một bước, thêm khoảng trắng.

**M4 — `assistant-mutations.test.ts:991–1040`: test (10) chỉ phủ chiều signal giữ root trước, và dùng `setTimeout(200)` để khẳng định dependency "chưa tới verify".** Chiều ngược (dependency giữ root, signal phải chờ) chưa được kiểm. Khẳng định phủ định theo thời gian có thể pass nhầm trên máy chậm. Hiện chấp nhận được vì `observed.length===1` cộng `REVISION_CONFLICT` cuối cùng đã chứng minh serialize. Fix tùy chọn: thêm chiều ngược bằng hook dependency, kiểm `pg_locks`/`pg_stat_activity.wait_event_type='Lock'` thay cho sleep.

### Assessment

**Task quality:** Approved

Lát này đúng và đủ phạm vi S1: signature và hash khớp port, snapshot chạy trước await, lock prefix chạy trước verify, có 503, generic ACL giữ nguyên, nhánh running `wait_owner` fail-closed mà không có owner tổng hợp, không chạm `attempts.ts`/`commands.ts`/migration. Refactor generic đã được kiểm bằng lập luận: tập signal rời nhau, nên đổi thứ tự không đổi hành vi. Test matrix chạy trên DB thật và kiểm cả rollback lẫn việc verify không bị gọi. Các finding đều Minor. M1 là nợ kiến trúc nên xử lý trong lát có license sửa `assistant-access.ts` (hợp lý nhất là S2 hoặc lát T4 chạm lock union), trước merge-review của cả nhánh.

### Ghi chú cho PM (⚠️)

- **W1:** `wait_owner` trên ticket `ready` có thể đã có command `start` chưa claim (khi T4 dispatch tồn tại). Scoped path chuyển `ready → needs_input` mà không retire command đó, giống hệt đường owner generic hiện nay. Đây là phạm vi retirement helper của T4 (`phase-06:258`), cần ghi vào checklist T4.
- **W2:** Các lỗi `NOT_FOUND`/`REVISION_CONFLICT`/`DEPENDENCIES_NOT_READY`/`EXECUTION_PROOF_REQUIRED`/`INVALID_TICKET_TRANSITION` trả về trước verify. Vì vậy một máy đã xác thực nhưng không có authority trên project có thể dò trạng thái/revision của ticket nếu biết UUID. Điều này nhất quán với B2a đã nghiệm thu (`validateDependency` trước `authorize`) và với yêu cầu "lock trước verify". Ghi nhận như quyết định thiết kế, không phải lỗi của lát này.
- **W3:** M2 của B2a chỉ được sửa một phần: `dependencies.ts:88`, `decisions.ts` vẫn inline `ApiError('ORCHESTRATION_SCOPE_INVALID')`, vì ngoài ownership của lát.
