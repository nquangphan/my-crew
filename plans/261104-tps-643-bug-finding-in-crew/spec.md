# Đặc tả: gom app Bug Finding vào 2P Crew và luồng review ticket tổng code/bug

Yêu cầu gốc: TPS-643. Việc lập kế hoạch: TPS-644. Ngày: 04/11/2026. Kế hoạch triển khai: [`plan.md`](plan.md).
Mockup: [`mockups/index.html`](mockups/index.html).

## 1. Mục tiêu

1. App Bug Finding (SwiftUI, repo `bug-finding`, `apps/mr-review-queue/`) đi kèm bên trong app 2P Crew (Electron,
   `apps/mac-app`), cài và cập nhật cùng nhau, mở từ mục **Bug Finding** trong 2P Crew. Giao diện và tính năng của Bug
   Finding giữ nguyên.
2. Project của Crew tự có bên Bug Finding: Crew đồng bộ danh sách sang, thêm project trong Crew thì bên Bug Finding tự
   thêm, không phải thêm tay.
3. Ticket tổng code/bug đổi luồng: khi mọi việc con xong, ticket tổng tự gom code và mở PR; Bug Finding review PR đó
   (qua hàng đợi của app, owner xem được tiến độ trên UI Bug Finding); Trợ Lý xử lý finding: cái tự giải quyết được
   thì giao executor sửa, còn lại hỏi owner chốt; Bug Finding chạy lại **một lần** sau khi **toàn bộ** việc con sửa
   của lô xong; owner duyệt; integrator merge PR ngay.

## 2. Quyết định của owner (TPS-643) và cách spec phản ánh

| Câu | Owner chọn | Trong spec |
|---|---|---|
| Q1 | b) Đóng gói nguyên app Bug Finding bên trong 2P Crew, cài/cập nhật cùng nhau, mở từ một mục trong 2P Crew; danh sách project do Crew đồng bộ sang; giữ nguyên UI và tính năng | Mục 6, 7 |
| Q2 | a) Bỏ bước reviewer Claude trên ticket tổng code/bug. Mọi con xong → gom code + mở PR → review bằng Bug Finding → Trợ Lý xử lý finding → owner duyệt → merge | Mục 5 |
| Q3 | a) Integrator tự merge PR ngay sau khi owner duyệt | Mục 5.1 stage 4 |
| Q4 | Như a, nhưng Bug Finding chỉ chạy lại một lần sau khi **toàn bộ** việc con sửa của lô xong (chạy rất nặng); finding không tự giải quyết được thì hỏi owner | Mục 5.3, 5.4 |
| Q5 | a) Crew xếp MR vào hàng đợi app Bug Finding trên Mac; app chạy skill như thường, UI hiện tiến trình và báo cáo; Trợ Lý đọc báo cáo khi xong | Mục 8 |
| Q6 | a) Chưa có agent BA/UIUX: executor việc này làm luôn phần BA và mockup HTML; owner duyệt cả gói | Tài liệu này + `mockups/` |

## 3. Phạm vi

- Repo `bug-finding`: cầu nối với Crew trong app (đọc danh sách project, nhận yêu cầu review, trả kết quả và tiến độ),
  nhãn "Crew" trên UI, script build nhận danh tính ký Developer ID và thư mục ra.
- Repo `my-crew` (`apps/mac-app`): build và nhúng `Bug Finding.app`, mục **Bug Finding** (route `#/bug-finding`),
  đồng bộ project, việc máy mới `bug-finding-review`, chuyển kết quả về server, updater chờ Bug Finding rảnh, gỡ bản
  cài riêng cũ; template vai trò đồng bộ với fork; docs flow.
- Repo fork Paperclip (`/Volumes/CORSAIR/Projects/2p-crew/paperclip`): policy mới cho ticket tổng code/bug, gate mới,
  bảng và route kết quả Bug Finding, đánh thức đúng người, việc máy mới, UI ticket tổng (dải giai đoạn, tab Bug Finding,
  màn duyệt), template vai trò (Trợ Lý, reviewer, integrator, executor).

## 4. Ngoài phạm vi

- Đổi luồng của yêu cầu nghiên cứu, viết tài liệu, lập kế hoạch (nhãn `research`, `docs`, `plan`): giữ nguyên
  `[reviewer, integrator, owner, integrator]` hoặc `[reviewer, owner]`.
