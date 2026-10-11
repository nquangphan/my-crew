# Trang Hướng dẫn theo vai trò, có ảnh chụp thật — Báo cáo

Ngày 11/10/2026 (Asia/Ho_Chi_Minh). Worktree `~/Documents/projects/crew/.worktrees/paperclip-issues-ui`, nhánh
`crew/guide-roles` (đã rebase lên `crew/v3.5`). Commit `505ccbc85` (trang Hướng dẫn) và `3f32ef0d6` (chụp lại trên
company mẫu). Chưa push.

## Kết quả

Trang Hướng dẫn đã viết lại xong. Mỗi người chỉ thấy phần của vai trò mình. Owner xem thử bản của vai trò khác bằng ô
"Xem hướng dẫn của" (`?role=`). Mọi mục việc có ảnh chụp thật từ T1, theo từng vai trò và từng ngôn ngữ (vi, en), có khung
đỏ đánh số khớp với số trong bài. Có một spec chụp lại toàn bộ ảnh bằng một lệnh.

## Lượt 2: chụp lại trên company mẫu sạch

Controller thấy ảnh lượt 1 còn dữ liệu e2e của T1 (tiêu đề `PW-S…`, "E2E T1 project", mọi máy "Mất liên lạc", Docs trống),
nên em làm lại:

- **Company mẫu "2P Demo"** (prefix `PDE`) trên T1, dựng bằng `e2e/support/guide-company.ts`. Spec `guide-shots` gọi file
  này đầu mỗi lượt. Dữ liệu tìm theo tên trước khi tạo, nên chạy lại không sinh bản trùng. Gồm:
  - hai project "Website bán hàng" (2 executor) và "Ứng dụng giao hàng" (1 executor), cả hai **Sẵn sàng**. Agent Claude
    đúng cấu hình Crew, `AGENTS.md` theo template, environment SSH `in_place`, vai trò ghi qua route plugin. Agent đặt
    `wakeOnDemand: false` nên không bao giờ chạy;
  - 11 yêu cầu gốc và 6 yêu cầu con ở đủ trạng thái (cần làm, đang làm, đang duyệt, bị chặn, xong, hủy, tồn đọng), có
    bình luận. Một yêu cầu chờ owner duyệt, một yêu cầu nghiên cứu ở bước Reviewer;
  - góp ý Phòng Marketing: một yêu cầu và một bình luận chờ duyệt, một yêu cầu bị từ chối;
  - hai máy `mac-mini-van-phong` và `macbook-pro-giang`, ghép bằng route ghép máy. Mỗi lượt xoay key máy rồi gửi bản tin
    ký bằng key đó, nên cả hai **Trực tuyến** và có nhãn "Đã ghép";
  - Docs của Website bán hàng có 4 trang (ảnh chụp docs gửi bằng webhook ký key máy).
- **Thành viên theo vai trò** vào company qua luồng mời thật (`e2e/support/guide-users.ts`). Owner là tài khoản board, tên
  hiển thị đặt thành "Nguyễn Quang". Admin/Vận hành là "Trần Minh", Chỉ xem là "Lê Lan", Phòng Marketing là tài khoản
  khách góp ý có sẵn của T1. Lời mời nào không dùng được thì bị thu hồi.
- **Nút giao diện gốc chỉ owner thấy** (sau rebase, có fix `17cb320c8`). Mục `#stock-ui` giờ chỉ có trong bản owner. Ảnh
  thanh bên của operator, viewer và Phòng Marketing không còn mục đó. Test thêm `stock-ui` vào danh sách "chỉ owner".
- **Bỏ câu nói về màn hình trống** của dữ liệu thử (Yêu cầu mới không có project sẵn sàng, Docs trống).
- **Ảnh giữ khung đánh số.** Docs giờ mở trang "Phí vận chuyển". Hộp thoại Yêu cầu mới đã chọn project và điền sẵn yêu
  cầu mẫu.
