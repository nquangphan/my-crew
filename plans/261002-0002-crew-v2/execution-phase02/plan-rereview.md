# Phase 02 — scoped plan re-review round 1

Ngày: 2026-10-02. **Verdict: APPROVED trong phạm vi re-review; không còn Critical/Important từ các finding được giao.** Hai ghi chú Minor dưới đây cần đồng bộ trong ví dụ test trước khi worker chép vào source.

Bản đã đọc: `phase02-r2-2026-10-02`, `phase-02-server-docs.md`, 727 dòng, SHA256 `58a18a4a7eb8052398b0f66effcacc4a26259f8195b80e082cf0ad9ab81e0417`. Đã đọc `plan-fix-report.md` và các đoạn thay đổi liên quan I1/I2/I3/M1 cùng event scope bootstrap. Không chạy lại suite, kiểm tra source triển khai, Git hoặc DB. Đây là duyệt hợp đồng kế hoạch, không phải xác nhận tính năng đã chạy.

## Adjudication

| Finding | Kết luận | Bằng chứng trong plan đã đóng băng |
|---|---|---|
| I1 — stop làm mất đường completion/needs_input | Addressed | 170, 367–391, 394–443, 488: trạng thái finalizing giữ guard và ticket running; terminal intent/result/stop được lưu riêng; finalize áp dụng đúng signal và release guard cùng transaction. Late evidence có attestation và recheck bằng key mới. Pause/cancel/wait_owner/fifth failure có ưu tiên rõ. 312–314 cũng đã mở rộng binding guard để giữ finalizing. |
| I2 — docs migration vượt dependency | Addressed | 71, 173–179, 527: chỉ unit validator song song; tạo/apply006 và DB tests sau gate005. Fixture ghim migration prefix1..N và snapshot SQL bất biến thay vì quét thư mục động. |
| I3 — mixed docs/artifact bị một nhãn | Addressed | 171, 502–523, 525, 574–603, 611, 631–633: class theo từng file, aggregate mixed; class thuộc hash/backup provenance; known workflow paths có rule bắt buộc; search/page/tree lấy nhãn per-page và completion chỉ nhận required implemented pages đã verified. Byte/path gốc được giữ. |
| M1 — nhiều fragment cùng đích bị đè | Addressed | 171, 514, 572, 594–603: PK theo occurrence, giữ originalHref/fragment và audit từng occurrence, kể cả link lặp; có DB roundtrip/rerun test. |
| Controller — Task2 query projects trước schema003 | Addressed | 118, 234: EventScopeReader explicit; ownerOnlyEventScope không đọc projects; projectEventScope/schema003 và machine integration được hoãn đúng dependency. |

Đã rà tác động mới quanh finalizing, partial unique, binding guard, result replay, terminal intent, mixed snapshot completion và migration fixture. Không thấy lỗi Important mới trong phạm vi này. Giữ production dispatch/verifier fail-closed và ranh giới host/runtime/dispatch/merge thuộc các phase sau.

## Minor — đồng bộ ví dụ kiểm thử

1. **Plan:246,252:** hai lời gọi `readEvents(db,c.actor,'0',50)` trong snippet vẫn thiếu tham số thứ năm `ownerOnlyEventScope`, dù signature ở118 và chỉ dẫn ở234 đã yêu cầu. Thêm tham số để snippet typecheck và không khuyến khích worker thêm default scope ngầm.
2. **Plan:590–592:** negative test sửa `contentClass` sau khi `legacyBundle` tính checksum, rồi đòi `CONTENT_CLASS_MISMATCH`. Class nay nằm trong snapshot/bundle hash ở525, nên payload cũng sai checksum và có thể bị từ chối bằng `CHECKSUM_MISMATCH` trước khi chạm rule class. Tạo bundle có class sai nhưng các digest đã tính lại, hoặc kiểm tra class trực tiếp bằng unit test; giữ nguyên checksum-negative test riêng. Mục đích là test đúng classification rule, không áp đặt thứ tự validation ngoài hợp đồng.

Các Minor trên không đổi kiến trúc hay approval scope. Controller có thể chuyển task consumers sang triển khai theo kế hoạch và đưa hai chỉnh sửa mẫu test vào handoff; vẫn cần review/test từng task như kế hoạch đã yêu cầu.
