# Review độc lập skill Trợ Lý PM

Ngày 05/10/2026, múi giờ Asia/Saigon. Reviewer: `pm_skill_review`. Đây là forward-test bằng suy luận trên tình huống được giao, không phải dispatch/benchmark thực. Không spawn agent, sửa skill, chạy suite, đo quota thật hoặc truy cập credential. Chỉ ghi file này; giữ mọi sửa đổi của agent khác.

## Nguồn và phạm vi

Đọc `.agents/skills/tro-ly-pm/SKILL.md`, subagent-driven-development, dispatching-parallel-agents, `docs/index.md`, roadmap và ledger hiện tại. Không đọc báo cáo validation của worker để giữ độc lập. Số 1,05%, dữ liệu RAM cũ, job 4 GiB và 4 seats là input giả lập; không lấy số 15% trong ledger của phiên khác thay input. Plan có constraint planning cũ nhưng ledger ghi owner đã cho execution; forward-test không tự thực thi roadmap.

## Forward-test: quyết định cụ thể

**Admission ngay bây giờ:** reserve mới nhất 1%; remaining 1,05% chỉ còn margin 0,05 điểm phần trăm. Chưa có measured closure cost nên **không admit task mới**, kể cả hai edit độc lập hoặc successor cùng worker. Worker còn context không tạo quyền vượt quota. Task chưa admit → `waiting_quota`; task đã admit giữ state hiện tại và đi tới review/closure nếu provider còn phục vụ. Không hứa floor đúng 1% vì usage delay/active calls. Không tự giết test 4 GiB nếu không xác minh ownership.

**RAM/seats:** snapshot cũ không đủ cho bất kỳ follow-up/review/fix nào. Trước từng dispatch lấy timestamp, CPU/load, RAM/pressure/swap, disk, jobs và owner, seats, quota mới. Trừ peak test 4 GiB cùng OS/PM reserve khỏi budget đo được; không đổi memory_pressure% thành free GiB. Không khởi chạy heavy suite thứ hai. Bốn seats tính cả PM: tối đa ba agent nhưng chừa một reviewer seat, thường tối đa hai worker nhẹ; nếu test thuộc agent thì agent đó chiếm seat, nếu process riêng vẫn tiêu RAM/CPU. Không mặc định hai worker khi chưa đo.

Bảng dưới là routing **provisional sau quota phục hồi và survey**. Không bịa exact path: `R` là tập file registry dùng chung; `U`/`D` là hai tập UI/docs rời nhau do scenario cung cấp. Trước admit phải thay bằng exact paths/interfaces/tests từ baseline; thiếu map thì vẫn chưa ready.

| Task/gate | U,C,I; điểm; lý do | Model/effort dự kiến | Ownership/context và review |
|---|---|---|---|
| R1 Install/version atomic state | 2,2,2; 7; chưa khảo sát và update nhiều state | `gpt-6.1-sol` high | Worker registry owns R; reviewer riêng; test checksum/partial install/failure rollback |
| R2 Immutable active-run pin | 2,3,3; 9; authority/concurrency ảnh hưởng job sống | `gpt-6-astra` high | Cùng registry context nếu worker/model phù hợp; chỉ sau review R1; reviewer `gpt-6-astra` high; test update không đổi pin active run |
| R3 Retention reference safety | 2,3,3; 9; GC có thể phá recovery active run | `gpt-6-astra` high | Serialize R sau review R2; reuse worker R2; reviewer riêng; test referenced release không bị xóa và orphan đủ điều kiện mới xóa |
| U1 UI edit từ prose | 1,0,1; 3; nhỏ nhưng có judgment | `gpt-6.1-sol` medium | Own U; reviewer `gpt-6.1-sol` medium; acceptance UI với API/DB thật nếu thay hành vi |
| D1 Exact mechanical docs edit | 0,0,0; 1; đã có replacement đầy đủ | `gpt-6-luna` low | Own D; reviewer `gpt-6.1-sol` medium; kiểm diff/links/chuẩn docs; nếu prose judgment thì rescore/chuyển standard |

