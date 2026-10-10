# DP-5 R2-4: deploy `crew/r24` @ `38580c5d7` (FX-RT2) và gắn tag `crew/v3.3`

- Thời gian: 2026-10-10 18:11 → 18:23 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent opus.
- Phạm vi: FX-RT2, gồm 3 commit:
  - `27672bec1`: activity handoff của H2 ghi override thật, ghi null khi H2 xóa override.
  - `356045e65`: H1 kiểm run cũ theo quyết định fallback, bất kể lý do đánh thức.
  - `38580c5d7`: khi đọc bảng quyết định fallback bị lỗi, H1 chỉ giữ run do plugin đánh thức.
- Thay đổi so với `d58730c70`: chỉ 6 file server (`issue-gate.ts`, `load-gate.ts`, `runtime-fallback.ts` và 3 file test). Không có migration, không đổi web. Không cài lại app hay crew-mac.
- Kết quả: **DONE.**
  - Prod chạy `crew-v3/paperclip:v3-38580c5d7`, ổn định sau 5 phút.
  - Công tắc Codex giữ **BẬT**.
  - Đã gắn tag annotated cục bộ `crew/v3.3` trên `38580c5d7`.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-d58730c70` |
| Image sau | `crew-v3/paperclip:v3-38580c5d7` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261010-181640`, đưa về `v3-d58730c70`. Không có migration mới |
| Backup DB | `20261010-1815` (trước deploy, 27M, builtin ok) và bản do `deploy.sh` tự tạo |
| Script ops VPS | Không đổi. Mọi file `ops/*` không phải test trên VPS trùng sha256 với fork, nên không scp |
| Tag | `crew/v3.3` (annotated, cục bộ) trên `38580c5d73597d0af9a0086be6da74c688aad852`. Chưa push. Các tag `crew/v3.3-rc1`…`rc5` giữ nguyên |

## 1. Cổng kiểm

Worktree `.worktrees/paperclip-r3-dp` chạy `git checkout --detach crew/r24`, ra `38580c5d7`, sạch.

`crew/release/verify.sh` **FULL** chạy 18:11:48 → 18:14:25, rc 0, **XANH**:

| Mục | Kết quả |
|---|---|
| check-core-hooks | ok |
| Test vá (core-hooks, plugin-state, policy-config, upgrade, compose, pull-backup) | Đều 0 fail |
| Server crew | 625 test / 29 file. Gồm các file DB handoff, switch, reconcile mới của FX-RT2 |
| Adapter claude / codex / opencode | 17 / 10 / 12 |
| Plugin | 432 test / 51 file |
| Agents | 136 |
| tsc (server, 3 adapter, plugin) | 0 lỗi |
| Bundle plugin | không có `require("react")` trần |

Kiểm thêm:
- ops `node --test crew/ops/*.test.mjs`: 75/75.
- crew-web không phải chạy lại vì `d58730c70..38580c5d7` không đổi web. DP-4 đã chạy và ra 981 test xanh.
- `ipcs -m` trước và sau: 2 → 2.

## 2. Deploy

1. **Chuẩn bị.** `active-runs.sh` rỗng. `backup.sh` cho ra `20261010-1815` ok.
2. **overlay-source.** Chạy `crew/ops/overlay-source.sh 38580c5d7` lúc 18:15:43 → 18:15:48, upload 26 file server. Tarball có 149 mục, gồm `crew-adapter-expect.json`, `crew-commit.txt` = `38580c5d7359…`, `load-gate.ts` và `runtime-fallback.ts`.
3. **Build.** `overlay-job.sh 38580c5d7` chạy 18:15:54 → 18:16:08, `JOB_EXIT rc=0`, `min_avail=5402MiB`.
4. **inspect-image.sh trên VPS:** rc 0.
   - Đủ 12 file crew ok, `plugin events delivered as call ok`, `crew-ui=38580c5d7359…`.
   - Vá adapter P2–P7 kiểm trong image đều ok, sha giống DP-4.
   - Chỉ có `WARNING host adapter check SKIPPED`, đúng như mong đợi.
