# Crew v2 phase 05 — Attachment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan review:** `phase05-r2-2026-10-02` qua review độc lập; sáu findings và hai notes đã đóng ở mức kế hoạch. Implementation/live tests và producer gates vẫn bắt buộc.

**Goal:** Owner gửi original trước khi có ticket, liên kết nguyên tử với ticket/comment và đọc ảnh/tài liệu qua representation có provenance; retry, cleanup, crash, resume và fallback không làm mất file hoặc suy quyền từ checksum.

**Architecture:** Upload gồm compose session → reserved slot → streaming private stage → durable immutable blob → transaction ticket/comment + toàn bộ links. Server giữ original có owner identity bất biến, quyền project qua link/route và quyền Trợ lý qua grant hẹp; preclaim snapshot cung cấp metadata/capabilities trước quyết định claim. Worker extractor không phụ thuộc model chạy trong container bị giới hạn; gateway chỉ materialize refs đã được server kiểm quyền, rồi runtime policy chọn representation tương thích và giữ manifest trong checkpoint artifact. Status extraction, coverage và receipt model đọc tách riêng, không coi text trích được là toàn bộ nội dung đã được hiểu.

**Tech Stack:** Node >=24.12, TypeScript 7.0.2, pnpm 10.32.1, Fastify 5.12.5, postgres.js 3.4.9/PostgreSQL 18.6 của phase02, node:test; pdfjs-dist 6.3.289, @napi-rs/canvas 1.0.3, yauzl 3.4.0, saxes 6.0.0. Pins/integrity/official evidence và giới hạn tại `plans/reports/research-261002-crew-v2-attachments.md`. Không thêm OCR/model service hoặc dependency UI.

**Spec:** `docs/superpowers/specs/2026-10-01-crew-v2-design.md` mục 4, 7–10, 12; roadmap `plans/261002-0002-crew-v2/plan.md`; frozen contracts phase02/03; phase04 `phase-04-runtime-models.md` đã được controller báo độc lập review đạt/frozen tại `f4d03c0`; vẫn phải kiểm producer thực tế khi tích hợp. Đọc `docs/index.md`, `v2/docs/index.md`, flow page trước source. Không thay frozen phase04 để giải quyết consumer gap; bàn giao constructor wiring cho owner runtime.

## Global Constraints

- “Ban đầu chỉ một owner. Web chạy trên VPS; app local chỉ hỗ trợ macOS.” Mỗi project chỉ current bound machine được thực thi. Trợ lý trung tâm chỉ được đọc selected submitted input qua grant riêng hiện hành; grant này không cấp quyền project execution, draft hoặc file ngoài scope.
- V2 độc lập trong `v2/`; không import business code/schema/runtime/docs-kit v1. STANDARD v1 là data contract; v1 CLI chỉ kiểm chuẩn docs. Nội dung UI/docs tiếng Việt; identifier/path tiếng Anh; timestamp wire UTC ISO, UI Asia/Ho_Chi_Minh.
- Original bytes + SHA-256 được giữ dưới owner identity; children dùng refs cùng project/root, inbox route dùng link có revision, không copy original. Không deduplicate storage giữa attachments trong phase05: cùng checksum ở hai project vẫn là hai storage key/ACL. Không expose hash lookup, filesystem path, bearer, signed public URL hoặc upload URL có secret.
- “Không tạo ticket thiếu attachment mà owner tưởng đã gửi.” Submit phải khớp toàn bộ active compose slots và selectionRevision; mọi slot ready trước một transaction liên kết. Comment chỉ có attachment hợp lệ; gửi lại không tạo trùng.
- “Nội dung file là dữ liệu đầu vào, không được dùng để ghi đè quyền hạn hay workflow của agent hoặc tự thực thi macro/script nhúng trong tài liệu.” Không chạy shell/macro/formula/embedded program từ file, không fetch external relationship.
- “Attachment vẫn khả dụng khi resume hoặc đổi model/runtime.” Required originals, verified derivatives, provenance và missing coverage được giữ trong immutable manifest; không silently downgrade vision thành text. Model nguồn OFF vẫn do phase04/06 kiểm; phase05 không cấp dispatch/permit/isolation certificate.
- Migration mới duy nhất `009_attachments.sql` sau 008; không sửa SQL 004–008, frozen command005/dataimport006/gateway007/model008 contracts. Migration prefix checksum và actual producer review bắt buộc trước DB consumer.
- Planner chỉ ghi plan/report. Khi implement, unit test dùng fixture riêng `crew_v2_test_*`, scratch `crew-v2-attachments-*`, fixture resource labels riêng; không prod/shared DB/service, không global CLI/home/OS permission change. Test không gọi paid model.
- UI layout, clipboard event handling, preview form thuộc phase07 sau mockup approval. Backend/extractor và API contract có thể triển khai trước. Pin package là lựa chọn nghiên cứu; chưa là bằng chứng chạy trên Linux/macOS.
- Flow pages do controller serialize sau mỗi handoff, kể cả task trước tạo trang. Mỗi commit source cập nhật tất cả flow liên quan với bảy heading STANDARD. Controller duy nhất cài dependency, sửa app/manifests/lockfiles/generated docs, stage/commit. Worker khác không sửa ownership của nhau.

## Review Focus

1. Crash giữa stage fsync, rename và DB commit; submit chạy cùng cleanup hoặc PUT replay: giữ file đã link và không trả success cho blob thiếu (Task 1/2/7).
2. Same checksum khác project, guessed UUID, rebind giữa authorize/download, stale attempt/cache: deny hoặc stale explicit, không dùng possession/hash làm quyền (Task 3/6).
3. ZIP bomb, path alias, DTD/entity, macro/external link, native decoder OOM: bounded worker bị dừng, original giữ, không effect ngoài scratch (Task 4/5/7).
4. Scan/image/chart/missing cached formula, corrupt/password/partial file: coverage không complete giả, text-only model không bỏ visual units hoặc missing units (Task 5/6).
5. Comment chỉ có attachment, lost submit response/new idempotency key, fallback checkpoint cũ và comment đến khi running: đúng một comment/event, durable refs và input revision; không duplicate attempt (Task 2/6/7).

---

## File map, ownership và thứ tự tích hợp

Đường dẫn dưới đây từ repo root. Một task chỉ sửa các file liệt kê; controller serialize file chung ở cuối bảng. Tasks 4/5 có thể nghiên cứu fixture độc lập Task2/3 sau contract Task1; DB migration/integration chạy sau actual producer008 được review.

| Task | Create / modify ownership | Đầu ra độc lập / phụ thuộc |
|---|---|---|
| 1 storage | Create `v2/server/migrations/009_attachments.sql`; `v2/server/src/attachments/{contracts,config,storage,staging,receivers}.ts`; `v2/server/test/{attachments-storage,attachments-staging}.test.ts`; `v2/server/test/support/attachments.ts`; `v2/docs/flows/server-attachments.md` | Durable reserve/upload, migration; phase02 DB/journal/auth + migration008 |
| 2 atomic submit | Create `v2/server/src/attachments/{submissions,messages,routing}.ts`; `v2/server/test/{attachments-submissions,attachments-messages,attachments-routing}.test.ts`; modify `v2/server/src/tickets/{contracts,decisions,service}.ts` producer extension only after handoff; `v2/docs/flows/server-tickets.md` | Existing producer review first; Task1 |
| 3 access/API | Create `v2/server/src/attachments/{access,routes,references,grants,snapshots}.ts`; `v2/server/test/{attachments-api,attachments-access,attachments-grants,attachments-snapshots}.test.ts` | API/upload/auth/download, inherited refs; 1/2 + actual execution005 producer |
| 4 worker boundary | Create `v2/server/src/attachments/{jobs,worker-runner,worker-protocol,worker-entry,worker-diagnostic}.ts`; `v2/server/extractor.Dockerfile`; `v2/server/extractor.dockerignore`; `v2/server/test/{attachments-worker,attachments-worker-live}.test.ts`; `v2/docs/flows/attachment-extraction.md` | Bounded job/lease/container result; 1 |
| 5 extractors | Create `v2/server/src/attachments/extract/{index,formats,zip,xml,text,csv,image,pdf,docx,xlsx,verify,yauzl.d}.ts`; `v2/server/test/{attachments-formats,attachments-text-csv,attachments-pdf-image,attachments-ooxml}.unit.test.ts`; `v2/server/test/fixtures/attachments/{make-fixtures.ts,README.md}` | Deterministic coverage/provenance; 1/4 |
| 6 input bridge | Create `v2/server/src/attachments/{manifests,receipts}.ts`; `v2/gateway/src/attachments/{contracts,fetch,materialize,checkpoint,assistant-read,revocation}.ts`; `v2/server/test/attachments-manifests.test.ts`; `v2/gateway/test/{attachment-fetch,attachment-input,attachment-checkpoint}.test.ts`; `v2/docs/flows/gateway-attachments.md` | Phase04/06 handoff; 3/5 |
| 7 recovery/acceptance | Create `v2/server/src/attachments/{cleanup,reconcile}.ts`; `v2/server/test/{attachments-recovery,attachments-acceptance}.test.ts` | Crash/concurrent lifecycle; 1–6 |
| controller integration | Modify `v2/server/src/{app,main}.ts`, `v2/server/src/journal/event-contracts.ts`, `v2/server/{package.json,pnpm-lock.yaml,.env.example}`, `v2/gateway/src/host/*` only actual reviewed entrypoint, `v2/docs/{architecture.md,flows.yaml,index.md,files.md}` | Actual symbol mapping reviewed before touching host entrypoint; explicit adapter-file ownership transfer from phase04 for bridge injection; no concurrent edits |

Task1 sở hữu toàn bộ SQL009, kể cả cột task sau dùng; chỉnh009 phải qua owner/controller trước khi freeze checksum, không sửa migration đã áp dụng. Final test fixtures select `databaseFixture(9)` only when 001–008 actual sources exist/reviewed. Công việc unit test độc lập có thể chạy trước gate này. Planner không thực hiện install hoặc commit.

## Shared types and trust boundaries (Task1 producer)

ID trên wire là UUID; SHA256 là 64 ký tự hex thường; số phải là safe integer. `Actor`, `Db`, `Tx`, `Mutator`, `CreateTicket`, `Ticket`, `Comment` import type có sẵn của server v2. Gateway đối chiếu JSON schema bằng contract fixture có version, không runtime-import server app. `Readonly` đi kèm deep freeze khi khởi tạo; TypeScript một mình không là ranh giới bảo mật.

