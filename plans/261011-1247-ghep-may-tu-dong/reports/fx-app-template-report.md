# fx-app-template: khuôn environment phải có secret của company

Worktree `.worktrees/crew-pair`, nhánh `r25-pair`. Chưa push.

## Nguyên nhân
Environment là của cả instance; `GET /companies/:id/environments` có thể trả environment company khác. Bước Máy
(`inPlaceSshTemplates(envs)[0]`) và `getTemplate` của add-project lấy khuôn đầu tiên theo tên nên chép secret company khác.

## Sửa
- `PaperclipClient.secrets(companyId)`: `GET /api/companies/:id/secrets` (route fork `secrets.ts`: `assertBoard` +
  `assertCompanyAccess`, board key của app đủ quyền). Chỉ giữ `id`, `name`.
- `add-project.ts`: `isCompanyTemplate`, `inPlaceSshTemplates(envs, secretIds)` (bắt buộc truyền tập secret),
  `companySecretIds`. `getTemplate`: environment đã ghép cũng phải có secret của company; thứ tự ưu tiên (ghép trước,
  rồi theo tên, cùng cổng) giữ nguyên. Không có khuôn hợp lệ: lỗi tiếng Việt nêu rõ environment company khác không dùng được.
- `machine-step.ts`: lọc khuôn theo tập secret; không có thì báo tiếng Việt tương tự, không tạo/ghép.
- Không có lệnh DELETE nào được thêm.
- Docs: `docs/flows/mac-app.md`, `docs/flows/mac-app-paperclip.md`; `crew-docs check --staged` ok.

## Test
Thêm: client `secrets`; machine-step (env company khác đứng đầu, chỉ có env company khác); add-project (env company khác
cùng cổng đứng đầu, chỉ có company khác, environment đã ghép dùng secret company khác). Fixture có endpoint `/secrets`.
Kết quả: vitest mac-app 617/617, `node --test scripts/*.test.mjs` 24/24, `tsc --noEmit` sạch, `biome check .` sạch.
Không build, không cài.

## Lưu ý
- Secret có sẵn của environment cùng tên (`same.config.privateKeySecretRef`) ở bước Máy vẫn dùng nguyên, không kiểm
  theo company (theo tên môi trường `may-…`, không thuộc phạm vi yêu cầu).
