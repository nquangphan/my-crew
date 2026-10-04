import { randomUUID } from 'node:crypto';
import { mkdir,mkdtemp,realpath,lstat,writeFile,readFile } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AtomicRecords,hash} from '../../../../v2/gateway/src/journal/atomic-records.ts';
import {OwnedOperations} from '../../../../v2/gateway/src/workflows/operations.ts';
const root=await realpath(await mkdtemp(join(tmpdir(),'crew-task6-discover-'))), nonce=randomUUID();
const rootStat=await lstat(root);
const out=new URL('./discover-result.json',import.meta.url);
const evidence={formatVersion:1,nonce,root,identity:{dev:rootStat.dev,ino:rootStat.ino,uid:rootStat.uid},commands:[]};
await writeFile(out,JSON.stringify(evidence,null,2));
const store=await AtomicRecords.open(join(root,'journal'));
const ops=await OwnedOperations.open(join(root,'operations'),store);
for(const [runtime,path,args] of [['codex','/Users/phannhatquang/.local/bin/codex',['--version']],['codex','/Users/phannhatquang/.local/bin/codex',['app-server','--help']],['claude','/Users/phannhatquang/.local/bin/claude',['--version']],['claude','/Users/phannhatquang/.local/bin/claude',['--help']]]) {
 const executable=await realpath(path),id=randomUUID(),identity=await ops.create(id),stage=join(ops.root,'stages',id);
 for(const name of ['home','tmp']) await mkdir(join(stage,name),{mode:0o700});
 const policy=`(version 1)(allow default)(deny process-fork)(deny network*)(deny file-read* (subpath "/Users") (subpath "/private/var/folders") (subpath "/private/tmp"))(allow file-read-metadata)(allow file-read* (literal ${JSON.stringify(executable)}) (subpath ${JSON.stringify(stage)}))(deny file-write*)(allow file-write* (subpath ${JSON.stringify(stage)}))`;
 const policyFile=join(stage,'policy.sb'); await writeFile(policyFile,policy,{mode:0o600});
 const argv=['/usr/bin/env',`CLAUDE_CONFIG_DIR=${join(stage,'home/claude')}`,`CODEX_HOME=${join(stage,'home/codex')}`,'/usr/bin/sandbox-exec','-f',policyFile,executable,...args];
 const e={runtime,executable,sha256:hash(await readFile(executable)),id,identity,stage,argv,policy}; evidence.commands.push(e); await writeFile(out,JSON.stringify(evidence,null,2));
 try {e.receipt=await ops.execute(id,identity,stage,argv,10);e.output=await readFile(join(stage,'execution.log'),'utf8');await ops.remove('stages',id,identity);e.cleanup='deleted';} catch(error){e.error=String(error);e.cleanup='retained';}
 await writeFile(out,JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(e));
}
await store.close();
