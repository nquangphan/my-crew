# Review gói `roles` — RO-1 (`99b49c7c0`) và RO-2 (`6cbddead5`)

Ngày 07/10/2026 (Asia/Ho_Chi_Minh). Worktree `.worktrees/paperclip-r12-roles`, nhánh `crew/r12-roles`, diff `v3..6cbddead5` (9 file, chỉ `crew/agents/**`). Đọc diff, log, report PL-1/PL-2/RR-2/SP-3 và đối chiếu `policy.md` (tên violation). Không chạy lại test (không có nghi ngờ về kết quả; các lỗi dưới đây là lỗi nội dung instructions, test hiện tại không phủ). Chỉ grep `routes/agents.ts` ở đúng một chỗ (redaction `adapterConfig`, finding M4).

## Verdict

| Ticket | Verdict | Lý do |
|---|---|---|
| RO-1 | CHANGES_REQUESTED | M4 (script PATCH có thể ghi đè `adapterConfig` bằng JSON lỗi, không kiểm kết quả), M5 (hướng dẫn thoát 78 không tới được agent), M2 (approve không gắn SHA); cộng minor |
| RO-2 | CHANGES_REQUESTED | C1 (push vào nhánh mặc định mà không xác minh issue đã `done`, người duyệt, tác giả bằng chứng), M1 (một `crew-merge pushed=no` khóa vĩnh viễn việc retry), M3 (rò credential qua output push) |

Số finding: 1 critical, 5 major, 10 minor.

## Khớp hợp đồng (đã kiểm, không có finding)

- Regex `crew-docs-check`: dòng mẫu `integrator.md:28` khớp regex `plan.md`; test `instructions.test.mjs` điền mẫu rồi so regex (copy regex vào test, xem m7). `crew-commit` và `crew-merge` có dòng mẫu và test.
- Mã lỗi: cả năm mã H2/H4 có mặt ở executor (bảng `executor.md:32-38`); `docs_missing`, `docs_stale`, `docs_failed:<E>`, `stage_unapproved`, `policy_missing`, `agent_cancel_forbidden` đúng tên trong `policy.md` (dòng 395, 410, 529-551). `exit=3` được qua đúng ngữ nghĩa (`policy.md:549`).
- Comment retry `Crew: lần chạy lại sau run …` đúng tiền tố RR-2; instructions không còn nói "mất kết nối".
- O7: cả ba vai trò dặn không `cancelled`, dùng `blocked` kèm lý do (`executor.md:19`, `reviewer.md:17`, `integrator.md:39`).
- Reviewer: không tự duyệt (server ép), không chạy lại suite, quyết định trong một PATCH có comment, 5 vòng khớp Cổng 2c.
- Integrator: push không ép (`--force`, `--no-verify` bị cấm), merge `--no-ff` từ `origin/<mặc định>`, conflict thì `merge --abort` và request changes, nhánh mặc định không bị chạm khi conflict (merge xảy ra ở `crew/req/<id>`, push chỉ chạy sau khi merge và kiểm sạch).
- `mergeAgentConfig`: thay cả hai dạng cờ (`--flag value`, `--flag=value`), giữ cờ khác, dedupe, pin phải đúng `<home>/.crew/workflows/superpowers/<x>`. `apply-roles.sh` không in credential: chỉ in tên agent, role, `extraArgs`; vai trò đã validate whitelist trước khi nội suy vào `node -e`. `policy-config.mjs` chỉ chứa uuid/owner id, không có secret.
- Redaction round trip: `GET /agents/:id` trả `adapterConfig.env` đã che (`***REDACTED***`), nhưng PATCH khôi phục khi gặp giá trị che trong `env` (`server/src/routes/agents.ts:3141-3159`, dùng ở `:5266`). Nên GET→merge→PATCH không làm mất secret env. Chỉ khóa ngoài `env` không được khôi phục (m9).

## Critical

### C1. Bước push không xác minh quyền: issue `done`, người duyệt, tác giả bằng chứng (`crew/agents/integrator.md:43-45`)

Điều kiện chạy bước push chỉ là "được đánh thức vì issue gốc đã `done`" (tự đánh giá từ prompt) và "chưa có comment `crew-merge`". Bước 1 kiểm "comment `crew-docs-check` mới nhất có exit 0/3 và khớp nhánh", nhưng:

1. Không dặn `GET /api/issues/<id>` để xác nhận `status == "done"`, issue không có `parentId` (issue gốc), và stage `approval` của owner đã được duyệt. Việc đánh thức qua plugin gửi prompt là một đoạn văn bản; @mention cũng đánh thức được. Một comment của agent khác (hoặc nội dung repo bị prompt-injection) chứa `@integrator ... đã done` là đủ để agent đẩy lên nhánh mặc định.
2. "Comment bằng chứng mới nhất" không ràng buộc tác giả. H2 chỉ chấp nhận bằng chứng do integrator viết, nhưng bước push không kiểm lại; executor viết được một comment có dòng `crew-docs-check commit=<sha của nó> … exit=0` và trỏ `crew/req/<id>` tới đúng sha đó.
3. Board ép `done` (`crew.policy.board_override`) cũng đưa issue về `done`: instructions không phân biệt, may mà khi đó thường chưa có nhánh `crew/req/<id>` khớp bằng chứng.

Đây là hành động có tác động lớn nhất của cả gói (ghi vào nhánh mặc định) và O5 nói "bấm duyệt chính là cho phép push", nên điều kiện "đã duyệt" phải được kiểm bằng dữ liệu server chứ không bằng lời nhắc.

