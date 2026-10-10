# DBG-P1 — `INVOCATION_SCOPE_DENIED` của `crew.core` sau agent run

Ngày 10/10/2026, giờ Asia/Ho_Chi_Minh. Worktree chỉ đọc `.worktrees/paperclip-r3-dbg` (crew/r3 `623616b25`, detach).
Không commit code, không đụng prod.

## Kết luận ngắn

- **Nguyên nhân gốc nằm ở host plugin của lõi Paperclip (upstream), không phải ở code handler của plugin.** Mỗi sự
  kiện có `companyId` được host gửi cho worker dưới dạng *notification* `onEvent` và host đăng ký cho nó một
  "invocation" sống **15 phút** (không có phản hồi để xóa sớm). Trong lúc còn bất kỳ invocation nào đang sống, host
  coi mọi lời gọi worker→host **không kèm invocation id** là "missing, expired, or unknown invocation scope" và từ
  chối nếu lời gọi đó đụng tới company. `ctx.companies.list()` gọi từ `getData` không có company hoặc từ job (không có
  invocation) rơi đúng vào trường hợp này.
- **"Cho tới khi restart" thực ra là cửa sổ 15 phút, được gia hạn mỗi khi có sự kiện mới.** Trên T1, sau một lần hủy run lúc 05:59:52, lỗi kéo dài
  tới 06:13:53 và tự hết lúc 06:14:53, không cần restart.
- **Có trên prod hiện tại (`v3-eef987b01`), nhưng hẹp hơn.** Prod đã đăng ký `agent.run.cancelled` (`run-cancelled.ts`
  có từ trước R3) và job `attachments-audit` gọi `ctx.companies.list()` → job hỏng 15 phút sau mỗi lần hủy run trên
  prod. Prod chưa có data `crew.companies`, nên UI prod không vỡ.
- **R3 làm lỗi thành chặn deploy:** (a) SEC-2 đăng ký thêm `agent.run.started` (MỌI run), `agent.created`,
  `project.*`, `goal.*` → trên prod có agent chạy liên tục thì cửa sổ gần như không bao giờ đóng; (b) R3 thêm data
  `crew.companies`, mà crew-web gọi **không có `companyId`** để dựng shell → shell UI vỡ. **Chặn DP-1 cho tới khi sửa.**
- Ngoài cửa sổ 15 phút, cùng cơ chế còn gây **lỗi chập chờn**: lời gọi không scope trùng lúc với bất kỳ lời gọi có
  scope nào đang chạy (UI tải nhiều data có `companyId` cùng lúc) cũng bị từ chối. Vì vậy cách sửa phải bỏ lời gọi
  `companies.list` không scope, không chỉ rút TTL.

## 1. Tái hiện trên T1

Stack: server fork `cli run` cổng 3199 (Postgres nhúng 54329) từ `.worktrees/paperclip-r3-e2e`, plugin cài local path
`packages/crew-plugin` của worktree đó. Lưu ý: `dist/worker.js` ở đó build lúc 04:44 (trước SEC-2), chỉ đăng ký
`agent.run.cancelled` (log `registered.eventSubscriptions: 1`) — **tức là cùng tập sự kiện với prod**.
Script tạm: scratchpad `repro.mjs`, `cancelrun.mjs` (đăng nhập bằng `~/crew-r3-t1/board.env`, không in secret).

| Giờ | Bước | `crew.companies` không companyId | `crew.companies` có companyId |
|---|---|---|---|
| 05:58:05 | mốc, server mới khởi động | 200 | 200 |
| 05:59:08 | run agent `crew-e2e-worker` (process `true`), **succeeded, không hủy** | 200 (cả 4 lần thăm tới 05:59:17) | 200 |
| 05:59:49–52 | run `sleep 60` rồi `POST /heartbeat-runs/:id/cancel` (200) | — | — |
| 05:59:53 → 06:02:53 | thăm liên tục | **502 `INVOCATION_SCOPE_DENIED`** "…missing, expired, or unknown invocation scope" | 200 |
| 06:00:15 | job `attachments-audit` (lịch mỗi phút) | run `failed`, cùng thông báo lỗi `companies.list` | — |
| 06:14:53, 06:15:53 | thăm tiếp (không làm gì thêm) | **200** | 200 |

- Run thành công mà không hủy KHÔNG gây lỗi với dist cũ (chưa nghe `agent.run.started`) → chính sự kiện được nghe
  mới mở cửa sổ. E2E-2 thấy lỗi "sau run `true`" vì các run của E2E-2 bị hủy `issue_assignee_changed` (danh sách run
  T1: 3 run `cancelled` lúc 05:18–05:28) → `agent.run.cancelled` tới plugin.
