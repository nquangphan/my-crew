# Đánh giá bảo mật toàn repo `crew` (01/11/2026)

Phạm vi: `apps/mac-app`, `apps/crew-mac`, `packages/docs-kit`, lịch sử git, dependency. Chỉ đọc, không sửa code.

## Kết luận

Không có lỗ nào để kẻ tấn công từ Internet chiếm máy. Không có command injection, path traversal hay secret lộ qua
argv. Lịch sử git sạch credential: chỉ có khóa mẫu `AKIA…EXAMPLE` của AWS và mật khẩu DB dev local `crew:crew` của
v2. Rủi ro thật đến từ **agent bị prompt-injection**: agent chạy cùng user macOS với chủ dự án, nên vượt được các
ranh giới mà thiết kế đang cố giữ.

Ghi chú: server Paperclip theo thiết kế đã có shell trên Mac. Vì vậy các lỗ cần "server độc" chỉ là lớp phòng thủ
thêm.

## Trạng thái sửa (01/11/2026)

- **Mục 2, 3, 5, 6: đã sửa trong working tree, chưa commit.**
  - Mục 6 mới sửa phần hoa thường. Phần đối chiếu ticket của trailer nằm ở integrator, thuộc repo fork.
  - Mục 3 có unit test, nhưng chưa thử trên Electron thật vì máy chưa tải được binary Electron.
- **Mục 4: owner chọn giữ nguyên.** `ssh macbook` vào cổng 2222 bằng key trong `~/.ssh/authorized_keys`.

## Phát hiện (đã kiểm lại trong code)

| # | Mức | Vị trí | Kẻ tấn công | Mô tả | Hướng sửa |
|---|---|---|---|---|---|
| 1 | High (kiến trúc) | `crew-mac/src/status/targets.ts:52-63`, `assets/crew-codex-run.sh:41-47`, `status/docs.ts:217`, `status/checkouts.ts:35` | Agent bị injection | Agent đọc được Keychain do `security` tạo (secret HMAC của company khác), `~/.codex/auth.json`, `~/.ssh`, dữ liệu company khác. Agent cũng cài được mã chạy mỗi 60 giây qua đường dẫn `crew-docs.bundle` trong git config, hoặc qua `core.fsmonitor` trong checkout. | Mỗi company một user macOS hoặc `sandbox-exec`. Tạo item Keychain với `-T ""`. Job status chạy git với `-c core.fsmonitor=false` và chỉ dùng bundle cố định. |
| 2 | Medium | `mac-app/src/main/paperclip/cli-auth.ts:104`, `paperclip/register.ts:74` | Server độc, hoặc origin bị dụ nhập | `approvalPath` là URL tuyệt đối (`file:`, `smb:`, `//evil`, URL handler của app khác) đi thẳng vào `shell.openExternal`. | Chỉ nhận path bắt đầu bằng `/` mà không phải `//`, rồi kiểm lại origin trước khi mở. |
| 3 | Medium | `mac-app/src/main/index.ts` | Process local hoặc agent | Không chặn `--remote-debugging-port` hay `--remote-debugging-pipe`. Qua CDP, kẻ tấn công gọi được mọi kênh IPC nhân danh board key: gỡ project, hủy run, đổi `paperclipOrigin`. | Có switch đó thì `app.exit(1)` ngay đầu file. |
| 4 | Medium | `crew-mac/src/paths.ts:44`, `sshd-config.ts:17` | Process local không có FDA | sshd của app dùng chung `~/.ssh/authorized_keys`. Process local thêm key vào đó rồi ssh vào chính máy là có shell kèm FDA. | Dùng file key riêng, ví dụ `~/.crew-mac/sshd/authorized_keys` (600). |
| 5 | Medium | `crew-mac/assets/crew-opencode-run.sh:16-19` | Agent, hoặc chỉ là sơ ý | Key OpenCode được export vào env, mọi lệnh bash con đều thấy. Chạy `env` là key vào transcript, lên server và log. | Chỉ truyền qua `OPENCODE_CONFIG_CONTENT`, hoặc `env -u` khi chạy lệnh con nếu opencode hỗ trợ. |
| 6 | Medium | `docs-kit/src/rules/r6-protected.ts:43-59`, `hook-installer.ts:205-209` | Agent hoặc PR độc | Trailer `Crew-Owner-Approved` chỉ kiểm dạng, không kiểm ticket có thật. picomatch không bật `nocase`, nên `.GitHooks/…` lọt qua mà trên APFS vẫn ghi đè `.githooks`. Hook độc sau khi merge sẽ chạy trên máy chủ dự án. | Thêm `nocase: true`. Integrator đối chiếu ticket của trailer. |
| 7 | Low | `mac-app/src/main/update/rollback-helper.sh:17-18,63-66`, `rollback.ts:89` | Process local | Env `CREW_ROLLBACK_OPEN` và `CREW_ROLLBACK_TARGET` (đặt được bằng `launchctl setenv`) dẫn tới chạy binary tùy ý. Bản `previous/` được chép vào `/Applications` mà không kiểm codesign. | Spawn với env sạch. Chạy `codesign --verify -R` trước `ditto`. |
| 8 | Low | `docs-kit/src/secret-scan.ts:25-29`, `git.ts:134,140` | Agent cố ý | Né R7 bằng `.gitattributes -diff`, hoặc bằng dòng `++ /dev/null` (đã thử thật). | Thêm `--text` vào diff. Parse tiêu đề diff theo `diff --git`. |
| 9 | Low | `crew-mac/src/reaper/run-members.ts:182-194` | Agent | Ghi đè `pgid`/`started` để stop-run hoặc reaper diệt nhóm process khác (DoS). | Kiểm nhóm process có tổ tiên là run. |
| 10 | Low | `crew-mac/src/commands/setup.ts:79` | Máy cùng LAN | `from="100.64.0.0/10"` quá rộng. | Thu về IP Tailscale của server (/32). |
| 11 | Low | `mac-app/build/entitlements.mac.plist` | — | Entitlement thừa `allow-unsigned-executable-memory`. | Bỏ, chỉ giữ `allow-jit`. |
| 12 | Low | `mac-app/src/main/jobs/ensure-project.ts:92`, `jobs/validate.ts:23,50` | MITM, server độc | `StrictHostKeyChecking=accept-new`. `inspect-folder` dò được đường dẫn bất kỳ. Clone được `file://`. | Chặn `file://`, giới hạn folder. |
| 13 | Low | `zod` < 4.6.6 (docs-kit), `templates/crew-docs.yml` | Chuỗi cung ứng | `pnpm audit` báo 1 lỗi high (tràn bộ nhớ, GHSA-mrhx-c7xc-m3w5). Mức thật thấp vì chỉ parse `flows.yaml`. Action không ghim SHA. | Nâng zod lên ≥ 4.6.6; ghim SHA cho action. |

