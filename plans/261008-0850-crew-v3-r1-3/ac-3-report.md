# AC-3 R1-3 — nghiệm thu máy thật

**Status: BLOCKED.** Cập nhật 2026-10-08 15:41:50 +0700, mọi giờ hiển thị bên dưới là Asia/Ho_Chi_Minh (+07); JSON DB giữ UTC (`+00:00`).

**Summary: 16/30 tiêu chí ĐẠT (15 kiểm trực tiếp + 1 kế thừa ledger), 14/30 KHÔNG ĐẠT vì chưa thể chạy/hoàn tất; 2 mục không áp dụng.** Đây không phải nghiệm thu đạt. Ca 4a dừng trước provider, 4b/4c chưa chạy. Không kết luận các hành vi chưa chạy là lỗi code.

**Blocker môi trường:** cả 5 environment SSH trả nguyên văn `{"error":"Secret not found"}`. DB cho thấy cả 5 có `privateKeySecretRef`, không có inline key, và không có bản ghi secret được tham chiếu trong `company_secrets` (kể cả ngoài company). Trái với ghi chú EN-1 cho rằng còn inline key. Lỗi này chặn mọi agent trong chuỗi, không phải chỉ tải cao. Dừng theo lệnh owner, không sửa credential/cấu hình, không dựng lại hoặc deploy. Lead cần sửa tham chiếu SSH secret đúng company/binding, probe lại rồi chạy nghiệm thu mới.

## Phạm vi và nguồn bằng chứng

Mac mini thật → server spike `/opt/crew-v3-spike`, company `5befeb1a-1578-4656-b913-267494592e53`; image đang chạy `crew-v3/paperclip:v3-2773ba1a3`. API health và local HEAD cùng SHA `2773ba1a3b03d7ae42e2dd8d0c6647f967ecc9ad`.

Đã đọc plan (AC-3/Interface), ledger O12–O19/rulings/EN-1, whole-branch review, PO-3 report, spike-session (kết luận GO mới nhất), handover 4/7, 4 file instructions agent. Không áp kết luận lịch sử BLOCKED của SP-1 thay kết luận GO. User phiên này ưu tiên: không deploy/build lại môi trường, không sửa code, không trả ngưỡng 16.

Bằng chứng DB/API đã loại credential: [ac-3-evidence.json](reports/ac-3-evidence.json). Không lưu/in plaintext API key, cookie, private key hoặc `.env` vào báo cáo. File JSON gồm guard errors nguyên văn, snapshots, wake/activity/lease và final state. Backup trước mutation: `/opt/crew-v3-spike/backups/ac3-20261008-1523-before.dump` (pg_dump custom, file không rỗng).

## Từng tiêu chí

| Mục | Tiêu chí | Kết quả | Bằng chứng/giới hạn |
|---|---|---|---|
| P0 | Doctor không lỗi TCC | ĐẠT | Doctor exit 0; Claude probe ok; load 28.09/10 CPU, RAM trống 34%. |
| 1a | Server typecheck, verify.sh, agent tests | ĐẠT — kế thừa | Ledger ghi đúng HEAD: server 330/330, adapter 14/14, agents 58/58, tsc xanh; lượt này không chạy lại/build/deploy. |
| 1b | Artifact/image/health/plugin | ĐẠT | API commit 2773ba1a3b03d7ae42e2dd8d0c6647f967ecc9ad; plugin healthy; 3 module có trong container đang chạy. |
| 1c | Ngân sách hook | ĐẠT | check-core-hooks: 5/5; 9 mục; lỗi 0. |
| 1d | Agent/model/concurrency/environment riêng | ĐẠT | 5 agent đúng wrapper/model; mỗi agent maxConcurrentRuns=1, environment riêng. Kết nối SSH chưa đạt, xem blocker. |
| 2a.1 | Agent POST children extraArgs/command/env/useProjectWorkspace | ĐẠT | 4 request HTTP 422 crew_override_forbidden; không tạo con. |
| 2a.2 | Agent POST children model ngoài bảng | ĐẠT | HTTP 422 crew_override_forbidden; chỉ gửi literal để bị từ chối, không invoke model đó. |
| 2a.3 | Agent POST children opus/high hợp lệ | ĐẠT | HTTP 201 CRE-33; DB overrides đúng model/effort. Con backlog không assignee, không chạy provider. |
| 2a.4 | Agent PATCH child useProjectWorkspace | ĐẠT | HTTP 422; DB overrides và updated_at giữ nguyên. |
| 2a.5 | Board PATCH extraArgs được phép | ĐẠT | API trả issue CRE-33 đã sửa; DB lưu extraArgs=[]. Shim không in HTTP riêng, xác nhận bằng body+DB. |
| 2b.1 | Board root code 4 stage | ĐẠT | CRE-31/CRE-32: reviewer → integrator → owner → integrator; DB 4 stage. |
| 2b.2 | Board root research 2 stage | KHÔNG ĐẠT — chưa chạy | Dừng vì blocker toàn bộ đường chạy thật; không tạo 4c. |
| 2c.1 | Trợ Lý tự PATCH command/extraArgs/env/model | ĐẠT | 4 request bằng key agent thật và ID run thật queued: 422 crew_agent_config_forbidden; DB hash/updated_at không đổi. |
| 2c.2 | Executor tự PATCH trên run executor thật | KHÔNG ĐẠT — chưa chạy | Không tạo được run executor chạy thật. Không giả run hoặc dùng run của Trợ Lý làm run executor. |
| 2c.3 | Agent desiredSkills qua skills/sync | KHÔNG ĐẠT — chưa chạy | Chưa gửi request trước điểm dừng; rủi ro H5 ở ledger chưa được nghiệm thu runtime. |
| 4a.1 | Hỏi owner, blocked, chưa có con; owner trả lời đánh thức | KHÔNG ĐẠT — bị chặn | CRE-31 có 0 con; đó là do run chưa start, không phải bằng chứng agent hỏi đúng. |
| 4a.2 | crew-plan ghi trước POST con, payload/idempotency đầy đủ | KHÔNG ĐẠT — bị chặn | Không có lượt model Trợ Lý. |
| 4a.3 | Ít nhất 3 con, 2 gói, cùng gói cùng executor, model đúng bảng | KHÔNG ĐẠT — bị chặn | CRE-33 là fixture API tạo tay, không tính là con do Trợ Lý lập kế hoạch. |
| 4a.4 | Hai executor chồng thời gian | KHÔNG ĐẠT — bị chặn | Không có started_at của provider run. |
| 4a.5 | Resume session, params remoteExecution, adapter.invoke --resume, activity đúng 1 lần | KHÔNG ĐẠT — bị chặn | session_id_before/after đều null, chưa tới claim/adapter. |
| 4a.6 | crew-stack đúng nền/blocker/approval, review đúng diff | KHÔNG ĐẠT — bị chặn | Không có commit executor/reviewer trong lượt này. |
| 4a.7 | 4 stage, owner approve, done, push thật origin/main | KHÔNG ĐẠT — bị chặn | Không chuyển stage; không owner approve hay push. Origin main đọc cuối: 21734793c9a3f0af10f1f151b0ac39f7624cbaed. |
| 4b | Bug: seed, systematic-debugging, RED/GREEN, 4 stage + push | KHÔNG ĐẠT — chưa chạy | Không seed lỗi vì đã xác nhận blocker môi trường chung; không tạo issue 4b. |
| 4c | Research: report/review/owner/done, không commit/integrator/docs/push/override | KHÔNG ĐẠT — chưa chạy | Không tạo issue 4c sau điểm dừng. |
| 4.chung.1 | File owner còn nguyên | ĐẠT | owner-wip.txt SHA-256 trước/sau trùng; git status chỉ ?? owner-wip.txt. |
| 4.chung.2 | Không process Claude mồ côi do lượt nghiệm thu | ĐẠT | 2 run đều started_at=null, 0 lease; ps chỉ thấy các Claude cũ nhiều giờ/ngày, không giết process của owner. Doctor probe đã kết thúc. |
| 4.chung.3 | Run bị gate giữ có activity crew.load_gate.* | ĐẠT | Cả 2 run có waiting + waiting_comment, reason unreachable. Chưa kiểm happy path gate load/release. |
| 4.chung.4 | Chuỗi wake/skip/lease release/run mới mỗi stage | KHÔNG ĐẠT — bị chặn | Đã lưu timeline thực có; không stage transition, không lease, không thể chứng minh handoff. |
| 5a | crew-docs check merged commit 4a/4b | KHÔNG ĐẠT — chưa chạy | Không có merged commit/integrator run, không tự tạo bằng chứng thay agent. |
| Dọn | Issue cancelled, 0 active run, key thu hồi, môi trường ghi processes | ĐẠT | CRE-31/32/33 cancelled; 2 run cancelled; 0 active trong Crew Spike; key tạm đã revoke. |

- **Cổng 3: KHÔNG ÁP DỤNG** theo plan R1-3; không browser/Playwright. User cho phép owner thao tác qua API; chưa tới interaction/approval.
- **Cổng 5, repo Crew: KHÔNG ÁP DỤNG** vì không đổi nguồn Crew; chỉ ghi tài liệu nghiệm thu/processes/ledger. Không chạy `crew-docs check --range` giả cho phần code không đổi.
- Cổng 1 dùng kết quả verify/typecheck/agent tests đã ghi trên đúng HEAD trong ledger; không có rerun của phiên này. Không chạy repo-wide typecheck/test/build vì không đổi code và dừng ở môi trường.

## Issue, run và actor

| Vai trò | Issue | UUID | Actor tạo | Cuối lượt |
|---|---|---|---|---|
| Ca 4a | CRE-31 | 1a98a65c-20a5-4f64-9375-5290850e9623 | board Mtye1JcS4JUc3lTZj51hI7nfz1pqMPSI | cancelled, 0 con |
| Fixture Cổng 2 | CRE-32 | a54e84c0-9c25-4ad3-a891-820d23e67699 | board trên, backlog giao Trợ Lý | cancelled |
| Con hợp lệ Cổng 2 | CRE-33 | da8045ef-8f07-4db8-9f3b-558df168f085 | key Trợ Lý, POST do người nghiệm thu thực hiện | cancelled, backlog/unassigned trước dọn |

Trợ Lý `6c27410e-7a14-4439-9e07-cbbfa2a743fd` dùng key tạm thật do board tạo. Request agent có header `X-Paperclip-Run-Id: c8466e3d-afb2-4462-bd98-9a5c6142e23d`, là run được server tạo thật cho CRE-31, nhưng **đang queued, chưa chạy provider**. Không khẳng định đây là request do Claude tự phát ra. Key ID `2fef0b04-e9d9-400a-9c1b-fdd31abe13a8` đã DELETE/revoke, response `{"ok":true}`; file plaintext tạm đã xóa.

Prompt 4a chủ động yêu cầu hỏi ngôn ngữ, chia hỗ trợ ngôn ngữ/fallback thành hai bước review nối tiếp và README thành gói riêng để tạo điều kiện đo đủ ba con. Đây là điều kiện test do người nghiệm thu thêm, chưa chứng minh Trợ Lý tự chọn cách chia đó. Không có câu trả lời owner/approval nào được giả lập vì chưa tới bước đó.

Mọi kết quả API Cổng 2 đạt đều là **thao tác tay của người nghiệm thu** bằng board hoặc key agent; không ghi nhận là end-to-end tự động. CRE-33 không nằm trong kế hoạch 4a và không chạy Opus. Model bị cấm chỉ xuất hiện dưới dạng input bị từ chối, không có provider invocation.

## Lệnh đã chạy

```sh
/opt/homebrew/bin/node ~/.crew/app/crew-mac/dist/cli.js doctor
node crew/release/check-core-hooks.mjs
git rev-parse HEAD
shasum -a 256 ~/crew-spike/repo-a/owner-wip.txt
git -C ~/crew-spike/repo-a status --porcelain=v1
git -C ~/crew-spike/repo-a-origin.git rev-parse main
ssh nhamoiplatform 'sh /opt/crew-v3-spike/ops/active-runs.sh'
```

Board dùng shim đã chỉ định, `METHOD PATH [JSON]`; PATH tự thêm `/api`. Agent dùng Python urllib chạy qua SSH tới cùng endpoint `http://100.105.105.12:3100/api`, key truyền stdin, không nằm trong command line/output; thu cả HTTP status và body. Lần kết nối đầu nhầm `127.0.0.1:3100` không tới endpoint (spike bind Tailscale), đã đổi đúng endpoint; không có mutation từ lần lỗi transport đó.

```text
GET /health
GET /plugins/crew.core/health
POST /companies/<company>/issues                      # CRE-31 todo; CRE-32 backlog
POST /agents/<tro-ly>/keys                            # key tạm, không in token
PATCH /agents/<tro-ly> {"adapterConfig":{"command":"/usr/bin/false"}}
PATCH /agents/<tro-ly> {"adapterConfig":{"extraArgs":[]}}
PATCH /agents/<tro-ly> {"adapterConfig":{"env":{}}}
PATCH /agents/<tro-ly> {"adapterConfig":{"model":"claude-sonnet-5"}}
POST /issues/<CRE-32>/children                        # 5 forbidden + 1 allowed
PATCH /issues/<CRE-33> {"assigneeAdapterOverrides":{"useProjectWorkspace":true}}
PATCH /issues/<CRE-33> {"assigneeAdapterOverrides":{"adapterConfig":{"extraArgs":[]}}} # board
POST /environments/<mỗi environment>/probe?companyId=<company> {}
PATCH /issues/<CRE-31|CRE-32|CRE-33> {"status":"cancelled"}
POST /heartbeat-runs/<mỗi run>/cancel {}
DELETE /agents/<tro-ly>/keys/<key tạm>
```

