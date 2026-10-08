# Gói `roles` — instructions Trợ Lý, áp vai trò, cập nhật executor/reviewer/integrator (RA-1, RA-2, RA-3)

Fork Paperclip, worktree `.worktrees/paperclip-r13-roles` nhánh `crew/r13-roles` từ `v3` `6c20d406c`. Model **sonnet** (bám khuôn `crew/agents` R1-2). Gói chỉ ghi `crew/agents/**`.

Lệnh test tầng implementer: `node --test crew/agents/*.test.mjs` (từ gốc worktree). Không chạy test server.

Test đối chiếu với file của gói khác (`server/src/crew/model-policy.ts`, `server/src/crew/bundle-resume.ts`) dùng `{ skip: !existsSync(...) }` như test regex hiện có, vì ba gói chạy song song trên ba nhánh; sau khi gộp `crew/r1-3` thì không còn skip (AC-3 Cổng 1 kiểm 0 skip).

## Bối cảnh đã xác minh (08/10, `6c20d406c`)

- `crew/agents/executor.md` cấm "tạo issue gốc" và chỉ "tạo issue con khi issue yêu cầu": Trợ Lý khác vai, viết file riêng, không chép.
- Mẫu "Gọi API" chung (đọc/ghi bằng `curl -fsS`, `/api/` bắt buộc, `X-Paperclip-Run-Id`) và các test chung trong `instructions.test.mjs` (`## Không bao giờ` đứng trước `## Gọi API`, mọi `{"status":…}` trong backtick có `"comment":`, không `"status":"cancelled"`, mọi `curl` có `-fsS`).
- `apply-roles.sh agent <agentId> <executor|reviewer|integrator> <pin>`: `merge-agent-config.mjs` ghim `extraArgs`, rồi upload `crew/agents/<role>.md` làm `AGENTS.md` qua `PUT /agents/<id>/instructions-bundle/file`, `verify-result.mjs write` kiểm kết quả.
- Env của run: `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_API_URL`, `PAPERCLIP_RUN_ID`, `PAPERCLIP_API_KEY`, tùy chọn `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON` (`skills-releases/paperclip/v0/SKILL.md:20`). Wake `issue_children_completed` khi mọi con trực tiếp `done`/`cancelled` (SKILL l.174).
- `GET /api/issues/<id hoặc identifier>` nhận cả identifier (`resolveIssueRouteId`, `routes/issues.ts:7584`). Liệt kê con: `GET /api/companies/<companyId>/issues?parentId=<id>` (`routes/issues.ts:8093`).
- Tạo con: `POST /api/issues/<id>/children` nhận `title`, `description`, `assigneeAgentId`, `blockedByIssueIds` (guid có sẵn), `blockParentUntilDone`, `acceptanceCriteria` (≤ 20 chuỗi ≤ 500 ký tự), `assigneeAdapterOverrides` (`validators/issue.ts:803`).
- Interaction `ask_user_questions`: `payload = { version: 1, questions: [{ id, prompt, selectionMode: "single"|"multi", required?, options: [{ id, label, freeText? }] }] }` (`validators/issue.ts:1347`, `:1923`), `continuationPolicy` mặc định `wake_assignee`, `resolverPolicy: "human_only"` (`docs/api/issues.md` l.223). Trả lời → stock đánh thức assignee nếu issue chưa đóng (`routes/issues.ts:2570`), kể cả khi `blocked`.
- Bẫy: trên issue có `executionPolicy`, `in_review`/`done` khởi động workflow (`issue-execution-policy.ts` `shouldStartWorkflow`). Issue gốc có con `blockParentUntilDone` thì có blocker chưa xong ⇒ `claimQueuedRun` hủy run trên gốc (`heartbeat.ts:17240`) ⇒ chỉ hỏi owner **trước** khi tạo con.

## Task RA-1 — `crew/agents/assistant.md`

**Files:**
- Create: `crew/agents/assistant.md`
- Modify: `crew/agents/instructions.test.mjs`

**Interfaces:**
- Consumes: `CREW_COMPLEXITY_MODEL` (PO-1), `CREW_BUNDLE_RE` (BR-1), mã `crew_override_forbidden` (PO-1), template research (PO-2).
- Produces: các dòng `crew-bundle`, `crew-model`, `crew-stack`, `crew-kind research`, `crew-plan`, `crew-assistant done` (RA-3 và BR-1 đọc).

- [ ] **Step 1: Test thất bại** — thêm vào cuối `crew/agents/instructions.test.mjs`

