# Task 1 — FIX1/5 source freeze và bàn giao review

**SOURCE_FROZEN_FOR_SCOPED_INDEPENDENT_REVIEW.** Hai P2 của full review đã có sửa và regression. Chưa Task1 accepted; covering giữ một lỗi test transport, native whole case đã PASS riêng. Không gọi hợp các lần chạy là covering PASS; chưa có system/isolation/recovery certification.

Baseline full review `f58f27dc96b964d034697a67c5677fb1d3bbacb2`, findings trong `task-1-review.md`. Worker chỉ sửa staging, own staging tests và R3 server-attachments; không Git stage/commit, tạo worktree/subagent, sửa package/dependency/manifest/HTTP fixture/frozen001–009/peer source. Wave1/5; interruption fixture không phải review failure. Original Task1 report/inventory/evidence/cleanup giữ nguyên, SHA trong evidence FIX1. PM serialize staged docs và scoped independent review.

## Phản hồi đầy đủ findings

**F1 — ready PUT replay wall/abort/cleanup.** Replay dùng accepted uploadMaxWallMs lưu lúc reserve thay vì current factory policy. Monotonic deadline, timer và caller abort kiểm từng next, original verification, cleanup và trước success. Deadline trả409 ATTACHMENT_UPLOAD_TIMEOUT; caller abort trả409 ATTACHMENT_ABORTED. Timer/listener được dọn; original, receiver/generation, quota và event giữ nguyên.

Bounded request result tách khỏi bằng chứng teardown. WeakMap theo DB, registry theo upload giữ exact operation identity, pending next/verify và iterator.return trong cleanup handle có rejection observer. Cooperative producer thực sự đóng trước retry. Noncooperative producer timeout vẫn giữ BUSY409; fresh factory cùng DB không nhận replay mới; barrier mở → actual finally/return settle → exact operation được xóa → retry thành công. Return thiếu/thất bại hoặc không chứng minh done giữ unknown/BUSY, không tự TTL/STOP/ACK/quota release. Không nhận late data thành success hoặc bỏ untracked read. Registry trong process theo cùng Db object; recovery giữa process/lifetime thuộc Task7.

**F2 — decoded EOF prefix/flush.** Một validator control chung chạy trên mọi decoded text: streaming output, EOF short prefix và fatal decoder flush. Tất cả29 control thấp ngoài tab/LF/CR, gồm một byte01, bị415 trước publication. EOF UTF8 C3 và UTF16 FFFE01 dở dang bị fatal decode reject. Empty, ASCII, tab/LF/CR và valid split UTF16 vẫn được nhận. Rejected upload giữ terminal receiver proof/quota, không có original.

## Source freeze

`task-1-fix1-source-inventory.json` ghi toàn bộ16 file Task1: own3 mới, other13 vẫn bằng baseline f58/original inventory. Checksum008 `d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f`;009 `fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a`, không đổi. Backup/restore/drift regression hiện có chạy lại trong pinned cover; không sửa migration.

| Path | SHA256 | Bytes |
|---|---|---|
| `v2/server/src/attachments/staging.ts` | `8472c49eb19ae9acf679718f079aacdbe256f1ace82bae656461692c162de7ee` |31433|
| `v2/server/test/attachments-staging.test.ts` | `2375711bff9f89dc0e69f03f5ca58f587b18481a8b3a78bb7b2855c41ef85493` |37395|
| `v2/docs/flows/server-attachments.md` | `d1aeaa17a4a272cb80f425fbcde9cde1f8c5eee46e5e08587c3b70a783d0a460` |9114|

## Kiểm thử và lịch sử failure

Commands tuyệt đối, exits, counts và log SHA nằm `task-1-fix1-evidence.json`; logs không bị ghi đè.

| Evidence trong logs/ | Exit / kết quả |
|---|---|
| `fix1-red.log` |143: fixture RED đầu có watchdog đặt sai, stall sau first chunk; SIGTERM exact owned runner PID86028; PG/root cleanup proof riêng |
| `fix1-red-bounded.log` |1:2total0pass2fail, bắt đúng missing wall timeout và accepted control01 |
| `fix1-green-first.log` |0:2/2 focused GREEN |
| `fix1-focused.log` |0:5/5 actualPG, saved policy/cooperative stall/noncooperative BUSY/abort/verify stall/EOF controls; final malformed EOF/test-finally refinements chạy trong frozen cover |
| `fix1-native.log` |0:1/1 actual Linux privatePG FIX1: timeout→BUSY→actual finally→retry, exact birth/ACK reject01/C3/FFFE01, positive empty/ASCII/tabLFCR/splitUTF16 |
| `fix1-typecheck-final.log`, `fix1-isolated-typecheck.log` |0, strict typecheck own source và isolated reviewed f58+own3 |
| `fix1-biome-check.log` |0,2files, no diagnostics/no fixes |
| `fix1-server-cover.log` |1:258total255pass1fail2platformskips,53.999s; exact27files through009. All five FIX1, backup/restore/drift và boundedHTTP repaired case PASS. Sole failure native cannot resolve postgres in snapshot-only mount |
| `fix1-isolated-native-green.log` |0:1/1 whole failed native case sau approved testtransport canonical correction; direct closedACK replay và actual inflight abort/held quota PASS riêng |

