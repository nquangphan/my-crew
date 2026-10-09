# Cài và kiểm Mac chạy agent (crew-mac)

> Flow `mac-setup`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-setup` in ra đúng danh sách đó.

## Mục đích

Biến một Mac thành SSH environment cho Paperclip (Crew v3) bằng một lệnh, kiểm được nó và gỡ sạch được. Agent
`claude_local` chạy qua một sshd riêng trong phiên desktop (Aqua) để đọc được đăng nhập Claude trong Keychain,
không cần token và không login lại.

## Điểm vào

- `crew-mac setup --paperclip-key <file .pub> [--sshd-owner app|launchd] [--force]`: chạy trong Terminal trên màn
  hình Mac. In `adapterConfig.command` và hai dòng `adapterConfig.extraArgs` (agent thường: Superpowers đã ghim; agent
  vai bmad: BMAD đã ghim; flow `mac-workflows`) cần đặt cho agent `claude_local`, và chủ sshd agent hiện tại (xem
  "Chủ sshd agent").
- `crew-mac doctor [--no-probe]`: chạy bất kỳ lúc nào, kể cả qua SSH.
- `crew-mac status config --url <Paperclip origin> --company <UUID>`: lưu origin, `companyId` UUID và sinh `machineId` UUID nếu chưa có.
- `crew-mac status set-secret`: đọc secret từ stdin và lưu vào Keychain.
- `crew-mac status send`: gửi bản tin máy v1 tới webhook `machine-status`.
- `crew-mac status add-repo <projectId> <path>`: đăng ký repo git cho ảnh chụp docs; `remove-repo <projectId>`
  gỡ repo; `list-repos` xem danh sách và commit gửi cuối.
- `crew-mac workflow-check`, `crew-mac run-init-check`: kiểm nguồn skill của run (flow `mac-workflows`).
- `crew-mac workflows list [--json] | install`: xem sổ workflow đã chứng nhận, hoặc chỉ cài hai bản ghim mà không chạy
  lại cả `setup` (không đụng sshd/launchd; dùng khi app 2P Crew đang giữ sshd agent). Chi tiết ở flow `mac-workflows`.
- `crew-mac bmad stories --root <dir> --file <file.md> [--rev <sha>] [--json] | setup-project --root <dir>`: agent BMAD
  và Trợ Lý gọi để đọc file epic/story và dựng `_bmad/` cho repo dự án; `cli.ts` chỉ chuyển `bmad` sang `bmadCommand`
  (flow `mac-workflows`).
- `crew-mac files --issue <uuid> --run <uuid> [--json]`: agent gọi trong run Paperclip để lấy danh sách file đính
  kèm của issue và issue cha; `crew-mac files --gc-only` chỉ dọn cache. Toàn bộ nằm ở flow `mac-attachments`;
  `cli.ts` chỉ chuyển `files` sang `filesCommand` (truyền `io.env`, không đọc `process.env` trực tiếp).
- `crew-mac uninstall [--force]`: chạy trong Terminal trên màn hình Mac (qua sshd agent thì bị từ chối, trừ khi có `--force`).

## Các bước

1. `apps/crew-mac/src/cli.ts` → `main`: đọc cờ, dựng `MacContext` bằng `createMacContext` (`superpowersPin` luôn là
   `SUPERPOWERS_PIN`, `cliPath` là đường dẫn thật của `cli.js`), gọi lệnh.
2. `apps/crew-mac/src/commands/setup.ts` → `setup`: kiểm macOS, phiên Aqua (`guiSessionAvailable`), LaunchAgent spike
   còn chạy hay không, IP Tailscale (`tailscaleIpv4`), thư mục worktree (`forbiddenRootReason`: không phải HOME hay cha của HOME, không dưới `/Volumes`, `~/Desktop`, `~/Downloads`); tạo host key và key
   doctor (`ssh-keygen`); ghi `~/.crew-mac/sshd/sshd_config` (`renderSshdConfig`), `known_hosts`, dòng key trong
   `~/.ssh/authorized_keys` (`upsertKey`, comment `crew-mac-paperclip`, `crew-mac-doctor`; cả hai có `KEY_OPTIONS`:
   `from="100.64.0.0/10"` và tắt forwarding), khối PATH trong
   `~/.zshenv` (`upsertPathBlock`, `pathBlockBody`: `~/.local/bin` cho claude và thư mục của node mà launcher/reaper
   dùng, `dirname(ctx.nodePath)`, ví dụ `/opt/homebrew/bin`, để sshd agent chạy được `node <bundle crew-docs>` và hook
   pre-commit; thư mục đã có trong PATH mặc định thì không thêm; ghi lại cả khối nên chạy lại không nhân đôi), wrapper `~/.crew/bin/crew-claude-run` chép từ `apps/crew-mac/assets/crew-claude-run.sh`
   (`WRAPPER_SOURCE`, mode 755), launcher `~/.crew/bin/crew-mac` gọi node và `cli.js` đã cài, thiếu một trong hai thì thoát 127 (`renderLauncher`, mode
   755; đường dẫn ổn định mà phía server gọi `crew-mac stop-run` qua SSH); ghi plist `com.2p.crew-mac-sshd` (`renderPlist`) và nạp bằng `ensureService`;
   ghi plist `com.2p.crew-mac-reaper` (`reaperPlistSpec`, chạy `crew-mac reap` mỗi 60 giây) và nạp bằng
   `ensureService`; ghi `~/.crew-mac/manifest.json`. Chế độ app (`sshdOwner: 'app'`) bỏ bước plist sshd, xem
   "Chủ sshd agent". Mọi file ghi qua `writeIfChanged`, nên chạy lại không đổi gì;
   đường dẫn là symlink (dotfiles của owner) thì ghi vào file đích và giữ symlink, file có sẵn của owner
   (`~/.zshenv`, `authorized_keys`) giữ mode cũ. `~/.zshenv` có dòng mở khối PATH mà thiếu dòng đóng thì dừng trước
   khi ghi gì, yêu cầu owner sửa tay. Trước mọi file khác, `installSuperpowersPin` (flow `mac-workflows`) copy bản
   Superpowers owner đã cài vào `~/.crew/workflows/superpowers/<version>-<rev12>`; owner chưa cài đúng bản ghim thì
   dừng với `SetupError` khi máy còn nguyên. Ngay sau đó `installBmadPin` lắp bản ghim BMAD vào
   `~/.crew/workflows/bmad/<version>-<rev12>` (có sẵn đúng checksum thì không gọi git); không lấy được thì `SetupError`
   khi Superpowers đã ghim nhưng chưa ghi file nào khác. `SetupReport.superpowers` và `SetupReport.bmad` trả thư mục
   ghim và `extraArgs` cho agent thường và agent vai bmad. Cuối `setup` gọi `gcAfterInstall` dọn bản ghim cũ không còn run dùng (flow `mac-workflows`, mục "Pin theo run và dọn bản cũ"); lỗi dọn chỉ in một dòng, không làm hỏng setup.
3. `apps/crew-mac/src/commands/doctor.ts` → `doctor`: Tailscale, sshd agent theo chủ (`checkSshdService` cho
   LaunchAgent, `checkAppSshd` cho app) ngay sau đó là `tcc-owner` (`checkTccOwner`), cổng sshd, LaunchAgent reaper (`checkReaper`),
   PATH (`checkZshenv`, id `zshenv-path`: khối có đúng `~/.local/bin` và thư mục node hiện tại), wrapper, node trong
   PATH của sshd agent (`checkAgentNode`, id `agent-node`: `command -v node` qua chính sshd agent, `fail` kèm gợi ý chạy
   lại setup), uv trong PATH của sshd agent (`checkAgentUv`, id `agent-uv`: `command -v uv` qua chính sshd agent, agent
   BMAD chạy `setup.py` bằng `uv run`; thiếu uv thì `fail` khi máy đã có agent BMAD (`hasBmadAgent`: worktree cấp 1 nào
   đó có `_bmad`, hoặc thư mục ghim BMAD nào đó còn dấu `.in_use`), `warn` khi chưa có (`setup` không cài uv; cài trước
   khi dựng agent BMAD), cả hai kèm lệnh `cài uv: curl -LsSf https://astral.sh/uv/install.sh | sh`), launcher (`checkLauncher`: có, chạy được, còn trỏ tới node và `cli.js` tồn tại), Superpowers ghim
   (`checkSuperpowersPin`, id `superpowers-pin`: thư mục ghim có, không phải symlink, đúng checksum, file trong
   `executables` có bit thực thi, không thì `fail`; bản owner đang cài trong `installed_plugins.json` khác bản ghim
   thì `warn`), BMAD ghim (`checkBmadPin`, id `bmad-pin`, tiêu đề `BMAD <version> đã ghim`: thiếu, lệch checksum hay
   thiếu bit thực thi thì `fail` kèm `crew-mac workflows install`), wrapper (`checkWrapper`: có,
   chạy được qua sshd agent, giống bản trong repo), thư mục worktree, nguồn skill của từng worktree
   (`checkWorktreeWorkflows`, id `worktree-workflows`: `discoverSources` của flow `mac-workflows` cho mỗi worktree cấp 1,
   bỏ thư mục chấm, theo workflow của run gần nhất trong worktree đó (`lastRunWorkflow`, dấu do `workflow-check` ghi),
   chưa có dấu thì theo Superpowers; dừng ngay sau lần git quá hạn đầu tiên và có trần tổng 60 giây, kèm dòng "dừng kiểm các worktree còn lại"; `fail` khi worktree nào sẽ làm run thoát 78, `warn` khi chỉ có cảnh báo, hint là lệnh xử lý), `crew-docs` (`checkCrewDocs`: dừng ngay sau lần quá hạn đầu tiên (đọc config hay `--version`) và có trần tổng 60 giây; mỗi worktree cấp 1 dưới thư mục worktree, kể cả symlink, có `docs/flows.yaml` thì chạy qua chính
   sshd agent, giống `checkWrapper`, để bắt treo TCC: đọc `crew-docs.bundle`, `crew-docs.runtime` và git dir bằng `git config`, rồi chạy
   `node <bundle> --version` (node theo PATH của agent, hợp đồng của integrator với `check --range`) và
   `ELECTRON_RUN_AS_NODE=1 <runtime> <bundle> --version` (hook pre-commit của executor); kết quả cache theo cặp runtime/bundle, mỗi lệnh có timeout 30/20 giây
   và quá hạn thì báo rõ có thể do hộp thoại quyền; `fail` khi bundle, runtime hoặc git dir nằm dưới `~/Documents`, `~/Desktop`, `~/Downloads`,
   `/Volumes` (`tccProtectedReason`); `node … --version` mã 127 thì báo `node không có trong PATH của sshd agent` và
   gợi ý chạy lại setup (gợi ý dời bundle chỉ khi có vấn đề vùng TCC hay quá hạn, gợi ý `install-hooks` chỉ khi thiếu hoặc
   hỏng `crew-docs.bundle`/`runtime`); không đọc được thư mục worktree thì `warn`, chưa có thư mục thì `warn`; không worktree nào dùng crew-docs thì bỏ qua),
   `claude auth status` qua chính sshd agent (`sshArgs`, `-F /dev/null`, key doctor), phép thử `claude -p` trong git
   repo tạm, chạy trong process group riêng và `SIGKILL` cả group khi quá hạn hoặc khi xong (`printProbeScript`),
   hộp thoại TCC đang chờ (`/usr/bin/log show --last <window>`, `parsePendingTccPrompts`, `tccHint`; doctor luôn dùng cửa sổ 24 giờ; dòng log lệch định dạng thì
   cảnh báo; chỉ `fail` khi hộp thoại thuộc agent, xem `isAgentTccSubject`: subject là claude/node, `identifier=com.anthropic.claude-code` trong cùng dòng log, hoặc subject/identifier là bundle app `com.2p-solutions.crew.mac` vì app là responsible process của run), tải máy (`parseLoad`; số liệu không đọc được thì cảnh báo; gọi `/usr/sbin/sysctl` và `/usr/bin/memory_pressure` bằng đường dẫn tuyệt đối).
