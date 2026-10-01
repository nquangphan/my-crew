# Triển khai VPS và vận hành

> Flow `deployment`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow deployment` in ra
> đúng danh sách đó.

## Mục đích

Đưa 2P Crew (API, web, Postgres, backup) lên một VPS Ubuntu chạy Docker Compose, chung máy với một nginx biên
đã có sẵn (`2ps-landing-nginx`, phục vụ site khác trên cổng 80/443), mà không cần Caddy hay cổng host riêng
cho crew. Gồm: build và (re)deploy có rollback, gắn site vào nginx biên không khởi động lại nó, chuyển sang
HTTPS bằng certbot của chính máy đó, seed tài khoản owner, backup đêm và khôi phục có kiểm tra, và cổng CI
build/test/kiểm docs trước khi merge.

## Điểm vào

- `scripts/deploy.sh` — chạy trên VPS, tại `/opt/crew`, sau khi đã giải nén mã nguồn và tạo `.env`.

## Các bước

1. Đưa mã nguồn lên VPS: trên máy dev, `git archive --format=tar.gz -o crew.tar.gz HEAD` rồi
   `scp crew.tar.gz <vps>:/tmp/`; trên VPS `sudo mkdir -p /opt/crew && sudo tar -xzf /tmp/crew.tar.gz -C
   /opt/crew`. Giải nén lại (redeploy) ghi đè cùng thư mục; `.env` và `edge/` không nằm trong archive nên
   không bị đụng.
2. Lần đầu: `deploy/.env.example` → `cp deploy/.env.example .env && chmod 600 .env`, điền `POSTGRES_PASSWORD`
   (`openssl rand -hex 24`), `SESSION_SECRET` (`openssl rand -hex 32`), `CREW_DOMAIN`/`PUBLIC_ORIGIN`; các biến
   còn lại (`COOKIE_SECURE`, `TRUST_PROXY=uniquelocal`, `LOGIN_RATE_LIMIT_PER_MINUTE`, `LOG_LEVEL`,
   `BACKUP_HOUR`, `BACKUP_KEEP_DAYS`) có giá trị mặc định trong `deploy/compose.yml`.
3. `scripts/deploy.sh`: `scripts/lib/common.sh` → `check_env_file()` chặn khi `.env` thiếu, không phải mode
   0600 hoặc thiếu/sai dạng secret; script tự chặn khi `deploy/compose.yml` lỡ publish cổng host (nginx biên
   giữ 80/443); gắn tag `:previous` cho image hiện tại; build image mới; khởi động `crew-postgres`; nếu schema
   đã tồn tại (có bảng `drizzle.__drizzle_migrations`) thì chạy `deploy/backup/backup.sh` (`crew-backup once
   pre-migrate`) trước khi migrate — bỏ qua ở lần deploy đầu; migrate bằng `node dist/db/migrate.js` trong một
   container `crew-api` chạy một lần; `docker compose up -d --wait`; kiểm `http://crew-api:8787/v1/health` và
   `http://crew-web:8080/healthz` từ một container dùng chung `crew-net`. Thất bại thì `rollback_help()` in
   hướng dẫn (không tự làm): xem log, retag image `:previous` thành `:latest` rồi `up -d --no-build`, khôi
   phục dump pre-migrate bằng `scripts/restore.sh <dump> --target crew --yes`. Chỉ đụng tới compose project `crew`.
4. Lần đầu (sau khi `scripts/deploy.sh` chạy xong): `scripts/attach-nginx.sh http` — không khởi động lại
   `2ps-landing-nginx`: `edit_override()` thêm vào `/opt/2ps-landing/docker-compose.override.yml` (backup có
   timestamp trước) một mount read-only `/opt/crew/edge/crew.conf` và network ngoài `crew_crew-net`, dùng
   `deploy/tools/nginx-override.mjs` (chạy trong image `crew-api`, giữ nguyên comment, `docker compose config
   -q` xác nhận cú pháp) để việc này sống sót qua lần recreate nginx sau; rồi áp dụng ngay:
   `docker network connect`, render site bằng `scripts/lib/render-nginx.sh` (dựa vào
   `deploy/nginx/crew-http.conf`/`crew-https.conf`/`crew-locations.inc`) vào `/etc/nginx/conf.d/crew.conf`,
   `nginx -t`, `nginx -s reload`. `nginx -t` thất bại thì script đặt lại conf cũ (hoặc gỡ conf
   mới) và `restore_override()` phục hồi file override, nginx tiếp tục chạy cấu hình cũ. Idempotent, chạy lại không đổi gì.
