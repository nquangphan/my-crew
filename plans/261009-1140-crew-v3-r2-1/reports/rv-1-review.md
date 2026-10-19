# RV-1 — Review toàn nhánh R2-1 (09/10/2026, giờ Asia/Ho_Chi_Minh)

Phạm vi: repo Crew `git diff v3..r2-1` (`r2-1` @ `84664d2`, 153 file, 23 commit; kiểm trong worktree
`.worktrees/crew-r21-update` đang ở đúng `84664d2`, cây sạch trước và sau). Fork `crew/r2-1` @ `49de140ec`: chỉ
soát m5–m7 và 3 điểm mở của PL-2. Chỉ đọc và chạy test, không sửa code, không mở app, không đụng sshd 2222 hay
`~/.crew` (chỉ đọc vài trạng thái, ghi ở mục C).

## A. Kết quả lệnh (13:44–13:51)

| Lệnh (worktree `crew-r21-update`) | Kết quả |
|---|---|
| `pnpm install --frozen-lockfile --prefer-offline` | rc 0 |
| `pnpm --filter @crew/docs-kit build` | ok |
| `pnpm -r typecheck` | rc 0 (crew-mac, docs-kit, mac-app) |
| `pnpm -r test` | rc 0. crew-mac 26 file/352 test; docs-kit 3/43; mac-app 36 file/331 test |
| `pnpm lint` (biome) | rc 0, 232 file, không lỗi |
| `node $(git config --get crew-docs.bundle) check --range v3..r2-1` | `ok (17 commits)` (bundle của worktree cho cùng kết quả) |
| `node --test apps/mac-app/scripts/release-lib.test.mjs` (không nằm trong `pnpm -r test`) | 24/24 pass |
| `time log show --last 24h … TCC_PREDICATE` (đo thời gian check TCC của doctor) | 30,3 giây (nice 10) |

Chưa chạy `crew/release/verify.sh` của fork: fork đã qua verify ở DP-1 (12:53–12:56, XANH) và không đổi từ đó.

## B. Kết luận cho CV-1

**CV-1 được làm, có điều kiện.** Không có blocker trong code đường chuyển sshd: supervisor chỉ TERM listener khớp
pidfile và argv `-f <sshd_config của crew-mac>` (đã nhận tiêu đề `sshd: … [listener]` sau MC-5), không bao giờ chọn
`sshd-session`; reaper không coi run dưới `sshd-session` mồ côi là mồ côi; chuyển chủ cần 0 run; wizard tự lui về
LaunchAgent khi listener không lên trong 15 giây; CLI chặn đổi chủ khi chạy qua chính sshd agent. Các điều kiện:

1. 0 run active (`crew/ops/active-runs.sh` rỗng) ngay trước bước `machine` và bước `sshd`.
2. Build bằng `node apps/mac-app/scripts/release.mjs --dev-sign --no-publish` từ `r2-1` @ `84664d2` (script build lại
   `@crew/mac` trước khi đóng gói, lật fuse trước khi ký). KHÔNG dùng lệnh đóng gói trong `AGENTS.md` (minor m1).
   Kiểm bundle: `grep -c "sshd: " "<app>/Contents/Resources/crew-mac/dist/sshd-owner.js"` ≥ 1.
3. Bước `disk-access` phải báo **granted** trước khi bấm bước `sshd` (code cho đi tiếp cả khi `denied`, major M3).
4. Quyết trước việc URL bản tin máy: hiện `~/.crew/status.json` có `url = http://100.105.105.12:3100` (Tailscale).
   Bước `machine` sẽ ghi đè thành origin đăng nhập (`https://crew.2p-solutions.com`), xem M4. Sau bước `machine`, kiểm
   `~/.crew/status-last.json` `ok:true httpStatus 200` rồi mới sang bước `sshd`; hỏng thì dừng, chưa chuyển sshd.
