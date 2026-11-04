# App Bug Finding đi kèm 2P Crew

> Flow `mac-bug-finding`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-bug-finding` in ra đúng danh sách đó.

## Mục đích

App Bug Finding (SwiftUI, repo `bug-finding`, bundle `local.mrreviewqueue`) đi kèm bên trong 2P Crew ở
`2P Crew.app/Contents/Resources/Bug Finding.app`. Mục **Bug Finding** trên thanh bên của 2P Crew (route
`#/bug-finding`) cho owner xem nhanh trạng thái app, mở app, gỡ bản cài riêng cũ, xem danh sách project Crew đã đồng bộ sang Bug Finding
và xem các lượt review do Crew xếp.
Mọi thao tác review (dừng, resume, hủy, phản hồi, đăng nhập GitLab, token GitHub) vẫn làm trong app Bug Finding.
Thiết kế: `plans/261104-tps-643-bug-finding-in-crew/spec.md` mục 6, 7 và 8, mockup 1
(`plans/261104-tps-643-bug-finding-in-crew/mockups/01-crew-app-bug-finding.html`).

## Bản nhúng và file ghim

`apps/mac-app/bug-finding.pin.json` ghim đúng bản Bug Finding đi kèm mỗi bản 2P Crew:

```json
{ "repo": "git@github.com:nquangphan/bug-finding.git", "commit": "<40 hex>", "version": "<CFBundleShortVersionString>" }
```

- `commit` là SHA đủ 40 hex (không ghim nhánh hay tag), `version` là `CFBundleShortVersionString` của bản build từ commit
  đó. `readBugFindingPin` (`scripts/release-lib.mjs`) ném lỗi khi `repo` rỗng hay `commit` sai dạng.
- Hiện ghim `853aa5cf47ac587dbbbb33f1a4860d61e297806c` (version `0.1.0`), đầu nhánh `feat/crew-bridge` của repo
  `bug-finding` (commit ký hardened runtime cho bản nhúng), **chưa merge vào `main` và chưa có trên GitHub**. Sau khi
  owner merge nhánh đó (plan 261104 Phase D, bước 1) thì đổi `commit` sang SHA trên `origin/main` chứa nó; trong lúc
  chờ, chạy `release.mjs` với `CREW_BUG_FINDING_REPO=<đường dẫn repo bug-finding trên máy>`.
- `scripts/release.mjs` build Bug Finding từ commit ghim rồi electron-builder chép `build/bug-finding/Bug Finding.app`
  (gitignored) vào `Contents/Resources/Bug Finding.app` (mục `extraResources` của `electron-builder.yml`). Các bước,
  ký và mã thoát ở flow `mac-app-update`, mục "Phát hành".
- Đổi bản Bug Finding đi kèm: sửa `commit` và `version` trong file ghim rồi phát hành 2P Crew bản mới.

## Điểm vào

- `apps/mac-app/src/main/index.ts` → `registerBugFinding(ctx)` (`src/main/bug-finding/register.ts`), dòng cuối sau
  `registerUpdate`. Cài handler của bốn kênh `bugFinding:state`, `bugFinding:open`, `bugFinding:syncNow`,
  `bugFinding:trashStandalone` (`src/shared/ipc-contract.ts`), dựng lịch đồng bộ project, chạy relay kết quả review và
  trả `{requestSync, runReview}`; `index.ts` nối hai hàm này vào `ctx.syncBugFindingSoon` và `ctx.runBugFindingReview`.
- Việc máy `bug-finding-review` (flow `mac-app-paperclip`): `jobs/register.ts` chuyển cho `ctx.runBugFindingReview`.
- Màn hình: route `bug-finding` (`src/renderer/routes/bug-finding.tsx`, `BugFindingScreen`), ngay sau `projects` trong
  `ROUTES` của `src/renderer/app.tsx`.

## Đường dẫn và cầu nối file

`src/main/bug-finding/paths.ts`:

- `bugFindingPaths(home)`: `dataDir` = `~/Library/Application Support/MRReviewQueue` (thư mục dữ liệu của Bug
  Finding, giữ nguyên để không mất project, lịch sử, cookie), `bridgeDir` = `<dataDir>/crew`, trong đó
  `projects.json`, `requests/`, `responses/`, `heartbeat.json`. Khớp `CrewBridgePaths` của repo `bug-finding`
  (`apps/mr-review-queue/Sources/MRQueueCore/CrewBridge.swift`).
