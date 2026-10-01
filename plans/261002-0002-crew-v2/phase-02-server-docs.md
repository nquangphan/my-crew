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

## Task 1: Platform, private DB and reusable integration fixture

**Owner:** platform worker. **Files:** create `v2/server/package.json`, `tsconfig.json`, `.env.example`, `src/platform/{contracts,errors,config}.ts`, `src/platform/picomatch.d.ts`, `src/db/{client,migrate}.ts`, `migrations/001_platform.sql`, `scripts/test-db.ts`, `test/support/db.ts`, `test/platform.test.ts`; modify controller docs server-platform. No app source v1.

**Interfaces:** `loadConfig(env:NodeJS.ProcessEnv):{databaseUrl:string,publicOrigin:string,port:number,sessionEncryptionKey:Buffer}`; `connectDb(url:string):Db`; `MigrationSet={through:number,files:ReadonlyArray<{version:number,name:string,sha256:string,sql:string}>}`; `captureMigrations(through:number):Promise<MigrationSet>` reads exactly consecutive1..through into immutable values, rejects absent prefix/checksum mismatch; `migrate(db:Db,set:MigrationSet):Promise<void>`; `databaseFixture(through:number):(fn:(db:Db)=>Promise<void>)=>Promise<void>` captures prefix before creating DB, exposed local `withDatabase` in each test file; creates fresh logical DB per test file within test-owned instance, migrates, drops only own name in finally. `ApiError(code:string,status:number,message:string,details?:unknown)` extends Error. Helpers do not set process.env from source v1.

