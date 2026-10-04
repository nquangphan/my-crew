## Review P-G4w (4998044)

### Spec Compliance
- ✅ Không thêm authority thứ hai: ba switch đã có ở `model_source_configs` (008, `enabled` jsonb đúng 3 khóa boolean, CAS revision); worker chỉ thêm hàm đọc `isSourceEnabled` + `runtime` tùy chọn cho retry. Đúng quyết định PM.
- ✅ Mapping runtime<->source đúng: khóa jsonb `claude|codex|api` trùng enum `runtimes` và `retrySchema.runtime`; `enabled->>runtime` giống điều kiện pool SQL (`mc.enabled->>pr.runtime='true'`). Tham số runtime được bind, không nối chuỗi.
- ✅ Retry không truyền runtime giữ đúng hành vi cũ (`!config.enabled` -> CONFIG_DISABLED); thứ tự kiểm không đổi; test có assert 200.
- ✅ Không đổi body_hash/same()/pin/install-report; `runtime` chỉ là điều kiện trước, không vào payload command. Không migration.
- ✅ "OFF không hủy attempt đã admitted": hàm chỉ đọc, chưa nối admission, không ghi/hủy gì; retry OFF chỉ không xếp command.
- ⚠️ `isSourceEnabled` chưa được admission gọi (khai báo là việc của T4); hiện chỉ test và retry dùng.

### Về câu hỏi nhất quán
- Không có "hai bước đọc": là MỘT câu SELECT (gateway_configs LEFT JOIN model_source_configs) nên cho snapshot nhất quán trong một statement, không cần lock. Trong retry, đọc config và đọc source là hai statement, nhưng ghi model-sources dùng cùng `authorizeGatewayMutation` (khóa `machines for update`) nên bị tuần tự hóa với retry; không có TOCTOU thực tế. Gọi từ admission nên nằm trong tx đã khóa tương tự.

### Security
- Quyền không nới: route vẫn requireOwner + CSRF + mutator idempotency; `runtime` được enum-validate (test 400 với `gpt`). Chỉ có thể làm retry chặt hơn, không lỏng hơn. Không rò dữ liệu mới (lỗi cố định CONFIG_DISABLED).

### Strengths
- Tránh nhân đôi nguồn sự thật; hàm đọc thuần, nhỏ; test cover cả suy từ cờ máy, từng switch, master thắng.

### Issues
**Critical:** không. **Important:** không.

**Minor**
- M1 service.ts `isSourceEnabled`: "máy chưa có source config -> suy true từ cờ máy" nới hơn guard SQL 008 (join `model_source_configs` bắt buộc có hàng nên admission pool vẫn bị từ chối khi chưa có source config). Nếu T4 dùng hàm này làm cổng chính, nó cho "true" ở chỗ trigger sau đó vẫn từ chối -> thông báo/UX lệch. Không nguy hiểm vì trigger là chốt cuối; nên ghi rõ trong T4 hoặc để hàm trả false khi không có hàng nếu admission dùng nó như điều kiện đủ.
- M2 service.ts requestWorkflowRetry: `runtime` chỉ là điều kiện chặn; command `sync_workflows` vẫn đồng bộ mọi runtime, nên không có nghĩa "retry riêng runtime đó". Docs hơi dễ hiểu nhầm; nên nói rõ là "chặn khi nguồn OFF", không phải "giới hạn phạm vi cài".
- M3 `isSourceEnabled`: `if (!runtimes.includes(runtime)) return false` là phòng thủ thừa với kiểu `Runtime` (đã validate ở route); vô hại.
- M4 report: mục "Hash" rỗng, hash liệt kê "tính trước commit" nên không đối chiếu được với diff; chỉ là tài liệu.

### Assessment
**Task quality:** Approved.
