# Phát hành và cập nhật app 2P Crew

> Flow `mac-app-update`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-app-update` in ra đúng danh sách đó.

## Mục đích

Ra bản app macOS 2P Crew (bundle `com.2p-solutions.crew.mac`) ký Developer ID, notarize và staple bằng một script
chạy trên Mac mini, rồi đăng lên GitHub Releases `nquangphan/crew-mac-releases` để updater trong app tự lấy. Trong
app, updater kiểm bản mới, tải, chờ máy rảnh mới cài, tự kiểm bản mới (probation, tối đa 16 phút) và tự quay về bản trước khi
hỏng; owner xem và bấm ở màn hình Cập nhật.

## Điểm vào

- `node apps/mac-app/scripts/release.mjs` hoặc `pnpm --filter @crew/mac-app release` (chạy từ bất kỳ đâu trong
  repo; script tự tìm gốc repo bằng git).
- `src/main/update/register.ts` → `registerUpdate(ctx, sshd)`: một dòng trong `src/main/index.ts`, ngay sau
  `registerSshd` (supervisor đã `start()`). `sshd` là `SshdRuntime` (supervisor + quit guard, flow `mac-app-sshd`
  mục Interface); updater dùng `pause`/`resume`/`activeRuns`/`stopForQuit` và `allowQuitForUpdate`.
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
- Mọi chế độ: `swift --version` chạy được và là Swift 6 trở lên (Command Line Tools). Không có thì dừng mã 9 với câu
  "Cần Swift 6 (Command Line Tools) để build Bug Finding", trước khi build.
- Mọi chế độ: `apps/mac-app/bug-finding.pin.json` hợp lệ (`repo` không rỗng, `commit` đủ 40 hex, có `version`), và
  commit ghim lấy được từ `repo` (hay từ `CREW_BUG_FINDING_REPO` khi commit chưa có trên remote; flow
  `mac-bug-finding`, mục "Bản nhúng và file ghim").

### Các bước

1. Kiểm cây, tag (bản phát hành), danh tính (`security find-identity -v -p codesigning`, chỉ giữ tên) và notary
   profile (`xcrun notarytool history --keychain-profile crew-notary`, không in đầu ra).
2. Build Bug Finding (`buildBugFinding` trong `release.mjs`): thư mục tạm `crew-bug-finding-*` trong `$TMPDIR`,
   `git clone --no-checkout <repo> <tạm>/bf`, `git -C <tạm>/bf checkout --detach <commit>`, kiểm `rev-parse HEAD`
   đúng commit ghim, rồi chạy lệnh của `bugFindingBuildCommands({checkout, outDir, identity})`:
   `bash <tạm>/bf/apps/mr-review-queue/scripts/build-app.sh --out <tạm>/out --sign "<danh tính>" --hardened-runtime`
   (env thêm `CSC_NAME`). Bản phát hành ký bằng chính Developer ID của 2P Crew, `--dev-sign` bằng Apple Development;
   `--dry-run` không có danh tính nên truyền `--sign -` (ký ad-hoc, không hardened runtime), không để `build-app.sh` tự
   tìm hay tạo chứng chỉ trong Keychain. `CFBundleShortVersionString` của app build ra phải bằng `version` của file
   ghim (sai thì mã 7). `ditto` app vào `apps/mac-app/build/bug-finding/Bug Finding.app` (xóa bản cũ trước,
   gitignored), xóa thư mục tạm dù lỗi hay không. Clone, checkout, build lỗi thì mã 5.
3. `pnpm --filter @crew/docs-kit build` (bundle `crew-docs.cjs` mang theo trong `Contents/Resources/crew-docs.cjs`,
   app cài ra `~/.crew/bin/crew-docs.cjs` mỗi lần mở, xem flow `mac-app-paperclip`), `pnpm --filter @crew/mac build`
   (bản `crew-mac` mang theo), `pnpm --filter @crew/mac-app build`. Script `package` của `apps/mac-app` cũng build
   `@crew/docs-kit` trước `electron-builder`.
4. `electron-builder --mac zip --arm64 --publish never` trong `apps/mac-app` với env `CSC_NAME=<tên bỏ tiền tố loại>`
   và `CSC_IDENTITY_AUTO_DISCOVERY=false`; `--dev-sign` thêm `--config.mac.type=development`. Ra
   `~/Library/Caches/2p-crew-release/mac-arm64/2P Crew.app` có `Contents/Resources/app-update.yml` (từ mục
   `publish`; electron-builder chỉ ghi file này khi target có zip/dmg, nên bước này dùng target zip thay vì dir, zip
   tạm của nó bị bước 6 ghi đè). Thư mục ra đặt bằng `--config.directories.output` và cố ý nằm ngoài
   `~/Documents`: repo trên Mac mini ở `~/Documents` do iCloud (File Provider) quản, nó gắn `com.apple.FinderInfo`
   vào mọi bundle mới tạo và codesign báo "resource fork, Finder information, or similar detritus not allowed".
5. Bản phát hành: `ditto -c -k --keepParent` app → `xcrun notarytool submit … --keychain-profile crew-notary --wait
   --output-format json` (status phải `Accepted`) → `xcrun stapler staple` app.
6. `electron-builder --mac zip dmg --arm64 --prepackaged <app> --publish never`: đóng gói từ bản đã ký (đã staple),
   không ký lại. Ra `2P-Crew-<version>-arm64-mac.zip`, `2P-Crew-<version>-arm64.dmg`, hai `.blockmap`,
   `latest-mac.yml` trong `~/Library/Caches/2p-crew-release/`.
7. Bản phát hành: notarize + staple dmg như bước 5.
8. Tự kiểm:
   - `codesign --verify --deep --strict` app, và app giải nén từ zip (Squirrel.Mac cài từ zip).
   - `codesign -dv`: `Identifier` = bundle id, `Authority` đúng loại, `TeamIdentifier` = `J7Y2DL6HZV`, hardened runtime.
   - `Info.plist`: bundle id, `CFBundleName` 2P Crew, `CFBundleShortVersionString` = version, đủ 4 lời xin quyền.
   - `app-update.yml` trỏ `nquangphan/crew-mac-releases`; `latest-mac.yml` đúng version và tên zip; đủ file.
   - Có `Contents/Resources/crew-docs.cjs` (bundle crew-docs mang theo).
   - Có `Contents/Resources/Bug Finding.app` (Bug Finding nhúng, in kèm version). Chữ ký của nó nằm trong
     `codesign --verify --deep --strict` của app 2P Crew ở trên. Ở chế độ có ký, `verifyBugFinding` đọc riêng chữ ký
     của bản nhúng (cả trong app lẫn trong zip) bằng `codesign -dv` và `codesign -d --entitlements - --xml`
     (`checkBugFindingSignature`, xem "Bug Finding nhúng giữ chữ ký riêng" bên dưới).
   - Bản phát hành thêm: `spctl -a -vv` (accepted, `Notarized Developer ID`), `stapler validate` app và dmg,
     designated requirement có `subject.OU = J7Y2DL6HZV`.
9. Có `--publish` (sau tự kiểm, `publishCommands`): `gh release view v<version> --repo nquangphan/crew-mac-releases
   --json isDraft` cho biết trạng thái (`releaseState`): `missing`, `draft`, `published`, hay `error` (dừng, mã 8, không
   đoán là chưa có release). Chưa có release thì `gh release create --draft`, không kèm file. Sau đó `gh release upload
   --clobber` zip, dmg và hai blockmap, rồi `latest-mac.yml` (tải sau cùng nên không bao giờ trỏ tới zip chưa có), cuối
   cùng `gh release edit --draft=false --latest`. Lỗi giữa chừng thì chạy lại `release.mjs --publish`: script dùng lại
   release đã có và thay file. Release còn ở dạng nháp thì updater không thấy bản dở. Chạy lại trên release đã công
   khai thì `--clobber` xóa rồi tải lại từng file, nên có một khoảng ngắn `latest-mac.yml` vắng (updater thấy 404, coi
   là chưa có bản mới; không hỏng máy).
10. In đường dẫn, sha256 của zip/dmg/`latest-mac.yml`, tên danh tính và Team ID.

### Bug Finding nhúng giữ chữ ký riêng

`build-app.sh` của repo bug-finding ký `Bug Finding.app` bằng chính danh tính phát hành, kèm hardened runtime, secure
timestamp và entitlements riêng (chỉ `com.apple.security.network.client`). `electron-builder.yml` có `mac.signIgnore`
khớp `/Contents/Resources/Bug Finding.app` nên electron-builder không ký lại nó bằng entitlements Electron. Chữ ký của
2P Crew vẫn niêm phong nó như code lồng bên trong, và nó được notarize cùng 2P Crew. Ở chế độ có ký, bước tự kiểm
(`checkBugFindingSignature`) đọc chữ ký của bản nhúng, cả trong app lẫn trong zip: bundle id `local.mrreviewqueue`, cùng
loại danh tính và Team ID với 2P Crew, hardened runtime, có `Timestamp=`, và entitlements đúng
`BUG_FINDING_ENTITLEMENTS`. Bug Finding đổi entitlements thì phải sửa hằng này cùng lúc với `bug-finding.pin.json`.
`--dry-run` bỏ qua bước này.

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
| 9 | thiếu Swift 6 (Command Line Tools) để build Bug Finding |

### Việc owner làm một lần

- Tạo chứng chỉ `Developer ID Application` của 2P SOLUTIONS trên developer.apple.com, cài vào login Keychain.
- `xcrun notarytool store-credentials crew-notary` rồi nhập Apple ID, Team ID, app-specific password khi được hỏi.
  Secret nằm trong Keychain; script không bao giờ nhận mật khẩu qua đối số hay env.
- Tạo tag nguồn trước mỗi bản: `git tag mac-app/v<version>` (đẩy tag khi owner nói "push").

### An toàn

- Mọi lệnh chạy bằng `spawn`/`spawnSync` với mảng đối số, không shell. Không in `process.env`.
- Mọi log và lỗi của `release.mjs` (`say`, log của electron-builder và các công cụ gồm stderr của `git clone`, lỗi
  `codesign --verify`, thông báo `Stop` và stack) đi qua `scrubLog`: che chuỗi hex 40 ký tự (hash danh tính, CDHash) và
  userinfo của URL (`https://user:token@…` thành `https://***@…`, `redactUrlCredentials`). Token đặt trong
  `CREW_BUG_FINDING_REPO` không ra log.
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
   `queued`), rồi đóng cổng mở Bug Finding (`BugFindingDrain.hold` = `LaunchGate.close`, chờ các lần mở đang chạy xong;
   log `bug-finding-gate-closed`): từ đây tới khi cài hay hủy, việc `bug-finding-review` bị từ chối (`app_error`
   "2P Crew đang chờ cài bản mới…") và nút **Mở Bug Finding** báo đang chờ cài, nên không gì mở lại Bug Finding sau khi
   drain đã thoát nó. Đếm `sshd.activeRuns()` mỗi 10 giây. Không bao giờ gửi tín hiệu cho phiên SSH hay `claude`.
   - Cùng lượt kiểm, đọc lượt review Bug Finding đang chạy (`reviewsFromHeartbeat`): `running` của
     `~/Library/Application Support/MRReviewQueue/crew/heartbeat.json` (`bugFindingRunningReviews`, flow
     `mac-bug-finding`). App Bug Finding nhúng trong `2P Crew.app/Contents/Resources`, nên cài là thay luôn binary của
     nó: `running ≥ 1` → không cài, màn hình Cập nhật hiện lý do "Chờ Bug Finding review xong"
     (`BUG_FINDING_WAIT_REASON`) và chờ tiếp. Mọi trạng thái chưa rõ cũng là "đang review": heartbeat hỏng hay ghi dở
     (không parse được, thiếu `at`/`running`), không có heartbeat mới (thiếu hay cũ hơn 60 giây) mà bản nhúng vẫn chạy,
     hay `ps` lỗi/quá hạn. Chỉ khi không có heartbeat mới và bản nhúng không chạy thì là 0.
   - Hết run và `running == 0` → thoát Bug Finding rồi cài. Bản nhúng không chạy (theo `ps`, không theo heartbeat;
     bản cài riêng `/Applications` không bị đụng) thì cài ngay. Đang chạy thì ghi `reopenBugFinding: true` vào
     `app.json`, gửi `osascript -e 'quit app id "local.mrreviewqueue"'` (không chờ AppleScript trả lời; `osascript`
     tự hết hạn sau 30 giây) và kiểm mỗi 1 giây, tối đa 30 giây (`BUG_FINDING_QUIT_MS`). Thoát kịp → cài. Không thoát
     kịp → không cài lúc đó, lý do "Chờ Bug Finding thoát", lượt kiểm sau (10 giây) thử lại; cờ mở lại giữ nguyên (app
     đã nhận quit, thoát trễ hơn 30 giây thì lượt sau cài và bản mới vẫn mở lại nó). Lỗi khi thoát (ghi cờ, `ps`) =
     chưa thoát được, chờ tiếp.
   - Mọi đường kết thúc `'later'` và mọi lỗi trong drain (kể cả hộp thoại ném) đều `resume()` listener, mở lại cổng
     (`release`, log `bug-finding-gate-opened`) và bỏ cờ mở lại nếu đã gửi quit; lỗi ném tiếp cho `update-failed`.
