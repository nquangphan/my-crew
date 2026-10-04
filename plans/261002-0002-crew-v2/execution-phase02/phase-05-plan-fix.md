# Phase05 — sửa kế hoạch sau review round1

Ngày: 2026-10-02. Đầu vào: `phase-05-plan-review.md`, sáu blocking findings S1–S3/Q1–Q3 và hai acceptance notes. Phạm vi: chỉ sửa phase05 plan/research và report này. Trạng thái: **READY cho re-review kế hoạch**, chưa freeze, không tuyên bố implementation hoặc live test PASS.

## Mapping finding → hợp đồng đã sửa → test

| Finding | Sửa trong `phase-05-attachments.md` | Producer/consumer và acceptance đã thêm |
|---|---|---|
| P1-S1 inbox trước project | `ComposeTarget` thêm assistant_message/conversation; AttachmentRef dùng ownerId bất biến; mục S1 định nghĩa message/clientMessageId, atomic submit/retained latch, message decisions trước ticket, route/re-route CAS và revoke links/grants | Tasks1/2 tạo schema009/services; phase06 routing/retirement authority default deny; phase07 gửi ảnh-only trước project. Task2 RED/GREEN inbox/retry/lost reply/foreign draft/routeB→C giữ original; active/unknown route bị chặn. |
| P1-S2 capability trước claim | Mục S2: InputSnapshot metadata không cần attempt, server-derived capabilities/status/coverage/hash/revision; DispatchInputPin lưu ở command+decision+attachment_dispatch_inputs; claim revalidate cùng target row lock | Task3 producer, phase06 selection/AuthorizeDispatch consumer. Test zero attempts + scan vision vs text-only, pending→complete, comment/extraction đổi trước claim, forged downgrade/subset và stale pin. Postclaim fetch vẫn qua AttemptReadContext. |
| P1-S3 central Assistant khác máy | Mục S3: owner/submission-authorized exact IDs; current designation/config/revision/expiry/revocation; grant bind snapshot; AssistantReadSession/model selection; protected representation transport trực tiếp và receipt | Task3 grants/access + Task6 transport; phase06 actual issuer/session authority default deny. A đọc PNG bytes thật của selected inbox inputs, không cần project B attempt; B offline không cấm A đọc nhưng code ở B chờ. Arbitrary file/draft/executor access vẫn denied. Test source OFF/A offline/stale/revoke/model mismatch/partial receipt. Không dùng indirect summary như original read. |
| P2-Q1 Task4 cần entrypoint Task5 | Task4 sở hữu worker-entry/worker-diagnostic; diagnostic không import Task5 và chỉ phát DiagnosticReport. Task5 production extract module dùng cùng runner/limits/boundary, final image có source hash/corpus receipt riêng | Task4 clean-checkout diagnostic test không includeExtractors; missing extract/diagnostic-only receipt không production-ready. Task5 final image decode PNG/render PDF/full corpus và boundary lại. |
| P2-Q2 native binary target | Dockerfile target Linux + frozen install bên trong target environment, không COPY host node_modules; baseline linux/amd64/glibc, arm64 build/receipt riêng; native package integrity/image/source/lock evidence | Controller sở hữu context/lock review/build recipe. Research xác minh official Docker/pnpm/native loader và x64/arm64 native metadata. Test Mac arm64 host Darwin-only modules bị exclude, Linux canvas load; wrong/missing native fails readiness, không corrupt-file. |
| P2-Q3 receiver stop proof | Mục Q3: ServerWriterIdentity/ReceiverRegistration/WriterStopProof; host boot/proc namespace/PID/startTicks; close ACK sau write/FD closure; registration trước stage; no takeover/unlink khi alive/unknown; quota_released_at latch | Task1 receivers/schema + Task7 recovery. Test A mất DB còn FD sau lease, B không unlink; SIGKILL A rồi B native proof tiến triển; forged ACK/PID reuse/proc unavailable/late completion; cleanup retry quota0 không trừ lại. |
| Receipt trust note | Receipt phải khớp runtime/model exact stored attempt/session/selection, manifest digest và selected units; empty/subset full claim422, partial đúng coverage; trust reported_transport | Server/gateway receipt tests; không receipt nào tự chứng minh model hiểu hoặc workflow hoàn thành. |
| Cache/FD revocation note | Broker-only cache mặc định, nativeExposure có MaterializedGrant; revoke invokes stop-and-reconcile process tree trước local complete/quarantine; unknown giữ pending | Joint native canary FD/child mở trước revoke; bytes đã giao không thu hồi được. Server chặn quyền mới, phase06 chặn stale reply/child publication; không dựa unlink/chmod/map để giả tước FD. |

## Kiểm tra nội bộ đã thực hiện

- Rà producer/consumer matrix sau đổi AttachmentRef từ project identity sang owner identity; project ACL qua live link/route, không checksum hoặc initial_project_id.
- Rà bootstrap metadata→snapshot→model decision→claim và grant→snapshot bind→Assistant session→bytes→receipt; không cần attempt giả trước capability choice.
- Rà inbox decision trước ticket: bảng message_decisions riêng, không FK ticket giả; khi route tạo evidence thật có target ticket và immutable source hash.
- Rà Task4/Task5 ownership và target build: diagnostic source thuộc Task4, extract CLI thuộc Task5; final corpus receipt gắn exact final image.
- Rà receiver lease vs stop proof và quota terminal; same-host Linux topology được công bố, missing native evidence giữ unknown.
- Scan balanced code fences, không placeholder TBD/TODO/implement later; đủ bảy task với năm bước RED/GREEN/docs-review, thêm block RED/GREEN cụ thể cho cả sáu findings và hai notes.
- Chỉ read-only primary research: native optional package publisher metadata và Docker/pnpm/Linux documentation. Không install/pull/build/test runtime/model/source mutation/commit/global config/shared DB.

## Gate vẫn còn khi triển khai

Actual migration005/007/008 producers; optional comment linker producer review; phase06 actual routing/retirement/designation/issuer/preclaim/session authority; execution read gate; receiver Linux native proof; target-platform extractor build/diagnostic/final corpus; phase04/06 real representation delivery và native FD revoke. Fake/offline fixtures không chứng nhận các gate này. Phase07 layout vẫn theo prototype approval riêng.
