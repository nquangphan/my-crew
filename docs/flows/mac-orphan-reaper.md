# Dọn process claude mồ côi trên Mac (crew-mac reap)

> Flow `mac-orphan-reaper`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-orphan-reaper` in ra đúng danh sách đó.

## Mục đích

Khi mạng giữa VPS và Mac rớt, server Paperclip không vào được Mac để dừng run. Phiên SSH chết nhưng `claude --print`
vẫn sống và tiếp tục ghi vào worktree. LaunchAgent `com.2p.crew-mac-reaper` chạy `crew-mac reap` mỗi 60 giây, tìm
các process này và dừng chúng. Đây là lớp phòng thủ phía Mac, bổ sung cho hook H3 (RT-1) phía server.

## Điểm vào

- LaunchAgent `com.2p.crew-mac-reaper` (do `crew-mac setup` cài, flow `mac-setup`), `StartInterval` 60 giây.
- Chạy tay: `crew-mac reap [--grace-seconds 60] [--dry-run]`.

## Các bước

1. `apps/crew-mac/src/reaper/process-table.ts` → `listProcesses`: `ps -axww -o pid=,ppid=,pgid=,comm=` cho cây
   process, `ps -E -axww -o pid=,command=` cho env lúc exec; `extractRunId` lấy `PAPERCLIP_RUN_ID`.
2. `apps/crew-mac/src/reaper/select.ts` → `selectTargets`: chỉ xét `claude` chạy `--print`/`-p` có
   `PAPERCLIP_RUN_ID` (`isClaudePrint`); mồ côi khi chuỗi tổ tiên không còn `sshd`/`sshd-session` (`isOrphaned`);
   ghi thời điểm thấy mồ côi lần đầu vào state; quá thời hạn (mặc định 60 giây) thì chọn claude, mọi process con và
   process cùng group có cùng run id.
3. `apps/crew-mac/src/reaper/reap.ts` → `reapOnce`: gửi `SIGTERM` cho cả process group khi group chỉ gồm process
   của run đó (`killGroup`, xét trong `selectTargets`), nếu không thì cho từng pid của run; process con đã sang group
   khác (`strays`) nhận signal riêng. Chờ 10 giây rồi gửi `SIGKILL` cho phần còn sống trong đúng group. Ghi
   `~/.crew-mac/reaper/reaper.log` (giờ Asia/Ho_Chi_Minh) và `state.json`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/crew-mac/src/reaper/reap.ts` | Một vòng dọn | `reapOnce`, `readReaperState`, `vnTime` |
| `apps/crew-mac/src/reaper/process-table.ts` | Đọc bảng process và env | `listProcesses`, `parsePsTree`, `parsePsEnv`, `extractRunId` |
| `apps/crew-mac/src/reaper/select.ts` | Chọn process mồ côi | `selectTargets`, `isClaudePrint`, `isOrphaned` |

## Dữ liệu

- File: `~/.crew-mac/reaper/state.json` (`orphanSince` theo `pid:runId`), `~/.crew-mac/reaper/reaper.log`.
- Hợp đồng với RT-1: mỗi run SSH chạy `claude` với biến môi trường `PAPERCLIP_RUN_ID`. Mỗi lệnh SSH không tương
  tác trên macOS đã có process group riêng (shell của phiên là leader).

## Giới hạn

- `ps -E` chỉ cho thấy env lúc exec, và chỉ với binary không phải của Apple. `claude` và `node` đọc được;
  `zsh`, `git`, `sleep` thì không. Vì vậy process con được tìm theo cây PPID.
- Không bao giờ dừng process không có `PAPERCLIP_RUN_ID` hoặc không chạy `--print`, nên phiên `claude` tương tác
  của owner an toàn.
- Mất mạng: `sshd` (`ClientAliveInterval 15`, `ClientAliveCountMax 2`) cắt phiên sau khoảng 30 giây, rồi reaper
  dừng run sau 60 giây mồ côi, chậm nhất thêm một chu kỳ 60 giây của LaunchAgent và 10 giây chờ TERM: tổng cộng
  khoảng 2 phút 40 giây kể từ lúc mất mạng. Run đó coi như hỏng; Paperclip chạy lại theo luồng của nó.

## Flow liên quan

- `mac-setup`: cài và gỡ LaunchAgent reaper; `doctor` có check `reaper`.

## Tests

- `apps/crew-mac/test/reaper-select.test.ts`: đọc `ps`, nhận diện mồ côi kể cả khi cha trực tiếp còn sống, thời hạn, không đụng phiên owner hay chính reaper.
- `apps/crew-mac/test/reaper-reap.test.ts`: TERM rồi KILL, dry-run, state hỏng, giờ Việt Nam.
