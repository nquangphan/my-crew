# Crew v3 R2-1: gói `mac-runtime` (SP-1, AP-2, CV-1), kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chứng minh (SP-1) rồi hiện thực (AP-2) việc app 2P Crew sinh và giữ sshd agent làm process con để macOS gán quyền TCC cho app, thoát/crash app không giết run, rồi chuyển Mac mini sang chế độ đó có đường lui (CV-1).

**Architecture:** Main process của Electron sinh `/usr/sbin/sshd -D -f ~/.crew-mac/sshd/sshd_config -E ~/.crew-mac/sshd/sshd.log` bằng `child_process.spawn(..., { detached: true, stdio: 'ignore' })`. Responsible process được kế thừa qua fork/exec (E3), nên listener, `sshd-session`, shell và `claude` đều nhận app. Listener ở process group riêng (detached) nên app thoát không kéo theo. Bộ giám sát chỉ đụng listener do chính nó sinh hoặc listener có argv khớp file cấu hình crew-mac.

**Tech Stack:** Electron 44.4.5 (Main ESM), Node `child_process`, `@crew/mac` (`macPaths`, `readManifest`, `listProcesses`, `isClaudePrint`), OpenSSH `/usr/sbin/sshd`, `/usr/bin/log`, `cc` (Xcode CLT) cho helper đo responsible của spike.

**Spec:** [plan.md](plan.md) (Global Constraints, Review Focus 1–2, Interface I2–I4) và spec §2 (E1–E4), §5, §6, §12 bước 1, §14.

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng gói này:

- Không đụng `com.2p.crew-mac-sshd`, cổng 2222, `~/.crew-mac/**` cho tới CV-1. SP-1 dùng cổng `127.0.0.1:22999`, cấu hình, host key và authorized_keys riêng trong `~/crew-r21-spike/`.
- Không bao giờ gửi tín hiệu cho process có `comm` chứa `sshd-session` hoặc cho process không khớp argv `-f <sshdConfig của crew-mac>`.
- Spike dùng bundle id `com.2p-solutions.crew.spike` để không để lại quyền TCC cho bundle thật; cuối SP-1 `tccutil reset All com.2p-solutions.crew.spike`.
- Probe `claude -p` của spike chạy có giới hạn 120 giây và tự SIGKILL (`claude` bỏ qua TERM khi bị TCC chặn).
- Mọi process nền (sshd spike, app spike, phiên `ssh … sleep`) ghi vào `processes.md` khi bật và khi tắt.

---

## Cấu trúc file

| Path | Trách nhiệm |
|---|---|
| `~/crew-r21-spike/{package.json,main.cjs,electron-builder.yml,sshd_config,resp.c}` | App spike và helper đo responsible (ngoài repo, xóa cuối SP-1) |
| `plans/261009-1140-crew-v3-r2-1/spike-report.md` | Số liệu S1–S5 và quyết định cổng G0/G5 |
| `apps/mac-app/src/main/sshd/takeover.ts` | `planListenerTakeover` thuần: quyết định sinh mới / thay / bỏ qua |
| `apps/mac-app/src/main/sshd/backoff.ts` | `nextDelayMs`, reset sau 5 phút ổn định |
| `apps/mac-app/src/main/sshd/active-runs.ts` | `activeRuns()` từ `listProcesses` |
| `apps/mac-app/src/main/sshd/supervisor.ts` | `createSshdSupervisor(deps)` hiện thực I4 |
| `apps/mac-app/src/main/quit-guard.ts` | `decideQuit`, nút và câu chữ tiếng Việt |
| `apps/mac-app/test/sshd-*.test.ts`, `test/quit-guard.test.ts` | Test |
| `docs/flows/mac-app-sshd.md`, khối `mac-app-sshd` trong `docs/flows.yaml` | Docs |

---

### Task 1 (SP-1): Spike S1–S4 và cổng G0

**Files:**
- Create (ngoài repo): `~/crew-r21-spike/**`
- Create: `plans/261009-1140-crew-v3-r2-1/spike-report.md`
- Modify: `plans/261009-1140-crew-v3-r2-1/processes.md`

