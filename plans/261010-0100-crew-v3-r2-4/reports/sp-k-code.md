# SP-K — Đọc mã, không tốn run

- Người làm: agent Claude (opus). Ngày 2026-10-10, 12:43–12:53 (Asia/Ho_Chi_Minh).
- Nguồn đọc: fork nhánh `crew/r24` (= `f4a8b30a6`) đọc bằng `git show crew/r24:<file>` từ worktree
  `.worktrees/paperclip-v3`, không checkout, không sửa. OpenCode 1.18.35 bản Homebrew (binary Bun, đọc bằng
  `strings`). Log cũ `~/.local/share/opencode/log` (chỉ dòng ERROR, đã lọc chuỗi giống key).
- Không chạy test DB, không `opencode run`, không Codex. Lệnh duy nhất có gọi mạng: `opencode models opencode-go --verbose`
  (không tốn quota model).
- Kết quả từng điểm đã ghi vào `sdd-ledger.md` ngay khi đo xong.

## Bảng kết quả

| Mục | Kết quả | Bằng chứng (file:dòng trên `crew/r24`) | Giá trị đề xuất |
|---|---|---|---|
| P1 / A11 | Payload `agent.run.failed` **không có** `errorFamily`, `adapterType` | `server/src/services/heartbeat.ts:13052–13116` (payload: `runId, agentId, status, invocationSource, triggerDetail, error, errorCode, issueId, startedAt, finishedAt`; `companyId` ở envelope) | PL-3 đọc `SELECT result_json->>'errorFamily' FROM public.heartbeat_runs WHERE id=$1 AND company_id=$2` (manifest đã có `heartbeat_runs` ở `coreReadTables`, `packages/crew-plugin/src/manifest.ts:118`). `resultJson.errorFamily` được ghi cùng patch kết thúc trước khi phát event (`heartbeat.ts:25352–25395`). Thiếu thì suy như stock `heartbeat.ts:1090–1108`: `errorCode==="provider_quota"` → quota. `adapterType` lấy qua `ctx.agents.get` |
| P2 / A12 | Service **không** hủy run khi đổi assignee | `issues.ts` `update` (:10578…, ~:10886–10896) chỉ xóa `checkoutRunId/executionRunId/executionLockedAt`. Route PATCH mới hủy run đang chạy (`routes/issues.ts:13381–13400`). Run `queued`/`scheduled_retry` cũ bị chặn lúc claim (`run-dispatch/domain/policy.ts:184–191, 350–360, 575–590`), trừ khi agent cũ là `currentParticipant` của issue `in_review` | Giữ `cancelSuperseded` ở H1 |
| P3 / A13 | **Được, theo cách dưới đây**; không được bằng cách sửa `executionPolicy` | Xem mục P3 | H4 đặt 2 participant; plugin đổi `executionState.currentParticipant` + assignee; H2 thêm guard |
| A6 | Đạt (đọc mã) | `OPENCODE_CONFIG_CONTENT` nạp sau file config, gộp mức `local`; parser gọi `ConfigVariable.substitute` thay `/\{env:([^}]+)\}/g` → `process.env[VAR] \|\| ""` trên text thô. Provider `opencode-go`: `env:["OPENCODE_API_KEY"]`, `@ai-sdk/openai-compatible`, `https://opencode.ai/zen/go/v1` | Giữ nguyên hằng A6. Dự phòng: export `OPENCODE_API_KEY`. Biến thiếu → key rỗng → lỗi auth từ server (không lỗi parse) |
| A8 | Có câu thật | Log 04/10: `error.error="AI_APICallError: Go usage limit exceeded"` (kimi-k3). Mã nguồn: `GoUsageLimitError` → `"<limit> usage limit reached. It will reset in …"`; `FreeUsageLimitError` → `"Free usage exceeded, subscribe to Go"`; `insufficient_quota` → `"Quota exceeded. Check your plan and billing details."` | Regex cũ đã khớp. Thêm `GoUsageLimitError\|FreeUsageLimitError\|limit reached` |
| A9 | Một phần | `ProviderAuthError`, `LoadAPIKeyError`; AI SDK: `"<Provider> API key is missing. Pass it using the 'apiKey' parameter or the OPENCODE_API_KEY environment variable."` | Regex cũ **không** khớp "API key is missing". Thêm `api key is missing\|ProviderAuthError\|LoadAPIKeyError`. Câu 401 thật của Go: chờ SP-O |
| A10 | Đo được, không cần key | `opencode models opencode-go --verbose` rc=0, 31 model | deepseek-v4-flash: image false, toolcall true. glm-5.3: image false, toolcall true. **kimi-k3: image true** (+video), toolcall true. Giả định "cả ba false" vẫn an toàn. Owner chọn có bật vision cho kimi-k3 không |
| A14 | Thêm job không làm `upgrade_pending` | Chỉ capability mới mới gây ra: `plugin-lifecycle.ts:671–690`, `plugin-loader.ts:1809–1825`. Hai chỗ `bundled-plugins.ts:276–290`, `distribution-plugin-catalog.ts:80–86` chỉ áp cho plugin distribution. Plugin local path: activate thì đọc lại manifest (`refreshPluginManifestFromPackage`), rồi `syncJobDeclarations` (`plugin-loader.ts:2415–2422`) | Giữ A14. Manifest đã đủ capability cho PL-3. PL-3 **không** được thêm capability |

