# Crew v3 R3: gói `e2e` (E2E-1..E2E-5) và thủ tục nghiệm thu AC-A, AC-B

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi nút và flow trong BA mục 1 có một ca Playwright. Ca kiểm tác dụng thật bằng `GET` API hoặc `psql`. Toàn bộ chạy trên prod company Crew E2E với chế độ stub, nên không tốn quota Claude (T2). Sau đó đúng 2 yêu cầu chạy thật (T3).

**Architecture:**
- `packages/crew-web/playwright.config.ts`, `e2e/support/*` (I11), `e2e/specs/<màn hình>.spec.ts`, `e2e/flows/*.spec.ts`.
- Playwright chạy trên Mac mini. Máy này cũng là máy agent, nên `stub.ts` ghi trực tiếp tệp đánh dấu vào checkout `~/crew-agents/e2e-*`.
- Một project nền `e2e-base` dựng một lần bằng wizard trong `global-setup.ts`, dùng lại cho mọi ca.
- Ca tự dọn: cancel issue đã tạo, tắt marker.

**Tech Stack:** `@playwright/test` (bản đã có trong fork root, `npx playwright --version`), Chromium, Node, `ssh nhamoiplatform` cho `api.sh`/`psql`.

**Spec:** [plan.md](plan.md) (Review Focus 2, 5, Interface I4, I11), spec §7, BA mục 1 (cột Ca PW) và mục 4 "Nghiệm thu Playwright".

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng gói này:

- Chỉ ghi `packages/crew-web/{playwright.config.ts,e2e/**}` và `~/crew-r3-t1/` (T1, ngoài repo).
- Mọi ca T2 chạy trong company Crew E2E. Ca nào cần TPS thì chỉ **đọc** (ví dụ `PW-S0-2` kiểm danh sách company). Không tạo issue, không đổi gì ở TPS.
- Đăng nhập bằng form. Mật khẩu chỉ vào biến môi trường của process qua `e2e/support/run-e2e.sh`, không echo, không ghi file, không có trong trace. Đặt `trace: 'retain-on-failure'` nhưng `page.fill` mật khẩu bọc `test.step` có `box`, và mask bằng cách điền qua `locator.evaluate`. E2E-1 kiểm `grep -r "$CREW_E2E_PASSWORD" test-results` ra 0 dòng.
- Ca âm dùng token agent tạm (`agentToken`), xóa key ngay sau ca. Không dùng key agent TPS.
- Trước mỗi lượt T2: `stub.on` cho mọi checkout `e2e-*`. Sau lượt: `stub.off`. Ca nào cần run "đang chạy" thì đặt marker 300 giây và tự cancel run ở cuối ca.

---

### Task 1 (E2E-1): Harness, phủ nút, nút chết, T1

**Files:**
- Create:
  - `packages/crew-web/playwright.config.ts`
  - `e2e/support/{run-e2e.sh,env.ts,login.ts,api.ts,db.ts,stub.ts,agent-token.ts,cleanup.ts,global-setup.ts,shots.ts}`
  - `e2e/ba-ids.json`, `e2e/coverage.json`
  - `test/e2e-coverage.test.ts`
  - `e2e/specs/no-dead-controls.spec.ts`
  - `e2e/README.md` (cách chạy T1/T2/T3, không có secret)

**Interfaces:**
- Consumes: I4 (marker), I11; Crew E2E (OP-2).
- Produces: I11; project nền `e2e-base` (khóa `e2e-base`, 2 executor) dựng qua wizard UI trong `global-setup.ts` nếu chưa có.

- [ ] **Step 1: Xác nhận môi trường (không code).** Ghi ledger:
  - tên biến mật khẩu và email board trong `/opt/crew-v3-spike/.env` (`ssh nhamoiplatform "cut -d= -f1 /opt/crew-v3-spike/.env"`, chỉ in tên);
  - lệnh `api.sh` cho `psql` (đọc `crew/ops/` và ledger R2-1 DP-3);
  - bản Playwright có sẵn.
