# Cài và kiểm Mac chạy agent (crew-mac)

> Flow `mac-setup`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-setup` in ra đúng danh sách đó.

## Mục đích

Biến một Mac thành SSH environment cho Paperclip (Crew v3) bằng một lệnh, kiểm được nó và gỡ sạch được. Agent
`claude_local` chạy qua một sshd riêng trong phiên desktop (Aqua) để đọc được đăng nhập Claude trong Keychain,
không cần token và không login lại.

## Điểm vào

- `crew-mac setup --paperclip-key <file .pub>`: chạy trong Terminal trên màn hình Mac. In `adapterConfig.command` và
  `adapterConfig.extraArgs` (Superpowers đã ghim, flow `mac-workflows`) cần đặt cho agent `claude_local`.
- `crew-mac doctor [--no-probe]`: chạy bất kỳ lúc nào, kể cả qua SSH.
- `crew-mac status config --url <Paperclip origin> --company <UUID>`: lưu origin, `companyId` UUID và sinh `machineId` UUID nếu chưa có.
- `crew-mac status set-secret`: đọc secret từ stdin và lưu vào Keychain.
- `crew-mac status send`: gửi bản tin máy v1 tới webhook `machine-status`.
- `crew-mac status add-repo <projectId> <path>`: đăng ký repo git cho ảnh chụp docs; `remove-repo <projectId>`
  gỡ repo; `list-repos` xem danh sách và commit gửi cuối.
- `crew-mac workflow-check`, `crew-mac run-init-check`: kiểm nguồn skill của run (flow `mac-workflows`).
- `crew-mac uninstall [--force]`: chạy trong Terminal trên màn hình Mac (qua sshd agent thì bị từ chối, trừ khi có `--force`).

## Các bước

1. `apps/crew-mac/src/cli.ts` → `main`: đọc cờ, dựng `MacContext` (`defaultContext`, `superpowersPin` luôn là
   `SUPERPOWERS_PIN`), gọi lệnh.
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
   `ensureService`; ghi `~/.crew-mac/manifest.json`. Mọi file ghi qua `writeIfChanged`, nên chạy lại không đổi gì;
   đường dẫn là symlink (dotfiles của owner) thì ghi vào file đích và giữ symlink, file có sẵn của owner
   (`~/.zshenv`, `authorized_keys`) giữ mode cũ. `~/.zshenv` có dòng mở khối PATH mà thiếu dòng đóng thì dừng trước
   khi ghi gì, yêu cầu owner sửa tay. Trước mọi file khác, `installSuperpowersPin` (flow `mac-workflows`) copy bản
   Superpowers owner đã cài vào `~/.crew/workflows/superpowers/<version>-<rev12>`; owner chưa cài đúng bản ghim thì
   dừng với `SetupError` khi máy còn nguyên. `SetupReport.superpowers` trả thư mục ghim và `extraArgs` cho agent.
3. `apps/crew-mac/src/commands/doctor.ts` → `doctor`: Tailscale, sshd agent và cổng, LaunchAgent reaper (`checkReaper`),
   PATH (`checkZshenv`, id `zshenv-path`: khối có đúng `~/.local/bin` và thư mục node hiện tại), wrapper, node trong
   PATH của sshd agent (`checkAgentNode`, id `agent-node`: `command -v node` qua chính sshd agent, `fail` kèm gợi ý chạy
   lại setup), launcher (`checkLauncher`: có, chạy được, còn trỏ tới node và `cli.js` tồn tại), Superpowers ghim
   (`checkSuperpowersPin`, id `superpowers-pin`: thư mục ghim có, không phải symlink, đúng checksum, file trong
   `executables` có bit thực thi, không thì `fail`; bản owner đang cài trong `installed_plugins.json` khác bản ghim
   thì `warn`), wrapper (`checkWrapper`: có,
   chạy được qua sshd agent, giống bản trong repo), thư mục worktree, nguồn skill của từng worktree
   (`checkWorktreeWorkflows`, id `worktree-workflows`: `discoverSources` của flow `mac-workflows` cho mỗi worktree cấp 1,
   bỏ thư mục chấm; dừng ngay sau lần git quá hạn đầu tiên và có trần tổng 60 giây, kèm dòng "dừng kiểm các worktree còn lại"; `fail` khi worktree nào sẽ làm run thoát 78, `warn` khi chỉ có cảnh báo, hint là lệnh xử lý), `crew-docs` (`checkCrewDocs`: dừng ngay sau lần quá hạn đầu tiên (đọc config hay `--version`) và có trần tổng 60 giây; mỗi worktree cấp 1 dưới thư mục worktree, kể cả symlink, có `docs/flows.yaml` thì chạy qua chính
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
   cảnh báo; chỉ `fail` khi hộp thoại thuộc agent, xem `isAgentTccSubject`: subject là claude/node hoặc `identifier=com.anthropic.claude-code` trong cùng dòng log), tải máy (`parseLoad`; số liệu không đọc được thì cảnh báo; gọi `/usr/sbin/sysctl` và `/usr/bin/memory_pressure` bằng đường dẫn tuyệt đối).
4. `apps/crew-mac/src/commands/uninstall.ts` → `uninstall`: bootout và xóa plist crew-mac lẫn spike
   (`com.2p.crew-spike-sshd`), gỡ key theo comment, gỡ khối PATH và hai dòng PATH spike, xóa `~/.crew-mac` và
   `~/.crew-spike-sshd`, wrapper và launcher (và `~/.crew/bin` nếu rỗng). Không đụng phần còn lại của `~/.crew` (của `crewd` v2).
   Giữ nguyên thư mục worktree. Kiểm theo hướng fail-closed (`scanUninstallBlockers`), từ chối khi còn: `claude`/`node --print` có `PAPERCLIP_RUN_ID`
   (run Paperclip đang chạy), claude/node `--print` không tty mà `ps -E` thật sự không trả được env (`ProcInfo.envReadable`; không chắc; `node -p "<expr>"` và claude nền đọc được env mà không có run id thì không chặn), con cháu của sshd agent
   (phiên SSH đang mở, không phụ thuộc env), hoặc không đọc được bảng process. `--force` bỏ qua CẢ hai kiểm: phiên sshd của
   chính lệnh uninstall lẫn kiểm run Paperclip. Giữa lúc kiểm và lúc bootout còn một khe ngắn (vài giây) Paperclip có thể giao
   run mới: nên tạm dừng agent trên Paperclip trước khi uninstall.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/crew-mac/src/cli.ts` | CLI | `main`, `USAGE`, `defaultContext`, `sshServerPort` |
