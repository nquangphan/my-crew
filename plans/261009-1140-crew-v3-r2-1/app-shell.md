# Crew v3 R2-1: gói `app-shell` (AP-1, AP-3, AP-5, AP-6), kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App Electron "2P Crew" có khung chạy nền (tray, cửa sổ, login item, log, trạng thái), màn hình Sức khỏe, Run đang chạy, Log, wizard cài đặt lần đầu (kể cả nhận cài đặt có sẵn của Mac mini và chuyển sshd sang app có tự lui), và bước gỡ app v2 không đụng dữ liệu v2.

**Architecture:** `apps/mac-app` dựng bằng electron-vite: `src/main` (ESM), `src/preload`, `src/renderer` (React 19), `src/utility/ops.ts` (chạy trong `utilityProcess`, gọi `@crew/mac`). `@crew/mac` được bundle vào main/utility (không externalize), còn bản CLI đã build được chép vào `Contents/Resources/crew-mac/` để cài ra `~/.crew/app/crew-mac`. Mọi trạng thái bền của app nằm trong `app.json` qua `AppStateStore`. Renderer chỉ nói chuyện với Main qua hợp đồng IPC I5.

**Tech Stack:** Electron 44.4.5, electron-vite 5.0.0, electron-builder 26.15.3, React 19, TypeScript 7, Vitest 5 (Main/utility test bằng deps giả, renderer test bằng `@testing-library/react` như v2), Biome 2.5.

**Spec:** [plan.md](plan.md) (Global Constraints, Review Focus 2 và 5, Interface I1, I3, I4, I5, I6, I10) và spec §4, §5, §8 (màn hình 1, 2, 4, 5), §11, §16 Q4, Q5.

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng gói này:

- Bundle id `com.2p-solutions.crew.mac`, `productName: 2P Crew`, chỉ arm64, `hardenedRuntime: true`, entitlements đúng hai khóa `com.apple.security.cs.allow-jit`, `com.apple.security.cs.allow-unsigned-executable-memory`. Không `disable-library-validation`.
- Info.plist (`extendInfo`) có bốn chuỗi tiếng Việt:
  - `NSDocumentsFolderUsageDescription`: "Agent Crew chạy trên máy này cần đọc và ghi mã nguồn trong thư mục Tài liệu."
  - `NSDesktopFolderUsageDescription`: "Agent Crew chạy trên máy này cần truy cập thư mục Màn hình nền khi việc yêu cầu."
  - `NSDownloadsFolderUsageDescription`: "Agent Crew chạy trên máy này cần truy cập thư mục Tải về khi việc yêu cầu."
  - `NSRemovableVolumesUsageDescription`: "Agent Crew chạy trên máy này cần truy cập ổ đĩa ngoài khi việc yêu cầu."
- Đóng cửa sổ không thoát app (`window-all-closed` rỗng). Mở từ login item (`getLoginItemSettings().wasOpenedAtLogin`) thì chỉ hiện tray.
- Một instance (`app.requestSingleInstanceLock()`); lần mở thứ hai chỉ đưa cửa sổ lên.
- Không dùng `safeStorage`. Secret không đi qua renderer: renderer gửi chuỗi dán vào Main một lần, Main chuyển thẳng tới `setStatusSecret`/Keychain rồi bỏ.
- Không ghi, xóa, đổi tên file nào trong `~/.crew` ngoài việc gọi hàm `@crew/mac`.
- Renderer không có `nodeIntegration`, có `contextIsolation`, `sandbox: true`.

---

## Cấu trúc file

