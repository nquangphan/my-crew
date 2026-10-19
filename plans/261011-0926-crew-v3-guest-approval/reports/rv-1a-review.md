# RV-1a — Review server và plugin của Phòng Marketing (C7, C8, migration 0013)

Ngày: 11/10/2026 10:34, Asia/Ho_Chi_Minh.
- Worktree: `~/Documents/projects/crew/.worktrees/paperclip-guest`, nhánh `crew/guest-approval` @ `d6c5d3f6a`.
- Phạm vi: `git diff 38580c5d7..HEAD -- server packages/crew-plugin crew/release`, gồm 13 file, +2413 dòng.
- Đã đọc: spec `2026-10-11-crew-v3-guest-approval-design.md` và báo cáo `pl-1`, `sv-1`, `sv-2`.
- Không sửa file nguồn nào.

## Đã chạy

Chạy từng file một, xong không còn tiến trình Postgres hay vitest nào.

| Lệnh | Kết quả |
|---|---|
| `vitest run src/__tests__/crew-contributions.db.test.ts` | 30/30 |
| `… crew-contributions-agent-blind.test.ts` | 5/5 |
| `… crew-plugin-data-viewer.test.ts` | 9/9 |
| `… crew-viewer-write-matrix.test.ts` | 2/2 |
| plugin `migration-0013.db.test.ts`, `contributions-isolation.test.ts` | 1/1, 1/1 |
| `node crew/release/check-core-hooks.mjs` | hook 5/5, vá lõi 8, mục 20, lỗi 0 |
| `node --test crew/release/check-core-hooks.test.mjs` | fail 0 |

Worktree này trước đó chưa có `node_modules`, nên em đã cài để chạy test:
- `pnpm install --frozen-lockfile --offline --ignore-scripts`;
- `pnpm rebuild` cho `embedded-postgres`;
- build `@paperclipai/plugin-sdk` (kéo theo `shared`).

Mọi thứ sinh ra đều nằm trong thư mục bị git ignore, `git status` vẫn sạch.

## Trả lời 6 câu hỏi

1. **Agent đọc hoặc bị đánh thức bởi mục chờ hay bị từ chối?** Qua actor agent (`agent_jwt`/`agent_key`) thì không:
   - router trả 403 cho agent;
   - nội dung không vào bảng lõi;
   - plugin `crew.core` không có tool hay data key nào đọc hai bảng này;
   - plugin khác bị `validatePluginRuntimeQuery` chặn đọc namespace lạ;
   - không ghi activity, không phát event.

   Vẫn còn ba đường hở: **I1** (mục bị từ chối vẫn lên lõi khi đua), **I2** (nội dung chờ vào log server và Sentry), **I3**
   (board key nằm trên máy chạy agent).
2. **Ai khác owner duyệt/từ chối được?** Không ai. Role đọc từ DB (`membership_role='owner'`, `status='active'`);
   admin, operator, viewer, instance admin không có membership, `local_implicit` và agent đều nhận 403 (có test). Còn
   lại hai lưu ý:
   - Mọi actor board có `userId` của owner đều qua được, kể cả board API key (xem I3).
   - Instance admin có thể tự nâng mình lên `owner` qua route quản lý thành viên của stock
     (`server/src/routes/access.ts:1282` coi instance admin là owner). Đây là thiết kế stock, không phải lỗi của diff.
3. **Khách ghi được gì qua route stock?** Không có gì. Khách là `viewer`, nên `assertCompanyAccess` chặn mọi request
   không an toàn (`authz.ts:116-118`); ma trận 11 route xanh. C8 chỉ nới route `POST /plugins/:pluginId/data/:key`,
   chỉ cho `crew.core`, chỉ khi DB xác nhận membership viewer `active`. `companyId` do host ghi đè lên
   `params.companyId` (`packages/plugins/sdk/src/worker-rpc-host.ts:1926-1930`), nên không đọc chéo company được.
   Data key của `crew.core` đều chỉ đọc. Riêng `crew.companies` ghi cache, vô hại. Hai lưu ý ở M2, M3.
4. **Duyệt có idempotent và an toàn khi đua không?** Phần lớn có:
   - transaction với `SELECT … FOR UPDATE`;
   - mỗi lần đổi là một `UPDATE … WHERE status=…` có điều kiện;
   - khóa tính bằng `now()` của DB;
   - trước khi giành lại luôn tìm bản ghi lõi đã tạo;
   - tự lành chạy song song với `reject` cũng an toàn (UPDATE đọc lại điều kiện sau khi chờ khóa dòng).

   Lỗ còn lại: **I1** (từ chối trong lúc bước 2 đang chạy) và **M4** (bình luận trùng khi owner khác giành lại khóa).
