import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,realpath,lstat,writeFile,readFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {connect} from 'node:net';
import {AtomicRecords,hash} from '../../../../v2/gateway/src/journal/atomic-records.ts';
import {OwnedOperations} from '../../../../v2/gateway/src/workflows/operations.ts';
const root=await realpath(await mkdtemp('/private/tmp/c6-')),nonce=randomUUID(),s=await lstat(root),out=new URL('./socket-result2.json',import.meta.url);
const evidence={formatVersion:1,root,nonce,identity:{dev:s.dev,ino:s.ino,uid:s.uid},messages:[]};
await writeFile(out,JSON.stringify(evidence,null,2));
const store=await AtomicRecords.open(join(root,'journal')),ops=await OwnedOperations.open(join(root,'ops'),store),id=randomUUID(),identity=await ops.create(id),stage=join(ops.root,'stages',id),socketPath=join(root,'discovery.sock');
for(const p of ['home/codex','home/claude','tmp','workspace']) await mkdir(join(stage,p),{recursive:true,mode:0o700});
const executable=await realpath('/Users/phannhatquang/.local/bin/codex');
const policy=`(version 1)(allow default)(deny process-fork)(deny network*)(allow network* (local unix-socket))(deny file-read*)(allow file-read-metadata)(allow file-read* (subpath "/System") (subpath "/usr") (subpath "/Library/Apple") (subpath "/bin") (subpath "/sbin") (subpath "/private/etc") (subpath "/dev") (literal ${JSON.stringify(executable)}) (subpath ${JSON.stringify(stage)}))(deny file-write*)(allow file-write* (literal "/dev/null") (subpath ${JSON.stringify(stage)}) (literal ${JSON.stringify(socketPath)}))`;
await writeFile(join(stage,'policy.sb'),policy,{mode:0o600});
const argv=['/usr/bin/env',`CODEX_HOME=${join(stage,'home/codex')}`,'/usr/bin/sandbox-exec','-f',join(stage,'policy.sb'),executable,'app-server','--listen',`unix://${socketPath}`];
Object.assign(evidence,{id,identity,stage,socketPath,argv,policy,executableSha256:hash(await readFile(executable))});await writeFile(out,JSON.stringify(evidence,null,2));
const execution=ops.execute(id,identity,stage,argv,8).then(r=>evidence.receipt=r).catch(e=>evidence.executionError=String(e));
try{
 let ready=false;for(let i=0;i<100;i++){try{const st=await lstat(socketPath);evidence.socketIdentity={dev:st.dev,ino:st.ino,uid:st.uid,isSocket:st.isSocket()};ready=true;break;}catch{}await new Promise(r=>setTimeout(r,40));}if(!ready)throw Error('SOCKET_NOT_READY');
 const client=connect(socketPath);await new Promise((r,j)=>{client.once('connect',r);client.once('error',j);});
 let buffer=Buffer.alloc(0),upgraded=false;
 const send=(o)=>{const b=Buffer.from(JSON.stringify(o)),mask=randomBytes(4),h=Buffer.alloc(b.length<126?6:8);h[0]=129;if(b.length<126){h[1]=128+b.length;mask.copy(h,2);}else{h[1]=254;h.writeUInt16BE(b.length,2);mask.copy(h,4);}for(let i=0;i<b.length;i++)b[i]^=mask[i%4];client.write(Buffer.concat([h,b]));};
 client.on('data',(chunk)=>{buffer=Buffer.concat([buffer,chunk]);if(!upgraded){const end=buffer.indexOf('\r\n\r\n');if(end<0)return;evidence.upgrade=buffer.subarray(0,end).toString();buffer=buffer.subarray(end+4);upgraded=true;send({id:1,method:'initialize',params:{clientInfo:{name:'crew_isolation_probe',version:'0.0.0'},capabilities:{experimentalApi:true}}});}
 while(buffer.length>=2){let n=buffer[1]&127,off=2;if(n===126){if(buffer.length<4)return;n=buffer.readUInt16BE(2);off=4;}if(n===127){if(buffer.length<10)return;n=Number(buffer.readBigUInt64BE(2));off=10;}if(buffer.length<off+n)return;const frame=buffer.subarray(off,off+n).toString();buffer=buffer.subarray(off+n);try{const msg=JSON.parse(frame);evidence.messages.push(msg);if(msg.id===1){send({method:'initialized'});send({id:2,method:'skills/list',params:{cwds:[join(stage,'workspace')],forceReload:true}});send({id:3,method:'hooks/list',params:{cwds:[join(stage,'workspace')]}});send({id:4,method:'config/read',params:{includeLayers:true,cwd:join(stage,'workspace')}});}}catch{}}});
 client.write(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n\r\n`);
 await new Promise(r=>setTimeout(r,3000));client.destroy();
}catch(e){evidence.discoveryError=String(e);}
await execution;evidence.output=await readFile(join(stage,'execution.log'),'utf8');
if(evidence.receipt){try{const now=await lstat(socketPath),old=evidence.socketIdentity;if(old&&now.dev===old.dev&&now.ino===old.ino&&now.uid===old.uid&&now.isSocket()){await unlink(socketPath);evidence.socketCleanup='deleted';}}catch(e){if(e.code==='ENOENT')evidence.socketCleanup='absent';else evidence.socketCleanup=String(e);}await ops.remove('stages',id,identity);evidence.cleanup='deleted';}else evidence.cleanup='retained';
await store.close();await writeFile(out,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
