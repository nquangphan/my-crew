# FX-10: hai lỗi gate phát hiện khi nghiệm thu R2-1 (gói `policy`)

09/10/2026, 18:19–18:24 (ICT). Fork worktree `.worktrees/paperclip-r21-policy`, nhánh `crew/r21-policy`.
`git merge --ff-only crew/r2-1` báo "Already up to date" (nền `2bbda3cb2`). Commit mới: **`e3a90a5c5`**. Chưa push,
chưa merge vào `crew/r2-1`, chưa deploy.

## Tóm tắt

- **P2: đã sửa.** Regex bằng chứng `crew-docs-check` nhận được trường hợp khối code dính liền ngay sau `exit=N`. Bằng
  chứng giả vẫn bị từ chối. Instructions integrator dặn xuống dòng ngay sau `exit=N` và đọc lại comment trước khi gửi
  `PATCH done`.
- **P1: không sửa được trong `server/src/crew/**`.** Việc hủy run xảy ra trong lõi (`server/src/routes/issues.ts`),
  **trước** khi H2 chạy. Muốn sửa phải đổi lõi hoặc thêm hook, nên em DỪNG. Phương án để owner duyệt ở cuối báo cáo.

## P2: regex bằng chứng docs

**Bằng chứng.** Em đọc DB prod (chỉ `SELECT`, `issue_comments` của TPS-76). Comment `7dc73bab` của integrator lúc
18:04:59 có body đúng như sau:

```
crew-docs-check commit=f0555c61a0336db2b076728981c57274726e52da range=546c7465b7699ab2e947dba92667cb016575647b..f0555c61a0336db2b076728981c57274726e52da exit=0```crew-docs check --range: ok (1 commits)```
```

