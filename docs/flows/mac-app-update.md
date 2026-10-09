# Phát hành và cập nhật app 2P Crew

> Flow `mac-app-update`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-app-update` in ra đúng danh sách đó.

## Mục đích

Ra bản app macOS 2P Crew (bundle `com.2p-solutions.crew.mac`) ký Developer ID, notarize và staple bằng một script
chạy trên Mac mini, rồi đăng lên GitHub Releases `nquangphan/crew-mac-releases` để updater trong app tự lấy. Trong
app, updater kiểm bản mới, tải, chờ máy rảnh mới cài, tự kiểm bản mới 5 phút (probation) và tự quay về bản trước khi
hỏng; owner xem và bấm ở màn hình Cập nhật.

## Điểm vào

- `node apps/mac-app/scripts/release.mjs` hoặc `pnpm --filter @crew/mac-app release` (chạy từ bất kỳ đâu trong
  repo; script tự tìm gốc repo bằng git).
- `src/main/update/register.ts` → `registerUpdate(ctx, sshd)`: một dòng trong `src/main/index.ts`, ngay sau
  `registerSshd` (supervisor đã `start()`).
- Màn hình Cập nhật: route `update` (`src/renderer/routes/update.tsx`, `UpdateScreen`).

## Phát hành

### Chế độ

| Lệnh | Ký | Notarize + staple | Kiểm tag | Đăng GitHub |
|---|---|---|---|---|
| `release.mjs` hoặc `release.mjs --no-publish` | Developer ID Application (team `J7Y2DL6HZV`) | app và dmg | có | không |
| `release.mjs --publish` | như trên | như trên | có | có |
| `release.mjs --dev-sign [--no-publish]` | Apple Development của team `J7Y2DL6HZV` | không | không | không bao giờ |
| `release.mjs --dry-run` | không ký | không | không | không bao giờ |

`--identity "<tên đầy đủ>"` chọn danh tính khi Keychain có nhiều cái hợp lệ (phải đúng loại và đúng team).
`--publish` cùng `--dev-sign`/`--dry-run`/`--no-publish`, hay cờ lạ, bị từ chối (mã 1). Đăng GitHub chỉ xảy ra khi
gõ `--publish`.

### Điều kiện

- Cây git sạch (`git status --porcelain` rỗng), ở mọi chế độ.
- Bản phát hành: tag nguồn `mac-app/v<version>` trỏ đúng HEAD, `version` trong `apps/mac-app/package.json` là
  semver `x.y.z` (không prerelease vì updater không nhận prerelease).
- Bản phát hành: Keychain có đúng một `Developer ID Application` của team `J7Y2DL6HZV` và notary profile
  `crew-notary`. Thiếu cái nào script báo đủ cả hai lý do ("Chưa có Developer ID Application …", "Chưa có notary
  profile crew-notary …") rồi dừng mã 4, trước khi build.
- `--dev-sign`: Keychain có đúng một `Apple Development` mà chứng chỉ có `OU=J7Y2DL6HZV` (script đọc phần công khai
  của chứng chỉ bằng `security find-certificate -p`).

### Các bước

1. Kiểm cây, tag (bản phát hành), danh tính (`security find-identity -v -p codesigning`, chỉ giữ tên) và notary
   profile (`xcrun notarytool history --keychain-profile crew-notary`, không in đầu ra).
2. `pnpm --filter @crew/mac build` (bản `crew-mac` mang theo), `pnpm --filter @crew/mac-app build`.
3. `electron-builder --mac zip --arm64 --publish never` trong `apps/mac-app` với env `CSC_NAME=<tên bỏ tiền tố loại>`
   và `CSC_IDENTITY_AUTO_DISCOVERY=false`; `--dev-sign` thêm `--config.mac.type=development`. Ra
   `~/Library/Caches/2p-crew-release/mac-arm64/2P Crew.app` có `Contents/Resources/app-update.yml` (từ mục
   `publish`; electron-builder chỉ ghi file này khi target có zip/dmg, nên bước này dùng target zip thay vì dir, zip
   tạm của nó bị bước 5 ghi đè). Thư mục ra đặt bằng `--config.directories.output` và cố ý nằm ngoài
   `~/Documents`: repo trên Mac mini ở `~/Documents` do iCloud (File Provider) quản, nó gắn `com.apple.FinderInfo`
   vào mọi bundle mới tạo và codesign báo "resource fork, Finder information, or similar detritus not allowed".
4. Bản phát hành: `ditto -c -k --keepParent` app → `xcrun notarytool submit … --keychain-profile crew-notary --wait
   --output-format json` (status phải `Accepted`) → `xcrun stapler staple` app.
5. `electron-builder --mac zip dmg --arm64 --prepackaged <app> --publish never`: đóng gói từ bản đã ký (đã staple),
   không ký lại. Ra `2P-Crew-<version>-arm64-mac.zip`, `2P-Crew-<version>-arm64.dmg`, hai `.blockmap`,
   `latest-mac.yml` trong `~/Library/Caches/2p-crew-release/`.
6. Bản phát hành: notarize + staple dmg như bước 4.
7. Tự kiểm:
   - `codesign --verify --deep --strict` app, và app giải nén từ zip (Squirrel.Mac cài từ zip).
   - `codesign -dv`: `Identifier` = bundle id, `Authority` đúng loại, `TeamIdentifier` = `J7Y2DL6HZV`, hardened runtime.
   - `Info.plist`: bundle id, `CFBundleName` 2P Crew, `CFBundleShortVersionString` = version, đủ 4 lời xin quyền.
   - `app-update.yml` trỏ `nquangphan/crew-mac-releases`; `latest-mac.yml` đúng version và tên zip; đủ file.
   - Bản phát hành thêm: `spctl -a -vv` (accepted, `Notarized Developer ID`), `stapler validate` app và dmg,
     designated requirement có `subject.OU = J7Y2DL6HZV`.
8. Có `--publish`: `gh release create v<version> --repo nquangphan/crew-mac-releases` kèm zip, dmg, hai blockmap,
   `latest-mac.yml`.
9. In đường dẫn, sha256 của zip/dmg/`latest-mac.yml`, tên danh tính và Team ID.

### Mã thoát

| Mã | Nghĩa |
|---|---|
| 0 | xong |
| 1 | đối số sai |
| 2 | cây git bẩn |
| 3 | tag sai/thiếu hoặc version không phải semver |
| 4 | thiếu/nhiều danh tính ký, hoặc thiếu notary profile `crew-notary` |
| 5 | build/đóng gói lỗi |
| 6 | notarize hoặc staple lỗi |
| 7 | tự kiểm lỗi |
| 8 | đăng GitHub lỗi |

### Việc owner làm một lần

- Tạo chứng chỉ `Developer ID Application` của 2P SOLUTIONS trên developer.apple.com, cài vào login Keychain.
- `xcrun notarytool store-credentials crew-notary` rồi nhập Apple ID, Team ID, app-specific password khi được hỏi.
  Secret nằm trong Keychain; script không bao giờ nhận mật khẩu qua đối số hay env.
- Tạo tag nguồn trước mỗi bản: `git tag mac-app/v<version>` (đẩy tag khi owner nói "push").

### An toàn

- Mọi lệnh chạy bằng `spawn`/`spawnSync` với mảng đối số, không shell. Không in `process.env`.
- Log của electron-builder và các công cụ đi qua `maskHashes` (che chuỗi hex 40 ký tự: hash danh tính, CDHash).
- `--dev-sign`/`--dry-run` không có bước `gh` trong danh sách lệnh, kể cả khi gọi sai.
- Bản Apple Development không qua được Gatekeeper trên máy khác và không dùng cho updater (Squirrel.Mac từ chối bản
  khác designated requirement); chỉ để chạy thử trên Mac mini.

## Updater trong app

### Khi nào bật

Updater chỉ bật khi đủ ba điều kiện; thiếu cái nào thì `UpdateView.enabled = false`, màn hình hiện lý do và app
không bao giờ gọi GitHub:

| Điều kiện | Lý do hiện khi thiếu |
|---|---|
| Bản đóng gói (`app.isPackaged`) | "Bản chạy thử (chưa đóng gói), cập nhật tự động tắt" |
| App chạy từ `/Applications/2P Crew.app` (Squirrel thay tại chỗ, helper quay lui chỉ ghi vào đây) | "App không chạy từ /Applications/2P Crew.app, cập nhật tự động tắt" |
| `codesign -dv --verbose=2` có `Authority=Developer ID Application: …` (`developerIdFromCodesign`) | "Bản này không ký Developer ID, cập nhật tự động tắt" |

Probation và marker quay lui vẫn chạy khi updater tắt (không gọi mạng).

### Đổi chữ ký Apple Development → Developer ID: cài tay một lần

Squirrel.Mac (bên dưới `electron-updater` trên macOS) chỉ cài bản tải về khi bản đó thỏa **designated requirement
của bản đang chạy**. Bản ký Apple Development (CV-1) có requirement theo tên chứng chỉ leaf
(`certificate leaf[subject.CN] = "Apple Development: …"`), không theo Team ID; bản Developer ID có requirement theo
`certificate leaf[subject.OU] = J7Y2DL6HZV`. Hai requirement khác nhau, nên:

- Bản Apple Development tự tắt updater (bảng trên), không thử tải bản Developer ID.
- Lần đầu lên bản Developer ID phải **cài tay một lần** (UPD-3): thoát app ("Thoát ngay, run vẫn chạy"), thay
  `/Applications/2P Crew.app` bằng app trong dmg/zip đã notarize (`ditto`), mở lại. Quyền macOS (Full Disk Access)
  gắn theo requirement nên phải cấp lại một lần cho bản mới.
- Từ đó các bản Developer ID nối tiếp cùng Team ID tự cập nhật bình thường. Đổi Team ID hay quay lại Apple Development
  cũng phải cài tay như trên.

### Máy trạng thái (`updateState` trong `app.json`)

`idle → downloading → waiting-idle → installing → (app mới mở) probation → idle | rolled-back`.

Chỉ Main ghi `app.json` (qua `AppStateStore.update`); `crew-mac status` đọc `updateState` gửi lên thẻ máy. Mọi giá
trị đều thuộc `UpdateState` (`idle`, `downloading`, `waiting-idle`, `installing`, `probation`, `rolled-back`), đúng
bộ mà `readAppState` của crew-mac và parser `machine-status` của plugin nhận; giá trị lạ làm thẻ máy bỏ cả trường
`app`, nên updater không ghi giá trị nào khác. Nhãn tiếng Việt (`UPDATE_STATE_LABEL`) khớp thẻ máy: Đã cập nhật, Đang
tải bản mới, Chờ máy rảnh để cài, Đang cài, Đang thử bản mới, Đã quay về bản trước.

### Kiểm và tải (`updater.ts`, `versions.ts`)

1. Kiểm khi mở app (sau probation), mỗi 1 giờ (`CHECK_INTERVAL_MS`) và khi bấm "Kiểm ngay". Không kiểm khi đang
   `downloading`, `installing`, `probation` hay đang chờ rảnh.
2. `autoDownload`, `autoInstallOnAppQuit`, `allowDowngrade`, `allowPrerelease` đều `false`. Feed là
   `latest-mac.yml` của release mới nhất trong `nquangphan/crew-mac-releases` (từ `app-update.yml` trong bundle).
3. `update-available` → `judgeCandidate`: bản phải là `x.y.z` lớn hơn bản đang chạy, không nằm trong
   `update.badVersions`, và `files` có zip arm64. Bản trong `badVersions` → log `update-skipped-bad`, không tải. Hợp
   lệ → log `update-available`, `downloading`, `downloadUpdate()`.
4. Repo chưa có release (`ERR_UPDATER_NO_PUBLISHED_VERSIONS`, 404 feed) không phải lỗi. Lỗi khác hiện ở màn hình
   ("Lỗi kiểm cập nhật: …"), đang tải thì về `idle`.

### Cài: chờ máy rảnh (`drain.ts`)

`update-downloaded` → log `update-downloaded`, rồi:

1. `baseline` = id các check `fail` của `doctor({ probe: false })` lúc này, cộng id giả `send-status` nếu bản tin máy
   đang không gửi được. Ghi `update.baseline`, trạng thái `waiting-idle`.
2. `drainForUpdate`: `sshd.pause()` (TERM listener của app; phiên SSH của run đang chạy vẫn sống, run mới bị H1 giữ
   `queued`), đếm `sshd.activeRuns()` mỗi 10 giây. Hết run → cài. Không bao giờ gửi tín hiệu cho phiên SSH hay
   `claude`.
3. Quá 30 phút còn run (hay không đọc được bảng process): `resume()` listener trước (hộp thoại có thể chờ owner rất
   lâu, máy không được đứng im), rồi hỏi "Cài ngay, run vẫn chạy" / "Để sau" (mặc định "Để sau"). "Để sau" → giữ
   `waiting-idle`; tải lại đúng bản đó không hỏi lại; owner bấm "Cài khi rảnh" để chạy lại bước chờ.
4. Cài: `snapshotPrevious` (xóa `previous/` cũ và marker probation cũ, `ditto` app đang chạy vào
   `~/Library/Application Support/2P Crew/previous/2P Crew.app`, ghi `previous/version`); hỏng thì log
   `update-install-aborted`, `resume()`, không cài. Rồi sinh helper `watchdog`, ghi `installing` + `update.from`,
   `update.to`, `update.installedAt`, log `update-installing`, `sshd.stopForQuit()`, `quitAndInstall(false, true)`.
   Squirrel thay bundle và mở lại app.

Lưu ý: `quitAndInstall` đi qua `before-quit`, nên quit guard (flow `mac-app-sshd`) hỏi lại nếu owner chọn "Cài ngay"
khi còn run (nút mặc định "Thoát ngay, run vẫn chạy"); khi 0 run guard không hỏi.

### Tự kiểm sau cài (`probation.ts`)

`runProbation` chạy ngay khi app mở, trước khi updater kiểm bản mới:

- Marker `probation/rolled-back` (helper vừa quay lui) → log `update-rolled-back`, thêm bản đó vào `badVersions`,
  `rolled-back`, xóa marker.
- `installing`/`probation` mà bản đang chạy khác `update.to` (Squirrel không thay được) → ghi `<to>.failed` (gỡ
  watchdog), về `idle`, log `update-install-missing`.
- `installing`/`probation` và bản đang chạy là `update.to` → `probation`, tối đa 5 phút (`PROBATION_MS`):
  1. listener của app `running` (chờ, kiểm mỗi 5 giây); supervisor `disabled` (chế độ LaunchAgent) thì bỏ qua;
  2. `doctor({ probe: false })` không có `fail` nào ngoài `baseline`;
  3. `sendStatus` gửi được (thử lại mỗi 30 giây tới hết 5 phút), trừ khi `baseline` có `send-status`.
- Đạt → ghi `probation/<bản>.ok`, `idle`, log `update-installed`; rồi `installCrewMacWhenIdle`: chờ 0 run (kiểm mỗi
  10 phút) và gọi `installCrewMacFrom(<resources>/crew-mac)` một lần (crew-mac tự từ chối khi còn run thì chờ tiếp).
- Hỏng → log `update-probation-failed` kèm lý do ("sshd không lên", "doctor có lỗi mới: <id>", "không gửi được bản
  tin máy"), thêm bản vào `badVersions`, `rolled-back`, sinh helper `now`, `sshd.stopForQuit()`, `app.exit(0)`.
  Không có `previous/` thì không thoát (thoát là mất app): ghi `.failed`, về `idle`, giữ bản này.

### `previous/`, helper và watchdog (`rollback.ts`, `rollback-helper.sh`)

`rollback-helper.sh <now|watchdog> <pid> <support> <bản>` nằm trong `Contents/Resources/` (`extraResources`), chạy
bằng `/bin/sh` tách rời (`detached`, `stdio: 'ignore'`, `unref`), sống qua lúc app thoát hay bị thay:

- `now`: ghi `probation/<bản>.failed`, chờ pid thoát, thay `/Applications/2P Crew.app` bằng `previous/2P Crew.app`
  (`mv` sang `.rollback-tmp`, `ditto`, hỏng thì trả bản cũ về, mã 4), ghi `probation/rolled-back`, `open` app.
- `watchdog` (sinh trước `quitAndInstall`): ngủ 6 phút; có `<bản>.ok` hay `<bản>.failed` thì thôi; không thì bản mới
  treo hay không mở được: `pkill -TERM` đúng binary `/Applications/2P Crew.app/Contents/MacOS/2P Crew`, rồi quay lui
  như `now`.
- Không có `previous/` → thoát 3, không đụng app.
- Chỉ ghi vào `/Applications/2P Crew.app` (và `.rollback-tmp` cạnh nó) và `~/Library/Application Support/2P Crew/`.

### Quay lui tay

Nút "Quay về bản trước" (`update:rollback`) chỉ bật khi có `previous/`; không có thì lỗi "Chưa có bản trước". Còn run
thì hỏi xác nhận trước. Đồng ý: thêm bản đang chạy vào `badVersions`, `rolled-back`, log
`update-rollback-requested`, helper `now`, `stopForQuit`, `app.exit(0)`. Bản cũ hơn nữa: tải dmg của tag đó trên
Releases và cài tay. Sửa lỗi lâu dài bằng bản mới số cao hơn.

### Kênh IPC và sự kiện log

- `update:state` → `UpdateView { current, available, state, previous, enabled, reason, lastCheckedAt }`;
  `update:check`; `update:installWhenIdle` (lỗi "Chưa có bản mới đã tải" khi chưa có); `update:rollback`.
- `app.log`: `update-available`, `update-skipped-bad`, `update-skipped`, `update-downloaded`, `update-deferred`,
  `update-install-aborted`, `update-installing`, `update-installed`, `update-install-missing`,
  `update-probation-failed`, `update-rolled-back`, `update-rollback-requested`, `update-error`, `crew-mac-installed`,
  `updater-log` (cảnh báo/lỗi của electron-updater).
- Màn hình Cập nhật: bản đang chạy, bản mới, bản trước, trạng thái, giờ kiểm cuối (giờ Việt Nam); nút "Kiểm ngay",
  "Cài khi rảnh" (chỉ khi `waiting-idle`), "Quay về bản trước". Đọc lại mỗi 15 giây và khi `state:changed`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/mac-app/scripts/release.mjs` | Trình tự phát hành: kiểm, chạy lệnh, tự kiểm, đăng | `main`, `resolveIdentity`, `verify` |