5. Kiểm nhanh trước khi đăng nhập: `curl -H 'Host: crew.2p-solutions.com' http://127.0.0.1/v1/health` (site
   HTTP mới gắn chỉ dùng để kiểm và phục vụ thử thách ACME — đăng nhập cần HTTPS vì cookie session là `Secure`
   và `PUBLIC_ORIGIN` là `https://`).
6. Một lần: `ssh -t <vps> 'cd /opt/crew && scripts/seed-owner.sh <username>'` — chạy CLI `seed-owner` bên trong
   `crew-api`, hỏi mật khẩu ẩn hai lần (không truyền qua argv, không đọc file, không có mặc định), in đúng một
   dòng xác nhận đã lưu owner, không in mật khẩu hay bất kỳ secret nào.
7. Sau khi DNS của `CREW_DOMAIN` trỏ về VPS: `scripts/enable-https.sh` — kiểm bản ghi A khớp IP máy, ghi một
   file thử vào webroot certbot rồi tải lại qua `http://$CREW_DOMAIN/.well-known/acme-challenge/` (xác nhận
   đường dẫn thử thách tới đúng nginx này), `certbot certonly --webroot -w /var/www/certbot -d $CREW_DOMAIN
   --cert-name $CREW_DOMAIN --keep-until-expiring` trong container `2ps-landing-certbot` (tuỳ chọn
   `CERTBOT_EMAIL`), rồi gọi lại `scripts/attach-nginx.sh https` và kiểm `https://$CREW_DOMAIN/v1/health`.
   Idempotent; thất bại thì dừng lại, site HTTP giữ nguyên. Container certbot tự renew mỗi 12 giờ nhưng nginx
   phải reload mới phục vụ chứng chỉ mới — nếu cơ chế reload của `2ps-landing` không tự làm việc này, chạy tay
   `docker exec 2ps-landing-nginx nginx -s reload` sau khi renew.
8. Các lần deploy sau chỉ còn bước 1 và 3 (đưa mã nguồn lên, `scripts/deploy.sh`) — nginx và HTTPS đã gắn, chỉ
   cần lặp lại khi đổi domain hoặc cấu hình nginx biên.
9. `deploy/backup/backup.sh` (image `crew-backup`, entrypoint là chính script): service chính chạy
   `crew-backup loop` — dump `pg_dump -Fc` mỗi đêm lúc `BACKUP_HOUR` (giờ `Asia/Ho_Chi_Minh`, đặt bằng `TZ` của container) rồi `prune` (xoá dump cũ hơn
   `BACKUP_KEEP_DAYS`, mặc định 14 ngày) vào volume `crew-backups`; `once <label>` (dùng bởi `deploy.sh` với
   label `pre-migrate`), `list`, `latest`, `restore <file> <db>`, `counts <db>` chạy tay qua
   `docker compose run`. Dump chỉ nằm trên chính VPS — chép ra ngoài để an toàn ngoài site là quyết định vận
   hành của chủ dự án, không tự động.
10. `scripts/restore.sh <dump> [--target <db>] [--yes] [--expect-match]` (và `--list`): `<dump>` là `latest`,
    tên file trong volume `crew-backups`, hoặc đường dẫn trên host. Đích mặc định `crew_restore_check` (bản
    scratch cạnh DB thật, in số dòng mỗi bảng: thật vs khôi phục); `--target crew --yes` thay DB thật (dừng
    `crew-api`/`crew-backup` trong lúc khôi phục, khởi động lại, kiểm health). `--expect-match` thoát mã 3 nếu
    một bảng nào lệch số dòng (dùng cho diễn tập khôi phục ngay sau một dump mới).
