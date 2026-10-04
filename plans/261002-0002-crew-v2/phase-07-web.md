---
title: "Crew v2 phase 07 — Web"
description: "Web Jira/Confluence, hội thoại và sơ đồ ticket trên hợp đồng server v2, với cổng producer và nghiệm thu API/DB thật."
status: pending
priority: P2
effort: 72h
branch: codex/crew-v2-server
tags: [crew-v2, web, ticket-graph, attachments, accessibility]
created: 2026-10-03
---

# Crew v2 phase 07 — Web Implementation Plan

> **For agentic workers:** thực hiện từng task bằng `superpowers:subagent-driven-development` hoặc `superpowers:executing-plans` theo phương thức owner đã giao controller. Lượt lập kế hoạch này chỉ viết Markdown, không triển khai source/dependency/migration/deploy hoặc child agents.

**Goal:** Owner giao yêu cầu, trao đổi với Trợ lý, theo dõi ticket thực tế qua board/list/sơ đồ, đọc docs theo snapshot và quản lý máy/model/workflow bằng API v2 có quyền và phản hồi thật.

**Architecture:** SPA độc lập `v2/web/`, cùng origin API `/v2`. Server giữ trạng thái nghiệp vụ; TanStack Query giữ cache đọc, event journal làm mất hiệu lực cache. Board/list/map/dialog dùng cùng DTO ticket. Dialog và trang ticket dùng chung nội dung/composer; UI không cấp permit, stop proof hay certificate.

**Tech Stack:** Node ≥24.12, TypeScript 7.0.2 strict, pnpm 10.32.1; React 19.3.0/Vite 8.3.2, TanStack Router/Query, React Flow, Radix Dialog, Markdown an toàn; node:test logic thuần và Playwright browser thật. Exact pins ở Task1.

**Spec:** bản hiện hành worktree `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/docs/superpowers/specs/2026-10-01-crew-v2-design.md`, SHA256 `14085723bba15c1c00de52eab437cf83af58efef8943b761fd029f36f2523165`; roadmap hiện hành cùng worktree `plans/261002-0002-crew-v2/plan.md`. Canonical project chỉ là nơi lưu Markdown mới; main gốc cũ hơn, không dùng để bỏ bổ sung Sơ đồ ticket 03/10.

## Global Constraints

- Owner đã nói “duyệt UI ok” ngày 03/10. Không hỏi lại hướng UI; chưa thấy artifact mockup/prototype phase07 trong phạm vi giao, không claim artifact không tồn tại đã được duyệt.
- V2 độc lập; không import/copy app/schema nghiệp vụ/scheduler/role prompt v1. Giữ chuẩn docs v1 chỉ như hợp đồng dữ liệu.
- Một owner; UI/docs tiếng Việt, identifiers/path/YAML tiếng Anh; giờ `Asia/Ho_Chi_Minh`.
- Ticket request→step→task, bảy trạng thái; lý do chờ không là trạng thái mới. Server giữ review ≤5 vòng, workflow/version/run và completion authority.
- Superpowers mặc định; BMAD do owner chọn. Không gắn cứng chuỗi ví dụ BMAD/Superpowers hoặc prompt PM/dev/QC.
- Migration 001–010 immutable;011/schema/store đang triển khai, chưa freeze. Runtime/native/parser/corpus/merge08/updater09 có gate riêng.
- Mỗi source task có docs cùng commit. Flow đúng 7H2: Mục đích, Điểm vào, Các bước, Files, Dữ liệu, Flow liên quan, Tests. Controller map R2/R3/generated/Git index/commit/shared files; worker không stage dirty tree.
- Manifest `v2/docs/flows.yaml:2` chưa include web/src. Controller phải có bằng chứng quyền R6 coverage trước source đầu tiên; không tự sửa source/shared/unassigned hoặc dùng trailer giả. Markdown mới chỉ canonical `plans/` hoặc `docs/`; controller mirror sang managed worktree.
- Trước mỗi dispatch mới kiểm quota tuần; còn ≤25% hoặc quota không đọc được thì dừng giao mới, chỉ khép inflight. Trước implement/review/fix lấy telemetry mới; thiếu/critical thì chờ. WARN heavy chỉ khi controller xác nhận available ≥4GiB, CPU idle ≥50%, disk ≥8GiB, sole slot; Node heap không phải RSS cây process.
- Lượt này STATIC; schema giữ sole heavy slot; không install/build/DB/browser/native/container hoặc child agents.

## Review Focus

1. Mất reply sau commit phải replay cùng key/body, không tạo ticket/comment/upload mới.
2. Cây>100 node, nhiều dependency và inherited descendants phải đọc đủ; không lọc request ở client rồi mất trang.
3. Event trùng/GET race/reconnect không đưa cache về revision cũ; mất mạng không đổi running→ready.
4. Dialog giữ draft/focus/pan/zoom/expanded; realtime không tự fit lại map.
5. File partial/docs stale/source OFF/workflow partial phải có nhãn rõ; declared/upload-ready không thành verified/read/sẵn sàng thực thi.

## Bằng chứng producer và cổng mở consumer

Citation source tương đối với worktree hiện hành; producer snapshot ban đầu ở HEAD `98e0c173ab6ee68894c5c0f2e7441abd0b285a05`. Kiểm lại HEAD khi khép plan là `77ac18b5df41eba0c0e63787caebf985110d1629`; đây là candidate Assistant T1, independent review NOT READY và FIX1 đang chạy, không phải011 accepted. Executor re-grep path/symbol, so checksum trước consumer. Assistant có peer edits chưa freeze. Các file/symbol web mới phía dưới là **[UNVERIFIED — planned file]**, không claim source đã có.

| Producer đã trace | Control flow xác minh |
|---|---|
| `buildApp`, `v2/server/src/app.ts:30` | Auth/mutator→register auth/project/ticket/execution/docs/gateway/model/event72–85→ready; KHÔNG mount attachment/Assistant. Dispatch/final default deny33–34. |
| `registerAuthRoutes`, `v2/server/src/auth/routes.ts:71` | Login POST91 kiểm Origin→cookie/session/CSRF134;GET141 đọc lại CSRF;DELETE146 CSRF/Origin→revoke. |
| `registerTicketRoutes`, `v2/server/src/tickets/routes.ts:168` | List199 nhận projectId/rootId/status/kind/UUID cursor/limit 1–100→SQL229→items/nextCursor237; không nhận level/q/sort. Detail241→requireTicket;graph245→readGraph. |
| `readGraph`, `v2/server/src/tickets/dependencies.ts:55` | requireTicket→toàn bộ node trong root66→dependencies67→repairLinks69. Gọi ticket con lấy cùng full root, không pagination graph. Transaction mặc định chưa bảo đảm snapshot nhất quán qua ba SELECT. |
| `addDependency`, `v2/server/src/tickets/dependencies.ts:7` | Root lock23→revision/status26→recursive predecessors31→cycle reject→insert38→revision/event44. ParentId không phải dependency. |
| `Ticket`, `v2/server/src/tickets/contracts.ts:22` | id/rootId/status/revision/waitReason/repairCycles/mergedCommit +CreateTicket7; chưa typed máy/model/attempt hiện tại/assessment/evidence projection. |
| `registerEventRoutes`, `v2/server/src/journal/routes.ts:40` | GET68 `{items,cursor}`;stream77 Last-Event-ID/after22→named events111/backlog100→poll1s120;heartbeat15s116, buffer64KiB96;credential/scope47. Metadata only. |
| `createMutator`, `v2/server/src/journal/mutation.ts:15` | Key ASCII1–12820→canonical body/hash28→actor/route/keylock31→authorize33 trước cached replay35→differentbody40938. |
| `registerDocsRoutes`, `v2/server/src/docs/routes.ts:21` | tree27/page38/search59; page reader `v2/server/src/docs/read.ts:104` repeatable snapshot→text/hash/commit/audit/class/time/links123. DocsState172 missing/unverified/invalid/current/stale. relatedTickets43 chỉ có limit20. |
| `registerGatewayRoutes`, `v2/server/src/gateway/routes.ts:39` | OwnerconfigPUT108;status176 snapshot72→`readGatewayStatus`, `v2/server/src/gateway/service.ts:367`. Online receivedAt ≤60s377; DTO381 thiếu appVersion/hostVersion/telemetry values. |
| `registerModelRoutes`, `v2/server/src/models/routes.ts:43` | Owner sourceGET212/PUT224/poolGET275 requiresworkflow. `setSourceConfig`, `v2/server/src/models/config.ts:53`:CAS63,no-op77,revision78,queue sync_models100; OFF không STOP attempt. |
| `registerAttachmentRoutes`, `v2/server/src/attachments/routes.ts:328` | policy344→compose363→reserve389→raw bytes405→atomic tickets455/comment463. Wrapper205 reauth228 trước replay. API đã scoped review cf68a68, production mount chưa có. |
| `createAttachmentSubmissions`, `v2/server/src/attachments/submissions.ts:320` | Selection→replay366→scope/readylock379→create/link384→receipt392. Comment396→replay406→sameTx attachmentComment421→receipt428. Exact ready set/closedACK lock `createSelectionServices`:105,118–177. |
| `registerInputScopeRoutes`, `v2/server/src/attachments/routes.ts:650` | conversation675/message685/list692; authority/defaultdeny664/missingmessages669. Input201 không chứng minh Assistant đã trả lời. |
| `AssistantConfig`, `v2/server/src/assistant/contracts.ts:33`, Assessment133/WorkflowRun159/OwnerQuestion172 (peer edits, recheck trước consumer) | Source evolving, chưa owner HTTP accepted; không suy URL từ type. |
| `registerExecutionRoutes`, `v2/server/src/execution/routes.ts:179` | POSTcommands186→scope/mutator→pause/cancel reason+decisionId202→202Command;GET243 machine-only. Owner chưa đủ read projection command/attempt/result. |

