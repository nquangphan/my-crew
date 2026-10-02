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

## Task 2: Ticket/comment + attachment selection trong cùng transaction

**Files:** Task2 row. **Consumes:** Task1 selection/ready state, actual `createTicket`, `createTicketServices` factory. **Produces:** `createAttachmentSubmissions({tickets,stage}):AttachmentSubmissions` with methods below; no filesystem mutation in transaction.

```ts
export type CommentAttachmentInput = {composeSessionId:Id;selectionRevision:number;attachmentIds:Id[]};
// New OPTIONAL factory dependency in tickets/contracts.ts, injected by controller only.
export type CommentAttachmentLinker = (tx:Tx,input:{commentId:Id;ticketId:Id;
  attachments:CommentAttachmentInput},actor:Actor)=>Promise<void>;
// Add commentAttachments?: CommentAttachmentLinker to TicketServiceDependencies.
// Preserve the public appendComment(tx,ticketId,text,actor) signature; migration009 trigger below covers every comments INSERT, including this legacy producer.
// Add factory method, default rejects ATTACHMENT_LINKER_NOT_CONFIGURED:
export type AppendAttachmentComment = (tx:Tx,ticketId:Id,input:{text:string;
  attachments:CommentAttachmentInput},actor:Actor)=>Promise<Comment>;
export interface AttachmentSubmissions {
  ticket(tx:Tx,input:{ticket:CreateTicket;selection:Selection;assistantRead?:'selected-inputs'|'none'},actor:Actor):Promise<{ticket:Ticket;attachmentIds:Id[]}>;
  comment(tx:Tx,ticketId:Id,input:{text:string;selection:Selection;assistantRead?:'selected-inputs'|'none'},actor:Actor):Promise<{comment:Comment;attachmentIds:Id[]}>;
}
export function linkSelection(tx:Tx,input:{selection:Selection;ticketId:Id;commentId:Id|null},
  actor:Actor):Promise<Id[]>;
```

**Producer gate:** tickets owner reviews default-deny new method and transaction invariants before attachments consumer uses it. Factory deep-freezes optional callback; method validates text <=32768; either text.trim nonempty or requested attachmentIds nonempty; inserts comment, runs linker which validates **actual ready set**, then emits single existing comment.created event. If no callback, reject before comment insert; if callback fails, caller mutator rolls back insert/event/links. Do not pass a client `allowEmpty` boolean, dummy whitespace or arbitrary trusted count. Exposed legacy appendComment still rejects empty. Callback is not callable via generic route dependency controlled by request. Existing ticket CreateTicket unchanged.

- [ ] **Step 1 RED:** extend fixture with `submissions`, `readyCompose(purpose:'ticket'|'comment',ticketId:Id|null,files:Uint8Array[]):Promise<Selection>` using real reserve+receive; select mime txt and deterministic filename by index. Test actual count and atomicity directly with DB.

```ts
test('attachment comment rollback if any selected original unavailable', async()=>{
  await databaseFixture(9)(async db=>{
    const f=await attachmentFixture(db);
    try {
      const selection=await f.readyCompose('comment',f.request.id,[Buffer.from('A'),Buffer.from('B')]);
      await db`update attachment_uploads set state='missing' where id=${selection.attachmentIds[1]}`;
      await assert.rejects(f.mutation('send',tx=>f.submissions.comment(tx,f.request.id,
        {text:'',selection},owner)),{code:'ATTACHMENT_NOT_READY'});
      const [counts]=await db`select (select count(*) from comments) as comments,
        (select count(*) from attachment_links) as links`;
      assert.equal(Number(counts.comments),0); assert.equal(Number(counts.links),0);
    } finally {await f.close();}
  });
});
```

Add separate tests: default factory rejects new method/no hook, old appendComment empty rejected, empty+ready attachment succeeds, whitespace-only no attachment rejected, mixed text+files, duplicate attachment ID400, foreign compose/project/ticket404, omitted ready slot409 SELECTION_CHANGED, reserved/failed slot422, remove then stale selection409, two submit transactions same key one ticket/comment/event, same session new key+same canonical body returns same stored response, different body409 COMPOSE_ALREADY_SUBMITTED. Tests query events/comments/tickets counts; replay status/body exactly stored.
- [ ] **Step 2 RED run:** `pnpm --dir v2/server test --test-name-pattern='attachment comment|attachment submission|attachment ticket'`; expect named atomic/factory tests fail, not unrelated config failure.
- [ ] **Step 3 GREEN:** implement helper `lockSelection(tx,selection,actor,target):Promise<Attachment[]>` (target={projectId,ticketId,purpose}) that locks compose+sorted uploads, checks exact set active reserved/receiving/ready/rejected/missing (abandoned excluded), session/revision/expiry and every ready+durable_at. Submitted session replay path checks durable submission hash before open-state validation. `submissionHash`=sha256(canonical JSON body with sorted unique attachmentIds); include all ticket fields/text/target IDs/revision và assistantRead đã normalize (omitted='none'); retry cùng session đổi quyền none→selected-inputs phải409, không cấp authorization mới. Existing mutator key scope route/path remains first layer; per-compose submission catches retry under new key. Ticket wrapper calls createTicket then linkSelection in same Tx; comment uses factory method/callback. No early independently committed comment or create-ticket HTTP roundtrip.

```ts
// submissions.ts inside one caller-owned mutator transaction:
const prior=await replaySubmission(tx,selection.composeSessionId,bodyHash,actor);
if(prior) return prior;
await lockSubmissionScope(tx,target,actor);
await lockSelection(tx,selection,actor,target);
const ticket=await tickets.createTicket(tx,input.ticket,actor);
const ids=await linkSelection(tx,{selection,ticketId:ticket.id,commentId:null},actor);
const response={ticket,attachmentIds:ids};
await finishSubmission(tx,selection.composeSessionId,bodyHash,'ticket',ticket.id,response);
return response;
```

`lockSubmissionScope(tx,target:{projectId:Id;ticketId:Id|null;parentId:Id|null;purpose:'ticket'|'comment'},actor:Actor):Promise<void>` khóa existing root trước, parent/affected comment descendants theo UUID, project, input rows rồi mới compose; new root chưa tồn tại chỉ khóa project trước createTicket; target lấy từ validated request + DB, không trust client root. `replaySubmission(...):Promise<SubmissionResponse|null>` and `finishSubmission(...,response:SubmissionResponse):Promise<void>` private functions defined here; `SubmissionResponse={ticket:Ticket;attachmentIds:Id[]}|{comment:Comment;attachmentIds:Id[]}` with target-kind narrowing, no unsafe cast. `linkSelection` creates links and extraction pending rows with unique key; complete compose/increment **compose selection** revision in finish; input revision là counter bigint trong attachment_input_revisions, không là event cursor. Trigger009 là writer duy nhất cho comment insert; attachment-comment wrapper/linkSelection không bump lần hai. Event cursor chỉ dùng wake/replay. Existing event is committed with all links so phase06 never sees half attachment comment.
- [ ] **Step 4 GREEN run:** focused suite and full tickets/dependencies/completion/repair regressions once plus typecheck. Test backwards compatibility services called without attachment deps; all original text comment semantics unchanged.
- [ ] **Step 5 docs/review/commit:** update server-tickets and server-attachments with callback authority/atomic retry. Independent tickets producer reviewer required. Controller commit `feat(attachments): atomically link ticket and comment inputs` after docs checks.

## Task 3: Authorized routes, descendant refs và revocation

**Files:** Task3 row. **Consumes:** stage/submissions/types, phase02 auth/journal/ticket scope and actual execution attempt fields, phase03 binding revision. **Produces:**

```ts
export type AttachmentExecutionGate = (tx:Tx,actor:Actor,context:AttemptReadContext)=>Promise<void>;
export interface AttachmentInputServices {
  buildManifest(tx:Tx,input:{context:AttemptReadContext;decisionId:Id;required:RequiredInput[];
    inputRevision:string;snapshotId:Id;snapshotSha256:Sha256},actor:Actor):Promise<InputManifest>;
  appendReceipt(tx:Tx,input:InputReceipt,actor:Actor):Promise<Id>;
}
export function authorizeAttachment(tx:Tx,actor:Actor,input:{attachmentId:Id;
  context:AttemptReadContext|null;derivativeId:Id|null;manifestId:Id|null},
  gate:AttachmentExecutionGate):Promise<BlobHandle>;
export function inheritAttachmentLinks(tx:Tx,ticketId:Id,sourceLinkIds:Id[],actor:Actor):Promise<Id[]>;
export function registerAttachmentRoutes(app:FastifyInstance,options:ServerOptions,
  deps:RouteDependencies,services:{stage:StageServices;submissions:AttachmentSubmissions;
    store:BlobStore;executionGate:AttachmentExecutionGate;config:AttachmentConfig;inputs?:AttachmentInputServices}):void;
```

Task3 registers input-manifest/receipt routes với optional inputs producer; thiếu Task6 injection thì409 INPUT_SERVICES_NOT_CONFIGURED trước mutation, không import source chưa tồn tại. Task6 controller injects InputServices methods closing gate+selection authority. Gate mặc định ném lỗi `ATTACHMENT_EXECUTION_NOT_CONFIGURED`409. Controller's execution-owned implementation checks actor machine current/revocation, current project.machine_id+binding_revision, context ticket project/root, attempt machine/project/ticket/fence/processInstanceId and active guard, state active with valid lease (or exact allowed uncertain read needed for reconcile explicitly read-only under existing authority), no browser owner forging machine proof. For normal consume require active lease; uncertain/stopped attempt download denied409 ATTEMPT_NOT_ACTIVE. Resume creates fresh authorized attempt references same manifest original IDs; no permanent ACL on historical machine assignment. Source/workflow projection policy at runtime fetch boundary must still authorize attachment tool; server project grant doesn't bypass it.

- [ ] **Step 1 RED:** build API fixture using owner session/CSRF from identity app; register own routes on test app only. `machineContextFixture` explicitly persists phase02 claim + phase03 companion + reviewed fake test authorizer; no production default replaced. Test default-deny without gate separately.

