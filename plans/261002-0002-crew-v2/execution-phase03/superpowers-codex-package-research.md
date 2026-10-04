# Superpowers Codex — provenance package riêng cho Phase03 Task4

Thời điểm hoàn tất: 2026-10-02T05:16:59.698360+00:00. **Kết quả: exact Codex package 6.4.2 chưa thu được; slot tiếp tục null.** Upstream có hỗ trợ Codex và catalog chính thức đang quảng bá 6.4.2. Blocker cụ thể là chưa có bytes/receipt bất biến của official package chứa metadata đầy đủ cho 15 skills của source ghim; public official package kiểm được chỉ là 6.3.0 và thiếu một metadata bắt buộc. Không gọi model/agent, không install plugin/global, không đổi source, dependency, manifest, Git, cấu hình, dịch vụ hoặc credential.

## Hợp đồng và bằng chứng đã có

Đã đọc root/v2 `docs/index.md`, approved `phase-03-macos-workflows.md` Task4/frozen contracts, `task-4-report.md`, `task-4-review.md` và fixture `official-audits.json`. `ProjectionPin` phải bind `sourceTreeSha256`, manifest/tree và audited derivation riêng Codex. Fixture ghim source6.4.2 revision `8ca22dba9a94f28898bbce59f2537ff4d87c747d`, source payload `29714b2c4c727ecc6600f9e5982a0dcbb829860ba79626f1941a0f233e85331a`, tree `76972851ae1f527b6e323866cf9562d6f07f0b44af656e7f453224699507ac46`. Đây là số đã kiểm trong task trước và đọc lại từ fixture, không chạy lại hash/tests/installer.

## Những surface kiểm trực tiếp

| Surface | Kết quả hiện tại | Giá trị provenance |
|---|---|---|
| `~/.codex/plugins/cache/*` cấp marketplace/plugin | Không có Superpowers; có bundled/curated-remote/primary-runtime/claude-mem | Không có installed package làm metadata source |
| `~/.codex/plugins/.remote-plugin-install-staging` | Rỗng | Không có partial official package để kiểm |
| Documented CLI `codex --help`, `plugin --help`, `plugin list --help`, `plugin marketplace --help` | Chỉ gọi help/list, exit0 | Không chạy agent/session/model |
| `codex plugin marketplace list --json` | 4 marketplaces; `openai-curated` root `~/.codex/.tmp/plugins` | Xác định đúng legacy root, không dump config |
| Exact legacy `~/.codex/.tmp/plugins/plugins/superpowers/.codex-plugin/plugin.json` | 5.1.1 | Version mismatch; không nâng nó thành6.4.2 |
| `codex plugin list --available --json` | Installed17, available5129; lọc đúng Superpowers trước xuất | Row chính thức dưới đây, không có package download/hash |
| Public maintainer fork `prime-radiant-inc/openai-codex-plugins` | Public fork của `openai/plugins`; manifest5.1.3 | Historical destination, không phải exact6.4.2 artifact |
| Official public `openai/plugins` | Last plugin-affecting commit `33bd9529725fcee78c9e51fcbaa93cd963c3a47b`, 2026-08-26T20:49:26Z; manifest6.3.0 | Immutable prior metadata, nhưng không đủ cho source6.4.2 |

