# Crew v2 — Báo cáo điều phối và bằng chứng thực thi

Cập nhật 2026-10-02 11:44 Asia/Ho_Chi_Minh. Đây là checkpoint đang thực thi, chưa phải nghiệm thu toàn sản phẩm. Spec được owner duyệt: `docs/superpowers/specs/2026-10-01-crew-v2-design.md`; roadmap: `plans/261002-0002-crew-v2/plan.md`. Workflow chính là Superpowers, task implementation và independent review theo SDD; không tạo thêm role prompt của Crew.

## Trạng thái được xác minh

| Phần | Implementation/review | Bằng chứng và giới hạn |
|---|---|---|
|01 domain|Đã review và merge main `325244b`|Foundation độc lập; không chứng nhận runtime|
|02 server/docs|Task1–7 COMPLETE, cuối `c6f9b60`|Server169/domain14/types; sau fix search, targeteddocs5/types. Prod dispatch/final-result vẫn deny tới producer06/08|
|03 host/app|Task1 COMPLETE `163c37c..a42e0a7`|Gateway/desktop tests và macOS UI đóng/crash/reopen; không phải job runtime production|
|03 journals/resources|Task2 COMPLETE `d3c7629..859d671`|Gateway39, resources10, types/Biome/native C; exact no-fork stop, fork UNKNOWN|
|03 server gateway|Task3 COMPLETE `202233e..8347bd6`|Independent spec/quality READY;191 coveringserver trước sửa wire cuối,22 finalfocused/types/Biome, nested docs all/staged sau buffer correction|
|03 workflow registry|Task4 FIX1/5, candidate `4cbf581` chưa đạt|56/56/types/Biome; independent review NO: thiếu actual installer/API producer, stage GC, abort existing-source rewind|
|03 sync/isolation/acceptance|Task5–7 chưa dispatch|Chờ các producer được review; không suy isolation từ source inventory|
|04|Task1 server model pool ACTIVE|Actual008 đang triển khai sau review007; chưa runtime/probe/certification production|
|05–06|Kế hoạch được independent review duyệt|Chưa actual009–010, Assistant production|
|07 UI|Prototype đã kiểm, chờ owner duyệt|Desktop/mobile layout và interactions fixture; không upload/inference production|
|08–09|Kế hoạch approved `30f3902`|Actual011/012, merge observer, signing/notary/update/deploy chưa chạy|

Hai plan approved cuối:08 SHA `e2f7eb0fd370dc14821db708568da36b728aaab767cd292645d79a90b94ed1f8`,09 SHA `8767f1310762763a89113084d5f3f9f4987ee8b060b5a74ea3b75ed588bdf1e5`. Joint scoped review đóng N1 EffectId encoding, giữ các finding08 F1–F4 và09 F1–F5 đã đóng; đây chỉ là plan approval.

## Quyết định điều phối và chi phí