```ts
export type Id = string;
export type Sha256 = string;
export type UploadState = 'reserved'|'receiving'|'ready'|'rejected'|'abandoned'|'deleting'|'deleted'|'missing';
export type ExtractStatus = 'pending'|'running'|'complete'|'partial'|'encrypted'|'corrupt'|'unsupported'|'blocked'|'failed';
export type Problem = {code:string;message:string;unitIds:string[]};
export type AttachmentRef = {attachmentId:Id;sha256:Sha256;ownerId:'owner'};
export type ComposeTarget = {purpose:'ticket';projectId:Id;ticketId:null} |
  {purpose:'comment';projectId:Id;ticketId:Id} |
  {purpose:'assistant_message';projectId:null;ticketId:null;conversationId:Id};
export type ComposeSession = ComposeTarget & {id:Id;ownerId:'owner';
  revision:number;state:'open'|'submitted'|'abandoned';expiresAt:string};
export type UploadSpec = {composeSessionId:Id;expectedRevision:number;fileName:string;
  declaredMime:string;byteLength:number;sha256:Sha256};
export type Attachment = AttachmentRef & {composeSessionId:Id;fileName:string;mime:string|null;
  byteLength:number;state:UploadState;extraction:ExtractStatus;problems:Problem[]};
export type Selection = {composeSessionId:Id;selectionRevision:number;attachmentIds:Id[]};
export type SourceLocator =
  | {kind:'text';byteStart:number;byteEnd:number;lineStart:number;lineEnd:number}
  | {kind:'pdf';page:number;box:[number,number,number,number];rotation:number}
  | {kind:'image';width:number;height:number;box:[number,number,number,number]}
  | {kind:'docx';part:string;paragraph:number;table:number|null;row:number|null;cell:number|null}
  | {kind:'sheet';part:string;sheet:string;range:string;hidden:boolean}
  | {kind:'csv';rowStart:number;rowEnd:number;columnStart:number;columnEnd:number};
export type CoverageUnit = {id:string;locator:SourceLocator;needs:'text'|'vision';
  state:'available'|'missing';reason:string|null};
export type Derivative = {id:Id;original:AttachmentRef;extractionId:Id;kind:'text'|'image';
  mime:'text/plain'|'image/png';sha256:Sha256;byteLength:number;unitIds:string[];
  verification:'verified'|'failed';extractorVersion:string;configSha256:Sha256};
export type Extraction = {id:Id;original:AttachmentRef;status:ExtractStatus;extractorVersion:string;
  configSha256:Sha256;manifestSha256:Sha256;units:CoverageUnit[];derivatives:Derivative[];
  problems:Problem[];verification:'verified'|'failed'};
export type AttemptReadContext = {projectId:Id;ticketId:Id;attemptId:Id;fence:string;
  processInstanceId:Id;bindingRevision:number};
export type RequiredInput = {original:AttachmentRef;unitIds:string[]};
export type InputManifest = {version:1;id:Id;artifactId:Id;selectionDecisionId:Id;ticketId:Id;inputRevision:string;
  snapshotId:Id;snapshotSha256:Sha256;
  originals:AttachmentRef[];extractions:Extraction[];required:RequiredInput[];
  comments:{id:Id;ticketId:Id;sha256:Sha256}[];
  selectedDerivativeIds:Id[];missing:Problem[];sha256:Sha256};
export type InputReceipt = {manifestId:Id;manifestSha256:Sha256;context:AttemptReadContext;
  runtime:'claude'|'codex'|'api';modelKey:string;consumed:{derivativeId:Id;sha256:Sha256;
  unitIds:string[];modality:'text'|'vision'}[];status:'consumed'|'partial'|'failed';reason:string|null};
export type BlobHandle = {key:string;sha256:Sha256;byteLength:number}; // internal only
export type WorkerResult = {version:1;jobId:Id;generation:string;original:AttachmentRef;
  extractorVersion:string;configSha256:Sha256;status:ExtractStatus;units:CoverageUnit[];
  files:{relativeName:string;kind:'text'|'image';mime:'text/plain'|'image/png';sha256:Sha256;
    byteLength:number;unitIds:string[]}[];problems:Problem[]};
```

`InputManifest.sha256` băm canonical JSON trừ field sha256 của chính nó; extraction manifest dùng cùng quy tắc. Unit nhận diện part/page/region độc lập với cách chia chunk; available nghĩa là có representation, chưa chứng minh nội dung đúng về nghĩa hoặc model đã đọc. `complete` chỉ khi mọi unit đã phát hiện đều available và đã kiểm kê hết cấu trúc; cấu trúc chưa hiểu thêm missing unit rõ ràng. Không có field `fullyRead`. `Problem.code` allowlist below, message fixed Vietnamese server copy; file contents never interpolated into error/event/log.

Attachment config exact defaults, bounded by operator maximum and exposed via GET policy: per file 25 MiB, compose 20 active files/100 MiB reserved sum, owner staging budget 500 MiB (reservation locks owner accounting), stage TTL24h, cleanup grace1h, upload lease2min with server heartbeat every15s/max wall5min, max read64KiB/chunk; worker max1 concurrent/server until telemetry proves configured capacity, 512MiB RAM/512MiB swap total, CPU1, pids32, 120s wall, output100MiB, PDF200 pages at144 DPI with <=20M pixels/page, image <=40M pixels, OOXML <=2000 entries/100MiB expanded/20MiB per entry/ratio100, XML depth64/text node1MiB, CSV <=100k rows/1000 columns/1MiB field, text<=10MiB decoded. Config values hashed and frozen per upload/extraction; runtime dynamic limit changes don't rewrite accepted originals. Extension/type allowlist defaults png/jpeg/pdf/docx/xlsx/csv/txt/md/json/yaml/yml/ts/js/py/sh/css/html/xml/log. HTML/SVG/XML source are text only, never browser inline; SVG upload extension unsupported by default. Unknown extension 415; binary masquerading as text415. PDF có mật khẩu và OOXML có OLE header được giữ original; chỉ gán encrypted khi parser xác nhận password/encryption metadata (OLE phải có EncryptionInfo+EncryptedPackage), OLE khác unsupported; old DOC/XLS unsupported explicitly. Engine missing does not reject original.

## SQL009 and storage protocol

Task1 migration creates the following tables (UUID defaults generated by server, not client storage keys), with FK to projects/tickets/comments/owners as appropriate and index on state/deadline. Use owner actor_id text `'owner'` rather than assuming `owners.id` schema; producer actual identity schema determines FK, no new owner model.

| Table | Required columns/constraints |
|---|---|
| attachment_compose_sessions | id PK, owner_id text CHECK='owner', project_id nullable FK, ticket_id nullable FK, conversation_id nullable FK, purpose CHECK('ticket','comment','assistant_message'), state CHECK, revision int>=1, expires_at, created_at; CHECK exactly matching ComposeTarget tagged union |
| attachment_uploads | id PK, compose_id FK, initial_project_id nullable FK (provenance only), owner_id, file_name, declared_mime, detected_mime, expected_bytes, expected_sha256, storage_key UNIQUE, stage_key UNIQUE, state CHECK, generation bigint, receive_lease_until, receiver_id nullable FK, durable_at, linked_at, quota_released_at nullable, rejection_code, abandoned_at, expires_at, created_at; storage_key server-generated; no checksum UNIQUE |
| attachment_links | id PK, attachment_id FK, project_id FK, ticket_id FK, comment_id nullable FK, message_route_id nullable FK, revoked_at nullable, inherited_from_link_id nullable self FK, created_at; unique(attachment_id,ticket_id,comment_id) NULLS NOT DISTINCT; composite scope verified under lock before insert; deletion RESTRICT |
| attachment_submissions | compose_id PK FK, payload_sha256, target_kind, target_id, response jsonb, created_at; replay forever, no expiry after submit |
| attachment_extractions | id PK, attachment_id FK, original_sha256, extractor_version, config_sha256, status, generation bigint, lease_until, worker_id nullable, manifest jsonb nullable, manifest_sha256 nullable, error_code, created_at, completed_at; unique(attachment_id,extractor_version,config_sha256); original immutable |
| attachment_derivatives | id PK, extraction_id FK, attachment_id FK, blob_key UNIQUE, sha256, byte_length, mime, kind, unit_ids jsonb, verification, created_at; blob references never public |
| attachment_input_manifests | id PK, ticket_id FK, input_revision bigint, canonical jsonb, sha256, evidence_id FK evidence, created_at; unique(ticket_id,input_revision,sha256); immutable |
| attachment_read_receipts | id PK, manifest_id FK, attempt_id FK, fence numeric/string match005, process_instance_id, receipt_sha256, body jsonb, coverage CHECK('all_selected','partial','none'),trust CHECK='reported_transport',created_at; unique(manifest_id,attempt_id,receipt_sha256); accepted by fenced actor only |
| attachment_gc | id PK, attachment_id nullable FK, extraction_id nullable FK, kind CHECK('upload','job_scratch','orphan_derivative'), owned_key UNIQUE, ownership_nonce, state CHECK('candidate','claimed','deleted','failed'), generation bigint, not_before, lease_until, error_code, created_at, deleted_at; idempotent tombstone retained |

DB không lưu đường dẫn tuyệt đối. Keys under storage root are `uploads/<uuid>/original`, `uploads/<uuid>/stage.<generation>`, `derivatives/<attachmentUuid>/<extractionUuid>/<derivativeUuid>`, `jobs/<uuid>/<generation>/...`; validate UUID/numeric path segments and resolve canonical root with no symlink components. Mỗi owned directory có `.owner.json` nonce+resource kind/UUID/generation do parent tạo exclusive/fsync trước bytes; cleanup đối chiếu nonce với journal, không suy ownership từ tên folder. FileName chỉ để hiển thị, bỏ control character, tối đa255 Unicode codepoints; không dùng làm path. Files0600/dirs0700; container input copy read-only with permissions for worker UID, no exposing parent storage root. Download original dùng attachment disposition mã hóa RFC5987, ASCII fallback đã lọc, nosniff, private no-store, không CORS wildcard. Preview chỉ dùng PNG được sinh và kiểm chứng, cùng auth.

State machine, separate DB transactions each use journal mutation lock order when emitting events:

