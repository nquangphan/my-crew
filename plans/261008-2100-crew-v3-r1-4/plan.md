---
title: "Crew v3 R1-4 — UI Crew trong Paperclip"
description: "Plugin crew.core có UI: map yêu cầu và issue con (dependency, vòng sửa, stage), trạng thái docs và cây docs của repo, trạng thái máy do Mac tự gửi mỗi phút."
status: done
priority: P1
effort: 6d
branch: v3
tags: [crew-v3, paperclip, plugin-ui, docs, machine-status, crew-mac]
created: 2026-10-08
---

# Crew v3 R1-4 — UI Crew trong Paperclip — Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner mở một issue gốc trên web Paperclip và thấy tab **Crew**. Tab này có map yêu cầu (issue gốc, issue con, dependency, vòng sửa, stage hiện tại) và kết quả kiểm docs của integrator. Trang **Crew** liệt kê mọi yêu cầu đang chạy, cùng trạng thái từng Mac và cây docs của từng repo, đọc được trên web. Widget dashboard cho thấy máy nào đang online, tải bao nhiêu và có hộp thoại TCC nào đang chờ không.

**Architecture:**
- Toàn bộ UI là UI extension của plugin `crew.core` (gói `packages/crew-plugin` trong fork), không sửa UI lõi. Plugin dùng các slot `detailTab` (entity `issue`), `page` (`routePath: crew`) và `dashboardWidget`, khai trong manifest.
- UI gọi worker qua `usePluginData`/`usePluginAction`. Worker đọc Paperclip bằng SDK: `ctx.issues.get`/`getSubtree`/`relations`/`listComments`, và `ctx.db.query` trên bảng lõi được đọc (`issues`, `issue_relations`, `issue_comments`, `heartbeat_runs`, `agents`, `projects`).
- Trạng thái máy và cây docs **do Mac đẩy lên**. Job launchd mới của `crew-mac` mỗi 60 giây POST một bản tin có chữ ký HMAC tới webhook `machine-status` của plugin. Khi commit mặc định của repo đổi, job POST thêm ảnh chụp docs tới webhook `docs-snapshot`.
- Plugin lưu vào bảng của chính nó (migration namespace plugin, không migration lõi).
- **Không thêm hook lõi.** Giữ 5/5.

**Tech Stack:** Paperclip fork nhánh `v3` (`d457ddbfd`), React 19 + `@paperclipai/plugin-sdk/ui`, esbuild (ESM, React external), `@xyflow/react` (bundle vào UI plugin), vitest + embedded PostgreSQL, `crew-mac` (repo Crew `apps/crew-mac`, `node --test`), launchd, server spike `crew-v3-spike`, Playwright cho cổng trình duyệt.

**Spec:** [stock-first](../261006-0805-crew-v3-stock-first/plan.md) mục R1-4 và "Tận dụng v2", [R1-3](../261008-0850-crew-v3-r1-3/plan.md), [PLUGIN_SPEC](../../.worktrees/paperclip-v3/doc/plugins/PLUGIN_SPEC.md) §18 (webhook), §19 (UI). Nguồn port v2: `/Volumes/CORSAIR/Projects/my-crew-v2/v2/web/src/{graph,docs,contracts}`. Quyết định và ruling: [sdd-ledger.md](sdd-ledger.md).

## Quyết định của owner (08/10/2026, 21:05)

- **O20:** trạng thái máy do Mac tự gửi mỗi 60 giây qua webhook có chữ ký. Quá 180 giây không có bản tin thì UI báo "mất liên lạc".
- **O21:** làm đủ ba chỗ: tab "Crew" trong chi tiết issue, trang "Crew", và widget dashboard.
- **O22:** trạng thái docs có cả hai phần:
  - kết quả `crew-docs-check` theo yêu cầu;
  - **cây docs của repo**, port trang docs v2: duyệt cây, đọc trang, trạng thái link nội bộ, tìm kiếm.

  Docs kéo từ Mac lên server.

## Global Constraints

Kế thừa nguyên văn mục Global Constraints của R1-3, trừ các dòng sau:

- (thay) **Không thêm hook lõi.** Ngân sách vẫn 5/5, R1-4 dùng 0. Không sửa `ui/**` lõi hay `server/src/**` ngoài `server/src/crew/**`. Nếu việc nào buộc phải sửa lõi thì dừng, ghi lý do vào ledger và hỏi owner.
- (thay) Bảng mới chỉ được tạo trong **namespace của plugin**, qua `database.migrationsDir` của manifest. Không migration lõi. Paperclip vẫn là nguồn trạng thái issue. Bảng plugin chỉ giữ thứ Paperclip không có: bản tin máy và ảnh chụp docs.
- (mới) Webhook stock `/api/plugins/crew.core/webhooks/<key>` công khai, nên mọi bản tin phải qua kiểm HMAC-SHA256. Không có chữ ký, sai chữ ký, lệch giờ quá 300 giây, quá giới hạn, `companyId` không có trong cấu hình, `machineId` không phải UUID hay `projectId` không thuộc company thì handler ném lỗi: host trả **502** và ghi `plugin_webhook_deliveries` trạng thái `failed`, DB namespace plugin không đổi. Host chỉ trả 200 hoặc 502, plugin không đặt được mã khác. Chế độ `auth: "webhook"` của `apiRoutes` bị lõi tắt. Secret lấy từ secret ref của company qua cấu hình plugin. Phía Mac giữ secret trong Keychain (`security`), không ghi file thường, không in ra log.
- (mới) Bản tin máy không được chứa credential, nội dung env, token hay đường dẫn tới file bí mật. Ảnh chụp docs chỉ gồm file dưới `docs/` đã qua secret-scan của docs-kit (`secret-scan.ts`). File bị bắt thì bỏ khỏi ảnh chụp và ghi cảnh báo.
- (mới) Giới hạn: bản tin máy ≤ 16 KB, ảnh chụp docs ≤ 5 MB. Plugin giữ 1 bản tin mới nhất cho mỗi máy, cộng lịch sử 24 giờ để vẽ tải. Docs chỉ giữ ảnh chụp mới nhất cho mỗi repo.
- (mới) UI tiếng Việt, giờ `Asia/Ho_Chi_Minh`, dùng component và token màu của host (`usePluginHostComponents`). Không làm lại board, list hay dialog stock.
- Repo Crew đổi nguồn (`apps/crew-mac`), nên R2/R3 của docs áp dụng: sửa `docs/flows/<id>.md` của flow `crew-mac`, file mới vào `docs/flows.yaml`, chạy `crew-docs check --staged`.
- Codex chạy full access (luật owner), brief luôn ghi phạm vi worktree. Việc nhỏ mở phiên mới thay vì `resume`. Trước test có embedded Postgres thì kiểm `ipcs -m`.

## Review Focus

1. **Webhook:** chữ ký sai hoặc thiếu, timestamp cũ, body quá giới hạn, `companyId` lạ, `machineId` sai định dạng, `projectId` không thuộc company đều làm handler ném lỗi (host 502, delivery `failed`) và DB plugin không đổi. Bản tin hợp lệ thì ghi đúng một dòng. Test: UI-4, UI-3.
2. **Không lộ bí mật:** bản tin máy không có env, token hay đường dẫn Keychain. Ảnh chụp docs bỏ file dính secret-scan. Test: MC-1, MC-2.
3. **Map đúng dữ liệu thật:**
   - Cạnh `parent` lấy từ `parentId`.
   - Cạnh `dependency` lấy từ `issue_relations` loại `blocks`.
   - Cạnh `repair` nối issue con với các issue `crew-fix` integrator tạo, hoặc với vòng sửa reviewer, theo cùng nguồn `issue-gate.ts` dùng để đếm `maxReviewRounds`.
   - Stage hiện tại lấy từ `executionState`, không suy từ `status`.

   Test dựng đúng hình dạng DB của CRE-36 và CRE-44 (AC-3). Test: UI-1, UI-2.
