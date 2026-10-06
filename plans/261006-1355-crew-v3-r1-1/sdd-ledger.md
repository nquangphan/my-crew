# SDD ledger — plan: plans/261006-1355-crew-v3-r1-1/plan.md

Bắt đầu 06/10/2026 14:55 (Asia/Ho_Chi_Minh). Spec: docs/superpowers/specs/2026-10-05-crew-v3-paperclip-design.md (đã cập nhật 23e8aafc).

## Điều chỉnh so với skill (owner chốt)
- Ruling: mỗi gói ngữ cảnh một implementer giữ ngữ cảnh, làm lần lượt các task trong gói (nhắn tiếp), không fresh-per-task — owner yêu cầu tránh nạp lại cùng ngữ cảnh — sai thì context bias, reset khi lỗi lặp.
- Ruling: song song giữa các gói (release, mac-setup, RT-3) vì file ghi rời nhau và worktree riêng — sai thì merge conflict nhẹ ở crew/ops.
- Ruling: reviewer theo gói, không bao giờ là implementer — runtime dùng reviewer gói moi-truong của spike (đã review P1–P3); release và mac-setup reviewer mới opus.

## Worktree
- Fork RL-1, RL-2, RT-1, RT-2, RT-4: `.worktrees/paperclip-r1-1` nhánh `crew/r1-1` từ `v3` 8f8a0ab7e.
- Fork RT-3: `.worktrees/paperclip-rt3` nhánh `crew/rt3-backup` từ `v3`; merge vào `crew/r1-1` trước RT-4.
- Repo Crew MS-1, MS-2: `.worktrees/crew-mac` nhánh `r1-1/crew-mac` từ `v3` 23e8aafc.
- Ghi chú: `.worktrees/` hiện untracked trong repo Crew (không thêm được vào info/exclude vì hook chặn .git); mọi `git add` theo đường dẫn cụ thể.

## Soát trước khi chạy
| Cặp/Task | Sản xuất ↔ tiêu thụ | Kết quả |
|---|---|---|
| RL-1 ↔ RT-1 | `crewCoreHooks.onRunLeaseReleased(input: EnvironmentDriverReleaseInput & { db: Db })` | Khớp sau đối chiếu (release.md, runtime.md) |
| RL-1 ↔ RT-2 | `beforeClaim({ db, run }): Promise<boolean>` | Khớp |
| RL-1 ↔ RT-4 | `server/src/crew/` trong image overlay; plugin `crew.core` capability thêm ở RT | Khớp |
| RT-1 ↔ MS-1 | wrapper `~/.crew/bin/crew-claude-run`, `pgid`/`started` dưới `.paperclip-runtime/runs/<runId>/` | Khớp; RT-1 test dùng fixture |
| RT-1 ↔ MS-2 | `PAPERCLIP_RUN_ID`, chuỗi cha không còn sshd, grace 60s, ClientAliveCountMax 2 | Khớp |
| RT-3 ↔ RT-4 | backup trước deploy dùng script RT-3 | RT-3 merge vào crew/r1-1 trước RT-4 |
| RT-3 ↔ owner | bản sao ngoài VPS | Ruling: kéo về Mac mini (owner chốt 14:55) — RT-3 thêm script pull chạy trên Mac mini qua Tailscale, giữ 14 ngày |
| Task tự nhất quán | release.md, runtime.md, mac-setup.md | Mỗi gói đã tự review; Trợ Lý đã sửa con số cửa sổ mồ côi thành tối đa 3 phút |