1. Tiếp tục PM/subagent theo mandate owner, không hỏi lại từng technical plan đã trong spec. Independent task review, maximum5 semantic fix waves và whole-product review vẫn là gate; đánh đổi là controller phải giữ ownership/dependency rõ.
2. Cho task độc lập chạy song song theo yêu cầu owner dù skill mặc định sequential; giữ official workflow sequence/review join và ghi owner parallel authorization. Manifest/index/package/lock/Git serialize, chi phí tích hợp producer/consumer phải review lại nếu contract đổi.
3. Giữ worktree `codex/crew-v2-server` riêng, không dùng source/runtime/schema/credential/DB v1. Các package v2/gateway/desktop độc lập có lock riêng `--ignore-workspace`; đánh đổi là kiểm assembly/packaging sau này. Không push/deploy trong lượt này.
4. Task02/1 platform có thể chạy khi plan còn sửa phần terminal/docs;03/1 local IPC chạy sau identity được review;03/4 registry local chạy sau03/2 dù03/3 chưa xong. Chỉ các dependency đã có mới được dùng; server/sync/acceptance không nhận bypass. Chi phí là later DTO compatibility review.
5. Task02/6 pure validator có thể song song; DB006 bắt buộc chờ004/005. Test-container ownership không suy từ Docker delta: mỗi runner giữ exact ID/own temp/DB/port và cleanup finally, chi phí thêm fixture plumbing.
6. Nested docs gate dùng HEAD+exact staged paths trong private Git mirror, không đưa unfinished peer files vào candidate. Source mới map flow, mọi source đổi sửa R3 flow, generated files/check all+staged/rootstaged/diff trước commit; chi phí helper serialization. Mirror được xóa exact trong finally.
7. Fastify `removeAdditional:false` để unknown fields bị reject, không âm thầm strip. Scoped authority callbacks giữ immutable factory, standalone default deny; optional project BindingGuard cho bind được phép sau actual guard checks. Chi phí là reviewed backward-compatible factory surface.
8. Cached mutation vẫn phải authorize current credential/project/machine trong cùng transaction trước cache/work; event scope+event data trong một repeatable-read snapshot, SSE reauth mỗi poll/page. Chi phí lock/order/extra query, cần actual rebind/revoke race tests.
9. Ticket descendants không sinh sau root/parent terminal; DAG ready/running giữ nguyên; repair count5 và exact failed-cycle owner continuation one-use. Infra/model retries không tiêu/reset semantic count. Chi phí additive metadata và current-cycle checks.
10. Deploy root/child luôn ràng buộc exact action fingerprint. Lineage không cấp quyền target/action khác; exact delegated action chỉ giữ nếu all action fields đồng nhất. Deployment vẫn đợi owner approval hoặc owner deploy ticket exact action; chi phí stricter child approval.
11. Phase02 command UUID chỉ là pagination anchor, reset null mỗi poll và durable dedup; không coi randomUUID monotoniccursor. Ambiguous HTTP đọc scoped command/attempt theo ID trước next effect;03 management cursor là namespace riêng. Chi phí pagination và read contracts.
12. macOS không hỗ trợ NOTE_TRACK: arm NOTE_FORK/EXIT trước gated exec; exact kernel exit+wait+no fork+group empty mới STOP. Fork/escaped child/missing witness UNKNOWN giữ guard/resources. Chi phí04 supervised isolation/broker và09 signed prebuilt helpers; không cần clang máy end user.
13. Resource directory linkCount là snapshot; APFS child output/partial cleanup có thể đổi nên không so directory nlink như inode identity. Regular file nlink1 vẫn bắt buộc. Chi phí native real READY-output/uchg/restart regression, không yếu đi alias/path ownership.
14. Original docs BOM/CRLF/NUL/raw bytes/SHA giữ nguyên; derived PostgreSQL text/jsonb mới escape NUL và FTS vector prefix8192. Search literal fallback đủ toàn văn và transaction budget2s/statement timeout, không claim budget bao gồm auth/network/pool wait. CRLF fixture diff check có per-command cr-at-eol, không global config/normalize bytes.
15.006 snapshot cùng bytes có thể tái dùng ở attempt mới với exact canonical-input receipt khác; không nâng imported/reported thành verified. Test-only attestation fixture không chứng minh runtime/live producer011. Chi phí receipt fingerprint và riêng provenance/completion tests.
16. Source OFF chặn new admission/fallback ngay; turn đã admitted có thể finish nếu security/input/designation/route/grant vẫn valid. Không blanket revoke theo model config revision; chi phí explicit current-turn retirement semantics.
17. Managed-copy merge target chỉ hoạt động sau owner chọn/kích hoạt exact destination. Không claim đã mutate origin/main project trong khi bảo toàn dirty/index bytes. Chi phí onboarding/target visibility và trusted observer/writer isolation; local main merge của repo Crew là yêu cầu Git riêng.
18. EffectId là canonical SHA256hex64 của run/stepOperation/action/target/precondition; operation/ticket/attempt ID vẫn UUID. Consumer08/09 giữ nguyên digest qua journal/ref/SQL/HTTP/fallback. Chi phí scoped plan/schema/regression changes, không đổi producer hashing.
19. Registry candidate chỉ là audit snapshot chưa acceptance: real BMAD installer và API artifact là internal implementation cần làm, không là thiếu quyền; uv0.11.3 thực tế có. Official Superpowers Codex metadata package thiếu là nullable slot gate hợp lệ. GC phải phân biệt proven closed operation và UNKNOWN, không dùng fake workflow READY/STOP; chi phí thêm dedicated lifecycle/FD cleanup và actual deterministic-build proof.

