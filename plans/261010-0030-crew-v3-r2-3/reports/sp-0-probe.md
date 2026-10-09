# SP-0 (cổng G0) — báo cáo đo A1–A5 trên Mac mini

Đo 10/10/2026 00:56–01:00 (giờ `date`, Asia/Ho_Chi_Minh). Thư mục đo `~/crew-r23-probe/` (0700). Công cụ: `claude`
2.1.295, `uv` 0.12.13, Node v24.21.0, `/usr/bin/git`. Đã dùng **3/3** lệnh `claude -p` (`claude-sonnet-5`,
`--setting-sources project,local`), tổng chi phí báo trong `result` ≈ 0,17 USD. Không chạm `~/.claude`, `~/.crew`,
`~/crew-agents` (chỉ đọc), sshd 2222, app, prod. Không run Paperclip.

## Tóm tắt kết quả

| Giả định | Kết quả | Quyết định G0 theo bảng "Đợt chạy" |
|---|---|---|
| A1 nguồn ghim | **đạt** (lệch số file: 258, không phải 259) | (a) giữ nguồn plan |
| A2 `setup.py` không tương tác | **đạt** | (b) MW-3 làm `setup-project` bằng `setup.py` |
| A3 `system/init` | **đạt**; Superpowers **không** bị nạp trong lần đo | (c) luật chặn nạp chéo giữ nguyên (fail đóng), chỉ ghi bằng chứng |
| A4 repo AC | **đạt** | (d) nghiệm thu trên `repo-a` |
| A5 `bmad:bmad` không cần người | **không đạt** | (e) `bmad.md` bỏ bước gọi `bmad:bmad`, gọi thẳng `bmad:bmad-create-epics-and-stories` sau khi có PRD + architecture |

---

## A1 — Nguồn `git archive` và bản ghim

Lệnh: đúng Step 1 của `probe.md` (`git archive d009608292d8a2ea4df846de7dca2f0d78a9e22d plugins/method/skills
plugins/toolbox/skills` từ marketplace local và từ clone `https` `--filter=blob:none --no-checkout`).

- Marketplace local: HEAD = `d009608292d8a2ea4df846de7dca2f0d78a9e22d`, có object revision (`local=yes`).
- Clone https + archive: **3 giây**. `diff -r src-local src-https` rỗng (`local=https`); so mode từng file
  (`stat -f %Lp`) cũng trùng.
- Hai cây: `method` 21 skill, `toolbox` 8 skill, `comm -12` rỗng (không trùng tên) → 29 skill.
- Git tree ở revision: 256 blob `100644`, 1 blob `100755`
  (`plugins/toolbox/skills/bmad/scripts/resolve_customization.py`). Bit thực thi giữ nguyên sau `tar -x`.
- Bản lắp `pin/` = `skills/` (hợp hai cây) + `.claude-plugin/plugin.json` ghi bằng `printf '%s\n'` đúng chuỗi
  `BMAD_PLUGIN_JSON` của I1 (kết thúc đúng một `\n`).
- Checksum (thuật toán shell của `r2-2:docs/flows/mac-workflows.md`) =
  `7f62e5cb6033d039505afdce2a1d411cbff064a83f13df1d467987f698cd82d2`. Kiểm chéo bằng bản Node chép nguyên logic
  `r2-2:apps/crew-mac/src/workflows/tree-checksum.ts`: cùng checksum, 258 file.
- **Lệch spec §9:** số file là **258** (257 file của hai cây + `plugin.json`), không phải 259. Không có file nào bị
  `export-ignore` (revision không có `.gitattributes`). Coi 259 là đếm nhầm khi viết spec; MW-1 dùng 258.

**Kết luận: đạt.**

## A2 — `setup.py` không tương tác

Repo tạm `proj` (`git init`, một commit README). `S=pin/skills/bmad`.

1. `uv run --no-cache "$S/scripts/setup.py" --project-root proj --skill "$S" --list-config-questions` → thoát 0,
   0,23 giây, stderr rỗng, stdout:

   ```json
   []
   ```

   Lý do: không `module-manifest.toml` nào của 29 skill khai báo câu hỏi (chỉ có `module`, `version`,
   `update_source`, `knowledge`; module `method` ×21, `toolbox` ×8). `setup.py` tìm module bằng thư mục anh em của
   `--skill` (`skill_root.parent.iterdir()`), nên chỉ thấy đúng 29 skill của bản ghim.
