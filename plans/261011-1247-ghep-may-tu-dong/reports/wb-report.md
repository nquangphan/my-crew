# WB — Web ghép máy — Báo cáo

Ngày: 11/10/2026 (Asia/Ho_Chi_Minh). Worktree `~/Documents/projects/crew/.worktrees/paperclip-issues-ui`, nhánh
`crew/pair-wb`, commit `bced277b1` (chưa push).

## Kết quả

WB xong. Thẻ máy trên trang Máy có nhãn ghép, owner có nút "Gỡ máy" kèm hộp xác nhận, và e2e `PW-S15-PAIR` đạt.

## Hành vi

- Máy có `pairing` hiện "Đã ghép <giờ>" hoặc "Đã gỡ <giờ>" (giờ Asia/Ho_Chi_Minh, định dạng `dd/MM/yyyy HH:mm`).
  Máy không có `pairing` (Mac mini cũ) không có nhãn lẫn nút.
- Nút "Gỡ máy" chỉ khi `useCompanyAccess().isOwner` và máy chưa `revokedAt`. Hộp xác nhận dùng câu của spec §8.
- Xác nhận thì chạy hai bước tuần tự: `PATCH /api/environments/:id {status:"archived"}` (có sẵn `api.environments.archive`),
  rồi `POST /machines/:machineId/unpair` với `{companyId}`. Không có đường DELETE nào. Lỗi hiện nguyên văn, nút còn đó,
  bấm lại chạy lại cả hai bước. Xong thì làm mới dữ liệu `crew.*`.

## File

- Mới: `src/features/machines/pairing-block.tsx`, `src/api/crew/machines.ts` (client `unpair`),
  `test/features/machines/pairing-block.test.tsx` (8 ca), `e2e/specs/s15-machine-pairing.spec.ts`.
- Sửa: `src/api/endpoints.ts` (`machines.unpair`, mã BA `S15.4`), `src/api/index.ts`, `src/api/crew/types.ts`
  (export `CrewMachinePairing`), `src/features/machines/machines-page.tsx`, `locales/vi.json`, `locales/en.json`,
  `test/features/machines/fixtures.ts` (`pairing`), `e2e/ba-ids.json`, `e2e/coverage.json` (thêm `S15.4`).
- Không sửa `ds/widgets/crew/machine-card.tsx`: nhãn và nút là một khối riêng của trang Máy đặt trong thẻ, giống
  `RuntimeBlock`, nên widget dùng chung với Dashboard không đổi.

## Kiểm

- `@crew/paperclip-web test`: 137 file, 1165 ca đạt. `typecheck` đạt. Biome (`src`, `test`, `e2e`) sạch.
- Ca unit: nút chỉ cho owner (viewer thấy nhãn, không thấy nút), "Đã gỡ" không nút, máy không ghép không nhãn, hủy hộp
  xác nhận không gọi gì, thứ tự PATCH rồi POST và không có DELETE, archive lỗi thì không unpair và bấm lại đi tiếp,
  unpair 404 hiện nguyên văn.
- `vite build` với `CREW_UI_COMMIT` đặt theo SHA của HEAD lúc chạy (`1f8c3f7a7`, trước commit), ra thư mục scratch: đạt.
- T1 (`--grep "PW-S15-PAIR|PW-S2-3"`, plugin build lại, migration 0014 đã áp), chạy hai lần: đạt cả hai.
  `PW-S2-3` là ca máy duy nhất có sẵn ngoài spec mới.

## E2E PW-S15-PAIR

Gắn `@t1 @t1-only` (chỉ T1, không chạy ở T2 vì ca đổi secret webhook). Dựng: secret mới có giá trị biết trước, trỏ
`companies[].webhookSecretRef` sang nó (config cũ được trả lại cuối ca, đã kiểm secretId cũ còn nguyên), environment SSH
qua REST, `POST /machines/pair`, một bản tin ký bằng key máy. Kiểm UI: nhãn "Đã ghép", bấm Gỡ máy, xác nhận, thẻ "Đã gỡ"
không nút. Kiểm API: environment `archived`, `pairing.revokedAt` có giá trị, bản tin ký bằng key cũ bị từ chối (>= 400),
unpair máy lạ trả 404.

## Cần biết

- `~/crew-ga-t1/env.sh` trỏ `FORK` tới worktree `paperclip-ga-e2e` đã không còn. Em khởi động server T1 với
  `FORK=` worktree này; không sửa `env.sh`. README e2e vẫn ghi `~/crew-r3-t1`, em để nguyên (ngoài phạm vi).
- Mỗi lượt e2e để lại một environment đã archive, một dòng ghép đã gỡ và hai secret mồ côi trong DB T1 (DELETE secret
  best-effort không chắc có route). Chỉ là dữ liệu T1.
- `README.md` của e2e chưa nhắc spec mới.

## Tiến trình

Đã dừng server T1 (listener 3199, Postgres nhúng) và web dev 5183 bằng SIGTERM. Cổng 3199, 5183, 54329 đã trống.
