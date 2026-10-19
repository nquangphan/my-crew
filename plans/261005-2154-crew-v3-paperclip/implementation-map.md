# Crew v3 — Implementation map sau inventory00-02

Ngày05/10/2026, Asia/Saigon. Input: `phase-00-reuse-findings.md`, `v2-reuse.md`, roadmap/spec; source pinned `51907858d0c8cdb7329759f22104f0727dbe6751` tại `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`.

Đây là refinement đề xuất, **chưa phải brief triển khai**. Exact upstream package paths/signatures/toolchain/test harness chờ00-01 review và00-03 baseline. `crew/...` bên dưới là logical ownership/proposed relative path trong fork, chưa khẳng định tồn tại. Trước dispatch code PM thay từng logical area bằng exact files đã đọc, khóa DTO/interface, bổ sung command thực và reviewer gate. Chưa tạo remote tickets.

## Quyết định reuse và invariant

| Context group | Giữ từ v2 | Đổi connection | Xây mới / upstream thay thế | Release |
|---|---|---|---|---|
| policy (P1) | Model eligibility, immutable workflow pin, repair<=5, completion/deploy predicates | Core issue/run/status/project/model/approval readers | Core lifecycle/scheduler thay graph v2; authoritative direct mutation/spawn gate | R1 |
| host/process (G1/G2) | Lock/IPC, AtomicRecords/UUID/birth identity, HTTP exact replay, resource ownership/cleanup, fresh capacity | Paperclip run/session→local grant/fence identity | Host composition/outbound adapter; core sở hữu scheduler, không copy SQL005/007 | R1 |
| workflow (W1/W2) | Source fetch/checksum/stage/pin/projection/retention/isolation audit; definition/artifact inspection/render executor | Core issue hierarchy/run/approval, runtime entrypoint audit | Server render receipt/latch/reconcile và real uv integration; official version certification | R1 |
| models/runtime (M1/R1) | Inventory/probe/source switches, credential boundary, runtime pin/tool-policy/effect ledger | Core session/operation ID/catalogue/secret transport | Native Claude/Codex launch, API loop/fallback, full-tree certificate/assembly | R1 |
| assistant (A1) | Tool schema/hash/scope/gate negatives và single-use authorization ideas | Thay SQL Actor/Tx/ticket/turn repository bằng core facade + Crew namespace | Driver/assessment/admission/dispatch/monitor, owner wait/reconciliation và production assembly | R1 |
| docs (D1/D2) | CLI R1–R7, manifest/link/checksum/validation/import/search/snapshot semantics và project docs bytes | Core project ID/ACL/blob/repository adapter, source import envelope | Semantic source/merged-result gate; graph/dedup | R1 căn bản; R2 graph/dedup |
| files (F1) | Bounded extractor/worker protocol/provenance/corpus | Core attachment IDs/ACL/storage/job/run binding | Corpus/boundary certification, input checkpoint/revocation, file E2E | R2 |
| UI (U1/U2) | Map layout/anchor/view state/dialog; docs/onboarding; composer/file scenarios | Core routes/query/auth/DTO/theme/storage key namespace | Assistant attention/model/workflow controls; core shell/board/list ưu tiên upstream | R1 map/docs/machine; R2 files/full UI |

Không copy toàn v2, không nhập credential/ticket/runtime data tự động. Giữ source v2 để đối chiếu. Mỗi port có provenance/source SHA, exact tests, historical gap triage, meaningful regression trên candidate và independent review; số LOC không là reuse metric.

## Task nhỏ theo context/invariant

Scores =1+U+C+I, mỗi thành phần0–3. Model IDs/effort đề xuất theo allowlist PM: S=`gpt-6.1-sol`, A=`gpt-6-astra`; reviewer độc lập tối thiểu S, authority/native/security dùng A. Điểm chấm lại sau baseline. Không dispatch tất cả một lượt.

Source/test setup tham chiếu inventory ID ở findings; ownership chỉ logical area ghi trong bảng, test tương ứng và flow doc của area đó. Shared facade/schema/manifest/entrypoint/lockfile do integrator serialize; workers không sửa ngoài brief và không revert peers.

