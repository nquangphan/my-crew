# AC-5 — Nghiệm thu R1-5 (Paperclip v2026.1005.0 trên prod)

Ngày 09/10/2026, giờ Asia/Ho_Chi_Minh. Người chạy: agent Claude (opus), theo dõi ở TPS-63. Máy: Mac mini và server `crew-v3-spike` tại `https://crew.2p-solutions.com`.

## Kết luận

**ĐẠT toàn bộ, sau 2 bản sửa nhỏ ngay trong lúc nghiệm thu.** Prod đang chạy `crew-v3/paperclip:v3-c84154c5a` trên `ghcr.io/paperclipai/paperclip:2026.1005.0`. Không ai push, không tạo tag, nhánh `v3` của fork vẫn nguyên.

Lúc nghiệm thu bắt được **2 lỗi thật mà test không bắt được**. Cả hai nằm trong phần Crew được phép sửa, không đụng lõi. Mỗi bản sửa có test, đã deploy và kiểm lại trên máy thật:

| Mã | Lỗi | Sửa |
|---|---|---|
| AC-5-1 | Tóm tắt Crew trên issue gọi `crew.docsCheck` với `issueId=""` khi `crew.map` chưa trả về. Handler ném "ID không hợp lệ", host trả 502 và console trình duyệt hiện 2 lỗi plugin mỗi lần mở issue. | `dbf543b4c`: `loadDocsCheck` trả `null` khi `issueId` rỗng. ID sai định dạng vẫn bị từ chối. Thêm test `src/docs/docs-check-empty.test.ts` (2 ca). |
| AC-5-2 | Con thứ hai trong gói **không được `--resume`**. Adapter ghi nguyên văn: `Claude session "884fd252-…" does not match the current remote execution identity…` và `…was saved with a different runtime MCP server set and will not be resumed.` Nguyên nhân: `bundle-resume.ts` ưu tiên `mcpServerIdentity` trong session riêng cũ nhất của executor. Session đó lưu lúc 08/10, khi URL MCP còn là `http://100.105.105.12:3100`. Từ khi đổi domain lúc 08:11 ngày 09/10, URL đúng là `https://crew.2p-solutions.com` (md5 identity `5104…` khác `d798…`). Lỗi này không do bản nâng upstream: hàm so khớp của adapter không đổi. | `c84154c5a`: lấy identity mới nhất của cả company/adapter, vì identity là cấp company. Guard của adapter vẫn từ chối khi MCP khác. Thêm test "URL public đã đổi" (đỏ trên code cũ, xanh trên code mới) và sửa test cũ cho đúng hành vi mới. vitest crew 55/55. |

## Tiêu chí

