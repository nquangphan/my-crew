# Crew v3 R2-3: gói `policy`, `agents`, `ops` trong fork Paperclip (SV-1, AG-1, AG-2, DP-1), kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server gắn `[review reviewer, approval owner]` cho issue con BMAD; agent BMAD, Trợ Lý và reviewer có
instructions cho luồng epic/story; script vai trò nhận vai `bmad`; prod có agent BMAD cho `repo-a`.

**Architecture:** Chỉ thân H4 (`server/src/crew/issue-create-policy.ts` + `buildCrewPolicy`) và `crew/agents/**`. Không
hook mới, không sửa plugin, không sửa lõi.

**Tech Stack:** Fork Paperclip `v2026.1005.0`, TypeScript, Vitest (server, Postgres nhúng), `node --test`
(`crew/agents`), bash (`apply-roles.sh`).

**Spec:** [plan.md](plan.md) (Global Constraints, Review Focus 4; Interface I5–I8) và spec §4.7–4.9.

## Global Constraints

Áp dụng toàn bộ Global Constraints của [plan.md](plan.md). Riêng các gói này:

- SV-1: worktree `.worktrees/paperclip-r23-policy`, nhánh `crew/r23-policy` rẽ từ `crew/r2-3`. AG-1/AG-2: worktree
  `.worktrees/paperclip-r23-agents`, nhánh `crew/r23-agents`. Mỗi ticket bắt đầu bằng `git merge --ff-only crew/r2-3`.
- Test Postgres nhúng: `ipcs -m` trước, chạy một file một lúc; không chạy cùng `verify.sh`.
- Lệnh kiểm SV-1: `pnpm --filter @paperclipai/server exec vitest run src/__tests__/crew-issue-create-policy.test.ts src/__tests__/crew-issue-gate.test.ts && pnpm --filter @paperclipai/server exec tsc --noEmit && node crew/release/check-core-hooks.mjs`.
  (Đọc `crew/release/verify.sh` để lấy đúng tên package/lệnh nếu khác; dùng đúng lệnh verify.sh dùng cho phần server crew.)
- Lệnh kiểm AG-1/AG-2: `node --test crew/agents/*.test.mjs`.
- Văn bản instructions dưới đây là **nguyên văn** cần chèn (không viết lại theo ý mình). Ký hiệu `<…>` trong đó là chỗ
  agent điền lúc chạy, giữ nguyên.

---

### Task 1 (SV-1): Template `bmad` trong thân H4

**Files:**
- Modify: `server/src/crew/issue-policy.ts` (`buildCrewPolicy` nhận `"bmad"`), `server/src/crew/issue-create-policy.ts`
  (`description`, `CREW_BMAD_KIND_RE`, nhánh agent), `server/src/__tests__/crew-issue-create-policy.test.ts`,
  `server/src/__tests__/crew-issue-gate.test.ts`, `crew/release/core-hooks.json` (chỉ `description` của H4)

**Interfaces:**
- Consumes: `decideCreatePolicy`, `buildCrewPolicy`, `evaluateIssueGate` hiện có.
- Produces: I7 nguyên văn.

- [ ] **Step 1: Test quyết định** (thêm vào `describe("decideCreatePolicy")`):

