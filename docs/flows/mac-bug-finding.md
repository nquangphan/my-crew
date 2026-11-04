# App Bug Finding đi kèm 2P Crew

> Flow `mac-bug-finding`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-bug-finding` in ra đúng danh sách đó.

## Mục đích

App Bug Finding (SwiftUI, repo `bug-finding`, bundle `local.mrreviewqueue`) đi kèm bên trong 2P Crew ở
`2P Crew.app/Contents/Resources/Bug Finding.app`. Mục **Bug Finding** trên thanh bên của 2P Crew (route
`#/bug-finding`) cho owner xem nhanh trạng thái app, mở app, gỡ bản cài riêng cũ và xem các lượt review do Crew xếp.
Mọi thao tác review (dừng, resume, hủy, phản hồi, đăng nhập GitLab, token GitHub) vẫn làm trong app Bug Finding.
Thiết kế: `plans/261104-tps-643-bug-finding-in-crew/spec.md` mục 6 và 8, mockup 1
(`plans/261104-tps-643-bug-finding-in-crew/mockups/01-crew-app-bug-finding.html`).

## Điểm vào

- `apps/mac-app/src/main/index.ts` → `registerBugFinding(ctx)` (`src/main/bug-finding/register.ts`), dòng cuối sau
  `registerUpdate`. Cài handler của bốn kênh `bugFinding:state`, `bugFinding:open`, `bugFinding:syncNow`,
  `bugFinding:trashStandalone` (`src/shared/ipc-contract.ts`).
- Màn hình: route `bug-finding` (`src/renderer/routes/bug-finding.tsx`, `BugFindingScreen`), ngay sau `projects` trong
  `ROUTES` của `src/renderer/app.tsx`.

## Đường dẫn và cầu nối file

`src/main/bug-finding/paths.ts`:

- `bugFindingPaths(home)`: `dataDir` = `~/Library/Application Support/MRReviewQueue` (thư mục dữ liệu của Bug
  Finding, giữ nguyên để không mất project, lịch sử, cookie), `bridgeDir` = `<dataDir>/crew`, trong đó
  `projects.json`, `requests/`, `responses/`, `heartbeat.json`. Khớp `CrewBridgePaths` của repo `bug-finding`
  (`apps/mr-review-queue/Sources/MRQueueCore/CrewBridge.swift`).
- `embeddedAppPath(resourcesPath)` = `<resourcesPath>/Bug Finding.app`.
- `resolveAppPath({isPackaged, resourcesPath, env})`: bản đóng gói dùng app nhúng; bản dev (`!app.isPackaged`) lấy
  biến `CREW_BUG_FINDING_APP`, không có thì `null` (màn hình coi như chưa cài).
- `STANDALONE_APP_PATH` = `/Applications/Bug Finding.app` (bản cài riêng cũ, cùng bundle id).

## Các bước

### Trạng thái (`bugFinding:state`)

`src/main/bug-finding/state.ts` → `readBugFindingState(deps)` chỉ đọc, không ghi file nào:

1. `installed`: có đường dẫn app và thư mục đó tồn tại. `version`: `CFBundleShortVersionString` của app (đọc bằng
   `/usr/libexec/PlistBuddy`), `null` khi không đọc được.
2. Heartbeat `crew/heartbeat.json` `{pid, version, at, running, waiting}` (Bug Finding ghi mỗi 15 giây; `at` là ISO
   8601, số thì hiểu là giây hoặc mili giây Unix). Tuổi heartbeat ≤ 60 giây (`HEARTBEAT_STALE_SEC`) thì `running:
   true` kèm `pid`, `runningReviews`, `waitingReviews` của heartbeat; cũ hơn hay không có thì coi như không chạy (pid
   `null`, số lượt 0). `heartbeatAgeSec` luôn trả (hoặc `null` khi chưa có heartbeat) để màn hình hiện "Mất tín hiệu".
