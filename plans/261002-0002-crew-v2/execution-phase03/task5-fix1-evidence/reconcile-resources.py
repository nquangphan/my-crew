import pathlib,json,re,hashlib,subprocess,stat,os,shutil
base=pathlib.Path(__file__).resolve().parent
roots={};retained=set();cleaned=set();containers=set()
for log in sorted(base.glob('*.log')):
 for line in log.read_text(errors='replace').splitlines():
  if line.startswith('Task5 private database container '):
   value=line.split()[-1]
   if re.fullmatch('[0-9a-f]{64}',value):containers.add(value)
  for marker in ['Task5 owned root ','Task5 retained UNKNOWN root ','Task5 owned cleanup ']:
   if line.startswith(marker):
    row=json.loads(line[len(marker):]);root=row['root'];roots.setdefault(root,row)
    if 'retained' in marker:retained.add(root)
    if 'cleanup' in marker:cleaned.add(root)
rows=[]
for root,expected in roots.items():
 path=pathlib.Path(root);row={'root':root,'expected':expected,'retainedUnknown':root in retained}
 try: st=path.lstat()
 except FileNotFoundError:row['status']='absent';rows.append(row);continue
 assert not path.is_symlink() and st.st_uid==expected['uid'] and str(st.st_dev)==expected['device'] and str(st.st_ino)==expected['inode'],root
 row['status']='retained';row['currentIdentity']={'device':str(st.st_dev),'inode':str(st.st_ino),'uid':st.st_uid}
 helpers=[]
 for meta in (path/'process-journal/native').glob('*/attestation.json'):
  att=json.loads(meta.read_text());helper=meta.parent/'helper';h=helper.lstat();p=meta.parent.lstat()
  if str(h.st_dev)==att['device'] and str(h.st_ino)==att['inode'] and h.st_uid==att['uid'] and h.st_nlink==1 and stat.S_ISREG(h.st_mode) and h.st_mode&0o077==0 and str(p.st_dev)==att['parentDevice'] and str(p.st_ino)==att['parentInode'] and hashlib.sha256(helper.read_bytes()).hexdigest()==att['binaryHash']:helpers.append(helper)
 proof=[]
 for ready_file in (path/'process-journal/proofs').glob('*-ready.json'):
  ready=json.loads(ready_file.read_text());entry={'launchId':ready['launchId'],'pid':ready['pid'],'processGroupId':ready['processGroupId'],'startIdentity':ready['startIdentity']}
  if helpers:
   group=subprocess.run([str(helpers[-1]),'group',str(ready['processGroupId'])],capture_output=True,text=True,timeout=10)
   probe=subprocess.run([str(helpers[-1]),'identity',str(ready['pid'])],capture_output=True,text=True,timeout=10)
   entry['groupEmptyObservation']=group.returncode==0 and group.stdout.strip()=='0'
   entry['pidObservation']=json.loads(probe.stdout) if probe.returncode==0 else None
  proof.append(entry)
 row['processObservations']=proof
 rows.append(row)
baseline=[]
for log in sorted(base.glob("*.log")):
 for line in log.read_text(errors="replace").splitlines():
  if line.startswith("Retained genuine fork UNKNOWN fixtures: "):
   for root in json.loads(line.split(": ",1)[1]):
    st=pathlib.Path(root).lstat();entry={"root":root,"device":str(st.st_dev),"inode":str(st.st_ino),"uid":st.st_uid,"status":"retained UNKNOWN baseline covering fixture"}
    if entry not in baseline:baseline.append(entry)
results=[]
for identifier in containers:
 process=subprocess.run(['docker','inspect','--format','{{.State.Running}}',identifier],capture_output=True,text=True)
 results.append({'id':identifier,'absent':process.returncode!=0 and ('no such' in process.stderr.lower()), 'running':process.stdout.strip() if process.returncode==0 else None})
(base/'resources-final.json').write_text(json.dumps({'roots':rows,'containers':results,'baselineUnknown':baseline,'note':'Group-empty/PID absence are observations only; UNKNOWN roots are retained and never inferred stopped.'},indent=2)+'\n')
print(json.dumps({'roots':len(rows),'absent':sum(r['status']=='absent' for r in rows),'retained':sum(r['status']=='retained' for r in rows),'knownContainers':len(results),'containersAbsent':all(c['absent'] for c in results)}))
