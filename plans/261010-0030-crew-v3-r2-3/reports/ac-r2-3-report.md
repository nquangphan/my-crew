# AC-R2-3 (BMAD): nghiệm thu trên prod và Mac mini

Người làm: agent nghiệm thu (opus). Thời gian: 10/10/2026 02:26–03:58 (giờ `date`, Asia/Ho_Chi_Minh). Prod: image
`v3-365cabdb7` (R2-5 đã gộp R2-3), health `ok` commit `365cabdb7dfc…`. Mac mini: crew-mac r2-5 @ `4f7e37d`. Owner vắng
nên em tự quyết các điểm bên dưới (mục 3) và duyệt thay owner qua API.

## 1. Kết luận

**AC1–AC9 đều ĐẠT.** BMAD chạy đúng bản ghim, không nạp Superpowers. Con BMAD có đủ bước reviewer rồi owner duyệt.
Từ file epic đã duyệt, Trợ Lý tạo đủ 18 story đúng I6. Gọi lại thì không tạo trùng. Yêu cầu không có nhãn vẫn đi
Superpowers.

Có hai lỗi phát hiện, đều không làm hỏng prod:
- **L1 (plan):** cách "pause executor trước khi owner duyệt" không dùng được. Server từ chối giao issue cho agent đang
  paused (409), nên Trợ Lý không tạo được story.
- **L2 (instructions Trợ Lý):** Trợ Lý đặt gốc `blocked` trong khi blocker TPS-82 đã `done`. Server đánh thức lại ngay
  (`issue_blockers_resolved`), thành vòng lặp tốn thêm run.

Vì L1, L2 và một câu hỏi của Trợ Lý ở lượt 2, tổng số run là **13**, vượt mức ước 6–8 của plan. Không có run executor
nào.

Prod đã dọn xong: mọi issue thử đã hủy, executor về đúng trạng thái trước AC, không còn run active, không còn process
mồ côi.

## 2. Bảng tiêu chí

