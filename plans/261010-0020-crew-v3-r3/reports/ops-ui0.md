# OPS-UI0: UI Paperclip gốc để so sánh

Ngày 10/10/2026, giờ Asia/Ho_Chi_Minh.

## URL

**https://crew.2p-solutions.com/paperclip/**

UI Crew vẫn ở `https://crew.2p-solutions.com/`. Đăng nhập một lần là dùng được cả hai, vì chúng cùng origin và
cùng cookie.

## Vì sao dùng đường dẫn con, không dùng subdomain

- DNS `2p-solutions.com` do GoDaddy quản (NS `ns43/ns44.domaincontrol.com`). Không có wildcard:
  `zzz.2p-solutions.com` và `zzz.crew.2p-solutions.com` đều không phân giải. Trên Mac và VPS không có credential
  hay CLI nào của GoDaddy.
- TLS cấp bằng certbot HTTP-01 webroot, mỗi tên một chứng chỉ (`crew.2p-solutions.com`, `2p-solutions.com`,
  `kidyschool.com`). Không có chứng chỉ wildcard.
- Owner không muốn cấu hình DNS và đã chốt dùng đường dẫn con. Cách này không cần bản ghi DNS, không cần chứng
  chỉ mới, không phải sửa Better Auth hay trusted origins, không phải đổi env và không restart server.

## Cách hoạt động

- Edge proxy là container `2ps-landing-nginx` (nginx 1.31, compose `/opt/2ps-landing`). Nó giữ cổng 80/443 cho
  cả ba site. Cấu hình `crew.2p-solutions.com` nằm ở `/etc/nginx/conf.d/crew.conf`, được `docker cp` vào từ
  `/opt/crew-v3-spike/ops/nginx-crew.conf`. Upstream là `http://100.105.105.12:3100`, tức server prod
  `v3-f569bf4a5`.
- Mình chỉ thêm `location /paperclip/`. Location này phục vụ file tĩnh từ
  `/usr/share/nginx/crew-stock-ui/paperclip` trong container nginx, nguồn host ở
  `/opt/crew-v3-spike/stock-ui/paperclip`:
  - `try_files` lùi về `index.html`, đặt `Cache-Control: no-cache`;
  - `assets/` cache immutable;
  - `/paperclip` chuyển hướng 301 sang `/paperclip/`.
- `/api/**` và WebSocket `/api/companies/:id/events/ws` là đường tuyệt đối. Chúng vẫn đi qua `location /` tới
  đúng server prod duy nhất. Không chạy server Paperclip thứ hai, không đụng DB.
- Bản build lấy `ui/` của fork tại `f569bf4a5`, KHÔNG có overlay Crew, và chỉ sửa 2 file (commit `80db65ffb`,
  nhánh `crew/r3-ui0`):
  - `ui/vite.config.ts`: `base` đọc từ `PAPERCLIP_UI_BASE`, mặc định `/`, nên bản build thường không đổi.
  - `ui/src/main.tsx`: `BrowserRouter basename` lấy từ `BASE_URL`. Khi build ở đường dẫn con thì KHÔNG đăng
    ký service worker `/sw.js` (scope `/`), để không chiếm UI Crew ở gốc domain.
- Mốc build nằm ở `https://crew.2p-solutions.com/paperclip/STOCK_UI_BUILD.txt`.
- Server lõi không bị sửa gì.

## Đã làm trên VPS

1. Kiểm `active-runs` → rỗng.
2. `scp` 3 file: `stock-ui.tgz` (434 file, 5,8 MB), `nginx-crew.conf` và `ops/stock-ui.sh` (sha256 trùng fork).
3. Chạy `ops/stock-ui.sh install`:
   - sao lưu `ops/nginx-crew.conf.bak-20261010-072625` và `ops/nginx-crew.conf.pre-stock-ui` (bản không có
     khối mới);
   - `docker cp` file và cấu hình vào container;
   - `nginx -t` ok, rồi `nginx -s reload` (không restart container);
   - kiểm 4 URL đều 200: `crew /`, `crew /api/health`, `2p-solutions.com`, `kidyschool.com`.

