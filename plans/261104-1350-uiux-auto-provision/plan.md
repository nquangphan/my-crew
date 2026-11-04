---
title: "Tự tạo agent UIUX khi thêm project"
status: code-done
created: 2026-11-04
---

# Tự tạo agent UIUX khi thêm project

## Vấn đề

Wizard thêm project của crew-web (fork) và luồng thêm project của app Mac chỉ tạo Trợ Lý, executor, reviewer,
integrator. Agent UIUX (vai `designer`) phải tạo tay bằng script ops, nên project mới (my-crew, news) thiếu và Trợ Lý ghi
"Không có agent UIUX". Ngày 04/11 đã bổ sung tay cho hai project đó.

## Kết quả mong muốn

Thêm project bằng wizard web hay bằng app Mac thì có luôn agent UIUX của project, Trợ Lý của project có agent đó trong
mục "Agent UIUX của company", máy khác dựng được checkout UIUX (server đã lo từ `08f540666`).

## Quy ước chung (cả hai đường)

- Chỉ tạo khi company có skill công ty `ui-ux-pro-max` (key kết thúc bằng `/ui-ux-pro-max`, ví dụ
  `local/264a2248bd/ui-ux-pro-max`). Không có skill thì bỏ qua UIUX, làm như cũ (mục UIUX "Không có").
- Checkout `~/crew-agents/<khóa>/designer` (tên thư mục `designer`, như agent tạo tay). Server nhận agent UIUX của project
  khi checkout mặc định nằm dưới `~/crew-agents/<khóa>/` và có skill `ui-ux-pro-max`.
- Environment `<khóa>-designer`, cùng khuôn SSH với các ô khác.
- Agent tên `UIUX <khóa>`, `claude_local`, ghim Superpowers như executor, model `roles.designer` của bảng model (mặc định
  `claude-opus-5-5`), quyền không tạo agent, không tạo skill, không giao việc.
- Gắn skill: `POST /api/agents/:id/skills/sync {"mode":"replace","desiredSkills":["<key>"]}`.
- AGENTS.md: template `designer.md`. AGENTS.md của Trợ Lý render kèm danh sách UIUX `[designerId]`.
- Không thêm `designer` vào dòng vai trò (`crew_project_roles`).

## Làn

- **Fork (`wt-uiux-wizard`, nhánh `crew/uiux-wizard`):** wizard `add-project/run-step.ts` thêm UIUX trong các bước
  `checkouts` (việc `agent-workspace` role `designer`), `environments`, `agents`; plugin `jobs/validate.ts` và kiểu
  `agent-workspace` nhận role `designer`. Docs `setup-wizards.md`, `machine-jobs.md`.
- **Repo crew (`apps/mac-app`):** `jobs/validate.ts` nhận `agent-workspace` role `designer` (máy chạy việc của wizard
  web); `projects/add-project.ts` tạo UIUX như trên; `projects/instructions.ts` có template designer và render danh sách UIUX.

## Thứ tự deploy

App Mac mới phải cài trên mọi máy trước khi deploy fork: app cũ từ chối việc `agent-workspace` role `designer`, bước
`checkouts` của wizard sẽ lỗi.

## Nghiệm thu

- Test đơn vị của wizard và app cho đường có skill và không có skill, chạy tiếp không tạo trùng.
- Typecheck, lint các package bị chạm.
