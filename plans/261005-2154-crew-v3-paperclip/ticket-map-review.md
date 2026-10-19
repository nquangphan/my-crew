# PM-02 — Review độc lập artifact ticket map

Ngày05/10/2026, Asia/Saigon. Reviewer `pm_skill_review`, không implement map; chỉ sở hữu report này. Score7 =1+U2+C2+I2; actual `gpt-6.1-sol` medium theo follow-up PM. Admission PM23:04:24GiB/12CPU, memory_pressure free41% (không quy đổi GiB), load4,88,disk61GiB,remaining10%,hardreserve1%,soft3%closure; corefix và controller-owned clone cùng chạy, review light, không heavy job.

## Verdict

**Spec: FAIL ở requirement không false-accepted của release. Quality: FAIL, một P2 cần sửa.** Các phần projection/dialog/dependency/security đạt static/parser gate. Không sửa worker files/source/ledger/commits. Không accept sản phẩm Crew/Paperclip/API/DB từ offline artifact.

## Finding P2 — Release dùng màu accepted từ child tasks khi không có gate release

`ticket-map-update.py`, hàm `tallyState` và đoạn `render` dựng dot: mọi node không phải task, gồm release/root, nhận `tallyState(n.tasks)`. Hàm trả `accepted` khi tất cả child state accepted; nó không đọc acceptance/evidence release. Legend màu xanh là `Đã nghiệm thu`. Vì thế R1/R2 có thể hiện chấm xanh đã nghiệm thu dù meta/dialog nói chưa có gate/bằng chứng release. Vế text guard tốt nhưng hai tín hiệu mâu thuẫn, owner quét map có thể hiểu sai release đã accepted. Cùng logic còn trả accepted cho list rỗng do every([]).

Reproduction thật qua Node VM trên hàm lấy từ HTML candidate: `tallyState([{state:'accepted'},{state:'accepted'}])` trả `accepted`; `tallyState([])` cũng `accepted`; candidate đồng thời có legend `Đã nghiệm thu` và `chưa có gate release`.

**Sửa hẹp:** dot release/root dùng status trung tính hoặc aggregation class riêng không mang nghĩa nghiệm thu; chỉ `accepted` khi có gate release/root explicit từ ledger. Phase/group chỉ được aggregate nếu legend/text phân biệt summary child với group acceptance. Empty list không accepted. Thêm self-test/harness scenario all children accepted/no group evidence xác nhận không accepted release/root, rồi review diff scoped. Không tạo remote ticket hay status giả để chữa UI.

## Kiểm chứng độc lập đã thực chạy

1. `python3 plans/261005-2154-crew-v3-paperclip/ticket-map-update.py --self-test` → PASS projection/state/deps/aliases/no fake edges/duplicate IDs/injection JSON tests. Updater self-test không ghi HTML.
2. Python `-B` import updater, parse current `progress.md`, lấy JSON nhúng HTML và đối chiếu: **31 tasks, allNotCreated=true, warnings=[], projectionEqual=true**; SHA ledger và HTML đều `a0afd0365d1d680d8ee77fd9daaff43a2e335aac074e32697f8e90fa4554c276`. PM/worker cập nhật artifact trong lúc review; reviewer không regenerate hoặc sửa HTML. Evidence gắn snapshot này; future ledger đổi phải regenerate/reload.
3. Independent in-memory fixture thay in_review→accepted và score6/medium→7/high: state/score/effort thay theo ledger. Missing remote registry → unverified, không tự not-created; unknown99-99 tạo warning, không cạnh giả. Payload img/onerror giữ text trong sourceTitle, safe_json không có ký tự `<` thoát script.
4. Node VM chạy đúng `tallyState` lấy từ HTML, kết quả finding ở trên. Không tạo file fixture/process/server.
5. Root `require.resolve('@playwright/test')` báo NOT_AVAILABLE. Lượt kiểm module path trong package bị PreToolUse hook chặn node_modules, nên không tiếp tục bypass/install/config change. Lệnh bị chặn chưa thực thi parser kèm trong cùng command; parser được chạy riêng sau đó. Không có Chromium rerun độc lập trong lượt này.

## Review source và evidence worker

