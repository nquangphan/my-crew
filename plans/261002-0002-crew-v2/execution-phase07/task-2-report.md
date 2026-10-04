# CREWV2-701 / Task 2 — transport, phiên owner, cache và đồng bộ sự kiện

BASE `9c6ef5a`, commit source `2b958b8` (worktree `my-crew-v2`, nhánh `codex/crew-v2-server`), Node v24.21.0, pnpm 10.32.1, Asia/Ho_Chi_Minh.
Brief `execution-phase07/task-2-brief.md`. Worker Claude (web-task2); không dispatch subagent/reviewer.

## 1. Tiền kiểm tĩnh

### Hợp đồng producer đã đọc tại HEAD (chỉ đọc, không sửa server)

| Hợp đồng | Nguồn | Điều web dựa vào |
|---|---|---|
| `Event` | `v2/server/src/platform/contracts.ts:13` | `{cursor,type,projectId,ticketId,audienceMachineId,occurredAt,data}`; cursor là chuỗi thập phân |
| Cursor | `v2/server/src/journal/events.ts:16-23` | `^(0|[1-9][0-9]*)$`, ≤ 9223372036854775807 (vượt `Number.MAX_SAFE_INTEGER`) |
| GET `/v2/events` | `v2/server/src/journal/routes.ts:72-79` | query chỉ `after`,`limit` (1–100) → `{items: Event[], cursor}` |
| GET `/v2/events/stream` | `v2/server/src/journal/routes.ts:81-128` | `Last-Event-ID` ưu tiên hơn `after`; frame `id:`/`event: <type>`/`data: <Event JSON>`; comment `: connected`, `: heartbeat`; tự đóng socket khi buffer >64KiB |
| Loại event | `v2/server/src/journal/event-contracts.ts:70-333` | 28 type đã review; không mang body comment/decision |
| POST/GET/DELETE `/v2/auth/session` | `v2/server/src/auth/routes.ts:91-150` | POST `{password}` 1–4096, Origin bắt buộc, 401 `INVALID_CREDENTIALS`, 429 `LOGIN_THROTTLED`, 503 `OWNER_NOT_BOOTSTRAPPED` → `{owner:{id:'owner'},csrfToken}`; GET cùng shape; DELETE cần Origin+`X-CSRF-Token` → 204 |
| `getSession` | `v2/server/src/auth/session.ts:95` | hết hạn/revoke → 401 `UNAUTHENTICATED` |
| `requireOwner` | `v2/server/src/auth/routes.ts:36-48` | kiểm session trước, rồi Origin + CSRF cho write |
| `createMutator` | `v2/server/src/journal/mutation.ts:15-54` | key `[\x20-\x7e]{1,128}`; scope actor/route/key (không gắn session); body hash khác → 409 `IDEMPOTENCY_CONFLICT`; trùng → trả response đã lưu |
| POST `/v2/projects` | `v2/server/src/projects/routes.ts:84-101`, `service.ts:47-83` | `{key,name,repositoryUrl}` → 201 Project; append `project.created` |
| Lỗi chung | `v2/server/src/app.ts:51-65` | `{error:{code,message}}`; lỗi lạ → 503 `SERVICE_UNAVAILABLE` |
| Ticket/Dependency/RepairLink | `v2/server/src/tickets/contracts.ts:8-33`, `service.ts:28-50`, `dependencies.ts:153-182` | Ticket response theo `mapTicket` (không có `deployApprovalDecisionId`), graph `{nodes,dependencies,repairLinks}` |
| Page comment/decision/tickets | `v2/server/src/tickets/routes.ts:199-238,337-428` | `{items,nextCursor}` UUID |
| Docs tree/page/search | `v2/server/src/docs/read.ts:9-30`, `search.ts:8-20,137`, `contracts.ts:46` | `DocsTree`, `DocsPage`, `DocsHit` + `nextCursor` base64url (không phải UUID) |
| Machine/Project | `v2/server/src/auth/machine.ts:7`, `auth/routes.ts:179-230`, `projects/service.ts:13-22` | Machine, page, Project |
| Model sources (provider/applied) | `v2/server/src/models/routes.ts:211-221`, `models/config.ts:108-120`, `models/contracts.ts:20-110` | GET trả `SourceConfig & {applied}` hoặc `{desiredConfig:null, applied}`; applied có `revision,reportId,bootGeneration,sequence,inventoryReportId,reportedAt,sourceStatus` |
| Attachment | `v2/server/src/attachments/contracts.ts:26-56`, `routes.ts:344-470`, `config.ts:5-41` | policy, ComposeSession, Attachment, reserve result; PUT content octet-stream + CSRF, không key; API chưa mount production (G2) |

Không phát hiện khoảng trống G0 cho phạm vi Task2: session/events/receipt (idempotency replay) đều có route thật trong `buildApp`. Gateway status (`gateway/contracts.ts:126`) thiếu appVersion/hostVersion/telemetry theo G4, nên contracts web **không** khai báo decoder cho nó (Task7/G4).

### Kế hoạch file

