# Review hợp đồng Superpowers Codex native artifact

**Verdict: READY cho recipe artifact candidate `superpowers-codex-native-skills-v1`. Không có blocking finding ở mapping artifact đề xuất. Runtime availability/certification: UNVERIFIED, không enable.**

Review này chỉ xét `superpowers-codex-native-recipe-proposal.md`, hai research report/evidence tương ứng, approved Phase03 frozen DTO/Tasks4/6/7 và Phase04 source/projection/runtime handoff. Không review hay nghiệm thu code Task4 fix đang làm. READY cho phép PM ghi audit ruling và triển khai producer candidate trong phạm vi đã giao; không phải phê duyệt consumer runtime hoặc live/model/signing/UI/deploy.

## 1. Source và geometry đạt yêu cầu artifact

Đã đọc trực tiếp exact fixture `superpowers-6.4.2.tgz`, revision `8ca22dba9a94f28898bbce59f2537ff4d87c747d`; 19 file source có hash khớp `superpowers-codex-native-skills-evidence.json`. Archive có đúng 15 `skills/<name>/SKILL.md`, không có symlink/hardlink upstream. `.codex-plugin/plugin.json` giữ version6.4.2, `skills: ./skills/`, `hooks: {}` và assets paths. `using-superpowers` có bootstrap-before-action và Codex reference thật; reference yêu cầu kiểm actual tools/multi-agent, không chứng minh chúng đã có.

Với projection root P, mỗi link `P/.agents/skills/<name> -> ../../skills/<name>` resolve thành `P/skills/<name>`. Đường sibling từ executing-plans tới `../subagent-driven-development/scripts/sdd-workspace`, `review-package`, hoặc `../requesting-code-review/code-reviewer.md` vẫn dẫn tới original sibling khi đi từ canonical skill root; toàn bộ full tree giữ scripts/references/templates/prompts/assets liên quan. Kiểm lexical target cho đủ 15 tên đều đúng. Canonical/realpath, modes, byte hashes và no writable alias vẫn phải kiểm trên build thực, không suy từ kiểm lexical này.

Lưu ý cụ thể cho producer: source đã có `.agents/` và `.agents/plugins/marketplace.json`, nhưng chưa có `.agents/skills/`. Giữ nguyên directory/manifest ấy, thêm đúng một `.agents/skills` và 15 link; không ghi duplicate `.agents` entry, không overwrite upstream path hoặc thay discovery mapping theo điều kiện runtime. Không sửa frontmatter/tên/skill text, không sinh YAML/alias router/Claude hook. Canonical formula và SourcePin/ProjectionPin/005/007 giữ nguyên; actual manifest/tree pin phải đo từ hai build độc lập, chưa có pin mới nào được chứng nhận trong review này.

## 2. Native artifact riêng phù hợp source-workflow contract

Approved Task4 cho audited derivation riêng theo runtime từ official source và explicit adapter recipe. Vì bytes workflow không đổi và recipe/source/policy được bind vào projection pin riêng, standalone native candidate này phù hợp cơ chế đó dù upstream README6.4.2 chỉ công bố marketplace installation. Cần gọi đúng là **Crew-audited native projection of official source**, không gọi upstream-recommended native installation hoặc official marketplace package tương đương.

