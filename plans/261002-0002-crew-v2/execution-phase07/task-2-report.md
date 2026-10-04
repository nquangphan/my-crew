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
