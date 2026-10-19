# RV-1 — Review toàn nhánh R2-5 trước deploy

Giờ: 2026-10-10 01:52 → 01:59 (Asia/Ho_Chi_Minh, theo `date`). Reviewer: opus. Chỉ đọc và chạy test. Không sửa code,
không commit, không push, không đụng `~/.crew`, sshd, app hay prod.

Phạm vi:
- Repo Crew: `79728c9..r2-5` (`a4595a1`, 3 commit: 14cee88, 1f3daed, a4595a1). 11 file, +528/−27.
- Fork: `734a049f1..crew/r2-5` (`ffd189eb8`, 5 commit: 43a8d026f, c084fc232, 412ff76e1, 0b67c8868, ffd189eb8). 45 file,
  +3107/−155. Mọi file nằm trong `packages/crew-plugin/**` và `pnpm-lock.yaml` (đã kiểm bằng `--name-only`).

## 1. Kết quả lệnh (tầng phát hành)

| Lệnh | Nơi chạy | Kết quả |
|---|---|---|
| `pnpm -r typecheck` | worktree crew-r25-mac | exit 0 (crew-mac, docs-kit, mac-app) |
| `pnpm -r test` | worktree crew-r25-mac | exit 0. crew-mac 47 file/827 ca, mac-app 38 file/403 ca (+24 ca node:test), docs-kit 3 file/43 ca. Dòng `error: No such remote 'origin'` là stderr của git trong fixture, không phải ca đỏ |
| `pnpm lint` | worktree crew-r25-mac | exit 0, biome soát 293 file, không có lỗi |
| `crew-docs check --range 79728c9..r2-5` | worktree crew-r25-mac | `ok (3 commits)` |
| `crew/release/verify.sh` | worktree paperclip-r25-plugin, 01:54:02 → 01:56:07 | **XANH**, exit 0. Hook 5/5, 9 mục, 0 lỗi; 4 cảnh báo P1–P4 "chưa có PR upstream" như cũ. node:test 9+5+8+18 ca. Server crew 22 file/431 ca. adapter 3 file/17 ca. **Plugin 33 file/133 ca**. agents 102 ca. `tsc` cho 3 gói và build plugin đều xanh, `no_bare_react_require` đạt |

Trước khi chạy, `ipcs -m` có 1 đoạn nhớ dùng chung không ai giữ (`0x5110a261`, không có tiến trình postgres). Đoạn này
không do RV-1 tạo, nên RV-1 để nguyên. Sau `verify.sh` không còn tiến trình postgres nào và số đoạn vẫn như cũ.
`git status` của cả hai worktree vẫn sạch. Không có lệnh nào treo; lượt đầu tiên hỏng vì máy không có `timeout`, đã
chạy lại không dùng `timeout`.

Kiểm thêm:
- `core-hooks.json` có `base: v2026.1005.0`.
- `yaml` được bundle vào `dist/worker.js`: không còn `require("yaml")`, `external` chỉ có react và sdk/ui.
- **Nhánh R2-3 đã có commit mới mà R2-5 chưa có:**
  - repo: `r2-3` @ `9b927ea`, thêm 3 commit (2df1589, 445bf07, 9b927ea);
  - fork: `crew/r2-3` @ `5b5088889`, thêm 1 commit (`crew/agents/assistant.md` + test).
  - `git merge-tree --write-tree` cả hai chiều đều không xung đột.

## 2. Finding

Không có blocker về code. Có 2 major, cả hai là điều kiện vận hành cho DP-1, và 7 minor.

### Major

**M1. Sau khi áp `0008`, rollback chỉ image thì không còn sạch: webhook docs cũ hỏng và docs mới trống trên UI cũ.**
Gói: plugin (quyết định) + ops (DP-1).
- File, dòng:
  - `migrations/0008_docs_storage.sql:30`: `docs_commits.first_snapshot_id … REFERENCES docs_snapshots(id)` không có
    `ON DELETE`;
  - webhook cũ (`crew/r2-2`, `src/docs/webhook.ts:91` và `:128`) xóa mọi snapshot không hiện hành cũ hơn 10 phút;
  - `crew/ops/rollback.sh` chỉ đổi compose/image, không đụng DB.
- Kịch bản: deploy R2-5 → cài crew-mac R2-5 → có ≥ 2 snapshot định dạng 2. Bản cũ hơn giờ không hiện hành nhưng vẫn được
  `docs_commits` trỏ tới. Lúc đó chạy `rollback.sh <TS>`:
  1. Lệnh `DELETE` đầu tiên của webhook cũ vi phạm FK. Mọi `docs-snapshot` của project đó trả 500 vĩnh viễn, dù Mac là
     bản cũ hay mới (xem m1: webhook cũ nhận khóa lạ).
  2. Reader cũ đọc `docs_pages`, nhưng snapshot do plugin mới ghi chỉ có dòng trong `docs_snapshot_pages`. Vì vậy mục
     Docs trên UI cũ hiện cây rỗng cho mọi project đã nhận snapshot sau deploy.
  3. Project không có `docs_commits` thì webhook cũ xóa hẳn lịch sử R2-5 (cascade `docs_snapshot_pages`; blob vẫn còn).
  4. crew-mac R2-5 gửi bản tin máy có `attachmentCache`. Plugin cũ kiểm khóa chặt (`fields()`) nên từ chối cả bản tin,
     và máy thành "mất tin" trên UI.