| `apps/mac-app/scripts/release-lib.mjs` | Hàm thuần: đối số, tag, cây sạch, chọn danh tính, dựng lệnh, đọc kết quả kiểm | `parseArgs`, `checkTag`, `pickIdentity`, `findDeveloperId`, `buildCommands`, `checkSignature`, `EXIT` |
| `apps/mac-app/electron-builder.yml` | Mục `publish` (kênh phát hành), tên file phát hành, `extraResources` mang helper quay lui | `publish`, `artifactName`, `extraResources` |
| `apps/mac-app/src/main/update/register.ts` | Nối updater vào Electron: điều kiện bật, hộp thoại, kênh `update:*`, chạy probation rồi kiểm | `registerUpdate` |
| `apps/mac-app/src/main/update/updater.ts` | Máy trạng thái kiểm/tải/chờ rảnh/cài, quay lui tay | `createUpdater`, `CHECK_INTERVAL_MS`, `DISABLED_UNSIGNED` |
| `apps/mac-app/src/main/update/versions.ts` | Lọc bản trên feed: tăng, `x.y.z`, không `badVersions`, có zip arm64 | `compareSemver`, `judgeCandidate`, `shouldOffer` |
| `apps/mac-app/src/main/update/drain.ts` | Chờ máy rảnh trước khi cài | `drainForUpdate`, `DRAIN_POLL_MS`, `DRAIN_MAX_MS` |
| `apps/mac-app/src/main/update/probation.ts` | Tự kiểm 5 phút sau cài, đọc marker quay lui, cài `crew-mac` mang theo khi rảnh | `runProbation`, `installCrewMacWhenIdle`, `PROBATION_MS` |
| `apps/mac-app/src/main/update/rollback.ts` | `previous/`, marker probation, sinh helper, nhận Developer ID | `snapshotPrevious`, `spawnRollbackHelper`, `fileMarkers`, `developerIdFromCodesign` |
| `apps/mac-app/src/main/update/rollback-helper.sh` | Helper shell tách rời: quay lui ngay hoặc watchdog 6 phút | — |
| `apps/mac-app/src/renderer/routes/update.tsx` | Màn hình Cập nhật | `UpdateScreen`, `UPDATE_STATE_LABEL` |