Provenance commit identity đã xác minh: phase02 `29d626d7315e6d36c4497047bbcdc87f0f935bc0`; gatewaybridge `7c7c7191e4b736fda2262b6fedae6f547b90a1c5`;isolation `ced6bb12daf692bb231b1c35f8775a3a71ab2a3a`;broker `49e233350c4acae5ab0e4f4724fc08b7fb77dd53`;runtimeboundary `4db2d9ee2de1db3a2c79c25b17f3c7876988192c`;comment010 `f6d3728077dcb53ef7544acdfa86d34f4eadd91e`;atomic `490001ceaebec040f2d0434c3f68f516ff10a9ad`;workerprotocol `b670d82ac8cc2cc1b27037cc3ddfc0beee228be4`;access `cf68a684cff60d8ddbf4dea521e7626cfd84b50c`. Scoped review không bằng toàn phase/native/live/production acceptance.

| Gate | Producer/controller bàn giao bắt buộc | Consumer |
|---|---|---|
| G0 | Freeze ledger exact method/path/schema/response/error/version/event/callers theo HEAD; R6 web coverage và package/lock độc lập. |1/mọi client |
| G1 | Coherent full-root graph; request-root pagination; current attempt/machine/model/assessment/evidence/chronology/history projections; docs-related pagination khi >20. Additive reviewed, không sửa004/005 âm thầm. |2/3/4 |
| G2 | Mount accepted attachment factories+durable storage/receiver/queue/input authority; parser/corpus/publication/recovery evidence. Comment projection commentId→refs; flattened list `attachments/routes.ts:499` không có commentId. |5/6 |
| G3 | Fullreview011/store/inbox; exact owner Assistant configuration/conversation/replies/questions/answers/gates/run/attention routes; routing candidates có routing-isolation authority riêng. |3/4/6/7 |
| G4 | appVersion/hostVersion/telemetry projection; trusted workflow catalogue; install/retry intent dù desired unchanged; owner command/result read; active credential key read. PUT007 no-op `gateway/service.ts:174` không reinstall. |3/7 |
| G5 |08 owner action/approval bound target/artifact/fingerprint/revision, verified final evidence; owner command/attempt read. Generic decision không tự cấp scope approval. |8 |
| G6 |09 signed release/compatibility/update/drain/rollback/health/auth/idempotency DTO review; native signing/live gates. |8 |

Gate không phải boolean client. Có thể xây pure DTO projection/static preview; chức năng thật chưa producer không được PASS. Controller ghi exact contracts/update plan/review delta rồi mới giao integration, không bịa URL tương lai hoặc route test vào production. Không hỏi owner lại UX đã rõ.

## UX và data flow

Đã kiểm tra ảnh trực tiếp `/Users/phannhatquang/Downloads/IMG_6454.JPG`: nền tối/card chữ nhật, gốc bên trái, nhánh sang phải, node có trạng thái và bấm xem chi tiết. Dùng ý tưởng đó cho ticket thực tế; không đem label agent/token mẫu thành model. Spec hiện hành `docs/superpowers/specs/2026-10-01-crew-v2-design.md:260` yêu cầu quan hệ cha/con và dependency khác nhau, dialog giữ viewport; approval là tin nhắn owner, chưa artifact preview phase07.

Client routes dự kiến dưới `/crew-v2/` (KHÔNG là API server mới): `/assistant`; `/projects/:projectId/board`, `/list`, `/docs`; `/requests`; `/requests/:rootId/map`; `/tickets/:ticketId`; `/machines`, `/:machineId`. Shell theo Jira: project navigation/board bảy trạng thái, list/filter, detail/history; docs theo Confluence: space/tree/search/links/commit/current state. Mobile390px dùng list/currentstep dễ mở ticket/trả lời, không ép thao tác graph rộng.

Map gốc request luôn có, mặc định step, expand task; legend parent/dependency/repair, zoom/pan/fit. Click node query `?ticket=<uuid>` mở shared dialog trên background map; direct URL mở cùng detail. Close X/Escape/Back bỏ query ticket, giữ filters/scroll/expanded/viewport và focus. Trang ticket độc lập reload được. 404/401 trong dialog không tự chọn ticket khác. UI actions không arbitrary drag status hay drag workflow definition.

| Dữ liệu vào | Biến đổi trong web | Đầu ra |
|---|---|---|
| Cookie/GET session | CSRF memory, validatedDTO, QueryClient theo session | Authenticated ownerGET/mutation; logout abort/cache clear |
| Ticket list/detail/graph đầy đủ theo root | ID/revision sharedquerykeys; parentId→hierarchy, predecessorId→ticket dependency, checkStep→fix repair | Same board/list/map/dialog state, no readiness inference |
| Clipboard/drop/File | policy→hash tuần tự→reserve→bytes→selection chính xác→atomic submission | Server ticket/comment/messageID, durable refs, cache invalidate |
| Event cursor/type/IDs | bounded invalidation/dedup→refetch DTO | Event content không merge thành nghiệp vụ; reconnect current view |
| DocsTree/snapshotID | page/search same snapshot→safeMarkdown/linkresolve | commit/time/audit/class/stale view and ticket links |
| Desiredconfig+applied/probe | preservingCASform→accepteddesired→refetchreceipt | pending/applied distinct, OFF≠uninstall, declared≠ready |

## HTTP contract và lỗi

GET credentials same-origin+AbortSignal. JSON owner mutation Content-Type application/json, X-CSRF-Token, Idempotency-Key crypto.randomUUID cho một ý định; browser tự Origin đúng publicOrigin. Login không CSRF/key;logoutCSRF, không journal key. Path/query encoded bằng URLSearchParams, không gửi field không được hỗ trợ.

