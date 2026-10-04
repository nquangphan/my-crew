# Crew v2 phase 02 — Server và docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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
| 6 docs ingest | `src/docs/{contracts,checksum,manifest,validator,links,import}.ts`, fixtures/tests, `migrations/006_docs.sql` | 2+3 | với4/5 |
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
  sessionEncryptionKey:Buffer; now:()=>Date; authorizeDispatch:AuthorizeDispatch};
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

`createMutator(db:Db,codec?:ResponseCodec):Mutator` tạo mutator cho route; `mutate<T>(db:Db,c:MutationContext,work:(tx:Tx)=>Promise<Mutation<T>>):Promise<Mutation<T>>` là wrapper plain codec cho tests/services không trả secret; `appendEvent(tx:Tx,e:EventInput):Promise<Event>`; `readEvents(db,actor,after:string,limit:number):Promise<Event[]>`. Idempotency required cho mọi POST/PUT/PATCH/DELETE ngoài login/logout, scoped `(actor.kind,actor.id,route,key)`, 1–128 printable ASCII chars. Body hash canonical sorted JSON; route scope chứa normalized path với ID; lỗi trước work không giữ key, successful response giữ vĩnh viễn (single-owner), đổi payload 409.


## Task 1: Platform, private DB and reusable integration fixture

**Owner:** platform worker. **Files:** create `v2/server/package.json`, `tsconfig.json`, `.env.example`, `src/platform/{contracts,errors,config}.ts`, `src/platform/picomatch.d.ts`, `src/db/{client,migrate}.ts`, `migrations/001_platform.sql`, `scripts/test-db.ts`, `test/support/db.ts`, `test/platform.test.ts`; modify controller docs server-platform. No app source v1.

**Interfaces:** `loadConfig(env:NodeJS.ProcessEnv):{databaseUrl:string,publicOrigin:string,port:number,sessionEncryptionKey:Buffer}`; `connectDb(url:string):Db`; `migrate(db:Db):Promise<void>`; `withDatabase(fn:(db:Db)=>Promise<void>):Promise<void>` creates fresh logical DB per test file within test-owned instance, migrates, drops only own name in finally. `ApiError(code:string,status:number,message:string,details?:unknown)` extends Error. Helpers do not set process.env from source v1.

- [ ] Write RED isolation/migration tests:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../src/platform/config.ts';
import {withDatabase} from './support/db.ts';
import {migrate} from '../src/db/migrate.ts';
test('không dùng DB v1 hoặc port DB dùng chung', async()=>{
  assert.throws(()=>loadConfig({DATABASE_URL:'postgres://localhost/crew'}),/CREW_V2_DATABASE_URL/);
  for(const port of [5432,55432]) assert.throws(()=>loadConfig({
    CREW_V2_DATABASE_URL:`postgres://localhost:${port}/crew_v2_test`,
    CREW_V2_PUBLIC_ORIGIN:'http://localhost:5182'}),/SHARED_DB_PORT/);
});
test('migration chạy lại và rollback không mất dữ liệu', async()=>withDatabase(async db=>{
  await migrate(db); await migrate(db);
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


## PM exact handoff

Own source/config: v2/server platform/db/migration001/test fixture plus v2/docs/flows/server-platform.md. Own v2/server/pnpm-lock.yaml. Root v2 package remains domain only. No edits other source, root AGENTS/CLAUDE/.claude/.githooks. PM owns shared docs manifest/index/files/architecture and Git staging/commits. Source declarations picomatch.d.ts if needed platform owns creates, docs-import maps later.

Environment encryption key name CREW_V2_SESSION_ENCRYPTION_KEY (64 hex). Set test fixtures their own ephemeral key, no checked-in values. Node24.14 local, Docker available. Non-test private v2 DB may internal5432, tests mapped host must avoid5432/55432. No global runtime installs. Do not auto migrate on imported module.

Task review1 found no platform Important; author fixes only later ticket/docs contracts while this foundation runs. If shared contract change is needed, raise to PM before editing beyond Task1 semantic type corrections. Future migration files absent; loader must discover explicit sorted validated contiguous versions on each own DB initialization, test fixtures snapshots freeze per invocation. Test runner cleanup own container ID always including interruptions; do not touch others containers.

Read .agents/skills/test-driven-development/SKILL.md and writing-good-tests.md; record real RED/GREEN commands/results. Build reusable test fixture plus migration checksum/drift/atomic rollback/marker refusal tests, no superficial assertion-only placeholders. Implementer self-review and focused tests then domain suite/typecheck. Full report task-1-report.md including files changed, exact CLI/results and concerns. Do not commit or dispatch subagents; PM serializes Git/docs and independent reviews. You are not alone, do not revert others. All prose Vietnamese.

## Final producer contract correction (PM)

Reviewed plan correction updates Task1 to immutable MigrationSet/captureMigrations(through,migrationsDir?)/migrate(db,set)/databaseFixture(through)(fn), ServerOptions.verifyFinalResult, CREW_V2_MIGRATION_THROUGH explicit CLI. Exact approved Task1 latest plan supersedes initial withDatabase/migrate(db) snippets. No extra alias. Fixture optional {migrate:false} exists only to test refusal/rollback on blank DB. Narrow upstream TransferListItem type augmentation added because TS7+Node26 types removed alias still used by thread-stream4.2.0; all external types still checked, no skipLibCheck. No runtime behavior addition to logger.