```ts
test('attachment access never follows a matching checksum across projects', async()=>{
  await databaseFixture(9)(async db=>{
    const f=await attachmentAccessFixture(db); // Task3 support extension, definition below
    try {
      const a=await f.linkFile('A',Buffer.from('same bytes'));
      const b=await f.linkFile('B',Buffer.from('same bytes'));
      assert.equal(a.sha256,b.sha256); assert.notEqual(a.attachmentId,b.attachmentId);
      const denied=await f.machineDownload('A',b.attachmentId);
      assert.equal(denied.statusCode,404);
      assert.equal((await f.machineDownload('A',a.attachmentId)).statusCode,200);
    } finally {await f.close();}
  });
});
```

`attachmentAccessFixture(db)` extends Task1 support under controller ownership transfer (not concurrent edits): creates two projects A/B, two registered machines using real provision+bind APIs, active test attempts; methods `linkFile(project:'A'|'B',bytes):Promise<AttachmentRef>`, `machineDownload(project,id):Promise<LightMyRequestResponse>`, `rebindAfterStop(project):Promise<void>`, `close`. Tokens generated at runtime and redacted. Tests descendants source ancestor valid; sibling/nonancestor/tree/project mismatch denied; direct link to child shouldn't copy blob row; no public hash endpoint; revoked token401, old machine after rebind404, stale fence409, wrong context project404, derivative of another original404; owner unlinked compose allowed, machine unlinked404; all unknown fields400/unsupported MIME415/limits413.
- [ ] **Step 2 RED run:** `pnpm --dir v2/server test --test-name-pattern='attachment access|attachment routes|attachment references'`; first missing symbols → expected RED.
- [ ] **Step 3 GREEN:** implement complete HTTP table, strict schemas, route normalization/idempotency; child refs via recursive ancestor query under same root lock. Recheck current authorization on every GET, including conditional requests; no 304 before permission. For streaming, open FD after auth then before first byte confirm binding revision/token/attempt once more in short transaction. Bind/revoke commits after stream starts invalidate future chunks: revalidate per64KiB chunk or <=1s whichever first and abort on mismatch. Cannot retract bytes already delivered; document precise semantics and test mid-stream stop. Do not retain global long-lived auth cache. Immutable original never auto-deleted after link.

```ts
// routes.ts parser lives in scoped plugin; never buffer raw upload in Fastify.
app.register(async uploadApp=>{
  uploadApp.addContentTypeParser('application/octet-stream',(request,payload,done)=>done(null,payload));
  // PUT handler authenticates/CSRF before service lease; service meters every chunk.
  // request.body is narrowed by route-local stream guard before stage.receive(...).
});
```

Define route-local `isByteStream(value:unknown):value is AsyncIterable<Uint8Array>` by asyncIterator callable, no client object executable path (actual Fastify parser object only). Unexpected request content-type rejected, request aborted closes stream+lease generation. On repeated ready PUT fully meter/hash body then return existing result; no overwrite. Blob response content-length exact stored bytes, attachment disposition; MIME remains detected safe mapping, never original untrusted header. Deployed reverse proxy must forward auth and enforce bounded timeout/size >= configured max (phase09 handoff).
- [ ] **Step 4 GREEN run:** focused tests and middleware regressions/typecheck. Slow-stream test with barrier lets rebind/revoke commit between chunks; first old bytes received is permitted, later chunks denied; next request404. Test cache-control headers and no storage keys/token in response/events/log capture.
- [ ] **Step 5 docs/review/commit:** server-attachments + server-identity/server-tickets pages only when respective source changed; controller commit `feat(attachments): enforce scoped downloads and descendant references`.

## Task 4: Worker độc lập model, bounded job và fencing

**Files:** Task4 row. **Consumes:** original ready+submitted retained record/BlobStore (message inbox cũng hợp lệ), exact config hash. **Produces:** worker protocol and runner API:

```ts
export type WorkerInput = {version:1;jobId:Id;generation:string;original:AttachmentRef;
  mime:string;inputName:'original';extractorVersion:string;config:WorkerConfig};
export type ExtractorRunnerConfig={dockerBinary:string;imageDigest:string;
  sourceTreeSha256:Sha256;storageRoot:string;wallMs:number};
export type ExtractorBuildReceipt={targetPlatform:'linux/amd64'|'linux/arm64';libc:'glibc';
  baseIndexDigest:string;basePlatformDigest:string;nativePackage:string;nativeIntegrity:string;
  lockSha256:Sha256;sourceTreeSha256:Sha256;imageDigest:string;stage:'diagnostic'|'production';
  boundaryResult:'pass'|'fail'|'unverified';corpusResult:'pass'|'fail'|'unverified'};
export type DiagnosticReport={kind:'diagnostic-report';imageDigest:string;sourceTreeSha256:Sha256;
  checks:{name:string;status:'pass'|'fail'|'unverified';evidenceSha256:Sha256}[]};
export function createDockerExtractorRunner(config:ExtractorRunnerConfig):ExtractorRunner;
export function runExtractorDiagnostic(config:ExtractorRunnerConfig,ownedJobDirectory:string):Promise<DiagnosticReport>;
// Both call the same private spawnWorkerContainer(mode, argv/limits). ExtractorRunner itself is extract-only.
export interface ExtractorRunner {
  start(input:WorkerInput,ownedJobDirectory:string):Promise<{workerId:string}>;
  inspect(workerId:string):Promise<'running'|'stopped'|'unknown'>;
  stop(workerId:string):Promise<'stopped'|'unknown'>;
  result(workerId:string,ownedJobDirectory:string):Promise<WorkerResult>;
}
export function processExtraction(db:Db,extractionId:Id,runner:ExtractorRunner,
  store:BlobStore,now:()=>Date):Promise<Extraction>;
export function validateWorkerResult(input:WorkerInput,result:unknown):WorkerResult;
```

`WorkerConfig` là projection cấu hình chỉ có parser limits/version như định nghĩa Task1; không chứa storageRoot/server env. Chỉ parent giữ real root. Worker JSON has no source workflow instructions, provider credential or DB. ExtractorVersion `crew-extractor-v1+pdfjs6.3.289+canvas1.0.3+yauzl3.4.0+saxes6.0.0+<sourceTreeSha256>` assigned at image build; runtime verifies image immutable digest and version match. Tests replace sourceTreeSha256 with fixture-built source hash, never a constant production certificate.

- [ ] **Step 1 RED:** fake runner records argv/container limits, barriers for generation CAS. Tests job duplicates unique constraint one worker; old generation result rejected; timeout+unknown worker retains lease; original hash mismatch fails verification; result with `../../x`, symlink, wrong original/config/hash/job/generation/size/unit IDs rejected; worker errors contain fixed code only.

```ts
test('attachment worker rejects stale results before persisting derivatives',()=>{
  const input=workerInputFixture(); // pure literal UUID/config/hash fixture in worker test
  const result={...workerResultFixture(input),generation:'0'};
  assert.throws(()=>validateWorkerResult(input,result),{code:'STALE_EXTRACTION_GENERATION'});
});
```

Define `workerInputFixture` and `workerResultFixture` in worker test file using randomUUID(), sha(Buffer.from('fixture')), full required fields; valid result status complete has one text unit and one file; mutate one field per negative test.
- [ ] **Step 2 RED run:** `pnpm --dir v2/server test --test-name-pattern='attachment worker'`; expected missing module/validation RED. Live boundary suite opt-in `CREW_V2_EXTRACTOR_LIVE_TEST=1` uses its own built image and scratch, no paid models.
- [ ] **Step 3 GREEN:** controller thêm đúng bốn pin vào manifest, resolve/update lock trong target Linux build task riêng rồi review integrity/transitives/native package; không lấy host Darwin node_modules làm build input. Final image chỉ install --prod --frozen-lockfile --ignore-scripts trong target như recipe bên dưới, rồi compatibility probe. Initial lock generation là thao tác controller có review trước frozen build; không tự tắt frozen khi build fail. Add minimal local `yauzl.d.ts` declaration for only used callback API with strongly typed Entry/ZipFile (fileName, compressedSize, uncompressedSize, generalPurposeBitFlag, externalFileAttributes, crc32, compressionMethod, readEntry/openReadStream/close and events); validate runtime objects at adapter. No `any` escape.

Task4 sở hữu worker-entry.ts và worker-diagnostic.ts. Mode đến từ argv tin cậy của runner: diagnostic chỉ phát DiagnosticReport, không WorkerResult. Clean checkout tại Task4 chạy đầy đủ boundary canary mà không import Task5. Mode extract chưa khả dụng tới khi Task5 cung cấp extract/index.ts và final image đạt production corpus. Hai mode dùng cùng entry và private spawnWorkerContainer (mount/network/limits giống hệt); public ExtractorRunner trả WorkerResult chỉ cho extract, runExtractorDiagnostic trả DiagnosticReport riêng; diagnostic không chứng minh parser đã đạt.

```dockerfile
ARG TARGETPLATFORM
FROM --platform=$TARGETPLATFORM node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8
WORKDIR /extractor
COPY package.json pnpm-lock.yaml ./
RUN npm install --prefix /opt/pnpm --ignore-scripts --no-audit --no-fund pnpm@10.32.1
RUN node /opt/pnpm/node_modules/pnpm/bin/pnpm.cjs install --prod --frozen-lockfile --ignore-scripts
COPY --chown=65532:65532 src/attachments ./src/attachments
RUN node -e "const c=require('@napi-rs/canvas');const b=c.createCanvas(1,1).toBuffer('image/png');if(b.length===0)process.exit(1)"
USER 65532:65532
ENTRYPOINT ["node","--max-old-space-size=384","src/attachments/worker-entry.ts"]
```

