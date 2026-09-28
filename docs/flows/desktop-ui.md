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
2. `apps/desktop/src/renderer/lib/ipc.ts` → `invoke()`, `useDesktopEvent()`: gọi `window.crew.invoke(method,
   input)` (từ preload) và ném lỗi bằng đúng message tiếng Việt main/daemon trả về; hook subscribe một sự
   kiện `DesktopEvents` cho vòng đời của component.
3. `apps/desktop/src/renderer/app.tsx` → `parseHash()`/`toHash()`: route, section (bước wizard hay mục cài
   đặt cần mở) và `projectKey` mã hoá hai chiều trong hash URL, nên một điều hướng từ fix sức khỏe
   (`app.navigate`) hoặc bấm lại vẫn giữ đúng vị trí.
4. `apps/desktop/src/renderer/routes/setup-wizard.tsx` → `SetupWizard()`: 7 bước theo `WIZARD_STEPS`
   (`apps/desktop/src/renderer/components/wizard-step.tsx`) — Server (`setup.checkServer`, bắt buộc
   `/v1/health` trả lời đúng cả kết nối, TLS và hợp đồng API v1), Ghép máy (`setup.pair`), Claude
   (`setup.checkClaude` + nút "Đăng nhập Claude" mở Terminal qua `setup.openClaudeLogin` + "Kiểm tra lại"),
   Project và thư mục, Docs và hook (tự cài hook còn thiếu/cũ qua `hooks.install`, hiện trạng thái docs mỗi
   project), Tài nguyên và model (bắt buộc `sonnet`), Hoàn tất (`setup.finish`: bật mở cùng máy, khởi động
   daemon). Mỗi bước tự nạp/kiểm lại dữ liệu khi mở và chặn "Tiếp" tới khi hợp lệ.
5. `apps/desktop/src/renderer/components/project-picker.tsx` → `ProjectPicker()`, `ownershipLabel()`: mỗi
   project trên server kèm nhãn sở hữu — "của máy này", "chưa có máy", "đang thuộc máy X" hoặc "Đang chờ
   duyệt trên web"; tick một project mở `FolderPicker` rồi validate thư mục ngay (`folder.validate`, dùng lại
   `repoFolderChecks` của flow `daemon-health` qua host) — git hợp lệ, đúng `origin`, đúng nhánh, quyền push,
   working tree.
6. `apps/desktop/src/renderer/components/new-project-form.tsx` → `NewProjectForm()`: "Thêm project mới từ thư
   mục" — chọn thư mục điền sẵn key/tên/repo URL/nhánh từ `origin` (`folder.inspect`), chủ project tự gõ mô tả
   (trợ lý dùng mô tả này để định tuyến ticket, không đọc từ repo), rồi `projects.create`.
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
    mới (`app.checkUpdate`/`app.installUpdate`), nút "Chạy lại trình cài đặt" và "Project của máy này", và
    cùng form tài nguyên/model của bước cuối trình cài đặt.
11. `apps/desktop/src/renderer/routes/settings-projects.tsx` → `SettingsProjectsPage()`, `ProjectPanel()`:
    đổi thư mục (validate lại trước khi lưu), loại project và MCP test UI hiển thị chỉ đọc kèm link sang cài
    đặt project trên web (chỉ chủ dự án sửa được ở đó), kho skill/MCP dò được trong worktree với công tắc
    bật/tắt từng MCP server (trừ server QC bắt buộc dùng), thư mục dùng chung cho worktree (tự nhận + thêm/bỏ
    tay), trả project (có hộp xác nhận), "Nhận thêm project" và "Tạo project từ thư mục", bật/tắt vai trò trợ
    lý của máy.