2. Mảng rỗng → theo `references/setup.md` chạy dạng "No module answers":
   `uv run --no-cache "$S/scripts/setup.py" --project-root proj --skill "$S"` → thoát 0, **0,10 giây**, **stdout và
   stderr đều rỗng** (setup thành công không in JSON).
3. Không tải gì qua mạng: script chỉ khai `requires-python = ">=3.11"` (PEP 723, không dependency), stderr không có
   "Downloading"/"Installed".
4. File `setup.py` tạo (`git status --porcelain --untracked-files=all`), 12 file:

   ```
   _bmad/config.toml
   _bmad/scripts/config_utils.py
   _bmad/scripts/memlog.py
   _bmad/scripts/render_skill.py
   _bmad/scripts/resolve_config.py
   _bmad/scripts/resolve_customization.py      (mode 755)
   _bmad/scripts/setup.py
   _bmad/scripts/tests/test_config_utils.py
   _bmad/scripts/tests/test_memlog.py
   _bmad/scripts/tests/test_render_skill.py
   _bmad/scripts/tests/test_resolve_config.py
   _bmad/scripts/tests/test_resolve_customization.py
   ```

   Thêm 5 thư mục rỗng git không track: `_bmad/custom/`, `_bmad/method/scripts/`, `_bmad/toolbox/scripts/`,
   `_bmad-output/`. Không có `*.user.toml`.
5. `diff -r "$S/scripts" proj/_bmad/scripts` rỗng (`scripts=identical`), bit 755 của `resolve_customization.py` giữ.
6. `_bmad/config.toml`, khóa: `[core] project_name, output_folder`; `[modules.bmm] planning_artifacts,
   implementation_artifacts, project_knowledge`; `[agents.bmad-agent-{analyst,pm,ux-designer,architect,dev}]
   module, team, name, title, icon, description`. Không giá trị nhạy cảm. **Không có khóa ngôn ngữ**
   (`communication_language`/`document_output_language` không xuất hiện ở đâu trong bản ghim;
   `resolve_config.py --key core.communication_language` trả `{}`).
7. Chạy lại lần hai: thoát 0, sha256 mọi file dưới `_bmad` và mtime `config.toml` không đổi (idempotent).
8. Cờ: `--module-answers` đúng tên (`setup.py --help`: `--project-root`, `--skill`, `--module-answers`,
   `--list-config-questions`, `--update | --doctor`). File câu trả lời rỗng → thoát 0, không đổi gì. File có khóa không
   nằm trong câu hỏi đang chờ (`[modules."method"] "communication_language" = "Vietnamese"`) → **thoát 1**, traceback
   `... contains modules.method.communication_language, which is not a pending question`, không đổi file.
9. `resolve_config.py --project-root proj --key modules.bmm.planning_artifacts` →
   `{"modules.bmm.planning_artifacts": "{project-root}/_bmad-output/planning-artifacts"}` (thoát 0).
10. Commit `_bmad/`, clone repo sạch (thư mục rỗng mất), chạy lại `setup.py` → thoát 0, `git status` sạch (chỉ dựng
    lại thư mục rỗng). `setup.py --doctor` trên clone → `"status": "current", "changed": false, "shared_scripts":
    "current"`, hai module `selected`, `current: true`.

**Kết luận: đạt.** Ghi chú cho MW-3/AG-1 ở mục cuối.

## A3 — `system/init` với bản ghim BMAD