| Path | Trách nhiệm |
|---|---|
| `apps/mac-app/package.json` | `@crew/mac-app`, deps cố định (mục Tech Stack của plan), script `dev`, `build`, `package`, `test`, `typecheck` |
| `apps/mac-app/electron.vite.config.ts` | main/preload/renderer/utility; `@crew/mac` bundle vào main và utility |
| `apps/mac-app/electron-builder.yml` | đóng gói, Info.plist, entitlements, `extraResources` crew-mac, `publish` (UPD-2 thêm mục `publish`) |
| `apps/mac-app/build/entitlements.mac.plist`, `build/icon.png` | entitlements, icon (chép icon v2) |
| `src/main/index.ts` | khởi động, đăng ký module (mỗi module một dòng `registerX`) |
| `src/main/app-state.ts` | `AppStateStore` (I3) |
| `src/main/app-log.ts` | port `AppLog`, `redactFields` v2; file `app.log` xoay 10 MB |
| `src/main/window.ts`, `tray.ts`, `login-item.ts` | cửa sổ, tray, login item (port v2) |
| `src/main/ops-bridge.ts`, `src/utility/ops.ts` | gọi `@crew/mac` trong `utilityProcess` |
| `src/main/ipc.ts`, `src/shared/ipc-contract.ts`, `src/preload/index.ts` | hợp đồng IPC I5 |
| `src/main/{health,runs,logs,notifications}.ts` | AP-3 |
| `src/main/setup/{wizard,import-existing,disk-access,sshd-handoff,machine-check}.ts` | AP-5 |
| `src/main/setup/v2-removal.ts` | AP-6 |
| `src/renderer/**` | màn hình |

---

### Task 1 (AP-1): Khung app

**Files:**
- Create: toàn bộ file khung ở bảng trên (trừ AP-3/5/6), `apps/mac-app/test/{app-state,app-log,ipc-contract,ops-bridge}.test.ts`, `docs/flows/mac-app.md`
- Modify: `pnpm-lock.yaml`, `docs/flows.yaml` (khối `mac-app`)

**Interfaces:**
- Consumes: I1 (`createMacContext`, các hàm thư viện).
- Produces: I3 `AppStateStore`; I5 `ipc-contract.ts` đủ mọi kênh của plan (kể cả kênh của AP-4, PJ-1, UPD-1); `OpsBridge`:

```ts
export interface OpsApi {
  doctor(opts: DoctorOptions): CheckResult[];
  setup(opts: SetupOptions): SetupReport;
  configureStatus(url: string, companyId: string): StatusConfig;
  setStatusSecret(secret: string): void;
  addStatusRepo(projectId: string, path: string): void;
  removeStatusRepo(projectId: string): void;
  listStatusRepos(): StatusRepo[];
  installCrewMacFrom(srcDir: string): { installed: boolean; version: string; backup: string | null; reason?: string };
  sendStatus(): void;
  workflowCheck(input: { root: string; pluginDir: string }): WorkflowReport;
}
export interface OpsBridge {
  call<K extends keyof OpsApi>(op: K, ...args: Parameters<OpsApi[K]>): Promise<ReturnType<OpsApi[K]>>;
}
```

  `utility/ops.ts` dựng `createMacContext({ env: process.env, out: (l) => log.info('ops', { line: l }), cliPath: <home>/.crew/app/crew-mac/dist/cli.js })` mỗi lời gọi. Lỗi trả về `{ ok: false, error: { name, message } }` và Main ném lại `Error` cùng `name`. Hàm `@crew/mac` không nhận `ctx` qua IPC.

- [ ] **Step 1: Khung package.** `package.json` deps: `electron@44.4.5`, `electron-vite@5.0.0`, `electron-builder@26.15.3`, `electron-updater@^6.8.9`, `react@^19`, `react-dom@^19`, `@crew/mac: workspace:*`; dev: `@testing-library/react`, `jsdom`, `vitest`. Script:
  - `"build": "electron-vite build"`
  - `"package": "electron-vite build && pnpm --filter @crew/mac build && electron-builder --mac dir zip dmg --arm64"`
  - `"test": "vitest run"`
  - `"typecheck": "tsc -p tsconfig.json --noEmit"`

  Chạy `pnpm install` (một việc nặng).
- [ ] **Step 2: Test `AppStateStore`**