- Lời gọi có `companyId` vẫn 200 vì worker echo invocation id hợp lệ, và trong invocation hợp lệ host cho
  `companies.list` qua (`host-client-factory.ts`: `if (method === "companies.list") return;`).

**Hết TTL:** thăm mỗi phút từ 06:02:53 tới 06:13:53 đều 502; **06:14:53 trở đi 200** — đúng 15 phút sau lần hủy (05:59:52), không cần restart. "Cho tới khi restart" ở E2E-2 là do run bị hủy liên tiếp làm cửa sổ mở lại.

## 2. Nguyên nhân gốc — đường gọi

1. Plugin `ctx.events.on(name, fn)` → host `plugin-host-services.ts:1565–1571` đăng ký trên bus, handler chỉ làm
   `notifyWorker("onEvent", { event })` (`app.ts:907` → `handle.notify`).
2. `plugin-worker-manager.ts:3460–3477` `notify()`: `deriveInvocationScope("onEvent", …)` lấy `event.companyId`
   (`:1134`) rồi `registerInvocation(scope, MAX_RPC_TIMEOUT_MS)` — TTL **15 phút** (`:85`), không bao giờ xóa sớm vì
   notification không có phản hồi (comment ở `:3463`: "the invocation scope is GC'd by TTL").
3. Worker SDK (`worker-rpc-host.ts:2273–2277`) chạy handler trong `AsyncLocalStorage` với invocation đó; lời gọi host từ
   handler kèm `paperclipInvocationId` (`:433–453`) — đúng.
4. Lời gọi khác, **ngoài** handler (data `crew.companies` không companyId → `getData` không có invocation; job
   `runJob` không có companyId) gửi lên host **không có** `paperclipInvocationId`.
5. `plugin-worker-manager.ts:2666–2688` `contextForWorkerMessage`: không có id → thử scope chủ động
   (`referencedCompanyId` cố ý trả `null` cho `companies.list`) → rồi
   `hasActiveInvocation = activeInvocations.size > 0 || …` → còn invocation 15 phút của sự kiện → `{ invalidInvocationScope: true }`.
6. `packages/plugins/sdk/src/host-client-factory.ts:593–607` `requireInvocationCompanyScope`: `companies.list` là
   phạm vi "all" (≠ none) và `invalidInvocationScope` → ném `InvocationScopeDeniedError`
   ("the worker referenced a missing, expired, or unknown invocation scope", mã `-32005`) → route
   `routes/plugins.ts:1299` trả `INVOCATION_SCOPE_DENIED` 502.

Không phải handler `guards.ts`/`run-cancelled.ts` "gắn scope vào context dùng chung": hai handler đó chỉ là lý do để
host đăng ký sự kiện; chỉ cần *có* subscription là đủ (handler `run-cancelled` thoát sớm vẫn mở cửa sổ, vì invocation
đăng ký trước khi gửi). Code host này là upstream (commit `38c185fb8` 22/05, `ece8a51e2` 25/05), vẫn y nguyên ở
`upstream/master` 9b624a110 (08/10) — upstream chưa sửa.

Test tái hiện mức host (tạm, không commit):
`.worktrees/paperclip-r3-dbg/server/src/__tests__/dbg-p1-event-scope-leak.test.ts` — dùng fixture có sẵn
`plugin-worker-invocation-scope.cjs`: (1) `getData` không scope gọi `companies.list` → OK; (2) sau một
`notify("onEvent", { event: { companyId } })` đã xử lý xong → cùng lời gọi bị `INVOCATION_SCOPE_DENIED`, service
`companies.list` không được gọi. Chạy: `cd server && npx vitest run src/__tests__/dbg-p1-event-scope-leak.test.ts`
→ **2/2 xanh** (khẳng định lỗi). Cần build `@paperclipai/shared` và `@paperclipai/plugin-sdk` trước.

## 3. Prod hiện tại có bị không

| | prod `eef987b01` (= trong crew/r2-5) | crew/r3 `623616b25` |
|---|---|---|
| Sự kiện plugin nghe | `agent.run.cancelled` | thêm `agent.run.started`, `agent.created`, `project.created/updated/workspace_*`, `goal.created/updated` |
| Ai gọi `companies.list` không scope | job `attachments-audit` (mỗi phút) | job đó + data `crew.companies` (crew-web gọi với `companyId: null`, `api/crew/data.ts:53`, `app/hooks.ts:64`) |
| Hậu quả | job audit đính kèm `failed` ~15 phút sau mỗi lần hủy run; UI không ảnh hưởng | mỗi run bắt đầu mở lại cửa sổ → job và shell UI gần như luôn hỏng khi có agent chạy |

