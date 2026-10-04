# Phase05 — re-review kế hoạch sau fix round1

Ngày: 2026-10-02. **READY: NO** — còn một phần P1-S2 và một regression P2 trong hợp đồng vừa đổi. S1, S3, Q1–Q3 và hai acceptance notes đã có giải pháp đủ cụ thể ở mức kế hoạch.

Phạm vi: fresh scoped replacement reviewer vì reviewer ban đầu không khả dụng trong harness hiện tại; chỉ rà sáu findings S1–S3/Q1–Q3, receipt/cache notes và regression do các hợp đồng sửa gây ra. Đọc spec đã duyệt, review/fix report, plan/research hiện tại và các hợp đồng liên quan của phase02/03/04. Không khởi động lại whole-plan review. Các số dòng dưới đây thuộc bản `phase-05-attachments.md` hiện tại; path khác được ghi rõ.

Không sửa source, không install/build/live test/full suite/model call/commit. Chỉ kiểm source `appendComment` sau khi đọc docs/index và flow server-tickets để xác minh producer hiện có; worktree không có `.codegraph/`. Báo cáo này không yêu cầu implementation hoàn tất để duyệt plan, không xem fixture là chứng nhận runtime.

## Mapping findings

| Finding | Kết luận | Producer → consumer, bằng chứng và giới hạn |
|---|---|---|
| P1-S1 inbox trước project | Addressed | `ComposeTarget` (64–68), message/submission/routing services (202–226), schema/routes (308–341) biểu diễn owner inbox chưa project. Atomic submit giữ original bằng `linked_at`, clientMessageId/hash replay, quyết định inbox có bảng riêng trước ticket. Route/re-route CAS + retirement authority default deny và revoke links/grants; test âm 875–899. |
| P1-S2 snapshot trước claim | **Remain một phần — P1-R1 bên dưới** | Metadata `InputSnapshot` không cần attempt; server-derived coverage/capabilities; immutable `DispatchInputPin` lưu command/decision/row; phase06 `AuthorizeDispatch` revalidates trong Tx (230–254, 315–316). Bootstrap scan/pending/forged subset được xử lý. Writer cho comment văn bản qua producer cũ chưa được nối vào revision đang CAS. |
| P1-S3 Trợ lý khác máy dự án | Addressed | Owner/submission authorization exact submitted IDs, designation hiện hành, grant bind snapshot, session/model/policy/process, transport bytes trực tiếp, receipt và expiry/revoke (258–343). A không cần attempt của B để đọc inputs được cấp; project executor vẫn gate riêng. Phase06 owns actual issuer/driver, port mặc định deny; không cần hoàn tất phase06 trong review plan. Test âm 926–950. Regression về source config được tách P2-R2, không phủ nhận đường transport này. |
| P2-Q1 Task4 phụ thuộc CLI Task5 | Addressed | Task4 sở hữu entry/diagnostic; report type riêng, dynamic import extract chỉ trong mode extract (565–606, 954–963). Clean Task4 không cần Task5. Task5 final image có source/image digest và corpus/boundary receipt riêng; diagnostic không mở production readiness. |
| P2-Q2 Linux native dependency | Addressed | Target Linux/glibc explicit, install production bằng frozen lockfile trong target image, không COPY host node_modules; native load probe và exact build receipt (604–621). Mac arm64/Darwin marker, wrong/missing native và final PNG/PDF corpus nằm trong acceptance (963). Research:65–74 thống nhất recipe; review không tuyên bố pin/binary đã chạy. |
| P2-Q3 receiver stop proof/quota | Addressed | Registry trước stage, host/boot/proc namespace/PID/startTicks, operation nonce, awaited close ACK hoặc native-process-gone (140–167). Lease expiry không takeover/unlink khi alive/unknown; SIGKILL proof cho phép tiến triển; terminal quota latch một lần. Native Linux two-process và forged ACK/PID reuse/DB loss tests (965–988); research:76 khớp topology. |
| Receipt trust note | Addressed | Exact stored attempt/session/model selection, snapshot/manifest/hash/modality và selected set; empty/subset không thành all-selected (345–347, 950). `reported_transport` không phải hiểu đúng hoặc completion proof. |
| Cache/open-FD revocation note | Addressed | Broker mặc định; native exposure đăng ký process tree/materialized grant, stop+reconcile trước local complete/cleanup; unknown giữ pending, không replacement (349, 744–749, 782, 950). Không hứa thu hồi bytes đã giao; native canary vẫn là joint implementation gate. |

## Những điểm còn phải sửa

### P1-R1 — S2 chưa nối mọi comment producer vào revision được claim kiểm