```ts
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AppStateStore, defaultAppState } from '../src/main/app-state.js';

it('tạo file mode 600 với mặc định, update nối tiếp không mất ghi', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-state-'));
  const store = new AppStateStore(join(dir, 'app.json'), '0.1.0');
  await Promise.all([
    store.update((s) => ({ ...s, sshdPid: 1 })),
    store.update((s) => ({ ...s, updateState: 'downloading' })),
  ]);
  const saved = JSON.parse(readFileSync(join(dir, 'app.json'), 'utf8'));
  expect(saved).toMatchObject({ version: 1, appVersion: '0.1.0', sshdPid: 1, updateState: 'downloading' });
  expect(statSync(join(dir, 'app.json')).mode & 0o777).toBe(0o600);
});
it('file hỏng thì dùng mặc định và giữ bản hỏng thành app.json.broken-<giờ>', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-state-'));
  writeFileSync(join(dir, 'app.json'), '{');
  const store = new AppStateStore(join(dir, 'app.json'), '0.1.0');
  expect(store.get()).toEqual(defaultAppState('0.1.0'));
  expect(readdirSync(dir).some((f) => f.startsWith('app.json.broken-'))).toBe(true);
});
it('appVersion luôn là bản đang chạy dù file ghi bản khác', () => {
  const dir = mkdtempSync(join(tmpdir(), 'app-state-'));
  writeFileSync(join(dir, 'app.json'), JSON.stringify({ ...defaultAppState('0.0.9'), sshdPid: 7 }));
  const state = new AppStateStore(join(dir, 'app.json'), '0.1.0').get();
  expect(state.appVersion).toBe('0.1.0');
  expect(state.sshdPid).toBe(7);
});
```

  Import thêm `readdirSync`, `writeFileSync` từ `node:fs`.

- [ ] **Step 3: Cài `app-state.ts`** theo đúng kiểu I3; ghi atomic (`writeFileSync(tmp, …, { mode: 0o600 })` + `renameSync`); hàng đợi Promise để `update` nối tiếp; `get()` trả bản sao.
- [ ] **Step 4: Test và port `app-log.ts`** từ v2 (`redactFields`, `localTimestamp` giờ `Asia/Ho_Chi_Minh`, xoay 10 MB giữ 1 bản `app.log.1`). Test: entry `{ token: 'abc', nested: { webhookSecret: 'x', authorization: 'Bearer y' } }` ghi ra `"[đã ẩn]"` cho cả ba; chuỗi `Bearer …` trong `message` cũng bị ẩn.
- [ ] **Step 5: Test hợp đồng IPC.** `ipc-contract.ts` khai `IPC_CHANNELS` (mảng hằng mọi kênh I5) và kiểu tham số/kết quả từng kênh. Test: không trùng tên; mọi kênh preload xuất (`window.crew.invoke(channel, …)`) nằm trong `IPC_CHANNELS`; Main từ chối kênh lạ (`ipc.ts` chỉ `handle` kênh có trong danh sách, kênh chưa có handler trả lỗi `"Chưa hỗ trợ: <kênh>"`).
- [ ] **Step 6: Test `ops-bridge`** với `utilityProcess` giả (EventEmitter): gọi `call('listStatusRepos')` gửi `{ id, op, args }`, nhận `{ id, ok: true, result }`; utility chết giữa chừng → Promise reject `"Tiến trình phụ dừng bất thường"` và lần gọi sau tự `fork` lại; hai lời gọi song song nhận đúng kết quả theo `id`.
- [ ] **Step 7: Cài `window.ts`, `tray.ts`, `login-item.ts`, `index.ts`.**
  - Port `electronLoginItem` v2.
  - Login item chỉ bật ở bước `done` của wizard (AP-5), không bật lúc khởi động.
  - Tray: menu "Mở 2P Crew", "Thoát"; chỗ cho chấm màu và số run (AP-3 điền).
  - `index.ts` theo thứ tự: single instance → `AppStateStore` → `AppLog` → `registerIpc` → `registerTray` → các dòng `registerX` của module khác (mỗi ticket thêm dòng của mình).
- [ ] **Step 8: `electron-builder.yml`.**

```yaml
appId: com.2p-solutions.crew.mac
productName: 2P Crew
copyright: Copyright © 2P Solutions
directories: { output: dist, buildResources: build }
asar: true
extraResources:
  - from: ../crew-mac
    to: crew-mac
    filter: [package.json, dist/**, assets/**]
mac:
  target:
    - { target: zip, arch: [arm64] }
    - { target: dmg, arch: [arm64] }
  artifactName: 2P-Crew-${version}-${arch}-mac.${ext}
  category: public.app-category.developer-tools
  icon: build/icon.png
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize: false
  extendInfo:
    LSUIElement: false
    NSDocumentsFolderUsageDescription: Agent Crew chạy trên máy này cần đọc và ghi mã nguồn trong thư mục Tài liệu.
    NSDesktopFolderUsageDescription: Agent Crew chạy trên máy này cần truy cập thư mục Màn hình nền khi việc yêu cầu.
    NSDownloadsFolderUsageDescription: Agent Crew chạy trên máy này cần truy cập thư mục Tải về khi việc yêu cầu.
    NSRemovableVolumesUsageDescription: Agent Crew chạy trên máy này cần truy cập ổ đĩa ngoài khi việc yêu cầu.
dmg:
  title: 2P Crew ${version}
  artifactName: 2P-Crew-${version}-${arch}.${ext}
```

  Danh tính ký lấy từ biến `CSC_NAME` lúc chạy; không ghi tên danh tính vào file. Notarize do `release.mjs` (UPD-2) làm, nên `notarize: false`.
