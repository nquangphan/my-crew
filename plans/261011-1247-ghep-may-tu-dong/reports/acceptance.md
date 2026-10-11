# Nghiệm thu MacBook: ghép máy tự động (plan §5.1 bước 3, 4, 5, 7, 8)

- Thời gian: 11/10/2026 15:35 → 15:43 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent.
- Phạm vi: bước 3, 4, 5 (chỉ fingerprint), 7 và 8 ở plan §5.1. Chưa làm bước 10 (sau khi gỡ), vì owner sẽ gỡ sau.
- Kết quả: **DONE_WITH_CONCERNS.**
  - AC1, AC2, AC3 và AC7 đạt. Phần AC6 kiểm được trước khi gỡ cũng đạt.
  - **AC4 không đạt.** Environment MacBook trỏ tới secret SSH của company **Crew E2E**. Run bị cổng tải giữ với lỗi
    `Secret must belong to same company` và không chạy trên MacBook. Đây là lỗi app ở bước Máy (mục 4).

## Trạng thái lúc bắt đầu

- MacBook đã ghép lúc 15:34:18. Wizard đã ở `setup.step = done` ngay lần đọc đầu tiên (15:35), nên không phải chờ.
- `app.json` có:
  - `companyId 5befeb1a…` (2P Solutions);
  - `pairedEnvironmentId f8aab013-b71b-40e0-bd5a-852cc91bc066`;
  - origin `https://crew.2p-solutions.com`.
- Bản `crew-mac` đã cài trên MacBook có sẵn lệnh `node`, nên không phải dùng bản kèm trong `.app`.
- **Sự cố đã biết:**
  - Environment `f8aab013` bị app archive do lỗi app.
  - Controller kích hoạt lại environment này bằng DB lúc 15:32:37 (`updated_at` của dòng là `15:32:37.700044`).
  - Bản backup của dòng trước khi sửa: `/opt/crew-v3-spike/backups/env-f8aab013-20261011-153237.tsv`, 693 byte. Trong bản
    này dòng có `status = archived`, và `privateKeySecretRef.secretId` đã là `f8c68dce…`. Vậy secret sai có từ lúc app
    tạo environment (15:31:48), không phải do lần sửa DB.
  - Log plugin có `machine_revoked` lúc 15:34:17, rồi `crew machine paired` lúc 15:34:18.

## 1. Kết quả theo AC

| AC | Kết quả | Bằng chứng |
|---|---|---|
| AC1 Ghép không dán gì | **Đạt** (theo DB). Em không chụp được ảnh bước Máy vì owner tự bấm | Có dòng `machine_pairings`: company `5befeb1a…`, machine `357c4a31-b3f9-4686-8c88-9aa7e2a1a6d1` (trùng `machineId` trong `~/.crew/status.json` của MacBook), hostname `Phans-MacBook-Pro`, env `f8aab013…`, `100.100.157.19:2222`, fingerprint `SHA256:5wr85CRL…T0os` (trùng host key MacBook), `paired_by_user_id` có giá trị, `paired_at` 15:34:18, `revoked_at` null. Environment `may-phans-macbook-pro`: `active`, `ssh`, `host=100.100.157.19`, `port=2222`, có `knownHosts`, `remoteWorkspacePath=/Users/phannhatquang/crew-agents`, `workspaceRealizationMode=in_place` |
| AC2 Doctor 0 lỗi | **Đạt** | `crew-mac doctor` lúc 15:36:43 thoát rc 0. Mọi mục ĐẠT, chỉ có 2 CẢNH BÁO về OpenCode (chưa có key, chưa có wrapper trong PATH; máy không chạy `opencode_local`). Có các mục: sshd do app giữ, reaper, job bản tin, bản tin gần nhất HTTP 200, node `/opt/homebrew/bin/node`, `claude -p` trả ok |
| AC3 Trang Máy hiện 2 máy | **Đạt** | Ảnh `reports/acceptance-tps-machines.png`, chụp 15:38 bằng Playwright, đăng nhập board, chỉ đọc. Thấy `Phans-Mac-mini.local` không có nhãn ghép, và `Phans-MacBook-Pro.local` có nhãn "Đã ghép 11/10/2026 15:34". Cả hai đều Trực tuyến, lần cuối 15:37. DB `machine_latest` của TPS có đúng 2 máy |
| AC4 Run thật trên env MacBook | **Không đạt** | Xem mục 3 và 4 |
| AC5 Gỡ máy | Chưa kiểm | Owner gỡ sau. Em không unpair gì |
| AC6 Mac mini không ảnh hưởng (phần trước khi gỡ) | **Đạt** | Fingerprint Mac mini `SHA256:UeSt0eAbsCJuudADVkJAxsutlwIPccY70RE4lMn4FKQ`, đọc lúc 15:37 và 15:42, trùng mốc. `machine_pairings` chỉ có 1 dòng (MacBook), không có dòng nào cho Mac mini (`039b7fe6…`). Bản tin Mac mini lúc 15:37:27: `ok: true`, HTTP 200, cả hai target `5befeb1a` và `a7132a14` đều 200. Phần "sau khi gỡ" và claim 204 để lại cho bước 10 |
| AC7 Node | **Đạt** | Xem mục 2 |

