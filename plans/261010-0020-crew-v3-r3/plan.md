---
title: "Crew v3 R3 — UI Crew mới hoàn toàn"
description: "UI Crew mới (packages/crew-web trong fork) thay UI Paperclip qua server/ui-dist trong overlay: design system clone từ Paperclip, hai ngôn ngữ VI/EN, chỉ thao tác có tác dụng thật; wizard thêm project/tạo agent làm đủ bước bằng REST + hàng đợi việc trên máy do app 2P Crew nhận; trạng thái sẵn sàng; bịt lỗ hổng quyền agent; nghiệm thu Playwright theo danh sách nút của BA trên company Crew E2E với chế độ stub và đúng 2 yêu cầu chạy thật. Không thêm hook, không sửa lõi."
status: pending
priority: P1
effort: 12d
branch: r3
fork_branch: crew/r3
tags: [crew-v3, ui, design-system, i18n, crew-plugin, mac-app, machine-jobs, authz, playwright]
created: 2026-10-10
---

# Crew v3 R3 — UI Crew mới hoàn toàn — Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mở `https://crew.2p-solutions.com` là thấy UI Crew. Mọi nút đều làm được việc thật (đổi DB hoặc đổi trạng thái trên Mac). UI ghép từ design system, có hai ngôn ngữ VI/EN. Thêm project và tạo agent là luồng làm đủ bước. Lỗ hổng quyền của agent được bịt.

**Architecture:**
- Package mới `packages/crew-web` trong fork (`@crew/paperclip-web`, Vite + React 19 + react-router 7 + TanStack Query 5 + Tailwind 4 + i18next). Chỉ gọi REST Paperclip và plugin `crew.core`.
- Bản build được `overlay-source.sh` chép vào `server/ui-dist`. Server stock ưu tiên thư mục này, nên không cần sửa lõi.
- Plugin thêm hai bảng: hàng đợi việc trên máy và tiến độ wizard, kèm route board.
- App 2P Crew trên Mac nhận việc bằng board key. `crew-mac` gửi bản tin cho nhiều company và có chế độ stub cho nghiệm thu.
- Quyền agent sửa bằng cấu hình/grant. Nếu cần thì mở rộng thân hook có sẵn trong `server/src/crew/**`.

**Tech Stack:**
- Fork Paperclip `v2026.1005.0`:
  - React 19.2, react-router-dom 7.18, @tanstack/react-query 5.102, tailwindcss 4.3 + @tailwindcss/vite, radix-ui 1.6, class-variance-authority 0.7, lucide-react 1.38, i18next 26.4 + react-i18next 17, react-markdown 10 + remark-gfm 4, @xyflow/react 12 (đã có trong plugin);
  - Vite 8, Vitest 4, TypeScript 7, `@playwright/test` (bản `npx playwright` đang có trong fork).
- Plugin SDK (`apiRoutes`, `ctx.data.register`, `ctx.db`, webhook).
- Repo Crew: `@crew/mac` (Node ≥ 22, Vitest 5, Biome 2.5), `@crew/mac-app` (Electron 44, `utilityProcess`).

**Spec:** [2026-10-10-crew-v3-r3-ui-design.md](../../docs/superpowers/specs/2026-10-10-crew-v3-r3-ui-design.md). Danh mục nút chuẩn: [BA R3 mục 1](ba/ba-report.md) (mã `S*`, `F*`, `PW-*`). Khuôn plan: [R2-2](../261009-1945-crew-v3-r2-2/plan.md), [R2-1](../261009-1140-crew-v3-r2-1/plan.md).

**Hiện trạng (10/10/2026 00:40, theo `date`):**
- Repo Crew: `v3` @ `32fe7c7`. Nhánh tích hợp R2-2 `r2-2` @ `a0e8ed8` (chưa gộp `v3`; AC-R2-2 chưa xong phần thao tác UI).
- Fork: `crew/r2-2` @ `f862b7b20` đang chạy prod (image `v3-f862b7b20`, mốc rollback `20261010-003110`, backup `20261010-0031`). Hook 5/5. Plugin migration 0001–0005.
- Mac mini: app 2P Crew (ký Apple Development) giữ sshd 2222. `crew-mac` bản `a0e8ed8` ở `~/.crew/app/crew-mac`. Company prod: TPS (`2P Solutions`), CREA (`Crew Spike Policy`). Chưa có company Crew E2E.

- **R2-3 (BMAD) đang chạy song song** ([plan R2-3](../261010-0030-crew-v3-r2-3/plan.md), bắt đầu 00:56). R2-3 chạm `apps/crew-mac` (workflows, cách ly nạp plugin), thân H4 trong `server/src/crew/**` và `crew/agents/**`. Ba điểm R3 phải theo:
  - Khi `r2-3`/`crew/r2-3` gộp xong, Trợ Lý `git merge` chúng vào `r3`/`crew/r3` trước đợt chạm cùng file: MC-1 (wrapper), SEC-2 (hook), WZ-1 (template, readiness A2).
  - Readiness A2 phải nhận cả cấu hình ghim của agent BMAD theo R2-3, không chỉ Superpowers. WZ-1 Step 1 đọc plan R2-3 và code đã gộp để chốt.
  - Khối stub (I4) đặt sau mọi kiểm cách ly của R2-3 trong wrapper.

## Global Constraints

- **Paperclip ghim `v2026.1005.0`.** Không nâng upstream, không chạy `crew/release/upgrade.sh`. `core-hooks.json` giữ `base: v2026.1005.0`.
- **Hook lõi 5/5, không thêm hook, không sửa lõi.**
  - Fork chỉ được đổi: `packages/crew-web/**`, `packages/crew-plugin/**`, `server/src/crew/**`, `server/src/__tests__/crew-*`, `crew/**`, `pnpm-lock.yaml`, file `*.md`.
  - Không sửa `ui/**`, `server/src/routes/**`, `server/src/services/**`, `packages/shared/**`, `packages/plugins/**`.
  - Mở rộng thân hook H2/H4/H5 chỉ ở SEC-2, model opus, cập nhật `description` trong `core-hooks.json`, không đổi `anchor`/`head`/`file`.
  - Việc nào buộc phải sửa lõi thì dừng, ghi ledger, chờ owner.
- **UI mới chỉ gọi REST Paperclip và plugin Crew.**
  - Endpoint chỉ được dùng nếu có trong bảng hằng `packages/crew-web/src/api/endpoints.ts`, lấy từ cột "Tác dụng thật" của BA mục 1.
  - Không import `ui/src/**`. Component chép (clone) vào `src/ds/`, mỗi file ghi nguồn ở dòng đầu.
- **Thay UI qua `server/ui-dist` trong overlay** (OP-1). Không đụng nginx dùng chung của VPS.
- **Design system bắt buộc.** Màn hình chỉ ghép từ `@/ds`. Luật kiểm bằng test (I5 mục "Luật"). Code clone phải chuyển sang component `ds/`.
- **Hai ngôn ngữ**, VI là bản gốc.
  - Mọi chuỗi qua `t()`. Key tiếng Anh. Locale chia theo feature (I5).
  - Ngày giờ hiển thị `Asia/Ho_Chi_Minh`.
  - Docs dự án vẫn tiếng Việt.
- **Worker chỉ là agent Claude.**
  - sonnet cho việc bám khuôn: DS-1, DS-2, DS-4, WK-1, WK-2, WK-4, OR-1..OR-4, PL-3, OP-1, E2E-2..E2E-5, DP-3.
  - opus cho bảo mật, authz, kiến trúc và review cuối: SEC-1, SEC-2, DS-3 (auth, cli-auth), WK-3 (cổng), WZ-1..WZ-3, PL-1, PL-2, MC-1, MC-2, OP-2, E2E-1, DP-1, DP-2, RV-1, AC-A, AC-B.
  - Không Codex, không fable.
- **Deploy prod được phép**, chỉ qua `crew/ops/*`, theo trình tự:
  1. `active-runs.sh` rỗng.
  2. Backup.
  3. `overlay-source.sh` → `overlay-job.sh` → `deploy.sh`.
  4. Ghi mốc rollback.
  5. Kiểm `/api/health` `status ok` đúng commit, plugin `crew.core` `ready`, `https://2p-solutions.com` và `https://kidyschool.com` trả 200, `GET /` có mốc `crew-ui` đúng commit, `check-crew-companies.sh` khớp.

  Hỏng thì chạy ngay `rollback.sh <TS>`. Cài app/`crew-mac` lên Mac mini chỉ khi 0 run active, giữ bản cũ để quay lui.
- **UI Crew lên prod lần đầu** (DP-1) chỉ khi RV-1 không còn blocker và các ca đăng nhập, cli-auth, tạo yêu cầu, duyệt, hủy đã xanh ở T1. Nếu bỏ T1 thì cần đủ ca component tương ứng ở T0. Sau deploy, lỗi chặn một trong 5 luồng đó mà không sửa được trong 30 phút thì rollback.
- **Push** repo Crew (`r3`) và fork (`crew/r3`) sau mỗi phần nghiệm thu đạt (owner cho):
  - sau AC-A (T2 xanh);
  - sau AC-B (T3 xanh), kèm tag fork `crew/v3.3`.

  Bản ứng viên cục bộ là `crew/v3.3-rcN`. Không tag `v*`. Không force-push.
