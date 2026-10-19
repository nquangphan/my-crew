# FX-1 — Sửa các lỗi review của router góp ý chờ duyệt (Phòng Marketing)

Ngày: 11/10/2026, Asia/Ho_Chi_Minh.
- Worktree: `~/Documents/projects/crew/.worktrees/paperclip-ga-fx1`, nhánh `crew/ga-fx1`.
- Commit: `dc1158385`. Chưa push.
- Spec `docs/superpowers/specs/2026-10-11-crew-v3-guest-approval-design.md` đã sửa ở repo Crew nhưng **chưa commit**,
  để controller commit (giống sv-1).

## File đã sửa

| File | Việc |
|---|---|
| `server/src/crew/contributions.ts` | I1, I2 (ký tự điều khiển, bọc lỗi DB), I3, M1, M3, M6 |
| `server/src/crew/contribution-routes.ts` | I2 (dời body khỏi `req.body`), trả `{ items, nextBefore }` |
| `server/src/crew/plugin-data-scope.ts` | M2 (allowlist data key), M3 |
| `server/src/routes/plugins.ts` | Anchor C8 thêm tham số `key`, vẫn đúng 1 dòng |
| `crew/release/core-hooks.json` | Anchor và mô tả C8; mô tả C7 (chỉ phiên trình duyệt, body không vào log) |
| `server/src/__tests__/crew-contributions.db.test.ts` | 30 → 41 ca |
| `server/src/__tests__/crew-plugin-data-viewer.test.ts` | 9 → 11 ca |

## Phải sửa

- **I1.** `reject` trên mục `approving` vẫn tìm bản ghi lõi trước (đúng bước tìm của `complete`): thấy thì mục thành
  `approved` và trả `409 crew_contribution_already_approved`, không thấy thì từ chối. Ngoại lệ "cùng owner" vẫn giữ,
  theo quyết định của owner.
  - Thêm `reconcileMaterialized`, dùng chung cho `selfHeal`, `approve`, `complete` và `reject`. Mục `rejected` có
    `approving_at` (tức đã qua `approving`) mà có bản ghi lõi thì chuyển `approved`, gắn `result_*_id`, log `warn` chỉ
    ghi id. Mục từ chối thẳng từ `pending` không bao giờ đổi.
  - `selfHeal` quét thêm các dòng `rejected` đã qua `approving`, mới nhất trước, tối đa 200.
  - Có test dựng lại cuộc đua: approve, reject (chưa có bản ghi), rồi chèn bản ghi lõi. Có cho cả issue lẫn bình luận,
    qua tự lành, `reject` lại, `complete` và `approve`, kèm ca đối chứng từ `pending`.
- **I2.**
  - Router dùng `router.use` cho `…/contributions` và `…/contributors` để dời `req.body` sang `res.locals` trước mọi
    bước kiểm. Logger HTTP (`customProps`) và `attachErrorContext` vì thế chỉ thấy `{}`. Không sửa lõi.
  - Lỗi DB khi tạo góp ý trả `HttpError(500)` cố định, mã `crew_contribution_store_failed`, không kèm `cause`. Log chỉ
    ghi `companyId` và SQLSTATE.
  - Sentry: `doc/observability.md` đã kiểm rằng event server không mang request data, nên chỉ còn message lỗi, nay đã
    cố định.
  - `title`, `description`, `body` chứa C0 (trừ tab/LF/CR), DEL hay C1 trả `400 crew_contribution_invalid`.
  - Có test bắt log HTTP thật (`createHttpLogger`) cho 400, 403 và 422. Ca 500 được ép bằng một CHECK constraint tạm,
    và kiểm cả log HTTP, log server, `captureException` (mock) lẫn body phản hồi.
- **I3.** `resolveContributionActor` chỉ nhận `source === "session"`. `board_key` và `local_implicit` của owner nhận
  403 ở cả 11 endpoint (có test).

Em đã kiểm ngược: tạm bỏ hai chỗ sửa I1 và I2 thì 5 test mới đỏ, trả code lại thì xanh.

## Lỗi nhỏ

