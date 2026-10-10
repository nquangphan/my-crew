# DP-3 R2-4: deploy `crew/r24` @ `d3ab1ef78` (FX-OPS5 + FX-PL5), cài crew-mac `23670d7` (FX-MR5)

- Thời gian: 2026-10-10 16:10 → 16:28 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent opus.
- Phạm vi:
  - FX-OPS5 `632e3808c`: `overlay-source.sh` ghi `crew-adapter-expect.json` vào tarball; `inspect-image.sh` kiểm vá adapter P2–P7 bên trong image.
  - FX-PL5 `d3ab1ef78`: webhook bản tin máy làm sạch từng trường của khối `runtimes` (`sanitizeRuntimes`).
  - FX-MR5 `23670d7` (repo Crew `r24`): crew-mac đo `runtimes` song song, có cache.
  - Không có migration mới. Không cài lại app Mac (`git diff b76059f..r24 -- apps/mac-app` rỗng).
- Kết quả: **DONE.**
  - Prod chạy `crew-v3/paperclip:v3-d3ab1ef78`, plugin ready. Không phải rollback.
  - `inspect-image.sh` mới đã nằm trên VPS và chạy được trong `deploy.sh`.
  - Từ lúc cài crew-mac mới (16:19), mọi bản tin đều có `codex.version` và `codex.loggedIn`. Trang Máy hiện Codex ổn định cả 5 lần xem.
  - Owner bật công tắc Codex lúc 16:25:52. Em không đụng vào công tắc.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-8fdd145c3` |
| Image sau | `crew-v3/paperclip:v3-d3ab1ef78` |
| Lệnh rollback prod | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261010-161555`, đưa về `v3-8fdd145c3`. Không có migration mới. `rollback.sh` không gọi `inspect-image.sh`, nên image cũ không có manifest vẫn lui được |
| Backup DB | `20261010-1614` (làm tay), `20261010-1615` (`deploy.sh`). Cả hai 26M, builtin ok |
| Script ops VPS cũ | cả thư mục ở `/opt/crew-v3-spike/ops.bak-dp3-r24/`; thêm `ops/{inspect-image.sh,inspect-adapters.mjs,overlay-source.sh}.bak-dp3-r24` |
| crew-mac cũ | `~/.crew/app/crew-mac.bak-dp3-r24` (= `b76059f`, cli.js `2beda8b1…`) và `~/.crew/app/crew-mac.prev` (do `installCrewMacFrom` tạo) |
| Tag cục bộ | `crew/v3.3-rc4` (annotated) trên `d3ab1ef78`. Chưa push |

Cách lui crew-mac (chỉ khi 0 run): dời `~/.crew/app/crew-mac` đi, `ditto ~/.crew/app/crew-mac.bak-dp3-r24 ~/.crew/app/crew-mac`, rồi `~/.crew/bin/crew-mac setup`.

## Bước 1: cổng kiểm

Worktree `.worktrees/paperclip-r3-dp` chạy `git checkout --detach crew/r24` (`d3ab1ef78`, sạch).

**verify.sh** chạy 16:11:05 → 16:13:42, rc 0, **XANH**.

| Mục | Kết quả |
|---|---|
| Server crew | 616 |
| Adapter claude / codex / opencode | 17 / 10 / 12 |
| Plugin | 430 (DP-2: 429, FX-PL5 thêm 1) |
| Agents | 136 |
| tsc | 0 lỗi |
| Bundle | không có `require("react")` trần |

Kiểm thêm: ops `node --test crew/ops/*.test.mjs` 75/75. `ipcs -m` trước và sau giống nhau.

## Bước 2: deploy prod

1. **Chuẩn bị.** `active-runs.sh` rỗng, image đang chạy `v3-8fdd145c3`. `backup.sh` → `20261010-1614` ok. Sao lưu `ops/` vào `ops.bak-dp3-r24`.
2. **So hash.** Có 3 file lệch giữa VPS và fork: `inspect-image.sh`, `inspect-adapters.mjs`, `overlay-source.sh`. Các file `ops/*.sh`, `*.py` và `nginx-crew.conf` còn lại trùng nhau.
3. **overlay-source.sh mới** (`crew/ops/overlay-source.sh d3ab1ef78`): rc 0, 16:14:48 → 16:14:53, upload 26 file server.
   - Tarball có `./crew-adapter-expect.json` (commit `d3ab1ef78`, các mục P2…P7 kèm sha256 và anchor).
   - Tarball có `crew-commit.txt` = `d3ab1ef78e3a…` và `adapters/{claude,codex,opencode}-local/src/server/*.ts`.