4. `apps/crew-mac/src/commands/uninstall.ts` → `uninstall`: bootout và xóa plist crew-mac lẫn spike
   (`com.2p.crew-spike-sshd`), gỡ key theo comment, gỡ khối PATH và hai dòng PATH spike, xóa `~/.crew-mac` và
   `~/.crew-spike-sshd`, wrapper và launcher (và `~/.crew/bin` nếu rỗng). Không đụng phần còn lại của `~/.crew` (của `crewd` v2).
   Giữ nguyên thư mục worktree. Kiểm theo hướng fail-closed (`scanUninstallBlockers`), từ chối khi còn: `claude`/`node --print` có `PAPERCLIP_RUN_ID`
   (run Paperclip đang chạy), claude/node `--print` không tty mà `ps -E` thật sự không trả được env (`ProcInfo.envReadable`; không chắc; `node -p "<expr>"` và claude nền đọc được env mà không có run id thì không chặn), con cháu của sshd agent
   (phiên SSH đang mở, không phụ thuộc env; sshd agent là job launchd, hoặc listener của app tìm theo
   `~/.crew-mac/sshd/sshd.pid` khi argv đúng listener của crew-mac), hoặc không đọc được bảng process. Chế độ app thì
   không bootout `com.2p.crew-mac-sshd`, không đụng listener của app, và báo thêm dòng "sshd do app 2P Crew giữ: thoát
   app để dừng" (`UninstallReport.notes`). `--force` bỏ qua CẢ hai kiểm: phiên sshd của
   chính lệnh uninstall lẫn kiểm run Paperclip. Giữa lúc kiểm và lúc bootout còn một khe ngắn (vài giây) Paperclip có thể giao
   run mới: nên tạm dừng agent trên Paperclip trước khi uninstall.

