import hashlib, io, json, os, pathlib, shutil, subprocess, tarfile, tempfile, time, uuid
repo=pathlib.Path.cwd(); evidence=repo/'plans/261002-0002-crew-v2/execution-phase04/task-3-evidence'; nonce=str(uuid.uuid4())
root=pathlib.Path(tempfile.mkdtemp(prefix='crew-runtime-frozen-'+nonce+'-')).resolve(); st=root.stat(); identity={'root':str(root),'nonce':nonce,'dev':st.st_dev,'ino':st.st_ino,'uid':st.st_uid}
(evidence/'frozen-root.json').write_text(json.dumps(identity,indent=2)+'\n')
owned=['v2/gateway/src/runtime/'+n+'.ts' for n in ['contracts','launch','effect-ledger','isolation','tool-policy']]+['v2/gateway/src/execution/ticket-command-bridge.ts']+['v2/gateway/test/'+n+'.test.ts' for n in ['runtime-boundary','runtime-crash','effect-ledger','isolation-runtime']]+['v2/gateway/test/support/'+n for n in ['runtime-fixture.ts','runtime-pins.ts','runtime-crash-worker.ts','runtime-typecheck.json']]
archive=subprocess.check_output(['git','archive','5c6fbaf','v2']); (evidence/'base-archive-sha.json').write_text(json.dumps({'base':'5c6fbaf','sha256':hashlib.sha256(archive).hexdigest(),'bytes':len(archive)}))
with tarfile.open(fileobj=io.BytesIO(archive)) as tf:
 for m in tf.getmembers():
  if pathlib.PurePosixPath(m.name).is_absolute() or '..' in pathlib.PurePosixPath(m.name).parts: raise RuntimeError('archive path')
 tf.extractall(root)
for name in owned:
 dst=root/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(repo/name,dst)
for path in ['node_modules','v2/node_modules','v2/gateway/node_modules','v2/server/node_modules']:
 src=repo/path; dst=root/path
 if src.exists(): dst.parent.mkdir(parents=True,exist_ok=True);dst.symlink_to(src,target_is_directory=True)
files={str(p.relative_to(root)):{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in root.rglob('*') if p.is_file() and not p.is_symlink() and 'node_modules' not in p.parts}
(evidence/'frozen-source.json').write_text(json.dumps({'identity':identity,'files':files,'owned':owned},indent=2)+'\n')
env=os.environ.copy();env['CREW_ISOLATION_SKIP_DISCOVERY']='1'; results=[];container=None
def run(name,argv,cwd=root,timeout=240):
 with (evidence/(name+'.log')).open('w') as out:
  p=subprocess.Popen(argv,cwd=cwd,stdout=out,stderr=subprocess.STDOUT,env=env)
  birth=subprocess.check_output(['ps','-p',str(p.pid),'-o','lstart='],text=True).strip()
  try: code=p.wait(timeout=timeout)
  except subprocess.TimeoutExpired: p.terminate();code=p.wait(timeout=10)
  result={'name':name,'argv':argv,'cwd':str(cwd),'pid':p.pid,'start':birth,'exit':code}
  results.append(result);(evidence/'frozen-commands.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(result),flush=True)
 return code
try:
 build=run('frozen-build',['pnpm','--dir','v2/gateway','build'])
 strict=run('frozen-strict',['pnpm','--dir','v2/gateway','exec','tsc','--noEmit','-p','test/support/runtime-typecheck.json'])
 if build or strict: raise RuntimeError('frozen build/typecheck failed')
 name='crew-v2-test-'+str(uuid.uuid4())
 container=subprocess.check_output(['docker','run','-d','--name',name,'--label','crew.runtime-task3='+nonce,'-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=crew_v2_test','-p','127.0.0.1::5432','postgres:18.6'],text=True).strip()
 port=subprocess.check_output(['docker','port',container,'5432/tcp'],text=True).strip().split(':')[-1]
 (evidence/'frozen-container.json').write_text(json.dumps({'id':container,'name':name,'nonce':nonce,'port':port},indent=2)+'\n')
 for i in range(60):
  if subprocess.run(['docker','exec',container,'pg_isready','-U','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:break
  time.sleep(.25)
 else: raise RuntimeError('database not ready')
 env['CREW_V2_TEST_DATABASE_URL']='postgres://postgres@127.0.0.1:'+port+'/crew_v2_test';env['CREW_V2_TEST_CONTAINER_ID']=container
 tests=['journal','http-operations','execution-bridge','execution-bridge-db','execution-crash','stop-control','pin-retirement','retirement-crash','workflow-admission','isolation','isolation-workspace','model-probe','current-credential-resolver','runtime-boundary','runtime-crash','effect-ledger','isolation-runtime']
 (evidence/'covering-manifest.json').write_text(json.dumps({'tests':tests,'excluded':'All other test files; active attachment access/parser files not included in BASE or overlay. This is a scoped covering run, not all project tests.'},indent=2)+'\n')
 run('frozen-covering',['node','--test','--test-concurrency=1']+['test/'+x+'.test.ts' for x in tests],root/'v2/gateway',timeout=600)
finally:
 if container:
  info=json.loads(subprocess.check_output(['docker','inspect',container],text=True))[0]
  if info['Id']!=container or info['Config']['Labels'].get('crew.runtime-task3')!=nonce: raise RuntimeError('container identity mismatch')
  subprocess.check_call(['docker','rm','-f',container],stdout=subprocess.DEVNULL)
  (evidence/'frozen-container-closure.json').write_text(json.dumps({'id':container,'nonce':nonce,'removed':subprocess.run(['docker','inspect',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0},indent=2)+'\n')
 drift=[name for name,v in files.items() if not (root/name).is_file() or hashlib.sha256((root/name).read_bytes()).hexdigest()!=v['sha256']]
 (evidence/'frozen-source-stability.json').write_text(json.dumps({'changed':drift,'capturedFiles':len(files)},indent=2)+'\n')
 print('FROZEN_ROOT_RETAINED_FOR_REVIEW '+str(root),flush=True)