- [ ] Write RED isolation/migration tests:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../src/platform/config.ts';
import {databaseFixture} from './support/db.ts';
const withDatabase=databaseFixture(1);
import {migrate,captureMigrations} from '../src/db/migrate.ts';
test('không dùng DB v1 hoặc port DB dùng chung', async()=>{
  assert.throws(()=>loadConfig({DATABASE_URL:'postgres://localhost/crew'}),/CREW_V2_DATABASE_URL/);
  for(const port of [5432,55432]) assert.throws(()=>loadConfig({
    CREW_V2_DATABASE_URL:`postgres://localhost:${port}/crew_v2_test`,
    CREW_V2_PUBLIC_ORIGIN:'http://localhost:5182'}),/SHARED_DB_PORT/);
});
test('migration chạy lại và rollback không mất dữ liệu', async()=>withDatabase(async db=>{
  const set=await captureMigrations(1); await migrate(db,set); await migrate(db,set);
  const rows=await db`select version from schema_migrations order by version`;
  assert.equal(new Set(rows.map(x=>x.version)).size,rows.length);
  const marker=await db`select system_name from system_identity`;
  assert.equal(marker[0]?.system_name,'crew-v2');
}));
```

- [ ] Run `pnpm --dir v2/server test --test-name-pattern='DB v1|migration'` after scripts added; missing config/migrate test fails, not Docker unavailable. Fixture prerequisite failure is BLOCKED, not RED.
- [ ] Create minimal package and fixture; exact runtime pins:

```json
{"name":"@crew-v2/server","private":true,"type":"module","packageManager":"pnpm@10.32.1","engines":{"node":">=24.12"},"scripts":{"start":"node src/main.ts","test":"node scripts/test-db.ts","test:unit":"node --test test/*.unit.test.ts","typecheck":"tsc --noEmit","db:migrate":"node src/db/migrate.ts"},"dependencies":{"fastify":"5.12.5","postgres":"3.4.9","yaml":"2.9.1","picomatch":"4.0.7"},"devDependencies":{"typescript":"7.0.2","@types/node":"26.6.3"}}
```

`test-db.ts` forwards arguments before test filenames to `node --test`, acquires container with `docker run --rm -d --name crew-v2-test-<randomUUID> -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=crew_v2_test -p 127.0.0.1::5432 postgres:18.6`; inspect mapped port, reject 5432/55432; use own container `docker exec ... pg_isready` with bounded wait30s. `finally` stops only recorded container ID, no volume mount/shared compose. Handle SIGINT/SIGTERM with cleanup; nested tests reuse test URL passed as `CREW_V2_TEST_DATABASE_URL`, never prod URL. Trust auth only loopback temporary test container. Fixture `CREATE DATABASE crew_v2_test_<uuid_no_dashes>` using identifier quoted via sql helper; once DB created pool closes and DROP occurs after sessions end. No `psql` host dependency.

`tsconfig` mirror domain options plus include `src/**/*.ts`, `test/**/*.ts`, `scripts/**/*.ts`, `../src/**/*.ts`; adapter declaration `src/platform/picomatch.d.ts` describes `(glob:string|string[],options?:{dot?:boolean}):((path:string)=>boolean)` if upstream lacks types. Keep Node features within24.12 floor. `loadConfig` validates required v2 DB URL/name/local port before validating `CREW_V2_SESSION_ENCRYPTION_KEY` (64hex), so RED isolation tests assert intended failure. All successful config fixtures supply runtime-generated key. Config test mode strict loopback và explicit random mapped port; production private DSN được dùng internal5432 nếu dedicated DB/identity crew-v2 đã xác minh và host không loopback/shared endpoint. Vẫn không đọc DSN v1; production TLS config never copied from v1.

```ts
export function connectDb(url:string):Db {
  const u=new URL(url);
  if(!u.pathname.startsWith('/crew_v2_')) throw new Error('NOT_V2_DATABASE');
  if(u.hostname==='localhost'||u.hostname==='127.0.0.1') {
    if(['5432','55432',''].includes(u.port))throw new Error('SHARED_DB_PORT');
  }
  return postgres(url,{max:8,idle_timeout:20,connect_timeout:5});
}
```

- [ ] Run GREEN test, `pnpm --dir v2/server typecheck`, domain test `pnpm --dir v2 test`. Verify Docker test container removed on success, failing assertion and interruption; backup/restore test uses `docker exec` pg_dump/pg_restore inside own instance. Pin image digest obtained by pull/inspect during implementation and record digest in operations doc; no guessed digest.
- [ ] Update `v2/docs/flows/server-platform.md` with configuration, isolated test prerequisites, no auto migration; controller maps source/test then generates docs. Serialized commit `feat(v2): add isolated server database platform` after task independent review.

## Task 2: Atomic mutation, idempotency and durable event replay

**Owner:** journal worker. **Files:** create `src/journal/{canonical,mutation,events,routes}.ts`, `migrations/002_journal.sql`, `test/journal.test.ts`. Docs `v2/docs/flows/server-journal.md`.

**Interfaces:** `EventScopeReader=(db:Db,actor:Actor)=>Promise<{projectIds:Id[],allowGlobal:boolean}>`; `ownerOnlyEventScope:EventScopeReader` trả owner `{projectIds:[],allowGlobal:true}`, machine `{projectIds:[],allowGlobal:false}`; Task2 không query bảng projects chưa có. Task3 xuất `projectEventScope:EventScopeReader` đọc project bound từ schema003; app inject vào journal read/stream. Task2 owner calls include ownerOnlyEventScope; machine integration tests deferred until003 and use projectEventScope. Owner-only journal test injects deny-all for machine with no projects query, proves unauthorized project/global events not returned; audience_machine_id=self events only exposed after authenticating newly provisioned machine Task3, not forged Actor in public route. Platform types; `canonicalJson(value:unknown):string` rejects undefined/nonfinite/cycles and sorts own object keys; `mutate`, `appendEvent`, `readEvents` signatures frozen above. `registerEventRoutes(app:FastifyInstance,options:ServerOptions,deps:RouteDependencies,scope:EventScopeReader):void`. Cursor query accepts0 and decimal bigint, no negative/float; all mutation events inserted only within mutate transaction.

- [ ] Write RED tests replay, key mismatch and simultaneous requests:

```ts
test('retry concurrent chỉ ghi một event và trả cùng body',async()=>withDatabase(async db=>{
  let calls=0; const c={actor:{kind:'owner',id:'owner'} as const,route:'POST:/probe',key:'request-1',body:{b:2,a:1}};
  const work=async(tx:Tx)=>{calls++; const e=await appendEvent(tx,{type:'probe',projectId:null,
    ticketId:null,audienceMachineId:null,data:{ok:true}});return {status:201,body:{cursor:e.cursor}};};
  const [a,b]=await Promise.all([mutate(db,c,work),mutate(db,c,work)]);
  assert.deepEqual(a,b);assert.equal(calls,1);
  await assert.rejects(()=>mutate(db,{...c,body:{a:2}},work),{code:'IDEMPOTENCY_CONFLICT'});
  assert.equal((await readEvents(db,c.actor,'0',50,ownerOnlyEventScope)).length,1);
}));
test('rollback không để lại response hoặc cursor đã tiêu thụ',async()=>withDatabase(async db=>{
  const c={actor:{kind:'owner',id:'owner'} as const,route:'POST:/probe',key:'rollback',body:{}};
  await assert.rejects(()=>mutate(db,c,async tx=>{await appendEvent(tx,{type:'probe',projectId:null,
    ticketId:null,audienceMachineId:null,data:{}});throw new Error('crash');}));
  assert.equal((await readEvents(db,c.actor,'0',50,ownerOnlyEventScope)).length,0);
  assert.equal((await db`select value from event_cursor`)[0]?.value,'0');
}));
```

- [ ] RED `pnpm --dir v2/server test --test-name-pattern='retry concurrent|rollback|cursor'`; add two-connection test holding first mutation before commit while second waits, release first then verify both cursors returned/replayed in commit order; SSE disconnect/reconnect `Last-Event-ID` yields only later events. No arbitrary timing sleeps: use promise barrier.
- [ ] Implement transaction lock ordering and canonical hashing:

```ts
return db.begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtextextended(${scope},0))`;
  const [old]=await tx`select * from idempotency where actor_kind=${c.actor.kind}
    and actor_id=${c.actor.id} and route=${c.route} and key=${c.key}`;
  if(old){if(old.body_hash!==hash)throw new ApiError('IDEMPOTENCY_CONFLICT',409,'Khóa gửi lại có nội dung khác');
    return codec.decode<T>(c,old.status,old.response);}
  await tx`select value from event_cursor where singleton=true for update`;
  const result=await work(tx);
  await tx`insert into idempotency(actor_kind,actor_id,route,key,body_hash,status,response,created_at)
    values(${c.actor.kind},${c.actor.id},${c.route},${c.key},${hash},${result.status},${tx.json(codec.encode(c,result))},now())`;
  return result;
});
```

