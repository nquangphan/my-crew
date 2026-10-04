import hashlib,io,json,os,pathlib,shutil,subprocess,tarfile,uuid,time
repo=pathlib.Path.cwd()
ev=repo/'plans/261002-0002-crew-v2/execution-phase04/task-2-fix1-evidence'
reference=repo/'plans/261002-0002-crew-v2/execution-phase04/task-2-evidence'
old=reference
ev=ev/'compat-green'
ev.mkdir(exist_ok=False)
owned=[r['path'] for r in json.loads((old/'source-inventory.json').read_text())['files']]+['v2/server/src/models/contracts.ts','v2/server/src/models/routes.ts','v2/server/src/models/secret-envelopes.ts','v2/server/test/model-current-credentials.test.ts','v2/docs/flows/server-models.md','v2/gateway/src/models/current-credential-resolver.ts','v2/gateway/test/current-credential-resolver.test.ts']
def sha(data):return hashlib.sha256(data).hexdigest()
def save(name,data):(ev/name).write_text(json.dumps(data,indent=2)+'\n')
commands=[];resources=[];roots=[]
def run(label,args,cwd):
    rec={'label':label,'argv':list(map(str,args)),'cwd':str(cwd),'started':time.time()};commands.append(rec);save('commands.json',commands)
    with (ev/(label+'.log')).open('w') as log:rec['exit']=subprocess.run(args,cwd=cwd,stdout=log,stderr=subprocess.STDOUT).returncode
    rec['finished']=time.time();save('commands.json',commands)
    print(label,rec['exit'],flush=True)
    if rec['exit'] and label != 'focused':raise RuntimeError(label+' failed')
archive=subprocess.check_output(['git','archive','556cd8d','v2'],cwd=repo)
captured={}
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
    for m in tar.getmembers():
        p=pathlib.PurePosixPath(m.name)
        if p.is_absolute() or '..' in p.parts or p.parts[0]!='v2' or not (m.isfile() or m.isdir()):raise RuntimeError('Unsafe archive member: '+m.name)
        if m.isfile():captured[m.name]=(tar.extractfile(m).read(),m.mode)
for p in owned:
    source=repo/p
    if not source.is_file() or source.is_symlink():raise RuntimeError('Unsafe owned source: '+p)
    captured[p]=(source.read_bytes(),source.stat().st_mode & 0o777)
frozen=[{'path':p,'sha256':sha(b)} for p,(b,_) in sorted(captured.items())]
save('owned-source-inventory.json',{'base':'556cd8d','files':[{'path':p,'sha256':sha(captured[p][0])} for p in owned]})

save('frozen-source.json',{'base':'556cd8d','archiveSha256':sha(archive),'files':frozen})
gateway=json.loads((old/'covering-test-manifest.json').read_text())['tests']+['v2/gateway/test/current-credential-resolver.test.ts']
server=json.loads((repo/'plans/261002-0002-crew-v2/execution-phase04/task-1-fix1-evidence/covering-candidate-files.json').read_text())['files']+['v2/server/test/model-current-credentials.test.ts']
manifest={'base':'556cd8d','server':server,'gateway':gateway,'serverMaximumMigration':8,'excluded':'All files absent from exact archive+owned inventory, including Task5 native/core, sync, execution-bridge, pin-retirement and attachments peers'}
save('test-manifest.json',manifest)
try:
    for kind in ['gateway']:
        root=repo/'v2'/kind/('.task2-current-'+str(uuid.uuid4()))
        rec={'kind':kind,'root':str(root),'action':'planned'};resources.append(rec);save('resources.json',resources)
        root.mkdir(mode=0o700);st=root.lstat();rec.update(action='created',dev=st.st_dev,ino=st.st_ino,uid=st.st_uid);save('resources.json',resources);roots.append((kind,root,rec))
        for p,(data,mode) in captured.items():
            target=root/p;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);target.chmod(mode)
        if any(sha((root/f['path']).read_bytes())!=f['sha256'] for f in frozen):raise RuntimeError('Freeze mismatch')
    gr=roots[0][1]
    run('focused',['pnpm','--dir',str(gr/'v2/gateway'),'exec','node','--test']+[str(gr/'v2/gateway/test'/p) for p in ['credential-provisioning.test.ts','model-reporter.test.ts','model-probe.test.ts']],repo)
finally:
    stability=[]
    for kind,root,rec in roots:
        changes=[f['path'] for f in frozen if not (root/f['path']).exists() or sha((root/f['path']).read_bytes())!=f['sha256']]
        stability.append({'kind':kind,'changed':changes,'files':len(frozen)})
        st=root.lstat()
        if root.is_symlink() or not root.is_dir() or (st.st_dev,st.st_ino,st.st_uid)!=(rec['dev'],rec['ino'],rec['uid']):raise RuntimeError('Cleanup identity mismatch')
        shutil.rmtree(root);rec['action']='removed';rec['absent']=not root.exists();save('resources.json',resources)
    save('source-stability.json',{'snapshots':stability,'workingOwnedChanges':[p for p in owned if sha((repo/p).read_bytes())!=sha(captured[p][0])]})