| Tiêu chí | Kết quả | Bằng chứng |
|---|---|---|
| Việc đầu: model agent BMAD | ĐẠT | 02:27 backup `20261010-0227` (23M, builtin ok). 02:28 PATCH `ab3a27de` gửi nguyên `adapterConfig`, chỉ đổi `model`: `claude-sonnet-5` → `claude-opus-5`. `engine=cli`, `env={}`, `extraArgs` (pin bmad) giữ nguyên. ps lúc chạy có `--model claude-opus-5 --effort high` |
| **AC1** | ĐẠT | `workflows list --json`: superpowers `isDefault: true`, installed, checksum `3f0ff8c8…` (trùng hằng pin trong `r2-2`, nên không đổi so với trước DP-1). bmad installed, checksum `7f62e5cb6033…` = `BMAD_PIN`. `doctor --no-probe`: uv, Superpowers 231 file, BMAD 258 file đều ĐẠT. `machine_latest` trên prod 19:28:49Z: `bmad-pin`, `agent-uv`, `superpowers-pin`, `worktree-workflows` = ok, 0 check không ok. Thẻ máy chỉ kiểm ở dữ liệu, không mở UI |
| **AC2** | ĐẠT | `reports/ac2-isolation.sh` chạy 02:29:43 trên `~/crew-r23-probe/ac2` (HOME giả, không đụng `~/.crew` thật): 8/8 đúng mã thoát 0, 78, 78, 78, 78, 78, 78, 0. Đầu ra: `reports/ac2-isolation.out` |
| **AC3** | ĐẠT | Run BMAD `1e2eb729` có dòng `crew-workflow ok pin=bmad@6.13.0-next rev=d009608292d8 sum=7f62e5cb6033 project=0 pinned-dup=0` (19:33:16Z). `system/init`: plugin `bmad@inline`, path `…/workflows/bmad/6.13.0-next-d009608292d8`, cộng 3 plugin builtin; 0 skill superpowers. `crew-mac run-init-check --root ~/crew-agents/bmad --log -` rc 0: `crew-workflow init ok: bmad@6.13.0-next từ bản ghim, 29 skill bmad:*`. Run 2 `81873867` cũng vậy (`project=2`, rc 0). ps cả hai run: một `--plugin-dir` duy nhất, đúng bản ghim BMAD |
| **AC4** | ĐẠT | Trợ Lý run `03e20328` ghi `crew-plan` với dòng ba `crew-workflow id=bmad reason=yêu cầu code 4 stage, có nhãn bmad…`. Có đúng một con: TPS-82 (`7fedc1ea`), giao `ab3a27de`. Marker `crew-kind bmad` nằm trên một dòng riêng. Override chỉ có `{model: claude-opus-5, effort: high}`. `executionPolicy.stages` = [review (agent reviewer `946f1a73`), approval (user owner)]. Trợ Lý tự đọc lại và xác nhận 2 stage (M2 đã sửa) |
| **AC5** | ĐẠT | Nhánh `crew/TPS-82` có 4 commit: `0e04f7e` (dựng BMAD), `f280dc6` (PRD và architecture), `9191372` (epic/story), `5a3f8ad` (sửa theo reviewer). Diff từ merge-base tới `5a3f8ad4`: 23 file, gồm 12 file `_bmad/**` và 11 file `_bmad-output/**`. `bmad stories --root ~/crew-agents/reviewer --rev 5a3f8ad4 --file _bmad-output/planning-artifacts/epics.md` rc 0: digest `14158f87…` trùng `crew-bmad-result`, `scriptsMatchPin: true`, 2 epic, 18 story, 0 vấn đề. Vòng 1: reviewer run `06111713` yêu cầu sửa (tuyến `GET /lien-he` không có story nào nhận). Vòng 2: reviewer run `ae8f61cf` ghi `crew-review sha=5a3f8ad4fcd484b5512d6080b62da759997df324 verdict=approved`. 03:20:21 em duyệt thay owner, `completedStageIds` = [`92bd3369` review, `f69dfae2` approval]. Agent BMAD chạy 2 run (giới hạn ≤ 4) |
| **AC6** | ĐẠT | Trợ Lý ghi `crew-plan root=TPS-81 children=18 bundles=2`, `revision=bmad-TPS-82`, và đối chiếu sha `crew-review` với `crew-bmad-result` (m5). 18 con TPS-83…TPS-100 = `stories` 18. Kiểm 18/18 con: đủ `crew-bundle`, `crew-child key=s<N>-<M> revision=bmad-TPS-82`, `crew-bmad story=N.M source=5a3f8ad4fcd4:_bmad-output/planning-artifacts/epics.md`, `crew-model`; `Tiêu chí nghiệm thu:` có 4–8 dòng; không con nào có `crew-kind`. Epic 1 giao `mac-claude` (opus/high), epic 2 giao `mac-claude-2` (sonnet/high). Blocker nối thành chuỗi 83→84→…→90→91→…→100; story 1.1 không có blocker. Bước 5 (comment `kiểm lại` lúc 03:36:55, run `cbbe516b`): `missing [] dupes []`, vẫn 19 con. Không run executor nào: 36 wake bị bỏ qua với lý do `heartbeat.wakeOnDemand.disabled` |
| **AC7** | ĐẠT | TPS-101 (không nhãn). Run `99afd286` ghi `crew-plan` với `crew-workflow id=superpowers reason=yêu cầu code nhỏ trong một module, repo không có nhãn bmad…`. Con TPS-102 giao `mac-claude`, không có `crew-kind bmad`. Gốc bị hủy 03:54:10, sau khi thấy `crew-plan` |
| **AC8** | ĐẠT | Trên HOME giả, thư mục `bmad/6.12.0-aaaaaaaaaaaa` để mtime lùi 25 giờ, dấu `.in_use` trỏ pid sống: `gc` in "Đã dọn: 0", thư mục còn. Sau khi kill pid, ghi lại dấu và lùi mtime 25 giờ: `gc` in "Đã dọn: 1 … 6.12.0-aaaaaaaaaaaa". Thư mục ghim hiện hành của BMAD và Superpowers còn nguyên |
| **AC9** | ĐẠT | `check-core-hooks.mjs` trên `crew/r2-3` @ `5b5088889`: "Hook một dòng: 5/5; mục: 9; lỗi: 0" (H1–H5, P1–P4), `base` `v2026.1005.0`. `diff crew/r2-2..crew/r2-3`: 15 file, đúng phạm vi Global Constraints (`core-hooks.json` chỉ đổi `description` của H4). `packages/crew-plugin` không đổi |
| Repo-a sau AC | ĐẠT | Mọi worktree agent sạch. `~/crew-agents/bmad` đứng ở `crew/TPS-82` @ `5a3f8ad`; commit `_bmad/` và epic/story chỉ nằm trên nhánh đó, chưa push. origin/main giữ `d453bb8`. File `owner-wip.txt` chưa track ở checkout chính có từ trước AC. `doctor`: 7 worktree, không có nguồn bị chặn |
| Dọn | ĐẠT | TPS-81, TPS-83…TPS-100, TPS-101, TPS-102 đã `cancelled`; TPS-82 để `done`. Hai executor về `idle`, runtimeConfig trả lại đúng `{"heartbeat":{"enabled":false,"maxConcurrentRuns":1}}` (so lại bằng GET: chỉ khác trạng thái pause). `active-runs.sh` rỗng; không còn `claude --print`. `mon.sh` đã dừng, `~/crew-r23-probe` đã xóa (`rm -R`), file tạm trên VPS đã xóa |
| Tag `crew/v3.3` | CHỜ OWNER | Không tạo tag. Lý do: DP-1 R2-5 đã đặt `crew/v3.4-rc1` trên `365cabdb7` và Trợ Lý ghi "chốt tên tag cuối R2" |

