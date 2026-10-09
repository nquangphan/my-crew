# Crew v3 R3: gói `ops` (OP-1, OP-2, DP-1, DP-2, DP-3), kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Overlay ship UI Crew vào `server/ui-dist`.
- Có company Crew E2E đầy đủ để nghiệm thu mà không làm bẩn TPS.
- Deploy fork lên `crew.2p-solutions.com` và cài app/`crew-mac` mới lên Mac mini, mỗi bước có đường lui.

**Architecture:**
- Script trong fork `crew/ops/`, chạy từ Mac mini. Lệnh trên VPS đi qua `ssh nhamoiplatform`. Body qua `scp`/stdin.
- REST prod đi qua `/opt/crew-v3-spike/ops/api.sh` (shim curl có board key trên VPS, đã có từ R2-1 DP-3).
- Không đụng nginx.

**Tech Stack:** bash, `node --test` (mẫu `compose-set-image.test.mjs`), python3 (`policy-config.py`), Docker trên VPS, Postgres prod (qua `api.sh psql`).

**Spec:** [plan.md](plan.md) (Global Constraints mục Deploy, Interface I3, I8), spec §4.4, 4.10, §7.

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng gói này:

- OP-1 chỉ ghi `crew/ops/{overlay-source.sh,overlay-job.sh,inspect-image.sh,check-crew-companies.sh,check-crew-companies.test.mjs}`. OP-2 chỉ ghi `crew/ops/{e2e-company.sh,e2e-company.test.mjs}`.
- Mọi lệnh ghi prod (OP-2, DP-*) theo thứ tự: `active-runs.sh` rỗng (với DP), backup, làm, kiểm. Mỗi bản ghi tạo trên prod ghi vào `processes.md` (id rút gọn 8 ký tự, cách gỡ).
- Không in secret: mật khẩu, board key, webhook secret, private key SSH. Secret tạo mới đi từ stdin vào API, không qua đối số, không ghi file trên đĩa ngoài thư mục tạm `0700` xóa ngay sau dùng.
- Sau mỗi deploy kiểm đủ 5 mục ở Global Constraints. Hỏng thì `rollback.sh <TS>` ngay rồi mới điều tra.

---

### Task 1 (OP-1): Overlay ship `server/ui-dist`

**Files:**
- Modify: `crew/ops/overlay-source.sh`, `crew/ops/overlay-job.sh`, `crew/ops/inspect-image.sh`
- Create: `crew/ops/check-crew-companies.sh`, `crew/ops/check-crew-companies.test.mjs`

**Interfaces:**
- Consumes: I8; `@crew/paperclip-web` build (DS-1, cần `CREW_UI_COMMIT`).
- Produces: overlay tar có `server/ui-dist/**`; dòng `crew-ui=<commit>` trong output `inspect-image.sh`; `check-crew-companies.sh` (exit 0 khớp, 1 lệch).

- [ ] **Step 1: Test `check-crew-companies` (đỏ).** `policy-config.py` và `plugin-state.sh` giả in JSON cố định:
  - khớp → exit 0, in `ok 2 company`;
  - thiếu một bên → exit 1, in `lệch: chỉ trong CREW_POLICY_CONFIG: <id8>` hoặc `chỉ trong plugin: <id8>`.

  Không in gì ngoài id rút gọn. Đọc `policy-config.py` và `plugin-state.sh` để biết lệnh con thật (`list`/`show`). Nếu chưa có lệnh liệt kê thì thêm lệnh con `list-companies` vào `policy-config.py` (cùng gói, file được phép ghi; thêm dòng sở hữu vào ledger) kèm test trong `policy-config.test.mjs`.
- [ ] **Step 2: Sửa `overlay-source.sh` theo I8.**
  - Regex `UNKNOWN` thêm `packages/crew-web/`. Riêng file `.md` dưới `packages/crew-web/` vẫn hợp lệ.
  - Build web **sau** plugin, vì `@crew/paperclip-web` import `@crew/paperclip-plugin/shared/*` từ nguồn.
  - Thiếu mốc thì `exit 2` với `overlay: crew-ui marker missing or wrong commit`.
- [ ] **Step 3: Sửa `overlay-job.sh`** (thêm `RUN test …` theo I8) và `inspect-image.sh` (dòng `crew-ui=`).
- [ ] **Step 4: Chạy thử cục bộ, không upload.** Thêm biến `OVERLAY_NO_UPLOAD=1` vào `overlay-source.sh` (bỏ `scp`, in đường tar, giữ thư mục tạm khi biến bật). Chạy trên worktree `crew/r3` (sau khi DS-1 đã ff). Kỳ vọng:
  - `tar -tzf … | grep '^./server/ui-dist/index.html'` có;
  - `grep crew-ui` trong file có đúng commit.

  Tắt biến thì hành vi như cũ.
