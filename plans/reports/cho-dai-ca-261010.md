# Việc chờ Đại Ca trả lời (sáng 10/10/2026)

Trợ Lý gom mọi câu hỏi và việc cần owner trong lúc chạy liên tục R2. Mỗi mục có phương án Trợ Lý đang tạm theo.

## Việc cần ngồi máy
- [ ] Chứng chỉ Developer ID Application + `xcrun notarytool store-credentials crew-notary` (chặn ký/notarize/phát hành app, cổng 1, 2, 5 của R2-1).
- [ ] Một lần đăng xuất/đăng nhập Mac mini (đo app tự mở cùng máy, S1b).
- [ ] Thử đóng cửa sổ và "Thoát ngay, run vẫn chạy" giữa một run (cổng 4 phần UI).
- [ ] Gỡ login item app 2P Crew cũ trong Cài đặt hệ thống → Chung → Mục đăng nhập.
- [ ] Có thử "Gỡ khỏi Mac" project 2ps-landing không (cổng 6).

## Push
- [ ] Repo Crew `v3`, `r2-1` (và nhánh R2 sau); fork `crew/r2-1` (và nhánh sau). Chưa push gì từ 09/10 chiều.

## Câu hỏi phát sinh
- R2-2 AG-2: Trợ Lý đã cho đồng bộ 4 template hướng dẫn agent trong app (để project thêm bằng app cũng đọc được file đính kèm). Phủ quyết nếu không muốn.
- R2-2 lệch 2: plugin đọc chữ ký đầu file (ảnh/PDF/DOCX/XLSX) để bắt file thực thi đổi đuôi, trái câu "không đọc nội dung" trong spec 5.6. Phủ quyết nếu không muốn.
- R2-2 nghiệm thu UI (~10 phút ngồi máy): tạo issue kèm file, dán ảnh vào comment, thử file 10 MB + 1 byte trên giao diện.
- R2-1 P1 đã chốt để R3 (ghi lại để nhớ).
- PA-1 thêm quyền `companies.read` cho plugin (ngoài plan) để job biết quét company nào. Phủ quyết nếu không muốn.

## R3 — 8 câu từ BA (`plans/261010-0020-crew-v3-r3/ba/ba-report.md` mục 5). Trợ Lý TẠM theo phương án khuyên để chạy tiếp; Đại Ca phủ quyết câu nào thì em đổi.
1. UI Crew THAY HẲN UI Paperclip ở `crew.2p-solutions.com` (chép bản build vào `server/ui-dist` qua overlay, không sửa lõi, không thêm subdomain).
2. App 2P Crew trên Mac kéo hàng đợi "việc cần làm trên máy" (thêm project, v.v.); app phải đang mở thì việc mới chạy, UI hiện "Chờ app trên máy X".
3. KHÔNG có nút để board vượt cổng (ép Done, sửa reviewer/approver); chỉ Duyệt / Yêu cầu sửa / Hủy.
4. Trang Hướng dẫn có bản tiếng Anh (viết cuối R3 từ bản tiếng Việt); docs dự án vẫn chỉ tiếng Việt.
5. UI chỉ hiện company có trong cấu hình Crew; ẩn "Crew Spike Policy" (CREA); thêm company "Crew E2E" cho Playwright; R3 không có nút tạo company.
6. Chặn thêm skill trùng tên skill Superpowers đã ghim; trang Skills R3 chỉ: xem, thêm từ GitHub, bật cho agent, trạng thái sync.
7. Gỡ agent/project trên web để sau R3; R3 vẫn gỡ bằng app Mac.
8. Design system bản đầu dùng token/component của Paperclip (đổi tên, logo 2P); đổi màu thương hiệu sau.

## Lỗ hổng quyền BA phát hiện (Trợ Lý sẽ đưa vào kế hoạch R3, báo để Đại Ca biết)
- Agent `tro-ly` đang có quyền `canCreateAgents`, `canCreateSkills`; agent tạo được project qua API.

## R2-2 — nghiệm thu còn cần ngồi máy (~10 phút)
- Phần API đã ĐẠT (AC1 API, AC3–AC11; báo cáo `plans/261009-1945-crew-v3-r2-2/reports/ac-r2-2-report.md`).
- Còn: AC2 (dán ảnh `ac2-second.png` vào comment trên UI), AC5 phần UI (kéo file 10 MB + 1 byte, UI phải từ chối), một ca đính file bằng hộp thoại "New issue". Trợ Lý sẽ giao lại TPS-80 cho `tro-ly` trước khi Đại Ca dán ảnh.

