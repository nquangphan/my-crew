# Task 4 FIX2: re-review có phạm vi

Phạm vi:
- Diff `a297d3d..00aeace` (`v2/web/src/graph/*`, `v2/web/e2e/ticket-map.spec.ts`, các test unit/DOM, docs).
- Mục FIX2 trong `task-4-report.md`.
- Ảnh `ui-evidence/task-4/map-root-fork-join-repair.png`.

Không chạy lại test.

## Verdict

| Mục | Verdict | Bằng chứng |
|---|---|---|
| B1: relayout có neo, task liền bước cha | **ADDRESSED** | `layout.ts` `relayoutAround`/`followAnchor`. `ticket-map.tsx`: `toggle` neo bước vừa bấm; “Mở/Thu gọn tất cả” neo thẻ đang focus, không có thì root; neo không còn hiện thì dùng root. Neo lấy từ vị trí trước và sau trong cùng một render, viewport dịch đúng một lần mỗi lượt (`anchoredRun`). Realtime vẫn dùng `placeNewNodes` nên I1 giữ nguyên. Ảnh fork/join mới: A nằm giữa a2/a1, B ngang b1, C ngang c1, K nằm giữa 5 task sửa, root nằm giữa 4 bước. Không thẻ nào chồng; khung nằm trong 1440×1000. |
| B2: `ResizeObserver` | **ADDRESSED** | Theo dõi `document.body` và `.page-stack`, giữ cả `resize`, disconnect khi cleanup. Không lặp vô hạn: đo xong, chiều cao không đổi thì `setHeight` nhận cùng giá trị nên không render lại. |
| B3: guard `history.back()` | **ADDRESSED** | Mục history push khi mở dialog mang `crewMapDialog: <rootId>`. `closeMapDialogNavigation` chỉ trả `back` khi mục hiện tại có đúng dấu của root này, còn lại `replace`. Đã thử trên code các trường hợp: deep link, reload mục có dấu (state history còn qua reload nên lùi đúng về sơ đồ), Forward vào mục có dấu, mục do nơi khác push. Không trường hợp nào lùi ra ngoài sơ đồ. Bỏ ref sống theo component là đúng hướng. |

## Đánh giá thêm

**Rủi ro chớp hình khi dịch viewport: thấp, chưa đo, chấp nhận được.**
- Vị trí node mới đi vào ReactFlow qua `StoreUpdater` của `@xyflow/react` 12.12.0. Component này đồng bộ `nodes` bằng `useEffect` (`dist/esm/index.mjs:281-293`). Viewport được dịch trong `useLayoutEffect` của `MapView`.
- Relayout chỉ chạy từ click (discrete event). Với loại event này, React flush cả passive effect lẫn cập nhật store đồng bộ trước khi trình duyệt vẽ. Nên trong thực tế, vị trí node mới và viewport mới cùng lên một khung hình.
- Em không xác minh được `panZoom.setViewport` khi không có `duration` áp transform đồng bộ hay không: không tìm thấy gói `@xyflow/system` trên đĩa để đọc.
- Nếu có chớp thì chỉ một khung hình (~16 ms), trạng thái cuối vẫn đúng (E2E ≤ 1 px). Không chặn duyệt.
- Nếu owner thấy giật: tính viewport mới ngay trong render rồi truyền cùng lượt, hoặc ẩn lớp viewport một frame (`visibility`) trong lúc dịch.

**“Vừa khung” thêm vào E2E trước khi kiểm: không che lỗi.**
- Kiểm neo root khi “Mở tất cả” đo trước khi bấm Vừa khung. Vừa khung chỉ chen vào trước khi đo vị trí gốc của bước C.
- Kiểm neo C so trước/sau thu gọn và mở lại, sau cùng một viewport. Vừa khung đặt viewport trước điểm đo “trước” nên không làm lệch phép so.
- `expectTasksBesideSteps` là tính chất của bố cục, không phụ thuộc viewport. Vừa khung chỉ để thẻ được mount (`onlyRenderVisibleElements`). Dải cho phép `(n−1)/2 × 136 × zoom + 1` khớp đúng hình học của `layoutHierarchy` (bước nằm giữa con đầu và con cuối).
- Phần không được E2E phủ: task đến bằng realtime vẫn có thể lệch xa bước cha cho tới khi bấm “Sắp xếp lại”. Đây là hệ quả có chủ đích của ruling giữ vị trí; ảnh `map-after-concurrent-writes.png` của FIX1 vẫn đúng hành vi đó.

**Assertion E2E thêm sau khi sửa source: chấp nhận, kèm một lưu ý.**
- RED hợp lệ đến từ unit (5/5 fail bằng assertion, `task-4-fix2-red-unit.log`) và DOM (“Việc A2 liền bước A”).
- Hai kiểm neo trong E2E (root khi Mở tất cả, C khi thu gọn/mở lại) sẽ **vẫn xanh trên code FIX1**, vì FIX1 không dời thẻ nào. Chúng chỉ bắt được regression kiểu “relayout mà không dịch viewport”.
- Chỉ `expectTasksBesideSteps` phân biệt được FIX1 với FIX2. Cả hai loại cùng có mặt nên phủ đủ hai hướng regression, nhưng không bên nào được chứng minh RED ở tầng E2E.
- Report cũng tự khai việc helper unit `tasksBesideParents` bị thu hẹp về task của bước sau khi sửa source. Điều này hợp lý: con của root là cây con, không phải lá. RED vẫn đứng vì assertion đầu tiên (bố cục bằng `layoutHierarchy`) fail trên stub.

## Issues

Không có Critical hoặc Important mới.

Minor:
- **N1:** `setExpandedIds` đọc `view.focusedTicketId` từ closure render (`ticket-map.tsx`, nhánh “tất cả”). `focusedTicketId` không bị xóa khi thẻ mất focus, nên “tất cả” có thể neo vào thẻ đã focus từ lâu thay vì root. Vô hại: neo vẫn đứng yên, chỉ khác điểm neo. Nếu muốn đúng ý “thẻ đang có focus”, kiểm `document.activeElement` có `data-map-node` hay không.
- **N2:** chớp hình chưa đo (xem trên). Ghi rủi ro cho lượt A4 tiếp theo.

## Assessment

**Task quality:** Approved. B1, B2, B3 ADDRESSED; ảnh fork/join mới khớp hướng tham chiếu (gốc trái, bước giữa, task liền bước cha sang phải). Các mục còn mở ngoài FIX đã được ghi nhận từ trước: M2 nhãn cạnh, A4 dán ảnh/tệp chờ extractor, `repair_links` E2E ghi DB trực tiếp, IMG_6454 không có trong repo.
