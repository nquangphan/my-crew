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

HTTP JSON: additionalProperties:false; UUID IDs, safe integer revision, canonical hex SHA256, 40/64 hex commit; no enums accepted through inherited object keys. Errors stable codes, tiếng Việt message. Map 400 validation, 401 authentication, 403 scope/origin, 404 inaccessible/not found, 409 revision/idempotency/state/cycle/fence conflict, 413 limits, 422 checksum/docs validation, 503 DB unavailable. Không gửi stack/SQL/token/password. Body limit thường 1MiB, import riêng 24MiB encoded/16MiB decoded. Pagination limit1–100, default50, stable ID/cursor order.

`createMutator(db:Db,codec?:ResponseCodec):Mutator` tạo mutator cho route; `mutate<T>(db:Db,c:MutationContext,work:(tx:Tx)=>Promise<Mutation<T>>):Promise<Mutation<T>>` là wrapper plain codec cho tests/services không trả secret; `appendEvent(tx:Tx,e:EventInput):Promise<Event>`; `readEvents(db:Db,actor:Actor,after:string,limit:number,scope:EventScopeReader):Promise<Event[]>`. Idempotency required cho mọi POST/PUT/PATCH/DELETE ngoài login/logout, scoped `(actor.kind,actor.id,route,key)`, 1–128 printable ASCII chars. Body hash canonical sorted JSON; route scope chứa normalized path với ID; lỗi trước work không giữ key, successful response giữ vĩnh viễn (single-owner), đổi payload 409.


## Owned migration contract
- `003_identity.sql`: `owners(id text PK CHECK(id='owner'),password_salt text,password_hash text)`; `sessions(id_hash char(64) PK,owner_id text FK owners,csrf_hash char(64),csrf_ciphertext text,expires_at timestamptz,revoked_at timestamptz NULL)`; `machines(id uuid PK,name text,token_hash char(64) UNIQUE,created_at timestamptz,revoked_at timestamptz NULL)`; `projects(id uuid PK,key text UNIQUE,name text,repository_url text NULL,machine_id uuid NULL FK machines,checkout_path text NULL,binding_revision integer DEFAULT1 CHECK(>0),expected_commit text NULL,created_at timestamptz,CHECK((machine_id IS NULL)=(checkout_path IS NULL)))`; `legacy_projects(source_system text,legacy_id text,project_id uuid UNIQUE FK projects,PRIMARY KEY(source_system,legacy_id))`.

## Task 3: Single-owner auth, newly provisioned machines and project binding

**Owner:** identity worker. **Files:** create `src/auth/{password,session,machine,bootstrap,routes}.ts`, `src/projects/{service,routes}.ts`, `migrations/003_identity.sql`, `test/{auth,projects}.test.ts`. Docs `server-identity.md`.

**Interfaces:** `registerAuthRoutes(app:FastifyInstance,options:ServerOptions,deps:RouteDependencies):void`; `registerProjectRoutes(app:FastifyInstance,options:ServerOptions,deps:RouteDependencies,bindingGuard:BindingGuard):void`; `BindingGuard=(tx:Tx,projectId:Id)=>Promise<void>`; `credentialResponseCodec(key:Buffer):ResponseCodec`; `buildIdentityTestApp(db:Db):Promise<IdentityTestFixture>` trong test support, fixture có `ownerPost(path:string,body:unknown,key:string):Promise<LightMyRequestResponse>`, `ownerGet(path:string):Promise<LightMyRequestResponse>`, `machineGet(path:string,token:string):Promise<LightMyRequestResponse>`, `close():Promise<void>`; fixture tự quản cookie+CSRF và key runtime random32bytes. `bootstrapOwner(db:Db,password:string):Promise<void>` CLI requires password via stdin, rejects owner already exists; `authenticate(request):Promise<Actor>`; `requireOwner(request,{csrf:boolean}):Promise<Actor>`; `createProject(tx,input:CreateProject):Promise<Project>`; `provisionMachine(tx,name:string):Promise<{machine:Machine,token:string}>`; `bindProject(tx,projectId:Id,input:Binding):Promise<Project>`; `CreateProject={key:string,name:string,repositoryUrl:string|null}`; `Machine={id:Id,name:string,revokedAt:string|null}`; `Project={id:Id,key:string,name:string,repositoryUrl:string|null,machineId:Id|null,checkoutPath:string|null,bindingRevision:number,docsState:'missing'|'unverified'|'invalid'|'current'|'stale'}`;  Machine exposes id/name/revokedAt only; `Binding={machineId:Id,checkoutPath:string,expectedRevision:number}`. Key regex `[A-Z][A-Z0-9_-]{1,31}`, name1–200, checkout absolute macOS path1–4096; URI repository `https` or `ssh`, no username/password URL.

