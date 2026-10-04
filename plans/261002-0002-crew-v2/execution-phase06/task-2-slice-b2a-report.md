# T2 B2a — RED readiness

Baseline B1 accepted/committed `340851c`; PM release chỉ author regression/loadable scaffold theo preflight `e253fae99083c5f11b4072d64bac0bbdbc8d36de3374676ff1ca36ee15c8219a`. **55 authored cases, chưa chạy RED/Node/PG/types/Biome, chưa feature implementation.** Product scaffold đã freeze cho web kiểm dependency closure; chỉ test/report authoring tiếp tục Node-free. Frozen DTO/SQL/ACL/app/global canonicalizer không đổi.

## Current exact five paths

| Path | Trạng thái / SHA256 |
|---|---|
| v2/server/src/tickets/service.ts | Hai additive scaffold delegates existing recordDecision/addDependency; `99ca987d558d81efb22b20a9c3089d897cd011be37109881269b2d5f13e93cdf` |
| v2/server/src/tickets/decisions.ts | Chưa sửa; `93ffcd5601bbeb3754778bfab12907f0d62bf6ec2a726623ae98c17a2f46aa5c` |
| v2/server/src/tickets/dependencies.ts | Chưa sửa; `0e6a227bbab2d9a95d67a691e495a2a029482cb5ff727c3bf05a3823cd789eb9` |
| v2/server/src/tickets/assistant-access.ts | New loadable `export {}` only; không snapshot extraction/token; `9ed7ffa5ee47e0931ddc3e519a9057b1c82cdf3890abbd0caabc88e4e050e2e3` |
| v2/server/test/assistant-mutations.test.ts | New55-case matrix; `8ab493e3b7c2df2aeecbd38f05755b5176097f983c502b7a39fc6db6a2c9587f` |

Contracts không sửa: frozen decision payload `{ticketId,input}`, dependency `{ticketId,predecessorId,expectedRevision}`; target hash SHA256 canonical tuple `['crew-v2:orchestration-target:1',action,payload]`. Test-only exact allowlist authority check actual Tx/actor/proof/action/hash/root/project/targets và bindingB, không blanket success/certifier/native receipt.

## Behavioral matrix

| Authored cases | Nội dung |
|---|---|
| 28 (14×2 actions) | Positive actual A audit/journal; missing/owner/actor/operation/action/hash/root/project/Tx negatives rollback toàn state; peer NOWAIT root/target/predecessor/project locks trước verify; immediate+deferred actor/proof/input snapshots; factory capture và cross-Tx reuse denial; uppercase exact hash và lower-hash denial |
| 1 | Fastify generic decision/dependency routes dùng real bootstrap + provisioned machine bearer + createAuthenticator/current transactional ACL. A→B404, state unchanged. Không gọi no-Actor generic addDependency rồi đòi404. |
| 9 | Dependency revision/self(casing)/cross-root/duplicate/cycle/closed/ready/running/missing invariant |
| 1 | Concurrent opposite scoped requests chỉ1edge commit, remaining cycle409; existing mutator có event-cursor serialization, không suy test này tự chứng minh root wait. NOWAIT tests ở trên kiểm actual root locks. |
| 11 | Decision owner answer/approval, content/rationale bounds, sources count, unsafe JSON, cross-root source, locator, missing docs reader; reject trước verify và no writes |
| 1 | Actual same-root ticket/owner decision/reported artifact source; closed-tree decision timeline giữ existing semantics |
| 1 | Actual legacy docs import lưu source và current docsSourceReader, source validation trace trước verify đúng1lần, captured reader bất biến. Imported auditState vẫn unverified, source existence không được gọi content/native attestation. |
| 3 | Array getter/iterator/prototype boundary reject VALIDATION trước user code/authority và state write; direct service qua mutation body{} với bound machine để tách khỏi generic A→B ACL và không serialize hostile object ở test/journal trước boundary |

Test nguồn/tokens không bịa production admission. Future B1 snapshot extraction chỉ sau witnessed RED; B1 private create token giữ nguyên. Shared decision/dependency invariants chỉ refactor1lần sau RED. B2b command/signal, B3 input locks và production positive authority vẫn pending.

## Expected RED và scheduler recipe

Decision scaffold A→B trả404 thay successful scoped decision; missing/mismatched authority assertions phải fail. Dependency scaffold vốn không Actor ACL nên có thể insert khi thiếu/sai authority; no-write/default-deny/assert verify count phải fail. Generic route negative và nhiều invariant controls có thể pass ngay, không tính đó là B2a authorization implementation. Setup/compiler/import failure không được tính RED; preserve raw failure nếu cần test diagnostic fix.