POST child gồm `title`, `description`, `acceptanceCriteria`, `blockParentUntilDone:false`, `idempotencyKey:ac3-api-<case>`, và override từng ca. Không assignee nên con hợp lệ không chạy. Payload model hợp lệ `{"adapterConfig":{"model":"claude-opus-5","effort":"high"}}`; forbidden gồm `extraArgs:[]`, `command:/usr/bin/false`, `env:{}`, `useProjectWorkspace:true` hoặc model literal ngoài bảng.

DB đọc qua `ssh nhamoiplatform 'cd /opt/crew-v3-spike && docker compose exec -T db psql -v ON_ERROR_STOP=1 -U paperclip -d paperclip -Atc "…"'`. Truy vấn chỉ trả projection an toàn; không dump config chứa key. Hash cấu hình agent và `updated_at` trước/sau nằm trong evidence. POST bị từ chối không tạo child: CRE-32 có đúng 1 con CRE-33 (ca allowed).

Query xác minh blocker (không trả giá trị secret/ref):

```sql
SELECT e.name,
       coalesce(length(e.config->>'privateKey'),0)>0 AS has_inline_key,
       e.config->'privateKeySecretRef' IS NOT NULL
         AND e.config->'privateKeySecretRef'<>'null'::jsonb AS has_ref,
       EXISTS (SELECT 1 FROM company_secrets s
               WHERE s.id::text=e.config->'privateKeySecretRef'->>'secretId') AS ref_exists
FROM environments e
WHERE e.id IN (SELECT default_environment_id FROM agents
               WHERE company_id='5befeb1a-1578-4656-b913-267494592e53');
```

Kết quả cả 5: `has_inline_key=false`, `has_ref=true`, `ref_exists=false`. Probe API trả `Secret not found` cả 5. Không suy đoán key bị mất ở deploy hay do thao tác nào trước phiên này.

## Nguyên văn lỗi và số liệu DB

```json
{"error":"Crew: agent không được sửa cấu hình thực thi đã ghim của agent.","code":"crew_agent_config_forbidden","details":{"code":"crew_agent_config_forbidden","keys":["adapterConfig.command"]}}
{"error":"Crew: agent chỉ được đặt model và effort trong assigneeAdapterOverrides.","code":"crew_override_forbidden","details":{"code":"crew_override_forbidden","violations":["adapterConfig.extraArgs"]}}
{"error":"Secret not found"}
```

H5 keys lần lượt `adapterConfig.command`, `.extraArgs`, `.env`, `.model`, cả bốn HTTP 422. H4 violations lần lượt `adapterConfig.extraArgs`, `adapterConfig.model:claude-fable-5`, `adapterConfig.command`, `adapterConfig.env`, `useProjectWorkspace`, cả năm HTTP 422. H2 PATCH child violation `useProjectWorkspace`, HTTP 422. Toàn bộ response chính xác từng ca nằm trong evidence.

- CRE-33 allowed DB: `{"adapterConfig":{"model":"claude-opus-5","effort":"high"}}`; `updated_at=2026-10-08T08:26:47.366961+00:00`. PATCH agent bị từ chối giữ nguyên cả hai. Board PATCH sau đó ghi `{"adapterConfig":{"extraArgs":[]}}`, updated `08:27:18.617+00:00`.
- 2 heartbeat run đã tạo; cả 2 `started_at=null`, `session_id_before=null`, `session_id_after=null`, cuối `cancelled`; **0 environment_leases** cho 2 run. Không có wake stage/skip/release hay resume để đo.
- Cuối lượt company Crew Spike: **0 queued/running**. 3 issue do phiên này tạo đều cancelled. Không xóa issue cũ/agent/environment.
- `owner-wip.txt` trước/sau SHA-256: `df2eb96d9f84ab66c8140324b7e9f4700f6404c82fe5499771f64f1941d598b7`.

## Timeline wake, gate và dọn

| Giờ +07 | Issue/run | Sự kiện thực đo |
|---|---|---|
| 15:24:15.036426 | CRE-31 | board tạo issue |
| 15:24:15.060887 | c8466e3d-afb2-4462-bd98-9a5c6142e23d | wake issue_assigned, request 79e895cb-8a18-4bb5-bd2b-71df11ca41b0, queued |
| 15:24:15.152927 | run trên | crew.load_gate.waiting: unreachable, `không kết nối được (Secret not found)`, deadline 16:24:15.148 |
| 15:24:15.172821 | run trên | waiting_comment |
| 15:26:42.563636 | CRE-32 | fixture board backlog |
| 15:26:47.395778 | CRE-33 | child_created từ request agent thử, không assignee |
| 15:27:19.932948 | CRE-33 | board cancelled |
| 15:27:20.561105 | CRE-32 | board cancelled |
| 15:27:20.589469 | 8b210616-f9ab-4013-9f05-b0008d6efc06 | stock vẫn enqueue wake issue_status_changed, request 46c9e660-64c7-43bf-af67-137ee5338b69 |
| 15:27:20.677030 | run trên | waiting unreachable/Secret not found, deadline 16:27:20.673 |
| 15:29:04.194613 | CRE-31 | board cancelled, ghi blocker |
| 15:29:05.201000 | c8466e3d… | cancel run xác nhận; finished_at, never started |
| 15:29:05.600000 | 8b210616… | cancel run xác nhận; finished_at, never started |

Không có stage transition nên không ghi timestamp wake/skip/release/run giả. Việc `PATCH cancelled` CRE-32 vẫn sinh queued wake khiến phải gọi cancel run riêng; ghi nhận hành vi stock khi dọn, chưa quy là regression R1-3. Poll DB trong quá trình kiểm API/đọc nguồn, không chờ vô hạn. Dừng sớm hơn 30 phút vì đã chứng minh blocker cấu hình chung, không có điều kiện nào tự phục hồi nếu chỉ chờ tải giảm.

## Concerns — vị trí code và giới hạn kết luận

**Chưa chứng minh lỗi code mới của fork/Crew.** Blocker là dữ liệu môi trường thiếu secret. Đường phát hiện:

- `server/src/crew/load-gate.ts` — `defaultBeforeClaimDeps().probeHost`: gọi resolver và đổi exception thành probe thất bại `unreachable`; activity khớp đường này.
- `server/src/services/environment-config.ts:651` — `resolveEnvironmentDriverConfigForRuntime`: nhánh SSH ưu tiên resolve `privateKeySecretRef` tại dòng 672–691.
- `server/src/services/secrets.ts:1353` — `resolveSecretValueInternal`: dòng 1362 ném `Secret not found` khi không có record; DB chứng minh đúng tiền đề.

Không sửa các file này. Không xem TCC doctor xanh là bằng chứng credential VPS đúng: doctor kiểm SSH cục bộ bằng cấu hình Mac, còn server dùng secret ref trong DB.

Các kiểm thêm của whole-branch review **chưa chạy**, không đánh dấu pass từ unit test: route tạo con/decomposition ngoài `/children`; self/peer replacement/rollback và skills/sync; label/marker downgrade; resume đối chứng hai wake/khác parent/agent/company/adapter; approval giả/stale/stack sai; interruption/mất response/idempotency; reviewer/owner request changes; pending interaction/wake khác/cancel con; tải release/retry/handoff; bug/docs/full push. Cần chạy lại sau khi lead sửa môi trường, không kết luận AC-3 đạt từ các guard API hiện có.

## Dọn và thay đổi môi trường

Chi tiết ở [processes.md](processes.md). Không chỉnh source, worktree agent, policy, tải, model agent hay deploy. Backup DB, 3 issue, 2 queued run, 1 key tạm và các bản ghi audit/API là thay đổi do phiên này. Board đã cancel issue/run, revoke key. Không có process nền do phiên này cần giữ. Ngưỡng tải **giữ 16**, lead trả sau theo lệnh owner.

Report và evidence được đính kèm vào CRE-31 bằng board, không đặt `PAPERCLIP_RUN_ID` trong shell; đường tải và work product được lưu ở receipt cạnh report. Nếu upload lỗi thì receipt/báo cáo cuối sẽ nói rõ, không coi local path là đã upload.


# AC-3 lần 2

Bắt đầu 08/10/2026 15:51 Asia/Ho_Chi_Minh. Lead đã khôi phục SSH secret/version/binding; runner xác nhận 5/5 probe ok:true. Luật bổ sung: **không xóa bất kỳ environment nào**. Doctor exec 38807, PID 98688: rc 0, 16/16 đạt, TCC không có trong 24h, Claude probe ok; load 11.89/10 CPU, RAM trống 35%. Backup trước mutation: `/opt/crew-v3-spike/backups/ac3-r2-20261008-1552-before.dump`.

Ca 4a mới: CRE-34 `d1a5427c-37d3-4341-89fc-6335ddbbe35c`, board tạo 15:52:43.246 +07, giao Trợ Lý; run `057f6eca-a5ea-4f0f-bdb9-2b2c5b14ad33` running từ 15:52:43.754 +07. Đang nghiệm thu, chưa kết luận. Không dùng lại CRE-31/32/33.

## Kết luận lần 2 — 2026-10-08 16:08:14 +0700

**Status: BLOCKED — lỗi code/hợp đồng route trên bridge SSH.** Trong 14 tiêu chí còn thiếu được yêu cầu: **4 ĐẠT, 10 KHÔNG ĐẠT** (1 thất bại thực đo ở bước tạo con, 9 bị chặn/chưa đo đủ). Lũy kế checklist 30 tiêu chí ở lần 1: **20 ĐẠT / 10 KHÔNG ĐẠT**, vẫn 2 mục N/A; trong 20 đạt có 1 kế thừa kiểm build/test trên đúng SHA. Không coi AC-3 hoàn tất.

Đã chạy lại preflight và dùng issue mới. Không xóa environment, sửa source, deploy, đổi crew-policy, hoặc trả ngưỡng tải 16. Không sửa secret vừa được lead phục hồi. Lần 1 phía trên được giữ nguyên.

### Tiêu chí còn thiếu

| Mục | Kết quả lần 2 | Bằng chứng |
|---|---|---|
| 2b.2 | ĐẠT | CRE-35 board-created root có nhãn research lúc tạo; DB đúng 2 stage reviewer → owner. |
| 2c.2 | KHÔNG ĐẠT — chưa chạy | Không có con/run executor vì /children bị bridge từ chối. Không dùng run Trợ Lý giả làm run executor. |
| 2c.3 | ĐẠT — đã ghi hành vi | Key Trợ Lý + run đang running: skills/sync add first-task HTTP 200, DB đổi desiredSkills; 4 trường ghim hash không đổi. Board đã remove skill thử. |
| 4a.1 | ĐẠT | Interaction pending + root blocked + 0 con. Owner board trả lời vi/en; wake issue_commented tạo run mới, không hỏi lại. |
| 4a.2 | ĐẠT | crew-plan 62c4bed1… lúc 15:58:39.294, đầy đủ 3 payload/key/marker/blocker, ghi thành công trước POST con đầu bị 403. |
| 4a.3 | KHÔNG ĐẠT — lỗi tái hiện | Kế hoạch đúng 3 con/2 gói/2 executor/Sonnet nhưng không materialize được child; không có DB override con để đo. |
| 4a.4 | KHÔNG ĐẠT — bị chặn | Không có run hai executor; chưa đo overlap. |
| 4a.5 | KHÔNG ĐẠT — bị chặn | Chưa đo resume giữa hai con. Resume giữa hai run cùng root được thấy, không thay thế tiêu chí bundle. |
| 4a.6 | KHÔNG ĐẠT — bị chặn | crew-stack chỉ có trong kế hoạch, chưa có con/commit/base/review thật. |
| 4a.7 | KHÔNG ĐẠT — bị chặn | Chưa tới reviewer/integrator/owner approval/push; origin main không đổi. |
| 4b | KHÔNG ĐẠT — chưa chạy | Không seed bug/tạo root bug sau khi xác định blocker chung; không đổi repo thử. |
| 4c | KHÔNG ĐẠT — chưa chạy end-to-end | CRE-35 chỉ kiểm template API, backlog rồi cancelled; không có báo cáo/reviewer/owner/done tự động. |
| 4.chung.4 | KHÔNG ĐẠT — chưa đủ | Ghi được wake/lease/release của interaction và cancellation; chưa có stage transition/skip/replay reviewer-integrator để chứng minh. |
| 5a | KHÔNG ĐẠT — chưa chạy | Chưa có merged commit hoặc integrator run; không có crew-docs-check bằng chứng thật. |

Các guard Cổng 2 đã đạt ở lần 1 không được chạy lại bằng executor giả. H5 self-PATCH trên executor thật vẫn chưa nghiệm thu. Cổng 3 không áp dụng; chưa có thao tác UI. Cổng 5 repo Crew không áp dụng vì không đổi nguồn. Không rerun toàn bộ unit/typecheck/build: đây là nghiệm thu live, dừng trước executor, không có code diff.

### Finding F-AC3-2-1 — blocker: thiếu route tạo child ở callback bridge