11. CI (`.github/workflows/ci.yml`, chạy trên push/pull_request cộng tag `v*`/`runtime-v*`, service Postgres
    17): `pnpm install`, typecheck, lint, toàn bộ test (kể cả ma trận vòng đời job scripted của daemon), build
    web, `crew-docs check --range` và `check --all`, build daemon, build desktop (electron-vite), shellcheck
    các script deploy; job `e2e` chạy bộ E2E; job `release` (runner macOS) trên tag `v*` nhập danh tính ký
    code ổn định "2P Crew Code Signing" (secret `CREW_CODESIGN_P12_BASE64`/`CREW_CODESIGN_P12_PASSWORD` vào
    keychain tạm, đặt `CREW_CODESIGN_REQUIRED=1` nếu có — thiếu secret thì build tiếp với cảnh báo, ký ad-hoc
    như trước, flow `runtime-updates`) rồi build dmg và zip từng kiến trúc (arm64, x64) bằng
    `pnpm --filter @crew/desktop package:mac` (không `--publish`, `afterSign` tự ký lại bằng danh tính đó khi
    có), kiểm lại bằng `codesign.mjs verify` khi `CREW_CODESIGN_REQUIRED=1`, rồi một bước riêng tạo đúng một
    GitHub Release cho tag bằng `gh release create` kèm mọi dmg/zip/blockmap và `latest-mac.yml` (workflow
    artifact `mac-release`) — tách hai bước vì publish song song của electron-builder từng tạo release cho
    cùng tag hai lần (v0.1.0 bị chia thành hai bản, một bản thiếu `latest-mac.yml`), nên electron-updater
    không tìm thấy nó. Job `runtime-release` (runner Ubuntu, độc lập với job `release`) trên tag
    `runtime-v<crewRuntime.version>` build và ký bản runtime (secret `CREW_RUNTIME_SIGNING_KEY` — thiếu thì
    publish bản không ký kèm cảnh báo, mọi app/server sẽ từ chối nó), kiểm lại bằng `runtime-bundle.mjs
    verify`, rồi tạo một GitHub Release riêng cho tag đó (`--latest=false`, để `electron-updater` của bản dmg
    không đọc nhầm sang đây) — toàn bộ cơ chế ký/kiểm/nhập bản runtime ở flow `runtime-updates`. Bộ E2E (`e2e/`,
    Playwright ở viewport điện thoại/
    tablet/desktop, chạy `deploy/compose.yml` + `deploy/compose.test.yml` cộng một daemon với config test)
    chạy bằng `pnpm --filter @crew/e2e test:e2e`, cần Docker.

## Files

| Đường dẫn | Vai trò | Symbol chính |
|-----------|---------|--------------|
| `scripts/deploy.sh` | Build, migrate, khởi động, kiểm health, hướng dẫn rollback | `rollback_help` |
| `deploy/compose.yml` | Compose project `crew`: api, web, postgres, backup, network `crew-net`/`crew-db` | — |
| `deploy/Dockerfile` | Build multi-target image (api, web, backup) từ gốc repo, `pnpm install --ignore-scripts`; image api chép thêm `apps/daemon/src/roles/prompts` (bản mặc định của cài đặt prompt, flow `server-settings`) | — |
| `deploy/.env.example` | Mẫu secrets `/opt/crew/.env` (mode 0600, không commit bản thật) | — |
| `deploy/backup/backup.sh` | CLI `crew-backup`: dump đêm, prune, list, latest, restore, counts | `dump_once`, `prune`, `loop`, `restore`, `counts` |
| `deploy/nginx/crew-http.conf` | Site HTTP trước khi có chứng chỉ: `/.well-known/acme-challenge/` và proxy tới crew | — |
| `deploy/nginx/crew-https.conf` | Site HTTPS: cổng 80 chỉ còn ACME và redirect sang HTTPS; 443 với chứng chỉ Let's Encrypt, HSTS, TLS 1.2/1.3, `http2 on` | — |
| `deploy/nginx/crew-locations.inc` | Location dùng chung: `/v1/` SSE-safe tới crew-api, còn lại tới crew-web | — |
| `deploy/web/nginx.conf` | Nginx phục vụ SPA đã build trong container `crew-web` (fallback, `/healthz`) | — |
| `deploy/tools/nginx-override.mjs` | Sửa `docker-compose.override.yml` của nginx biên, giữ comment | `fail` |
| `scripts/lib/common.sh` | Helper dùng chung: `compose()`, kiểm `.env`, đọc domain | `check_env_file`, `compose`, `crew_domain` |
| `scripts/lib/render-nginx.sh` | Render site nginx từ template ra stdout (POSIX sh + awk) | — |
| `scripts/attach-nginx.sh` | Gắn site vào nginx biên không khởi động lại nó | `edit_override`, `install_conf`, `restore_override` |
| `scripts/enable-https.sh` | Xin chứng chỉ certbot của máy chủ, chuyển site sang HTTPS | — |
| `scripts/restore.sh` | Khôi phục dump vào DB scratch hoặc DB thật | `usage`, `backup` |
| `scripts/seed-owner.sh` | Tạo/reset tài khoản owner duy nhất qua CLI trong `crew-api` | — |
| `.dockerignore` | Loại trừ khỏi build context Docker; mở lại ngoại lệ `apps/daemon/src/roles/prompts` dưới quy tắc loại `apps/daemon`, để image api có bản prompt mặc định (flow `server-settings`) | — |
| `.github/workflows/ci.yml` | CI: typecheck/lint/test/build/docs check; release dmg/zip (ký bằng danh tính ổn định khi có secret) trên tag `v*`; release bản runtime đã ký trên tag `runtime-v*` (flow `runtime-updates`) | — |
| `deploy/compose.test.yml` | Lớp test trên `compose.yml` cho E2E: nginx biên `crew-edge` render đúng `crew-http.conf` trên `127.0.0.1:18180`, `COOKIE_SECURE=false`, tắt `crew-backup` | — |

