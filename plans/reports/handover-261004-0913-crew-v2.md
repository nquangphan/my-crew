# Handover Crew v2 — 04/10/2026

## Điểm bắt đầu cho agent tiếp theo

Tiếp tục xây Crew v2 theo kế hoạch đã duyệt và Superpowers Subagent-Driven Development. Không bắt đầu lại brainstorming, không yêu cầu owner duyệt lại UI và không làm lại các task đã nghiệm thu. Đây là bàn giao công việc đang triển khai, không phải bản release.

Repository: `git@github.com:nquangphan/my-crew.git`.

- `main`: checkpoint file repo chính tại `6949cc1`; nền tảng v2 đã có trên main. Nhánh này có cấu hình Codex, bản nháp và báo cáo, chưa chứa toàn bộ backend/web v2 mới.
- **Nhánh tiếp tục triển khai: `codex/crew-v2-server`**, checkpoint toàn bộ source/evidence tại **`a13dd7d`**. Commit này có cả source chưa đủ nghiệm thu; không suy commit/push là task đạt.
- Worktree hiện tại: `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew`.
- Repo chính: `/Users/phannhatquang/Documents/projects/crew`.
- Không merge checkpoint này về main hoặc deploy khi các cổng nghiệm thu còn thiếu. Owner đã cho phép merge main cục bộ sau nghiệm thu; deploy cần owner duyệt hoặc ticket deploy.

Trên máy mới, fetch và checkout nhánh triển khai trong checkout sạch. Không ghi đè công việc chưa commit. File handover cũng được lưu trên cả hai nhánh sau checkpoint trên; SHA của commit tài liệu có thể mới hơn.

## Quota và cách làm bắt buộc

Lần đọc trực tiếp cuối khi bàn giao: quota tuần đã dùng **75%, còn 25%**. Owner đã sửa ngưỡng ngày 04/10/2026: được tiếp tục dispatch cho tới khi quota tuần **còn 5%**; ở mức còn 5% hoặc thấp hơn thì dừng giao việc mới, chỉ khép việc đã chạy, lưu checkpoint và dọn tài nguyên. Kiểm tra quota mới trước mỗi lượt dispatch; nếu không đọc được quota, giữ dispatch mới.

Owner yêu cầu PM chia task cho subagent, review từng task, cho chạy song song khi độc lập và tự đánh giá tài nguyên. Dùng skill chính thức trong `.agents/skills/`, đặc biệt `using-superpowers`, `subagent-driven-development`, `requesting-code-review` và `verification-before-completion`. Full review cho task mới; sau sửa dùng reviewer cũ kiểm finding và delta, không lặp toàn review. Tối đa 5 vòng sửa, sau đó hỏi owner nếu vẫn không đạt.

Trước mọi dispatch/resume/review/fix, lấy telemetry mới. Cho phép công việc tĩnh độc lập song song với ownership riêng; chỉ một lượt Node/PG/build/browser nặng tại một thời điểm. Không cho worker sửa Git/index, manifest docs hay file của peer; không revert peer, không `git stash`, không broad cleanup.

Gate đã dùng cho job nặng: pressure1/2, RAM khả dụng ít nhất4GiB, CPU idle ít nhất50%, disk ít nhất8GiB. RAM tính `(free+inactive+speculative)*pageSize`; dùng `plans/261002-0002-crew-v2/execution-phase06/pm-telemetry.py`. Node heap384MiB, watchdog90/120s; PG riêng256MiB/CPU1/pids64. Kiểm lại trước mỗi lần tạo process/container. Resource không đạt thì giữ và báo, không spin polling hoặc hạ gate để chạy.

## Đọc theo thứ tự

1. `AGENTS.md`, `.claude/rules/development-rules.md`, `docs/index.md`, `v2/docs/index.md`.
2. Spec: `docs/superpowers/specs/2026-10-01-crew-v2-design.md`.
3. Roadmap: `plans/261002-0002-crew-v2/plan.md` và các `phase-*.md` liên quan. Một số câu trạng thái roadmap đã cũ; đối chiếu ledger, Git và báo cáo cuối.
4. Ledger hiện tại: `execution-phase06/progress.md`, `execution-phase07/pm-ledger.md` trong cùng thư mục plan. Ledger có identity plan; các task complete/commit đã ghi không được redispatch.
5. Báo cáo từng phần và review dưới các `execution-phase*`. Các đoạn RED/scaffold trong báo cáo là lịch sử, không phải trạng thái cuối.