**File + symbol:** `packages/adapter-utils/src/sandbox-callback-bridge.ts:124` — `DEFAULT_SANDBOX_CALLBACK_BRIDGE_ROUTE_ALLOWLIST`; `:433` — `authorizeSandboxCallbackBridgeRequestWithRoutes`. Producer không tương thích: `crew/agents/assistant.md` mục **Tạo issue con** hướng dẫn `POST /api/issues/<id gốc>/children`.

Agent SSH gọi đúng `/api/`, key/run do runtime cấp, root đã checkout đúng run. GET issue/comments/interactions/OpenAPI và POST comment hoạt động. POST child từ chối ở bridge trước handler `/children`; UUID và identifier đều bị. Nguyên văn trong transcript run `391614ad-78be-4684-9d0c-cd5f4b26c1f3`:

```text
HTTP 403
{"error":"Route not allowed: POST /api/issues/d1a5427c-37d3-4341-89fc-6335ddbbe35c/children"}
```

Allowlist có `POST /api/companies/[^/]+/issues` nhưng **không có** `/api/issues/[^/]+/children`. Hàm authorize trả đúng chuỗi lỗi đã đo khi không rule nào khớp. OpenAPI công bố `/children`; test API gọi thẳng server ở lần 1 đã HTTP 201/422 nên không phát hiện khác biệt này. Đây là lỗi tích hợp instructions ↔ transport cho agent SSH; không phải H4 từ chối override, thiếu `/api`, quota hay SSH credential.

Cả 4a/4b/4c đều bắt đầu bằng Trợ Lý tách việc qua cùng endpoint theo instructions. Theo luật owner “lỗi chặn mọi ca → dừng, BLOCKED”, người nghiệm thu hủy run đang chẩn đoán sau khi đủ bằng chứng; không đợi đủ 30 phút cho lỗi route xác định. Không thay instructions, allowlist, adapter, credential hay tự tạo hộ child của 4a. Route company/issues tồn tại trong allowlist là dữ kiện cho lead chọn cách sửa hợp đồng; chưa được dùng làm workaround trong lượt này. Cần lead sửa/duyệt ở đúng phạm vi rồi nghiệm thu tiếp bằng run SSH thật.

Hai lệnh chẩn đoán thêm thử import module trực tiếp trong container không chạy được vì layout runtime không có file dist ở đường đoán và không resolve `tsx` từ `/app`; không dùng chúng làm bằng chứng pass/fail sản phẩm. Kết luận dựa transcript live + source đúng commit, không dựa kết quả import đó.

### Ca 4a — actor, kế hoạch, session

- Root **CRE-34** `d1a5427c-37d3-4341-89fc-6335ddbbe35c`, board `Mtye1JcS4JUc3lTZj51hI7nfz1pqMPSI`, tạo `15:52:43.246 +07`; assignee Trợ Lý `6c27410e-7a14-4439-9e07-cbbfa2a743fd`, Opus.
- Interaction **7bac12cd-dedb-402a-aeb7-3885d973559f**, `ask_user_questions`, `human_only`, `wake_assignee`, tạo bởi Trợ Lý lúc `15:54:39.188`. Trước trả lời: root `blocked`, SQL `count(children)=0`.
- Board trả lời lúc **15:55:25.758**: q1=`vi_en`, q2=`fallback_vi`, q3=`positional`. Không thêm comment riêng để tạo wake giả. Runtime sinh wake `issue_commented` lúc `15:55:25.831342` từ câu trả lời interaction.
- Run đầu **057f6eca-a5ea-4f0f-bdb9-2b2c5b14ad33**: `15:52:43.754 → 15:55:20.188`, succeeded, `session_id_before=null`, `session_id_after=47c937c6-c268-4b19-8efc-d86fc4ce79b2`.
- Run sau **391614ad-78be-4684-9d0c-cd5f4b26c1f3**: start `15:55:27.645`, before session = session trên; argv `adapter.invoke` có `--resume` session đó. Run bị người nghiệm thu cancel lúc `16:02:36.582`, after=null. Đây là resume **cùng issue gốc**, không chứng minh `resumeFromRunId` giữa con cùng gói.
- Kế hoạch comment **62c4bed1-3e31-49e5-94ef-3ff7ce555b48**, tạo `15:58:39.294`, 10.798 ký tự, bắt đầu `crew-plan root=CRE-34 children=3 bundles=2`, revision v1. Gồm đầy đủ JSON payload/acceptance criteria/idempotencyKey và mapping blocker placeholder sang ID khi tạo.
- Kế hoạch: greet-1 và greet-2 cùng executor `c452d003-6a7c-4820-9c7a-91d5f762d734`, Sonnet/medium, gói greet seq 1/2, con 2 stack/blocker con 1; readme-1 executor `37a9e834-6aaf-4970-8f89-95dbc8a019f2`, Sonnet/low, gói readme seq 1. Đúng bảng ở mức **kế hoạch**, chưa có record child/override hay run executor thật.
- `count(children)=0` tới lúc dừng. Không có `crew.bundle_resume`, `crew-stack-base`, `crew-commit`, reviewer approval hoặc integrator push cho ca này.

Điểm can thiệp tay: prompt gốc chủ động yêu cầu hỏi ngôn ngữ, hai bước review nối tiếp phần hàm và một gói README độc lập (giống setup lần 1); người nghiệm thu trả lời interaction bằng board theo brief. Trợ Lý tự viết kế hoạch và tự phát POST bị từ chối. Người nghiệm thu không thay agent viết payload kế hoạch hoặc tạo các con đó.

### Cổng 2c.3 — desiredSkills

Kiểm độc lập bằng key API tạm của chính Trợ Lý và header run thật **đang running** `391614ad-78be-4684-9d0c-cd5f4b26c1f3`. Đây là request người nghiệm thu gọi thẳng server qua SSH, không phải tool call Claude tự phát; vì vậy không coi nó thay cho kiểm H5 self-PATCH executor.

```http
POST /api/agents/6c27410e-7a14-4439-9e07-cbbfa2a743fd/skills/sync
X-Paperclip-Run-Id: 391614ad-78be-4684-9d0c-cd5f4b26c1f3
Content-Type: application/json

{"mode":"add","desiredSkills":["paperclipai/paperclip/first-task"]}
```

**HTTP 200.** Response desiredSkills = `["paperclipai/paperclip/paperclip","paperclipai/paperclip/first-task"]`. DB trước chưa có key skill; sau có `paperclipSkillSync.desiredSkills=["paperclipai/paperclip/first-task"]`. Hash tổ hợp command/extraArgs/env/model trước/sau đều `b353948afaee1d8655e257418c89a773`.

Board ngay sau đó `mode:remove` đúng first-task. Response effective desiredSkills trở lại `["paperclipai/paperclip/paperclip"]`; DB giữ `paperclipSkillSync.desiredSkills=[]` (biểu diễn explicit rỗng thay vì key vắng ban đầu), 4 trường ghim giữ nguyên. Ghi rõ thay đổi cấu trúc này ở processes.md; không replace toàn bộ adapterConfig. Đây là đường sửa skill có thật ngoài H5, phù hợp rủi ro PO-3 đã ghi; không chứng minh bypass Superpowers pin hoặc quyền thực thi skill tùy ý.

### Cổng 2b.2 / 4c — template research

Root mới **CRE-35** `37705669-ab7e-4504-9fe0-8153615d4320`, board tạo với nhãn research `f7efd416-96e2-4285-9075-c3973ff0d39f` ngay trong POST, assignee Trợ Lý, status backlog; không gửi executionPolicy. SQL `jsonb_array_length(execution_policy->'stages')=2`:

1. `review`, stage `701f20c5-3bb7-4616-81f6-2db4a6a79375`, reviewer `946f1a73-4ee0-447e-97b0-58e50bd70000`.
2. `approval`, stage `bb3febf3-c125-4444-9c73-21ddd71beb6c`, owner `Mtye1JcS4JUc3lTZj51hI7nfz1pqMPSI`.

Tạo fixture này chỉ để hoàn tất tiêu chí API độc lập sau khi thấy blocker; cancelled ngay. Không gọi đó là ca research end-to-end đạt. Stock tạo queued wake lúc cancel, rồi tự skip/cancel vì issue terminal, không vào provider. Không có commit/research report/integrator, nhưng sự vắng mặt này không chứng minh workflow research đúng khi chưa chạy.

### Wake/lease/release thực đo (Asia/Ho_Chi_Minh)

| Lúc +07 | Sự kiện |
|---|---|
| 15:52:43.313237 | wake e9f1a3c7… issue_assigned; run 057f6eca… |
| 15:52:43.754 | run đầu running |
| 15:52:45.747 | lease e18c9e62… acquired |
| 15:54:39.188 | interaction được tạo |
| 15:54:46.413 | comment chờ owner + blocked |
| 15:55:20.188 | run đầu succeeded |
| 15:55:20.458077 | crew.remote_stop.started |
| 15:55:20.465 | lease đầu released |
| 15:55:21.438246 | crew.remote_stop: stopped, remaining=0 |
| 15:55:25.758 | board resolve interaction |
| 15:55:25.831342 | wake b7f27ddd… issue_commented |
| 15:55:27.645 | run 391614ad… running, resume cùng root |
| 15:55:29.398 | lease af909b7c… acquired |
| 15:58:39.294 | crew-plan được lưu trước POST con |
| 16:02:36.582 | board cancel run vì blocker |
| 16:02:41.236936 | crew.remote_stop.started |
| 16:02:41.248 | lease thứ hai kết thúc, status expired, released_at có giá trị |
| 16:02:41.377139 | CRE-35 wake issue_status_changed → run 5d7b5a9d… queued |
| 16:02:45.348640 | crew.remote_stop: stopped, matched=1, remaining=0 |
| 16:02:59.818 | CRE-35 wake skipped, run cancelled: issue_terminal_status; started_at=null |

Câu trả lời owner đến sau release lease đầu ~5,3 giây; không có wake `execution_reconciliation_required` hay `crew.handoff_rewake` ở đoạn này. Không có lần chuyển stage reviewer/integrator nên **4.chung.4 chưa đạt**, dù đã thu timeline chính xác phần thực chạy. Recovery/status `blocked` không bị hiểu nhầm là mất executionState; chưa có stage state nào được kích hoạt.

### Bằng chứng và dọn

[JSON bằng chứng lần 2](reports/ac-3-r2-evidence.json) gồm snapshots API/DB, comments kế hoạch, interaction, skills trước/sau/restore, wake, lease, activity, session và argv invoke đã lọc env/prompt. Không đưa cookie/key/token/private key vào deliverable. Các run:

- 057f6eca… succeeded.
- 391614ad… cancelled bởi board.
- 5d7b5a9d-2acc-4736-8164-d666d0e9a17f cancelled bởi terminal gate trước start.

Cuối kiểm: **0 queued/running**, 2 issue mới CRE-34/35 cancelled, 0 active lease của các run này, remote-stop remaining=0. `ps` chỉ còn các Claude cũ của owner nhiều giờ/ngày; không giết chúng. Key tạm ID `8d32b772-b533-4cb0-b226-46d5c3d8e19a` đã DELETE/revoke (`{"ok":true}`) và xóa file plaintext tạm do phiên tạo.

`owner-wip.txt` trước/sau SHA-256 `df2eb96d9f84ab66c8140324b7e9f4700f6404c82fe5499771f64f1941d598b7`. `origin/main` trước/sau `21734793c9a3f0af10f1f151b0ac39f7624cbaed`. Không seed bug, commit, merge hoặc push repo thử trong lần bị chặn này. Fork git status sạch. Ngưỡng tải vẫn **16**; không xóa environment. Không thấy lỗi quota trong hai run đã đo.

Report cập nhật và JSON evidence lần 2 được upload thành attachment/work product mới vào CRE-34; receipt riêng giữ đường tải. Artifact lần 1 trên CRE-31 vẫn giữ nguyên. Các thao tác môi trường đầy đủ ở processes.md.


# AC-3 lần 3

Bắt đầu 08/10/2026 khoảng 16:24 Asia/Ho_Chi_Minh. Instructions `a0aed685a` đã đổi route tạo con sang company/issues + parentId, tiêu chí trong description, không blockParentUntilDone. Server giữ `2773ba1a3`. Runner xác nhận probe 5/5, 0 active run; đang chờ doctor trước tạo issue. Backup `/opt/crew-v3-spike/backups/ac3-r3-20261008-1625-before.dump`. Không xóa environment, không sửa code/deploy/policy/ngưỡng tải16.

Doctor exec23551 rc0: TCC đạt, Claude probe ok, load22.94/10 CPU cảnh báo. Root mới CRE-36 `9707bef4-c5d4-4d62-bf60-369c225d9451`, board tạo 16:26:30.500, run `810519fe-ea0e-4455-b95d-c704b1be9205` queued do overloaded18.51>16; server tự claim lúc16:30:00.433 sau tải giảm. Không thay ngưỡng. Chọn vi/en đã chốt, tập trung các tiêu chí còn thiếu.

### Ghi nhận đang chạy (16:46 +07)

