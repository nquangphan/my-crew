# Phase09 — independent whole-plan review

**Spec READY: NO. Quality READY: NO.** Có 5 finding cần sửa ở mức hợp đồng/kế hoạch. Đây không phải kết luận implementation FAIL: Phase09 chưa triển khai. Chưa có signing/runtime/deployment PASS và review này không cấp quyền cho các hành động đó.

## Revision, phạm vi và cách kiểm tra

- Đọc toàn bộ plan 282 dòng, SHA256 `9bae3aa86b14a23db905f419ca86a32a4ffdb239a1c5d123566ecbc963b58aa1`; brief chuẩn bị đầy đủ, self-review và research đi kèm.
- Đọc root/v2 docs index, approved spec, roadmap; đối chiếu flow server identity/tickets/execution, gateway-host/desktop-shell trước actual symbols. Worktree không có `.codegraph/`.
- Dùng checklist `writing-plans`: spec coverage, producer/consumer types, ownership, failure modes, testability và external gates. Không chạy lại broad producer tests, không source/SQL/plan edits, không install/codesign/Keychain/LaunchAgent/DB/deploy/model/stage/commit. Chỉ tạo report này; không spawn subagent.
- Native03 actual baseline và actual02 constructors đã đọc ở working tree; HEAD cuối read-only `fe280b7054800f96e1f5f967d41b21f6b7137601`.
- Phase08 đã có scoped independent re-review đóng F1–F4 trên body SHA `5d486a5c3e975edec99049608809dd85c635c3567472c1667682b22e50aae870`. Đã đọc report và seam sửa; final08 SHA `54452166e7acab5d139f86b7f4d302d257a5f07c9f002a0bcff12645576a8eec` sau bookkeeping. Không lặp whole08 review. Metadata09 còn ghi provisional08 cần refresh; việc refresh này riêng với 5 lỗi thực chất dưới đây.

## Findings

### F1 — P1: Initial enrollment không có đường ghi current hợp lệ

**Plan lines:** 67–69, 80–88, 115–116, 127, 139.

`POST /installs` chỉ nhận `EnrollmentProof`; proof không chứa health, boot hoặc health receipt. Plan yêu cầu initial current được ghi sau proof **và actual health check**, nhưng không có service/wire/persistence producer cho health đầu tiên. `operations_current.health_report_id` trỏ tới `operations_update_reports`, trong khi mọi report có `command_id` FK và mọi health verifier yêu cầu `ActivationGrant`; grant lại bắt buộc `previousReleaseId`. Máy vừa cài chưa có current/grant/command không thể đi qua hợp đồng này. T1 test đã giả định `f.initialRelease` là current và T7 chỉ ghi “owner enroll”, nên có nguy cơ fixture seed che mất vòng bootstrap.

**Sửa cần có:** Định nghĩa typed initial health challenge/proof/acceptance, owner/native/server producers và routes cụ thể; receipt schema phân biệt enrollment với update activation, không bịa command/grant/previous version. Sau trusted initial proof, cùng transaction lập install/current từ actual boot và release, với replay/revocation/CAS rõ ràng. Không nới rule để owner JSON hoặc machine boolean tự ghi current.

**Regression bắt buộc:** DB012 mới, không current/desired/update/report: manually installed A → enrollment challenge → actual trusted initial health → current A → request B/grant/health. Thêm lost reply/restart, expired challenge, wrong boot/release và forged health; không seed current hoặc fake activation grant.

### F2 — P1: Health trust chưa có authenticated envelope hoặc trusted receipt channel

**Plan lines:** 82–88, 103, 137, 139, 221.

Enrollment có `keyId/signature/nonce`; `HealthProof` chỉ có client fields, booleans và `traceSha256`. Không có chữ ký/receipt ID/challenge, không ràng buộc command/grant/generation/boot trong authenticated payload. `verifyUpdateHealth(proof,grant):Promise<void>` không được truyền trusted observation hoặc report boot; plan cũng không định nghĩa channel/reader độc lập để verifier lấy bằng chứng. Vì vậy câu “server only accepts ... enrolled trusted health verifier” chưa có producer/consumer triển khai được: machine bearer có thể tạo cùng DTO/hash, còn fail-closed verifier chỉ có thể từ chối tất cả nếu không tự sáng tác một kênh tin cậy ngoài kế hoạch. Stable app signature không chứng thực những giá trị health do bearer báo.