Controller tạo context riêng chỉ gồm package.json, pnpm-lock.yaml và attachment sources đã review. extractor.dockerignore loại node_modules, .env*, storage, caches, git và owner files; copy file này thành .dockerignore trong context. **Không COPY host node_modules.** Baseline build là linux/amd64 với glibc (Debian bookworm). Nếu target deploy là arm64, build linux/arm64/glibc riêng và cần receipt riêng; không dùng binary amd64. Chạy `docker buildx build --platform linux/amd64 --load --file extractor.Dockerfile --tag crew-v2-extractor:test .` chỉ trong context này với builder sẵn có; không cài global binfmt hoặc dùng cloud builder. TARGETPLATFORM RUN cài optional native module đúng target ngay cả caller Mac arm64. Frozen lockfile phải resolve @napi-rs/canvas-linux-x64-gnu@1.0.3 (arm64: canvas-linux-arm64-gnu@1.0.3) cùng publisher integrity; thiếu entry thì fail build và trả controller review, không bỏ frozen flag. Ghi targetPlatform/libc/baseIndexDigest/basePlatformDigest/nativePackage/nativeIntegrity/lockSha256/sourceTreeSha256/imageDigest vào ExtractorBuildReceipt. Task4 probe import canvas và tạo PNG; Task5 rebuild final image, chạy decode PNG/render PDF/full corpus cùng boundary. Lỗi load native là WORKER_IMAGE_INCOMPATIBLE trước job readiness, không là file corrupt. Chỉ exact image có production corpus receipt mới được nhận mode extract.


```ts
const argv=['run','--pull=never','--name',`crew-v2-extract-${jobId}-${generation}`,
  '--label',`crew.v2.extraction=${jobId}`,'--network=none','--read-only',
  '--cap-drop=ALL','--security-opt=no-new-privileges','--user=65532:65532',
  '--memory=512m','--memory-swap=512m','--cpus=1','--pids-limit=32',
  '--tmpfs=/tmp:rw,noexec,nosuid,size=16m',
  '--mount',`type=bind,src=${ownedInputDirectory},dst=/input,readonly`,
  '--tmpfs=/output:rw,noexec,nosuid,size=100m,uid=65532,gid=65532',imageDigest,'--mode',mode];
// execFile Docker binary with argv; no shell. input/output paths parent-created + ownership checked.
```

Worker dùng `/output` tmpfs cho scratch, không có writable host mount. Kết quả đi stdout framed bounded: header JSON + base64 chunks per derivative + terminal WorkerResult như Task5; parent stream vào owned stage files, kiểm tổng bytes<=100MiB, filename regex `^[a-z0-9-]+\.(txt|png)$`, count, digest, mime/unit refs, không tin size claims. Mỗi stage chỉ được tạo exclusive và không theo symlink. Parent nhận terminal record, xác minh container stopped rồi publish derivative qua BlobStore.publishDerivative/fsync, commit derivative rows + extraction manifest bằng generation CAS. Original/extraction/config hash phải khớp job reservation; DB rollback để lại owned orphan cần Task7 reconcile, không được unlink file đã ref. stderr cap64KiB với fixed code/redaction; stdout base64 tổng cap ceil(100MiB*4/3)+metadata. Thiếu terminal/truncated frames không publish; không cố đọc tmpfs sau container đã bị remove. Dọn đúng container ID sau stopped+result reconciliation, không dùng --rm trước recovery bookkeeping.

Runner config chỉ nhận dockerBinary tuyệt đối đã resolve/hash, imageDigest SHA256 đang có local và owned storageRoot; không nhận request override CLI flags/image/mount. `start` ghi WorkerInput JSON vào input scratch trước spawn, fsync file/directory; CLI đọc `/input/request.json` và `/input/original`.

Container registry: persist extraction generation/start intent + deterministic container name before spawn; crash after spawn before returned ID recovers `docker inspect` exact name+labels+image; do not create second container when unknown. Require lease and actual capacity; offline runner `EXTRACTOR_UNAVAILABLE` pending with bounded backoff, not extraction success. Watchdog timeout issues stop then inspect; unknown keeps state running/error code and prevents cleanup. One job may retry only after prior stopped; generation increments and output staging unique.
- [ ] **Step 4 GREEN run:** tests/typecheck plus live container canary before claim sandbox effective: no external network, foreign host sentinel path unavailable, read-only source, no DB/env/token/docker socket, pids/memory kill bounded, stdout bomb stopped, no child survivors after timeout. Record observed Docker/OS/image values and each PASS/FAIL; missing Docker marks live gate UNVERIFIED and production worker readiness false, never silently run parser in HTTP process.
- [ ] **Step 5 docs/review/commit:** extraction flow documents exact boundary, version/config job fencing and errors. Controller commit `feat(attachments): isolate bounded extraction workers` after focused evidence. Deployment/supervisor packaging phase09 must reproduce these controls; phase05 can test image locally without deploying shared services.

## Task 5: Extractors và provenance kiểm chứng được

**Files:** Task5 row. **Consumes:** WorkerInput/original chỉ đọc, four pinned packages; no model API. **Produces:** functions typed below and golden corpus generated deterministically; fixtures containing executable-looking content are inert data, generated at test runtime where possible.

```ts
export type ExtractedFile = {relativeName:string;kind:'text'|'image';mime:'text/plain'|'image/png';
  bytes:Uint8Array;unitIds:string[]};
export type ExtractResult = {status:ExtractStatus;units:CoverageUnit[];
  files:ExtractedFile[];problems:Problem[]};
export type ExtractContext = {original:AttachmentRef;mime:string;config:WorkerConfig;
  signal:AbortSignal};
export function detectFormat(bytes:Uint8Array,fileName:string,declaredMime:string):
  'png'|'jpeg'|'pdf'|'docx'|'xlsx'|'csv'|'text'|'encrypted-office'|'unsupported';
export function extractText(bytes:Uint8Array,c:ExtractContext):Promise<ExtractResult>;
export function extractCsv(bytes:Uint8Array,c:ExtractContext):Promise<ExtractResult>;
export function extractImage(bytes:Uint8Array,c:ExtractContext):Promise<ExtractResult>;
export function extractPdf(bytes:Uint8Array,c:ExtractContext):Promise<ExtractResult>;
export function extractDocx(bytes:Uint8Array,c:ExtractContext):Promise<ExtractResult>;
export function extractXlsx(bytes:Uint8Array,c:ExtractContext):Promise<ExtractResult>;
export function verifyExtraction(input:WorkerInput,result:ExtractResult):WorkerResult;
export function readOfficeParts(bytes:Uint8Array,c:ExtractContext):Promise<Map<string,Uint8Array>>;
export function parseXml(bytes:Uint8Array,onNode:(event:XmlEvent)=>void,config:WorkerConfig):void;
export type XmlEvent={kind:'open'|'close'|'text';uri:string;local:string;attributes:Readonly<Record<string,string>>;text:string};
```

`verifyExtraction` từ chối metadata >8MiB hoặc >100000 units bằng partial LIMIT_EXCEEDED có missing tail locator; group sheet/CSV units theo dải ô thay vì mỗi cell khi vượt cap. Hàm tạo digest/size manifest từ bytes, kiểm mỗi available unit có file đúng modality, mỗi file chỉ tham chiếu unit đã khai báo, không trùng locator/unit/relative name và complete không có missing unit. Hàm không chứng nhận ý nghĩa nội dung. Files yielded to runner progressively; public functions above return bounded result for unit tests, CLI drains each page/part to framed writer under total limit. `writeFrame` is worker-protocol producer with JSON header `{kind:'file-start',name,mime,bytes,sha256}`, zero or more `{kind:'file-chunk',name,base64}`, `{kind:'file-end',name}`, then `{kind:'result',body:WorkerResult}`; mỗi file-chunk/header line<=128KiB; terminal result tối đa8MiB (bounded coverage metadata), max decoded chunk64KiB, byte/digest check independent. No arbitrary JSON object is trusted as verified derivative until parent verification completes.

- [ ] **Step 1 RED:** construct corpus in `make-fixtures.ts`, no network. Export `makePdf(mode:'text'|'scan'|'mixed'|'encrypted'|'corrupt'):Uint8Array`, `makeOffice(kind:'docx'|'xlsx',parts:Record<string,string|Uint8Array>):Uint8Array`, `makePng(width,height):Uint8Array`, `extractContextFixture(mime):ExtractContext`. For PDF fixtures use committed small licensed/generated PDFs with README provenance + SHA256, don't invent PDF writer from scratch for encrypted fixture; source fixture generation recipe/author/license recorded. Office ZIP generator của fixture ghi local/central headers store-method với crc32, không dùng làm production unzip. formats.ts kiểm OLE directory có chain sector hữu hạn trong file (sector512/4096, số sector<=file size, reject cycle/out-of-range) và UTF16 directory names EncryptionInfo+EncryptedPackage trước khi gọi encrypted-office; không decrypt hoặc chạy Office, OLE không đủ chứng cứ trả unsupported. Snapshot expected text/units separately reviewed, no snapshot auto-update without review.

```ts
test('attachment scan cannot become complete text coverage',async()=>{
  const result=await extractPdf(makePdf('scan'),extractContextFixture('application/pdf'));
  assert.equal(result.status,'complete');
  assert.ok(result.units.length>0);
  assert.ok(result.units.every(u=>u.needs==='vision' && u.state==='available'));
  assert.ok(result.files.every(f=>f.kind==='image'));
  assert.ok(result.units.every(u=>u.locator.kind==='pdf' && u.locator.page>=1));
});
test('attachment csv retains multiline quoted cells without evaluating formula',async()=>{
  const bytes=Buffer.from('name,value\r\n"a\nb","=1+1"\r\n');
  const result=await extractCsv(bytes,extractContextFixture('text/csv'));
  assert.equal(result.status,'complete');
  const text=Buffer.concat(result.files.map(f=>Buffer.from(f.bytes))).toString();
  assert.match(text,/=1\+1/); assert.match(text,/a\\nb/);
  assert.ok(result.units.some(u=>u.locator.kind==='csv' && u.locator.rowStart===2));
});
```

