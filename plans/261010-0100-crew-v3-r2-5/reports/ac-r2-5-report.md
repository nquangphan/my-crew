# AC-R2-5 — Nghiệm thu docs graph/dedup, dung lượng, usage (Crew v3, prod `v3-365cabdb7`)

Giờ chạy: 2026-10-10 02:27 → 02:42 (Asia/Ho_Chi_Minh, theo `date`). Không tạo run Claude nào (VPS `active-runs` có 1 run đang chạy của AC-R2-3, không phải của AC này).

## Kết luận

**ĐẠT có 2 điểm chờ owner.** Mọi số của `crew.docs.*`, `crew.storage`, `crew.usage.*` khớp SQL độc lập, cả trên dữ liệu thật lẫn trên project thử tự dọn. Không có lỗi plugin ở console.

Hai điểm không kết luận ĐẠT hẳn:
1. **Panel Usage không hiện ở giao diện issue mặc định** (chat shell ẩn dải tab, `detailTab` không hiện; "Mở map" chỉ có bản đồ + Kiểm docs). Panel chỉ hiện khi bật giao diện classic. Em xem được bằng cách chặn đọc cờ `enableClassicTaskInterface` ở trình duyệt Playwright (client-side, không đổi cài đặt prod).
2. **Cạnh `ticket-flow` chưa có dữ liệu thật**: hai ticket có `crew-commit` của 2ps-landing (TPS-73, TPS-77) chỉ sửa `docs/deployment-guide.md`, file này không thuộc flow nào, nên không cạnh nào đúng luật.

Việc đã làm có ghi: backup VPS `20261010-0235`; 2 project thử + repo Mac thử (đã dọn); 5 snapshot docs của project thử còn lại trong DB (giữ lịch sử theo plan, id trong `processes.md`).

## Bảng tiêu chí