3. Quá 30 phút: `resume()` listener trước (hộp thoại có thể chờ owner rất lâu, máy không được đứng im).
   - Bug Finding vẫn đang review (hay không thoát): không hỏi, không cài (cài lúc đó là thay binary Bug Finding giữa
     lượt review), lý do "Bug Finding còn review sau 30 phút chờ, chưa cài. Bấm "Cài khi rảnh" để thử lại."
     (`BUG_FINDING_DEFERRED_REASON`), giữ `waiting-idle`.
   - Còn run Crew (hay không đọc được bảng process) mà Bug Finding rảnh: hỏi "Cài ngay, run vẫn chạy" / "Để sau" (mặc
     định "Để sau"). "Cài ngay" → kiểm lại Bug Finding, thoát nó như trên rồi mới cài (đang review lại hay không thoát
     thì không cài). "Để sau" → giữ `waiting-idle`; tải lại đúng bản đó không hỏi lại; owner bấm "Cài khi rảnh" để
     chạy lại bước chờ.
4. Cài (cổng mở Bug Finding vẫn đóng): `snapshotPrevious` (xóa `previous/` cũ và marker probation cũ, `ditto` app
   đang chạy vào `~/Library/Application Support/2P Crew/previous/2P Crew.app`, ghi `previous/version`); hỏng thì log
   `update-install-aborted`, `resume()`, mở lại cổng, không cài. Rồi ghi marker `probation/pending` (bản đích), sinh
   helper `watchdog`, ghi `installing` + `update.from`, `update.to`, `update.installedAt`, log `update-installing`, rồi
   đúng thứ tự của flow `mac-app-sshd`: `const revoke = sshd.allowQuitForUpdate()`, `await sshd.stopForQuit()`, hẹn giờ
   `INSTALL_QUIT_TIMEOUT_MS` (5 phút), kiểm lại Bug Finding nhúng (owner vẫn có thể mở tay từ Finder): còn chạy hay
   `ps` lỗi thì hủy lần cài như bước 6 với lý do "Bug Finding đang chạy lại trong lúc cài"; không chạy thì
   `quitAndInstall(false, true)`. Squirrel thay bundle và mở lại app. Lỗi bất ngờ sau drain (ghi `app.json`...) cũng hủy
   như bước 6 (hay `resume()` và mở lại cổng nếu chưa tới bước cho phép thoát).
