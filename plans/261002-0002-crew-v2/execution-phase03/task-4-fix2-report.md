# Phase03 Task4 FIX2/5 — durable admission cùng GC

Trạng thái: candidate DONE_WITH_CONCERNS, chờ PM serialize và scoped independent re-review finding P1 mới. Source base FIX1 `b1172c8`; dispatch HEAD `c6040be`; peer model/attachment/docs commits được giữ nguyên. Infrastructure interruption không reset/increment semantic wave; đây FIX2/5. Không Git stage/commit, shared manifest/package/lock, model/app/server/native/005007 edits hay subagent.

## Root cause, ruling và chi phí

Re-review chứng minh actual `ProcessJournal.reserve` fsync exact pair sau snapshot refs nhưng trước native delete. Registry writer transaction không serialize ProcessJournal writer transaction; reread ngay trước unlink vẫn có race. Root cause ở boundary hai durable producers, không ở artifact hash/cancel/native inode checks đã đóng.

Ruling thực hiện trong authorization của PM: thêm admission binding/intent/barrier riêng vào ProcessJournal, không sửa LaunchInput/LaunchRecord/formatVersion1/launcher/native stop proof. Registry GC và managed reserve dùng **cùng journal transaction** xuyên quyết định và side effect. Lý do: GC-first phải loại pair khỏi admission trước reserve, reserve-first phải bảo vệ pair trước delete. Chi phí: managed consumer phải attach journal+registry cùng private host root; binding/unknown admission intents tồn tại bền vững và có thể giữ bytes tới producer resolution được review. Không cố phục hồi bằng timeout/closed boolean hoặc fake accepted005 receipt.

## Source diff và API handoff

Đổi production chỉ `v2/gateway/src/journal/process-journal.ts`, `v2/gateway/src/workflows/registry.ts`, `v2/gateway/src/workflows/retention.ts`. AtomicRecords/native C/identity/launcher/DTO/hash/artifact recipes/dependencies giữ nguyên. New test `workflow-admission.test.ts`, support `workflow-admission-crash-worker.ts`; R3 `gateway-host.md` + `gateway-workflows.md` đều đúng canonical7 headings.

Additive producer exports:

- `PinAdmissionAuthority={registryRoot,verify(input:LaunchInput):Promise<void>}`; validator application-trusted, đọc exact immutable source/projection, không owner route input.
- `PinAdmissionIntent` là exact LaunchInput + formatVersion1/registryRoot, record riêng; không đổi fields của LaunchRecord.
- `pinAdmissionMarkerPath(hostRoot)` cho fixed managed marker.
- `ProcessJournal.bindPinAdmission(authority)`: bind trong journal queue sau kiểm same-root marker/durable binding; bind transition chờ transaction cũ.
- `ProcessJournal.withPinAdmissionBarrier(registryRoot,action)`: journal transaction xác thực durable binding và active attached authority rồi giữ queue tới action xong. Callback không re-enter writer transaction.
- `ProcessJournal.pendingPinAdmissions()`: kê intent chưa có exact committed LaunchInput; committed intent dedupe với actual LaunchRecord, không phải terminal release.

**Consumer Task5/Phase04:** mở ProcessJournal tại private host root rồi `WorkflowRegistry.open(sameRoot,{...,processJournal:journal})` và giữ binding active trước managed `journal.reserve`. Registry open tự bind validator readonly resolve; không yêu cầu caller nhớ retain trước reserve. `reserve` kiểm managed binding kể cả cached replay, verify resolvable pair trong journal queue, fsync admission intent trước LaunchRecord commit rồi mới trả launch. Producer không gọi Launcher/model/claim. Registry closed/missing binding hoặc journal reopened nhưng chưa attach → `PIN_ADMISSION_NOT_BOUND`; GC-first pair đã quarantine/deleted → verify reject trước intent/LaunchRecord. Retry chỉ commit khi exact pair còn resolve được.

## Durable layout và lock order

`workflows/pin-authority.json`, registry hashed `pin-admission-journal` record và `process-journal/pin-admission.json` là metadata riêng version1. Intent `process-journal/admissions/<hash(commandId)>.json` ghi exclusive/no-follow/file+directory fsync qua helpers đã review. Chúng nằm ngoài hashed LaunchRecord enumeration; old LaunchRecord JSON và runtime proof/version không đổi.

Lock order: registry writer queue → ProcessJournal queue cho GC/recovered reclaim. Managed reserve chỉ giữ ProcessJournal queue; validator resolve đọc immutable bytes trực tiếp, **không** lấy registry writer queue ngược lại. OS writer guards của từng store loại writer/instance khác; không hỗ trợ hai process cùng ghi thông qua callback hoặc bypass queue. Tests kiểm actual second writer open bị từ chối. Bound callback không được viết/re-enter journal queue bên trong barrier.

Standalone journal cũ còn hoạt động khi chưa có managed marker. Registry marker xuất hiện chặn mọi reserve unbound mới; bind chờ standalone reserve đã vào transaction trước marker, rồi current legacy record được GC thấy. Registry không attach journal nhưng journal path/durable registration tồn tại từ chối published GC; recovered publication quarantine giữ nguyên. Pure stage reclaim vẫn dùng closure authority riêng và không cần giả terminal receipt. Marker/binding lỗi, mất attachment hoặc intent/canonical record không kiểm được giữ fail-closed.

