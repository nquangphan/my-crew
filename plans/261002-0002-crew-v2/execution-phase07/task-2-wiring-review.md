# Review task-scoped: Task 2 wiring (e901fd7)

Phạm vi: diff `task-2-wiring-review-package.diff`; kiểm thêm một lần `wireSession` (session-boundary.tsx:18-53), `safeReturnPath` (lib/session.ts:63) và `SessionController.logout` (lib/session.ts:273). Không chạy lại test.

### Spec Compliance

- ✅ Route bảo vệ nằm sau `SessionBoundary` (`router.tsx` `ProtectedLayout`) và `beforeLoad` chuyển guest/expired sang `/login?returnTo=`.
- ✅ `/login` truy cập được ở router thật; `returnTo` qua `parseLoginSearch` → `safeReturnPath`, đi vào `LoginRoute` và `onAuthenticated`. URL ngoài, `//`, `..`, `\`, `javascript:` rơi về `/crew-v2/` (test 4).
- ✅ Một `QueryClient` mỗi app: `createAppRuntime` gọi từ `mountApp` ngoài React nên StrictMode không dựng đôi; `main.tsx` dùng `runtime.queryClient`.
- ✅ Query mặc định `retry: false`, `refetchOnWindowFocus/Reconnect: true` (test 2 đọc default và đếm đúng 1 lần gọi).
- ✅ Một stream mỗi app/phiên: `wireSession` đăng ký lúc dựng runtime, trước subscriber React; test 1 chứng minh catch-up `/v2/events?after=` đi trước GET dữ liệu đầu.
- ✅ Logout/expire xóa cache và dừng stream (test 5, 6); `logout()` không throw nên `void session.logout()` an toàn.
- ✅ Unit test phủ cả bốn yêu cầu: listener-trước-GET, retry off, redirect chưa xác thực, validate return route.
- ⚠️ Redirect thật chỉ được chứng minh ở mức hàm `authorizeRoute`. `throw redirect(...)`, `validateSearch`, `LoginRoute` redirect/replace chỉ chạy trong scratch E2E không commit (xem I1).
- ⚠️ Chạm file ngoài danh sách cho phép: `app-runtime.ts` (mới), `e2e/auth.spec.ts`, `e2e/events.spec.ts`. Cả hai đều có lý do và được khai báo. Xem M1.

### Strengths

- Composition root gọn: một nơi dựng, một `dispose`, không có module-global state.
- Return-path validation dùng lại `safeReturnPath` đã có, không tự viết bộ lọc song song.
- Test hostile input phủ nhiều vector (scheme, `//`, `..`, `\`, non-string).
- Đổi locator e2e chỉ là scoping, không đổi logic. Bản scratch được lưu kèm log nên kiểm lại được.

### Issues

**Critical:** không có.

**Important**

- I1. `v2/web/src/router.tsx:46-117` (và thiếu spec trong `v2/web/e2e/`). Hành vi router thật (redirect guest, quay về returnTo sau login, `returnTo` ngoại bị loại, logout) chỉ có bằng chứng từ scratch `.txt` nằm trong `plans/`, không chạy trong CI. Ai đổi `beforeLoad`, `LoginRoute` hay `validateSearch` đều không bị test bắt, trong khi acceptance của task nêu rõ "login/expired reachable in real router". Phần unit chỉ kiểm hàm phụ trợ, không kiểm cách router dùng chúng. Fix: commit scratch thành `e2e/app-router.spec.ts`. Tối thiểu, controller ghi rõ đây là gap có chủ đích và giao cho task kế tiếp bằng một mục trong plan có owner và hạn, không chỉ một dòng "Còn lại" trong report. Vì allowed-files không liệt kê e2e mới nên đề xuất controller nới cho chính file này.
- I2. `v2/web/test/app-wiring.test.ts:853-869` (test 1). "Protected view" là subscriber do test tự gắn, không phải `ProtectedLayout`/`SessionBoundary` render thật. Test chứng minh thứ tự listener của runtime nhưng không chứng minh view thật không GET sớm hơn (ví dụ trong nhánh login-tại-chỗ của `SessionBoundary`). Chứng cứ thật là trace E2E trong report, vốn không được commit. Fix: kiểm cùng thứ tự ở E2E committed (I1) bằng `calls.indexOf('GET /v2/events') < indexOf(first data GET)`. Khi S3a/S5a gắn dữ liệu thật thì đây là assertion bắt buộc.

**Minor**

- M1. Phạm vi file: `app-runtime.ts` tách ra để Node test import được là hợp lý, nhưng controller nên ghi nhận phê duyệt ngoại lệ. Hai spec e2e Task 2 bị sửa tuy hợp lý (strict-mode locator), vẫn là phạm vi ngoài danh sách.
- M2. `v2/web/test/app-wiring.test.ts:846` có nhánh `/v2/projects/flaky` không dùng, là dead code trong fake API. Xóa.
- M3. `v2/web/src/router.tsx:128` (`parseLoginSearch` luôn trả `returnTo`) khiến `returnTo` thành required search type của `/login`, nên mọi `<Link to="/login">` sau này phải truyền search. Cân nhắc `returnTo?`. Hiện chưa có Link nào như vậy.
- M4. `v2/docs/flows/web-shell.md` mục "Dữ liệu": đoạn mới nối vào câu cũ, lặp "QueryClient có một instance" hai lần và gắn nhãn "ghi chú lịch sử" lẫn lộn. Mục "Mục đích" vẫn viết Task 1 "chưa đại diện project/ticket thật" mà không nói rõ route vẫn là placeholder. Viết lại gọn.
- M5. `main.tsx`: runtime không bao giờ `dispose` và dev HMR chạy lại `mountApp` sẽ tạo runtime thứ hai song song, mỗi cái một stream. Chỉ ảnh hưởng dev, ghi nhận.
- M6. `ProtectedLayout` không truyền `returnTo` cho `SessionBoundary`, nên login-tại-chỗ sau logout dùng default của boundary. Chấp nhận được vì không điều hướng, nhưng cần xác nhận khi route thật vào.

### Assessment

Wiring đúng spec và lifetime, validate return route chắc, không có lỗi trust-boundary hay race. Điểm yếu là bằng chứng router thật không nằm trong CI và test thứ tự listener dùng consumer giả. Không phải blocker chức năng nhưng đây là gap spec đã nêu ở brief, nên cần xử lý hoặc ghi nhận chính thức trước khi đóng Task 2.

**Task quality:** Approved (kèm điều kiện: controller đóng I1 bằng E2E commit hoặc ghi gap có owner trong plan; I2 xử lý cùng I1)