- [ ] **Step 5: `node --test crew/ops/*.test.mjs` xanh; `bash -n` các script.**
- [ ] **Step 6: Commit** `feat(ops): overlay mang UI Crew vào server/ui-dist và kiểm danh sách company Crew`.

---

### Task 2 (OP-2): Dựng company Crew E2E

**Files:**
- Create: `crew/ops/e2e-company.sh`, `crew/ops/e2e-company.test.mjs`

**Interfaces:**
- Consumes: `api.sh` (VPS); `policy-config.py`; `plugin-state.sh` (đọc/ghi `instanceConfig`); secret SSH của Mac (file khóa riêng mà server dùng để SSH vào Mac, đọc vị trí trong R2-1 `spike-report.md` S5 và ledger R1).
- Produces trên prod:
  - company `Crew E2E` (`issuePrefix` `CRE2E` nếu được; nếu server tự sinh prefix thì ghi giá trị thật);
  - company có trong `CREW_POLICY_CONFIG` với `ownerUserId` = user owner hiện tại (đọc từ cấu hình TPS) và `trackingProjectIds: []`;
  - secret SSH `crew-e2e-ssh`;
  - environment mẫu `crew-e2e-template` (driver `ssh`, host/port/user như environment mẫu TPS, `metadata {workspaceRealizationMode:'in_place', crewLoadGate:{maxLoad1:8, maxWaitMinutes:60}}`);
  - webhook secret `crew-e2e-status` và mục `instanceConfig.companies` của plugin;
  - label `research`.
- Produces trên Mac:
  - `~/crew-e2e/origin.git` (bare);
  - `~/crew-e2e/repo` (clone, có `README.md`, `docs/flows.yaml` tối thiểu để `crew-docs` chạy, `git config crew-docs.bundle` trỏ bundle `crew-docs` đang cài);
  - đích bản tin `crew-mac status add-target` cho Crew E2E (làm ở DP-2, sau khi `crew-mac` mới cài).

- [ ] **Step 1: Test (đỏ)** `e2e-company.test.mjs` với `api.sh` giả:
  - Lần chạy đầu gọi đúng thứ tự: tìm company theo tên → tạo nếu chưa có → secret → environment → label → policy → plugin config.
  - Lần hai (mọi thứ đã có) → 0 lời gọi tạo.
  - Nội dung private key chỉ xuất hiện trong stdin của lời gọi tạo secret, không trong đối số, không trong stdout.
- [ ] **Step 2: Cài script** (idempotent; mọi body qua stdin; in id rút gọn).
- [ ] **Step 3: Xanh, `bash -n`. Commit** `feat(ops): dựng company Crew E2E cho nghiệm thu UI`.
- [ ] **Step 4: Chạy trên prod.**
  1. `backup.sh`, ghi TS.
  2. `e2e-company.sh`.
  3. Kiểm:
     - `GET /companies` có Crew E2E;
     - `policy-config.py` có company;
     - plugin config có company;
     - `policy-env.sh`/restart server nếu `CREW_POLICY_CONFIG` cần nạp lại (đọc `policy-config.py` để biết có cần không; nếu cần restart thì phải `active-runs.sh` rỗng trước);
     - `/api/health` ok, 2 site 200.

  Ghi ledger và `processes.md`.
- [ ] **Step 5: Dựng repo thử trên Mac** (`~/crew-e2e/`). Ghi `processes.md`.

---

### Task 3 (DP-1): Deploy fork

