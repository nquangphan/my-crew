# Báo cáo S4 — T3-S1: server `createRun` graph và `latchRenderedArtifact`

Worker: s4-t3s1 (Claude Opus 5.5). Worktree `/Volumes/CORSAIR/Projects/my-crew-v2`, nhánh `codex/crew-v2-server`. BASE `3f27527`; HEAD trước commit `1dc0fcc`, commit lát `0d4f984` (chỉ docs/web của worker khác chen vào; `server/src` khác BASE ở đúng `tickets/dependencies.ts` của G1a2, không giao với lát này). Node v24.21.0, pnpm 10.32.1.

## Kết quả

**DONE.** `createRun(tx, proof, {rootTicketId, path, definitionSha256})` dựng run graph cho 4 path Superpowers và 2 path BMAD từ definition mà máy B đã chứng minh trong install report. Mọi ticket con và cạnh đi qua graph authorization mới của port S2: một operation pending `create_run` authorize đúng một tập đã băm, dùng một lần. `latchRenderedArtifact(tx, runId, evidenceId)` ghim render receipt BMAD một lần. Production vẫn bị từ chối: port và resolver chưa được inject vào app, và không có receipt PASS nào.

Test: GREEN cuối 211/211 (8 workflows mới, 41 port gồm 7 mới, cùng các bộ S1/S2/B1/B2a). Hồi quy 102/102. Scoped strict tsc exit 0, output rỗng. Biome exit 0, 0 warning trên 5 file sở hữu. `crew-docs check --all` và `--staged` ok.

## Phần 1 — Port delta (re-release `orchestration.ts` theo ruling 17:35, phương án B)

API mới, chỉ cộng thêm. `createProjectOrchestrationPort` giờ trả `WorkflowOrchestrationPort`, tức `ProjectOrchestrationPort` cộng thêm `authorizeGraph`. Các type mới: `RunGraph`, `RunGraphSession` và `runGraphSha256(graph)` = SHA-256 canonical của `['crew-v2:orchestration-graph:1', graph]`.

- `authorizeGraph(tx, actor, proof, graph, graphSha256)`:
  - Port chụp snapshot đồng bộ rồi kiểm shape. Ticket phải là `step` con trực tiếp của root. Key là UUID chữ thường, không trùng. Cạnh chỉ nối hai ticket của graph, không tự nối, không lặp. Sai shape trả 400.
  - Hash lệch payload trả 403 `ORCHESTRATION_SCOPE_INVALID` trước mọi truy vấn.
  - Thứ tự khóa root → project, rồi đến resolver.
  - Scope phải là root scope đúng root và project. `tool_names` phải có `create_run`; `actions` phải có `create_ticket`, và có thêm `dependency` nếu graph có cạnh. Thiếu thì trả 403 `ORCHESTRATION_ACTION_NOT_IN_SCOPE`.
  - Operation phải là row pending của cùng turn, ghi trong chính Tx (`xmin`), nếu không thì 404. Snapshot lệch trả 409.
  - Operation bị tiêu trong **cùng** tập `consumed` với mutation đơn lẻ. Vì vậy hai loại không thay thế lẫn nhau: dùng chéo trả 409 `ASSISTANT_OPERATION_CONSUMED`.
  - Mỗi Tx chỉ có một graph.
- Session:
  - `createTicket(tx, key, input)` và `dependency(tx, ticketId, predecessorId, expectedRevision)` vẫn gọi entry scoped của `server-tickets`. Binding mang `element` để `verify` đi nhánh graph.
  - Tx khác hoặc session đã đóng trả 404 `ASSISTANT_OPERATION_NOT_FOUND`.
  - Key lạ, input khác hash, cạnh không có trong tập hoặc ticket ngoài graph trả 403 `ORCHESTRATION_TARGET_NOT_AUTHORIZED`. Phần tử đã dùng trả 409 `ORCHESTRATION_TARGET_CONSUMED`.
  - Mỗi phần tử resolve lại Actor, kiểm lại action của scope và membership root.
  - `close(tx)` trả 409 `ORCHESTRATION_GRAPH_INCOMPLETE` khi còn phần tử chưa dùng.
