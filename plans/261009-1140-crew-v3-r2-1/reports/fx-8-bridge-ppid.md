# FX-8 — `paperclip-bridge-server.mjs` chạy với PPID 1 trong run của 2ps-landing

Ngày 09/10/2026, 17:35–17:40 ICT (theo `date` của Mac). Người làm: agent Claude (opus), giao từ Trợ Lý. Chỉ đọc:
không sửa code, không commit, không tạo issue hay run, không kill process, không đụng sshd 2222 hay app.

## Kết luận

**Đây là hành vi đúng thiết kế, không phải process mồ côi do lỗi, và không liên quan tới R2-1.**

- `paperclip-bridge-server.mjs` là callback bridge của Paperclip. Nó không phải MCP server và không phải con của
  `claude`.
- Adapter `claude_local` khởi động bridge bằng một lệnh SSH riêng, chạy trước khi `claude` chạy:
  `nohup node …/paperclip-bridge-server.mjs >> bridge.log 2>&1 < /dev/null &`.
- Shell `sh -c` của lệnh SSH đó thoát ngay sau khi ghi pid, nên node được launchd (PID 1) nhận làm con. PPID 1 là
  kết quả tất yếu của cách khởi động này.
- Khi run kết thúc, adapter gọi `stop()` trong `finally`. `stop()` dùng một lệnh SSH khác để `kill` đúng pid đã
  ghi. Đó là lần "tự tắt" quan sát được lúc khoảng 17:21:50.
- R1 cũng y hệt: sshd LaunchAgent cũng sinh bridge PPID 1. Việc sshd là con của app 2P Crew (R2-1) không đổi gì,
  vì macOS không có subreaper.

**Còn hai rủi ro nhỏ ở bộ dọn mồ côi `crew-mac reap`**, đều có từ R1 và không chặn R2-1:

1. Bridge chỉ được dọn nhờ trùng cửa sổ thời gian. Nếu `stop()` không tới được Mac (mất mạng, server Paperclip
   restart giữa chừng), bridge chỉ bị reaper dọn khi nó tình cờ nằm trong cửa sổ thời gian của run. Nếu `claude`
   kết thúc bình thường mà `stop()` hỏng, reaper không bao giờ dọn bridge.
2. Có thể giết nhầm bridge đang dùng. Trường hợp này rất hẹp: cần run trước bị mồ côi mà chưa dọn, và run mới bắt
   đầu ngay trong cùng worktree.

## Bằng chứng

### Cách adapter sinh và dừng bridge

Fork `~/Documents/projects/crew/.worktrees/paperclip-v3`, HEAD `4dca97106`:

| Điểm | File:dòng | Nội dung |
|---|---|---|
| Tên entrypoint | `packages/adapter-utils/src/sandbox-callback-bridge.ts:87` | `SANDBOX_CALLBACK_BRIDGE_ENTRYPOINT = "paperclip-bridge-server.mjs"` |
| Khởi động tách khỏi phiên | `sandbox-callback-bridge.ts:1838-1846` | `mkdir …; rm -f ready.json server.pid; nohup node <entry> >> logs/bridge.log 2>&1 < /dev/null &; pid=$!; printf pid > server.pid`. Không có `setsid` hay `disown`. Lệnh `sh -c` thoát nên node bị reparent về launchd. |
| Dừng | `sandbox-callback-bridge.ts:1911-1930` | `stop()`: SSH exec `kill $pid`, chờ tối đa 2 giây, rồi `rm -f server.pid ready.json`. Không có SIGKILL. |
| Bridge thoát khi nhận TERM | `sandbox-callback-bridge.ts:2567-2574` | `SIGTERM`/`SIGINT` gọi `server.close()`, rồi `process.exit(0)`. Không có watchdog tự thoát khi host biến mất. |
| Gọi từ adapter claude | `packages/adapters/claude-local/src/server/execute.ts:721-733` | `startAdapterExecutionTargetPaperclipBridge(...)`, chạy trước khi spawn `claude`. Env của claude nhận `PAPERCLIP_API_URL` trỏ tới bridge. |
| Dừng trong finally | `claude-local/src/server/execute.ts:1360-1366` | `finally { … if (paperclipBridge) await paperclipBridge.stop(); … restoreRemoteWorkspace() }` |
| Đường file-queue cho SSH | `packages/adapter-utils/src/execution-target.ts:4849-4925` | Worker phía server cùng `startSandboxCallbackBridgeServer`. Env trả về là `PAPERCLIP_API_BRIDGE_MODE: "queue_v1"`. |
| cwd và env của bridge | `packages/adapter-utils/src/ssh.ts:43-73`, `execution-target.ts:687-689` | Lệnh chạy dạng `cd <remoteCwd> && export <env bridge>; …`. cwd là worktree agent. Env chỉ gồm `PAPERCLIP_BRIDGE_*` và channel, **không có `PAPERCLIP_RUN_ID`**. |

### Log run trên VPS

