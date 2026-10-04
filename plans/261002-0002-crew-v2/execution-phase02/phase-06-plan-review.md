# Phase06 — independent whole-plan readiness review

Ngày: 2026-10-02. **READY: NO ở mức kế hoạch.** Có 4 findings Important cần sửa hẹp trước khi giao implementation. Không có kết luận implementation, model, certification hay live gate PASS.

## Phạm vi và bằng chứng

- Đọc đủ 288 dòng `phase-06-assistant-workflows.md`, đủ 73 dòng `plans/reports/research-261002-crew-v2-assistant.md`, approved spec và roadmap; đối chiếu các hợp đồng liên quan của phase02/03/04/05.
- Đọc `docs/index.md`, `v2/docs/index.md` và các flow server-platform, server-journal, server-tickets, server-execution, server-docs-import trước source. Worktree không có `.codegraph/`.
- Actual producer đối chiếu tại HEAD `9dca04e`: `platform/contracts.ts`, `tickets/{contracts,service,decisions,repair}.ts`, `execution/{contracts,commands}.ts`. Đọc Task5 final re-review và phase05 round2 re-review để phân biệt reviewed implementation với reviewed plan.
- Task5 đã COMPLETE/reviewed tại `9dca04e`; câu “Task5 đang sửa findings” ở plan:9 và research:67 là thông tin cũ, cần cập nhật nhưng không phải blocker kiến trúc. Phase05 được PM xác nhận frozen/approved; actual007–010 chưa có không tự nó là finding. Không đọc hoặc sửa công việc importer/native gateway đang chạy song song.
- Review dùng nghiên cứu official source đã có; không mở lại lựa chọn workflow/spec, không chạy installer, model, database test hay commit. Chỉ tạo báo cáo này.

## Findings

### R1 — Important: routing certification chưa có producer/bootstrap trước lượt đầu

**Vị trí:** plan:65–66,137,179,184,233–236; phase04:129–131 là contract đối chiếu.

`RoutingPolicyReceipt` chỉ có receipt cuối cùng; plan yêu cầu supervisor start/resume chỉ khi receipt PASS và `RoutingModelPort.assertCurrent` kiểm certificate đúng binary/policy/model. Tuy nhiên producer được mô tả duy nhất là “internal trusted assembly port, default deny”; không có typed issuer/challenge/evidence/verifier, trạng thái admission để chạy canary đầu tiên, persistence nonce/binding hoặc route/entrypoint cho quy trình đó. `assembleAssistant` cũng không nhận certificate issuer/verifier. T7 live gate bắt đầu bằng một **certified routing driver**, nên không tạo được bằng chứng để chứng nhận driver đầu tiên.

Phase04 không lấp được lỗ này: challenge/evidence của nó bind project/attempt/fence/SourcePin/ProjectionPin và có test-only admission cụ thể. Plan06 chủ động cấm dùng fake RuntimePin hoặc mượn workflow certificate cho inbox. `seedCertifiedRouting` chỉ là fixture và không thể là đường bootstrap thật.

**Failure cụ thể:** DB mới có designation và owner-authorized inbox image nhưng chưa có routing receipt. Admission/start bị chặn; live canary cũng cần driver đã certified; không có đường hợp lệ tạo PASS đầu tiên. Tự insert PASS hoặc lấy certificate04 sẽ phá trust boundary đã chốt.

**Sửa hẹp:** giao rõ T2/runtime owner thêm contract và file cho routing certification riêng: trusted issuance với nonce/expiry/bounded budget; exact machine/model/binary/policy/OS và routing process/turn identity; durable one-use admission cho scratch certification; evidence schema positive allowed docs/input/tools và negative native Read/child/path/tool surfaces; trusted verifier tạo receipt bất biến và quy trình đưa authority hợp lệ vào deployment. Không yêu cầu certificate trước chính canary đo certificate, nhưng chỉ bỏ qua điều kiện certificate trong scope test hữu hạn; giữ sandbox/auth/budget/fence. Chỉ rõ đường production vẫn default deny và không nhận test boolean/receipt từ test DB như quyền production.

**Test bắt buộc:** từ trạng thái không certificate chạy được đúng một bounded certification launch; replay đúng identity không launch thêm; wrong/expired/reused nonce và sai model/binary/policy/process bị từ chối; thiếu một surface giữ UNVERIFIED; full measured evidence tạo đúng receipt, rồi mới admit normal routing turn. Production từ chối đường test admission.