## P3 — đổi reviewer Codex sang Claude giữa vòng review

Owner đã chốt: reviewer Codex lỗi hoặc công tắc Codex tắt thì tự chuyển sang reviewer Claude. P3 trả lời câu hỏi chuyển
thế nào cho an toàn.

### Vì sao không sửa `executionPolicy`

- H2 khóa policy. `policyGateFingerprint` (`server/src/crew/issue-policy.ts:212–228`) có danh sách participant. Actor
  không phải board mà đổi participant thì bị chặn `crew_policy_locked` (`issue-gate.ts:191–199`). Lệnh plugin không kèm
  actor được coi là `system` (`issue-gate.ts:345–349`).
- Có thể lách bằng cách truyền `actorUserId` của owner. Host `issues.update` không kiểm user đó
  (`plugin-host-services.ts:1951–1986`). Làm vậy là mạo danh owner, nhật ký ghi sai người, và có thể sinh
  `board_override`. **Cấm.**
- `ctx.issues.update` đi thẳng vào `issueService.update`. Hàm này không chạy `applyIssueExecutionPolicyTransition`
  (hàm đó chỉ có ở route, `routes/issues.ts:13130`). Sửa policy qua đường này để `executionState` lệch với policy.

### Cách làm đề xuất

1. **H4 (SV-3).** Issue con được chọn reviewer Codex thì stage review có participants
   `[codexReviewer, claudeReviewer]`, Codex đứng đầu.
   - Khi vào stage, stock chọn participant đầu hoặc người executor gán (`issue-execution-policy.ts:484–499`, `:988–995`).
   - Sau `changes_requested`, stock giữ `currentParticipant` cũ.
   - Policy cố định từ lúc tạo, fingerprint không đổi về sau.
   - Không có Claude reviewer thì participants chỉ có Codex. Khi Codex lỗi thì `fallback_refused`.
2. **Fallback (PL-3, plugin gọi)** khi `agent.run.failed` của reviewer Codex, hoặc job `runtime-fallback` thấy run đang
   chờ vì `switch_off`:
   - Điều kiện, kiểm trước khi ghi:
     - issue `in_review`;
     - `executionState.status==="pending"`, `currentStageType==="review"`;
     - `currentParticipant.agentId` và assignee đều là codexReviewer của project;
     - claudeReviewer có trong participants của stage đó.
   - Ghi `ctx.issues.update(issueId, { executionState: { ...state, currentParticipant: { type: "agent", agentId: claudeReviewer, userId: null } }, assigneeAgentId: claudeReviewer } as never, companyId)`.
     Không kèm actor. SDK không khai `executionState` trong type, nên phải ép kiểu. Host chuyển nguyên patch xuống.
   - Mọi trường khác của state giữ nguyên: `currentStageId/Index/Type`, `returnAssignee`, `completedStageIds`,
     `changesRequestedCount`, `lastDecision*`, `reviewRequest`. Kết quả giống đúng `buildPendingState`
     (`issue-execution-policy.ts:573–596`) mà board-override của stock tạo khi đổi người review
     (`issue-execution-policy.ts:925–934`). Vì vậy không mở lại vòng, không reset stage, số vòng giữ nguyên.
   - Sau đó comment rồi `ctx.issues.requestWakeup`. Issue `in_review` vẫn wake được
     (`plugin-host-services.ts:2164–2173`).
   - Phải đổi **cả** state lẫn assignee. Chỉ đổi assignee thì lần PATCH route kế tiếp, nhánh "drift repair" của stock
     đưa Codex trở lại (`issue-execution-policy.ts:907–961`).