| Existing HTTP | Exact interface/source |
|---|---|
| POST/GET/DELETE `/v2/auth/session` | POST `{password}`→`{owner:{id:'owner'},csrfToken}`;GET same;DELETE204. auth/routes.ts:91/141/146. |
| GET `/v2/projects`, `/v2/machines` | limit 1–100,cursorUUID→`{items,nextCursor}`. projects/routes.ts:45;auth/routes.ts:179. POSTproject `{key,name,repositoryUrl}`;PUTbinding `/:id/binding` `{machineId,checkoutPath,expectedRevision}` projects/routes.ts:17/27. POSTmachines `{name}` token displayed transient only. |
| GET `/v2/tickets` | projectId/rootId/status/kind/cursorUUID/limit 1–100;`{items:Ticket[],nextCursor}`. Không nhận level/q/sort. GET`/:id`Ticket;GET`/:id/graph` `{nodes,dependencies,repairLinks}` full root. |
| GET ticket comments/decisions | `/:id/comments`, `/:id/decisions`, UUID cursor/limit; chronology không bằngUUIDsort. tickets/routes.ts:337/393. POSTgenericcomments `{text}` không nhận files. |
| POST signals/decisions | `/:id/signals` `{signal:'dependencies_ready'|'wait_owner'|'resume',expectedRevision,evidenceId?}`→Ticket. `/:id/decisions` `{kind,content,rationale,sources:[{kind,id,path?,locator?}],scope}`→`{id}`;scope must G3/G5. Maxtext/rationale32768,sources100. tickets/routes.ts:76/103. |
| POST `/v2/commands` | `{machineId,ticketId,type,payload}`→202Command;pause/cancel payload`{reason,decisionId}` bound actual scope. ACK≠STOP;ownerread G4/G5. execution/routes.ts:46/202. |
| DocsGET | `/v2/projects/:id/docs/tree?snapshotId=...`;`/docs/page?path=...&snapshotId=...`;`/v2/docs/search?q=&projectId=&snapshotId=&after=&limit=`. q1–256,after≤4096,limit 1–100;search cursor not assumedUUID. docs/routes.ts:26/37/58. |
| PUT docslinks | `/v2/tickets/:id/docs-links` `{snapshotId,paths:string[],expectedRevision}`, paths1–100unique. tickets/routes.ts:453. |
| GatewayGET/PUT | `/v2/gateway/machines/:id/status`;PUT`/config` `{expectedRevision,desired:{bmad:{source,projections},superpowers:{source,projections}},maxJobs,enabled}`. revision0 create,maxJobs1–64;SourcePin/ProjectionPin exact gateway/contracts.ts:6/16; trusted catalogueG4. |
| Model sourcesGET/PUT | `/v2/machines/:id/model-sources`;GETconfig+applied or desiredConfignull. PUT `{expectedRevision,enabled:{claude,codex,api},apiProviders:[{id,endpoint,protocol,models:[{id,declared}],localHttp}]}`, remove credentialStatus. maxproviders50; strict endpoint008. models/contracts.ts:103/210. |
| Pool/secret | GET`/v2/machines/:id/models?workflow=bmad|superpowers`→`{items:PoolEntry[],reason}`. POST`/v2/machines/:id/api-providers/:providerId/secret` `{expectedRevision,keyId,operationId,secret}`;activekeyG4,không tạo UUID giả,secret chỉ trong memory. models/contracts.ts:20/40/153. |
| Policy/compose | GET`/v2/attachment-policy` actual bounds/MIME/no storageRoot. POST`/v2/attachment-compose` target `{purpose:'ticket',projectId,ticketId:null}` or comment `{purpose:'comment',projectId,ticketId}` or assistant `{purpose:'assistant_message',projectId:null,ticketId:null,conversationId}`→ComposeSession. GET`/:id`→`{session,attachments}`. attachments/routes.ts:344/361;staging.ts:661. |
| Reserve/upload/remove | POST`/v2/attachment-compose/:id/uploads` `{expectedRevision,fileName,declaredMime,byteLength,sha256}`→`{attachment,selectionRevision}`. PUT`/v2/attachment-uploads/:id/content` octet-stream+CSRF cùng ID→201/200ready replay, không journal key. DELETEcompose`/:id/uploads/:uploadId` `{expectedRevision}`→`{selectionRevision}`;DELETEcompose`/:id`cùng body. routes.ts:386/404/424/441. |
| Atomic create/comment | POST`/v2/attachment-submissions/tickets` `{ticket:CreateTicket,selection,assistantRead:'none'|'selected-inputs'}`→`{ticket,attachmentIds}`. POST`/v2/tickets/:id/attachment-comments` `{text,selection,assistantRead}`→`{comment,attachmentIds}`. Selection`{composeSessionId,selectionRevision,attachmentIds}` exact active ready set. text rỗng + files được phép; text và files cùng rỗng bị từ chối. routes.ts:453/461. |
| Conversation input | POST`/v2/attachment-conversations` `{}`→`{conversationId}`;POST`/v2/attachment-submissions/messages` `{conversationId,clientMessageId,text,selection,assistantRead}`;GET`/v2/attachment-conversations/:id/messages?cursor=&limit=`. Reply/routingpreferences G3, không thêm fields in schema strict ở685. |
| Message routing hiện hữu | POST `/v2/attachment-messages/:id/route` `{expectedInputRevision:string,expectedRouteRevision:number,decisionId,ticket:CreateTicket}`→201 MessageRoute. `attachments/routes.ts:725`, `contracts.ts:297`; authorization `routing.ts:26` kiểm decision/input revision/scope và callback InputRoutingAuthority, thiếu callback trả503. Route này cũng chưa mount; không thay owner question/approval/reply G3. |
| Attachmentread | GET`/v2/tickets/:id/attachments` linkIdcursor inheritedliverefs;GET`/v2/attachments/:id/content`;derivative`/:id/derivatives/:derivativeId/content`;extractions`/:id/extractions` UUID cursor. Ownerweb no machinegrantAPI. no-store/nosniff/ETag;Range416/If-Match mismatch412;octet-stream/contentdispositionattachment even derivative routes.ts:283/559. |

CreateTicket root body004 (selectedWorkflow là lựa chọn UI enum Superpowers/BMAD): `{projectId,parentId:null,level:'request',kind,title,description,mandatory:true,criteria:{workflowChoice:selectedWorkflow},inputs:{},outputs:{},skill:null,workflowPin:null}`. `createTicket`, `v2/server/src/tickets/service.ts:141`, mặc định `criteria.workflowChoice='superpowers'` rồi merge criteria do client gửi; Task3 chỉ cho chọn `'superpowers'|'bmad'` tại key này. Không gửi top-level workflow hoặc tự tạo workflowPin mới nhất. Producer G3 vẫn phải nhận preference này và trả run pin thật. Assistant project/workflow selector wire chờG3, không quên requestedUX.

401 khóa writes→reauthGET session;403 CSRF/Origin/permission không retry mù;404missing;409REVISION_CONFLICT/CONFIG_REVISION_CONFLICT/SELECTION_CHANGED/ATTACHMENT_SELECTION_STALE refetch+retain draft, explicit reapply newintent/key. IDEMPOTENCY_CONFLICT dừng/report, không đổi key tự cứu.422notready blockswhole submit;413policybounds;415unsupported;503missingauthority/config unavailable. GETretrymax3 backoff1/2/4s. Mutation kết quả transport chưa xác nhận hoặc500/502/503/504 cùng key/bodymax3 rồi “Chưa xác nhận kết quả”, retry cùng operation. Không success giả từ ACK. Uploadready replaybusy/timeout/unknown GET compose trước retry; leaseexpiry khôngSTOPproof.

## Task map và ownership

Mục Files ghi đầy đủ đường dẫn tương đối repository với prefix `v2/web/`. Các import trong code mẫu tương đối file test; không có thay đổi root lock. Risk ghi probability × impact: L thấp, M trung bình, H cao. Mọi risk có H phải có mitigation và negative test cụ thể trong task. Các bước chức năng được thực hiện theo từng test cycle nhỏ: viết RED → chạy đúng test → implement tối thiểu → chạy GREEN → cập nhật docs → review → controller commit.

Effort engineering chưa gồm producer wait. Source files mới đều [planned]. Controller owns package/lock/config/main/router/styles/docsmanifest/generated/index/Git/index/commit; mỗi worker owns listed modules+canonical docs draft, không peer edits. Library interfaces freeze trước consumer song song. Additional sharedwrite báo/transfer exactfile; không duplicateclient/modal để tránh ownership.

