"""Owned bounded --version/--help capture only; never initialize a runtime."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import selectors
import signal
import stat
import subprocess
import sys
import tempfile
import time

BASE = Path(__file__).resolve().parent
BINARIES = {
    'claude': ('/Users/phannhatquang/.local/share/claude/versions/2.1.284',
               '50a14c2f50f56668380fdda490167f1d3630d5cc18fb8aed3073c2c7ea7314fe'),
    'codex': ('/Users/phannhatquang/.codex/packages/standalone/releases/0.159.3-aarch64-apple-darwin/bin/codex',
              '4d210f7c5a18fd0386434df23b5bdbb8c0e7257d3e8a2b30b0769c8bbe99a878'),
}
runtime, flag = 'codex', '--help'
mode = sys.argv[1]
assert mode in ('json-help', 'ts-help', 'json', 'ts')
subcommand = 'generate-json-schema' if mode.startswith('json') else 'generate-ts'
emit = not mode.endswith('-help')
stem = 'codex-' + mode
assert runtime in BINARIES and flag in ('--version', '--help')
quota = json.loads(os.environ['TASK4_QUOTA_GATE'])
assert quota['ordinaryUsageAllowed'] and quota['remainingPercent'] > 25
assert time.time() - quota['sampledAtEpoch'] < 15
binary, expected = BINARIES[runtime]

def now():
    return datetime.now(timezone.utc).isoformat()

def identity():
    fd = os.open(binary, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        assert stat.S_ISREG(before.st_mode) and before.st_nlink == 1
        digest = hashlib.sha256()
        while chunk := os.read(fd, 1024 * 1024):
            digest.update(chunk)
        after = os.fstat(fd)
        fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
        assert all(getattr(before, key) == getattr(after, key) for key in fields)
        assert digest.hexdigest() == expected, 'BINARY_CHANGED_HOLD'
        return {'path': binary, 'sha256': digest.hexdigest(), 'bytes': after.st_size,
                'device': after.st_dev, 'inode': after.st_ino, 'uid': after.st_uid,
                'mode': oct(stat.S_IMODE(after.st_mode)), 'linkCount': after.st_nlink,
                'mtimeNs': after.st_mtime_ns, 'ctimeNs': after.st_ctime_ns}
    finally:
        os.close(fd)

before = identity()
pressure = subprocess.run(['/usr/sbin/sysctl', '-n', 'kern.memorystatus_vm_pressure_level'],
                          capture_output=True, check=True, timeout=2).stdout.decode().strip()
vm = subprocess.run(['/usr/bin/vm_stat'], capture_output=True, check=True, timeout=2).stdout.decode()
cpu = subprocess.run(['/usr/sbin/iostat', '-c', '2', '-w', '1'],
                     capture_output=True, check=True, timeout=3).stdout.decode()
page = int(re.search(r'page size of (\d+) bytes', vm)[1])
available = sum(int(re.search(rf'Pages {name}:\s+(\d+)', vm)[1])
                for name in ('free', 'inactive', 'speculative')) * page
disk = os.statvfs('/private/tmp').f_bavail * os.statvfs('/private/tmp').f_frsize
gate = {'observedAt': now(), 'pressureLevel': pressure,
        'availableBytes': available, 'diskAvailableBytes': disk,
        'cpuSample': cpu[-2048:], 'quota': quota}
assert pressure in ('1', '2'), 'CRITICAL_OR_UNKNOWN_PRESSURE_HOLD'
idle = float(cpu.strip().splitlines()[-1].split()[-4])
gate['cpuIdlePercent'] = idle
(BASE / f'{stem}-gate.json').write_text(json.dumps(gate, indent=2) + '\n')
assert available >= 4 * 1024**3 and disk >= 8 * 1024**3 and idle >= 50, 'STRICT_RESOURCE_HOLD'
assert time.time() - quota['sampledAtEpoch'] < 15, 'STALE_QUOTA_HOLD'
root = Path(tempfile.mkdtemp(prefix=f'crew-v2-task4-{runtime}-{flag[2:]}-', dir='/private/tmp'))
owned = root.stat()
for name in ('home', 'tmp', 'cwd', 'claude-config', 'codex-config'):
    (root / name).mkdir(mode=0o700)
env = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': str(root / 'home'),
       'TMPDIR': str(root / 'tmp'), 'CLAUDE_CONFIG_DIR': str(root / 'claude-config'),
       'CODEX_HOME': str(root / 'codex-config'), 'LANG': 'en_US.UTF-8'}
output_root = root / ('json' if subcommand == 'generate-json-schema' else 'ts')
argv = [binary, 'app-server', subcommand] + (['--out', str(output_root)] if emit else ['--help'])
started = now()
process = subprocess.Popen(argv, cwd=root / 'cwd', env=env,
                           stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, start_new_session=True)
selector = selectors.DefaultSelector()
for name, stream in (('stdout', process.stdout), ('stderr', process.stderr)):
    os.set_blocking(stream.fileno(), False)
    selector.register(stream, selectors.EVENT_READ, name)
buffers = {'stdout': bytearray(), 'stderr': bytearray()}
cap = 65536 if flag == '--help' else 4096
deadline = time.monotonic() + 15
failure = None
def output_bound():
    count = 0; total = 0
    if output_root.exists():
        for current, dirs, files in os.walk(output_root, followlinks=False):
            for name in dirs + files:
                item = (Path(current) / name).lstat()
                if stat.S_ISLNK(item.st_mode): return False
                if stat.S_ISREG(item.st_mode):
                    if item.st_nlink != 1 or (item.st_mode & 0o111): return False
                    count += 1; total += item.st_size
                elif not stat.S_ISDIR(item.st_mode): return False
                if count > 2048 or total > 64 * 1024**2: return False
    return True
while selector.get_map():
    if emit and not output_bound():
        failure = 'OUTPUT_TREE_BOUND'
        break
    if time.monotonic() >= deadline:
        failure = 'TIMEOUT'
        break
    for key, _ in selector.select(timeout=min(0.1, max(0, deadline - time.monotonic()))):
        chunk = os.read(key.fileobj.fileno(), 4096)
        if not chunk:
            selector.unregister(key.fileobj)
            continue
        if len(buffers[key.data]) + len(chunk) > cap:
            failure = 'OUTPUT_CAP'
            break
        buffers[key.data].extend(chunk)
    if failure:
        break
if failure:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
exit_code = process.wait(timeout=2)
selector.close()
process.stdout.close()
process.stderr.close()
after = identity()
# stem captured before gate
for name, content in buffers.items():
    (BASE / f'{stem}.{name}').write_bytes(content)
record = {'kind': 'bounded-cli-public-metadata-only', 'startedAt': started, 'finishedAt': now(),
          'gate': gate, 'argv': argv, 'cwd': str(root / 'cwd'),
          'env': env, 'pid': process.pid, 'exitCode': exit_code, 'failure': failure,
          'timeoutSeconds': 15, 'perStreamCapBytes': cap,
          'binaryBefore': before, 'binaryAfter': after,
          'binaryIdentityUnchanged': before == after,
          'output': {name: {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
                     for name, content in buffers.items()},
          'scratchIdentity': {'root': str(root), 'device': owned.st_dev, 'inode': owned.st_ino,
                              'uid': owned.st_uid, 'mode': oct(stat.S_IMODE(owned.st_mode))},
          'scratchRetained': True, 'nativeWholeTreeStopProof': 'UNVERIFIED',
          'runtimeInitializationRequested': False, 'modelRequested': False}
if emit and not failure and exit_code == 0:
    assert output_bound() and output_root.is_dir()
    destination = BASE / ('protocol-json' if mode == 'json' else 'protocol-ts')
    destination.mkdir(mode=0o700)
    generated = []
    for source in sorted(output_root.rglob('*')):
        item = source.lstat(); relative = source.relative_to(output_root)
        assert source.resolve().is_relative_to(output_root.resolve())
        if stat.S_ISDIR(item.st_mode):
            (destination / relative).mkdir(mode=0o700, parents=True, exist_ok=True)
            continue
        assert stat.S_ISREG(item.st_mode) and item.st_nlink == 1 and not (item.st_mode & 0o111)
        content = source.read_bytes(); target = destination / relative; target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with target.open('xb') as handle: handle.write(content); handle.flush(); os.fsync(handle.fileno())
        generated.append({'path': str(relative), 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest(), 'device': item.st_dev, 'inode': item.st_ino, 'uid': item.st_uid, 'linkCount': item.st_nlink})
    record['generated'] = generated
    record['generatedFiles'] = len(generated)
    record['generatedBytes'] = sum(item['bytes'] for item in generated)
    record['bundleSha256'] = hashlib.sha256(json.dumps([[item['path'], item['bytes'], item['sha256']] for item in generated], separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    record['evidenceDestination'] = str(destination)
(BASE / f'{stem}.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'generatedFiles': record.get('generatedFiles'), 'generatedBytes': record.get('generatedBytes'), 'bundleSha256': record.get('bundleSha256'), 'command': stem, 'exitCode': exit_code, 'failure': failure,
                  'pressure': pressure, 'availableGiB': round(available / 1024**3, 2),
                  'remainingPercent': quota['remainingPercent'], 'cpuIdlePercent': idle,
                  'stdoutBytes': len(buffers['stdout']), 'stderrBytes': len(buffers['stderr']),
                  'binaryIdentityUnchanged': before == after, 'scratchRetained': True}))
assert not failure and exit_code == 0, 'METADATA_COMMAND_FAILED_HOLD'