Đọc bằng `api.sh GET /heartbeat-runs/<id>/log`, giờ UTC (+7 ra ICT).

- Run `165a3c6e` (assistant TPS-72):
  - `10:18:51.232`: "Starting sandbox callback bridge for claude in …/p-2ps-landing/assistant/.paperclip-runtime/claude/paperclip-bridge."
  - `10:18:52.687`: wrapper in `crew-workflow ok`, `claude` init `cwd=…/assistant`.
  - `10:21:50.719`: "Restoring workspace changes…". `stop()` chạy ngay trước dòng này.
  - Thứ tự này khớp với quan sát lúc 17:19: bridge pid 77461 sinh trước `claude` pid 77503 khoảng 1 giây, và
    bridge tắt khi run xong.
- R1 cũng vậy:
  - Run `25edabe4` (06/10): `09:18:27.631` "Starting sandbox callback bridge … mac-claude …".
  - Run `24e96e9e` (07/10): `10:12:03.117` "Starting sandbox callback bridge … mac-claude …", rồi
    `10:12:04.294 crew-workflow ok`.
  - Hai run R1 dùng cùng cơ chế, nên bridge PPID 1 có từ R1.

### Trạng thái trên Mac lúc 17:37

- `ps` không có `paperclip-bridge`, `crew-claude-run` hay `claude --print` nào.
- Ở cả 9 worktree (`~/crew-agents/*`, `~/crew-agents/p-2ps-landing/*`), thư mục
  `.paperclip-runtime/claude/paperclip-bridge/queue/` chỉ còn `logs requests responses`, không còn `server.pid` hay
  `ready.json`. Nghĩa là `stop()` đã chạy hết và tự xóa hai file đó. `bridge.log` đều 0 byte.
- `.paperclip-runtime/runs/` rỗng ở mọi worktree: `stop-run` đã xóa thư mục run. `~/.crew-mac/reaper/state.json`
  có `orphanSince: {}`.
- `~/.crew/logs/{app,daemon,status}.log` không có dòng nào về bridge.

### Reaper đã từng dọn bridge (R1, suy luận từ thứ tự PID)

`~/.crew-mac/reaper/reaper.log` có hai lần dọn, đều thuộc các bài test cắt mạng:

- `2026-10-06 16:20:54 TERM run=25edabe4 pid=70843 pids=70786,70843`
- `2026-10-07 17:13:49 TERM run=24e96e9e pid=98628 pids=98569,98628,99760,99761`