- Đề xuất: không bắt buộc sửa code. DP-1 phải ghi thủ tục rollback R2-5 vào ledger trước bước 5:
  - (a) Rollback sau khi đã cài crew-mac R2-5 thì cài lại crew-mac bản cũ, tức bản build đang chạy hiện nay, cùng lúc.
  - (b) Rollback image sau `0008` thì chấp nhận docs ngừng cập nhật cho tới khi deploy lại, hoặc restore DB bằng TS của
    bước 3 khi owner đồng ý (đúng Global Constraints).
  - (c) Muốn rollback image an toàn hơn thì sửa `0008` trước khi áp lần đầu (còn được vì chưa áp ở đâu). Đổi
    `first_snapshot_id` sang cột cho phép NULL kèm `ON DELETE SET NULL`. Webhook cũ khi đó không vỡ FK, chỉ xóa lịch sử.
    Cần thêm 1 ca test DB. Đây là đổi schema nên cần owner quyết.
  - RV-1 khuyên (a) + (b), không sửa code.

**M2. Phải gộp R2-3 mới nhất vào hai nhánh R2-5 rồi chạy lại cổng trước khi deploy.** Gói: ops (DP-1).
- Như mục 1: repo thiếu 3 commit của `r2-3`, fork thiếu `5b5088889`. Nếu prod đã chạy R2-3 thì DP-1 bước 4 sẽ tự phát
  hiện qua tag image. Nhưng crew-mac R2-3 (`2df1589`, `9b927ea` sửa crew-mac) chỉ có trên Mac mini nếu đã cài. Cài
  crew-mac từ `r2-5` khi chưa gộp sẽ gỡ mất tính năng BMAD và dọn workflow của R2-3 trên Mac.
- Đề xuất: Trợ Lý `git merge r2-3` vào `r2-5` và `git merge crew/r2-3` vào `crew/r2-5` (merge-tree cho thấy sạch).
  Sau đó chạy lại `pnpm -r test`, `pnpm lint`, `crew-docs check --range` (đổi `docs/flows.yaml`/`files.md` thì
  `crew-docs generate`) và `verify.sh`, rồi mới DP-1.

### Minor

**m1. Docs sai lý do của thứ tự deploy: webhook docs cũ không từ chối khóa lạ, nó nhận im lặng.** Gói: mac (docs).
- `docs/flows/mac-setup.md:265` viết "vì webhook cũ từ chối khóa lạ". Dòng 250 lại viết "server cũ coi như Mac cũ",
  hai câu mâu thuẫn nhau. `validateDocsSnapshot` của `crew/r2-2` không kiểm khóa thừa, nên `format/manifest/commits`
  bị bỏ qua và trả 200.
- Kịch bản: cài crew-mac R2-5 trước plugin. Webhook cũ trả 200, Mac ghi `format: 2` + `lastCommit`
  (`src/commands/status.ts:333`) và không bao giờ gửi lại. Manifest và danh sách commit của commit đó mất cho tới
  commit sau. Bản tin máy thì đúng là bị từ chối (dòng 210 của docs đúng).
- Đề xuất: sửa câu 265 thành: "webhook docs cũ bỏ qua `format/manifest/commits` mà vẫn trả 200, nên Mac sẽ không gửi
  lại; bản tin máy có `attachmentCache` bị plugin cũ từ chối". Câu tương ứng trong ledger MD-1 cũng sai. Thứ tự deploy
  giữ nguyên.

**m2. Route agent trả nguyên message lỗi nội bộ (≤ 200 ký tự).** Gói: plugin.
- `src/docs/api.ts:31`. Lỗi DB do host bọc có dạng `Failed query: <SQL>…`, nên body 400 có thể chứa SQL có tên
  namespace. Không lộ dữ liệu của company khác (tham số là của chính caller), nhưng là chi tiết nội bộ trả cho agent.
- Đề xuất: chỉ trả các message đã biết (`Snapshot không thuộc dự án`, `ID không hợp lệ`, `flowId không hợp lệ`, lỗi
  scope dự án). Lỗi khác trả `{error:"Không đọc được đồ thị docs"}` và chỉ ghi log warn như hiện nay.