5. Đường lui chỉ hợp lệ sau bước `machine`: CLI đang cài hiện KHÔNG có `--sshd-owner`
   (`grep -c sshd-owner ~/.crew/app/crew-mac/dist/cli.js` = 0 lúc 13:50). Sau bước `machine` số này phải > 0.
   Lui: Terminal trên màn hình Mac (không qua SSH 2222) `~/.crew/bin/crew-mac setup --sshd-owner launchd`. Nếu báo
   "pid … không phải listener của crew-mac" thì chạy lại đúng lệnh đó một lần nữa (manifest đã là `launchd`, lần hai
   sẽ bootstrap; minor m3). Kiểm `launchctl print gui/501/com.2p.crew-mac-sshd` `state = running` và
   `lsof -nP -iTCP:2222 -sTCP:LISTEN` đúng 1 pid.
6. Đi hết wizard tới `done` (login item) và kiểm `sfltool dumpbtm | grep -A3 com.2p-solutions.crew.mac` bật. S1b
   (login item giữ quan hệ responsible) vẫn CHỜ OWNER: tới khi đo, Mac mini khởi động lại mà app không tự mở thì cổng
   2222 trống tới khi có người mở app.
7. Sau khi app giữ cổng: không chạy `crew-mac setup --port …` và không để IP Tailscale đổi mà không mở lại app
   (listener của app không nạp lại cấu hình, M2). Không thoát app kể cả khi 0 run (thoát là đóng cổng, m6).

## C. Trạng thái máy đọc được (chỉ đọc, 13:50)

- `com.2p.crew-mac-sshd` `state = running`, pid 16059; `lsof` cổng 2222: đúng `sshd 16059`.
- `~/.crew/app/crew-mac/dist/cli.js`: chưa có `--sshd-owner` (bản v3).
- `~/.crew/status.json` `url`: `http://100.105.105.12:3100`.
- Keychain chưa có mục "2P Crew Safe Storage" (app v2 không dùng safeStorage, không có xung đột ACL tên chung).
- `~/Library/Application Support/2P Crew/` hiện là dữ liệu Chromium của app v2 (cùng `productName`); app mới sẽ dùng
  chung thư mục này (m11).

## D. Finding

### Blocker

Không có.

### Major

**M1. Updater: quit guard hỏi lại khi "Cài ngay" lúc còn run; chọn "Hủy" để app sống mà không có listener, kẹt
`installing`, rồi watchdog giết app sau 6 phút và đưa bản mới vào `badVersions`.** (gói `updater` + `mac-runtime`)
- `apps/mac-app/src/main/update/updater.ts:175-176` gọi `supervisor.stopForQuit()` rồi `quitAndInstall()`;
  `quit-guard.ts:128-136` chặn `before-quit` và hỏi lại khi còn run; `supervisor.ts:266-272` `stopForQuit` gỡ cả
  việc theo dõi manifest, không ai `start()` lại; `rollback-helper.sh:15-21` watchdog (sinh ở `updater.ts:168`) hết
  6 phút không thấy `.ok`/`.failed` thì `pkill -TERM` app đang chạy và chép `previous/` đè lên `/Applications`.
- Kịch bản: drain quá 30 phút → owner bấm "Cài ngay, run vẫn chạy" → hộp thoại quit guard → owner bấm "Hủy" (hoặc
  "Chờ run xong" rồi đổi ý). App ở lại: cổng 2222 trống vô thời hạn, `updateState = installing` nên `check()` không
  chạy nữa. 6 phút sau watchdog TERM app, ghi `<bản mới>.failed` và `rolled-back`; mở lại thì bản mới (chưa từng chạy)
  vào `badVersions` mãi mãi. Nếu Squirrel đã xếp ShipIt chờ app thoát thì ShipIt và helper cùng ghi
  `/Applications/2P Crew.app` (cần đo, chưa xác minh).
- Đề xuất: quit guard có `allowNextQuit()` (đặt pha `exiting`) mà updater gọi trước `quitAndInstall` (drain đã có
  đồng ý của owner); nếu vẫn muốn hỏi thì "Hủy" phải `resume()` supervisor, đưa `updateState` về `waiting-idle` và
  ghi `<bản>.failed` để watchdog thôi. Thêm test: `before-quit` do updater không hỏi lại.