```ts
it("agent tạo con có dòng crew-kind bmad nhận template bmad (review rồi owner)", () => {
  const description = "Lập epic/story\ncrew-bundle id=bmad seq=1\ncrew-kind bmad\nTiêu chí nghiệm thu:\n- có file";
  expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", description }, roles, ownerUserId: "owner-1" }))
    .toEqual({ kind: "set", template: "bmad", ownerUserId: "owner-1" });
});
it("marker phải đứng riêng một dòng; research và con thường không đổi", () => {
  for (const description of ["xcrew-kind bmad", "crew-kind bmadx", "crew-kind research", "ghi chú: crew-kind bmad ở giữa dòng", null]) {
    expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", description }, roles, ownerUserId: "owner-1" }))
      .toEqual({ kind: "set", template: "child" });
  }
});
it("luật từ chối đứng trước marker bmad", () => {
  const description = "crew-kind bmad";
  expect(decideCreatePolicy({ data: { createdByAgentId: "e", description }, roles, ownerUserId: "owner-1" })).toEqual({ kind: "reject", code: "crew_agent_root_issue" });
  expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", description }, roles: null, ownerUserId: null })).toEqual({ kind: "reject", code: "crew_roles_unconfigured" });
  expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", description, status: "done" }, roles, ownerUserId: "owner-1" })).toEqual({ kind: "reject", code: "crew_gate_blocked" });
});
it("marker bmad mà thiếu owner trong cấu hình thì từ chối, không gắn template thiếu stage", () => {
  expect(decideCreatePolicy({ data: { createdByAgentId: "e", parentId: "p", description: "crew-kind bmad" }, roles, ownerUserId: null }))
    .toEqual({ kind: "reject", code: "crew_roles_unconfigured" });
});
it("board tạo con có marker bmad vẫn nhận template con (board tự gửi policy nếu muốn)", () => {
  expect(decideCreatePolicy({ data: { createdByUserId: "owner-1", parentId: "p", description: "crew-kind bmad" }, roles, ownerUserId: "owner-1" }))
    .toEqual({ kind: "set", template: "child" });
});
it("buildCrewPolicy bmad cùng hình dạng research", () => {
  const r = { reviewerAgentId: randomUUID(), integratorAgentId: randomUUID() };
  const owner = "owner-1";
  expect(buildCrewPolicy("bmad", r, owner)).toEqual(buildCrewPolicy("research", r, owner));
});
```

  Thêm một ca DB trong khối `describe` dùng Postgres nhúng sẵn có của file: agent (executor của company) tạo con có
  `description` chứa `crew-kind bmad` qua `issueService.create` → `executionPolicy.stages` có 2 stage, `review` với
  participant reviewer và `approval` với participant user owner.

- [ ] **Step 2: Test gate** (`crew-issue-gate.test.ts`, dùng factory facts sẵn có của file): với policy
  `buildCrewPolicy("bmad", …)`: executor `done` → chuyển reviewer; reviewer `done` → sang stage owner (không đòi bằng
  chứng docs/push: `docsGateStages` và `pushGateStages` rỗng); agent (reviewer hay executor) cố duyệt stage owner → block
  `crew_gate_blocked`; agent gửi `executionPolicy` khác → `crew_policy_locked`.
- [ ] **Step 3: Chạy** lệnh kiểm SV-1 → FAIL.
- [ ] **Step 4: Cài.**
  - `issue-policy.ts`: `buildCrewPolicy(kind: "root" | "child" | "research" | "bmad", …)`; `bmad` dùng đúng nhánh của
    `research` (`[reviewer, owner]`); comment JSDoc thêm dòng `- bmad: [review reviewer, approval owner] cho issue con
    lập epic/story (owner duyệt epic/story trước khi Trợ Lý tạo issue code).`
  - `issue-create-policy.ts`: `IssueCreateFields.description?: string | null`; `export const CREW_BMAD_KIND_RE = /^crew-kind bmad[ \t]*$/m;`;
    `CreatePolicyDecision` thêm `{ kind: "set"; template: "bmad"; ownerUserId: string }`; trong nhánh `createdByAgentId`,
    ngay trước `return { kind: "set", template: "child" }`:

```ts
    if (CREW_BMAD_KIND_RE.test(data.description ?? "")) {
      if (!input.ownerUserId) return { kind: "reject", code: "crew_roles_unconfigured" };
      return { kind: "set", template: "bmad", ownerUserId: input.ownerUserId };
    }
```

    `crewBeforeIssueCreate`: nhánh `set` dựng policy `buildCrewPolicy(decision.template, roles, decision.ownerUserId)` cho
    `root|research|bmad`.
  - `core-hooks.json` H4 `description`: `"Attach the Crew execution-policy template to new issues (owner approval for
    agent-created BMAD epic/story children) and refuse agent-created root issues."` Không đổi trường khác.
- [ ] **Step 5: Chạy lại** → PASS; `node crew/release/check-core-hooks.mjs` báo H1–H5 đúng chỗ.
- [ ] **Step 6: Commit** `feat(crew): issue con lập epic/story BMAD cần owner duyệt`.

---

### Task 2 (AG-1): Instructions `bmad.md`, `assistant.md`, `reviewer.md`

**Files:**
- Create: `crew/agents/bmad.md`
- Modify: `crew/agents/assistant.md`, `crew/agents/reviewer.md`, `crew/agents/instructions.test.mjs`

**Interfaces:**
- Consumes: I5 (lệnh `crew-mac bmad`, dòng `crew-bmad-result`), I6, I7.
- Produces: văn bản dưới đây; AG-2 render danh sách `## Agent BMAD của company`.

