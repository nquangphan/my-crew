import hashlib
import io
import json
import pathlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

repo = pathlib.Path(__file__).resolve().parents[3]
out = pathlib.Path(__file__).resolve().parent
label = sys.argv[1]
assert label.replace('-', '').isalnum()
nonce = str(uuid.uuid4())
root = pathlib.Path(tempfile.mkdtemp(prefix='.task-2b-fix1-' + label + '-', dir=repo / 'v2/server'))
ident = root.stat()
(root / '.owner.json').write_text(json.dumps({'nonce': nonce, 'dev': ident.st_dev, 'ino': ident.st_ino, 'uid': ident.st_uid}))
files = {}
container = ''
try:
    archive = subprocess.check_output(['git', 'archive', '615025490214b68ced67650c8d8dabd481bcbc8d', 'v2'], cwd=repo)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            name = pathlib.PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or not (member.isdir() or member.isfile()):
                raise RuntimeError('ARCHIVE_INVALID')
        tar.extractall(root)
    own = ['server/src/attachments/submissions.ts', 'server/test/attachments-submissions.test.ts', 'docs/flows/server-attachments.md']
    for name in own:
        if (repo / 'v2' / name).exists():
            shutil.copyfile(repo / 'v2' / name, root / 'v2' / name)
    files = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
    for p in root.rglob('*'):
        p.chmod(0o555 if p.is_dir() else 0o444)
    root.chmod(0o555)
    pg_command=[]
    mapping=''
    name=''
    if sys.argv[2] != 'types':
        name = 'crew-v2-test-' + str(uuid.uuid4())
        pg_command = ['docker', 'run', '--rm', '-d', '--name', name, '--label', 'crew.phase05.task2b=' + nonce, '--memory', '256m', '--cpus', '1', '--pids-limit', '64', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=crew_v2_test', '-p', '127.0.0.1::5432', 'postgres:18.6']
        container = subprocess.check_output(pg_command).decode().strip()
        assert len(container) == 64 and all(c in '0123456789abcdef' for c in container)
        mapping = subprocess.check_output(['docker', 'port', container, '5432/tcp']).decode().strip()
        assert mapping.startswith('127.0.0.1:') and mapping.split(':')[1] not in ['5432', '55432']
        for attempt in range(60):
            ready = subprocess.run(['docker', 'exec', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'crew_v2_test', '-Atc', 'select 1'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if ready.returncode == 0 and ready.stdout.strip() == b'1':
                break
            time.sleep(0.5)
        else:
            raise RuntimeError('PRIVATE_TCP_PG_NOT_READY')
        command = ['pnpm', '--dir', str(root / 'v2/server'), 'exec', 'node', '--test']
        command += sys.argv[3:]
        command += [str(root / 'v2/server/test' / name) for name in sys.argv[2].split(',')]
    else:
        command=['pnpm','--dir',str(root/'v2/server'),'typecheck']
    log = out / ('logs/task-2b-fix1-' + label + '.log')
    with log.open('w') as stream:
        stream.write('command ' + json.dumps(command) + '\n')
        stream.write('privatePG ' + json.dumps({'command': pg_command, 'id': container, 'name': name, 'mapping': mapping}) + '\n')
        stream.flush()
        environment = dict(__import__('os').environ)
        if container:
            environment.update(CREW_V2_TEST_DATABASE_URL='postgres://postgres@' + mapping + '/crew_v2_test', CREW_V2_TEST_CONTAINER_ID=container)
        child = subprocess.Popen(command, cwd=repo, env=environment, stdout=stream, stderr=subprocess.STDOUT)
        code = child.wait()
    print(log.read_text()[-7000:])
    print('exit', code)
    assert all(hashlib.sha256((root / p).read_bytes()).hexdigest() == h for p, h in files.items())
    (out / ('task-2b-fix1-' + label + '-evidence.json')).write_text(json.dumps({'root': str(root), 'identity': {'dev': ident.st_dev, 'ino': ident.st_ino, 'uid': ident.st_uid}, 'nonceSha256': hashlib.sha256(nonce.encode()).hexdigest(), 'files': files, 'cmd': command, 'pid': child.pid, 'exit': code, 'logSha256': hashlib.sha256(log.read_bytes()).hexdigest(), 'childClosed': True, 'container': container, 'pgCommand': pg_command, 'mapping': mapping}, indent=2) + '\n')
finally:
    if container:
        subprocess.check_call(['docker', 'stop', container], stdout=subprocess.DEVNULL)
        for cleanup_attempt in range(20):
            absent = subprocess.run(['docker', 'inspect', container], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if absent.returncode != 0 and b'no such object' in absent.stderr.lower():
                break
            time.sleep(0.25)
        else:
            raise RuntimeError('OWN_PG_REMOVAL_NOT_OBSERVED')
    actual = root.stat()
    assert (actual.st_dev, actual.st_ino, actual.st_uid) == (ident.st_dev, ident.st_ino, ident.st_uid)
    assert json.loads((root / '.owner.json').read_text())['nonce'] == nonce
    root.chmod(0o700)
    for p in root.rglob('*'):
        if p.is_dir():
            p.chmod(0o700)
    shutil.rmtree(root)
    (out / ('task-2b-fix1-' + label + '-cleanup.json')).write_text(json.dumps({'container':container,'containerAbsent':True,'root':str(root),'rootAbsent':not root.exists(),'identity':{'dev':ident.st_dev,'ino':ident.st_ino,'uid':ident.st_uid},'childClosed':True})+'\n')
