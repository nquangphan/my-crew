---
title: "Crew v3 — Ghép máy tự động"
description: "Bước Máy của app tự ghép máy mới (key máy dẫn xuất, environment SSH, test bản tin 2xx), trang Máy gỡ được từng máy, app tự dò/tải Node thay vì ghi binary Electron."
status: pending
priority: P1
effort: 14h
branch: ghep-may (crew) + crew/machine-pairing (fork)
tags: [crew-v3, mac-app, crew-mac, crew-plugin, crew-web, pairing, node]
created: 2026-10-11
---

# Crew v3 — Ghép máy tự động — Kế hoạch

Ngày: 11/10/2026 (Asia/Ho_Chi_Minh).
Spec: [2026-10-11-crew-v3-ghep-may-design.md](../../docs/superpowers/specs/2026-10-11-crew-v3-ghep-may-design.md).
Thiết kế (bảng, route, luồng, bảo mật, AC) nằm ở spec. Plan này chỉ ghi thứ tự, file và cách kiểm.

> **Cho agent thi công:** dùng superpowers:subagent-driven-development, làm từng ticket. Mỗi lúc **tối đa 2 agent**.
> Hai ticket chạy song song luôn ở hai repo khác nhau và không sửa chung file. Mọi commit sửa
> `docs/flows/<id>.md` của flow chứa file đã đổi (`crew-docs where <file>`, luật R3).

## 1. Nhánh

| Repo | Nhánh mới | Từ |
|---|---|---|
| Fork `~/Documents/projects/crew/.worktrees/paperclip-r3-dp` (plugin, crew-web) | `crew/machine-pairing` | `crew/guest-approval` (= prod `286820b18`) |
| Crew `~/Documents/projects/crew` (crew-mac, mac-app) | `ghep-may` | `r24` (`ed5bd3f`) |

Mỗi nhánh dùng worktree mới. Hai worktree hiện có chỉ đọc.

## 2. Ticket

| Ticket | Việc | Repo | Phụ thuộc | Đợt | Ước lượng |
|---|---|---|---|---|---|
| **PL** | Plugin: bảng ghép, 3 route, webhook dùng key máy, `crew.machines` có `pairing`, config `paperclipSshPublicKey` | fork | — | 1 | 3h |
| **ND** | Node: dò, tải, `crew-mac node`, `ops.ts` truyền `nodePath`, dòng `node` ở bước check, câu doctor | crew | — | 1 | 3h |
| **WB** | Web: nhãn ghép, nút Gỡ máy, e2e `PW-S15-PAIR` | fork | PL | 2 | 2h |
| **AP** | App: bước Máy tự ghép, chọn company tường minh, `testStatus`, dán tay thu gọn, `getTemplate` theo máy | crew | ND (chung `ops.ts`, `register.ts`) | 2 | 3h |
| **DP** | Review, deploy prod, build và cài app, nghiệm thu MacBook | cả hai | WB, AP | 3 | 3h |

Đợt 1 có PL và ND chạy song song, đợt 2 có WB và AP chạy song song. AP chỉ dùng hợp đồng HTTP ở spec §4, không chờ code
PL.

## 3. File của từng ticket

Đường dẫn fork tính từ `packages/`, đường dẫn crew tính từ `apps/`.

| Ticket | Sửa / tạo |
|---|---|
| PL | `crew-plugin/migrations/0014_machine_pairings.sql` (mới), `crew-plugin/src/machines/pairing.ts` (mới: route, dẫn xuất key), `crew-plugin/src/shared/webhook.ts`, `crew-plugin/src/machines/data.ts`, `crew-plugin/src/shared-web/machine-card.ts` (kiểu `pairing`), `crew-plugin/src/manifest.ts`, `crew-plugin/src/worker.ts` (`machines.` → `handleMachinesApi`), test: `src/__tests__/machine-pairing.db.test.ts`, `migration-0014.db.test.ts`, test webhook đang có |
| ND | `crew-mac/src/node-runtime.ts` (mới), `crew-mac/src/context-factory.ts`, `crew-mac/src/commands/doctor.ts`, CLI `crew-mac` (đăng ký lệnh `node`), `mac-app/src/utility/ops.ts`, `mac-app/src/main/ops-bridge.ts` (kiểu op), `mac-app/src/main/setup/machine-check.ts`, `mac-app/src/main/setup/register.ts`, test tương ứng |
| WB | `crew-web/src/features/machines/*` (trang, `use-machines.ts`, locales), `crew-web/src/ds/widgets/crew/machine-card.tsx`, `crew-web/src/api/crew/*` (client `unpair`, `archiveEnvironment`), `crew-web/e2e/specs/s15-machine-pairing.spec.ts` (mới, thêm id vào `e2e/coverage.json` nếu test coverage đòi) |
| AP | `mac-app/src/main/setup/machine-step.ts`, `mac-app/src/renderer/routes/setup.tsx`, `mac-app/src/main/paperclip/{client,types}.ts` (`pairInfo`, `pairMachine`), `mac-app/src/main/app-state.ts` (`pairedEnvironmentId`), `mac-app/src/main/projects/add-project.ts` (`getTemplate`), `mac-app/src/utility/ops.ts` và `ops-bridge.ts` (op `testStatus`, `machineFacts`), `crew-mac/src/commands/status.ts` (`testStatus`), `mac-app/src/main/setup/register.ts`, test tương ứng |

