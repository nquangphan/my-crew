# Crew v3 — Ghép máy tự động — Thiết kế

Ngày: 11/10/2026 (Asia/Ho_Chi_Minh). Đầu vào: [brief](../../../plans/261011-1247-ghep-may-tu-dong/brief.md).
Plan: [plan.md](../../../plans/261011-1247-ghep-may-tu-dong/plan.md).

## 1. Kết quả

Owner mới cài app, đăng nhập Paperclip, **tự chọn** company, bấm "Ghép máy" ở bước Máy và không dán gì. Doctor đạt,
máy hiện trên trang Máy và nhận run. Owner gỡ được từng máy trên web mà không đụng Mac mini. App không bao giờ ghi
binary Electron vào chỗ cần `node`.

Không làm: không sửa lõi Paperclip, không thêm hook lõi, không thêm capability cho plugin, không đổi Mac mini, không
xóa environment.

## 2. Quyết định chính và lý do đổi so với hướng đề xuất

| Hướng đề xuất | Chốt | Lý do (đã kiểm code) |
|---|---|---|
| App tạo secret Paperclip qua REST, plugin `ctx.secrets.resolve` secret đó | **Bỏ.** Plugin cấp **key máy dẫn xuất**: `HMAC(secret company, máy + nonce)` | Plugin chỉ resolve được secret **đã bind** vào config plugin: `plugin-secrets-handler.ts:197-253` tra `company_secret_bindings` (`targetType=plugin`), không có thì `binding_missing`. Binding chỉ sinh khi lưu config (`routes/plugins.ts:2306-2356`), mà route này đòi instance admin và `replaceAll` mọi binding. Bắt app sửa config plugin mỗi lần ghép là dễ xóa nhầm secret của Mac mini và còn restart worker. Key dẫn xuất không cần secret mới, không cần binding, không lưu secret thô ở đâu ngoài Keychain của máy |
| Bảng plugin lưu `secretRef` | Lưu `key_nonce` (ngẫu nhiên, không phải secret) | Như trên. Gỡ máy = đặt `revoked_at`. Ghép lại = nonce mới, nên key cũ chết |
| Public key Paperclip ở config plugin `paperclipSshPublicKey` | **Giữ** | Server không lưu public key, environment không lộ nó (đã grep `publicKey`: không có). Đây là public key nên để trong config là ổn |
| App tạo environment SSH bằng REST | **Giữ** | Plugin không có capability environment. App đã làm việc này ở `add-project.ts:319-345` |
| Gỡ máy: archive environment + thu hồi secret | Archive environment (route stock) rồi `revoked_at` | Không có secret Paperclip nào để archive |
| Kiểm owner trong route plugin | Dựa vào host | Plugin không đọc được `company_memberships` (không có trong `PLUGIN_DATABASE_CORE_READ_TABLES`, `packages/shared/src/constants.ts:1439`). Route plugin có scope đã chặn viewer bằng `assertCompanyAccess` (`server/src/routes/plugins.ts:1877`, spec góp ý §6.1). Web chỉ hiện nút cho `isOwner` |

## 3. Dữ liệu

Migration plugin `0014_machine_pairings.sql` (số mới nhất trên `crew/guest-approval` là `0013`):

```sql
CREATE TABLE plugin_crew_core_0433ea20b6.machine_pairings (
  company_id uuid NOT NULL,
  machine_id uuid NOT NULL,
  hostname text NOT NULL,
  environment_id uuid NOT NULL,
  tailscale_ip text NOT NULL,
  port integer NOT NULL,
  host_key_fingerprint text NOT NULL,
  key_nonce text NOT NULL,            -- 64 hex, crypto.randomBytes(32)
  paired_by_user_id text NOT NULL,
  paired_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_user_id text,
  PRIMARY KEY (company_id, machine_id)
);
```