`v2/web/src/contracts/{http,tickets,docs,machines,attachments}.ts`, `v2/web/src/lib/{api,session,query-keys,events,pending-operation}.ts`, `v2/web/src/auth/{login,session-boundary}.tsx`, `v2/web/test/{client,events,auth-recovery}.test.ts`, `v2/web/e2e/{auth,events}.spec.ts`; docs flow mới `web-data` (`v2/docs/flows/web-data.md`, mục manifest trong `v2/docs/flows.yaml`).

Login/reauth chưa được controller nối vào router (`main.tsx`/`router.tsx` thuộc controller). E2E A2 vì vậy mount đúng component `SessionBoundary`/`LoginScreen` thật vào một root do test sở hữu trên trang Vite của fixture, dùng chính module React đã được Vite tối ưu cho app; request đi thật qua proxy `/v2` tới API/PostgreSQL.

### Ma trận test

| Checkbox brief | Test |
|---|---|
| RED: same-origin cookie, CSRF JSON/raw upload, no mutation trước session, 503 không JSON, AbortError ambiguous, cùng key/body qua 2 retry, cursor > MAX_SAFE | `test/client.test.ts`, `test/events.test.ts` |
| OwnerClient chỉ `/v2/`, bodyJson freeze, intent không cấp key mới, serializer từ chối memory/token/secret/hash | `test/client.test.ts`, `test/auth-recovery.test.ts` |
| Session state machine, 401 → expired, suspend, giữ key/body | `test/auth-recovery.test.ts`; E2E `auth.spec.ts` |
| Logout → tombstone không payload, reload/close secret → tombstone, 409 giữ tombstone | `test/auth-recovery.test.ts`; E2E `auth.spec.ts` |
| Login/reauth UI, password 1–4096, 429 không retry, return route nội bộ | `test/auth-recovery.test.ts` (`safeReturnPath`, login validation); E2E `auth.spec.ts` + screenshot |
| A2 real API/PG lost-response → expiry → reauth → replay → 1 project/receipt | E2E `auth.spec.ts` |
| SSE fetch + Last-Event-ID, parser UTF-8/CRLF/multiline/comment/chunk/1MiB, malformed/overflow resync có giới hạn | `test/events.test.ts`; E2E `events.spec.ts` |
| Listener trước GET, catch-up `/events?after=&limit=100`, dedup BigInt, cursor persist sau enqueue, unknown type broad | `test/events.test.ts` |
| Refetch khi reconnect, GET cũ bị hủy/revision guard | `test/events.test.ts`, `test/client.test.ts` |
| Event trùng/out-of-order, auth expiry đóng stream, invalidation chờ khi mất kết nối | `test/events.test.ts`; E2E `events.spec.ts` |

## 2. RED

Interface scaffold cố ý thiếu hành vi (client từ chối, parser không phát frame, `compareCursor` so bằng `Number`), không có lỗi import. Lệnh `node --test test/client.test.ts test/events.test.ts test/auth-recovery.test.ts` (heap 384 MiB, watchdog 120 giây) cho exit 1: tests 31, pass 1 (decoder), fail 30. Các lỗi là assertion hành vi, ví dụ `cursor bigint không bị làm tròn` báo `0 !== 1`, cùng các trường hợp thiếu Idempotency-Key/CSRF, `timeout: live` hay thiếu exception của serializer. Log `task-2-red.log` có SHA `3d6ab8e2645d5dffe7df8b9bf795abb8038303f3c74c3c368127b37d12e4b02c`.

## 3. GREEN và kiểm tra cuối

Tất cả lệnh chạy trong `v2/web`, giữ sole heavy slot `$TMPDIR/crew-v2-heavy-slot.lock` (owner=web-task2), heap 384 MiB, watchdog Python.

| Lệnh | Kết quả | Log, SHA-256 |
|---|---|---|
| focused `node --test` ba file mới (trước format Biome) | exit 0, 31/31 | `task-2-green-focused.log` `6af92034104c664dc05d030bb6272b3370a1b33b465135189861955a759cf039` |
| `tsc --noEmit` (trước format Biome) | exit 0 | `task-2-typecheck.log` `46a170bc9cf8dc9417e27b787c0ca12e9955dabf55f8bf5c0e2d394b1c2bfadf` |
| `biome check` 17 file của task, chạy từ gốc repo, sau `--write` và sửa 1 lỗi cùng 4 cảnh báo | exit 0, Checked 17 files, không còn diagnostic | `task-2-biome.log` `379046bb0e41454439c593590aeb64de3e6daa09e8dd43d988a3bd9b69da2207` |
| `playwright test e2e/auth.spec.ts e2e/events.spec.ts --reporter=list` (sau format) | exit 0, 3 passed trong 11,1 giây (wall 11,86 giây) | `task-2-e2e.log` `0271d2059738ddfae85690e72e715b1b8b450929b3aad2bbb02b5bda4fae8123` |
| `node --test test/*.test.ts` (toàn web unit, gồm lifecycle PostgreSQL thật, sau format) | exit 0, 38/38 | `task-2-unit-full.log` `82cdac4b904ff4c001228dcd7003cd56f4deeff24d3077930ffcc74b07a452d0` |
| `tsc --noEmit && vite build` (sau format) | exit 0, built 499 ms, JS 322,46 kB | `task-2-build.log` `1fcc8f705f8707f3473f64e4c3a1a5921483ea8dfd034311350915347f235a9b` |
| `crew-docs generate` và `check --all` trong bản sao tạm có `v2/` làm Git root | `check --all: ok`, exit 0; chỉ thêm các dòng `web-data` vào `index.md`/`files.md` | ghi tại đây |