## 4. Ticket chi tiết

### PL — Plugin (fork)

- [ ] Viết migration `0014` theo spec §3. Trong `manifest.ts`:
  - thêm 3 `apiRoutes` theo spec §4, `companyResolution` lấy từ query cho GET và từ body cho POST;
  - thêm `paperclipSshPublicKey` vào `instanceConfigSchema`;
  - **không thêm capability**.
- [ ] Viết `pairing.ts`:
  - kiểm body đúng các key;
  - `actorType === "user"`;
  - `deriveMachineKey(secret, companyId, machineId, nonce)`, export để webhook dùng;
  - `pair` upsert với nonce mới, `unpair` idempotent;
  - log không có key.
- [ ] `authenticateCrewWebhook`: thêm nhánh `machine_pairings` theo spec §5 và mã lỗi `machine_revoked`.
- [ ] `crew.machines` có thêm `pairing` (LEFT JOIN, không trả nonce).
- [ ] Kiểm: `pnpm --filter @crew/paperclip-plugin test` (các ca ở spec §10), typecheck, build. `inspect-image`
  không đổi số hook lõi.
- Rủi ro: webhook sửa sai làm Mac mini mất bản tin (**Cao**). Giảm thiểu: có ca "máy chưa ghép + secret company → ok"
  cho cả hai endpoint, và DP kiểm bản tin Mac mini 2xx ngay sau deploy.
- Lui: revert commit. Migration chỉ thêm bảng.

### ND — Node (crew)

- [ ] Viết `node-runtime.ts`:
  - `resolveNode({home, runner, brewPaths?, loginShell?})`;
  - `ensureNode({..., fetch?, arch?, prefix?})` trả `{path, source, version}`;
  - thứ tự, điều kiện nhận và cách tải theo spec §7.
- [ ] `stableNodePath`: chạy dưới Electron thì không trả `execPath`; thử ứng viên đồng bộ, không có thì ném lỗi.
- [ ] Thêm lệnh `crew-mac node [--prefix <dir>] [--skip-system] [--json]`.
- [ ] `ops.ts`:
  - thêm op `ensureNode`;
  - nhớ `nodePath` trong process và truyền vào `createMacContext` ở mọi handler.
- [ ] Bước `check`: thêm dòng `node`.
- [ ] Doctor: sửa `checkAgentNode` (`doctor.ts:396-415`) và câu ở `doctor.ts:1054`; check launcher (`doctor.ts:518`)
  báo lỗi khi đường node nằm trong `.app`.
- [ ] Kiểm: `pnpm --filter @crew/mac test`, `pnpm --filter @crew/mac-app test`, typecheck. Có ca
  `process.versions.electron` giả, và ca tải với fetch giả cho checksum đúng/sai.
- Rủi ro: shell đăng nhập treo hoặc in rác (**Trung bình**). Giảm thiểu: quá hạn 15 giây, chỉ nhận dòng cuối là đường
  tuyệt đối và chạy được `-p`.
- Lui: revert. `~/.crew/node` để nguyên.

### WB — Web (fork, sau PL)

- [ ] Thẻ máy: nhãn "Đã ghép" / "Đã gỡ" (giờ `Asia/Ho_Chi_Minh`), nút "Gỡ máy" chỉ khi `isOwner` và còn ghép.
- [ ] Hộp xác nhận theo spec §8. Archive environment bằng route stock rồi `unpair`. Lỗi hiện nguyên văn. Bấm lại
  được.
