# Crew v3 R1-3 — Trợ Lý (bổ sung spec)

Ngày: 08/10/2026, Asia/Ho_Chi_Minh. Bổ sung cho [thiết kế v3](2026-10-05-crew-v3-paperclip-design.md) §3 (Trợ Lý, gói ngữ cảnh), [R1-2 gates](2026-10-07-crew-v3-r1-2-gates.md) và mục R1-3 của [kế hoạch stock-first](../../../plans/261006-0805-crew-v3-stock-first/plan.md). Plan thực thi: [R1-3](../../../plans/261008-0850-crew-v3-r1-3/plan.md); quyết định và ruling: [ledger](../../../plans/261008-0850-crew-v3-r1-3/sdd-ledger.md). Gói ngữ cảnh đã scout: [goi-ngu-canh.md](../../../plans/261008-0850-crew-v3-r1-3/goi-ngu-canh.md).

## Mục tiêu

Owner gõ một yêu cầu bằng chữ trên web (issue gốc giao cho agent Trợ Lý). Trợ Lý đọc docs dự án, tách yêu cầu thành issue con có blocker, gom theo gói ngữ cảnh, chọn model cho từng issue con và giao cho hai executor; mọi gate R1-2 vẫn do server ép. Issue con cùng gói do cùng một executor làm lần lượt và run sau resume đúng session của run trước. Research (không sửa code) đi template riêng không có integrator.

## Vai trò

| Vai trò | Ai | Thay đổi so với R1-2 |
|---|---|---|
| Trợ Lý | Agent `claude_local` riêng trên Mac, environment + worktree riêng, model mặc định sonnet (O10) | Mới. Là assignee/executor của issue gốc. Không có trong `CREW_POLICY_CONFIG` |
| Executor | Hai agent (O13), mỗi agent một environment SSH + worktree, `maxConcurrentRuns = 1` | Thêm agent thứ hai; instructions thêm research và nhánh xếp chồng |
| Reviewer, Integrator | Một agent mỗi loại | Reviewer thêm cách duyệt issue research |
| Owner | Board | Đánh dấu research bằng nhãn `research` khi tạo issue gốc; trả lời câu hỏi của Trợ Lý trong card interaction |

## Luồng một yêu cầu

1. Owner tạo issue gốc trên web, giao cho Trợ Lý. H4 gắn template gốc 4 stage; issue gốc có nhãn `research` thì gắn template research 2 stage `[review: reviewer, approval: owner]` (O15).
2. Trợ Lý được đánh thức (`issue_assigned`), đọc `docs/index.md`, `crew-docs where/flow`, rồi dùng `superpowers:brainstorming` (tự trả lời bằng docs, không hỏi trong terminal) và `superpowers:writing-plans` để ra danh sách gói và issue con. Kế hoạch đăng thành comment `crew-plan` trên issue gốc, không ghi file vào repo.
3. Thiếu thông tin mà repo không trả lời được: Trợ Lý tạo interaction `ask_user_questions` (`continuationPolicy: "wake_assignee"`, `resolverPolicy: "human_only"`) rồi `PATCH` issue gốc `blocked` kèm comment. Không bao giờ `in_review` (stock khởi động workflow). Chỉ hỏi **trước** khi tạo issue con. Owner trả lời → Trợ Lý được đánh thức và làm tiếp.
4. Tạo issue con ngay, không xin xác nhận (ruling): tuần tự `POST /api/issues/<gốc>/children`, mỗi con có `assigneeAgentId` (executor của gói), `blockedByIssueIds`, `blockParentUntilDone: true`, `assigneeAdapterOverrides: {"adapterConfig":{"model","effort"}}`, và các dòng marker trong mô tả (bảng dưới). H4 gắn template con.
5. Executor làm từng con theo R1-2. Con thứ hai của gói được đánh thức khi con đầu `done` (`issue_blockers_resolved`); hook H1 đặt `resumeFromRunId` của run cuối trên con đầu (O12), nên run resume đúng session.
6. Mọi con `done` → stock đánh thức Trợ Lý (`issue_children_completed`); Trợ Lý `PATCH` issue gốc `done` kèm tóm tắt → reviewer → integrator → owner → integrator push (code), hoặc reviewer → owner (research).

## Marker trong mô tả issue con

Mỗi marker là **một dòng riêng** của mô tả (khớp regex theo từng dòng, cờ `m`).

