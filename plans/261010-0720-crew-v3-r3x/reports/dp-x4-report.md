# DP-X4 R3X: deploy `crew/r3x` @ `67b1dde8a` (FX-AC2), dọn project mồ côi, chạy lại s11/s8 T2

- Thời gian: 2026-10-10 12:11 → 12:28 (Asia/Ho_Chi_Minh, theo `date`). Người làm: agent opus.
- Kết quả: **DONE_WITH_CONCERNS.**
  - Prod chạy `crew-v3/paperclip:v3-67b1dde8a`, plugin `crew.core` healthy. Không phải rollback.
  - Project mồ côi `031a121f` "E2E base 2" đã gỡ bằng nút "Gỡ project" trên UI, lần gỡ `846b96f7` tới `done`. Dòng của nó trong `~/.crew/status-repos.json` đã mất (app tự ghi lại file, em không sửa tay).
  - Wizard Thêm project với khóa cũ `e2e-base` bị chặn ngay bước 1 và không tạo gì.
  - Chạy lại T2 với khóa nền mới `e2e-base3`: PW-S11-9 và PW-S8-7 **2 xanh, 0 đỏ**. Lượt này **0 run** mới.
  - 2 concern nhỏ (xem mục FX). Không cái nào do image mới gây ra.

## Mốc lui

| Mục | Giá trị |
|---|---|
| Image trước | `crew-v3/paperclip:v3-39a91bd90` |
| Image sau | `crew-v3/paperclip:v3-67b1dde8a` |
| Lệnh rollback | `ssh nhamoiplatform /opt/crew-v3-spike/ops/rollback.sh 20261010-121731` (đưa về `v3-39a91bd90`) |
| Backup DB | `20261010-1216` (làm tay trước deploy); `deploy.sh` tự backup `20261010-1217`; `20261010-1221` (làm tay trước khi dọn mồ côi). Cả 3 đều 26M, builtin ok |
| Script ops VPS cũ | `/opt/crew-v3-spike/ops.bak-dpx4-r3x/` |
| Tag cục bộ | `crew/v3.5-rc5` (annotated) trên `67b1dde8a`. Chưa push |

Lần này không có migration và manifest không đổi, nên muốn lui chỉ cần đổi image.

## Bước 1: deploy

1. **Cổng kiểm.** Worktree `paperclip-r3-dp` chạy `git checkout --detach crew/r3x` (`67b1dde8a`, sạch), rồi `pnpm install --frozen-lockfile`.
   - Diff `39a91bd90..67b1dde8a` đụng `crew-plugin/src/setup/{api,data}.ts` kèm test, wizard của crew-web kèm test, và e2e. Không đổi server, migration hay manifest.
   - `crew/release/verify.sh` chạy 12:12:02 → 12:15:14, rc 0, **XANH**: hook 5/5, vá lõi 6, lỗi 0; server 25 file / 508 ca; adapter 3 / 17; plugin 44 / 329; agents xanh; tsc 0.
   - Test ops 62/62. crew-web vitest 114 file, 881 ca xanh; `tsc -b` 0 lỗi.
   - `ipcs -m` trước và sau đều chỉ có 1 đoạn cũ.
2. **Chuẩn bị.**
   - `active-runs.sh` rỗng, image đang chạy `v3-39a91bd90`.
   - Backup `20261010-1216`.
   - Sao lưu thư mục `ops/` vào `ops.bak-dpx4-r3x`.
   - So sha256 của 21 file (`ops/*.sh`, `*.py`, `nginx-crew.conf`): VPS trùng fork, nên không scp.
3. **Build.**
   - `overlay-source.sh 67b1dde8a`: upload ok, 23 file server.
   - `overlay-job.sh`: `JOB_EXIT rc=0`, `min_avail=5199MiB`.
   - `inspect-image.sh` không có dòng MISSING hay FAIL: `issues crewCoreHooks=3`, đủ 12 file crew, `crew-ui=67b1dde8a6057…`.
   - So với output inspect của `v3-39a91bd90`, chỉ khác mốc UI và cỡ bundle (manifest và quyền y hệt).