5. **SQL injection, sai schema/bảng?** Không có:
   - mọi giá trị đều là tham số bind của `sql\`\``;
   - `sql.raw` chỉ dùng hằng (namespace, `COLUMNS`, `interval '10 minutes'`);
   - namespace `plugin_crew_core_0433ea20b6` khớp `sha256("crew.core")[0:10]`, giống `derivePluginDatabaseNamespace`;
   - tên cột lõi đã đối chiếu schema: `projects.archived_at`, `issues.hidden_at`, `issue_comments.client_request_id`,
     `issue_create_idempotency_keys(company_id, idempotency_key, issue_id)`;
   - bảng lõi ghi không kèm schema (`"issues"`, …), giống `project-roles.ts` và `runtime-switch.ts`.
6. **C7, C8 có tối thiểu và đăng ký đúng không?** Có:
   - mỗi vá là đúng 1 dòng anchor cộng 1 import cuối file, như spec §8;
   - `core-hooks.json` có mục C7/C8 với `kind: core-patch`, `importLine`, `tests` và mô tả tiếng Anh nói hành vi;
   - checker báo lỗi 0;
   - mô tả H1 có sửa một câu ("the only plugin table the server writes"), hợp lý vì nay server ghi thêm bảng.

## Mức nghiêm trọng

### Critical

Không có.

### Important

#### I1. Mục đã từ chối vẫn có thể lên lõi và đánh thức agent

`server/src/crew/contributions.ts:547-563`, cụ thể điều kiện `decided_by_user_id = ${input.userId}` ở dòng 559.

`reject` một mục `approving` cho phép **chính owner đang giữ khóa** từ chối ngay, không chờ khóa hết hạn. Bước đăng
(bước 2) do trình duyệt gọi route stock, và route stock không biết gì về trạng thái góp ý. Không có gì phát hiện sau đó:
`selfHeal` (`:425-438`) chỉ quét dòng `approving`, còn `approved`/`rejected` là trạng thái cuối.

Kịch bản:
1. Owner bấm Duyệt một yêu cầu, mục chuyển `approving`.
2. Trình duyệt gọi `POST /api/companies/:cid/issues`. Route này chạy H4, tạo issue rồi đánh thức người nhận, nên chậm.
   Nginx hoặc client hết giờ chờ, UI hiện lỗi "Đang duyệt dở" kèm nút Từ chối (spec §7.3).
3. Owner bấm Từ chối. `findMaterialized` chưa thấy gì vì transaction tạo issue chưa commit, nên mục thành `rejected`.
4. Transaction stock commit: issue có nội dung bị từ chối xuất hiện trong lõi, agent được giao việc và bị đánh thức.

Hậu quả: mục mang nhãn "Bị từ chối" nhưng agent đã đọc và đang làm. Vi phạm quyết định 1 và 4 của owner. Bình luận
cũng gặp y hệt.

Đề xuất sửa:
- Bỏ ngoại lệ "cùng người" trong `reject` khi mục đang `approving`: chỉ cho từ chối khi `approving_at` đã quá hạn
  khóa. Nếu muốn ngắn hơn, dùng một hạn riêng đủ dài hơn timeout của request stock (ví dụ 2 phút). Trong hạn đó trả
  `409 crew_contribution_locked`, để UI bấm "Kiểm tra lại" (gọi `complete`) trước.
- Thêm bước phát hiện: `selfHeal` và `complete` quét cả dòng `rejected` có `approving_at IS NOT NULL`. Nếu tìm thấy
  bản ghi lõi thì chuyển `approved` (cần sửa bảng trạng thái ở spec §4) hoặc ít nhất gắn cờ và log id, để owner biết
  có nội dung đã lên lõi.
- Thêm test: `approve`, rồi `reject` cùng owner, rồi chèn bản ghi lõi. Với cách sửa thứ nhất, kỳ vọng `reject` trả 409.

#### I2. Nội dung chờ duyệt bị ghi vào log server, và vào Sentry khi lỗi 5xx

- `server/src/crew/contribution-routes.ts:87-94`.
- `server/src/middleware/logger.ts:184-195`: với mọi phản hồi ≥ 400 không có `__errorContext`, logger ghi
  `reqBody: redactSensitive(body)`. `title`/`body`/`description` không phải key nhạy cảm nên được ghi nguyên văn.
- `server/src/middleware/error-handler.ts:266-280`: lỗi 5xx gắn ngữ cảnh lỗi (có `reqBody`) và gửi `reportCrash`.

Kịch bản:
- Khách gửi bình luận vào issue vừa bị ẩn. Router trả `422 crew_contribution_invalid_target`, và dòng log `warn` chứa
  toàn bộ `reqBody.body`. Các mã 400, 403 (dấu vừa bị gỡ) và 503 (bảng chưa có) cũng vậy.