Migration `0015_machine_pairings_unpaired_removal.sql` bỏ `NOT NULL` ở `environment_id`, `tailscale_ip`, `port`,
`host_key_fingerprint`, `paired_by_user_id`, `paired_at`, và thêm ràng buộc `machine_pairings_active_facts_check`: dòng
chưa gỡ (`revoked_at` null) phải đủ cả sáu cột đó. Nhờ vậy "Gỡ máy" ghi được dòng cho một máy chưa từng ghép (§4).

**Trạng thái ghép của một máy** (theo `machine_latest` và `machine_pairings`):

| Trạng thái | Dòng ghép | Webhook nhận | `pair` |
|---|---|---|---|
| Chưa ghép, dùng secret company (Mac mini) | không có | secret company | `409 machine_uses_company_secret`, kể cả có `allowRepair` |
| Đã ghép | đủ thông tin, `revoked_at` null | key máy | xoay key |
| Đã gỡ sau khi ghép | đủ thông tin, có `revoked_at` | không gì (`machine_revoked`) | `409 machine_revoked`; có `allowRepair` thì ghép như thường |
| Đã gỡ khi còn dùng secret company | chỉ có `hostname`, nonce ngẫu nhiên, `revoked_*`; không environment | không gì (`machine_revoked`), kể cả secret company | như dòng trên |

Key máy = `base64url(HMAC-SHA256(secret company, "crew-machine-key/v1\n" + companyId + "\n" + machineId + "\n" + key_nonce))`.
Secret company là secret đang có ở `companies[].webhookSecretRef`. Chỉ app nhận key, đúng một lần, trong response của
route ghép. Server không lưu key.

Config plugin (`instanceConfigSchema`, `packages/crew-plugin/src/manifest.ts:45`) thêm một trường cấp cao nhất:
`paperclipSshPublicKey: { type: "string", pattern: "^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$" }`. Ops đặt một lần cho
company 2P Solutions, giá trị lấy từ `paperclipKey` trong `~/.crew-mac/manifest.json` của Mac mini.

## 4. Route plugin (auth `board`, thêm vào `apiRoutes` của manifest)

| routeKey | Method, path | Vào | Ra |
|---|---|---|---|
| `machines.pairInfo` | `GET /machines/pair-info?companyId=` | — | `200 {paperclipSshPublicKey}`; `409 {error:"Server chưa có key Paperclip"}` |
| `machines.pair` | `POST /machines/pair` | đúng các key `{companyId, machineId, hostname, environmentId, tailscaleIp, port, hostKeyFingerprint}`, thêm tùy chọn `allowRepair: boolean` | `200 {machineKey, pairedAt}`; `409 {error, code:"machine_revoked"}`; `409 {error, code:"machine_uses_company_secret"}` |
| `machines.unpair` | `POST /machines/:machineId/unpair` | `{companyId}` | `200 {environmentId \| null, revokedAt}` (idempotent); `404 {error:"Không có máy này trong company"}` |

Luật chung giống `runtimes/switches.ts:127`: `actor.actorType` phải là `user`, nếu không thì 403. Lỗi DB chỉ ghi log
server.

Kiểm body của `pair`:
- Key lạ thì 400.
- `machineId` và `environmentId` là UUID.
- `tailscaleIp` nằm trong `100.64.0.0/10`, `port` từ 1024 đến 65535.
- `hostKeyFingerprint` khớp `^SHA256:[A-Za-z0-9+/]{43}$`.
- `hostname` dài 1 đến 200 ký tự, không có `\0`.
- `allowRepair` không bắt buộc. Có thì phải là boolean. Đây là key duy nhất được thêm ngoài danh sách trên.

`pair` resolve secret company. Không có thì `409 "Company chưa có secret webhook"`. Sau đó chạy **một** câu `UPSERT`
có điều kiện với nonce mới, xóa `revoked_*`, rồi trả key. Ghi log `crew machine paired` kèm companyId, machineId,
userId, **không kèm key**. Câu ghi từ chối hai ca, và khi đó không ghi gì:
- **Máy đã gỡ** (dòng ghép có `revoked_at`) mà body không có `allowRepair: true`: trả
  `409 {error:"Máy đã bị gỡ, owner phải cho phép ghép lại", code:"machine_revoked"}`. Như vậy app không tự ghép lại
  một máy owner vừa gỡ. Chỉ một thao tác chủ động của owner mới gửi `allowRepair: true`.
