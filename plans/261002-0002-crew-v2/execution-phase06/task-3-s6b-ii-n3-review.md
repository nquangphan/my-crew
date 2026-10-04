# Phase06/T3 — Review lát S6b-ii ⚠️N3(b): từ chối entry tracked dưới gốc đích render

Ngày 04/10/2026 (Asia/Ho_Chi_Minh). Commit `8d0ef6e`. Căn cứ: ruling PM mốc 14:00 trong `progress.md` (chỉ mở rộng từ
chối sang entry tracked trùng hoặc nằm dưới gốc đích materialize; `_bmad` lồng giữ exclusion cũ) và báo cáo
`task-3-s6b-ii-n3-report.md`. Em đọc diff nguồn và test, không chạy lại suite; kết quả GREEN lấy theo
`task-3-s6b-ii-n3-green.log` (23/23).

## Verdict

**Approved.** Không có finding chặn. Có một Minor về test và hai ghi nhận.

## Kiểm tra theo yêu cầu

**1. Một nguồn sự thật, phủ mọi đích mà materialize ghi — ĐẠT.** `isRenderDestination` dẫn xuất từ `renderInputRoots`
(`workspace.ts:88-91`), và đây cũng là danh sách mà `materializeRenderInputs` dùng để validate từng path. Đối chiếu
những gì materialize thực sự tạo:
- **File injected:** mọi path đều phải bắt đầu bằng `_bmad/` hoặc `.claude/skills/bmad-build/`, không thì ném
  `RENDER_INPUT_UNSAFE`. Vậy mọi file injected đều thỏa `startsWith(root)`.
- **`_bmad/render` (đích của renderer) và mọi output generated bên dưới:** nằm dưới `_bmad/`, nên được phủ.
- **Thư mục cha:** `_bmad`, `_bmad/scripts`, `_bmad/custom`, `.claude/skills/bmad-build`… thỏa
  `path === root.slice(0, -1)` hoặc `startsWith(root)`.
- **Phần không phủ:** chỉ có hai thư mục trung gian `.claude` và `.claude/skills`. Materialize chỉ `mkdir` hai thư
  mục rỗng này, không đè file tracked nào. Mọi entry tracked của owner dưới `.claude` vẫn đi theo exclusion cũ của
  phase03. Điều này đúng ruling 14:00 ("trùng hoặc dưới gốc đích").
- Entry tracked đúng tại gốc (file, symlink hay gitlink tên `_bmad` hoặc `.claude/skills/bmad-build`) khớp nhánh
  `path === root.slice(0, -1)`.

**2. Khớp tiền tố từ gốc repo — ĐẠT.** Path của audit là đường dẫn tương đối từ gốc workspace. Điều kiện là bằng đúng
tên gốc, hoặc `startsWith` gốc **kèm `/` ở cuối**, nên `.claude/skills/bmad-build-x`, `.claude/skills/bmad-buildx`,
`_bmadx` và `sub/.claude/skills/bmad-build/…` đều không khớp. Riêng ca `bmad-build-x` chưa có test; xem M1.

**3. `_bmad` lồng không bị từ chối — ĐẠT.** `sub/_bmad/x.toml` không khớp vì không bắt đầu từ gốc. Test `nestedOwner`
prepare thành công và có `receipt`; entry đó vẫn bị exclusion vì `discoveryReason` dò theo từng phần của path. Khớp
ruling.

**4. Đường non-render giữ nguyên — ĐẠT.** Guard vẫn mở đầu bằng `render !== undefined &&`. Test "a prepare without a
render request is unchanged" vẫn pass, và `trackedOwner` vẫn phủ exclusion `_bmad` cho đường không render.

**5. Lần format sau GREEN chỉ đổi định dạng — ĐẠT về nội dung, chưa chứng minh được theo byte.** Trong diff đã commit,
phần trông như format gồm: điều kiện `if` gộp từ năm dòng về một dòng, và mảng `for (const path of [...])` tách
thành nhiều dòng. Cả hai không đổi ngữ nghĩa, và mọi thay đổi logic (predicate, guard, fixture, hai test) đều khớp
tên test trong green log. Tuy vậy log không ghi digest của source lúc GREEN, còn báo cáo không nhắc tới bước format,
nên em không xác minh được theo byte rằng code đã commit chính là code đã chạy GREEN cộng phần format. Xem ⚠️A.

## Findings

**M1 (Minor) — Chưa có test chặn khớp nhầm tiền tố anh em** — `v2/gateway/test/isolation-render.test.ts`, các ca
N3. Logic hiện tại đúng, nhưng nếu ai đó sau này bỏ dấu `/` khỏi `renderInputRoots` hoặc đổi sang `startsWith` không
kèm `/`, sẽ không có test nào đỏ. Sửa: thêm một assert rẻ, ví dụ owner track `.claude/skills/bmad-build-x/a.md`
thì prepare BMAD không bị từ chối vì `BMAD_TRACKED_IN_CHECKOUT` (entry đó vẫn bị exclusion như `.claude` thường).
Nếu không muốn dựng thêm checkout, export predicate và kiểm trực tiếp ở mức unit.

## Ghi nhận (không chặn)

- **⚠️A — Bằng chứng format sau GREEN.** Lần sau nên ghi `git diff --stat` hoặc sha của file nguồn trước và sau
  `biome format` vào log hay báo cáo, để reviewer xác minh được "chỉ đổi định dạng" mà không phải suy luận.
- **⚠️B — APFS không phân biệt hoa thường.** Owner track `_BMAD/x` thì không khớp predicate (so sánh phân biệt hoa
  thường) và cũng không bị exclusion. Sau đó `mkdir _bmad` của materialize gặp EEXIST nên prepare fail-closed
  (`retained`), nhưng mã lỗi là errno chứ không phải `BMAD_TRACKED_IN_CHECKOUT`. Trường hợp `.Claude/skills/…` thì
  bị exclusion như `.claude` thường, không bị đè. Không đè dữ liệu và không mở lỗ hổng; chỉ là thông báo lỗi kém rõ.
  Có thể so sánh không phân biệt hoa thường sau này nếu PM muốn.

**Task quality:** Approved
