# Giao diện app desktop (cài đặt, sức khỏe, job, project)

> Flow `desktop-ui`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow desktop-ui` in ra
> đúng danh sách đó.

## Mục đích

Renderer React của app 2P Crew: trình cài đặt lần đầu, bảng sức khỏe, danh sách job, nhật ký daemon, cài đặt
chung và quản lý project của máy này. Renderer chạy sandbox, không có Node, chỉ nói chuyện với daemon qua cầu
`invoke`/`on` mà `desktop-app` (flow `desktop-app`) lộ ra; mọi hành vi thật (chạy check, gọi VPS, đọc/ghi
`~/.crew`) đều thuộc flow đó.

## Điểm vào

- `apps/desktop/src/renderer/main.tsx` — gắn `<App />` vào `#root`.
- `apps/desktop/src/renderer/app.tsx` → `App()` — định tuyến bằng hash (`#/route?section=&project=`), khung
  điều hướng (sidebar), badge trạng thái daemon.

## Các bước

1. `apps/desktop/src/renderer/index.html`: Content-Security-Policy chặt (`default-src 'none'`, `script-src
   'self'`, không `connect-src` ra mạng ngoài); `webPreferences` của cửa sổ chứa nó đã bật `sandbox` và
   `contextIsolation` (flow `desktop-app`), nên renderer không có API Node hay mạng ngoài IPC.
2. `apps/desktop/src/renderer/lib/ipc.ts` → `invoke()`, `useDesktopEvent()`, `reportRendererErrors()`: gọi
   `window.crew.invoke(method, input)` (từ preload) và ném lỗi bằng đúng message tiếng Việt main/daemon trả
   về; hook subscribe một sự kiện `DesktopEvents` cho vòng đời của component; `reportRendererErrors()` (gọi
   một lần từ `main.tsx` trước khi gắn `<App />`, nên lỗi render sớm nhất cũng được ghi) bắt lỗi chưa bắt và
   promise bị reject của `window`, cắt ngắn message/stack rồi gửi qua `app.reportError` (flow `desktop-app`)
   để vào `~/.crew/logs/app.log` — không đọc được input gây lỗi.
3. `apps/desktop/src/renderer/app.tsx` → `parseHash()`/`toHash()`: route, section (bước wizard hay mục cài
   đặt cần mở) và `projectKey` mã hoá hai chiều trong hash URL, nên một điều hướng từ fix sức khỏe
   (`app.navigate`) hoặc bấm lại vẫn giữ đúng vị trí.
4. `apps/desktop/src/renderer/routes/setup-wizard.tsx` → `SetupWizard()`: 7 bước theo `WIZARD_STEPS`
   (`apps/desktop/src/renderer/components/wizard-step.tsx`) — Server (`setup.checkServer`, bắt buộc
   `/v1/health` trả lời đúng cả kết nối, TLS và hợp đồng API v1), Ghép máy (`setup.pair`), Claude
   (`setup.checkClaude` + nút "Đăng nhập Claude" mở Terminal qua `setup.openClaudeLogin` + "Kiểm tra lại"),
   Project và thư mục, Docs và hook (tự cài hook còn thiếu/cũ qua `hooks.install`, hiện trạng thái docs mỗi
   project), Tài nguyên và model (bắt buộc `sonnet`), Hoàn tất (`setup.finish`: bật mở cùng máy, khởi động
   daemon). Mỗi bước tự nạp/kiểm lại dữ liệu khi mở và chặn "Tiếp" tới khi hợp lệ. Bước Project và thư mục:
   nút "Lưu và nhận project" trước tiên tạo project đang nháp ở khung `NewProjectForm` (nếu có, qua handle
   `hasDraft()`/`submit()`) rồi mới `projects.apply` phần project đã tick — một thư mục đã điền ở khung "Thêm
   project mới từ thư mục" không còn bị bỏ quên nếu chủ dự án bấm nhầm nút của bước; "Tiếp" bị khoá
   (`draftPending`, cập nhật qua `onDraftChange`) và có `Notice` cảnh báo khi khung đó còn nháp chưa tạo; mỗi
   dòng hook hiện thêm `hook.detail` (lý do hook chưa chạy hoặc bản đang chạy, flow `daemon-health`) khi chưa
   "Đã cài hook".
