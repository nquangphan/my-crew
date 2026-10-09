# Crew v3 R2-5 — Docs graph/dedup, thống kê dung lượng, usage rollup

Ngày viết: 10/10/2026 01:05 (Asia/Ho_Chi_Minh, theo `date`). Owner vắng tới sáng: các quyết định sản phẩm nằm ở §11,
plan R2-5 tạm theo phương án khuyên.

Nguồn yêu cầu:
- [Plan stock-first mục R2](../../../plans/261006-0805-crew-v3-stock-first/plan.md) ("Docs graph/dedup, thống kê dung lượng, usage rollup").
- [Spec v3](2026-10-05-crew-v3-paperclip-design.md) §3 (bảng chủ sở hữu: "Docs snapshot/graph/review/dedup — Crew namespace
  và kho blob"; "reported cost — Paperclip") và §4 (docs content-addressed, snapshot bất biến, hash+size+byte trước dedup,
  quyền theo project, đo logical/physical riêng; usage theo ticket/attempt/review/retry/subagent, null/partial khi thiếu,
  rollup không double count, USD estimate khác billing, token không quy đổi quota subscription).
- [MVP2 docs/storage/usage](../../../plans/261002-0002-crew-v2/mvp2-docs-storage-usage.md) §2, §3, §4 (yêu cầu owner chốt
  04/10/2026, kế thừa vào v3).

## 1. Mục tiêu

1. **Docs không mất lịch sử, không lưu trùng.** Mỗi ảnh chụp docs là bất biến và được giữ. Nội dung trang lưu một lần
   theo SHA-256. Chỉ dùng lại bản đã có khi hash, số byte và từng byte khớp. Quyền đọc vẫn đi qua project/snapshot.
2. **Graph docs cho người và agent.** Node gồm project, flow, file nguồn, trang docs, ticket. Cạnh chỉ lấy từ
   `docs/flows.yaml`, link Markdown và commit có cấu trúc (`crew-commit`), không suy từ văn xuôi. Web và agent đọc cùng
   một API, cùng kết quả cho cùng snapshot.
3. **Trạng thái docs theo project:** `missing`, `unverified`, `invalid`, `stale`, `current`, kèm commit đã kiểm.
4. **Thống kê dung lượng:** tách docs, graph/index, ticket/event, file đính kèm. Phân biệt dung lượng logic, vật lý và
   phần chưa đo. Phần vật lý dùng chung không bị cộng nhiều lần.
5. **Usage rollup theo ticket:** tổng trực tiếp và tổng gồm issue con hiển thị riêng, không cộng chồng. Có chia theo
   lượt chạy (attempt, gồm retry/review/thất bại), vai trò, model. Mỗi số có nhãn mức đầy đủ. USD là ước tính, không phải
   hóa đơn. Không đổi token ra phần trăm quota.
6. **Hiển thị đặt sao cho R3 dùng lại:** dữ liệu qua data key/route của plugin `crew.core`. Phần định dạng và bố cục
   viết thành module thuần (không React), để R3 dựng widget design system bằng chính các module đó.

## 2. Hiện trạng (đọc ngày 10/10/2026)

### 2.1. Ảnh chụp docs từ Mac (repo Crew, nhánh `r2-2` @ `204794c`)

- `apps/crew-mac/src/commands/status.ts` `sendDocsSnapshots` chạy trong `crew-mac status send` (mỗi phút). Với từng
  repo trong `~/.crew/status-repos.json` (`{projectId, path, lastCommit}`), lệnh chọn commit mặc định. Khi commit khác
  `lastCommit` thì gọi `buildDocsSnapshot`, ký HMAC rồi POST `.../webhooks/docs-snapshot`. Body tối đa 5 MB. Gửi thành
  công mới ghi `lastCommit`.
- `apps/crew-mac/src/status/docs.ts` `buildDocsSnapshot`:
  - đọc mọi `docs/**/*.md` ở commit bằng `git show` (không đọc working tree);
  - chạy `crew-docs check --all` trong worktree tạm, exit 0/1/2–3 thành `auditState`;
  - quét secret R7 trên nội dung và metadata, trang dính bị bỏ vào `dropped`;
  - trả `pages` (`path`, `title`, `parentPath`, `text`, `sha256` tính trên `text`), `links` (link Markdown tương đối,
    trạng thái `ok`/`missing`/`external`/`unverified`).
- **`docs/flows.yaml` không được gửi** (chỉ lấy file `.md`), nên server không biết flow nào chứa file nào. Không có
  danh sách commit hay file đổi.
- Flow tài liệu: `docs/flows/mac-setup.md` mục "Ảnh chụp docs".

### 2.2. Plugin lưu và hiện docs (fork `crew/r2-2` @ `f862b7b20`, `packages/crew-plugin`)