- [ ] **Step 9: Kiểm build không ký.** Run: `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @crew/mac-app build && pnpm --filter @crew/mac-app exec vitest run && pnpm --filter @crew/mac-app typecheck`. Expected: PASS, có `apps/mac-app/out/main/index.js`. Đóng gói thử một lần `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --filter @crew/mac-app exec electron-builder --mac dir --arm64`, rồi `/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "apps/mac-app/dist/mac-arm64/2P Crew.app/Contents/Info.plist"` → `com.2p-solutions.crew.mac`; `ls "…/Contents/Resources/crew-mac/dist/cli.js"` có.
- [ ] **Step 10: Docs + commit.** Khối `mac-app` trong `flows.yaml` (entrypoint `apps/mac-app/src/main/index.ts`, files mọi file nguồn đã tạo kể cả `.tsx`, `.html`, `.css` dưới `src/`, tests). `docs/flows/mac-app.md` theo mẫu `mac-setup.md`: Mục đích, Điểm vào, Các bước (khởi động, tray, cửa sổ), Files, Dữ liệu (`app.json`, `app.log`), Lưu ý quyền macOS (bundle id, Info.plist), Flow liên quan (`mac-app-sshd`, `mac-app-paperclip`, `mac-app-update`, `mac-setup`), Tests. `crew-docs generate`.

```bash
git add apps/mac-app pnpm-lock.yaml docs/flows.yaml docs/flows/mac-app.md docs/files.md
git commit -m "feat(mac-app): khung app macOS 2P Crew gọi @crew/mac"
```

---

### Task 2 (AP-3): Sức khỏe, Run đang chạy, Log, tray

**Files:**
- Create: `src/main/{health,runs,logs,notifications}.ts`, `src/renderer/routes/{health,runs,logs}.tsx`, `src/renderer/components/check-row.tsx`, test `test/{health,runs,logs,notifications}.test.ts`, `test/renderer/health.test.tsx`
- Modify: `src/main/tray.ts`, `src/main/index.ts` (3 dòng), `src/renderer/app.tsx` (3 dòng route), `docs/flows/mac-app.md`, khối `mac-app`

**Interfaces:**
- Consumes: `OpsBridge.call('doctor', …)`; I4 `SshdSupervisor.activeRuns`, `status`, `onChange`; I6 `PaperclipClient.cancelRun`, `runWebUrl`; `AppStateStore`.
- Produces: kênh I5 `health:*`, `runs:*`, `logs:*`; `worstStatus(results: CheckResult[]): CheckStatus`.

- [ ] **Step 1: Test lịch và thông báo** (`health.test.ts`, đồng hồ giả):
  1. Khởi động gọi `doctor({ probe: false, tccWindow: '24h', probeTimeoutSec: 90 })` một lần, rồi mỗi 15 phút; `health:run(true)` gọi `probe: true` ngay.
  2. Hai lần chạy chồng nhau (lần trước chưa xong) → lần sau đợi, không chạy song song.
  3. Kết quả chuyển từ không có `fail` sang có `fail` → đúng một thông báo "2P Crew: máy có lỗi" body là `title` của check `fail` đầu tiên. Vẫn `fail` ở lần sau → không thông báo lại. Về hết `fail` → thông báo "2P Crew: máy đã ổn".
  4. `worstStatus([])` = `ok`; có `warn` = `warn`; có `fail` = `fail`.
