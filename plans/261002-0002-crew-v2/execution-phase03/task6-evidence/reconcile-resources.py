import hashlib, json, pathlib, shutil, stat

ev = pathlib.Path(__file__).resolve().parent
roots = {}
def add(row):
    if not isinstance(row, dict) or not isinstance(row.get('root'), str) or not row.get('nonce'):
        return
    ident = row.get('identity', row)
    normalized = {'root': row['root'], 'nonce': row['nonce'], 'device': ident.get('device', ident.get('dev')), 'inode': ident.get('inode', ident.get('ino')), 'uid': ident.get('ownerUid', ident.get('uid'))}
    if all(normalized[k] is not None for k in ['device', 'inode', 'uid']):
        roots[row['root']] = normalized
for file in sorted(ev.glob('*.json')):
    if file.name in ['resources-final.json', 'snapshot-identity.json']:
        continue
    try: add(json.loads(file.read_text()))
    except ValueError: pass
for log in sorted(ev.glob('*.log')):
    text = log.read_text(errors='replace')
    try: add(json.loads(text))
    except ValueError: pass
    for line in text.splitlines():
        for prefix in ['Task6 owned fixture creation ', '# Task6 owned fixture creation ']:
            if line.startswith(prefix): add(json.loads(line[len(prefix):]))
results = []
for root, expected in roots.items():
    p = pathlib.Path(root)
    row = {'expected': expected, 'root': root, 'receipts': [], 'blockers': [], 'bytes': 0}
    if not p.exists():
        row['status'] = 'absent'; results.append(row); continue
    s = p.lstat()
    if not stat.S_ISDIR(s.st_mode) or p.is_symlink() or s.st_dev != int(expected['device']) or s.st_ino != int(expected['inode']) or s.st_uid != expected['uid']:
        row['status'] = 'identity-evidence-gap-retained'; row['bytes'] = None
        row['blockers'].append({'reason': 'Historical socket probe overwrote root identity with stage identity; original root creation tuple unavailable. No cleanup authority inferred from current stat.'})
        results.append(row); continue
    for f in p.rglob('*'):
        fs = f.lstat()
        if f.is_symlink(): continue
        if stat.S_ISREG(fs.st_mode): row['bytes'] += fs.st_size
        if f.suffix != '.json': continue
        try: value = json.loads(f.read_text())
        except (ValueError, UnicodeDecodeError): continue
        if not isinstance(value, dict): continue
        if value.get('kind') == 'isolation-command':
            command = value['evidence']; receipt = command.get('receipt')
            if not receipt or not receipt.get('treeEmpty') or receipt.get('forkObserved'):
                row['blockers'].append({'operationId': command.get('operationId'), 'state': value.get('state'), 'reason': command.get('error') or 'missing genuine receipt'})
        if value.get('lifetime') == 'subprocess' and not value.get('complete'):
            row['blockers'].append({'record': str(f.relative_to(p)), 'reason': 'incomplete registry subprocess'})
        if f.parent.name == 'receipts' and 'operationId' in value:
            row['receipts'].append({'path': str(f.relative_to(p)), 'sha256': hashlib.sha256(f.read_bytes()).hexdigest(), **value})
            if not value.get('treeEmpty') or value.get('forkObserved'):
                row['blockers'].append({'operationId': value['operationId'], 'reason': 'unknown/fork receipt'})
    if not row['receipts']:
        row['blockers'].append({'reason': 'no native receipt inventory'})
    # All test runners have exited; no elapsed-time/PID/group-empty inference is used here.
    if row['blockers']:
        row['status'] = 'retained-unknown'
    else:
        check = p.lstat()
        assert (check.st_dev, check.st_ino, check.st_uid) == (s.st_dev, s.st_ino, s.st_uid)
        shutil.rmtree(p)
        assert not p.exists()
        row['status'] = 'deleted-after-receipts'
    results.append(row)
(ev / 'resources-final.json').write_text(json.dumps({'roots': results, 'note': 'Exact nonce/device/inode/UID roots only. Missing/fork/unknown intent retained. All referenced runners exited before reconciliation. Numeric PID/start unavailable in reviewed OwnedOperations API.'}, indent=2))
print(json.dumps({'roots': len(results), 'deleted': sum(r['status'] == 'deleted-after-receipts' for r in results), 'retained': sum(r['status'] == 'retained-unknown' for r in results)}))
