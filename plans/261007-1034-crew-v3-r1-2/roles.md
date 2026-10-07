# Gói `roles` — instructions executor/reviewer/integrator và script áp vai trò (RO-1)

Fork Paperclip, worktree `.worktrees/paperclip-r12-roles` nhánh `crew/r12-roles` từ `v3`. Model sonnet (phần chữ có thể haiku nếu tách). Chờ PL-2 (mã lỗi, template), SP-3 (pin, wrapper), MC-2 (crew-docs). Gói chỉ ghi `crew/agents/**`.

## Bối cảnh đã xác minh

- `docs/guides/execution-policy.md` (fork) mục "API Usage": quyết định review/approval phải nằm trong **cùng** `PATCH /api/issues/{id}` với `status` + `comment`; approve = `status: "done"`; request changes = status khác `done` (thường `in_progress`) kèm comment; comment rời (`POST /comments`) không tính là quyết định.
- `PATCH /agents/:id` (`updateAgentSchema`) nhận `metadata`, `adapterConfig`; `PUT /agents/:id/instructions-bundle/file` nhận `{ path, content, clearLegacyPromptTemplate? }`. File mặc định của bundle là `AGENTS.md`.
- Mọi lệnh API trên VPS đi qua `/opt/crew-v3-spike/api.sh` (dùng ở `crew/ops/watch-run.sh`: `./api.sh GET /issues/<id>`). Cú pháp có body chưa xác minh: Step 1 đọc file.
- Interface dùng lại: vai trò `metadata.crewRole`; dòng `crew-commit …`; dòng `crew-docs-check …`; comment `Crew: lần chạy lại`; mã lỗi `crew_gate_blocked`, `crew_policy_locked`, `crew_agent_root_issue`, `crew_role_assignee`; `extraArgs` `["--setting-sources","project,local","--plugin-dir","<pin>"]` (xem [plan.md](plan.md) "Interface").

## Task RO-1

**Files:**
- Create: `crew/agents/executor.md`, `crew/agents/reviewer.md`, `crew/agents/integrator.md`
- Create: `crew/agents/merge-agent-config.mjs`, `crew/agents/merge-agent-config.test.mjs`
- Create: `crew/agents/apply-roles.sh`

**Interfaces:**
- Produces: `mergeAgentConfig(agent: { metadata?: object | null; adapterConfig?: object | null }, role: "executor" | "reviewer" | "integrator", pinDir: string): { metadata: object; adapterConfig: object }`; lệnh VPS `crew/agents/apply-roles.sh <agentId> <role> <pinDir>` (AC-2 dùng).

- [ ] **Step 1: Đọc `api.sh` thật** — `ssh nhamoiplatform 'cat /opt/crew-v3-spike/api.sh'` (chỉ đọc). Ghi vào báo cáo: cú pháp gửi body JSON (đối số thứ ba, stdin hay `-d`). Dùng đúng cú pháp đó trong Step 6.

- [ ] **Step 2: Test thất bại** `crew/agents/merge-agent-config.test.mjs`

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeAgentConfig } from "./merge-agent-config.mjs";

const PIN = "/Users/a/.crew/workflows/superpowers/6.4.1-5bf4e7801107";

test("reviewer: đặt crewRole, thay cờ setting-sources/plugin-dir cũ, giữ cấu hình khác", () => {
  const agent = {
    metadata: { note: "giữ" },
    adapterConfig: { command: "/Users/a/.crew/bin/crew-claude-run", extraArgs: ["--setting-sources", "project,local", "--plugin-dir", "/old", "--verbose"] },
  };
  assert.deepEqual(mergeAgentConfig(agent, "reviewer", PIN), {
    metadata: { note: "giữ", crewRole: "reviewer" },
    adapterConfig: {
      command: "/Users/a/.crew/bin/crew-claude-run",
      extraArgs: ["--verbose", "--setting-sources", "project,local", "--plugin-dir", PIN],
    },
  });
});

test("executor: bỏ crewRole nếu có", () => {
  const out = mergeAgentConfig({ metadata: { crewRole: "integrator" }, adapterConfig: null }, "executor", PIN);
  assert.deepEqual(out.metadata, {});
  assert.deepEqual(out.adapterConfig.extraArgs, ["--setting-sources", "project,local", "--plugin-dir", PIN]);
});