4. **Deploy.** `deploy.sh` chạy 12:17:25 → 12:18:00, rc 0, in `deploy ok: v3-39a91bd90 -> v3-67b1dde8a, rollback TS=20261010-121731`. Plugin healthy.
5. **Kiểm sau deploy.**

| Kiểm | Kết quả |
|---|---|
| `/api/health` | `status ok`, commit `67b1dde8a6057…` |
| Plugin | `plugin-state.sh` trả `healthy` |
| Các site | crew `/`, `/cli-auth/x` (`crew-ui=67b1dde8a`), `/paperclip/` (title Paperclip), `/paperclip/TPS/issues/TPS-72`, `2p-solutions.com`, `kidyschool.com` đều 200 |
| `check-crew-companies.sh` | `ok 2 company` |
| `agent-permissions.sh --all-crew --check --assistant 6c27410e…` | **rc 1, chỉ lệch ở Crew E2E** (xem FX-DPX4-1). TPS có 10 agent, đều "đúng"; chạy riêng TPS thì rc 0 |
| Log | 0 dòng `config.get`, `host refused` hay `INVOCATION_SCOPE_DENIED`. 0 dòng warn trở lên sau deploy, và đến 12:28 vẫn 0 dòng error |
| App Mac | Access log nginx: 32 lần claim trả 204 sau 12:18. Có 4 lần 502, chỉ trong lúc restart (12:17:33–43) |

## Bước 2: dọn project mồ côi `031a121f`

Em dùng một script Playwright Node riêng (`with-board.sh` đọc email và mật khẩu từ `.env` VPS qua pipe, không trace) và chỉ ghi trong company Crew E2E. Ảnh chụp và `*-run.json` nằm ở `reports/dpx4-shots/`. Quét thư mục này không thấy mật khẩu.

1. Backup `20261010-1221`.
2. `PATCH /api/projects/031a121f… {archivedAt: null}` trả 200.
3. 12:22:29 bấm "Gỡ project". Dialog ghi: "Project chưa có agent trong vai trò", 0 yêu cầu, 0 run, "Máy chưa báo checkout nào". Em gõ tên rồi xác nhận.
4. Lần gỡ `846b96f7` (`remove-project`, khóa `e2e-base`) **xong lúc 12:22:35**, đủ các bước pause-agents, roles, environments, checkouts, project.
   - Plugin mới nhận project mồ côi là chủ mới nhất của khóa nên cho gỡ. Không còn lỗi "Khóa project đã thuộc project khác".
5. Bước checkouts **không lỗi**, dù checkout không còn trên máy. Job máy `a0f83951` (`remove-checkouts`, `removeStatusRepo: true`) trả `done`, `absent` cả 5 vai, `kept` và `removed` rỗng.
6. Project được archive lại lúc 05:22:33Z. Request ghi chỉ gồm sign-in, `setup-runs` và các step, 0 DELETE.
7. `~/.crew/status-repos.json` được app ghi lại lúc 12:22, giờ chỉ còn `280cf1de` và `a5ed1f8a`. **Dòng `031a121f` đã mất.**
8. Lần thêm project hỏng `f5f92f17`: em gọi `POST …/setup-runs/f5f92f17…/abandon` và nhận **409** "Lần cài đặt đã tạo project, không bỏ được". Plugin cố ý không cho bỏ một lần đã tạo project. Run này vẫn ở `failed` (FX-DPX4-2).

## Bước 3: T2 s11 và s8 với khóa nền mới

- Worktree `paperclip-r3-e2e` sạch. Nhánh `crew/r3x-e2e` được ff tới `67b1dde8a`.
- **Thử khóa cũ** (12:23): điền wizard với khóa `e2e-base` rồi bấm "Bắt đầu".
  - Lỗi hiện ngay dưới ô khóa: "Khóa này đã dùng cho project đã gỡ, chọn khóa khác". Xem ảnh `blocked-01-buoc1.png`.
  - Trang vẫn ở `/CRE/projects/new`, 0 request ghi, số setup run add-project vẫn 7.