- **Máy đang dùng secret company**: `machine_latest` đã có `machineId` này mà chưa có dòng ghép (đường của Mac mini).
  Trả `409 {error:"Máy đang gửi bản tin bằng secret company, không ghép đè được", code:"machine_uses_company_secret"}`,
  kể cả khi có `allowRepair`. Nếu không chặn, một dòng ghép mới sẽ làm mọi bản tin ký bằng secret company của máy đó
  trượt `bad_signature` (vi phạm AC6).

Ghép lại một máy đã ghép và chưa gỡ vẫn được phép: lần ghép đó xoay key, nonce mới làm key cũ chết. Key được dẫn xuất
từ nonce mà chính lần gọi đó ghi, không đọc lại bảng. Host `ctx.db.execute` chỉ trả số dòng, không có `RETURNING`.
Hai lần ghép đồng thời vì vậy nhận hai key khác nhau, và chỉ key của lần ghi sau còn sống. Không bao giờ có chuyện một
key được trả cho hai người gọi.

`unpair`:
- Máy có dòng ghép còn hiệu lực: đặt `revoked_at`, `revoked_by_user_id`. Dòng đã gỡ thì giữ nguyên (idempotent).
- Máy chưa có dòng ghép nhưng có trong `machine_latest` của company (máy dùng secret company): ghi một dòng **đã gỡ
  sẵn**, lấy `hostname` từ `machine_latest`, không environment, không IP/cổng/fingerprint, `paired_at` và
  `paired_by_user_id` null, `key_nonce` ngẫu nhiên 32 byte (key của nó không bao giờ được trao cho ai). Câu ghi là
  `INSERT … SELECT … FROM machine_latest … ON CONFLICT DO NOTHING`, nên không đè dòng có sẵn. Từ đó webhook từ chối máy
  này bằng `machine_revoked`, kể cả bản tin ký bằng secret company. Muốn dùng lại thì app gửi `pair` kèm
  `allowRepair: true` ("Ghép lại"); đó là đường duy nhất để một máy dùng secret company chuyển sang ghép tự động.
- Máy không có trong cả `machine_latest` lẫn `machine_pairings` của company: `404`.
- Log `crew machine unpaired` kèm `usedCompanySecret` (true khi vừa ghi dòng đã gỡ sẵn).

Data `crew.machines` (`machines/data.ts:14`) thêm cho mỗi máy trường
`pairing: {pairedAt, revokedAt, environmentId, tailscaleIp} | {pairedAt: null, revokedAt, environmentId: null,
tailscaleIp: null} | null`, lấy bằng LEFT JOIN `machine_pairings`. Dạng thứ hai là máy gỡ khi còn dùng secret company.
Không trả nonce. Kiểu `CrewMachine` nằm ở `shared-web/machine-card.ts`, nơi web import.

## 5. Webhook

Hai webhook `machine-status` và `docs-snapshot` cùng gọi `authenticateCrewWebhook`
(`shared/webhook.ts:54-91`), và payload của cả hai đều có `machineId` (crew-mac `status.ts:395`). Chỉ sửa hàm này.

1. Phần cũ giữ nguyên: kiểm kích thước, header, khung ±300 giây, chọn company, resolve secret company.
2. Nếu `machineId` trong body là UUID, đọc `machine_pairings` theo `(companyId, machineId)`:
   - có dòng và `revoked_at` khác null: ném `CrewWebhookError("machine_revoked")`. Gồm cả dòng "Gỡ máy" ghi cho máy
     dùng secret company (§4), nên máy đó bị chặn dù ký đúng bằng secret company;
   - có dòng còn hiệu lực: secret dùng để kiểm = key máy dẫn xuất;
   - không có dòng: dùng secret company như cũ. Mac mini đi đường này nên không đổi gì.
3. `verifyCrewSignature` và kiểm `version` giữ như cũ. `parseMachineReport` và `sanitizeRuntimes` không đổi.

