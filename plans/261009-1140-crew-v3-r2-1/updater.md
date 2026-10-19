# Crew v3 R2-1: gói `updater` (UPD-2, UPD-1, UPD-3, UPD-4), kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phát hành app ký Developer ID + notarize bằng một script chạy trên Mac mini. App tự kiểm, tải, chờ máy rảnh, cài, tự kiểm 5 phút sau cài và tự quay lui khi hỏng. Owner bấm được "Quay về bản trước".

**Architecture:**
- `scripts/release.mjs` (logic thuần ở `release-lib.mjs`, test bằng `node --test`). Trình tự:
  1. Build `--mac dir`, ký bằng `CSC_NAME`.
  2. Notarize và staple bản `.app`.
  3. Đóng zip + dmg từ bản đã staple (`--prepackaged`), notarize và staple dmg.
  4. Tự kiểm, rồi `gh release create`.
- Trong app, `src/main/update/` bọc `electron-updater`: không tự tải, không tự cài khi thoát.
  - Bộ lọc phiên bản: tăng, đúng arm64, không thuộc `badVersions`.
  - Drain: tạm dừng listener, chờ hết run ≤ 30 phút.
  - `previous/` giữ một bản và một helper shell tách rời làm watchdog probation và quay lui.
  - Bản mới tự kiểm và ghi kết quả qua marker file. Chỉ Main ghi `app.json`.

**Tech Stack:** electron-updater ^6.8.9 (provider `github`, Squirrel.Mac), electron-builder 26.15.3, `xcrun notarytool`, `xcrun stapler`, `codesign`, `spctl`, `ditto`, `gh`.

**Spec:** [plan.md](plan.md) (Global Constraints, Review Focus 1 và 4, Interface I3, I4, I9) và spec §9, §13 cổng 1 và 5, §16 Q2, Q3.

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng gói này:

- Không bao giờ nhận, in, ghi file hay đưa vào argv: mật khẩu Apple ID, app-specific password, API key notary, `.p12`. Notarize chỉ bằng `--keychain-profile crew-notary`. Script không in `process.env`.
- `release.mjs` chỉ chạy `gh release create` khi không có `--dry-run`/`--no-publish`, và ở UPD-4 chỉ khi owner đã nói "làm".
- Không `allowDowngrade`, không `allowPrerelease`, không CI. Chỉ arm64.
- Bản không ký Developer ID (vd. bản `Apple Development` của CV-1) thì updater tắt, màn hình ghi lý do. Squirrel.Mac từ chối bản khác designated requirement.
- Drain không bao giờ TERM phiên SSH hay `claude`; chỉ `supervisor.pause()`.
- Helper quay lui chỉ ghi vào `/Applications/2P Crew.app` và thư mục app (`~/Library/Application Support/2P Crew/`).

---

## Cấu trúc file

| Path | Trách nhiệm |
|---|---|
| `apps/mac-app/scripts/release-lib.mjs` | hàm thuần: tag, cây sạch, chọn danh tính, đọc kết quả kiểm |
| `apps/mac-app/scripts/release-lib.test.mjs` | `node --test` |
| `apps/mac-app/scripts/release.mjs` | trình tự phát hành |
| `apps/mac-app/electron-builder.yml` | mục `publish` (I9) |
| `src/main/update/versions.ts` | `compareSemver`, `shouldOffer` |
| `src/main/update/drain.ts` | `drainForUpdate` |
| `src/main/update/rollback.ts` | `snapshotPrevious`, `spawnRollbackHelper`, script helper |
| `src/main/update/probation.ts` | `runProbation` |
| `src/main/update/updater.ts` | `registerUpdater`, máy trạng thái, kênh `update:*` |
| `src/renderer/routes/update.tsx` | màn hình Cập nhật |
| `docs/flows/mac-app-update.md`, khối `mac-app-update` | docs |

---

### Task 1 (UPD-2): Script phát hành

**Files:**
- Create: `apps/mac-app/scripts/{release-lib.mjs,release-lib.test.mjs,release.mjs}`, `docs/flows/mac-app-update.md`
- Modify: `apps/mac-app/electron-builder.yml` (thêm `publish`), `apps/mac-app/package.json` (script `"release": "node scripts/release.mjs"`), `docs/flows.yaml` (khối `mac-app-update`)

**Interfaces:**
- Produces: I9; `node apps/mac-app/scripts/release.mjs [--dry-run | --no-publish] [--identity "<tên>"]`. Mã thoát:

| Mã | Nghĩa |
|---|---|
| 0 | xong |
| 2 | cây git bẩn |
| 3 | tag sai |
| 4 | không có/nhiều danh tính |
| 5 | build lỗi |
| 6 | notarize lỗi |
| 7 | tự kiểm lỗi |
| 8 | đăng lỗi |

- [ ] **Step 1: Test hàm thuần**

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkTag, findDeveloperId, isCleanTree, notarizedBySpctl, teamIdOf } from './release-lib.mjs';

test('tag phải là mac-app/v<version của package.json> và trỏ HEAD', () => {
  assert.deepEqual(checkTag({ version: '0.1.0', tagsAtHead: ['mac-app/v0.1.0'] }), { ok: true, tag: 'mac-app/v0.1.0' });
  assert.equal(checkTag({ version: '0.1.0', tagsAtHead: [] }).ok, false);
  assert.equal(checkTag({ version: '0.1.0', tagsAtHead: ['mac-app/v0.1.1'] }).ok, false);
});
test('cây sạch: git status --porcelain rỗng', () => {
  assert.equal(isCleanTree(''), true);
  assert.equal(isCleanTree(' M apps/mac-app/package.json\n'), false);
});
test('chọn đúng một Developer ID Application', () => {
  const out = [
    '  1) AAAA "Apple Development: Phan (X1)"',
    '  2) BBBB "Developer ID Application: 2P SOLUTIONS (J7Y2DL6HZV)"',
    '     2 valid identities found',
  ].join('\n');
  assert.deepEqual(findDeveloperId(out), { ok: true, name: 'Developer ID Application: 2P SOLUTIONS (J7Y2DL6HZV)', teamId: 'J7Y2DL6HZV' });
  assert.equal(findDeveloperId('  1) AAAA "Apple Distribution: 2P SOLUTIONS (J7Y2DL6HZV)"').ok, false);
});
test('spctl và designated requirement', () => {
  assert.equal(notarizedBySpctl('x.app: accepted\nsource=Notarized Developer ID\norigin=Developer ID Application: 2P SOLUTIONS (J7Y2DL6HZV)'), true);
  assert.equal(notarizedBySpctl('x.app: accepted\nsource=Apple Development'), false);
  assert.equal(teamIdOf('designated => anchor apple generic and certificate leaf[subject.OU] = J7Y2DL6HZV'), 'J7Y2DL6HZV');
});
```

  Run: `node --test apps/mac-app/scripts/release-lib.test.mjs` → FAIL, cài, PASS.
- [ ] **Step 2: Cài `release.mjs`** (mọi lệnh qua `execFileSync` với mảng đối số, không shell):
  1. `git status --porcelain` sạch (2); tag tại HEAD khớp `version` (3).
  2. `security find-identity -v -p codesigning` → `findDeveloperId` (4); `--dry-run` bỏ qua bước này và đặt `CSC_IDENTITY_AUTO_DISCOVERY=false`.
  3. `pnpm --filter @crew/mac build`, `pnpm --filter @crew/mac-app build`, `electron-builder --mac dir --arm64 --publish never` với env `CSC_NAME=<name>` (5).
  4. Notarize app: `ditto -c -k --keepParent "<app>" <tmp>/app.zip`, `xcrun notarytool submit <tmp>/app.zip --keychain-profile crew-notary --wait --output-format json` (status phải `Accepted`), `xcrun stapler staple "<app>"` (6).
  5. `electron-builder --mac zip dmg --arm64 --prepackaged "<app>" --publish never` → zip, dmg, `latest-mac.yml`, blockmap trong `apps/mac-app/dist/`.
  6. Notarize + staple dmg như bước 4 (6).
  7. Tự kiểm (7):
     - `codesign --verify --deep --strict --verbose=2 "<app>"`
     - `spctl -a -vv "<app>"` → `notarizedBySpctl`
     - `xcrun stapler validate "<app>"` và dmg
     - `codesign -d -r- "<app>"` → `teamIdOf` = teamId của danh tính
     - `latest-mac.yml` có đúng tên zip theo I9
  8. Không `--no-publish`/`--dry-run`: `gh release create v<version> --repo nquangphan/crew-mac-releases --title "2P Crew <version>" --notes "Bản <version> của app macOS 2P Crew." <zip> <dmg> <blockmap> <latest-mac.yml>` (8).
  9. In bảng kết quả (đường dẫn file, sha256, Team ID), không in env.
- [ ] **Step 3: `electron-builder.yml` thêm**

```yaml
publish:
  provider: github
  owner: nquangphan
  repo: crew-mac-releases
  releaseType: release
