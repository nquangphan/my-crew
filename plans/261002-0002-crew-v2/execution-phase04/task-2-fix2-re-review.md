# Independent scoped re-review — Task04/2 FIX2/5

**Candidate:** `49e233350c4acae5ab0e4f4724fc08b7fb77dd53`, base `dd2a0e1`. **SPEC: READY. QUALITY: READY.** Residual R2-FIX1 CLOSED; không có confirmed P1/P2 mới trong scope. R1/R3/R4/R5/R6 giữ CLOSED từ re-review trước. Kết luận này cho scoped implementation và evidence đã nêu; không cấp runtime/live certification hoặc admission cho consumer chưa tích hợp.

## Scope và source binding

Workflow giữ independent requesting-code-review. Đã đọc toàn bộ `task-2-fix2-report.md`, `fix2-source-inventory.json`, `final-verification.json`, ba-path patch, final commands/logs và test manifest, đối chiếu original/FIX1 review context cùng PM ledger ruling17:10 và checkpoint17:20. Đọc actual unchanged CurrentCredentialResolver để kiểm đúng contract được tái dùng; không xét peer HTTP retry/isolation/attachments/tickets/010.

Patch SHA256 **d3d36f18f4b45413456fa6d1bbce6922a678a300b55adc148db37da3af0895db**, khớp byte-for-byte `git diff dd2a0e1..49e2333 -- <3 owned paths>`. Reviewer kiểm **23/23** own SHA khớp working files, inventory, snapshot final và `git show 49e2333:<path>`. Ba changed paths và SHA:

| File | SHA256 |
|---|---|
| `v2/gateway/src/models/credential-provisioning.ts` | `b082fe0c1a318a66cb4f85c507d6bebd10283b780f7cd230ca5c26f402d75e27` |
| `v2/gateway/test/credential-provisioning.test.ts` | `e5b2c3aee2a3f5ea8f14c025d6f92c1d72e57f8850858878ac2789ffa08bd406` |
| `v2/docs/flows/gateway-models.md` | `c768b8ca6b041bd76c0023ac8c58270c5807c7e440aa083dc34a213b2e732028` |

Resolver, broker và server production giữ nguyên. Migration008 accepted SHA vẫn `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f` theo inventory/verification; không có schema diff001–010. PM ledger ghi all/staged/root docs và diff PASS; R3 flow mô tả đúng behavior mới, không mở authority.

## R2 disposition và chất lượng

**CLOSED tại `credential-provisioning.ts:349`–364.** Sau replay loop, nhánh định trả stored dùng CurrentCredentialResolver.resolve(provider, revision, signal) và assertCurrent cho từng provider. Fresh desired và current binding phải cùng machine/revision/API/provider/endpoint/protocol; models/localHttp cũng phải còn khớp expected. Resolver kiểm actual broker.assertStored và so ref/currentOperationId giữa hai mẫu. Missing/malformed/unreadable metadata, local ref mất hoặc observed binding change rơi vào pending, raw error không thoát.

| Invariant | Source/regression evidence |
|---|---|
| Current storedA nhưng localA mất không báo stored | Public sync trả pending,0 ACK,0 secret writes; close/reopen vẫn pending. Durable queue/envelope/immutable intentA được đối chiếu exact. |
| HistoricalA thiếu không hạ currentB khỏe | BindingB và localB được xác minh; trả stored,0 ACK,0 rewrite; queue/historyA vẫn còn. Không suy current từ UUID/cursor. |
| ACKA không promote pendingB | Khi localA được fixture khôi phục, replay exact ackA thành công nhưng public result vẫn pending. Chỉ fresh desired/binding storedB cùng localB mới cho stored; không phát sinh ACK thêm. |
| Metadata scope và race | Machine/revision/API/provider missing/duplicate/foreign/endpoint/protocol/status/ref foreign/refA missing và thrown read error đều pending. Operation đổi giữa resolve/assertCurrent → pending. Stored refB với currentOperationId=null vẫn hợp lệ. |
| Immutable recovery không bị thay | Existing expiry/revision-change/lost-receipt/restart/same key/body/ref, altered-envelope và missing-intent negatives vẫn trong focused/final captured run. Queue chỉ settle sau accepted ACK; immutable intent giữ. |