12. `apps/desktop/src/renderer/components/resource-form.tsx` → `ResourceForm()`, `resourceDraftError()`: số
    job chạy cùng lúc, RAM trống tối thiểu, tải tối đa mỗi CPU, danh sách model được phép (`sonnet` luôn bắt
    buộc, không tắt được) và model/effort theo từng mức độ phức tạp; validate tại chỗ trước khi cho lưu.
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
| `apps/desktop/src/renderer/lib/ipc.ts` | Gọi IPC có kiểu, subscribe sự kiện | `invoke`, `useDesktopEvent` |
| `apps/desktop/src/renderer/lib/format.ts` | Định dạng giờ/thời lượng/tiền theo `Asia/Ho_Chi_Minh` | `formatTime`, `formatElapsed`, `formatUsd`, `errorText` |
| `apps/desktop/src/renderer/routes/setup-wizard.tsx` | Trình cài đặt 7 bước | `SetupWizard` |
| `apps/desktop/src/renderer/routes/health.tsx` | Bảng sức khỏe | `HealthPage`, `navigationFor`, `groupResults` |
| `apps/desktop/src/renderer/routes/jobs.tsx` | Danh sách job | `JobsPage` |
| `apps/desktop/src/renderer/routes/logs.tsx` | Nhật ký daemon | `LogsPage`, `matchesTicket` |
| `apps/desktop/src/renderer/routes/settings.tsx` | Cài đặt chung + tài nguyên/model | `SettingsPage` |
| `apps/desktop/src/renderer/routes/settings-projects.tsx` | Quản lý project của máy này | `SettingsProjectsPage`, `ProjectPanel` |
| `apps/desktop/src/renderer/components/wizard-step.tsx` | Khung một bước trình cài đặt, danh sách bước | `WizardStep`, `WIZARD_STEPS` |
| `apps/desktop/src/renderer/components/health-check-row.tsx` | Một dòng kết quả check + nút sửa | `HealthCheckRow` |
| `apps/desktop/src/renderer/components/folder-picker.tsx` | Hộp thoại chọn thư mục native | `FolderPicker` |
| `apps/desktop/src/renderer/components/project-picker.tsx` | Danh sách project để tick nhận | `ProjectPicker`, `ownershipLabel`, `readySelections` |
| `apps/desktop/src/renderer/components/new-project-form.tsx` | Form tạo project từ thư mục | `NewProjectForm`, `PLATFORM_LABELS` |
| `apps/desktop/src/renderer/components/resource-form.tsx` | Form giới hạn tài nguyên và model | `ResourceForm`, `resourceDraftError` |
| `apps/desktop/src/renderer/components/ui.tsx` | Thành phần UI dùng chung | `Lozenge`, `StatusDot`, `Toggle`, `PageHeader`, `Notice`, `ErrorBox` |

## Dữ liệu

- Bảng: không đọc/ghi trực tiếp; mọi dữ liệu tới qua các method của `DesktopRequests` (flow `desktop-app`).
- Sự kiện: nhận `DesktopEvents` (`daemon.status`, `daemon.runtime`, `health.report`, `jobs.changed`,
  `log.line`, `update.status`, `app.navigate`) qua `useDesktopEvent()`; không tự phát sự kiện nào ra ngoài
  renderer.
- Gọi ngoài: không gọi mạng trực tiếp (CSP chặn `connect-src`); mọi thao tác đi qua `invoke()` tới main/host.

## Flow liên quan

- desktop-app: renderer chỉ là lớp trình bày của các method/sự kiện flow này định nghĩa
  (`packages/shared/src/desktop-ipc.ts`); mọi hành vi thật (health check, daemon, VPS, git, hook) thuộc flow
  đó.
- daemon-health: `HealthPage` hiển thị đúng `HealthGroup`/`HEALTH_GROUP_TITLES` và `HealthCheckResult` mà
  `crewd doctor` cũng dùng.
- project-claims: `ProjectPicker`/`SettingsProjectsPage` phản ánh trạng thái sở hữu (`ownerState`,
  `pendingClaim`) mà API `project-claims` cấp qua daemon.

## Tests

- `apps/desktop/test/e2e/onboarding.spec.ts` (Electron thật qua Playwright `_electron`): chạy hết lần đầu cài
  đặt — ghép máy, tick nhận và tạo project, cài hook — rồi kết thúc với dashboard sức khỏe toàn xanh.
