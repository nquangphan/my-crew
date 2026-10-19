# R2-5 — Gói `probe` (SP-0, cổng G0)

Đọc trước: [plan.md](plan.md) (Global Constraints, Interface I2, I6), spec §2.4, §9.

## SP-0: đo prod chỉ đọc

**Model:** sonnet. **Không run Claude, không ghi DB, không deploy.**

**Files:**
- Create: `plans/261010-0100-crew-v3-r2-5/reports/sp-0-probe.md`
- Modify: `plans/261010-0100-crew-v3-r2-5/{sdd-ledger.md,processes.md}`

**Interfaces:**
- Consumes: shim `ssh nhamoiplatform /opt/crew-v3-spike/ops/api.sh psql` (đọc SQL từ stdin, như R2-2 AC5).
- Produces: `reports/sp-0-probe.md` có mục `## Kết luận G0` với đúng các dòng `G-a: …` tới `G-g: …` theo "Luật G0".

- [ ] **Bước 1: Ghi bắt đầu.** Ghi một dòng vào cuối `sdd-ledger.md`:
  `- <date '+%Y-%m-%d %H:%M'> SP-0 bắt đầu (sonnet)`. Lấy giờ bằng `TZ=Asia/Ho_Chi_Minh date`.

- [ ] **Bước 2: Viết file SQL trong scratchpad, không nhúng vào chuỗi `ssh`.** Tạo
  `<scratchpad>/r25-sp0.sql`:

```sql
\pset pager off
\echo G-f version
SHOW server_version;
SELECT encode(sha256(convert_to('abc', 'UTF8')), 'hex') AS sha_abc;
\echo G-d docs
SELECT count(*) AS snapshots FROM plugin_crew_core_0433ea20b6.docs_snapshots;
SELECT count(*) AS pages, sum(octet_length(text)) AS bytes, max(octet_length(text)) AS max_page_bytes FROM plugin_crew_core_0433ea20b6.docs_pages;
SELECT snapshot_id, count(*) AS pages FROM plugin_crew_core_0433ea20b6.docs_pages GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
SELECT count(*) AS sha_mismatch FROM plugin_crew_core_0433ea20b6.docs_pages WHERE sha256 <> encode(sha256(convert_to(text, 'UTF8')), 'hex');
SELECT count(*) AS distinct_content FROM (SELECT DISTINCT encode(sha256(convert_to(text, 'UTF8')), 'hex') FROM plugin_crew_core_0433ea20b6.docs_pages) d;
SELECT count(*) AS not_current FROM plugin_crew_core_0433ea20b6.docs_snapshots s WHERE NOT EXISTS (SELECT 1 FROM plugin_crew_core_0433ea20b6.docs_current c WHERE c.snapshot_id = s.id);
SELECT pg_total_relation_size('plugin_crew_core_0433ea20b6.docs_pages'::regclass) AS docs_pages_total;
\echo G-a G-b G-c usage
SELECT count(*) AS runs, count(*) FILTER (WHERE status IN ('queued','running')) AS active FROM heartbeat_runs;
SELECT r.status, count(*) AS runs, count(ce.heartbeat_run_id) AS with_cost FROM heartbeat_runs r LEFT JOIN (SELECT DISTINCT heartbeat_run_id FROM cost_events) ce ON ce.heartbeat_run_id = r.id GROUP BY 1 ORDER BY 2 DESC;
SELECT heartbeat_run_id, count(*) FROM cost_events WHERE heartbeat_run_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1 LIMIT 5;
SELECT billing_type, cost_status, provider, biller, count(*), sum(cost_cents) AS cents FROM cost_events GROUP BY 1,2,3,4 ORDER BY 5 DESC;
SELECT count(*) FILTER (WHERE usage_json ? 'costUsd') AS has_cost_usd, count(*) FILTER (WHERE usage_json ? 'cacheAdjustedCostUsd') AS has_cache_adj, count(*) FILTER (WHERE usage_json ? 'usageSource') AS has_source, count(*) FILTER (WHERE result_json ? 'modelUsage') AS has_model_usage, count(*) AS total FROM heartbeat_runs WHERE finished_at IS NOT NULL;
SELECT usage_json->>'usageSource' AS source, count(*) FROM heartbeat_runs GROUP BY 1;
SELECT jsonb_object_keys(result_json->'modelUsage') AS model, count(*) FROM heartbeat_runs WHERE result_json ? 'modelUsage' GROUP BY 1 ORDER BY 2 DESC;
SELECT jsonb_object_keys(r.result_json->'modelUsage'->(SELECT jsonb_object_keys(r.result_json->'modelUsage') LIMIT 1)) AS field FROM (SELECT result_json FROM heartbeat_runs WHERE result_json ? 'modelUsage' ORDER BY finished_at DESC LIMIT 1) r;
SELECT count(*) AS finished_no_cost FROM heartbeat_runs r WHERE r.finished_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cost_events c WHERE c.heartbeat_run_id = r.id);
SELECT count(*) AS no_issue FROM heartbeat_runs WHERE (context_snapshot->>'issueId') IS NULL;
\echo G-e markers
SELECT i.project_id, count(DISTINCT c.issue_id) AS issues_with_commit FROM issue_comments c JOIN issues i ON i.id = c.issue_id WHERE c.author_agent_id IS NOT NULL AND c.body ~ '^crew-commit sha=[0-9a-f]{40}' GROUP BY 1;
SELECT i.project_id, count(*) AS pushed FROM issue_comments c JOIN issues i ON i.id = c.issue_id WHERE c.author_agent_id IS NOT NULL AND c.body ~ '^crew-merge sha=[0-9a-f]{40} branch=\S+ pushed=yes' GROUP BY 1;
\echo G-g attachments
SELECT count(*) AS audited, min(checked_at) AS since FROM plugin_crew_core_0433ea20b6.crew_attachment_audit;
SELECT count(*) AS with_size FROM activity_log WHERE action = 'issue.attachment_added' AND details ? 'byteSize';
\echo machine report keys
SELECT jsonb_object_keys(report) AS key, count(*) FROM plugin_crew_core_0433ea20b6.machine_latest GROUP BY 1;
```

  Nếu `machine_latest` không có cột `report` thì xem DDL `migrations/0003_machine_latest.sql` của fork và sửa câu cuối
  cho đúng tên cột, ghi lại trong báo cáo.

