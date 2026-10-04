# CREWV2-701 / Task 3 — S3b fix1: review lại theo phạm vi

Phạm vi: `60f546e..d9216cc` (`task-3-s3b-fix1-review-package.diff`), mục 5 của `task-3-s3b-report.md`. Đối chiếu với
`compose/composer.tsx`, `compose/controller.ts`, `lib/pending-operation.ts`, `lib/session.ts`. Không chạy lại test.

## Verdict từng finding

| Finding | Verdict | Bằng chứng |
|---|---|---|
| I1: key theo ticket | **ADDRESSED** | `detail.tsx`: `<CommentComposer key={ticket.id} …>`. Text, state và controller bị remount theo ticket. Có DOM test đổi `ticketId` mà không remount; đột biến bỏ key thì test fail. |
| I2: persist, khớp body frozen, khóa, xóa khi logout | **ADDRESSED một phần** | Field và chữ bình luận được ghi xuống `sessionStorage` ở mỗi lần sửa. Field bị khóa sau khi submit, nên bản đã lưu chính là body frozen. Đọc lại có kiểm kiểu, bỏ bản ghi hỏng. Có test reload cho cả request lẫn comment: cùng key, cùng body, một entity. Khóa vẫn theo `requestFormLocked` cho đến khi giải quyết xong. **Riêng “xóa khi logout” chưa đạt**, xem B1. |
| M1: nhãn `owner_input` | **ADDRESSED** | `status.ts`: thêm nhãn, sửa comment nguồn `service.ts:420,486`, có unit `waitNotice`. |
| M2: test M1 chứng minh key/invalidation | **ADDRESSED** | DOM test kiểm `getQueryData(ticket(lower))`, kiểm invalidation chữ thường làm mới detail mở bằng ID chữ hoa, và response revision cũ không ghi đè. Đột biến key chữ hoa thì test fail. |
| M3: docs-links chỉ đọc khi terminal | **ADDRESSED** | `<fieldset disabled={terminal}>` bọc `TicketDocsLinksEditor`, không sửa `docs/*`, có DOM test. |
| M6: composer ở lại khi terminal mà còn bình luận chưa xác nhận | **ADDRESSED** (còn giới hạn đã ghi trong docs) | `CommentComposer` luôn được mount, chỉ trả về `null` khi `terminal && state === 'editing'`. Ticket chuyển terminal giữa chừng thì nút gửi lại vẫn còn (có DOM test). Ticket đã terminal ngay từ lần render đầu thì composer không mount được, vì `state` khởi tạo là `'editing'`. Trường hợp đó đi qua panel Task2, docs đã ghi. |
| I3: discard trọn bản nháp | **NOT** (chờ API S5a, PM đã ruling) | Không tệ hơn trước: nút bỏ chữ giờ xóa cả key trong storage; tệp, session và key composer vẫn như cũ. Phần phân tích NEEDS_CONTEXT về `discard()`/`abandon()` khớp với `controller.ts`. |

## Kiểm theo lens

- **Secret:** không thấy. Kho chỉ lưu `RequestFormFields` (project/kind/title/description/workflow) và chữ bình luận, không có CSRF, cookie hay mật khẩu (test cũng assert điều này). Body compose vốn đã lưu `storage:'tab'` trong `PendingStore` (`controller.ts:692,1233`), cùng loại dữ liệu. `containsSecret` chỉ kiểm tên key. Khác biệt duy nhất: draft giờ nằm trong storage từ trước khi submit, chứ không chỉ sau khi submit. Chấp nhận được, vì không có field credential.
- **Terminal và bình luận mới:** không mở được bình luận mới.
  - Composer chỉ hiện khi state khác `editing`. Lúc đó text và tệp bị composer khóa (`composeLocks`), và submit chỉ replay operation frozen.
  - Sau receipt, `startNew()` đưa state về `editing` và mục bị ẩn.
  - Re-entry (tombstone) báo `reportedState: 'editing'` nên cũng bị ẩn: không thể gõ nội dung mới dưới key cũ trên ticket terminal.
  - Cửa sổ một render giữa `startNew()` và `onStateChange('editing')` là không đáng kể.
- **Xóa khi logout chỉ chạy nếu kho đã được tạo trong lần tải trang hiện tại:** có sót dữ liệu (B1).

## Breakage mới

### Important

**B1 — `create-request-state.ts` (`formDrafts`, `clearOnLogout`): bản nháp sống qua logout.**

- **Vấn đề:** thao tác xóa gắn vào kho, mà kho chỉ được tạo lười khi một view ticket render. Hai đường để sót dữ liệu:
  - Tab có draft trong storage, reload, owner không mở form/chi tiết nào rồi đăng xuất. Không có subscriber nên key `crew-v2:form-draft:*` vẫn còn.
  - Sau logout + reload, trang chỉ ở `guest`, view bảo vệ không render nên kho không được tạo. Lệnh `clearOnLogout()` gọi ngay lúc tạo hầu như không bao giờ thấy `guest`, vì kho chỉ được tạo khi đã `authenticated`.
- **Hậu quả:** lần đăng nhập sau, title/mô tả/bình luận của phiên trước hiện lại. Điều này trái với invariant ở docs mục 12 và với ranh giới của Task2: `tombstoneAll()` đã xóa payload, form lại khôi phục chữ.
- **Tại sao giờ mới thành lỗi:** trước fix, draft chỉ nằm trong bộ nhớ nên reload là mất. Persist làm phát sinh dư lượng sau logout.
- **Sửa:** xóa theo prefix `crew-v2:form-draft:` ở chính hook logout của session, không phụ thuộc kho đã được tạo hay chưa. Ví dụ export `wipeFormDrafts(storage)` và để controller gọi trong `session.onLogout` của `createAppRuntime`/`wireSession`. Hoặc tạo kho ngay trong `createAppRuntime`. Thêm test: draft trong storage → session mới, chưa tạo kho → logout → storage rỗng.

### Minor

- **B2 — `create-request-state.ts` `browserTabStorage()`:** kho dùng thẳng `globalThis.sessionStorage` chứ không dùng `composeServices.storage`/runtime storage. Nếu runtime chạy với `storage: null` (chỉ bộ nhớ), composer chỉ giữ trong bộ nhớ còn field vẫn bị ghi xuống `sessionStorage`, hai nguồn lệch nhau. Sửa: lấy storage từ runtime.
- **B3 — `create-request-state.ts` (`comment:<ticketId>`):** chỉ gửi thành công hoặc bấm bỏ mới xóa key. Draft của ticket đã terminal không bao giờ được dọn (composer bị ẩn nên không có nút bỏ), nên key tích lũy trong tab và được nạp toàn bộ lúc tạo kho. Sửa: xóa draft khi gặp ticket terminal ở trạng thái `editing`.
- **B4 — `detail.tsx` (fieldset bọc editor docs-links):** `fieldset disabled` cũng vô hiệu luôn nút “Thử lại” khi đọc thất bại trong editor trên ticket terminal. Ảnh hưởng nhỏ; chấp nhận được hoặc tách vùng đọc ra.

## Kết luận

**Task quality:** Needs fixes. Phải sửa B1 (cần controller nối vào hook logout). I1, M1, M2, M3, M6 đạt. I2 đạt trừ phần xóa khi logout. I3 vẫn NOT và đang chờ S5a, hiện trạng không tệ hơn trước.