- [ ] Unit test: quyền nút, thứ tự hai lời gọi, bấm lại sau lỗi.
- [ ] E2E `PW-S15-PAIR` gắn tag `@t1`. Dữ liệu dựng bằng API:
  - environment SSH tạo qua REST;
  - `crewRoute('POST','/machines/pair',…)` với `machineId` ngẫu nhiên;
  - một bản tin máy ký bằng key máy để thẻ hiện ra;
  - nếu T1 chưa có `companies[].webhookSecretRef`, `beforeAll` tạo secret và config (chỉ T1).

  Sau đó kiểm UI: nhãn, bấm Gỡ, `GET` environment ra `archived`, thẻ "Đã gỡ".
- [ ] Chạy **chỉ spec này**: `cd packages/crew-web && bash e2e/support/run-e2e.sh --project=t1 --grep PW-S15-PAIR`.
- Rủi ro: e2e đụng prod (**Thấp**). Giảm thiểu: chỉ `@t1`.

### AP — App (crew, sau ND)

- [ ] `setup.tsx`: bỏ `preferred` và `list[0]`. Nút Tiếp khóa tới khi đã chọn. Bước Máy hiện "Ghép vào company: <tên>".
- [ ] `machine-step.ts`: luồng 9 bước ở spec §6.2. Phần dán tay nằm trong khối thu gọn (§6.3). Key bị xóa trong
  `finally`.
- [ ] Client có `pairInfo` và `pairMachine`. Op mới `testStatus` và `machineFacts`. App state có `pairedEnvironmentId`.
- [ ] `getTemplate` dùng `pairedEnvironmentId` khi có (spec §6.4).
- [ ] Kiểm: các ca mac-app/crew-mac ở spec §10, typecheck, `pnpm lint`.
- Rủi ro: ghép nhầm một máy đang chạy tốt (**Trung bình**). Giảm thiểu: máy có sẵn chỉ ghép khi `testStatus` nhận
  phản hồi HTTP không 2xx; lỗi mạng thì dừng.

### DP — Review, deploy, nghiệm thu (controller + owner)

**Review.** Agent `code-reviewer` đọc diff của hai nhánh, tập trung vào bốn điểm:
1. Key không lọt ra log, app state hay argv.
2. Nhánh webhook cho máy chưa ghép giống hệt trước.
3. Không có đường nào DELETE environment.
4. Không còn chỗ nào ghi `execPath` của Electron.

Ghi kết quả vào `reports/review.md`. Sửa xong mới deploy.

**Deploy prod (fork). Chỉ chạy khi owner nói "push"/"deploy".**
1. `crew/release/verify.sh` xanh trên `crew/machine-pairing`.
2. Build image (tag `crew/v3.4-ghep-may`), rồi `crew/ops/deploy.sh crew/v3.4-ghep-may`. `plugin-state.sh` báo
   `crew.core` `ready`, migration `0014` đã áp. Manifest không thêm capability.
   - **Thứ tự: migration trước, worker / reload plugin sau.** Worker mới đọc `machine_pairings` cho **mọi** bản tin có
     `machineId` dạng uuid, kể cả Mac mini. Bảng chưa có thì webhook trả `pairing_unavailable` (cố ý không fail-open), và
     Mac mini mất bản tin. Vì vậy không reload riêng worker plugin (hot reload `dist`, restart worker) khi `0014` chưa
     áp. Nếu `plugin-state.sh` chưa báo `0014` thì dừng, không chạy tiếp bước 3.
3. Ghi lại fingerprint host key của Mac mini **trước** deploy:
   `ssh-keygen -lf ~/.crew-mac/sshd/host_ed25519.pub` (đường thật lấy theo `paths.hostKey`).
4. Đặt `paperclipSshPublicKey` cho company TPS:
   - `GET` config plugin `crew.core` của TPS;
   - **gộp** thêm trường mới, **giữ nguyên `companies[]`**;
   - `POST /api/plugins/crew.core/config` (route này `replaceAll` binding, nên thiếu `companies[]` là Mac mini mất
     secret);
   - giá trị lấy từ `paperclipKey` trong `~/.crew-mac/manifest.json` của Mac mini.