- `embeddedAppPath(resourcesPath)` = `<resourcesPath>/Bug Finding.app`.
- `BUG_FINDING_BUNDLE_ID` = `local.mrreviewqueue` (cả bản nhúng lẫn bản cài riêng); updater thoát Bug Finding bằng
  `quit app id` theo id này (flow `mac-app-update`).
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
   `bugFindingRunningReviews(heartbeatFile, now)` chỉ đọc `running` theo đúng luật đó (cũ quá 60 giây, thiếu hay hỏng
   thì 0), cho bước chờ máy rảnh của updater (flow `mac-app-update`).
3. `standaloneApp`: còn `/Applications/Bug Finding.app` thì `{path, running}`, `running` theo danh sách tiến trình.
4. `sync`: đọc `crew/projects.json` thành `{lastSyncAt, projects}` (mục dưới). `lastSyncAt` là giờ lần đồng bộ
   thành công cuối trong phiên app (kể cả lần không phải ghi lại vì không đổi), chưa có thì lấy `writtenAt` của file;
   phần tử thiếu trường bị bỏ.
5. `requests`: ghép yêu cầu Crew đã ghi (`requests/<id>.json`, Bug Finding đổi thành `<id>.json.done` khi nhận) với
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

Một chiều Crew → Bug Finding (spec mục 7). `src/main/bug-finding/sync-projects.ts`:

1. Nguồn: `projects:list` của mac-app (`createProjectsIpc(...).list()` với `projectDeps(ctx)`, flow
   `mac-app-paperclip`): project REST Paperclip của company đang chọn ghép trạng thái Mac.
2. `createRepoResolver(git)` tìm repo trên máy của từng dòng: `docsRepo` → `progress.folder` (thư mục gốc owner chọn
   lúc thêm project) → `git -C <checkout> rev-parse --path-format=absolute --git-common-dir` của từng checkout agent,
   bỏ đuôi `.git`. Không có nguồn nào thì project không vào danh sách.
3. `buildCrewProjectList(rows, resolveRepo, companyId)` →
   `{schema: 'crew-projects/1', writtenAt, companyId, projects: [{crewProjectId, key, name, repoPath}]}`. Bỏ dòng
   không có `projectId` (tiến độ thêm dở). `key` = `progress.key`, không thì `<key>` của checkout
   `~/crew-agents/<key>/<vai>`, không thì `name`.
4. `syncProjects(deps)` → `{written, count}`: đọc `crew/projects.json` đang có; `schema`, `companyId`, `projects` giống
   hệt (bỏ qua `writtenAt`) thì không ghi. Không thì tạo thư mục `crew/` khi chưa có, ghi file tạm cùng thư mục rồi
   `rename` (atomic); file đang có hỏng thì ghi đè.
5. `createSyncRunner({sync, log})` chạy lần lượt (không hai lần ghi cùng lúc): `request(reason)` không chờ, không ném
   (lỗi ghi `bug-finding-sync-failed` warn), các lần nhờ trong lúc đang đồng bộ gộp thành đúng một lần chạy thêm;
   `runNow(reason)` trả kết quả và ném lỗi cho người gọi. Ghi được thì log `bug-finding-sync-written` kèm lý do.

Khi nào đồng bộ (`register.ts`, chỉ khi đã có `paperclipOrigin` và `companyId`):

- Khi mở app (`startup`), mỗi 10 phút (`PROJECT_SYNC_INTERVAL_MS`, dừng ở `will-quit`), khi `companyId` trong
  `app.json` đổi (đăng nhập xong, đổi company).
- Sau `projects:add`/`projects:remove` (flow `mac-app-paperclip`), sau việc máy `prepare-checkouts`,
  `agent-workspace`, `ensure-project`, `remove-checkouts` làm xong (`jobChangesProjects`), qua
  `ctx.syncBugFindingSoon`.
- Nút **Đồng bộ lại** (`bugFinding:syncNow` → `runNow`): trả `{written, count}`, chưa chọn company thì báo "Chưa chọn
  company Paperclip (mục Cài đặt)".

Bug Finding áp danh sách khi mở app, khi file đổi và mỗi 60 giây (repo `bug-finding`, `CrewBridge.swift`), nên project
mới trong Crew có bên Bug Finding sau tối đa khoảng một phút.

### Nhận việc review (`runReview`)

