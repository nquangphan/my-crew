### Re-review Task 1 — fix round 1

- ✅ Finding cũ đã xử lý: runner tạo process group riêng cho `node --test`, khi nhận SIGINT/SIGTERM gửi tín hiệu cho cả group, sau 750 ms gửi SIGKILL và giới hạn thêm 750 ms chờ child; sau đó luôn đi tới nhánh dừng container ID đã ghi (`v2/server/scripts/test-db.ts:16-25,107-115,123-152`). Đường test thoát bình thường vẫn giữ exit code (`v2/server/scripts/test-db.ts:138-139`).
- ✅ Probe dùng fixture `.mjs` trong scratch và truyền `--test-file` tường minh, nên suite mặc định không nhặt test treo; runner kiểm tra đường dẫn tuyệt đối và chỉ chọn một file (`v2/server/scripts/test-db-signals.mjs:11-19,74-101,104-126`; `v2/server/scripts/test-db.ts:86-106`). Probe đọc PID/container ID do chính lượt chạy ghi và kiểm tra cả child, descendant, container sau ngắt (`v2/server/scripts/test-db-signals.mjs:132-163`).
- ✅ File probe mới đã được map vào flow và mô tả trong docs (`v2/docs/flows.yaml:36`; `v2/docs/flows/server-platform.md:11,21-22,39,52`).
- **New breakage:** Không phát hiện trong diff sửa.
- **Scoped verdict:** All addressed; không còn finding mở trong phạm vi Task 1 fix round 1.
- **Checks:** Đọc diff `d4f45b8..d0e6f85` một lượt; đối chiếu báo cáo GREEN đồng thời suite thường 13/13, ba probe SIGTERM/SIGINT/SIGSTOP, typecheck và Biome. Không chạy lại suite vì không có nghi vấn mới cần tái hiện riêng.
