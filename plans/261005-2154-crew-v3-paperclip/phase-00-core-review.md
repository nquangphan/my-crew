# Review độc lập Phase00-01 — baseline và core seams

Ngày 05/10/2026, Asia/Ho_Chi_Minh. Reviewer độc lập `v3_core_review` (`01a10cc9-3a2d-74e3-85d5-e9da4775fd96`), score8 = 1+U3+C2+I2, gpt-6-astra/high theo dispatch. Áp dụng `.agents/skills/tro-ly-pm/SKILL.md`. Chỉ sở hữu report này; không sửa source, baseline/findings, ledger, không install/test/DB/commit hoặc spawn agent. Admission resource/quota do PM cấp ở brief22:57; review chỉ đọc nguồn và hash, không heavy job.

## Kết luận gate

**Source baseline READY cho 00-03 tạo fork/checkout độc lập.** Không có blocker về stable tag, full SHA, license hoặc toolchain đã chọn. Review khảo sát nguồn đạt phạm vi nhận diện seam và nêu rõ giới hạn; hai sửa báo cáo dưới đây cần mang vào delta của worker trước detailed prototype brief. Chúng không đòi thay baseline hoặc trì hoãn checkout.

**Phase00 tổng thể / prototype / freeze patch set NOT READY.** Chưa có dependency installation, baseline test run, API/DB/gateway Mac process proof, restart adoption, workspace proof hoặc exhaustive writer/dispatch inventory. Không biến review báo cáo thành chứng nhận các gate này; cũng không yêu cầu prototype PASS mới cho phép checkout baseline.

## Findings cần sửa

### F1 — P2: token là capability có điều kiện, không tự động được cấp

`phase-00-core-findings.md` §6 viết “Adapter nhận authToken run-scoped từ core”. Source `server/src/services/heartbeat.ts:23686–23717` chỉ gọi `createLocalAgentJwt(...)` khi runtime là legacy **và** adapter đặt `supportsLocalAgentJwt`; thiếu/invalid signing secret thì log warning và tiếp tục không token. Contract `packages/adapter-utils/src/types.ts:235,462` đều optional.

Sửa cụ thể: ghi rõ các điều kiện trên, thêm `supportsLocalAgentJwt` vào quyết định cấu hình prototype nếu cần Paperclip API access, và kiểm token hiện diện/phạm vi bằng contract test. Gateway device credential vẫn là cơ chế riêng, không dùng JWT agent thay pairing/machine authority. Prototype phải fail closed khi tác vụ đòi token nhưng không có. Không khẳng định token luôn hiện diện hoặc tự cấp quyền machine/project từ optional context.

### F2 — P3: chuẩn hóa exact path và line anchors

`baseline.md` hàng native runner chỉ ghi `rust-toolchain.toml`, dễ hiểu nhầm ở root. Exact path là `packages/paperclip-runner/rust-toolchain.toml:1–4`; root không có file này.

`phase-00-core-findings.md` §3 line ranges lệch: row lock thực ở `issues.ts:10781–10787`, agent-only done check ở `:10788–10790`, SQL update ở `:10837–10842`. §5 `locallyTracked` thực ở `heartbeat.ts:19017–19020`. Sửa anchors tới exact đoạn này; nội dung kết luận không đổi. Các đường dẫn code quan trọng đã kiểm đều tồn tại; `crew/remote-adapter` được đánh dấu path mới đúng cách, không phải upstream path bịa.

## Evidence reviewer kiểm độc lập

Nguồn code duy nhất: `paperclipai/paperclip@8f8a0ab7effbd6a0584107d8038736c134ee5047` tại scratch đã đăng ký của plan. Scratch không có `.codegraph`; không index hoặc quét toàn repo. Đã đọc docs index/brief/plan trước nguồn.

- Live GitHub API `releases/latest` trả `v2026.1001.0`, published `2026-10-02T01:54:00Z`, draft/prerelease=false. API `releases/tags/v2026.916.1` trả published `2026-09-21T21:22:44Z`, draft/prerelease=false. Saved official refs xác nhận hai commit lần lượt `8f8a0ab7effbd6a0584107d8038736c134ee5047` và `d554c4789ed3930f8a53ac9fdf6503b3187097da`, type commit. Saved recursive tree có SHA đúng baseline, truncated=false.
- Tự tính lại SHA256 archive=`469619fe6f4452fee0ffac721de68d1a397fde8571a32cbabac19f25487ca58c`; lockfile=`d7d96cf0d98cf0946f6195e29ba173b03711a947a1c38f312b67cda56c254c22`, đều khớp report.
- Tự tính Git blob SHA1 của15 file đại diện so với saved official tree: LICENSE, root package, lockfile, plugin SDK package, adapter types, heartbeat, issues, native status committer, plugin loader, activity log, Rust toolchain, native runner package, legacy recovery, execution-target, agent-auth-jwt; **15/15 trùng**. Đây là integrity/source checks, không là test runtime.
- `LICENSE` là MIT, copyright2025 Paperclip AI, phải giữ notice. Root manifest thực ghi Node>=24.11.0, pnpm9.15.4, TypeScript^7.0.2/Vitest^4.1.11/Playwright^1.62.1. Rust toolchain1.97.1. SDK1.0.0 và adapter-utils0.3.1 đúng package; **version1.0.0 không chứng minh stable extension API**. Report hiện đã tránh suy luận đó.

