# Phase06/T3 gateway manifest — scoped FIX1 re-review

**SPEC: ✅ Đạt trong phạm vi P1/P2. QUALITY: Approved cho FIX1.** Không phát hiện finding mới do delta này gây ra. Đây không phải nghiệm thu toàn T3 hoặc production runtime.

## Phạm vi và provenance

- Normative findings: `task-3-slice-review.md`, P1 async pin aliasing và P2 FIFO blocking open.
- Đọc delta một lần, không mở lại changed files. Package SHA-256 đã đối chiếu: `5a58df43f72f5b3670eb019534e7ad7cdf5c844e888aaa539a23b6cf84bf66f1`.
- Đã đọc đầy đủ `task-3-report.md`, SHA-256 `dafa1d783397fd07709d5b048d60a895933423befb29c54426ec272abca00a05`, cùng cả năm raw FIX1 logs; hashes khớp report.
- Candidate trong report/controller: source `358de2402a9ba55d1f105a63a4c9adfafd2312bdf1d462587979f995a0a600e0`, tests `682ab64112b38513d75e438779fbf90c27a8e33fedd991a848032b023f6c7550`, doc `0e142e0d5adcb99bdc67a2d3296dc102cc2bf81e6a4aee2642b25d0de23ad926`. Reviewer xác minh package/report/log hashes; không đọc lại source để hash riêng.

## Dispositions

### P1 — CLOSED

`v2/gateway/src/assistant/workflow-manifest.ts:44–53,75–81`: `structuredClone` cả source và projection trước validation và await; nested derivation/options nằm trong snapshot sâu. Validation, source/projection matching, BMAD branch, registry resolve, manifest comparison và digest đều dùng các snapshot ấy. Không còn dùng caller-owned pins sau await. Trusted Registry contract đã kiểm trong original review vẫn phù hợp; không cần mở lại dependency.

`v2/gateway/test/workflow-manifest.test.ts:150`: regression dựng baseline pristine, dừng resolver bằng barrier, mutate `source.name`, `projection.runtime` và nested `derivation.options`, rồi so toàn bộ definition với baseline. RED raw chứng minh digest lệch trong code cũ; GREEN chứng minh equality trên bản sửa. Test kiểm đúng root cause, không chỉ mock một giá trị trả về mong muốn.

### P2 — CLOSED

`v2/gateway/src/assistant/workflow-manifest.ts:29–38`: thêm `O_NONBLOCK` cùng `O_RDONLY | O_NOFOLLOW`. `fstat` kiểm regular file trước `readFile`; nhánh từ chối vẫn đi qua `finally` đóng FD. Với FIFO không writer, reader không còn bị chặn tại open trước khi kiểm loại file.

`v2/gateway/test/workflow-manifest.test.ts:180`: fixture thay selected SKILL bằng FIFO, child chạy actual adapter với snapshot resolver; marker `RESOLVED` phân biệt reader boundary với lỗi import/setup. Watchdog 3 giây kill process group và đợi `close`; assertions đòi không timeout, exit 0 và `WORKFLOW_SKILL_MISMATCH`. RED raw ghi `SIGKILL`, `timedOut=true`, cùng assertion failure ở bước timeout sau boundary assertion. GREEN raw ghi `RESOLVED`, `code=0`, `signal=none`, `timedOut=false`; phép kiểm stderr nằm trong test đã pass. Fixture cleanup `finally` của original harness được giữ.

## Kiểm tra breakage mới và docs

- Source change giữ shape của `WorkflowDefinition`, digest keys và BMAD deny behavior; snapshot chỉ thay ownership của input. Exception tiếp tục propagate; không catch-and-swallow hoặc mở quyền mới.
- Hai tests mới dùng private scratch và subprocess có watchdog; không thay production process/admission code. Không có lý do mở rộng review sang native host/isolation hoặc server graph.
- `v2/docs/flows/assistant-workflows.md:14–17` mô tả đúng deep snapshots và nonblocking/fstat/close; phần dữ liệu/flow liên quan giữ các integration pending. Doc chuyển sang bảy headings theo yêu cầu PM, không thêm hành vi ngoài scope.

## Evidence đã đọc — không chạy lại

| Evidence | Kết quả trực tiếp từ log | SHA-256 |
|---|---|---|
| FIX1 RED | 5 pass, 2 fail; pin digest mismatch và FIFO watchdog | `10c6329499e956905a088b7f41d56ca84d47da7f2b4e2fccf21a1ab274fb826e` |
| FIX1 GREEN | 7/7 pass, 0 skipped/cancelled; FIFO child exit 0 | `fc8409cb82f434c7c588e36bf542b100384deb3833de14f8b608dd389fc3deb5` |
| Formatting | 2 files checked, 1 fixed | `c1d9a5de1d94d938776b1eda6040a4e6c93cd162993e40117700cb4691f82ee4` |
| Full gateway tsc | Log rỗng; exit 0 được report/controller ghi nhận | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Final scoped Biome | 2 files checked, no fixes | `4a92263598e249585b1641897db38d357d4f8ada18fd595f21e9174273bda84f` |

Không warning trong final GREEN/Biome output. Report ghi FIX1 pressure/page counts/CPU/disk trước từng launch và cleanup inventory; reviewer không tái đo các quan sát lịch sử. Các giới hạn resource evidence của lượt original vẫn nguyên, không được FIX1 biến thành certification PASS.

Không chạy Node, test, DB, Git, index, build, deps, browser, native helper hoặc child reviewer. Chỉ ghi file re-review này; không sửa plan state hoặc peer files.

## Kết luận phạm vi và unresolved

Hai findings gốc đều CLOSED; không còn blocker SPEC/QUALITY trong scoped FIX1. Root vẫn sở hữu flow-manifest integration/docs checks trước commit. BMAD trusted renderer, server run/gate graph, T2 authority integration, production host/isolation/admission và full T3 acceptance vẫn deferred; approval này không thay đổi chúng.

**Unresolved trong P1/P2: không.**
