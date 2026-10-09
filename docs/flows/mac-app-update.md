# Phát hành và cập nhật app 2P Crew

> Flow `mac-app-update`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-app-update` in ra đúng danh sách đó.

## Mục đích

Ra bản app macOS 2P Crew (bundle `com.2p-solutions.crew.mac`) ký Developer ID, notarize và staple bằng một script
chạy trên Mac mini, rồi đăng lên GitHub Releases `nquangphan/crew-mac-releases` để updater trong app tự lấy. Phần
updater trong app (kiểm, tải, chờ máy rảnh, probation, quay lui) chưa có; mục này hiện chỉ mô tả phần phát hành.

## Điểm vào

- `node apps/mac-app/scripts/release.mjs` (chạy từ bất kỳ đâu trong repo; script tự tìm gốc repo bằng git).

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

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/mac-app/scripts/release.mjs` | Trình tự phát hành: kiểm, chạy lệnh, tự kiểm, đăng | `main`, `resolveIdentity`, `verify` |
| `apps/mac-app/scripts/release-lib.mjs` | Hàm thuần: đối số, tag, cây sạch, chọn danh tính, dựng lệnh, đọc kết quả kiểm | `parseArgs`, `checkTag`, `pickIdentity`, `findDeveloperId`, `buildCommands`, `checkSignature`, `EXIT` |
| `apps/mac-app/electron-builder.yml` | Mục `publish` (kênh phát hành), tên file phát hành | `publish`, `artifactName` |

## Dữ liệu

- Đọc: `apps/mac-app/package.json` (`version`), Keychain (tên danh tính, phần công khai của chứng chỉ, notary
  profile qua `notarytool`).
- Ghi: `apps/mac-app/out/` (gitignored), `~/Library/Caches/2p-crew-release/` (bản build, ghi đè mỗi lần), thư mục tạm `crew-mac-release-*` trong `$TMPDIR`
  (xóa khi xong).
- Ngoài máy: Apple notary service (bản phát hành), GitHub Releases (chỉ khi `--publish`).

## Flow liên quan

- `mac-app`: khung app, `electron-builder.yml` (bundle id, Info.plist, entitlements, mang `crew-mac`).
- `mac-setup`: bản `crew-mac` được build và mang theo trong `Contents/Resources/crew-mac`.

## Tests

- `apps/mac-app/scripts/release-lib.test.mjs` (`node --test`): đối số và cờ mâu thuẫn; tag tại HEAD và semver; cây
  sạch; đọc danh tính không giữ hash; chọn Developer ID/Apple Development theo loại, team, `--identity`; `CSC_NAME`
  bỏ tiền tố; notary profile có/thiếu/lỗi và câu báo thiếu; JSON notarytool; spctl, designated requirement,
  `codesign -dv`; Info.plist, `app-update.yml`, `latest-mac.yml`; che hash; thư mục ra ngoài `~/Documents`; danh sách lệnh của ba chế độ (không
  notarytool/`gh` ở bản thử, `gh` chỉ khi `--publish`).