- 2c.2 ĐẠT: key tạm của mac-claude + run thật đang running `4d800afe-4fe9-4352-979c-2e97db9cce32`; PATCH riêng command/extraArgs/env/model đều HTTP422 `crew_agent_config_forbidden`. Hash toàn adapter_config trước/sau `886f3226a055cfb4b5c99ff4e8a676f4`, updated_at giữ `2026-10-08T09:35:14.802Z`. Key đã revoke. Đây là phép thử tay qua API trực tiếp.
- Plan comment `2387ce4d-101a-4b69-ba84-c956419f745d` lúc16:34:23.182; con đầu CRE-37 tạo16:34:41.534651 (sau18.352651s). CRE-37/38 gói greet seq1/2, executor mac-claude-2; CRE-39 gói readme, executor mac-claude; cả ba claude-sonnet-5/medium, marker complexity=small và overrides khớp. Hai run executor chồng16:35:10.815–16:38:59.387 =228.572s.
- CRE-37 commit `b5434925d5a71c8585984ce941dee0e64961ba7a`; CRE-38 commit `2b1c8702c12f574b3d2cbdabdc8eeb4f7bc23ae5`; README commit `92b7a3816699c4832a2b97f4ab0e264d7b403570`. Reviewer cả3 approved; stack-base đúng SHA tiền nhiệm, ancestry rc0, reviewer đọc diff base..tip.
- 4a.5 KHÔNG ĐẠT: run executor CRE-37 `3b8508e9-bc74-4e74-b671-16a085603c97` bị cancel issue_reassigned16:38:59.387, before/after=null; không có agent_task_sessions của executor cho CRE-37. CRE-38 run đầu `8abd92ca-c6cd-4b6a-a502-3f259a6d0c11` start16:39:38.338, resumeFromRunId/resumeSessionParams/before=null, argv không --resume. Reviewer CRE-38 có bundle resume nhưng không tính thay executor.
- Root research mới CRE-40 `8a608794-a339-433b-9b7c-2e85e6c08459`, tạo16:41:09.195 có nhãn research, policy2stage; con CRE-41 `0d1bebb2-4c99-4d3b-a37e-e1e0e9325497`, run `afb94770-1924-4667-9caf-2d4ef216e4c2`, comment crew-report; git HEAD trước/sau executor đều2b1c870, status sạch, reflog không thêm entry.
- Can thiệp tay ngoài owner approval: board gửi CLI hint cho CRE-37/39 lúc16:38:56/57 vì hai agent tìm crew-mac ngoài PATH. Không sửa file/config/PATH. Transcript CRE-37 cho thấy agent cũng tự tìm thấy ~/.crew/bin; không khẳng định comment được đọc trong run đó. Hint đã tạo wake comment, giữ trong evidence.

### Kết quả chốt lần 3

**Status: KHÔNG ĐẠT AC-3.** Lần 3 kiểm đủ 10 tiêu chí còn thiếu: **9 ĐẠT, 1 KHÔNG ĐẠT (4a.5)**. Cộng dồn **29/30 ĐẠT, 1/30 KHÔNG ĐẠT**, 2 mục không áp dụng; Cổng 1 vẫn kế thừa kết quả lead như lần 1, không chạy lại full suite/build trên Mac đang dùng quota chung. Ba root mới đều đã tới done đúng luồng trước cleanup; sau đó cả 8 issue mới được board chuyển cancelled theo brief. Không coi cleanup cancelled là thất bại workflow.

| Tiêu chí còn thiếu | Kết quả | Bằng chứng |
|---|---|---|
| 2c.2 | ĐẠT | Executor thật mac-claude, run4d800afe…; 4 PATCH riêng HTTP422, DB hash/updated_at không đổi, key thu hồi. Request do runner gửi trực tiếp, không phải model tự phát. |
| 4a.3 | ĐẠT | Trợ Lý tự tạo CRE-37/38 gói greet cùng executor2, CRE-39 gói readme executor1; 3 marker/override claude-sonnet-5/medium khớp small. Plan ghi trước con đầu18.352651s. |
| 4a.4 | ĐẠT | Hai executor chồng16:35:10.815–16:38:59.387 =228.572 giây; argv thực Sonnet/medium. |
| 4a.5 | KHÔNG ĐẠT | Executor tiền nhiệm bị cancel issue_reassigned, không lưu session; con2 fresh, resumeFromRunId=null, không --resume. Một crew.bundle_resume quan sát được thuộc reviewer, không phải executor. |
| 4a.6 | ĐẠT* | CRE-38 stack-base=b543492, blocker/cùng parent/gói hợp lệ; reviewer kiểm author approval và git diff b543492..2b1c870, ancestry rc0. |
| 4a.7 | ĐẠT* | CRE-36 completedStageIds đủ4, owner duyệt, pushed=yes, bare main3942556 chứa cả3 commit. |
| 4b | ĐẠT | Seed8c6b95e đúng triệu chứng; CRE-42 có duy nhất CRE-43, không interaction hỏi lại; systematic-debugging + RED/GREEN, root đủ4stage, push thật5bcc303. |
| 4c | ĐẠT | CRE-40/41 crew-kind research, crew-report/reviewer/owner/done; 0 integrator run, git executor không thêm commit trong research, không docs/push marker; 0 board_override. |
| 4.chung.4 | ĐẠT | Timeline lưu từng stage, wake/skip, lease release, handoff replay và run mới; xem bảng dưới và timeline đầy đủ. |
| 5a | ĐẠT | Integrator kiểm merged3942556 và5bcc303, comment crew-docs-check exit=0 với range chính xác; không áp dụng check nguồn Crew vì không sửa nguồn Crew. |

*Có hỗ trợ tay bằng 2 comment chỉ đường CLI có sẵn cho CRE-37/39, không viết/sửa code hộ hay giả marker. Có thể ảnh hưởng tiến độ hoàn tất tiền nhiệm; transcript CRE-37 tự tìm thấy CLI, không chứng minh nó đọc hint. Các owner approval, seed4b và cleanup là thao tác board/runner theo brief. Không force stage, không tạo con hộ Trợ Lý, không tạo task session giả.

### Lệnh, actor và fixture

Board dùng shim đã chỉ định: `api.sh POST /companies/5befeb1a-1578-4656-b913-267494592e53/issues JSON` (root assignee Trợ Lý); `GET /issues/<id>`, `/comments`, `/heartbeat-runs/<run>/log`, `/events`; owner `PATCH /issues/<root> {"status":"done","comment":"Owner: approve …"}` chỉ sau khi currentStageType=approval và currentParticipant.userId đúng owner. Cleanup `PATCH ... {"status":"cancelled"}`. Các JSON request/response, actor và thời điểm nằm trong evidence.

Doctor: `/opt/homebrew/bin/node ~/.crew/app/crew-mac/dist/cli.js doctor`, exec23551 exit0 trước root đầu; 15 mục đạt, cảnh báo load22.94, không lỗi TCC, Claude probe ok. Năm `POST /environments/<id>/probe?companyId=...` ok:true. Backup trước chạy `/opt/crew-v3-spike/backups/ac3-r3-20261008-1625-before.dump`. Không thay image/instructions/policy/load16; instructions áp bởi lead trước lần3.

| Issue | UUID | Loại/cha | Tạo +07 |
|---|---|---|---|
| CRE-36 | `9707bef4-c5d4-4d62-bf60-369c225d9451` | root board | 16:26:30.500223 |
| CRE-37 | `3e26754a-8701-4890-a806-c3408d89e80d` | CRE-36 | 16:34:41.534651 |
| CRE-38 | `6c29e97e-042e-469d-9748-79fe388c00f2` | CRE-36 | 16:35:00.777933 |
| CRE-39 | `95fab3c8-29e9-48da-9157-792c615cb78c` | CRE-36 | 16:35:09.697505 |
| CRE-40 | `8a608794-a339-433b-9b7c-2e85e6c08459` | root board | 16:41:09.195326 |
| CRE-41 | `0d1bebb2-4c99-4d3b-a37e-e1e0e9325497` | CRE-40 | 16:43:39.891156 |
| CRE-42 | `87ee4a61-2cff-4a12-909c-7766de1a9ae8` | root board | 16:57:21.892602 |
| CRE-43 | `d6714b10-9e28-4de7-9033-4afa458cbb0c` | CRE-42 | 17:00:41.200016 |

Cả3 root có createdByUserId=`Mtye1JcS4JUc3lTZj51hI7nfz1pqMPSI`. Child có createdByAgentId=Trợ Lý. Research label ngay lúc POST; không gửi policy tự chế. CRE-36 và CRE-42 policy4stage; CRE-40 policy2stage. API/DB policies + issue_relations được lưu.

### 2c.2 — lỗi nguyên văn và bất biến DB

Key ID `fbd03562-23a7-407d-a0ae-ebf074a58acb`, agent `37a9e834-6aaf-4970-8f89-95dbc8a019f2`, header `X-Paperclip-Run-Id: 4d800afe-4fe9-4352-979c-2e97db9cce32`. Không đặt PAPERCLIP_RUN_ID trong shell runner. Payload lần lượt:

```json
{"adapterConfig":{"command":"/bin/false"}}
{"adapterConfig":{"extraArgs":["--ac3-forbidden"]}}
{"adapterConfig":{"env":{"AC3_FORBIDDEN":"1"}}}
{"adapterConfig":{"model":"opus"}}
```

Cả4 HTTP422, body sau (keys thay theo field):

```json
{"error": "Crew: agent không được sửa cấu hình thực thi đã ghim của agent.", "code": "crew_agent_config_forbidden", "details": {"code": "crew_agent_config_forbidden", "keys": ["adapterConfig.command"]}}
```

Hash md5(adapter_config::text) trước/sau=`886f3226a055cfb4b5c99ff4e8a676f4`; updated_at trước/sau=`2026-10-08T09:35:14.802Z`. DELETE key trả `{"ok":true}`, file plaintext tạm đã unlink. Không thực hiện lại skills/sync trong lần3; kết quả/caveat200 của lần2 vẫn giữ nguyên.

### 4a — session và lỗi code cần lead xử lý

CRE-37 run `3b8508e9-bc74-4e74-b671-16a085603c97` bắt đầu16:34:44.552, cancel16:38:59.387. Lỗi nguyên văn: `Cancelled before issue reassignment`, errorCode=`issue_reassigned`. `session_id_before=null`, `session_id_after=null`; SQL task session executor CRE-37/38 trả count=0. CRE-38 run đầu `8abd92ca-c6cd-4b6a-a502-3f259a6d0c11` start16:39:38.338, context resumeFromRunId/resumeSessionDisplayId/resumeSessionParams/crewBundleResume=null; before/after=null, adapter.invoke không có --resume. Không đủ điều kiện đối chiếu session before=after vì session tiền nhiệm không được lưu.

**Lỗi code B1 (đã tái hiện):** `server/src/routes/issues.ts`, `issueRoutes` handler PATCH `/:id`, nhánh `assigneeWillChange` / `resolveActiveIssueRun` / `heartbeat.cancelRun` (~13400–13420): chuyển stage workflow cũng hủy run hiện tại với issue_reassigned. Đường `server/src/services/heartbeat.ts::cancelRunInternal`/`executeRun` không để lại session executor trên ca SSH thực này. `server/src/crew/bundle-resume.ts::findBundlePredecessor`/`pickBundlePredecessor` yêu cầu agent_task_sessions của chính agent tiền nhiệm, nên `applyBundleResume` skip khi không có row. Đây là xung đột chuyển stage/lưu session đã có live evidence; không khẳng định mọi adapter hoặc mọi cancel đều mất session. Không sửa code.

Đối chứng quan trọng: activity `crew.bundle_resume` duy nhất `65786b48-4c51-4c96-9d57-5bccd55a332a` lúc16:42:39.990378 thuộc reviewer run `b4810ca1-a3b7-4baf-92dd-8f899578a888`; resumeFromRunId=`97bde774-4756-4ae3-99af-4b1db5a42c22`, session=`de3f55df-ce21-4b41-99f9-4a0bd5e80c60`, before=after, params.remoteExecution giữ SSH đúng. Không đếm nhầm reviewer thành executor. Executor gói README run4d800afe… không --resume như đối chứng mong đợi.

Bằng chứng commit: CRE-37 b5434925d5a71c8585984ce941dee0e64961ba7a; CRE-38 2b1c8702c12f574b3d2cbdabdc8eeb4f7bc23ae5; CRE-39 92b7a3816699c4832a2b97f4ab0e264d7b403570. `git merge-base --is-ancestor` tiền nhiệm→stack và từng commit→merged/bare main đều0. Seq2 là khóa test/docs cho fallback đã có từ nhánh else của seq1, không giả rằng có RED thật cho seq2. Tiêu chí RED/GREEN bắt buộc của4b được đo riêng.

### 4b và 4c — kết quả thực

Runner seed4b trong worktree riêng `~/crew-spike/ac3-r3-bug-seed-mujrytlf` từ3942556, nhánh `crew/ac3-r3-bug-seed`. Chỉ src/greet.js + docs/flows/repo-a.md, seed8c6b95ed1f952bdb5f5e523ccbbb204215197e85, 14 test cũ xanh; repro empty/spaces/en đều Hello, !. Push non-force `git push origin HEAD:refs/heads/main` vào bare repo thử; `git worktree remove` worktree sạch do runner tạo. Giữ nhánh seed làm bằng chứng. Không đụng owner checkout.

Bug executor run `c7bc6a40-3303-475b-b2f0-47e4e6e928c3`: Skill systematic-debugging17:00:56.181, test-driven-development17:01:11.041; RED17:01:23.817 `ERR_ASSERTION actual: Hello, ! expected: Xin chào!`; GREEN17:01:34.504 `tests25 pass25 fail0`. Commit test đỏ31676287ff12451a5e90a276d68b6dfd9b0ac400 trước fix b3a2f1499e33accc3a5357ce5fa01ce9f33e4c50. Lệnh `node --test test/greet.test.js`; transcript và output đầy đủ liên quan trong evidence. Root CRE-42 done đủ4stage, merged/pushed5bcc3034837f1aa2762f565ca1e381c22672bb16.