Vì key ràng buộc `machineId`, máy đã ghép đổi `machineId` trong payload sẽ rơi về secret company và trượt HMAC. Số lần
resolve không tăng: mỗi bản tin vẫn chỉ một lần, dưới trần 30 lần/phút của host (`plugin-secrets-handler.ts:195`).

## 6. App: bước Máy

### 6.1. Chọn company

`renderer/routes/setup.tsx:136-155`:
- bỏ `preferred` (lấy từ `status.json`) và bỏ fallback `list[0]`;
- ô chọn mặc định rỗng, nút Tiếp khóa cho tới khi owner chọn;
- bước Máy hiện dòng "Ghép vào company: <tên>" để owner nhìn lại trước khi bấm.

### 6.2. Luồng (`main/setup/machine-step.ts`)

1. `client.pairInfo(companyId)` lấy key Paperclip. Gặp 409 thì báo "Server chưa có key Paperclip, báo người quản
   trị" và mở phần dán tay.
2. `installCrewMacFrom`, rồi `configureStatus(origin, companyId)`, lấy `machineId` từ `status.json`.
3. **Máy có sẵn** (`kind === 'existing'`): gọi `testStatus(companyId)` bằng secret Keychain hiện có. Kết quả 2xx thì
   giữ nguyên như hôm nay, không ghép. Đây là đường của Mac mini. Lỗi HTTP hoặc không đọc được Keychain thì đi tiếp bước
   4. Lỗi mạng thì dừng và báo lỗi, không ghép.
4. `setup({paperclipKey, port, worktreeRoot})`. Máy có sẵn giữ cổng và thư mục đang có. `setup` không sinh lại host
   key (`ensureKeyPair` chỉ tạo khi thiếu).
5. Op mới `machineFacts()` trả `{listenAddress, port, worktreeRoot, knownHostsLine, hostKeyFingerprint, username,
   hostname}`. Các nguồn: manifest, file `paths.knownHosts` mà `setup.ts:233` đã ghi, và `ssh-keygen -lf` trên
   `host_ed25519.pub`.
6. Tạo environment, hoặc tìm lại environment đã tạo theo `name` + `host` + `active`:
   - tên `may-<hostname>`;
   - `host = listenAddress`, `port`, `username`;
   - `remoteWorkspacePath = worktreeRoot`, `knownHosts = knownHostsLine`;
   - `privateKeySecretId` và `crewLoadGate` lấy từ environment SSH `in_place` đang active của company (cách lọc như
     `getTemplate`, thứ tự theo tên).

   Chỉ gọi `createEnvironment`, không bao giờ xóa.
7. `client.pairMachine(...)` nhận `machineKey`, rồi `setStatusSecret(machineKey)`. App **không** tự gửi
   `allowRepair`. Gặp `409 machine_revoked` thì báo "Máy này đã bị owner gỡ. Muốn dùng lại, owner phải xác nhận ghép
   lại", và chỉ gọi lại kèm `allowRepair: true` khi owner bấm xác nhận đó. Gặp `409 machine_uses_company_secret` thì
   bước không đạt, không ghi key nào, và báo "Máy này đang gửi bản tin bằng secret chung của company nhưng secret trên
   máy không còn đúng. Gỡ máy này trên trang Máy (web) rồi chạy lại bước Máy." (app chỉ gọi `pair` sau khi bản tin thử
   đã hỏng, nên cho đạt sẽ để lại một máy hỏng). `configureStatus` đã đặt đích đầu
   dùng service `crew-mac-status`. Biến chứa key bị xóa trong `finally`, giống `webhookSecret` ở dòng 70-72.
8. `testStatus(companyId)` phải trả 2xx. Nếu không, báo: "Server từ chối bản tin máy (HTTP <mã>). Kiểm company đã
   chọn." Bước Máy không đạt.
9. Lưu `setup.pairedEnvironmentId` vào app state.

Op mới `testStatus(companyId)` gửi **một** bản tin máy tới đích của company đó, dùng lại `sendReportTo`
(`status.ts:261`), không gửi ảnh chụp docs, và trả `{ok, httpStatus}`.