Mọi file Markdown mới nằm trong `docs/` hoặc `plans/`; owner đã cho phép hai thư mục này cả trong worktree v2. UI/docs tiếng Việt, identifier tiếng Anh, giờ hiển thị Asia/Ho_Chi_Minh. Đọc flow trước code; nếu checkout có `.codegraph/` thì dùng CodeGraph trước tìm code. Chuẩn docs v2 có 7 H2: Mục đích, Điểm vào, Các bước, Files, Dữ liệu, Flow liên quan, Tests. File source phải có flow; source đổi phải cập nhật mọi flow sở hữu, generate và check trước commit. Không commit credential.

## Phạm vi sản phẩm đã chốt

V2 độc lập với app v1, chỉ giữ/import docs dự án. Một Trợ Lý định tuyến trung tâm trên máy owner chỉ định, chọn dự án, workflow và model theo docs/yêu cầu/độ nặng ticket. Role thực thi dùng pinned official skills/templates của BMAD hoặc Superpowers, không tạo bộ role prompt riêng. Superpowers mặc định, hỗ trợ cả hai workflow; pin namespace từ đầu để chặn skill gọi chéo.

Mỗi project có một máy thực thi. Máy Trợ Lý offline thì chờ online, không tự chuyển sang máy khác. Pool máy gồm Claude, Codex và OpenAI-compatible API; API cần khai báo model. Web chọn máy/model Trợ Lý, bật/tắt từng nguồn, cài/update hai workflow và cảnh báo version lệch. Fresh admission phải kiểm nguồn ON; OFF không tự hủy attempt đã admitted.

Ticket phản ánh bước workflow và có task con khi cần; parent, dependency và repair là ba quan hệ khác nhau. Trợ Lý chia việc/review theo tài nguyên, theo dõi sự kiện và monitor mỗi5phút. Trong quyền hạn thì tự quyết, ngoài quyền thì hỏi owner. Merge tự động sau bằng chứng; deploy đợi duyệt hoặc ticket deploy. Docs luôn đúng chuẩn và phản ánh code/commit, không dùng spec/plan làm bằng chứng code đã triển khai.

UI Jira/Confluence và flow chart đã được owner duyệt. Map tham khảo ảnh `IMG_6454.JPG`: root trái, step/task sang phải; click item mở shared ticket dialog, giữ viewport/draft/focus. Board/list/map/dialog dùng cùng dữ liệu. Ticket và comment đều paste ảnh clipboard, thêm attachment; Trợ Lý đọc được hình và file. Local app macOS chỉ là gateway, có signed remote update.

## Trạng thái 9 phase

| Phase | Đã có | Còn thiếu |
|---|---|---|
|01 Domain|Hoàn tất, merge main.|Nghiệm thu toàn sản phẩm vẫn riêng.|
|02 Server/docs|Task1–7 review đạt theo phạm vi.|Ghép Trợ Lý/web và nghiệm thu hệ thống.|
|03 Gateway/workflow|Task1–6 review đạt theo phạm vi.|Native/runtime vận hành thực tế.|
|04 Runtime/models|Task1–3 đạt theo phạm vi; metadata CLI Claude/Codex đã khảo sát.|Adapter chạy task thật, certified isolation, Keychain/provider/native.|
|05 Attachment|Storage/submission/access/protocol có review.|Parser corpus/boundary và production certificate còn thiếu.|
|06 Assistant|T1, T2 SliceA/B1, manifest và D1 inspection đã review.|B2a, B2b–B5, run/gates, assessment/admission, PM, monitor, assembly.|
|07 Web|Shell nguồn độc lập và browser evidence; fixture đang khép review.|Task1 finalchecks/re-review; Task2–8 nghiệp vụ.|
|08 Integration/docsgates|Kế hoạch đã có.|Implementation và final evidence.|
|09 Update/operations|Chưa nghiệm thu v2.|Signed updater, drain, rollback, release.|

## Những phần đã nghiệm thu: không làm lại

