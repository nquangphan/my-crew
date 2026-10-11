# Review phía fork: ghép máy tự động (crew/pair-wb)

Ngày: 2026-10-11 (Asia/Ho_Chi_Minh). Phạm vi: `ba7a7ef56` (plugin), `bced277b1` (web). Bỏ qua `1f8c3f7a7`.
Đã chạy: `webhook.test.ts` + `machines.test.ts` (29 pass), `machine-pairing.db.test.ts` (16 pass),
`migration-0014.db.test.ts` (1 pass), chạy lần lượt từng file. Không còn process nào sót lại.

## Kết luận nhanh theo 5 điểm

1. Webhook: đạt ở mức mã. Máy đã gỡ bị chặn (`machine_revoked`). Máy đã ghép không lùi về được secret company
   (`webhook.ts:97-100`). Key của máy A ký cho `machineId` B thì trượt HMAC. Đổi hoa/thường `machineId` cũng không lách được
   vì cột là `uuid` (Postgres tự chuẩn hóa) và `deriveMachineKey` hạ chữ thường. Máy chưa ghép vẫn dùng secret company như cũ,
   chỉ thêm một truy vấn. Lỗ hổng thật nằm ở chỗ thu hồi không bền (I1).
2. Key và nonce: đạt. Key chỉ có trong body 200 của `pair`. Log chỉ ghi id. `loadCrewMachines` không select `key_nonce`.
   Ngoại lệ nhỏ: M1.
3. Route: đạt với agent (`pairing.ts:168` trả 403 khi `actorType !== "user"`). Board member không phải owner vẫn gọi được cả
   `pair` lẫn `unpair`. Spec chấp nhận điều này (§2 dòng 24), nhưng rủi ro thật lớn hơn spec mô tả, xem I2.
4. Gỡ máy: đạt. `environments.archive` gọi `environments.update` với `{status:'archived'}`, không có DELETE. Nút chỉ hiện khi
   `isOwner` (`pairing-block.tsx:46`). Thứ tự là archive trước, unpair sau, cả hai bước idempotent.
5. Migration 0014: đạt. Chỉ `CREATE TABLE` mới, không đụng dữ liệu cũ. Khóa chính `(company_id, machine_id)` phủ đúng truy vấn
   của webhook. Schema dùng hằng `plugin_crew_core_0433ea20b6`, khớp các migration trước.

## Critical

Không có.

## Important

### I1. Thu hồi không bền: máy đã gỡ tự ghép lại được
- `packages/crew-plugin/src/machines/pairing.ts:104-110`: upsert của `pair` đặt `revoked_at = NULL` mà không điều kiện gì.
- Kịch bản: owner bấm Gỡ máy MacBook. Webhook của MacBook từ đó lỗi `machine_revoked`, host trả 502. Theo spec §6 bước 3, app
  trên máy "bị 401/502 thì ghép", và nó vẫn giữ board key của owner trong Keychain (spec §8 dòng 199). Lần sau chạy bước Máy,
  app gọi `machines.pair`, nhận key mới, và máy hoạt động lại. Environment vẫn ở trạng thái archived, nhưng key webhook thì sống.
  Muốn chặn một máy thật sự thì phải thu hồi thêm board key của nó, và hiện chưa ghi điều này ở đâu.
- Cách sửa (chọn một):
  - Trong `pair`: nếu dòng đã có `revoked_at IS NOT NULL` thì trả `409 "Máy đã bị gỡ, owner phải cho phép ghép lại"`. Chỉ ghép
    lại khi body có cờ rõ ràng (ví dụ `reallow: true`) do web gửi khi owner bấm.
  - Hoặc tối thiểu: ghi vào runbook và vào hộp xác nhận Gỡ máy rằng muốn chặn hẳn thì phải thu hồi board key của máy đó. Thêm
    test DB "pair sau unpair" để hành vi đang chọn hiện rõ.

### I2. Mọi board member đều có thể đúc key ký cho bất kỳ `machineId` nào
- `packages/crew-plugin/src/machines/pairing.ts:93-127` và manifest `auth: "board"`: route không kiểm owner, cũng không kiểm
  `machineId` đã thuộc về ai.
