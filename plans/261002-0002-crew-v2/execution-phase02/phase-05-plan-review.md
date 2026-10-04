# Phase05 — review độc lập kế hoạch attachment

Ngày: 2026-10-02. Phạm vi: architecture/spec và quality của **kế hoạch**, không phải nghiệm thu implementation.

**Spec readiness: CHƯA ĐẠT. Quality readiness: CHƯA ĐẠT để freeze/dispatch toàn bộ theo thứ tự hiện tại.** Có 3 finding P1 và 3 finding P2 bên dưới. Các phần staging/atomic linking có thể giữ thiết kế hiện tại trong lúc sửa hợp đồng tích hợp; review này không cho phép bỏ các producer gate đang tồn tại.

Đã đọc đầy đủ `phase-05-attachments.md` (696 dòng), research attachment, binding spec, roadmap, và đối chiếu các đoạn hợp đồng liên quan trong phase02/03/04. Phase02 Task5 đang triển khai; phase04 frozen là **plan contract**, không phải bằng chứng runtime đã chạy. Không sửa source, không cài package, không gọi model, không chạy test/build hoặc commit. Mọi tham chiếu dòng dưới đây là snapshot plan được review.

## Findings theo ưu tiên

### P1-S1 — Compose bắt buộc project/ticket làm mất đường attachment trong hội thoại trước định tuyến

- **Vị trí:** phase05:64–65, 112, 143–150, 178; handoff phase07:675. Spec:8–10, 256, 269–272.
- `ComposeSession.projectId` bắt buộc, `purpose` chỉ có `ticket|comment`, schema yêu cầu project FK và endpoint yêu cầu chọn project trước upload. Không có conversation/request inbox identity hay submit target cho message Trợ lý. Vì vậy owner gửi ảnh/file trong hội thoại để Trợ lý xác định dự án chưa biểu diễn được bằng contract hiện tại. Phần UI được giao phase07 là hợp lý, nhưng UI không thể tạo persistence/authorization target mà producer API/schema không định nghĩa.
- **Cần sửa:** chốt producer contract cho compose/message trước định tuyến: ownership, stable message/compose identity, attachment retention, atomic submit/replay và lúc chuyển sang project/ticket. Có thể giao implementation cho phase06/07 bằng một handoff cụ thể; không ép owner chọn dự án như một thay đổi ngầm của spec, không cấp quyền đọc mọi draft cho machine.
- **Negative/acceptance:** gửi chat chỉ có ảnh khi chưa có project; reconnect/lost reply không tạo message/file thứ hai; Trợ lý chọn project sau khi đọc; định tuyến sai rồi sửa không làm mất original hoặc mở ACL cross-project; draft khác vẫn invisible.

### P1-S2 — Thiếu snapshot đầu vào trước claim để chọn capability/model; bridge hiện bắt đầu sau quyết định cần nó

- **Vị trí:** phase05:86–94, 152–158, 336, 522–548, 555–557; phase04:48–50, 66–67, 92–95, 192, 211; phase03:238.
- Metadata list dành cho machine cũng yêu cầu `AttemptReadContext`. Extraction metadata là owner-only. `buildInputManifest` cần active attempt + persisted selection decision; `assessInputCompatibility` nhận `MaterializedInput` sau `RuntimePin`/fetch. Trong khi đó frozen phase04/03 yêu cầu capability/model choice và decision được lưu **trước claim**; fence/attempt chỉ có sau claim. Kế hoạch chưa định nghĩa server snapshot/read service hay protocol để phase06 biết units, extraction status, required capabilities và revision trước khi chọn model. Đây là khoảng trống producer/consumer, không phải yêu cầu phase05 tự phát permit hay viết phase06 ngay.
- **Cần sửa:** bổ sung contract preclaim input assessment được server xác thực, chứa original hashes, immutable extraction/coverage snapshot, input revision và required capabilities; phase06 dùng nó để lưu decision, claim revalidates snapshot. Tách authority đọc metadata khỏi quyền fetch bytes sau claim. Nếu dùng bootstrap read attempt thì phải định nghĩa rõ bootstrap capability/authority và transition sang execution để tránh chọn model bằng thông tin chỉ có sau khi chọn model.
- **Negative/acceptance:** ticket mới có scan PDF chưa có attempt; chỉ text model khả dụng thì wait trước dispatch; extraction pending→complete đánh thức đánh giá đúng revision; comment/extraction đổi sau assessment trước claim khiến revalidation từ chối; caller không thể hạ `vision` bằng tự khai required subset. Không dùng fixture với manifest/context có sẵn làm bằng chứng bootstrap đã được giải quyết.

### P1-S3 — Trợ lý khác máy dự án chưa có giao thức nhận nội dung/căn cứ từ project-machine read step

