import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,realpath,lstat,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {AtomicRecords} from '../../../../v2/gateway/src/journal/atomic-records.ts';
import {OwnedOperations} from '../../../../v2/gateway/src/workflows/operations.ts';
import {isolationPolicy} from '../../../../v2/gateway/src/isolation/policy.ts';
const root=await realpath(await mkdtemp('/private/tmp/c6policy-')),st=await lstat(root),out=new URL('./policy-diagnosis.json',import.meta.url);
const data={nonce:randomUUID(),root,identity:{dev:st.dev,ino:st.ino,uid:st.uid},commands:[]};await writeFile(out,JSON.stringify(data,null,2));
const store=await AtomicRecords.open(join(root,'journal')),ops=await OwnedOperations.open(join(root,'ops'),store);
for(const variant of ['strict','data-only','data-and-exec','builder']) {
 const id=randomUUID(),identity=await ops.create(id),stage=join(ops.root,'stages',id);
 for(const d of ['home','tmp'])await mkdir(join(stage,d),{mode:0o700});await writeFile(join(stage,'canary'),'OWNED_CANARY');
 let policy=isolationPolicy({workspace:stage,attemptHome:join(stage,'home'),projectionRoot:stage,executable:'/bin/cat',operationRoot:stage});
 if(variant==='data-only')policy=policy.replace('(deny file-read*)','(deny file-read-data)');
 if(variant==='data-and-exec')policy+='\n(allow file-map-executable)';
 if(variant==='builder')policy=policy.replace('(deny file-read*)','(deny file-read* (subpath "/Users") (subpath "/private/tmp") (subpath "/private/var/folders"))');
 await writeFile(join(stage,'policy.sb'),policy);const argv=['/usr/bin/sandbox-exec','-f',join(stage,'policy.sb'),'/bin/cat',join(stage,'canary')];
 const e={id,identity,stage,variant,policy,argv};data.commands.push(e);await writeFile(out,JSON.stringify(data,null,2));
 try{e.receipt=await ops.execute(id,identity,stage,argv,4);e.output=await readFile(join(stage,'execution.log'),'utf8');await ops.remove('stages',id,identity);e.cleanup='deleted';}catch(error){e.error=String(error);e.cleanup='retained';}await writeFile(out,JSON.stringify(data,null,2));
}
await store.close();console.log(JSON.stringify(data,null,2));