- Khách gửi chuỗi chứa ký tự `\u0000`. `multilineTextSchema` không chặn, nhưng Postgres từ chối `text` có byte 0x00,
  nên trả 500. `DrizzleQueryError.message` có dạng `Failed query: … params: <title>,<body>` và đi vào log `error`,
  `errorContext` lẫn Sentry.

Spec §5 hứa "Log pino chỉ ghi id". Agent không đọc log server qua API nào, nhưng log và Sentry là nơi lưu lâu, ngoài
tầm `crew_contributions`.

Đề xuất sửa:
- Trong router Crew, trước mọi bước có thể ném lỗi: chép `req.body` sang `res.locals`, rồi gán
  `req.body = { kind }` (hoặc `{}`). Như vậy nhánh fallback của logger không còn nội dung để ghi. Cách này không đụng
  lõi.
- Bọc `createContribution` bằng try/catch: lỗi DB thì ném `new HttpError(500, "Crew: không lưu được góp ý.")` không
  kèm `cause`, để message của drizzle không lọt ra.
- Chặn `\u0000` ở zod, trả 400.
- Thêm test: bắt output logger khi gặp 422 và 500, kiểm không có chuỗi đánh dấu.

#### I3. Board API key của owner nằm trên chính máy chạy agent

`server/src/crew/contributions.ts:153`: router nhận mọi actor `board` khác `local_implicit`, kể cả
`source: "board_key"`.

Theo `plans/261010-0020-crew-v3-r3/sdd-ledger.md:63,294`:
- app "2P Crew" trên Mac giữ board key của user owner (8b52…) trong Keychain;
- app đọc lại key bằng cách spawn `/usr/bin/security`.

Agent Claude Code chạy trên cùng Mac, cùng user macOS. Nếu ACL của mục Keychain cho `security` đọc mà không hỏi (đúng
cách app đang dùng), agent có thể:
- chạy `security find-generic-password -w`;
- gọi `GET /api/crew/companies/:cid/contributions?status=rejected` với `Authorization: Bearer <key>`;
- đọc mọi mục chờ và bị từ chối.

Em chưa kiểm ACL thật trên máy, nên giả định này chưa được chứng minh. Đây là rủi ro sẵn có (key đó vốn làm được mọi
việc của board), nhưng nó phá thẳng quyết định 1, trong khi chặn lại rất rẻ.

Đề xuất sửa: router chỉ nhận `req.actor.source === "session"`. UI Crew là trình duyệt, nên vẫn chạy được. App Mac
không cần router này. Có thể nới riêng `/access` nếu cần. Thêm test cho `board_key`, kỳ vọng 403.

### Minor

#### M1. Dấu khách sống lại khi người đó quay lại làm viewer

`server/src/crew/contributions.ts:171`, `:199-204`, `:595-614`.

Dấu ở `crew_contributors` không bị xóa khi membership đổi role, bị gỡ hay bị lưu trữ.

Kịch bản: owner gỡ khách X khỏi company, vài tháng sau mời lại X làm viewer thường (không có dấu). X lập tức thành
khách góp ý mà owner không bật. Tương tự khi X bị nâng lên operator rồi hạ lại viewer. Tác động thấp, vì mục vẫn phải
qua owner duyệt, nhưng trái mô tả "đóng khi lỗi" ở spec §3.2.

Đề xuất sửa:
- Trong `resolveContributionActor`, nếu có dòng dấu mà role không phải viewer `active` thì xóa dấu luôn.
- Hoặc lưu thêm `company_memberships.id` vào dòng dấu và so khớp khi kiểm.

#### M2. C8 cho viewer đọc mọi data key của `crew.core`, kể cả key thêm sau này

`server/src/crew/plugin-data-scope.ts:29`.

Hiện có 19 key, gồm cả:
- `crew.machines` (hostname, báo cáo máy);
- `crew.machineJobs` (đường dẫn checkout, remote);
- `crew.setupRuns`, `crew.usage.*` (chi phí).

Spec Q1 đã chấp nhận viewer đọc rộng. Rủi ro là data key mới thêm vào plugin sẽ tự mở cho khách mà không ai xét.

Đề xuất sửa:
- Truyền `key` vào helper và dùng một allowlist những key UI viewer cần. Cách này đổi anchor C8, phải cập nhật
  `core-hooks.json`.
- Hoặc tối thiểu thêm test liệt kê đúng 19 key, để key mới làm test đỏ.

#### M3. Cấu hình Crew hỏng thì router và C8 mở cho mọi company

