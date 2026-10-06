# Báo cáo spike Crew v3 stock-first

Ngày chạy: 06/10/2026, khoảng 09:50–13:40 (Asia/Ho_Chi_Minh). Chi tiết từng ticket ở các file `spike-*.md` cùng thư mục; file này chỉ gom kết luận.

Môi trường: Paperclip `v2026.1001.0` (pin `8f8a0ab7e`) chạy trên VPS `nhamoiplatform` trong compose project riêng `crew-v3-spike`, chỉ mở qua Tailscale. Máy chạy agent là Mac mini (`phans-mac-mini`), Claude Code 2.1.289 dùng đăng nhập sẵn có trong Keychain qua một sshd riêng chạy trong phiên desktop (cổng 2222).

## Kết luận đề xuất

**Go có điều kiện.** Không điểm nào trong S2, S3, S4 cần vá sâu vào `heartbeat.ts` hay `issues.ts`, và diễn tập nâng upstream chỉ vướng một file test. Nhưng S3 chưa đạt: agent trên Mac không bị dừng khi mất mạng, restart hay hủy run. Chỗ sửa đã biết nằm trong SSH driver, nhưng mới có điểm cắm no-op, chưa chứng minh bằng chạy thật. Vì vậy việc đầu tiên của R1 phải là làm thật phần dừng process và chạy lại S3.

## Bảng kết quả

| Ticket | Kết quả | Bằng chứng chính | Chỗ đụng lõi |
|---|---|---|---|
| S1 dựng Paperclip, nối Mac | Đạt | Image upstream đúng commit pin, probe SSH tới Mac mini pass | 0 |
| S2 chạy issue thật trên repo Mac | Đạt khi có vá. Stock: kết luận (c) | CRE-3: commit `a59fe54` trong worktree riêng của agent, checkout của owner và `owner-wip.txt` nguyên, không upload workspace, VPS không có credential | Vá `claude_local` + SSH driver cho `in_place` |
| S2c resume session | Đạt khi có vá | CRE-4: lượt 2 và 3 giữ session `96e8b834` | Vá `sessionCodec` của `claude_local` (bug upstream) |
| S3 mất mạng, restart, hủy run | **Không đạt** Review Focus 1 | Không run nào báo thành công sai, nhưng process `claude` trên Mac sống tiếp: sau restart ra 2 commit trùng, sau cancel vẫn commit, issue kẹt `in_progress`. Nguyên nhân: `releaseRunLease` của SSH driver chỉ trả lease | Đề xuất H3 (dừng process group khi trả lease) + bộ dọn process mồ côi trên Mac |
| S4 gate bằng execution policy | Đạt | Gate review → docs → owner chặn đồng bộ; `maxReviewRounds` có sẵn thay rule 5 vòng; blockers đạt; chung session giữa hai issue qua `resumeFromRunId` (CREA-17/18/19) | H2 phải chặn cả việc agent sửa `executionPolicy` (bypass CREA-2, CREA-3) |
| S5 kiểm tải Mac | Đạt | Có H1: run nằm `queued` khi Mac quá tải hoặc không vào được rồi tự chạy. Không H1: `setup_failed`, issue `blocked`. Không bao giờ chuyển environment | H1 đầu `claimQueuedRun` |
| S6 diễn tập nâng upstream | Đạt (đích `upstream/master`, chưa có stable mới hơn) | 0 conflict ở nguồn, 4 hunk ở một file test, giải 45 giây; test 9/9 và 18/18, `tsc` sạch | — |
| D1, D2 Claude Code trên Mac | Đã chẩn đoán | Treo do hộp thoại quyền macOS (TCC) cho bản Claude mới đọc ổ ngoài; CLAUDE.md cá nhân nạp qua thư mục cha | — |

## Ngân sách vá lõi

| Loại | Chỗ | Số |
|---|---|---|
| Hook một dòng có registry | H1 `claimQueuedRun`, H2 `runUpdate`, H3 `releaseRunLease` (SSH driver) | 3 |
| Vá adapter/driver | `claude_local` in_place, SSH driver metadata `in_place`, `sessionCodec`, dòng log resume | 4 |

Tiêu chí go ghi "tổng số hook lõi không quá 5". Đếm hook một dòng thì là 3, đạt. Đếm mọi chỗ đụng lõi thì là 7, vượt. Ba trong bốn vá adapter là bug hoặc thiếu sót của upstream (codec, log, in_place cho claude) nên nên gửi PR; nếu upstream nhận thì chỉ còn vá metadata driver.

## Điều kiện kèm theo nếu go

1. Đầu R1-1: làm thật H3 và bộ dọn process mồ côi trên Mac, chạy lại S3 cho tới khi đạt.
2. H2 chặn cả agent sửa hoặc xóa `executionPolicy`.
3. Gửi PR upstream: `sessionCodec` của `claude_local` và `codex_local` giữ `remoteExecution`; sửa dòng log resume; `claude_local` hỗ trợ `in_place`.
4. Test của Crew để ở file riêng để bỏ nguồn conflict duy nhất khi nâng; thêm script kiểm mốc theo `crew/release/core-hooks.json`.
5. App `crew-mac` đứng ra chạy `claude` để macOS chỉ hỏi quyền một lần cho app, không hỏi lại mỗi lần Claude cập nhật. Đăng nhập dùng Keychain sẵn có, không token, không login lại.
6. Nâng upstream theo mỗi stable; chạy lại S6 với tag stable thật khi upstream ra bản sau `v2026.1001.0`.

## Ghi nhận thêm cho thiết kế

- Agent dùng `--setting-sources project,local`: không chạy hook, plugin cá nhân; vẫn nạp `~/.claude/CLAUDE.md` (Đại Ca chốt được nạp). 3 plugin builtin `cc-plugin-*` vẫn nạp.
- Skill `paperclip` gọi `scripts/paperclip-issue-update.sh` không có ở `in_place`; agent tự gọi API thay được.
- Commit của agent mang danh tính git của user trên Mac kèm `Co-Authored-By`; cần chốt danh tính commit ở R1.
- Run follow-up tự động có lúc không resume vì "different runtime MCP server set"; chưa truy.
- Paperclip in khoảng 10 giây chặn mỗi run khi Mac không tới được ở bản H1 thử; bản thật cần cache kết quả đo, ghi lý do chờ lên UI và giới hạn thời gian chờ.

## Tài nguyên còn chạy

Xem `processes.md`. Server spike trên VPS, sshd cổng 2222 và `~/.zshenv` trên Mac mini, các nhánh fork cục bộ `spike/claude-in-place`, `spike/s5-load-gate`, `spike/upgrade-rehearsal` vẫn giữ để dùng lại ở R1-1, chờ Đại Ca quyết dọn hay giữ.
