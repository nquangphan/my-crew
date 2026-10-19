# Phase00 — Brief theo context group

Source authority: [spec](../../docs/superpowers/specs/2026-10-05-crew-v3-paperclip-design.md), [roadmap](plan.md), [reuse](v2-reuse.md), [progress](progress.md). Runtime policy: [tro-ly-pm](../../.agents/skills/tro-ly-pm/SKILL.md). Quy định primary repo áp dụng cho mọi Markdown report.

## 00-01 — Core baseline và seam survey

Deliverable: `baseline.md` và `phase-00-core-findings.md` trong thư mục plan này. Context group core; uncertainty3/coupling2/impact2 =8, A high vì authority/scheduler cần quyết định kiến trúc. Read-only remote/source khảo sát; không chạy service/DB/migrate hoặc fork external ở task này.

1. Xác minh official repo/license/default branch, stable releases và tag→full SHA bằng nguồn chính thức, ghi checked date và URLs. Chọn baseline cùng predecessor stable cho upgrade rehearsal; release availability không suy đoán từ ngày hệ thống.
2. Đọc pinned source/package/lockfile/toolchain và adapter execute/cancel/session/testEnvironment contract. Ghi exact paths/signatures/line refs, đừng coi master docs đúng release.
3. Trace mutation issue done, scheduler spawn/admission, runtime session/log/result, project workspace auth. Đọc source trước kết luận SDK hook đủ; chỉ observer sau commit không giữ pre-mutation/pre-spawn gates.
4. Ghi seam sufficiency hoặc đề xuất patch hẹp, actual package paths và risk/contract tests. Tách remote transport/gateway và scheduler authority.
5. Test acceptance cho survey: mọi seam conclusion có exact commit/source supporting evidence; gaps/inaccessible evidence rõ. PM chuyển independent review trước 00-03.

Ownership: chỉ2 report file trên. Scratch source checkout read-only phải đăng ký path/size và không có background processes. Không install deps hoặc spawn agents. Reviewer độc lập quyết định findings; worker tiếp tục context core sau gate.

## 00-02 — Reuse map và context-oriented task refinement

Deliverable: `implementation-map.md` và `phase-00-reuse-findings.md`. Context group reuse; uncertainty2/coupling2/impact1 =6, S medium vì kiểm kê source đa module đã có scope.

Source read-only: `/Users/phannhatquang/.codex/worktrees/crew-v2-server/crew` branch codex/crew-v2-server at full SHA51907858d0c8cdb7329759f22104f0727dbe6751. Đọc docs index/flow trước source; nếu .codegraph tồn tại dùng CodeGraph trước search source. Không index/build/DB/source mutations.

1. Kiểm exact source files/test files/exports cho từng category trong reuse inventory; map source full SHA và current file paths. Tách code hoàn thiện khỏi schema/stub/evidence chưa đạt.
2. Chọn initial pure-policy/docs/gateway primitives có thể port; liệt kê dependencies trên actor/ticket/attempt/schema cũ cần adapter, không copy scheduler/SQL authority.
3. Mỗi context group có đề xuất task nhỏ đủ review riêng, file ownership/test setup chung, difficulty components, exact allowed model/effort, dependencies và reason serialize/parallel. Không viết lại toàn bộ roadmap/filepaths upstream khi chưa baseline.
4. Giữ known gaps từ handover/findings; nêu tối thiểu test cần re-run candidate, historical PASS không dùng cho v3.
5. Điểm acceptance: danh mục nguồn/test tồn tại, retained logic vs changed connection vs new work rõ; map đích upstream provisional tới 00-01 gate. Không claim reuse phần trăm từ LOC.

Ownership: chỉ2 report file trên; không sửa shared ledger hoặc roadmap. Không heavy test/dep install/agents/commit. Report path và tóm tắt≤200 words.

## Sau hai review

00-03 chỉ dispatch sau baseline được kiểm: PM tạo fork/checkout nhánh v3 theo authorization owner, log remote/fullSHA và chạy baseline checks đã đọc. Worker core nhận delta/path/context từ00-01, không spawn lại để đọc cùng source. Source modifications chỉ fork checkout v3; authored Markdown ở primary plans/docs.

00-04 cần exact implementation brief lấy seam/read source thật: failing contract test→minimal outbound remote execution→session/cancel/replay test→process proof→review. Không làm fake adapter local gọi function rồi claim gateway Mac. DB sandbox phải backup trước mutation, process owner/ports logged, install/build heavy serialized.

00-05 freeze patch/contracts rồi tạo detailed Phase01/02 implementation plans. Chưa đạt remote/gate proof thì ghi blocked, không đánh Phase00 complete.