- [ ] **Step 2: Test run** (`runs.test.ts`): `runs:list` trả `activeRuns()`; `runs:cancel(id)` gọi `cancelRun(id)` đúng một lần, trả `{ ok: true, message: 'Đã gửi lệnh hủy, Paperclip sẽ dừng run.' }`; client ném 401 → `{ ok: false, message: 'Cần đăng nhập lại Paperclip (mục Cài đặt).' }`; `runs:cancel` không bao giờ gọi `process.kill`.
- [ ] **Step 3: Test log** (`logs.test.ts`): đọc tối đa 512 KB cuối file; `lines` cắt đúng số dòng cuối; `runId` lọc dòng chứa chuỗi đó; file không tồn tại → `[]`; `file` ngoài 4 giá trị → lỗi. Bốn đường dẫn: `app` = `~/Library/Application Support/2P Crew/app.log`, `sshd` = `macPaths(home).sshdLog`, `reaper` = `macPaths(home).reaperLog`, `status` = `macPaths(home).statusLog`.
- [ ] **Step 4: Cài** `health.ts`, `runs.ts`, `logs.ts`, `notifications.ts` (port `Notifier` v2, dùng `new Notification({ title, body })`), tray: chấm `🟢/🟡/🔴` theo `worstStatus`, dòng "N run đang chạy" cập nhật mỗi 30 giây và khi `onChange`.
- [ ] **Step 5: Màn hình.**
  - `health.tsx`: danh sách `CheckRow` (ĐẠT/CẢNH BÁO/LỖI, `detail`, `hint`); nút "Kiểm lại có thử claude"; nút hành động theo id: `tcc-pending` → mở pane quyền, `sshd-agent` → "Chạy lại cài đặt" (về wizard bước sshd), còn lại → "Mở Terminal" (`open -a Terminal`).
  - `runs.tsx`: bảng run id, agent (tên thư mục worktree), thời gian chạy theo giờ Asia/Ho_Chi_Minh, số process con, link "Mở trên web" (`runWebUrl`), nút "Hủy run" có hỏi xác nhận.
  - `logs.tsx`: chọn file, ô lọc run id, nút "Mở trong Finder" (`shell.showItemInFolder`).
  - Test renderer `health.test.tsx`: một check `fail` hiện chữ "LỖI" và gợi ý.
- [ ] **Step 6: Kiểm + docs + commit.** Run: `pnpm --filter @crew/mac-app exec vitest run test/health.test.ts test/runs.test.ts test/logs.test.ts test/notifications.test.ts test/renderer/health.test.tsx && pnpm --filter @crew/mac-app typecheck` → PASS. `mac-app.md` mục Màn hình (sức khỏe, run, log); khối `mac-app` thêm file.

```bash
git add apps/mac-app docs/flows.yaml docs/flows/mac-app.md docs/files.md
git commit -m "feat(mac-app): màn hình sức khỏe, run đang chạy và log"
```

---

### Task 3 (AP-5): Wizard cài đặt lần đầu

**Files:**
- Create: `src/main/setup/{wizard,machine-check,import-existing,disk-access,sshd-handoff}.ts`, `src/renderer/routes/setup.tsx`, `src/renderer/components/wizard-step.tsx`, test `test/setup-{wizard,import,disk-access,sshd-handoff}.test.ts`
- Modify: `src/main/index.ts` (1 dòng), `src/renderer/app.tsx` (1 dòng), `docs/flows/mac-app.md`, khối `mac-app`

**Interfaces:**
- Consumes: `OpsBridge` (`setup`, `configureStatus`, `setStatusSecret`, `installCrewMacFrom`, `doctor`); I4 (`start`, `status`, `activeRuns`); I6 (`paperclip:login`, `companies`); `readManifest`, `macPaths`, `readStatusConfig`, `forbiddenRootReason`; `AppStateStore`.
- Produces: kênh `setup:state`, `setup:step`; `StepResult = { ok: boolean; message: string; next: AppState['setup']['step'] }`; thứ tự bước `check → v2 → move → paperclip → machine → disk-access → sshd → doctor → done` (bước `v2`, `move` do AP-6 cài; AP-5 để hai bước đó trả `{ ok: true, next }` cho tới khi AP-6 gộp).

