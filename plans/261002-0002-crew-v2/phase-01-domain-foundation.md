# Crew v2 Domain Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Xây thư viện miền độc lập kiểm chứng quy tắc ticket, eligibility model/workflow và completion docs cho v2.

**Architecture:** Thư viện hàm thuần trong workspace `v2/`, không import code v1. Server/host/UI ở các phần sau gọi các hàm này; transaction, lease và validation mạng thuộc server, không giả lập chúng bằng Map trong phần này.

**Tech Stack:** TypeScript với cú pháp erasable, Node >=24.12, pnpm 10.32.1; node:test và assert tích hợp. Node thực thi TS bằng type stripping nhưng không typecheck: https://nodejs.org/api/typescript.html. Compiler là TypeScript 7.0.2 và @types/node 26.6.3, phiên bản hiện đã có trong checkout.

**Spec:** [/Users/phannhatquang/Documents/projects/crew/docs/superpowers/specs/2026-10-01-crew-v2-design.md](/Users/phannhatquang/Documents/projects/crew/docs/superpowers/specs/2026-10-01-crew-v2-design.md). Phạm vi chỉ phần 01 trong [lộ trình](plan.md).

## Global Constraints

- “Ban đầu chỉ một owner.”
- “Web chạy trên VPS; app local chỉ hỗ trợ macOS.”
- “Mỗi dự án gắn đúng một máy thực thi.”
- “Superpowers là mặc định khi owner không chỉ định”.
- “Mỗi run ghim workflow, version và revision ngay từ đầu.”
- “Tối đa 5 vòng sửa và kiểm tra lại cho cùng bước kiểm tra”.
- “Kiểm tra dự phòng mỗi 5 phút”.
- “Deploy chỉ chạy khi owner duyệt hành động cụ thể trên web hoặc tạo ticket deploy.”
- Prose/UI tiếng Việt; identifier/path tiếng Anh; không sửa prod hoặc code v1.
- Docs trong `v2/docs/` dùng chuẩn flow v1; cập nhật cùng mỗi commit code.

## Review Focus

1. Một model cùng tên ở máy khác không được dùng cho dự án này — test phần 02.
2. Tắt nguồn hoặc lệch version config khiến pool cũ vẫn hiển thị không được dispatch — test phần 02.
3. Skill cùng tên nhưng khác workflow/revision vẫn phải bị chặn — test phần 03.
4. Mất mạng khi attempt đang chạy không cho retry trực tiếp — test phần 04.
5. Merge đã thành công nhưng docs chưa sync không được đóng ticket cha — test phần 05.

## Cấu trúc file

`v2/package.json` và `v2/tsconfig.json`: package độc lập, strict types.
`v2/src/model-policy.ts`: loại ứng viên không đủ điều kiện; không tự chấm model strength.
`v2/src/workflow-policy.ts`: so sánh hai bộ chuẩn và kiểm tra nguồn skill.
`v2/src/ticket-policy.ts`: transitions và giới hạn vòng sửa.
`v2/src/completion-policy.ts`: gates đóng yêu cầu theo loại artifact.
`v2/test/*.test.ts`: test hành vi từng module.
`v2/docs/index.md`, `architecture.md`, `flows.yaml`, `files.md`, `flows/domain-foundation.md`: docs chuẩn.

Không tạo server, DB, Electron, web, provider client hoặc data mock trong phần này.

### Task 01: Workspace có test chạy độc lập

**Files:** Create `v2/package.json`, `v2/tsconfig.json`, `v2/test/workspace.test.ts`, `v2/docs/index.md`, `v2/docs/architecture.md`, `v2/docs/flows.yaml`, `v2/docs/flows/domain-foundation.md`; Generate `v2/docs/files.md`.
**Interfaces:** Produces scripts `pnpm --dir v2 test` và `pnpm --dir v2 typecheck`.

