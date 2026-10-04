import datetime, hashlib, io, json, os, pathlib, re, shutil, subprocess, sys, tarfile, tempfile, uuid

repo = pathlib.Path.cwd()
evidence = repo / 'plans/261002-0002-crew-v2/execution-phase04/task-3-fix1-evidence'
def gate(stage):
    pressure = int(subprocess.check_output(['sysctl', '-n', 'kern.memorystatus_vm_pressure_level'], text=True))
    vm = subprocess.check_output(['vm_stat'], text=True)
    page = int(re.search(r'page size of (\d+)', vm)[1])
    available = sum(int(re.search(r'Pages '+label+r':\s+(\d+)', vm)[1]) for label in ['free', 'inactive', 'speculative']) * page
    top = subprocess.check_output(['top', '-l', '1', '-n', '0'], text=True)
    idle = float(re.search(r'([\d.]+)% idle', top)[1])
    disk = shutil.disk_usage(repo).free
    sample = dict(stage=stage, time=datetime.datetime.now().astimezone().isoformat(), pressure=pressure, availableBytes=available, idlePercent=idle, diskBytes=disk)
    sample['allowed'] = pressure in [1, 2] and available >= 4*1024**3 and idle >= 50 and disk >= 8*1024**3
    with (evidence/'resource-gates.jsonl').open('a') as file: file.write(json.dumps(sample)+'\n')
    if not sample['allowed']: raise RuntimeError('RESOURCE_PAUSE '+json.dumps(sample))

def identity(root):
    stat = root.stat()
    return dict(root=str(root), dev=stat.st_dev, ino=stat.st_ino, uid=stat.st_uid)

def capture(root):
    return {str(path.relative_to(root)): dict(sha256=hashlib.sha256(path.read_bytes()).hexdigest(), bytes=path.stat().st_size) for path in (root/'v2/gateway').rglob('*') if path.is_file() and not path.is_symlink() and 'node_modules' not in path.parts and 'dist' not in path.parts}

mode = sys.argv[1]
if mode == 'red':
    gate('red-snapshot-creation')
    previous = json.loads((repo/'plans/261002-0002-crew-v2/execution-phase04/task-3-evidence/workspace-amendment/root.json').read_text())
    original = pathlib.Path(previous['root'])
    assert all(identity(original)[key] == previous[key] for key in ['dev', 'ino', 'uid'])
    nonce = str(uuid.uuid4())
    root = pathlib.Path(tempfile.mkdtemp(prefix='crew-runtime-fix1-'+nonce+'-')).resolve()
    record = dict(identity(root), nonce=nonce, acceptedBase='d438ce1')
    (evidence/'root.json').write_text(json.dumps(record, indent=2)+'\n')
    shutil.copytree(original, root, symlinks=True, dirs_exist_ok=True)
    archive = subprocess.check_output(['git', 'archive', 'd438ce1:v2/gateway'], cwd=repo)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            assert not pathlib.PurePosixPath(member.name).is_absolute() and '..' not in pathlib.PurePosixPath(member.name).parts
        tar.extractall(root/'v2/gateway')
    for path in ['v2/gateway/test/runtime-workspace.test.ts', 'v2/gateway/test/effect-ledger.test.ts']:
        shutil.copy2(repo/path, root/path)
    (evidence/'red-source.json').write_text(json.dumps(capture(root), indent=2)+'\n')
else:
    record = json.loads((evidence/'root.json').read_text())
    root = pathlib.Path(record['root'])
    assert all(identity(root)[key] == record[key] for key in ['dev', 'ino', 'uid'])
    gate('green-source-overlay')
    for path in ['v2/gateway/src/runtime/isolation.ts', 'v2/gateway/test/runtime-workspace.test.ts', 'v2/gateway/test/effect-ledger.test.ts']:
        shutil.copy2(repo/path, root/path)
    (evidence/'green-source.json').write_text(json.dumps(capture(root), indent=2)+'\n')

env = os.environ.copy()
env.update(NODE_OPTIONS='--max-old-space-size=384', CREW_ISOLATION_SKIP_DISCOVERY='1')
commands = []
def run(name, args, cwd):
    gate(name)
    with (evidence/(name+'.log')).open('w') as log:
        process = subprocess.Popen(args, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
        start = subprocess.check_output(['ps', '-p', str(process.pid), '-o', 'lstart='], text=True).strip()
        code = process.wait(timeout=180)
    value = dict(name=name, argv=args, cwd=str(cwd), pid=process.pid, start=start, exit=code, NODE_OPTIONS=env['NODE_OPTIONS'])
    commands.append(value)
    (evidence/(mode+'-commands.json')).write_text(json.dumps(commands, indent=2)+'\n')
    print(json.dumps(value), flush=True)
    return code

if mode == 'red':
    code = run('expiry-red', ['node', '--test', '--test-name-pattern=captured authority deadline', 'test/runtime-workspace.test.ts'], root/'v2/gateway')
    log = (evidence/'expiry-red.log').read_text()
    assert code == 1 and log.count('Missing expected rejection') >= 4, 'RED did not prove all four expiry gaps'
else:
    assert run('build', ['pnpm', '--dir', 'v2/gateway', 'build'], root) == 0
    assert run('strict', ['pnpm', '--dir', 'v2/gateway', 'exec', 'tsc', '--noEmit', '-p', 'test/support/runtime-typecheck.json'], root) == 0
    tests = ['runtime-workspace', 'runtime-boundary', 'isolation-runtime', 'effect-ledger']
    assert run('targeted-cover', ['node', '--test', '--test-concurrency=1']+['test/'+name+'.test.ts' for name in tests], root/'v2/gateway') == 0
    before = json.loads((evidence/'green-source.json').read_text())
    after = capture(root)
    drift = [name for name, entry in before.items() if after.get(name) != entry]
    (evidence/'source-stability.json').write_text(json.dumps(dict(changed=drift, capturedFiles=len(before)), indent=2)+'\n')
    assert not drift
print('REVIEW_SNAPSHOT_RETAINED '+str(root), flush=True)