- Ticket tổng đã tạo trước khi bật luồng mới: policy đã ghim, chạy hết theo luồng cũ.
- Repo không ở GitHub (GitLab, khác): Crew chưa mở MR GitLab; ticket tổng của project đó giữ luồng cũ (mục 10, giả
  định G3). App Bug Finding vẫn review MR GitLab do người dùng tự fetch như trước.
- Viết lại Bug Finding bằng Electron, đổi skill `bug-finding`, đổi engine verdict.
- Gửi comment/review lên GitHub từ Bug Finding.
- Review bằng Bug Finding cho việc con (con vẫn executor → reviewer Claude).

## 5. Luồng ticket tổng code/bug mới

### 5.1 Stage của policy mới (`root-bf`)

Policy ghim lúc tạo ticket tổng code/bug khi company bật `bugFinding.enabled` (mục 9):

| # | Loại | Participant | Việc | Gate khi `done` |
|---|---|---|---|---|
| 1 | `review` | integrator | Gộp sha đã duyệt của mọi con vào `crew/req/<identifier>`, kiểm một lần (test liên quan, E2E `e2e=`, `crew-docs check`), push nhánh, mở hoặc cập nhật PR vào nhánh mặc định | Bằng chứng `crew-docs-check` cho merged commit (như stage 2 cũ) **và** `crew-pr sha=<merged commit> pr=<URL>` mới hơn bằng chứng đó |
| 2 | `review` | reviewer (vai **cầu nối Bug Finding**, không tự review code) | Server tự xếp Bug Finding cho head PR khi vào stage; reviewer đọc kết quả, cho qua hoặc trả về Trợ Lý | Có lượt Bug Finding `succeeded` cho đúng head PR hiện tại (hoặc owner đã cho phép bỏ qua, mục 5.6) |
| 3 | `approval` | owner | Duyệt và merge, hoặc yêu cầu sửa | — |
| 4 | `review` | integrator | Merge PR (`gh pr merge`) đúng commit owner duyệt, rồi deploy tự động nếu repo bật | `crew-merge sha=<T> … pushed=merged pr=<URL> merge=<sha merge>` mới hơn quyết định của owner, `T` bằng commit của bằng chứng docs mới nhất |

Lý do stage 2 giao reviewer mà không giao Trợ Lý: stock Paperclip tự bỏ qua stage `review` có mọi participant trùng
người được trả về (`canAutoSkipPendingStage`, `server/src/services/issue-execution-policy.ts:651-660`); Trợ Lý là người
giữ ticket tổng nên không làm participant được. Reviewer chỉ làm cầu nối (đọc kết quả, quyết định theo luật cố định ở
mục 5.5), không review code, nên vẫn đúng Q2 "bỏ bước reviewer Claude".

### 5.2 Sơ đồ trạng thái

```text
 Trợ Lý: mọi con done ──PATCH done──▶ [1 Integrator: gộp + kiểm + PR]
                                            │ crew-docs-check + crew-pr
                                            ▼
                                [2 Bug Finding] ◀────────────────────────────┐
                 server xếp job bug-finding-review (head PR) ─▶ Mac ─▶ app  │
                 app chạy skill, gửi tiến độ/kết quả ─▶ server ─▶ đánh thức │
                 reviewer (cầu nối) đọc kết quả                             │
                     │                               │                      │
     không còn finding mở cần xử lý         còn finding cần xử lý          │
     (hoặc hết lượt lô sửa)                 và còn lượt lô sửa              │
                     │                               │ "Reviewer: cần sửa"  │
                     ▼                               ▼ (server: chạy lại    │
              [3 Owner duyệt]               Trợ Lý (in_progress)  từ stage 1)
               │          │                 phân loại finding:              │
       Duyệt và merge   Yêu cầu sửa         - tự sửa → lô bf-fix-<n>        │
               │          │                 - hỏi owner → thẻ hỏi           │
               ▼          ▼                 - bỏ qua (LOW/INFO) → lý do     │
   [4 Integrator merge]  Trợ Lý lô sửa      chờ: MỌI con của lô done        │
               │          (chạy lại từ 1)        + MỌI câu hỏi đã trả lời   │
               ▼                                 │ PATCH done               │
            done                                 ▼                          │
                                       [1 Integrator: gộp lại + cập nhật PR]┘
```