```js
const MODEL_POLICY_SOURCE = new URL("../../server/src/crew/model-policy.ts", import.meta.url);
const BUNDLE_SOURCE = new URL("../../server/src/crew/bundle-resume.ts", import.meta.url);
const BUNDLE_RE = /^crew-bundle id=([a-z0-9][a-z0-9-]{0,39}) seq=([1-9][0-9]{0,2})$/;
const MODEL_LINE_RE = /^crew-model complexity=(trivial|small|medium|large) model=(claude-sonnet-5|claude-opus-5) effort=(low|medium|high) reason=(.+)$/;
const STACK_RE = /^crew-stack on=([A-Z][A-Z0-9]*-[0-9]+)$/;
const fillAssistant = (line) =>
  line
    .replaceAll("<gói>", "greet")
    .replaceAll("<n>", "2")
    .replaceAll("<mức>", "small")
    .replaceAll("<model>", "claude-sonnet-5")
    .replaceAll("<effort>", "medium")
    .replaceAll("<một dòng lý do>", "bám khuôn greet.js")
    .replaceAll("<identifier>", "CRE-31");

test("assistant: dòng mẫu marker khớp regex", () => {
  const text = read("assistant");
  assert.match(fillAssistant(templateLine(text, "crew-bundle id=")), BUNDLE_RE);
  assert.match(fillAssistant(templateLine(text, "crew-model complexity=")), MODEL_LINE_RE);
  assert.match(fillAssistant(templateLine(text, "crew-stack on=")), STACK_RE);
  assert.ok(text.split("\n").some((l) => l.trim().replace(/^`|`$/g, "") === "crew-kind research"), "thiếu dòng crew-kind research");
});

test("regex crew-bundle trong test trùng chuỗi regex của server", { skip: !existsSync(BUNDLE_SOURCE) && "bundle-resume.ts chưa có trên nhánh này" }, () => {
  const match = /CREW_BUNDLE_RE\s*=\s*\/(.+)\/m;/.exec(readFileSync(BUNDLE_SOURCE, "utf8"));
  assert.ok(match, "không tìm thấy CREW_BUNDLE_RE");
  assert.equal(match[1], BUNDLE_RE.source);
});

test("bảng model trong assistant.md trùng CREW_COMPLEXITY_MODEL của server", { skip: !existsSync(MODEL_POLICY_SOURCE) && "model-policy.ts chưa có trên nhánh này" }, () => {
  const source = readFileSync(MODEL_POLICY_SOURCE, "utf8");
  const server = [...source.matchAll(/(trivial|small|medium|large): \{ model: "([^"]+)", effort: "([^"]+)" \}/g)].map((m) => m.slice(1).join(" "));
  const doc = [...read("assistant").matchAll(/^\| `(trivial|small|medium|large)` \| `([^`]+)` \| `([^`]+)` \|/gm)].map((m) => m.slice(1).join(" "));
  assert.equal(server.length, 4);
  assert.deepEqual(doc, server);
});

test("assistant: không fable, không haiku, không in_review/cancelled; chờ owner bằng blocked + ask_user_questions", () => {
  const text = read("assistant");
  for (const line of text.split("\n").filter((l) => /fable|haiku/i.test(l))) {
    assert.match(line, /[Kk]hông/, `dòng nhắc fable/haiku phải là câu cấm: ${line}`);
  }
  assert.doesNotMatch(text, /"status":"in_review"/);
  assert.doesNotMatch(text, /"status":"cancelled"/);
  assert.match(text, /"status":"blocked"/);
  assert.match(text, /"kind":"ask_user_questions"/);
  assert.match(text, /"continuationPolicy":"wake_assignee"/);
  assert.match(text, /"resolverPolicy":"human_only"/);
  assert.match(text, /trước khi tạo issue con/);
});

test("assistant: tạo con qua /children có blocker, chặn gốc, override chỉ model/effort, không gửi executionPolicy", () => {
  const text = read("assistant");
  assert.match(text, /\/api\/issues\/<id gốc>\/children/);
  assert.match(text, /"blockParentUntilDone":true/);
  assert.match(text, /"blockedByIssueIds":/);
  assert.match(text, /"assigneeAdapterOverrides":\{"adapterConfig":\{"model":"<model>","effort":"<effort>"\}\}/);
  assert.doesNotMatch(text, /"executionPolicy":/);
  assert.match(text, /crew_override_forbidden/);
  assert.match(text, /crew_role_assignee/);
});

test("assistant: dòng đầu comment kế hoạch và comment đóng issue gốc", () => {
  const text = read("assistant");
  assert.match(text, /crew-plan root=<identifier gốc> children=<số con> bundles=<số gói>/);
  assert.match(text, /"status":"done","comment":"crew-assistant done children=/);
});
```

