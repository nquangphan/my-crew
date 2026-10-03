# Ranh giới runtime và receipt của logical effect

## Mục đích

Phase04 Task3 cung cấp hợp đồng adapter chung, companion RuntimePin bền vững trước RELEASE và ledger chống chạy trùng logical effect qua fallback. Production vẫn mặc định từ chối: chưa có binding Phase06, catalogue entrypoint chính thức được host nối, observer admission/certificate và chứng cứ confinement toàn cây. Test protocol không chứng nhận runtime native.

## Điểm vào

- `gateway/src/runtime/launch.ts` → `RuntimeLaunch.open`, `beforeRelease`, `startReleased`.
- `gateway/src/runtime/isolation.ts` → `RuntimeIsolation.withVerified`, `assert`.
- `gateway/src/runtime/effect-ledger.ts` → `DurableEffectLedger.reserve`, `complete`, `reconcile`.
- `gateway/src/runtime/tool-policy.ts` → `ToolPolicy.authorize`.

## Các bước

### Luồng RELEASE

1. `TicketCommandBridge` hiện hữu giữ registry/journal đã bind, reserve exact source/projection và READY trước claim005. Companion007 accepted và current scoped read đi trước callback `beforeRelease` được capture lúc mở bridge; callback nhận clone deep-frozen của actual LaunchRecord, Attempt, companion và command đã đọc từ transport.
2. `RuntimeLaunch.beforeRelease` chạy trong queue riêng, gọi trusted Phase06 binding để nhận RuntimePin/input. Mặc định thiếu binding từ chối. `startReleased` chỉ nhận thao tác trong hook này, không có launcher khác. Nó đối chiếu command/attempt/fence/process/machine, source/projection/selection/modelChoice và certificationAdmission thực tế trong command, cùng exact journal READY và registry.resolve.
3. `skillPath` là projection-relative path; không nhận absolute/đoạn rỗng/`.`/`..`. Catalogue entrypoint trusted được capture riêng và mặc định chưa cấu hình. Catalogue phải bind đúng source tree, projection manifest/tree và derivation hash, ánh xạ `skillName` sang path/hash từ recipe/build mapping đã review. Manifest chứa file không tự cấp quyền entrypoint. Consumer so path, resolve canonical trong chosen projection, chấp nhận internal link chỉ khi đích canonical vẫn thuộc projection và là file có trong manifest, rồi mở no-follow và so size/link count/hash bytes. Receipt lưu canonical absolute path này; Codex adapter sau đó phải so chính xác với item absolute trả từ `skills/list`, không tạo alias hay suy authority từ tên `SKILL.md`.
4. `RuntimeIsolation` mặc định `ISOLATION_NOT_BOUND`. Trusted local observer phải tiêu actual server admission/certificate và kiểm constrained descendants. Exact context gồm source/projection/derivation/binary bytes/policy/OS và fixed-field context hash từ server008. Preflight có FAIL hoặc thiếu full-tree evidence luôn từ chối. Certified cần accepted matching receipt, còn hạn và đủ positive selected/negative unselected init/invoke/native Read/Bash/MCP/child/absolute/dotdot/symlink/hardlink/common-dir/network/toàn cây. Bounded test chỉ nhận challenge `admitted` đúng attempt/command/process/fence/machine/context/nonce, chưa hết hạn, budget hợp lệ và preflight UNVERIFIED; không đổi synthetic PASS thành production authority.
5. Captured concrete `IsolationWorkspace` là bắt buộc; thiếu service hoặc structural fake bị từ chối. Runtime so actual `get(attemptId)` prepared state/ownerCommit/source/projection/workspace/home với RuntimePin và observed preflight, rồi gọi actual `withPrepared` để reverify ownership, Git/config/workspace bytes, pin và closure. Returned record được so lại identity/operationId trong transaction. Observer chạy trước queue để không re-enter isolation; lock order runtime queue → isolation queue → registry read, và giữ qua fsync companion để cleanup không chen giữa verify và ghi pin. Receipt lưu actual operation/identity/workspace/home/ownerCommit/source/projection.
6. Companion riêng `runtime-pins/<launch-hash>.json` ghi exclusive, fsync file và directory trước callback thành công. Nó giữ RuntimePin, input/checkpoint và entrypoint canonical; replay phải cùng bytes, thay credential/model/checkpoint/path bị conflict. Không sửa record journal005/007. Chỉ sau đó bridge gọi chính `Launcher.release` cũ, vẫn recheck companion/current/capacity. Callback throw hoặc trả giá trị không phải void giữ gate đóng, guard/pin retained. Generic bridge không gắn hook vẫn là API producer cũ; host runtime production bắt buộc gắn callback này.

### Logical effect và tool policy

`EffectId` là lowercase hex64 của SHA256 trên canonical JSON array `[runId,stepOperationId,actionKind,targetIdentity,preconditionSha256]`. UUID vẫn dùng cho run/step/attempt/operation; provider call ID và args hash không là logical identity. `RuntimeAdapter` giữ đúng bảy method inventory, prepareIsolation, start, sendInput, checkpoint, cancel, reconcile.