**Interfaces:**
- Consumes: danh tính `Apple Development` trong Keychain (`security find-identity -v -p codesigning`), `TCC_PREDICATE` của `apps/crew-mac/src/commands/doctor.ts`.
- Produces: `spike-report.md` với bảng S1–S4 (giá trị đo, lệnh, giờ) và một dòng `G0: ĐI` hoặc `G0: DỪNG — <lý do>`; quyết định mặc định của quit guard (`wait` hay `now`) cho AP-2.

- [ ] **Step 1: Dựng helper đo responsible**

```c
// ~/crew-r21-spike/resp.c — in: pid, pid responsible, đường dẫn binary của responsible
#include <stdio.h>
#include <stdlib.h>
#include <libproc.h>
extern pid_t responsibility_get_pid_responsible_for_pid(pid_t);
int main(int argc, char **argv) {
  for (int i = 1; i < argc; i++) {
    pid_t pid = (pid_t)atoi(argv[i]);
    pid_t resp = responsibility_get_pid_responsible_for_pid(pid);
    char path[PROC_PIDPATHINFO_MAXSIZE] = "";
    proc_pidpath(resp, path, sizeof path);
    printf("%d %d %s\n", pid, resp, path);
  }
  return 0;
}
```

Run: `cc -o ~/crew-r21-spike/resp ~/crew-r21-spike/resp.c && ~/crew-r21-spike/resp $$`
Expected: một dòng, responsible của shell hiện tại là app terminal.

- [ ] **Step 2: Dựng sshd spike** — `ssh-keygen -t ed25519 -N '' -f ~/crew-r21-spike/host_ed25519`, `ssh-keygen -t ed25519 -N '' -C crew-r21-spike -f ~/crew-r21-spike/client_ed25519`, chép `client_ed25519.pub` thành `~/crew-r21-spike/authorized_keys` (600). `sshd_config` sinh bằng đúng `renderSshdConfig` của crew-mac với `port 22999`, `listenAddress 127.0.0.1`, `pidFile ~/crew-r21-spike/sshd.pid`, `authorizedKeysFile ~/crew-r21-spike/authorized_keys`, `user $(id -un)`:

```bash
cd ~/Documents/projects/crew && pnpm --filter @crew/mac build && node -e '
import("./apps/crew-mac/dist/sshd-config.js").then(m => process.stdout.write(m.renderSshdConfig({
  port: 22999, listenAddress: "127.0.0.1", hostKey: process.env.HOME + "/crew-r21-spike/host_ed25519",
  pidFile: process.env.HOME + "/crew-r21-spike/sshd.pid",
  authorizedKeysFile: process.env.HOME + "/crew-r21-spike/authorized_keys", user: require("os").userInfo().username })))' \
  > ~/crew-r21-spike/sshd_config
/usr/sbin/sshd -t -f ~/crew-r21-spike/sshd_config && echo CONFIG_OK
```

Expected: `CONFIG_OK`.

- [ ] **Step 3: App spike** — `package.json` (`"main": "main.cjs"`, devDependencies `electron@44.4.5`, `electron-builder@26.15.3`), `electron-builder.yml` (`appId: com.2p-solutions.crew.spike`, `productName: 2P Crew Spike`, `mac: { target: dir, arch: arm64, hardenedRuntime: true, entitlements: entitlements.plist, identity: "<tên Apple Development lấy từ security find-identity>" }`, entitlements `com.apple.security.cs.allow-jit`, `com.apple.security.cs.allow-unsigned-executable-memory`). `main.cjs` dùng đúng cách spawn của AP-2:

```js
const { app, Tray, Menu, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const dir = `${process.env.HOME}/crew-r21-spike`;
app.whenReady().then(() => {
  const child = spawn('/usr/sbin/sshd', ['-D', '-f', `${dir}/sshd_config`, '-E', `${dir}/sshd.log`], {
    detached: true, stdio: 'ignore',
  });
  child.unref();
  writeFileSync(`${dir}/out-app.json`, JSON.stringify({ appPid: process.pid, sshdPid: child.pid, at: new Date().toISOString() }));
  const tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('Spike');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Bật mở cùng máy', click: () => app.setLoginItemSettings({ openAtLogin: true }) },
    { label: 'Tắt mở cùng máy', click: () => app.setLoginItemSettings({ openAtLogin: false }) },
    { label: 'Thoát', click: () => app.quit() },
  ]));
});
app.on('window-all-closed', () => {});
```

