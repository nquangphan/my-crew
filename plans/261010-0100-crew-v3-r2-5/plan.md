---
title: "Crew v3 R2-5 — Docs graph/dedup, thống kê dung lượng, usage rollup"
description: "Plugin crew.core lưu docs theo SHA-256 (hash+size+byte trước khi dùng lại), giữ mọi snapshot, dựng graph project/flow/file/page/ticket từ flows.yaml + link + crew-commit cho web và agent, trạng thái docs missing/unverified/invalid/stale/current, thống kê dung lượng logic/vật lý/chưa đo, usage rollup trực tiếp và gồm con từ heartbeat_runs + cost_events (chỉ đọc). crew-mac gửi thêm flows.yaml, danh sách commit và cỡ cache file đính kèm. Không thêm hook, không sửa lõi, không run Claude để nghiệm thu."
status: pending
priority: P2
effort: 4d
branch: r2-5
fork_branch: crew/r2-5
tags: [crew-v3, docs, dedup, graph, storage, usage, crew-plugin, crew-mac]
created: 2026-10-10
---

# Crew v3 R2-5 — Docs graph/dedup, thống kê dung lượng, usage rollup — Kế hoạch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner mở mục Docs của trang Crew và thấy những thứ sau:
- trạng thái docs của từng dự án;
- lịch sử snapshot;
- đồ thị project → flow → file/trang → ticket. Agent đọc đúng đồ thị đó qua một route;
- mục Dung lượng tách docs, index, ticket/event và file đính kèm, mỗi số có nhãn logic, vật lý hoặc chưa đo;
- trong tab Crew của issue, usage trực tiếp và usage gồm issue con hiện riêng, chia theo lượt chạy, vai trò và model,
  có nhãn mức đầy đủ.

**Architecture:**
- **Plugin `crew.core` (fork, `packages/crew-plugin`).**
  - Migration `0008_docs_storage.sql` thêm kho blob `docs_blobs` theo sha, bảng `docs_snapshot_pages`, bảng commit, cột
    cỡ file đính kèm, và backfill từ `docs_pages`.
  - Webhook `docs-snapshot` kiểm sha, dedup có so byte, giữ lịch sử, chống trùng bằng `content_key`, nhận thêm
    `manifest`/`commits`.
  - Data key mới: `crew.docs.history/status/graph`, `crew.storage`, `crew.usage.issue/summary`. Route agent
    `GET /docs/graph`.
  - UI tối thiểu đặt trên các module thuần mà R3 dùng lại.
- **`crew-mac` (repo Crew).** `status send` gửi thêm `docs/flows.yaml` và danh sách commit (file đổi) cùng snapshot,
  gửi lại một lần khi lên định dạng 2. Bản tin máy có thêm `attachmentCache`.
- **Usage** chỉ đọc `heartbeat_runs` + `cost_events` của Paperclip. Không ghi ledger riêng.

**Tech Stack:**
- Fork Paperclip `v2026.1005.0`: plugin SDK (`ctx.db`, `ctx.data.register`, `apiRoutes` `board-or-agent`, webhook,
  `ctx.issues.listAttachments`), `@xyflow/react` ^12.12 (đã có), thêm `yaml` 2.x (cùng bản `packages/docs-kit` của repo
  Crew đang dùng), Vitest + Postgres nhúng (`packages/db/src/test-embedded-postgres.ts`).
- Repo Crew: `@crew/mac` (Node ≥ 22, ESM, TypeScript, Vitest, Biome), git CLI.

**Spec:** [2026-10-10-crew-v3-r2-5-docs-usage-design.md](../../docs/superpowers/specs/2026-10-10-crew-v3-r2-5-docs-usage-design.md).
§11 là câu hỏi cho owner; plan theo phương án khuyên. Khuôn plan: [R2-2](../261009-1945-crew-v3-r2-2/plan.md).

**Hiện trạng (10/10/2026 01:05, theo `date`):**
- Repo Crew:
  - `v3` @ `ed2ec08`; `r2-2` @ `204794c` (Mac đã cài `crew-mac` bản R2-2);
  - `r2-3` đang chạy SP-0;
  - R2-4 đang viết spec;
  - R3 đã có plan, chưa giao ticket code.
- Fork: `crew/r2-2` @ `f862b7b20` đang chạy prod (`crew.2p-solutions.com`); `crew/r2-3` đã rẽ. Hook 5/5.
- Plugin có migration `0001`–`0005`. R3 đã giữ tên `0006_machine_jobs.sql`, `0007_setup_runs.sql`.

## Global Constraints

- **Paperclip ghim `v2026.1005.0`.** Không nâng upstream, không patch lõi, `crew/release/core-hooks.json` giữ
  `base: v2026.1005.0`.
- **Hook lõi 5/5, không thêm hook, không đổi thân hook.** Trong fork chỉ sửa `packages/crew-plugin/**`. Việc nào buộc
  sửa ngoài đó thì dừng, ghi ledger, hỏi owner.
- **Nhánh.**
  - Repo Crew: nhánh tích hợp `r2-5` rẽ từ `r2-2` @ `204794c`.
  - Fork: nhánh tích hợp `crew/r2-5` rẽ từ `crew/r2-2` @ `f862b7b20`.
  - R2-2 còn đổi thì Trợ Lý `git merge` vào nhánh R2-5, không rebase nhánh dùng chung.
- **Worker chỉ là agent Claude.** sonnet cho việc bám khuôn (SP-0, GR-1, ST-1, UI-1, MD-1, MD-2). opus cho DB/migration
  (DB-1), rollup usage (US-1), review cuối (RV-1), deploy có migration (DP-1), nghiệm thu (AC-R2-5). Không Codex, không
  fable.
- **Quota Claude dùng chung với owner.**
  - Nghiệm thu không tạo run Paperclip nào: AC đọc dữ liệu thật đã có, dùng repo thử + `crew-mac status send` và
    Playwright. Không chạy `claude -p` thử.
  - Dừng dispatch khi quota tuần còn 1 % (bộ nhớ dự án), giữ quota để viết bàn giao.
- **DB prod.**
  - SP-0 chỉ `SELECT`, SQL đi qua stdin của `ssh nhamoiplatform /opt/crew-v3-spike/ops/api.sh psql`. Không nhúng SQL
    vào chuỗi lệnh `ssh`.
  - DP-1 làm theo thứ tự: `backup.sh` → `restore-drill.sh <TS>` xanh → mới deploy plugin có migration `0008`. Không sửa
    migration đã áp.