5. Ngay sau đó, trên Mac mini: `~/.crew/bin/crew-mac status send` phải 2xx, và `GET …/machines/pair-info?companyId=<TPS>`
   phải trả đúng key.

**Build app (crew, trên Mac mini).**
1. `pnpm -r typecheck && pnpm -r test`.
2. `pnpm --filter @crew/mac-app package`, ra bản zip/dmg arm64.
3. Chép lên MacBook: `scp <zip> macbook:~/crew-pair-build/2P-Crew.zip`.

**Nghiệm thu MacBook.** Theo §5. Bằng chứng ghi vào `reports/acceptance.md`, đối chiếu AC1–AC7 ở spec §11.

**Lui.**
- Plugin/web: `crew/ops/rollback.sh`.
- App: `ditto ~/crew-app-prev/"2P Crew.app" "/Applications/2P Crew.app"`.
- Environment MacBook: chỉ archive.

## 5. Kịch bản nghiệm thu MacBook

`ssh macbook` là alias tới `100.100.157.19:2222` (sshd Crew), user `phannhatquang`. MacBook đã có
`/opt/homebrew/bin/node`, do owner tự vá.

### 5.1. Controller làm qua SSH

1. **Lưu bản cũ:**
   ```
   ssh macbook 'mkdir -p ~/crew-app-prev && ditto "/Applications/2P Crew.app" ~/crew-app-prev/"2P Crew.app"'
   ```
2. **Cài bản mới bằng script chạy nền.** Thoát app làm listener 2222 dừng; phiên SSH đang mở vẫn sống, nhưng script
   chạy nền để không phụ thuộc phiên. Lưu script này thành `~/crew-pair-build/install.sh` trên MacBook rồi chạy
   `ssh macbook 'nohup bash ~/crew-pair-build/install.sh >~/crew-pair-build/install.log 2>&1 &'`:
   ```
   osascript -e 'tell application "2P Crew" to quit'
   for i in $(seq 1 120); do pgrep -f "2P Crew.app/Contents/MacOS/2P Crew" >/dev/null || break; sleep 1; done
   pgrep -f "2P Crew.app/Contents/MacOS/2P Crew" && { echo "app chưa thoát"; exit 1; }
   rm -rf ~/crew-pair-build/x && mkdir ~/crew-pair-build/x
   ditto -x -k ~/crew-pair-build/2P-Crew.zip ~/crew-pair-build/x
   rm -rf "/Applications/2P Crew.app" && ditto ~/crew-pair-build/x/"2P Crew.app" "/Applications/2P Crew.app"
   open -a "/Applications/2P Crew.app"
   ```
   Owner bấm **Thoát** ở hộp thoại quit guard (bước owner 1). Nếu `osascript` báo lỗi quyền (-1743), owner thoát từ
   menu tray. Chờ `ssh macbook true` vào lại được, rồi đọc `install.log`.
3. **Dò node** (AC7):
   - `ssh macbook '~/.crew/bin/crew-mac node --json'` phải ra `source: homebrew`, `/opt/homebrew/bin/node`.
   - `ssh macbook 'grep -l "Helper" ~/.crew/bin/crew-mac ~/Library/LaunchAgents/com.2p.crew-mac-*.plist ~/.zshenv; echo rc=$?'`
     không được in tên file nào (`rc=1`).
4. **Đường không có node.** Dùng thư mục tạm thay vì ẩn node thật. Ẩn node thật (`brew unlink node`) sẽ làm hỏng
   launcher đang chạy và bản tin máy trong lúc thử.
   ```
   ssh macbook 'T=$(mktemp -d); ~/.crew/bin/crew-mac node --prefix "$T" --skip-system --json; "$T"/node/bin/node -v; rm -rf "$T"'
   ```
   Phải ra `source: downloaded`, checksum khớp, `node -v` là bản LTS. Ca checksum sai đã có ở unit test ND.
5. **Trước khi owner ghép:** ghi fingerprint host key MacBook (`ssh-keygen -lf` trên `host_ed25519.pub`) và kiểm
   Keychain chỉ theo tên:
   `ssh macbook 'security find-generic-password -s crew-mac-status -a crew-mac >/dev/null; echo $?'`. Kết quả `0` là có
   mục; `36` là Keychain khóa qua SSH, khi đó dựa vào bằng chứng bước 7.
