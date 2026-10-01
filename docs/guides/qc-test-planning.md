# Chọn phương án kiểm thử cho QC

Đọc trước [Quy trình ticket](workflow.md) nếu chưa quen luồng dev → docs → QC. Trang này dành cho PM (khi phân
tích ticket và tạo subtask `qc`) và cho chủ dự án (khi một QC bị kẹt vì công cụ kiểm thử).

## 1. Vì sao có trang này

Trước đây mọi ticket `qc` bị gắn cứng MCP kiểm thử UI (Playwright/Maestro) theo `platform` của dự án, bất kể
subtask dev đi kèm có đổi giao diện hay không. Hệ quả: QC của một ticket chỉ sửa API, logic daemon, CLI hay docs
vẫn mang MCP kiểm thử UI bắt buộc, rồi bị chặn khi MCP đó chưa kết nối trên máy hoặc chưa được gọi công cụ nào —
dù bản thân việc kiểm thử không cần trình duyệt hay simulator.

Nay PM phân tích từng subtask `qc` để chọn **phương án kiểm thử** (`testKinds` + `testReason`) thay vì nhận một
phương án mặc định theo dự án. Chỉ phương án có loại kiểm thử giao diện (`ui_web`/`ui_mobile`) mới kéo theo MCP
bắt buộc. Trang này giúp PM chọn đúng phương án và giúp chủ dự án hiểu vì sao một QC bị chặn hoặc không đóng
được.

## 2. Bảng loại kiểm thử ↔ công cụ

Nguồn sự thật duy nhất là `TEST_KIND_INFO` trong
[`packages/shared/src/project-schemas.ts`](../../packages/shared/src/project-schemas.ts) — không có loại nào
ngoài bảng dưới đây, và không tự thêm loại mới ở đây khi code đổi mà không sửa bảng này theo.

| `testKinds` | Nhãn | Khi nào dùng | Công cụ / lệnh | MCP bắt buộc |
|---|---|---|---|---|
| `static_review` | Xem code tĩnh | Chỉ review diff code, không cần chạy chương trình | Đọc code, diff review | Không |
| `unit` | Unit test | Kiểm một hàm/module riêng lẻ | Test hàm/module riêng lẻ (vitest, jest, pytest, …) | Không |
| `integration` | Integration test | Kiểm nhiều thành phần phối hợp, không qua giao diện | API + DB, service + service, … | Không |
| `api` | Kiểm thử API | Gọi trực tiếp endpoint/service | Gọi API (script, curl, Postman, supertest, …) | Không |
| `ui_web` | Kiểm thử giao diện web | Thao tác trên trang web; **phải có giao diện chạy được** | Trình duyệt tự động qua MCP Playwright | Có — Playwright |
| `ui_mobile` | Kiểm thử giao diện mobile | Thao tác trên màn hình mobile; **phải có giao diện chạy được** | Thiết bị/simulator qua MCP Maestro | Có — Maestro |

**Platform nào chạy được loại UI nào** (nguồn: `isTestKindSupported` cùng file trên):

| `testKinds` | `platform` của dự án được chọn |
|---|---|
| `ui_web` | `web`, `web_mobile` |
| `ui_mobile` | `mobile`, `web_mobile` |

Chọn `ui_web`/`ui_mobile` mà `platform` của dự án không nằm trong danh sách trên bị server từ chối ngay khi tạo
hoặc đổi phương án (`platform '<platform>' của dự án không hỗ trợ loại kiểm thử: …`).

## 3. Checklist cho PM trước khi tạo subtask QC

Trước mỗi `create_subtask` loại `qc` (ngay sau khi tạo subtask `dev` đi kèm):

1. **Xem subtask dev đổi gì**: route/service/DB của API, logic daemon, CLI, schema dùng chung
   (`packages/shared`), giao diện web, màn hình mobile, hay chỉ docs.
2. **Chọn `testKinds`** (một hoặc nhiều loại) theo bảng ở mục 2, khớp với những gì dev đổi.
3. **Luật chọn loại UI**:
   - Chỉ chọn `ui_web`/`ui_mobile` khi thay đổi có **giao diện chạy được** và **tiêu chí nghiệm thu cần thao
     tác trên giao diện đó**.
   - Thay đổi chỉ ở API, logic, CLI, schema hay docs → không chọn loại UI.
   - Thay đổi có giao diện → **phải** có loại UI tương ứng (giao diện web → `ui_web`, màn hình mobile →
     `ui_mobile`), có thể kèm loại khác.
   - Không chọn loại UI mà `platform` của dự án không hỗ trợ (xem bảng platform ở mục 2).