- [ ] **Step 1:** Worktree `.worktrees/paperclip-r3-int` sạch trên `crew/r3` @ `<commit>` đã qua RV-1. Chạy `crew/release/verify.sh` (một việc nặng một lúc; kiểm `ipcs -m` trước/sau). Thêm vào verify (nếu chưa có trong OP-1): test và build `@crew/paperclip-web`.
- [ ] **Step 2:** `active-runs.sh` rỗng. `backup.sh` → ghi TS backup.
- [ ] **Step 3:** `bash crew/ops/overlay-source.sh <commit>` → `ssh nhamoiplatform '/opt/crew-v3-spike/ops/overlay-job.sh <short>' </dev/null` → `JOB_EXIT rc=0` → `inspect-image.sh` (có `crew-ui=<commit>`, không MISSING/FAIL) → `active-runs.sh` rỗng lần nữa → `deploy.sh crew-v3/paperclip:v3-<short>` → ghi mốc rollback TS.
- [ ] **Step 4: Kiểm.**
  - `/api/health` ok, đúng commit;
  - plugin `crew.core` `ready`, `lastError` null;
  - `plugin_migrations` có `0006`, `0007` applied, bảng `crew_machine_jobs`, `crew_setup_runs` có;
  - `https://2p-solutions.com`, `https://kidyschool.com` 200;
  - `curl -s https://crew.2p-solutions.com/ | grep -o 'name="crew-ui" content="[0-9a-f]*"'` đúng commit;
  - `curl -s https://crew.2p-solutions.com/cli-auth/x` trả HTML có mốc;
  - `check-crew-companies.sh` ok.
- [ ] **Step 5: Áp quyền:** `agent-permissions.sh --all-crew --dry-run` → đọc → chạy thật → kiểm Trợ Lý TPS và Crew E2E `taskAssignSource=explicit_grant`, mọi agent Crew `canCreateAgents=false`.
- [ ] **Step 6:** Tag cục bộ `crew/v3.3-rc1`. Ghi ledger: backup TS, mốc rollback, image, kết quả kiểm. Không push (push ở AC-A).
- [ ] **Step 7: Kiểm nhanh UI** (ca chặn ở Global Constraints): đăng nhập form, mở Tổng quan TPS, mở một issue, mở Hộp thư. Lỗi chặn mà không sửa được trong 30 phút → `rollback.sh <TS>`.

---

### Task 4 (DP-2): Cài `crew-mac` và app 2P Crew mới lên Mac mini

- [ ] **Step 1:** Repo Crew worktree `r3` sạch @ commit đã qua RV-1. `pnpm --filter @crew/mac build`. Build app như CV-1 R2-1 (ký Apple Development, `electron-builder --mac dir --arm64`; lệnh đúng đọc ở ledger R2-1 dòng CV-1, AP-1).
- [ ] **Step 2:** Kiểm 0 run active (`active-runs.sh` trên VPS **và** `crew-mac status` hoặc tab Run của app). Ghi `date`.
- [ ] **Step 3: Cài `crew-mac`.** `installCrewMacFrom` (qua `node -e` gọi `@crew/mac` dist, như DP-1 R2-2). Kỳ vọng `installed: true`, `.prev` giữ bản cũ.
- [ ] **Step 4: Cài app.**
  1. `cp -R "/Applications/2P Crew.app" ~/crew-r3-app-prev/` (ghi `processes.md`).
  2. Thoát app bằng menu (0 run nên quit guard không hỏi).
  3. Thay bundle bằng bản mới.
  4. Mở app.

  Kiểm:
  - sshd 2222 có đúng một listener là con của app (`lsof -nP -iTCP:2222 -sTCP:LISTEN`, `ps -o ppid=`);
  - `crew-mac doctor --no-probe` không có `fail` mới;
  - `app.json` có `jobsAgent.lastPollAt` mới trong 30 giây.

  Hỏng thì làm theo thứ tự:
  1. thay lại bản `~/crew-r3-app-prev`;
  2. nếu vẫn không có listener thì `crew-mac setup --sshd-owner launchd`;
  3. ghi ledger.
- [ ] **Step 5: Đăng nhập lại.** Nếu app báo board key không hợp lệ thì đăng nhập lại qua `/cli-auth/<id>` của UI mới (một lần bấm của Trợ Lý trên trình duyệt đã đăng nhập form). Đây cũng là bằng chứng AC8.
- [ ] **Step 6: Đích Crew E2E.** Lấy webhook secret Crew E2E từ VPS qua `ssh … | crew-mac status add-target --company <id> --secret-stdin` (không qua biến shell in ra). `crew-mac status send` → plugin có `machine_latest` cho Crew E2E và TPS. Report có `checkouts`, `superpowers.skills`, `jobsAgent`.
- [ ] **Step 7:** Ghi ledger. Ghi `processes.md` dòng bản app cũ (giữ tới hết AC-B rồi xóa).

---

### Task 5 (DP-3): Deploy lại sau sửa

Lặp DP-1 Step 1–4, 6, với tag `crew/v3.3-rcN` tăng dần. Áp quyền (Step 5) chỉ khi SEC đổi. Mỗi lần có backup và mốc rollback riêng, ghi ledger.