## Dữ liệu

- Đọc: `apps/mac-app/package.json` (`version`), Keychain (tên danh tính, phần công khai của chứng chỉ, notary
  profile qua `notarytool`).
- Ghi: `apps/mac-app/out/` (gitignored), `~/Library/Caches/2p-crew-release/` (bản build, ghi đè mỗi lần), thư mục tạm `crew-mac-release-*` trong `$TMPDIR`
  (xóa khi xong).
- Ngoài máy: Apple notary service (bản phát hành), GitHub Releases (chỉ khi `--publish`).
- Updater đọc/ghi: `app.json` (`updateState`, `update.from/to/installedAt/badVersions/baseline`, chỉ Main ghi),
  `~/Library/Application Support/2P Crew/previous/` (một bản app + `version`), `…/probation/` (`<bản>.ok`,
  `<bản>.failed`, `rolled-back`), `app.log`. Đọc GitHub Releases `nquangphan/crew-mac-releases` (chỉ khi bật).
  Thay `/Applications/2P Crew.app` (Squirrel khi cài, helper khi quay lui).

## Flow liên quan

- `mac-app`: khung app, `electron-builder.yml` (bundle id, Info.plist, entitlements, mang `crew-mac`).
- `mac-setup`: bản `crew-mac` được build và mang theo trong `Contents/Resources/crew-mac`; `installCrewMacFrom` cài
  nó sau khi bản mới qua probation; `readAppState` đọc `updateState` cho bản tin máy.
