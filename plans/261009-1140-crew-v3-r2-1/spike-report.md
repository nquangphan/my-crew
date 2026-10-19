# SP-1 — Báo cáo spike: app macOS sở hữu sshd agent (S1–S4, cổng G0)

Ngày đo: 09/10/2026, 12:03–12:20 (giờ Asia/Ho_Chi_Minh). Máy: Mac mini arm64, macOS 26.6.2 (25G83).
Thư mục spike: `~/crew-r21-spike/` (giữ lại, xem mục "Còn chờ owner"). Không đụng sshd agent cổng 2222 (PID 16059 chạy
suốt, không có `sshd-session` của run nào trong lúc đo), không đụng LaunchAgent.

## Dựng

| Thành phần | Giá trị |
|---|---|
| App spike | `~/crew-r21-spike/dist/mac-arm64/2P Crew Spike.app`, bundle `com.2p-solutions.crew.spike`, Electron 44.4.5, electron-builder 26.15.3, `target: dir`, arm64 |
| Ký | `Apple Development: Nhật Quang Phan (29CVPDJ2XX)`, `TeamIdentifier=J7Y2DL6HZV`, hardened runtime (`flags=0x10000(runtime)`), `codesign --verify --deep --strict` OK, designated requirement theo identifier + leaf CN |
| Info.plist thêm | `NSDesktopFolderUsageDescription`, `NSDocumentsFolderUsageDescription` (tiếng Việt) |
| sshd spike | `/usr/sbin/sshd -D -f ~/crew-r21-spike/sshd_config -E ~/crew-r21-spike/sshd.log`, `127.0.0.1:22999`, config sinh bằng `renderSshdConfig` của `@crew/mac` (build lại dist), `sshd -t` → `CONFIG_OK` |
| Helper | `~/crew-r21-spike/resp` (gọi `responsibility_get_pid_responsible_for_pid`); shell agent hiện tại → responsible = Orca (đúng E3/E4); listener 2222 (16059) → chính nó (đúng E4) |
| Spawn | Đúng `main.cjs` của plan: `spawn(..., { detached: true, stdio: 'ignore' })` + `unref()` |

## Số liệu