3. **H2 (SV-3) thêm guard**, chạy dưới khóa dòng `FOR UPDATE` sẵn có.
   - Lệnh ghi không phải board mà có `executionState` thì chỉ cho qua khi đúng các điều kiện ở bước 2.
   - State mới chỉ được khác ở `currentParticipant`: từ codexReviewer sang claudeReviewer của cùng project.
   - Assignee mới phải là claudeReviewer.
   - Mọi trường hợp khác thì chặn. Guard này chặn race giữa lúc plugin đọc và lúc ghi (service không so-và-ghi
     `executionState`), và chặn agent tự sửa state.

### Hệ quả đã kiểm

- **Không có `board_override`.** H2 chỉ override khi lệnh ghi vào `done`. Policy không bị sửa nên không có
  `crew_policy_locked`.
- **Run Codex còn `queued` bị hủy.** Dispatch hủy nó với `issue_assignee_changed`, vì `currentParticipant` không còn là
  Codex (`run-dispatch/adapters/postgres.ts:136–145`, `policy.ts:567–590`). H1 `cancelSuperseded` dọn thêm.
- **Claude reviewer duyệt bình thường.** Stock so `currentParticipant` với actor và kiểm actor có trong participants của
  stage. Cả hai đều đúng.
- **Service kiểm assignee mới.** Nếu Claude reviewer không nhận việc được thì `assertAssignableAgent` ném lỗi. Plugin bắt
  lỗi đó và chuyển sang `fallback_refused`.

### Rủi ro còn lại

- Executor tự gán reviewer Claude khi nộp `in_review` thì stock chọn Claude. Review vẫn hợp lệ, chỉ mất lượt "khác mô
  hình".
- Phải ép kiểu SDK. Nếu SDK sau này lọc patch theo whitelist thì đường này hỏng ngay ở test, không hỏng âm thầm.
  PL-3 cần test DB cho ca này.

## Rủi ro mới (A8): OpenCode tự retry khi gặp quota

- `SessionRetry` của OpenCode retry lỗi "retryable" tối đa 5 lần: 429, 5xx, câu có "rate limit". Mỗi lần chờ theo header
  `retry-after`, trần 2^31 ms, tức gần như không có trần.
- Khi chờ, `opencode run --format json` **không in gì**. Lệnh run chỉ xử lý `message.part.updated`, `session.error` và
  `session.status` idle.
- Nếu Go trả 429 kèm `retry-after` bằng thời gian tới lúc reset, run sẽ treo tới timeout adapter thay vì báo quota.
- Log ngày 04/10 cho thấy lỗi kết thúc nhanh (run sau bắt đầu 15 giây sau), nhưng chưa đủ để chắc.
- **Khuyên MR-1:** wrapper chạy với `--print-logs`. Dòng `level=ERROR … "stream error" … Go usage limit exceeded` ra
  stderr ngay lần lỗi đầu. Có thể cho wrapper tự dừng khi gặp dòng này. **SP-O xác nhận.**

## Việc cho ticket khác

- **SV-3:** làm nhánh P3 theo mục trên, gồm participants kép ở H4 và guard ở H2. Test DB: swap hợp lệ, swap sai người,
  agent tự sửa state, và issue chỉ có reviewer Codex.
- **PL-3:**
  - đọc `errorFamily` từ `heartbeat_runs`;
  - cập nhật regex theo A8/A9;
  - làm nhánh swap reviewer theo mục P3;
  - không thêm capability.
- **MR-1:** cân nhắc `--print-logs` và cơ chế dừng sớm khi gặp lỗi quota.
- **I1:** quyết định cờ `vision` của kimi-k3 (đo được là `true`).
- **Spec §3.3:** sửa theo quyết định owner. Nhánh "không đổi được" chỉ còn cho issue không có Claude reviewer trong
  participants, hoặc khi Claude reviewer không nhận việc được.

## Câu hỏi còn mở

- Status HTTP thật của `GoUsageLimitError`: 429 (sẽ bị retry) hay 402/403 (lỗi ngay)? SP-O đo.
- Câu lỗi thật khi gửi key rỗng hoặc sai lên Go. SP-O đo.
- Bật vision cho kimi-k3 không: owner quyết.
