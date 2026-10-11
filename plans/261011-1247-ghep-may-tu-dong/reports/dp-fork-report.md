# DP (phía fork): deploy `crew/v3.5` @ `e80352848` (ghép máy tự động, trang Máy, danh sách Yêu cầu mới)

- Thời gian: 11/10/2026 14:52 → 15:03 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent.
- Kết quả: **DONE_WITH_CONCERNS.**
  - Prod chạy `crew-v3/paperclip:v3-e80352848`.
  - Migration `0014_machine_pairings.sql` đã áp.
  - Đã đặt `paperclipSshPublicKey` cho 2P Solutions.
  - Bản tin Mac mini vẫn 2xx.
  - T2 (chỉ các spec liên quan): 12/12 xanh, trong đó có 1 ca flaky.
  - Concern chính nằm ở mục 8: MacBook đang gửi bản tin bằng secret company, nên với code hiện tại nó **không ghép được**. Điều này chặn AC1 của nghiệm thu MacBook.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-286820b18` |
| Image sau | `crew-v3/paperclip:v3-e80352848` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261011-145732`, đưa về `v3-286820b18`. Bảng `0014` để nguyên vì chỉ thêm. Trường config thừa không làm hỏng gì (spec §12) |
| Backup DB | `20261011-1457`, do `deploy.sh` tự tạo: 38M, builtin ok |
| Backup compose | `docker-compose.yml.bak-20261011-145732`. Image cũ ghi ở `ops/previous-image-20261011-145732` |
| Backup config plugin | `/opt/crew-v3-spike/backups/plugin-config-crew.core-tps-20261011-145856.json`: quyền 600 root, 415 byte, là bản GET nguyên dòng config của 2P Solutions trước khi POST |
| Lui riêng config | POST lại `{companyId, configJson}` lấy từ file backup trên. Không bắt buộc, vì trường thừa vô hại |
| Script ops VPS | Mọi file `ops/*` trên VPS trùng sha256 với fork `e80352848`, nên không phải chép gì |

## 1. Cổng kiểm

Worktree `.worktrees/paperclip-r3-dp` chạy `git checkout --detach crew/v3.5`, ra `e80352848`, sạch. Có 5 commit so với prod `286820b18`: `ba7a7ef56`, `1f8c3f7a7`, `bced277b1`, `35e35c629`, `e80352848`.

- `crew/release/verify.sh` FULL chạy 14:52:11 → 14:55:28, rc 0, **XANH**.
  - check-core-hooks: `Hook một dòng: 5/5; vá lõi: 8; mục: 20; lỗi: 0`.
  - Test của check-core-hooks 13/13, plugin-state 5/5, policy-config 10/10, upgrade/compose/pull-backup 18/18.
  - Server crew: 684 test / 33 file. Adapter claude 17, codex 10, opencode 12.
  - Plugin: **462 test / 55 file** (trước là 434 / 53, phần thêm là ca ghép máy và migration 0014). Agents 136.
  - tsc 0 lỗi. Bundle plugin không có `require("react")` trần.
- ops `node --test crew/ops/*.test.mjs`: 75/75.
- crew-web:
  - `test`: 137 file, 1167 pass, 1 todo;
  - `typecheck`: sạch;
  - `biome check src test e2e`: 505 file sạch.

## 2. Deploy

1. `active-runs.sh` rỗng trước khi build và trước khi deploy.
2. `overlay-source.sh e80352848`: 31 file server. Tarball có 165 mục, trong đó có `packages/crew-plugin/migrations/0014_machine_pairings.sql`.
3. `overlay-job.sh e80352848` trên VPS: `JOB_EXIT rc=0`, `min_avail=5121MiB`.
4. `inspect-image.sh` trên VPS: rc 0.
   - `issues crewCoreHooks=3`.
   - Đủ 15 file crew.
   - `crew-ui=e80352848…`.
   - Vá adapter P2–P7 ok.
   - Chỉ có `WARNING host adapter check SKIPPED`, như mọi lần.
