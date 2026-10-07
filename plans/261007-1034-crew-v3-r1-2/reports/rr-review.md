# Review gói `runtime-retry` — RR-1, RR-2

- Ngày: 07/10/2026 (Asia/Ho_Chi_Minh). Reviewer: code-reviewer (không phải implementer).
- Worktree `.worktrees/paperclip-r12-retry`, nhánh `crew/r12-retry`, HEAD `d5630e6f5`, gốc `v3` `e1c3dd2db`. Worktree sạch.
- Phạm vi: `git diff e1c3dd2db..d5630e6f5` (6 file, +601/−64): `server/src/crew/{remote-stop,load-gate,retry-progress}.ts` và 3 file test.
- Test: không chạy lại. SHA trong `rr-1-report.md` (`68bf8128d`) và `rr-2-report.md` (`d5630e6f5`) khớp `git log`; tên test trong diff khớp báo cáo. Có chạy hai thí nghiệm `git` trong scratchpad (git 2.54, `TZ=Asia/Ho_Chi_Minh`) để kiểm `--since` (mục 2).

## Verdict

| Ticket | Verdict | Lý do |
|---|---|---|
| RR-1 (`68bf8128d`) | **APPROVE** | Fallback exit 2 đúng và an toàn; mốc chờ ghi trước comment, hạn chót tính từ mốc đầu tiên. Chỉ còn minor (m1, m6). |
| RR-2 (`d5630e6f5`) | **CHANGES_REQUESTED** | Còn 3 đường retry chạy mù (M1–M3), đúng loại bug R1-1 mà ticket phải đóng. |

Tổng: 0 critical, 3 major, 7 minor.

## Phán ruling "lỗi DB ở `retryChecked` thì cổng cho chạy"

**Phán: fail-closed cho run retry** (đồng ý với lead), giữ fail-open của R1-1 cho run thường.

Lý do:
1. Lý lẽ fail-open của R1-1 dựa trên giá phải trả khi sai: cổng tải mở nhầm thì Mac chỉ bị quá tải một lúc. Với run retry, mở nhầm chính là bug cần đóng: agent làm lại và commit trùng (AC-1 R1-1). Hai trường hợp giá phải trả khác nhau, nên không lấy chung một mặc định được.
2. Fail-closed tốn rất ít: lỗi DB thoáng qua chỉ làm chậm một tick. Lỗi DB kéo dài thì `claimQueuedRun` cũng không ghi được, nên run vốn không chạy được.
3. Fail-closed vẫn có hạn chót: nếu đẩy lỗi vào nhánh `wait` như lỗi SSH (xem M1), `recordNotice` ghi mốc chờ ngay khi DB ghi được lại, nên run không bị giữ mãi.
4. Hai ruling đang mâu thuẫn nhau: ledger dòng 18 ("sai thì commit trùng như AC-1") và Review Focus 4 ("không mở cổng chạy lại mù") đòi đóng mọi đường mù, còn ruling dòng 115 tự ghi nhận đúng hậu quả "run chạy lại mù". Không có test nào kiểm hành vi fail-open này.

## Finding

### M1 (major) — RR-2: lỗi DB trước khi kiểm xong làm retry chạy mù

- File/symbol: `server/src/crew/load-gate.ts` `evaluateBeforeClaim` (dòng `if (!run.retryOfRunId || (await deps.retryChecked(run.id))) return false;`), `crewBeforeClaim` (catch → `return false`).
- Vấn đề: khi `retryChecked` ném lỗi, lỗi lan lên `crewBeforeClaim` và cổng fail open. Cùng hậu quả với `firstNoticeAt(run.id, "expired")`, `firstNoticeAt(run.id, "waiting")` và `loadTarget` khi chúng ném lỗi lúc run là retry: run được claim mà không ai kiểm commit.
- Cách sửa:
  - Trong nhánh `claim`, bọc `retryChecked`: nếu lỗi thì gán `failure = "không đọc được dấu đã kiểm: …"` và đi tiếp vào `decideGate({ probe: { ok: false, … } })` như lỗi SSH. Cách này có mốc chờ và hạn chót.
  - Trong `crewBeforeClaim` catch: `return input.run.status === "queued" && Boolean(input.run.retryOfRunId);`, có log `failed closed for a retry`. Như vậy các lỗi ném trước nhánh retry chỉ giữ run một tick.
  - Thêm test: `retryChecked` ném lỗi thì cổng trả `true` và ghi `mark:waiting`; `crewBeforeClaim` với run retry mà dep ném lỗi thì trả `true`.
  - Sửa ruling dòng 115 trong ledger.

### M2 (major) — RR-2: không xác nhận run trước đã chết trước khi chụp `git log`

- File/symbol: `server/src/crew/retry-progress.ts` `createRetryProgressChecker`; luồng `services/heartbeat.ts` nhánh `process_lost` (`releaseEnvironmentLeasesForRun` → `enqueueProcessLossRetry` → `startNextQueuedRunForAgent`).
- Vấn đề: H3 (`stopRemoteRunOnRelease`) chỉ được gọi một lần, khi trả lease. Lỗi bị nuốt, và quá 15 giây (`CREW_RUN_LEASE_RELEASE_HOOK_TIMEOUT_MS`) thì bỏ chờ. Kết quả `unreachable`/`failed`/`incomplete` chỉ được ghi vào activity `crew.remote_stop`; không ai đọc lại nó. Khi đường VPS↔Mac rớt mà Mac vẫn có Internet, process claude của run trước có thể vẫn sống. Reaper của Mac cần ít nhất `MIN_GRACE_SECONDS = 60` cộng thêm chu kỳ `StartInterval`. Probe hồi lại thì cổng claim ngay, nên `git log` chụp được giữa chừng và hai run cùng commit trong một worktree. Đây là commit trùng, đúng mục tiêu gốc.
- Cách sửa (tái dùng code có sẵn, không thêm abstraction): trong cùng một lệnh SSH, chạy `buildRemoteStopCommand(previousRunId, cwd)` trước, rồi mới `git log`, ví dụ `<stop> && <git log>`. Đọc dòng `crew-stop … remaining=N` bằng `parseRemoteStopOutput` (stdout cần một dấu phân cách giữa hai phần). Nếu `remaining > 0` hoặc không đọc được dòng tổng kết thì trả `{ kind: "error" }` để cổng giữ run. Timeout phải nâng lên khoảng `REMOTE_STOP_TIMEOUT_MS + RETRY_PROGRESS_TIMEOUT_MS`. Hook này chạy dưới khóa start (khóa stale ở 30 giây), nên tổng thời gian phải dưới 30 giây. Cách khác, nhẹ hơn: đọc activity `crew.remote_stop` mới nhất của run trước và chỉ cho kiểm khi `outcome ∈ {stopped, skipped}`, nhưng cách này không bắt được process sống lại sau lần stop.
- Test: fake SSH trả `remaining=1` thì kết quả là `error`; trả `remaining=0` rồi tới các dòng commit thì là `checked`.

### M3 (major) — RR-2: chỉ đọc `HEAD` nên sót commit của run trước khi worktree đã đổi nhánh

