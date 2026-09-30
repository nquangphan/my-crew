# Giao diện app desktop (cài đặt, trạng thái máy)

> Flow `desktop-ui`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow desktop-ui` in ra
> đúng danh sách đó.

## Mục đích

Renderer React của app 2P Crew: trình cài đặt lần đầu (server, ghép máy, đăng nhập Claude, hoàn tất) và đúng
một màn sau khi cài đặt xong — "Trạng thái máy". App là **cổng vào** (gateway), không phải nơi cấu hình:
project, thư mục dự án, tài nguyên, model, prompt, quy tắc, MCP và mọi thao tác từ xa (tạm dừng, sức khỏe đầy
đủ, dò lại skill, job, log, cài BMAD, gỡ project) đều ở web (flow `web-admin`, `server-settings`,
`machine-control`). Renderer chạy sandbox, không có Node, chỉ nói chuyện với daemon qua cầu `invoke`/`on` mà
`desktop-app` (flow `desktop-app`) lộ ra; mọi hành vi thật (chạy check, gọi VPS, đọc/ghi `~/.crew`) đều thuộc
flow đó.

## Điểm vào

- `apps/desktop/src/renderer/main.tsx` — gắn `<App />` vào `#root`.
- `apps/desktop/src/renderer/app.tsx` → `App()` — định tuyến bằng hash (`#/route?section=`), chỉ hai route:
  `setup` (trình cài đặt) và `status` (mặc định sau khi đã cài đặt xong).

## Các bước

1. `apps/desktop/src/renderer/index.html`: Content-Security-Policy chặt (`default-src 'none'`, `script-src
   'self'`, không `connect-src` ra mạng ngoài); `webPreferences` của cửa sổ chứa nó đã bật `sandbox` và
   `contextIsolation` (flow `desktop-app`), nên renderer không có API Node hay mạng ngoài IPC.
2. `apps/desktop/src/renderer/lib/ipc.ts` → `invoke()`, `useDesktopEvent()`, `reportRendererErrors()`: gọi
   `window.crew.invoke(method, input)` (từ preload) và ném lỗi bằng đúng message tiếng Việt main/daemon trả
   về; hook subscribe một sự kiện `DesktopEvents` cho vòng đời của component (danh sách sự kiện chỉ còn
   `daemon.status`, `daemon.runtime`, `health.report`, `update.status`, `app.navigate`, `runtime.status` (flow
   `runtime-updates`) — không còn `log.line`/`jobs.changed`/`bmad.progress` của các màn đã bỏ, xem Dữ liệu);
   `reportRendererErrors()` (gọi
   một lần từ `main.tsx` trước khi gắn `<App />`, nên lỗi render sớm nhất cũng được ghi) bắt lỗi chưa bắt và
   promise bị reject của `window`, cắt ngắn message/stack rồi gửi qua `app.reportError` (flow `desktop-app`)
   để vào `~/.crew/logs/app.log` — không đọc được input gây lỗi.
3. `apps/desktop/src/renderer/app.tsx` → `parseHash()`/`toHash()`: route (`DesktopRoute`: `setup`|`status`)
   và `section` (bước wizard cần mở, ví dụ `pairing` từ fix "Ghép lại máy") mã hoá hai chiều trong hash URL.
   `App()`: `showWizard = !info.setupComplete || location.route === 'setup'` — máy chưa cài đặt xong luôn
   thấy trình cài đặt; đã xong thì trình cài đặt chỉ mở lại khi tự điều hướng tới (`{route: 'setup'}`, nút
   "Chạy lại trình cài đặt" ở bước 6) và có nút "Đóng trình cài đặt" quay lại "Trạng thái máy".