- Stage 2 có tối đa **3 lượt Bug Finding** cho mỗi vòng duyệt của owner: lần 1 + tối đa **2 lô sửa tự động** (mỗi lô
  một lần chạy lại). Sau lần chạy cuối, finding còn lại không tự sửa nữa: đưa vào màn duyệt cho owner (giả định G5).
- Bug Finding chỉ chạy khi head PR khác head của lượt `succeeded` gần nhất. Lô chỉ có câu trả lời "không sửa" (không
  có code mới) thì không chạy lại; reviewer cho qua và mang theo quyết định của owner.
- Owner yêu cầu sửa ở stage 3: như hiện nay, server chạy lại từ stage 1 (`ownerRestartStages`); số lô sửa tự động đếm
  lại từ 0 cho vòng mới.

### 5.3 Trợ Lý xử lý finding (khi stage 2 trả về)

Trợ Lý đọc kết quả qua `GET /api/plugins/crew.core/api/issues/<id>/bug-finding` (bảng `crew_bug_finding_runs`, mục 8.4)
và báo cáo đính kèm. Không tin comment tự xưng. Với mỗi finding `OPEN`/`STILL_PRESENT`/`REGRESSED`/`PARTIALLY_FIXED`:

| Nhóm | Điều kiện (đủ tất cả) | Việc |
|---|---|---|
| **Tự sửa** | `certainty` là `Confirmed` hoặc `Potential` có bằng chứng `SOURCE`; `action` là `CODE_FIX` hoặc `TEST_FIX`; có `fix` và `accept`; `mr_relation` là `introduced`; không có `question`; sửa không đổi hành vi sản phẩm ngoài yêu cầu, không đổi hợp đồng API công khai, không cần migration dữ liệu | Tạo con sửa trong lô `bf-fix-<n>` cho executor |
| **Hỏi owner** | `certainty` là `Needs-Clarification` hoặc có `question`; `action` là `CONFIRM_CONTRACT` hay `EVIDENCE_GATE`; cách sửa đổi phạm vi, UX, quy tắc sản phẩm, bảo mật, dữ liệu; `pre_existing` mà `HIGH`/`CRITICAL`; Trợ Lý cho là sai (false positive) mà mức `MEDIUM` trở lên | Một thẻ `ask_user_questions` trên ticket tổng gom mọi câu của lượt, mỗi câu có lựa chọn a) sửa, b) không sửa (kèm lý do), c) tách ticket riêng, cùng đề xuất của Trợ Lý |
| **Bỏ qua có lý do** | `LOW`/`INFO` và (`pre_existing` hoặc sai có bằng chứng `file:dòng`) | Ghi lý do; lý do gửi kèm lần chạy lại để Bug Finding đánh `REVIEWER_DISMISSED` |

- `CRITICAL` và `HIGH` không bao giờ bị Trợ Lý tự bỏ qua.
- Owner chọn a) thì Trợ Lý thêm con sửa vào **cùng lô**. Chọn b) thì câu trả lời thành phản hồi người review cho lần
  chạy sau. Chọn c) thì ghi vào `### Cần owner quyết định` của tổng kết và không chặn PR.
- Con sửa: `crew-fix base=<head PR đã review>`, dòng `crew-bf finding=<F-xx> run=<n>`, tiêu chí nghiệm thu chép từ
  `accept`, đi executor → reviewer như mọi con; gói theo vùng code (nhiều finding cùng file có thể chung một con). Lô có
  code thì có con E2E `e2e-fix-<n>` như lô sửa hiện nay khi yêu cầu có E2E.
- Trợ Lý ghi kế hoạch lô trước khi tạo con: comment `crew-bf-triage run=<n> batch=bf-fix-<k> fix=<F-..> ask=<F-..>
  dismiss=<F-..>`.
- Chỉ khi **mọi** con của lô `done` (qua stage review con) **và** thẻ hỏi đã trả lời hết, Trợ Lý mới `PATCH done` ticket
  tổng (một lần). Không gửi theo từng con. Đánh thức: server đã đánh thức Trợ Lý khi mọi con xong
  (`issue_children_completed`) và khi owner trả lời thẻ hỏi (`wake_assignee`); Trợ Lý kiểm lại đủ hai điều kiện rồi mới
  gửi.