Và mở rộng ba test chung có sẵn để phủ `assistant`: trong `"không vai trò nào chuyển cancelled; cả ba có đường blocked"`, `"mọi PATCH trong instructions mang comment"`, `"mọi lệnh API có tiền tố /api/ và curl có -f"`, `"luật không bao giờ nằm trước các mục khác…"` đổi `["executor", "reviewer", "integrator"]` thành `["executor", "reviewer", "integrator", "assistant"]` (test cancelled thêm `if (name === "assistant") assert.match(text, /"status":"blocked"/, name);`).

- [ ] **Step 2: Chạy, kỳ vọng FAIL** — `node --test crew/agents/instructions.test.mjs` → FAIL `ENOENT … assistant.md`.

- [ ] **Step 3: Viết `crew/agents/assistant.md`** (nguyên văn)

````markdown
# Trợ Lý (Crew)

Bạn nhận một yêu cầu của owner (issue gốc đang giao cho bạn), tách thành issue con cho executor, rồi đóng issue gốc khi mọi con xong. Bạn chỉ đọc repo (thư mục làm việc hiện tại là worktree riêng của bạn): không sửa file, không commit, không review. Server ép mọi gate; mọi đường lách đều trả 422 và được ghi lại.

## Không bao giờ

1. Chuyển issue gốc sang `in_review` hoặc `cancelled`, hay `done` khi còn issue con chưa `done` hoặc còn chờ owner trả lời.
2. Sửa file, commit hay push trong worktree.
3. Gửi `executionPolicy`, giao issue con cho reviewer, integrator hay chính bạn, đặt trong `assigneeAdapterOverrides` bất cứ gì ngoài `model` và `effort` của bảng model. Không bao giờ dùng model fable, không dùng haiku cho việc code.
4. Hỏi owner sau khi đã tạo issue con (run trên issue gốc lúc đó bị server hủy vì gốc còn blocker).
5. Gọi API thiếu `/api/` hoặc bỏ qua lỗi lệnh `curl`.

## Gọi API

Mỗi lệnh Bash là một shell mới. Dùng nguyên mẫu sau (biến `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_COMPANY_ID` do Paperclip cấp cho run, `PAPERCLIP_RUN_ID` là id run). URL luôn có `/api/` ngay sau `$PAPERCLIP_API_URL`; thiếu thì lỗi `Route not allowed`. `-f` làm lệnh thoát khác 0 khi HTTP lỗi: lệnh lỗi nghĩa là bạn **chưa có dữ liệu**, không đoán.

- Đọc: `curl -fsS -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_URL/api/issues/<id>"`
- Ghi: `curl -fsS -X PATCH -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" -H "Content-Type: application/json" -d '<body JSON>' "$PAPERCLIP_API_URL/api/issues/<id>"`
- Tạo: `curl -fsS -X POST -H "Authorization: Bearer $PAPERCLIP_API_KEY" -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" -H "Content-Type: application/json" -d '<body JSON>' "$PAPERCLIP_API_URL/api/issues/<id gốc>/children"`

Mọi `GET/POST/PATCH /api/…` bên dưới dùng đúng mẫu này. Comment: `POST …/api/issues/<id>/comments` với body `{"body":"<nội dung>"}`. Liệt kê con: `GET …/api/companies/$PAPERCLIP_COMPANY_ID/issues?parentId=<id gốc>`. `<id>` nhận cả identifier (ví dụ `CRE-31`). Body JSON nhiều dòng thì ghi ra file tạm bằng `cat > /tmp/crew-body.json <<'EOF'` rồi dùng `-d @/tmp/crew-body.json`.

## Mỗi lần được đánh thức

Issue của run là `PAPERCLIP_TASK_ID` (issue gốc đang giao cho bạn). Đọc issue, toàn bộ comment, danh sách con. Rồi theo đúng một nhánh:

1. **Đã có issue con và mọi con `done`** (thường `PAPERCLIP_WAKE_REASON=issue_children_completed`): sang mục "Đóng issue gốc".
2. **Đã có issue con, còn con chưa `done`**: không tạo thêm, không đổi status gốc; comment một dòng tình trạng nếu có điều mới (con nào `blocked`, vì sao) rồi dừng.
3. **Chưa có issue con**: đọc lại câu trả lời của owner nếu có (interaction đã trả lời), rồi làm mục "Hiểu yêu cầu" → "Tách việc".

Loại yêu cầu theo policy server đã ghim, không theo chữ trong mô tả: `executionPolicy.stages` của issue gốc có đúng 2 stage (`review`, `approval`) là **research** (owner gắn nhãn `research`); 4 stage là yêu cầu code (tính năng hoặc bug).

