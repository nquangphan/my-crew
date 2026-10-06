# Spike claude-mac: `claude -p` treo trong git repo khi chạy qua sshd cổng 2222

Ngày 2026-10-06, khoảng 11:49–12:10 (Asia/Ho_Chi_Minh). Máy: Mac mini, macOS 26.6.2, Claude Code 2.1.289.

## Kết luận

Claude không treo vì plugin, hook, mạng hay git. Nó bị macOS TCC chặn: tiến trình đứng yên trong lời gọi
hệ thống `openat()` để mở `/Volumes/CORSAIR/Projects/my-crew/.git`, một thư mục trên ổ ngoài CORSAIR.
Quyền đọc "Removable Volumes" mà Đại Ca từng cấp chỉ gắn với đường dẫn
`~/.local/share/claude/versions/2.1.273`. Claude tự cập nhật lên 2.1.289, nên đường dẫn mới chưa có quyền
và TCC phải hiện hộp thoại để hỏi. Lúc 10:41:02 TCC đã mở một hộp thoại như vậy cho 2.1.289, nhưng chưa ai
bấm. Từ đó mọi yêu cầu Removable Volumes đều xếp hàng phía sau và chờ mãi.

Trong các phiên cổng 2222, macOS không gán một tiến trình có quyền làm "responsible process" cho các
binary không phải của Apple, nên TCC tính quyền theo chính binary đó. Ở cổng 22 thì khác:
`sshd-keygen-wrapper` đứng làm responsible, và nó đã được cấp Full Disk Access qua tùy chọn Remote Login,
nên mọi thứ qua ngay.

Claude chỉ mở `.git` của project khác khi cwd là git repo. Có lẽ ở bước setup nó so các project đã biết
trong `~/.claude.json` (8/17 project nằm trên `/Volumes/CORSAIR`). Ở thư mục thường thì không có bước này,
nên không treo.

## Thí nghiệm và kết quả

Mỗi lượt chạy đều dùng `claude -p "say ok" --model haiku --debug-file …`, `stdin=/dev/null`, và một vòng
lặp tự `kill -9` sau N giây. Thư mục thử là `/tmp/crewdbg`, đã xóa sau khi xong.

| # | Điều kiện | Kết quả |
|---|---|---|
| 1 | Cổng 2222, thư mục thường | Xong trong 5 giây, in `ok` |
| 2 | Cổng 2222, repo vừa `git init` | Treo hơn 40 giây, không có output. Log dừng ở `Git remote URL: null` |
| 3 | Cổng 2222, git repo, `--safe-mode` (tắt plugin, hook, MCP, skill) | Vẫn treo. Chỗ log dừng mỗi lần một khác vì việc chặn nằm trong một tác vụ async |
| 4 | Cổng 2222, git repo, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | Vẫn treo |
| 5 | `sample` tiến trình treo | Main thread nằm trong `openat$NOCANCEL → __openat_nocancel`. Các thread khác rảnh. CPU 0% |
| 6 | Bản sao 2.1.289 ký ad-hoc (để `lldb` attach được), đọc thanh ghi ở frame `openat` | Đường dẫn đang mở là `/Volumes/CORSAIR/Projects/my-crew/.git` (cờ `O_DIRECTORY\|O_CLOEXEC`) |
| 7 | Chương trình C 10 dòng (ký ad-hoc) chỉ gọi `open()` vào đường dẫn ở #6, qua cổng 2222 | Treo vô hạn. Vậy không phải lỗi riêng của Claude |
| 8 | Cùng chương trình C qua cổng 22 | `fd=3` ngay. Mở `/tmp` qua cổng 2222 cũng `fd=3` ngay |
| 9 | `ls` cùng đường dẫn qua cổng 2222 | `Operation not permitted` ngay: binary của Apple bị từ chối, không có hộp thoại |
| 10 | `claude` 2.1.289 trong cùng git repo qua cổng 22 | `setup() completed in 74ms`, chạy hết luồng khởi động, chỉ lỗi `Not logged in` (Keychain). Không treo |