4. **scp 3 script lên VPS.** Bản cũ giữ dưới tên `.bak-dp3-r24`. Sha256 trên VPS khớp fork:
   - `inspect-image.sh` `36fd5a13…`;
   - `inspect-adapters.mjs` `d26f6d95…`;
   - `overlay-source.sh` `089c7663…`.
5. **Build.** `overlay-job.sh d3ab1ef78` chạy 16:15:06 → 16:15:20, `JOB_EXIT rc=0`, `min_avail=5401MiB`.
6. **inspect-image.sh trên VPS** (giống cách `deploy.sh` gọi): rc 0.
   - Phần image: `issues crewCoreHooks=3`, đủ 12 file crew, `plugin events delivered as call ok`, `crew-ui=d3ab1ef78e3a…`, plugin bundle ok.
   - Vá adapter kiểm trong image: P2–P7 đều `ok`.

     | Vá | File | sha256 | anchor |
     |---|---|---|---|
     | P2 | `claude-local/.../execute.ts` | `5dacb403c40b` | 1x |
     | P3 | `claude-local/.../index.ts` | `b9137edc44c1` | 2x |
     | P4 | `claude-local/.../execute.ts` | `5dacb403c40b` | 1x |
     | P5 | `codex-local/.../index.ts` | `e316122c757c` | 2x |
     | P6 | `opencode-local/.../execute.ts` | `cfd9bfe88d57` | 1x |
     | P7 | `opencode-local/.../index.ts` | `99fbe9031a51` | 2x |

   - Chỉ có một cảnh báo, đúng như mong đợi: `WARNING: host adapter check SKIPPED (no node or no fork git repo on this host)`.
7. **inspect-image.sh từ Mac** (`DOCKER_HOST=ssh://nhamoiplatform`, đối số `<image> d3ab1ef78`): rc 0. Cả lượt kiểm trong image lẫn lượt kiểm theo commit đều cho P2–P7 `ok`, hash giống bảng trên.
8. **Deploy.** `active-runs.sh` rỗng lần 2. `deploy.sh crew-v3/paperclip:v3-d3ab1ef78` chạy 16:15:48 → 16:16:20, rc 0, in `deploy ok: crew-v3/paperclip:v3-8fdd145c3 -> crew-v3/paperclip:v3-d3ab1ef78, rollback TS=20261010-161555`. Log nằm ở `ops/deploy-d3ab1ef78.log`, trong đó có dòng WARNING SKIPPED. `deploy.sh` không dừng vì cảnh báo này.

**Kiểm sau deploy:**

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `ok`, commit `d3ab1ef78e3a…` |
| Plugin | `plugin-state.sh` trả `healthy`. Log có `plugin activated successfully` |
| Migration | Không có migration mới (diff chỉ đổi `crew/ops` và `packages/crew-plugin/src`) |
| Site | Đều 200: `crew /` (mốc crew-ui `d3ab1ef78e3a…`), `/cli-auth/x`, `/paperclip/` (title Paperclip), `2p-solutions.com`, `kidyschool.com` |
| `check-crew-companies.sh` | `ok 2 company` |
| `agent-permissions.sh` | TPS `5befeb1a… --check --assistant 6c27410e-7a14-4439-9e07-cbbfa2a743fd`: rc 0. `--all-crew --check` cùng cờ: rc 0 |
| Log server từ lúc deploy (188 dòng) | 0 `access_token`/`refresh_token`/`id_token`. 0 `config.get`, `host refused`, `INVOCATION_SCOPE_DENIED`. 0 error, 0 warn. `machine-jobs/claim` 18 lần, đều 204. `webhooks/machine-status` 200 |

## Bước 3: crew-mac `23670d7` trên Mac mini

1. **App không cài lại.** `git diff b76059f..r24 -- apps/mac-app` rỗng. Diff `b76059f..r24` chỉ có `apps/crew-mac/src/status/runtimes.ts`, test của nó và `docs/flows/mac-runtimes.md`.
2. **Build.** Worktree `.worktrees/crew-r3-dp2` chạy `git checkout --detach 23670d7`, rồi `pnpm install --frozen-lockfile` và `pnpm --filter @crew/mac build` (rc 0).
   - Test: 62 file, 1077 ca xanh. Typecheck 0 lỗi.
   - Gói được dựng ở scratchpad (`assets`, `dist`, `package.json`, cùng bố cục với `Resources/crew-mac` của app). So `diff -rq` với gói trong app: chỉ khác 3 file `dist/status/runtimes.{js,d.ts,js.map}`.
