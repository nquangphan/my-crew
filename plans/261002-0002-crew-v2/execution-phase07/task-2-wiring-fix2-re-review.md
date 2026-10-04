# Re-review vòng sửa 2: Task 2 wiring (b08a927 → e2dd3e4, kèm net manifest ba58e42..e2dd3e4)

Phạm vi: `task-2-wiring-fix2-review-package.diff` và fix report cuối `task-2-wiring-report.md`. Không chạy lại test.

## Verdict: APPROVED

- **R2 (Important): ADDRESSED.** `web/e2e/app-router.spec.ts` có trong `tests` của `web-shell` ở `flows.yaml` và có dòng `(test)` tương ứng trong `files.md`. Net manifest chỉ gồm hai hunk này, không kéo theo hunk của worker khác.
- **M6: ADDRESSED, đồng ý với cách xử lý.** Bỏ prop thừa là đúng. `LoginScreen` chỉ dùng `returnTo` khi gọi `onAuthenticated` (login.tsx:73), và đăng nhập lại tại chỗ không điều hướng. `router.tsx` về lại hash nội dung của e901fd7 (`ff6ce75`), `internalReturnPath` vẫn dùng trong `authorizeRoute`, nên không còn import mồ côi. `returnTo` thật của `/login` vẫn được E2E kiểm.
- **Assert vacuous: ADDRESSED.** Assert `includes('evil')` đã bị thay bằng assert guest không có `GET /v2/events*` sau logout và sau khi tải lại trang login, đặt sau khi `heading` hiện. Assert này kiểm hành vi thật và bắt được stream dư.
- **Câu docs logout: ADDRESSED.** Câu trong `web-shell.md` khớp đúng assert mới: stream bị hủy, và guest không có request sự kiện.

## Breakage mới

Không có breakage. Hai ghi chú nhẹ, không chặn:

1. **Minor** — `v2/web/e2e/app-router.spec.ts` cuối spec: `expect(page.url()).not.toContain('evil.example')` gần như thừa so với assert pathname `/crew-v2/` ngay phía trên. Vô hại, không cần sửa.
2. **Minor (rủi ro quy trình)** — Report nêu không chạy `tsc` toàn bộ vì `src/tickets|compose` của worker khác đang dở, mà `vite build` không typecheck. Rủi ro thấp vì `router.tsx` về đúng hash đã typecheck ở e901fd7, và spec chỉ đổi dòng `expect`. PM nên chạy `tsc` một lần khi S5a/S3a ổn định.

## Còn mở (đã ghi ở vòng trước, không phải lỗi vòng này)

I2 caveat: khi S3a/S5a gắn GET dữ liệu thật, phải thêm assert nêu đích danh GET đó đứng sau catch-up. M3 và M5 do PM ghi ledger.

**Task quality:** Approved.