Run: `cd ~/crew-r21-spike && npm install && npx electron-builder --mac --dir && codesign -dv --verbose=2 "dist/mac-arm64/2P Crew Spike.app" 2>&1 | grep -E 'Authority|TeamIdentifier'`
Expected: `Authority=Apple Development: …`, `TeamIdentifier=<10 ký tự>`.

- [ ] **Step 4: S1 — mở qua LaunchServices như Finder.** `open "~/crew-r21-spike/dist/mac-arm64/2P Crew Spike.app"` (LaunchServices, cha là `launchd`, không phải terminal). Ghi `processes.md`. Mở phiên: `ssh -i ~/crew-r21-spike/client_ed25519 -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -p 22999 127.0.0.1 'echo SHELL=$$; sleep 600' &`. Đo:

```bash
APP=$(jq -r .appPid ~/crew-r21-spike/out-app.json); SSHD=$(cat ~/crew-r21-spike/sshd.pid)
SESS=$(pgrep -P "$SSHD" | head -1); SH=$(pgrep -f 'sleep 600' | head -1)
ps -o pid,ppid,pgid,comm -p "$APP,$SSHD,$SESS,$SH"
~/crew-r21-spike/resp "$SSHD" "$SESS" "$SH"
```

Expected (đạt S1): cả ba dòng `resp` có responsible = `$APP` và đường dẫn trong `2P Crew Spike.app/Contents/MacOS/`; `ppid` của listener = `$APP` (xác nhận lệch spec số 5: chuỗi cha khớp responsible).

- [ ] **Step 5: S1b — mở từ login item.** Bấm "Bật mở cùng máy"; hẹn owner một lần đăng xuất/đăng nhập khi `crew/ops/active-runs.sh` rỗng (ghi giờ owner đồng ý vào ledger). Sau đăng nhập đo lại như Step 4. Expected: như Step 4. Xong bấm "Tắt mở cùng máy".

- [ ] **Step 6: S2 — Claude qua sshd của app.**

```bash
S="ssh -i ~/crew-r21-spike/client_ed25519 -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -p 22999 127.0.0.1"
$S 'zsh -lc "claude auth status"'
$S 'zsh -lc "cd ~/crew-agents/mac-claude && ( claude -p \"Trả lời đúng một chữ: OK\" --max-turns 1 & P=\$!; ( sleep 120; kill -9 \$P 2>/dev/null ) & wait \$P )"'
```

Expected: `loggedIn: true` (hoặc JSON tương đương); lệnh thứ hai in `OK` trong 120 giây. Không có `claude` nào còn sống sau đó (`pgrep -f "claude -p"` rỗng).

- [ ] **Step 7: S3 — phiên sống qua TERM listener, thoát app, `kill -9` app.** Với mỗi kịch bản, mở phiên `$S 'sleep 90; date > ~/crew-r21-spike/s3-<tên>.txt'` rồi trong 5 giây: (a) `kill -TERM $(cat ~/crew-r21-spike/sshd.pid)`; (b) menu "Thoát" của app; (c) `kill -9 $APP`. Mở lại app giữa các kịch bản.
Expected: cả ba file `s3-a.txt`, `s3-b.txt`, `s3-c.txt` có giờ ≈ 90 giây sau. Ở (b) và (c), listener: (b) app không TERM listener trong spike nên listener còn sống với `ppid 1`; (c) như (b). Ghi các pid.

- [ ] **Step 8: S4 — TCC.** Trong phiên SSH của app: `$S 'ls ~/Desktop >/dev/null; echo rc=$?'`. Owner có mặt để bấm. Expected: hộp thoại ghi "2P Crew Spike" muốn truy cập thư mục Desktop. Owner bấm Cho phép. Rồi chạy cùng lệnh bằng một bản `claude` khác đường dẫn: `ls ~/.local/share/claude/versions/` có từ hai bản thì gọi trực tiếp bản cũ hơn `…/versions/<cũ> -p …` đọc một file trong `~/Desktop`; chỉ có một bản thì `claude update` khi owner đồng ý. Lấy log:

```bash
/usr/bin/log show --start "<mốc trước Step 8>" --predicate 'process == "tccd"' --style compact \
  | grep -E 'AUTHREQ_(PROMPTING|ATTRIBUTION)' | grep -E 'crew.spike|claude' > ~/crew-r21-spike/s4.log
```

Expected (đạt S4): sau lần cấp đầu, 0 dòng `AUTHREQ_PROMPTING` mới cho Desktop; dòng `AUTHREQ_ATTRIBUTION` của `claude` có `responsible` = `com.2p-solutions.crew.spike`.
S4b: `kill -9` app, mở phiên mới qua listener mồ côi, chạy `ls ~/Documents >/dev/null` (chưa cấp). Ghi: có hộp thoại không, tên gì, kết quả `rc`. Kết quả này chỉ chọn mặc định quit guard, không chặn G0.

- [ ] **Step 9: Viết `spike-report.md` và quyết định G0.** Bảng S1, S1b, S2, S3a–c, S4, S4b: lệnh, giá trị đo, đạt/không. Luật:
  - `G0: ĐI` khi S1, S1b, S2, S3a–c, S4 đều đạt.
  - Bất kỳ cái nào hỏng: `G0: DỪNG`, dừng plan, báo owner số liệu và đề xuất so sánh lại phương án `SMAppService.agent` (spec §12).
  - S4b xấu (hộp thoại không tên app, hoặc từ chối): ghi "quit guard mặc định = Chờ run xong; drain bắt buộc khi cập nhật" cho AP-2 và UPD-1. S4b tốt: mặc định "Thoát ngay, run vẫn chạy".

- [ ] **Step 10: Dọn.** Thoát app spike, `pkill -f "$HOME/crew-r21-spike/sshd_config"` (chỉ khớp sshd spike), kiểm `lsof -nP -iTCP:22999` rỗng, `tccutil reset All com.2p-solutions.crew.spike`, kiểm login item đã tắt (`sfltool dumpbtm | grep -c crew.spike` = 0), `rm -rf ~/crew-r21-spike`. Cập nhật `processes.md`.

- [ ] **Step 11: Commit báo cáo** (repo Crew, nhánh `r2-1`).

```bash
git add plans/261009-1140-crew-v3-r2-1/spike-report.md plans/261009-1140-crew-v3-r2-1/processes.md
git commit -m "docs(v3): báo cáo spike app macOS sở hữu sshd agent"
```

---

### Task 2 (AP-2): Bộ giám sát sshd và quit guard

**Files:**
- Create: `apps/mac-app/src/main/sshd/{takeover.ts,backoff.ts,active-runs.ts,supervisor.ts}`, `apps/mac-app/src/main/quit-guard.ts`
- Modify: `apps/mac-app/src/main/index.ts` (một dòng `registerSshd(app, appState)`), `docs/flows.yaml` (khối `mac-app-sshd`)
- Create: `docs/flows/mac-app-sshd.md`
- Test: `apps/mac-app/test/sshd-takeover.test.ts`, `sshd-backoff.test.ts`, `sshd-supervisor.test.ts`, `quit-guard.test.ts`

**Interfaces:**
- Consumes: I1 `macPaths(home)`, `readManifest(path)`, `listProcesses(runner)`, `readCwds(runner, pids)`, `isClaudePrint(command)`; I3 `AppStateStore.update`.
- Produces: I4 `SshdSupervisor`, `createSshdSupervisor(deps: SupervisorDeps): SshdSupervisor`; `decideQuit`, `QUIT_BUTTONS`, `quitMessage`.

- [ ] **Step 1: Test `planListenerTakeover`**

