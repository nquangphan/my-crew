# Phase 02 Task 4 — báo cáo bàn giao

## Kết quả

Đã thêm migration 004, service factory và route ticket cho cây yêu cầu → bước → công việc; DAG phụ thuộc; timeline bình luận/quyết định; liên kết docs; kết quả repair; cổng hoàn tất đọc dữ liệu đã lưu. Không sửa platform/auth/Git/manifest, không commit. Các file của worker docs đang hoạt động được giữ nguyên.

## RED → GREEN

| Hành vi | RED quan sát | GREEN quan sát |
|---|---|---|
| Migration ticket | `MIGRATION_SEQUENCE_INVALID` khi fixture yêu cầu prefix 004 | Schema 8 bảng, fixture pass |
| Metadata journal | `EVENT_INVALID` cho `ticket.created` | Whitelist type/payload hẹp pass; text dư bị chặn |
| Cây/DAG | Test không nạp được `tickets/service.ts` trước triển khai | Request/step/task, hai cạnh đối nghịch một commit và một `DEPENDENCY_CYCLE` |
| Giả mạo quyết định owner | Máy ghi được `owner_answer` | `OWNER_DECISION_REQUIRED`, DB không có quyết định giả |
| Hoàn tất bước code | Code step bị `COMPLETION_GATE` vì chưa merge request | Bước đạt bằng code result verified của chính nó |
| Criteria evidence | Request thiếu `test_report` vẫn `done` | `requiredEvidenceKinds` thiếu trả `COMPLETION_GATE` |
| Fenced repair lặp | Fence cũ đọc lại cycle thành công | Xác minh attempt/fence trước lookup cycle, fence cũ bị chặn |
| JSON key kế thừa | `constructor.prototype` trong criteria được lưu | Trả 400 `VALIDATION` trước ghi |
| Merge commit | Request `done` nhưng `mergedCommit=null` | Cập nhật commit từ merge evidence verified |
| Docs link | Chưa có `linkDocs` | Mặc định thiếu reader trả 422, không chèn `ticket_docs` |
| Authority bất biến | Thay method trên object gốc làm service dùng callback mới | Factory giữ bản sao callback tại lúc tạo; ticket vẫn hoàn tất với callback ban đầu |

## Producer interfaces cho Task 5/7

`server/src/tickets/contracts.ts` xuất `TicketServiceDependencies`, `ExecutionAuthority`, `DocsCompletionReader`, `DocsSourceReader`. `createTicketServices(deps)` trong `service.ts` đóng băng một bản sao dependency; standalone `signalTicket`/`applyExecutionSignal` mặc định fail closed. Factory trả các method giữ signature đã đóng băng và thêm `applyExecutionSignal` nội bộ cùng `linkDocs`. `registerTicketRoutes(app,options,deps,servicesOrDependencies?)` giữ ba tham số đầu như hợp đồng; tham số 4 là service instance hoặc dependency object tùy chọn.

- `ExecutionAuthority.verifySignal(tx,ticketId,signal,evidenceId):Promise<void>`: Task 5 xác minh attempt/guard/confirmed stop trong cùng transaction. `applyExecutionSignal(...,'wait_owner')` gọi nó trước khi chuyển running → needs_input. `passed` chỉ qua method nội bộ và vẫn qua completion gate.
- `ExecutionAuthority.requestTerminalIntent(tx,ticketId,'needs_input',reason):Promise<void>`: Task 5 lưu `terminal_intent` và queue pause command trong bảng 005. Task 4 không có cột intent trong 004. Public `wait_owner` trên running và lần repair thất bại thứ 5 gọi callback rồi giữ `running`; Task 5 finalize nguyên tử sau khi chứng minh dừng.
- `ExecutionAuthority.verifyRepairResult(tx,input):Promise<void>`: Task 5 kiểm tra machine, attempt, fence và cycle trước khi Task 4 ghi kết quả; được gọi cả khi cycle đã tồn tại. Task 4 so attempt/classification/passed để trả cùng kết quả hoặc conflict.
- `DocsCompletionReader(tx,projectId,commit):Promise<string|null>`: Task 7 trả commit của snapshot docs đã xác minh, khớp commit merge đối với request code; mặc định null. Không query bảng 006 trước khi có migration.
- `DocsSourceReader(tx,projectId,snapshotId,path):Promise<boolean>`: Task 7 xác minh source docs cho decision và docs-link; mặc định deny.

Task 5/8 cần giữ quyền ghi `evidence.data.verification='verified'` ở verifier nội bộ; dữ liệu public/repair chỉ `reported`. Task 8 cung cấp xác minh merge thật. Task 4 không coi commit tự báo hoặc docs nhập cũ là bằng chứng hoàn tất.

## Kiểm chứng cuối

