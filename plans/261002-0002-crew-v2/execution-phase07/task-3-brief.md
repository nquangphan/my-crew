## Task 3: Board/list/request, detail chung và timeline

**Files mới:** `v2/web/src/tickets/board.tsx`, `v2/web/src/tickets/list.tsx`, `v2/web/src/tickets/requests.tsx`, `v2/web/src/tickets/detail.tsx`, `v2/web/src/tickets/dialog.tsx`, `v2/web/src/tickets/status.ts`, `v2/web/src/tickets/history.tsx`, `v2/web/src/tickets/queries.ts`, `v2/web/test/tickets.test.ts`, `v2/web/src/tickets/create-request.tsx`, `v2/web/src/tickets/create-request-state.ts`, `v2/web/test/create-request.test.ts`, `v2/web/e2e/tickets.spec.ts`. Controller chỉ wiring router; worker không sửa graph/composer. Docs canonical `docs/v2/web-tickets.md`.

**Interfaces:**

```ts
type TicketDetailProps = { ticketId: string; presentation: 'page' | 'dialog' };
function TicketDetail(props: TicketDetailProps): React.JSX.Element;
type TicketDialogProps = { ticketId: string | null; onClose: () => void;
  returnFocus: HTMLElement | null };
function TicketDialog(props: TicketDialogProps): React.JSX.Element;
function requestRoots(tickets: readonly Ticket[]): Ticket[];
type RequestFormFields = { projectId: string; kind: 'code' | 'research' | 'docs' | 'deploy';
  title: string; description: string; workflowChoice: 'superpowers' | 'bmad' };
function makeRequestSubmission(fields: RequestFormFields): Extract<ComposeSubmission, { kind: 'ticket' }>;
const statusLabels = { pending: 'Chờ thực hiện', ready: 'Sẵn sàng', running: 'Đang chạy',
  needs_input: 'Chờ bạn', paused: 'Tạm dừng', done: 'Hoàn thành', cancelled: 'Đã hủy' } as const;
```

- [ ] S3a chỉ tạo board/list/detail/dialog/status/history/queries read interfaces sau S2, không import compose module hoặc tạo create-request files khi S5a chưa có. create-request/create-request-state và compose import thuộc S3b sau S5a. S3b và A3 chỉ khép sau S5a/A5: inject shared AttachmentComposer vào create-request và detail/comment; Task3 không sở hữu/clone upload client/composer. Task4 dùng S3a cho pure map, nhưng dialog/comment acceptance chờ A3.
- [ ] Owner Task3 tạo create-request.tsx và create-request-state.ts. Board/list/request có action “Tạo yêu cầu”, form project/kind/title/workflow và textarea description của shared composer. Superpowers mặc định, BMAD explicit; giữ field khi đổi view/reauth/retry. makeRequestSubmission map chính xác `{projectId,parentId:null,level:'request',kind,title,description,mandatory:true,criteria:{workflowChoice},inputs:{},outputs:{},skill:null,workflowPin:null,deployApprovalDecisionId:null}` và target `{purpose:'ticket',projectId,ticketId:null}`. Độ dài/enum theo strict producer; không lấy field bắt buộc từ preview. Root preference ở `v2/server/src/tickets/service.ts:141` không thay run pin/certificate G3.
- [ ] RED create-form tests và real A3 browser/DB: chọn code/research và Superpowers/BMAD, title/description tiếng Việt, có/không PNG, lost-response→reauth→same-key replay. Kiểm persisted title/kind/description/criteria.workflowChoice/attachment IDs và một entity/receipt; sau accept mở ticket.id trả về. Form khóa khi ambiguous/suspended, không đổi metadata/selection để gửi body mới cùng key.
- [ ] RED tests đủ7labels; root `level==='request' && id===rootId && parentId===null`; duplicate ID lấy revision mới. Fixture có hai root cùngtitle, orphan step, mandatory child, done/cancelled; không infer root từ trang đầu/title.
- [ ] List/board dùng exact supported filters, UUIDnextCursor đến null hoặc tải thêm rõ. Filters URL giữ qua đổi chế độ xem. Request-root pagination G1; tạm filter từng trang chỉ khi label chưa đủ/tải tiếp, không claim full danh sách root. Group status bằng chữ+icon, arbitrary status drag disabled.
- [ ] Shared detail load ticket/comments/decisions/attachments/docs refs cùng IDs. Máy/model/difficulty/attempt hiện tại/evidence chỉ từ G1/G3 typed projection; không key criteria tự quy ước hoặc prose thành typed fact. Unknown/missing rõ, không vendor strength table.
- [ ] Timeline chronological cursor từ G1/G3: decision/owner answer/review/fallback/intervention/artifact/commit/docs sync có actor/kind/time/source/rationale. Legacy comments/decisions phải đọc hết pages trước sort createdAt/id, không UUIDorder=chronology. Transcript không thay decision/evidence history.
- [ ] Radix dialog dùng chính TicketDetail, Title/Description/focus trap/inert/Escape/X. Returnfocus node trigger hoặc map container nếu node mất; realtime không giành textbox focus. Draft giữ per ticket khi close; explicit discard mới abandon. Inject một composer Task5 ở S3b sau S5a/A5, không clone forms.
- [ ] Enumerate six new callers: board card, list row, request selection, graph node, docs related-ticket link, Assistant ticket link. Controller wiring tất cả vào shared detail/query/dialog; review danh sách callsites thực tế file:line sau source tạo.
- [ ] A3 browser tests qua harness Task1 sau A2/A5/G1: deep link/reload404, keyboard/200%, draft comment retained during event, terminal read-only, needs_input/repair5 reason. Pause/cancel cần G4/G5 receipts; ACK không báo stopped. Request done đọc server evidence, không clienttoggle.
- [ ] Scoped test/types/Biome, canonical 7H2 docs+controller mapping/commit; independent reviewer kiểm authority và sáu callers.

**Success:** Board/list/dialog đọc cùng ticket/status/revision; draft được giữ khi đóng; deep link và reload hoạt động. **Risk:** M×H sai approval/status, mitigation typed producer authority. **Rollback:** Revert views/router, giữ comments/decisions accepted, không undo bằng xóa DB.