- **Deploy prod** chỉ qua `crew/ops/*`:
  1. `active-runs.sh` rỗng.
  2. Backup và diễn tập restore.
  3. **Gộp đúng bản prod đang chạy:** đọc tag image hiện hành (`v3-<sha>`). Nếu `<sha>` không phải tổ tiên của
     `crew/r2-5` thì `git merge <sha>` vào nhánh deploy và chạy lại `verify.sh`, để không gỡ mất R2-3/R3 đã lên prod.
  4. `overlay-source.sh` → `overlay-job.sh` → `deploy.sh`.
  5. Ghi mốc rollback.
  6. Kiểm `/api/health` `status ok`, plugin `crew.core` `ready`, `https://2p-solutions.com` và
     `https://kidyschool.com` trả 200.
  Hỏng thì chạy ngay `rollback.sh <TS>`.
  Plugin luôn lên prod **trước** `crew-mac` mới. Cài `crew-mac` chỉ khi 0 run active.
- **Push** chỉ khi owner nói "push". Tag fork `crew/v3.5-rcN` cục bộ, bản chốt `crew/v3.5` sau AC. Không tag `v*`.
- **Mac mini dùng chung.**
  - Một việc nặng một lúc: test Postgres nhúng (kiểm `ipcs -m` trước, một file một lúc), `verify.sh`, build.
  - Mọi process nền, thư mục tạm, project/repo thử ghi vào [processes.md](processes.md), gỡ khi xong.
  - Thư mục tạm trên Mac không đặt dưới `/Volumes`, `~/Desktop`, `~/Downloads`, `~/Documents` (TCC).
- **Bài học R2-1/R2-2 (bắt buộc).**
  - Body gửi VPS đi qua `scp` hoặc stdin, không nhúng vào chuỗi `ssh`.
  - Giờ trong ledger, comment, báo cáo lấy theo `date`.
  - Trợ Lý chỉ ff nhánh tích hợp sau khi đọc log test của ticket.
  - Project/agent đã có `cost_events` không xóa được: dùng archive/terminate. AC chỉ tạo project thử không có run, nên
    xóa được.
  - Dòng "bắt đầu" của ticket ghi vào ledger ngay khi agent nhận việc.
- **Vòng mỗi ticket:** implementer (agent mới, model của ticket) → reviewer (agent mới, cùng model; đọc diff và log
  test, đối chiếu Interface, Review Focus, Global Constraints) → Trợ Lý ghi ledger và ff. Reviewer trả
  `Status: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT`.
- **Test theo tầng.**
  - Implementer chạy test của phần đổi, typecheck package đó, rồi `pnpm lint` (repo Crew) hoặc `biome`/`tsc` (fork) trên
    file đổi.
  - Full suite (`pnpm -r test`, `pnpm -r typecheck`, `pnpm lint`; fork `crew/release/verify.sh`) chỉ chạy ở RV-1 và
    DP-1.