5. `inspect-image.sh` chạy từ Mac (`DOCKER_HOST=ssh://nhamoiplatform`, HEAD `e80352848`): rc 0, 0 MISSING, FAIL hay WARN.
6. **Manifest không thêm capability.** Dòng `plugin bundle ok; manifest …` của image cũ và image mới có cùng sha256 `43f3560866b0`. Thư mục migrations của image mới kết thúc ở `0013`, `0014`.
7. `deploy.sh crew-v3/paperclip:v3-e80352848` chạy 14:57:23 → 14:57:59, rc 0. Nó tự backup DB, plugin `healthy`, và in `deploy ok: … v3-286820b18 -> … v3-e80352848, rollback TS=20261011-145732`.

**Thứ tự migration rồi worker** đúng như plan: `deploy.sh` thay cả container, plugin chạy migration khi nạp, rồi mới nhận webhook. Không reload riêng worker.

## 3. Kiểm 0014 trước khi đi tiếp

| Kiểm | Kết quả |
|---|---|
| `plugin_migrations` của `crew.core` | `0014_machine_pairings.sql` `applied` lúc 14:57:57, không có lỗi. `0013` vẫn `applied` |
| Bảng `plugin_crew_core_0433ea20b6.machine_pairings` | Đủ 12 cột đúng spec §3, có 0 dòng |
| Dòng `plugins` | `crew.core` `ready`. `plugin-state.sh` trả `healthy` |
| `/api/health` | `ok`, commit `e803528481e5` |
| Bản tin Mac mini ngay sau deploy, trước khi đặt config | `crew-mac status send` lúc 14:58:20 trả `ok: true`, HTTP 200. Log server có 3 lần `POST …/webhooks/machine-status` đều 200, không có `pairing_unavailable` |

0014 đã áp, nên em đi tiếp.

## 4. Fingerprint host key Mac mini

Đường thật lấy theo `paths.hostKey` (`apps/crew-mac/src/paths.ts:27`, ra `~/.crew-mac/sshd/host_ed25519`).

```
ssh-keygen -lf ~/.crew-mac/sshd/host_ed25519.pub
256 SHA256:UeSt0eAbsCJuudADVkJAxsutlwIPccY70RE4lMn4FKQ crew-mac-host (ED25519)
```

Em ghi lúc 14:53:21, trước deploy. Đọc lại lúc 15:03:16 vẫn y hệt (phục vụ AC6).

## 5. Config `paperclipSshPublicKey`

**Phạm vi là từng company, không phải toàn instance.**
- `GET`/`POST /api/plugins/:id/config` đọc và ghi một dòng config theo `companyId` (`server/src/routes/plugins.ts:2274-2361`, `registry.upsertConfig(plugin.id, companyId, …)`).
- `pairing.ts:93` đọc bằng `ctx.config.get(companyId)`.
- Vì vậy em chỉ đặt cho 2P Solutions (`5befeb1a…`), đúng như plan. Crew E2E không có trường này, nên `pair-info` của Crew E2E sẽ trả 409. T2 không dùng tới đường này.

**Các bước:**
1. `GET` nguyên dòng config của TPS rồi lưu backup (mục Mốc lui). `configJson` lúc đó chỉ có `companies` (1 mục `{companyId, webhookSecretRef}`).
2. Giá trị lấy từ `paperclipKey` trong `~/.crew-mac/manifest.json` của Mac mini, đi qua stdin của ssh. Nó không nằm trong argv và không được in ra. Kiểm theo pattern `^ssh-ed25519 …` xong mới gộp.
3. Gộp **chỉ thêm** `paperclipSshPublicKey`, rồi `POST /api/plugins/crew.core/config` lúc 14:59:09. Phản hồi có `lastError: null`.
4. Đọc lại:
   - `companies` trùng **từng byte** với bản backup (so `json.dumps` chính xác);
   - mọi khóa khác cũng trùng;
   - id dòng không đổi;
   - khóa hiện có là `companies` và `paperclipSshPublicKey`.

Key đã đặt: `ssh-ed25519`, fingerprint `SHA256:E13Uaf2qTo+cFsRw3AXkJqLroyyZwoYxOW2FC1+Agu0`. Fingerprint này trùng với key riêng Paperclip trên VPS (`/opt/crew-v3-spike/ssh/paperclip_ed25519`, comment `crew-v3-spike-paperclip`), tức đây đúng là key Paperclip dùng để SSH.

**Ngay sau đó:**

