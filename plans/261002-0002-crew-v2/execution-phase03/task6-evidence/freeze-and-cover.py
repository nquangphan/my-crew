import hashlib, io, json, os, pathlib, shutil, subprocess, tarfile, time, uuid

base = pathlib.Path.cwd()
ev = base / 'plans/261002-0002-crew-v2/execution-phase03/task6-evidence'
root = base / 'v2/server' / ('.task6-frozen-' + str(uuid.uuid4()))
root.mkdir(mode=0o700)
st = root.stat()
(ev / 'snapshot-identity.json').write_text(json.dumps({'root': str(root), 'nonce': root.name, 'device': st.st_dev, 'inode': st.st_ino, 'uid': st.st_uid}, indent=2))
archive = subprocess.check_output(['git', 'archive', '9182e89', 'v2'])
(ev / 'snapshot-archive.json').write_text(json.dumps({'base': '9182e89', 'bytes': len(archive), 'sha256': hashlib.sha256(archive).hexdigest()}))
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
    for member in tar.getmembers():
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or '..' in path.parts or not (member.isdir() or member.isfile()):
            raise RuntimeError('unsafe archive member ' + member.name)
    tar.extractall(root)
accepted = json.loads((ev.parent / 'task5-fix1-evidence/overlay-paths.json').read_text())
for name in accepted:
    (root / name).write_bytes(subprocess.check_output(['git', 'show', '7c7c719:' + name]))
own = ['v2/gateway/src/isolation/' + name + '.ts' for name in ['workspace', 'policy', 'inventory', 'preflight']]
own += ['v2/gateway/test/isolation.test.ts', 'v2/gateway/test/isolation-workspace.test.ts', 'v2/gateway/test/support/isolation-probe.ts', 'v2/gateway/test/support/isolation-typecheck.json', 'v2/docs/flows/gateway-workflows.md']
for name in own:
    (root / name).parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(base / name, root / name)
(ev / 'overlay-paths.json').write_text(json.dumps({'acceptedCommit': '7c7c719', 'accepted': accepted, 'own': own}, indent=2))
def inventory():
    return [{'path': str(p.relative_to(root)), 'mode': oct(p.stat().st_mode & 0o777), 'bytes': p.stat().st_size, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted((root / 'v2').rglob('*')) if p.is_file() and 'dist' not in p.parts]
(ev / 'snapshot-source-before.json').write_text(json.dumps(inventory(), indent=2))
loader = ev.parent / 'task5-fix1-evidence/external-loader.mjs'
shutil.copyfile(loader, ev / 'external-loader.mjs')
config = json.loads((ev.parent / 'task5-fix1-evidence/tsconfig.fixture.json').read_text())
declaration = pathlib.Path(config['compilerOptions']['paths']['tar-stream'][0])
ds = declaration.stat()
(ev / 'external-declaration-identity.json').write_text(json.dumps({'path': str(declaration), 'device': ds.st_dev, 'inode': ds.st_ino, 'uid': ds.st_uid, 'sha256': hashlib.sha256(declaration.read_bytes()).hexdigest()}, indent=2))
for build in [False, True]:
    name = 'tsconfig.fixture.build.json' if build else 'tsconfig.fixture.json'
    value = dict(config)
    value['extends'] = './tsconfig.build.json' if build else './tsconfig.json'
    (root / 'v2/gateway' / name).write_text(json.dumps(value, indent=2))
    (ev / name).write_text(json.dumps(value, indent=2))
results = []
def run(label, argv, cwd, env=None):
    start = time.monotonic()
    (ev / (label + '-command.json')).write_text(json.dumps({'argv': argv, 'cwd': str(cwd), 'NODE_OPTIONS': (env or {}).get('NODE_OPTIONS')}, indent=2))
    with (ev / (label + '.log')).open('w') as output:
        result = subprocess.run(argv, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
    row = {'label': label, 'exit': result.returncode, 'seconds': time.monotonic() - start}
    results.append(row)
    (ev / 'verification-exits.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(row), flush=True)
    return result.returncode
for label, file in [('types-frozen', 'tsconfig.fixture.json'), ('build-frozen', 'tsconfig.fixture.build.json')]:
    if run(label, ['pnpm', 'exec', 'tsc', '-p', str(root / 'v2/gateway' / file)], base / 'v2/gateway'):
        raise SystemExit('frozen compiler failed')
env = dict(os.environ)
env['NODE_OPTIONS'] = '--loader=' + str(ev / 'external-loader.mjs')
env.pop('CREW_ISOLATION_PROBE_RUNTIME', None)
prior = json.loads((ev.parent / 'task5-evidence/cover-command.json').read_text())
argv = [arg.replace(str(base) + '/v2/gateway', str(root) + '/v2/gateway') for arg in prior['argv']]
argv += [str(root / 'v2/gateway/test' / name) for name in ['isolation.test.ts', 'isolation-workspace.test.ts']]
(ev / 'cover-manifest.json').write_text(json.dumps({'base': '9182e89', 'acceptedOverlay': '7c7c719', 'migrationPrefix': 8, 'testFiles': argv[4:], 'excluded': ['peer model tests/source', 'peer attachment fixes', '009 and later migrations']}, indent=2))
run('cover-final', argv, root / 'v2/server', env)
(ev / 'snapshot-source-after.json').write_text(json.dumps(inventory(), indent=2))
