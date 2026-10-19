# RV-1 — Review toàn nhánh Crew v3 R1-4

Ngày: 2026-10-08. Phạm vi: `v3..HEAD` của hai worktree dưới đây.

| Repo | Nhánh | Base v3 | HEAD đã review |
|---|---|---|---|
| Paperclip fork (`paperclip-r14-int`) | `crew/r1-4` | `d457ddbfd4a8fea571bbb8f66e29fec21ea02e4d` | `6b2db3a7f98c4cdc301349d930cfe983da4bea6c` |
| Crew (`crew-r14-mac`) | `r1-4-mac` | `dbc20752f9a1b9ef56ea092d17b52dcd01deb04d` | `f243a668c98ae179a526439d7a42093e6fba5961` |

Đã đọc plan (Global Constraints, Review Focus 1–5, Interface), sdd-ledger và sáu report UI-1…4, MC-1…2. Các đường dẫn dưới đây tương đối với repo được ghi là **Fork** hoặc **Crew**. Review chỉ đọc source và chạy kiểm tra; không sửa code, commit nhánh, push, deploy, SSH hay chạy `rm -rf`. Chỉ tạo báo cáo này. Các test có sẵn tự tạo/dọn fixture, bao gồm commit và worktree trong repo Git tạm của test; không commit vào hai nhánh được review.

## Kết luận

**NEEDS_FIXES**: 0 blocker, **6 major, 5 minor**. Build/test xanh nhưng chưa đủ điều kiện chuyển sang nghiệm thu thành công: snapshot docs có thư mục con bị webhook từ chối; bản tin máy có probe thiếu dữ liệu cũng bị từ chối; đường chạy launchd chưa bảo đảm tìm thấy Claude; metadata docs chưa qua secret-scan đầy đủ. Không phát hiện đường đọc chéo company qua các data handler trên SDK/host hiện tại.

## Phát hiện cần sửa

### RV1-01 — major — Snapshot có thư mục con không qua được webhook

- **File:dòng:** Crew `apps/crew-mac/src/status/docs.ts:184` và `:188`; Fork `packages/crew-plugin/src/docs/webhook.ts:26`.
- **Kịch bản:** `docs/guide/ok.md` được Mac gửi với `parentPath: "docs/guide"`. Danh sách `pages` chỉ có file `.md`, nên không có trang `docs/guide`. Webhook ném `docs-snapshot: trang cha không tồn tại`; host trả 502, Mac giữ `lastCommit` và thử lại mãi. Repo Crew thật có nhiều `docs/flows/**`, `docs/guides/**` nên đây là luồng bình thường.
- **Bằng chứng:** đã lấy fixture Git thật do suite Mac tạo, gọi `buildDocsSnapshot` thật, rồi đưa nguyên snapshot qua `validateDocsSnapshot` thật: bị từ chối với đúng lỗi trên. Test Mac hiện tại có `docs/guide/ok.md` nhưng fetcher luôn trả 200; test plugin chỉ dựng `parentPath: null`.
- **Đề xuất:** thống nhất cây theo thư mục hoặc theo trang ở cả sender, validator và UI. Nếu dùng thư mục, tạo/cho phép node thư mục rõ ràng; nếu dùng trang, chỉ tham chiếu trang cha tồn tại. Thêm test hợp đồng dùng trực tiếp output Mac làm input webhook, gồm repo có `docs/flows/`.

### RV1-02 — major — Máy đang lỗi không gửi được bản tin sức khỏe

