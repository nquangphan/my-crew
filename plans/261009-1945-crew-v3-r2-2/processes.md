# Process R2-2

Mọi process nền, bản ghi thử trên prod (project, environment, agent, issue tạm), thư mục tạm và thay đổi môi trường của R2-2, kèm cách tắt hoặc gỡ. Cập nhật mỗi khi bật hoặc tắt. Không ghi credential.

| Việc | Lệnh / PID / id | Cổng | Worktree / thư mục | Bắt đầu | Trạng thái | Cách dừng / gỡ |
|---|---|---|---|---|---|---|
| SP-0 thư mục đo Mac | `~/crew-r22-probe/` (mẫu, script đo, ws, out) | — | Mac mini | 19:56 | đã gỡ 20:11 (số liệu chép sang scratchpad trước) | `rm -rf ~/crew-r22-probe` |
| SP-0 thư mục đo VPS | `/tmp/crew-r22-probe/` (body JSON, mẫu upload) | — | VPS nhamoiplatform | 19:57 | đã gỡ 20:11 | `ssh nhamoiplatform 'rm -rf /tmp/crew-r22-probe'` |
| SP-0 environment prod | `r22-sp0-env` `023a0e01` (TPS, dùng chung secret SSH `fa7b4847`) | — | VPS prod | 19:59 | đã gỡ 20:11: archived (secret `fa7b4847` còn) | `PATCH /environments/023a0e01… {"status":"archived"}` — KHÔNG DELETE |
| SP-0 project prod | `r22-sp0-probe` `24d2b71b` (TPS) | — | VPS prod | 19:59 | đã gỡ 20:11: DELETE 500 (FK `cost_events_project_id_projects_id_fk`) → archive (`archivedAt` 13:11:16Z) | `PATCH /projects/24d2b71b… {"archivedAt":…}` |
| SP-0 agent prod | `r22-sp0-probe` `f06f9096` claude_local (TPS, env `023a0e01`) | — | VPS prod | 19:59 | đã gỡ 20:10: pause → DELETE 500 (FK `cost_events_heartbeat_run_id_heartbeat_runs_id_fk`) → `terminate` (status `terminated`, không chạy được nữa) | `POST /agents/f06f9096…/terminate` |
| SP-0 issue cha prod | TPS-78 `e01d3613` (project `24d2b71b`) | — | VPS prod | 20:00 | đã gỡ 20:10 (GET 404) | `DELETE /issues/e01d3613…` |
| SP-0 issue con prod | TPS-79 `3f76aeeb` (cha `e01d3613`) + attachment | — | VPS prod | 20:00 | đã gỡ 20:10 (GET 404, kèm 5 attachment) | `DELETE /issues/3f76aeeb…` |
| SP-0 run đo | run `566b599b` của agent `f06f9096` trên TPS-79; poll nền bhgf60cx7 (Mac, 20 s, ≤ 18 phút) | — | scratchpad | 20:00 | đã xong 20:09 (5 run trên issue, 0 active) | tự thoát khi run xong; kẹt > 15 phút thì `POST /heartbeat-runs/566b599b…/cancel` |
| AC-R2-2 thư mục tạm VPS | `/tmp/crew-ac-r22.0zIss9/` (body issue, script upload, 13 file fixture) | — | VPS nhamoiplatform | 00:43 | đã gỡ 00:48 | `ssh nhamoiplatform 'rm -rf /tmp/crew-ac-r22.0zIss9'` |
| AC-R2-2 issue lượt 1 | TPS-80 `a79f0acb` project Spike Mac (repo-a), giao tro-ly; run 9066ea07 (tro-ly) + 2056fad2 (reviewer, ngoài dự kiến) | — | VPS prod | 00:43 | cancelled 00:46 (giữ issue cho lượt 2, assignee hiện là reviewer 946f1a73) | `PATCH /issues/<id> {"status":"cancelled"}` |
| AC-R2-2 run/blob giả TTL (AC9) | `runs/00000000-0000-4000-8000-0000000ac9a0` + 1 blob giả trong `~/.crew/cache/attachments` | — | Mac mini | 00:48 | đã gỡ 00:48 bởi `crew-mac files --gc-only` | — |
