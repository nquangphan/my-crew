# E2E-1 — Playwright cho Phòng Marketing

Ngày: 11/10/2026 (Asia/Ho_Chi_Minh). Worktree `.worktrees/paperclip-ga-e2e`, nhánh `crew/ga-e2e`, commit `33d7e2242`. Chưa push.

## Kết quả

- 7 ca `PW-S20-1..7` xanh trên stack T1, chạy lần đầu không retry.
- Toàn bộ suite T1 (`--project=t1`, retries mặc định 1): **78 passed, 4 skipped, 0 failed, 0 flaky** (11,7 phút).
  - 4 ca skipped là `no-dead-controls` cho `/agents/:agentRef/runs/:runId`, `/issues/:ref`, `/runs/:runId`, `/skills/:skillId`
    (stack T1 không có dữ liệu để điền tham số route). Đây là hành vi sẵn có của spec, không do thay đổi này.
  - Hai route mới `/contributions` và `/members` đã qua `no-dead-controls`.
- Không tìm thấy lỗi sản phẩm nào, không sửa mã sản phẩm.
- `vitest run test/e2e-coverage.test.ts test/e2e-support.test.ts`: 17 passed, 1 todo. Ca strict
  (`CREW_E2E_COVERAGE_STRICT=1`) vẫn đỏ vì các mã BA cũ chưa có ca; không có mã S20 nào trong danh sách thiếu.
- `biome check e2e test` sạch, `tsc --noEmit -p e2e/tsconfig.json` sạch.

## Lệnh

```sh
corepack pnpm install --frozen-lockfile --offline --ignore-scripts
corepack pnpm --filter @paperclipai/plugin-sdk... build
corepack pnpm --filter @crew/paperclip-plugin build
corepack pnpm --filter @paperclipai/paperclip-runner run build:typescript
# stack T1 riêng ~/crew-ga-t1 (bản sao ~/crew-r3-t1, FORK = paperclip-ga-e2e), server 3199, vite 5183
CREW_E2E_T1_ENV=$HOME/crew-ga-t1/board.env bash e2e/support/run-e2e.sh --project=t1 --grep PW-S20 --retries=0
CREW_E2E_T1_ENV=$HOME/crew-ga-t1/board.env bash e2e/support/run-e2e.sh --project=t1
```

Stack T1: copy `~/crew-r3-t1` sang `~/crew-ga-t1` (đổi đường dẫn trong `env.sh`, `config.json`, `crew-policy.json`), đổi
`plugins.package_path` của `crew.core` sang plugin của worktree này, khởi động lại server. Migration `0013` tự áp (bảng
`crew_contributions` có sau khi plugin `ready`). Stack cũ `~/crew-r3-t1` không bị đụng.

Tài khoản khách T1 (`t1-marketing@crew-e2e.local`) dựng bằng đúng luồng owner: tạo invite viewer kèm
`defaultsPayload.crew.role=contributor`, đăng ký và nhận invite, rồi `PUT contributors/:userId`. Hai biến
`CREW_E2E_CONTRIBUTOR_*` nằm trong `~/crew-ga-t1/board.env` (quyền 600). Ở T1 server tự duyệt yêu cầu tham gia nên bước
"duyệt tham gia" không cần bấm; trên prod bước này làm ở trang Thành viên (đã có unit test, chưa chạy e2e T2).

## File đã sửa

Trong `packages/crew-web/e2e/`:
- `specs/s20-contributions.spec.ts` (mới, 7 ca, chạy nối tiếp).
- `support/env.ts` (`hasContributor`, `contributorEmail/Password`, `contributorStorageStatePath`).
- `support/login.ts` (`loginContributorAndSaveState`, tách `saveState`).
- `support/global-setup.ts` (đăng nhập khách ở context riêng, lưu storageState thứ hai).
- `support/fixtures.ts` (fixture `contributorPage`, `contributorApi`; tự bỏ qua nếu chưa có tài khoản).
- `support/run-e2e.sh` (T2/T3 đọc hai biến khách qua ssh, tùy chọn, không echo; quét mật khẩu khách trong test-results).
- `ba-ids.json` (S20.1–S20.8), `coverage.json`, `README.md` (mục "Tài khoản khách góp ý" và ghi chú đổi FORK ở Stack T1).

## Các ca

| Ca | Kiểm |
|---|---|
| PW-S20-1 | Khách gửi yêu cầu qua dialog: dòng `pending` ở cả hai phía, không có issue lõi, token agent không thấy (issues, `?q=`, issue, comments, heartbeat-context, activity), khách không có nút trên dòng |
| PW-S20-2 | Khách bình luận bằng ô "Viết góp ý": bình luận chờ hiện cho khách, agent không thấy, số run của agent không đổi sau 5 giây |
| PW-S20-3 | Owner: badge sidebar, thẻ dashboard, trang Chờ duyệt, chip "Chờ duyệt (n)" và nhóm trong danh sách issue, bình luận chờ trong popup issue |
| PW-S20-4 | Owner duyệt bình luận: bình luận thật của owner, chip "Góp ý của …", `resultCommentId` khớp, agent đọc được |
| PW-S20-5 | Owner duyệt yêu cầu, chọn agent, Lưu nháp: issue `backlog` đúng project/agent/người tạo; trong lúc request đăng bị giữ lại thì Từ chối bị khóa và dialog không đóng bằng Esc |
| PW-S20-6 | Owner từ chối: khách thấy "Bị từ chối" không nút, agent và lõi không thấy; khách không thấy agent/skills/máy/hộp thư/thành viên, các route agents/costs/runs/inbox/members chuyển hướng; ghi trực tiếp và tự duyệt đều 403 |
| PW-S20-7 | Trang Thành viên: tạo lời mời (link `/paperclip/invite/…`, invite mang dấu khách), thu hồi; gỡ rồi đặt lại dấu của khách, quyền thật đổi theo |

## Dọn dẹp tiến trình

Đã tắt server (kèm Postgres nhúng cổng 54329) và vite. `ps`, `lsof -i :3199 :5183 :54329` trống, không còn trình duyệt
Playwright. Em không khởi động container Docker nào; các container đang chạy là của máy từ trước. Thư mục
`~/crew-ga-t1` giữ lại (ngoài repo) để chạy lại.

## Hạn chế

- Chưa chạy T2 (prod), theo kế hoạch để DP-1. Ca viết chạy cả hai tầng (`@t1`), nhưng các kiểm riêng của T2 trong spec
  (heartbeat run từ stub, `executionPolicy` khác null như issue board) chưa có: ở T1 project thử không phải project
  Crew nên không có policy để so, và agent giữ chỗ không bật wakeOnDemand nên "agent được đánh thức" chỉ kiểm gián tiếp
  (agent đọc được bình luận thật, không có run lúc chờ). Cần bổ sung ở DP-1 nếu muốn kiểm wake thật.
- Ca dựa vào tài khoản khách tạo sẵn; trên prod owner tạo qua trang Thành viên và lưu hai biến vào `/opt/crew-v3-spike/.env`.

Status: DONE_WITH_CONCERNS
Summary: Spec `s20-contributions.spec.ts` (7 ca) và phiên khách đã thêm; 7/7 xanh và toàn suite T1 78 passed, 4 skipped (sẵn có), 0 failed; stack đã tắt sạch. Concern: chưa chạy T2 và chưa kiểm wake thật bằng stub.