- [ ] **Step 1: Test `machine-check`.** Runner giả:
  - `sw_vers -productVersion` `26.6.2` → ok; `14.7` → lỗi "Cần macOS 15 trở lên".
  - `/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4` ra `100.x` → ok; lỗi → "Mở Tailscale và đăng nhập".
  - `/bin/zsh -lc 'claude auth status'` có `"loggedIn": true` → ok; không → "Chạy claude và đăng nhập một lần trong Terminal".

  Superpowers ghim do `setup` cài và check `superpowers-pin` của doctor kiểm ở bước `doctor`.
- [ ] **Step 2: Test `import-existing`.** HOME giả:
  - Có manifest (cổng 2222, `worktreeRoot ~/crew-agents`), có `~/.crew/status.json` (`url`, `companyId`), Keychain giả trả có `crew-mac-status` → `{ kind: 'existing', port: 2222, worktreeRoot, statusUrl, companyId, hasWebhookSecret: true }`. Không sinh key, không gọi `setup` với `paperclipKey`.
  - Không có manifest → `{ kind: 'fresh' }`.
  - Manifest hỏng (`SetupError`) → `{ kind: 'broken', message }`, wizard hiện thông báo và nút "Cài lại từ đầu".
- [ ] **Step 3: Test bước `machine`.**
  - Máy `existing`: gọi `installCrewMacFrom(<resources>/crew-mac)` rồi `setup({})` (không cờ, giữ chủ sshd hiện có).
  - Máy `fresh`: bắt buộc key Paperclip (chuỗi `ssh-ed25519 …`), secret webhook (gọi `setStatusSecret` một lần, rồi biến chứa secret bị gán `''`), cổng mặc định 2222, thư mục mặc định `~/crew-agents`; `forbiddenRootReason` khác null thì bước lỗi với đúng lý do.
  - Origin/company đã có từ bước `paperclip` → `configureStatus(origin, companyId)`.
- [ ] **Step 4: Test `disk-access`.** Port `detectFullDiskAccess` v2 với probe giả: đọc được → `granted`; EPERM → `denied`; không tồn tại → `unknown`. Nút mở `x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles`. Cửa sổ focus lại thì dò lại. `denied` cho đi tiếp kèm cảnh báo; bước `doctor` vẫn chạy.
- [ ] **Step 5: Test `sshd-handoff`** (Review Focus 2):
  1. `activeRuns()` có 1 run → `{ ok: false, message: 'Có 1 run đang chạy; chờ run xong rồi chuyển.' }`, không gọi `setup`.
  2. Bình thường: gọi `setup({ sshdOwner: 'app' })`, rồi `supervisor.start()`, rồi chờ tới 15 giây cho `status().state === 'running'` và `lsof -nP -iTCP:<port> -sTCP:LISTEN` có pid = `status().pid` → `ok: true`.
  3. Listener không lên trong 15 giây (supervisor giả ở `backoff`) → gọi `setup({ sshdOwner: 'launchd', force: true })`, `ok: false`, message gồm `lastError` và 20 dòng cuối `sshd.log`. `appState.sshdOwner === 'launchd'`.
  4. Đã ở chế độ app và listener đang chạy → `ok: true`, không gọi `setup`.
- [ ] **Step 6: Test `wizard`.** Bước làm xong ghi `setup.step` kế tiếp vào `app.json`; mở lại app tiếp từ bước dở; bước `done` bật login item (`loginItem.set(true)`) và chỉ khi mọi bước trước `ok`. Bước `doctor` `ok` khi 0 `fail`.
- [ ] **Step 7: Cài các module và `setup.tsx`.** Mỗi bước một `WizardStep` (tiêu đề, mô tả, ô nhập, nút "Tiếp", thông báo lỗi). Bước `paperclip`: ô origin mặc định `https://crew.2p-solutions.com`, nút "Đăng nhập" mở `approvalUrl` bằng `shell.openExternal`, chờ duyệt (poll `paperclip:loginStatus` mỗi 2 giây), chọn company. Bước `machine` máy `existing` ghi "Nhận cài đặt có sẵn" và chỉ có nút "Tiếp".
- [ ] **Step 8: Kiểm + docs + commit.** Run: `pnpm --filter @crew/mac-app exec vitest run test/setup-*.test.ts && pnpm --filter @crew/mac-app typecheck` → PASS. `mac-app.md` mục "Cài đặt lần đầu" (thứ tự bước, nhận cài đặt có sẵn, tự lui khi chuyển sshd).