3. **Kiểm 0 run.** VPS `active-runs.sh` rỗng. Trên Mac không có `claude --print`, `codex exec` hay `opencode run`.
4. **Bản lui.** `cp -a ~/.crew/app/crew-mac ~/.crew/app/crew-mac.bak-dp3-r24`.
5. **Cài.** Lúc 16:19:01 gọi `installCrewMacFrom(<gói>)` (chính hàm app dùng, nạp từ `dist/index.js` của gói), trả `{"installed":true,"backup":".../crew-mac.prev"}`. Sau khi cài, cây `~/.crew/app/crew-mac` giống hệt gói, `runtimes.js` có sha256 `0705beee…`.
6. **Setup.** Lúc 16:19:06 chạy `~/.crew/bin/crew-mac setup` (wrapper), rc 0, in "Không có file nào thay đổi".
   - Chủ sshd vẫn là app: sshd PID 27249 có PPID 27170 (app), nghe `100.102.189.67:2222`.
7. **Doctor.** `crew-mac doctor` rc 0: **23 ĐẠT, 2 CẢNH BÁO, 0 LỖI**.
   - 2 cảnh báo đều vì chưa có key OpenCode (đúng, OpenCode đang hoãn).
   - Codex đăng nhập qua sshd agent: đạt. `crew-codex-run` chạy ra `codex-cli 0.161.0`.
8. **Ai gửi bản tin.** Bản tin máy do launchd `com.2p.crew-mac-status` gửi: `node ~/.crew/app/crew-mac/dist/cli.js status send`, 60 giây một lần. Vì vậy bản mới có hiệu lực ngay từ lượt kế tiếp, không cần khởi động lại app.
   - Cache đo nằm ở `~/.crew/runtimes/status-cache.json` (0600). File chỉ có các khóa `codexVersion`, `codexLoggedIn`, `opencodeVersion`, `keyPresent`, `costWeek`, `costMonth`, `models`, không có secret.

## Bước 4: theo dõi bản tin và trang Máy

**Bản tin lưu trên prod.** Đọc bảng `plugin_crew_core_0433ea20b6.machine_reports` trong `begin transaction read only … rollback`. Bảng dưới là các bản tin TPS; bản tin CRE gửi cùng giây và có cùng giá trị.

| Giờ nhận | Tải 1 phút | `codex.version` | `codex.loggedIn` | Ghi chú |
|---|---|---|---|---|
| 16:11:27 | 5.3 | null | null | crew-mac cũ, máy bận vì verify |
| 16:12:58 | 4.3 | null | null | crew-mac cũ |
| 16:14:25 | 6.9 | codex-cli 0.161.0 | true | crew-mac cũ |
| 16:15:42 | 4.5 | codex-cli 0.161.0 | true | crew-mac cũ |
| 16:17:10 | 4.0 | null | null | crew-mac cũ, sau deploy FX-PL5 (khối vẫn còn, chỉ trường hỏng thành null) |
| 16:18:25 | 3.9 | codex-cli 0.161.0 | true | crew-mac cũ |
| **16:19:36** | 3.8 | codex-cli 0.161.0 | true | **crew-mac mới từ đây** |
| 16:20:46 | 3.3 | codex-cli 0.161.0 | true | |
| 16:21:53 | 3.2 | codex-cli 0.161.0 | true | |
| 16:23:01 | 3.3 | codex-cli 0.161.0 | true | |
| 16:24:32 | 4.4 | codex-cli 0.161.0 | true | |
| 16:26:49 | **14.5** | codex-cli 0.161.0 | true | máy rất bận, vẫn đủ trường |

- Với crew-mac mới: **7/7 bản tin** TPS (và 7/7 CRE) có khối `runtimes` với `codex.version` và `codex.loggedIn`, kể cả lúc tải lên 14.5.
- Với crew-mac cũ: 3/6 bản tin có trường Codex null.
- Bản tin mới nhất còn đủ các trường `codex.resetsAt` và `primaryUsedPct` (15). OpenCode có `version 1.18.35`, `keyPresent false`, 31 model id, `costWeek` và `costMonth`, `costDay` null.