- [x] Step 1: tạo test, chạy `node --test v2/test/workspace.test.ts`; expected FAIL do package chưa có.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('workspace v2 không có dependency ứng dụng v1', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, '@crew-v2/domain');
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
});
```

- [x] Step 2: tạo package và tsconfig bằng nội dung sau.

```json
{"name":"@crew-v2/domain","private":true,"type":"module","packageManager":"pnpm@10.32.1","engines":{"node":">=24.12"},"scripts":{"test":"node --test test/*.test.ts","typecheck":"tsc --noEmit"},"devDependencies":{"typescript":"7.0.2","@types/node":"26.6.3"}}
```

```json
{"compilerOptions":{"target":"ESNext","module":"NodeNext","strict":true,"noEmit":true,"allowImportingTsExtensions":true,"erasableSyntaxOnly":true,"verbatimModuleSyntax":true},"include":["src/**/*.ts","test/**/*.ts"]}
```

- [x] Step 3: chạy `pnpm --dir v2 install --ignore-workspace`; commit lockfile mới. Expected không sửa pnpm-lock.yaml v1.
- [x] Step 4: tạo docs theo chuẩn đã duyệt. Index mô tả domain library; architecture nêu hàm thuần và server transaction nằm ngoài phần này. Trang flow dùng đúng bảy heading của STANDARD.md, liệt kê từng file/symbol, test và giới hạn.

```yaml
version: 1
source:
  include: [src/**]
  exclude: []
flows:
  domain-foundation:
    title: Hợp đồng miền Crew v2
    doc: docs/flows/domain-foundation.md
    entrypoints: []
    files: []
    tests: [test/workspace.test.ts]
shared: {}
unassigned: []
```

- [x] Step 5: chạy `pnpm --dir v2 test`, `pnpm --dir v2 typecheck`, rồi từ `v2/` chạy `node ../packages/docs-kit/dist/crew-docs.cjs generate` và `check --all`; expected PASS. Bundle v1 chỉ là công cụ kiểm tra tạm lúc phát triển, không dependency runtime v2.
- [x] Step 6: `git add -- v2`; `git diff --cached --check`; `git commit -m "feat(v2): establish independent domain workspace"`.

### Task 02: Model eligibility

**Files:** Create `v2/src/model-policy.ts`, `v2/test/model-policy.test.ts`; Modify `v2/docs/flows.yaml`, `v2/docs/flows/domain-foundation.md`.
**Interfaces:** Consumes Model[] và Selection; produces eligibleModels(models: Model[], policy: Selection): Model[]. Trợ lý tự xếp hạng các ứng viên còn lại, không coi hàm này là toàn bộ chọn model.

- [x] Step 1: ghi test sau vào `v2/test/model-policy.test.ts`.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleModels, type Model, type Selection } from '../src/model-policy.ts';
const model: Model = { id: 'claude:example', machineId: 'm1', runtime: 'claude', available: true, capabilities: ['tools', 'vision'] };
const policy: Selection = { machineId: 'm1', required: ['tools', 'vision'], enabled: { claude: true, codex: true, api: true }, desiredRevision: 2, appliedRevision: 2 };
test('không lấy model cùng tên từ máy khác', () => assert.deepEqual(eligibleModels([{ ...model, machineId: 'm2' }], policy), []));
test('nguồn tắt và config chưa áp dụng không dispatch', () => {
  assert.deepEqual(eligibleModels([model], { ...policy, enabled: { ...policy.enabled, claude: false } }), []);
  assert.deepEqual(eligibleModels([model], { ...policy, appliedRevision: 1 }), []);
});
test('fallback giữ tools và vision, không chọn model thiếu khả năng', () => {
  assert.deepEqual(eligibleModels([{ ...model, capabilities: ['tools'] }, { ...model, available: false }], policy), []);
  assert.deepEqual(eligibleModels([model], policy), [model]);
});
```

- [x] Step 2: `node --test v2/test/model-policy.test.ts`; expected FAIL module chưa tồn tại. Không chấp nhận syntax error làm bằng chứng red.
- [x] Step 3: ghi nội dung sau vào `v2/src/model-policy.ts`.

```ts
export type Runtime = 'claude' | 'codex' | 'api';
export type Model = { id: string; machineId: string; runtime: Runtime; available: boolean; capabilities: string[] };
export type Selection = { machineId: string; required: string[]; enabled: Record<Runtime, boolean>; desiredRevision: number; appliedRevision: number };
export function eligibleModels(models: Model[], policy: Selection): Model[] {
  if (policy.desiredRevision !== policy.appliedRevision) return [];
  return models.filter(m => m.machineId === policy.machineId && m.available && policy.enabled[m.runtime]
    && policy.required.every(c => m.capabilities.includes(c)));
}
```

- [x] Step 4: thêm `src/model-policy.ts` vào files và `test/model-policy.test.ts` vào tests của flow domain-foundation. Cập nhật các bước, bảng Files và Tests bằng tên hàm và hành vi thực tế ở trên; giữ các heading chuẩn. Chạy generate trong v2.
- [x] Step 5: `node --test v2/test/model-policy.test.ts`, `pnpm --dir v2 typecheck`, `pnpm --dir v2 test`; expected tất cả PASS. Chạy `node ../packages/docs-kit/dist/crew-docs.cjs check --all` từ v2.
- [x] Step 6: `git add -- v2/src/model-policy.ts v2/test/model-policy.test.ts v2/docs`; `git diff --cached --check`; `git commit -m "feat(v2): add model-policy"`.

### Task 03: Workflow pin và skill provenance

**Files:** Create `v2/src/workflow-policy.ts`, `v2/test/workflow-policy.test.ts`; Modify `v2/docs/flows.yaml`, `v2/docs/flows/domain-foundation.md`.
**Interfaces:** Consumes Pin; produces samePin, workflowsReady(required: Pin[], installed: Pin[]): boolean và assertSkillAllowed(run: Pin, origin: Pin): void. Chỉ là contract gate, không thay kiểm soát skill loader của runtime ở phần 03 lộ trình.

- [x] Step 1: ghi test sau vào `v2/test/workflow-policy.test.ts`.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowsReady, assertSkillAllowed, type Pin } from '../src/workflow-policy.ts';
const sp: Pin = { workflow: 'superpowers', version: '6.4.1', revision: 'sp-rev', checksum: 'sp-check' };
const bm: Pin = { workflow: 'bmad', version: 'test-version', revision: 'bm-rev', checksum: 'bm-check' };
test('cần đủ hai bộ đúng version revision checksum', () => {
  assert.equal(workflowsReady([sp, bm], [sp]), false);
  assert.equal(workflowsReady([sp, bm], [sp, { ...bm, checksum: 'different' }]), false);
  assert.equal(workflowsReady([sp, bm], [sp, bm]), true);
  assert.equal(workflowsReady([sp, sp, bm], [sp, bm]), false);
});
test('skill bộ khác hoặc revision khác bị chặn, kể cả khi tên skill giống', () => {
  assert.throws(() => assertSkillAllowed(sp, bm), /WORKFLOW_SOURCE_MISMATCH/);
  assert.throws(() => assertSkillAllowed(sp, { ...sp, revision: 'new' }), /WORKFLOW_SOURCE_MISMATCH/);
  assert.doesNotThrow(() => assertSkillAllowed(sp, { ...sp }));
});
```

- [x] Step 2: `node --test v2/test/workflow-policy.test.ts`; expected FAIL module chưa tồn tại. Không chấp nhận syntax error làm bằng chứng red.
- [x] Step 3: ghi nội dung sau vào `v2/src/workflow-policy.ts`.

```ts
export type Workflow = 'bmad' | 'superpowers';
export type Pin = { workflow: Workflow; version: string; revision: string; checksum: string };
export function samePin(a: Pin, b: Pin): boolean {
  return a.workflow === b.workflow && a.version === b.version && a.revision === b.revision && a.checksum === b.checksum;
}
export function workflowsReady(required: Pin[], installed: Pin[]): boolean {
  return (['bmad', 'superpowers'] as Workflow[]).every(name => {
    const targets = required.filter(p => p.workflow === name);
    return targets.length === 1 && installed.some(p => samePin(p, targets[0]!));
  });
}
export function assertSkillAllowed(run: Pin, origin: Pin): void {
  if (!samePin(run, origin)) throw new Error('WORKFLOW_SOURCE_MISMATCH');
}
```

- [x] Step 4: thêm `src/workflow-policy.ts` vào files và `test/workflow-policy.test.ts` vào tests của flow domain-foundation. Cập nhật các bước, bảng Files và Tests bằng tên hàm và hành vi thực tế ở trên; giữ các heading chuẩn. Chạy generate trong v2.
- [x] Step 5: `node --test v2/test/workflow-policy.test.ts`, `pnpm --dir v2 typecheck`, `pnpm --dir v2 test`; expected tất cả PASS. Chạy `node ../packages/docs-kit/dist/crew-docs.cjs check --all` từ v2.
- [x] Step 6: `git add -- v2/src/workflow-policy.ts v2/test/workflow-policy.test.ts v2/docs`; `git diff --cached --check`; `git commit -m "feat(v2): add workflow-policy"`.

### Task 04: Ticket transitions và năm vòng sửa

**Files:** Create `v2/src/ticket-policy.ts`, `v2/test/ticket-policy.test.ts`; Modify `v2/docs/flows.yaml`, `v2/docs/flows/domain-foundation.md`.
**Interfaces:** Consumes Status/Signal; produces transition(status: Status, signal: Signal): Status và recordRepairFailure(number). Caller chỉ phát signal confirmed/passed sau kiểm chứng, kiểm tra dependency và lease trong transaction server; chưa triển khai transaction ở phần này.

- [x] Step 1: ghi test sau vào `v2/test/ticket-policy.test.ts`.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { transition, recordRepairFailure } from '../src/ticket-policy.ts';
test('mất mạng không đủ để running được start hoặc resume lần nữa', () => {
  assert.throws(() => transition('running', 'start'), /INVALID_TICKET_TRANSITION/);
  assert.throws(() => transition('running', 'resume'), /INVALID_TICKET_TRANSITION/);
  assert.equal(transition('running', 'reconciled_stopped'), 'pending');
});
test('pause chỉ xác nhận sau dừng, resume phải đánh giá điều kiện lại', () => {
  assert.equal(transition('running', 'pause_confirmed'), 'paused');
  assert.equal(transition('paused', 'resume'), 'pending');
  assert.throws(() => transition('done', 'start'), /INVALID_TICKET_TRANSITION/);
});
test('thất bại vòng năm hỏi owner, không vượt hoặc reset bộ đếm', () => {
  assert.deepEqual(recordRepairFailure(3), { cycles: 4, action: 'repair' });
  assert.deepEqual(recordRepairFailure(4), { cycles: 5, action: 'ask_owner' });
  assert.deepEqual(recordRepairFailure(5), { cycles: 5, action: 'ask_owner' });
  assert.throws(() => recordRepairFailure(-1), /INVALID_REPAIR_COUNT/);
});
```

- [x] Step 2: `node --test v2/test/ticket-policy.test.ts`; expected FAIL module chưa tồn tại. Không chấp nhận syntax error làm bằng chứng red.
- [x] Step 3: ghi nội dung sau vào `v2/src/ticket-policy.ts`.

```ts
export type Status = 'pending' | 'ready' | 'running' | 'needs_input' | 'paused' | 'done' | 'cancelled';
export type Signal = 'dependencies_ready' | 'start' | 'wait_owner' | 'pause_confirmed' | 'cancel_confirmed' | 'resume' | 'reconciled_stopped' | 'passed';
export function transition(status: Status, signal: Signal): Status {
  const edges: Partial<Record<Status, Partial<Record<Signal, Status>>>> = {
    pending: { dependencies_ready: 'ready', wait_owner: 'needs_input', pause_confirmed: 'paused', cancel_confirmed: 'cancelled' },
    ready: { start: 'running', wait_owner: 'needs_input', pause_confirmed: 'paused', cancel_confirmed: 'cancelled' },
    running: { wait_owner: 'needs_input', pause_confirmed: 'paused', cancel_confirmed: 'cancelled', reconciled_stopped: 'pending', passed: 'done' },
    needs_input: { resume: 'pending', cancel_confirmed: 'cancelled' },
    paused: { resume: 'pending', cancel_confirmed: 'cancelled' }
  };
  const next = edges[status]?.[signal];
  if (!next) throw new Error('INVALID_TICKET_TRANSITION');
  return next;
}
export function recordRepairFailure(completedCycles: number): { cycles: number; action: 'repair' | 'ask_owner' } {
  if (!Number.isInteger(completedCycles) || completedCycles < 0 || completedCycles > 5) throw new Error('INVALID_REPAIR_COUNT');
  const cycles = Math.min(5, completedCycles + 1);
  return { cycles, action: cycles === 5 ? 'ask_owner' : 'repair' };
}
```

- [x] Step 4: thêm `src/ticket-policy.ts` vào files và `test/ticket-policy.test.ts` vào tests của flow domain-foundation. Cập nhật các bước, bảng Files và Tests bằng tên hàm và hành vi thực tế ở trên; giữ các heading chuẩn. Chạy generate trong v2.
- [x] Step 5: `node --test v2/test/ticket-policy.test.ts`, `pnpm --dir v2 typecheck`, `pnpm --dir v2 test`; expected tất cả PASS. Chạy `node ../packages/docs-kit/dist/crew-docs.cjs check --all` từ v2.
- [x] Step 6: `git add -- v2/src/ticket-policy.ts v2/test/ticket-policy.test.ts v2/docs`; `git diff --cached --check`; `git commit -m "feat(v2): add ticket-policy"`.

### Task 05: Completion gate theo docs commit và approval deploy

**Files:** Create `v2/src/completion-policy.ts`, `v2/test/completion-policy.test.ts`; Modify `v2/docs/flows.yaml`, `v2/docs/flows/domain-foundation.md`.
**Interfaces:** Consumes Completion; produces canComplete(input: Completion): boolean và canDeploy({hasDeployTicket, ownerApproved}): boolean. Server xác thực nguồn approval, artifact và commits; không tin các boolean do client tùy ý gửi.

- [x] Step 1: ghi test sau vào `v2/test/completion-policy.test.ts`.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { canComplete, canDeploy, type Completion } from '../src/completion-policy.ts';
const request: Completion = { kind: 'code', mandatoryStepsPassed: true, evidenceReady: true, mergedCommit: 'merge-sha', docsCommit: 'old-sha' };
test('merge xong nhưng docs chưa sync không đóng yêu cầu', () => {
  assert.equal(canComplete(request), false);
  assert.equal(canComplete({ ...request, docsCommit: 'merge-sha' }), true);
  assert.equal(canComplete({ ...request, mergedCommit: null, docsCommit: null }), false);
});
test('research không bắt buộc merge nhưng phải có artifact và đủ bước', () => {
  assert.equal(canComplete({ ...request, kind: 'research', mergedCommit: null, docsCommit: null }), true);
  assert.equal(canComplete({ ...request, kind: 'research', evidenceReady: false }), false);
});
test('deploy phải có approval hoặc ticket riêng, không kế thừa từ hoàn thành feature', () => {
  assert.equal(canDeploy({ hasDeployTicket: false, ownerApproved: false }), false);
  assert.equal(canDeploy({ hasDeployTicket: false, ownerApproved: true }), true);
  assert.equal(canDeploy({ hasDeployTicket: true, ownerApproved: false }), true);
});
```

- [x] Step 2: `node --test v2/test/completion-policy.test.ts`; expected FAIL module chưa tồn tại. Không chấp nhận syntax error làm bằng chứng red.
- [x] Step 3: ghi nội dung sau vào `v2/src/completion-policy.ts`.

```ts
export type Completion = { kind: 'code' | 'research' | 'docs'; mandatoryStepsPassed: boolean; evidenceReady: boolean; mergedCommit: string | null; docsCommit: string | null };
export function canComplete(input: Completion): boolean {
  if (!input.mandatoryStepsPassed || !input.evidenceReady) return false;
  if (input.kind === 'code') return Boolean(input.mergedCommit) && input.docsCommit === input.mergedCommit;
  if (input.kind === 'docs') return Boolean(input.docsCommit);
  return true;
}
export function canDeploy(input: { hasDeployTicket: boolean; ownerApproved: boolean }): boolean {
  return input.hasDeployTicket || input.ownerApproved;
}
```

- [x] Step 4: thêm `src/completion-policy.ts` vào files và `test/completion-policy.test.ts` vào tests của flow domain-foundation. Cập nhật các bước, bảng Files và Tests bằng tên hàm và hành vi thực tế ở trên; giữ các heading chuẩn. Chạy generate trong v2.
- [x] Step 5: `node --test v2/test/completion-policy.test.ts`, `pnpm --dir v2 typecheck`, `pnpm --dir v2 test`; expected tất cả PASS. Chạy `node ../packages/docs-kit/dist/crew-docs.cjs check --all` từ v2.
- [x] Step 6: `git add -- v2/src/completion-policy.ts v2/test/completion-policy.test.ts v2/docs`; `git diff --cached --check`; `git commit -m "feat(v2): add completion-policy"`.

## Nghiệm thu phần 01 và self-review

- [x] Chạy đầy đủ test và typecheck riêng v2, validator docs v2; lưu output thật.
- [x] Xác nhận không có import `apps/`, `packages/` hoặc role/schema v1 trong `v2/src`.
- [x] Kiểm tra những gate trên chỉ là hàm miền, chưa quảng cáo app đã chạy được workflow hay đã cách ly runtime.
- [x] Năm Review Focus đều có test cụ thể trong các task 02–05.
- [x] Spec coverage cho phần 01: model/switches ở 02, pin/isolation contract ở 03, trạng thái/năm vòng ở 04,
  completion/docs/deploy policy ở 05. Các yêu cầu persistence, host, UI và provider nằm ở lộ trình, không
  coi là đã triển khai bởi các hàm thuần này.
- [x] Review phần 01 trước khi lập kế hoạch server: thêm command envelope, lease/fencing, event store,
  runtime validation và import docs vào kế hoạch phần 02, không chèn một fake server vào nền tảng.

## Handoff

Owner đã chọn subagent-driven và giao PM quyết định chạy song song theo resource máy. Phần 01 đã
triển khai trên codex/crew-v2-foundation, review từng task và toàn nhánh đạt. Chưa merge/push.
Task02–05 ghi file riêng; PM serialize docs và commit. Các điều chỉnh khi thực thi nằm trong báo cáo nghiệm thu.