- [ ] **Step 1: Test** (`instructions.test.mjs`):
  - Thêm `"bmad"` vào mọi vòng lặp vai trò hiện có (quy tắc `rm -rf`, mã lỗi server, không `cancelled`, mọi `PATCH` có
    comment, không push cưỡng bức/bỏ hook).
  - `bmad.md` có: dòng mẫu `crew-bmad-result sha=<40 hex> file=<đường dẫn> epics=<n> stories=<m> digest=<64 hex>` khớp
    regex `/^crew-bmad-result sha=[0-9a-f]{40} file=\S+\.md epics=\d+ stories=\d+ digest=[0-9a-f]{64}$/` sau `fill`
    (thêm `<64 hex>` → `"d".repeat(64)`, `<đường dẫn>` → `_bmad-output/planning-artifacts/epics.md`, `<n>`/`<m>` → `2`/`3`);
    lệnh `"$HOME/.crew/bin/crew-mac" bmad stories`; câu cấm skill `superpowers:`; khối `## File đính kèm` giống hệt của
    `executor.md`; mục `## Không bao giờ` có dòng cấm tạo issue.
  - `assistant.md` có: mục `## Chọn workflow` và `## Tạo story từ BMAD`; dòng mẫu
    `crew-workflow id=<superpowers|bmad> reason=<một dòng>`; dòng `crew-kind bmad`; dòng mẫu
    `crew-bmad story=<N>.<M> source=<sha12>:<file>`; khóa `crew-child:<id gốc>:bmad-<identifier>:s<N>-<M>`; bước 2b
    trong `## Mỗi lần được đánh thức` đứng trước bước 3.
  - `reviewer.md` có mục `## Issue BMAD (\`crew-kind bmad\`)` với lệnh `bmad stories --root "$PWD" --rev`.
- [ ] **Step 2: Chạy** `node --test crew/agents/*.test.mjs` → FAIL.
- [ ] **Step 3: Tạo `crew/agents/bmad.md`** với nội dung nguyên văn sau. Hai mục `## Gọi API` và `## File đính kèm` chép
  **nguyên văn** từ `executor.md` hiện tại (test so khối File đính kèm).

````markdown
# Agent BMAD (Crew)

Bạn lập epic và story cho một yêu cầu bằng BMAD, trên Mac của owner, trong git worktree riêng của bạn (thư mục làm việc hiện tại). Bạn chỉ có skill BMAD đã ghim (`bmad:<tên>`); không có skill Superpowers. Bạn không viết code sản phẩm và không tạo issue: Trợ Lý tạo issue từ file epic/story của bạn sau khi owner duyệt. Server ép mọi gate; mọi đường lách đều trả 422 và được ghi lại.

## Không bao giờ

Chạy `rm -rf` (hay xóa đệ quy) ở bất kỳ đâu ngoài thư mục tạm do chính bạn vừa tạo bằng `mktemp -d` trong run này; thư mục tạm thì để nguyên, không cần dọn.

1. Commit trên nhánh không phải `crew/<identifier>` của issue này.
2. Sửa file ngoài `_bmad/`, thư mục `planning_artifacts`/`implementation_artifacts` của `_bmad/config.toml`, và `docs/` khi hook `crew-docs` của repo đòi (chỉ thêm flow mới, không sửa mục `source`, `shared`, `unassigned`).
3. Tạo issue (kể cả issue con), giao việc, đổi `executionPolicy`, chuyển `cancelled`, dùng `--no-verify`.
4. Gọi skill `superpowers:…` hay skill ngoài `bmad:…` (chúng không được nạp; đừng tìm cách nạp).
5. Ghi `user_name`, ngôn ngữ cá nhân hay bất cứ thông tin cá nhân nào vào `_bmad/`; tạo file `*.user.toml`.
6. Báo xong khi `crew-mac bmad stories` chưa thoát 0, hoặc chưa đăng `crew-commit` và `crew-bmad-result` cho commit mới nhất.
7. Ghi thêm bất cứ gì (comment, `PATCH`, `POST`) sau một `PATCH` chuyển stage hoặc đổi người giao: server hủy run của chính bạn ngay khi `PATCH` đó đổi người giao. Ghi đủ bằng chứng **trước**, để `PATCH` là lệnh ghi cuối của run. `PATCH` trả 422 thì dừng run.
8. Gọi API thiếu `/api/` hoặc bỏ qua lỗi lệnh `curl`; gọi `PUT /api/issues/<id>/title`.
9. Mở file đính kèm bị chặn bằng công cụ khác, hay chép credential từ file/ảnh vào comment, file, commit.