**m3. `fillSizes` có thể không bao giờ tới các dòng cũ hơn.** Gói: plugin.
- `src/attachments/audit.ts:252–255`. Truy vấn lấy `LIMIT 200` trước, rồi mới lọc các issue "đã tra" bằng JS. Khi 200
  dòng mới nhất chưa có cỡ đều thuộc issue đã tra mà không lấp được (file đã xóa), các dòng cũ hơn không được xét nữa
  cho tới khi worker khởi động lại.
- Prod hiện có 17 dòng nên chưa xảy ra.
- Đề xuất: đẩy danh sách issue đã tra vào SQL (`issue_id NOT IN (jsonb)`), hoặc lấy theo trang.

**m4. Số đính kèm `logic` và USD ước tính là cận dưới nhưng nhãn không nói rõ.** Gói: plugin (UI).
- `src/storage/data.ts:126–127`: `attachments.logical` chỉ cộng các dòng đã có `byte_size`. UI có hiện "(n chưa có cỡ)"
  nên chấp nhận được.
- `src/ui/usage/index.ts:19`: thẻ hiện `≈ $x` khi chỉ một phần run có ước tính, nhưng không hiện `estimatedUsdRuns`.
  Mức đầy đủ "Một phần" có hiện bên cạnh. Không vi phạm luật "thiếu không thành 0", vì run `thieu` không cộng vào và
  có đếm riêng.
- Đề xuất cho R3: hiện "USD ước tính (k/n lượt)".

**m5. Ô chọn Flow của đồ thị tự thu hẹp.** Gói: plugin (UI).
- `src/ui/graph/docs-graph.tsx:63` dựng option từ `graph.nodes`. Sau khi chọn một flow, server chỉ trả flow đó, nên muốn
  sang flow khác phải về "Tất cả flow" trước. Nằm trong phạm vi UI tối thiểu; ghi lại cho R3 hoặc AC8.

**m6. `blobBytes` có thể lớn hơn `bytes` khi GC chạy giữa hai lượt duyệt.** Gói: mac.
- `apps/crew-mac/src/files/stats.ts:51` và `:54` duyệt `blobs/` trước, rồi duyệt cả gốc sau. Nếu GC xóa blob ở giữa thì
  `blobBytes > bytes`. Plugin khi đó bỏ cả key (`machines/webhook.ts`, luật `blobBytes <= bytes`) và Dung lượng hiện
  "Chưa đo" cho lượt đó. Lượt sau tự hết.
- Đề xuất: tính `bytes` và `blobBytes` trong một lượt duyệt (cộng riêng khi đường dẫn nằm dưới `blobs/`).

**m7. Hạ cấp rồi nâng lại crew-mac có thể để snapshot định dạng 1 làm hiện hành.** Gói: mac.
- `status-repos.json` vẫn giữ `format: 2` khi bản cũ ghi đè `lastCommit`, vì bản cũ chép nguyên item. Khi nâng lại,
  commit không đổi thì `continue`, nên snapshot hiện hành vẫn là bản định dạng 1 (manifest `not_sent`) cho tới commit
  sau. Chỉ xảy ra khi rollback crew-mac. Liên quan M1 (a): sau khi rollback crew-mac rồi nâng lại, xóa `format` khỏi
  `status-repos.json` để Mac gửi lại một lần.

### Đã soát, không thấy lỗi (kèm nguồn)

1. **Migration 0008 trên dữ liệu prod** (2 snapshot, 11 trang, sha lệch 0):
   - host áp cả file trong một transaction có advisory lock (`server/src/services/plugin-database.ts` `applyMigrations`),
     lỗi giữa chừng thì lui hết;
   - không có `DROP` hay `DELETE`; `docs_pages` giữ nguyên;
   - `ADD COLUMN … DEFAULT` hằng số chạy tức thì trên PG 17;
   - backfill băm lại bằng `sha256(convert_to(text,'UTF8'))`, khớp với `Buffer` utf8 của JS;
   - snapshot hiện hành được `completed_at` và `content_key = 'legacy:<id>'`, không đụng khóa 64 hex;
   - ca `migration backfill` áp 0001–0005, chèn dữ liệu (có sha giả), rồi áp 0008 qua host thật, và khẳng định blob,
     trang, snapshot, reader cùng `docs_pages` còn 3 dòng.
   - Không có `;` trong chuỗi.
   - R3 về sau thêm 0006/0007 vẫn áp được, vì host xét theo từng key.
