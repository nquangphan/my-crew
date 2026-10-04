# T3 D1 FIX1 — re-review bốn phát hiện

### Spec compliance

- ✅ **Đạt trong phạm vi D1 đã sửa.** Diff chỉ đổi `render-artifacts.ts` và test của nó; đối tượng trả về vẫn là `artifact-inspection`, còn test adapter tiếp tục đòi `RENDER_ARTIFACT_REQUIRED` (`v2/gateway/src/assistant/render-artifacts.ts:522`, `v2/gateway/test/render-artifacts.test.ts:570`). Không thấy thay đổi mở BMAD admission.
- ⚠️ Kiểm tra này chỉ xét bốn phát hiện của review trước và hỏng hóc mới trong delta FIX1. Tính đầy đủ của registry, đọc file an toàn trên host, thực thi renderer, root vận hành và receipt vẫn là các cổng riêng (`task-3-d1-report.md:67`). Kết quả 25 unit test không chứng nhận các cổng đó.

### Bốn phát hiện

1. **Đã xử lý — `customize.toml` có hai quan sát mâu thuẫn.** Factory yêu cầu digest ở layer và projected map bằng nhau (`render-artifacts.ts:320`); inspector còn so byte đã chụp của cùng path (`render-artifacts.ts:419`). Test dựng hai byte khác nhau, mỗi bộ khớp digest riêng, và yêu cầu từ chối (`render-artifacts.test.ts:377`).
2. **Đã xử lý — accessor/proxy vượt cap khi copy.** `boundedKeys` chỉ nhận own enumerable data descriptors và từ chối proxy trước khi chạm trap (`render-artifacts.ts:83`, `render-artifacts.ts:92`). `preflight` lấy intrinsic `buffer`/offset/length của typed array, từ chối shared buffer, cộng giới hạn tổng rồi giữ view để copy từ đúng view đó (`render-artifacts.ts:341`, `render-artifacts.ts:370`, `render-artifacts.ts:381`). Test bao trùm getter của manifest, projected, layer và output cùng proxy map (`render-artifacts.test.ts:390`, `render-artifacts.test.ts:430`).
3. **Đã xử lý theo quy tắc chính thức đã đính chính — `resolved_values`.** Review cũ đòi mọi giá trị là chuỗi; PM đã thay bằng loại giá trị được chứng minh từ archive: scalar, string list và review-layer list (`task-3-d1-report.md:45`). FIX1 khóa source tree được chấp nhận (`render-artifacts.ts:64`, `render-artifacts.ts:302`), lấy key từ token trong `.md`, từ chối key thừa hoặc short token mơ hồ và kiểm từng loại giá trị (`render-artifacts.ts:178`, `render-artifacts.ts:204`, `render-artifacts.ts:468`). Test nhận hai loại list chính thức và từ chối top-level array, config value sai loại, key không có token (`render-artifacts.test.ts:459`, `render-artifacts.test.ts:469`, `render-artifacts.test.ts:495`). Không giữ yêu cầu string-only sai của review cũ.
4. **Đã xử lý — Unicode lỗi trong path identity.** Mọi path qua `checkedAbsolutePath` nay phải qua `validUnicode` (`render-artifacts.ts:124`); expectation root/generation và supplied generation path đều dùng hàm này. Test từ chối lone surrogate trong root và generation root (`render-artifacts.test.ts:451`).

### Chất lượng và bằng chứng

- ✅ **Không thấy hỏng hóc mới chặn D1 trong delta.** Kiểm tra tĩnh source/test cuối khớp SHA-256 trong report: `29881b48…` và `0b1e51ea…`. Diff FIX1 khớp `84eb77f9…`.
- ✅ Log cuối khớp SHA-256 report: test `d83208bc…` ghi 25 pass/0 fail, Biome `66f227a6…` ghi 2 file không cần sửa, typecheck là file rỗng với SHA-256 `e3b0c442…` (`task-3-d1-report.md:65`). Exit 0 và PID đã reap là số liệu do implementer ghi; phiên review này không chạy lại. Lần GREEN đầu bị lỗi wrapper zsh là chẩn đoán lịch sử, không được tính làm exit witness cuối (`task-3-d1-report.md:61`).

**Task quality:** Approved cho pure supplied-byte inspector D1 theo phạm vi đã đính chính. Không suy ra quyền dùng nó làm host reader, renderer receipt hoặc BMAD admission.