`server/src/crew/contributions.ts:160`, `server/src/crew/plugin-data-scope.ts:41`.

`loadCrewCompanyConfig` trả `invalid` khi file không đọc được hoặc JSON hỏng (`issue-policy.ts:173-181`). Hai chỗ này
chỉ loại `absent`, nên mọi company đều thành company Crew. Với các gate chặn thì đóng khi lỗi là đúng. Nhưng ở hai chỗ
**mở quyền** này, cùng kiểu kiểm lại thành mở khi lỗi.

Kịch bản: deploy làm hỏng file cấu hình. Viewer của company không phải Crew đọc được data `crew.core` của company mình,
và router góp ý chạy cho cả company đó.

Đề xuất sửa: đổi điều kiện thành `config.kind !== "ok"` thì từ chối.

#### M4. Bình luận trùng khi owner khác giành lại khóa sau 10 phút

`server/src/crew/contributions.ts:399-405`, `:492-498`.

Ràng buộc UNIQUE của bình luận là `(issue_id, author_user_id, client_request_id)`, tức tính riêng theo tác giả.

Kịch bản:
1. Owner A duyệt bình luận nhưng request bước 2 treo hơn 10 phút.
2. Owner B giành lại khóa, `findMaterialized` chưa thấy gì, B đăng bình luận.
3. Request của A cuối cùng commit.

Kết quả là hai bình luận giống nhau và agent bị đánh thức hai lần. Khả năng xảy ra rất thấp, spec đã ghi rủi ro. Issue
không bị trùng vì khóa idempotent tính theo company.

Đề xuất sửa: chấp nhận và ghi vào runbook. Hoặc khi giành lại, nếu `approving_at` mới quá hạn chưa lâu thì trả
`locked` thêm một khoảng nữa.

#### M5. `findMaterialized` không lọc bình luận đã xóa

`server/src/crew/contributions.ts:400-404`.

Không lọc `deleted_at`. Owner đăng xong, xóa bình luận, rồi `complete`: mục vẫn thành `approved` và trỏ tới bình luận
đã xóa.

Đề xuất sửa: thêm `AND deleted_at IS NULL`, hoặc ghi rõ hành vi này là chủ ý.

#### M6. Danh sách cắt cứng 200 mục, không phân trang

`server/src/crew/contributions.ts:285-290`.

Khi có hơn 200 mục chờ, owner không thấy những mục cũ nhất, trong khi `summary.pending` vẫn đếm đủ. Đề xuất sửa: thêm
cursor `before`, hoặc với `status=pending` thì sắp cũ nhất trước.

## Phần đã kiểm và không thấy lỗi

- Thứ tự route: `/contributions/summary` khai báo trước `/:id`. Express 5 bắt lỗi của handler async.
- Router được gắn sau `boardMutationGuard`. Không có middleware toàn cục nào ghi activity hay phát event. Log chỉ ghi
  id, ngoài trường hợp ở I2.
- Khách đọc mục của người khác nhận 404. Id sai định dạng cũng nhận 404, không lộ việc mục có tồn tại.
- `crew_contributions_shape_ck` và `result_ck` khớp với code ghi. Có đủ index cho các bộ lọc đang dùng.
- `crew.core` không đăng ký tool nào cho agent. Không file nào trong `src/**` của plugin nhắc tới hai bảng (có test).

## Hành động đề xuất (theo thứ tự)

1. I1: bỏ ngoại lệ cùng owner khi `reject` mục `approving`, và phát hiện mục `rejected` đã lên lõi.
2. I2: không để body góp ý tới logger và Sentry (thay `req.body` trong router, lỗi DB ném chung chung, chặn `\u0000`).
3. I3: router chỉ nhận actor `session`.
4. M3, M1: đóng khi lỗi cho cấu hình và cho dấu khách.
5. M2, M4, M5, M6: tùy owner.

## Câu hỏi mở

- Mục Keychain chứa board key của app "2P Crew" có cho `/usr/bin/security` đọc không hỏi không? Agent trên Mac có chạy
  cùng user macOS không? Hai điều này quyết định I3 là thật hay chỉ là phòng xa.
- Log của server prod (stdout/docker) và Sentry có được ai ngoài owner đọc không? Câu trả lời quyết định độ gấp của I2.

Status: DONE
Summary: Không có lỗi critical. Chỉ owner duyệt được, khách không ghi được route stock, SQL an toàn, C7/C8 tối thiểu
và đăng ký đúng. Còn ba lỗi important cần sửa trước khi deploy: từ chối đua với bước đăng làm nội dung bị từ chối lên
lõi (I1), nội dung chờ vào log và Sentry khi request lỗi (I2), router nhận board key nằm trên máy chạy agent (I3).
