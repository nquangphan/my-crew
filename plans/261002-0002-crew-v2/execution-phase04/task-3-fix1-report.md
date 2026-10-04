# Phase04 Task3 FIX1 — Deadline qua workspace barrier

Status: **DONE_WITH_CONCERNS — I1 đã sửa và kiểm chứng; chờ independent review. Không cấp production/native certification.** Wave1/5.

Review đã đọc toàn bộ: `task-3-review.md`, SHA256 `09064496b01bd6a44a3da22d1aa86b3e34a40c57645ea1e35f9ab24092e00d0f`. Candidate được review `d438ce1`; HEAD lúc dispatch `cf68a68` có accepted peer access FIX2 được giữ nguyên. Không Git/index/commit, không child, không sửa bridge/workspace/registry/native/model/API/schema/shared service. Historical report/evidence không sửa. Evidence mới riêng tại `task-3-fix1-evidence`.

## I1 — Sửa consumer-local

`RuntimeIsolation.withVerified` vẫn capture observer trước isolation queue. Sau actual `withPrepared` verification và identity match, kiểm deadline trên captured observation ngay trước action; await action/fsync rồi kiểm lại deadline trước return. `assertFresh` là phép kiểm thuần cho cả admitted challenge và certified receipt, không gọi observer lại, không gia hạn expiry/budget và không re-enter store. Expired sau fsync throw `ADMISSION_EXPIRED` hoặc `CERTIFICATE_EXPIRED`; không xóa immutable companion hoặc guard. Existing bridge propagation giữ RELEASE đóng khi callback throw; producer không đổi.

Owned FIX1 chỉ bốn file: `v2/gateway/src/runtime/isolation.ts`, `v2/gateway/test/runtime-workspace.test.ts`, `v2/gateway/test/effect-ledger.test.ts`, `v2/docs/flows/gateway-runtime.md`. Runtime flow giữ đúng bảy H2 chuẩn. SHA/bytes cuối trong `owned-final-sha.json`.

## Regression và RED thực tế

Test mới dùng actual `IsolationWorkspace.prepareWorkspace/withPrepared/verify` trên actual owned Git/API projection, không mock prepared service. Queue latch giữ callback của producer thật; observer trả deadline còn hạn, microtasks validation chạy xong, controlled `Date.now` tiến đến đúng deadline rồi nhả queue. Cả admitted challenge và certified receipt phải deny trước action. Hai case khác ghi actual `writeExclusiveRecord` (file+directory fsync) rồi advance clock; caller phải nhận rejection và bytes companion vẫn nguyên. Mỗi case kiểm observer chỉ gọi một lần. Certificate là protocol-only fixture để kiểm branch, không phải native PASS.

RED chỉ overlay test vào immutable accepted gateway `d438ce1`; production consumer SHA trước sửa `6fabc84f98127466fed5ad1a864e2fc199aee6461a60927bff16936c0cbbafa6`. Command `node --test --test-name-pattern=captured authority deadline test/runtime-workspace.test.ts` cho **bốn expected Missing expected rejection**, Node summary5fail gồm bốn children + parent,0pass,exit1,4373.8405ms. Test fixture đóng và cleanup. Đây là meaningful pre-fix RED, không nhập vào current PASS.

## Current verification riêng

Frozen snapshot từ accepted gateway `d438ce1` cộng đúng ba source/test edits FIX1. `base-comparison.json` kiểm125 tracked/captured files, chỉ ba expected differences,0missing; source stability125files drift0. Source trong worktree khớp tested snapshot; docs hoàn tất sau cover, không source edit sau cover.

| Exact command trong frozen root | Kết quả |
|---|---|
| `pnpm --dir v2/gateway build` | exit0 |
| `pnpm --dir v2/gateway exec tsc --noEmit -p test/support/runtime-typecheck.json` | strict exit0 |
| `node --test --test-concurrency=1 test/runtime-workspace.test.ts test/runtime-boundary.test.ts test/isolation-runtime.test.ts test/effect-ledger.test.ts` (cwd `v2/gateway`) | **20/20 PASS**,0fail/skip/cancel,14086.718875ms,exit0 |
| `pnpm exec biome check v2/gateway/src/runtime/isolation.ts v2/gateway/test/runtime-workspace.test.ts v2/gateway/test/effect-ledger.test.ts` | exit0,3files,0fix/warning |

Không rerun historical22/105 hoặc launcher SIGKILL; không cộng thành unionPASS. Current20 bao gồm bốn new expiry subtests và parent, actual workspace mismatch/cleanup race, actual bridge callback denial/authorization-null/no duplicate launch, isolation policy/default-deny và effect ledger regressions. New expiry post-fsync test dùng actual exclusive record action; existing bridge tests chứng minh callback throw chặn RELEASE. Không tự nhận đã có new end-to-end native authority expiry certificate.

## Resource và closure

PM cấp sole heavy slot sau Assistant RED closure. Fresh gates trước snapshot/overlay/mỗi runner đều pressure1, available6,131,990,528–6,244,057,088 bytes, idle71.34–89.9%, disk~32.8GiB; đạt threshold1/2 + ≥4GiB + ≥50%idle + ≥8GiBdisk. `resource-gates.jsonl` giữ từng sample. Sequential host fixture, `NODE_OPTIONS=--max-old-space-size=384`, không PG/container/provider/paid model. Heap384 không phải RSS/full-tree cap; memory actual native preparation helper chưa được certified.

- Snapshot nonce `9c10d7c3-e76e-41a4-8dae-601763f42ef5`; exact root/dev/inode/UID trong `root.json`, giữ làm reviewer snapshot.
- RED PID98490/start17:03:09 waited exit1; buildPID200/start17:03:54, strict232/start17:03:55, cover252/start17:03:56 waited exit0. PID wrap không bị diễn giải thành ownership; exact argv/cwd/start/exit ở red/green commands JSON.
- **10 logged roots,10absent** sau producer close và fixture identity-checked cleanup;0process references tới fixtures/snapshot. Native argv/stageIdentity/receipt có trong original logs. `resource-closure.json` giữ audit. Không container tạo mới; mọi historical UNKNOWN roots giữ nguyên, không TTL/prune/PID guess.
- Sole heavy slot trả PM ngay khi cover/process closure xong; phần còn lại chỉ report/docs/Biome/hash.

## M1 và giới hạn bằng chứng

Đổi tên test thành `effect ledger orderly reopen keeps pending effects waiting without target proof`, giữ nguyên assertions. Actual ledger SIGKILL sau side effect/trước receipt chưa có và vẫn pending; launcher SIGKILL ở wave trước là bằng chứng riêng. Không mở thêm heavy child matrix trong FIX1.

Actual trusted admission/certificate producer, host composition, official entrypoint catalogue, stable Phase06 logical-operation authority và full-tree native certification vẫn chưa có, mặc định wait/deny. I1 không thay đổi các gates này. Minor doc patch attempt đầu không khớp context và không đổi file; sửa lại context thành công, không test/source failure phát sinh. Biome format trước freeze sửa một test file; finalcheck không đổi bytes. Không có unexpected RED/GREEN fixture/build/type failure trong wave.

Đề nghị PM review lại FIX1 trên exact owned SHA, đối chiếu I1 và M1; PM sở hữu mapping/commit/acceptance.