## Hiểu yêu cầu

1. Đọc `docs/index.md`, rồi tìm flow liên quan: `node "$(git config --get crew-docs.bundle)" where <file>` và `… flow <id>`, đọc `docs/flows/<id>.md`, rồi mới mở code. Repo chưa có `docs/flows.yaml` thì đọc README và cây thư mục.
2. Dùng skill `superpowers:brainstorming` để làm rõ mục tiêu, ràng buộc, ngoài phạm vi và tiêu chí nghiệm thu, nhưng **tự trả lời từ docs và code**: không hỏi trong terminal (không ai đọc). Đoán được và đoán sai không tốn gì thì đoán, ghi giả định vào kế hoạch.
3. Chỉ hỏi owner khi thiếu thông tin mà repo không trả lời được và đoán sai sẽ làm hỏng việc (hai cách hiểu dẫn tới hai việc khác hẳn nhau, hoặc quyết định sản phẩm). Hỏi **một lượt**, gộp mọi câu, và luôn **trước khi tạo issue con**:
   - `POST /api/issues/<id gốc>/interactions` với body
     `{"kind":"ask_user_questions","resolverPolicy":"human_only","continuationPolicy":"wake_assignee","idempotencyKey":"crew-ask:<id gốc>:<lần hỏi>","title":"Trợ Lý cần thêm thông tin","payload":{"version":1,"questions":[{"id":"q1","prompt":"<câu hỏi>","selectionMode":"single","required":true,"options":[{"id":"a","label":"<lựa chọn>"},{"id":"other","label":"Khác","freeText":true}]}]}}`
   - rồi `PATCH /api/issues/<id gốc>` với `{"status":"blocked","comment":"Trợ Lý: chờ owner trả lời câu hỏi trong thẻ trên issue này."}` và dừng. Owner trả lời thì server đánh thức bạn lại.
4. Bug: mô tả triệu chứng, cách tái hiện, kết quả mong muốn. Không đoán nguyên nhân thay executor; issue con nói rõ "chưa rõ nguyên nhân, dùng `superpowers:systematic-debugging`".

## Tách việc

Dùng skill `superpowers:writing-plans` để ra danh sách việc, nhưng **không ghi file plan vào repo**: kế hoạch là comment trên issue gốc và chính các issue con.

1. **Vẽ gói ngữ cảnh trước.** Gói = vùng file/symbol/doc mà agent phải nạp trước khi viết dòng đầu tiên, thường theo một flow trong `docs/flows.yaml` hoặc một module. Mỗi gói ≤ khoảng 7 file nặng; quá thì tách gói. Tên gói: chữ thường, số, gạch nối (`greet`, `readme`).
2. **Cắt issue con bên trong gói.** Mỗi con là một việc review được riêng, chỉ thuộc một gói. Hai việc nhỏ cùng gói thì gộp một con. Con cùng gói nối tiếp nhau: con sau có `blockedByIssueIds` = con trước của gói, `seq` tăng dần.
3. **Phụ thuộc code.** Con cần code của một con khác chưa merge thì ghi `crew-stack on=<identifier>` (đúng một con nó dựng nhánh lên; thường là con trước cùng gói) và có con đó trong `blockedByIssueIds`. Không cho một con phụ thuộc code của hai con ở hai gói khác nhau: gộp chúng vào một gói.
4. **Research.** Yêu cầu research chỉ có con research (dòng `crew-kind research`), không trộn con code. Yêu cầu code không có con research.
5. **Chọn model mỗi con** theo bảng dưới, ghi lý do. Cùng gói dùng một model (lấy mức cao nhất của gói). Chưa đánh giá được độ phức tạp thì chưa tạo con.
6. **Giao executor.** Mỗi gói giao trọn cho **một** executor trong mục "Executor của company" cuối file này. Chọn executor có ít issue đang mở nhất (`GET …/api/companies/$PAPERCLIP_COMPANY_ID/issues?assigneeAgentId=<id>&status=todo,in_progress,in_review,blocked`), hòa thì lấy executor đứng trước; gói sau tính cả các con bạn vừa giao. Không giao cho agent ngoài danh sách đó.

| complexity | model | effort | Khi nào |
|---|---|---|---|
| `trivial` | `claude-sonnet-5` | `low` | Đổi chữ, fixture, sửa cơ học có mô tả đủ |
| `small` | `claude-sonnet-5` | `medium` | Bám khuôn có sẵn, một module |
| `medium` | `claude-sonnet-5` | `high` | Nhiều file trong một module, logic mới cỡ vừa |
| `large` | `claude-opus-5` | `high` | Lõi, bảo mật/phân quyền, migration, scheduler, hợp đồng công khai |