5. Owner đã đồng ý ở bước drain (0 run, hay bấm "Cài ngay, run vẫn chạy"), nên `allowQuitForUpdate` cho mọi
   `before-quit` sau đó đi qua: quit guard không hỏi lại, không có nút "Hủy" nào để app sống với cổng trống.
6. Cài hỏng mà app không thoát — `autoUpdater` phát `error` trong lúc chờ thoát (Squirrel tải từ proxy local, kiểm
   chữ ký, giải nén lỗi), `quitAndInstall` ném ngay, hoặc 5 phút app vẫn sống: ghi `probation/<bản>.cancelled` (watchdog
   thôi), `await revoke()` (guard về bình thường, `resume()` mở lại listener), mở lại cổng mở Bug Finding, `deferred` =
   bản đó, về `waiting-idle`,
   màn hình hiện "Cài bản mới lỗi: … Bấm "Cài khi rảnh" để thử lại.", log `update-install-failed`. Không đưa bản vào
   `badVersions` (bản đó chưa từng chạy). Lỗi đến muộn sau khi đã hủy không hủy lần hai. `check()` chạy lại được (không
   còn kẹt `installing`). Marker `pending` giữ lại (xem "Squirrel.Mac và helper quay lui").
7. Bản mới khởi động (`registerUpdate`): probation chạy trước (`probationThenReopen`), xong mới xét cờ. Probation hỏng
   mà quay lui (app đang thoát) thì không mở Bug Finding (helper sắp thay bundle chứa nó). Mọi kết quả khác (đạt, không
   phải thử, vừa quay lui xong, hỏng mà không có bản trước): `app.json` có `reopenBugFinding: true` → mở lại Bug Finding
   chạy nền (`launchBugFinding(..., { background: true })`, tức `open -g`; flow `mac-bug-finding`), log
   `bug-finding-reopen`, rồi xóa cờ dù mở được hay không (bản cài riêng đang chạy, thiếu app nhúng, `open` lỗi), để
   không thử lại ở mọi lần mở app. Cài hỏng ở bước 4 hay 6 sau khi đã thoát Bug Finding thì cờ còn, lần mở app kế tiếp
   mở lại nó; trong lúc đó job review tự mở Bug Finding khi cần.

