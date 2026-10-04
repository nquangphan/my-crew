# Phase06/T3-D2 — định nghĩa workflow v2 ở gateway (BMAD hai tầng + digest customization chung)

Trạng thái: **DONE, chờ independent review**. Lát S3 theo memo PM `pm-next-slices-memo-261004.md` (A5.1, A6, S3). Base `d913052`, nhánh `codex/crew-v2-server`. Không chạy `uv`, renderer, DB, provider hay network.

## Thay đổi

- `v2/gateway/src/assistant/workflow-manifest.ts`
  - `WorkflowDefinition = {sha256, skills, customizationSha256, render?}`; `RenderDefinition = Omit<CapturedRenderExpectation, 'projectRoot' | 'generationRoot'>` = `{source, projection, selectedProjectionSha256, layers}`.
  - Hàm thuần `customizationContext(source, projection, layers)` trả `{context, sha256}`, với `sha256 = sha256(canonicalJson({schema: 'crew-v2:workflow-customization:1', workflow, sourceTreeSha256, projectionTreeSha256, layers}))`. Hàm validate lại hai pin, từ chối source/projection lệch nhau (`SOURCE_PROJECTION_MISMATCH`), từ chối Superpowers có layer khác `{}`, BMAD thiếu/thừa layer hoặc layer bắt buộc bằng `null` (`INVALID_CUSTOMIZATION_CONTEXT`).
  - BMAD không còn ném `RENDER_ARTIFACT_REQUIRED`. Nhánh `loadBmadDefinition` chỉ nhận runtime `claude` (layer path của D1 cố định `.claude/...`; runtime khác trả `WORKFLOW_DEFINITION_UNAVAILABLE`). Nó resolve registry, chọn mọi file `.md` dưới `.claude/skills/bmad-build/` (kể cả thư mục con, không lấy `bmad-build-auto`), `customize.toml` và `_bmad/scripts/{render_skill,config_utils}.py`. Nó đo 7 layer path từ projection (sha256 hoặc `null`). Các trường hợp bị từ chối bằng `WORKFLOW_SKILL_MISMATCH`: thiếu `SKILL.md`, `workflow.md`, `customize.toml`, script, `_bmad/config.toml`; gặp symlink trong cây skill; layer path không phải file; tên `.md` ngoài pattern D1. Adapter đọc lại bytes của mọi file được chọn và mọi layer có mặt (`O_NOFOLLOW|O_NONBLOCK`, `nlink === 1`), rồi so manifest với pin. `skills` là các `.md` được chọn trừ `SKILL.md`.
  - `sha256` = SHA-256 của canonical `{source, projection, skills, customizationSha256, render}`; Superpowers có `render = null`. Digest Superpowers vì vậy **khác giá trị trước D2** (giờ có ràng `customizationSha256`). Hiện chưa có consumer persisted nào (S3b/S4 chưa làm).
- `v2/gateway/test/workflow-manifest.test.ts`: bỏ test "BMAD denied", thêm 6 test cho các case RED của memo, và assert hình dạng mới cho Superpowers.
- `v2/gateway/test/fixtures/workflow-definitions/bmad-claude-projection.json` (mới): tập con layout projection BMAD claude. Có 34 entry chính thức: bytes lấy từ `bmad-6.12.0.tgz` đã pin, và hash đã đối chiếu khớp projection build độc lập trong `workflow-builder/independent-builds.json`. Có 5 config layer tổng hợp, vì bytes installer sinh ra không được lưu. Có 14 `expectedSkills`. Test tính lại `ProjectionPin` trên cây tập con, nên đây chỉ là unit identity, không chứng nhận projection thật.
- `v2/gateway/test/render-artifacts.test.ts` **chỉ sửa test cuối (dòng 570+)**, theo ruling PM gửi giữa task. Lý do: test cũ assert `RENDER_ARTIFACT_REQUIRED`, mà ruling A5.1 đã bỏ lỗi này. Bất biến "inspection tách khỏi adapter" được giữ lại. Test mới kiểm: `definition.render` đúng bằng expectation D1 trừ hai root; inspector vẫn là bước riêng, cần byte snapshot do host cấp; spy `child_process` có 0 lần gọi. Không chạm phần còn lại của file, cũng không chạm `render-artifacts.ts`.
- `v2/docs/flows/assistant-workflows.md`: mô tả hành vi/invariant mới (bước 3–7, Files, Tests). Không cần sửa `flows.yaml`, vì fixture/test không thuộc `source.include`.

## Ánh xạ 6 case RED của memo