- [ ] **Step 2: `ba-ids.json`.** Trích mọi mã từ BA mục 1 (`S0.1`…`S19`, bước `S9.1`…`S9.7`, `S9.err`, `S13.1`…`S13.7`, `F1`…`F9`), áp thay đổi spec §5 ý 1 (`S9.1` = gõ folder + `inspect-folder`). Ghi nguồn và ngày trong trường `"$source"`.
- [ ] **Step 3: Test phủ (đỏ)** `test/e2e-coverage.test.ts`:

```ts
const ids: string[] = JSON.parse(readFileSync('e2e/ba-ids.json', 'utf8')).ids;
const cov = JSON.parse(readFileSync('e2e/coverage.json', 'utf8'));
it('mọi mã BA có ca hoặc lý do bỏ', () => {
  expect(ids.filter((id) => !cov[id] || (!cov[id].tests?.length && !cov[id].skip))).toEqual([]);
});
it('mọi ca trong coverage có thật trong file spec', () => {
  for (const [id, c] of Object.entries<any>(cov)) for (const t of c.tests ?? []) expect(readFileSync(c.spec, 'utf8')).toContain(t);
});
it('chỉ F9 được bỏ', () => {
  expect(Object.entries<any>(cov).filter(([, c]) => c.skip).map(([id]) => id)).toEqual(['F9']);
});
```

  Đỏ là đúng cho tới hết E2E-5. E2E-1 commit test này cùng `coverage.json` chỉ có các mã của E2E-1, kèm `it.todo` cho phần còn lại. Ca đầu chỉ bật đầy đủ ở E2E-5 (ghi rõ trong file): khối `describe` dùng `const STRICT = process.env.CREW_E2E_COVERAGE_STRICT === '1'`, và E2E-5 xóa biến này để luôn chặt.
- [ ] **Step 4: Support.**
  - `login.ts`: `goto('/login')`, điền email, điền mật khẩu, bấm Đăng nhập, chờ `/dashboard`. Lưu `storageState` vào thư mục tạm `0700` (xóa ở teardown).
  - `api.ts`: `request.newContext({ storageState })` gọi REST, trả JSON.
  - `db.ts`: `query(sql, params)`. SQL ghép tham số bằng `format` an toàn (chỉ uuid/số/chuỗi đã escape `'`→`''`), chỉ nhận câu bắt đầu `SELECT`. Gửi qua `spawn('ssh', ['nhamoiplatform', '/opt/crew-v3-spike/ops/api.sh', 'psql'])` với SQL trên stdin, đọc CSV.
  - `stub.ts`: `on(projectKey, seconds)`, `off(projectKey)` cho mọi checkout `~/crew-agents/<projectKey>/*` có `.git`. Từ chối `projectKey` không bắt đầu bằng `e2e-`.
  - `agent-token.ts`: tạo API key cho agent (route keys trong `agents.ts`), trả `{token, revoke()}`.
  - `cleanup.ts`: cancel issue đã ghi trong `test.info().annotations`.
  - `global-setup.ts`: đăng nhập; đảm bảo project `e2e-base` sẵn sàng (chưa có thì chạy wizard UI với folder `~/crew-e2e/repo`, 2 executor, chờ `check` xong); bật stub.
  - `shots.ts`: chụp các trang cho OR-4 (lượt 2), ra `e2e/shots/*.png` (gitignore). OR-4 chép sang `src/features/guide/img/`.
- [ ] **Step 5: `no-dead-controls.spec.ts`** (AC5). Với mỗi route trong danh sách (đọc từ router, mở bằng dữ liệu `e2e-base`):
  - mọi `button`, `a`, `[role=menuitem]`, `[role=tab]` hiện ra: `a` có `href` khác `#`; `button` không `disabled`, hoặc `disabled` kèm `title`/`aria-describedby` có nội dung;
  - bấm thử từng `button` không phá hoại (bỏ qua nút có `data-destructive`) thì có thay đổi DOM hoặc request mạng trong 2 giây.

  DS-2/DS-3 đặt `data-destructive` cho `ConfirmDialog` trigger. Nếu chưa có thì E2E-1 mở FX gói `ds`.