- Không chặn CV-1 (bản Apple Development tắt updater), chặn cổng 5 (UPD-4/AC).

**M2. Listener của app không nạp lại khi `sshd_config` đổi; CLI lại báo điều ngược lại.** (gói `mac-runtime`,
sửa câu ở `mac-cli`)
- `apps/mac-app/src/main/sshd/supervisor.ts:235-247` chỉ xử lý đổi chủ (`launchd` ↔ `app`);
  `system-deps.ts:140-145` chỉ `watchFile` manifest. `apps/crew-mac/src/cli.ts:212` in "đổi cổng hay IP thì app khởi
  động lại listener".
- Kịch bản: app giữ cổng; IP Tailscale đổi hoặc owner chạy `crew-mac setup --port 2223` → `setup` ghi lại
  `sshd_config`, manifest (cổng/IP mới), không bootout gì (đúng, vì chủ là app) → listener cũ vẫn nghe IP/cổng cũ tới
  khi app mở lại. Paperclip và doctor đi theo giá trị mới → không vào được, máy đỏ. Chế độ launchd thì `setup` tự
  reload sshd, nên hành vi lệch giữa hai chế độ.
- Đề xuất: supervisor nhớ `port`/`listenAddress` (hoặc hash `sshd_config`) lúc sinh; manifest đổi mà khác thì
  `stopListener` rồi `spawnListener` (TERM listener, phiên vẫn sống). Test với manifest đổi cổng. Sửa câu CLI nếu
  không làm.

**M3. Wizard cho chuyển sshd sang app khi chưa có Full Disk Access.** (gói `app-shell`)
- `apps/mac-app/src/main/setup/disk-access.ts:53-56`: không `recheck` thì luôn `ok: true` kể cả `denied`; bước `sshd`
  không kiểm lại.
- Kịch bản CV-1: owner bấm Tiếp ở bước Quyền ổ đĩa khi chưa bật → bước `sshd` chuyển cổng sang app → run Paperclip đầu
  tiên chạm `~/Documents`/ổ ngoài thì tccd hỏi theo bundle app trên màn hình Mac mini; run treo tới khi có người bấm.
- Đề xuất: bước `sshd` từ chối khi `detectFullDiskAccess` ≠ `granted` (owner muốn bỏ qua thì phải tích xác nhận
  riêng). Tới khi sửa: điều kiện CV-1 số 3.

**M4. Bước `machine` ghi đè URL bản tin của máy có sẵn.** (gói `app-shell`)
- `apps/mac-app/src/main/setup/machine-step.ts:73` luôn `configureStatus(paperclipOrigin, companyId)`;
  `apps/mac-app/src/main/paperclip/client.ts:38-51` chỉ nhận `https://…` (hoặc `http://127.0.0.1`), nên không thể giữ
  `http://100.105.105.12:3100` đang dùng.
- Kịch bản CV-1: "Nhận cài đặt có sẵn" đổi `~/.crew/status.json` `url` từ Tailscale sang
  `https://crew.2p-solutions.com`. Bản tin máy (và mọi lần gửi của LaunchAgent `com.2p.crew-mac-status`) đi qua domain
  công khai. `/api/health` trả 200 qua domain (13:50), nhưng chưa ai kiểm webhook `machine-status` qua đường này; nếu
  khác (chặn, chậm) thì thẻ máy offline và probation của updater sau này fail vì "không gửi được bản tin máy".
  Hành vi này ngược với ý "nhận cài đặt có sẵn" (AP-5 có ghi lệch (4), nhưng không nhắc URL).
- Đề xuất: máy `existing` giữ `url` cũ, chỉ đổi `companyId` khi owner chọn company khác (hoặc hỏi rõ trên UI).
  Tới khi sửa: điều kiện CV-1 số 4.