4. **Docs check hiện đúng commit:** dòng `crew-docs-check commit=… range=… exit=…` mới nhất trên issue gốc. Có nhiều lần thì lấy lần mới nhất. Test: UI-3.
5. **UI không làm hỏng trang host:** lỗi dữ liệu thì hiện trạng thái lỗi trong tab, không ném lên trang. Bundle UI ≤ 1.5 MB gzip. Test: UI-2, AC-4 Cổng 3.

---

## Gói ngữ cảnh và ticket

| Gói | Nạp gì | Model Codex |
|---|---|---|
| `plugin` | Fork `packages/crew-plugin/**`; `packages/plugins/sdk/src/{types.ts,ui/hooks.ts,ui/components.ts}`; `packages/shared/src/validators/plugin.ts` (slot, webhook, database); `packages/shared/src/constants.ts` (`PLUGIN_UI_SLOT_TYPES`, `PLUGIN_CAPABILITIES`, `PLUGIN_DATABASE_CORE_READ_TABLES`); ví dụ `packages/plugins/examples/plugin-kitchen-sink-example/**`, `packages/plugins/plugin-llm-wiki/src/manifest.ts` (database); `server/src/routes/plugins.ts` (webhook l.2692); `doc/plugins/PLUGIN_SPEC.md` §18–19; `crew/ops/{overlay-source.sh,overlay-job.sh,inspect-image.sh}` | sol · high |
| `map` | Gói `plugin` cộng: v2 `web/src/graph/**` (`layout.ts`, `project.ts`, `ticket-map.tsx`, `ticket-node.tsx`, `ticket-edge.tsx`); fork `server/src/crew/{issue-gate.ts,issue-policy.ts}` (đọc, không sửa); `crew/agents/{integrator,reviewer}.md` (marker `crew-fix`, `crew-review`) | sol · high |
| `docs` | Gói `plugin` cộng: v2 `web/src/docs/**`, `web/src/contracts/docs.ts`; repo Crew `packages/docs-kit/src/{tree.ts,secret-scan.ts,manifest.ts,commands/check.ts}` | sol · medium |
| `machines` | Gói `plugin` cộng: v2 `web/src/contracts/machines.ts`; fork `server/src/crew/load-gate.ts` (activity `crew.load_gate.*`, đọc) | sol · medium |
| `mac` | Repo Crew `apps/crew-mac/**` (`commands/doctor.ts`, `reaper/**`, `plist.ts`, `launchctl.ts`, `system.ts`, `cli.ts`); `packages/docs-kit/src/{tree.ts,secret-scan.ts}`; `docs/flows.yaml` mục crew-mac | sol · medium |

| ID | Việc | Gói | Phụ thuộc | Model |
|---|---|---|---|---|
| UI-1 | Khung UI plugin. Gồm: manifest (`entrypoints.ui`, slot `detailTab` với tab danh sách nút thật, 2 webhook, `database.migrationsDir`, `coreReadTables`, capabilities); `build.mjs` thêm bundle UI; `src/features.ts` đăng ký feature; data handler `crew.map` (dữ liệu map của một issue gốc theo interface dưới) có test DB; overlay và `inspect-image.sh` gồm `dist/ui` | `plugin` | — | sol · high |
| UI-2 | Port map v2: `src/ui/map/**` (layout/project thuần + component xyflow); tab "Crew" trong issue hiện map và panel docs-check; trang "Crew" liệt kê issue gốc đang mở (data handler `crew.roots`); test layout thuần + test component | `map` | UI-1 | sol · high |
| UI-3 | Docs: migration bảng `docs_snapshots`/`docs_pages`; webhook `docs-snapshot` (HMAC, giới hạn, thay ảnh chụp cũ theo repo); data `crew.docsCheck`, `crew.docs.tree`, `crew.docs.page`, `crew.docs.search`; UI port `space`/`page`/`links`/`search` của v2 vào trang "Crew" (mục Docs) và panel docs-check trong tab | `docs` | UI-1 | sol · medium |
| UI-4 | Máy: migration `machine_reports`; webhook `machine-status` (HMAC, giới hạn, giữ 24 giờ); data `crew.machines`; widget dashboard + mục Máy của trang "Crew" (online/offline sau 180 giây, tải 24 giờ, TCC đang chờ, Claude, Superpowers) | `machines` | UI-1 | sol · medium |
| MC-1 | `crew-mac status`: thu bản tin máy (tái dùng các probe của `doctor`), ký HMAC, POST; `crew-mac setup` cài plist launchd `com.2p.crew-mac-status` chạy mỗi 60 giây; secret trong Keychain (`crew-mac status set-secret` đọc stdin); `doctor` kiểm job | `mac` | — | sol · medium |
| MC-2 | Ảnh chụp docs: `crew-mac status` đọc danh sách repo (`~/.crew/status-repos.json`, lệnh `crew-mac status add-repo <projectId> <path>`), commit `origin/HEAD` đổi thì dựng ảnh chụp `docs/**` tại commit đó (đọc qua git, không đụng working tree), chạy secret-scan, chạy `crew-docs check --all` tại commit đó để có `auditState`, rồi POST | `mac` | MC-1 | sol · medium |
| RV-1 | Review toàn nhánh (fork `crew/r1-4` + repo Crew nhánh `r1-4-mac`) theo Review Focus | — | UI-2, UI-3, UI-4, MC-2 | astra · high |
| AC-4 | Nghiệm thu (cổng 1–5) trên spike + Mac mini | Trợ Lý | RV-1 | astra · high |