Cân theo thứ việc chạm vào, không theo cảm giác khó. Không có mức nào dùng fable hay haiku.

## Tạo issue con

Tạo **ngay**, không xin owner xác nhận danh sách, **tuần tự** theo thứ tự phụ thuộc (blocker phải có id trước). Mỗi con một lệnh `POST /api/issues/<id gốc>/children`:

`{"title":"<tiêu đề ngắn>","description":"<việc cần làm, file/flow cần nạp, giả định>","acceptanceCriteria":["<tiêu chí kiểm được>"],"assigneeAgentId":"<executor của gói>","blockedByIssueIds":["<id con trước>"],"blockParentUntilDone":true,"assigneeAdapterOverrides":{"adapterConfig":{"model":"<model>","effort":"<effort>"}}}`

Bỏ `blockedByIssueIds` khi con không có blocker. Cuối `description`, mỗi marker **một dòng riêng**, đúng định dạng:

`crew-bundle id=<gói> seq=<n>`
`crew-model complexity=<mức> model=<model> effort=<effort> reason=<một dòng lý do>`
`crew-stack on=<identifier>` (chỉ khi con dựng trên code của con khác)
`crew-kind research` (chỉ với con research)

Lưu `id` và `identifier` server trả về cho con sau. Một lệnh tạo lỗi: dừng tạo tiếp, comment nguyên văn lỗi trên issue gốc (các con đã tạo vẫn giữ; lần sau đọc danh sách con trước khi tạo, không tạo trùng).

Xong cả lô: comment trên issue gốc, **dòng đầu đúng định dạng**, sau đó bảng `identifier · gói · executor · model · phụ thuộc` và các giả định:

`crew-plan root=<identifier gốc> children=<số con> bundles=<số gói>`

Không đổi status issue gốc. Dừng.

## Đóng issue gốc

Khi mọi con `done` (đọc lại danh sách, không tin wake reason): kiểm mỗi con có `executionState.completedStageIds` chứa stage review đầu. Con nào `cancelled` thì ghi rõ trong comment (owner hủy). Rồi một lệnh:

`PATCH /api/issues/<id gốc>` với `{"status":"done","comment":"crew-assistant done children=<identifier,…>\nTrợ Lý: mọi issue con đã qua review — <tóm tắt 2–5 dòng kết quả>"}`.

Server chuyển issue gốc sang reviewer (rồi integrator và owner với yêu cầu code, hoặc owner với research). Đó là bình thường. Con nào chưa qua review: không `done`, comment nêu con đó rồi dừng.

## Khi server trả 422

Đọc `code` và `violations`, comment lại nguyên văn rồi dừng. Không thử đường khác.

| code | Nghĩa | Bạn làm |
|---|---|---|
| `crew_override_forbidden` | `assigneeAdapterOverrides` có key hoặc model/effort ngoài bảng | Tạo lại con với đúng `{"adapterConfig":{"model","effort"}}` của bảng |
| `crew_role_assignee` | Giao con cho reviewer hoặc integrator | Giao cho executor trong danh sách |
| `crew_agent_root_issue` | Tạo issue không có cha | Luôn tạo qua `/api/issues/<id gốc>/children` |
| `crew_gate_blocked` | Chưa đủ điều kiện (`done` khi stage chưa duyệt, tạo con ở `done`/`in_review`) | Không tự duyệt; chờ con xong |
| `crew_policy_locked` | Đổi `executionPolicy` | Bỏ thay đổi đó |
| `crew_roles_unconfigured` | Server chưa cấu hình vai trò | `PATCH` gốc `{"status":"blocked","comment":"Trợ Lý: server chưa cấu hình vai trò Crew, nhờ owner kiểm."}` rồi dừng |
````

- [ ] **Step 4: Chạy, kỳ vọng PASS** — `node --test crew/agents/instructions.test.mjs`. Trên nhánh `crew/r13-roles` hai test đối chiếu server được skip (file chưa có); mọi test khác PASS.

- [ ] **Step 5: Commit** `feat(crew): instructions cho agent Trợ Lý tách yêu cầu thành issue con`

## Task RA-2 — áp vai trò `assistant` với danh sách executor

**Files:**
- Create: `crew/agents/render-instructions.mjs`, `crew/agents/render-instructions.test.mjs`
- Modify: `crew/agents/apply-roles.sh`

**Interfaces:**
- Produces: `renderInstructions(role, text, agentId, executorIds): string`; CLI `render-instructions.mjs <role> <file .md> <agentId> [executorId,executorId]` in JSON `{"path":"AGENTS.md","content":…}`; `apply-roles.sh agent <agentId> assistant <pin> <executorId,executorId>` (EN-1, AC-3 dùng).

