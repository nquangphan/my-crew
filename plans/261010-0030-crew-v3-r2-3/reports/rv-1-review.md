# RV-1 R2-3 (BMAD): review toàn nhánh trước deploy

Người review: RV-1 (opus), chỉ đọc và chạy test, không sửa code, không commit code, không push.
Thời gian: 10/10/2026 01:40–01:50 (giờ `date`, Asia/Ho_Chi_Minh).

Phạm vi:
- Repo Crew: `git diff r2-2..r2-3`, `r2-3` @ `9b927ea`, 5 commit (`1002ba5`, `79728c9`, `2df1589`, `445bf07`, `9b927ea`),
  49 file, +4180/−127. Worktree `.worktrees/crew-r23-mac`.
- Fork: `git diff crew/r2-2..crew/r2-3`, `crew/r2-3` @ `734a049f1`, 15 file, +592/−50. Worktree
  `.worktrees/paperclip-r23-agents` (HEAD = `734a049f1`).

Tài liệu đã đọc: `plan.md` (Global Constraints, Review Focus, Interface I1–I8), `sdd-ledger.md` (mọi mục tự quyết),
`reports/sp-0-probe.md`, spec `docs/superpowers/specs/2026-10-10-crew-v3-r2-3-bmad-design.md`. Đối chiếu thêm với bản
ghim BMAD (đọc `git show` trong `~/.claude/plugins/marketplaces/bmad` @ `d009608`, chỉ đọc): `setup.py`,
`config_utils.py`, `resolve_customization.py`, `epics-template.md`, `references/headless.md`.

## 1. Kết quả lệnh (tầng phát hành)

| Nơi | Lệnh | Kết quả |
|---|---|---|
| crew-r23-mac | `pnpm -r typecheck` | rc 0 (docs-kit, crew-mac, mac-app sạch) |
| crew-r23-mac | `pnpm lint` (biome check .) | rc 0, 301 file, không lỗi |
| crew-r23-mac | `node packages/docs-kit/dist/crew-docs.cjs check --range r2-2..r2-3` | `ok (5 commits)`, rc 0 |
| crew-r23-mac | `pnpm -r test` | rc 0: crew-mac 51 file / **900/900**, docs-kit 43/43, mac-app 38 file / 403/403 (một dòng log `app log write failed: EEXIST` trong test mac-app, không làm đỏ) |
| paperclip-r23-agents | `crew/release/verify.sh` (01:40–01:42) | **XANH** rc 0: `Hook một dòng: 5/5; mục: 9; lỗi: 0`; server crew 22 file / 431/431; adapter-claude-local 3 file / 17/17; plugin 21 file / 60/60; `node --test crew/agents/*.test.mjs` tổng 142 pass (9+5+8+18+102), 0 fail; 3 lần `tsc --noEmit` sạch; build plugin + kiểm `require("react` sạch |
| Máy | `ipcs -m` trước/sau `verify.sh` | 1 segment (`0x5110a261`) cả trước và sau, không postgres sót |

Không lệnh nào treo. Máy không có `timeout` (GNU) nên lần gọi đầu `timeout 900 verify.sh` thoát 127 ngay; chạy lại không
bọc, xong sau 2 phút.

Probe bổ sung (không đụng repo): một file vitest tạm trong scratchpad của phiên, import `src/` của worktree, dựng HOME giả
và repo git tạm bằng `mkdtemp` rồi gọi `discoverSources` thật. Kết quả dùng ở M1, m1, m2 bên dưới.

## 2. Kiểm theo ưu tiên của ticket