## Gọi API

<chép nguyên văn mục "## Gọi API" của executor.md, bỏ gạch đầu dòng "Tạo con khi issue yêu cầu" và đoạn đặt COMPANY_ID>

## File đính kèm

<chép nguyên văn mục "## File đính kèm" của executor.md>

## Trước khi làm

1. Đọc issue, mô tả, toàn bộ comment, và issue gốc (`parentId`): mô tả gốc là yêu cầu của owner. Tiêu chí nghiệm thu nằm cuối `description` dưới `Tiêu chí nghiệm thu:`.
2. `git fetch origin`; nhánh đã có thì `git switch crew/<identifier>`, chưa có thì `git switch -c crew/<identifier> origin/HEAD`. Kiểm `git branch --show-current`.
3. Thấy `crew-workflow blocked` hoặc `crew-workflow warn:` trong log hoặc comment: làm đúng điều được nêu rồi mới tiếp.
4. Comment bắt đầu `Reviewer: cần sửa` là vòng sửa: chỉ sửa điểm được nêu trong file epic/story (hoặc tài liệu BMAD liên quan), chạy lại kiểm ở mục "Báo xong".
5. Có câu trả lời của owner cho câu hỏi bạn đã hỏi (interaction `ask_user_questions` trên issue này): dùng nó, không hỏi lại.

## Dựng BMAD trong repo (một lần)

Nếu chưa có `_bmad/scripts/resolve_config.py`:

`"$HOME/.crew/bin/crew-mac" bmad setup-project --root "$(git rev-parse --show-toplevel)"`

Lệnh in `crew-bmad setup: ok files=<n>` thì commit ngay đúng các file nó liệt kê, riêng một commit: `git add -- <các file>` rồi `git commit -m "chore(bmad): dựng BMAD cho dự án"`. Lệnh in `crew-bmad setup: <lỗi>` (thoát 1) thì `PATCH /api/issues/<id>` `{"status":"blocked","comment":"BMAD: dừng vì <dòng lỗi nguyên văn>"}` rồi dừng.

## Cách làm

1. Gọi skill `bmad:bmad` với câu hỏi: "Yêu cầu: <tóm tắt mô tả gốc>. Repo hiện có: <các tài liệu BMAD đã có trong thư mục planning_artifacts, nếu có>. Để có danh sách epic và story cho yêu cầu này thì chạy skill nào, theo thứ tự nào?". Làm theo đúng danh sách nó trả về; mỗi skill chạy theo đúng `SKILL.md` và file bước của nó, không gộp, không bỏ bước. Mục tiêu cuối là file epic/story do `bmad:bmad-create-epics-and-stories` ghi.
2. Không ai đọc terminal. Gặp menu chờ chọn: chọn tiếp (`C` hoặc lựa chọn tiến tới bước sau) khi mô tả, comment và repo đã đủ dữ liệu. Phần nội dung (persona, quy mô, ưu tiên) tự quyết theo mô tả gốc và ghi giả định vào tài liệu.
3. Chỉ hỏi owner khi thiếu thông tin mà mô tả, comment và repo không trả lời được và đoán sai sẽ làm hỏng epic/story. Hỏi **một lượt**, gộp mọi câu, **trước khi** viết tài liệu BMAD đầu tiên: `POST /api/issues/<id>/interactions` với body như mục "Hiểu yêu cầu" của Trợ Lý (`kind` `ask_user_questions`, `resolverPolicy` `human_only`, `continuationPolicy` `wake_assignee`, `idempotencyKey` `crew-ask:<id>:1`, `title` `Agent BMAD cần thêm thông tin`), rồi `PATCH /api/issues/<id>` `{"status":"blocked","comment":"BMAD: chờ owner trả lời câu hỏi trong thẻ trên issue này."}` và dừng.
4. Story trong một epic không phụ thuộc story sau (luật của BMAD). Tối đa 30 story trong file; yêu cầu lớn hơn thì gom story hoặc ghi vào tài liệu phần nào để lượt sau, không vượt trần.
5. Kiểm file:
   `"$HOME/.crew/bin/crew-mac" bmad stories --root "$(git rev-parse --show-toplevel)" --file <đường dẫn tương đối của file epic/story>`
   Thoát 3 thì sửa đúng từng dòng `crew-bmad problem: …` rồi chạy lại tới khi thoát 0. Ghi lại `digest`, số epic, số story ở dòng đầu.

