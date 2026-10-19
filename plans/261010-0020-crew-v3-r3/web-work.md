# Crew v3 R3: gói `work` (WK-1..WK-4), kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Các màn hình công việc hằng ngày của owner:
- Tổng quan (S2), Hộp thư (S3);
- danh sách yêu cầu (S4), dialog Yêu cầu mới (S5);
- chi tiết issue (S6), chi tiết run (S12), tìm kiếm (S19).

Mỗi nút làm đúng tác dụng ở cột "Tác dụng thật" của BA mục 1.

**Architecture:** Mỗi feature là một thư mục `src/features/<f>/` có:
- `routes.tsx` (export `routes`);
- `locales/{vi,en}.json`;
- trang, hook `useQuery`/`useMutation` dùng `api` và `queryKeys` của DS-3;
- giao diện chỉ ghép từ `@/ds`.

Mutation thành công thì invalidate query liên quan. Lỗi server hiện bằng `ErrorState` với message nguyên văn.

**Tech Stack:** như [web-ds.md](web-ds.md).

**Spec:** [plan.md](plan.md) (Review Focus 2, 3, Interface I5, I6, I7), spec §4.9, BA mục 1 S2–S6, S12, S19 và mục 2 phần "Issue".

## Global Constraints

Áp dụng Global Constraints của [plan.md](plan.md) và [web-ds.md](web-ds.md). Riêng gói này:

- Chỉ ghi `src/features/{dashboard,inbox,issues,runs,search}/**` và `test/features/{dashboard,inbox,issues,runs,search}/**`.
- Không có thao tác nào trong BA mục 2 phần "Issue":
  - đổi trạng thái tự do, đổi assignee/project/label/parent/blocked-by;
  - chọn reviewer/approver/watchdog, chọn model;
  - thêm issue con, Kanban, xóa issue.
- Thiếu endpoint hay widget thì dừng, báo Trợ Lý mở FX gói `ds`. Không tự thêm vào `src/api/**`, `src/ds/**`.
- Test component dùng `fetch` giả trả JSON có hình như API thật. Fixture lấy từ kiểu `@paperclipai/shared`; mỗi fixture ghi dòng nguồn (route server).

---

### Task 1 (WK-1): Danh sách yêu cầu và dialog Yêu cầu mới

**Files:**
- Create:
  - `src/features/issues/{routes.tsx,index.ts}`, `src/features/issues/list/{issues-page.tsx,use-issues.ts,tree.ts}`
  - `src/features/issues/new/{new-request-dialog.tsx,use-create-request.ts,kinds.ts}`
  - `src/features/issues/locales/{vi,en}.json`
  - `test/features/issues/{tree.test.ts,issues-page.test.tsx,new-request-dialog.test.tsx,use-create-request.test.ts}`

**Interfaces:**
- Consumes:
  - `api.issues.list(companyId, {view:'compact', …})`, `api.labels.list`, `api.attachments.upload(companyId, issueId, file)`;
  - data `crew.roots`, roles route;
  - `useProjectReadiness(companyId)` (WZ-1, `@/features/readiness`);
  - `warnForAttachment(name)` từ `@crew/paperclip-plugin/shared/attachment-rules`.
- Produces:
  - `NewRequestDialog` (mở từ S4.4 và từ sidebar "Yêu cầu mới");
  - `openNewRequest()` qua `src/features/issues/index.ts`.
  - DS-3 sidebar gọi qua route `issues/new`, query `?new=1`. Không import chéo vào `app`.