Allowlist hiện cung cấp ba model trên; vẫn phải kiểm provider/runtime thực khi dispatch. Model không phải báo giá. Chỉ reuse worker hiện có khi role/workflow pin/permission và model thực phù hợp. Tool followup_task hiện không có model override; nếu worker R1 đang standard và R2 cần strong thì dùng worker strong phù hợp đã tồn tại, hoặc fresh strong với delta/report/brief. Không ghi model mạnh trong ledger rồi âm thầm chạy standard. Có thể chọn strong từ R1 để giữ session toàn registry nếu ghi rõ cost/risk rationale.

U1/D1 được song song khi quota/resources mới cho phép và U∩D=∅, không shared lockfile/schema/ports/DB/Git mutations. Cùng domain R không song song; không giao trước cả R1/R2/R3 cho worker vượt gate. Mỗi brief nói rõ không làm một mình, không revert sửa khác, không spawn reviewer, không commit shared files. PM serialize Git integration.

**Review/fix/close:** mỗi task có hai verdict spec và quality từ reviewer không implement; self-review không đủ. Review package gắn exact candidate SHA hoặc task diff đã cô lập, meaningful commands/output và giới hạn evidence. Findings gom một delta tới worker phù hợp; đo admission lại cho fix/re-review. Lỗi lặp có bằng chứng → nâng model/fresh context. Sau 5 vòng không clear load-bearing finding thì báo owner, không accepted giả. Whole-branch review độc lập workers trước integration/acceptance; API/DB/browser chứng cứ phải đúng candidate. Không gọi các test đề xuất trong bảng là đã PASS.

**Cleanup:** journal command/PID/port/checkout/start/owner trước background job. Chỉ stop PID đã reconcile do run tạo; lưu evidence rồi xóa scratch của task. Giữ source, docs, plans, ledger và worktree người khác. Task đã admit nhưng hết provider quota phải checkpoint honest, không tự chuyển accepted. Không push/deploy từ quyền implement.

## Findings

### P1 — Quy tắc song song xung đột trực tiếp với sub-skill bắt buộc

PM lines 42–50 cho phép hai worker độc lập và yêu cầu dùng SDD; SDD line 282 viết `Never dispatch multiple implementation subagents in parallel`. PM chỉ ghi override fresh worker, chưa ghi override lệnh cấm parallel. Controller làm theo cả hai không có kết quả duy nhất: hoặc bỏ song song được yêu cầu, hoặc vi phạm workflow bắt buộc.

**Sửa hẹp:** thêm adapter precedence ngay REQUIRED SUB-SKILL: quy tắc admission + ownership độc lập của PM thay SDD serial-dispatch rule; không đổi gate/review. Ghi ruling vào ledger. Không cần sửa SDD gốc.

### P1 — Hai ledger và cleanup không có mapping phục hồi

PM lines 12–14,62 dùng `plans/<active-plan>/progress.md` và giữ ledger; SDD lines 136–149 yêu cầu ledger riêng `.superpowers/sdd/.../progress.md`, markers `Task N: complete`, và diagram line 90 xóa workspace cuối review. Không có chỉ định source of truth/mapping. Qua compaction có thể resume ledger rỗng và giao lại task đã accepted, hoặc mất briefs/evidence khi xóa SDD workspace.

**Sửa hẹp:** chỉ định PM ledger authoritative; SDD artifacts ở scratch chỉ là projection có plan ID và mapping task ID/state. Không dùng marker complete vượt gate PM. Lưu briefs/reports/review evidence cần phục hồi vào plan trước cleanup; không xóa authoritative ledger. Hoặc explicit adapter bỏ SDD ledger riêng và trỏ mọi helper về một ledger.

### P2 — Floor model của prose implementer chưa rõ