- **File:dòng:** Crew `apps/crew-mac/src/status/report.ts:13`, `:60`, `:69`; Fork `packages/crew-plugin/src/machines/webhook.ts:25`–`:31`; Crew `apps/crew-mac/src/commands/status.ts:195`–`:202`.
- **Kịch bản:** Claude logout làm `claude.plan = null`; không đọc được version, CPU/RAM/load hoặc owner gỡ Superpowers cũng tạo `null`. Parser server bắt buộc số và chuỗi không rỗng. Máy có HMAC đúng bị 502 thay vì hiện cảnh báo cụ thể. `sendStatus` ném lỗi trước `sendDocsSnapshots`, nên docs cũng ngừng cập nhật theo.
- **Bằng chứng:** gọi `buildMachineReport` với probe giả lập logout, rồi parser thật: `plan: null`, `ownerInstalled: null` → `Bản tin máy không hợp lệ`. Suite phía server chỉ dùng mẫu máy khỏe.
- **Đề xuất:** định nghĩa chung trạng thái “không đọc được/chưa cài/chưa đăng nhập”, đồng bộ validator, DB và UI. Giữ bản tin sức khỏe hợp lệ khi một probe hỏng; hiển thị “Không rõ” thay vì chế số liệu. Test logout, timeout, thiếu Claude/Superpowers và lỗi probe hệ thống xuyên hai phía.

### RV1-03 — major — Job launchd gọi Claude bằng PATH của phiên không có shell

- **File:dòng:** Crew `apps/crew-mac/src/status/report.ts:42`–`:43`; `apps/crew-mac/src/commands/setup.ts:73`–`:82`; `apps/crew-mac/src/system.ts:22`.
- **Kịch bản:** Claude cài ở `~/.local/bin/claude`, setup chỉ thêm PATH vào `.zshenv`. LaunchAgent chạy trực tiếp node, không chạy zsh và plist không đặt PATH. Trong phiên launchd không có `~/.local/bin` trong PATH, `spawn("claude", …)` trả code 127 mặc dù doctor qua sshd/zsh vẫn thấy Claude. Bản tin trả version null và còn bị RV1-02 chặn.
- **Bằng chứng:** đối chiếu đường gọi trực tiếp `spawn`, plist và setup; không cài/chạy launchd thật trong review này. Lỗi xảy ra trong môi trường PATH tối thiểu, không khẳng định mọi máy hiện tại đều có PATH như vậy.
- **Đề xuất:** resolve đường dẫn executable đã cài rồi gọi tuyệt đối, hoặc thiết lập PATH tối thiểu, có kiểm soát cho job. Thêm test chạy với PATH `/usr/bin:/bin:/usr/sbin:/sbin`, Claude fixture ở `~/.local/bin`. Không đưa secret vào plist.

### RV1-04 — major — Secret-scan bỏ sót metadata; symlink có thể đưa đường dẫn nhạy cảm vào snapshot

- **File:dòng:** Crew `apps/crew-mac/src/status/docs.ts:137`–`:158`, `:183`–`:201`; `apps/crew-mac/src/commands/status.ts:229`.
- **Kịch bản:** file `docs/<chuỗi-dạng-token>.md` có nội dung sạch được đổi tên thành `docs/page-N.md` để scan. R7 chỉ thấy tên tạm/nội dung, nhưng output vẫn gửi tên gốc qua `pages.path` và có thể qua title fallback/parentPath/dropped. Tên repo cũng được gửi bằng `basename` mà không scan. Ngoài ra, `ls-tree --name-only` bỏ mode: symlink `docs/link.md` trỏ `/Users/alice/.ssh/id_ed25519` được `git show` đọc thành **chuỗi đường dẫn đích** và gửi như nội dung trang. Không đọc nội dung file đích, nhưng vẫn làm lộ đường dẫn file bí mật.
- **Bằng chứng:** test bổ sung dùng fixture Git và scanner R7 thật, chỉ thay tên tracked file qua seam của lệnh Git (không tạo commit mới): R7 nhận ra token tổng hợp khi scan tên đó trực tiếp, trong khi `buildDocsSnapshot` vẫn có đường dẫn đó trong `pages`, không có trong `dropped`. Phần symlink xác nhận bằng luồng source/Git object, chưa có test symlink riêng trong suite nhánh.
- **Đề xuất:** scan cả metadata sẽ gửi; metadata chứa secret phải được loại/redact ngay cả trong `dropped` và log. Dùng `ls-tree -z` có mode, chỉ nhận blob file thường (`100644/100755`), bỏ symlink/submodule. Giữ cách dùng tên tạm an toàn để scan nội dung. Thêm trường hợp token trong tên file/repo, symlink tới ngoài docs và symlink tới đường dẫn bí mật.

### RV1-05 — major — Dọn 24 giờ xóa cả bản tin cuối của máy mất liên lạc