Primary OpenAI docs xác nhận standalone skill dùng SKILL.md, YAML metadata tùy chọn và discovery hỗ trợ symlink folders. Điều này đủ cơ sở chọn artifact geometry; không xác nhận namespace, dependency policy, bootstrap timing hoặc script execution của source này. [Build skills](https://learn.chatgpt.com/docs/build-skills).

Đã đọc static schema evidence của CLI0.159.3: SkillsListParams chỉ `cwds`/`forceReload`; metadata có nullable plugin/interface/dependencies; native skill input yêu cầu `type/name/path`. Protocol docs mô tả text marker cùng explicit skill item để inject instructions. Không dùng field mới `perCwdExtraUserRoots` trên binary chưa chứng minh. Đây vẫn là static protocol support, chưa phải runtime discovery/invocation evidence. [App Server](https://learn.chatgpt.com/docs/app-server).

Marketplace gate độc lập vẫn đóng: package research ghi public prior6.3.0 chỉ 14 metadata, thiếu `diagnosing-superpowers`; catalog6.4.2 row không có immutable package bytes/receipt. Không lấy native candidate để bịa official package receipt/YAML hoặc xóa skill thứ15. Việc không có optional YAML cho native không làm metadata requirements của package builder biến mất.

## 3. Handoff bắt buộc trước consumer execution

Các mục này là cách cụ thể hóa gate đã ghi ở proposal dòng15–21, không chặn build artifact. PM phải đưa vào addendum Task6/7/Phase04 trước consumer execution:

1. **Giữ link geometry khi materialize.** Không copy riêng 15 relative link sang scratch `.agents/skills` rồi mặc định target còn đúng: khi đó `../../skills/<name>` trỏ vào scratch `skills/<name>`, không tự trỏ registry P. Chọn và ghi một layout/mount/view cố định bảo toàn cả verified targets và sibling resources; re-resolve canonical path từ discovery root thật. Không sửa link trong immutable artifact hoặc đổi sang fallback mapping ngầm.
2. **Full source tree không đồng nghĩa project instruction scope.** P còn chứa root `AGENTS.md`, `.agents/plugins/marketplace.json`, `.claude-plugin`, hooks và các harness manifests. Giữ bytes để provenance, nhưng không chạy attempt với P làm CWD/ancestor hoặc copy tất cả vào project root rồi vô tình nạp contributor AGENTS hay marketplace/hook registration. Task6 cần kiểm riêng những surface này là inactive; không register Claude hook vào Codex. Việc giữ support bytes trong artifact là hợp lệ, quyền auto-discovery/execute là gate khác.
3. **Inventory và nguồn bổ sung.** Exactly15 là selected workflow inventory. Bất kỳ user/admin/system/plugin source ngoài đó phải bị deny hoặc được kê riêng trong audited required-system allowlist với provenance/certificate; không che bundled/admin entries để báo đủ15. `skills/list` + owned HOME không phải filesystem/process-wide boundary.
4. **Bootstrap original trước work.** First native input phải có `$using-superpowers` và exact verified skill path item, load original Codex reference; không có task-only turn trước đó. Root AGENTS upstream cũng yêu cầu bootstrap và behavioral integration proof. Protocol injection không chứng minh skill thực thi đúng thứ tự: Phase04 phải có trace. Giữ SUBAGENT-STOP đúng ngữ cảnh, không ép child chạy bootstrap trái original rule.
5. **Namespace/tool/child còn UNVERIFIED.** Original prose có `superpowers:…` trong khi native discovery tên bare. Exact-path bootstrap không giải quyết mọi cross-skill dispatch. Phase04 đo namespaced transitions, scripts/cwd/interpreters, actual tool inventory, native Read/MCP/subagent/SDD, reconnect/reload/compaction và pin inheritance. Không sửa source/alias router để vượt mismatch; nếu không giữ semantics thì pair vẫn unavailable và review lại recipe.
6. **Không hạ certification.** Task6 no-model evidence chỉ đủ build/discovery/path probes; Task7 fake integration không biến thành runtime PASS. Phase04 cần positive selected và negative unauthorized source surfaces ở load/invoke trên exact binary/OS/policy/source/projection, toàn process tree; missing cell giữ UNVERIFIED. Model/live test chỉ theo authority/budget riêng đã được cấp, không suy từ review này.

## 4. Acceptance producer và giới hạn bằng chứng

Producer phải có hai build khác owned root cho cùng canonical tree, full upstream entries/bytes/modes không đổi, đúng 15 additions và discovery directory; kiểm target canonical trong same projection, sibling resources từ cả canonical/discovery paths, expected source/policy/manifest binding, collision/mode/path-negative và no publish khi mismatch. Original hook/marketplace files tồn tại như source, không có registration hay invocation side effect.

Reviewer chỉ đọc archive trong memory, kiểm 19 source hashes và 15 lexical targets, đọc schema/package evidence và mở hai primary OpenAI docs. Không tạo projection/symlink fixture, không start app-server/session/turn, không chạy script/model, không cài/enable plugin, không sửa unfinished source. Chỉ tạo báo cáo này; không có scratch để cleanup.

**Kết luận phạm vi:** artifact recipe READY; Task4 implementation/hash verification còn phải làm; Task6/7 consumer addendum phải ghi rõ geometry/inactive discovery/bootstrap; native runtime vẫn UNVERIFIED/unavailable tới genuine Phase04 certificate. Không có thay đổi frozen DTO/SQL hoặc quyền trả phí/live/deploy được suy ra.
