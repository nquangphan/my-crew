# Process, container và thay đổi môi trường của spike stock-first

Mọi thứ đang bật hoặc đã thêm cho spike, kèm cách tắt/gỡ. Cập nhật mỗi khi bật hoặc tắt. Không ghi credential ở đây.

## VPS `nhamoiplatform` (`crew-v3-spike-vps`, Tailscale 100.105.105.12)

| Thứ | Chi tiết | Bật lúc | Trạng thái | Cách tắt/gỡ |
|---|---|---|---|---|
| Compose project `crew-v3-spike` | `/opt/crew-v3-spike/docker-compose.yml` | 06/10/2026 09:52 (S1) | đang chạy | `cd /opt/crew-v3-spike && docker compose down` |
| Container `crew-v3-spike-server-1` | image `ghcr.io/paperclipai/paperclip:2026.1001.0`, cổng `100.105.105.12:3100`, `restart: unless-stopped`, `mem_limit 2g` | 09:52 (S1) | đang chạy | như trên |
| Container `crew-v3-spike-db-1` | image `postgres:17-alpine`, không publish cổng ra host | 09:52 (S1) | đang chạy | như trên |
| Network `crew-v3-spike_default` | bridge do compose tạo | 09:52 (S1) | có | tự xoá khi `docker compose down` |
| Image đã pull | `ghcr.io/paperclipai/paperclip:2026.1001.0` (khoảng 1,9 GB), `postgres:17-alpine` | 09:50 (S1) | có | sau khi down: `docker image rm ghcr.io/paperclipai/paperclip:2026.1001.0` (chỉ xoá `postgres:17-alpine` nếu không stack nào khác dùng) |
| Thư mục dữ liệu | `/opt/crew-v3-spike` gồm `.env`, `.board-cookies`, `api.sh`, `ssh/` (key Paperclip, known_hosts), `data/pgdata`, `data/paperclip` | 09:53 (S1) | có | sau khi down: `rm -rf /opt/crew-v3-spike` |

Stack `crew` v1 (`/opt/crew`), `kidy-*`, `2ps-landing*` không bị đụng.

## Mac mini `phans-mac-mini` (Tailscale 100.102.189.67, user `phannhatquang`)

| Thứ | Chi tiết | Ai tạo | Cách gỡ |
|---|---|---|---|
| `~/.zshenv` | đưa `claude` vào PATH cho phiên SSH không tương tác | Trợ Lý, trước S1 | xoá file (hoặc dòng đã thêm) nếu trước đó chưa có `~/.zshenv` |
| Dòng key trong `~/.ssh/authorized_keys` | public key ed25519, comment `crew-v3-spike-paperclip` | S1, 09:55 | `sed -i '' '/crew-v3-spike-paperclip/d' ~/.ssh/authorized_keys` |
| `~/crew-spike/workspaces/` | do probe environment của Paperclip tự `mkdir -p` (`remoteWorkspacePath`) | S1, 09:56 | `rm -rf ~/crew-spike` khi xong spike |

Không có process nền nào do spike bật trên Mac mini hay MacBook ở S1.
