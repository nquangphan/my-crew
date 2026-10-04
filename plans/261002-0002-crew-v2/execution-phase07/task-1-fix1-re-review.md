# CREWV2-701 — FIX1 scoped re-review

## Finding Verdicts

- **I1 — bounded cleanup và không chạy destructive follow-on sau UNKNOWN: NOT ADDRESSED hoàn toàn.** Lỗi treo do request gửi dở đã được sửa và có RED/GREEN thật. Coordinator theo dõi/hủy socket owned, từ chối kết nối mới khi shutdown (`v2/web/scripts/e2e-fixture.ts:251–252`, `:516`, `:544`); các phase có deadline, pool end có timeout, identity/STOP/verify thất bại thì helper không gọi bước sau (`v2/web/e2e/support/fixture.ts:37`, `:74–91`). DB và Docker remove kiểm abort sau bước await trước mutation (`v2/web/scripts/e2e-fixture.ts:331–361`, `:383`). Tuy nhiên scratch remove còn bỏ qua signal, gây đúng late destructive follow-on sau timeout/UNKNOWN; xem F1.
- **M1 — callback rejection falsy:** deferred theo PM; FIX1 không sửa và không mở lại làm blocker. Vẫn là Minor ở helper `withFixture` trong diff context, ngoài finding được giao sửa.

## New Breakage in the Fix Diff

- **F1 / Important — deadline mới chưa chặn scratch rm khởi chạy trễ.** `v2/web/e2e/support/fixture.ts:37–54` trả deadline và abort operation; `:88–90` trả UNKNOWN mà operation còn pending có thể tiếp tục. Call site `v2/web/scripts/e2e-fixture.ts:409–412` vẫn là `remove: async () => { await stat(...); ...; await rm(..., {recursive:true}); }`, không nhận/kiểm AbortSignal. Trình tự cụ thể: stat trong REMOVE chậm quá5s → helper trả REMOVE_DEADLINE → coordinator ghi `unknown:SCRATCH_REMOVE` và giữ registry (`:417–419`) → stat trả về đúng dev:ino → callback khởi chạy rm, xóa scratch và registry sau UNKNOWN. Đây là tương tác mới do áp timeout lên callback cũ, không phải review lại phạm vi khác. **Sửa hẹp:** nhận signal và kiểm ngay sau stat, trước rm, để không khởi chạy mutation sau abort; kiểm tương tự các await trước destructive operation khác. Thêm regression trì hoãn stat/identity của remove qua deadline rồi cho resolve, xác nhận không gọi rm và registry còn. Không cần lặp UI hoặc toàn suite. Phân biệt rõ operation đã gửi trước timeout có thể cần reconcile với operation mới khởi chạy sau timeout; finding này là trường hợp thứ hai.
- Không phát hiện Critical hoặc Important khác trong delta ba file.

## Out-of-Scope Observations

- Không có finding mới ngoài delta. M1 giữ ở ledger, source UI11path và kết luận MCP cũ không được review lại.
- Historical final4 raw logs vẫn chưa truy xuất độc lập; không dùng final5 để dựng lại lịch sử. FIX1 đã có artifact log thật cho RED, focused GREEN, final5, typecheck và Biome.
- Report `task-1-preflight.md:278` ghi6,123s; raw final TAP ghi `duration_ms 6098.981792`. Có thể là wrapper wall time khác TAP; khi dẫn số hãy ghi đúng nhãn. Không coi chênh lệch này là test fail hoặc fabrication.

## Checks and Evidence

- Đọc một lượt full850 dòng delta, saved14path baseline → ba fixture/test paths; không Git, Node, tests, PG, browser hoặc install. Hash diff khớp `2f71d01b339e9e4131178f8cfb013b31130ed58b743194b899aa1f6ed24bf69d`; preflight khớp `ca99ac3b4a4d864fa3b2fef8fb428f0df14df9b4beb424fde33b54a6a8661808`.
- Ngoại lệ đọc source duy nhất: hunk delta kết thúc ngay ở `remove: async () => {` của scratch, nên đọc `scripts/e2e-fixture.ts:395–430` để khép callback cần phán xét F1. Không đọc producer/server code hoặc rà lại task gốc.
- RED log nguyên văn có1 fail `ACTIVE_REQUEST_CLOSE_DEADLINE`; SHA `583f2b2d025fe35d3b77dbf079fb366bab52515ef5cc281d191deb66f36a6115`. Focused GREEN1/1, SHA `abae0366797fbfae3c305eb09b19d310e029233098c2249f258c8d51d3f2a50a`; testcase mới dùng actual raw TCP request body chưa hoàn tất tới API owned (`v2/web/test/fixture-lifecycle.test.ts:150`).
- Final lifecycle artifact `task-1-fix1-lifecycle-final.log` đọc được đầy đủ5/pass5/fail0/cancelled0/skipped0, actual partial-body cleanup1795.332459ms và SIGTERM child2027.144291ms; tổng TAP6098.981792ms. Hash khớp `b463f2d3f7d6d85a4f91919b22251469e40ae7256f50e94dd035fbc852b3a363`. Cleanup witnesses gồm exact resources, đều stopped/removed, reason null. Hai UNKNOWN tests vẫn là unit policy; final này chưa thử REMOVE deadline rồi late callback, nên không phủ F1.
- Đã đọc/băm typecheck output `tsc --noEmit`, SHA `7b03903838eaa7a5bfa440398bd0c61811a385f32768e9e19efd9040136ed835`, và Biome `Checked 3 files ... No fixes applied`, SHA `2a118c6d22331a9d205d1066d761a01093204f39eddffa9dfd6b98e828a77179`. Exit0 do report/root capture; các log này không chứa exit metadata riêng. Không thấy warning/error ở final logs đã đọc.

## Verdict

**Fix round: Findings remain open — I1/F1 (scratch late rm after deadline).** Active-request liveness đã đạt bằng chứng, nhưng Task1 chưa ready để đóng quality gate cho tới khi chặn destructive follow-on còn lại. Root tiếp tục sở hữu docs/coverage/integration trước commit; không cần quyết định UI hoặc permission mới.