`register.ts` → `runReview(job)` gọi `runBugFindingReview` của `src/main/jobs/executors.ts` (các bước kiểm, ghi
`requests/<requestId>.json`, mã lỗi ở flow `mac-app-paperclip`, mục "Việc `bug-finding-review`") với deps của Main:
`requestsDir` của `bugFindingPaths`, `syncProjects` = `runNow('bug-finding-review')` khi đã đăng nhập, `launch` =
`launchBugFinding` với app nhúng (mở nền `open -g`), `recordRequest` ghi sổ `bugFindingRequests` của `app.json`
(`rememberRequest`) rồi nhờ relay chạy. Ghi `bug-finding-review-job` vào `app.log` (trạng thái, mã lỗi).

### Chuyển kết quả về server (relay)

Bug Finding ghi `crew/responses/<requestId>.json` (`CrewReviewResponse`, schema `crew-review-response/1`: `requestId`,
`state` `queued|running|succeeded|failed|cancelled`, `round`, `headSha`, `lanesDone`, `lanesTotal`, `verdict`,
`costUsd`, `tokens`, `resultDir`, `reportPath`, `error`). `src/main/bug-finding/results.ts`:

1. `startResultsRelay({responsesDir, relay, log})` chạy trong Main (cần board key): tạo `responses/` khi chưa có,
   `fs.watch` thư mục đó (gộp 1 giây) và quét mỗi 30 giây (`RELAY_INTERVAL_MS`); không bao giờ hai lượt cùng lúc,
   nhờ trong lúc đang chạy thì chạy thêm đúng một lần; `fs.watch` lỗi thì vẫn còn lượt định kỳ. Dừng ở `will-quit`.
   `register.ts` bỏ qua lượt khi sổ `bugFindingRequests` và hàng đợi gửi đều rỗng.
2. `relayResponses(deps)` → `{sent, pending}`: đọc mọi `responses/*.json` (`readResponsesDir`, bỏ file hỏng). Bỏ
   response sai dạng (schema, `requestId` uuid, `state`, `headSha` 40 hex), của lượt không có trong sổ (không do 2P
   Crew xếp) hay đã gửi xong kết quả cuối (`delivered`). Bản tin không đổi so với lần gửi trước thì bỏ; `running` gửi
   tối đa 1 lần/phút mỗi `requestId` (`RUNNING_EVERY_MS`), đổi trạng thái thì gửi ngay. Bộ nhớ lần gửi
   (`createRelayMemory`) chỉ nằm trong phiên app.
3. Body `BugFindingResultBody` = `{companyId, machineId}` của sổ lượt + `requestId, state, headSha` và các trường có
   mặt `round, lanesDone, lanesTotal, verdict, costUsd, error` (`error` tối đa 1000 ký tự).
4. `succeeded`: đọc `<resultDir>/review-result.json`, rút gọn mỗi finding về đúng 12 trường (`summarizeFinding`: `id,
   rule, title, severity, certainty, status, action, mr_relation, location, fix, accept, question`; `location`
   `{file, line, symbol}` thành `file:line (symbol)`; thiếu `title` thì lấy `rule` rồi `id`, thiếu `status` thì `OPEN`,
   thiếu `severity` thì `INFO`; finding không có `id` bị bỏ; tối đa 500). Không có `verdict`, `resultDir`, hay không đọc
   được `review-result.json` thì gửi `failed` kèm lý do thay vì để lượt treo tới hết giờ.
5. Hàng đợi gửi `bugFindingOutbox` của `app.json` (`BugFindingOutboxItem {requestId, body, reportPath?, queuedAt}`):
   mỗi lượt Bug Finding giữ một mục, bản mới thay bản cũ; tối đa 200 mục (`OUTBOX_MAX`), bỏ mục cũ nhất. Báo cáo `.md`
   không nằm trong `app.json`: lúc gửi đọc lại `reportPath` (`withReport`), quá 2 MB thì `cutReport` cắt ở ranh giới
   ký tự UTF-8 và thêm dòng "(báo cáo bị cắt, xem đầy đủ trong Bug Finding)", tổng ≤ 2 MB (`REPORT_MAX_BYTES`); đọc
   không được thì gửi không có báo cáo.
