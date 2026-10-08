# R1-3 Trợ Lý — ledger

Tiến độ, tài nguyên, quyết định của owner (O*) và ruling của Trợ Lý. Mọi giờ là Asia/Ho_Chi_Minh.

## Tài nguyên

| Lúc | Mac mini load (1/5/15) | RAM trống | VPS RAM khả dụng | Run VPS | Quota | Ghi chú |
|---|---|---|---|---|---|---|
| 08/10 08:50 | 17,4 / 20,1 / 21,1 | 29% | 5,4 GB | 0 | tuần ~30% (đo 07/10 17:40) | Android emulator, iOS simulator, Orca của owner chiếm tải; run agent sẽ bị cổng tải (8) giữ |

## Tiến độ

| Lúc | Bước | Ai · model | Trạng thái |
|---|---|---|---|
| 08/10 08:52 | Scout gói ngữ cảnh R1-3 | scout · sonnet | xong 08:56 (`goi-ngu-canh.md`) |
| 08/10 08:58 | Owner chốt O12–O15 | — | xong |
| 08/10 09:00 | Spec + plan R1-3 | planner · opus | xong 09:35 (`plan.md`, `session.md`, `policy.md`, `roles.md`, `env.md`, spec) |
| 08/10 09:35 | DỪNG theo lệnh owner | — | chờ owner bảo chạy tiếp; câu hỏi Q1–Q3 + `crew-stack` chờ chốt |
| 08/10 09:40 | Spec + plan R1-3 viết xong (`plan.md`, `session.md`, `policy.md`, `roles.md`, `env.md`, spec `2026-10-08-crew-v3-r1-3-assistant.md`) | planner · opus | xong, chờ owner đọc |

## Quyết định và ruling
- O12 (owner 08/10 08:58): chung session giữa issue con cùng gói — spike đặt `resumeFromRunId` trong H1 trước (giữ 4/5 hook); không được thì dùng H5 `beforeWakeup` (hook một dòng đầu `enqueueWakeup`, 5/5) — owner duyệt trước.
- O13: 2 agent executor chạy song song (mỗi agent một environment SSH + worktree riêng); reviewer, integrator mỗi loại một.
- O14: Trợ Lý chọn model cho từng issue con: sonnet (bám khuôn) hoặc opus (lõi/bảo mật/migration/scheduler); không haiku cho code; không bao giờ fable. Ghi lý do vào issue; owner sửa được. Override chỉ cho `model`/`effort` (H2/H4 lọc `assigneeAdapterOverrides`).
- O15: research (không sửa code) dùng template 2 stage: reviewer → owner; không integrator, không push, không docs gate.
- Ruling: Trợ Lý tạo issue con ngay, không xin owner xác nhận danh sách — vì owner không muốn đứng canh; chỉ hỏi (interaction `ask_user_questions` + `blocked`) khi thiếu thông tin — sai thì thêm bước xác nhận.
- Ruling: gói ngữ cảnh chia theo module, mỗi gói ≤ ~7 file nặng — vì giống luật nhan-viec — sai thì chỉnh trần.
- Owner 08/10: plan xong thì DỪNG, không giao worker — Mac mini đang chạy nhiều dự án. Chờ owner bảo chạy tiếp.

## Ruling khi lập plan (08/10/2026)