Research: CRE-41 có crew-kind research, executor chỉ đọc source/test và viết crew-report bằng comment. Reviewer yêu cầu rút gọn báo cáo một lần; executor sửa comment, reviewer `crew-review research verdict=approved` lúc16:47:30.322 mới hơn report16:46:26.157. Root reviewer duyệt, owner16:51:59.303, done đủ2stage. Snapshot git executor trước/giữa/sau research: HEAD2b1c870, status sạch, reflog không entry mới trong hai run research. SQL research tree8run, integrator0; comments không crew-commit/crew-merge/crew-docs-check, 0 board_override toàn lần3 trước cleanup. Không đếm commit CRE-38 trước research hoặc CRE-43 sau research thành commit research.

### 5a — docs trên merged commit

| Ca | Commit kiểm/push | Range trước owner | Kết quả |
|---|---|---|---|
| 4a | 3942556261bfafa62ceb09edf82b6ad13b4e3fa2 | 21734793c9a3f0af10f1f151b0ac39f7624cbaed..3942556261bfafa62ceb09edf82b6ad13b4e3fa2 | exit0, 14 test pass |
| 4b | 5bcc3034837f1aa2762f565ca1e381c22672bb16 | 8c6b95ed1f952bdb5f5e523ccbbb204215197e85..5bcc3034837f1aa2762f565ca1e381c22672bb16 | exit0, 25 test pass |

Integrator tự chạy `node "$(git config --get crew-docs.bundle)" check --range <base>..HEAD`, tự ghi crew-docs-check; stagepush kiểm lại rangeorigin/main..HEAD và ghi crew-merge pushed=yes. Không runner ghi hộ marker. `node --test test/` / npm test lỗi MODULE_NOT_FOUND trên baseline Mac; agent đổi sang file test trực tiếp. README sinh trong4a vẫn mô tả directory-form không chạy trên Mac này: caveat chất lượng docs/test command, không được che bằng kết quả docscheck vốn kiểm mapping nguồn/doc.

### Timeline chuyển stage gốc (08/10/2026, +07)

Mỗi hàng là DB issue.updated đổi executionState, không suy từ status stock. Lease cũ lấy theo run thực hiện transition; wake/skip chi tiết và acquire/start nằm ở [timeline đầy đủ](reports/ac-3-r3-timeline.md).

| Issue | Thời điểm transition | Stage tới | Run chuyển | Lease run chuyển released |
|---|---|---|---|---|
| CRE-36 | 16:47:38.027166 | 0 review | dc80a67f | 16:47:41.211 |
| CRE-40 | 16:48:36.510076 | 0 review | 0cc23bf5 | 16:48:41.873 |
| CRE-36 | 16:49:37.490003 | 1 review | a54480ab | 16:49:43.047 |
| CRE-40 | 16:50:52.971387 | 1 approval | 91f4b2ba | 16:50:56.672 |
| CRE-40 | 16:51:59.447464 | completed | board | — |
| CRE-36 | 16:53:17.605722 | 2 approval | a8988bc1 | 16:53:22.274 |
| CRE-36 | 16:53:59.797482 | 3 review | board | — |
| CRE-36 | 16:56:15.095466 | completed | 40839288 | 16:56:25.833 |
| CRE-42 | 17:04:33.623129 | 0 review | c3e1937a | 17:04:35.326 |
| CRE-42 | 17:06:11.750946 | 1 review | fe18274f | 17:06:12.922 |
| CRE-42 | 17:08:21.543962 | 2 approval | 6d9798bb | 17:08:23.621 |
| CRE-42 | 17:08:43.957128 | 3 review | board | — |
| CRE-42 | 17:11:55.301343 | completed | 06108dbb | 17:12:03.427 |

Skip nguyên văn đã gặp: `The previous execution has not released its environment lease. Wait for cleanup before continuing this task.` Reason execution_reconciliation_required; crew.handoff_rewake nối đúng skippedWakeId/previousRunId sau release. Stage owner không có agentrun/lease; owner approval mới tạo wake integrator. Root chờ con có thêm stock finish_successful_run_handoff; Trợ Lý đưa blocked rồi stock issue_children_completed tự wake. Không coi in_progress/blocked do recovery/checkout là mất executionState.

### Danh mục run

| Issue | Run UUID | Agent | Start +07 | Finish +07 | Status / lỗi |
|---|---|---|---|---|---|
| CRE-36 | `810519fe-ea0e-4455-b95d-c704b1be9205` | Trợ Lý | 16:30:00.433 | 16:36:54.576 | succeeded  |
| CRE-37 | `3b8508e9-bc74-4e74-b671-16a085603c97` | executor2 | 16:34:44.552 | 16:38:59.387 | cancelled issue_reassigned |
| CRE-39 | `4d800afe-4fe9-4352-979c-2e97db9cce32` | executor1 | 16:35:10.815 | 16:39:08.879 | cancelled issue_reassigned |
| CRE-36 | `29f12e6f-419f-4e41-8167-16981f905dd1` | Trợ Lý | 16:36:55.543 | 16:39:08.089 | succeeded  |
| CRE-37 | `97bde774-4756-4ae3-99af-4b1db5a42c22` | reviewer | 16:39:05.608 | 16:39:45.306 | succeeded  |
| CRE-39 | `2e649005-b9db-412c-9fcf-a8174f44f66b` | reviewer | 16:39:59.997 | 16:40:55.988 | succeeded  |
| CRE-38 | `8abd92ca-c6cd-4b6a-a502-3f259a6d0c11` | executor2 | 16:39:38.338 | 16:42:33.085 | cancelled issue_reassigned |
| CRE-40 | `8a2e62c4-1ca6-4003-a33d-8a86c0209a97` | Trợ Lý | 16:41:10.234 | 16:44:27.475 | succeeded  |
| CRE-38 | `b4810ca1-a3b7-4baf-92dd-8f899578a888` | reviewer | 16:42:40.027 | 16:43:55.026 | succeeded  |
| CRE-41 | `afb94770-1924-4667-9caf-2d4ef216e4c2` | executor2 | 16:43:40.918 | 16:44:50.004 | cancelled issue_reassigned |
| CRE-36 | `dc80a67f-a06e-4aa3-b9fe-d20a6a82c703` | Trợ Lý | 16:46:00.077 | 16:47:35.55 | cancelled issue_reassigned |
| CRE-40 | `ec50e871-1d09-4b44-953c-a617f244d3f5` | Trợ Lý | 16:44:28.873 | 16:45:50.641 | succeeded  |
| CRE-41 | `ac18de6e-523f-441a-aeef-fec04807f9e7` | reviewer | 16:44:56.176 | 16:45:41.652 | cancelled issue_reassigned |
| CRE-41 | `b026b9ea-7cb4-4378-a4d1-4ad90207ad42` | executor2 | 16:45:45.399 | 16:46:35.137 | cancelled issue_reassigned |
| CRE-41 | `582491cb-195d-459d-a304-e569b4339e66` | reviewer | 16:46:38.898 | 16:47:38.897 | succeeded  |
| CRE-40 | `0cc23bf5-9561-4d5d-95ae-5cc66604ef78` | Trợ Lý | 16:47:37.997 | 16:48:36.465 | cancelled issue_reassigned |
| CRE-36 | `a54480ab-e1b8-431d-b6cb-d10077403d08` | reviewer | 16:47:42.569 | 16:49:36.22 | cancelled issue_reassigned |
| CRE-40 | `91f4b2ba-15d3-4ced-82b9-46b209f65934` | reviewer | 16:49:37.413 | 16:50:52.894 | cancelled issue_reassigned |
| CRE-36 | `a8988bc1-b158-47df-8c8d-a4f32ec5eb0c` | integrator | 16:49:43.749 | 16:53:17.523 | cancelled issue_reassigned |
| CRE-36 | `40839288-366b-4770-8879-4a7d67cdca03` | integrator | 16:54:00.277 | 16:56:25.589 | succeeded  |
| CRE-42 | `9590bf4b-d20e-431b-897f-fcf1cefbadc1` | Trợ Lý | 16:57:24.152 | 17:01:37.593 | succeeded  |
| CRE-43 | `c7bc6a40-3303-475b-b2f0-47e4e6e928c3` | executor2 | 17:00:42.048 | 17:02:35.331 | cancelled issue_reassigned |
| CRE-42 | `69452213-5b3a-43b9-88ca-20cb72e0c5df` | Trợ Lý | 17:01:38.387 | 17:03:00.744 | succeeded  |
| CRE-43 | `12c48123-2f19-4d29-aeb8-cb96af6d93ab` | reviewer | 17:02:37.576 | 17:03:48.521 | succeeded  |
| CRE-42 | `c3e1937a-334b-4688-a86a-6533a2e20b43` | Trợ Lý | 17:03:42.778 | 17:04:33.569 | cancelled issue_reassigned |
| CRE-42 | `fe18274f-17fb-4b67-a26a-a222456be409` | reviewer | 17:04:36.037 | 17:06:11.63 | cancelled issue_reassigned |
| CRE-42 | `6d9798bb-c164-42d9-944d-17cf2f73756a` | integrator | 17:06:13.343 | 17:08:21.413 | cancelled issue_reassigned |
| CRE-42 | `06108dbb-a942-4098-83a5-85cd3ea9e8ba` | integrator | 17:08:44.944 | 17:12:03.118 | succeeded  |

### SQL đối chiếu và giới hạn

Đọc DB bằng SSH `nhamoiplatform`, cwd `/opt/crew-v3-spike`, `docker compose exec -T db psql -U paperclip -d paperclip -Atc ...`; không in credential. Các truy vấn chính:

```sql
SELECT id,status,started_at,finished_at,error,error_code,session_id_before,session_id_after,context_snapshot->>'resumeFromRunId' FROM heartbeat_runs WHERE company_id='5befeb1a-1578-4656-b913-267494592e53' AND created_at>='2026-10-08T09:26:30.500Z' ORDER BY created_at;
SELECT count(*) FROM agent_task_sessions WHERE agent_id='c452d003-6a7c-4820-9c7a-91d5f762d734' AND task_key IN ('3e26754a-8701-4890-a806-c3408d89e80d','6c29e97e-042e-469d-9748-79fe388c00f2'); -- 0
SELECT id,heartbeat_run_id,acquired_at,released_at,status FROM environment_leases WHERE company_id='5befeb1a-1578-4656-b913-267494592e53' AND created_at>='2026-10-08T09:26:30.500Z';
SELECT id,reason,status,run_id,requested_at,claimed_at,finished_at,error FROM agent_wakeup_requests WHERE company_id='5befeb1a-1578-4656-b913-267494592e53' AND created_at>='2026-10-08T09:26:30.500Z';
```

**Concern vận hành C2:** run integrator a8988bc1… đã tự thực hiện `cd /tmp && rm -rf repo-a-check && git ... worktree add /tmp/repo-a-check ...`, sau đó worktree remove --force. Runner không phát lệnh ấy, không có snapshot trước để chứng minh thư mục không tồn tại/không chứa dữ liệu cũ. Không thể khẳng định không có dữ liệu cũ bị xóa. Đây là hành vi agent vượt giới hạn xóa của brief; ghi lead, không gán thành lỗi code đã chứng minh. Instructions `crew/agents/integrator.md`, mục Gộp/Kiểm, là nơi lead cần xem lại việc truyền/giữ phạm vi. Board nhắc lại cấm rm-rf ở approval4a và toàn prompt4b. Không quan sát lặp lại trong4b.

Research report có nhận định về dấu tổ hợp chưa có thử nghiệm chứng minh; nghiệm thu4c ở đây xác nhận workflow/report delivery, không coi mọi nhận định nội dung là kết luận nghiên cứu đã kiểm chứng. Không thấy quota error; không issue nào kẹt quá30 phút không tiến. Root4a mất gần30 phút tổng thể nhưng liên tục chuyển bước, không vi phạm ngưỡng chờ không tiến.

### Dọn và artifact

Cuối lượt: cả8 issue CRE-36..43 cancelled bằng board; 0 queued/running toàn company; 0 active lease của lượt. Key tạm đã revoke. Remote-stop và ps đã kiểm, không còn Claude mới của lượt nghiệm thu; không dừng process cũ của owner. Owner-wip.txt SHA256 giữ `df2eb96d9f84ab66c8140324b7e9f4700f6404c82fe5499771f64f1941d598b7`, owner status chỉ `?? owner-wip.txt`. Bare main cuối5bcc303; giữ nhánh/commit thử. Fork sạch, không sửa/push Crew/fork; không deploy, không xóa environment, không đổi policy/load16. Mọi thay đổi ghi processes.md.

[JSON evidence lần3](reports/ac-3-r3-evidence.json) và [timeline lần3](reports/ac-3-r3-timeline.md) lưu snapshots và transcript chọn lọc, không env/cookie/token/key. Report/evidence/timeline được upload attachment + work product vào CRE-36, receipt ở reports/ac-3-r3-artifact-receipts.json. Artifact cũ của lần1/2 giữ nguyên.


# AC-3 lần 4 — 4a.5

Ngày 08/10/2026, Asia/Ho_Chi_Minh; chạy từ 17:55, issue mới 17:57:31, phép đo dừng 18:08:14; kiểm dọn lúc 18:10:04.168. **Status: KHÔNG ĐẠT. Lần 4: 0/1 tiêu chí đạt, 1/1 không đạt; cộng dồn vẫn 29/30 ĐẠT, 1/30 KHÔNG ĐẠT (4a.5), 2 mục N/A như trước.** Các lần trước được giữ nguyên. Chỉ chạy 4a.5 theo chỉ định, không chạy lại các cổng khác, build/typecheck hoặc deploy.

