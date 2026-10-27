# Dừng process của run và dọn process mồ côi trên Mac (crew-mac stop-run, reap)

> Flow `mac-orphan-reaper`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-orphan-reaper` in ra đúng danh sách đó.

## Mục đích

> Nhận diện run: `isAgentPrint` (`run-members.ts`) khớp binary theo basename (argv[0] giữ đường symlink) và subcommand là
> phần tử đầu tiên không bắt đầu bằng `-` sau binary (adapter codex đặt `--search` trước `exec`): `codex exec|e`,
> `opencode|.opencode run`, hoặc claude `--print`/`-p`; bắt buộc có `PAPERCLIP_RUN_ID` trong env (`ps -E -axww`), nên
> codex/opencode/claude tương tác của owner không bị chọn. Giả định chưa đo: dạng `ps` của `opencode run` (A5).

Một run của agent trên Mac gồm `claude --print` và mọi tool nó sinh ra. Bash tool của Claude Code chạy `zsh` trong
process group và session riêng, còn `ps -E` không đọc được env của binary Apple (`zsh`, `sleep`, `git`, `make`).
Vì vậy dừng theo pgid hay theo token env sẽ sót tool con. Flow này có một cách chọn process của run dùng chung cho
hai đường:

- `crew-mac stop-run`: phía server (hook H3) gọi qua SSH khi hủy run, restart hoặc mất lease.
- `crew-mac reap`: LaunchAgent `com.2p.crew-mac-reaper` chạy mỗi 60 giây, dọn run có phiên SSH đã mất (mạng rớt nên
  server không vào được Mac).

## Điểm vào

- `crew-mac stop-run --run-id <uuid> --root <worktree tuyệt đối> [--term-wait-seconds 5]`, qua launcher ổn định
  `~/.crew/bin/crew-mac` (flow `mac-setup`). In đúng một dòng `crew-stop matched=<n> killed=<n> remaining=<n>`,
  thoát 0. Thoát 2 khi đầu vào sai: `--run-id` không phải UUID, `--term-wait-seconds` ngoài 0–20, chưa chạy
  `crew-mac setup`, hoặc `--root` không tuyệt đối, là `/`, là HOME hay thư mục cha của HOME, hay không nằm hẳn dưới
  thư mục worktree đã cài (`manifest.worktreeRoot`; so sau khi resolve symlink, không phân biệt hoa thường). Thoát 1
  khi không đọc được bảng process.
- LaunchAgent `com.2p.crew-mac-reaper` (do `crew-mac setup` cài), `StartInterval` 60 giây; chạy tay:
  `crew-mac reap [--grace-seconds 60] [--dry-run]`.

## Hợp đồng với wrapper `crew-claude-run`

Với `PAPERCLIP_RUN_ID` hợp lệ, wrapper ghi vào `<worktree>/.paperclip-runtime/runs/<runId>/`:

- `pgid`: process group của chính nó.
- `started`: thời điểm SINH của chính process wrapper (epoch giây, tính từ `etime` của `$$`). Đây không phải lúc
  wrapper chạy tới dòng ghi file: phiên SSH source profile của owner trước khi exec wrapper, profile chậm sẽ làm
  lệch.

## Các bước

1. `apps/crew-mac/src/reaper/process-table.ts` → `listProcesses`: `ps -axww -o pid=,ppid=,pgid=,tty=,etime=,comm=`
   cho cây process, tty và thời điểm sinh (`startedAt` = lúc quét − `etime`); `ps -axww -o pid=,command=` cho argv;
   `ps -E …` cho argv kèm env lúc exec. `extractRunId` chỉ tìm `PAPERCLIP_RUN_ID` trong phần env nối sau argv;
   `isEnvReadable` cho biết `ps -E` có nối được phần env đó không (binary Apple/SIP thường không).
   `readCwds` hỏi cwd bằng `lsof -a -d cwd -Fpn -p <pid,…>` cho đúng các pid cần, mỗi lô 500 pid.
2. `apps/crew-mac/src/reaper/run-members.ts`:
   - `readRunStarts` đọc `started` của mọi run trong worktree.
   - `runWindow` cho cửa sổ thời gian của run: từ `started` của nó tới `started` của run bắt đầu ngay sau trong
     cùng worktree.
   - `readRunPgid` đọc `pgid`.
   - `orphanCandidates` lọc ứng viên trước khi hỏi cwd.
   - `selectRunMembers` chọn process của run:
     - (a) process chính của run (`isAgentPrint`: claude `--print`/`-p`, `codex exec`, `opencode run`) mang đúng run id trong env và mọi con cháu theo cây PPID, bất kể group hay session;
     - (b') process mồ côi: cwd dưới worktree (đã resolve symlink, không phân biệt hoa thường), không tty
       (`??`), sinh trong cửa sổ của run, và chuỗi cha đi lên chỉ gặp launchd hoặc process cũng thỏa (b'). Gặp
       Terminal, editor hay app nào khác thì loại;
     - (c) process trong group wrapper đã ghi, không tty, sinh trong cửa sổ của run. Chỉ áp dụng khi group đó vẫn là
       của run: leader (pid = `pgid`) còn sống và sinh trong ±1 giây quanh `started`, hoặc group có con cháu của
       claude thuộc (a). Không thì pgid có thể đã được cấp cho group khác của owner.

     Máy khởi động lại sau `started` (`kern.boottime` > `started`) thì bỏ cả (b') lẫn (c), chỉ còn (a). Thời điểm sinh
     không đọc được (`etime` lạ) thì coi như nằm ngoài cửa sổ.

     Không bao giờ chọn launchd, `sshd`/`sshd-session` hay chính process đang chạy. So thời điểm sinh có sai số 1
     giây vì `etime` làm tròn. Callback bridge Paperclip (`bridgeRoot` nhận ra) không bao giờ được chọn theo (b') hay
     (c), vì nó sinh trước wrapper và cửa sổ thời gian không nhận diện được nó. Bước 7 xử lý bridge.
   - `collectRunMembers` ghép các bước trên cho một run.
3. `apps/crew-mac/src/reaper/stop.ts` → `stopMembers`:
   - Gửi `SIGTERM` theo group cho group chỉ gồm process đã chọn (và không phải group của chính mình), còn lại theo
     từng pid.
   - Chờ, quét lại, gửi `SIGKILL` cho đúng process đã chọn còn sống (so pid và thời điểm sinh để tránh pid bị cấp
     lại; không so pgid vì process có thể đổi group sau TERM). KILL theo group chỉ với group đã nhận TERM theo group
     và vẫn chỉ gồm process đã chọn.
   - Chờ 200 ms rồi đếm phần còn lại. Process trùng pid mà thời điểm sinh không đọc được không bị KILL nhưng vẫn tính
     vào `remaining`, kể cả khi nó còn ngay sau TERM.
4. `apps/crew-mac/src/commands/stop-run.ts` → `stopRun`: kiểm `runId`, kiểm `root` bằng `rootGuardReason`
   (`apps/crew-mac/src/paths.ts`), resolve `root`, đọc `kern.boottime`, chọn, dừng. Không còn process nào thì xóa
   `<root>/.paperclip-runtime/runs/<runId>`, trừ khi `.paperclip-runtime` hoặc `runs` là symlink. `formatStopLine`
   in dòng kết quả.
5. `apps/crew-mac/src/reaper/select.ts` → `selectTargets`: process chính của run (`isAgentPrint`) có run id mà chuỗi cha không còn
   `sshd`/`sshd-session` (`isOrphaned`). Ghi thời điểm thấy mồ côi lần đầu vào state; quá thời hạn (mặc định 60 giây,
   tối thiểu 60) thì chọn.
6. `apps/crew-mac/src/reaper/reap.ts` → `reapOnce`: lấy worktree = cwd của claude mồ côi. Worktree không qua
   `rootGuardReason` (hoặc chưa có manifest) thì chỉ dọn con cháu của claude. Không thì chọn process của run bằng
   `collectRunMembers`, rồi dừng bằng `stopMembers` (chờ 10 giây sau TERM). Ghi `~/.crew-mac/reaper/reaper.log` (giờ
   Asia/Ho_Chi_Minh) và `state.json`. Cuối lượt (trừ `--dry-run`) gọi `gcWorkflowPins` (flow `mac-workflows`, mục "Pin
   theo run và dọn bản cũ") khi `~/.crew/state/workflows-gc.stamp` chưa có hoặc cũ hơn 1 giờ, rồi chạm stamp; lỗi dọn
   chỉ ghi `GC workflow lỗi: …` vào `reaper.log`, lượt reap vẫn xong.
7. `apps/crew-mac/src/reaper/reap.ts` → `sweepBridges` (lượt quét bridge, chạy trong mỗi `reapOnce`):
   - Bridge là process PPID 1, không tty, có argv dạng `node <worktree>/.paperclip-runtime/<adapter>/paperclip-bridge/server/paperclip-bridge-server.mjs`
     (`bridgeRoot` trong `run-members.ts`). Worktree lấy từ đường dẫn đó, resolve symlink, và phải qua
     `rootGuardReason`. Chưa có manifest thì bỏ qua.
   - Worktree còn claude `--print` có run id (cwd dưới worktree, kể cả claude mồ côi chưa dọn) thì không đụng bridge
     và xóa mốc đã ghi. Không đọc được cwd của một claude nào đó thì bỏ qua cả lượt.
   - Bridge không có run sống liên tục quá `BRIDGE_GRACE_MS` (2 phút) thì dừng bằng `stopMembers` (TERM, chờ 10
     giây, KILL), ghi `TERM bridge …`/`XONG bridge …` vào `reaper.log`. Mốc lưu trong `state.json` theo pid kèm thời
     điểm sinh: lệch 1 giây vẫn là cùng bridge, lệch hơn là pid đã cấp lại nên đếm lại.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/crew-mac/src/commands/stop-run.ts` | Lệnh `stop-run` | `stopRun`, `formatStopLine`, `RUN_ID_UUID` |