- [ ] **Step 6: T1 (≤ 90 phút).** Dựng `~/crew-r3-t1/`:
  1. Paperclip fork `crew/r3` chạy dev server cổng `3199`, Postgres nhúng (đọc `README`/`scripts/dev-runner.mjs` của fork);
  2. cài plugin `crew.core` từ `packages/crew-plugin`;
  3. tạo user board (email/mật khẩu tạm, không dùng mật khẩu prod), company `Crew E2E` cục bộ, `CREW_POLICY_CONFIG` tạm;
  4. web dev cổng `5183` proxy tới `3199`.

  Chạy ca đăng nhập, cli-auth, tạo yêu cầu (assignee là agent tạm; không cần chạy), duyệt (dựng trạng thái bằng API board), hủy. Quá 90 phút chưa chạy được thì dừng T1, ghi lý do vào ledger, tắt mọi process, xóa `~/crew-r3-t1/`. Ghi `processes.md` mọi PID/cổng.
- [ ] **Step 7: Commit** `test(crew-web): harness Playwright, bản đồ phủ nút và kiểm nút chết`.

---

### Task 2..5 (E2E-2..E2E-5): Ca theo màn hình

Mỗi ticket viết các file spec dưới đây. Mỗi ca:
1. đặt tên bắt đầu bằng mã BA (`PW-S5-2 …`);
2. thao tác bằng UI;
3. kiểm tác dụng bằng `api`/`db` đúng như cột "Ca PW" của BA;
4. thêm dòng vào `coverage.json`.

Chạy ở T1 nếu có, không thì chạy được sau DP-2 (AC-A). Khi chưa có môi trường thì ticket dừng ở bước "typecheck spec + `playwright test --list`". Ca nào cần dựng trạng thái (ví dụ issue ở stage owner) thì dựng bằng API board trong `beforeEach`. Ca kiểm hành động UI phải chứng minh không có activity `crew.policy.board_override` **phát sinh sau thời điểm bấm** (lọc theo `createdAt`).

| Ticket | File | Mã |
|---|---|---|
| E2E-2 | `e2e/specs/{s0-shell,s1-auth,s2-dashboard,s3-inbox,s4-issues,s5-new-request,s19-search}.spec.ts`, `e2e/flows/f5-cancel.spec.ts` | S0.1–S0.6, S1.1–S1.2, S2.1–S2.4, S3.1–S3.5, S4.1–S4.4, S5.1–S5.7, S19, F5 |
| E2E-3 | `e2e/specs/{s6-issue,s12-run}.spec.ts`, `e2e/flows/f2-request-changes.spec.ts` | S6.1–S6.16, S12.1–S12.4, F2 |
| E2E-4 | `e2e/specs/{s7-projects,s8-project,s9-add-project,s10-agents,s11-agent,s13-add-agent,authz-negative}.spec.ts`, `e2e/flows/f7-add-agent.spec.ts` | S7.1–S7.3, S8.1–S8.6, S9.1–S9.7, S9.err, S10.1–S10.4, S11.1–S11.8, S13.1–S13.7, F7, ca âm của SEC-2 |
| E2E-5 | `e2e/specs/{s14-skills,s15-machines,s16-docs,s17-guide,s18-settings}.spec.ts`, `e2e/flows/f8-skill-sync.spec.ts` | S14.1–S14.4, S15.1–S15.2, S16.1–S16.2, S17, S18.1–S18.3, F8; bật `coverage` chặt |

Ghi chú các ca khó, viết đúng như sau:

- **PW-S5-5:** issue tạo ra có `executionPolicy` khớp vai trò `e2e-base`, có run `queued`/`running` của Trợ Lý `e2e-base` trong `GET /companies/:c/heartbeat-runs?agentId=` ≤ 30 giây. Stub chạy 5 giây rồi run `succeeded`. Cuối ca cancel issue.
- **PW-S6-10 / F5:**
  1. Marker 300 giây, tạo issue, chờ run `running`.
  2. Bấm Hủy → issue `cancelled`, run `cancelled` ≤ 30 giây.
  3. Process group của run (wrapper ghi trong `<checkout>/.paperclip-runtime/runs/<runId>/`; đọc tên tệp thật trong `crew-claude-run.sh`) không còn process nào: `ps -g <pgid> -o pid=` rỗng.
  4. Ca âm: token agent `PATCH {status:'cancelled'}` → 422 `agent_cancel_forbidden`.