```ts
import { describe, expect, it } from 'vitest';
import { planListenerTakeover } from '../src/main/sshd/takeover.js';

const CFG = '/Users/u/.crew-mac/sshd/sshd_config';
const own = { pid: 500, comm: 'sshd', command: `/usr/sbin/sshd -D -f ${CFG} -E /Users/u/.crew-mac/sshd/sshd.log` };

describe('planListenerTakeover', () => {
  it('không có pidfile thì sinh mới', () => {
    expect(planListenerTakeover({ pidFromFile: null, proc: null, sshdConfig: CFG })).toEqual({ kind: 'spawn' });
  });
  it('pid trong pidfile đã chết thì sinh mới', () => {
    expect(planListenerTakeover({ pidFromFile: 500, proc: null, sshdConfig: CFG })).toEqual({ kind: 'spawn' });
  });
  it('listener cũ khớp argv thì thay', () => {
    expect(planListenerTakeover({ pidFromFile: 500, proc: own, sshdConfig: CFG })).toEqual({ kind: 'replace', pid: 500 });
  });
  it('pid bị tái dùng bởi sshd-session thì không bao giờ đụng', () => {
    const sess = { pid: 500, comm: 'sshd-session: u@notty', command: 'sshd-session: u@notty' };
    expect(planListenerTakeover({ pidFromFile: 500, proc: sess, sshdConfig: CFG })).toEqual({ kind: 'spawn' });
  });
  it('pid bị tái dùng bởi process khác thì không đụng', () => {
    const other = { pid: 500, comm: 'node', command: '/opt/homebrew/bin/node x.js' };
    expect(planListenerTakeover({ pidFromFile: 500, proc: other, sshdConfig: CFG })).toEqual({ kind: 'spawn' });
  });
  it('sshd của cấu hình khác (sshd hệ thống) thì không đụng', () => {
    const sys = { pid: 500, comm: 'sshd', command: '/usr/sbin/sshd -i' };
    expect(planListenerTakeover({ pidFromFile: 500, proc: sys, sshdConfig: CFG })).toEqual({ kind: 'spawn' });
  });
});
```

Run: `pnpm --filter @crew/mac-app exec vitest run test/sshd-takeover.test.ts` → FAIL (module chưa có).

- [ ] **Step 2: Cài `takeover.ts`**

```ts
export interface ListenerProc { pid: number; comm: string; command: string }
export type TakeoverPlan = { kind: 'spawn' } | { kind: 'replace'; pid: number };

/** Chỉ thay listener do crew-mac cấu hình; không bao giờ chọn sshd-session hay process khác. */
export function planListenerTakeover(input: {
  pidFromFile: number | null;
  proc: ListenerProc | null;
  sshdConfig: string;
}): TakeoverPlan {
  const { pidFromFile, proc, sshdConfig } = input;
  if (pidFromFile === null || proc === null || proc.pid !== pidFromFile) return { kind: 'spawn' };
  if (proc.comm.includes('sshd-session')) return { kind: 'spawn' };
  const argv = proc.command.split(/\s+/);
  const fIndex = argv.indexOf('-f');
  const isSshd = argv[0] === '/usr/sbin/sshd' || argv[0] === 'sshd';
  if (isSshd && fIndex >= 0 && argv[fIndex + 1] === sshdConfig) return { kind: 'replace', pid: proc.pid };
  return { kind: 'spawn' };
}
```

Run lại → PASS.

- [ ] **Step 3: Test và cài `backoff.ts`**

```ts
import { nextDelayMs } from '../src/main/sshd/backoff.js';
it('backoff 1s → 60s, reset sau 5 phút ổn định', () => {
  expect([0, 1, 2, 5, 6, 10].map((n) => nextDelayMs(n))).toEqual([1000, 2000, 4000, 32000, 60000, 60000]);
});
```

```ts
export const STABLE_RESET_MS = 5 * 60_000;
export function nextDelayMs(restarts: number): number {
  return Math.min(1000 * 2 ** Math.max(0, restarts), 60_000);
}
```