| Cổng | Tiêu chí | Kết quả | Bằng chứng |
|---|---|---|---|
| — | Commit hướng dẫn | ĐẠT | `f40048e79` docs(crew-plugin): "Crew Spike"→"2P Solutions", `crew-stack on=CRE-`→`TPS-`. Chỉ `git add` đúng path. Trình duyệt `/TPS/huong-dan` có "2P Solutions", có `on=TPS-`, không còn `Crew Spike"`, 12/12 ảnh tải được. |
| 1 | `verify.sh` xanh | ĐẠT | Chạy 3 lần: `f40048e79` (09:49–09:53), `dbf543b4c` (09:58–10:02), `c84154c5a` (10:36–10:38). Lần cuối: hook 5/5 (9 mục, 0 lỗi); ops 9+5+8+18; server crew 20 file 390 test; adapter 17; plugin 16 file 36 test; agents 76; typecheck server, adapter, plugin; build plugin; không có `require("react`. |
| 1 | Image | ĐẠT | `inspect-image.sh` trong `deploy.sh` không có MISSING/FAIL. `issues crewCoreHooks=3`. Đủ 11 file `crew/*.js`. Có `dist/ui/index.js` gzip 103 920 byte. `find /app -name "._*"` ra 0. `grep -c 'require("react'` ra 0. Label `crew.base=ghcr.io/paperclipai/paperclip:2026.1005.0`. |
| 1 | Deploy | ĐẠT | 3 lần deploy, lần nào cũng `deploy ok`, `plugin crew.core healthy`. Health `ok/public/<sha>`. `crew.2p-solutions.com`, `2p-solutions.com`, `kidyschool.com` đều 200. Chi tiết ở mục Thay đổi trên server. Migration plugin: `0001_docs`, `0002_machines`, `0003_machine_latest` ở trạng thái `applied`. Dòng `._0001_docs.sql failed` có từ trước AC-4, không còn file. |
| 2 | `crew.map` TPS-52 khớp DB | ĐẠT | `POST /plugins/crew.core/bridge/data` key `crew.map`: 2 nút TPS-52 `done` (4 stage completed) và TPS-53 `done` (1 stage). Cạnh `parent` và `dependency` TPS-53→TPS-52. `diagnostics=[]`. DB: TPS-53 con của TPS-52, `issue_relations` TPS-53 `blocks` TPS-52, `completedStageIds` trùng từng UUID. Kiểm lại trên `dbf543b4c` lúc 10:04: kết quả như trên. |
| 2 | 5 ca webhook từ chối | ĐẠT | `machine-status` lúc 09:55:41 và lần nữa 10:04:35: cả 5 ca trả 502. Delivery `failed` lần lượt `missing_signature`, `bad_signature`, `stale_signature` (lệch 301 giây), `body_too_large` (17 539 byte), `config_unavailable` (companyId lạ). `machine_reports` và `machine_latest` có 0 dòng với machineId thử `…0ac005`. |
| 2 | H5 chặn agent sửa `adapterConfig` | ĐẠT | Key tạm của tro-ly, không có run id. `PATCH /agents/<tro-ly>` với `extraArgs` trả 422, với `command` trả 422, đều `crew_agent_config_forbidden`. md5 `adapter_config` trước và sau như nhau (`d4820f33…`). Key bị thu hồi (`revoked_at` có giá trị), file token tạm đã xóa. Chạy 3 lần: f40048e79, dbf543b4c, c84154c5a (10:49). |
| 2 | Lọc override chặn `extraArgs` | ĐẠT | `POST /issues/TPS-52/children` với `assigneeAdapterOverrides.adapterConfig.extraArgs` trả 422 `crew_override_forbidden`, violations `adapterConfig.extraArgs`. Số con của TPS-52 vẫn là 1. |
| 3 | Issue có tóm tắt Crew và "Mở map" | ĐẠT | `/TPS/issues/TPS-52`: "Crew · 1/1 con xong · Đã xong · docs Đạt". Bấm "Mở map" ra `.react-flow` 2 nút, 2 cạnh. Ảnh `reports/ac-5-shots/ac5-01-issue-map.png`. |
| 3 | Trang Crew có Yêu cầu, Máy, Docs | ĐẠT | `/TPS/crew`: tiêu đề Yêu cầu, Máy, Docs. Máy `Phans-Mac-mini.local` "Trực tuyến", Claude 2.1.294 gói max, Superpowers ghim 6.4.1. Docs repo-a commit `ee77c93` "Đã xác minh". Ảnh `ac5-02-crew-page.png`. |
| 3 | Widget dashboard hiện máy | ĐẠT | "Máy Crew — Phans-Mac-mini.local: trực tuyến · tải 19.86/10". Ảnh `ac5-03-dashboard.png`. |
| 3 | Console không có lỗi plugin | ĐẠT (sau AC-5-1) | Trên `f40048e79`: 2 lỗi `502 …/data/crew.docsCheck` (AC-5-1). Trên `dbf543b4c`: issue, trang Crew, dashboard, hướng dẫn đều 0 lỗi plugin. Còn 1 lỗi `404 /api/issues/<id>/documents/plan`: đây là lõi hỏi tài liệu plan không có, không phải plugin. Các lỗi 502 hàng loạt trong log cả phiên rơi vào lúc server khởi động lại khi deploy, tab vẫn mở. UI plugin của `c84154c5a` giống hệt `dbf543b4c`, vì bản sửa chỉ đổi file server. |
| 4 | `crew-mac doctor` | ĐẠT | 10:05: 18/18 mục ĐẠT, không mục nào khác. |
| 4 | Bản tin máy khoảng 60 giây | ĐẠT | `~/.crew/status-last.json`: 10:06:43, 10:07:49, 10:08:53, 10:09:58, đều HTTP 200, cách nhau 64–66 giây. Lúc đó máy owner tải 7–11. |
| 4 | Yêu cầu nhỏ đi đủ 4 stage tới push | ĐẠT | Xem dòng thời gian TPS-64 bên dưới. origin `ee77c93` → `d453bb8` (10:31:34–39). `crew-merge sha=d453bb85… branch=main pushed=yes` lúc 10:31:42. Issue `done`, `completedStageIds` 4. |
| 4 | Gói 2 con cùng session thấy `--resume` | ĐẠT (sau AC-5-2) | Lần 1, TPS-66 trên `dbf543b4c`: KHÔNG có `--resume`, session mới `90bba61f`, lỗi nguyên văn ở AC-5-2. Lần 2, TPS-67/68/69 trên `c84154c5a`: run `1816291d` của TPS-69 có `resumeFromRunId=d829ff5a` (run executor TPS-68), `resumeSessionParams.sessionId=330119f0-55e4-4a84-b7a6-9a80fd770a79`, md5 MCP identity `d798…` khớp. `adapter.invoke` lúc 10:46:06 có `--resume 330119f0…`, log init cùng session `330119f0`. Retry `87ec0cc6` cũng `--resume` đúng session đó và làm tiếp (đã `git switch -c crew/TPS-69`). |
| 4 | Ảnh chụp docs đổi sang commit vừa push | ĐẠT | `docs_current` đổi sang `d453bb852`, `audit_state=verified`, `check_exit=0`, nhận lúc 10:32:12. Chậm hơn push khoảng 35 giây, tức một nhịp job 60 giây. |
| 5 | Restore (UP-4) | ĐẠT (dẫn chiếu) | Ledger 08:55: `restore-drill.sh` trên backup 20261009-0828 báo DRILL OK, 77 issue, 203 run, API `status=done`, project restore đã dọn. |
| Dọn | Cancel issue thử, 0 run active, không còn process mồ côi | ĐẠT | TPS-67/68/69 bị cancel lúc 10:48:12. TPS-64, TPS-65, TPS-66 đã `done` (push thật trên repo thử). `active-runs.sh` rỗng. Không có run queued/running/scheduled_retry. Issue mở duy nhất là TPS-63 (theo dõi AC-5). Trên Mac: 0 process `crew-claude-run`, `.paperclip-runtime`, `paperclip-bridge`. Hai process `claude --resume` 22 ngày tuổi là phiên của owner, không phải agent. Có 0 thư mục `crew-mac-docs-*`. |