- [ ] Write RED auth tests via `buildIdentityTestApp(db)` helper local `test/support/identity-app.ts`: Fastify + auth/project routes, initializes owner random test password, no later app.ts dependency. Test unauthorized GET401, wrong password401, success HttpOnly/SameSite cookie, session persists app restart, expiry/logout401, CSRF missing403, Origin mismatch403, cookie on machine route401, bearer on owner route403; log/output lacks secrets. Exact key-mismatch test:

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


## PM handoff

Worktree /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew. Own only Task3 source/test/migration + corresponding flow page (exact required headings: Mục đích, Điểm vào, Các bước numbered file→symbol, Files table, Dữ liệu, Flow liên quan, Tests). PM owns manifests/index/files/architecture, locks/staging/commits. No subagents/commits. Others working, do not revert edits.

Platform interface frozen source: captureMigrations(through,migrationsDir?); migrate(db,set); databaseFixture(through)(fn). Task3 tests const withDatabase=databaseFixture(3); prefixN excludes later migration files appearing mid-run. Avoid missing-import-only RED when preceding contract available. Real TDD, read test-driven-development and writing-good-tests. Meaningful concurrency/persistence/scope tests. Biome original node_modules/.bin/biome check on owned files, no diagnostics/non-null assertions/broad disable; source shape contracts strict. Report task-3-report.md exactRED/GREEN/test/typecheck/Biome/files+selfreview+concerns. No stdout credentials. One scoped full server test after meaningful edits; running other task tests before their completion may fail transiently, report byname instead silent ignoring. Full DB integration prerequisite must hold before DONE. Rootdomain14tests remain green.

Shared schema contracts from Task1 cannot be changed without PM ruling; route factories strict named interfaces, no ambient callbacks. Authentication before replay; request-provided booleans never authorizations. No endpoint grants phase06 dispatch or phase08 verification prematurely. Source/test disjoint parallel allowed but SQL migration gate and Git serialized byPM.

Every Fastify test/production factory must use ajv:{customOptions:{removeAdditional:false}}. additionalProperties:false alone silently removes fields by Fastify default; this would defeat forbidden-input400 requirement. Include focused forbidden-field regression in Task3 and full acceptance7. Official docs https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/#validator-compiler verified2026-10-02.

## Reviewed journal producer agreement

Journal event types initially allow only metadata: `machine.provisioned` data `{machineId:UUID}`; `project.created` data `{revision:integer>=1}` with projectId envelope; `project.bound` data `{machineId:UUID,bindingRevision:integer>=1}` with projectId envelope. No name/path/credential/content in event data. Use these exact types/shapes; unknown event types fail closed. Task2 may put schemas in journal/event-contracts.ts; future producer extensions are PM-authorized reviewed changes, not runtime input registration.

Task2 source being implemented concurrently: consumers may write source to frozen interfaces now; RED/GREEN DB integration must wait migration002/modules are ready. Do not change Task2 files. If test imports fail only because Task2 notready, report pending prereq rather than TDDbehavior evidence.

## Frozen HTTP table (PM extraction correction)

POST `/v2/auth/session` public + exactOrigin: `{password}` -> `{owner:{id:'owner'},csrfToken}` +cookie. DELETE samepath owner+CSRF ->204 revoked. GET samepath owner -> owner+CSRF, nohash/password. POST `/v2/projects` owner `{key,name,repositoryUrl:null|string}` ->Project201. GET `/v2/projects` owner -> `{items:Project[],nextCursor:null|string}` with pagination 1–100/default50 stable ID cursor. POST `/v2/machines` owner `{name}` -> `{machine,token}`201. GET `/v2/machines` owner -> metadataonly no token/hash. PUT `/v2/projects/:id/binding` owner `{machineId,checkoutPath,expectedRevision}` ->Project200. No alternative envelopes; source methods return types above. Error mapping/primitives already frozen.