- [ ] **Step 4: Test `supervisor` với deps giả** (`SupervisorDeps = { home, readPidFile(): number | null, procInfo(pid): ListenerProc | null, spawnSshd(): FakeChild, signal(pid, sig), readOwner(): 'app' | 'launchd', watchManifest(cb): () => void, sleep(ms), now(), listProcesses(), state: AppStateStore }`). Các ca:
  1. `start()` khi `readOwner() === 'launchd'` → `status().state === 'disabled'`, `spawnSshd` không được gọi.
  2. `start()` có listener cũ khớp argv → `signal(500, 'SIGTERM')` đúng một lần, chờ pid biến mất (tối đa 5 giây, rồi `SIGKILL` chỉ pid đó), rồi `spawnSshd` một lần; `appState.sshdPid` = pid mới.
  3. Con thoát bất thường 3 lần → các lần sinh lại cách nhau 1000, 2000, 4000 ms (`sleep` giả ghi lại); `restarts === 3`; chạy ổn 5 phút (`now` giả) thì `restarts` về 0.
  4. `pause()` → `SIGTERM` listener của mình, con thoát không sinh lại, `state === 'paused'`; `resume()` sinh lại.
  5. `stopForQuit()` → chỉ một `signal` tới pid listener; không có `signal` nào tới pid khác trong bảng process giả (có `sshd-session` pid 777 và `claude` pid 778).
  6. Manifest đổi sang `launchd` (callback `watchManifest`) → TERM listener, `state === 'disabled'`, không sinh lại.
  7. `activeRuns()` với bảng process giả: `claude --print` có `runId` → tính; `claude` tương tác không `runId` → không tính; `claude --print` `envReadable: false` → không tính.

Run: `pnpm --filter @crew/mac-app exec vitest run test/sshd-supervisor.test.ts` → FAIL, cài, PASS.

- [ ] **Step 5: Cài `supervisor.ts` và `active-runs.ts`.** Sinh bằng:

```ts
spawn('/usr/sbin/sshd', ['-D', '-f', paths.sshdConfig, '-E', paths.sshdLog], { detached: true, stdio: 'ignore' });
```

  - `child.unref()`, nghe `exit` để backoff.
  - Lỗi `EADDRINUSE` đọc từ đuôi `sshd.log`: `lastError = "Cổng <port> đang bị chiếm: <lsof -nP -iTCP:<port> -sTCP:LISTEN>"`, vẫn backoff (không đổi cổng).
  - Mỗi lần đổi trạng thái gọi `AppStateStore.update((s) => ({ ...s, sshdPid, sshdOwner }))` và phát `onChange`.
  - `active-runs.ts`:

```ts
export async function activeRuns(deps: { listProcesses: () => Promise<ProcInfo[]>; cwds: (pids: number[]) => Promise<Map<number, string>> }): Promise<ActiveRun[]> {
  const procs = await deps.listProcesses();
  const runs = procs.filter((p) => p.runId !== null && isClaudePrint(p.command));
  const cwd = await deps.cwds(runs.map((p) => p.pid));
  return runs.map((p) => ({
    pid: p.pid, runId: p.runId as string, worktree: cwd.get(p.pid) ?? null, startedAt: p.startedAt,
    children: procs.filter((c) => c.ppid === p.pid).length,
  }));
}
```

- [ ] **Step 6: Test và cài `quit-guard.ts`**

```ts
import { decideQuit, QUIT_BUTTONS } from '../src/main/quit-guard.js';
it('không có run thì thoát ngay, không hỏi', async () => {
  let asked = false;
  expect(await decideQuit(0, async () => { asked = true; return 'cancel'; })).toEqual({ kind: 'quit-now' });
  expect(asked).toBe(false);
});
it('có run thì hỏi và theo lựa chọn', async () => {
  expect(await decideQuit(2, async () => 'wait')).toEqual({ kind: 'wait-then-quit' });
  expect(await decideQuit(2, async () => 'now')).toEqual({ kind: 'quit-now' });
  expect(await decideQuit(2, async () => 'cancel')).toEqual({ kind: 'stay' });
  expect(QUIT_BUTTONS).toEqual(['Chờ run xong rồi thoát', 'Thoát ngay, run vẫn chạy', 'Hủy']);
});
```