- Kịch bản A (giả mạo): một member không phải owner gọi `pair` với `machineId` của máy đã ghép. Nonce mới làm key thật của máy
  đó chết, còn người gọi nhận key hợp lệ. Từ đây họ gửi được `machine-status` và `docs-snapshot` giả dưới tên máy đó, kể cả
  `auditState`/`checkExit` của docs. Trước tính năng này, chỉ người giữ secret company mới ký được.
- Kịch bản B (làm sập Mac mini): `pair` với `machineId` của Mac mini (máy chưa ghép) tạo ra một dòng ghép. Từ đó mọi bản tin ký
  bằng secret company của Mac mini đều trượt `bad_signature`, vi phạm AC6. Ngoài ra, `unpair` cũng gỡ được máy mà không cần là
  owner.
- Có quan trọng không: có, nếu company có member không phải owner mà không được tin ngang owner. Nếu company chỉ có owner thì
  rủi ro này bằng 0.
- Cách sửa: plugin không đọc được `company_memberships`, nên làm hai việc. (a) Trong `pair`: từ chối khi `machine_latest` đã có
  `machineId` này mà chưa có dòng ghép, tức là máy đang dùng secret company. Việc này chặn kịch bản B và khớp luật "máy có sẵn
  đạt test thì không ghép" của app. (b) Ghi rõ trong spec §8 rằng mọi board member đều ghép/gỡ được và đúc được key máy. Khi
  host có cách kiểm owner thì chuyển sang kiểm owner.

## Minor

### M1. Hai lần `pair` đồng thời trả cùng một key cho hai người gọi
- `pairing.ts:113-123`: bước đọc lại khiến cả hai response mang nonce của lần ghi sau, nên một key được trả ra hai lần. Hệ quả
  thấp vì cả hai đều là board user, nhưng nó trái với bất biến "key chỉ trả một lần".
- Cách sửa: `INSERT ... ON CONFLICT ... RETURNING key_nonce, paired_at` trong một câu lệnh rồi dẫn xuất key từ chính nonce đó.
  Như vậy bỏ được bước SELECT và không còn race.

### M2. Bảng ghép lỗi thì làm sập cả máy chưa ghép
- `packages/crew-plugin/src/shared/webhook.ts:89-96`: mọi bản tin có `machineId` dạng UUID đều truy vấn `machine_pairings`.
  Truy vấn lỗi (bảng chưa migrate khi rollout lệch, hoặc DB chập chờn) thì trả `pairing_unavailable`, kể cả với Mac mini.
  Trước thay đổi này, xác thực không cần DB.
- Cách sửa: chấp nhận được nếu migration luôn chạy trước worker. Ghi điều này vào bước deploy. Không nên fail-open.

### M3. `environmentId` của `pair` không được đối chiếu với host
- `pairing.ts:57`: chỉ kiểm định dạng UUID. Nếu app gửi nhầm `environmentId` (ví dụ của Mac mini, xem spec §6.4) thì Gỡ máy sẽ
  archive environment của Mac mini.
- Cách sửa: nếu plugin đọc được bảng environments của lõi thì kiểm environment thuộc company và có `host = tailscaleIp`. Nếu
  không đọc được thì để web hiện tên/host của environment trong hộp xác nhận Gỡ máy trước khi archive.

## Đề xuất theo thứ tự

1. I1: chặn tự ghép lại sau khi gỡ, hoặc ít nhất ghi rõ là phải thu hồi board key.
2. I2(a): cấm `pair` lên máy đang dùng secret company. I2(b): cập nhật spec §8.
3. M1: dùng `RETURNING`.
4. M2, M3: ghi vào runbook, hoặc kiểm environment nếu khả thi.

Status: DONE
Summary: Ở mức mã, webhook chặn đúng máy đã gỡ, chặn lùi về secret company và chặn giả mạo chéo `machineId`. Key và nonce không bị lộ, migration an toàn, Gỡ máy dùng archive và chỉ owner thấy nút. Còn 2 điểm Important: thu hồi không bền vì `pair` xóa `revoked_at`, và mọi board member đều đúc được key hoặc làm sập Mac mini.