6. *(Chờ owner làm bước owner 2–4.)*
7. **Sau khi ghép:**
   - `ssh macbook '~/.crew/bin/crew-mac doctor'` 0 lỗi (AC2).
   - `ssh macbook 'cat ~/.crew/status-last.json'` có `ok: true`, `httpStatus` 2xx.
   - Trên server: có dòng `machine_pairings` của TPS cho `machineId` lấy từ `~/.crew/status.json` của MacBook (AC1).
   - Environment `may-phans-macbook-pro` active, `host=100.100.157.19`, `port=2222`.
   - Trang Máy prod của TPS hiện 2 máy (AC3, chụp ảnh).
   - Fingerprint Mac mini không đổi (AC6).
8. **Run thật (AC4):**
   - Tạo agent `claude_local` thử với `adapterConfig.engine=cli` và `defaultEnvironmentId` = environment MacBook.
   - Tạo issue nhỏ, ví dụ "tạo file `pair-check.txt` trong checkout rồi báo done". Workflow `crew.core` có thể kéo
     reviewer/integrator, nên issue phải tự chốt done/blocked.
   - Chờ tới khi issue `done` và run có `environmentId` của MacBook.
   - Xong thì terminate agent thử.
9. *(Chờ owner làm bước owner 5.)*
10. **Sau khi gỡ (AC5, AC6):**
    - Environment MacBook `archived`.
    - `ssh macbook '~/.crew/bin/crew-mac status send; cat ~/.crew/status-last.json'` không 2xx; log plugin có
      `machine_revoked`.
    - Trên Mac mini: `crew-mac status send` 2xx; claim việc máy vẫn 204; Mac mini không có dòng `machine_pairings`.

### 5.2. Owner làm trên MacBook

1. Khi em báo "đang cài bản mới", trên MacBook sẽ hiện hộp thoại "Thoát app thì máy ngừng nhận việc mới…". Đại Ca bấm
   **Thoát**. Nếu không thấy hộp thoại, Đại Ca bấm biểu tượng 2P Crew trên thanh menu, chọn **Thoát**, rồi bấm
   **Thoát** lần nữa.
2. App tự mở lại và vào trình cài đặt. Ở bước **Paperclip**, Đại Ca chọn company **2P Solutions**. Ô chọn giờ để trống
   sẵn, Đại Ca phải tự chọn. Bấm **Tiếp**.
3. Ở bước **Máy**, Đại Ca nhìn dòng "Ghép vào company: 2P Solutions". Đúng thì bấm **Ghép máy**. Không phải dán gì.
   Chờ tới khi hiện "Đã ghép máy". Nếu thấy lỗi đỏ, Đại Ca chụp màn hình gửi em và dừng ở đó.
4. Nếu app hỏi **Quyền truy cập ổ đĩa**, Đại Ca bấm nút mở Cài đặt, bật **2P Crew** trong "Full Disk Access" (Quyền truy
   cập toàn bộ ổ đĩa), quay lại app và bấm **Kiểm tra lại**. Đi tiếp tới bước **Doctor** và báo em khi thấy "Đạt".
5. Khi em báo "chạy thử xong", Đại Ca mở `https://crew.2p-solutions.com`, vào company 2P Solutions, mở trang **Máy**.
   Ở thẻ MacBook, Đại Ca bấm **Gỡ máy**, rồi bấm **Gỡ** trong hộp xác nhận. Thẻ phải chuyển sang "Đã gỡ". Thẻ Mac mini
   không có nút Gỡ.
6. Muốn dùng lại MacBook thì Đại Ca mở 2P Crew, vào bước Máy và bấm **Ghép máy** lần nữa.

## 6. Ma trận test

Chi tiết ở spec §10.

| Tầng | Ticket |
|---|---|
| Plugin DB + webhook | PL |
| crew-mac unit (node, doctor, `testStatus`) | ND, AP |
| mac-app unit (check, bước Máy, chọn company, `getTemplate`) | ND, AP |
| crew-web unit | WB |
| E2E T1 `PW-S15-PAIR` | WB |
| Nghiệm thu thật AC1–AC7 | DP |

## 7. Câu hỏi còn mở

Không có câu hỏi nghiệp vụ.

Một việc cần biết: bước Máy hiện không có đường CLI chạy được mà không cần GUI. Muốn có thì phải thêm cách đọc board key
từ ops, việc này vượt phạm vi. Vì vậy ba lần bấm GUI (chọn company, Ghép máy, Quyền ổ đĩa) vẫn do owner làm.