| # | Lệnh / cách đo | Giờ | Giá trị đo | Kết quả |
|---|---|---|---|---|
| S1 | `open "…/2P Crew Spike.app"` (LaunchServices), phiên `ssh … 'exec sleep 121'`, `ps -o pid,ppid,pgid,comm`, `resp` | 12:07–12:08 | App 21600 `ppid 1` (launchd, không phải terminal). Listener 21677 `ppid 21600`, `pgid 21677` (nhóm riêng). `sshd-session [priv]` 22472, `sshd-session @notty` 22483, shell/`sleep` 22484. `resp`: cả 5 pid (app, listener, 2 `sshd-session`, shell) → responsible **21600** `…/2P Crew Spike.app/Contents/MacOS/2P Crew Spike`. Chuỗi cha khớp responsible (xác nhận lệch spec số 5) | **ĐẠT** |
| S1b | Mở từ login item sau đăng xuất/đăng nhập | — | Owner hoãn đăng xuất/đăng nhập | **CHỜ OWNER** |
| S2a | `ssh … 'zsh -lc "claude auth status"'` | 12:08 | `loggedIn: true`, `authMethod: claude.ai`, `subscriptionType: max` (email/org ẩn) | **ĐẠT** |
| S2b | `claude -p "Trả lời đúng một chữ: OK" --max-turns 1` trong `~/crew-agents/mac-claude`, giới hạn 120 s tự SIGKILL | 12:08, 12:11 (lần 2 có `ssh -n` và `</dev/null`), 12:13 (lần 3, 60 s, để `sample`) | Cả 3 lần không in `OK`, `probe_rc=137` (bị SIGKILL đúng hạn), sau đó `pgrep -f "claude -p"` rỗng. `sample` lần 3: main thread của `claude` (2.1.295, responsible = app 21600) kẹt 100% trong `__openat_nocancel` = chờ TCC. Nguyên nhân: lúc 12:08:12 `claude auth status` chạm ổ rời `/Volumes/CORSAIR`, tccd ghi `AUTHREQ_PROMPTING service=kTCCServiceSystemPolicyRemovableVolumes subject=com.2p-solutions.crew.spike` (msgID 53246.17344) — hộp thoại "2P Crew Spike" muốn truy cập ổ rời đang mở trên màn hình, chưa ai bấm, nên mọi truy cập cùng dịch vụ của các `claude` sau đều chờ | **CHỜ OWNER** (không phải lỗi cơ chế; chặn bởi hộp thoại của chính app) |
| S3a | Phiên `sleep 90; date > s3-a.txt`, sau 2 s `kill -TERM <listener 21677>` | 12:15:31 → 12:17:01 | Listener chết, cổng 22999 trống; `sshd-session` 36850 sang `ppid 1`, sống tiếp; file ghi `12:17:01` (đúng 90 s) | **ĐẠT** |
| S3b | Phiên như trên, sau 2 s app thoát êm (`kill -TERM <app 37276>`, xem ghi chú 1) | 12:15:56 → 12:17:26 | App thoát; listener 37291 sang `ppid 1`, vẫn giữ 22999; `sshd-session` 37766 vẫn con listener; file ghi `12:17:26` (90 s) | **ĐẠT** |
| S3c | Phiên như trên, sau 2 s `kill -9 <app 38248>` | 12:16:10 → 12:17:40 | Listener 38273 sang `ppid 1`, vẫn giữ 22999; `sshd-session` 38278 sống; file ghi `12:17:40` (90 s) | **ĐẠT** |
| S4 (gán quyền) | `log show --predicate 'process == "tccd"'` từ 12:07:33 | 12:08:12 | `AUTHREQ_ATTRIBUTION` của `claude` (`binary_path=…/claude/versions/2.1.295`, `identifier=com.anthropic.claude-code`) có `responsible={identifier=com.2p-solutions.crew.spike, responsible_path=…/2P Crew Spike.app/Contents/MacOS/2P Crew Spike}`; `AUTHREQ_PROMPTING` có `subject=Sub:com.2p-solutions.crew.spike` (hộp thoại hỏi cho app, không cho binary `claude` theo đường dẫn như E1). Truy cập FDA (`kTCCServiceSystemPolicyAllFiles`) của `claude` và `node` cũng gán cho app, `authValue=0`, không hộp thoại | **ĐẠT** |
| S4 (không hỏi lại khi đổi bản Claude) | Cấp quyền một lần rồi chạy `claude` bản cũ (`versions/2.1.294`, có 7 bản 2.1.287–2.1.295) | — | Chưa đo: cần owner bấm Cho phép hộp thoại đang chờ | **CHỜ OWNER** |
| S4b (listener mồ côi) | Sau S3c (app đã `kill -9`), phiên mới qua listener mồ côi 38273: `ls ~/Library/Safari` (FDA, không gây hộp thoại) | 12:16:19 | `resp` của shell/`sshd-session` mới trả về **chính nó** (pid app đã chết), nhưng tccd vẫn ghi `responsible={identifier=com.2p-solutions.crew.spike, pid=38796, responsible_path=…/2P Crew Spike.app/…}` cho `/bin/ls`, `authValue=0`. Phần có hộp thoại (`ls ~/Documents`) không chạy vì owner vắng | Gán quyền vẫn theo app (tốt); tên hộp thoại **CHỜ OWNER** |

Ghi chú:

1. S3b dùng `kill -TERM` thay menu tray "Thoát" vì agent không bấm được menu và `osascript 'quit app'` sẽ gây hộp thoại
   Automation. Electron nhận TERM thì thoát êm như `app.quit()`; spike không TERM listener ở cả hai đường nên kết quả
   tương đương.