- **Vị trí:** phase05:156–161, 336, 553–555, 674; research:54; spec:16–17, 42–48, 287–297.
- Handoff nói Trợ lý không bound phải yêu cầu project-machine read step rồi mang evidence được phép. Tất cả machine bytes/manifest hiện vẫn đòi current project binding và attempt tại project; evidence manifest cũng gắn cùng ticket/root. Không có request/result identity, actor grant, result transport hoặc quyền đọc evidence cho central Assistant. Đưa một `SourceRef`/manifest ID vào quyết định không tự cấp quyền đọc bytes. Nếu mọi project call tiếp tục áp gate hiện tại, central Assistant bị từ chối; nếu consumer nới gate chung để làm việc, mất ranh giới ACL mà plan đang bảo vệ.
- **Cần sửa:** định nghĩa handoff read request/result riêng có authority, phạm vi selected inputs, digest/provenance, người nhận central Assistant, revision/expiry/revocation và chính sách original/derivative/evidence. Chỉ rõ central Assistant thực sự nhận representation để phân tích hay nhận báo cáo từ reader; không gọi báo cáo gián tiếp là chính Trợ lý đã đọc original. Ownership thực thi phase06 có thể giữ, nhưng contract cần đủ trước freeze phase05.
- **Negative/acceptance:** Assistant ở machine A, project ở B, image-only request; B đọc bằng vision rồi A nhận đúng phần được grant; A vẫn bị chặn GET arbitrary attachment; B offline/unknown giữ wait; rebind/revoke giữa request/result không chuyển evidence cũ thành quyền hiện tại; stale input revision không được dùng để trả lời hoặc tạo child.

### P2-Q1 — Task4 yêu cầu live GREEN với CLI chỉ do Task5 tạo, trong khi Task5 phụ thuộc Task4

- **Vị trí:** phase05:45–46, 407, 410–418, 438–439, 443, 514.
- Docker ENTRYPOINT là `src/attachments/extract/index.ts`, thuộc Task5. Task4 Step4 lại yêu cầu live container canary trước review/commit Task4; Task5 consumes Task4. Theo task-by-task ordering đã viết, Task4 không có executable để đạt gate. Đây là lỗi thứ tự/dependency cụ thể, không phải phàn nàn chưa có implementation.
- **Cần sửa:** chọn một thứ tự rõ: tách worker protocol/minimal canary entrypoint thành Task4-owned artifact và kiểm live boundary bằng nó, rồi Task5 corpus kiểm production CLI; hoặc giao Task4 infrastructure handoff trước và dời joint live GREEN/commit acceptance sau Task5 với readiness còn pending. Cập nhật ownership và dependency table tương ứng; không cho worker tự sửa file Task5.
- **Negative/acceptance:** clean checkout chỉ hoàn tất Tasks1–3 vẫn thực thi được Task4 acceptance đã công bố; canary không giả chứng minh parser corpus; production image cuối phải chứa đúng Task5 source hash và được kiểm lại trên cùng boundary.

### P2-Q2 — COPY production node_modules chưa bảo đảm native package Linux/CPU của worker

