Thời điểm: 2026-10-02T05:25:01.352784+00:00

# Superpowers6.4.2 — audit đề xuất cho Codex native skills

**Kết luận: có cơ sở protocol để xây một projection native riêng, chưa có bằng chứng runtime hoặc recipe native được upstream6.4.2 chính thức công bố.** `agents/openai.yaml` không phải điều kiện discovery của native skill. Vì thế blocker metadata của package marketplace không tự động chặn candidate này; gate marketplace vẫn nguyên vẹn trong báo cáo trước. Cần PM + strong review duyệt recipe/consumer trước implementation; giữ slot null và certification UNVERIFIED cho tới khi audit/build và Phase04 thực sự hoàn tất.

## Đọc và kiểm tra cục bộ trước

Đã load lại `/Users/phannhatquang/.codex/skills/.system/openai-docs/SKILL.md` và thông báo sử dụng. Không đọc auth/config secrets. Cục bộ chỉ có Codex resource directories voice/zsh/rg, không có guide native-skills đọc được tại những path đã kiểm. `codex app-server --help` và `generate-json-schema --help` xác nhận generator schema static. Chạy generator hai lần vào hai TemporaryDirectory sở hữu riêng, timeout20s, exit0; lần hai lấy schema TurnStart chưa chọn ở lần đầu. Không start app-server, connect daemon, thread/turn/model, tạo projection hay chạy scripts. Các thư mục tạm được finally cleanup.

Installed binary: `codex-cli 0.159.3`. Schema SHA256: SkillsListParams `1d245374e64c5acc9739dfc68a4fe5114c6c9147af04c480886f1846d2ca6239`; SkillsListResponse `230f125d6c36ec1b1514018a0bb6d0627f7308ea82f1ef04cad85490de482bae`; TurnStartParams `2dfcf68705896fadc344ccfeb2e9fe5a6bcbbb8b9a90cf449ce232b636daf05a`.

Installed CLI schema xác nhận:

- SkillsListParams có `cwds`, `forceReload`; **không có** `perCwdExtraUserRoots` mà tài liệu hiện tại mới hơn mô tả. Không đưa field này vào recipe cho binary hiện tại.
- SkillMetadata bắt buộc `name`, `description`, `path`, `enabled`, `scope`; `pluginId`, `interface`, `dependencies` nullable, không bắt buộc plugin identity.
- TurnStartParams input có SkillUserInput với ba trường bắt buộc `type:skill`, `name`, `path`. Đây chỉ là static protocol support; chưa chứng minh loader/invoke thực.

Schema SHA256 +selected definitions và hashes19 exact source entrypoint files được lưu trong `superpowers-codex-native-skills-evidence.json` cạnh báo cáo. Không rerun source payload/hash tests hoặc catalog/package6.3.0 research.

## Tài liệu primary trả lời gì