### R2 — Important: thiếu hợp đồng nối inference local với assessment, workflow và dispatch server

**Vị trí:** plan:70–79,109–114,149–163,175,181,189,200,211,233 và266–280.

`AssistantDriver.start` trả `Promise<void>`; driver chỉ có input delivery/checkpoint/stop, không có output/event/tool request hoặc callback được typed. Prose tại181 nói model “produce typed evidence/routing/assessment/questions/actions”, nhưng chưa định nghĩa các payload đó hay consumer. HTTP action union chỉ gồm create_ticket/decision/dependency/command/signal; không có request/response nối model tới createRun, owner question creation, assessment/model choice, requestCapacity/prepareDispatch hoặc review orchestration. `assessTicket(tx,proof,ticketId,snapshot)` không nhận assessment proposal/model reasoning, trong khi VPS không chạy inference. Đoạn266–280 bắt đầu từ `assessment`, `choice`, `proof` đã có, nên không chứng minh chúng được tạo và chuyển từ local inference sang server thế nào. Route turns/reserve cũng yêu cầu selectionId đã tồn tại nhưng không có work/selection delivery protocol cho host.

**Failure cụ thể:** implementer có thể hoàn thành từng named service và fake acceptance bằng cách gọi trực tiếp `f.prepareDispatch`, nhưng local driver đọc xong input không có production call path để tạo assessment/rationale/model selection và xin dispatch; hoặc phải tự thêm một generic tool tunnel không được review quyền. Tương tự model không có đường hỏi owner/nhận câu trả lời đúng gate và tiếp tục run. Đây là thiếu invocation chain của mục tiêu Phase06, không phải yêu cầu viết toàn bộ code trong plan.

**Sửa hẹp:** bổ sung một sequence và typed routing protocol do T2/T4/T5/T7 sở hữu: server durable work/bootstrap selection → host driver → validated tool/output union → authenticated HTTP consumer → các service cụ thể → receipt/tool result trở về đúng turn. Nêu schema cho assessment proposal/model choice/rationale, question creation, route/publish, run creation và dispatch request; mapping tới stored IDs/current input/proof/operation IDs, error/duplicate/uncertain behavior. Phân biệt actor machine A của routing với actor authenticated reviewer B của `recordRepairResult`; không giả actor hoặc chấp nhận `passed:true` làm evidence. Chỉ một prompt/schema của routing Assistant; execution vẫn dùng official templates.

**Test bắt buộc:** fake transport phát tool/output như runtime thật và đi qua route/assembly production với private DB; không trực tiếp seed assessment/decision/dispatch. Chứng minh input → docs → routing → assessment/rationale → eligible model choice → fresh capacity → prepared command → actual gated claim; thêm owner question/answer/resume và independent review/fix branch. Sai fence/input, unknown tool, forged approval, duplicate tool IDs và response loss phải có kết quả durable xác định.

### R3 — Important: G1 chưa nối scoped creator vào producer routing009 đang gọi generic createTicket

**Vị trí:** plan:40,45,163,175,182–183,234; frozen phase05:219–229; actual `v2/server/src/tickets/service.ts:40–44,104–127`.

G1 đúng khi thêm `assistantCreateTicket` riêng và giữ nguyên ACL của generic `createTicket`. Nhưng phase05 S1 `routeAssistantMessage` vẫn quy định gọi **existing createTicket trong cùng transaction** để tạo ticket/route/attachment links. Callback `InputRoutingAuthority` trả `Promise<void>` chỉ kiểm quyền; nó không thay được ticket-creation dependency. Ownership table T2 không có attachment submissions/routing callsite hoặc handoff009 để đổi consumer này sang scoped creator. Plan nói implements InputRoutingAuthority chưa đủ để nối hai đường.

**Failure cụ thể:** A đã đọc image-only inbox và đã có valid routing decision cho projectB. `routeAssistantMessage(... actor=A ...)` qua authority rồi gọi generic `createTicket`; actual ACL kiểm `projects.machine_id === actor.id`, nên vẫn 404. Gọi `assistantCreateTicket` riêng trước/sau route sẽ thiếu atomic route/link/replay hoặc tạo hai ticket; đổi actor thành owner/B bị cấm và mất provenance.