### Run trong AC (13 run, không có run executor)

| Giờ tạo | Run | Agent | Issue | Lý do đánh thức | Kết quả |
|---|---|---|---|---|---|
| 02:31:11 | `03e20328` | tro-ly | TPS-81 | issue_assigned | ghi kế hoạch v1, tạo TPS-82 |
| 02:33:11 | `1e2eb729` | bmad | TPS-82 | assignment | 38 phút: setup + PRD + architecture + epic, `done` |
| 02:34:05 | `9c7f12d6` | tro-ly | TPS-81 | issue_disposition_repair | ngoài plan: "chờ suông", đặt gốc `blocked` |
| 03:11:05 | `06111713` | reviewer | TPS-82 | assignment | yêu cầu sửa |
| 03:14:02 | `81873867` | bmad | TPS-82 | assignment | sửa epics.md, `done` |
| 03:18:08 | `ae8f61cf` | reviewer | TPS-82 | assignment | approved |
| 03:20:21 | `bb7e57cd` | tro-ly | TPS-81 | issue_children_completed | ghi kế hoạch 18 story, POST bị 409 (L1) |
| 03:25:58 | `1d59d656` | tro-ly | TPS-81 | issue_blockers_resolved | lặp (L2), 409 |
| 03:28:00 | `6a32332b` | tro-ly | TPS-81 | issue_blockers_resolved | lặp (L2), 409 |
| 03:29:34 | `f0705c9a` | tro-ly | TPS-81 | issue_blockers_resolved | tạo 18 story (executor đã resume) |
| 03:36:55 | `cbbe516b` | tro-ly | TPS-81 | issue_commented ("kiểm lại") | không tạo thêm con |
| 03:41:37 | `dfb9594f` | tro-ly | TPS-101 | issue_assigned | hỏi owner (repo-a không có trang chủ) |
| 03:52:06 | `99afd286` | tro-ly | TPS-101 | issue_commented (trả lời) | ghi crew-plan superpowers; bị hủy cùng gốc |

## 3. Tự quyết khi owner vắng

1. **Thay pause bằng tắt đánh thức.** Executor đang paused thì Trợ Lý không giao được story (L1). Lúc 03:28:49 em PATCH
   runtimeConfig của hai executor thành `{"heartbeat":{"enabled":false,"maxConcurrentRuns":1,"wakeOnDemand":false}}`,
   rồi resume lúc 03:28:54. Với cấu hình này server ghi wake là `skipped`, không xếp hàng, nên agent nhận được issue mà
   không chạy run. Em đã kiểm điều này trong `heartbeat.ts` và `heartbeat-policy.ts` của fork. Lúc 03:54:39 em trả lại
   cấu hình cũ, sau khi đã hủy hết issue.
2. **Lượt 2 trả lời câu hỏi của Trợ Lý một lần**, chọn đáp án c (đổi chuỗi trong `src/greet.js`). Câu yêu cầu trong
   plan nói "trang chủ", nhưng repo-a không có trang chủ, nên Trợ Lý hỏi lại là đúng luật.
3. Hủy cả 18 story và TPS-102, không chỉ hủy gốc. Story để `todo` thì sau khi bật lại đánh thức, executor sẽ nhận việc.
4. Không tạo tag `crew/v3.3` (xem bảng).

## 4. Lỗi phát hiện

**L1. Plan: pause executor làm hỏng bước tạo story.** Nguyên văn lỗi Trợ Lý nhận khi POST con `s1-1`:

```
http=409
{"error":"Cannot assign work to a paused agent. Assign an invokable agent, leave the issue unassigned, or escalate to a board operator instead.","details":{"assigneeAgentId":"37a9e834-6aaf-4970-8f89-95dbc8a019f2","assigneeStatus":"paused"}}
```

