#!/usr/bin/env python3
"""STATIC frozen Node parent preparation. Never runs Docker, Node, PG or a parser.

Default describes the recipe; --prepare copies reviewed bytes into a NEW owned root.
This script intentionally contains no compressed allocation/new security fixtures.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import time
import uuid

CANONICAL_INVENTORY = '85d06b02ce6dcc388fdd0d01ada17ca1cd9d867cfb6119458e390ec56e6d6d09'
IMAGE_RECEIPT_SHA = 'd9c16b3eded2f3ca29270de4610dfdacdbd65a8557c30fefbc947c95181da3da'
IMAGE = 'sha256:8f2eec2f52fd3ed6c2c42215cad5ce81bee8989a9db3c8bd97f689aed998988a'
SOURCE = '5d40c2d9ce6c1137d1dc476988f28b981ee8ea027c6fc8ad6795a9f01c7764f5'
FROZEN_ROOT = Path('/tmp/crew-v2-attachments-parser-b953796e-f601-4a6a-9311-38bd9f79c43d').resolve()
GIT_FILES = [
    ('b670d82', 'v2/server/src/attachments/storage.ts', 15312, 'b252f6b1f97fd08359c9f369bebf2f680fce2abc0a23793cd63d8eb678c9db2c'),
    ('0c838d2', 'v2/server/src/attachments/config.ts', 3804, '821ce0d6d8deb92c405b2bb5ab009eff4c8515c9aecc265b5c6f5b033ec36b03'),
    ('0c838d2', 'v2/server/src/journal/canonical.ts', 1447, 'dbb85d4a8a70035bb5934bb42a1a1f3cb21f4ad36fefc7f35e18febda5b9af79'),
    ('0c838d2', 'v2/server/src/platform/errors.ts', 333, '1d082a2c69035cf70b05f3cc817286fbdda7138ef47b28784bec8c458cda959d'),
    ('0c838d2', 'v2/server/package.json', 843, '8e01dac8d9073a87cab6d1ad5cbf40dc718bb8dafa153844c2c16297083c7a02'),
]

def sha(data):
    return hashlib.sha256(data).hexdigest()

def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()

def read_regular(path, maximum=2 * 1024 * 1024):
    # Reject symlink components and all nonregular source bytes.
    for component in [path, *path.parents]:
        if component.is_symlink():
            raise RuntimeError('SOURCE_SYMLINK:' + str(component))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
            raise RuntimeError('SOURCE_INVALID:' + str(path))
        with os.fdopen(fd, 'rb', closefd=False) as file:
            data = file.read(maximum + 1)
        if len(data) != info.st_size:
            raise RuntimeError('SOURCE_CHANGED:' + str(path))
        return data
    finally:
        os.close(fd)

def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def durable_mkdir(path):
    try:
        info = path.lstat()
    except FileNotFoundError:
        durable_mkdir(path.parent)
        path.mkdir(mode=0o700)
        sync_directory(path.parent)
        sync_directory(path)
        return
    if not stat.S_ISDIR(info.st_mode) or path.is_symlink():
        raise RuntimeError('PARENT_DIRECTORY_INVALID:' + str(path))

def write_exclusive(path, data, mode=0o444):
    durable_mkdir(path.parent)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as file:
            file.write(data)
            file.flush()
        os.fsync(fd)
    finally:
        os.close(fd)
    sync_directory(path.parent)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare', action='store_true')
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    repo = here.parents[2]
    inventory_bytes = read_regular(here / 'task-5-evidence/own-source-inventory.json')
    inventory = json.loads(inventory_bytes)
    if sha(canonical(inventory['files'])) != CANONICAL_INVENTORY:
        raise RuntimeError('FROZEN_INVENTORY_CHANGED')
    receipt_bytes = read_regular(here / 'task-5-production-image-receipt.json')
    receipt = json.loads(receipt_bytes)
    if sha(receipt_bytes) != IMAGE_RECEIPT_SHA or receipt['imageId'] != IMAGE or receipt['sourceTreeSha256'] != SOURCE:
        raise RuntimeError('IMAGE_RECEIPT_CHANGED_REQUIRES_REVIEW')
    source_st = FROZEN_ROOT.lstat()
    source_owner = json.loads(read_regular(FROZEN_ROOT / 'owner.json'))
    if ((source_st.st_dev, source_st.st_ino, source_st.st_uid) != (16777229, 64075091, 501)
            or source_owner['nonce'] != 'b953796e-f601-4a6a-9311-38bd9f79c43d'
            or any(source_owner[k] != v for k, v in [('dev', source_st.st_dev), ('ino', source_st.st_ino), ('uid', source_st.st_uid)])):
        raise RuntimeError('FROZEN_ROOT_IDENTITY_CHANGED_REQUIRES_REVIEW')
    # No executable read from the working tree. Frozen parser snapshot or accepted blobs only.
    selected = [f for f in inventory['files'] if f['path'] in [
        'v2/server/src/attachments/worker-runner.ts', 'v2/server/src/attachments/worker-protocol.ts',
    ] or (f['path'].startswith('v2/server/test/fixtures/attachments/') and not f['path'].endswith('README.md'))]
    payloads = []
    for entry in selected:
        data = read_regular(FROZEN_ROOT / entry['path'])
        if len(data) != entry['bytes'] or sha(data) != entry['sha256']:
            raise RuntimeError('FROZEN_SOURCE_CHANGED:' + entry['path'])
        payloads.append((entry['path'], data, {'origin': str(FROZEN_ROOT), **entry}))
    for revision, path, size, expected in GIT_FILES:
        data = subprocess.check_output(['git', '-C', str(repo), 'show', revision + ':' + path], timeout=10)
        if len(data) != size or sha(data) != expected:
            raise RuntimeError('ACCEPTED_GIT_BLOB_CHANGED:' + path)
        payloads.append((path, data, {'origin': 'git:' + revision, 'path': path, 'bytes': size, 'sha256': expected}))
    harness = read_regular(here / 'task-5-corpus-harness.mjs')
    recipe = {
        'state': 'STATIC_PREPARATION_ONLY', 'imageDigest': IMAGE, 'sourceTreeSha256': SOURCE,
        'imageReceiptSha256': IMAGE_RECEIPT_SHA, 'frozenInventorySha256': CANONICAL_INVENTORY,
        'parentFixtureSha256': sha(read_regular(Path(__file__).resolve())), 'harnessSha256': sha(harness),
        'files': [item[2] for item in payloads], 'root': None, 'frozenSourceIdentity': source_owner,
        'allocationGate': 'UNVERIFIED_OMITTED', 'parserWallGate': 'UNVERIFIED_OMITTED',
        'launchAuthorized': False, 'heavyWorkloadsOrContainersCreated': 0, 'staticGitBlobReads': len(GIT_FILES),
    }
    if not args.prepare:
        print(json.dumps(recipe, ensure_ascii=False, indent=2))
        return
    nonce = str(uuid.uuid4())
    root = Path(tempfile.mkdtemp(prefix='crew-v2-corpus-parent-' + nonce + '-')).resolve()
    st = root.lstat()
    owner = {'kind': 'static-corpus-parent', 'nonce': nonce, 'root': str(root), 'dev': st.st_dev,
             'ino': st.st_ino, 'uid': st.st_uid, 'createdAt': time.time(), 'resources': []}
    # Identity persists before subordinate data; exceptions intentionally retain the root/evidence.
    try:
        os.chmod(root, 0o700)
        sync_directory(root.parent)
        sync_directory(root)
        write_exclusive(root / 'owner.json', canonical(owner), 0o600)
        for path, data, entry in payloads:
            write_exclusive(root / path, data)
        write_exclusive(root / 'harness.mjs', harness)
        recipe['root'] = owner
        write_exclusive(root / 'frozen-parent.json', canonical(recipe))
    except BaseException as error:
        receipt_error = None
        try:
            write_exclusive(root / 'preparation-failed.json', canonical({'errorType': type(error).__name__, 'root': owner}), 0o600)
        except BaseException as failure:
            receipt_error = type(failure).__name__
        print(json.dumps({'state': 'PREPARATION_FAILED_ROOT_RETAINED', 'root': owner, 'failureReceiptError': receipt_error}))
        raise
    print(json.dumps({'state': 'STATIC_ROOT_PREPARED_NO_LAUNCH', 'root': owner,
                      'manifestSha256': sha(canonical(recipe)), 'launchAuthorized': False}, indent=2))

if __name__ == '__main__':
    main()