| Task | Context / source | Deliverable đủ review độc lập; proposed ownership | Dependency | U/C/I→score; model/effort và lý do | Test gate / class |
|---|---|---|---|---|---|
| P01 | policy/P1 | Port eligibleModels; `crew/contracts/model-policy.ts` và test; same machine+source enabled+revision+required caps | 00-03/interface map | 1/1/1→4; S medium, types mới nhưng logic pure | Model-policy negatives + core DTO adapter contract; light unit |
| P02 | policy/P1 | Port samePin/workflowsReady/assertSkillAllowed; `crew/contracts/workflow-policy.ts` | P01 review hoặc independent types freeze | 1/1/1→4; S medium, pin mapping | Missing/duplicate target, checksum/revision mismatch; light unit |
| P03 | policy/P1 | Port repair cap riêng, canComplete/canDeploy; `crew/contracts/{repair-policy,completion-policy}.ts` | Core approval/docs read contract | 1/2/2→6; S high, approval bool phải từ trusted reader | Cycle5, research/docs/code, merged/docs stale, no approval; light unit |
| C01 | core/policy | Facade mapping IDs/status/hierarchy/approval, một module DTO adapter; không SQL ticket copy | 00-01 review, P01–P03 | 2/3/3→9; A high, identity authority coupling | Cross-project/core direct mutation negative, exact response semantics; contract/API |
| C02 | core/gates | Pre-mutation completion enforcement; patch hẹp nếu SDK thiếu, registry riêng | C01, baseline seam decision | 2/3/3→9; A high, gate bỏ qua gây false done | Direct API/mutation cannot bypass mandatory/docs/approval; API/DB |
| C03 | core/gates | Pre-spawn admission enforcement; patch hẹp nếu SDK thiếu | C01; C02 serialize shared core | 2/3/3→9; A high, sole scheduler authority | Direct spawn/retry/offline/cancel race negative; API/DB |
| G01 | host/G1 | Port host lock+IPC/status lifecycle; `crew/gateway/host` và `ipc`, chưa dispatch | 00-03 | 1/2/2→6; S high, lifecycle/fs security | Socket0600/sender/liveness/restart/inode regression; native |
| G02 | host/G2 | Port AtomicRecords+process identity và READY journal; `crew/gateway/journal` primitive files | G01 identity review, C01 DTO | 2/2/3→8; A high, uncertain death/no duplicate | Crash at reserve/spawn/READY, birth mismatch, durable UUID; native |
| G03 | host/G2 | Port owned resource cleanup/quarantine; `crew/gateway/resources` | G02 stopped-proof freeze | 2/2/3→8; A high, deletion ownership | Symlink/path/hardlink/dirty owner files, unknown process retains resource; native |
| G04 | host/G2 | Port telemetry provider/capacity predicates; `crew/gateway/telemetry` | G01, resource thresholds contract | 1/1/2→5; S medium, fresh measurement fail-closed | Missing/stale/pressure/load/disk/ownershipConflict; unit/native probe |
| T01 | transport/G3 | Exact-key/body HTTP journal+event pump/ACK/replay; `crew/transport` primitives | C01 envelope, G02 | 2/2/2→7; S high, lost response semantics | Loopback lost ACK/restart/out-of-order/event gap; loopback contract |
| T02 | remote/G3 | Minimal outbound execute/session/result adapter, no second queue; `crew/remote-adapter` | 00-04, C03/T01/G02 | 2/3/3→9; A high, core remote run authority | Real gateway process keeps same core run/session after disconnect/restart; native+API |
| T03 | remote/G3 | STOP/cancel/reconcile exact run/grant proof; remote control module | T02 reviewed; same worker delta | 2/3/3→9; A high, process-tree terminal proof | Cancel while disconnected, unknown→no retry, exact full-tree stopped proof; native+API |
| W01 | workflow/W1 | Port source fetch/checksum/stage/registry/pins; `crew/workflows/registry` | G02; source/projection contract | 1/2/2→6; S high, immutable archive/publish | Tamper/rollback/cancel/double install/crash ref retention; unit/native archive |
| W02 | workflow/W1 | Retention/pin retirement mapped to core final state; registry ref module | W01,T03 reviewed | 2/2/3→8; A high, early GC loses active run bytes | Independent ref retains bytes; unknown terminal prevents reclaim; native |
| W03 | isolation/W1 | Port factory/audit incl upstream entry/tool sources; `crew/gateway/isolation` | W01/runtime entry contract | 2/2/3→8; A high, escape/security | Absolute path/symlink/child/runtime Read escape negatives; real native cert |
| W04 | workflow/W2 | Port definition/customization/artifact inspection; `crew/workflows/definition` | W01 and C01 | 1/2/2→6; S high, manifest mapping | Exact digest/pin/layer/unsafe artifact negatives; unit |
| W05 | render/W2 | Server receipt/witness/latch/reconcile (missing v2 slice); `crew/workflows/render-receipts` | W04,T03,C02; serialize schema | 2/3/3→9; A high, server authority/recovery | Fake/stale/cross-run receipt, lost ACK, stage unknown recovery; API/DB |
| W06 | render/W2 | Port executor/prerequisite probe + beforeRelease assembly | W05,W03, host ownership transfer | 2/2/3→8; A high, uv child tree/isolation | Real uv/Python render, no writes outside stage, replay same receipt; native heavy |
| M01 | models/M1 | Port inventory/probe/config switches/reporter | Core catalogue DTO,G04,W01 | 1/2/2→6; S high, TTL/source OFF | Config revision/current receipt, stale/disabled capabilities; unit/API |
| M02 | credentials/M1 | Local broker/current credential resolver/provisioning boundary | M01, auth envelope frozen | 2/2/3→8; A high, secret/signed helper boundary | Revocation/current key/no secret logs + signed Keychain/helper; native/security |
| R01 | runtime/R1 | Port pin/tool-policy/effect ledger with logical operation IDs | G02,C01,W03,M01 | 2/2/3→8; A high, duplicate effects/fallback | SIGKILL effect-before-receipt uncertain, same logical operation replay; native |
| R02 | runtime/R1 | One native runtime adapter then targeted session/cancel/replay | R01,M02,T02 | 2/3/3→9; A high, launcher/process/session | Actual CLI runtime, isolation/reconnect/cancel, core run association; native heavy |
| R03 | runtime/R1 | API agent tool loop/fallback bridge, independent adapter module | R01/M02 and capability contracts | 2/2/3→8; A high, logical effect/security | Tool args/hash/receipt, budget uncertainty, fallback preserves effects+caps; API/runtime |
| A01 | assistant/A1 | Pure tool schema/hash/scope validators + core resolver adapter | C01,W04,R01 | 2/2/3→8; A high, single-use actor/turn/run scope | Cross-message/root/project/fence/stale op ID negative; contract/API |
| A02 | assistant/A1 | Assessment/admission then one dispatch path; driver module | A01,C03,G04,M01 | 2/3/3→9; A high, previously unfinished core orchestration | Fresh resource/quota, same turn not two runs, root/model scope; API/DB/native |
| A03 | assistant/A1 | Monitor/owner wait/reconcile assembly, separate driver state module | A02,T03,W05 | 2/3/3→9; A high, recovery/lost ACK | Server/gateway restart, owner input idempotent, terminal proof; API/DB |
| D01 | docs/D1 | Port validator/manifest/link/checksum/contracts | 00-03, dependency schema split | 1/1/2→5; S high, byte/Unicode/security checks | Docs-validator negatives, NUL/traversal/link/heading/coverage; unit |
| D02 | docs/D1 | Docs-kit CLI with @crew/shared seam isolated; flow standards | D01, repo integration policy | 1/2/2→6; S high, manifest/Git contracts | R1–R7/staged/range/merge/no-init tests; CLI Git fixtures |
| D03 | docs/D2 | Snapshot import/read/search/core ACL namespace | D01,C01; serialize extension migration | 2/2/3→8; A high, ACL/bytes/persistence | Byte checksum/restart/replay/restore/cross-project/fence deny; API/DB |
| D04 | docs/D1/D2 | Semantic source/docs and merged-result gate | D03,C02 | 2/3/3→9; A high, cannot claim semantic from structural PASS | Correct changed-source mapping, stale verified/merged commit rejected; API/DB/Git |
| U01 | UI/U1 | Map pure layout/projection/view state then dialog embedding | Core graph DTO,C01 | 1/2/1→5; S medium, layout/DTO seam | Graph/unit then >100 nodes, viewport/anchor/dialog real API/DB browser; browser |
| U02 | UI/U2 | Docs tree/snapshot/search + basic machine onboarding | D03, core machine binding API | 1/2/2→6; S high, snapshot/token UX | Unicode/deep link/snapshot state, lost POST/409, secret absent; real API/DB browser |
| U03 | UI/U2 | Assistant attention/models/workflows controls (v2 gap) | A03/M01/W05 | 2/2/2→7; S high, unfinished producer-driven UX | Actual wait/approval/source OFF/partial state; real API/DB browser |
| F01 | files/F1 | Port parsers/golden corpus/provenance only | R1 gate; attachment/core contracts frozen | 1/2/2→6; S high, bounds/native decoder deps | Format/partial/ZIP bomb/XML/native decoder negative corpus; unit worker |
| F02 | files/F1 | Worker/storage/core ACL input manifest bridge | F01,D03,R01; serialize attachment schema | 2/3/3→9; A high, bounded processing/ACL/recovery | Crash lease/input checkpoint/revoke/no side effect + certified worker; API/DB/native heavy |
| U04 | UI/U2 | Full composer/paste/files/runtime controls | F02,U01,U02,U03 | 2/2/2→7; S high, input idempotency and state | Real upload/extract/vision/text provenance/lost reply/file-only message; browser+API/DB |
| D05 | docs/D2 | Graph/dedup extension, separate from immutable bytes | R1,D03 | 2/2/2→7; S high, new capability/ACL | Dedup does not grant ACL; source/link graph trust/freshness; API/DB |

