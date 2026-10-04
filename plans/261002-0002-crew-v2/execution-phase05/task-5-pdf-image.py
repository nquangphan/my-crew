import hashlib
import json
import os
import pathlib
import re
import subprocess
import time
import uuid

evidence = pathlib.Path(__file__).resolve().parent
owner = json.loads((evidence / 'task-5-pdf-dependency-owner.json').read_text())
stage = pathlib.Path(owner['stage'])
stat = stage.lstat()
assert (stat.st_dev, stat.st_ino, stat.st_uid) == (owner['dev'], owner['ino'], owner['uid'])
assert not stage.is_symlink()
for item in owner['files']:
    data = (stage / item['path']).read_bytes()
    assert len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256']

receipt_path = evidence / 'task-5-pdf-image-receipt.json'
if receipt_path.exists():
    receipt = json.loads(receipt_path.read_text())
    assert receipt['stage'] == str(stage)
    assert receipt['state'] == 'prepared', 'Do not repeat an already launched operation'
else:
    nonce = uuid.uuid4().hex
    receipt = {
        'state': 'prepared', 'nonce': nonce, 'stage': str(stage),
        'stageIdentity': {'dev': stat.st_dev, 'ino': stat.st_ino, 'uid': stat.st_uid},
        'tag': 'crew-v2-parser-deps:' + nonce,
        'parentPid': os.getpid(), 'parentArgv': subprocess.check_output(
            ['ps', '-p', str(os.getpid()), '-o', 'lstart=,command='], text=True).strip(),
        'createdAt': time.time(), 'commands': [],
    }