Bằng chứng cuối cho source đã đóng băng là E2E, toàn web unit và build (gồm `tsc`), cả ba chạy **sau** format. Hai log focused/typecheck ghi lại GREEN trước khi format.

Screenshot do harness Task1 tạo, không chứa mật khẩu: `task-2-login.png` `e12f20cad0b879c53711db0ca437b3bd1f0b9f7385319fee0835489bf209cdd9`, `task-2-expired.png` `7f50e4fcfd2f906b5c2f6cda6098063666f3197b4734f08b4d18ee10c6790f93`, `task-2-recovery.png` `6b952f8679fa2c49ab779f0ed9fd777e63c730017276865d5a66cd54b0ab6bd6`.

A2 trên API/PostgreSQL thật: server commit POST `/v2/projects` (201) rồi response bị cắt (`route.fetch` → `abort('connectionreset')`). Client báo `UNCONFIRMED`, DB có 1 project. Phiên được cho hết hạn bằng `update sessions` qua kết nối DB riêng của fixture. Bấm “Gửi lại” nhận 401, UI chuyển sang màn hình đăng nhập lại, không hiện panel/payload. Write khi hết phiên bị chặn với `SESSION_REQUIRED`, không có POST nào ra mạng. Owner đăng nhập lại; panel “Tạm dừng vì hết phiên” replay thành công. Ba POST cùng `Idempotency-Key` và cùng body; CSRF lần cuối khác lần đầu. Login POST không có CSRF/key. DB: project 1, receipt `idempotency` 1, event `project.created` 1, project bị chặn 0. Test thứ hai: DELETE có CSRF; sessionStorage chỉ còn tombstone, không có secret/BTWO/bodyJson; intent cũ trả `INTENT_UNRESOLVED`; payload khác bị 409 `IDEMPOTENCY_CONFLICT` mà tombstone vẫn giữ; nhập lại đúng thì accepted; DB có 1 project và 1 receipt; secret không bao giờ được gửi; nạp lại tab chỉ còn tombstone của secret. SSE thật: catch-up `after=0&limit=100`, một stream có Last-Event-ID; `project.created` invalidate `['v2','project',id]`; cursor khớp DB và sessionStorage; phiên hết hạn thì server log `UNAUTHENTICATED`, client ở `stopped`/`expired`; sau khi đăng nhập lại, web catch-up từ đúng cursor và gửi Last-Event-ID đúng cursor đó.

## 4. Tài nguyên và cleanup

Telemetry khi lấy slot (GiB khả dụng / pressure / CPU idle % / đĩa GiB): RED 5,179/1/81,76/753,9; GREEN 5,149/1/72,41/753,9; final 4,868/1/83,93/753,9. Cả ba đều đạt gate. Slot được trả bằng `rm -rf` đúng thư mục lock sau mỗi đợt; lần trả cuối có `ls` xác nhận lock không còn.

E2E chạy hai fixture tuần tự (mỗi spec một fixture worker-scope), API listener 63323 và 63762, runner PID 56721 cùng worker 56748/57051. Witness sau run: danh sách `docker ps -a` trùng với trước run (chỉ còn container của người khác: crew-dev-postgres, magical_lehmann, modest_jemison, visinote-*); `docker ps -a --filter name=crew-v2-web` rỗng; `ps -p 56721,56748,57051` rỗng; `lsof` LISTEN trên 63323/63762 rỗng; TMPDIR không còn `crew-v2-web-*`. Witness tương tự sau lượt full unit (lifecycle). Bản sao docs tạm trong scratchpad đã xóa.

## 5. SHA-256 source cuối

