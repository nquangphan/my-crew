# Crew v3 R3: gói `org` (OR-1..OR-4), kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Các màn hình tổ chức:
- project (S7, S8), agent (S10, S11);
- Skills (S14), Máy (S15), Docs (S16), Hướng dẫn (S17), Cài đặt (S18).

Sửa vai trò thì render lại `AGENTS.md` của Trợ Lý. Trạng thái sẵn sàng hiện ở mọi chỗ có project/agent, kèm nút "Làm tiếp" vào wizard.

**Architecture:** Feature folder như gói `work`. Trạng thái sẵn sàng, render instructions và cấu hình agent lấy từ `@/features/readiness` và `@/lib/instructions` (WZ-1), không tính lại. Lối vào wizard là route `projects/new` và `agents/new?resume=<setupRunId>` (WZ-2, WZ-3).

**Tech Stack:** như [web-ds.md](web-ds.md).

**Spec:** [plan.md](plan.md) (Interface I3, I5, I6, I9, I10), spec §4.7, 4.8, §12 Q4, Q6, Q7, BA mục 1 S7–S18, mục 2.

## Global Constraints

Áp dụng Global Constraints của [plan.md](plan.md) và [web-ds.md](web-ds.md). Riêng gói này:

- Chỉ ghi `src/features/{projects,agents,skills,machines,docs,guide,settings}/**` và test tương ứng.
- Không có các thao tác ở BA mục 2 phần "Agent", "Project", "Company và cài đặt":
  - tạo agent/project trơn; sửa command/extraArgs/env/adapter; sửa `AGENTS.md` tay;
  - Permissions, API keys, duplicate, reset session, terminate/xóa;
  - archive/xóa project, Repositories, Budget, Workspaces;
  - Members, Secrets, Environments, Plugins.
- Đổi model chỉ trong bảng `CREW_COMPLEXITY_MODEL`. WZ-1 export hằng `CREW_MODELS` trong `@/lib/instructions/agent-config.ts`, lấy từ fork `server/src/crew/*` (đọc, không import thẳng server).

---

### Task 1 (OR-1): Project

**Files:**
- Create:
  - `src/features/projects/{routes.tsx,index.ts,list/projects-page.tsx}`
  - `src/features/projects/detail/{project-page.tsx,issues-tab.tsx,roles-tab.tsx,roles-form.tsx,docs-tab.tsx,readiness-tab.tsx,rename-dialog.tsx,use-save-roles.ts}`
  - `src/features/projects/locales/*`
  - `test/features/projects/*.test.tsx`

**Interfaces:**
- Consumes: `useProjectReadiness` (I10), `renderInstructions`, `putInstructions` (I9); roles route (I6); `api.projects.list/get/patch`, `api.sidebar.preferences`; data `crew.docs.*`.
- Produces: `useSaveRoles(projectId)`. Hook này ghi vai trò, rồi nếu tập executor đổi thì render và `PUT` lại `AGENTS.md` của Trợ Lý. Kết quả `{ roles: 'ok', instructions: 'ok' | 'conflict' | 'unchanged' }`.

- [ ] **Step 1: Test (đỏ).**
  - `projects-page.test.tsx` (S7.1–S7.3):
    - mỗi dòng có `ReadinessBadge`;
    - project `not_ready` có nút "Làm tiếp" tới `projects/new?resume=<id>` nếu có setup run dở, không thì tới tab Sẵn sàng;
    - nút Thêm project tới `projects/new`;
    - gắn sao ghi `sidebar-preferences` (đọc body đúng từ `server/src/routes/sidebar-preferences.ts`).
  - `use-save-roles.test.ts` (S8.3):
    - đổi reviewer (executor giữ nguyên) → 1 `POST roles`, không `PUT` instructions;
    - thêm executor → `POST roles` rồi `GET` file `AGENTS.md` của Trợ Lý và `PUT` có `baseHash`;
    - `PUT` trả xung đột → kết quả `instructions: 'conflict'` và hiện "Có người vừa sửa, tải lại";
    - `POST roles` trả 400 → hiện message nguyên văn của server trên form, không `PUT`.
  - `roles-form.test.tsx`: hộp chọn agent chỉ có agent `ready` hoặc đang giữ đúng vai trò đó (I10). Agent `not_ready` không có trong danh sách (S13.7).
  - `rename-dialog.test.tsx` (S8.6): `PATCH /projects/:id` chỉ có `name|description|color|icon`.