- T1 assistant schema/storage/inbox: `feaea55`. SQL011 SHA256 `fb0c3f8f7738e718a710bd452e5c8560e131410e781bbe374dc8817ce4390841`; không sửa migration001–011 đã freeze. FIX1 cùng lượt35/35 có backup/restore; FIX2 kiểm expiry wallclock10/10 ảnh hưởng, không cộng hai lượt thành một suite.
- T2 SliceA designation/owner authorization: `a96c932`; scoped19/19, review A1/A2 đã khép. Production resolver vẫn UNVERIFIED/default deny; không fake actor owner.
- T2 B1 scoped create ticket: `340851c`; final63/63 (47 scoped +16 existing), independent full review và FIX1 re-review đã khép UUID casing/array descriptor. Generic ACL giữ nguyên, actual machine actor được ghi audit.
- Gateway manifest: `29e7265`;7/7 và review đạt. Deep capture pin trước await, nonblocking regular-file reads. BMAD vẫn `RENDER_ARTIFACT_REQUIRED`.
- D1 pure artifact inspector: source/test đã vào `a13dd7d`, final25/25 +gatewaystrict +Biome; review `task-3-d1-fix1-re-review.md` SHA `6cdc60f444dd0508b8b1065765be3cb43adb60574c3fe60e668f25bdbc10967c` khép cả4finding. Chỉ kiểm supplied bytes, không đọc host/exec renderer/mint receipt/admit BMAD. Source SHA `29881b48f86a49001e625dbed17bd70ed6b02cbe98aed8b5050f729ee3d31d23`, test `0b1e51ea394de9fcab535507302bbdbe5c3c6bbbd7efafb31717666b38e6fbd4`.

D1 từng bị PM/reviewer hiểu sai `resolved_values` chỉ chuỗi. Pinned renderer6.12.0 thực sự giữ string-list và review-layer list. Ruling đã đính chính: exact source token keys và category của accepted source tree; unknown/nested tùy ý/numeric/ambiguous keys deny. Không phục hồi quy tắc string-only sai.

## Thứ tự tiếp tục khi quota và tài nguyên cho phép

### 1. Khép B2a trước

Đọc `execution-phase06/task-2-slice-b2-preflight.md` và `task-2-slice-b2a-report.md` (checkpoint cuối SHA `149a595bb5aa23bc0e5d18f4b4b1a61f10414b49c113bb16e440c8eb275aa18f`). Năm file: tickets/service.ts, decisions.ts, dependencies.ts, assistant-access.ts, test/assistant-mutations.test.ts.

Actual RED55 có10pass/45semanticfail, raw `c38f8cdb66cac551d0ba2e722fe6d7d47cb62b9d69d031ffad225895f7bef86e`. Source đã triển khai và format; **GREEN118 và strict chưa chạy**, vì gate RAM fail trước Node. Container đã stopped/removed, không coi lần này là test fail/pass.

Kế tiếp chạy118case theo report:55B2a+47B1+16existing trong5testfiles, scopedstrict và Biome. Sau đó fresh full independent spec/quality review cho B2a; còn findings thì batchfix và scoped re-review. Không dùng allowlist authority của test thành production permission. Exact submitted payloads quyết định `{ticketId,input}`, dependency `{ticketId,predecessorId,expectedRevision}`; hash SHA256 canonical tuple theo port. Actor/input/proof snapshot trước await, root/sorted tickets/project locks trước verify, private same-Tx token và single shared persistence core.

B2b signal/command chưa được release: running wait_owner còn synthetic-owner callback và execution lock union chưa chốt. Không sửa attempts.ts/commands.ts hoặc giả scope để vượt producer gap. B3 input và B4 routing cần exact persisted decision/input/turn linkage; B5/native positive authority còn default deny.

### 2. Khép web Task1 FIX2

Đọc `phase-07-web.md`, `execution-phase07/task-1-preflight.md`, `task-1-fix1-re-review.md` và ledger. Original full review có I1 cleanup vô hạn; FIX1 sửa active HTTP request nhưng scoped reviewer phát hiện late scratch rm sau timeout. FIX2 dùng chính production helper, RED thật rồi focused GREEN và Biome.