**Sửa cần có:** Định nghĩa một signed health observation hoặc immutable server-issued receipt từ trusted observer channel, với issuer/key/build context và machine/install, command+grant, activation generation, exact boot/start identity, observed target release, challenge/nonce/expiry và outcome. Chỉ rõ native producer, signature/trace collector, server admission/receipt writer và verifier input. Rollback phải chứng minh đúng previous release trong cùng operation; initial enrollment dùng nhánh rõ từ F1. Vẫn giữ key protection/native measurement là genuine external certification gate.

**Regression bắt buộc:** Bearer-only forged successful booleans; signed proof từ operation/boot/generation khác; same trace replay dưới grant mới; altered rollback release; wrong/revoked issuer. Positive path phải qua signed observation admission và durable receipt/restart, không test callback nhận mọi DTO rồi return void.

### F3 — P1: DeployPlan tự chứa fingerprint và ticket ID trước khi chúng tồn tại

**Plan lines:** 239, 246; related 237.

Plan yêu cầu lưu **DeployPlan fields** trong immutable `CreateTicket.inputs.deployPlan` trước004 fingerprint. Nhưng `DeployPlan` gồm `definitionHash` chính là fingerprint của ticket, và `ticketId`. Actual `tickets/deploy.ts:8–18` hash toàn bộ definition/input, chỉ loại `deployApprovalDecisionId`; lưu `definitionHash` bên trong input làm fingerprint tự hash chính nó. Actual `tickets/service.ts:128–129,165–166` tự tạo ticket ID rồi mới hash; caller cũng chưa biết ID để chuẩn bị `inputs.deployPlan.ticketId`. Bỏ trường/lấy placeholder hoặc sửa input sau create đều không đúng hợp đồng hiện tại và có thể làm approval không khớp.

**Sửa cần có:** Tách immutable `DeployDefinition` chứa đúng target/release/config/schema/backup/effect preconditions owner duyệt khỏi server-derived `DeployPlan/DeploymentOperation`. Definition không chứa ticketId hoặc own definitionHash; server tạo ticket bằng API004 nguyên trạng, rồi012 đọc persisted ticket ID + `deploy_definition_hash` và tạo operation/attempt linkage sau authorization. Nêu rõ trường nào owner chuẩn bị, trường nào server sinh và cách operationId/effectId replay khớp definition. Giữ exact child approval, không sửa thuật toán004 để né lỗi vòng.

**Regression bắt buộc:** Tạo owner deploy root và approved child qua actual createTicket/routes, đọc hash đã lưu, prepare deployment và finalize qua private08 branch; không SQL seed ID/hash, không đổi input sau create. Thay target/release/config/backup/effect phải làm authorization thất bại.

### F4 — P1: ResourceRegistry hiện tại không attest được bundle có framework symlink

**Plan lines:** 43–45, 143, 187–189.

T3 cho phép nested relative framework symlink theo signed inventory và dùng03 ResourceRegistry cho stage. Actual `resources/native-resources.c:49` từ chối **mọi** `S_ISLNK`; `main:136` gọi tree scan cho cả attest, quarantine và cleanup. `ResourceRegistry.createAndAttest` gọi helper `attest` sau callback tạo nội dung. Vì vậy bundle hợp lệ chứa symlink framework sẽ thất bại ngay tại attest, trước atomic stage publication, hoặc không bao giờ dọn được nếu stage được ghi sau attest. T2 handoff hiện chỉ thêm packaged helper DI/mode, chưa sở hữu thay đổi artifact-policy này.

**Sửa cần có:** Giao explicit producer ownership và typed bundle-stage policy/adapter cho create/attest/quarantine/delete. Có thể giữ generic scratch policy nghiêm ngặt và thêm updater-specific manifest-bound mode: attest đúng signed inventory; unlink symlink entry qua parent FD với no-follow và recheck identity/target, không đi theo target. Hoặc chọn layout/registry contract khác thật sự hỗ trợ bundle. Không giải quyết bằng tắt scan toàn cục hay xóa theo path.

**Regression bắt buộc:** Minimal real .app framework symlink hợp lệ qua stage → attest → publish → eligible cleanup thành công; symlink ngoài bundle, target substitution, foreign mount/hardlink và đổi inode vẫn fail/retain. Existing scratch cleanup negatives giữ nguyên. Fixture có symlink thật, không chỉ giả metadata archive.

### F5 — P2: Update-operation resource owner chưa tương thích process proof của03

**Plan lines:** 45, 189, 210, 219, 260.

