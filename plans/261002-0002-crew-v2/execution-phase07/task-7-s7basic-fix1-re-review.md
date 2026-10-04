# Re-review vòng sửa 1 S7basic (333468a..2f94ed3)

Đã đọc diff một lần, đối chiếu `pending-operation.ts`, `api.ts`, `server/src/{app,auth/routes,projects/service}.ts`. Không chạy test.

### Đính chính review cũ
`task-7-s7basic-review.md`, mục Token handling (a), đã sửa: server mã hóa response `POST:/v2/machines` bằng `credentialResponseCodec` (`app.ts:135`, `auth/session.ts:37-42`, AES-256-GCM + AAD actor/route/key), không lưu plaintext. Nhận định trước là sai.

### Verdict
- **I1: ADDRESSED (có một khoảng trống nhỏ, xem Minor 1).** `DiscardHeld` có hộp xác nhận cảnh báo bản trùng, gọi `PendingStore.reject` (xóa op, resumed, tombstone), giữ trường đã gõ (machine/project qua `setName`/`setFields`, bind qua `setDraft`), bind còn invalidate để lấy revision mới; key sau đó mới (test `notEqual` oldKey, expectedRevision 3). Dùng cho cả ba form.
- **I2: ADDRESSED.** `checkoutPathError` chỉ nhận `/...`, thông điệp nêu rõ từ chối `C:\`/UNC/tương đối; 400 hiện `error.message` của server (server trả "Thông tin gắn máy không hợp lệ" hoặc `INVALID_INPUT` tiếng Việt). Giới hạn: máy Windows không bind được, khớp hành vi server POSIX (ghi nhận, không phải lỗi).
- **I3: ADDRESSED.** Test mới: held replay cho `project:create` và bind, nhánh replay-409 + discard cho cả ba, tombstone resume cho máy và bind (kiểm key = `operation.id`).
- **M1: ADDRESSED.** `setDraft(shown)` lúc gửi; có test bấm không sửa rồi 409 giữ giá trị gửi.
- **M3: ADDRESSED.** Bỏ assertion body vô nghĩa; thêm IndexedDB, CacheStorage, cookie (xem Minor 3).
- **M5: ADDRESSED.** Cả ba E2E tự dựng máy/dự án/binding; report nói đã chạy test thứ ba riêng bằng `--grep`.
- **M4: NOT (chưa chấp nhận với nội dung thông báo hiện tại).** Không sửa `api.ts` là chấp nhận được (hiếm xảy ra: lỗi parse JSON đã được replay trong `api.ts`, `RESPONSE_SHAPE_INVALID` chỉ khi JSON hợp lệ nhưng sai contract). Nhưng thông báo hướng owner “Thu hồi máy này” trong khi không có route thu hồi máy ở server (không có `DELETE`/`revoke` trong `auth/routes.ts`, chỉ GET) và không có UI thu hồi ở web: chỉ dẫn không thực hiện được; máy mồ côi vẫn hiện “Đang dùng”, token đã mất. Chấp nhận được nếu sửa chữ thành: máy đã đăng ký, token không hiển thị được; liên hệ quản trị/ghi nhận máy mồ côi (hoặc đăng ký máy mới tên khác); thu hồi sẽ có ở S7full/server. Khuyến nghị PM quyết sửa `api.ts` (tham số `decode` trước `accept`) ở vòng sau, hoặc server cho thu hồi.

### Findings / breakage mới
- Important 1: `onboarding-state.ts` (`RESPONSE_SHAPE_INVALID` machine) và test 173–191 — chỉ dẫn “thu hồi” dựa trên chức năng không tồn tại; sửa văn bản như trên và bổ sung test không khẳng định hành động thu hồi.
- Minor 1: `held-discard.tsx` chỉ hiện khi `heldOperation` (có payload); trạng thái tombstone sau đăng xuất mà nhập lại bị `IDEMPOTENCY_CONFLICT` vẫn không có lối thoát (payload gốc mất, nhất là tên máy); bổ sung “Bỏ yêu cầu cũ” cho tombstone.
- Minor 2: `onboarding.tsx` — guard “đóng panel trước” chỉ ở trạng thái nút; handler `onSubmit` không kiểm `issued`. Trình duyệt chặn Enter khi nút disabled nên an toàn thực tế; thêm kiểm tra vào handler cho chắc.
- Minor 3: E2E `indexedDB.databases()).toEqual([])` / `caches.keys()` toEqual([]) giòn nếu tính năng khác (S7full, cache SW) dùng kho này; đổi sang “không chứa token” bằng cách đọc nội dung hoặc giới hạn theo tên kho của onboarding.
- Minor 4: `setup.tsx` `CreateProjectForm.submit` — `invalidateQueries` trong `finally` trùng với nhánh thành công (thừa); không gây lỗi.
- Không thấy breakage mới trong router/shell, `reject` khi đang `busy` (nút bị khóa), hay draft đóng băng sau 409 (draft reset sau thành công).