- `pnpm --dir v2/server test`: **81/81 pass**, 0 fail; dùng container PostgreSQL riêng và logical DB prefix `crew_v2_test_`.
- `pnpm --dir v2/server typecheck`: exit 0.
- `pnpm exec biome check` trên 15 file source/test sở hữu: exit 0.
- `git diff --check`: exit 0.

## Files sở hữu đã thay đổi

- `v2/server/migrations/004_tickets.sql`
- `v2/server/src/tickets/{contracts,service,dependencies,decisions,completion,repair,docs-links,routes}.ts`
- `v2/server/test/{tickets,dependencies,completion,repair}.test.ts`, `v2/server/test/support/tickets.ts`, `v2/server/test/ticket-events.unit.test.ts`
- `v2/server/src/journal/event-contracts.ts` (chỉ thêm type/payload metadata), `v2/docs/flows/server-journal.md` (R3)
- `v2/docs/flows/server-tickets.md`

## Tự rà soát và phần tích hợp còn lại

Đã rà scope máy theo project, root lock cho graph mutations, cycle CTE, revision fencing, public signal allowlist, owner-only decisions, metadata journal, reported-vs-verified evidence và sửa lặp không reset counter. Source refs docs và completion docs mặc định chặn; Task 5/7 phải nối callback thật. Chưa có consumer 005/006 nên chưa kiểm thử attempt finalization/snapshot bằng bảng thật. Cần review độc lập DAG concurrency, spoofing completion và callback integration trước khi Task 5 dùng module này. Controller sở hữu `v2/docs/flows.yaml`/generated docs/commit theo thứ tự.

## Fix round 1 — phản hồi review độc lập

Lượt sửa đầu xử lý bốn finding và thu hẹp finding deploy; re-review sau đó chỉ ra quyền deploy bị kế thừa quá rộng từ root. Bảng này ghi trạng thái lịch sử của fix round 1; fix round 2 bên dưới thay thế phần deploy. Đây là phần bổ sung sau kết quả 81 test của lượt triển khai đầu; lượt kiểm chứng toàn suite ở fix round 1 đạt **91/91**.

| Finding | RED quan sát | GREEN và cơ chế |
|---|---|---|
| P1 — thêm con sau khi hoàn tất | Test thêm step sau request `done`, task sau step `done` không bị từ chối; race completion/create cùng thành công | `createTicket` khóa root rồi đọc lại root/cha, từ chối `done/cancelled`. Completion cũng khóa root trước ticket; test tuần tự và hai transaction concurrent pass. |
| P1 — deploy thiếu owner intent | Test deploy không nạp được module chứng minh provenance; completion cũ coi request deploy bất kỳ là `hasDeployTicket` | Fix round 1 chặn machine deploy root và lưu provenance/hash nhưng cho deploy child kế thừa quyền owner root quá rộng. Re-review yêu cầu sửa tiếp; xem fix round 2. |
| P2 — dependency sửa sau ready | Test thêm cạnh vào target `ready` không bị từ chối và status vẫn `ready` | `addDependency` chỉ nhận target `pending/needs_input/paused` sau khóa root; test `ready/running` pass. Task 5 vẫn phải kiểm tra predecessor tại claim trong cùng transaction. |
| P2 — mất lý do vòng sửa thứ năm | Test internal finalize trả `owner_input` thay vì `repair_limit` | Public terminal intent và internal finalize giữ `repair_limit`; test pass. |
| P2 — owner answer cũ được tái dùng | Test owner answer trước thất bại vòng 5 vẫn mở resume | 004 lưu cycle/time đang chờ và decision đã tiêu; resume chỉ nhận `owner_answer` của chính cycle, ghi sau failure, tiêu một lần dưới root/step lock. Test answer sớm, hai resume đồng thời và replay sau failure mới pass. Counter giữ 5. |

Các lệnh kiểm chứng fix round:

- RED tập trung: `dependencies.test.ts` thấy ba lỗi cây/ready; `repair.test.ts` thấy lý do finalize sai; `deploy.test.ts` chưa có module. Lượt chạy test song song ban đầu có một lỗi môi trường PostgreSQL `57P03 database system is starting up`; chạy tuần tự các nhóm đã tái hiện lỗi domain nêu trên.
- GREEN tập trung: `pnpm --dir v2/server test --test-file .../dependencies.test.ts` **6/6**, `.../deploy.test.ts` **4/4**, `.../repair.test.ts` **1/1**.
- Sau khi ổn định, `pnpm --dir v2/server test`: **91/91 pass**, 0 fail, 0 skip; `pnpm --dir v2/server typecheck`: exit 0; `pnpm exec biome check v2/server/src/tickets v2/server/test/dependencies.test.ts v2/server/test/deploy.test.ts v2/server/test/repair.test.ts`: 12 file sạch; `git diff --check`: exit 0.

