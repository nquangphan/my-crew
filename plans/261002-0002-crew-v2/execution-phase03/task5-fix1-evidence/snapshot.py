import subprocess,tarfile,io,pathlib,uuid,json,hashlib,shutil
base=pathlib.Path.cwd(); evidence=base/'plans/261002-0002-crew-v2/execution-phase03/task5-fix1-evidence'
root=base/'v2/server'/('.task5-fix1-'+str(uuid.uuid4()));root.mkdir(mode=0o700);st=root.stat()
identity={'root':str(root),'nonce':root.name,'device':st.st_dev,'inode':st.st_ino,'uid':st.st_uid};(evidence/'snapshot-identity.json').write_text(json.dumps(identity,indent=2))
archive=subprocess.check_output(['git','archive','9182e89','v2']); (evidence/'snapshot-archive.json').write_text(json.dumps({'base':'9182e89','bytes':len(archive),'sha256':hashlib.sha256(archive).hexdigest()}))
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
 for member in tar.getmembers():
  path=pathlib.PurePosixPath(member.name)
  if path.is_absolute() or '..' in path.parts or not (member.isdir() or member.isfile()):raise RuntimeError('unsafe member '+member.name)
 tar.extractall(root)
files=['v2/gateway/src/commands/http-client.ts','v2/gateway/src/execution/ticket-command-bridge.ts','v2/gateway/src/sync/connection.ts','v2/gateway/src/sync/gateway-sync.ts','v2/gateway/src/journal/http-operations.ts','v2/gateway/test/connection.test.ts','v2/gateway/test/http-operations.test.ts','v2/gateway/test/sync.test.ts','v2/gateway/test/execution-bridge.test.ts','v2/gateway/test/execution-bridge-db.test.ts','v2/docs/flows/gateway-host.md','v2/docs/flows/gateway-workflows.md','v2/docs/flows/server-gateway.md']
for name in files:shutil.copyfile(base/name,root/name)
(evidence/'overlay-paths.json').write_text(json.dumps(files,indent=2))
def inventory():
 return [{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted((root/'v2').rglob('*')) if p.is_file()]
(evidence/'snapshot-source.json').write_text(json.dumps(inventory(),indent=2))
print(root)