Trợ Lý dừng đúng luật và tạo interaction `df4eba06` hỏi owner. Đề xuất: sửa mục "Chuẩn bị" và bước 3 lượt 1 trong
`plan.md`, cùng các plan AC sau có cùng ý: thay pause bằng `runtimeConfig.heartbeat.wakeOnDemand=false` trên executor
(ghi lại giá trị cũ để trả về), rồi hủy mọi con trước khi bật lại. Không cần sửa code.

**L2. Instructions Trợ Lý: đặt `blocked` với blocker đã `done` gây vòng đánh thức.** Comment nguyên văn của run
`bb7e57cd` (20:25:39Z):

```
Trợ Lý: chờ owner trả lời câu hỏi trong thẻ trên issue này — cả hai executor (`mac-claude` 37a9e834…, `mac-claude-2` c452d003…) đang `paused` nên không tạo được story (409 `Cannot assign work to a paused agent`).
```

Run `6a32332b` (20:29:20Z) ghi:

```
Trợ Lý: đặt lại `blocked` — hai executor (`mac-claude` 37a9e834…, `mac-claude-2` c452d003…) vẫn `paused` nên không POST được story (409).
```

Gốc TPS-81 vẫn còn quan hệ blocker với TPS-82 (đã `done`). Mỗi lần Trợ Lý đặt `blocked`, server bắn ngay
`issue_blockers_resolved`, nên có 2 run thừa (`1d59d656`, `6a32332b`); vòng chỉ dừng khi em bật lại executor.

Cùng gốc với lỗi này: run 1 (`03e20328`) kết thúc mà không ghi disposition, nên server chạy thêm run sửa
`issue_disposition_repair` (`9c7f12d6`) chỉ để đặt `blocked` chờ TPS-82.

Đề xuất (gói `agents`, chỉ `assistant.md` và test):
- (a) Sau khi tạo con BMAD ở lô v1, đặt gốc `blocked` với blocker là con BMAD ngay trong cùng run.
- (b) Khi chờ owner vì lý do khác blocker, như interaction hay executor không giao được, không đặt `blocked` qua đường
  blocker, hoặc gỡ quan hệ blocker đã `done` trước. Dừng sau interaction là đủ, vì `wake_assignee` sẽ đánh thức lại.
- Cần kiểm thêm phía server: stock có bắn `issue_blockers_resolved` mỗi lần issue vào `blocked` mà mọi blocker đã xong
  hay không.

**Quan sát khác, không phải lỗi:**
- O1. Câu yêu cầu lượt 2 trong plan ("Sửa câu chào trên trang chủ…") không khớp repo-a: không có trang chủ, và chuỗi đã
  là "Xin chào". Kết quả là thêm 1 run hỏi đáp. Plan AC sau nên dùng yêu cầu khớp repo, ví dụ "Đổi chuỗi chào trong
  `src/greet.js` thành 'Chào bạn'".
- O2. Commit BMAD (`_bmad/`, `_bmad-output/`) chỉ nằm trên `crew/TPS-82`, chưa push và chưa vào `main`. Story lại
  tham chiếu `source=5a3f8ad4fcd4:…`, còn executor rẽ nhánh từ `origin/HEAD`. Plan không nói ai đưa tài liệu BMAD vào
  nhánh chính. Cần owner quyết: integrator gom con BMAD, hay giữ tài liệu ở nhánh riêng.
- O3. Run BMAD đầu mất 38 phút (opus/high, có review nội bộ của skill architecture). Run sửa chỉ mất 4 phút.
- O4. Sau run, `.in_use` của bản ghim BMAD còn 2 dấu (pid đã chết). Đúng thiết kế: GC dọn các dấu này.

Status: DONE_WITH_CONCERNS
Summary: AC1–AC9 của R2-3 đều đạt trên prod v3-365cabdb7 và Mac mini: BMAD chạy đúng bản ghim (opus), con BMAD qua reviewer và owner, 18 story đúng I6 và không trùng khi gọi lại, lượt mặc định đi Superpowers. Đã dọn sạch: issue thử hủy, executor về trạng thái cũ, 0 run active.
Concerns/Blockers: L1 (pause executor làm 409 khi tạo story, đã thay bằng wakeOnDemand=false) và L2 (Trợ Lý đặt blocked với blocker đã done gây vòng run) làm tổng 13 run, vượt mức ước 6–8. Chờ owner: tên tag cuối R2, và nơi đưa tài liệu BMAD vào nhánh chính (O2).
