# Phase08 plan self-review

**Disposition:** READY for independent plan review; không phải implementation/runtime/deployment READY.
**Plan:** `plans/261002-0002-crew-v2/phase-08-integration-docs-gates.md`, 267 lines.
**Plan SHA256:** `742f82b64ce2dba98afcb43db017dbd6e667e945803717e0974c78a0069d549f`.
**Research:** `plans/reports/research-261002-crew-v2-integration.md`, SHA256 `c71d3d707ddd0662d814d878abc026af346a516fed9328fc12ef0e18313e4d94`.
**Baseline:** `6b76ead`; frozen06-r3 SHA `547ce65c865dffd9fec9a7c71f0c38735566d314c007cb74a8f217f5f19795aa`, actual005 `9dca04e`; final006 review/checksum remains producer gate.

## Coverage tự kiểm

| Spec/brief | Plan lines | Task/check |
|---|---|---|
| Official workflow gates, task + global + docs review | 177–190 | T3 exact candidate/hash + reviewer independence; no custom runtime prompt |
| Current target/source and actual merged commit | 141–145,164–175,192–206 | T2 precreated candidate + trusted source collector; T4 current CAS |
| Crash after ref mutation/before result | 192–206 | fsynced effect journal/receipt ref; real host/server restart and actual ref transitions |
| Immutable006 snapshot/receipt with011 attestation | 108–139,208–221 | original audit/bytes unchanged; exact per-attempt input/receipt binding |
| Source existence/content proof | 57–106,164–175 | actual Git blob manifest, separate006 paths hash; deny symlink/escape |
| Correct raw versus derived reads/completion | 208–221,237–247 | separate DocsState reader, expectedCommit equality, reviewed current evidence selector |
| Sync retry and5min monitor | 223–235 | stable011 command/operation, existing06 monitor, no rereview unchanged docs |
| Pause/cancel/native UNKNOWN/resource cleanup | 13–21,192–206,223–235 | no lease-only release; process-tree stop proof, retain artifacts/dirty paths |
| Deploy exact approval and09 handoff | 14,247 | unchanged004 fingerprint; no push/deploy implied |
| Actual producer/consumer acceptance and backup | 237–247 | real HTTP/private DB/Git/process/restart;011 backup restore; independent whole-phase review |

## Type/persistence/wire self-check

- Observation discriminator is a typed union and included with nonce in signature canonicalization; no loose kind/payload pairing.
- Candidate binds sourceRef, targetRef, both OIDs, exact pre-created merge/tree/parents, scope/fence/input/policy/workflow and manifests.
- Challenge issuance/receipt replay/target reservation have named011 persistence; receipt identities survive fallback via logical effect ID.
- FinalEvidencePort and DocsCompletionReader public signatures unchanged; current-evidence selector is explicitly proposed internal handoff requiring producer review, not claimed existing API.
- DocsSync unchanged; trusted docs_verification evidence exists before006 sync; attestation joins exact immutable receipt plus stored raw bytes and independently produced source/test/review/merge evidence.
- `latest_verified_snapshot_id` never points at raw-unverified snapshot to fake promotion. Raw stored state is distinct from011 derived state.
- Source path-list hash006 does not claim byte-tree integrity; full SourceProof content manifest fills that proof explicitly.
- Authenticated machine cannot mint trust: controlled observer enrollment and measured key/journal/ref isolation gate remains fail-closed; fake fixture verifier is never production readiness.

## Kiểm chứng đã chạy trong lượt planning

- Placeholder scan `rg -n 'TBD|TODO|implement later|fill in details|appropriate error handling|Similar to Task|boolean.*PASS' <plan>`: không có match.
- `wc -l`: plan267, research45; plan nằm target250–350.
- `shasum -a 256` plan/research: hashes ở đầu report.
- `git diff --no-index --check /dev/null <plan-or-research>`: không whitespace diagnostic; exit1 do file mới có diff, không gọi exit0/PASS giả.
- Không application test, migration, model, live call hoặc Git mutation trong lượt planning. Các test RED/GREEN trong plan là yêu cầu tương lai.
- Write ownership chỉ plan, research, self-review này. Giữ nguyên peer source/docsfix/gateway edits, không stage/commit/subagent.

## Các gap giữ công khai cho independent reviewer/PM

1. Final006 F1/F2 và02Task7 chưa reviewed final ở thời điểm lập plan; receipt/provenance contracts dùng handoff được cung cấp, không đọc file peer đang thay đổi.
2. Actual03–06 implementation/certification/constructor signatures phải kiểm lại trước consumer integration; UNKNOWN native descendants không có workaround authority.
3. Narrow internal current-evidence selector + Task7 raw/derived reader + unresolved target reservation binding guard cần producer ownership approval. Plan nêu đề xuất signature và regression cụ thể; không tự rewrite frozen producer.
4. Managed target protection/trusted observer admission và durability trên shipped Git phải có actual measurement. Thiếu boundary vẫn503/UNKNOWN, không production auto-merge.
5. Deterministic official review fixtures test admission/provenance; không chứng minh live semantic quality hay model hiểu code/docs. Không có live acceptance claim.