Task R02 starts với **một** runtime; runtime thứ hai nhận follow-up sau review gate, không mở cả ba launcher từ interface chưa freeze. A02 assessment và dispatch được tách thành briefs nhỏ hơn nếu khảo sát cho thấy shared-state footprint lớn; không mặc định một task đồng nghĩa toàn Phase07. Installer/signed updater/upgrade rehearsal là phase09/10, cần exact artifact provenance/rollback brief riêng sau remote acceptance; không đánh v2 desktop shell là updater reuse đã đạt.

## Thứ tự và resource admission

1. 00-01 review→00-03 upstream baseline→C01/interface freeze. P01/P02 và D01 có thể chuẩn bị độc lập nhưng code chỉ trên fork candidate đã được PM xác định.
2. C02/C03 serialize core patches; G01/G02/T01→T02/T03 là proof remote trước host assembly lớn. G04 pure telemetry có thể song song D01 vì ownership khác.
3. W01/W04/M01 research và unit port độc lập sau frozen types; G03/W02/W03/W05/W06 dựa stopped-proof/receipt contracts, shared files không ghi song song.
4. R01→R02/R03→A01/A02/A03; D03/D04 có thể chạy context docs riêng khi facade/schema đã review. UI read-only chỉ sau producer DTO gate; real browser/API/DB acceptance giữ riêng unit/DOM fixtures.
5. R1 integration/signing/update rehearsal theo roadmap; R2 F01/F02, U04, D05 sau R1. Không xóa known open gaps để báo accepted.