1. JSON reserve under mutator owner/session/revision/accounting locks: create UUID/state reserved, expected bytes/hash, expiry, increment compose revision. Persist intent before disk I/O; reserved bytes count toward quota.
2. PUT acquire per-upload generation lease (CAS) after owner auth và register exact ReceiverRegistration trước mở stage; generation mới chỉ sau WriterStopProof của operation cũ. Own generated stage opened `wx`/O_NOFOLLOW; stream count/hash + magic sample, renew lease with generation check. Reject overflow immediately; short body/hash mismatch marks rejected only if generation current. No DB transaction kept open for network stream.
3. Flush stage file, validate bytes/type, fsync stage and directory. Persist upload state receiving with completed digest checkpoint, rename stage to original using exclusive destination semantics (existing destination must match this upload+hash), fsync directory. Cross-device roots forbidden at startup. Then transaction CAS same generation sets ready/durable_at and releases lease. Normal receive cũng ghi close ACK sau publication và mọi writable handle đã đóng; ready commit giữ exact receiver/generation/proof. Reply201 chỉ sau durable bytes, close proof và ready commit. Crash before ready is repaired by reconcile, never treated as linked.
4. Atomic submit sees ready records and validated durable marker under locks, creates ticket/comment + all links + input revision/event + extraction jobs + submission response in one transaction. Original path already final; no file move in SQL transaction. Quota reservation được release đúng một lần khi submitted retained latch commit hoặc cleanup deleted terminal; không giữ quota đã xóa. Job generation may be queued here; extraction starts after commit.
5. Cleanup claims expired unlinked uploads only after session closure/expiry+grace, không active receiver hoặc đã có WriterStopProof exact generation, không links/manifests/derivatives retained as deliverable. Commit deleting/tombstone before unlink; submit rejects deleting. Recheck under same upload lock. Cleanup IO outside tx then finalize deleted, handle ENOENT idempotently. linked_at cũng được set khi attachment_message commit trước khi có project. Once any linked_at set, automatic original GC permanently disallowed in phase05, even if references later removed; owner deletion policy is out of scope.

Locks: journal advisory replay → global event_cursor → existing ticket root/affected targets nếu có → project row nếu có → conversation/message target + input_revision row → compose row → upload UUID sorted → extraction row. Root/target order cụ thể ở R1 khớp claim; new root chưa tồn tại hoặc project-only upload không có existing ticket lock. Snapshot/claim revalidation giữ cùng root/target/input_revision row; message route khóa existing root/target rồi project đích trước target message, không đảo thứ tự. Background mutation goes through mutator before these rows. Streaming lease heartbeat that never writes event uses only upload row; must not acquire project/event_cursor afterward. Downloader read lease uses short project+attempt snapshot; stream authorization behavior defined Task3. GC cannot delete original with linked_at, so downloads don't need DB tx held during streaming.

Crash reconciliation rules: reserved/no file can expire; stage present/current receiving lease wait; expired receiving lease first prove matching worker/receiver stopped, quarantine stale stages, verify hash; original durable with no ready mark becomes ready only matching intent/hash; ready missing file becomes missing and emits metadata error, never create empty replacement; linked original missing→DATA_LOSS, retain all refs and restore exact hash from backup if available; unexpected file without owned intent/nonce quarantine/report, never broad glob deletion. Worker process unknown→hold scratch lease and report, not cleanup-on-timeout assumption.

### Q3 — Receiver identity, stop proof và giải phóng quota

Production upload storage phase05 chỉ hỗ trợ nhiều server process trên **cùng Linux host, boot/proc namespace và local filesystem** đã khai báo storageHostId; không shared NFS/object mount/off-host failover. Health gate từ chối receiver khi không đọc được native identity/proc namespace hoặc directory durability chưa xác minh. macOS client/gateway không phải upload writer trên VPS; Linux receiver tests chạy trong container riêng. Đây là giới hạn topology cụ thể, không suy lease hết hạn thành process chết.

```ts
export type ServerWriterIdentity={instanceId:Id;storageHostId:Id;linuxBootId:string;
  procNamespaceInode:string;pid:number;startTicks:string};
export type ReceiverRegistration={id:Id;attachmentId:Id;generation:string;identity:ServerWriterIdentity;
  stageKey:string;operationNonce:Id;state:'registered'|'writing'|'closing'|'closed';abortRequested:boolean};
export type WriterStopProof={receiverId:Id;generation:string;kind:'closed-ack'|'native-process-gone';
  identity:ServerWriterIdentity;proofSha256:Sha256;observedAt:string};
export interface ReceiverRegistry {
  register(tx:Tx,attachmentId:Id,generation:string):Promise<ReceiverRegistration>;
  requestAbort(tx:Tx,receiverId:Id):Promise<void>;
  closeAndAcknowledge(receiverId:Id):Promise<WriterStopProof>;
  proveStopped(receiverId:Id):Promise<WriterStopProof|null>;
}
export function createReceiverRegistry(input:{db:Db;storageRoot:string;storageHostId:Id;
  now:()=>Date;identity:ServerWriterIdentity}):ReceiverRegistry;
```

Task1 `receivers.ts` producer và schema009 bổ sung `attachment_server_writers(instance_id PK,storage_host_id,linux_boot_id,proc_namespace_inode,pid,start_ticks,started_at)`; `attachment_receivers(id PK,attachment_id FK,generation,instance_id FK,stage_key UNIQUE,operation_nonce,state,abort_requested,registered_at,closed_ack_sha256,closed_at,stop_proof jsonb)` unique(attachment_id,generation). Upload.receiver_id trỏ exact operation; generation stage path thêm receiver UUID. `createStageServices` nhận `receivers:ReceiverRegistry`; production register lấy identity từ startup reader, không HTTP body. Tiến trình đọc `/proc/self/stat` starttime field22, boot_id và proc namespace inode; parser xử lý comm có dấu cách/ngoặc đúng, không split ngây thơ. Native proof đọc lại pid/stat trong cùng namespace; PID vắng hoặc startTicks khác chứng minh process gốc đã mất; permission failure/unreadable/wrong namespace→unknown. Different boot chỉ là proof nếu storageHostId và attested current host/proc namespace mapping khớp; không dựa vào timestamp/heartbeat.

Trước mở stage FD, receiver row + owner nonce registry được commit/fsync; chỉ process/operation đó giữ quyền ghi generation. Live abort: persist abort_requested, gửi control nội bộ tới instance đúng qua private0600 Unix socket/nonce (không public HTTP); receiver ngừng nhận chunks, abort stream, await pending writes/fsync, đóng **mọi** original/stage writable FD và directory publish handle, đánh dấu operation terminal không callback nào còn publish được, fsync `.closed.json` chứa receiverId/generation/operationNonce/digest rồi đóng ack FD. DB closed ACK chỉ sau bước này; mất DB thì file ack durable phục vụ restart. Close ACK kiểm file owner/no-symlink/nonce/hash và exactly matching operation, không chấp nhận owner/machine client tự gửi. File immutable ACK và row proof giữ cho audit.

Lease chỉ gợi ý “cần đối chiếu”. B không increment sang writer generation mới, không publish stage cũ, không unlink, không giải phóng quota khi A còn alive chưa có closed ACK. Nếu A mất DB, local max wall/abort path cố đóng; B đánh dấu waiting WRITER_STILL_ACTIVE. Nếu A treo thì giữ waiting/hiển thị và operator xử lý exact process; không kill process khác bằng PID đoán. Sau A bị SIGKILL hoặc crash, B proveStopped từ boot/PID/startTicks (mọi FD của process gốc đã đóng), ghi proof rồi mới CAS release receiver/generation, verify hoặc quarantine bytes và retry/cleanup. Late callback của A sau abort-request không được publish nếu operation registry terminal; nếu A chưa ACK thì B vẫn chưa takeover. Ready publication cần current generation+receiver identity và abort_requested=false kiểm ngay trước publish; nếu mất DB thì không publish. Crash trong khoảng check→publish vẫn được độc quyền operation vì B phải có stop proof mới takeover; không có hai writer đè original.

Quota là tổng expected_bytes của upload có quota_released_at IS NULL dưới owner accounting lock; không cần mutable checksum refcount. `quota_released_at` là latch theo upload UUID. Reserve cộng expected_bytes khi latch null. Submitted message/ticket/comment transaction chuyển original thành retained và set latch để loại khỏi tổng; terminal GC deleted transaction set latch nếu null để loại đúng một lần, cùng tombstone commit. Rejected nhưng còn bytes/active writer vẫn chiếm reservation cho tới cleanup terminal; ENOENT+valid stop/ownership proof vẫn finalize deleted và release. Retry cleanup, replay submit và restart không trừ hai lần; source unknown giữ quota để phản ánh storage chưa chắc đã giải phóng. Tests hai process phải chứng minh cả liveness lẫn quota sau dead writer, không dùng fake lease expiry làm stop.

## HTTP contract (Task3 producer, phase07 consumer)

JSON mutation routes require `Idempotency-Key`, owner cookie+Origin+CSRF; unknown fields rejected. Binary PUT dùng cùng cookie/Origin/CSRF; immutable upload UUID + reserved length/SHA256 là khóa replay, không đưa stream vào JSON mutator và không yêu cầu idempotency record cho toàn bytes. Client retry cùng slot bytes; lease generation nội bộ, không nhận client tự cấp. GET authenticates each call. Errors use existing `{error:{code,message,details?}}`, no path/file content in details. All lists <=100/page with ID cursor. UUID validation400, auth401, CSRF403, invisible scope404, revision/hash/lease conflict409, payload limit413, type415, extraction/selection422, storage unavailable503.