5. **inspect-image.sh từ Mac** (`DOCKER_HOST=ssh://nhamoiplatform`, theo commit `38580c5d7`): rc 0, 0 MISSING/FAIL/WARN. `crewCoreHooks`: heartbeat 2, environment-runtime 2, issues 3.
6. **Deploy.** Kiểm lại `active-runs` thấy rỗng, rồi chạy `deploy.sh crew-v3/paperclip:v3-38580c5d7` lúc 18:16:33 → 18:17:10, rc 0. Kết quả in ra: `deploy ok: … v3-d58730c70 -> … v3-38580c5d7, rollback TS=20261010-181640`. Log nằm ở `ops/deploy-38580c5d7.log` trên VPS.

## 3. Kiểm sau deploy

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `ok`, commit `38580c5d73597d0af9a0086be6da74c688aad852`, databaseBackup ok |
| Plugin | `plugin-state.sh` trả `healthy` |
| Site | Đều 200: crew `/` (meta `crew-ui=38580c5d7359…`), `/cli-auth/x`, `/paperclip/` (title Paperclip), `2p-solutions.com`, `kidyschool.com` |
| `check-crew-companies.sh` | `ok 2 company` |
| `agent-permissions.sh` | TPS `5befeb1a… --check --assistant 6c27410e…`: rc 0. `--all-crew --check --assistant 6c27410e…`: rc 0. Inbox owner disabled, pipeline 0, tool connection 0 |
| Trang Máy, xem 3 lần qua Playwright, chỉ đọc (18:18:34, 18:19:38, 18:20:42) | Codex `codex-cli 0.161.0 · đã đăng nhập`, quota 31% (đặt lại 16/10 19:59). Công tắc Claude BẬT, **Codex BẬT**, OpenCode tắt. OpenCode vẫn "Chưa có key". Ảnh ở `dp5-shots/` |
| DB `crew_runtime_switches` | `codex_local enabled=t`, `updated_at` 17:54:48. Đây là lần bật lại ở DP-4, sau đó không đổi |
| Bản tin máy TPS sau deploy | 3/3 bản tin có `runtimes.codex`, `loggedIn=true` |
| Log server từ lúc deploy đến 18:22:04 (442 dòng, hơn 5 phút) | 0 `"access_token"`/`"refresh_token"`/`"id_token"`, 0 `Bearer`/`sk-`. 0 `config.get`, `host refused`, `INVOCATION_SCOPE_DENIED`. 0 level 50/60 |
| `active-runs.sh` lúc 18:22 | rỗng |

Log có đúng 1 dòng level 40. Đó là `GET /api/api/companies 404` do em gõ sai đường dẫn khi gọi `api.sh` lúc tìm id company, không phải lỗi của prod.

Không chạy run AC mới, theo phạm vi giao. AC5 đã kiểm hành vi ở DP-4, còn test DB đầu-cuối của FX-RT2 phủ phần reconcile. Số run Codex/Claude trong DP-5: 0/0.

## 4. Tag

```
git tag -a crew/v3.3 38580c5d73597d0af9a0086be6da74c688aad852 \
  -m "Crew v3.3: R2-4 runtime Codex + reviewer Codex, đã nghiệm thu trên prod; OpenCode chờ key"
```

`git cat-file -t crew/v3.3` trả `tag`, `crew/v3.3^{commit}` trỏ `38580c5d7…`, tức đúng commit đang chạy trên prod. Tag chưa push và không xóa tag rc nào.

## 5. Dọn và an toàn

- Playwright chỉ đọc. Email và mật khẩu board lấy từ `.env` VPS và truyền qua stdin, không in ra, không trace, không lưu state.
  - Ghi: sign-in 200 và sign-out 200. Ngoài ra chỉ có các `POST …/data/crew.*` để đọc dữ liệu plugin.
- Log tạm trên VPS (`/tmp/ap1.log`, `/tmp/ap2.log`, `/tmp/dp5.log`) đã `rm -f`.
- Không sửa code. Không có process nền nào còn chạy.