| # | Mục | Kết luận |
|---|---|---|
| 1 | Cách ly workflow | Đạt phần chính: `workflowForPluginDir` chỉ nhận đúng thư mục ghim hiện hành (so `comparablePath`), checksum cây tính lại mỗi run, wrapper giữ luật đúng một `--plugin-dir`; nạp chéo qua `enabledPlugins` (kể cả `bmad-method`/`bmad-toolbox` trong run BMAD) bị chặn; `settings.local.json` bật plugin bị chặn; `run-init-check` bắt nạp hai workflow. `BMAD_PIN.checksum` = SP-0 (`7f62e5cb…`). Có lỗ hẹp: M1 (kẹt sau setup bị ngắt), m1 (pyc), m2 (symlink `_bmad`), m3 (file không phải toml dưới `_bmad/custom`) |
| 2 | Policy BMAD | Server đạt: marker chỉ xét ở nhánh agent tạo, sau mọi luật từ chối; template `bmad` là siêu tập của `child` (thêm approval owner), không có stage docs/push nên H2 không đổi; agent không đổi được policy (`crew_policy_locked`), không ký thay owner (lõi chỉ ghi decision của `currentParticipant`); giả marker chỉ làm thêm bước owner. Hook 5/5. Điểm yếu là phía instructions: M2 |
| 3 | Trợ Lý tạo story | Đạt về khóa: `crew-child:<id gốc>:bmad-<identifier>:s<N>-<M>`, kế hoạch `revision=bmad-<id>` ghi trước POST đầu, bước 2 (đối soát) đứng trước 2b nên đánh thức lại không lập kế hoạch mới. Blocker đúng chuỗi (parser bảo đảm epic/story liên tục). Trần 30 do parser ép. Thiếu: m5, m6, m7 |
| 4 | `setup-project` | Không ghi `.claude/**` (`setup.py` không chạm `.claude`, đã grep); câu trả lời chỉ là `default` của script, qua `checkBmadAnswers`, file tạm 0600 xóa trong `finally`, stdout chỉ in danh sách file; xóa `*.user.toml` sau setup. Không mạng ở đường setup thường (urllib chỉ dùng ở `--update`), nhưng chưa ép: m4 |
| 5 | GC | Đạt: bản hiện hành luôn giữ; dấu pid sống giữ; dấu hỏng coi như sống tới 7 ngày; `*.tmp-*`, tên lạ, symlink bỏ qua; `rmSync(force)` nên hai GC song song không lỗi; wrapper chỉ ghi dấu sau khi `workflow-check` nhận thư mục, mà `workflow-check` chỉ nhận bản hiện hành, nên không có đua giữa ghi dấu và GC. Lệch nhỏ: m8 |
| 6 | Instructions vs quy tắc hiện có | `bmad.md` có đủ: PATCH là lệnh ghi cuối (FX-10), 422 thì dừng, cấm `PUT …/title`, mục "File đính kèm" (I8), `crew-commit` đúng regex của plugin (`^crew-commit sha=<40>`). Integrator không cần sửa (gom theo `crew-commit` + `crew-review` chung). Không thấy mâu thuẫn |
| 7 | Docs khớp code | Khớp phần lớn (`mac-workflows.md`, `mac-setup.md`, `mac-orphan-reaper.md`, `flows.yaml` chỉ khối `mac-workflows`). Lệch: m8 (luật 7 ngày, ý nghĩa mtime), m4 ("không mạng") |
| — | Phạm vi file | Fork: đúng danh sách Global Constraints (2 file `server/src/crew`, 2 test, `core-hooks.json` chỉ `description` H4, `crew/agents/**`); không đụng `packages/crew-plugin`, `ui`. Repo Crew: chỉ `apps/crew-mac/**` và docs; `apps/mac-app` không đổi |

Mục tự quyết trong ledger, đã soát và chấp nhận:
- MW-2 chặn `bmad-method@*`/`bmad-toolbox@*` trong run BMAD (plan ghi `pinned`): chặt hơn plan, đúng hướng fail đóng. Có test.
- MW-1 `installBmadPin` trả `Promise`: mọi nơi gọi đều `await` (`setup`, `workflows install`); typecheck mac-app sạch.
- SV-1 bỏ ca "decision approval do reviewer ký đã lưu": đúng, lõi chỉ ghi decision của `currentParticipant`, sửa
  `issue-gate.ts` thì ra ngoài phạm vi.
- AG-1 heading tiếng Anh + headless: đã kiểm bản ghim có `references/headless.md` cho `bmad-prd`, `bmad-ux`,
  `bmad-architecture`; heading đúng `epics-template.md` mà parser đọc.

## 3. Finding

Không có **blocker**.

### Major

