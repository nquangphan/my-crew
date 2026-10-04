# Review kế hoạch phase 02 — server và docs

Ngày: 2026-10-02. Verdict: **cần sửa các finding Important trước triển khai**.

Đã review toàn bộ snapshot `phase-02-server-docs.md` SHA256 `ea9b7ec984e5a867f92dd57b565c1dedbfc60ce4721f6af5ff4effe3a53e2ff9` (613 dòng nội dung, newline cuối). Các line refs dưới đây thuộc snapshot này. Tác giả đang sửa đồng thời; controller báo đã có bản 633 dòng sửa thêm codec/auth/config/docs mirror. Báo cáo này không phủ nhận những sửa đổi đó và không tuyên bố đã review bản mới.

Đối chiếu spec đã duyệt đầy đủ, roadmap, `v2/docs/index.md`, flow domain, bốn domain policy phần 01 và STANDARD docs. Đây là review kế hoạch; không chạy suite, sửa source, index, Git hoặc DB. Không khảo sát code nghiệp vụ v1.

## Critical

Không phát hiện Critical trong phạm vi kế hoạch đã đọc.

## Important

### I1. Dừng attempt làm mất trạng thái nguồn cần cho completion và chờ owner

**Refs:** plan:360–371, 423; `v2/src/ticket-policy.ts` chỉ cho `passed` từ `running`.

Task 4 yêu cầu `passed` có attempt đã dừng. Nhưng Task 5 ghi `stopped/exit` luôn áp dụng `reconciled_stopped → pending`, trừ khi verified completion thành công riêng. Sau khi request reconcile đã commit, lời gọi `passed` riêng gặp `pending`, nên domain từ chối. Trường hợp research có evidence hợp lệ hoặc kết quả tới sau stop không có đường hoàn tất rõ ràng. Tương tự, `wait_owner` lúc đang chạy queue pause/wait, nhưng bảng command không có wait và reconcile pause chỉ chuyển `paused`; chưa có hợp đồng lưu lý do đợi để chuyển đúng `needs_input` sau dừng, kể cả lần sửa thứ năm.

**Sửa:** chốt state machine/transaction cho kết quả cuối và stop: lưu pending terminal intent hoặc chuyển completion/needs_input cùng giao dịch xác nhận stopped trước khi fallback sang pending. Nêu rõ đường recovery nếu bằng chứng đến sau stop; không gọi domain signal sai trạng thái hoặc bỏ gate stopped. Thêm test exit trước evidence, evidence trước exit, response lost/restart, wait_owner khi chạy và fifth repair failure sau stop. Mỗi trường hợp phải kết thúc đúng status và giữ một quyền thực thi.

### I2. Task 6 được phép chạy/nghiệm thu trước schema mà migration của nó bắt buộc dùng

**Refs:** plan:67–70, 165, 430–432, 488–511.

Bảng phụ thuộc cho docs ingest chỉ có Task 2+3 và cho chạy với Task 4/5. Tuy nhiên `006_docs.sql` vừa thêm FK cho `ticket_docs` (Task 4), vừa tạo `docs_sync_receipts` tham chiếu `attempts` (Task 5). Fixture migrate toàn bộ các SQL đang có, nên khi docs worker chạy RED/GREEN trước Task 4/5 thì lỗi thiếu relation xuất hiện trước nghiệp vụ. Nếu file migration mới xuất hiện giữa lúc hai worker kiểm thử, bộ migration áp dụng cũng không còn ổn định. Đây là lỗi kế hoạch có thể bị hiểu nhầm thành RED hợp lệ hoặc buộc worker sửa schema của task khác.

**Sửa:** giữ source validator/import chạy song song nhưng serialize SQL integration và integration tests sau Task 5; hoặc tách FK/receipt liên kết vào migration integration sau các bảng nền. Chốt migration prefix/snapshot fixture được phép dùng cho từng task và cập nhật dependency/commit gate tương ứng. Không cần bỏ khả năng chạy unit validator sớm.

### I3. Hợp đồng import chưa phân loại được workflow artifact nằm ngay trong docs/**

**Refs:** plan:165, 439–445, 458, 517, 537; spec mục 9.

`DocsImport.inventory` chỉ có một mảng files, không có `contentClass` hoặc phân loại theo file, trong khi snapshot có một `content_class` duy nhất. Allowlist import nhận toàn bộ `docs/**`; đường dẫn thực tế như `docs/superpowers/specs/...` và `docs/superpowers/plans/...` vừa lọt allowlist vừa là workflow artifact. Việc ghi “workflow artifact ingest ... future host” không giải quyết phần giao này. Import thông thường vì vậy phải chọn một nhãn cho cả docs đã triển khai lẫn spec/plan, làm tree/search gắn nhãn sai và vi phạm yêu cầu phân biệt ý định với hệ thống đã triển khai.

**Sửa:** định nghĩa phân loại input/provenance rõ ràng cho mixed bundle, rồi tách snapshot hoặc lưu class theo page mà vẫn giữ nguyên byte/path. Nếu có phần cố ý hoãn, phải kiểm kê và báo rõ phần chưa nhập, không âm thầm gắn nhãn implemented. Thêm fixture cùng bundle có flow docs và Superpowers spec/plan; assert search/tree giữ byte, nguồn và nhãn riêng đúng.

## Minor

### M1. Khóa docs_links làm mất phân biệt fragment của cùng trang đích

**Refs:** plan:165, 449–450, 507.

Primary key `(snapshot_id,from_path,to_path)` chỉ cho một record khi trang A liên kết cả `B.md#heading-one` và `B.md#heading-two`, trong khi mỗi record chỉ có một fragment/status. Insert trực tiếp sẽ conflict, hoặc upsert/dedup bỏ mất một kết quả audit (ví dụ một anchor đúng và một anchor thiếu). Chốt định danh link có fragment/original href hoặc vị trí occurrence; test nhiều fragment cùng đích, kể cả link lặp hoàn toàn. Giữ audit đủ nguồn cho từng liên kết.

## Những hợp đồng đã đạt trong snapshot

- Mutation dùng transaction và khóa global cursor trước business rows, tránh mất event khi commit ngược thứ tự; rollback/restart/concurrency có test có barrier.
- Replay machine token dùng codec AES-GCM, actor/route/key AAD và authentication trước replay; không lấy token v1 hoặc plaintext DB.
- Attempt fencing và partial unique active/uncertain ngăn quyền thứ hai; heartbeat/lease hết hạn không tự chứng minh process chết. Giới hạn machine attestation và host reconcile thật phase 03 được ghi rõ.
- Dispatch mặc định fail-closed; không nhận test bypass từ request. Phase 03 host, phase 04 runtime/pool, phase 06 dispatch gates và phase 08 trusted merge/docs verifier không bị claim là đã triển khai.
- DB/package v2 riêng, import checksum/byte bất biến, imported docs không được tự verified, không mutate production/v1.

Sau khi tác giả sửa, chỉ cần review lại các hợp đồng bị thay đổi và test yêu cầu tương ứng; không cần xin owner duyệt lại kế hoạch trong phạm vi đã ủy quyền.