Bản sửa đã tìm được UUID trong log của run bị `issue_reassigned`, nhưng adapter từ chối nối session vì resume params thiếu `mcpServerIdentity`. Snapshot đúng **không đủ** để tính đạt: argv thật không có `--resume`, `system/init` của con 2 sinh UUID mới.

## Môi trường và điều kiện đầu

- API health: `commit=01d07bdd6abfde2429a0a1c2fa38d2e1dc49a672`, `version=v2026.1001.0-crew-01d07bdd6`; plugin `crew.core` healthy. Fork HEAD khớp, git status sạch. Giữ image/instructions đã áp sẵn; không deploy hoặc áp lại.
- `/opt/homebrew/bin/node ~/.crew/app/crew-mac/dist/cli.js doctor`: rc0, PID9643 / exec10307; Claude 2.1.294, probe trả ok, TCC không có hộp thoại chờ trong 24h. Cảnh báo load1=28.93 / 10 CPU, RAM trống37%. Ngưỡng16 giữ nguyên.
- Backup trước mutation: `/opt/crew-v3-spike/backups/ac3-r4-20261008-1757-before.dump`, pg_dump custom rc0, 3,528,814 byte. Đầu lượt không có queued/running trong Crew Spike.
- Board tạo đúng một root mới qua `POST /companies/5befeb1a-1578-4656-b913-267494592e53/issues`; `createdByUserId=Mtye1JcS4JUc3lTZj51hI7nfz1pqMPSI`, `createdByAgentId=null`, assignee tro-ly. Yêu cầu rất nhỏ: `greetAll(names, lang="vi")` truyền lang xuống greet; con sau cập nhật ví dụ README. Toàn payload ở evidence `root-request`.

| Vai trò | Issue ID | Run dùng đối chiếu |
|---|---|---|
| Gốc CRE-44 · Trợ Lý | `27db86fa-9a3d-406c-8b7b-e5eae0ce126a` | `6bd3c4f2-af1c-4752-b72a-cc422fa45d0b`; continuation `cd658ea1-e445-41e8-a29f-839ba0f866f6` |
| Con 1 CRE-45 · executor mac-claude-2 | `92c3e766-d8db-4ffa-9228-d5f4b05cf955` | `59bef373-20de-413f-9397-f234d82dccca` |
| Review con 1 | CRE-45 | `8e35f40f-9f9a-4c88-b9d7-cdeb2c91edf1` |
| Con 2 CRE-46 · cùng executor | `9e822bee-134d-44e8-b4e7-e59456328d99` | `0ab73865-58db-436e-9b55-d6e738737651` |

Executor cả hai là `c452d003-6a7c-4820-9c7a-91d5f762d734`, environment `5e7aa9c4-531c-4fe8-a6d5-fcd4816a244e`, worktree `/Users/phannhatquang/crew-agents/mac-claude-2`. Cả hai model sonnet5/medium, root opus5 theo cấu hình có sẵn.

## Kết quả từng phép đo của 4a.5

| Phép đo | Kết quả | Bằng chứng |
|---|---|---|
| Trợ Lý tự lập kế hoạch rồi tạo ≥2 con cùng gói/cùng executor | ĐẠT | `crew-plan` comment `0997e957-21b1-49b9-83c1-8183b52212a4` lúc18:01:24.020; CRE-45 tạo18:01:37, CRE-46 tạo18:01:48. |
| Seq1/2, blocker trực tiếp, crew-stack | ĐẠT | `crew-bundle id=greet-all-lang seq=1/2`; relation CRE-45 blocks CRE-46; CRE-46 có `crew-stack on=CRE-45`. |
| Đúng dạng run tiền nhiệm bị hủy khi bàn giao | ĐẠT | A `cancelled`, `error_code=issue_reassigned`, `error="Cancelled before issue reassignment"`, before/after null, log_store local_file, log_bytes null. Không có task session executor trên A. |
| Snapshot B trỏ đúng A và UUID init A | ĐẠT | `resumeFromRunId=59bef373-20de-413f-9397-f234d82dccca`; `resumeSessionParams.sessionId=cc393a91-424d-4140-b5a6-52f7b6b90db3`; session_id_before đúng UUID này. |
| Remote execution identity và audit resume | ĐẠT phần snapshot | Params có transport ssh/host100.102.189.67/port2222/username phannhatquang/remoteCwd đúng worktree. `crew.bundle_resume` đúng **1 lần**, 18:07:20.162997, entity B. |
| argv/log B có `--resume <UUID A>` | **KHÔNG ĐẠT** | Đúng1 event `adapter.invoke` cho B; `commandArgs` **không có `--resume`**; có append-system-prompt-file (nhánh fresh). |
| B chạy trong đúng session A | **KHÔNG ĐẠT** | Init B là `0cce4bb3-c1f4-4e68-adbb-22f5618c4705` khác `cc393a91-424d-4140-b5a6-52f7b6b90db3`. Không lỗi `session not found`; adapter chủ động mở fresh trước khi CLI chạy. |
| B nhắc nội dung A | Có, **không chứng minh resume** | Câu đầu: “Bước 1 đã đổi `greetAll(names)` thành `greetAll(names, lang = "vi")` và truyền `lang` vào `greet`, kèm test hẹp và cập nhật `docs/flows/repo-a.md`.” Nội dung này có thể đọc từ task context; không thay thế kiểm UUID/argv. |

Snapshot B thực tế (trích nguyên giá trị, không credential):

```json
{
  "resumeFromRunId": "59bef373-20de-413f-9397-f234d82dccca",
  "resumeSessionParams": {
    "cwd": "/paperclip/instances/default/workspaces/c452d003-6a7c-4820-9c7a-91d5f762d734",
    "sessionId": "cc393a91-424d-4140-b5a6-52f7b6b90db3",
    "remoteExecution": {
      "host": "100.102.189.67",
      "port": 2222,
      "username": "phannhatquang",
      "remoteCwd": "/Users/phannhatquang/crew-agents/mac-claude-2",
      "transport": "ssh"
    }
  }
}
```

`system/init` A/B đều sonnet5 và có hai MCP connected: `Paperclip projects`, `Paperclip connections`. `mcpServerIdentity` vắng trong resume params B.

`adapter.invoke` B lúc18:07:27.285, command wrapper trên SSH đúng environment; nguyên mảng argv:

```json
["--print", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--model", "claude-sonnet-5", "--effort", "medium", "--append-system-prompt-file", "/Users/phannhatquang/crew-agents/mac-claude-2/.paperclip-runtime/claude/skills/agent-instructions.md", "--mcp-config", "/Users/phannhatquang/crew-agents/mac-claude-2/.paperclip-runtime/claude/mcp-config/mcp-config.json", "--strict-mcp-config", "--add-dir", "/Users/phannhatquang/crew-agents/mac-claude-2/.paperclip-runtime/claude/skills", "--setting-sources", "project,local", "--plugin-dir", "/Users/phannhatquang/.crew/workflows/superpowers/6.4.1-5bf4e7801107"]
```

Nguyên văn hai dòng log từ chối, trước invoke:

```text
18:07:27.276 [paperclip] Claude session "cc393a91-424d-4140-b5a6-52f7b6b90db3" does not match the current remote execution identity and will not be resumed in "/Users/phannhatquang/crew-agents/mac-claude-2". Starting a fresh remote session.
18:07:27.277 [paperclip] Claude session "cc393a91-424d-4140-b5a6-52f7b6b90db3" was saved with a different runtime MCP server set and will not be resumed.
```

## Concern code C4 — thiếu identity MCP khi dựng session từ run log

- `server/src/crew/bundle-resume.ts`, **`sessionFromRun`** (dòng124–164): fallback lấy đúng session từ `sessionIdFromRunLog`, rồi dựng params bằng UUID, workspace và remoteExecution. Run A không có resume params cũ nên không có `mcpServerIdentity` được chuyển tiếp. `findBundlePredecessor`/`applyBundleResume` ghi bộ params thiếu đó vào B.
- `packages/adapters/claude-local/src/server/execute.ts`, **`execute` → `hasMatchingMcpServers` / `canResumeSession`** (dòng771–795): identity rỗng chỉ hợp lệ khi `runtimeMcpServers.length===0`. Máy thật có2 MCP server, nên biểu thức false; `sessionId=null`; `buildClaudeArgs` dòng893 không thêm `--resume`. Log dòng838 xác nhận đúng nhánh này.
- Dòng “remote execution identity” ở810 là thông báo tổng quát khi `!canResumeSession`, không đủ kết luận SSH identity sai. 5 trường remoteExecution đã khớp; `claudeSessionCwdMatchesExecutionTarget` trả true cho remote nên không quy lỗi cho đường dẫn cwd VPS/Mac khác nhau. Căn cứ xác định ở đây là MCP identity vắng + log MCP cụ thể + argv/init thực.
- Đây là lỗi hợp đồng giữa params Crew phục hồi và guard adapter stock, không phải `session not found`, TCC hay quota. Đề nghị lead giữ/phục hồi metadata session đã xác thực gồm identity MCP trước hủy run; bổ sung phép thử chạy adapter với MCP thật, không chỉ assertion snapshot. **Không sửa code hoặc làm yếu guard trong lượt nghiệm thu này.**

## Thứ tự stage/wake/lease (Asia/Ho_Chi_Minh)

| Giờ | Sự kiện |
|---|---|
| 17:57:32.529 | Cổng tải giữ root: load19.2 >16. |
| 17:58:36.692 | Run Trợ Lý đầu bắt đầu sau64.666 giây chờ từ wake. |
| 18:01:38.312 | Executor A bắt đầu; init UUID `cc393a91-424d-4140-b5a6-52f7b6b90db3`. |
| 18:01:48.419 / 18:02:06.413 | Wake B bị skip `issue_dependencies_blocked`, chưa tạo run B. |
| 18:06:46.661 | A bị cancel `issue_reassigned` khi chính nó PATCH done để sang reviewer. |
| 18:06:46.864 → .889 | Wake reviewer bị skip `execution_reconciliation_required`, lease A chưa nhả. |
| 18:06:48.588 | Lease A `05ec5f71-163b-4ed6-ac6c-6c9f2a97a4ae` released_at được ghi, status expired. |
| 18:06:48.670 → 18:06:49.071 | Wake review phát lại; reviewer run bắt đầu. Activity `crew.handoff_rewake`18:06:49.088. |
| 18:06:52.510 | Remote-stop A outcome stopped, matched3, remaining0. |
| 18:07:19.172 | Reviewer đã duyệt A → wake B `issue_blockers_resolved`. |
| 18:07:20.162997 → .202 | `crew.bundle_resume` B ghi1 lần, rồi B bắt đầu. |
| 18:07:21.225 | B lấy lease `dcb95021-e81c-4c37-b50f-772bdc910778`. |
| 18:07:24.916 → 18:07:25.250 | Reviewer run kết thúc rồi nhả lease reviewer. B dùng environment khác nên đã bắt đầu trước khi reviewer nhả lease. |
| 18:07:27.276 → .285 | Adapter từ chối resume vì MCP; invoke không --resume. Init B UUID mới. |
| 18:08:14.017 / .478 / 18:08:15.229 | Board cancel root / B / A. B run kết thúc cancelled18:08:14.632. |
| 18:08:15.818 → 18:08:20.411 | Lease B release, remote-stop stopped/remaining0. |

Timeline đầy đủ: [ac-3-r4-timeline.md](reports/ac-3-r4-timeline.md). JSON snapshot/argv/init/comments/DB: [ac-3-r4-evidence.json](reports/ac-3-r4-evidence.json).

## Lệnh, can thiệp tay và giới hạn

API dùng shim board được owner chỉ định (tự thêm `/api`), truyền body bằng Python subprocess argv để không nội suy shell. Đọc `/health`, `/plugins/crew.core/health`, `/heartbeat-runs/<run>/log?offset=0&limitBytes=256000`, `/heartbeat-runs/<run>/events?limit=1000`, `/issues/<id>/comments`. Mutation chỉ tạo root, comment hỗ trợ, PATCH cancelled3issue và upload artifact/workproduct; không tạo key agent, không đặt PAPERCLIP_RUN_ID trong shell.

DB qua `ssh nhamoiplatform`, cwd `/opt/crew-v3-spike`, `docker compose exec -T db psql -v ON_ERROR_STOP=1 -U paperclip -d paperclip -Atc '<SQL>'`. Các truy vấn quyết định:

```sql
SELECT id,status,error_code,session_id_before,session_id_after,
 context_snapshot->>'resumeFromRunId',context_snapshot->'resumeSessionParams'
FROM heartbeat_runs WHERE id IN ('59bef373-20de-413f-9397-f234d82dccca','0ab73865-58db-436e-9b55-d6e738737651');
SELECT count(*) FROM agent_task_sessions
WHERE agent_id='c452d003-6a7c-4820-9c7a-91d5f762d734'
AND task_key IN ('92c3e766-d8db-4ffa-9228-d5f4b05cf955','9e822bee-134d-44e8-b4e7-e59456328d99'); -- 0
SELECT count(*) FROM activity_log WHERE action='crew.bundle_resume'
AND entity_id='0ab73865-58db-436e-9b55-d6e738737651'; -- 1
SELECT count(*) FROM heartbeat_runs WHERE company_id='5befeb1a-1578-4656-b913-267494592e53'
AND status IN ('queued','running'); -- 0
```

