import hashlib, json, pathlib

ev = pathlib.Path(__file__).resolve().parent
rows = []
for name in ['cover-final.log', 'probe-codex.log', 'probe-claude.log']:
    path = ev / name
    if not path.exists(): continue
    for line in path.read_text(errors='replace').splitlines():
        line = line.removeprefix('# ')
        if not line.startswith('Task6 ') or ' no-model evidence ' not in line: continue
        raw = json.loads(line.split(' no-model evidence ', 1)[1])
        e = raw['evidence']
        def sanitize(text):
            return text.replace(e['workspace'], '$WORKSPACE').replace(e['attemptHome'], '$ATTEMPT_HOME')
        row = {k: e[k] for k in ['runtime', 'source', 'projection', 'os', 'productionEnabled', 'policyVersion', 'surfaces', 'origins', 'blockers']}
        row.update({'log': name, 'rawEvidenceSha256': e['sha256'], 'overall': raw['status'], 'entries': e['entries'], 'exclusions': e['exclusions'], 'projectionEntries': e['projectionEntries']})
        row['commands'] = [{'operationId': c['operationId'], 'argv': [sanitize(a) if '/' not in a or e['workspace'] in a or e['attemptHome'] in a else '<exact-path-in-raw-log>' for a in c['argv']], 'executableSha256': c['executableSha256'], 'policySha256': c['policySha256'], 'receipt': c['receipt'], 'numericPidStart': c['numericPidStart'], 'stdinSha256': c.get('stdin', {}).get('sha256'), 'error': c['error']} for c in e['commands']]
        rows.append(row)
output = {'formatVersion': 1, 'note': 'Sanitized summary only; exact argv/policy/paths/stdin/output and original evidence hash remain in named raw logs. No overall PASS or invocation certificate.', 'results': rows}
(ev / 'matrix-sanitized.json').write_text(json.dumps(output, indent=2))
print(json.dumps({'results': len(rows), 'overall': [r['overall'] for r in rows]}))