**Full lifecycle6, strict trên freeze FIX2 và original reviewer FIX2 re-review còn pending.** B2a đã structurally complete nhưng phải freeze dependency closure khi web kiểm vì fixture import actual buildApp. Chỉ một PG/Node heavy job. Minor M1 callback throw falsy đang deferred; đưa vào whole-branch triage trước merge, không gọi task đã fully accepted.

UI11path không đổi từ MCP evidence: actual1280/390/640px không overflow, skip-link focus vào MAIN, console0error. Literal browser zoom200% chưa đo được;640px là layout-equivalent ruling, không giả literalzoom PASS. Screenshot và report nằm `execution-phase07/ui-evidence/` và `pm-browser-shell-check.md`. Không lặp UI approval.

Sau S1/A1, mới tiếp Task2 auth/transport/cache/SSE; rồi chia các nhóm độc lập theo source DAG trong approved phase07. Ticket/map phải dùng shared detail/dialog, không tạo modal/DTO giả; các G1–G6 producer routes còn thiếu phải review handoff trước consumer.

### 3. Các phần còn lại

Tiếp phase06 T3 run graph/gates/trusted renderer/receipt, T4 candidates/admission/capacity, T5 PM/review/resources, T6 monitor, T7 assembly theo dependency map. Không mở runtime/admission từ unit fixture. Phase04 native và phase05 parser nghiệm thu song song chỉ khi ownership/tài nguyên cho phép; phase08/09 theo gate của roadmap.

## Parser/native và tài nguyên cục bộ

Parser source76/76 unit và harness FIX1 static đã review trong phạm vi. Actual37corpus+5boundary, allocation/wall limits và productioncert chưa nghiệm thu. Provider đã từ chối tạo payload allocation lớn; không đổi provider hay retry để lách. Đọc report/harness và retained limits trước quyết định bước tiếp.

Trên máy hiện tại còn context cần thiết `/private/tmp/crew-v2-attachments-parser-b953796e-f601-4a6a-9311-38bd9f79c43d` và candidate image `sha256:8f2eec2f52fd3ed6c2c42215cad5ce81bee8989a9db3c8bd97f689aed998988a` (đã xác minh còn lúc bàn giao). Docker image, node_modules và scratch ngoài repo **không đi qua Git**; máy khác phải rebuild theo recipe/pin/receipt, không giả đã có. Không xóa context/image cần thiết như rác. Baseline copies trong plans là chứng cứ cũ, không import làm source sản phẩm.

Native offline mới đọc version/help/schema Claude2.1.284, Codex0.159.3; chưa init/model/certification. Không tự chạy paid/live/native với owner inputs hoặc chi phí mới; cần bounded authorization/provider/budget thật.

Các owned fixture process/container đã cleanup; container B2a cuối `fe4a6f69a325b0f989b2367c5cc17b1c9a2203c7331c912a1b8282bae28afb46` đã đối chiếu no-such-object. Không dừng/restart backend shared, không broad prune, không suy ownership từ prefix hoặc TTL. UNKNOWN giữ registry để reconcile exactidentity.

## Kiểm tra, Git và giới hạn checkpoint

Push checkpoint đã chạy nested v2 generate/check--all/check--staged và root staged/commit-message/pre-push hooks. Lần đầu R3 báo contracts attachment thiếu cập nhật server-attachments flow; đã bổ sung mô tả provenance và chạy lại đạt. Source coverage mới web được owner-authorized qua `Crew-Owner-Approved: CREWV2-701`. Helper `execution-phase02/integrate-docs.mjs` dùng HEAD+INDEX mirror và dọn đúng mirror do mình tạo.

Không chạy full product suite để push checkpoint, không claim all tests hoặc deployment PASS. `a13dd7d` cố ý bảo toàn candidate parser/B2a/web cùng báo cáo pending. Khi tiếp tục, chạy các check còn thiếu và review trước merge. Không sửa migration freeze, docs protection, publicDTO hoặc external dependency để làm xanh check. Docs rules R2/R3/R6/R7 và owner-approved trailer vẫn áp dụng.

Secrets/env/privatekeys, node_modules/build outputs theo ignore; local `.codex/hooks/.logs/` và `.agentkit-runtime.json` đã bỏ tracking/ignore. Source/config/plans/docs/evidence còn lại ở repo chính và worktree v2 đã commit/push. Handover không chứa credential.