| Route | Request → response |
|---|---|
| GET `/v2/attachment-policy` | owner → configured limits, supported MIME/extensions, extraction capabilities, policySha256 |
| POST `/v2/attachment-compose` | ComposeTarget →201 ComposeSession; assistant_message dùng conversationId, projectId/ticketId null trước định tuyến; comment project phải khớp ticket |
| GET `/v2/attachment-compose/:id` | owner-only → session + active Attachment[] + selectionRevision; cannot read another draft via machine |
| POST `/v2/attachment-compose/:id/uploads` | UploadSpec minus composeSessionId →201 `{attachment,selectionRevision}`; reserve retry reuses same slot |
| PUT `/v2/attachment-uploads/:id/content` | application/octet-stream raw bytes matching reserved length/hash →201 Attachment; ready identical retry200 after body hash validation, different bytes409; concurrent receiving409 UPLOAD_BUSY with Retry-After |
| DELETE `/v2/attachment-compose/:id/uploads/:uploadId` | `{expectedRevision}` →200 `{selectionRevision}`; abandon slot only while open, linked409; cancel active receiver via generation revoke, cleanup after stop/lease proof |
| DELETE `/v2/attachment-compose/:id` | `{expectedRevision}` →200 state abandoned; uploaded slots retained until grace |
| POST `/v2/attachment-submissions/tickets` | `{ticket:CreateTicket,selection:Selection,assistantRead?:'selected-inputs'|'none'}` →201 `{ticket:Ticket,attachmentIds:Id[]}`; allow zero attachments; session required for this route |
| POST `/v2/tickets/:id/attachment-comments` | `{text:string,selection:Selection,assistantRead?:'selected-inputs'|'none'}` →201 `{comment:Comment,attachmentIds:Id[]}`; empty/whitespace text allowed only with nonempty active ready set; text<=32768 |
| POST `/v2/tickets/:id/attachment-references` | `{sourceLinkIds:Id[]}` →201 `{linkIds:Id[]}`; owner or authorized machine, all source links ancestor in same project/root; no arbitrary cross-tree copy |
| GET `/v2/tickets/:id/attachments` | owner hoặc current bound project machine → metadata (không cần attempt); Assistant chỉ đọc scoped snapshot bằng grant. Byte route của executor vẫn cần AttemptReadContext |
| GET `/v2/attachments/:id/content` | owner → original stream; machine must use machine path below |
| GET `/v2/attachments/:id/extractions` | owner → immutable extraction metadata and derivative IDs/status |
| GET `/v2/attachments/:id/derivatives/:derivativeId/content` | owner → verified bytes only; derivative must belong original; original blocked/unsafe files never inline |
| POST `/v2/machine/attachment-manifests` | bearer + `{context:AttemptReadContext,decisionId:Id,required:RequiredInput[],inputRevision:string,snapshotId:Id,snapshotSha256:Sha256}` →200 InputManifest; selection computed from known available representations, not caller verified booleans |
| GET `/v2/machine/attachments/:id/content` | bearer + query context, optional `derivativeId`, `manifestId` → bytes; original hash supplied as `If-Match` quoted sha256; wrong ETag412, no Range in phase05 (416) |
| GET `/v2/machine/attachment-manifests/:id` | bearer + query AttemptReadContext → immutable InputManifest sau current gate; manifest ticket/root phải reachable và hash từ evidence khớp, không tự thay bằng latest |
| POST `/v2/machine/attachment-read-receipts` | InputReceipt →201 `{receiptId,coverage,trust:'reported_transport'}`; fenced immutable receipts, missing/invalid selected derivative422 |

Không thêm command type hoặc machine token dùng toàn hệ thống. Postclaim executor APIs kiểm current binding/attempt; metadata snapshot và Assistant grant APIs dùng authority riêng không cần attempt; owner download of unlinked stage requires same compose owner/session, machine never reads unlinked. `comment.created` stays existing metadata `{commentId}`; list/comment read adds attachments via separate API. `attachment.changed` allowlisted metadata `{attachmentId,state,extraction}` project/ticket scoped khi có live link, inbox chưa route owner-only; `attachment.input.changed`/grant revocation gửi đích danh authorized Assistant machine chỉ ID/revision để wake hoặc stop; attachment extraction text cannot become event. New comment's existing event wakes phase06; phase05 never starts attempt.

## Hợp đồng inbox, preclaim và Trợ lý trung tâm (S1–S3)

Các hợp đồng ở mục này là phần của Tasks1/2/3/6, không là quyền mới cho executor. Task1 tạo schema/types; Task2 giữ inbox submit/routing service; Task3 giữ grants/snapshots/access/routes; Task6 giữ representation transport/receipts. Phase06 cung cấp issuer/selection/Assistant session authority qua port có default deny. Không gọi issuer qua nội dung file hoặc dựa vào machine tự khai designation.

### S1 — Owner inbox trước project, routing có revision

```ts
export type InputTarget={kind:'message';messageId:Id} |
  {kind:'ticket';ticketId:Id;projectId:Id};
export type AssistantMessage={id:Id;conversationId:Id;ownerId:'owner';text:string;
  attachmentIds:Id[];inputRevision:string;routeRevision:number;createdAt:string};
export type MessageSubmission={conversationId:Id;clientMessageId:Id;text:string;selection:Selection;
  assistantRead:'selected-inputs'|'none'};
export type MessageRoute={id:Id;messageId:Id;revision:number;projectId:Id;ticketId:Id;
  decisionId:Id;supersedesRouteId:Id|null;revokedAt:string|null};
export type RouteMessageInput={messageId:Id;expectedInputRevision:string;expectedRouteRevision:number;
  decisionId:Id;ticket:CreateTicket};
export type InputRoutingAuthority=(tx:Tx,actor:Actor,input:RouteMessageInput)=>Promise<void>;
export type RouteRetirementAuthority=(tx:Tx,route:MessageRoute,actor:Actor)=>Promise<void>;
export function submitAssistantMessage(tx:Tx,input:MessageSubmission,actor:Actor):Promise<AssistantMessage>;
export function routeAssistantMessage(tx:Tx,input:RouteMessageInput,actor:Actor,
  authority:InputRoutingAuthority,retire:RouteRetirementAuthority):Promise<MessageRoute>;
```

Conversation tạo một lần bởi owner bằng idempotent POST; clientMessageId là UUID client tạo trước submit để reconnect dưới compose/key khác vẫn không nhân đôi message. Transaction submit khóa conversation+compose/uploads; kiểm exact active selection/revision/all-ready như ticket, text rỗng hợp lệ khi có file; ghi message, message links, retained latch `linked_at`, extraction jobs, input_revision=1, immutable owner submission authorization khi assistantRead=selected-inputs, submission response và một event `assistant.message.created {messageId,inputRevision}`. Unique(owner_id,client_message_id) + canonical payload hash (conversationId,text,sorted original IDs/hashes,assistantRead) bắt retry khác compose/key: same payload trả stored response; khác payload409. Session cũ cũng giữ replay response. Gửi message commit không tạo ticket và không đợi đã chọn project. Draft/abandoned compose không cấp grant, không phát event chứa nội dung.

Inbox chưa có ticket nên routing/scope/reply decision được lưu ở `attachment_message_decisions`, không cố ghi phase02 decisions với ticket giả. Phase06 gọi `persistMessageInputDecision(tx:Tx,input:{messageId:Id;inputRevision:string;snapshotId:Id|null;grantId:Id|null;receiptId:Id|null;kind:'routing'|'scope'|'reply';body:Record<string,unknown>},actor:Actor):Promise<Id>` qua authority đã tích hợp; machine routing/reply phải có current grant/snapshot và all-selected delivery receipt, owner explicit route có thể không cần receipt. Scope decision phải ghi exact unit set/rationale và qua selection authority; không cho tự đánh dấu đã đọc. RouteMessageInput.decisionId được lookup trong bảng message decision cùng target/revision. Sau route có ticket thật, phase06 ghi decision/evidence ticket tham chiếu source message decision digest; không thay SourceRef union frozen bằng ID không có record.

Owner authorization có ID riêng, message/ticket target, exact attachment IDs+hashes và phạm vi `submitted-inputs`; không chứa wildcard conversation/project. Message không chỉnh bytes/text tại chỗ; bổ sung thông tin là message mới. `inputRevision` của target tăng khi input mới/extraction status hoặc representation đổi; authorization chỉ cho các original IDs đã submit, issuer có thể tạo grant mới cho snapshot revision mới của đúng tập này. Expiry tối đa24h từ submit, revoke được owner, hết hạn cần owner đọc lại/re-authorize; issuer không tự gia hạn. Submissions ticket/comment cũng có optional assistantRead field ngoài frozen CreateTicket, mặc định none nếu client không gửi; UI phase07 gửi selected-inputs khi owner yêu cầu Trợ lý xử lý nội dung và công bố đúng selected IDs. Đây là authorization owner gửi cùng yêu cầu, không tự suy từ file.

RouteMessage chỉ qua phase06 authority đã xác minh persisted routing decision hoặc owner action; default INPUT_ROUTING_NOT_CONFIGURED. Transaction lock target revision trước khi gọi existing createTicket cùng Tx, tạo current route và ticket attachment links trỏ original IDs, không đổi original/AttachmentRef và không nhân bản binary. Unique(message_id,revision); replay cùng decision+canonical payload trả route cũ. Re-route phải CAS expectedRouteRevision, chờ mọi attempt/read session thuộc route cũ có stopped proof hoặc chưa chạy; running/unknown→409 ROUTE_IN_USE. Tạo ticket mới đúng project bằng existing service, revoke old route links, đánh dấu ticket cũ waiting/needs_input qua service authority được phase02/06 cung cấp (không sửa thẳng workflow state), tăng route/input revision và revoke grants/snapshots route cũ. Audit giữ route/ticket cũ và originals nhưng old project machine mất quyền fetch. Grant Assistant phải cấp lại cho current snapshot; cùng checksum không tạo quyền. Nếu authority đổi trạng thái ticket cũ chưa tích hợp, re-route fail closed ROUTE_CORRECTION_NOT_CONFIGURED, không commit nửa route. Children vẫn chỉ inherit live ancestor links cùng root; route migration không được dùng để copy arbitrary cross-project refs.

### S2 — Snapshot metadata trước claim và compare-and-swap tại claim

```ts
export type SnapshotAccess={kind:'owner'} |
  {kind:'bound-project';projectId:Id;bindingRevision:number} |
  {kind:'assistant-grant';grantId:Id;designationRevision:number};
export type InputSnapshot={version:1;id:Id;target:InputTarget;inputRevision:string;routeRevision:number;
  originals:AttachmentRef[];extractions:Extraction[];required:RequiredInput[];
  comments:{id:Id;ticketId:Id;sha256:Sha256}[];
  selectedDerivativeIds:Id[];requiredCapabilities:('text'|'vision')[];
  state:'ready'|'waiting';problems:Problem[];sha256:Sha256;createdAt:string};
export type DispatchInputPin={snapshotId:Id;snapshotSha256:Sha256;inputRevision:string;
  selectionSha256:Sha256};
export type PreclaimSelectionAuthority=(tx:Tx,actor:Actor,input:{target:InputTarget;
  requestedUnitIds:string[]|null;scopeDecisionId:Id|null})=>Promise<void>;
export function readInputSnapshot(tx:Tx,actor:Actor,input:{target:InputTarget;access:SnapshotAccess;
  expectedInputRevision:string|null;scopeDecisionId:Id|null},selection:PreclaimSelectionAuthority):Promise<InputSnapshot>;
export function assertDispatchInputsCurrent(tx:Tx,input:{commandId:Id;decisionId:Id;
  pin:DispatchInputPin;modelRequired:Capability[]},actor:Actor):Promise<void>;
export function assessSnapshotCapabilities(snapshot:InputSnapshot,capabilities:Capability[]):
  {state:'ready'|'waiting';required:Capability[];problems:Problem[]};
```

