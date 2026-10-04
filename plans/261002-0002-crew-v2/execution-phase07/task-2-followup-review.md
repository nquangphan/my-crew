# Review follow-up Task 2 — cấu hình 503/409, header Date, `/v2/events/latest`, warmUp

Commit `c4ab472` (bỏ qua log). Ruling: `pm-ledger.md` 00:20 và 00:35. Đọc diff một lần, gồm `api.ts`, `pending-operation.ts`, `events.ts`, `contracts/http.ts`, `session-boundary.tsx`, `app-wiring.test.ts`, `compose-submit.test.ts:589`, `app-router.spec.ts` và `compose.spec.ts`. Đối chiếu producer mỗi điểm một lần:
- `journal/routes.ts:77-86` (latest),
- `journal/events.ts:40` và `journal/mutation.ts:30-50` (cấp cursor, giao dịch),
- `attachments/submissions.ts:148,200`, `attachments/routes.ts:603,679` (các mã `*_NOT_CONFIGURED`).

Không chạy lại test.

### Spec Compliance

- ✅ **(1) `*_NOT_CONFIGURED`:**
  - Mutation (`api.ts`, nhánh `configurationFailure` trước 5xx/409/403): không auto-retry, `markConfigurationError` giữ key ở `ambiguous` và không bao giờ đi `reject`. Trả `kind: 'configuration'` kèm mã server.
  - GET và upload cũng không retry.
  - Panel hiện “Lỗi cấu hình máy chủ (mã)”.
- ✅ **(2) `lastServerDate?()`:** lấy từ header `Date` của mọi response owner (GET, mutation, upload, kể cả response lỗi) và bỏ qua header không parse được. Method optional trên interface, theo đúng chấp thuận của PM.
- ✅ **(3) `/v2/events/latest`:** tab chưa có cursor gọi `#anchor`, enqueue `['v2']` **trước** khi ghi cursor. Tab đã có cursor thì bỏ qua bước này. 401 → `AuthLost` → `expire()`.
- ✅ **(4) warmUp:** bỏ `waitForTimeout(1500)`, thay bằng vòng lặp có điều kiện (import trong một trang, chờ `networkidle`, kiểm cờ `window` còn nguyên), tối đa 5 lượt, hết lượt thì ném `VITE_WARM_UP_UNSTABLE`.
- ✅ **Assertion Important của A5/A3** (ledger 00:35): đúng 1 POST và `{status: 503, code: 'EXTRACTION_NOT_CONFIGURED'}` bắt từ HTTP response thật.

### Các điểm coordinator yêu cầu kiểm

- **409 `INPUT_SERVICES_NOT_CONFIGURED` có chứng minh chưa commit không?** Không chứng minh được về các lần gửi trước. Giữ key là đúng, và code không nhả key.
  - Mã này ném ở tầng route (`attachments/routes.ts:603,679`), có thể trước bước tra idempotency, nên không cho biết gì về các lần gửi trước của cùng key.
  - Các mã ném trong giao dịch (`submissions.ts:148,200`) bị rollback, nên chỉ chứng minh **lượt gửi này** không commit. Nếu một lượt trước đã commit, replay sẽ trả response đã lưu (`mutation.ts:36-39`) và không thể có `*_NOT_CONFIGURED`.
  - Kết luận: giữ key là đúng và bảo thủ. Không có đường nào nhả key, vì nhánh cấu hình chặn trước `reject`, `conflict` và tombstone.
- **Race giữa latest và catch-up:** không mất event.
  - `#anchor` đọc `event_cursor` đã commit. Mỗi event tăng cursor bằng `update … value + 1` trong cùng giao dịch ghi event (`events.ts:40`), và row lock buộc các giao dịch nối tiếp nhau. Vì vậy, khi latest thấy V thì mọi event ≤ V đã commit.
  - Event ghi sau thời điểm đó có cursor > V, được catch-up `after=V` lấy, hoặc được stream lấy qua `Last-Event-ID`.
  - Data GET đã chạy trước khi latest trả về được phủ bằng invalidate `['v2']` enqueue trước khi ghi cursor.
- **401 trên latest:** `AuthLost` → `session.expire()` → status `stopped`, giống catch-up và stream. Lỗi khác tính vào ngân sách thử lại. `#anchored` vẫn `false` nên lượt sau gọi lại latest.
- **Cờ lỗi cấu hình chỉ nằm trong memory:** đúng, không persist. Sau reload, operation chỉ còn `ambiguous` và hiện “Chưa xác nhận”. Lần gửi tiếp gặp lại đúng mã và gắn lại cờ. Đây chỉ là vấn đề thông tin UX, không ảnh hưởng an toàn key (Minor m1).
- **File ngoài phạm vi (PM đã cho phép):**
  - `app-wiring.test.ts`: bất biến “event sync đi trước data GET” vẫn giữ. Assert về invalidate `['v2']` nằm sau một `if`, xem m2.
  - `app-router.spec.ts`: chỉ nới regex `^GET /v2/events(/latest)?$`; thứ tự data GET sau event sync vẫn được assert.
  - `compose-submit.test.ts:589`: đúng một dòng, `UNCONFIRMED` → `EXTRACTION_NOT_CONFIGURED`, khớp ruling. Các assertion giữ key và message không đổi.

### Strengths

- Nhánh cấu hình đặt **trước** mọi nhánh có thể nhả key, nên không hồi quy I1/N1.
- `#anchor` enqueue invalidation trước khi ghi cursor, giữ đúng bất biến “cursor persist sau invalidation enqueue”.
- E2E PNG giờ chặt: bắt đúng response HTTP thay vì chỉ đếm `>= 1`.

### Issues

#### Critical

Không có.

#### Important

Không có.

#### Minor

- **m1 — `pending-operation.ts` (`#configuration`):** cờ lỗi cấu hình chỉ sống trong memory. Sau reload, panel hiện “Chưa xác nhận” thay vì “Lỗi cấu hình máy chủ” cho tới lần gửi kế tiếp. **Fix (tùy chọn):** persist mã cấu hình như một field additive trong record tab, hoặc chấp nhận và ghi vào docs flow.
- **m2 — `app-wiring.test.ts` (assert invalidate):** `if (urls[sync] === '/v2/events/latest') assert…` là assertion có điều kiện. Fake luôn ở trạng thái tab mới nên hiện tại nhánh này luôn chạy. Nhưng nếu sau này fixture có cursor sẵn, test sẽ im lặng bỏ qua kiểm tra. **Fix:** assert thẳng `urls[sync] === '/v2/events/latest'` trong test này, vì fixture không có cursor.
- **m3 — `api.ts` (`FailureKind` thêm `'configuration'`):** GET và upload trước đây trả `kind: 'http'` với status 503, nay trả `'configuration'`. Caller nào phân nhánh theo `kind === 'http'` hoặc `status >= 500` sẽ đổi hành vi. tsc không bắt được vì `kind` là union mở theo cách dùng. Hiện em chưa thấy caller nào bị ảnh hưởng; nên ghi rõ trong `web-data.md` để Task5 và G2 biết.

### Assessment

Bốn việc theo ruling đều đạt. Mã `*_NOT_CONFIGURED` không bao giờ nhả key. Thứ tự latest → catch-up → stream không làm mất event nhờ cursor được cấp nối tiếp trong giao dịch. 401 trên latest dẫn tới expire. Các file ngoài phạm vi chỉ đổi đúng phần PM cho phép.

**Task quality:** Approved