### Tự kiểm sau cài (`probation.ts`)

`runProbation` chạy ngay khi app mở, trước khi updater kiểm bản mới:

- Marker `probation/rolled-back` (helper vừa quay lui) → log `update-rolled-back`, thêm bản đó vào `badVersions`,
  `rolled-back`, xóa marker.
- Không `installing`/`probation`: marker `pending` = bản đang chạy (lần cài trước báo lỗi nhưng ShipIt vẫn cài lúc
  app thoát) → log `update-installed-late` rồi thử như dưới; `pending` là bản khác → xóa marker, không làm gì.
- `installing`/`probation` mà bản đang chạy khác `update.to` (Squirrel không thay được) → ghi `<to>.failed` (gỡ
  watchdog), xóa `pending`, về `idle`, log `update-install-missing`.
- Bản đang chạy là bản đích → ghi `probation/<bản>.started` (watchdog đếm hạn thử từ đây), `probation`. Mỗi bước có
  hạn riêng, một bước chậm không ăn vào hạn bước sau:

  | Bước | Hạn | Ghi chú |
  |---|---|---|
  | 1. listener của app `running` (kiểm mỗi 5 giây; supervisor `disabled` = chế độ LaunchAgent thì bỏ qua) | 5 phút (`PROBATION_LISTENER_MS`) | Squirrel vừa mở lại app |
  | 2. `doctor({ probe: false, tccWindow: '15m' })` không có `fail` nào ngoài `baseline` | 6 phút (`PROBATION_DOCTOR_MS`) | check TCC đọc `log show` mất 30–240 giây (timeout 240 giây trong doctor); cửa sổ 15 phút cho nhanh, hộp thoại cũ hơn đã nằm trong baseline 24 giờ. Quá hạn = hỏng thật ("doctor không xong sau 6 phút") |
  | 3. `sendStatus` gửi được, trừ khi `baseline` có `send-status` | 5 phút (`PROBATION_SEND_MS`), thử lại mỗi 30 giây | mạng chập chờn không đáng quay lui |

  Tổng tối đa `PROBATION_MAX_MS` = 16 phút. Kết thúc (đạt hay hỏng) thì xóa marker `pending`.
- Đạt → ghi `probation/<bản>.ok`, `idle`, log `update-installed`; rồi `installCrewMacWhenIdle`: chờ 0 run (kiểm mỗi
  10 phút) và gọi `installCrewMacFrom(<resources>/crew-mac)` một lần (crew-mac tự từ chối khi còn run thì chờ tiếp).
- Hỏng → log `update-probation-failed` kèm lý do ("sshd không lên", "doctor có lỗi mới: <id>", "không gửi được bản
  tin máy"), thêm bản vào `badVersions`, `rolled-back`, thoát Bug Finding nhúng (`quitBugFindingForRollback`: đóng cổng
  mở Bug Finding, đặt cờ mở lại nếu nó đang chạy, gửi quit, chờ tối đa 30 giây; không thoát kịp hay lỗi thì log
  `bug-finding-not-quit-before-rollback` và vẫn quay lui), sinh helper `now`, `sshd.stopForQuit()`, `app.exit(0)`.
  Không có `previous/` thì không thoát (thoát là mất app): ghi `.failed`, về `idle`, giữ bản này.

### `previous/`, helper và watchdog (`rollback.ts`, `rollback-helper.sh`)

`rollback-helper.sh <now|watchdog> <pid> <support> <bản>` nằm trong `Contents/Resources/` (`extraResources`), chạy
bằng `/bin/sh` tách rời (`detached`, `stdio: 'ignore'`, `unref`), sống qua lúc app thoát hay bị thay:

- `now`: ghi `probation/<bản>.failed`, chờ pid thoát, thay `/Applications/2P Crew.app` bằng `previous/2P Crew.app`
  (`mv` sang `.rollback-tmp`, `ditto`, hỏng thì trả bản cũ về, mã 4), ghi `probation/rolled-back`, `open` app.
- `watchdog` (sinh ngay trước `quitAndInstall`, pid = app cũ). Marker "xong" là `<bản>.ok`, `<bản>.failed` hay
  `<bản>.cancelled`; thấy marker xong ở bất kỳ mốc nào thì thôi. Không đếm giờ khi app cũ còn sống:

  | Mốc | Hạn (mặc định) | Hết hạn |
  |---|---|---|
  | 1. Chờ app cũ thoát | không giới hạn; updater ghi `.cancelled` khi cài hỏng mà app cũ ở lại | — |
  | 2. Từ lúc app cũ thoát, chờ bản mới ghi `.started` | 10 phút (`START_WAIT`) | ShipIt còn chạy thì chờ nó xong tối đa 20 phút (`SHIPIT_WAIT`), quá thì thoát 5 và không đụng app; không có app nào chạy thì `open` app một lần, chờ thêm 10 phút |
  | 3. Từ lúc thấy `.started`, chờ `.ok`/`.failed` | 20 phút (`WATCH`) ≥ 16 phút probation + biên (test kiểm) | |

  Hết hạn mà không có marker xong (bản mới treo lúc mở, không mở được, hay thử quá hạn): `pkill -TERM` đúng binary
  `/Applications/2P Crew.app/Contents/MacOS/2P Crew`, rồi quay lui như `now`. Mốc thời gian điển hình khi cài êm:
  t0 `quitAndInstall` → Squirrel tải từ proxy local, kiểm chữ ký, xếp ShipIt, app cũ thoát (dưới 1 phút) → ShipIt thay
  bundle và mở bản mới (60–90 giây) → `.started` → probation (thường dưới 1 phút) → `.ok`.
- Không có `previous/` → thoát 3, không đụng app.
- Chỉ ghi vào `/Applications/2P Crew.app` (và `.rollback-tmp` cạnh nó) và `~/Library/Application Support/2P Crew/`.

### Squirrel.Mac và helper quay lui

Đọc mã `electron-updater` 6.8.9 (`out/MacUpdater.js`) và chuỗi trong `Squirrel.framework`/`ShipIt` của bản Electron
đóng gói (chỉ đọc, 09/10/2026):

- `autoInstallOnAppQuit = false` nên lúc tải xong Squirrel chưa nhận gì. `quitAndInstall()` của `MacUpdater` (bỏ qua
  hai đối số) mới gọi `nativeUpdater.checkForUpdates()`: Squirrel lấy zip qua proxy `127.0.0.1` của electron-updater,
  kiểm chữ ký theo designated requirement, giải nén, `prepareUpdateForInstallation` ghi `ShipItState.plist` và nạp job
  launchd ShipIt. Native phát `update-downloaded` → `handleUpdateDownloaded` → `nativeUpdater.quitAndInstall()`
  (`relaunchToInstallUpdate`: ghi lại yêu cầu với `launchAfterInstallation`, rồi `terminate:`) → `before-quit`.
- ShipIt (`SQRLTerminationListener`, `waitForTermination`, `runningApplicationsWithBundleIdentifier:`) chờ mọi instance
  của bundle id thoát rồi mới cài. Tức là: một khi ShipIt đã được xếp, app thoát lúc nào (thoát tay, crash, bị
  `pkill`) thì ShipIt cài lúc đó — đây là ca của câu hỏi G.
- Lỗi trước khi xếp ShipIt (tải, chữ ký, giải nén) đến qua sự kiện `error`; lỗi của `relaunchToInstallUpdate` (sau
  khi đã xếp) cũng qua `error`, khi đó ShipIt có thể vẫn đang chờ.

Thiết kế chặn ca "ShipIt và helper cùng ghi `/Applications/2P Crew.app`":

1. Không còn đường app sống mà Squirrel đã xếp ShipIt và helper đang đếm giờ: `before-quit` của Squirrel không bị quit
   guard chặn (`allowQuitForUpdate`), và watchdog không đếm gì khi app cũ còn sống (mốc 1).
2. Cài báo lỗi (hay quá 5 phút) mà app ở lại: updater ghi `.cancelled` trước khi mở lại cổng, helper thôi, không bao
   giờ `pkill`/chép đè. Nếu ShipIt vẫn được xếp, lần app thoát sau ShipIt cài bản đó: marker `pending` làm bản mới
   vẫn qua probation khi mở (hỏng thì probation tự quay lui bằng helper `now`, lúc đó ShipIt đã xong vì app mới đang
   chạy). Ca này không có watchdog: bản mới crash ngay lúc mở thì owner cài tay bản trước từ `previous/`.
3. Helper chỉ chép đè sau khi không còn process ShipIt của bundle đích (`pgrep -f …/Squirrel.framework/Resources/ShipIt`);
   ShipIt chạy quá 20 phút thì helper bỏ (mã 5), không ghi cùng lúc.

Cần đo thật ở cổng 5 (UPD-4/AC): thời gian từ `quitAndInstall` tới app cũ thoát và tới `.started`; đường dẫn process
ShipIt đúng như mẫu `pgrep`; Squirrel lỗi sau khi xếp ShipIt thì lần thoát sau có cài không.

### Quay lui tay