Add explicit tests for each row in extraction table below; XML DTD refusal, declared1MiB/actual100MiB ZIP expansion, duplicate paths Unicode/backslash/case normalized collisions, encrypted ZIP, invalid CRC/offset/overlapping entries, ZIP64 uint>MAX_SAFE_INTEGER, zero division compression ratio, 2001 entries, DOCM/XLSM renamed, `vbaProject.bin`, embedded OLE/external altChunk, external relationship URL, symlink attrs, invalid path. Scanned page empty text must produce image unit, never empty text success; encrypted file returns encrypted and zero available units; truncation partial with missing page/unit vs unreadable corrupt. Check execution/network sentinel remains unchanged.
- [ ] **Step 2 RED run:** `pnpm --dir v2/server test:unit --test-name-pattern='attachment'` is not used if package script forwards flags after file globs; exact reliable command from server cwd: `node --test --test-name-pattern='attachment' test/attachments-formats.unit.test.ts test/attachments-text-csv.unit.test.ts test/attachments-pdf-image.unit.test.ts test/attachments-ooxml.unit.test.ts`. Expected missing extractors/coverage assertions RED.
- [ ] **Step 3 GREEN:** implement table as bounded parsers, not generic HTML conversion. Byte signature determines real format; ZIP needs content-types and root relationships, renamed macro/unknown ZIP rejected. Errors are structured statuses, not prose pretending read succeeded.

| Input | Implementation and provenance | Status/coverage boundary |
|---|---|---|
| text/code | fatal UTF8, BOM UTF16LE/BE; preserve original byte spans, decode line boundaries and chunks<=32KiB; output textual escaped control chars with line IDs, no execute/eval; HTML/script is literal text | invalid encoding unsupported; cap yields partial with missing tail byte range; whitespace empty file complete with explicit zero-content unit |
| CSV | RFC4180 state machine (unquoted, quoted, afterQuote), comma delimiter fixed, CRLF/LF, doubled quote, embedded newline; output JSON-lines cells as literal text with 1-based row/column; preserve Unicode/BOM | malformed quoting corrupt; row/col/field caps partial + missing unit; no formula evaluation or delimiter auto-guess; formula string kept |
| PNG/JPEG | inspect header dimensions before native loadImage(Buffer); decode+orientation normalize, export safe PNG stripping arbitrary metadata; full normalized pixel region, mapping original dimensions/rotation recorded in problem metadata when transformed | huge dimensions blocked; truncated decoder corrupt; always vision, never OCR/alt filename as replacement |
| PDF | load local Uint8Array, no URL, stopAtErrors true, enableXfa false, useWorkerFetch false, bundled font/CMap/WASM only, no viewer scripting/annotation event handler. Enumerate numPages; for each getTextContent with item transform/box and render at144DPI bounded area, respecting page rotate | page unit always vision (page render preserves layout/charts/scan); extracted text is supplementary text unit. Text-only simplification requires explicit scope decision excluding visual units; embedded JavaScript/launch action/embedded executable bị blocked ACTIVE_CONTENT_BLOCKED; XFA/portfolio/embedded tài liệu chưa hỗ trợ thành partial với missing unit, không evaluate; password encrypted; corrupt page missing with reason; page>200 tail missing |
| DOCX | strict OOXML parts/relationships via readOfficeParts + saxes; enumerate main/header/footer/footnotes/endnotes/comments; paragraphs/tables/runs in order, breaks, tracked insert/delete labels; resolve only internal relationships | locator part+paragraph/table/cell, no invented page. Embedded PNG/JPEG produce vision unit linked to paragraph; EMF/SVG/drawing/chart/SmartArt/altChunk not parsed becomes missing visual unit →partial. External hyperlinks displayed as text only, external body/image relations unavailable, no fetch. Macro/OLE executable content blocked |
| XLSX | enumerate workbook sheets including hidden and veryHidden, shared/inline strings, cell types/raw value/style number format, shared formulas, merged ranges, comments; represent cells with exact A1 coordinate + sheet/part, preserve raw and cached value separately, formula as text | never recalculate or claim cache fresh. Formula without cached value missing calculated-value unit; charts/drawings/pivots unsupported missing units →partial; hidden sheets included. Internal image PNG/JPEG vision unit, external links no fetch/partial; macros/OLE blocked |

PDF page text box uses points relative to page crop box and rotation, image box normalized [0,0,1,1], rendering metadata in locator remains stable under chunking. New config/extractor generates new extraction ID; do not overwrite old derivative/manifest to make checkpoints point at new bytes. `readOfficeParts` validates every central path before any open, limits actual output bytes on each stream, verifies CRC32 using node:zlib crc32 against entry, rejects duplicate normalized names, symlink/device entries and unsupported encryption/compression. No extraction to filesystem. XML parser `new SaxesParser({xmlns:true})`; error throws, doctype handler always rejects, count depth/text/total bytes outside parser. Events identify namespaces by URI, not prefix spelling; office URI allowlist from ECMA-376. Reject active content before extracting useful pieces; retained original status blocked visible owner.

```ts
const parser=new SaxesParser({xmlns:true});
parser.on('doctype',()=>{throw new ExtractError('ACTIVE_CONTENT_BLOCKED');});
parser.on('error',()=>{throw new ExtractError('CORRUPT_XML');});
// open/text/close handlers meter depth, text-node length and namespace+part allowlist.
// Never register a resolver, URI fetcher, JS interpreter or Office application.
parser.write(decodedXml).close();
```

`ExtractError extends Error` has readonly code:string from closed error union; wrap only recognized parser errors into corrupt/unsupported/blocked/partial; unexpected bug→failed EXTRACTOR_FAILED, not complete with empty text. Required codes: EXTRACTOR_UNAVAILABLE, EXTRACTOR_FAILED, LIMIT_EXCEEDED, ACTIVE_CONTENT_BLOCKED, UNSUPPORTED_TYPE, UNSUPPORTED_ENCODING, CORRUPT_DOCUMENT, CORRUPT_XML, PASSWORD_REQUIRED, EXTERNAL_RESOURCE_UNAVAILABLE, UNSUPPORTED_VISUAL, FORMULA_CACHE_MISSING, STALE_EXTRACTION_GENERATION, HASH_MISMATCH, DATA_LOSS. No prompt/file content in messages.
- [ ] **Step 4 GREEN run:** exact node command above + typecheck, then actual worker fixture corpus via Task4 live test on target CPU architecture. Verify at least one Vietnamese DOCX, multi-sheet XLSX, scan PDF, image, code and quoted CSV original hash matches input and every available unit links derivative bytes+locator. Set partial expectations intentionally for unsupported constructs; review does not edit goldens to erase missing coverage.
- [ ] **Step 5 docs/review/commit:** extraction flow lists supported subset/limits and semantics “complete extraction ≠ model đã đọc”. Controller commit `feat(attachments): extract document content with provenance`.

## Task 6: Permission-preserving runtime input và checkpoint companion

**Files:** Task6 row. **Consumes:** Task3 gate/BlobStore, Task5 immutable Extraction, frozen phase04 RuntimePin/RuntimeCheckpoint/RuntimeAdapter+Capability, phase06 selection authority. **Produces:** exact server/gateway bridge below; gateway package imports its existing RuntimePin by type and pure JSON attachment contract mirror.

```ts
export type InputSelectionAuthority = (tx:Tx,actor:Actor,input:{context:AttemptReadContext;
  decisionId:Id;required:RequiredInput[];inputRevision:string;snapshotId:Id;snapshotSha256:Sha256})=>Promise<void>;
export function buildInputManifest(tx:Tx,input:{context:AttemptReadContext;decisionId:Id;
  required:RequiredInput[];inputRevision:string;snapshotId:Id;snapshotSha256:Sha256},actor:Actor,
  gate:AttachmentExecutionGate,selection:InputSelectionAuthority):Promise<InputManifest>;
export function appendInputReceipt(tx:Tx,input:InputReceipt,actor:Actor,
  gate:AttachmentExecutionGate):Promise<Id>;
// gateway contracts.ts mirrors Capability literals already frozen phase04.
export type InputPart={original:AttachmentRef;derivativeId:Id;sha256:Sha256;
  unitIds:string[];kind:'text'|'image';brokerHandle:Id;nativeExposure:{localPath:string;materializedGrantId:Id}|null;mime:'text/plain'|'image/png'};
export type MaterializedInput={manifest:InputManifest;parts:InputPart[];
  requiredCapabilities:('text'|'vision')[];state:'ready'|'waiting';problems:Problem[]};
export type InputToolPolicy={authorizeAttachmentRead:(pin:RuntimePin,input:{manifestId:Id;
  attachmentId:Id;derivativeId:Id|null})=>Promise<void>};
export function materializeAttachmentInput(pin:RuntimePin,manifest:InputManifest,
  context:AttemptReadContext,ports:AttachmentInputPorts):Promise<MaterializedInput>;
export type AttachmentInputPorts={policy:InputToolPolicy;fetch:ProtectedAttachmentFetch;
  cache:OwnedAttachmentCache};
export type ProtectedAttachmentFetch=(input:{context:AttemptReadContext;original:AttachmentRef;
  manifestId:Id;derivativeId:Id|null;expectedSha256:Sha256})=>Promise<AsyncIterable<Uint8Array>>;
export interface OwnedAttachmentCache {
  write(input:{context:AttemptReadContext;manifestId:Id;derivativeId:Id;sha256:Sha256},
    bytes:AsyncIterable<Uint8Array>):Promise<Id>; // brokerHandle, not a model-visible path
  exposeNative(input:{brokerHandle:Id;context:AttemptReadContext;processTreeId:Id;policyRevision:string}):
    Promise<{localPath:string;materializedGrantId:Id}>;
  invalidateBinding(projectId:Id,bindingRevision:number):Promise<{serverAccess:'denied';local:'stopped'|'revocation_pending'}>;
}
export function assessInputCompatibility(input:MaterializedInput,capabilities:Capability[]):
  {state:'ready'|'waiting';required:Capability[];problems:Problem[]};
export function checkpointInput(checkpoint:RuntimeCheckpoint,input:InputManifest,
  manifestArtifactId:Id):RuntimeCheckpoint;
```