**Song song được:**
- Đợt 1: UI-1 và MC-1 chạy song song, hai repo khác nhau.
- Đợt 2: UI-2, UI-3, UI-4 song song trên ba worktree fork, cùng với MC-2 trên repo Crew.
- Sau đó gộp vào `crew/r1-4`, rồi RV-1, rồi AC-4.
- Mac mini dùng chung với owner, nên chỉ một test có embedded Postgres hay một build image chạy tại một thời điểm.

**Sở hữu file:**

| Ticket | Ghi |
|---|---|
| UI-1 | `packages/crew-plugin/{package.json,build.mjs,tsconfig.json}`, `src/{manifest.ts,worker.ts,features.ts}`, `src/handlers/map.ts`, `src/shared/**` (kiểu dùng chung, parser marker), `src/__tests__/map.data.test.ts`, `crew/ops/{overlay-source.sh,overlay-job.sh,inspect-image.sh}` |
| UI-2 | `src/ui/{index.tsx,map/**,tab.tsx,page.tsx}`, `src/handlers/roots.ts`, test `src/ui/map/*.test.ts(x)`; một dòng trong `src/features.ts` |
| UI-3 | `src/docs/**` (webhook, data, migration `migrations/0001_docs.sql`), `src/ui/docs/**`, test tương ứng; một dòng `features.ts`; xuất `DocsCheckPanel` cho `tab.tsx` qua `src/ui/docs/index.ts` |
| UI-4 | `src/machines/**` (webhook, data, migration `migrations/0002_machines.sql`), `src/ui/machines/**`, test tương ứng; một dòng `features.ts`; xuất `MachinesSection`, `MachinesWidget` |
| MC-1, MC-2 | repo Crew `apps/crew-mac/src/{commands/status.ts,status/**}`, sửa `cli.ts`, `commands/setup.ts`, `commands/doctor.ts`, `plist.ts`; test `apps/crew-mac/src/**/*.test.ts`; `docs/flows.yaml` (flow crew-mac), `docs/flows/<crew-mac>.md` |

Slot `page` do UI-2 thêm vào manifest, slot `dashboardWidget` do UI-4 thêm, mỗi ticket đúng một mục. `tab.tsx` và `page.tsx` thuộc UI-2. UI-3 và UI-4 chỉ xuất component, UI-2 nhúng chúng vào theo tên trong interface. Khi gộp, Trợ Lý nối dòng `features.ts`.

**Worktree:**
- Fork: `.worktrees/paperclip-r14-plugin` (`crew/r14-plugin`, UI-1, sau đó UI-2), `.worktrees/paperclip-r14-docs` (`crew/r14-docs`), `.worktrees/paperclip-r14-machines` (`crew/r14-machines`). UI-3 và UI-4 rẽ nhánh từ `crew/r14-plugin` sau khi UI-1 được nghiệm thu.
- Repo Crew: `.worktrees/crew-r14-mac` (`r1-4-mac` từ `v3`).
- Gộp vào `crew/r1-4` trước RV-1.