### Dòng thời gian TPS-64 (bản `dbf543b4c`)

Các mốc wake, lease release và run mới đều đo từ `heartbeat_runs`. Không có wake tay bằng comment. Bước "Owner duyệt" do người nghiệm thu duyệt thay trên repo thử, giống AC-4.

| Giờ | Sự kiện |
|---|---|
| 10:11:12 | Board tạo TPS-64, giao tro-ly. Run `86125f4f` queued. |
| 10:13:23 | Run tro-ly bắt đầu sau 2 phút 11 giây chờ load gate. Tải Mac 11,1, ngưỡng 8, nên run phải chờ. Đây là đúng thiết kế. |
| 10:16:23–24 | Con TPS-65 (`crew-bundle id=greet seq=1`, sonnet) giao mac-claude. Run `a7707106` chạy ngay. 10:16:47 tạo TPS-66 (seq=2). |
| 10:17:26 | Run tro-ly 1 succeeded. Run tro-ly 2 `ac386952` bắt đầu ngay, ghi blocker cho 2 con. Gốc sang `blocked` lúc 10:18:09. |
| 10:18:18 → 10:18:21 | Executor PATCH sang reviewer. Run `a7707106` cancelled `issue_reassigned` (đúng thiết kế). Run reviewer `1ced16aa` bắt đầu sau 3 giây. |
| 10:19:22–28 | TPS-65 `done` (reviewer duyệt; run reviewer kết thúc 10:19:28). TPS-66 hết bị chặn (`issue_blockers_resolved`). Run executor `a0958b26` bắt đầu 10:19:22, không `--resume` (AC-5-2). |
| 10:21:38 → 10:21:39 | TPS-66 sang reviewer. Run `c46a6b7b` bắt đầu 10:21:39, succeeded 10:22:43. TPS-66 `done`. |
| 10:22:38 | Gốc được đánh thức. Run tro-ly `b39925ff` ghi `crew-assistant done`. 10:23:46 sang reviewer. |
| 10:23:47 → 10:25:11 | Reviewer gốc `8fe8139d`: `crew-review root … verdict=approved`. 10:25:12 sang integrator. |
| 10:25:12 → 10:28:09 | Integrator `faaab907`: `crew-docs-check commit=d453bb85… range=ee77c93..d453bb8 exit=0`, test 29/29. 10:28:09 sang stage `approval` của user. |
| 10:29:33 | Người nghiệm thu duyệt: board `PATCH status=done` kèm comment. Integrator `915adde5` bắt đầu 10:29:34. |
| 10:31:34–39 | origin `main` đổi `ee77c93` → `d453bb8`. 10:31:42 `crew-merge … pushed=yes`. 10:31:56 gốc `done` (4/4 stage). |
| 10:32:12 | Ảnh chụp docs `d453bb852` verified. |