## Chủ sshd agent

`manifest.json` có trường tùy chọn `sshdOwner` (`'launchd' | 'app'`, không có = `launchd`; `version` vẫn 1).

| Chế độ | Ai sinh listener cổng 2222 | `setup` | `doctor` `sshd-agent` | `doctor` `tcc-owner` |
|---|---|---|---|---|
| `launchd` | LaunchAgent `com.2p.crew-mac-sshd` | ghi plist, `ensureService` như cũ | job đang chạy | `warn`: quyền macOS gắn theo bản Claude |
| `app` | app 2P Crew (process con của app, `/usr/sbin/sshd -D -f ~/.crew-mac/sshd/sshd_config`) | không ghi plist sshd; bootout job nếu đang nạp, xóa plist; không tự sinh sshd | pidfile sống, argv đúng, cha là `…/2P Crew.app/Contents/MacOS/…` | `ok` khi cha là app |

- `setup` không cờ giữ chủ trong manifest (cài mới: `launchd`), để không bao giờ có hai chủ một cổng. Chỉ
  `--sshd-owner` mới đổi (`resolveSshdOwner`). `SetupReport.sshdHandoff` là `app`, `launchd` hoặc `unchanged`.
- Đổi chủ (cả hai chiều) dùng `assertNoLiveRuns` của `uninstall`: còn run Paperclip, phiên SSH qua sshd agent hay
  process không chắc thì `SetupError`, trừ `--force`. `cli.ts` từ chối thêm khi lệnh chạy qua chính sshd agent
  (`SSH_CONNECTION` trỏ cổng agent), mã 2, trừ `--force`.
- Sang app: thứ tự là ghi manifest `app` → xóa plist sshd → bootout (chỉ khi job đang nạp) → kiểm lại
  `launchctl print` thấy job đã gỡ (`handOffToApp`; bootout báo thành công mà job còn thì chờ thêm tối đa 2 giây).
  Job vẫn nạp (vẫn giữ cổng) thì trả plist và manifest về đúng bytes cũ, ném `SetupError` nêu label: chủ cũ
  (LaunchAgent) giữ nguyên, không có manifest `app` khi LaunchAgent còn giữ cổng. Lý do thứ tự (tiến trình gọi, ví dụ
  utilityProcess của app, chết giữa chừng):
  - chết sau khi ghi manifest: manifest `app`, LaunchAgent còn chạy và giữ cổng; app mở lại thấy `app` nhưng cổng bận.
    Lần chạy sau (wizard chạy lại, `crew-mac setup` không cờ vì chủ đọc từ manifest là `app`) gỡ nốt job.
  - chết sau khi xóa plist: như trên, thêm: khởi động lại máy thì launchd không nạp lại job (chỉ còn app).
  - chết sau bootout: chỉ còn app, đúng trạng thái đích.
  Không bước nào để lại "cổng trống mà manifest nói `launchd`" (app mở lại sẽ `disabled`). `setup --sshd-owner launchd`
  từ mọi trạng thái giữa chừng về đúng một chủ launchd. Test `setup.test.ts` dựng lại trạng thái sau từng bước.
- Về launchd: kiểm cổng TRƯỚC khi ghi manifest (`prepareTakeBack`). pid trong `~/.crew-mac/sshd/sshd.pid` là listener
  của crew-mac (`isCrewListener`: đầu là `/usr/sbin/sshd` hoặc tiêu đề sshd đã đổi `sshd: /usr/sbin/sshd …`, có
  `-f <sshd_config>`, không phải `sshd-session`; app 2P Crew dùng lại đúng hàm này) thì ghi manifest `launchd` (app thấy
  và tự dừng listener) rồi `takeBackToLaunchd` chờ tối đa 15 giây cho pid thoát; còn sống thì TERM rồi chờ nhả cổng.
  Không có pidfile hay pid đã chết thì ghi manifest và nạp luôn. pidfile trỏ process lạ (pid bị dùng lại, hay
  `sshd-session`) thì không phải listener của mình: hỏi `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`; cổng trống thì ghi
  manifest và nạp LaunchAgent luôn; cổng bị process khác giữ hoặc `lsof` lỗi thì `SetupError` khi manifest còn là
  `app` (chạy lại vẫn dừng ở đây tới khi cổng trống), nên không bao giờ ra hai chủ hay cổng trống mà manifest nói có
  chủ. `lsof` chạy bằng user thường chỉ thấy socket của user này. Không bao giờ gửi tín hiệu cho `sshd-session`. Sau đó
  ghi plist và bootstrap như cũ (bootstrap lỗi thì manifest `launchd` + plist còn, lần chạy lại bootstrap tiếp).
- Chế độ app mà đổi cổng hoặc IP Tailscale (`setup --port …`, hay IP đổi rồi chạy lại `setup`): `setup` ghi lại
  `sshd_config` và manifest, không bootout gì; app đang mở thấy manifest đổi thì nạp lại cấu hình (dừng listener cũ,
  sinh lại; phiên SSH đang chạy giữ nguyên, phần app ở flow `mac-app-sshd`). CLI in đúng điều này, và in thêm dòng
  "Cấu hình sshd đã đổi sang <IP>:<cổng>" khi lần chạy đó đổi `sshd_config`.
- `doctor` chế độ app (`probeListener`): job launchd sshd vẫn nạp thì `fail` (hai chủ); không có listener hay pid lạ
  thì `fail`, gợi ý "Mở 2P Crew"; listener mồ côi (cha là launchd pid 1: app đã thoát hoặc crash) thì `warn`; cha
  khác thì `warn` nêu tên cha.
- `tcc-owner` kiểm theo chuỗi cha vì Node không gọi được `responsibility_get_pid_responsible_for_pid`; chuỗi cha khớp
  responsible thật khi app còn sống. Khi app đã chết, hàm hệ thống đó trả chính pid của listener nhưng tccd vẫn gán
  quyền theo bundle app đã lưu (đo ngày 09/10/2026), nên listener mồ côi là `warn` có giải thích, không `fail`.