**M5. Watchdog 6 phút đếm từ trước khi thoát, còn probation không giới hạn thời gian doctor.** (gói `updater`)
- `rollback-helper.sh:12` (`WAIT=360`), sinh ở `updater.ts:168` trước `stopForQuit`/Squirrel/khởi động bản mới;
  `probation.ts:40-69`: chờ listener tới 5 phút, rồi `doctor` (`register.ts:23`, `tccWindow: '24h'`, check TCC có
  timeout 240 giây ở `doctor.ts:861-862`, đo thật 30 giây), rồi gửi bản tin thử lại mỗi 30 giây tới hạn 5 phút.
- Kịch bản: Squirrel cài + mở lại mất 60–90 giây, mạng chập chờn làm `sendStatus` chỉ thành công ở lần cuối (~phút
  4,5 của probation) → `.ok` ghi sau mốc 360 giây của watchdog → helper TERM bản mới khỏe, chép bản cũ đè, bản mới vào
  `badVersions`. Tương tự khi `log show` chậm (máy vừa khởi động, cache lạnh).
- Đề xuất: bản mới ghi marker `started` ngay khi mở; watchdog chỉ đếm 6 phút từ marker đó (hoặc chờ `PROBATION_MS` +
  thời lượng doctor tối đa + biên); probation dùng `skipTcc: true` hoặc `tccWindow` ngắn. Chặn cổng 5, không chặn CV-1.

### Minor

- **m1. `AGENTS.md:24-25` hướng dẫn đóng gói không ký** `CSC_IDENTITY_AUTO_DISCOVERY=false … electron-builder --mac dir`:
  từ AP-3 bản này bị kernel giết (rc 137, fuse làm vỡ chữ ký ad-hoc) và không build lại `@crew/mac` (có thể mang
  `dist` cũ, trước MC-5). Sửa câu (cần `Crew-Owner-Approved`, luật R6): dùng `release.mjs --dev-sign --no-publish`
  hoặc `--dry-run`. Gói `app-shell`.
- **m2. `handOffToApp` bỏ qua bootout thất bại** (`apps/crew-mac/src/sshd-owner.ts:82-88`): `bootout` trả false
  khi job vẫn nạp → vẫn xóa plist, ghi manifest `app` → hai chủ (KeepAlive sinh lại, app TERM lúc tiếp quản, cổng bận).
  Wizard tự lui sửa được sau ~30 giây, CLI thì không. Đề xuất: sau bootout kiểm `serviceState(...).loaded === false`,
  còn nạp thì `SetupError` trước khi đụng plist/manifest. Gói `mac-cli`.
- **m3. Lui về launchd khi pidfile trỏ process lạ** (`sshd-owner.ts:106-112`, `setup.ts:244-245`, điểm MC-2 trong
  ledger): manifest đã ghi `launchd` rồi mới ném `SetupError` → app dừng listener, plist chưa nạp → cổng trống tới
  khi owner chạy lại lệnh (lần hai thì bootstrap, vì không còn "đổi chủ"). Không bao giờ có hai chủ, không kill nhầm.
  Đề xuất: pid lạ thì không phải listener của mình → kiểm cổng bằng `lsof`; cổng trống thì đi tiếp bootstrap, cổng bận
  bởi process lạ mới ném; message nói rõ "cổng đang trống, chạy lại lệnh". Gói `mac-cli`.
- **m4. Tự lui của wizard không dừng supervisor trước** (`apps/mac-app/src/main/setup/sshd-handoff.ts:90-91`): supervisor
  đang `backoff` có thể sinh listener trong ≤2 giây trước khi thấy manifest `launchd`, giành cổng với job vừa
  bootstrap; tự hết sau một vòng KeepAlive (~10 giây). Đề xuất: `supervisor.pause()` (hoặc `stopListener('disabled')`)
  trước `setup({ sshdOwner: 'launchd' })`. Gói `app-shell`/`mac-runtime`.