4. **Viết `testReason`**: một dòng lý do cho phương án, nêu rõ vì sao cần hoặc không cần công cụ UI.
5. **Chấm `complexity` của QC riêng theo công kiểm thử thật** của chính nó — không chép mức của dev: số loại
   trong `testKinds`, có loại UI hay không, số endpoint/flow phải kiểm, số tiêu chí nghiệm thu, độ nhạy cảm
   bảo mật. Một dev `small` có thể cần QC `medium` (nhiều flow phải kiểm) và ngược lại.

Công cụ `create_subtask` từ chối tạo subtask `qc` nếu thiếu `testKinds` hoặc `testReason` (hai trường bắt buộc
đi cùng nhau), và từ chối nếu subtask `dev` lại mang một trong hai trường này — phương án kiểm thử chỉ thuộc về
subtask `qc`.

## 4. Mẫu mục "Phương án kiểm thử"

Mô tả (`description`) của mỗi subtask `qc` bắt buộc có mục này, đủ bốn dòng:

```markdown
## Phương án kiểm thử

- Loại kiểm thử: <các loại trong testKinds, cách nhau bằng ", ">
- Công cụ / lệnh: <lệnh test, script gọi endpoint, flow trên giao diện, …>
- Công cụ UI: <cần MCP nào và vì sao | không cần, vì sao>
- Tiêu chí nghiệm thu ↔ cách kiểm: <1. tiêu chí 1 → cách kiểm 1; 2. tiêu chí 2 → cách kiểm 2; …>
```

**Ví dụ 1 — ticket dev sửa endpoint API (không cần công cụ UI):**

```markdown
## Phương án kiểm thử

- Loại kiểm thử: api, unit
- Công cụ / lệnh: `pnpm --filter @crew/api test` và `curl -X POST http://localhost:8787/v1/…`
- Công cụ UI: Không cần, thay đổi chỉ là endpoint mới và DB migration, không có giao diện
- Tiêu chí nghiệm thu ↔ cách kiểm:
  1. Endpoint trả đúng response theo spec → gọi curl hoặc supertest
  2. Validation input đúng → gọi endpoint với dữ liệu sai
  3. Cơ sở dữ liệu cập nhật đúng → query DB sau khi gọi endpoint
```

**Ví dụ 2 — ticket dev sửa trang web (cần Playwright):**

```markdown
## Phương án kiểm thử

- Loại kiểm thử: ui_web, integration
- Công cụ / lệnh: `pnpm --filter @crew/web test:e2e` (Playwright) và `pnpm --filter @crew/web test`
- Công cụ UI: Cần Playwright (MCP bắt buộc), thay đổi có thêm form và flow mới trên web
- Tiêu chí nghiệm thu ↔ cách kiểm:
  1. Form nhập/gửi đúng dữ liệu → Playwright điền form, submit và kiểm response
  2. Thông báo lỗi validation hiện đúng → Playwright submit với dữ liệu sai
  3. Danh sách được filter đúng → Playwright chọn filter và kiểm kết quả
  4. API được gọi với tham số đúng → kiểm request qua developer tools hoặc supertest