- App 2P Crew gọi `setup({ sshdOwner: 'app' })` / `setup({ sshdOwner: 'launchd' })` qua `@crew/mac` (kiểu
  `SshdOwner` export từ `index.ts`), chỉ khi 0 run. Bộ giám sát sshd của app (flow `mac-app-sshd`) dùng thêm
  `readSshdPid` (đọc pidfile), `createRunner` và kiểu `CommandRunner` (chạy `ps`/`lsof`) export từ `index.ts`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/crew-mac/src/cli.ts` | CLI (lệnh `files` chuyển sang flow `mac-attachments`; `workflows`, `bmad` sang flow `mac-workflows`) | `main`, `USAGE`, `sshServerPort` |
| `apps/crew-mac/src/system.ts` | Chạy lệnh có giới hạn thời gian (SIGKILL), thêm biến môi trường (`RunOptions.env`), quote đối số shell | `createRunner`, `CommandRunner`, `shQuote` |
| `apps/crew-mac/src/context.ts` | Context và lỗi | `MacContext` (kể cả `superpowersPin`, `bmadPin`), `SetupError` |
| `apps/crew-mac/src/context-factory.ts` | Dựng `MacContext` dùng chung cho CLI và app (`cliPath` do người gọi truyền) | `createMacContext` (pin CLI: `SUPERPOWERS_PIN`, `BMAD_PIN`), `stableNodePath` |
| `apps/crew-mac/src/index.ts` | Entry thư viện: app 2P Crew import `@crew/mac` (`exports` trỏ `dist/index.js`, kèm `.d.ts`) | các hàm và kiểu của `setup`, `doctor`, `uninstall`, `status`, `stopRun`, `workflowCheck`, `workflowsCommand`, sổ và bản ghim workflow (`certifiedWorkflows`, `workflowForPluginDir`, `pinDir`, `SUPERPOWERS_PIN`, `BMAD_PIN`, `installBmadPin`), BMAD (`bmadCommand`, `parseEpics`, `checkBmadAnswers`, `setupProject`), `filesCommand` và kiểu `RunManifest`/`ManifestFile` (flow `mac-attachments`), reaper, manifest, paths |
| `apps/crew-mac/src/paths.ts` | Label, comment key, đường dẫn (kể cả `workflowsRoot` = `~/.crew/workflows` và `appState` = `~/Library/Application Support/2P Crew/app.json`, file của app, crew-mac chỉ đọc; `crewMacDir` = `~/.crew/app/crew-mac`) | `macPaths`, `forbiddenRootReason`, `rootGuardReason` (giới hạn `--root` của `stop-run` và worktree của reaper) |
| `apps/crew-mac/src/fs-util.ts` | Ghi file atomic, chỉ khi đổi | `writeIfChanged`, `readText` |
| `apps/crew-mac/src/manifest.ts` | Trạng thái cài đặt (kể cả `sshdOwner` tùy chọn) | `readManifest`, `writeManifest` |
| `apps/crew-mac/src/sshd-owner.ts` | Chủ sshd agent: chuyển sang app, trả về LaunchAgent, đọc listener theo pidfile | `SshdOwner`, `resolveSshdOwner`, `handOffToApp`, `prepareTakeBack`, `takeBackToLaunchd`, `probeListener`, `isCrewListener`, `APP_BUNDLE_ID` |
| `apps/crew-mac/src/zshenv.ts` | Khối PATH | `upsertPathBlock`, `pathBlockBody`, `hasPathBlock`, `removePathBlock`, `removeSpikePathLines` |
| `apps/crew-mac/src/authorized-keys.ts` | Dòng key | `parsePublicKey`, `upsertKey`, `removeKeysByComment` |
| `apps/crew-mac/src/plist.ts` | Plist LaunchAgent | `renderPlist` |
| `apps/crew-mac/src/sshd-config.ts` | Cấu hình sshd | `renderSshdConfig` |
| `apps/crew-mac/src/launchctl.ts` | Bọc `launchctl` | `serviceState`, `bootstrap`, `bootout`, `guiSessionAvailable` |
| `apps/crew-mac/src/tailscale.ts` | IP Tailscale: thử `tailscale` theo PATH, `/usr/local/bin/tailscale`, `/opt/homebrew/bin/tailscale`, rồi file trong app; luôn đặt `TAILSCALE_BE_CLI=1` vì dưới launchd (PATH `/usr/bin:/bin:/usr/sbin:/sbin`) file GUI trong app nếu không có biến này sẽ mở GUI, thoát mã 0 và không in IP (từng làm trang Crew báo "Lỗi: Tailscale" dù doctor trong Terminal đạt) | `tailscaleIpv4` |
| `apps/crew-mac/src/wrapper.ts` | Đường dẫn nguồn wrapper | `WRAPPER_SOURCE` |
| `apps/crew-mac/src/launcher.ts` | Script `~/.crew/bin/crew-mac` | `renderLauncher`, `parseLauncher` |
| `apps/crew-mac/src/install-cli.ts` | Cài bản `crew-mac` app mang theo vào `~/.crew/app/crew-mac` | `installCrewMacFrom`, `InstallCrewMacResult` |
| `apps/crew-mac/assets/crew-claude-run.sh` | Wrapper `claude` cho agent: với run Paperclip, đòi đúng một `--plugin-dir` (thư mục ghim của một workflow đã chứng nhận; khác thì `crew-workflow blocked: cần đúng một --plugin-dir (bản workflow đã ghim) trong adapterConfig.extraArgs, có <n>; chạy "crew-mac workflows list" để xem giá trị`) và gọi `crew-mac workflow-check` (từ chối thì thoát 78, không chạy agent; flow `mac-workflows`), ghi `pgid`, `started` của run, ghi dấu `<plugin_dir>/.in_use/<runId>` (`<pid> <started>`; lỗi ghi không chặn run) rồi `exec claude`. Đây là bản nguồn; fork Paperclip giữ bản sao ở `server/src/__tests__/fixtures/crew-claude-run.sh` cho test của hook phía server | — |
| `apps/crew-mac/src/commands/setup.ts` | Lệnh setup | `setup`, `SetupOptions` (`sshdOwner`, `force`), `SetupReport` (`sshdHandoff`), `ensureService`, `sshdPlistSpec`, `reaperPlistSpec`, `KEY_OPTIONS` |
| `apps/crew-mac/src/commands/doctor.ts` | Lệnh doctor | `doctor`, `checkAppSshd`, `checkTccOwner`, `checkZshenv`, `checkAgentNode`, `checkWrapper`, `checkLauncher`, `checkSuperpowersPin`, `checkWorktreeWorkflows`, `checkReaper`, `checkCrewDocs`, `parsePendingTccPrompts`, `printProbeScript` |
| `apps/crew-mac/src/commands/uninstall.ts` | Lệnh uninstall | `uninstall`, `scanUninstallBlockers`, `assertNoLiveRuns` (setup dùng khi đổi chủ sshd) |
| `apps/crew-mac/src/commands/status.ts` | Cấu hình, Keychain và gửi webhook | `configureStatus`, `setStatusSecret`, `sendStatus` |
| `apps/crew-mac/src/status/sign.ts` | Ký raw body | `signCrewBody` |
| `apps/crew-mac/src/status/report.ts` | Thu bản tin máy v1 (kèm trường `app` tùy chọn) | `buildMachineReport`, `MachineReport` |
| `apps/crew-mac/src/status/app-state.ts` | Đọc ba trường `appVersion`, `sshdOwner`, `updateState` từ `app.json` của app (chỉ đọc) | `readAppState`, `AppReport`, `UPDATE_STATES` |
| `apps/crew-mac/src/status/tcc.ts` | Probe TCC nối tiếp riêng cho status; checkpoint `~/.crew/status-tcc.json` (0600), lần đầu quét 2 giờ, các lần sau bắt đầu từ mốc đã quét trừ 5 giây theo giờ địa phương kèm offset mà `log show` yêu cầu; giữ `msgId` để ghép kết quả đến ở lượt sau; timeout 20 giây ở lần đầu vẫn ghi checkpoint rỗng và cảnh báo bắt đầu theo dõi, các lần sau giữ nguyên state và thêm cảnh báo | `probeStatusTcc`, `updateTccPending` |
| `apps/crew-mac/src/status/docs.ts` | Đọc docs tại commit, kiểm chuẩn và secret-scan | `snapshotCommit`, `buildDocsSnapshot`, `SCAN_MANIFEST` |

## Bản tin trạng thái máy

`setup` cài LaunchAgent `com.2p.crew-mac-status`, chạy `crew-mac status send` mỗi 60 giây.
Job ghi log vào `~/.crew/logs/status.log`; `uninstall` gỡ job và plist. `doctor` kiểm job đã nạp
và đọc lần gửi gần nhất từ `~/.crew/status-last.json` (`at`, `ok`, `httpStatus`).

`~/.crew/status.json` giữ `url`, `companyId` UUID, `machineId` UUID và đường dẫn tuyệt đối `claudePath` (không chứa secret). `setup` resolve Claude và cập nhật đường dẫn này nếu đã có cấu hình; `status config` cũng resolve khi tạo cấu hình. Khi cấu hình cũ chưa có đường dẫn, bản tin tìm Claude trong PATH rồi `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, nên job launchd với PATH tối thiểu vẫn chạy được. `companyId` bắt buộc khi gửi và
được đặt ngay sau `version` trong bản tin máy v1. Secret chỉ nằm trong Keychain với service
`crew-mac-status`, account `crew-mac`; lệnh `set-secret` đọc stdin. `setStatusSecret` không đưa secret lên argv: chạy
`security -i` (argv chỉ có `-i`) và ghi lệnh `add-generic-password -U -s crew-mac-status -a crew-mac -w "<secret>"` vào
stdin; trong nháy kép, `\` và `"` được thoát bằng gạch chéo ngược (đã thử trên Keychain thật với mục thử, gồm `$`,
`` ` ``, `'`, `#`, dấu cách, gạch chéo cuối chuỗi, ngày 09/10/2026). Secret một dòng (có `\n`/`\r` thì từ chối). Không
ghi secret vào file hoặc log.