- `mac-app-sshd`: `pause`/`resume`/`stopForQuit`/`activeRuns`/`status` của supervisor (drain, probation), quit guard.

## Tests

- `apps/mac-app/scripts/release-lib.test.mjs` (`node --test`): đối số và cờ mâu thuẫn; tag tại HEAD và semver; cây
  sạch; đọc danh tính không giữ hash; chọn Developer ID/Apple Development theo loại, team, `--identity`; `CSC_NAME`
  bỏ tiền tố; notary profile có/thiếu/lỗi và câu báo thiếu; JSON notarytool; spctl, designated requirement,
  `codesign -dv`; Info.plist, `app-update.yml`, `latest-mac.yml`; che hash; thư mục ra ngoài `~/Documents`; danh sách lệnh của ba chế độ (không
  notarytool/`gh` ở bản thử, `gh` chỉ khi `--publish`).
- `apps/mac-app/test/update-versions.test.ts`: so semver theo số; chỉ bản tăng; `badVersions`; zip arm64; prerelease.
- `apps/mac-app/test/update-drain.test.ts` (đồng hồ giả): 0 run cài ngay; chờ tới 20 phút, kiểm mỗi 10 giây, không
  hỏi; quá 30 phút mở lại listener rồi hỏi, "Để sau"/"Cài ngay"; bảng process lỗi không cài im lặng.