- [ ] **Bước 3: Chạy.**
  `ssh nhamoiplatform /opt/crew-v3-spike/ops/api.sh psql < <scratchpad>/r25-sp0.sql > <scratchpad>/r25-sp0.out 2>&1`
  - Kỳ vọng: không có `ERROR` ngoài câu cuối (nếu sai tên cột).
  - Shim `api.sh` không nhận stdin hoặc không có lệnh `psql` thì đọc `crew/ops/` của fork để tìm cách R2-2 AC5 đã dùng.
    Ghi cách đó vào báo cáo, không tự sửa shim.

- [ ] **Bước 4: Viết `reports/sp-0-probe.md`.**
  - Mục `## Số đo`: dán đầu ra rút gọn (không dán text docs hay body comment; các câu SQL trên không chọn những cột đó).
  - Mục `## Kết luận G0`: viết đúng 7 dòng theo luật dưới.

- [ ] **Bước 5: Ghi ledger.** Thêm một dòng có giờ: kết luận G-a…G-g rút gọn. Ghi processes.md: file scratchpad đã
  xóa hay giữ.

### Luật G0

| Mục | Điều kiện | Ghi | Ảnh hưởng plan |
|---|---|---|---|
| G-a | `has_model_usage` > 0 và field có `inputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, `outputTokens` | `G-a: model_usage` | US-1 giữ nhánh `model_usage` |
| G-a | ngược lại | `G-a: run_model` | US-1 chỉ dùng `cost_events.model`; vẫn viết nhánh `model_usage` (dữ liệu tương lai) nhưng AC7 không đòi |
| G-b | `has_cost_usd` hoặc `has_cache_adj` > 0 | `G-b: usd=yes finished_no_cost=<n>` | US-1 như plan |
| G-b | bằng 0 | `G-b: usd=no …` | US-1 trả `estimatedUsd: null` mọi nơi; Q3 coi như B |
| G-c | in bảng billing | `G-c: <billing_type>/<cents>` | ghi chú cho UI-1 |
| G-d | luôn | `G-d: snapshots=<n> pages=<n> bytes=<n> max_page=<n> mismatch=<n> distinct=<n>` | `mismatch` > 0 chứng minh lý do backfill tính lại sha; `max_page` > 512 KiB thì báo Trợ Lý (giới hạn trang của webhook) |
| G-e | luôn | `G-e: commit_issues=<theo project> pushed=<theo project>` | 0 thì AC4/AC5 trên dữ liệu thật ghi "không có dữ liệu" |
| G-f | `server_version` ≥ 11 và `sha_abc` = `ba7816bf…15ad` | `G-f: pg=<bản> sha256=yes` | không đạt thì **dừng**: DB-1 cần sha tính bằng Node, sửa I2 và hỏi owner |
| G-g | luôn | `G-g: audited=<n> since=<ts> activity_with_size=<n>` | ST-1 như plan |

G0 **đạt** khi G-f đạt. Các mục khác chỉ chỉnh ticket như bảng, không chặn.