## Invariant và recovery

- **GC-first:** snapshot/quarantine/delete giữ cùng journal queue; reservation đợi hết GC rồi verify pair. Pair mất → reject trước durable LaunchRecord/launch; không có delayed success với missing projection.
- **Reserve-first:** verifier → durable intent → actual LaunchRecord fsync trong một journal transaction. GC không lấy snapshot/unlink trước transaction xong; snapshot thấy actual record hoặc unknown durable intent.
- **Crash trước journal commit:** intent đã fsync chứa exact pair; pending admission không TTL/delete hay nâng thành committed. Registry retained/inventory có authority `pin-admission`, reason `durable-pin-admission-intent`, exact source/projection bytes; GC giữ pair. Same-input retry verify+commit thực, rồi dedupe intent với actual process reference.
- **Crash sau journal commit:** old version1 record còn nguyên; reopen phải bind trước reserve, GC giữ actual ProcessJournal ref. Accepted005-finalization release vẫn chưa có.
- **Crash sau native quarantine trước registry state receipt:** restart reconcile attests same inode/marker. Published reclaim giữ journal barrier xuyên recovered refs check và native delete; concurrent reserve không được commit missing pair. Crash worker thử actual waiting reserve lúc GC đang giữ queue, không manufacture intent/stop proof.

Pending-intent dedupe chỉ chứng minh commit tồn tại, không chứng minh stopped/finalized. Genuine release producer tương lai phải xử lý admission/process reference lifecycle bằng exact authenticated terminal/stop authority; không chỉ xóa LaunchRecord rồi coi intent closed. Task5 nhóm process refs giữ `accepted-finalization-producer-unavailable` với exact pair/authorization/bytes như FIX1.

## Meaningful RED/GREEN và final verification

`fix2-admission-red.log`: ba baseline interleavings snapshot/quarantine/delete đều **FAIL CHECKSUM_MISMATCH** sau actual durable reserve; không fake reference/native receipt. Interleaving điều khiển boundary đọc/native operation, không mock producer commit. `fix2-admission-boundaries-green.log`: cùng ba scenarios PASS, GC-first reservation bị deny.

Focused `fix2-focused-green.log`: **13/13** (9 new admission +4 prior operation/GC tests) PASS. Có actual reserve-first durable intent rồi paused actual journal commit, cached replay, unbound/reopened/bind transition, cross-writer exclusion, SIGKILL admission/committed/quarantine/restart, recovered quarantine deletion concurrent reserve. Old sequential released/unreferenced GC, current/dependencies/recovered refs, pure crash/timeout/fork/no-follow/hardlink regressions giữ nguyên.

Final production change là narrow producer/registry/retention barrier, đã format trước final suite. **ONE** covering sau change: `pnpm --dir v2/gateway test` → build + **77/77 PASS**, fail/skip/cancel0,76956.366959ms; `fix2-gateway-final.log`. Artifact/native actual builds chỉ được chạy vì nằm trong required covering; không rework/refreeze recipe hay lặp standalone builders. FIX1 pins unchanged; no runtime certificate inferred.

Types `pnpm --dir v2/gateway typecheck` exit0. Biome toàn owned TS surface gồm additive producer/new test/support **25 files**, no fixes/warnings. Native C không đổi nên không lặp standalone C-Werror/broad native suite; prior evidence retained, actual final gateway suite build/run helpers. Both R3 flows canonical7 heading order PASS; owned diff whitespace PASS. Không server/desktop/domain/model/attachment broad suite.

Sau covering chỉ bổ sung test cleanup telemetry (không production change), focused admission9/9 chạy lại xác nhận exact root/dev/inode/UID và ENOENT cho cả9 roots; `fix2-cleanup-focused.log`. Existing final77 production covering giữ giá trị; không broad rerun cho instrumentation cleanup. `fix2-owned-scratch-inventory.json` freeze nine deleted admission roots, two newly retained genuine fork UNKNOWN roots từ focused13 và covering, cùng link tới historical FIX1 uncertainty inventory. Không cleanup prefix/global/owner resource hoặc xóa intent/ref bằng boolean.

## Frozen review surface / PM handoff

`fix2-candidate-inventory.json` gồm toàn37 owned FIX1 files cập nhật đúng source/doc rows + additive ProcessJournal/new test/support/gateway-host R3 (41 files), bytes/mode/SHA256; so artifact fixture bytes/hash với FIX1 để chứng minh unchanged. `fix2-evidence-inventory.json` ghi logs/probe/brief/report/cleanup/current inventory. PM serialize manifest/generated docs/index, staged checks và commit, rồi scoped independent re-review **new P1 + FIX2 diff**. FIX1 original artifact/cancellation đã ADDRESSED; không mở lại unrelated recipe/certification review.

Unresolved: independent FIX2 review; genuine accepted005FINALIZED same-attempt/fence/process/pair reference release producer Task5; original Phase04 runtime/bootstrap/namespace/native Read/tools/child/API certificate và BMAD Codex/marketplace gate; historical acquisition/fork/evidence cache groups cùng new fork UNKNOWN roots giữ exact inventories. Không owner approval mới hoặc runtime enable/model authority được suy ra.