**Thao tác tay có thật:** board comment `53240a88-d333-40bd-a729-7eb36e21d133` trên CRE-45 lúc18:06:36.879 chỉ đường `node "$(git config --get crew-docs.bundle)" check --range origin/main..HEAD`, nhắc dừng tìm toàn filesystem. Agent trước đó gặp `(eval):1: command not found: crew-docs` (exit127), rồi gọi `find / -maxdepth 6 ...`. Comment bị xếp deferred và sau đổi assignee đã cancelled với `Deferred task messages now belong to the current assignee`; không khẳng định agent đã đọc/nhờ comment mới vượt lỗi. Không can thiệp snapshot/session, không tạo hộ con, không ép stage done. Không tính phép đo này là vận hành hoàn toàn không hỗ trợ tay. Lệnh tìm `/` của agent vượt phạm vi cần thiết; không thấy sửa/xóa dự án khác, runner không chạy lệnh tìm đó.

Quan sát bằng polling khoảng30–60 giây; không issue nào kẹt30phút, không thấy lỗi quota. Dừng ngay khi đủ bằng chứng thất bại; CRE-46 chưa qua reviewer, không owner approval/integrator/push. Các cổng khác không tái nghiệm thu; không chạy build/typecheck vì không đổi code và chỉ đo4a.5.

## Dọn và thay đổi môi trường

- CRE-44/45/46 đều cancelled bằng board;5run terminal (3succeeded,2cancelled),0queued/running toàn company,0lease chưa release của lượt.5remote-stop outcome stopped/remaining0. ps còn đúng5Claude cũ trước lượt (PID58305,49360,79225,80511,72637); không kill process owner.
- Executor tự tạo commit `0a401a245df2e12aee570d62a0fd476781119119` trên nhánh `crew/cre-45` repo thử (hàm/test/flow); reviewer duyệt,30test xanh theo transcript. Worktree executor sạch sau cancel, chưa sửa README. Giữ commit/nhánh và runtime files; runner chỉ đọc git status/log tại crew-agents.
- Bare origin/main vẫn `5bcc3034837f1aa2762f565ca1e381c22672bb16`, không push. Owner-wip SHA256 vẫn `df2eb96d9f84ab66c8140324b7e9f4700f6404c82fe5499771f64f1941d598b7`; checkout owner vẫn chỉ `?? owner-wip.txt`.
-5environment giữ nguyên, maxLoad1=16. Không đổi policy/instructions/agent config/secret, không xóa environment; không sửa/commit/push Crew/fork hoặc deploy. Không dọn file do agent tạo bằng rm-rf. Các thay đổi và backup/scratch được ghi `processes.md`.
- Kênh bàn giao report/evidence/timeline: attachment CRE-44 bằng API board và artifact work product (không dùng helper yêu cầu PAPERCLIP_RUN_ID trái luật lượt này). Receipt: `reports/ac-3-r4-artifact-receipts.json`; final comment giữ cancelled và có link download. Không chỉ dựa đường dẫn local.


# AC-3 lần 5 — 4a.5

Ngày 08/10/2026, Asia/Ho_Chi_Minh. **Status: BLOCKED môi trường — dừng ở kiểm tra TCC, trước khi tạo issue.** Lần 5: 0/1 tiêu chí được thực thi, 1/1 bị chặn; không có kết quả resume mới. Cộng dồn giữ **29/30 ĐẠT, 1/30 KHÔNG ĐẠT (4a.5 từ lần 4)**; không coi blocker môi trường là bằng chứng lỗi code mới. Giữ nguyên toàn bộ các lần trước.

Phạm vi chỉ định: image đã deploy `crew-v3/paperclip:v3-d457ddbfd`; đo hai con cùng gói/cùng executor, snapshot B trỏ run A và UUID init A, `mcpServerIdentity` không rỗng, argv thật B có `--resume <UUID A>`, init B giữ UUID đó và tiếp tục ngữ cảnh. **Chưa xác minh image bằng API hoặc chạy bất kỳ phép đo resume nào**, vì điều kiện tiền kiểm bắt buộc thất bại.

## Bằng chứng tiền kiểm và quyết định dừng

Lệnh duy nhất khởi chạy công cụ kiểm môi trường Mac:

```sh
/opt/homebrew/bin/node ~/.crew/app/crew-mac/dist/cli.js doctor
```

Exec session `58687`, process đã kết thúc, **exit code 1**. Kết quả 15 mục ĐẠT, 1 mục LỖI. Claude probe vẫn trả `ok`, nhưng không thay thế điều kiện không có LỖI TCC. Nguyên văn output:

```text
[ĐẠT] Tailscale: 100.102.189.67
[ĐẠT] sshd agent (phiên desktop): com.2p.crew-mac-sshd pid 16059
[ĐẠT] Bộ dọn process mồ côi: com.2p.crew-mac-reaper chạy mỗi 60 giây
[ĐẠT] Cổng sshd: 100.102.189.67:2222
[ĐẠT] PATH cho claude và node: /Users/phannhatquang/.zshenv
[ĐẠT] Wrapper crew-claude-run: /Users/phannhatquang/.crew/bin/crew-claude-run → 2.1.294 (Claude Code); agent đặt adapterConfig.command bằng đường dẫn này
[ĐẠT] node trong PATH của sshd agent: /opt/homebrew/bin/node
[ĐẠT] Lệnh crew-mac cho phía server: /Users/phannhatquang/.crew/bin/crew-mac → /Users/phannhatquang/.crew/app/crew-mac/dist/cli.js
[ĐẠT] Superpowers 6.4.1 đã ghim: /Users/phannhatquang/.crew/workflows/superpowers/6.4.1-5bf4e7801107 (231 file); bản owner đang cài: 6.4.1
[ĐẠT] Thư mục worktree: /Users/phannhatquang/crew-agents
[ĐẠT] Nguồn skill trong các worktree agent: 5 worktree, không có nguồn bị chặn
[ĐẠT] crew-docs cho integrator: 5 worktree, bundle và runtime chạy được qua sshd agent
[ĐẠT] Claude đăng nhập (qua sshd agent): claude.ai, gói max
[ĐẠT] claude -p trong git repo: trả lời ok
[LỖI] Hộp thoại quyền macOS đang chờ: 2026-10-08 18:03:58.825 kTCCServiceSystemPolicyAppData cho /Users/phannhatquang/.local/share/claude/versions/2.1.294
    → Mở màn hình Mac (trực tiếp hoặc qua Chrome Remote Desktop), tìm hộp thoại "2.1.294" muốn truy cập kTCCServiceSystemPolicyAppData, bấm "Allow". Nếu không thấy hộp thoại: System Settings → Privacy & Security → Files and Folders, bật quyền cho /Users/phannhatquang/.local/share/claude/versions/2.1.294. Claude Code cập nhật bản mới thì đường dẫn đổi và macOS hỏi lại.
[ĐẠT] Tải máy: load 1 phút 2.74 / 10 CPU, RAM trống 49%
```

Dòng 18:03:58.825 là thời điểm sự kiện TCC mà doctor báo, không phải thời điểm tạo issue lần 5. Runner không xác minh trực quan hộp thoại, không suy diễn probe thành công nghĩa là TCC đã hết lỗi. Áp dụng đúng luật owner: “doctor phải không có LỖI TCC (có thì dừng, báo lead)”. Đã báo trong phiên làm việc; lead cần xử lý quyền trên màn hình Mac rồi chạy lại doctor trước khi thử tiếp. Không tự cấp/reset quyền, đổi cấu hình hay bỏ qua gate.

| Phép đo 4a.5 lần 5 | Kết quả | Bằng chứng |
|---|---|---|
| Doctor không có LỖI TCC trước issue đầu | KHÔNG ĐẠT tiền điều kiện | Exit 1; lỗi TCC nguyên văn ở trên. |
| Gốc board mới; ≥2 con cùng bundle seq1/2, cùng executor, blocker | CHƯA CHẠY — BLOCKED | Không tạo issue gốc/con; không dùng lại CRE-31..46. |
| Snapshot B: `resumeFromRunId=A`, sessionId bằng init A | CHƯA CHẠY — BLOCKED | Không có ID issue/run mới. |
| Snapshot B: `mcpServerIdentity` không rỗng | CHƯA CHẠY — BLOCKED | Không có snapshot mới. |
| `adapter.invoke` B có `--resume <UUID init A>` | CHƯA CHẠY — BLOCKED | Không có invocation mới. |
| Init B cùng session_id A; tiếp tục ngữ cảnh, không session-not-found | CHƯA CHẠY — BLOCKED | Không có log mới. |

## Kiểm đóng lượt, lệnh DB và thay đổi

Sau khi dừng, chỉ đọc DB để xác nhận không có run active; không mutation API/DB:

```sh
ssh nhamoiplatform 'cd /opt/crew-v3-spike && docker compose exec -T db psql -v ON_ERROR_STOP=1 -U paperclip -d paperclip -Atc "<SQL bên dưới>"'
```

```sql
SELECT json_build_object(
  'checked_at', now(),
  'active_runs', (
    SELECT count(*) FROM heartbeat_runs
    WHERE company_id='5befeb1a-1578-4656-b913-267494592e53'
      AND status IN ('queued','running')
  )
);
```

Thực thi bằng Python subprocess argv + shlex.quote cho SQL; rc0, stderr rỗng. Kết quả DB nguyên văn:

```json
{"checked_at" : "2026-10-08T11:29:21.571735+00:00", "active_runs" : 0}
```

Tương ứng **18:29:21.571735 +07**: **0 queued/running toàn company Crew Spike**. Không có issue mới cần cancel, không có run Paperclip do lượt này tạo. Doctor đã thoát; không khởi tạo process nền riêng hoặc server mới. Không có thao tác tay làm đạt tiêu chí.

Không sửa code Crew/fork, không commit/push/deploy, không áp lại instructions, không xóa environment, không đổi policy/load16/credential, không đặt PAPERCLIP_RUN_ID. Không chạy build/test vì phạm vi chỉ nghiệm thu runtime và đã dừng trước fixture. Không tạo backup DB vì không có mutation dữ liệu. Chỉ append báo cáo này và processes.md. Báo cáo giữ tại đường dẫn owner chỉ định; không tạo issue mới để upload hay ghi artifact lên issue cũ vì gate TCC yêu cầu dừng và lần này cấm dùng lại các issue trước.

**Concerns:** chưa phát hiện lỗi code mới; chưa có bằng chứng để đóng hoặc tái khẳng định C4 (`server/src/crew/bundle-resume.ts` / `sessionFromRun`, guard MCP trong `packages/adapters/claude-local/src/server/execute.ts` / `execute`). Bản sửa identity cần chạy lại trên máy thật sau khi tiền kiểm TCC đạt.


## Chạy lại sau TCC

08/10/2026, **20:30–20:42 Asia/Ho_Chi_Minh**. **Status: ĐẠT — 4a.5 lần 5: 1/1 ĐẠT, 0 KHÔNG ĐẠT; cộng dồn 30/30 ĐẠT, 0/30 KHÔNG ĐẠT**, giữ 2 mục N/A như các lần trước. Phần BLOCKED TCC ở trên là lịch sử lần chạy trước; phần này là kết quả chạy lại sau owner Allow. Chỉ tái nghiệm thu 4a.5, không khẳng định các cổng khác đã chạy lại trên image này.

### Tiền kiểm và fixture

- Doctor `/opt/homebrew/bin/node ~/.crew/app/crew-mac/dist/cli.js doctor`: exec69747 **rc0, 16/16 ĐẠT**, không lỗi TCC; dòng nguyên văn `[ĐẠT] Hộp thoại quyền macOS đang chờ: không có trong 24h gần nhất`. Claude probe ok, phiên bản2.1.294; load1=3.92/10CPU, RAM trống41%.
- API health và Docker image kiểm20:30:32: `crew-v3/paperclip:v3-d457ddbfd`, fullSHA `d457ddbfd4a8fea571bbb8f66e29fec21ea02e4d`; plugin healthy;0run queued/running trước lượt. Không deploy/áp lại instructions.
- Backup trước mutation: `/opt/crew-v3-spike/backups/ac3-r5-20261008-2030-before.dump`, lệnh `docker compose exec -T db pg_dump -U paperclip -d paperclip -Fc > backups/ac3-r5-20261008-2030-before.dump` trong đúng thư mục spike, rc0.
- Đúng **một** gốc mới board tạo **CRE-47** lúc20:31:07.641; `createdByUserId=Mtye1JcS4JUc3lTZj51hI7nfz1pqMPSI`, `createdByAgentId=null`, giao tro-ly. Yêu cầu nhỏ: thêm `lang` cho greetAll và ví dụ README, hai bước cùng gói/cùng người làm; không dùng lại CRE-31..46.

| Vai trò | Issue UUID | Run |
|---|---|---|
| Gốc CRE-47, Trợ Lý | `9ee0aa77-9938-4030-b823-52f5c18af76a` | `0dec7f59-d494-432b-b4ee-e81d58595849`; continuation `946347a1-7349-4829-aebc-8b36656102ef` |
| A = CRE-48, executor | `974d8644-c4b6-4388-8778-aeb0a409af60` | `2e6b327e-05bb-418e-8f4c-2378e379fe84` |
| Reviewer A | CRE-48 | `c88f8af4-6450-4bc2-8b9a-ade547fddced` |
| B = CRE-49, executor | `90fdfdf7-3042-47d9-923e-532e10992acc` | `c6e80833-f81c-4f5a-8818-75dc96afda62` |

