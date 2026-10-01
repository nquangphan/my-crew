# Cập nhật nóng runtime đã ký, chữ ký app ổn định và quyền ổ đĩa

> Flow `runtime-updates`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow
> runtime-updates` in ra đúng danh sách đó.

## Mục đích

App desktop được tách thành hai phần từ bản `0.3.0`: **shell** (Electron, tiến trình main, preload, native
module/SDK trong `node_modules` của app) chỉ đổi bằng một bản dmg mới; **runtime** (daemon host cộng thư viện
daemon nó chạy, prompt vai trò mặc định, và renderer) có thể cập nhật nóng — server ký một bản, máy tải, kiểm
chữ ký/hash rồi tự chuyển sang chạy nó, không cần chủ dự án cài lại gì. Vì macOS gắn quyền riêng tư (Full Disk
Access, quyền đọc thư mục) với chữ ký của app, hai việc khác đi cùng tính năng này: một danh tính ký code tự
tạo ("2P Crew Code Signing") ổn định qua mọi bản build thay cho chữ ký ad-hoc đổi mỗi lần, và một bước hỏi
Full Disk Access đúng một lần trong trình cài đặt (không hỏi lại mỗi khi cập nhật). Chủ dự án ghim một máy vào
một bản runtime cụ thể (kể cả bản cũ hơn, để quay lui) hoặc để nó tự theo bản mới nhất app máy đó chạy được.

## Điểm vào

- `apps/api/src/routes/runtime-routes.ts` → `runtimeRoutes` (owner: `GET /v1/runtime/releases`,
  `GET /v1/runtime/latest`, `POST /v1/runtime/releases`, `POST /v1/runtime/releases/import`,
  `PUT /v1/machines/:id/runtime`) và `daemonRuntimeRoutes` (daemon: `GET /v1/daemon/runtime`,
  `GET /v1/daemon/runtime/:version/bundle`).
- `apps/desktop/src/main/runtime-manager.ts` → `RuntimeManager` — chọn runtime lúc khởi động
  (`select()`), hỏi server và cài bản mới (`check()`), theo dõi thời gian thử (probation) và quay lui khi
  cần.

## Các bước

1. `packages/shared/src/runtime-schemas.ts`: một bản runtime là `crew-runtime-<version>.tar.gz` (ustar gzip,
   chỉ file thường) cộng `crew-runtime-<version>.manifest.json` (`format: 1`, `version`, `commit`,
   `createdAt`, `shellRange: {app, electron}`, `bundle: {sha256, size}` của tarball, `files: {path:
   {sha256, size}}` của mọi file trong `host/` và `renderer/` — hai `RUNTIME_ROOTS`) và
   `crew-runtime-<version>.manifest.sig` (chữ ký Ed25519 rời trên đúng byte của manifest, base64).
   `RUNTIME_SIGNING_KEYS` là danh sách khoá công khai (raw 32 byte, base64) mà cả server và mọi shell tin —
   xoay khoá là thêm một khoá mới vào danh sách, giữ khoá cũ tới khi không còn bản nào cần nó nữa (không xoá
   ngay). `runtimePathProblem()` chặn path tuyệt đối, `.`/`..`, ký tự lạ, ngoài `host/`/`renderer/`; các bản
   không đứng ngoài giới hạn `RUNTIME_LIMITS` (`bundleBytes` 80 MB, `unpackedBytes` 300 MB, `files` 5000,
   `manifestBytes` 2 MB). Bản đóng gói sẵn trong app (chưa từng tải) không có `bundle`/chữ ký trong manifest
   của nó vì không ai kiểm chữ ký của thứ chưa hề rời khỏi app đã ký.
2. `apps/desktop/scripts/runtime-bundle.mjs`: `builtin` đóng `out/runtime/manifest.json` cạnh `out/runtime/`
   (host + renderer đã build) — version từ `crewRuntime.version` của `apps/desktop/package.json`, shell range
   từ `crewRuntime.shell`, Electron major từ Electron đã cài. `release [--out <dir>]` đóng
   `crew-runtime-<version>.tar.gz`/`.manifest.json`/`.manifest.sig` vào `release/runtime/`: khoá ký là PEM
   Ed25519 trong biến `CREW_RUNTIME_SIGNING_KEY` (CI: secret cùng tên) hay file `CREW_RUNTIME_SIGNING_KEY_FILE`
   — không có khoá thì bản không ký, script vẫn thoát mã 0 nhưng in cảnh báo rõ (mọi shell sẽ từ chối bản đó);
   khoá có mà nửa công khai của nó không nằm trong `RUNTIME_SIGNING_KEYS` thì build lỗi ngay. `verify [<dir>]`
   kiểm lại đúng như một shell sẽ làm: chữ ký bởi một khoá tin cậy, hash/kích thước tarball khớp manifest.
   Cách tạo khoá mới: `openssl genpkey -algorithm ed25519 -out runtime-signing-key.pem`, lấy nửa công khai
   raw base64 bằng `openssl pkey -in runtime-signing-key.pem -pubout -outform der | tail -c 32 | base64` rồi
   thêm vào `RUNTIME_SIGNING_KEYS`, và nạp khoá riêng vào GitHub Actions bằng
   `gh secret set CREW_RUNTIME_SIGNING_KEY < runtime-signing-key.pem`.
3. `.github/workflows/ci.yml` job `runtime-release` (chạy trên `ubuntu-latest`, kích hoạt bởi tag
   `runtime-v<crewRuntime.version>`): kiểm tag khớp đúng version trong `package.json`, chạy
   `pnpm --filter @crew/desktop runtime:release` (build rồi `runtime-bundle.mjs release`) với
   `CREW_RUNTIME_SIGNING_KEY` từ secret — thiếu secret thì in `::warning::` rồi build tiếp (bản không ký, mọi
   app/server sẽ từ chối); có khoá thì chạy `runtime-bundle.mjs verify` như một lần kiểm chéo, rồi
   `gh release create ... --latest=false` (cờ này để `electron-updater` của bản dmg vẫn chỉ đọc release của
   tag `v*`, không lẫn với release runtime).
4. `apps/api/drizzle/0009_runtime_releases.sql`: bảng `runtime_releases` (khoá chính `version`, `manifest`/
   `signature` (text, đúng byte đã ký), `key_id`, `commit`, `shell_range` jsonb, `bundle_sha256`, `size`,
   `source` (`github`|`upload`), `published_by`, `built_at`, `published_at`) và `runtime_bundles` (`version`
   khoá ngoại `on delete cascade`, `data` bytea — tarball thật, tách bảng để không kéo blob khi chỉ cần
   metadata); hai cột mới trên `machines`: `runtime_state` (jsonb, `MachineRuntimeState` mới nhất từ
   heartbeat) và `runtime_pinned_version`.
5. `apps/api/src/services/runtime-service.ts` → `checkRelease()`/`publishRelease()`: trước khi lưu, server tự
   kiểm lại mọi thứ một shell sẽ kiểm — manifest hợp lệ, chữ ký bởi một khoá tin cậy
   (`trustedRuntimeKeys()`: `RUNTIME_SIGNING_KEYS` cộng `config.runtimeExtraKeys`), kích thước/hash tarball
   khớp manifest — không bao giờ lưu một bản chưa qua hết các kiểm này. Một version đã publish là **bất biến**:
   đăng lại đúng tarball cũ là no-op (200, `created: false`), đăng một tarball khác dưới cùng version bị từ
   chối (409). `publishRelease()` phát `runtime.published` cho owner stream và cho **mọi máy còn sống**
   (`revokedAt` null) trong cùng transaction.
6. `apps/api/src/services/runtime-service.ts` → `desiredRuntime()`: máy nên chạy bản owner ghim
   (`machines.runtimePinnedVersion`, kể cả ghim về một bản **cũ hơn** — một cách rollback thủ công), hoặc nếu
   không ghim, bản mới nhất mà `shellRange.app` của nó chấp nhận phiên bản shell máy đã báo cáo
   (`machine.runtimeState.shellVersion`, hoặc `appVersion` khi máy chưa từng báo runtime). `latest` luôn là
   bản mới nhất bất kể máy chạy được hay không, để app biết khi nào chỉ một bản dmg mới mới đủ. `pinRuntime()`
   (`PUT /v1/machines/:id/runtime`, `null` bỏ ghim) phát `runtime.pinned` cho owner stream và cho đúng máy đó.
7. `apps/api/src/routes/runtime-routes.ts` cộng `apps/api/src/jobs/runtime-import.ts` →
   `startRuntimeImport()`: mỗi giờ (`RUNTIME_IMPORT_INTERVAL_MS`, lần đầu trễ 60 giây sau khi API khởi động để
   một vòng khởi động lại không dội GitHub liên tục) gọi `importFromGithub()` — đọc `releases` công khai của
   `config.runtimeReleasesRepo` (mặc định `nquangphan/my-crew`, để rỗng để tắt hẳn việc nhập, `POST
   /v1/runtime/releases/import` cũng bị từ chối khi đó), lọc tag `runtime-v*` chưa có, bỏ qua bản thiếu chữ ký
   (`"unsigned (CREW_RUNTIME_SIGNING_KEY was not set in CI)"`) hay chữ ký/hash không khớp — không bao giờ lưu
   một bản như vậy — rồi gọi lại đúng `publishRelease()` ở bước 5. Owner cũng tự bấm nhập ngay
   (`POST /v1/runtime/releases/import`, nút "Nhập bản mới từ GitHub") thay vì chờ hết giờ. Owner tự tải bản ký
   lên bằng `POST /v1/runtime/releases` (`PublishRuntimeRequest`: manifest + signature + bundle base64) khi
   không dùng GitHub.
8. `apps/api/src/routes/runtime-routes.ts` → `daemonRuntimeRoutes`: `GET /v1/daemon/runtime` trả
   `desiredRuntime()` (kèm nguyên văn manifest/signature để shell tự kiểm lại, không tin server);
   `GET /v1/daemon/runtime/:version/bundle` trả tarball thô (`content-type: application/gzip`,
   `cache-control: no-store`) cho máy đã ghép — không kiểm gì thêm ở đây, việc kiểm là của shell (bước 10).
9. `apps/desktop/src/main/runtime-verify.ts`/`runtime-archive.ts`/`runtime-store.ts`: `verifyManifest()` từ
   chối (`RuntimeRefused`, thông báo tiếng Việt cho chủ dự án) một manifest chưa ký, ký bởi khoá lạ, không
   hợp lệ, hoặc bản shell này không chạy được (`shellRangeProblem()`); `verifyTarball()` kiểm hash/kích thước
   tarball đúng cái manifest đã ký nêu; `readRuntimeTarball()` đọc ustar nghiêm ngặt — chỉ file thường (mục
   thư mục bị bỏ qua, link/device/mọi loại khác bị từ chối cả bản), mỗi path an toàn, đúng trong manifest,
   không file nào trùng, không thiếu file nào, hash/size khớp từng file — không viết gì ra đĩa ở bước này.
   `RuntimeStore.install()` chỉ ghi vào một thư mục staging (`mkdtempSync`) rồi `renameSync` vào
   `~/.crew/runtime/<version>/` khi mọi thứ đã qua hết kiểm (thư mục 0700, file 0600, cờ `wx` không bao giờ
   ghi đè hay theo symlink có sẵn); `RuntimeStore.load()` kiểm lại **toàn bộ** (chữ ký, shell range, chủ thư
   mục, hash từng file trong manifest, không file lạ nào ngoài manifest) mỗi lần được chọn để chạy — một bản
   bị sửa trên đĩa sau khi cài không bao giờ chạy được nữa. `linkNodeModules()` link
   `<version>/node_modules` → `node_modules` của chính shell (bundle không mang theo `better-sqlite3`, Agent
   SDK, MCP SDK…) — làm lại mỗi lần chọn runtime vì app có thể đã bị chuyển chỗ.
10. `apps/desktop/electron.vite.host.config.ts`: build host của runtime **tách biệt** khỏi bundle main của
    shell (không chung chunk) — `out/runtime/host/index.js` (entry mà shell fork), kèm prompt vai trò
    (`out/runtime/host/prompts/`, cùng plugin `copyRolePrompts` của `electron.vite.config.ts`) và
    `package.json` `{"type": "module"}` (`hostPackageJson`, vì một thư mục runtime cài dưới `~/.crew/runtime/`
    không có `package.json` của app phía trên để Node suy ra ESM). Renderer của runtime build bởi
    `electron.vite.config.ts` (file build shell) ra `out/runtime/renderer` — cùng cây `out/runtime/` mà
    `runtime-bundle.mjs builtin` đóng thành manifest.
11. `apps/desktop/src/main/runtime-manager.ts` → `RuntimeManager`: `select()` (gọi lúc khởi động shell) thử
    lần lượt bản đang trong giai đoạn thử (nếu có), bản active, rồi lịch sử — bản đầu tiên qua hết
    `RuntimeStore.load()` (bước 9) được chạy; bản lỗi bị đánh dấu `bad` (kèm lý do) và không tự thử lại nữa,
    rơi hẳn về bản đóng gói sẵn nếu không còn bản cài nào dùng được. `check()` (lúc host báo sẵn sàng lần đầu,
    khi nhận sự kiện `runtime.changed` từ host — daemon nghe được `runtime.published`/`runtime.pinned` qua
    stream, mỗi giờ, và khi chủ dự án bấm "Kiểm tra runtime") gọi `decideRuntime()` (hàm thuần, dễ test) với
    câu trả lời của server: ghim thắng mọi thứ (kể cả một bản cũ hơn — rollback); không ghim thì lấy
    `max(bản server đề nghị, bản đóng gói sẵn)` — không bao giờ tự hạ xuống dưới bản đi kèm app hiện tại; một
    version từng `bad` không bao giờ được thử lại tự động; bản server đề nghị mà shell này không chạy được
    (`shellRangeProblem`) chuyển trạng thái `shell_update_required` (chỉ một bản dmg mới giải quyết được).
12. Cài và chuyển: `install()` gọi `host.runtimeDownload` (qua host, `HostService.runtimeDownload()` gọi
    `VpsClient.runtimeBundle()` rồi lưu vào `~/.crew/runtime/.incoming/`) rồi `RuntimeStore.takeIncoming()` +
    `install()` (bước 9); `waitForJobs()` chờ tối đa `waitForJobsMs` (mặc định 30 phút, trạng thái `waiting`)
    cho job đang chạy xong, hết giờ vẫn chuyển (job resume ở host mới); `switchTo()` gọi
    `DaemonSupervisor.relaunch()` (dừng có kiểm soát kiểu `requeue` — job đang chạy được đưa lại hàng đợi,
    resume trên host mới — rồi fork host mới từ `runtime.current().hostEntry`) và, nếu có cửa sổ đang mở, tải
    lại renderer bằng `rendererUrl()` mới, giữ nguyên route/hash đang xem. Toàn bộ chuỗi (`checking` →
    `downloading` → `installing` → `waiting` → `switching` → `idle`) đi qua `MachineRuntimeState` mà renderer
    và web đều đọc lại.
13. Probation và quay lui: mỗi lần chuyển sang một bản cài, bản đó vào "thử" `probationMs` (mặc định 5 phút).
    `onReadyTimeout()` (host không báo `ready` kịp) và `onHostCrash()` (host thoát đột ngột) đếm dồn trong
    khung 5 phút; 2 lần ready-timeout hoặc 3 lần crash (`maxReadyTimeouts`/`maxCrashes`) gọi `rollback()`:
    quay lại bản trước đó (bản cài trước, hoặc bản đóng gói sẵn nếu không còn), đánh dấu bản mới `bad` (không
    tự thử lại), trạng thái `rolled_back`. Một check tới trong lúc đang thử bị hoãn tới khi hết giai đoạn thử
    (`checkAfterProbation`). Qua được giai đoạn thử (`endProbation()`): giữ bản active cộng tối đa
    `keepPrevious` (2) bản trước làm mục tiêu rollback thủ công, xoá các bản cài cũ hơn nữa trên đĩa.
14. Trạng thái này đi ra ngoài qua ba đường: `MachineRuntimeState` trong `AppInfo.runtime` (renderer đọc qua
    `app.checkRuntime`/`app.info`) và sự kiện `runtime.status`; `HostService.setFacts()` đẩy một heartbeat
    ngay khi `facts.runtime` đổi (không chờ nhịp 30 giây) nên web thấy cập nhật runtime gần như tức thời;
    `HeartbeatRequest.runtime` (tuỳ chọn, hình dạng lạ bị bỏ qua thầm lặng — `.catch(undefined)`) tới
    `apps/api/src/services/machine-service.ts` → `recordHeartbeat()`, ghi `machines.runtime_state` và, khi
    version/state/shellVersion đổi so với lần trước, phát `machine.runtime_changed` (owner stream). Cập nhật
    nóng **tắt hẳn** ở bản dev chưa đóng gói (`app.isPackaged` false) trừ chế độ test E2E
    (`CREW_DESKTOP_TEST_MODE=1`), và tắt được bằng tay qua `CREW_RUNTIME_UPDATES=0`. `CREW_RUNTIME_TEST_KEYS`
    (khoá tin cậy thêm) và `CREW_RUNTIME_PROBATION_MS` (rút ngắn thời gian thử) chỉ có tác dụng ở chế độ test.
15. Ràng buộc hợp đồng: renderer và host chỉ nói được các method của `packages/shared/src/desktop-ipc.ts`
    (`DesktopRequests`/`HostOnlyRequests`, flow `desktop-app`) — file đó sống trong shell, không trong runtime.
    Một runtime cần thêm method IPC mới hay đổi input của method cũ **luôn cần một bản shell mới** (dmg) đi
    cùng, khai báo qua `crewRuntime.shell` (version range) chứ một cập nhật nóng runtime không tự thay được
    hợp đồng IPC của shell đang chạy.
16. `apps/desktop/scripts/codesign.mjs` cộng `apps/desktop/signing/codesign-cert.crt`: danh tính ký code ổn
    định — chứng chỉ tự ký "2P Crew Code Signing" (EKU code-signing, hạn 10 năm), phần công khai được commit
    vào repo. Tạo mới: `openssl req -x509 …` với `keyUsage=digitalSignature` và
    `extendedKeyUsage=codeSigning`, rồi `openssl pkcs12 -export -legacy …` gói riêng+công khai thành một
    `.p12`; nạp vào GitHub Actions bằng `gh secret set CREW_CODESIGN_P12_BASE64 < file.p12.base64` và
    `gh secret set CREW_CODESIGN_P12_PASSWORD < password-file`. `electron-builder` ký ad-hoc trước (nó không
    ký được bằng một chứng chỉ tự ký); `afterSign` của `apps/desktop/scripts/package-mac.mjs` gọi
    `signApp()`/`verifyApp()` để ký lại (`codesign --force --deep`) bằng chính danh tính này khi keychain có
    nó (`findIdentity()`), rồi kiểm lại bằng `codesign --verify --deep --strict` cộng designated requirement
    (`codesign -d -r-`) nêu đúng `identifier "com.2p-solutions.crew"` và
    `certificate root|leaf = H"<SHA-1 chứng chỉ đã commit>"` (chứng chỉ tự ký thì `root` chính là `leaf`).
    Không có danh tính trong keychain: build vẫn xong, ký ad-hoc, kèm cảnh báo — trừ khi
    `CREW_CODESIGN_REQUIRED=1` (CI đặt khi đã nạp `.p12` vào keychain tạm) thì build lỗi hẳn. Vì designated
    requirement neo vào đúng chứng chỉ này qua mọi lần build, macOS không hỏi lại Full Disk Access hay quyền
    đọc thư mục mỗi khi app cập nhật (khác chữ ký ad-hoc đổi theo từng build). App vẫn chưa notarize:
    Gatekeeper vẫn cần chuột phải → Open ở lần cài đầu.
17. `apps/desktop/src/main/full-disk-access.ts` → `detectFullDiskAccess()`: đọc thử `~/Library/Safari`
    (`readdirSync`) và `~/Library/Application Support/com.apple.TCC/TCC.db` (`openSync`) — hai đường dẫn
    macOS không bao giờ tự hiện hộp thoại xin quyền cho, nên việc dò không bao giờ tự bật hộp thoại; đọc được
    → `granted`, bị từ chối (`EPERM`/`EACCES`) mà không đường nào đọc được → `denied`, còn lại (đường dẫn
    không tồn tại…) → `unknown`, không phải macOS → `unsupported`. IPC `app.fullDiskAccess` (dò lại) và
    `app.openFullDiskAccess` (mở `x-apple.systempreferences:...Privacy_AllFiles`) — trình cài đặt có bước
    "Quyền ổ đĩa" (bỏ qua được bằng nút "Để sau") và "Trạng thái máy" có một mục riêng, cả hai dùng chung
    `FullDiskAccessPanel` (dò lại mỗi khi cửa sổ được focus lại, sau khi chủ dự án quay từ System Settings
    về). Đây là một lần hỏi rõ ràng, tách khỏi `awaitFolderAccess()` (flow `desktop-app`) — cơ chế chờ quyền
    đọc từng thư mục project vẫn còn làm nền dự phòng cho thư mục ngoài Full Disk Access hoặc khi chủ dự án
    bỏ qua bước này.
18. `apps/web/src/components/machine-runtime.tsx`: `RuntimeReleases` (mục "Bản runtime" trên trang Máy) liệt
    kê 5 bản mới nhất kèm nút "Nhập bản mới từ GitHub" khi `githubRepo` không rỗng; `MachineRuntime` (trên mỗi
    thẻ máy) hiện version shell/runtime, nguồn (đi kèm app hay cập nhật nóng), trạng thái bằng một câu tiếng
    Việt (`runtimeStateText()`), và một `Select` chọn bản để ghim (`api.pinMachineRuntime()`) với nút "Ghim
    bản này"/"Bỏ ghim".
19. Thao tác tay của chủ dự án (không tự động): chuyển khoá ký runtime và chứng chỉ ký app từ máy đã tạo ra
    (thư mục tạm) sang một password manager, không giữ lại trên đĩa; lần ký code đầu tiên trên máy dev macOS
    hỏi cho phép `codesign` dùng khoá trong keychain — bấm "Always Allow" một lần; cấp Full Disk Access một
    lần sau khi cài bản `0.3.0`; lần cài `0.3.0` đầu tiên vẫn cần chuột phải → "Open Anyway" (chưa notarize).

## Phát hành một bản runtime

Việc tay của chủ dự án sau khi PM merge một nhánh đã nâng `crewRuntime.version` trong
`apps/desktop/package.json` — agent không tự đẩy tag, tạo GitHub Release hay deploy; mọi bước dưới đây chủ dự
án bấm tay.

**Trước khi phát hành**

- CI xanh trên đúng commit đã merge (`.github/workflows/ci.yml`: typecheck, lint, test, build, docs check).
- Secret `CREW_RUNTIME_SIGNING_KEY` đã nạp trên GitHub Actions — thiếu thì job `runtime-release` (bước 3) chỉ
  in `::warning::` rồi vẫn publish một bản **không ký**, và mọi app/server sẽ từ chối bản đó.
- Đối chiếu `git diff <tag bản trước>..HEAD --stat` với phần vỏ Electron (`apps/desktop/src/main/**`,
  `apps/desktop/src/preload/**`, `packages/shared/src/desktop-ipc.ts`, `dependencies` của
  `apps/desktop/package.json`, `electron-builder.yml`): có đổi thì cập nhật nóng không đủ — cần một bản dmg mới
  (tag `v*`) trước, và xét lại `crewRuntime.shell`; không đổi gì thì bản runtime mới đi được thẳng bằng cập
  nhật nóng, giữ nguyên `crewRuntime.shell`.

**Thứ tự phát hành**

1. Deploy API lên VPS trước (`scripts/deploy.sh`, flow `deployment`) để route/tính năng API mà bản runtime mới
   cần đã có sẵn.
2. Đẩy tag `runtime-v<version>` (ví dụ `runtime-v0.3.1`) trên đúng commit đã merge. Thứ tự ngược lại (đẩy tag
   trước khi deploy API) không làm hỏng gì — daemon mới gặp server cũ vẫn chạy job bình thường, chỉ thiếu tính
   năng phía API cho tới khi deploy xong.
3. Tuỳ chọn: đẩy thêm tag `v<version>` nếu cũng cần dmg mới cho máy cài mới; bỏ qua nếu chỉ phát hành cập nhật
   nóng runtime.

**Sau khi đẩy tag**

- Job CI `runtime-release` build, ký bằng `CREW_RUNTIME_SIGNING_KEY`, tự `runtime-bundle.mjs verify` rồi tạo
  một GitHub Release riêng cho tag đó (`--latest=false`, bước 3 ở trên).
- Server tự nhập bản mới mỗi giờ (`startRuntimeImport()`), hoặc owner bấm "Nhập bản mới từ GitHub" trên trang
  Máy để nhập ngay (bước 7).
- Từng máy chuyển sang bản mới sau khi job agent đang chạy xong (`waitForJobs()`, chờ tối đa
  `waitForJobsMs`, mặc định 30 phút, bước 12).

**Kiểm sau phát hành**

- Trang Máy hiện đúng version runtime mới với nguồn "cập nhật nóng" (không phải "đi kèm app").
- Tạo một ticket có ảnh trong mô tả hoặc bình luận, xác nhận agent mô tả được ảnh — kiểm tính năng mới của bản
  đó đã chạy được trên host vừa cập nhật.

**Quay lui**

- Tay: ghim máy về version trước trên trang Máy (`PUT /v1/machines/:id/runtime`, bước 6).
- Tự động: app tự quay lui nếu host mới lỗi trong thời gian thử (probation) — 2 lần ready-timeout hoặc 3 lần
  crash trong 5 phút (bước 13).

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/runtime-routes.ts` | Route owner (release, upload, import, pin) + daemon (desired, tarball) | `runtimeRoutes`, `daemonRuntimeRoutes` |
| `apps/api/src/services/runtime-service.ts` | Kiểm, lưu, publish, chọn bản cho máy, ghim, nhập từ GitHub | `checkRelease`, `publishRelease`, `desiredRuntime`, `pinRuntime`, `runtimeBundle`, `importFromGithub`, `trustedRuntimeKeys` |
| `apps/api/src/jobs/runtime-import.ts` | Nhập release `runtime-v*` từ GitHub mỗi giờ | `startRuntimeImport`, `RUNTIME_IMPORT_INTERVAL_MS` |
| `packages/shared/src/runtime-schemas.ts` | Schema manifest/version/range, khoá tin cậy, giới hạn, trạng thái máy | `RuntimeManifest`, `RuntimeShellRange`, `RUNTIME_SIGNING_KEYS`, `RUNTIME_LIMITS`, `runtimePathProblem`, `parseRuntimeManifest`, `shellRangeProblem`, `compareVersions`, `satisfiesRange`, `MachineRuntimeState`, `RuntimeUpdateState`, `DaemonRuntimeResponse` |
| `apps/desktop/src/main/runtime-manager.ts` | Chọn/kiểm/cài/chuyển runtime, probation, rollback | `RuntimeManager`, `decideRuntime`, `LaunchTarget` |
| `apps/desktop/src/main/runtime-store.ts` | Thư mục `~/.crew/runtime/`, verify toàn bộ, state.json, prune | `RuntimeStore`, `RuntimeStateFile`, `Probation` |
| `apps/desktop/src/main/runtime-archive.ts` | Đọc ustar nghiêm ngặt, ghi file đã kiểm ra đĩa | `readRuntimeTarball`, `writeRuntimeFiles`, `runtimeFile` |
| `apps/desktop/src/main/runtime-verify.ts` | Kiểm chữ ký Ed25519, shell range, hash tarball | `verifyManifest`, `verifyTarball`, `signedBy`, `trustedKeys`, `RuntimeRefused` |
| `apps/desktop/src/main/full-disk-access.ts` | Dò Full Disk Access không hiện hộp thoại | `detectFullDiskAccess`, `defaultProbes`, `FULL_DISK_ACCESS_PANE` |
| `apps/desktop/electron.vite.host.config.ts` | Build host của runtime riêng khỏi bundle main | `hostPackageJson` |
| `apps/web/src/components/machine-runtime.tsx` | Mục "Bản runtime" + ghim runtime trên trang Máy | `RuntimeReleases`, `MachineRuntime`, `runtimeStateText` |

Ngoài danh sách trên (không phải file nguồn của flow theo `docs/flows.yaml`, nhưng lắp ráp tính năng chạy
được): `apps/desktop/scripts/runtime-bundle.mjs` (đóng/ký/kiểm bản runtime), `apps/desktop/scripts/codesign.mjs`
(danh tính ký code ổn định, dùng lại bởi `package-mac.mjs`), `apps/desktop/signing/codesign-cert.crt` (phần
công khai của chứng chỉ, đã commit), và job `runtime-release` của `.github/workflows/ci.yml`.

## Dữ liệu

- Bảng: `runtime_releases`, `runtime_bundles` (sở hữu bởi flow này; migration
  `apps/api/drizzle/0009_runtime_releases.sql`, flow `api-platform` sở hữu việc migrate); cột
  `machines.runtime_state` (jsonb, ghi bởi `recordHeartbeat()`, flow `machine-pairing`) và
  `machines.runtime_pinned_version`.
- File cục bộ trên máy: `~/.crew/runtime/<version>/` (0700, `host/`, `renderer/`, `manifest.json`,
  `manifest.sig`, file 0600) và `~/.crew/runtime/state.json` (active/history/bad/probation);
  `~/.crew/runtime/.incoming/` (tarball vừa tải, xoá ngay sau khi đọc).
- Sự kiện: `runtime.published` (owner stream cộng mọi máy còn sống, phát khi một bản được lưu),
  `runtime.pinned` (owner stream cộng đúng máy đó, phát khi owner ghim/bỏ ghim), `machine.runtime_changed`
  (owner stream, phát khi heartbeat báo version/trạng thái/shellVersion đổi) — cả ba định nghĩa ở
  `packages/shared/src/event-schemas.ts`, phát qua `appendEvents()` chung (flow `event-delivery`). Nội bộ
  shell: sự kiện host `runtime.changed` (daemon nghe được hai sự kiện server trên qua `/v1/daemon/stream` rồi
  báo main) và sự kiện renderer `runtime.status`/`daemon.runtime` (`packages/shared/src/desktop-ipc.ts`, flow
  `desktop-app`).
- Gọi ngoài: `https://api.github.com/repos/<repo>/releases` (nhập release `runtime-v*`, không cần
  credential — repo công khai); GitHub Actions secrets `CREW_RUNTIME_SIGNING_KEY`, `CREW_CODESIGN_P12_BASE64`,
  `CREW_CODESIGN_P12_PASSWORD`; `/usr/bin/codesign`, `/usr/bin/security` (danh tính ký code); System Settings
  qua `x-apple.systempreferences:` (mở đúng pane Full Disk Access).

## Flow liên quan

- desktop-app: `DaemonSupervisor` fork host từ `runtime.current().hostEntry`, `relaunch()` dừng có kiểm soát
  rồi khởi động host mới, sự kiện `host-crash` nuôi `RuntimeManager.onHostCrash()`; `HostService` thêm
  `host.runtimeCheck`/`host.runtimeDownload` và đẩy heartbeat ngay khi `facts.runtime` đổi;
  `packages/shared/src/desktop-ipc.ts` là hợp đồng IPC mà một cập nhật runtime không được tự đổi (bước 15).
- desktop-ui: bước trình cài đặt "Quyền ổ đĩa" và mục cùng tên ở "Trạng thái máy" dùng
  `FullDiskAccessPanel`; "Trạng thái máy" hiện version runtime đang chạy và nút "Kiểm tra runtime"
  (`app.checkRuntime`).
- api-platform: `runtimeRoutes`/`daemonRuntimeRoutes` đăng ký trong `buildApp()`; `startRuntimeImport()` khởi
  động cạnh sweeper/stuck-alarm khi `config.runtimeReleasesRepo` không rỗng; `RUNTIME_RELEASES_REPO`/
  `RUNTIME_EXTRA_PUBLIC_KEYS` đọc ở `apps/api/src/config.ts`.
- machine-pairing: `recordHeartbeat()` ghi `machines.runtime_state` và phát `machine.runtime_changed`;
  `Machine.runtime` (`reported`/`pinnedVersion`) đọc lại nó cho web.
- event-delivery: ba sự kiện của flow này phát qua outbox chung; `apps/web/src/lib/live-events.ts` map
  `runtime.published` sang làm mới danh sách bản runtime cộng máy, `runtime.pinned`/`machine.runtime_changed`
  sang làm mới máy.
- daemon-runtime: `VpsClient.runtime()`/`runtimeBundle()` (flow đó) là cách host hỏi/tải bản runtime;
  `CreateDaemonOptions.runtime`/`onRuntimeChanged` (đọc bởi `heartbeat()`, gọi khi dispatcher trả effect
  `runtime_changed`) sống trong `daemon.ts` của flow đó.
- daemon-scheduling: `dispatchEvent()` ánh xạ `runtime.published`/`runtime.pinned` sang effect
  `runtime_changed` (không sinh job) — `createDaemon()` gọi `onRuntimeChanged` khi thấy effect này.
- web-admin: trang Máy (`machines.tsx`) render `RuntimeReleases`/`MachineRuntime` của flow này.
- web-shell: `lib/api-client.ts` có `listRuntimeReleases`/`importRuntimeReleases`/`pinMachineRuntime`;
  `lib/queries.ts` có `keys.runtimeReleases`/`useRuntimeReleases`.
- deployment: job `runtime-release` của `.github/workflows/ci.yml` chạy trên tag `runtime-v*` (khác job
  `release` trên tag `v*`, dùng danh tính ký code của bước 16 nhưng không publish bản runtime nào); ba secret
  của flow này khai báo cùng chỗ với secret ký app.

## Tests

- `apps/api/test/runtime.test.ts`: lưu một bản ký một lần rồi báo owner + mọi máy qua sự kiện; từ chối bản
  chưa ký, ký bởi khoá lạ, hay đã sửa (manifest/tarball không khớp); mỗi máy nhận đúng bản mới nhất nó chạy
  được hoặc đúng bản đã ghim; tarball chỉ phục vụ máy đã ghép; máy thấy đúng bản mình báo cáo và bản đã ghim,
  owner được báo khi máy đổi; nhập từ GitHub bỏ qua bản chưa ký/ký bởi khoá lạ/đã biết, còn lại nhập đúng; từ
  chối gọi nhập khi tắt.
- `packages/shared/src/runtime-schemas.test.ts`: so sánh version đúng thứ tự số (bản thử trước bản chính
  thức), mọi so sánh trong một range phải đúng hết, thông báo rõ shell còn thiếu gì; manifest hợp lệ được
  nhận; path có thể thoát khỏi thư mục runtime bị từ chối; manifest thiếu entry host hay JSON hỏng bị từ chối;
  một trạng thái runtime lạ trong heartbeat bị bỏ qua thầm lặng thay vì làm hỏng cả heartbeat.
- `apps/desktop/test/runtime-update.test.ts`: cài một bản đã ký vào `~/.crew/runtime/<version>` với quyền
  0700/0600 rồi verify lại đúng khi chạy; từ chối bản chưa ký/ký bởi khoá khác/manifest đổi sau khi ký; từ
  chối tarball hay một file trong đó bị sửa; từ chối bản không hợp shell (version app hay Electron major); từ
  chối path traversal, path tuyệt đối, link và file ngoài manifest; từ chối chạy một bản đã bị sửa trên đĩa;
  chỉ tin khoá test ở chế độ E2E. Việc chọn bản để chạy: cài bản mới, giữ nguyên bản đang chạy khi không có gì
  mới, không bao giờ xuống dưới bản đóng gói trừ khi được ghim; hỏi cài dmg khi bản mới nhất cần shell mới hơn,
  không thử lại một bản đã lỗi. Máy trạng thái cập nhật: tải, kiểm, chờ job rồi chuyển host/cửa sổ sang bản
  mới; từ chối một tải bị sửa và giữ nguyên bản đang chạy; quay lui khi host mới lỡ ready-timeout hai lần hoặc
  crash lặp lại trong 5 phút (không thử lại đúng bản đó); kiểm lại ngay khi một bản qua được giai đoạn thử;
  quay lui khi chính bước chuyển lỗi; giữ bản active cộng hai bản trước sau khi bản mới đã qua thử; theo một
  ghim về bản cũ hơn hoặc về bản đóng gói; chạy bản đóng gói khi bản active không còn verify được lúc khởi
  động; không làm gì ở bản dev.
- `apps/desktop/test/full-disk-access.test.ts`: cấp quyền khi đọc được một đường dẫn được bảo vệ; từ chối khi
  macOS báo `EPERM`/`EACCES` mà không hiện hộp thoại nào; không rõ khi đường dẫn dò không tồn tại, và
  `unsupported` ngoài macOS; mở đúng pane Full Disk Access của System Settings.
- `apps/desktop/test/codesign.test.ts`: pin đúng chứng chỉ đã commit; nhận một designated requirement neo
  đúng chứng chỉ (`leaf`, hoặc `root` cho chứng chỉ tự ký); từ chối requirement ad-hoc, chứng chỉ khác, hay
  sai bundle identifier.
- `apps/desktop/test/e2e/runtime-update.spec.ts` (Electron thật qua Playwright `_electron`): một bản runtime
  ký trên server tới app đang chạy, app tự chuyển sang chạy nó mà không cần cài lại, và quay lui đúng khi một
  bản không khởi động được.

Test của `apps/desktop/test/daemon-supervisor.test.ts` (flow `desktop-app`, nơi test đó sống) kiểm
`relaunch()`/sự kiện `host-crash`; `apps/desktop/test/host-service.test.ts` (cùng flow đó) kiểm
`host.runtimeCheck`/`host.runtimeDownload` chạy trên API thật.