4. `apps/desktop/src/renderer/routes/setup-wizard.tsx` → `SetupWizard()`: 5 bước theo `WIZARD_STEPS`
   (`apps/desktop/src/renderer/components/wizard-step.tsx`) — Server (`setup.checkServer`, bắt buộc
   `/v1/health` trả lời đúng cả kết nối, TLS và hợp đồng API v1), Ghép máy (`setup.pair` — lần ghép đầu còn
   viết tài nguyên gợi ý theo CPU/RAM máy này vào cấu hình cục bộ, daemon tải lên server đúng một lần, flow
   `server-settings`), Claude (`setup.checkClaude` + nút "Đăng nhập Claude" mở Terminal qua
   `setup.openClaudeLogin` + "Kiểm tra lại"), Quyền ổ đĩa (`FullDiskAccessPanel`, flow `runtime-updates` — dò
   Full Disk Access không hiện hộp thoại, một nút mở đúng pane System Settings; bước này bỏ qua được, nút
   "Tiếp" đổi thành "Để sau" tới khi quyền được cấp), Hoàn tất (`setup.finish`: bật mở cùng máy, khởi động
   daemon, mở "Trạng thái máy"). Mỗi bước tự nạp/kiểm lại dữ liệu khi mở (`useEffect` theo `step`) và chặn
   "Tiếp" tới khi hợp lệ. Nhận project, chọn thư mục, tài nguyên/model, hook và mọi cài đặt khác không còn là
   bước của trình cài đặt — chủ dự án làm trên web sau khi hoàn tất, hoặc chọn thư mục ngay ở "Trạng thái máy"
   (bước 6).
5. `apps/desktop/src/renderer/components/wizard-step.tsx` → `WizardStep()`, `WIZARD_STEPS`: khung một bước
   (danh sách bước bên trái, nút Back/Next chỉ chạy khi `canNext`, ô lỗi) dùng chung cho cả 4 bước.