- Không mint tool operation phía server, không đi vòng port. Nhánh mutation đơn lẻ giữ nguyên từng dòng; nhánh graph chỉ chạy khi binding do session tạo.
- Test port mới (7):
  - happy path;
  - hash lệch → 403, không có row;
  - ngoài tập → 403 (4 biến thể);
  - dùng lại ticket/cạnh → 409, và `close` khi chưa đủ → 409;
  - operation đã commit từ Tx trước → 404, session mang sang Tx khác → 404;
  - `create_run` không làm mutation đơn lẻ được và ngược lại → 409;
  - thiếu tool `create_run` hoặc thiếu action → 403.

## Phần 2 — S4

**`workflows.ts`:**
- `createDefinitionLookup()` chỉ đọc `gateway_applied.workflow_status` của máy B (FOR SHARE), không suy gì từ applied revision. Điều kiện để chấp nhận một definition:
  - slot projection và slot source đều `current`;
  - `projection.runtime` khớp slot và `sourceTreeSha256` khớp source;
  - skills đúng shape, customization là hex64;
  - BMAD chỉ ở `claude` và bắt buộc có `render`; Superpowers không có `render`. `render.source/projection` phải bằng pin của slot;
  - digest tính lại bằng `{source, projection, skills, customizationSha256, render}` (cùng công thức `definitionMatches` của S3b) phải đúng hash;
  - phải có đúng một kết quả khớp.
- `workflowSteps(path)` là bảng ánh xạ có trích dòng nguồn.
- `stepSources` báo 422 khi definition thiếu nguồn của một bước.

**`runs.ts` — `createWorkflowRuns({port, resolver, lookup?})`:**
- `createRun`:
  1. Kiểm input, khóa root (phải là request) rồi project, sau đó mới gọi resolver. Actor luôn là machine A do resolver trả.
  2. Tra lookup theo `projects.machine_id` (máy B).
  3. Kiểm path ↔ workflow, nguồn của từng bước, pin và `workflowChoice` của root; root đã có run trả 409.
  4. Đọc duyệt song song.
  5. Lên graph, gọi `authorizeGraph`, rồi insert `workflow_runs` (revision 1, `rendered_artifact_id` null).
  6. Với mỗi bước: session tạo ticket, insert `workflow_steps`, rồi ghi `assistant_operation_ids` (`create_ticket`, target = ticket ID).
  7. Với mỗi cạnh: session tạo dependency (revision được theo dõi), rồi ghi operation `dependency` riêng.
  8. `close`.
  - `precondition_sha256` là hash graph. `effect_id = sha256(canonicalJson([runId, stepOperationId, actionKind, targetIdentity, preconditionSha256]))`, cùng thứ tự với `deriveEffectId` của gateway.
  - Gate UUID nằm trong `workflow_steps.gate_ids` và trong `criteria.workflowRun.gates` của ticket (kèm kind, requiredActor, citation). Không insert `workflow_gates`.
- Duyệt song song lấy `assistant_config.policy.parallelApprovalId`:
  - phải là quyết định `approval` của owner trong cùng root, nếu không thì 403;
  - `scope.parallel` phải khớp root/path/definition, có 2–16 phần, nếu không thì 409;
  - path chỉ được `architectural` hoặc `bounded`, nếu không thì 409;
  - trùng ownership key trả 409;
  - khi hợp lệ, bước implement tách thành từng phần và review join đủ các phần.
- `latchRenderedArtifact`:
  - Từ chối path không phải `bmad-*` (409 NOT_REQUIRED) và run đã latch (409 ALREADY_LATCHED).
  - Evidence phải có kind `workflow_render_receipt` và có attempt.
  - Attempt phải thuộc ticket bước của chính run, cùng `machine_id` và `binding_revision` hiện hành của project.
  - `definitionSha256` và `customizationSha256` phải khớp run.
  - `generationPath` phải đúng `{projectRoot}/_bmad/render/bmad-build/{slug}-{sha256(root)[:12]}/{20hex}`, cùng thuật toán slug với D1.
  - Mọi lệch khác trả 409 `WORKFLOW_RENDER_RECEIPT_INVALID`.
  - Đúng thì UPDATE có điều kiện `rendered_artifact_id is null`, revision tăng 1.