- Phản hồi cho lần chạy sau: Trợ Lý ghi vào comment `PATCH done` một khối `crew-bf-feedback` (mỗi dòng `F-xx: <câu>`);
  server chép khối này thành `reviewerInput.text` khi xếp lượt kế tiếp.

### 5.4 Ví dụ một vòng

1. Lần 1: `BLOCK`, 5 finding. Trợ Lý: F-01, F-02, F-03 tự sửa (lô `bf-fix-1`: 3 con); F-04 hỏi owner; F-05 bỏ qua.
2. Owner trả lời F-04 "không sửa". 3 con xong và qua reviewer con. Trợ Lý `PATCH done`.
3. Stage 1 integrator gộp lại (thêm 3 sha sửa), cập nhật PR. Stage 2 server xếp lần 2 (`recheck`, kèm phản hồi F-04,
   F-05). Kết quả `APPROVE`, F-01..03 `FIX_VERIFIED`, F-04, F-05 `REVIEWER_DISMISSED`. Reviewer cho qua.
4. Owner duyệt và merge. Integrator `gh pr merge`, deploy tự động nếu bật.

### 5.5 Luật quyết định của reviewer (cầu nối) ở stage 2

Đọc `GET …/issues/<id>/bug-finding`:

1. Chưa có lượt cho head PR hiện tại: gọi `POST …/bug-finding/request` (idempotent theo issue + head) rồi kết thúc run,
   không đổi status. Lượt đang chờ hoặc đang chạy: kết thúc run.
2. Lượt mới nhất `failed`/`timeout`: mục 5.6.
3. Lượt `succeeded`:
   - không còn finding ở trạng thái mở (`OPEN`, `STILL_PRESENT`, `REGRESSED`, `PARTIALLY_FIXED`, `UNABLE_TO_VERIFY`)
     ngoài các finding đã có quyết định owner "không sửa"/"tách ticket" → `PATCH done` (sang owner);
   - còn finding mở và số lô sửa tự động trong vòng này < 2 → `Reviewer: cần sửa` kèm danh sách ID → về Trợ Lý;
   - còn finding mở và đã đủ 2 lô → `PATCH done` với comment liệt kê finding còn mở; Trợ Lý ghi chúng vào tổng kết
     cho owner quyết ở màn duyệt.
4. Reviewer không đọc code, không chạy test, không sửa tổng kết.

### 5.6 Lỗi và hết giờ

- Server đánh dấu lượt `timeout` khi 8 giờ chưa có kết quả (gồm thời gian chờ mạng/tài nguyên của app) hoặc 30 phút
  máy chưa nhận job; rồi đánh thức reviewer.
- Lượt `failed`/`timeout` lần đầu: reviewer xếp lại một lần. Lần thứ hai: reviewer tạo thẻ `request_confirmation` cho
  owner "Bug Finding không chạy được: <lý do>. Bỏ qua Bug Finding cho yêu cầu này?". Owner đồng ý → server ghi lượt
  `skipped` (người duyệt là owner), reviewer `PATCH done`; từ chối → reviewer xếp lại khi owner comment sửa xong máy.
- Máy chưa có app hỗ trợ (`capabilities` thiếu `bug-finding-review`): server không xếp job, lượt `failed` với lý do
  "Mac chưa cập nhật 2P Crew có Bug Finding".

## 6. Đóng gói và cập nhật app

- **Vị trí**: `2P Crew.app/Contents/Resources/Bug Finding.app` (`extraResources` của `electron-builder.yml`).
- **Nguồn**: file ghim `apps/mac-app/bug-finding.pin.json` `{ "repo": "<URL git repo bug-finding>", "commit": "<40
  hex>", "version": "<CFBundleShortVersionString>" }`. `scripts/release.mjs` clone đúng commit vào thư mục tạm, chạy
  `apps/mr-review-queue/scripts/build-app.sh --out <dir> --sign "$CSC_NAME" --hardened-runtime`, chép kết quả vào
  `apps/mac-app/build/bug-finding/`. Nâng bản Bug Finding = commit đổi file ghim trong `my-crew`.
- **Ký và notarize**: Bug Finding ký bằng cùng Developer ID với 2P Crew, bật hardened runtime và timestamp; notarize
  chung gói của 2P Crew. Chứng chỉ tự ký "MR Review Queue Local Signing" chỉ còn cho build tay ở repo `bug-finding`.