PM line 36 nói reviewer từ prose tối thiểu standard nhưng table 1–3 cho fast với spec đầy đủ; SDD lines 210–214 yêu cầu cả implementer prose tối thiểu standard. Một task score 3 với detailed prose có thể bị route fast nếu chỉ đọc PM table.

**Sửa hẹp:** thêm một câu: prose cần judgment dùng ít nhất standard cho implementer/reviewer; fast chỉ exact transcription/edit cơ học. Chỉ rõ routing là dự kiến; model actual/session phải được ghi, reuse không tự thay model.

### P2 — Nhiều cửa sổ quota chưa có quy tắc chọn floor

PM line 46 dùng một `quota còn lại`; tool có thể trả nhiều windows, hoặc different provider bucket cho model dự kiến. Controller có thể lấy weekly còn nhiều nhưng window khác sắp chạm reserve.

**Sửa hẹp:** admission ghi provider/model và từng window áp dụng; dừng việc mới nếu bất kỳ binding window chạm reserve, hoặc quá sát mà closure cost chưa đo. Missing window báo unknown. Không cộng/quy đổi phần trăm giữa windows.

## Kết quả và câu hỏi chưa giải

Core behavior trong tình huống đạt: không nhận việc mới ở 1,05%, không dùng RAM cũ, serialize registry và giữ per-task review, reserve reviewer, cleanup đúng owner. Chưa đạt xác định workflow adapter vì hai P1 trên. Chưa có bằng chứng runtime implement/review/quota cost; forward-test không chứng nhận E2E.

Câu hỏi kỹ thuật còn mở: exact R/U/D paths, model/role worker đang giữ context, owner/seat của test 4 GiB, snapshot resources mới, cost closure và binding quota windows. Các dữ liệu này cần khảo sát trước dispatch thực, không cần owner chọn implementation thay agent.

## Scoped re-review — vòng 1

Admission do PM cung cấp lúc 22:39 Asia/Saigon: Mac 24 GiB/12 CPU, memory_pressure free 56% (không quy đổi GiB), load 5,67, disk 63 GiB, weekly remaining 14%, reserve 1%; phạm vi chỉ light rereview đã admit. Đây là telemetry được PM báo, reviewer không tự đo lại hoặc suy ra capacity để spawn. Đọc lại candidate skill đã sửa; không khám phá lại repository hoặc chạy suite.

| Finding vòng đầu | Verdict vòng 1 | Bằng chứng trong candidate và kiểm tra hồi quy |
|---|---|---|
| P1 parallel vs SDD serial-only | **ADDRESSED** | Đoạn Adapter precedence nói rõ admission/ownership PM thay lệnh serial-only; giữ per-task review/dependency gate. Song song U/D vẫn phải độc lập và qua resource/quota admission; registry shared R vẫn serialize. |
| P1 hai ledger/cleanup phục hồi | **ADDRESSED** | PM ledger là source of truth thay ledger scratch; projection có plan ID/task-ID mapping; cấm resume scratch rỗng hoặc marker vượt gate. Brief/report/review evidence lưu vào plan trước cleanup; authoritative ledger không bị xóa. |
| P2 prose implementer/model reuse | **ADDRESSED** | Prose cần judgment và reviewer tối thiểu standard; fast chỉ exact transcription/mechanical. Tool không override model thì dùng worker phù hợp khác hoặc fresh với delta/checkpoint; actual model phải ghi, không silent switch. |
| P2 quota windows/provider | **ADDRESSED** | Ghi provider/model, từng binding window/remaining/reset/threshold; reserve tuần chỉ window tuần; window khác dùng threshold owner/availability. Bất kỳ window áp dụng chạm threshold/hết allowance đều chặn; không cộng/quy đổi %. Unknown quota vẫn báo, không giả infinite. |

