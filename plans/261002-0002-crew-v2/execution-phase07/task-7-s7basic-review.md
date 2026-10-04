# Review Task 7 S7basic + A7basic (333468a)

Phạm vi: `v2/web/src/machines/onboarding{,-state}.ts(x)`, `v2/web/src/projects/setup{,-state}.ts(x)`, `router.tsx`, `shell.tsx`, `test/onboarding.test.ts`, `e2e/onboarding.spec.ts`; đối chiếu `server/src/auth/routes.ts`, `auth/machine.ts`, `projects/{routes,service}.ts`, `journal/mutation.ts`, `web/src/lib/api.ts`. Không chạy lại test.

### Spec Compliance
- ✅ Mục nav “Máy” → “Đăng ký máy”, “Dự án” → “Tạo dự án/Gắn máy”; router/shell chỉ thêm 2 route + 2 link (đúng license hẹp).
- ✅ `machine:create` name 1–200 (trim phía client; server không trim nhưng chỉ chặn rộng hơn), POST `/v2/machines {name}`, decode `{machine,token}`.
- ✅ Tạo dự án: regex key, name 1–200, repositoryUrl null/https/ssh không credential — khớp `createProject`/`validRepo`; PROJECT_KEY_CONFLICT giữ field.
- ✅ Bind: PUT `/v2/projects/:id/binding`, `expectedRevision` lấy từ Project thật, máy revoked bị loại khỏi select, path ≤4096, NUL.
- ✅ PendingOperation: intent cố định `machine:create` / `project:create` / `project-bind:<id>`; held → khóa field, gửi lại cùng key + byte (kiểm bằng so sánh `bodyJson`); tombstone dùng lại key.
- ✅ 409 lần gửi đầu → `reject` (uncertain=false) → key mới ở lần áp dụng lại; field giữ nguyên (draft); ACTIVE_EXECUTION chỉ giải thích, không gọi pause/cancel.
- ✅ A7basic E2E thật (API/PostgreSQL/Vite), gồm login UI → máy → dự án → bind → reload; hai tab 409; active/uncertain → 409 `ACTIVE_EXECUTION` qua guard thật `assertNoActiveProjectExecution`, DB binding không đổi.
- ⚠️ Brief: “409 REVISION_CONFLICT refetch/giữ ý định để explicit reapply key mới khi operation cũ đã rejected”. Với operation còn held (replay sau lỗi mạng), 409 bị coi mơ hồ → không bao giờ “rejected” (xem Important 1).
- ⚠️ Path tuyệt đối: client nhận cả Windows/UNC, server dùng `node:path.isAbsolute` theo OS server (xem Important 2).
- ⚠️ Empty state: có hướng dẫn máy/dự án rỗng; trạng thái “owner chưa bootstrap” chỉ có text `OWNER_NOT_BOOTSTRAPPED` trong `readFailureText`, chưa có test/E2E.

### Token handling
- Token chỉ ở `useState` của `MachineOnboarding`; không `useMutation`, không query cache, response không vào pending store (`accept` xóa op). Clear khi đóng, unmount, session không còn authenticated, `pagehide`. Unit test kiểm storage, query cache, pending list, DOM sau đóng; E2E kiểm localStorage/sessionStorage, console, `page.content()`, body POST.
- Mất phản hồi: replay cùng key + byte, server phát lại từ receipt → không máy thứ hai (có test).
- Còn lại (không phải lỗi của task, cần biết): (a) server lưu token plaintext trong `idempotency.response` (`journal/mutation.ts:42-49`, không `codec` redact cho route này) — token tồn tại at-rest trong DB và replay được bằng key; (b) nút “Sao chép” đưa token vào clipboard hệ điều hành (explicit, brief cho phép); (c) đăng ký máy thứ hai khi panel còn mở sẽ ghi đè token đầu không cảnh báo (Minor 2); (d) assertion “body POST không chứa token” vô nghĩa vì token chỉ nằm ở response (Minor 3); không kiểm IndexedDB/CacheStorage/cookie.