- Ruling (O12): nối session ở H1 bằng cách ghi `resumeFromRunId`, `resumeSessionParams`, `resumeSessionDisplayId` vào `contextSnapshot` của run (DB có điều kiện `status='queued'` + object `run`) **sau** khi cổng tải cho claim, lấy thẳng `agent_task_sessions(taskKey = issue trước)` (`lastRunId`, `sessionParamsJson`) thay vì gọi `resolveExplicitResumeSessionOverride` — vì hàm stock là closure trong `heartbeatService`, `executeRun` đọc lại run từ DB và ưu tiên tham số tường minh hơn reset của `issue_assigned`, và Crew không được import `heartbeat.ts` (vòng import) — sai thì SP-1 đỏ và chuyển sang H5 `beforeWakeup` (owner đã duyệt).
- Ruling: chỉ nối khi đủ cả: issue B giao cho agent của run, B có `crew-bundle`, agent chưa có session riêng trên B, blocker trực tiếp A cùng gói, `seq` nhỏ hơn, A `done`, agent có task session trên A; nhiều ứng viên thì `seq` lớn nhất; lỗi thì fail open (session mới, không giữ run) — vì một run chạy session mới chỉ tốn token, còn giữ run làm kẹt việc — sai thì gói lớn mất ngữ cảnh khi DB chập chờn đúng lúc claim.
- Ruling: marker gói là **một dòng bất kỳ** của mô tả `crew-bundle id=<a-z0-9->{1,40} seq=<1-999>`, không cột mới, không `billingCode`, không `originKind` — vì giống `crew-fix base=` đang dùng và `originKind` có nghĩa với watchdog/recovery — sai thì người sửa mô tả làm mất marker (run sau chỉ mất resume).
- Ruling: thêm dòng `crew-stack on=<identifier>` cho con cần code của con khác chưa merge; executor dựng nhánh từ `sha` của `crew-review … approved` mới nhất của issue đó, reviewer diff từ `sha` đó — vì nhánh con mặc định từ `origin/HEAD` nên con thứ hai cùng gói không thấy code con thứ nhất (integrator chỉ merge khi xong cả yêu cầu) — sai thì con sau thiếu code con trước và integrator gặp conflict. Mỗi con tối đa một `crew-stack`; phụ thuộc code từ hai gói thì gộp gói.
- Ruling (O14): bảng `CREW_COMPLEXITY_MODEL` = v2 `DEFAULT_COMPLEXITY_MAP` đổi `trivial` từ haiku/low sang `claude-sonnet-5`/low; large `claude-opus-5`/high; danh sách cho phép = model của bảng; effort `low|medium|high`. Chỉ port bảng (và ý "không có mặc định khi thiếu complexity" vào instructions), không port `resolveModel`/`clampModel`/`RoleStage` — vì server chỉ cần danh sách cho phép, Trợ Lý chọn theo bảng — sai thì cần hàm chọn model phía server khi R2 thêm máy/runtime khác.
- Ruling: `workflow-policy` và `completion-policy` của v2 không port — vì đã thay bằng ghim Superpowers + wrapper (R1-2) và H2; ý "research không cần merge/docs" thành template research — sai thì thiếu kiểm hoàn tất kiểu v2 cho loại việc mới ở R2.
- Ruling (bảo mật): agent đặt `assigneeAdapterOverrides` chỉ được `null`/`{}`/`{adapterConfig:{model?,effort?}}` trong bảng; sai → 422 `crew_override_forbidden` (từ chối, không lặng lẽ cắt) ở cả H4 lẫn H2; board không lọc; company vắng file cấu hình giữ stock — vì override merge nông vào `adapterConfig` nên `extraArgs`/`command`/`env` bỏ ghim Superpowers, và lặng lẽ cắt làm Trợ Lý tưởng đã chọn model — sai thì một tính năng stock đặt override qua agent (chưa thấy) bị 422.
- Ruling (O15): issue gốc research nhận diện bằng **nhãn `research`** (so `lower(name)`, cùng company) lúc board tạo, không gửi `executionPolicy`; H4 gắn `[review reviewer, approval owner]`; gắn nhãn sau khi tạo không đổi policy; Trợ Lý nhận diện research theo số stage của policy đã ghim, không theo chữ — vì nhãn có sẵn trên UI stock và R1-4 gửi được `labelIds` — sai thì owner quên nhãn thì research đi 4 stage và kẹt ở docs gate (board sửa policy hoặc tạo lại).
- Ruling: yêu cầu research chỉ có con research (`crew-kind research`: executor không commit, báo `crew-report`; reviewer duyệt `crew-review research verdict=approved`), không trộn con code — vì research không qua integrator nên commit của con code sẽ không được merge — sai thì owner muốn "research rồi làm luôn" phải tạo hai yêu cầu.
- Ruling: Trợ Lý không có trong `CREW_POLICY_CONFIG`, không thêm `assistantAgentId` — vì H4/H2 không cần biết Trợ Lý (agent nào tạo con cũng bị lọc như nhau) và owner tự giao issue gốc cho Trợ Lý trên web — sai thì cần tự giao issue gốc (R1-4 hoặc sau).
- Ruling (O13): danh sách executor của Trợ Lý nằm trong AGENTS.md của nó, sinh bởi `apply-roles.sh agent <id> assistant <pin> <id1>,<id2>` — vì server không biết executor nào và R1-2 đã bỏ vai trò trong metadata agent — sai thì đổi executor phải chạy lại `apply-roles.sh`.
- Ruling: Trợ Lý giao mỗi gói cho executor có ít issue đang mở nhất (hòa thì người đứng trước) — vì đơn giản, không cần scheduler — sai thì hai gói nặng có thể dồn một executor khi số issue mở bằng nhau.
- Ruling: Trợ Lý chỉ hỏi owner trước khi tạo con, một lượt gộp; sau khi có con thì không hỏi trên gốc — vì `blockParentUntilDone` làm gốc có blocker và `claimQueuedRun` hủy run trên gốc khi blocker chưa xong — sai thì câu hỏi giữa chừng phải đi qua issue con (executor `blocked`).
- Ruling: kế hoạch của Trợ Lý là comment `crew-plan` trên issue gốc + các issue con, không ghi file plan vào repo dự án — vì Trợ Lý chỉ đọc repo và mọi thay đổi file phải qua executor/reviewer/integrator — sai thì mất bản plan dài khi comment quá giới hạn (chia nhiều comment).
- Ruling: `brainstorming` của Superpowers dùng ở chế độ tự trả lời từ docs/code (không hỏi trong terminal) — vì run headless không có người đọc — sai thì bỏ brainstorming khỏi Trợ Lý nếu AC-3 thấy run treo.
- Ruling: Trợ Lý chạy model mặc định sonnet (O10) — vì owner chốt agent thật sonnet — sai thì nâng Trợ Lý lên opus nếu AC-3 thấy tách việc kém (cần owner chốt, xem câu hỏi Q1).
- Ruling: ba worktree fork `paperclip-r13-{session,policy,roles}` song song; `core-hooks.ts` và `crew/ops/inspect-image.sh` chỉ gói `session` ghi; `policy` thêm trường tùy chọn vào `IssueCreateFields` mà không sửa `IssueCreateLike` — vì tránh hai nhánh cùng sửa một file — sai thì conflict nhẹ khi gộp `crew/r1-3`.
- Ruling: AC-3 Cổng 3 không áp dụng (UI là R1-4); owner trả lời interaction trên UI stock bằng tay — vì R1-3 không đổi UI — sai thì card interaction stock không hiện và cần trả lời qua API (ghi vào report).

## Câu hỏi còn mở cho owner (08/10)

- Q1: Trợ Lý chạy **sonnet** (theo O10) hay **opus** (tách việc/chọn gói là việc kiểu lập kế hoạch)? Plan đang để sonnet; đổi chỉ là `PATCH` model của agent.
- Q2: AC-3 Cổng 2c thấy agent tự `PATCH /api/agents/<chính nó>` đổi `adapterConfig` được thì làm gì: chặn bằng hook thứ 5 (đụng ngân sách nếu SP-1 đã dùng H5) hay chặn ở plugin/route khác? Plan dừng hỏi khi gặp.
- Q3: Lúc chạy AC-3, Mac mini đang tải 17–21 (emulator). Owner tắt emulator trong khoảng chạy, hay chấp nhận chờ cổng tải (có thể >1 giờ mỗi run)?