1. `customization context binds the Superpowers digest to the projection tree, not key order` kiểm: context đúng nguyên văn; đảo thứ tự key thì digest giữ nguyên; đổi `manifestSha256`/`treeSha256` thì digest đổi; Superpowers có layer thì bị deny.
2. `... resolves BMAD to a two-tier render expectation with seven measured layers` kiểm: đúng 7 layer khớp bytes projection; `selectedProjectionSha256` đúng tập; `createBmadArtifactInspector` capture được (thêm root giả); thiếu `_bmad/config.toml` hoặc `customize.toml` bị deny; layer là symlink bị deny. Test phụ `re-reads BMAD layer bytes` dùng layer bị tamper, kết quả deny.
3. `... digest changes when an optional BMAD layer appears with equal skill tokens` kiểm: thêm `_bmad/custom/bmad-build.toml` thì skills/selected giữ nguyên, nhưng `customizationSha256` và `sha256` đổi.
4. `... selects exactly the bmad-build markdown skills except SKILL.md` kiểm: tập đúng bằng 14 path; thiếu `workflow.md` hoặc `SKILL.md` bị deny.
5. `... rejects a BMAD projection bound to another source tree` kiểm: trả `SOURCE_PROJECTION_MISMATCH` và resolver không được gọi.
6. `... never spawns uv, the renderer or any child process` kiểm: source không import `child_process`/inspector/`OwnedOperations`/`uv`; `mock.method` trên 7 hàm `child_process` kèm `syncBuiltinESMExports` cho 0 lần gọi.

## Chứng cứ

Mọi lần chạy Node/tsc đều giữ slot `$TMPDIR/crew-v2-heavy-slot.lock` (`owner=s3-t3-d2`). Telemetry đạt gate (pressure 1, available ≥ 4.6 GiB, CPU idle ≥ 82%, disk ≥ 753 GiB), `NODE_OPTIONS=--max-old-space-size=384`, watchdog 150 s. Child và watchdog đều được reap, và slot được nhả bằng trap. Telemetry đầy đủ nằm ở đầu mỗi log.

| Bước | Lệnh (cwd `v2/gateway`) | Kết quả | Log SHA-256 |
|---|---|---|---|
| RED | `node --test test/workflow-manifest.test.ts test/render-artifacts.test.ts` | exit 1, 38 test, 30 pass / 8 fail. Tất cả là lỗi ngữ nghĩa: `RENDER_ARTIFACT_REQUIRED` hoặc stub `CUSTOMIZATION_CONTEXT_UNAVAILABLE`, không có lỗi import/compile. Case 5 pass ngay ở RED vì guard pin đã có từ T3. | `task-3-d2-red.log` `073735afbb767c58d2941a70176017952340c60aeecbbc8d40e33cbc8d76daa7` |
| GREEN | cùng lệnh | exit 0, **38/38 pass** | `task-3-d2-green.log` `074b7131ec5ce83af347da2a1bc3ac0e9004e3a7175681c6299a4c8b65790165` |
| Typecheck | `tsc --noEmit -p tsconfig.json` (toàn gateway) | exit 0, không có diagnostic | `task-3-d2-typecheck.log` `ec11f4740135ade9820c85b21a5e2dd6497ce1434e37d839b94304ef82e6c285` |
| Biome | `biome check` 4 file (cwd `v2`) | exit 0, 0 lỗi, 0 warning | `task-3-d2-biome.log` `0fb861f353c5199c70d0f95aee570ec28cbf3f302dac3334dbd6f37e2fe2faaf` |
| Docs | mirror (`git archive HEAD:v2` + overlay working `v2/`), `crew-docs generate` → index/files unchanged; `check --all` ok; `check --staged` ok | ok | mirror đã xoá |

Nội dung RED/GREEN đều là sau khi đã sửa test RED. Lần chạy GREEN đầu tiên đã pass, không cần vòng sửa.

SHA-256 file cuối: `workflow-manifest.ts` `d699a0fb268b957106e2a26ea70943af986143f10ef7e542cb80a2c2301fec94`; `workflow-manifest.test.ts` `0824fedf3769fcddb9ff2b692b487c41f73b137fcd8ba228c7691e44bbe16319`; `render-artifacts.test.ts` `6fa0768ea5fbb47ac6e76c0f23c0f39fecda76b86a9eb32ddf34cea832b75e67`; fixture `1d665c0c3ce9286dcb1fbb4e78d79e903b9eaf30c3c3039bab0b7d53536e38c0`; flow doc `8a5ab166c5e10adef5c095c7610fe463bc3c3539f4e4e006afd8351fc116b601`.

## Giới hạn và điểm cần review

- Lát này chưa có admission nào: server phải từ chối dispatch BMAD khi `rendered_artifact_id = null` (S4/T4). Ở gateway, BMAD giờ trả về definition thay vì deny.
- Projection pin trong test BMAD được tính lại trên cây tập con. Nó không chứng nhận manifest projection BMAD thật `cc5320…`, vì bytes installer sinh ra không được giữ.
- Chọn `.md` ở mọi độ sâu và loại mọi basename `SKILL.md` là theo đúng `selectedName` của D1. Memo chỉ ghi "trừ `SKILL.md`".
- `customizationContext` ném lỗi khi BMAD có layer bắt buộc bằng `null`, nên ngay cả caller ngoài adapter cũng không tính được digest cho cấu hình thiếu layer.
- Superpowers `sha256` đổi giá trị so với T3 (thêm `customizationSha256`). S3b/S4 cần dùng định nghĩa mới.