- **m5. Thoát/chết utilityProcess giữa `setup({ sshdOwner: 'app' })`** (`sshd-owner.ts:85-86` xóa plist trước khi
  `setup.ts:240` ghi manifest): app thoát lúc 0 run thì quit guard không hỏi, `will-quit` → `ops.dispose()` giết
  utility. Kẽ hở vài trăm ms: plist đã xóa, manifest vẫn `launchd`, không ai nghe cổng; mở lại app thì supervisor
  `disabled`. Đề xuất: ghi manifest `app` TRƯỚC bootout (hỏng giữa chừng thì còn listener launchd, doctor báo hai chủ),
  và quit guard chờ thao tác sshd của wizard xong. Gói `mac-cli` + `mac-runtime`.
- **m6. Thoát app khi 0 run là đóng cổng 2222 mà không cảnh báo** (`quit-guard.ts:26`, `decideQuit` 0 run → thoát
  ngay; `stopForQuit` TERM listener). Đúng I4, nhưng trên máy prod một cú Cmd+Q là Mac ngừng nhận run. Ngoài ra quit
  guard đếm cả run của LaunchAgent khi chủ là `launchd` (`sshd/register.ts:49`), hỏi thừa. Đề xuất: chủ là `app` thì
  luôn xác nhận "Mac sẽ ngừng nhận run mới"; chủ `launchd` thì không hỏi. Gói `mac-runtime`.
- **m7. Fuse không chặn switch Chromium** (`--remote-debugging-port`/`--remote-debugging-pipe`): agent cùng user mở app
  (khi app không chạy) với cổng DevTools rồi gọi `window.crew.invoke(...)` trong renderer: thêm/gỡ project, hủy run
  bằng quyền board. Không lấy được board key (không kênh nào trả key). Đề xuất: bản đóng gói thấy hai switch đó thì
  `app.exit(1)` ngay đầu `index.ts`; đo ở AC. Gói `app-shell`.
- **m8. Secret webhook nằm trên argv của `security`** (`apps/crew-mac/src/commands/status.ts:192-195`, có từ v3): chỉ
  ở đường cài máy mới (`machine-step.ts:67`); process cùng user thấy được trong `ps` vài mili giây. CV-1 đi đường máy
  có sẵn nên không gặp. Đề xuất: `security add-generic-password … -w` đọc từ stdin (bỏ giá trị sau `-w`, dùng
  `-X`/stdin) hoặc ghi qua `SecItemAdd` trong app. Gói `mac-cli`.
- **m9. Mã ticket trong code** (luật "không ghi mã ticket"): `apps/mac-app/src/main/index.ts:113`,
  `src/renderer/app.tsx:18`, `src/shared/ipc-contract.ts:7,12`. Thêm `void ctx;` thừa ở `index.ts:115`. Gói `app-shell`.
- **m10. `release-lib.test.mjs` không chạy trong `pnpm -r test`** (`apps/mac-app/vitest.config.ts` chỉ `test/**`):
  24 test của script phát hành chỉ chạy tay. Đề xuất: thêm `node --test scripts/*.test.mjs` vào script `test` của
  mac-app. Gói `updater`.
- **m11. App mới dùng chung `~/Library/Application Support/2P Crew/` với dữ liệu Chromium của app v2** (cùng
  `productName`; `index.ts:35` đặt `userData` vào đó): Chromium của app mới đọc/ghi `Local State`, `Preferences`,
  Local Storage `file://` của v2. Không thuộc `~/.crew` nên không trái Q5, nhưng là sửa file v2. Đề xuất: ghi rõ trong
  `mac-app.md`, hoặc đặt `userData` Chromium sang thư mục con (`…/2P Crew/chromium`) và giữ `app.json`/`app.log` ở
  chỗ cũ. Gói `app-shell`.
- **m12. `installCrewMacFrom` không atomic tuyệt đối** (`apps/crew-mac/src/install-cli.ts:101-102`): giữa hai
  `rename` có kẽ `~/.crew/app/crew-mac` vắng; reaper/status chạy đúng lúc đó lỗi một nhịp (đã từ chối khi có run nên
  không ảnh hưởng run). Lui khi lỗi đúng. Chấp nhận được; ghi chú vào `mac-setup.md`.