- **File:dòng:** Fork `packages/crew-plugin/src/machines/webhook.ts:48`; `packages/crew-plugin/src/machines/data.ts:14`–`:17`.
- **Kịch bản:** máy A ngừng gửi 25 giờ. Máy B gửi mới; DELETE xóa mọi dòng quá 24 giờ, bao gồm dòng cuối của A. `crew.machines` lấy danh sách từ chính bảng này, nên A biến mất khỏi trang và widget thay vì tiếp tục hiện “mất liên lạc”. DELETE còn áp dụng toàn bảng, nên bản tin của company khác cũng có thể kích hoạt việc xóa này.
- **Bằng chứng:** tái hiện với embedded PostgreSQL thật, migration thật, handler thật và validator SQL runtime của host: trước B gửi có `fixture-a, online=false`; sau B gửi chỉ còn `fixture-b, online=true`.
- **Đề xuất:** giữ latest riêng theo `(company_id,machine_id)` và chỉ dọn bảng history, hoặc DELETE có ngoại lệ giữ dòng cuối mỗi máy. Test cả trường hợp không gửi lại sau 24 giờ và hai company. Đây là lỗi khác với việc dọn lịch sử khi có bản tin mới: hợp đồng đòi **một bản tin mới nhất cộng lịch sử 24 giờ**.

### RV1-06 — major — Docs-check không xác thực nguồn integrator, có thể hiện kết quả đạt sai

- **File:dòng:** Fork `packages/crew-plugin/src/docs/data.ts:22`–`:23`; đối chiếu `server/src/crew/issue-gate.ts:340`–`:358` và `crew/agents/integrator.md:77`.
- **Kịch bản:** integrator đăng `crew-docs-check … exit=1`; executor hoặc người khác đăng sau đó một marker cùng định dạng với `exit=0`. UI chọn marker sau và báo “Đạt”, trong khi gate thật chỉ nhận bằng chứng từ participant stage docs. Tác giả được SELECT nhưng không lọc và UI không hiển thị để người xem phân biệt. Một marker mới nhất sai định dạng cũng bị bỏ qua để hiện bằng chứng cũ, khác cách gate xử lý marker mới nhất.
- **Bằng chứng:** source query không ràng buộc `author_agent_id` theo policy; test DB hiện chèn marker không có author rồi vẫn coi là bằng chứng. Đây là lệch provenance của UI, không phải bypass gate thực thi.
- **Đề xuất:** dùng cùng quy tắc chọn stage/participant docs và marker mới nhất như `issue-gate`; trả rõ khi bằng chứng mới nhất không hợp lệ. Thêm test marker giả của executor/user, marker mới nhất malformed và nhiều commit, rồi so với kết quả gate.

### RV1-07 — minor — Nhận diện issue gốc Crew chỉ dựa số stage và max rounds

- **File:dòng:** Fork `packages/crew-plugin/src/handlers/map.ts:77`–`:80`; `packages/crew-plugin/src/handlers/roots.ts:43`.
- **Kịch bản:** một issue gốc stock cùng company có `maxReviewRounds=5` và bốn stage approval bất kỳ cũng xuất hiện là yêu cầu Crew; policy hai stage bất kỳ còn bị gán kind research. Điều này vi phạm yêu cầu roots chỉ gồm issue gốc Crew.
- **Bằng chứng:** gọi `isCrewRoot` thật với bốn stage `approval` → `true`. Template Crew thật ở `server/src/crew/issue-policy.ts:161`–`:180` là chuỗi review/review/approval/review hoặc review/approval với participant phù hợp.
- **Đề xuất:** dùng predicate dựa template/principal hoặc dấu nhận diện Crew có nguồn tin cậy, thay vì chỉ độ dài. Ít nhất kiểm cấu trúc stage và loại participant; test policy stock trùng số stage.

### RV1-08 — minor — UI còn trạng thái tiếng Anh và không phân biệt các stage review