`scope=canonicalJson([actor.kind,actor.id,route,key])`; `hash=SHA256(canonicalJson(body))`. `codec` là tham số đóng của `createMutator`; default plain codec lưu body và decode `{status,body}` sau kiểm tra shape JSON. Auth Task3 xuất `credentialResponseCodec(key:Buffer):ResponseCodec`: chỉ route `POST:/v2/machines` encrypt toàn body AES256GCM, AAD=canonicalJson([actor.kind,actor.id,route,key]); các route khác dùng plain codec. App xây một mutator có codec và đưa qua route options, không global function chưa định nghĩa. Authentication diễn ra trước lookup replay; token có thể replay với cùng owner đã đăng nhập, DB lưu ciphertext. `appendEvent` UPDATE cursor value+1 RETURNING then INSERT. Global cursor row lock acquired before business row locks; single-owner serialize writes intentionally. Avoid SERIAL/BIGSERIAL allocation as replay cursor because commit order can differ.

`readEvents`: owner sees all; machine sees events for its bound projects or audienceMachineId=self, never global owner decisions. SSE auth before hijack, fetch pages until caught up then poll; timer aborts on socket close/shutdown, slow client backpressure bounded64KiB then close to force replay. Journal retained indefinitely phase02; no cursor compaction.

- [ ] GREEN focused tests; reconnect after restart new app reads DB journal; forced work rollback creates zero events; event payload rejects credential field names (`token`, `password`, `credential`, `secret`) recursively before storage, whitelist event payload shapes by type.
- [ ] Docs journal flow + serialized commit `feat(v2): persist idempotent mutations and replayable events`, independent review of commit-order race and sensitive replay.

## Task 3: Single-owner auth, newly provisioned machines and project binding

**Owner:** identity worker. **Files:** create `src/auth/{password,session,machine,bootstrap,routes}.ts`, `src/projects/{service,routes}.ts`, `migrations/003_identity.sql`, `test/{auth,projects}.test.ts`. Docs `server-identity.md`.

**Interfaces:** `registerAuthRoutes(app:FastifyInstance,options:ServerOptions,deps:RouteDependencies):void`; `registerProjectRoutes(app:FastifyInstance,options:ServerOptions,deps:RouteDependencies,bindingGuard:BindingGuard):void`; `BindingGuard=(tx:Tx,projectId:Id)=>Promise<void>`; `credentialResponseCodec(key:Buffer):ResponseCodec`; `buildIdentityTestApp(db:Db):Promise<IdentityTestFixture>` trong test support, fixture có `ownerPost(path:string,body:unknown,key:string):Promise<LightMyRequestResponse>`, `ownerGet(path:string):Promise<LightMyRequestResponse>`, `machineGet(path:string,token:string):Promise<LightMyRequestResponse>`, `close():Promise<void>`; fixture tự quản cookie+CSRF và key runtime random32bytes. `bootstrapOwner(db:Db,password:string):Promise<void>` CLI requires password via stdin, rejects owner already exists; `authenticate(request):Promise<Actor>`; `requireOwner(request,{csrf:boolean}):Promise<Actor>`; `createProject(tx,input:CreateProject):Promise<Project>`; `provisionMachine(tx,name:string):Promise<{machine:Machine,token:string}>`; `bindProject(tx,projectId:Id,input:Binding):Promise<Project>`; `CreateProject={key:string,name:string,repositoryUrl:string|null}`; `Machine={id:Id,name:string,revokedAt:string|null}`; `Project={id:Id,key:string,name:string,repositoryUrl:string|null,machineId:Id|null,checkoutPath:string|null,bindingRevision:number,docsState:'missing'|'unverified'|'invalid'|'current'|'stale'}`;  Machine exposes id/name/revokedAt only; `Binding={machineId:Id,checkoutPath:string,expectedRevision:number}`. Key regex `[A-Z][A-Z0-9_-]{1,31}`, name1–200, checkout absolute macOS path1–4096; URI repository `https` or `ssh`, no username/password URL.

- [ ] Write RED auth tests via `buildIdentityTestApp(db)` helper local `test/support/identity-app.ts`: Fastify + auth/project routes, initializes owner random test password, no later app.ts dependency. Test extra forbidden field400 (không bị silently stripped); unauthorized GET401, wrong password401, success HttpOnly/SameSite cookie, session persists app restart, expiry/logout401, CSRF missing403, Origin mismatch403, cookie on machine route401, bearer on owner route403; log/output lacks secrets. Exact key-mismatch test:

```ts
test('machine provision replay cùng owner và không leak cho machine',async()=>withDatabase(async db=>{
  const fixture=await buildIdentityTestApp(db);
  const a=await fixture.ownerPost('/v2/machines',{name:'Mac test'},'provision-one');
  const b=await fixture.ownerPost('/v2/machines',{name:'Mac test'},'provision-one');
  assert.equal(a.statusCode,201);assert.deepEqual(a.json(),b.json());
  const stored=JSON.stringify(await db`select response from idempotency`);
  assert.equal(stored.includes(a.json().token),false);
  assert.equal((await fixture.machineGet('/v2/projects',a.json().token)).statusCode,403);
  await fixture.close();
}));
```

