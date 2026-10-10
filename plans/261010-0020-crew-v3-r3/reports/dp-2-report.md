# DP-2: cài crew-mac và app 2P Crew mới lên Mac mini

Ngày 10/10/2026, giờ Asia/Ho_Chi_Minh. Repo Crew `r3` @ `94b8dff`. Prod chạy `v3-f569bf4a5`.

## Kết quả

| Bước | Kết quả |
|---|---|
| 1. Kiểm 0 run, ghi bản đang cài | Đạt. VPS `active-runs.sh` rỗng, trên Mac không có `claude --print`. Bản cũ: app 0.1.0 (bundle CV-1 09/10 19:38), crew-mac 02:24 (`cli.js` sha `6aae0d01…`), wrapper sha `04b47431…` |
| 2. Build và cài `crew-mac` cùng wrapper | Đạt. Build `release --dev-sign --no-publish` thoát 0 lúc 07:22, codesign deep strict đạt. Gọi `installCrewMacFrom` với `Resources/crew-mac` của app mới, ra `installed:true`, bản lui nằm ở `crew-mac.prev`. Wrapper chép bằng tmp+mv, sha mới `1fded87a…`, bản cũ giữ ở `crew-claude-run.bak-20261010-dp2` |
| 3. Cài app | Đạt. Bản cũ chép sang `~/crew-r3-app-prev/`. Thoát app bằng Apple event, quit guard hỏi "Thoát/Ở lại", bấm Thoát (07:28:00). Đặt bản mới vào `/Applications` và mở. sshd 2222 có đúng một listener (PID 73247), là con của app (PID 73162). `app.json` có `sshdPid` trùng và `sshdOwner: app` |
| 4. `status add-target` Crew E2E | Đạt sau khi sửa secret (xem Lỗi 1). Lệnh dùng `--url https://crew.2p-solutions.com`. `list-targets` ra 2 đích. Bản tin gửi tới cả TPS và Crew E2E đều trả 200 |
| 5. `jobsAgent`, bản tin mới, doctor | Đạt một phần. Trong `machine_latest` của cả TPS lẫn Crew E2E đều có `checkouts` (4), `superpowers.skills` (15) và `app`. **Không có `jobsAgent`** (xem Lỗi 2 và 3). `doctor`: 21 mục đạt, 0 lỗi |
| 6. Đăng nhập lại qua `/cli-auth` | Không làm. Board key vẫn hợp lệ, và app không có đường đăng nhập lại khi wizard đã ở bước `done`. Luồng cli-auth thật trên prod **chưa chạy** |
| 7. Thử việc máy trong Crew E2E | **Bị chặn**. Lệnh claim trả 403 (Lỗi 3) |
| 8. Xóa file secret trên VPS | Đạt. Kiểm Keychain có `crew-mac-status-a7132a14` rồi mới chạy `shred -u -z /opt/crew-v3-spike/crew-e2e/status-webhook-secret`, đúng một file đó |

## Lỗi phát hiện

1. **Lỗi OP-2: secret webhook Crew E2E bị lưu cả dấu xuống dòng.** `e2e-company.sh` lưu giá trị "byte for byte" từ file (65 byte, có `\n` ở cuối), còn `crew-mac` đọc một dòng nên bỏ `\n`. Hậu quả là bản tin Crew E2E bị trả 502 `bad_signature`. Em chẩn đoán bằng HMAC ngay trên VPS, không in secret. Đã sửa: chạy backup `20261010-0731`, rồi gọi `POST /secrets/b18fe8f4…/rotate` với giá trị đã bỏ `\n` (lên version 2, plugin trỏ `latest`). Cần FX trong `e2e-company.sh`: bỏ khoảng trắng hai đầu giá trị (strip) cho secret webhook.
2. **Lỗi MC-2: poller lấy board key theo URL đích bản tin.** Đích TPS là `http://100.105.105.12:3100` (Tailscale), còn board key lưu theo origin `https://crew.2p-solutions.com`. Vì vậy `readKey` trả null và `MissingKeyError` bị bỏ qua im lặng. Thêm nữa, client chỉ nhận `https` hoặc `127.0.0.1`. Kết quả: TPS không bao giờ được claim. Cần FX: poller dùng origin của board key (`setup.paperclipOrigin`) thay cho URL đích.
3. **User của board key không phải thành viên Crew E2E.** Key `640308da` thuộc user `8b52…` (Phan Nhật Quang). Crew E2E chỉ có Crew Spike Admin `Mtye1…`, cũng là `ownerUserId` trong policy của cả hai company. Claim trả 403 "User does not have access to this company". App lại báo sai thành "Cần đăng nhập lại Paperclip".
4. **App không có nút đăng nhập lại ngoài wizard.** `paperclip:login` chỉ gọi được từ bước `paperclip` của wizard.

## Cần quyết (để làm bước 6–7)

- (a) Thêm user `8b52…` vào Crew E2E qua `PUT /admin/users/:id/company-access`. Lưu ý: instance admin **không gỡ ra được** bằng route này. Hoặc:
- (b) Làm FX cho app: thêm nút "Đăng nhập lại" ngoài wizard, sửa poller theo Lỗi 2, sửa câu báo lỗi 403. Sau đó DP-2 lại và đăng nhập app bằng Crew Spike Admin qua `/cli-auth` (Playwright, mật khẩu đọc từ `.env`). Lần đó là lần đầu luồng cli-auth chạy thật trên prod.

Sau khi chọn một trong hai: thêm việc `check` cho Crew E2E rồi kiểm `jobsAgent` có trong `app.json` và trong `machine_latest`.

## Lui về bản cũ

Chỉ làm khi 0 run:
- App: thoát app, rồi `ditto ~/crew-r3-app-prev/"2P Crew.app" "/Applications/2P Crew.app"` (trước đó dời bản mới đi), rồi mở lại.
- crew-mac: đổi `~/.crew/app/crew-mac.prev` thành `crew-mac`.
- Wrapper: `mv ~/.crew/bin/crew-claude-run.bak-20261010-dp2 ~/.crew/bin/crew-claude-run`.
- Bỏ đích Crew E2E: chưa có lệnh `remove-target`; sửa `~/.crew/status.json` bằng tay.

Không cần lui: app mới chạy ổn, bản tin TPS vẫn 200, doctor 0 lỗi.

## Ghi chú

- Em không đổi dữ liệu TPS. Các thay đổi trên prod: rotate secret `crew-e2e-status` (Crew E2E) và một backup.
- Thấy `/opt/crew-v3-spike/ops/nginx-crew.conf.bak-20261010-072625` mới xuất hiện. Đây là việc của phiên khác, em không đụng.
- Worktree build `.worktrees/crew-r3-dp2` giữ lại cho lần DP-2 sau (đã ghi trong `processes.md`).
