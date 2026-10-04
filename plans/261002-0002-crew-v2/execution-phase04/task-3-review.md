### Spec Compliance

- ❌ **Issues found — I1 (Important/High):** authority có thể hết hạn trong lúc chờ actual isolation barrier nhưng vẫn được dùng để ghi RuntimePin và hoàn tất beforeRelease. `d438ce1:v2/gateway/src/runtime/isolation.ts:108–123,186,219`; chi tiết bên dưới.
- ✅ Phần còn lại đúng phạm vi đã dispatch: RuntimeAdapter bảy methods và DTO pins/checkpoint (`contracts.ts:16–92`); additive captured/awaited hook sau accepted companion, trước launcher hiện hữu (`ticket-command-bridge.ts:38–68,278–287`); actual concrete workspace get/withPrepared và identity barrier qua companion fsync (`isolation.ts:95–139`, `launch.ts:162–185`); ledger logical identity/intent/receipt/reconcile và trusted readonly declaration (`effect-ledger.ts:18–185`, `tool-policy.ts:19–48`). Tất cả đường dẫn source trong báo cáo thuộc `v2/gateway/src/` tại **d438ce1** trừ khi ghi khác.
- ⚠️ Native host composition, authenticated current admission/certificate producer, official entrypoint catalogue, Phase06 operation authority và full-tree model certification chưa có; đây là gate mặc định từ chối đã được dispatch cho phép, không phải chứng cứ production. `launch.ts:43–47,64,129–130`, `isolation.ts:144,168–175`, `effect-ledger.ts:109–113`, `v2/docs/flows/gateway-runtime.md:37–43`.
- ⚠️ Checkpoint validation của task này chỉ so exact source/projection và định dạng logicalEffectIds (`launch.ts:116–121`); cross-runtime session remapping, receipt/attachment authority và previous terminal proof thuộc Task6/Phase06 như flow đã ghi. Không đánh dấu các nghĩa vụ đó hoàn tất.

### Strengths

- Hook nhận clone deep-frozen của actual producer objects, capture callback lúc mở bridge và chặn non-void result; throw giữ RELEASE chưa chạy (`ticket-command-bridge.ts:38–68,278–287`). Test có actual journal/registry/launcher và kiểm authorization vẫn null (`v2/gateway/test/runtime-boundary.test.ts:12–100`).
- Amendment workspace dùng actual `IsolationWorkspace`, đối chiếu commit/attempt/pair/path rồi so operationId/identity trong transaction. Producer thật reverify filesystem/config/Git/closure trước callback; không gọi observer dưới isolation queue (`isolation.ts:95–139`; unchanged `isolation/workspace.ts:538–604`). Test giữ cleanup chờ callback rồi chặn stale workspace (`v2/gateway/test/runtime-workspace.test.ts:72–103`).
- Ledger fsync intent trước `execute`, giữ pending/uncertain không tự retry, kiểm receipt lại trước return; fallback transport identity khác vẫn dùng cùng logical effect (`effect-ledger.ts:18–34,100–185`). Artifact test đọc/hash actual owned file và chặn sau tamper (`v2/gateway/test/effect-ledger.test.ts:124–154`).

### Issues

#### Critical (Must Fix)

- Không xác nhận Critical trong phạm vi diff này. Điều này không cấp chứng nhận native/full-tree hoặc production readiness.

#### Important (Should Fix)

**I1 — High: deadline kiểm trước queue có thể hết hạn trước khi RuntimePin được chấp nhận.**

- **Vị trí:** `d438ce1:v2/gateway/src/runtime/isolation.ts:108–123`; expiry chỉ được kiểm trong `observation()` tại dòng186 (certified) hoặc219 (test admission). `launch.ts:162–185` fsync RuntimePin trong action sau đó.
- **Trigger cụ thể:** observer trả receipt/challenge còn hạn; một `IsolationWorkspace.withPrepared` khác đang giữ queue, hoặc actual `verify()` phải đọc/hash filesystem đủ lâu; deadline trôi qua trước khi request này vào callback. `matchWorkspace()` chỉ so state/identity/pins/paths, nên callback vẫn chạy với observation đã hết hạn. Không cần observer giả hay sửa producer để xảy ra.
- **Tác động:** hook có thể hoàn tất trên authority đã expired. Bridge tiếp tục `Launcher.release`; kiểm hiện hữu của launcher chỉ refresh attempt/projection và capacity, không kiểm lại deadline trong observation này (`ticket-command-bridge.ts:278–287`; unchanged `journal/process-journal.ts:562–580`, bridge `current/companion`:201–235). Runtime còn production-disabled nên chưa chứng minh khai thác production, nhưng reusable admission boundary chưa đúng contract fresh/expired-deny.
- **Sửa hẹp:** giữ observer ngoài isolation queue; tách kiểm deadline thuần trên captured observation và chạy lại sau actual `withPrepared` verification, ngay trước action; kiểm lại sau action/fsync trước khi hook trả thành công. Không gọi observer/re-enter store dưới queue, không viết lại launcher. Nếu expired sau ghi, retain immutable companion/guard và throw để RELEASE đóng.
- **Regression cần có:** actual prepared fixture + latch giữ actual isolation queue; observer trả authority còn hạn; advance clock qua deadline rồi nhả queue; assert action không được gọi/không RELEASE. Thêm expiry trong action để chứng minh completion vẫn deny sau fsync. Bao phủ cả admitted challenge và certified receipt. Không chạy dynamic repro trong review này theo static-only/resource ruling.

