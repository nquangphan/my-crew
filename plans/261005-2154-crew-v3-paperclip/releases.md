# Crew v3 — Kế hoạch hai đợt release

Ngày: 05/10/2026. Trạng thái: owner yêu cầu PM bắt đầu thực thi trên nhánh `v3`; [ledger](progress.md) ghi actual progress. Chưa phát hành hoặc nghiệm thu R1/R2.

Nguồn: [roadmap](plan.md), [thiết kế](../../docs/superpowers/specs/2026-10-05-crew-v3-paperclip-design.md). Thay đề xuất năm release bằng hai đợt duy nhất; không bỏ yêu cầu sản phẩm, chỉ chia thời điểm nghiệm thu.

Mỗi release dùng [bảng tận dụng v2](v2-reuse.md) và bắt buộc có port inventory/source SHA/test/review report; không triển khai lại toàn bộ từ số0. R1 ưu tiên domain/gateway/workflow/model/docs/map đã có; R2 port extractor/composer và xây phần graph/dedup/usage/updater còn thiếu.

## Phần v2 bắt buộc giữ và chuyển sang v3

“Giữ” nghĩa là giữ chức năng, logic độc lập và test phù hợp; phần phụ thuộc API/DB/ID được sửa để nối Paperclip. Không khẳng định giữ nguyên toàn bộ file hoặc module đã hoàn thành. Đường dẫn nguồn và các khoảng trống nằm trong [bảng module](v2-reuse.md).

| Phần giữ | Nội dung cụ thể phải giữ | Mốc tích hợp |
|---|---|---|
| Quy tắc nghiệp vụ | Chọn workflow/model theo yêu cầu và độ nặng ticket; pin workflow; điều kiện hoàn thành; tối đa 5 vòng sửa; review độc lập, auto-merge và deploy theo duyệt/ticket | R1; nối vào gate trước thay đổi trạng thái/chạy agent của Paperclip |
| App local macOS | Shell desktop, IPC, host lock/status và kiểm quyền đã có; app là cổng vào máy local | R1; hoàn thiện pairing/transport/runtime và nghiệm thu gói ký |
| Quản lý máy/process | Journal/process identity, resource check trước dispatch, telemetry, cancel/STOP, ACK/replay, chống thực thi trùng và cleanup đúng resource thuộc run | R1; đổi run/grant binding sang Paperclip, kiểm lại crash/reconnect thật |
| BMAD/Superpowers | Installer/registry/checksum/version warning, ghim phiên bản từng run, isolation chống gọi chéo skill; manifest/render/artifact provenance | R1; hoàn thiện phần render receipt/reconcile còn thiếu và map artifact thành ticket core |
| Model pool | Inventory/probe, broker/chọn model, công tắc Claude/Codex/API từng máy, credential binding local và runtime/tool-policy/effect ledger | R1; hoàn thiện launcher/API tool loop/fallback còn thiếu, nối remote adapter |
| Trợ Lý | Schema/tool authority, workflow gates, hashing/idempotency và xử lý câu hỏi owner đã có | R1; port logic, xây phần driver/dispatch/monitor chưa hoàn thành, không giữ SQL ticket authority cũ |
| Chuẩn docs và dữ liệu docs dự án | Docs-kit/CLI, flow manifest/validator, checksum/link, import/read/search/snapshot/source commit; giữ nội dung docs dự án đã tạo | R1; import có audit/identity mapping, bổ sung semantic review và sync theo merged commit |
| UI đặc thù Crew | Request chart với ticket con/dependency, mở ticket dialog, docs UI, máy/model/workflow status và các scenario nghiệm thu đã có | R1; port component phù hợp vào UI Paperclip, đổi auth/routes/API/query |
| Đọc file và composer | Extractors, worker protocol/runner/diagnostic, corpus/negative fixtures; phần paste/file/create/comment UI đã có | R2; nối storage/ACL/attachment ID core và chứng nhận runtime thật |
| Bằng chứng và kiến thức đã làm | Nhánh/source v2, test hành vi, findings/rulings, plans và lỗi còn mở | Giữ xuyên R1/R2; làm regression đầu vào, không chuyển evidence cũ thành PASS v3 |