## Tiến độ
- RL-1: implementer xong 15:10 (8f8a0ab..d34509f, 5 commit). Concerns: git add -f vì .gitignore upstream có check-*.mjs; install 2 lần; docstring tiếng Việt. Dispatch reviewer release (opus).
- MS-1: implementer xong 15:20 (23e8aafc..7ce0ec77, 7 commit; 69 test, typecheck, build, Biome, crew-docs check range đạt). Concerns: R7 chặn chuỗi giống private key trong test → đổi đầu vào; flow mac-setup nhắc mac-orphan-reaper trước Task 9. Dispatch reviewer mac-setup (opus). MS-2 chờ review.
- RL-1 review: Spec ✅, Quality Approved; Important I1–I3.
  - Ruling: I1 — giữ `v3` nguyên tới sau review toàn nhánh; Task 7 và rollback dùng `8f8a0ab7e..crew/r1-1` — vì fast-forward v3 là bước tích hợp, không phải việc của RL-2 — sai thì phải sửa lại lệnh kiểm ở Task 7.
  - I2 (docstring lease không gắn run) + I3 (timeout 15s trong wrapper H3) → fix round 1 cho implementer release.
  - RL-1: minor (deferred): M1 scope `checkCoreHooks` chỉ dừng ở "\nfunction " — dùng regex có export/async.
  - RL-1: minor (deferred): M2 lỗi khi head biến mất báo sai thông điệp.
  - RL-1: minor (deferred): M3 tests của H1/H2 trỏ file không kiểm hành vi → RT-2 bổ sung test hành vi và trỏ lại.
  - Ruling: AC thêm cho RT-1 — implementation H3 trả về ngay khi lease không gắn run (I2) — sai thì H3 thử dừng process của lease probe.
  - RL-1: fix round 1/5 implementer xong (d34509f..52087b9; 6/6 crew-core-hooks, tsc, kiểm mốc 0 lỗi); dispatch re-review.
  - RL-1: fix round 1/5 (2 addressed, 0 open; commits d34509f..52087b9)
Task RL-1: complete (commits 8f8a0ab..52087b9, review clean)
  - Ruling: AC thêm cho RT-1 — lời gọi SSH của H3 tự có timeout < 15 giây (wrapper chỉ thôi chờ, không hủy) và kiểm lại đường tạo lease device-login/setup-token có thật sự heartbeatRunId null — sai thì lệnh SSH cũ chạy song song lease mới.
