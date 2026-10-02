"""Freeze an isolated --ignore-scripts install, without reading an owner cache."""
import tarfile
import os
import hashlib
import json

root = json.load(open('plans/261002-0002-crew-v2/execution-phase03/task-4-evidence/dependency-build-root.json'))['path']
destination = 'v2/gateway/test/fixtures/workflow-builder/'
out = destination + 'dependencies.tgz'
executables = []
with tarfile.open(out, 'w:gz', format=tarfile.PAX_FORMAT, dereference=False) as archive:
    for parent, dirs, files in os.walk(root + '/node_modules', followlinks=False):
        for name in sorted(dirs + files):
            path = os.path.join(parent, name)
            relative = os.path.relpath(path, root)
            info = archive.gettarinfo(path, 'package/' + relative)
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ''
            if info.isfile():
                info.mode = 0o755 if info.mode & 0o111 else 0o644
                if info.mode == 0o755:
                    executables.append(relative)
                with open(path, 'rb') as source:
                    archive.addfile(info, source)
            else:
                info.mode = 0o755 if info.isdir() else 0o777
                archive.addfile(info)
metadata = {
    'payloadSha256': hashlib.sha256(open(out, 'rb').read()).hexdigest(),
    'executables': executables,
    'lockSha256': hashlib.sha256(open(destination + 'pnpm-lock.yaml', 'rb').read()).hexdigest(),
    'packageSha256': hashlib.sha256(open(destination + 'package.json', 'rb').read()).hexdigest(),
}
json.dump(metadata, open(destination + 'dependencies.json', 'w'), indent=2)
print(os.path.getsize(out), len(executables))