Sửa: thêm bước 0 trong mục "Sau khi owner duyệt": `GET /api/issues/<id>`; dừng không làm gì (không comment `crew-merge`) nếu `status != "done"` hoặc `parentId != null`. Chỉ tính comment `crew-docs-check` có `authorAgentId` = chính bạn. Chỉ tính issue đã duyệt khi `executionState`/danh sách decision cho thấy stage `approval` do user owner duyệt (hoặc, nếu API không lộ, yêu cầu comment owner "approve" gần nhất). Thêm test chuỗi trong `instructions.test.mjs` (xem m7). Câu hỏi để AC-2: API nào lộ decision/`executionState` cho agent (ghi vào unresolved).

## Major

### M1. Một comment `crew-merge pushed=no` khóa vĩnh viễn lần push sau (`integrator.md:43`, `:50-52`)

Đoạn đầu: "chưa có comment nào bắt đầu bằng `crew-merge`. Đã có thì dừng". Nhưng `pushed=no` đi kèm `blocked`; ruling RO-2 nói owner sửa quyền push rồi duyệt lại ba stage, issue lại `done`. Lần đánh thức sau thấy comment `crew-merge … pushed=no` cũ và dừng: không bao giờ push được cho tới khi có người xóa comment. Đây đúng là tình huống "push lỗi → owner sửa → duyệt lại" mà ruling RO-2 khai báo là hợp lệ.

Sửa: chỉ dừng khi có `crew-merge … pushed=yes`, hoặc khi có `crew-merge` mới hơn quyết định `done` gần nhất của owner. Cách gọn: "dừng nếu tồn tại comment `crew-merge sha=… pushed=yes`; comment `pushed=no` cũ hơn lần `done` này thì làm lại".

### M2. Approve của reviewer không gắn SHA; integrator merge "comment `crew-commit` mới nhất" (`reviewer.md:15`, `integrator.md:7`)

Reviewer duyệt một SHA, nhưng comment approve chỉ có "lý do ngắn". Integrator merge sha trong comment `crew-commit` "mới nhất" mà không kiểm đó là SHA đã duyệt. Executor (hoặc run retry) đăng thêm `crew-commit` mới sau approve (comment trên issue `done`/`in_review` không bị chặn) thì sha chưa review đi vào nhánh mặc định. Yêu cầu của lead "kiểm commit đã duyệt trước khi merge" mới được đáp ứng ở bước push (chỉ so với bằng chứng docs của chính integrator, nên là vòng tròn).

Sửa: reviewer approve ghi `Reviewer: approve sha=<40 hex> — <lý do>`; integrator merge đúng `sha=` trong comment approve của reviewer (tác giả = agent reviewer), dừng và request changes nếu nó khác `crew-commit` mới nhất hoặc không phải tổ tiên của nhánh executor. Cập nhật `instructions.test.mjs`.

### M3. Output lỗi của `git push` bị dán nguyên vào comment (`integrator.md:50`)

"lý do cụ thể và output lệnh lỗi". Lỗi push in URL remote; nếu remote cấu hình dạng `https://user:token@github.com/...`, token vào comment (mọi người đọc được, vào log và cả bộ nhớ ngữ cảnh agent khác). Comment issue không qua redaction chắc chắn của server.

Sửa: dặn "thay phần `://…@` trong URL bằng `://***@` và không dán URL remote; chỉ giữ dòng `! [remote rejected]`/`error:`". Thêm test: không có `git remote -v` hoặc `git config --get remote.origin.url` trong instructions.

### M4. `merge-agent-config` nhận JSON bất kỳ; `apply-roles.sh agent` bỏ qua kết quả PATCH (`merge-agent-config.mjs:15-31`, `apply-roles.sh:29-33`)

- Nếu `GET /agents/<id>` trả thân lỗi JSON (ví dụ 5xx hoặc 401 mà `api.sh` thoát 0, chưa xác minh `api.sh` có `-f`), `JSON.parse` thành công, `agent.adapterConfig` undefined, script xuất `{"adapterConfig":{"extraArgs":[…]}}` và PATCH thay cả `adapterConfig`: mất `command` (wrapper), `model`, `env`… agent hỏng im lặng.
- `PATCH` và `PUT` đều `>/dev/null`: lỗi 4xx (nếu `api.sh` thoát 0) bị nuốt; script vẫn in dòng "apply-roles: … extraArgs=…" từ GET cuối, đọc có vẻ thành công dù PATCH không áp dụng.

Sửa: trong `mergeAgentConfig` ném lỗi nếu `agent` không phải object có `id` chuỗi, hoặc `adapterConfig` không phải object, hoặc `adapterConfig.command` không phải chuỗi (agent `claude_local` của Crew luôn có wrapper). Trong `apply-roles.sh` sau PATCH đọc lại GET và `die` nếu `extraArgs` cuối không bằng kết quả mong đợi (so JSON bằng `node -e` thoát khác 0), thay vì chỉ in. Thêm test cho các nhánh trên.

### M5. Hướng dẫn thoát 78 không tới được agent và nêu hẹp hơn hợp đồng (`executor.md:10`)

Wrapper `crew-claude-run` thoát 78 *trước khi* chạy `claude`; agent không có mặt để đọc thông báo. Chỉ người/Trợ Lý đọc log run mới thấy. Hơn nữa theo SP-3 (sau sửa M3): `SKILL.md` và `.claude/agents|commands` sửa dở chỉ `warn` (thoát 0, dòng `crew-workflow warn:`); chặn 78 chỉ cho `settings*.json`, script hook, `.mcp.json` sửa dở, và mọi nguồn chưa track/bị ignore, symlink ra ngoài worktree, git quá hạn. Câu "do file sửa dở trong `.claude/`" sai phạm vi, và `.mcp.json` nằm ngoài `.claude/`.