Task3 snapshot service trả **metadata**, không bytes/path/token, không cần attempt/fence/RuntimePin. Owner đọc own target; bound-project machine chỉ đọc metadata current linked ticket trong đúng bindingRevision; Assistant chỉ đọc target được grant. Grant bootstrap trước snapshot được issuer tạo từ owner authorization+current target revision, chứa exact original IDs/hashes; sau đó snapshot trả immutable ID/hash và selected units, issuer binds grant vào snapshot bằng CAS một lần. Grant chưa bound snapshot không tải bytes hoặc mở read session. Khi extraction pending, snapshot state waiting và ghi `EXTRACTION_PENDING`, chưa có confirmed capabilities cho units chưa biết; không dispatch để đoán. Ready PDF scan có vision; phase06 chọn eligible model bằng `assessSnapshotCapabilities` trên snapshot, không gọi materialize để biết modality.

Snapshot default bao phủ toàn bộ units của inputs được cấp. Phần thiếu/unsupported là waiting; muốn subset phải có persisted scopeDecisionId do PreclaimSelectionAuthority xác minh rationale+exact unit IDs/hash. Request không có field requiredCapabilities; caller không được tự hạ vision hoặc chọn rỗng. Scope decision tạo dựa trên snapshot metadata đầy đủ, không cần claim; loop này không phụ thuộc model attempt. Phase06 issuer/selection authority có thể chạy controller logic trước model dispatch; mặc định chưa tích hợp thì chặn.

Trước claim, phase06 ghi DispatchInputPin vào command.payload.inputSnapshot và decision.scope.inputSnapshot giống hệt, đồng thời row `attachment_dispatch_inputs(command_id,decision_id,snapshot_id,sha256,input_revision,selection_sha256)`. Không đổi DispatchPermit005, DispatchSelection007 hay ModelDispatchChoice008. `AuthorizeDispatch` phase06 gọi assertDispatchInputsCurrent trong **cùng Tx claim**, cùng lock target revision với mutation input; kiểm row/payload/scope đồng nhất, snapshot current, all required ready, selected hash và choice.required chứa snapshot capabilities, binding/source/projection/model gates frozen giữ nguyên. Comment hoặc extraction completion/re-extraction/re-route sau assessment trước claim tăng input revision; assert409 INPUT_SNAPSHOT_STALE, không claim/launch, đánh giá lại từ snapshot mới. `attachment.input.changed {targetKind,targetId,inputRevision}` chỉ metadata wake phase06, durable journal cursor chống lặp. Sau claim, InputManifest đóng lại đúng snapshot+selection đã pin, chỉ bytes dùng AttemptReadContext; materialization check là kiểm phòng vệ, không phải cách chọn model lần đầu.

### R1 — Một trigger009 bao phủ actual legacy và attachment comment

Task1 sở hữu function/trigger additive trong `009_attachments.sql`; Task2 tickets producer reviewer kiểm rằng cả `appendComment(tx,ticketId,text,actor)` hiện có và attachment-comment method đều INSERT vào `comments` trong caller-owned mutator Tx. Giữ public signature, không sửa004 và không optional fixture hook. Không disable trigger hoặc dùng session flag để né nó. Source `appendComment` không phải tự biết bảng attachment; migration009 bảo đảm mọi actual writer đi qua cùng invariant.

**Scope revision:** snapshot của ticket T chứa text comments của T và toàn bộ ancestor từ root tới T, cùng attachment refs được link/inherit rõ ràng. Không tự đưa comment sibling/descendant vào snapshot T. Comment tại A làm stale A và **mọi descendant hiện tồn tại** của A trong cùng root, dù child chưa có attachment link; sibling subtree không bị bump khi comment ở một child. New child tạo sau comment đọc ancestor history hiện hành khi tạo snapshot đầu, không dùng snapshot trước khi child tồn tại. Project/root identity của ticket không đổi; root lock serialize child creation với fanout comment. Existing ticket rows được backfill revision1 trong009; future target khởi tạo lazy revision1 dưới root lock. Comment đầu nếu row chưa có thì INSERT revision2, tương đương base1+one comment.

```sql
CREATE FUNCTION attachment_comment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root_uuid uuid; affected_ids uuid[];
BEGIN
  SELECT root_id INTO STRICT root_uuid FROM tickets WHERE id=NEW.ticket_id;
  PERFORM 1 FROM tickets WHERE id=root_uuid FOR UPDATE;
  WITH RECURSIVE affected(id) AS (
    SELECT id FROM tickets WHERE id=NEW.ticket_id
    UNION ALL SELECT t.id FROM tickets t JOIN affected a ON t.parent_id=a.id
  ) SELECT array_agg(id ORDER BY id) INTO affected_ids FROM affected;
  PERFORM 1 FROM tickets WHERE id=ANY(affected_ids) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM attachment_input_revisions
    WHERE target_kind='ticket' AND target_id=ANY(affected_ids)
    ORDER BY target_id FOR UPDATE;
  INSERT INTO attachment_input_revisions(target_kind,target_id,revision,route_revision)
    SELECT 'ticket',id,2,0 FROM unnest(affected_ids) AS targets(id) WHERE true
    ON CONFLICT(target_kind,target_id) DO UPDATE
      SET revision=attachment_input_revisions.revision+1;
  RETURN NEW;
END; $$;
CREATE TRIGGER attachment_comments_revision_before_insert
  BEFORE INSERT ON comments FOR EACH ROW EXECUTE FUNCTION attachment_comment_revision();
```

Lock order cho caller mutator: journal replay/event_cursor → root → affected target tickets theo UUID → project nếu cần → input revision rows theo UUID → compose/uploads. Thứ tự root/target trước project khớp actual claim phase02 (command/guard locks giữ nguyên); tạo root hoàn toàn mới mới được lấy project trước vì chưa có root/target chung. Legacy comment trigger lấy root/targets/input trước comment INSERT; attachment wrapper `lockSubmissionScope` phải lấy **cùng affected descendant set** trước compose (không giữ compose rồi mới lần đầu lấy child/input locks trong trigger). Trigger tái lấy khóa đã có là hợp lệ. Claim/Assistant reply publication/snapshot phải khóa root rồi target rồi input row; không chờ root khi đã giữ input row. Child creation giữ existing root lock trước insert; trigger không tự lấy event_cursor sau root. Các mutation public đều chạy mutator như phase02; event journal vẫn một `comment.created` sau insertion trong Tx, rollback link/comment/event cũng rollback counter. Event consumer nhận existing comment.created, resolve A cùng descendant targets rồi wake + reread counter, không bump; không cần trigger phát thêm attachment.input.changed. Consumer bootstrap reread durable revisions nên restart không mất invalidation. Attachment-comment INSERT tạo một bump mỗi affected target; linkSelection/finishSubmission không bump comment lần hai. Extraction hoàn tất sau đó là input mutation khác nên tăng riêng là đúng. Ticket submit không-comment, standalone link/inherit, inbox message, extraction và reroute giữ writer service của chúng, dùng cùng lock rule và chỉ một bump cho chính mutation đó.

Claim và reply được linearize bởi root/input lock: comment commit trước ⇒ old snapshot409; claim/reply commit trước ⇒ hành động được nhận trên revision lúc đó, comment kế tiếp tạo pending-input revision/event và chặn publication tiếp theo từ pin cũ. Không hứa rollback claim đã commit; phase06 giao input mới cho active attempt theo existing policy, không spawn duplicate.

### S3 — Grant hẹp và representation transport trực tiếp tới Trợ lý

```ts
export type OwnerInputAuthorization={id:Id;ownerId:'owner';target:InputTarget;originals:AttachmentRef[];
  allowOriginal:boolean;expiresAt:string;revokedAt:string|null};
export function createInputReadAuthorization(tx:Tx,input:{target:InputTarget;originals:AttachmentRef[];
  allowOriginal:boolean;expiresAt:string},actor:Actor):Promise<OwnerInputAuthorization>;
export type AssistantDesignation={id:Id;ownerId:'owner';machineId:Id;revision:number};
export type AssistantReadGrant={id:Id;authorizationId:Id;target:InputTarget;originals:AttachmentRef[];
  inputRevision:string;routeRevision:number;designationId:Id;designationRevision:number;machineId:Id;
  snapshotId:Id|null;snapshotSha256:Sha256|null;derivativeIds:Id[];allowOriginal:boolean;
  expiresAt:string;revokedAt:string|null};
export type AssistantTurnAdmission={id:Id;admittedAt:string;modelConfigRevision:number;sourceEnabledAtAdmission:true};
export type AssistantReadSession={id:Id;grantId:Id;snapshotId:Id;snapshotSha256:Sha256;admission:AssistantTurnAdmission;
  designationRevision:number;machineId:Id;runtime:'claude'|'codex'|'api';modelKey:string;
  modelSelectionId:Id;policyReceiptId:Id;processInstanceId:Id;state:'reserved'|'running'|'stopped'|'unknown';
  expiresAt:string};
export interface AssistantInputAuthority {
  designation(tx:Tx):Promise<AssistantDesignation|null>;
  authorizeIssue(tx:Tx,actor:Actor,input:{authorizationId:Id;target:InputTarget;inputRevision:string}):Promise<void>;
  authorizeSession(tx:Tx,actor:Actor,input:{grantId:Id;snapshotId:Id;modelSelectionId:Id}):Promise<{
    runtime:'claude'|'codex'|'api';modelKey:string;policyReceiptId:Id;processInstanceId:Id;admission:AssistantTurnAdmission}>;
  assertSessionCurrent(tx:Tx,session:AssistantReadSession):Promise<void>;
}
export function issueAssistantReadGrant(tx:Tx,input:{authorizationId:Id;target:InputTarget;
  inputRevision:string},actor:Actor,authority:AssistantInputAuthority):Promise<AssistantReadGrant>;
export function authorizeAssistantRepresentation(tx:Tx,actor:Actor,input:{sessionId:Id;
  derivativeId:Id|null;attachmentId:Id|null},authority:AssistantInputAuthority):Promise<BlobHandle>;
export function fetchAssistantRepresentation(input:{session:AssistantReadSession;derivative:Derivative}):
  Promise<AsyncIterable<Uint8Array>>; // gateway fetch, always bearer auth and protected route
export function bindGrantSnapshot(tx:Tx,grantId:Id,snapshotId:Id,actor:Actor,
  authority:AssistantInputAuthority):Promise<AssistantReadGrant>;
export function startAssistantReadSession(tx:Tx,input:{grantId:Id;snapshotId:Id;modelSelectionId:Id},
  actor:Actor,authority:AssistantInputAuthority):Promise<AssistantReadSession>;
export type AssistantReadReceipt={sessionId:Id;grantId:Id;snapshotId:Id;snapshotSha256:Sha256;
  runtime:'claude'|'codex'|'api';modelKey:string;delivered:{derivativeId:Id;sha256:Sha256;unitIds:string[];
  modality:'text'|'vision'}[];status:'delivered'|'partial'|'failed';transportEvidenceSha256:Sha256};
export interface AssistantRepresentationTransport {
  deliver(session:AssistantReadSession,snapshot:InputSnapshot,parts:AsyncIterable<{
    original:AttachmentRef;derivative:Derivative;bytes:AsyncIterable<Uint8Array>}>):Promise<AssistantReadReceipt>;
}
```