| Task | h | Blockers | Parallel phù hợp | Ownership |
|---|---:|---|---|---|
|1 Shell/toolchain/evidence |8|G0/reviewplan|Bootstrap tuần tự|webpackage/config/main/router/shell/styles/workspacetest |
|2 Transport/query/events |10|1,002–008|Không shared writes|web/src/lib/**,contracts/**,client/events tests |
|3 Tickets/detail/history |10|2,G1/G3,G4/G5 actions|4pure,5,6docs,7|web/src/tickets/**,tickets.test.ts |
|4 Graph/map |10|2,dialog3,G1|5/6/7|web/src/graph/**,graph/state tests |
|5 Composer/attachment |10|2,G2;statictrước gate|3/4/6/7|web/src/compose/**,attachments/**,compose.test.ts |
|6 Docs/Assistant |10|2,006;Assistant5/G3|Phần docs song song với7|web/src/docs/**,assistant/**,docs-links.test.ts |
|7 Machines/model/workflows |8|2,007/008,G3/G4|3/4/5/6|web/src/machines/**,model-config.test.ts |
|8 Actions/update/E2E |6|3/7,mọi feature,G5/G6|Không heavy song song|web/src/operations/**,e2e/**,fixture/config |

Tổng72h. Mỗi source task cập nhật canonical `docs/v2/web-<flow>.md` đúng 7H2 cùng handback; controller mirror `v2/docs/flows/`+R2/R3/generate/check/commit. Không tạo Markdown mới managed worktree. Không đánh dấu phase complete từ pure/static pass khi producer chưa accepted.

## Task 1: Shell độc lập và bằng chứng hướng UI

**Files mới:** `v2/web/package.json`, `v2/web/pnpm-lock.yaml`, `v2/web/tsconfig.json`, `v2/web/vite.config.ts`, `v2/web/index.html`, `v2/web/src/main.tsx`, `v2/web/src/router.tsx`, `v2/web/src/shell.tsx`, `v2/web/src/styles.css`, `v2/web/test/workspace.test.ts`. Controller sở hữu config/lock/router/styles. Docs canonical `docs/v2/web-shell.md`.

**Interfaces:** SPA base `/crew-v2/`, API prefix `/v2`; shell có outlet, project navigation và loading/error/empty panels. QueryClient là một instance mỗi authenticated browser app, không singleton process/SSR. Draft và graph view có lifetime per tab/root/ticket, không module-global user state. Source không import server runtime/DB hoặc v1.

- [ ] Kiểm G0, R6 coverage, quota/telemetry trước source. Read spec+roadmap hiện hành và producer ledger, không bắt đầu package từ main cũ.
- [ ] Pin registry chính thức đã đọc ngày 03/10: `react/react-dom@19.3.0`, `@tanstack/react-router@1.170.41`, `@tanstack/react-query@5.104.1`, `@xyflow/react@12.12.0`, `@radix-ui/react-dialog@1.1.23`, `react-markdown@10.1.0`, `remark-gfm@4.0.1`; dev `vite@8.3.2`, `@vitejs/plugin-react@6.1.1`, `typescript@7.0.2`, `@types/react/@types/react-dom@19.3.0`, `@types/node@26.6.3`, `@playwright/test@1.63.0`. Recheck official peer/engines/security notices tại implementation; pnpm `--ignore-workspace` chỉ trong web, không đổi lock server/domain. Biome dùng runner đã ghim repo, không thêm formatter.
- [ ] Write workspace isolation RED test trước scaffold: parse package/scripts/base và scan imports cấm `apps/`, `packages/shared`, v1 roles. Missing package phải fail rõ. Sau scaffold test pass không thay acceptance chức năng.
- [ ] Định nghĩa script thực thi: `dev: vite --host 127.0.0.1`, `build: tsc --noEmit && vite build`, `typecheck: tsc --noEmit`, `test: node --test test/*.test.ts`, `test:e2e: playwright test`. Strict/JSX react-jsx/noEmit; pure tests `.ts` không JSX. Vite API proxy vào owned listener controller cấp; production same-origin, không gọi v1.
- [ ] Viết shell/tokens mới theo hướng Jira/Confluence: sidebar theo dự án, toolbar gọn, status có chữ+icon, docs tree/content, responsive1280/768/390. Có focus-visible/reduced-motion/semantic landmarks; mobile không overflow ngoài map. Icon action có accessible name.
- [ ] Chụp actual rendered shell board/docs/map/dialog desktop/mobile bằng Playwright MCP sau resource gate. Trước real producer, preview fixture ghi “Bản minh họa”; screenshot không là API/DB acceptance. Controller lưu PNG/path/hash tại canonical plan folder, đối chiếu ảnh owner đã xem; không hỏi duyệt lại hướng UI.
- [ ] Chạy web typecheck/build/scoped Biome và workspace test; docs7H2/map/check qua controller. Independent spec/quality review trước commit Conventional Commit exact owned files.

**Success:** Build độc lập, không import v1; viewport390px không overflow nội dung; zoom200% vẫn mở ticket được; có screenshot evidence đúng nguồn. **Risk:** M×M toolchain drift, mitigation exact pins/peer/lock check. **Rollback:** tháo riêng static web entry/bundle; không đổi DB/API/v1.

Nguồn primary: [React versions](https://react.dev/versions), [Vite guide](https://vite.dev/guide/), [React Flow accessibility](https://reactflow.dev/learn/advanced-use/accessibility), [TanStack query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys), [WAI modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Exact publisher version/peer metadata đọc trực tiếp `https://registry.npmjs.org/<encoded-package>/<version>`; chưa build thử stack mới trong lượt STATIC.

## Task 2: Transport, cache và event resync

**Files mới:** `v2/web/src/contracts/http.ts`, `v2/web/src/contracts/tickets.ts`, `v2/web/src/contracts/docs.ts`, `v2/web/src/contracts/machines.ts`, `v2/web/src/contracts/attachments.ts`, `v2/web/src/lib/api.ts`, `v2/web/src/lib/session.ts`, `v2/web/src/lib/query-keys.ts`, `v2/web/src/lib/events.ts`, `v2/web/src/lib/pending-operation.ts`, `v2/web/test/client.test.ts`, `v2/web/test/events.test.ts`. Worker chỉ sửa các file đã liệt kê; controller tích hợp shared files. Docs canonical `docs/v2/web-data.md`.

**Interfaces mới được định nghĩa trong task:**

```ts
type PendingOperation = {
  id: string; method: 'POST' | 'PUT' | 'DELETE'; path: string;
  bodyJson: string; storage: 'tab' | 'memory'; state: 'pending' | 'ambiguous' | 'accepted' | 'rejected';
};
type RequestOptions = { signal?: AbortSignal; operation?: PendingOperation };
interface OwnerClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  mutate<T>(operation: PendingOperation, options?: RequestOptions): Promise<T>;
  upload<T>(uploadId: string, file: File, signal: AbortSignal): Promise<T>;
}
type TicketGraph = { nodes: Ticket[]; dependencies: Dependency[]; repairLinks: RepairLink[] };
type JournalEvent = { cursor: string; type: string; projectId: string | null;
  ticketId: string | null; audienceMachineId: string | null; occurredAt: string; data: Record<string, unknown> };
function compareCursor(a: string, b: string): -1 | 0 | 1;
function invalidations(event: JournalEvent): chỉ đọc (chỉ đọc unknown[])[];
const queryKeys = {
  ticket: (id: string) => ['v2', 'ticket', id] as const,
  graph: (rootId: string) => ['v2', 'graph', rootId] as const,
  tickets: (filters: Record<string, string>) => ['v2', 'tickets', filters] as const,
  docsPage: (projectId: string, snapshotId: string, path: string) =>
    ['v2', 'docs', projectId, snapshotId, path] as const,
};
```

`Ticket/Dependency/RepairLink` được định nghĩa tại v2/web/src/contracts/tickets.ts, mirror exact004 cited22/31/32. Không runtime import Fastify/Buffer/database. G0 freeze exact search/provider/applied return DTO trước decoder. `JournalEvent` mirror Event ở `v2/server/src/platform/contracts.ts:13`; không bỏ occurredAt. Runtime decoder kiểm missing/wrong primitive, chỉ tolerate reviewed additive response fields.

- [ ] Write meaningful RED tests: same-origin cookie, CSRF on JSON/raw upload, no mutation before session, 503 không trả JSON, AbortError ambiguous mutation, same body/key across two retries, cursor vượt Number.MAX_SAFE_INTEGER. Ví dụ:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareCursor } from '../src/lib/events.ts';
test('cursor bigint không bị làm tròn', () => {
  assert.equal(compareCursor('9007199254740993', '9007199254740992'), 1);
});
```

- [ ] Implement OwnerClient chỉ same-origin `/v2/`; encode bodyJson một lần mỗi PendingOperation. Mutate retry giữ cùng id/body; sửa ý định phải operation mới sau explicit reapply. Session owner/CSRF memory-only; password/token/API secret không query cache/logger/persist. Pending operation có storage=tab chỉ cho payload không chứa secret và có version trong sessionStorage của tab; payload secret bắt buộc storage=memory. Clear cả hai khi logout/auth boundary. Test serializer phải từ chối lưu operation memory dù caller đưa vào cùng collection.
- [ ] SSE dùng fetch streaming để gửi Last-Event-ID, parse named `event:`; không onmessage-only vì server gửi typed events. UTF8 incremental/CRLF/multiline/comments/chunk split, frame≤1MiB; malformed/overflow đóng và resync, không loop vô hạn.
- [ ] Listener bắt đầu trước initial GET; event đánh query stale. Reconnect đọc `/events?after=<applied>&limit=100` tới empty rồi stream; dedup cursor BigInt/string. Cursor persist sau invalidation enqueue; refetch failure giữ stale/retry visible. Unknown metadata event broad invalidation trong scope, không silent drop. Event không chứa comment/decision body.
- [ ] Refetch graph/list/detail/docs/model/status khi reconnect/focus. Old GET bị cancel hoặc revision guard từ chối row cũ; graph dirty marker refetch whole graph. Không patch subset edges. Snapshot coherence G1, client race guard không chữa torn server transaction.
- [ ] Tests event trùng/out-of-order, auth expiry closes stream, unknown type, aborted GET cũ after newer response, invalidation đang chờ during disconnect. Run scoped unit/types/Biome; actual auth/SSE HTTP private fixture before approval, không mocked browser completion.
- [ ] Controller freeze library interfaces và docs/map/commit. Recheck lifetime: QueryClient theo app/session, operation theo tab, AbortController theo request; không thêm state vào cấu trúc server hiện hữu.

**Success:** Mỗi app/session có một stream; events không tạo mutation trùng; cursor decimal giữ chính xác; logout xóa cache và đóng stream. **Risk:** H×H stale/duplicate actions, mitigation immutable operation +auth/revision/race matrix. **Rollback:** Revert bundle, giữ server idempotency/events; ambiguous pending ID vẫn để replay/reconcile, không xóa accepted data.

## Task 3: Board/list/request, detail chung và timeline

**Files mới:** `v2/web/src/tickets/board.tsx`, `v2/web/src/tickets/list.tsx`, `v2/web/src/tickets/requests.tsx`, `v2/web/src/tickets/detail.tsx`, `v2/web/src/tickets/dialog.tsx`, `v2/web/src/tickets/status.ts`, `v2/web/src/tickets/history.tsx`, `v2/web/src/tickets/queries.ts`, `v2/web/test/tickets.test.ts`. Controller chỉ wiring router; worker không sửa graph/composer. Docs canonical `docs/v2/web-tickets.md`.

**Interfaces:**

```ts
type TicketDetailProps = { ticketId: string; presentation: 'page' | 'dialog' };
function TicketDetail(props: TicketDetailProps): React.JSX.Element;
type TicketDialogProps = { ticketId: string | null; onClose: () => void;
  returnFocus: HTMLElement | null };
function TicketDialog(props: TicketDialogProps): React.JSX.Element;
function requestRoots(tickets: chỉ đọc Ticket[]): Ticket[];
const statusLabels = { pending: 'Chờ thực hiện', ready: 'Sẵn sàng', running: 'Đang chạy',
  needs_input: 'Chờ bạn', paused: 'Tạm dừng', done: 'Hoàn thành', cancelled: 'Đã hủy' } as const;
```

- [ ] RED tests đủ7labels; root `level==='request' && id===rootId && parentId===null`; duplicate ID lấy revision mới. Fixture có hai root cùngtitle, orphan step, mandatory child, done/cancelled; không infer root từ trang đầu/title.
- [ ] List/board dùng exact supported filters, UUIDnextCursor đến null hoặc tải thêm rõ. Filters URL giữ qua đổi chế độ xem. Request-root pagination G1; tạm filter từng trang chỉ khi label chưa đủ/tải tiếp, không claim full danh sách root. Group status bằng chữ+icon, arbitrary status drag disabled.
- [ ] Shared detail load ticket/comments/decisions/attachments/docs refs cùng IDs. Máy/model/difficulty/attempt hiện tại/evidence chỉ từ G1/G3 typed projection; không key criteria tự quy ước hoặc prose thành typed fact. Unknown/missing rõ, không vendor strength table.
- [ ] Timeline chronological cursor từ G1/G3: decision/owner answer/review/fallback/intervention/artifact/commit/docs sync có actor/kind/time/source/rationale. Legacy comments/decisions phải đọc hết pages trước sort createdAt/id, không UUIDorder=chronology. Transcript không thay decision/evidence history.
- [ ] Radix dialog dùng chính TicketDetail, Title/Description/focus trap/inert/Escape/X. Returnfocus node trigger hoặc map container nếu node mất; realtime không giành textbox focus. Draft giữ per ticket khi close; explicit discard mới abandon. Inject một composer Task5, không clone forms.
- [ ] Enumerate six new callers: board card, list row, request selection, graph node, docs related-ticket link, Assistant ticket link. Controller wiring tất cả vào shared detail/query/dialog; review danh sách callsites thực tế file:line sau source tạo.
- [ ] Actual browser tests deep link/reload404, keyboard/200%, draft comment retained during event, terminal read-only, needs_input/repair5 reason. Pause/cancel cần G4/G5 receipts; ACK không báo stopped. Request done đọc server evidence, không clienttoggle.
- [ ] Scoped test/types/Biome, canonical 7H2 docs+controller mapping/commit; independent reviewer kiểm authority và sáu callers.

**Success:** Board/list/dialog đọc cùng ticket/status/revision; draft được giữ khi đóng; deep link và reload hoạt động. **Risk:** M×H sai approval/status, mitigation typed producer authority. **Rollback:** Revert views/router, giữ comments/decisions accepted, không undo bằng xóa DB.

## Task 4: Sơ đồ ticket và viewport

**Files mới:** `v2/web/src/graph/project.ts`, `v2/web/src/graph/layout.ts`, `v2/web/src/graph/state.ts`, `v2/web/src/graph/ticket-map.tsx`, `v2/web/src/graph/ticket-node.tsx`, `v2/web/src/graph/ticket-edge.tsx`, `v2/web/test/graph.test.ts`, `v2/web/test/graph-state.test.ts`. Worker chỉ sửa các file đã liệt kê; controller tích hợp shared files. Docs canonical `docs/v2/web-ticket-map.md`.

**Interfaces:**

```ts
type MapEdge = { id: string; source: string; target: string;
  kind: 'parent' | 'dependency' | 'repair'; cycleId?: string };
type MapProjection = { rootId: string; nodes: Ticket[]; edges: MapEdge[];
  hiddenEdges: MapEdge[]; diagnostics: string[] };
type MapViewState = { rootId: string; viewport: { x: number; y: number; zoom: number };
  expanded: string[]; selectedTicketId: string | null; focusedTicketId: string | null };
function projectGraph(input: TicketGraph, rootId: string, expanded: ReadonlySet<string>): MapProjection;
function layoutHierarchy(input: MapProjection): Record<string, { x: number; y: number }>;
function closeMapDialog(state: MapViewState): MapViewState;
```

- [ ] RED topology tests root→two parallel steps→task và descendants, fork/join nhiều predecessor, repair check→fix cycle 1–5, inherited root input, >100 nodes. Compare every dependency pair before/after projection; không synthetic chain. Dependency cycles invalid; repair historical relation có vòng vẫn được render riêng, không scheduler DAG.
- [ ] Validate ID duy nhất, một root, cùng project/root, parent tồn tại và level hợp lệ, cycle trên chuỗi cha/con và cycle trong dependency DAG. Dangling/cyclic/torn data báo diagnostic+refresh/fallback sang list; không drop orphan hoặc layout loop. Edge IDs `parent:<parent>:<id>`, `dependency:<predecessor>:<ticket>`, `repair:<cycle>:<check>:<fix>`; same endpoints khác kind giữ cả hai.
- [ ] Root/steps mặc định visible. Dependency/repair của task khi collapsed vẫn nằm canonical graph và hiddenEdges và có badge số quan hệ tới công việc thu gọn; expand đúng endpoints. Không gán endpoint task sang step rồi trình bày thành cạnh thật. Node panel quan hệ liệt kê full parent/predecessor/repair ID; Mở tất cả khôi phục tất cả.
- [ ] Layout hierarchical left→right theo cây cha/con, siblings sort theo ID, root giữa subtree; card width320, column gap100, row gap24. Iterative traversal tránh recursion overflow; dependency/repair overlay không ép sequence. Preserve old node positions sau event/child mới; explicit “Sắp xếp lại” mới layout. Không thêm layout engine trước benchmark nhu cầu.
- [ ] ReactFlow chỉ đọc: tắt connect/delete và drag gây mutation; node focusable/Enter mở dialog/keyboard traversal. Parent solid neutral; dependency dashed arrow+“phải xong trước”; repair curved dotted+cycle. Status chữ+icon, không màu riêng. Zoom/pan/fit toolbar accessible; mobile list/currentstep tương đương.
- [ ] Graph/provider mounted khi dialog mở. MapViewState per root/tab; onMoveEnd lưu viewport; realtime chỉ cập nhật dữ liệu không fit. Close chỉ selectedTicketId=null; expanded/viewport/focused ID giữ. Fit ban đầu một lần root mới; fit button explicit. Back/Forward/reload ticket query tested; malformed UUID query không gây mutation.
- [ ] Regression state cụ thể:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeMapDialog } from '../src/graph/state.ts';
test('đóng dialog giữ vùng đang xem', () => {
  const state = { rootId: 'r', viewport: { x: -480, y: 140, zoom: 1.7 },
    expanded: ['s'], selectedTicketId: 't', focusedTicketId: 't' };
  assert.deepEqual(closeMapDialog(state), { ...state, selectedTicketId: null });
});
```

- [ ] G1 real API/PG race: GET graph từ ticket con phải đủ root; child/dependency tạo đồng thời không dangling edges; board/list/map cùng revision cuối. Browser mở dialog task để paste ảnh/comment, đóng ở zoom1.7: x/y delta≤1px, delta zoom≤0.001; realtime không tự fit. Dataset200 steps/600 tasks, đo first usable≤2s trên fixture machine ghi cấu hình; không claim latency trên máy owner chưa đo.
- [ ] Scoped node:test/types/Biome; Playwright MCP screenshot root/fork/join/repair/dialog/viewport được khôi phục; reviewer đối chiếu ảnh owner và mọi cạnh test. Controller 7H2 docs/map/commit.

**Success:** Không suy cạnh hoặc mất cạnh; root luôn nhận diện được; viewport sau khi đóng dialog được đo thật. **Risk:** H×H torn/edge loss; mitigation G1/coherent full root/collapse/cycle/large tests. **Rollback:** Revert route map sang danh sách request đọc được; không đổi ticket graph/schema/workflow.

## Task 5: Composer chung cho create/comment/hội thoại

**Files mới:** `v2/web/src/compose/state.ts`, `v2/web/src/compose/controller.ts`, `v2/web/src/compose/composer.tsx`, `v2/web/src/compose/file-hash.worker.ts`, `v2/web/src/compose/file-hash.ts`, `v2/web/src/attachments/preview.tsx`, `v2/web/src/attachments/queries.ts`, `v2/web/test/compose.test.ts`. Worker chỉ sửa các file đã liệt kê; controller tích hợp shared files. Docs canonical `docs/v2/web-attachments.md`.

**Interfaces:**

```ts
type DraftFile = { localId: string; name: string; size: number; sha256: string | null;
  uploadId: string | null; state: 'selected' | 'hashing' | 'reserved' | 'uploading'
    | 'ready' | 'failed' | 'removing' | 'unknown'; errorCode: string | null };
type ComposeDraft = { purpose: 'ticket' | 'comment' | 'assistant_message'; targetId: string;
  sessionId: string | null; selectionRevision: number | null; text: string; files: DraftFile[];
  submitOperation: PendingOperation | null; state: 'editing' | 'sending' | 'ambiguous' | 'accepted' };
function canSubmit(draft: ComposeDraft): boolean;
type ComposerProps = { draftKey: string; target: ComposeTarget;
  onAccepted: (targetId: string) => void };
function AttachmentComposer(props: ComposerProps): React.JSX.Element;
```

ComposeTarget/ComposeSession/Attachment/Selection mirror009 `v2/server/src/attachments/contracts.ts:28`,32,47,56 vào contracts của Task2. PendingOperation dùng đúng Task2, không duplicate state/client.

- [ ] RED tests file lỗi blocks send dù có text, chỉ ảnh ready comment allowed, text và files cùng rỗng bị từ chối, reserve/remove queue revision, mất phản hồi sau commit replay oneID, receipt partial không show “đã đọc”.
- [ ] Dùng một luồng nhận file cho clipboard.items, drop và input multiple. Paste có text và ảnh phải giữ cả hai; preventDefault chỉ phần đã xử lý, không chặn paste thường. Clipboard unnamed image tên local dễ hiểu/extension. Count/bytes/extensions/MIME theo policy visible trước hashing; server sniff lại. Không gắn cứng25MiB khi policy khác.
- [ ] Hash một File mỗi lượt trong owned worker bằng subtle.digest trên policy-bounded bytes; không bản sao base64, release arrays sau hash. Cancel/close dừng worker, bỏ listeners và revoke object URLs. Hash+size trùng local đưa lựa chọn bỏ file, server ID authoritative. Ngân sách memory trước hash; nếu policy vượt browser budget thì báo giới hạn xử lý client, không bỏ qua âm thầm hash/file.
- [ ] Create compose trước ticket; reserves serialized revision hiện hành. PUT cùng upload ID, tiến độ theo XHR thật upload event nếu cần, credentials/CSRF cùng contract, không tạo phần trăm giả. Abort/ambiguous GET compose: ready thắng; receiving/busy/unknown chờ và retry cùng bytes, không reservation mới khi writer chưa phân giải.
- [ ] Remove abort local rồi DELETEupload expectedRevision/refetch khi409. Confirmed rejected terminal có thể abandon reservation cũ rồi reserve new; kết quả transport chưa xác nhận giữ original reservation. Selection phải bằng mọi active upload ready; không filter file lỗi và gửi ticket thiếu file. Đổi target/project dùng compose mới sau giữ/abandon compose cũ rõ ràng, không reuse target.
- [ ] Atomic ticket/comment payload đúng bảng HTTP. Owner consent giải thích selected inputs cho Trợ lý; chỉ gửi selected-inputs khi owner chọn phạm vi đó, không suy consent từ config/test flag. While sending/ambiguous lock edits; ID đã accept clear draft đúng một lần/invalidate.
- [ ] Retry submit cùng PendingOperation. Reload metadata của tab giữ session/IDs/revision/pending body không có secret, không File bytes; GET compose reconcile. File không còn/ chưa ready yêu cầu reselect đúng SHA/size trước đó, không attachment trùng. Password/API secret/credential thô không qua persistence/composer.
- [ ] Hiển thị refs kế thừa và nhóm refs theo comment bằng projection G2. Nhãn child nguồn request/step/comment; flattened attachment order không suy commentId. Preview chỉ authorized bytes safe raster/verified normalized derivative/ảnh từ Blob local. Original PDF/OOXML download; no iframe HTML/SVG/PDF cùng origin; text escape và giới hạn size, formulas/macros literal. Check original/derivative SHA/MIME from manifest, not filename.
- [ ] Extraction UI actual pending/running/complete/partial/encrypted/corrupt/unsupported/blocked/failed, problems/coverage còn thiếu/page/sheet/cell/span and mức tin cậy đã đọc. Byte đã verify không là model đã đọc/hiểu. Source links survive resume/runtime fallback bằng IDs, không copy upload cho descendants.
- [ ] Real G2 E2E: paste hai PNG và PDF trước create, bỏ một file, transport lỗi thật rồi retry, mất phản hồi sau commit→one ticket/links. Same comment trong dialog text rỗng + ảnh và conversation. Assert IDs trả về/DB thật commentId refs, wake/input revision tăng đúng một lần; producer receiver/corpus/native evidence riêng. Mock upload smoke không chứng minh hoàn thành.
- [ ] Scoped unit/types/Biome; canonical 7H2 docs+mapping/commit; independent reviewer kiểm lifetime/retry/access/render.

**Success:** Không gửi thiếu file đã chọn; một accepted operation chỉ tạo một ticket/comment/message; target sai bị từ chối; preview không thực thi script hoặc tự gọi mạng. **Risk:** H×H dataloss/duplicate/XSS, mitigation selection chính xác/idempotency/safebytes. **Rollback:** Revertcomposer; accepted originals/refs/receipts giữ. Compose đang mở thuộc lượt này abandon qua API; không delete storage/cleanup coi TTL là STOP.

## Task 6: Docs space và Assistant/questions

**Files mới:** `v2/web/src/docs/space.tsx`, `v2/web/src/docs/page.tsx`, `v2/web/src/docs/search.tsx`, `v2/web/src/docs/links.ts`, `v2/web/src/assistant/conversation.tsx`, `v2/web/src/assistant/configuration.tsx`, `v2/web/src/assistant/questions.tsx`, `v2/web/src/assistant/queries.ts`, `v2/web/src/assistant/contracts.ts`, `v2/web/test/docs-links.test.ts`. Worker chỉ sửa các file đã liệt kê; controller tích hợp shared files. Docs canonical `docs/v2/web-docs.md` và `docs/v2/web-assistant.md`.

**Interfaces:** DocsTree/DocsPage exact006 read.ts:9/21; link resolver mới:

```ts
type DocDestination = { kind: 'page'; projectId: string; snapshotId: string; path: string;
  fragment: string | null } | { kind: 'external'; href: string } | { kind: 'blocked'; reason: string };
function resolveDocLink(input: { href: string; currentPath: string; projectId: string;
  snapshotId: string; pages: ReadonlySet<string> }): DocDestination;
```

G3 phải freeze owner wire, answer revision và reply pagination trước integration Assistant. Không định nghĩa approve/reply method hoặc route giả từ type hiện hữu.

- [ ] RED docs link tests Vietnamese/percent encoding/space, fragment, relative../, page thiếu, class trộn, unsafe javascript/data/file URLs, cùng path khác snapshot, Unicode search cursor. Resolve thư mục hiện hành, pin project/snapshot, reject outside root; preserve case của anchor.
- [ ] Tree uses parentPath của server; page/search pin snapshotID từ tree. Switch project/snapshot cancels GET cũ và không show bytes cũ dưới commit mới. Docs thiếu empty state rõ ràng; related-ticket cap20 displayed as source-returned list, G1 pagination trước claim complete links.
- [ ] ReactMarkdown/GFM raw HTML disabled, URL an toàn/link resolver, no rehype-raw; external click noopener/noreferrer, ảnh remote auto-load blocked. No thực thi code; download binary chỉ khi API thật. Commit/time/audit/docsState/contentClass luôn hiển thị; workflow artifact label “Thiết kế/kế hoạch”, không “Đã triển khai”. No WYSIWYG editor suy từ Confluence.
- [ ] Ticket-doc links snapshot thật/paths CAS,409 giữ draft. Unverified/invalid view import warning; docs stale không thành current chỉ vì HTTP200. UTF8 không hợp lệ trả422 visible, không decode làm mất dữ liệu.
- [ ] Sau G3 accepted, Assistant config với machine chính xác/ModelKey đầy đủ từ routing candidates có routing authority, không workflow pool làm certificate. Disabled/unavailable choice blocked/reason hiển thị rõ. Superpowers mặc định/BMAD tùy chọn/project preferences persist qua wire đã accept, không extra fields vào schema strict của messages.
- [ ] Owner message accepted/queued/offline/đang đọc input/reply/partial failure theo producer,HTTP201 cho input không chứng minh Assistant reply. Browser không gọi model/inference hay chạy monitor mỗi năm phút; server owns attention bền vững/dedup. Offline máy đã chỉ định chờ, không tự đổi máy; fallback old/new key và rationale từ intervention đã ghi, không reuse runtime khác sessionID.
- [ ] Questions bound question ID/scopeSha256/revision/gate/artifact/run theo G3. Explicit lựa chọn trả lời/reason gửi API chính xác; comment không approval. Source OFF turn hiện tại drain/chờ theo server, UI không áp fallback ngay.
- [ ] Real API/PG+Playwright: docs Unicode/tree/link/commit/class/stale flags; offline→online một reply; input/comment while running/needs_input wake đúng một lần, không tạo attempt trùng; files mới read receipts before reply; question stale trả409, giữ answer và tải scope mới. Native/multimodal proof phase05/06, không dùng reply giả để nghiệm thu.
- [ ] Scoped test/types/Biome; controller 7H2/mapping/commit; reviewer examines authorization stale and read gắn đúng source.

**Success:** Link giữ đúng snapshot và an toàn; Owner answer không cấp quyền cho artifact cũ; Máy/model được chỉ định có trạng thái chờ đúng. **Risk:** H×H quyền stale hoặc input bị bỏ qua; mitigation question scope và read receipts ở G3. **Rollback:** Revert UI, giữ conversations/answers/designation/inbox, không clear work chỉ vì frontend đổi.

## Task 7: Máy/model, ba switches và workflow version

**Files mới:** `v2/web/src/machines/list.tsx`, `v2/web/src/machines/detail.tsx`, `v2/web/src/machines/source-config.ts`, `v2/web/src/machines/source-switches.tsx`, `v2/web/src/machines/model-pool.tsx`, `v2/web/src/machines/api-provider.tsx`, `v2/web/src/machines/workflow-install.tsx`, `v2/web/test/model-config.test.ts`. Worker chỉ sửa các file đã liệt kê; controller tích hợp shared files. Docs canonical `docs/v2/web-machines.md`.

**Interfaces:**

```ts
function sourceChange(config: SourceConfig, source: 'claude' | 'codex' | 'api',
  enabled: boolean): SourceConfigInput;
function modelIdentity(key: ModelKey): string;
```

SourceConfig/Input/ModelKey/PoolEntry mirror exact008 `models/contracts.ts:98`,103,20,40; GatewayStatus/ConfigInput exact007 `gateway/contracts.ts:126`,36. sourceChange chỉ bỏ credentialStatus, giữ provider ID/endpoint/protocol/models/localHttp; OFF không xóa provider/runtime.

- [ ] RED tests: từng nguồn đổi độc lập; cùng modelId khác runtime/provider/machine vẫn riêng; revision conflict; OFF chặn lựa chọn dù applied còn cũ; một workflow cài lỗi không báo cả hai current. Assert secret không vào persistent operation/logger/query cache.
- [ ] Trang máy đọc metadata+gateway status+project binding. Online theo serverConnection/receivedAt, không hoạt động Trợ lý. Refetch mỗi30s khi trang visible để heartbeat hết hạn không xanh mãi. appVersion/hostVersion/telemetry chờ G4; hiện “Chưa có dữ liệu” trước producer, không lấy version frontend làm app version.
- [ ] Công tắc gửi toàn SourceConfigInput với expectedRevision. Giữ provider config, hiển thị desired/applied/sourceStatus/report riêng. 409 refetch và giữ ý định owner để áp lại trên bản mới bằng key mới; không overwrite cấu hình từ tab khác. OFF giải thích attempt hiện tại tiếp tục; pause riêng. Tắt cả ba có NO_SOURCE_ENABLED rõ ràng.
- [ ] Provider form dùng exact schema008: UUID ID duy nhất, endpoint canonical theo server, protocol responses/chat-completions, model ID unique và declared capabilities, localHttp explicit origin. Declared không là measured. Pool thể hiện available/reason/probe expiry/auth/quota/unverified. Secret chỉ memory/secure POST, cần active key G4 và revision hiện hành; operationId giữ khi ambiguous retry; bỏ secret sau accept/close/logout.
- [ ] Workflow panels riêng BMAD và Superpowers, source/projection cho Claude/Codex/API; nhãn missing/installing/current/mismatch/error, expected/installed version/checksum. Readiness không gộp một bộ thành cả hai. Trusted standard catalogue G4 cấp pins; không paste arbitrary latest URL.
- [ ] Nút Cài/Cập nhật gửi actual reviewed install intent. Config007 chỉ dùng khi desired đổi thật và phải giữ workflow còn lại/maxJobs/enabled; same-config no-op không reinstall, retry cần G4. Offline hiện queued/chờ áp dụng. Run cũ đọc pin riêng ở run/detail, không đổi nhãn theo inventory mới.
- [ ] 007/008 thật HTTP+Playwright: bật/tắt từng nguồn online/offline/all OFF; probe stale/unverified; full key trùng tên; CAS hai tab; provider giữ nguyên/secret redacted; hai workflow partial failure; old run pin giữ sau update. OFF chặn dispatch/fallback/Assistant chọn nguồn thật cần phase04/06 producer evidence, DOM checkbox không chứng minh.
- [ ] Scoped tests/types/Biome, canonical flow7H2; controller mapping/commit, independent review config preservation và current authority.

**Success:** Ba desired switches persist độc lập; pending khác applied; model unavailable không chọn được; partial install/old pin đúng. **Risk:** H×H overwrite/config authority; mitigation preserving CAS/full key. **Rollback:** Revert bundle; muốn đảo desired config dùng mutation mới có revision hiện hành, không rewrite receipt hoặc uninstall runtime.

## Task 8: Owner actions, app update và nghiệm thu thật

**Files mới:** `v2/web/src/operations/ticket-actions.tsx`, `v2/web/src/operations/deploy-approval.tsx`, `v2/web/src/operations/app-update.tsx`, `v2/web/src/operations/contracts.ts`, `v2/web/e2e/auth.spec.ts`, `v2/web/e2e/tickets.spec.ts`, `v2/web/e2e/ticket-map.spec.ts`, `v2/web/e2e/compose.spec.ts`, `v2/web/e2e/docs-assistant.spec.ts`, `v2/web/e2e/machines.spec.ts`, `v2/web/e2e/operations.spec.ts`, `v2/web/scripts/e2e-fixture.ts`, `v2/web/playwright.config.ts`. Controller sở hữu runner/config và producer composition sau khi transfer rõ ràng. Docs canonical `docs/v2/web-operations.md`.

**Interfaces:** Tiêu thụ G5/G6 owner DTO sau freeze. Action có operationId, target/scope/artifact fingerprint, revision, lifecycle/result theo accepted producer. Không tạo method/URL tương lai chưa định nghĩa; UI projection không cấp authority từ nút.

- [ ] RED tests trên real API negative paths: stale ticket/approval fingerprint, gate đã đóng, expired session, target đổi sau evidence, ACK nhưng process vẫn chạy, app tải xong nhưng health/rollback chưa có. Mặc định thiếu authority phải từ chối.
- [ ] Pause/cancel ghi owner decision đúng scope bound current ticket/attempt qua G5, POST commands005 exact body, đọc owner command/attempt/result trước “đã dừng”. Resume theo workflow gate, không arbitrary start. Confirmation hiển thị operation/target/version/artifact cụ thể; authorization đã có giữ qua transport retry.
- [ ] Deploy approval hiển thị target/input/commit/artifact fingerprint và gửi exact G5. Changed target/commit làm approval cũ invalid; không feature approval=deploy approval, không Approve-all. Merge/docs panel hiển thị reported/verified evidence, actual merged commit và docs snapshot match từ08; không done toggle client.
- [ ] App update G6 hiển thị signed release version/checksum/compatibility và lifecycle thực: queued/download/verify/drain/apply/health/rollback/result được mapping từ frozen DTO. Download không success; active jobs chờ; quyền macOS cần cấp trực tiếp có hướng dẫn. Workflow install và app update riêng; không URL bịa/skipSignature boolean.
- [ ] Runner mới dùng accepted buildApp và captured immutable migration prefix, owned listener; real PostgreSQL18.6 trên loopback random port khác5432/55432, DB `crew_v2_`, một worker. Không shared backend restart. Fixture-only seed/proof đứng ngoài production; kiểm HTTP production assembly thật. Test authority không certificate native/live. Password runtime-generated, không credential trong source/log/screenshot.
- [ ] Registry tài nguyên trước launch: scratch nonce/dev/ino, exact DB/container ID, listener PID/start identity, browser context và staging của lượt này. Finally abort request, đóng browser/listener/pool, verify STOP rồi drop own DB/rm exact stopped container/scratch. UNKNOWN giữ/report; không broad prune/rm/tmp/git clean. Interrupt/crash runner cũng phải kiểm cleanup.
- [ ] Unit một lượt trên final owned source; strict/build/scoped Biome; actual API/PG integration theo task; Playwright MCP user journeys thật. Mock DTO/browser smoke chỉ unit/preview. Thiếu G2/G3/G5/G6 ghi scenario blocked và producer cụ thể, không PASS/skipped-as-done. Native/paid calls chỉ khi scope fixture/quota được controller cấp.
- [ ] Evidence desktop/mobile390, keyboard/200%, Chromium và WebKit clipboard/file behavior nơi có. Chụp map root/fork/join/repair, image-only dialog comment và restored viewport; lưu HTTP IDs và isolated DB counts/revisions để prove no duplicate. Record machine/browser/time/HEAD/hash; không secret/request bytes.
- [ ] Independent task review và integrated spec/quality review; controller nested crew-docs --all/staged/range đúng integration view, content review7H2 so source. Exact owned source+flow/generated commit; không deploy trong phase07 acceptance.

**Success:** Các real scenarios và matrix đạt trên frozen source; producer gaps còn thì full completion pending. **Risk:** H×H false acceptance/cleanup gây hư hại; mitigation authority trong scope/real evidence/exact owned handles. **Rollback:** Restore static bundle trước qua release đã duyệt; giữ API/DB/receipts, reconcile accepted operations; không downgrade DB hoặc kill active jobs để revert UI.

## Ma trận kiểm thử

| Area/task | Unit | API+PostgreSQL thực | Playwright MCP thực |
|---|---|---|---|
| Shell1/auth2 | import isolation/request/decoders/retry | login/CSRF/revoke/session replay | login/reload/logout,390px/200%/keyboard |
| Event2 | multiline/CRLF/chunks/bounds/bigint/race | named SSE/backlog/reconnect/credential expiry | event trong GET, cùng revision cuối, một stream |
| Ticket3 | root/status/chronology grouping | >100 pagination, unsupported filter, scoped409 | board/list/request/deep link/dialog, needs_input/repair5 |
| Graph4 | full edges/cycles/collapse/state | child full root/coherent race/inherited descendants | root/fork/join/repair, zoom/pan/fit, viewport restore,800nodes đo |
| Attachment5 | send guard/revision/hash/retry states | ready/closedACK/atomic link/replay/comment refs/ACL | paste/drop/multiple/remove/retry/image-only dialog, count bằng1 |
| Docs6 | URL/Unicode/snapshot safety | actual import/tree/page/search/docs-links | current/stale/class/commit, ticket-page links |
| Assistant6 | pending/question scope projection |011 inbox/designation/read receipt/answer | offline→online reply một lần, new input consumed, fallback compatible |
| Machines7 | CAS/full key/OFF/partial workflow |007/008 desired/applied/probe/report |3switches online/offline/all OFF, old run pin |
| Actions8 | ACK/download không success | stop/fence/approval08/updater09 result | actual stop, stale deploy denied, drain/health/rollback |
| Fixture8 | ownership lifecycle | restore/prefix/resource identities | browser/PID/DB/container cleanup, UNKNOWN retained |

Nghiệm thu cần web strict/build/scoped Biome không lỗi, meaningful tests trên source freeze; đủ actual isolated API/PG và Playwright; independent review không blocking; flow7H2/mapping/generated/content review; screenshot evidence/source HEAD/hash. Không union targeted runs thành PASS toàn coverage. Mỗi report ghi actual runs/count/failure/skip/blocker riêng. Native/parser/production certificates thuộc producer; nếu UI chưa có actual producer thì phần đó chưa nghiệm thu dù render tốt.

## Backwards compatibility và rollback tổng thể

Web/API/DB v2 riêng `/crew-v2/`/`/v2`; không redirect/xóa v1. Imported docs giữ source bytes/identity/audit; UI không sửa docs để đạt current. Không import v1 tickets/history/machines/credentials. DTO004–010 giữ ổn định; additive projections/routes có ledger review trước consumers. Unsupported schema hiển thị bounded compatibility error, không strip input hoặc fallback v1.

Schema/migration không thuộc phase07; producer G0–G6 có backup/restore riêng trước DB mutation. Static deploy thuộc release09 có owner approval cụ thể; giữ previous bundle/sourceSHA. Rollback từng task reverse UI/wiring, không xóa accepted operations/events/files. Desired provider/workflow reversal dùng mutation mới/revision hiện hành. App rollback do updater09 chứng minh health, browser không giả receipt. Tab draft metadata version1; version lạ giữ recoverable metadata/explicit clear, không auto-send old payload.

## Self-review và producer questions còn mở

| Spec hiện hành | Task/gate chịu trách nhiệm |
|---|---|
|1–2 v2 độc lập/data boundary |1/2/compatibility |
|3 Assistant scope/offline/designation |6/G3 |
|4 pool/full key/three switches/multimodal |5/6/7/G2/G3/G4 |
|5 workflow versions/install/isolation display |3/4/7/G4 |
|6 hierarchy/status/reason/repair5/completion |3/4/8/G1/G3/G5 |
|7 idempotency/STOP/merge/deploy/recovery |2/3/5/8/G4/G5 |
|8 monitoring/attention/telemetry/resource |6/7/8, server monitoringG3 |
|9 docs current/commit/artifact/gates |6/8/006/08 |
|10 Jira/Confluence/map/clipboard/comment |1/3/4/5/6/7, reference đã kiểm tra ảnh trực tiếp |
|11 signed update |8/G6 |
|12 full acceptance |Matrix+producer live/native08/09 |

Self-review đã kiểm tra các source path/symbol ổn định bằng search giới hạn và đọc source, trace thứ tự authorize/replay và mutation, dependencies G0–G6, lifetime state, test cho năm ReviewFocus, ownership và rollback từng task. Các file web mới là planned interfaces; DTO Assistant được ghi rõ đang đổi, chưa accepted. Các producer questions chưa có wire không được đổi thành URL hoặc method giả. Plan chưa independent review; chưa web source/E2E. Nếu controller đổi status chạy `ak plan --help` theo CLI, không sửa ô status trực tiếp.

Questions chỉ ở producer, không hỏi lại owner UX: G0 R6/web coverage và ledger DTO; G1 coherent graph/root pagination/history/current attempt; G2 mounted attachment/comment grouping/parser/read authority; G3 accepted011 và owner Assistant/routing/question wire; G4 version/telemetry/catalogue/install retry/active key/owner receipts; G5 target-bound08 actions; G6 signed updater09 wire. Không phát minh URL hoặc boolean bypass cho phần chưa accepted.

## Lệnh kiểm chứng theo task

Chạy từ managed repository sau khi controller mở đúng resource gate. Mỗi task chạy riêng test đã viết trước source để thấy RED, rồi chạy lại sau implementation để thấy GREEN; không chạy broad suites lặp lại khi không có thay đổi mới.

| Task | Lệnh test có phạm vi | Kiểm chung sau GREEN |
|---|---|---|
|1|`pnpm --dir v2/web exec node --test test/workspace.test.ts`|`pnpm --dir v2/web typecheck`, `pnpm --dir v2/web build`|
|2|`pnpm --dir v2/web exec node --test test/client.test.ts test/events.test.ts`|Typecheck và Biome trên lib/contracts/test đã sở hữu|
|3|`pnpm --dir v2/web exec node --test test/tickets.test.ts`|Typecheck và Biome trên tickets/test đã sở hữu|
|4|`pnpm --dir v2/web exec node --test test/graph.test.ts test/graph-state.test.ts`|Typecheck và Biome trên graph/test đã sở hữu|
|5|`pnpm --dir v2/web exec node --test test/compose.test.ts`|Typecheck và Biome trên compose/attachments/test đã sở hữu|
|6|`pnpm --dir v2/web exec node --test test/docs-links.test.ts`|Typecheck và Biome trên docs/assistant/test đã sở hữu|
|7|`pnpm --dir v2/web exec node --test test/model-config.test.ts`|Typecheck và Biome trên machines/test đã sở hữu|
|8|`pnpm --dir v2/web test`, `pnpm --dir v2/web typecheck`, `pnpm --dir v2/web build`, `pnpm --dir v2/web test:e2e`|Playwright MCP chạy cùng isolated fixture và lưu evidence; CI Playwright runner không thay yêu cầu MCP|

Controller dùng `pnpm exec biome check` với exact owned paths, cấu hình Biome gốc. Docs gate dùng bundled crew-docs của v2, đúng flow trong `v2/docs/flows.yaml`, rồi `check --all`, `check --staged` và range check theo integration view. Nếu Playwright MCP không có trong runtime, báo browser acceptance blocked và giữ phase pending; không tự thay bằng mocked smoke.