**M1. Run BMAD bị ngắt ngay sau `setup-project` thì mọi run sau kẹt 78; agent không tự gỡ được.** Gói `mac-workflows`.
- Chỗ: `apps/crew-mac/src/workflows/inventory.ts:494-495` (`_bmad/config.toml` đi qua `judge`, chưa track là chặn) so
  với ý định ở `inventory.ts:459-461` và `docs/flows/mac-workflows.md:153-157` ("chưa commit mà giống thì vẫn cho qua:
  run trước bị ngắt ngay sau `setup-project`"); Review Focus 2 của plan.
- Kịch bản: `setup.py` luôn tạo `_bmad/scripts/**` **và** `_bmad/config.toml` cùng lúc (SP-0 A2 mục 4). Run bị ngắt sau
  `setup-project`, trước commit. Run kế: `_bmad/scripts` là `pinned` (cho qua), nhưng `_bmad/config.toml` chưa track nên
  `blocked`. Probe xác nhận: `["_bmad/config.toml :: không được git track trong worktree agent"]`. Wrapper thoát 78
  trước khi claude chạy, nên agent BMAD không bao giờ tới bước commit; mỗi lần đánh thức lại đỏ ngay. Owner phải vào
  worktree `~/crew-agents/bmad` xóa hoặc commit tay. Test hiện có (`workflows-inventory.test.ts:531`) chỉ dựng
  `_bmad/scripts`, không có `config.toml`, nên không bắt được.
- Đề xuất (chọn một, đều nhỏ): (a) khi `_bmad/scripts` khớp bản ghim mà chưa commit, coi `_bmad/config.toml` chưa track
  là `pinned` nếu nó đúng là bản `setup.py` ghi (cùng lần dựng, ví dụ không có file nào khác dưới `_bmad/` đã track);
  hoặc (b) giữ chặn nhưng thêm vào `bmad.md` mục "Trước khi làm" và vào câu `fix` lệnh cụ thể cho owner
  (`git -C <root> add -- _bmad && git commit …` hoặc `rm -rf _bmad`), và thêm ca test có cả `config.toml`. Ít nhất
  phải sửa docs/comment để không hứa điều code không làm.
- Không chặn deploy: AC chạy `setup-project` rồi commit ngay trong cùng run, cửa sổ nhỏ; nhưng nếu xảy ra trong AC thì
  tốn một lần owner can thiệp.

**M2. Bước owner duyệt epic/story phụ thuộc Trợ Lý viết đúng từng ký tự dòng marker; lệch thì server lặng lẽ gắn
template `child` và chỉ còn chữ trong instructions giữ cổng.** Gói `agents`.
- Chỗ: fork `server/src/crew/issue-create-policy.ts:35,86-89` (regex `^crew-kind bmad[ \t]*$`, không nhận khoảng trắng
  đầu dòng, CRLF, dấu backtick); `crew/agents/assistant.md` mục "Chọn workflow" (marker ghi trong backtick:
  ``…và `crew-kind bmad` ``, test `instructions.test.mjs:546` phải bỏ backtick mới khớp) và mục "Tạo story từ BMAD"
  bước 1.
- Kịch bản: Trợ Lý chép marker kèm backtick, thụt đầu dòng, hay mô tả có `\r\n` → H4 trả template `child`
  (`[review reviewer]`), không báo gì. Con BMAD qua reviewer là `done`. Bước 1 của "Tạo story" chỉ ghi "chứa id của cả
  hai stage trong `executionPolicy.stages` (review và approval)": với policy một stage, LLM có thể hiểu "mọi stage đã
  xong" và tạo story khi owner chưa duyệt. Đây là đường lách cổng owner ở mục ưu tiên (2), dù không do agent cố ý.
- Đề xuất (chỉ instructions + test, không đụng server): (a) `assistant.md` mục "Chọn workflow": sau khi POST con BMAD,
  đọc lại con, kiểm `executionPolicy.stages` có đúng 2 stage, stage 2 `type=approval` với participant là user; sai thì
  comment lỗi trên gốc và dừng (không giao tiếp). (b) Mục "Tạo story" bước 1: ghi rõ "`executionPolicy.stages` phải có
  đúng 2 stage, stage thứ hai `type=approval`; ít hơn hoặc khác là dừng" thay vì "cả hai". (c) Đưa dòng marker ra khối
  code riêng (không backtick inline) như các marker nhiều dòng khác. Thêm khẳng định vào `instructions.test.mjs`.
- Không chặn deploy nhưng nên vào trước AC (AC4 kiểm đúng điều này).

### Minor

**m1. `.pyc` đã commit dưới `_bmad/scripts/__pycache__` không bị xét, lách được luật "script giống từng byte bản ghim".**
Gói `mac-workflows`. `inventory.ts:72-81,422` (`isJunk` bỏ `__pycache__`/`*.pyc` cả khi đã track),
`commands/bmad.ts:74` (`scriptsAtRev` cũng bỏ). Probe: commit `_bmad/scripts/__pycache__/config_utils.cpython-312.pyc`
→ không `blocked`, `scripts` là `project`; reviewer cũng thấy `scriptsMatchPin: true`. Python nạp `.pyc` dạng
unchecked-hash (PEP 552) mà không đối chiếu nguồn, nên `resolve_customization.py`/`resolve_config.py` (import
`config_utils`) chạy mã khác bản ghim. Cần người merge được vào nhánh mặc định, nên rủi ro thấp. Đề xuất: file rác đã
**track** dưới `_bmad/scripts` (trong `git ls-files`, hay trong `ls-tree --rev`) là khác bản ghim; rác chưa track (do
chính run tạo) vẫn bỏ qua.

**m2. `_bmad` (hay `_bmad/scripts`) là symlink ra ngoài worktree không bị chặn theo đường dẫn.** Gói `mac-workflows`.
`inventory.ts:471-475` chỉ `lstat` `_bmad/scripts`, không `lstat` `_bmad`. Probe: commit `_bmad -> /tmp/…` chứa bản sao
script đúng byte → `_bmad/scripts` là `pinned`, không chặn. Thực tế `config.toml` qua symlink sẽ bị chặn (key
`_bmad/config.toml` không có trong index) và skill cần `config.toml`, nên khó khai thác; nhưng nội dung ngoài worktree
có thể đổi sau lúc kiểm. Đề xuất: `_bmad` là symlink (đã track hay chưa) thì `blocked` như `.claude` symlink.

**m3. `_bmad/custom/**` chỉ xét `*.toml`.** Gói `mac-workflows`. `inventory.ts:496`. Bản ghim nhắc
`{project-root}/_bmad/custom/packs/regulatory.md`, `_bmad/style-guides/company-voice.md` làm nội dung tùy biến do toml
trỏ tới; file `.md` chưa track/sửa dở được nạp mà không xét. Đề xuất: xét mọi file dưới `_bmad/custom/**` như
`config.toml`.

**m4. `setup-project` chưa ép "không mạng".** Gói `mac-workflows`. `src/bmad/setup-project.ts:181-190`;
`docs/flows/mac-workflows.md:388` ghi "không mạng". `uv run --no-cache` vẫn tải Python được quản lý khi máy không có
Python ≥ 3.11. Đề xuất: thêm `--offline` (hoặc env `UV_OFFLINE=1`, `UV_PYTHON_DOWNLOADS=never`) để lỗi rõ thay vì tải
ngầm; docs ghi điều kiện Python có sẵn.

**m5. Trợ Lý không đối chiếu `sha` của `crew-bmad-result` với `crew-review … verdict=approved`.** Gói `agents`.
`assistant.md` "Tạo story" bước 2 lấy `crew-bmad-result` mới nhất của executor; nếu agent BMAD đăng kết quả mới sau khi
reviewer duyệt (trước khi owner duyệt), Trợ Lý tạo story từ commit reviewer chưa xem. Đề xuất: bắt buộc `sha` trùng
`crew-review sha=<sha> verdict=approved` mới nhất do reviewer participant viết (như `integrator.md` đã làm).

**m6. Điều kiện kích hoạt 2b chỉ dựa vào chữ `crew-kind bmad` trong mô tả con.** Gói `agents`. Không kiểm con đó có
`crew-child key=bmad-1 revision=v1` trong kế hoạch của chính Trợ Lý và assignee thuộc "Agent BMAD của company". Con do
agent khác tạo dưới gốc (H4 vẫn gắn template `bmad`, owner vẫn phải duyệt) hay story mà `body` có dòng `crew-kind bmad`
(chép nguyên văn từ file epic) sẽ làm Trợ Lý thử chạy nhánh BMAD. Owner vẫn là cổng, và bước 2 dừng khi thiếu
`crew-bmad-result`, nên chỉ là nhiễu. Đề xuất: 2b chỉ áp cho con có `child-key` `bmad-1` trong kế hoạch đã ghi; parser
báo vấn đề khi `body` story có dòng bắt đầu `crew-` (tránh marker lọt vào mô tả con).

**m7. Con BMAD mở lại sau khi đã tạo story thì bản epic sửa bị bỏ qua lặng lẽ.** Gói `agents`. 2b chỉ chạy khi chưa có
kế hoạch `revision=bmad-<id>`. Đề xuất: nếu có `crew-bmad-result` mới hơn kế hoạch đã ghi, comment báo owner thay vì im
lặng.

**m8. GC lệch spec ở hai chỗ nhỏ.** Gói `mac-workflows`. `src/workflows/workflow-gc.ts:59-61,97-106`.
(a) Spec §4.5 "xóa dấu có pid đã chết **hoặc cũ hơn 7 ngày**"; code chỉ áp 7 ngày cho dấu không parse được, dấu hợp lệ
của pid đã cấp lại cho process khác giữ bản cũ vô hạn (docs có ghi là hạn chế chấp nhận). (b) "Thư mục đổi trong 24 giờ"
đo bằng mtime của thư mục ghim, mà ghi/xóa dấu chỉ đổi mtime của `.in_use/`, nên run vừa kết thúc không làm bản cũ
"mới". Cả hai thiên về an toàn (giữ lâu hơn) hoặc vô hại (run đã chết). Đề xuất: sửa câu trong spec/docs cho khớp code,
hoặc so `started` trong dấu với giờ sinh process của pid.

**m9. Check `agent-uv` là `fail` trên mọi Mac.** Gói `mac-workflows`. `src/commands/doctor.ts:413-430`. Mac chưa cài
`uv` (máy không chạy agent BMAD) sẽ có thẻ máy báo lỗi; `setup` không cài `uv`. Đề xuất: `warn` khi máy không có agent
BMAD, hoặc ghi rõ trong `mac-setup.md` là yêu cầu cài trước `setup`. Không ảnh hưởng Mac mini (SP-0: `uv` 0.12.13 có
sẵn).

**m10. Câu lý do `BMAD_SCRIPT_MISMATCH_REASON` gợi "chạy crew-mac bmad setup-project", nhưng lệnh đó `skipped` khi
`_bmad/scripts/resolve_config.py` đã có.** Gói `mac-workflows`. `inventory.ts:44-45`. Phần `fix` có nói "xóa
`_bmad/scripts` rồi chạy…", chỉ câu lý do gây hiểu nhầm. Khi nâng bản ghim BMAD sau này, mọi repo đã commit
`_bmad/scripts` cũ sẽ bị chặn tới khi owner dựng lại tay: nên ghi bước này vào hướng dẫn nâng bản ở `bmad-pin.ts`.

Ghi chú (không phải finding): `doctor` `worktree-workflows` quét mọi worktree bằng pin Superpowers (đúng spec §4.4), nên
worktree của agent BMAD có `bmad@*` trong `enabledPlugins` sẽ báo đỏ giả; `repo-a` không có `.claude/settings.json`
(SP-0 A4) nên AC không gặp. Template agent trong `apps/mac-app` không có mục BMAD (spec §10 cố ý); bản app kế tiếp cần
đồng bộ nếu muốn agent do app tạo dùng BMAD.

## 4. Kết luận

**Deploy được (DP-1)**, với điều kiện:
1. DP-1 kiểm `crew-mac doctor` trên Mac mini có `bmad-pin`, `agent-uv`, `superpowers-pin` = ok trước khi dựng agent BMAD.
2. M2 nên được sửa (FX gói `agents`, opus, chỉ `assistant.md` + `instructions.test.mjs`) trước AC-R2-3; nếu không kịp,
   AC4 phải kiểm tay `executionPolicy.stages` của con BMAD ngay sau khi Trợ Lý tạo, và AC dừng lượt 1 nếu chỉ có một
   stage.
3. M1 có thể sửa sau deploy (FX gói `mac-workflows`); trong AC, nếu run BMAD đầu bị ngắt sau `setup-project`, owner gỡ
   tay worktree `~/crew-agents/bmad` (commit hoặc xóa `_bmad`).
4. Minor m1–m10 gom một lô FX sau AC, không chặn deploy.

Status: DONE_WITH_CONCERNS
Summary: Toàn bộ lệnh tầng phát hành xanh (repo Crew typecheck/lint/docs/test 900+43+403; fork verify.sh XANH, hook 5/5). Không có blocker; 2 major (kẹt 78 sau setup-project bị ngắt; cổng owner duyệt phụ thuộc định dạng marker do Trợ Lý viết) và 10 minor.
Concerns/Blockers: M2 nên sửa (instructions) trước AC-R2-3; M1 sửa sau deploy được, có cách gỡ tay.
