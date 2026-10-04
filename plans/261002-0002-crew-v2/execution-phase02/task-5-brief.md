# Crew v2 phase 02 — Server và docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Plan freeze:** `phase02-r2-2026-10-02` (review findings I1/I2/I3/M1 addressed; controller records SHA256 after write).

**Goal:** API single-owner độc lập, lưu project/machine binding, cây ticket và quyền thực thi bền vững; nhập và tìm docs cũ không đổi v1, chạy lại không trùng.

**Architecture:** Thêm package `v2/server/` độc lập, gọi hàm thuần ở `v2/src/`, dùng Fastify và SQL PostgreSQL có transaction. Mọi mutation đi qua idempotency và event journal cùng transaction; ticket dùng optimistic revision, attempt dùng fencing và reconcile thực tế. Docs snapshot bất biến lưu byte gốc, checksum, nguồn commit và audit; chỉ snapshot đã xác minh mới được dùng làm bằng chứng hoàn tất.

**Tech Stack:** Node ≥24.12 (máy hiện tại 24.14.0 giữ nguyên), TypeScript 7.0.2, pnpm 10.32.1; Fastify 5.12.5, postgres 3.4.9, yaml 2.9.1, picomatch 4.0.7; PostgreSQL 18.6; `node:test`, Fastify `inject()`.

**Spec:** `docs/superpowers/specs/2026-10-01-crew-v2-design.md`; lộ trình `plans/261002-0002-crew-v2/plan.md`; phần trước `phase-01-domain-foundation.md`. Đọc cả spec đã duyệt, không chỉ kế hoạch này.

## Global Constraints

- “Ban đầu chỉ một owner. Web chạy trên VPS; app local chỉ hỗ trợ macOS. Mỗi dự án gắn đúng một máy thực thi.”
- “Chỉ chuyển nội dung docs và thông tin nhận diện cần thiết của các dự án đã tạo. Không chuyển ticket, lịch sử chạy, cấu hình agent, đăng ký máy hoặc credential v1.”
- “Server quản lý trạng thái và lệnh; suy luận của Trợ lý chạy local.”
- “Không coi mất heartbeat là bằng chứng tiến trình đã chết.”
- “Không đặt bảng ánh xạ model cứng dựa vào tên hãng.”
- “Tối đa 5 vòng sửa và kiểm tra lại cho cùng bước kiểm tra, không đếm lỗi hạ tầng hoặc chuyển model là vòng sửa.”
- “Deploy chỉ chạy khi owner duyệt hành động cụ thể trên web hoặc tạo ticket deploy.”
- “Giữ bản nhập nguyên trạng, đánh dấu kết quả audit; không tuyên bố docs cũ cập nhật với code nếu chưa đối chiếu checkout.”
- UI/docs prose tiếng Việt; identifier/path/key tiếng Anh; hiển thị giờ `Asia/Ho_Chi_Minh`, API ISO UTC.
- Workspace riêng `v2/`, Node ≥24.12, pnpm 10.32.1, strict/type stripping; không import business code, schema, runtime dependency hoặc DB v1. Root domain package vẫn không có runtime dependencies.
- Không sửa `.claude/**`, `.githooks/**`, `AGENTS.md`, `CLAUDE.md` hoặc manifest v1. Mở rộng `v2/docs/flows.yaml.source.include` trong phạm vi v2 do owner đã cho phép xây v2; controller ghi căn cứ/trailer nếu hook yêu cầu ticket key, không tự bịa ticket key.
- Không deploy; không restart shared/production DB. Test dùng container riêng, port loopback Docker chọn ngẫu nhiên, từ chối 5432/55432. Mọi schema/data migration trên DB v2 có backup+restore rehearsal trước.

## Review Focus

1. Hai mutation commit ngược thứ tự sequence: client replay cursor không mất event (Task 2).
2. Cùng idempotency key nhưng payload khác hoặc hai request đồng thời: một mutation, conflict rõ ràng, không replay credential cho actor khác (Task 2/3).
3. Mất heartbeat/hết lease rồi reconnect khi process cũ còn sống: không cấp quyền thứ hai, token cũ không ghi được sau replacement đã reconcile (Task 5).
4. Docs có CRLF, Unicode, filename phân biệt hoa thường, path traversal hoặc link hỏng: giữ byte, từ chối escape, audit minh bạch (Task 6).
5. Hai cạnh dependency đồng thời tạo cycle, binding đổi khi run hoạt động hoặc docs sync sai commit: reject trong transaction, không đóng request sai (Task 4/5/7).

## Quyết định stack và bằng chứng khảo sát (2026-10-02)