**Sửa hẹp:** thêm explicit ownership transfer/review với phase05 routing producer và một injected scoped ticket creation dependency (hoặc factory equivalent) dùng trong chính transaction route/link của009. Owner route dùng creator cũ; Assistant route dùng verified `ProjectOrchestrationPort.createTicket` với actor A/proof đúng persisted message decision và exact payload. Giữ generic API ACL/frozen input shape; chỉ mở integration hook hẹp, không sửa SQL001–009. Re-route phải dùng cùng đường này và narrow retirement authority.

**Test bắt buộc:** actual route009 + scoped producer06, A khác bound machineB và B offline: tạo đúng một request với actor A, route và inherited original references trong một Tx; retry không nhân đôi, link failure rollback cả ticket/route. A vẫn không gọi generic createTicket/claim của B. Re-route không bypass old route stop/current-input checks.

### R4 — Important: reservation của command chưa từng claim không có đường thu hồi

**Vị trí:** plan:133,139,200–206,221–228,266–277.

`prepareDispatch` reserve capacity/ownership trước khi máy đích nhận command và claim. Permit chỉ sống tối đa15s; plan cho biết sau failed/expired dispatch cần sample mới. Tuy nhiên schema/lifecycle quy định reservation chỉ release sau “stop + accepted finalization”; mọi recovery/finalization được mô tả cho attempt đã tạo. Không có transition/reconciler cho command chưa claim, claim bị deny vì input/source đổi, hoặc host offline tới khi permit hết hạn. Các trường hợp này không có attempt để submit result/finalize theo005.

**Failure cụ thể:** máy có maxJobs=1; prepareDispatch commit reservation; host chưa poll thì source OFF hoặc permit hết hạn. Claim không tạo attempt. Reservation tiếp tục chiếm slot/ownership; bật lại và sample mới vẫn không dispatch được. Ngược lại, tự release chỉ bằng timeout không đủ khi claim/response-loss đã tạo dormant/live process.

**Sửa hẹp:** T4/T6 định nghĩa state transition và producer/consumer cho unclaimed reservation cancellation. Dưới cùng machine/command/claim lock, chứng minh chưa có admitted attempt, retire quyền fresh claim của command một lần, và xử lý dormant host launch bằng exact no-launch/stop proof nếu có. Chỉ sau đó release reservation; claim thắng race thì giữ reservation active tới stop+accepted finalization như hiện tại. Nêu cách cancel/supersede command cũ và giữ audit/idempotency; expired permit/TTL đơn lẻ không giải phóng claimed/unknown process.

**Test bắt buộc:** prepare→offline/expiry; prepare→input/source change→denied claim; host pre-spawn chưa claim; claim commit nhưng reply mất; cancel-vs-claim race. Ba nhánh đầu phục hồi được slot sau chứng minh an toàn; hai nhánh sau không thả slot khi có attempt/process active hoặc unknown, rồi chỉ một replacement sau finalize.

## Những phần đã đủ rõ ở mức kế hoạch

- **G1 hướng thiết kế:** real machine actor, module-private capability, exact root/action/input hash; generic machine ACL không bị nới và không cấp code execution cho Assistant. Finding R3 chỉ ở callsite009 chưa được nối.
- **Một Assistant:** singleton live turn, monotonic generation, designation pending, stop proof theo OS identity/tree, không suy process chết từ lease/heartbeat; offline giữ pending.
- **Input/OFF:** inherited text bodies/hashes và selected image units, protected direct delivery, 009 admission atomic; OFF không hủy exact lượt đã admitted, security/input/designation vẫn revoke; new turn/fallback/child claim kiểm current policy.
- **Official workflows:** supported entrypoints/pinned bytes, rendered BMAD snapshot, human gates, explicit owner parallel override trong selected independent units, join/ownership và independent review. Không custom role ngoài routing Assistant. Không có lý do mở lại approved workflow/spec.
- **G3 admission hiện tại:** server-issued request trước sample, current boot, sample age và request elapsed ≤15s, immutable receipt/replay không gia hạn, fresh sample cho từng implement/review/fix; prepare atomic reserve và claim re-read current policies; host recheck trước release. R4 là phần kết thúc reservation chưa claim, không phủ nhận fresh/atomic path đã mô tả.
- **Review/repair/resource:** giữ004 counter và cycle-specific one-use owner continuation, không reset bằng model/ticket; native children phải broker tới T4; dirty/foreign/referenced resources không bị cleanup, exact identity/no-follow/quarantine và stop proof.
- **Monitor:** cursor+inbox commit cùng Tx, ACK fenced, event wake cùng 300000ms fallback, digest suppress duplicate actions/notice, no inference khi healthy/unchanged, bounded backoff và checkpoint/effect identities qua fallback.
- **G4:** Phase08 chưa có verifier thực là dependency được chấp nhận. `FinalEvidencePort` default deny, reported artifact không là completion proof, merged-but-unsynced không merge lần nữa. Không báo missing08 implementation thành finding của plan06.