- [ ] RED `pnpm --dir v2/server test --test-name-pattern='auth|provision|binding'`.
- [ ] Implement crypto with Node: random32byte session/token, SHA256 DB token hashes; password scrypt async `N=32768,r=8,p=1,maxmem=64MiB`, salt16bytes, compare timingSafeEqual only same lengths. Cookie `crew_v2_session=<random>;Path=/v2;HttpOnly;SameSite=Strict;Secure` production, max age12h, no Domain; local insecure mode only localhost development config. CSRF token random32bytes hash DB; retrieve GET auth via encrypted session secret or rotate token safely same response? Store `csrf_ciphertext text` additional sessions column encrypted AES256GCM so GET auth can return original token. Bootstrap stdin never CLI arg/password log; config key hex32bytes supplied runtime env not checked in. Login per-process throttle5 failures/5min per hashed IP+owner, return429; external proxy real IP only trusted explicit config.

Project mutation example:

```ts
const [p]=await tx`select * from projects where id=${projectId} for update`;
if(!p)throw new ApiError('NOT_FOUND',404,'Không tìm thấy dự án');
if(p.binding_revision!==input.expectedRevision)throw new ApiError('REVISION_CONFLICT',409,'Dự án đã thay đổi');
const active=await tx`select 1 from attempts where ticket_id in
  (select id from tickets where project_id=${projectId}) and state in ('active','uncertain','finalizing') limit 1`;
if(active.length)throw new ApiError('ACTIVE_EXECUTION',409,'Đối chiếu tác vụ đang chạy trước khi đổi máy');
```

Task3 migration chưa có attempts/tickets: service `BindingGuard` required route option, default deny rebinding if already bound; Task5 supplies DB guard when tables exist. Initial bind does not require attempt query. Refuse revoked machine404. BindingRevision increments, project event in same transaction; preserve old docs imported independent binding. Machine token in mutation response uses Task2 encryption codec; credentials redacted request logger, SQL not logged. Binding identity is project→one machine, one machine may own many projects.

- [ ] GREEN test concurrent binding same revision one200/one409; startup absent bootstrap owner503 authenticated routes, no implicit creation; owner session still valid across app restart; DB backup contains no raw token/session/CSRF/password.
- [ ] Update identity docs, serialized commit `feat(v2): add owner authentication and project machine binding`; review authentication and replay encryption independently.

## Task 4: Ticket hierarchy, DAG, timeline and honest completion gates

**Owner:** tickets worker. **Files:** create `src/tickets/{contracts,service,dependencies,decisions,completion,repair,routes}.ts`, `migrations/004_tickets.sql`, `test/{tickets,dependencies,completion,repair}.test.ts`. Docs `server-tickets.md`.

**Interfaces:**

```ts
export type CreateTicket={projectId:Id;parentId:Id|null;level:'request'|'step'|'task';
  kind:'code'|'research'|'docs'|'deploy';title:string;description:string;mandatory:boolean;
  criteria:Record<string,unknown>;inputs:Record<string,unknown>;outputs:Record<string,unknown>;
  skill:string|null;workflowPin:Pin|null};
export type Ticket=CreateTicket & {id:Id;rootId:Id;status:Status;revision:number;
  waitReason:string|null;repairCycles:number;mergedCommit:string|null};
export type Dependency={ticketId:Id;predecessorId:Id};
export type RepairLink={checkStepId:Id;fixTicketId:Id;cycleId:Id};
export type SourceRef={kind:'docs'|'ticket'|'artifact'|'owner_decision';id:Id;path?:string;locator?:string};
export type DecisionInput={kind:'assessment'|'delegated'|'owner_answer'|'approval'|'intervention'|'dispatch';
  content:string;rationale:string;sources:SourceRef[];scope:Record<string,unknown>};
```

Service signatures `createTicket(tx:Tx,input:CreateTicket,actor:Actor):Promise<Ticket>`, `addDependency(tx:Tx,ticketId:Id,predecessorId:Id,expectedRevision:number):Promise<Dependency>`, `signalTicket(tx:Tx,ticketId:Id,signal:Signal,expectedRevision:number,evidenceId:Id|null,actor:Actor):Promise<Ticket>`, `recordDecision(tx:Tx,ticketId:Id,input:DecisionInput,actor:Actor):Promise<Id>`, `recordRepairResult(tx:Tx,input:RepairResultInput,actor:Actor):Promise<Ticket>`. `RepairResultInput={ticketId:Id,attemptId:Id,fence:string,cycleId:Id,classification:'initial_review'|'repair_review'|'infrastructure'|'model',passed:boolean,evidence:Record<string,unknown>}`; `Comment={id:Id,ticketId:Id,actor:Actor,text:string,createdAt:string}`; `appendComment(tx:Tx,ticketId:Id,text:string,actor:Actor):Promise<Comment>`; `readGraph(db:Db,ticketId:Id,actor:Actor):Promise<{nodes:Ticket[],dependencies:Dependency[],repairLinks:RepairLink[]}>`. Completion consumes persisted evidence + descendants + verified docs, never boolean input submitted by client. `createTicket` default workflow for request if caller omission: store workflow choice `superpowers` in `criteria.workflowChoice`; no fabricated version/revision pin. Request may workflowPin=null until run is created; step/task inherit exact parent pin once set and reject mismatches.