Nút "Quay về bản trước" (`update:rollback`) chỉ bật khi có `previous/`; không có thì lỗi "Chưa có bản trước". Còn run
thì hỏi xác nhận trước. Đồng ý: thêm bản đang chạy vào `badVersions`, `rolled-back`, log
`update-rollback-requested`, thoát Bug Finding nhúng như probation hỏng (`quitBugFindingForRollback`, tối đa 30 giây,
không thoát kịp vẫn quay lui: owner chấp nhận thay bundle khi Bug Finding không thoát), helper `now`, `stopForQuit`,
`app.exit(0)`. Bản cũ hơn nữa: tải dmg của tag đó trên Releases và cài tay. Sửa lỗi lâu dài bằng bản mới số cao hơn.

### Kênh IPC và sự kiện log

- `update:state` → `UpdateView { current, available, state, previous, enabled, reason, lastCheckedAt }`;
  `update:check`; `update:installWhenIdle` (lỗi "Chưa có bản mới đã tải" khi chưa có); `update:rollback`.
- `app.log`: `update-available`, `update-skipped-bad`, `update-skipped`, `update-downloaded`, `update-deferred`,
  `update-install-aborted`, `update-installing`, `update-install-failed`, `update-installed`,
  `update-installed-late`, `update-install-missing`,
  `update-probation-failed`, `update-rolled-back`, `update-rollback-requested`, `update-error`, `crew-mac-installed`,
  `updater-log` (cảnh báo/lỗi của electron-updater), `update-failed` (lỗi bất ngờ của việc nền), `bug-finding-gate-closed`,
  `bug-finding-gate-opened`, `bug-finding-quit-for-update`, `bug-finding-quit-failed`,
  `bug-finding-not-quit-before-rollback`, `bug-finding-reopen`.