Thí nghiệm bật/tắt đúng thành phần là cặp #7/#8 và #2/#10. Cùng binary và cùng đường dẫn: khi
responsible process có Full Disk Access (cổng 22) thì qua, khi không có (cổng 2222) thì treo. Việc bật hay
tắt plugin, hook và traffic không ảnh hưởng gì (#3, #4).

## Bằng chứng TCC (`/usr/bin/log show`)

Lưu ý: trong zsh, `log` là lệnh builtin nên phải gọi `/usr/bin/log`. Đây có lẽ là lý do lần kiểm tra trước
không thấy gì.

- Mỗi lần treo, `sandboxd` ghi `request approval` và gửi yêu cầu `kTCCServiceSystemPolicyAllFiles` lên
  tccd hệ thống, nhận `authValue=0` (bị từ chối, subject là chính binary claude hoặc opendir). Sau đó nó gửi
  `tcc_send_request_authorization() IPC` lần hai và không bao giờ nhận được trả lời. tccd của user cũng
  không có dòng `REQUEST` nào cho các yêu cầu này.
- Lúc `10:41:02.207`, tccd của user ghi
  `AUTHREQ_PROMPTING … service=kTCCServiceSystemPolicyRemovableVolumes, subject=…/versions/2.1.289`
  (responsible `com.anthropic.claude-code` pid 18951, accessing `node`, tức một hook của Claude). Sau dòng
  này không có `AUTHREQ_RESULT`, nghĩa là hộp thoại vẫn đang chờ. Từ 10:41 đến nay không có yêu cầu
  Removable Volumes nào tới được tccd.
- Ở cổng 22, cùng chương trình C: `responsible=com.apple.sshd-keygen-wrapper`,
  `subject=/usr/libexec/sshd-keygen-wrapper`, `authValue=2, authReason=4` (user cho phép).
- `~/Library/Application Support/com.apple.TCC/TCC.db` (đọc qua cổng 22) có quyền
  `kTCCServiceSystemPolicyRemovableVolumes` cho `/Users/phannhatquang/.local/share/claude/versions/2.1.273`
  và cho hai bản `node` Homebrew. Không có dòng nào cho 2.1.289.
- Màn hình Mac mini không khóa (`IOConsoleLocked=false`), nhưng không có ai thao tác trong khoảng 2,4 giờ.
  Chrome Remote Desktop đang chạy.

## Các giả thuyết đã loại trừ

- Plugin, skill, hook, MCP: `--safe-mode` vẫn treo.
- Mạng hoặc API: `DISABLE_NONESSENTIAL_TRAFFIC` vẫn treo. Hai kết nối HTTPS chỉ là kết nối nền đang mở.
- Subprocess git, fsmonitor, cấu hình git: không có process con, `~/.gitconfig` chỉ có LFS. Main thread chặn
  ở `openat` chứ không ở `waitpid`.
- FIFO hoặc pipe: đường dẫn là một thư mục trên APFS cục bộ.
- Keychain: việc chặn xảy ra trước bước auth. Cổng 22 không có Keychain mà vẫn qua được giai đoạn này.
- Mức nice hay ProcessType của LaunchAgent: trạng thái `N` chỉ đến từ `BG_NICE` của zsh khi chạy nền. Lỗi
  vẫn tái hiện với chương trình C.

## Cách sửa (theo thứ tự ưu tiên trong brief)

**(a) Cờ hoặc biến môi trường của Claude Code, không sửa file của user.** Không tìm được. Phần quét project
nằm trong setup và vẫn chạy với `--safe-mode`, `--setting-sources`, `DISABLE_NONESSENTIAL_TRAFFIC`. Muốn
Claude không chạm `/Volumes` thì phải bỏ các project trên ổ CORSAIR khỏi `~/.claude.json`, mà đó là file của
user. Dùng `HOME` hay `CLAUDE_CONFIG_DIR` tạm thì mất đăng nhập.

**(b) Sửa LaunchAgent sshd.** Không có cách nào đã được chứng minh, nên tôi không sửa gì trong
`~/.crew-spike-sshd` hay plist. launchd không có key nào để chọn responsible process có quyền.
`sshd-keygen-wrapper` không nhận tham số (`Unexpected argument: "-t"`), nên không bọc sshd riêng bằng nó được.

**(c) Việc Đại Ca cần làm:**

1. **Gỡ treo ngay:** mở màn hình Mac mini (Chrome Remote Desktop) và bấm **Allow** ở hộp thoại kiểu
   "2.1.289 muốn truy cập tệp trên ổ đĩa di động". Hộp thoại này có từ 10:41. Ngoài ra có thể còn hai hộp
   thoại của `opendir` (hỏi quyền Desktop và Downloads) do thí nghiệm của tôi lúc 11:57 tạo ra. Hãy bấm
   **Don't Allow** cho chúng; binary đó đã bị xóa.
   - Cách này chưa bền: mỗi lần Claude tự cập nhật, đường dẫn `versions/<x>` đổi và sẽ treo lại một cách
     im lặng.
2. **Cách bền, khuyến nghị:** cho Paperclip SSH vào **cổng 22** (đã có Full Disk Access qua
   `sshd-keygen-wrapper`, thí nghiệm #8 và #10) và xác thực bằng `CLAUDE_CODE_OAUTH_TOKEN` (Đại Ca chạy
   `claude setup-token` một lần, token lưu làm secret của Paperclip) thay cho Keychain. Khi đó có thể bỏ
   hẳn sshd cổng 2222. Việc cần kiểm lại: `claude -p` với token này có chạy được qua cổng 22 trong git repo
   không, và hạn mức có tính vào gói Max không.
3. **Thay thế, chưa kiểm:** cấp Full Disk Access cho `/usr/sbin/sshd`. Tôi chưa chứng minh được cách này
   giúp gì, vì ở cổng 2222 các binary không phải của Apple được TCC tính quyền theo chính nó, không theo
   sshd. Nếu thử thì chạy lại thí nghiệm #7.
4. **Giảm rủi ro chung:** dù chọn cách nào, cwd của Paperclip nên nằm ngoài `~/Desktop`, `~/Downloads` và
   `/Volumes`. Mọi tool của Claude chạm vào những vùng đó qua cổng 2222 đều có thể treo theo cùng cơ chế.

## Giám sát

- Báo động khi `claude -p` chạy quá N giây mà không có output.
- Kiểm tra định kỳ `/usr/bin/log show --predicate 'process == "tccd" AND eventMessage CONTAINS "AUTHREQ_PROMPTING"'`.
  Bất kỳ dòng nào có subject là `…/claude/versions/…` đều có nghĩa là sắp treo.

## Thay đổi đã thực hiện trên Mac mini

- Không sửa `~/.crew-spike-sshd/*`, plist, `~/.claude`, Keychain hay plugin.
- Đã xóa `/tmp/crewdbg` (log, bản sao claude ký ad-hoc, chương trình C). Mọi process tôi tạo đã bị kill.

## Câu hỏi còn mở

- Chức năng nào của Claude Code mở `.git` của project khác khi cwd là git repo? Tìm trong mã đã bundle
  không ra. Có thể là bước dò worktree hoặc repo cùng gốc trên các project trong `~/.claude.json`.
- Vụ treo "sau lần gọi tool đầu tiên" trong run Paperclip ở thư mục không phải git có cùng cơ chế không
  (một tool chạm vào vùng TCC bảo vệ)? Cần debug log của run đó.
- Quyền Documents: `opendir` vào `~/Documents/...` trả về `ENOENT` ngay, dù TCC.db của user không có quyền
  Documents cho binary đó. Chưa rõ thư mục Documents có bị chặn theo cùng cách hay không.

---

# D2: "Đại Ca" và 3 plugin `cc-plugin-*` khi chạy với `--setting-sources project,local`

Ngày 2026-10-06, chạy trên Mac mini qua cổng 2222 (sau khi Đại Ca đã bấm Allow TCC), Claude Code 2.1.289,
`--model haiku`. Mỗi lần chạy hỏi agent phải gọi người dùng là gì; nếu không có chỉ dẫn thì phải trả lời
`KHONG_CO`.

## Kết luận

1. **"Đại Ca" đến từ `~/.claude/CLAUDE.md`, nhưng không phải theo đường user memory.** Khi tìm CLAUDE.md,
   Claude Code đi ngược lên từng thư mục cha của cwd và nạp `<thư mục cha>/.claude/CLAUDE.md` như file của
   project. Với cwd `~/crew-spike/<repo>`, một thư mục cha là `$HOME`, nên file
   `$HOME/.claude/CLAUDE.md` (chứa "Gọi người dùng là **Đại Ca**") bị nạp như CLAUDE.md của project.
   `--setting-sources` chỉ quyết định file `settings.json` nào được đọc, không chặn được bước dò CLAUDE.md
   này. Ở `/tmp` thì không có thư mục cha nào có `.claude/CLAUDE.md`, nên Trợ Lý không thấy "Đại Ca".
   Đã loại trừ:
   - managed settings: thư mục `/Library/Application Support/ClaudeCode/` không tồn tại;
   - CLAUDE.md ở `~/crew-spike/` hay `~`: không có;
   - output style: không có `~/.claude/output-styles`, `settings.json` không đặt `outputStyle`;
   - plugin inline hoặc "directory-loaded" (`engineering`): với cờ thì log báo `Found 4 plugins`, không có
     dòng `Loaded inline` hay `directory-loaded`, nên chúng không được nạp;
   - transcript/resume: các thí nghiệm đều là phiên mới. Tuy vậy, phiên Paperclip `--resume` từ transcript
     cũ vẫn sẽ mang "Đại Ca" trong lịch sử hội thoại.
2. **Ba plugin `cc-plugin-agents-md`, `cc-plugin-telemetry`, `cc-plugin-plugin-authoring` là plugin builtin
   đóng gói sẵn trong binary Claude Code** (id `…@builtin`). Mã của chúng nằm trong bundle `/$bunfs/root/…`
   và tự đăng ký khi khởi động. Chúng không đến từ user, plugin cache hay managed settings, và không có
   `--plugin-dir` mặc định nào. `--safe-mode` cũng giữ chúng, vì help ghi "built-in tools and plugins …
   work normally".

## Thí nghiệm

| # | cwd | Cờ hoặc biến môi trường | Trả lời | Ghi chú |
|---|---|---|---|---|
| A | `/tmp/d2/gitrepo` (git) | `--setting-sources project,local` | `KHONG_CO` | `Found 4 plugins (3 enabled, 1 disabled)` |
| B | `~/crew-spike/d2-probe-repo` (git, mới tạo) | như A | **`Đại Ca`** | Tái hiện được lỗi |
| C | `/tmp/d2/plain` (không phải git) | như A | `KHONG_CO` | Git không liên quan; chỉ vị trí thư mục quyết định |
| E | `/tmp/d2/fakehome/repo`, cha có `.claude/CLAUDE.md` ghi "Sếp Tổng" | như A | **`Sếp Tổng`** | Chứng minh cơ chế nạp `.claude/CLAUDE.md` của thư mục cha |
| D | như B | như A, thêm `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` | `KHONG_CO` | Tắt được |
| F | `/tmp/d2/gitrepo` có `CLAUDE.md` riêng ghi "Anh Hai" | như D | `KHONG_CO` | Biến này tắt luôn CLAUDE.md của repo |
| H, I | `/tmp/d2/plain` | như A, thêm `--settings '{"enabledPlugins":{"cc-plugin-telemetry@builtin":false,"cc-plugin-agents-md@builtin":false,"cc-plugin-plugin-authoring@builtin":false}}'` | `KHONG_CO` | `Found 4 plugins (0 enabled, 4 disabled)`, không còn `plugin.register` |

Cả hai thí nghiệm bật/tắt đều có cặp đối chứng: B/D cho biến môi trường, A/B/E cho vị trí cwd. Phần plugin
builtin có I so với A.

## Cách tắt (không cần login lại, không sửa file của user)

1. **Đặt repo và workspace của Paperclip ngoài `$HOME`**, ví dụ `/Users/Shared/crew-spike/…` hoặc
   `/opt/crew-spike/…`, miễn là không có thư mục cha nào chứa `.claude/CLAUDE.md`. Cách này giữ được
   CLAUDE.md/AGENTS.md của chính repo. Thí nghiệm A và C chứng minh cho cách này. Tránh đặt dưới `/Volumes`,
   `~/Desktop` hay `~/Downloads` (bài học TCC ở phần đầu). Cách này phải chuyển `~/crew-spike/*`; việc đó
   cần điều phối quyết, tôi không đụng vào.
2. **Hoặc** đặt `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` trong môi trường adapter (thí nghiệm D). Cái giá là mất
   luôn CLAUDE.md của repo (thí nghiệm F). Nếu repo cần chỉ dẫn thì adapter phải tự đưa vào, ví dụ bằng
   `--append-system-prompt` với nội dung file. Phần này chưa thử.
3. **Plugin builtin:** thêm vào lệnh của adapter
   `--settings '{"enabledPlugins":{"cc-plugin-telemetry@builtin":false,"cc-plugin-agents-md@builtin":false,"cc-plugin-plugin-authoring@builtin":false}}'`
   (thí nghiệm I). `--settings` luôn được áp dụng dù có `--setting-sources`. Tắt chúng là tùy chọn: chúng là
   một phần của Claude Code chứ không phải cấu hình của Đại Ca. `agents-md` lo việc nạp AGENTS.md nên có
   thể muốn giữ, còn `telemetry` gửi số liệu về Anthropic.
4. `--bare` cũng bỏ bước dò CLAUDE.md, nhưng chỉ nhận `ANTHROPIC_API_KEY` (không OAuth/Keychain), nên
   không hợp với gói Max.

## Nếu muốn sửa file của user (để Đại Ca quyết)

- Chuyển nội dung xưng hô từ `~/.claude/CLAUDE.md` vào chỗ chỉ nạp ở phạm vi user. Lưu ý: chừng nào file
  còn ở đúng vị trí `$HOME/.claude/CLAUDE.md` thì mọi repo nằm dưới `$HOME` đều nạp nó như file của project.
  Tôi chưa thử cách nào giữ được tác dụng user-scope mà tránh được hiệu ứng này, nên cách 1 ở trên vẫn gọn
  và chắc hơn.

## Dọn dẹp

Đã xóa `/tmp/d2`, `~/crew-spike/d2-probe-repo` và file strings tạm. Không sửa `~/.claude`, plugin hay
LaunchAgent. Không còn process nào của tôi.

## Câu hỏi còn mở

- Plugin builtin thứ 4 đang tắt mặc định là plugin nào (có thể là `cc-plugin-sec-default` hoặc
  `mods-guide`)? Không ảnh hưởng tới D2.
- Paperclip có `--resume` các phiên cũ không? Nếu có, lịch sử cũ vẫn chứa "Đại Ca" cho tới khi bắt đầu phiên
  mới.