## Resource, review và cleanup

Trước mọi implement/review/fix dispatch controller lấy snapshot mới memory_pressure, CPU/load/disk; concurrency tối đa ba child agents, giảm khi dependency/pressure cần. Ví dụ03/3 implement11:06:48%free RAM,86.35%CPUidle,43GiB disk/load1.56;03/4 review11:35:47%/81.98%/42GiB/load1.83;03/4 fix11:41:47%/83.36%/42GiB/load2.06. Đây là measured snapshot lúc dispatch, không ngưỡng hiệu quả hay đo token.

Independent reviewer đọc full task candidate một lần; fix scoped re-review đúng diff/producers, broad suites chỉ sau final production changes hoặc failure/concern. Source/test implementation dùng worker; controller serialized docs/Git/shared contracts. No fake runtime/signing/production PASS từ plan, synthetic matrix hoặc subagent handback.

Test services/fixtures dùng owned exact resource IDs; shared PostgreSQL55432/Kidy5432/backend/Redis/MinIO giữ nguyên. File source fixture/archive đã commit là sản phẩm kiểm thử, không rác. Scratch reports/probe/before-diff/logs chỉ dọn sau durable evidence và final review; UNKNOWN owned-stage retention có lý do/bytes, không broad rm/prune/kill. Managed worktree archive sau verified local merge bằng native app tool, chưa archive khi worker active.

## Các gate còn mở

-03 Task4 fix1 và scoped re-review; Task5–7 actual integration/isolation.
-04–06/08–09 actual source/runtime implementation và từng task independent review; whole-product final review/test/docs thật trước local main merge.
-02 Task7 M2 CLOSED: candidate29d626d scoped spec/quality READY;22 fail-fast assertions, types/Biome0warnings, docs5/API9 và exact2container cleanup. Không còn deferred finding Task7.
-07 owner prototype approval; signed identity/notary/macOS test permission, bounded live model configuration/budget và exact production deploy action khi tới bước cần. Chưa có câu trả lời thì giữ gate, làm independent offline work tiếp.
-Token/cost comparison, paid provider entitlement và automation economics chưa được đo trong checkpoint này; không có claim định lượng.

Checkpoint11:49: Task3 independent fullreview được giao với snapshot40%RAMfree/88.23%CPUidle/42GiB/load3.90. Scratch docs helper archive1MiB buffer lỗi khi official fixtures tăng; chuyển gitarchive ghi exacttempfile và rerun nestedall/staged thành công, generatedindex sửa trong8347bd6. Sourcecandidate202233e không được báo acceptance hoặc all-docs PASS trước correction.

Checkpoint11:56:03Task3 independent fullreview READY YES;04Task1 phụ thuộc02+007 được dispatch cùng snapshot40%RAMfree/86.60%CPUidle/42GiB/load2.11. Scope008/servermodels riêng; producer007 frozen và prod certification/defaultdeny giữ nguyên. Chi phí là host/runtime consumer integration vẫn phải review sau03/04 đủ producer.

Checkpoint12:03: M2 được original reviewer đóng, không finding mới; model pool Task1 đã thấy RED thực missing model table/HTTP404, additive008 migration đầu đã green. Narrow model event/app registration giao thêm cho active implementer, default production dispatch/final-result và test certification separation giữ nguyên; toàn diff sẽ qua full Task1 review.