### Test independence
- RED chỉ là thiếu module, không chứng minh ngữ nghĩa; độc lập thực chất đến từ assertion hành vi.
- Sẽ fail với impl hỏng hợp lý: dùng lại key sau 409 (`notEqual` key, dòng 292/407); mất field sau 409 (đọc value input); token vào cache/storage/pending (dòng 195–208); gửi revision cũ/không refetch (revision 2 + checkoutPath DB); gọi pause/cancel (đếm call); replay lệch key/body (dòng 233–235).
- Yếu/trống: không có test cho held replay của `project:create` và bind (chỉ machine); không test tombstone `resume` trong UI; không test 409 trên replay (dead-end Important 1); `checkoutPathError` không test Windows/UNC; FakeServer tự cài receipt nên không chứng minh server thật (E2E bù một phần).
- E2E: Route Playwright chỉ làm chậm GET (không sửa response) → chấp nhận được và trung thực; chèn `attempts/commands/execution_guards` trực tiếp vào DB fixture → chấp nhận được vì chính guard production được thực thi, nhưng nối schema chặt (⚠️ nhỏ) và bỏ qua invariant command/attempt; test 3 phụ thuộc trạng thái test 1 (serial, không độc lập khi chạy riêng/`--grep`).

### Strengths
- Giữ intent cố định, so sánh byte trước replay, `INTENT_UNRESOLVED`/`IDEMPOTENCY_CONFLICT` có thông điệp tiếng Việt rõ.
- Luôn invalidate projects sau bind (thành công lẫn lỗi); revision lấy từ query, không từ state cũ.
- a11y: label/`aria-describedby`/`role=alert|status`/`aria-label` vùng; field khóa khi held.

### Issues
**Critical:** không.

**Important**
1. `v2/web/src/projects/setup.tsx:230,295` (+ `api.ts:319`) — replay của op đang held mà server trả 409 (REVISION_CONFLICT/ACTIVE_EXECUTION/PROJECT_KEY_CONFLICT) bị `markAmbiguous` mãi mãi; form khóa, chỉ còn “Gửi lại đúng yêu cầu cũ” lặp 409; sessionStorage giữ qua reload. Owner không có đường thoát (dead-end) và mâu thuẫn dòng brief “giữ ý định để áp lại bằng key mới”. Fix: thêm hành động “Bỏ yêu cầu cũ và dùng lại các trường” (gọi `pending` conflict/tombstone→resume với cảnh báo rủi ro commit trùng), hoặc khi replay trả 409 cùng-key có receipt-miss, cho phép bỏ khóa có xác nhận; thêm unit test.
2. `v2/web/src/projects/setup-state.ts:45` — chấp nhận `C:\`, `\\` UNC, nhưng `bindProject` dùng `isAbsolute` theo OS server (POSIX server → 400 `VALIDATION` chỉ báo chung “Máy chủ từ chối…”). Brief chỉ nói “tuyệt đối”. Fix: hoặc gỡ nhánh Windows/UNC (nhất quán với server), hoặc hiển thị lý do riêng cho 400 binding; thêm test cho hai dạng này.
3. `v2/web/test/onboarding.test.ts` — thiếu test cho held-replay của `project:create`/bind và tombstone resume (đường ít được kiểm nhất, nơi Issue 1 nằm). Fix: thêm 2 test với FakeServer rớt phản hồi.

**Minor**
1. `setup.tsx:196,208` — nếu owner bấm “Đổi máy” không sửa field (shown = fromServer) rồi 409, field đổi theo bản mới (không phải “giữ”); cân nhắc chốt `draft` lúc submit.
2. `onboarding.tsx:121` — đăng ký máy mới khi panel token còn mở ghi đè token chưa đóng; khóa nút hoặc yêu cầu đóng panel trước.
3. `e2e/onboarding.spec.ts` (assert `bodies`) — assertion vô hiệu (token chỉ có ở response); thay bằng kiểm response body chỉ tới nơi hiển thị, hoặc bỏ; bổ sung IndexedDB/CacheStorage.
4. `onboarding-state.ts:96-105` — `accept` đã xảy ra trước `decode`; response shape lỗi sau 2xx làm mất token vĩnh viễn (máy đã tạo). Hiếm; ít nhất báo rõ “máy đã đăng ký, token không hiển thị được — thu hồi và đăng ký lại”.
5. `e2e/onboarding.spec.ts:~190` — test 3 phụ thuộc dữ liệu test 1; tự tạo dữ liệu hoặc ghi rõ dependency.

### Assessment
Chức năng và hợp đồng server khớp, token handling chặt trong phạm vi web; còn một dead-end phục hồi (Important 1) và một lệch hợp đồng path (Important 2) cộng khoảng trống test ở đường replay.

**Task quality:** Needs fixes
