# Brief: ghép máy tự động cho app 2P Crew

Ngày 11/10/2026. Người viết: Trợ Lý (phiên MacBook). Người làm: Trợ Lý trên Mac mini. Chưa có spec, chưa có plan;
brief này là đầu vào cho brainstorm → spec → plan.

## Vấn đề

Bước **Máy → máy mới** của wizard app (`apps/mac-app/src/main/setup/machine-step.ts`) bắt owner dán hai thứ mà
người mới không có cách lấy:

- **Key Paperclip (`ssh-ed25519`)**: public key Paperclip dùng SSH vào máy. Hiện chỉ nằm trong `~/.ssh/authorized_keys`
  của Mac mini (comment `crew-mac-paperclip`) và trong secret SSH của environment `mac-mini` trên server.
- **Secret webhook bản tin máy**: plugin chỉ giữ `webhookSecretRef` (config `companies[]` của `crew.core`, đọc qua
  `ctx.secrets.resolve` trong `packages/crew-plugin/src/shared/webhook.ts`), web không xem lại được. Bản đọc được duy
  nhất là Keychain của máy đã cài (`crew-mac-status`, `crew-mac-status-<8 ký tự company>`), mà Keychain khóa khi vào
  qua SSH (`security … -w` trả 36).

Dán đủ rồi Paperclip vẫn không giao run cho máy đó vì chưa có environment SSH trỏ về máy; hiện tạo tay qua API.

Ngày 11/10 cài app trên MacBook (máy trắng, đã gỡ sạch v2) thì kẹt đúng ở bước này. Owner: "làm vầy sao người mới
setup được".

## Lỗi thứ hai: máy không có node Homebrew thì setup qua app hỏng

`stableNodePath()` (`apps/crew-mac/src/context-factory.ts`, vẫn còn ở `r24` `ed5bd3fc`) thử `/opt/homebrew/bin/node`,
`/usr/local/bin/node`, không có thì trả `process.execPath`. Setup chạy trong app thì đó là
`2P Crew.app/Contents/Frameworks/2P Crew Helper.app/Contents/MacOS/2P Crew Helper`, và nó bị ghi vào launcher
`~/.crew/bin/crew-mac`, plist reaper/status và khối PATH `~/.zshenv`. Helper không chạy như node (kể cả có
`ELECTRON_RUN_AS_NODE=1`): in "This is a helper executable and cannot be launched directly…".

Hậu quả trên MacBook (chỉ có node nvm): doctor báo reaper thoát mã 64, "sshd agent không thấy node (mã 1)", bản tin máy
không gửi. Gợi ý của doctor ("chạy lại crew-mac setup để thêm …Helper… vào PATH") sai, chạy theo không hết.

Đã vá tay trên MacBook: `brew install node`, sửa launcher trỏ `/opt/homebrew/bin/node`, chạy lại `crew-mac setup`
→ doctor 0 lỗi. Cần sửa trong sản phẩm, ví dụ: bước `check` của wizard dò node dùng được (gồm nvm/`which node`
trong shell đăng nhập) hoặc hướng dẫn cài; không bao giờ ghi binary Electron vào chỗ cần `node`; sửa câu gợi ý của
doctor. Test bằng máy không có `/opt/homebrew/bin/node`.

Ngoài ra wizard cho chọn company dễ nhầm: MacBook bị gắn vào Crew E2E (`a7132a14…`) thay vì 2P Solutions; bản tin
máy trả HTTP 502 vì secret của company khác. Bước Máy nên kiểm secret với server ngay (gửi thử một bản tin) và báo
lỗi rõ thay vì để doctor cảnh báo "chưa gửi lần nào".

## Mục tiêu

Owner mới: cài app → đăng nhập Paperclip, chọn company → bước Máy **không phải dán gì** → cấp Quyền ổ đĩa → doctor
đạt → máy hiện trên trang Máy và nhận được run.

## Hướng đề xuất (để brainstorm chốt)

1. Sau bước `paperclip`, app đã có phiên owner. Bước Máy gọi một lệnh "ghép máy" (chỉ board/owner gọi được), gửi
   lên: tên máy, IP Tailscale, cổng sshd, host public key của sshd agent.
2. Server trả về public key Paperclip và một **secret webhook riêng cho máy này** (sinh mới, lưu vào kho secret
   Paperclip, trả về app đúng một lần → Keychain). Thu hồi được từng máy, không đụng secret của Mac mini.
3. Server tạo environment SSH cho máy (host, cổng, `knownHosts` = host key vừa gửi, `remoteWorkspacePath`), dùng lại
   secret SSH sẵn có.
4. Trang Máy trên web: danh sách máy đã ghép, nút gỡ máy (gỡ = **archive** environment + thu hồi secret máy).
5. Ô dán tay giữ làm đường dự phòng.

Cần chốt khi brainstorm: lệnh ghép nằm ở plugin (`crew.core`, có webhook/action và `ctx.secrets`) hay app gọi thẳng
REST Paperclip bằng token owner; plugin có tạo được secret và environment không, hay phải qua REST. Không sửa lõi
Paperclip; không thêm hook lõi (ngân sách 5, đã duyệt H1–H4).

## Bẫy đã biết

- Environment **chỉ archive, không DELETE**: xóa environment xóa luôn secret SSH dùng chung, gãy mọi environment
  khác (AC-2 lần 3 làm mất `fa7b4847`). Probe environment cần `?companyId=`.
- Agent `claude_local` tạo qua API cần `adapterConfig.engine=cli`.
- Company có workflow `crew.core` tự kéo reviewer/integrator khi tạo issue thử — issue đo phải tự chốt done/blocked.
- Plugin bỏ cả khối bản tin khi một trường sai dạng (`sanitizeRuntimes`) — secret/máy mới phải qua đúng validate.
- Paperclip ghim `v2026.1005.0` tới hết R3.

## Nghiệm thu (Cổng thật)

- MacBook (`phans-macbook-pro`, Tailscale `100.100.157.19`, app 0.1.0 đã cài, wizard đang ở bước Máy) ghép vào company
  **2P Solutions** (TPS, `5befeb1a…`) không dán gì; doctor 0 lỗi; trang Máy prod hiện 2 máy.
- Một issue nhỏ chạy trên environment của MacBook tới done.
- Gỡ MacBook trên web: environment archived, bản tin của MacBook bị từ chối, Mac mini không ảnh hưởng (claim vẫn 204).
- Mac mini không bị ghép lại hay đổi key (fingerprint host key không đổi).

## Ràng buộc owner

Tối đa 2 agent song song; không tự gọi `fable`; push và deploy prod theo luật hiện hành (owner nói "push"); quy trình
Superpowers; docs flow cập nhật cùng lần push (R3).
