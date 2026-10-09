# Process, thư mục tạm và bản ghi tạm của R2-5

Mỗi dòng: thời điểm (`date`), ticket, thứ đã tạo (lệnh/PID/cổng/worktree/thư mục/id bản ghi prod), cách dừng hoặc gỡ, trạng thái (`đang chạy` | `đã gỡ` | `giữ: <lý do>`). Không để dòng `đang chạy` khi ticket đã xong. Không ghi credential.

| Thời điểm | Ticket | Thứ đã tạo | Cách dừng/gỡ | Trạng thái |
|---|---|---|---|---|
| 2026-10-10 01:23 | SP-0 | File SQL/out trong scratchpad r25sp0/ (không có process nền) | rm -r thư mục | đã gỡ |
| 2026-10-10 02:26 | DP-1 | scratchpad: r25-dp1-test.log, r25-dp1-verify.log, drill.log, deploy.log, doctor.log, vps.txt, *.sql (SELECT); gói crew-mac-r25/ (đã rm -r); không process nền | rm thư mục scratchpad | gói đã gỡ; log giữ trong scratchpad phiên |
| 2026-10-10 02:26 | DP-1 | VPS: image crew-v3/paperclip:v3-365cabdb7, backup 20261010-0221 và 20261010-0223, docker-compose.yml.bak-20261010-022307; Mac: ~/.crew/app/crew-mac.prev (bản R2-3) | rollback.sh 20261010-022307 / mv crew-mac.prev | giữ: mốc rollback |
| 2026-10-10 02:36 | AC-R2-5 | VPS backup 20261010-0235 (trước khi tạo bản ghi thử); scratchpad pw/ (Playwright 1.60.0, state.json phiên đăng nhập, ảnh thử) | scratchpad: rm state.json sau khi đăng xuất; backup giữ | giữ: mốc backup |
| 2026-10-10 02:37 | AC-R2-5 | Prod: project thử r25-ac 7bc15668-7da2-4874-9a1d-34dd22e85183 và r25-ac-b f2db2c0d-8d70-4f88-8ff8-eacdd1730e25 (company TPS, không agent/issue/run). Mac: ~/crew-r25-ac/{origin.git,repo,repo-b}; dòng status-repos.json cho 2 project thử | status remove-repo 2 project; DELETE project; rm -r ~/crew-r25-ac (không -f) | đã gỡ 02:40 (repo, bare, status-repos, 2 project đã DELETE) |
| 2026-10-10 02:40 | AC-R2-5 | Docs của project thử còn trong DB (không tự xóa lịch sử): snapshot 6b87f98a-b11d-474a-aa2b-ea8250f925ee, 507758d5-e825-4ca1-a1c7-10d4c957c089, d2881602-cd70-429e-a41c-72abf709133b (project 7bc15668…), 8ce4a23d-1bff-4f0d-8560-7f17fe93cbc0, e1bd9ce4-8b8a-4977-91cc-f48be99fd4c7 (project f2db2c0d…); docs_blobs 13→25 | không xóa | giữ: lịch sử docs |
