# Báo cáo thi công: router Crew góp ý chờ duyệt (vá lõi C7)

Ngày: 11/10/2026 (Asia/Ho_Chi_Minh).
- Worktree: `~/Documents/projects/crew/.worktrees/paperclip-ga-sv1`, nhánh `crew/ga-sv1`.
- Commit: `ebe99bd21`. Chưa push.
- Trạng thái: **xong**.

## File đã sửa (đúng danh sách sở hữu)

| File | Việc |
|---|---|
| `server/src/crew/contributions.ts` (mới) | Đọc role từ DB, đọc/ghi bảng plugin bằng SQL thô (kiểm `to_regclass`), kiểm đầu vào bằng zod (`multilineTextSchema` của shared), `findMaterialized`, `selfHeal`, đổi trạng thái |
| `server/src/crew/contribution-routes.ts` (mới) | 11 endpoint ở spec §5 |
| `server/src/app.ts` | Anchor C7 sau `approvalRoutes`, import ở cuối file |
| `crew/release/core-hooks.json` | Thêm mục C7. Sửa câu "the only plugin table the server writes" trong mô tả H1 |
| `server/src/__tests__/crew-contributions.db.test.ts` (mới) | 30 ca |
| `server/src/__tests__/crew-contributions-agent-blind.test.ts` (mới) | 5 ca |

## Yêu cầu bắt buộc

- **Chỉ owner duyệt/từ chối.** Role đọc từ DB (membership `active`, `principal_type='user'`). Admin, operator, khách,
  viewer, agent, instance admin và `local_implicit` đều nhận 403. Có test.
- **Chỉ khách tạo góp ý.** Khách là viewer có dòng `crew_contributors`. Nâng role hoặc gỡ dấu thì mất quyền. Có test.
- **Agent không thấy.** Agent nhận 403 ở cả 11 endpoint. Router không ghi `activity_log`, không phát event, log chỉ ghi
  id. Test agent-blind kiểm 6 đường đọc của agent:
  - các đường: list, search, get, comments, heartbeat-context, activity;
  - kiểm thêm các dòng `issues`/`issue_comments`/`activity_log`;
  - không có `wakeup` nào được gọi, không có dòng `agent_wakeup_requests`/`heartbeat_runs` mới;
  - sau khi duyệt qua route stock thật, có wake `issue_commented` và `issue_assigned`;
  - ca dương tính đối chứng: cùng truy vấn search tìm thấy issue sau khi duyệt;
  - mục bị từ chối không bao giờ tới agent.
- **Duyệt idempotent.** Đăng lại bình luận (`clientRequestId`) và issue (`idempotencyKey`) trả cùng bản ghi.
  `complete` gọi lại vẫn 200. Không tạo bản trùng.
- **Khóa.** `approve`/`complete`/`reject` chạy trong transaction:
  - `SELECT … FOR UPDATE` rồi `UPDATE … WHERE status = …` có điều kiện;
  - khóa 10 phút tính bằng SQL `now()`;
  - test hai owner duyệt cùng lúc: một 200, một 409.

## Kết quả kiểm

- `crew-contributions.db.test.ts` 30/30, `crew-contributions-agent-blind.test.ts` 5/5.
- Cả bộ `src/__tests__/crew-*` cùng `src/crew/*.test.ts`: 32 file, chạy riêng từng file, tất cả xanh. Gồm cả test C8
  (`crew-plugin-data-viewer` 9/9, `crew-viewer-write-matrix` 2/2).
- Test route issue stock: `issue-wake-diagnostics-routes` 9/9, `issue-comment-redaction` 6/6,
  `issue-queued-comments-routes` 72/72.
- `node crew/release/check-core-hooks.mjs`: hook 5/5, vá lõi 8, lỗi 0. Còn cảnh báo "chưa có PR upstream" như C8.
- `tsc --noEmit` ở `server`: 0 lỗi.
  - Trước đó cần build `@paperclipai/plugin-sdk` và `@paperclipai/paperclip-runner run build:typescript` (không cần
    cargo). Chưa build thì lỗi do thiếu kiểu của package ngoài.
- `ipcs -m` trước và sau đều 2 segment, của tiến trình khác có sẵn. Không còn tiến trình Postgres hay server.

## Hợp đồng API

Hình dạng ở spec §5 không đổi. Đã đối chiếu với client WB-1 (`packages/crew-web/src/api/crew/{contributions,types}.ts`
trên `crew/guest-approval`): path, method, `{items}`, `{pending}`, 204, trường null, giờ ISO, `description: string | null`,
`membershipRole: null` đều khớp. Câu `error` của hai mã 409 mà UI hiện nguyên văn:
- `crew_contribution_not_materialized`: "Chưa thấy bản ghi đã đăng, hãy bấm Duyệt lại.";
- `crew_contributor_requires_viewer`: "Chỉ bật góp ý cho thành viên viewer đang hoạt động.".

Phần chi tiết bổ sung đã ghi vào **spec §5.4 mới** (sửa file spec ở repo Crew, chưa commit, để controller commit):
1. `/access` trả `membershipRole: null` cho người không có membership, theo giả định của UI. `/access` vẫn trả khi
   bảng chưa có (`contributor: false`), mọi endpoint khác thì 503.
2. Mọi 409 trả `{ error, code, contribution }`. Các mã mới:
   - `crew_contribution_decided`;
   - `crew_contribution_locked`, áp dụng cho cả `reject` khi owner khác đang giữ khóa;
   - `crew_contribution_not_approving`;
   - `crew_contribution_already_approved`.
3. `reject` trên mục đã `rejected` trả 200 như cũ.
4. Lỗi đầu vào trả 400 `crew_contribution_invalid`. Đích không hợp lệ (project/issue khác company, project lưu trữ,
   issue ẩn) trả 422 `crew_contribution_invalid_target`.
5. Mục không thấy (kể cả khách xem mục người khác) trả 404.

## Ghi chú

- `biome check` mặc định báo lỗi format và `noNonNullAssertion`, nhưng file có sẵn (`project-roles.ts`, test C8) cũng
  báo y như vậy. Fork không có `biome.json`, nên đây không phải cổng lint của fork.
- Câu hỏi mở: không có.
