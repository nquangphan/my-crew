# Task6 FIX1/5 — scoped independent re-review

Ngày: 2026-10-02. Base **490001c**, candidate **ced6bb1**. Original reviewed candidate: **f6ca0a4**.

**SPEC: READY. QUALITY: READY. F1/P2: ADDRESSED.** Không còn finding mở và không thấy blocker mới trong bốn file FIX1. Kết luận nghiệm thu phạm vi Task6; overall runtime vẫn **UNVERIFIED**, production disabled.

## Binding và phạm vi

Đã đọc original `task-6-review.md`, toàn bộ appendix FIX1 trong `task-6-report.md`, exact bốn-file patch và các artifact validation/cleanup liên quan. Review chỉ `inventory.ts`, ba callers trong `workspace.ts`, `isolation-workspace.test.ts` và gateway-workflows R3; không review lại hoặc sử dụng peer contracts/protocol/model/attachment changes.

Tự kiểm **4/4 source rows** khớp mode/bytes/SHA và **22/22 evidence rows** khớp bytes/SHA. `task-6-fix1-review-package.diff` dài **16,044 bytes**, SHA-256 **`47e9b4d754dbe9a0209b71bf972fa8bddf3c4db61f17de3a99d5ca9f7a92596c`**, đúng bốn paths. Candidate binding dựa exact PM commit/diff cùng frozen bytes; reviewer không gọi Git.

Original report được lưu riêng ở `base-task-6-report.md`, SHA **`c0b793d09e1877d35ef46d408a43bf96be05c2df8be8501b2c54eb210b4b303d`**, khớp row của original evidence inventory. Appendix không che hoặc thay lịch sử failure và evidence gap.

## F1 đã đóng

- `inventory.ts:148–163` mặc định không skip `.git`; root hoặc nested `.git` đều thêm `GIT_DISCOVERY` blocker. Optional exemption phải đúng `join(root, '.git')`, sai boundary bị từ chối. So exact full path không vô tình miễn nested metadata.
- Chỉ ba execution-workspace audit callers truyền exemption. Khi prepare, full Git inventory riêng được audit và hash trước persist prepared state; khi verify, Git inventory được kiểm lại trước execution-workspace audit. HOME và audit Git metadata vẫn không truyền exemption.
- Vì HOME `.git` bị từ chối trước recursion, hardlink/symlink/unknown bytes trong đó không còn bị đánh giá là HOME sạch. `verify()` trả CROSS_WORKFLOW_SOURCE trước `measure`; không thêm read grant, caller proof hoặc thay source/projection/native receipt authority.
- Actual regression RED trên frozen f6ca0a4 + test tái hiện chính xác finding: HOME foreign hardlink trả **UNVERIFIED,7 commands**, test expected FAIL thất bại. GREEN trên source sửa: HOME hardlink, root HOME symlink và nested HOME/cache symlink đều **FAIL/CROSS_WORKFLOW_SOURCE,0 commands**.
- Các negative liên quan kiểm nested metadata tại workspace Git và pack tamper đều reject trước command. Khôi phục bytes cho phép legitimate workspace chạy preflight UNVERIFIED và shell objectdb-denial PASS. Như vậy fix không vô hiệu hóa separate Git inventory hoặc nới sandbox để qua test.
- Test fixture unlink/rmdir các entry mới sau đối chiếu device/inode/UID. Không sửa runtime source/proof, không coi hardlink path absence hoặc PID/groupempty là STOP.

## Validation và giới hạn

Đã parse raw RED/GREEN logs và đối chiếu `regression-summary.json`, exact argv/exit trong `red-command.json` và `verification-final.json`:

- RED:1 test FAIL như kỳ vọng, không gọi là kết quả xanh.
- Final affected suite: **2 explicit isolation files,6/6 PASS,0 fail/skip**, wall12.97s; strict scoped types exit0; Biome3 changed TS files không error/warning, không áp dụng fix ở lượt cuối.
- Snapshot captured từ `f6ca0a4:v2` + own4-file overlay; snapshot base hashes của bốn isolation modules khớp original candidate, final4 overlay hashes khớp inventory hiện tại. External loader chỉ bare tar-stream và exact declaration path như review trước; không wildcard, không bỏ strict/library checking hoặc import peer code.
- `CREW_ISOLATION_SKIP_DISCOVERY=1` chỉ gate hai đoạn test discovery; không đi vào production code. Các regression filesystem, source/pin/config tamper, missing receipt/reopen vẫn chạy. Khi không đặt flag, original CLI probe behavior giữ nguyên.
- Không có lần127-cover, CLI init/probe, model/provider, DB/container mới trong FIX1. Lịch sử **126/127**, narrow cũ**2/3**, guard repair**3/3** và7 overall runtime results UNVERIFIED giữ riêng; không cộng thành union PASS.

Reviewer không chạy thêm suite/canary: captured actual RED/GREEN đã lấp đúng khoảng trống F1, code paths nhỏ và không còn nghi vấn hành vi cần probe mới. Không tuyên bố reviewer trực tiếp chạy6 tests. PM báo docs all/staged/root staged/canonical/diff checks PASS; reviewer kiểm R3 diff, không chạy lại Git/docs staging gates.

## Resources và cleanup

Đã đọc `reconcile-once.py`: `cleanup-plan.json` được tạo exclusive, fsync file và parent **trước** deletion; result tạo riêng, bind SHA plan. Tự hash xác nhận plan/result khớp. Tự đối chiếu mọi embedded command receipt với protected receipt tương ứng: RED30 commands/30 receipts khớp, GREEN43 commands/42 receipts khớp và đúng1 reserved intent thiếu receipt.

RED root nonce `eae02eb3-3fa9-4811-96ca-ff63ab778bbe`, device16777229/inode64051971/UID501 được captured deleted-after-closure. Reviewer kiểm exact path hiện absent. GREEN root nonce `9088d6ca-984b-45fc-acbc-e527735630a9`, device16777229/inode64056156/UID501 giữ **5,033,559 bytes** theo captured plan vì deliberate missing receipt `e4f368bc-02b3-425e-b378-8c334975678a`; pin/history không được release. Không rescan/reap UNKNOWN hoặc suy cleanup authority từ trạng thái PID.

Snapshot exact identity/dev/inode/UID có cleanup record sau source stability và runner completion; reviewer kiểm path hiện absent. Original UNKNOWN, bốn historical identity gaps và original overwritten cleanup-table limitation vẫn nguyên; FIX1 plan không thay proof lịch sử. Reviewer không tạo process fixture/temp root/DB/container/native runtime hoặc sửa settings; không có own cleanup cần thực hiện ngoài báo cáo này.

## Handoff

Cho phép PM nghiệm thu **Task6 FIX1 ced6bb1** trên phạm vi đã duyệt. Không yêu cầu batch sửa tiếp. Các gate Phase04 native Read/Skill/MCP/child/load+invoke/full-tree, linked owner binding, Phase06 dispatch/Phase08 result verifier và signed deployment vẫn giữ nguyên; không cấp runtime certificate từ no-model tests, init hoặc source hashes.