**Phase04 frozen contract:** controller reports independent approval/freeze at `f4d03c0` (round2 I1–I7 closed); read that reviewed contract before integration. Literal `RuntimeCheckpoint` remains attachmentIds+artifactIds only. `checkpointInput` rejects manifestArtifactId khác input.artifactId, unions originals into attachmentIds and the **registered manifest evidence artifact ID** into artifactIds, giữ nguyên các field/sequence/toolReceiptIds/logicalEffectIds/runtimeSession còn lại. No hidden derivative property or changing checkpoint005. `buildInputManifest` reads attachment_dispatch_inputs by exact attempt.command_id, verifies requested snapshotId/hash equals the claim-pinned row and current target revision, then persists canonical manifest and server-created evidence row kind `attachment_input_manifest`, verification `reported` (integrity trusted separately, never workflow completion proof), locator `attachment-manifest:<id>:<sha256>`, linked same ticket/root. Phase02 SourceRef uses `{kind:'artifact',id:evidenceId,locator}`; evidenceId is not the attachment ID. Gateway checksum-verifies retrieved manifest and referenced immutable derivative metadata; checkpoint restore chooses the pinned manifest, not latest extraction.

**Phase06 authority gate:** default deny INPUT_SELECTION_NOT_CONFIGURED. Phase06 decision.scope contains exact context ticket/inputRevision/required original hashes/unit IDs and rationale for selecting subset; backend compares DB-stored decision and current linked input set và current input_snapshot_id/sha/revision. Postclaim không tạo scope selection mới: required/unit set phải khớp snapshot đã ghi trước claim; InputSelectionAuthority chỉ xác minh persisted preclaim decision và exact attempt. Không caller nào được bỏ image units để khớp text-only capability. Default assessment covers all units of relevant attachments; any scoped exclusion remains visible in manifest missing/excluded rationale (extend `Problem` with code SCOPE_EXCLUDED and units, without marking those read). Partial extraction can be delivered to help ask owner, but `state=waiting` for a required missing unit; no completion/read-all assertion. Comment arriving after inputRevision causes manifest stale `INPUT_REVISION_CHANGED`409; active attempt receives pending input event/revision via phase06, no second claim.

- [ ] **Step 1 RED:** pure compatibility/checkpoint tests with literal manifests produced by Task5 fixtures; default-deny selection and permission tests with databaseFixture9. Define `materializedFixture({vision:boolean,missing:boolean}):MaterializedInput` trong gateway test tạo manifest hoàn chỉnh, derivative PNG nếu vision=true, missing unit nếu missing=true; `checkpointFixture():{checkpoint:RuntimeCheckpoint;manifest:InputManifest;evidenceId:Id}` tạo đủ frozen checkpoint fields, evidenceId=manifest.artifactId. Materializer tests dùng full RuntimePin từ existing runtime fixture cộng fake policy/fetch/cache recording calls; fake pin used only offline tests, never certificate creation.

```ts
test('attachment input cannot drop scan units for a text-only fallback',()=>{
  const input=materializedFixture({vision:true,missing:false});
  const result=assessInputCompatibility(input,['tools','text']);
  assert.equal(result.state,'waiting');
  assert.ok(result.problems.some(p=>p.code==='VISION_REQUIRED'));
});
test('attachment checkpoint retains immutable manifest and original identities',()=>{
  const {checkpoint,manifest,evidenceId}=checkpointFixture();
  const next=checkpointInput(checkpoint,manifest,evidenceId);
  assert.deepEqual(new Set(next.attachmentIds),new Set([...checkpoint.attachmentIds,...manifest.originals.map(x=>x.attachmentId)]));
  assert.ok(next.artifactIds.includes(evidenceId));
  assert.deepEqual(next.logicalEffectIds,checkpoint.logicalEffectIds);
  assert.equal(next.runtimeSession,checkpoint.runtimeSession);
});
```

Add tests real bytes reach fake provider transport (not Markdown links); digest tampering/local symlink/hardlink denied; policy deny before fetch; manifest wrong source/project/attempt/fence/binding fails; replay after rebind triggers auth and invalidates old cache; derived text verified+covers selected units permits text model without native file_pdf/file_docx capabilities; scan/image requires vision PASS; partial/password/failed extraction waits with precise reason; forged client verified flag rejected; receipt can't include unknown derivative/unit or wrong modality; checkpoint old extraction remains pinned after newer extraction, hash loss DATA_LOSS no fallback to different bytes.
- [ ] **Step 2 RED run:** `pnpm --dir v2/gateway test --test-name-pattern='attachment input|attachment checkpoint|attachment fetch'` and server `pnpm --dir v2/server test --test-name-pattern='attachment manifest|attachment receipt'`. If gateway source absent, test contract fixture compilation can start separately but mark runtime integration dependency pending; never write ad-hoc runtime shell.
- [ ] **Step 3 GREEN:** build manifests server-side with sorted deterministic IDs/digests and whole input revision; required scope authenticated against phase06 persisted decision. Materializer calls policy on every part, fresh server fetch even when content cache exists (conditional checksum permission check, never authorize by cache possession); cache path nằm dưới broker-only ResourceRegistry scratch; model không được mount mặc định. Adapter cần native file path phải đăng ký exact grant/path/process tree và hoàn tất stop-and-revoke canary trước enable; chmod một mình không là boundary. Stream to exclusive temp/hash/fsync then publish; preserve originals on server; cache may be removed after process stop without losing input. Fetch handles404 access loss,409 stale attempt/revision,412 hash,503 unavailable distinctly; no anonymous retry URL. Binding/grant invalidation chặn broker request mới ngay khi nhận revoke; open FD/direct path đã cấp phải đi stop-and-revoke protocol ở hợp đồng revocation bên dưới. Không hứa thu hồi bytes đã giao; quarantine và cleanup chỉ sau process tree stopped proof.

```ts
export function assessInputCompatibility(input:MaterializedInput,capabilities:Capability[]) {
  const required:Capability[]=[...input.requiredCapabilities];
  const problems=[...input.problems];
  if(required.includes('vision') && !capabilities.includes('vision'))
    problems.push({code:'VISION_REQUIRED',message:'Cần model đọc ảnh cho phần đầu vào này',
      unitIds:input.parts.filter(p=>p.kind==='image').flatMap(p=>p.unitIds)});
  if(required.includes('text') && !capabilities.includes('text'))
    problems.push({code:'TEXT_REQUIRED',message:'Model chưa được xác minh khả năng đọc văn bản',unitIds:[]});
  return {state:input.state==='ready' && problems.length===0?'ready' as const:'waiting' as const,required,problems};
}
```

Store informational exclusions/warnings separately from blocking problems before compatibility (`SCOPE_EXCLUDED` is displayed but not in `MaterializedInput.problems` after authority approves exclusion); never erase missing required units. All file text passed as untrusted data blocks with source locator, not system/workflow/permission instructions. Runtime adapter dùng brokerHandle; nativeExposure chỉ khi đã đăng ký MaterializedGrant và policy/stop gate, dùng tool authorization trước local file access; model cannot issue “load this as skill” from attachment. Vision parts sent through actual phase04 provider multimodal format or native supported image input with bytes; absent adapter support→INPUT_ADAPTER_NOT_READY, not silently text.

**Mandatory producer review handoff before wiring:** phase04 owner adds an injected resolver to its adapter implementation/constructor, preserving `RuntimeAdapter.start/sendInput/checkpoint` signatures. `start` resolves checkpoint manifest artifact IDs; `sendInput` reads server-selected current manifest for attachmentIds + persisted decision; if IDs exist but no manifest authority wait. Native and API constructors consume `materializeAttachmentInput`; transport receipt emitted only after adapter has submitted all selected parts to model, status consumed means delivered not understood. No fabricated model cognition claim. Phase04/06 future actual interfaces are validated in a contract integration test; until hooks implemented bridge exported but adapter marked not-ready for attachment use. Phase05 never claims runtime integration passed from mocks alone.
- [ ] **Step 4 GREEN run:** focused server/gateway suites/typecheck; integration fake Claude→API fallback retains same manifest originals+derivatives/digests, no foreign runtimeSession reuse, sourceOFF selection denied by existing phase04 gate, same materialization permission check under new attempt/fence. Late new comment processed durable input queue once by phase06 fixture, not phase05 event listener spawning attempt.
- [ ] **Step 5 docs/review/commit:** gateway-attachments and extraction/server-attachments docs explain authorization/receipt limitations; controller-owned reviewed adapter injection also updates gateway-runtime flow. Commit `feat(attachments): preserve verified inputs across runtime checkpoints` only when ownership transfer approved; otherwise commit standalone bridge and explicitly retain integration acceptance gate.

## Task 7: Cleanup, crash recovery và acceptance

**Files:** Task7 row. **Consumes:** all prior services, own resource nonce/container identities, no global clean operation. **Produces:**

```ts
export type CleanupResult={claimed:number;deleted:number;retained:number;failed:number;unknown:number};
export function cleanupAttachments(input:{db:Db;store:BlobStore;runner:ExtractorRunner;
  now:()=>Date;limit:number}):Promise<CleanupResult>;
export function reconcileAttachments(input:{db:Db;store:BlobStore;runner:ExtractorRunner;
  now:()=>Date;limit:number}):Promise<{repaired:Id[];missing:Id[];waiting:Id[]}>;
```

Limit1–100, default50; deterministic cursor batches, multiple cleanup workers lock `FOR UPDATE SKIP LOCKED` after mutator event lock. Reconcile may report waiting but never marks attempted stop as proved; no process-kill of resources outside exact nonce/labels/image/generation. Periodic trigger server internal maintenance, not assistant model; phase06 five-minute monitor observes failure events and retry backlog, no repeated unchanged user notifications.

- [ ] **Step 1 RED:** cross-process failure harness forks **only test child** with own DB/storage and IPC barriers at protocol milestones; SIGKILL child PID recorded by fixture and verify exit. Add test matrix below, assert SQL row counts, file SHA256 and event counts before/after reconcile twice. Inject DB disconnect/fault after publish via isolated child connection, never kill DB container shared by other tests.

