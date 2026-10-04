import hashlib, json, os, pathlib, shutil, stat

ev = pathlib.Path(__file__).resolve().parent
def exclusive(path, value):
    with path.open('x') as output:
        json.dump(value, output, indent=2)
        output.flush()
        os.fsync(output.fileno())
    fd = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)

roots = {}
for name in ['red-home-metadata.log', 'isolation-green.log']:
    for line in (ev / name).read_text().splitlines():
        line = line.removeprefix('# ')
        prefix = 'Task6 owned fixture creation '
        if line.startswith(prefix):
            row = json.loads(line[len(prefix):])
            roots[row['root']] = row
plan = []
for root, expected in roots.items():
    p = pathlib.Path(root)
    s = p.lstat()
    assert stat.S_ISDIR(s.st_mode) and not p.is_symlink()
    assert (s.st_dev, s.st_ino, s.st_uid) == (expected['device'], expected['inode'], expected['ownerUid'])
    row = {'root': root, 'creation': expected, 'bytes': 0, 'commands': [], 'protectedReceipts': [], 'blockers': []}
    for f in sorted(p.rglob('*')):
        fs = f.lstat()
        if f.is_symlink(): continue
        if stat.S_ISREG(fs.st_mode): row['bytes'] += fs.st_size
        if f.suffix != '.json': continue
        try: value = json.loads(f.read_text())
        except (ValueError, UnicodeDecodeError): continue
        if not isinstance(value, dict): continue
        if value.get('kind') == 'isolation-command':
            c = value['evidence']; receipt = c.get('receipt'); identity = c.get('stageIdentity')
            row['commands'].append({'record': str(f.relative_to(p)), 'recordSha256': hashlib.sha256(f.read_bytes()).hexdigest(), **value})
            if not receipt or not identity or not receipt.get('treeEmpty') or receipt.get('forkObserved') or receipt['operationId'] != c['operationId'] or receipt['device'] != identity['device'] or receipt['inode'] != identity['inode']:
                row['blockers'].append({'operationId': c['operationId'], 'reason': c.get('error') or 'missing or mismatched closure'})
        if value.get('lifetime') == 'subprocess' and not value.get('complete'):
            row['blockers'].append({'path': str(f.relative_to(p)), 'reason': 'incomplete registry subprocess'})
        if f.parent.name == 'receipts' and 'operationId' in value:
            row['protectedReceipts'].append({'path': str(f.relative_to(p)), 'sha256': hashlib.sha256(f.read_bytes()).hexdigest(), **value})
            if not value.get('treeEmpty') or value.get('forkObserved'):
                row['blockers'].append({'operationId': value['operationId'], 'reason': 'unresolved native receipt'})
    assert row['commands'] and row['protectedReceipts']
    plan.append(row)
exclusive(ev / 'cleanup-plan.json', {'roots': plan, 'authority': 'All RED/GREEN runners completed. Genuine operation/stage-bound nofork receipts required; missing intent remains retained. No TTL or PID inference.'})
result = []
for row in plan:
    p = pathlib.Path(row['root']); expected = row['creation']; s = p.lstat()
    assert not p.is_symlink() and (s.st_dev, s.st_ino, s.st_uid) == (expected['device'], expected['inode'], expected['ownerUid'])
    if row['blockers']:
        status = 'retained-unknown'
    else:
        shutil.rmtree(p)
        assert not p.exists()
        status = 'deleted-after-closure'
    result.append({'root': row['root'], 'creation': expected, 'bytesBefore': row['bytes'], 'status': status, 'blockers': row['blockers']})
exclusive(ev / 'cleanup-result.json', {'roots': result, 'planSha256': hashlib.sha256((ev / 'cleanup-plan.json').read_bytes()).hexdigest()})
print(json.dumps(result))