| `apps/crew-mac/src/system.ts` | Chạy lệnh có giới hạn thời gian (SIGKILL), quote đối số shell | `createRunner`, `CommandRunner`, `shQuote` |
| `apps/crew-mac/src/context.ts` | Context và lỗi | `MacContext` (kể cả `superpowersPin`), `SetupError` |
| `apps/crew-mac/src/paths.ts` | Label, comment key, đường dẫn (kể cả `workflowsRoot` = `~/.crew/workflows`) | `macPaths`, `forbiddenRootReason`, `rootGuardReason` (giới hạn `--root` của `stop-run` và worktree của reaper) |
| `apps/crew-mac/src/fs-util.ts` | Ghi file atomic, chỉ khi đổi | `writeIfChanged`, `readText` |
| `apps/crew-mac/src/manifest.ts` | Trạng thái cài đặt | `readManifest`, `writeManifest` |
| `apps/crew-mac/src/zshenv.ts` | Khối PATH | `upsertPathBlock`, `pathBlockBody`, `hasPathBlock`, `removePathBlock`, `removeSpikePathLines` |
| `apps/crew-mac/src/authorized-keys.ts` | Dòng key | `parsePublicKey`, `upsertKey`, `removeKeysByComment` |
| `apps/crew-mac/src/plist.ts` | Plist LaunchAgent | `renderPlist` |
| `apps/crew-mac/src/sshd-config.ts` | Cấu hình sshd | `renderSshdConfig` |
| `apps/crew-mac/src/launchctl.ts` | Bọc `launchctl` | `serviceState`, `bootstrap`, `bootout`, `guiSessionAvailable` |
| `apps/crew-mac/src/tailscale.ts` | IP Tailscale | `tailscaleIpv4` |
| `apps/crew-mac/src/wrapper.ts` | Đường dẫn nguồn wrapper | `WRAPPER_SOURCE` |
| `apps/crew-mac/src/launcher.ts` | Script `~/.crew/bin/crew-mac` | `renderLauncher`, `parseLauncher` |
| `apps/crew-mac/assets/crew-claude-run.sh` | Wrapper `claude` cho agent: với run Paperclip, đòi đúng một `--plugin-dir` và gọi `crew-mac workflow-check` (từ chối thì thoát 78, không chạy agent; flow `mac-workflows`), ghi `pgid`, `started` của run rồi `exec claude`. Đây là bản nguồn; fork Paperclip giữ bản sao ở `server/src/__tests__/fixtures/crew-claude-run.sh` cho test của hook phía server | — |
| `apps/crew-mac/src/commands/setup.ts` | Lệnh setup | `setup`, `SetupReport`, `ensureService`, `sshdPlistSpec`, `reaperPlistSpec`, `KEY_OPTIONS` |
| `apps/crew-mac/src/commands/doctor.ts` | Lệnh doctor | `doctor`, `checkZshenv`, `checkAgentNode`, `checkWrapper`, `checkLauncher`, `checkSuperpowersPin`, `checkWorktreeWorkflows`, `checkReaper`, `checkCrewDocs`, `parsePendingTccPrompts`, `printProbeScript` |
| `apps/crew-mac/src/commands/uninstall.ts` | Lệnh uninstall | `uninstall`, `scanUninstallBlockers` |
| `apps/crew-mac/src/commands/status.ts` | Cấu hình, Keychain và gửi webhook | `configureStatus`, `setStatusSecret`, `sendStatus` |
| `apps/crew-mac/src/status/sign.ts` | Ký raw body | `signCrewBody` |
| `apps/crew-mac/src/status/report.ts` | Thu bản tin máy v1 | `buildMachineReport` |
| `apps/crew-mac/src/status/tcc.ts` | Probe TCC nối tiếp riêng cho status; checkpoint `~/.crew/status-tcc.json` (0600), lần đầu quét 2 giờ, các lần sau bắt đầu từ mốc đã quét trừ 5 giây theo giờ địa phương kèm offset mà `log show` yêu cầu; giữ `msgId` để ghép kết quả đến ở lượt sau; timeout 20 giây ở lần đầu vẫn ghi checkpoint rỗng và cảnh báo bắt đầu theo dõi, các lần sau giữ nguyên state và thêm cảnh báo | `probeStatusTcc`, `updateTccPending` |
| `apps/crew-mac/src/status/docs.ts` | Đọc docs tại commit, kiểm chuẩn và secret-scan | `snapshotCommit`, `buildDocsSnapshot` |