Điều thật sự giúp được agent là phòng ngừa: executor tự làm hỏng worktree của mình trong một run (sửa `.claude/settings.json`, tạo hook, hoặc để file nguồn chưa commit) thì run sau (retry, vòng sửa) chết 78 mà không ai nhận.

Sửa: thay mục 4 bằng quy tắc phòng ngừa: "Trước khi báo xong, chạy `git status --porcelain -- .claude .mcp.json`: commit hoặc hoàn tác mọi thay đổi ở đó (settings, hook, skill, agent, command, `.mcp.json`); không để file mới chưa track hay bị `.gitignore` trong các đường dẫn đó." Giữ một dòng "thấy thông báo `crew-workflow blocked`/`warn` trong log hoặc comment thì làm đúng lệnh in ra rồi mới tiếp". Ghi chú cho lead: kênh nào đưa thông báo 78 tới agent hoặc owner thuộc phạm vi gói runtime, không phải instructions.

## Minor

- **m1.** `policy-config.mjs:2-3` ghi "copy the output … then restart the server" trái với `apply-roles.sh:9` ("không cần restart") và ruling O8 (đọc lại mỗi lần). Chế độ không có file (`apply-roles.sh:39-40`, stdout) không gộp company đã có, nhưng header `apply-roles.sh:7` nói "merged into the file when it exists": chép stdout đè file cũ làm mất các company khác. Sửa chữ: stdout = chỉ một company; muốn gộp phải đưa tham số file.
- **m2.** Ghi tại chỗ (`apply-roles.sh:50`, `cat "$TMP" > "$OUT"`) là cắt rồi ghi: đã chấp nhận ở ledger (một lần fail-closed rồi tự hết). Nhưng hai điểm còn hở: (a) ENOSPC/kill giữa chừng để file cụt tồn tại lâu (cả server fail-closed mọi company cho tới khi ai đó sửa); (b) hai lần chạy song song mất cập nhật (đọc-sửa-ghi không khóa). Sửa rẻ: sao lưu `cp -p "$OUT" "$OUT.bak"` trước khi ghi, `node -e JSON.parse` kiểm `$TMP` hợp lệ và không rỗng trước `cat`, và `flock "$OUT.lock"` quanh khối (nếu VPS có `flock`).
- **m3.** `integrator.md:47` dùng `crew-docs check --range …` (không có trong PATH) trong khi `:20` dùng `node "$(git config --get crew-docs.bundle)" check …`; thống nhất. `git merge --no-ff "origin/$DEFAULT"` (`:47`) nên thêm `--no-edit` để chắc không mở trình soạn thảo. Mục E=2 (`:23`): `node ""`/thiếu bundle thoát 1, trùng với E=1 "docs sai"; dặn kiểm `test -f "$(git config --get crew-docs.bundle)"` trước, nếu không có thì E=2 mà không chạy.
- **m4.** `git symbolic-ref refs/remotes/origin/HEAD` (`integrator.md:10`, `:46`) lỗi khi `origin/HEAD` chưa được đặt (clone bằng `remote add`); thêm dự phòng `git remote set-head origin -a`. Executor/reviewer dùng "nhánh mặc định" cục bộ có thể cũ (`executor.md:15`, `reviewer.md:7`: diff với merge-base cũ ra cả đống thay đổi không thuộc yêu cầu); dặn `git fetch origin` và dùng `origin/<mặc định>`.
- **m5.** `integrator.md:29`: "`commit` phải bằng đầu range" dễ đọc thành phần đầu (BASE); dòng mẫu thì commit = vế phải. Viết "vế phải của range".
- **m6.** `executor.md:8`: comment retry nay ghi "mọi nhánh local, có thể gồm nhánh của việc khác" và có thể bị cắt ở 50 commit (RR-2 n1/n2). Instructions chỉ dặn `git show --stat` từng commit; thêm: bỏ commit không thuộc issue này, nếu "danh sách bị cắt" thì chạy `git log --branches HEAD`.
- **m7.** `instructions.test.mjs` yếu: regex server được sao chép (trôi khi PL đổi), test mã lỗi chỉ kiểm sự có mặt của chuỗi; không test O7 (`blocked`, không `cancelled`), `docs_stale`, M1/C1 ở trên; test cấm force-push chỉ khớp lệnh bọc trong backtick. Thêm kiểm: cả ba file chứa `"status":"blocked"` và không có `"status":"cancelled"`; không chứa `--no-verify` ngoài ngữ cảnh cấm; mỗi `PATCH` trong instructions có `comment`.
- **m8.** Chưa kiểm được (chỉ đọc, đưa vào AC-2 Cổng 4): (a) reviewer/integrator `git show <sha>` được commit của executor — cần worktree cùng một kho git (`reviewer.md:7`); (b) `POST /comments` lên issue `done` không mở lại issue (RO-2 đã nêu); (c) agent `PATCH` được `done → blocked` và đăng comment khi không `checkout` issue, vì issue đã giao cho user owner, không phải agent; `integrator.md:43` cấm checkout; nếu API đòi checkout thì bước `blocked` ở `:52` thất bại và issue kẹt `done` kèm comment `pushed=no`; (d) H2 cho agent chuyển rời `done` (`crew.gate.cycle_reset` ghi trong ledger là hệ quả chấp nhận, nhưng chưa có test DB cho actor là integrator).
- **m9.** Pin: `case "$PIN" in /*/.crew/workflows/superpowers/*)` (`apply-roles.sh:26`) và `PIN_RE` (`merge-agent-config.mjs:9`) đều cho phần cuối là `..` hoặc `.`; thêm từ chối `..`. Với `adapterConfig`: chỉ `env` được server khôi phục khi PATCH; khóa khác bị `redactEventPayload` che (ví dụ tên trùng mẫu bí mật) sẽ bị ghi lại thành `***REDACTED***`; thêm kiểm trong `mergeAgentConfig` ném lỗi nếu thấy chuỗi `***REDACTED***` ngoài `env`.
- **m10.** `integrator.md` 52 dòng, mục "Sau khi owner duyệt" dày đặc (7 bước, nhiều nhánh `PUSHED=no`). Có thể tách thành file riêng (`integrator-merge.md`) hoặc rút gọn sau khi áp C1/M1/M3, để agent haiku/sonnet theo được; hiện chưa vượt ngưỡng nhưng đã gấp đôi hai vai trò còn lại.