2. **Webhook:**
   - sha từng trang được tính lại trước mọi lần ghi (`webhook.ts:125`);
   - manifest kiểm sha và giới hạn 512 KiB;
   - blob trùng sha được so cả byte lẫn text trước khi bất kỳ dòng nào trỏ tới nó; lệch thì từ chối, log chỉ có sha
     12 ký tự;
   - staging chỉ hiện ra khi đặt `completed_at`. Unique partial index cộng với bắt lỗi rồi tìm bản thắng (có
     test `Promise.all`, có kiểm đột biến) cho đúng 1 snapshot;
   - lỗi sau khi hoàn tất (commit, con trỏ) tự lành ở lần gửi lại qua `adopt`;
   - `docs_commits` chỉ ghi sau khi hoàn tất nên không bao giờ trỏ vào staging.
   - **R7:** manifest được quét dưới tên tạm. Path commit được quét theo từng dòng; docs-kit báo theo từng dòng
     (`secret-scan.ts` `scanBuiltIn`), không chỉ dòng đầu. Path có ký tự điều khiển bị bỏ ở cả hai đầu với cùng ngưỡng
     1024.
3. **Phạm vi:**
   - data key nhận `companyId` do host chèn và đè lên params (`worker-rpc-host.ts:1926`), sau `assertCompanyAccess`;
   - route agent: host `assertCompanyAccess(req, query.companyId)`, nên agent company B không đọc được A; handler kiểm
     lại và kiểm project;
   - `resolveSnapshot` trả cùng một lỗi cho id lạ và id của project khác (không lộ qua khác biệt lỗi);
   - ticket chỉ lấy từ comment của agent, issue không ẩn, cùng project;
   - usage: cây CTE dừng ở issue ẩn, `cost_events`/`heartbeat_runs` lọc `company_id`;
   - storage: mọi truy vấn lọc company. `pluginTables` là tổng toàn plugin đúng như spec I5.
4. **Số liệu:**
   - mỗi run có đúng một chủ (`cost_events.issue_id` trước, rồi tới context);
   - `tree = direct + Σ children.tree` theo tập run;
   - run đang chạy không cộng;
   - run thiếu có mức `thieu` và được đếm riêng;
   - cộng theo `runId` nên không cộng trùng;
   - token đầu vào cộng cả cache ghi, khớp `claudeModelUsageTotals` của adapter (`parse.ts:49`);
   - `cacheAdjustedCostUsd` khớp `resolveCacheAdjustedCostUsd` của host;
   - USD `null` thì hiện "—".
5. **Bản tin máy:** `attachmentCache` sai dạng thì chỉ bỏ key đó; khóa lạ khác vẫn bị từ chối như cũ. Thứ tự deploy
   plugin trước crew-mac là bắt buộc (xem m1 về lý do đúng).
6. **Lõi:** diff fork chỉ nằm trong plugin và lockfile. Lockfile chỉ thêm `yaml@2.9.1` và đổi chuỗi peer của
   vite/vitest, không đổi phiên bản. Hook 5/5.
7. **Docs repo Crew:** `crew-docs check --range` đạt. `stats.ts` và test của nó đã vào khối `mac-attachments`. Mục
   "Ảnh chụp docs" và "Bản tin máy" khớp code, trừ m1.

## 3. Kết luận

**Deploy được, kèm điều kiện.** Code của cả hai nhánh đạt mọi cổng tầng phát hành. Không có finding nào làm mất dữ
liệu cũ hay lộ dữ liệu khác company khi đi theo đường tiến. Điều kiện trước và trong DP-1:

1. (M2) Gộp `r2-3` → `r2-5` và `crew/r2-3` → `crew/r2-5`, chạy lại full suite repo Crew + `verify.sh` cho xanh.
2. (M1) Ghi thủ tục rollback R2-5 vào ledger trước khi deploy: rollback image phải đi cùng rollback crew-mac nếu đã
   cài, và nói rõ docs ngừng cập nhật (hoặc restore DB khi owner đồng ý). Nếu owner chọn (c) thì sửa `0008` trước khi
   áp lần đầu.
3. Giữ thứ tự: plugin lên prod → thấy Mac cũ gửi được (AC9) → mới cài crew-mac khi 0 run.

Minor m1–m7 không chặn deploy. m1 (docs) và m2 nên sửa trong một FX nhỏ, lúc nào cũng được; m3–m7 để R3 hoặc lần sau.

Status: DONE_WITH_CONCERNS
Summary: R2-5 qua mọi cổng (repo Crew: typecheck/test 827+403+43/biome/crew-docs xanh; fork verify.sh xanh, plugin 133 ca, hook 5/5). Không có blocker về code, deploy được kèm điều kiện.
Concerns/Blockers: M1 — sau `0008`, rollback chỉ image làm webhook docs cũ vỡ FK `docs_commits.first_snapshot_id`, và UI cũ hiện docs rỗng; DP-1 phải ghi thủ tục rollback (kèm crew-mac cũ, hoặc restore DB). M2 — phải gộp R2-3 mới nhất (repo 3 commit, fork 1 commit) và chạy lại cổng trước DP-1. Minor: docs mac-setup.md:265 nói sai lý do thứ tự deploy (webhook docs cũ nhận im lặng khóa lạ).