- Standalone HTML không import font/lib/network; data JSON escape `<>&` và U+2028/2029. `textContent` cho title/state/model/worker/evidence/blocker; không innerHTML hoặc ledger data vào attributes thực thi. Chưa thấy injection vector trong candidate inspected.
- Root→R1/R2→phase→task tree và dashed dependency arrow source rõ. Dependencies chưa biết có warning, raw depends vẫn hiện dialog. Task dùng cả releases hiển thị một lần ởR1 nhưng filterR2 gồm task; groups là presentation không fake remote tickets. Current31tasks/score/model/state khớp parse ledger.
- Native dialog có aria-labelledby, close label, Escape browser native, focus-return handler; dependency buttons chuyển detail. Search/state/release/zoom/fit/reset và checkbox edges đều có handler. Mobile CSS390-class dùng scrolling graph nội bộ, responsive dialog max-height85dvh/width viewport-30; không thấy overflow body source bug.
- Worker browser evidence ghi Chromium thật via existing Playwright1.63.0: click/Enter/Escape/Tab/focus-return, filter/R2/zoom, release dep arrow, viewport390×844, HTML injection text-only,0errors/0externalRequests. Snapshot worker SHA `3548195518921ee949cd8a4de8fcf6072d33e516ebf9981596057b36c227179e` generated23:01:09/verified23:02:21; **khác snapshot current**, nên đây là evidence worker ở snapshot cũ, không independent browser proof candidate sau projection refresh. Parser/DOM template source review phủ phần refresh data; browser rerun vẫn chưa thực hiện.
- Offline status lấy ledger, không remote source API. Current remote registry nói all planning IDs not-created và artifact giữ nhãn đó; không fake remote UUID/ticket persistence. Html snapshot không tự watch ledger, worker report hướng dẫn updater/reload rõ.

## Candidate hashes và closure

HTML SHA256 `463509656f969700f5abcb69be1f03f5711e476291a2f890c8c4abc1be43e73f`; updater `5f9ae6c9f9ab28328d6b4ba575ed64ff9b4ce5dc4293102a6d7a54ec161ed488`. Reviewer không tạo background process/DB/server/dep/bytecode/scratch cần cleanup; giữ report này. Parent PM owns ledger/status và dispatch worker fix sau admission mới.

Open: P2 summary accepted semantics. Giới hạn: browser độc lập blocked/unavailable, chưa product API/DB integration; chỉ acceptance artifact offline sau fix và scoped review. Không yêu cầu cài deps hoặc làm lại fullsuite để sửa finding.

## Scoped fixround1 re-review — aggregate P2

Admission PM23:16 Asia/Saigon: memory_pressure free58%,load5,04,disk55GiB,weeklyremaining9%,hardreserve1%,soft3%; one measured install core job đang chạy, reviewer light ở seat thứ hai. Chỉ review diff aggregate, updated report/evidence và covering regressions; không re-audit/fullsuite/DB/install/source sửa.

**P2 ADDRESSED. Spec PASS, quality PASS,0 finding mở trong PM-02 artifact gate.** Không thấy fix breakage mới. `tallyState` trong updater/template và generatedHTML hiện trả `aggregate` cho mọi group/root/release; CSS chấm rỗng, legend phân biệt `Task đã nghiệm thu` với `Nhóm · thống kê task con`. Group meta/tooltip/dialog nói đây là child statistics, empty state rõ. Leaf giữ actual status từ ledger. Không thêm fake remote gate hoặc accepted ticket để sửa presentation.

Kiểm chứng reviewer tự chạy:

- `python3 plans/261005-2154-crew-v3-paperclip/ticket-map-update.py --self-test` PASS, gồm Node VM gọi hàm template thật với allaccepted/empty/running; parser covering tests cũng PASS.
- Sanctioned package resolution `pnpm --filter @crew/web exec node` chạy Chromium headless hiện có, không inspect blocked module paths/install/config change. Harness stdin đọc actual HTML rồi clone JSON in-memory cho current/allaccepted/empty, mỗi fixture mở fresh page viewport390×844. Current:21neutral aggregate,0aggregateAccepted,3leafAccepted; allaccepted:21neutral aggregate,0aggregateAccepted,31leafAccepted; empty:0aggregateAccepted,0leafAccepted,empty visible. Cả ba0bodyOverflow.
- Actual native dialog root có `Thống kê task con` và `Chưa ghi bằng chứng nghiệm thu riêng`; Escape đóng đạt.0page errors. Browser/pages đóng trong finally; không mở server/port/background hoặc tạo fixture/evidence file ngoài report. Browser hạn chế ở vòng đầu đã được giải bằng entrypoint package được PM chỉ định, không bypass hook.

Updated worker evidence fixround1 cũng ghi allaccepted/empty Chromium, dialog/mobile/injection/filter covering PASS ở ledgerSHA236b6b1e39a007ef7b15368588985cf63878186c0a9eb679ef3d81161050823f. Đây là evidence worker có scope rõ; independent rerun trên candidate hiện tại kiểm trực tiếp fix và related dialog/mobile, không nhận mọi test worker thành test reviewer đã chạy.

Candidate scoped rerun: HTML SHA256 `926ffd4d6fafbd6d2602396a1f8def4cce5174f1206700c60bcba9b337e59adb`, updaterSHA256 `fe8c0f35693a66d0f3ec2abda36c3c610d58c3bce4e6cd5c4b4822acb12f5137`, embeddedledgerSHA `236b6b1e39a007ef7b15368588985cf63878186c0a9eb679ef3d81161050823f`. Snapshot có thể đổi theo PM projection refresh; reviewer không regenerate/sửa artifact.

Gate chấp nhận **offline tracking artifact** sau fix; không phải release gate Crew/Paperclip hoặc API/DB product certification. PM owns state/status/ledger transition. Không còn câu hỏi chặn scoped artifact review.
