---
title: "Crew v3 R1-5 — Nâng Paperclip upstream và phát hành v3.0"
description: "Nâng fork từ v2026.1001.0 lên v2026.1005.0 bằng upgrade.sh; chạy lại nghiệm thu toàn R1 trên máy thật; diễn tập restore; review toàn nhánh; deploy."
status: done
priority: P1
effort: 2d
branch: v3
tags: [crew-v3, paperclip, upgrade, release]
created: 2026-10-09
---

# Crew v3 R1-5 — Nâng upstream và phát hành — Kế hoạch

**Goal:** Fork chạy trên Paperclip stable mới nhất là `v2026.1005.0`, với mọi phần Crew R1-1…R1-4 còn nguyên. Hook lõi vẫn 5/5, nghiệm thu R1 đạt lại trên máy thật, restore từ backup chạy được. Bản này deploy lên `crew.2p-solutions.com` làm v3.0.

**Owner (09/10 08:17):** "cho chạy xong R-1 luôn đi. dùng thằng claude ko dùng codex nữa". Owner đã cho phép làm tới deploy. Mọi worker là agent Claude: sonnet cho việc thường, opus cho merge lõi, review và nghiệm thu. Không dùng Codex và không dùng fable.

**Hiện trạng:**
- Fork `v3` = `703ddfa` trên nền `v2026.1001.0` (`crew/release/core-hooks.json` `base`).
- Upstream `v2026.1005.0` mới hơn 179 commit, 1643 file.
- Spike chạy `v3-703ddfa02` ở domain `https://crew.2p-solutions.com` (public, tắt đăng ký).

## Global Constraints

Kế thừa Global Constraints của R1-4. Thêm:

- Nâng upstream chỉ qua `crew/release/upgrade.sh <tag>`, trên nhánh sync có worktree riêng. Không sửa `v3` cho tới khi verify xanh.
- Xung đột ở file lõi thì giữ code upstream. Hook Crew một dòng được đặt lại đúng chỗ, mục `core-hooks.json` được cập nhật. Nếu phải sửa lõi ngoài hook một dòng thì dừng và hỏi owner.
- `core-hooks.json` `base` đổi thành `v2026.1005.0`.
- Server là môi trường thật duy nhất, phục vụ cả domain public. Mỗi lần deploy phải có backup và mốc rollback, kèm kiểm `health`, plugin healthy và hai site dùng chung nginx (`2p-solutions.com`, `kidyschool.com`). Nếu hỏng thì rollback ngay.
- Quota Claude dùng chung với owner, nên yêu cầu thử trên Mac phải nhỏ và chỉ chạy một việc nặng một lúc.

## Ticket

| ID | Việc | Worker | Phụ thuộc |
|---|---|---|---|
| UP-1 | `upgrade.sh v2026.1005.0`, giải xung đột, đặt lại 5 hook, cập nhật `core-hooks.json` (`base`). `verify.sh` xanh. Bổ sung vào `verify.sh` test `packages/crew-plugin` (build, typecheck, vitest) và `node --test crew/agents/*.test.mjs`. Báo cáo các thay đổi upstream đụng tới Crew: API plugin SDK, slot UI, bind SQL, heartbeat, execution policy, adapter claude-local. | Claude opus | — |
| UP-2 | Review toàn nhánh sync, đối chiếu thay đổi upstream với giả định của Crew: hook, plugin SDK/UI, `taskDetailView`, `string_to_array` bind, session resume, `mcpServerIdentity`. | Claude opus | UP-1 |
| UP-3 | Sửa phát hiện của UP-2, nếu có. | Claude sonnet hoặc opus | UP-2 |
| UP-4 | Diễn tập restore bằng `crew/ops/restore-drill.sh` trên backup mới nhất. Image mới chạy trên dữ liệu restore trong project cách ly. | Trợ Lý | UP-1 |
| AC-5 | Deploy image mới, rồi nghiệm thu R1 rút gọn trên máy thật (cổng dưới). | Trợ Lý (Claude) | UP-3, UP-4 |

## Nghiệm thu (AC-5)

- [ ] **Cổng 1 — artifact.**
  - `verify.sh` đã bổ sung chạy xanh: hook 5/5, test crew server, adapter, plugin, agents, typecheck.
  - Image có `dist/ui`, không có `._*`, không có `require("react`.
  - Deploy xong: plugin healthy, migration plugin `applied`.
- [ ] **Cổng 2 — API thật.**
  - `crew.map` của CRE-52 khớp DB.
  - 5 ca webhook từ chối vẫn trả 502 và ghi delivery `failed`.
  - H5 vẫn chặn agent tự sửa `adapterConfig` (422).
  - Lọc override vẫn chặn `extraArgs` (422).
- [ ] **Cổng 3 — trình duyệt, qua domain `https://crew.2p-solutions.com`.**
  - Issue có tóm tắt Crew và "Mở map".
  - Trang Crew có đủ Yêu cầu, Máy, Docs.
  - Widget dashboard hiện máy.
  - Console không có lỗi plugin.
- [ ] **Cổng 4 — Mac thật.**
  - `crew-mac doctor` ĐẠT.
  - Bản tin máy giữ nhịp khoảng 60 giây.
  - Một yêu cầu nhỏ qua Trợ Lý đi đủ 4 stage tới push. Gói 2 con cùng session thì phải thấy `--resume`.
  - Ảnh chụp docs đổi sang commit vừa push.
- [ ] **Cổng 5 — restore.** UP-4 đạt.
- [ ] **Dọn.** Cancel issue thử, 0 run active, không còn process mồ côi. Push chỉ khi owner nói "push".
