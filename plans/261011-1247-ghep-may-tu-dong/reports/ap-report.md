# AP — App ghép máy tự động — Báo cáo

Ngày 11/10/2026 (Asia/Ho_Chi_Minh). Worktree `~/Documents/projects/crew/.worktrees/crew-pair`, nhánh `r25-pair`.
Commit `f6ef15e` `feat(mac-app): bước Máy tự ghép máy với Paperclip, chọn company tường minh`, nằm trên ND `d0f5829`.
Chưa push. Chưa build hay cài app.

## Kết quả

AP xong theo plan §AP và spec §6. Ba thay đổi hợp đồng plugin mà controller báo giữa chừng cũng đã có:
`machine_revoked` cùng `allowRepair`, `machine_uses_company_secret`, và host của environment là IP Tailscale.

### Bước Máy (`apps/mac-app/src/main/setup/machine-step.ts`)

**Máy mới.** Các bước chạy theo thứ tự:
1. `pairInfo` chạy trước khi đụng vào máy.
2. `installCrewMacFrom`, rồi `configureStatus` (lấy `machineId`).
3. `setup({paperclipKey, port, worktreeRoot})`, rồi op `machineFacts`.
4. Tìm lại hoặc tạo environment `may-<tên máy>`:
   - `host` là IP Tailscale, kèm `port`, `username`;
   - `remoteWorkspacePath` là thư mục worktree, `knownHosts` là dòng `known_hosts` của sshd agent;
   - `privateKeySecretId` và `crewLoadGate` lấy từ environment `in_place` active đầu tiên theo tên.
5. `pairMachine`, rồi op `setTargetSecret(companyId, machineKey)`.
6. Op `testStatus` phải trả 2xx, sau đó mới ghi `setup.pairedEnvironmentId`.

**Máy có sẵn.** Sau install và `configureStatus`, app gọi `testStatus` bằng secret đang có.
- 2xx thì chạy `setup({})` như trước. App không gọi pair-info, không ghép, không đổi key. Đây là đường của Mac mini.
- HTTP lỗi hoặc Keychain không đọc được thì ghép, giữ cổng và thư mục đang có.
- Lỗi mạng hoặc không dựng được bản tin thì dừng, không ghép.

**Ghép bị từ chối.** Nếu environment vừa tạo trong lần này thì app archive nó, không bao giờ xóa.
- `machine_revoked`: báo "Máy này đã bị gỡ trên web. Bấm Ghép lại nếu muốn dùng lại." với `state: 'revoked'`. Chỉ nút
  "Ghép lại máy này" (`input.repair`) gửi `allowRepair: true`. Lần ghép tự động sau 401/502 không bao giờ gửi cờ này.
- `machine_uses_company_secret`: bước không đạt, không ghi key, báo "Máy này đang gửi bản tin bằng secret chung của
  company nhưng secret trên máy không còn đúng. Gỡ máy này trên trang Máy (web) rồi chạy lại bước Máy." (controller
  chốt sau commit đầu; commit sửa riêng).

**Các ca còn lại.**
- `pair-info` trả 409: báo "Server chưa có key Paperclip, báo người quản trị…" với `state: 'manual'`. App chưa đụng vào máy.
- Bản tin thử cuối không 2xx: bước không đạt. Mã HTTP báo "Server từ chối bản tin máy (HTTP <mã>). Kiểm company đã
  chọn."; lỗi mạng và lỗi Keychain có câu riêng.
- Nhập tay (`input.manual`): đường cũ. Secret đi qua `setTargetSecret` rồi bị xóa trong `finally`. Vẫn phải qua bản tin
  thử 2xx.

**Key máy** chỉ đi từ response tới `setTargetSecret` (stdin của `security -i`). Nó không vào log, app state, kết quả
bước hay argv. Biến giữ key được xóa trong `finally`, và test xác nhận `app.json` và kết quả không chứa key.

### Phần khác

- **Client** (`paperclip/{client,types}.ts`): thêm `pairInfo` và `pairMachine` trên `/api/plugins/crew.core/api/machines/...`.
  - Key SSH phải là `ssh-ed25519`, key máy phải là base64url 43 ký tự.
  - 409 giữ `code` của plugin.
  - `allowRepair` chỉ gửi khi được yêu cầu.
- **crew-mac** (`commands/status.ts`):
  - `testStatus(ctx, companyId)` gửi một bản tin và trả `{ok, httpStatus, failure}`. Không gửi ảnh chụp docs, không ghi
    `status-last.json`.
  - `setTargetSecret` ghi vào service Keychain của đích thuộc company.
  - `machineFacts` tính fingerprint giống `ssh-keygen -lf` và kiểm `known_hosts` khớp manifest.
  - `sendReportTo` nay có thêm `failure`. `status-last.json` giữ nguyên dạng cũ.
