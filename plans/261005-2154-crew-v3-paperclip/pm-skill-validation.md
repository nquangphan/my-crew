# Kiểm chứng skill tro-ly-pm

Ngày 05/10/2026, Asia/Saigon. Skill: [tro-ly-pm](../../.agents/skills/tro-ly-pm/SKILL.md).

## Baseline trước viết skill

Agent `pm_skill_baseline`, `gpt-6-luna` medium, context rỗng; không tools/mutations. Hai pressure scenarios:

1. Bốn gateway task chung context, hai docs task disjoint, RAM sample cũ, heavy test, bốn seats, quota1.2%/reserve1%. Baseline biết serialize/reuse/review nhưng không tính admission/score/model cụ thể; khi chạm ngưỡng chỉ đề xuất safe checkpoint, chưa phân biệt hoàn tất task đã nhận với admission mới.
2. Registry install/pin/retention, UI/docs nhẹ; free3GiB so với test peak4GiB; quota1.05% không có cost estimate. Baseline không admit thêm là đúng, nhưng chấm thang1–5 không có rubric và chọn “most capable available” cho cả registry mà không exact model ID/allowlist. Đây là lỗi routing/độ khó dùng để viết skill, không khẳng định baseline vi phạm mọi yêu cầu.

## Forward test

Giao reviewer độc lập đọc skill và giải tình huống mới, không cho expected answer. Kiểm observable decisions: giữ worker context qua review gate, exact score/model, fresh resource admission, shared mutation serialize, quota reserve mới nhất, 5-round stop, ownership cleanup. Kết quả: [review](pm-skill-review.md) phát hiện2P1/2P2; sau sửa hẹp scoped review4/4ADDRESSED, spec/quality PASS. Bổ sung trách nhiệm ticket status theo owner được review riêng,0 findings.

Validator lần đầu lỗi `ModuleNotFoundError: yaml` trên system Python; chạy nguyên script với uv runtime sẵn có chứa PyYAML thành công. Không sửa validator hoặc cài dependency mới. Đây là static + behavioral simulation, chưa runtime/E2E.

Static validator chưa là behavioral PASS. Không dùng dry scenario như bằng chứng Paperclip integration hoặc nghiệm thu v3.