Kết luận: lỗi gốc **vốn có** (host upstream + handler cancel có từ trước R3), **R3 khuếch đại nó thành chặn deploy**.
Chưa kiểm lịch sử job trên prod (không đụng prod); owner có thể xem chỉ đọc
`GET /api/plugins/crew.core/jobs/<attachments-audit>/runs` để thấy run `failed` sau các lần hủy.

## 4. Đề xuất sửa

### Bắt buộc trước DP-1 — không đụng lõi (plugin + web)

1. **`crew.companies` luôn gọi có company.**
   - `packages/crew-web/src/api/crew/data.ts`: `companies(companyIds)` gọi `crewData('crew.companies', id)` cho từng
     company (song song) rồi gộp; `app/hooks.ts` `useCrewCompanies`: query `crewCompanies` phụ thuộc `all.data`
     (`enabled: !!all.data`, key kèm danh sách id), truyền id từ `GET /companies?scope=accessible`.
   - `packages/crew-plugin/src/companies/data.ts` `loadCrewCompanies`: khi có `scoped` thì dùng
     `ctx.companies.get(scoped, …)` thay `companies.list()` (không cần quyền "all", bớt phụ thuộc ngoại lệ
     `companies.list`); nhánh không company giữ cho admin nhưng không còn đường UI nào gọi. `guards.ts` dùng hàm này
     với `companyId` nên cũng được lợi.
   - Lợi phụ: nhánh không company vốn chỉ instance admin qua được (`assertPluginBridgeScope`), nên board không phải
     admin cũng dựng được shell.
2. **Job `attachments-audit` không phụ thuộc `companies.list` không scope** (`packages/crew-plugin/src/attachments/audit.ts`
   `configuredCompanies`): giữ danh sách company Crew trong DB plugin (bảng nhỏ `crew_companies(company_id, seen_at)`
   qua migration mới, hoặc tái dùng bảng sẵn có nếu PL thấy hợp), ghi mỗi khi `loadCrewCompanies` chạy có scope và mỗi
   khi `companies.list` thành công; job thử `companies.list`, gặp lỗi mã `INVOCATION_SCOPE_DENIED` (-32005) thì dùng
   danh sách đã lưu và ghi `logger.warn` một dòng thay vì làm run `failed`. Các lời gọi còn lại trong job
   (`config.get(companyId)`, `authorization.audit.search({companyId})`, `db.*`) đã đi qua scope chủ động của host nên
   không bị ảnh hưởng.
3. **Test tái hiện cần thêm** (PL/WEB viết, đỏ trước khi sửa):
   - plugin: giả `ctx.companies.list` ném lỗi `{ code: -32005 }` → `loadCrewCompanies(ctx, { companyId })` vẫn trả
     company Crew (không gọi `list`); job audit vẫn quét company đã lưu và không ném.
   - crew-web: `useCrewCompanies` gọi `crew.companies` mỗi company có `companyId` trong body, không bao giờ gửi
     body thiếu `companyId`.
   - T1 (E2E): sau khi hủy một run (`cancelrun.mjs`) và sau một run thường (với dist mới có `agent.run.started`),
     shell dựng được và job audit `succeeded`. Nhớ build lại `packages/crew-plugin` trước khi chạy T1 — dist ở
     worktree e2e đang cũ (04:44).

### Tùy chọn — vá lõi (cần owner quyết, đụng code upstream)

- `plugin-host-services.ts:1565–1571`: giao `onEvent` bằng `call` (SDK đã xử lý `onEvent` như request,
  `worker-rpc-host.ts:1601`) thay vì `notify`, để invocation xóa ngay khi handler xong; hoặc tối thiểu trong
  `contextForWorkerMessage` không tính các invocation đăng ký từ notification (có `timer`) vào `hasActiveInvocation`.
  Vá này chỉ thu cửa sổ 15 phút về độ dài handler; lời gọi không scope trùng lúc lời gọi có scope vẫn bị từ chối,
  nên KHÔNG thay được bước 1–2. Nên báo upstream.

## Dọn dẹp

- Server T1 (DBG-P1) đã tắt, `processes.md` cập nhật. Agent `crew-e2e-worker` trên T1 đã trả về `wakeOnDemand: false`,
  lệnh `true` (args `[]`); T1 có thêm 2 run (1 succeeded, 1 cancelled) của DBG-P1.
- Worktree `.worktrees/paperclip-r3-dbg` giữ (có `node_modules`, test tạm chưa commit); gỡ bằng
  `git -C .worktrees/paperclip-v3 worktree remove --force .worktrees/paperclip-r3-dbg`.