## R2-3 BMAD — 5 câu (spec `docs/superpowers/specs/2026-10-10-crew-v3-r2-3-bmad-design.md` §11). Trợ Lý TẠM theo phương án khuyên.
1. BMAD chỉ lập epic/story; code từng story vẫn do executor Superpowers.
2. Trợ Lý chọn BMAD khi company có agent BMAD, là yêu cầu code, và issue gốc có nhãn `bmad` hoặc mô tả đòi rõ epic/story/PRD.
3. Owner duyệt epic/story ở bước duyệt của chính issue con BMAD.
4. Ghim BMAD bản `d009608` (6.13.0-next, kênh -next chứ không phải tag stable).
5. Agent BMAD tự chọn tiếp ở menu, chỉ hỏi owner một lượt, tối đa 30 story mỗi file.
- R3 spec §5: 7 chỗ lệch so với BA (6 ý Trợ Lý/agent tự chốt) — đọc `docs/superpowers/specs/2026-10-10-crew-v3-r3-ui-design.md` §5 và phủ quyết nếu cần. R3 ước ~12 ngày công; UI Crew chỉ lên prod khi đăng nhập, cli-auth, tạo yêu cầu, duyệt, hủy đã qua test, có mốc rollback.

## R2-4 runtime — 5 câu (spec `docs/superpowers/specs/2026-10-10-crew-v3-r2-4-runtimes-design.md` §11) + 2 việc
1. **Duyệt 3 vá adapter P5, P6, P7** (loại adapter-patch, theo dõi trong core-hooks.json). QUAN TRỌNG: adapter `opencode_local` gốc khi chạy qua SSH chạy `rm -rf "$HOME/.claude/skills"` trên Mac (xóa skill của Đại Ca mỗi run) — P6 sửa. Không duyệt P6 thì R2-4 không có OpenCode (công tắc ép tắt).
2. Bảng runtime/model theo độ khó (§6.1). 3. Điều kiện và trần fallback (tối đa 2 lần/issue; mức large không fallback). 4. Mặc định công tắc và chỉ board bật. 5. Vai trò nào được chạy Codex/OpenCode, số executor.
- Việc Đại Ca: nạp key OpenCode Go vào Keychain: `security add-generic-password -U -s crew.opencode-go -a crew -w` (lệnh tự hỏi key, không lưu lịch sử).
- Codex từng trả 400 ngày 08/10; nếu nghiệm thu còn lỗi thì phần Codex dừng.

## R2-5 docs graph/usage — 5 câu (spec `docs/superpowers/specs/2026-10-10-crew-v3-r2-5-docs-usage-design.md` §11). Trợ Lý TẠM theo khuyên.
1. Hiện ngay trong plugin bằng UI tối thiểu (module dùng lại được cho R3).
2. Ticket nối vào graph qua `crew-commit` + danh sách file đổi do Mac gửi.
3. USD hiện, có nhãn "ước tính, không phải hóa đơn".
4. Dung lượng cache file đính kèm trên Mac đưa vào bản tin máy.
5. Bảng `docs_pages` cũ giữ nguyên, không xóa.
- R2-5: Trợ Lý tự sửa migration 0008 (chưa áp ở đâu) để khóa ngoại docs_commits.first_snapshot_id dùng ON DELETE SET NULL — giúp rollback image không làm vỡ webhook docs cũ. Phủ quyết nếu không muốn.
- R2-5 AC4: cạnh ticket→flow trong đồ thị docs chưa có dữ liệu thật (2 ticket của 2ps-landing chỉ sửa file không thuộc flow); đã có test, sẽ kiểm trên run thật kế tiếp. AC8: Trợ Lý cho sửa panel Usage hiện ở giao diện issue mặc định.
- Tên tag cuối R2 (đang có tag cục bộ crew/v3.2-rc1, v3.3-rc1, v3.4-rc1 cho R2-2/R2-3/R2-5). Trợ Lý đề xuất: chốt một tag `crew/v3.1` khi xong cả R2 (gồm R2-4), xóa các rc cục bộ.
- Tài liệu BMAD thử (PRD/kiến trúc/epic/story) nằm ở nhánh `crew/TPS-82` của repo thử `repo-a`, chưa push. Trợ Lý đề xuất để nguyên (repo thử), không gộp.