- [ ] **Step 1: Test `tree.ts` (đỏ).** `buildIssueTree(issues)` lồng con dưới cha theo `parentId`. Cha không có trong danh sách thì con thành gốc. Giữ thứ tự `updatedAt` giảm dần. Có ca ba tầng.
- [ ] **Step 2: Test dialog (đỏ)** `new-request-dialog.test.tsx`:
  - Hộp chọn project chỉ có project `state === 'ready'` (S5.1).
  - Loại Nghiên cứu gửi `labelIds:[<id nhãn research>]`; Code/Bug không gửi `labelIds` (S5.2). Nhãn tìm theo `name === 'research'`; không có nhãn thì ẩn loại Nghiên cứu và hiện gợi ý trong dialog.
  - Người nhận hiển thị cố định là Trợ Lý của project và gửi `assigneeAgentId = roles.assistantAgentId` (S5.4).
  - Nút Tạo gửi `POST /companies/:c/issues {title, description, projectId, assigneeAgentId, status:'todo', labelIds?}`. Không có `executionPolicy`, không có reviewer/approver (S5.5).
  - Lưu nháp gửi `status:'backlog'` (S5.6).
  - Hủy không gọi API (S5.7).
  - Đính kèm `a.zip` hiện cảnh báo, vẫn cho tạo. Upload chạy sau khi có issue id, theo thứ tự (S5.3).
- [ ] **Step 3: Chạy, đỏ.**
- [ ] **Step 4: Cài.**
  - Danh sách (S4.1–S4.3): bộ lọc trạng thái, project, người làm, loại; sắp xếp; nhóm. Lọc, sắp xếp, nhóm đều nằm trong URL query, không ghi DB.
  - Cột "Giai đoạn Crew" và "x/y con xong" lấy từ `crew.roots` theo issue id.
  - Nút "Yêu cầu mới" (S4.4).
- [ ] **Step 5: Xanh**; typecheck; lint; test luật design system và i18n của DS vẫn xanh.
- [ ] **Step 6: Commit** `feat(crew-web): danh sách yêu cầu và tạo yêu cầu mới`.

---

### Task 2 (WK-2): Chi tiết issue, phần chung

**Files:**
- Create:
  - `src/features/issues/detail/{issue-page.tsx,properties-panel.tsx,comments.tsx,composer.tsx,attachments.tsx,documents.tsx,issue-runs.tsx,title-editor.tsx,use-issue.ts}`
  - `test/features/issues/{properties-panel,comments,composer,attachments,issue-runs,title-editor}.test.tsx`
- Modify: `src/features/issues/routes.tsx`, `locales/*.json`

**Interfaces:**
- Consumes:
  - `api.issues.get`, `api.issues.patch`, `api.issues.putTitle`, `api.issues.markRead`;
  - `api.comments.list/create`, `api.attachments.upload/delete`;
  - `api.documents.list/get`, `api.runs.listForIssue`, `api.runs.cancel`.
- Produces: `IssuePage` có các khe cho WK-3:
  - `slots.summary` (trên đầu);
  - `slots.actions` (cạnh tiêu đề);
  - `slots.interactions` (trên ô soạn).

  Khe nằm trong `issue-page.tsx` dưới dạng component con import từ `./crew/*`. WK-2 tạo `./crew/{summary-slot,actions-slot,interactions-slot}.tsx` trả `null`. WK-3 thay nội dung ba file này.

- [ ] **Step 1: Test (đỏ).**
  - `properties-panel.test.tsx` (S6.13): hiển thị trạng thái, người làm, project, loại, cha/con, blocked-by, stage + người duyệt, vòng `n/5`, model (`crew-model` từ issue), thời gian. Không có control nhập nào (`queryAllByRole('combobox'|'textbox'|'checkbox')` rỗng).
  - `composer.test.tsx` (S6.5): gửi `POST /issues/:id/comments {body}`; dán file thì upload attachment rồi chèn link; không có bộ chọn model.
  - `attachments.test.tsx` (S6.6): xóa file có `ConfirmDialog`; chỉ hiện nút xóa cho file do user hiện tại tạo (`createdByUserId === me.id`).
  - `issue-runs.test.tsx` (S6.15): run `running`/`queued` có nút Dừng run có xác nhận, gọi `POST /heartbeat-runs/:runId/cancel`.
  - `title-editor.test.tsx` (S6.12): sửa tiêu đề gọi `PUT /issues/:id/title`, sửa mô tả gọi `PATCH {description}` và **chỉ** có `description`.
  - `comments.test.tsx` (S6.4, S6.16): mở trang gọi `POST /issues/:id/read` đúng một lần; nút copy mã, copy link dùng `navigator.clipboard`.
- [ ] **Step 2: Chạy, đỏ.** **Step 3: Cài.**
  - Transcript run trực tiếp (S6.4) dùng widget `Transcript`, mặc định thu gọn.
  - Tài liệu (S6.14) chỉ đọc qua `MarkdownView`.