### 6.3. Dán tay

Các ô dán key và secret cũ nằm trong khối "Nhập tay (dự phòng)", mặc định đóng. Khi `input.manual === true` thì chạy
đường cũ, rồi vẫn phải qua bước 8.

### 6.4. Thêm project trên máy đã ghép

`projects/add-project.ts:238-263`, `getTemplate` chỉ lọc theo `port`. Trên MacBook (cùng cổng 2222), hàm này sẽ chọn
environment của Mac mini, và environment mới sẽ trỏ về Mac mini. Sửa: nếu app state có `pairedEnvironmentId` thì lấy
đúng environment đó làm khuôn (phải còn `active`). Không có thì giữ cách cũ. Mac mini không đổi.

## 7. Node

Thứ tự dò, đặt ở `apps/crew-mac/src/node-runtime.ts`:

1. `/opt/homebrew/bin/node`, `/usr/local/bin/node`;
2. `~/.crew/node/bin/node`, bản app đã tải lần trước. Đặt trước nvm vì đường của nvm đổi theo version;
3. `/bin/zsh -ilc 'command -v node'`, quá hạn 15 giây, lấy dòng cuối là đường tuyệt đối. Bước này phủ nvm.

Ứng viên chỉ được nhận khi:
- `<node> -p process.versions.node` cho major ≥ 22 (`engines` ở gốc repo);
- `realpath` không chứa `.app/Contents/`.

Không có ứng viên nào thì `ensureNode()` tải Node:
- đọc `https://nodejs.org/dist/index.json`, lấy bản đầu tiên có `lts`;
- tải `node-<v>-darwin-<arm64|x64>.tar.gz` và `SHASUMS256.txt` cùng thư mục;
- so sha256, lệch thì xóa tệp và báo lỗi;
- giải nén bằng `/usr/bin/tar` vào `~/.crew/node.tmp-<rand>`, rồi `rename` thành `~/.crew/node` (đổi chỗ nguyên khối).

Chỗ áp dụng:
- `stableNodePath()` (`context-factory.ts:8-13`) không bao giờ trả `process.execPath` khi `process.versions.electron`
  có giá trị. Thay vào đó, hàm thử ứng viên đồng bộ (1, 2, rồi `nodePath` trong launcher nếu dùng được), không có thì
  ném `"Chưa có node dùng được"`. CLI chạy bằng node thật nên vẫn giữ fallback `execPath`.
- `utility/ops.ts:45-50`: thêm op `ensureNode`, nhớ kết quả trong process và truyền `nodePath` vào mọi
  `createMacContext`. Launcher do `setup` ghi là nơi lưu bền giữa các lần mở app.
- Bước `check` (`machine-check.ts`) thêm dòng `node`: gọi `ensureNode`, hiện "Node <v> (<nguồn>)" hoặc "Đang tải Node
  LTS…".
- Lệnh CLI `crew-mac node [--prefix <dir>] [--skip-system] [--json]` chạy `ensureNode` và in `{path, source, version}`.
  Dùng để nghiệm thu qua SSH và để doctor gợi ý.
- Doctor:
  - `checkAgentNode` (`doctor.ts:396-415`) và câu ở `doctor.ts:1054`: nếu `nodePath` nằm trong `.app` thì báo "Launcher
    trỏ vào app 2P Crew, không phải node". Gợi ý chung: "Mở 2P Crew → bước Kiểm tra máy (dò hoặc tải Node vào
    ~/.crew/node), hoặc chạy `crew-mac node`, rồi chạy lại doctor".
  - Check launcher (`doctor.ts:518`) cũng báo lỗi khi đường node nằm trong `.app`.

## 8. Web: trang Máy

`packages/crew-web/src/features/machines/`:
- Thẻ máy có `pairing` còn hiệu lực hiện nhãn "Đã ghép <giờ VN>". Owner (`useCompanyAccess().isOwner`) thấy nút "Gỡ
  máy" trên **mọi máy chưa gỡ**, kể cả máy không có `pairing` (đang dùng secret company).