| File | SHA-256 |
|---|---|
| `v2/web/src/contracts/attachments.ts` | `2d9a5873e66f8588333c2dd51742c11eb5e7e10000f475800512aa9112bac4c5` |
| `v2/web/src/contracts/docs.ts` | `9a3d0bf429665eb1b4c1e14d995ae84a3e7692362d14f7b30938762d3bbcea3a` |
| `v2/web/src/contracts/http.ts` | `9f7c83b204cc1e249a8aacd62959916aef93454273ea2705b7caee9ffa8cd075` |
| `v2/web/src/contracts/machines.ts` | `6faac09d972757aeb9b393bcca68408880f9b1d33e25cc65b84d2b2ce0ecd6f6` |
| `v2/web/src/contracts/tickets.ts` | `49e94a79d014f5eb2b29c83b09967722dcc79e63af1c2fc5c5c6e6abbb6330ef` |
| `v2/web/src/lib/api.ts` | `69b32337851d4f7aa582bdd6139d07eedeae66f9f33b692bffa361743968f19b` |
| `v2/web/src/lib/events.ts` | `e5f17ff9347f22ad549053dd2c673adc4f3f1fbbf82274396dcfc63d68b46c76` |
| `v2/web/src/lib/pending-operation.ts` | `2964c844ddafa2db6dddab3ddf5c844e7cfa24ac1807fd60eb9ddf114c6a146e` |
| `v2/web/src/lib/query-keys.ts` | `21a902feea84dc9871ed74f5482b14edc8f21bb0cebe8ca74553f8c724208732` |
| `v2/web/src/lib/session.ts` | `8fc78439cc4d4dd119f89459df68b7fe855283b5c599080e268660faf8375f8a` |
| `v2/web/src/auth/login.tsx` | `a1753deafd3015481b049ea308afa59f0f6d9d70d964cc465bb1c33e5d933ff3` |
| `v2/web/src/auth/session-boundary.tsx` | `e6b1fd6e020e7beead3fc07feee58e0470100452481922d0095b225fbce07c60` |
| `v2/web/test/client.test.ts` | `b4dd1e274829507a65731e1c39cc5bae0d99d41f694e0d1f79db094695d9a149` |
| `v2/web/test/events.test.ts` | `2812f93c69bbe70f672b08fb3bda58216f15e28f2963402b1b4a65eeedd5dea8` |
| `v2/web/test/auth-recovery.test.ts` | `76bd01e555fa8d7ac66fe4b2dc672b592130bed708da1016f25d6f73896c5a45` |
| `v2/web/e2e/auth.spec.ts` | `f7617e48300e0e571aa2e48b936afb6dcfe66464a6a4066e66a1d2c58f03a4fe` |
| `v2/web/e2e/events.spec.ts` | `2adfb736f510377c185f13df617ded68a5f7b0db62d28da76f01f2982c732bfd` |

## 6. Tự review và điểm cần PM/controller biết

- Phạm vi file: chỉ 17 file trong brief, cùng `v2/docs/flows.yaml` (thêm flow `web-data`), `v2/docs/flows/web-data.md`, khối generated trong `v2/docs/index.md`/`files.md` và các file `task-2-*` ở đây. Không sửa server, router/main/styles hay fixture.
- Router/shell chưa được nối, vì `main.tsx`/`router.tsx` thuộc controller. E2E mount đúng `SessionBoundary`/`LoginScreen` production vào một root do test sở hữu, dùng cùng bản React đã được Vite tối ưu (URL lấy từ `main.tsx` đã transform), trên trang thật của fixture. Khi wiring, controller dùng `wireSession({session,pending,cache: queryClient,events,window})` và nên đặt `retry: false` cho query dùng `OwnerClient.get`, vì client đã tự retry tối đa 3 lần (backoff 1/2/4 giây).
- Ngoài các key brief chốt, `queryKeys` có thêm key cho comment/decision/docs tree/search/project/machine/model/gateway/attachment, tất cả dưới `'v2'`, để invalidation phủ đủ view.
- Tab mới chưa có cursor sẽ catch-up từ `0` theo trang 100 (đúng brief, server không có endpoint head). Với journal lớn, lần mở đầu sẽ tốn nhiều request; chỉ xử lý được bằng một producer contract mới, không thuộc Task2.
- `RecoveryTombstone.targetId` là UUID đầu tiên trong path; `expectedRevision` lấy từ body nếu là số nguyên an toàn.
- Gateway status chưa có decoder (G4). Decoder attachment phản ánh contract `cf68a68`, nhưng route chưa mount production (G2).
- M1 trong fixture Task1 vẫn để nguyên như đã hoãn.

## 7. Vòng sửa 1 (review `task-2-review.md`, Important #1)

**Finding:** `mutate` coi mọi 4xx khác 409 là terminal và nhả key, kể cả 403 `CSRF_INVALID`/`ORIGIN_INVALID` do `requireOwner` ném trước bước tra idempotency. Tab cũng không có cách làm mới CSRF.

**Rà mã server ném lỗi trước bước tra idempotency:**
- `requireOwner` (`auth/routes.ts:36-50`) ném 401, 403 `OWNER_REQUIRED`/`ORIGIN_INVALID`/`CSRF_INVALID` và 503.
- Schema Fastify, parser body, `IDEMPOTENCY_KEY_INVALID` và `BODY_INVALID` trả 400; parser còn có thể trả 413/415.
- Các callback `MutationContext.authorize` chạy *trước* bước tra key (`journal/mutation.ts:33-36`) và ném lỗi phụ thuộc trạng thái server: `authorizeTicketMutation`, `authorizeCreateCommandMutation`, `authorizeAttemptMutation`, `authorizeCommandMutation` và `authorizeGatewayMutation` ném 404 (gateway còn ném 401); `authorizeDocsSync` ném 403/404/409/422; Assistant ném 403. Riêng `authorizeSubmission` chỉ ném 400 khi ID trong body sai định dạng, nên lỗi đó phụ thuộc bytes.