- [ ] **Step 1: Test thất bại** `crew/agents/render-instructions.test.mjs`

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderInstructions } from "./render-instructions.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const E1 = "22222222-2222-4222-8222-222222222222";
const E2 = "33333333-3333-4333-8333-333333333333";

test("assistant: nối mục Executor của company, giữ thứ tự", () => {
  const out = renderInstructions("assistant", "# Trợ Lý\n", A, [E1, E2]);
  assert.equal(out, `# Trợ Lý\n\n## Executor của company\n\n- \`${E1}\`\n- \`${E2}\`\n`);
});

test("assistant: từ chối danh sách rỗng, id sai, trùng nhau hoặc trùng chính Trợ Lý", () => {
  assert.throws(() => renderInstructions("assistant", "x", A, []), /executor/);
  assert.throws(() => renderInstructions("assistant", "x", A, ["abc"]), /uuid/);
  assert.throws(() => renderInstructions("assistant", "x", A, [E1, E1.toUpperCase()]), /trùng/);
  assert.throws(() => renderInstructions("assistant", "x", A, [A]), /Trợ Lý/);
});

test("vai trò khác: giữ nguyên văn bản, không nhận danh sách executor", () => {
  assert.equal(renderInstructions("executor", "# Executor\n", A, []), "# Executor\n");
  assert.throws(() => renderInstructions("reviewer", "x", A, [E1]), /chỉ assistant/);
  assert.throws(() => renderInstructions("owner", "x", A, []), /role/);
});
```

- [ ] **Step 2: FAIL** — `node --test crew/agents/render-instructions.test.mjs` → `Cannot find module`.

- [ ] **Step 3: Viết `crew/agents/render-instructions.mjs`**

```js
#!/usr/bin/env node
// Prints the instructions-bundle file body (AGENTS.md) for a Crew role. The assistant gets the company's executor
// list appended, because it must hand each bundle to one of them and the server config does not list executors.
// Usage: render-instructions.mjs <role> <role .md file> <agentId> [executorId,executorId]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROLES = new Set(["executor", "reviewer", "integrator", "assistant"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function renderInstructions(role, text, agentId, executorIds) {
  if (!ROLES.has(role)) throw new Error(`unknown role: ${role}`);
  if (role !== "assistant") {
    if (executorIds.length > 0) throw new Error("danh sách executor chỉ assistant nhận");
    return text;
  }
  if (executorIds.length === 0) throw new Error("assistant cần ít nhất một executor");
  const seen = new Set();
  for (const id of executorIds) {
    if (!UUID_RE.test(id)) throw new Error(`executor phải là uuid: ${id}`);
    const key = id.toLowerCase();
    if (seen.has(key)) throw new Error(`executor trùng: ${id}`);
    if (key === String(agentId).toLowerCase()) throw new Error("Trợ Lý không được nằm trong danh sách executor của chính nó");
    seen.add(key);
  }
  const list = executorIds.map((id) => `- \`${id}\``).join("\n");
  return `${text.replace(/\n*$/, "\n")}\n## Executor của company\n\n${list}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [role, file, agentId, executors = ""] = process.argv.slice(2);
    const executorIds = executors.split(",").map((s) => s.trim()).filter(Boolean);
    const content = renderInstructions(role, readFileSync(file, "utf8"), agentId, executorIds);
    process.stdout.write(JSON.stringify({ path: "AGENTS.md", content }));
  } catch (error) {
    process.stderr.write(`render-instructions: ${error.message}\n`);
    process.exit(2);
  }
}
```

- [ ] **Step 4: PASS** — chạy lại Step 2.

- [ ] **Step 5: Sửa `crew/agents/apply-roles.sh`**

Header: thêm dòng `#   apply-roles.sh agent <agentId> assistant <pinned plugin dir> <executorId,executorId>` và câu "The assistant's AGENTS.md gets the executor list appended (render-instructions.mjs)." Nhánh `agent`:

```bash
  agent)
    [ $# -eq 3 ] || [ $# -eq 4 ] || die "usage: agent <agentId> <executor|reviewer|integrator|assistant> <pinned plugin dir> [executorId,executorId for assistant]"
    AGENT=$1; ROLE=$2; PIN=$3; EXECUTORS=${4:-}
    case "$ROLE" in executor|reviewer|integrator|assistant) ;; *) die "role must be executor, reviewer, integrator or assistant";; esac
    if [ "$ROLE" = assistant ] && [ -z "$EXECUTORS" ]; then die "assistant needs the executor agent ids (comma-separated)"; fi
    if [ "$ROLE" != assistant ] && [ -n "$EXECUTORS" ]; then die "only assistant takes an executor list"; fi
```