Chờ explicit sole-heavy grant, không chạy khi web đang dùng closure. Mỗi container/Node launch có fresh sysctl pressure/vm_stat/top/df; available=(free+inactive+speculative)×pageSize, gate pressure1/2, ≥4GiB, CPUidle≥50%, disk≥8GiB, quotaremaining>25%. Own local postgres18.6 image không pull, fresh `crew-v2-test-<uuid>` memory256MiB/CPU1/pids64/random loopback khác5432/55432; inspect actual ID/resources/port, bounded pg_isready. Exact test command:

```sh
NODE_OPTIONS=--max-old-space-size=384 \
CREW_V2_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:<actual-port>/crew_v2_test \
CREW_V2_TEST_CONTAINER_ID=<actual64hex> \
node --test --test-concurrency=1 --test-timeout=60000 v2/server/test/assistant-mutations.test.ts
```

Raw log/exit/outcome55 và baseline source hashes riêng từng run. Ghi PID/container/DB-prefix/scratch; sau RED exact stop/remove, DB0 và docker/ps absence witness, trả slot trước feature edits Node-free. GREEN grant riêng sẽ cover new B2a + accepted B1 helper consumers và existing relevant producers; scoped strict/Biome exact owned5, không full-server PASS hoặc sửa peer deps. Hiện chưa tạo own runtime resource/scratch.

## Actual RED55 (scaffold unchanged)

PM grant22:28:18VN, quota69%used/31%remaining. Actual55 tests: **10 pass/45 fail/0 skipped/exit1,12251.999166ms**. Decision generic404 instead of scoped success/authority denial; dependency missing expected rejection and observed verify count0. Real machine-auth generic route ACL and9 DAG invariant controls pass. No setup/import/compiler failure or diagnostic test changes. All five source hashes still matched readiness when launched.

Own container `crew-v2-test-48612787-9945-4793-b5be-5dfd6bd74565`, ID`3deae56ab70cf4f79c4dd7b9fe7e5787fba8f21a6494275eb666a67630ddbb4b`, local postgres18.6, loopback63788, actual memory268435456/nanoCPUs1000000000/pids64. Fresh create gate7.0154GiB/pressure1/idle62.45%/disk25.3477GiB; Node gate6.92163GiB/pressure1/idle57.43%/disk25.2579GiB. Node62955 heap384/concurrency1/test-timeout60s; Python watchdog wrapper62954 bounded90s (not triggered). Both exited. Cleanup15:31:06UTC: logical DB-prefix query0rows; exact docker stop followed filtered docker ps-a absence, exactPID and Node-pattern absence; no host scratch. Heavy slot returned before implementation edits; no GREEN grant.

| Raw evidence | SHA256 |
|---|---|
| task-2-slice-b2a-red.log | `c38f8cdb66cac551d0ba2e722fe6d7d47cb62b9d69d031ffad225895f7bef86e` |
| task-2-slice-b2a-red-resource.log | `6e5dd3e893bcc3f7b573b8f990e241a0e5c320957c06ffc7512a2dc9c1183c34` |
| task-2-slice-b2a-red-cleanup.log | `837358c1437b3215938804814713560dfe7897b21219729b905ceb3fc1912782` |

## Implementation sau witnessed RED — source freeze trước GREEN

Chỉ5 paths đã release. `assistant-access.ts` trích nguyên descriptor-safe immutable snapshot từ accepted B1; hash exact submitted tuple giữ nguyên. B1 private create WeakMap vẫn ở service. B2a capture input/actor/proof đồng bộ, immutable operation có runtime identity; helper khóa root→canonical sorted target set→project, rechecks actual membership. Authority method capture tại factory; absent503, machine-only403. Prepared/verified identities bind factory/Tx/operation/root/project/targetset; token tạo sau verify và tiêu đúng1lần trong private persistence core. Không public bypass boolean/token argument trong generic methods.

Decision dùng chung validation/source/deploy-owner restrictions và single INSERT/event. Scoped source/docs preparation trước verify, không gọi reader sau verify; actor audit vẫn actual machineA. Dependency dùng chung revision/status/cycle/duplicate invariants và single INSERT/revision/event; duplicate existence SELECT nằm trước verify, unique-constraint409 giữ làm defensive fallback. Generic signatures/route ACL không đổi; direct generic dependency vẫn không Actor parameter. Không acquire guard/input hoặc entity lock mới trong persistence sau authority. Production captured resolver vẫn default-deny; test trust allowlist không chứng nhận admission/native/input.

Static self-review: UUID spelling chỉ canonicalize cho DB target identity, payload/hash không thay; snapshots reject proxy/accessor/iterator/custom array prototype trước caller code; exact raw journal body do caller quản lý; closed-tree decision giữ timeline semantics, dependency closed-tree deny. B2b/B3/native producers/positive authority vẫn pending. Chưa chạy GREEN/type/Biome, không gọi code load/type PASS. Source frozen để web kiểm current buildApp closure.