- Hộp xác nhận, máy đã ghép: "Máy <hostname> sẽ không nhận run mới và bản tin của nó bị từ chối. Mac khác không ảnh
  hưởng. Muốn dùng lại máy này, mở app 2P Crew trên máy đó và bấm "Ghép lại"."
- Hộp xác nhận, máy chưa ghép (cảnh báo mạnh hơn, vì gỡ Mac mini theo cách này là lựa chọn chủ động của owner): "Máy
  <hostname> chưa ghép tự động: nó đang gửi bản tin bằng secret chung của company. Gỡ máy thì mọi bản tin của nó bị từ
  chối, kể cả bản tin ký bằng secret chung, và máy không nhận run mới. Muốn dùng lại, phải mở app 2P Crew trên chính máy
  đó và bấm "Ghép lại". Mac khác không ảnh hưởng; environment của máy không bị archive."
- Bấm Gỡ trên máy chưa ghép: chỉ gọi `POST …/machines/:machineId/unpair`. Không đọc, không đối chiếu host, không archive
  environment nào (không có `environmentId` để làm). Lỗi hiện nguyên câu, nút còn đó.
- Bấm Gỡ trên máy đã ghép:
  1. `GET /api/environments/:environmentId`, rồi so `config.host` với `pairing.tailscaleIp`. Lệch, hoặc không đọc được
     `host` (server che `config` với người không phải instance admin), thì hiện lỗi "Environment <tên> trỏ tới <host>,
     không phải <IP> của máy này…" và **không** archive, không unpair. Bước này chặn ca app gửi nhầm `environmentId`
     (ví dụ của Mac mini, xem §6.4);
  2. `PATCH /api/environments/:environmentId {status:"archived"}`, route stock;
  3. `POST …/machines/:machineId/unpair`.

  Lỗi ở bước nào thì hiện nguyên câu lỗi. Nút còn đó cho tới khi có `revokedAt`, và cả hai bước đều idempotent nên bấm
  lại là đi tiếp. Archive trước để một lần thu hồi hỏng không để lại environment còn nhận run.
- Thẻ có `revokedAt` hiện "Đã gỡ <giờ VN>" và không có nút, kể cả máy gỡ khi còn dùng secret company.
- Máy không có `pairing` (Mac mini) không có nhãn; chỉ owner thấy nút "Gỡ máy".
- **Ai ghép, ai gỡ được.** Nút chỉ hiện cho owner, nhưng đó chỉ là giao diện. Route `pair` và `unpair` có auth `board`,
  và plugin không đọc được `company_memberships` (§2). Vì vậy **mọi board member** của company (không phải viewer, không
  phải agent) đều gọi được cả hai route. Rủi ro còn lại:
  - Một member gọi `pair` cho `machineId` của một máy đã ghép thì nhận key hợp lệ của máy đó, và key thật của máy chết.
    Từ đó họ gửi được `machine-status` và `docs-snapshot` giả dưới tên máy đó, kể cả `auditState`/`checkExit` của docs.
  - Một member gọi `unpair` gỡ được máy bất kỳ đã ghép, và cũng gửi được `allowRepair: true` để ghép lại máy đã gỡ.
  - Không ai ghép đè được máy dùng secret company: `pair` trả `409 machine_uses_company_secret` (§4). Nhưng một member
    gọi `unpair` thì chặn được nó (dòng đã gỡ sẵn), rồi `pair` kèm `allowRepair` thì chiếm được `machineId` đó. Hai bước
    này chính là đường "Gỡ máy" rồi "Ghép lại" của owner.

  Rủi ro này bằng 0 khi company chỉ có owner, như 2P Solutions hôm nay. Muốn chặn hẳn một máy đã gỡ thì phải thu hồi
  thêm board key của máy đó, vì app trên máy vẫn giữ board key trong Keychain. Khi host có cách kiểm owner trong route
  plugin thì chuyển `pair`/`unpair` sang kiểm owner.

## 9. Bảo mật