## Ghi chú về ngoài phạm vi / ghi nhận

- Quyết định đánh thức integrator bằng plugin `crew.core` (lead đã chốt): instructions không phụ thuộc @mention, nhưng C1 cho thấy vì thế càng cần agent tự xác minh trạng thái, vì prompt của plugin không phải bằng chứng.
- Không phát hiện: in credential, ghi file ra ngoài `crew/agents/**`, đụng `crew/agents` của gói khác, hay phụ thuộc vào `~/crew-agents`, `PAPERCLIP_RUN_ID`, model `fable`.

## Câu hỏi chưa giải quyết

1. API nào cho agent integrator thấy quyết định stage `approval` của owner (`executionState` hoặc decisions) để thực hiện C1? Nếu không có, chấp nhận kiểm `status == done` + comment owner?
2. `api.sh` có `curl -f` (thoát khác 0 khi HTTP lỗi) không? Quyết định mức nghiêm trọng thật của M4.
3. Worktree reviewer/integrator có chung kho git với executor? (m8a)

---

# Re-review (commit `4f9dfc5f7`, diff `6cbddead5..4f9dfc5f7`)

Đọc diff 10 file, mục "Sửa sau review" của `ro-1-report.md`/`ro-2-report.md`, `integrator-wake.ts` của gói plugin (đối chiếu prompt) và `issue-execution-policy.ts` (ai ghi được decision). Không chạy lại test (báo cáo ghi 26 pass; thay đổi là chữ instructions và script, em đọc từng nhánh).

## Verdict

| Ticket | Verdict |
|---|---|
| RO-1 | APPROVE kèm 2 minor |
| RO-2 | CHANGES_REQUESTED: 1 major mới (N1, chuỗi tin cậy ở bước Gộp còn hở, vẫn dẫn tới push mã chưa review) |

Finding mới: 0 critical, 1 major, 4 minor.

## Trạng thái finding cũ

| Mã | Kết quả | Ghi chú |
|---|---|---|
| C1 | Đóng (bước push) | `integrator.md:42-47` xác minh bằng API trước mọi thao tác git; xem phân tích bên dưới |
| M1 | Đóng | chỉ `pushed=yes` chặn (`:46`); xem n3 về SHA |
| M2 | Đóng một nửa | reviewer ghi `crew-review sha=…` (`reviewer.md`), integrator chỉ merge sha đó; nhưng không bắt buộc kiểm tác giả: N1 |
| M3 | Đóng cho dạng URL; còn hở nhỏ | n2 |
| M4 | Đóng | `merge-agent-config.mjs` từ chối thiếu `id`/`adapterConfig.command`/`***REDACTED***` ngoài `env`; `apply-roles.sh:55-58` kiểm phản hồi PATCH/PUT bằng `verify-result.mjs`; `..` bị chặn ở cả hai nơi. Giả định PUT trả JSON object: AC-2 xác nhận (báo cáo đã nêu) |
| M5 | Đóng (có n4) | bỏ hướng dẫn 78, thay quy tắc giữ sạch `.claude`/`.mcp.json`; runbook của lead đã ghi phạm vi 78 đúng theo SP-3 |
| m1–m6, m9 | Đóng | đọc từng thay đổi; `write_config` (`apply-roles.sh:20-36`) có `.bak`, kiểm JSON không rỗng trước `cat`, `flock` khi có |
| m7 | Bỏ qua hợp lý | regex sao chép: import regex thật là phụ thuộc chéo nhánh; có thêm test O7, PATCH có comment, thứ tự xác minh |
| m10 | Bỏ qua hợp lý | `apply-roles.sh` chỉ upload một `AGENTS.md`; mục push rút về 6 bước |
| m8 | Còn mở, đúng chỗ | đã chuyển vào danh sách AC-2 |

## Điều kiện push của C1 có lách được bằng comment/decision giả không

Điều kiện: `status=done`, `parentId` rỗng, `executionState.status=completed`, `lastDecisionOutcome=approved`, id stage cuối loại `approval` nằm trong `completedStageIds`, bằng chứng docs do chính ME viết khớp tip `crew/req/<id>`.