`send` dùng các check của `doctor` để lấy tải máy, Claude và Superpowers, nhưng bỏ qua probe TCC dài của doctor. Probe TCC status riêng dùng `~/.crew/status-tcc.json` với quyền `0600`: lần đầu quét `--last 2h`, sau đó quét `--start` từ `scannedUntil` trừ 5 giây theo giờ địa phương, kèm offset múi giờ theo định dạng `/usr/bin/log` yêu cầu. State giữ `scannedUntil` và pending gồm `service`, `client`, `since` cùng `msgId` để ghép `AUTHREQ_RESULT` ở lượt sau; payload chỉ gửi ba trường nghiệp vụ, không gửi `msgId`. Timeout sau 20 giây ở lượt đầu vẫn ghi checkpoint với mốc bắt đầu lượt và pending rỗng, trả check `tcc-probe` trạng thái `warn`, tiêu đề `Bắt đầu theo dõi log TCC từ <giờ địa phương HH:MM>; hộp thoại cũ hơn xem bằng crew-mac doctor`. Timeout các lượt sau giữ nguyên state và thêm check `tcc-probe` trạng thái `warn`, tiêu đề `Không đọc kịp log TCC`; không cập nhật mốc. Doctor tương tác vẫn quét 24 giờ như trước. Các probe không đọc được khác trả `null` ở trường cho phép theo hợp đồng webhook, vẫn gửi bản tin. Bản tin máy và ảnh chụp docs được gửi độc lập; một bên lỗi không chặn bên kia nhưng job trả lỗi.
chỉ gửi `id`, `status` và `title` của từng check. JSON tối đa 16 KB, ký HMAC-SHA256 trên
`<timestamp>.<raw body>` trong header `X-Crew-Signature`, với `X-Crew-Timestamp` là giây Unix.
Gửi tới `{url}/api/plugins/crew.core/webhooks/machine-status` qua POST, hạn chờ 10 giây. Mọi mã HTTP ngoài
2xx là thất bại; `status-last.json` ghi `{at, ok: false, httpStatus}` khi server từ chối.

### Trường `app` (phiên bản app 2P Crew)

Nếu `~/Library/Application Support/2P Crew/app.json` (`macPaths().appState`) đọc được và hợp lệ, bản tin máy có thêm
`"app": { "version", "sshdOwner", "updateState" }`, lấy từ `appVersion`, `sshdOwner`, `updateState` của file. `version`
là semver ≤ 32 ký tự, `sshdOwner` là `app` hoặc `launchd`, `updateState` thuộc `idle`, `downloading`, `waiting-idle`,
`installing`, `probation`, `rolled-back`. File thiếu, JSON hỏng hay giá trị lạ thì bản tin không có key `app` (không
lỗi), `version` bản tin vẫn là 1. crew-mac chỉ đọc file này, không bao giờ ghi vào thư mục của app. Plugin phía server
từ chối (502) khi trường `app` có mà sai dạng, nên chỉ máy đã chạy app mới gửi trường này, sau khi plugin đã được
triển khai bản nhận trường `app`.

### Trường `attachmentCache` (dung lượng cache file đính kèm)