**New issues từ fixes:** không thấy finding material mới trong phạm vi diff. Wording model rõ hơn table routing mặc định; adaptation vẫn giữ độc lập reviewer, threshold, review và cleanup. Quy tắc reserve theo window cần owner intent/telemetry được ghi trong ledger mỗi run; đây là input vận hành, không phải lỗi mới của sửa đổi.

**Gate:** spec compliance **PASS**, quality **PASS** cho bốn sửa đổi của skill; **0 finding mở** trong vòng review này. Có thể accept gate PM-01 ở phạm vi skill + behavioral textual check. Chưa có runtime/agent-dispatch E2E hoặc cost benchmark; không chuyển kết quả này thành acceptance sản phẩm Crew v3. Câu hỏi kỹ thuật scenario đã liệt kê vẫn phải giải trước dispatch implementation thật.

## Scoped review — phần mới về ticket status

Admission PM cung cấp 22:41 Asia/Saigon: Mac24GiB/12CPU, memory_pressure free49% (không đổi ra available GiB), load7,40, disk63GiB, quota14%/reserve1%; reviewer là light agent thứ ba cùng core read-only và HTML worker, không heavy test. Chỉ đọc section `Ticket status là trách nhiệm PM`; chỉ ghi nối report này, không gọi hệ ticket hoặc spawn.

**Yêu cầu owner:** PM chịu trách nhiệm không để ticket đã hoàn thành bị treo status. Candidate đáp ứng bằng sync theo lifecycle, audit sau report/review/merge và trước dispatch, event reconciliation + fallback5 phút, audit khi closeout/handoff/quota stop. Task đủ gate phải đi đúng terminal state; worker im lặng không ngăn PM tiếp tục.

| Nhánh kiểm tra | Verdict | Evidence/semantics |
|---|---|---|
| ID/status có thật và gate trước terminal | PASS | Ledger có project/ticket/parent/workflow/version, actual remote status và verified time; đọc schema/state machine rồi mapping enum hợp lệ. Evidence/report/docs trước transition; implemented không đồng nghĩa done. |
| Lost ACK/timeout và duplicate retry | PASS | Expected prior state/version + idempotency hoặc equivalent, read-back xác nhận persistence; timeout thì read/reconcile trước retry. Không retry blind từ state cũ, không lấy API200/tool promise thay persisted status. |
| Concurrent progress và terminal recovery | PASS | Expected state/version cùng reconcile tránh ghi đè tiến độ mới. `đúng trạng thái terminal` theo state machine, không ép mọi terminal thành done; acceptance/gates vẫn phải đạt trước completion. |
| Sync failure / stale ticket | PASS | `status_sync_pending` lưu target/from/error/next retry, backoff, escalation khi thiếu quyền/hết giới hạn; không claim close khi server status chưa verified. Handoff/quota stop lưu owner/retry/checkpoint cho phiên sau tiếp tục. |
| Parent/children gates | PASS | Reconcile parent/children; parent chỉ đóng khi dependencies, acceptance riêng và docs gate đạt. Pending review/docs/error giữ trạng thái có lý do; child terminal không tự close parent. |
| Chưa kết nối ticket system | PASS | Ghi `ticket: not-created`, không giả tạo/cập nhật remote. Duty audit áp dụng mọi ticket PM tạo/nhận, tránh orphan ngoài task ledger local. |

**Finding:** không có bug material trong recovery/terminal semantics của section mới. Retry cần dùng remote state/version vừa reconcile, pending sync được resolve khi read-back khớp; candidate đã buộc đọc schema/state machine và reconcile, không có chỉ dẫn chuyển ngược state hoặc ép terminal thành done.

**Gate scoped:** spec compliance **PASS**, quality **PASS**, **0 finding mở** đối với phần thêm status. Chấp nhận requirement ở cấp policy văn bản; chưa có runtime proof của API CAS/idempotency, status mapping hoặc vòng event/5 phút. PM phải triển khai các cơ chế đó bằng tool/schema thật trong execution, không suy ra tính năng server đã tồn tại từ skill.
