# RV-1b — Review crew-web của Phòng Marketing

Ngày: 11/10/2026 10:44, Asia/Ho_Chi_Minh.
- Worktree: `~/Documents/projects/crew/.worktrees/paperclip-guest`, nhánh `crew/guest-approval` @ `0061e1190`.
- Phạm vi: `git diff 38580c5d7..HEAD -- packages/crew-web`: 89 file, +5163/−92.
- Đã đọc: spec §0, §3.3, §3.4, §5, §5.1–§5.4, §7, §9.3; báo cáo wb-1..wb-4. So client với code server thật:
  `server/src/crew/contribution-routes.ts`, `contributions.ts`, stock `routes/access.ts` (invites, join-requests,
  members, user-directory), `routes/issues.ts` và `services/issues.ts` (idempotency khi tạo issue, `clientRequestId`
  của bình luận).
- Không sửa file nguồn nào, không chạy dev server.
- Theo yêu cầu, không nêu ba việc đang sửa song song ở server: chặn board API key, chặn ký tự điều khiển, và `reject`
  trả 409 `already_approved` khi đang `approving`.

## Đã chạy

| Lệnh | Kết quả |
|---|---|
| `corepack pnpm --filter @crew/paperclip-web typecheck` | sạch |
| `corepack pnpm --filter @crew/paperclip-web lint` | sạch (502 file) |
| `corepack pnpm --filter @crew/paperclip-web test` | 135 file, 1103 pass, 1 todo |
| So khóa i18n vi/en của `contributions`, `members` | khớp hai chiều |

## Hợp đồng client và server (mục 1): khớp

- 11 endpoint `/api/crew/companies/:companyId/...` khớp method, path và hình dạng trả về: `{items}`, `{pending}`,
  `{contribution, materialize}`, `Contribution` trần, 204 cho contributors.
- `Contribution`, `ContributionMaterialize` và `CompanyAccess` khớp `toContribution`, `materializeOf` và `/access`.
- Hình dạng route stock cũng khớp: `{members}`, `{users}`, `{invites, nextOffset}`, join-requests là mảng trần, tạo
  invite trả kèm `token`.
- `limit: 100` nằm trong trần `max(100)` của `listCompanyInvitesQuerySchema`.
- `clientRequestId = contribution.id` là uuid, khớp `z.string().uuid()` của stock. Stock khử trùng theo
  `(issue_id, author_user_id, client_request_id)` và có ràng buộc unique.
- Tạo issue với `idempotencyKey` được khóa bằng `pg_advisory_xact_lock`, và server ghi khóa vào
  `issue_create_idempotency_keys`, nên `findMaterialized` tìm được bản ghi.

---

## CRITICAL

### C1. Đóng dialog duyệt khi đang chạy, rồi bấm Từ chối: issue vẫn được tạo cho agent dù mục mang nhãn "Bị từ chối"

- `features/contributions/contribution-actions.tsx:27-29`. `busy` chỉ xét `approve`/`reject` của `OwnerActions`.
- `features/contributions/approve-issue-dialog.tsx:107`. Dialog tạo một `useApproveContribution()` **riêng**.
- `approve-issue-dialog.tsx:58,225`. Nút "Hủy", phím Esc và bấm ra ngoài vẫn đóng dialog trong lúc `approve.isPending`.

Kịch bản:
1. Owner bấm Duyệt trên một yêu cầu. Bước 1 khóa mục (`approving`, `decided_by_user_id = owner`), bước 2
   `POST /companies/:cid/issues` đang chạy. Bước này có thể chậm vì phải chạy policy, wake, sync reference.
2. Owner bấm Esc. Dialog đóng, mutation vẫn chạy ngầm, còn hai nút Duyệt/Từ chối của dòng **không bị khóa**.
3. Owner bấm Từ chối rồi xác nhận. Server `rejectContribution`: mục `approving`, `findMaterialized` chưa thấy gì, và
   `decided_by_user_id = userId` nên server cho từ chối. Mục thành `rejected`.
4. Bước 2 xong: issue thật nằm ở bảng lõi, có assignee, `status: todo`, và agent được đánh thức. Bước 3 trả
   409 `not_approving`. Form đã unmount nên không ai thấy lỗi này.

Kết quả là vi phạm quyết định owner §0.1 và §0.4: nội dung bị từ chối lại tới tay agent. Bản vá server đang làm song
song (409 `already_approved` khi đã có bản ghi) không chặn được ca này, vì lúc từ chối bước tìm vẫn chưa thấy bản ghi.
Hai owner khác nhau thì đã có khóa 10 phút chặn. Lỗ này chỉ mở với **cùng một owner**, mà owner thì luôn qua được khóa
của chính mình.