### Ánh xạ nguồn → bước/gate (bytes đã đọc từ archive pin)

Archive fixtures: `superpowers-6.4.2.tgz` SHA `29714b2c…331a` (= `payloadSha256`, revision `8ca22dba…`), `bmad-6.12.0.tgz` SHA `ac05c93f…4aed2` (revision `05bfbd46…`). Source SHA của từng bước lấy từ `definition.skills` trong vector S3b (`install-report-vector.json` SHA `1bd0a6df…28d1`), test kiểm khớp từng bước.

| Path | Bước → source (dòng) | Gate (owner) |
|---|---|---|
| architectural | design `skills/brainstorming/SKILL.md:81-84,129-134,171-176` → spec `:135-138,237-261` → plan `skills/writing-plans/SKILL.md:179-204` → implement `skills/test-driven-development/SKILL.md:31-34` → review `skills/requesting-code-review/SKILL.md:12-18` → verify `skills/verification-before-completion/SKILL.md:14-36` | `design_approval` (brainstorming `:45-49,134,174-176`), `spec_approval` (`:46-49,256-261`), `plan_approval_execution_method` (writing-plans `:181-198`) |
| bounded | design `brainstorming:71-80,122-127` → implement → review → verify | `design_approval` (`:45,76-80,126`) |
| bug | root_cause `skills/systematic-debugging/SKILL.md:14-20,48-119` → pattern `:120-142` → hypothesis `:143-167` → fix `:168-196` → review → verify | `architecture_discussion` trên fix (`:190-212`) |
| spike | probe `brainstorming:65-70,115-118` → investigate `:119-120,188-189` (cả hai ticket `research`) | `probe_approval` (`:44,118`) |
| bmad-dispatch | `.claude/skills/bmad-build/step-01-clarify-and-route.md` → `step-02-plan.md` → `step-03-implement.md` → `step-04-review.md` → `step-05-present.md` (`workflow.md:82-84`) | `spec_approval` trên step-02 (CHECKPOINT 1, `step-02-plan.md:36-58`) |
| bmad-oneshot | step-01 → step-02 (thoát sớm `step-02-plan.md:20`) → `step-oneshot.md` | không có (nguồn không có checkpoint) |

## TDD: RED → GREEN

| Lượt | Lệnh/tệp | Kết quả | Log SHA-256 |
|---|---|---|---|
| RED run1 | workflows + port | tests 42, pass 34, fail 8. Port: 7 test mới fail semantic (`Error: NOT_IMPLEMENTED` ≠ mã mong đợi); 34 test S2 cũ pass. Workflows: **lỗi nạp file** (`await` trong arrow không async ở test latch), không phải semantic; đã sửa test và chạy lại | `f5bd7675…0cab` |
| RED run2 | workflows | tests 8, fail 8, cả 8 đều semantic (`createRun` scaffold ném `NOT_IMPLEMENTED`) | `5585a960…e109` |
| GREEN run1 | workflows + port | 49/49 | `abd35eef…fb9e` |
| GREEN | 8 tệp (workflows, authority, port, mutations, orchestration, tickets, deploy, dependencies) | 211/211 | `3e7c3d53…93d0` |
| Hồi quy | api-acceptance, assistant-store, attachments-routing, attachments-snapshots, attempts, completion, docs-read, repair | 102/102 | `07a48ffb…6add` |
| GREEN final (source cuối sau Biome format và 2 sửa lint) | như GREEN | 211/211, exit 0, 49,1 s | `fb517776…b6aa8` |

196 test S2 cũ cộng 7 port và 8 workflows mới bằng 211. Bộ hồi quy 102 không phụ thuộc `runs.ts` nên không chạy lại sau sửa lint.

Lệnh test: `NODE_OPTIONS=--max-old-space-size=384 CREW_V2_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/crew_v2_test CREW_V2_TEST_CONTAINER_ID=<id> node --test --test-concurrency=1 --test-timeout=120000 <files>`.

Typecheck (exit 0, log rỗng `e3b0c442…`): `pnpm --dir v2/server exec tsc --noEmit --ignoreConfig --skipLibCheck --target ESNext --module NodeNext --strict --allowImportingTsExtensions --erasableSyntaxOnly --verbatimModuleSyntax --types node src/platform/picomatch.d.ts src/platform/thread-stream.d.ts src/attachments/extract/yauzl.d.ts src/assistant/{workflows,runs,orchestration}.ts test/assistant-{workflows,orchestration-port}.test.ts`.