| `apps/crew-mac/src/reaper/reap.ts` | Một vòng dọn của reaper | `reapOnce`, `sweepBridges`, `BRIDGE_GRACE_MS`, `readReaperState`, `vnTime`, `ReapDeps.gcWorkflowPins` |
| `apps/crew-mac/src/reaper/run-members.ts` | Chọn process của một run | `selectRunMembers`, `orphanCandidates`, `collectRunMembers`, `bridgeRoot`, `readRunStarts`, `runWindow` |
| `apps/crew-mac/src/reaper/stop.ts` | TERM, chờ, KILL | `stopMembers` |
| `apps/crew-mac/src/reaper/process-table.ts` | Đọc bảng process, env và cwd | `listProcesses`, `readCwds`, `extractRunId`, `isEnvReadable`, `parseEtime` |
| `apps/crew-mac/src/reaper/select.ts` | Chọn claude mồ côi cho reaper | `selectTargets`, `isOrphaned` |

## Dữ liệu

- File: `<worktree>/.paperclip-runtime/runs/<runId>/{pgid,started}` (wrapper ghi, `stop-run` xóa khi xong). Wrapper
  ghi hai file này SAU bước `crew-mac workflow-check` (flow `mac-workflows`), muộn khoảng 0,3–2 giây sau khi process
  sinh. `stop-run` gọi trong khe đó không thấy `pgid` và chưa có `claude` để bắt, nên run có thể vẫn chạy tiếp; reaper
  dọn nó khi quá ngưỡng mồ côi. Run bị chặn ở bước kiểm (thoát 78) thì không có hai file.