```ts
test('attachment cleanup cannot win after atomic link',async()=>{
  await databaseFixture(9)(async db=>{
    const f=await attachmentFixture(db);
    try {
      const selection=await f.readyCompose('comment',f.request.id,[Buffer.from('keep me')]);
      await f.mutation('submit',tx=>f.submissions.comment(tx,f.request.id,{text:'',selection},owner));
      f.clock.advance(48*60*60*1000);
      const result=await cleanupAttachments({db,store:f.store,runner:f.runner,now:f.clock.now,limit:50});
      assert.equal(result.deleted,0);
      const [row]=await db`select state,linked_at from attachment_uploads where id=${selection.attachmentIds[0]}`;
      assert.equal(row.state,'ready'); assert.ok(row.linked_at);
    } finally {await f.close();}
  });
});
```

Fixture `runner` added in Task4 support handoff; deterministic fake records known stopped state unless test sets unknown. Test-only recovery subprocess entry is created inside `attachments-recovery.test.ts` via this file flag/childProcess.fork with source test runner guarded main, not arbitrary shell interpolation.
- [ ] **Step 2 RED run:** `pnpm --dir v2/server test --test-name-pattern='attachment cleanup|attachment recovery|attachment acceptance'`; expect cleanup/reconcile missing RED.
- [ ] **Step 3 GREEN:** implement journal tombstones/nonce-owned deletion, publish reconciliation and bounded retry. `cleanupAttachments` honors Task1 locks/state protocol; deletion candidate for linked upload always forbidden even refcount zero. No global checksum reference counting; `link_count` may be diagnostic aggregate only, not deletion authority. Derivative linked to immutable extraction/manifests/receipt/evidence retained; worker scratch only after verified stopped and all published files committed. Orphan published derivative with no committed row gets owned journal candidate with grace; a DB transaction linking derivative must lock candidate generation and reject claimed deletion. Unknown path/nonce/link count mismatch→failed metadata, no unlink.

```sql
-- Core claim predicate; called after session expiry/grace + current generation checks.
UPDATE attachment_uploads u SET state='deleting', generation=generation+1
WHERE u.id=$1 AND u.linked_at IS NULL
  AND u.state IN ('reserved','rejected','abandoned','ready','missing')
  AND u.expires_at < $2
  AND NOT EXISTS (SELECT 1 FROM attachment_links l WHERE l.attachment_id=u.id)
RETURNING u.id,u.storage_key,u.stage_key,u.generation;
```

Actual implementation parameterizes grace cutoff and validates compose state/lease in same transaction; no deleting from SQL alone without gc ownership nonce row. Manifest/artifact protection checked before candidate; linked_at permanent latch means checkpoint not expressible as current link still safe. Cleanup after an expired stage linked original is refused. Delete failure retries same tombstone; never reset to ready without bytes verification.

| Fault/race | Required observation |
|---|---|
| reserve commit, no bytes | no attachment link; after TTL+grace reserved stage cleaned, replay metadata says expired not success |
| stage fsync before publish | reconcile verifies owned stage/digest and stopped receiver; publish or marks retryable, no link yet |
| publish durable before ready commit | same reserved intent recovers ready once; retry same bytes same ID |
| DB linked commit then HTTP disconnect | same idempotency key or same session/hash returns identical ticket/comment/link IDs; one event |
| ready row but blob missing/corrupt | DATA_LOSS/HASH_MISMATCH metadata, required input waiting, original never reconstructed from text derivative |
| cleanup vs submit two transactions | one winner: submit first keeps original forever; cleanup first makes submit409, no partial ticket |
| abandon vs receiving/late PUT | revoked generation cannot publish ready; wait actual receiver ended before clean |
| extraction worker killed after outputs before DB | orphan files retained/quarantined; generation current + hash valid can commit once, stale generation cannot |
| cleanup after deletion before gc commit | second run sees absent owned key and finalizes same tombstone, other original unchanged |
| DB restore older than storage | only known owned intents reconciled; unknown files quarantined, no bulk delete; linked manifests checksum audited |
| storage restore older than DB | missing original/derivative records remain visible, restore exact hash only, no empty success |
| same bytes projectA/projectB, cleanup abandonedA | B path/hash/read still intact; no cross-project count/authorization dependency |
| rebind/fallback/comment during run | current binding/attempt gated; old cache denied; new attempt resolves preserved manifest, new comment queued once |

- [ ] **Step 4 GREEN acceptance:** run all attachment focused suites once, then `pnpm --dir v2/server test`, `pnpm --dir v2/server typecheck`, `pnpm --dir v2/gateway test`, `pnpm --dir v2/gateway typecheck`, `pnpm --dir v2 test`, `pnpm --dir v2 typecheck`; Biome targeted changed source. No full suite repeated without new concern. Live extractor canaries/corpus required before worker production readiness; runtime real delivery phase04/06 joint acceptance separately records each runtime and format PASS/FAIL/UNVERIFIED. Backend may complete independent of pending phase07 prototype, but cannot claim UI paste/dragdrop already implemented.
- [ ] **Step 5 docs/commit:** controller add flows all new source/tests, exact seven headings `Mục đích`, `Điểm vào`, `Các bước`, `Files`, `Dữ liệu`, `Flow liên quan`, `Tests`; extraction/server/gateway pages describe observable failure/recovery, not future promises. Generate docs blocks in isolated v2 Git mirror (root-aware v1 CLI currently sees v1 root from v2 cwd), `crew-docs check --all` in mirror and root `crew-docs check --staged` on serialized candidate; never run integration script while another worker owns index. Controller commit `feat(attachments): reconcile storage and retain referenced originals` after independent review and summarize exact tests/evidence/known gaps.

## RED/GREEN bổ sung cho review round1 — bắt buộc theo owner task

Các test sau bổ sung vào **Step1 RED** của task được chỉ định; chạy command ở Step2 trước implementation, Step4 chạy lại sau GREEN. Fixture support do controller serialize, không cấp quyền production bằng fake authority. `attachmentFixture` mở rộng bằng actual inbox/snapshot/grant services và DB-backed test authority ghi immutable decision/designation/model selection records. Fake model transport chỉ thu bytes và trả receipt để kiểm giao thức; không chứng nhận model/isolation. Fixtures tạo UUID/hash/binary trong scratch có cleanup, không dùng credential thật.

### Task2 — S1 inbox và re-route

Bổ sung `inboxFixture(db)` trong support/attachments.ts, trả `{conversationId,projectB,projectC,submission,services,mutation,db,close}`: conversation qua real service; submission là MessageSubmission assistant_message có PNG ready, text='', clientMessageId cố định; services={submitAssistantMessage,routeAssistantMessage}; test authority đọc persisted message decision và retire callback khóa/kiểm attempts. Fixture seed project/route bằng real service, không trực tiếp chỉnh ACL để làm test đạt.

```ts
test('attachment inbox retries retain one projectless message and original',async()=>{
  await databaseFixture(9)(async db=>{
    const f=await inboxFixture(db);
    try {
      const send=(key:string)=>f.mutation(key,tx=>f.services.submitAssistantMessage(tx,f.submission,owner));
      const first=await send('first');
      const replay=await send('lost-reply-new-key');
      assert.equal(replay.id,first.id);
      assert.deepEqual(replay.attachmentIds,first.attachmentIds);
      const [row]=await db`select count(*) n from attachment_messages`;
      assert.equal(Number(row.n),1);
      const [scope]=await db`select initial_project_id,linked_at from attachment_uploads
        where id=${first.attachmentIds[0]}`;
      assert.equal(scope.initial_project_id,null); assert.ok(scope.linked_at);
    }finally{await f.close();}
  });
});
```

Negative cases: same clientMessageId khác text/files409; compose chưa submitted không grant; unrelated draft404; failure link thứ2 rollback cả message/event/authorization; route B rồi sửa C giữ cùng attachment/hash nhưng revoke B link+snapshot/grant, machineB download404; active/unknown attempt ở B chặn re-route409 và không sửa route revision; retirement authority absent fail closed; stale route CAS409; không tạo ticket cho message trước route. Run `pnpm --dir v2/server test --test-name-pattern='attachment inbox|attachment routing'` RED rồi GREEN. Query storage_key count không đổi qua route/correction.

### Task3 — S2 snapshot từ ticket mới, chưa attempt

Bổ sung `snapshotFixture(db)` trả `{actor,request,pendingSnapshot,readSnapshot,completeExtraction,recordDispatch,claim,addComment,close}`. readSnapshot dùng readInputSnapshot với DB-backed current bound metadata authority, completeExtraction qua trusted worker-result path (không input verified boolean), recordDispatch lưu snapshot pin vào command/decision/attachment_dispatch_inputs; claim gọi actual phase02 claim+phase06-equivalent AuthorizeDispatch fixture. `addComment(text)` phải import actual `appendComment` từ `../src/tickets/decisions.ts` và gọi nó bên trong actual `mutate` từ `../src/journal/mutation.ts` với actor owner/route/key/body hợp lệ; không được INSERT comment thay service, UPDATE revision, gọi fake bump hay fake event. Trigger009 là writer duy nhất mà test này chạy qua. Trước test assert `attempts` count0.

```ts
test('attachment preclaim scan rejects text-only choice before an attempt exists',async()=>{
  await databaseFixture(9)(async db=>{
    const f=await snapshotFixture(db);
    try {
      await f.completeExtraction('scan');
      const snapshot=await f.readSnapshot();
      assert.ok(snapshot.requiredCapabilities.includes('vision'));
      assert.equal(assessSnapshotCapabilities(snapshot,['text','tools']).state,'waiting');
      const [count]=await db`select count(*) n from attempts`;
      assert.equal(Number(count.n),0);
      const command=await f.recordDispatch(snapshot,['text','vision','tools']);
      await f.addComment('Thông tin mới');
      await assert.rejects(f.claim(command),{code:'INPUT_SNAPSHOT_STALE'});
    }finally{await f.close();}
  });
});
```