5. `apps/desktop/src/renderer/components/project-picker.tsx` → `ProjectPicker()`, `ownershipLabel()`: mỗi
   project trên server kèm nhãn sở hữu — "của máy này", "chưa có máy", "đang thuộc máy X" hoặc "Đang chờ
   duyệt trên web"; tick một project mở `FolderPicker` rồi validate thư mục ngay (`folder.validate`, dùng lại
   `repoFolderChecks` của flow `daemon-health` qua host) — git hợp lệ, đúng `origin`, đúng nhánh, quyền push,
   working tree. `onChange(update, byOwner)`: `byOwner` là `false` khi chính component tự validate lại thư
   mục đã lưu từ trước (mở lại bước) — chỉ chủ dự án tick/bỏ tick hay đổi thư mục (`byOwner: true`) mới đặt
   lại "Tiếp" về chưa áp dụng, nên lượt tự kiểm tra lại đó không âm thầm bắt bấm "Lưu và nhận project" lần
   nữa.
6. `apps/desktop/src/renderer/components/new-project-form.tsx` → `NewProjectForm()`, `NewProjectFormHandle`,
   `draftProblem()`: "Thêm project mới từ thư mục" — chọn thư mục điền sẵn key/tên/repo URL/nhánh từ `origin`
   (`folder.inspect`), chủ project tự gõ mô tả (trợ lý dùng mô tả này để định tuyến ticket, không đọc từ
   repo), rồi `projects.create`. `draftProblem()` nêu đúng phần còn thiếu (key/tên/repo URL/mô tả) bằng lời
   thay vì chỉ khoá nút im lặng; một key gõ sai độ dài hay sai định dạng không bị tính là "còn thiếu" mà có
   câu riêng ("Key dài N ký tự, tối đa 10." hoặc "Key phải có 2–10 chữ in hoa hoặc số, bắt đầu bằng chữ."), vì
   khung đã tự viết hoa và cắt khoảng trắng của key nên chỉ key rỗng mới tính là thiếu; component lộ một handle
   (`hasDraft()`, `submit()` qua `ref`) và gọi `onDraftChange(pending)` mỗi khi còn nháp chưa tạo hoặc ẩn form,
   để `SetupWizard()` (bước 4) gọi được `submit()` từ nút của bước.
7. `apps/desktop/src/renderer/routes/health.tsx` → `HealthPage()`, `navigationFor()`: bảng sức khỏe nhóm theo
   `HealthGroup`, tự chạy khi mở trang và khi có `health.report` mới; một fix hoặc gọi `health.fix` tại chỗ,
   hoặc điều hướng sang trang khác — `repair` → bước Ghép máy, `repick-folder:KEY` → Settings → Projects đúng
   project, `adjust-limits` → Cài đặt mục tài nguyên, `api-key-help` → mở hộp hướng dẫn gỡ
   `ANTHROPIC_API_KEY` tại chỗ (không điều hướng).
8. `apps/desktop/src/renderer/routes/jobs.tsx` → `JobsPage()`: job đang chạy/chờ/chờ thử lại của máy này,
   cập nhật realtime qua sự kiện `jobs.changed`; mỗi dòng có nút "Mở trên web" tới đúng ticket.
9. `apps/desktop/src/renderer/routes/logs.tsx` → `LogsPage()`, `matchesTicket()`: tail nhật ký daemon (tối đa
   500 dòng, lọc theo ticket qua `logs.tail` rồi khớp tiếp các dòng realtime của `log.line`).
10. `apps/desktop/src/renderer/routes/settings.tsx` → `SettingsPage()`: bật/tắt mở cùng máy, kiểm và cài bản
    mới (`app.checkUpdate`/`app.installUpdate`, chữ cho `state: 'unpublished'` là "Chưa có bản phát hành nào;
    đang dùng bản hiện tại." — không phải lỗi), nút "Chạy lại trình cài đặt", "Project của máy này" và "Mở
    thư mục log" (`app.openLogFolder`, mở `~/.crew/logs` — ghi chú `app.log`/`daemon.log` chứa gì, không chứa
    token/mật khẩu/mã ghép), và cùng form tài nguyên/model của bước cuối trình cài đặt.
