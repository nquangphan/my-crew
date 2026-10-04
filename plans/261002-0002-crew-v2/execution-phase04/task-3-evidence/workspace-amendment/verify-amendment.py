import datetime, hashlib, json, os, pathlib, re, shutil, subprocess, tempfile, uuid

repo=pathlib.Path.cwd(); evidence=repo/'plans/261002-0002-crew-v2/execution-phase04/task-3-evidence'; output=evidence/'workspace-amendment'
def gate(name):
 pressure=int(subprocess.check_output(['sysctl','-n','kern.memorystatus_vm_pressure_level'],text=True))
 vm=subprocess.check_output(['vm_stat'],text=True);page=int(re.search(r'page size of (\d+)',vm)[1])
 available=sum(int(re.search(r'Pages '+label+r':\s+(\d+)',vm)[1]) for label in ['free','inactive','speculative'])*page
 top=subprocess.check_output(['top','-l','1','-n','0'],text=True);idle=float(re.search(r'([\d.]+)% idle',top)[1]);disk=shutil.disk_usage(repo).free
 sample={'stage':name,'time':datetime.datetime.now().astimezone().isoformat(),'pressure':pressure,'availableBytes':available,'idlePercent':idle,'diskBytes':disk,'allowed':pressure in [1,2] and available>=4*1024**3 and idle>=50 and disk>=8*1024**3}
 with (output/'resource-gates.jsonl').open('a') as file:file.write(json.dumps(sample)+'\n')
 if not sample['allowed']:raise RuntimeError('RESOURCE_PAUSE '+json.dumps(sample))
gate('snapshot-creation')
historical=json.loads((evidence/'frozen-root.json').read_text()); original=pathlib.Path(historical['root']); stat=original.stat()
assert (stat.st_dev,stat.st_ino,stat.st_uid)==(historical['dev'],historical['ino'],historical['uid'])
old_inventory=json.loads((evidence/'frozen-source.json').read_text())
for name,entry in old_inventory['files'].items(): assert hashlib.sha256((original/name).read_bytes()).hexdigest()==entry['sha256'],name
nonce=str(uuid.uuid4());root=pathlib.Path(tempfile.mkdtemp(prefix='crew-runtime-amendment-'+nonce+'-')).resolve();stat=root.stat()
identity={'root':str(root),'nonce':nonce,'dev':stat.st_dev,'ino':stat.st_ino,'uid':stat.st_uid};(output/'root.json').write_text(json.dumps(identity,indent=2)+'\n')
shutil.copytree(original,root,symlinks=True,dirs_exist_ok=True)
new_support=['v2/gateway/test/runtime-workspace.test.ts','v2/gateway/test/support/runtime-workspace.ts']
for path in new_support: shutil.copy2(repo/path,root/path)
env=os.environ.copy();env['CREW_ISOLATION_SKIP_DISCOVERY']='1';env['NODE_OPTIONS']='--max-old-space-size=384';results=[]
def run(name,args,cwd):
 gate(name)
 with (output/(name+'.log')).open('w') as log:
  process=subprocess.Popen(args,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT)
  start=subprocess.check_output(['ps','-p',str(process.pid),'-o','lstart='],text=True).strip()
  code=process.wait(timeout=240)
 result={'name':name,'argv':args,'cwd':str(cwd),'pid':process.pid,'start':start,'exit':code,'NODE_OPTIONS':env['NODE_OPTIONS']};results.append(result)
 (output/'commands.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(result),flush=True);return code
red=run('red-historical-consumer',['node','--test','test/runtime-workspace.test.ts'],root/'v2/gateway')
if red!=1 or 'Missing expected rejection' not in (output/'red-historical-consumer.log').read_text(): raise RuntimeError('RED did not prove missing workspace rejection')
owned=old_inventory['owned']+new_support
for path in owned: shutil.copy2(repo/path,root/path)
files={path:{'sha256':hashlib.sha256((root/path).read_bytes()).hexdigest(),'bytes':(root/path).stat().st_size} for path in owned}
(output/'source-sha.json').write_text(json.dumps({'base':'5c6fbaf','source':'historical frozen base plus exact current Task3 overlay','root':identity,'owned':files},indent=2)+'\n')
if run('build',['pnpm','--dir','v2/gateway','build'],root)!=0:raise RuntimeError('build failed')
if run('strict',['pnpm','--dir','v2/gateway','exec','tsc','--noEmit','-p','test/support/runtime-typecheck.json'],root)!=0:raise RuntimeError('strict failed')
tests=['runtime-boundary','runtime-crash','runtime-workspace','effect-ledger','isolation-runtime','isolation-workspace']
(output/'test-manifest.json').write_text(json.dumps({'tests':tests,'excluded':'No unrelated, peer, full-suite or PostgreSQL tests. Historical105 is separate.'},indent=2)+'\n')
code=run('affected-cover',['node','--test','--test-concurrency=1']+['test/'+name+'.test.ts' for name in tests],root/'v2/gateway')
drift=[path for path,entry in files.items() if hashlib.sha256((root/path).read_bytes()).hexdigest()!=entry['sha256']]
(output/'source-stability.json').write_text(json.dumps({'changed':drift,'capturedOwnedFiles':len(files)},indent=2)+'\n')
print('REVIEW_SNAPSHOT_RETAINED '+str(root),flush=True)
if code:raise RuntimeError('affected cover failed; logs retained')
