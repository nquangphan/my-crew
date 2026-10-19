#!/usr/bin/env python3
"""Tạo bản đồ độc lập từ progress.md; chỉ dùng thư viện chuẩn Python."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
from datetime import datetime
from zoneinfo import ZoneInfo


TITLE_VI = {
    "PM-01": "Chính sách PM và kiểm tra hành vi",
    "PM-02": "Bản đồ công việc và chiếu dữ liệu ledger",
    "00-01": "Khóa bản lõi, giấy phép, SDK và điểm mở rộng",
    "00-02": "Kiểm kê mã v2, kiểm thử và phần còn thiếu",
    "00-03": "Tạo fork, kiểm tra nền và bản đồ file",
    "00-04": "Chứng minh chạy từ xa, phiên, hủy và nối lại",
    "00-05": "Chốt cổng ghi, tạo agent và kế hoạch chi tiết",
    "01-01": "Hợp đồng tương thích và danh mục bản vá",
    "01-02": "Đồng bộ fork, CI và kiểm thử sao lưu/khôi phục",
    "02-01": "Kết nối host, app, ghép máy và truyền ra ngoài",
    "02-02": "Nhật ký, tài nguyên, dừng và phục hồi một phiên",
    "03-01": "Cài, ghim, giữ và cô lập phiên bản workflow",
    "03-02": "Chiếu workflow thành story/task và hợp đồng cổng",
    "04-01": "Kiểm kê runtime, điều phối model và thông tin local",
    "04-02": "Nghiệm thu Claude, Codex, API và cơ chế dự phòng",
    "05A-01": "Chuẩn docs, kiểm tra, nhập, tìm và snapshot",
    "05A-02": "Review nội dung và cổng docs theo commit đã merge",
    "06A-01": "Checkpoint, tái dùng phiên và vận chuyển usage",
    "07A-01": "Quyền, chỉ định, công cụ và định tuyến Trợ Lý",
    "07A-02": "Phân việc theo tài nguyên, review, inbox và giám sát",
    "07A-03": "UI sơ đồ, hộp chi tiết, máy, model, docs và text",
    "08A-01": "Tự merge, kiểm thử, docs và phục hồi không vượt cổng",
    "09A-01": "Bộ cài có chữ ký, quyền native và hướng dẫn vận hành",
    "10A-01": "Diễn tập nâng fork, khôi phục DB/blob và nghiệm thu R1",
    "05B-01": "Đồ thị docs, khử trùng và ngữ nghĩa lưu trữ",
    "06B-01": "Trích xuất file và tạo ticket/bình luận nguyên tử",
    "06B-02": "Chuẩn hóa usage, tổng hợp và chính sách phiên",
    "07B-01": "UI file, đồ thị docs, usage và quản lý phiên",
    "08B-01": "Nghiệm thu tích hợp workflow, runtime và file",
    "09B-01": "Cập nhật từ xa có chữ ký, drain và rollback",
    "10B-01": "Cổng phát hành: nâng cấp, khôi phục và kiểm thử thật",
}
TITLE_SOURCE = {'PM-01': 'Skill và behavioral check', 'PM-02': 'HTML ticket map/dialog + ledger projection', '00-01': 'Exact stable tag/SHA/license/SDK, source seams', '00-02': 'Exact v2 reuse inventory/files/tests/open gaps', '00-03': 'Fork checkout + baseline check + source file map', '00-04': 'Minimal real outbound remote execute/session/cancel/reconnect proof', '00-05': 'Mutation/spawn gate seams, patch decision, exact Phase01/02 plans', '01-01': 'Compatibility manifest, facade/patch registry contracts', '01-02': 'Fork sync/update CI and backup/restore test harness', '02-01': 'Host/app IPC/pairing/outbound transport', '02-02': 'Journal/resources/STOP/replay/recovery, single-active', '03-01': 'Workflow install/version/pin/retention/isolation', '03-02': 'Manifest/render/receipts→core story/task + gate contracts', '04-01': 'Inventory/broker/local credentials/switches', '04-02': 'Claude/Codex/API launch/tool-loop/effect/fallback acceptance', '05A-01': 'Docs standard/validator/import/read/search/snapshot', '05A-02': 'Semantic review/merged-commit freshness sync gate', '06A-01': 'Session checkpoint/reuse independence + usage transport', '07A-01': 'Assistant authority/designation/tools/routing', '07A-02': 'Resource-aware dispatch/review/owner inbox/event+5min monitor', '07A-03': 'Core UI extension chart/dialog/machines/models/docs/text', '08A-01': 'Core auto-merge/tests/docs/complete/no-bypass recovery', '09A-01': 'Signed installer/native permissions/runbook/manual upgrade', '10A-01': 'Actual fork-upgrade/DB+blob restore + R1 acceptance', '05B-01': 'Docs graph/dedup/storage semantics', '06B-01': 'File extraction/corpus + atomic create/comment attachment', '06B-02': 'Usage normalization/rollup/registry/delta policies', '07B-01': 'File composer/docs graph/usage/registry UI', '08B-01': 'Full workflow/runtime/file integrated acceptance', '09B-01': 'Signed remote updater/drain/health/rollback', '10B-01': 'Full upgrade/restore/native/API/DB/browser release gate'}

PHASE_VI = {
    "PM": "Điều phối và chính sách", "00": "Khảo sát nền và điểm mở rộng",
    "01": "Bảo trì fork và tương thích", "02": "Gateway và chạy từ xa",
    "03": "Workflow và cổng kiểm soát", "04": "Runtime và model",
    "05A": "Docs căn bản và tính mới", "06A": "Phiên và usage truyền tải",
    "07A": "Trợ Lý và giao diện", "08A": "Tích hợp và tự merge",
    "09A": "Bộ cài và vận hành", "10A": "Diễn tập nâng fork và R1",
    "05B": "Đồ thị docs và lưu trữ", "06B": "File, usage và vòng đời phiên",
    "07B": "Giao diện đầy đủ", "08B": "Nghiệm thu tích hợp đầy đủ",
    "09B": "Cập nhật từ xa", "10B": "Cổng phát hành đầy đủ",
}
STATES = {
    "planned": "Chưa bắt đầu", "ready": "Sẵn sàng", "running": "Đang làm",
    "implemented": "Đã triển khai · chờ review", "in_review": "Đang review",
    "fixing": "Đang sửa", "reviewed": "Review đạt", "integrated": "Đã tích hợp",
    "accepted": "Đã nghiệm thu", "blocked": "Bị chặn", "waiting_quota": "Chờ quota",
}


def plain(value):
    return re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", value).replace("`", "").replace("**", "").strip()


def tables(text):
    table = []
    for line in text.splitlines() + [""]:
        if line.strip().startswith("|") and line.strip().endswith("|"):
            row = [plain(c) for c in re.split(r"(?<!\\)\|", line.strip())[1:-1]]
            if all(re.fullmatch(r"[: -]+", c or " ") for c in row):
                continue
            table.append(row)
        elif table:
            yield table[0], table[1:]
            table = []


def parse_ledger(text):
    models = dict(re.findall(r"\b([SAL])\s*=\s*`([^`]+)`", text))
    tasks, warnings = [], []
    global_remote = "unverified"
    for headers, rows in tables(text):
        if "Task/ticket ID" in headers:
            for row in rows:
                if row and row[0].startswith("All current planning IDs") and "not-created" in row[0]:
                    global_remote = "not-created"
    # Fixture/bảng giản lược phải xác nhận rõ, không suy ra từ một từ trong lịch sử.
    if re.search(r"(?m)^All current planning IDs / not-created\s*$", text):
        global_remote = "not-created"
    for headers, rows in tables(text):
        if not {"ID", "R", "Depends"}.issubset(headers):
            continue
        for row in rows:
            if len(row) != len(headers):
                raise ValueError("Dòng task không khớp số cột: " + str(row))
            cells = dict(zip(headers, row))
            task_id = cells["ID"]
            if not re.fullmatch(r"(?:PM|\d{2}[AB]?)-\d{2}", task_id):
                raise ValueError("ID task không hợp lệ: " + task_id)
            raw_title = next((v for k, v in cells.items() if k.startswith("Deliverable")), "")
            title, sep, context = raw_title.rpartition(" / ")
            if not sep:
                title, context = raw_title, "Chưa ghi"
            raw_state = next((v for k, v in cells.items() if k.startswith("State")), "")
            segments = [v.strip() for v in raw_state.split(" / ")]
            state = segments[0]
            score_raw = next((v for k, v in cells.items() if k.startswith("Score")), "")
            match = re.fullmatch(r"(\d+)/(\S+)\s+(\S+)", score_raw)
            score, alias, effort = match.groups() if match else (None, "", "")
            releases = ["R1", "R2"] if cells["R"] in ("cả2", "cả 2", "both") else [cells["R"]]
            if any(r not in ("R1", "R2") for r in releases):
                raise ValueError("Release chưa nhận diện: " + cells["R"])
            tasks.append({"id": task_id, "title": TITLE_VI.get(task_id, title) if TITLE_SOURCE.get(task_id) == title else title, "sourceTitle": title,
                "context": context, "phase": task_id.rsplit("-", 1)[0], "releases": releases,
                "release": releases[0], "dependenciesRaw": cells["Depends"], "dependencies": [],
                "score": int(score) if score else None, "model": models.get(alias, alias) or "Chưa ghi",
                "effort": effort or "Chưa ghi", "state": state,
                "worker": segments[1] if len(segments) > 1 else "Chưa phân công",
                "reviewer": segments[2] if len(segments) > 2 else "Chưa phân công",
                "evidence": "Chưa ghi bằng chứng riêng trong ledger.", "blocker": "Chưa ghi trở ngại riêng trong ledger.",
                "difficultyDetails": "Chưa ghi thành phần U/C/I; điểm sơ bộ theo ledger.",
                "remoteStatus": global_remote})
    if not tasks:
        raise ValueError("Không tìm thấy bảng task registry trong ledger")
    by_id = {t["id"]: t for t in tasks}
    if len(by_id) != len(tasks):
        raise ValueError("Task ID trùng trong ledger")
    phases = {t["phase"] for t in tasks}
    # Cột riêng, nếu PM bổ sung, được ưu tiên hơn cột ghép ban đầu.
    fields = {"evidence": "evidence", "test/evidence": "evidence", "blocker": "blocker",
              "worker": "worker", "reviewer": "reviewer", "difficulty reason": "difficultyDetails",
              "remote status": "remoteStatus", "model": "model", "effort": "effort"}
    for headers, rows in tables(text):
        id_index = next((i for i, h in enumerate(headers) if h.lower() in ("id", "task", "task id", "task/ticket id")), None)
        if id_index is None:
            continue
        for row in rows:
            if len(row) != len(headers) or row[id_index] not in by_id:
                continue
            for key, value in zip(headers, row):
                field = fields.get(key.lower())
                if field and value and value != "—":
                    by_id[row[id_index]][field] = value
    for task in tasks:
        prefix = None
        raw = task["dependenciesRaw"]
        if raw in ("—", "-", "", "none"):
            continue
        for token in re.split(r"[,;]\s*", raw):
            token = token.strip()
            target = None
            if token in by_id:
                target, prefix = token, token.rsplit("-", 1)[0]
            elif token in ("R1", "R2"):
                target, prefix = "release:" + token, None
            elif re.fullmatch(r"\d{2}", token) and prefix:
                candidate = prefix + "-" + token
                if candidate in by_id:
                    target = candidate
            elif token.startswith("phase:") and token[6:] in phases:
                target, prefix = token, None
            elif token in phases:
                target, prefix = "phase:" + token, None
            if target == task["id"] or target == "phase:" + task["phase"] or target == "release:" + task["release"]:
                warnings.append(f'{task["id"]}: phụ thuộc chính nó hoặc nhóm chứa nó ({token}); không vẽ cạnh.')
            elif target:
                if target not in task["dependencies"]:
                    task["dependencies"].append(target)
            else:
                warnings.append(f'{task["id"]}: chưa giải nghĩa phụ thuộc “{token}”; không vẽ cạnh.')
    return {"tasks": tasks, "warnings": warnings, "phaseTitles": PHASE_VI, "states": STATES}


def safe_json(data):
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def self_test():
    fixture = '''Model S=`gpt-6.1-sol`, A=`gpt-6-astra`, L=`gpt-6-luna`.
| ID | R | Deliverable / context group | Depends | Score/model | State / worker / review |
|---|---|---|---|---|---|
| 00-01 | R1 | Lõi / core | — | 8/A high | reviewed / w1 / r1 |
| 00-02 | R1 | Tái dùng / reuse | 00-01 | 6/S medium | running / w2 / pending |
| 00-03 | R1 | Nối / core | 00-01,02 | 6/S high | planned |
| 01-01 | R2 | <script>alert(1)</script> / ui | R1,00 | 7/S high | blocked / w3 / r2 |
| 01-02 | R2 | Chưa rõ / ui | 99-01 | 7/S high | planned |
All current planning IDs / not-created
'''
    data = parse_ledger(fixture)
    assert len(data['tasks']) == 5, 'Chưa chiếu được bảng task trong ledger'
    by_id = {t['id']: t for t in data['tasks']}
    assert by_id['00-03']['dependencies'] == ['00-01', '00-02'], 'Viết tắt cùng phase sai'
    assert by_id['01-01']['dependencies'] == ['release:R1', 'phase:00'], 'Phụ thuộc group sai'
    assert by_id['00-02']['model'] == 'gpt-6.1-sol'
    assert by_id['00-02']['worker'] == 'w2'
    assert by_id['00-01']['state'] == 'reviewed'
    assert by_id['01-01']['sourceTitle'].startswith('<script>'), 'Phải giữ dữ liệu gốc'
    assert len(data['warnings']) == 1 and '99-01' in data['warnings'][0]
    assert by_id['01-02']['dependencies'] == [], 'Không được tạo cạnh giả'
    ambiguous = parse_ledger(fixture.replace('| 99-01 |', '| 01-01,00 |'))
    assert ambiguous['tasks'][-1]['dependencies'] == ['01-01'], 'Token số sau ID phải được hiểu theo cùng prefix, không đoán thành phase'
    assert any('00' in w for w in ambiguous['warnings'])
    assert all(t['remoteStatus'] == 'not-created' for t in data['tasks'])
    changed_title = fixture.replace('Lõi / core', 'Phạm vi mới / core')
    assert parse_ledger(changed_title)['tasks'][0]['title'] == 'Phạm vi mới', 'Không được giữ tiêu đề cũ khi ledger đổi'
    assert '<' not in safe_json({'x': '</script><img onerror=alert(1)>'}), 'Không được thoát khỏi JSON script'
    altered = fixture.replace('running / w2 / pending', 'accepted / w9 / r9')
    assert parse_ledger(altered)['tasks'][1]['state'] == 'accepted', 'Trạng thái phải lấy lại từ ledger'
    try:
        parse_ledger(fixture.replace('| 00-02 | R1', '| 00-01 | R1'))
    except ValueError:
        pass
    else:
        raise AssertionError('Task ID trùng phải bị từ chối')
    aggregate_source = re.search(r"const tallyState=([^;\n]+);", HTML).group(1)
    regression = """const vm=require('node:vm'),assert=require('node:assert/strict');