| Mối nguy | Xử lý |
|---|---|
| Ai ghép được | Route `board` có scope company. Host chặn viewer và agent; route kiểm thêm `actorType === "user"`. App dùng board key của owner trong Keychain. Mọi board member đều ghép/gỡ được, rủi ro còn lại ghi ở §8 |
| Máy đã gỡ tự ghép lại | `pair` trả `409 machine_revoked` khi thiếu `allowRepair: true`. Chặn hẳn thì thu hồi thêm board key của máy |
| Ghép đè máy dùng secret company | `pair` trả `409 machine_uses_company_secret`, Mac mini không bị khóa. Muốn chuyển máy đó sang ghép thì owner phải "Gỡ máy" trên web trước (dòng đã gỡ sẵn), rồi app "Ghép lại" kèm `allowRepair` |
| Gỡ nhầm máy dùng secret company | Hộp xác nhận cảnh báo riêng cho máy chưa ghép. Gỡ rồi thì bản tin của máy đó, kể cả ký bằng secret company, bị `machine_revoked` cho tới khi ghép lại. Máy khác không ảnh hưởng |
| Lộ key một máy | Kẻ có key giả được bản tin máy và ảnh chụp docs của **đúng máy đó**. Owner bấm Gỡ là chặn ngay. Không suy ngược ra secret company được (HMAC một chiều) |
| Lộ secret company | Như hôm nay: suy ra được mọi key máy. Xoay secret company làm mọi key máy chết theo. Máy ghép lại tự sửa vì ở bước 3, `testStatus` trượt nên app ghép lại. Ghi vào runbook |
| Gửi lại bản tin (replay) | Khung ±300 giây giữ nguyên. Gửi lại chỉ ghi đè chính bản tin đó. Máy đã gỡ bị từ chối cả khi chữ ký còn hạn |
| Máy đã gỡ đổi `machineId` | Rơi về secret company và trượt HMAC |
| Key nằm ở đâu | Chỉ ở response HTTPS một lần và Keychain của máy. Không ghi log, không vào app state, không lên argv (`security -i` qua stdin, `targets.ts:52`) |
| Viewer đọc `crew.machines` | Thấy IP Tailscale, `environmentId`, giờ ghép. Không thấy nonce hay key |
| Environment | Chỉ PATCH `archived`. Client không có hàm xóa (`paperclip/types.ts:103`) |
| Node tải về | Tải qua HTTPS và so `SHASUMS256`. Không kiểm chữ ký GPG (owner chốt checksum) |

## 10. Test

| Tầng | Ca |
|---|---|
| Plugin unit/DB (`machine-pairing.db.test.ts`, `migration-0014.db.test.ts`, `migration-0015.db.test.ts`) | Migration chạy; `0015` giữ dòng cũ và chặn dòng chưa gỡ thiếu thông tin. `unpair` máy dùng secret company ghi dòng đã gỡ sẵn, webhook từ chối cả secret company, máy khác không ảnh hưởng, ghép lại có `allowRepair` thì được. `unpair` máy lạ thì 404. `pair`: key lạ, IP ngoài dải, actor agent bị 403, upsert đổi nonce và xóa revoked (chỉ khi có `allowRepair`). Máy đã gỡ thiếu `allowRepair` thì 409 `machine_revoked`. Máy đang dùng secret company thì 409 `machine_uses_company_secret`. Ghép đồng thời ra key khác nhau. Thiếu `paperclipSshPublicKey` thì 409. `unpair` idempotent |
| Webhook (`webhook` test có sẵn và test mới) | Máy chưa ghép + secret company → ok. Máy đã ghép + key máy → ok. Máy đã ghép + secret company → `bad_signature`. Máy đã gỡ → `machine_revoked`. Key máy A dùng cho `machineId` B → trượt. `docs-snapshot` với key máy → ok |
| crew-mac unit | `resolveNode`: Homebrew, `~/.crew/node`, đăng nhập shell, loại đường `.app`, loại major < 22. `ensureNode`: checksum đúng/sai (fetch giả), đổi chỗ nguyên khối. `stableNodePath` dưới Electron không trả `execPath`. Câu gợi ý doctor. `testStatus` trả mã HTTP |
| mac-app unit | Bước Máy: máy mới ghép không dán gì. Máy có sẵn đạt test thì không ghép. Máy có sẵn bị 401/502 thì ghép. Lỗi mạng thì không ghép. 409 pair-info thì mở phần dán tay. Test cuối không 2xx thì không đạt. Biến key được xóa. Không có company mặc định. `getTemplate` theo `pairedEnvironmentId` |
| crew-web unit | Nút chỉ hiện với owner, cả trên máy chưa ghép. Máy chưa ghép: hộp xác nhận có cảnh báo secret chung và "Ghép lại", chỉ gọi unpair, không đọc hay archive environment. Thứ tự đọc environment, archive, rồi unpair. Host environment lệch IP Tailscale thì không archive. Bấm lại sau lỗi |
| E2E (một spec, T1) | `PW-S15-PAIR`: API ghép một máy giả (environment tạo bằng REST), trang Máy hiện "Đã ghép", bấm Gỡ, environment `archived`, thẻ "Đã gỡ", ghép lại không có `allowRepair` thì 409 `machine_revoked`. Ca thứ hai: máy gửi bằng secret company, Gỡ trên web, secret company bị từ chối, ghép lại thiếu cờ thì 409, có `allowRepair` thì key mới được nhận và thẻ "Đã ghép" |
| Nghiệm thu thật | §11 |