- **Quota Claude dùng chung với owner.**
  - T3 chạy đúng 2 yêu cầu thật, trần 20 run; vượt thì dừng, báo.
  - T2 dùng chế độ stub, không gọi `claude`.
  - Không chạy `claude -p` thử ngoài T3.
  - Dừng dispatch khi quota tuần còn 1% (bộ nhớ dự án), giữ quota để viết bàn giao.
- **Mac mini dùng chung.**
  - Một việc nặng một lúc: test Postgres nhúng (kiểm `ipcs -m` trước, một file một lúc), `verify.sh`, `vite build`, Playwright, stack T1, build app Electron.
  - Mọi process nền, bản ghi thử trên prod và thư mục tạm ghi vào [processes.md](processes.md) (lệnh, PID, cổng, worktree, cách dừng/gỡ), tắt khi xong.
  - Thư mục tạm không đặt dưới `/Volumes`, `~/Desktop`, `~/Downloads`, `~/Documents` (TCC).
  - Cổng cố định: web dev `5183`, server T1 `3199`. Cổng bận thì tìm và dừng chủ cũ của mình, không tăng cổng.
- **Bài học R2-1/R2-2 (bắt buộc).**
  - Giờ trong ledger, comment, báo cáo lấy theo `date`.
  - Body gửi VPS (JSON, markdown, SQL, file) đi qua `scp` hoặc stdin. Không nhúng nội dung vào chuỗi lệnh `ssh`.
  - Trợ Lý chỉ ff nhánh tích hợp sau khi đọc log test của ticket.
  - Agent `claude_local` tạo mới phải có `adapterConfig.engine = "cli"`, `model` rõ ràng, `env: {}`, `maxConcurrentRuns = 1`.
  - Issue thử trong TPS kéo workflow `crew.core` chạy thêm run, nên mọi thử nghiệm làm trong company **Crew E2E**.
  - Agent/project đã có `cost_events` thì không xóa được: dùng terminate/archive.
  - Test nhận diện process dùng chuỗi `ps` lấy từ máy thật.
  - Playwright đăng nhập bằng form, không nạp cookie qua tool.
  - Không in secret: mật khẩu board đọc từ `.env` VPS qua stdin vào biến môi trường của process Playwright; không echo, không ghi file, không đưa vào log.
- **Vòng mỗi ticket:**
  1. Implementer (agent mới, model của ticket, nạp gói ngữ cảnh) làm.
  2. Reviewer (agent mới, cùng model) đọc diff và log test, đối chiếu Interface, Review Focus, Global Constraints; trả `Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`.
  3. Trợ Lý ghi [sdd-ledger.md](sdd-ledger.md) và ff.
- **Test theo tầng.**
  - Implementer chạy test của phần đổi, typecheck package đó và `biome`/`tsc` trên file đổi (fork); repo Crew thì `pnpm lint`.
  - Reviewer không chạy lại full suite.
  - Full suite chỉ chạy ở RV-1 và DP-1: `pnpm --filter @crew/paperclip-web test` + typecheck + build, `crew/release/verify.sh` (fork); `pnpm -r test`, `pnpm -r typecheck`, `pnpm lint` (repo Crew).
  - Playwright T2 chỉ ở AC-A; T3 chỉ ở AC-B.
- **Docs repo Crew theo `crew-docs`.**
  - Commit đổi `apps/mac-app/**` sửa `docs/flows/mac-app*.md` tương ứng; đổi `apps/crew-mac/src/status/**` sửa `docs/flows/mac-setup.md`; đổi wrapper/assets sửa `docs/flows/mac-workflows.md`.
  - File mới vào `docs/flows.yaml` rồi `node packages/docs-kit/dist/crew-docs.cjs generate`.
  - Không sửa mục `source`, `shared`, `unassigned`, không sửa `AGENTS.md`, `CLAUDE.md`, `.claude/**`, `.githooks/**` (R6).
  - Trước commit chạy `crew-docs check --staged`; trước push chạy `crew-docs check --range r2-2..r3`.
- **Commit:** Conventional Commits, không nhắc AI, không ghi mã ticket/plan trong code, test, commit message. Identifier, path, route, key tiếng Anh. Không bao giờ commit credential.

## Lệch so với spec (phát hiện khi lập plan, có nguồn)

1. **Locale và route chia theo feature bằng `import.meta.glob`** (`src/features/*/locales/{vi,en}.json`, `src/features/*/routes.tsx`). Spec 4.3 ghi một cặp `vi.json/en.json`. Lý do: các gói `work`, `org`, `wizards` chạy song song. Một file locale chung sẽ là điểm xung đột. `src/i18n/locales/` chỉ còn chuỗi chung (shell, nút chung, trạng thái).
2. **Client REST viết đủ một lần ở DS-3** cho mọi endpoint trong BA mục 1 (`src/api/**` thuộc gói `ds`). Feature chỉ dùng. Thiếu endpoint thì mở FX trong gói `ds`, không tự thêm.
3. **`worker.ts` và `manifest.ts` của plugin là điểm nối chung** của PL-1, PL-2, SEC-2 (mỗi ticket thêm dòng đăng ký, capability, route). Ba ticket chạy tuần tự PL-1 → PL-2 → SEC-2. SEC-2 ff `crew/r3` trước khi sửa.
4. **Widget Crew** (`CrewSummary`, `CrewMap`, `DocsCheckPanel`, `MachineCard`, `ReadinessBadge`) nằm ở `src/ds/widgets/crew/` và thuộc DS-4. Spec 4.2 liệt kê chúng là widget nhưng không gán chủ. Lý do: gói `work` và `org` cùng dùng.

## Review Focus

1. **Hai thao tác ghi cùng lúc trên một đối tượng.** Hai tab cùng render lại `AGENTS.md`; hai lần bấm "Chạy tiếp" wizard liền nhau; app nhận cùng một việc hai lần. Mong đợi:
   - `PUT` sai `baseHash` thì báo xung đột, không ghi;
   - mỗi setup run chỉ có một bước đang chạy (khóa `running_step` trong `crew_setup_runs`; lần thứ hai trả 409);
   - `claim` dùng `FOR UPDATE SKIP LOCKED`, một việc chỉ một lần.

   Test: WZ-1 (`instructions.test.ts` ca baseHash), PL-2 (`setup-runs.db.test.ts` ca 409), PL-1 (`machine-jobs.db.test.ts` ca hai claim song song).
2. **Owner bấm thao tác cổng khi trạng thái issue vừa đổi.** Ví dụ: Duyệt trên issue đã chuyển integrator, hoặc Hủy issue đã `done`. Mong đợi: nút chỉ hiện theo `executionState` mới nhất (WS invalidate); server từ chối thì hiện lỗi nguyên văn, không thử lại ngầm, không gửi body override. Test: WK-3 (`gate-actions.test.tsx` ca 409/422 hiện `ErrorState`, ca nút ẩn khi `currentParticipant` không phải user), E2E-3 (`PW-S6-7` kiểm không có activity `crew.policy.board_override`).
3. **Dữ liệu ngoài làm vỡ trang hoặc lộ thông tin.** Gồm: tên/markdown issue có HTML/script, lỗi job có đường dẫn hay credential, bản tin máy thiếu key, project R1 không có dòng vai trò. Mong đợi:
   - markdown render không chạy HTML thô (react-markdown không `rehype-raw`);
   - lỗi job đã làm sạch (I1);
   - thiếu key thì hiện "Không rõ", không trắng trang;
   - project vai trò file vẫn "Sẵn sàng" nếu đủ.

   Test: DS-2 (`markdown-view.test.tsx` ca `<img onerror>`), PL-1 (`sanitizeJobError` ca chuỗi `AKIA…EXAMPLE` và `\x1b`), WZ-1 (`readiness.test.ts` ca vai trò file, ca report thiếu `checkouts`).
4. **Phiên hết hạn hoặc đổi company giữa chừng.** Đổi company khi wizard đang chạy, hoặc 401 giữa một bước wizard. Mong đợi: 401 thì về `/login?next=` và quay lại đúng trang; wizard tiếp tục đúng setup run của company cũ, không ghi chéo sang company mới (mọi lời gọi wizard truyền `companyId` của setup run, không lấy company đang chọn). Test: DS-3 (`http.test.ts` ca 401), WZ-2 (`add-project.test.ts` ca đổi company giữa bước 4 và 5).
5. **Stub lọt sang project thật, hoặc agent tự bật stub để né việc.** Mong đợi: wrapper chỉ chạy stub khi `$PWD` bắt đầu bằng `$HOME/crew-agents/e2e-` **và** có `$(git rev-parse --git-dir)/crew-e2e-stub`; wizard từ chối khóa `e2e-*` ở company khác Crew E2E. Test: MC-1 (`wrapper-stub.test.ts` 4 ca: chỉ tệp, chỉ tiền tố, đủ cả hai, symlink `crew-agents/e2e-x` trỏ sang checkout thật thì `realpath` không có tiền tố → không stub), WZ-2 (ca khóa `e2e-demo` ở TPS).

---

## Gói ngữ cảnh

Luật chia: vẽ gói ngữ cảnh trước rồi cắt ticket trong gói. Mỗi ticket thuộc đúng một gói. Trong một gói, các ticket làm lần lượt; mỗi ticket giao cho một agent mới nạp cùng gói ngữ cảnh, model theo ticket. Chỉ chạy song song giữa các gói khác nhau có file ghi rời nhau.