- [ ] RED tests tree and DAG:

```ts
test('concurrent opposite edges không tạo cycle',async()=>withDatabase(async db=>{
  const f=await ticketFixture(db); // creates project + request + two sibling steps a,b
  const add=(ticketId:Id,predecessorId:Id,key:string)=>f.mutation(key,tx=>
    addDependency(tx,ticketId,predecessorId,1));
  const results=await Promise.allSettled([add(f.a,f.b,'a-b'),add(f.b,f.a,'b-a')]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const failed=results.find(x=>x.status==='rejected') as PromiseRejectedResult;
  assert.equal(failed.reason.code,'DEPENDENCY_CYCLE');
  assert.equal((await db`select * from dependencies`).length,1);
}));
test('docs cũ không đóng request code',async()=>withDatabase(async db=>{
  const f=await completedStepsFixture(db,{kind:'code',mergedCommit:'a'.repeat(40)});
  await assert.rejects(()=>f.signal('passed'),{code:'COMPLETION_GATE'});
  assert.equal((await f.read()).status,'running');
}));
```

Fixtures `ticketFixture` and `completedStepsFixture` local `test/support/tickets.ts` defined in this task; functions create through services/mutator, no v1 fixture imports; completion test initially no docs tables uses `DocsCompletionReader` injectable returns null, Task7 supplies DB implementation. Tests also task under request400, cross-project parent409, cross-root dependency409, dependency prerequisite ready denied, mandatory descendant incomplete deny, research evidence allows no merge, deployed action approval machine403, comments during running create event but do not start second execution.

- [ ] RED `pnpm --dir v2/server test --test-name-pattern='cycle|hierarchy|docs cũ|repair'`.
- [ ] Implement root row lock for graph mutations; require request→step→task only, same project/root, graph immutable parent once created; recursive CTE traverse predecessor edges to detect new cycle. Global mutation cursor lock also serializes graph writes. Signal resolves domain transition with optimistic revision; `dependencies_ready` checks all predecessor.status=done, not arbitrary client bool. `start`, `pause_confirmed`, `cancel_confirmed`, `reconciled_stopped` cannot be called public signal route; Task5 uses internal `applyExecutionSignal(tx,...)` after process/lease proof. `wait_owner` from active/finalizing attempt persists terminal_intent needs_input+reason and queues existing pause command `{terminalIntent:'needs_input'}` (no undefined wait command); retains running until process stopped confirmation then atomic finalize applies domain wait_owner; cannot relabel running and re-dispatch. `passed` is internal-only via Task5 finalizeAttempt after confirmed stopped and persisted verified result/evidence. Public signals route rejects passed for active/finalizing execution, does not directly finalize from a browser status request. Owner cannot force done by update status.

```ts
const next=transition(ticket.status,signal);
if(signal==='passed' && ticket.level==='request'){
  const facts=await readCompletionFacts(tx,ticket.id);
  if(!canComplete(facts))throw new ApiError('COMPLETION_GATE',409,'Thiếu bằng chứng hoàn tất');
}
await tx`update tickets set status=${next},revision=revision+1 where id=${ticket.id}`;
```

