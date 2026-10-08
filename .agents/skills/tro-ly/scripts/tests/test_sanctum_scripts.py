#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""
Kiểm hai script của sanctum bằng cách CHẠY THẬT trên thư mục tạm.

Không mock gì. Cả hai script này chỉ chạy đúng một lần trong đời agent —
lúc nó chào đời và mỗi lần nó thức dậy — nên hỏng là hỏng im lặng và
phát hiện rất muộn.

    uv run test_sanctum_scripts.py
"""

import ast
import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
SKILL = SCRIPTS.parent
ASSETS = SKILL / "assets"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        failures.append(f"{name}: {detail}")
        if detail:
            print(f"      {detail}")


def run(script: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPTS / script), *args],
        capture_output=True,
        text=True,
    )


# --- Danh sách template phải khớp thứ thật sự có trong assets/ ---------------
# Lệch một cái là sanctum thiếu file đó, và agent mất luôn phần đời nằm trong nó.

def constants(path: Path) -> dict:
    """Đọc hằng số ở tầng ngoài cùng bằng ast — không import, không chạy script."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: dict = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    try:
                        out[target.id] = ast.literal_eval(node.value)
                    except ValueError:
                        pass
    return out


ns = constants(SCRIPTS / "init-sanctum.py")

declared = set(ns["TEMPLATE_FILES"])
shipped = {p.name for p in ASSETS.glob("*-template.md")}

check("danh sách template khớp assets/", declared == shipped,
      f"khai mà không có: {sorted(declared - shipped)}; "
      f"có mà không khai: {sorted(shipped - declared)}")

check("tên sanctum khớp tên thư mục skill", ns["SKILL_NAME"] == SKILL.name,
      f"SKILL_NAME={ns['SKILL_NAME']} nhưng thư mục={SKILL.name}")

check("init ghi sẵn tên owner và ngôn ngữ (repo Crew không có config BMAD)",
      ns.get("OWNER_NAME") == "Đại Ca" and ns.get("LANGUAGE") == "Tiếng Việt",
      f"OWNER_NAME={ns.get('OWNER_NAME')} LANGUAGE={ns.get('LANGUAGE')}")

wake_ns = constants(SCRIPTS / "wake.py")
check("wake và init cùng trỏ một sanctum",
      wake_ns["SKILL_NAME"] == ns["SKILL_NAME"],
      f"wake={wake_ns.get('SKILL_NAME')} init={ns['SKILL_NAME']}")


# --- Chạy thật: dựng sanctum trong thư mục tạm ------------------------------

with tempfile.TemporaryDirectory() as tmp:
    project = Path(tmp)
    first = run("init-sanctum.py", str(project), str(SKILL))
    check("init-sanctum chạy được", first.returncode == 0,
          first.stderr.strip()[:200])

    sanctum = project / ".agents" / "memory" / SKILL.name
    check("sanctum được tạo", sanctum.is_dir(), f"không thấy {sanctum}")

    for name in ("INDEX.md", "PERSONA.md", "CREED.md", "BOND.md",
                 "MEMORY.md", "CAPABILITIES.md", "PULSE.md"):
        check(f"có {name}", (sanctum / name).is_file())

    # Repo Crew không có config BMAD: tên và ngôn ngữ phải ra đúng mặc định, không còn placeholder.
    bond = (sanctum / "BOND.md").read_text(encoding="utf-8")
    check("BOND điền sẵn Đại Ca và tiếng Việt",
          "**Name:** Đại Ca" in bond and "**Language:** Tiếng Việt" in bond, bond[:200])
    leftovers = [n for n in ("BOND.md", "PERSONA.md", "CREED.md")
                 if any(v in (sanctum / n).read_text(encoding="utf-8")
                        for v in ("{user_name}", "{communication_language}", "{sanctum_path}", "{project_root}"))]
    check("không còn biến cấu hình chưa thay", not leftovers, f"còn ở: {leftovers}")

    # Chạy lại KHÔNG được ghi đè — sanctum là trí nhớ của agent, ghi đè là xoá đời nó.
    marker = sanctum / "MEMORY.md"
    marker.write_text("dấu vết phải còn nguyên\n", encoding="utf-8")
    again = run("init-sanctum.py", str(project), str(SKILL))
    check("chạy lại không xoá sanctum đang có",
          "dấu vết phải còn nguyên" in marker.read_text(encoding="utf-8"),
          "MEMORY.md bị ghi đè khi chạy lần hai")

    # wake.py phải đọc được sanctum vừa dựng
    waking = run("wake.py", str(project))
    check("wake báo WAKING khi có sanctum",
          "MODE: WAKING" in waking.stdout, waking.stdout[:200])
    check("wake in ra đủ 6 file định danh",
          all(f"===== {n} =====" in waking.stdout for n in
              ("INDEX.md", "PERSONA.md", "CREED.md",
               "BOND.md", "MEMORY.md", "CAPABILITIES.md")),
          "thiếu file trong một lượt đọc")

    pulse = run("wake.py", str(project), "--pulse")
    check("wake --pulse báo PULSE và kèm PULSE.md",
          "MODE: PULSE" in pulse.stdout and "===== PULSE.md =====" in pulse.stdout,
          pulse.stdout[:200])


# --- Chưa có sanctum thì phải đi First Breath, không được chạy tiếp ----------

with tempfile.TemporaryDirectory() as tmp:
    project = Path(tmp)
    cold = run("wake.py", str(project))
    check("chưa có sanctum thì báo FIRST_BREATH",
          "MODE: FIRST_BREATH" in cold.stdout, cold.stdout[:200])


print()
print(json.dumps({"failed": len(failures), "failures": failures}, ensure_ascii=False))
sys.exit(1 if failures else 0)