- `executionState` không có trong validator của PATCH/create (`packages/shared/src/validators/*.ts` không chứa `executionState`), nên agent không ghi trực tiếp được. Server tự sinh nó: `buildCompletedState` (`issue-execution-policy.ts:516-528`) chỉ chạy ở nhánh `principalsEqual(currentParticipant, actor)` (`:786`), tức người duyệt phải là participant hiện tại của stage. Stage cuối là `approval` của user owner theo file `CREW_POLICY_CONFIG`; policy bị khóa trước agent (`crew_policy_locked`). Vậy executor/reviewer/integrator không tạo được decision `approved` của stage owner, và comment (dù viết gì) không đổi `executionState`.
- Ngoại lệ cần biết: "escalated hold" (sau 5 vòng, issue giao cho user owner không thuộc participant, `:718-735`). Người đó là chính owner (`responsibleUserId`), và hold áp cho stage review chứ không thay stage owner cuối; stage cuối vẫn cần decision approval của owner. Không lách được.
- Board ép `done` (`crew.policy.board_override`): không đi qua nhánh decision của stock nên `executionState` không thành `completed` đủ stage; điều kiện thứ hai thất bại. Chưa có test DB; thêm vào AC-2 Cổng 2d: sau board override, `GET /issues/<id>` phải không có `completed` + stage cuối trong `completedStageIds`.
- Bằng chứng docs: `authorAgentId` do server gán theo actor, không giả được; executor không chuyển `crew/req/<id>` sang commit khác mà giữ nguyên bằng chứng (tip phải bằng `commit=`).
- Prompt của plugin chỉ có tính chỉ dẫn: `integrator-wake.ts:56` "Issue <identifier> (id <uuid>) đã được owner duyệt: merge crew/req/<identifier> …" khớp ý instructions (`:40` nói rõ prompt không phải bằng chứng); plugin cũng tự kiểm `parentId` và `status`, một lần mỗi lần hoàn tất. Kết luận: lách bằng comment/decision giả không thành công ở bước push. Chỗ hở còn lại là bước Gộp (N1).

## Finding mới

### N1 (major). Bước Gộp không bắt buộc kiểm tác giả của `crew-review` và trạng thái issue con (`integrator.md:9`)

Dòng 9 chỉ nói "comment `crew-review sha=<40 hex> verdict=approved` của reviewer (reviewer là participant của stage đầu…)" mà không dặn so `authorAgentId` với participant đó, và đã bỏ chữ "issue con đã `done`". Executor đăng được comment `crew-review sha=<sha của nó> verdict=approved` trên issue của chính mình (sau khi reviewer yêu cầu sửa, hoặc ngay khi tự trỏ sha chưa review); integrator thấy sha khớp `crew-commit` mới nhất và merge. Bằng chứng docs về sau chỉ chứng minh docs của cây đã merge, và bước push chỉ kiểm tip khớp bằng chứng, nên mã chưa review vẫn tới nhánh mặc định. Đây là đường lách duy nhất em tìm thấy vào nhánh mặc định.

Sửa trong `integrator.md:9`: "Chỉ tính `crew-review` do agent reviewer viết (`authorAgentId` bằng `participants[].agentId` của stage đầu trong `executionPolicy` của issue đó), mới nhất, và chỉ khi issue đó `status=done` với `executionState.completedStageIds` chứa stage đầu." Thêm vào `instructions.test.mjs` một khẳng định các cụm `authorAgentId` và `completedStageIds` có trong mục Gộp.

## Minor mới

- **n1.** Thông báo wake dùng `(id <uuid>)`; instructions không dặn lấy id đó: thêm "id trong ngoặc của prompt là issue gốc cần `GET` (vẫn xác minh bằng API)". Cùng loại với m8c: run do `invoke` không có issue context nên không `checkout`; `PATCH blocked`/`POST comment` trên issue `done` giao cho user có thể bị từ chối. Còn trong danh sách AC-2, chưa đóng.
- **n2 (M3 hở nhỏ).** `sed -E 's#scheme://[^@/ ]*@#://***@#g'` che đúng dạng URL có credential (kể cả `https://ghp_…@github.com`). Token xuất hiện ngoài URL (ví dụ `remote:` echo từ hook phía máy chủ, hoặc `GIT_TRACE`) không bị che. Thêm lớp phòng thủ: `sed -E 's/(gh[pousr]_|github_pat_|glpat-|xox[abp]-)[A-Za-z0-9_-]+/***/g'` trước `grep`. Phần `grep -E '^(error|fatal| ?!|remote:)' | head -5` đã giới hạn bề mặt, đủ cho trường hợp thông thường.
- **n3.** `integrator.md:46` "`crew-merge sha=<SHA đó>`" không xác định là SHA nào. Nếu bước 2 merge `origin/<mặc định>` thì tip đổi (E → M), `crew-merge sha=` là M, còn điều kiện `commit=` ở `:45` so với tip hiện tại (M ≠ E): lần đánh thức thứ hai sau khi đã push thành công sẽ thấy "không khớp", đăng comment "không push" thừa (an toàn, chỉ nhiễu). Định nghĩa rõ: đối chiếu `pushed=yes` theo `git merge-base --is-ancestor <sha> origin/$DEFAULT`, và coi tip là hợp lệ nếu tip là hậu duệ của `commit=` do merge default.
- **n4.** `executor.md` mục "Giữ worktree sạch": `git status --porcelain --ignored -- .claude .mcp.json` có thể luôn hiện `.claude/hooks/.logs/…` (file log do hook ghi mỗi run, bị `.gitignore`), mà SP-3 M1 đã quyết định đó không phải nguồn nạp và không chặn. Dặn executor dọn hết sẽ làm nó xóa log vô ích hoặc kẹt. Thu hẹp: chỉ cần xử lý `settings*.json`, script hook (đuôi script hoặc bit x), `SKILL.md`, `.claude/agents|commands/*.md`, `.mcp.json` chưa commit hoặc sửa dở; hoặc gọi `crew-mac workflow-check` (SP-3) nếu có trong PATH của agent.

## Hành động đề nghị