## Interface giữa các gói

- **Webhook** (UI-3/UI-4 nhận, MC-1/MC-2 gửi):
  - URL: `POST {PAPERCLIP_PUBLIC_URL}/api/plugins/crew.core/webhooks/<machine-status|docs-snapshot>`.
  - Header: `X-Crew-Timestamp: <unix giây>`, `X-Crew-Signature: sha256=<hex>`, `Content-Type: application/json`.
  - Chữ ký: `HMAC_SHA256(secret, "<timestamp>.<raw body>")`.
  - Hàm dùng chung `verifyCrewSignature(rawBody: string, headers, secret, nowSec): "ok" | "missing" | "bad" | "stale"` trong `src/shared/signature.ts` (UI-1 viết). Phía Mac có hàm ký tương ứng `signCrewBody(body, secret, nowSec)` trong `apps/crew-mac/src/status/sign.ts`.
  - Cùng vector test: secret `test-secret`, ts `1760000000`, body `{"a":1}`. Hex mong đợi ghi trong test của cả hai bên, tính một lần bằng `node:crypto`.
- **Company và secret:** bản tin có trường `companyId`. Cấu hình plugin (`instanceConfigSchema`) có `companies: [{companyId, webhookSecretRef}]`, trong đó `webhookSecretRef` là `format: "secret-ref"`. Plugin tìm mục theo `companyId` của bản tin, gọi `ctx.secrets.resolve(webhookSecretRef, {companyId})` và không cache giá trị. Không có mục thì từ chối. Phía Mac đọc secret bằng `security find-generic-password -s crew-mac-status -w`.
- **Bản tin máy** (`machine-status`, version 1):

  ```json
  {"version":1,"companyId":"<uuid>","machineId":"<uuid crew-mac sinh lúc setup>","hostname":"…","sentAt":"<ISO>","load1":2.2,"cpuCount":10,"memFreePct":52,"tccPending":[{"service":"kTCCServiceSystemPolicyAppData","client":"<path>","since":"<ISO>"}],"claude":{"version":"2.1.294","loggedIn":true,"plan":"max"},"superpowers":{"pinned":"6.4.1","ownerInstalled":"6.4.1"},"checks":[{"id":"…","status":"ok|warn|error","title":"…"}]}
  ```

  Mảng `checks` dùng đúng id/status của `doctor`. Chỉ có tiêu đề, không có `detail` hay `hint` (có thể chứa đường dẫn).
- **Ảnh chụp docs** (`docs-snapshot`, version 1):

  ```json
  {"version":1,"companyId":"<uuid>","machineId":"…","projectId":"<uuid project Paperclip>","repo":"<tên thư mục>","commit":"<sha40>","auditState":"verified|invalid|unverified","checkExit":0,"pages":[{"path":"docs/…","title":"…","parentPath":null,"text":"…","sha256":"…"}],"links":[{"fromPath":"…","occurrence":1,"originalHref":"…","toPath":"…","fragment":null,"status":"ok|missing|external|unverified"}],"dropped":[{"path":"…","reason":"secret-scan"}]}
  ```

  `auditState`: `verified` khi `checkExit` 0, `invalid` khi 1, `unverified` khi 2 hoặc 3.
