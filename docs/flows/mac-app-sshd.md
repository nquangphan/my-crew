# App 2P Crew giữ sshd agent và thoát an toàn

> Flow `mac-app-sshd`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-app-sshd` in ra đúng danh sách đó.

## Mục đích

Khi manifest crew-mac ghi `sshdOwner: 'app'`, app 2P Crew (flow `mac-app`) tự sinh sshd agent
(`/usr/sbin/sshd -D -f ~/.crew-mac/sshd/sshd_config -E ~/.crew-mac/sshd/sshd.log`) làm process con. macOS coi app là
responsible process của listener, `sshd-session`, shell và `claude` của run, nên chỉ hỏi quyền cho app một lần.
Listener ở process group riêng (`detached`), nên đóng cửa sổ, thoát, crash hay cập nhật app không giết run đang chạy.
Quit guard hỏi owner khi còn run.

## Điểm vào

- `apps/mac-app/src/main/index.ts` → `registerSshd(ctx)` (`src/main/sshd/register.ts`): dựng bộ giám sát với deps
  thật, cài quit guard, gọi `start()`. Trả `SshdSupervisor` cho `registerHealth` (màn hình Run/Sức khỏe và tray, flow `mac-app`), wizard (AP-5) và
  updater (UPD-1).
- Menu tray "Thoát", `Cmd+Q`, hay `app.quit()` của updater đều đi qua `before-quit` của quit guard.
- Manifest `~/.crew-mac/manifest.json` đổi (`crew-mac setup --sshd-owner app|launchd`, wizard bước sshd): bộ giám sát
  thấy qua `watchFile` (2 giây một lần) và tự bật/tắt.

## Các bước

1. `src/main/sshd/supervisor.ts` → `createSshdSupervisor(deps).start()`: đọc chủ sshd từ manifest. Không phải `app`
   (hay manifest hỏng) thì trạng thái `disabled`, không sinh gì (chế độ CLI, LaunchAgent giữ cổng).
2. Tiếp quản (`src/main/sshd/takeover.ts` → `planListenerTakeover`): đọc pid trong `~/.crew-mac/sshd/sshd.pid` và
   `ps` của pid đó. Chỉ khi process đó đúng là listener của crew-mac (`isCrewListener` của `@crew/mac`, một hàm dùng chung với CLI: binary `/usr/sbin/sshd`, kể cả tiêu đề `sshd: …`,
   argv có `-f <sshd_config của crew-mac>` khớp nguyên token, không phải `sshd-session`) mới `replace`: TERM, chờ tối
   đa 5 giây, còn đúng listener đó thì SIGKILL. Mọi trường hợp khác (không pidfile, pid chết, pid bị dùng lại) chỉ
   `spawn`, không gửi tín hiệu.
3. Sinh listener (`src/main/sshd/system-deps.ts` → `spawnSshd`): `spawn(..., { detached: true, stdio: 'ignore' })`
   rồi `unref()`, cùng cổng trong `sshd_config` (không bao giờ đổi cổng). Ghi `sshdPid`, `sshdOwner` vào `app.json`
   (`AppStateStore.update`), phát `onChange`.
4. Listener thoát bất thường: `backoff.ts` → `nextDelayMs` (1s, 2s, 4s … tối đa 60s), `restarts` tăng; chạy liền 5
   phút (`STABLE_RESET_MS`) thì về 0. `lastError` lấy từ phần log sshd ghi sau lần sinh (`describeExit`): log có
   `Address already in use` thì "Cổng <port> đang bị chiếm: <lsof>", có dòng lỗi khác thì dòng đó, không thì mã thoát
   hoặc tín hiệu.
5. `pause()` (drain của updater, "Chờ run xong"): TERM listener của mình, không sinh lại; `resume()` tiếp quản và sinh
   lại. `stopForQuit()`: như `pause` và thôi theo dõi manifest.
6. Manifest về `launchd` (`crew-mac setup --sshd-owner launchd` ghi manifest trước rồi chờ pidfile trống tối đa 15
   giây): bộ giám sát TERM listener của mình, `disabled`. Manifest về `app` khi đang `disabled` thì làm lại bước 2–3.
7. `activeRuns()` (`active-runs.ts`): `listProcesses()` lọc `isClaudePrint` (có `PAPERCLIP_RUN_ID` trong env),
   `worktree` từ `readCwds`, `children` là số con trực tiếp. Không hỏi listener, nên vẫn đúng khi listener đã chết.
8. Quit guard (`src/main/quit-guard.ts` → `installQuitGuard`): `before-quit` luôn `preventDefault` trước, đếm run.
   0 run thì `stopForQuit()` rồi `app.quit()` (lần `before-quit` sau được cho qua). Còn run thì hộp thoại
   (`QUIT_BUTTONS`, mặc định "Thoát ngay, run vẫn chạy"):
   - "Chờ run xong rồi thoát": `pause()`, tray `update({ runs, waiting: true })` (chấm vàng, nhãn "Đang chờ N run"),
     kiểm lại mỗi 10 giây, về 0 thì thoát. Bấm Thoát lần nữa khi đang chờ thì hỏi lại; "Hủy" thì bỏ chờ, `resume()` và
     `hideWaiting()` (tray bỏ nhãn chờ).
   - "Thoát ngay, run vẫn chạy": `stopForQuit()` rồi thoát; run mới chờ tới khi mở lại app.
   - "Hủy": ở lại.
   Không đọc được bảng process thì vẫn hỏi ("Không đọc được danh sách run trên máy này."), không thoát im lặng.

## Vòng đời

| Sự kiện | Listener | Phiên của run (`sshd-session`, `claude`) | Lần mở app sau |
|---|---|---|---|
| Đóng cửa sổ | giữ nguyên | sống | — |
| Thoát (0 run, hoặc "Thoát ngay") | TERM | sống tới xong (launchd nhận nuôi) | sinh listener mới |
| "Chờ run xong rồi thoát" | TERM ngay (không nhận run mới) | sống tới xong, rồi app thoát | sinh listener mới |
| App crash / `kill -9` | mồ côi, vẫn giữ cổng (`ppid 1`) | sống | TERM listener mồ côi (khớp argv) rồi sinh mới |
| Listener chết | sinh lại theo backoff | sống | — |
| Manifest về `launchd` | TERM, `disabled` | sống | `disabled` |

Luật cứng: không bao giờ gửi tín hiệu cho `sshd-session` hay process không khớp argv `-f <sshd_config của crew-mac>`.
Tín hiệu chỉ tới (a) listener do chính app sinh (con trực tiếp, pid không bị dùng lại khi chưa reap) và (b) listener
cũ ở pidfile đã kiểm argv, kiểm lại trước khi SIGKILL.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/mac-app/src/main/sshd/register.ts` | Nối bộ giám sát và quit guard vào Electron (`app`, `dialog`, tray) | `registerSshd` |
| `apps/mac-app/src/main/sshd/supervisor.ts` | Máy trạng thái của listener (I4) | `createSshdSupervisor`, `SshdSupervisor`, `SupervisorDeps`, `SupervisorState` |
| `apps/mac-app/src/main/sshd/system-deps.ts` | Deps thật: spawn, `ps`, `lsof`, pidfile, manifest, log sshd | `createSystemDeps`, `exitReasonFromLog`, `readLogSince`, `summarizeLsof` |
| `apps/mac-app/src/main/sshd/takeover.ts` | Quyết định tiếp quản listener cũ | `planListenerTakeover` |
| `apps/mac-app/src/main/sshd/backoff.ts` | Khoảng chờ sinh lại | `nextDelayMs`, `STABLE_RESET_MS` |
| `apps/mac-app/src/main/sshd/active-runs.ts` | Run đang chạy từ bảng process | `activeRuns` |
| `apps/mac-app/src/main/quit-guard.ts` | Hỏi khi thoát lúc còn run | `decideQuit`, `installQuitGuard`, `QUIT_BUTTONS`, `QUIT_DEFAULT_ID`, `quitMessage` |

