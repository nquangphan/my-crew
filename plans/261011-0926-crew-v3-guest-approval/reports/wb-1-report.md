# WB-1 — Nền crew-web (báo cáo)

Worktree `~/Documents/projects/crew/.worktrees/paperclip-ga-wb1`, nhánh `crew/ga-wb1`. Ngày 11/10/2026.

## Commit
- `ad630a67b` feat(crew-web): thêm client API góp ý chờ duyệt và thành viên
- `f1cd9dbc6` feat(crew-web): chế độ chỉ đọc cho viewer và khung trang Góp ý, Thành viên

## Lệnh và kết quả
- `corepack pnpm install --frozen-lockfile`: xong. Build thêm `@paperclipai/plugin-sdk` (kéo theo `shared`) để typecheck có dist; dist bị gitignore.
- `corepack pnpm --filter @crew/paperclip-web test`: 124 file, 1032 test xanh (chạy 3 lần, không flake). Trước khi sửa: 118 file, 981 test.
- `typecheck`: sạch. `lint` (biome): sạch.
- `vite build`: xanh, cần `CREW_UI_COMMIT=<40 hex>` (dùng HEAD), xuất ra thư mục tạm ngoài repo.

## Đã làm (theo plan §4 WB-1)
- `src/api/crew/contributions.ts`, `types.ts`: kiểu `Contribution`, `CompanyAccess`, `ContributionApproval`...; 11 hàm cho 11 endpoint. `endpoints.ts` thêm 11 dòng mã S20.x và 8 dòng route stock (members, user-directory, invites create/list/revoke, join-requests list/approve/reject). Khóa query mới ở `queryKeys.ts`.
- `src/api/paperclip/members.ts` (mới); `comments.add(issueId, body, attachmentIds?, clientRequestId?)`. `issues.create` nhận body tự do nên giữ nguyên.
- `src/features/access`: `useCompanyAccess` trả `{ isOwner, isContributor, readOnly, loading }`, đang tải thì `readOnly`; `nav-access.ts` (ai thấy mục/route nào); `AccessGuard` (layout route trong `router.tsx`).
- Ẩn nút ghi khi `readOnly`: sửa tiêu đề/mô tả, xóa đính kèm, dừng run, nút cổng, Ép Done, thẻ tương tác, ô soạn bình luận (viewer thuần), đổi tên/gỡ project, sửa vai trò, thêm executor/runtime, Thêm project, gắn sao, Làm tiếp, nút ở trang run. Bỏ `markRead` khi `readOnly`.
- Nav: `contributions` (nhóm work, nhãn "Chờ duyệt" cho owner, "Góp ý của tôi" cho khách), `members` (nhóm system, chỉ owner). Sidebar và command palette lọc theo vai trò; viewer ẩn Hộp thư, Agent, Skill, Máy, wizard, run, costs, activity (route về Tổng quan). Badge = `summary.pending`, tự làm mới 30 giây (`useContributionsSummary`).
- Khung trang `contributions` và `members`: tiêu đề + `EmptyState`, locale vi/en.

## Lệch so với plan / quyết định
- Ô soạn: `Composer` thuộc WB-2, nên WB-1 chỉ ẩn nó với viewer thuần. Khách góp ý vẫn thấy composer stock cho tới khi WB-2 đổi `composer.tsx` theo `isContributor`. Nếu deploy WB-1 riêng, khách sẽ thấy ô bình luận bấm vào nhận 403.
- Lỗi tải `/access` (ví dụ 500) thì UI không khóa (`readOnly=false`): server vẫn là cổng thật. Chỉ trạng thái đang tải mới coi là chỉ đọc.
- Trang `/runs`, `/wizards`... ẩn cho mọi viewer (không chỉ khách), vì cùng là chế độ chỉ đọc.
- Sửa test cũ ngoài danh sách test của WB-1 (bắt buộc vì hook mới): `test/app/fetch-mock.ts` (mặc định trả owner cho `GET …/access`, export `accessRoute`), `routes-util.test.ts`, `issues/{comments,interaction-card,title-editor}.test.tsx`. WB-3 sửa `test/features/issues/*` sau nên không đụng nhau.
- Không sửa `e2e/ba-ids.json` (thuộc E2E-1). Mã S20.x mới chưa có trong file đó; test hiện tại không bắt buộc.
- `ds/icons.ts` không sửa: dùng `ShieldCheck` (Góp ý) và `Users` (Thành viên) có sẵn.

## Câu hỏi hợp đồng cho SV-1
1. `GET /access` cho thành viên không có membership (admin instance): UI giả định `membershipRole: null`, `contributor: false`; xác nhận.
2. `GET /contributions` trả `{ items }`, `GET /contributors` trả `{ items }`, `/summary` trả `{ pending }` (đúng spec). `PUT/DELETE contributors` trả 204 (client không đọc body).
3. `Contribution.projectId/targetIssueId/title/body/decided*/result*` dùng `null` khi vắng, thời gian là ISO string. `materialize.description` là `string | null`.
4. Mã lỗi 409 đã dùng: `crew_contribution_not_materialized`, `crew_contributor_requires_viewer`; UI hiện `error` nguyên văn.

Status: DONE