- **Cách chạy lại** ghi trong `e2e/README.md`, mục "Ảnh trang Hướng dẫn":
  `CREW_E2E_T1_ENV=~/crew-ga-t1/board.env CREW_GUIDE_POLICY_FILE=~/crew-ga-t1/crew-policy.json pnpm --filter @crew/paperclip-web guide:shots`.

Giới hạn còn lại:

- **Không có bước Reviewer hay Integrator thật.** Agent ghi bình luận hay duyệt một bước đều cần một heartbeat run thật
  (lõi đòi `X-Paperclip-Run-Id`). Agent mẫu không chạy, và trên T1, run của agent giữ chỗ làm hỏng worker plugin. Vì vậy:
  - bình luận mẫu là của owner;
  - yêu cầu chờ duyệt dùng policy chỉ có bước duyệt của owner. Ảnh vẫn có nút Duyệt, Yêu cầu sửa, Hủy yêu cầu, Ép Done và
    dòng "Owner duyệt: Bạn (đang ở đây)", nhưng yêu cầu này không có dòng Tóm tắt Crew;
  - phần lớn yêu cầu gốc hiện "Chưa có giai đoạn", đúng với việc chưa tới bước duyệt.
- **Dashboard ghi "Chưa có run nào gần đây"**, vì agent mẫu không chạy.
- **Email `@crew-e2e.local`** của owner và Phòng Marketing chỉ hiện ở trang Thành viên.
- **File chính sách của T1 đã đổi.** `~/crew-ga-t1/crew-policy.json` có thêm một dòng cho 2P Demo, vì route góp ý chỉ chạy
  cho company có trong file này. Dòng của company e2e giữ nguyên. Bản sao trước khi đổi ở thư mục scratch của phiên.
- **Có một yêu cầu xong ngoài kịch bản.** Lần dựng đầu bị dở, em sửa tay thành yêu cầu đã xong "Thêm nút in hóa đơn ở
  trang đơn hàng" (PDE-1 đến PDE-3).

## Cách tổ chức (theo docs.paperclip.ing)

Em đã đọc trang Projects và Issues của docs.paperclip.ing bằng WebFetch. Trang Members trả 404. Cách tổ chức em lấy theo:

- Thanh bên chia nhóm theo chủ đề. Mỗi trang (H2) chia thành các mục H3 theo việc.
- Mỗi mục có đoạn mở đầu ngắn, các bước đánh số, bảng so sánh, rồi `> **Tip:**`.
- Ảnh đặt ngay sau đoạn mở đầu, có chú thích.

Ở Crew:

- Mục lục dính bên trái, chia 7 nhóm. Mỗi mục có cấu trúc "là gì → Cách làm → Mẹo".
- Mỗi nhóm và mỗi mục có neo `#id` (id tiếng Anh, giống nhau ở vi và en). Mở `/CRE/guide#pair-machine` là cuộn tới đúng mục.

## Thiết kế

- **Một file markdown cho mỗi ngôn ngữ.** Vai trò gắn trong file:
  - `### Tiêu đề {#id roles=owner,operator}` cho cả mục;
  - `{{roles:…}} … {{/roles}}` cho từng đoạn.

  Hai ngôn ngữ không bị lệch vì có test so cấu trúc vi/en.
- **Bốn bản hướng dẫn:**
  - `owner`;
  - `operator`, dùng chung cho Admin và Vận hành;
  - `viewer`;
  - `contributor` (Phòng Marketing).

  Vai trò lấy từ `useCompanyAccess`. Hook có thêm trường `membershipRole`; các trường cũ không đổi.
- **Bản mặc định khi không rõ vai trò.** Nếu lỗi tải vai trò, hoặc là admin instance không có membership, trang hiện bản việc
  hằng ngày. Lý do: UI không khóa nút ghi trong trường hợp đó.
- **Widget mới trong ds:** `src/ds/widgets/doc-layout.tsx`, gồm `DocLayout`, `DocNav`, `DocGroup`, `DocSection`,
  `DocFigure`. Ngoài `src/ds` chỉ dùng class bố cục, nên guard design-system vẫn đạt.