1. Sửa N1 (một câu trong `integrator.md:9` và một test); là điều kiện duy nhất để RO-2 đạt.
2. n1–n4: làm cùng lượt cho gọn, không chặn.
3. AC-2 giữ danh sách trong `ro-2-report.md`, thêm: board override không tạo `executionState` completed; `PUT instructions` trả JSON object.

---

# Re-review 2 (commit `7af4d280a`, diff `4f9dfc5f7..7af4d280a`)

Đọc diff 3 file instructions + test và mục "Sửa sau re-review" của `ro-2-report.md`. Không chạy lại test (báo cáo ghi 28 pass; thay đổi là chữ instructions). Em kiểm các nhánh bằng cách đọc, và lập luận về git ref (không chạy lệnh trên repo thật).

## Verdict

| Ticket | Verdict |
|---|---|
| RO-1 | APPROVE (giữ nguyên) |
| RO-2 | CHANGES_REQUESTED: 1 major mới (N2: quy tắc `T^1` mở đường push code chưa qua docs/review); N1 và n1–n4 đóng |

Finding mới: 0 critical, 1 major, 2 minor.

## N1 và n1–n4

- **N1 đóng.** `integrator.md:9` chỉ tính `crew-review` có `authorAgentId` bằng `participants[].agentId` của stage đầu trong `executionPolicy` của chính issue đó, mới nhất, issue `done` và `completedStageIds` chứa stage đầu; comment executor/người khác bị bỏ qua; thiếu thì không merge và request changes. Policy bị khóa trước agent nên danh sách participant đáng tin; `authorAgentId` do server gán nên không giả được. Test chỉ kiểm sự có mặt của cụm chữ (không mô phỏng được comment giả): AC-2 mục 11 bù chỗ đó.
- **n1 đóng.** Id trong ngoặc được dùng, đối chiếu `identifier`, lệch thì dừng.
- **n2 đóng.** `sed` thêm `gh[pousr]_`, `github_pat_`, `glpat-`, `xox[abp]-` chạy trước `grep`; kết hợp với cắt 5 dòng lỗi lọc theo đầu dòng, đủ cho trường hợp thông thường (token kiểu khác như khóa AWS, JWT không che; chấp nhận được vì output đã lọc theo `error|fatal|!|remote:`).
- **n4 đóng, còn một khe nhỏ** (n6 dưới).
- **n3: SHA đã rõ, nhưng phần nới `T^1` mở lỗ hổng (N2).**

## N2 (major). Bằng chứng docs khớp `T^1` cho phép đưa commit bất kỳ vào giữa `T^1` và `T` (`integrator.md:45`, `:48`)

