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

## Task 6: Preserved docs import, independent validator and checksum audit

**Owner:** docs-ingest worker. **Files:** create `src/docs/{contracts,checksum,manifest,validator,links,import}.ts`, `migrations/006_docs.sql`, `test/docs-validator.unit.test.ts`, `test/docs-import.test.ts`, `test/support/docs.ts`, fixture directory `test/fixtures/legacy-docs/` (nonsecret text), `scripts/docs-import.ts`. Docs `server-docs-import.md`.

**Interfaces:**

```ts
export type DocsFile={path:string;bytesBase64:string;sha256:string;contentClass:'implemented'|'workflow_artifact'};
export type AuditIssue={code:string;path:string;message:string;severity:'error'|'warning'};
export type DocsImport={sourceSystem:'crew-v1';backupManifestSha256:string;bundleSha256:string;
  inventory:{legacyProjectId:string;key:string;name:string;repositoryUrl:string|null;
    sourceCommit:string|null;snapshotSha256:string;files:DocsFile[]}[]};
export type ImportResult={importId:Id;projects:{projectId:Id;legacyProjectId:string;
  snapshotId:Id;auditState:'unverified'|'invalid';issues:AuditIssue[]}[]};
export type DocsSync={sourceCommit:string;snapshotSha256:string;files:DocsFile[];
  attemptId:Id;fence:string};
export type DocsValidationInput={files:Map<string,Buffer>;contentClasses:Map<string,DocsFile['contentClass']>;trackedSourcePaths:string[];
  mode:'legacy_import'|'checkout_sync'};
export type DocsValidationResult={issues:AuditIssue[];valid:boolean;links:DocLink[]};
export type DocLink={fromPath:string;occurrence:number;originalHref:string;toPath:string;fragment:string|null;
  status:'ok'|'missing'|'external'|'unverified'};
export function hashBytes(bytes:Buffer):string;
export function snapshotHash(files:DocsFile[]):string;
export function validateDocs(input:DocsValidationInput):DocsValidationResult;
export function importDocs(tx:Tx,input:DocsImport,actor:Actor):Promise<ImportResult>;
export function syncDocs(tx:Tx,projectId:Id,input:DocsSync,actor:Actor):Promise<Id>;
```