| AC | Kết quả | Bằng chứng |
|---|---|---|
| AC1 dedup | **ĐẠT** | Project thử `r25-ac` (repo 10 trang md + `flows.yaml` 2 flow). Gửi 1: `docs_blobs` 13→24 (+11 = 10 trang + flows.yaml). Sửa `docs/guides/g3.md`, commit, push, gửi 2: 24→25 (**+1**). `status send` thêm 2 lần: vẫn 25. `r25-ac-b` cùng nội dung: 25 (**không tăng**). `crew.storage` `r25-ac`: logic 8133 = 6865 (trang A+B) + 1268 (manifest A+B); vật lý 4210 = SQL blob khác nhau. `r25-ac-b` logic=vật lý=4087. Company: `docsPhysical` 34614 = SQL; `docsShared` 4087 ≥ Σ byte 10 trang (3453); (30404+4210+4087) − 34614 = 4087. Dữ liệu thật cũng dedup: sau DP-1 blobs 11→13 chỉ thêm 2 `flows.yaml` |
| AC2 lịch sử | **ĐẠT** | `crew.docs.history(r25-ac)`: B current `changed={added:0,modified:1,removed:0}`, A `changed=null`. `crew.docs.page(g3, A)` trả bản cũ (không có dòng "Bổ sung…"), `page(g3, B)` có dòng đó. Gửi lặp: `count` không đổi. `crew.docs.tree/page/graph(r25-ac-b, snapshotId=A)`: `{"code":"WORKER_ERROR","message":"Snapshot không thuộc dự án"}`. UI hiện `+0 ~1 −0` và `+0 ~0 −1` ở danh sách Ảnh chụp |
| AC3 toàn vẹn | **ĐẠT** (theo log) | Ledger 01:33: `docs-dedup.db` 13/13; ca sha sai reject "mã băm trang không khớp", ca blob giả reject "trùng mã băm nhưng khác nội dung"; song song ra đúng 1 snapshot. Prod không làm |
| AC4 graph | **ĐẠT một phần, CHỜ OWNER cạnh `ticket-flow`** | `crew.docs.graph(r25-ac)` và route `GET /api/plugins/crew.core/api/docs/graph` giống hệt (`diff` rỗng; 17 node, 24 cạnh; cả 2ps-landing: 29 node, 36 cạnh, 9955 vs 9964 byte chỉ khác bọc `{"data":…}`). 0 cạnh có đầu mút ngoài `nodes`. UI hiện `notice` (ảnh 02, 03, 08). Route từ chối: project của company khác `Dự án không thuộc company hiện tại`, id sai `companyId/projectId không hợp lệ`, `flowId` sai `flowId không hợp lệ`, project chưa docs `404 Dự án chưa có tài liệu`. **Không có cạnh `ticket-flow`**: SP-0 G-e có 2 ticket `crew-commit` ở project a5ed1f8a (TPS-73 `9955ff32…`, TPS-77 `baab85aa…`), cả hai commit chỉ đổi `docs/deployment-guide.md` (SQL `docs_commit_files`), không file nào thuộc flow `trang-chu`/`lien-he`/`seo-metadata`, nên đúng luật `graph.ts` (bỏ ticket không chạm file flow). Không có agent token company khác để thử: dựa test GR-1 |
| AC5 trạng thái | **ĐẠT** | SQL tính tay: 2ps-landing push mới nhất TPS-76 `f0555c61…` có trong `docs_commits`, snapshot hiện hành cùng commit, `verified` → `current` (khớp API). Spike Mac: không `crew-merge pushed=yes`, snapshot `verified` → `current`. Phát triển Crew và r22-sp0-probe: không snapshot → `missing`. `r25-ac` sau khi xóa `docs/index.md` và commit: `crew-docs check` báo R4, exit 1 → snapshot `audit_state=invalid`, `crew.docs.status` `invalid` ("crew-docs check báo lỗi ở commit fbc747e7fdbe."), UI badge "Không hợp lệ" (ảnh 07) |
| AC6 dung lượng | **ĐẠT** | SQL độc lập khớp từng số: 2ps-landing logic 49474 (47628 trang + 1846 manifest), vật lý 25660, bản cũ 23814; Spike Mac 8974/4744/4230; index (liên kết, commit, file) 60/23/85 và 8/27/43; ticket (issue, comment, byte comment) 6/34/19827, 23/32/8231, 10/10/720. `docsPhysical` 30404 = Σ blob khác nhau ≤ Σ `docs.physical` (30404). `tickets.physical` = `chua_do`. Mac: `find … stat` = **13442809** byte (22 file) = `attachmentCache.bytes`, `blobs/` = **10081823** (11 file) = `blobBytes` (sai lệch 0 %). Bảng `crew_attachment_audit`: Σ `byte_size` 10081823 |
| AC7 usage | **ĐẠT** | Yêu cầu thật TPS-64 (2 con TPS-65, TPS-66) và TPS-36 (3 con). TPS-64: `direct` 6 run, input 177298, cache đọc 1710971, output 29810, USD 2.578862. TPS-65: 2 run, 32052/492739/2812; TPS-66: 2 run, 38173/208682/3865. SQL (`result_json.modelUsage` cộng theo model, input = input + cache ghi) khớp từng số cả USD. `tree` 10 = 6+2+2 run; input 247523 = 177298+32052+38173; cache 2412392; output 36487. TPS-36: 12 = 6+6. Run `thieu`: 5/5 run không usage của TPS-64 là `cancelled` (SQL). `notes` đủ 4 câu đúng thứ tự (UI và data key). `crew.usage.summary(7 ngày)`: 171 run, 77 có usage, cửa sổ từ 04/10 00:00 giờ VN, khớp SQL. UI không có `%` cạnh số token (regex `\d\s?%` = false, TPS-64 và TPS-76) |
| AC8 UI | **ĐẠT có điều kiện (xem lỗi L1)** | Playwright 1.60.0, đăng nhập bằng form, chỉ xem, đã đăng xuất (`sign-out` 200, sau đó `/api/companies` 403). 8 ảnh trong `reports/ac-shots/` (01 Docs badge, 02 Đồ thị snapshot cũ, 03 Đồ thị hiện hành, 04 Dung lượng, 05 và 06 Usage TPS-76 và TPS-64, 07 và 08 `r25-ac`). Phím Tab từ tab "Trang" tới "Đồ thị" ngay lần Tab đầu. Snapshot định dạng 1 (chưa có flows.yaml) hiện "Máy chưa gửi docs/flows.yaml (cần crew-mac mới)". Console `error` trên các trang Crew/Docs/Dung lượng: 0. Trên trang issue: 1 lỗi `404 /api/heartbeat-runs/<id>/log` (API lõi Paperclip, không phải plugin). 401/403 lúc trước đăng nhập là gọi của host (`/api/auth/get-session`, `/api/adapters`, `/api/instance/settings/experimental`) |
| AC9 ràng buộc | **ĐẠT** | `check-core-hooks.mjs`: "Hook một dòng: 5/5; mục: 9; lỗi: 0" (4 cảnh báo P1–P4 như cũ). `core-hooks.json` `base` = `v2026.1005.0`. Diff so với đầu R2-3 (`5b5088889..365cabdb7`): 45 file, 0 file ngoài `packages/crew-plugin/**` và `pnpm-lock.yaml`. Lệnh nguyên văn `git diff crew/r2-2..crew/r2-5 --stat` có thêm file `crew/agents/**`, `server/src/crew/**` (60 file) vì DP-1 đã gộp R2-3 vào. Ledger DP-1: backup `20261010-0221`, restore-drill rc0 DRILL OK, plugin `ready`; health `status ok` commit `365cabdb7`; bản tin Mac cũ nhận 19:24:21Z sau deploy 19:23:28Z |
| AC10 cỡ dữ liệu | **ĐẠT** | Ledger DB-1, ca "200 snapshot × 300 trang (đổi 5 %)": `logical`=36 650 750 B (≈ 35 MiB), `physical`=2 006 247 B (≈ 1,9 MiB, ≈ 5,5 % logic), `blobsTotal` (`pg_total_relation_size` docs_blobs)=2 891 776, `pagesTotal`=13 959 168 |
| Dọn | **ĐẠT** | `status remove-repo` hai project (list-repos chỉ còn 2 repo thật); `DELETE /projects` cả hai trả 200 và không còn trong `projects`; `rm -r ~/crew-r25-ac` (không `-f`); `state.json` Playwright đã xóa. Giữ: 5 snapshot docs (6b87f98a, 507758d5, d2881602 của project 7bc15668; 8ce4a23d, e1bd9ce4 của f2db2c0d), `docs_blobs` 13→25, backup `20261010-0235`. Tag `crew/v3.4-rc1` đã có từ DP-1 (xem ghi chú) |