Phase06 owns actual AssistantInputAuthority implementation và lưu designation revision/modelSelectionId/policyReceiptId/processInstanceId trước session start. Default mỗi method deny ASSISTANT_INPUT_NOT_CONFIGURED; không dùng owner cookie hoặc token proxy trong gateway. Issuer kiểm authorization do owner tạo hoặc owner-submission-authorized còn hạn, chỉ selected **submitted** original IDs, target revision/current designation; không cho machine tạo grant cho bản thân/tự chọn recipient. Owner explicit issue route được phép; issuer tự phục vụ owner submission là internal phase06 service, không exposed generic machine POST grant. Grant ID là lookup không là bearer secret; mọi call cần machine auth khớp designation và grant. Bound-project machine B không nhận quyền của Assistant A; A không được code checkout/claim B bằng grant.

Protocol: owner gửi image-only message chưa project → issuer cấp grant cho current Assistant A → metadata snapshot ready cho biết vision → phase06 lưu eligible runtime/model selection trên A (source enabled, fresh capability/policy evidence) → reserve/start AssistantReadSession trên A → byte GET theo grant/session/snapshot trả đúng selected PNG/text representations → transport chuyển bytes thật tới model A và báo từng unit đã giao. Đây là Trợ lý A đọc representation trực tiếp, không project B đọc rồi tóm tắt. A sau đó chọn project B từ docs+input; B offline không chặn A đọc nếu A/worker còn online, nhưng code execution tại B chờ theo binding rule. A offline/vision không khả dụng/worker pending thì wait, không tự chuyển máy. Direct original download chỉ khi allowOriginal=true và exact original nằm trong grant; model input mặc định dùng verified derivatives, không đưa original unsupported vào model rồi bỏ coverage checks. allowOriginal mặc định false và chỉ owner explicit grant bật; nguyên bản luôn còn cho owner.

Grant snapshot bound một lần, expiresAt=min(owner authorization expiry, issuedAt+15min); session expiresAt<=grant. Designation/input/route revision đổi, explicit owner revoke, pause/cancel hoặc security authority bị thu hồi làm grant/session không còn current và đi revocation/stop protocol. Model-source config revision/OFF một mình không revoke admitted session; R2 bên dưới phân biệt admission mới với lượt hiện tại. Phase06 trước publish reply/route/child phải CAS current input revision và accepted receipt coverage cho đúng snapshot/model selection; receipt cũ giữ audit nhưng không làm authority mới. `AssistantRepresentationTransport` là port của session phân tích Trợ lý riêng phase06, không bịa project attempt/fence và không sửa public RuntimeAdapter phase04; actual driver + process/policy/capability integration phải review và test trước enable. modelKey/runtime từ stored session, không lấy claim của request. modelKey dùng canonicalJson của exact phase04 ModelKey {machineId,runtime,providerId,modelId}; server so object key/value với stored selection, không chỉ model name. Any native read/child/tools vẫn bị policy session giới hạn; grant không cho nạp file thành skill hoặc lệnh.

### R2 — Source OFF chặn admission mới, giữ exact lượt đã admitted

`startAssistantReadSession` và phase06 `authorizeSession` khóa current source config + designation + grant/input snapshot trước khi ghi session/admission trong cùng Tx. Chỉ source ON, model/policy hợp lệ mới tạo immutable AssistantTurnAdmission (ID server sinh, server admittedAt, revision config tại thời điểm nhận). Đây là điểm một lượt được admitted; `reserved` sau commit vẫn là **lượt đã được nhận**, không phải quyền để tạo lượt thứ hai. Service lookup replay theo grantId/snapshotId/modelSelectionId đã lưu trước fresh admission gate; xác minh authenticated machine, persisted processInstanceId/admission và assertSessionCurrent trước khi trả. Replay đúng session/modelSelectionId/processInstanceId và admissionId trả cùng identity, không gọi authorizeSession để mint admission mới hoặc reset expiry; session terminal không được reopen. modelSelectionId là identity một lượt, không reuse cho lượt kế tiếp. OFF thắng lock trước admission→deny/wait; admission commit trước OFF→giữ quyền của exact lượt đó tới khi hoàn tất hoặc điều kiện khác hết hiệu lực.

`assertSessionCurrent` vẫn xác minh exact persisted admission/session/model/runtime/process và snapshot, expiry của grant/session, current designation, explicit revoke/pause/cancel và policy/security revocation. Nó **không** đòi modelConfigRevision hiện tại bằng admission.modelConfigRevision và không đòi source hiện còn ON cho lượt đã admitted. Probe/config observation mới cũng không sửa pin admission; lỗi runtime thật đi error/fallback policy. Do đó lượt cũ được GET phần input còn lại, ghi reported transport receipt và publish câu trả lời hiện tại sau OFF nếu các điều kiện khác vẫn hợp lệ. OFF không tự kéo dài grant, bỏ check input thay đổi hoặc hủy một explicit revoke.

Sau lượt này, mọi selection/start/new session/new turn/fallback phải qua current source ON gate, kể cả cùng runtime/model tên cũ; không dùng admissionId cũ để lách source OFF. Phase06 chọn nguồn còn bật trên cùng designated machine hoặc wait sau lượt hiện tại. Reply/route decision của lượt hiện tại vẫn có thể hoàn tất, nhưng dispatch child/code là admission riêng nên giữ current source/model/permit gates. Sửa model-source config khác mà không explicit security revoke cũng chỉ ảnh hưởng admission mới; đổi designation, input/route, actual grant revoke, owner pause/cancel vẫn chặn tiếp và stop/reconcile theo contract. Không thay semantics frozen phase04.

### Schema009 bổ sung và routes chính xác

| Table | Fields/constraints bổ sung do Task1 sở hữu |
|---|---|
| attachment_conversations | id PK,owner_id CHECK='owner',created_at |
| attachment_messages | id PK,conversation_id FK,owner_id,client_message_id,text,canonical_payload_sha256,input_revision bigint,route_revision int,created_at; UNIQUE(owner_id,client_message_id) |
| attachment_message_links | message_id FK,attachment_id FK,sha256; PK(message_id,attachment_id); giữ vĩnh viễn submitted originals |
| attachment_message_routes | id PK,message_id FK,revision,project_id FK,ticket_id FK,decision_id FK attachment_message_decisions,supersedes_route_id nullable FK,revoked_at; UNIQUE(message_id,revision), chỉ một current route |
| attachment_message_decisions | id PK,message_id FK,input_revision,snapshot_id nullable FK,grant_id nullable FK,receipt_id nullable FK,actor_kind,actor_id,kind CHECK('routing','scope','reply'),body jsonb,sha256,created_at; immutable, same-message scope |
| attachment_submission_authorizations | id PK,owner_id,target_kind,target_id,originals jsonb,authorization_sha256,allow_original default false,expires_at,revoked_at,created_at; immutable scope |
| attachment_input_revisions | target_kind,target_id,revision bigint,route_revision int; PK(target_kind,target_id); comment INSERT qua trigger009 (legacy và attachment); submit không-comment/extraction/re-route qua service, tất cả cùng root/target/input row lock |
| attachment_input_snapshots | id PK,target_kind,target_id,input_revision,route_revision,canonical jsonb,sha256,created_at; UNIQUE(target_kind,target_id,input_revision,sha256) |
| attachment_dispatch_inputs | command_id PK FK005,decision_id FK,snapshot_id FK,sha256,input_revision,selection_sha256; write before claim, immutable |
| attachment_assistant_grants | id PK,authorization_id FK,target_kind,target_id,originals jsonb,input_revision,route_revision,designation_id,designation_revision,machine_id FK,snapshot_id nullable FK,snapshot_sha256 nullable,derivative_ids jsonb,allow_original,expires_at,revoked_at; snapshot fields set once by CAS |
| attachment_assistant_sessions | id PK,grant_id FK,snapshot_id FK,snapshot_sha256,designation_revision,machine_id FK,runtime,model_key,model_selection_id,policy_receipt_id,process_instance_id,admission_id UNIQUE,admitted_at,model_config_revision,source_enabled_at_admission CHECK=true,state,expires_at; UNIQUE(grant_id,snapshot_id,model_selection_id,process_instance_id) |
| attachment_assistant_receipts | id PK,session_id FK,grant_id FK,snapshot_id FK,receipt_sha256,body jsonb,coverage CHECK('all_selected','partial','none'),trust CHECK='reported_transport',created_at; UNIQUE(session_id,receipt_sha256) |

Existing attachment_input_manifests thêm snapshot_id FK/snapshot_sha256; project evidence chỉ tạo khi có ticket. Inbox snapshot/grant/receipt là owner-scoped record riêng, không chèn evidence với ticket giả. Khi route, tạo evidence artifact tham chiếu immutable inbox snapshot/receipt hash trong ticket mới sau current revision verification; provenance nêu direct Assistant transport, không nâng thành workflow completion evidence. Original AttachmentRef.ownerId ổn định; project ACL luôn qua live ticket link/route, không qua initial_project_id.