- **Bundle id giữ `local.mrreviewqueue`** và thư mục dữ liệu `~/Library/Application Support/MRReviewQueue`: cookie
  GitLab, state, lịch sử review, token GitHub trong Keychain giữ nguyên. Lần đầu bản ký mới đọc Keychain, macOS có
  thể hỏi lại "Luôn cho phép" một lần (đổi người ký).
- **Mở**: nút **Mở Bug Finding** chạy `/usr/bin/open <đường dẫn app nhúng>`. 2P Crew tự mở nền (`open -g`) khi nhận
  job review mà app chưa chạy.
- **Bản cài riêng cũ** `/Applications/Bug Finding.app`: mục Bug Finding cảnh báo và có nút chuyển vào Thùng rác
  (`shell.trashItem`, như gỡ app v2); bản cũ đang chạy thì nhắc thoát trước. Hai bản cùng bundle id không được chạy
  cùng lúc (cùng `state.json`).
- **Cập nhật**: Bug Finding đổi khi 2P Crew đổi bản. Bước chờ máy rảnh (`update/drain.ts`) thêm điều kiện "Bug Finding
  không có lượt đang chạy" (đọc `heartbeat.json`), rồi thoát Bug Finding trước khi cài; sau cài, 2P Crew mở lại Bug
  Finding nếu trước đó đang mở. Quay lui 2P Crew thì Bug Finding quay lui theo (cùng gói).
- **Yêu cầu máy phát hành**: Swift 6 (Command Line Tools) để build Bug Finding.

## 7. Đồng bộ project Crew → Bug Finding

- **Nguồn**: `projects.list()` của mac-app (`apps/mac-app/src/main/projects/ipc.ts`: project REST Paperclip ghép trạng
  thái Mac). Lấy project có repo trên máy này: `docsRepo`, hoặc thư mục gốc trong tiến độ thêm project, hoặc repo chính
  của checkout `~/crew-agents/<key>/*` (`git rev-parse --git-common-dir`).
- **Ghi**: 2P Crew ghi atomic `~/Library/Application Support/MRReviewQueue/crew/projects.json`:
  ```json
  { "schema": "crew-projects/1", "writtenAt": "<ISO>", "companyId": "<uuid>",
    "projects": [{ "crewProjectId": "<uuid>", "key": "my-crew", "name": "my-crew", "repoPath": "/abs/path" }] }
  ```
  Ghi khi mở app, sau thêm/gỡ project, sau job `prepare-checkouts`/`ensure-project`/`remove-checkouts`, mỗi 10 phút,
  và khi bấm **Đồng bộ lại**. Nội dung không đổi thì không ghi lại.
- **Áp bên Bug Finding** (khi mở app, khi file đổi, mỗi 60 giây):
  - project đã có `crewProjectId` trùng → cập nhật `name`, `repoPath`;
  - chưa có nhưng có project cùng `repoPath` (so `realpath`) → gắn `crewProjectId` (giữ lịch sử);
  - chưa có → tạo `Project` như **Thêm project** (đọc remote điền nguồn GitLab/GitHub, URL, project path), worktree
    mặc định `<cha>/<repo>-reviews`;
  - project có `crewProjectId` không còn trong danh sách → `crewRemovedAt` = giờ hiện tại, nhãn "Crew đã gỡ", không
    xóa (lịch sử review còn). Có lại thì bỏ nhãn.
  - Người dùng sửa tay project đồng bộ (spec docs, song song, Confluence, nền tảng) được giữ; chỉ `name`, `repoPath`
    do Crew quản.
- **Thêm trong Bug Finding**: project người dùng tự thêm vẫn có, không gửi ngược về Crew (giả định G4).

## 8. Crew xếp MR vào hàng đợi Bug Finding và đọc báo cáo

### 8.1 Đường đi

```text
server (vào stage 2) ─ job bug-finding-review ─▶ 2P Crew (Mac của project) ─ inbox file ─▶ Bug Finding
Bug Finding ─ outbox file (tiến độ, kết quả) ─▶ 2P Crew ─ POST /bug-finding/results ─▶ server
server ─ lưu crew_bug_finding_runs, đính báo cáo, comment hệ thống, đánh thức reviewer ở stage 2
```