- **PW-S9-3, S9-7:** job `prepare-checkouts`/`check` thành `done` trong ≤ 3 phút (app nhận việc). Thư mục `~/crew-agents/e2e-<khóa>/<role>` tồn tại. Khóa ca dùng `e2e-w<timestamp base36>`. Cuối ca:
  - pause agent;
  - archive environment;
  - `roles.delete`;
  - project archive;
  - `git worktree remove` các checkout (dọn bằng helper, ghi `processes.md`).
- **PW-S9-8 (`S9.err`):** gây lỗi bước 4 bằng cách tạm archive environment mẫu Crew E2E trước ca (khôi phục `active` cuối ca, `finally`). Agent bước trước không có (bước 4 trước 5), nên kiểm run `failed` và nút Chạy tiếp. Khôi phục mẫu rồi bấm Chạy tiếp → `done`.
- **PW-S11-3 / F8:**
  1. Bật skill thử `crew-e2e-hello` (thêm từ nguồn ở PW-S14-2) cho executor `e2e-base`.
  2. Ca gọi `POST /agents/:id/wakeup` bằng API board để có một run stub của executor (không tạo issue).
  3. Sau run, `ls <checkout>/.paperclip-runtime/claude/skills` có `crew-e2e-hello`, và `git -C <checkout> status --porcelain` không có `.paperclip-runtime`.
- **PW-S14-2:** E2E-5 đọc `server/src/routes/company-skills.ts` để biết loại nguồn được hỗ trợ.
  - Có loại không cần GitHub (local/URL) thì dùng nguồn đó với skill `crew-e2e-hello` đặt trong `~/crew-e2e/skills/`.
  - Chỉ có GitHub thì dùng repo công khai `anthropics/skills` (chỉ đọc), chọn một skill nhỏ, đặt tên hiển thị `crew-e2e-hello`; ghi ledger.
  - Tên trùng `brainstorming` bị chặn ngay trên UI, `GET skills` không đổi.
- **PW-S15-1 "Mất liên lạc":** không dừng LaunchAgent thật. Ca kiểm bằng cách đọc `crew.machines` của một máy giả: gửi một bản tin ký hợp lệ cho Crew E2E với `machineId` mới qua webhook (dùng webhook secret Crew E2E đọc qua stdin), chờ 3 phút 10 giây, thẻ máy giả hiện "Mất liên lạc". Cuối ca không xóa được bản ghi máy (plugin không có route xóa), nên ghi `processes.md` "máy giả <id8> trong Crew E2E".
- **Ca âm** (`authz-negative.spec.ts`): đúng danh sách SEC-2 Step 8. Mỗi ca kiểm mã trả và kiểm DB không đổi.

Mỗi ticket:
- [ ] **Step 1:** viết spec theo bảng, thêm `coverage.json`.
- [ ] **Step 2:** `npx playwright test --list` liệt kê đủ; `tsc --noEmit -p e2e`.
- [ ] **Step 3:** nếu có T1 thì chạy các ca chạy được ở T1, ghi kết quả.
- [ ] **Step 4:** commit `test(crew-web): ca Playwright cho <nhóm màn hình>`.

---

## Thủ tục AC-A (T2, 0 quota)

Trợ Lý làm (opus), sau DP-2.

- [ ] **1. Chuẩn bị.** Ghi `date` bắt đầu. `active-runs.sh` của TPS rỗng (để mọi run trong khung giờ là của Crew E2E). Ghi số run hôm nay (`heartbeat_runs` theo company) làm mốc.
- [ ] **2. Chạy cục bộ trước** (không cần mạng): `pnpm --filter @crew/paperclip-web test` (gồm guard DS, i18n, `e2e-coverage` chặt) → AC1, AC3, AC4 phần tĩnh.
- [ ] **3. Chạy T2:** `bash packages/crew-web/e2e/support/run-e2e.sh --project=t2` (`retries: 1`, `workers: 1`).
- [ ] **4. Kiểm quota:** run sinh trong khung giờ đều có transcript `crew-e2e-stub` (`heartbeat_runs` + log). Không run nào gọi `claude` thật. Đếm bằng `db.query`. Có run gọi model thật thì dừng, điều tra (stub hỏng).
- [ ] **5. AC6:** `node crew/release/check-core-hooks.mjs`; `git diff --stat crew/r2-2..crew/r3` chỉ có đường dẫn cho phép (lọc bằng regex Global Constraints, in đường lạ).
- [ ] **6. AC7:** `authz-negative.spec.ts` xanh. `reports/sec-1-authz.md` không còn mục (b)/(c) chưa làm. Mục (d) đã ghi "chờ owner".
- [ ] **7. AC8:** bằng chứng DP-1 Step 4 và DP-2 Step 5.
- [ ] **8. AC10:**
  - `vite build` in kích thước chunk khởi đầu (gzip) ≤ 700 KB, ghi số;
  - ca `s2-dashboard.spec.ts` đo thời gian tới khi thẻ số hiện ≤ 3 giây.