Hướng sửa (UI, bắt buộc):
- Nâng `useApproveContribution()` lên `OwnerActions`, truyền `approve` xuống `ApproveIssueDialog`, để `busy` tính cả
  lúc dialog đang chạy.
- Trong lúc `approve.isPending`: chặn đóng dialog (`onOpenChange` bỏ qua `false`, khóa nút Hủy), hoặc vẫn cho đóng
  nhưng giữ Duyệt/Từ chối của dòng bị khóa tới khi mutation xong.
- Nên thêm phòng thủ ở server cho bước đăng: khi `complete` gặp mục đã `rejected` mà bản ghi lõi đã có, trả mã riêng
  để UI báo owner tự hủy issue đó. Đây là việc của server và nên bàn với chủ ticket.
- Test: bấm Duyệt (createIssue bị treo), đóng dialog, kiểm nút Từ chối đang `disabled`.

---

## IMPORTANT

### I1. Bước đăng issue không gửi `allowDuplicate`: trùng tiêu đề với một issue đang mở trong 48 giờ thì nội dung góp ý mất mà vẫn báo "đã duyệt"

- `features/contributions/approve-flow.ts:80-86` và `features/issues/new/use-create-request.ts:37-46`.
- Stock mặc định `allowDuplicate: false` (`packages/shared/src/validators/issue.ts:770-776`). Khi đó
  `services/issues.ts:9857-9893` trả lại issue **cũ** có cùng tiêu đề (sau khi chuẩn hóa), đang mở, tạo trong 48 giờ
  qua, ở bất kỳ project nào. Stock cũng ghi `idempotencyKey` của góp ý trỏ sang issue cũ đó.

Kịch bản:
1. Phòng Marketing gửi "Viết bài Facebook tuần này", đúng lúc board đã có một issue mở cùng tên.
2. Owner duyệt, chọn project, agent và loại. Server `complete` thấy khóa nên chuyển `approved`, với `resultIssueId`
   là issue cũ.
3. Mô tả của khách, project, assignee, loại và nháp owner chọn đều bị bỏ, không có cảnh báo nào. Response có
  `deduplicated: true, deduplicationReason: 'recent_open_title'`, nhưng client bỏ qua.

Hướng sửa:
- Ở bước đăng của duyệt, gửi `allowDuplicate: true`. Khóa idempotent vẫn trả lại issue gốc khi gọi lại (đúng như mô tả
  của schema).
- Chỉ dialog duyệt cần cờ này, nên thêm tham số tùy chọn vào `CreateBodyInput`.
- Test: body bước đăng có `allowDuplicate: true`.

### I2. Trang Góp ý lấy 200 mục mới nhất của mọi trạng thái: mục chờ cũ biến khỏi tab "Chờ duyệt"

- `features/contributions/contributions-page.tsx:41-43`: `useContributions()` không có filter. Server cắt
  `LIMIT 200 ORDER BY created_at DESC` (`contributions.ts:268-282`).

Kịch bản:
1. Công ty có hơn 200 góp ý, đa số đã duyệt hoặc đã từ chối, kèm vài mục chờ cũ (ví dụ một bình luận gửi trước kỳ
   nghỉ).
2. Mục chờ cũ không còn trong 200 mục mới nhất. Tab "Chờ duyệt" thiếu mục đó và số đếm trên tab sai, trong khi badge
   sidebar (`countPending`, không giới hạn) vẫn đếm nó.
3. Owner không tìm được mục để duyệt. Riêng bình luận còn thấy trong luồng của issue, nhưng chỉ khi owner tự mở đúng
   issue đó.

Hướng sửa: gọi theo từng tab (`status: 'pending' | 'rejected' | 'approved'`). Số đếm tab "Chờ duyệt" lấy từ
`summary`. Nếu cần thì thêm phân trang `before=createdAt` ở server.

### I3. Viewer thuần (không có dấu góp ý) vẫn thấy nút "Yêu cầu mới" ở danh sách issue, và bấm sẽ nhận 403

- `features/issues/list/issues-page.tsx:330-333`: nút ở `PageHeader` không xét `readOnly`.
- `NewRequestDialog` (`features/issues/new/new-request-dialog.tsx:56-58`) chỉ rẽ nhánh cho contributor. Viewer thuần
  nhận dialog thường và gọi `roles.get`, labels...; bấm Gửi thì nhận `403 Viewer access is read-only`.