Lần 1 (`claude -p` #1), trong `proj` đã commit `_bmad`, lệnh đúng Step 3: thoát 0, 5,2 giây, `result` = `OK`, 1 turn.

- `plugins[]`:
  `{"name":"bmad","path":"/Users/phannhatquang/crew-r23-probe/pin","source":"bmad@inline","version":"6.13.0-next"}`,
  cộng 3 plugin `@builtin` (`cc-plugin-agents-md`, `cc-plugin-telemetry`, `cc-plugin-plugin-authoring`,
  `path: "builtin"`).
- Skill: 48 = **29 `bmad:*`** + 19 không namespace. 5 đầu: `bmad:bmad`, `bmad:bmad-advanced-elicitation`,
  `bmad:bmad-agent-analyst`, `bmad:bmad-agent-architect`, `bmad:bmad-agent-dev`.
- 19 skill không namespace trùng **đúng** `BUILTIN_SKILLS` của `r2-2:apps/crew-mac/src/workflows/run-init.ts` (đo trên
  2.1.289); `agents` trùng `BUILTIN_AGENTS`. Không skill nào không rõ nguồn trên claude 2.1.295.
- `mcp_servers`: `claude.ai Claude Docs` (`source: claudeai`, đã nằm trong nguồn được phép).
- Không có `superpowers` ở đâu trong sự kiện init.

Lần 2 (`claude -p` #2): thêm và commit `.claude/settings.json` =
`{"enabledPlugins":{"superpowers@claude-plugins-official":true}}`, cùng lệnh: thoát 0, `plugins[]` và skill y hệt lần 1
(29 `bmad:*` + 19 builtin), **Superpowers không xuất hiện**.

Nguyên nhân (đọc `~/.claude/plugins/installed_plugins.json`, chỉ đọc): Superpowers 6.4.1 của owner cài
`scope: "project"` cho `projectPath: /Volumes/CORSAIR/Projects/my-crew`, cache
`~/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1`. Repo tạm không phải project đó nên CLI không nạp.
Ở worktree mà owner đã cài Superpowers cho đúng đường dẫn (hoặc khi owner cài user scope), nó sẽ được nạp từ cache owner.

**Kết luận: đạt** (tên plugin `bmad`, skill `bmad:<skill>`). Quyết định (c): luật `CROSS_WORKFLOW_REASON` giữ fail đóng;
không nạp được lần này chỉ do scope cài của owner, không phải do `--setting-sources`.

## A4 — Repo AC (`repo-a`), chỉ đọc

- `~/crew-agents/`: `assistant`, `integrator`, `mac-claude`, `mac-claude-2`, `reviewer` (đều là worktree của
  `repo-a`), `p-2ps-landing` (không phải git).
- Kho chung: `git -C ~/crew-agents/reviewer rev-parse --git-common-dir` = `~/crew-spike/repo-a/.git`; checkout chính
  `~/crew-spike/repo-a` (`main` @ `cdaaeb5`). Remote `origin` = `~/crew-spike/repo-a-origin.git`, `origin/main` @
  `d453bb8` (main local **chậm** 10 commit so với `origin/main`). Checkout chính có file chưa track `owner-wip.txt`
  (của owner, không đụng).
- `docs/flows.yaml` có (một flow `repo-a`; `source.include: ["src/**", "apps/**", "packages/**"]`).
- `git config crew-docs.bundle` = `~/.crew/bin/crew-docs-2ce11c9.cjs`; `crew-docs.runtime` = `/opt/homebrew/bin/node`;
  `core.hooksPath` = `.githooks`; `.githooks/pre-commit` gọi `crew-docs ... check --staged`.
- `.claude/settings.json`: **không có** (cả `main` lẫn `origin/main`) → không `enabledPlugins`; không có `.claude/`.
- `_bmad/`: chưa có.
- Thử trên clone của `repo-a-origin.git` (trong thư mục đo): `setup.py` rồi `git add -A` → `crew-docs check --staged:
  ok` (`_bmad/**`, `_bmad-output/**` nằm ngoài `source.include`, không cần sửa `flows.yaml`).

**Kết luận: đạt.** Quyết định (d): AC dùng `repo-a`. DP-1 tạo worktree `~/crew-agents/bmad` bằng
`git -C ~/crew-spike/repo-a worktree add -b agent/bmad ~/crew-agents/bmad origin/main` (rẽ từ `origin/main`, không từ
`main` local đang cũ).

## A5 — `bmad:bmad` không cần người

`claude -p` #3, đúng lệnh Step 5 (`--max-turns 3`), trong `proj` (đã revert commit settings, không PRD):

- Thoát 1, `subtype: error_max_turns`, 4 turn, 15,6 giây, không có câu trả lời cuối.
- Diễn biến: turn 1 gọi `Skill bmad:bmad` (nạp được). Skill yêu cầu quét lại `module-manifest.toml` của mọi skill và
  đọc tài liệu `knowledge` (`references/help.md`) trước khi trả lời; turn 2 `find` trong thư mục ghim bị
  `permission_denied` (ngoài cwd, chế độ quyền mặc định của `-p`); turn 3 `ls` cũng bị chặn → hết turn.
- Không dừng chờ người, nhưng không ra danh sách skill trong giới hạn đo. SKILL.md của `bmad` còn dặn "khi chưa chắc
  hoàn tất thì hỏi người dùng" — rủi ro dừng hỏi trong run thật.
- Đọc tĩnh `bmad/references/help.md` (để AG-1 có thứ tự, không cần gọi skill trợ giúp): việc cỡ dự án
  `bmad-product-brief` hoặc `bmad-prfaq` → `bmad-prd` → `bmad-ux` (khi UX quan trọng) → `bmad-architecture` →
  `bmad-create-epics-and-stories` → `bmad-sprint-planning`; việc cỡ epic `bmad-spec` (kèm architecture/UX nếu cần) rồi
  chia story.
- `bmad-create-epics-and-stories/steps/step-01-validate-prerequisites.md`: **bắt buộc** PRD
  (`{planning_artifacts}/*prd*.md` hoặc `*prd*/index.md`) và **Architecture** (`*architecture*.md` hoặc
  `*architecture*/index.md`); UX **tùy chọn** (bắt buộc khi có UI theo mục 1, nhưng tìm ở mục "Optional"). Bước này có
  "Ask the user ... Wait for user confirmation" và menu `C` trước khi sang bước sau → agent phải tự chọn theo Q5.

**Kết luận: không đạt.** Quyết định (e): `bmad.md` không gọi `bmad:bmad`; đi thẳng
`bmad:bmad-prd` → `bmad:bmad-architecture` (khi chưa có) → `bmad:bmad-create-epics-and-stories`, kiểm điều kiện đầu vào
theo step-01 ở trên.

---

## Giá trị cho MW-1/MW-3

```ts
// cho BMAD_PIN (bmad-pin.ts)
checksum: '7f62e5cb6033d039505afdce2a1d411cbff064a83f13df1d467987f698cd82d2',
executables: [
  'skills/bmad/scripts/resolve_customization.py',
],
// số file: 258 (257 file skill + .claude-plugin/plugin.json)
```

`plugin.json` (đúng byte, 1 dòng + `\n`):
`{"name":"bmad","version":"6.13.0-next","description":"BMAD Method (bmad-method + bmad-toolbox), Crew pin d009608292d8"}`

Mẫu `questions.json` (`setup.py --list-config-questions` trên repo trống, bản ghim này):

```json
[]
```

Cờ đúng của `setup.py` (chạy bằng `uv run --no-cache <pin>/skills/bmad/scripts/setup.py`):

```text
--project-root <dir> --skill <pin>/skills/bmad --list-config-questions     # in mảng JSON, chỉ đọc
--project-root <dir> --skill <pin>/skills/bmad                             # khi mảng rỗng
--project-root <dir> --skill <pin>/skills/bmad --module-answers <toml>     # khi mảng không rỗng
--project-root <dir> --skill <pin>/skills/bmad --doctor                    # in JSON {"status": "current"|...}
```

File `setup.py` tạo: 12 file liệt kê ở A2 mục 4 (+ thư mục rỗng `_bmad/custom`, `_bmad/{method,toolbox}/scripts`,
`_bmad-output`). Đường `planning_artifacts` sau resolve: `{project-root}/_bmad-output/planning-artifacts`.

Ghi chú cho ticket sau (không đổi quyết định G0):

1. **MW-3:** setup thành công **không in gì** ra stdout; quyết định bằng mã thoát + `git status`, không parse JSON của
   lệnh setup (chỉ `--list-config-questions` và `--doctor` in JSON). Khi mảng câu hỏi rỗng thì **không** truyền
   `--module-answers` với khóa tự thêm: khóa không đang chờ làm `setup.py` thoát 1.
2. **MW-3/AG-1:** bản ghim không có câu hỏi/khóa ngôn ngữ → "tiếng Việt" phải nằm trong instructions `bmad.md`
   (yêu cầu viết tài liệu tiếng Việt), không qua `setup.py`. Luật câu trả lời v2 (`bmad-schemas.ts`) chỉ dùng khi
   manifest có câu hỏi; hiện không có.
3. **MW-2:** `_bmad/scripts` của repo phải giống từng byte `<pin>/skills/bmad/scripts` — đúng như đo (gồm cả
   `tests/`). Thư mục rỗng không track không ảnh hưởng checksum/so byte.
4. **MW-2:** danh sách `BUILTIN_SKILLS`/`BUILTIN_AGENTS` hiện có khớp claude 2.1.295; plugin ghim báo
   `source: "bmad@inline"`.
5. **DP-1:** worktree BMAD rẽ từ `origin/main` (`d453bb8`), không từ `main` local (`cdaaeb5`).

## Dọn

`~/crew-r23-probe/{clone,src-local,src-https,proj,repo-a-clone}` và file đo lẻ đã xóa. Giữ `~/crew-r23-probe/pin/`
tới khi MW-1 xong (ghi trong `processes.md`).