3. `standaloneApp`: còn `/Applications/Bug Finding.app` thì `{path, running}`, `running` theo danh sách tiến trình.
4. `requests`: ghép yêu cầu Crew đã ghi (`requests/<id>.json`, Bug Finding đổi thành `<id>.json.done` khi nhận) với
   phản hồi (`responses/<id>.json`, schema `crew-review-response/1`) theo `requestId`. Chưa có phản hồi thì
   `state: 'pending'`. Sắp mới nhất lên đầu theo giờ lớn nhất trong `startedAt`, `finishedAt` và giờ sửa file (Bug
   Finding ghi lại phản hồi tối đa 1 lần/phút khi đang chạy, nên lượt đang chạy nổi lên đầu); giữ tối đa 50 lượt.
   File hỏng hay trạng thái lạ bị bỏ qua.

Danh sách tiến trình: `runningBugFindingApps(runner)` (`launch.ts`) chạy
`/usr/bin/pgrep -fl 'Bug Finding.app/Contents/MacOS/MRReviewQueue'`; `parseRunningAppPaths` lấy đường dẫn bundle
`.app` từ mỗi dòng `<pid> <dòng lệnh>`. pgrep mã 1 (không khớp) là danh sách rỗng.

### Mở app (`bugFinding:open`)

`launch.ts` → `launchBugFinding(deps, {background})`:

1. Không có đường dẫn app hay thư mục app không tồn tại → `{ok: false, reason: 'missing'}`.
2. Có tiến trình Bug Finding nào chạy từ đường dẫn khác bản nhúng (bản cài riêng ở `/Applications`, bản build tay)
   → `{ok: false, reason: 'standalone_running'}`, không mở. Hai bản cùng bundle id dùng chung `state.json`, chạy cùng
   lúc sẽ ghi đè nhau; màn hình báo owner thoát bản kia trước.
3. Còn lại chạy `/usr/bin/open <app>` (mở thường, đưa lên trước) hoặc `/usr/bin/open -g <app>` khi `background`
   (việc máy review sau này mở nền). `open` mã khác 0 thì ném "Không mở được Bug Finding (open mã N)".

Kênh `bugFinding:open` mở thường và ghi `bug-finding-open` vào `app.log`.

### Gỡ bản cài riêng (`bugFinding:trashStandalone`)

`launch.ts` → `trashStandalone(deps)`: không còn bản cài riêng thì trả "Không còn bản cài riêng"; bản đó đang chạy
thì từ chối `{ok: false, message: 'Thoát Bug Finding (bản cài riêng) rồi thử lại'}`; không thì `shell.trashItem`
(Thùng rác, khôi phục được). Dữ liệu của Bug Finding trong `MRReviewQueue` không bị đụng. Ghi
`bug-finding-trash-standalone` vào `app.log`.

### Đồng bộ project (`bugFinding:syncNow`)

Kênh có trong hợp đồng và nút **Đồng bộ lại** đã có trên màn hình; bản này chưa ghi `projects.json` nên handler báo
"Bản này chưa đồng bộ project sang Bug Finding". Phần ghi danh sách project Crew sang Bug Finding thay handler này.

### Màn hình

`BugFindingScreen` (`src/renderer/routes/bug-finding.tsx`) theo mockup 1:

- Đầu trang: tiêu đề, mô tả, nút **Mở Bug Finding** (tắt khi chưa cài). Kết quả `standalone_running` hiện lỗi "Thoát
  Bug Finding (bản cài riêng) trước…", `missing` hiện "Không tìm thấy app Bug Finding đi kèm 2P Crew…". Chưa cài thì
  có cảnh báo ngay; bản cài riêng đang chạy cũng có cảnh báo ngay.
- Thẻ **Trạng thái app**: phiên bản, tiến trình (Đang chạy/Không chạy, pid), hàng đợi, kết nối với Crew ("Đã nhận tín
  hiệu N giây trước" / "Mất tín hiệu từ … trước" / "Chưa nhận tín hiệu"), bản cài riêng cũ (đường dẫn và nút **Chuyển
  vào Thùng rác**, tắt khi bản đó đang chạy).