- **m13. Lệch Global Constraint "không dùng safeStorage"** vẫn ghi trong `plan.md:47`; quyết định nằm ở
  `can-dai-ca-chot.md` (Trợ Lý tự quyết 15:05). Code và `mac-app-paperclip.md` khớp với quyết định. Cần owner biết
  (owner có quyền phủ quyết), và sửa câu ở plan.

### Fork (`crew/r2-1` @ `49de140ec`, đã deploy)

- **m5 (review PG-1/PL-1) — vẫn mở.** `packages/crew-plugin/src/roles/api.ts` set/delete không ghi activity hay log
  có giá trị cũ/mới. Đổi reviewer/integrator là đổi cấu hình gate; tới khi có audit, chỉ `updated_by_user_id` của lần
  ghi cuối. Minor, gói `plugin`.
- **m6 — vẫn mở.** `server/src/__tests__/crew-project-roles.db.test.ts:304` vẫn mang tên cũ; ca vẫn pass khi bỏ đọc
  theo project ở H2. Minor (tên/chú thích test).
- **m7 — vẫn mở.** `handleRolesApi` (`api.ts:58`) không bọc try/catch; lỗi SQL tới board qua 502 của host. Chỉ board
  thấy. Minor.
- **PL-2 mở 1 — luật vai trò chéo không biết vai trò file.** Ghi được executor P2 trùng reviewer/integrator file
  (`CREW_POLICY_CONFIG`). Hậu quả fail-closed: Trợ Lý P2 không giao việc được cho executor đó (`422
  crew_role_assignee`), không có `done` sai. PJ-1 luôn tạo agent mới nên app không rơi vào. Minor.
- **PL-2 mở 2 — issue không project khi đọc bảng lỗi** chỉ so tập vai trò file: trong lúc DB lỗi, agent có thể giao
  việc cho reviewer/integrator của project khác trên issue không project. Cửa sổ nhỏ, không mở đường `done`. Minor.
- **PL-2 mở 3 — cha tạo cùng transaction chưa commit**: H4 đọc bằng `db` nên không thấy cha, con nhận vai trò file
  (reviewer có thể không có checkout repo) → issue kẹt, không `done` sai. Sửa cần đổi chữ ký hook lõi (vượt ngân sách
  5/5) → ghi nhận, không sửa ở R2.

## E. Đã kiểm và ổn (để hiệu chỉnh rủi ro)

- **Không bao giờ kill `sshd-session`/run:** `isCrewListener` loại `sshd-session`, đòi `/usr/sbin/sshd` + `-f <cfg>`
  đúng; supervisor chỉ TERM con của mình hoặc pid pidfile khớp argv (kiểm lại trước SIGKILL); drain/quit chỉ
  pause/stop listener; reaper coi chuỗi có `sshd-session` là còn chủ; `pkill` của helper khớp
  `/Applications/2P Crew.app/Contents/MacOS/2P Crew` (không khớp Helper, sshd, claude).
- **Hai chiều `--sshd-owner`:** đổi chủ cần 0 run (`assertNoLiveRuns` gồm `sshd-session` dưới listener của app);
  không cờ thì giữ chủ manifest; CLI chặn khi `SSH_CONNECTION` tới cổng agent; về launchd chờ 15 giây rồi mới TERM
  listener mồ côi khớp argv. `uninstall` chế độ app không bootout/không đụng listener.
- **Wizard `sshd`:** từ chối khi còn run; chỉ coi là xong khi supervisor `running` VÀ `lsof` cổng ra đúng một pid
  bằng pid của supervisor; quá 15 giây tự lui `force` về launchd.
- **IPC:** preload chỉ cho kênh trong `IPC_CHANNELS`; Main kiểm `senderFrame.url` cùng thư mục renderer; không kênh
  nào nhận lệnh shell/đường dẫn tùy ý (`logs:*` theo enum, `health:action` theo enum, git chạy `execFile` không shell,
  origin không bắt đầu `-`, `clone --`). Cửa sổ sandbox, `contextIsolation`, chặn mở cửa sổ/điều hướng, từ chối mọi
  permission request.