## Kiểm cuối

**curl:**

- `/paperclip/` và `/paperclip/TPS/issues` trả `<title>Paperclip`, asset `/paperclip/assets/*` 200.
- `/` và `/TPS/dashboard` vẫn là `2P Crew`, có mốc `crew-ui`.
- `/paperclip/assets/nope.js` trả 404.

**Playwright Node trên Mac** (chỉ xem, trace off, mật khẩu đọc từ `.env` VPS qua stdin, quét không lộ):

- `/paperclip/` hiện form "Sign in to Paperclip". `sign-in` trả 200, sau đó vào `/paperclip/CREA/dashboard`.
- `/paperclip/TPS/issues` hiện danh sách TASKS stock, có TPS-101, TPS-102, TPS-81…TPS-100 (15 mã đầu ghi trong
  json).
- `/paperclip/TPS/dashboard` mở được.
- WebSocket live events nối `/api/companies/<id>/events/ws`, chạy qua proxy cũ.
- `/` vẫn là UI Crew ("2P Crew", có mốc `crew-ui`, trang Tổng quan). Số service worker đăng ký = 0.
- Console chỉ có 401 `get-session` và 403 `/api/adapters`, `/api/companies`, `/api/instance/settings/experimental`
  lúc trước khi đăng nhập (UI stock gọi trước khi có session). Không có lỗi ứng dụng nào khác.
- Ảnh và log: `reports/ui0-shots/`:
  - `01-dang-nhap-paperclip-goc.png`
  - `02-sau-dang-nhap.png`
  - `03-danh-sach-issue-tps.png`
  - `04-dashboard-tps.png`
  - `05-ui-crew-goc-domain.png`
  - `ui0-view.json`

**Sau khi xong:** `active-runs` rỗng, health 200, server prod không bị restart.

## Giới hạn đã biết

- File tĩnh nằm trong lớp ghi của container nginx (giống `crew.conf` hiện nay). Nếu container
  `2ps-landing-nginx` bị tạo lại, chạy `ssh nhamoiplatform /opt/crew-v3-spike/ops/stock-ui.sh reapply`.
- Một số chỗ trong UI stock dùng `<a href="/...">` thô hoặc `window.location.assign` đường tuyệt đối. Bấm vào đó
  sẽ rời `/paperclip/` sang UI Crew. Điều hướng bằng router (sidebar, danh sách, chi tiết) vẫn giữ `/paperclip/`.
- UI stock vẫn hiện các slot do plugin crew.core đóng góp (mục "Crew", "Hướng dẫn" ở sidebar). Đó là dữ liệu
  server, không phải overlay UI.
- UI stock gọi API thật với quyền của người đăng nhập. Chỉ nên dùng để xem và so sánh.

## Cập nhật bản build

Trên Mac, trong `.worktrees/paperclip-r3-ui0` ở đúng commit prod:

```
cd ui && PAPERCLIP_UI_BASE=/paperclip/ pnpm exec vite build --outDir <dir>/paperclip --emptyOutDir
COPYFILE_DISABLE=1 tar -C <dir> -czf stock-ui.tgz paperclip
scp stock-ui.tgz ../crew/ops/nginx-crew.conf nhamoiplatform:/tmp/
ssh nhamoiplatform /opt/crew-v3-spike/ops/stock-ui.sh install /tmp/stock-ui.tgz /tmp/nginx-crew.conf
```

## Cách gỡ

```
ssh nhamoiplatform /opt/crew-v3-spike/ops/stock-ui.sh remove
```

Lệnh này áp lại `ops/nginx-crew.conf.pre-stock-ui`, chạy `nginx -t`, reload và kiểm 4 site; hỏng thì tự trả
cấu hình. File tĩnh để lại cũng vô hại, vì không còn location nào phục vụ chúng.

Muốn trả cấu hình bằng tay thì dùng bản `ops/nginx-crew.conf.bak-20261010-072625`:

```
docker cp <bản> 2ps-landing-nginx:/etc/nginx/conf.d/crew.conf
docker exec 2ps-landing-nginx nginx -t
docker exec 2ps-landing-nginx nginx -s reload
```