## Đã kiểm, an toàn

- **Electron:** bật `contextIsolation`, `sandbox` và `webSecurity`; CSP chặt; chặn mở cửa sổ mới và chặn điều hướng.
  IPC theo whitelist và có kiểm `senderFrame`.
- **Auto-update và đóng gói:** cập nhật qua HTTPS, kiểm chữ ký và sha512. Các fuse RunAsNode, NODE_OPTIONS và
  inspect tắt; kiểm toàn vẹn asar bật.
- **Board key:** mã hóa bằng `safeStorage`. Trên argv chỉ có bản mã.
- **cli-auth:** chỉ HTTPS, không có callback localhost, không chỗ nào tắt TLS.
- **Gọi lệnh ngoài:** dùng `spawn`/`execFile` với mảng tham số. `sh -c` chỉ nhận chuỗi hằng hoặc giá trị đã quote.
- **`crew-mac files`:** chỉ nhận UUID và sha256, chặn symlink và `..`, có trần kích thước.
- **sshd_config:** không cho đăng nhập bằng mật khẩu, không có PAM, chỉ nghe IP Tailscale. Key cấm forwarding.
- **BMAD:** ghim commit và kiểm checksum. tmux dùng socket trong thư mục 0700.
- **CI template:** dùng `pull_request` (không `_target`), quyền chỉ đọc.

## Câu hỏi còn mở

- Integrator ở repo fork có đối chiếu ticket của trailer `Crew-Owner-Approved` không? Nếu có thì mục 6 giảm mức.
- Server Paperclip tự tính sha256 của file đính kèm, hay tin giá trị client gửi? Cache đính kèm dùng chung giữa các
  company theo sha256, nên nếu server tin client thì tenant này có thể nhận file của tenant khác.
- Mục 1 cần Đại Ca chọn mức cô lập: tách user macOS cho từng company, dùng sandbox, hay chấp nhận rủi ro như hiện
  tại.
