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
pressure = subprocess.check_output(['sysctl','-n','kern.memorystatus_vm_pressure_level']).decode().strip()
vm=subprocess.check_output(['vm_stat']).decode();cpu=subprocess.check_output(['top','-l','1','-n','0']).decode();disk=subprocess.check_output(['df','-k',str(repo)]).decode()
import re
page=int(re.search(r'page size of (\d+) bytes',vm).group(1))
reclaimable=sum(int(re.search(r'Pages '+name+r':\s+(\d+)',vm).group(1)) for name in ['free','inactive','speculative']) * page
idle=float(re.search(r'([0-9.]+)% idle',cpu).group(1))
disk_bytes=int(disk.splitlines()[-1].split()[3])*1024
ruling='PM Oct3 16:37 explicit FIX2 exclusive serial slot: pressure1or2, estimated available>=4GiB, idle>=50%, disk>=8GiB, PG256MiB/cpu1/pids64 and Node heap384MiB; no native/provider canary; no other heavy work'
resource={'pressure':pressure,'estimatedAvailableBytes':reclaimable,'availableMethod':'vm_stat free+inactive+speculative pages; reclaimability estimate, not resident hardlimit','cpuIdlePercent':idle,'diskAvailableBytes':disk_bytes,'rawVm':vm,'rawCpu':cpu,'rawDisk':disk,'ruling':ruling,'capturedBeforeCreation':True,'timeUnix':time.time()}
(out/('task-3-'+label+'-pressure.json')).write_text(json.dumps(resource,indent=2)+'\n')
if sys.argv[2] != 'types' and not (pressure in ['1','2'] and reclaimable>=4*1024**3 and idle>=50 and disk_bytes>=8*1024**3):
    raise RuntimeError('RESOURCE_GATE_DENIED_NO_RESOURCES_CREATED')