| Route | Auth và payload → result |
|---|---|
| POST `/v2/attachment-conversations` | owner/CSRF/idempotency `{}` →201 `{conversationId}` |
| POST `/v2/attachment-submissions/messages` | owner/CSRF/idempotency MessageSubmission →201 AssistantMessage |
| GET `/v2/attachment-conversations/:id/messages` | owner → own paginated message IDs/content+attachment refs; machines404 |
| POST `/v2/attachment-messages/:id/route` | owner hoặc phase06 authenticated controller qua InputRoutingAuthority; RouteMessageInput →201 MessageRoute; no generic machine bypass |
| POST `/v2/attachment-messages/:id/decisions` | owner hoặc phase06 designated machine qua current scoped authority; persisted-message-decision input như service →201 `{decisionId}`; không có quyền ghi generic project decision |
| POST `/v2/attachment-submission-authorizations` | owner/CSRF/idempotency `{target,originals,allowOriginal,expiresAt}` →201 OwnerInputAuthorization; originals phải thuộc target submitted, expiry<=24h; dùng cho explicit read/renew, không machine self-renew |
| DELETE `/v2/attachment-submission-authorizations/:id` | owner/CSRF/idempotency →200 revoked cùng revoke mọi grant/session con |
| POST `/v2/attachment-assistant-grants` | owner/CSRF/idempotency `{authorizationId,target,inputRevision}` →201 grant; machine403; internal issuer dùng cùng service |
| DELETE `/v2/attachment-assistant-grants/:id` | owner/CSRF/idempotency →200 revoked; revocation durable event |
| POST `/v2/input-snapshots` | authenticated actor `{target,access,expectedInputRevision,scopeDecisionId}` →200 InputSnapshot; metadata only, attempt không bắt buộc |
| POST `/v2/machine/assistant-input-grants/:id/bind-snapshot` | designated machine `{snapshotId}` + idempotency →200 bound grant; issuer/selection policy validates exact authorized target/hash |
| POST `/v2/machine/assistant-input-sessions` | designated machine `{grantId,snapshotId,modelSelectionId}` + idempotency →201 stored session, authority resolves runtime/model/policy/process |
| GET `/v2/machine/assistant-input-sessions/:id/representations/:derivativeId` | bearer + grant/snapshot IDs; current designation/session/grant/revision checks each chunk, exact derivative only → bytes + ETag digest |
| GET `/v2/machine/assistant-input-sessions/:id/originals/:attachmentId` | same checks + allowOriginal=true → original bytes; mặc định403 |
| POST `/v2/machine/assistant-input-read-receipts` | bearer + AssistantReadReceipt + idempotency →201 `{receiptId,coverage,trust:'reported_transport'}` |

Task3 exports `registerInputScopeRoutes(app:FastifyInstance,options:ServerOptions,deps:RouteDependencies,ports:{selection:PreclaimSelectionAuthority;assistant:AssistantInputAuthority;routing:InputRoutingAuthority;retire:RouteRetirementAuthority}):void`. Controller registers it beside existing routes with explicit default-deny ports, then phase06 replaces only trusted factory injection after producer review. No request can inject a port; missing authority returns named409 before mutation/bytes. HTTP schema remains strict, GET revision/auth checked before ETag/replay. Migration009 creates tables first and adds cross-table FKs after all definitions to resolve message/snapshot/receipt references; discriminated targets enforced by constraints/transaction checks.

Existing `/v2/machine/attachments/*` và postclaim manifest routes vẫn yêu cầu current project AttemptReadContext; không thêm exception “nếu là Assistant” vào gate executor. Snapshot access no-attempt không cấp byte route. Exact targets/IDs/revisions thuộc body canonical; auth kiểm trước replay; revoked grant không trả cached secret/content từ idempotency. Receipt replay trả metadata only sau current actor scope check, audit còn giữ dù current=false.

### Receipt trust và giới hạn thu hồi bytes (review acceptance notes)

Server `appendInputReceipt` đối chiếu runtime/modelKey với exact attempt's persisted phase04 companion/selection, attempt/fence/process/snapshot/manifest digest, derivative hashes và selected unit set. Assistant receipt đối chiếu exact AssistantReadSession/modelSelectionId bằng authority, không dùng project attempt giả. Unknown/wrong model/runtime/extra derivative/unit/wrong modality→422; empty hoặc strict subset không được status consumed/delivered full: nếu client yêu cầu full thì422 RECEIPT_COVERAGE_MISMATCH, nếu status partial/failed thì lưu coverage partial/none đúng sự thật. Duplicated units không tăng coverage. Stored trust luôn reported_transport; model delivery không đồng nghĩa hiểu đúng, server không tự nâng thành verified completion. Phase06 dùng coverage receipt + reasoning evidence theo workflow, không kể lời báo này là đã đọc original raw nếu chỉ nhận derivative.

Broker giữ bytes/cache dưới namespace không mount vào model, mỗi read lại kiểm current grant/attempt/policy; revoke ngăn request/chunk mới sau check. Adapter buộc dùng native path phải đăng ký `MaterializedGrant={id:Id,authorizationKind:'attempt'|'assistant-session',authorizationId:Id,processTreeId:Id,paths:string[],policyRevision:string}` trước expose. `revokeMaterializedGrant(id):Promise<{state:'stopped'|'unknown';stopEvidenceId:Id|null}>` gọi phase04/06 stop+reconcile process tree, chờ stopped proof, gỡ policy/mount, quarantine rồi cleanup; unknown không được declare revoked-local hoàn tất và không được khởi chạy replacement. Server grant đã revoked ngay; local revocation pending được hiển thị. Không dùng chmod/unlink/map invalidation để hứa tước open FD. Bytes đã vào provider/process memory hoặc đã giao không thể bị “đọc lại như chưa có”; receipt ghi deliveredAt/revokedAt/cutoff riêng và tiếp tục cấm publish reply/child từ revision cũ. Native canary mở FD trước revoke, thử child/native read, chứng minh process tree đã dừng trước báo local revocation complete; đây là gate implementation, không phải lời hứa tức thì trên mọi adapter.

## Task 1: Durable staging và schema009

**Files:** Task1 row. **Consumes:** `databaseFixture(through)(fn)`, `ticketFixture(db)` và `mutate(db,context,work)` actual phase02; config clock injected. **Produces:** exact factory interfaces below; BlobStore does not perform authorization and is never handed to route/model directly.

```ts
export interface BlobStore {
  publishDerivative(input:{attachmentId:Id;extractionId:Id;derivativeId:Id;generation:string;
    expectedBytes:number;expectedSha256:Sha256},body:AsyncIterable<Uint8Array>,signal:AbortSignal):Promise<BlobHandle>;
  receive(input:{attachmentId:Id;generation:string;expectedBytes:number;expectedSha256:Sha256},
    body:AsyncIterable<Uint8Array>,signal:AbortSignal):Promise<BlobHandle>;
  verify(blob:BlobHandle):Promise<'present'|'missing'|'corrupt'>;
  open(blob:BlobHandle):Promise<AsyncIterable<Uint8Array>>;
  removeOwned(input:{key:string;ownershipNonce:string}):Promise<'removed'|'absent'>;
}
export type StageServices = {
  createCompose(tx:Tx,input:ComposeTarget,actor:Actor):Promise<ComposeSession>;
  reserve(tx:Tx,input:UploadSpec,actor:Actor):Promise<{attachment:Attachment;selectionRevision:number}>;
  receive(id:Id,actor:Actor,body:AsyncIterable<Uint8Array>,signal:AbortSignal):Promise<Attachment>;
  abandonUpload(tx:Tx,input:{composeSessionId:Id;attachmentId:Id;expectedRevision:number},actor:Actor):Promise<number>;
  abandonCompose(tx:Tx,input:{composeSessionId:Id;expectedRevision:number},actor:Actor):Promise<ComposeSession>;
  readCompose(db:Db,id:Id,actor:Actor):Promise<{session:ComposeSession;attachments:Attachment[]}>;
};
export function createStageServices(input:{db:Db;store:BlobStore;receivers:ReceiverRegistry;now:()=>Date;
  config:AttachmentConfig}):StageServices;
```

`AttachmentConfig` được định nghĩa chính xác trong config.ts (giá trị defaults ở shared section):

```ts
export type ParserLimits={maxExpandedBytes:number;maxEntryBytes:number;maxZipEntries:number;
  maxCompressionRatio:number;maxXmlDepth:number;maxTextNodeBytes:number;maxTextBytes:number;
  maxCsvRows:number;maxCsvColumns:number;maxCsvFieldBytes:number;maxPdfPages:number;
  pdfDpi:number;maxPagePixels:number;maxImagePixels:number;maxOutputBytes:number};
export type AttachmentConfig={storageRoot:string;policySha256:Sha256;
  maxFileBytes:number;maxComposeFiles:number;maxComposeBytes:number;maxOwnerStagingBytes:number;
  stagingTtlMs:number;cleanupGraceMs:number;uploadLeaseMs:number;uploadHeartbeatMs:number;
  uploadMaxWallMs:number;chunkBytes:number;workerConcurrency:number;workerMemoryMiB:number;
  workerCpu:number;workerPids:number;workerWallMs:number;allowedExtensions:string[];limits:ParserLimits};
export type WorkerConfig={policySha256:Sha256;limits:ParserLimits};
```

Type-only imports từ contracts/config không khởi tạo server; CLI nhận WorkerConfig JSON, không import server env.  `loadAttachmentConfig(env:Record<string,string|undefined>):AttachmentConfig` validates finite lower/upper limits and canonical absolute root at startup. Environment prefix `CREW_V2_ATTACHMENT_`, explicit root required, no default home path. Service functions must check owner even when called without routes. `receive` uses private short `mutate` lease start/finalize keys based on upload ID+generation+receiverId; only final state emits `attachment.changed` after event schema registered.

- [ ] **Step 1 RED:** add minimal storage test and test fixture exports `attachmentFixture(db)` returning existing `ticketFixture` plus `stage`, `store`, `root`, `clock`, `mutation`, `close`. Clock={now:()=>Date,advance(ms:number):void}; root created with mkdtemp under OS temp, ownership nonce persisted0600, close deletes only that verified root after all fixture workers stopped. Config from exact defaults, no global env change. Add helpers `bufferBody(bytes:Uint8Array):AsyncIterable<Uint8Array>` and `sha(bytes):string` from crypto.

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {databaseFixture} from './support/db.ts';
import {owner} from './support/tickets.ts';
import {attachmentFixture,bufferBody,sha} from './support/attachments.ts';