- **Stub:** một watcher nền đặt marker 5 giây cho mọi checkout `~/crew-agents/e2e-*/*` mới. Watcher đã bật cho `e2e-base3`, `e2e-rm-mv1y9hl` và `e2e-rm-mv1ya2j`. Dừng watcher xong, em gỡ hết marker.
- **Lượt chạy:** `CREW_E2E_BASE_KEY=e2e-base3 run-e2e.sh --project=t2 --retries=0 --grep 'PW-S11-9|PW-S8-7'`, 12:24:15 → 12:27:14, rc 0.

| Ca | Kết quả | Ghi chú |
|---|---|---|
| Global-setup | ok | Dựng project nền `e2e-base3`, tức project `a10b101a` "E2E base 4" (setup run `8587d607`) |
| PW-S11-9 | **xanh** (27s) | Khối `finally` gỡ project `e2e-rm-mv1y9hl` qua UI (setup run `843ddd8f` done), không còn park. Cách sửa H1 chạy đúng trên prod |
| PW-S8-7 / F10 | **xanh** (2.2m) | Checkout executor bẩn được giữ (`kept dirty`) |

- Mật khẩu: `run-e2e.sh` báo test-results không chứa mật khẩu (0 trace).
- Spec: không sửa gì, không commit.

## Dọn dẹp (12:28)

- Project nền "E2E base 4" gỡ qua UI: setup run `1ca75ecb` done lúc 12:27:53, 5 checkout sạch đã gỡ. Request DELETE duy nhất là DELETE roles.
- Checkout bẩn `e2e-rm-mv1ya2j/executor`: em xóa tệp `dirty-e2e.txt` do spec tạo, kiểm `status` sạch, chạy `git worktree remove` (không `--force`), rồi `rmdir`.
- Mac: `~/crew-agents/e2e-*` trống, repo e2e chỉ còn `main`, không còn marker stub.
- Prod (Crew E2E):

| Mục | Trạng thái |
|---|---|
| Issue | 0 mở (21 done, 44 cancelled) |
| Project | 0 project sống, 0 dòng roles |
| Environment | 13 active, bằng trước lượt. 47 archived: 15 env mới (`e2e-base3-*` và 2 bộ `e2e-rm-*`) đều archived. 0 DELETE env |
| Agent | 45 paused, 4 idle (agent giữ chỗ) |
| Setup run mở | 1, là `f5f92f17` |
| Run | **0 run mới**: Crew E2E vẫn 16 run. 0 run active trên toàn prod |

- Process: watcher đã dừng. Chrome đang chạy có từ 12:01, là của phiên khác, em không đụng.
- An toàn: không `rm -rf`, không DELETE environment, project hay agent, không push, không sửa code sản phẩm. TPS chỉ đọc.

## FX

- **FX-DPX4-1 (sản phẩm hoặc ops, nhỏ):** gỡ project không thu quyền `tasks:assign` của Trợ Lý. Vì vậy `agent-permissions.sh --all-crew --check` cho rc 1 ở Crew E2E. Chi tiết:
  - 7 Trợ Lý đã paused của các project đã gỡ (`e2e-base`, `e2e-base2`, `e2e-rm-*`) vẫn bật `tasks:assign`. Sau khi gỡ, roles trống nên script không còn coi chúng là Trợ Lý.
  - Hai agent giữ chỗ `crew-e2e-skill-agent` và `crew-e2e-worker` bật cả 3 quyền. Em chưa rõ quyền này bật từ lượt nào.
  - Đây là dữ liệu test, không do image mới (bản này không đổi quyền hay dữ liệu). Em chưa áp sửa.
  - Gợi ý: bước `pause-agents` hoặc `roles` của luồng gỡ tắt luôn `tasks:assign` của Trợ Lý; hoặc chạy `agent-permissions.sh a7132a14…` (không `--check`, nên script sẽ áp quyền) khi owner cho phép.
- **FX-DPX4-2 (ghi nhận):** lần thêm hỏng `f5f92f17` sẽ ở `failed` mãi. Abandon trả 409 vì run này đã tạo project, mà luồng chính thức cho trường hợp này là "Chạy tiếp", vốn sẽ hỏng lại ở bước environments. Việc này không chặn gì: khóa `e2e-base` đã bị khóa vĩnh viễn và project của run đã gỡ. Có thể cân nhắc cho phép abandon khi project của run đã được gỡ.