- `~/.crew-mac/reaper/state.json` (`orphanSince` theo `pid:runId`; `bridgeSince` theo pid bridge, gồm `since` và
  `startedAt`), `~/.crew-mac/reaper/reaper.log`.
- `~/.crew/state/workflows-gc.stamp`: mtime là lần dọn bản workflow ghim cũ gần nhất.
- Gọi ngoài: `ps`, `lsof`, `kill`.

## Giới hạn

- `ps -E` chỉ cho thấy env lúc exec, và chỉ với binary không phải của Apple; process con được tìm theo cây PPID và
  theo cwd.
- Phiên `claude` tương tác của owner, Terminal (có tty), job nền của Terminal, editor và app của owner mở trong
  worktree không bao giờ bị chọn, vì chuỗi cha của chúng gặp process không thỏa (b').
- Giới hạn đã biết của (b'): process owner tự chạy tách khỏi terminal (`nohup`, `setsid`, `disown`, không tty) bên
  trong worktree của agent, sau khi run bắt đầu, có thể bị coi là của run và bị dừng. Đừng chạy process nền trong
  worktree agent. R1 không thêm cơ chế khác.
- Owner tự chạy `claude -p` trong Terminal mà env có `PAPERCLIP_RUN_ID` (chạy lại tay một run) thì reaper coi là run
  mồ côi và dọn sau 60 giây. Bỏ biến này khi chạy tay (`env -u PAPERCLIP_RUN_ID claude -p …`).
- Hai run cùng worktree: process sinh từ `started` của run sau trở đi thuộc run sau. Dừng run trước muộn không đụng
  process của run sau.
- Mất mạng: `sshd` (`ClientAliveInterval 15`, `ClientAliveCountMax 2`) cắt phiên sau khoảng 30 giây, rồi reaper
  dừng run sau 60 giây mồ côi, chậm nhất thêm một chu kỳ 60 giây của LaunchAgent và 10 giây chờ TERM: tổng cộng
  khoảng 2 phút 40 giây kể từ lúc mất mạng.

- Callback bridge Paperclip (`paperclip-bridge-server.mjs`) chạy với PPID 1 là đúng thiết kế. Adapter `claude_local`
  khởi nó bằng `nohup node … &` qua một lệnh SSH riêng, trước `claude` khoảng 1 giây, rồi `stop()` kill pid trong
  `.paperclip-runtime/<adapter>/paperclip-bridge/queue/server.pid` khi run xong. Reaper không chọn bridge theo cửa
  sổ thời gian của run. Nó chỉ dọn bridge khi worktree không còn claude `--print` nào có run id suốt 2 phút, nên
  không giết bridge của run đang chạy. Cái giá là bridge sót (`stop()` không tới Mac vì mất mạng hay server restart)
  chỉ tắt sau khi run mồ côi bị dọn thêm 2–3 phút. Một run có bridge mà chưa có claude quá 2 phút sẽ mất bridge;
  adapter hiện chạy claude ngay sau khi bridge sẵn sàng nên không gặp. Owner tự chạy đúng file bridge đó trong
  worktree agent thì cũng bị coi là bridge.

## Flow liên quan

- `mac-setup`: cài và gỡ LaunchAgent reaper, wrapper và launcher `~/.crew/bin/crew-mac`; `doctor` có check `reaper`
  và `launcher`.

## Tests

- `apps/crew-mac/test/agent-print.test.ts`: `isAgentPrint` theo chuỗi `ps` (fixture `test/fixtures/ps/codex-exec.txt` dựng tay từ
  SP-C, `opencode-run.txt` là GIẢ ĐỊNH A5 chờ SP-O): `codex exec`/`codex --search exec`/`codex e`, `opencode run`/`.opencode run`
  được nhận; `codex login`/`app-server`, `opencode models`/`serve`, process không có run id thì không.
- `apps/crew-mac/test/run-members.test.ts`: đọc `ps`/`lsof`, cửa sổ thời gian, chọn (a)/(b')/(c), nhận bridge theo đường dẫn (chuỗi `ps` thật) và không bao giờ chọn bridge theo giờ, không đụng Terminal, VS Code, claude tương tác của owner, hai run cùng worktree, lsof chỉ cho ứng viên theo lô.
- `apps/crew-mac/test/stop.test.ts`: TERM theo group hay theo pid, KILL phần sống sót, pid bị cấp lại, group lẫn process mới, group của chính mình.
- `apps/crew-mac/test/stop-run.test.ts`: dừng đủ thành phần của run mà không đụng run B hay Terminal, giữ thư mục run khi còn process, một lần gọi lsof và dưới 8 giây trên 6000 process, chạy thật trên macOS (tool tách session và tool mồ côi), kiểm đầu vào CLI.
- `apps/crew-mac/test/reaper-select.test.ts`: nhận diện claude mồ côi, thời hạn, không đụng phiên owner hay chính reaper.
- `apps/crew-mac/test/reaper-reap.test.ts`: dọn đủ thành phần của run mồ côi, KILL phần sống sót, dry-run, state hỏng, chạy thật `ps`/`lsof` trên macOS (dry-run), giờ Việt Nam; lượt quét bridge (chuỗi `ps` thật của bridge, HOME giả): ghi nhận lần đầu, dọn sau 2 phút, KILL bridge còn sống, không đụng bridge của worktree còn run, không đọc được cwd của claude thì bỏ lượt, ngoài thư mục worktree đã cài, pid cấp lại, state cũ.