6. Gửi lần lượt bằng `postBugFindingResult` (flow `mac-app-paperclip`) tới `setup.paperclipOrigin` với board key của
   origin đó. Lỗi mạng, timeout, 5xx, 429 hay chưa đăng nhập: dừng gửi, giữ mục đó và các mục sau cho lượt sau. 4xx
   khác (409 lượt đã kết thúc, 404, 403, 422 `head_mismatch`, 400) là server từ chối hẳn: bỏ mục, ghi
   `bug-finding-relay-rejected`. Kết quả cuối gửi xong hay bị từ chối hẳn thì đánh `delivered` trong sổ, không gửi lại.
   Ghi lại `app.json` chỉ khi có đổi; cờ `delivered` gộp vào sổ hiện có (`mergeDelivered`) để không mất lượt vừa nhận.

### Màn hình

`BugFindingScreen` (`src/renderer/routes/bug-finding.tsx`) theo mockup 1:

- Đầu trang: tiêu đề, mô tả, nút **Mở Bug Finding** (tắt khi chưa cài). Kết quả `standalone_running` hiện lỗi "Thoát
  Bug Finding (bản cài riêng) trước…", `missing` hiện "Không tìm thấy app Bug Finding đi kèm 2P Crew…". Chưa cài thì
  có cảnh báo ngay; bản cài riêng đang chạy cũng có cảnh báo ngay.
- Thẻ **Trạng thái app**: phiên bản, tiến trình (Đang chạy/Không chạy, pid), hàng đợi, kết nối với Crew ("Đã nhận tín
  hiệu N giây trước" / "Mất tín hiệu từ … trước" / "Chưa nhận tín hiệu"), bản cài riêng cũ (đường dẫn và nút **Chuyển
  vào Thùng rác**, tắt khi bản đó đang chạy).
- Thẻ **Đồng bộ project**: mô tả, nhãn "Đã đồng bộ N project" kèm "lần cuối HH:mm:ss dd/MM" (giờ `Asia/Ho_Chi_Minh`)
  hoặc "Chưa đồng bộ", nút **Đồng bộ lại** (xong thì báo "Đã đồng bộ N project").
- Thẻ **Project Crew ↔ Bug Finding**: bảng Project Crew, Repo trên máy của các project đã ghi sang Bug Finding. Cột
  "Nguồn MR/PR" và "Bên Bug Finding" của mockup cần đọc dữ liệu riêng của Bug Finding, bản này chưa có.
- Thẻ **MR do Crew xếp**: bảng Ticket tổng, PR, Lần (lần > 1 ghi "(chạy lại)"), Trạng thái (kèm "N/M lane xong" khi
  đang review), Kết quả (verdict hay lỗi), nút **Xem trong Bug Finding** (mở app).