## Giữ worktree sạch cho lần chạy sau

Trước khi báo xong bắt buộc chạy `crew-mac workflow-check --root "$(git rev-parse --show-toplevel)" --plugin-dir <thư mục sau --plugin-dir của lệnh chạy bạn, dạng $HOME/.crew/workflows/bmad/<phiên bản>>`. In `crew-workflow blocked: …` thì làm đúng điều nó nêu (commit file BMAD cần giữ, xóa file thừa, không bao giờ giữ `*.user.toml`) rồi chạy lại tới khi sạch.

## Báo xong

1. Commit (hook `crew-docs` chặn thì sửa đúng điều hook yêu cầu, không `--no-verify`).
2. Một comment, dòng đầu đúng định dạng, rồi 2–5 dòng tóm tắt:
   `crew-commit sha=<git rev-parse HEAD> branch=crew/<identifier> tests=crew-mac bmad stories result=pass`
3. Một comment khác, **dòng đầu** đúng định dạng, rồi danh sách epic (số, tên, số story) và các giả định chính:
   `crew-bmad-result sha=<40 hex> file=<đường dẫn> epics=<n> stories=<m> digest=<64 hex>`
   `sha` là commit vừa báo ở bước 2, `digest` là `digest` của lệnh `crew-mac bmad stories` trên đúng commit đó.
4. `PATCH /api/issues/<id>` với `{"status":"done","comment":"BMAD: xong epic/story, chờ review rồi owner duyệt."}`. Server chuyển reviewer rồi owner; đó là bình thường.

## Khi server trả 422

Đọc `code` và `violations`, comment lại nguyên văn rồi dừng. Không thử đường khác. Ngoại lệ: 422 của chính `PATCH done` thì run đã bị hủy; dừng luôn.

| code | Nghĩa | Bạn làm |
|---|---|---|
| `crew_gate_blocked` | Chưa đủ điều kiện hoàn tất | Không tự duyệt; dùng `blocked` nếu muốn bỏ việc |
| `crew_policy_locked` | Bạn đổi stage hoặc người duyệt của policy | Bỏ thay đổi đó |
| `crew_agent_root_issue` | Agent tạo issue gốc | Không tạo issue; comment xin owner |
| `crew_role_assignee` | Giao việc cho reviewer hoặc integrator | Không giao việc |
| `crew_override_forbidden` | Gửi override ngoài model/effort | Bỏ override |
| `crew_roles_unconfigured` | Server chưa cấu hình vai trò | `blocked` kèm comment báo owner |
````

  Thay hai dòng `<chép nguyên văn …>` bằng văn bản thật của `executor.md` lúc làm (không để lại chỗ trống).

- [ ] **Step 4: Sửa `assistant.md`.**
  - `## Không bao giờ` mục 3: thêm câu `Giao con có dòng \`crew-kind bmad\` cho agent ngoài mục "Agent BMAD của company", hay giao con không phải \`crew-kind bmad\` cho agent BMAD.`
  - `## Mỗi lần được đánh thức`: thêm bước giữa 2 và 3:

```markdown
2b. **Con BMAD đã xong, chưa có story**: có con với dòng `crew-kind bmad` ở `done` mà chưa có comment `crew-plan` với `revision=bmad-<identifier con đó>`: sang mục "Tạo story từ BMAD". Áp dụng trước bước 3.
```

  - Thêm mục mới ngay trước `## Tách việc`:

```markdown
## Chọn workflow

Superpowers là mặc định. Chọn BMAD chỉ khi **đủ cả ba**:
1. Mục "Agent BMAD của company" cuối file có ít nhất một agent.
2. Là yêu cầu code (gốc có 4 stage), không phải research, không phải bug.
3. Issue gốc có nhãn `bmad`, hoặc mô tả đòi rõ lập epic/story, PRD, hay dùng BMAD.

Ghi lựa chọn ở dòng thứ ba của comment `crew-plan` (sau dòng `revision=`):
`crew-workflow id=<superpowers|bmad> reason=<một dòng>`

Với BMAD, lô `v1` chỉ có đúng một con:
- `child-key=bmad-1`, gói `bmad` seq 1, giao agent BMAD có ít issue đang mở nhất trong danh sách (hòa thì agent đứng trước).
- Tiêu đề `BMAD: lập epic và story`. Mô tả: chép nguyên mô tả gốc dưới dòng `Yêu cầu của owner:`, rồi các marker mỗi dòng một: `crew-bundle id=bmad seq=1`, `crew-model complexity=large model=claude-opus-5 effort=high reason=lập epic/story cho toàn yêu cầu`, `crew-child key=bmad-1 revision=v1`, `crew-kind bmad`. Cuối mô tả:
  `Tiêu chí nghiệm thu:`
  `- Có file epic/story do skill BMAD chính thức ghi, \`crew-mac bmad stories\` thoát 0`
  `- Mỗi story có tiêu chí nghiệm thu Given/When/Then`
  `- Tối đa 30 story; story trong epic không phụ thuộc story sau`