Bản tin máy có thêm `"attachmentCache": { "bytes", "blobBytes", "blobs", "runs", "limitBytes", "measuredAt" }` do
`attachmentCacheStats` (`src/files/stats.ts`) đo trên `~/.crew/cache/attachments`: `bytes` là tổng byte mọi file,
`blobBytes` là byte trong `blobs/` (kể cả `.part`) để so với `limitBytes` (`CACHE_MAX_BYTES`), `blobs` là số blob tên
sha256, `runs` là số thư mục run. Không có cache, đo quá 2 giây hoặc lỗi đọc thì bản tin không có key này (không lỗi).
Plugin cũ chưa biết key này sẽ từ chối (502) cả bản tin, nên plugin R2-5 phải lên prod trước khi cài crew-mac có
trường này. `version` bản tin vẫn là 1.

## Cài bản mang theo của app

`installCrewMacFrom(ctx, srcDir)` (export từ `@crew/mac`) cài gói `crew-mac` đã build mà app mang trong bundle
(`srcDir` có `package.json`, `dist/**`, `assets/**`; app truyền `process.resourcesPath + '/crew-mac'`) vào
`~/.crew/app/crew-mac`. Trả `{ installed, version, backup, reason? }`.

- Kiểm trước: `package.json` có `version` và có `dist/cli.js`, thiếu thì ném `SetupError`, không đổi gì.
- Nội dung (băm cả cây, kể cả bit thực thi) giống hệt bản đang cài thì `installed: false`, chỉ bảo đảm launcher đúng.
- Còn run đang chạy (dùng lại `assertNoLiveRuns`) thì `installed: false` kèm `reason` "còn run đang chạy", không đổi gì.
- Cài: chép sang `crew-mac.new`, xóa `crew-mac.prev` cũ, đổi `crew-mac` thành `crew-mac.prev`, đổi `crew-mac.new`
  thành `crew-mac` (hai lần `rename`, mỗi lần atomic). Lỗi giữa chừng thì trả bản cũ về `crew-mac`. Chỉ giữ một bản lui.
- Giới hạn: cả cú đổi không atomic tuyệt đối. Giữa hai `rename` có một kẽ (micro giây) `~/.crew/app/crew-mac` vắng;
  job reaper/status chạy đúng lúc đó lỗi một nhịp (60 giây sau chạy lại bình thường), run không bị ảnh hưởng vì đã từ
  chối khi còn run. Muốn atomic tuyệt đối phải đổi `crew-mac` thành symlink tới thư mục theo bản (đổi symlink bằng một
  `rename`) hoặc dùng `renamex_np(RENAME_SWAP)` mà Node không có; chưa làm vì đổi bố cục `~/.crew/app` và đường lui.
- Sau cùng viết lại launcher `~/.crew/bin/crew-mac` trỏ `~/.crew/app/crew-mac/dist/cli.js` (node theo `ctx.nodePath`).
  Hàm không chạy lại `setup`; app gọi `setup` riêng khi cần.

## Ảnh chụp docs

`~/.crew/status-repos.json` lưu danh sách `{projectId, path, lastCommit, format?}` với quyền `0600`. `format` thiếu hoặc bằng `2`, giá trị khác thì `listStatusRepos` ném `Danh sách repo không hợp lệ`. `projectId` phải là UUID;
`path` là đường dẫn tuyệt đối tới repo git. Trong cùng lượt gửi, `status send` xét từng repo. Nó fetch `origin`
tối đa 20 giây rồi ưu tiên commit `origin/HEAD`; fetch lỗi thì dùng ref sẵn có và chỉ log cảnh báo kèm `projectId`.
Nếu thiếu ref này, nó dùng nhánh cục bộ `main`, rồi `master`, cuối cùng
`HEAD`. Vì vậy repo chỉ có nhánh khác cần đặt `origin/HEAD` để chọn đúng nhánh mặc định.

Khi commit khác `lastCommit` (hoặc repo chưa có `format: 2`, xem cuối mục), lệnh dựng ảnh chụp từ mọi file `.md` dưới `docs/` ở commit đó bằng git, không đọc
working tree. Git worktree và repo secret-scan trong thư mục tạm `crew-mac-docs-*` được xóa sau mỗi lần dựng ảnh chụp. `buildDocsSnapshot`, `scrubCommitPaths` và `removeOwnTempDir` nhận thêm `tmpRoot` (mặc định `tmpdir()`) để test dựng trong thư mục tạm riêng, không dính thư mục `crew-mac-docs-*` của test chạy song song.
Một git worktree tạm detached được dùng để chạy `crew-docs check --all`; kết quả 0/1/2–3 lần lượt
thành `auditState` `verified`/`invalid`/`unverified`. Lệnh lấy bundle từ git config `crew-docs.bundle` của repo.
Repo secret-scan dùng `SCAN_MANIFEST` (`docs/flows.yaml` mẫu có `source` theo schema hiện hành của docs-kit, vì R1 từ chối manifest thiếu `source`). Bundle cũ chạy thêm R2/R4 ở `check --staged` nên exit 1 vẫn hợp lệ: chỉ dòng `R7` quyết định trang nào bị bỏ, và dòng `R1` nghĩa là bước quét không chạy được nên ném lỗi, không gửi ảnh chụp. Nhờ vậy ảnh chụp không phụ thuộc phiên bản bundle gán cho repo.

Chỉ Git blob file thường mode `100644`/`100755` được đưa vào ảnh chụp; symlink và submodule bị bỏ. Mỗi trang được rà secret bằng luật R7 của `crew-docs`, gồm nội dung và metadata sẽ gửi (đường dẫn, title, tên repo). Nếu tên repo bị phát hiện, không gửi ảnh chụp và chỉ log lỗi theo project ID. Trang có metadata bị phát hiện được bỏ khỏi `pages`, ghi `{"path":"<đã che>","reason":"secret-scan-metadata"}` trong `dropped`. Trang chỉ có nội dung bị phát hiện được bỏ khỏi `pages`, ghi đường dẫn
và lý do `secret-scan` vào `dropped`. File Markdown có byte NUL cũng bị bỏ vì Git coi là binary và R7 không quét
được các dòng của nó. Bản tin chứa title, nội dung, SHA-256, `parentPath` là thư mục cha (kể cả `docs` cho file ngay dưới `docs/`) và trạng thái link Markdown
tương đối (`ok`, `missing`, `external`, `unverified`).

Body mang `format: 2` và thêm hai trường tùy chọn (`version` vẫn là `1`, server cũ coi như Mac cũ):

- `manifest`: nội dung `docs/flows.yaml` ở commit đó (chỉ blob thường `100644`/`100755`), tính `sha256` trên UTF-8 của
  `text`. Ba trạng thái: `present` (`text` tối đa 512 KiB), `absent` (không có file), `dropped` với lý do `too-large`
  (quá 512 KiB hoặc có byte NUL) hoặc `secret-scan`. Văn bản được quét R7 cùng repo secret-scan, ghi dưới tên tạm
  `docs/scan-flows-yaml.md` vì `docs/flows.yaml` là manifest mẫu `SCAN_MANIFEST` của repo quét. Manifest không vào `pages`
  hay `dropped`.