- **Bổ sung hợp đồng sau review toàn nhánh (08/10 22:05):**
  - **Cây docs:** `parentPath` là **thư mục cha** của file (`docs/guide/ok.md` → `docs/guide`; file ngay dưới `docs/` → `docs`). Webhook không đòi thư mục cha là một trang. UI tự dựng nút thư mục từ đường dẫn. Mac chỉ gửi blob file thường (`100644`/`100755`), bỏ symlink và submodule. Mac secret-scan cả metadata sẽ gửi (đường dẫn, title, tên repo). Metadata trúng scan thì cả file bị bỏ, và trong `dropped` chỉ ghi `{"path":"<đã che>","reason":"secret-scan-metadata"}`.
  - **Bản tin máy khi probe hỏng:** các trường sau được phép `null` nghĩa là "không đọc được": `load1`, `cpuCount`, `memFreePct`, `claude.version`, `claude.loggedIn`, `claude.plan`, `superpowers.pinned`, `superpowers.ownerInstalled`. `tccPending` và `checks` luôn là mảng. Server chặn giới hạn trước DB:
    - `load1`: 0–1000;
    - `cpuCount`: 1–1024;
    - `memFreePct`: 0–100;
    - chuỗi: ≤ 200 ký tự, không có ký tự NUL.

    Mac gửi bản tin máy và ảnh chụp docs **độc lập**: một bên lỗi không chặn bên kia. Job launchd gọi `claude` bằng đường dẫn tuyệt đối đã resolve lúc setup. Plist không đặt secret.
  - **Máy:** bảng `machine_latest` giữ bản tin mới nhất theo `(company_id, machine_id)` và không bao giờ bị dọn theo tuổi. Lịch sử 24 giờ nằm ở bảng riêng, chỉ dọn theo `company_id` của bản tin vừa nhận.
  - **Docs-check trên UI:** chọn đúng như `issue-gate`. Nguồn là comment mới nhất mang marker `crew-docs-check` của participant thuộc stage docs (integrator). Marker mới nhất sai định dạng thì báo "bằng chứng không hợp lệ", không lùi về marker cũ. Hiện tác giả.
  - **Issue gốc Crew:** nhận diện bằng **đúng cấu trúc template** của `server/src/crew/issue-policy.ts`: code là `review(agent) → review(agent) → approval(user) → review(agent)`, research là `review(agent) → approval(user)`, cả hai có `maxReviewRounds` 5. Tên stage hiển thị theo vị trí trong template:
    - code: "Reviewer", "Integrator · merge + docs", "Owner duyệt", "Integrator · push";
    - research: "Reviewer", "Owner duyệt".
- **Data handler** (worker đăng ký, UI gọi qua `usePluginData`):
  - `crew.map`, tham số `{issueId}`. Trả về:

    ```
    {root, nodes:[{id,identifier,title,status,parentId,assignee:{id,name}|null,stage:{currentStageId,currentType,completed:string[]}|null,reviewRounds:number,maxReviewRounds:number,kind:"code"|"research"|"fix",bundle:{id,seq}|null}], edges:[{kind:"parent"|"dependency"|"repair",from,to,label?}], diagnostics:string[]}
    ```
  - `crew.roots`, tham số `{status?}`. Trả về danh sách issue gốc Crew có `executionPolicy`, mới nhất trước, kèm số con xong/tổng.
  - `crew.docsCheck`, tham số `{issueId}`. Trả về `{commit,range,exit,at,author}|null`.
  - `crew.docs.tree`, tham số `{projectId}`. Trả về dạng `DocsTree` của v2, bỏ `snapshotId`/`relatedTicketIds`, thêm `receivedAt`, `machineId`.
  - `crew.docs.page`, tham số `{projectId,path}`.
  - `crew.docs.search`, tham số `{projectId,q}`. Tối đa 50 kết quả, `ILIKE` trên title/text.
  - `crew.machines`. Trả về `[{machineId,hostname,lastSeenAt,online,latest,load24h:[{at,load1}]}]`.
- **Component** (UI-3/UI-4 xuất, UI-2 nhúng):
  - `DocsCheckPanel({issueId})`;
  - `DocsSection({companyId})`;
  - `MachinesSection({companyId})`;
  - `MachinesWidget({companyId})` (export slot dashboard).
- **Slot:**
  - `detailTab` id `crew-issue`, `displayName` "Crew", `entityTypes:["issue"]`, export `CrewIssueTab`. Chỉ hiện nội dung map khi issue là gốc có `executionPolicy` Crew. Issue con thì hiện vị trí của nó trong map gốc.
  - `page` id `crew`, `routePath:"crew"`, export `CrewPage`, có ba mục: Yêu cầu, Máy, Docs.
  - `dashboardWidget` id `crew-machines`, export `MachinesWidget`.

## Nghiệm thu (AC-4)

Chạy một lần trên nhánh tích hợp `crew/r1-4` và repo Crew `r1-4-mac`. Image deploy lên spike. `crew-mac` mới cài trên Mac mini.