```bash
git add apps/mac-app docs/flows.yaml docs/flows/mac-app.md docs/files.md
git commit -m "feat(mac-app): wizard cài đặt nhận cài đặt có sẵn và chuyển sshd sang app"
```

---

### Task 4 (AP-6): Gỡ app v2, chuyển vào Applications

**Files:**
- Create: `src/main/setup/v2-removal.ts`, `test/setup-v2-removal.test.ts`
- Modify: `src/main/setup/wizard.ts` (bước `v2`, `move`), `src/renderer/routes/setup.tsx` (hai bước), `docs/flows/mac-app.md`

**Interfaces:**
- Consumes: `shell.trashItem`, `app.moveToApplicationsFolder`, runner (`/usr/libexec/PlistBuddy`, `/usr/bin/pgrep`, `/usr/bin/tccutil`, `/usr/bin/osascript`).
- Produces: `detectV2(deps): Promise<{ appPath: string | null; running: boolean; isSelf: boolean }>`, `removeV2(deps): Promise<{ removed: string[]; manual: string[] }>`.

- [ ] **Step 1: Test** (Review Focus 5). HOME giả có `~/.crew/{config.yaml,desktop.json,settings-cache.json,state.db,runtime/a.js,assistant/b.md,logs/daemon.log,bin/crew-mac,status.json}`; `/Applications` giả có `2P Crew.app` với `CFBundleIdentifier` `com.2p-solutions.crew`.
  1. Băm toàn cây `~/.crew` (đường dẫn + sha256 + mode) trước; `removeV2` xong băm lại → giống hệt.
  2. `trashItem` được gọi đúng một lần với `/Applications/2P Crew.app`; runner có `tccutil reset All com.2p-solutions.crew` đúng một lần; không có lệnh nào chứa `.crew/` trong đối số.
  3. App v2 đang chạy (`pgrep -f '/Applications/2P Crew.app/Contents/MacOS/'` có pid mà `isSelf` sai) → `removeV2` không xóa gì, trả `manual: ['Thoát app 2P Crew cũ (menu → Thoát) rồi bấm Thử lại']`.
  4. `/Applications/2P Crew.app` có bundle id `com.2p-solutions.crew.mac` (chính app mới, cài bằng dmg kéo đè) → không gửi vào Thùng rác; vẫn `tccutil reset` bundle cũ.
  5. Không có app v2 → `removed: []`, bước `ok`.
  6. Kiểm tĩnh: nội dung file `src/main/setup/v2-removal.ts` không chứa chuỗi `'.crew'`.
- [ ] **Step 2: Cài.**
  - Đọc bundle id bằng `PlistBuddy -c 'Print :CFBundleIdentifier'`.
  - Gỡ login item kiểu cũ: `osascript -e 'tell application "System Events" to delete (every login item whose path is "/Applications/2P Crew.app")'`. Chạy trước bước `move` và trước khi app mới bật login item của mình.
  - Login item kiểu `SMAppService` của bundle v2 không gỡ được từ app khác: thêm `manual: ['Mở Cài đặt hệ thống → Cài đặt chung → Mục đăng nhập, tắt "2P Crew" cũ nếu còn']` kèm nút mở `x-apple.systempreferences:com.apple.LoginItems-Settings.extension`.
  - Bước `move`: `app.isInApplicationsFolder()` đúng thì `ok`; không thì `app.moveToApplicationsFolder({ conflictHandler: (t) => t !== 'existsAndRunning' })`. `existsAndRunning` thì báo "Thoát bản 2P Crew đang chạy trong Applications rồi thử lại".
- [ ] **Step 3: Kiểm + docs + commit.** Run: `pnpm --filter @crew/mac-app exec vitest run test/setup-v2-removal.test.ts test/setup-wizard.test.ts && pnpm --filter @crew/mac-app typecheck` → PASS. `mac-app.md` mục "Gỡ app v2": danh sách thứ bị gỡ, danh sách file v2 trong `~/.crew` được giữ nguyên (Q5).

```bash
git add apps/mac-app docs/flows/mac-app.md docs/files.md
git commit -m "feat(mac-app): gỡ app v2 và giữ nguyên dữ liệu v2"
```