- [ ] **Step 2: Chạy, đỏ. Step 3: Cài.**
  - Tab Yêu cầu (S8.1): lọc theo `projectId`, dùng lại `IssueRow`.
  - Tab Docs (S8.4): data docs lọc theo project.
  - Tab Sẵn sàng (S8.5): danh sách kiểm `P1`, `P2`, `A1`–`A7`; mục hỏng có nút "Làm tiếp" theo `ResumeTarget`.
- [ ] **Step 4: Xanh, typecheck, lint. Step 5: Commit** `feat(crew-web): danh sách và chi tiết project, sửa vai trò`.

---

### Task 2 (OR-2): Agent

**Files:**
- Create:
  - `src/features/agents/{routes.tsx,list/agents-page.tsx}`
  - `src/features/agents/detail/{agent-page.tsx,overview-tab.tsx,instructions-tab.tsx,skills-tab.tsx,runtime-tab.tsx,model-select.tsx,runs-tab.tsx,rename-dialog.tsx}`
  - `src/features/agents/locales/*`
  - `test/features/agents/*.test.tsx`

**Interfaces:**
- Consumes:
  - `api.agents.list/get/patch/pause/resume`, `api.agents.instructionsFile.get/put`;
  - `api.agents.skills.list/sync`, `api.runs.list({agentId})`;
  - I9, I10.

- [ ] **Step 1: Test (đỏ).**
  - `agents-page.test.tsx` (S10.1–S10.4):
    - cột vai trò theo project, trạng thái chạy, `ReadinessBadge`;
    - lọc Đang chạy/Tạm dừng/Lỗi;
    - nút Tạm dừng → `POST /agents/:id/pause`, Tiếp tục → `/resume`;
    - nút Tạo agent tới `agents/new`.
  - `model-select.test.tsx` (S11.5):
    - danh sách chỉ có `CREW_MODELS`;
    - Lưu gửi `PATCH /agents/:id {adapterConfig:{model}}`, không có `replaceAdapterConfig`, không có key nào khác trong `adapterConfig`.
  - `instructions-tab.test.tsx` (S11.2):
    - nội dung chỉ đọc (`MarkdownView`), không có ô sửa;
    - "Render lại theo vai trò" gọi `renderInstructions` với vai trò của agent rồi `putInstructions`;
    - xung đột hiện cảnh báo, không ghi.
  - `skills-tab.test.tsx` (S11.3): bật/tắt skill rồi gọi `POST /agents/:id/skills/sync` với danh sách mới (body theo `server/src/routes/agents.ts` hoặc `company-skills.ts`, ghi dòng nguồn).
  - `runtime-tab.test.tsx` (S11.4): hiển thị adapter, command, extraArgs, environment, máy; không có control nhập.
  - `rename-dialog.test.tsx` (S11.7): `PATCH {name, icon}` và chỉ hai key đó.
- [ ] **Step 2: Chạy, đỏ. Step 3: Cài** (S11.1 tổng quan, S11.6 tab Run, S11.8 "Làm tiếp"). **Step 4: Xanh, typecheck, lint.**
- [ ] **Step 5: Commit** `feat(crew-web): danh sách và chi tiết agent, đổi model, render lại hướng dẫn`.

---

### Task 3 (OR-3): Skills, Máy, Docs, Cài đặt

**Files:**
- Create:
  - `src/features/skills/{routes.tsx,skills-page.tsx,skill-detail.tsx,add-skill-dialog.tsx,name-guard.ts,sync-status.tsx,locales/*}`
  - `src/features/machines/{routes.tsx,machines-page.tsx,jobs-queue.tsx,locales/*}`
  - `src/features/docs/{routes.tsx,docs-page.tsx,locales/*}`
  - `src/features/settings/{routes.tsx,settings-page.tsx,profile-form.tsx,system-info.tsx,locales/*}`
  - test tương ứng

**Interfaces:**
- Consumes:
  - `api.skills.list/get`, `api.skills.sources.discover/preview/create` (đọc `server/src/routes/company-skills.ts` để chốt đúng path và body), `api.agents.skills.sync`;
  - `jobs.create` (`kind:'skill-sync'`), `jobs.retry`;
  - data `crew.machines`, `crew.machineJobs`, `crew.skillSync`, `crew.docs.*`;
  - `api.profile.patch`, `api.assets.upload`, `api.health.get`.
- Produces: `superpowersNameClash(name, report)` (thuần). Trả tên bị trùng nếu `name` trùng (không phân biệt hoa thường) với một phần tử của `report.superpowers.skills` của **bất kỳ** máy nào trong company; không có dữ liệu thì trả `null` và UI hiện cảnh báo "Chưa biết danh sách skill Superpowers của máy".