test('attachment storage keeps original bytes through ready commit', async()=>{
  await databaseFixture(9)(async db=>{
    const f=await attachmentFixture(db);
    try {
      const bytes=Buffer.from('Nguyên bản\n');
      const c=await f.mutation('compose',tx=>f.stage.createCompose(tx,
        {projectId:f.project.id,ticketId:null,purpose:'ticket'},owner));
      const r=await f.mutation('reserve',tx=>f.stage.reserve(tx,{composeSessionId:c.id,
        expectedRevision:1,fileName:'note.txt',declaredMime:'text/plain',
        byteLength:bytes.length,sha256:sha(bytes)},owner));
      const a=await f.stage.receive(r.attachment.attachmentId,owner,bufferBody(bytes),new AbortController().signal);
      assert.equal(a.state,'ready'); assert.equal(a.sha256,sha(bytes));
      const [row]=await db`select storage_key,durable_at from attachment_uploads where id=${a.attachmentId}`;
      assert.ok(row.durable_at);
      assert.equal(await f.store.verify({key:String(row.storage_key),sha256:a.sha256,byteLength:bytes.length}),'present');
    } finally {await f.close();}
  });
});
```

- [ ] **Step 2 RED run:** `pnpm --dir v2/server test --test-name-pattern='attachment storage|attachment staging'`. Expected missing module/table009 failure until implementation. If upstream008 absent, run pure config/storage tests via `node --test` in server cwd and mark DB RED deferred dependency explicitly; never create dummy008 or edit checksum. Add table-driven tests size exact/max+1, truncated stream, empty legal text, invalid filename, MIME mismatch, magic mismatch, aborted PUT, quota reservation concurrency, same hash separate upload IDs, same key different reserve body409 and invalid generation loses CAS.
- [ ] **Step 3 GREEN:** implement schema/config/storage/staging, exact state protocol above. Content detection is two-tier: lightweight byte signature before ready (PNG/JPEG/PDF/ZIP/OLE vs UTF8) and trusted worker container structural classifier later; no native decoder in HTTP process. ZIP typed by declared extension until strict content-types confirms, status pending. Reject binary/MIME mismatch at upload415; structurally malformed document retained and marked corrupt by extractor. Text fatal UTF8 or BOM UTF16LE/BE recognized; strict decoding performed bounded worker. Keep quoted checksum ETag.

```ts
// storage.ts: essential durability ordering; final key belongs only this UUID.
await stageHandle.sync();
await stageHandle.close();
await syncDirectory(stageDirectory);
await renameOwnedStage(stageKey,finalKey,{attachmentId,generation,sha256,byteLength});
await syncDirectory(finalDirectory);
// Only caller's generation-CAS transaction may publish `ready` after these awaits.
```

Define `syncDirectory(path:string):Promise<void>` opening directory readonly and sync+close; `renameOwnedStage(stageKey,finalKey,expected):Promise<void>` validates owned keys/no symlinks/same device, rejects foreign existing target, verifies existing matching original on replay, uses exclusive hard-link+unlink stage if rename would overwrite (same filesystem only), syncs parents. Fail startup if required durable directory flush/exclusive publication unsupported. Không dùng rename ghi đè mù. publishDerivative dùng cùng publication protocol, key dưới derivatives/attachmentId/extractionId/derivativeId, persist owned gc intent trước disk write, không sửa original path. Store media sample only in scratch, never logs.
- [ ] **Step 4 GREEN run:** same focused tests + `pnpm --dir v2/server typecheck`. Crash injection interface `StorageFault=(point:'after-stage-sync'|'after-publish'|'before-ready-commit')=>Promise<void>` test-only constructor option, production default no-op; ensure rejected ready-commit leaves inspectable owned intent+blob. Actual process-kill recovery belongs Task7.
- [ ] **Step 5 docs/review/commit:** fill server-attachments flow all seven headings from implemented symbols/states. Controller maps new files, runs staged docs check, independent review accepts crash semantics, then `git commit -m "feat(attachments): add durable upload staging"` with only Task1 paths and docs. No worker commits shared index.


### Task1/2/3 — R1 legacy producer và thứ tự transaction

RED bổ sung vào `attachments-manifests.test.ts` và `attachments-submissions.test.ts`, trước khi cài trigger009: actual legacy appendComment commit phải làm test snapshot→comment→claim thất bại tại assertion stale (đây là lỗi cần sửa), không phải lỗi fixture. Dùng actual `mutate` và `appendComment` như ràng buộc fixture ở trên. GREEN chỉ khi trigger009 cùng consumer CAS thực sự bắt được các ca sau:

- Ticket có snapshot + dispatch pin + Assistant session/receipt current → `f.addComment('Thông tin mới')` → inputRevision tăng1; actual claim trả409 INPUT_SNAPSHOT_STALE không tạo attempt; `AssistantInputAuthority.assertSessionCurrent` implementation dưới root/target/input locks từ chối pin cũ và transaction publish reply không ghi decision. Test producer cũ này không qua attachment wrapper. Phase06 phải chạy lại bằng actual publish-reply path khi tích hợp, không lấy fixture authority làm chứng nhận integration.
- Request A→step B→task C, sibling D: comment actual tại A tăng A/B/C/D mỗi row1; comment B tăng B/C mỗi row1, A/D không đổi. Snapshot C chứa comment A/B/C (query ancestor chain dưới root lock), không chứa D; stale C claim/reply đều denied. New child tạo sau comment có snapshot đầu chứa ancestor comment; test thiếu revision row bắt lazy base1→2. Comments immutable; future edit/delete API phải có revision producer trước enable. Snapshot canonical hash bao gồm inputRevision cùng inherited comment IDs + body SHA256 theo thứ tự ancestor depth rồi created_at/id (`comments:{id:Id;ticketId:Id;sha256:Sha256}[]` thêm vào InputSnapshot; message target dùng mảng rỗng), không đưa text vào event.
- Barrier dùng hai DB connections và actual mutations; đặt barrier sau event_cursor/root lock **trong callback**, không chờ cả hai cùng vào vùng đã serialize. Comment thắng → claim/reply chờ rồi409; claim/reply thắng → commit thành công một lần ở revision cũ, comment sau đó tăng counter và mọi publication kế tiếp pin cũ bị chặn. Không đòi hai thao tác khác nhau chỉ một commit; yêu cầu một thứ tự linearizable, không duplicate attempt/reply. Barrier child-create đối đầu ancestor-comment bảo đảm child hoặc nằm trong fanout hoặc snapshot đầu đọc history mới.
- Actual attachment-comment thành công có counter tăng đúng1 mỗi affected target và đúng một comment.created; retry cùng key hoặc compose khác key/same body không tăng lại. Linker fail sau INSERT hoặc injected throw trước commit rollback comment/link/event/counter cùng lúc. Extraction completion chạy riêng được tăng thêm1; event replay không bump. Legacy comment rollback cũng không giữ counter/event riêng.

Chạy RED rồi GREEN focused pattern `attachment preclaim|attachment snapshot|attachment comment|attachment legacy revision`; Task1 owns009, Task2 owns submission/producer regressions, Task3 owns snapshot/claim/reply gates. Không đổi004, public appendComment signature hay frozen claim contract.


## Controller dispatch scope / actual producer gate

Base ccb3498. Phase02 001–006 and03actual007 are reviewed; phase04Task1 actual008 source is undergoing finalcoveringrun and MUST have independent spec+quality READY before any databaseFixture(9)/prefix009migration integration. Approved plan explicitly permits independent pure config/storage unit work before producer gate. Implement only Task1 owned files/schema009/support/flow; schema009 must cover the whole frozen shared contract and future tasks, including input/ancestor-comment revision triggers required R1. Source004–008 unchanged. No fake/dummy008, no consumer source rewrite, no public appendComment signature changes. DB tests can be authored RED but run after PM sends reviewed008 checksum/actualexport handoff.

No edits server app/main/events/package/lock/manifests/generated docs or other sourceunits. Stage receiver private mutation emits attachment.changed only after PM registers exact metadata schema; until producer integration unavailable, fail closed/report required handoff, never bypass validation. Propose new dependency first; storage/signature detector should not require native decoder/extractor packages. PM owns serialized source integration/Git/checks; do not stage/commit shared index.

You are not alone, preserve others' changes. No subagents/reviewer spawned by worker. Use Superpowers task execution/TDD/verification; default fake/offline/test-owned roots only. No real ownerHOME/credential/model/provider/shared service changes. Resource cleanup exactownednonce/identity, never global scans/deltas. Meaningful behavioral tests on durability/publication/path/quota/cancellation/crashintent; run one coveringserver after finalchange+actual008READY, focused repeatedchecks only for changes/failures. Do not rerun peers' tests while they are active for samecode. Freeze owninventory/report sourcecontracts/checksum+coveringcommands/logs/exits/SHA and exactownedcleanup. Default implemented artifact/storage versus future access/extraction/trueprocesskill acceptance stated accurately. Independent full taskreview byPM then maximum5semanticfixrounds.

## PM ruling — baseline oversized HTTP test transport

Ruling: Task05/1 covering253tests (250pass,1fail,2platformskip) exposed frozen api-acceptance bounded-body case; narrow unchanged-case replay also EPIPE after24MiB request. Permit active attachment worker READ-ONLY diagnose real serverresponse then narrow TEST-ONLY ownership extension to server/test/support/http.ts and api-acceptance.test.ts plus server-docs-view R3 flow. Production app/routes/body limits/001–008 remain frozen.

Keep original assertions exact413 for both ordinary1MiB and docs24MiB oversize, successful >1MiB docsimport, and actualSSEshutdown. If existing fetch client loses early realHTTP response while still writing rejected large body, use a dedicated bounded nativeHTTP fixture path with explicit timeout/backpressure/response collection; stop owned writes after response, handle expected socketwriteerror only after actual response exists. Never turn EPIPE/ECONNRESET into fabricated413 or relax assertions; if no actual413 can be proven, report producerbug before any production edit. No retry under newmutationkey. Keep current fetchfixture behavior for all other tests, minimize transportchange to two oversize probes.

Original coveringfailure and narrowfailure remain evidence. Meaningful regression originalfailure→newactual413/SSEfullcase pass; type/Biome/relevantR3 required. Existing covering already exercises all253registered cases with attachmentpassing; test-onlyfixture change requires boundedcase focusedverification, not another broadcover unless sourcechanges/newconcern justify it. Report fullcover250pass/1fail/2skip + focused repairedcase separately, never claim253coverPASS from union or discard historicalfailure. Independent fullTask1review includes exactbaselinefixture/testdiff and capturedresults; can require additional justified check.

Reason: confirmed existing client/testtransport blocker outside attachment code; preserve actualHTTPcontract while repairing lostresponse observation. Cost if wrong: dedicatedtestclient may differ from productionclient; boundedresponse/auth/bodybehavior must be measured, no serverreadiness inference from swallowederror. Resource14:41:58 RAM41%free84.97%idle38GiB/load2.65 checked before active-task extension. No extraagent/semanticwave yet.
