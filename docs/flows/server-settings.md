# Cài đặt hệ thống trên server (prompt, quy tắc, model, tài nguyên)

> Flow `server-settings`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow
> server-settings` in ra đúng danh sách đó.

## Mục đích

Prompt của từng vai trò agent, quy tắc guard/QC, bảng model, tài nguyên máy, thư mục dự án trên từng máy và MCP
tắt theo dự án không còn nằm cố định trong bundle daemon hay `~/.crew/config.yaml` cục bộ — chúng là cài đặt
trên server, mỗi lần sửa là một bản (`version`) mới có tác giả/giờ/ghi chú, sửa trên web ("Cài đặt hệ thống").
Daemon lấy cài đặt áp dụng cho máy mình, cache lại và áp dụng cho job kế tiếp mà không cần cài lại app hay
khởi động lại daemon; job đang chạy giữ nguyên cài đặt nó đã bắt đầu. Quyết định chủ dự án khoá cứng trong
code, không setting nào đổi được: docs luôn chạy `sonnet`, Fable không bao giờ được chọn, `AGENTS.md`/
`CLAUDE.md` luôn được bảo vệ và không bao giờ là docs; lệnh test của một project vẫn ở lại `config.yaml` cục
bộ vì nó chạy như một shell command trên chính máy đó.

## Điểm vào

- `apps/api/src/routes/settings-routes.ts` → `settingsRoutes` (owner: `GET/POST /v1/settings`,
  `GET /v1/settings/history`, `POST /v1/settings/validate`, `GET /v1/settings/revisions/:id`,
  `GET /v1/settings/diff`, `POST /v1/settings/revisions/:id/restore`) và `daemonSettingsRoutes` (daemon:
  `GET /v1/daemon/settings`, `POST /v1/daemon/settings/import`,
  `PUT /v1/daemon/settings/projects/:projectKey/mcp`,
  `PUT/DELETE /v1/daemon/settings/project-folders/:projectKey`).
- `apps/web/src/routes/system-settings.tsx` → trang "Cài đặt hệ thống" — `/settings/prompts`, `/settings/rules`,
  `/settings/models`, `/settings/machines`, `/settings/projects`.

## Các bước

1. `packages/shared/src/settings-schemas.ts`: một cài đặt (`SettingsKey`) là `(kind, scope, machineId,
   projectId, name)`. Bảy `kind` của flow này: `prompt` (`scope: global`, theo `name` — một trong
   `PROMPT_CATALOG`, gồm 9 prompt theo vai trò cộng 2 partial `_shared-rules`/`_capability-preflight`),
   `policy` (`scope: global` — `GuardPolicy`: `docsPaths`, `protectedPaths`, `docsUpdateWritePaths`,
   `qcUiTestOnlyForNonDocs`), `models` (`scope: global` hoặc `machine` — `ModelSettings.allow` luôn phải chứa
   `sonnet`, mọi model của `complexityMap` phải nằm trong `allow`), `budgets` (`scope: global` hoặc `machine`
   — `perJobUsd`, ngân sách cây/ngày của project vẫn sống ở `projects`, không đổi), `resources` (`scope:
   machine` — số job chạy cùng lúc, RAM trống tối thiểu, tải tối đa mỗi CPU), `project_mcp` (`scope: project` —
   `disabledMcpServers`), `project_folders` (`scope: machine` — `ProjectFolders`: mỗi project một
   `{key, repoPath, sharedPaths}`; `repoPath` là `AbsoluteFolderPath` — tuyệt đối, không đoạn `..`, không ký tự
   điều khiển — và `sharedPaths` là `RepoRelativePath` — nằm trong repo, không thoát ra ngoài; lệnh test không
   nằm ở đây vì nó chạy như shell command trên máy, xem Mục đích). `KIND_SCOPES` khoá phạm vi hợp lệ mỗi kind.
   `PathGlob`/`matchPathGlob()`/`matchesAnyGlob()`: mẫu đường dẫn tương đối gốc
   repo (`*` trong một thư mục, `**` mọi thư mục con, `dir/**` gồm cả `dir`, không phân biệt hoa thường, không
   được thoát ra ngoài repo). `PROMPT_VARIABLES`/`PROMPT_PARTIAL_PATTERN`/`PROMPT_VARIABLE_PATTERN`/
   `validatePromptTemplate()`: một prompt không hợp lệ khi rỗng, quá `PROMPT_MAX_CHARS`, dùng biến không có
   trong danh sách, chèn phần chung không tồn tại, hoặc một phần chung (`_`-prefix) lại chèn phần chung khác
   (chỉ một lớp). `PROMPT_VARIABLES` có hai biến của phương án kiểm thử QC (flow `agent-roles`): `test_plan`
   (mục 4 bước 3 của `qc.md`) và `test_kinds` (bảng loại ↔ công cụ trong `pm-analyze.md`/`pm-monitor.md`); biến
   `ui_test` cũ vẫn còn trong danh sách nên một template ghi đè trên web viết trước khi có phương án kiểm thử
   vẫn qua được `validatePromptTemplate()`. `validateSettingsContent(kind, name, content)`/`SETTINGS_CONTENT`: validate theo schema đúng
   kind rồi (riêng `prompt`) chạy thêm `validatePromptTemplate()`. `DEFAULT_GUARD_POLICY`/
   `DEFAULT_MODEL_SETTINGS`/`DEFAULT_RESOURCE_SETTINGS`/`DEFAULT_BUDGET_SETTINGS`: giá trị daemon dùng khi
   chưa có bản ghi đè nào (chính là luật crew-docs R6 cho `protectedPaths` và bảng model mặc định cũ). `settingsText()`
   (prompt hiện nguyên văn, còn lại JSON thụt lề) và `lineDiff()` (LCS, dữ liệu quá lớn thì coi là xoá hết/thêm
   hết) phục vụ khung diff dùng chung của web.
2. `apps/api/drizzle/0008_server_settings_and_machine_commands.sql` (phần liên quan tới flow này): bảng
   `settings_revisions` (`kind`, `scope`, `machine_id`,
   `project_id`, `name`, `version`, `content` jsonb nullable, `note`, `author`, `restored_from`, `created_at`)
   — unique `(kind, scope, machine_id, project_id, name, version)`, check ràng buộc `machine_id`/`project_id`
   khớp đúng `scope`. Cột mới `machines.settings_state` (jsonb) lưu `MachineSettingsState` do heartbeat báo.
3. `apps/api/src/services/settings-service.ts` → `saveRevision()`: khoá advisory theo key
   (`pg_advisory_xact_lock`) rồi validate nội dung (`contentErrors()`), kiểm `baseVersion` bằng version hiện
   hành (409 `CONFLICT` khi lệch — cài đặt vừa bị sửa ở nơi khác), insert version kế tiếp, rồi phát
   `settings.changed` cho owner stream cộng mọi máy bị ảnh hưởng (`affectedMachines()`: một máy cho `scope:
   machine`, máy sở hữu project cho `scope: project`, mọi máy còn sống cho `scope: global`).
   `restoreRevision()` lưu lại nội dung một bản cũ như một bản mới (không sửa lịch sử). `content: null` xoá
   ghi đè (giá trị global hoặc mặc định áp dụng lại). `diffRevisions()` so hai bản cùng key bằng `lineDiff()`.
   `settingsOverview()` (`GET /v1/settings`) trả `PROMPT_CATALOG` kèm `defaultText` đọc trực tiếp từ
   `apps/daemon/src/roles/prompts/<name>.md` (`bundledPrompt()`, đường dẫn tương đối cố định `dist/services` →
   nguồn daemon — image API phải có sẵn cây đó, xem bước 9), mọi giá trị mặc định (`policy`/`models`/`budgets`/
   `resources`) và bản đang dùng của mọi key (`listActive()`, `selectDistinctOn` theo version giảm dần).
4. `apps/api/src/services/settings-service.ts` → `effectiveSettings(db, machineId)`: gộp bản đang dùng của
   mỗi kind cho một máy — `prompts` là mọi bản `prompt` đang dùng, `policy` là bản `global`, `models`/`budgets`
   là bản `machine` (nếu có) hoặc bản `global`, `resources` chỉ máy mới có, `projects` là `project_mcp` của
   mọi project máy đó sở hữu, `folders` là bản `project_folders` của máy (`null` khi máy chưa từng lưu thư mục
   nào) — mỗi entry được ghép thêm `defaultBranch` đọc từ bảng `projects` (`EffectiveProjectFolders`), vì
   nhánh mặc định là quyết định của project, không phải của máy. `revisionOf()`: hash SHA-256 (16 ký tự đầu)
   của nội dung đã sắp xếp khoá ổn định — hai máy có cùng cấu hình hiệu lực luôn ra cùng revision, không phụ
   thuộc lịch sử bản ghi. `expectedRevisions(db, machineIds)` tính revision mỗi máy *sẽ* nhận nếu hỏi ngay bây
   giờ, để so với revision máy *đã báo* qua heartbeat (`Machine.settings.current`).
5. `apps/api/src/routes/settings-routes.ts` → `daemonSettingsRoutes`: `GET /v1/daemon/settings` trả
   `EffectiveSettings` kèm header `ETag`/kiểm `If-None-Match` — không đổi trả 304 rỗng, đỡ băng thông cho lần
   hỏi lại mỗi giờ. `POST /v1/daemon/settings/import` (`importLocalSettings()`): tải một lần giá trị
   `config.yaml` cục bộ của máy (resources/models/budgets/MCP tắt từng project) lên làm bản ghi đè máy/project
   đó — **chỉ khi setting đó chưa có bản nào trên server** (không đè cái owner đã sửa trên web); mỗi giá trị
   tải lên khoá advisory riêng như `saveRevision()` — kể cả thư mục project (`folders`, xem bước 3), cũng chỉ
   ghi nơi máy chưa từng lưu. `PUT /v1/daemon/settings/projects/:projectKey/mcp` (`putProjectMcpFromMachine()`):
   máy sở hữu project tự đổi MCP tắt (dùng bởi nút sửa nhanh trên dashboard sức khỏe, flow `daemon-health`, và
   công tắc MCP của app desktop, flow `desktop-app`) — không phải máy sở hữu thì `FORBIDDEN`.
   `PUT/DELETE /v1/daemon/settings/project-folders/:projectKey` (`putProjectFolderFromMachine()`): máy tự đặt
   hoặc xoá thư mục của đúng một project trong bản `project_folders` của mình, giữ nguyên thư mục các project
   khác trong cùng bản đó (đọc bản đang dùng, sửa đúng một entry theo key, `saveRevision()` lại cả danh sách)
   — dùng bởi `crewd project add|release` và bộ chọn thư mục của app desktop (flow `desktop-app`/`desktop-ui`).
6. `apps/daemon/src/settings/settings-store.ts` → `SettingsStore.refresh()`/`fetch()`: gọi
   `GET /v1/daemon/settings` (ETag của bản đang giữ), lưu cache `~/.crew/settings-cache.json` (0600, ghi
   atomic) sau mỗi lần lấy được; server không tới được thì giữ bản cache (hay mặc định đóng gói nếu chưa từng
   có cache) và chỉ log warn, không chặn job. Một lời gọi `refresh()` tới trong lúc lượt trước còn đang chạy
   không mở thêm request: nó dùng lại promise đang chạy rồi được thêm một lượt `fetch()` nữa ngay sau lượt đó
   (cờ `again`, chia sẻ cho mọi người gọi chồng — một thay đổi có thể vừa tới ngay sau request đầu). `activateSettings()`
   validate lại **từng phần** bằng đúng schema `@crew/shared` — một phần sai (bản server mới hơn daemon, hoặc
   một sửa lỗi lọt qua) chỉ phần đó bị từ chối (liệt vào `rejected`, ví dụ `prompt:dev`, `policy`) và dùng mặc
   định đóng gói, không hỏng cả cài đặt. `effectiveConfig(local, settings, imported, folderOk)`: cấu hình job
   thật sự chạy — local (API URL, đường dẫn dùng chung: luôn máy-riêng) với cài đặt server chồng lên; danh
   sách project của server (`settings.folders`, nếu máy đã từng lưu gì) thay hẳn danh sách cục bộ, mỗi entry
   ghép `defaultBranch` từ server, `testCommand` (chỉ có ở local, xem Mục đích) và `disabledMcpServers` từ
   cài đặt cục bộ/`project_mcp`; một entry mà `folderOk()` báo không dùng được (đối số của `daemon.ts`, xem
   bước dưới) bị lọc khỏi danh sách — job của project đó chờ (`no_local_folder`) thay vì chạy với thư mục sai.
   **Trước khi** máy đó tải lên thành công lần đầu (`settingsImportedKey()`, đánh dấu trong `meta`), phần
   server chưa có (kể cả `folders`) rơi về giá trị `config.yaml` cục bộ (server không sẵn không làm lơi giới
   hạn máy tự đặt); sau khi tải lên, phần chưa có rơi về mặc định đóng gói (`folders`: giữ danh sách cục bộ,
   vì server luôn có ít nhất thư mục vừa tải lên). `localSettingsUpload()` dựng payload tải lên một lần đó
   (gồm `folders`), bỏ bảng model cục bộ nếu nó không hợp lệ theo schema mới. `loadEffectiveConfig()` dùng
   ngoài một daemon đang chạy (`crewd doctor`, app desktop khi daemon dừng): hỏi server một lần rồi trả
   `effectiveConfig()` (không kiểm `folderOk`, vì không probe thư mục ngoài daemon đang chạy).
   `projectFolderProblem(path)`: vì sao máy không dùng được một thư mục server đưa xuống, hoặc `null` — phải
   tồn tại, đọc được và là gốc của repo git; lần đọc đầu tiên (`readdir`) chạy bất đồng bộ để một hộp thoại
   quyền macOS còn treo (flow `desktop-app`) rơi vào worker thread, không chặn event loop daemon.
7. `apps/daemon/src/daemon.ts` → `createDaemon()`: dựng `SettingsStore` cạnh `VpsClient`; giữ một
   `folderStatus: Map<projectKey, {repoPath, error}>` — `checkFolders()` chạy `projectFolderProblem()` (bước 6)
   cho mỗi thư mục server đưa xuống mà máy chưa biết chắc dùng được (hoặc đường dẫn đã đổi), gọi lại sau mỗi
   `refreshSettings()`/`importLocalSettings()`; `folderOk(entry)` (đối số của `effectiveConfig()`) đọc lại
   map này. `settingsState()` (nội dung `settings` của heartbeat) nối thêm mỗi thư mục không dùng được vào
   `rejected` dưới dạng `project_folder:<KEY>: <lý do>` (tối đa 200 ký tự mỗi dòng, cả danh sách tối đa 100
   dòng) — cùng danh sách `rejected` của phần cài đặt sai schema (bước 6), owner đọc được ở trang "Cài đặt máy"
   (bước 11). `refreshSettings()` gọi `SettingsStore.refresh()`, áp lại `effectiveConfig()` (`applyConfig()`,
   re-probe inventory của project nào MCP tắt vừa đổi) và `reportSoon()` khi có gì đổi, rồi gọi
   `importLocalSettings()` (chỉ thật sự tải lên nếu chưa từng thành công, gọi `checkFolders()` lại sau khi
   tải xong). Daemon gọi `refreshSettings()` lúc `start()` (trước khi job đầu tiên chạy), khi
   nhận sự kiện `settings.changed` (effect `refresh_settings` của dispatcher, flow `daemon-scheduling`), khi
   stream kết nối lại (có thể đã lỡ một thay đổi lúc mất kết nối), khi project đổi chủ (MCP đi theo project),
   và mỗi giờ (`timings.settingsMs`, an toàn khi lỡ mọi kênh trên). `Daemon.settings()`/`effectiveConfig()`
   lộ trạng thái hiện tại cho CLI/app desktop; `setProjectMcp(projectKey, disabled, note)` gọi
   `VpsClient.putProjectMcp()` rồi `refreshSettings()` ngay để tự áp cho job kế tiếp. Mỗi job snapshot cài đặt
   lúc bắt đầu (`JobRunner.execute()`, flow `agent-runs`) và giữ nguyên tới hết lượt chạy dù server đổi giữa
   đường; `jobs.settings_revision` (cột SQLite mới, flow `daemon-runtime`) ghi lại bản đó cho bình luận lỗi
   ("... (cài đặt bản `<rev>`)") và cho heartbeat. Heartbeat gửi `MachineSettingsState` (`revision`, `source`:
   `server`/`cache`/`bundled`, `rejected[]`) mỗi lượt; job đang `running`/`waiting` mang theo `settingsRevision`
   của chính nó.
8. `apps/daemon/src/roles/prompt-templates.ts` → `renderPrompt(name, vars, overrides)`: `overrides` (cài đặt
   `prompts` của máy) thay bản đóng gói theo tên trước khi ghép `{{> partial}}`/`{{var}}` — daemon vẫn đọc file
   `.md` đóng gói làm mặc định và cache; một prompt được sửa trên web chỉ đổi từ job kế tiếp, không đụng
   session agent đang chạy. `apps/daemon/src/runner/guard-hook.ts` → `isProtectedPath()`/`isDocsPath()` và
   `apps/daemon/src/roles/role-planner.ts`/`docs-first-check.ts` đọc `GuardPolicy` từ cài đặt của job
   (`ctx.settings.policy`, mặc định `DEFAULT_GUARD_POLICY` khi thiếu) thay vì hằng số cố định — cổng QC
   (`qcUiTestOnlyForNonDocs`) và danh sách docs/protected đều theo cài đặt này; riêng cổng pre-push của
   `apps/daemon/src/roles/merge-policy.ts` (flow `local-merge`) cố ý **không** đọc cài đặt này, vẫn dùng đúng
   danh sách R6 đóng gói với crew-docs, vì cổng đó bảo vệ chính cơ chế duyệt/hook của crew-docs, không phải
   quy tắc nghiệp vụ có thể tuỳ máy.
9. `deploy/Dockerfile`/`.dockerignore`: image API chép thêm `apps/daemon/src/roles/prompts` (giữ đúng vị trí
   tương đối `../../../daemon/src/roles/prompts/` mà `bundledPrompt()` ở bước 3 tính từ `dist/services`), và
   `.dockerignore` mở lại đúng thư mục đó dưới quy tắc loại `apps/daemon` khỏi build context — nếu không, API
   trên VPS không có bản mặc định để hiện/so sánh trên trang Prompts (daemon cục bộ vẫn luôn có, vì nó đóng gói
   cùng bundle).
10. `apps/web/src/routes/system-settings.tsx`, `settings-prompt.tsx`, `settings-machine.tsx`,
    `settings-project-mcp.tsx`: sidebar "Cài đặt hệ thống" (`SlidersHorizontal`, flow `web-shell`) dẫn 5 tab —
    Prompts (danh sách 9 prompt, mở từng cái ở `/settings/prompts/$name`: `MarkdownEditor` có preview, hộp trợ
    giúp biến/phần chung, so sánh với bản đang dùng hoặc bản mặc định), Quy tắc (ba ô textarea mỗi dòng một
    glob cộng checkbox `qcUiTestOnlyForNonDocs` — nhãn "Với QC mà PM đã chọn kiểm thử UI, cờ này chỉ bắt buộc
    chạy khi thay đổi đụng file ngoài đường dẫn docs": cờ không còn áp dụng cho mọi QC, chỉ QC mà PM đã chọn
    `testKinds` chứa kiểm thử UI, xem flow `web-tickets`), Models (bảng model + ngân sách mỗi lượt chạy chung
    cho mọi máy), Máy (`/settings/machines/$machineId`: tài nguyên, bảng model/ngân sách riêng máy đó hoặc dùng
    chung), MCP dự án (`/settings/projects/$projectKey`: công tắc MCP server máy sở hữu đã báo cáo, server QC
    của loại dự án được đánh dấu kèm nhãn "QC dùng server này khi PM chọn kiểm thử UI cho loại dự án này" —
    không còn khẳng định mọi QC bắt buộc dùng, tuỳ PM có chọn kiểm thử UI (`testKinds` chứa `ui_web`/`ui_mobile`)
    cho ticket đó hay không, thêm server theo tên khi máy chưa báo cáo nó). Tab Máy có thêm mục "Thư mục dự án"
    (`MachineFolders`): một dòng mỗi project máy đang giữ (đường dẫn tuyệt đối trên máy, danh sách thư mục dùng
    chung mỗi dòng một đường dẫn) — dòng nào máy báo không dùng được (đọc `machine.settings.reported.rejected`,
    tách tiền tố `project_folder:`) hiện lý do ngay tại chỗ; lưu ghi cả danh sách project của máy đó thành một
    bản `project_folders` mới, giống mọi trang cài đặt khác. `apps/web/src/components/setting-editor.tsx`
    → `SettingEditor`: khung dùng chung mọi trang trên — hiện bản đang dùng (version/tác giả/giờ/ghi chú), ô
    ghi chú thay đổi, nút Lưu (`POST /v1/settings` với `baseVersion` của bản đang mở — lệch thì báo lỗi 409 rõ
    ràng, không âm thầm đè), nút bỏ ghi đè (`content: null`, có xác nhận), `PickupStatus` (máy nào đã nhận bản
    vừa lưu — so `machine.settings.current`, tự poll 3 giây tới khi mọi máy nhận xong), và `SettingHistory`
    (mọi bản, khác biệt với bản trước, khôi phục một bản cũ). `apps/web/src/components/model-settings-form.tsx`
    → `ModelSettingsForm`/`BudgetSettingsForm`/`ResourceSettingsForm`/`issuesOf()`: form dùng chung cho cả
    trang Models (chung) và trang Máy (riêng máy, có lựa chọn "Dùng bảng/ngân sách chung" hay "Riêng máy này").
11. Nơi khác đọc cùng dữ liệu này: `apps/web/src/routes/machines.tsx` (flow `web-admin`) hiện
    `SettingsPickup` (bản cài đặt máy đang dùng, đã nhận mới nhất chưa) và link "Cài đặt máy";
    `apps/web/src/routes/project-settings.tsx` (flow `web-admin`) hiện MCP tắt của project và link "Sửa MCP";
    `apps/web/src/components/agent-activity.tsx` (flow `web-tickets`) thêm "· cài đặt `<rev>`" vào dòng ticket
    đang chạy; `apps/web/src/lib/live-events.ts` (flow `event-delivery`) làm mới các trang trên khi nhận
    `settings.changed`/`machine.settings_applied`. `apps/daemon/src/cli.ts` → `project(add|create|release)`
    ghi thư mục qua `VpsClient.putProjectFolder()`/`deleteProjectFolder()` (cùng route của bước 5) ngay khi
    thêm hoặc trả project, cạnh việc ghi `config.yaml` cục bộ — thư mục luôn có trên server dù chủ dự án
    dùng CLI hay web/app desktop để đặt nó.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/api/src/routes/settings-routes.ts` | Route owner + daemon của cài đặt server | `settingsRoutes`, `daemonSettingsRoutes` |
| `apps/api/src/services/settings-service.ts` | Lưu bản, gộp hiệu lực, import, MCP/thư mục máy sở hữu | `saveRevision`, `restoreRevision`, `diffRevisions`, `settingsOverview`, `effectiveSettings`, `expectedRevisions`, `importLocalSettings`, `putProjectMcpFromMachine`, `putProjectFolderFromMachine`, `bundledPrompt` |
| `packages/shared/src/settings-schemas.ts` | Schema mọi kind, glob đường dẫn, validate prompt, diff | `SettingsKind`, `SettingsKey`, `GuardPolicy`, `ModelSettings`, `ResourceSettings`, `BudgetSettings`, `ProjectMcpSettings`, `ProjectFolderEntry`, `ProjectFolders`, `EffectiveProjectFolders`, `AbsoluteFolderPath`, `RepoRelativePath`, `EffectiveSettings`, `MachineSettingsState`, `validatePromptTemplate`, `validateSettingsContent`, `matchPathGlob`, `lineDiff`, `settingsText` |
| `apps/daemon/src/settings/settings-store.ts` | Lấy, cache, validate lại, gộp cấu hình hiệu lực, kiểm thư mục | `SettingsStore`, `activateSettings`, `effectiveConfig`, `localSettingsUpload`, `loadEffectiveConfig`, `projectFolderProblem`, `ActiveSettings`, `BUNDLED_SETTINGS` |
| `apps/web/src/routes/settings-prompt.tsx` | Trang sửa một prompt | `SettingsPromptPage` |
| `apps/web/src/routes/settings-machine.tsx` | Trang cài đặt riêng một máy | `SettingsMachinePage` |
| `apps/web/src/routes/settings-project-mcp.tsx` | Trang công tắc MCP một dự án | `SettingsProjectMcpPage`, `projectMcpKey` |
| `apps/web/src/components/setting-editor.tsx` | Khung sửa/lưu/lịch sử dùng chung mọi trang cài đặt | `SettingEditor`, `SettingHistory`, `PickupStatus`, `DiffView`, `activeOf`, `authorLabel` |
| `apps/web/src/components/model-settings-form.tsx` | Form model/ngân sách/tài nguyên dùng chung | `ModelSettingsForm`, `BudgetSettingsForm`, `ResourceSettingsForm`, `issuesOf` |

## Dữ liệu

- Bảng: `settings_revisions` (sở hữu bởi flow này; migration
  `apps/api/drizzle/0008_server_settings_and_machine_commands.sql`, flow `api-platform` sở hữu việc migrate —
  cùng migration này còn có bảng `machine_commands` của flow `machine-control`, ngoài phạm vi flow này); cột `machines.settings_state` (jsonb, `MachineSettingsState` mới
  nhất theo heartbeat, ghi bởi `recordHeartbeat()` flow `machine-pairing`); cột `jobs.settings_revision` trên
  máy (`~/.crew/state.db`, flow `daemon-runtime`).
- File cục bộ trên máy: `~/.crew/settings-cache.json` (0600, bản server tốt gần nhất, dùng khi server không
  tới được).
- Sự kiện: `settings.changed` (owner stream cộng mọi máy bị ảnh hưởng, phát khi lưu/khôi phục một bản, flow
  `event-delivery` định nghĩa và phát qua `appendEvents()`) → daemon `refresh_settings` (flow
  `daemon-scheduling`); `machine.settings_applied` (owner stream, phát khi heartbeat báo một revision mới —
  `recordHeartbeat()`, flow `machine-pairing`).
- Gọi ngoài: daemon gọi `GET/POST/PUT/DELETE /v1/daemon/settings*` qua `VpsClient` (flow `daemon-runtime`);
  web gọi `/v1/settings*` qua `lib/api-client.ts` (flow `web-shell`).

## Flow liên quan

- api-platform: migration `0008_server_settings_and_machine_commands.sql` migrate ở đây;
  `settingsRoutes`/`daemonSettingsRoutes`
  đăng ký vào nhóm route owner/daemon của `buildApp()`.
- event-delivery: `settings.changed`/`machine.settings_applied` định nghĩa ở `event-schemas.ts`, phát qua
  cùng outbox `events`; `apps/web/src/lib/live-events.ts` map hai sự kiện này sang invalidate `keys.settings`/
  `keys.machines`.
- machine-pairing: heartbeat (`recordHeartbeat()`) ghi `machines.settings_state` và phát
  `machine.settings_applied`; `Machine.settings` (`reported`/`expectedRevision`/`current`) đọc lại nó cùng
  `expectedRevisions()` ở đây.
- daemon-runtime: `SettingsStore` được dựng và điều khiển trong `createDaemon()`; `VpsClient` (flow đó) có
  `settings()`/`importSettings()`/`putProjectMcp()`; cột `jobs.settings_revision` sống trong `state-db.ts`.
- agent-runs: `JobRunner` snapshot `ActiveSettings` một lần lúc `execute()`, ghi vào job và dùng cho cả lượt
  chạy; bình luận crash/lỗi nêu kèm bản cài đặt.
- agent-roles: `renderPrompt()` nhận `overrides` từ cài đặt; `qcNeedsUiTest()`/`docsFirst()`/guard đọc
  `GuardPolicy` của cài đặt job thay hằng số cố định.
- local-merge: cổng pre-push cố ý dùng danh sách R6 đóng gói, không đọc `GuardPolicy` có thể sửa trên web.
- daemon-health: fix `mcp-disable`/`mcp-enable` của dashboard sức khỏe ghi một bản `project_mcp` mới (qua
  daemon đang chạy hoặc thẳng tới server); check `mcp` vẫn đọc kho đã dò, không đọc cài đặt trực tiếp.
- desktop-app, desktop-ui: ghép máy lần đầu lưu tài nguyên gợi ý theo CPU/RAM cục bộ, daemon tải lên server
  đúng một lần; bộ chọn thư mục ở trang "Trạng thái máy" (`projects.setFolder`) ghi qua
  `PUT /v1/daemon/settings/project-folders/:projectKey` — cùng cài đặt trang "Cài đặt máy" trên web sửa; mọi
  cài đặt khác (tài nguyên, model, MCP, prompt, quy tắc) chỉ sửa được trên web, app chỉ link tới đó.
- machine-control: fix sức khỏe `adjust-limits`/`repick-folder` không chạy như một lệnh từ xa mà dẫn owner tới
  trang "Cài đặt máy" của flow này để tự sửa.
- web-tickets, web-admin, web-shell: nơi khác trên web đọc/liên kết tới cài đặt này (xem bước 11).

## Tests

- `apps/api/test/settings.test.ts`: liệt kê prompt/biến/mặc định; lưu bản có tác giả/ghi chú, từ chối
  `baseVersion` cũ (409); validate theo schema đúng kind; diff hai bản và khôi phục thành bản mới; chỉ báo
  owner và máy bị ảnh hưởng qua sự kiện; `Machine.settings` phản ánh đúng máy đã nhận bản nào; gộp
  global←machine kèm ETag; một máy chỉ nhận MCP của project nó sở hữu; import một lần chỉ ghi nơi server chưa
  có (kể cả thư mục); máy sở hữu (không máy khác) đổi được MCP của project mình; giữ thư mục project theo
  từng máy kèm nhánh mặc định đọc từ project, chỉ owner và máy đó sửa được, máy tự đặt một project và giữ
  nguyên các project khác qua `PUT/DELETE /v1/daemon/settings/project-folders/:projectKey`; route owner và
  route daemon tách biệt.
- `apps/daemon/test/settings.test.ts`: giữ phần hợp lệ, thay phần sai bằng mặc định đóng gói; render prompt
  ghi đè đúng, gồm cả phần chung; cấu hình hiệu lực đặt giá trị server lên trên cục bộ; giữ giá trị cục bộ tới
  khi import lần đầu xong, sau đó mới rơi về mặc định đóng gói; tải lên resources, ngân sách đã đổi, MCP tắt
  và thư mục project, không tải model chưa đổi; cache dùng khi server sập, trả lời đúng 304 từ cache; không
  cache thì dùng mặc định đóng gói, cache hỏng bị bỏ qua; tải lên một lần rồi chạy job kế tiếp với một prompt
  vừa sửa trên web; dùng được thư mục server đặt ngay khi máy đọc được nó, báo đúng lý do
  (`project_folder:<KEY>: …`) khi không đọc được hoặc không phải gốc repo qua heartbeat, rồi hết báo khi thư
  mục mới hợp lệ; bộ chọn thư mục của app ghi qua đúng route, giữ nguyên thư mục project khác.
- `packages/shared/src/settings-schemas.test.ts`: glob khớp đúng docs/Markdown gốc như luật có sẵn, `dir/**`
  gồm cả `dir`, `**` giữa chuỗi, `*`/`?` trong một đoạn, escape ký tự regexp, chỉ nhận glob tương đối an toàn;
  quy tắc guard nhận bản đóng gói, từ chối field lạ; prompt nhận đúng biến/phần chung đã biết (kể cả hai biến
  mới `test_plan`/`test_kinds` của `qc`/`pm-analyze` đứng cạnh `{{ui_test}}` cũ), từ chối biến/
  phần chung lạ, phần chung lồng nhau, rỗng; liệt kê đúng mỗi prompt một lần; giữ `sonnet` luôn được phép,
  không bao giờ nhận `fable`; validate số trong khoảng và biến prompt; kiểm phạm vi từng kind và id nó cần;
  diff giữ/xoá/thêm đúng dòng; hiện prompt bằng text, cài đặt khác bằng JSON.
- `apps/web/src/routes/system-settings.test.tsx`: trang prompt khởi động từ bản đóng gói, từ chối biến lạ;
  lưu kèm ghi chú trên đúng version đang mở rồi hiện máy đã nhận; khôi phục một bản cũ từ lịch sử; trang quy
  tắc hiện đúng dòng đường dẫn không an toàn và lưu được quy tắc hợp lệ; trang máy lưu được tài nguyên và một
  bảng model riêng máy; sửa thư mục từng project máy đang giữ, từ chối đường dẫn tương đối tại chỗ, và hiện
  đúng lý do máy báo không dùng được một thư mục.
- `apps/web/e2e/system-settings.spec.ts`: sửa một prompt trên web rồi một daemon kịch bản đang chạy nhận và
  render đúng bản mới ở job kế tiếp.
- Quy tắc guard đọc từ cài đặt server còn được kiểm ở `apps/daemon/test/guard-hook.test.ts` (flow `agent-runs`)
  và `apps/daemon/test/role-policies.test.ts` (flow `agent-roles`, nơi hai test này sống); fix MCP của dashboard
  sức khỏe viết cài đặt server còn được kiểm ở `apps/daemon/test/health-groups.test.ts` (flow `daemon-health`).