- Migration `0001_docs.sql`: bảng `docs_snapshots`, `docs_current` (con trỏ snapshot hiện hành theo project),
  `docs_pages` (có cột `text` đầy đủ), `docs_links`.
- `src/docs/webhook.ts` `receiveDocsSnapshot`:
  - ghi staging rồi đổi con trỏ `docs_current`;
  - **xóa snapshot trước đó** sau khi đổi con trỏ, và xóa snapshot không hiện hành cũ hơn 10 phút. Kết quả là không
    còn lịch sử;
  - **không kiểm `sha256`** khai báo so với `text`;
  - mỗi snapshot chép toàn bộ text, kể cả trang không đổi.
- `src/docs/data.ts`: data key `crew.docs.projects`, `crew.docs.tree`, `crew.docs.page`, `crew.docs.search`,
  `crew.docsCheck`. Mọi truy vấn đều kiểm project thuộc company.
- UI: `src/ui/docs/index.ts` (mục Docs trên trang Crew: cây, trang, tìm kiếm; panel "Kiểm docs" trong tab Crew của
  issue). Bản đồ yêu cầu dùng `@xyflow/react` (`src/ui/map/*`). Đây là chỗ "Mở map" của R1-4.
- Đăng ký UI qua `src/ui/registry.ts` (`registerPageSection`, `registerIssuePanel`).

### 2.3. Giới hạn SQL của plugin (fork `server/src/services/plugin-database.ts`)

- Runtime `ctx.db.query` chỉ cho `SELECT`/`WITH`. `ctx.db.execute` chỉ cho `INSERT`/`UPDATE`/`DELETE` trong namespace
  `plugin_crew_core_0433ea20b6`. Mỗi lệnh đúng một câu, không có transaction nhiều câu.
- Migration không được `DROP`/`TRUNCATE`/`DELETE`. Được `CREATE`/`ALTER`, và `INSERT … SELECT`/`UPDATE` để backfill
  trong namespace. Migration đã áp không được đổi (kiểm checksum). Host áp mọi file chưa áp, không phụ thuộc thứ tự số.
- Đọc bảng lõi chỉ khi bảng có trong `database.coreReadTables` của manifest. Bảng được phép theo
  `PLUGIN_DATABASE_CORE_READ_TABLES`: `companies, projects, goals, agents, issues, issue_documents, issue_relations,
  issue_comments, heartbeat_runs, cost_events, approvals, issue_approvals, budget_incidents`. Manifest hiện khai
  `issues, issue_relations, issue_comments, heartbeat_runs, agents, projects`, **chưa có `cost_events`**.
- `issue_attachments`, `assets`, `activity_log` không đọc được bằng SQL.
- Route plugin `apiRoutes` mount ở `/api/plugins/crew.core/api/<path>`, có chế độ `board-or-agent`. Agent luôn bị khóa
  vào company của chính nó (`req.actor.companyId`).

### 2.4. Usage và chi phí của Paperclip (chỉ đọc)

- Mỗi run kết thúc, `heartbeat.ts` `updateRuntimeState` ghi **một** `cost_events` khi có token hoặc có tiền. Các cột:
  `heartbeat_run_id`, `issue_id`/`project_id` (lấy từ `contextSnapshot.issueId` của run), `provider`, `biller`,
  `billing_type`, `cost_status` (`reported`/`unpriced`), `model`, `input_tokens`, `cached_input_tokens`,
  `output_tokens`, `cost_cents`.
- Adapter `claude_local` (`parse.ts` `claudeModelUsageTotals`):
  - lấy usage từ `modelUsage` của kết quả CLI, nên **đã gồm subagent**;
  - `input` = `inputTokens + cacheCreationInputTokens`, `cached` = `cacheReadInputTokens`, `output` = `outputTokens`
    (ba tập rời nhau);
  - `usageBasis: "per_run"`, nên server không áp delta tích lũy theo session.