| Gói | Phạm vi ghi | Nạp chung (mọi ticket của gói) | Phần chi tiết |
|---|---|---|---|
| `ds` | Fork `packages/crew-web/` trừ `src/features/**`, `src/lib/instructions/**`, `test/features/**`, `test/lib/**`, `test/e2e-coverage.test.ts`, `e2e/**`, `playwright.config.ts`; `pnpm-lock.yaml` | Spec §4.1–4.4, 4.10; BA mục 1 S0, S1, S18; fork `ui/package.json`, `ui/src/index.css`, `ui/src/motion-tokens.css`, `ui/src/components/ui/*`, `ui/src/api/client.ts`, `ui/src/i18n/index.ts`, `ui/vite.config.ts`; Interface I5, I6 | [web-ds.md](web-ds.md) |
| `work` | Fork `packages/crew-web/src/features/{dashboard,inbox,issues,runs,search}/**` | Spec §4.9; BA mục 1 S2–S6, S12, S19, mục 2 phần "Issue"; `src/ds/index.ts`, `src/api/**` (chỉ đọc); fork `ui/src/pages/{IssueDetail,Issues,Inbox,Dashboard,AgentDetail}.tsx` (run xem trong AgentDetail) (tham khảo bố cục); Interface I5, I6, I7 | [web-work.md](web-work.md) |
| `org` | Fork `packages/crew-web/src/features/{projects,agents,skills,machines,docs,guide,settings}/**` | BA mục 1 S7, S8, S10, S11, S14–S18, mục 2; `src/ds/index.ts`, `src/api/**`, `src/features/readiness/**` (chỉ đọc); plugin `src/ui/{docs,machines,guide}/*`; Interface I3, I5, I6, I9, I10 | [web-org.md](web-org.md) |
| `wizards` | Fork `packages/crew-web/src/features/{readiness,wizards}/**`, `packages/crew-web/src/lib/instructions/**` | Spec §4.7, 4.8; BA S9, S13; repo Crew `apps/mac-app/src/main/projects/{add-project,folder,instructions,progress}.ts` (chỉ đọc qua `git show r2-2:…`); fork `crew/agents/{render-instructions.mjs,merge-agent-config.mjs,*.md}`; Interface I1, I2, I9, I10 | [wizards.md](wizards.md) |
| `plugin` | Fork `packages/crew-plugin/**` | Plugin `src/{manifest.ts,worker.ts,roles/api.ts,roles/data.ts,shared/db.ts,machines/webhook.ts,attachments/rules.ts}`, `migrations/0004*`, `0005*`, `src/__tests__/roles.db.test.ts`; SDK `packages/plugins/sdk/src/types.ts` (`PluginApiRequestInput`, `ctx.data`); `server/src/routes/plugins.ts:600-700`; Interface I1, I2, I3, I6 | [plugin.md](plugin.md) |
| `mac` | Repo Crew `apps/mac-app/**`, `apps/crew-mac/**`, `docs/flows/{mac-app*,mac-setup,mac-workflows}.md`, `docs/flows.yaml` (khối flow của hai app), `docs/files.md` (sinh), `pnpm-lock.yaml` | `apps/crew-mac/src/{status/report.ts,commands/status.ts,paths.ts,cli.ts}`, `assets/crew-claude-run.sh`; `apps/mac-app/src/main/{app-context.ts,paperclip/client.ts,projects/folder.ts,projects/add-project.ts,ops-bridge.ts}`; Interface I1, I3, I4 | [mac.md](mac.md) |
| `security` | `plans/261010-0020-crew-v3-r3/reports/sec-1-authz.md`; fork `server/src/crew/**`, `server/src/__tests__/crew-*`, `crew/ops/agent-permissions.{sh,test.mjs}`, `crew/release/core-hooks.json` (`description`), plugin `src/security/**` + một dòng `features.ts` + capability `manifest.ts` | BA mục 0 "Phát hiện phụ"; spec §4.11; fork `server/src/routes/{agents,projects,issues,company-skills,environments,secrets,routines,approvals,plugins,access,authz,goals,adapters,execution-workspaces}.ts`, `server/src/services/agent-permissions.ts`, `server/src/crew/{core-hooks,issue-gate,issue-create-policy,agent-config-gate}.ts`; Interface I9 | [security.md](security.md) |
| `ops` | Fork `crew/ops/**` (trừ `agent-permissions.*`); VPS `/opt/crew-v3-spike` qua `crew/ops/*`; Mac mini (`~/.crew`, `/Applications/2P Crew.app`, `~/crew-e2e/`, `~/crew-agents/e2e-*`) | `crew/ops/{overlay-source.sh,overlay-job.sh,inspect-image.sh,deploy.sh,rollback.sh,active-runs.sh,policy-config.py,plugin-state.sh}`; ledger R2-2 dòng DP-1; ledger R2-1 dòng DP-3, CV-1; Interface I3, I8 | [ops.md](ops.md) |
| `e2e` | Fork `packages/crew-web/e2e/**`, `packages/crew-web/playwright.config.ts`; T1 stack tạm (ngoài repo, `~/crew-r3-t1/`) | BA mục 1 toàn bộ (cột Ca PW), mục 4 "Nghiệm thu Playwright"; spec §7; Interface I4, I11 | [e2e.md](e2e.md) |

## Ticket