- **File:dòng:** Fork `packages/crew-plugin/src/ui/page.tsx:23`–`:25`; `packages/crew-plugin/src/ui/map/ticket-node.tsx:13`–`:21`; `packages/crew-plugin/src/ui/machines/index.ts:27`, `:54`.
- **Kịch bản:** bảng roots hiện `in_progress`/`in_review`; card và bảng hiện `Stage: review`. Ba giai đoạn reviewer, integrator merge/docs và integrator push đều có type review, nên nhìn UI không biết đang ở giai đoạn nào dù API có `currentStageId`. Máy hiện Online/online.
- **Đề xuất:** dùng nhãn tiếng Việt thống nhất cho status/kind; đối chiếu `currentStageId` với policy để trả/hiện tên giai đoạn cụ thể. Test ba stage review cho ba nhãn khác nhau, không suy stage từ issue status.

### RV1-09 — minor — Lỗi DB còn phản chiếu giá trị đầu vào ra log và response

- **File:dòng:** Fork `packages/crew-plugin/src/machines/webhook.ts:26`, `:44`; `packages/crew-plugin/src/docs/webhook.ts:47`–`:51`. Đường truyền lỗi: `server/src/services/plugin-worker-manager.ts:2727`–`:2734`, `server/src/routes/plugins.ts:2806`–`:2820`.
- **Kịch bản:** payload ký hợp lệ với `cpuCount=2147483648` qua parser JS nhưng vượt cột PostgreSQL integer. Lỗi nguyên văn từ DB đi qua RPC và stock response 502; host cũng log message. Không tìm thấy secret HMAC bị in, nhưng yêu cầu không lộ giá trị lỗi chưa được đáp ứng hoàn toàn.
- **Bằng chứng:** embedded PostgreSQL trả `value "2147483648" is out of range for type integer`. Chưa gửi HTTP thật; việc log/response được đối chiếu source host.
- **Đề xuất:** chặn giới hạn cột và chuỗi/ký tự DB không hỗ trợ ngay trong schema trước DB; chuyển lỗi ở biên webhook thành mã ổn định. Lưu ý catch trong plugin chỉ chặn response, không xóa được log do host đã ghi khi `db.execute` lỗi; muốn redaction đầy đủ ở host cần ruling riêng vì không được sửa lõi trong R1-4.

### RV1-10 — minor — Staging docs mồ côi chưa được dọn (nợ đã biết)

- **File:dòng:** Fork `packages/crew-plugin/src/docs/webhook.ts:43`–`:51`; `packages/crew-plugin/migrations/0001_docs.sql:10`.
- **Kịch bản:** lỗi giữa các INSERT để lại snapshot không được trỏ tới; hai webhook cùng đọc previous rồi đổi con trỏ có thể để lại một snapshot hoàn chỉnh mồ côi. Lần ghi sau chỉ dọn `previousId`, nên các dòng này không tự hết hạn.
- **Đề xuất:** làm đúng ruling trong ledger: dọn snapshot không được `docs_current` tham chiếu và cũ hơn 10 phút, để FK cascade dọn pages/links; bổ sung index cho sweep nếu cần. Test thất bại giữa chừng và hai lần ghi đồng thời. Không coi việc thiếu transaction tự thân là lỗi công bố nửa snapshot: cơ chế con trỏ hiện tại bảo vệ phần đó.

### RV1-11 — minor — Kiểu React quá rộng và code dồn dòng làm giảm giá trị kiểm tra

- **File:dòng:** Fork `packages/crew-plugin/src/shared/react.d.ts:1`–`:7`; `packages/crew-plugin/src/machines/data.ts:28`–`:38`; `packages/crew-plugin/src/docs/data.ts:3`–`:5`, `:53`–`:59`.
- **Kịch bản:** shim `createElement(type: unknown, props: Record<string, unknown>, …)` cho phép component nhận props sai mà typecheck không bắt, mặc dù package hiện đã có `@types/react`. Các hàm/SQL/đăng ký dồn một dòng và helper UUID/JSON/namespace lặp lại khiến các hợp đồng dễ lệch mà test riêng vẫn xanh, như RV1-01/02. Hai import ở dòng 35–36 của machines/data xuất hiện sau các hàm; đây không phải lỗi runtime ESM nhưng làm khó đọc dependency và trái cách tổ chức chung.
- **Đề xuất:** dùng kiểu React thật, xóa shim khi đủ type; đưa import lên đầu, tách validation/SQL/registration thành các khối dễ đọc và gom helper phù hợp. Không cần đổi hành vi chỉ để chuẩn hóa tên thư mục; handler map/roots đã ở `src/handlers` theo ruling tránh `.gitignore`.