```ts
export type QuitChoice = 'wait' | 'now' | 'cancel';
export type QuitDecision = { kind: 'quit-now' } | { kind: 'wait-then-quit' } | { kind: 'stay' };
export const QUIT_BUTTONS = ['Chờ run xong rồi thoát', 'Thoát ngay, run vẫn chạy', 'Hủy'] as const;
export async function decideQuit(activeRuns: number, ask: (n: number) => Promise<QuitChoice>): Promise<QuitDecision> {
  if (activeRuns <= 0) return { kind: 'quit-now' };
  const choice = await ask(activeRuns);
  if (choice === 'wait') return { kind: 'wait-then-quit' };
  if (choice === 'now') return { kind: 'quit-now' };
  return { kind: 'stay' };
}
export function quitMessage(activeRuns: number): { message: string; detail: string } {
  return {
    message: `Có ${activeRuns} run đang chạy trên máy này.`,
    detail: 'Chờ run xong: máy không nhận run mới và thoát khi các run hiện tại kết thúc. Thoát ngay: run đang chạy vẫn chạy tới xong; run mới chờ tới khi mở lại app.',
  };
}
```

  Nút mặc định (`defaultId` của `dialog.showMessageBox`) lấy từ `spike-report.md` (S4b): 0 nếu S4b xấu, 1 nếu tốt.
  Nối vào Main (`registerSshd`): `before-quit` → `decideQuit((await supervisor.activeRuns()).length, ask)`:
  - `quit-now`: `await supervisor.stopForQuit()` rồi `app.exit(0)`.
  - `wait-then-quit`: `await supervisor.pause()`, tray "Đang chờ N run", kiểm `activeRuns()` mỗi 10 giây, về 0 thì `app.exit(0)`.
  - `stay`: `event.preventDefault()`.
  - `window-all-closed` không thoát app.

- [ ] **Step 7: Docs.** Thêm khối vào `docs/flows.yaml`:

```yaml
  mac-app-sshd:
    title: App 2P Crew giữ sshd agent và thoát an toàn
    doc: docs/flows/mac-app-sshd.md
    entrypoints:
      - apps/mac-app/src/main/sshd/supervisor.ts
    files:
      - apps/mac-app/src/main/sshd/takeover.ts
      - apps/mac-app/src/main/sshd/backoff.ts
      - apps/mac-app/src/main/sshd/active-runs.ts
      - apps/mac-app/src/main/quit-guard.ts
    tests:
      - apps/mac-app/test/sshd-takeover.test.ts
      - apps/mac-app/test/sshd-backoff.test.ts
      - apps/mac-app/test/sshd-supervisor.test.ts
      - apps/mac-app/test/quit-guard.test.ts
```

  `docs/flows/mac-app-sshd.md` theo mẫu `docs/flows/mac-setup.md` (Mục đích, Điểm vào, Các bước, Files, Dữ liệu, Lưu ý quyền macOS, Flow liên quan, Tests). Ghi bảng vòng đời spec §6 và luật "không bao giờ đụng `sshd-session`". Chạy `node packages/docs-kit/dist/crew-docs.cjs generate`.

- [ ] **Step 8: Kiểm và commit**

Run: `pnpm --filter @crew/mac-app exec vitest run test/sshd-*.test.ts test/quit-guard.test.ts && pnpm --filter @crew/mac-app typecheck && pnpm exec biome check apps/mac-app/src/main/sshd apps/mac-app/src/main/quit-guard.ts`
Expected: PASS, 0 lỗi.

```bash
git add apps/mac-app/src/main/sshd apps/mac-app/src/main/quit-guard.ts apps/mac-app/src/main/index.ts apps/mac-app/test docs/flows.yaml docs/flows/mac-app-sshd.md docs/files.md
git commit -m "feat(mac-app): giữ sshd agent làm process con và thoát không dừng run"
```

---

### Task 3 (CV-1): Chuyển Mac mini sang app, có đường lui

**Files:**
- Modify: `plans/261009-1140-crew-v3-r2-1/{processes.md,sdd-ledger.md}`
- Không sửa mã nguồn. Phát hiện lỗi thì mở ticket sửa trong gói sở hữu.

**Interfaces:**
- Consumes: bản build app từ `r2-1` (AP-1…AP-6, MC-1…MC-4 đã gộp); DP-1 đã deploy; I2 `crew-mac setup --sshd-owner launchd|app`.
- Produces: Mac mini ở chế độ `sshdOwner: app`, ghi trong ledger: pid listener, ppid, kết quả doctor, giờ.