test("từ chối vai trò lạ và pin không tuyệt đối", () => {
  assert.throws(() => mergeAgentConfig({}, "owner", PIN), /role/);
  assert.throws(() => mergeAgentConfig({}, "reviewer", "pin"), /absolute/);
});
```

- [ ] **Step 3: Chạy, kỳ vọng FAIL**

Run: `node --test crew/agents/merge-agent-config.test.mjs`
Expected: FAIL `Cannot find module …/merge-agent-config.mjs`.

- [ ] **Step 4: Viết `crew/agents/merge-agent-config.mjs`**

```js
#!/usr/bin/env node
// Reads a Paperclip agent JSON on stdin and prints the PATCH /agents/:id body for a Crew role.
// Usage: merge-agent-config.mjs <executor|reviewer|integrator> <pinned plugin dir>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROLES = new Set(["executor", "reviewer", "integrator"]);
const OWNED_FLAGS = new Set(["--setting-sources", "--plugin-dir"]);

export function mergeAgentConfig(agent, role, pinDir) {
  if (!ROLES.has(role)) throw new Error(`unknown role: ${role}`);
  if (!pinDir.startsWith("/")) throw new Error(`pin dir must be absolute: ${pinDir}`);
  const metadata = { ...(agent.metadata ?? {}) };
  if (role === "executor") delete metadata.crewRole;
  else metadata.crewRole = role;
  const adapterConfig = { ...(agent.adapterConfig ?? {}) };
  const previous = Array.isArray(adapterConfig.extraArgs) ? adapterConfig.extraArgs : [];
  const kept = [];
  for (let i = 0; i < previous.length; i++) {
    if (OWNED_FLAGS.has(previous[i])) {
      i++;
      continue;
    }
    kept.push(previous[i]);
  }
  adapterConfig.extraArgs = [...kept, "--setting-sources", "project,local", "--plugin-dir", pinDir];
  return { metadata, adapterConfig };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [role, pinDir] = process.argv.slice(2);
  const agent = JSON.parse(readFileSync(0, "utf8"));
  process.stdout.write(JSON.stringify(mergeAgentConfig(agent, role, pinDir)));
}
```

- [ ] **Step 5: Chạy, kỳ vọng PASS**

Run: `node --test crew/agents/merge-agent-config.test.mjs`
Expected: PASS (3 test).

- [ ] **Step 6: Viết `crew/agents/apply-roles.sh`** (body JSON truyền theo cú pháp đọc được ở Step 1; dưới đây giả định đối số thứ ba của `api.sh`)

```bash
#!/bin/bash
# Applies a Crew role to a Paperclip agent on the crew-v3-spike server: metadata.crewRole, the pinned
# Superpowers flags in adapterConfig.extraArgs, and the role's AGENTS.md instructions.
# Run on the VPS. Usage: apply-roles.sh <agentId> <executor|reviewer|integrator> <pinned plugin dir on the Mac>
set -euo pipefail
ROOT=/opt/crew-v3-spike
HERE=$(cd "$(dirname "$0")" && pwd -P)
AGENT=$1; ROLE=$2; PIN=$3
case "$ROLE" in executor|reviewer|integrator) ;; *) echo "apply-roles: role must be executor, reviewer or integrator" >&2; exit 2;; esac
case "$PIN" in /*/.crew/workflows/superpowers/*) ;; *) echo "apply-roles: pin dir must be <home>/.crew/workflows/superpowers/<version>-<rev>" >&2; exit 2;; esac
[ -f "$HERE/$ROLE.md" ] || { echo "apply-roles: missing $HERE/$ROLE.md" >&2; exit 2; }
BODY=$("$ROOT/api.sh" GET "/agents/$AGENT" | node "$HERE/merge-agent-config.mjs" "$ROLE" "$PIN")
"$ROOT/api.sh" PATCH "/agents/$AGENT" "$BODY" >/dev/null
FILE=$(node -e 'process.stdout.write(JSON.stringify({ path: "AGENTS.md", content: require("fs").readFileSync(process.argv[1], "utf8") }))' "$HERE/$ROLE.md")
"$ROOT/api.sh" PUT "/agents/$AGENT/instructions-bundle/file" "$FILE" >/dev/null
"$ROOT/api.sh" GET "/agents/$AGENT" | node -e 'const a = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(`apply-roles: ${a.name} crewRole=${a.metadata?.crewRole ?? "-"} extraArgs=${JSON.stringify(a.adapterConfig?.extraArgs ?? [])}`)'
```

Nếu VPS không có `node` ngoài container, chạy hai lệnh `node` qua `docker exec -i crew-v3-spike-server-1 node …` và ghi lệch vào báo cáo. `bash -n crew/agents/apply-roles.sh` phải sạch.

- [ ] **Step 7: Viết ba file instructions** (nội dung dưới đây là bản cuối; tiếng Việt, identifier tiếng Anh)

`crew/agents/executor.md`:

````markdown
# Executor (Crew)

Bạn làm một issue trên Mac của owner, trong git worktree riêng của bạn (thư mục làm việc hiện tại). Server ép mọi gate; đừng thử lách, mọi đường lách đều bị 422.

## Trước khi làm
1. Đọc issue, mô tả, acceptance criteria và toàn bộ comment. Comment bắt đầu bằng `Crew: lần chạy lại` nghĩa là run trước của bạn mất kết nối sau khi đã commit: chạy `git show --stat <sha>` cho từng commit được liệt kê, giữ những gì đã đúng, chỉ làm phần còn thiếu. Không làm lại, không commit trùng nội dung.
2. Comment `Reviewer: cần sửa` / `Integrator: cần sửa` là vòng sửa: chỉ sửa đúng các điểm được nêu.

## Cách làm
- Dùng skill `superpowers:test-driven-development` cho mọi thay đổi code, `superpowers:systematic-debugging` khi gặp lỗi chưa rõ nguyên nhân, `superpowers:verification-before-completion` trước khi báo xong. Issue đã có plan thì làm theo plan, không brainstorm lại.
- Làm trên nhánh `crew/<identifier của issue>` (tạo từ nhánh mặc định của repo nếu chưa có: `git switch -c crew/<identifier> <nhánh mặc định>`).
- Test theo tầng task: chỉ test của file/module bạn đổi, test mới cho acceptance criteria, typecheck package bị đổi. Không chạy full suite, không E2E.
- Repo có git hook (ví dụ `crew-docs check --staged`) mà hook chặn commit: sửa đúng điều hook yêu cầu. Không dùng `--no-verify`.
- Không sửa `executionPolicy`, không tạo issue gốc. Chỉ tạo issue con khi issue yêu cầu; server tự gắn policy, không gửi `executionPolicy`, không giao cho agent reviewer/integrator.

## Báo xong
1. Commit, rồi comment (một comment) có dòng đúng định dạng:
   `crew-commit sha=<git rev-parse HEAD> branch=crew/<identifier> tests=<lệnh test đã chạy> result=pass`
   kèm 2–5 dòng tóm tắt thay đổi.
2. `PATCH /api/issues/<id>` với `{"status":"done","comment":"Executor: xong, chờ review."}`. Server chuyển sang `in_review` và giao reviewer; đó là bình thường.
3. Server trả 422 `crew_gate_blocked`/`crew_policy_locked`: đọc `violations`, dừng và comment lại nguyên văn; không thử đường khác.
````

`crew/agents/reviewer.md`:

````markdown
# Reviewer (Crew)

Bạn review việc của agent khác. Server không cho bạn duyệt việc chính bạn làm; nếu issue giao cho bạn mà bạn là người thực thi, dừng và comment.

## Cách review
1. Đọc issue và comment `crew-commit sha=… branch=…` mới nhất của executor. Worktree của bạn dùng chung kho git với executor: `git show --stat <sha>`, `git diff $(git merge-base <nhánh mặc định> <sha>)..<sha>`.
2. Dùng checklist của skill `superpowers:requesting-code-review` (đúng yêu cầu, test thật sự kiểm tiêu chí, lỗi biên, đặt tên, không thừa phạm vi). Đọc log test executor ghi; chỉ chạy lại test khi log không khớp SHA hoặc bạn nghi ngờ kết quả.
3. Không sửa code của executor, không commit vào nhánh của họ.

## Quyết định (một request, có comment)
- Đạt: `PATCH /api/issues/<id>` `{"status":"done","comment":"Reviewer: approve — <lý do ngắn>"}`.
- Cần sửa: `PATCH /api/issues/<id>` `{"status":"in_progress","comment":"Reviewer: cần sửa — <danh sách điểm cụ thể, file:dòng>"}`.
- Tối đa 5 vòng; tới vòng thứ 5 server tự giao issue cho owner. Bị 422 khi gửi tiếp thì dừng, không thử lại.
````

`crew/agents/integrator.md`:

````markdown
# Integrator (Crew)

Bạn gộp việc của một yêu cầu, kiểm một lần trên cây đã merge, và ghi bằng chứng docs. Server chặn `done` khi thiếu bằng chứng docs hợp lệ cho đúng merged commit.

## Gộp
1. Đọc issue gốc (stage integrator đang giao cho bạn), mọi issue con của nó và các comment `crew-commit sha=… branch=…` mới nhất (của issue gốc nếu executor làm thẳng issue gốc, hoặc của từng issue con đã `done`).
2. Trong worktree của bạn: `BASE=$(git rev-parse <nhánh mặc định>)`, `git switch -C crew/req/<identifier issue gốc> "$BASE"`, rồi `git merge --no-ff <sha> -m "merge(<identifier>): <tiêu đề issue con>"` theo thứ tự blocker.
3. Conflict: `git merge --abort`, rồi `PATCH /api/issues/<id>` `{"status":"in_progress","comment":"Integrator: cần sửa — conflict ở <file>, giữa <sha A> và <sha B>"}`.

## Kiểm một lần trên cây đã merge
- Dùng `superpowers:verification-before-completion`. Test theo tầng tích hợp: test của các package bị đổi và các package phụ thuộc chúng, một lần. Không chạy package không liên quan.
- Docs: repo có `docs/flows.yaml` thì cập nhật `docs/flows/<id>.md` của mọi flow chứa file đổi (một lần cho cả yêu cầu), commit `docs: …`, rồi:
  `node "$(git config --get crew-docs.bundle)" check --range "$BASE"..HEAD` → mã thoát E.
  Repo không có `docs/flows.yaml` → E=3. Có `docs/flows.yaml` mà không có `crew-docs.bundle` → E=2 (ghi lý do).

## Ghi bằng chứng rồi quyết định
1. `POST /api/issues/<id>/comments`, **dòng đầu đúng định dạng**, sau đó là output trong khối code:
   `crew-docs-check commit=<git rev-parse HEAD> range=<BASE 40 ký tự>..<git rev-parse HEAD> exit=<E>`
2. E=0 hoặc E=3: `PATCH /api/issues/<id>` `{"status":"done","comment":"Integrator: approve — crew/req/<identifier> tại <sha>; test <lệnh>: pass; docs exit <E>"}`. Server chuyển sang stage owner.
3. E=1: sửa docs trên nhánh, commit, chạy lại và ghi comment bằng chứng mới. Không sửa được thì request changes như mục Gộp bước 3.
4. Không merge vào nhánh mặc định, không push. Owner quyết sau khi duyệt.
````

- [ ] **Step 8: Kiểm** — `node --test crew/agents/merge-agent-config.test.mjs`; `bash -n crew/agents/apply-roles.sh`; quét ba file `.md`: dòng mẫu `crew-commit` và `crew-docs-check` khớp regex ở [plan.md](plan.md) (`grep -n "crew-docs-check commit=" crew/agents/integrator.md`).

- [ ] **Step 9: Commit**

```bash
git add crew/agents
git commit -m "docs(crew): role instructions for executor, reviewer and integrator and a script to apply them"
```

## Rủi ro và rollback

| Rủi ro | Khả năng × tác động | Giảm thiểu |
|---|---|---|
| Integrator ghi bằng chứng sai (exit 0 khi thật ra lỗi) | Thấp × Cao | Integrator là agent riêng (O1), executor không viết được comment dưới tên integrator; AC-2 Cổng 2d đối chiếu lại bằng tay một lần |
| Agent đọc instructions nhưng `extraArgs` chưa đổi → wrapper exit 78 | Trung bình × Thấp | Script đặt cả hai cùng lúc; AC-2 kiểm GET agent |
| `PATCH /agents/:id` thay toàn bộ `adapterConfig` | Trung bình × Trung bình | Script GET rồi merge, giữ mọi khóa khác |

Rollback: chạy lại `apply-roles.sh` với file instructions cũ, hoặc PATCH agent bỏ `crewRole`/`extraArgs` qua `api.sh`.