| ID | Việc | Gói | Nạp gì (thêm vào gói) | Phụ thuộc | Model | Worker / trạng thái |
|---|---|---|---|---|---|---|
| SEC-1 | Truy authz mọi route ghi mà token agent gọi được (đủ nhóm spec §4.11), ra bảng route → dòng kiểm → rủi ro → cách (a)–(e), danh sách ca âm. Chỉ đọc | `security` | `server/src/middleware/auth*.ts`, `server/src/routes/authz.ts` | — | opus | chưa giao |
| DS-1 | Khung `packages/crew-web` (package, Vite, tsconfig alias `@/`, index.html có mốc `crew-ui`), `ds/tokens.css` clone, 23 component clone + `Table`, `Field`, `EmptyState`, `ErrorState`, `Spinner`, đổi tên/logo 2P, trang `/ds` dev, test luật design system | `ds` | `ui/src/components/ui/*`, `ui/index.html`, `ui/public/favicon*` | — | sonnet | chưa giao |
| PL-1 | Migration `0006_machine_jobs.sql`, route `machine-jobs` (tạo, liệt kê, claim, result, retry, cancel), data `crew.machineJobs`, `sanitizeJobError`, kiểm payload theo kind | `plugin` | I1 | — | opus | chưa giao |
| MC-1 | `crew-mac`: `status.json` `targets[]` (gửi bản tin cho từng company), key mới `checkouts`, `superpowers.skills`, `jobsAgent` (đọc `app.json`), wrapper stub + `crew-e2e-stub.sh`, lệnh `crew-mac status add-target` | `mac` | I3, I4; `apps/crew-mac/src/workflows/pin.ts` | — | opus | chưa giao |
| OP-2 | Dựng company **Crew E2E** trên prod (script idempotent `crew/ops/e2e-company.sh`): company, `CREW_POLICY_CONFIG`, secret SSH (đọc file khóa qua stdin), environment mẫu, plugin `instanceConfig.companies` + webhook secret, repo thử và origin bare trên Mac `~/crew-e2e/` | `ops` | `crew/ops/policy-config.py`, `plugin-state.sh`; R2-1 `spike-report.md` S5 | — | opus | chưa giao |
| DS-2 | Widget chung (I5), lớp i18n (`i18n/index.ts` nạp glob, `format.ts`), test i18n (khớp key, quét AST) | `ds` | I5 | DS-1 | sonnet | chưa giao |
| PL-2 | Migration `0007_setup_runs.sql`, route `setup-runs` (khóa bước), data `crew.companies`, `crew.setupRuns`, `crew.skillSync`; webhook `machine-status` nhận key mới (I3) | `plugin` | I2, I3, I6 | PL-1 | opus | chưa giao |
| DS-3 | Shell (sidebar S0.1, switcher S0.2, ngôn ngữ S0.3, palette S0.4, WS S0.5, tài khoản S0.6), router glob, `api/http.ts` + `endpoints.ts` + client đủ BA mục 1 + plugin, đăng nhập S1.1, `/cli-auth/:id` S1.2, guard 401 | `ds` | `ui/src/pages/{Auth,CliAuth}.tsx`, `ui/src/api/{client,auth,access}.ts`, `ui/src/context/LiveUpdatesProvider.tsx` | DS-2, PL-2 (kiểu data) | opus | chưa giao |
| PL-3 | `exports` subpath `@crew/paperclip-plugin/shared/*` (map layout/project, docs tree, machine card format, attachment rules) + test import từ package ngoài | `plugin` | plugin `src/ui/map/{layout,project}.ts`, `src/ui/docs/tree.ts`, `src/ui/machines/index.ts` | PL-2 | sonnet | chưa giao |
| MC-2 | App: bộ nhận việc (`src/main/jobs/**`), 5 executor (I1), lease, làm sạch lỗi, ghi `jobsAgent` vào `app.json`, log | `mac` | I1; `apps/mac-app/src/main/{projects/folder.ts,ops-bridge.ts,app-state.ts}` | MC-1, PL-1 (I1 chốt) | opus | chưa giao |
| SEC-2 | Sửa theo SEC-1: script `agent-permissions.sh` (tắt `canCreateAgents`/`canCreateSkills`, grant `tasks:assign` cho Trợ Lý), cách (b)/(c) cho project do agent tạo và các mục SEC-1 chọn, ca âm | `security` | `reports/sec-1-authz.md` | SEC-1, PL-2 | opus | chưa giao |
| WZ-1 | `lib/instructions` (render port + template `?raw` + `baseHash`), `features/readiness/compute.ts` (A1–A7), hằng cấu hình agent I9, test so với `render-instructions.mjs` | `wizards` | I9, I10 | DS-2 | opus | chưa giao |
| DS-4 | Widget Crew `ds/widgets/crew/` (CrewSummary, CrewMap, DocsCheckPanel, MachineCard, ReadinessBadge) dùng `shared/*` của plugin | `ds` | plugin `src/ui/{summary.tsx,map/*,machines/*,docs/*}` | DS-3, PL-3, WZ-1 (kiểu readiness) | sonnet | chưa giao |
| WK-1 | S4 danh sách yêu cầu (lồng con, lọc, cột giai đoạn), S5 dialog Yêu cầu mới (project sẵn sàng, loại, đính kèm có cảnh báo, assignee = Trợ Lý, lưu nháp) | `work` | `ui/src/components/NewIssueDialog.tsx` | DS-4 | sonnet | chưa giao |
| WK-2 | S6 phần chung: thuộc tính chỉ đọc, bình luận, gửi bình luận, đính kèm, tài liệu, run của issue + dừng run, sửa tiêu đề/mô tả, copy, đã đọc | `work` | `ui/src/pages/IssueDetail.tsx` | WK-1 | sonnet | chưa giao |
| WK-3 | S6 phần Crew: tóm tắt, map, docs check; Duyệt, Yêu cầu sửa, Hủy, Mở lại, thẻ câu hỏi (I7, đọc code server chốt body trước) | `work` | `server/src/services/issue-execution-policy*.ts`, `server/src/routes/issues.ts` (PATCH, interactions), `server/src/crew/issue-gate.ts` | WK-2 | opus | chưa giao |
| WK-4 | S2 Tổng quan, S3 Hộp thư (tab Chờ tôi duyệt), S12 chi tiết run (dừng, chạy lại, tiếp tục), S19 tìm kiếm | `work` | `ui/src/pages/{Dashboard,Inbox,AgentDetail}.tsx` (phần run) | WK-3 | sonnet | chưa giao |
| OR-1 | S7 danh sách project, S8 chi tiết (tab Yêu cầu, Vai trò + sửa + render lại `AGENTS.md` Trợ Lý, Docs, Sẵn sàng, đổi tên) | `org` | `ui/src/pages/{Projects,ProjectDetail}.tsx` | DS-4, WZ-1 | sonnet | chưa giao |
| OR-2 | S10 danh sách agent, S11 chi tiết (tổng quan, Hướng dẫn + render lại, Skills, Cấu hình chạy, đổi model, Run, đổi tên, Làm tiếp) | `org` | `ui/src/pages/{Agents,AgentDetail}.tsx` | OR-1 | sonnet | chưa giao |
| OR-3 | S14 Skills (thêm từ nguồn, chặn trùng Superpowers, bật cho agent, sync), S15 Máy (thẻ, hàng đợi, thử lại), S16 Docs, S18 Cài đặt | `org` | `ui/src/pages/CompanySkills*.tsx` | OR-2, PL-2 | sonnet | chưa giao |
| WZ-2 | Wizard Thêm project S9 (7 bước, chạy tiếp, pause khi lỗi) | `wizards` | `git show r2-2:apps/mac-app/src/main/projects/add-project.ts` | WZ-1, OR-1, PL-2, MC-2 (I1 chốt) | opus | chưa giao |
| WZ-3 | Wizard Tạo agent S13 (6 bước) + lối vào "Làm tiếp" từ S8.5, S11.8 | `wizards` | — | WZ-2, OR-2 | opus | chưa giao |
| E2E-1 | Harness Playwright (I11): đăng nhập form, fixture Crew E2E, `db.ts` (psql qua stdin), `stub.ts`, `coverage.json` + test, `no-dead-controls.spec.ts`; dựng T1 (≤ 90 phút) | `e2e` | fork `tests/e2e/playwright.config.ts` | DS-3, OP-2 | opus | chưa giao |
| E2E-2 | Spec S0, S1, S2, S3, S4, S5, S19, F5 | `e2e` | — | E2E-1, WK-4 | sonnet | chưa giao |
| E2E-3 | Spec S6, S12, F2 | `e2e` | — | E2E-2 | sonnet | chưa giao |
| E2E-4 | Spec S7, S8, S9, S10, S11, S13, F7 | `e2e` | — | E2E-3, WZ-3 | sonnet | chưa giao |
| E2E-5 | Spec S14, S15, S16, S17, S18, F8 | `e2e` | — | E2E-4, OR-4 (văn bản) | sonnet | chưa giao |
| OR-4 | S17 Hướng dẫn VI + EN, mục "Vì sao không có nút X" từ BA mục 2 (`missing-features.ts`); ảnh chụp lại bằng Playwright sau DP-1 | `org` | BA mục 2; plugin `src/ui/guide/huong-dan.md` | OR-3 (văn bản); DP-1 (ảnh) | sonnet | chưa giao |
| OP-1 | `overlay-source.sh` ship `server/ui-dist` (build, mốc `crew-ui`), `overlay-job.sh` kiểm, `inspect-image.sh` in mốc, `check-crew-companies.sh` + test | `ops` | I8 | DS-1 | sonnet | chưa giao |
| RV-1 | Review toàn nhánh `crew/r3` + `r3` theo Review Focus, Global Constraints, Interface; full suite hai repo; AC3–AC6 bản chạy cục bộ | — (Trợ Lý giao) | plan, spec, `git diff crew/r2-2..crew/r3`, `git diff r2-2..r3` | mọi ticket code | opus | chưa giao |
| DP-1 | Deploy fork (plugin 0006–0007, web, sửa quyền), áp `agent-permissions.sh` lên TPS và Crew E2E, tag `crew/v3.3-rc1` | `ops` | ledger R2-2 DP-1 | RV-1 | opus | chưa giao |
| DP-2 | Cài `crew-mac` mới + app 2P Crew mới lên Mac mini (0 run active, giữ bản cũ), `status add-target` Crew E2E, kiểm `jobsAgent`, app đăng nhập lại qua `/cli-auth` UI mới | `ops` | ledger R2-1 CV-1, DP-3 | DP-1 | opus | chưa giao |
| AC-A | T2: chạy Playwright toàn bộ trên prod Crew E2E (stub), AC1–AC8, AC10; lỗi thì mở FX theo gói, DP-3 lại | — (Trợ Lý) | e2e.md mục AC-A | DP-2, E2E-5, OR-4 | opus | chưa giao |
| DP-3 | Deploy lại sau FX/OR-4 (lặp được, mỗi lần một mốc rollback) | `ops` | như DP-1 | FX | sonnet | chưa giao |
| AC-B | T3: R-A (F6 + F1 + skill nạp), R-B (F3 + F4), AC9; push, tag `crew/v3.3` | — (Trợ Lý) | e2e.md mục AC-B | AC-A | opus | chưa giao |

### Đợt chạy

| Đợt | Ticket | Ghi chú |
|---|---|---|
| 0 | SEC-1 ∥ DS-1 ∥ PL-1 ∥ MC-1 ∥ OP-2 | OP-2 ghi prod: backup trước, chỉ tạo bản ghi Crew E2E. PL-1 dùng Postgres nhúng: không chạy cùng lúc với test DB khác |
| 1 | DS-2 → DS-3 (ds) ∥ PL-2 → PL-3 (plugin) ∥ MC-2 (mac) ∥ WZ-1 (wizards) ∥ SEC-2 (security, sau PL-2) ∥ OP-1 (ops) | SEC-2 ff `crew/r3` có PL-2 trước khi sửa `worker.ts` |
| 2 | DS-4 → (WK-1 → WK-2 → WK-3 → WK-4) ∥ (OR-1 → OR-2 → OR-3) ∥ E2E-1 | WK và OR chạy song song sau DS-4 |
| 3 | WZ-2 → WZ-3 ∥ E2E-2 → E2E-3 → E2E-4 ∥ OR-4 (văn bản) | |
| 4 | E2E-5, RV-1, rồi FX nếu có; T1 smoke (E2E-1 dựng được) | FX theo gói của file bị sửa, model như ticket gốc |
| 5 | DP-1 → DP-2 → OR-4 (ảnh) → DP-3 → AC-A → (FX → DP-3)* → **push** | 0 run active khi deploy/cài |
| 6 | AC-B → **push**, tag `crew/v3.3` | Đúng 2 yêu cầu thật |

### Nhánh và worktree

- **Repo Crew** (`~/Documents/projects/crew`):
  - Nhánh tích hợp `r3` rẽ từ `r2-2` @ `a0e8ed8`. R2-2 còn đổi (AC-R2-2) thì Trợ Lý `git merge r2-2` vào `r3`, không rebase.
  - Gói `mac`: nhánh `r3/mac`, worktree `.worktrees/crew-r3-mac`.
