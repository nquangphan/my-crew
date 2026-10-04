# Phase04 Task4 — Claude/Codex adapters: static protocol preparation first

Worktree /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew, accepted runtime4db2d9e after independent full+FIX1 SPEC/QUALITYREADY. Actual Phase03 isolation remains native UNVERIFIED; test-only ports never certify production. Primary Superpowers SDD/TDD, no children/Git/index/packages/manifests/shared producer edits. You are not alone: preserve peer files.

Own only runtime/{claude,codex}.ts, test/{claude-adapter,codex-adapter}.test.ts and gateway-runtime.md/gateway-models.md R3 (serial docs edits after PM). Official protocol evidence/brief/report under execution-phase04/task-4-evidence. Before any extra source/support file ask PM for concrete ownership transfer. No host/server/registry/workspace/launcher/RuntimeAdapter contract changes.

FIRST STATIC ONLY: read actual accepted producers/docs and official Claude/Codex primary documentation, compare actual version/schema evidence in execution-phase03; inventory missing current protocol/binary claims without inventing fields. No model, provider, credential, native CLI process, PG, container, install or default runtime invocation. Prepare adapter design, typed event/state machine, tests-first plan and gap matrix; do not write production adapters before meaningful RED and PM serial fixture slot. Static web reads permitted. Do not treat old version evidence as current binary authority. CLI vs SDK option must be pinned and supported, not copied v1 daemon code. Production absence of source/isolation/fulltree/process authority stays defaultdeny. Cancel requested is not OS stopped; resumed session exact runtime/source/projection only. All tools route through accepted ToolPolicy/effect ledger and missing Phase06 logical operation source waits. No role custom prompts; invoke exact source skill.

Read docs/index.md, v2/docs/index.md and owning flows before code. No .codegraph present. Read entire embedded approved task/global contract below and actual runtime DTO. Report task-4-static-report.md with primary URLs, exact producer pointers, unresolved implementation contracts, files planned, bounded evidence needed; no fabricated PASS. PM gives explicit next-step authorization/telemetry and serial heavy slot after static plan.

## Global Constraints