nonce = str(uuid.uuid4())
root = pathlib.Path(tempfile.mkdtemp(prefix='.task-3-fix2-' + label + '-', dir=repo / 'v2/server'))
ident = root.stat()
(root / '.owner.json').write_text(json.dumps({'nonce': nonce, 'dev': ident.st_dev, 'ino': ident.st_ino, 'uid': ident.st_uid}))
files = {}
container = ''
child = None
child_closed = True
container_closed = False
preflight = out / ('task-3-' + label + '-preflight.json')
preflight.write_text(json.dumps({'root':str(root),'identity':{'dev':ident.st_dev,'ino':ident.st_ino,'uid':ident.st_uid},'nonceSha256':hashlib.sha256(nonce.encode()).hexdigest(),'ownerMarkerSha256':hashlib.sha256((root/'.owner.json').read_bytes()).hexdigest(),'stage':'before resources'})+'\n')
try:
    archive = subprocess.check_output(['git', 'archive', '0c838d21354bb40494a1280200ae281b2ff19e33', 'v2'], cwd=repo)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            name = pathlib.PurePosixPath(member.name)
            if name.is_absolute() or '..' in name.parts or not (member.isdir() or member.isfile()):
                raise RuntimeError('ARCHIVE_INVALID')
        tar.extractall(root)
    own = ['server/src/attachments/snapshots.ts','server/test/attachments-snapshots.test.ts','server/test/support/attachment-access-publication.ts','server/test/support/attachment-snapshot-work.ts','server/test/support/attachment-subset-work.ts','docs/flows/server-attachments.md']
    for name in own:
        if (repo / 'v2' / name).exists():
            (root / 'v2' / name).parent.mkdir(parents=True, exist_ok=True)
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
        pg_command = ['docker', 'create', '--name', name, '--label', 'crew.phase05.task3=' + nonce, '--memory', '256m', '--cpus', '1', '--pids-limit', '64', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=crew_v2_test', '-p', '127.0.0.1::5432', 'postgres:18.6']
        preflight.write_text(json.dumps({'root':str(root),'identity':{'dev':ident.st_dev,'ino':ident.st_ino,'uid':ident.st_uid},'nonceSha256':hashlib.sha256(nonce.encode()).hexdigest(),'intendedPgCommand':pg_command,'stage':'before container creation'})+'\n')
        container = subprocess.check_output(pg_command).decode().strip()
        assert len(container) == 64 and all(c in '0123456789abcdef' for c in container)
        inspection=json.loads(subprocess.check_output(['docker','inspect',container]))[0]
        assert inspection['Id']==container and inspection['Name']=='/'+name and inspection['Config']['Labels']['crew.phase05.task3']==nonce and inspection['State']['Status']=='created'
        (out/('task-3-'+label+'-container-created.json')).write_text(json.dumps(inspection,indent=2)+'\n')
        subprocess.check_call(['docker','start',container],stdout=subprocess.DEVNULL)
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
    log = out / ('logs/task-3-' + label + '.log')
    with log.open('w') as stream:
        stream.write('command ' + json.dumps(command) + '\n')
        stream.write('privatePG ' + json.dumps({'command': pg_command, 'id': container, 'name': name, 'mapping': mapping}) + '\n')
        stream.flush()
        environment = dict(__import__('os').environ)
        environment['NODE_OPTIONS']='--max-old-space-size=384'
        if container:
            environment.update(CREW_V2_TEST_DATABASE_URL='postgres://postgres@' + mapping + '/crew_v2_test', CREW_V2_TEST_CONTAINER_ID=container)
        (out/('task-3-'+label+'-child-intended.json')).write_text(json.dumps({'command':command,'cwd':str(repo),'stage':'before child start'})+'\n')
        child = subprocess.Popen(command, cwd=repo, env=environment, stdout=stream, stderr=subprocess.STDOUT)
        child_closed=False
        process_identity=subprocess.check_output(['ps','-p',str(child.pid),'-o','pid=,lstart=,command=']).decode().strip()
        assert process_identity.startswith(str(child.pid)) and 'pnpm' in process_identity
        (out/('task-3-'+label+'-child-created.json')).write_text(json.dumps({'pid':child.pid,'identity':process_identity,'command':command})+'\n')
        code = child.wait()
        child_closed=True
        (out/('task-3-'+label+'-child-closed.json')).write_text(json.dumps({'pid':child.pid,'exit':code,'waitObserved':True})+'\n')
    print(log.read_text()[-7000:])
    print('exit', code)
    assert all(hashlib.sha256((root / p).read_bytes()).hexdigest() == h for p, h in files.items())
    (out / ('task-3-' + label + '-evidence.json')).write_text(json.dumps({'root': str(root), 'identity': {'dev': ident.st_dev, 'ino': ident.st_ino, 'uid': ident.st_uid}, 'nonceSha256': hashlib.sha256(nonce.encode()).hexdigest(), 'files': files, 'cmd': command, 'pid': child.pid, 'exit': code, 'logSha256': hashlib.sha256(log.read_bytes()).hexdigest(), 'childClosed': True, 'container': container, 'pgCommand': pg_command, 'mapping': mapping}, indent=2) + '\n')
finally:
    if not child_closed:
        raise RuntimeError('CHILD_CLOSURE_UNKNOWN_RESOURCES_RETAINED')
    if container:
        inspection=json.loads(subprocess.check_output(['docker','inspect',container]))[0]
        assert inspection['Id']==container and inspection['Name']=='/'+name and inspection['Config']['Labels']['crew.phase05.task3']==nonce
        subprocess.check_call(['docker', 'stop', container], stdout=subprocess.DEVNULL)
        closure=json.loads(subprocess.check_output(['docker','inspect',container]))[0]
        assert closure['Id']==container and closure['State']['Status']=='exited' and not closure['State']['Running']
        container_closed=True
        (out/('task-3-'+label+'-container-closed.json')).write_text(json.dumps(closure,indent=2)+'\n')
        subprocess.check_call(['docker','rm',container],stdout=subprocess.DEVNULL)
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
    (out / ('task-3-' + label + '-cleanup.json')).write_text(json.dumps({'container':container,'containerAbsent':True,'root':str(root),'rootAbsent':not root.exists(),'identity':{'dev':ident.st_dev,'ino':ident.st_ino,'uid':ident.st_uid},'childClosed':True})+'\n')