2. **Phát hiện cho AP-2/MC-2:** sau khi app chết, `responsibility_get_pid_responsible_for_pid` trả về chính pid
   (S3b, S3c, S4b), nhưng TCC vẫn gán cho bundle app qua `responsible_path` đã lưu. Check `tcc-owner` của `doctor`
   dựa chuỗi cha chỉ đúng khi app còn sống; listener mồ côi vẫn đúng về mặt TCC.
3. **Phát hiện cho AP-1/cài đặt:** lần đầu chạy `claude` dưới app, macOS hỏi quyền **ổ đĩa rời**
   (`/Volumes/CORSAIR` trên máy này) — ngoài Desktop/Documents/Downloads/AppData. Info.plist của app thật cần thêm
   `NSRemovableVolumesUsageDescription` (spec §5 đã liệt kê), và bước Quyền ổ đĩa nên cấp FDA trước khi nhận run, vì
   một hộp thoại chưa bấm làm `claude` treo trong `openat` (S2b).
4. Hộp thoại TCC không tự đóng khi app (responsible) thoát: sau khi app 21600 thoát, cửa sổ UserNotificationCenter vẫn
   còn và tccd không ghi `AUTHREQ_RESULT` cho msgID 53246.17344.

## Quyết định

**G0 (phần mở từ Finder/LaunchServices, theo chỉ đạo owner hoãn đăng nhập lại): ĐI — có điều kiện.**
Cơ chế cốt lõi đã chứng minh: app mở qua LaunchServices giữ responsible cho listener, `sshd-session`, shell và
`claude` (S1); TCC gán quyền và hỏi theo bundle app, không theo đường dẫn bản `claude` (S4 gán quyền); phiên sống qua
TERM listener, thoát app, `kill -9` app (S3a–c); `claude` đăng nhập được qua sshd của app (S2a).
Điều kiện còn mở (không chặn bắt đầu AP-2, phải xong trước CV-1):
- S1b login item: **CHỜ OWNER**.
- S2b `claude -p` in `OK` và S4 "không hỏi lại khi đổi bản Claude": **CHỜ OWNER** bấm hộp thoại đang chờ.
- Nếu một trong ba hỏng: `G0: DỪNG`, so lại phương án `SMAppService.agent` (spec §12).

**Mặc định quit guard cho AP-2 (tạm): "Thoát ngay, run vẫn chạy".** Lý do: S3b/S3c phiên sống, và S4b cho thấy
listener mồ côi vẫn được TCC gán cho bundle app. Chốt khi owner xem tên hộp thoại ở S4b; nếu hộp thoại không có tên app
hoặc bị từ chối thì đổi thành "Chờ run xong; drain bắt buộc khi cập nhật" cho AP-2 và UPD-1.

## Còn chờ owner

Hiện trạng: app spike và sshd spike **đã tắt** (22999 trống). Thư mục `~/crew-r21-spike/` **giữ lại** cho các bước
dưới. Login item spike chưa từng bật. **Trên màn hình đang có hộp thoại "2P Crew Spike" xin quyền ổ đĩa rời** — của
spike, không phải của run thật.

Làm khi `crew/ops/active-runs.sh` rỗng:

1. Bấm **Cho phép** ở hộp thoại "2P Crew Spike … ổ đĩa rời" (quyền của bundle spike, sẽ xóa bằng `tccutil` ở bước dọn).
   Agent đo:
   ```bash
   open ~/crew-r21-spike/dist/mac-arm64/"2P Crew Spike.app"; MARK=$(date '+%Y-%m-%d %H:%M:%S')
   cd ~/crew-r21-spike && ./s -n 'zsh -lc "cd ~/crew-agents/mac-claude && ( claude -p \"Trả lời đúng một chữ: OK\" --max-turns 1 </dev/null & P=\$!; ( sleep 120; kill -9 \$P 2>/dev/null ) & wait \$P )"'   # S2b: mong in OK
   ./s -n 'zsh -lc "cd ~/crew-agents/mac-claude && ( ~/.local/share/claude/versions/2.1.294 -p \"Trả lời đúng một chữ: OK\" --max-turns 1 </dev/null & P=\$!; ( sleep 120; kill -9 \$P 2>/dev/null ) & wait \$P )"'   # S4: bản khác đường dẫn
   /usr/bin/log show --start "$MARK" --predicate 'process == "tccd"' --style compact | grep -E 'AUTHREQ_(PROMPTING|ATTRIBUTION)' | grep -E 'crew.spike|claude'
   ```
   Đạt S4 khi 0 dòng `AUTHREQ_PROMPTING` mới và dòng `AUTHREQ_ATTRIBUTION` của `versions/2.1.294` có `responsible` = `com.2p-solutions.crew.spike`.