Biome: `pnpm dlx @biomejs/biome@2.5.14 check` trên 5 file (log `3864fb5d…4bc5`: "Checked 5 files… No fixes applied", 0 warning). Lượt đầu có 2 warning `useOptionalChain` trong `runs.ts`; đã tách guard tường minh. Dòng `biome-write=1` trong lượt cuối chỉ là exit của phép thử `[ write ]` trong script, không phải exit của Biome.

Source SHA cuối:

| File | SHA-256 |
|---|---|
| `server/src/assistant/workflows.ts` | `d62ff462…a300` |
| `server/src/assistant/runs.ts` | `c441df5e…2e59` |
| `server/src/assistant/orchestration.ts` | `76e12dad…b13b` |
| `server/test/assistant-workflows.test.ts` | `5be64d5a…f21b` |
| `server/test/assistant-orchestration-port.test.ts` | `1a89e465…22e4` |

## Tài nguyên và dọn dẹp

- Mỗi lượt nặng lấy `$TMPDIR/crew-v2-heavy-slot.lock` (owner `s4-t3s1`). Script đọc JSON telemetry và chỉ chạy khi `heavyEligible=true`, cả trước khi tạo PG lẫn trước khi chạy Node. Mọi lượt đều eligible: pressure 1, available 4,86–5,15 GiB, idle 75–84 %.
- PG `postgres:18.6` local, 256m / 1 CPU / pids 64, loopback ngẫu nhiên (26288, 27462, 38868, 20372, 27057, 43225; không dùng 5432/55432). Container `crew-v2-test-<uuid>`, `--rm`.
- Sau mỗi lượt:
  - `crew_v2_test_%` còn 0;
  - `docker stop` đúng ID, `docker ps -a --filter id` rỗng;
  - không còn `node --test` của lát này. Hai process `node --test` thấy được là của worker web S3b, không động vào.
- Script ban đầu đặt trong scratchpad của session. PM báo `retry.sh` đã đè script cùng tên của S3b, nên đã chuyển sang `$TMPDIR/crew-v2-s4-t3s1/` và xóa bản ở scratchpad.
- Docs: mirror `git archive HEAD:v2` trong `$TMPDIR/crew-v2-s4-t3s1/mirror`, overlay 8 file của lát. `crew-docs generate` cập nhật `docs/files.md` (3 dòng). `check --all` và `check --staged` ok.
- Manifest sửa dưới `$TMPDIR/crew-v2-manifest.lock` từ lúc đọc HEAD tới commit.

## Self-review

- Đã kiểm import: mọi import tương đối của 5 file trỏ tới file đã track hoặc file mới commit cùng lát.
- Lệch TDD cần nêu: bản nháp `workflows.ts`/`runs.ts` và delta port được viết trước test, sau đó cất ra ngoài; RED chạy trên scaffold `NOT_IMPLEMENTED`, rồi khôi phục bản nháp. GREEN qua ngay lượt đầu. Reviewer nên đọc test độc lập với source.
- Bước implement của architectural/bounded dùng nguồn TDD vì cả hai phương pháp thực thi đều bắt buộc TDD (`brainstorming:127`). Phương pháp (subagent-driven hay executing-plans, `writing-plans:200-204`) là lựa chọn ở gate kế hoạch và dùng lúc dispatch. Đây là quyết định ánh xạ cần reviewer official-source xác nhận.
- Latch chưa đối chiếu `projectRoot` với workspace thật vì server chưa có bản ghi workspace. Hiện chỉ kiểm tính nhất quán root ↔ generation path, máy, binding, attempt và definition. Ràng buộc với workspace thuộc S6 (`registerRenderReceipt`).
- `parallelApprovalId` là policy toàn cục: nếu trỏ vào quyết định của root khác thì mọi `createRun` khác đều bị 403 (fail closed) tới khi owner xóa policy.
- Không chạm `gates.ts`, app wiring, migrations, `tickets/*`, web/gateway hay `authority.ts`; không sửa `test/support/assistant.ts`.

