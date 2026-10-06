# Process, lịch chạy và thay đổi môi trường của R1-1

Mọi thứ đang bật hoặc đã thêm cho R1-1, kèm cách tắt hoặc gỡ. Cập nhật mỗi khi bật hoặc tắt. Không ghi credential ở đây.

## VPS `nhamoiplatform` (RT-3, 06/10/2026)

Đo trước khi làm (14:33):
- `data/paperclip` 3,8 MB, `data/pgdata` 85 MB.
- Đĩa `/` còn 32 GB trống.
- RAM available khoảng 5,2 GB.
- Docker Compose v5.1.1.
- Backup có sẵn của Paperclip: `databaseBackup.status = ok`, file mới nhất `paperclip-20261006-072839.sql.gz`.

| Thứ | Chi tiết | Bật lúc | Trạng thái | Cách tắt hoặc gỡ |
|---|---|---|---|---|
| `/opt/crew-v3-spike/ops/` (chmod 700) | `active-runs.sh`, `backup.sh`, `restore-drill.sh`, `backup-serve.sh`, chép từ `crew/ops/` của fork (nhánh `crew/rt3-backup`) | 14:34 | có | `rm -rf /opt/crew-v3-spike/ops` |
| `/opt/crew-v3-spike/backups/daily/` (chmod 700) | Mỗi bộ gồm `db-<TS>.dump`, `paperclip-data-<TS>.tar.gz`, `config-<TS>.tar.gz`, `issues-<TS>.txt`; thêm file `LATEST`. Khoảng 2,4 MB một bộ. `backup.sh` tự xoá file cũ hơn 14 ngày | 14:34 | có 3 bộ: `20261006-1434`, `20261006-1439`, `20261006-1453` | `rm -rf /opt/crew-v3-spike/backups/daily` (cần owner cho phép) |
| `/opt/crew-v3-spike/backups/backup.log` | log của lịch backup | 14:39 | có | xoá cùng thư mục |
| systemd timer `crew-v3-spike-backup.timer` và service `crew-v3-spike-backup.service` | `/etc/systemd/system/`. Chạy `backup.sh` lúc 03:30 hằng ngày (giờ VPS +07); `Persistent=true` nên chạy bù sau khi máy tắt. Lần đầu kích tay lúc 14:39: `Result=success` | 14:39 | enabled; lần kế tiếp Wed 2026-10-07 03:30 | `systemctl disable --now crew-v3-spike-backup.timer && rm /etc/systemd/system/crew-v3-spike-backup.{service,timer} && systemctl daemon-reload` |
| `/etc/cron.d/crew-v3-spike-backup` | Đặt lúc 14:39 rồi gỡ ngay: VPS không cài gói `cron`, nên file này không bao giờ chạy | 14:39 | đã gỡ | không còn |
| Dòng thứ 3 trong `/root/.ssh/authorized_keys` | Từ 14:54 (vòng sửa 1): `restrict,from="100.102.189.67",command="/opt/crew-v3-spike/ops/backup-serve.sh" ssh-ed25519 [key] crew-backup-pull-mac-mini` (key không in ở đây). Bản 14:42 dùng `from="100.64.0.0/10"` và liệt kê từng `no-*`. Bản sao trước mỗi lần sửa: `/root/.ssh/authorized_keys.bak-crew-backup-pull-20261006` (trước khi thêm dòng), `/root/.ssh/authorized_keys.bak-crew-backup-pull-round1` (trước khi siết) | 14:42, sửa 14:54 | có | `sed -i '/crew-backup-pull-mac-mini/d' /root/.ssh/authorized_keys` (hoặc chép lại bản `.bak-crew-backup-pull-20261006`) |
| Compose project `crew-v3-spike-restore` và `/opt/crew-v3-spike/restore-drill` | Từ vòng sửa 1, diễn tập chạy trong phạm vi spike; chỉ tồn tại trong lúc diễn tập (lần cuối 14:53–14:54), script tự gỡ khi thoát. Lần đầu (14:34–14:39) dùng `crew-v3-restore` và `/opt/crew-v3-restore-drill`; cả hai đã gỡ, đã kiểm `ls` lúc 14:53 | — | đã gỡ, đã kiểm `docker ps -a` và `ls` | không còn |

Stack `crew-v3-spike` không bị restart. `crew-v3-spike-server-1` vẫn chạy image `crew-v3-spike/paperclip:in-place-6ab1aa8`.