Kết luận: chỉ 400/413/415 là lỗi do bytes quyết định, nên luôn là terminal. Mọi 4xx khác chỉ terminal khi khóa đó chưa từng có lần gửi có thể đã commit, nghĩa là operation đang `pending` lúc gọi và trong lượt gọi chưa có lần gửi nào ambiguous.

**Thay đổi:**
- `api.ts`: 403 CSRF/ORIGIN → `suspended` → `session.refresh()` → replay đúng key/body, tối đa một lần làm mới mỗi lượt gọi; vẫn lỗi thì dừng và giữ khóa. 4xx khác được phân loại như trên; trường hợp không terminal giữ `ambiguous`.
- `upload` gặp 403 CSRF thì làm mới CSRF rồi báo lỗi.
- `session.ts`: thêm `refresh()` (single-flight, giữ epoch; nhận 401 hoặc owner khác thì `expire()`). `logout` gặp 403 CSRF thì GET lại session lấy CSRF mới và DELETE lại một lần, để server thật sự thu hồi phiên.
- `session-boundary.tsx`: panel nói rõ yêu cầu vẫn giữ khóa cũ khi operation còn.
- Docs: `v2/docs/flows/web-data.md` bước 4/6 và mục Tests.

**Test mới:** `client.test.ts` thêm 4 test: 403 CSRF trên operation ambiguous làm mới rồi replay cùng key/body; làm mới gặp 401 thì expired, `suspended`, `begin` cùng intent vẫn ném `IntentUnresolvedError`; ORIGIN lặp lại chỉ làm mới một lần; 404 sau ambiguous, hoặc 409 sau lỗi transport trong cùng lượt, giữ khóa, còn 400 và 404 trên operation mới thì terminal. `auth-recovery.test.ts` thêm 1 test logout với CSRF cũ.

| Lệnh (heap 384 MiB, watchdog, sole heavy slot) | Kết quả | Log, SHA-256 |
|---|---|---|
| RED `node --test test/client.test.ts test/auth-recovery.test.ts` | exit 1, tests 27, fail 5, đều do assertion hành vi (ví dụ `2 !== 4`, `404 từ authorize không chứng minh chưa commit`) | `task-2-fix1-red.log` `6c111653fe578d623b9b9f4194d85c5198b9061fcb08d4559350dd5456a58cc7` |
| GREEN cùng lệnh | exit 0, 27/27 | `task-2-fix1-green-focused.log` `dc0bf6b1ac6f024ba0537c822565836e660f4de89ca807528a7a6db814253026` |
| `biome check` 17 file | exit 0, không còn diagnostic | `task-2-fix1-biome.log` `b8995304cf3bac13573cdf7f2e6e714a498b9b520956078a009d02a3802e4b81` |
| `tsc --noEmit` | exit 0 | `task-2-fix1-typecheck.log` `96ea98a91f614e6e1badaaa6343519d8c046c83fd3425183ed23609245cb42f1` |
| `node --test test/*.test.ts` | exit 0, 43/43 | `task-2-fix1-unit-full.log` `025b896dce19c809b0765da7424560dade03530d383bedbd02be3535d5afe9a5` |
| `playwright test e2e/auth.spec.ts e2e/events.spec.ts` | exit 0, 3 passed (10,3 giây) | `task-2-fix1-e2e.log` `c56d35d08b2b0f05f0f969698397a4fadb5400c6e8860a3748fab8a757df28ee` |

Telemetry (GiB khả dụng / pressure / CPU idle % / đĩa GiB): RED 4,933/1/85,9/753,6; GREEN 4,779/1/83,33/753,6. Slot đã trả.

Cleanup: danh sách `docker ps -a` trước và sau run trùng nhau; TMPDIR không còn `crew-v2-web-*`; PID 85391/85407/85714 không còn; không còn listener trên 52111/52512; `test-results` đã xóa. Ba screenshot chạy lại có hash trùng bản cũ.

Hash source sau vòng sửa:

| File | SHA-256 |
|---|---|
| `v2/web/src/lib/api.ts` | `f19d03bf659f1a5aa3b1f505f07ae8d2a093bd27e14246b773e98af5f88536b3` |
| `v2/web/src/lib/session.ts` | `8f300eb5f3b28b5a5b63f7a0e62632470614c627309fbfcd4d4729f1c3003303` |
| `v2/web/src/auth/session-boundary.tsx` | `9ee1989345633bcd41cb1f19e2cf1ec1e16d274739cb8264dd419932f45091ae` |
| `v2/web/test/client.test.ts` | `8717fa57641455a6ffcc5ee83b97e03e802566ee232c5bd6ac198b945dd207d1` |
| `v2/web/test/auth-recovery.test.ts` | `26d885e13fb5377c5de4be30616bac742fc706ac4b54d9229d6f654235c4941a` |

