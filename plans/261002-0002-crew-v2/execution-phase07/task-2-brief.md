## Task 2: Transport, cache và event resync

**Files mới:** `v2/web/src/contracts/http.ts`, `v2/web/src/contracts/tickets.ts`, `v2/web/src/contracts/docs.ts`, `v2/web/src/contracts/machines.ts`, `v2/web/src/contracts/attachments.ts`, `v2/web/src/lib/api.ts`, `v2/web/src/lib/session.ts`, `v2/web/src/lib/query-keys.ts`, `v2/web/src/lib/events.ts`, `v2/web/src/lib/pending-operation.ts`, `v2/web/test/client.test.ts`, `v2/web/test/events.test.ts`, `v2/web/src/auth/login.tsx`, `v2/web/src/auth/session-boundary.tsx`, `v2/web/test/auth-recovery.test.ts`, `v2/web/e2e/auth.spec.ts`, `v2/web/e2e/events.spec.ts`. Worker chỉ sửa các file đã liệt kê; controller tích hợp shared files. Docs canonical `docs/v2/web-data.md`.

**Interfaces mới được định nghĩa trong task:**

```ts
type PendingOperation = {
  id: string; intentId: string; ownerId: 'owner';
  method: 'POST' | 'PUT' | 'DELETE'; path: string;
  bodyJson: string; storage: 'tab' | 'memory';
  state: 'pending' | 'ambiguous' | 'suspended' | 'accepted' | 'rejected';
};
type RecoveryTombstone = {
  id: string; intentId: string; ownerId: 'owner';
  method: PendingOperation['method']; path: string; targetId: string | null;
  expectedRevision: number | null; state: 'needs_payload';
};
type SessionDto = { owner: { id: 'owner' }; csrfToken: string };
type SessionState = 'bootstrapping' | 'guest' | 'authenticated' | 'expired' | 'logging_out';
interface SessionClient {
  restore(signal?: AbortSignal): Promise<SessionDto>;
  login(password: string, signal?: AbortSignal): Promise<SessionDto>;
  logout(signal?: AbortSignal): Promise<void>;
}
type RequestOptions = { signal?: AbortSignal; operation?: PendingOperation };
interface OwnerClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  mutate<T>(operation: PendingOperation, options?: RequestOptions): Promise<T>;
  upload<T>(uploadId: string, file: File, signal: AbortSignal): Promise<T>;
}
type TicketGraph = { nodes: Ticket[]; dependencies: Dependency[]; repairLinks: RepairLink[] };
type JournalEvent = { cursor: string; type: string; projectId: string | null;
  ticketId: string | null; audienceMachineId: string | null; occurredAt: string; data: Record<string, unknown> };
function compareCursor(a: string, b: string): -1 | 0 | 1;
function invalidations(event: JournalEvent): readonly (readonly unknown[])[];
const queryKeys = {
  ticket: (id: string) => ['v2', 'ticket', id] as const,
  graph: (rootId: string) => ['v2', 'graph', rootId] as const,
  tickets: (filters: Record<string, string>) => ['v2', 'tickets', filters] as const,
  attention: (filters: Record<string, string>) => ['v2', 'attention', filters] as const,
  docsPage: (projectId: string, snapshotId: string, path: string) =>
    ['v2', 'docs', projectId, snapshotId, path] as const,
};
```

`Ticket/Dependency/RepairLink` được định nghĩa tại v2/web/src/contracts/tickets.ts, mirror exact004 cited22/31/32. Không runtime import Fastify/Buffer/database. G0 freeze exact search/provider/applied return DTO trước decoder. `JournalEvent` mirror Event ở `v2/server/src/platform/contracts.ts:13`; không bỏ occurredAt. Runtime decoder kiểm missing/wrong primitive, chỉ tolerate reviewed additive response fields.