| Dòng | Regex | Ai ghi · ai đọc |
|---|---|---|
| `crew-bundle id=<gói> seq=<n>` | `^crew-bundle id=([a-z0-9][a-z0-9-]{0,39}) seq=([1-9][0-9]{0,2})$` | Trợ Lý ghi; H1 đọc để nối session; executor biết mình đang ở gói nào |
| `crew-model complexity=<mức> model=<id> effort=<e> reason=<lý do>` | `^crew-model complexity=(trivial\|small\|medium\|large) model=(claude-sonnet-5\|claude-opus-5) effort=(low\|medium\|high) reason=(.+)$` | Trợ Lý ghi (O14, lý do để owner sửa); chỉ để đọc, server không parse |
| `crew-stack on=<identifier>` | `^crew-stack on=([A-Z][A-Z0-9]*-[0-9]+)$` | Trợ Lý ghi khi con cần code của một con khác chưa merge; executor dựng nhánh từ `sha` đã duyệt của issue đó; reviewer xem diff từ `sha` đó |
| `crew-kind research` | `^crew-kind research$` | Trợ Lý ghi cho con research; executor không commit, báo cáo bằng `crew-report`; reviewer duyệt bằng `crew-review research verdict=approved` |

## Chọn model (O14, port từ v2 `model-policy`)

Bảng thuần `CREW_COMPLEXITY_MODEL` trong `server/src/crew/model-policy.ts`, chép nguyên vào `crew/agents/assistant.md` (test giữ hai bản trùng nhau):

| complexity | model | effort | Khi nào |
|---|---|---|---|
| `trivial` | `claude-sonnet-5` | `low` | Đổi chữ, fixture, edit cơ học (không haiku cho code) |
| `small` | `claude-sonnet-5` | `medium` | Bám khuôn có sẵn, một module |
| `medium` | `claude-sonnet-5` | `high` | Nhiều file một module, logic mới vừa |
| `large` | `claude-opus-5` | `high` | Lõi, bảo mật/phân quyền, migration, scheduler, hợp đồng công khai |

Không bao giờ `fable`, không `haiku` cho code. Thiếu đánh giá complexity thì không tạo issue (không có mặc định). Cùng gói dùng một model.

## Lọc override (bảo mật)

`assigneeAdapterOverrides` được merge nông vào `adapterConfig` của agent khi chạy, nên agent gửi `command`/`extraArgs`/`env` sẽ bỏ ghim Superpowers và wrapper. Khi actor là agent (H4 tạo issue, H2 sửa issue) và company có trong `CREW_POLICY_CONFIG`:

- Cho phép: `null` (xóa override), hoặc `{ "adapterConfig": { "model"?, "effort"? } }` với `model ∈ {claude-sonnet-5, claude-opus-5}`, `effort ∈ {low, medium, high}`.
- Mọi key khác (kể cả `useProjectWorkspace`) hoặc giá trị ngoài danh sách → 422 `crew_override_forbidden`, `violations` liệt kê đường dẫn (`adapterConfig.extraArgs`, `adapterConfig.model:claude-fable-5`…).
- Board không bị lọc (owner sửa model được).

## Chung session (O12)

- H1 (`crewBeforeClaim`, đã có) sau khi cổng tải cho claim chạy thêm `applyBundleResume`: run `queued` của issue B (chưa có session riêng cho B, chưa có `resumeSessionParams`) mà B có `crew-bundle id=X`, có blocker A `done` cùng `id=X`, và agent của run có `agent_task_sessions(taskKey=A)` → ghi `resumeFromRunId = lastRunId`, `resumeSessionParams`, `resumeSessionDisplayId` vào `contextSnapshot` của run (DB và object `run`), activity `crew.bundle_resume`. Lỗi → fail open (session mới), log warn.
- Không thêm hook (giữ 4/5). Nếu spike SP-1 chứng minh cách này không tới được adapter, dùng H5 `beforeWakeup` ở dòng đầu `enqueueWakeup` (owner đã duyệt), cùng logic chọn tiền nhiệm.
- Điều kiện ngoài server: cùng agent, cùng environment `in_place`, bản vá codec P3.

## Hai executor (O13)

Executor thứ hai `mac-claude-2`: environment SSH riêng (cùng host/cổng/secret/knownHosts, `in_place`, `crewLoadGate` 8/60), `remoteWorkspacePath` = worktree riêng `~/crew-agents/mac-claude-2` của cùng kho git, `maxConcurrentRuns = 1`. Trợ Lý giao mỗi gói cho một executor, cân số issue con chưa xong; danh sách executor nằm trong instructions của Trợ Lý (sinh bằng `apply-roles.sh agent <id> assistant <pin> <executorIds>`), không trong file cấu hình server.

## Ngoài phạm vi R1-3

UI map/card (R1-4), BMAD và chọn model theo máy/runtime khác (R2), hook pre-receive phía remote, tự giao issue gốc cho Trợ Lý, chặn agent tự `PATCH /agents/:id` (chỉ kiểm, xem plan).