## Đã kiểm, không có vấn đề trong phạm vi nêu dưới đây

### Webhook, SQL và quyền company

- Trong plugin: byte limit 16 KiB/5 MiB chạy trước `JSON.parse`; kiểm header, timestamp nguyên và lệch tuyệt đối tối đa 300 giây. JSON chưa tin cậy chỉ dùng chọn company; config và secret resolve lại mỗi request, không cache giá trị. HMAC ký đúng `<timestamp>.<rawBody>`, so buffer 32 byte bằng `timingSafeEqual`. Hai repo dùng cùng vector cố định.
- Các lỗi config/secret resolve được đổi thành mã tĩnh; không log hoặc trả secret. Schema máy chặn trường lạ, gồm `checks.detail/hint`. Machine ID chỉ cần UUID, **không thiếu allowlist** theo ruling. `lastLoadGate` không còn trong hợp đồng/code.
- Không thấy INSERT/UPDATE/DELETE vào namespace plugin trước khi HMAC, envelope và schema xong. Docs kiểm project thuộc company bằng query có cả hai ID trước khi ghi. Tests DB thật chứng minh thiếu/sai/stale signature, quá giới hạn, company lạ, machine ID sai, project khác company không tăng dữ liệu plugin trong các ca đã dựng.
- Mọi giá trị từ người gửi đều là `$n` bind parameters; tìm kiếm docs escape `%`, `_`, backslash và LIMIT 50. Không thấy nối giá trị người gửi vào SQL. Tên namespace ở machines không có regex cục bộ như docs, nhưng lấy từ `ctx.db.namespace` do host sinh (`derivePluginDatabaseNamespace`), không từ request; host kiểm namespace và bảng trước execute/query. Không kết luận SQL injection từ interpolation đó.
- **Company không chỉ là tham số UI:** UI bridge đưa company từ context vào trường top-level; `assertPluginBridgeScope` gọi `assertCompanyAccess` (Fork `server/src/routes/plugins.ts:728`, `:1437`, `:1624`). SDK `worker-rpc-host.ts:1919`–`:1922` trải `params.params` trước rồi ghi đè `companyId` đã được host kiểm. Vì thế request top-level A + params B vẫn chạy A; bỏ top-level company đòi instance admin. Worker map so issue/company; ancestor/subtree, agents, relations/comments đều ràng buộc company; docs-check kiểm từng ancestor; docs tree/page/search kiểm project/company; roots/machines/projects lọc company. Không có đường đọc chéo company được xác định trong luồng này. Kết luận dựa source host/SDK cộng test DB, chưa phải pentest HTTP instance thật.

### Mac, snapshot và dữ liệu nhạy cảm

- Payload máy không serialize env, output lỗi của probe, token auth, detail/hint của doctor hoặc đường dẫn Keychain. Title check phần lớn tĩnh; TCC client là đường dẫn executable theo interface, không phải nội dung env. Secret dùng Keychain; config/repos/last-result được ghi private. Plist chỉ chứa node/CLI/job/log, không chứa secret.
- Nội dung snapshot lấy từ Git object tại commit, không lấy nội dung working tree. Chỉ chọn tên dưới `docs/` kết thúc `.md`; symlink không bị dereference thành nội dung ngoài docs (nhưng có lỗi metadata RV1-04). NUL bị loại trước scan. Tên tạm ASCII tránh lỗi parse tên Unicode/khoảng trắng; suite có ca tương ứng. Không tuyên bố đã chứng minh scanner an toàn với mọi cấu hình Git toàn cục/loại mã hóa.
- Cleanup đã được sửa ở HEAD: finally gỡ worktree rồi `removeOwnTempDir`; chỉ xóa đường dẫn realpath ngay dưới tmpdir có tiền tố sở hữu. Suite có thành công, scanner lỗi, không xóa ngoài tmpdir. Không còn kết luận “mọi thư mục tạm cố ý để nguyên” từ report MC-2 cũ.
- Set-secret qua argv của `security` vẫn là rủi ro đã được ledger chấp thuận; không nâng lại thành blocker mới. Không chạy Keychain/setup/launchd thật.