## 2. Bước 3–5: node và fingerprint

- **Bước 3.**
  - `~/.crew/bin/crew-mac node --json` trả `{"path":"/opt/homebrew/bin/node","source":"homebrew","version":"26.11.1"}`.
  - `grep -l Helper` trên launcher, hai plist `com.2p.crew-mac-{reaper,status}.plist` và `~/.zshenv` không in file nào,
    `rc=1`.
  - Launcher trỏ `/opt/homebrew/bin/node`.
- **Bước 4.**
  - Lệnh `crew-mac node --prefix <mktemp> --skip-system --json` in "Không thấy node ≥ 22… Đang tải Node LTS từ
    nodejs.org…", rồi trả `source: downloaded`, `version: 24.21.0`, rc 0, mất 35 giây.
  - `node -v` của bản vừa tải ra `v24.21.0`.
  - Checksum: code đã cài (`~/.crew/app/crew-mac/dist/node-runtime.js`) so sha256 của tarball với `SHASUMS256.txt`. Nếu
    lệch thì ném lỗi "không khớp SHASUMS256.txt", nên rc 0 nghĩa là checksum khớp.
  - Thư mục tạm đã bỏ bằng `trash`, không dùng `rm -rf`.
- **Bước 5 (fingerprint).**
  - Host key MacBook là `256 SHA256:5wr85CRL4fqo0PYcAfzHPKFkpJnH1v4YsJA07aPT0os crew-mac-host (ED25519)`, đọc lúc 15:36,
    tức là **sau** khi ghép, vì máy đã ghép lúc 15:34.
  - Giá trị này trùng `host_key_fingerprint` trong dòng ghép. Đọc lại lúc 15:42 vẫn y hệt.
  - Không kiểm Keychain, đúng phạm vi được giao.

## 3. Bước 8: run thật

| Bước | Giờ | Giá trị |
|---|---|---|
| `active-runs.sh` trước khi làm | 15:39 | Rỗng |
| Tạo agent thử | 15:39:21 | `938653b3-c13c-45ca-b86b-60da8fde9bc1` `kiem-ghep-may-macbook`. Cấu hình như `createAgent` của app: `claude_local`, `engine=cli`, command `~/.crew/bin/crew-claude-run`, extraArgs Superpowers 6.4.1 đã ghim, `claude-sonnet-5`, `env {}`, heartbeat tắt, `defaultEnvironmentId=f8aab013…` |
| Giới hạn quyền | 15:39 | `PATCH /agents/:id/permissions` với `{false,false,false}`, grants rỗng. `agent-permissions.sh 5befeb1a… --check` trả rc 0, dòng `938653b3 … off->off off->off off->off (đúng)` |
| Tạo issue | 15:39:43 | **TPS-116** `7fc3f2e2…` "[Kiểm ghép máy] tạo file pair-check.txt trong thư mục làm việc rồi báo done". Issue nằm trong project theo dõi "Phát triển Crew" (`c597c718…`, thuộc `trackingProjectIds` của TPS), nên không nhận policy Crew và không kéo reviewer/integrator. Kiểm lại thấy `executionPolicy = null` |
| Run | 15:39:43 | `0fea3d06-638a-47ba-ab4c-0e48981556b0` ở trạng thái `queued`. Lúc 15:39:44 có `crew.load_gate.waiting`: "không kết nối được (**Secret must belong to same company**)", env `f8aab013…`, hạn 16:39. Cổng tải cũng tự viết comment này vào issue |
| Dọn | 15:41–15:43 | Pause agent, `POST /heartbeat-runs/0fea3d06…/cancel` (run thành `cancelled`), rồi comment giải thích. Terminate agent. Issue không vào được `blocked` vì server đòi blocker hoặc `unblockDescriptor`, nên em đóng issue bằng `cancelled` |
| Sau khi dọn | 15:43 | `active-runs.sh` rỗng. Agent thử chỉ có 1 run (`cancelled`). `~/crew-agents` trên MacBook vẫn rỗng, không có `pair-check.txt` vì run chưa từng chạy |

Không có run nào khác bị ảnh hưởng. Trong 30 phút trước đó, company chỉ có đúng run này. Em không đụng environment nào và
không DELETE gì.

## 4. Nguyên nhân AC4 hỏng (đã đối chiếu code và DB)

- `privateKeySecretRef.secretId` của environment `may-phans-macbook-pro` là `f8c68dce-5ba7-498a-85d0-a6601719e016`. Đây là
  secret `crew-e2e-ssh` của company **Crew E2E** (`a7132a14…`). Agent của 2P Solutions thì phải dùng
  `fa7b4847…` (`environment-ssh-mac-mini-private-key-3f6e0b18`), là secret mà các env `mac-mini*` đang dùng.