- **Ops** (`ops.ts`, `ops-bridge.ts`): thêm op `testStatus`, `setTargetSecret`, `machineFacts`.
- **App state:** `setup.pairedEnvironmentId` mặc định `null`.
- **`getTemplate`** (`add-project.ts`):
  - Có `pairedEnvironmentId` thì dùng đúng environment đó. Environment phải còn active và đúng cổng; không thì báo chạy
    lại bước Máy, không rơi về `mac-mini`.
  - Không có thì giữ cách cũ, nên Mac mini không đổi.
  - Bộ lọc khuôn tách thành `isInPlaceSshTemplate`/`inPlaceSshTemplates`, dùng chung với bước Máy.
- **Renderer** (`setup.tsx`):
  - Ô company mặc định rỗng. Bỏ `preferred` và `list[0]`. Nút Tiếp khóa tới khi chọn.
  - Bước Máy hiện "Ghép vào company: <tên>" và nút "Ghép máy".
  - Cổng và thư mục nằm trong khối thu gọn. Khối "Nhập tay (dự phòng)" đóng sẵn và tự mở khi `state: 'manual'`.
  - Nút "Ghép lại máy này" chỉ hiện khi `state: 'revoked'`.
  - Nút bước `check` khi đang chạy hiện "Đang kiểm tra (thiếu Node thì đang tải Node LTS…)" (phần ND để lại).
- **Docs:** đã sửa `docs/flows/mac-app.md`, `mac-app-paperclip.md`, `mac-setup.md`. `flows.yaml` thêm hai file test mới,
  `files.md` sinh lại. `crew-docs check --staged` đạt.

## Kiểm

- `pnpm --filter @crew/mac-app test`: vitest 46 file, 593 ca đạt; `node --test` 24 ca đạt.
- `pnpm --filter @crew/mac test`: 64 file, 1104 ca đạt.
- `tsc --noEmit` đạt ở cả hai package. `pnpm lint` (biome) sạch.
- Test mới:
  - `apps/mac-app/test/setup-machine-step.test.ts` (19 ca):
    - máy mới ghép không dán gì; dùng lại environment đã tạo;
    - máy có sẵn 2xx thì không ghép; 401/502/Keychain thì ghép; lỗi mạng thì dừng;
    - `pair-info` 409 mở nhập tay; bản tin thử cuối không 2xx thì không đạt;
    - `machine_revoked` không gửi `allowRepair`, còn nút Ghép lại thì gửi; `machine_uses_company_secret` giữ nguyên;
    - thiếu khuôn environment; nhập tay; tên environment.
  - `apps/crew-mac/test/status-pairing.test.ts` (7 ca): `testStatus` (2xx, HTTP, mạng, Keychain, không có đích),
    `setTargetSecret` chỉ đúng service, `machineFacts` so với `ssh-keygen -lf` thật.
  - Thêm ca vào test có sẵn:
    - client (`pairInfo`, `pairMachine`, 409 code);
    - `getTemplate` (máy đã ghép, Mac mini, environment đã ghép bị archive);
    - ops thật với HOME giả;
    - wizard trả `state`;
    - renderer (company không chọn sẵn kể cả khi `status.json` có company, khối nhập tay, nút Ghép lại).

## Lệch so với spec và plan

- **Key máy đi qua op mới `setTargetSecret(companyId, …)` thay cho `setStatusSecret`.** Lý do là yêu cầu "per-company
  Keychain entry only". Sau `configureStatus`, đích của company đã chọn chính là service `crew-mac-status`. Kết quả
  giống spec, nhưng không bao giờ ghi nhầm service của company khác.
- **Máy có sẵn gọi `pair-info` sau lần gửi thử chứ không trước.** Spec để `pair-info` ở bước 1. Đổi như vậy thì Mac mini
  (gửi thử 2xx) không gọi route ghép nào. Máy mới vẫn gọi `pair-info` trước khi đụng vào máy.
- **`testStatus` trả thêm `failure`.** Trường này để phân biệt lỗi HTTP, Keychain và mạng như spec đòi.
- **Sửa ngoài danh sách file của AP, nhỏ và bắt buộc:**
  - `src/main/setup/wizard.ts` và `src/shared/ipc-contract.ts`: truyền `state` của bước tới renderer (`StepResult.state`),
    để mở khối nhập tay và hiện nút Ghép lại;
  - `apps/crew-mac/src/index.ts`: export các hàm mới.

  Không đụng file của ticket nào đang chạy song song.

## Câu hỏi còn mở

Không có. Controller đã chốt `machine_uses_company_secret` là lỗi.