**Paperclip thay thế:** core quản lý ticket/project/comment, auth, scheduler/run/session và lịch sử; dùng board/list/shell nền khi phù hợp. Không port hệ server/DB ticket hoặc scheduler Crew cũ để chạy song song cùng chức năng. Các invariant recovery/session của v2 vẫn được giữ qua adapter và tests.

**Xây mới hoặc hoàn thiện:** remote adapter, compatibility facade/core patches, fork-update pipeline, runtime/assistant assembly còn thiếu; R2 thêm docs graph/dedup, usage rollup/registry UI và signed remote updater. Không ghi những phần mới này thành code v2 đã có.

Mỗi task phải chỉ rõ file nguồn/full SHA, logic và test giữ lại, phần sửa để nối core, phần mới và lý do nếu buộc viết lại. Reviewer kiểm đối chiếu bảng này; module không port được phải có quyết định kỹ thuật được ghi nhận, không âm thầm bỏ scope.

## R1 — v3.0: Crew vận hành trên lõi Paperclip

**Mục tiêu:** Owner giao yêu cầu bằng text trên web, Trợ Lý đọc docs/chọn project/workflow/model, official agent tạo story/task, thực thi trên Mac, review rồi auto-merge và đồng bộ docs theo commit.

**Điều kiện phát hành bắt buộc:** Fork Paperclip đã tích hợp và vận hành làm lõi thật trên VPS. Ticket/project/comment, run, scheduler, session và lịch sử của luồng trên thuộc Paperclip; gateway Mac thực thi qua remote adapter và trả kết quả về đúng run/ticket trên web. Crew port các module phù hợp từ v2 để bổ sung workflow/Trợ Lý/docs/machine policy. Không gọi fork skeleton, adapter prototype hoặc Crew v2 chạy độc lập cạnh Paperclip là R1. Tích hợp lõi Paperclip là trọng tâm của v3 và phải hoàn thành ở R1, không chuyển sang R2.

### Scope bắt buộc

| Nhóm | Có ở R1 | Chưa mở ở R1, hoàn thiện tại R2 |
|---|---|---|
| Paperclip fork | Stable pin, upstream remote, facade/patch registry, CI/backup/restore/upgrade rehearsal | Rehearsal thêm full dataset và updater matrix |
| Local gateway | macOS signed installer, outbound TLS, machine/project binding, telemetry/resources, cancel/resume/reconnect, cleanup | Web-triggered signed updater và rollout |
| Workflow | Cả BMAD/Superpowers, install/version warning/pin/isolation, native story/plan/task và owner gate | Mở rộng matrix theo toàn input/runtime capability yêu cầu |
| Runtime | Claude Code/Codex/API pool, API model list/tool loop thật, three switches, rationale/fallback cùng máy | Multimodal/file capability và acceptance đầy đủ |
| Trợ Lý | Một assistant local, owner chọn máy/model, read docs/routing, dispatch/review, 5 vòng sửa, event + 5 phút monitor | File context và views registry nâng cao |
| Docs | Chuẩn/validator/review, import nguyên trạng/read/search, snapshot/source commit/stale-current, merge sync gate | Structured graph, dedup và dung lượng logical/physical |
| Session/usage | Single active, checkpoint, resume cùng task hợp lệ, reviewer độc lập; transport usage/log/session và nhãn missing/partial | Full semantic normalization/rollup/subagent/shared bucket, registry/delta UI |
| Web | Board/list/dialog/request chart, dependency/repair, attention/questions, máy/model/switches/workflow/doc status | Paste/file composer, docs graph, usage/reuse/storage UI đầy đủ |
| Merge/deploy | Auto-merge, merged-result tests/review/docs, crash receipt; deploy chỉ theo approval/ticket | File-aware/full dataset recovery regression |

R1 dùng text-only input. Không render nút upload hoạt động giả; server/UI từ chối file chưa hỗ trợ và giữ nội dung text/draft. Không quảng cáo đã đọc ảnh/file. Docs import vẫn đọc file tài liệu từ source dự án theo pipeline05A, khác với attachment input của owner.