**Còn lại:** khi operation bị giữ `ambiguous` vì một 4xx phụ thuộc trạng thái (ví dụ ticket đã bị xóa), panel vẫn cho gửi lại nhưng chưa có cách để owner chủ động bỏ yêu cầu đó. Việc này cần quyết định UX (xác nhận bỏ, tức chấp nhận rủi ro trùng). Các Minor trong ledger chưa sửa trong vòng này.

## 8. Vòng sửa 2 (re-review `task-2-fix1-re-review.md`: N1, N2, N4)

**Thay đổi:**
- **N1** (`api.ts`, `pending-operation.ts`): operation nhập lại từ tombstone (`PendingStore.isResumed`) gặp bất kỳ 4xx nào (gồm 400/413/415 và 4xx phụ thuộc trạng thái) đều đi qua `pending.conflict(id)`. Operation quay về tombstone với key cũ, payload nhập sai bị bỏ; key không bị nhả. Lý do: server kiểm schema/limit/content-type trước bước so `body_hash`, nên bytes nhập lại khác bản gốc có thể nhận 400 thay vì 409.
- **N2:** `PendingStore.claim/release` làm mỗi operation chỉ có một lượt gửi đang chạy trong tab. Lượt trùng nhận `OPERATION_IN_FLIGHT` (`kind: 'local'`), không gửi request và không đổi state; `uncertain` không bị suy sai nữa.
- **N4:** nhánh làm mới CSRF kiểm `request.signal` trước và sau `refreshCsrf()`. Nếu caller đã abort, web không replay, operation về `ambiguous` với key giữ nguyên, và lỗi trả `kind: 'aborted'`.
- Docs: `v2/docs/flows/web-data.md` bước 4 và mục Tests. N3 không sửa (PM đã ghi ledger).

**Test mới (`client.test.ts`):**
- Resume rồi nhận lần lượt 400/413/404: tombstone vẫn còn đúng key, `begin` cùng intent ném `IntentUnresolvedError`.
- Hai lượt `mutate` song song: lượt sau bị `OPERATION_IN_FLIGHT`, chỉ có 1 request; lượt đầu vẫn accepted.
- Abort trước khi làm mới (không GET, không replay) và abort trong lúc làm mới (CSRF đã đổi nhưng không replay): key được giữ.

| Lệnh (heap 384 MiB, watchdog, sole heavy slot) | Kết quả | Log, SHA-256 |
|---|---|---|
| RED `node --test test/client.test.ts` | exit 1, tests 19, fail 3, đều do assertion hành vi (`400: tombstone giữ key cũ`, validation `OPERATION_IN_FLIGHT`/aborted trả false) | `task-2-fix2-red.log` `2b03b01bc2b856084f79343a6b729cc9e95f269ac455662673b11c6b72c212bf` |
| GREEN cùng lệnh | exit 0, 19/19 | `task-2-fix2-green-focused.log` `f66b2abbe043e187cfe342da2378d9c05eeaae03c728446357e5c92538dbc51d` |
| `biome check` 17 file | exit 0, không còn diagnostic | `task-2-fix2-biome.log` `a9a8e0b6216a1031f7979d6a1fcfe2e4f2323708cccbb6fce467cda40237ea05` |
| `tsc --noEmit` | exit 0 | `task-2-fix2-typecheck.log` `1af1bb3e095d3cec2b5393c43bebf21a1c19c83c8cbeb8d799cb0cb4be1ba748` |
| `node --test test/*.test.ts` | exit 0, 46/46 | `task-2-fix2-unit-full.log` `072d78f7f72d06e1dc17a47e5640f0e405fc5ebc0b1b1e6dd2e6333363cfa9b4` |
| `playwright test e2e/auth.spec.ts e2e/events.spec.ts` | exit 0, 3 passed (10,3 giây) | `task-2-fix2-e2e.log` `a6afebb5850919ee33caaabe6f249720c52f0e2302c0e48471b71bca72b049e9` |

Telemetry (GiB khả dụng / pressure / CPU idle % / đĩa GiB): RED 4,888/1/72,8/753,3; GREEN và E2E 4,828/1/60,28/753,3. Slot đã trả; `ls` xác nhận lock không còn.

Cleanup: danh sách `docker ps -a` trước và sau E2E trùng nhau; TMPDIR không còn `crew-v2-web-*`; PID 275/299/543 không còn; không còn listener trên 55285/55691; `test-results` đã xóa.

Hash source: `v2/web/src/lib/api.ts` `54ac911dc59c56c728025298996ee7a4a2b2fa46e077875eec0ca87bccb5c599`, `v2/web/src/lib/pending-operation.ts` `27195508e2cb43f766c84839840ea9230100f2aeac160a1abfa6208bea36a786`, `v2/web/test/client.test.ts` `78074aa354579e6c333330e33550a3f194ce23030128d63758a275af56e61b69`.