- Ở `apps/mac-app/src/main/setup/machine-step.ts:137` (worktree `crew-pair`), code chọn
  `const template = inPlaceSshTemplates(envs)[0];` với `envs = client.environments(companyId)`.
  - Bảng `environments` không có `company_id`, nên danh sách trả về gồm environment của mọi company.
  - Sắp theo tên thì env đầu tiên là `business-app-assistant`, mà env này dùng secret Crew E2E.
- `add-project.ts` `getTemplate` có cùng lỗi ở nhánh máy chưa ghép (`inPlaceSshTemplates(envs).filter(port)[0]`).
  - **Có thể lỗi này đã xảy ra rồi:** 8 agent `visinote-*` và `business-app-*` của 2P Solutions (env tạo lúc 11:18 hôm
    nay) đều trỏ env dùng secret `crew-e2e-ssh`.
  - Các agent này chưa có run nào, nên chưa ai thấy lỗi.
- **Hướng sửa (để controller hoặc owner quyết, em chưa làm):**
  - Lọc khuôn theo secret thuộc đúng company.
  - Hoặc lấy env có trong `crew.machines` hay env `mac-mini` của company.
  - Sau đó PATCH lại `privateKeySecretRef` của `f8aab013` (chỉ PATCH, không DELETE), rồi chạy lại bước 8 bằng agent và
    issue mới.
- Từ DB có thể đếm được 2 lần `crew.load_gate.waiting` với lỗi này, lần cuối là 15:39:44 (run của em).

## 5. An toàn và dọn dẹp

- **Không in secret.**
  - Email và mật khẩu board đọc từ `.env` VPS qua pipe vào biến môi trường của process.
  - Mật khẩu điền vào form bằng `evaluate`, không đi qua `fill`.
  - Board REST dùng `api.sh` trên VPS (cookie jar có sẵn). Body gửi qua stdin (`@-`).
- **Không sửa dữ liệu ngoài phạm vi.** Chỉ tạo rồi terminate 1 agent, tạo rồi đóng 1 issue kèm 2 comment (một do cổng
  tải, một do em). Không unpair, không đổi environment, không đổi config, không commit, không push.
- **File tạm đã dọn:**
  - Trên VPS: `/tmp/q.sh` và `/tmp/pc-*.sql` đã xóa bằng `rm -f`.
  - Trên MacBook: thư mục Node tạm đã bỏ bằng `trash`.
- **Process:**
  - Playwright và Chromium em mở đã thoát.
  - Vòng poll nền thứ nhất bị lỗi quoting, em đã dừng bằng TaskStop.
  - Monitor theo dõi run cũng đã dừng bằng TaskStop.
  - Các process 2P Crew Helper và Chrome Remote Desktop đang chạy là của owner.
- **Ghi nhận ngoài lề:** log server có 2 dòng `[Better Auth]: Invalid password` lúc 15:39:59 và 15:40:12. Không phải do
  em: em đăng nhập thành công lúc 15:38 và không đăng nhập lại. Có thể là owner gõ nhầm.
- **Lệch so với plan §5.2 bước 5:** thẻ Mac mini giờ **có** nút "Gỡ máy". Đây là thay đổi cố ý ở bản `bd0ac8d5b` (gỡ
  được máy chưa ghép, migration 0015), nên câu "Thẻ Mac mini không có nút Gỡ" trong hướng dẫn owner đã cũ. Owner cần
  chú ý **không bấm nhầm thẻ Mac mini**.

Status: DONE_WITH_CONCERNS
Summary: AC1, AC2, AC3, AC7 và phần AC6 trước khi gỡ đều đạt (ảnh trang Máy 2 máy ở `reports/acceptance-tps-machines.png`). AC4 không đạt: environment MacBook `f8aab013` dùng secret SSH `crew-e2e-ssh` của Crew E2E, do `machine-step.ts:137` lấy env khuôn đầu tiên trong danh sách toàn instance. Run TPS-116 bị giữ ("Secret must belong to same company"); em đã hủy run, đóng issue (`cancelled`) và terminate agent thử. Cần sửa app và PATCH secret của env rồi chạy lại bước 8.

## Sửa dữ liệu prod sau AC4 (Trợ Lý, 11/10 15:44)

- Nguyên nhân AC4 hỏng: app chọn khuôn environment đầu tiên trong danh sách environment toàn instance, lấy nhầm secret
  `crew-e2e-ssh` của Crew E2E. Dính 9 environment active có agent 2P Solutions: `business-app-*` (4), `visinote-*` (4),
  `may-phans-macbook-pro`.
- Đã backup `/opt/crew-v3-spike/backups/envs-secretfix-20261011-154415.tsv` (9 dòng) rồi đổi
  `config.privateKeySecretRef.secretId` sang secret SSH của 2P Solutions (`environment-ssh-mac-mini-private-key-3f6e0b18`).
  Không đổi gì khác, không DELETE. Lui: chép lại `config` từ file backup.
- Sửa gốc trong app: lọc khuôn theo secret thuộc company đích (ticket fx-app-template).
- Owner: nút "Mở giao diện Paperclip gốc" chỉ owner thấy (fork `17cb320c8`, chờ deploy cùng đợt sau).