- Màn hình Cập nhật: bản đang chạy, bản mới, bản trước, trạng thái, giờ kiểm cuối (giờ Việt Nam); nút "Kiểm ngay",
  "Cài khi rảnh" (chỉ khi `waiting-idle`), "Quay về bản trước". Đọc lại mỗi 15 giây và khi `state:changed`.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/mac-app/scripts/release.mjs` | Trình tự phát hành: kiểm, build Bug Finding theo file ghim, chạy lệnh, tự kiểm (gồm chữ ký riêng của Bug Finding nhúng), đăng chạy lại được, log qua `scrubLog` | `main`, `resolveIdentity`, `buildBugFinding`, `verify`, `verifyBugFinding` |
| `apps/mac-app/scripts/release-lib.mjs` | Hàm thuần: đối số, tag, cây sạch, chọn danh tính, dựng lệnh, đọc kết quả kiểm, đọc file ghim Bug Finding, kiểm chữ ký Bug Finding, trạng thái release và lệnh đăng, che hash/credential | `parseArgs`, `checkTag`, `pickIdentity`, `findDeveloperId`, `buildCommands`, `checkSignature`, `checkBugFindingSignature`, `readBugFindingPin`, `bugFindingBuildCommands`, `hasSwift6`, `releaseState`, `publishCommands`, `redactUrlCredentials`, `scrubLog`, `EXIT` |
| `apps/mac-app/electron-builder.yml` | Mục `publish` (kênh phát hành), tên file phát hành, `extraResources` mang helper quay lui, bundle `crew-docs.cjs` và `Bug Finding.app`, `mac.signIgnore` giữ chữ ký riêng của Bug Finding | `publish`, `artifactName`, `extraResources`, `mac.signIgnore` |
| `apps/mac-app/src/main/update/register.ts` | Nối updater vào Electron: điều kiện bật, hộp thoại, kênh `update:*`, Bug Finding nhúng cho bước chờ rảnh (heartbeat, `ps`, `osascript`, cờ `reopenBugFinding`, cổng mở Bug Finding), chạy probation rồi mới mở lại Bug Finding và kiểm | `registerUpdate` |
| `apps/mac-app/src/main/update/updater.ts` | Máy trạng thái kiểm/tải/chờ rảnh/cài, lý do chờ Bug Finding trên màn hình, kiểm lại Bug Finding trước `quitAndInstall`, cài hỏng thì mở lại cổng listener và cổng mở Bug Finding, quay lui tay (thoát Bug Finding trước) | `createUpdater`, `CHECK_INTERVAL_MS`, `INSTALL_QUIT_TIMEOUT_MS`, `DISABLED_UNSIGNED`, `BUG_FINDING_DEFERRED_REASON` |
| `apps/mac-app/src/main/update/versions.ts` | Lọc bản trên feed: tăng, `x.y.z`, không `badVersions`, có zip arm64 | `compareSemver`, `judgeCandidate`, `shouldOffer` |
| `apps/mac-app/src/main/update/drain.ts` | Chờ máy rảnh trước khi cài (run Crew và lượt review Bug Finding, chưa rõ = đang review), đóng cổng mở Bug Finding, thoát Bug Finding (cả trước khi quay lui), mở lại sau cài | `drainForUpdate`, `BugFindingDrain`, `reviewsFromHeartbeat`, `quitBugFindingForRollback`, `reopenBugFindingAfterUpdate`, `DRAIN_POLL_MS`, `DRAIN_MAX_MS`, `BUG_FINDING_QUIT_MS`, `BUG_FINDING_WAIT_REASON` |
| `apps/mac-app/src/main/update/probation.ts` | Tự kiểm sau cài (hạn riêng từng bước), thoát Bug Finding trước khi quay lui, mở lại Bug Finding sau probation, đọc marker quay lui, cài `crew-mac` mang theo khi rảnh | `runProbation`, `probationThenReopen`, `installCrewMacWhenIdle`, `PROBATION_MAX_MS` |
| `apps/mac-app/src/main/update/rollback.ts` | `previous/`, marker probation, sinh helper, nhận Developer ID | `snapshotPrevious`, `spawnRollbackHelper`, `fileMarkers`, `developerIdFromCodesign` |
| `apps/mac-app/src/main/update/rollback-helper.sh` | Helper shell tách rời: quay lui ngay hoặc watchdog (chờ app cũ thoát, chờ bản mới mở, hạn thử) | — |
| `apps/mac-app/src/renderer/routes/update.tsx` | Màn hình Cập nhật | `UpdateScreen`, `UPDATE_STATE_LABEL` |

## Dữ liệu

- Đọc: `apps/mac-app/package.json` (`version`), `apps/mac-app/bug-finding.pin.json` (file ghim Bug Finding, flow
  `mac-bug-finding`), repo `bug-finding` (clone đúng commit ghim), Keychain (tên danh tính, phần công khai của chứng chỉ, notary
  profile qua `notarytool`).
- Ghi: `apps/mac-app/out/` (gitignored), `apps/mac-app/build/bug-finding/` (gitignored, Bug Finding đã build, ghi
  đè mỗi lần), `~/Library/Caches/2p-crew-release/` (bản build, ghi đè mỗi lần), thư mục tạm `crew-mac-release-*` và
  `crew-bug-finding-*` trong `$TMPDIR` (xóa khi xong).
- Ngoài máy: Apple notary service (bản phát hành), GitHub Releases (chỉ khi `--publish`).
- Updater đọc/ghi: `app.json` (`updateState`, `update.from/to/installedAt/badVersions/baseline`, `reopenBugFinding`,
  chỉ Main ghi), đọc `~/Library/Application Support/MRReviewQueue/crew/heartbeat.json` (lượt review Bug Finding),
  `~/Library/Application Support/2P Crew/previous/` (một bản app + `version`), `…/probation/` (`<bản>.ok`,
  `<bản>.failed`, `<bản>.started`, `<bản>.cancelled`, `pending`, `rolled-back`), `app.log`. Đọc GitHub Releases `nquangphan/crew-mac-releases` (chỉ khi bật).
  Thay `/Applications/2P Crew.app` (Squirrel khi cài, helper khi quay lui).

## Flow liên quan

- `mac-app`: khung app, `electron-builder.yml` (bundle id, Info.plist, entitlements, mang `crew-mac`).
- `mac-setup`: bản `crew-mac` được build và mang theo trong `Contents/Resources/crew-mac`; `installCrewMacFrom` cài
  nó sau khi bản mới qua probation; `readAppState` đọc `updateState` cho bản tin máy.
- `mac-app-sshd`: `pause`/`resume`/`stopForQuit`/`activeRuns`/`status` của supervisor (drain, probation), quit guard.
- `mac-bug-finding`: heartbeat (`bugFindingRunningReviews`), danh sách tiến trình (`runningBugFindingApps`), mở app
  (`launchBugFinding`, `createLaunchDeps`), cổng mở Bug Finding (`createLaunchGate`, tạo trong `index.ts` và truyền
  cho cả `registerUpdate` lẫn `registerBugFinding`), bundle id `BUG_FINDING_BUNDLE_ID` cho bước chờ rảnh và mở lại sau
  cài.

## Tests

- `apps/mac-app/scripts/release-lib.test.mjs` (`node --test`, chạy trong `pnpm --filter @crew/mac-app test` và
  `pnpm -r test` sau `vitest run`): đối số và cờ mâu thuẫn; tag tại HEAD và semver; cây
  sạch; đọc danh tính không giữ hash; chọn Developer ID/Apple Development theo loại, team, `--identity`; `CSC_NAME`
  bỏ tiền tố; notary profile có/thiếu/lỗi và câu báo thiếu; JSON notarytool; spctl, designated requirement,
  `codesign -dv`; Info.plist, `app-update.yml`, `latest-mac.yml`; che hash; thư mục ra ngoài `~/Documents`; danh sách lệnh của ba chế độ (bắt đầu bằng `build-docs`, không
  notarytool/`gh` ở bản thử, `gh` chỉ khi `--publish`); `readBugFindingPin` đọc file ghim hợp lệ, từ chối commit không
  đủ 40 hex hay repo rỗng; `bugFindingBuildCommands` gọi `build-app.sh --out --sign <danh tính> --hardened-runtime`,
  không danh tính thì `--sign -`; `hasSwift6` và mã thoát 9; `checkBugFindingSignature` (đạt; bị ký lại với
  entitlements Electron, entitlements rỗng/null, sai bundle id, thiếu runtime, thiếu timestamp, khác team hay loại danh
  tính đều lỗi; `Signed Time=` không tính là timestamp); `publishCommands` lần đầu và khi chạy lại với
  `draft`/`published`, `releaseState` 5 dạng đầu ra; `redactUrlCredentials`/`scrubLog` (URL token, không userinfo,
  dạng scp `git@github.com:`).
- `apps/mac-app/test/update-versions.test.ts`: so semver theo số; chỉ bản tăng; `badVersions`; zip arm64; prerelease.
- `apps/mac-app/test/update-drain.test.ts` (đồng hồ giả): 0 run cài ngay; chờ tới 20 phút, kiểm mỗi 10 giây, không
  hỏi; quá 30 phút mở lại listener rồi hỏi, "Để sau"/"Cài ngay"; bảng process lỗi không cài im lặng. Bug Finding giả:
  `running 1` thì không cài, báo "Chờ Bug Finding review xong", không thoát app, không hỏi; `running` 1 → 0 sau 5 phút
  thì thoát Bug Finding rồi cài, đặt cờ mở lại; `running 0` gửi quit một lần, chờ app thoát không quá 30 giây; app
  không chạy thì không quit, không cờ; không thoát trong 30 giây thì thử lại, hết hạn không cài và bỏ cờ; "Cài ngay" khi
  còn run Crew vẫn thoát Bug Finding trước; đọc heartbeat lỗi coi như đang review; đóng cổng ngay sau `pause`, cài thì
  giữ cổng đóng, "Để sau" mở lại cả listener lẫn cổng; ghi cờ lỗi hay `ps` lỗi khi thoát thì không ném, không cài, mở
  lại listener và cổng; hộp thoại ném thì vẫn mở lại rồi ném; Bug Finding thoát ở giây 35 thì lượt sau cài và cờ mở lại
  vẫn bật. `reopenBugFindingAfterUpdate`: cờ bật thì mở nền rồi xóa cờ; không cờ không mở; mở lỗi vẫn xóa cờ.
  `bugFindingRunningReviews` (file thật trong thư mục tạm): heartbeat mới `running` 1/0; thiếu hay cũ quá 60 giây thì
  `null`; JSON ghi dở hay thiếu `running` thì ném. `reviewsFromHeartbeat`: không có heartbeat mới mà app vẫn chạy thì
  ném.
- `apps/mac-app/test/update-rollback.test.ts`: bundle từ exe; Developer ID vs Apple Development; `snapshotPrevious`
  giữ 1 bản (ditto thật trong thư mục tạm), ditto hỏng không có bản trước; spawn tách rời; marker (gồm `.started`,
  `.cancelled`, `pending`); chạy thật `rollback-helper.sh` trong thư mục tạm (`now`; watchdog có `.ok`/`.failed`/hết
  giờ; chờ app cũ thoát và thôi khi `.cancelled`; hạn thử đếm từ `.started`; `open` một lần khi chưa có app nào chạy;
  không ghi khi ShipIt còn chạy, quá hạn thì mã 5; bản mới treo lúc mở bị TERM; hạn mặc định ≥ probation + biên;
  thiếu `previous/` mã 3). Process giả dùng đường dẫn trong thư mục tạm, không khớp app thật.
- `apps/mac-app/test/update-probation.test.ts` (deps giả): đạt; sshd không lên; doctor lỗi mới; bản tin hỏng (thử
  lại); baseline `send-status`; chế độ LaunchAgent; marker `rolled-back`; không phải `installing`; Squirrel không
  thay; không có bản trước; ghi `.started`; listener 4 phút + doctor 240 giây + bản tin được ở phút 4,5 vẫn đạt; doctor
  treo quá hạn thì quay lui; `pending` = bản đang chạy thì vẫn thử, bản khác thì xóa; cài `crew-mac` khi rảnh và thử lại khi bị từ chối vì run;
  hỏng mà quay lui thì đóng cổng và quit Bug Finding trước helper, không thoát trong 30 giây vẫn quay lui;
  `probationThenReopen`: hỏng mà quay lui thì không mở Bug Finding, đạt hay bỏ qua thì mở sau khi probation xong.
- `apps/mac-app/test/update-updater.test.ts` (autoUpdater giả): cấu hình bốn cờ; tắt khi không ký Developer ID;
  kiểm lúc mở/mỗi giờ/khi bấm; bản hợp lệ tải; `badVersions`; không arm64; trình tự cài; baseline `send-status`;
  "Để sau" và "Cài khi rảnh"; Bug Finding đang review thì không cài, không hỏi, lý do `BUG_FINDING_DEFERRED_REASON`;
  Bug Finding rảnh mà đang mở thì đóng cổng, đặt cờ và thoát nó trước snapshot, cài xong không mở lại cổng; Bug Finding
  mở lại trong lúc snapshot hay `ps` lỗi ngay trước cài thì không `quitAndInstall`, hủy lần cài, mở lại cổng; snapshot
  hỏng (mở lại cổng); "Cài ngay" khi còn run gọi `allowQuitForUpdate` trước `stopForQuit`;
  Squirrel `error`/`quitAndInstall` ném/quá 5 phút: `.cancelled`, `revoke()`, `waiting-idle`, không `badVersions`,
  kiểm và cài lại được; không kiểm khi đang cài; lỗi kiểm và repo chưa có release; quay lui tay
  (hỏi khi có run, hủy, chưa có bản trước, quit Bug Finding trước helper, không thoát kịp vẫn quay lui); feed giả qua HTTP local (`latest-mac.yml` đọc bằng `parseUpdateInfo` của
  electron-updater + zip giả): arm64 tăng thì tải và cài, x64 hay bản cũ thì không tải.
- `apps/mac-app/test/renderer/update.test.tsx` (jsdom): route thật; nhãn trạng thái; bộ trạng thái trùng `UPDATE_STATES` của crew-mac; bản/giờ Việt Nam; các nút bật/tắt
  đúng lúc; lý do khi tắt; lỗi quay lui.

Chưa chạy end-to-end với app đóng gói thật (Squirrel thay bundle, helper trên `/Applications`): để cổng 5 nghiệm thu.