**Còn lại:**
- Guard in-flight nằm trong `PendingStore` của tab, chưa chặn hai tab cùng gửi một operation. Với operation tab, sessionStorage là riêng cho mỗi tab nên tình huống này không xảy ra.
- Khi payload nhập lại bị đưa về tombstone, panel hiện “Máy chủ từ chối yêu cầu (code)” cùng dòng tombstone. Câu chữ có thể làm rõ hơn trong vòng UX (cùng nhóm với N3).

## 9. Follow-up sau A5/A3 (ruling ledger 00:20; P-G1a 16:05/17:00; B1 S5a 17:25)

### Thay đổi

- **503 cấu hình** (`api.ts`, `pending-operation.ts`, `session-boundary.tsx`):
  - Mọi mã `*_NOT_CONFIGURED` (503, hoặc 409 như `INPUT_SERVICES_NOT_CONFIGURED`) giờ là kết quả cuối của lượt gửi: client không auto-retry, không nhả key, không cấp key mới.
  - Operation giữ `ambiguous` và được đánh dấu bằng `PendingStore.configurationError(id)`. Lỗi trả `ApiFailure{status, code: <mã server>, kind: 'configuration', message: <lời server>}`, không còn quy về `UNCONFIRMED`.
  - Panel khôi phục hiện “Lỗi cấu hình máy chủ (mã)”. Lượt gửi chủ động sau đó dùng cùng key và xóa dấu.
  - GET và upload gặp mã cấu hình cũng không retry. 5xx khác giữ hành vi cũ.
- **Header Date**: `OwnerClient.lastServerDate?()` trả giờ server lấy từ header `Date` của response owner gần nhất (GET, mutation hay upload, kể cả response lỗi); header không parse được bị bỏ qua. Method này optional trên interface vì `test/tickets.test.ts` có fake object literal; client thật luôn có (PM đã đồng ý). Composer chưa dùng; việc đó thuộc slice S5a sau.
- **`/v2/events/latest`** (`events.ts`, `contracts/http.ts` thêm `decodeLatestCursor`):
  - Tab chưa có cursor gọi latest trước catch-up, nên không đọc journal từ 0. 401 làm phiên hết hạn; lỗi khác tính vào ngân sách thử lại.
  - Trước khi ghi cursor, client enqueue `['v2']` để refetch mọi query đã GET trước khi biết cursor. Nhờ vậy latest đứng trước data GET mà vẫn không bỏ sót event của khoảng giữa.
  - Tab đã có cursor không gọi latest.
- **`warmUp`** (`compose.spec.ts`): bỏ `waitForTimeout(1500)`. Thay bằng vòng tối đa 5 lượt: import các module ticket trong một trang, chờ `networkidle`, rồi kiểm cờ trên `window` còn nguyên (không bị optimizer reload). Hết 5 lượt mà chưa ổn định thì ném `VITE_WARM_UP_UNSTABLE`.

### File ngoài phạm vi ban đầu (PM đã cho phép, kèm lý do)

- `v2/web/test/app-wiring.test.ts`: fakeApi trả `{cursor:'0'}` cho `/v2/events/latest`. Assertion lấy request `/v2/events*` đầu tiên (latest hoặc catch-up) phải đứng trước GET dữ liệu đầu tiên, và thêm assert rằng sau latest có invalidate `['v2']`. Bất biến listener-trước-GET giữ nguyên.
- `v2/web/e2e/app-router.spec.ts`: hai assert “GET đầu tiên sau login là `/v2/events`” đổi thành regex `^GET /v2/events(/latest)?$`; data GET vẫn phải đứng sau request event-sync đầu tiên.
- `v2/web/e2e/events.spec.ts` (file của Task2): request đầu là `/v2/events/latest`, request thứ hai là catch-up `?after=<cursor>&limit=100`, và có invalidate `['v2']`.
- `v2/web/test/compose-submit.test.ts:589` (Task5): chỉ đổi một dòng, `UNCONFIRMED` → `EXTRACTION_NOT_CONFIGURED`. Dòng đó khóa đúng hành vi cũ mà ruling 00:20 bỏ; mọi assertion khác giữ nguyên.
- Docs: `v2/docs/flows/web-data.md` và `v2/docs/flows/web-attachments.md` (dòng nói 503 giữ `UNCONFIRMED`, và kịch bản PNG). Câu thông báo riêng cho `*_NOT_CONFIGURED` trong `compose/composer.tsx` thuộc Task5; em không sửa.

### Test

- `client.test.ts` +4:
  - 503 `EXTRACTION_NOT_CONFIGURED`: 1 request, không sleep, giữ key, `configurationError`, `begin` cùng intent ném lỗi; gửi lại cùng key → accepted và dấu được xóa.
  - 409 `INPUT_SERVICES_NOT_CONFIGURED` trên operation mới giữ key; 503 `SERVICE_UNAVAILABLE` vẫn retry.
  - GET 503 cấu hình không retry.
  - `lastServerDate`: null trước response đầu, cập nhật cả theo response lỗi, bỏ qua header hỏng.
