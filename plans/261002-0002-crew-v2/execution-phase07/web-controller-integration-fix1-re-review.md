# Re-review vòng sửa 1: web controller integration (2b101ec..30a1d54)

Đọc diff một lần, đối chiếu `closeOwnedResource`/`deadlineMs` trong `e2e/support/fixture.ts` và `pm-ledger.md:174`; không chạy lại test.

## Verdict

| Mục | Verdict | Căn cứ |
|---|---|---|
| I1 | ADDRESSED (còn dư chấp nhận được, xem dưới) | `test/attachment-receivers.test.ts`: upload thật qua API, receiver `closed` có `stop_proof`, nhánh `fixture-only` đúng theo nền tảng; port chạy trực tiếp register → run → closeAndAcknowledge → proveStopped, gồm `proveStopped=null` trước khi đóng, đóng lặp trả đúng proof, run lần hai bị từ chối |
| M1 | ADDRESSED | `closeScratches` + test với `stat` trì hoãn và `deadlineMs:200`: hai UNKNOWN (`REMOVE_DEADLINE`, `PREVIOUS_CLEANUP_UNKNOWN`), `rmCalls===0` sau khi nhả, registry và storage còn |
| M2 | ADDRESSED | `createAttachmentScratch` xóa đúng thư mục vừa tạo khi `realpath`/`stat` lỗi (có test). Đoạn sau đó (assign biến trước `record`) đã được `cleanup()` phủ vì nó đọc biến, không đọc danh sách đã ghi |
| M3 | ADDRESSED | Test vacuous bị xóa, docs nêu rõ chỉ E2E kiểm đường đó |
| M4 | ADDRESSED | Assert đích danh `GET /v2/projects` sau catch-up (poll rồi so chỉ số). Điều kiện `> afterLogin.indexOf('GET /v2/events')` thừa với `> 0` nhưng vô hại |
| M5 | ADDRESSED | Bỏ `.toLowerCase()`; `FIXTURE_UPLOAD_NOT_FOUND` thay cho `String(undefined)` |
| Câu ruling expire/logout trong docs | ADDRESSED | Khớp `pm-ledger.md:174` ("session.expire() giữ nháp ... chỉ logout() xóa"); và `session.ts` chỉ gọi hook trong `logout()` |

## I1: đủ chưa

Đủ cho mức I1 yêu cầu (port không còn "chưa test", không còn chỉ nằm im trên macOS): trên macOS cả hai tầng chạy trên port; trên Linux upload đi native còn port vẫn được chạy trực tiếp, nên hai nền tảng cùng khẳng định được giao thức. Phần dư: (a) bản sao vẫn tồn tại, nên drift vẫn có thể xảy ra, chỉ là hiện có test bắt khi hợp đồng `ManagedReceiverRegistry` đổi kiểu; (b) `requestAbort` và đường `abort` trong `run` chưa được test; (c) test API-level trên Linux không chứng minh port, chỉ test trực tiếp mới chứng minh. Đề xuất ghi một dòng ledger: chuyển export dùng chung khi phase server cho phép export `fixtureReceiverRegistry`. Không chặn.

## E2E sau lần sửa cuối `e2e-fixture.ts`

Rủi ro thấp. Thay đổi là tách logic, `readStartIdentity` vẫn dùng `stat` thật (đúng, vì nếu đi qua `removal.stat` bị trì hoãn thì test M1 sẽ đổi lý do UNKNOWN) và `remove` vẫn là `createScratchRemoval` có fence `signal.aborted`. Đường production `closeScratches` được chạy thật bởi mọi test `withFixture` (lifecycle 6, `attachment-receivers.test.ts`) và mỗi worker E2E khi đóng. Chỉ cần chắc rằng bộ unit 226/226 chạy sau commit fix cuối. Nếu không chắc: chạy lại `fixture-lifecycle.test.ts` (đã assert `removed` của attachment scratch) và `e2e/app-router.spec.ts` (spec duy nhất đổi, kèm assert `/v2/projects` mới). Các spec E2E khác không bị đụng bởi diff này.

## Breakage mới

- Minor B1 `test/attachment-receivers.test.ts`: file test mới dựng thêm một fixture đầy đủ (PG container + Vite). `node --test test/*.test.ts` chạy file song song, nên cùng lúc có ít nhất hai fixture (với `fixture-lifecycle.test.ts`); đối với quy tắc "sole heavy slot" và máy yếu có thể gây timeout/nghẽn. Fix: chạy với `--test-concurrency=1` cho các file dùng `withFixture`, hoặc ghi chú trong docs/lệnh chạy.
- Minor B2 `test/attachment-receivers.test.ts`: `Record<string, any>` có thể bị Biome `noExplicitAny` chặn; fix report không nêu kết quả Biome cho vòng này. Fix: kiểu hẹp (`{ id: string; revision: number; attachment: { attachmentId: string } }`) hoặc chạy Biome xác nhận.
- Minor B3 `v2/docs/flows/web-shell.md` mục 4: viết "chỉ import từ `e2e-fixture.ts`", nhưng `test/attachment-receivers.test.ts` cũng import port. Sửa thành "không entrypoint production nào import; chỉ fixture và test của nó".
- Minor B4 `test/attachment-receivers.test.ts`: port dựng trực tiếp ghi thêm một dòng `attachment_server_writers` với `storageHostId` ngẫu nhiên khác host của fixture trong DB riêng của fixture. Vô hại (DB bị hủy), chỉ ghi nhận để không ai dùng mẫu này trên DB dùng chung.
- Không thấy breakage chức năng hay vi phạm bất biến harness mới.

**Task quality:** Approved (kèm B1–B3 là Minor, nên sửa khi tiện)
