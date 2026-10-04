"""Prepare exact worker-only context; launch only with explicit sole-slot authorization."""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import time
import uuid

repo = pathlib.Path.cwd()
evidence = repo / 'plans/261002-0002-crew-v2/execution-phase05'
receipt_path = evidence / 'task-5-production-image-receipt.json'
dependency = 'sha256:719dfc5bd6c6d58712f6b1a49f255e87afbf4b1ce6cf921b9e88d2fa25ae7856'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def save():
    with receipt_path.open('w') as f:
        json.dump(receipt, f, indent=2)
        f.flush()
        os.fsync(f.fileno())

if not receipt_path.exists():
    frozen = json.loads((evidence / 'task-5-evidence/own-source-inventory.json').read_text())
    assert sha(json.dumps(frozen['files'], sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()) == frozen['inventorySha256']
    by_path = {x['path']: x for x in frozen['files']}
    paths = ['v2/server/src/attachments/' + x for x in ['worker-entry.ts', 'worker-protocol.ts', 'worker-diagnostic.ts', 'storage.ts']]
    paths += sorted(p for p in by_path if p.startswith('v2/server/src/attachments/extract/'))
    assert len(paths) == 16
    nonce = uuid.uuid4().hex
    stage = pathlib.Path(tempfile.mkdtemp(prefix='crew-v2-worker-image-'))
    st = stage.lstat()
    receipt = {'state': 'prepared', 'nonce': nonce, 'dependencyImage': dependency,
               'stage': str(stage), 'identity': {'dev': st.st_dev, 'ino': st.st_ino, 'uid': st.st_uid},
               'tag': 'crew-v2-worker-candidate:' + nonce, 'files': [], 'commands': [],
               'parentPid': os.getpid(), 'parentCommand': subprocess.check_output(['ps', '-p', str(os.getpid()), '-o', 'lstart=,command='], text=True).strip(),
               'preparedAt': time.time(), 'frozenInventorySha256': frozen['inventorySha256']}
    save()
    for p in paths:
        if p in by_path:
            data = (repo / p).read_bytes()
            assert len(data) == by_path[p]['bytes'] and sha(data) == by_path[p]['sha256'], p
        else:
            data = subprocess.check_output(['git', 'show', 'b670d82:' + p])
            assert (repo / p).read_bytes() == data, p
        relative = pathlib.Path(p).relative_to('v2/server')
        output = stage / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(data)
        receipt['files'].append({'path': str(relative), 'bytes': len(data), 'sha256': sha(data)})
    for name, expected in [('package.json', 'a721662a2c34e9cbc7043421039ec44ddc9ef9192200f6e6d1bf7e30be85b39e'),
                           ('pnpm-lock.yaml', '9e4a9700ea99cdae3b4ca2a145c6cc6d78373657fba2258b2073cf81a5365106')]:
        data = (evidence / ('task-5-linux-' + name)).read_bytes()
        assert sha(data) == expected, name
        (stage / name).write_bytes(data)
        receipt['files'].append({'path': name, 'bytes': len(data), 'sha256': sha(data)})
    receipt['sourceTreeSha256'] = sha(json.dumps(receipt['files'][:16], sort_keys=True, separators=(',', ':')).encode())
    save()
else:
    receipt = json.loads(receipt_path.read_text())
    stage = pathlib.Path(receipt['stage'])

st = stage.lstat()
assert not stage.is_symlink() and {'dev': st.st_dev, 'ino': st.st_ino, 'uid': st.st_uid} == receipt['identity']
for x in receipt['files']:
    data = (stage / x['path']).read_bytes()
    assert len(data) == x['bytes'] and sha(data) == x['sha256'], x['path']
if sys.argv[1:] not in [['launch-sole-slot'], ['launch-copy-sole-slot'], ['launch-fresh-sole-slot']]:
    print(json.dumps({'state': receipt['state'], 'stage': str(stage), 'sourceFiles': 16, 'sourceTreeSha256': receipt['sourceTreeSha256']}))
    raise SystemExit(0)
assert receipt['state'] == ('prepared' if sys.argv[1:] == ['launch-sole-slot'] else 'failed-closed'), 'Never repeat an already launched operation'

pressure = int(subprocess.check_output(['sysctl', '-n', 'kern.memorystatus_vm_pressure_level'], text=True).strip())
vm = subprocess.check_output(['vm_stat'], text=True)
page = int(re.search(r'page size of (\d+) bytes', vm).group(1))
available = sum(int(re.search(r'Pages ' + k + r':\s+(\d+)', vm).group(1)) for k in ['free', 'inactive', 'speculative']) * page
cpu = subprocess.check_output(['top', '-l', '1', '-n', '0'], text=True)
idle = float(re.search(r'([\d.]+)% idle', cpu).group(1))
disk = os.statvfs(stage)
receipt['telemetry'] = {'at': time.time(), 'pressure': pressure, 'availableBytes': available, 'idlePercent': idle, 'diskBytes': disk.f_bavail * disk.f_frsize}
save()
if pressure not in [1, 2] or available < 4 * 1024**3 or idle < 50 or disk.f_bavail * disk.f_frsize < 8 * 1024**3:
    print('PAUSED before creation: resource thresholds unmet')
    raise SystemExit(0)

def run(args):
    command = {'argv': ['/usr/local/bin/docker', *args], 'intendedAt': time.time()}
    receipt['commands'].append(command)
    save()
    child = subprocess.Popen(command['argv'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    command['pid'] = child.pid
    command['birthCommand'] = subprocess.check_output(['ps', '-p', str(child.pid), '-o', 'lstart=,command='], text=True).strip()
    save()
    out, err = child.communicate()
    command.update({'exit': child.returncode, 'closedAt': time.time(), 'stdout': out.decode(errors='replace'), 'stderr': err.decode(errors='replace')})
    save()
    assert child.returncode == 0, 'Failed operation retained; inspect exact resources'
    return out.decode().strip()

program = """import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
process.chdir('/extractor');const names=fs.readdirSync('.').sort();
if(JSON.stringify(names)!==JSON.stringify(['package.json','pnpm-lock.yaml','src']))throw Error('UNEXPECTED_CONTEXT');
execFileSync('npm',['install','--global','--prefix','/opt/pnpm','--ignore-scripts','--no-audit','--no-fund','pnpm@10.32.1'],{stdio:'inherit'});
execFileSync('/opt/pnpm/bin/pnpm',['install','--prod','--frozen-lockfile','--ignore-scripts'],{stdio:'inherit',env:{...process.env,CI:'true'}});
const files=MANIFEST;
for(const f of files){const b=fs.readFileSync(f.path);if(b.length!==f.bytes||createHash('sha256').update(b).digest('hex')!==f.sha256)throw Error('SOURCE_DRIFT');}
const {createCanvas,loadImage}=await import('@napi-rs/canvas');const c=createCanvas(2,3);const image=await loadImage(c.toBuffer('image/png'));if(image.width!==2||image.height!==3)throw Error('NATIVE_PNG');
const {PDFDocument}=await import('pdf-lib');const p=await PDFDocument.create();p.addPage();if((await PDFDocument.load(await p.save({useObjectStreams:true}))).getPageCount()!==1)throw Error('PUBLIC_PDF_GRAPH');
await import('./src/attachments/extract/index.ts');await import('./src/attachments/worker-protocol.ts');
console.log('exact source16, public native PNG/PDF and runtime import closure verified at /extractor');
""".replace('MANIFEST', json.dumps(receipt['files'], separators=(',', ':')))
receipt['programSha256'] = sha(program.encode())
receipt['constructionBase'] = 'node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8'
receipt['state'] = 'launched'
save()
cid = run(['create', '--platform=linux/amd64', '--name', 'crew-v2-worker-image-' + receipt['nonce'],
           '--label', 'crew.v2.fixture=' + receipt['nonce'], '--memory=512m', '--memory-swap=512m',
           '--cpus=1', '--pids-limit=32', '--cap-drop=ALL', '--security-opt=no-new-privileges',
           '--log-driver=none', '--workdir=/extractor', '--entrypoint=node', receipt['constructionBase'],
           '--input-type=module', '-e', program])
assert re.fullmatch('[a-f0-9]{64}', cid)
receipt['containerId'] = cid
save()
created = json.loads(run(['inspect', cid]))[0]
assert created['Id'] == cid and created['Config']['Labels']['crew.v2.fixture'] == receipt['nonce']
assert created['HostConfig']['Memory'] == 536870912 and created['HostConfig']['NanoCpus'] == 1000000000
receipt['createdState'] = created['State']
save()
run(['cp', str(stage) + '/.', cid + ':/extractor'])
run(['start', '--attach', cid])
closed = json.loads(run(['inspect', cid]))[0]
assert closed['Id'] == cid and closed['Config']['Labels']['crew.v2.fixture'] == receipt['nonce']
assert closed['State']['Pid'] == 0 and not closed['State']['Running'] and closed['State']['ExitCode'] == 0 and not closed['State']['OOMKilled']
receipt['closedState'] = closed['State']
save()
run(['commit', '--change', 'WORKDIR /extractor', '--change', 'USER 65532:65532',
     '--change', 'ENTRYPOINT ["node","--max-old-space-size=384","src/attachments/worker-entry.ts"]',
     '--change', 'CMD []', cid, receipt['tag']])
image = json.loads(run(['image', 'inspect', receipt['tag']]))[0]
assert image['Os'] == 'linux' and image['Architecture'] == 'amd64'
assert image['Config']['WorkingDir'] == '/extractor' and image['Config']['User'] == '65532:65532'
receipt['imageId'] = image['Id']
receipt['imageConfig'] = image['Config']
receipt['state'] = 'candidate-image-held-not-certified'
save()
run(['rm', cid])
receipt['containerRemoved'] = True
save()
print(json.dumps({'state': receipt['state'], 'imageId': receipt['imageId'], 'sourceTreeSha256': receipt['sourceTreeSha256']}))