Cả hai workflow và ba nguồn runtime phải có đường chạy thật, với support matrix công khai. Không ép mọi workflow chạy trên adapter chưa tương thích. Cặp chưa chứng nhận không selectable; R2 phải đạt scope cuối, không coi support matrix là quyền loại yêu cầu.

Credential AI lưu trên Mac chạy runtime (login local/Keychain), không yêu cầu API key provider trên VPS. VPS có secret auth/DB/gateway riêng. R1 nhập provider key trong app local, web chỉ cấu hình endpoint/model/status.

### Acceptance R1

- [ ] Trên fork Paperclip và DB thật, owner tạo yêu cầu từ web; Trợ Lý phân rã qua workflow thành ticket/story/task core, scheduler cấp run qua gateway Mac; log/session/result quay về cùng core ID, web mở được ticket dialog và lịch sử. Restart/reconnect vẫn giữ authority Paperclip, không dùng server/scheduler v2 làm đường chạy thay thế.
- [ ] Feature lớn theo BMAD tạo epic/story có acceptance/dependency và gate theo release pin.
- [ ] Feature theo Superpowers đi design/plan/implement/review/verify; small change, bug và research đi đúng đường.
- [ ] Chạy thật Claude, Codex và API tool loop; owner đổi model/switch trên web; model failover không lặp side effect hoặc chuyển project máy.
- [ ] Reviewer độc lập; cố bypass gate qua raw API/tool/routine bị chặn; vòng sửa thứ5 vẫn lỗi chuyển owner.
- [ ] Telemetry thiếu/pressure cao không spawn; duplicate delivery hoặc server/gateway restart không tạo process thứ hai; lost heartbeat không bị coi là STOP.
- [ ] Agent user/plugin/subagent không nạp workflow khác; update workflow không đổi pin run cũ; nguồn OFF không tự kill attempt đã nhận.
- [ ] API/DB/Playwright thật: request→chart/dialog→owner answer→execution→review→merged commit→verified docs snapshot→complete.
- [ ] Conflict/target changed vô hiệu evidence ảnh hưởng; crash sau merge chỉ reconcile/sync; sync lỗi giữ request chưa complete.
- [ ] Signed Mac installer/close UI/permission/health, update thủ công có drain/checkpoint; production DB/blob backup và restore checksum đạt.
- [ ] Nâng fork giữa hai stable tags thật, giữ Crew policy/remote run/session/docs và migrate/restore; patch bị mất hoặc old gateway incompatible làm CI/release fail.
- [ ] Whole-branch review + release evidence exact SHA/digest, scope limitation rõ; owner duyệt deployment cụ thể.
- [ ] Reuse inventory có verdict từng module v2 và regression trên code đã port, giữ nhánh/source/evidence v2; phần Paperclip thay thế không tạo second state authority.

### Deliverable

Một server/web artifact fork được ghim, một gói Mac có chữ ký, compatibility manifest, docs/runbook, known limitations và acceptance report. Tạo tag v3.0 sau gate; staging/internal candidates không phải release thêm.

## R2 — v3.1: Hoàn thiện toàn bộ scope

**Mục tiêu:** R1 vận hành đủ nền; bổ sung đầy đủ input, docs graph/storage, usage/agent lifecycle UI và remote update, không đổi core authority.

### Scope bổ sung

1. Paste ảnh/file ở create/comment, attachment-only, preview/remove/retry/atomic link; đọc image/PDF scan/DOCX/XLSX/CSV/text/code, provenance và partial/unreadable.
2. Docs graph project-flow-file-page-ticket với API chung web/agent; content-addressed snapshot dedup, storage measurement, semantic freshness và conflict tests full dataset.
3. Usage reported/estimated/unavailable, cumulative/reset/subagent semantics, retry/fix cost, direct/children rollup/shared bucket; USD estimate khác billing và subscription quota.
4. Agent registry UI và policy reuse/delta/compatibility đầy đủ; official fresh-session requirement/worker-reviewer independence không bị thay bằng mục tiêu giảm token.
5. Signed remote update từ web, drain/checkpoint, signature/checksum/protocol/health/rollback, OS permission guidance và compatibility khi core/gateway update lệch.
6. Full responsive/keyboard/file/context/UI acceptance, monitor/backoff/cleanup/recovery và upgrade rehearsal trên toàn dataset.