11. `apps/desktop/src/renderer/routes/settings-projects.tsx` → `SettingsProjectsPage()`, `ProjectPanel()`,
    `TestSetupSection()`: đổi thư mục (validate lại trước khi lưu); loại project và MCP test UI cho sửa tại
    chỗ (nút "Gửi yêu cầu đổi") nhưng chỉ có hiệu lực sau khi chủ dự án xác nhận trên web bằng một cú nhấp —
    trong lúc chờ, form bị khoá và hiện "Đang chờ chủ dự án xác nhận…" (tự đọc lại project mỗi `PENDING_POLL_MS` = 5 giây tới
    khi hết `pendingChange`), quyết định xong hiện đúng câu theo `lastChange.status` của yêu cầu máy này đang
    chờ — "Chủ dự án đã xác nhận…", "Chủ dự án đã từ chối…", hoặc khi máy mất project trước khi owner quyết
    định "Yêu cầu đổi đã tự rút vì máy này không còn giữ project; loại project giữ nguyên."; một nút
    phụ vẫn mở cài đặt project trên web; kho skill/MCP dò được trong worktree với công tắc bật/tắt từng MCP
    server (trừ server QC bắt buộc dùng), thư mục dùng chung cho worktree (tự nhận + thêm/bỏ tay), trả project
    (có hộp xác nhận), "Nhận thêm project" và "Tạo project từ thư mục", bật/tắt vai trò trợ lý của máy. Mục
    `BmadSection` (`ProjectDetail.bmad`): hồ sơ cài BMAD server đang giữ (phiên bản, module, công cụ, ngôn ngữ)
    hoặc "Chưa có cấu hình BMAD (máy đang giữ project chưa có BMAD)" khi chưa máy nào báo; trạng thái cài trên
    máy này chỉ để biết, không quyết định nút: một `Lozenge` (Chưa cài / Đã cài / Khớp cấu hình / Khác cấu
    hình); nút "Cài BMAD" (`projects.installBmad`, chỉ bấm tay) chỉ bật khi plan là `install` (máy chưa có bất
    kỳ bản cài BMAD nào), thư mục đã có bản cài rồi thì nút khoá và hiện thông báo "Máy này đã có BMAD
    <version>; không cài lại."; khi bật, nút hiện output của trình cài realtime qua sự kiện `bmad.progress`
    rồi câu kết quả cài xong.
12. `apps/desktop/src/renderer/components/resource-form.tsx` → `ResourceForm()`, `resourceDraftError()`: số
    job chạy cùng lúc, RAM trống tối thiểu, tải tối đa mỗi CPU, danh sách model được phép (`sonnet` luôn bắt
    buộc, không tắt được) và model/effort theo từng mức độ phức tạp; validate tại chỗ trước khi cho lưu. Cả
    checkbox allowlist lẫn select model theo độ phức tạp đều dựng từ `SelectableModel.options` (`haiku`,
    `sonnet`, `opus`) — không có Fable để chọn.
13. `apps/desktop/src/renderer/components/health-check-row.tsx`, `apps/desktop/src/renderer/components/ui.tsx`
    → `HealthCheckRow()`, `StatusDot`, `Lozenge`, `Toggle`, `PageHeader`, `Notice`, `ErrorBox`: bộ thành phần
    dùng chung cho một dòng check (chấm màu, giải thích, nút sửa) và khung trang/thông báo/nhãn trạng thái
    trên toàn bộ renderer.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `apps/desktop/src/renderer/main.tsx` | Điểm vào renderer | (gắn `<App />`) |
| `apps/desktop/src/renderer/app.tsx` | Định tuyến hash, khung điều hướng, badge daemon | `App`, `parseHash`, `toHash`, `daemonBadge` |
| `apps/desktop/src/renderer/index.html` | HTML gốc, CSP | — |
| `apps/desktop/src/renderer/styles.css` | Theme và class dùng chung (Tailwind) | — |
| `apps/desktop/src/renderer/lib/ipc.ts` | Gọi IPC có kiểu, subscribe sự kiện, chuyển lỗi renderer sang app.log | `invoke`, `useDesktopEvent`, `reportRendererErrors` |
| `apps/desktop/src/renderer/lib/format.ts` | Định dạng giờ/thời lượng/tiền theo `Asia/Ho_Chi_Minh` | `formatTime`, `formatElapsed`, `formatUsd`, `errorText` |
| `apps/desktop/src/renderer/routes/setup-wizard.tsx` | Trình cài đặt 7 bước | `SetupWizard` |
| `apps/desktop/src/renderer/routes/health.tsx` | Bảng sức khỏe | `HealthPage`, `navigationFor`, `groupResults` |
| `apps/desktop/src/renderer/routes/jobs.tsx` | Danh sách job | `JobsPage` |
| `apps/desktop/src/renderer/routes/logs.tsx` | Nhật ký daemon | `LogsPage`, `matchesTicket` |
| `apps/desktop/src/renderer/routes/settings.tsx` | Cài đặt chung + tài nguyên/model | `SettingsPage` |
| `apps/desktop/src/renderer/routes/settings-projects.tsx` | Quản lý project của máy này | `SettingsProjectsPage`, `ProjectPanel`, `TestSetupSection` |
| `apps/desktop/src/renderer/components/wizard-step.tsx` | Khung một bước trình cài đặt, danh sách bước | `WizardStep`, `WIZARD_STEPS` |
| `apps/desktop/src/renderer/components/health-check-row.tsx` | Một dòng kết quả check + nút sửa | `HealthCheckRow` |
| `apps/desktop/src/renderer/components/folder-picker.tsx` | Hộp thoại chọn thư mục native | `FolderPicker` |
| `apps/desktop/src/renderer/components/project-picker.tsx` | Danh sách project để tick nhận | `ProjectPicker`, `ownershipLabel`, `readySelections` |
| `apps/desktop/src/renderer/components/new-project-form.tsx` | Form tạo project từ thư mục | `NewProjectForm`, `NewProjectFormHandle`, `draftProblem`, `PLATFORM_LABELS` |
| `apps/desktop/src/renderer/components/resource-form.tsx` | Form giới hạn tài nguyên và model | `ResourceForm`, `resourceDraftError` |
| `apps/desktop/src/renderer/components/ui.tsx` | Thành phần UI dùng chung | `Lozenge`, `StatusDot`, `Toggle`, `PageHeader`, `Notice`, `ErrorBox` |

