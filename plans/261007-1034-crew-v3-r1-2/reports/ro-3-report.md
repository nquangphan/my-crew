# Báo cáo RO-3 — mẫu gọi API đầy đủ và luật "không bao giờ" (sau nghiệm thu máy thật)

- Worktree `.worktrees/paperclip-r12-roles`, nhánh `crew/r12-roles`.
- SHA: `7942ec2b2bd78cada6a382cf1b4886176ea6ae45`. Chỉ đổi `crew/agents/executor.md`, `reviewer.md`, `integrator.md`, `instructions.test.mjs`.
- Test: `node --test crew/agents/*.test.mjs` → pass 40, fail 0, skipped 2 (hai test so regex với server, chỉ chạy khi có `issue-policy.ts`).

## Nguyên nhân (L5 của nghiệm thu)

Instructions chỉ ghi `GET /api/issues/<id>`, không có URL đầy đủ. Agent haiku ghép `$PAPERCLIP_API_URL/issues/…` (thiếu `/api`), bridge trả `Route not allowed`, rồi integrator vẫn push vào `main` dù bước xác minh API thất bại.

## Đã sửa

- Cả ba file có mục "Gọi API" ngay sau luật "Không bao giờ", với mẫu `curl -fsS -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_URL/api/issues/<id>"` (đọc) và mẫu ghi có `-X PATCH`, `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID`, `Content-Type`, `-d`. Tên biến lấy từ test bridge của `packages/adapter-utils` (`PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`; URL không chứa `/api`). `-f` làm lệnh thoát khác 0 khi HTTP lỗi, và instructions nói rõ lệnh lỗi nghĩa là chưa có dữ liệu. Body comment đã kiểm theo `addIssueCommentSchema` (`{"body":…}`).
- `integrator.md`: **LUẬT CỨNG** đặt ngay trước bước xác minh của stage 4 và nhắc lại ở bước push: bất kỳ lệnh xác minh nào lỗi hoặc thiếu dữ liệu thì KHÔNG `git push`, chỉ comment lý do. Bước push chỉ chạy khi bước 1 đã thành công và bước 4 đã ghi bằng chứng.
- Rút gọn cho haiku, luật "Không bao giờ" ở đầu mỗi file (danh sách đánh số ngắn):
  - executor: không commit trên nhánh không phải `crew/<identifier>`; bước đầu tiên là tạo nhánh từ `origin/HEAD` (hoặc `base` của `crew-fix`) và kiểm `git branch --show-current` trước khi sửa file; đăng lại `crew-commit` sau mỗi commit mới.
  - reviewer: không duyệt `sha` không có `crew-commit` hoặc khác `crew-commit` mới nhất.
  - integrator: không `PATCH` issue gốc sang `in_progress`/`blocked`/`cancelled` (chỉ `done` hoặc comment; việc sửa đi qua issue con mới); không merge hay push `sha` không có `crew-review` hợp lệ.
- Test mẫu: mọi file có mục "Gọi API", có `$PAPERCLIP_API_URL/api/`, không có URL hay `GET|POST|PATCH|PUT /…` thiếu `/api/`, mọi dòng có `curl ` đều `curl -fsS`; "Không bao giờ" đứng trước "Gọi API"; luật cứng đứng trước lệnh push; executor có "Kiểm `git branch --show-current`".

## Giả định và giới hạn

- Agent thấy `PAPERCLIP_RUN_ID` trong env của run (nhóm worker không đặt biến này, agent thì có); header `X-Paperclip-Run-Id` cần cho các lệnh ghi theo heartbeat-protocol.
- Luật bằng chữ không ép được model yếu: vẫn nên cân nhắc để wrapper hoặc gate server chặn push khi không có xác minh. Ghi cho lead; ngoài phạm vi gói `roles`.
- Chưa chạy lại trên Mac thật; cần AC-2 chạy lại Cổng 4 để xác nhận agent haiku làm đúng.

## Sửa sau Cổng 4 lần 2: nhận diện stage chỉ theo `executionState`

SHA `33245a95598faf0d90745670d7569a2e9a853fab`. Test: `node --test crew/agents/*.test.mjs` → pass 41, fail 0, skipped 2.

- `integrator.md` stage 2 (mục Gộp) và stage 4 nhận diện chỉ theo `executionState`: `currentStageId` (stage integrator thứ nhất cho stage 2; stage push cho stage 4), `currentParticipant.agentId` = ME, `completedStageIds` chứa stage trước đó (stage đầu cho stage 2; stage owner cho stage 4), cùng `parentId` rỗng. Không đòi `status=in_review`: `status` có thể là `in_review`, `blocked` hoặc `todo`, vì recovery stock (sau push lỗi) và comment của owner đổi `status` mà không đổi `executionState`, và server vẫn cho `PATCH done` từ các status đó khi state còn chờ integrator.
- Giữ nguyên mọi điều kiện xác minh khác (bằng chứng docs của chính integrator, dựng lại từ `EVIDENCE`, "đã xong" theo `crew-merge` mới hơn bằng chứng) và luật cứng không push khi xác minh lỗi.
- `reviewer.md`: không có điều kiện `status` cho issue gốc (chỉ `status=done` của issue con, là trạng thái thật của con), nên không đổi.
- Test mẫu: không còn `status` là `in_review` làm điều kiện; có câu "Không đòi `status=in_review`", danh sách `in_review`/`blocked`/`todo`, lý do recovery stock và luật cứng.