- Đọc lại `bugFinding:state` khi nhận `state:changed` và mỗi 10 giây khi màn đang mở; rời màn thì dừng.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/mac-app/bug-finding.pin.json` | Ghim repo, commit (40 hex) và version của Bug Finding nhúng khi phát hành | `repo`, `commit`, `version` |
| `apps/mac-app/src/main/bug-finding/paths.ts` | Đường dẫn cầu nối, app nhúng, bản cài riêng, chọn app theo bản đóng gói/dev | `bugFindingPaths`, `embeddedAppPath`, `resolveAppPath`, `STANDALONE_APP_PATH`, `BUG_FINDING_BUNDLE_ID` |
| `apps/mac-app/src/main/bug-finding/state.ts` | Đọc heartbeat, bản cài riêng, yêu cầu/phản hồi thành trạng thái màn hình | `readBugFindingState`, `bugFindingRunningReviews`, `BugFindingView`, `BugFindingRequestRow`, `HEARTBEAT_STALE_SEC` |
| `apps/mac-app/src/main/bug-finding/launch.ts` | Mở app (chặn khi bản khác đang chạy), dò tiến trình, gỡ bản cài riêng | `launchBugFinding`, `runningBugFindingApps`, `parseRunningAppPaths`, `trashStandalone` |
| `apps/mac-app/src/main/bug-finding/sync-projects.ts` | Dựng danh sách project Crew có repo trên máy, ghi atomic `projects.json` khi đổi, chạy đồng bộ lần lượt và gộp lần nhờ | `buildCrewProjectList`, `createRepoResolver`, `syncProjects`, `createSyncRunner`, `jobChangesProjects` |
| `apps/mac-app/src/main/bug-finding/results.ts` | Đọc response của Bug Finding, rút gọn finding, cắt báo cáo, hàng đợi gửi, sổ lượt, chạy theo `fs.watch` + 30 giây | `relayResponses`, `startResultsRelay`, `summarizeFinding`, `cutReport`, `rememberRequest`, `mergeDelivered`, `readResponsesDir`, `BugFindingResultBody` |
| `apps/mac-app/src/main/bug-finding/register.ts` | Nối bốn kênh `bugFinding:*` vào Electron, lịch đồng bộ project, việc máy review ở Main, relay kết quả bằng board key | `registerBugFinding`, `PROJECT_SYNC_INTERVAL_MS` |
| `apps/mac-app/src/renderer/routes/bug-finding.tsx` | Màn hình Bug Finding | `BugFindingScreen` |

## Dữ liệu

- Đọc trong `~/Library/Application Support/MRReviewQueue/crew/` (`heartbeat.json`, `requests/`, `responses/`,
  `projects.json`). Chỉ ghi `projects.json` (schema `crew-projects/1`: id, khóa, tên, đường dẫn repo của project) và
  `requests/<requestId>.json` (schema `crew-review-request/1`), không đụng `responses/`.
- `app.json` của 2P Crew: `bugFindingRequests` (sổ lượt: `companyId`, `machineId`, giờ nhận, `delivered`; tối đa 200)
  và `bugFindingOutbox` (bản tin chưa gửi được, không chứa báo cáo; tối đa 200). Body gửi về server chỉ có trạng thái,
  finding rút gọn và báo cáo review; board key đọc từ Keychain mỗi lần gửi, không ghi vào file.
- `companyId` và id project Crew là uuid, không phải secret.
- Không có secret nào đi qua kênh `bugFinding:*`; renderer chỉ nhận trạng thái và đường dẫn app.

## Flow liên quan

- `mac-app`: khung app, hợp đồng IPC, thanh bên.
- `mac-app-update`: đóng gói app nhúng khi phát hành, updater (chờ Bug Finding hết lượt review, thoát rồi mới cài,
  mở lại sau khi bản mới khởi động).
- `mac-app-paperclip`: project và việc máy (job review của Bug Finding); template `AGENTS.md` theo vai của project
  app tạo (chép từ fork, gồm luồng ticket tổng `code-bf`: reviewer cầu nối nhận kết quả Bug Finding, Trợ Lý lập lô
  sửa finding, integrator mở pull request trước Bug Finding).

## Tests

- `apps/mac-app/test/bug-finding-launch.test.ts`: không mở bản nhúng khi bản riêng `/Applications` đang chạy; mở nền
  bằng `open -g`; mở thường khi bản nhúng đã chạy; không có app (cả bản dev không có đường dẫn) thì `missing`; `open`
  lỗi thì ném; `parseRunningAppPaths` đọc đầu ra `pgrep -fl`; `runningBugFindingApps` hỏi đúng mẫu, mã 1 thì rỗng;
  `trashStandalone` từ chối khi bản riêng chạy, chuyển vào Thùng rác khi không chạy, không còn thì không làm gì;
  `bugFindingPaths`, `embeddedAppPath`, `resolveAppPath` (đóng gói, dev có/không có `CREW_BUG_FINDING_APP`).
- `apps/mac-app/test/bug-finding-state.test.ts` (HOME tạm): heartbeat 20 giây với `running: 1` thì đang chạy 1 lượt;
  heartbeat 5 phút thì không chạy; không app không heartbeat thì chưa cài; có bản cài riêng thì `standaloneApp`; ghép
  yêu cầu với phản hồi, chưa có phản hồi là `pending`, file hỏng bị bỏ, sắp mới nhất lên đầu; đọc `projects.json`
  thành `sync`, `lastSyncAt` ưu tiên giờ Main báo; chưa có file thì `sync` rỗng.
- `apps/mac-app/test/renderer/bug-finding.test.tsx`: route nằm ngay sau Project; hiện trạng thái, hàng đợi, tín hiệu,
  bảng MR; nút mở gọi `bugFinding:open`, `standalone_running` báo thoát trước; chưa cài thì tắt nút mở; nút Thùng rác
  gọi `bugFinding:trashStandalone`; bản riêng đang chạy có cảnh báo; nghe `state:changed` và đọc lại mỗi 10 giây,
  rời màn thì dừng; số project đã đồng bộ, giờ lần cuối theo giờ Việt Nam, bảng project; chưa đồng bộ thì báo,
  **Đồng bộ lại** gọi `bugFinding:syncNow`.
- `apps/mac-app/test/bug-finding-sync.test.ts`: chỉ project có repo trên máy, giữ id Crew; repo chính của checkout khi
  không có `docsRepo`; cách lấy `key`; bỏ tiến độ thêm dở; thứ tự nguồn repo và `git --git-common-dir` bỏ `.git`;
  ghi `projects.json` không để file tạm; không ghi khi không đổi (bỏ qua `writtenAt`); ghi lại khi thêm project; ghi
  đè file hỏng; `jobChangesProjects`; `createSyncRunner` gộp lần nhờ, lỗi chỉ ghi log.
- `apps/mac-app/test/bug-finding-sync-wiring.test.ts` (mock Electron và `projects/ipc`, HOME tạm): đồng bộ khi mở
  app, mỗi 10 phút, qua `requestSync` và `bugFinding:syncNow`; chưa đăng nhập thì không, chọn company xong thì có;
  `projects:add`/`projects:remove` nhờ đồng bộ kể cả khi lỗi.
- `apps/mac-app/test/ipc-contract.test.ts`: bốn kênh `bugFinding:*` có trong `IPC_CHANNELS`.
- `apps/mac-app/test/bug-finding-results.test.ts` (deps giả trong file: response, file, `app.json`, Paperclip trong bộ
  nhớ): rút gọn đúng 12 trường và giữ hàng đợi khi gửi lỗi rồi gửi lại lượt sau; kết quả cuối đã gửi thì không gửi lại;
  hàng đợi không giữ báo cáo; báo cáo > 2 MB bị cắt kèm dòng ghi chú, ≤ 2 MB, không vỡ ký tự; báo cáo nhỏ nguyên văn;
  `running` tối đa 1 lần/phút, không đổi thì không gửi, xong thì gửi ngay; `queued` một lần; không đọc được
  `review-result.json` → `failed`; 409 bỏ hẳn, 5xx giữ; lượt lạ bỏ qua; hàng đợi tối đa 200 bỏ cũ nhất; bản mới thay
  bản cũ cùng `requestId`.
- `apps/mac-app/test/bug-finding-review-wiring.test.ts` (mock Electron, runner `pgrep`/`open`, board key, `fetch`;
  `AppStateStore` thật, HOME tạm): `runReview` ghi request, mở nền, ghi sổ lượt; response `succeeded` làm relay gửi
  `POST …/bug-finding/results` kèm báo cáo và đánh `delivered`.
- `apps/mac-app/test/bug-finding-e2e.test.tsx` (jsdom; `registerBugFinding` thật, handler IPC nối vào `window.crew`,
  màn `BugFindingScreen` thật, file cầu nối trong HOME tạm, server Paperclip giả HTTP thật; chỉ giả Electron và
  `pgrep`/`open`): màn hiện trạng thái từ `heartbeat.json` và `responses/` giả; bản cài riêng đang chạy thì nút Mở
  không gọi `open` và job `bug-finding-review` trả `standalone_running` không để lại file; **Đồng bộ lại** ghi đúng
  `crew/projects.json`; job `bug-finding-review` ghi `requests/<id>.json`, mở app nền, relay `running` rồi `succeeded`
  (kèm finding và báo cáo) lên `POST …/bug-finding/results` với board key.
- `apps/mac-app/test/bug-finding-swift-bridge.test.ts` + `test/fixtures/CrewBridgeLiveTests.swift` (chỉ chạy khi
  `CREW_BUG_FINDING_REPO` trỏ tới checkout dùng một lần của repo `bug-finding` ở commit có cầu nối, ví dụ
  `git worktree add --detach <thư mục tạm> <sha>`; spec chép fixture vào `Tests/MRQueueCoreTests/` rồi gỡ ra): code
  Swift thật (`CrewBridge`, `swift test --filter CrewBridgeLiveTests`) đọc `projects.json` và `requests/*.json` do
  mac-app ghi, quyết định `enqueue`, ghi `heartbeat.json` và `responses/*.json` (đang chạy 2/7 lane, rồi `succeeded`
  APPROVE); mac-app đọc lại thành trạng thái màn hình và relay kết quả. Không khởi động app Bug Finding thật vì app
  dùng thư mục dữ liệu cố định `~/Library/Application Support/MRReviewQueue`, trùng với bản đang chạy của owner.