- Sidebar thì đã ẩn đúng (`nav-access.ts:30`), nên hai chỗ đang không nhất quán. Mở thẳng URL `issues?new=1` cũng mở
  dialog thường.

Đây là vi phạm spec §7.1 ("ẩn mọi nút ghi", `no-dead-controls`).

Hướng sửa:
- Chỉ hiện nút khi `!readOnly || isContributor`.
- Trong `NewRequestDialog`, viewer thuần thì `return null`.
- Thêm ca viewer thuần vào `read-only.test.tsx`.

### I4. Ảnh đại diện ở Cài đặt là nút chết với viewer và Phòng Marketing

- `features/settings/profile-form.tsx:24,55`. Upload đi qua `POST /companies/:cid/assets/images`, mà route này gọi
  `assertCompanyAccess` (`server/src/routes/assets.ts:115-117`), nên viewer nhận 403.

Kịch bản: khách chọn ảnh rồi bấm Lưu, form báo lỗi 403 và tên mới cũng không được lưu, vì upload chạy trước
`profile.update`.

Hướng sửa: khi `readOnly` thì ẩn ô ảnh, chỉ cho đổi tên. Cách khác là upload qua một route không gắn company, nếu có.

### I5. Duyệt lại sau khi bước đăng đã xong: UI báo "Duyệt thất bại" rồi dialog tự biến mất

- `features/contributions/approve-flow.ts:75`, `approve-issue-dialog.tsx:220-222` và `contribution-actions.tsx:43-48`.

Kịch bản:
1. Bước 2 thành công nhưng response hoặc bước 3 rớt mạng.
2. Owner bấm Duyệt lại. Server `approve` tìm thấy bản ghi, chuyển `approved` và trả 409 `crew_contribution_decided`
   kèm mục đã `approved`.
3. UI coi đây là lỗi ở bước `lock`. `contributionFromError` vá cache thành `approved`, `ContributionActions` trả `null`,
   và dialog bị unmount giữa chừng.

Owner thấy lỗi chớp lên rồi mất, không có xác nhận "đã duyệt". Không có bản trùng nào, nhưng owner dễ nghĩ việc duyệt
đã hỏng và đi tạo tay một issue khác.

Hướng sửa: trong `approveContribution`, 409 `decided` mà `contribution.status === 'approved'` thì coi là thành công
và trả mục đó. Còn `rejected` thì báo riêng.

### I6. Nhãn "Lời mời khách góp ý" phụ thuộc 100 lời mời mới nhất: quá ngưỡng thì duyệt tham gia không bật dấu, và không báo gì

- `features/members/use-members.ts:24-33`, `api/paperclip/members.ts:85-88` (`listAll`, `limit: 100`) và
  `members-model.ts:22-27`.
- Mục `invite` đi kèm join-request của stock không có `defaultsPayload` (`access.ts:1537-1551`), nên client phải nối
  qua danh sách invite.

Kịch bản: lời mời khách cũ hơn 100 lời mời gần nhất (tính cả lời mời đã hủy hoặc đã hết hạn). `contributor = false`,
nên owner duyệt xong người đó chỉ là viewer thuần, không có cảnh báo `markFailed`.

Hướng sửa: lấy theo `inviteId` cho từng join request đang chờ, hoặc lặp `offset` theo `nextOffset` tới khi đủ các
`inviteId` cần.

---

## MINOR

1. **Popup góp ý không xét quyền.** `contribution-popup-host.tsx:42-46`: admin/operator mở link `?contribution=<id>`
   thì gọi `GET` và nhận 403, popup hiện "Không tải được". Sửa: chỉ render khi `isOwner || isContributor`, còn không
   thì bỏ tham số.
2. **Lỗi `/access` bị nuốt im lặng.** `features/access/use-company-access.ts:35-40`:
   - lỗi 5xx (sau 2 lần thử lại) hoặc 403 khiến owner mất mục Chờ duyệt, Thành viên và nút duyệt, không có thông báo;
   - `AccessGuard` chuyển `/members` về dashboard.

   Ứng dụng không sập, và lúc này phần ghi stock vẫn hiện, nên đây là hướng xuống cấp an toàn. Sửa: trả thêm `error`,
   cho `AccessGuard` hiện `ErrorState` kèm Thử lại ở các route `routeNeedsAccess`.
   - Ghi nhận thêm: ở chế độ `local_trusted` (`local_implicit`), `/access` luôn trả 403, nên trên dev local owner
     không bao giờ thấy UI duyệt. Đúng spec §3.3, nhưng nên ghi vào hướng dẫn chạy T1.