## Mac mini `phans-mac-mini` (RT-3, 06/10/2026)

| Thứ | Chi tiết | Bật lúc | Cách gỡ |
|---|---|---|---|
| SSH key kéo backup | `~/.ssh/crew_backup_pull_ed25519` và `.pub` (comment `crew-backup-pull-mac-mini`, fingerprint `SHA256:w3mLC7/hZMbgbkwjg3UPGzdtS+d5dOp55cEBtHEv2Mk`). Chỉ dùng được với forced command ở trên | 14:42 | `rm ~/.ssh/crew_backup_pull_ed25519 ~/.ssh/crew_backup_pull_ed25519.pub`, và gỡ dòng trên VPS |
| `~/.ssh/crew_backup_pull_known_hosts` | host key ed25519 của `100.105.105.12`, đã đối chiếu fingerprint `SHA256:Ui99CkboyenlJskmpmSrNLgo4Zjtn1AaAu3WcuzW+xk` với `/etc/ssh/ssh_host_ed25519_key.pub` trên VPS | 14:42 | `rm ~/.ssh/crew_backup_pull_known_hosts` |
| `~/crew-backups/` (chmod 700) | `bin/pull-backup.sh` (chép từ `crew/ops/pull-backup.sh`), `vps/<TS>/` (bản sao, giữ 14 ngày), `pull.log` | 14:42 | `rm -rf ~/crew-backups` (cần owner cho phép, vì là bản sao backup) |
| LaunchAgent `com.2p.crew-backup-pull` | `~/Library/LaunchAgents/com.2p.crew-backup-pull.plist`, chạy `pull-backup.sh` lúc 04:15 hằng ngày. Đã kích một lần lúc 14:43: exit 0 | 14:43 | `launchctl bootout gui/$(id -u)/com.2p.crew-backup-pull && rm ~/Library/LaunchAgents/com.2p.crew-backup-pull.plist` |

Không có process nền chạy lâu do RT-3 bật. Timer và LaunchAgent chỉ chạy theo lịch.

## VPS — RT-4a deploy (06/10/2026, 15:30 đến 15:40)

| Thứ | Chi tiết | Trạng thái | Cách tắt, gỡ hoặc rollback |
|---|---|---|---|
| Image overlay `crew-v3/paperclip:v3-1b85a07ed` | Dựng trên `ghcr.io/paperclipai/paperclip:2026.1001.0` từ `crew/r1-1` `1b85a07ed`. Transpile 7 file server; có thêm `/app/packages/crew-plugin` (bản build bằng `tsc`) và symlink tới plugin SDK. Watchdog RAM: available thấp nhất 5135 MiB | đang chạy `crew-v3-spike-server-1` từ 15:32:53; health `ok`, commit `1b85a07edfd434f729412e6c2fd219fbe426cb48` | Rollback: (1) `./api.sh POST /plugins/e29d3a17-f50b-4863-9005-ebf98119558d/disable`, vì image cũ không có `/app/packages/crew-plugin`; (2) `/opt/crew-v3-spike/ops/rollback.sh 20261006-153253`, về `crew-v3-spike/paperclip:in-place-6ab1aa8` theo `docker-compose.yml.bak-20261006-153253`. Từ `ba1824536`, `rollback.sh` tự chờ health và exit 3 nếu không `ok`; nếu API không gọi được thì có thể bỏ qua bước (1), plugin sẽ báo `error` cho tới khi disable nhưng không ảnh hưởng server |
| `docker-compose.yml` | `image:` của `server` đổi sang image trên; thêm `stop_grace_period: 60s`. Bản cũ: `docker-compose.yml.bak-20261006-153253`; image cũ ghi ở `ops/previous-image-20261006-153253` | có | như dòng trên |
| Backup trước deploy | `backups/daily/*-20261006-1532.*` (do `deploy.sh` gọi `backup.sh`). Thêm bộ `20261006-1530` từ lần thử `flock` | có | giữ theo vòng xoay 14 ngày |
| `ops/` mới | `overlay-job.sh`, `deploy.sh`, `rollback.sh`, `inspect-image.sh`, `overlay-1b85a07ed.{tar.gz,log}`, `overlay-da5430cbb.{tar.gz,log}` (lần build đầu, image đã xoá). `backup.sh` có thêm `flock` (lần chạy thứ hai cùng lúc thì exit 6) | có | xoá file trong `ops/` |
| Plugin `crew.core` | id `e29d3a17-f50b-4863-9005-ebf98119558d`, cài từ đường dẫn local `/app/packages/crew-plugin`; `ready`, `healthy`, 1 event subscription; capabilities `events.subscribe, issues.read, issues.update, issue.comments.create` | ready | `./api.sh POST /plugins/<id>/disable` hoặc `DELETE /plugins/<id>` |
| Agent `mac-claude` (`37a9e834-…`) | `adapterConfig.command = /Users/phannhatquang/.crew/bin/crew-claude-run`. Agent đã **pause** (trước đó ở trạng thái `error`), vì wrapper chưa cài trên Mac mini. Vẫn gán environment `mac-mini` | paused | Bật lại sau khi owner cài `crew-mac`: `./api.sh POST /agents/<id>/resume`. Bỏ wrapper: xoá key `command` khỏi `adapterConfig` |
| Environment `mac-mini` (`f92f5dd8-…`) | metadata `crewLoadGate: { maxLoad1: 8, maxWaitMinutes: 60 }`: đúng plan theo ruling của Trợ Lý (15:45; trước đó 15/30); giữ `workspaceRealizationMode: in_place` | active | Tắt cổng tải: PATCH metadata bỏ key `crewLoadGate` |
| Image cũ còn giữ | `crew-v3-spike/paperclip:in-place-6ab1aa8` (đích rollback), `s5-gate-acfa0cf`, `in-place-5f28832`, khoảng 7,3 GB mỗi image (dùng chung layer gốc) | không chạy | `docker image rm <tag>` khi owner cho |
| File sót từ S5 | `data/paperclip/crew-load-gate.json` (image mới không đọc) | không dùng | `rm /opt/crew-v3-spike/data/paperclip/crew-load-gate.json` |