- [ ] **9.** Ca đỏ thì mở FX theo gói của file cần sửa (model như ticket gốc) → review → ff → DP-3 → chạy lại **chỉ các file spec đỏ**, rồi một lượt đầy đủ cuối cùng.
- [ ] **10.** Xanh hết thì:
  - viết `reports/ac-a.md`;
  - `stub.off`;
  - **push** `r3` (repo Crew, `crew-docs check --range r2-2..r3` trước) và `crew/r3` (fork). Không force.
  - Ghi ledger.

## Thủ tục AC-B (T3, ≤ 20 run)

- [ ] **1. Chuẩn bị.**
  - Quota tuần còn trên 1%. `active-runs.sh` rỗng. `stub.off` cho mọi `e2e-*`. Backup. Ghi `date` và số run mốc.
  - Bật skill thử `crew-e2e-hello` cho executor của project R-A.
  - Trong T3 không đổi gì ở TPS.
- [ ] **2. R-A (F6 + F1).**
  1. Trợ Lý chạy wizard Thêm project trên UI bằng Playwright (`e2e/flows/f1-real.spec.ts`, chỉ chạy với `--project=t3`): khóa `e2e-ra`, folder `~/crew-e2e/repo`, 1 executor.
  2. Chờ `check` xanh; project "Sẵn sàng".
  3. Tạo yêu cầu Code: "Thêm dòng `Crew R3 nghiệm thu <date>` vào README.md. Chỉ sửa README.md." qua dialog S5.
  4. Theo dõi map tới stage owner → tab "Chờ tôi duyệt" có issue → bấm Duyệt → integrator push.

  Kiểm:
  - issue `done`;
  - `git -C ~/crew-e2e/origin.git log -1 --format=%s` có commit mới;
  - transcript run executor có `crew-e2e-hello` trong danh sách skill hoặc có dòng nạp skill (grep log run);
  - `git status --porcelain` của 4 checkout sạch;
  - không có activity `board_override` sau lúc bấm Duyệt.
- [ ] **3. R-B (F3 + F4).** Tạo yêu cầu loại Nghiên cứu trên `e2e-ra`: "So sánh hai cách đặt tên nhánh cho repo này. Hỏi tôi trước khi bắt đầu nếu chưa rõ tiêu chí." → chờ thẻ câu hỏi → trả lời "Tiêu chí: ngắn gọn" → reviewer → Duyệt. Kiểm:
  - `executionPolicy.stages` có 2 stage;
  - interaction `resolved`;
  - issue `done`;
  - không có push.
- [ ] **4. Đếm run** trong khung giờ (`heartbeat_runs` company Crew E2E, không phải stub) ≤ 20. Ghi số thật. Quá 20 giữa chừng thì dừng, cancel issue đang chạy, báo trong ledger.
- [ ] **5. AC9 đạt** thì:
  - viết `reports/ac-b.md`;
  - tag `crew/v3.3` trên commit đã deploy;
  - **push** `r3`, `crew/r3` và tag;
  - cập nhật `status` frontmatter plan thành `done`.
- [ ] **6. Dọn.**
  - pause agent `e2e-*`;
  - `processes.md` không còn dòng "đang chạy";
  - xóa `~/crew-r3-app-prev/` nếu app mới chạy ổn từ DP-2;
  - giữ Crew E2E và `~/crew-e2e/` cho R sau (ghi `processes.md` "giữ lại").
