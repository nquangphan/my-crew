# S6b-ii N3: từ chối checkout track entry dưới gốc đích render

Kết quả: DONE.

- `workspace.ts`: thêm `isRenderDestination(path)` dẫn xuất từ `renderInputRoots` (nguồn duy nhất, vẫn là danh sách mà
  `materializeRenderInputs` dùng để validate). Bước từ chối `BMAD_TRACKED_IN_CHECKOUT` dùng predicate này thay cho kiểm tra
  `_bmad` viết tay, nên phủ cả `.claude/skills/bmad-build/**`. `_bmad` lồng trong thư mục con không khớp (so khớp theo tiền tố từ gốc repo).
  Đường không render giữ nguyên.
- Test mới trong `isolation-render.test.ts`: (a) checkout track `.claude/skills/bmad-build/custom.md` bị từ chối, file còn nguyên ở clone và checkout;
  (b) checkout chỉ có `sub/_bmad/x.toml` prepare thành công và có receipt.
- RED (`task-3-s6b-ii-n3-red.log`): ca (a) fail "Missing expected rejection" (prepare thành công, bản materialize đè file tracked); ca (b) đã pass vì hành vi cũ đúng.
- GREEN (`task-3-s6b-ii-n3-green.log`): isolation*.test.ts 23/23 pass, `tsc --noEmit` sạch, biome sạch, `crew-docs check --all` ok.
- Docs: cập nhật `v2/docs/flows/gateway-workflows.md` (mục 15 và mô tả test S6b-ii).