const tally=vm.runInNewContext(process.argv[1]);
for(const children of [[{state:'accepted'},{state:'accepted'}],[],[{state:'running'}]])
 assert.equal(tally(children),'aggregate','Nhóm thiếu gate độc lập phải trung tính');
console.log('PASS: aggregate all-child-accepted, empty và running đều trung tính khi thiếu gate');"""
    subprocess.run(['node', '-e', regression, '(' + aggregate_source + ')'], check=True)
    print('PASS: projection, cập nhật trạng thái, dependency task/group, alias model, không tạo cạnh giả, ID trùng')



HTML = r'''<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'">
<title>Crew v3 · Bản đồ công việc</title>
<style>
:root{color-scheme:dark;--bg:#151719;--panel:#1d2023;--border:#393e43;--ink:#e7e9eb;--muted:#a7afb7;--accent:#b8c9e0;--planned:#707a85;--running:#70b5e3;--review:#c0a3e8;--accepted:#8cc598;--blocked:#e8a07d;--dependency:#d9ad72}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit}button,select,input{border:1px solid var(--border);border-radius:6px;color:var(--ink);background:var(--panel)}button{cursor:pointer}button:hover{border-color:#8194a8;background:#252a2f}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #90bff0;outline-offset:3px}a{color:#b8c9e0}header{padding:25px 30px 12px;max-width:1800px;margin:auto}h1{font-size:25px;letter-spacing:-.6px;margin:0 0 5px}h1 span{color:var(--muted);font-weight:400}p{margin:5px 0}.subtitle{color:var(--muted)}.topline{display:flex;justify-content:space-between;gap:20px;align-items:start}.badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);border:1px solid var(--border);border-radius:20px;padding:3px 9px;white-space:nowrap}.toolbar{display:flex;align-items:end;gap:10px;flex-wrap:wrap;margin:18px 0 12px}.field{display:flex;flex-direction:column;gap:4px;color:var(--muted);font-size:12px}.field input{width:250px}.field input,.field select{height:35px;padding:5px 10px}.toolbar button{height:35px;min-width:38px;padding:5px 10px}.zoom{display:flex;align-items:center;gap:5px}.zoom output{min-width:44px;text-align:center;color:var(--muted)}.check{display:flex;gap:7px;align-items:center;min-height:35px;color:var(--muted)}.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin:10px 0}.legend span{display:flex;gap:7px;align-items:center}.dot{width:9px;height:9px;flex:none;border-radius:50%;background:var(--planned)}.dot.running,.dot.ready{background:var(--running)}.dot.implemented,.dot.in_review,.dot.fixing,.dot.reviewed,.dot.integrated{background:var(--review)}.dot.accepted{background:var(--accepted)}.dot.aggregate{background:transparent;border:1px solid #9aabbc}.dot.blocked,.dot.waiting_quota{background:var(--blocked)}.line{width:26px;border-top:1px solid #596069}.line.dep{border-top:1px dashed var(--dependency)}.summary{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;color:var(--muted)}.summary span{border:1px solid #30363b;padding:4px 9px;border-radius:5px;font-size:12px}.summary strong{color:var(--ink);margin-right:4px}.viewport{margin:0 20px;height:calc(100dvh - 285px);min-height:340px;border:1px solid var(--border);border-radius:10px;overflow:auto;position:relative;background:#191b1d;overscroll-behavior:contain}.viewport:focus-visible{outline:2px solid #90bff0;outline-offset:2px}.sizer{position:relative}.scene{position:absolute;left:0;top:0;transform-origin:0 0}.node{position:absolute;text-align:left;padding:13px 15px;height:110px;display:flex;flex-direction:column;gap:4px;border-radius:7px;background:#202326;border:1px solid #42484e;z-index:2;box-shadow:0 1px 2px #0003}.node.group{background:#1d2227}.node.root{border-color:#7f93aa;background:#252b31}.node.release{border-color:#536478}.node.active{border-color:var(--dependency);box-shadow:0 0 0 1px #d9ad7240}.node .row{display:flex;align-items:center;gap:8px;font-size:12px;color:#b4bcc4}.node .title{font-size:15px;font-weight:550;line-height:1.35;flex:none;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.node .meta{font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.node .shared{color:#becee0}svg{position:absolute;inset:0;overflow:visible;pointer-events:none}.tree-edge{fill:none;stroke:#545c64;stroke-width:1}.dep-edge{fill:none;stroke:var(--dependency);stroke-width:1.3;stroke-dasharray:5 5;opacity:.22}.dep-edge.selected{stroke-width:2;opacity:.9}.empty{padding:60px;text-align:center;color:var(--muted)}footer{color:var(--muted);font-size:12px;padding:10px 30px;display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap}.warning{color:#e8b58c;padding:7px 0;white-space:pre-wrap}.sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0)}dialog{width:min(690px,calc(100vw - 30px));max-height:85dvh;overflow:auto;padding:24px;background:#1d2023;border:1px solid #56616d;border-radius:12px;color:var(--ink);box-shadow:0 20px 80px #0009}dialog::backdrop{background:#000a}.dialog-top{display:flex;justify-content:space-between;gap:18px;align-items:start}.dialog-top h2{font-size:20px;margin:5px 0 8px;line-height:1.4}.close{width:34px;height:34px;flex:none}.dialog-id{font-size:12px;color:var(--muted)}dl{margin:15px 0}dl>div{padding:10px 0;border-top:1px solid #343a40;display:grid;grid-template-columns:130px 1fr;gap:12px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}.related{display:flex;gap:6px;flex-wrap:wrap}.related button{padding:4px 8px;font-size:12px}details{border-top:1px solid #343a40;padding-top:12px;color:var(--muted)}summary{cursor:pointer}.remote{color:#e8b58c}.dialog-note{color:var(--muted);font-size:12px}.state-tally{color:var(--muted);font-size:13px}
@media(max-width:700px){header{padding:18px 16px 8px}.topline{display:block}.topline .badge{margin-top:8px}h1{font-size:22px}.toolbar{gap:8px;margin-top:13px}.field input{width:190px}.legend{gap:10px}.viewport{margin:0 10px;height:55dvh;min-height:320px}footer{padding:10px 16px}dl>div{grid-template-columns:1fr;gap:4px}dialog{padding:18px}.summary{gap:5px}}@media(prefers-reduced-motion:no-preference){button{transition:border-color .12s,background .12s}}
</style></head><body>
<header><div class="topline"><div><h1>Crew v3 <span>· Bản đồ công việc</span></h1><p class="subtitle" id="subtitle"></p></div><span class="badge" id="remote-badge"></span></div>
<div class="toolbar"><label class="field">Tìm công việc<input type="search" id="search" placeholder="ID, tiêu đề, worker, bằng chứng…" autocomplete="off"></label><label class="field">Release<select id="release"><option value="">Tất cả</option><option value="R1">R1 · v3.0</option><option value="R2">R2 · v3.1</option></select></label><label class="field">Trạng thái<select id="state"><option value="">Tất cả</option></select></label><div class="zoom"><button id="zoom-out" aria-label="Thu nhỏ">−</button><output id="zoom-value" aria-live="polite"></output><button id="zoom-in" aria-label="Phóng to">+</button><button id="fit" title="Vừa chiều ngang">Vừa ngang</button><button id="reset">Đặt lại</button></div><label class="check"><input type="checkbox" id="dependencies" checked>Hiện phụ thuộc</label></div>
<div class="summary" id="counts"></div><div class="legend"><span><i class="dot"></i>Chưa bắt đầu</span><span><i class="dot running"></i>Đang làm / sẵn sàng</span><span><i class="dot in_review"></i>Triển khai / review / tích hợp</span><span><i class="dot accepted"></i>Task đã nghiệm thu</span><span><i class="dot aggregate"></i>Nhóm · thống kê task con</span><span><i class="dot blocked"></i>Bị chặn / chờ quota</span><span><i class="line"></i>Cây công việc</span><span><i class="line dep"></i>Phụ thuộc → việc kế tiếp</span></div><p class="warning" id="warnings" hidden></p></header>
<main><div class="viewport" id="viewport" tabindex="0" aria-label="Sơ đồ công việc; cuộn hai chiều, dùng các nút để phóng to hoặc thu nhỏ"><div class="sizer" id="sizer"><div class="scene" id="scene"></div></div><p class="empty" id="empty" hidden>Không có công việc khớp bộ lọc.</p></div><p class="sr-only" id="result" role="status"></p></main>
<footer><span id="snapshot"></span><span>Bấm thẻ để xem chi tiết · Tab/Enter để chọn · Esc đóng hộp chi tiết</span></footer>
<dialog id="detail" aria-labelledby="detail-title"><div class="dialog-top"><div><div class="dialog-id" id="detail-id"></div><h2 id="detail-title"></h2></div><button class="close" id="close" aria-label="Đóng chi tiết">×</button></div><p class="state-tally" id="detail-state"></p><dl id="detail-fields"></dl><details id="source-details"><summary>Đối chiếu sổ tiến độ gốc</summary><p id="source-title"></p><p id="source-deps"></p><p id="source-hash" class="dialog-note"></p></details><p class="dialog-note">Điểm sơ bộ theo ledger; review đạt, tích hợp và nghiệm thu là các cổng riêng. Nhóm/release chưa có bằng chứng nghiệm thu riêng.</p></dialog>
<script type="application/json" id="ledger-data">__DATA__</script>
<script>
'use strict';
const data=JSON.parse(document.getElementById('ledger-data').textContent), $=id=>document.getElementById(id);
const tasks=data.tasks, byId=new Map(tasks.map(t=>[t.id,t]));
const labels=data.states, nodes=new Map(), positions=new Map();
let zoom=.9, selected=null, returnFocus=null, graphWidth=1530, graphHeight=1;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
const textState=s=>labels[s]||('Chưa nhận diện: '+s);
const stateCounts=list=>Object.entries(list.reduce((a,t)=>(a[t.state]=(a[t.state]||0)+1,a),{})).map(([s,n])=>`${n} ${textState(s).toLowerCase()}`).join(' · ')||'Không có công việc con.';
const phaseKey=t=>'phase:'+t.phase;
const tallyState=()=> 'aggregate';
const shared=tasks.filter(t=>t.releases.length>1);
nodes.set('root',{id:'root',kind:'root',title:'Crew v3 · Lõi Paperclip',tasks,subtitle:`${tasks.length} công việc · 2 đợt release`});
for(const release of ['R1','R2']){
 const list=tasks.filter(t=>t.releases.includes(release));
 nodes.set('release:'+release,{id:'release:'+release,kind:'release',title:release==='R1'?'R1 · v3.0':'R2 · v3.1',tasks:list,subtitle:release==='R1'?'Giao việc và hoàn thành':'Toàn bộ sản phẩm'});
}
for(const t of tasks){
 const key=phaseKey(t);
 if(!nodes.has(key))nodes.set(key,{id:key,kind:'group',title:data.phaseTitles[t.phase]||('Nhóm '+t.phase),tasks:[],release:t.release,phase:t.phase});
 nodes.get(key).tasks.push(t);nodes.set(t.id,{...t,kind:'task',tasks:[t]});
}
for(const n of nodes.values())if(n.kind==='group')n.subtitle=`${n.tasks.length} công việc · ${[...new Set(n.tasks.map(t=>t.context))].join(', ')}`;
$('subtitle').textContent=`${tasks.length} công việc từ sổ tiến độ PM · PM dùng chung hiện một lần dưới R1`;
$('remote-badge').textContent='Bản theo dõi offline · '+(tasks.every(t=>t.remoteStatus==='not-created')?'ticket remote chưa tạo':'remote theo từng công việc');
$('snapshot').textContent=`Chốt dữ liệu ${data.generatedAt} · Asia/Saigon · ledger ${data.sourceSha.slice(0,12)}`;
if(data.warnings.length){$('warnings').hidden=false;$('warnings').textContent='Cần PM làm rõ: '+data.warnings.join('\n');}
for(const s of [...new Set(tasks.map(t=>t.state))]){const o=el('option','',textState(s));o.value=s;$('state').append(o);}
function matching(){
 const query=$('search').value.trim().toLocaleLowerCase('vi'), r=$('release').value, s=$('state').value;
 return tasks.filter(t=>(!r||t.releases.includes(r))&&(!s||t.state===s)&&(!query||[t.id,t.title,t.sourceTitle,t.context,t.worker,t.reviewer,t.evidence,t.blocker].join(' ').toLocaleLowerCase('vi').includes(query)));
}
function render(){
 const visible=matching(), scene=$('scene');scene.replaceChildren();positions.clear();
 $('empty').hidden=visible.length>0;$('result').textContent=`Hiện ${visible.length} trên ${tasks.length} công việc`;
 const counts=$('counts');counts.replaceChildren();
 const total=el('span');total.append(el('strong','',String(visible.length)),document.createTextNode('/ '+tasks.length+' công việc đang hiện'));counts.append(total);
 for(const [state,count] of Object.entries(visible.reduce((a,t)=>(a[t.state]=(a[t.state]||0)+1,a),{}))){const chip=el('span');chip.append(el('strong','',String(count)),document.createTextNode(textState(state)));counts.append(chip);}
 if(!visible.length){graphHeight=1;applyZoom();return;}
 const shown=new Set(visible.map(t=>t.id)), groups=[...nodes.values()].filter(n=>n.kind==='group'&&n.tasks.some(t=>shown.has(t.id)));
 let y=30;
 const releasePositions=[];
 for(const release of ['R1','R2']){
  const rGroups=groups.filter(g=>g.release===release), start=y;
  if(!rGroups.length)continue;
  for(const g of rGroups){
   const list=g.tasks.filter(t=>shown.has(t.id)), groupStart=y;
   for(const t of list){positions.set(t.id,{x:1140,y,w:355,h:110});y+=130;}
   positions.set(g.id,{x:750,y:groupStart+(list.length*130-130)/2,w:290,h:110});y+=30;
  }
  const pos={x:400,y:start,w:250,h:110};positions.set('release:'+release,pos);releasePositions.push(pos);y+=70;
 }
 graphHeight=y;const center=30;
 positions.set('root',{x:35,y:center,w:265,h:110});
 drawEdges(visible);
 for(const [id,pos] of positions){
  const n=nodes.get(id), b=el('button','node '+n.kind+(id===selected?' active':''));b.dataset.nodeId=id;
  b.style.left=pos.x+'px';b.style.top=pos.y+'px';b.style.width=pos.w+'px';
  const row=el('span','row');row.append(el('i','dot '+(n.kind==='task'?n.state:tallyState(n.tasks))),el('span','',n.kind==='task'?n.id:n.kind==='group'?n.phase:n.kind==='release'?n.title:'Kế hoạch v3'));
  b.append(row,el('span','title',n.title));
  const meta=n.kind==='task'?`${textState(n.state)} · ${n.score===null?'?':n.score}/10 · ${n.model} / ${n.effort}`:n.kind==='release'?`${n.tasks.length} việc con · chưa có gate; ${stateCounts(n.tasks)}`:`Task con: ${stateCounts(n.tasks)}`;
  b.append(el('span','meta'+(n.kind==='task'&&n.releases.length>1?' shared':''),n.kind==='task'&&n.releases.length>1?'R1 + R2 · '+meta:meta));
  if(n.kind!=='task')b.title='Thống kê task con: '+stateCounts(n.tasks)+'; chưa có bằng chứng nghiệm thu riêng cho nhóm/release.';
  b.setAttribute('aria-label',(n.kind==='task'?n.id+' · ':'')+n.title+' · '+(n.kind==='task'?textState(n.state):n.tasks.length+' công việc'));
  b.addEventListener('click',()=>openNode(id,b));scene.append(b);
 }
 applyZoom();
}
function svgNode(tag,attrs){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,val] of Object.entries(attrs))n.setAttribute(key,val);return n;}
function drawEdges(visible){
 const old=$('edges');if(old)old.remove();const svg=svgNode('svg',{id:'edges',width:graphWidth,height:graphHeight,'aria-hidden':'true'});
 const defs=svgNode('defs',{}), marker=svgNode('marker',{id:'arrow',viewBox:'0 0 10 10',refX:8,refY:5,markerWidth:5,markerHeight:5,orient:'auto-start-reverse'});marker.append(svgNode('path',{d:'M0 0 L10 5 L0 10 Z',fill:'#d9ad72'}));defs.append(marker);svg.append(defs);
 const connect=(from,to,dep=false)=>{
  const a=positions.get(from), b=positions.get(to);if(!a||!b)return;
  let d;
  if(dep&&a.x===b.x){const gutter=a.x-28-(Number(to.replace(/\D/g,''))%5)*9;d=`M${a.x} ${a.y+70} H${gutter} V${b.y+70} H${b.x-7}`;}
  else{const mid=dep?b.x-45:a.x+a.w+(b.x-a.x-a.w)/2;d=`M${a.x+a.w} ${a.y+(dep?70:50)} H${mid} V${b.y+(dep?70:50)} H${b.x-(dep?7:0)}`;}
  const path=svgNode('path',{d,class:dep?'dep-edge'+((selected===from||selected===to)?' selected':''):'tree-edge'});if(dep){path.setAttribute('marker-end','url(#arrow)');path.dataset.from=from;path.dataset.to=to;}svg.append(path);
 };
 for(const r of ['R1','R2'])connect('root','release:'+r);
 for(const n of nodes.values())if(n.kind==='group'&&positions.has(n.id)){connect('release:'+n.release,n.id);for(const t of n.tasks)connect(n.id,t.id);}
 if($('dependencies').checked)for(const t of visible)for(const dep of t.dependencies)connect(dep,t.id,true);
 $('scene').prepend(svg);
}
function applyZoom(){
 $('scene').style.width=graphWidth+'px';$('scene').style.height=graphHeight+'px';$('scene').style.transform=`scale(${zoom})`;
 $('sizer').style.width=graphWidth*zoom+'px';$('sizer').style.height=graphHeight*zoom+'px';$('zoom-value').textContent=Math.round(zoom*100)+'%';
}
function setZoom(value){const old=zoom, v=$('viewport');zoom=Math.max(.2,Math.min(1.6,value));applyZoom();v.scrollLeft*=zoom/old;v.scrollTop*=zoom/old;}
function field(label,value){const row=el('div');row.append(el('dt','',label));const dd=el('dd');typeof value==='string'?dd.textContent=value:dd.append(value);row.append(dd);$('detail-fields').append(row);}
function dependencyButtons(ids){const wrap=el('div','related');if(!ids.length)return el('span','','Không có phụ thuộc đã giải nghĩa.');for(const id of ids){const n=nodes.get(id), b=el('button','',(id.startsWith('release:')?'Cổng ':id.startsWith('phase:')?'Nhóm ':'')+id.replace(/^(release:|phase:)/,''));b.title=n?n.title:id;b.addEventListener('click',()=>openNode(id));wrap.append(b);}return wrap;}
function openNode(id,opener){
 const n=nodes.get(id);if(!n)return;selected=id;for(const b of document.querySelectorAll('.node'))b.classList.toggle('active',b.dataset.nodeId===id);drawEdges(matching());
 if(!$('detail').open)returnFocus=opener||document.activeElement;
 $('detail-id').textContent=n.kind==='task'?n.id:'root'===id?'Gốc kế hoạch':id.replace('release:','Release ').replace('phase:','Nhóm ');
 $('detail-title').textContent=n.title;$('detail-state').textContent=n.kind==='task'?textState(n.state):'Thống kê task con: '+stateCounts(n.tasks);$('detail-fields').replaceChildren();
 if(n.kind==='task'){
  field('Trạng thái',`${textState(n.state)} (${n.state})`);field('Release / miền',n.releases.join(' + ')+' / '+n.context);field('Phụ thuộc',dependencyButtons(n.dependencies));
  field('Độ khó',(n.score===null?'Chưa ghi điểm':n.score+'/10')+' · '+n.difficultyDetails);field('Model / effort',n.model+' / '+n.effort);
  field('Worker',n.worker);field('Reviewer',n.reviewer);field('Bằng chứng',n.evidence);field('Trở ngại',n.blocker);
  field('Ticket remote',n.remoteStatus==='not-created'?'Chưa tạo (not-created)':n.remoteStatus==='unverified'?'Chưa xác minh trạng thái remote':n.remoteStatus);
  $('source-details').hidden=false;$('source-details').open=false;$('source-title').textContent='Deliverable gốc: '+n.sourceTitle;$('source-deps').textContent='Depends gốc: '+n.dependenciesRaw;
 }else{
  field('Thống kê task con',stateCounts(n.tasks));field('Phụ thuộc',dependencyButtons([...new Set(n.tasks.flatMap(t=>t.dependencies))].filter(dep=>!n.tasks.some(t=>t.id===dep))));
  field('Độ khó','Theo từng công việc; không cộng điểm để ước lượng thời gian.');field('Model / effort','Theo từng công việc trong nhóm.');field('Worker / reviewer','Theo từng công việc; PM quản lý các cổng trạng thái.');
  field('Bằng chứng / cổng','Chưa ghi bằng chứng nghiệm thu riêng cho nhóm hoặc release.');field('Trở ngại','Xem bằng chứng và trở ngại của từng công việc.');
  const remote=[...new Set(n.tasks.map(t=>t.remoteStatus))];field('Ticket remote',remote.length===1&&remote[0]==='not-created'?'Chưa tạo (not-created) cho các công việc trong nhóm.':'Xem trạng thái remote riêng của từng công việc.');
  field('Công việc',dependencyButtons(n.tasks.map(t=>t.id)));$('source-details').hidden=true;
 }
 $('source-hash').textContent='progress.md · SHA-256 '+data.sourceSha;
 if(!$('detail').open)$('detail').showModal();$('close').focus();
}
$('close').addEventListener('click',()=>$('detail').close());
$('detail').addEventListener('close',()=>{if(returnFocus&&returnFocus.isConnected)returnFocus.focus();});
$('detail').addEventListener('click',e=>{if(e.target===$('detail')){const r=$('detail').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('detail').close();}});
for(const id of ['search','release','state'])$(id).addEventListener(id==='search'?'input':'change',render);
$('dependencies').addEventListener('change',()=>drawEdges(matching()));
$('zoom-in').addEventListener('click',()=>setZoom(zoom+.1));$('zoom-out').addEventListener('click',()=>setZoom(zoom-.1));
$('fit').addEventListener('click',()=>setZoom(($('viewport').clientWidth-16)/graphWidth));
$('reset').addEventListener('click',()=>{$('search').value='';$('release').value='';$('state').value='';selected=null;zoom=.9;render();$('viewport').scrollTo(0,0);});
render();
</script></body></html>'''


def generate(ledger_path, output_path):
    raw = ledger_path.read_bytes()
    data = parse_ledger(raw.decode('utf-8'))
    data['sourceSha'] = hashlib.sha256(raw).hexdigest()
    data['sourceFile'] = ledger_path.name
    data['generatedAt'] = datetime.now(ZoneInfo('Asia/Ho_Chi_Minh')).strftime('%d/%m/%Y %H:%M:%S')
    output_path.write_text(HTML.replace('__DATA__', safe_json(data)), encoding='utf-8')
    print(f'Đã tạo {output_path.name}: {len(data["tasks"])} công việc, {len(data["warnings"])} phụ thuộc chưa rõ, ledger {data["sourceSha"][:12]}')
    for warning in data['warnings']:
        print('Cần PM làm rõ: ' + warning)
    return data


def main():
    parser = argparse.ArgumentParser(description='Chiếu progress.md thành ticket-map.html độc lập, offline.')
    parser.add_argument('--self-test', action='store_true', help='Kiểm tra parser và an toàn dữ liệu, không ghi HTML')
    parser.add_argument('--ledger', type=Path, default=Path(__file__).with_name('progress.md'))
    parser.add_argument('--output', type=Path, default=Path(__file__).with_name('ticket-map.html'))
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        generate(args.ledger, args.output)


if __name__ == '__main__':
    main()