- **Đường dẫn ảnh:** `src/features/guide/img/<lang>/<id>[.<vai trò>].webp`. Danh sách ảnh và quy tắc tên nằm trong
  `src/features/guide/shots.ts` (`shotFiles`).

## Các mục và ảnh

Ảnh có ở cả `img/vi/` và `img/en/`. Ảnh nào có hậu tố vai trò thì có một bản cho mỗi vai trò.

| Nhóm | Mục (`#id`, vai trò thấy) | Ảnh |
|---|---|---|
| Bắt đầu | `#what-is-crew` 2P Crew là gì (mọi vai trò) | Không có (mục khái niệm, có bảng thành phần và bảng vai trò) |
| | `#sign-in` Đăng nhập, ngôn ngữ, đăng xuất (mọi vai trò) | `login.webp` |
| | `#layout` Màn hình chính và thanh bên (mọi vai trò) | `shell.{owner,operator,viewer,contributor}.webp` |
| | `#quick-search` Tìm nhanh (mọi vai trò) | `palette.webp` |
| Làm việc hằng ngày | `#dashboard` Tổng quan (mọi vai trò) | `dashboard.{owner,operator,viewer,contributor}.webp` |
| | `#issue-list` Danh sách Yêu cầu (mọi vai trò) | `issues-list.{4 vai trò}.webp`, `issues-filter.webp`, `issues-columns.webp` |
| | `#issue-popup` Cửa sổ chi tiết yêu cầu (mọi vai trò) | `issue-popup.{4 vai trò}.webp` |
| | `#new-request` Giao một yêu cầu mới (owner, operator) | `new-request.webp` |
| | `#approve` Duyệt, yêu cầu sửa, hủy, mở lại (owner) | `issue-gate.webp` |
| | `#force-done` Ép Done (owner) | `force-done.webp` |
| | `#inbox` Hộp thư (owner, operator) | `inbox.webp` |
| | `#runtimes` Runtime: Claude, Codex, OpenCode (owner, operator) | `machines.{owner,operator}.webp` |
| Phòng Marketing | `#marketing-overview` Phòng Marketing là gì (owner, contributor) | `contributions-owner.webp` (owner), `contributions-mine.webp` (contributor) |
| | `#send-request` Gửi yêu cầu để owner duyệt (contributor) | `contribution-new.webp` |
| | `#send-comment` Bình luận góp ý (contributor) | `contribution-comment.webp` |
| | `#my-contributions` Theo dõi Góp ý của tôi (contributor) | `contributions-mine.webp` |
| | `#review-contributions` Duyệt hoặc từ chối góp ý (owner) | `contributions-owner.webp`, `contribution-approve.webp` |
| Project và agent | `#projects` Project (owner, operator, viewer) | `projects.{owner,viewer}.webp`, `project-roles.{owner,viewer}.webp` (operator dùng bản owner) |
| | `#add-project` Thêm project (owner) | `add-project.webp` |
| | `#agents` Agent (owner, operator) | `agents.webp`, `agent-detail.webp` |
| | `#add-agent` Tạo agent (owner) | `add-agent.webp` |
| | `#remove` Gỡ project và gỡ agent (owner) | `project-roles.owner.webp`, `agent-detail.webp` |
| | `#skills` Skills (owner, operator) | `skills.webp` |
| | `#docs` Docs (mọi vai trò) | `docs.webp` |
| Máy | `#machines` Trang Máy (owner, operator) | `machines.{owner,operator}.webp` |
| | `#pair-machine` Ghép máy bằng app 2P Crew (owner) | `mac-pairing.svg` (sơ đồ, có nhãn "không phải ảnh chụp app") |
| | `#unpair-machine` Gỡ máy và ghép lại (owner) | `machine-unpair.webp` |
| Hệ thống | `#members` Thành viên (owner) | `members.webp` |
| | `#settings` Cài đặt (mọi vai trò) | `settings.webp` |
| | `#stock-ui` Giao diện Paperclip gốc `/paperclip/` (chỉ owner) | `stock-ui.webp` |
| Tra cứu | `#missing-buttons` Vì sao không có nút X (trừ contributor) | Bảng tính năng không có |
| | `#crew-lines`, `#troubleshooting`, `#glossary` | Bảng tra cứu |