## Bản tin trạng thái máy

`setup` cài LaunchAgent `com.2p.crew-mac-status`, chạy `crew-mac status send` mỗi 60 giây.
Job ghi log vào `~/.crew/logs/status.log`; `uninstall` gỡ job và plist. `doctor` kiểm job đã nạp
và đọc lần gửi gần nhất từ `~/.crew/status-last.json` (`at`, `ok`, `httpStatus`).

`~/.crew/status.json` giữ `url`, `companyId` UUID, `machineId` UUID và đường dẫn tuyệt đối `claudePath` (không chứa secret). `setup` resolve Claude và cập nhật đường dẫn này nếu đã có cấu hình; `status config` cũng resolve khi tạo cấu hình. Khi cấu hình cũ chưa có đường dẫn, bản tin tìm Claude trong PATH rồi `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, nên job launchd với PATH tối thiểu vẫn chạy được. `companyId` bắt buộc khi gửi và
được đặt ngay sau `version` trong bản tin máy v1. Secret chỉ nằm trong Keychain với service
`crew-mac-status`, account `crew-mac`; lệnh `set-secret` đọc stdin. CLI `security` buộc truyền
secret qua đối số `-w`, nên process khác có thể thấy đối số này rất ngắn qua `ps`; cần cân nhắc
helper native dùng Keychain API trực tiếp để loại bỏ rủi ro đó. Không ghi secret vào file hoặc log.

`send` dùng các check của `doctor` để lấy tải máy, Claude và Superpowers, nhưng bỏ qua probe TCC dài của doctor. Probe TCC status riêng dùng `~/.crew/status-tcc.json` với quyền `0600`: lần đầu quét `--last 2h`, sau đó quét `--start` từ `scannedUntil` trừ 5 giây theo giờ địa phương, kèm offset múi giờ theo định dạng `/usr/bin/log` yêu cầu. State giữ `scannedUntil` và pending gồm `service`, `client`, `since` cùng `msgId` để ghép `AUTHREQ_RESULT` ở lượt sau; payload chỉ gửi ba trường nghiệp vụ, không gửi `msgId`. Timeout sau 20 giây ở lượt đầu vẫn ghi checkpoint với mốc bắt đầu lượt và pending rỗng, trả check `tcc-probe` trạng thái `warn`, tiêu đề `Bắt đầu theo dõi log TCC từ <giờ địa phương HH:MM>; hộp thoại cũ hơn xem bằng crew-mac doctor`. Timeout các lượt sau giữ nguyên state và thêm check `tcc-probe` trạng thái `warn`, tiêu đề `Không đọc kịp log TCC`; không cập nhật mốc. Doctor tương tác vẫn quét 24 giờ như trước. Các probe không đọc được khác trả `null` ở trường cho phép theo hợp đồng webhook, vẫn gửi bản tin. Bản tin máy và ảnh chụp docs được gửi độc lập; một bên lỗi không chặn bên kia nhưng job trả lỗi.
chỉ gửi `id`, `status` và `title` của từng check. JSON tối đa 16 KB, ký HMAC-SHA256 trên
`<timestamp>.<raw body>` trong header `X-Crew-Signature`, với `X-Crew-Timestamp` là giây Unix.
Gửi tới `{url}/api/plugins/crew.core/webhooks/machine-status` qua POST, hạn chờ 10 giây. Mọi mã HTTP ngoài
2xx là thất bại; `status-last.json` ghi `{at, ok: false, httpStatus}` khi server từ chối.

## Ảnh chụp docs

`~/.crew/status-repos.json` lưu danh sách `{projectId, path, lastCommit}` với quyền `0600`. `projectId` phải là UUID;
`path` là đường dẫn tuyệt đối tới repo git. Trong cùng lượt gửi, `status send` xét từng repo. Nó ưu tiên commit
`origin/HEAD` đã có tại máy, không fetch. Nếu thiếu ref này, nó dùng nhánh cục bộ `main`, rồi `master`, cuối cùng
`HEAD`. Vì vậy repo chỉ có nhánh khác cần đặt `origin/HEAD` để chọn đúng nhánh mặc định.

Khi commit khác `lastCommit`, lệnh dựng ảnh chụp từ mọi file `.md` dưới `docs/` ở commit đó bằng git, không đọc
working tree. Git worktree và repo secret-scan trong thư mục tạm `crew-mac-docs-*` được xóa sau mỗi lần dựng ảnh chụp.
Một git worktree tạm detached được dùng để chạy `crew-docs check --all`; kết quả 0/1/2–3 lần lượt
thành `auditState` `verified`/`invalid`/`unverified`. Lệnh lấy bundle từ git config `crew-docs.bundle` của repo.
Chỉ Git blob file thường mode `100644`/`100755` được đưa vào ảnh chụp; symlink và submodule bị bỏ. Mỗi trang được rà secret bằng luật R7 của `crew-docs`, gồm nội dung và metadata sẽ gửi (đường dẫn, title, tên repo). Nếu tên repo bị phát hiện, không gửi ảnh chụp và chỉ log lỗi theo project ID. Trang có metadata bị phát hiện được bỏ khỏi `pages`, ghi `{"path":"<đã che>","reason":"secret-scan-metadata"}` trong `dropped`. Trang chỉ có nội dung bị phát hiện được bỏ khỏi `pages`, ghi đường dẫn
và lý do `secret-scan` vào `dropped`. File Markdown có byte NUL cũng bị bỏ vì Git coi là binary và R7 không quét
được các dòng của nó. Bản tin chứa title, nội dung, SHA-256, `parentPath` là thư mục cha (kể cả `docs` cho file ngay dưới `docs/`) và trạng thái link Markdown
tương đối (`ok`, `missing`, `external`, `unverified`).

Body JSON tối đa 5 MB. Nếu vượt giới hạn, HTTP khác 2xx hoặc xử lý thất bại, lệnh giữ `lastCommit` cũ để lần sau
thử lại. Khi POST `docs-snapshot` thành công, nó mới cập nhật commit đã gửi. Bản tin dùng cùng secret Keychain và
cùng quy tắc HMAC với bản tin máy. Lệnh chỉ cảnh báo số trang bị bỏ, không ghi nội dung hay chuỗi bí mật ra log.

## Dữ liệu

- File trên Mac: `~/.crew-mac/` (manifest, sshd config, host key, key doctor, known_hosts),
  `~/Library/LaunchAgents/com.2p.crew-mac-sshd.plist`, `~/Library/LaunchAgents/com.2p.crew-mac-reaper.plist`, khối `# >>> crew-mac path >>>` trong `~/.zshenv`, dòng key
  `crew-mac-paperclip` và `crew-mac-doctor` trong `~/.ssh/authorized_keys`, wrapper `~/.crew/bin/crew-claude-run`,
  launcher `~/.crew/bin/crew-mac`, bản Superpowers ghim `~/.crew/workflows/superpowers/<version>-<rev12>` (uninstall
  để nguyên, vô hại), thư mục worktree (mặc định `~/crew-agents`).