`DurableEffectLedger` dùng AtomicRecords writer lock và queue riêng. Append-only transport binding `(attemptId,fence,toolCallId)` precedes immutable logical intent; intent fsync trước trả `execute`. Same call khác args hoặc same logical effect khác metadata/args trả conflict409. Phase06 operation authorizer mặc định thiếu→wait và không ghi intent. Hai operation khác nhau được phép có cùng args.

Receipt phải được verifier kiểm actual result/artifact bytes trước complete và mỗi lần đọc lại. Receipt exclusive/fsync đi trước trả model; fallback call khác nhận cùng verified receipt. Pending sau crash không trả execute lần nữa: target-specific reconciler có thể cung cấp verified receipt; không có chứng cứ thì append uncertain và trả wait. Chưa có target adapter cho durable remote idempotency; không hỗ trợ tự replay side effect theo key khi chưa có target-specific proof. Không expire intent/uncertain theo TTL, không thả server guard.

`ToolPolicy` là cổng broker: mặc định deny, trusted configuration sở hữu danh sách tool và tập readonly. Caller không được gắn nhãn write thành readonly để bypass ledger. Thiếu stepOperationId/target/precondition→wait, missing effectId→deny trước effect. Native Read/Skill/Bash/MCP/child bypass broker không được coi là đã chặn chỉ bằng policy này.

### Threat model và giới hạn

Same UID, chmod và HOME/config riêng chỉ tổ chức file, không phải security boundary. Current Phase03 preflight vẫn luôn UNVERIFIED khi các phép đo shell sạch vì native invoke/MCP/child/full-tree chưa được chứng minh. RuntimeIsolation không tự tạo certificate hay route GET giả. Server008 chưa có authenticated gateway read admission/certificate endpoint; host composition/Phase06/Task7 phải cung cấp observer trusted dựa trên actual authority. Chưa chạy paid model, owner credential, Keychain hay cập nhật global/native helper.

Checkpoint giữ logical effect IDs/receipt IDs/artifacts/attachments; Task6 fallback và Phase06 chịu trách nhiệm nguồn logical operation, previous terminal/stop proof và chuyển checkpoint hợp lệ. Consumer hiện chỉ nhận checkpoint cùng source/projection đã ghim; không tự cấp quyền chuyển projection qua fallback.

Lock order: bridge queue → runtime companion queue → isolation queue → registry read/own store reads. Callback không gọi lại bridge hoặc journal mutation/transaction, không đảo registry→journal producer order. Ledger queue độc lập; callback authority không được re-enter cùng ledger. Host crash mất observer vẫn UNKNOWN; group empty hoặc hết lease không chứng minh toàn cây dừng.

## Files

- `gateway/src/runtime/{contracts,launch,tool-policy,effect-ledger,isolation}.ts`.
- Additive producer hook ở `gateway/src/execution/ticket-command-bridge.ts`.
- `gateway/test/{runtime-boundary,runtime-crash,runtime-workspace,effect-ledger,isolation-runtime}.test.ts` và `gateway/test/support/runtime-{fixture,pins,crash-worker,workspace}.ts`, `runtime-typecheck.json`.

## Dữ liệu

`runtime-pins` giữ immutable launch identity, RuntimePin, input/checkpoint, entrypoint canonical và actual prepared workspace summary (attempt/operation/identity/root/home/ownerCommit/source/projection). `logical-effects` giữ append-only intent, transport binding, verified receipt và uncertain marker; tất cả records version1, file0600 trong directory0700. Source/record bytes được freeze riêng cho review, không chứa credential plaintext.

## Flow liên quan

`gateway-host` giữ journal/launcher/guard; `gateway-workflows` cung cấp registry và actual prepared workspace; `server-execution` cấp claim/fence; `server-models` sở hữu model choice/admission/certificate authority.

## Tests

Tests dùng actual journal/registry/launcher và protocol transports riêng. SIGKILL tại READY/claim/companion/RuntimePin/authorization/RELEASE giữ one launch, không effect trước RELEASE, thiếu full-tree stopped proof giữ resource/pin. Test-only observer/certificate fixtures không phải native PASS. Frozen verification và resource identities ở `plans/261002-0002-crew-v2/execution-phase04/task-3-evidence`; PM sở hữu manifest/generated mapping và independent review.

`runtime-workspace.test.ts` dùng actual prepared API workspace và actual producer get/withPrepared để chặn wrong commit/attempt/source/projection, observed root/home, unprepared/stale state; cleanup race phải đợi callback ghi pin. Amendment ngày 2026-10-03: historical consumer RED vì thiếu rejection; current frozen six-file affected cover22/22, build/strict/Biome PASS. Historical105 thuộc candidate trước amendment, không cộng dồn hoặc dùng làm full-suite/native certification.