Negative cases pending extraction→waiting không claim; completion event tăng đúng revision và đánh thức lại; extraction update sau assessment trước claim bị CAS từ chối như comment; snapshot/hash/payload/scope mismatches409; caller gửi `requiredCapabilities:['text']` field400; scopeDecision chưa có/khác target hoặc tự chọn zero unit bị deny; current bound machine đọc metadata nhưng original bytes vẫn409 khi thiếu attempt; unbound không grant404. Run `pnpm --dir v2/server test --test-name-pattern='attachment preclaim|attachment snapshot'` RED/GREEN.

### Task1/2/3 — R1 legacy producer và thứ tự transaction

RED bổ sung vào `attachments-manifests.test.ts` và `attachments-submissions.test.ts`, trước khi cài trigger009: actual legacy appendComment commit phải làm test snapshot→comment→claim thất bại tại assertion stale (đây là lỗi cần sửa), không phải lỗi fixture. Dùng actual `mutate` và `appendComment` như ràng buộc fixture ở trên. GREEN chỉ khi trigger009 cùng consumer CAS thực sự bắt được các ca sau:

- Ticket có snapshot + dispatch pin + Assistant session/receipt current → `f.addComment('Thông tin mới')` → inputRevision tăng1; actual claim trả409 INPUT_SNAPSHOT_STALE không tạo attempt; `AssistantInputAuthority.assertSessionCurrent` implementation dưới root/target/input locks từ chối pin cũ và transaction publish reply không ghi decision. Test producer cũ này không qua attachment wrapper. Phase06 phải chạy lại bằng actual publish-reply path khi tích hợp, không lấy fixture authority làm chứng nhận integration.
- Request A→step B→task C, sibling D: comment actual tại A tăng A/B/C/D mỗi row1; comment B tăng B/C mỗi row1, A/D không đổi. Snapshot C chứa comment A/B/C (query ancestor chain dưới root lock), không chứa D; stale C claim/reply đều denied. New child tạo sau comment có snapshot đầu chứa ancestor comment; test thiếu revision row bắt lazy base1→2. Comments immutable; future edit/delete API phải có revision producer trước enable. Snapshot canonical hash bao gồm inputRevision cùng inherited comment IDs + body SHA256 theo thứ tự ancestor depth rồi created_at/id (`comments:{id:Id;ticketId:Id;sha256:Sha256}[]` thêm vào InputSnapshot; message target dùng mảng rỗng), không đưa text vào event.
- Barrier dùng hai DB connections và actual mutations; đặt barrier sau event_cursor/root lock **trong callback**, không chờ cả hai cùng vào vùng đã serialize. Comment thắng → claim/reply chờ rồi409; claim/reply thắng → commit thành công một lần ở revision cũ, comment sau đó tăng counter và mọi publication kế tiếp pin cũ bị chặn. Không đòi hai thao tác khác nhau chỉ một commit; yêu cầu một thứ tự linearizable, không duplicate attempt/reply. Barrier child-create đối đầu ancestor-comment bảo đảm child hoặc nằm trong fanout hoặc snapshot đầu đọc history mới.
- Actual attachment-comment thành công có counter tăng đúng1 mỗi affected target và đúng một comment.created; retry cùng key hoặc compose khác key/same body không tăng lại. Linker fail sau INSERT hoặc injected throw trước commit rollback comment/link/event/counter cùng lúc. Extraction completion chạy riêng được tăng thêm1; event replay không bump. Legacy comment rollback cũng không giữ counter/event riêng.

Chạy RED rồi GREEN focused pattern `attachment preclaim|attachment snapshot|attachment comment|attachment legacy revision`; Task1 owns009, Task2 owns submission/producer regressions, Task3 owns snapshot/claim/reply gates. Không đổi004, public appendComment signature hay frozen claim contract.

### Task3 + Task6 — S3 direct Assistant A và receipt/revocation notes

`assistantReadFixture(db)` tạo designated machine A, project B bound machine B, owner-submitted image inbox, current designation/modelSelection/policy records. Trả `{openAuthorizedRead,deliver,revoke,readArbitrary,changeDesignation,db,close}`; openAuthorizedRead dùng issuer→snapshot→bind→session services, không seed completed grant/session. deliver chạy fake AssistantRepresentationTransport tiêu thụ bytes iterator thật rồi POST receipt qua authentic machine A. `readArbitrary` gọi executor/missing-grant URL với token A.

```ts
test('attachment Assistant receives selected image bytes without project execution grant',async()=>{
  await databaseFixture(9)(async db=>{
    const f=await assistantReadFixture(db);
    try {
      const read=await f.openAuthorizedRead();
      const delivered=await f.deliver(read);
      assert.equal(delivered.imageSha256,read.derivativeSha256);
      assert.equal(delivered.receipt.coverage,'all_selected');
      assert.equal(delivered.receipt.trust,'reported_transport');
      assert.equal((await f.readArbitrary()).statusCode,404);
      const [count]=await db`select count(*) n from attempts`;
      assert.equal(Number(count.n),0);
      await f.revoke(read.grantId);
      await assert.rejects(f.deliver(read),{code:'INPUT_GRANT_REVOKED'});
    }finally{await f.close();}
  });
});
```

Negative cases A image-only request no project and B offline vẫn A read được khi authorized; A offline/vision absent hoặc source OFF trước admission→waiting không đổi máy; owner authorization expiry/different original/draft/old designation cannot issue; machine self-issue403; grant metadata-only chưa bound không bytes; wrong model/runtime/process selection receipt422; empty/subset delivered full422, partial stored coverage partial; additional unit/derivative hash/modality mismatch422; designation/re-route/input revision đổi hoặc explicit revoke/pause/cancel sau delivery chặn reply/child/route publication; source OFF sau admission một mình vẫn cho exact lượt hiện tại hoàn tất; arbitrary original when allowOriginal=false403; duplicate receipt idempotent. Test revocation broker next chunk fails; **joint native canary** opens FD/child trước revoke, invoke revokeMaterializedGrant, stop proof unknown giữ local pending và no replacement, known stopped mới gỡ grant/cleanup. Assert no “unread” claim for bytes captured before revoke. Run server pattern `attachment Assistant|attachment grant|attachment receipt` và gateway pattern `attachment Assistant|attachment revocation` RED/GREEN; native canary là required live gate riêng, fake không tạo certificate.

### Task3/6 + phase06 — R2 source OFF và admission pin

`assistantReadFixture` bổ sung `setSourceEnabled(enabled:boolean)`, `publishReply(read)`, `startNextRead(read)`, `pause(read)` và barrier cho admission. setSourceEnabled đi actual model-source config mutation phase04; publishReply gọi current-session/receipt gate rồi persist decision trong một Tx; startNextRead phải chọn/start session mới qua authority, không sửa session cũ. Phase06 actual authority/driver phải rerun cùng cases trước enable, default deny tới lúc đó.

RED/GREEN bắt buộc theo pattern `attachment Assistant admission|attachment Assistant revoke`:

- OFF trước admission → start denied/waiting, không session/admission, không model transport. Barrier OFF commit trước authorizeSession cho cùng kết quả; admission commit trước OFF giữ đúng stored admission ID/model/runtime/process/config revision và expiry.
- Admit → OFF → fetch phần chưa đọc → receipt all_selected → publish reply của **exact session cũ** thành công khi authority/input vẫn current. Không gọi authorizeSession mới cho receipt/reply; configRevision mới không rewrite grant/session/admission. Replay lost start response trả exact session đã admitted dù source hiện OFF, không thêm row/turn/reset expiry; session terminal không reopen.
- Sau OFF, new selection/session/turn/fallback bị deny dù cùng model/grant hoặc biết admissionId cũ; nguồn ON khác cùng designated machine được xét sau lượt hiện tại, nếu không có thì waiting. Actual runtime error cần fallback mới thì current ON gate vẫn áp dụng; không dùng quyền lượt cũ khởi tạo transport khác.
- Admit → OFF rồi explicit revoke, pause/cancel, designation change, input comment/extraction change, route revoke hoặc policy/security revoke: từng ca vẫn deny GET/receipt/publication và đi stop/reconcile (unknown giữ pending). Grant/session expiry không được kéo dài vì OFF. Byte đã giao giữ audit, không tuyên bố unread.

### Task4 — Q1/Q2 entrypoint và target build

```ts
test('attachment diagnostic image has no Task5 import dependency',async()=>{
  const receipt=await buildAndRunDiagnosticFixture({includeExtractors:false,target:'linux/amd64'});
  assert.equal(receipt.stage,'diagnostic');
  assert.equal(receipt.boundaryResult,'pass');
  assert.equal(receipt.corpusResult,'unverified');
});
```

`buildAndRunDiagnosticFixture({includeExtractors:boolean,target:'linux/amd64'|'linux/arm64'}):Promise<ExtractorBuildReceipt>` do Task4 test own: context whitelist Task4 files, package+frozen lock, explicit target; không include directory extract khi false; build/run existing local Docker, own labels/scratch. Task4 test node dynamic loader uses `const source=new URL('./extract/index.ts',import.meta.url); await import(source.href)` chỉ khi mode extract, nên TS/diagnostic không resolve missing Task5 file. Diagnostic engine image phải reject extract mode EXTRACTOR_NOT_INSTALLED/PRODUCTION_CORPUS_REQUIRED. Từ Mac arm64 tạo marker Darwin-only host node_modules; context excludes marker, target install không copy Darwin dependency. Missing/wrong native binary fails image probe WORKER_IMAGE_INCOMPATIBLE trước corpus. Task5 gọi cùng helper includeExtractors=true, final source hash/image digest khác được ghi, chạy PNG decode/PDF render/all formats và boundary lại trước corpus pass; diagnostic pass không được nâng production readiness. Commands Task4 live test opt-in như hiện tại; thiếu target builder ghi UNVERIFIED, không tự cài global emulation. Source file worker-entry/diagnostic thuộc Task4 và extract/index thuộc Task5 rõ ràng.

### Task1 + Task7 — Q3 live FD recovery và quota