- `commits`: `{base, truncated, items}` lấy bằng `git rev-list --parents`, mới nhất trước, tối đa 200 commit. Mỗi item là
  `{sha, merge, paths}`: `paths` lấy từ `git diff-tree -r -z --root` (commit gốc có đủ file), tối đa 500 path, mỗi path
  tối đa 1024 ký tự, path chứa ký tự điều khiển bị bỏ; merge commit có `paths` rỗng. Mọi path còn được quét R7 (một path
  mỗi dòng của file tạm) và path bị phát hiện bị bỏ. Vượt 200 commit hoặc 500 path thì `truncated: true`. `base` là
  `formatCommit` (commit gửi gần nhất ở định dạng 2) khi nó còn là tổ tiên của commit mới
  (`git merge-base --is-ancestor`); ngược lại (lần đầu, force-push) `base` là `null` và lấy 200 commit gần nhất.

Repo ghi từ bản cũ chưa có `format` được gửi lại một lần dù commit không đổi; gửi xong, `status-repos.json` ghi
`format: 2`, `lastCommit` và `formatCommit` (cùng commit đó). Chỉ coi repo đã gửi định dạng 2 khi `formatCommit` bằng
`lastCommit`: `crew-mac` bản cũ chép nguyên item và chỉ dời `lastCommit`, nên sau khi hạ cấp rồi nâng lại, hai giá trị lệch
nhau và lệnh gửi lại một lần, kèm các commit tính từ `formatCommit`.

Plugin R2-5 phải lên prod trước khi cài `crew-mac` mới. Webhook docs cũ không từ chối khóa lạ: nó bỏ qua
`format/manifest/commits` mà vẫn trả 200, nên Mac ghi `format: 2` và không gửi lại, làm mất manifest và danh sách commit
của commit đó cho tới commit sau. Bản tin máy thì khác: plugin cũ từ chối cả bản tin có key `attachmentCache`.

Body JSON tối đa 5 MB. Nếu body đầy đủ vượt, lệnh gửi lại với mọi `paths` rỗng và `commits.truncated: true`. Nếu vẫn vượt, hoặc HTTP khác 2xx, hoặc xử lý thất bại, lệnh giữ `lastCommit` cũ để lần sau
thử lại. Khi POST `docs-snapshot` thành công, nó mới cập nhật commit đã gửi. Bản tin dùng cùng secret Keychain và
cùng quy tắc HMAC với bản tin máy. Lệnh chỉ cảnh báo số trang bị bỏ, không ghi nội dung hay chuỗi bí mật ra log.

## Dữ liệu

- File trên Mac: `~/.crew-mac/` (manifest, sshd config, host key, key doctor, known_hosts),
  `~/Library/LaunchAgents/com.2p.crew-mac-sshd.plist`, `~/Library/LaunchAgents/com.2p.crew-mac-reaper.plist`, khối `# >>> crew-mac path >>>` trong `~/.zshenv`, dòng key
  `crew-mac-paperclip` và `crew-mac-doctor` trong `~/.ssh/authorized_keys`, wrapper `~/.crew/bin/crew-claude-run`,
  launcher `~/.crew/bin/crew-mac`, bản Superpowers ghim `~/.crew/workflows/superpowers/<version>-<rev12>` và bản BMAD
  ghim `~/.crew/workflows/bmad/<version>-<rev12>` (uninstall để nguyên, vô hại), thư mục worktree (mặc định `~/crew-agents`).
- Wrapper ghi `<worktree>/.paperclip-runtime/runs/<runId>/pgid` và `started` cho mỗi run. `started` là thời điểm
  SINH của process wrapper (epoch giây), không phải lúc wrapper chạy, để profile chậm của owner không làm lệch.
  `crew-mac stop-run` và reaper đọc hai file này (flow `mac-orphan-reaper`).
- Gọi ngoài: `/usr/bin/git` (đọc `crew-docs.bundle`; `cat-file`/`archive` marketplace `bmad`, hoặc `clone` https khi
  lắp bản ghim BMAD), `/usr/bin/tar`, `launchctl`, `ssh-keygen`, `ssh`, `nc`, `tailscale`, `/usr/bin/log`, `/bin/ps`, `/usr/sbin/sysctl`, `/usr/bin/memory_pressure`, `claude`.
- Chỉ đọc (không ghi) `~/.claude/plugins/installed_plugins.json`, cây plugin Superpowers owner đã cài để copy bản
  ghim, và repo marketplace `~/.claude/plugins/marketplaces/bmad` (qua git) để lấy bản BMAD. Không đọc hay ghi phần khác của `~/.claude` hay Keychain.

## Lưu ý quyền macOS (TCC)

Quyền đọc vùng được bảo vệ gắn theo đường dẫn binary Claude (`~/.local/share/claude/versions/<bản>`). Mỗi lần Claude
Code tự cập nhật, macOS có thể hỏi lại; khi hộp thoại chưa được bấm thì mọi lần đọc vùng đó của agent treo im lặng.
R1 chỉ phát hiện (`doctor`, check `tcc-pending`) và chỉ chỗ bấm. `tcc-pending` chỉ `fail` khi hộp thoại thuộc `claude` (kể cả `…/claude/versions/<bản>`), `node` hoặc app 2P Crew (`com.2p-solutions.crew.mac`); hộp thoại của app khác chỉ `warn`. Chế độ app thì quyền gắn với bundle app một lần (check `tcc-owner`). Status dùng probe nối tiếp riêng để tránh đọc lại 24 giờ mỗi phút. Ký số app cố định quyền là việc của R2.

## Flow liên quan

- `mac-orphan-reaper`: LaunchAgent dọn process `claude --print` mồ côi do `setup` cài.
- `mac-attachments`: lệnh `crew-mac files` agent gọi để đọc file đính kèm (bridge, cache, nhận diện, manifest).
- `mac-workflows`: bản Superpowers và BMAD ghim mà `setup` (hoặc `workflows install`) cài và `doctor` kiểm; wrapper gọi
  `workflow-check` trước mỗi run.

## Tests