- **Vị trí:** phase05:408, 410–420, 438, 514; research:18, 35–41.
- Controller hiện chạy trên macOS; Dockerfile chỉ COPY production modules đã install/stage, không có target-platform install step hoặc cấu hình materialize optional dependency theo Linux CPU/libc. Dereference symlink giải quyết bố cục pnpm nhưng không biến Darwin native canvas thành Linux binary. Pin base multi-platform index và yêu cầu canary sau đó chưa định nghĩa cách tạo đúng input cho image. Không kết luận package đã cài sai — chưa install và chưa build.
- **Cần sửa:** quy định build target `linux/<arch>` và libc; cài/stage dependency bằng frozen lockfile trong target environment, hoặc cấu hình cross-platform materialization được kiểm chứng. Record native optional package/version/integrity, target platform, built image digest, source hash; controller ownership bao gồm build recipe/config cần thiết. Chỉ dùng dependency tree đã kiểm tương ứng target.
- **Negative/acceptance:** bắt đầu từ Mac arm64 với host Darwin-only modules; build Linux x64 hoặc arm64 target đã chọn vẫn load canvas, decode PNG và render PDF trong final image; missing/wrong native binary fail build/probe trước worker readiness, không được báo corrupt cho file hợp lệ.
- **Căn cứ ngoài plan:** official [canvas platform support](https://github.com/Brooooooklyn/canvas) và [native loader](https://raw.githubusercontent.com/Brooooooklyn/canvas/main/js-binding.js) phân nhánh Darwin/Linux/architecture/libc. Đây là kiểm chứng nguyên lý build, không là live evidence cho pin 1.0.3.

### P2-Q3 — Cleanup đòi chứng minh receiver đã dừng nhưng chưa có identity/recovery contract cho HTTP receiver

- **Vị trí:** phase05:113, 120, 127–134, 147, 180, 204, 611, 646, 656. Đối chiếu worker đã có explicit registry tại 435–437.
- Upload lưu generation + lease, nhưng không có receiver process/boot identity, durable registry hoặc operation để chứng minh receiver đã dừng sau server crash. `StageServices.receive` chỉ nhận actor/body/signal. Plan cấm cleanup theo timeout đơn thuần và yêu cầu matching receiver stopped; trong khi schema/protocol chưa cung cấp dữ kiện để phân biệt server cũ chết với server cũ vẫn chạy nhưng mất DB. CAS chặn ready commit cũ là cần thiết, nhưng tự nó không chứng minh không còn writer giữ FD/scratch. Implementer phải tự chọn giữa bỏ stop-proof rule hoặc giữ receiving stage/quota vô hạn.
- **Cần sửa:** chốt receiver ownership/liveness protocol: instance/boot identity, per-upload generation registration, abort+close acknowledgment trong process sống, và cách reconcile chứng minh writer cũ không còn có thể publish/write trước unlink khi restart/multiple instances. Có thể dùng lock/lease với storage fencing cơ học tương đương nếu chứng minh được; không suy lease hết hạn thành stop. Nêu giải phóng staging accounting sau cleanup terminal.
- **Negative/acceptance:** receiver process A treo/mất DB nhưng còn giữ FD sau lease expiry; B reconcile không unlink hoặc publish thay khi A còn quyền ghi. A bị SIGKILL rồi B restart nhận diện được stop và cleanup/recover tiến triển. Late A completion sau generation revoke không thay blob/ready của generation mới. Chạy lại cleanup không giữ quota của deleted upload mãi.

## Những phần đã có hợp đồng đủ rõ ở mức kế hoạch

- **Storage và DB crash:** intent trước I/O; file+directory fsync trước ready; exclusive publication; link transaction sau ready; tombstone trước unlink; linked_at là latch giữ original; DB/storage restore lệch được phân loại. Race submit–GC có lock order và state winner rõ (124–134, 297–312, 634–660). Không yêu cầu rename nằm trong SQL transaction.
- **Submission/idempotency:** exact active selection + revision; rejected/reserved slot không thể bị lặng lẽ bỏ; same compose/new key được replay theo canonical body; callback default-deny giữ invariant comment rỗng; event commit cùng links. Không thấy cần thay frozen CreateTicket hay 004.
- **ACL/revocation phía server:** checksum không làm quyền; mỗi GET và chunk kiểm binding/token/attempt; no public URL; derivative thuộc đúng original; inherited refs cùng ancestor/root. Contract nói đúng rằng bytes đã gửi không thể thu hồi (356–370).
- **Parser coverage:** unsupported visual/scan/formula cache tạo missing units; original giữ; technical verification không là hiểu nội dung. Native parsing đã có resource boundary và live gate; review không đòi OCR cloud, support mọi OOXML construct hoặc chứng nhận sandbox bằng unit test.
- **Frozen checkpoint:** original IDs ở attachmentIds và registered manifest evidence ở artifactIds là cách tương thích literal phase04; SourceRef không giả attachment ID thành evidence. Constructor wiring được giao explicit runtime owner và có gate thật (553, 595–597). Việc chưa viết adapter hook lúc review plan không tự nó là finding.

## Hai điều cần làm rõ trong contract acceptance tiếp theo

Đây là review notes bổ sung, không tăng số blocking findings ở trên:

1. **Receipt trust:** `consumed` đã được định nghĩa hợp lý là delivered, không understood (595); server cần đối chiếu runtime/modelKey với companion/selection của exact attempt, manifest digest, selected set và modality. Cần negative case fenced machine gửi runtime/model khác attempt hoặc empty/partial `consumed` list: record chỉ được diễn giải đúng phần thật sự delivered, không nâng thành whole-input read. Receipt vẫn là reported transport evidence, không completion proof. Các checks hiện nêu tại 576 mới nói unknown derivative/unit/wrong modality.
2. **Local cache revocation:** yêu cầu deny cache read ngay tại 578 mạnh hơn HTTP chunk revocation. Khi runtime đã được cấp local path tại 593, đổi map cache không tự tước native open FD hoặc sandbox grant. Joint phase04 integration phải mô tả protected broker access/stop-and-revoke mechanism và semantics với bytes đã materialize; negative canary mở file trước revoke rồi thử đọc tiếp qua native tool/child. Không cần sửa frozen public RuntimeAdapter signature; hook implementation và exact stop/policy boundary phải được review.

## Điều kiện re-review

Sửa hợp đồng và ordering cho S1–S3/Q1–Q3 trong plan/research, gắn owner triển khai từng handoff và negative cases tương ứng. Review lại bằng producer/consumer contract; không cần cài package, chạy full suite hoặc gọi model chỉ để đóng review kế hoạch. Actual schema005/007/008, ticket callback, live worker image/corpus và runtime delivery vẫn là các gate implementation riêng, không được ghi PASS từ report này.