| Dependency/pin | Bằng chứng PRIMARY đã mở | Quyết định |
|---|---|---|
| Node floor ≥24.12; reference release 24.21.0 LTS | [Node release 24.21.0](https://nodejs.org/en/blog/release/v24.21.0), [Release schedule](https://github.com/nodejs/Release) | Có LTS 24; giữ runtime 24.14.0 hiện có vì floor phần 01, không nâng Node hệ thống |
| Fastify 5.12.5 | [Official stable release](https://github.com/fastify/fastify/releases/tag/v5.12.5), [v5 support](https://fastify.dev/docs/latest/Reference/LTS/), [v5 migration](https://fastify.dev/docs/v5.0.x/Guides/Migration-Guide-V5/) | Stable/security release; v5 hỗ trợ Node20+, hợp với Node24; không dùng v6 alpha |
| postgres 3.4.9 | [Official release](https://github.com/porsager/postgres/releases/tag/v3.4.9), [transaction API](https://github.com/porsager/postgres#transactions) | Tagged-template SQL, scoped transaction/automatic rollback; không cần ORM/schema generator |
| PostgreSQL 18.6 | [Official release notes](https://www.postgresql.org/docs/18/release-18-6.html), [row locks](https://www.postgresql.org/docs/18/explicit-locking.html), [FTS](https://www.postgresql.org/docs/18/textsearch.html) | Durable DB, row locks, recursive CTE, FTS `simple` (không giả định bộ stemmer tiếng Việt) |
| yaml 2.9.1 | [Official release](https://github.com/eemeli/yaml/releases/tag/v2.9.1) | Parse manifest giữ duplicate-key diagnostics, không dùng v3 prerelease |
| picomatch 4.0.7 | [Official release](https://github.com/micromatch/picomatch/releases/tag/4.0.7) | Match source globs với dotfiles theo hợp đồng docs; tách typing adapter nhỏ |
| TS7.0.2, @types/node26.6.3, pnpm10.32.1 | `v2/package.json`/`v2/pnpm-lock.yaml` của phần01 | Giữ pin đã chạy/review; không đổi bản domain |

Không thêm Redis, queue, SSE plugin, auth plugin, ORM hoặc markdown renderer. Fastify có JSON Schema validation và inject [official](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [testing](https://fastify.dev/docs/latest/Guides/Testing/). SQL migration viết tay, checksum migration. Chọn SSE journal poll 1 giây cho single-owner, heartbeat stream 15 giây; phase06 mới xây monitor 5 phút.

## Ranh giới phần 02 và hợp đồng bàn giao

Phần02 cung cấp durable API và fail-closed execution protocol; chưa chạy agent, không claim đã có sandbox skill, telemetry, capacity planner, signed updater hay attachment extraction. Phase03 thay test machine bằng pairing/host và reconcile process thật; phase04 thêm inventory/runtime switches; phase05 mở rộng comment/ticket attachment; phase06 cấp dispatch permit qua telemetry/workflow/model gates; phase08 xác minh merge và docs final gate. Server thật mặc định `authorizeDispatch` trả `DISPATCH_NOT_CONFIGURED`, không mở route start để bypass các gate tương lai.

Máy được provision lại bằng owner cho phase02, credential mới; không nhập đăng ký máy/token v1. Pairing UX và host protocol mở rộng ở phase03. Một project nhập ban đầu có `machineId:null,bindingState:'unbound'` vì owner phải gắn lại checkout; không dispatch khi unbound. Sau binding có đúng một máy, không multi-machine claims.

Docs chuẩn v1 là hợp đồng dữ liệu từ `packages/docs-kit/STANDARD.md`, không import `@crew/shared` hoặc implementation docs-kit vào runtime. Bundle v1 chỉ được dùng như công cụ đọc/kiểm tra developer bên ngoài runtime; validator v2 tự triển khai hợp đồng dữ liệu. Không tự sửa nội dung nhập để làm validator pass.

## File structure, ownership và thứ tự

Tất cả path dưới đây tính từ repo root. Mỗi task owner sở hữu source/test được liệt kê; controller tích hợp docs/manifest, lockfile, migration list và git theo thứ tự. Không agent nào tự commit trong lúc agent khác đang sửa index.

| Unit | File ownership | Phụ thuộc | Có thể chạy song song |
|---|---|---|---|
| 1 platform | `v2/server/package.json`, tsconfig/env, `src/platform/*`, `src/db/*`, scripts/test fixture | domain01 | trước mọi unit |
| 2 journal | `src/journal/*`, `test/journal.test.ts`, `migrations/002_journal.sql` | 1 | với 3 sau contracts freeze |
| 3 identity | `src/auth/*`, `src/projects/*`, tests, `migrations/003_identity.sql` | 1, journal interface2 | source với2; integration sau2 |
| 4 tickets | `src/tickets/*`, tests, `migrations/004_tickets.sql` | 2+3 | với docs6 |
| 5 execution | `src/execution/*`, tests, `migrations/005_execution.sql` | 4 | với docs6 |
| 6 docs ingest | `src/docs/{contracts,checksum,manifest,validator,links,import}.ts`, fixtures/tests, `migrations/006_docs.sql` | source unit: 2+3; SQL/integration: 4+5 | unit validator với4/5; SQL và DB acceptance sau5 |
| 7 docs read/assembly | `src/docs/{read,search,routes}.ts`, `src/app.ts`, `src/main.ts`, smoke/read tests | 1–6 | sau integration |

Mỗi task cập nhật trang flow sở hữu code cùng commit; controller serialize `v2/docs/flows.yaml`, `v2/docs/index.md`, `v2/docs/files.md`, `v2/docs/architecture.md`. Files `app.ts`/`main.ts` chỉ Task7 sửa. Không đổi domain policy trong phần02; nếu test phơi bug miền, báo controller và làm correction task riêng có review.

## Contract freeze trước triển khai

### Primitive và transaction

`v2/server/src/platform/contracts.ts` định nghĩa:

```ts
import type { Sql, TransactionSql } from 'postgres';
import type { Status, Signal } from '../../../src/ticket-policy.ts';
import type { Pin } from '../../../src/workflow-policy.ts';
export type Id = string; // UUID; validate tại route, không cast input không kiểm tra
export type Revision = number; // integer >=1; fence/cursor wire dùng decimal string
export type Actor = { kind:'owner'; id:'owner' } | { kind:'machine'; id:Id };
export type Db = Sql;
export type Tx = TransactionSql;
export type Mutation<T> = {status:number; body:T};
export type ApiErrorBody = {error:{code:string; message:string; details?:unknown}};
export type Event = {cursor:string; type:string; projectId:Id|null; ticketId:Id|null;
  audienceMachineId:Id|null; occurredAt:string; data:Record<string,unknown>};
export type EventInput = Omit<Event,'cursor'|'occurredAt'>;
export type MutationContext = {actor:Actor; route:string; key:string; body:unknown};
export type DispatchPermit = {commandId:Id; ticketId:Id; machineId:Id;
  bindingRevision:number; ticketRevision:number; workflow:Pin;
  checkedAt:string; expiresAt:string; telemetryId:Id; decisionId:Id};
export type AuthorizeDispatch = (tx:Tx, actor:Actor, permit:DispatchPermit) => Promise<void>;
export type ServerOptions = {db:Db; publicOrigin:string; secureCookies:boolean;
  sessionEncryptionKey:Buffer; now:()=>Date; authorizeDispatch:AuthorizeDispatch;
  verifyFinalResult:(tx:Tx,input:{attemptId:Id;ticketId:Id;kind:'code'|'research'|'docs'|'deploy';
    outcome:'passed'|'retry'|'needs_input';evidenceIds:Id[]})=>Promise<void>};
export type Mutator = <T>(c:MutationContext,work:(tx:Tx)=>Promise<Mutation<T>>)=>Promise<Mutation<T>>;
export type ResponseCodec = {
  encode<T>(c:MutationContext,result:Mutation<T>):unknown;
  decode<T>(c:MutationContext,status:number,response:unknown):Mutation<T>;
};
export type TicketSignal = Signal;
export type TicketStatus = Status;
```

Platform contracts thêm `Authenticator={authenticate:(request:FastifyRequest)=>Promise<Actor>,requireOwner:(request:FastifyRequest,input:{csrf:boolean})=>Promise<Actor>}` và `RouteDependencies={mutator:Mutator,auth:Authenticator}`; Mỗi route module xuất `registerXRoutes(app:FastifyInstance,options:ServerOptions,deps:RouteDependencies):void` (X=Ticket,Execution,Docs); project có thêm BindingGuard như Task3. Auth module xuất `createAuthenticator(db:Db,options:{now:()=>Date,publicOrigin:string}):{authenticate:(request:FastifyRequest)=>Promise<Actor>,requireOwner:(request:FastifyRequest,input:{csrf:boolean})=>Promise<Actor>}`; route factories nhận deps.auth, không đổi signatures tùy task. Không dùng ambient authenticate.

HTTP JSON: additionalProperties:false; mọi app/test factory dùng `ajv:{customOptions:{removeAdditional:false}}` để reject field dư thay vì silently strip (Fastify mặc định removeAdditional:true); UUID IDs, safe integer revision, canonical hex SHA256, 40/64 hex commit; no enums accepted through inherited object keys. Errors stable codes, tiếng Việt message. Map 400 validation, 401 authentication, 403 scope/origin, 404 inaccessible/not found, 409 revision/idempotency/state/cycle/fence conflict, 413 limits, 422 checksum/docs validation, 503 DB unavailable. Không gửi stack/SQL/token/password. Body limit thường 1MiB, import riêng 24MiB encoded/16MiB decoded. Pagination limit1–100, default50, stable ID/cursor order.

`createMutator(db:Db,codec?:ResponseCodec):Mutator` tạo mutator cho route; `mutate<T>(db:Db,c:MutationContext,work:(tx:Tx)=>Promise<Mutation<T>>):Promise<Mutation<T>>` là wrapper plain codec cho tests/services không trả secret; `appendEvent(tx:Tx,e:EventInput):Promise<Event>`; `readEvents(db:Db,actor:Actor,after:string,limit:number,scope:EventScopeReader):Promise<Event[]>`. Idempotency required cho mọi POST/PUT/PATCH/DELETE ngoài login/logout, scoped `(actor.kind,actor.id,route,key)`, 1–128 printable ASCII chars. Body hash canonical sorted JSON; route scope chứa normalized path với ID; lỗi trước work không giữ key, successful response giữ vĩnh viễn (single-owner), đổi payload 409.

### Route inventory — không route v1

| Method/path | Principal | Input → output |
|---|---|---|
| GET `/v2/health` | public | `{status:'ok',schemaVersion:number}`; DB lỗi503 |
| POST `/v2/auth/session` | public + Origin | `{password}` → `{owner:{id:'owner'},csrfToken}` + cookie |
| DELETE `/v2/auth/session` | owner+CSRF | 204, revoke session |
| GET `/v2/auth/session` | owner | owner+CSRF, không password/hash |
| POST `/v2/projects` | owner | `{key,name,repositoryUrl:null|string}` → Project201 |
| GET `/v2/projects` | owner | `{items:Project[],nextCursor:null|string}` |
| POST `/v2/machines` | owner | `{name}` → `{machine,token}`201, token đúng một logical mutation |
| GET `/v2/machines` | owner | machine metadata, không token/hash |
| PUT `/v2/projects/:id/binding` | owner | `{machineId,checkoutPath,expectedRevision}` → Project200 |
| POST `/v2/tickets` | owner hoặc bound machine | CreateTicket → Ticket201 |
| GET `/v2/tickets` | owner; machine chỉ project bound | projectId/status/kind/rootId/cursor → items |
| GET `/v2/tickets/:id` | same scope | Ticket + comments/decisions paginated riêng qua routes dưới |
| GET `/v2/tickets/:id/graph` | same scope | `{nodes:Ticket[],dependencies:Dependency[],repairLinks:RepairLink[]}` |
| POST `/v2/tickets/:id/dependencies` | owner/bound machine | `{predecessorId,expectedRevision}` → Dependency201 |
| POST `/v2/tickets/:id/signals` | owner/bound machine | `{signal,expectedRevision,evidenceId?:Id}` → Ticket200; confirmed process signals chỉ qua execution service |
| POST/GET `/v2/tickets/:id/comments` | same scope | `{text}` → Comment201; list; text1–32768 chars; attachment phase05 |
| POST/GET `/v2/tickets/:id/decisions` | owner/bound machine | DecisionInput → Decision201/list; deploy approval chỉ owner |
| POST `/v2/tickets/:id/repair-results` | bound machine fenced attempt | `{attemptId,fence,cycleId,classification:'initial_review'|'repair_review'|'infrastructure'|'model',passed,evidence}` → Ticket200 |
| POST `/v2/commands` | owner/bound machine; start thêm permit | `{machineId,ticketId,type,payload}` → Command202 |
| GET `/v2/machine/commands` | machine | after cursor → outstanding queued/received commands thuộc chính máy |
| POST `/v2/machine/commands/:id/ack` | target machine | `{phase:'received'|'completed',result?:object}` → Command200 |
| POST `/v2/machine/commands/:id/claim` | target machine + dispatch gate | `{processInstanceId,permit}` → Attempt201 |
| POST `/v2/machine/attempts/:id/checkpoint` | target machine | `{fence,sequence,step,artifactIds,commit:null|string,processInstanceId}` → Attempt200 |
| POST `/v2/machine/attempts/:id/artifacts` | target machine | `{fence,processInstanceId,locator,sha256,sourceCommit}` → `{id,locator,sha256}` 201; exact idempotent replay |
| POST `/v2/machine/attempts/:id/result` | target machine | `{fence,processInstanceId,outcome,evidenceIds,reason}` → Attempt200, finalizing or finalized |
| POST `/v2/machine/attempts/:id/finalize` | target machine | `{fence,processInstanceId}` + new idempotency key → re-evaluate stored result, Attempt200 |
| POST `/v2/machine/attempts/:id/reconcile` | target machine | `{fence,processInstanceId,observation:'running'|'stopped',artifacts,stopReason:null|'pause'|'cancel'|'exit'}` → Attempt200 |
| GET `/v2/events` | owner/machine filtered | after decimal cursor → `{items:Event[],cursor:string}` |
| GET `/v2/events/stream` | owner cookie/machine bearer | Last-Event-ID → SSE `id:cursor,event:type,data:JSON`; replay trước tail |
| POST `/v2/docs/imports` | owner | DocsImport → ImportResult201/replay200 logical status preserved |
| POST `/v2/projects/:id/docs/snapshots` | bound machine | DocsSync + fence/attempt (active or reserved finalizing; matching guard, no replacement) → Snapshot201 |
| GET `/v2/docs/overview` | owner; machine assigned projects | project docs state + latest imported/latest verified commit |
| GET `/v2/projects/:id/docs/tree` | same scope | snapshotId optional → page tree/links/status |
| GET `/v2/projects/:id/docs/page` | same scope | snapshotId,path → original UTF8 text/checksum/source/audit |
| GET `/v2/docs/search` | owner; machine scoped | q/projectId/snapshotId/cursor → DocsHit[]/nextCursor |
| PUT `/v2/tickets/:id/docs-links` | same scope | `{snapshotId,paths,expectedRevision}` → related immutable page refs |

Owner session mutations require exact public Origin + `X-CSRF-Token`, bearer machine routes không cookie fallback. GET SSE không expose token trong URL. Máy có đọc docs liên dự án chỉ khi phase06 thêm explicit assistant capability; phase02 deny cross-project. Logout không replay revoked session. Provision-machine idempotent replay chỉ owner session còn hợp lệ, encrypted token response trong idempotency store (Task3), không raw plaintext token DB.

### Bảng dữ liệu — exact columns và constraints

Migrations trong `v2/server/migrations/`; mọi FK `ON DELETE RESTRICT`, không cascade xóa bằng chứng. UUID sinh Node `randomUUID()`, UTC `timestamptz`, bigint wire decimal string. Các JSONB không chứa credential. PK/unique/check bên dưới bắt buộc ở DB, không chỉ service.

- `001_platform.sql`: `schema_migrations(version integer PK, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL)`; `system_identity(singleton boolean PK CHECK(singleton), system_name text NOT NULL CHECK(system_name='crew-v2'))` marker. DB name bắt đầu `crew_v2_`; migrate xác minh marker/name, không lấy env `DATABASE_URL` v1; chỉ `CREW_V2_DATABASE_URL`.
- `002_journal.sql`: `event_cursor(singleton boolean PK CHECK(singleton), value bigint NOT NULL CHECK(value>=0))` seed0; `events(cursor bigint PK,type text,project_id uuid NULL,ticket_id uuid NULL,audience_machine_id uuid NULL,data jsonb,occurred_at timestamptz)`; `idempotency(actor_kind text,actor_id text,route text,key text,body_hash char(64),status integer,response jsonb,created_at timestamptz,PRIMARY KEY(actor_kind,actor_id,route,key))`. Token replay response ciphertext in response field; business response normal JSON. Index events(project_id,cursor), events(audience_machine_id,cursor).
- `003_identity.sql`: `owners(id text PK CHECK(id='owner'),password_salt text,password_hash text)`; `sessions(id_hash char(64) PK,owner_id text FK owners,csrf_hash char(64),csrf_ciphertext text,expires_at timestamptz,revoked_at timestamptz NULL)`; `machines(id uuid PK,name text,token_hash char(64) UNIQUE,created_at timestamptz,revoked_at timestamptz NULL)`; `projects(id uuid PK,key text UNIQUE,name text,repository_url text NULL,machine_id uuid NULL FK machines,checkout_path text NULL,binding_revision integer DEFAULT1 CHECK(>0),expected_commit text NULL,created_at timestamptz,CHECK((machine_id IS NULL)=(checkout_path IS NULL)))`; `legacy_projects(source_system text,legacy_id text,project_id uuid UNIQUE FK projects,PRIMARY KEY(source_system,legacy_id))`.
- `004_tickets.sql`: `tickets(id uuid PK,project_id uuid FK projects,parent_id uuid NULL FK tickets,root_id uuid FK tickets,level text CHECK IN('request','step','task'),kind text CHECK IN('code','research','docs','deploy'),title text,description text,status text CHECK IN(domain Status),wait_reason text NULL,revision integer DEFAULT1 CHECK(>0),mandatory boolean DEFAULT true,criteria jsonb,inputs jsonb,outputs jsonb,skill text NULL,workflow_pin jsonb NULL,repair_cycles integer DEFAULT0 CHECK BETWEEN0 AND5,merged_commit text NULL,evidence_id uuid NULL,created_at timestamptz)`; request root_id=self insert deferred FK `DEFERRABLE INITIALLY DEFERRED`. Unique(id,project_id), index(project_id,status,id), index(root_id,id). `dependencies(ticket_id uuid FK tickets,predecessor_id uuid FK tickets,PRIMARY KEY(ticket_id,predecessor_id),CHECK(ticket_id<>predecessor_id))`; `repair_links(check_step_id uuid FK tickets,fix_ticket_id uuid FK tickets,cycle_id uuid,PRIMARY KEY(check_step_id,cycle_id))`; `comments(id uuid PK,ticket_id uuid FK tickets,actor_kind text,actor_id text,text text,created_at timestamptz)`; `decisions(id uuid PK,ticket_id uuid FK tickets,actor_kind text,actor_id text,kind text CHECK IN('assessment','delegated','owner_answer','approval','intervention','dispatch'),content text,rationale text,sources jsonb,scope jsonb,created_at timestamptz)`; `evidence(id uuid PK,ticket_id uuid FK tickets,attempt_id uuid NULL,kind text,data jsonb,created_at timestamptz)`; `repair_results(check_step_id uuid FK tickets,cycle_id uuid,classification text,passed boolean,evidence_id uuid FK evidence,PRIMARY KEY(check_step_id,cycle_id))`; `ticket_docs(ticket_id uuid FK tickets,snapshot_id uuid,path text,PRIMARY KEY(ticket_id,snapshot_id,path))`, add docs FK Task6.
- `005_execution.sql`: `commands(id uuid PK,machine_id uuid FK machines,ticket_id uuid FK tickets,type text CHECK IN('start','pause','cancel','resume','reconcile'),payload jsonb,state text CHECK IN('queued','received','completed'),result jsonb NULL,created_at timestamptz,received_at timestamptz NULL,completed_at timestamptz NULL)`; `execution_guards(ticket_id uuid PK FK tickets,fence bigint DEFAULT0 CHECK(>=0),active_attempt_id uuid NULL)`; `attempts(id uuid PK,ticket_id uuid FK tickets,machine_id uuid FK machines,command_id uuid UNIQUE FK commands,fence bigint,binding_revision integer,process_instance_id text,state text CHECK IN('active','uncertain','finalizing','stopped'),lease_expires_at timestamptz,workflow_pin jsonb,checkpoint jsonb,checkpoint_sequence bigint DEFAULT0,stopped_at timestamptz NULL,stop_reason text NULL,terminal_intent text CHECK IN('complete','retry','pause','cancel','needs_input') DEFAULT 'complete',terminal_reason text NULL,terminal_result jsonb NULL,finalized_at timestamptz NULL,UNIQUE(ticket_id,fence))`; partial UNIQUE(ticket_id) WHERE state IN('active','uncertain','finalizing'); guard.active FK deferred to attempts. `process_instance_id` denotes host durable launch UUID, not OS PID; no process-id reuse. evidence.attempt FK added here.
- `006_docs.sql`: `docs_imports(id uuid PK,source_system text,backup_manifest_sha char(64),bundle_sha char(64),report jsonb,created_at timestamptz,UNIQUE(source_system,bundle_sha))`; `docs_snapshots(id uuid PK,project_id uuid FK projects,import_id uuid NULL FK docs_imports,source_commit text NULL,snapshot_sha char(64),source_kind text CHECK IN('legacy_import','checkout_sync'),audit_state text CHECK IN('unverified','invalid','verified'),audit_report jsonb,content_class text CHECK IN('implemented','workflow_artifact','mixed'),received_at timestamptz,provenance unique expression index described Task6)`; `docs_files(snapshot_id uuid FK docs_snapshots,path text,content_class text CHECK IN('implemented','workflow_artifact'),bytes bytea,sha char(64),title text,search_text text,search_vector tsvector GENERATED ALWAYS AS(to_tsvector('simple',search_text)) STORED,PRIMARY KEY(snapshot_id,path))`; GIN(search_vector). `docs_links(snapshot_id uuid,from_path text,occurrence integer CHECK(>=0),original_href text,to_path text,fragment text NULL,status text CHECK IN('ok','missing','external','unverified'),PRIMARY KEY(snapshot_id,from_path,occurrence),FOREIGN KEY(snapshot_id,from_path) REFERENCES docs_files)`; ticket_docs(snapshot_id,path) composite FK docs_files. Add `projects.latest_imported_snapshot_id uuid NULL` and `latest_verified_snapshot_id uuid NULL` with FKs docs_snapshots; service confirms same project under row lock. `docs_sync_receipts(attempt_id uuid FK attempts,merged_commit text,snapshot_id uuid FK docs_snapshots,PRIMARY KEY(attempt_id,merged_commit))`.

Schema title uses compact column notation: every named column NOT NULL unless explicitly NULL; check-list enum notation is translated literal SQL `CHECK (column IN (...))`, timestamp defaults `now()`, JSONB default objects/lists only where caller provides no field. Test file migration prefixes are frozen: platform1, journal2, identity3, tickets4, execution5, docs-import6, final acceptance6. Every file binds `const withDatabase=databaseFixture(N)` with its exact N; integration fixtures never migrate a dynamic all-files directory. Task6 validator unit tests do not open DB. Task6 writes draft006 only after Task5 SQL gate passes; until then docs import tests are not run/claimed RED. Production migrate uses explicitly captured release migration set, not new SQL appearing during execution. No schema mutation runs on app startup. Migration runner reads sorted SQL paths, hashes SQL, rejects changed applied version, transaction/advisory lock `crew-v2-migrations`; deploy migration explicitly later.

## Task 5: Durable commands, fenced attempts and reconnect reconciliation

**Owner:** execution worker. **Files:** create `src/execution/{contracts,commands,attempts,reconcile,routes}.ts`, `migrations/005_execution.sql`, `test/{commands,attempts}.test.ts`; wire binding guard through function export, no edit app.ts. Docs `server-execution.md`.

**Interfaces:** `Command={id:Id,machineId:Id,ticketId:Id,type:'start'|'pause'|'cancel'|'resume'|'reconcile',payload:Record<string,unknown>,state:'queued'|'received'|'completed',result:Record<string,unknown>|null}`; `Attempt={id:Id,ticketId:Id,machineId:Id,commandId:Id,fence:string,bindingRevision:number,processInstanceId:string,state:'active'|'uncertain'|'finalizing'|'stopped',leaseExpiresAt:string,workflowPin:Pin,checkpoint:Checkpoint}`; `Checkpoint={sequence:string,step:string,artifactIds:Id[],commit:string|null,processInstanceId:string}`. `claimAttempt(tx,commandId,input:{processInstanceId:string,permit:DispatchPermit},actor,authorizeDispatch):Promise<Attempt>`; `saveCheckpoint(tx,attemptId,input:Checkpoint & {fence:string},actor):Promise<Attempt>`; `reconcileAttempt(tx,attemptId,input:{fence:string,processInstanceId:string,observation:'running'|'stopped',artifacts:Id[],stopReason:null|'pause'|'cancel'|'exit'},actor):Promise<Attempt>`; `assertNoActiveProjectExecution(tx,projectId):Promise<void>` implements Task3 BindingGuard. `CreateCommand={machineId:Id,ticketId:Id,type:Command['type'],payload:Record<string,unknown>}`; `createCommand(tx:Tx,input:CreateCommand,actor:Actor):Promise<Command>`; `ackCommand(tx:Tx,commandId:Id,input:{phase:'received'|'completed',result?:Record<string,unknown>},actor:Actor):Promise<Command>`; `listCommands(db:Db,actor:Actor,after:Id|null,limit:number):Promise<Command[]>`. Command ack result does not signal process stopped; reconcile is separate.

**Terminal contracts (I1):** `TerminalIntent='complete'|'retry'|'pause'|'cancel'|'needs_input'`; `AttemptResultInput={fence:string,processInstanceId:string,outcome:'passed'|'retry'|'needs_input',evidenceIds:Id[],reason:string|null}`; `submitAttemptResult(tx:Tx,attemptId:Id,input:AttemptResultInput,actor:Actor):Promise<Attempt>`; `requestTerminalIntent(tx:Tx,ticketId:Id,input:{intent:'pause'|'cancel'|'needs_input',reason:string,decisionId:Id},actor:Actor):Promise<Command|null>`; `finalizeAttempt(tx:Tx,attemptId:Id,verify:FinalResultVerifier):Promise<Attempt>`; `FinalResultVerifier=ServerOptions['verifyFinalResult']` rejects unverified completion/retry authority. `verifyFinalResult` is frozen in Task1 ServerOptions with primitive facts only (no import of later execution module); production default denies completion requiring unavailable trusted verifier, while phase02 research/docs owner approval explicitly references immutable evidence and fulfills research criteria; never accepts client `verified:true`. Phase08 supplies trusted merge/docs verifier. Attempt DTO adds terminalIntent, terminalReason, terminalResult, stoppedAt, finalizedAt. Result endpoint `POST /v2/machine/attempts/:id/result` accepts AttemptResultInput, target machine only, idempotent. Evidence arrives through append-only evidence record with attempt/project linkage; result cannot refer other attempt evidence.

Atomic flow (same journal mutation transaction, locked ticket+guard+attempt): (1) validate actor/fence/launch identity, (2) persist result or stopped observation independently, (3) call finalizeAttempt; if physically still running, no status change; if stopped but complete result missing/unverified, keep finalizing+guard and running/final_result_pending; (4) confirmed pause/cancel intent applies pause_confirmed/cancel_confirmed from running; needs_input applies wait_owner from running with stored reason/decision; complete with outcome passed invokes verifier and completion facts then passed; explicit retry outcome invokes verifier authorizing retry then reconciled_stopped; (5) in the same transaction update ticket revision/status/reason, attempt.state=stopped/finalized_at, clear guard only WHERE active_attempt_id matches, append terminal event. Verifier refusal/unavailability is persisted finalizing with error reason and no release (result API200 pending finalization), not rollback lost stop proof. `finalizeAttempt` catches only explicit ApiError verification-gate codes and records pending reason; unexpected DB/service errors roll transaction back safely. Late result insertion uses fenced result route; to keep minimal protocol result payload remains immutable after accepted submission: submit can reference previously reported evidenceId, verifier state may advance, same original idempotency key always returns cached response and does not rerun finalization; a new finalize mutation key below explicitly re-evaluates stored result. Use a new idempotency key for re-evaluate action `POST /v2/machine/attempts/:id/finalize` body `{fence,processInstanceId}`; exact service `recheckFinalization(tx:Tx,attemptId:Id,input:{fence:string,processInstanceId:string},actor:Actor):Promise<Attempt>` validates same reserved guard and invokes finalizeAttempt using stored result. Completion evidence records verification advancement are append-only verifier attestations linked to original evidenceId, not overwriting evidence bytes. This endpoint never creates an attempt or changes result data. Malformed evidence/other attempt422 rolls back incoming result. Result before exit persists pending, exit later finalizes; exit before result reserves until late result. Lease timeout does not block result/reconcile in finalizing; checkpoint progress writes after physical stop reject PROCESS_STOPPED. Owner cancellation dominates all results; needs_input (including fifth failed repair cycle) dominates pause/complete/retry; explicit owner pause dominates normal result; once cancelled intent committed cannot revert. Result outcome needs_input creates a scoped question decision and terminal_intent needs_input unless cancel already wins; reason required. Result changing after finalization409 except identical replay. Retry clears guard only after recorded result handled; dependency readiness is a subsequent checked mutation, never automatic ready on exit.

```ts
test('exit trước result và restart vẫn hoàn tất từ running',async()=>withDatabase(async db=>{
  const f=await executionFixture(db); const a=await f.claim('launch-result');
  await f.reconcile(a,{observation:'stopped',stopReason:'exit'});
  assert.equal((await f.readAttempt(a.id)).state,'finalizing');
  assert.equal((await f.readTicket()).status,'running');
  await assert.rejects(()=>f.claimReplacement('second'),{code:'FINAL_RESULT_PENDING'});
  await f.restart(); // close/reopen service/app pool to same own test DB
  const evidence=await f.verifiedResearchEvidence(a.id);
  await f.submitResult(a,{outcome:'passed',evidenceIds:[evidence.id],reason:null});
  assert.equal((await f.readTicket()).status,'done');
  assert.equal((await f.readAttempt(a.id)).state,'stopped');
  assert.equal(await f.activeGuard(),null);
}));
test('result trước exit không đóng khi process còn chạy',async()=>withDatabase(async db=>{
  const f=await executionFixture(db); const a=await f.claim('launch-early');
  const e=await f.verifiedResearchEvidence(a.id);
  await f.submitResult(a,{outcome:'passed',evidenceIds:[e.id],reason:null});
  assert.equal((await f.readTicket()).status,'running');
  await f.reconcile(a,{observation:'stopped',stopReason:'exit'});
  assert.equal((await f.readTicket()).status,'done');
}));
test('wait_owner và vòng sửa thứ năm giữ đúng ý định sau stop',async()=>withDatabase(async db=>{
  const f=await executionFixture(db); const a=await f.claim('launch-question');
  await f.waitOwner('Cần quyết định owner');
  await f.reconcile(a,{observation:'stopped',stopReason:'pause'});
  assert.equal((await f.readTicket()).status,'needs_input');
  const g=await executionFixture(db,{repairCycles:4}); const b=await g.claim('launch-cycle5');
  await g.reconcile(b,{observation:'stopped',stopReason:'exit'});
  await g.recordRepairFailure(b,'cycle-five'); // completed repair-review, fenced evidence
  assert.equal((await g.readTicket()).repairCycles,5);
  assert.equal((await g.readTicket()).status,'needs_input');
}));
```

```ts
test('evidence đã báo được xác minh sau stop recheck không cần attempt mới',async()=>withDatabase(async db=>{
  const f=await executionFixture(db); const a=await f.claim('launch-verify-late');
  const e=await f.reportedResearchEvidence(a.id);
  await f.submitResult(a,{outcome:'passed',evidenceIds:[e.id],reason:null});
  await f.reconcile(a,{observation:'stopped',stopReason:'exit'});
  assert.equal((await f.readAttempt(a.id)).state,'finalizing');
  await f.attestEvidence(e.id); // append verifier attestation; original report unchanged
  await f.recheckFinalization(a,'new-finalization-key');
  assert.equal((await f.readTicket()).status,'done');
  assert.equal((await f.readAttempt(a.id)).fence,a.fence);
  assert.equal(await f.activeGuard(),null);
}));
```

Test fixture extends concrete methods shown above; no production bypass. Add response-lost after terminal commit→repeat same result returns done, exactly one terminal event/fence release; cancelled/pause override passed result; unverified late evidence keeps finalizing across restart; result+stop concurrent commits produce exactly one finalize. `recordRepairResult` invokes requestTerminalIntent then finalizeAttempt in same tx if fifth failure and process already finalizing; stopped finished unrelated attempts cannot alter newer run status.

- [ ] Write RED lease concurrency test using service fixture `executionFixture(db)` in `test/support/execution.ts`, grants valid permit only test callback, creates bound machine/project/ticket/queued start:

```ts
test('lease expiry không chứng minh process đã dừng',async()=>withDatabase(async db=>{
  const f=await executionFixture(db);
  const first=await f.claim('launch-1');
  await f.expire(first.id); // UPDATE only test DB lease_expires_at, no wall-clock wait
  await assert.rejects(()=>f.claimReplacement('launch-2'),{code:'RECONCILE_REQUIRED'});
  await f.reconcile(first,{observation:'running',stopReason:null});
  await assert.rejects(()=>f.claimReplacement('launch-2'),{code:'ACTIVE_EXECUTION'});
  await f.reconcile(first,{observation:'stopped',stopReason:'exit'});
  await assert.rejects(()=>f.claimReplacement('launch-2'),{code:'FINAL_RESULT_PENDING'});
  await f.submitResult(first,{outcome:'retry',evidenceIds:[],reason:'Hạ tầng lỗi; tiến trình đã dừng'});
  const second=await f.claimReplacement('launch-2');
  assert(BigInt(second.fence)>BigInt(first.fence));
  await assert.rejects(()=>f.checkpoint(first,{sequence:'1'}),{code:'STALE_FENCE'});
}));
test('claim đồng thời chỉ một quyền thực thi',async()=>withDatabase(async db=>{
  const f=await executionFixture(db);
  const outcomes=await Promise.allSettled([f.claim('launch-a'),f.claim('launch-b')]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await db`select count(*)::int as n from attempts where state in ('active','uncertain','finalizing')`)[0]?.n,1);
}));
```

- [ ] RED `pnpm --dir v2/server test --test-name-pattern='lease expiry|claim đồng thời|checkpoint|pause'`. Add command duplicate ack received/completed→same result, different completion body409; pause/cancel request retains running until process stopped; old/revoked/wrong machine403; checkpoint lower sequence409, duplicate identical sequence replay, duplicate sequence changed data409; binding update while uncertain409; all tests durable across closing/reopening pools.
- [ ] Implement under mutation global lock then project/root/ticket guard row locks. Create guard row with `INSERT INTO execution_guards(ticket_id) VALUES (...) ON CONFLICT DO NOTHING` before locking. Initial claim: target machine authenticated + current binding matches + ticket ready + command received/queued + exact pin + authorizeDispatch validates fresh permit (same tx). Pin workflow immutable per attempt; pin change creates new command/run context, never overwrite attempt. Only after gate increment guard fence and create attempt, apply domain start, append event in transaction:

```ts
const [guard]=await tx`select * from execution_guards where ticket_id=${ticket.id} for update`;
if(guard.active_attempt_id)throw new ApiError('RECONCILE_REQUIRED',409,'Cần đối chiếu tiến trình cũ');
await authorizeDispatch(tx,actor,input.permit);
const [g]=await tx`update execution_guards set fence=fence+1 where ticket_id=${ticket.id} returning fence`;
const attemptId=randomUUID();
await tx`insert into attempts(id,ticket_id,machine_id,command_id,fence,binding_revision,
  process_instance_id,state,lease_expires_at,workflow_pin,checkpoint,checkpoint_sequence)
  values(${attemptId},${ticket.id},${actor.id},${command.id},${g.fence},${project.binding_revision},
  ${input.processInstanceId},'active',now()+interval '60 seconds',${tx.json(input.permit.workflow)},${tx.json({})},0)`;
await tx`update execution_guards set active_attempt_id=${attemptId} where ticket_id=${ticket.id}`;
```

`authorizeDispatch` production default throws503 `DISPATCH_NOT_CONFIGURED`; no request may opt into test bypass. Phase06 implementation checks telemetry age/config capacity/dependencies/model/workflow/version and persists decision IDs; Task5 checks permit shape/time and target equality before callback, TTL<=30seconds, future checkedAt >5seconds reject, expired reject; incoming permit references cannot manufacture permission. Production gate callback receives stored command/ticket actor context from service, not unchecked permit only; freeze callback extended signature `(tx,actor,permit)` and require it load command/ticket itself by IDs.

Command types start/resume require gate at claim; pause/cancel/reconcile owner allowed irrespective unavailable model. Claim existing command+same processInstanceId returns existing attempt (even after response lost), different processInstanceId409; does not manufacture new fence. Checkpoint verifies guard.active_attempt_id, fence, binding revision, processInstanceId, machine target; lease expiry blocks writes except reconciliation, records uncertain and no second launch. Reconcile stopped must come authenticated host with matching durable launch ID and fence, observation provenance stored; browser owner cannot submit stop proof. Stopped observation changes attempt to `finalizing`, records stopped_at/stop_reason, and keeps guard reserved; ticket remains running with wait_reason `final_result_pending` until terminal result handled. Only atomic `finalizeAttempt` specified above changes ticket and releases guard; no separate passed from pending. Host cannot report new attempt stopped to close different process. Network/heartbeat timestamps alone never clear guard.

Artifacts references are durable UUIDs plus source metadata in checkpoint/evidence; no raw file filesystem deletion here. To eliminate arbitrary unregistered references phase02 evidence store defines `artifact` kind with canonical locator/checksum, append-only and same project; `artifactIds` resolve evidence records. Phase05 can add attachment references without erasing these IDs.

**Task 5 wire addendum (PM approved):** The authenticated machine artifact endpoint requires `Idempotency-Key`, the exact current attempt fence and process instance, and the current project binding revision. `locator` is a run-relative NFC path (1–4096 characters; no absolute path, empty/`.`/`..` segment, backslash, colon, control byte, `%`, `?`, or `#`); `sha256` is 64 lowercase hex characters; `sourceCommit` is a 40/64-character lowercase Git hash or `null`. The server appends same-attempt evidence with `data.verification='reported'` without opening the locator, reading bytes, or fetching a URL. Registration during `finalizing` is permitted while the same guard/fence/process remain current, including a result-before-stop race. New registration after finalization is rejected; exact durable response replay is returned only after fresh transactional ACL/current-binding authorization. Checkpoint and result references must resolve to IDs on this attempt. Phase 03 produces owned artifacts; Phase 08 verifies actual receipts.

- [ ] GREEN tests process still alive/reconnect, crash after DB commit before HTTP reply returns same attempt, restart keeps fence, two pool instances cannot claim concurrently, late old checkpoint after replacement409. Test no configured gate makes server503 and zero attempt/event/status mutation.
- [ ] Update execution docs with protocol truth limits (machine attestation, real host stopping in03) and serialized commit `feat(v2): persist fenced execution and process reconciliation`; independent review permission escalation/fence wrap/lease misconception.


## PM handoff

Worktree /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew. Own task source/tests/flow only; controller owns shared contracts/manifests/index/Git/commits. Other workers are active, don't revert their edits. No subagents/commits/global changes/shared DB. Source interfaces captureMigrations(through,migrationsDir?), migrate(db,set), databaseFixture(prefix)(fn); exact migration prefix per test. Test runner supports --test-file absolute scratch fixture and owns isolated Docker container. Use TDD + writing-good-tests. Meaningful behavior RED/GREEN, focused tests during iteration, one full stable suite, typecheck and original rootBiome ownedfiles. All Fastify factories ajv.customOptions.removeAdditional=false; unknown input400. Flow headings exact Mục đích, Điểm vào, Các bước (numbered file→symbol), Files (table), Dữ liệu, Flow liên quan, Tests. Full report file task-5-report.md samefolder with tests/commands/output/files/selfreview/concerns, finalDONEshort.

Journal whitelist metadata event contracts in journal/event-contracts.ts; new producer types require narrow PMauthorised extension with focused tests and review. No dynamic public registration/unknownpayload. Consumer typed interfaces frozen; no client boolean authorizations. Phase06 dispatch/phase08 final verifier defaults failclosed until implemented. Source/checksum/evidence mustnotbe claimedtruthful merely because recorded. If later schema table unavailable, provide required injectable failclosed reader/callback and test available pure/DBparts; don't query absent table or invent permissive productionbypass. Later integration phase supplies real authority. TellPM exact dependency gap.

## PM protocol addendum — 2026-10-02, reconnect reads

Task 5 keeps `listCommands(..., after:Id|null, ...)` as pagination over outstanding commands, ordered by immutable `(created_at,id)` with the anchor looked up among all commands belonging to the actor (including completed anchors). `after` is a page anchor, not a durable event cursor: host starts each polling/reconnect pass at null and deduplicates through its durable command journal. New commands with lower random UUIDs must still appear on the next pass. The response is `{items,nextCursor}`; cursor is last returned ID only when another outstanding page exists. Missing/foreign anchor rejects without leaking its existence. Limits 1–100, default 50, strict query fields.

Add authenticated read-only `GET /v2/machine/commands/:id` and `GET /v2/machine/attempts/:id`, target machine only, returning current Command/Attempt. They recheck current machine revocation and project binding; foreign/old binding records return scoped 404. These reads let the gateway recover current state after a response is lost without relying on an earlier mutation's cached response or creating another attempt. Production reads cannot manufacture permits or stop proof. Export `readCommand(db,id,actor)` and `readAttempt(db,id,actor)` with the same scope, add negative tests and close/reopen-pool replay tests.

The separate Phase03 `/v2/gateway/commands` journal cursor remains an ordered durable cursor for workflow-sync commands; it is not interchangeable with the Phase02 page anchor. The Phase03 bridge consumes the two read endpoints above to reconcile ambiguous claim/result/ack replies, while every mutation still replays its exact stored idempotency key/body.

## Reviewed producer handoff — Task4 e4fa9a1

Task4 reviewed after2fixrounds. Consume actual server/src/tickets/contracts.ts and service/deploy exports, don'tguessprevioussignatures. `createTicketServices(deps)` immutable dependencies; `ExecutionAuthority` methods:
- verifySignal(tx,ticketId,signal,evidenceId):Promise<void>, actual guard/attempt/fence/confirmedstop proof for internalsignal.
- requestTerminalIntent(tx,ticketId,'needs_input',reason):Promise<void>, store005terminalintent +pausecommand, atomic finalize ifalready physicallystopped/finalizing; preserve repair_limit.
- verifyRepairResult(tx,input:RepairResultInput):Promise<void>, validatesexactattempt/fence/ticketbefore duplicatecyclelookup, no booleanmocktruth production.
DocsCompletionReader and DocsSourceReader defaultdeny untilTask7. Optional route4thservices/deps safe; standaloneexports defaultdeny.

`readDeployAuthorization(tx,ticketId):Promise<'owner_deploy_request'|'owner_approval'|null>` from tickets/deploy.ts MUST be checked for deployticket in claimtransaction; nullreject before attempt/command/status/eventeffects. Ownercreateddeployrequest authorizesexactitselfonly. Everydeploychild requires exactownerapprovalfingerprint. Do not grant descendantpermission merelyfromrootkind/creator. Recheck all predecessorstatuses done in claimtransaction even ticketready; exactticket/binding revisions underlocks. 004storescreator/fingerprint/approvaldecision +repair-limitcycle/time/consumeddecision; don'tmutate004schema. Fieldnamesactualsource/report.

Task4 fixes preserve rootlock-beforeticket/parent, denychildcreationterminaltree, denydependencyedits ready/running, prevent stale/consumed continueAfterFive approval, countstays5. Executionfinalization mustuseactualinternal TicketServices to respectallgates andpreservewaitReasonrepair_limit, never directstatusSQL bypass. Private callbacks mayattach authoritativecontext, notpublic clientboolean. Iffactoryintegration requiresa narrowimmutable dependencyextension report exactgap toPM beforepermissiveworkaround.

Newjournalproducer events require narrowly whitelistedmetadata contracts in journal/event-contracts.ts, ownfocused execution-events.unit.test.ts +server-journal.md R3 changes explicitlyauthorized. No sensitive checkpoint/result/decisiontext ineventpayload. Controllerserializesmapping/Git. Report all source exports/hooks forTask6B/7 andgateway bridge. Phase04approvedplan certification bootstrap uses migration008 INSERT-attempt binding hook after005claim createsexactattempt/fence in sameTx; don'tadd nonexistent fencefield toDispatchPermit or modifyfuture schema now.