- MS-1 review: Spec ✅, Quality Needs fixes — Important: removePathBlock xóa đuôi zshenv khi thiếu dòng đóng; writeIfChanged phá symlink + đổi mode; TCC parse lệch định dạng báo ok; probe kill thiếu process group; forbiddenRootReason lách bằng hoa thường/symlink. Fix round 1 gửi implementer (kèm Minor -F /dev/null, NaN load).
  - MS-1: minor (deferred): manifest ghi sau ensureService khi chạy setup qua sshd agent.
  - MS-1: minor (deferred): createRunner chỉ resolve ở close, có thể treo khi cháu giữ stdout.
  - MS-1: minor (deferred): --probe-timeout nhận số lẻ/âm.
  - MS-1: minor (deferred): checkClaudePrint so /\bok\b/ trên stdout gộp stderr.
  - MS-1: minor (deferred): tcc-pending chỉ đọc 24 giờ.
  - MS-1: minor (deferred): key Paperclip không from=, sshd không DisableForwarding — chờ kiểm bridge có dùng forwarding (RT-4/AC-1).
  - MS-1: minor (deferred): uninstall xóa ~/.zshenv chỉ còn khoảng trắng; authorized-keys bỏ dòng trống.
  - MS-1: minor (deferred): assets/crew-claude-run.sh không thuộc flow nào vì source.include chỉ apps/*/src/** (sửa source cần owner duyệt R6).
- RT-3: implementer xong 15:00 (8f8a0ab..e1441ce trên crew/rt3-backup, 3 commit). Test 4/4, DRILL OK, pull 2/0 sha256 khớp. Lệch: systemd timer thay cron; forced command backup-serve.sh thay rrsync. Concern: bản sao trên Mac mini có .env + key Paperclip; key cũ có sẵn trên Mac mini vào root VPS không giới hạn (từ trước). Dispatch reviewer runtime.
- Ruling: RT-1/RT-2 làm trên worktree `.worktrees/paperclip-rt12` nhánh `crew/rt1-rt2` từ 52087b9 (RL-1 đã duyệt), song song với RL-2 trên crew/r1-1; merge cả ba nhánh (rt3-backup, rt1-rt2, r1-1) trước RT-4 — vì không cho hai worker dùng chung một worktree — sai thì merge conflict ở server/src/crew.
- RT-1: dispatch implementer runtime 15:08 (nhắn tiếp), AC thêm: H3 return sớm khi heartbeatRunId null; SSH trong H3 timeout < 15s.
- RL-2: implementer xong (52087b9..9301533, 1 commit; 13/13 test script; Task 7 upgrade.sh trên upstream/master thoát 0, 36s; nhánh bằng chứng sync/paperclip-upstream-master 34eadfa). Concern: --base mặc định v3 chỉ đúng sau khi merge; đường conflict chưa chạy thật. Dispatch reviewer release.
- RL-2 review: Spec ✅, Needs fixes — I1 base mặc định v3 chưa kiểm (thoát 127, nhánh rác); I2 hai đường conflict không test + đường lockfile mất importer crew-plugin. Fix round 1 gửi (kèm M1 worktree tương đối, M2 mã lỗi merge không do conflict, M3 dọn tmp).
- RT-3 review: Spec ✅, Needs fixes — Important: Mac xóa sạch bản sao nếu VPS ngừng backup >14 ngày.
  - Ruling: giữ tối thiểu 3 bộ + báo stale khi bộ mới nhất > 2 ngày — vì bản sao ngoài VPS là để phòng VPS hỏng — sai thì tốn thêm đĩa Mac.
  - Ruling: diễn tập restore chuyển vào /opt/crew-v3-spike/restore-drill, project crew-v3-spike-restore — global constraints chỉ cho đụng /opt/crew-v3-spike — sai thì không, chỉ đổi đường dẫn.
  - Ruling: key kéo backup dùng restrict + from=100.102.189.67 — siết hơn dải Tailscale — sai thì đổi IP Mac mini phải sửa dòng key.
  - Ruling: sửa /root/.ssh/authorized_keys và /etc/systemd/system trên VPS là ngoại lệ phạm vi, owner đã chấp nhận qua quyết định kéo backup và plan RT-3 — ghi để owner biết.
  - Minor đưa vào vòng sửa: symlink refuse, pull_set đúng tập tên, tar no-file-changed + .tmp, dọn .tmp, drill hủy run đang chờ.
  - Chờ owner: bí mật VPS (.env, key Paperclip) nằm trên Mac mini trong bản sao — chấp nhận hay mã hóa.
  - Có từ trước: key mặc định của Mac mini vào root VPS không giới hạn + 2 dòng khác trong authorized_keys root — báo owner rà.
  - Fix round 1 xếp hàng sau RT-1 (cùng implementer).
- MS-1: fix round 1/5 implementer xong (7ce0ec77..c13fda90; 85/85, typecheck, Biome, crew-docs đạt); dispatch re-review.
  - MS-1: minor (deferred): hint check `load` còn chữ "RT-2" (mã plan trong chuỗi hiển thị) — vi phạm luật không để mã plan trong code.
  - MS-1: fix round 1/5 (7 addressed, 0 open; commits 7ce0ec77..c13fda90)
Task MS-1: complete (commits 23e8aafc..c13fda90, review clean)
  - MS-1: minor (deferred): writeIfChanged với symlink trỏ file không tồn tại ghi đè symlink — dùng lstatSync.
  - MS-1: minor (deferred): probe không kill group khi claude thoát bình thường.
  - MS-1: minor (deferred): probe phụ thuộc /usr/bin/perl — kiểm ở AC-1 trên Mac mini.
  - RL-2: fix round 1 implementer xong (9301533..d994428; 17/17). Mã thoát mới 67.
  - RL-2: fix round 1/5 (5 addressed, 0 open; commits 9301533..d994428)
Task RL-2: complete (commits 52087b9..d994428, review clean)
  - RL-2: minor (deferred): mã thoát 67 chưa có trong bảng mã ở release.md Task 6.
  - RL-2: minor (deferred): test I1 chạy trên repo fork thật, nên chuyển sang fixture.
  - RL-2: minor (deferred): commit restore lockfile lấy mọi thay đổi pnpm install (kể cả hunk cpu:) — đọc diff trước khi tích hợp.
- MS-2: implementer xong (c13fda90..dce20e4d, 3 commit; 109/109). Lệch: TERM/KILL theo process group khi group chỉ của run đó, fallback từng pid. Dispatch reviewer mac-setup.
- RT-3: fix round 1 implementer xong (e1441ce..01f1dd5; 6/6, DRILL OK trong /opt/crew-v3-spike/restore-drill, key restrict + from=100.102.189.67 kiểm thật). Dispatch re-review.
- RT-1: implementer xong (52087b9..ab2cdbd trên crew/rt1-rt2, 2 commit; 34/34 gồm 7 test macOS thật, tsc, kiểm mốc). Dời sang RT-4/AC-1: kịch bản S3 thật, tool con có cùng process group không. Dispatch reviewer runtime.
- RT-2: dispatch implementer runtime (nhắn tiếp) trên crew/rt1-rt2 sau ab2cdbd, song song với review RT-1/RT-3; kèm M3 của RL-1 (test hành vi H1).
- MS-2 review: Spec ✅, Needs fixes — I1 extractRunId dò trên argv → giết nhầm `claude -p` của owner (đã chứng minh); I2 KILL theo group không kiểm lại thành phần (pgid tái dùng). Fix round 1 gửi (kèm grace ≥ 60, docs hành vi).
  - MS-2: minor (deferred): hai lệnh ps lệch thời điểm, có thể ghép env của pid tái dùng.
  - MS-2: minor (deferred): probe kill -9 group sau khi claude thoát có cửa sổ pgid tái dùng vài ms.
  - AC-1 cần kiểm: comm của sshd-session trong phiên LaunchAgent; ps -E từ LaunchAgent đọc được env claude; /opt/homebrew/bin/node và cliPath trên Mac mini.
- RT-2: implementer xong (ab2cdbd..be4927e, 1 commit; 50/50 gồm claimQueuedRun thật trên embedded PG; M3 RL-1 xong). Concern: Mac không tới được chặn tick tới 5s mỗi 15s/máy; hủy run quá hạn qua instance heartbeatService thứ hai. Xếp review sau RT-1.
  - RT-3: fix round 1/5 (4 addressed, 0 open; commits e1441ce..01f1dd5)
Task RT-3: complete (commits 8f8a0ab..01f1dd5 trên crew/rt3-backup, review clean)
  - RT-3: minor (deferred): backup.sh dọn *.tmp đầu script có thể phá lần backup chạy song song (RT-4 gọi backup trước deploy) — thêm flock.
- RT-1 review: Spec ✅, Needs fixes — Important: kiểm started−2 không chặn PGID tái dùng sau run (reap muộn) → kiểm thời điểm sinh của leader.
  - Ruling: kiểm "tool con có cùng process group với claude" ngay trên Mac mini trong vòng sửa RT-1, không dời RT-4 — vì quyết định thiết kế H3 trước deploy — tốn 1 lần chạy haiku trên tài khoản Mac mini.
  - RT-1: minor (deferred): run-cancelled.ts đọc-rồi-ghi không nguyên tử; run khác đang chờ khi chuyển blocked — kiểm ở RT-4 S3-3 (assert blocked + comment).
  - MS-2: fix round 1 implementer xong (dce20e4d..0eb31d81; 113/113). Dispatch re-review.
  - MS-2: fix round 1/5 (4 addressed, 0 open; commits dce20e4d..0eb31d81)
Task MS-2: complete (commits c13fda90..0eb31d81, review clean)
- RT-2 review: Spec ✅, Needs fixes — C1 cancelRun trong hook tự chờ lock agent 30s.
  - Ruling: C2 — thời hạn chờ của cổng tải tính từ activity crew.load_gate.waiting đầu tiên, chưa có thì từ bây giờ, không từ run.createdAt — vì run xếp hàng sau run dài bị hết hạn oan không có notice — sai thì run có thể chờ lâu hơn maxWaitMinutes tính từ lúc tạo.
  - Fix round 1 xếp sau vòng sửa RT-1 (cùng implementer), kèm C4 (comment trước activity), C5 (lỗi hủy chỉ log).
  - RT-2: minor (deferred): C3 Mac offline chặn tick tới 5s/15s/máy — ghi số đo S5-2 ở RT-4.
  - RT-2: minor (deferred): C6 chỉ đọc agents.defaultEnvironmentId — kiểm agent đã gán environment ở RT-4.
  - RT-2: minor (deferred): C7 test H1 cần embedded PG — xác nhận máy gate hỗ trợ.
- RT-2: fix round 1/5 (C1, C2, C4, C5 xong; commits be4927e..247981b; 55/55) — chờ re-review.
- RT-1: fix round 1/5 (PGID tái dùng xong 9dd24b2; 17/17). Thí nghiệm Mac mini: Bash tool chạy zsh trong process group riêng VÀ session riêng (Ss), ps -E không đọc env của binary Apple → H3 sót tool con là binary Apple. Đo lệnh dừng SSH thật 1,05s.
  - Ruling: nhận diện process của run = (a) con cháu của claude của run theo cây PPID (mọi group) ∪ (b') process mồ côi có cwd dưới worktree của run, không có tty, sinh sau started−2, và chuỗi cha không đi qua app nào khác ngoài launchd/các process thỏa cùng điều kiện — vì Bash tool tách cả group lẫn session; lọc tty + chuỗi cha để không đụng terminal/editor của owner mở trong worktree — sai thì sót process đã cd ra ngoài worktree.
  - Ruling: logic nhận diện viết MỘT chỗ trong crew-mac: lệnh `crew-mac stop-run --run-id <uuid> --root <worktree>` (in `crew-stop matched=… killed=… remaining=…`, exit 0) + reaper dùng chung hàm chọn; MS-1 cài launcher ổn định `~/.crew/bin/crew-mac`. H3 gọi lệnh này qua SSH, thiếu launcher thì quay về script hiện tại — vì tránh hai bản logic ở hai repo — sai thì H3 phụ thuộc node trên Mac (có fallback).
  - Việc mới: MS-3 (gói mac-setup) làm stop-run + chọn process mới + launcher; RT-1 fix round 2 (gói runtime) đổi H3 gọi stop-run có fallback. MS-3 trước, RT-1 vòng 2 sau (cần interface).
- Re-review D/E: RT-1 B1 ADDRESSED; Important mới: `started` ghi sau source profile, lệch >2s với lúc leader sinh → H3 bỏ group thật. RT-2 C1/C2/C4/C5 ADDRESSED; Minor mới: lỗi ghi ở nhánh hết hạn/chờ làm cổng mở.
  - Ruling: `started` = thời điểm sinh của process wrapper (ps lstart / now−etime), định dạng epoch giữ nguyên — sửa ở MS-3 (wrapper), RT-1 vòng 2 (fixture + fallback) — sai thì lệch so sánh nếu ps lstart lỗi.
  - Ruling: nhánh mồ côi có cận trên = `started` của run kế tiếp trong cùng runs/; process sinh sau thuộc run sau — vì dừng muộn không được giết process của run sau.
  - Ruling: chấp nhận giới hạn (b') với process owner tự tách nền trong worktree agent; ghi docs khuyến cáo — sai thì một process nền của owner trong worktree agent có thể bị dừng.
  - Ruling: lọc ứng viên trước rồi mới lsof; stop-run < 8s.
  - RT-2 fix round 2 gửi implementer (giữ cổng đóng khi ghi lỗi).
  - RT-2: fix round 2 implementer xong (247981b..f77f45d; 18/18 + 4/4). Dispatch re-review.
  - RT-2: fix round 2/5 (1 addressed, 0 open; commits 247981b..f77f45d)
Task RT-2: complete (commits ab2cdbd..f77f45d trên crew/rt1-rt2, review clean)
  - RT-2: minor (deferred): hai lỗi cùng lúc (ghi expired lỗi + hủy lần đầu lỗi) vẫn có thể mở cổng khi máy khỏe lại.
  - RT-2: minor (deferred): hủy chạy song song với blockIssue — kiểm issue cuối cùng blocked ở S5-2 của RT-4.
- MS-3: implementer xong (0eb31d81..f0533f8f, 5 commit; 140/140 gồm ps/lsof/kill thật). Chữ ký: `~/.crew/bin/crew-mac stop-run --run-id <uuid> --root <abs> [--term-wait-seconds 0..20, mặc định 5]` → `crew-stop matched= killed= remaining=` exit 0; đầu vào sai exit 2; lỗi nội bộ exit 1. `started` = thời điểm sinh wrapper (date − etime($$)), crew-mac so sai số 1s.
  - Ruling: chấp nhận nhánh (c) thêm (group ghi trong pgid, không tty, trong cửa sổ thời gian) — đó là đường pgid gốc — sai thì không.
  - Ruling: chấp nhận exit 1 khi lỗi nội bộ; H3 coi exit khác 0 là chưa dừng được, ghi activity, không xóa dấu — tránh báo remaining=0 sai.
  - Ruling: H3 truyền `--term-wait-seconds 3` để cả lệnh nằm trong timeout SSH 12s (server registry 15s) — MS-3 giả định 25s là sai cho R1.
  - Dispatch reviewer mac-setup cho MS-3; song song RT-1 vòng 2.
- MS-3 review: Spec ✅, Needs fixes — I1 nhánh (c) không kiểm leader/pgid tái dùng sau reboot; I2 root không giới hạn (HOME, '/'). Fix round 1 gửi (kèm Minor NaN etime, same() theo pid+startedAt, lstat symlink trước rm, stopRun tự kiểm UUID).
  - RT-1: fix round 2 implementer xong (f77f45d..f8fab88; 63/63). Mac mini: started khớp giờ sinh leader; fallback 0,99s. Đường stop-run thật để AC-1. Dispatch re-review.
  - RT-1: fix round 2/5 (1 addressed + đổi đường chính, 0 open; commits f77f45d..f8fab88)
Task RT-1: complete (commits 52087b9..f8fab88 trên crew/rt1-rt2, gồm cả RT-2 xen giữa, review clean)
  - Ruling: 2 Minor của RT-1 vòng 2 (parser neo dòng cuối, không khớp thì failed, ghi via; launcher exit 126/127 thì chạy fallback) làm ở đầu RT-4 cùng implementer — vì launcher hỏng làm H3 vô tác dụng — sai thì thêm một commit nhỏ.
  - Ruling: RT-4 chia RT-4a (gộp nhánh, sửa 2 Minor, dựng image overlay, deploy, cài plugin) ngay; RT-4b (kịch bản S3/S5 thật) sau khi owner cài crew-mac trên Mac mini ở bước AC-1.
  - MS-3: fix round 1 implementer xong (f0533f8f..29fa5c96; 157/157). stop-run exit 2 thêm: chưa có manifest (chưa setup) hoặc root ngoài worktreeRoot.
  - Ruling: ở AC-1 worktree agent chuyển sang dưới worktreeRoot của crew-mac (~/crew-agents/...) và environment mac-mini trỏ remoteWorkspacePath mới — vì stop-run từ chối root ngoài worktreeRoot.
  - MS-3: fix round 1/5 (2 Important + 4 Minor addressed, 1 Minor mở: NaN etime ở nhánh trả về sớm). Fix round 2 gửi (kèm sysctl tuyệt đối, setup cấm HOME làm worktree root) + hỏi cách cài crew-mac cố định trên Mac mini.
  - MS-3: fix round 2 implementer xong (29fa5c96..8eedaada; 164/164). Đề xuất cài AC-1: gói tgz vào ~/.crew/app/crew-mac rồi chạy setup từ bản cố định. Dispatch re-review.
  - MS-3: fix round 2/5 (3 addressed, 0 open; commits 29fa5c96..8eedaada)
Task MS-3: complete (commits 0eb31d81..8eedaada, review clean)
  - MS-3: minor (deferred): doctor check load gọi sysctl theo PATH; uninstall chưa gỡ ~/.crew/app.
- RT-4a: implementer xong (crew/r1-1: merge rt3-backup 3909820, merge rt1-rt2 ae71db1, rồi b23cb47..1b85a07). verify.sh xanh trên cây gộp. Server health ok commit 1b85a07ed, plugin crew.core ready. Agent mac-claude pause. Lưu ý: implementer reset --hard nhánh crew/r1-1 (chưa push, chỉ lần gộp của chính nó) để thêm dòng Claude-Session. Dispatch reviewer runtime cho ae71db1..1b85a07.
- AC-1 chuẩn bị: gói crew-mac 8eedaada (sha256 1581896d…) ở ~/.crew/app/crew-mac trên Mac mini; paperclip.pub đã đặt. Chờ owner chạy uninstall/setup/doctor. Sau đó: keyscan cổng 2222 cập nhật knownHosts env mac-mini + known_hosts VPS; worktree agent chuyển sang ~/crew-agents; command agent = ~/.crew/bin/crew-claude-run (đã đặt ở RT-4a).
- RT-4a review: Spec ✅, Quality Approved (5 Minor). RT-4 chưa complete — còn RT-4b.
  - Ruling: ngưỡng cổng tải về đúng plan maxLoad1 8 / maxWaitMinutes 60 — Mac mini là máy dùng hằng ngày của owner — sai thì run chờ nhiều hơn.
  - Ruling: đầu RT-4b làm Minor 1–4 (rollback.sh kiểm health exit 3 + nhắc plugin; deploy.sh gọi inspect-image và từ chối MISSING/FAIL; overlay-source từ chối khi HEAD≠COMMIT hoặc cây bẩn; assert image thật sự đổi) — rẻ, cùng implementer.
  - Ruling: trước khi resume agent mac-claude bắt buộc liệt kê issue todo/in_progress của agent và hủy/chuyển các issue thử cũ.
  - Ruling: giữ image crew-v3-spike/paperclip:in-place-6ab1aa8 tới khi RT-4b xong (đích rollback).
  - RT-4: minor (deferred): file xóa/đổi tên vẫn nằm trong image overlay (diff-filter ACMR).
  - RT-4: deferred: plugin phụ thuộc tsx loader dev + mã TS của @paperclipai/shared — chuyển sang bundle esbuild (gói release, sau R1-1).
- RT-4b chuẩn bị xong (1b85a07..ba18245): 4 Minor + ngưỡng 8/60; 3 issue thử cũ blocked (CRE-5, CRE-8, CRE-11) cần đóng trước khi resume. Dispatch re-review.
  - RT-4a Minor 1–4 ADDRESSED (1b85a07..ba18245), sha256 VPS khớp, ngưỡng 8/60 đã đặt.
  - RT-4: minor (deferred): deploy.sh chưa chặn crewCoreHooks=0; compose-set-image từ chối oan khi nhiều khoảng trắng sau image:; file cũ của plugin có thể sót vào image.
- Chờ owner chạy crew-mac uninstall/setup/doctor trên Mac mini, rồi RT-4b + AC-1.
- 16:00 Owner chạy crew-mac uninstall/setup/doctor trên Mac mini: doctor 12/12 đạt. Dispatch RT-4b (kịch bản thật) cho implementer runtime.
- 16:10 Owner: xong những việc đang chạy thì TẠM DỪNG. Đang chạy: RT-4b (implementer runtime). Sau khi RT-4b báo: chỉ review RT-4b + ghi kết quả AC-1, KHÔNG dispatch việc mới, KHÔNG review toàn nhánh, KHÔNG gộp nhánh vào v3, KHÔNG push.
  Điểm làm tiếp: review toàn nhánh (final review) cho fork crew/r1-1 + Crew r1-1/crew-mac; đánh giá minor hoãn; finishing-a-development-branch; rồi plan R1-2/R1-3.
- 16:12 Owner đổi lệnh: LÀM XONG R1-1 rồi dừng. Thay cho mục tạm dừng 16:10.
  - Ruling: sau RT-4b → review RT-4b → final review toàn nhánh (một reviewer model mạnh nhất, đọc cả fork crew/r1-1 lẫn Crew r1-1/crew-mac) → một đợt sửa + re-review → gộp: fork crew/r1-1 vào v3 cục bộ (không push fork — PR upstream để sau R1-1 theo owner), Crew r1-1/crew-mac vào v3 và push (owner đã cho push repo Crew) → cập nhật plan/board → dừng. Không bắt đầu R1-2.
- RT-4b xong (ba18245..afe688e): AC-1 12/13 đạt trên máy thật (hủy ~6s, restart ~6s, mất mạng reaper 138s, quá tải/offline/hết hạn đạt, DRILL OK 39 issue 81 run). Không đạt: mất mạng → commit trùng (process cũ commit 16:20:43 trước khi reaper giết 16:20:54; retry sau ~5 phút làm lại).
  - Ruling: R1-1 đạt theo spec Review Focus 1 (không báo thành công sai, không chạy song song, không mồ côi quá hạn). "Không commit trùng" chuyển thành yêu cầu bắt buộc R1-2: retry sau mất kết nối phải kiểm tiến độ worktree (commit kể từ started của run trước) trước khi làm lại — vì đó là tính idempotent của workflow agent, không giải được ở tầng kết nối — sai thì R1-1 phải thêm hook/plugin retry.
  - RT-4: minor (deferred): mã lỗi mất mạng claude_transient_upstream; comment chờ in nguyên lệnh ssh khó đọc; H3 ghi hai lần dừng sau restart.
  - Dispatch review RT-4b.
Task RT-4: complete (RT-4a 1b85a07 + Minor ba18245 reviewed; RT-4b afe688e script theo dõi, gộp vào final review)
- Final review toàn nhánh: dispatch code-reviewer model fable cho fork 8f8a0ab..afe688e và Crew 23e8aafc..8eedaada.
- Final review (fable): sẵn sàng gộp sau một đợt sửa; không Critical. Phải sửa trước gộp: I1 launcher kiểm node/cli → exit 127 + doctor fail; I2 key Paperclip dùng options như key doctor (from= Tailscale, no-*-forwarding); I4 bỏ mã plan (MS-2, S3, AC-1, D1) khỏi code/test hai repo; docs mac-setup.md nguồn wrapper + comment 25s trong cli.ts.
  - Ruling: I3 (stop-run exit 2 → fallback), I5 (cổng tải chờ vô hạn khi comment lỗi bền), I6 (uninstall khi còn run sống) chuyển thành việc bắt buộc đầu R1-2 cùng yêu cầu retry kiểm tiến độ worktree — theo đề xuất reviewer, cấu hình hiện tại khớp nên không chặn R1-1.
  - Ruling: một đợt sửa duy nhất giao implementer gói mac-setup (phần lớn ở crew-mac; phần fork chỉ đổi chuỗi trong fixture/test); sau sửa, cài lại gói crew-mac lên Mac mini và chạy `setup` qua SSH chỉ khi không cần nạp lại service (sshd_config không đổi), rồi doctor.
- Đợt sửa cuối xong: Crew 8eedaada..2f0f5c5d (170/170), fork afe688e..e1c3dd2 (67/67). Mac mini cài gói 2f0f5c5d, setup qua SSH không nạp lại sshd; doctor 12/13 (tcc-pending do hộp thoại app Orca, không phải agent); probe mac-mini ok.
  - Ruling: doctor tcc-pending chỉ fail khi hộp thoại của claude/node agent, app khác chỉ warn — để R1-2 (minor).
  - Dispatch re-review có phạm vi cho reviewer toàn nhánh.
- 17:00 Re-review đợt sửa cuối: sẵn sàng gộp. Fork v3 fast-forward cục bộ tới e1c3dd2db (chưa push). Crew v3 fast-forward tới 2f0f5c5d. R1-2 minor: title test crew-run-cancelled ghi todo nhưng thực tế blocked.