```

- [ ] **Step 4: Kiểm dry-run.** `--dry-run` vẫn kiểm cây sạch nhưng bỏ qua kiểm tag, danh tính, notarize và đăng. Run: `node apps/mac-app/scripts/release.mjs --dry-run 2>&1 | tee /tmp/dryrun.log` → thoát 0, có zip, dmg chưa ký và `latest-mac.yml` trong `apps/mac-app/dist/`; `grep -ciE 'password|token|secret' /tmp/dryrun.log` = 0.
- [ ] **Step 5: Docs + commit.** Khối `mac-app-update` (entrypoint `apps/mac-app/scripts/release.mjs` và `src/main/update/updater.ts` (UPD-1 thêm), files, tests). `mac-app-update.md` mục "Phát hành": điều kiện, lệnh, mã thoát, việc owner làm một lần (`xcrun notarytool store-credentials crew-notary`).

```bash
git add apps/mac-app/scripts apps/mac-app/electron-builder.yml apps/mac-app/package.json docs/flows.yaml docs/flows/mac-app-update.md docs/files.md
git commit -m "feat(mac-app): script ký, notarize và phát hành app macOS"
```

---

### Task 2 (UPD-1): Updater trong app

**Files:**
- Create: `src/main/update/{versions,drain,rollback,probation,updater}.ts`, `src/main/update/rollback-helper.sh` (đóng vào app qua `extraResources`), `src/renderer/routes/update.tsx`, test `test/update-{versions,drain,rollback,probation,updater}.test.ts`
- Modify: `src/main/index.ts` (1 dòng `registerUpdater`), `src/renderer/app.tsx` (1 dòng), `electron-builder.yml` (`extraResources` thêm helper), `docs/flows/mac-app-update.md`, khối `mac-app-update`

**Interfaces:**
- Consumes: I3 (`updateState`, `update.{from,to,installedAt,badVersions,baseline}`), I4 (`pause`, `resume`, `stopForQuit`, `activeRuns`, `status`), `OpsBridge` (`doctor`, `sendStatus`), `isDeveloperIdSigned` (port v2).
- Produces: kênh I5 `update:*`; `UpdateView = { current: string; available: string | null; state: UpdateState; previous: string | null; enabled: boolean; reason: string | null; lastCheckedAt: string | null }`; sự kiện `app.log`: `update-available`, `update-downloaded`, `update-installed`, `update-probation-failed`, `update-rolled-back`, `update-skipped-bad`.

- [ ] **Step 1: Test `versions`.**
  - `compareSemver('0.1.10', '0.1.9') > 0`.
  - `shouldOffer({ current: '0.1.0', candidate: '0.1.1', badVersions: [] })` → `true`.
  - Cùng bản hay bản cũ hơn → `false`.
  - `badVersions: ['0.1.1']` → `false`; `candidate: '0.1.2'` cùng `badVersions` đó → `true`.
  - Tên file không có `arm64` trong danh sách `files` của `UpdateInfo` → `false`.
- [ ] **Step 2: Test `drain`** (supervisor giả, đồng hồ giả):
  1. 0 run → `pause()` một lần, trả `'install'` ngay.
  2. 2 run giảm về 0 sau 20 phút → `'install'`; `activeRuns` kiểm mỗi 10 giây; không có `signal` nào.
  3. Vẫn còn run sau 30 phút → gọi `ask(n)`. `'now'` → `'install'`. `'later'` → `resume()` rồi trả `'later'`; `updateState` về `waiting-idle`.
- [ ] **Step 3: Test `rollback`.**
  - `snapshotPrevious` gọi `ditto "<bundle>" "<support>/previous/2P Crew.app"` sau khi xóa bản cũ trong `previous/` (giữ 1).
  - `spawnRollbackHelper({ mode: 'now' | 'watchdog', … })` spawn `/bin/sh <resources>/rollback-helper.sh <mode> <waitPid> <support> <toVersion>` với `detached: true`, `stdio: 'ignore'`, `unref()`.
  - Không có `previous/` → nút "Quay về bản trước" tắt, `update:rollback` trả lỗi "Chưa có bản trước".
  - Nội dung helper:

```sh
#!/bin/sh
# rollback-helper.sh <now|watchdog> <pid chờ thoát> <thư mục app support> <bản đang thử>
set -eu
MODE=$1; WAIT_PID=$2; SUPPORT=$3; TO=$4
TARGET=${CREW_ROLLBACK_TARGET:-/Applications/2P Crew.app}; OPEN=${CREW_ROLLBACK_OPEN:-open}
PREV="$SUPPORT/previous/2P Crew.app"
if [ "$MODE" = watchdog ]; then
  sleep 360
  [ -f "$SUPPORT/probation/$TO.ok" ] && exit 0
  pkill -TERM -f "$TARGET/Contents/MacOS/2P Crew" || true
  WAIT_PID=$(pgrep -f "$TARGET/Contents/MacOS/2P Crew" | head -1 || true)