#### Minor (Nice to Have)

**M1 — Medium, non-blocking: tên test crash của ledger mạnh hơn tình huống đang kiểm.**

- `d438ce1:v2/gateway/test/effect-ledger.test.ts:97–116` gọi `close()` có trật tự sau reserve rồi reopen, không kill process sau actual side effect/trước receipt. Test artifact tại dòng124–154 thực hiện write/reconcile trong cùng process. Các SIGKILL thật của `runtime-crash.test.ts:15–118` bao phủ launcher stages, không intent/receipt của logical ledger.
- Giữ các assertions hiện tại, nhưng mô tả đúng là reopen/pending recovery; trong lượt validation được cấp tài nguyên tiếp theo, thêm một owned child write actual artifact rồi SIGKILL trước `complete`, reopen/reconcile và đếm side effect vẫn đúng một lần. Đây là giới hạn bằng chứng, chưa có bằng chứng algorithm duplicate effect trong source đã review.

### Assessment

**Task quality: Needs fixes (I1).**

**Reasoning:** Cấu trúc authority và actual producer amendment giữ được fail-closed/immutable intent, nhưng expiry chỉ được kiểm trước một asynchronous barrier có thời gian chờ không giới hạn. Sửa consumer-local và regression theo I1 trước acceptance; không mở rộng sang native/certificate producer hoặc rewrite launcher.

### Scope và kiểm chứng

- Review đúng package **0c838d2 → d438ce1**, một commit, **21 files, +2057/-1**: 18 runtime-owned files gồm bridge/R3, cộng3 generated mapping/index files. Không review toàn dải worker baseline5c6fbaf hay các accepted peer tasks.
- Đã đọc đầy đủ task-reviewer rubric, brief, report và toàn diff. Đã đọc root/v2 index và gateway runtime/host/workflows flow; không `.codegraph`. `scout`/`code-review` SKILL.md không có trong catalog/đường dẫn skill đã tìm; đã báo controller và dùng direct edge-case scout cùng assigned two-part rubric, không dispatch child.
- Scout/named checks ngoài diff: queue/re-entry/cleanup authority → frozen actual `IsolationWorkspace.get/verify/withPrepared/cleanup`; durability/partial record → `AtomicRecords.writeExclusiveRecord/readRecord/transaction`; release eligibility/current authority → frozen `Launcher.release` và bridge `current/companion/reserve`. Không sửa các producer này.
- Kiểm 18/18 byte-count + SHA-256 trong `workspace-amendment/owned-final-sha.json` với immutable blobs **d438ce1**: **0 mismatch**. Report hash khớp `9ce3c74ce1cd37a61ac8e40768095353a333934560622eeffdc511cad190f1e4`.
- Đọc `workspace-amendment/commands.json`, `test-manifest.json`, `source-stability.json` và actual logs: build exit0; scoped strict exit0; affected cover **22/22**,0fail/skip/cancel,53178.869708ms (`affected-cover.log:77–84`); Biome15files no fixes (`biome-final.log:1`). Đây là evidence đã chạy của frozen candidate, không phải reviewer rerun.
- Historical105 cover không được cộng dồn hoặc coi là current-source proof. Historical bridge Biome3 warnings được worker ghi là untouched baseline; không gọi toàn producer lint pristine. Không có measured type-coverage/test-coverage percentage.
- Checklist tĩnh: concurrency/lock order/async ordering đã kiểm (I1); exceptions explicit propagation, callback failure đóng gate; DTO/caller/callee contracts đối chiếu actual producers; additive optional hook giữ compatibility; input/pin/path/hash checks tại consumer boundary; auth phụ thuộc captured trusted ports và absent deny; không thêm DB queries/N+1/schema; không thêm endpoint/secret plaintext/log export. Native bypass và same-UID confinement vẫn UNVERIFIED.
- Không chạy tests/build/PG/container/native/provider, không tạo process fixture, không sửa source/index/Git/plan state. Chỉ ghi báo cáo này.

### Plan follow-ups

1. Controller giao fix I1 trong runtime consumer, chạy targeted regression theo resource slot, freeze/hash lại affected files và review lại thay đổi.
2. Giữ Task3 chờ acceptance; không đánh dấu production/native certification hoặc toàn Phase04 READY từ22tests.
3. Task6/Phase06/Task7 tiếp tục sở hữu checkpoint/fallback authority, stable logical operation binding, actual current admission/certificate observer và measured full-tree certification; M1 là đề xuất nâng bằng chứng ledger trong lượt phù hợp.

### Unresolved Questions

- Không có câu hỏi cần owner trả lời. Controller quyết định lịch resource slot cho regression I1; production gates đã được nhận diện vẫn giữ nguyên.
