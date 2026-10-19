# SP-0 — đo prod chỉ đọc (cổng G0)

Giờ đo: 2026-10-10 01:23 (Asia/Ho_Chi_Minh). Chỉ SELECT. Cách chạy: `ssh nhamoiplatform 'docker exec -i crew-v3-spike-db-1 psql -U paperclip -d paperclip -A' < r25-sp0.sql` (SQL qua stdin, đúng chỉ dẫn của Trợ Lý, không qua shim `api.sh`). Không câu nào chọn text docs, body comment hay cột secret. Câu cuối (`machine_latest.report`) có cột đúng, không lỗi.

## Số đo

- **G-f:** Postgres 17.11; `sha256('abc')` = `ba7816bf…15ad` (khớp).
- **G-d:** 2 snapshot (đều là current, `not_current`=0); 11 trang, 28044 byte, trang lớn nhất 5965 byte; snapshot lớn nhất 7 trang (kế đó 4); `sha_mismatch`=0; 11 nội dung khác nhau; `pg_total_relation_size(docs_pages)`=147456.
- **Usage chung:** 246 run, 0 đang active. Theo trạng thái (run / có cost_events): cancelled 124/0, succeeded 107/81, failed 13/4, interrupted 2/0. Không run nào có >1 dòng cost_events. `no_issue`=0 (mọi run có `context_snapshot.issueId`).
- **G-a:** `result_json.modelUsage` có ở 85/246 run (mọi run kết thúc có cost). Model: claude-sonnet-5 (34), claude-haiku-4-5 (26), claude-opus-5 (20), claude-sonnet-4-6 (5). Field mỗi model: costUSD, provider, costBasis, inputTokens, outputTokens, contextWindow, canonicalModel, thinkingTokens, maxOutputTokens, webSearchRequests, cacheReadInputTokens, cacheCreationInputTokens (đủ 4 field token theo luật). Lưu ý tên là `costUSD` (viết hoa USD) trong modelUsage.
- **G-b:** `usage_json` có `costUsd` 85, `cacheAdjustedCostUsd` 85, `usageSource`=per_run 85 (161 run còn lại không có usageSource). Run kết thúc thiếu cost_events: 161 = cancelled 124 + succeeded 26 + failed 9 + interrupted 2.
- **G-c:** cost_events: 85 dòng, tất cả `subscription_included` / `reported` / anthropic / biller anthropic, tổng `cost_cents`=0.
- **G-e:** issue có `crew-commit` (do agent đăng): project a5ed1f8a-…=2, project NULL=20. `crew-merge … pushed=yes`: a5ed1f8a-…=2, NULL=9. Có 20 issue không gắn project (project_id NULL), nên theo project chỉ project a5ed1f8a có dữ liệu; AC4/AC5 theo project nên dùng project đó.
- **G-g:** `crew_attachment_audit`: 17 dòng, sớm nhất 2026-10-09 17:32:26+00 (00:32 10/10 giờ VN); activity `issue.attachment_added` có `details.byteSize`: 30 dòng. `listAttachments` không chạy được ở đây (cần plugin, không được chạy); `sha256` file không có trong activity, khớp ghi chú "Lệch so với spec" mục 1 của plan (không lưu sha file).
- **Bản tin máy (tham khảo Q4):** `machine_latest.report` hiện có key: load1, app, superpowers, version, hostname, cpuCount, sentAt, memFreePct, machineId, checks, companyId, claude, tccPending. Chưa có `attachmentCache` (còn 1 máy, 1 dòng).

## Kết luận G0

G-a: model_usage
G-b: usd=yes finished_no_cost=161
G-c: subscription_included/0
G-d: snapshots=2 pages=11 bytes=28044 max_page=5965 mismatch=0 distinct=11
G-e: commit_issues=a5ed1f8a:2,null:20 pushed=a5ed1f8a:2,null:9
G-f: pg=17.11 sha256=yes
G-g: audited=17 since=2026-10-09T17:32:26Z activity_with_size=30

**G0 ĐẠT** (G-f đạt). Đường plan chọn, tự quyết khi owner vắng:
- G-a model_usage: US-1 giữ nhánh `model_usage`, AC7 đòi như plan.
- G-b usd=yes: US-1 như plan, `estimatedUsd` có số; Q3 giữ phương án A (hiện USD ước tính có nhãn). 161 run kết thúc không có cost_events chủ yếu là run bị hủy/ngắt (126) và 35 run succeeded/failed không ghi cost (UI cần xử lý "không có dữ liệu usage").
- G-c: UI-1 ghi chú: chi phí thật là gói thuê bao (0 cent), USD chỉ là ước tính theo giá API.
- G-d: không có sha lệch trên dữ liệu hiện tại (mismatch=0), nên lý do backfill tính lại sha không được chứng minh bằng dữ liệu; backfill vẫn an toàn. max_page 5965 B << 512 KiB, không cần báo Trợ Lý.
- G-e: có dữ liệu thật cho AC4/AC5 ở project a5ed1f8a; phần lớn commit/merge nằm ở issue không gắn project.
- G-g: ST-1 như plan.