## Dữ liệu

- Bảng: không sở hữu bảng nào (dùng chung `apps/api/src/db/schema.ts`, flow `api-platform`); riêng có volume
  Docker `crew-pgdata` (dữ liệu Postgres) và `crew-backups` (dump) — tarball mỗi bản runtime đã ký nằm trong
  Postgres (`runtime_bundles`, flow `runtime-updates`) nên đi theo cùng dump/backup đêm, không cần thêm gì ở
  compose.
- Sự kiện: không tự phát; endpoint được kiểm là `GET /v1/health` (flow `api-platform`) và `/healthz` của
  `crew-web`.
- Gọi ngoài: `2ps-landing-nginx`/`2ps-landing-certbot` (compose project khác trên cùng VPS, ngoài repo này);
  Let's Encrypt qua certbot; GitHub Releases (job `release` cho tag app, job `runtime-release` cho tag runtime
  — dùng chung cơ chế `gh release create`, flow `desktop-app`/`runtime-updates`).

## Flow liên quan

- api-platform: `scripts/deploy.sh` migrate và khởi động đúng `apps/api` mà flow đó dựng lên; `/v1/health`
  được `deploy.sh` và nginx dùng để kiểm sức khỏe.
- owner-auth: `scripts/seed-owner.sh` tạo tài khoản owner đầu tiên mà flow đó xác thực.
- desktop-app: cùng dùng GitHub Releases của repo để phát hành (app desktop tự kiểm bản mới từ đó); job
  `release` của `.github/workflows/ci.yml` là nơi build dmg và zip (thay cho lệnh tay `package-mac.mjs`) rồi
  tạo release, thay cho lệnh tay `package-mac.mjs --publish`.
- daemon-setup: sau khi VPS đã chạy theo flow này, owner mới cấu hình máy local để trỏ về đúng
  `https://$CREW_DOMAIN`.
- runtime-updates: job `runtime-release` của `.github/workflows/ci.yml` build/ký/publish bản runtime trên tag
  `runtime-v*`; secret `CREW_RUNTIME_SIGNING_KEY`, `CREW_CODESIGN_P12_BASE64`, `CREW_CODESIGN_P12_PASSWORD`
  khai báo cùng chỗ với secret ký app; API env `RUNTIME_RELEASES_REPO`/`RUNTIME_EXTRA_PUBLIC_KEYS` có mặc định
  chạy được ngay (không cần thêm gì vào `.env`/`deploy/compose.yml` để dùng tính năng này). Checklist các bước
  tay khi phát hành một bản runtime mới (trước/trong/sau, quay lui): [Phát hành một bản
  runtime](runtime-updates.md#phát-hành-một-bản-runtime).
- server-settings: `deploy/Dockerfile`/`.dockerignore` đưa bản prompt mặc định của daemon vào image api để
  trang "Cài đặt hệ thống → Prompts" có gì để so sánh/hiện là mặc định.

## Tests

- `e2e/tests/ticket-lifecycle.spec.ts`, `e2e/tests/docs-viewer.spec.ts`: Playwright chạy trên stack
  `deploy/compose.yml` + `deploy/compose.test.yml` thật (không mock API), phủ vòng đời ticket và xem docs ở
  các viewport điện thoại/tablet/desktop.
