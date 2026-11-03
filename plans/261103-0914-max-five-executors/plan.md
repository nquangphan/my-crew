# Nâng tối đa 5 executor mỗi project

Trạng thái: code xong, đã test, chưa commit/deploy · 03/11/2026

## Mục tiêu

- Một project có từ 1 đến 5 executor Claude (trước đây 1–2).
- Wizard thêm project (web và app Mac) cho chọn 1–5, mặc định vẫn là 1.
- Tab Vai trò hiện nút "Thêm executor" cho tới khi đủ 5; nút mở wizard tạo agent ở ô kế tiếp (`executor-N`).
- Project đang có giữ nguyên. Đại Ca tự thêm executor khi cần.

Ngoài phạm vi: tự thêm executor cho project cũ; đổi cách Trợ Lý chia việc; giới hạn số run song song trên máy.

## Quyết định

- Ô vai trò: `executor`, `executor-2` … `executor-5` (web), thư mục `executor-1` … `executor-5` (app Mac), giữ đúng
  cách đặt tên hiện có.
- Một hằng `MAX_EXECUTORS = 5` mỗi package, không viết số rải rác.
- `MAX_ENSURE_ROLES` lấy theo `CREW_ROLE_SLOTS.length` (11 ô) ở plugin và app Mac.

## Phase 1: fork Paperclip (`/Volumes/CORSAIR/Projects/2p-crew/wt-five-executors`, nhánh `crew/max-five-executors`)

- Migration `0024_max_five_executors.sql`: đổi CHECK `cardinality(executor_agent_ids)` thành 1–5.
- `crew-plugin`: `jobs/types.ts` thêm ô; `jobs/validate.ts` (prepare-checkouts 4–8 ô, ensure-project theo số ô);
  `roles/api.ts` (1–5, nhãn ô `executor-N`); `setup/api.ts` + `setup/types.ts` (executors 1–5).
- `crew-web`: `agent-config.ts` (ô, template, model role, agentOfSlot), `add-agent/run-step.ts` (withSlot),
  `add-project/*` (steps, validate, form select 1–5), `projects/detail/roles-form.tsx` + `roles-tab.tsx` (5 ô, nút
  thêm executor kế tiếp), `remove/eligibility.ts` (chú thích), `api/crew/types.ts`, locales vi/en.
- Test liên quan, docs flows (`crew-docs check`).

## Phase 2: repo `crew` (app Mac)

- `apps/mac-app/src/main/jobs/types.ts`, `validate.ts`: thêm ô, giới hạn như plugin.
- `main/projects/progress.ts`, `add-project.ts`, `shared/ipc-contract.ts`, `renderer/routes/projects.tsx`: 1–5.
- Test liên quan, docs flows.

## Thứ tự triển khai

App Mac phải lên bản mới trước khi server xếp việc có ô `executor-3`+, nếu không app từ chối việc ("role không hợp
lệ"). Không push/deploy khi Đại Ca chưa bảo.

## Nghiệm thu

- Typecheck + test các package đã sửa đều qua.
- Lưu vai trò với 5 executor qua API được; 6 bị từ chối.
- Wizard thêm project chọn 5 tạo đủ 5 ô.