**Trang Máy.** Xem bằng Playwright Node:
- đăng nhập Crew Spike Admin, email và mật khẩu lấy từ `.env` VPS và truyền qua stdin;
- không trace, không lưu state;
- chỉ xem: không bấm nút nào, không gạt công tắc;
- request ghi gồm `POST sign-in` (200) và `POST sign-out` (200). Các `POST /api/plugins/crew.core/data/*` là truy vấn đọc dữ liệu plugin;
- quét thư mục plan, output và script: 0 file chứa mật khẩu.

Ảnh nằm ở `reports/dp3-shots/`: `00-thu-162116.png` là lần chạy thử, `01`–`05` là 5 lần xem cách nhau khoảng 70 giây.

| Lần | Giờ | crew-ui | Công tắc Claude / Codex / OpenCode | Dòng Codex |
|---|---|---|---|---|
| 00 | 16:21:16 | d3ab1ef78e3a | true / false / false | Phiên bản codex-cli 0.161.0 · đã đăng nhập |
| 01 | 16:21:28 | d3ab1ef78e3a | true / false / false | như trên |
| 02 | 16:22:41 | d3ab1ef78e3a | true / false / false | như trên |
| 03 | 16:23:55 | d3ab1ef78e3a | true / false / false | như trên |
| 04 | 16:25:09 | d3ab1ef78e3a | true / false / false | như trên |
| 05 | 16:26:23 | d3ab1ef78e3a | true / **true** / false | như trên |

- Cả 6 lần đều có dòng "Quota Codex ước tính: đã dùng 15%, đặt lại lúc 07/11/2026 22:19". **Không lần nào hiện "chưa rõ"** ở phần Codex. Ở DP-2 trang này từng hiện "Phiên bản chưa rõ".
- **Công tắc Codex do owner bật** lúc 09:25:52Z (16:25:52). Thông tin này lấy từ `crew_runtime_switches`: TPS, máy `039b7fe6…`, `codex_local`, `enabled=t`. Trợ Lý đã báo đây là ý của owner. Em xác nhận công tắc **đang BẬT** và giữ nguyên, không tắt lại. Script của em không gửi request nào tới route công tắc.
- Từ lúc bật tới lúc kết thúc (16:27): `active-runs.sh` rỗng, trên Mac không có `codex exec`. Em không tạo issue, không chạy run.

## Ghi chú nhỏ (không chặn)

1. **UI in chi phí OpenCode chưa làm tròn**: "tuần $2.9309000000000003/30 · tháng $2.9309000000000003/60". Nên làm tròn 2 chữ số ở crew-web hoặc ở crew-mac. Việc này nhỏ, không chặn.
2. **App có thể cài đè crew-mac cũ.** Gói crew-mac mang theo trong app vẫn là `b76059f`. Nếu owner chạy lại bước "Máy" trong trình cài của app, hoặc app tự cập nhật, `installCrewMacFrom` sẽ cài đè bản cũ (không có FX-MR5). Lần build app tiếp theo cần lấy từ `r24` ≥ `23670d7`.

## Không làm

- Không sửa code, không commit repo, không push. Tag `crew/v3.3-rc4` chỉ ở máy local.
- Không chạy migration, không cài lại app Mac.
- Không gạt công tắc nào, không chạy run Codex, không tạo issue.
- Không `rm -rf`, không in secret. File mật khẩu tạm của bước quét đã `rm -f` ngay.

## Process và thư mục

- Không còn process nền do em khởi động. Script Playwright và monitor đều đã thoát.
- Worktree `paperclip-r3-dp` đang detached ở `d3ab1ef78`. Worktree `crew-r3-dp2` đang detached ở `23670d7`, có `node_modules` và bản build `@crew/mac`.

Status: DONE
Summary: Prod chạy crew-v3/paperclip:v3-d3ab1ef78 (rollback: `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261010-161555` về v3-8fdd145c3). inspect-image.sh mới trên VPS kiểm P2–P7 trong image ok, chỉ cảnh báo SKIPPED phần host. Kiểm từ Mac theo commit ok. crew-mac 23670d7 đã cài. Từ lúc cài, 7/7 bản tin có codex.version và loggedIn (kể cả lúc tải 14.5), trang Máy hiện Codex ổn định 6/6 lần xem. Công tắc Codex do owner bật lúc 16:25:52, em giữ nguyên.
Concerns/Blockers: không chặn. (1) Chi phí OpenCode hiện số thực chưa làm tròn. (2) Gói crew-mac trong app vẫn là b76059f, nếu chạy lại bước Máy hoặc app tự cập nhật sẽ cài đè bản cũ.