- [ ] Write meaningful RED tests: same-origin cookie, CSRF on JSON/raw upload, no mutation before session, 503 không trả JSON, AbortError ambiguous mutation, same body/key across two retries, cursor vượt Number.MAX_SAFE_INTEGER. Ví dụ:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareCursor } from '../src/lib/events.ts';
test('cursor bigint không bị làm tròn', () => {
  assert.equal(compareCursor('9007199254740993', '9007199254740992'), 1);
});
```

- [ ] Implement OwnerClient chỉ same-origin `/v2/`; freeze bodyJson một lần mỗi PendingOperation, giữ ownerId/intentId và cùng id/body khi retry. Sửa ý định chỉ tạo operation mới sau terminal rejection hoặc confirmed acceptance của ý định cũ; ambiguous/suspended/tombstone chưa giải quyết không cấp key mới cho cùng intent. Password/token/API secret không query cache/logger/persist. Payload không secret có storage=tab, version trong sessionStorage của tab; payload secret storage=memory. Serializer từ chối operation memory, response token, secret và hash của secret.
- [ ] Session state machine: bootstrapping → GET session → authenticated hoặc guest; authenticated gặp401 → expired; expired → UI login → restore cùng owner → authenticated. Khi401, abort GET/stream, khóa writes, xóa CSRF/password/sensitive cache, chuyển operation unresolved sang suspended. GIỮ original key/body/compose IDs/revision của payload nonsecret; secret giữ nguyên payload chỉ trong memory của tab hiện tại và bị chặn gửi tới khi reauth. Không xóa pending operation vì hết phiên. Guest/expired screen không hiển thị payload khôi phục; sau login GET session xác minh đúng ownerId, đồng thời route vẫn được producer authorize trước replay, thì mở panel “Tiếp tục yêu cầu chưa xác nhận”, replay cùng key/body với CSRF mới. Không tự sửa payload hoặc đổi key; draft chỉ clear sau confirmed acceptance. Server `getSession`, `v2/server/src/auth/session.ts:95`, hết phiên trả401; `createMutator`, `v2/server/src/journal/mutation.ts:29`, scope replay là actor/route/key, không session.
- [ ] Logout chủ động là nhánh riêng: DELETE session với CSRF rồi đóng stream/abort requests, wipe CSRF/password/token/API secret/all payload và cache nhạy cảm trong memory/sessionStorage. Với unresolved intents, giữ CHỈ RecoveryTombstone: key/intentId/ownerId/method/path/target IDs/revision, không title/text/files/secret/hash/response bytes. Tab reload hoặc đóng secret form cũng chuyển memory operation unresolved thành tombstone và wipe secret. UI chặn tạo key mới cho intent đó; sau same-owner login owner phải nhập lại exact input để retry bằng key cũ, server so body hash. IDEMPOTENCY_CONFLICT giữ tombstone và báo input khác; không đổi key để thoát lỗi. Nếu không còn exact payload, hiển thị “Chưa thể xác nhận yêu cầu cũ” và giữ recovery pending, không bịa receipt lookup endpoint hoặc báo thành công từ provider status. Logout không tự clear pending receipt/tạo entity mới.
- [ ] Login/reauth UI thuộc Task2: `src/auth/login.tsx` có password input và invalid-credentials/throttle/bootstrap-unavailable states; `session-boundary.tsx` chặn protected routes, hiển thị reauth và safe return route. SessionClient.login là ngoại lệ unauthenticated POST `/v2/auth/session` `{password}` (Origin, không CSRF/Idempotency-Key/PendingOperation); restore là GET; logout là DELETE có CSRF, không journal key. Password giới hạn1–4096 và chỉ memory, xóa sau request/close/logout;429 không blind retry. Return route chỉ là path nội bộ `/crew-v2/` đã validate, không external redirect. Controller wiring login/guest/expired outlet và logout action vào shell sau S2.
- [ ] A2 real API/PG recovery chạy trên POSTproject baseline: commit rồi mất response → session hết hạn/revoke bằng fixture clock/DB test support → UI reauth same owner → replay original key/body → DB một project/receipt; controller Task1 fixture có API baseline, không chờ composer hoặcG2. A5/A3 bổ sung đúng atomic ticket/comment lost-response→expiry→reauth cases khi G2 mở; hai acceptance đó dùng session recovery đã đạt A2, không quay lại chặn A2. Negative cases expired writes blocked, logout tombstone không payload/secret, secret manual retry không persist, wrong-body same-key409 không sinh key mới. Screenshot login/expired/recovery thuộc Task2, dùng harness1; không chờ Task8.
- [ ] SSE dùng fetch streaming để gửi Last-Event-ID, parse named `event:`; không onmessage-only vì server gửi typed events. UTF8 incremental/CRLF/multiline/comments/chunk split, frame≤1MiB; malformed/overflow đóng và resync, không loop vô hạn.
- [ ] Listener bắt đầu trước initial GET; event đánh query stale. Reconnect đọc `/events?after=<applied>&limit=100` tới empty rồi stream; dedup cursor BigInt/string. Cursor persist sau invalidation enqueue; refetch failure giữ stale/retry visible. Unknown metadata event broad invalidation trong scope, không silent drop. Event không chứa comment/decision body.
- [ ] Refetch graph/list/detail/docs/model/status/attention khi reconnect/focus. Old GET bị cancel hoặc revision guard từ chối row cũ; graph dirty marker refetch whole graph. Không patch subset edges. Snapshot coherence G1, client race guard không chữa torn server transaction.
- [ ] Tests event trùng/out-of-order, auth expiry closes stream, unknown type, aborted GET cũ after newer response, invalidation đang chờ during disconnect. Run scoped unit/types/Biome; actual auth/SSE HTTP private fixture before approval, không mocked browser completion.
- [ ] Controller freeze library interfaces và docs/map/commit. Recheck lifetime: QueryClient theo app/session, operation theo tab, AbortController theo request; không thêm state vào cấu trúc server hiện hữu.

**Success:** Mỗi app/session có một stream; events không tạo mutation trùng; cursor decimal giữ chính xác; logout xóa credential/payload/cache, đóng stream; expired vẫn khôi phục exact key/body cho same owner. **Risk:** H×H stale/duplicate actions, mitigation immutable operation, session recovery/tombstone và auth/revision/race matrix; auth recovery có risk M×H, kiểm lost-reply→expiry→reauth trên real DB. **Rollback:** Revert bundle, giữ server idempotency/events; ambiguous pending ID vẫn để replay/reconcile, không xóa accepted data.