[OpenAI Build skills](https://learn.chatgpt.com/docs/build-skills) mô tả folder cần SKILL.md với name/description, scripts/references/assets tùy chọn và **agents/openai.yaml tùy chọn**. Native discovery đọc `.agents/skills` từ CWD lên repository root, thêm user/admin/system; hỗ trợ symlink folders. Skill có explicit/implicit invocation. Nội dung đầy đủ được đọc khi skill được chọn; danh sách khởi tạo có thể bị rút gọn nếu quá lớn. Tài liệu ưu tiên plugin cho distribution/bundling nhưng vẫn cho phép direct folder local/repo workflows. Đây là lời khuyên distribution, không phải cấm standalone15skills.

[OpenAI App Server](https://learn.chatgpt.com/docs/app-server) tài liệu hóa `skills/list` và `forceReload`; explicit `turn/start` có `$<skill-name>` trong text cùng skill item `{type:"skill",name,path}` để inject full instructions. Root bổ sung trong docs mới không được schema installed xác nhận. Không dùng extra-root method để lách discovery. CLI version/schema phải thành pin của runtime policy, tránh assumption API mới hoạt động trên binary cũ.

## Exact upstream6.4.2 có buộc marketplace semantics không

Đọc bytes từ fixture revision `8ca22dba9a94f28898bbce59f2537ff4d87c747d`. [Codex manifest ghim](https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/.codex-plugin/plugin.json) có skills `./skills/`, `hooks:{}`, hai assets icon và version6.4.2. [README ghim](https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/README.md) chỉ hướng dẫn marketplace cho Codex App/CLI. Nó không đưa recipe native folder cho bản này; không gọi recipe đề xuất là upstream-recommended installation. Manifest không khai báo MCP/server/runtime dependency ngoài skills/assets ở các field đã đọc. Không đồng nhất metadata UI/policy chưa có với nội dung nguồn.

[using-superpowers ghim](https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/using-superpowers/SKILL.md) yêu cầu chọn skill trước response/action và đọc `references/codex-tools.md` khi dùng Codex; skill có ngoại lệ subagent giao việc cụ thể. [Codex tools reference ghim](https://github.com/obra/superpowers/blob/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/using-superpowers/references/codex-tools.md) dựa trên tool inventory thực, cần multi-agent support cho SDD/parallel, có model-routing/environment guidance. Không sửa upstream text để hợp current runtime: certificate phải đánh giá actual tools và precedence của user/AGENTS.

Claude/Cursor hook `hooks/session-start` tự inject bootstrap và dùng plugin-specific environment. Codex manifest rỗng hooks nên candidate native không cần port hook đó. Discovery một folder **không tự đảm bảo** using-superpowers được chọn trước mọi action; explicit exact-path bootstrap phải thành consumer policy và được chứng minh. Không register Claude hooks, không dựng hook hoặc role prompt mới để thay skill gốc.

## Recipe candidate hẹp để review, chưa triển khai

`layoutSchema:superpowers-codex-native-skills-v1`, tool/version là reviewed byte-preserving projection recipe riêng; exact sourceTree bind existing ProjectionPin. Giữ15skill folders nguyên nội dung, không rename frontmatter, không thêm YAML, không bỏ diagnosing-superpowers; giữ mọi sibling references/templates/prompts/assets/scripts và executable modes. Giữ upstream root assets/Codex manifest/LICENSE/README cùng original skills tree để audit provenance và đường dẫn hỗ trợ.

Một mapping có thể review: full upstream support tree trong immutable projection root; thêm internal discovery directory `.agents/skills/<original-name>` trỏ internal relative symlink tới original `skills/<original-name>`. Symlink folder native được tài liệu hỗ trợ, còn registry security/resolve phải kiểm canonical target nằm trong pin, không ancestor/home escape và không writable alias. Đây là **đề xuất**, không chứng minh parser hiện tại cho phép. Consumer Task6 materialize vào attempt-owned discovery scope được pin, không install global; nếu symlink không phù hợp registry thì copy nguyên folder bytes vào owned `.agents/skills` và giữ ancillary tree/relative-reference contract được audit. Không sửa checkout owner hoặc inherited AGENTS. Chọn một mapping deterministic khi review, không bật cả hai tùy tiện.

Entry points bắt buộc:15 `skills/<name>/SKILL.md`, using-superpowers Codex reference, brainstorming visual-companion/server assets, executing-plans task scripts, SDD sdd-workspace/task-brief/review-package/prompts, debugging find-polluter và writing-skills render-graphs/references. Các cross-skill relative references như executing-plans `../subagent-driven-development/scripts/sdd-workspace` cần giữ sibling geometry. Script invocation dùng đúng interpreter/cwd/arguments của prose. Visual server là optional task behavior với owned resource/process authority; discovery không có quyền chạy nó.

Isolation requirement trước native launch: OWN scratch repository root/CWD với `.agents/skills` của selected pin; owned HOME/CODEX_HOME/config/cache riêng. Không đặt scratch dưới owner ancestor có `.agents/skills`/AGENTS. Cần process/filesystem policy chứng minh ancestor/global user/admin/system/plugin sources không thừa kế ngoài audited allowlist; đổi HOME hoặc đọc skills/list **không đủ** chứng minh OS isolation hay loại `/etc/codex/skills`/bundled defaults. Allowlist required system tool support phải được định danh/certify riêng, không giả không có system skills. Unexpected source/duplicate skill/disabled required skill/symlink escape/dynamic late discovery/unsupported override đều fail-closed. Nếu binary/platform không có isolation hiệu lực cho native source surfaces thì variant này cũng unavailable.

Consumer boundary: `skills/list` đúng attempt CWD với `forceReload:true`; so inventory exactly15 enabled names/paths, error-free canonical roots. First native input tương lai phải chọn ORIGINAL using-superpowers bằng skill item exact path trước task work; không gửi task-only turn trước bootstrap. Kèm marker và original task text theo protocol explicit `$using-superpowers` và exact path skill item lấy từ resolved verified pin; không tự viết nội dung bootstrap/PM/dev/QC. Việc attach skill text không tự cấp quyền Bash/network/process/MCP/subagent; những tools cần adapter policy/operation authority. Sau reload/reconnect/compaction/child phải có rule audited và proof load lại từ cùng pin. Child riêng phải thấy đúng skills và áp dụng upstream SUBAGENT-STOP đúng ngữ cảnh.

Hai giới hạn semantics phải test chứ không đoán:

1. Native name là bare `brainstorming`, nhưng prose dùng nhiều `superpowers:brainstorming`/required sub-skill references. Docs không bảo đảm native namespaced alias. Exact path lựa chọn bootstrap giải quyết bước đầu, chưa chứng minh mọi cross-skill dispatch. Nếu phải sửa text/rename skill/add instruction router thì dừng recipe, xin review mới; không giữ nguyên bytes mà tuyên bố namespace tương đương.
2. Missing official YAML nghĩa là không chứng minh marketplace UI/invocation-policy/tool-dependency equivalence. Candidate chỉ nhằm actual official workflow text +native skill mechanism; never marketplace-package equivalence. Explicit bootstrap bắt buộc để không dựa heuristic implicit invocation.

## Amendment/acceptance cần trước thay consumer

Các phần frozen plan ảnh hưởng cụ thể: **Frozen wire contracts** (source/projection derivation binding) giữ DTO nguyên; **Task4** (đoạn AuditedDerivation/officialEntrypoints và GREEN per-runtime recipe, khoảng dòng154/171) cần audit ruling chấp nhận native variant thay package-output recipe cho slot này; **Task6** (prepareWorkspace/preflightSourceIsolation, khoảng dòng197) cần owned native discovery roots, first-input bootstrap và inherited-source probes; **Task7 integrated acceptance / Phase04 handoff** phải ghi semantics/certificate mới, không suy PASS từ skills/list. Ngoại lệ separate Codex recipe audit trong Task4 phù hợp hướng nghiên cứu, nhưng không tự cấp phê duyệt thay consumer hoặc nới native certification.

Approved Phase03 cho audit Codex recipe riêng; PM cần ghi rõ native standalone variant này được chấp nhận là projection của source official6.4.2 dù README chỉ có marketplace installation. Review policy/source-entrypoint inventory/cross-skill semantics và bổ sung Task4 producer, Task6 discovery, Phase04 invocation expectations. Frozen SourcePin/ProjectionPin DTO không cần đổi; canonical audited mapping/runtime schema/input/bootstrap/namespace/ancillary/script/isolation policy bind `policySha256`; output manifest/tree pins mới phải đo từ build thật. Không dùng source tree hash như native projection tree hoặc hash evidence như cert.

Phase03 no-model chứng minh build deterministic, inventory/files/modes/references, skills/list canonical paths và negative discovery isolation; **UNVERIFIED** overall. Phase04 positive/negative phải chứng minh full using-superpowers load trước task, Codex reference load, required cross-skill15 inventory và chọn đúng skills khi cần, scripts/resources/interpreters, native tools/MCP/child availability/invocation, compaction/reload/inheritance và zero unauthorized skill/hook/plugin escape. Chứng minh loader không đủ để báo actual workflow run thành công. Nếu cross-skill alias/bootstrap/tools không giữ được semantics thì candidate tiếp tục unavailable; marketplace package gate vẫn độc lập.

Unresolved: PM/strong review có chấp nhận native variant chưa có upstream recipe; mapping registry/attempt được chọn; namespaced cross-skill behavior; actual isolation/load/invoke/child/compaction certificate. Không enable hoặc handoff implementation tự động.
