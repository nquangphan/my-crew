# FX2 — Gỡ máy đang dùng secret company — Báo cáo

Ngày: 11/10/2026 (Asia/Ho_Chi_Minh). Worktree `~/Documents/projects/crew/.worktrees/paperclip-issues-ui`, nhánh
`crew/pair-wb`. Có một commit mới, chưa push: `bd0ac8d5b` fix(machines): cho gỡ máy đang dùng secret company để
chuyển sang ghép.

## Kết quả

- **Plugin `unpair`:**
  - Máy chưa có dòng ghép nhưng có trong `machine_latest` của company: plugin ghi một dòng **đã gỡ sẵn**. Dòng này lấy
    `hostname` từ `machine_latest`, không có environment, IP, cổng hay fingerprint, và có `paired_at`/`paired_by_user_id`
    null. `key_nonce` là 32 byte ngẫu nhiên, key của nó không bao giờ được trao cho ai.
  - Câu ghi là `INSERT … SELECT … FROM machine_latest … ON CONFLICT DO NOTHING`, sau đó là `UPDATE` cũ cho dòng còn
    hiệu lực. Vì vậy nó không đè dòng có sẵn và vẫn idempotent.
  - Webhook không đổi code: dòng đã gỡ làm nó trả `machine_revoked`, kể cả với secret company.
  - Chỉ trả 404 (`"Không có máy này trong company"`) khi máy không có ở cả hai bảng. `environmentId` trong response giờ
    có thể là `null`. Log `crew machine unpaired` có thêm `usedCompanySecret`.
- **Plugin `pair`:** không đổi logic. Dòng đã gỡ sẵn đi đúng đường máy đã gỡ: thiếu `allowRepair` thì nhận 409
  `machine_revoked`, có cờ thì ghép như thường và điền đủ thông tin. Khi chưa có dòng ghép, `machine_uses_company_secret`
  vẫn chặn như cũ.
- **Migration `0015_machine_pairings_unpaired_removal.sql` (mới):** bỏ `NOT NULL` ở 6 cột thông tin ghép, và thêm check
  `machine_pairings_active_facts_check`: dòng chưa gỡ phải đủ 6 cột đó. Migration đi qua validator thật của host.
- **Data `crew.machines`:** `CrewMachinePairing` giờ là union. Ngoài dạng cũ có thêm
  `{pairedAt: null, revokedAt, environmentId: null, tailscaleIp: null}` cho máy gỡ khi còn dùng secret company.
- **Web:**
  - Owner thấy "Gỡ máy" trên mọi máy chưa gỡ. Viewer không thấy nút trên máy chưa ghép.
  - Với máy chưa ghép, nút chỉ gọi `unpair` và bỏ bước đọc, đối chiếu host và archive environment. Hộp xác nhận có câu
    riêng, cảnh báo mạnh hơn: máy đang gửi bằng secret chung, gỡ thì mọi bản tin bị từ chối kể cả ký bằng secret chung,
    và muốn dùng lại phải bấm "Ghép lại" trong app.
  - Hộp xác nhận của máy đã ghép cũng thêm câu nhắc "Ghép lại".
  - Thẻ đã gỡ, kể cả dạng mới, hiện "Đã gỡ <giờ>" và không có nút.

## Kiểm

- Plugin, chạy từng file một:
  - `machine-pairing.db.test.ts`: 23 đạt. Có 3 ca mới: gỡ máy dùng secret company kèm webhook từ chối và máy khác (Mac
    mini, máy thứ ba) không ảnh hưởng; ghép lại có hoặc thiếu `allowRepair`; check của bảng. Ca 404 viết lại cho máy lạ,
    gồm cả máy chỉ có bản tin ở company khác.
  - `migration-0015.db.test.ts` (mới): 1 đạt.
  - `webhook.test.ts`: 25 đạt.
  - `machines.test.ts` (giờ áp thêm 0015): 4 đạt.
  - `migration-0014.db.test.ts`: 1 đạt.
  - `roles.db.test.ts`: 3 đạt.
  - Typecheck và build plugin đều đạt.
- crew-web:
  - Vitest toàn gói: 137 file, 1171 ca đạt, 1 todo. Có 5 ca mới cho máy chưa ghép, và 1 ca cũ được viết lại.
  - Guard design-system đạt. Em đã bỏ `ml-auto` vì guard không cho phép.
  - Typecheck (gồm e2e) đạt. Biome `src test e2e` sạch.
- T1:
  - Server dùng `FORK` là worktree này, plugin build lại, migration 0015 tự áp khi plugin kích hoạt.
  - `--grep "PW-S15-PAIR"` đạt 2/2. Ca mới: máy gửi bằng secret company, Gỡ trên web, thẻ "Đã gỡ", secret company bị
    từ chối, ghép lại thiếu cờ thì 409 `machine_revoked`, có `allowRepair` thì key mới được nhận, secret company vẫn bị
    chặn, và thẻ về "Đã ghép".
  - Em chạy lại lần hai sau khi sửa layout nút, vẫn đạt 2/2. Log server có `machine_revoked`.
- Tiến trình: em dừng server 3199, web 5183 và Postgres nhúng 54329 bằng SIGTERM. Cả ba cổng đã trống.

## Spec (`docs/superpowers/specs/2026-10-11-crew-v3-ghep-may-design.md`, chưa commit)

- §3: thêm migration 0015 và bảng **trạng thái ghép** gồm 4 trạng thái.
- §4: dòng `unpair` trong bảng route, và mục mô tả `unpair`.
- §4: kiểu `pairing` của data.
- §5: dòng đã gỡ chặn cả secret company.
- §8: nút trên mọi máy chưa gỡ, hai câu xác nhận, luồng của máy chưa ghép, và rủi ro member: `unpair` rồi `pair` kèm
  `allowRepair` chiếm được `machineId` của máy dùng secret company.
- §9: sửa một dòng và thêm một dòng.
- §10: ca test.
- §12: rollback.

## Cần biết

- **Deploy (DP):** giờ có hai migration là `0014` và `0015`. `plan.md` chưa nhắc `0015` và em không sửa `plan.md` vì
  ngoài phạm vi. Quy tắc cũ vẫn đúng: áp migration trước, reload plugin sau.
- **Rollback về image prod cũ:** plugin cũ không đọc bảng ghép, nên máy đã gỡ khi còn dùng secret company sẽ lại được
  nhận bằng secret company. Em đã ghi điều này vào §12.
- **Thứ tự cho MacBook thật:** owner bấm Gỡ máy trên web, rồi app bấm "Ghép lại", tức là gọi `pair` kèm
  `allowRepair: true`. App phải gửi cờ này. Việc đó thuộc phần app.
- **Dữ liệu T1:** mỗi lượt e2e để lại thêm một dòng đã gỡ hoặc đã ghép lại của máy giả, cộng với secret mồ côi như
  trước.

Status: DONE
Summary: "Gỡ máy" giờ dùng được cho máy đang gửi bằng secret company. Plugin ghi dòng đã gỡ sẵn (migration 0015), nên
webhook chặn máy đó và chỉ ghép lại có `allowRepair` mới đưa máy về. Mọi test liên quan, typecheck, biome và
PW-S15-PAIR 2/2 trên T1 đều đạt, các cổng đã trống. Commit `bd0ac8d5b`, chưa push.