Import source contract JSON only allowlisted fields; unknown ticket/machine/token fields rejected400 rather than silently imported. File paths allow `AGENTS.md`, `CLAUDE.md`, `docs/**` and `_bmad-output/**` explicitly inventoried as workflow_artifact. Every file carries contentClass, original bytes/path retained. Known workflow prefixes `docs/superpowers/specs/**`, `docs/superpowers/plans/**`, `docs/bmad/**`, `docs/artifacts/**`, `_bmad-output/**` must be workflow_artifact (wrong class422); standard `AGENTS.md`, `CLAUDE.md`, docs/index,architecture,files,flows.yaml,flows/** must be implemented. Other inventoried docs/** paths require explicit exporter class; never infer mixed bundle all implemented. CLI backup inventory includes same per-file class and enforces class agreement. A snapshot aggregate class is implemented if all files implemented, workflow_artifact if all artifact, mixed otherwise. Validator applies STANDARD structure/headings/generated blocks only to implemented standard docs; original workflow format remains unchanged. Links resolve across both classes in the same immutable snapshot. Snapshot audit invalid/unverified never upgrades artifact page to implemented code proof. audit_state verified on mixed snapshot means implemented STANDARD subset and commit verified; workflow artifact pages remain contentClass workflow_artifact, never satisfy required implemented pages. Artifact-only snapshots cannot satisfy project docs gate even if artifact-specific integrity audit passes. Path must relative POSIX, no leading slash/backslash/empty segment/`.`/`..`/NUL/percent-decoded traversal; path length<=1024, each file<=1MiB decoded, <=2000 files/project, <=100 projects/import, total<=16MiB. Distinct case-sensitive paths preserved, reject duplicate exact paths. UTF8 strict via TextDecoder fatal; raw bytes not decode→encode before hash. Reject symlink information or files outside allowlist. No network fetch of repositoryUrl/Markdown links.

`backupManifestSha256` must match local backup inventory checksum, imported CLI verifies backup files before upload; API records proof checksum without pretending it can see external backup. Bundle sha is SHA256 UTF8 canonicalJson({sourceSystem,backupManifestSha256,inventory}) excluding bundleSha field. snapshot hash SHA256 canonicalJson(sorted tuples `[path,sha256,decodedByteLength,contentClass]`); order-independent, metadata sourceCommit not part bytes hash. Same bytes at new commit must not reuse old sourceCommit silently: unique `(project_id,source_kind,snapshot_sha,content_class,coalesce(source_commit,''))` expression index, replacing initial table UNIQUE that omits commit. Imported immutable source provenance identity `(source_system,legacy_id)` maps existing project only if same previous mapping; project key collision different legacy id409, never promotes/overwrites unrelated project.

- [ ] Before DB RED: Task5 SQL/integration gate passed, controller freezes schema prefix006 and checks FK ticket_docs/attempts exist. Source unit validator tests may run in parallel with4/5 via `node --test test/docs-validator.unit.test.ts`; create this unit test filename instead of docs-validator.test.ts for non-DB checks. Full006 migration creation/application and import DB RED/GREEN serialize after5; no docs worker rewrites earlier migrations. Then write RED preservation/rerun tests:

```ts
test('import giữ CRLF/Unicode và chạy lại không trùng',async()=>withDatabase(async db=>{
  const raw=Buffer.from('# Tài liệu\r\nNội dung tiếng Việt 😀\r\n','utf8');
  const bundle=legacyBundle({'docs/index.md':raw}); // computes backup/snapshot/bundle checksums
  const a=await importWithKey(db,bundle,'import-a');
  const b=await importWithKey(db,bundle,'import-b');
  assert.equal(a.importId,b.importId);
  const saved=await db`select bytes,sha from docs_files where path='docs/index.md'`;
  assert(Buffer.from(saved[0]!.bytes).equals(raw));
  assert.equal(saved[0]!.sha,hashBytes(raw));
  assert.equal(a.projects[0]?.auditState,'invalid'); // missing required manifest; preserved with violations
  assert.equal((await db`select count(*)::int as n from projects`)[0]?.n,1);
}));
test('checksum sai rollback toàn bộ batch',async()=>withDatabase(async db=>{
  const bundle=legacyBundle({'docs/index.md':Buffer.from('# Docs')});
  bundle.inventory[0]!.files[0]!.sha256='0'.repeat(64);
  await assert.rejects(()=>importWithKey(db,bundle,'bad-hash'),{code:'CHECKSUM_MISMATCH'});
  assert.equal((await db`select count(*)::int as n from docs_imports`)[0]?.n,0);
  assert.equal((await db`select count(*)::int as n from projects`)[0]?.n,0);
}));
```

Fixtures defined Task6: `legacyBundle(files:Record<string,Buffer>,classes?:Record<string,DocsFile['contentClass']>):DocsImport` (known paths classified deterministically by default, supplied classes override only in fixture to construct negative inputs; helper recomputes all checksums, production importer enforces known-path classification; unknown path requires classes entry), `importWithKey(db,input,key):Promise<ImportResult>` uses journal mutate; `.fixtures` contains valid AGENTS/CLAUDE/index/architecture/manifest/files/flow required headings and generated blocks. Add fixtures duplicate YAML flow keys, source unmapped, wrong heading order, stale block, link missing/traversal, CRLF, invalid UTF8, mixed-case filename, corruption second project; no v1 DB connection.

- [ ] RED `pnpm --dir v2/server test --test-name-pattern='import|checksum|heading|manifest|link'`.
- [ ] Implement byte verification before database changes, transaction rollback entire batch, snapshot immutable. Legacy import invalid docs stores audit errors and bytes with state invalid; valid structural import stores unverified because no checkout comparison. `sourceCommit:null` remains null; no guessed commit. Rerun same bundle returns stored report no new event/snapshot/project, even with new idempotency key; different backup manifest/bundle produces new import record, identical immutable snapshot reused if provenance matches. Multiple snapshots retain history, project latest pointer can advance only expected source provenance, not overwrite newer verified snapshot with old import.

```ts
for(const f of project.files){
  const bytes=Buffer.from(f.bytesBase64,'base64');
  if(bytes.toString('base64')!==f.bytesBase64)throw new ApiError('INVALID_BASE64',400,'Mã hóa file không hợp lệ');
  if(hashBytes(bytes)!==f.sha256)throw new ApiError('CHECKSUM_MISMATCH',422,'Checksum file không khớp');
  new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
const [known]=await tx`select id,report from docs_imports where source_system=${input.sourceSystem}
  and bundle_sha=${input.bundleSha256}`;
if(known)return known.report as ImportResult;
```

Manifest v2 independent TypeScript shape `Manifest={version:1,source:{include:string[],exclude:string[]},flows:Record<string,{title:string,doc:string,entrypoints:string[],files:string[],tests:string[]}>,shared:Record<string,string[]>,unassigned:{path:string,reason:string}[]}`; yaml `parseDocument(text,{uniqueKeys:true})`, toJS with alias count max50, bounded length before parse, catch parser RangeError into issue. Reject inherited/prototype keys and unexpected keys, flow id `^[a-z][a-z0-9-]*$`; lists string and no duplicates. Implement STANDARD R1/R2/R4 snapshot checks plus headings in fixed order, all mapped files present in `trackedSourcePaths` for checkout_sync, no unassigned overlap, shared target exists. Import has docs only, so unavailable source existence/coverage must generate `SOURCE_TREE_UNVERIFIED` warning, never valid code freshness. No R3 claim from snapshot alone; final diff/review gate phase08.

Generator independently emits exact STANDARD tables/markers, sort paths and flow IDs deterministic, compares blocks preserving surrounding prose; source coverage uses picomatch dot:true include minus exclude. `validateDocs` checkout_sync needs host trackedSourcePaths field: extend `DocsSync` with `trackedSourcePaths:string[]`, `sourceTreeSha256:string`, `verificationEvidenceId:Id`; checksum source list computed sorted canonical JSON, evidence must reference same merged commit/project/attempt and trusted verifier. Until phase08 server default evidence verifier denies audit_state verified; sync can store unverified structural-valid result, invalid sync422, imported invalid retained. No source code content sent, only paths.

`links.ts`: resolve relative links using URL/path.posix anchored from docs source directory; decode URL path once, reject escape/query path tricks, split fragment; external http/https/mailto tagged external not fetched. Support inline/reference Markdown links, images and heading anchors, skip fenced/inline code; unsupported nested/custom Markdown syntax yields `UNVERIFIED_LINK_SYNTAX` audit warning rather than asserting all links checked. Preserve original content, originalHref and occurrence (zero-based order of parsed link token in each source page) in audit report/table. Multiple fragments to same destination are separate rows and audited separately, fully repeated link occurrences also retained. fragment missing marks that occurrence missing; duplicate headings deterministic anchor suffix mapping recorded; unknown slug syntax unverified rather than falsely ok. Broken required internal link marks invalid; references to workflow artifacts outside snapshot warning `EXTERNAL_ARTIFACT_NOT_IMPORTED`. Security path traversal always rejected before content import; ordinary broken link is retained/audited.

`docs-import.ts` receives `--bundle` and `--backup-manifest` filenames, verifies both locally; requires existing owner session/CSRF read from stdin/env, never CLI args/log. `--dry-run` produces counts/checksums/violations without network writes. Backup inventory manifest `{version:1,sourceSystem:'crew-v1',exportedAt,sourceBackup:{path,sha256},projects:[{legacyProjectId,sourceCommit,files:[{path,sha256,size,contentClass}]}]}` created outside server, immutable file; verify sourceBackup path and all docs file hashes before accepting checksum. Export production v1 requires owner authorized backup separate operation; implementation uses provided export fixture and never reads v1 credentials/DB. Run rerun test against copied export folder, checksum source folder before/after byte identical.

- [ ] Add RED/GREEN mixed-bundle and fragment identity fixtures before committing Task6; Task7 consumes the same fixture for real HTTP tree/search:

```ts
test('mixed docs/artifact giữ byte và class riêng',async()=>withDatabase(async db=>{
  const flow=Buffer.from('# Flow đã triển khai\r\nNội dung máy Mac');
  const spec=Buffer.from('# Thiết kế dự kiến\nMáy Mac chưa triển khai');
  const bundle=legacyBundle({'docs/flows/machine.md':flow,
    'docs/superpowers/specs/design.md':spec});
  const imported=await importWithKey(db,bundle,'mixed');
  const rows=await db`select path,content_class,bytes from docs_files order by path`;
  assert.equal(rows[0]?.content_class,'implemented');
  assert.equal(rows[1]?.content_class,'workflow_artifact');
  assert(Buffer.from(rows[0]!.bytes).equals(flow));assert(Buffer.from(rows[1]!.bytes).equals(spec));
  assert.equal((await db`select content_class from docs_snapshots`)[0]?.content_class,'mixed');
  const bad=legacyBundle({'docs/superpowers/plans/p.md':spec},
    {'docs/superpowers/plans/p.md':'implemented'}); // helper hashes exact supplied classes
  await assert.rejects(()=>importWithKey(db,bad,'wrong-class'),{code:'CONTENT_CLASS_MISMATCH'});
}));
test('hai fragment và link lặp cùng trang không mất audit',()=>{
  const input=docsValidationFixture({'docs/a.md':Buffer.from('[Một](b.md#one) [Sai](b.md#absent) [Lặp](b.md#one)'),
    'docs/b.md':Buffer.from('# One')});
  const links=validateDocs(input).links.filter(x=>x.fromPath==='docs/a.md');
  assert.equal(links.length,3);assert.deepEqual(links.map(x=>x.occurrence),[0,1,2]);
  assert.deepEqual(links.map(x=>x.status),['ok','missing','ok']);
});
```

`docsValidationFixture(files:Record<string,Buffer>):DocsValidationInput` owned support/docs.ts supplies remaining required docs from valid fixture, classes available in DocsValidationInput through new `contentClasses:Map<string,DocsFile['contentClass']>` property. DB link fixture asserts three rows keyed occurrence survive roundtrip/reimport. Task7 tree/search/page test searches `Máy Mac` in mixed snapshot, asserts both distinct labels/sourceCommit/checksums, per-page original bytes and tree class mixed; phase07 UI consumes per-page label, never aggregate as page label.

- [ ] GREEN byte+checksum+rereun tests, full validator fixture tests, import forbidden-field test rejects token/machine/ticket400, malformed later project leaves zero partial imports. Commit `feat(v2): import preserved project docs with checksum audit`, flow doc includes structural/audit limitations; independent review on data loss/checksum trust/path escapes.


## PM Stage B handoff
StageA pure validator is reviewed COMPLETE at05b6758,24unit/typecheck/Biome green. Read existing validator/contracts/checksum/manifest/links through server-docs flow, consume its current types and preserve CRLF/source bytes. Implement ONLY remaining StageB new006 SQL/docs import/sync/CLI + import DB/support tests + server-docs.md updates; don't redo purevalidator except explicit concrete gap PM authorization. Task5 reviewed005 required before creating/running006. You are not alone, don't revert gateway/execution edits. No childagents/stage/commit/sharedmanifest/generateddocs, PM serializes. No v1 credentials/DB/services, no actual owner doc export; fixture provided only. Run TDD full import negatives, dry-run CLI no mutation/secret logging, transaction retry/race/provenance; backupManifest trust/checksums and preserve raw original classification. Existing default trusted evidence verifier FAILCLOSED (phase08 verifier later), legacy structural docs never code completion. Use nested package own dependencies; no sharedlock without PM. Runner only accepts ONE --test-file per invocation. Exact resource registry/container identity cleanup, no globaldelta. Required covering server/domain suite/types/Biome owned, scope tests migration6 fixed and snapshotconcurrency. Report task-6b-report.md exactexports/data/commands/proof/resources/limitations; controller commits with R2/R3/check--staged and independent review.
