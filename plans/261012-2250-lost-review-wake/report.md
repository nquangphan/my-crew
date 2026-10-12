# TPS-133 kẹt `in_review`: wake reviewer bị bỏ, không ai phát lại

- Ngày 12/10/2026, giờ Asia/Ho_Chi_Minh. Agent debugger làm; Trợ Lý ghi lại.
- Commit `3efda862b` fix(crew): replay a skipped review wake when the reaper released the lease (chưa deploy lúc ghi).

## Nguyên nhân
1. Route PATCH giao việc hủy run của executor rồi đánh thức reviewer khi lease SSH của run vẫn `active`. Stock bỏ wake (`execution_reconciliation_required`, blocker "chủ run cũ còn giữ", `recoveryActionId=null`).
2. Bình thường hook H3 (nhả lease SSH) phát lại wake. Nhưng lease đã quá 5 phút tuổi nên reaper (`sweepOrphanedActiveLeases` → `pending_cleanup` → P8) nhả nó trước; `releaseRunLeases` chỉ tìm lease `active` nên H3 không chạy.
3. Recovery stock (`reconcileStrandedAssignedIssues`) chỉ thử lại reviewer đã có run kết thúc; reviewer chưa từng chạy thì bỏ qua mãi.
- TPS-124 thoát được vì run giữ lease ~3 phút (dưới ngưỡng reaper) nên H3 chạy.

## Sửa
- `server/src/crew/handoff-rewake.ts`: `replayStrandedSkippedWakes` phát lại một lần wake mới nhất bị bỏ (tuổi 60 giây..7 ngày, agent vẫn là assignee, stage khớp, issue không done/cancelled/blocked/ẩn, chưa có wake/run mới, hết blocker). Chung đường phát lại và dấu `crew.handoff_rewake` với H3.
- Vá lõi C10 (`server/src/index.ts`, 1 dòng): gọi vòng quét ở cuối recovery định kỳ. Đăng ký trong `crew/release/core-hooks.json`.
- Test `server/src/__tests__/crew-handoff-rewake-sweep.db.test.ts`: tái hiện chuỗi TPS-133 bằng reaper thật; đỏ trước, xanh sau.
- Issue đã kẹt tự cứu ở tick đầu sau deploy (truy vấn chỉ đọc: chỉ TPS-133 khớp).

## Kiểm
- `verify.sh` FULL xanh (server crew 713/713, plugin 467, tsc sạch). ops 107/107. core-hooks 0 lỗi (10 vá lõi).

## Còn mở
- Cuộc đua lõi vẫn còn (orphan sweep lấy lease của run đã kết thúc nhưng `executeRun` chưa dọn); C10 chữa hậu quả, reviewer chậm tối đa ~60 giây + một tick.
- Log prod lúc 09:49 đã mất (container tạo lại); bước reaper suy ra từ DB.