def persist():
    fd = os.open(receipt_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as handle:
        json.dump(receipt, handle, indent=2)
        handle.flush()
        os.fsync(handle.fileno())

recipe = '''FROM sha256:ebdbe6bb3879dc106b80d13fd447d8b64f0c7db87010661c338bf410774e792e
WORKDIR /fixture/v2/server
COPY package.json pnpm-lock.yaml ./
RUN /opt/pnpm/bin/pnpm install --frozen-lockfile --ignore-scripts
RUN node --input-type=module -e "import {createCanvas,loadImage} from '@napi-rs/canvas'; import {PDFDocument} from 'pdf-lib'; const canvas=createCanvas(2,3); const bytes=canvas.toBuffer('image/png'); const image=await loadImage(bytes); if(image.width!==2||image.height!==3) throw Error('NATIVE_PNG_PROBE'); const pdf=await PDFDocument.create(); pdf.addPage(); const saved=await pdf.save({useObjectStreams:true}); const loaded=await PDFDocument.load(saved,{throwOnInvalidObject:true}); if(loaded.getPageCount()!==1)throw Error('PDF_GRAPH_PROBE'); console.log('native PNG and parsed PDF public APIs verified')"
RUN /opt/pnpm/bin/pnpm exec tsc --version
ENTRYPOINT ["node"]
'''
(stage / 'Dockerfile').write_text(recipe)
receipt['recipeSha256'] = hashlib.sha256(recipe.encode()).hexdigest()
receipt['packageFiles'] = owner['files']
persist()
pressure = subprocess.check_output(['sysctl', '-n', 'kern.memorystatus_vm_pressure_level'], text=True).strip()
receipt['freshPressure'] = pressure
receipt['freshPressureAt'] = time.time()
persist()
vm = subprocess.check_output(['vm_stat'], text=True)
page = int(re.search(r'page size of (\d+) bytes', vm).group(1))
available = sum(int(re.search(r'Pages '+key+r':\s+(\d+)', vm).group(1)) for key in ['free', 'inactive', 'speculative']) * page
cpu = subprocess.check_output(['top', '-l', '1', '-n', '0'], text=True)
idle = float(re.search(r'([\d.]+)% idle', cpu).group(1))
disk = os.statvfs(stage)
receipt['telemetry'] = {'pressure': pressure, 'availableBytes': available, 'cpuIdlePercent': idle, 'diskAvailableBytes': disk.f_bavail * disk.f_frsize}
receipt['strategy'] = 'single capped512MiB cpu1 dependency-install container, then commit closed filesystem; no unbounded builder'
persist()
if pressure not in ['1', '2'] or available < 4 * 1024**3 or idle < 50 or disk.f_bavail * disk.f_frsize < 8 * 1024**3:
    print('PAUSED: bounded install resource gate; no operation launched')
    raise SystemExit(0)
log_path = evidence / 'task-5-pdf-image.log'
receipt['state'] = 'running'
persist()

def run(args):
    argv = ['/usr/local/bin/docker', *args]
    command = {'argv': argv, 'intendedAt': time.time()}
    receipt['commands'].append(command)
    persist()
    child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    command['pid'] = child.pid
    command['startedAt'] = time.time()
    persist()
    out, err = child.communicate()
    command['exit'] = child.returncode
    command['closed'] = True
    command['closedAt'] = time.time()
    command['stdout'] = out.decode(errors='replace')
    command['stderr'] = err.decode(errors='replace')
    with log_path.open('ab') as output:
        output.write(out + err)
    persist()
    assert child.returncode == 0, 'Operation failed; retain exact resources/evidence'
    return out.decode().strip()

program = """import {execFileSync} from 'node:child_process';
execFileSync('/opt/pnpm/bin/pnpm',['install','--frozen-lockfile','--ignore-scripts'],{stdio:'inherit'});
const {createCanvas,loadImage}=await import('@napi-rs/canvas');
const {PDFDocument}=await import('pdf-lib');
const canvas=createCanvas(2,3), bytes=canvas.toBuffer('image/png'), image=await loadImage(bytes);
if(image.width!==2||image.height!==3)throw Error('NATIVE_PNG_PROBE');
const pdf=await PDFDocument.create();pdf.addPage();const saved=await pdf.save({useObjectStreams:true});
const loaded=await PDFDocument.load(saved,{throwOnInvalidObject:true});if(loaded.getPageCount()!==1)throw Error('PDF_GRAPH_PROBE');
console.log('native PNG and parsed PDF public APIs verified');
execFileSync('/opt/pnpm/bin/pnpm',['exec','tsc','--version'],{stdio:'inherit'});
"""
cid = run(['create', '--platform=linux/amd64', '--name', 'crew-v2-pdf-image-'+receipt['nonce'],
    '--label', 'crew.v2.fixture='+receipt['nonce'], '--memory=512m', '--memory-swap=512m',
    '--cpus=1', '--pids-limit=32', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--log-driver=none', '--workdir', '/fixture/v2/server', '--entrypoint', 'node',
    'sha256:ebdbe6bb3879dc106b80d13fd447d8b64f0c7db87010661c338bf410774e792e',
    '--input-type=module', '-e', program])
assert re.fullmatch(r'[a-f0-9]{64}', cid)
receipt['containerId'] = cid
persist()
created = json.loads(run(['inspect', cid]))[0]
assert created['Id']==cid and created['Config']['Labels']['crew.v2.fixture']==receipt['nonce']
assert created['HostConfig']['Memory']==536870912 and created['HostConfig']['NanoCpus']==1000000000
receipt['createdState'] = created['State']; persist()
for name in ['package.json', 'pnpm-lock.yaml']:
    run(['cp', str(stage/name), cid+':/fixture/v2/server/'+name])
run(['start', '--attach', cid])
closed = json.loads(run(['inspect', cid]))[0]
assert closed['Id']==cid and closed['Config']['Labels']['crew.v2.fixture']==receipt['nonce']
assert not closed['State']['Running'] and closed['State']['Pid']==0 and closed['State']['ExitCode']==0 and not closed['State']['OOMKilled']
receipt['closedState'] = closed['State']; persist()
run(['commit', '--change', 'ENTRYPOINT ["node"]', '--change', 'CMD ["--help"]', cid, receipt['tag']])
image = json.loads(run(['image', 'inspect', receipt['tag']]))[0]
assert image['Os'] == 'linux' and image['Architecture'] == 'amd64'
receipt['imageId'] = image['Id']
receipt['imageConfig'] = image['Config']
receipt['logSha256'] = hashlib.sha256(log_path.read_bytes()).hexdigest()
receipt['state'] = 'verified-image-retained'
receipt['stageRetainedForCleanup'] = True
persist()
run(['rm', cid])
receipt['containerRemoved'] = True
persist()
print(json.dumps({'state': receipt['state'], 'imageId': receipt['imageId'], 'tag': receipt['tag']}))