## Lệnh đã dùng

```sh
# fork worktree (kiểm git rev-parse --show-toplevel trước mọi lệnh ghi)
bash crew/release/verify.sh
bash crew/ops/overlay-source.sh                      # build plugin, đóng gói, scp lên VPS
ssh nhamoiplatform '/opt/crew-v3-spike/ops/overlay-job.sh <short>'
ssh nhamoiplatform 'cd /opt/crew-v3-spike && ./ops/deploy.sh crew-v3/paperclip:v3-<short>'
curl https://crew.2p-solutions.com/api/health; curl -w '%{http_code}' https://{2p-solutions.com,kidyschool.com}
# Cổng 2: api.sh (phiên board) và psql trong crew-v3-spike-db-1; curl 5 ca webhook từ Mac qua Tailscale
# H5/H4: key tạm qua POST /agents/<tro-ly>/keys, token chỉ nằm trong file mktemp 0600 trên VPS, urllib, DELETE key
# Cổng 3: Playwright MCP; cookie board nạp từ file (không in ra lệnh)
~/.crew/bin/crew-mac doctor; cat ~/.crew/status-last.json
```

Bẫy mới: chạy `docker exec -i` hay `api.sh` trong heredoc `ssh … bash -s` sẽ ăn hết stdin của script. Lần chạy H5 đầu tiên dừng sau truy vấn đầu, không tạo key nào. Cách tránh: chép script sang VPS rồi chạy, mọi lệnh con đều `</dev/null`.

## Thay đổi trên máy và server

- **Fork, nhánh `sync/paperclip-v2026.1005.0`** (chưa push): `f40048e79`, `dbf543b4c`, `c84154c5a` nằm trên `258fe3aac`. Worktree sạch.
- **Server:**
  - Image `crew-v3/paperclip:v3-c84154c5a`.
  - Mốc rollback theo thứ tự: `20261009-095405` (về `v3-258fe3aac`), `20261009-100252` (về `v3-f40048e79`), `20261009-103847` (về `v3-dbf543b4c`).
  - Backup DB `20261009-0954`, `-1002`, `-1010` (trước TPS-64), `-1038`, `-1039` (trước TPS-67).
- **Dữ liệu prod:**
  - Issue thử: TPS-64…66 `done`, TPS-67…69 `cancelled`. Con TPS-68 đã có commit trên nhánh agent nhưng chưa merge.
  - Repo thử `repo-a-origin.git` `main` = `d453bb8`.
  - 4 key agent tạm, tất cả đã thu hồi.
  - Delivery webhook failed thử: 10 dòng.
- **Phiên board của `api.sh`:** lúc nạp cookie vào Playwright, tool đã in nguyên token phiên ra transcript của agent. Không có trong báo cáo hay ledger. Đã xử lý: sign-out phiên đó (200), đăng nhập lại bằng thông tin trong `.env` (giá trị không qua argv), token mới khác token cũ, `api.sh` dùng được.
- **Mac:** không đổi gì ngoài thư mục tạm của phiên này. Không bật process nền nào còn sống.

## Còn lại

- Push fork (`sync/paperclip-v2026.1005.0` → `v3`) chờ owner nói "push".
- Minor:
  - Run resume đầu tiên của TPS-69 (`1816291d`) `adapter_failed`, exit 255 sau 7 giây, `result.subtype=success` rỗng. Có vẻ SSH bị ngắt. Retry 1/2 tự chạy lại và resume đúng. Nếu lặp lại thì cần xem.
  - Trang Crew có 2 tiêu đề "Docs" lặp nhau, cùng kiểu lỗi "Máy" ở AC-4.
  - Trang Crew hiện "Lỗi: Tailscale" cho máy trong khi `doctor` báo Tailscale ĐẠT. Chưa điều tra.
- Lần chạy AC-5 tốn khoảng 13 run Claude: 1 luồng đủ (TPS-64) và nửa luồng kiểm resume (TPS-67, hủy ngay khi có bằng chứng).