- File/symbol: `retry-progress.ts` `buildRetryProgressCommand` (`… -n 20 HEAD`). Ruling ledger dòng 37 ghi "chỉ `HEAD` của `remoteCwd`".
- Vấn đề: theo `roles.md` dòng 146, executor làm trên nhánh `crew/<identifier>` trong worktree dùng chung cho mọi issue của agent. Retry được xếp hàng sau các run `queued` cũ hơn của cùng agent, và `startNextQueuedRunForAgent` lấy run cũ nhất trước. Một run khác (issue khác) có thể claim trước và `git switch` sang nhánh của nó. Khi tới lượt retry, `HEAD` đã là nhánh khác. Kết quả là cổng báo 0 commit (không có comment, đánh dấu `checked`, run chạy mù), hoặc liệt kê commit của issue khác như thể là của run trước. Cả hai trường hợp đều cho thông tin sai.
- Cách sửa: đọc mọi nhánh local thay vì chỉ `HEAD`, kèm tên nhánh, ví dụ `git log --branches --source --format='%H%x09%cI%x09%S%x09%s' …`. Comment ghi nhánh của từng commit. Nếu lấy được `identifier` của issue thì lọc `--branches='crew/<identifier>'` cộng thêm `HEAD`. Đổi ruling dòng 37 thì cần lead/owner chốt, vì ruling đó do chủ dự án duyệt.

### m1 (minor) — RR-1 + RR-2: comment thành công nhưng activity lỗi thì comment bị nhân bản mỗi tick

- File/symbol: `load-gate.ts` `defaultBeforeClaimDeps.postComment` (`addComment` rồi `logActivity …_comment`), `recordRetryProgress` (`addComment` rồi `logActivity crew.retry_progress.checked`). Thêm nhánh hết hạn lần đầu trong `evaluateBeforeClaim`: `postComment` expired không kiểm `expired_comment`, nên nếu tick trước đã ghi comment mà ghi mốc `expired` lỗi thì comment lặp lại.
- Với retry còn nặng hơn: mỗi tick SSH lại và comment lại, cho tới khi activity ghi được.
- Cách sửa: với retry, ghi activity `crew.retry_progress.checked` (kèm danh sách sha trong `details`) **trước**, rồi comment theo dấu riêng `crew.retry_progress.comment`. Còn dấu `checked` mà chưa có dấu comment (và có commit) thì cổng chỉ thử lại comment, không SSH lại, và vẫn giữ run nếu comment lỗi. Cách này đi theo đúng mẫu mốc/comment của RR-1. Với nhánh hết hạn lần đầu, kiểm `firstNoticeAt(run.id, "expired_comment")` trước khi comment. Chấp nhận được nếu lead coi đây là lỗi hiếm (activity lỗi ngay sau comment thành công).

### m2 (minor) — RR-2: "một lần kiểm mỗi run" không đảm bảo khi hai lần claim chạy song song

- File/symbol: `load-gate.ts` nhánh `claim` (`retryChecked` → `checkRetryProgress` → `recordRetryProgress`); `services/heartbeat.ts` `executeRun` gọi `claimQueuedRun(run)` từ các đường dispatch ở dòng ~14937, ~18854, ~19887. Các đường này không nằm trong `withAgentStartLock` của `startNextQueuedRunForAgent`. Thêm nữa, `agent-start-lock.ts` tự bỏ khóa sau `AGENT_START_LOCK_STALE_MS = 30_000`.
- Vấn đề: hai lần đánh giá song song đều thấy `retryChecked = false`, nên SSH hai lần, ra hai comment `Crew: lần chạy lại` và hai activity. Không làm run chạy mù (kiểm vẫn xong trước khi claim), nhưng vi phạm interface "một lần mỗi run".
- Cách sửa: singleflight trong process, kiểu `const inFlight = new Map<string, Promise<boolean>>()` theo `run.id` trong `crewBeforeClaim`; lần gọi thứ hai trả `true` (giữ run) khi lần đầu chưa xong. Nếu cần chắc giữa nhiều process thì dùng `pg_try_advisory_xact_lock(hashtext(run.id))`.

### m3 (minor) — RR-2: `--since` dừng duyệt ở commit cũ đầu tiên; lệch đồng hồ quá 30 giây

- File/symbol: `buildRetryProgressCommand`, `RETRY_SINCE_SLACK_MS`.
- Đã kiểm thực nghiệm (git 2.54, `TZ=Asia/Ho_Chi_Minh`):
  - Mốc `…T09:14:30.000Z` được parse đúng là UTC (`--max-age=1791364470`), không bị hiểu thành giờ local.
  - `--since` lọc theo **committer date**: commit amend/rebase có author date cũ vẫn được liệt kê. Câu hỏi 2 của lead: đạt.
  - Nhưng `--since` **dừng duyệt cha** ở commit đầu tiên có committer date cũ hơn mốc. Chuỗi `base(08:00) ← a1(09:20) ← skewed(09:13) ← a3(09:30)` chỉ ra `a3`; `--since-as-filter` ra `a3, a1`. Điều này xảy ra khi đồng hồ Mac bị nhảy, hoặc khi dùng `rebase --committer-date-is-author-date`.
  - Đồng hồ Mac chậm hơn VPS quá 30 giây thì các commit đầu của run trước bị sót.
- Cách sửa: bỏ `--since` và lấy `-n 50 --format='%H%x09%ct%x09%cI%x09%s'`. Cùng lệnh SSH in thêm `date +%s` của Mac, để `parseRetryCommits` lọc theo `ct >= startedAt + (macNow − vpsNow) − slack`. Cách này xử lý được cả lệch đồng hồ lẫn việc dừng duyệt. Cách tối thiểu là `--since-as-filter`, nhưng cần git ≥ 2.38 trên Mac mini; nên cho `crew-mac doctor` kiểm.

### m4 (minor) — RR-2: comment ghi "mất kết nối" cho mọi lý do retry

- File/symbol: `retryProgressComment`.
- `retryOfRunId` được gán cho cả `missing_issue_comment`, `transient_failure`, workspace busy và các retry khác (`heartbeat.ts` dòng ~13972, ~15394, ~15756). Comment luôn ghi "… mất kết nối", nên sai sự thật với các lý do này. Executor (theo `roles.md` dòng 141) lại hiểu đúng như vậy.
- Cách sửa: đổi thành câu trung tính ("run `<id>` trước đó dừng giữa chừng"), hoặc đọc `contextSnapshot.retryReason` để ghi đúng lý do. Nhớ sửa câu tương ứng ở `roles.md` (RO-1).

### m5 (minor) — RR-2: có commit nhưng run không gắn issue thì vẫn chạy mù

- File/symbol: `defaultBeforeClaimDeps.recordRetryProgress` (`if (… && issueId)`).
- Có commit mà `issueId` là null thì không có comment nào, nhưng vẫn ghi `checked`, nên agent không biết gì. Hiếm gặp, nhưng là đường mù im lặng.
- Cách sửa: tối thiểu ghi `details.unreported: true` và log warn. Hoặc giữ run như lỗi kiểm (tuỳ lead).

### m6 (minor) — RR-1/RR-2: hết hạn vì kiểm tiến độ lỗi thì người dùng không được báo về commit chưa kiểm

