import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createServer,createConnection} from 'node:net';
import {attachmentFixture,bufferBody,sha} from '../../../v2/server/test/support/attachments.ts';
import {owner} from '../../../v2/server/test/support/tickets.ts';
import {connectDb} from '../../../v2/server/src/db/client.ts';
const database=process.argv[2];assert.equal(process.platform,'linux');assert.match(database,/^crew_v2_test_[0-9a-f]{32}$/);
const sockets=new Set();const proxy=createServer(inbound=>{
 const outbound=createConnection({host:'127.0.0.1',port:5432});sockets.add(inbound);sockets.add(outbound);inbound.pipe(outbound);outbound.pipe(inbound);
 const close=()=>{inbound.destroy();outbound.destroy();sockets.delete(inbound);sockets.delete(outbound);};inbound.on('error',close);outbound.on('error',close);inbound.on('close',close);outbound.on('close',close);
});
await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',resolve);});
const address=proxy.address();assert.ok(address&&typeof address!=='string');assert.ok(![5432,55432].includes(address.port));
const db=connectDb(`postgres://postgres@127.0.0.1:${address.port}/${database}`);
let f,release=()=>{},closedPromise;
try{
 const rows=await db`select version,checksum from schema_migrations where version in (8,9) order by version`;
 assert.equal(rows[0].checksum,'d268ddab0d2ec93584135dbddb21917627cd56bbf625dec02945a16e15255f8f');assert.equal(rows[1].checksum,'fe0f888dd1a095f44561152d8c19a8237167a54343049065e7756df700975a2a');
 f=await attachmentFixture(db,{nativeReceiver:true,env:{CREW_V2_ATTACHMENT_UPLOAD_MAX_WALL_MS:'200'}});
 const reserve=async bytes=>{
  const compose=await f.mutation(randomUUID(),tx=>f.stage.createCompose(tx,{projectId:f.project.id,ticketId:null,purpose:'ticket'},owner));
  const result=await f.mutation(randomUUID(),tx=>f.stage.reserve(tx,{composeSessionId:compose.id,expectedRevision:1,fileName:'note.txt',declaredMime:'text/plain',byteLength:bytes.length,sha256:sha(bytes)},owner));return result.attachment.attachmentId;
 };
 const bytes=Buffer.from('ok'),id=await reserve(bytes);assert.equal((await f.stage.receive(id,owner,bufferBody(bytes),new AbortController().signal)).state,'ready');
 let entered=()=>{},finished=()=>{},closed=0;const started=new Promise(resolve=>{entered=resolve;});closedPromise=new Promise(resolve=>{finished=resolve;});const barrier=new Promise(resolve=>{release=resolve;});
 async function* blocked(){try{entered();await barrier;yield bytes;}finally{closed++;finished();}}
 const task=f.stage.receive(id,owner,blocked(),new AbortController().signal);const failed=assert.rejects(task,{code:'ATTACHMENT_UPLOAD_TIMEOUT'});await started;const since=performance.now();await failed;assert.ok(performance.now()-since<450);assert.equal(closed,0);
 await assert.rejects(f.stage.receive(id,owner,bufferBody(bytes),new AbortController().signal),{code:'ATTACHMENT_UPLOAD_BUSY'});
 const [before]=await db`select state,generation,receiver_id,quota_released_at from attachment_uploads where id=${id}`;assert.equal(before.state,'ready');assert.equal(before.quota_released_at,null);
 release();await closedPromise;assert.equal(closed,1);assert.equal((await f.stage.receive(id,owner,bufferBody(bytes),new AbortController().signal)).state,'ready');
 const [after]=await db`select state,generation,receiver_id,quota_released_at from attachment_uploads where id=${id}`;assert.deepEqual(after,before);
 console.info(`FIX1 native replay timeout/BUSY/actualclosure/retry verified attachment=${id}`);
 for(const invalid of [Buffer.from([1]),Buffer.from([0xc3]),Buffer.from([0xff,0xfe,1])]){
  const rejectedId=await reserve(invalid);await assert.rejects(f.stage.receive(rejectedId,owner,bufferBody(invalid),new AbortController().signal),{code:'ATTACHMENT_BINARY_TEXT'});
  const [row]=await db`select u.state,u.storage_key,u.receiver_id,u.quota_released_at,r.state as receiver_state from attachment_uploads u join attachment_receivers r on r.id=u.receiver_id where u.id=${rejectedId}`;
  assert.equal(row.state,'rejected');assert.equal(row.receiver_state,'closed');assert.equal(row.quota_released_at,null);assert.equal(await f.store.verify({key:String(row.storage_key),sha256:sha(invalid),byteLength:invalid.length}),'missing');
  const proof=await f.receivers.proveStopped(String(row.receiver_id));assert.ok(proof);assert.equal(proof.kind,'closed-ack');assert.equal(proof.identity.pid,process.pid);
  console.info(`FIX1 native EOF reject exactACK verified receiver=${row.receiver_id} bytes=${invalid.toString('hex')}`);
 }
 for(const valid of [Buffer.alloc(0),Buffer.from('a'),Buffer.from('\t'),Buffer.from('\n'),Buffer.from('\r'),Buffer.from([0xff,0xfe,0x41,0])]){
  const validId=await reserve(valid);async function* split(){for(const byte of valid)yield Buffer.from([byte]);}
  assert.equal((await f.stage.receive(validId,owner,split(),new AbortController().signal)).state,'ready');
 }
 console.info('FIX1 native empty/ASCII/tabLFCR/splitUTF16 verified');
}finally{
 release();if(closedPromise)await closedPromise;if(f)await f.close();await db.end();for(const socket of sockets)socket.destroy();await new Promise(resolve=>proxy.close(resolve));
}
