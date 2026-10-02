import json
from pathlib import Path
import sys
a = Path(sys.argv[1])
b = Path(sys.argv[2])
left = json.loads((a / 'output-manifest.json').read_text())['entries']
right = json.loads((b / 'output-manifest.json').read_text())['entries']
for x, y in zip(left, right):
    if x != y:
        print(x['path'], x['sha256'], y['sha256'])
        for root in (a, b):
            print((root / 'stages/real-bmad-build/build/project' / x['path']).read_text()[:2400])