### Producer contract mới và chi phí schema

`server/src/tickets/deploy.ts` xuất `deployTicketFingerprint(input,rootId)` và `readDeployAuthorization(tx,ticketId): Promise<'owner_deploy_request'|'owner_approval'|null>`. Hash SHA-256 của canonical JSON `{action:'deploy',rootId,definition}` loại riêng `deployApprovalDecisionId`; `definition` giữ project, parent, level, kind, title, description, mandatory, criteria, inputs, outputs, skill và workflow pin hiệu lực. Approval pre-create nằm trên root với scope `{action:'deploy',rootTicketId,ticketDefinitionHash}` và được gắn một ticket qua unique FK. Approval cho ticket đã tồn tại nằm trên ticket với scope `{action:'deploy',targetTicketId,ticketDefinitionHash}`. Không nhận boolean/approval do client tự khai là bằng chứng.

Migration 004 thêm 7 cột ticket: `created_actor_kind/id`, `deploy_definition_hash`, `deploy_approval_decision_id`, `repair_limit_cycle_id/at`, `repair_limit_consumed_decision_id`; cùng unique/FK/check cần thiết. Đây là thay đổi hẹp trên schema 004 chưa phát hành, không tạo bảng/intent 005 hoặc reader 006. Task 5 phải dùng `readDeployAuthorization` trong transaction claim trước khi khởi chạy deploy, recheck predecessor `done` trong transaction đó, và nối terminal intent/finalize bằng callback authority thật. Task 7 cung cấp docs reader snapshot verified. Flow R3 đã cập nhật `v2/docs/flows/server-tickets.md`; controller cần ghi hai file nguồn/test mới vào `v2/docs/flows.yaml` và generate theo quyền sở hữu manifest.

Tự rà soát: hash cố định vào root và toàn bộ định nghĩa đầu vào có ý nghĩa, creator không đổi, approval được ràng buộc DB; code không đọc bảng 005/006 vắng mặt. Test callback của Task 4 chỉ chứng minh transaction/gate ticket, không chứng minh stop/fence/process hoặc docs checkout thật. Cần review độc lập lại diff fix round trước Task 5 integration.

## Fix round 2 — chặn deploy child kế thừa quyền root

Theo `task-4-re-review.md`, owner-created deploy request chỉ chứng minh owner intent cho **chính request đó**. Machine-created deploy step/task luôn cần owner approval cho fingerprint của chính child, kể cả khi root là deploy request owner tạo. `readDeployAuthorization` trả `owner_deploy_request` chỉ khi ticket được hỏi là root deploy request do owner tạo; mọi child chỉ có `owner_approval` khi decision gắn đúng root/hash hoặc owner duyệt trực tiếp ticket đã tạo. Owner-created deploy child hiện cũng cần approval rõ ràng trước claim/completion; việc owner tạo child không tự cấp quyền vì contract chỉ coi owner-created *request* là owner intent. Không suy diễn cùng hành động qua tiêu đề/text hoặc kế thừa quyền theo cây. Phase 09 có thể thiết kế `DeployAction` có kiểu và so canonical nếu cần cơ chế uỷ quyền hẹp hơn.

RED: `pnpm --dir v2/server test --test-file /Users/phannhatquang/.codex/worktrees/crew-v2-server/crew/v2/server/test/deploy.test.ts` đạt 3/4; test owner deploy root thất bại tại `Missing expected rejection` khi máy tạo child staging không approval. GREEN sau sửa `service.ts` và `deploy.ts`: **4/4**, gồm root tự có quyền, child không approval bị từ chối, approval staging không cho đổi title hoặc `inputs.target` sang production, child đúng fingerprint được tạo và reader trả `owner_approval`, owner-created child khác được tạo nhưng reader trả null. `pnpm --dir v2/server typecheck` exit 0; `pnpm exec biome check v2/server/src/tickets/deploy.ts v2/server/src/tickets/service.ts v2/server/test/deploy.test.ts` sạch 3 file; `git diff --check` exit 0. Không chạy lại toàn suite vì chỉ sửa điều kiện riêng `kind='deploy'` đã được focused DB test bao phủ; suite 91/91 ở trên là kết quả trước fix round 2, không ghi là mới.

Contract Task 5 giữ nguyên chữ ký `readDeployAuthorization(tx,ticketId)` nhưng nghĩa `owner_deploy_request` nay **chỉ áp dụng cho root chính nó**, không cho descendant. Trong claim transaction, Task 5 phải từ chối deploy nếu reader trả null; đồng thời recheck dependencies và proof attempt/fence như đã bàn giao. Flow R3 `v2/docs/flows/server-tickets.md` đã cập nhật. Chỉ ba file source/test deploy/service và flow/report thay đổi ở lượt này; chưa commit, chờ review độc lập.