| Kiểm | Kết quả |
|---|---|
| `~/.crew/bin/crew-mac status send` trên Mac mini (14:59:16) | `ok: true`, HTTP 200. Cả hai target 2xx: `5befeb1a` 200 và `a7132a14` 200 |
| `GET /api/plugins/crew.core/api/machines/pair-info?companyId=5befeb1a…` | HTTP 200, body chỉ có `paperclipSshPublicKey`. Key `ssh-ed25519` có fingerprint `SHA256:E13Uaf2q…Agu0`, đúng key vừa đặt |
| `check-crew-companies.sh` | `ok 2 company` (binding secret của TPS vẫn còn) |
| Trang Máy 2P Solutions (`crew.machines` và UI) | Có `Phans-Mac-mini.local`, đang trực tuyến, lần cuối 15:02, `pairing: null`. Có cả `Phans-MacBook-Pro.local`, đang trực tuyến, `pairing: null`. Không có nhãn "Đã ghép" và không có nút "Gỡ máy", đúng thiết kế vì chưa máy nào ghép. Ảnh chụp chỉ đọc (đăng nhập board, không thao tác ghi) nằm ở scratchpad phiên `dp/shots/tps-machines.png` |
| Bản tin Mac mini lần cuối (15:02:48) | `ok: true`, HTTP 200 |

## 6. T2 (Playwright prod, Crew E2E, stub, `CREW_E2E_BASE_KEY=e2e-base4`)

Em chỉ chạy các spec liên quan, không chạy cả bộ. `PW-S15-PAIR` chỉ dành cho t1 nên bỏ qua trên T2.

Grep: `PW-S2-3 |PW-S4-|PW-S6-POPUP|PW-S20-[123] |AC5 không nút chết: /(machines|issues) `.

- Lượt chạy 15:00:24 → 15:02:32 (1,9 phút), rc 0.
- Kết quả: **11 passed, 1 flaky** (lần retry xanh), 0 failed.
- Run-e2e đã quét trace: không chứa mật khẩu.

| Ca | Kết quả |
|---|---|
| PW-S2-3 widget Máy khớp `crew.machines` | Xanh |
| AC5 không nút chết `/machines` (trang Máy có nút Gỡ mới) | Xanh |
| AC5 không nút chết `/issues` (danh sách Yêu cầu mới) | Xanh |
| PW-S4-1..4 | Xanh |
| PW-S6-POPUP-1 | Xanh |
| PW-S6-POPUP-2 | **Flaky.** Lần đầu đỏ vì `toHaveURL` của tab mới chờ "navigation to finish" quá 15 giây. Tab đã điều hướng đúng `/CRE/issues/CRE-214`, chỉ có sự kiện load trên prod chậm. Lần retry xanh trong 5,7 giây. Đây là lỗi thời gian, không phải lỗi sản phẩm |
| PW-S20-3 | Xanh |

Em có chạy thêm PW-S20-1 và PW-S20-2, cả hai xanh. S20-3 nằm trong `describe` serial và dùng `requestTitle`/`commentText` do hai ca này tạo (DP-1 từng thấy S20-3 đỏ khi hai ca này bị skip), nên không chạy riêng S20-3 được.

## 7. `agent-permissions.sh --all-crew --check`

Em chạy trên VPS lúc 15:00:36, rc 0.
- Hai company Crew `5befeb1a…` và `a7132a14…`: không có dòng lệch nào.
- Đã có rule skill-policy `crew-deny-agent-skill-writes`.
- Inbox policy của owner đang `disabled`.
- Pipeline 0, tool connection 0.

## Log và an toàn

- Log server 6 phút sau deploy:
  - 0 token (`access_token`, `refresh_token`, `id_token`, `Bearer`, `sk-ant`);
  - 0 chuỗi public key;
  - 0 `INVOCATION_SCOPE_DENIED`, `host refused`, `pairing_unavailable`, `machine_revoked` hay `bad_signature`;
  - 0 dòng level 50 trở lên.