- Wrapper ghi `<worktree>/.paperclip-runtime/runs/<runId>/pgid` và `started` cho mỗi run. `started` là thời điểm
  SINH của process wrapper (epoch giây), không phải lúc wrapper chạy, để profile chậm của owner không làm lệch.
  `crew-mac stop-run` và reaper đọc hai file này (flow `mac-orphan-reaper`).
- Gọi ngoài: `/usr/bin/git` (đọc `crew-docs.bundle`), `launchctl`, `ssh-keygen`, `ssh`, `nc`, `tailscale`, `/usr/bin/log`, `/bin/ps`, `/usr/sbin/sysctl`, `/usr/bin/memory_pressure`, `claude`.
- Chỉ đọc (không ghi) `~/.claude/plugins/installed_plugins.json` và cây plugin Superpowers owner đã cài để copy bản
  ghim. Không đọc hay ghi phần khác của `~/.claude` hay Keychain.

## Lưu ý quyền macOS (TCC)

Quyền đọc vùng được bảo vệ gắn theo đường dẫn binary Claude (`~/.local/share/claude/versions/<bản>`). Mỗi lần Claude
Code tự cập nhật, macOS có thể hỏi lại; khi hộp thoại chưa được bấm thì mọi lần đọc vùng đó của agent treo im lặng.
R1 chỉ phát hiện (`doctor`, check `tcc-pending`) và chỉ chỗ bấm. `tcc-pending` chỉ `fail` khi hộp thoại thuộc `claude` (kể cả `…/claude/versions/<bản>`) hoặc `node`; hộp thoại của app khác chỉ `warn`. Status dùng probe nối tiếp riêng để tránh đọc lại 24 giờ mỗi phút. Ký số app cố định quyền là việc của R2.