3. **Bình luận chờ của người khác hiện như tin của agent.** `pending-comments.tsx:32` dùng `kind={mine ? 'human' :
   'agent'}`, nên owner thấy bình luận của khách theo kiểu tin agent. Ở `comments.tsx`, người khác vẫn dùng `'human'`.
   Sửa: luôn dùng `'human'`.
4. **Mô tả và bình luận bị trim, không còn "đúng nguyên văn" (§5.2).**
   - `use-create-request.ts:38` trim `description` ở bước đăng.
   - `contribution-composer.tsx:13,17` và `new-contribution-dialog.tsx:81` trim trước khi gửi, nên markdown mở đầu
     bằng khối thụt lề bị hỏng.

   Sửa: chỉ dùng `trim()` để kiểm rỗng, còn gửi đi thì giữ nguyên chuỗi gốc.
5. **i18n: câu lỗi server tiếng Việt hiện nguyên văn trên UI tiếng Anh.**
   - `contribution-composer.tsx:28` và `new-contribution-dialog.tsx:134` hiện thẳng `error.message`.
   - `KNOWN_CODES` (`approve-flow.ts:96-105`) thiếu `crew_contributions_unavailable` (503). Tạo góp ý không qua
     `contributionErrorKey`.

   Sửa: dùng `contributionErrorKey` cho mọi lỗi của router, và thêm khóa `errors.crew_contributions_unavailable`.
6. **Accessibility.**
   - Nút "Duyệt"/"Từ chối" lặp lại ở mỗi dòng (`contribution-actions.tsx:58-63`) mà tên giống hệt nhau. Thêm
     `aria-label` kèm tiêu đề hoặc trích đoạn.
   - Gợi ý "Đang duyệt dở" chỉ nằm ở `title` của Badge (`:54`), nên bàn phím và màn hình cảm ứng không đọc được.
     Chuyển thành `MutedText` hiện sẵn.
   - Dialog duyệt không hiện lỗi khi `projects`/`agents` tải hỏng (`approve-issue-dialog.tsx:98-99,219`): Select chỉ
     trống. Thêm `ErrorState` cho cả hai query này.
7. **Link mời vẫn hiện sau khi thu hồi chính lời mời đó.** `invites-section.tsx:63-77`: `link` giữ nguyên sau khi
   revoke, nên owner có thể chép một link đã chết. Sửa: lưu `inviteId` kèm `link`, xóa khi revoke đúng id đó.
   Token không bị log (không có `console.*` trong `api/`, `members/`, `contributions/`), link đúng dạng
   `${origin}/paperclip/invite/<token>` (`members-model.ts:11-13`).
8. **Trùng lặp và code thừa.**
   - `new-request-dialog.tsx:49-54` tự dựng lại query `/access` thay vì gọi `useCompanyAccess()`. Component đã nằm
     trong shell company, `companyId` cũng chính là `company.id`.
   - `rolesOrNull` (`approve-issue-dialog.tsx:42-49`) chép y nguyên `rolesOf` (`new-request-dialog.tsx:71-78`).
   - Phần chọn project, loại, Trợ Lý mặc định và agent của dialog duyệt lặp logic của `RequestForm`. Nên tách thành
     một hook chung (`useRequestChoices`).
   - `invitesApi.listActive` (`api/paperclip/members.ts:78-84`) không dùng ở `src`, chỉ có trong test.
   - `features/contributions/index.ts` có export, nhưng mọi nơi dùng lại import sâu
     (`@/features/contributions/...`, 7 file).
   - `ContributionRow` (`contributions-page.tsx:86-87`) gọi `useAuthorNames()` và dựng lại `Map` ở mỗi dòng (O(n·m)).
     Nên dựng một lần ở trang.
9. **Chip "Chờ duyệt (n)" ở danh sách issue** (`issues-page.tsx:402-412`) đếm `pending.length`, bị chặn trần 200 bởi
   server. Cùng gốc với I2.
10. **`data-testid="issue-popup"` dùng lại** cho popup góp ý (qua `IssuePopupFrame`). Selector e2e nhắm popup issue
    có thể bắt nhầm. Nên truyền `data-testid` riêng.

---

## Ma trận quyền ở UI (mục 3): đúng, trừ I3 và I4