- Site: `/` trả 200 (`crew-ui=e80352848`), `/paperclip/` 200, `/api/health` 200.
- Không in secret nào. Public key chỉ in loại và fingerprint. Email và mật khẩu board đi qua pipe, vào biến môi trường của process.
- Không sửa mã, không commit, không push, không tạo tag, không DELETE environment, không `rm -rf`.
- 2P Solutions: chỉ đổi dòng config plugin (thêm một trường) và mở trang Máy để đọc. Không tạo nội dung.
- Crew E2E: S20-1/2 để lại 2 mục góp ý `pending` (một yêu cầu, một bình luận). Mỗi lượt S20 đều sinh ra như vậy, nên em để nguyên. T2 có tạo thêm issue thử (ví dụ `CRE-214`).
- `active-runs` rỗng lúc kết thúc. Không còn process nào em khởi tạo (Playwright, vitest, chromium đều đã thoát).
- Worktree `paperclip-r3-dp` đang detached `e80352848`, sạch.

## 8. Concern

1. **MacBook không ghép được với code hiện tại. Cần quyết trước khi nghiệm thu MacBook.**
   - `crew.machines` của TPS đã có `Phans-MacBook-Pro.local` (`machineId 357c4a31…`). Máy này đang trực tuyến và gửi bản tin 2xx bằng **secret company**, tức có dòng `machine_latest` nhưng không có dòng ghép.
   - Theo `pairing.ts:114-124` (spec §4), `POST /machines/pair` cho máy như vậy luôn trả `409 machine_uses_company_secret`, kể cả khi có `allowRepair`.
   - Phía app (`crew-pair`, `machine-step.ts`):
     - máy có sẵn mà `testStatus` 2xx thì **không ghép**;
     - nếu có gọi ghép thì sẽ gặp 409 và báo `USES_COMPANY_SECRET_MESSAGE`.
   - Cả hai trường hợp đều không sinh dòng `machine_pairings`, nên **AC1 không đạt được** theo kịch bản §5 hiện tại.
   - Cần controller hoặc owner chọn một trong các hướng sau:
     - (a) MacBook dùng `machineId` mới;
     - (b) có đường ops gỡ `machine_latest` của MacBook trước khi ghép, nhưng việc này đụng dữ liệu, cần owner duyệt;
     - (c) đổi luật ghép cho máy chưa phải Mac mini.
   - Em không làm gì ở phía này.
2. **PW-S6-POPUP-2 flaky trên prod.** Hạn 15 giây cho `toHaveURL` của tab mới bị sát khi trang tải chậm. Nên tăng timeout hoặc chờ `domcontentloaded` (một FX test nhỏ).
3. **Cảnh báo ajv khi POST config:** `strict mode: missing type "number,string" for keyword "format" at "#/properties/companies/items/properties/webhookSecretRef"`. Đây là cảnh báo schema có từ trước (trường `webhookSecretRef`), không chặn lưu (`lastError: null`).
4. **Ảnh chụp docs của Mac mini lỗi, có từ trước deploy.** `crew-mac status` in `không gửi được ảnh chụp docs của c31226f9…` từ trước 14:57 (196 dòng trong `~/.crew/logs/status.log`), và trong log server không thấy request `docs-snapshot` nào bị từ chối. Không liên quan tới bản này, nhưng nên xem riêng.
5. **Cửa sổ restart.** Lúc recreate container có 1 lần bản tin Mac mini lỗi (`ECONNREFUSED` ở TPS, 502 ở Crew E2E). Lần gửi kế tiếp đã 200. Đây là hành vi đúng khi restart.
6. **Gợi ý.** Nếu owner muốn, gắn tag cho bản đang chạy prod (`crew/v3.5` hiện đã trỏ `e80352848`). Em không tạo tag mới.

Status: DONE_WITH_CONCERNS
Summary: Prod chạy `crew-v3/paperclip:v3-e80352848` (rollback: `ops/rollback.sh 20261011-145732` về `v3-286820b18`), 0014 đã áp, plugin healthy. `paperclipSshPublicKey` đã gộp vào config của 2P Solutions (`companies[]` trùng từng byte, fp `SHA256:E13Uaf2q…Agu0`), pair-info trả đúng key, Mac mini vẫn gửi bản tin 200 và vẫn hiện trên trang Máy. T2 các spec liên quan 12/12 xanh (1 flaky), `agent-permissions --check` rc 0. Concern chính: MacBook đang dùng secret company, nên `pair` sẽ trả 409 `machine_uses_company_secret` và AC1 bị chặn cho tới khi có quyết định.