## Dữ liệu

- Bảng: không đọc/ghi trực tiếp; mọi dữ liệu tới qua các method của `DesktopRequests` (flow `desktop-app`).
- Sự kiện: nhận `DesktopEvents` (`daemon.status`, `daemon.runtime`, `health.report`, `jobs.changed`,
  `log.line`, `update.status`, `app.navigate`, `bmad.progress`) qua `useDesktopEvent()`; không tự phát sự kiện
  nào ra ngoài renderer.
- Gọi ngoài: không gọi mạng trực tiếp (CSP chặn `connect-src`); mọi thao tác đi qua `invoke()` tới main/host.

## Flow liên quan

- desktop-app: renderer chỉ là lớp trình bày của các method/sự kiện flow này định nghĩa
  (`packages/shared/src/desktop-ipc.ts`); mọi hành vi thật (health check, daemon, VPS, git, hook) thuộc flow
  đó.
- daemon-health: `HealthPage` hiển thị đúng `HealthGroup`/`HEALTH_GROUP_TITLES` và `HealthCheckResult` mà
  `crewd doctor` cũng dùng.
- project-claims: `ProjectPicker`/`SettingsProjectsPage` phản ánh trạng thái sở hữu (`ownerState`,
  `pendingClaim`) mà API `project-claims` cấp qua daemon; `TestSetupSection` gửi và theo dõi yêu cầu đổi
  `platform`/`uiTestMcp` (`ProjectDetail.pendingChange`) qua `projects.requestTestSetup` (flow `desktop-app`),
  rồi hiện kết quả theo `ProjectDetail.lastChange` (duyệt, từ chối, hoặc tự rút khi máy mất project);
  `BmadSection` hiện `ProjectDetail.bmad` (hồ sơ BMAD server đang giữ) và gọi `projects.installBmad` (flow
  `desktop-app`) để cài lại trên máy này.

## Tests

- `apps/desktop/test/e2e/onboarding.spec.ts` (Electron thật qua Playwright `_electron`): chạy hết lần đầu cài
  đặt — ghép máy, tick nhận và tạo project, cài hook — rồi kết thúc với dashboard sức khỏe toàn xanh; bước Tài
  nguyên và model không có checkbox `fable`, danh sách allowlist và select model theo độ phức tạp chỉ có
  `haiku`/`sonnet`/`opus`.
- `apps/desktop/test/e2e/first-project.spec.ts`: khung "Thêm project mới từ thư mục" nêu đúng phần còn thiếu
  bằng lời và khoá "Tiếp" cho tới khi bấm "Lưu và nhận project" tạo xong project đang nháp; sau khi tạo, dòng
  hook hiện "Đã cài hook" và ghi chú docs chưa có là xanh (không đỏ dashboard); nút "Mở thư mục log" ở Cài
  đặt gọi đúng thao tác mở thư mục.
- `apps/desktop/test/e2e/project-settings.spec.ts`: Settings → Projects gửi yêu cầu đổi loại project, khoá form
  và hiện đang chờ, rồi phản ánh đúng sau khi chủ dự án xác nhận trên web bằng một cú nhấp; một yêu cầu đang chờ tự rút và
  hiện đúng câu khi owner chuyển project sang máy khác trong lúc đó.
- `apps/desktop/test/e2e/project-bmad.spec.ts`: Settings → Projects hiện đúng hồ sơ BMAD server đang giữ; còn
  `_bmad` trên máy thì nút "Cài BMAD" khoá và hiện thông báo đã có bản cài, xoá `_bmad` đi thì nút bật và cài
  được bằng trình cài giả lập của chế độ E2E.
- `apps/desktop/test/new-project-form.test.ts`: `draftProblem()` trả về đúng câu cho key quá dài, key sai định
  dạng và các trường rỗng còn thiếu; `null` khi nháp đã đủ.