- **Board key:** đọc lại từ Keychain mỗi request, không log, header không đi vào log (`logPath` bỏ query); key gốc
  không lên argv (chỉ bản mã); fuse `runAsNode`/`NODE_OPTIONS`/`--inspect` tắt, asar integrity + `onlyLoadAppFromAsar`
  bật (AP-3 đo). `createAgent` chỉ nhận wrapper `<home>/.crew/bin/crew-claude-run`, tự đặt heartbeat tắt +
  `maxConcurrentRuns: 1`. Client không có hàm DELETE environment (chỉ archive); gỡ project chỉ pause/archive phần app
  tạo, không xóa checkout (trả lệnh `rm -rf` cho owner).
- **AP-6:** module không nhận HOME, không đụng `~/.crew`; chỉ Thùng rác bundle có `CFBundleIdentifier =
  com.2p-solutions.crew`, `tccutil reset All com.2p-solutions.crew`, login item kiểu cũ; dừng khi app v2 đang chạy.
- **Updater:** chỉ `x.y.z` lớn hơn, không prerelease/downgrade, `badVersions` chặn tải lại, cần zip arm64; drain chỉ
  pause listener; tắt khi không phải Developer ID hoặc không chạy từ `/Applications`.
- **Docs:** `crew-docs check --range v3..r2-1` ok; `mac-app-sshd.md`, `mac-app-update.md` (kể cả ghi chú hỏi lại ở
  quit guard), `mac-app-paperclip.md` (safeStorage) khớp code ở các điểm đã soát. Sai: câu CLI ở M2, lệnh ở m1.

## F. Đề xuất ticket

| Ưu tiên | Việc | Gói | Trước |
|---|---|---|---|
| 1 | M3 + M4 (+ m4, m9, m11) | `app-shell` (sonnet) | nên trước CV-1; nếu không thì CV-1 theo điều kiện 3–4 |
| 2 | M2 + m6 (+ m5 phần quit guard) | `mac-runtime` (opus) | trước AC cổng 4/7 |
| 3 | m2, m3, m5 (thứ tự ghi manifest), m8, câu CLI ở M2 | `mac-cli` (opus vì vòng đời sshd) | trước AC cổng 7 |
| 4 | M1 + M5 + m10 | `updater` (opus) | trước UPD-4/cổng 5 |
| 5 | m1 (`AGENTS.md`, cần `Crew-Owner-Approved`), m13 (plan) | Trợ Lý | khi owner cho |
| 6 | Fork m5, m7 | `plugin` | R2-2 hoặc khi tiện |

## G. Câu hỏi chưa giải

1. Webhook `machine-status` qua `https://crew.2p-solutions.com` có được phép/đi được không, hay bản tin cố ý đi qua
   Tailscale (`http://100.105.105.12:3100`)? Quyết định này chọn cách sửa M4.
2. Owner có chấp nhận "thoát app = Mac ngừng nhận run" (I4) hay muốn để listener mồ côi sống khi thoát (TCC vẫn gắn
   bundle app theo S4b)?
3. Squirrel.Mac có xếp ShipIt chờ app thoát khi `before-quit` bị chặn sau `quitAndInstall` không (ảnh hưởng mức nặng
   của M1)? Cần đo ở UPD-3.

Status: DONE_WITH_CONCERNS
Summary: Full suite xanh (typecheck, 726 test, lint, crew-docs range ok); không blocker, 5 major (2 ảnh hưởng CV-1:
FDA không bắt buộc trước khi chuyển sshd, URL bản tin bị ghi đè), CV-1 được làm có điều kiện ở mục B.
Concerns/Blockers: M1/M5 chặn cổng 5 updater; M2 làm listener của app không theo cổng/IP mới; S1b login item chưa đo.
