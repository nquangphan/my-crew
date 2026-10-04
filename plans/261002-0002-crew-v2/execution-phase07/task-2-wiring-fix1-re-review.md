# Re-review vòng sửa 1: Task 2 wiring (e901fd7 → b08a927)

Phạm vi: `task-2-wiring-fix1-review-package.diff`, đọc thêm `session-boundary.tsx` (SessionBoundary), `login.tsx` (LoginScreen) và `docs/flows.yaml`, mỗi chỗ một lần. Không chạy lại test. Lỗi tsc/unit ở `src/compose/*` của S5a nằm ngoài phạm vi.

## Verdict: NEEDS FIX (nhỏ) — I1 và I2 đều ADDRESSED, còn 1 breakage docs bắt buộc

### Verdict từng mục

- **I1: ADDRESSED.** `e2e/app-router.spec.ts` chạy router thật trên fixture PostgreSQL/API/Vite, không mock mạng. Phủ guest → `/login?returnTo=%2Fcrew-v2%2Fprojects%2Fabc%3Fx%3D1` (đúng chuỗi mã hóa), quay về đúng path+query, `returnTo=https://evil.example/` rơi về `/crew-v2/`, logout hủy request stream. Report ghi E2E 4/4.
- **I2: ADDRESSED (kèm lưu ý).** Cách diễn giải của worker chấp nhận được: sau `GET /v2/auth/session` xác minh, `afterLogin[0] === 'GET /v2/events'` và đúng một stream. Layout chưa có GET dữ liệu nên assertion hiện là "không GET nào khác đi trước catch-up". Điều này vẫn bắt được regression đáng kể: mọi GET mới của layout hay view con chen vào trước catch-up sẽ làm test đỏ, vì chuỗi được lọc theo mọi `GET `. Giới hạn: chưa chứng minh được "view dữ liệu thật gọi sau". Việc đó chỉ kiểm được khi S3a/S5a có GET thật. Cần ghi vào ledger là gate: khi route thật gắn dữ liệu, thêm assertion nêu đích danh GET dữ liệu đứng sau catch-up và test không được vacuous.
- **M2: ADDRESSED.** Nhánh `/v2/projects/flaky` đã xóa.
- **M4: ADDRESSED.** Mục "Dữ liệu" của `web-shell.md` viết lại gọn, hết lặp. Mục "Mục đích" vẫn giữ giọng Task 1 nhưng không sai.
- **M6: ADDRESSED về hình thức, không có tác dụng thực tế.** `ProtectedLayout` truyền `returnTo={internalReturnPath(useLocation())}`, nhưng không truyền `onAuthenticated`. `LoginScreen` chỉ dùng `returnTo` khi gọi `onAuthenticated` (login.tsx:73) nên prop này hiện inert. Hành vi đúng vì đăng nhập lại tại chỗ giữ nguyên URL. Không gây hại, chỉ cần biết đừng coi đây là hành vi đã kiểm chứng.

### Breakage mới trong delta

1. **Important** — `v2/docs/flows.yaml` (flow `web-shell` hoặc `web-data`, mục `tests`) và `v2/docs/files.md`: `web/e2e/app-router.spec.ts` mới không nằm trong flow nào, trong khi diff không đụng cả hai file. Vi phạm luật R2 của repo, `crew-docs check` sẽ báo. Fix: thêm vào `tests` của `web-shell` (cùng `app-wiring.test.ts`), chạy `crew-docs generate` để sinh lại `files.md`, và chạy lại `crew-docs check --staged` như commit trước.
2. **Minor** — `v2/web/e2e/app-router.spec.ts:140`: `calls.slice(afterLogout).some((call) => call.includes('evil'))` vacuous. `calls` chỉ lọc `pathname` của `/v2/`, nên không bao giờ chứa host `evil`. Bằng chứng thật là assertion pathname `/crew-v2/` ở dòng 139. Xóa dòng 140 hoặc bắt request tới origin ngoài.
3. **Minor** — `v2/docs/flows/web-shell.md` (đoạn Tests): ghi "đăng xuất đóng stream (... không có request sự kiện mới)". Spec chỉ khẳng định `streamsClosed.length === 1`; `afterLogout` không dùng để kiểm "không có request sự kiện mới". Sửa câu cho khớp hoặc thêm assertion lọc `GET /v2/events*` trong khoảng sau logout, trước `page.goto` kế tiếp.
4. **Minor** — `v2/web/e2e/app-router.spec.ts:132`: `requestfailed` của stream bị abort phụ thuộc cách Chromium báo. Đã xanh trong lần chạy này, ổn định theo quan sát chứ không theo contract. Chấp nhận, theo dõi nếu flaky.

### Không có breakage

Delta `router.tsx` chỉ thêm `useLocation`/`returnTo`, không đổi thứ tự `beforeLoad`, redirect hay lifetime của runtime. `useLocation` làm `ProtectedLayout` render lại khi đổi route, vô hại. Xóa nhánh `flaky` không ảnh hưởng test khác.

**Task quality:** Needs fixes (chỉ breakage 1; còn lại là minor không chặn). Sau khi sửa R2 và `crew-docs check` sạch thì Approved.