- [ ] **Step 1: Test (đỏ).**
  - `name-guard.test.ts` (S14.2, Q6):
    - `brainstorming` trùng → chặn, không gọi `create`;
    - `my-skill` → cho;
    - report thiếu `skills` → `null`.
  - `add-skill-dialog.test.tsx`:
    - chọn skill từ nguồn → create → tạo **một** job `skill-sync` cho mỗi máy có `jobsAgent`;
    - không máy nào có `jobsAgent` thì hiện "Chờ app 2P Crew".
  - `sync-status.test.tsx` (S14.4): hiện "đã có trên <hostname>, hash <12 ký tự>" khi job `done` và `sha256` có; `failed` hiện lỗi đã làm sạch kèm nút Thử lại (`jobs.retry`).
  - `machines-page.test.tsx` (S15.1, S15.2):
    - thẻ máy tự làm mới 30 giây (fake timers);
    - hàng đợi liệt kê `queued/claimed/failed`, việc lỗi có nút Thử lại;
    - việc `queued` quá 60 giây mà máy không có `jobsAgent` hiện "Chờ app 2P Crew trên <máy>".
  - `docs-page.test.tsx` (S16.1, S16.2): ô tìm có `label` và `placeholder` qua `t()` (sửa nợ AC-4); kết quả tìm bằng số kết quả API trả; link hỏng hiện "thiếu trang"; danh sách file bị bỏ do secret-scan.
  - `settings-page.test.tsx` (S18.1–S18.3):
    - hồ sơ `PATCH /api/auth/profile`;
    - ngôn ngữ gọi `setLanguage`;
    - thông tin hệ thống đọc `/api/health` (bản, commit), chỉ đọc.
- [ ] **Step 2: Chạy, đỏ. Step 3: Cài. Step 4: Xanh, typecheck, lint.**
- [ ] **Step 5: Commit** `feat(crew-web): skills, máy, docs và cài đặt`.

---

### Task 4 (OR-4): Hướng dẫn VI/EN và "Vì sao không có nút X"

**Files:**
- Create:
  - `src/features/guide/{routes.tsx,guide-page.tsx,missing-features.ts,content/huong-dan.vi.md,content/guide.en.md,img/*.png,locales/*}`
  - `test/features/guide/{missing-features,guide-page}.test.ts(x)`

**Interfaces:**
- Consumes: BA mục 2 (bảng 5 nhóm), plugin `src/ui/guide/huong-dan.md` (bản cũ để tham khảo cách viết).
- Produces:
  - `MISSING_FEATURES: { id: string; group: 'nav' | 'issue' | 'agent' | 'project' | 'company'; reason: 'KD' | 'HK' | 'CL' | 'RS' }[]`;
  - chuỗi hiển thị trong locale `guide` key `missing.<id>.{feature,where,note}`.

Làm hai lượt:
- **Lượt 1 (đợt 3):** văn bản và bảng, chưa có ảnh mới.
- **Lượt 2 (sau DP-1):** chụp ảnh UI mới trên Crew E2E bằng Playwright (`e2e/support/shots.ts` của gói `e2e` chạy, OR-4 chỉ nhận file PNG), thay ảnh và commit.

- [ ] **Step 1: Test (đỏ).**
  - `missing-features.test.ts`: số mục bằng số dòng của BA mục 2 (đếm khi viết: ghi hằng `BA_MISSING_ROWS` kèm chú thích "đếm từ ba-report.md mục 2 ngày 10/10"); `id` không trùng; mọi `id` có đủ key ở cả `vi` và `en`.
  - `guide-page.test.tsx`: mọi ảnh trong markdown có file trong `img/`; mọi link nội bộ `/…` khớp một route đã gom (I5); đổi EN thì hiển thị `guide.en.md`.
- [ ] **Step 2: Chạy, đỏ.**
- [ ] **Step 3: Viết nội dung.**
  - Bản VI viết lại theo UI mới: đăng nhập, tạo yêu cầu, theo dõi map, duyệt/yêu cầu sửa, hủy, thêm project, tạo agent, skills, máy, docs, câu hỏi thường gặp.
  - Có mục "Vì sao không có nút X" render từ `MISSING_FEATURES`.
  - Bản EN dịch từ VI (Q4).
- [ ] **Step 4: Xanh, typecheck, lint. Step 5: Commit** `docs(crew-web): hướng dẫn hai ngôn ngữ và danh sách tính năng không có`.
- [ ] **Step 6 (lượt 2):** nhận ảnh từ E2E, thay `img/*.png`, chạy lại test. Commit `docs(crew-web): ảnh hướng dẫn theo giao diện mới`.