## Flow liên quan

- `mac-orphan-reaper`: LaunchAgent dọn process `claude --print` mồ côi do `setup` cài.
- `mac-workflows`: bản Superpowers ghim mà `setup` cài và `doctor` kiểm; wrapper gọi `workflow-check` trước mỗi run.
- `runtime-updates`: bản v2 xử lý quyền ổ đĩa bằng app desktop đã ký; v3 R1 chưa dùng.

## Tests

- `apps/crew-mac/test/setup.test.ts`: cài lần đầu (khối PATH có thư mục node), ghim Superpowers và trả `extraArgs`, owner chưa cài đúng bản thì dừng trước khi ghi gì, chạy lại không đổi gì, đổi cổng, từ chối thư mục bị cấm, thiếu phiên desktop, spike còn chạy, thiếu Tailscale.
- `apps/crew-mac/test/doctor.test.ts`: máy khỏe, `agent-node` (sshd agent không thấy node) và `zshenv-path` thiếu thư mục node, `crew-docs` node mã 127 thì gợi ý sửa PATH, `superpowers-pin` (thiếu, lệch checksum, symlink, mất bit thực thi, bản owner khác pin), `worktree-workflows` (sạch, `SKILL.md` sửa dở thì warn, `settings.json` sửa dở thì fail kèm lệnh, git quá hạn thì dừng), claude treo, check `crew-docs` (thiếu bundle/runtime, nằm dưới vùng TCC, quá hạn, dùng chung kết quả theo bundle, thư mục worktree lỗi thì warn, symlink), hộp thoại TCC của agent (fail) và của app khác (warn), `isAgentTccSubject`, chưa đăng nhập, IP đổi, quá tải.
- `apps/crew-mac/test/crew-claude-run.test.ts`: wrapper chỉ exec khi không có run id, bỏ qua run id sai dạng, ghi PGID và thời điểm bắt đầu; với run id: gọi `workflow-check` đúng tham số, nhận `--plugin-dir=<dir>`, thiếu hoặc thừa `--plugin-dir`, `workflow-check` từ chối hoặc không có `crew-mac` thì thoát 78 mà không chạy agent.
- `apps/crew-mac/test/uninstall.test.ts`: gỡ phần spike rồi setup lại, gỡ đúng phần đã cài (giữ `~/.crew` của crewd), chạy lại không lỗi, từ chối khi còn run Paperclip hoặc không đọc được bảng process (`--force` bỏ qua), `claude -p` thủ công (có tty) không tính là run, env không đọc được, claude cài npm chạy dưới tên `node`, phiên sshd còn sống.
- `apps/crew-mac/test/cli.test.ts`: cách dùng, đọc key từ file, in `extraArgs`, mã thoát của doctor, chặn uninstall qua sshd agent và khi còn run Paperclip.
- `apps/crew-mac/test/status-tcc.test.ts`: parser thuần (prompt/result, prompt còn chờ, nhiều client), runner quét lần đầu 2 giờ rồi `--start` theo mốc trừ 5 giây, timeout lần đầu ghi checkpoint rỗng và phát cảnh báo bắt đầu theo dõi, timeout các lượt sau giữ state và phát cảnh báo.
- `apps/crew-mac/test/status-docs.test.ts`: repo git tạm, secret-scan, link, retry HTTP 502 và giới hạn body.
- Các test còn lại kiểm từng module thuần (`zshenv`, `authorized-keys`, `render`, `system-wrappers`, `system`).