## Lỗi và điểm lệch phát hiện

**L1 (trung bình). Panel Usage không với tới được ở giao diện issue mặc định.**
Nguyên văn trạng thái: trang issue mặc định chỉ có tab `Chat`, `Activity`, `Related work` khi chưa bật classic; bấm "Mở map" ra `Tóm tắt Crew` với `TicketMap` + `DocsCheckPanel`, không có `section[aria-label="Usage"]`. Khi chặn phản hồi `GET /api/instance/settings/experimental` để `enableClassicTaskInterface=true` (chỉ trong trình duyệt Playwright), tab `Crew` hiện và chứa `Usage` (ảnh 05, 06).
Nguyên nhân: `src/ui/summary.tsx` chỉ dựng `TicketMap` và `DocsCheckPanel`; `getIssuePanels()` (gồm `usage`) chỉ dùng ở `src/ui/tab.tsx` (`detailTab`, bị host ẩn: lỗi AC-4-4 đã biết).
Đề xuất: cho `CrewIssueSummaryContent` render thêm các panel đăng ký (hoặc ít nhất `UsagePanel`) khi mở map; hoặc owner bật classic (`enableClassicTaskInterface`) nếu chấp nhận. Owner quyết.

**L2 (nhẹ). Chưa kiểm được cạnh `ticket-flow` trên dữ liệu thật** (xem AC4). Đề xuất: ở yêu cầu thật kế tiếp có agent đăng `crew-commit` cho commit đổi file thuộc flow (ví dụ `src/**` của 2ps-landing), kiểm lại `crew.docs.graph` có node `ticket` và cạnh `ticket-flow`; trước đó tin test GR-1.