## Dữ liệu

- Đọc: `~/.crew-mac/manifest.json` (`sshdOwner`, `port`), `~/.crew-mac/sshd/sshd.pid` (sshd tự ghi qua `PidFile`),
  phần cuối `~/.crew-mac/sshd/sshd.log` (tối đa 8 KB, chỉ phần ghi sau lần sinh).
- Ghi: `app.json` trường `sshdPid` (null khi không có listener của app) và `sshdOwner`. App không ghi manifest,
  `sshd_config` hay host key; các file đó do `crew-mac setup` (flow `mac-setup`) quản.
- Nhật ký `app.log`: `sshd-state` (mỗi lần đổi trạng thái/pid), `sshd-spawned`, `sshd-exited`, `sshd-takeover`,
  `sshd-owner-launchd`, `app-quit`.

## Lưu ý quyền macOS

- Responsible process kế thừa qua fork/exec: listener, `sshd-session`, shell, `claude` đều nhận app (đo ngày
  09/10/2026 bằng `responsibility_get_pid_responsible_for_pid`). Hộp thoại quyền mang tên app, không theo đường dẫn
  bản `claude`.
- Listener mồ côi sau khi app chết: hàm hệ thống trả chính pid listener, nhưng tccd vẫn gán quyền theo bundle app đã
  lưu. Vì thế mặc định quit guard là "Thoát ngay, run vẫn chạy". Nếu đo lại cho thấy hộp thoại dưới listener mồ côi
  không mang tên app thì đổi `QUIT_DEFAULT_ID` về 0 ("Chờ run xong").