## Câu hỏi mở

1. Xác nhận ánh xạ implement → `test-driven-development` (thay vì cố định SDD/executing-plans) cho architectural/bounded.
2. `parallelApprovalId` toàn cục chặn root khác: có cần T7/S5 chuyển sang tra theo root không.

---

# FIX round 1/5 (review `task-3-s1-review.md`, ruling 20:45)

Commit `e4b8cd3` trên HEAD `5b0c76d`. Lần này test được viết trước source thật (W8). Chỉ có hai thứ tạo trước RED:
- module hợp đồng `operation-request.ts`, vì công thức hash đã được ruling cố định nguyên văn và fixture cần nó để ghi row;
- scaffold `createRunRequest` trả digest giả `0…0` và type `CreateRunRequest`, không có hành vi thật.

## Mục đã sửa

| Mục | Sửa |
|---|---|
| I1 + W1 | Module dùng chung `server/src/assistant/operation-request.ts` export `OperationRequest` và `operationRequestSha256 = sha256(canonicalJson({action, payload}))`. Port so `request_hash` cho mọi authorization; lệch trả 403 `ORCHESTRATION_REQUEST_MISMATCH`. Thứ tự kiểm: op 404 → snapshot 409 → đã dùng 409 → hash 403 → tiêu. Mutation đơn lẻ dùng exact payload đã submit. `authorizeGraph(tx, actor, proof, request, graph)` không còn nhận digest từ caller: port tự tính `runGraphSha256(graph)` và đòi `request_hash` của `{action:'create_run', payload:{rootTicketId, path, definitionSha256, graphSha256}}`. Mọi ID của run được dẫn xuất từ `operationId`, nên graph là hàm thuần. `runs.createRunRequest(tx, operationId, input)` là điểm B3 gọi để băm row. Fixture `seedToolOperation` nhận `request`; test port ghi row lười ngay trước lời gọi port với hash của đúng lời gọi đó. Test cũ không bị nới assert nào. Test `:914` đổi tên thành "one operation is consumed once per transaction across graph and single paths"; mục 11/12 của flow `server-assistant` đã viết lại cho khớp code. |
| I2 | Architectural: design → spec → plan (`writing-plans`) → execute (source `skills/writing-plans/SKILL.md`, `executionChoices` = subagent-driven-development / executing-plans kèm SHA, `resolvedByGateId` = gate kế hoạch, chưa resolve thì chưa dispatch) → finish (`finishing-a-development-branch`). Bounded giữ TDD (`brainstorming:127`). `stepSources` đòi đủ nguồn của cả hai lựa chọn. |
| I3 | Quyết định của root khác thì trả `null` (chạy tuần tự). Trong cùng root, quyết định không phải `approval` của owner vẫn 403. Theo W7, duyệt song song lúc tạo run chỉ dành cho `bounded`; architectural trả 409 vì cần kế hoạch đã viết. |
| W3 | Tập đã dùng nằm trong setting cục bộ của transaction (`crew.assistant_consumed_operations`), thay cho WeakMap theo object Tx. Mọi handle savepoint đều thấy; savepoint rollback thì trả operation lại cùng các ghi của nó. |
| W4 | `createRun` ghi trong `tx.savepoint`: lỗi JS của port hay lỗi DB sau lần ghi đầu đều rollback hết, caller vẫn commit được. |
| M1 | Latch đòi attempt `active`; thêm test lệch `binding_revision` và attempt `uncertain`. |
| M2 | Gate mang `trigger` (`on_stage` / `after_three_failed_fixes`); gate `architecture_discussion` có trigger thứ hai. |
| M3 | Test không chép bảng nữa: đọc dòng trích dẫn từ archive pin bằng `tar` và kiểm marker gate. Execution choices lấy từ dòng `REQUIRED SUB-SKILL`, finishing lấy từ handoff `Final review clean`, chuỗi BMAD lấy từ `FIRST STEP`/`NEXT`/`EARLY EXIT`, bốn pha bug lấy từ heading `### Phase N`. Spike được assert kind `research`, role `research` và outputKinds không có code/test. Citation BMAD đổi sang đường dẫn đầy đủ. |

