#!/usr/bin/env python3
import os,sys,json,re,hashlib
from pathlib import Path
args=sys.argv[1:];original=args[:]
snapshot=Path(os.environ['CREW_V2_FIX1_SNAPSHOT']);root=Path(os.environ['CREW_V2_FIX1_ROOT']);nonceHash=os.environ['CREW_V2_FIX1_NONCE_SHA256']
expectedVolume=str(snapshot)+':/workspace:ro'
volumes=[args[i+1] for i,arg in enumerate(args[:-1]) if arg=='-v']
matched=[volume for volume in volumes if volume.endswith(':/workspace:ro') and Path(volume[:-len(':/workspace:ro')])==snapshot]
if args and args[0]=='create' and matched:
 marker=json.loads((snapshot/'.fix1-owner.json').read_text());assert hashlib.sha256(marker['nonce'].encode()).hexdigest()==nonceHash
 snapshot.relative_to(root)
 assert not snapshot.is_symlink() and snapshot.is_dir()
 image='node:24.12.0@sha256:929c026d5a4e4a59685b3c1dbc1a8c3eb090aa95373d3a4fd668daa2493c8331'
 assert image in args and 'v2/server/test/support/attachments.ts' in args and '--native-attachment-probe' in args
 def value(flag):return args[args.index(flag)+1]
 assert value('--network').startswith('container:') and re.fullmatch('[0-9a-f]{64}',value('--network')[10:])
 assert '--read-only' in args and value('--cap-drop')=='ALL' and value('--memory')=='256m' and value('--cpus')=='1' and value('--pids-limit')=='32'
 assert value('--tmpfs')=='/tmp:rw,noexec,nosuid,size=64m' and value('-w')=='/workspace'
 assert len(matched)==1
 args[args.index(matched[0])]=str(root)+':/workspace:ro'
 args[args.index('-w')+1]='/workspace/'+str(snapshot.relative_to(root))
 with open(os.environ['CREW_V2_FIX1_LAUNCHER_LOG'],'a') as file:file.write(json.dumps({'original':original,'transformed':args,'snapshot':str(snapshot),'nonceSha256':nonceHash,'purpose':'readonly ancestor dependency resolution; reviewed relative imports stay in snapshot'})+'\n')
os.execv('/usr/local/bin/docker',['/usr/local/bin/docker',*args])
