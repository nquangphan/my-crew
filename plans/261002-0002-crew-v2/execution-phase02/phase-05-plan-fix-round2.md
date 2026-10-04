# Phase05 — plan fix round2

Ngày: 2026-10-02. Planner **READY cho re-review R1/R2**; chưa freeze, chưa triển khai hoặc xác nhận test PASS. Chỉ sửa owned phase05 plan/research và report này; không source/install/commit hoặc hợp đồng frozen phase04.

| Finding | Sửa trong plan | Producer → consumer và acceptance |
|---|---|---|
| P1-R1 legacy comment revision | S2/R1 chọn một BEFORE INSERT trigger additive009 cho bảng comments; Task2 giữ public appendComment signature/004. Counter riêng, bỏ event-cursor revision prose. | Actual legacy appendComment và attachment method đều INSERT cùng Tx; trigger tăng counter của target + descendants vì child snapshot chứa ancestor comments. Lock journal→root→affected targets→project nếu cần→input rows→compose; claim giữ lock order root/target hiện có. Wrapper không double bump; event consumer chỉ wake. Actual-service snapshot→comment→claim và stale Assistant reply; barrier cả hai thứ tự; ancestor/child/sibling/new-child; attachment comment/replay exactly-once; rollback comment/link/event/counter. |
| P2-R2 source OFF admitted turn | S3/R2 thêm immutable AssistantTurnAdmission + stored session fields, tách fresh admission gate với assertSessionCurrent. | OFF trước admission→wait/deny; admission trước OFF→exact session/receipt/reply tiếp tục nếu authority còn valid, replay không thêm lượt hoặc gia hạn. New selection/session/turn/fallback từ OFF denied; revoke/pause/cancel/designation/input/route/security/expiry vẫn chặn theo stop protocol. Task3/6 tests và actual phase06 authority/driver integration gate/handoff cập nhật. |

Self-review producer/consumer matrix đã thêm trigger009→legacy/wrapper→snapshot/claim/reply và admission→session validity/new-start gates. Snapshot canonical metadata có ordered inherited comment IDs/body hashes cùng inputRevision; event không chứa text. Scope descendants được xác định dưới root lock, sibling không bị bump bởi comment ở nhánh khác. Replay event không đóng vai revision writer.

Xác minh ở mức tài liệu: đọc toàn bộ re-review, đối chiếu actual legacy producer/mutator/claim lock order, scan prose counter/config/replay/ownership, kiểm fences và git diff whitespace. Không chạy DB/test/runtime hay đổi pin dependency; các ca RED/GREEN và actual phase06 integration vẫn là gate triển khai, không được gọi PASS từ report này.