### Map, UI, migration và tích hợp

- Parent edge lấy `parent_id`; dependency lấy relation `blocks`; repair lấy marker `crew-fix base` ghép `crew-commit`, reviewer rounds từ `executionState.changesRequestedCount`; stage từ `execution_state`, không suy từ status. Có test PostgreSQL cho hình dạng CRE-36/CRE-44, layout và render card React Flow thật. Chưa đối chiếu DB của spike thật.
- Map root dùng khoảng 3–4 query, thêm một query mỗi cấp ancestor khi mở issue con; không query riêng từng node/assignee/edge. Roots một query aggregate; machines hai query. Với cây Crew thông thường không thấy N+1 nặng. Queries comments và roots chưa phân trang; ghi docs một INSERT mỗi page/link, nên quy mô lớn cần đo riêng, không dùng 19 test nhỏ để khẳng định hiệu năng tải lớn.
- UI xử lý lỗi fetch thành trạng thái tại chỗ; map, panel và page section có boundary, host còn có slot boundary. Dùng component SDK host cho bảng/badge/Markdown/Spinner/Boundary, màu map dùng token host. Không có sửa `ui/**` hoặc lõi server trong diff. Không chạy token-gates của `ui/**` vì không có thay đổi ở phạm vi đó.
- **localStorage có dùng**, tại `ui/map/ticket-map.tsx:26`–`:39`: chỉ lưu `{x,y,zoom}` của viewport, key chứa root ID; không lưu map nodes, status, docs, bản tin máy hay secret. Đây là preference giao diện, không dùng làm nguồn trạng thái nghiệp vụ. Nếu yêu cầu được hiểu là cấm hoàn toàn localStorage thì cần bỏ preference này; báo cáo không che việc nó tồn tại.
- Ngày giờ roots/docs/machines đều format `vi-VN`, `Asia/Ho_Chi_Minh`. Nhãn chưa Việt hóa được tách ở RV1-08.
- Registry đã nối docs panel, docs section, machines section; manifest có đủ detailTab/page/dashboardWidget và hai webhook. Bundle build được, React/ReactDOM/SDK external, xyflow/CSS đóng vào JS. Gzip **94.308 byte**, raw **422.114 byte**, dưới 1,5 MB.
- Hai migration dùng namespace đúng `plugin_crew_core_0433ea20b6`. SQL CREATE không có IF NOT EXISTS, nhưng host có migration ledger/checksum, advisory lock và transaction; migration applied cùng checksum được bỏ qua, nên không coi đây là lỗi idempotency. PK/index phục vụ current lookup/pages/links/latest/history; đã đối chiếu validator host và migration DB. Chưa chạy lifecycle install/restart plugin đầy đủ hai lần.
- Overlay chép dist gồm UI và migrations; image check kiểm UI tồn tại và giới hạn gzip. Lockfile có xyflow cùng dependency cần thiết. Hook vẫn 5/5; không thêm core hook. Không build hoặc inspect image thật trong review này.

## Kiểm tra đã chạy

| Kiểm tra | Kết quả |
|---|---|
| Trước suite plugin: `ipcs -m` | 5 segment; không gỡ segment |
| Trong `packages/crew-plugin`: `pnpm build` | PASS |
| Trong `packages/crew-plugin`: `pnpm typecheck` | PASS |
| Trong `packages/crew-plugin`: `npx vitest run` | PASS, 9 file / 19 test |
| `node crew/release/check-core-hooks.mjs` | PASS, 5/5 hook, 0 lỗi; 4 cảnh báo chưa có PR upstream |
| `node --test crew/ops/*.test.mjs` | PASS, 23/23 |
| Crew: `pnpm --filter @crew/mac test` | PASS, 21 file / 283 test; không gặp và không cần bỏ qua flake `crew-claude-run` lần này |
| Crew: `pnpm --filter @crew/mac typecheck` | PASS |
| Crew: `node packages/docs-kit/dist/crew-docs.cjs check --range v3..HEAD` | PASS, 5 commits |
| `git diff --check v3..HEAD` cả hai repo | PASS |
| Đo bundle bằng `gzipSync` | 94.308 byte gzip |
| Kiểm tra bổ sung không sửa source | Tái hiện RV1-01, 02, 04 (metadata qua seam tên file), 05, 07 và 09 |
| Trước DB test bổ sung và sau hoàn tất: `ipcs -m` | Vẫn 5 segment; không gỡ segment |
| Git status sau kiểm tra | Hai worktree sạch |