## Gate và test matrix trước GREEN tích hợp

| Gate / owner | Proof cần có | Negative / recovery bắt buộc | Hiện trạng review |
|---|---|---|---|
| Actual02 Task5 | Reviewed005 contracts, actual ACL/journal/finalizing/evidence ports | Lost replies, guard giữ khi finalizing, report không tự verified | Reviewed tại9dca04e; prose baseline cần refresh |
| Actual02 docs6B/7 | Reviewed006 + dedicated docs reader/catalog metadata đúng snapshot/commit/audit | Stale/unverified docs không giả current, không lộ checkout/secret | Dependency; đang triển khai, không PASS thay |
| Actual03/04/05 | Reviewed007/008/009 + actual integration ports | Old pin/config/boot/report/probe, wrong companion/model/input denies | Chưa implementation/live certified; gate giữ nguyên |
| G2 routing certificate — T2/runtime | Issuer/admission/evidence/verifier/receipt chain trước first normal turn | Scratch nonce replay, all native/tool/child surfaces, production test-admission deny | **R1 chặn plan READY** |
| Local inference wire — T2/T4/T5/T7 | Typed events/tools và production route/assembly tới assessment/model choice/questions/run/dispatch | Unknown tool, wrong scope/fence, stale reply, duplicate/uncertain effect | **R2 chặn plan READY** |
| G1 +009 route integration — T2/attachment owner | Atomic route009 dùng scoped creator, actor A thật | Generic B ACL vẫn deny, rollback/replay/re-route stop | **R3 chặn plan READY** |
| Capacity — T4/03 | Actual sampler→authenticated receipt→atomic reservation→claim→host release recheck | Pressure/missing/stale/reused sample; two last-slot claims, cross-root ownership | Plan path đủ rõ; phải test actual |
| Reservation recovery — T4/T6 | Unclaimed retire/no-launch/stop protocol, claimed finalize protocol | Expired queued command vs admitted/lost reply, cancel/claim race | **R4 chặn plan READY** |
| One routing turn — T1/T2/T6 | Durable server fence + local process namespace + atomic finalize | Two reserve race, old ACK, old machine offline, unknown child process | Plan coverage đủ; actual test bắt buộc |
| OFF/input — T2/T4/009 | Exact current session and all selected text/image receipt coverage | Admit→OFF allowed; OFF→admit denied; ancestor comment between read and publish/claim | Plan coverage đủ; actual009 integration bắt buộc |
| Workflow/review — T3/T5 | Exact official source/rendered hashes, scoped owner policy, task+whole review | Changed artifact approval, self-review, conflicting owners, native unbrokered child | Plan coverage đủ; broker integration qua R2 |
| Repair5/resources — T5 | Actual004 result/cycle actor/fence path, registry identity retention | No count on infra/model, no reset5, wrong cycle, dirty/symlink/runB retained | Plan policy đủ; wire actor mapping qua R2 |
| Recovery/monitor — T6 | Event+cursor+work transaction, deterministic clock, logical effects | 299999/300000ms, restart between enqueue/ACK, duplicate wakes, unknown process | Plan coverage đủ |
| Completion — T7/08 | Production default deny; later actual artifact/merge/docs verification | Fake verifier cannot enable production; reported hash/local commit not enough | Accepted staged dependency, không blocker plan06 |
| Live acceptance — T7 | Owner-authorized bounded provider/runtime, actual input fact/provenance and certified execution | Missing live config/permission/certificate = UNVERIFIED | Chưa chạy; R1 phải tháo bootstrap trước |

## Handoff

Sửa R1–R4 trong plan/research, giữ phạm vi và các hợp đồng source/permit/checkpoint đã chốt. Bổ sung file ownership cho đúng producer callsite, protocol và tests vừa thiếu; cập nhật Task5 status. Re-review các sửa này và regression trực tiếp là đủ, không cần mở lại toàn bộ spec hay nghiên cứu official workflow.

Không thực thi code/test/model trong review này. Report readiness chỉ đánh giá khả năng giao implementation an toàn và đầy đủ; các gates actual producer, certification, comprehension, merge/docs và UI vẫn cần bằng chứng riêng khi đến phase tương ứng.