- Thẻ **Đồng bộ project**: mô tả và nút **Đồng bộ lại**.
- Thẻ **MR do Crew xếp**: bảng Ticket tổng, PR, Lần (lần > 1 ghi "(chạy lại)"), Trạng thái (kèm "N/M lane xong" khi
  đang review), Kết quả (verdict hay lỗi), nút **Xem trong Bug Finding** (mở app).
- Đọc lại `bugFinding:state` khi nhận `state:changed` và mỗi 10 giây khi màn đang mở; rời màn thì dừng.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/mac-app/src/main/bug-finding/paths.ts` | Đường dẫn cầu nối, app nhúng, bản cài riêng, chọn app theo bản đóng gói/dev | `bugFindingPaths`, `embeddedAppPath`, `resolveAppPath`, `STANDALONE_APP_PATH` |
| `apps/mac-app/src/main/bug-finding/state.ts` | Đọc heartbeat, bản cài riêng, yêu cầu/phản hồi thành trạng thái màn hình | `readBugFindingState`, `BugFindingView`, `BugFindingRequestRow`, `HEARTBEAT_STALE_SEC` |
| `apps/mac-app/src/main/bug-finding/launch.ts` | Mở app (chặn khi bản khác đang chạy), dò tiến trình, gỡ bản cài riêng | `launchBugFinding`, `runningBugFindingApps`, `parseRunningAppPaths`, `trashStandalone` |
| `apps/mac-app/src/main/bug-finding/register.ts` | Nối bốn kênh `bugFinding:*` vào Electron | `registerBugFinding` |
| `apps/mac-app/src/renderer/routes/bug-finding.tsx` | Màn hình Bug Finding | `BugFindingScreen` |

## Dữ liệu

- Chỉ đọc trong `~/Library/Application Support/MRReviewQueue/crew/` (`heartbeat.json`, `requests/`, `responses/`).
  Không ghi gì ở bản này.
- Không có secret nào đi qua kênh `bugFinding:*`; renderer chỉ nhận trạng thái và đường dẫn app.

## Flow liên quan

- `mac-app`: khung app, hợp đồng IPC, thanh bên.
- `mac-app-update`: đóng gói app nhúng khi phát hành, updater.
- `mac-app-paperclip`: project và việc máy (job review của Bug Finding).

## Tests

- `apps/mac-app/test/bug-finding-launch.test.ts`: không mở bản nhúng khi bản riêng `/Applications` đang chạy; mở nền
  bằng `open -g`; mở thường khi bản nhúng đã chạy; không có app (cả bản dev không có đường dẫn) thì `missing`; `open`
  lỗi thì ném; `parseRunningAppPaths` đọc đầu ra `pgrep -fl`; `runningBugFindingApps` hỏi đúng mẫu, mã 1 thì rỗng;
  `trashStandalone` từ chối khi bản riêng chạy, chuyển vào Thùng rác khi không chạy, không còn thì không làm gì;
  `bugFindingPaths`, `embeddedAppPath`, `resolveAppPath` (đóng gói, dev có/không có `CREW_BUG_FINDING_APP`).
- `apps/mac-app/test/bug-finding-state.test.ts` (HOME tạm): heartbeat 20 giây với `running: 1` thì đang chạy 1 lượt;
  heartbeat 5 phút thì không chạy; không app không heartbeat thì chưa cài; có bản cài riêng thì `standaloneApp`; ghép
  yêu cầu với phản hồi, chưa có phản hồi là `pending`, file hỏng bị bỏ, sắp mới nhất lên đầu.
- `apps/mac-app/test/renderer/bug-finding.test.tsx`: route nằm ngay sau Project; hiện trạng thái, hàng đợi, tín hiệu,
  bảng MR; nút mở gọi `bugFinding:open`, `standalone_running` báo thoát trước; chưa cài thì tắt nút mở; nút Thùng rác
  gọi `bugFinding:trashStandalone`; bản riêng đang chạy có cảnh báo; nghe `state:changed` và đọc lại mỗi 10 giây,
  rời màn thì dừng.
- `apps/mac-app/test/ipc-contract.test.ts`: bốn kênh `bugFinding:*` có trong `IPC_CHANNELS`.