`receiverProcessFixture(db)` do support/attachments.ts tạo Linux child A có IPC barriers, upload operation register thật trước mở FD; parentB dùng registry riêng same storageHostId. Trả `{expireLease,disconnectAFromDb,requestAbort,proveStopped,cleanup,killAndWaitA,reconcileB,readReservation,lateCompletion,close}`. Kill chỉ exact spawned test child và await exit; native proof dùng proc tuple, không test flag “assume stopped”.

```ts
test('attachment receiver lease expiry is not writer stop and deleted quota releases once',async()=>{
  await databaseFixture(9)(async db=>{
    const f=await receiverProcessFixture(db);
    try {
      await f.disconnectAFromDb(); await f.expireLease();
      assert.equal(await f.proveStopped(),null);
      assert.equal((await f.cleanup()).deleted,0);
      assert.ok((await f.readReservation()).bytes>0);
      await f.killAndWaitA();
      assert.equal((await f.proveStopped())?.kind,'native-process-gone');
      await f.reconcileB(); await f.cleanup();
      assert.equal((await f.readReservation()).bytes,0);
      await f.cleanup(); assert.equal((await f.readReservation()).bytes,0);
    }finally{await f.close();}
  });
});
```

Negative cases process A alive/open FD after DB loss → B không unlink/publish/increment writer generation; Abort ACK chỉ sau awaited writes+close; partial/forged ACK/nonce mismatch denied; PID reused startTicks different nhận diện old dead nhưng không signal new process; inaccessible proc/mismatched namespace→unknown; crash sau ACK file trước DB update recover được; A late callback sau revoke không ready/publish generation mới; quota release exactly once khi submitted/deleted, not while unknown. Run `pnpm --dir v2/server test --test-name-pattern='attachment receiver|attachment cleanup|attachment recovery'` RED/GREEN trên Linux fixture; macOS không giả native proof PASS.

## Cross-phase handoff and acceptance boundary

| Consumer | Producer contract / explicit integration gate |
|---|---|
| phase02 tickets | Optional factory callback/new method from Task2; default deny empty attachment comment without trusted linker; same Tx throughout. Existing CreateTicket/public appendComment signature/004 unchanged; additive009 comment trigger covers actual legacy INSERT and attachment INSERT exactly once, including inherited ancestor scope. Tickets producer review required before consumer starts. |
| phase02 execution/phase03 | Task3 `AttachmentExecutionGate` checks real attempt guard/fence/process/binding using existing005; no command type changes. Gateway resource registry registers attempt-local cache, actual stop proof before cleanup. |
| phase04 runtime `f4d03c0` | Task6 manifest evidence in artifactIds, originals attachmentIds; explicit constructor hook for start/sendInput materialization, policy authorization before protected fetch/bytes, current source/projection/capability gates remain. Attachments incompatible until actual producer integration reviewed/tested. |
| phase06 assistant | Persist input selection decision matching hashes/units/revision, prefer full required coverage; consume all necessary selected inputs before assessment/child creation/reply. Store read receipts/provenance and missing status on ticket; decision provenance uses actual manifest evidence SourceRef. Central assistant khác máy dùng grant/session/representation transport trong hợp đồng bên dưới, không dùng project-machine summary thay cho read. Current project binding gate giữ nguyên cho executor. Monitoring event/comment queue durable, journal cursor chỉ wake; counter revision từ trigger009/service là CAS authority, ancestor comment fanout tới descendants; no duplicate attempt. Assistant admission pin giữ exact current turn qua source OFF; new selection/session/fallback dùng current ON gate, actual revoke/pause/input/designation/route invalidation vẫn stop. |
| phase07 web | Same API for create/comment, compute hash then reserve+PUT, active selection revision from server, previews safe bytes object URL, status/error/retry remove; cancel compose background retention. Send attachment-only comment valid. No optimistic sent state until atomic submission success; lost reply replay same key, no duplicate. UI limit/type disclosure from policy route, date timezone HCM. Layout approval still required. |
| phase08 evidence/docs | Extraction/read receipt is input evidence, not verified completion/merge evidence. SourceRef manifest artifact can support reasoning but cannot satisfy code done. |
| phase09 ops | Private storage durable fsync-compatible filesystem, backup DB+blob inventory/restore hash checks; extractor image digest+native architecture canaries, supervisor/worker cleanup registry, authenticated proxy limits; no public static blob route. Deploy requires separate owner scope. |

## Self-review — producer/consumer matrix và negative coverage

| Producer | Consumers | Exact invariant checked in this plan |
|---|---|---|
| Task1 AttachmentRef/StageServices/BlobStore | 2/3/4/7 | original attachmentId+sha256+ownerId stable; project ACL nằm ở live link/route, storage key private, no cross-project dedupe |
| Task1 migration009 | all DB tasks | every table introduced before consumers, additive after008, no 004–008 mutation |
| Task2 CommentAttachmentLinker | tickets factory + submissions | one Tx, callback default deny, no blank-comment escape through old API |
| Task2 inbox message/route | phase06/07 | projectless image-only submit atomic, clientMessageId replay, immutable owner originals, re-route CAS+revoke old link |
| Task1 comment trigger009 | legacy appendComment + Task2 wrapper → Task3/phase06 | root/affected-target/input counter locks; ancestors invalidate descendants; one bump/comment, rollback atomic, event replay no bump |
| Task3 InputSnapshot/DispatchInputPin | phase06 model selection/claim | metadata no-attempt, capabilities từ coverage, command/decision/current revision recheck trong claim |
| Task3 AssistantReadGrant/Session | phase06 central Assistant/Task6 | owner/submission-authorized exact IDs/snapshot/designation/expiry, separate bytes route; immutable admission survives source OFF for exact current turn, fresh admissions deny; revoke/pause/input/designation still stop; no project execution grant |
| Task3 authorizeAttachment/gate | executor routes/manifests/fetch | current binding/attempt/token checked per request/chunk, derivative belongs original, inherited live link scope |
| Task4 worker-entry/diagnostic/build receipt | Task4 live gate→Task5 final corpus | clean Task4 no Task5 import, target Linux frozen install, native image/probe hashes, diagnostic cannot certify corpus |
| Task4 WorkerInput/Result | runner + Task5 parser + parent verifier | one version/generation/job/original/config, bounded framed bytes, parent calculates digest |
| Task5 Extraction/CoverageUnit | Task6 selection + phase06 | unknown/missing visual unit persists; technical verification is not semantic read receipt |
| Task6 InputManifest/receipt | checkpoint/runtime/web assistant evidence | frozen checkpoint fields, real evidenceId, immutable hash, no skip by text-only model |
| Task1 ReceiverRegistry | upload/Task7 recovery | exact boot/proc/PID/startTicks or close ACK after all FDs closed; lease expiry never stop; quota terminal latch |
| Task7 gc/reconcile | maintenance/phase06 monitor | owned nonce + stopped resource + no links/retention + grace; never erase linked original |
| Task6 receipts/revocation | phase06 publication + phase04 native boundary | exact stored model/selected-unit coverage, reported_transport only; native FD needs stop proof, delivered bytes not retractable |

Spec coverage: §4 modalities/fallback→5/6; §7 resume and lost reply→1/2/6/7; §8 resource cleanup→4/7; §9 STANDARD→each task/controller; §10 inbox trước project/create/comment/paste API→1–3; preclaim snapshot/direct Assistant grant→3/6; phase07 UI handoff; all image/PDF scan/DOCX/XLSX/CSV/text/provenance/unsupported cases→5; §12 no duplicate submission, attachment-only comments/read loss→2/6/7. Client layout is intentionally a named phase07 deliverable, not a missing backend task.

Five Review Focus lines have explicit tests: storage fault barriers/cleanup-submit race1/7; checksum scope+mid-stream revocation3; ZIP/XML/native-resource negative corpus4/5; scan/chart/password/missing formula+capability coverage5/6; same-session retry/comment event count/checkpoint fallback2/6/7. Source projection bypass negatives remain in phase04 tests and are exercised again at attachment policy deny-before-fetch bridge.

Internal consistency audit before dispatch: every created path in ownership matrix has one owner; four package pins match research; schema009 owns all future attachment tables; checkpoint carries evidence ID rather than unrecognized field; no mutation stores bytes/events sensitive text; receipt modality matches derivative kind/units; frozen producers require actual review. Tài liệu này không khẳng định source đã triển khai hoặc test đã đạt. Trạng thái planner: READY cho re-review độc lập round2, phạm vi R1/R2 (chưa freeze); các gate khi triển khai: phase06 actual inbox routing/issuer/preclaim/session authority, Linux receiver native proof, actual008 producer, tickets callback review, execution read authority, extractor live boundary, phase04/06 bridge integration.

## Bổ sung của PM — schema comment chỉ có attachment (2026-10-02 16:53)

Kiểm thử PostgreSQL Task2a xác nhận constraint004 length(text) BETWEEN1AND32768 chặn comment text rỗng trước khi chạy linker. Giữ nguyên001–009 đã nghiệm thu. Bổ sung010_attachment_comment_text.sql chỉ thay comments_text_check thành length(text) BETWEEN0AND32768; giữ NOT NULL, giới hạn tối đa, cột, trigger và mọi counter009. appendComment cũ giữ nguyên validation, gồm từ chối text rỗng và chấp nhận whitespace như hiện tại. Phương thức mới mặc định từ chối khi thiếu linker; callback tin cậy xác minh tập attachment ready thật. Migration không tạo route HTTP hay quyền allowEmpty từ client.

Task2a sở hữu010 và test producer với prefix10: nâng cấp9→10 giữ nguyên comment cũ, so checksum001–009 và diễn tập backup/restore. Consumer Task2b và các bước tích hợp attachment sau cần010 cùng producer đã nghiệm thu. Review độc lập Task2a bao gồm toàn bộ schema diff và tính nguyên tử trước khi nghiệm thu. Schema Trợ lý/tích hợp/release tương lai chuyển010/011/012 thành011/012/013, không đổi nghĩa. Bằng chứng prefix9 của Task1 giữ nguyên.