- `events.test.ts` +2:
  - Tab mới: latest → catch-up từ cursor > MAX_SAFE → stream với Last-Event-ID, cursor được ghi, invalidate `['v2']`.
  - latest 401 → expire; tab có cursor thì không gọi latest.
- E2E `compose.spec.ts` (kịch bản PNG): đúng 1 POST submit, và response HTTP là `{status: 503, code: 'EXTRACTION_NOT_CONFIGURED'}` (bắt qua `page.on('response')`).

Ghi chú về test `lastServerDate`: bản đầu dùng giá trị header không phải ASCII (“không phải ngày”). `Headers` từ chối giá trị đó ngay khi tạo response, nên GREEN đầu báo `NETWORK_UNAVAILABLE`. Em đã đổi sang `not-a-date`. Trong RED, test này đã đỏ trước dòng đó với lỗi thật (`lastServerDate` chưa có).

| Lệnh (heap 384 MiB, watchdog; slot chỉ lấy khi `heavyEligible`, chain bằng `&&`) | Kết quả | Log, SHA-256 |
|---|---|---|
| RED `node --test test/client.test.ts test/events.test.ts test/app-wiring.test.ts` | exit 1, tests 40, fail 6, đều do assertion hành vi | `task-2-followup-red-unit.log` `e1c49eebe8231bc97d5f3638c5e544638fe3f223d9836f8ead970635f950dad1` |
| RED E2E `playwright test e2e/compose.spec.ts --grep EXTRACTION_NOT_CONFIGURED` | exit 1: `expect.poll` số response submit `Expected: 1, Received: 4` | `task-2-followup-red-e2e.log` `7648d16ec8cf2a3350f2ef398fff6177321667ec50bbbce18533730e1d332ca4` |
| GREEN cùng lệnh unit | exit 0, 40/40 | `task-2-followup-green-unit.log` `3bdd2f44b88f68b8880f819872f12d32098b8d988ccf6531d3436d5ae1de2874` |
| `tsc --noEmit` | exit 0 | `task-2-followup-typecheck.log` `551ba5b17d54b7f7c4a98ec980c96250a33747006b9e36c69cbcf984ff5d489f` |
| `biome check` 20 file (lib/contracts/auth, test, e2e liên quan) và `compose-submit.test.ts` | exit 0, không diagnostic | `task-2-followup-biome.log` `1438c850a9c553f5abf144efff03d362bf6cb0f09d14f84f54052162c9381bb8` |
| `node --test test/*.test.ts` (sau khi sửa dòng 589) | exit 0, 232/232 | `task-2-followup-unit-full.log` `078b05a535cb1c0fca02eee5ed95922c38e258161b8822f86580b322297cafab` |
| E2E `compose.spec.ts auth.spec.ts events.spec.ts app-router.spec.ts` | exit 0, 10 passed (45,1 giây); kịch bản PNG GREEN với 1 POST/HTTP 503 | `task-2-followup-e2e.log` `1b829b60bfbd1fd020e0d1999dd888e52d3f899b11bc27d15aea85a97a1f1930` |

Lần chạy toàn unit đầu (trước khi sửa dòng 589) cho 231/232, và test đỏ duy nhất là dòng đó; log đã bị ghi đè bởi lượt sau.

Telemetry khi lấy slot (GiB khả dụng / pressure / CPU idle % / đĩa GiB): RED 4,6/1/83,5/748,1; GREEN và E2E 5,126/1/85,22/748,1. Slot đã trả; `ls` xác nhận lock không còn. Scratch riêng `$TMPDIR/crew-v2-web-task2/` chứa runner, slot script và file tạm.

Cleanup: danh sách `docker ps -a` trước và sau mỗi lượt E2E trùng nhau. Trong TMPDIR chỉ còn scratch của các worker khác (`crew-v2-web-controller`, `-s3b`, `-s5a`) và scratch của em; không còn scratch fixture. Kiểm import tương đối của mọi file đã đổi: không có import tới file untracked.

Hash source: `api.ts` `ee5229311eee30fce55b529ed3ca6eec46d42ff9200b7e272d5dd9016283fa2c`, `events.ts` `61ee548f79c9496bf82b9a87c699bc2ad526a54fd6a3018a2ec0ef197b70697f`, `pending-operation.ts` `7ba8184f1ed16c9c1678683651bdd4af2e4ecdda5468041b237d8721321793d6`, `contracts/http.ts` `e54307418e523fb3a3e86718bfa6f524dda7807d15757f4de79bcbdba648aa3f`, `session-boundary.tsx` `5fa8c86354c707a6c8d2abda16f65503f00059aebc410be2d2218186b2141021`.

### Còn lại

- `configurationError` chỉ sống trong memory của tab; sau reload, operation hiện lại là “Chưa xác nhận” cho tới lần gửi kế tiếp. Lưu mã này vào record của tab thì phải đổi schema version, nên để sau.
- Composer chưa có câu riêng cho mã cấu hình (Task5, đã vào ledger) và chưa dùng `lastServerDate` (S5a).
- E2E PNG mới chạy GREEN một lượt trong lần chạy đầy đủ, chưa chạy lặp.