- [ ] **Step 1: Điều kiện.**
  - `ssh nhamoiplatform /opt/crew-v3-spike/ops/active-runs.sh </dev/null` rỗng.
  - Trên Mac `pgrep -fl "claude.*--print"` rỗng.
  - Ghi trước: `shasum ~/.crew-mac/sshd/host_ed25519.pub`, `launchctl print gui/501/com.2p.crew-mac-sshd | grep -E 'state|pid'`, `shasum` các file v2 trong `~/.crew` (danh sách ở plan.md cổng 8) vào ledger.
- [ ] **Step 2: Build.** `security find-identity -v -p codesigning`: có `Developer ID Application` thì `CSC_NAME="<tên đó>"`, không thì `CSC_NAME="<Apple Development …>"` (ghi ledger: FDA sẽ cấp lại một lần ở UPD-3). Chạy `CSC_NAME="…" pnpm --filter @crew/mac-app package` (một việc nặng, ghi `processes.md`). Chép `apps/mac-app/dist/mac-arm64/2P Crew.app` sang `~/crew-r21-install/`.
- [ ] **Step 3: Mở app** từ `~/crew-r21-install/2P Crew.app` bằng `open`. Đi wizard:
  - Bước gỡ v2 (AP-6): owner xác nhận.
  - Bước "Chuyển vào Applications".
  - Bước (b) đăng nhập Paperclip (owner duyệt trên web).
  - Bước (c) "Nhận cài đặt có sẵn".
  - Bước (d) FDA (owner bật công tắc).
  - Bước (e) chuyển sshd sang app.
  - Bước (f) doctor.
- [ ] **Step 4: Kiểm (dừng ở dòng đầu tiên hỏng và sang Step 6).**
  - `launchctl print gui/501/com.2p.crew-mac-sshd` thoát khác 0.
  - `lsof -nP -iTCP:2222 -sTCP:LISTEN` một pid P; `ps -o ppid=,comm= -p P` là process chính `2P Crew`.
  - `shasum ~/.crew-mac/sshd/host_ed25519.pub` không đổi.
  - `crew-mac doctor --no-probe` 0 `fail`; `crew-mac doctor` (có probe) 0 `fail`.
  - Thẻ máy trên web có `app.version`.
- [ ] **Step 5: Một issue nhỏ** (owner tạo trên web, project `repo-a`) chạy tới stage reviewer; `AUTHREQ_ATTRIBUTION` của `claude` có responsible `com.2p-solutions.crew.mac`. Ghi ledger.
- [ ] **Step 6: Đường lui (chỉ khi Step 3–5 hỏng).** Thoát app (chọn "Thoát ngay"), `~/.crew/bin/crew-mac setup --sshd-owner launchd`, kiểm `launchctl print gui/501/com.2p.crew-mac-sshd` `state = running` và `crew-mac doctor --no-probe` 0 `fail`. Ghi lỗi vào ledger, mở ticket sửa ở gói sở hữu, rồi làm lại CV-1.
- [ ] **Step 7: Dọn.** Xóa `~/crew-r21-install/`, cập nhật `processes.md` (sshd chủ mới: app, cách lui: Step 6), commit ledger.

```bash
git add plans/261009-1140-crew-v3-r2-1/processes.md plans/261009-1140-crew-v3-r2-1/sdd-ledger.md
git commit -m "docs(v3): ghi chuyển Mac mini sang app 2P Crew giữ sshd"
```

## Rủi ro và rollback

| Rủi ro | Cách xử lý |
|---|---|
| G0 hỏng | Dừng plan, báo owner (Task 1 Step 9) |
| `launchctl bootout` giết phiên SSH của run (launchd dọn process group của job) | CV-1 chỉ chạy khi 0 run active; AP-5 bước (e) từ chối khi `activeRuns().length > 0` |
| Listener của app không lên sau bootout | AP-5 tự lui về `launchd` sau 15 giây (Review Focus 2); CV-1 Step 6 |
| FDA phải cấp lại khi đổi từ `Apple Development` sang Developer ID | Ghi ledger ở CV-1, cấp lại ở UPD-3 |