- **Fork** (worktree cùng repo fork như R2-2):
  - Nhánh tích hợp `crew/r3` rẽ từ `crew/r2-2` @ `f862b7b20`.

    | Nhánh | Worktree | Gói |
    |---|---|---|
    | `crew/r3-ds` | `.worktrees/paperclip-r3-ds` | `ds` |
    | `crew/r3-work` | `.worktrees/paperclip-r3-work` | `work` |
    | `crew/r3-org` | `.worktrees/paperclip-r3-org` | `org` |
    | `crew/r3-wizards` | `.worktrees/paperclip-r3-wizards` | `wizards` |
    | `crew/r3-plugin` | `.worktrees/paperclip-r3-plugin` | `plugin` |
    | `crew/r3-sec` | `.worktrees/paperclip-r3-sec` | `security` |
    | `crew/r3-ops` | `.worktrees/paperclip-r3-ops` | `ops` |
    | `crew/r3-e2e` | `.worktrees/paperclip-r3-e2e` | `e2e` |
    | `crew/r3` | `.worktrees/paperclip-r3-int` | `verify.sh`, deploy |

  - Mỗi ticket bắt đầu bằng `git merge --ff-only crew/r3` trong worktree của gói. Nếu không ff được thì `git merge crew/r3`, không rebase.
- **Gộp nhánh.** Trợ Lý ff nhánh gói vào nhánh tích hợp sau khi đọc log test. Xung đột `pnpm-lock.yaml` thì chạy lại `pnpm install --lockfile-only` trên `crew/r3`. Xung đột `docs/flows.yaml`/`docs/files.md` thì hợp danh sách rồi chạy lại `crew-docs generate`.
- **Thư mục ngoài repo:** `~/crew-r3-t1/` (stack T1), `~/crew-e2e/` (repo thử + origin bare), `~/crew-r3-app-prev/` (bản app cũ). Ghi vào `processes.md`.

### Sở hữu file

| Ticket | Ghi |
|---|---|
| DS-1 | `packages/crew-web/{package.json,tsconfig.json,vite.config.ts,index.html}`; `src/main.tsx`; `src/ds/{tokens.css,index.ts,README.md}`; `src/ds/components/**`; `src/ds/brand/**`; `src/dev/ds-page.tsx`; `test/guards/design-system.test.ts`; `pnpm-lock.yaml` |
| DS-2 | `src/ds/widgets/*.tsx` (không gồm `crew/`), `src/i18n/{index.ts,format.ts,locales/vi.json,locales/en.json}`, `test/guards/i18n.test.ts`, `test/ds/*.test.tsx` |
| DS-3 | `src/app/**`, `src/api/**`, `test/app/**`, `test/api/**`, `src/i18n/locales/*.json` (thêm key shell) |
| DS-4 | `src/ds/widgets/crew/**`, `test/ds/crew/**`, `src/ds/index.ts` (export) |
| WK-1..WK-4 | `src/features/{issues,dashboard,inbox,runs,search}/**`, `test/features/{issues,dashboard,inbox,runs,search}/**` |
| OR-1..OR-4 | `src/features/{projects,agents,skills,machines,docs,guide,settings}/**`, `test/features/{…}/**` |
| WZ-1..WZ-3 | `src/features/{readiness,wizards}/**`, `src/lib/instructions/**`, `test/features/{readiness,wizards}/**`, `test/lib/instructions/**` |
| PL-1 | Plugin `migrations/0006_machine_jobs.sql`, `src/jobs/{api.ts,data.ts,validate.ts,sanitize.ts}`, `src/__tests__/{machine-jobs.db.test.ts,machine-jobs-validate.test.ts}`, `src/manifest.ts` (route), `src/worker.ts` (định tuyến `onApiRequest` theo `routeKey`) |
| PL-2 | Plugin `migrations/0007_setup_runs.sql`, `src/setup/{api.ts,data.ts}`, `src/companies/data.ts`, `src/machines/webhook.ts` (key mới), `src/__tests__/{setup-runs.db.test.ts,companies.test.ts,webhook.test.ts}`, `manifest.ts`, `worker.ts`, `features.ts` |
| PL-3 | Plugin `package.json` (`exports`), `tsconfig.json` (nếu cần), `src/shared-web/*.ts`, hàm thuần `warnForAttachment` trong `src/attachments/rules.ts`, `src/__tests__/shared-exports.test.ts` |
| SEC-1 | `plans/261010-0020-crew-v3-r3/reports/sec-1-authz.md` |
| SEC-2 | `crew/ops/agent-permissions.{sh,test.mjs}`; `server/src/crew/**`, `server/src/__tests__/crew-*` (nếu chọn (b)); plugin `src/security/**`, 1 dòng `worker.ts`, capability `manifest.ts` (nếu chọn (c)); `crew/release/core-hooks.json` (`description`) |
| MC-1 | `apps/crew-mac/src/status/{report.ts,targets.ts,checkouts.ts,app-state.ts}`, `src/commands/status.ts`, `src/cli.ts` (nhánh `status add-target`), `assets/{crew-claude-run.sh,crew-e2e-stub.sh}`, test `test/{status-targets,status-checkouts,wrapper-stub}.test.ts`, `docs/flows/{mac-setup,mac-workflows}.md` |
| MC-2 | `apps/mac-app/src/main/jobs/**`, 1 dòng `src/main/index.ts` (`registerJobs(ctx)`), `src/main/app-state.ts` (trường `jobsAgent`), test `apps/mac-app/test/jobs/**`, `docs/flows/mac-app-paperclip.md`, khối flow `docs/flows.yaml`, `docs/files.md` |
| OP-1 | `crew/ops/{overlay-source.sh,overlay-job.sh,inspect-image.sh,check-crew-companies.sh,check-crew-companies.test.mjs}`; nếu thiếu lệnh liệt kê: `crew/ops/{policy-config.py,policy-config.test.mjs}` (lệnh con `list-companies`) |
| OP-2 | `crew/ops/{e2e-company.sh,e2e-company.test.mjs}`; bản ghi prod company Crew E2E; `~/crew-e2e/` trên Mac |
| E2E-1..E2E-5 | `packages/crew-web/{playwright.config.ts,e2e/**}`, `packages/crew-web/test/e2e-coverage.test.ts` |
| RV-1, DP-*, AC-* | `sdd-ledger.md`, `processes.md`, `reports/{rv-1,ac-a,ac-b}.md` |

---

## Interface giữa các gói

**I1. Hàng đợi việc trên máy** (PL-1 tạo; MC-2, WZ-2, WZ-3, OR-3 dùng).

```sql
-- packages/crew-plugin/migrations/0006_machine_jobs.sql
CREATE TABLE plugin_crew_core_0433ea20b6.crew_machine_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  machine_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('inspect-folder','prepare-checkouts','agent-workspace','skill-sync','check')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','done','failed','cancelled')),
  result jsonb,
  error_code text,
  error_text text CHECK (error_text IS NULL OR length(error_text) <= 300),
  attempts integer NOT NULL DEFAULT 0,
  setup_run_id uuid,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  lease_until timestamptz,
  finished_at timestamptz
);
CREATE INDEX crew_machine_jobs_queue_idx ON plugin_crew_core_0433ea20b6.crew_machine_jobs (company_id, machine_id, status, created_at);
```

Route (manifest `apiRoutes`, `auth: "board"`, `capability: "api.routes.register"`). Handler kiểm lại `input.actor` là board, giống `roles/api.ts`.

| routeKey | Method + path | companyResolution | Body / query | Trả |
|---|---|---|---|---|
| `jobs.create` | `POST /machine-jobs` | body `companyId` | `{companyId, machineId, kind, payload, setupRunId?}` | 201 `MachineJob` · 400 payload sai |
| `jobs.list` | `GET /machine-jobs` | query `companyId` | `?machineId&status&setupRunId&limit≤100` | 200 `MachineJob[]` mới nhất trước |
| `jobs.claim` | `POST /machine-jobs/claim` | body `companyId` | `{companyId, machineId}` | 200 `MachineJob` · 204 không có việc |
| `jobs.result` | `POST /machine-jobs/:jobId/result` | body `companyId` | `{companyId, machineId, status:'done'\|'failed', result?, errorCode?, errorText?}` | 200 · 409 nếu job không `claimed` hoặc khác máy |
| `jobs.retry` | `POST /machine-jobs/:jobId/retry` | body `companyId` | `{companyId}` | 200 (`failed` → `queued`, `attempts` giữ) · 409 |
| `jobs.cancel` | `POST /machine-jobs/:jobId/cancel` | body `companyId` | `{companyId}` | 200 (`queued`/`claimed` → `cancelled`) · 409 |

- **`claim`:** trong một transaction:
  1. Trả các việc `claimed` có `lease_until < now()` về `queued`, `attempts + 1`. Việc nào có `attempts >= 3` thì thành `failed` với `error_code 'lease_expired'`.
  2. `SELECT … WHERE status='queued' AND company_id=$1 AND machine_id=$2 ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`.
  3. Đặt `claimed`, `claimed_at = now()`, `lease_until = now() + interval '10 minutes'`.
- Data `crew.machineJobs` `{companyId, machineId?, setupRunId?}` → `MachineJob[]` (≤ 100).