Script ops trên VPS từ `ba1824536`: `deploy.sh` (chạy `inspect-image.sh` trước, gặp `MISSING`/`FAIL` thì từ chối; đổi image bằng `compose-set-image.py`), `rollback.sh`, `compose-set-image.py` (mới). sha256 khớp commit.

## RT-4b (06/10/2026, 15:58 đến 16:36)

| Thứ | Chi tiết | Cách gỡ |
|---|---|---|
| Environment `mac-mini` | Cấu hình đổi: `knownHosts` là host key mới của sshd agent (`SHA256:UeSt0eAbsCJuudADVkJAxsutlwIPccY70RE4lMn4FKQ`, khớp `~/.crew-mac/sshd/host_ed25519` trên Mac mini); `remoteWorkspacePath = /Users/phannhatquang/crew-agents/mac-claude`. Metadata giữ `in_place` và `crewLoadGate {8, 60}` (lúc thử có tạm đổi sang 0.5/60 và 8/1, đã trả lại 8/60). Probe pass | PATCH lại `config` |
| `/opt/crew-v3-spike/ssh/known_hosts` | Thay dòng `[100.102.189.67]:2222`. Bản cũ: `known_hosts.bak-20261006-rt4b` | chép lại bản `.bak` |
| Worktree agent mới trên Mac mini | `~/crew-agents/mac-claude`, nhánh `agent/mac-claude-r1` từ `main` `b66cd7c` của `~/crew-spike/repo-a`; `.paperclip-runtime/` đã có trong `info/exclude`. Có 8 commit thử. Worktree cũ `~/crew-spike/worktrees/mac-claude` để nguyên | `git -C ~/crew-spike/repo-a worktree remove ~/crew-agents/mac-claude && git -C ~/crew-spike/repo-a branch -D agent/mac-claude-r1` |
| Agent `mac-claude` | Đã **resume** (`idle`), chạy qua wrapper `~/.crew/bin/crew-claude-run`, model `claude-haiku-4-5` | `POST /agents/<id>/pause` |
| Issue thử | `CRE-5`, `CRE-8`, `CRE-11` → `cancelled`. Mới: `CRE-12` (smoke), `CRE-13`/`14`/`15` (hủy), `CRE-16` (restart), `CRE-17` (mất mạng), `CRE-18` (quá tải), `CRE-19` (offline), `CRE-20` (hết hạn) | đóng hoặc hủy khi xong nghiệm thu |
| Script thử trên VPS | `/opt/crew-v3-spike/rt4b-issue.sh`, `/opt/crew-v3-spike/rt4b-gate.sh` | `rm` |
| Backup và diễn tập | Bộ `20261006-1635`; diễn tập `DRILL OK`, đã gỡ | không cần |