Tổng cộng có 45 ảnh WebP và 1 sơ đồ SVG cho mỗi ngôn ngữ, khung nhìn 1280×800. Mỗi ảnh nặng 9 đến 60 KB. Thư mục `vi` nặng
1,7 MB và `en` nặng 1,6 MB. Test chặn ảnh nào vượt 150 KB hoặc tổng vượt 6 MB.

Ảnh mẫu để xem nhanh (dưới
`~/Documents/projects/crew/.worktrees/paperclip-issues-ui/packages/crew-web/src/features/guide/img/`):

- `vi/shell.owner.webp`: thanh bên của owner, đánh số 1 đến 5.
- `vi/issues-list.owner.webp`: thanh công cụ danh sách kiểu Paperclip, đánh số 1 đến 7.
- `vi/machines.owner.webp`: thẻ máy có "Đã ghép", nút "Gỡ máy" và khối Runtime.
- `en/contribution-comment.webp`: bình luận của Phòng Marketing đang chờ duyệt, có nhãn Pending.
- `en/new-request.webp`: hộp thoại Yêu cầu mới, đánh số 1 đến 6.
- `vi/mac-pairing.svg`: sơ đồ wizard của app Mac.

## Chụp lại ảnh

```sh
CREW_E2E_T1_ENV=~/crew-ga-t1/board.env pnpm --filter @crew/paperclip-web guide:shots
# chỉ chụp lại một vài ảnh:
CREW_GUIDE_SHOTS_ONLY=machines,inbox CREW_E2E_T1_ENV=~/crew-ga-t1/board.env pnpm --filter @crew/paperclip-web guide:shots
```

- **Cách chạy.** Lệnh chạy spec `e2e/specs/guide-shots.spec.ts`, gắn `@t1 @t1-only @guide-shots`, và chỉ chạy khi có
  `CREW_GUIDE_SHOTS=1`. Mỗi lượt chụp cả vi và en, mất khoảng 3,6 phút.
- **Cách chụp.**
  - Theme sáng, giờ Asia/Ho_Chi_Minh.
  - Khung đánh số là phần tử DOM tạm, xóa ngay sau khi chụp.
  - Ảnh mã hóa WebP bằng canvas của Chromium, không cần thêm gói nào.
  - Spec chỉ mở hộp thoại rồi bấm Esc, không bấm nút xác nhận nào.
- **Tài khoản T1.** Tài khoản `guide-operator@crew-e2e.local` (operator) và `guide-viewer@crew-e2e.local` (viewer) tự dựng
  ở lượt đầu, theo đúng luồng của owner:
  1. owner tạo lời mời có `humanRole`;
  2. người mới đăng ký và nhận lời mời;
  3. owner duyệt yêu cầu tham gia.

  Mật khẩu tạm là `CREW_GUIDE_PASSWORD` trong `~/crew-ga-t1/board.env` (quyền 600). Em đã thêm biến này vào board.env.
  Owner và Phòng Marketing dùng tài khoản có sẵn.
- **Dữ liệu mẫu** (`e2e/support/guide-demo.ts`). Tìm theo tiêu đề trước khi tạo, nên chạy lại không sinh bản trùng.
  Gồm:
  - CRE-521 "Thêm nút xuất Excel ở trang báo cáo", đang chờ owner duyệt;
  - một yêu cầu và một bình luận của Phòng Marketing đang chờ duyệt;
  - một yêu cầu bị từ chối.
