from pathlib import Path
from datetime import datetime, timezone
import os, stat, json, hashlib, subprocess, shlex

base = Path(__file__).resolve().parent
now = lambda: datetime.now(timezone.utc).isoformat()
stems = ['codex-app-server-help', 'codex-json-help', 'codex-ts-help', 'codex-json', 'codex-ts']
records = [(stem, json.loads((base / f'{stem}.json').read_text())) for stem in stems]
intent = {'kind': 'own-metadata-scratch-cleanup-intent', 'at': now(),
          'scope': 'five exact current offline acquisition roots only', 'productionStopCertificate': False, 'records': []}
for stem, value in records:
    for stream in ['stdout', 'stderr']:
        content = (base / f'{stem}.{stream}').read_bytes()
        assert hashlib.sha256(content).hexdigest() == value['output'][stream]['sha256']
    assert value['exitCode'] == 0 and value['failure'] is None and value['binaryIdentityUnchanged']
    intent['records'].append({'identity': value['scratchIdentity'], 'pid': value['pid'],
                             'startedAt': value['startedAt'], 'argv': value['argv'],
                             'directWaitExitCode': 0, 'outputIntegrityVerified': True})
(base / 'acquisition-cleanup-intent.json').write_text(json.dumps(intent, indent=2) + '\n')
processes = subprocess.run(['/bin/ps', '-ax', '-o', 'pid=,ppid=,pgid=,lstart=,command='],
                           capture_output=True, check=True, timeout=3)
rows = []
for line in processes.stdout.decode().splitlines():
    fields = line.strip().split(None, 8)
    if len(fields) == 9:
        rows.append({'pid': int(fields[0]), 'ppid': int(fields[1]), 'pgid': int(fields[2]),
                     'observedBirth': ' '.join(fields[3:8]), 'argvText': fields[8]})
prior = json.loads((base / 'acquisition-cleanup-receipt.json').read_text()) if (base / 'acquisition-cleanup-receipt.json').exists() else {'records': []}
receipt = {'kind': 'own-metadata-scratch-cleanup-receipt', 'at': now(), 'processSnapshotAt': now(),
           'productionWholeTreeStopProof': 'UNVERIFIED-not-required-for-scoped-metadata-cleanup', 'records': []}
for stem, value in records:
    expected = value['scratchIdentity']; root = Path(expected['root']); pid = value['pid']
    previous = next((item for item in prior['records'] if item.get('stem') == stem and item.get('outcome') == 'deleted'), None)
    if previous and not root.exists():
        assert previous['rootIdentity'] == expected
        receipt['records'].append(previous)
        continue
    matches = []
    for row in rows:
        try: argv = shlex.split(row['argvText'])
        except ValueError: argv = []
        if row['pid'] == pid or row['ppid'] == pid or row['pgid'] == pid or str(root) in row['argvText'] or argv == value['argv']:
            matches.append(row)
    result = {'stem': stem, 'rootIdentity': expected, 'priorPid': pid,
              'priorStartedAt': value['startedAt'], 'priorArgv': value['argv'], 'directWaitExitCode': 0,
              'currentMatchingProcesses': matches, 'priorPidCurrentlyPresent': any(row['pid'] == pid for row in matches),
              'priorOwnGroupCurrentlyPresent': any(row['pgid'] == pid for row in matches),
              'intentPersisted': True, 'outcome': 'retained'}
    if not matches:
        root_stat = root.lstat()
        assert stat.S_ISDIR(root_stat.st_mode) and not root.is_symlink() and root.resolve() == root
        assert (root_stat.st_dev, root_stat.st_ino, root_stat.st_uid) == (expected['device'], expected['inode'], expected['uid'])
        assert root_stat.st_uid == os.getuid()
        inventory = []; blockers = []
        for current, dirs, files in os.walk(root, followlinks=False):
            for name in dirs + files:
                path = Path(current) / name; item = path.lstat()
                assert len(inventory) < 2048 and item.st_dev == root_stat.st_dev and item.st_uid == root_stat.st_uid
                if stat.S_ISLNK(item.st_mode):
                    blockers.append({'path': str(path.relative_to(root)), 'target': os.readlink(path),
                                     'device': item.st_dev, 'inode': item.st_ino, 'uid': item.st_uid})
                    continue
                assert stat.S_ISDIR(item.st_mode) or (stat.S_ISREG(item.st_mode) and item.st_nlink == 1)
                inventory.append({'path': str(path.relative_to(root)), 'device': item.st_dev, 'inode': item.st_ino,
                                  'uid': item.st_uid, 'kind': 'directory' if stat.S_ISDIR(item.st_mode) else 'file',
                                  'bytes': item.st_size, 'linkCount': item.st_nlink})
        result['verifiedTreeInventory'] = inventory; result['noSymlinkOrForeignTree'] = not blockers
        if blockers:
            result['reason'] = 'SYMLINK_TREE_RETAINED'; result['symlinkBlockers'] = blockers
            receipt['records'].append(result)
            (base / 'acquisition-cleanup-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
            continue
        assert (root.lstat().st_dev, root.lstat().st_ino, root.lstat().st_uid) == (root_stat.st_dev, root_stat.st_ino, root_stat.st_uid)
        for item in sorted(inventory, key=lambda item: item['path'].count('/'), reverse=True):
            path = root / item['path']; current = path.lstat()
            assert (current.st_dev, current.st_ino, current.st_uid) == (item['device'], item['inode'], item['uid'])
            if item['kind'] == 'file': path.unlink()
            else: path.rmdir()
        root.rmdir(); result['outcome'] = 'deleted'; result['deletedAt'] = now(); result['pathAbsentAfter'] = not root.exists()
    else:
        result['reason'] = 'AMBIGUOUS_OR_LIVE_METADATA_PROCESS'
    receipt['records'].append(result)
    (base / 'acquisition-cleanup-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'records': [{'stem': row['stem'], 'outcome': row['outcome']} for row in receipt['records']],
                  'productionCertificateClaimed': False}))
