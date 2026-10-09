# Crew v3 R2-3: gói `probe` (SP-0, cổng G0), kế hoạch thực thi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đo trên Mac mini năm giả định A1–A5 của spec §9 và ghi ra những giá trị mà MW-1/MW-3/AG-1 chép nguyên:
checksum và `executables` của bản BMAD lắp sẵn, dạng JSON câu hỏi của `setup.py`, file `setup.py` ghi ra, tên skill
trong `system/init`.

**Architecture:** Không sửa repo nào. Mọi file tạm ở `~/crew-r23-probe/` (ngoài vùng TCC). Không tạo bản ghi nào trên
Paperclip prod, không run Paperclip. Tối đa 3 lệnh `claude -p` với `claude-sonnet-5`.

**Tech Stack:** `/usr/bin/git`, `tar`, `shasum`, `uv` 0.12.x, `claude` CLI (cùng bản agent dùng), Node ≥ 22.

**Spec:** [plan.md](plan.md) (Global Constraints, Interface I1, I2, I5) và spec §2.2, §4.2–4.6, §9.

## Global Constraints

Áp dụng Global Constraints của [plan.md](plan.md). Riêng SP-0:
- Ghi dòng `SP-0 bắt đầu` (giờ `date`) vào [sdd-ledger.md](sdd-ledger.md) trước lệnh đầu tiên.
- Không ghi gì dưới `~/.claude`, `~/.crew/workflows`, `~/crew-agents`. Không đọc HEAD/working tree marketplace để làm
  nguồn: chỉ `git archive <revision>`.
- `claude -p` chạy trong repo git tạm dưới `~/crew-r23-probe/`, luôn có `--setting-sources project,local`,
  `--output-format stream-json --verbose`, `--max-turns` ≤ 3, `--model claude-sonnet-5`. Không chạy trong repo thật.
- Ghi PID mọi process nền (không dự kiến có) vào [processes.md](processes.md).

---

### Task 1 (SP-0): Đo A1–A5 và viết `probe-report.md`

**Files:**
- Create: `plans/261010-0030-crew-v3-r2-3/probe-report.md`
- Modify: `plans/261010-0030-crew-v3-r2-3/{sdd-ledger,processes}.md`

**Interfaces:**
- Consumes: không.
- Produces (MW-1, MW-3, AG-1 chép nguyên):
  - `BMAD_PIN.checksum` (64 hex), `BMAD_PIN.executables` (đường dẫn tương đối, sắp theo byte), số file bản lắp.
  - Dạng JSON đầu ra của `setup.py --list-config-questions` (một mẫu thật) và danh sách file `setup.py` tạo.
  - Tên plugin và tên skill BMAD trong `system/init`.

- [ ] **Step 1: A1 — lấy nguồn bằng `git archive` và lắp bản ghim.**

```bash
set -euo pipefail
P=~/crew-r23-probe; REV=d009608292d8a2ea4df846de7dca2f0d78a9e22d
mkdir -p "$P" && chmod 700 "$P"
M=~/.claude/plugins/marketplaces/bmad
git -C "$M" cat-file -e "$REV^{commit}" && echo "local=yes"
mkdir -p "$P/src-local" && git -C "$M" archive --format=tar "$REV" plugins/method/skills plugins/toolbox/skills | tar -x -C "$P/src-local"
git clone --filter=blob:none --no-checkout https://github.com/bmad-code-org/bmad-plugins.git "$P/clone"
mkdir -p "$P/src-https" && git -C "$P/clone" archive --format=tar "$REV" plugins/method/skills plugins/toolbox/skills | tar -x -C "$P/src-https"
diff -r "$P/src-local" "$P/src-https" && echo "local=https"
```

Lắp `$P/pin` đúng I2: `skills/` = hợp `plugins/method/skills/*` và `plugins/toolbox/skills/*` (kiểm không trùng tên:
`comm -12 <(ls …method/skills) <(ls …toolbox/skills)` rỗng), ghi `.claude-plugin/plugin.json` bằng `printf '%s\n'` đúng
chuỗi `BMAD_PLUGIN_JSON` trong I1 (không xuống dòng thừa). Tính checksum bằng thuật toán shell ở
`r2-2:docs/flows/mac-workflows.md` mục "Thuật toán checksum cây":

```bash
cd "$P/pin" && find . -type f ! -path './.in_use/*' | LC_ALL=C sort | while IFS= read -r f; do
  printf '%s\0%s\n' "${f#./}" "$(shasum -a 256 "$f" | cut -d' ' -f1)"; done | shasum -a 256
find . -type f -perm -u+x | sed 's|^\./||' | LC_ALL=C sort     # → executables
find . -type f | wc -l                                          # → số file
```

Ghi: có object local không, local = https không, checksum, `executables`, số file, thời gian clone https.

- [ ] **Step 2: A2 — `setup.py` không tương tác.** Repo tạm `"$P/proj"` (`git init`, một commit README). Chạy:

```bash
S="$P/pin/skills/bmad"
time uv run --no-cache "$S/scripts/setup.py" --project-root "$P/proj" --skill "$S" --list-config-questions > "$P/questions.json"
```

  Ghi nguyên `questions.json` (nó là câu hỏi, không có bí mật) vào report. Viết file câu trả lời theo đúng mẫu TOML
  `[modules."<module>"]` của `references/setup.md` với giá trị `default` của từng câu, trừ ngôn ngữ giao tiếp/tài liệu =
  `Vietnamese` nếu có câu đó. Chạy setup:

```bash
time uv run --no-cache "$S/scripts/setup.py" --project-root "$P/proj" --skill "$S" --module-answers "$P/answers.toml" > "$P/setup.json"
git -C "$P/proj" status --porcelain --untracked-files=all
diff -r "$S/scripts" "$P/proj/_bmad/scripts" && echo "scripts=identical"
```

  Ghi: cờ đúng tên (nếu `--module-answers` sai tên thì đọc `setup.py --help` và ghi cờ đúng), mã thoát, thời gian, có
  tải gói Python qua mạng không (`uv` in "Downloading"/"Installed"), danh sách file tạo, có `*.user.toml` không, nội dung
  `_bmad/config.toml` (khóa, không giá trị nhạy cảm), `diff` scripts. Chạy lại lần hai: có đổi file nào không. Thử
  `resolve_config.py --project-root "$P/proj" --key modules.bmm.planning_artifacts` (khóa đúng theo module có thật) và ghi
  đường `planning_artifacts`.

- [ ] **Step 3: A3 — `system/init` với bản ghim BMAD.** Trong `"$P/proj"` (đã có `_bmad`, commit hết):

```bash
cd "$P/proj" && claude -p "Trả lời đúng một chữ: OK" --model claude-sonnet-5 --max-turns 1 \
  --setting-sources project,local --plugin-dir "$P/pin" --output-format stream-json --verbose > "$P/init-bmad.jsonl"
```

  Lấy dòng `type=system, subtype=init` đầu tiên: ghi `plugins[]` (name, source, path, version), các skill bắt đầu
  `bmad:` (đếm, liệt kê 5 cái đầu), có `superpowers` không, `skills` không rõ nguồn nào.
  Lần 2: thêm `.claude/settings.json` = `{"enabledPlugins":{"superpowers@claude-plugins-official":true}}`, commit, chạy
  lại cùng lệnh ra `init-bmad-sp.jsonl`. Ghi: Superpowers có xuất hiện không, `path` của nó (cache owner?).

- [ ] **Step 4: A4 — repo AC.** Xác định checkout của `repo-a` trên Mac mini: `ls ~/crew-agents/`, `git -C
  ~/crew-agents/reviewer remote -v`, `git -C ~/crew-agents/reviewer rev-parse --git-common-dir`. Ghi: có
  `docs/flows.yaml` không, `git config crew-docs.bundle` có không, hook pre-commit có gọi `crew-docs` không,
  `.claude/settings.json` có `enabledPlugins` gì, đã có `_bmad/` chưa, đường kho chung (để DP-1 `worktree add`). Chỉ đọc.

- [ ] **Step 5: A5 — skill trợ giúp chạy không cần người.** Trong `"$P/proj"` (không có PRD):

```bash
claude -p "Dùng skill bmad:bmad. Câu hỏi: dự án mới chưa có tài liệu nào; để có danh sách epic và story thì làm skill nào trước, theo thứ tự nào? Chỉ trả lời danh sách tên skill." \
  --model claude-sonnet-5 --max-turns 3 --setting-sources project,local --plugin-dir "$P/pin" \
  --output-format stream-json --verbose > "$P/help.jsonl"
```

  Ghi: câu trả lời cuối (danh sách skill), số turn, có dừng chờ người không. Đọc
  `skills/bmad-create-epics-and-stories/steps/step-01-validate-prerequisites.md` và ghi điều kiện đầu vào (PRD,
  architecture bắt buộc hay không).

- [ ] **Step 6: Viết `probe-report.md`** với các mục `A1`…`A5`, mỗi mục: lệnh, đầu ra rút gọn, kết luận **đạt/không
  đạt** theo quy tắc G0 trong bảng "Đợt chạy" của [plan.md](plan.md). Mục cuối "Giá trị cho MW-1/MW-3" là khối code chép
  được:

```ts
// cho BMAD_PIN (bmad-pin.ts)
checksum: '<64 hex của Step 1>',
executables: [ /* từng dòng của Step 1, theo thứ tự đã sort */ ],
// số file: <n>
```

  và mẫu `questions.json`, danh sách file `setup.py` tạo, cờ đúng của `setup.py`.

- [ ] **Step 7: Dọn.** `rm -rf ~/crew-r23-probe/{clone,src-local,src-https,proj}`; giữ `pin/` tới khi MW-1 xong thì xóa
  (ghi vào `processes.md` dòng "giữ tới MW-1"). Ghi ledger dòng kết quả G0 (đạt/không đạt từng A, quyết định a–e).