Hai con cùng executor `mac-claude-2` / `c452d003-6a7c-4820-9c7a-91d5f762d734`, environment `5e7aa9c4-531c-4fe8-a6d5-fcd4816a244e`, Sonnet5/medium. Gốc Opus5. Trợ Lý tự đăng `crew-plan root=CRE-47 children=2 bundles=1` (comment `a99d5fb4-5e85-4b2a-8e25-7e578af4f7df`,20:33:45.905), rồi tự tạo A20:34:11.607 và B20:34:41.850. Marker `crew-bundle id=greet-all-resume seq=1/2`; B có `crew-stack on=CRE-48`, API `blockedBy` xác nhận trực tiếp A.

### Kết quả đo

| Phép đo thuộc 4a.5 | Kết quả | Bằng chứng thực |
|---|---|---|
| Hai con cùng gói/cùng executor, seq1/2 và blocker | ĐẠT | Marker, overrides, blockedBy và kế hoạch trước create ở trên. |
| A bị hủy do chính executor bàn giao reviewer | ĐẠT | `cancelled`, `error_code=issue_reassigned`, nguyên văn `Cancelled before issue reassignment`; before/after A null, vẫn có UUID trong init. |
| Snapshot B trỏ run A | ĐẠT | `resumeFromRunId=2e6b327e-05bb-418e-8f4c-2378e379fe84`. |
| Params B mang UUID init A | ĐẠT | `resumeSessionParams.sessionId=0c9a1b50-c23f-4911-90c1-a7f341302917`, `session_id_before` B cùng UUID. |
| `mcpServerIdentity` không rỗng | ĐẠT | String JSON chứa 2 entry Paperclip projects/Paperclip connections; params trích dưới. |
| argv thực B có --resume đúng UUID | ĐẠT | `adapter.invoke`20:39:05.710, đúng1 invoke trên B, argv dưới. |
| init B báo session_id cùng A | ĐẠT | Cả2 init `0c9a1b50-c23f-4911-90c1-a7f341302917`, model `claude-sonnet-5`, cwd Mac executor2. |
| Tiếp tục ngữ cảnh, không session-not-found | ĐẠT | B nhắc đúng bước1 rồi sửa/kiểm README;0tool/runtime error trong excerpt B; stderr chỉ workflow ok. |
| Audit resume đúng1 lần | ĐẠT | `crew.bundle_resume`20:38:41.564366, entity B, fromIssue A/toIssue B/bundle đúng. |
| Dọn | ĐẠT |3issue cancelled,0run active toàn company,0lease chưa release;5remote-stop remaining0. |

Snapshot B (không credential):

```json
{
  "resumeFromRunId": "2e6b327e-05bb-418e-8f4c-2378e379fe84",
  "resumeSessionParams": {
    "cwd": "/paperclip/instances/default/workspaces/c452d003-6a7c-4820-9c7a-91d5f762d734",
    "sessionId": "0c9a1b50-c23f-4911-90c1-a7f341302917",
    "remoteExecution": {
      "host": "100.102.189.67",
      "port": 2222,
      "username": "phannhatquang",
      "remoteCwd": "/Users/phannhatquang/crew-agents/mac-claude-2",
      "transport": "ssh"
    },
    "mcpServerIdentity": "[{\"name\":\"Paperclip projects\",\"url\":\"http://100.105.105.12:3100/api/mcp/project-tools\",\"connectionId\":\"paperclip-project-tools\"},{\"name\":\"Paperclip connections\",\"url\":\"http://100.105.105.12:3100/mcp/runtime-tools\",\"connectionId\":\"paperclip-runtime-tools\"}]"
  }
}
```

`adapter.invoke.commandArgs` B nguyên mảng (command wrapper qua SSH Mac2222):

```json
["--print", "--output-format", "stream-json", "--verbose", "--resume", "0c9a1b50-c23f-4911-90c1-a7f341302917", "--dangerously-skip-permissions", "--model", "claude-sonnet-5", "--effort", "medium", "--mcp-config", "/Users/phannhatquang/crew-agents/mac-claude-2/.paperclip-runtime/claude/mcp-config/mcp-config.json", "--strict-mcp-config", "--add-dir", "/Users/phannhatquang/crew-agents/mac-claude-2/.paperclip-runtime/claude/skills", "--setting-sources", "project,local", "--plugin-dir", "/Users/phannhatquang/.crew/workflows/superpowers/6.4.1-5bf4e7801107"]
```

Trích nguyên văn lời B:

> Nhắc lại: bước 1 (CRE-48) em đã sửa `greetAll(names, lang = "vi")` để truyền `lang` xuống `greet` cho từng tên, giữ fallback như `greet`, đã được reviewer duyệt. Giờ sang bước 2: cập nhật README.

Không dùng riêng câu này để chứng minh resume: kết luận dựa đồng thời snapshot, argv `--resume` và UUID init bằng nhau. B đã commit README `aaec947a01cbdfb9315b68e8d991e8be461ac8ec`; A commit `426fb556a10eab089ed7050c9e207ec30677cf85`, reviewer đã approve (comment `6ed50354-d3fc-4c78-a355-dbf2ee932796`20:38:38.925). Không chờ reviewer B, owner, integrator hay push.

**Giới hạn before/after:** A `session_id_before=null`, `session_id_after=null` vì bị hủy; B `session_id_before=0c9a1b50-c23f-4911-90c1-a7f341302917`, `session_id_after=null` vì board hủy sau phép đo. Không báo cột after đã persist hay task session executor A/B đã được upsert: DB task-session của executor trên2con vẫn0. Theo chỉ định lần5, bằng chứng chạy thực là init B cùng UUID và tiếp tục ngữ cảnh trước cancel; không đòi after khi run bị hủy.

### Thứ tự wake/stage/lease

Mọi giờ dưới đây UTC+07; [timeline đầy đủ](reports/ac-3-r5-timeline.md) giữ ID wake/lease và các sự kiện khác.

| Giờ | Sự kiện |
|---|---|
|20:34:12.670|A bắt đầu.|
|20:34:41.992 /20:34:50.672|Wake B skip `issue_dependencies_blocked`, chưa có run B.|
|20:37:16.131|A cancelled `issue_reassigned` sau executor PATCH done.|
|20:37:16.337 → .360|Wake reviewer skip `execution_reconciliation_required`; lease A còn giữ.|
|20:37:21.290|Lease A `ec639096-2626-4bc1-80cd-7ce513264e9b` ghi released_at, status expired.|
|20:37:21.391 →20:37:22.966|Wake review phát lại → reviewer run mới. Activity handoff_rewake20:37:22.986.|
|20:37:26.123|Remote-stop A stopped/remaining0.|
|20:38:38.925 →20:38:39.033|Reviewer approve A → wake B `issue_blockers_resolved`.|
|20:38:41.564 → .601|Ghi bundle_resume → B bắt đầu.|
|20:38:43.464|B lấy lease `e0a19f32-2fbd-49ea-a311-471ae7d04d11`.|
|20:38:54.992 →20:38:55.229|Reviewer kết thúc → lease reviewer release; B đã chạy vì dùng environment khác.|
|20:39:05.710|Invoke B --resume đúng UUID A; init B xác nhận cùng UUID.|
|20:41:09.450 /20:41:11.540 /20:41:12.836|Board cancel gốc/B/A; B run terminal20:41:11.571.|
|20:41:26.733 →20:41:32.043|Lease B release → remote-stop stopped/remaining0.|

Nguyên văn lỗi wake bị skip (được hệ thống phục hồi, không cần tay):

```text
The previous execution has not released its environment lease. Wait for cleanup before continuing this task.
```

### Lệnh và số liệu DB

API bằng shim board user chỉ định, argv Python subprocess (không nội suy JSON vào shell): POST `/companies/5befeb1a-1578-4656-b913-267494592e53/issues` đúng1gốc; GET `/issues/:id`, `/comments`, `/heartbeat-runs/:id/events?limit=1000`, `/log?offset=N&limitBytes=256000`; PATCH `{"status":"cancelled","comment":"…"}` cho3issue. Payload tạo nằm trong [evidence](reports/ac-3-r5-evidence.json). Không tạo key, không đặt PAPERCLIP_RUN_ID, không giả actor agent.

DB chỉ SELECT qua `ssh nhamoiplatform`, cwd `/opt/crew-v3-spike`, `docker compose exec -T db psql -v ON_ERROR_STOP=1 -U paperclip -d paperclip -Atc '<SQL>'`; backup dùng pg_dump như trên. Các truy vấn quyết định:

```sql
SELECT id,status,error_code,session_id_before,session_id_after,
 context_snapshot->>'resumeFromRunId',context_snapshot->'resumeSessionParams'
FROM heartbeat_runs WHERE id IN ('2e6b327e-05bb-418e-8f4c-2378e379fe84','c6e80833-f81c-4f5a-8818-75dc96afda62');
SELECT count(*) FROM agent_task_sessions
WHERE agent_id='c452d003-6a7c-4820-9c7a-91d5f762d734'
AND task_key IN ('974d8644-c4b6-4388-8778-aeb0a409af60','90fdfdf7-3042-47d9-923e-532e10992acc'); -- 0
SELECT count(*) FROM activity_log
WHERE action='crew.bundle_resume' AND entity_id='c6e80833-f81c-4f5a-8818-75dc96afda62'; -- 1
SELECT count(*) FROM heartbeat_runs WHERE company_id='5befeb1a-1578-4656-b913-267494592e53'
AND status IN ('queued','running'); -- 0
SELECT count(*) FROM environment_leases WHERE company_id='5befeb1a-1578-4656-b913-267494592e53'
AND created_at >= '2026-10-08T13:31:07Z' AND released_at IS NULL; -- 0
```

5run thực:3succeeded (2Trợ Lý+1reviewer),2cancelled (A issue_reassigned,B board cancel).0run integrator. Hai con không chạy chồng nhau trên executor. Poll chủ yếu30–60giây, không run kẹt30phút; không lỗi quota.

### Can thiệp tay, quan sát phụ và dọn

- **Không có thao tác tay làm đạt 4a.5.** Runner chỉ tạo gốc board với ràng buộc2bước và đường CLI docs/workflow có sẵn, quan sát rồi cancel. Không tạo hộ con, ép done, sửa snapshot/session/DB/agent config, comment hỗ trợ giữa luồng hay đánh thức hộ reviewer/executor. TCC do owner Allow trước lượt là sửa tiền điều kiện, đã ghi riêng.
- Lỗi shell nguyên văn trong A: `(eval):1: == not found` do lệnh hiển thị của agent; agent tự tiếp tục,36test xanh và reviewer duyệt. B không có lỗi tool/runtime; stderr A/B chỉ `crew-workflow ok pin=superpowers@6.4.1 project=0 pinned-dup=0`. Không có lỗi session-not-found hay từ chối MCP trong B.
- Recovery stock đổi gốc sang blocked20:38:50, comment `Paperclip could not resolve this issue's missing disposition automatically. The source assignment is unchanged and a board decision is required.`; không sửa tay vì ngoài phép đo và không chặn con B. Continuation Trợ Lý có before/after khác nhau, không dùng run đó làm chứng cứ nối session giữa executor; không kết luận thêm lỗi code ngoài4a.5.
- Kiểm20:41:45:3issue cancelled,0active run,0lease chưa release,5remote-stop stopped/remaining0. ps đúng5PID Claude trước lượt58305/49360/79225/80511/72637; không kill process owner. Không process nền runner.
- Giữ2commit và nhánh `crew/cre-48`,`crew/cre-49`; executor git status sạch. B đăng crew-commit20:41:13.693 trong khoảng cancel→remote-stop; không có stage reviewer B/run mới. Runner chỉ đọc git status/log tại crew-agents, không sửa/dọn worktree/runtime files.
- Origin/main giữ `5bcc3034837f1aa2762f565ca1e381c22672bb16`; owner-wip SHA256 giữ `df2eb96d9f84ab66c8140324b7e9f4700f6404c82fe5499771f64f1941d598b7`, checkout owner chỉ `?? owner-wip.txt`. Fork sạch,HEAD d457ddbfd.5environment giữ nguyên,load16 giữ nguyên cho lead trả sau.
- Không sửa code Crew/fork, không commit/push/deploy, không sửa policy/instructions/secret, không xóa environment. Không chạy build/typecheck/repo test vì chỉ đo runtime4a.5 và không đổi code. Backup/scratch/artifact ghi trong processes.md.
- Báo cáo/evidence/timeline được bàn giao bằng attachment + artifact work product trên CRE-47 qua API board; receipt `reports/ac-3-r5-artifact-receipts.json`. Dùng board thay helper cần PAPERCLIP_RUN_ID theo luật lượt này; final comment giữ cancelled, có link download.

**Concerns:** không phát hiện lỗi code mới trong4a.5. Concern C4 của lần4 (`server/src/crew/bundle-resume.ts` / `sessionFromRun`, `findBundlePredecessor`; `packages/adapters/claude-local/src/server/execute.ts` / `execute`, guard `hasMatchingMcpServers`/`canResumeSession`) **không còn tái hiện ở ca máy thật này**: identity có giá trị, adapter chấp nhận resume, CLI giữ đúng session. Đây là xác nhận happy-path được chỉ định, không phải tái nghiệm thu toàn bộ ca âm/guard.