- Owner dùng gói subscription, nên `billing_type = subscription_included`, `cost_cents = 0` (BA R3: "Paperclip ghi
  $0"). Ước tính USD của SDK vẫn nằm ở `heartbeat_runs.usage_json.costUsd`/`cacheAdjustedCostUsd`.
- `usage_json` còn có `usageSource` (`per_run`/`session_delta`), `sessionReused`, `freshSession`, `taskSessionReused`,
  `model`.
- `heartbeat_runs.result_json` giữ nguyên event kết quả của CLI, gồm `modelUsage` theo từng model. SP-0 xác nhận điều
  này trên prod.
- Paperclip có sẵn `GET /issues/:id/cost-summary` (tổng cây issue) và trang Costs. R3 bỏ trang Costs (BA R3 mục 2: "chi
  phí là gói Claude trên Mac"). Chưa có chỗ nào tách trực tiếp/gồm con, theo vai trò, theo lượt chạy hay theo mức đầy
  đủ.
- Run không có `cost_events` khi crash trước lúc có kết quả, khi bị hủy, hoặc khi token bằng 0.

### 2.5. File đính kèm (R2-2)

- Plugin: bảng `crew_attachment_audit` (`attachment_id`, `issue_id`, `verdict`, …), chưa có cỡ file. Activity
  `issue.attachment_added` có `details.byteSize`. `ctx.issues.listAttachments` trả metadata gồm `byteSize`, `sha256`.
- Mac: cache `~/.crew/cache/attachments/` (`blobs/<sha256>`, `derived/`, `runs/<runId>/`), TTL 7 ngày, trần 2 GB
  (`apps/crew-mac/src/files/{config,cache,gc}.ts`). Bản tin máy (`status/report.ts`, ≤ 16 KB) chưa có số liệu cache.
  Webhook máy của plugin (`machines/webhook.ts`) chỉ nhận đúng các key đã biết; key tùy chọn (`app`) sai dạng thì bị
  bỏ riêng.

## 3. Phạm vi và không làm

**Làm:** mục tiêu 1–6.

**Không làm** (ghi vào §10): reviewer docs đối chiếu diff mới, validator mới, sync theo sự kiện merge, agent registry và
chính sách resume/spawn (MVP2 §5), billing chính thức, Mac chỉ gửi trang đổi, dọn bảng `docs_pages` cũ.

## 4. Thiết kế

### 4.1. Docs content-addressed và lịch sử (plugin)

- Bảng mới `docs_blobs(sha256 PK, byte_size, text)`. `text` là nội dung UTF-8 của trang hoặc của `flows.yaml`.
  `docs_snapshot_pages(snapshot_id, path, title, parent_path, sha256 → docs_blobs)` thay `docs_pages` cho mọi lần ghi và
  đọc mới.
- **Nhận trang:**
  1. Server tự tính `sha256(utf8(text))`. Lệch với giá trị khai báo thì từ chối cả snapshot, trả lỗi
     `docs-snapshot: mã băm trang không khớp nội dung`.
  2. `INSERT … ON CONFLICT (sha256) DO NOTHING`.
  3. Đọc lại blob theo sha, so `byte_size` và so nguyên văn `text`. Khác thì từ chối cả snapshot với lỗi
     `docs-snapshot: trùng mã băm nhưng khác nội dung`, không ghi gì thêm, và log một dòng chỉ có sha rút gọn 12 ký tự.
  Đây là "hash+size+byte trước dedup".
- **Blob dùng chung toàn plugin** (khóa chỉ là sha). Không có đường đọc blob trực tiếp: mọi data key/route đều đi
  `docs_current`/`docs_snapshots` có `company_id` + `project_id` rồi mới join blob. Nhờ vậy dedup chéo project không làm
  lộ dữ liệu.
- **Giữ lịch sử:**
  - Bỏ lệnh xóa snapshot trước đó. Snapshot có `completed_at` được đặt sau khi ghi đủ trang, link, commit.
  - Chỉ xóa snapshot dở dang (`completed_at IS NULL`, cũ hơn 10 phút) của đúng project. Đây là staging hỏng, không phải
    lịch sử.
  - Con trỏ `docs_current` chỉ trỏ snapshot đã `completed_at`.
- **Chống trùng:**
  - `content_key = sha256` của chuỗi `format|commit|auditState|<path:sha theo path>|manifest sha|dropped`.
  - Đã có snapshot hoàn tất cùng `(company, project, commit, content_key)` thì không tạo bản mới, chỉ bảo đảm con trỏ trỏ
    đúng bản đó và trả 200 (Mac gửi lại sau timeout).
  - Cùng commit mà `content_key` khác (Mac lên định dạng mới, bundle `crew-docs` khác cho `auditState` khác) thì thành
    snapshot mới trong lịch sử.
- **Migration:**
  - Tạo bảng và cột mới.
  - Backfill `docs_blobs` từ `docs_pages`, khóa là sha **tính lại trong SQL** (`encode(sha256(convert_to(text,'UTF8')),
    'hex')`), không tin cột cũ. Backfill `docs_snapshot_pages`.
  - Đặt `completed_at = received_at` cho snapshot đang hiện hành.
  - Bảng `docs_pages` giữ nguyên, không ghi không đọc nữa (Q5). Thống kê dung lượng hiện nó thành "bản cũ trước khử
    trùng".
- **Lịch sử xem được:**
  - `crew.docs.history` liệt kê snapshot hoàn tất mới nhất trước, mỗi bản có số trang thêm/sửa/xóa so với bản ngay
    trước (so theo `path` + `sha256`).
  - `crew.docs.tree`/`crew.docs.page` nhận thêm `snapshotId` tùy chọn. Snapshot phải thuộc đúng company + project, sai
    thì lỗi `Snapshot không thuộc dự án`.

### 4.2. Mac gửi thêm manifest và commit

Body `docs-snapshot` giữ `version: 1`, thêm ba trường **tùy chọn**. Plugin nhận được cả Mac cũ (thiếu trường) lẫn Mac
mới.

```ts
format?: 2;
manifest?: { status: 'present'; text: string; sha256: string } | { status: 'absent' } | { status: 'dropped'; reason: 'secret-scan' | 'too-large' };
commits?: { base: string | null; truncated: boolean; items: Array<{ sha: string; merge: boolean; paths: string[] }> };
```

- **`manifest`:**
  - Mac đọc `docs/flows.yaml` ở commit bằng `git show`. Không có file thì `absent`; quá 512 KB thì `dropped`/`too-large`.
  - File được quét secret cùng lượt R7 như trang. Dính thì `dropped`/`secret-scan`.
  - Mac không parse YAML. Server parse bằng gói `yaml`, kiểm schema giống `FlowsManifest` của `crew-docs`, ghi
    `manifest_state` `ok`/`invalid` (kèm tối đa 20 lỗi ngắn).
- **`commits`:**
  - Lấy bằng `git rev-list --parents --max-count=201 <commit> [^<base>]`. `base` là `lastCommit` khi repo đã gửi định
    dạng 2 và `git merge-base --is-ancestor lastCommit commit` đúng. Còn lại `base = null`: lấy 200 commit gần nhất (lần
    đầu sau nâng cấp, hoặc sau force-push).
  - Commit không phải merge có `paths` từ `git diff-tree --no-commit-id --name-only -r -z --root <sha>`, tối đa 500
    đường dẫn. Merge commit có `paths: []`, `merge: true`. Quá 200 commit hoặc quá 500 path thì `truncated: true`.
  - Đường dẫn bị bỏ khi chứa byte điều khiển hoặc dài hơn 1024.
- **Body > 5 MB:** gửi lại một lần với `commits.items[].paths = []` và `truncated: true`. Vẫn vượt thì xử lý như hiện tại
  (giữ `lastCommit`, thử lại).
- **Gửi lại khi nâng định dạng:** repo trong `status-repos.json` thêm `format`. Lệnh gửi khi `commit !== lastCommit`
  **hoặc** `(format ?? 1) < 2`. Gửi xong ghi `format: 2`. Nhờ vậy repo cũ được gửi lại một lần để có manifest và commit
  dù docs không đổi.
- Plugin lưu `docs_commits(company, project, sha, is_merge, first_snapshot_id)` và
  `docs_commit_files(company, project, sha, path)`. Ghi idempotent (`ON CONFLICT DO NOTHING`).

### 4.3. Graph

Data key `crew.docs.graph({companyId, projectId, snapshotId?, flowId?})` và route
`GET /api/plugins/crew.core/api/docs/graph?companyId=&projectId=[&snapshotId=][&flowId=]` (`board-or-agent`). Cả hai gọi
cùng hàm `loadDocsGraph`.

- **Node:**
  - `project` (1);
  - `flow` (mỗi flow trong manifest);
  - `page` (mỗi trang của snapshot, cộng trang `doc` của flow mà snapshot thiếu, đánh `missing: true`);
  - `file` (đường dẫn trong `entrypoints`/`files`/`tests`/`shared` của manifest);
  - `ticket` (issue của project có `crew-commit sha=X` do agent viết, với X có trong `docs_commit_files` và đổi ít nhất
    một file có trong manifest).
- **Cạnh:**
  - `project-flow`;
  - `flow-doc` (flow → page);
  - `flow-entrypoint`, `flow-file`, `flow-test` (flow → file);
  - `shared-file` (file → flow);
  - `page-link` (page → page, từ `docs_links` trạng thái `ok`);
  - `ticket-flow` (ticket → flow, `files` = số file đổi của flow đó).
- **Không cạnh treo:** mọi `from`/`to` đều là id node có trong kết quả. Test khẳng định điều này.
- **Không có manifest** (`not_sent`/`absent`/`invalid`/`dropped`): chỉ có project và page (cộng `page-link`). Kết quả có
  `manifestState` để UI nói rõ lý do.
- **Giới hạn:**
  - Quá 3000 node mà không có `flowId` thì bỏ node `file` và cạnh của nó, `truncated: "files"`.
  - Có `flowId` thì chỉ trả flow đó, file của nó, trang doc của nó, trang link một bước từ trang doc, và ticket chạm flow
    đó.
- **Phạm vi ticket:** issue thuộc `project_id` và `company_id`, `hidden_at IS NULL`. Lấy tối đa 500 issue mới nhất có
  `crew-commit`.
- Kết quả có `notice` cố định:
  `Đồ thị lấy từ docs/flows.yaml, liên kết Markdown và commit của ticket; không phải call graph hay bằng chứng hành vi khi chạy.`

### 4.4. Trạng thái docs của project

Data key `crew.docs.status({companyId, projectId})`, trả `{ state, snapshot, latestPushed, staleKnown, reason }`.
- `latestPushed`: comment mới nhất trong issue của project, do agent viết (`author_agent_id IS NOT NULL`), dòng đầu khớp
  `^crew-merge sha=([0-9a-f]{40}) branch=\S+ pushed=yes`.
- Xét theo thứ tự, gặp điều kiện đầu tiên thì dừng:
  1. Không có snapshot hiện hành → `missing`.
  2. `latestPushed` có, project có ít nhất một dòng `docs_commits`, và sha đó chưa có trong `docs_commits` → `stale`
     (`reason` nêu sha 12 ký tự và giờ push).
  3. `auditState` `invalid` → `invalid`.
  4. `unverified` → `unverified`.
  5. Còn lại → `current`.
- Project chưa có `docs_commits` (Mac cũ) → `staleKnown: false`, bỏ bước 2.
- Giả định: lịch sử nhánh mặc định tuyến tính (đúng với luật integrator: `merge --no-ff`, không `--force`).

### 4.5. Thống kê dung lượng

Data key `crew.storage({companyId})`, đo khi gọi (không có bảng tổng hợp). Mọi số là byte nguyên. Mỗi nhóm có nhãn
`logic`, `vat_ly` hoặc `chua_do`.

| Nhóm | Logic (theo project) | Vật lý | Chưa đo |
|---|---|---|---|
| Docs | Tổng `byte_size` các trang của mọi snapshot hoàn tất (mỗi snapshot tính đủ) | Tổng blob **khác nhau** mà snapshot của project tham chiếu. Tổng company đếm blob khác nhau trên mọi project, nên blob dùng chung chỉ tính một lần. Có thêm `sharedBytes` (blob dùng ở ≥ 2 project) | — |
| Docs cũ | `octet_length(text)` của `docs_pages` (trước khử trùng) | như logic | — |
| Graph/index | Số dòng và byte ước của `docs_links`, `docs_commits`, `docs_commit_files` | `pg_total_relation_size` từng bảng namespace (toàn plugin, mọi company), nếu SP-0/ST-1 xác nhận gọi được; không được thì `chua_do` | — |
| Ticket/event | Số issue, số comment và tổng byte `body`, số run, số `cost_events` của project | `chua_do`: bảng Paperclip dùng chung, không tách theo company | Log run trên server |
| File đính kèm (server) | Tổng `byte_size` các file trong `crew_attachment_audit` của project, kèm số file chưa có cỡ và mốc bắt đầu đo | `chua_do` (kho file Paperclip) | File tải lên trước khi có kiểm file (R2-2) |
| Cache file trên Mac | Theo máy: `bytes`, số blob, số run, trần 2 GB, giờ đo (từ bản tin máy) | đúng là vật lý trên đĩa Mac | Máy chưa gửi |

- Không bao giờ cộng tổng vật lý giữa các nhóm khi có nhóm `chua_do`. UI hiện "Chưa đo" chứ không hiện 0.
- Cỡ file đính kèm: job `attachments-audit` ghi `byte_size` vào `crew_attachment_audit` khi xét file mới, lấy từ
  `details.byteSize` của activity mà job đã đọc. Dòng cũ thiếu cỡ thì mỗi phút job lấp tối đa 20 issue.
- Bản tin máy thêm key tùy chọn `attachmentCache: { bytes, blobBytes, blobs, runs, limitBytes, measuredAt }`. `bytes` là
  mọi file dưới cache, `blobBytes` là phần `blobs/` mà GC so với trần 2 GB. Mac tính bằng cách duyệt cây cache, tối đa 2
  giây. Lỗi hoặc quá giờ thì không gửi key. Plugin nhận như `app`: sai dạng thì bỏ
  riêng key đó.

### 4.6. Usage rollup

Nguồn: `heartbeat_runs` + `cost_events` + `crew_project_roles` + `issues` + `agents`. Chỉ đọc, không ghi bảng usage
riêng: Paperclip đã là ledger (spec v3 §3), Crew chỉ tổng hợp.

- **Chủ sở hữu của một run:** `cost_events.issue_id` nếu có, ngược lại `heartbeat_runs.context_snapshot->>'issueId'`.
  Đúng một chủ. Run không có issue đi vào nhóm `khong_gan_issue` của project (`context_snapshot->>'projectId'`) hoặc của
  company.
- **Số của một run:**
  - Run có `cost_events` (cộng mọi dòng cùng `heartbeat_run_id`): token lấy từ đó. USD ước tính lấy
    `usage_json.cacheAdjustedCostUsd`, không có thì `usage_json.costUsd`, không có thì `null`. Mức `day_du` khi có USD,
    `mot_phan` khi không.
  - Run không có `cost_events` mà `usage_json` có số token: token lấy từ `usage_json`, mức `mot_phan`.
  - Run đã kết thúc, không có cả hai: token `null`, mức `thieu`.
  - Run `queued`/`running`: mức `dang_chay`, không vào tổng.
- **Tổng:**
  - Cộng các run khác nhau theo `run_id`, bỏ qua giá trị `null`. Kèm `runs`, `runsWithUsage`, `runsMissing`,
    `runsRunning`.
  - Mức của tổng: mọi run `day_du` thì `day_du`, có run có số thì `mot_phan`, không run nào có số thì `khong_co`.
- **Trực tiếp và gồm con:** `direct` là run có chủ là issue. `tree` là run có chủ trong cây issue (đệ quy `parent_id`,
  bỏ `hidden_at`). Hai số hiện **riêng**, không có ô nào cộng hai số. Test khẳng định `tree = direct + Σ children[].tree`
  bằng tập run, không trùng run.
- **Chia nhỏ:**
  - Theo vai trò: lấy từ `crew_project_roles` của project của issue (`assistant`/`executor`/`reviewer`/`integrator`),
    ngoài bảng thì `khac`.
  - Theo model: chỉ khi `usageSource = per_run`, đọc `result_json.modelUsage` từng model (`input = inputTokens +
    cacheCreationInputTokens`, `cached = cacheReadInputTokens`, `output`, `costUSD`), nguồn `model_usage`. Còn lại dùng
    `cost_events.model`, nguồn `run_model`. Subagent dùng model khác chỉ tách được khi có `model_usage`.
  - Theo lượt chạy: tối đa 200 run mới nhất của cây, `truncated` khi nhiều hơn.
- **Đo reuse** (chỉ đếm, không đổi chính sách): số run `freshSession`, số run `sessionReused`, số run không rõ.
- **Ghi chú cố định** (mọi màn usage):
  - `USD là ước tính của Claude Code, không phải hóa đơn; gói subscription ghi 0 đồng thực trả.`
  - `Token không quy đổi ra phần trăm quota của gói.`
  - `Claude Code không báo riêng token suy luận.`
  - `Token đầu vào gồm cả token ghi cache; token đọc cache tính riêng.`
- **Data key:**
  - `crew.usage.issue({companyId, issueId})`.
  - `crew.usage.summary({companyId, projectId?, days})`, `days ∈ {7, 30, 90}`. Mốc đầu cửa sổ là 00:00 theo
    `Asia/Ho_Chi_Minh`. Trả tổng theo vai trò, model, nhóm `khong_gan_issue`, và 10 yêu cầu gốc tốn nhiều token đầu ra
    nhất.
- Manifest thêm `cost_events` vào `coreReadTables`. Không thêm capability mới.

### 4.7. Hiển thị và phối hợp R3

- **Module thuần** (không React, không SDK UI), test riêng:
  - `src/ui/graph/model.ts` (lọc, bố cục cột: project | flow | page | file | ticket, nhãn);
  - `src/ui/storage/format.ts` (byte theo `vi-VN`, nhãn logic/vật lý/chưa đo);
  - `src/ui/usage/format.ts` (token, USD ước tính, nhãn mức đầy đủ, vai trò).
- **UI tối thiểu trong plugin hiện tại** (Q1), dùng các module trên:
  - Mục Docs: badge trạng thái, chọn snapshot trong lịch sử, nút chuyển "Trang | Đồ thị". Đồ thị dùng `@xyflow/react`
    như bản đồ yêu cầu. Bấm trang thì mở trang, bấm flow thì lọc theo flow, bấm ticket thì sang issue, bấm file thì hiện
    flow chứa nó.
  - Mục mới "Dung lượng" trên trang Crew.
  - Panel mới "Usage" trong tab Crew của issue.
- **Cho R3:** data key/route ở §4.1–4.6 là hợp đồng. R3 PL-3 thêm export `shared/docs-graph`, `shared/storage-format`,
  `shared/usage-format`. R3 DS-4/OR-1/OR-3/WK-3 dựng widget từ đó. Khi gói plugin R2-5 được ff, R2-5 ghi một dòng vào
  ledger R3.

### 4.8. Hook lõi

Không thêm hook, không sửa lõi. Mọi thay đổi fork nằm trong `packages/crew-plugin/**`. Paperclip ghim `v2026.1005.0`.

## 5. File dự kiến chạm

- **Fork `packages/crew-plugin`:**
  - `migrations/0008_docs_storage.sql` (R3 đã giữ `0006`, `0007`);
  - `src/docs/{webhook,data,manifest,graph,status,history}.ts`;
  - `src/storage/data.ts`;
  - `src/usage/{data,rollup}.ts`;
  - `src/attachments/audit.ts`;
  - `src/machines/{webhook,data}.ts`;
  - `src/manifest.ts` (`coreReadTables`, `apiRoutes`);
  - `src/worker.ts`/`src/features.ts` (đăng ký);
  - `src/ui/{docs/index.ts,graph/*,storage/*,usage/*}`;
  - test `src/__tests__/*`;
  - `package.json` (`yaml`).
- **Repo Crew `apps/crew-mac`:**
  - `src/status/docs.ts`, `src/commands/status.ts`, `src/status/report.ts`;
  - `src/files/stats.ts` (mới);
  - test;
  - `docs/flows/{mac-setup,mac-attachments}.md`, `docs/flows.yaml`, `docs/files.md` (sinh).

## 6. Giai đoạn

0. **SP-0:** đo prod chỉ đọc (SQL qua `api.sh psql`), không run Claude. Cổng G0 chốt các giả định ở §9.
1. **Plugin:** DB-1 (migration + webhook + reader) → GR-1 (graph, trạng thái, lịch sử, route agent) → ST-1 (dung
   lượng + cỡ file + nhận `attachmentCache`) → US-1 (usage) → UI-1.
   **Mac** chạy song song: MD-1 (manifest + commit) → MD-2 (`attachmentCache`).
2. RV-1, các ticket sửa.
3. DP-1: backup DB, diễn tập restore, deploy plugin trước rồi mới cài `crew-mac`.
4. AC-R2-5: không run Claude.

## 7. Tiêu chí nghiệm thu (đo được)

- **AC1 dedup:**
  - Repo thử có 10 trang. Gửi snapshot A, sửa 1 trang, gửi B. `docs_blobs` tăng đúng 1 dòng.
  - Logic của project = byte(A) + byte(B). Vật lý = byte(A) + byte trang mới.
  - Project thứ hai cùng nội dung không thêm blob. `sharedBytes` của company bằng byte 10 trang.
- **AC2 lịch sử và chống trùng:**
  - A vẫn đọc được qua `snapshotId`. Gửi lại B nguyên văn thì không có snapshot mới.
  - `snapshotId` của project khác thì lỗi.
- **AC3 toàn vẹn:** sha khai báo sai hoặc blob trùng sha khác byte thì bị từ chối, không có dòng nào ghi thêm (test DB).
- **AC4 graph:**
  - Route agent và data key trả JSON giống hệt nhau cho cùng snapshot. Không có cạnh treo.
  - Có cạnh `ticket-flow` cho một issue có `crew-commit` thật.
  - Agent company khác không đọc được.
  - UI hiện câu `notice`.
- **AC5 trạng thái:** `missing`/`stale`/`invalid`/`unverified`/`current` đúng theo test DB. Trên prod, trạng thái của
  project thật khớp tính tay bằng SQL.
- **AC6 dung lượng:**
  - Số của `crew.storage` khớp truy vấn SQL độc lập.
  - Vật lý company ≤ tổng vật lý từng project.
  - Nhóm `chua_do` hiện "Chưa đo".
  - Cache Mac khớp `du -sk` ±1 %.
- **AC7 usage:**
  - Với một yêu cầu thật có issue con, `direct`, `tree`, từng con khớp SQL độc lập.
  - `tree = direct + Σ con`, không run nào đếm hai lần.
  - Run thiếu số liệu hiện `thiếu`. USD có nhãn ước tính. Không có số % quota.
- **AC8 UI:** Playwright (không run Claude) mở mục Docs (đổi Trang ↔ Đồ thị, chọn snapshot cũ), Dung lượng, panel
  Usage. Có screenshot, không lỗi console.
- **AC9 ràng buộc:**
  - Hook 5/5, `base` `v2026.1005.0`.
  - `git diff crew/r2-2..crew/r2-5 --stat` chỉ trong `packages/crew-plugin/**`.
  - Backup trước migration, diễn tập restore xanh.
  - Plugin `ready` sau deploy. Mac cũ (chưa nâng) gửi snapshot vẫn được nhận.
- **AC10 cỡ dữ liệu:** test DB dựng 200 snapshot × 300 trang (5 % đổi mỗi bản), đo vật lý/logic bằng
  `pg_total_relation_size`, ghi số vào báo cáo.

## 8. Rủi ro

- **Ghi nhiều câu không có transaction:** lỗi giữa chừng để lại snapshot dở. Đã chặn bằng `completed_at` + con trỏ đổi
  sau cùng + dọn dở dang sau 10 phút.
- **Blob chỉ được thêm, không bao giờ xóa** (không tự xóa lịch sử): dung lượng tăng theo số trang thật sự khác nhau.
  AC10 đo.
- **R3 sửa cùng file** (`commands/status.ts`, `status/report.ts`, `machines/webhook.ts`, `manifest.ts`, `worker.ts`):
  luật gộp ở plan.
- **`pg_total_relation_size` có thể bị validator đổi ở bản Paperclip sau:** có đường lui `chua_do`.
- **`result_json` không có `modelUsage` với run cũ hoặc run crash:** khi đó dùng `run_model` và ghi nhãn nguồn.
- **Force-push nhánh mặc định làm `stale` sai:** hiếm, nằm ngoài luật integrator. Ghi trong `reason`.

## 9. Giả định cần đo ở SP-0

- G-a: `heartbeat_runs.result_json` của run `claude_local` trên prod có `modelUsage` theo model.
- G-b: `usage_json` có `costUsd`/`cacheAdjustedCostUsd`. Có bao nhiêu run kết thúc mà thiếu `cost_events`.
- G-c: `billing_type`/`cost_cents` thật của các run (dự kiến `subscription_included`/0).
- G-d: cỡ hiện tại của `docs_pages`, số snapshot, số trang lớn nhất một snapshot, có sha nào lệch nội dung.
- G-e: số issue có `crew-commit` và `crew-merge … pushed=yes` mỗi project (đủ cho AC4/AC5).
- G-f: phiên bản Postgres prod có hàm `sha256()` (PG ≥ 11).
- G-g: `listAttachments` trả `byteSize` và `sha256`.

## 10. Không làm

- Reviewer docs với diff, validator/coverage mới, kiểm merged result: đã có `crew-docs check` và gate R1. R2-5 chỉ đọc
  kết quả.
- Sync theo sự kiện merge và retry riêng: Mac gửi mỗi phút, đủ cho trạng thái `stale`.
- Agent registry, chính sách resume/spawn (MVP2 §5): R2-5 chỉ đếm `freshSession`/`sessionReused`.
- Billing chính thức, giá theo ngày, đổi USD sang VND: không có nguồn hóa đơn.
- Mac chỉ gửi trang đổi (cần thêm vòng hỏi server): body 5 MB hiện vẫn đủ. Đo lại ở AC10.
- Dọn `docs_pages` cũ hay xóa snapshot cũ: cần owner cho phép (Q5).
- Graph database, Understand-Anything: dùng PostgreSQL theo MVP2 §2.

## 11. Câu hỏi cho owner

Plan R2-5 tạm theo phương án khuyên của từng câu. Owner đổi câu nào thì ticket bị ảnh hưởng ghi ở cuối câu.

1. **Hiển thị trước R3.**
   - Khuyên: làm UI tối thiểu ngay trong plugin hiện tại (mục Docs có đồ thị, mục Dung lượng, panel Usage) trên module
     thuần mà R3 dùng lại. Owner xem được ngay, AC8 kiểm được.
   - Phương án khác: chỉ làm data/route, chờ R3 hiện. Rẻ hơn khoảng 1 ticket, nhưng tới R3 mới thấy.
   - Ảnh hưởng: UI-1, AC8.
2. **Ticket trong graph.**
   - Khuyên: nối ticket với flow qua `crew-commit sha=` và danh sách file đổi Mac gửi kèm snapshot (cấu trúc, không suy
     đoán).
   - Phương án khác: graph chỉ có project/flow/file/page, bỏ ticket. Mac không cần gửi commit, `stale` không đo được.
   - Ảnh hưởng: MD-1, GR-1, AC4, AC5.
3. **USD.**
   - Khuyên: hiện USD ước tính của Claude Code (`usage_json.costUsd`) kèm nhãn "ước tính, không phải hóa đơn".
   - Phương án khác: ẩn hẳn USD, chỉ hiện token, vì owner trả theo gói.
   - Ảnh hưởng: US-1, UI-1.
4. **Cache file đính kèm trên Mac vào thống kê.**
   - Khuyên: thêm key tùy chọn `attachmentCache` vào bản tin máy.
   - Phương án khác: chỉ thống kê phía server. Không đụng `report.ts` mà R3 cũng sửa.
   - Ảnh hưởng: MD-2, ST-1, AC6.
5. **Bảng `docs_pages` cũ.**
   - Khuyên: giữ nguyên, không đọc không ghi, thống kê riêng là "bản cũ trước khử trùng". Không xóa dữ liệu khi owner
     chưa cho.
   - Phương án khác: sau khi đối chiếu sha, job dọn `text` của bảng cũ (cần owner cho phép xóa).
   - Ảnh hưởng: DB-1, ST-1.