## 11. Nghiệm thu (Cổng thật của brief)

| # | Cổng | Bằng chứng |
|---|---|---|
| AC1 | MacBook ghép vào **2P Solutions** (`5befeb1a…`) không dán gì | Ảnh bước Máy đạt. Có dòng `machine_pairings` của MacBook. Environment `may-phans-macbook-pro` active, `host=100.100.157.19` |
| AC2 | Doctor trên MacBook 0 lỗi | `ssh macbook '~/.crew/bin/crew-mac doctor'` |
| AC3 | Trang Máy prod hiện 2 máy | Ảnh trang Máy của TPS: Mac mini (không nhãn) và MacBook "Đã ghép" |
| AC4 | Một issue nhỏ chạy trên environment của MacBook tới done | Run có `environmentId` của MacBook, issue `done` |
| AC5 | Gỡ MacBook trên web | Environment `archived`. `crew-mac status send` trên MacBook bị từ chối (không 2xx). Log plugin `machine_revoked` |
| AC6 | Mac mini không ảnh hưởng | Bản tin Mac mini vẫn 2xx sau khi gỡ. Claim việc trên máy vẫn 204. Không có dòng `machine_pairings` của Mac mini. Fingerprint host key không đổi so với trước deploy |
| AC7 | Node | Launcher, plist và `.zshenv` trên MacBook không chứa `Helper`. `crew-mac node --prefix <tạm> --skip-system` tải được Node LTS, checksum khớp |

## 12. Rollback

- **Plugin/web:** `crew/ops/rollback.sh` về image trước (prod `286820b18`).
  - Bảng `0014` để nguyên, vì nó chỉ thêm. `0015` chỉ nới `NOT NULL` và thêm check, cũng để nguyên. Plugin cũ không đọc
    bảng ghép, nên máy đã gỡ khi còn dùng secret company lại được nhận bằng secret company sau rollback.
  - Plugin cũ không biết bảng ghép, nên kiểm MacBook bằng secret company và từ chối. Chỉ MacBook mất bản tin, Mac mini
    không đổi.
  - Trường config `paperclipSshPublicKey` thừa không làm hỏng gì: schema gốc không đặt `additionalProperties:false`.
- **App:** `ditto` bản cũ từ `~/crew-app-prev/` về `/Applications`.
- **Environment đã tạo:** chỉ archive.
- **Node tải về:** `~/.crew/node` để nguyên, vì không gì tự dùng nó nếu Homebrew có node.

## 13. Câu hỏi mở

Không có câu hỏi nghiệp vụ.