```ts
// packages/crew-plugin/src/jobs/types.ts (PL-1); bản chép kiểu ở crew-web src/api/crew/types.ts (DS-3) và apps/mac-app/src/main/jobs/types.ts (MC-2)
export type MachineJobKind = 'inspect-folder' | 'prepare-checkouts' | 'agent-workspace' | 'skill-sync' | 'check';
export type MachineJobStatus = 'queued' | 'claimed' | 'done' | 'failed' | 'cancelled';
export interface MachineJob {
  id: string; companyId: string; machineId: string; kind: MachineJobKind; payload: JobPayload; status: MachineJobStatus;
  result: JobResult | null; errorCode: JobErrorCode | null; errorText: string | null; attempts: number;
  setupRunId: string | null; createdAt: string; claimedAt: string | null; finishedAt: string | null;
}
export type JobPayload =
  | { kind: 'inspect-folder'; folder: string }
  | { kind: 'prepare-checkouts'; projectKey: string; folder: string; roles: { role: CrewRoleSlot; branch: string }[] }
  | { kind: 'agent-workspace'; projectKey: string; folder: string; role: CrewRoleSlot; branch: string }
  | { kind: 'skill-sync'; skillId: string; slug: string; version: string }
  | { kind: 'check'; projectKey: string };
export type CrewRoleSlot = 'assistant' | 'executor' | 'executor-2' | 'reviewer' | 'integrator';
export type JobResult =
  | { kind: 'inspect-folder'; root: string; branch: string | null; remote: string | null; docsBundle: string | null; clean: boolean }
  | { kind: 'prepare-checkouts'; checkouts: { role: CrewRoleSlot; path: string; head: string }[] }
  | { kind: 'agent-workspace'; role: CrewRoleSlot; path: string; head: string }
  | { kind: 'skill-sync'; sha256: string; files: number }
  | { kind: 'check'; items: { id: string; status: 'ok' | 'warn' | 'error'; title: string }[] };
export type JobErrorCode =
  | 'folder_not_git' | 'folder_forbidden' | 'folder_missing' | 'checkout_exists' | 'git_failed'
  | 'skill_fetch_failed' | 'check_failed' | 'lease_expired' | 'app_error';
```

- **Kiểm payload** (`src/jobs/validate.ts`), sai thì 400 kèm câu tiếng Việt cố định:
  - `projectKey` khớp `^[a-z][a-z0-9-]{1,30}$` (cùng `KEY_RE` của app);
  - `folder` là đường tuyệt đối, ≤ 4096 ký tự, không chứa `..`, `\0` hay ký tự điều khiển;
  - `branch` khớp `^[A-Za-z0-9._/-]{1,100}$` và không bắt đầu bằng `-`;
  - `slug` khớp `^[a-z0-9][a-z0-9-]{0,63}$`;
  - `roles` có 4–5 phần tử, không trùng `role`;
  - không có key lạ.

  App kiểm lại lần nữa (MC-2), thêm `forbiddenRootReason`.
- **`sanitizeJobError(text)`:** bỏ ký tự điều khiển (`[\x00-\x1f\x7f]` trừ khoảng trắng); thay mọi chuỗi khớp `SECRET_RULES` của plugin bằng `[ĐÃ CHE]` (plugin chép bảng regex, có test chuỗi `AKIAIOSFODNN7EXAMPLE`); cắt 300 ký tự.
- Nhánh `branch` của checkout: `crew/<projectKey>/<role>` (giống `agentBranch` của app).

**I2. Tiến độ wizard** (PL-2 tạo; WZ-2, WZ-3, WZ-1 (readiness) dùng).

```sql
-- 0007_setup_runs.sql
CREATE TABLE plugin_crew_core_0433ea20b6.crew_setup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('add-project','add-agent')),
  project_key text NOT NULL,
  project_id uuid,
  machine_id uuid NOT NULL,
  input jsonb NOT NULL,
  steps jsonb NOT NULL DEFAULT '{}'::jsonb,       -- { [stepId]: { status, refs, at, error? } }
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','failed','done')),
  running_step text,
  running_since timestamptz,
  created_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crew_setup_runs_active_key_idx ON plugin_crew_core_0433ea20b6.crew_setup_runs (company_id, project_key, kind) WHERE status <> 'done' AND kind = 'add-project';
```

| routeKey | Method + path | Body | Trả |
|---|---|---|---|
| `setup.create` | `POST /setup-runs` | `{companyId, kind, projectKey, machineId, input}` | 201 `SetupRun` · 409 có run `add-project` dở cùng khóa (trả kèm id run đó) |
| `setup.begin` | `POST /setup-runs/:id/steps/:stepId/begin` | `{companyId}` | 200 · 409 `running_step` khác null và `running_since` > now − 5 phút |
| `setup.finish` | `POST /setup-runs/:id/steps/:stepId/finish` | `{companyId, status:'done'\|'failed', refs?, error?, projectId?}` | 200; `failed` → run `failed`; bước cuối `done` → run `done`; xóa `running_step` |
| `setup.get` | `GET /setup-runs/:id` | `?companyId` | 200 `SetupRun` |

Data `crew.setupRuns` `{companyId, kind?, status?, projectId?}` → `SetupRun[]`.

```ts
export type SetupStepId =
  | 'inspect' | 'project' | 'checkouts' | 'environments' | 'agents' | 'roles' | 'check'          // add-project
  | 'agent' | 'pin' | 'environment' | 'workspace' | 'role' | 'assistant-instructions';          // add-agent
export interface SetupStepState { status: 'done' | 'failed'; at: string; refs?: Record<string, string>; error?: string }
export interface SetupRun {
  id: string; companyId: string; kind: 'add-project' | 'add-agent'; projectKey: string; projectId: string | null;
  machineId: string; input: AddProjectInput | AddAgentInput; steps: Partial<Record<SetupStepId, SetupStepState>>;
  status: 'running' | 'failed' | 'done'; runningStep: SetupStepId | null; createdAt: string; updatedAt: string;
}
export interface AddProjectInput { name: string; key: string; folder: string; executors: 1 | 2 }
export interface AddAgentInput { projectId: string; slot: CrewRoleSlot; name: string; model: string }
```

`refs` lưu id tạo ra, ví dụ `{ environment_assistant: "<uuid>", agent_assistant: "<uuid>", instructions_assistant: "<sha256>" }`. Chạy tiếp thì bỏ qua bước `done` và tái dùng `refs`.

**I3. Bản tin máy và đích** (MC-1 tạo; PL-2 nhận; DS-4, WZ-1, OR-3 đọc qua `crew.machines`).

- `~/.crew/status.json` thêm `targets: { url: string; companyId: string; keychainService: string }[]`. `machineId` giữ một giá trị chung cho mọi đích. Cấu hình cũ (`{url, companyId, machineId}`) được đọc như `targets` có một phần tử với service Keychain cũ `crew-mac-status`. `status-repos.json` thêm `companyId` tùy chọn cho mỗi repo để snapshot docs đi đúng company. `crew-mac status` gửi bản tin cho từng đích; một đích lỗi không chặn đích khác.
- Lệnh mới `crew-mac status add-target --company <uuid> --secret-stdin`: đọc secret từ stdin, lưu Keychain service `crew-mac-status-<companyId8>`, thêm đích. Không in secret.
- `MachineReport` (vẫn `version: 1`) thêm key **tùy chọn**:

```ts
checkouts?: { path: string; head: string | null; clean: boolean | null }[];   // thư mục git ~/crew-agents/*/*, tối đa 64, sắp theo path
superpowers: { pinned: string | null; ownerInstalled: string | null; pinDir?: string | null; skills?: string[] };  // skills: tên thư mục skill trong bản ghim, ≤ 100
jobsAgent?: { version: string; lastPollAt: string };                           // từ app.json (MC-2 ghi), thiếu = app không nhận việc
```

- Plugin (PL-2): key tùy chọn sai dạng thì **bỏ riêng key đó**, phần còn lại vẫn lưu (như `app` ở PG-2 R2-1). Giới hạn body webhook nâng từ 16 384 lên 65 536 byte.

**I4. Chế độ stub** (MC-1 tạo; E2E-1 dùng).

- Thêm vào `crew-claude-run.sh`, ngay trước bước `exec` tác nhân, sau `workflow-check` và ghi process group (để H3 và reaper vẫn đúng):

```sh
real_pwd=$(pwd -P)
case "$real_pwd" in
  "$HOME"/crew-agents/e2e-*)
    gitdir=$(git -C "$real_pwd" rev-parse --absolute-git-dir 2>/dev/null || true)
    if [ -n "$gitdir" ] && [ -f "$gitdir/crew-e2e-stub" ]; then
      exec "${CREW_E2E_STUB_BIN:-$HOME/.crew/app/crew-mac/assets/crew-e2e-stub.sh}" "$gitdir/crew-e2e-stub"
    fi
    ;;
esac
```

- `crew-e2e-stub.sh <marker>`: đọc số giây từ dòng đầu của marker (số nguyên 0–900, sai thì 5); `sleep`; in đúng một dòng `{"type":"result","subtype":"success","is_error":false,"result":"crew-e2e-stub","session_id":"crew-e2e-stub","total_cost_usd":0}`; thoát 0. Bị TERM thì thoát 143.
- MC-1 chạy thử với `claude_local` adapter parser: test `wrapper-stub.test.ts` gọi wrapper với `CREW_E2E_STUB_BIN` thật, kiểm stdout parse được bằng hàm parse của adapter (`packages/adapters/claude-local/src/server/parse.ts` bản fork, chép chuỗi mẫu vào fixture).
- E2E (`e2e/support/stub.ts`) bật/tắt marker trực tiếp trên Mac mini (Playwright chạy trên chính máy này): `writeFile(<checkout>/.git/worktrees/<n>/crew-e2e-stub, "<giây>\n")`. Đường git dir lấy bằng `git rev-parse --absolute-git-dir`.