Điều kiện mới: `commit=` bằng `T` **hoặc bằng `T^1` khi `T` là merge commit bạn đã tạo từ `origin/$DEFAULT` ở lần chạy trước`. Câu "bạn đã tạo" chỉ là lời văn; không có lệnh nào kiểm. Một điều kiện thực sự đo được chỉ là `rev-parse "$T^1" == commit=`, mà bất kỳ commit nào có cha đầu là E (commit đã có bằng chứng) đều thỏa, kể cả commit thường một cha, chứa mã tùy ý.

Ai chen được commit giữa `T^1` và `T`:

- Hợp lệ: chỉ nhánh mặc định `origin/$DEFAULT` (cha thứ hai của merge); đó là mã đã nằm trên remote nhưng chưa qua gate Crew.
- Không hợp lệ nhưng không bị chặn: mọi agent có shell trong cùng kho git. Reviewer, executor và integrator chung object store và namespace ref (instructions tự nói "dùng chung kho git"). Agent chạy `git update-ref refs/heads/crew/req/<id> <commit C có cha là E>` (`update-ref` không bị chặn vì nhánh đang checkout ở worktree khác, khác với `git branch -f`) là tip thành `T = C`, `T^1 = E`, khớp bằng chứng. Integrator vòng sau `git switch crew/req/<id>` (HEAD là C), `is-ancestor` true nên bỏ qua merge và bỏ qua lần chạy lại test/docs, rồi push C lên nhánh mặc định. Trước re-review 2, điều kiện `tip == commit=` chặn đúng kiểu giả này (không tạo được commit khác nội dung mà trùng sha); phần nới là một hồi quy.

Lỗi thứ hai cùng nguồn: bước kiểm lại test/docs chỉ chạy "khi merge sạch" trong lần chạy này (`:48`). Ở lần retry mà tip đã là merge commit M từ lần trước và nhánh mặc định không đi tiếp, bước merge bị bỏ qua nên test/docs không chạy lại. Nếu lần trước dừng vì test/docs xấu sau merge (`pushed=no`) và `PATCH blocked` không thành công (m8c còn mở) thì issue vẫn `done`, lần đánh thức sau thấy `T^1 = E` và push luôn M đã biết là xấu.

**Sửa (chọn cách gọn): không tin `T`, dựng lại từ E.** Thay quy tắc `T^1` bằng: lấy `E` = `commit=` của bằng chứng hợp lệ (tác giả ME), rồi `git switch -C crew/req/<identifier> "$E"` trước bước 2, và coi tip chỉ hợp lệ khi cuối cùng `HEAD` là `E` hoặc kết quả merge `origin/$DEFAULT` vào `E` do chính lần chạy này thực hiện. Khi đó bỏ hẳn nhánh `T^1`, điều kiện quay về `commit= == E` (sha đóng vai tin cậy vì trùng sha ⇒ trùng nội dung), và bước 2 luôn merge lại default từ E rồi chạy test/docs (không còn phụ thuộc lần chạy trước). Dặn thêm: `crew-merge … pushed=yes` đối chiếu bằng `T` ở "dừng im" (`:42-44`) giữ nguyên.

Nếu muốn giữ `T` (tránh merge lại): bắt buộc cả ba, thay lời văn bằng lệnh: `git rev-list --parents -n1 "$T"` đúng hai cha; `$T^1 == commit=`; `git merge-tree --write-tree "$T^1" "$T^2"` bằng `git rev-parse "$T^{tree}"` (cây của T đúng là merge sạch, không có "evil merge"); `git merge-base --is-ancestor "$T^2" "origin/$DEFAULT"`; và luôn chạy test/docs trước push khi `T != E`. Cách này dài hơn nhiều so với dựng lại từ E.

Thêm test: `integrator.md` có chuỗi `git switch -C crew/req/` gắn với `commit=` trước bước push, và không còn cụm `$T^1`; hoặc nếu giữ `T`, có `merge-tree --write-tree`.

## Hỏi riêng về `T^1`

- Commit nào được đưa vào giữa `T^1` và `T`? Theo đúng ý định: chỉ merge commit từ `origin/<mặc định>`, nên chỉ mã đã có trên remote và không có xung đột (conflict thì `merge --abort`, không có giải xung đột tay). Nhưng "chỉ nhánh mặc định" là ý định, instructions không ép bằng lệnh nào; thực tế mọi agent có quyền ghi ref trong kho chung chen được commit. Kết luận: **có mở đường**, xem N2.
- Mã vào từ nhánh mặc định không qua gate docs của Crew: không phải lỗ hổng mới (mã đó đã ở nhánh mặc định). Rủi ro duy nhất là test/docs trên cây đã gộp; bước 2 chạy lại cả hai khi lần này mới merge, nên chỉ hỏng ở nhánh retry nêu trên.

## Minor mới

- **n5.** Liveness: child issue bị leo thang sau 5 vòng (escalated hold) do user owner duyệt stage đầu; không có `crew-review` do agent reviewer viết, nên bước Gộp (`:9`) luôn bỏ qua và request changes, không merge được. Sửa: chấp nhận thêm `crew-review sha=… verdict=approved` do **user** trong `participants`/`responsibleUserId` của policy viết (`authorUserId` bằng `ownerUserId` ở stage cuối; user comment không giả được).
- **n6.** `executor.md` bỏ `--ignored` đúng ý n4, nhưng SP-3 chặn cả nguồn nạp (script hook, `SKILL.md`, agents/commands, `.mcp.json`) **bị ignore**. `git status --porcelain` không hiện file ignore; executor có thể để lại một `SKILL.md` ignored mà không biết. Có hai lựa chọn: lọc `git status --porcelain --ignored -- .claude .mcp.json | grep -vE '\.(logs|cache)/'`, hoặc dặn bắt buộc `crew-mac workflow-check` thay vì "nếu có trong PATH". Không chặn.

## Hành động đề nghị

1. Sửa N2 (dựng lại nhánh từ `E`, bỏ `T^1`) là điều kiện để RO-2 đạt.
2. n5, n6 cùng lượt, không chặn.
3. AC-2 thêm: sau khi một agent ghi `git update-ref` vào `crew/req/<id>` với commit con của `E`, integrator phải không push.

---

# Re-review 3 (commit `5d274b8ef`, diff `7af4d280a..5d274b8ef`)

Đọc diff `integrator.md`, `executor.md`, test, mục "Sửa sau re-review 2" của `ro-2-report.md`; đối chiếu cờ `crew-mac workflow-check` với `r1-2/crew-mac` (`cli.ts`, `crew-claude-run.sh`). Không chạy lại test (báo cáo ghi 30 pass; thay đổi là chữ instructions).

## Verdict

| Ticket | Verdict |
|---|---|
| RO-1 | APPROVE (không đổi) |
| RO-2 | CHANGES_REQUESTED (vòng 3/5): N2, n5, n6 đóng; 1 major mới (N3: điều kiện "đã xong" bỏ qua việc push của vòng duyệt sau khi mở lại issue) |

Finding mới: 0 critical, 1 major, 3 minor.

## N2: đóng

- Không còn đường chen commit. `integrator.md:51` (bước 2) dựng lại `crew/req/<id>` từ `E` bằng `git switch -C … "$E"` mà không đọc tip cũ; `E` là sha trong bằng chứng do chính ME viết (`authorAgentId` do server gán), nên một agent khác dời ref `crew/req/<id>` bằng `git update-ref` không ảnh hưởng (sha nội dung cố định, không giả được). Giữa `E` và `T` chỉ còn một merge tự động `origin/$DEFAULT` do chính lần chạy này thực hiện; conflict thì `merge --abort`, không có tay giải xung đột.
- Vòng retry luôn chạy lại test/docs: bước 2 (merge luôn), bước 3 (test + docs trên cây vừa merge), bước 4 (bằng chứng mới cho `T`, chỉ tiếp khi docs exit 0/3), bước 5 (kiểm `HEAD == T` rồi `git push origin "$T:refs/heads/$DEFAULT"`, đẩy theo sha chứ không theo `HEAD`, nên ref bị dời giữa chừng cũng không đổi nội dung đẩy). Không còn nhánh nào bỏ qua kiểm khi tip đã là merge commit từ lần trước.
- Test mới kiểm thứ tự dựng lại < merge < bằng chứng cho `T` < push `$T:`, và không còn `$T^1`.
- `E` luôn có `commit^{commit}` trong repo (`git cat-file -e`); nếu thiếu bằng chứng thì dựng lại từ `crew-review` hợp lệ và docs check ở bước 3 sẽ báo xấu nếu cây thiếu commit docs: fail an toàn.

## "Đã xong" theo `origin/<mặc định>` có bị lừa bởi ref local không

Điều kiện (`:46-47`): có comment của ME `crew-merge sha=X … pushed=yes` **và** `X` là tổ tiên của `origin/$DEFAULT`. Bản thân điều kiện không bị ref local lừa theo hướng nguy hiểm: `pushed=yes` chỉ do ME viết sau khi `git push` thoát 0, nên agent khác dời ref `refs/remotes/origin/*` bằng `update-ref` chỉ làm integrator **bỏ qua** một push (từ chối dịch vụ), không đẩy được gì. `git fetch origin` ở phần mở đầu ghi đè các ref theo dõi từ remote trước khi kiểm, nên ref bị dời bị sửa lại trừ khi fetch lỗi (n8). Lỗi thật nằm ở thứ tự thời gian, xem N3.

## N3 (major). "Đã xong" tính theo `X` là tổ tiên mà không gắn với vòng duyệt hiện tại (`integrator.md:46`)

Điều kiện cũ so `sha` với tip nên mỗi vòng duyệt có `sha` khác. Điều kiện mới chỉ cần một comment `pushed=yes` bất kỳ của ME với `X` là tổ tiên của `origin/$DEFAULT`; mọi sha đã push ở vòng trước luôn là tổ tiên. Kịch bản: vòng 1 push thành công (`pushed=yes`, issue `done`); owner mở lại issue để giao thêm việc (stock cho phép; plugin wake có sẵn cơ chế "một lần mỗi lần hoàn tất, reopen và duyệt lại hoàn tất mới" `integrator-wake.ts`), vòng 2 duyệt xong, issue `done` lần nữa, plugin đánh thức integrator, integrator thấy comment vòng 1 và "dừng im, không comment": mã vòng 2 không bao giờ được push, không có comment báo. Đây là hồi quy của việc đổi sang ancestor.

Sửa: chỉ dừng khi comment `crew-merge … pushed=yes` mới hơn bằng chứng `crew-docs-check` mới nhất của ME **và** `X` là tổ tiên của `origin/$DEFAULT`. Bằng chứng ở Gộp vòng 2 luôn mới hơn `crew-merge` vòng 1, và bằng chứng ở bước 4 của cùng một lần chạy luôn cũ hơn `crew-merge` của chính lần chạy đó, nên cả hai vòng đều đúng. Thêm test: `integrator.md` chứa so sánh thời gian này (cụm "mới hơn" cạnh `pushed=yes`). AC-2: mở lại issue đã push, duyệt lại, kỳ vọng integrator push vòng 2.

## n5: đóng, không mở đường cho executor

`integrator.md:9` chỉ chấp nhận `crew-review … verdict=approved` có `authorUserId` bằng `responsibleUserId` của issue hoặc user participant của policy ghim. Comment của agent mang `authorAgentId` (server gán theo actor) và `authorUserId` rỗng, nên executor không giả được comment của user. `responsibleUserId` đặt bởi H4 từ cấu hình, không do executor; kể cả nếu executor đổi được trường đó, người viết comment vẫn phải là một user thật (board, đáng tin). Vẫn đòi issue `done` và stage đầu trong `completedStageIds` (nhánh escalated hold ghi stage đó khi owner duyệt, xem `issue-execution-policy.ts:718-790`). Giữ yêu cầu dòng có `sha` là hợp lý. Còn một điểm nhỏ ở n7.

## n6: đóng

`executor.md` bắt buộc `crew-mac workflow-check --root "$(git rev-parse --show-toplevel)" --plugin-dir <ghim>`. Cờ khớp `cli.ts:26,248-254` (`--root`, `--plugin-dir`, đều đường tuyệt đối) và wrapper gọi bằng `${CREW_MAC_BIN:-$HOME/.crew/bin/crew-mac}`; "nằm cùng thư mục wrapper" khớp `command: …/.crew/bin/crew-claude-run`. Công cụ xét cả file ignore và bỏ qua log/cache, đúng mục tiêu của n6.

## Minor mới

- **n7.** Ngoại lệ owner (`integrator.md:9`): khi owner đã duyệt nhưng chưa đăng dòng `crew-review`, integrator "comment nhờ owner" mà không nói đổi trạng thái; root issue giữ nguyên giao cho integrator, không ai được đánh thức lại. Sửa: sau comment, `PATCH` `{"status":"blocked","comment":"Integrator: chờ owner đăng crew-review sha=<sha> cho <issue con>"}`.
- **n8.** `git fetch origin` ở phần mở đầu (`integrator.md:5`) không dặn dừng khi fetch lỗi. Nếu fetch lỗi, `origin/$DEFAULT` local có thể cũ hoặc bị agent khác dời (kho chung); bước merge ở bước 2 sẽ dùng ref đó. Push cũng sẽ lỗi nếu mạng đứt, nhưng nên dừng sớm: thêm "fetch lỗi thì `PUSHED=no`, không merge".
- **n9.** Chữ: `E` vừa là commit bằng chứng (bước 1) vừa là mã thoát docs ở mục Kiểm ("E=0/3") và ở bước 4 ("E docs"). Đổi commit bằng chứng thành `EV` hoặc mã thoát thành `DX` để tránh nhầm khi agent copy lệnh. Test/regex không bị ảnh hưởng.

## Hành động đề nghị

1. Sửa N3 (một so sánh thời gian ở `:46` và một test) là điều kiện để RO-2 đạt.
2. n7–n9 làm cùng lượt, không chặn.
3. AC-2 thêm: issue đã push được mở lại rồi duyệt lại: integrator phải push vòng 2.