6. `apps/desktop/src/renderer/routes/status.tsx` → `StatusPage()`: cổng — badge trạng thái daemon
   (`daemonBadge()`: đang khởi động/khởi động lại, chưa chạy, tạm dừng, đang nhận việc, hay mất kết nối
   server) cộng số job chạy/chờ/chờ thử lại, URL server, phiên bản app, **phiên bản runtime đang chạy**
   (`data-runtime-version`, đi kèm app hay cập nhật nóng, flow `runtime-updates`), bản cài đặt server đang
   dùng (`revision`/`source`), có là máy trợ lý không; cảnh báo khi có thư mục project đang chờ macOS trả lời
   hộp thoại quyền (`folderAccessWaiting`); mục Sức khỏe (nút "Kiểm tra ngay" → `health.run`, chỉ liệt kê
   check chưa xanh — `HealthCheckRow`, hộp hướng dẫn gỡ `ANTHROPIC_API_KEY` tại chỗ khi fix `api-key-help`,
   ghi chú "toàn bộ kết quả, sửa lỗi từ xa, job và log: trên web, trang Máy → Điều khiển" vì mọi fix khác và
   bảng đầy đủ giờ ở web, flow `machine-control`); mục "Dự án của máy này" (`ProjectRow` mỗi project: badge sở
   hữu, link "Mở trên web", `FolderPicker` chọn thư mục — `projects.setFolder` kiểm thư mục tại chỗ
   (`HealthCheckRow` hiện từng check) rồi lưu lên server, không phải `config.yaml`; báo lý do nếu thư mục
   server đặt mà máy không dùng được, flow `server-settings`); mục "Quyền truy cập ổ đĩa" (`FullDiskAccessPanel`,
   flow `runtime-updates` — cùng thành phần với bước "Quyền ổ đĩa" của trình cài đặt); mục "Mở trên web" (link
   tới Cài đặt máy, Cài đặt hệ thống, trang Máy); mục "Trên máy này" (mở cùng máy, kiểm/cài bản mới, một dòng
   trạng thái cập nhật runtime bằng tiếng Việt (`runtimeText()`, flow `runtime-updates`) kèm nút "Kiểm tra
   runtime" (`app.checkRuntime`), "Mở thư mục log", "Mở Terminal đăng nhập Claude", "Chạy lại trình cài đặt").
   `localFixFor()`: một fix sức khỏe điều hướng tại chỗ thay vì chạy như hành động của app — `repair` → mở
   lại bước Ghép máy, `repick-folder` → cuộn tới mục Dự án, `adjust-limits` → mở trang "Cài đặt máy" trên web,
   `api-key-help` → mở hộp hướng dẫn; fix còn lại (ví dụ `install-hooks`, `mcp-disable`) chạy `health.fix`
   ngay tại đây như trước.
7. `apps/desktop/src/renderer/components/folder-picker.tsx` → `FolderPicker()`: mở hộp thoại chọn thư mục
   native (`folder.pick`) rồi gọi `onPick(path)` của nơi dùng nó (bước 6).
8. `apps/desktop/src/renderer/components/health-check-row.tsx` → `HealthCheckRow()`: một dòng kết quả check
   (chấm màu, giải thích, nút sửa khi có `onFix`) dùng ở cả bước Claude của trình cài đặt, mục Sức khỏe và
   validate thư mục của "Trạng thái máy".
9. `apps/desktop/src/renderer/components/ui.tsx` → `Lozenge`, `StatusDot`, `Toggle`, `PageHeader`, `Notice`,
   `ErrorBox`, `HEALTH_LABEL`: bộ thành phần dùng chung cho toàn bộ renderer.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/desktop/src/renderer/main.tsx` | Điểm vào renderer | (gắn `<App />`) |
| `apps/desktop/src/renderer/app.tsx` | Định tuyến hash, mở wizard hoặc trạng thái | `App`, `parseHash`, `toHash` |
| `apps/desktop/src/renderer/index.html` | HTML gốc, CSP | — |
| `apps/desktop/src/renderer/styles.css` | Theme và class dùng chung (Tailwind) | — |
| `apps/desktop/src/renderer/lib/ipc.ts` | Gọi IPC có kiểu, subscribe sự kiện, chuyển lỗi renderer sang app.log | `invoke`, `useDesktopEvent`, `reportRendererErrors` |
| `apps/desktop/src/renderer/lib/format.ts` | Định dạng giờ/thời lượng/tiền theo `Asia/Ho_Chi_Minh` | `formatTime`, `formatElapsed`, `formatUsd`, `errorText` |
| `apps/desktop/src/renderer/routes/setup-wizard.tsx` | Trình cài đặt 4 bước | `SetupWizard`, `DEFAULT_SERVER_URL` |
| `apps/desktop/src/renderer/routes/status.tsx` | Trang "Trạng thái máy" (cổng vào) | `StatusPage`, `daemonBadge`, `localFixFor` |
| `apps/desktop/src/renderer/components/wizard-step.tsx` | Khung một bước trình cài đặt, danh sách bước | `WizardStep`, `WIZARD_STEPS` |
| `apps/desktop/src/renderer/components/health-check-row.tsx` | Một dòng kết quả check + nút sửa | `HealthCheckRow` |
| `apps/desktop/src/renderer/components/folder-picker.tsx` | Hộp thoại chọn thư mục native | `FolderPicker` |
| `apps/desktop/src/renderer/components/full-disk-access.tsx` | Dò/hiện/mở Full Disk Access, dùng chung ở trình cài đặt và "Trạng thái máy" | `FullDiskAccessPanel` |
| `apps/desktop/src/renderer/components/ui.tsx` | Thành phần UI dùng chung | `Lozenge`, `StatusDot`, `Toggle`, `PageHeader`, `Notice`, `ErrorBox`, `HEALTH_LABEL` |

## Dữ liệu

- Bảng: không đọc/ghi trực tiếp; mọi dữ liệu tới qua các method của `DesktopRequests` (flow `desktop-app`).
- Sự kiện: nhận `DesktopEvents` (`daemon.status`, `daemon.runtime`, `health.report`, `update.status`,
  `app.navigate`, `runtime.status`) qua `useDesktopEvent()`; không tự phát sự kiện nào ra ngoài renderer.
- Gọi ngoài: không gọi mạng trực tiếp (CSP chặn `connect-src`); mọi thao tác đi qua `invoke()` tới main/host.

## Flow liên quan

- desktop-app: renderer chỉ là lớp trình bày của các method/sự kiện flow này định nghĩa
  (`packages/shared/src/desktop-ipc.ts`); mọi hành vi thật (health check, daemon, VPS, git, hook, chọn thư
  mục ghi lên server) thuộc flow đó.
- runtime-updates: `FullDiskAccessPanel` chỉ trình bày kết quả `app.fullDiskAccess`/`app.openFullDiskAccess`
  (dò không hiện hộp thoại, mở đúng pane System Settings); dòng runtime và nút "Kiểm tra runtime" của
  `StatusPage` chỉ gọi `app.checkRuntime` và hiện lại `MachineRuntimeState` — toàn bộ việc ký, tải, kiểm và
  chuyển bản runtime thuộc flow đó.
- daemon-health: mục Sức khỏe của `StatusPage` và bước Claude của trình cài đặt hiển thị đúng
  `HealthCheckResult` mà `crewd doctor` cũng dùng.
- project-claims: `ProjectRow` hiện `ownerState` của mỗi project máy đang giữ; nhận/trả project hay đổi vai
  trò trợ lý không còn làm được từ app — owner giao trên web (flow `web-admin`), máy chỉ tự trả qua
  `machine-control` ("Bỏ vai trò trợ lý"/"Gỡ khỏi máy") hoặc CLI `crewd project release`/`assistant off`.
- server-settings: `FolderPicker`/`projects.setFolder` ghi cùng cài đặt `project_folders` mà trang "Cài đặt
  máy" trên web sửa; mọi cài đặt khác (tài nguyên, model, MCP, prompt, quy tắc) chỉ sửa được trên web, app chỉ
  link tới đó ("Mở trên web").
- machine-control: mục Sức khỏe ghi rõ bảng đầy đủ, sửa lỗi từ xa, job và log nằm ở trang Máy → Điều khiển
  trên web; các fix chạy ngay tại app chỉ còn phần không nhạy với việc chạy từ xa hay tại máy.
- web-admin: đích của mọi link "Mở trên web" (trang Máy, Cài đặt máy, Cài đặt hệ thống).

## Tests

- `apps/desktop/test/e2e/onboarding.spec.ts` (Electron thật qua Playwright `_electron`): chạy hết trình cài
  đặt lần đầu (server, ghép máy, Claude, **Full Disk Access** — dò từ chối hiện đúng qua
  `data-full-disk-access="denied"` không có hộp thoại nào, cấp quyền qua marker file rồi dò lại thấy đúng,
  flow `runtime-updates` — hoàn tất) rồi mở "Trạng thái máy" — chưa giữ project nào; owner giao project và vai
  trò trợ lý trên web, app phản ánh đúng sau khi tải lại; chọn thư mục qua `FolderPicker` kiểm tại chỗ rồi lưu
  lên server (không phải `config.yaml`), hook được cài theo; toàn bộ chuyển xanh và web thấy đúng máy (sức
  khỏe, trợ lý, project, cài đặt); "Mở thư mục log" và "Mở trên web" mở đúng đích.
- `apps/desktop/test/e2e/project-bmad.spec.ts`: chạy hết trình cài đặt, owner giao project và chọn thư mục có
  sẵn bản cài BMAD qua `FolderPicker`; lệnh "Cài BMAD" gọi từ web (`bmad.install`, flow `machine-control`) bỏ
  qua thư mục đã có BMAD, rồi cài được bằng trình cài giả lập của chế độ E2E sau khi xoá `_bmad`.