**I5. Bố cục `crew-web`** (DS-1..DS-3 tạo; mọi gói web dùng).

- Alias `@/` → `src/`. Feature chỉ import `@/ds`, `@/api`, `@/i18n`, `@/app/hooks` (`useCompany`, `useMe`, `useLiveEvents`), `@/lib/*`, và module của feature khác qua `index.ts` công khai (chỉ `readiness`, `wizards` mở API cho `projects`, `agents`).
- **Route:** mỗi feature có `src/features/<f>/routes.tsx` export `routes: RouteObject[]` (path tương đối dưới `/:companyPrefix/`, `lazy`). `src/app/router.tsx` gom bằng `import.meta.glob('../features/*/routes.tsx', { eager: true })`. Đường dẫn giữ như stock: `issues`, `issues/:issueRef`, `projects`, `projects/:projectRef`, `agents`, `agents/:agentRef`, `agents/:agentRef/runs/:runId`, `inbox`, `dashboard`, `skills`, `machines`, `docs`, `guide`, `settings`, `search`, `projects/new` (wizard), `agents/new` (wizard). Ngoài company: `/login`, `/cli-auth/:id`, `/ds` (dev).
- **Locale:** `src/features/<f>/locales/{vi,en}.json`, namespace = tên feature; chung ở `src/i18n/locales/{vi,en}.json` namespace `common`. `i18n/index.ts` nạp bằng `import.meta.glob`.
- **Export `@/ds`** (DS-1, DS-2, DS-4): `Button, Input, Textarea, Label, Select, Checkbox, ToggleSwitch, Dialog, AlertDialog, Sheet, Popover, DropdownMenu, Tooltip, Tabs, Badge, Card, Avatar, Separator, Skeleton, ScrollArea, Command, Breadcrumb, Collapsible, Table, Field, EmptyState, ErrorState, Spinner, StatusBadge, StageBadge, IssueRow, RunRow, AgentRow, MarkdownView, Transcript, ConfirmDialog, Wizard, PropertyList, PageHeader, FilterBar, AttachmentPicker, CrewSummary, CrewMap, DocsCheckPanel, MachineCard, ReadinessBadge`.
- **Luật** (`test/guards/design-system.test.ts`, DS-1):
  1. Không `style=` trong `src/{features,app}/**/*.tsx`.
  2. `className` ngoài `src/ds/**` chỉ chứa token trong `LAYOUT_CLASSES` (regex: `^(?:(?:sm|md|lg|xl):)?(?:flex|inline-flex|grid|hidden|block|contents|flex-(?:row|col|wrap|1)|grow|shrink-0|items-\w+|justify-\w+|self-\w+|gap-(?:[0-6]|8)|col-span-\d+|row-span-\d+|grid-cols-\d+|min-w-0|w-full|h-full|truncate|overflow-(?:auto|hidden))$`).
  3. Không import `radix-ui`, `@base-ui/react`, `class-variance-authority`, `lucide-react` (trừ qua `@/ds/icons`) ngoài `src/ds/**`.
- **Mốc build:** `index.html` có `<meta name="crew-ui" content="%CREW_UI_COMMIT%">`. Vite plugin trong `vite.config.ts` thay bằng `process.env.CREW_UI_COMMIT` (bắt buộc khi `mode === 'production'`, regex 40 hex; thiếu thì build lỗi).

**I6. Data và route plugin dùng ở web** (DS-3 viết client trong `src/api/crew/*`).

| Key / route | Có từ | Tham số | Trả |
|---|---|---|---|
| `crew.roots` | R1 | `{companyId}` | danh sách yêu cầu gốc, giai đoạn, `x/y` |
| `crew.map` | R1-4 | `{companyId, issueId}` | nút/cạnh map |
| `crew.docsCheck` | R1-4 | `{companyId, issueId}` | kết quả docs check |
| `crew.machines` | R1-4 | `{companyId}` | `machine_latest` (+ I3) và lịch sử 24 giờ |
| `crew.docs.projects/tree/page/search` | R1-4 | như plugin | docs |
| `roles.get/set/delete` | R2-1 | `/projects/:id/roles` | vai trò |
| `crew.companies` | **PL-2** | `{}` | `{ id: string; name: string }[]` từ `instanceConfig.companies` (lọc company còn tồn tại) |
| `crew.machineJobs`, `jobs.*` | **PL-1** | I1 | I1 |
| `crew.setupRuns`, `setup.*` | **PL-2** | I2 | I2 |
| `crew.skillSync` | **PL-2** | `{companyId}` | `{ skillId, machineId, status, sha256, finishedAt }[]` (việc `skill-sync` mới nhất theo cặp skill/máy) |

**I7. Thao tác cổng** (WK-3). Body chốt sau khi WK-3 đọc code server (bước 1 của WK-3). Bảng dưới là giả thuyết của BA, WK-3 xác nhận hoặc sửa và ghi kết quả vào ledger:

| Nút | Điều kiện hiện (từ `GET /issues/:id`) | Gọi |
|---|---|---|
| Duyệt | `executionState.currentStageType === 'approval'` và `currentParticipant` `{type:'user', userId: me.id}` | `PATCH /api/issues/:id {status:'done', comment}` |
| Yêu cầu sửa | như Duyệt; `comment` bắt buộc ≥ 5 ký tự | `PATCH {status:'in_progress', comment}` |
| Hủy | `status ∉ {done, cancelled}` | `PATCH {status:'cancelled'}` |
| Mở lại | `status ∈ {done, cancelled}` | `PATCH {status:'todo'}` |
| Trả lời câu hỏi | interaction `status === 'pending'` | `POST /api/issues/:id/interactions/:iid/respond {…}` / `accept` / `reject` |

Mọi `PATCH` thao tác cổng **không** gửi `executionPolicy`, `assigneeAgentId`, `assigneeUserId`.

**I8. Ship UI qua overlay** (OP-1).

- `overlay-source.sh`:
  1. Regex `UNKNOWN` thêm `packages/crew-web/`.
  2. Sau khi build plugin: `CREW_UI_COMMIT=$COMMIT corepack pnpm --filter @crew/paperclip-web build`.
  3. `grep -q "name=\"crew-ui\" content=\"$COMMIT\"" packages/crew-web/dist/index.html` (lỗi thì exit 2).
  4. `mkdir -p "$WORK/app/server/ui-dist" && cp -R packages/crew-web/dist/. "$WORK/app/server/ui-dist/"`.
- `overlay-job.sh` Dockerfile thêm `RUN test -s /app/server/ui-dist/index.html && grep -q 'name="crew-ui"' /app/server/ui-dist/index.html`.
- `inspect-image.sh` in `crew-ui=<commit>` lấy từ `server/ui-dist/index.html`. Thiếu thì in `crew-ui=MISSING`.
- `check-crew-companies.sh`: so tập company id trong `CREW_POLICY_CONFIG` (qua `policy-config.py list`) với `instanceConfig.companies` của plugin (qua `plugin-state.sh`). Chỉ in id và `ok`/`lệch: …`, exit 1 khi lệch.

**I9. Cấu hình agent Crew** (WZ-1 khai trong `src/lib/instructions/agent-config.ts`; WZ-2, WZ-3, OR-2 dùng; SEC-2 dùng cùng giá trị quyền).

```ts
export const CREW_WRAPPER_COMMAND = '~/.crew/bin/crew-claude-run';   // WZ-1 Step 1 xác nhận bằng GET agent R1 trên prod; khác thì lấy giá trị prod
export const ROLE_MODELS = { assistant: 'claude-opus-5', executor: 'claude-sonnet-5', reviewer: 'claude-sonnet-5', integrator: 'claude-sonnet-5' } as const;  // cùng app
export function crewExtraArgs(pinDir: string): string[] { return ['--setting-sources', 'project,local', '--plugin-dir', pinDir]; }
export function crewAgentCreateBody(input: { name: string; role: 'assistant' | 'executor' | 'reviewer' | 'integrator'; model: string; pinDir: string; environmentId?: string }): CreateAgentBody;
// CreateAgentBody: { name, adapterType: 'claude_local', adapterConfig: { command: CREW_WRAPPER_COMMAND, extraArgs, model, engine: 'cli', env: {} },
//   runtimeConfig: { heartbeat: { enabled: false } }, maxConcurrentRuns: 1, defaultEnvironmentId?, permissions: { canCreateAgents: false, canCreateSkills: false } }
export const CREW_AGENT_PERMISSIONS = { canCreateAgents: false, canCreateSkills: false } as const;
export const ASSISTANT_GRANTS = ['tasks:assign'] as const;
export function renderInstructions(role: 'assistant' | 'executor' | 'reviewer' | 'integrator', vars: { projectName: string; executors: { name: string; id: string }[] }): string;
export async function putInstructions(api: Api, agentId: string, content: string): Promise<{ ok: true; hash: string } | { ok: false; conflict: true }>;
```

Tên trường chính xác (`runtimeConfig.heartbeat`, `maxConcurrentRuns` nằm ở đâu) theo `createAgentSchema` của `packages/shared`. WZ-1 Step 1 đọc schema và agent `tro-ly` thật trên prod, rồi sửa khối này cho khớp trước khi viết code. WZ-1 ghi bản chốt vào ledger.