`readCompletionFacts(tx,id)` computes mandatoryStepsPassed over all mandatory descendants, evidenceReady requiring evidence records of required criteria, mergedCommit from merge evidence event (phase08 trusted verifier later; phase02 don't accept arbitrary web commit), docsCommit only verified snapshot matching merge. `DocsCompletionReader(tx,projectId,commit):Promise<string|null>` fail-closed untilTask7. Non-request completion checks its own criteria/evidence; repair initial review zero cycles, only completed repair_review failure calls `recordRepairFailure`, infrastructure/model retain counter, duplicate cycle returns same result; fifth failure persists needs_input terminal intent and becomes needs_input through atomic finalize after execution stopped, next retry requires owner decision with kind owner_answer and scope `{repairStepId,continueAfterFive:true}`; count remains5. Fix-ticket relation created under same check-step root, no reset via new model/ticket.

- [ ] GREEN tests all domain signal invalid cases + inherited keys400; timeline decision sources require existing accessible docs/ticket or recorded external artifact locator, unknown sources422; server never claims evidence truthful merely because record exists: store `verification:'reported'|'verified'` in evidence.data, completion requires verified output type. Phase08 adds merge verification authority; until then code completion blocked.
- [ ] Docs ticket flow with seven statuses, process uncertainty, repair loop semantics; serialized commit `feat(v2): persist ticket hierarchy dependencies and decisions`; independent review graph concurrency/completion spoofing.

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

- [ ] GREEN tests process still alive/reconnect, crash after DB commit before HTTP reply returns same attempt, restart keeps fence, two pool instances cannot claim concurrently, late old checkpoint after replacement409. Test no configured gate makes server503 and zero attempt/event/status mutation.
- [ ] Update execution docs with protocol truth limits (machine attestation, real host stopping in03) and serialized commit `feat(v2): persist fenced execution and process reconciliation`; independent review permission escalation/fence wrap/lease misconception.

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

## Task 7: Docs tree/search/linking, route assembly and HTTP persistence acceptance

**Owner:** integration worker. **Files:** create `src/docs/{read,search,routes}.ts`, `src/app.ts`, `src/main.ts`, `test/{docs-read,api-acceptance}.test.ts`, `test/support/http.ts`; modify only owned `src/tickets/completion.ts` through reviewed controller integration to supply docs reader or supply callback in app without editing tickets. Docs `server-docs-view.md`, integration section all flows.

**Interfaces:** `buildApp(options:ServerOptions):Promise<FastifyInstance>` registers auth/project/ticket/execution/docs/event routes, no migration/start side effect; `readDocsTree(db,projectId,snapshotId,actor):Promise<DocsTree>`; `readDocsPage(db,projectId,path,snapshotId,actor):Promise<DocsPage>`; `searchDocs(db,input:{q:string,projectId?:Id,snapshotId?:Id,after?:string,limit:number},actor):Promise<{items:DocsHit[],nextCursor:string|null}>`; `DocsPage={snapshotId,projectId,path,text,sha256,sourceCommit:string|null,auditState,contentClass,receivedAt}`; `DocsHit={snapshotId,projectId,path,title,snippet,sha256,sourceCommit,auditState,contentClass,score:number}`; `DocsTree={projectId,snapshotId,sourceCommit,auditState,contentClass,pages:{path,title,parentPath:string|null,contentClass:'implemented'|'workflow_artifact'}[],links:DocLink[]}`. Tree page hierarchy by path directory, does not invent duplicate docs; `parentPath` nearest actual page ancestor else null. Docs state current only verified snapshot.sourceCommit===projects.expected_commit, both non-null; missing no snapshots, imported unverified/invalid appropriate, stale verified commit mismatch.

- [ ] Write RED searchable Unicode + permissions + commit labeling:

```ts
test('docs tìm kiếm và page đọc đúng nguồn snapshot',async()=>withDatabase(async db=>{
  const f=await apiFixture(db); // full buildApp + bootstrap/auth helper
  const imported=await f.import(legacyBundle({'docs/index.md':Buffer.from('# Tài liệu\nKết nối máy Mac')}));
  const project=imported.projects[0]!;
  const search=await f.ownerGet(`/v2/docs/search?q=${encodeURIComponent('Kết nối')}&projectId=${project.projectId}`);
  assert.equal(search.statusCode,200);assert.equal(search.json().items[0].auditState,'invalid');
  const page=await f.ownerGet(`/v2/projects/${project.projectId}/docs/page?path=docs%2Findex.md`);
  assert.equal(page.json().text,'# Tài liệu\nKết nối máy Mac');
  assert.equal(page.json().sourceCommit,null);
  assert.equal((await f.otherMachineGet(`/v2/projects/${project.projectId}/docs/tree`)).statusCode,404);
  await f.close();
}));
```

- [ ] RED `pnpm --dir v2/server test --test-name-pattern='docs tìm kiếm|HTTP persistence|search'`; tests empty q400, SQL injection-like q treated as text, Unicode accents preserved, independent workflow_artifact results labeled, project filter respected, snapshot selection across projects404, max limit100, path traversal400. Cursor encodes last(score,snapshotId,path) signed or validate tuple scoped q/filter, no arbitrary SQL construction; no HTML snippet returned.
- [ ] Implement search parameterized `websearch_to_tsquery('simple', q)` + GIN rank; fallback literal ILIKE on `search_text` for short/no-token queries with escaped `%`,`_`,`\`; no accent stripping claims. Query length1–256, snapshot default latest imported OR latest verified pointer per project? Freeze default: use most recently received snapshot, expose provenance; completion always independent latest_verified; no duplicate search of historical snapshots unless snapshotId supplied. ORDER score DESC,project_id,snapshot_id,path, tie-safe opaque base64url cursor with q/filter hash; return plain snippet first240 chars around match, do not expose bytes beyond same actor scope. Page/DocsHit.contentClass lấy từ docs_files per-file; DocsTree.contentClass là aggregate mixed/implemented/workflow_artifact và từng pages entry có per-file label. Completion reader chỉ dùng required standard implemented pages đã verified, không nhận workflow_artifact/mixed aggregate như chứng minh tự động. Page original Buffer→strict UTF8 text; raw docs not rendered/executed by server. Link tickets through composite refs validates snapshot belongs same project; tree/read/search return `relatedTicketIds` optional bounded20 by ticket_docs with auth filter.

App constructors consume route register functions; errors map ApiError, Fastify JSON validation400; DB errors503 generic. Entrypoint config `CREW_V2_PORT=8792`, bind loopback default until deployment plan09, shutdown closes SSE timers/pool; main guard executes only invoked script. `authorizeDispatch` production fail-closed; test injected explicit callback available only buildApp test options, no env magic flag. `DocsCompletionReader` loads verified snapshot containing required implemented standard pages (aggregate may be mixed) and sync receipt same merged commit, never artifact class/imported docs.

```ts
const app=Fastify({ajv:{customOptions:{removeAdditional:false}},logger:{redact:['req.headers.authorization','req.headers.cookie',
  'req.headers.x-csrf-token','req.body.password','res.headers.set-cookie']},bodyLimit:1024*1024});
app.setErrorHandler((error,request,reply)=>{
  if(error instanceof ApiError)return reply.code(error.status).send({error:{code:error.code,message:error.message}});
  if(error.validation)return reply.code(400).send({error:{code:'INVALID_INPUT',message:'Dữ liệu không hợp lệ'}});
  request.log.error({code:'INTERNAL_ERROR'},'Lỗi API');
  return reply.code(503).send({error:{code:'SERVICE_UNAVAILABLE',message:'Dịch vụ tạm thời không sẵn sàng'}});
});
```

- [ ] GREEN end-to-end **real HTTP listener** `app.listen({host:'127.0.0.1',port:0})` and Node fetch (inject tests supplementary): login cookie/CSRF→create project→provision2 machines→bind1→create request/steps/task→dependency; wrong machine denied; comments/decision event; import docs twice→search/page/source checksum; issue start test permit→claim/checkpoint→disconnect/reconnect→pause command ack alone leaves running→reconcile stopped→paused; old token denied; close app+pool/reopen same DB→same graph/events/docs/command result. Production default gate503 verified separately. Compare event cursor after first app close and replay later mutation once; no duplicate ticket or import. Test borrowed v1 IDs/token fields rejected. Research completion accepted with verified research evidence test authority; code completion denied imported docs. Phase08 trusted code evidence not simulated as production-ready acceptance.
- [ ] Run final acceptance exactly once after integration changes:

```bash
pnpm --dir v2 test
pnpm --dir v2 typecheck
pnpm --dir v2/server test
pnpm --dir v2/server typecheck
```

Docs-kit không hỗ trợ `--root`; cwd v2 vẫn nhận outer Git root (đã chứng minh phase01). Dùng standalone Git mirror temporary chứa toàn bộ v2 source/docs pending, loại `.git`, `node_modules`, generated test artifacts. Bundle có sẵn `/Users/phannhatquang/Documents/projects/crew/packages/docs-kit/dist/crew-docs.cjs`; chỉ đọc bundle, không rebuild v1 source. Exact kiểm tra/generate bằng script Node ephemeral do controller chạy:

```js
import {mkdtemp,cp,rm,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const source=path.resolve('v2');
const mirror=await mkdtemp(path.join(tmpdir(),'crew-v2-docs-'));
const bundle='/Users/phannhatquang/Documents/projects/crew/packages/docs-kit/dist/crew-docs.cjs';
try {
  await cp(source,mirror,{recursive:true,filter:file=>!file.split(path.sep).some(
    part=>['node_modules','.git','coverage','.test-artifacts'].includes(part))});
  execFileSync('git',['init','-q'],{cwd:mirror});
  execFileSync(process.execPath,[bundle,'generate'],{cwd:mirror,stdio:'inherit'});
  execFileSync('git',['add','.'],{cwd:mirror});
  execFileSync(process.execPath,[bundle,'check','--all'],{cwd:mirror,stdio:'inherit'});
  execFileSync(process.execPath,[bundle,'check','--staged'],{cwd:mirror,stdio:'inherit'});
  for(const name of ['index.md','files.md'])await copyFile(
    path.join(mirror,'docs',name),path.join(source,'docs',name));
} finally {await rm(mirror,{recursive:true,force:true});}
```

Root source hiện exclude v2, không đổi root manifest. Root staged docs check vẫn controller chạy trên index thật trước commit; v2 mirror checks chứng minh local manifest coverage/generated tables. Mirror seed baseline commit cần thiết cho per-task R3 staged check: copy base `git archive <task-base>:v2` vào mirror, git init+add+commit với test identity rồi overlay pending v2 bằng filter trên; Task1 platform extra source expansion R6 theo owner authorization do controller kiểm tra. Mirror whole-phase above kiểm tra R1/R2/R4; per-task R3 phải dùng baseline, không tuyên bố blank-repo staged R3 proof.

- [ ] Record DB backup/restore rehearsal of test dataset (pg_dump own container, restore into new `crew_v2_restore_<uuid>` DB, compare counts/checksums/cursors), API restart evidence, container cleanup, command/fence outcomes and source import checksums. Update architecture/docs flow, serialized commit `feat(v2): expose docs search and compose durable server API`; independent integration review gates each task and whole phase. No deploy/merge automatically just because tests pass; controller follows existing authorized PM integration policy.

## Docs mapping (controller serializes manifests/generated files)

`v2/docs/flows.yaml` source expands `[src/**,server/src/**,server/scripts/**,server/migrations/**]`; no root v1 source change. Avoid shared manifest section by list each concrete shared file in each consumer flow's files (STANDARD prefers shared; owner-authorized v2 shared entries permitted if controller chooses one canonical shared mapping and records R6 approval). Preferred exact shared mapping `server/src/platform/contracts.ts` and `server/src/platform/errors.ts`→all server flows; `server/src/db/client.ts`→platform,journal,identity,tickets,execution,docs-import,docs-view. Every source path in table/task belongs flow; schema migration owned matching flow. Type declaration picomatch.d.ts belongs docs-import (platform creates, docs worker verifies).

| Flow id / page | Entrypoints | Files/tests owned |
|---|---|---|
| server-platform / `docs/flows/server-platform.md` | server/src/db/migrate.ts | platform/config/errors/contracts, db/client/migrate, package/tsconfig, scripts/test-db, migration001; platform.test/support/db |
| server-journal / `docs/flows/server-journal.md` | server/src/journal/routes.ts | journal/canonical/mutation/events, migration002, journal.test |
| server-identity / `docs/flows/server-identity.md` | server/src/auth/routes.ts,auth/bootstrap.ts,projects/routes.ts | password/session/machine/project service, migration003, auth/projects.test, support/identity-app |
| server-tickets / `docs/flows/server-tickets.md` | server/src/tickets/routes.ts | contracts/service/dependencies/decisions/completion/repair, migration004, ticket/dependency/completion/repair tests/support/tickets |
| server-execution / `docs/flows/server-execution.md` | server/src/execution/routes.ts | contracts/commands/attempts/reconcile, migration005, commands/attempts tests/support/execution |
| server-docs-import / `docs/flows/server-docs-import.md` | server/scripts/docs-import.ts | docs contracts/checksum/manifest/validator/links/import, migration006, validator/import tests/support/docs/fixtures |
| server-docs-view / `docs/flows/server-docs-view.md` | server/src/main.ts,app.ts,docs/routes.ts | docs read/search; docs-read/api-acceptance tests/support/http |

Manifest writes exact file lists (no globs within flows). `v2/server/.env.example` no secrets, docs includes all config names. Flow headings match STANDARD; `v2/docs/index.md` becomes domain+server overview while `domain-foundation.md` remains source policy truth. Correct Node24.12/TS7 wording retained; distinguish durable execution protocol from actual host runtime not yet implemented.

Each task's worker writes its owned flow page using exact headings `Mục đích`, `Điểm vào`, `Các bước`, `Files`, `Dữ liệu`, `Flow liên quan`, `Tests`, with actual functions/events/errors and scope limits. Controller stages task source/test/page and required manifest generated changes together; `crew-docs check --staged` before serialized conventional commit. Review docs versus code diff, not simply touched timestamp.

## Coverage, evidence and completion definition

| Spec portion | Phase02 evidence | Deferred owner |
|---|---|---|
| 1–2 standalone, owner/project/docs migration | Task1/3/6/7 separate package+DB isolation+source bytes unchanged | production deploy09 |
| 3 questions/decisions persisted | Task4 timeline/source/approval authority | assistant reasoning06 |
| 4 model/runtime capability + switch behavior | Dispatch callback fail-closed, attempt pin | pool04,planner06 |
| 5 workflow/version | stored immutable Pin per attempt, no fabricated releases | registry/install/isolation03 |
| 6 hierarchy/status/five repair cycles | Task4/5 tree/DAG/repair/status tests | workflow adapter06 |
| 7 commands/idempotency/fencing/reconnect | Task2/5/restart HTTP7 | physical process reconciliation03, merge/deploy08 |
| 8 resource telemetry/subagent orchestration/cleanup | DispatchPermit + deny unconfigured gate | telemetry03, planner06, cleanup09 |
| 9 docs truth/snapshot commit/gates | Task6 validator structural+audit,7 current/stale/reader gates | diff content review/final merge08, retry monitor06 |
| 10 docs tree/search/ticket refs and graph | Task4 graph DTO,7 docs search/source/links | Jira UI07,attachments05 |
| 12 backup/rerun/import exclusions | Task6 backup manifest CLI + corruption/rerun tests,7 restore rehearsal | real production export only separately authorized |

Phase complete when all seven independent review gates and whole-phase review have no actionable critical findings; domain remains green; HTTP acceptance and DB restart/backup restore proven; manifest/generated docs correct; only changed plan/file scope authorized. Report exact files, commands/outcomes, head SHA/commits if controller executed, audit unknowns and postponed operational behavior. This document is a plan, not a claim server exists or dependencies were installed.

## Controller self-review checklist before execution

- [ ] Signatures align across modules; adjust `Tx` upstream postgres transaction generic with typecheck, no `any` escape.
- [ ] `docs_snapshots` provenance unique index includes source commit; sessions migration includes encrypted CSRF column; binding guard assembled only after execution tables exist.
- [ ] No v1 import/schema/DB access, no global Node upgrade, no restart or cleanup of other containers.
- [ ] Five review-focus cases each have owning test; event commit order lock and attempt uncertainty/fence verified.
- [ ] No undefined fixture/helper: each is owned above, uses independent services; no giant single source file.
- [ ] Route allowlist/JSON shapes actor scope pinned; impossible future capabilities fail-closed rather than accepting fake evidence.
- [ ] R6 v2 manifest expansion authorized in session and any required ticket trailer resolved from real ticket, no invented trailer.
- [ ] PM execution method preserved; return plan to controller for self-review and independent plan review, no execution-choice question.