- [ ] **Step 4: Xanh, typecheck, lint.**
- [ ] **Step 5: Commit** `feat(crew-web): chi tiết issue, bình luận, đính kèm, tài liệu, run`.

---

### Task 3 (WK-3): Phần Crew của issue và thao tác cổng

**Files:**
- Modify: `src/features/issues/detail/crew/{summary-slot,actions-slot,interactions-slot}.tsx`, `locales/*.json`
- Create:
  - `src/features/issues/detail/crew/{gate-actions.ts,gate-dialogs.tsx,interaction-card.tsx}`
  - `test/features/issues/{gate-actions.test.ts,gate-actions.test.tsx,interaction-card.test.tsx,summary-slot.test.tsx}`

**Interfaces:**
- Consumes: I7; `CrewSummary`, `CrewMap`, `DocsCheckPanel` (DS-4); data `crew.map`, `crew.docsCheck`; `api.interactions.respond/accept/reject`.
- Produces:
  - `gateActionsFor(issue, me): GateAction[]` (thuần);
  - `GateAction = { id: 'approve' | 'request_changes' | 'cancel' | 'reopen'; body: (comment?: string) => PatchIssueBody }`.

- [ ] **Step 1: Đọc code server, chốt I7.** Đọc:
  - `server/src/services/issue-execution-policy.ts`;
  - nhánh `PATCH /issues/:id` trong `server/src/routes/issues.ts` (phần chuyển stage khi người tham gia approval đặt `done`, và khi yêu cầu sửa);
  - `server/src/crew/issue-gate.ts` (nhánh board → `override` ở đâu).

  Ghi vào ledger, có dòng code làm nguồn:
  1. body chính xác của Duyệt và Yêu cầu sửa;
  2. điều kiện để server coi đó là **hoàn tất stage** chứ không phải `board_override`;
  3. người nhận việc sau Yêu cầu sửa.

  Nếu Duyệt bằng `PATCH` luôn thành `board_override` thì dừng, báo Trợ Lý (vi phạm Q3/Review Focus 2). Không tự đổi sang cách khác.
- [ ] **Step 2: Test thuần (đỏ)** `gate-actions.test.ts`:

```ts
const me = { id: 'user-1' };
const atApproval = { status: 'in_review', executionState: { currentStageType: 'approval', currentParticipant: { type: 'user', userId: 'user-1' } } };
it('duyệt và yêu cầu sửa chỉ có khi user là người tham gia stage approval', () => {
  expect(gateActionsFor(atApproval as any, me).map((a) => a.id)).toEqual(['approve', 'request_changes', 'cancel']);
  expect(gateActionsFor({ ...atApproval, executionState: { currentStageType: 'review', currentParticipant: { type: 'agent', agentId: 'a' } } } as any, me).map((a) => a.id)).toEqual(['cancel']);
});
it('mở lại chỉ khi done/cancelled', () => {
  expect(gateActionsFor({ status: 'done', executionState: null } as any, me).map((a) => a.id)).toEqual(['reopen']);
});
it('body không bao giờ có policy hay assignee', () => {
  for (const a of gateActionsFor(atApproval as any, me)) {
    const body = a.body('lý do đủ dài');
    expect(Object.keys(body).sort()).toEqual(expect.arrayContaining(['status']));
    for (const k of ['executionPolicy', 'assigneeAgentId', 'assigneeUserId']) expect(body).not.toHaveProperty(k);
  }
});
it('yêu cầu sửa bắt buộc lý do ≥ 5 ký tự', () => {
  expect(() => gateActionsFor(atApproval as any, me).find((a) => a.id === 'request_changes')!.body('ok')).toThrow();
});
```

  Giá trị `status`/`comment` của body theo kết quả Step 1.
- [ ] **Step 3: Test component (đỏ)** `gate-actions.test.tsx`:
  - Hủy mở `ConfirmDialog`, gửi `PATCH {status:'cancelled'}`.
  - Server trả 422 `{error:'…'}` thì hiện `ErrorState` với message nguyên văn, không gọi lại API.
  - Sự kiện WS đổi `executionState` thì nút Duyệt biến mất (invalidate rồi render lại).
