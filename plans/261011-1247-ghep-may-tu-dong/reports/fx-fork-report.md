# FX — Sửa review phía fork — Báo cáo

Ngày: 11/10/2026 (Asia/Ho_Chi_Minh). Worktree `~/Documents/projects/crew/.worktrees/paperclip-issues-ui`, nhánh
`crew/pair-wb`. Có hai commit mới, chưa push:
- `35e35c629` fix(crew-plugin): chặn ghép lại máy đã gỡ và ghép đè máy dùng secret company;
- `e80352848` fix(crew-web): Gỡ máy đối chiếu host environment trước khi archive.

## Kết quả theo từng điểm

- **I1:** máy đã gỡ gọi `pair` thì nhận `409 {error, code:"machine_revoked"}`, trừ khi body có `allowRepair: true`.
  Validation nhận thêm đúng key này. Nếu có thì nó phải là boolean, nếu không thì trả 400.
- **I2:** máy đã có trong `machine_latest` mà chưa có dòng ghép (tức Mac mini) gọi `pair` thì nhận
  `409 {error, code:"machine_uses_company_secret"}`, kể cả khi có `allowRepair`. Máy đã ghép và chưa gỡ ghép lại thì
  vẫn được, và lần ghép đó xoay key. Spec §8 có thêm mục "Ai ghép, ai gỡ được" và phần rủi ro còn lại. Bảng §9 có
  thêm hai dòng.
- **M1:** điều kiện và lần ghi nằm chung một câu `INSERT … SELECT … WHERE … ON CONFLICT … DO UPDATE … WHERE`. Key được
  dẫn xuất từ nonce mà chính lần gọi đó ghi, và không còn bước đọc lại. `pairedAt` được bind vào câu ghi nên khớp với
  giờ đã lưu. **Lệch so với quyết định:** em không dùng được `RETURNING`. Lý do là `ctx.db.execute` của host chỉ trả
  `{rowCount}` (`server/src/services/plugin-database.ts:565-570`), còn `ctx.db.query` chặn mọi từ khóa ghi
  (`:261`). Mục tiêu vẫn đạt: test xác nhận ba lần ghép đồng thời ra ba key khác nhau và chỉ key của lần ghi sau còn
  sống. `rowCount = 0` nghĩa là câu ghi bị điều kiện chặn. Khi đó plugin đọc dòng ghép để chọn mã 409, rồi ghi log
  warn `crew machine pairing refused` (log không có key).
- **M2:** không đổi code. `plan.md`, mục DP, bước deploy 2, có thêm ghi chú: "migration trước, worker / reload plugin
  sau". Nếu `0014` chưa áp thì dừng.
- **M3:** khi bấm Gỡ máy, web gọi `GET /api/environments/:id` (endpoint mới `environments.get`, mã BA `S15.4`) và so
  `config.host` với `pairing.tailscaleIp`. Nếu lệch, hoặc không đọc được `host`, thì web báo lỗi và không archive,
  không unpair. Server che `config` với người không phải instance admin, nhưng PATCH archive vốn đã đòi instance admin
  nên không mất trường hợp nào.

## File

- Plugin: `packages/crew-plugin/src/machines/pairing.ts`, `src/__tests__/machine-pairing.db.test.ts`.
- Web: `packages/crew-web/src/api/endpoints.ts`, `src/api/paperclip/environments.ts`,
  `src/features/machines/pairing-block.tsx`, `src/features/machines/locales/{vi,en}.json`,
  `test/features/machines/pairing-block.test.tsx`, `e2e/specs/s15-machine-pairing.spec.ts`. Ca e2e kiểm thêm việc
  ghép lại máy đã gỡ mà thiếu cờ thì nhận 409 `machine_revoked`.
- Ngoài repo, không commit: spec `docs/superpowers/specs/2026-10-11-crew-v3-ghep-may-design.md` (§4, §6.2 bước 7,
  §8, §9, §10) và `plans/261011-1247-ghep-may-tu-dong/plan.md` (DP).

## Kiểm

- Plugin typecheck đạt. Build plugin đạt.
- Test plugin chạy từng file một:
  - `machine-pairing.db.test.ts`: 20 đạt. Trước đó là 16; có 4 ca mới (I1, I2 kèm xoay key, M1 đồng thời, `pairedAt`)
    và thêm ca body sai cho `allowRepair`.
  - `webhook.test.ts`: 25 đạt.
  - `machines.test.ts`: 4 đạt.
  - `migration-0014.db.test.ts`: 1 đạt.
  - `roles.db.test.ts`: 3 đạt.
- crew-web:
  - Vitest: 137 file, 1167 ca đạt, 1 todo. Có 2 ca M3 mới, và ca thứ tự giờ kiểm GET environment chạy trước PATCH.
  - Typecheck (gồm `e2e/tsconfig.json`) đạt.
  - Biome `src test e2e` sạch.
- T1, server chạy với `FORK` là worktree này, plugin build lại và nạp từ `paperclip-issues-ui/packages/crew-plugin`:
  `--grep "PW-S15-PAIR"` đạt 1/1. Log server có `crew machine pairing refused … code: machine_revoked`.
- Tiến trình: server 3199, web 5183 và Postgres nhúng 54329 đã dừng bằng SIGTERM. Cả ba cổng đã trống.

## Cần biết

- User yêu cầu ghi vào "spec §8", nhưng bảng bảo mật thật nằm ở §9 (review gọi nhầm là §8). Em ghi nội dung chính vào
  §8 (Web: trang Máy) như được giao, và thêm dòng tương ứng vào bảng §9.
- App (AP) phải xử lý hai mã 409 mới theo spec §6.2 bước 7. App không tự gửi `allowRepair`, chỉ gửi khi owner xác
  nhận ghép lại. Phần này chưa làm ở fork vì nằm ngoài phạm vi.
- Mỗi lượt e2e vẫn để lại dữ liệu T1 như WB đã ghi: một environment đã archive, một dòng ghép đã gỡ và secret mồ côi.

Status: DONE_WITH_CONCERNS
Summary: I1, I2, M1 và M3 đã sửa và có test. M2 đã ghi vào DP. Mọi test liên quan, typecheck, biome và PW-S15-PAIR
trên T1 đều đạt, các cổng đã trống. Điểm cần lưu ý: M1 không dùng được `RETURNING` vì `ctx.db.execute` của host chỉ
trả `rowCount`, nên em dẫn xuất key từ nonce của chính lần ghi. Mục tiêu "không hai người gọi nhận cùng key" vẫn đạt.