```

## 5. Hệ thống kiểm soát thế nào

- **`testKinds`/`testReason` bắt buộc khi tạo `qc`**: công cụ `create_subtask` từ chối nếu thiếu một trong hai
  (mục 3); công cụ `plan_qc_test` (đổi phương án của một QC chưa đóng) cũng bắt buộc cả hai.
- **MCP UI suy ra từ `testKinds`, không phải từ `platform` nữa**: `testKinds` có `ui_web` → thêm MCP Playwright
  vào `requiredMcps`; có `ui_mobile` → thêm MCP Maestro; không có loại UI nào → không thêm MCP kiểm thử UI nào.
- **Hai cổng kiểm soát chỉ áp dụng khi phương án có loại UI** (`ui_web`/`ui_mobile`, tức khi ticket mang MCP
  kiểm thử UI bắt buộc):
  1. QC bị chặn (`blocked`) ngay khi MCP kiểm thử UI bắt buộc chưa kết nối trên máy; daemon bình luận nhắc chủ
     dự án sửa kết nối hoặc gắn thẻ `@pm` nếu thay đổi thật ra không có giao diện.
  2. QC không đóng được ticket (không qua được `submit_report`) khi MCP đó chưa từng được gọi công cụ nào trong
     lượt chạy.
- **Ngoại lệ diff chỉ đổi docs**: nếu diff của ticket dev đi kèm chỉ đổi `docs/**` hay Markdown ở gốc repo, QC
  không bị hai cổng trên chặn dù có loại UI trong phương án và không chạy test UI; report của QC ghi đúng câu
  "Không có thay đổi giao diện (chỉ docs) nên không chạy test UI."
- **QC retest kế thừa phương án**: khi QC báo lỗi hoặc PM từ chối, ticket `bug` mới kế thừa cấu hình của
  dev/QC gốc, và ticket `qc` retest kế thừa `testKinds`/`testReason` của QC đang kiểm — PM không cần lập lại
  phương án cho vòng retest.

## 6. Gỡ một QC đang kẹt vì công cụ không hợp

Kịch bản: QC bị chặn vì MCP kiểm thử UI bắt buộc chưa kết nối (hoặc chưa được gọi), nhưng thay đổi của ticket
dev đi kèm thật ra không có giao diện — phương án kiểm thử chọn nhầm loại UI.

- **Cách gỡ qua PM**: chủ dự án gắn thẻ `@pm` trên ticket QC đang kẹt → PM nhận lời gọi ở bước theo dõi
  (`pm_monitor`), dùng `plan_qc_test` đổi `testKinds` sang các loại không có UI (kèm `testReason` mới), rồi gọi
  `retry_subtask` ngay trong cùng lượt chạy để mở lại ticket — `retry_subtask` chỉ dùng được khi đang trả lời
  đúng lời gọi `@pm` đó, không dùng tùy ý. QC chạy lại với phương án và `requiredMcps` mới.
- **Cách gỡ qua web**: chủ dự án tự mở chặn ticket trên web sau khi PM đã đổi phương án bằng `plan_qc_test`
  (không cần gắn `@pm` lần thứ hai).
- Thay đổi có giao diện thật (không phải chọn nhầm): giữ nguyên phương án, chủ dự án cần sửa kết nối MCP kiểm
  thử UI (2P Crew → Sức khỏe, hoặc `crewd doctor`) rồi mở chặn.
- **Ticket QC cũ** (tạo trước khi có `testKinds`, tức `testKinds` là `null`): giữ hành vi cũ — vẫn cộng thêm MCP
  kiểm thử UI mặc định theo `platform` của dự án, không áp hai cổng theo phương án ở mục 5. Khi PM dùng
  `plan_qc_test` để điền phương án lần đầu cho một QC như vậy, hệ thống tính lại `requiredMcps` theo phương án
  mới thay vì theo `platform`.

## 7. Lý do ticket QC từng kẹt (phân tích hiện trạng)

- **Server tự gắn MCP UI cho mọi QC**: trước đây mỗi ticket `qc` luôn được cộng MCP kiểm thử UI
  (Playwright/Maestro) theo `platform` của dự án vào `requiredMcps`, bất kể subtask dev đi kèm có đổi giao diện
  hay không.
- **Daemon chặn khi MCP chưa kết nối**: khi một MCP bắt buộc của ticket chưa kết nối trên máy, daemon không cho
  QC chạy — ticket chuyển `blocked` ngay từ đầu lượt.
- **Daemon không cho đóng khi MCP đã kết nối nhưng chưa được gọi**: ngay cả khi MCP đã kết nối, daemon cũng
  không cho QC hoàn tất `submit_report` nếu MCP đó chưa được gọi công cụ nào trong lượt chạy — QC phải thật sự
  dùng công cụ kiểm thử UI, không chỉ khai đã dùng.
- **Maestro cần simulator/emulator đang chạy**: MCP Maestro cần máy có simulator iOS/Android hoặc thiết bị thật
  kết nối sẵn, khó cấu hình trên mọi máy — dự án chỉ có QC về API hay daemon vẫn bị kẹt vì Maestro không sẵn
  sàng.

Kết quả: một ticket QC chỉ sửa API từng bị chặn vì server tự gắn Playwright dù không cần kiểm thử giao diện. Nay
PM chọn phương án cho từng QC (mục 3), nên chỉ `testKinds` nào thật sự cần UI mới kéo theo MCP tương ứng.

## Đọc thêm

- [Quy trình ticket](workflow.md) — vai trò PM/dev/QC, `testKinds`/`testReason` trong bức tranh chung.
- [Vai trò agent và quy trình ticket](../flows/agent-roles.md) — chi tiết `create_subtask`, `plan_qc_test`,
  `retry_subtask` và cổng MCP theo từng bước agent.
- [`packages/shared/src/project-schemas.ts`](../../packages/shared/src/project-schemas.ts) — `TEST_KIND_INFO`,
  `isTestKindSupported`, `uiMcpsForTestKinds`.