fi
while [ -n "$WAIT_PID" ] && kill -0 "$WAIT_PID" 2>/dev/null; do sleep 1; done
[ -d "$PREV" ] || exit 3
rm -rf "$TARGET.rollback-tmp" && mv "$TARGET" "$TARGET.rollback-tmp"
ditto "$PREV" "$TARGET" && rm -rf "$TARGET.rollback-tmp"
mkdir -p "$SUPPORT/probation" && echo "$TO" > "$SUPPORT/probation/rolled-back"
"$OPEN" "$TARGET"
```

  Test chạy helper thật trong thư mục tạm, đặt `CREW_ROLLBACK_TARGET=<tmp>/2P Crew.app` và `CREW_ROLLBACK_OPEN=/usr/bin/true`, `waitPid` là pid một `sleep 1` đã thoát. Kiểm: sau helper `now`, `TARGET` có nội dung của `PREV`, không còn `TARGET.rollback-tmp`, và `probation/rolled-back` chứa `TO`.
- [ ] **Step 4: Test `probation`** (deps giả, đồng hồ giả, `update.to === appVersion`, `updateState: 'installing'`):
  1. Listener `running` trong 60 giây, `doctor({ probe: false })` không có id `fail` nào ngoài `baseline`, `sendStatus` không ném → ghi `probation/<ver>.ok`, `updateState: 'idle'`, log `update-installed`; rồi khi `activeRuns()` rỗng (kiểm mỗi 10 phút) gọi `installCrewMacFrom(<resources>/crew-mac)` một lần cho bản này (spec §7: cài `crew-mac` mang theo khi máy rảnh).
  2. Listener không lên trong 5 phút → log `update-probation-failed` (lý do "sshd không lên"), thêm `<ver>` vào `badVersions`, `updateState: 'rolled-back'`, gọi `spawnRollbackHelper({ mode: 'now', waitPid: process.pid })` rồi `supervisor.stopForQuit()` và `app.exit(0)`.
  3. `doctor` có `fail` mới (id không trong `baseline`) → như 2, lý do nêu id.
  4. `sendStatus` ném → như 2, lý do "không gửi được bản tin máy".
  5. Khởi động thấy `probation/rolled-back` chứa `X` → log `update-rolled-back`, `badVersions` thêm `X`, `updateState: 'rolled-back'`, xóa marker.
  6. `updateState` không phải `installing` → không làm gì.
- [ ] **Step 5: Test `updater`** (autoUpdater giả):
  1. `isDeveloperIdSigned` sai → `enabled: false`, `reason: 'Bản này không ký Developer ID, cập nhật tự động tắt'`, không gọi `checkForUpdates`.
  2. Kiểm lúc khởi động, rồi mỗi 1 giờ, và khi `update:check`.
  3. `update-available` bản hợp lệ → `downloadUpdate`, `downloading`; bản trong `badVersions` → log `update-skipped-bad`, không tải.
  4. `update-downloaded`:
     - ghi `baseline` (id check `fail` hiện tại);
     - `drainForUpdate` trả `'install'` → `snapshotPrevious`, `spawnRollbackHelper({ mode: 'watchdog', … })`, `updateState: 'installing'`, `update.to`, `supervisor.stopForQuit()`, `autoUpdater.quitAndInstall(false, true)`;
     - trả `'later'` → không cài.
  5. `update:rollback` khi có run → hỏi xác nhận; đồng ý thì thêm bản hiện tại vào `badVersions`, `spawnRollbackHelper({ mode: 'now' })`, `stopForQuit`, `app.exit(0)`.
  6. Cấu hình: `autoDownload === false`, `autoInstallOnAppQuit === false`, `allowDowngrade === false`, `allowPrerelease === false`.
- [ ] **Step 6: Cài** các module theo test. Ghép vào Main: `registerUpdater({ app, autoUpdater, supervisor, ops, appState, log })`, gọi `runProbation` ngay sau khi supervisor `start()`.
- [ ] **Step 7: Màn hình `update.tsx`.**
  - Hiện bản đang chạy, bản mới (nếu có), trạng thái tiếng Việt (bảng nhãn ở `fork.md` PG-2), bản trước.
  - Nút "Kiểm ngay", "Cài khi rảnh", "Quay về bản trước".
  - Lý do khi updater tắt.
- [ ] **Step 8: Kiểm + docs + commit.** Run: `pnpm --filter @crew/mac-app exec vitest run test/update-*.test.ts && pnpm --filter @crew/mac-app typecheck` → PASS. `mac-app-update.md`: máy trạng thái (`idle → downloading → waiting-idle → installing → probation → idle | rolled-back`), drain, probation 5 phút + watchdog 6 phút, `previous/`, `badVersions`, quay lui tay, sự kiện log.

```bash
git add apps/mac-app docs/flows.yaml docs/flows/mac-app-update.md docs/files.md
git commit -m "feat(mac-app): tự cập nhật có chờ rảnh, thử bản mới và quay lui"
```

---

### Task 3 (UPD-3): Cổng ký thật — chờ owner

**Điều kiện mở:** `security find-identity -v -p codesigning` có đúng một `Developer ID Application: … (<TEAMID>)` và `xcrun notarytool history --keychain-profile crew-notary` thoát 0 (owner đã tạo). Trước đó ticket ở trạng thái **chặn: chờ owner**; Trợ Lý nhắc owner một lần khi UPD-1 xong.

**Files:**
- Modify: `plans/261009-1140-crew-v3-r2-1/{sdd-ledger.md,processes.md}`

- [ ] **Step 1:** `git tag mac-app/v0.1.0` trên `r2-1` (version `0.1.0`), `node apps/mac-app/scripts/release.mjs --no-publish` (một việc nặng). Expected: thoát 0; bảng tự kiểm đạt (cổng 1 trừ dòng Releases).
- [ ] **Step 2: Cài lên Mac mini** khi `active-runs.sh` rỗng:
  - Thoát app ("Thoát ngay").
  - Thay `/Applications/2P Crew.app` bằng bản vừa ký (`ditto`).
  - Mở app.
  - Bản CV-1 là `Apple Development` thì cấp lại Full Disk Access một lần.
  - `crew-mac doctor` 0 `fail`; listener đúng một, cha là app.
- [ ] **Step 3:** Ghi ledger (Team ID, sha256 zip/dmg, kết quả `spctl`). Commit ledger.

```bash
git add plans/261009-1140-crew-v3-r2-1/sdd-ledger.md plans/261009-1140-crew-v3-r2-1/processes.md
git commit -m "docs(v3): ghi bản app ký Developer ID đầu tiên"
```

---

### Task 4 (UPD-4): Repo phát hành và các bản cho nghiệm thu — cần owner nói "làm"

**Điều kiện mở:** owner nói "làm" cho việc tạo repo public và đăng release (ghi nguyên câu và giờ vào ledger). UPD-3 đạt.

- [ ] **Step 1:** `gh repo create nquangphan/crew-mac-releases --public --add-readme --description "Bản phát hành app macOS 2P Crew"`.
- [ ] **Step 2:** Đăng `v0.1.0` từ tag `mac-app/v0.1.0`: `node apps/mac-app/scripts/release.mjs` (đủ bước, có đăng). Kiểm release có zip, dmg, blockmap, `latest-mac.yml`.
- [ ] **Step 3:** Theo nhịp của AC-R2-1 cổng 5:
  - `0.1.1`: bump version, commit `chore(mac-app): phát hành 0.1.1`, tag, chạy script.
  - `0.1.2` từ nhánh bỏ đi `mac-app/break-probation`: một commit làm `supervisor.start()` ném `Error('break-probation')`; tag `mac-app/v0.1.2` trên nhánh đó; chạy script; sau cổng xóa nhánh và tag local.
  - `0.1.3` từ `r2-1`.
- [ ] **Step 4:** Ghi ledger mỗi bản (giờ đăng, sha256, link release). Tag `mac-app/v*` chỉ push khi owner nói "push".