Không broad rerun chỉ để xanh sau launcher-only correction, theo ruling PM. Cover vẫn FAIL258/255/1/2; focused1/1 là kết quả riêng. Exact27 filenames và từng SHA nằm `task-1-fix1-cover-inventory.json`, wrapper đã lưu trong `task-1-fix1-cover-wrapper.mjs`; không automatic enumeration/unfinished model-current-credentials test.

## Frozen checkout và test transport

Peer model source đang active nên không import shared dirty source. Readonly git archive f58:v2 + exact own3 overlay,231 file SHA trước/sau, exact27 imports. Normal pnpm/ancestor dependency resolution, không dependency copies/symlinks/install. Archive extraction lần đầu gặp unsupported Python filter trước bất cứ member nào; exact nonce/dev/ino/UID root được kiểm rồi hoàn tất bằng member path/type validation. Creation evidence giữ riêng.

Linux native baseline helper mount snapshot-only nên mất ancestor dependencies. PM giao evidence-only transparent launcher; initial match thiếu canonical trailing slash, invocation được forward unchanged và thất bại thật. Corrected launcher chỉ nhận exact validated native Docker create với immutable image/privatePG/full64hex/network/capdrop/readonly/tmpfs/CPU/memory/pids. Nó chỉ đổi readonly mount full checkout và working directory vào exact frozen snapshot để tìm ancestor deps; relative source imports vẫn reviewed f58+own3. Original/transformed argv trong fix1-docker-launcher.jsonl; saved scripts và hashes giữ riêng, không eval. Unexpected calls forward unchanged; không sửa production/test-support. Focused whole native case đạt trên cùng frozen bytes. Mount này là test-only dependency transport, không chứng nhận extraction sandbox.

## Resource và cleanup

Official immutable Node24.12.0 image `sha256:929c026d5a4e4a59685b3c1dbc1a8c3eb090aa95373d3a4fd668daa2493c8331` được giữ trong cache. Native256MiB/1CPU/pids32/read-only/capdropALL/tmpfs64MiB, private PG network namespace + random loopback controlled connection; không sharedDB/v1 port/ownersecret/paidmodel/globalHOME/keychain/nativepermission/service. PM sampled15:57 RAM37%free CPU63.56%idle39GiB,15:59 RAM39%free66.93%idle39GiB; không suy đây là resource certification.

`task-1-fix1-cleanup.json`:7 exact logged full native/PG IDs inspect exit1 no such object; không global container delta/shortID deletion.32 scratch roots có created/removed hoặc manual interrupted fixture exact nonce/dev/ino proof; host roots absent, Linux roots remove trước tmpfs container removal. Private PG runner không xuất ID có cleanup trong finally, không được tính vào7 external inspections. Snapshot231 SHA unchanged/childrenclosed rồi kiểm nonce/dev/ino/UID trước chỉ chmod own dirs và xóa exact root. Launcher folder cùng identity check rồi xóa; saved evidence script giữ lại. Không prune shared image.

PreToolUse context hook chặn compiled docs bundle access; không sửa .ckignore hay bypass. R3 server-attachments đã cập nhật, existing mapping không đổi; PM staged docs check vẫn là bước serialize trước commit/review. Hook còn false-positive trên prose report nhắc compiled output path; worker chuyển ghi evidence bình thường, không truy cập path bị chặn.

## Bàn giao

Required public interfaces giữ nguyên; không producer route/public API/access/extractor work ngoài scope. Reviewer kiểm own3 diff so với f58, tracked unknown/BUSY teardown và EOF validator, cùng failure/native transport evidence. Original Task1 report giữ đầy đủ schema/storage/lifecycle/backup handoff; FIX1 report này bổ sung, không thay bản frozen ban đầu. PM quyết định scoped SPEC+QUALITY READY trước Task1 acceptance/commit.