Các endpoint chính thức: [latest](https://api.github.com/repos/paperclipai/paperclip/releases/latest), [predecessor](https://api.github.com/repos/paperclipai/paperclip/releases/tags/v2026.916.1), [pinned source](https://github.com/paperclipai/paperclip/tree/8f8a0ab7effbd6a0584107d8038736c134ee5047).

## Đánh giá dangerous paths đã đọc

| Miền | Exact evidence ở pinned source | Kết luận review |
|---|---|---|
| Adapter/load/cancel | `adapter-utils/src/types.ts:197–235,453–462`; `server/src/adapters/plugin-loader.ts:149–203`; `heartbeat.ts:24277–24353` | Factory đồng bộ, execute Promise, optional cancellation callback/signal và onDispatch notification được mô tả đúng. Không có giả định module.cancel(). StopRemoteStartup hiện chỉ được host cấp cho remote sandbox; custom outbound không tự có stop helper này. |
| Admission | `heartbeat.ts:17124–17255,19700–19735,19930–19963,22178–22230,24277–24357` | Per-agent capacity chưa là machine reservation. Direct queued execute gọi claim. Dispatch helper có bypass nhánh interaction gate nhưng vẫn kiểm controller/chat; chưa là Crew general gate. Report đề xuất cả claim reservation và dispatch recheck đúng hướng, không claim exhaustive native coverage. |
| Mutation | `issues.ts:10777–10842`; `native-runtime/status-decision-committer.ts:1837–1888` | Actor-null native status projection thực gọi service trong tx. Actor-only gate sai; guard phải dùng locked current row. Native effects chạy trong cùng tx trước projection, nên rollback/no-side-effect tests là bắt buộc. Update-only không chứng minh no-bypass; report đã nêu create và inventory còn mở. |
| Event | `activity-log.ts:45–51,151–163,219–228` | emit fire-and-forget, lỗi bị catch; không thể dùng observer làm transaction veto. Report chỉ kết luận các seam đã đọc, không tuyên bố toàn SDK không có hook khác. |
| Restart/cancel/session | `heartbeat.ts:19017–19020,19063–19086,19137–19147,25214–25253,28666–28717`; `legacy-execution-recovery.ts:14–48` | Legacy live controller check không là generic remote adoption. Reaper có thể fail process_lost sau lease expiry; session persistence không chứng minh reconnect run. P3 là proposal cần proof, không acceptance. Mac PID không được giả làm server PID. |
| Workspace | `heartbeat.ts:22115–22162`; `adapter-utils/src/execution-target.ts:131–143,235–238` | Core realization đi trước adapter và target union chưa có outbound-machine. Plugin environment driver khả dụng hay cần P4 vẫn là câu hỏi kỹ thuật; report giữ provisional phù hợp. |

## Handoff và giới hạn

Worker core sửa F1/F2 trong hai report sở hữu, rồi PM đối chiếu delta. 00-03 có thể checkout exact SHA và chuẩn bị toolchain sau admission riêng; không chạy nguyên bộ baseline/native tests song song chỉ vì source review PASS. 00-04 phải lập brief riêng cho workspace, auth, reservation, mutation rollback và remote recovery/process-stop proof. Giữ một run/scheduler authority, không tạo queue Crew thứ hai.

Không chạy unit/integration/native/browser; không claim suites pass. Không tạo process nền/service/DB; các lệnh HTTP bounded đã kết thúc. Một lượt kiểm path ban đầu dùng nhầm root rust-toolchain và nested legacy recovery; đã sửa sang actual paths, hash kiểm lại thành công. Không dùng kết quả failed probe làm finding file thiếu upstream.

Unresolved Qs: môi trường outbound cho repo chỉ có trên Mac; inventory writers và native warm dispatch; durable same-run adoption. Đây là gates kế tiếp, không có câu hỏi sản phẩm cần owner quyết định ở review này.

## Scoped re-review F1/F2 — 23:04 admission

PM admission: free41%, load4.88, disk61GiB, quota10%, hard reserve1%/soft3%; light report-only review. Chỉ đọc delta F1/F2 trong `baseline.md` và `phase-00-core-findings.md`, đối chiếu thêm đoạn JWT config/mint ở pinned `server/src/agent-auth-jwt.ts:39–44,122–160`; không lặp toàn audit hoặc chạy tests.

- **F1/P2 ADDRESSED.** Findings §1/§6 đã ghi capability `supportsLocalAgentJwt`, legacy-only branch, optional token và thiếu signing config trả null; tách agent JWT khỏi device pairing/machine/project authority. Matrix test còn là đề xuất, yêu cầu fail closed trước dispatch/spawn khi API task thiếu token và verify token bằng API thật; không claim test đã chạy. Mô tả claims, secret fallback và derived signing key khớp source đã đọc.
- **F2/P3 ADDRESSED.** Baseline dùng exact `packages/paperclip-runner/rust-toolchain.toml:1–4`; mutation và locallyTracked anchors đã sửa đúng các đoạn reviewer xác minh ở round1.

**Scoped verdict: PASS, 0 finding F1/F2 còn mở. Source baseline tiếp tục READY cho 00-03. Phase00/prototype/freeze patch set vẫn NOT READY** cho tới các proof/gate đã liệt kê; không có thay đổi phạm vi acceptance. Handoff sửa F1/F2 ở phần trên được thay bằng verdict này. Không sửa report khác, không deps/DB/test/agent/commit/process mới.