| Pre-GREEN file | SHA256 |
|---|---|
| v2/server/src/tickets/service.ts | `818dc4eda426366f1d00b5540282729878d618d0103c4160e818e8a09dc7ed88` |
| v2/server/src/tickets/decisions.ts | `f3d510447dc82b69c19454253acb08f8966275df6176340ab63c812fec9880cd` |
| v2/server/src/tickets/dependencies.ts | `e2c5a228a198fb4cc5496ece79bf2d96854d6d11561cc6f3e899ef9c8bcbbd99` |
| v2/server/src/tickets/assistant-access.ts | `83937df33641cf2fd7039cc1a61b3c641b8f83171580c1af4f1e56d8da7a241e` |
| v2/server/test/assistant-mutations.test.ts | `8ab493e3b7c2df2aeecbd38f05755b5176097f983c502b7a39fc6db6a2c9587f` |

Đề nghị GREEN bounded118 cases: new55 +acceptedB1 47 +existing16 (tickets6/deploy4/dependencies6) qua đúng5 testfiles `assistant-mutations.test.ts`, `assistant-orchestration.test.ts`, `tickets.test.ts`, `deploy.test.ts`, `dependencies.test.ts`. Format own5 trước final test, scoped strict own5 +dependency closure với external skipLibCheck theo ruling. Resource recipe như RED; actual GREEN/cleanup cần grant riêng. Không full-server PASS hoặc broaden suite.

### Draft server-tickets flow cho PM integration

Factory có `assistantRecordDecision(tx,actor,proof,ticketId,input)` và `assistantAddDependency(tx,actor,proof,ticketId,predecessorId,expectedRevision)`. Các port scoped chỉ cho machine, cần captured ProjectOrchestrationAuthority; absence503. Exact immutable submitted payload hash/action và actual actor/proof truyền authority cùng Tx sau root/ticket/project prefix. Decision validate source/owner-only kinds trước authority; dependency giữ DAG/revision/status/duplicate rules. Private runtime token không serialize/cast để cấp quyền; shared producers ghi actual actor và existing events. Generic HTTP/caller ACL không nới; machineA không tự dùng generic mutation của project boundB. Helper mới `v2/server/src/tickets/assistant-access.ts` và test mới `v2/server/test/assistant-mutations.test.ts` cần PM docs-flow registration khi integration. Chưa có positive production scope/input/native receipt; các port chưa chứng minh live assistant orchestration.

## GREEN grant04/10 — held trước actual test launch

PM grant07:10:36VN, quota74used/26remaining. Own5 Biome check --write exit0 trước test, chỉ format/import organization. Create gate p2/4.24017GiB/idle64.88%/disk15.9996GiB; own PG `fe4a6f69a325b0f989b2367c5cc17b1c9a2203c7331c912a1b8282bae28afb46` memory256MiB/CPU1/pids64, loopback56853. Fresh test gate p2/**3.84950GiB**/idle64.7%/disk15.9528GiB fail available≥4GiB: **Node/test chưa launch; không có GREEN count**. Không chạy tsc. Exact PG đã STOP/auto-remove, DB-prefix query0rows, raw docker ps-a và ps witness; no host scratch. Đã trả heavy reservation, source freeze chờ scheduler eligible.

| File sau format / raw evidence | SHA256 |
|---|---|
| v2/server/src/tickets/service.ts | `ea22905be9db47890d631db39bfb12da12d1390245573dbea2dfe2f88e26bec3` |
| v2/server/src/tickets/decisions.ts | `6232db33c2a08fefefc8aa9a08ef336f7f20c0b7467037377982138397b1e9f1` |
| v2/server/src/tickets/dependencies.ts | `b090f768f43f70acea6fb0b2bb05c02e4a769d12e5a7dc47abca02f9ec63118a` |
| v2/server/src/tickets/assistant-access.ts | `dd135333e8862b54e1683cc27205eb9ac0aee0662262cd77af1dffcdf45bae77` |
| v2/server/test/assistant-mutations.test.ts | `701fba4b54473017e59dd4ae3d8be3c7cb25f45a2eec73fbd22270f966368075` |
| task-2-slice-b2a-green-format.log | `c6fb212ef6eb09752d69e47481302c55289d979901f6c0cc7c082d756ddd7750` |
| task-2-slice-b2a-green-resource.log | `8f0c02c87f8e4c3c26ca3d85a85ff0bd7748e5c6a818baa18ddda692f7cfaf53` |
| task-2-slice-b2a-green-held-cleanup.log | `b1a493c8f3875e7e00f555b87034c3f02f824f4b4030a042be2cf87922babd2a` |
