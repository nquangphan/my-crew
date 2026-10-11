# FX-2: Sửa các lỗi review crew-web của Phòng Marketing

Ngày: 11/10/2026, Asia/Ho_Chi_Minh.
- Worktree: `~/Documents/projects/crew/.worktrees/paperclip-ga-fx2`, nhánh `crew/ga-fx2`.
- Nhánh đã fast-forward lên `34c8a5675` (bản sửa server). Commit đó không đụng `packages/crew-web` nên không có xung
  đột.
- Chỉ sửa trong `packages/crew-web`. Chưa push.

## Commit

| SHA | Nội dung |
|---|---|
| `324073068` | C1, I1, I2 (kèm phân trang `before`/`nextBefore`), I5, 409 `already_approved` khi từ chối, và các lỗi minor ở phần góp ý |
| `e2927df11` | I3, I4, báo lỗi `/access` (minor 2) |
| `708ff3941` | I6, xóa link sau khi thu hồi (minor 7), bỏ `listActive`, dịch lỗi của router ở trang Thành viên |

## Kiểm tra

| Lệnh | Kết quả |
|---|---|
| `corepack pnpm --filter @crew/paperclip-web test` | 135 file, 1125 pass, 1 todo |
| `corepack pnpm --filter @crew/paperclip-web typecheck` | sạch |
| `corepack pnpm --filter @crew/paperclip-web lint` | sạch (504 file) |
| `CREW_UI_COMMIT=708ff3941b496fd654fc0279393d3d655ad7471d vite build --outDir <scratch>` | build xong |

- Typecheck cần `dist` của `@paperclipai/plugin-sdk`. Worktree mới chưa có, nên em đã build gói đó một lần. Lệnh
  build này không tạo file nào được git theo dõi.
- Không có dev server nào còn chạy.

## Đã sửa

### C1: không từ chối được khi đang duyệt
- Mutation duyệt có `mutationKey` theo id mục. `useApprovalInFlight` dùng `useIsMutating`, nên dòng, popup và dialog
  (kể cả dialog đã unmount) cùng thấy một trạng thái đang chạy.
- `OwnerActions` truyền mutation xuống `ApproveIssueDialog`.
- Trong lúc chạy:
  - Duyệt và Từ chối bị khóa;
  - `RejectConfirm` không mở được, và `onReject` cũng tự kiểm lại;
  - dialog không đóng bằng Esc, bấm ra ngoài hay nút X (nút X bị ẩn), nút Hủy bị khóa;
  - nút Duyệt có vòng xoay và `aria-busy`.
- Test: `approve-dialog.test.tsx` (giữ treo bước tạo issue, thử Esc và Hủy, kiểm Từ chối của dòng bị khóa), và
  `approve-actions.test.tsx` (trường hợp bình luận).

### I1: luôn gửi `allowDuplicate: true`
- `CreateBodyInput.allowDuplicate` là tùy chọn. Chỉ bước đăng khi duyệt bật cờ này.
- Test nằm ở `approve-flow.test.ts` và `approve-dialog.test.tsx`.

### I2: đọc theo từng tab
- Mỗi tab gọi `useContributionPages({status})`, dùng `useInfiniteQuery` với `?before=` và `nextBefore`, kèm nút
  "Tải thêm".
- Số trên tab Chờ duyệt lấy từ `summary`, cùng nguồn với badge sidebar. Tab còn trang sau thì hiện "N+".
- `patchContributionCache` vá được cả dữ liệu dạng trang.
- Test ở `contributions-page.test.tsx`: tham số status, số đếm từ summary, Tải thêm.

### I3: viewer thuần
- Nút "Yêu cầu mới" chỉ hiện khi `!readOnly || isContributor`.
- `NewRequestDialog` trả `null` với viewer thuần, kể cả khi mở thẳng `?new=1`. Dialog dùng `useCompanyAccess` thay
  vì tự dựng lại query.
- Có test cho cả hai.

### I4: Cài đặt
- Viewer và Phòng Marketing chỉ đổi được tên. Ô ảnh và nút gỡ ảnh bị ẩn. Có test.

### I5: Duyệt lại khi bản ghi đã có
- 409 `crew_contribution_decided` hoặc `crew_contribution_already_approved` kèm mục `approved` được coi là thành
  công: hàm trả `{ contribution, alreadyPosted: true }` và hiện thông báo "Đã duyệt".
- Mục `rejected` có câu riêng `errors.alreadyRejected`.
- Test nằm ở flow, actions và dialog.

### 409 `already_approved` khi từ chối
- Mục chuyển sang Đã duyệt trong cache.
- Thông báo rõ ràng (`ContributionNotice`) vẫn còn sau khi dòng của mục rời trang:
  - nằm ở góc màn hình khi không có popup;
  - nằm trong popup khi đang mở popup, vì popup là modal.
- Có test.

