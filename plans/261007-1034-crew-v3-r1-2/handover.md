# Bàn giao Crew v3 — sau R1-2

Viết 07/10/2026 (Asia/Ho_Chi_Minh). Đọc kèm [handover R1-1](../261006-1355-crew-v3-r1-1/handover.md) (môi trường, bẫy, cách làm việc của owner vẫn đúng).

## Đang ở đâu

- R1-1 và **R1-2 xong**. Còn R1-3 Trợ Lý, R1-4 UI, R1-5 nâng upstream và phát hành ([plan stock-first, Phần 2](../261006-0805-crew-v3-stock-first/plan.md)).
- Repo Crew làm việc trên Mac mini: `~/Documents/projects/crew` (nhánh `v3`). Fork: `.worktrees/paperclip-v3` (nhánh `v3`). Các worktree gói `.worktrees/paperclip-r12-*` và `.worktrees/crew-r12-mac` có thể gỡ khi không cần.
- Skill `tro-ly` gắn ở `~/.claude/skills/tro-ly` (symlink); sanctum `.agents/memory/tro-ly/` dựng lại 07/10 trên Mac mini.

## Hợp đồng R1-3 dùng lại (đã nghiệm thu)

- Issue gốc do owner/board tạo nhận template **4 stage**: reviewer → integrator (merge + `crew-docs check`) → owner duyệt → integrator push. Issue con agent tạo (`parentId`) nhận template con (1 stage reviewer, 5 vòng); gửi `executionPolicy` gì cũng bị thay (H4).
- Vai trò lấy từ `/opt/crew-v3-spike/crew-policy/crew-policy.json` (mount `:ro`, env `CREW_POLICY_CONFIG`); sinh bằng `crew/agents/apply-roles.sh policy-config`, rồi `docker compose restart server`. Company vắng trong file chạy như Paperclip gốc.
- Agent không được: tạo issue gốc, giao issue cho reviewer/integrator, chuyển `cancelled`, sửa `executionPolicy`. Mở lại issue `done` → H2 tự giao lại `returnAssignee`.
- Instructions vai trò: fork `crew/agents/{executor,reviewer,integrator}.md`; áp bằng `apply-roles.sh agent <agentId> <role> <pinDir>`. Dòng giao tiếp: `crew-commit`, `crew-review`, `crew-fix base=`, `crew-docs-check`, `crew-merge`.
- Agent thật chạy sonnet (O10). Trên spike: agent `mac-claude` (executor), `reviewer`, `integrator`, mỗi agent một environment SSH riêng (`mac-mini`, `mac-mini-reviewer`, `mac-mini-integrator`) vì Paperclip không có cwd riêng theo agent.

## Việc tiếp theo

1. Lập plan R1-3 (Trợ Lý tách yêu cầu thành issue con qua API, gom theo gói ngữ cảnh, dùng chung session theo cách S4 Step 6). Hỏi owner trước khi bắt đầu.
2. Việc treo: `forbiddenRootReason` của `crew-mac` chưa chặn `~/Documents`; `pnpm lint` đỏ trên file có sẵn (`.codex/hooks`, `.agents/skills`); test `crew-remote-stop` có dấu hiệu flaky khi chạy chung nặng; R2: hook pre-receive phía remote để chặn push chưa xác minh.
3. Dọn khi owner đồng ý: company "Crew Spike Policy" trong `crew-policy.json`, repo thử `~/crew-spike`, worktree `~/crew-agents/mac-claude` đang bẩn, image spike cũ trên VPS (giữ `v3-9ccdb83e0` làm đích rollback).