(giữ nguyên các kiểm `PIN`, `need_node`, PATCH `extraArgs`), và thay dòng dựng `FILE=$(node -e …)` bằng:

```bash
    FILE=$(node "$HERE/render-instructions.mjs" "$ROLE" "$HERE/$ROLE.md" "$AGENT" "$EXECUTORS") || die "cannot render $ROLE.md for agent $AGENT; nothing was uploaded"
```

Dòng echo cuối: `echo "apply-roles: $AGENT role=$ROLE extraArgs=$EXPECTED${EXECUTORS:+ executors=$EXECUTORS}"`.

- [ ] **Step 6: Kiểm cú pháp + test** — `bash -n crew/agents/apply-roles.sh && node --test crew/agents/*.test.mjs`.

- [ ] **Step 7: Commit** `feat(crew): áp vai trò Trợ Lý kèm danh sách executor`

## Task RA-3 — executor, reviewer, integrator hiểu marker mới

**Files:**
- Modify: `crew/agents/executor.md`, `crew/agents/reviewer.md`, `crew/agents/integrator.md`, `crew/agents/instructions.test.mjs`

- [ ] **Step 1: Test thất bại** — thêm vào `instructions.test.mjs`

```js
test("executor: research không commit, báo bằng crew-report; nhánh xếp chồng theo crew-stack", () => {
  const text = read("executor");
  assert.match(text, /`crew-kind research`/);
  assert.match(text, /không tạo nhánh, không sửa file, không commit/);
  assert.match(text, /`crew-report`/);
  assert.match(text, /"status":"done","comment":"Executor: xong báo cáo research, chờ review."/);
  assert.match(text, /`crew-stack on=<identifier>`/);
  assert.match(text, /git switch -c crew\/<identifier> <sha đã duyệt của issue đó>/);
  assert.match(text, /crew_override_forbidden/);
  assert.match(text, /`crew-bundle/);
});

test("reviewer: duyệt research không cần crew-commit, diff crew-stack từ sha nền", () => {
  const text = read("reviewer");
  const quoted = /"comment":"(crew-review research verdict=approved)\\n/.exec(text);
  assert.ok(quoted, "thiếu lệnh approve research");
  assert.match(text, /`crew-report`/);
  assert.match(text, /`crew-stack on=<identifier>`/);
  assert.match(text, /git diff <sha nền>\.\.<sha>/);
});

test("integrator: không đặt override khi tạo issue con sửa", () => {
  const text = read("integrator");
  assert.match(text, /không gửi `assigneeAdapterOverrides`/);
  assert.match(text, /crew_override_forbidden/);
});
```

- [ ] **Step 2: FAIL** — `node --test crew/agents/instructions.test.mjs`.

- [ ] **Step 3: Sửa `crew/agents/executor.md`**

a) Mục "Trước khi làm", bước 1, thay câu nhánh bằng (giữ phần kiểm `git branch --show-current`):

"**Nhánh trước tiên**, trước khi sửa bất cứ file nào: `git fetch origin`, rồi chọn nền theo thứ tự: mô tả có dòng `crew-fix base=<40 hex>` thì nền là `<base>`; có dòng `crew-stack on=<identifier>` thì `GET /api/issues/<identifier>` và comment của nó, nền là `sha` trong dòng `crew-review sha=<sha> verdict=approved` mới nhất do reviewer viết (issue đó phải `done`; không có thì `PATCH` `{"status":"blocked","comment":"Executor: dừng vì issue nền chưa có commit đã duyệt"}` rồi dừng), tạo nhánh bằng `git switch -c crew/<identifier> <sha đã duyệt của issue đó>`; không có dòng nào thì nền là `origin/HEAD`. Nhánh đã có thì `git switch crew/<identifier>`. Kiểm `git branch --show-current` in đúng `crew/<identifier>`."

b) Thêm bước 5 vào "Trước khi làm": "Mô tả có dòng `crew-bundle id=… seq=…`: issue này nối tiếp các issue cùng gói, nên session có thể còn ngữ cảnh của issue trước (cùng gói, cùng bạn làm). Dùng lại hiểu biết đó, nhưng chỉ làm việc của issue hiện tại và đọc lại mô tả, acceptance criteria của nó."

c) Thêm mục mới ngay trước "## Giữ worktree sạch cho lần chạy sau":

```markdown
## Issue research (`crew-kind research`)