Dùng `operationId as runId` chỉ đặt tên resource, không tạo process ownership. Actual `ResourceRegistry.registerProcess` (`registry.ts:175–180`) bắt buộc exact `ProcessJournal.byInstance` + READY; `stopped` (`207–223`) trả false nếu không owner rồi kiểm từng workflow launch. Actual `LaunchInput/LaunchRecord` yêu cầu ticket, SourcePin và ProjectionPin; coordinator native/host/download stage của update không có ticket attempt đó. Plan không định nghĩa producer cho owner record/proof này và ownership table chỉ “registry borrowed”. Kể cả F4 sửa, successful/superseded/failed stage vẫn bị `PROCESS_EXIT_UNPROVEN` vô hạn, không đáp ứng cleanup bounded staging và có thể làm các bản cập nhật sau hết disk.

**Sửa cần có:** Chọn và chỉ rõ operation-process authority cho download/extract/coordinator/previous bundle, với typed real identity + stopped/no-process proof, durable crash/restart ownership và narrow03 registry handoff; không fake ticket/workflow pin hoặc nhận caller boolean. Nêu cách references/retention cho current/previous/grant được bỏ khi đủ điều kiện vì API03 hiện chỉ thêm chúng. Nếu cập nhật producer phải chờ review, ghi seam như T2/T4, không gọi capability này là sẵn có.

**Regression bắt buộc:** Failed/superseded download trước native launch có thể thu hồi sau certified no-process proof; coordinator đang sống/unknown giữ nguyên; actual stop + last ref gone dọn đúng owned stage qua restart; active/previous pinned bundle và run khác không bị xóa. Chứng minh bằng actual registry hoặc reviewed adapter, không mock cleanup counter.

## Những phần đã đủ hướng kiến trúc, không yêu cầu mở lại

- Immutable release/desired/current separation, offline A→B supersession, exact command body/replay, default deny, signature/archive bounds và schema compatibility có ownership rõ. T2 đã tìm đúng mọi dev compiler caller: NativeHelper, ProcessIdentity, ProcessJournal, ResourceRegistry và gated-helper INIT; private Node/helper injection khả thi sau handoff.
- T4 bao phủ actual005 AuthorizeDispatch +06 prepare/prelaunch/Assistant bootstrap +009 admission, local RELEASE serialization, durable barrier và no-timeout stop. Actual06 R4 retirement được dùng, không tự giải phóng reservation. Khi triển khai phải chứng minh lock order/race dưới actual constructors; không thấy cần nới DTO005 hoặc kết luận heartbeat=death.
- T5 yêu cầu actual old/new process stop, durable two-step bundle/pointer recovery, same-filesystem swap, retained previous bundle, compatible local schema và deny khi unclear. Native launcher/coordinator lock handoff phải được cụ thể hóa trong implementation và crash tests; không coi Apple cung cấp sẵn transaction này.
- T6 deploy completion seam khớp hướng08: private `TicketCompletionProof` union có thể thêm deploy, registered callable association đi qua actual005 finalize/ticket service. `ServerOptions.verifyFinalResult` actual signature khớp reference trong09. Default unregistered production reader vẫn deny. Không cần thêm public005/FinalEvidencePort fields hoặc sửa SQL011 chỉ để nối09.
- Isolated OCI VPS target, expected prior digest, per-target deploy serialization, write-fenced DB/blob backup, original checksum restore, explicit production authorization và accurate evidence labels là yêu cầu phù hợp spec. Không có quyền deploy từ PM mandate hoặc auto-merge.
- Five review-focus classes và whole-product evidence matrix có task owner; source/policy/certificate/commit evidence và measured costs/resources được tách khỏi mock results. Không thấy claim định lượng thiếu chứng cứ.

## Genuine gates, không phải lý do cho 5 plan defects

1. Actual03–08 implementations và reviewed constructor/hook integration; current08 review đã đóng F1–F4 ở mức plan, chưa implementation PASS.
2. Authorized stable Developer ID/notary identity, isolated test account/permissions, measured native/key protection và real signed A/B update/rollback lane.
3. Runtime04/routing06/observer08 certificates, bounded owner-authorized live model allowance; missing/failed proof phải giữ UNVERIFIED/deny.
4. Phase07 prototype approval cho UI acceptance; không ngăn offline contract tests.
5. Exact production target/release/action approval sau preview/backup-restore evidence; không được suy từ review này.

F1–F5 có thể sửa ngay bằng planning/contract work, không cần cert/keychain/deploy/model permission. Sau sửa, review focused diff + actual producer seam, rồi mới freeze09. Không cần lặp lại broad02/08 producer suites trong vòng plan review.