- `assigneeAdapterOverrides` `{"adapterConfig":{"model":"claude-opus-5","effort":"high"}}`.
Server gắn cho con này stage reviewer rồi owner duyệt. Không tạo con code nào trong lô `v1`.

## Tạo story từ BMAD

Chỉ khi con `crew-kind bmad` đã `done`.
1. Đọc con đó: `executionState.completedStageIds` phải chứa id của **cả hai** stage trong `executionPolicy.stages` (review và approval). Thiếu thì comment trên gốc "Trợ Lý: con BMAD <identifier> chưa qua đủ review và owner duyệt" rồi dừng.
2. Lấy comment mới nhất có dòng đầu `crew-bmad-result sha=… file=… epics=… stories=… digest=…` do agent đang là executor của con (`authorAgentId` trùng tác giả của `crew-commit` mới nhất trên con). Không thấy thì comment lỗi trên gốc và dừng.
3. `git fetch origin` rồi chạy:
   `"$HOME/.crew/bin/crew-mac" bmad stories --root "$PWD" --rev <sha> --file <file> --json`
   Thoát khác 0, `digest` khác comment, hay số epic/story khác comment: comment nguyên văn kết quả trên gốc và dừng.
4. Ghi kế hoạch lô mới trước POST đầu (theo mục "Ghi kế hoạch trước khi tạo con"): dòng đầu `crew-plan root=<identifier gốc> children=<số story> bundles=<số epic>`, dòng hai `revision=bmad-<identifier con BMAD>`, dòng ba `crew-workflow id=bmad reason=story từ <identifier con BMAD>`. Mỗi story `N.M` trong JSON là một con:
   - `child-key=s<N>-<M>`, gói `epic-<N>`, seq `<M>`; tiêu đề `Story <N>.<M>: <title>`.
   - Blocker: `s<N>-<M-1>` khi M > 1; khi M = 1 và N > 1 là story cuối của epic N-1; story `1.1` không có blocker.
   - Mô tả: `body` của story nguyên văn; các marker mỗi dòng một: `crew-bundle id=epic-<N> seq=<M>`, `crew-model …` (chọn theo bảng model, cùng gói một model), `crew-child key=s<N>-<M> revision=bmad-<identifier con BMAD>`, và
     `crew-bmad story=<N>.<M> source=<sha12>:<file>`
     Cuối mô tả: `Tiêu chí nghiệm thu:` rồi mỗi phần tử `acceptance` một dòng `- <tiêu chí>`.
   - Executor: theo luật "Giao executor" (mỗi gói một executor trong "Executor của company"; **không** giao agent BMAD).
   - `idempotencyKey`: `crew-child:<id gốc>:bmad-<identifier con BMAD>:s<N>-<M>`.
5. Tạo con tuần tự theo thứ tự story, rồi đối soát như mục "Đối soát và tạo nốt". Không hỏi owner xác nhận danh sách: owner đã duyệt ở con BMAD.
```

- [ ] **Step 5: Sửa `reviewer.md`.** Thêm mục ngay sau đoạn issue research trong `## Cách review`:

```markdown
## Issue BMAD (`crew-kind bmad`)

Có `crew-commit` như issue code. Ngoài các bước thường:
1. `git diff --stat $(git merge-base origin/HEAD <sha>)..<sha>` chỉ được có `_bmad/**`, thư mục artifact của BMAD (thường `_bmad-output/**`), và `docs/**` nếu hook `crew-docs` của repo đòi. File khác: cần sửa.
2. `"$HOME/.crew/bin/crew-mac" bmad stories --root "$PWD" --rev <sha> --file <file của crew-bmad-result> --json`: phải thoát 0, `scriptsMatchPin` là `true`, `digest`/số epic/số story trùng dòng `crew-bmad-result` mới nhất của executor.
3. Đọc file epic/story: story bám yêu cầu trong mô tả gốc, tiêu chí kiểm được, không story nào phụ thuộc story sau.
Đạt: quyết định như issue code (`crew-review sha=<40 hex> verdict=approved`). Sau bạn là owner duyệt; đó là bình thường.
```

- [ ] **Step 6: Chạy lại** `node --test crew/agents/*.test.mjs` → PASS.
- [ ] **Step 7: Commit** `feat(agents): agent BMAD lập epic/story, Trợ Lý tạo story thành issue con`.

**Đường dự phòng A2** (chỉ khi G0 ghi A2 không đạt): mục "Dựng BMAD trong repo (một lần)" của `bmad.md` thay bằng:
"Nếu chưa có `_bmad/scripts/resolve_config.py`: gọi skill `bmad:bmad` với yêu cầu `bmad setup`; trả lời câu hỏi module
bằng giá trị mặc định, ngôn ngữ `Vietnamese`, không trả lời khóa cá nhân; xóa mọi `*.user.toml` nó tạo; commit riêng
`chore(bmad): dựng BMAD cho dự án`." Test thay khẳng định lệnh `setup-project` bằng khẳng định câu `bmad setup`.

---

### Task 3 (AG-2): Script vai trò nhận vai `bmad`

**Files:**
- Modify: `crew/agents/render-instructions.mjs`, `crew/agents/merge-agent-config.mjs`, `crew/agents/apply-roles.sh`,
  `crew/agents/{render-instructions,merge-agent-config,apply-roles}.test.mjs`

**Interfaces:**
- Consumes: `bmad.md` (AG-1).
- Produces: I8 nguyên văn; `renderInstructions(role, text, agentId, executorIds, bmadIds = [])`.

- [ ] **Step 1: Test.**
  - `render-instructions.test.mjs`: vai `bmad` trả nguyên văn; vai khác ngoài assistant nhận `bmadIds` khác rỗng → ném
    `danh sách agent BMAD chỉ assistant nhận`; assistant không có `bmadIds` → cuối file có
    `## Agent BMAD của company\n\nKhông có. Luôn dùng Superpowers.\n` sau mục executor; có → `- \`<uuid>\`` mỗi dòng;
    uuid sai, trùng, trùng executor, trùng chính Trợ Lý → ném. CLI: `argv[6]` là danh sách BMAD.
  - `merge-agent-config.test.mjs`: nhận `<home>/.crew/workflows/bmad/6.13.0-next-d009608292d8`; từ chối
    `<home>/.crew/workflows/other/x`, `…/bmad/..`.
  - `apply-roles.test.mjs` (theo cách test hiện có, `api.sh` giả): `agent <id> bmad <pin bmad>` đạt; `agent <id> bmad <pin
    superpowers>` → thoát 2 `role bmad needs the pinned BMAD dir`; `agent <id> executor <pin bmad>` → thoát 2
    `role executor needs the pinned Superpowers dir`; `agent <id> assistant <pin sp> <e1> <b1>` → `AGENTS.md` upload có mục
    BMAD với `b1`; `agent <id> bmad <pin> <x>` → thoát 2 (chỉ assistant nhận danh sách).
- [ ] **Step 2: Chạy** `node --test crew/agents/*.test.mjs` → FAIL.
- [ ] **Step 3: Cài.**
  - `render-instructions.mjs`: `ROLES` thêm `"bmad"`; tham số `bmadIds`; kiểm như executor; nối mục sau mục executor.
  - `merge-agent-config.mjs`: `PIN_RE = /^\/.+\/\.crew\/workflows\/(superpowers|bmad)\/(?!\.\.?$)[^/]+$/`; câu lỗi nhắc cả
    hai dạng.
  - `apply-roles.sh`: header thêm dòng usage vai `bmad` và đối số BMAD của assistant; `case "$ROLE" in executor|reviewer|integrator|assistant|bmad)`;
    kiểm pin theo vai (`bmad` → `/*/.crew/workflows/bmad/*`, còn lại → `/*/.crew/workflows/superpowers/*`); assistant nhận
    `$5` tùy chọn (danh sách BMAD) truyền cho `render-instructions.mjs`; vai khác có `$5` → `die`.
- [ ] **Step 4: Chạy lại** → PASS.
- [ ] **Step 5: Commit** `feat(agents): gắn vai BMAD và danh sách agent BMAD cho Trợ Lý`.

---

### Task 4 (DP-1): Deploy, cài `crew-mac`, dựng agent BMAD cho `repo-a`

**Files:** không file nguồn. Ghi `sdd-ledger.md`, `processes.md`, `reports/dp-1-report.md`.

**Interfaces:**
- Consumes: fork `crew/r2-3` (RV-1 xanh), repo Crew `r2-3` (RV-1 xanh), I8, `probe-report.md` A4 (kho git chung của
  `repo-a`).
- Produces cho AC: id agent BMAD, id environment, id nhãn `bmad`, mốc rollback, thư mục `~/crew-agents/bmad`.

- [ ] **Step 1: Kiểm trước.** `crew/ops/active-runs.sh` rỗng; `ipcs -m`; `crew/release/verify.sh` trên `.worktrees/paperclip-r23-int`
  (`crew/r2-3`) rc 0; ghi ledger.
- [ ] **Step 2: Deploy fork** như DP-1 R2-2 (ledger 00:33): `backup.sh` → `overlay-source.sh <sha>` → `overlay-job.sh` →
  `deploy.sh`; ghi mốc rollback `TS`; kiểm `/api/health` `status ok` đúng commit, `crew.core` `ready`, hai site 200.
  `node crew/release/check-core-hooks.mjs` trên image. Hỏng → `rollback.sh <TS>`. Tag cục bộ `crew/v3.3-rc1`.
- [ ] **Step 3: Cài `crew-mac`** từ `r2-3` lên Mac mini bằng `installCrewMacFrom` (như DP-1 R2-2) khi 0 run active; rồi
  `~/.crew/bin/crew-mac workflows install` (không chạy `setup`); ghi hai dòng `extraArgs`; `crew-mac doctor` phải có
  `bmad-pin`, `agent-uv` ok; `crew-mac workflows list`.
- [ ] **Step 4: Worktree agent BMAD.** Theo A4: `git -C <kho chung repo-a> worktree add --detach ~/crew-agents/bmad origin/HEAD`;
  chép `git config crew-docs.bundle` như worktree reviewer nếu có; `crew-mac workflow-check --root ~/crew-agents/bmad --plugin-dir <pin bmad>`
  thoát 0. Ghi `processes.md` (worktree mới, cách gỡ: `git worktree remove`).
- [ ] **Step 5: Bản ghi trên prod** (mọi body qua `scp` + `api.sh`, không nhúng vào lệnh ssh):
  1. Environment: `GET` environment SSH của reviewer `repo-a` để chép `driver`, secret, `metadata` (`crewLoadGate`,
     `workspaceRealizationMode: in_place`); `POST /api/companies/<TPS>/environments` tên `mac-mini-bmad`,
     `remoteWorkspacePath` = đường tuyệt đối `~/crew-agents/bmad`.
  2. Agent: `POST /api/companies/<TPS>/agents` tên `bmad`, `adapterType: claude_local`,
     `adapterConfig: {command: "<home>/.crew/bin/crew-claude-run", engine: "cli", model: "claude-opus-5", env: {}}`,
     `defaultEnvironmentId` = env vừa tạo, `runtimeConfig`/`maxConcurrentRuns: 1` theo cách agent R1 đang đặt (đọc agent
     executor R1 để chép đúng trường), project `repo-a` nếu agent R1 có gắn project.
  3. `crew/agents/apply-roles.sh agent <bmadId> bmad <pin bmad>`.
  4. `crew/agents/apply-roles.sh agent <assistantId> assistant <pin sp> <executorIds hiện tại> <bmadId>` (danh sách
     executor đọc từ `AGENTS.md` hiện tại của Trợ Lý, mục "Executor của company").
  5. `crew/agents/apply-roles.sh agent <reviewerId> reviewer <pin sp>` (reviewer.md mới).
  6. Nhãn: `POST /api/companies/<TPS>/labels` `{"name":"bmad","color":"#7c3aed"}` nếu chưa có.
  Ghi mọi id vào ledger và `processes.md`.
- [ ] **Step 6: Kiểm.** `GET /api/agents/<bmadId>`: `extraArgs` có `--plugin-dir <pin bmad>`; `AGENTS.md` là `bmad.md`.
  `AGENTS.md` của Trợ Lý có mục `## Agent BMAD của company` với `<bmadId>`. Không tạo issue nào. Ghi
  `reports/dp-1-report.md`.