**L3 (nhẹ). `crew.docs.tree.receivedAt` lệch định dạng.** `crew.docs.tree` trả `"receivedAt":"2026-10-09 19:25:08.722039+00"` (text Postgres), trong khi `docs.history`, `docs.status`, `docs.graph` trả ISO (`2026-10-09T19:25:08.722Z`). UI không lỗi vì dùng `Date`, nhưng I3 ghi chung một kiểu. Đề xuất `new Date(...).toISOString()` trong `loadDocsTree`.

**L4 (nhẹ). Nhãn cache của máy trong mục Dung lượng.** UI ghi `cache 9,6 MB / 2 GB` lấy `blobBytes` (10081823), còn `attachmentCache.bytes` là 13442809 (12,8 MB, gồm derived/runs/incoming). Đúng I7 (blobBytes là phần GC so với trần) nhưng nhãn "cache" dễ hiểu là tổng. Đề xuất ghi "blob 9,6 MB / trần 2 GB · tổng cache 12,8 MB".

**L5 (nhẹ). Docs mồ côi sau khi xóa project.** `DELETE /projects` xong, snapshot, `docs_commits`, blob của project thử còn nguyên (docs_blobs 25 thay vì 13; `docsPhysical` vẫn tính các blob này, ~4 KB). Đúng ý "không tự xóa lịch sử" của plan, nhưng chưa có đường dọn. Đề xuất ghi vào backlog: job dọn snapshot của project không còn.

**Ghi chú không phải lỗi.**
- 6 dòng `crew_attachment_audit` `unreadable` (17:32 ngày 09/10) không có `byte_size` và issue đã bị xóa nên không tính vào project nào; 11 dòng còn lại (TPS-80, Spike Mac) có cỡ, Σ = 10081823.
- Role trên TPS-64 toàn "Khác" vì issue không thuộc project nào (`crew_project_roles` theo project); TPS-76 có đủ Trợ Lý, Executor, Reviewer.
- Tag: DP-1 gắn `crew/v3.4-rc1` (plan ghi `crew/v3.5`); Trợ Lý chốt tên cuối. AC này không đụng tag.
- Host phủ popup "Introducing Connectors" và toast TPS-81 lên góc ảnh 05 và 06; số liệu đọc bằng `innerText` nên không ảnh hưởng.

## Số đối chiếu chính (lệnh)

- Data key: `ssh nhamoiplatform "/opt/crew-v3-spike/api.sh POST /plugins/crew.core/data/<key> '{\"companyId\":…,\"params\":…}'" </dev/null`.
- Route: `api.sh GET "/plugins/crew.core/api/docs/graph?companyId=…&projectId=…"`.
- SQL chỉ đọc: `docker exec -i crew-v3-spike-db-1 psql -U paperclip -d paperclip -At < file.sql` (schema `plugin_crew_core_0433ea20b6`); file `a4*.sql`, `a5.sql`, `a6.sql`, `u2.sql`, `ac1.sql` trong scratchpad phiên.
- Mac: `find ~/.crew/cache/attachments -type f -exec stat -f %z {} + | awk '{s+=$1} END {print s}'`.

Status: DONE_WITH_CONCERNS
Summary: AC1 đến AC10 và dọn đều ĐẠT, số `crew.docs/storage/usage` khớp SQL; còn L1 (panel Usage chỉ hiện ở giao diện classic) và cạnh `ticket-flow` chưa có dữ liệu thật chờ owner.
Concerns/Blockers: L1 cần owner quyết (sửa `summary.tsx` hoặc bật classic); 5 snapshot docs của project thử giữ trong DB theo plan.
