# Re-review độc lập Phase03 Task4 — FIX2/5

**Spec READY: YES. Quality READY: YES. Overall READY: YES trong phạm vi NEW P1 admission/GC và diff FIX2.** Finding được đóng; không có blocking finding mới. READY này dành cho producer local, không phải runtime/source-isolation certificate hay quyền dispatch/model.

Candidate `ea8ff3b`, previous `b1172c8`. Exact source-scoped package: **9 files / 78952 B**, SHA-256 `42a50186b5207069ba755a1e7a8ea3e9b3be9767f0fc384075a214839f8ff6ce`. Inventory SHA-256 `d9102bb9aad003db6c36094b5331d549aab6bf06b88a25b0f0f8930aa7b7efb2`: **41/41** current files khớp bytes/mode/SHA-256; evidence **17/17** khớp bytes/SHA-256. So FIX1 chỉ thay/add hai flow, ProcessJournal, registry, retention, admission test/crash support; artifacts/pins/hash formulas, AtomicRecords/native/launcher/005/007 không đổi. Peer model/attachment changes ngoài package không thuộc review.

Đã đọc binding finding/proof trong `task-4-re-review.md`, FIX2 brief/ruling/full report, original brief/report trong context trước, docs index/hai flow trước source và toàn additive source/test/support. Original artifact/cancellation disposition đã ADDRESSED giữ nguyên; không lặp recipe/native runtime review.

## 1. NEW P1 — ADDRESSED

**Finding:** reserve commit durable exact pair sau reference snapshot nhưng trước GC quarantine/delete, khiến reference trỏ tới projection đã mất.

**Vị trí fix:** `v2/gateway/src/journal/process-journal.ts:100–135,162–214`; `v2/gateway/src/workflows/registry.ts:120–159,350–408,728–749,801–865`.

GC và recovered reclaim giữ registry queue rồi `withPinAdmissionBarrier`, tức **cùng ProcessJournal store transaction** mà managed `reserve` bắt buộc tham gia. Barrier bao trùm snapshot, native quarantine, record update và actual delete; không dựa caller-retain hoặc re-read ngay trước unlink.

- **GC-first:** reserve chờ queue, rồi verify exact pair; pair đã quarantine/deleted thì reject trước intent/LaunchRecord. Ba saved GREEN boundaries snapshot/quarantine/delete đều ghi reservation `CHECKSUM_MISMATCH`, không delayed successful commit với missing projection.
- **Reserve-first:** verify → exclusive/fsynced admission intent → actual LaunchRecord fsync trong một transaction. GC chờ, rồi thấy actual record hoặc pending intent. Test pause actual commit chứng minh GC chưa xong, sau commit pair resolve được và cached replay cùng record.
- **Recovered quarantine:** barrier giữ xuyên recovered reference check/delete. Actual native quarantine trước SIGKILL rồi restart/reclaim chứng minh concurrent waiting reserve bị deny, không commit missing pair.

NEW P1 **ADDRESSED**; stage/retry/GC blocker còn mở ở FIX1 được đóng trong scope Task4. Accepted Task5 terminal-release producer gap giữ riêng.

## 2. Quality và recovery

Durable managed marker/binding, same private host root và active attached validator được kiểm trong journal queue. New/cached reserve unbound hoặc journal reopened chưa attach đều fail-closed; closed registry validator từ chối. Standalone behavior cũ chỉ tồn tại khi chưa có managed marker. Bind chờ transaction standalone đã vào trước marker, rồi GC thấy actual legacy record. Missing journal attachment từ chối published GC và giữ recovered publication quarantine; pure stage closure không cần fake terminal receipt.

Lock order thực tế **registry queue → journal queue**. Reserve validator chỉ readonly `resolve`, không lấy registry writer queue ngược lại. Callback/barrier là trusted application producer input; bound implementation không re-enter writer queue. Actual second writer/instance open cùng root bị OS guard từ chối; không suy ra cross-process shared writer support.

Intent ở riêng `admissions/<hash(commandId)>.json`, marker/binding ngoài hashed LaunchRecord enumeration; frozen LaunchInput/LaunchRecord fields và formatVersion1 giữ nguyên. Exclusive/no-follow/file+directory fsync dùng helper đã review. Unreadable/malformed canonical intent fail-closed. Pending intent có exact pair/measured bytes/reason `durable-pin-admission-intent`; exact committed LaunchInput chỉ dedupe sang actual process reference, không chứng minh stopped/finalized hay release bằng TTL/boolean.

Actual SIGKILL evidence bao phủ intent-before-commit, committed record và native quarantine. Reopen cần binding; pending intent/committed process ref giữ pair resolve được, retry commit thật. Không fake native stop/accepted005 receipt. Không phát hiện blocking correctness/security/compatibility breakage mới trong FIX2 diff.

## 3. Verification và ownership

Đã đọc captured meaningful RED **3/3** baseline races fail sau actual durable reservation; GREEN cùng ba boundaries deny an toàn. Focused **13/13** gồm chín admission tests và bốn prior operation/GC regressions; có reserve-first/cached replay/unbound/reopen/bind transition/writer exclusion/crash/recovered deletion. Boundary instrumentation không thay producer fsync/native operation.

Final producer covering **sau last production change**: build + **77/77**, fail/skip/cancel0, 76956.366959ms. Types exit0, Biome25files/no fixes/warnings. Sau covering chỉ thêm cleanup telemetry test, focused admission **9/9** chạy lại; production không đổi. Không yêu cầu rerun unchanged native C/recipe hay broad suites.

Reviewer chạy fresh inventory/diff hash checks và kiểm exact cleanup paths: **9/9 absent**; hai fork UNKNOWN roots `crew-task4-lifetime-F37RMp`/`crew-task4-lifetime-Iy5SIj` còn đúng dev/inode/UID (saved accounting48671B/root). Hai flow thực có đúng canonical seven headings. Không mismatch. Không extra narrow probe vì source/captured evidence đã giải quyết correctness question; không tạo scratch/process/model/native session, không source/Git/package/manifest/service mutation. Chỉ ghi báo cáo này.

## 4. Handoff / unresolved

Task5/Phase04 consumer phải mở ProcessJournal và `WorkflowRegistry.open(sameRoot,{processJournal:journal,...})`, giữ reviewed binding active trước managed reserve. Điều kiện được API thực thi qua marker/binding/validator. Genuine authenticated005-FINALIZED cùng exact attempt/fence/process/pair và actual local STOP vẫn cần producer release được review; chỉ xóa LaunchRecord để coi intent closed không đủ.

Historical acquisition/fork/evidence-cache uncertainty và hai fork UNKNOWN roots mới giữ nguyên. Source isolation, native Read/Bash/MCP/child/bootstrap/namespaced transitions/SDD/interpreter/compaction và API tool loop vẫn **UNVERIFIED/disabled**; BMAD Codex recipe/marketplace6.4.2 gates độc lập.

**Unresolved Qs:** Không cần owner/PM decision mới để đóng NEW P1/FIX2. Genuine finalization release và Phase04 certification là handoff ngoài scoped verdict này.
