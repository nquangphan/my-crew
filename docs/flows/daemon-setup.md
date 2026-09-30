# Cài đặt máy local (daemon)

> Flow `daemon-setup`. Flow chỉ tài liệu (không có file nguồn riêng — `entrypoints`/`files`/`tests` rỗng trong
> `docs/flows.yaml`): hướng dẫn owner đưa một máy mới vào hệ thống. Code thật đứng sau các bước dưới đây sống ở
> flow `desktop-app` (tiến trình main/daemon host), `desktop-ui` (renderer trình cài đặt) và `daemon-runtime`
> (thư viện `crewd`/`createDaemon()` dùng chung) — xem các trang đó để biết symbol và file cụ thể.

## Mục đích

Giải thích cho chủ dự án (không cần biết dòng lệnh) cách đưa một máy mới vào 2P Crew: cài app desktop
(macOS) hoặc chạy `crewd` trực tiếp (Linux không giao diện), chạy trình cài đặt/pairing, và đọc bảng sức khỏe
để biết máy đã sẵn sàng nhận job hay chưa.

## Điểm vào

- App desktop 2P Crew (macOS): tải file `.dmg` từ GitHub Releases của repo, mở trình cài đặt lần đầu (flow
  `desktop-ui` → `SetupWizard`, chạy trong tiến trình do `desktop-app` quản lý).
- CLI `crewd` (Linux không giao diện, hoặc bất kỳ máy nào không cần app đồ hoạ): `crewd pair`/`crewd start`/
  `crewd install-service` (flow `daemon-runtime`).

## Các bước

1. **Tải app**: mỗi bản phát hành trên tag `v*` đăng đúng hai file dmg lên GitHub Releases — `arm64` (Apple
   Silicon) và `x64` (Intel); chủ dự án chọn đúng kiến trúc máy mình (quyết định của chủ dự án, không tự dò).
   Job build/đăng dmg này thuộc `.github/workflows/ci.yml`, xem flow `deployment`.
2. **Mở lần đầu**: bản hiện tại ký ad-hoc, chưa nộp Apple ký Developer ID/notarize, nên Gatekeeper chặn mở
   bình thường — chuột phải vào app → "Open" để xác nhận một lần (chi tiết ký/notarize và cách bật sau này ở
   `docs/flows/desktop-app.md`).
3. **Trình cài đặt** (`SetupWizard`, flow `desktop-ui`, 4 bước): Server (kiểm
   `https://crew.2p-solutions.com/v1/health` trả lời đúng, hoặc domain khác nếu chủ dự án đổi `CREW_DOMAIN`
   lúc triển khai, xem flow `deployment`) → Ghép máy bằng **mã pairing** một lần tạo trên trang Máy của web
   (owner đã đăng nhập, chỉ cần session + CSRF để tạo mã, flow `machine-pairing`; lần ghép đầu còn viết tài nguyên gợi ý theo
   CPU/RAM máy này lên server, sửa lại được trên web sau đó, flow `server-settings`) → Claude (đăng nhập gói
   đăng ký Claude bằng `claude /login` mở qua Terminal ngay trong trình cài đặt — không cần và không dùng
   `ANTHROPIC_API_KEY`, biến này bị gỡ khỏi môi trường agent để billing luôn theo gói đăng ký) → Hoàn tất
   (bật mở cùng máy, khởi động daemon, mở trang "Trạng thái máy"). Giao project cho máy, chọn thư mục làm
   việc (cũng chọn được ngay ở "Trạng thái máy", ghi lên server), cài hook `crew-docs`, tài nguyên/model và
   mọi cài đặt khác không còn là bước của trình cài đặt — làm trên web sau khi hoàn tất.
4. **Tuỳ chọn "host trợ lý"**: một máy có thể nhận thêm vai trò trợ lý (`assistant`, nhận và định tuyến ticket
   `request` gốc); owner giao vai trò này trên web (trang Máy, nút "Đặt làm máy trợ lý", flow `web-admin`);
   máy tự trả lại bằng CLI `crewd assistant off` hoặc từ web (trang Máy → Điều khiển, "Bỏ vai trò trợ lý", flow
   `machine-control`); mỗi thời điểm chỉ một máy giữ vai trò này (flow `project-claims`).
5. **Chuyển project sang máy khác (takeover)**: khi một project hoặc vai trò trợ lý đang thuộc máy khác, máy
   mới chỉ tạo được yêu cầu chờ duyệt (202 trên web hiện "Đang chờ duyệt"); owner duyệt bằng một cú nhấp xác
   nhận trên web
   (Inbox hoặc trang Dự án) trước khi máy mới thật sự chạy job cho scope đó (flow `project-claims`,
   `web-admin`).
6. **Trạng thái máy**: sau khi cài xong, trang "Trạng thái máy" của app (hoặc `crewd doctor`) là nơi đọc máy
   có đang ổn không nhanh; bảng đầy đủ, sửa lỗi từ xa, job và log gần nhất thì xem trên web (trang Máy →
   Điều khiển, flow `machine-control`) — chi tiết từng check và cách tự sửa nằm ở
   `docs/flows/daemon-health.md`.
7. **Máy Linux không giao diện** (hoặc không muốn dùng app desktop): dùng trực tiếp CLI `crewd` — `crewd pair`,
   `crewd start` (chạy tiền cảnh) hoặc `crewd install-service` (cài systemd user unit, tự
   `UnsetEnvironment=ANTHROPIC_API_KEY`), `crewd doctor`, `crewd project add|create|release`, `crewd assistant
   on|off`; cú pháp và biến môi trường đầy đủ (`CREW_HOME`, `CREW_TOKEN_STORE`) nằm trong chính `crewd --help`
   và ở `docs/flows/daemon-runtime.md`.

## Files

Không có: flow này không sở hữu code, chỉ mô tả trình tự cho người dùng. File thật đứng sau mỗi bước ở flow
`desktop-app`, `desktop-ui` và `daemon-runtime`.

## Dữ liệu

- Cấu hình và token máy nằm dưới `~/.crew` (`config.yaml`, token store) trên chính máy đó — không có bảng
  trung tâm nào lưu chúng; xem `docs/flows/daemon-runtime.md`.
- Server mặc định là `https://crew.2p-solutions.com`; đổi được qua `CREW_DOMAIN` lúc triển khai VPS (flow
  `deployment`), khi đó bước Server của trình cài đặt phải trỏ đúng domain đã đổi.

## Flow liên quan

- desktop-app, desktop-ui: nơi trình cài đặt, daemon host và bảng sức khỏe thật sự chạy trên macOS.
- daemon-runtime: CLI `crewd` và `createDaemon()` — cùng một thư viện app desktop dùng lại.
- daemon-health: nội dung và cách tự sửa từng check của bảng sức khỏe/`crewd doctor`.
- machine-pairing: mã pairing một lần và token máy được cấp trong bước Ghép máy.
- project-claims: nhận project/vai trò trợ lý ngay hoặc chờ duyệt khi máy khác đang giữ.
- deployment: domain và VPS mà bước Server của trình cài đặt kiểm tới.
- machine-control, server-settings: sau khi cài đặt xong, mọi thao tác từ xa và cấu hình khác của máy chuyển
  hẳn sang web; app chỉ còn trang "Trạng thái máy" và bộ chọn thư mục.

## Tests

Không có test riêng (flow chỉ tài liệu); hành vi thật được kiểm ở test của `desktop-app` (ví dụ
`apps/desktop/test/host-service.test.ts`) và `desktop-ui` (`apps/desktop/test/e2e/onboarding.spec.ts`).
