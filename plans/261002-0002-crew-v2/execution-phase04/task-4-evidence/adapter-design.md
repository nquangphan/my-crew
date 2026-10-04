# Task4 typed design — đề nghị nội bộ, chưa implementation

Không phải generated protocol. Wire decoder chỉ phát normalized event sau validate đúng pinned schema/declaration và context. Tất cả port dưới đây là dependency trusted capture lúc composition, không caller/model/renderer tự cấp; production absent port default deny. Fake ports chỉ kiểm consumer policy.

PM ruling17:28 đã cho phép thiết kế constructor-captured released-channel port này trong owned adapters. Actual launcher/channel/host wiring chưa được giao ownership; source/TDD/native/model vẫn chưa được cấp slot. Current release proof phải được đọc actual producer, không boolean từ caller.

```ts
type NativeRuntime = 'claude' | 'codex';
type Identity = { sessionId: string; processIdentity: string };
type Lifecycle =
  | { kind: 'unbound' }
  | { kind: 'verified'; pinDigest: string; releaseDigest: string }
  | { kind: 'initializing'; pinDigest: string }
  | { kind: 'ready'; pinDigest: string; inventoryDigest: string }
  | { kind: 'invoking'; pinDigest: string; inputDigest: string }
  | { kind: 'running'; pinDigest: string; identity: Identity; turnId: string | null }
  | { kind: 'terminal'; pinDigest: string; result: 'success' | 'failed' | 'interrupted' }
  | { kind: 'cancel-requested'; pinDigest: string; requestDigest: string }
  | { kind: 'uncertain'; pinDigest: string; reasonCode: string }
  | { kind: 'stopped'; pinDigest: string; stopReceiptDigest: string };
type AdapterEvent =
  | { kind: 'inventory'; digest: string }
  | { kind: 'session'; identity: Identity; turnId: string | null }
  | { kind: 'text'; text: string }
  | { kind: 'tool-request'; transportCallId: string; requestDigest: string }
  | { kind: 'tool-result'; transportCallId: string; resultDigest: string }
  | { kind: 'terminal'; result: 'success' | 'failed' | 'interrupted' }
  | { kind: 'inventory-invalidated' }
  | { kind: 'transport-lost' };
// These are local port proposals, not additions to RuntimeAdapter or vendor RPC.
type ReleasedProcessDescriptor = {
  runtime: NativeRuntime;
  pinDigest: string;
  launchId: string;
  processIdentity: string;
  companionDigest: string;
  entrypoint: { canonicalPath: string; sha256: string; skillName: string };
  workspace: string;
  attemptHome: string;
  binarySha256: string;
  protocolBundleSha256: string;
  configSha256: string;
  releaseReceiptDigest: string;
};
type LogicalOperationResolver = (
  pin: RuntimePin,
  transportCallId: string,
  request: unknown,
) => Promise<{ effect: LogicalEffect; invocation: ToolInvocation } | null>;
```

RuntimePin/LogicalEffect/ToolInvocation trên là accepted contracts imports trong implementation tương lai. Digests không tự cấp authority. Released descriptor phải consume actual sole launcher release/process journal, actual companion bytes/canonical entrypoint và observer context; giá trị object của fixture không thay producer.

## Transitions

1. `unbound` không gửi native bytes. Đối chiếu immutable RuntimePin + same model/runtime/projection + trusted source-to-entrypoint mapping + current release/observer→verified. Không tự mở host journal/launcher/registry thứ hai.
2. `verified→initializing`: chỉ initialize/control/discovery của released exact process. No model input trước ready; disconnect/unsupported schema/unexpected inventory→uncertain/deny.
3. `initializing→ready`: exact inventory/name/path/hash + instruction roots và owned config được audit; Claude init thiếu path/hash cần companion/projection/source authority độc lập. Native init inventory không certify full-tree.
4. `ready→invoking`: reverify entrypoint bytes/current pinned context ngay trước selected skill input; never substitute new current projection. CLI slash existence checked first; Codex skill item exact canonical path. First workflow invocation bootstrap rule đến từ reviewed source recipe, không tự viết role prompt.
5. `invoking→running`: transport acceptance cùng session/turn correlation. start return chỉ báo identity/accepted input; session phải namespace runtime. No capability/result/certificate success ở đây.
6. `running→terminal`: valid terminal same session/current turn + no unresolved tool effect. Native result success là lifecycle observation; product finalize còn Phase08. Failed/interrupted là không success; process may remain alive.
7. Any dispatched state→cancel-requested sau durable cancel request. ACK/completed interrupted giữ stopped:false. exact no-fork/full-tree stop receipt→stopped; lost native witness/fork/timeout→uncertain.
8. Inventory invalidation trước input deny; sau dispatch uncertainty và ngừng input mới, giữ resources/history. Reconnect/reconcile đọc actual attempt/fence/process/pins trước resume. No blind new initialization/spawn replacement.

Internal queue serialize start/input/cancel/checkpoint/reconcile per attempt. Await tool execution không giữ lock mà resolver cần re-enter; reserve/receipt ledger queue giữ order đã accepted. Unknown tool/policy-sensitive event fail closed; additive display-only events chỉ được skip nếu decoder whitelist/schema hiện hành xác nhận không liên quan authority.

## Persistence proposal

Session identity, turn correlation, bounded event cursor, input acceptance, cancel intent, lifecycle result và usage metadata cần durable sink do PM/Phase06/host composition giao. Không tự thêm checkpoint sequence hoặc journal schema mới. Restart có checkpoint receipt nhưng mất process witness vẫn unknown; restore session ID không đủ resume authority. Stderr/raw provider payload không lưu secrets vào evidence; errors fixed codes.

Receipt replay phải trả exact target result đã verifier kiểm qua receipt-reader port; `EffectLedger.reserve` chỉ trả decision, không actual bytes. `EffectLedger.complete` không được gọi chỉ vì native tool event nói completed. Native effect cần target proof/artifact bytes; khi không thể correlate trước effect và trả verified receipt thì native tool variant unavailable. Không tạo effect ID từ toolCallId để lấp logical resolver gap.

## Fixture provenance

Fixtures chia hai loại: (a) actual pinned vendor schema/declaration examples + offline sanitized owned control transcript sau authorization; (b) synthetic typed normalized event sequences để kiểm adapter guards. Ghi `synthetic:true` và source hash cho (b), không gắn tên transcript thật hoặc certificate PASS. Current3 schema lịch sử chỉ dùng historical regression/unsupported-field case; không golden binary-current.

Frame parser cases dùng deterministic chunk cuts cả UTF-8 byte boundaries, oversized single line, fragmented EOF, duplicated RPC ID, response result/error exclusive, wrong thread/turn terminal, server-request pending removal. Không đặt undocumented config/source-control RPC fields vào fixture. Approval tool requests và notification sau tool execute phải phân biệt.

Bounded resources: fake transport in memory không CLI/provider, two exact test files, explicit timeout, no import-side-effect launch, no automatic fixture installer/container. Future actual fixture records nonce/device/inode/UID/command/process/start/fence/pins; cleanup cần genuine stop closure. Unknown retains root receipt, không force-remove.