- [ ] **Step 4: Test thẻ câu hỏi (đỏ)** `interaction-card.test.tsx` (S6.9):
  - chọn phương án → `POST …/respond` với body đúng hình interaction (đọc `server/src/routes/issues.ts` phần interactions);
  - "Khác" + chữ → respond có text;
  - thẻ xác nhận → `accept`/`reject`.
- [ ] **Step 5: Test tóm tắt (đỏ)** `summary-slot.test.tsx` (S6.1–S6.3): issue gốc hiện dòng "x/y con xong · giai đoạn · docs" và nút Mở/Đóng map; bấm ô trong map điều hướng tới issue con.
- [ ] **Step 6: Chạy, đỏ. Step 7: Cài. Step 8: Xanh, typecheck, lint.**
- [ ] **Step 9: Commit** `feat(crew-web): duyệt, yêu cầu sửa, hủy, mở lại và thẻ câu hỏi trên issue`.

---

### Task 4 (WK-4): Tổng quan, Hộp thư, chi tiết run, tìm kiếm

**Files:**
- Create:
  - `src/features/dashboard/{routes.tsx,dashboard-page.tsx,use-dashboard.ts,locales/*}`
  - `src/features/inbox/{routes.tsx,inbox-page.tsx,tabs.ts,locales/*}`
  - `src/features/runs/{routes.tsx,run-page.tsx,run-actions.ts,locales/*}`
  - `src/features/search/{routes.tsx,search-page.tsx,locales/*}`
  - `test/features/{dashboard,inbox,runs,search}/*.test.ts(x)`

**Interfaces:**
- Consumes:
  - `api.dashboard.get`, `api.runs.list/live/get/events/log/issues/cancel`, `api.agents.wakeup`;
  - `api.inbox.*` (`markRead`, `markUnread`, `markAllRead`, `archive`, `unarchive`), `api.search.query`;
  - data `crew.machines`;
  - widget `MachineCard`, `RunRow`, `IssueRow`.
- Produces:
  - `inboxTabs(issues, me)` (thuần): tab `awaiting_me` = issue có `executionState.currentParticipant` là user hiện tại, hoặc có interaction `pending`.
  - `runActionsFor(run)`.

- [ ] **Step 1: Test thuần (đỏ).**
  - `inbox/tabs.test.ts`: `awaiting_me` bắt đúng hai trường hợp ở trên, bỏ issue đã `done`.
  - `runs/run-actions.test.ts`:
    - `queued`/`running` → `['cancel']`;
    - `failed`/`timed_out` → `['retry']`, body `{reason:'retry_failed_run', failedRunId}`;
    - `process_lost` → `['resume']`, body `{reason:'resume_process_lost_run'}`;
    - `succeeded` → `[]`.

    Lấy đúng tên status/`errorCode` và body `wakeup` từ `server/src/routes/agents.ts` (route wakeup), ghi dòng nguồn trong test.
- [ ] **Step 2: Test component (đỏ).**
  - `dashboard-page.test.tsx` (S2.1–S2.4):
    - thẻ số lấy từ `GET /companies/:c/dashboard`;
    - "chờ bạn duyệt" = `inboxTabs(...).awaiting_me.length`;
    - không có thẻ chi phí, ngân sách, nút "Resume all", banner Connectors.
  - `inbox-page.test.tsx` (S3.3, S3.4): đánh dấu đọc/chưa đọc/tất cả đã đọc và lưu trữ/bỏ lưu trữ gọi đúng endpoint; sau khi gọi thì badge sidebar được invalidate.
  - `run-page.test.tsx` (S12.1, S12.2): transcript, sự kiện, log, issue liên quan; Dừng run có xác nhận.
  - `search-page.test.tsx` (S19): kết quả issue/comment/tài liệu bấm vào mở đúng issue.
- [ ] **Step 3: Chạy, đỏ. Step 4: Cài. Step 5: Xanh, typecheck, lint.**
- [ ] **Step 6: Commit** `feat(crew-web): tổng quan, hộp thư, chi tiết run và tìm kiếm`.
