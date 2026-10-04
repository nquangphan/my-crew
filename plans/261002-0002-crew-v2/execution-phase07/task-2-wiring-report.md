# CREWV2-701 / Task 2 wiring — nối phiên, transport và sự kiện vào app thật

BASE `43792f1`, nhánh `codex/crew-v2-server`, Node v24.21.0, pnpm 10.32.1. Worker Claude (web-wiring); không dispatch subagent.

## Thay đổi

- `v2/web/src/app-runtime.ts` (mới): `createAppRuntime` dựng một `QueryClient`, `SessionController`, `PendingStore` (sessionStorage của tab), `OwnerClient`, `EventSync` và gọi `wireSession` ngay lúc dựng, trước mọi subscriber React. Query mặc định `retry: false` (OwnerClient.get đã retry 3 lần), `refetchOnWindowFocus`/`refetchOnReconnect` bật. Thêm `authorizeRoute`, `internalReturnPath`, `parseLoginSearch`, `RuntimeContext`/`useRuntime`. File này không nằm trong danh sách file được sửa của brief, nhưng cần là `.ts` để unit test Node nạp được; đã đưa vào flow `web-shell`.
- `main.tsx`: mount một runtime, cung cấp context và `queryClient` của runtime.
- `router.tsx`: root `Shell`, route `/login` (search `returnTo` được `safeReturnPath` kiểm), nhóm route bảo vệ `/` và `/projects/$projectId` có `beforeLoad` chuyển guest/expired sang `/login?returnTo=` và `SessionBoundary` (hiện đăng nhập lại tại chỗ khi hết phiên giữa chừng).
- `shell.tsx`, `styles.css`: nút “Đăng xuất” ở toolbar khi đã xác thực (không có nút này thì logout không với tới được từ app thật).
- Docs: `web-shell.md` (bước 0, files, tests), `web-data.md` (bỏ câu “controller nên…”), `flows.yaml`, `files.md`.

## Thứ tự listener trước GET

`wireSession` đăng ký `session.subscribe` trước React nên khi phiên thành `authenticated`, `EventSync.start` gọi `/v2/events?after=` trước khi view bảo vệ render và GET. Trace E2E thật: `GET session, POST session, GET session, GET events, GET events/stream, …`.

## Kiểm tra (heap 384 MiB, giữ lock heavy slot owner=web-wiring; telemetry khi lấy: 4.18 GiB, pressure 1, idle 63.12%, đĩa 752.97 GiB)

| Lệnh | Kết quả | Log |
|---|---|---|
| `node --test test/app-wiring.test.ts` (6 test: stream trước GET, retry tắt + refetch bật, guest chuyển login có return path nội bộ, URL ngoài/`..`/`\` bị loại, logout và hết phiên xóa cache và dừng stream) | 6/6 | `task-2-wiring-unit-focused.log` |
| `node --test test/*.test.ts` | 52/52 | `task-2-wiring-unit-full.log` |
| `tsc --noEmit` | exit 0 tại lúc kiểm (sau đó `src/tickets/queries.ts` của worker khác báo thiếu `SourceRef`, ngoài phạm vi) | `task-2-wiring-typecheck.log` |
| `vite build` | exit 0 | `task-2-wiring-build.log` |
| Biome 8 file đã chạm | sạch | |
| `playwright test e2e/auth.spec.ts e2e/events.spec.ts` | 3/3 | `task-2-wiring-e2e.log` |
| E2E tạm trên router thật (không giữ trong repo, mã ở `task-2-wiring-router-scratch.spec.ts.txt`) | 1/1: guest vào `/crew-v2/projects/abc?x=1` → `/crew-v2/login?returnTo=…`, đăng nhập quay về đúng path, stream khởi động, đăng xuất, `returnTo=https://evil.example/` rơi về `/crew-v2/` | `task-2-wiring-router-scratch.log` |

`crew-docs check --all` (bản sao tạm có `v2/` làm Git root) chỉ báo R2 cho `web/src/tickets/*`, `web/src/compose/*` của worker khác chưa vào flow; phần của wiring sạch.

## Chỉnh spec (bắt buộc)

`e2e/auth.spec.ts` và `e2e/events.spec.ts` ẩn app thật và mount harness; app thật nay có form đăng nhập nên `getByLabel('Mật khẩu')` gặp 2 phần tử (strict mode). Chỉ đổi 4 locator thành `page.locator('#task2-harness').getByLabel('Mật khẩu')`, không đổi logic.

## Cleanup

Danh sách `docker ps -a` trước/sau trùng nhau, không còn `crew-v2-web-*` trong TMPDIR, `test-results` đã xóa, lock đã `rm -rf`. Process playwright-mcp còn lại thuộc người khác.

## Còn lại

- `/` và `/projects/$projectId` vẫn là nội dung minh họa phía sau đăng nhập; S3a/S5a gắn route thật vào `protectedRoute` trong `router.tsx`.
- Chưa có E2E router thật giữ trong repo (spec Task2 mount harness); đề xuất Task sau thêm spec thật dựa trên bản scratch.
- Tab mới đọc journal từ 0 (backlog producer G) và các minor Task2 còn hoãn không đổi.

## Vòng sửa 1 (review `task-2-wiring-review.md`)

- **I1/I2:** thêm `v2/web/e2e/app-router.spec.ts` (fixture Task1, không mock mạng, chỉ quan sát request). Bao: guest vào `/crew-v2/projects/abc?x=1` bị chuyển tới `/crew-v2/login?returnTo=%2Fcrew-v2%2Fprojects%2Fabc%3Fx%3D1`; đăng nhập quay về đúng path; sau GET session xác minh, GET đầu tiên là `/v2/events` và chỉ có một `/v2/events/stream` (thứ tự trên `ProtectedLayout` thật; hiện layout chưa có GET dữ liệu nên assertion là "không GET nào khác đi trước catch-up", S3a/S5a gắn dữ liệu thật thì vẫn đúng); `returnTo=https://evil.example/` rơi về `/crew-v2/`; đăng xuất làm request stream bị hủy. Xóa cache khi logout chỉ được chứng minh ở unit test (E2E không với tới QueryClient).
- **M2:** xóa nhánh `/v2/projects/flaky`. **M4:** viết lại mục "Dữ liệu" và đoạn tests của `web-shell.md`. **M6:** `ProtectedLayout` truyền `returnTo = internalReturnPath(useLocation())` cho `SessionBoundary`.
- M3 và M5 để PM ghi ledger.

Kết quả (heap 384 MiB, giữ lock owner=web-wiring; telemetry 4.832 GiB / pressure 1 / idle 72.35% / đĩa 751.8 GiB): E2E `app-router` + `auth` + `events` 4/4; `vite build` exit 0; Biome ba file sạch. Web unit 83/84 và `tsc` đỏ chỉ ở `test/compose-submit.test.ts` (`receiptSummary`, `draftKey`, `conversationId`, `clientMessageId` chưa có trong `src/compose/state.ts`), file của worker S5a đang viết dở, không phải của wiring; `app-wiring.test.ts` xanh. `docker ps -a` trước/sau trùng nhau, `test-results` đã xóa, lock đã nhả. Log: `task-2-wiring-fix1-*.log`.