### 8.2 Việc máy `bug-finding-review`

Payload: `{ requestId, issueId, identifier, run, projectId, projectKey, repoPath, provider: "github", prNumber,
prUrl, headSha, baseBranch, reviewerInputText? }`. Máy đích là máy của project ghim cho issue (`issue_machine_pins`,
không có thì máy đầu tiên `ready` trong `project_machines`). 2P Crew: kiểm payload, ghi
`MRReviewQueue/crew/requests/<requestId>.json`, mở Bug Finding nền nếu chưa chạy, trả job `done` với `{ accepted: true }`
ngay (không giữ job suốt lượt review). Lỗi: `project_missing` (không có repo của project trên máy),
`bug_finding_missing` (không tìm thấy app nhúng), `standalone_running` (bản cài riêng cũ đang chạy, mục 6).

### 8.3 Bên Bug Finding

- Đọc `requests/*.json`, tìm project theo `crewProjectId` (chưa có thì đồng bộ ngay rồi tìm lại), `Fetch MR` của
  project đó, tìm MR theo `prNumber`, kiểm `headSHA == headSha` (khác thì `failed` lý do `head_mismatch`), xếp lượt
  bằng `ReviewQueue.enqueue(key, input: ReviewerInput(text: reviewerInputText))`, gắn `crewRequest {requestId,
  identifier, run}` vào `QueueItem` và `ReviewRound`. Chạy như lượt thường (giới hạn song song, chờ mạng, tài nguyên,
  dừng/resume/hủy tay vẫn dùng được).
- Ghi `MRReviewQueue/crew/responses/<requestId>.json` (atomic), cập nhật khi đổi trạng thái và tối đa 1 lần/phút khi đang
  chạy: `{ schema: "crew-review-response/1", requestId, state: queued|running|succeeded|failed|cancelled, round,
  headSha, lanes: {done, total}, startedAt, finishedAt, verdict, usage: {costUsd, tokens}, resultDir, reportPath,
  error }`.
- `heartbeat.json` mỗi 15 giây: `{ pid, version, at, running, waiting }`.
- UI: nhãn **Crew** trên project đồng bộ, trên MR và lượt do Crew xếp; dải ghi chú trong chi tiết MR (mockup 5).

### 8.4 2P Crew chuyển kết quả, server lưu

- 2P Crew theo dõi `responses/` (`fs.watch` + quét mỗi 30 giây), gửi `POST /api/plugins/crew.core/api/bug-finding/results`
  (board key của máy, kèm `machineId`) với trạng thái; khi `succeeded` gửi thêm `review-result.json` rút gọn (finding:
  `id, rule, title, severity, certainty, status, action, mr_relation, location, fix, accept, question`) và báo cáo `.md`
  (≤ 2 MB). Gửi lỗi thì thử lại theo lũy thừa, giữ hàng đợi gửi trong `app.json`.
- Server: bảng `crew_bug_finding_runs (id, company_id, issue_id, run, request_id, head_sha, pr_url, machine_id, state,
  verdict, lanes_done, lanes_total, findings jsonb, feedback_text, report_attachment_id, cost_usd, error, created_at,
  started_at, finished_at)`. Kết quả cuối: đính báo cáo vào ticket tổng, comment hệ thống
  `crew-bugfinding run=<n> sha=<head> verdict=<v> open=<k>`, đánh thức participant hiện tại của stage 2 (reason
  `crew_bug_finding_result`). Lượt có `request_id` lạ, head khác lượt đang chờ, hay máy khác máy được giao bị từ chối.
- `GET …/issues/<id>/bug-finding`: mọi lượt, finding, số lô sửa trong vòng hiện tại; dùng cho web, Trợ Lý, reviewer.

## 9. Bật tắt và tương thích

- `crew-policy.json` của company thêm `bugFinding: { enabled: boolean }` (mặc định `false`). Chỉ ticket tổng tạo sau khi
  bật, không nhãn `research`/`docs`/`plan`, project có `origin` GitHub mới nhận `root-bf`.
- Thứ tự lên bản: Bug Finding (commit có cầu nối) → 2P Crew mới (nhúng, job kind mới, `capabilities`) trên mọi Mac →
  server + plugin (migration, policy, gate, UI) với cờ tắt → `apply-roles` template mới → bật cờ.