- Listener OpenSSH đổi tiêu đề process thành `sshd: /usr/sbin/sshd -D -f … [listener] 0 of 10-100 startups`; cả
  `ps -o comm=` và `ps -o command=` đều trả chuỗi này, nên `isCrewListener` bỏ tiền tố `sshd: ` trước khi so argv.

## Flow liên quan

- `mac-app`: khung app, `AppContext`, `AppStateStore`, tray.
- `mac-setup`: `crew-mac setup --sshd-owner app|launchd` ghi manifest và chuyển chủ cổng; `doctor` kiểm listener của
  app; thư viện `@crew/mac` (`macPaths`, `readManifest`, `readSshdPid`, `listProcesses`, `readCwds`, `isClaudePrint`,
  `createRunner`).
- `mac-orphan-reaper`: dọn `claude` mồ côi khi phiên SSH mất.

## Tests

- `apps/mac-app/test/sshd-takeover.test.ts`: sinh mới khi không pidfile/pid chết/pid lạ/`sshd-session`/sshd hệ thống/
  cấu hình trùng tiền tố; thay khi argv khớp, cả dạng tiêu đề `sshd: … [listener]`.
- `apps/mac-app/test/sshd-backoff.test.ts`: 1s → 60s.
- `apps/mac-app/test/sshd-supervisor.test.ts`: `disabled` theo manifest; tiếp quản đúng một TERM rồi sinh; SIGKILL
  sau 5 giây chỉ pid đó; pid lạ không tín hiệu; backoff 1s/2s/4s và về 0 sau 5 phút; `describeExit`; pause/resume;
  pause khi đang backoff; `stopForQuit` chỉ tín hiệu tới listener; manifest launchd ↔ app; manifest hỏng;
  `activeRuns`.
- `apps/mac-app/test/sshd-system-deps.test.ts`: lý do thoát từ log, `lsof`, đọc phần log mới, `procInfo` với tiêu
  đề thật, manifest/pidfile dưới HOME tạm.
- `apps/mac-app/test/quit-guard.test.ts`: `decideQuit`, nút và câu chữ, luồng `before-quit` (0 run, thoát ngay, hủy,
  chờ, bấm hai lần, hỏi lại khi đang chờ, lỗi đọc run).
