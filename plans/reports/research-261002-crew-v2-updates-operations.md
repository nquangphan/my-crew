# Crew v2 Phase 09 — Nghiên cứu cập nhật và vận hành

Ngày kiểm tra: 2026-10-02. Chỉ đọc tài liệu công khai và producer trong worktree; không tải binary, ký, gọi Keychain/notary, đăng ký dịch vụ hay deploy.

## Nguồn chính thức và quyết định

| Bằng chứng đã đọc | Kết luận dùng trong kế hoạch |
|---|---|
| [Electron v44.5.1](https://github.com/electron/electron/releases/tag/v44.5.1), [release API](https://api.github.com/repos/electron/electron/releases/tags/v44.5.1), [stable index](https://releases.electronjs.org/release?channel=stable) | Giữ Electron44.5.1 của desktop03; API published_at=2026-09-30T02:12:03Z. Không dùng floating latest. |
| [Electron44 support](https://www.electronjs.org/blog/electron-44-0), [breaking changes](https://www.electronjs.org/docs/latest/breaking-changes) | Electron44 requires macOS13+, matching SMAppService floor. Package binary/header and actual OS tests remain mandatory. |
| [Apple swap support](https://developer.apple.com/documentation/foundation/urlresourcevalues/volumesupportsswaprenaming?changes=__1_2), [APFS APIs](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/ToolsandAPIs/ToolsandAPIs.html) | Check volumeSupportsSwapRenaming before native RENAME_SWAP; durable journal still needed for pointer/health/recovery. |
| [Node24.21.0 LTS](https://nodejs.org/en/blog/release/v24.21.0), [SHASUMS256](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt) | Private Node24.21.0 thỏa floor24.12, ghim riêng với Electron embedded Node; không nâng Node toàn máy. SHA dưới đây là metadata upstream, chưa hash binary tải về. |
| [Electron autoUpdater](https://www.electronjs.org/docs/latest/api/auto-updater) | macOS dùng Squirrel.Mac và yêu cầu app có chữ ký. Downloaded update có thể áp dụng ở lần app khởi động sau. Suy luận thiết kế: không dùng API này làm coordinator cho host độc lập vì cần drain/checkpoint/rollback trước mọi activation. |
| [Electron signing](https://www.electronjs.org/docs/latest/tutorial/code-signing) | Ký và notarize là hai bước; app/helper identity ổn định cần được kiểm trên bundle thật để đánh giá Keychain/login item. Bản unsigned/ad-hoc không chứng minh quyền production. |
| [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice), [Apple helper migration](https://developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos) | macOS13+ quản lý LaunchAgent trong app bundle; plist đặt Contents/Library/LaunchAgents, BundleProgram tương đối bundle. Register phụ thuộc user approval. Chọn user agent, không root daemon. |
| [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution?changes=_9), [packaging](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution?changes=_7) | ZIP/DMG/PKG là định dạng notarization; hardened runtime và Developer ID là release prerequisites. Dùng notarize ZIP chứa app, staple app rồi đóng ZIP cuối và hash lại; bằng chứng cuối phải từ artifact giao người dùng. |
| [TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html) | Nested code cần ký đúng thứ tự; designated requirement/identity giúp nhận diện phiên bản. Không sửa signed bundle tại chỗ hoặc dùng codesign --deep để thay việc cấu hình nested signing. Giữ entitlements tối thiểu theo executable và kiểm thực tế. |

- [PostgreSQL18 pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html) / [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html): custom-format dump/restore supports a database snapshot; external blob consistency remains Crew's write-fence/inventory responsibility, not implied by successful pg_dump.
- [Docker project names](https://docs.docker.com/compose/how-tos/project-name/) / [secrets](https://docs.docker.com/compose/how-tos/use-secrets/): project namespace and per-service secret references support isolated v2 topology; fixed volume names/shared external networks still require explicit deny checks.

## Metadata byte pins đã lấy read-only

| Artifact upstream | SHA-256 được upstream công bố |
|---|---|
| electron-v44.5.1-darwin-arm64.zip | 1d75703019bb16461ae65f3081d7e6f5c0b11e901d0ccb5c343bcf7bcdd6435c |
| electron-v44.5.1-darwin-x64.zip | e567d13833d0e161d7749727355b98643461df3395b537cfa7bdddf8a8bfedff |
| node-v24.21.0-darwin-arm64.tar.gz | bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057 |
| node-v24.21.0-darwin-x64.tar.gz | 1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097 |

Electron hashes từ GitHub release asset.digest; Node hashes từ HTTPS SHASUMS256 đọc bằng urllib. Khi build phải kiểm bytes và chữ ký SHASUMS bằng release keys được ghim độc lập; metadata HTTPS không thay bằng chứng signature hoặc binary download. Node/GitHub redirect origins phục vụ build khác allowlist CDN Crew production. Pin build tooling/compiler version+hash và SDK trên builder khi tạo release; không phụ thuộc Xcode/clang ở máy nhận.

## Quyết định kiến trúc của Crew, chưa phải chứng nhận nền tảng

- Một full signed `.app` ZIP per arm64/x64 chứa UI, gateway JS, private Node, native process/resource helpers, ServiceManagement bridge và update coordinator; manifest vẫn liệt kê version/source/binary hash từng component. Full-bundle activation tránh cặp app/host lệch sau partial component download.
- Host do user-session agent khởi chạy, app window không sở hữu vòng đời. Coordinator native tồn tại ngoài host Node trong lúc đổi bundle; same-filesystem swap + journal + active pointer/previous bundle, rollback chỉ khi xác nhận host mới dừng và schema vẫn đọc được bởi bản cũ. Đây là thiết kế phải thử trên bundle ký thật, chưa được coi là tính năng Apple cung cấp tự động.
- Floor package macOS13 do SMAppService; artifact `minMacOS` cuối là max(13, minimum của Electron/Node/SDK build) và phải chứng minh trên máy/VM hỗ trợ. Nếu binary pin đòi cao hơn13, chỉ publish floor thực đo; không giả hỗ trợ13 chỉ vì API tồn tại.
- Existing03 NativeHelper.build compile C ở dev; Phase09 phải thêm explicit prebuilt loader và inject ProcessIdentity/ResourceRegistry. macOS NOTE_TRACK không hỗ trợ từ10.5; current fork evidence UNKNOWN giữ nguyên. Update không giải quyết thay Phase04 supervisor/isolation certificate.
- Chữ ký app/publisher chỉ chứng minh nguồn binary; không tự chứng nhận runtime04, routing06 hay observer08. Thay binary/policy/OS phải re-evaluate các certificate bound exact context trước nhận việc mới.

## Gate thật còn mở

Identity/Team ID/bundle ID production và notary credential chưa được khảo sát, không ghi giả. T2 xuất unsigned test package/config/manifest preview trước khi cần owner cấp quyền ký và chọn stable identity. Kiểm ACL/permission trong tài khoản macOS test được cho phép; không dùng owner bundle/Keychain thật làm fixture. Production deployment chỉ sau artifact/backup/restore/health plan review và exact owner action hoặc owner-created deploy root chứa exact target/release. Phase08 historical approved fe280b7/final SHA `54452166e7acab5d139f86b7f4d302d257a5f07c9f002a0bcff12645576a8eec`; approved thin EffectId correction final SHA `e2f7eb0fd370dc14821db708568da36b728aaab767cd292645d79a90b94ed1f8`. Đây là plan evidence; actual merge/head/docs/observer implementation/certification vẫn cần bằng chứng.

## Đối chiếu producer trong fix wave1 F1–F5

- Actual004 deploy fingerprint hash toàn bộ definition trừ deployApprovalDecisionId; createTicket tự sinh ID. Plan tách DeployDefinition chuẩn bị trước create khỏi DeployPlan server-derived sau create, không đổi thuật toán004.
- Actual03 native-resources.c từ chối mọi symlink; registerProcess cần workflow ProcessJournal READY; cleanup không có owner proof thì giữ. Updater dùng BundleResourceRegistry/manifest-bound native helper và OperationProcesses journal riêng với OS stop/never-spawned proof, không nới scratch policy hay bịa workflow pin.
- Initial install và update/rollback health dùng signed HealthObservation chung với tagged HealthScope, server challenge+issuer/build/boot/start bindings và immutable receipt; initial acceptance ghi install/current nguyên tử không cần update grant. Bearer JSON không tự có health trust.
- Các helper/policy mới là thiết kế cần implementation/native tests và measured key/process isolation; không coi nguồn Apple nói chúng đã tồn tại hoặc hiện có PASS.

## N1 round2 — exact logical-effect encoding

04 `phase-04-runtime-models.md:162,168` derive effectId bằng SHA-256 canonical(runId,stepOperationId,actionKind,targetIdentity,preconditionSha256);06 `phase-06-assistant-workflows.md:136` persist stable010 assistant_operation_ids mapping.09 đổi riêng logical-effect alias/DTO/parser/drain IDs/012 effect fields thành lowercase hex64, giữ UUID cho operation/ticket/attempt/action. Server đối chiếu010 mapping trong Tx; local04 EffectLedger giữ execution/reconcile. Actual04-derived +010 mapping qua HTTP09 prepare/recovery/receipt là positive regression; UUID/wrong digest/precondition/action/foreign run là negatives. Cùng encoding defect trong08 được sửa hẹp, joint scoped review đã đóng N1 với spec/quality READY YES ở mức kế hoạch; không mở lại F1–F5 hoặc08 F1–F4, không sửa SQL001–011/public005/FinalEvidencePort. Task7 đã COMPLETE tại4ae9ed9+c6f9b60, F1/M1 closed, M2 minor ledger; không suy certification/live PASS từ kết quả đó.