2. (Owner ngồi máy) Desktop: agent chạy `./s -n 'ls ~/Desktop >/dev/null; echo rc=$?'`, owner xem hộp thoại ghi "2P Crew Spike" và bấm Cho phép.
3. S4b: agent `kill -9 $(jq -r .appPid ~/crew-r21-spike/out-app.json)`, rồi `./s -n 'ls ~/Documents >/dev/null; echo rc=$?'`; owner ghi hộp thoại có tên gì, bấm gì; agent ghi `rc`.
4. S1b: owner mở app (Finder), bấm biểu tượng "Spike" trên thanh menu → **Bật mở cùng máy**; đăng xuất rồi đăng nhập
   lại. Agent đo: `~/crew-r21-spike/measure-s1.sh` (mong: app `ppid 1`, mọi dòng `resp` trỏ `2P Crew Spike.app`).
   Xong owner bấm **Tắt mở cùng máy**.
5. Dọn (agent): thoát app; `pkill -f "$HOME/crew-r21-spike/sshd_config"`; `lsof -nP -iTCP:22999` rỗng;
   `tccutil reset All com.2p-solutions.crew.spike`; owner chạy `sudo sfltool dumpbtm | grep -c crew.spike` = 0
   (lệnh cần quyền admin, agent không tự chạy); `rm -rf ~/crew-r21-spike`; cập nhật `processes.md` và báo cáo này.

## S5 — API Paperclip cho app (SP-2, 12:04–12:07; khôi phục từ báo cáo agent SP-2 vì mục gốc bị ghi đè)

**Cổng G5: ĐẠT.** Board API key lấy qua `cli-auth` tạo được environment SSH `in_place` (dùng lại secret SSH có sẵn) và agent `claude_local` trong company 2P Solutions (TPS). Backup trước `20261009-1204`, 0 run active.

- Challenge tạo 201, duyệt bằng phiên board qua `api.sh` 200, poll ra `approved`; `cli-auth/me` 200, nguồn `board_key`.
- `requireBoardApprovalForNewAgents=false` ở TPS và CREA → tạo agent trực tiếp, không qua `agent-hires`.
- Tạo project 201, environment SSH 201, agent `claude_local` 201; agent pause ngay, không issue, không run.
- Dọn: agent `d4a8b215…` xóa (GET 404); project `a104722e…` xóa (GET 404); environment `d3f2da31…` CHỈ archive; key thử `f210613b…` revoke-current (`cli-auth/me` 401). Sau dọn: TPS còn 5 agent, secret SSH `fa7b4847…` còn.

**Hợp đồng thật (thắng plan):**
1. `AGENTS.md` của agent mới đã có sẵn: GET file lấy `contentHash` rồi PUT với `baseHash` đó (null → 409 `INSTRUCTION_REVISION_CONFLICT`, thiếu → 422).
2. Không tạo agent ở `paused`: tạo với `runtimeConfig.heartbeat.enabled=false`, `maxConcurrentRuns: 1`, rồi `POST /agents/:id/pause`.
3. KHÔNG DELETE environment: xóa kéo theo secret SSH mà 5 environment `mac-mini*` dùng chung, dù `delete-blast-radius` báo `canDelete: true`. Chỉ `PATCH {"status":"archived"}`.
4. Key xin kèm `requestedCompanyId` vẫn thấy mọi company → app tự chọn company.
5. Project có `urlKey`, không có `key`.
6. Link run: `<origin>/<issuePrefix>/agents/<agentId>/runs/<runId>`.