| Bề mặt | Phòng Marketing | Viewer thuần | Admin/Operator | Owner |
|---|---|---|---|---|
| Sidebar Chờ duyệt / Thành viên | "Góp ý của tôi" / ẩn | ẩn / ẩn | ẩn / ẩn | có / có |
| Nút Duyệt, Từ chối (`ContributionActions`) | ẩn | ẩn | ẩn | có |
| Thẻ dashboard, nhóm Chờ duyệt ở issues | ẩn / mục của mình | ẩn | ẩn | có |
| Composer | composer góp ý | ẩn | stock | stock |
| Sửa tiêu đề và mô tả, xóa đính kèm, cổng, force-done, tương tác, dừng run, `markRead` | ẩn | ẩn | có | có |
| Project: đổi tên, gỡ, vai trò, wizard, gắn sao | ẩn | ẩn | có | có |
| "Yêu cầu mới" ở danh sách issue | dialog góp ý | **dialog thường → 403 (I3)** | có | có |
| Ảnh đại diện ở Cài đặt | **403 (I4)** | **403 (I4)** | có | có |

## Hook hỏng hoặc đang tải (mục 4)

- `useCompanyAccess` chỉ dùng trong shell company, nên không có chỗ nào gọi `useCompany()` ngoài context.
- Hook gọi đúng thứ tự trước mọi `return` sớm (`NewRequestDialog`, `ContributionActions`, `ActionsSlot`).
- Lúc đang tải: `readOnly = true`, nên nút ghi ẩn tạm. `AccessGuard` chỉ hiện spinner ở route phụ thuộc vai trò.
- Khi lỗi: `loading = false` và `readOnly = false`. Owner giữ được mọi chức năng stock, chỉ mất phần owner (Minor 2).
- Lỗi 4xx không thử lại (`providers.tsx:12`).
- Không có đường nào làm sập app của owner thường.

## Ghi nhận khác (không phải lỗi)

- Duyệt bình luận, hai tab cùng một owner: stock khử trùng theo tác giả cộng ràng buộc unique, nên không đăng hai lần.
  Hai owner khác nhau: khóa 10 phút, và `findMaterialized` chạy trước khi giành lại. Không có bản trùng.
- Thứ tự bước và chuyện dùng lại khóa khi Duyệt lại đã có test (`approve-flow.test.ts`). Bước 2 lỗi thì không gọi
  `complete`, đúng spec §7.3.
- Kiểm nhãn research được đưa lên trước bước khóa (`approve-flow.ts:70-73`). Cách này tốt: không để lại mục "Đang
  duyệt dở" vô cớ.
- Hiện không có test nào chạy với router thật. Báo cáo wb-3 tự ghi `DONE_WITH_CONCERNS` vì lý do này. Ba lỗi C1, I1,
  I2 chỉ lộ ra khi chạy với server thật.

## Việc nên làm, theo thứ tự

1. C1: dùng chung mutation duyệt giữa dòng và dialog, và chặn đóng hoặc chặn nút Từ chối trong lúc đang duyệt.
2. I1: gửi `allowDuplicate: true` ở bước đăng.
3. I3, I4: ẩn "Yêu cầu mới" với viewer thuần và ẩn ô ảnh khi `readOnly`.
4. I2: lọc theo tab ở trang Góp ý.
5. I5: coi `decided` + `approved` là thành công.
6. I6: nối join request với invite theo id.
7. Các mục Minor.
8. Chạy một vòng T1 thật: gửi, duyệt, đóng dialog giữa chừng rồi từ chối, và một ca trùng tiêu đề.

## Câu hỏi còn mở

- C1: nếu `complete` gặp mục đã `rejected` mà bản ghi lõi đã có, server có nên tự chuyển mục về `approved` (sự thật ở
  bảng lõi thắng) thay vì trả `not_approving` không? Việc này cần chủ dự án quyết.
- I1: owner có muốn trùng tiêu đề thì chặn lại và hỏi ("đã có issue X"), thay vì luôn tạo issue mới, không?

Status: DONE
Summary: Client khớp đúng route và hình dạng trả về của server, typecheck, lint và 1103 test đều xanh. Có 1 lỗi
critical: cùng một owner đóng dialog duyệt rồi bấm Từ chối thì nội dung bị từ chối vẫn được đăng cho agent. Có 6 lỗi
important (trùng tiêu đề làm mất nội dung, trang Góp ý cắt ở 200 mục, nút chết với viewer thuần, ...) và 10 lỗi minor.