Test bổ sung chạy module TypeScript bằng loader/esbuild trong bộ nhớ, không ghi file source/test mới. RV1-05/09 dùng embedded PostgreSQL riêng, dọn bằng helper test hiện có. Mỗi đợt DB test được kiểm `ipcs -m` trước khi chạy. Các lần thử harness chưa nạp được module/fixture đã được sửa trong lệnh chạy và chạy lại thành công, không được tính là lỗi sản phẩm.

**Chất lượng bằng chứng:** test DB không phải mock rỗng: có cluster PostgreSQL, schema/migration, row insert/select thật. Test chữ ký có vector xác định. Test Mac dùng repo Git và scanner thật nhưng HTTP/command runner giả lập; không xác thực payload với schema plugin. Test component hiện chỉ SSR card, chưa test cả tab/page/docs/machines hoặc fault injection boundary. Không có test tích hợp Mac → webhook thật, retention giữ latest, provenance docs-check hay launchd PATH tối thiểu. Đây là lý do test hiện tại xanh trong khi các lỗi ở trên vẫn tồn tại.

Không chạy full repo typecheck/build/test, server typecheck, browser/Playwright, API stock thật, image build/inspect, deploy, SSH, launchd/Keychain thật. Phạm vi RV-1 chỉ yêu cầu các lệnh hẹp bên trên và cấm thao tác triển khai; các cổng môi trường thật thuộc AC-4. Không tuyên bố PR/release-ready.

## Status

**NEEDS_FIXES — review hoàn tất, chưa chấp nhận nhánh để nghiệm thu đạt.**

## Summary

6 major và 5 minor, có file:dòng, kịch bản và đề xuất sửa. Các lệnh yêu cầu đều xanh. Ưu tiên sửa hợp đồng snapshot/machine, PATH launchd, secret-scan metadata, giữ latest máy và provenance docs-check, rồi bổ sung test xuyên hai phía trước AC-4. Không phát hiện bypass quyền company hay SQL injection trong phạm vi đã đọc.

## Concerns

- Stock Express parse JSON trước plugin (limit host 10 MB); stock webhook ghi `plugin_webhook_deliveries` chứa payload/headers **trước HMAC**. Byte limit của plugin bảo vệ parser/DB namespace plugin, không bảo vệ toàn bộ ingress/host DB. Đây là cơ chế stock đã được ruling chấp thuận, không phải đường ghi namespace chưa xác thực mới. Body JSON malformed hoặc vượt limit host có thể bị host từ chối trước khi đến handler, nên 200/502 chỉ mô tả đường dispatch webhook đã tới handler, không phải mọi HTTP request bất kỳ.
- Snapshot staging mồ côi là nợ đã biết RV1-10; link reference-style/HTML và khả năng điều hướng fragment chưa được nghiệm thu đầy đủ. Parser inline không nên được hiểu là audit mọi loại liên kết Markdown.
- `status send` gọi toàn bộ doctor rồi mới gửi; doctor có các probe/kiểm worktree với budget dài và docs snapshot có thể chạy lâu. Chưa đo khả năng duy trì nhịp 60 giây trên máy nhiều repo hoặc bị TCC treo. Cần đo tại AC-4, không chạy SSH/probe thật trong review.
- Rủi ro argv Keychain giữ nguyên theo ledger; localStorage chỉ có viewport như đã nêu. Không upload báo cáo hay thay trạng thái issue trên hệ thống ngoài: deliverable được ghi đúng đường dẫn local user yêu cầu.