- `apps/crew-mac/test/sshd-owner.test.ts`: `resolveSshdOwner`, manifest có/không `sshdOwner` và giá trị lạ, `isCrewListener` (cả chuỗi thật `sshd: /usr/sbin/sshd … [listener] 0 of 10-100 startups`), `probeListener` (không pidfile, pid chết, pid lạ, listener sống kèm cha), `takeBackToLaunchd` (listener tự thoát thì không kill, mồ côi thì đúng một TERM, pid thành `sshd-session` thì trả về không kill, không pidfile thì không gọi `ps`).
- `apps/crew-mac/test/setup.test.ts`: chủ sshd (sang app: đúng một bootout, xóa plist, config và host key không đổi; chạy lại không đổi gì; còn run thì từ chối, `force` thì chạy; sang app: bootout lỗi mà job còn nạp thì `SetupError`, manifest và plist giữ nguyên; thứ tự manifest → xóa plist → bootout; chết sau từng bước thì wizard chạy lại, CLI không cờ hay CLI về launchd đều ra đúng một chủ; về launchd: dò pid khi manifest còn `app` rồi mới ghi `launchd`, không kill khi listener tự thoát, pid lạ mà cổng bị giữ hoặc `lsof` lỗi thì `SetupError` trước khi ghi manifest (chạy lại vẫn vậy), pid lạ mà cổng trống thì bootstrap, không pidfile thì bootstrap ngay), cài lần đầu (khối PATH có thư mục node), ghim Superpowers và trả `extraArgs`, owner chưa cài đúng bản thì dừng trước khi ghi gì, cài bản ghim BMAD từ marketplace và trả `extraArgs` vai bmad, BMAD có sẵn thì không gọi git, BMAD không lấy được thì `SetupError` sau khi Superpowers đã ghim, chạy lại không đổi gì, đổi cổng, từ chối thư mục bị cấm, thiếu phiên desktop, spike còn chạy, thiếu Tailscale.
- `apps/crew-mac/test/doctor.test.ts`: máy khỏe, `agent-node` (sshd agent không thấy node) và `zshenv-path` thiếu thư mục node, `crew-docs` node mã 127 thì gợi ý sửa PATH, `superpowers-pin` (thiếu, lệch checksum, symlink, mất bit thực thi, bản owner khác pin), `bmad-pin` (đạt, mất bit thực thi, lệch checksum, thiếu), `agent-uv` (không thấy uv: chưa có agent BMAD thì warn, có dấu `.in_use` BMAD hay worktree có `_bmad` thì fail, đều kèm lệnh cài; thấy thì đạt), `worktree-workflows` (worktree BMAD và executor cùng repo bật `bmad@bmad`: chưa có dấu thì cả hai đỏ, sau `workflowCheck` mỗi bên chỉ executor đỏ nạp chéo; sạch, `SKILL.md` sửa dở thì warn, `settings.json` sửa dở thì fail kèm lệnh, git quá hạn thì dừng), claude treo, check `crew-docs` (thiếu bundle/runtime, nằm dưới vùng TCC, quá hạn, dùng chung kết quả theo bundle, thư mục worktree lỗi thì warn, symlink), hộp thoại TCC của agent (fail, kể cả của app 2P Crew) và của app khác (warn), `isAgentTccSubject`, chủ sshd và `tcc-owner` (con của app thì đạt, mồ côi thì cảnh báo, cha khác, không listener thì fail, job launchd còn nạp ở chế độ app thì fail, chế độ LaunchAgent thì `tcc-owner` cảnh báo), chưa đăng nhập, IP đổi, quá tải.
- `apps/crew-mac/test/crew-claude-run.test.ts`: wrapper chỉ exec khi không có run id, bỏ qua run id sai dạng, ghi PGID và thời điểm bắt đầu (`started` là lúc process SINH, kiểm trong khoảng quanh lúc spawn thay cho sai số cố định và chờ file `pgid` thay vì ngủ cố định, để không chập chờn khi máy bận); với run id: gọi `workflow-check` đúng tham số, nhận `--plugin-dir=<dir>`, thiếu hoặc thừa `--plugin-dir`, `workflow-check` từ chối hoặc không có `crew-mac` thì thoát 78 mà không chạy agent (câu lỗi hai `--plugin-dir` đúng nguyên văn); dấu `.in_use/<runId>` có pid của `claude` và `started` của run, không ghi khi run id lạ, thư mục ghim chỉ đọc thì vẫn chạy agent.
- `apps/crew-mac/test/uninstall.test.ts`: gỡ phần spike rồi setup lại, gỡ đúng phần đã cài (giữ `~/.crew` của crewd), chạy lại không lỗi, từ chối khi còn run Paperclip hoặc không đọc được bảng process (`--force` bỏ qua), `claude -p` thủ công (có tty) không tính là run, env không đọc được, claude cài npm chạy dưới tên `node`, phiên sshd còn sống; chế độ app không bootout sshd, không kill listener, báo cách dừng, và phiên SSH dưới listener của app thì từ chối.
- `apps/crew-mac/test/index.test.ts`: thư viện export đủ hàm app cần; `createMacContext` giữ `cliPath` được truyền.
- `apps/crew-mac/test/cli.test.ts`: cách dùng, đọc key từ file, in `extraArgs` (vai thường và vai bmad), mã thoát của doctor, chặn uninstall qua sshd agent và khi còn run Paperclip, chặn `setup --sshd-owner` qua chính sshd agent (`--force` thì chạy), `--sshd-owner` giá trị lạ, câu in ở chế độ app (app nạp lại cấu hình; đổi cổng thì in cấu hình mới), lệnh `files` (thiếu cờ, UUID sai, thiếu env bridge, `--gc-only`).
- `apps/crew-mac/test/install-cli.test.ts`: thay bản cũ và giữ một bản lui, cài lần đầu, gọi lại cùng nội dung thì không đổi gì, cùng version khác nội dung thì cài, còn run thì từ chối, thiếu `dist/cli.js` hoặc `version` thì `SetupError`, chỉ một bản lui, lỗi rename thứ hai thì khôi phục. Mọi ca dùng HOME giả.
- `apps/crew-mac/test/status-app.test.ts`: `readAppState` (đủ ba trường, mọi `updateState`, file thiếu/hỏng/giá trị lạ/quá 32 ký tự thì null) và bản tin có hoặc không có key `app`.
- `apps/crew-mac/test/status-tcc.test.ts`: parser thuần (prompt/result, prompt còn chờ, nhiều client), runner quét lần đầu 2 giờ rồi `--start` theo mốc trừ 5 giây, timeout lần đầu ghi checkpoint rỗng và phát cảnh báo bắt đầu theo dõi, timeout các lượt sau giữ state và phát cảnh báo.
- `apps/crew-mac/test/status-docs.test.ts`: repo git tạm, secret-scan, link, retry HTTP 502 và giới hạn body.
- `apps/crew-mac/test/status.test.ts`: `set-secret` đi qua stdin của `security -i` (không argv nào chứa secret), thoát nháy kép và gạch chéo ngược, mã khác 0 thì lỗi; báo rõ bước thất bại của `status send` (Keychain, kết nối) mà không lộ secret; `system-wrappers.test.ts` có ca Tailscale dưới PATH tối thiểu.
- Các test còn lại kiểm từng module thuần (`zshenv`, `authorized-keys`, `render`, `system-wrappers`, `system`).