- `apps/mac-app/test/update-rollback.test.ts`: bundle từ exe; Developer ID vs Apple Development; `snapshotPrevious`
  giữ 1 bản (ditto thật trong thư mục tạm), ditto hỏng không có bản trước; spawn tách rời; marker; chạy thật
  `rollback-helper.sh` trong thư mục tạm (`now`, watchdog có `.ok`/`.failed`/hết giờ, thiếu `previous/` mã 3).
- `apps/mac-app/test/update-probation.test.ts` (deps giả): đạt; sshd không lên; doctor lỗi mới; bản tin hỏng (thử
  lại); baseline `send-status`; chế độ LaunchAgent; marker `rolled-back`; không phải `installing`; Squirrel không
  thay; không có bản trước; cài `crew-mac` khi rảnh và thử lại khi bị từ chối vì run.
- `apps/mac-app/test/update-updater.test.ts` (autoUpdater giả): cấu hình bốn cờ; tắt khi không ký Developer ID;
  kiểm lúc mở/mỗi giờ/khi bấm; bản hợp lệ tải; `badVersions`; không arm64; trình tự cài; baseline `send-status`;
  "Để sau" và "Cài khi rảnh"; snapshot hỏng; không kiểm khi đang cài; lỗi kiểm và repo chưa có release; quay lui tay
  (hỏi khi có run, hủy, chưa có bản trước); feed giả qua HTTP local (`latest-mac.yml` đọc bằng `parseUpdateInfo` của
  electron-updater + zip giả): arm64 tăng thì tải và cài, x64 hay bản cũ thì không tải.
- `apps/mac-app/test/renderer/update.test.tsx` (jsdom): route thật; nhãn trạng thái; bộ trạng thái trùng `UPDATE_STATES` của crew-mac; bản/giờ Việt Nam; các nút bật/tắt
  đúng lúc; lý do khi tắt; lỗi quay lui.

Chưa chạy end-to-end với app đóng gói thật (Squirrel thay bundle, helper trên `/Applications`): để cổng 5 nghiệm thu.