Remote row đo được: `superpowers@openai-curated-remote`, version `6.4.2`, `installed:false`, `enabled:false`, source `remote`, ID `plugins~Plugin_60aea7460bd4819199fd97a9553a5e12`, installation AVAILABLE, authentication ON_INSTALL. Schema output không có download URL, revision, payload digest hoặc metadata inventory. Read-only list được tài liệu [Developer commands](https://learn.chatgpt.com/docs/developer-commands) mô tả. Row không chứng minh bytes; không thử install hay bypass authentication để lấy package.

## Public metadata bất biến: chứng minh vì sao chưa dùng được

Theo [official public manifest ghim](https://github.com/openai/plugins/blob/33bd9529725fcee78c9e51fcbaa93cd963c3a47b/plugins/superpowers/.codex-plugin/plugin.json), package6.3.0. API tree ghim `626e7cfdd1f1c1852f254ad27a5631a4f94d3c77`, `truncated:false`. Inventory có14 `skills/*/agents/openai.yaml`, source fixture6.4.2 có15skills. Thiếu chính xác `skills/diagnosing-superpowers/agents/openai.yaml`. Tải14 metadata +manifest từ immutable raw URLs; mỗi file ≤64KiB, timeout15s, tối đa4 fetch song song; kiểm Git blob SHA1 với tree và ghi SHA256/byte length. Không tải archive hoặc extract filesystem; không chạy script.

- Public manifest SHA256: `18eb497a5c3c5aade93fe1982db0fbd2ab23d4a428fc552da6ee3cc520c9706d`.
- Public metadata inventory SHA256: `c32d6e0d32212fbb2bdef11ab4579a493f1b7fa7c27263d7dc17dc948198139f`.
- Hash format: SHA256 của UTF8 compact JSON, sorted keys, danh sách sorted `{path,sha256}`; **không phải** source/projection/package tree hash.
- Exact official Codex6.4.2 payload hash/metadata hash: **chưa có**, không gán hash của public6.3.0 thay thế.
- Chi tiết15records/immutable URLs/hashes trong `superpowers-codex-package-research-evidence.json` cạnh báo cáo.

[Package script ghim](https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/scripts/package-codex-plugin.sh) yêu cầu prior official package làm `--metadata-source`, copy metadata theo tên skill và fail nếu thiếu. Output rootless ZIP mặc định hoặc tar.gz, gồm Codex manifest/assets/skills/README/LICENSE và support được chọn; archive deterministic. Script cho phép prior package làm input nên **không** cần giả prior version giống6.4.2; tuy nhiên coverage/provenance phải đủ và được audit. Public6.3.0 thực tế thiếu diagnosing-superpowers nên vẫn fail hợp lệ. [Sync script ghim](https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/scripts/sync-to-codex-plugin.sh) chỉ đích fork và preservation metadata OpenAI; fork5.1.3 không chứng minh current remote catalog package. Không copy Claude manifest, generate YAML hoặc bỏ skill để lách check.

## Đề xuất derivation hẹp, chưa triển khai

Bổ sung trusted audit record đi cùng recipe, không đổi frozen wire DTO: source pin6.4.2; `metadataPackage={officialOrigin, immutableRevisionOrReceipt, advertisedVersion, payloadSha256, packageManifestSha256, metadataInventorySha256, requiredSkillNames, metadataFiles:[{path,sha256}]}`; `recipeScriptSha256`, pinned builder/tool versions, normalization policy và allowlist entrypoints. Bind canonical record bằng `policySha256` trong existing AuditedDerivation/ProjectionPin. Tách source payload với external metadata payload, không tuyên bố byte-equivalence.

Candidate recipe là exact upstream `scripts/package-codex-plugin.sh` ở revision ghim với `--metadata-source` trỏ **owned immutable verified artifact**; Codex entrypoints `.codex-plugin/plugin.json`, `skills/using-superpowers/SKILL.md`, đủ15 `skills/*/agents/openai.yaml`, assets referenced by manifest, scripts/references được package thật giữ. `hooks:{}` giữ theo manifest Codex; không áp Claude hook discovery. Builder wave sau phải kiểm archive/output/entrypoints và determinism rồi sinh actual manifest/tree pins; runtime vẫn UNVERIFIED cho tới Phase04. Không dùng số hash diagnostic của báo cáo làm projection pin.

## Artifact còn thiếu và closeout

Cần một trong hai: (1) official remote6.4.2 ZIP/tar package với immutable download/receipt và byte hash; hoặc (2) prior official package có đủ15metadata kèm immutable official provenance và explicit recipe audit cho source6.4.2. Nếu nhận directory cache chính thức thì cần origin/receipt binding và tree/file inventory; chỉ folder có tên/version không đủ. Public official6.3.0 và legacy5.1.x không đáp ứng. Không đánh dấu upstream unsupported; hiện còn gated tại metadata artifact đầy đủ. Không lặp `.codex/INSTALL.md`404/release assets[] đã được PM xác minh.

Evidence thu trong bộ nhớ, chỉ viết hai file ownership; không tạo scratch download/temp file nên không có scratch tồn dư. Hai bounded CLI subprocess đã exit0; public fetch process đã hoàn tất. Chưa đổi slot hoặc handoff builder.

Unresolved: nguồn tải/receipt immutable cho current official remote6.4.2; official metadata `diagnosing-superpowers`; output hashes/determinism của builder sau khi nhận artifact.