- File/symbol: `load-gate.ts` `expiredBody`, `waitingBody`, nhánh hết hạn của `evaluateBeforeClaim`.
- Comment hết hạn dặn "chuyển issue về `todo` để chạy lại". Run mới sinh ra khi đó không có `retryOfRunId`, nên không được kiểm commit. Nếu kiểm lỗi vì SSH chậm thật (không phải vì worktree bị xóa), run mới sẽ chạy mù. Ngoài ra, khi run đã có `waiting_comment` từ lần chờ tải trước, lý do "kiểm tiến độ lỗi" không bao giờ lên issue.
- Thêm một điểm cũ, không do diff này gây ra: `blockIssue` lỗi thì không được thử lại ở nhánh "đã hết hạn".
- Cách sửa: khi `failure` đến từ kiểm tiến độ, `expiredBody` thêm câu "chưa kiểm được commit của run `<prev>` từ <giờ>; chạy `git log` trong worktree trước khi chuyển `todo`". Nhánh "đã hết hạn" thử lại `blockIssue` theo một dấu riêng.

### m7 (minor) — RR-2: chép lại `shellQuote`

- File/symbol: `retry-progress.ts` `quote`.
- `@paperclipai/adapter-utils/ssh` đã export `shellQuote`, và `remote-stop.ts` dòng 2 đang dùng nó. Hãy dùng chung để tránh hai bản quoting. Bản `quote` hiện tại đúng POSIX: nó chạy bên trong `sh -c ${shellQuote(remoteCommand)}` của `runSshCommand` (`packages/adapter-utils/src/ssh.ts` ~1226–1241), nên tên thư mục có `'`, `$`, `;` hay khoảng trắng đều không thoát ra được.
- Ghi chú: chặn xuống dòng là thừa nhưng vô hại. Không cần sửa ruling dòng 116.

## Trả lời 5 câu kiểm của lead

1. **Retry chạy mù**: còn ba đường, M1 (lỗi DB → fail open), M2 (run trước còn sống) và M3 (`HEAD` đã đổi nhánh); thêm m5 (không có issue). Lỗi kiểm SSH/`git`/ghi comment thì đã giữ `queued` theo hạn chót đúng Review Focus 4 (test "holds the run… when git fails", "expires a retry whose progress check keeps failing"). Phán ruling: fail-closed (xem trên).
2. **Mốc thời gian và quoting**: `--since` dùng committer date và parse đúng `Z` (đã kiểm thực nghiệm). Còn chỗ dừng duyệt và lệch đồng hồ quá 30 giây (m3). Quoting `remoteCwd` an toàn trước injection nhờ hai lớp `sh -c` có quote đúng (m7).
3. **Mốc chờ bền RR-1**: đạt. Activity `crew.load_gate.waiting` ghi trước comment, `firstNoticeAt` lấy dòng cũ nhất (`orderBy(asc(createdAt))`), nên hạn chót không bị đẩy lùi. Comment lỗi được thử lại theo dấu `_comment` riêng. Comment chỉ bị nhân bản khi comment thành công mà activity lỗi (m1).
4. **Fallback exit 2**: đạt. `crew-mac` chỉ trả 2 cho `StopRunInputError`/`UsageError`, tức là trước khi động vào process (`apps/crew-mac/src/cli.ts` ~240–247, `stopRun` kiểm guard trước `listProcesses`). Fallback chỉ nhắm (a) group trong file `pgid` của đúng run, có kiểm giờ bắt đầu của leader ±2 giây, và (b) process mang đúng token `PAPERCLIP_RUN_ID=<uuid>`. Fallback không quét theo cwd, nên root bị từ chối (HOME, `/`, ngoài `worktreeRoot`) không làm nó dừng nhầm process ngoài worktree. `rm -rf` chỉ xóa thư mục `<root>/.paperclip-runtime/runs/<uuid>`. Lưu ý cho M2: kết quả `via=fallback` yếu hơn `crew-mac`, vì không thấy tool mồ côi (binary Apple không đọc được env qua `ps -E`), nên `matched=0` không chứng minh run trước đã chết hẳn.
5. **Một lần mỗi run**: đúng khi chạy tuần tự (test "does not check over SSH again"). Không đảm bảo khi hai lần claim chạy song song (m2), và khi comment thành công mà activity lỗi (m1).

## Việc nên làm (theo thứ tự)

1. M1: fail-closed cho retry, kèm test.
2. M2: dừng run trước rồi mới `git log` trong cùng lệnh SSH, kèm test.
3. M3: đọc mọi nhánh local kèm tên nhánh. Cần lead/owner chốt lại ruling dòng 37.
4. m1, m3, m4 nên làm cùng đợt; m2, m5, m6, m7 tuỳ lead.

## Câu hỏi còn mở

- M3 đụng ruling đã duyệt ("chỉ `HEAD`"): lead/owner chọn `--branches` toàn bộ, hay lọc theo `crew/<identifier>`?
- M2: chấp nhận nâng timeout hook retry lên khoảng 17 giây (dưới mức stale 30 giây của khóa start) không?

## Re-review — RR-2 sửa sau review (`2ae7d77c3`)

- Ngày 07/10/2026. Diff `d5630e6f5..2ae7d77c3` (4 file, +486/−143). Đã đọc mục "Sửa sau review" của `rr-2-report.md` và các ruling mới cuối `sdd-ledger.md`. Lead đã chốt M1 (fail-closed), M2 (timeout 17 giây), M3 (`--branches`), chấp nhận m2 và m5.
- Không chạy lại test: HEAD `2ae7d77c3` khớp báo cáo, worktree sạch, tên test trong diff khớp các mục sửa. Chỉ thử `git` trong scratchpad (mục n1).

### Verdict

| Ticket | Verdict |
|---|---|
| RR-1 (`68bf8128d`) | **APPROVE** (giữ nguyên) |
| RR-2 (`d5630e6f5` + `2ae7d77c3`) | **APPROVE** — 3 major đã đóng; còn 4 minor (n1–n4), không chặn merge, nên làm trước AC-2 Cổng 4 |

### Kiểm từng điểm

1. **M1 — đã đóng.**
   - `retryCheckFailure` bọc `retryState` và `recordRetryProgress`. Lỗi được chuyển thành `failure` → `decideGate({ probe: { ok: false } })`, nên run có mốc chờ và hạn chót.
   - Catch của `crewBeforeClaim` trả `status === "queued" && retryOfRunId` (giữ run). Các lỗi ném sớm hơn (`loadTarget`, `firstNoticeAt`) rơi vào catch này nên chỉ giữ run một tick. Run thường vẫn fail open.
   - Test có: "holds the run with a waiting marker when the checked marker cannot be read", "holds the run when the checked marker cannot be written", "holds a queued retry (fails closed)", "lets a run that is not a retry be claimed (fails open)".