Sửa production chỉ thêm consumer của authority hiện có, không parallel lookup/cache mới hoặc current-ref pointer riêng. Register/replay logic không được cấp quyền mới. Read-only GET được tách rõ với ACK;0 ACK không có nghĩa0 metadata reads. Timeout30s giới hạn chờ read qua resolver, không là network lease hay phép chạy provider. Initial pending giữ nguyên tới lượt fresh authority kế tiếp, phù hợp approved semantic của R2.

Không có actual gap mới từ source/evidence để biện minh thêm canary hay broad rerun. Reviewer không chạy thêm fixture. Test mới kiểm durable public interface và failure behavior, không chỉ mirror helper implementation; negative historicalA/currentB là guard quan trọng chống blanket-demotion.

## Captured verification

Reviewer kiểm trực tiếp logs và command exit metadata:

- RED provisioning6:5PASS/1FAIL, exit1; actual stored khác expected pending tại same-current/localA-missing case. Đúng lỗi gốc, không infrastructure failure.
- GREEN provisioning6/6 PASS, exit0.
- Final standalone **114/114 PASS**,0fail/cancel/skip,75899.289709ms, exit0; explicit17 gateway test files trên frozen556+own23. Build/typecheck/Biome15TS exit0.
- `final/source-stability.json`:238files,0delta; working owned changes rỗng. Snapshot inventory own23 khớp candidate hiện tại.
- Không fresh PG/server suite. Mock authenticated read port/full desired-binding DTO không phải live-server evidence. Existing actualPG current-binding4 thuộc evidence trước.
- FIX1 standalone113/113 và mọi RED/canary trước giữ riêng; không union PASS. Original server218/219 + repaired wholecase1/1, gateway103/104 + unchanged narrow1/1 và93/104 compile-preparation failure giữ nguyên lịch sử;114PASS không chứng minh baseline flake root cause đã sửa.

## Cleanup và quyền thao tác

Captured receipts ghi ba snapshot roots removed; RED/GREEN mỗi4fixture roots, final7fixture roots identity-matched/absent và4fake helper created/reaped. Reviewer kiểm read-only cả ba snapshot path cùng15fixture paths hiện không tồn tại. Không suy lock PID nếu fixture không ghi; AtomicRecords close/reopen được await trong test. Hai old unreceipted roots zQeH26/DTjkSU vẫn RETAIN; không sweep.

Lượt reviewer chỉ ghi báo cáo này; không tạo runtime root/process/container/helper, không source/Git mutation/subagent/live call/owner Keychain/shared service/global config. Reviewer FIX1 canary và initial evidence không sửa; final canary SHA `ddc83fc868226789e38506835db1deb2358df41630c5dc9f8aab92e725052583`, log SHA `6b8a5cdf9ca2cd9657c5a8ba73b30aba5df27df51337e4440deb6bd98003b406` kiểm lại khớp.

## Giới hạn và handoffs giữ nguyên

- Signed native Keychain/fulltree/CLI auth/live tools/vision/cost certification vẫn UNVERIFIED theo original review; fixture/port không phải runtime PASS.
- sync_models command composition và callCurrent consumer integration vẫn approved later handoff. Provisioning result/report không là permit.
- Current authority là sampled readonly metadata; không guarantee mutation sau mẫu cuối hoặc atomic network lease.
- Năm finding FIX1 đã CLOSED không bị mở lại khi không có actual new gap. Peer producers và schema010 không thuộc scoped acceptance này.

**Disposition gửi PM:** có thể accept Task04/2 candidate49e2333 với original full review + FIX1/FIX2 closure history và các giới hạn nêu trên. Không còn implementation fix yêu cầu trong scoped batch này.