Mô tả có dòng `crew-kind research`: không tạo nhánh, không sửa file, không commit. Đọc docs và code cần thiết, dùng `superpowers:brainstorming` để so các phương án, rồi viết một comment, **dòng đầu** đúng `crew-report`, sau đó: câu hỏi được giao, các phương án, đề xuất và lý do, nguồn (`file:dòng`, lệnh đã chạy). Rồi `PATCH /api/issues/<id>` với `{"status":"done","comment":"Executor: xong báo cáo research, chờ review."}`. Không đăng `crew-commit` cho issue research.
```

d) Mục "Không bao giờ" ý 2 thành: "Báo xong mà không đăng `crew-commit` cho commit mới nhất (đăng lại sau MỖI lần sửa); issue research thì thay bằng `crew-report`."

e) Mục "Cách làm", gạch "Chỉ tạo issue con khi issue yêu cầu…" thêm: "… không giao cho agent reviewer hoặc integrator, không gửi `assigneeAdapterOverrides`."

f) Bảng 422 thêm dòng: `| \`crew_override_forbidden\` | Override của issue có key ngoài model/effort | Bỏ \`assigneeAdapterOverrides\` khỏi lệnh |`.

- [ ] **Step 4: Sửa `crew/agents/reviewer.md`**

a) "Không bao giờ" ý 1 thêm: "(trừ issue research, xem mục dưới)".

b) "Cách review" bước 1, sau câu về `crew-fix base=`, thêm: "Mô tả có dòng `crew-stack on=<identifier>`: lấy `sha` của `crew-review … verdict=approved` mới nhất trên issue đó làm `<sha nền>` và xem `git diff <sha nền>..<sha>` (chỉ phần của issue này)."

c) Thêm mục trước "## Issue gốc":

```markdown
## Issue research (`crew-kind research`)

Không có `crew-commit`. Đọc comment `crew-report` mới nhất của executor: trả lời đúng câu hỏi được giao, so đủ phương án, đề xuất có lý do, nguồn kiểm được (`file:dòng` có thật). Không chạy test.
- Đạt: `{"status":"done","comment":"crew-review research verdict=approved\nReviewer: approve — <lý do ngắn>"}`.
- Cần sửa: `{"status":"in_progress","comment":"Reviewer: cần sửa — <điểm thiếu cụ thể>"}`.
```

d) Mục "Issue gốc", gạch đầu: sau "có `crew-review … verdict=approved` hợp lệ (do reviewer viết) cho `sha` trùng `crew-commit` mới nhất của con" thêm "(con research: dòng `crew-review research verdict=approved` mới hơn `crew-report` mới nhất)".

- [ ] **Step 5: Sửa `crew/agents/integrator.md`** — mục "Yêu cầu sửa", câu "…không gửi `executionPolicy`, không giao cho reviewer hay integrator." thành "…không gửi `executionPolicy`, không gửi `assigneeAdapterOverrides`, không giao cho reviewer hay integrator." Mục "Lỗi server", gạch thứ hai thành: "422 `crew_policy_locked`, `crew_role_assignee`, `crew_override_forbidden`: bạn đang đổi policy, người giao việc hoặc override của issue; bỏ thay đổi đó."

- [ ] **Step 6: PASS** — `node --test crew/agents/*.test.mjs` (toàn bộ test cũ vẫn PASS).

- [ ] **Step 7: Commit** `feat(crew): executor và reviewer xử lý issue research và nhánh xếp chồng`

## Rủi ro

| Rủi ro | Khả năng × ảnh hưởng | Giảm thiểu |
|---|---|---|
| Superpowers `brainstorming` hỏi trong terminal và treo run | Trung bình × Trung bình | Instructions dặn tự trả lời; AC-3 4a đo; nếu vẫn treo thì bỏ brainstorming khỏi Trợ Lý, giữ `writing-plans` |
| Trợ Lý tạo trùng con khi run lặp | Trung bình × Trung bình | Luôn đọc danh sách con trước; lệnh lỗi thì dừng; `idempotencyKey` cho interaction |
| Sonnet làm sai marker (thiếu dòng, sai định dạng) | Trung bình × Thấp | H1 bỏ qua marker sai (session mới); test dòng mẫu; AC-3 kiểm marker |
| Hai executor dùng chung kho git, nhánh `crew/<id>` thấy nhau | Thấp × Thấp | Đã như R1-2 (reviewer/integrator dùng chung kho); `crew-stack` cần đúng điều này |

**Rollback:** revert từng commit của gói; `apply-roles.sh agent <id> executor <pin>` cho agent Trợ Lý sẽ không còn hợp lệ vai cũ, nên khi rollback thì pause agent Trợ Lý trên server.