70786 và 98569 sinh trước `claude` (70843, 98628), không có tty, cwd nằm trong worktree, PPID 1. Theo thiết kế, chỉ
bridge thỏa đủ các điều kiện này. Trong hai lần đó `stop()` không tới được Mac vì mạng bị cắt, nên reaper đã dọn
bridge qua nhánh (b'). Đây là suy luận, chưa có `ps` lúc đó để xác nhận.

## Trả lời từng câu hỏi

1. **Đúng thiết kế hay mồ côi?** Đúng thiết kế. Cha thật của bridge là `sh -c` của một phiên SSH ngắn, không phải
   `claude` hay `sshd-session` của run. Shell thoát ngay sau `nohup … &`. Vòng đời của bridge do adapter quản lý
   qua `server.pid` và `stop()`.
2. **Có liên quan R2-1 không?** Không. R1 (sshd LaunchAgent) cũng sinh bridge PPID 1. Trường hợp app thoát hay
   restart sshd: bridge nằm ngoài cây process của sshd nên không chết theo. `claude` của run thì chết theo, rồi
   reaper xử lý như trường hợp mất mạng ở mục 3.
3. **`crew-mac reap` có xử lý được không, có giết nhầm không?**
   - Reaper chỉ kích hoạt khi thấy một `claude --print` có run id mà chuỗi cha không còn sshd
     (`apps/crew-mac/src/reaper/select.ts:18-49`). Bridge một mình không bao giờ kích hoạt reaper.
   - Khi đã kích hoạt, reaper chọn bridge bằng nhánh (b') (`run-members.ts:87-101`, `142-164`). Điều kiện là cwd
     trong worktree, tty `??`, không mang run id khác, chuỗi cha chỉ có launchd, và thời điểm sinh nằm trong
     `[started − 1 s, nextStarted − 1 s)` (`run-members.ts:66-71`).
   - `started` là lúc wrapper sinh. Bridge sinh **trước** wrapper khoảng 0,5–1,5 giây (log: 1,18 giây và 1,46
     giây từ dòng "Starting" tới `crew-workflow ok`). `etime` của `ps` lại làm tròn xuống giây. Vì vậy bridge chỉ
     vào được cửa sổ nhờ sai số 1 giây, tức là dọn được do may mắn chứ không do thiết kế.

## Rủi ro

| # | Kịch bản | Hậu quả | Khả năng |
|---|---|---|---|
| R-a | Mất mạng hoặc server Paperclip restart giữa run, `stop()` không tới Mac, và khoảng cách sinh bridge→wrapper vượt sai số (≥ ~2 giây theo đồng hồ `etime`) | Bridge mồ côi sống mãi: một tiến trình node rảnh, nghe trên `127.0.0.1:<port ngẫu nhiên>`, cwd trong worktree. Token chết theo worker phía server nên không lộ quyền. Tốn khoảng vài chục MB RAM mỗi con, tích lũy dần. | Thấp |
| R-b | `claude` kết thúc bình thường nhưng `stop()` hỏng (server bị kill đúng lúc, SSH exec timeout) | Như R-a. Reaper không bao giờ dọn vì không có `claude` mồ côi để kích hoạt. Lần chạy sau trong cùng worktree xóa `server.pid` cũ (`sandbox-callback-bridge.ts:1841`) mà không kill, nên mất luôn dấu vết pid. | Thấp |
| R-c | Run P mồ côi (mất mạng, `stop-run` H3 trả `unreachable`, thư mục `runs/P` còn), mạng có lại và run R của **cùng agent** bắt đầu trong khoảng 60–130 giây trước khi reaper dọn P | Bridge của R sinh trước `started` của R nên rơi vào cửa sổ của P. Nếu reaper quét trước khi wrapper R ghi `started`, cửa sổ của P còn mở (`nextStarted=null`). Khi đó reaper TERM **bridge đang dùng của R**, và các lệnh Paperclip API trong run R hỏng (connection refused). | Rất thấp. Load gate chờ kết quả stop, H3 chạy khi mạng có lại, và các test R1 cho thấy server phát hiện mất mạng chậm (5 phút), lúc đó reaper đã dọn P xong. |

Không thấy dấu vết R-a, R-b hay R-c xảy ra: không có bridge nào còn sống, không có `server.pid` sót lại.

## Đề xuất

Không cần sửa gì cho R2-1. Nếu muốn khóa hai rủi ro trên, mở một ticket nhỏ, ưu tiên thấp, ở **gói `crew-mac`,
flow `mac-orphan-reaper`** (`apps/crew-mac/src/reaper/`). Không sửa adapter-utils của fork, để không lệch upstream.

1. **Nhận diện bridge theo đường dẫn, không theo giờ** (`run-members.ts`, có thể thêm `select.ts`/`reap.ts`).
   - Process `node` có argv `…/<root>/.paperclip-runtime/claude/paperclip-bridge/server/paperclip-bridge-server.mjs`,
     PPID 1, không tty. Node không phải binary Apple nên `ps -E` đọc được `PAPERCLIP_BRIDGE_QUEUE_DIR`.
   - Khi dọn run P: chỉ chọn bridge của worktree P nếu worktree đó **không còn** `claude --print` nào có chuỗi cha
     sshd, tức là không có run sống. Như vậy R-c không giết nhầm được, và R-a được dọn bất kể khoảng cách thời gian.
2. **Thêm một lượt quét bridge mồ côi độc lập** cho R-b, trong `reapOnce`. Bridge PPID 1 ở worktree đã cài, không
   có `claude --print` sống trong worktree đó, và thỏa một trong hai điều kiện: pid khác `queue/server.pid` hiện
   tại, hoặc file đó không còn. Mồ côi quá `grace` (60 giây) thì TERM. Ghi `reaper.log`.
3. **Test** (`apps/crew-mac/test/run-members.test.ts`, `reaper-reap.test.ts`):
   - bridge sinh trước `started` 3 giây vẫn được dọn cùng run mồ côi;
   - bridge của run R đang sống không bị chọn khi dọn run P cùng worktree;
   - bridge sót lại khi không có `claude` nào thì được dọn sau `grace`.
4. **Docs**: thêm vào mục "Giới hạn" của `docs/flows/mac-orphan-reaper.md` một dòng nói bridge Paperclip chạy PPID
   1 là bình thường và reaper xử lý nó ra sao.

Gợi ý giao: sonnet, gói `mac-cli`, khoảng 1 commit kèm test. Không gấp, làm sau các cổng nghiệm thu R2-1.

## Lệnh đã chạy (chỉ đọc)

```sh
git -C ~/Documents/projects/crew/.worktrees/paperclip-v3 grep -n paperclip-bridge-server
ssh nhamoiplatform 'docker exec crew-v3-spike-db-1 psql -U paperclip -d paperclip -Atc "select id … from heartbeat_runs where id::text like …"' </dev/null
ssh nhamoiplatform 'cd /opt/crew-v3-spike && ./api.sh GET /heartbeat-runs/<id>/log' </dev/null   # 165a3c6e, 24e96e9e, 25edabe4; lưu ở scratchpad cục bộ
ps -axww -o pid=,ppid=,pgid=,tty=,lstart=,command= | grep -E "paperclip-bridge|crew-claude-run|claude --print"
ls ~/crew-agents/*/.paperclip-runtime/{runs,claude/paperclip-bridge/queue}; cat ~/.crew-mac/reaper/{reaper.log,state.json}
```

Không tạo file tạm trên VPS. Không dùng Codex hay fable.