- [ ] **Cổng 1 — artifact.**
  - Fork: typecheck plugin và server rc 0; test `packages/crew-plugin` đạt; `crew/release/verify.sh` đạt, hook vẫn 5/5.
  - Repo Crew: `pnpm --filter @crew/mac test` và typecheck đạt; `crew-docs check --range v3..HEAD` đạt.
  - Image có `packages/crew-plugin/dist/ui/index.js`. Bundle gzip ≤ 1.5 MB.
  - Deploy xong thì plugin healthy, manifest có 3 slot và 2 webhook.
- [ ] **Cổng 2 — API thật.**
  - Gửi tay bằng `curl` tới cả hai webhook: thiếu chữ ký, sai chữ ký, timestamp lệch 301 giây, body 17 KB, `companyId` lạ đều trả 502, có dòng `plugin_webhook_deliveries` `failed` kèm lý do, DB namespace plugin không thêm dòng nào.
  - Bản tin đúng thì 200 và có đúng một dòng mới.
  - `crew.map` cho CRE-36 khớp DB: 3 con, cạnh `blocks` CRE-37 → CRE-38, stage của gốc `done`.
- [ ] **Cổng 3 — trình duyệt** (Playwright, đăng nhập board, ảnh chụp vào report):
  - Tab "Crew" của CRE-36 hiện map đủ nút và cạnh, kèm docs-check `exit=0` với đúng commit `3942556`.
  - Trang "Crew" có đủ ba mục.
  - Widget dashboard hiện Mac mini online.
  - Mục Docs mở được cây và trang của `repo-a`; tìm từ có trong docs ra kết quả; link hỏng hiện trạng thái `missing`.
  - Console không có lỗi đỏ từ plugin.
- [ ] **Cổng 4 — chạy thật trên Mac.**
  - `crew-mac setup` cài job status, `doctor` ĐẠT.
  - Trong 3 phút có ít nhất 2 bản tin. Dừng job thì sau 180 giây UI đổi sang "mất liên lạc". Bật lại thì online.
  - Tạo một issue gốc nhỏ trên `repo-a` qua Trợ Lý, chạy tới push. Map cập nhật stage khi tải lại tab. Sau push, ảnh chụp docs mới có `commit` = commit vừa push, trong 2 phút.
- [ ] **Cổng 5 — docs khớp code.** Repo Crew: `docs/flows/<crew-mac>.md` mô tả job status và lệnh mới, `crew-docs check` đạt. Fork không có docs-kit, ghi rõ là không áp dụng.
- [ ] **Dọn:**
  - Cancel các issue thử.
  - Giữ job status chạy trên Mac, vì đây là tính năng.
  - Ghi `machineId` và secret ref (chỉ tên, không giá trị) vào ledger.
  - Không push khi owner chưa nói "push".

**Điểm dừng owner:**
- Khi việc nào buộc phải sửa lõi.
- Khi cần tạo secret ref cho webhook. Em tạo qua API board và báo tên, nhưng owner phải biết, vì webhook mở ra mạng Tailscale.
- Khi muốn push.

## Self-review

- **Phủ phạm vi:**
  - O21 (ba chỗ hiển thị) → UI-1, UI-2, UI-4.
  - Map, dependency, vòng sửa, stage → UI-1, UI-2.
  - Trạng thái docs theo yêu cầu → UI-3 `crew.docsCheck`.
  - Cây docs (O22) → MC-2, UI-3.
  - Máy tự gửi (O20) → MC-1, UI-4.
  - Không làm lại board, list, dialog → chỉ dùng slot plugin.
- **Ngoài phạm vi (ghi rõ):** liên kết trang docs với issue liên quan (`relatedTicketIds` của v2). v3 chưa có nguồn đáng tin nối trang docs với issue, phần này để R2.
- **Placeholder:** không có. Vector chữ ký tính trong test.
- **Nhất quán interface:** tên webhook, header, `verifyCrewSignature`/`signCrewBody`, tên data handler, tên component và id slot đã đối chiếu giữa bảng ticket, sở hữu file và Cổng 2–3.