Giữ worker theo context group: policy, host/process, transport, workflow/isolation/render, models/credentials/runtime, assistant, docs, UI, files. Follow-up cùng worker chỉ delta/source SHA/finding/test; reviewer độc lập với implementer, reuse reviewer cùng miền nếu vẫn độc lập. Không giao successor phụ thuộc trước review.

Heavy job mỗi lúc tối đa một tới khi có telemetry/peak chứng minh đủ tải; DB/native/build/browser suites serialize và log đúng process/container/ports. Local capacity port cũng phải obey PM admission; không lấy một static snapshot cho các dispatch tiếp theo.

Admission lúc nhận00-02 do PM cấp22:44:24GiB RAM/12CPU, memory free52%, swapused1350MiB/load5.13/disk63GiB; third light survey alongside core+HTML, không heavy suite. Quota còn14%, reserve1%; đây là snapshot của lượt nhận, **không** cấp admission cho task code tương lai. Không suy ra free GiB từ free percentage hoặc hứa dừng chính xác1%.

## Gate trước mỗi port

- Source full SHA + exact files/exports/deps đã trace; verdict giữ/port/upstream thay/xây mới với reason. Findings ID/test history chưa được rerun giữ trạng thái pending.
- Đích có exact current file/signature từ pinned upstream, owner boundaries/test harness/commands đã review; route/schema/entrypoint/migration/shared lockfile edits serialize.
- Regression cần meaningful negative behavior; historical GREEN không chứng minh v3. Thực chạy appropriate candidate unit/contract/API/DB/native/browser, recorded evidence phân scope.
- Core authority không nằm ở gateway status/UI/predicate; no duplicate effect/retry khi death unknown; STOP proof và approval/fresh docs không bypass.
- Independent spec/quality review, integration regression, docs freshness/coverage gate; R1/R2 acceptance riêng. Không ratio reuse từ LOC/commit count hoặc “ticket done”.

Câu hỏi còn mở: exact upstream destination/mutation/spawn seams, remote-session lifecycle và namespace contracts. 00-01/00-04 giải bằng source/proof; không yêu cầu owner chọn signature kỹ thuật.