Chuỗi trên không có ký tự xuống dòng. Regex cũ ở `server/src/crew/issue-policy.ts:245` kết thúc bằng `exit=([0-3])$`, nên
không khớp và gate trả `docs_missing`. Hai run chạy lại không đăng bằng chứng mới. Comment tiếp theo của integrator là
lúc 18:12:28, sau khi board hướng dẫn, và đã đúng dạng (`exit=0\n\n```…`).

**Sửa (`issue-policy.ts:248-249`).** Đuôi regex đổi thành `exit=([0-3])(?=$|\s|`)`: sau `exit=N` chỉ được là hết dòng,
khoảng trắng hoặc dấu backtick. Các phần sau giữ nguyên:

- dòng phải **bắt đầu** bằng `crew-docs-check` và phải là dòng đầu của comment;
- `commit` phải bằng đầu range;
- chỉ nhận hex chữ thường;
- mã thoát khác 0 vẫn được đọc đúng giá trị (1, 2), nên gate vẫn chặn như cũ.

Các dạng `exit=01`, `exit=10`, `exit=4`, `exit=0x`, `exit=0.`, `exit=` đều bị từ chối. Câu chữ thường cũng bị từ chối,
ví dụ "Đã chạy crew-docs-check … exit=0", "docs exit 0", hoặc `exit=0` nằm trước khối code.

**TDD.** Em thêm 2 test vào `server/src/__tests__/crew-issue-gate.test.ts`, dùng body thật của TPS-76 làm fixture. Cả
hai đỏ trên regex cũ (2 failed), xanh sau khi sửa.

**Instructions.** Em sửa `crew/agents/integrator.md`, mục "Ghi bằng chứng rồi quyết định", bước 1:

- xuống dòng ngay sau `exit=<DOCS_EXIT>` (`\n\n` trong JSON `body`);
- `GET /api/issues/<id>/comments` để đọc lại comment vừa đăng; dòng đầu sai thì đăng lại trước khi `PATCH done`.

Stage 4 bước 4 dẫn chiếu về quy tắc này. Trong `crew/agents/instructions.test.mjs`, regex đồng bộ với server được cập
nhật (test "regex … trùng chuỗi regex của server" đỏ trước khi sửa) và có thêm 1 test cho câu hướng dẫn mới (đỏ trước,
xanh sau).

Instructions mới chỉ áp vào agent khi deploy hoặc chạy `apply-roles`. Em không làm bước đó.

**Kiểm.**

| Kiểm | Kết quả |
|---|---|
| `crew-issue-gate.test.ts` | 51/51 |
| `crew-issue-gate.db.test.ts` (Postgres nhúng, `ipcs -m` 1–2 segment) | 31/31 |
| `crew-core-hooks`, `crew-issue-create-policy`, `crew-project-roles` | 62/62 |
| `node --test crew/agents/*.test.mjs` | 77/77 |
| `tsc --noEmit` server | rc 0 |
| `check-core-hooks.mjs` | 5/5, lỗi 0 |

**Còn lệch (ngoài gói `policy`).** Plugin `packages/crew-plugin/src/shared/markers.ts:22` (`DOCS_CHECK`) vẫn dùng regex
neo `$`, được gọi ở `docs/data.ts:42`. Vì vậy UI plugin sẽ hiện bằng chứng dính khối code là `invalid`, trong khi gate
đã nhận. Đề xuất một ticket nhỏ ở gói `plugin`: dùng cùng đuôi `(?=$|\s|`)`, kèm test.

## P1: run của agent bị hủy dù H2 trả 422

**Nguyên nhân, có bằng chứng.** Lõi hủy run của assignee trong route, trước khi gọi service. H2 nằm trong service, nên
chạy sau. Khi H2 ném 422, transaction rollback nhưng run đã bị hủy và không được khôi phục.

Đọc mã lõi (chỉ đọc, `server/src/routes/issues.ts`, handler `PATCH /issues/:id`):

1. `:13130` `applyIssueExecutionPolicyTransition(...)`, rồi `:13168` `Object.assign(updateFields, transition.patch)`.
   Integrator `done` ở stage docs, nên transition chuyển sang stage approval của owner. Kết quả là
   `assigneeAgentId = null`, `assigneeUserId = owner`.
2. `:13339` `assigneeWillChange` thành `true`, vì so với assignee hiện tại là integrator.
3. `:13383-13412`: `if (assigneeWillChange && existing.assigneeAgentId)` dẫn tới `resolveActiveIssueRun(existing)`, rồi
   `heartbeat.cancelRun(run, "Cancelled before issue reassignment", { errorCode: "issue_reassigned", resultJson: {
   reassignmentStopConfirmed, issueMutationStopId } })`. Run bị hủy là **run của chính actor**. `:13491` chỉ cấp
   `actorRunStopId` để run đó vẫn ghi được trong request này.
4. `:13646-13705`: `db.transaction`, rồi `updateIssue(tx)`, rồi `svc.update`. H2 nằm ở `server/src/services/issues.ts:10898`
   (`crewCoreHooks.beforeIssueWrite`, dòng đầu của `runUpdate`). H2 ném `unprocessable` và transaction rollback.
5. `:13707` `catch`: chỉ ghi log `"issue update rejected with 422"` rồi ném tiếp. Không có bước nào khôi phục
   `interruptedRunId`.

Đo trên prod (log server và DB, chỉ đọc). Cả ba lần, run bị hủy khoảng 100 ms **trước** khi 422 được ghi:

| Run | Hủy (`finished_at`) | Log 422 `docs_missing` |
|---|---|---|
| `981b59f2` | 18:05:10.802 (event `run cancelled before issue reassignment` 18:05:10.819) | 18:05:10.910 |
| `1d39d37f` | 18:07:30.196 | 18:07:30.295 |
| `5239774d` | 18:10:12.154 | 18:10:12.256 |

Cả ba run đều có `issueMutationStopId` trong `result_json`, đúng nhánh `:13394`. Sau lần hủy đầu tiên:

- 18:05:11 `GET /mcp/runtime-tools` trả 403 (run đã hủy);
- 18:05:19 heartbeat ghi `Scheduled bounded retry 1/2`, vì issue vẫn giao integrator;
- sau 2 lần thử lại, recovery chuyển issue sang `blocked` lúc 18:10:19.

**Vì sao không sửa được trong `server/src/crew/**`:**

- Không có hook Crew nào chạy trước `:13383` trong route này. H2 chạy trong service, sau bước hủy. H5 chỉ nằm ở router
  agents.
- H3 (`onRunLeaseReleased`) chạy *trong* `cancelRun`, nhưng lúc đó trạng thái `cancelled` đã ghi xong. Wrapper của H3
  còn nuốt lỗi, nên H3 không chặn được việc hủy.
- Trong H2 cũng không bù được: H2 chỉ có `tx` của transaction sắp rollback, mọi thứ ghi qua đó đều mất.

Vì vậy mọi cách sửa đều cần đổi lõi hoặc thêm hook thứ 6. Em DỪNG và không sửa lõi.

Ghi chú: đây là hành vi của Paperclip stock, không riêng Crew. Bất kỳ 422 nào từ `svc.update`, sau một transition làm
đổi assignee, cũng hủy oan run của chính actor. `integrator.md`, mục "Lỗi server", đã ghi nhận hành vi này ("run của
bạn đã bị hủy… lần chạy kế … dựng lại bằng chứng").

## Phương án P1 cần owner duyệt

| # | Phương án | Đổi lõi | Ưu | Nhược |
|---|---|---|---|---|
| A (đề xuất) | Hook **H6** `beforeIssueReassignmentStop` một dòng, đặt trong `routes/issues.ts` ngay trước khối `:13383` (`if (assigneeWillChange && existing.assigneeAgentId)`). Hook gọi `evaluateIssueGate` ở chế độ chỉ đọc, với cùng `updateFields`, actor và `existing`, không khóa dòng. Bị chặn thì ném 422 trước khi hủy run. H2 vẫn kiểm lại dưới khóa trong transaction, nên không có kẽ hở do race. | +1 hook (5 thành 6), sửa `core-hooks.json`, `check-core-hooks.mjs` | Đúng chỗ, nhỏ. Agent nhận 422 khi run còn sống, tự sửa được ngay. Không tốn run, không bị `blocked`. | Thêm một điểm phải giữ khi nâng bản upstream. Logic gate chạy hai lần (rẻ, vài query). |
| B | Patch lõi (driver-patch kiểu P1–P4): khi run bị hủy là run của chính actor (`runToStopForReassignment.id === actor.runId`), hoãn `cancelRun` tới sau khi transaction commit. Dùng sẵn cơ chế `postCommitIssueActions` hoặc `issueMutationStopId`. | Sửa logic lõi nhiều dòng | Sửa tận gốc cho mọi lỗi 422 của stock, không riêng Crew. Có thể gửi PR upstream. | Đụng thứ tự hủy run so với đổi assignee mà stock cố ý đặt (`runner_goal_reassignment_stop_unconfirmed`), nên rủi ro race với run đang ghi. Cần test lõi rộng. |
| C | Không sửa lõi, chỉ giảm thiệt hại: giữ fix P2 và instructions "đọc lại bằng chứng trước `done`". Có thể thêm route plugin "gate preflight" cho agent tự kiểm trước khi `done`. | Không | Không đụng lõi. | Không chữa gốc: lỗi gate nào khác (`docs_stale`, `push_missing`…) vẫn hủy run, tốn run và có thể dẫn tới `blocked`. Route plugin hiện chỉ `auth: board`, agent không gọi được nếu không mở thêm. |

Em đề xuất làm **C ngay** (đã có trong commit này), rồi **A** khi owner cho thêm hook H6. Lý do: A nhỏ, nằm gọn trong
code Crew, giữ H2 là chốt chặn cuối. B chỉ nên làm khi muốn gửi PR upstream.

## File

- Sửa: `server/src/crew/issue-policy.ts`, `server/src/__tests__/crew-issue-gate.test.ts`, `crew/agents/integrator.md`,
  `crew/agents/instructions.test.mjs` (commit `e3a90a5c5`).
- Chỉ đọc: `server/src/routes/issues.ts`, `server/src/services/issues.ts`, `server/src/services/issue-execution-policy.ts`,
  `packages/crew-plugin/src/{shared/markers.ts,docs/data.ts}`; DB và log server prod.