- Ticket tổng đang chạy giữ policy cũ (policy ghim); `crewPolicyKind` nhận cả hai cấu trúc.

## 10. Giả định Trợ Lý và executor tự chốt

- G1. Giữ đủ tính năng Bug Finding (GitLab qua VPN, GitHub, Confluence, parity, spec docs).
- G2. Project Crew tự xuất hiện bên Bug Finding; thêm project mới trong Crew tự thêm sang.
- G3. Luồng mới chỉ cho ticket tổng code/bug của project có `origin` GitHub (integrator đã mở PR bằng `gh`); repo khác
  giữ luồng cũ cho tới khi có MR GitLab.
- G4. Đồng bộ một chiều Crew → Bug Finding.
- G5. Tối đa 2 lô sửa tự động mỗi vòng duyệt của owner (3 lượt Bug Finding); vượt thì owner quyết ở màn duyệt.
- G6. Stage 2 giao reviewer làm cầu nối (lý do ở mục 5.1).
- G7. Integrator merge bằng `gh pr merge --merge` (giữ commit của từng con); repo cấm merge commit thì dùng
  `--squash` theo `gh repo view --json mergeCommitAllowed`.
- G8. Merge bị conflict (nhánh mặc định đã đi tiếp): integrator không tự sửa, comment `Integrator: chưa merge được —
  conflict` và dừng, không đổi status; owner xử lý conflict trên GitHub rồi comment trên ticket tổng; integrator chạy
  lại: PR đã merge (merge commit chứa `T`) thì hoàn tất, PR còn mở và gộp được thì merge.
- G9. Bug Finding chạy trên đúng Mac giữ project của ticket tổng, dùng `claude` và đăng nhập `gh` của Mac đó.

## 11. Tiêu chí nghiệm thu (của việc triển khai)

1. Cài 2P Crew bản mới: có `Contents/Resources/Bug Finding.app` ký Developer ID, `codesign --verify --deep --strict`
   và `spctl -a` đạt; mục **Bug Finding** mở được app; dữ liệu Bug Finding cũ (project, lịch sử, cookie) còn nguyên.
2. Mọi project Crew có repo trên Mac xuất hiện bên Bug Finding với nhãn Crew trong ≤ 60 giây; thêm project mới trong
  Crew thì bên kia tự có; gỡ thì có nhãn "Crew đã gỡ", lịch sử còn.
3. Ticket tổng code/bug mới (cờ bật): policy đúng 4 stage `integrator → reviewer → owner → integrator`; không còn
   review Claude ở cấp gốc.
4. Mọi con xong → integrator gộp, kiểm, mở PR; gate chặn `done` khi thiếu `crew-pr` cho merged commit.
5. Vào stage 2 → job `bug-finding-review` tới đúng Mac, lượt xuất hiện trong hàng đợi Bug Finding với nhãn Crew; UI
   Bug Finding hiện lane/log; web hiện tiến độ.
6. Kết quả `succeeded` → báo cáo đính vào ticket tổng, reviewer được đánh thức và quyết định đúng luật mục 5.5.
7. Trợ Lý phân loại đúng bảng mục 5.3: con sửa cho finding tự sửa được, một thẻ hỏi cho finding cần owner, không tự
   bỏ qua `HIGH`/`CRITICAL`.
8. Bug Finding chỉ chạy lại **một lần** sau khi **mọi** con của lô xong (không chạy khi mới xong một phần), dùng
   `recheck` và phản hồi `crew-bf-feedback`; lô không có code mới thì không chạy lại.
9. Tối đa 2 lô sửa tự động mỗi vòng; vượt thì sang owner với danh sách finding còn mở.
10. Owner bấm **Duyệt và merge** → integrator merge PR đúng commit đã duyệt; gate chặn `done` khi thiếu
    `crew-merge … pushed=merged`.
11. Owner yêu cầu sửa → chạy lại từ stage 1; Bug Finding chỉ chạy khi head PR đổi.
12. Ticket tổng research/docs/plan và ticket tổng cũ chạy luồng cũ không đổi.
13. Bug Finding hỏng/hết giờ hai lần → owner nhận thẻ xác nhận bỏ qua; không kẹt im lặng.
14. Cập nhật 2P Crew khi Bug Finding đang review: updater chờ lượt xong rồi mới cài.