- V2 độc lập trong v2/; không import daemon, prompt role, schema nghiệp vụ hoặc credential v1. Nội dung UI/docs tiếng Việt; identifier/path tiếng Anh; API timestamp UTC ISO, UI Asia/Ho_Chi_Minh.
- Chỉ chạy trên máy đã bind project; không chuyển checkout sang máy khác để tìm model. Cùng model ID ở hai runtime/provider là hai pool entry riêng. Superpowers mặc định, BMAD tùy yêu cầu; process chỉ nạp cặp SourcePin + ProjectionPin của workflow/run đã ghim, không viết prompt role PM/dev/QC riêng. Slot projection null/chưa audit/không certified thì chỉ cặp runtime×workflow đó unavailable.
- Phase02 migration 005, semantics active/uncertain/finalizing/stopped và active_attempt_id guard không sửa. Mất heartbeat/lease/HTTP reply không chứng minh process chết. Claim lại đúng command/processInstanceId hoặc chờ reconcile; không tạo process thứ hai sau lost claim.
- Phase03 GatewayConfig revision áp dụng **hai workflow source và mọi projection non-null**; source switches/model catalogue ở migration 008 và revision riêng. Không nâng applied workflow revision chỉ vì nguồn model đổi. Desired OFF chặn dispatch mới ở server ngay cả khi máy offline; OFF không kill attempt đang chạy. Phase06 permit phải đọc desired source state cùng exact source/projection/report và model choice trong transaction claim.
- Không chạy model có phí, probe credential thật hoặc thay global app/CLI/home trong lúc lập kế hoạch. Khi thực thi phase04, test live chỉ trên checkout scratch, model/provider do owner cho phép, giới hạn số lượt/cost; test mặc định fake/offline.
- Không coi HOME riêng, skills/list, một shell sandbox probe, permissions prompt hoặc allowlist skill là chứng nhận. Claude SDK ghi rõ danh sách skills không ngăn slash-command hay đọc file qua Read/Bash ([skills](https://code.claude.com/docs/en/agent-sdk/skills)). Cần bằng chứng process-wide cho native Read, child, tool, path alias và network.
- Contract phase03 e3d35aa đã sửa tám điểm Important trong plans/261002-0002-crew-v2/execution-phase02/phase-03-plan-review.md ở mức **kế hoạch**: boot-generation heartbeat replay; applied source/projection CAS; launcher spawn handshake; durable HTTP operation journal; sync retry; isolation honest UNVERIFIED; deterministic provenance; owned-path create/delete. Khi phase03 triển khai, phase04 kiểm producer thực tế khớp contract trước khi dùng; không coi review plan là test runtime PASS.
- Không tự phát lệnh deploy/merge; phase08/09 sở hữu merge/deploy/update. Mọi file nguồn mới thuộc v2/docs/flows.yaml và sửa flow page cùng commit; controller serialize manifest/lockfile/index và chạy crew-docs check --staged.


## Task 4: Claude Code và Codex adapters

**Files:** unit 4. **Consumes:** RuntimeAdapter, RuntimePin/Checkpoint, WorkflowRegistry.resolve(source,chosenProjection), certified boundary. **Produces:** ClaudeAdapter và CodexAdapter implement đủ bảy methods. Pin SDK/CLI/binding versions sau khi kiểm license/package/protocol; stdout JSON parser dùng bounded framing. BMAD Claude projection không được dùng thay BMAD Codex projection; Codex slot null khi recipe chưa audit.

- [ ] RED Claude fake stream: init inventory của exact source + Claude projection, expected skill path/version/hash, allowed tools/settingSources/strict MCP đúng; explicit dispatch selected skill, không thành công nếu slash skill không tồn tại; đổi Claude projection hash giữa init và invoke bị deny. Tool events đi ToolPolicy và receipts; session ID có prefix runtime; result success mới là hoàn tất, max-turn/error/cancel/stream disconnect trả uncertain/reconcile. Child kế thừa source/projection pin/isolation; cancel requested không coi OS stopped. Test canary negative native Read/child/cross-skill. Run pnpm --dir v2/gateway test --test-name-pattern='claude adapter'; expected RED.
- [ ] GREEN Claude Agent SDK query hoặc CLI stream-json với owned config và selected bundle; dùng documented settingSources/skills nhưng không dựa chúng để chặn Read/Bash (xem [SDK skills](https://code.claude.com/docs/en/agent-sdk/skills), [sessions](https://code.claude.com/docs/en/agent-sdk/sessions), [sandbox](https://code.claude.com/docs/en/sandboxing)). Ghi sessionId, usage/cost, tool events, init source, status. Resume **chỉ** cùng runtime và same certified pin; cross-runtime lấy Crew checkpoint.
- [ ] RED Codex fake app-server stdio: initialize/initialized, model/list, skills/list(forceReload), thread/start với cwd/policy, turn/start skill item path thuộc exact Codex ProjectionPin; reject instructionSources/skills khác pin hoặc Codex slot null, wrong sourceTreeSha256/manifestSha256; turn/completed status chỉ completed thành công, failed/interrupted không; tool/approval event qua broker, thread/resume chỉ same source+Codex projection+runtime; child/fork policy inheritance. Run pnpm --dir v2/gateway test --test-name-pattern='codex adapter'; expected RED.
- [ ] GREEN Codex app-server stdio process riêng, generated/pinned schema của binary, bounded JSON-RPC request/event cursors; expose model/list như catalogue cần probe entitlement, không hard-code model. Pin skill item path từ Codex projection + verify skills/list/source tree; process sandbox và tool source enforcement vẫn là điều kiện độc lập ([app-server](https://learn.chatgpt.com/docs/app-server)). turn/interrupt xong vẫn cần OS stop proof. Record thread/turn IDs namespaced, config/binary/source/projection hashes.
- [ ] Re-run both suites/typecheck; cập nhật gateway-runtime.md và gateway-models.md. Independent review từng adapter, nhất là init/skill invocation thật và unsupported protocol fields.


## Actual accepted RuntimeAdapter DTO

```ts
import type { Selection } from '../commands/contracts.ts';
import type { ProjectionPin, Runtime, SourcePin } from '../host/status.ts';
import type { AttemptProjectionPin } from '../journal/process-journal.ts';
import type { Capability, ModelKey, ProbeResult } from '../models/contracts.ts';
export type EffectId = string;
export type ModelDispatchChoice = {
  model: ModelKey;
  modelConfigRevision: number;
  probeReceiptId: string;
  probeContextSha256: string;
  certificationReceiptId: string | null;
  required: Capability[];
};
export type RuntimeAdmission =
  | { kind: 'certified'; receiptId: string }
  | { kind: 'test-certification'; challengeId: string; nonce: string };
export type RuntimePin = {
  runId: string;
  attemptId: string;
  commandId: string;
  processInstanceId: string;
  fence: string;
  source: SourcePin;
  projection: ProjectionPin;
  attemptProjection: AttemptProjectionPin;
  selection: Selection;
  modelChoice: ModelDispatchChoice;
  admission: RuntimeAdmission;
  isolationPolicyHash: string;
  workspaceCommit: string;
  credentialRef: string | null;
};
export type RuntimeCheckpoint = {
  sequence: string;
  step: string;
  artifactIds: string[];
  commit: string | null;
  processInstanceId: string;
  sourceTreeSha256: string;
  projectionTreeSha256: string;
  toolReceiptIds: string[];
  logicalEffectIds: EffectId[];
  attachmentIds: string[];
  runtimeSession: { runtime: Runtime; id: string } | null;
};
export type RuntimeInput = { skillName: string; skillPath: string; checkpoint: RuntimeCheckpoint | null };
export type LogicalEffect = {
  effectId: EffectId;
  runId: string;
  stepId: string;
  stepOperationId: string;
  actionKind: string;
  targetIdentity: string;
  preconditionSha256: string;
  state: 'pending' | 'done' | 'uncertain';
  receiptSha256: string | null;
  artifactIds: string[];
};
export type ToolInvocation = {
  attemptId: string;
  fence: string;
  toolCallId: string;
  argsSha256: string;
  effectId: EffectId;
  stepOperationId: string;
};
export type EffectReceipt = { sha256: string; artifactIds: string[] };
export interface EffectLedger {
  reserve(
    effect: LogicalEffect,
    call: ToolInvocation,
  ): Promise<'execute' | 'return-receipt' | 'reconcile' | 'wait'>;
  complete(effectId: EffectId, call: ToolInvocation, receipt: EffectReceipt): Promise<void>;
  reconcile(effectId: EffectId): Promise<'done' | 'pending' | 'uncertain'>;
}
export interface RuntimeAdapter {
  readonly runtime: Runtime;
  inventory(source: SourcePin, projection: ProjectionPin): Promise<ProbeResult[]>;
  prepareIsolation(
    pin: RuntimePin,
  ): Promise<{ policyHash: string; evidenceDigest: string; certified: boolean }>;
  start(pin: RuntimePin, input: RuntimeInput): Promise<{ sessionId: string; processIdentity: string }>;
  sendInput(pin: RuntimePin, input: { text: string; attachmentIds: string[] }): Promise<void>;
  checkpoint(pin: RuntimePin): Promise<RuntimeCheckpoint>;
  cancel(
    pin: RuntimePin,
    reason: 'pause' | 'cancel' | 'timeout',
  ): Promise<{ requested: boolean; stopped: boolean }>;
  reconcile(
    pin: RuntimePin,
  ): Promise<{ observation: 'running' | 'stopped' | 'unknown'; checkpoint: RuntimeCheckpoint | null }>;
}

```