### Acceptance R2

- [ ] Toàn bộ R1 regression vẫn đạt trên candidate schema/artifact mới.
- [ ] Attachments/corpus được kiểm trên runtime/máy thật; file đọc thiếu báo đúng, revoked permission không leak source.
- [ ] Graph và docs page/agent trả cùng snapshot/commit; wrong project/blob/hash/dedup mismatch bị chặn; migration restore không mất lịch sử.
- [ ] Usage duplicate/cumulative/subset không double count; failure/review/retry có count; missing null/partial, host offline batch replay đúng và telemetry lỗi không gọi lại AI.
- [ ] Resume/spawn có rationale và checkpoint; incompatible runtime không giả resume, reviewer độc lập, no cross-project/workflow session và single-active enforced.
- [ ] Remote update lúc busy/offline/replay/package lỗi/health fail/permission thiếu giữ checkpoint và rollback có bằng chứng.
- [ ] Nâng upstream candidate với dữ liệu R1+R2, file store backup/restore đồng bộ, SDK/schema/protocol/patch matrix và active-run drain/reconcile.
- [ ] Feature/bug/research text+file xuyên workflow/runtime supported matrix đầy đủ, auto-merge/docs và deploy approval đạt.
- [ ] Whole-product independent review + Playwright API/DB thật/native evidence; owner duyệt deployment artifact cụ thể.

Deliverable: tag v3.1 với server/web/Mac artifacts, upgrade/restore reports và full-scope acceptance. Sau đợt này vẫn có maintenance/security updates; chúng không phải đợt release tính năng thứ ba trong kế hoạch v3.

## Tính lại thứ tự và phụ thuộc

R1 không phải chỉ hoàn thành phase00–04: phải kéo các slice A của docs/session/assistant/integration/operations/update lên cùng mốc. Nếu thiếu05A/08A, agent sửa code xong nhưng không có docs gate/merged-commit evidence; nếu thiếu07A thì owner chưa giao việc đúng sản phẩm. Không phát hành một giao diện ticket trống rồi gọi đó là v3.0.

R1 critical path: 00 → 01/02 → 03 → 04 + 05A → 06A/07A → 08A → 09A/10A → release. Signed packaging/release contracts có thể chuẩn bị từ02/01, nghiệm thu sau integrated gate. Đối chiếu plan từng phase với exact upstream baseline trước code.

R2 critical path: 05B + 06B → 07B → 08B → 09B → 10B → release. Backend graph/dedup và attachment/usage có thể chạy song song sau DTO/ownership freeze; schema shared/core patch/Git/migration serialize. Research updater có thể đi sớm, không tranh heavy slot với run acceptance.

Không gán effort từ số phase hoặc tỷ lệ code v2. Sau00, detailed plans phải có task count/ownership/reuse delta/native test needs; PM đo cycle time và review rounds rồi mới đưa ETA có khoảng tin cậy. Mỗi release cần source freeze → test/review → staging → deployment approval; không tự chuyển release chỉ vì task ticket done.

## Quy tắc phạm vi và trạng thái

- R1 giới hạn input và views; không giới hạn permission/recovery/merge/docs invariants.
- R2 bao phủ toàn scope giữ lại từ v2/MVP2. Chuyển task từ R2 vào R1 khi dependency bắt buộc phải cập nhật bảng/contract/gate, không thêm release thứ ba.
- Các slice A/B là task ownership riêng, không đổi định dạng official BMAD/Superpowers hoặc thêm custom role prompts.
- R1 và R2 dùng cùng namespace/core authority và migration chain; release2 nâng từ release1, không dựng DB ticket mới.
- Hai release chưa có ETA calendar; không giảm test/review/restore để đổi lấy ngày hứa.