**I10. Readiness** (WZ-1).

```ts
export type AgentCheckId = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7';
export interface AgentReadiness { agentId: string; state: 'ready' | 'paused' | 'not_ready' | 'terminated'; failed: { id: AgentCheckId; resume: ResumeTarget }[] }
export interface ProjectReadiness { projectId: string; state: 'ready' | 'not_ready' | 'untracked'; failed: { id: 'P1' | 'P2'; detail: string }[]; agents: AgentReadiness[] }
export type ResumeTarget = { wizard: 'add-agent'; step: SetupStepId; agentId: string } | { wizard: 'add-project'; setupRunId: string } | { none: true };
export function computeAgentReadiness(input: { agent: Agent; environment: Environment | null; report: MachineReport | null; roleOf: string | null; setupRun: SetupRun | null }): AgentReadiness;
export function computeProjectReadiness(input: { project: Project; roles: ProjectRoles | null; fileRoles: boolean; agents: AgentReadiness[] }): ProjectReadiness;
export function useProjectReadiness(companyId: string): UseQueryResult<ProjectReadiness[]>;   // ghép REST + plugin
```

**I11. Harness E2E** (E2E-1).

- Biến môi trường:
  - `CREW_E2E_BASE_URL` (mặc định `https://crew.2p-solutions.com`; T1 là `http://127.0.0.1:5183`);
  - `CREW_E2E_EMAIL`;
  - `CREW_E2E_PASSWORD` (chỉ nạp qua `e2e/support/run-e2e.sh`: `ssh nhamoiplatform 'cat /opt/crew-v3-spike/.env' | sed -n 's/^PAPERCLIP_BOARD_PASSWORD=//p'` vào biến, không echo; tên biến thật do E2E-1 Step 1 xác nhận trong `.env` bằng `cut -d= -f1`);
  - `CREW_E2E_COMPANY_ID`.
- Helper: `login(page)` (form), `api(request)` (dùng storage state của lần đăng nhập form), `db.query(sql, params)` (gửi SQL qua stdin tới `ssh nhamoiplatform /opt/crew-v3-spike/ops/api.sh psql`, chỉ `SELECT`), `stub.on(projectKey, role, seconds)`, `stub.off(...)`, `agentToken(agentId)` (tạo API key agent tạm cho ca âm, xóa sau ca), `cleanup` (cancel issue tạo trong ca).
- `e2e/coverage.json`: `{ "<mã BA>": { "spec": "e2e/specs/s6-issue.spec.ts", "tests": ["PW-S6-7 duyệt …"], "tier": "T2" | "T3", "skip"?: "<lý do>" } }`. `test/e2e-coverage.test.ts` (Vitest) đọc BA mã từ `e2e/ba-ids.json` (E2E-1 trích một lần từ BA mục 1, đã đổi theo spec §5) và đỏ khi thiếu.

---

## Nghiệm thu

Tiêu chí đo được AC1–AC10 ở spec §7. Thủ tục chi tiết của AC-A và AC-B ở [e2e.md](e2e.md). Bằng chứng (lệnh, đầu ra rút gọn, giờ theo `date`) ghi vào [sdd-ledger.md](sdd-ledger.md) và `reports/ac-{a,b}.md`.

- [ ] **AC-A (T2, 0 quota):** AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC10 đạt → push `r3`, `crew/r3`.
- [ ] **AC-B (T3, ≤ 20 run):** AC9 đạt → push, tag `crew/v3.3` trên commit đã deploy.
- [ ] **Dọn:** issue thử cancel; marker stub tắt; `processes.md` không còn dòng "đang chạy"; stack T1 tắt; Crew E2E giữ lại (dùng cho R sau), agent E2E `paused`.

## Self-review

Trợ Lý tự review 10/10/2026 sau khi viết plan và các file chi tiết.

- **Phủ spec:**
  - §1.1–1.2 → toàn bộ gói `work`, `org`, AC5.
  - §1.3, §4.2 → DS-1, DS-2, DS-4, AC3.
  - §1.4, §4.3 → DS-2, OR-4, AC4.
  - §1.5, §4.7, §4.8 → WZ-1..WZ-3, PL-1, PL-2, MC-2.
  - §1.6, §4.11 → SEC-1, SEC-2, AC7.
  - §1.7 → Global Constraints, AC6.
  - §4.4 → DS-3, PL-2 (`crew.companies`), OP-1 (`check-crew-companies.sh`).
  - §4.5 → PL-1..PL-3.
  - §4.6 → I1, PL-1, MC-2.
  - §4.9 → WK-3, I7.
  - §4.10 → OP-1, DP-1, DP-2.
  - §5 ý 1 → WZ-2 bước 1 (`inspect-folder`); ý 2 → WZ-1; ý 3 → PL-2, OP-1; ý 4 → MC-1, I3; ý 5 → MC-1, I4, E2E-1; ý 6 → SEC-2, I9; ý 7 → giữ route R2-1.
  - §7 → E2E-1..E2E-5, AC-A, AC-B.
  - §12 → bảng "Giả định chờ owner" ở dưới.
- **Mỗi ticket một gói:** cột "Gói" có đúng một giá trị.
  - Bảng "Sở hữu file" không có file nào bị hai gói ghi, trừ các điểm nối chung đã khai ở mục Lệch 3. Chúng chạy tuần tự: plugin `worker.ts`/`manifest.ts` do PL-1 → PL-2 → SEC-2 sửa.
  - `src/ds/index.ts` do DS-1 → DS-2 → DS-4 sửa (cùng gói).
  - `src/i18n/locales/*.json` do DS-2 → DS-3 sửa (cùng gói).
- **Placeholder:** đã quét `TBD`, `TODO`, `implement later`, `similar to task` trên plan và các file chi tiết: không có. Ba giá trị chỉ chốt được khi đọc code/prod đều có bước xác nhận rõ:
  - I7 body thao tác cổng (WK-3 Step 1);
  - I9 tên trường `createAgentSchema` và `CREW_WRAPPER_COMMAND` (WZ-1 Step 1);
  - tên biến mật khẩu board trong `.env` (E2E-1 Step 1).
- **Nhất quán interface:** đã đối chiếu tên giữa plan và các file chi tiết:
  - plugin: `MachineJob`, `MachineJobKind`, `JobPayload`, `JobResult`, `JobErrorCode`, `sanitizeJobError`, `SetupRun`, `SetupStepId`, `AddProjectInput`, `AddAgentInput`, `CrewRoleSlot`;
  - readiness và cấu hình agent: `computeAgentReadiness`, `computeProjectReadiness`, `crewAgentCreateBody`, `renderInstructions`, `putInstructions`, `CREW_AGENT_PERMISSIONS`, `ASSISTANT_GRANTS`;
  - data plugin: `crew.companies`, `crew.machineJobs`, `crew.setupRuns`, `crew.skillSync`;
  - Mac: `crew-mac status add-target`, `crew-e2e-stub.sh`, `checkouts`, `jobsAgent`;
  - build: mốc `crew-ui`.
- **Review Focus:** 1 → WZ-1, PL-2, PL-1; 2 → WK-3, E2E-3; 3 → DS-2, PL-1, WZ-1; 4 → DS-3, WZ-2; 5 → MC-1, WZ-2.

## Giả định chờ owner

Owner vắng tới sáng 10/10 và dặn chạy liên tục, không hỏi. Cả 8 câu ở BA mục 5 đang tạm theo phương án BA khuyên. Bảng đầy đủ (câu hỏi, đang theo, đổi ở đâu nếu bác) ở spec §12. Tóm tắt nơi đổi trong plan:

| # | Tạm theo | Owner bác thì đổi |
|---|---|---|
| Q1 | Thay UI ở `crew.2p-solutions.com` qua `server/ui-dist` | Thêm ticket `OP-3` nginx subdomain cho UI stock (gói `ops`, opus); OP-1 giữ nguyên |
| Q2 | App 2P Crew nhận việc | MC-2 chuyển sang `apps/crew-mac/src/jobs/**` + LaunchAgent; thêm board key cho CLI (Keychain); I1 giữ nguyên |
| Q3 | Không nút vượt cổng | WK-3 thêm nút "Ép xong" (xác nhận hai bước) + ca PW; I7 thêm dòng |
| Q4 | Hướng dẫn có EN | OR-4 bỏ `en`, `guide` được miễn trong `i18n.test.ts` |
| Q5 | Chỉ company trong cấu hình; ẩn CREA; Crew E2E; không tạo company | DS-3 (switcher), OP-2, PL-2 (`crew.companies`) |
| Q6 | Chặn skill trùng Superpowers; Skills chỉ list/thêm/bật/sync | OR-3 (bỏ chặn hoặc mở rộng), PL-2/MC-1 (`superpowers.skills`) |
| Q7 | Không gỡ trên web | Thêm WZ-4 "Gỡ" + kind `remove-checkouts` vào I1 (PL-1 FX, MC-2 FX) |
| Q8 | Token Paperclip, đổi tên/logo 2P | DS-1 `tokens.css`, `src/ds/brand/**` |

Trợ Lý còn tự chốt các ý ở spec §5 (gõ folder thay cho danh sách repo, readiness tính ở web, company lấy từ cấu hình plugin, bản tin nhiều đích, stub, grant `tasks:assign`). Owner bác ý nào thì sửa ticket tương ứng ở dòng Self-review "Phủ spec §5".