## Test mới

- Port (+3, tổng 44):
  - request hash lệch (graph bị đổi, path khác) → 403, không có row;
  - tách miền: op của tool khác → 403 cho cả graph lẫn mutation đơn; op `create_run` cho `createTicket`/`decision` → 403; op `create_ticket` cho graph → 403; payload hoặc action đơn lẻ khác → 403;
  - dùng một lần qua hai savepoint → 409.
- Workflows (+3, tổng 11):
  - `createRun` chỉ nhận đúng op của mình: tool khác, mutation đơn, path khác, digest do caller chọn, digest của op khác → 403, không có row;
  - all-or-nothing với hai nhánh: lỗi JS tiêm vào port và lỗi DB qua trigger test-only; caller commit được marker, không còn row nào của run, root vẫn tạo run được sau đó;
  - quyết định song song của root khác → tuần tự.
- Test hiện có được viết lại theo mapping mới và oracle archive.

## RED → GREEN

| Lượt | Kết quả | Log SHA-256 (16 ký tự đầu) |
|---|---|---|
| RED (`task-3-s1-fix1-red.log`) | 54 test, 38 pass, 16 fail. Port: 9 fail vì chữ ký cũ trả 400, thiếu rejection 403/409, savepoint không 409. Workflows: 7 fail vì thiếu rejection 403, thiếu citation, run dở còn sót (`WORKFLOW_RUN_EXISTS`), root khác 403 | `becad487f584e209` |
| GREEN lượt 1 lỗi nạp (dư dấu `}` trong `runs.ts`) | ghi lại, không tính | `338a9a5308aa2461` |
| GREEN lượt 1 | 54/54 | `360e42a3f4c12e38` |
| GREEN cuối, sau Biome format (8 tệp như vòng đầu) | 216/216 | `dd5751cf4795ded4` |
| Hồi quy (8 tệp như vòng đầu) | 102/102 | `8318da52a4739eac` |

216 = 196 test S2 cũ + 10 port graph/request + 10 workflows. Kiểm tra cuối:
- Scoped strict tsc trên 7 file cộng 3 file `.d.ts`: exit 0, log rỗng.
- Biome trên 7 file: 0 warning (`e8591378d95195a6`).
- `crew-docs check --all` và `--staged` ok trong mirror.
- Import untracked: chỉ trỏ tới `operation-request.ts`, file này được commit cùng lát.

Source SHA (16 ký tự đầu):

| File | SHA-256 |
|---|---|
| `operation-request.ts` | `4173a44a8664f455` |
| `orchestration.ts` | `653f3709de964fa2` |
| `runs.ts` | `300dbad1628c1184` |
| `workflows.ts` | `b9fac64d17583ee9` |
| `assistant-workflows.test.ts` | `68b755bf661be0c1` |
| `assistant-orchestration-port.test.ts` | `f4c4267258c69a8b` |
| `support/assistant.ts` | `829b127bcd117c77` |

## Tài nguyên

- Scratch riêng `$TMPDIR/crew-v2-s4-t3s1/`.
- Mọi lượt nặng giữ heavy lock và đều có `heavyEligible=true` trước khi tạo PG và trước khi chạy Node.
- 5 container `crew-v2-test-*` (256m, 1 CPU, pids 64, loopback ngẫu nhiên). Sau mỗi lượt: còn 0 DB `crew_v2_test_%`, container đã stop/rm, không còn `node --test` của lát này.
- Manifest sửa dưới lock và đã trả lock; mirror đã xóa.

## Còn lại / cần PM

- Test port giờ đi qua wrapper ghi row lười, đóng vai tools route. Riêng test snapshot đồng bộ gọi port thật với row ghi sẵn, để wrapper không che việc port tự chụp tham số.
- Theo W7, duyệt song song cho architectural lúc tạo run giờ trả 409. Đây là thu hẹp hành vi so với vòng đầu; tách unit sau written plan thuộc S5.
- `createRunRequest` đọc không khóa. B3 phải gọi nó trong cùng transaction rồi ghi row ngay, nếu không thì `createRun` dựng lại graph và trả 403 khi các row đã đổi.
- Deferred theo ledger: W2, W5, W6, W9, M4, M5.