2. **M2 — đã đóng. Stop chỉ nhắm đúng run trước.**
   - `buildRetryProgressCommand` = `buildRemoteStopCommand(previousRunId, cwd) && echo crew-retry-clock … && git log …`. Stop thoát khác 0 thì `&&` cắt chuỗi, SSH ném lỗi, kết quả là `error` và run bị giữ. Thiếu dòng tổng kết, `remaining > 0` hoặc thiếu giờ Mac cũng ra `error`.
   - Đường `crew-mac stop-run` (`apps/crew-mac/src/reaper/run-members.ts` `selectRunMembers`) chọn ba nhóm:
     - (a) claude `--print` mang đúng `runId` cùng cây con của nó;
     - (c) group `pgid` của run, chỉ khi leader sinh đúng lúc run bắt đầu ±1 giây, và chỉ lấy process trong cửa sổ `[started, nextStarted)`;
     - (b') process mồ côi: cwd dưới worktree, không tty, trong cùng cửa sổ, `runId` null hoặc đúng run, và chuỗi cha chỉ gặp launchd.
   - Vì vậy một run khác của cùng agent hay cùng worktree không bị đụng: process của nó sinh sau `nextStarted`, có cha là claude của nó (không phải mồ côi), hoặc mang `runId` khác. Đường fallback chỉ nhắm group trong file `pgid` của đúng run và token `PAPERCLIP_RUN_ID=<prev>`.
   - Khi H3 đã dừng xong thì `runs/<prev>` đã bị xóa, nên lần stop thứ hai chỉ còn nhánh (a). Đó là đúng ý (không còn gì để dừng).
   - `RETRY_PROGRESS_TIMEOUT_MS = 17_000`, dưới 30 giây của khóa start; có test.
3. **M3 — đã đóng**, còn sót trường hợp HEAD tách nhánh (n1). Lệnh dùng `git log --branches --source`, comment ghi nhánh của từng commit, bỏ `--since`.
4. **Thứ tự marker trước comment — không có đường mất comment im lặng.**
   - `crew.retry_progress.checked` lưu `details.comment` trước. Comment lỗi thì cổng giữ run. Tick sau, `retryState` trả `pendingComment` (có `checked` mà chưa có `crew.retry_progress.comment`), nên chỉ đăng lại comment, không SSH lại.
   - Comment đã lên mà marker lỗi thì `hasCommentWithPrefix` chặn đăng trùng.
   - Trường hợp xấu nhất là comment lỗi mãi tới hạn chót: run bị hủy, issue `blocked`, và `expiredBody` (run có `retryOfRunId`) dặn kiểm `git log --branches` bằng tay. Người dùng vẫn được báo, không mất im lặng.
   - Test DB "ghi dấu đã kiểm kèm comment trước, comment sau, và không đăng lại comment đã có" đi qua `logActivity` thật và thấy `pendingComment` khớp nguyên văn.
5. **Bù lệch đồng hồ — đúng dấu.**
   - `offsetMs = macNow·1000 − (sentAt + receivedAt)/2`, `minSeconds = (startedAt + offset − 30 s)/1000`, so với `%ct` (giờ Mac). Ví dụ Mac chậm 120 giây: offset = −120 giây, mốc lùi về `S − 150`, commit ở giờ Mac `S − 110` vẫn được lấy. Test "bù lệch đồng hồ Mac khi lọc theo giờ commit" kiểm đúng trường hợp này.
   - Sai số: `date` chạy sau bước stop (tối đa khoảng 12 giây), nên lấy điểm giữa cửa sổ SSH làm giờ VPS lệch tối đa khoảng 8,5 giây. Con số này vẫn nằm trong 30 giây dư, chấp nhận được.

### Finding còn lại (minor)

- **n1 — `retry-progress.ts` `buildRetryProgressCommand`: `--branches` bỏ sót commit trên HEAD tách nhánh.**
  - Đã kiểm thực nghiệm: repo có HEAD detached, `git log --branches --source` không thấy commit `detached`; `git log --branches HEAD --source` thì thấy (nhãn nguồn là `HEAD`).
  - Run trước mất giữa lúc `git rebase` (HEAD detached trong khi rebase) hoặc `git checkout <sha>` thì các commit đó bị sót. Kết quả có thể là 0 commit, run chạy mù.
  - Sửa: `git -C … log --branches HEAD --source …`.
- **n2 — `-n 50` cắt mất commit cũ nhất của run trước mà không báo.**
  - Worktree của các agent dùng chung ref của repo, nên `--branches` gồm cả nhánh của agent khác và của owner. Nhiều hơn 50 commit trong cửa sổ thì phần bị cắt là commit cũ nhất, mà đó chính là các commit đầu của run trước.
  - Câu "Run đó đã có N commit" cũng nói quá: N gồm cả commit của nhánh khác.
  - Sửa:
    - khi đủ 50 dòng mà dòng cuối vẫn trong cửa sổ thì coi là bị cắt; tăng `-n` hoặc ghi rõ trong comment;
    - đổi câu thành "Từ lúc run đó bắt đầu có N commit trên các nhánh local";
    - đưa nhánh `crew/<identifier>` (nếu biết) lên đầu danh sách.
- **n3 — `load-gate.ts` `hasCommentWithPrefix` không lọc `authorType = 'system'` và `deletedAt IS NULL`.**
  - Hai cách làm Crew không đăng comment tiến độ, kể cả bản comment lần chạy lại: agent hoặc người viết comment trùng prefix (agent của run trước biết run id của chính nó, nên chặn được comment lần chạy lại), hoặc owner đã xóa comment cũ.
  - Cùng loại rủi ro mà ruling prefix đã ghi nhận, nhưng sửa chỉ tốn hai điều kiện: `eq(issueComments.authorType, "system")`, `isNull(issueComments.deletedAt)`.
- **n4 — `pendingComment` lấy từ `activity_log.details` đã qua `redactActivityDetails`.**
  - Khi bật `censorUsernameInLogs`, comment đăng lại ở tick sau có thể bị che tên user trong `cwd` (ví dụ `/Users/<user>/…`). Chỉ ảnh hưởng nội dung hiển thị, không ảnh hưởng chuyện chạy mù.
  - Sửa: dựng lại comment từ `details` có cấu trúc (danh sách commit, `previousRunId`, `cwd`), hoặc chấp nhận và ghi chú.

### Việc tiếp

1. n1 (sửa một từ, nên làm cùng PR). n2, n3 nên làm trước AC-2. n4 tuỳ lead.
2. Cổng 4 AC-2: trên Mac mini, kiểm lệnh kiểm tiến độ với một run khác đang chạy trong cùng worktree: run đó không bị dừng, và `remaining=0`.
3. RO-1: đổi câu "mất kết nối" trong `roles.md` dòng 141 thành "dừng giữa chừng", và đọc nhánh của từng commit trong comment (đã ghi ở ledger).

## Review sau AC-2 — L1 (`edbca2b3f`), L4 (`d95c9a88d`)

- Ngày 07/10/2026. Diff `3bbdd554a..d95c9a88d` (6 file, +616/−9). Đã đọc `ac-2-report.md` (L1, L4), `reports/rr-3-report.md` và ruling mới cuối `sdd-ledger.md`.
- Không chạy lại test: SHA khớp báo cáo. Kết luận dưới đây dựa trên đọc đường gọi stock theo symbol: `claimQueuedRun`, `cancelStaleQueuedRun`/`cancelStaleRunInTx`, `withIssueThenRunLocks`, `legacyExecutionNeedsReconciliation`, `releaseRunLease`.

### Verdict

| Commit | Verdict |
|---|---|
| L1 `edbca2b3f` (H3 chạy nền, cổng giữ claim khi lệnh dừng chưa xong) | **CHANGES_REQUESTED** (A2) |
| L1 `edbca2b3f` (`neverStartedCancelOptions` cho run cổng tự hủy) | đạt |
| L4 `d95c9a88d` (dấu `executionRecovery` giả) | **CHANGES_REQUESTED** (A1 critical, A3) |

Tổng: 1 critical, 2 major, 3 minor.

### A1 (critical) — L4: dấu bị xóa trước đúng đường hủy mà nó muốn phủ, nên CRE-21 vẫn xảy ra

- File/symbol: `server/src/crew/load-gate.ts` `evaluateBeforeClaim` (nhánh `clearHeld` khi quyết cho claim); stock `services/heartbeat.ts` `claimQueuedRun` (dòng ~17128 gọi hook, dòng ~17265 gọi `runDispatch.cancelStaleQueuedRun({ expectedStatus: "queued" })`); `modules/run-dispatch/adapters/postgres.ts` `cancelStaleQueuedRun` → `withIssueThenRunLocks` (đọc lại run dưới khóa) → `cancelStaleRunInTx` (`...parseObject(run.resultJson)`).
- Vấn đề: stale gate `expectedStatus: "queued"` chỉ được gọi **bên trong `claimQueuedRun`, sau khi H1 trả `false`**. Grep cho thấy chỉ có hai nơi gọi `cancelStaleQueuedRun`: dòng 17265 (queued) và dòng ~20226 (`running`, sau claim). `dispatchResolvedInteractionIfCurrent` cũng chạy với `running`. Khi cổng còn giữ run (trả `true`), `claimQueuedRun` thoát ở `return null` trước khi tới stale gate.
- Hệ quả: ca thật CRE-21 diễn ra như sau:
  - Cổng giữ run vài chục phút, trong lúc đó issue chuyển sang chờ review.
  - Máy hết tải, cổng quyết cho claim và **`clearHeld` xóa dấu**.
  - Stale gate đọc lại run dưới khóa (không còn dấu) và hủy với `issue_continuation_waiting_on_review`.
  - `reconcileStrandedAssignedIssues` → `legacyExecutionNeedsReconciliation` = `true` → lại sinh hold `legacy_execution_requires_reconciliation`.
  
  Vậy bản sửa không phủ đường hủy thật.
- Test "stock stale gate hủy run đang chờ máy…" chép phép ghi của `cancelStaleRunInTx` trong lúc run **đang được giữ**. Trong production không có thứ tự đó, nên test xanh mà bug vẫn còn.
- Cách sửa (chọn một, không đụng lõi):
  1. Khi cổng quyết cho claim mà run còn dấu, chạy đánh giá staleness của stock ở chế độ chỉ đọc trước. Có thể export một hàm đọc dùng chung `decideCurrentRunStaleness` hoặc `decideQueuedRunStaleness` cùng bộ nạp facts; xem có export sẵn chưa. Nếu `stale` thì **giữ dấu** và trả `false`, để stock tự hủy run có kèm bằng chứng `bootstrap`. Nếu không `stale` thì xóa dấu rồi cho claim. Khe hở còn lại (issue đổi trạng thái giữa lần đọc và khóa của stock) nhỏ hơn nhiều.
  2. Hoặc, khi cổng cho claim mà issue không còn ở trạng thái có thể chạy, cổng tự `cancelRun` run đó. `cancelRun` tự gắn bằng chứng `bootstrap`, và với adapter hội thoại thì dùng `neverStartedCancelOptions`. Cổng không trả `false` cho run sắp bị stale gate hủy.
  
  Test phải đi đúng đường thật: dùng `resumeQueuedRuns`/`claimQueuedRun` thật, trong đó tick 1 Mac không vào được (cổng giữ); issue chuyển sang chờ review; tick 2 Mac ổn. Kỳ vọng: run `cancelled` bởi `stale_queued_run_gate`, không có action `legacy_execution_requires_reconciliation`, wake sau tạo được run.

### A2 (major) — L1: server restart lúc lệnh dừng nền còn chạy thì mất cả lệnh dừng lẫn cổng giữ claim

- File/symbol: `server/src/crew/remote-stop.ts` `startRemoteStopOnRelease`, `pendingStops` (Map trong bộ nhớ), `isRemoteStopPending`; `services/environment-runtime.ts` `releaseRunLease` (`await crewCoreHooks.onRunLeaseReleased(...)` rồi `environmentsSvc.releaseLease(...)`).
- Vấn đề:
  - Lúc này hook trả về ngay, nên lease được đánh dấu nhả trong DB vài mili giây sau đó.
  - Server thoát trong khoảng tối đa 12–20 giây lệnh dừng đang chạy: tiến trình ssh client chết, lệnh dừng trên Mac có thể không chạy hết, và `pendingStops` mất.
  - Sau restart, lease **đã nhả** nên reaper stock không nhả lại, H3 không chạy lại. Câu "khi server restart, reaper nhả lease thì H3 chạy lại" trong `rr-3-report.md` và ruling chỉ đúng với thứ tự cũ.
  - Cổng tải cũng không còn dấu đang dừng, nên run kế tiếp của **cùng agent** (cùng worktree) có thể claim ngay, chạy song song với process cũ cho tới khi reaper trên Mac dọn (`MIN_GRACE_SECONDS = 60` cộng chu kỳ `StartInterval`). Hợp đồng R1-1 "restart server không chạy song song" bị hở trong cửa sổ đó.
  - Retry thì vẫn an toàn nhờ bước dừng run trước trong lệnh kiểm tiến độ (RR-2); run thường thì không.
- Cách sửa: lưu dấu đang dừng vào DB thay vì bộ nhớ.
  - Ghi activity `crew.remote_stop.started` (`environmentId`, `runId`) **trước** khi SSH.
  - `remoteStopPending` trở thành một truy vấn: có `started` trên environment này mà chưa có `crew.remote_stop` kết quả cho cùng run, và `createdAt` trong vòng `REMOTE_STOP_BACKGROUND_LIMIT_MS + grace của reaper` (khoảng 90–120 giây) → giữ. Cách này có giới hạn, sống qua restart, và sau restart dựa vào reaper trên Mac.
  - Tốt hơn: cổng thấy `started` mồ côi (quá 20 giây, không có kết quả) thì tự khởi động lại `startRemoteStopOnRelease` cho run đó.
  - Map trong bộ nhớ vẫn dùng được làm cache nhanh.
  - Sửa câu tương ứng trong ruling/báo cáo.

### A3 (major) — L4: run đã thực sự chạy vẫn có thể mang dấu "chưa bắt đầu" khi bản `run` trong bộ nhớ đã cũ

- File/symbol: `load-gate.ts` `evaluateBeforeClaim` (`if (!hasNeverStartedMarker(run.resultJson)) return false;`, đọc từ `run` mà caller truyền vào), `markHeld`.
- Vấn đề: việc có xóa dấu hay không phụ thuộc bản `run` caller đã đọc trước khi gọi hook. Hai lần đánh giá song song là đường đã chấp nhận ở m2 (`executeRun` từ các đường dispatch khác, khóa start bị coi là stale sau 30 giây):
  - lần A giữ run và `markHeld` commit;
  - lần B đọc `run` trước đó, quyết cho claim, thấy bản trong bộ nhớ không có dấu nên **không xóa** và claim.
  
  Run chạy thật mà mang `executionRecovery { bootstrap, providerWorkStarted: false }`. Đường `process_lost` (`setRunStatusFromLive` + `mergeRunStopMetadataForAgent(parseObject(run.resultJson))`) giữ nguyên `resultJson`, nên sau một lỗi thật `legacyExecutionNeedsReconciliation` trả `false`. Stock bỏ qua đối soát của một run đã làm việc thật, đúng loại "dấu giả làm stock hiểu sai" mà lead hỏi. Ledger ghi "không có đường như vậy", nhưng lập luận đó chỉ xét đường không đi qua H1, chưa xét bản `run` cũ.
- Cách sửa: khi quyết cho claim, luôn gọi `clearHeld` có điều kiện trong DB (`WHERE resultJson->'executionRecovery'->>'heldBy' = 'crew_load_gate'`, 0 dòng cũng không sao), không dựa vào bản trong bộ nhớ. Chỉ tốn một UPDATE theo khóa chính, và chỉ cần khi `target` khác null hoặc run thuộc environment Crew. Kết hợp với A1, chỉ được xóa khi không `stale`.

### Minor

- **b1 — `remoteStopPending` không ghi mốc chờ.** Đúng ý vì chỉ kéo dài tối đa 20 giây. Nhưng run bị giữ sẽ chờ tick scheduler kế tiếp (`heartbeatSchedulerIntervalMs` mặc định 30 giây); lệnh dừng xong không kích hoạt claim nào. Vậy độ trễ chuyển stage thực tế lên tới khoảng 50 giây. Chấp nhận được; ghi vào AC-2 để đo, hoặc gọi `startNextQueuedRunForAgent` qua `setImmediate` khi lệnh dừng xong (không cần thiết).
- **b2 — Run có thể bị giữ mãi mà không có hạn chót, chỉ khi DB lỗi kéo dài.** Hai trường hợp: `clearHeld` lỗi mãi, hoặc `crewBeforeClaim` ném lỗi mãi với run có dấu. Cả hai đều trả `true` và không ghi mốc chờ. Chỉ xảy ra khi DB lỗi kéo dài, lúc đó claim vốn cũng không ghi được. Ngoài hai trường hợp này, em không tìm thấy đường nào giữ run mãi: `pendingStops` luôn được xóa ở `finally` sau tối đa 20 giây; nhánh chờ/hết hạn có mốc bền; environment mất `crewLoadGate` vẫn xóa dấu và cho claim.
- **b3 — `neverStartedCancelOptions` kiểm `status = queued` trong một truy vấn riêng, sau đó `cancelRun` mới chạy trong `setImmediate`.** Giữa hai bước run vẫn bị cổng giữ (nhánh `expired` luôn trả `true`), nên không có đường run được claim xen vào. Đạt; chỉ ghi chú.

### Trả lời câu hỏi của lead

1. **Hợp đồng R1-1 khi H3 chạy fire-and-forget:**
   - Hủy run → process dừng trong ≤ 30 giây: **giữ**. Lệnh dừng khởi động ngay khi nhả lease, ngân sách SSH 12 giây, giới hạn nền 20 giây.
   - Restart server không chạy song song: **hở** (A2). Trạng thái nằm trong bộ nhớ, và lease đã nhả nên H3 không chạy lại.
   - Mất mạng → reaper dọn: **giữ**. Reaper trên Mac không đổi, và nó là lưới an toàn duy nhất trong ca A2.
2. **Dấu `executionRecovery` giả:**
   - Không phủ được ca CRE-21 vì bị xóa trước stale gate (A1).
   - Có thể dính lên run đã thật sự chạy khi bản `run` trong bộ nhớ cũ (A3).
   - Xóa lỗi thì cổng giữ run, đúng.
   - Không có đường stock nào khác đọc `executionRecovery` trên run `queued`: chỉ `legacy-execution-recovery.ts` đọc.
3. **Run bị giữ mãi:** chỉ khi DB lỗi kéo dài (b2); không có đường logic nào khác.

### Việc nên làm

1. A1 (critical): đổi chỗ xóa dấu hoặc để cổng tự hủy run sắp bị stale; viết lại test theo đúng thứ tự `claimQueuedRun` thật.
2. A3: xóa dấu có điều kiện trong DB, không dựa vào bản `run` trong bộ nhớ.
3. A2: lưu dấu đang dừng vào DB, có giới hạn thời gian, sống qua restart; sửa câu trong ruling.
4. Chạy lại luồng chuyển stage ở AC-2 để đo L1 và ca CRE-21 (issue chuyển sang chờ review trong lúc cổng giữ run).

## Re-review sau AC-2 — A1–A3 (`54a819878`)

- Ngày 07/10/2026. Diff `d95c9a88d..54a819878` (6 file, +275/−76). Đã đọc mục "Sửa sau review AC-2" của `rr-3-report.md`.
- Không chạy lại test: SHA khớp báo cáo; test A1 mới đi qua `resumeQueuedRuns`/`claimQueuedRun` thật, và có RED trên `d95c9a88d` đúng triệu chứng A1.
- Đã đọc stock theo symbol: `claimQueuedRun` (thứ tự các lần kiểm trước stale gate), `applyRunDispatchPostCommitEffects`, `cancelStaleQueuedRun`, chỉ mục của `activity_log`.

### Verdict

**APPROVE có điều kiện.** A1, A2, A3 đã đóng, không mở lỗi đúng sai mới. Còn 1 major hiệu năng (c1, sửa một dòng, nên làm trước merge) và 2 minor.

| Mục | Trạng thái |
|---|---|
| A1 | **Đóng.** `releaseHeld` thấy dấu trong DB thì gọi `createRunDispatch(db).cancelStaleQueuedRun({ expectedStatus: "queued" })`, đúng hàm stock dưới `withIssueThenRunLocks`. Run stale bị hủy khi dấu `bootstrap` còn nguyên. Hook trả `true`, nên `claimQueuedRun` trả `null`. Test thật đi đúng thứ tự: tick 1 giữ run, issue đổi trạng thái, tick 2 Mac ổn. Kết quả: `stale_queued_run_gate` + `executionRecovery` còn, không có `legacy_execution_requires_reconciliation`. |
| A2 | **Đóng.** `crew.remote_stop.started` được `await` ghi trước SSH, tức là trước `releaseLease`. `remoteStopPending` tra DB: có `started` ≤ 120 giây mà chưa có `crew.remote_stop` mới hơn cho cùng `entityId`. `crew.remote_stop` giờ luôn được ghi (kể cả `matched=0` và quá giờ), nên dấu luôn được đóng khi process còn sống. Sau restart, claim bị giữ tối đa 120 giây; cửa sổ này phủ giới hạn 20 giây cộng grace 60 giây của reaper trên Mac. Ghi `started` lỗi thì chỉ còn cache trong bộ nhớ, giống bản trước. Chấp nhận được. |
| A3 | **Đóng ở mức thực tế.** Khi cho claim trên environment có gate, `releaseHeld` luôn đi xuống DB, `UPDATE … WHERE heldBy = 'crew_load_gate'`, không dựa bản `run` trong bộ nhớ. Có test hai lần đánh giá song song. |

### Câu hỏi của lead

1. **Cổng tự gọi stale gate có hủy nhầm run không stale không?** Không. Quyết định là của chính `decideCurrentRunStaleness` stock, đánh giá dưới khóa issue/run, cùng hàm mà `claimQueuedRun` gọi vài mili giây sau. Run không stale thì kết quả `not_stale` và không ghi gì (trừ cập nhật `runnerProfileJson` cho interaction wake, giống stock). Khác biệt duy nhất là **thứ tự**: stock chạy stale gate sau các kiểm agent mất, `invokability`, budget, daily cap, `settlingOwner`; cổng giờ chạy nó trước các kiểm đó. Ví dụ agent đang paused: stock giữ run `queued`, cổng thì hủy luôn vì stale. Vì issue vẫn stale, stock cũng sẽ hủy nó khi agent mở lại, nên chỉ khác thời điểm và `errorCode`, không sai kết quả. Ghi chú, không phải finding.
2. **Có double-cancel với lần gọi trong `claimQueuedRun` không?** Không.
   - Cổng hủy được thì hook trả `true` và `claimQueuedRun` thoát ở dòng hook.
   - Cổng thấy `not_stale` thì stock gọi lại. Nếu lúc đó stale thì stock hủy một lần (lúc này đã không còn dấu, xem khe hở 1).
   - Hai lần hủy song song bị chặn bởi `cancelLockedRun` (`run.status !== expectedStatus` → `lost_race`) cùng `WHERE status = expectedStatus`.
3. **Các khe hở worker nêu có đúng là nhỏ không?**
   - **Khe A1** (issue đổi trạng thái giữa stale gate của cổng và của `claimQueuedRun`): **nhỏ, đồng ý chấp nhận.** Khe chỉ gồm một UPDATE xóa dấu và vài truy vấn trong cùng tick, và phải có một lệnh ghi issue đồng thời. Hậu quả là hold giống CRE-21, có đường gỡ (`recovery-actions/resolve`). Cổng 4 khó đo được khe này. Nên ghi vào ledger như rủi ro đã biết, không trông vào Cổng 4.
   - **Khe A3** (lần A ghi dấu đúng lúc giữa UPDATE xóa dấu của lần B và lúc stock chuyển run sang `running`): **xác suất nhỏ nhưng hậu quả nặng hơn A1.** Run chạy thật mang dấu "chưa bắt đầu", nên sau `process_lost` stock bỏ qua đối soát. Khe chỉ mở khi hai lần đánh giá đồng thời **quyết khác nhau**. Probe cache 15 giây dùng chung, nên điều này chỉ xảy ra khi `remoteStopPending` hoặc hạn chót đổi giữa hai lần. Đồng ý chấp nhận. Cổng 4 không đo được khe này. Cách rẻ nhất để đóng hẳn: `markHeld` thêm điều kiện "không có activity `crew.load_gate.released` của run", với `releaseHeld` ghi activity đó trước UPDATE. Tuỳ lead.
   - **Khe A2** (thêm 2 activity mỗi lần nhả lease SSH): không đáng kể.

### Finding còn lại

- **c1 (major, hiệu năng) — `load-gate.ts` `defaultBeforeClaimDeps.remoteStopPending`: truy vấn DB không có chỉ mục phù hợp, chạy ở đường nóng.**
  - Lọc `action = 'crew.remote_stop.started'`, `createdAt >= now − 120 s`, `details->>'environmentId'`. `activity_log` chỉ có chỉ mục `(company_id, created_at)`, `(company_id, agent_id, created_at)`, `run_id`, `(entity_type, entity_id)`…, không có chỉ mục nào bắt đầu bằng `action` hay `created_at`. Truy vấn thiếu `companyId`, nên Postgres phải quét cả bảng.
  - Truy vấn chạy cho **mỗi** run queued trên environment có gate, **mỗi tick**, **dưới khóa start của agent** (khóa stale ở 30 giây). `activity_log` là bảng tăng nhanh nhất (mọi activity của mọi company).
  - Sửa (một dòng): thêm `eq(activityLog.companyId, run.companyId)`; truyền `run` hoặc `companyId` vào `remoteStopPending`. Khi đó chỉ mục `activity_log_company_created_idx` phủ được khoảng 120 giây. `NOT EXISTS` con đã dùng được chỉ mục `entity_type_id` nếu thêm `eq(result.entityType, "heartbeat_run")`.
- **c2 (minor) — `load-gate.ts` `cancelIfStale` chép lại một phần `applyRunDispatchPostCommitEffects`.**
  - Bản stock (`heartbeat.ts` ~9490) ngoài `heartbeat.run.status` còn gọi `publishRunLifecyclePluginEventData(effect)` (sự kiện vòng đời run cho plugin), `clearHeartbeatRunRuntimeStatus(runId)` và `emitAgentTaskRunById` (telemetry), và xử lý cả effect `run_queued`. Cổng chỉ phát `heartbeat.run.status`, nên plugin và telemetry không thấy run bị hủy.
  - Hiện chưa thấy consumer Crew nào phụ thuộc (đã grep `crew/`), nhưng đây là lệch hợp đồng stock và sẽ trôi khi stock đổi.
  - Sửa: export `applyRunDispatchPostCommitEffects` từ `heartbeatService` qua một hàm sẵn có. Nếu không muốn đụng lõi, ít nhất gọi thêm `emitAgentTaskRunById` và ghi rõ trong comment rằng sự kiện plugin bị bỏ.
- **c3 (minor) — `remote-stop.ts` `startRemoteStopOnRelease`: ghi `started` lỗi thì chỉ log.** Lúc đó server restart trong lúc dừng lại rơi về ca A2 cũ. Đây là lỗi DB đúng lúc nhả lease, rất hiếm. Chấp nhận; chỉ ghi vào ledger.

### Việc tiếp

1. c1 trước merge (thêm `companyId`, `entityType`).
2. c2 tuỳ lead. Nếu giữ, ghi ruling "cổng không phát sự kiện plugin cho run nó cho stock hủy".
3. Ledger: ghi khe A1 và A3 là rủi ro đã biết, không đo được ở Cổng 4.

## Review L1 lần 2 (`1757eb729`)

- Ngày 07/10/2026. Diff `5bbec62ad..1757eb729` (4 file, +352/−1): `server/src/crew/{remote-stop,handoff-rewake}.ts`, test embedded PG `crew-handoff-rewake.test.ts`, `crew/ops/inspect-image.sh`.
- Đã đọc ledger dòng 254–258 (Cổng 4 lần 2: wake reviewer 16:20:35.465 bị bỏ, lease nhả 16:20:36.425, tức wake sớm hơn lúc nhả khoảng 1 giây). Lead đã chấp nhận dùng reason gốc.
- Không chạy lại test. Đọc stock theo symbol: `environmentService.releaseLease`, `releaseRunLease` của SSH driver, `getExecutionBlocker` → `getConversationOwnershipBlocker`.

### Verdict

**APPROVE.** 0 critical, 0 major, 4 minor (d1–d4), không chặn merge.

### Kiểm từng điểm

1. **Tự nhả lease trong hook rồi driver nhả lần hai: vô hại.**
   - `releaseRunLease` = `await crewCoreHooks.onRunLeaseReleased({ db, ...input })` rồi `environmentsSvc.releaseLease(input.lease.id, input.status)`. H3 gọi đúng `releaseLease(input.lease.id, input.status)`, cùng id, cùng status, không có options.
   - `releaseLease` là một `UPDATE … WHERE id` không điều kiện trạng thái, ghi `status`, `releasedAt` (null nếu `retained`), `lastUsedAt` và `metadata - 'remoteExecutionTermination'`. Lần hai ghi lại đúng các giá trị đó, chỉ đẩy `releasedAt`/`updatedAt` muộn thêm vài mili giây.
   - Status không sai: cùng `input.status`. `pending_cleanup`/`retained` vẫn giữ nguyên ý nghĩa, và với hai status này `getConversationOwnershipBlocker` vẫn coi lease là đang giữ, nên Crew không phát lại wake. Đúng.
   - Cleanup sau đó không bị phá: các bước cleanup/sweep của stock chạy sau `releaseRunLease` như cũ. Lease của run đã hủy không bị chiếm lại giữa hai lần ghi (mỗi run một dòng lease).
   - Activity: `releaseLease` không ghi activity nào, nên không bị đôi. Activity Crew (`crew.remote_stop.started`, `crew.remote_stop`, `crew.handoff_rewake`) mỗi thứ một lần cho mỗi lần H3.
   - Nhả sớm lỗi thì chỉ log, driver nhả sau, và không phát lại wake. Đúng: nếu chưa nhả thì phát lại vô ích.
2. **Phát lại wake: không tạo run song song, không đánh thức sai người hay sai stage.**
   - Phát lại đi qua `heartbeatService.wakeup` stock, nên qua đủ admission: khóa thực thi issue, ownership blocker, coalesce. Crew không tự tạo run.
   - Trước khi phát lại, Crew kiểm:
     - assignee **hiện tại** khác agent của run vừa nhả;
     - issue không `done`/`cancelled`/`blocked`;
     - wake bị bỏ là của chính assignee đó, cho đúng issue, kể từ `run.createdAt`;
     - assignee chưa có run `queued`/`running`/`scheduled_retry` trên issue;
     - `getExecutionBlocker` đã trống, nên recovery hold thật (kiểu L4) vẫn chặn.
   - Stage: lấy `executionStage` từ payload của wake bị bỏ (cùng assignee, cách vài giây). Reason khôi phục từ `wakeRole`. Test kiểm `wakeReason = execution_review_requested`, có `executionStage.wakeRole = reviewer`, và chỉ tạo đúng một run.
3. **Idempotent: đạt** cho đường thật (mỗi lần nhả lease qua H3 chạy một lần). Dấu `crew.handoff_rewake` theo id của wake bị bỏ. Test nhả lần hai không tạo thêm run. Xem d1 về thứ tự ghi dấu.
4. **Hợp đồng A2 vẫn đúng khi lease nhả sớm.** Thứ tự trong `startRemoteStopOnRelease` là `recordStarted` (await) → `releaseLease` → phát lại wake (nền) → lệnh dừng (nền). Dấu đang dừng có trong DB **trước** khi lease nhả và trước khi wake phát lại tạo run. Run mới của reviewer trên cùng environment Mac bị `remoteStopPending` giữ cho tới khi có `crew.remote_stop` (≤ 20 giây, hoặc ≤ 120 giây nếu restart), rồi được claim ở tick sau (≤ 30 giây). Nhả lease sớm không mở cửa cho run mới chạy cạnh process cũ.
5. **Khe vài ms: đúng là nhỏ.**
   - Wake chỉ bị mất nếu admission của nó đọc lease **trước** khi lệnh nhả commit, mà dòng `skipped` lại commit **sau** truy vấn wake của Crew (cách lúc nhả vài truy vấn). Tức là admission phải chồng lên đúng thời điểm commit của lệnh nhả, cỡ mili giây.
   - Wake đến sau lúc nhả thì không bị bỏ. Wake đến trước, như ca thật 0,96 giây, thì được phát lại.
   - Chấp nhận, ghi trong ruling là đủ. Cổng 4 chỉ đo được ca chính, không đo được khe.

### Minor

- **d1 — `handoff-rewake.ts` `rewakeAfterLeaseRelease`: ghi dấu `crew.handoff_rewake` trước khi gọi `wakeup`.** Nếu `wakeup` ném lỗi (DB, admission lỗi tạm), dấu đã có nên wake mất vĩnh viễn và chỉ còn log `warn`. Sửa: gọi `wakeup` trước, ghi dấu sau; trùng lặp đã được chặn bởi bước kiểm `active` và coalesce của stock. Hoặc ghi dấu kèm `details.outcome` và cho thử lại khi `outcome = failed`.
- **d2 — Không xác nhận wake bị bỏ là do **chính lease này**.** Đang lọc theo `reason = execution_reconciliation_required` + issue + assignee + thời gian, rồi xóa `payload.executionWait`. Trong khi `executionWait`, do stock ghi lúc bỏ wake, có chứa run hoặc lease giữ issue. Nên chỉ phát lại khi `executionWait` trỏ tới `runId` vừa nhả. Hiện `getExecutionBlocker` trống đã đủ an toàn, nên đây chỉ là siết cho đúng ý.
- **d3 — Không phát lại wake của cùng agent với run vừa nhả** (`assignee === run.agentId`). Ví dụ owner comment cho executor đúng lúc run cũ của executor vừa bị hủy và còn giữ lease: wake đó bị bỏ và không ai phát lại. Ngoài luồng chuyển stage, nhưng là cùng loại mất wake. Ghi vào ledger. Có thể mở rộng sau khi thêm d2 (khi đã chắc wake bị bỏ do chính lease này).
- **d4 — Reason của wake không thuộc stage** (comment, on-demand) bị suy thành `crew_handoff_rewake`, vì stock đã ghi đè `reason`. Stock xử lý wake comment riêng (comment id trong payload), nên reason lạ có thể làm mất ngữ cảnh. Payload gốc được giữ nên rủi ro thấp. Nếu stock có lưu reason gốc ở chỗ khác (ví dụ `executionWait.originalReason`) thì đọc từ đó.

### Việc tiếp

1. d1 nên sửa cùng đợt (đổi thứ tự, rất nhỏ). d2 tuỳ lead. d3, d4 ghi ledger.
2. Cổng 4 lần 3: đo lại chuyển stage executor → reviewer → integrator trên Mac mini. Kỳ vọng `crew.handoff_rewake` một lần cho mỗi lần chuyển, run reviewer có `crewHandoffRewake`, không có run song song, và độ trễ chuyển stage ≤ khoảng 50 giây (gồm thời gian giữ claim của A2 cộng một tick).
