# Báo cáo RO-1 — instructions vai trò và script áp vai trò

- Worktree `.worktrees/paperclip-r12-roles`, nhánh `crew/r12-roles` từ `v3`.
- SHA: `99b49c7c0eb24a8e2f1d15a5306f12a353d5e535`.

## File (đều trong `crew/agents/`)

`executor.md`, `reviewer.md`, `integrator.md`, `merge-agent-config.mjs` + `.test.mjs`, `policy-config.mjs` + `.test.mjs`, `apply-roles.sh`.

## Kiểm

```
$ node --test crew/agents/merge-agent-config.test.mjs crew/agents/policy-config.test.mjs
(RED trước khi có module: cả hai file test fail)   sau đó: ℹ tests 9 / ℹ pass 9 / ℹ fail 0
$ bash -n crew/agents/apply-roles.sh        # sạch (shellcheck không cài)
$ apply-roles.sh policy-config <c1> <uuid> <uuid> o file   # chạy hai lần: gộp hai company vào cùng file, không để file tạm
$ apply-roles.sh policy-config x 1 2 3     # rc=2 "reviewerAgentId phải là uuid"
```

## Nội dung chính

- Executor: TDD/debugging/verification của Superpowers, test theo tầng task, dòng `crew-commit …`, comment retry `Crew: lần chạy lại sau run …`, wrapper thoát 78 (dọn/commit file sửa dở trong `.claude/` theo lệnh in ra), `blocked` thay `cancelled`, bảng mã lỗi `crew_gate_blocked`, `crew_policy_locked`, `crew_agent_root_issue`, `crew_role_assignee`, `crew_roles_unconfigured`.
- Reviewer: đọc diff + log `crew-commit`, không chạy lại suite, quyết định trong một PATCH có comment, tối đa 5 vòng.
- Integrator: merge vào `crew/req/<id>` từ `origin/<mặc định>`, `crew-docs check --range` qua `git config crew-docs.bundle`, bằng chứng dòng đầu đúng regex (E=0/3 qua, E=1 sửa, E=2 `blocked`), xử lý `docs_missing/stale/failed`.

## Giả định

- Cú pháp `api.sh <METHOD> <path> "<body>"` lấy từ lệnh R1-1 đã chạy (không SSH). Chưa chạy `apply-roles.sh agent` thật (cần VPS).
- VPS có `node`; thiếu thì script thoát 2.
- `adapterConfig.extraArgs` cũ được thay cờ `--setting-sources`/`--plugin-dir` (cả dạng `=`), cờ khác giữ nguyên.

## Lệch plan

- O8: không PATCH `metadata.crewRole`; `mergeAgentConfig(agent, pinDir)` chỉ trả `adapterConfig`; thêm `policy-config.mjs` và lệnh con `apply-roles.sh policy-config`. Chi tiết trong ledger.
- Bỏ Step 1 (SSH đọc `api.sh`) và nhánh `docker exec` (xem ledger).
- Instructions integrator dùng `origin/<mặc định>` làm gốc (plan dùng nhánh mặc định cục bộ, có thể cũ).
- `{"status":"blocked"}` cho executor/reviewer/integrator muốn bỏ việc (O7).

## Sửa sau review

SHA `4f9dfc5f75f47163148774654b73861415a2d109` (một commit cho cả RO-1 và RO-2). Test: `node --test crew/agents/*.test.mjs` → pass 26, fail 0; `bash -n apply-roles.sh` sạch; chạy `apply-roles.sh` với `api.sh` giả: agent hợp lệ rc=0, thân lỗi `{"error":"Unauthorized"}` rc=2 không ghi gì, PATCH trả `{"error":"Forbidden"}` rc=2, pin có `..` rc=2, hai lần `policy-config` ghi cùng file giữ cả hai company và để lại `.bak`.

- M2: reviewer approve ghi dòng đầu `crew-review sha=<40 hex> verdict=approved` (SHA phải trùng `crew-commit` mới nhất); xem RO-2.
- M4: `mergeAgentConfig` từ chối đầu vào không có `id`, không có `adapterConfig.command`, hoặc có `***REDACTED***` ngoài `env`; `apply-roles.sh` kiểm kết quả PATCH (`extraArgs` trả về phải bằng kỳ vọng) và PUT (JSON, không `error`) bằng `verify-result.mjs`, lỗi thì thoát 2. Giả định: PUT trả JSON object; nếu thật sự trả thân rỗng thì AC-2 sẽ thấy lỗi và cần nới `checkWriteResult`.
- M5: `executor.md` bỏ hướng dẫn thoát 78, thay bằng quy tắc `git status --porcelain --ignored -- .claude .mcp.json` phải sạch trước khi báo xong, kèm một dòng "thấy `crew-workflow blocked/warn` thì làm đúng lệnh được in".
- m1 (chữ header `policy-config.mjs`/`apply-roles.sh`: stdout chỉ một company, không cần restart), m2 (`.bak`, kiểm JSON không rỗng trước khi ghi, `flock` nếu có), m4 (`origin/HEAD` + `git remote set-head origin -a` cho integrator; executor/reviewer dùng `origin/HEAD` sau `git fetch origin`), m6 (retry: bỏ commit không thuộc issue, "danh sách bị cắt" → `git log --branches HEAD`), m9 (từ chối `.`/`..` ở pin và chuỗi bị che), m3 (một cách gọi `node "$(git config --get crew-docs.bundle)"`, `--no-edit`, E=2 kiểm `test -f`), m5 (vế phải của range), m7 (thêm test: `blocked` không `cancelled`, mọi PATCH có comment, `--no-verify` chỉ trong câu cấm, thứ tự xác minh trước push, không URL remote, executor không nêu 78).

Minor bỏ qua:
- m7 phần "regex server sao chép vào test": nhánh `crew/r12-roles` không có `issue-policy.ts` (nằm ở nhánh policy), nên import regex thật là phụ thuộc chéo gói; test giữ regex sao chép và AC-2 Cổng 2d đối chiếu thật.
- m10 (tách `integrator-merge.md`): `apply-roles.sh` chỉ upload một `AGENTS.md` mỗi agent; tách file cần đổi script và API bundle. Thay vào đó rút mục merge về 6 bước.

## Cho runbook của lead: wrapper thoát 78

Wrapper `crew-claude-run` thoát 78 trước khi chạy `claude`, nên agent không đọc được thông báo; chỉ owner/Trợ Lý đọc log run hoặc comment hệ thống mới thấy. Phạm vi thật (theo SP-3): chặn 78 với `settings*.json`, script hook và `.mcp.json` sửa dở, mọi nguồn chưa track hoặc bị ignore, symlink ra ngoài worktree, git quá hạn; `SKILL.md` và `.claude/agents|commands` sửa dở chỉ `warn` (thoát 0, dòng `crew-workflow warn:`). Xử lý: vào worktree của agent (`~/crew-agents/<tên>`), chạy `git status --porcelain --ignored -- .claude .mcp.json`, commit hoặc hoàn tác từng file được thông báo in ra, rồi retry run. Kênh đưa thông báo 78 tới owner thuộc gói runtime, không thuộc instructions.