| Mục | Kết quả |
|---|---|
| M1, dấu sống lại | **Sửa.** Dấu chỉ có hiệu lực khi `granted_at >= company_memberships.updated_at`; lõi ghi `updated_at` ở mọi lần đổi role/status (`services/access.ts`). `PUT` bật lại làm mới `granted_at = GREATEST(now(), updated_at)`. `GET /contributors` chỉ liệt kê dấu còn hiệu lực. Có test cho gỡ rồi mời lại, và nâng rồi hạ |
| M2, C8 mở mọi key | **Sửa.** Allowlist `CREW_VIEWER_DATA_KEYS` gồm 11 key UI Crew đọc ở trang viewer vào được (tổng quan, project, issue, docs). Đóng `crew.machineJobs`, `crew.skillSync`, `crew.storage`, `crew.usage.*`, `crew.docs.graph/history/status`, và mọi key mới. Có test chốt danh sách |
| M3, cấu hình hỏng | **Sửa.** Router và C8 đều chỉ chạy khi `config.kind === "ok"`; hỏng thì router 404, C8 403 stock (có test) |
| M6, cắt cứng 200 | **Sửa (phía server).** Thêm `?before=<id>` và trường `nextBefore` (cộng thêm, không phá client cũ). Có test 205 mục |
| M5, bình luận đã xóa | **Bỏ, có chủ ý.** Route bình luận stock trả lại đúng bình luận đã xóa khi đăng lại cùng `clientRequestId` (`services/issues.ts:12195-12200`). Nếu lọc thì mục kẹt `approving` mãi. Bình luận đã từng lên lõi thì agent đã thấy, nên `approved` mới đúng sự thật, cùng tinh thần với I1. Đã ghi lý do trong comment của `findMaterialized` và trong spec §5.4 |
| M4, bình luận trùng khi giành khóa | **Bỏ.** Không sửa được triệt để nếu không đổi route stock (UNIQUE tính theo tác giả). Kéo dài khóa chỉ thu hẹp cửa sổ chứ không đóng. Đã ghi vào spec §11 như rủi ro được chấp nhận |

## Spec

Đã sửa các mục sau:
- §3.2: hiệu lực của dấu.
- C8 ở §3.3: allowlist và đóng khi cấu hình hỏng.
- §4: thêm chuyển trạng thái `rejected` → `approved`.
- §5: luật actor, body không vào log, query `before`, kết quả `nextBefore`.
- §5.3: tự lành quét cả mục `rejected`.
- §5.4: mã `crew_contribution_store_failed`, 400 cho ký tự điều khiển, 403 cho board key, cuộc đua khi từ chối, vì sao
  không lọc bình luận đã xóa.
- §8: anchor C8 mới.
- §11: rủi ro M4 và rủi ro đua khi từ chối.

## Kiểm

- `tsc --noEmit` ở `server`: 0 lỗi.
- `node crew/release/check-core-hooks.mjs`: hook 5/5, vá lõi 8, mục 20, lỗi 0. `node --test check-core-hooks.test.mjs`
  pass 13/13.
- Chạy riêng từng file, tất cả xanh:
  - 31 file `src/__tests__/crew-*` cùng `src/crew/crew-bundle-resume.cancelled.test.ts`;
  - `crew-contributions.db` 41/41, `crew-contributions-agent-blind` 5/5;
  - `crew-plugin-data-viewer` 11/11, `crew-viewer-write-matrix` 2/2.
- Xong không còn tiến trình Postgres hay vitest.
- Môi trường: `pnpm install --frozen-lockfile --offline --ignore-scripts`; build `@paperclipai/plugin-sdk...` và
  `paperclip-runner build:typescript`. Phải chạy `scripts/hydrate-symlinks.js` của `@embedded-postgres/darwin-arm64`
  (do `--ignore-scripts` bỏ postinstall), nếu không initdb thiếu `libicudata`. Mọi thứ nằm trong `node_modules`.

## Việc cho crew-web (không sửa ở đây)

- Client `contributions` có thể đọc thêm `nextBefore` và gọi `?before=` để owner thấy mục cũ hơn 200. Dạng `{ items }`
  cũ vẫn chạy.
- UI viewer chỉ được gọi 11 data key trong allowlist. Nếu trang viewer cần key khác, phải thêm vào
  `CREW_VIEWER_DATA_KEYS` (đổi `plugin-data-scope.ts`, không đổi anchor).
- Router không nhận board API key nữa. UI trình duyệt không bị ảnh hưởng.

## Câu hỏi mở

Không có.

Status: DONE
Summary: Đã sửa I1, I2, I3 kèm test dựng lại lỗi, và sửa M1, M2, M3, M6. Bỏ M5 (lọc bình luận đã xóa sẽ làm mục kẹt
và sai sự thật) và M4 (cần đổi route stock). tsc sạch, checker core-hooks lỗi 0, mọi file test crew chạy riêng đều
xanh. Spec đã sửa nhưng chưa commit.
