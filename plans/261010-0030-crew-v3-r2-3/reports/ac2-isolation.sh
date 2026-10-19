#!/bin/sh
# AC2 (R2-3): 8 ca cách ly workflow của `crew-mac workflow-check`, chạy trên HOME giả và repo tạm.
# Cách dùng: sh ac2-isolation.sh [thư mục làm việc, mặc định ~/crew-r23-probe/ac2]
# Không đụng ~/.crew thật (HOME giả có bản sao hai thư mục ghim), không mạng, không claude.
set -u
W=${1:-$HOME/crew-r23-probe/ac2}
REAL_HOME=$HOME
CREW_MAC="/opt/homebrew/bin/node $REAL_HOME/.crew/app/crew-mac/dist/cli.js"
SP_REL=.crew/workflows/superpowers/6.4.1-5bf4e7801107
BM_REL=.crew/workflows/bmad/6.13.0-next-d009608292d8
mkdir -p "$W"
FH=$W/home
FH_BAD=$W/home-bad
rm -R "$FH" "$FH_BAD" "$W/repos" 2>/dev/null
mkdir -p "$FH/.crew/workflows/superpowers" "$FH/.crew/workflows/bmad" "$W/repos"
cp -Rp "$REAL_HOME/$SP_REL" "$FH/$SP_REL"
cp -Rp "$REAL_HOME/$BM_REL" "$FH/$BM_REL"
# HOME giả thứ hai: bản ghim BMAD sửa một byte
mkdir -p "$FH_BAD/.crew/workflows/superpowers" "$FH_BAD/.crew/workflows/bmad"
cp -Rp "$REAL_HOME/$SP_REL" "$FH_BAD/$SP_REL"
cp -Rp "$REAL_HOME/$BM_REL" "$FH_BAD/$BM_REL"
printf '#' >> "$FH_BAD/$BM_REL/skills/bmad/scripts/resolve_config.py"

newrepo() { # newrepo <tên> -> in đường dẫn repo có một commit
  r=$W/repos/$1
  mkdir -p "$r" && git -C "$r" init -q -b main && printf 'demo\n' > "$r/README.md" &&
    git -C "$r" add README.md && git -C "$r" -c user.name=ac2 -c user.email=ac2@local commit -qm init && echo "$r"
}
commitall() { git -C "$1" add -A && git -C "$1" -c user.name=ac2 -c user.email=ac2@local commit -qm "$2"; }

PASS=0; FAIL=0
run() { # run <số> <mã kỳ vọng> <chuỗi phải có hoặc -> <HOME> <root> <plugin-dir>
  n=$1; want=$2; needle=$3; h=$4; root=$5; pd=$6
  out=$(HOME=$h $CREW_MAC workflow-check --root "$root" --plugin-dir "$pd" 2>&1); rc=$?
  ok=1; [ "$rc" = "$want" ] || ok=0
  if [ "$needle" != "-" ]; then printf '%s' "$out" | grep -qF -- "$needle" || ok=0; fi
  if [ $ok = 1 ]; then PASS=$((PASS + 1)); v=ĐẠT; else FAIL=$((FAIL + 1)); v='KHÔNG ĐẠT'; fi
  printf '\n### Ca %s: %s (thoát %s, kỳ vọng %s)\n%s\n' "$n" "$v" "$rc" "$want" "$out"
}

# 1. pin BMAD, repo sạch -> 0
r=$(newrepo c1); run 1 0 'crew-workflow ok pin=bmad@6.13.0-next rev=d009608292d8' "$FH" "$r" "$FH/$BM_REL"
# 2. plugin-dir là marketplace BMAD của owner -> 78
r=$(newrepo c2); run 2 78 - "$FH" "$r" "$REAL_HOME/.claude/plugins/marketplaces/bmad/plugins/method"
# 3. thư mục ghim BMAD sửa một byte -> 78 WORKFLOW_SOURCE_MISMATCH
r=$(newrepo c3); run 3 78 WORKFLOW_SOURCE_MISMATCH "$FH_BAD" "$r" "$FH_BAD/$BM_REL"
# 4. pin BMAD, repo commit enabledPlugins superpowers -> 78 nạp chéo
r=$(newrepo c4); mkdir -p "$r/.claude"
printf '{"enabledPlugins":{"superpowers@claude-plugins-official":true}}\n' > "$r/.claude/settings.json"
commitall "$r" settings; run 4 78 'nạp chéo' "$FH" "$r" "$FH/$BM_REL"
# 5. pin Superpowers, repo commit enabledPlugins bmad-method -> 78 nạp chéo
r=$(newrepo c5); mkdir -p "$r/.claude"
printf '{"enabledPlugins":{"bmad-method@bmad":true}}\n' > "$r/.claude/settings.json"
commitall "$r" settings; run 5 78 'nạp chéo' "$FH" "$r" "$FH/$SP_REL"
# 6. pin BMAD, _bmad/scripts đã commit nhưng resolve_config.py khác một byte -> 78
r=$(newrepo c6); mkdir -p "$r/_bmad"; cp -Rp "$FH/$BM_REL/skills/bmad/scripts" "$r/_bmad/scripts"
printf '#' >> "$r/_bmad/scripts/resolve_config.py"; commitall "$r" bmad; run 6 78 - "$FH" "$r" "$FH/$BM_REL"
# 7. pin BMAD, _bmad/config.user.toml chưa track -> 78
r=$(newrepo c7); mkdir -p "$r/_bmad"; printf '[core]\nuser_name = "x"\n' > "$r/_bmad/config.user.toml"
run 7 78 - "$FH" "$r" "$FH/$BM_REL"
# 8. pin Superpowers, repo có _bmad/ lạ chưa track -> 0
r=$(newrepo c8); mkdir -p "$r/_bmad/scripts"; printf 'x = 1\n' > "$r/_bmad/scripts/lạ.py"
printf '[core]\n' > "$r/_bmad/config.toml"; run 8 0 'crew-workflow ok pin=superpowers@' "$FH" "$r" "$FH/$SP_REL"

printf '\nTổng: %s ĐẠT, %s KHÔNG ĐẠT\n' "$PASS" "$FAIL"
[ "$FAIL" = 0 ]