- **Docs repo Crew theo `crew-docs`.**
  - Commit đổi `apps/crew-mac/src/status/**` hoặc `src/commands/status.ts` thì sửa `docs/flows/mac-setup.md` (mục "Ảnh
    chụp docs" và "Bản tin máy").
  - File mới `apps/crew-mac/src/files/stats.ts` (+ test) vào khối `mac-attachments` của `docs/flows.yaml`, sửa
    `docs/flows/mac-attachments.md`, rồi `node packages/docs-kit/dist/crew-docs.cjs generate`.
  - Không sửa mục `source`/`shared`/`unassigned`, `AGENTS.md`, `CLAUDE.md`, `.claude/**`, `.githooks/**` (R6).
  - Trước commit: `crew-docs check --staged`. Trước push: `crew-docs check --range r2-2..r2-5`. Fork không có
    `crew-docs`.
- **Không log nội dung docs hay body comment.** Log chỉ có id, sha rút gọn 12 ký tự, số byte, mã lỗi.
- UI và docs tiếng Việt. Identifier, path, route, tên bảng, key tiếng Anh. Giờ hiển thị `Asia/Ho_Chi_Minh`. Commit
  Conventional Commits, không nhắc AI, không ghi mã ticket/plan trong code, test, commit message.
- **Phối hợp R3/R2-3/R2-4.**
  - File dùng chung:
    - R3 MC-1 sửa `apps/crew-mac/src/commands/status.ts`, `src/status/report.ts`;
    - R3 PL-1/PL-2 sửa `packages/crew-plugin/src/{manifest.ts,worker.ts,machines/webhook.ts}` và thêm migration
      `0006`/`0007`;
    - R2-3 có thể sửa `crew/agents/**` và `server/src/crew/**`. R2-5 không đụng hai chỗ này.
  - Luật gộp: nhánh nào ff vào nhánh tích hợp hay `v3` sau thì `git merge` nhánh kia vào và giải xung đột trên chính
    nhánh mình.
  - Migration R2-5 là `0008_docs_storage.sql`. Nếu tới lúc làm DB-1 số `0008` đã có người dùng thì lấy số kế tiếp chưa
    dùng và ghi ledger.
  - Khi gói `plugin` được ff vào `crew/r2-5`, Trợ Lý ghi một dòng vào ledger R3
    (`plans/261010-0020-crew-v3-r3/sdd-ledger.md`): data key mới (Interface I3, I5, I6), route I4, module thuần I8. PL-3
    của R3 export thêm, DS-4/OR-1/OR-3/WK-3 dựng widget.

## Lệch so với spec (phát hiện khi lập plan, có nguồn)

1. **Cỡ file đính kèm lấy từ activity, không từ storage.** Plugin không đọc được `issue_attachments`/`assets`. `byte_size`
   lấy từ `details.byteSize` của activity `issue.attachment_added` (`server/src/routes/issues.ts` l.18502), thứ job
   `attachments-audit` đã đọc. Dòng cũ thiếu cỡ thì lấp bằng `listAttachments` (`IssueAttachment.byteSize`). Không lưu
   sha của file, vì vật lý của kho Paperclip vẫn là `chua_do`.
2. **Test DB hiện có dùng sha giả.** `docs.db.test.ts` dựng trang với `sha256: "b".repeat(64)` và khẳng định "snapshot
   cũ bị thay" (`count() === 1`). DB-1 đổi fixture sang sha thật và đổi khẳng định sang "lịch sử giữ đủ". Đây là thay
   đổi hành vi có chủ đích (spec §4.1), không phải sửa test cho xanh.
3. **Migration test tách câu theo `;`** (`docs.db.test.ts`). SQL của `0008` không được có `;` trong chuỗi hay comment.
   Mọi câu đều phải qua `validatePluginMigrationStatement` (không `DELETE`, không `DROP`).
4. **`pg_total_relation_size`.** Validator runtime chỉ bắt tham chiếu `from/join … schema.table`, nên
   `SELECT pg_total_relation_size($1::regclass)` với tên bảng namespace qua tham số đi qua được. ST-1 có test DB khẳng
   định gọi được qua `validatePluginRuntimeQuery`. Nếu validator chặn thì nhóm này là `chua_do` (spec §8).

## Review Focus

1. **Snapshot gửi lặp và gửi đồng thời.**
   - Mac gửi lại cùng body sau timeout, hoặc hai lượt `status send` chồng nhau gửi cùng commit.
   - Kết quả phải là đúng một snapshot hoàn tất cho mỗi `(company, project, commit, content_key)`. Con trỏ trỏ snapshot
     hoàn tất. Không ai đọc thấy snapshot dở.
   - Unique index partial chặn bản thứ hai, nhánh `ON CONFLICT` trả 200.
   - Test: DB-1 (`docs-dedup.db.test.ts` ca "gửi lại", ca "hai lời gọi song song bằng `Promise.all`").
2. **Blob trùng sha khác nội dung, hoặc sha khai báo sai.** Snapshot bị từ chối, không có dòng nào trong
   `docs_snapshot_pages`/`docs_commits` được ghi, blob cũ không đổi. Test: DB-1 (ca "sha sai", ca "blob giả trùng sha").
3. **Đọc chéo company/project qua `snapshotId`, `projectId` hoặc route agent.**
   - Board company A truyền `snapshotId` của project B, hoặc agent company B gọi `/docs/graph` với `companyId` của A.
   - Kết quả phải là lỗi, không rò tên trang hay số liệu.
   - Test: DB-1 (`snapshotId` lạ), GR-1 (`docs-graph.db.test.ts` ca agent khác company, ca issue project khác không
     thành node ticket), ST-1/US-1 (company khác).
4. **Usage đếm trùng hoặc mất run.** Gồm: run có hai dòng `cost_events`; run retry trên cùng issue; run của reviewer;
   issue con ba tầng; issue ẩn; run không có issue; run đang chạy; run crash không có `cost_events`.
   - `tree = direct + Σ con` theo tập run.
   - Run đang chạy không vào tổng.
   - Run thiếu số liệu có mức `thieu`, không thành 0.
   - Test: US-1 (`usage-rollup.test.ts` thuần, `usage.db.test.ts`).
5. **Mac đổi định dạng và lịch sử git bất thường.** Gồm: repo cũ `format` thiếu; `lastCommit` không còn là tổ tiên
   (force-push); repo 1 commit (`--root`); tên file có dấu cách, ký tự Unicode, xuống dòng; merge commit; body vượt 5 MB.
   - Gửi lại đúng một lần, commit đúng thứ tự, đường dẫn lạ bị bỏ chứ không làm hỏng JSON, body vượt thì bỏ `paths`.
   - Test: MD-1 (`status-docs.test.ts` các ca tương ứng).

---

## Gói ngữ cảnh

Luật chia: vẽ gói ngữ cảnh trước rồi cắt ticket trong gói. Mỗi ticket thuộc đúng một gói. Trong một gói, ticket làm lần
lượt, mỗi ticket giao một agent mới nạp cùng gói. Chỉ chạy song song giữa các gói có file ghi rời nhau.

| Gói | Phạm vi ghi | Nạp chung | Phần chi tiết |
|---|---|---|---|
| `probe` | `plans/261010-0100-crew-v3-r2-5/reports/sp-0-probe.md`, `processes.md`, `sdd-ledger.md` | Spec §2.4, §9; `crew/ops/api.sh` (shim psql trên VPS); migration plugin `0001`, `0005` | [probe.md](probe.md) |
| `plugin` | Fork `packages/crew-plugin/**`, `pnpm-lock.yaml` (thêm `yaml`) | Spec §4.1–4.8; plugin `src/{manifest.ts,worker.ts,features.ts}`, `src/docs/{webhook,data}.ts`, `src/shared/{db,markers,webhook}.ts`, `src/attachments/audit.ts`, `src/machines/{webhook,data}.ts`, `src/roles/{data,api}.ts`, `src/ui/{registry.ts,page.tsx,tab.tsx,docs/index.ts,map/*}`, `src/__tests__/docs.db.test.ts`; `server/src/services/plugin-database.ts` (validator); `packages/shared/src/constants.ts` l.1439; `reports/sp-0-probe.md` | [plugin.md](plugin.md) |
| `mac` | Repo Crew `apps/crew-mac/src/{status/docs.ts,status/report.ts,commands/status.ts,files/stats.ts}`, test tương ứng, `docs/flows/{mac-setup,mac-attachments}.md`, khối `mac-attachments` trong `docs/flows.yaml`, `docs/files.md` (sinh) | Spec §4.2, §4.5 (cache); `apps/crew-mac/src/{status/docs.ts,commands/status.ts,status/report.ts,files/{paths,config,gc}.ts}`, `test/{status-docs,status}.test.ts`, `test/helpers/fake-mac.ts`; `docs/flows/mac-setup.md` mục "Ảnh chụp docs"; Interface I1, I7 | [mac.md](mac.md) |
| `ops` | VPS `/opt/crew-v3-spike` qua `crew/ops/*`; `~/.crew/app/crew-mac` trên Mac mini; repo/project thử của AC | Fork `crew/ops/{deploy,rollback,active-runs,backup,restore-drill,overlay-source,overlay-job,plugin-state}.sh`, `crew/release/verify.sh`; ledger R2-2 dòng DP-1; `apps/crew-mac/src/install-cli.ts` | [ops.md](ops.md) |

## Ticket

| ID | Việc | Gói | Nạp thêm | Phụ thuộc | Model | Worker / trạng thái |
|---|---|---|---|---|---|---|
| SP-0 | **Cổng G0.** SQL chỉ đọc trên prod, đo G-a…G-g của spec §9: `modelUsage` trong `result_json`, `costUsd` trong `usage_json`, run thiếu `cost_events`, `billing_type`, cỡ `docs_pages`, sha lệch, số `crew-commit`/`crew-merge`, bản PG. Không run Claude. Viết `reports/sp-0-probe.md` và kết luận G0 | `probe` | — | — | sonnet | chưa giao |
| DB-1 | Migration `0008_docs_storage.sql` (I2) + backfill; webhook (kiểm sha, dedup so byte, giữ lịch sử, `content_key`, nhận `manifest`/`commits`, parse `flows.yaml`); reader (`tree`/`page`/`search`/`projects` đọc bảng mới, `snapshotId`); `crew.docs.history`; thêm dependency `yaml` | `plugin` | I1, I2, I3 (history/tree/page) | G0 | opus | chưa giao |
| GR-1 | `crew.docs.graph` + route agent `docs.graph` (I4), `crew.docs.status` (I3); hàm thuần `buildDocsGraph`, `docsState` | `plugin` | I3, I4; `src/shared/markers.ts` | DB-1 | sonnet | chưa giao |
| ST-1 | `crew.storage` (I5); job `attachments-audit` ghi `byte_size` và lấp dòng cũ; webhook máy nhận `attachmentCache` (I7); `coreReadTables` thêm `cost_events` | `plugin` | I5, I7 | DB-1 | sonnet | chưa giao |
| US-1 | `crew.usage.issue`, `crew.usage.summary` (I6); hàm thuần `toUsageRun`, `sumRuns`, `vnWindowStart` | `plugin` | I6; `src/roles/data.ts` | DB-1 | opus | chưa giao |
| UI-1 | Module thuần I8 + UI tối thiểu: mục Docs (badge trạng thái, lịch sử, Trang/Đồ thị), mục Dung lượng, panel Usage | `plugin` | I3–I8; `src/ui/map/*` (mẫu xyflow) | GR-1, ST-1, US-1 | sonnet | chưa giao |
| MD-1 | `crew-mac` gửi `format`/`manifest`/`commits` (I1), gửi lại khi `format < 2`, bỏ `paths` khi vượt 5 MB | `mac` | I1 | G0 | sonnet | chưa giao |
| MD-2 | `files/stats.ts` `attachmentCacheStats` + key `attachmentCache` trong bản tin máy (I7) | `mac` | I7 | MD-1 | sonnet | chưa giao |
| RV-1 | Review toàn nhánh `r2-5` + `crew/r2-5` theo Review Focus, Global Constraints, Interface; full suite repo Crew; `verify.sh` fork | — | plan, spec, `git diff r2-2..r2-5`, `git -C <fork> diff crew/r2-2..crew/r2-5` | UI-1, MD-2 | opus | chưa giao |
| DP-1 | Backup + diễn tập restore → gộp bản prod → deploy plugin (migration `0008`) → kiểm → cài `crew-mac` lên Mac mini → chờ snapshot định dạng 2 | `ops` | [ops.md](ops.md) | RV-1 | opus | chưa giao |
| AC-R2-5 | Nghiệm thu AC1–AC10 (spec §7) không run Claude | `ops` | mục Nghiệm thu | DP-1 | opus | chưa giao |

Không ticket nào ghi file của gói khác. Trong gói `plugin`:
- `src/manifest.ts`: DB-1 không sửa; GR-1 thêm `apiRoutes`; ST-1 thêm `cost_events` vào `coreReadTables`;
- `src/worker.ts`: GR-1 thêm điều phối route `docs.graph`;
- `src/features.ts`: mỗi ticket thêm đúng một dòng `register…`.
Các ticket chạy lần lượt nên không xung đột.

### Đợt chạy

| Đợt | Ticket | Ghi chú |
|---|---|---|
| 0 | SP-0 | **Cổng G0.** Trợ Lý đọc `sp-0-probe.md`, ghi kết luận vào ledger (xem [probe.md](probe.md) "Luật G0"). Không có số liệu (prod hỏng) thì dừng, báo owner |
| 1 | DB-1 → GR-1 → ST-1 → US-1 → UI-1 (plugin) ∥ MD-1 → MD-2 (mac) | Test Postgres nhúng của plugin chạy một file một lúc. Không chạy cùng `verify.sh` của R2-3/R3 trên cùng máy: Trợ Lý xếp lượt |
| 2 | RV-1, rồi FX-n nếu có | Sửa theo gói của file bị sửa, model như ticket gốc |
| 3 | DP-1 | 0 run active, quota còn > 5 % |
| 4 | AC-R2-5 | Không cần owner thao tác, trừ khi muốn xem UI |

### Nhánh và worktree

- **Repo Crew** (`~/Documents/projects/crew`):
  - nhánh tích hợp `r2-5` rẽ từ `r2-2` @ `204794c`;
  - nhánh gói `r25/mac-docs`, worktree `.worktrees/crew-r25-mac`, rẽ từ `r2-5`.
- **Fork** (cùng repo fork với `.worktrees/paperclip-v3`):
  - nhánh tích hợp `crew/r2-5` rẽ từ `crew/r2-2` @ `f862b7b20`, worktree `.worktrees/paperclip-r25-int` (dùng cho
    `verify.sh` và deploy);
  - nhánh gói `crew/r25-plugin`, worktree `.worktrees/paperclip-r25-plugin`.
- **Gộp nhánh.** Trợ Lý ff nhánh gói vào nhánh tích hợp sau khi đọc log test. Xung đột `docs/flows.yaml`/`docs/files.md`
  thì hợp danh sách rồi `crew-docs generate`. Xung đột `pnpm-lock.yaml` thì `pnpm install --lockfile-only`. Không push.

### Sở hữu file

| Ticket | Ghi |
|---|---|
| SP-0 | `reports/sp-0-probe.md`, `processes.md`, `sdd-ledger.md` |
| DB-1 | Plugin `migrations/0008_docs_storage.sql`; `src/docs/{webhook.ts,data.ts,manifest.ts,history.ts,content-key.ts}`; `src/__tests__/{docs.db.test.ts,docs-dedup.db.test.ts,docs-manifest.test.ts,docs-content-key.test.ts}`; 1 dòng `src/features.ts` (`registerDocsHistory`); `package.json` (`yaml`); `pnpm-lock.yaml` |
| GR-1 | `src/docs/{graph.ts,status.ts,graph-data.ts,api.ts}`; `src/__tests__/{docs-graph.test.ts,docs-status.test.ts,docs-graph.db.test.ts}`; `src/manifest.ts` (`apiRoutes` `docs.graph`); `src/worker.ts` (điều phối `onApiRequest` theo `routeKey`); 1 dòng `src/features.ts` |
| ST-1 | `src/storage/data.ts`; `src/attachments/audit.ts` (ghi `byte_size`, lấp dòng cũ); `src/machines/webhook.ts` (`attachmentCache`); `src/manifest.ts` (`coreReadTables` thêm `cost_events`); `src/__tests__/{storage.db.test.ts,attachments-audit.db.test.ts,machines.test.ts}`; 1 dòng `src/features.ts` |
| US-1 | `src/usage/{rollup.ts,data.ts}`; `src/__tests__/{usage-rollup.test.ts,usage.db.test.ts}`; 1 dòng `src/features.ts` |
| UI-1 | `src/ui/graph/{model.ts,docs-graph.tsx}`; `src/ui/storage/{format.ts,index.ts}`; `src/ui/usage/{format.ts,index.ts}`; `src/ui/docs/index.ts`; `src/ui/index.tsx` (import mục mới); test `src/ui/{graph/model.test.ts,storage/format.test.ts,usage/format.test.ts}`, `src/__tests__/ui-bundle.test.ts` (nếu bundle test liệt kê export) |
| MD-1 | `apps/crew-mac/src/status/docs.ts`; `src/commands/status.ts` (`StatusRepo.format`, điều kiện gửi, base, bỏ `paths`); `test/status-docs.test.ts`; `docs/flows/mac-setup.md` |
| MD-2 | `apps/crew-mac/src/files/stats.ts`; `src/status/report.ts`; `test/files/stats.test.ts`; `test/status.test.ts` (ca `attachmentCache`); `docs/flows/{mac-setup,mac-attachments}.md`; khối `mac-attachments` trong `docs/flows.yaml`; `docs/files.md` (sinh) |
| DP-1, AC-R2-5 | `sdd-ledger.md`, `processes.md`, `reports/{dp-1.md,ac-r2-5-report.md}`, `reports/ac-shots/*.png`; script AC tạm trong scratchpad (không commit) |

## Interface giữa các gói

**I1. Body `docs-snapshot` thêm trường tùy chọn** (MD-1 gửi; DB-1 nhận). `version` vẫn là `1`. Thiếu trường nào thì
server coi như Mac cũ.

```ts
// thêm vào DocsSnapshot (packages/crew-plugin/src/docs/webhook.ts) và vào body của apps/crew-mac/src/commands/status.ts
format?: 2;
manifest?:
  | { status: 'present'; text: string; sha256: string }        // docs/flows.yaml ở commit; text ≤ 512 KiB; sha256 = sha256(utf8(text))
  | { status: 'absent' }                                        // không có docs/flows.yaml
  | { status: 'dropped'; reason: 'secret-scan' | 'too-large' };
commits?: {
  base: string | null;                                          // 40 hex hoặc null (lấy 200 commit gần nhất)
  truncated: boolean;
  items: Array<{ sha: string; merge: boolean; paths: string[] }>; // ≤ 200 item, mới nhất trước; paths ≤ 500, mỗi path ≤ 1024, không ký tự điều khiển; merge → paths []
};
```

- Server kiểm:
  - `manifest.sha256` khớp `text`;
  - `sha` 40 hex, không trùng;
  - tổng số path ≤ 100 000;
  - `format === 2` khi có `manifest` hoặc `commits`.
  Sai thì từ chối cả body (`docs-snapshot: manifest không hợp lệ` / `docs-snapshot: commits không hợp lệ`).
- `status-repos.json` mỗi phần tử thêm `format?: 2`. `listStatusRepos` chấp nhận `format` thiếu hoặc bằng `2`, giá trị
  khác thì lỗi như hiện tại.

**I2. Migration `0008_docs_storage.sql`** (DB-1). Namespace `plugin_crew_core_0433ea20b6`. Mỗi câu một dòng logic,
không `;` trong chuỗi.

```sql
CREATE TABLE plugin_crew_core_0433ea20b6.docs_blobs (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE plugin_crew_core_0433ea20b6.docs_snapshot_pages (
  snapshot_id uuid NOT NULL REFERENCES plugin_crew_core_0433ea20b6.docs_snapshots(id) ON DELETE CASCADE,
  path text NOT NULL,
  title text NOT NULL,
  parent_path text,
  sha256 text NOT NULL REFERENCES plugin_crew_core_0433ea20b6.docs_blobs(sha256),
  PRIMARY KEY (snapshot_id, path)
);
CREATE INDEX docs_snapshot_pages_sha256 ON plugin_crew_core_0433ea20b6.docs_snapshot_pages (sha256);
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN completed_at timestamptz;
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN content_key text;
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN format integer NOT NULL DEFAULT 1;
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN manifest_state text NOT NULL DEFAULT 'not_sent' CHECK (manifest_state IN ('not_sent', 'absent', 'ok', 'invalid', 'dropped'));
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN manifest_sha256 text REFERENCES plugin_crew_core_0433ea20b6.docs_blobs(sha256);
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN manifest_errors jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE plugin_crew_core_0433ea20b6.docs_snapshots ADD COLUMN commits_truncated boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX docs_snapshots_done_key ON plugin_crew_core_0433ea20b6.docs_snapshots (company_id, project_id, commit, content_key) WHERE completed_at IS NOT NULL;
CREATE INDEX docs_snapshots_project_done ON plugin_crew_core_0433ea20b6.docs_snapshots (company_id, project_id, completed_at);
CREATE TABLE plugin_crew_core_0433ea20b6.docs_commits (
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  sha text NOT NULL CHECK (sha ~ '^[0-9a-f]{40}$'),
  is_merge boolean NOT NULL,
  first_snapshot_id uuid NOT NULL REFERENCES plugin_crew_core_0433ea20b6.docs_snapshots(id),
  PRIMARY KEY (company_id, project_id, sha)
);
CREATE TABLE plugin_crew_core_0433ea20b6.docs_commit_files (
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  sha text NOT NULL,
  path text NOT NULL,
  PRIMARY KEY (company_id, project_id, sha, path)
);
CREATE INDEX docs_commit_files_path ON plugin_crew_core_0433ea20b6.docs_commit_files (company_id, project_id, path);
ALTER TABLE plugin_crew_core_0433ea20b6.crew_attachment_audit ADD COLUMN byte_size bigint;
INSERT INTO plugin_crew_core_0433ea20b6.docs_blobs (sha256, byte_size, text) SELECT DISTINCT ON (h) h, octet_length(p.text), p.text FROM (SELECT encode(sha256(convert_to(text, 'UTF8')), 'hex') AS h, text FROM plugin_crew_core_0433ea20b6.docs_pages) p ORDER BY h ON CONFLICT (sha256) DO NOTHING;
INSERT INTO plugin_crew_core_0433ea20b6.docs_snapshot_pages (snapshot_id, path, title, parent_path, sha256) SELECT snapshot_id, path, title, parent_path, encode(sha256(convert_to(text, 'UTF8')), 'hex') FROM plugin_crew_core_0433ea20b6.docs_pages ON CONFLICT DO NOTHING;
UPDATE plugin_crew_core_0433ea20b6.docs_snapshots SET completed_at = received_at, content_key = 'legacy:' || id::text WHERE id IN (SELECT snapshot_id FROM plugin_crew_core_0433ea20b6.docs_current);
```

- Snapshot cũ không hiện hành còn sót (staging hỏng) giữ `completed_at NULL`, runtime dọn sau 10 phút như luật mới.
- `content_key = 'legacy:<id>'` không bao giờ trùng khóa mới (khóa mới là 64 hex), nên lần gửi định dạng 2 đầu tiên
  luôn tạo snapshot mới.

**I3. Data key docs** (DB-1, GR-1 tạo; UI-1, R3 đọc). Mọi key nhận `companyId` (host chèn) và kiểm project thuộc
company trước mọi truy vấn khác.

```ts
// crew.docs.tree({projectId, snapshotId?}) → như cũ, thêm:
type DocsTree = { snapshotId: string; projectId: string; repo: string; commit: string; auditState: 'verified'|'invalid'|'unverified';
  checkExit: number; receivedAt: string; machineId: string; manifestState: ManifestState; dropped: {path:string;reason:string}[];
  pages: { path: string; title: string; parentPath: string | null; sha256: string }[] } | null;
// crew.docs.page({projectId, path, snapshotId?}) → { path, title, text, sha256, links } | null   (như cũ, đọc text từ docs_blobs)
// crew.docs.search({projectId, q}) → như cũ, chỉ trên snapshot hiện hành
type ManifestState = 'not_sent' | 'absent' | 'ok' | 'invalid' | 'dropped';
// crew.docs.history({projectId, limit?: number /* 1..50, mặc định 20 */})
type DocsHistoryItem = { snapshotId: string; commit: string; receivedAt: string; completedAt: string; auditState: string;
  format: 1 | 2; manifestState: ManifestState; pageCount: number; current: boolean;
  changed: { added: number; modified: number; removed: number } | null /* null cho bản cũ nhất trong danh sách trả về */ };
// crew.docs.status({projectId})
type DocsState = 'missing' | 'unverified' | 'invalid' | 'stale' | 'current';
type DocsStatus = { state: DocsState; staleKnown: boolean;
  snapshot: { snapshotId: string; commit: string; receivedAt: string; auditState: string } | null;
  latestPushed: { sha: string; issueId: string; identifier: string; at: string } | null;
  reason: string /* câu tiếng Việt cố định, xem plugin.md GR-1 */ };
// crew.docs.graph({projectId, snapshotId?, flowId?})
type GraphNodeKind = 'project' | 'flow' | 'page' | 'file' | 'ticket';
type GraphEdgeKind = 'project-flow' | 'flow-doc' | 'flow-entrypoint' | 'flow-file' | 'flow-test' | 'shared-file' | 'page-link' | 'ticket-flow';
type GraphNode = { id: string /* `${kind}:${key}` */; kind: GraphNodeKind; label: string;
  ref: { path?: string; flowId?: string; issueId?: string; identifier?: string; status?: string; projectId?: string };
  missing?: true };
type GraphEdge = { id: string /* `${kind}:${from}->${to}` */; kind: GraphEdgeKind; from: string; to: string; files?: number };
type DocsGraph = { snapshot: { snapshotId: string; commit: string; receivedAt: string; auditState: string; manifestState: ManifestState };
  nodes: GraphNode[]; edges: GraphEdge[]; truncated: null | 'files'; flowId: string | null;
  notice: 'Đồ thị lấy từ docs/flows.yaml, liên kết Markdown và commit của ticket; không phải call graph hay bằng chứng hành vi khi chạy.' } | null;
```

**I4. Route agent** (GR-1). Manifest:

```ts
{ routeKey: "docs.graph", method: "GET", path: "/docs/graph", auth: "board-or-agent",
  capability: "api.routes.register", companyResolution: { from: "query", key: "companyId" } }
```

- URL `GET /api/plugins/crew.core/api/docs/graph?companyId=<uuid>&projectId=<uuid>[&snapshotId=<uuid>][&flowId=<id>]`.
- Trả `200 DocsGraph`, hoặc `404 {error:"Dự án chưa có tài liệu"}` khi `null`, hoặc `400 {error}` khi tham số sai.
- Agent: company lấy từ actor (host). `companyId` trong query khác company của agent thì host từ chối. Handler vẫn kiểm
  project thuộc company.
- Body JSON giống hệt `crew.docs.graph` (cùng hàm `loadDocsGraph`).

**I5. `crew.storage({companyId})`** (ST-1).

```ts
type Measured = { kind: 'logic' | 'vat_ly'; bytes: number } | { kind: 'chua_do'; reason: string };
type StorageReport = {
  measuredAt: string;
  projects: Array<{ projectId: string; name: string;
    docs: { snapshots: number; pages: number; logical: Measured; physical: Measured; legacy: Measured };
    index: { links: number; commits: number; commitFiles: number; logical: Measured };
    tickets: { issues: number; comments: number; runs: number; costEvents: number; commentBytes: Measured; physical: Measured };
    attachments: { count: number; unsized: number; since: string | null; logical: Measured; physical: Measured } }>;
  company: { docsPhysical: Measured; docsShared: Measured; docsLegacy: Measured };
  pluginTables: Array<{ table: string; total: Measured }>;   // toàn plugin, mọi company
  machines: Array<{ machineId: string; hostname: string; receivedAt: string;
    attachmentCache: { bytes: number; blobBytes: number; blobs: number; runs: number; limitBytes: number; measuredAt: string } | null }>;
};
```

Lý do `chua_do` cố định:
- `bảng Paperclip dùng chung, không tách được theo company`;
- `kho file Paperclip không cho plugin đo`;
- `máy chưa gửi số liệu cache`;
- `không gọi được hàm đo kích thước bảng`.

**I6. Usage** (US-1).

```ts
type Completeness = 'day_du' | 'mot_phan' | 'thieu' | 'dang_chay';
type CrewRole = 'assistant' | 'executor' | 'reviewer' | 'integrator' | 'khac';
type UsageTotals = { runs: number; runsWithUsage: number; runsMissing: number; runsRunning: number;
  inputTokens: number; cachedInputTokens: number; outputTokens: number;
  estimatedUsd: number | null; estimatedUsdRuns: number; billedCents: number;
  completeness: 'day_du' | 'mot_phan' | 'khong_co' };
type UsageRun = { runId: string; issueId: string | null; identifier: string | null; agentId: string; agentName: string;
  role: CrewRole; status: string; startedAt: string | null; finishedAt: string | null; model: string | null;
  inputTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null; estimatedUsd: number | null;
  billingType: string | null; usageSource: 'per_run' | 'session_delta' | null; sessionReused: boolean | null;
  completeness: Completeness };
type ModelUsage = { model: string; source: 'model_usage' | 'run_model'; inputTokens: number; cachedInputTokens: number; outputTokens: number; estimatedUsd: number | null };
type IssueUsage = { issue: { id: string; identifier: string; title: string };
  direct: UsageTotals; tree: UsageTotals | null;
  children: Array<{ id: string; identifier: string; title: string; status: string; tree: UsageTotals }>;
  byRole: Array<{ role: CrewRole; totals: UsageTotals }>;     // trên cây (hoặc direct khi không có con)
  byModel: ModelUsage[]; runs: UsageRun[]; runsTruncated: boolean;
  reuse: { fresh: number; reused: number; unknown: number }; notes: string[] };
// crew.usage.issue({issueId}) → IssueUsage | null
// crew.usage.summary({projectId?: string, days: 7 | 30 | 90}) →
type UsageSummary = { from: string; to: string; projectId: string | null; totals: UsageTotals;
  byRole: Array<{ role: CrewRole; totals: UsageTotals }>; byModel: ModelUsage[];
  unattributed: UsageTotals;   // run không gắn issue (trong project, hoặc toàn company khi projectId vắng)
  topRoots: Array<{ id: string; identifier: string; title: string; tree: UsageTotals }>; notes: string[] };
```

`notes` cố định, đúng thứ tự:
1. `USD là ước tính của Claude Code, không phải hóa đơn; gói subscription ghi 0 đồng thực trả.`
2. `Token không quy đổi ra phần trăm quota của gói.`
3. `Claude Code không báo riêng token suy luận.`
4. `Token đầu vào gồm cả token ghi cache; token đọc cache tính riêng.`

**I7. Bản tin máy `attachmentCache`** (MD-2 gửi; ST-1 nhận và lưu cùng bản tin).

```ts
attachmentCache?: { bytes: number; blobBytes: number; blobs: number; runs: number; limitBytes: number; measuredAt: string };
// bytes: tổng byte mọi file dưới ~/.crew/cache/attachments (blobs, derived, runs); blobBytes: phần blobs/ mà GC so với trần;
// blobs, runs: số mục; mọi số nguyên 0..2^53; limitBytes = CACHE_MAX_BYTES (2 GiB); measuredAt ISO UTC
```

Plugin: key có mà sai dạng thì bỏ riêng key (như `app`). Bản tin vẫn `version: 1`.

**I8. Module thuần cho R3** (UI-1). Không import React hay SDK UI, test bằng Vitest node.

```ts
// src/ui/graph/model.ts
export function filterGraph(graph: DocsGraph, kinds: ReadonlySet<GraphNodeKind>): { nodes: GraphNode[]; edges: GraphEdge[] };
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): Array<GraphNode & { x: number; y: number }>;  // cột theo kind: project 0, flow 1, page 2, file 3, ticket 4; khoảng cách 260×64
export const NODE_KIND_LABEL: Record<GraphNodeKind, string>;   // 'Dự án','Flow','Trang','File','Ticket'
export const EDGE_KIND_LABEL: Record<GraphEdgeKind, string>;
export const DOCS_STATE_LABEL: Record<DocsState, string>;       // 'Chưa có docs','Chưa xác minh','Không hợp lệ','Cũ hơn code','Đúng với code'
// src/ui/storage/format.ts
export function formatBytes(bytes: number): string;              // vi-VN, 1024-based: "0 B", "512 B", "1,5 KB", "2 GB"
export function formatMeasured(value: Measured): string;         // 'logic' → "1,5 KB (logic)"; 'vat_ly' → "… (vật lý)"; 'chua_do' → "Chưa đo"
// src/ui/usage/format.ts
export function formatTokens(n: number | null): string;          // null → "—"; vi-VN nhóm nghìn
export function formatUsd(n: number | null): string;             // null → "—"; "≈ $1.23"
export const COMPLETENESS_LABEL: Record<Completeness | 'khong_co', string>;  // 'Đủ','Một phần','Thiếu','Đang chạy','Không có số liệu'
export const ROLE_LABEL: Record<CrewRole, string>;               // 'Trợ Lý','Executor','Reviewer','Integrator','Khác'
```

---

## Nghiệm thu (AC-R2-5)

Mọi tiêu chí làm trên prod bản DP-1, Mac mini thật. Không tạo run Paperclip. Bằng chứng (lệnh, đầu ra rút gọn, giờ theo
`date`) ghi vào [sdd-ledger.md](sdd-ledger.md) và `reports/ac-r2-5-report.md`.

**Chuẩn bị (ghi [processes.md](processes.md)):**
- Tạo project thử `r25-ac` và `r25-ac-b` trong company TPS bằng REST (không agent, không issue có run).
- Trên Mac mini dựng repo thử `~/crew-r25-ac/repo` có `origin` là bare repo `~/crew-r25-ac/origin.git`. Repo có
  `docs/flows.yaml` (2 flow), 10 trang `docs/**/*.md`, `git config crew-docs.bundle` trỏ bundle đã cài.
- `crew-mac status add-repo <r25-ac> <repo>` và `crew-mac status add-repo <r25-ac-b> <bản sao repo>`.
- Mọi `send` gọi `"$HOME/.crew/bin/crew-mac" status send`. Không chờ job phút để khỏi lẫn lượt.

- [ ] **AC1 dedup:**
  - Gửi lần 1 → snapshot A.
  - Sửa 1 trang, commit, push vào bare, gửi → snapshot B. Truy vấn `docs_blobs` trước/sau: tăng đúng 1 (cộng 1 nếu
    `flows.yaml` là blob mới ở lần đầu).
  - `crew.storage`: `docs.logical(r25-ac)` = Σ byte trang A + Σ byte trang B. `docs.physical(r25-ac)` = Σ byte blob
    khác nhau.
  - Project `r25-ac-b` cùng nội dung: `docs_blobs` không tăng; `company.docsShared` ≥ Σ byte 10 trang.
- [ ] **AC2 lịch sử:**
  - `crew.docs.history(r25-ac)` có B (current) và A, `changed` của B = `{added:0, modified:1, removed:0}`.
  - `crew.docs.page(path, snapshotId=A)` trả nội dung cũ.
  - `status send` lặp lại không có snapshot mới (`count` không đổi).
  - `crew.docs.tree(r25-ac-b, snapshotId=A)` lỗi `Snapshot không thuộc dự án`.
- [ ] **AC3 toàn vẹn:** đọc log test DB-1 (ca sha sai, blob giả) trong ledger. Trên prod không làm.
- [ ] **AC4 graph:**
  - `crew.docs.graph(r25-ac)` và `curl` route agent bằng board API trả JSON giống hệt nhau (`diff` rỗng).
  - Mọi `edge.from/to` có trong `nodes` (`jq`).
  - Project thật (repo-a hoặc `2ps-landing`, có `crew-commit`) có ít nhất một cạnh `ticket-flow` (nếu SP-0 G-e = 0 thì
    ghi "không có dữ liệu", dựa vào test GR-1).
  - Agent token company khác (nếu chưa có thì bỏ, dựa vào test GR-1) bị từ chối.
  - UI hiện câu `notice`.
- [ ] **AC5 trạng thái:**
  - `crew.docs.status` của mọi project thật khớp tính tay bằng SQL: comment `crew-merge … pushed=yes` mới nhất so với
    `docs_commits`.
  - `r25-ac` sau khi xóa `docs/index.md` khỏi index rồi commit (`crew-docs check` exit 1) → `invalid`.
- [ ] **AC6 dung lượng:**
  - Số của `crew.storage` khớp SQL độc lập (script trong report).
  - `company.docsPhysical` ≤ Σ `docs.physical`.
  - `tickets.physical` hiện `chua_do`.
  - `attachmentCache.bytes` khớp `find ~/.crew/cache/attachments -type f -exec stat -f %z {} + | awk '{s+=$1} END {print s}'`
    ±1 % (byte thật của file, không theo block). `blobBytes` khớp lệnh tương tự trên `blobs/`.
- [ ] **AC7 usage:**
  - Chọn yêu cầu thật có ≥ 2 issue con (TPS từ R1/R2). `crew.usage.issue(root)` có `direct`, `tree`, từng con khớp SQL
    độc lập.
  - `tree.runs = direct.runs + Σ children.tree.runs`, và tổng token tương tự.
  - Có ít nhất một run `thieu` (run bị hủy) hoặc ghi rõ không có.
  - `notes` đủ 4 câu.
  - Không có ký tự `%` nào cạnh số token trong UI.
- [ ] **AC8 UI:** script Playwright (`npx playwright@1.60.0`, trong scratchpad, đăng nhập bằng form) mở:
  - trang Crew → mục Docs → chọn `r25-ac` → chuyển Đồ thị → chọn snapshot A;
  - mục Dung lượng;
  - một issue thật → tab Crew → panel Usage.
  Có 4 screenshot trong `reports/ac-shots/`, không lỗi console mức `error`. Phím Tab đi được tới nút "Đồ thị".
- [ ] **AC9 ràng buộc:**
  - `node crew/release/check-core-hooks.mjs` báo H1–H5. `core-hooks.json` `base` = `v2026.1005.0`.
  - `git diff crew/r2-2..crew/r2-5 --stat` chỉ trong `packages/crew-plugin/**` và `pnpm-lock.yaml`.
  - Ledger DP-1 có TS backup + restore-drill xanh trước deploy. Plugin `ready`.
  - Trước khi cài `crew-mac` mới, ít nhất một snapshot của Mac cũ được nhận sau deploy (log plugin hoặc `received_at`).
- [ ] **AC10 cỡ dữ liệu:** đọc số đo của test `docs-dedup.db.test.ts` ca "200 snapshot" (DB-1 in ra `logical`,
  `physical`, `pg_total_relation_size`) và ghi vào report.
- [ ] **Dọn:**
  - `status remove-repo` cho hai project thử.
  - Xóa project thử (không có `cost_events` nên `DELETE` được; lỗi FK thì archive).
  - `rm -rf ~/crew-r25-ac`.
  - Snapshot của project thử giữ trong DB (không tự xóa lịch sử). Ghi id vào processes.md, dòng `giữ: lịch sử docs`.
  - Tag `crew/v3.5` cục bộ trên commit đã deploy. Push chỉ khi owner nói "push".

## Self-review

Trợ Lý tự review 10/10/2026 sau khi viết plan và các phần chi tiết.

- **Phủ spec:**
  - §4.1 → DB-1 (I2, I3 history/tree/page);
  - §4.2 → MD-1 (I1), DB-1 (nhận, parse manifest, lưu commit);
  - §4.3 → GR-1 (I3 graph, I4);
  - §4.4 → GR-1 (`crew.docs.status`);
  - §4.5 → ST-1 (I5), MD-2 (I7);
  - §4.6 → US-1 (I6);
  - §4.7 → UI-1 (I8) + ghi ledger R3;
  - §4.8 → Global Constraints, AC9;
  - §7 AC1–AC10 → mục Nghiệm thu;
  - §9 → SP-0;
  - §11 Q1 → UI-1; Q2 → MD-1, GR-1; Q3 → US-1, UI-1; Q4 → MD-2, ST-1; Q5 → DB-1 (giữ `docs_pages`), ST-1 (`legacy`).
- **Mỗi ticket một gói:** bảng Sở hữu file không có file nào do hai gói ghi. Trong gói `plugin`, `features.ts`,
  `manifest.ts`, `worker.ts` do các ticket lần lượt sửa.
- **Placeholder:** đã quét `TBD`, `TODO`, `implement later`, `similar to`: không có. Giá trị chỉ biết sau G0 có luật
  điền ở probe.md "Luật G0".
- **Nhất quán tên:** đối chiếu giữa plan, `plugin.md`, `mac.md`, `ops.md`:
  - `docs_blobs`, `docs_snapshot_pages`, `docs_commits`, `docs_commit_files`, `content_key`, `manifest_state`;
  - `computeContentKey`, `parseFlowsManifest`, `storeDocsSnapshot`;
  - `buildDocsGraph`, `loadDocsGraph`, `docsState`, `loadDocsStatus`, `loadDocsHistory`;
  - `loadStorageReport`;
  - `toUsageRun`, `sumRuns`, `vnWindowStart`, `USAGE_NOTES`, `loadIssueUsage`, `loadUsageSummary`;
  - `collectCommits`, `readFlowsManifest`, `attachmentCacheStats`.
- **Review Focus:** 1 → DB-1; 2 → DB-1; 3 → DB-1, GR-1, ST-1, US-1; 4 → US-1; 5 → MD-1.

**Còn chờ owner:** 5 câu ở spec §11. Plan đang theo phương án khuyên. Owner đổi câu nào thì sửa ticket ghi trong câu
đó trước khi giao.