- **Vị trí:** phase05:250–254, 314, 450–462, 485–500, 903–924. Producer thực: `v2/server/src/tickets/decisions.ts:10–25`.
- **Bằng chứng:** S2 yêu cầu comment mới tăng `attachment_input_revisions` dưới cùng row lock để stale assessment bị từ chối ngay tại claim. Task2 chỉ chốt callback/method attachment mới và ghi giữ `appendComment(tx,ticketId,text,actor)` “as-is”. Producer hiện có chỉ insert `comments` và `comment.created`, không tăng ticket revision hoặc attachment input revision. Mục schema liệt kê submit/extraction/re-route writers nhưng không có hook/trigger cho producer text comment này. Dòng 500 còn nói input revision dùng attachment/comment event cursor, chưa nối nó với counter row và phép revalidation dòng 254.
- **Failure:** snapshot R được lưu → owner gửi text comment qua route/service cũ → comment/event commit nhưng revision row vẫn R → claim kiểm row R và pin khớp, có thể launch từ đầu vào cũ. Wake qua event sau đó không thay thế CAS đồng bộ. Cùng gap làm stale receipt/reply gate không thấy text comment nếu nó chỉ so row này.
- **Sửa hẹp:** chốt một cơ chế producer duy nhất: optional trusted comment mutation hook được tickets producer review và gọi trong cùng Tx của cả text/attachment comment; hoặc trigger additive trong009; hoặc canonical event-cursor revision được đọc/khóa và revalidate cùng claim. Ghi rõ factory/schema owner, lock order và cách tránh tăng hai lần với attachment wrapper. Giữ public signature và SQL004 đã frozen. Đồng bộ prose dòng500 với cơ chế chọn.
- **Acceptance:** test dùng actual legacy `appendComment`/route, không fixture tự bump revision: snapshot → text-only comment commit → claim/reply stale bị từ chối; barrier đảo thứ tự cho một winner đúng; attachment-comment tăng đúng một lần và rollback không để revision/event riêng. Test snapshot hiện tại có `addComment` là ý định đúng, nhưng cần bind helper vào producer này thay vì tự tạo writer thiếu trong plan.

### P2-R2 — Config revision blanket revoke làm mất lượt Assistant đang chạy khi OFF source

- **Vị trí:** phase05:302 và 950; đối chiếu binding spec:73–76 và frozen `phase-04-runtime-models.md:211`.
- **Bằng chứng:** S3 quy định “Config/designation/input/route revision đổi” làm grant/session không còn current và chặn GET/receipt/new reply; test dòng950 cũng chặn publication khi config đổi sau delivery. Không phân biệt model-source toggle với owner revoke/designation/input change. Spec và phase04 đã chốt OFF source cho phép lượt Assistant hiện tại hoàn tất, rồi mới chọn nguồn còn bật cùng máy hoặc wait.
- **Failure:** A đã start session hợp lệ; owner tắt nguồn model trong lúc A đọc/đang suy luận; revision cấu hình đổi khiến session/grant bị stale, không ghi được delivery receipt hoặc publish câu trả lời của lượt hiện tại. Đây là thay đổi hành vi từ hợp đồng mới, không phải thiếu implementation phase06.
- **Sửa hẹp:** tách admission/config revision cho session mới khỏi validity của session đã admitted. OFF source chặn session/selection/fallback mới và có hiệu lực sau lượt hiện tại; pin admission của lượt đang chạy. Owner revoke, đổi designation, input/route revision, pause/cancel hoặc mất authority vẫn dùng revocation/stop protocol đã nêu. Cập nhật `assertSessionCurrent` semantics và negative cases, không đổi frozen phase04.
- **Acceptance:** OFF trước start → waiting; OFF sau start → exact session cũ hoàn tất receipt/reply nếu inputs/grant/designation vẫn current; session kế tiếp từ nguồn OFF denied. Owner revoke/pause hoặc input đổi sau start vẫn chặn publication/dừng theo contract.

## Tương thích và gate giữ lại

- Không thấy cần đổi `DispatchPermit005`: snapshot pin là extension của JSON command payload/decision scope và bảng009, không thêm `permit.fence`. Fresh fence vẫn từ claim; exact model key so canonical phase04 object.
- Checkpoint giữ originals trong `attachmentIds` và registered manifest evidence trong `artifactIds` (757), không thêm custom field. `SourceRef` vẫn artifact có record thật; inbox dùng record riêng trước khi có ticket, route tạo evidence đúng target. Không thêm custom role prompt.
- Phase06 issuer, selection, routing/retirement và Assistant driver có owner rõ, default deny và actual integration gate. Chưa có actual phase06 implementation không tự nó là blocker; hai findings trên là mâu thuẫn/gap của hợp đồng producer hiện đang công bố.
- Native receiver proof, Docker diagnostic/final corpus, adapter bytes delivery/open-FD revoke vẫn phải được triển khai và kiểm chứng riêng. Không nâng thành PASS từ review này.

**Kết luận:** sửa P1-R1/P2-R2 trong plan/research liên quan rồi re-review đúng hai thay đổi và regression trực tiếp. Không cần mở lại phase02/03/04 frozen plans hoặc chạy paid/full-suite chỉ để đóng review kế hoạch.