### I6: nối yêu cầu tham gia với lời mời
- `invitesApi.listAll` đọc hết các trang theo `nextOffset`, trần 50 trang (5000 lời mời).
- Yêu cầu không tìm thấy lời mời có badge "Không rõ loại lời mời" và nút "Duyệt và Đặt Phòng Marketing" (duyệt rồi
  bật dấu).
- Có test.

### Minor đã sửa
1. Popup góp ý chỉ render cho owner và khách góp ý. Người khác không gọi `GET` nào. Có test.
2. `useCompanyAccess` trả thêm `error` và `retry`. `AccessGuard` hiện `ErrorState` kèm Thử lại ở các route cần vai
   trò. Có test.
3. Bình luận chờ luôn có `kind="human"`. Có test.
4. Mô tả và bình luận gửi nguyên văn, chỉ trim để kiểm rỗng. Áp dụng cho composer, dialog góp ý và `buildCreateBody`.
   Tiêu đề vẫn trim như spec.
5. i18n:
   - mọi mã lỗi của router đi qua `contributionErrorKey`, kể cả lỗi khi gửi góp ý;
   - thêm mã `crew_contributions_unavailable` và `crew_contribution_store_failed`;
   - câu `crew_contribution_invalid` nêu cả trường hợp có ký tự điều khiển;
   - trang Thành viên dịch `crew_contributor_requires_viewer` và các mã liên quan.
6. Accessibility:
   - `aria-label` của Duyệt và Từ chối là "<chữ trên nút>: <tiêu đề hoặc đầu bình luận>";
   - gợi ý "Đang duyệt dở" hiện thành `MutedText`;
   - dialog duyệt báo lỗi kèm Thử lại khi không tải được project hay agent.
7. Link mời bị xóa khi thu hồi đúng lời mời đó. Có test.
8. Gộp chỗ trùng:
   - bỏ query `/access` riêng;
   - `rolesOrNull` và `rolesOf` gộp thành `projectRolesOrNull`;
   - bỏ `invitesApi.listActive`;
   - `useAuthorNames` dùng memo, và trang Góp ý dựng bảng tên và project một lần cho cả trang.
9. Popup góp ý có `data-testid="contribution-popup-frame"` (thêm prop `testId` cho `IssuePopupFrame`).

Thay đổi phụ ở `ds` để giữ luật design system (`className` ngoài ds chỉ được chứa class bố cục):
- thêm `FloatingNotice`;
- thêm `Spinner decorative`.

## Minor bỏ qua, kèm lý do
- **Tách `useRequestChoices`.** Đây là refactor dùng chung giữa `RequestForm` và dialog duyệt, mất hơn 20 phút, và
  không sửa lỗi nào.
- **Import sâu thay vì qua `features/contributions/index.ts`.** Chỉ là chuyện thẩm mỹ. Đổi sang barrel có thể kéo
  `routes` và popup host vào chunk khởi đầu.
- **Chip "Chờ duyệt (n)" ở danh sách issue (minor 9).** Chip đếm yêu cầu (`kind=issue`), còn `summary` đếm cả bình
  luận, nên chưa có nguồn số không bị cắt. Cần server có số đếm theo `kind`. Chip vẫn đếm trang đầu (200 mục).

## Kiểm data key `crew.core` cho viewer và Phòng Marketing
- UI gọi 13 key. Có 2 key nằm ngoài danh sách server cho viewer: `crew.machineJobs` và `crew.skillSync`.
- Hai key này chỉ được gọi ở trang Máy, trang Skills (`sync-status`, `use-skill-sync`) và wizard thêm project. Viewer
  không vào được các trang đó (`VIEWER_HIDDEN_SEGMENTS`: `machines`, `skills`, `wizards`, `projects/new`).
- Các trang viewer vào được chỉ gọi key trong danh sách:
  - dashboard: `roots`, `machines`;
  - issues và popup issue: `roots`, `map`, `docsCheck`, `runtimeDecisions`;
  - projects: `setupRuns`, `docs.*`, và `machines` qua `RemoveProjectButton` (nút này đã ẩn với viewer);
  - docs: `docs.*`;
  - sidebar: `companies`;
  - guide và settings: không gọi key nào.
- Kết luận: không trang nào viewer vào được cần key ngoài danh sách, nên em không phải sửa gì.

## Câu hỏi còn mở
- Câu hỏi của review vẫn chưa có quyết định: khi `complete` gặp mục đã `rejected` mà bản ghi lõi đã có, server có tự
  chuyển mục về `approved` không? UI hiện chặn được trường hợp cùng một owner, còn phòng thủ ở server vẫn do chủ dự
  án quyết.

Status: DONE
Summary: Đã sửa C1, I1–I6, phần lớn lỗi minor, và ba việc theo bản sửa server (phân trang, mã lỗi mới, kiểm data key
cho viewer) trong ba commit trên `crew/ga-fx2`, chưa push. Test, typecheck, lint và vite build đều qua.