- **README.** `e2e/README.md` có mục mới "Ảnh trang Hướng dẫn". `run-e2e.sh` quét thêm `CREW_GUIDE_PASSWORD` khi kiểm lộ
  mật khẩu.

## Kiểm

- `corepack pnpm --filter @crew/paperclip-web test`: 138 file, 1217 ca đạt (1 todo).
- `typecheck` đạt. `tsc -p e2e/tsconfig.json` cũng đạt.
- Biome trên `src`, `test`, `e2e` sạch.
- Test mới:
  - `guide-content.test.ts`:
    - cú pháp và lỗi cú pháp, lọc theo vai trò;
    - vi và en giống nhau về nhóm, mục, vai trò, hình và link;
    - với từng vai trò: mỗi mục việc có ảnh và file ảnh có thật, link `#neo` trỏ tới mục có trong bản đó, phần chỉ owner
      chỉ nằm trong bản owner;
    - không có ảnh thừa, ảnh không quá nặng;
    - nội dung nói về ghép và gỡ máy, `/paperclip/`, Phòng Marketing.
  - `guide-page.test.tsx`: bản của từng vai trò, `?role=` chỉ owner đổi được, neo `#` cuộn tới mục, link SPA, EN.
  - `guide-roles.test.ts`.
  - Thêm một ca `membershipRole` cho hook access.
- (Lượt 1, trước rebase) `vite build` với `CREW_UI_COMMIT=afa16190d4773252c10d55556a3e6c025bec5801` ra thư mục scratch: đạt, có 90 file webp
  trong assets.
- E2E liên quan Hướng dẫn trên T1:
  - `guide-shots` (3 ca): đạt;
  - `PW-S0-1` (mở link Hướng dẫn ở sidebar): đạt.

### Kiểm lượt 2

- `corepack pnpm --filter @crew/paperclip-web test`: 1218 ca đạt (1 todo).
- `typecheck` đạt. `tsc -p e2e/tsconfig.json` đạt. Biome `src test e2e` sạch.
- `guide-shots` trên T1 (cả 3 ca, vi và en, dựng company mẫu rồi chụp lại toàn bộ ảnh): đạt.

## Cần biết

- **Lệch nhỏ trên ảnh.**
  - Bài không đánh số nút Tạm dừng trên ảnh `agent-detail`.
  - Ảnh `issue-popup` của owner có các nút cổng ngay dưới tiêu đề. Bài đã nhắc và trỏ sang mục Duyệt.
- **App Mac chỉ có tiếng Việt.** Bản en giữ nguyên tên nút tiếng Việt kèm bản dịch, ví dụ "Đổi company / Ghép lại máy"
  (Change company / Re-pair machine).
- **Owner không thấy ba mục thao tác của Phòng Marketing** (`#send-request`, `#send-comment`, `#my-contributions`) trong bản
  của mình. Muốn xem thì chọn "Phòng Marketing" ở ô "Xem hướng dẫn của".
- **Dữ liệu để lại trên T1** (chỉ là dữ liệu T1):
  - company 2P Demo;
  - hai tài khoản ảnh hướng dẫn;
  - từ lượt 1: CRE-521 và ba mục góp ý mẫu trong company e2e.

## Tiến trình

Sau lượt 2, em đã dừng server T1 (3199, kèm Postgres nhúng 54329) và web dev (5183) bằng SIGTERM. Cả ba cổng 3199,
5183, 54329 đã trống. Không còn tiến trình Playwright hay Chromium nào.

Status: DONE
Summary: Ảnh trang Hướng dẫn đã chụp lại toàn bộ (vi, en, theo vai trò) trên company mẫu 2P Demo có dữ liệu tiếng Việt
sạch: project sẵn sàng, máy trực tuyến, docs và góp ý mẫu. Mỗi lượt `guide:shots` dựng lại dữ liệu nên chụp lại được.
Mục giao diện gốc giờ chỉ có trong bản owner. Test, typecheck, biome và spec `guide-shots` đều đạt. Commit `3f32ef0d6`,
chưa push.