## R3 bảo mật — cần Đại Ca duyệt sửa LÕI Paperclip (SEC-1, `plans/261010-0020-crew-v3-r3/reports/sec-1-routes.md`)
Agent (token của agent cùng company) hiện làm được những việc sau mà không hook nào chặn. Muốn chặn tận gốc phải sửa lõi (ngoài 5 hook đã duyệt). Trong lúc chờ, SEC-2 sẽ làm biện pháp tạm không đụng lõi (plugin tự pause agent lạ, cấu hình quyền/skill policy qua REST, mở rộng thân H2/H4/H5).
- **D5 (nặng nhất):** `POST /companies/:id/onboarding-seed` chỉ kiểm cùng company → agent bất kỳ tạo được agent role `ceo` cùng goal/project/issue. Đề xuất: thêm một dòng `assertBoard` ở `onboarding-seed.ts:41`.
- **D6:** agent tạo/sửa/archive/xóa được project và workspace (kể cả qua MCP `create_project`).
- **D7:** `DELETE /issues/:id` và `POST /issues/:id/checkout` đi vòng H2 → agent xóa hoặc giành issue đang chờ Đại Ca duyệt.
- **D12:** agent sửa được execution workspace của agent khác.
- Hai chỗ spec R3 sai đã được SEC-1 sửa lại: tắt `canCreateAgents` KHÔNG làm Trợ Lý mất quyền giao việc; `canCreateSkills` không được kiểm ở đâu (phải dùng skill policy deny).
Câu hỏi: Đại Ca có duyệt vá lõi cho D5/D6/D7/D12 (mỗi cái vài dòng `assertBoard`/kiểm actor, theo dõi như adapter-patch) không?
- OP-2 (company Crew E2E trên prod) tự quyết 3 điểm, Đại Ca có thể bác: (1) thêm 2 agent giữ chỗ `crew-e2e-reviewer`/`crew-e2e-integrator` (không chạy run) vì policy bắt buộc có; (2) prefix là `CRE` (server tự sinh); (3) giá trị webhook secret bản tin của Crew E2E lưu ở file 600 trong thư mục 700 trên VPS để lúc deploy nạp vào Mac (Paperclip không cho đọc lại secret). Đề xuất: xóa file đó sau DP-2 của R3.
- SEC-2 (đã code, chưa deploy): tắt quyền tạo agent/skill cho mọi agent; chặn agent sửa agent/AGENTS.md/skill; agent chỉ giao việc cho chính mình hoặc executor (Trợ Lý giao được cho mọi agent trừ reviewer/integrator); plugin tự pause agent lạ và agent tạo/sửa project. Áp lên prod ở lúc deploy R3. Đại Ca bác luật giao việc nào thì nói.
- RV-1 R3: Đạt có điều kiện (0 Blocker, 9 Major, 39 Minor; full suite hai repo xanh). Đang sửa theo 8 gói FX. Trợ Lý vẫn deploy R3 dù D5/D6/D7/D12 chưa vá lõi, vì các lỗ này đã có sẵn trên prod hiện tại; R3 (SEC-2) chỉ thu hẹp chúng. Đại Ca duyệt vá lõi thì em làm ngay sau.
- **Vá lõi đề xuất (DBG-P1, `plans/261010-0020-crew-v3-r3/reports/dbg-p1-scope-denied.md`):** host Paperclip gửi sự kiện cho plugin bằng `notify`, giữ "invocation" 15 phút; trong lúc đó plugin gọi host không kèm company bị từ chối. Prod hiện tại đã dính nhẹ (job kiểm đính kèm hỏng ~15' sau mỗi lần hủy run). R3 né bằng cách luôn gọi kèm company (đang sửa). Vá gốc: đổi `notify` → `call` cho `onEvent` (vài dòng ở `plugin-worker-manager.ts`) và báo upstream. Đại Ca có duyệt vá lõi này không?

## Đại Ca đã chốt (10/10 07:06)
- Vá lõi D5, D6, D7, D12: VÁ CẢ 4.
- Vá lõi notify → call cho sự kiện plugin: VÁ và báo upstream.
- R2-4: duyệt cả P5, P6, P7.
- Push R3 ngay.
- R3 BA: câu 1 giữ (UI thay hẳn), câu 2 app nhận như hiện tại, câu 3 **THÊM nút "Ép Done" có xác nhận (ghi board_override)**, câu 4 giữ VI+EN, câu 5 giữ, câu 6 **CHO sửa/xóa skill trên web**, câu 7 **LÀM nút gỡ agent/project trên web**, câu 8 giữ, đổi màu sau.
- Luật giao việc SEC-2: giữ. Crew E2E: giữ, xóa file secret trên VPS sau DP-2. Tag: crew/v3.1 sau R2, crew/v3.2 sau R3, xóa các rc cục bộ.
- R2-2: giữ kiểm chữ ký đầu file, giữ companies.read và đồng bộ template. R2-3: giữ cả 5. R2-5: giữ tất cả.
- R2-4: bảng model theo khuyên; fallback theo khuyên; công tắc Codex/OpenCode tắt sẵn; **reviewer được chạy Codex** (thêm vào khuyên "chỉ executor").
- Upstream: Đại Ca cho đăng issue/PR vá notify→call lên Paperclip khi CORE-P xong (10/10 07:20).
- R3X: Q1 bật sẵn hủy việc con khi Ép Done; Q2 gỡ agent chỉ pause; Q3 gỡ project giữ yêu cầu mở; Q5 checkout có việc chưa commit thì giữ và báo; Q4 (sửa nguồn skill) theo khuyên (10/10 07:35).
