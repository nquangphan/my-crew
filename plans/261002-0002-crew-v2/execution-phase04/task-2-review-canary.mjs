import assert from 'node:assert/strict';
import {randomUUID, createCipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes} from 'node:crypto';
import {mkdtemp,lstat,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
const load=(p)=>import(pathToFileURL(join(process.cwd(),p)));
const {ServerReceiptClock,CredentialProvisioning}=await load('v2/gateway/src/models/credential-provisioning.ts');
const {ModelReporter}=await load('v2/gateway/src/models/model-reporter.ts');
const {CredentialBroker}=await load('v2/gateway/src/models/credential-broker.ts');
const {ModelProber,parseStream}=await load('v2/gateway/src/models/probe.ts');
const {PinnedProviderTransport}=await load('v2/gateway/src/models/provider-transport.ts');
const {canonicalJson,hash}=await load('v2/gateway/src/journal/atomic-records.ts');
const {initialStatus}=await load('v2/gateway/src/host/status.ts');
const emit=(kind,data)=>console.log(JSON.stringify({kind,...data}));
const originTime=Date.parse('2026-10-02T07:00:00.000Z');
let mono=0;const clock=new ServerReceiptClock(()=>mono);clock.observe(new Date(originTime).toISOString());mono=50;
let clockError;try{clock.assertFresh(new Date(originTime+300050).toISOString())}catch(e){clockError=e.message}
assert.equal(clockError,'SECRET_EXPIRED');emit('clock',{elapsedMs:50,remainingTtlMs:300000,actual:clockError});
const reply={model:'chosen',status:'completed',output:[{type:'message',content:[{type:'output_text',text:'fixture'}]}]};
const lf=`data: ${JSON.stringify({type:'response.completed',response:reply})}\n\n`;
assert.deepEqual(parseStream('responses',lf,'chosen'),reply);
let crlfError;try{parseStream('responses',lf.replaceAll('\n','\r\n'),'chosen')}catch(e){crlfError=e.message}
assert.equal(crlfError,'STREAM_PROTOCOL');emit('sse-crlf',{lfAccepted:true,crlf:crlfError});
const malformed=`data: ${JSON.stringify({type:'response.function_call_arguments.delta',item_id:'unknown',output_index:99,delta:'not-json'})}\n\ndata: ${JSON.stringify({type:'response.failed',response:{model:'wrong',status:'failed'}})}\n\n`+lf;
assert.deepEqual(parseStream('responses',malformed,'chosen'),reply);emit('sse-correlation',{orphanToolDeltaAndFailedOtherModelAccepted:true});
const nonce=randomUUID();const root=await mkdtemp(join(await realpath(tmpdir()),`crew-task2-review-${nonce}-`));const identity=await lstat(root);
emit('resource-create',{nonce,root,pid:process.pid,dev:identity.dev,ino:identity.ino,uid:identity.uid});
const opened=[];const lockPids=[];
function track(obj,label){opened.push(obj);const pid=obj.store.lock.child.pid;lockPids.push(pid);emit('lock-create',{label,pid,root});return obj}
const timeout=setTimeout(()=>{throw new Error('CANARY_DEADLINE')},15000);
let server;
try{
 const prepared=new Map(),sent=[];
 const wire={prepare:async(x)=>{prepared.set(x.operationId,structuredClone(x))},replay:async(id)=>{const x=prepared.get(id);sent.push(x);return{status:200,body:{reportId:x.canonicalBody.reportId,accepted:true}}}};
 let revision=1;const boot={bootId:randomUUID(),bootGeneration:'1'};
 const reporter=track(await ModelReporter.open(root,wire,{currentBoot:()=>boot,getDesired:async()=>({revision,enabled:{api:true,claude:true,codex:false},apiProviders:[]})}),'reporter');
 let start;const started=new Promise(r=>start=r);let release;const barrier=new Promise(r=>release=r);
 const staleEntry={key:{machineId:randomUUID(),runtime:'claude',providerId:'claude',modelId:'old-observation'},context:{},observedAt:'2026-10-02T07:00:00.000Z',status:'unverified',capabilities:[],evidenceDigest:'0'.repeat(64),errorCode:'CLI_ABSENT',runtimeVersion:null};
 const first=reporter.reconnect(initialStatus().workflows,async(c)=>{assert.equal(c.revision,1);start();await barrier;return[staleEntry]});
 await started;revision=2;await reporter.reconnect(initialStatus().workflows,async()=>[]);release();await first;
 assert.equal(sent[1].canonicalBody.configRevision,2);assert.equal(sent[1].canonicalBody.body.entries[0].key.modelId,'old-observation');
 emit('report-race',{collectedRevision:1,sentRevision:sent[1].canonicalBody.configRevision,sequence:sent[1].canonicalBody.sequence});
 const items=new Map();const bridge={read:async(s,a)=>{const b=items.get(s+'/'+a);return b?Buffer.from(b):null},put:async(s,a,b)=>items.set(s+'/'+a,Buffer.from(b)),remove:async(s,a)=>items.delete(s+'/'+a)};
 const machineId=randomUUID(),providerId=randomUUID();const broker=new CredentialBroker(machineId,bridge,[]);
 let receiptMono=0;const receiptClock=new ServerReceiptClock(()=>receiptMono);receiptClock.observe(new Date(originTime).toISOString());
 let keyId,publicKey,loseAck=true,ackCalls=0;const requests=new Map(),cached=new Map();
 function seal(pub,clear,aad){const ep=generateKeyPairSync('x25519'),nonce=randomBytes(12),shared=diffieHellman({privateKey:ep.privateKey,publicKey:createPublicKey({key:Buffer.from(pub,'base64'),format:'der',type:'spki'})}),aes=Buffer.from(hkdfSync('sha256',shared,nonce,'crew-v2-secret-envelope-v1',32)),c=createCipheriv('aes-256-gcm',aes,nonce);c.setAAD(Buffer.from(canonicalJson(aad)));const ciphertext=Buffer.concat([c.update(clear),c.final()]);shared.fill(0);aes.fill(0);return{ephemeralPublicKey:ep.publicKey.export({type:'spki',format:'der'}).toString('base64'),nonce:nonce.toString('base64'),ciphertext:ciphertext.toString('base64'),tag:c.getAuthTag().toString('base64'),ciphertextSha256:hash(ciphertext)}}
 const wire2={prepare:async(x)=>{const old=requests.get(x.operationId);if(old)assert.deepEqual(old,x);else requests.set(x.operationId,structuredClone(x))},replay:async(id)=>{
  if(cached.has(id))return cached.get(id);const r=requests.get(id);let body;
  if(r.route==='/v2/machine/credential-keys'){({keyId,publicKeyX25519:publicKey}=r.canonicalBody);const challengeId=randomUUID(),expiresAt=new Date(originTime+300000).toISOString();body={challengeId,expiresAt,encryptedChallenge:seal(publicKey,'fixture-challenge',{machineId,keyId,challengeId,expiresAt})}}
  else if(r.route.endsWith('/ack')){ackCalls++;if(loseAck)throw new Error('fixture lost committed ACK response');body={status:'acked'}}else body={status:'active'};
  const response={status:200,body};cached.set(id,response);return response;
 }};
 const provisioning=track(await CredentialProvisioning.open(root,machineId,bridge,broker,wire2,receiptClock),'provisioning');
 await provisioning.registerKey();
 const base={id:randomUUID(),machineId,providerId,keyId,configRevision:1,operationId:randomUUID(),expiresAt:new Date(originTime+300000).toISOString()};
 const aad={machineId,providerId,keyId,configRevision:1,operationId:base.operationId,expiresAt:base.expiresAt};
 const envelope={...base,...seal(publicKey,'fixture-token',aad)};
 let batchIndex=0;
 const read=async(route)=>route==='/v2/machine/model-sources'?{revision:1,enabled:{api:true,claude:false,codex:false},apiProviders:[{id:providerId}]}:{items:batchIndex++===0?[envelope]:[],nextCursor:'1',serverTime:new Date(originTime+receiptMono).toISOString()};
 assert.equal((await provisioning.syncPending(read)).state,'pending');assert.equal(ackCalls,1);
 loseAck=false;receiptMono=300001;
 const recovery=await provisioning.syncPending(read);assert.equal(recovery.state,'pending');assert.equal(ackCalls,1);
 await provisioning.replayAck(envelope.id);assert.equal(ackCalls,2);
 emit('ack-recovery',{syncState:recovery.state,automaticAckCallsAfterReconnect:1,explicitReplaySucceeds:true});
 let hits=0;server=createServer((_req,res)=>{hits++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'chosen',status:'completed',output:[{type:'function_call',name:'crew_probe_echo',call_id:'x',arguments:'bad-json'}]}))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;emit('listener-create',{pid:process.pid,host:'127.0.0.1',port});
 const endpoint=`http://127.0.0.1:${port}`;const provider={id:providerId,endpoint:endpoint+'/v1/',protocol:'responses',models:[{id:'chosen',declared:['text','tools']}],credentialStatus:'stored',localHttp:{enabled:true,allowedOrigin:endpoint}};
 const transport=new PinnedProviderTransport(provider);const tb=new CredentialBroker(machineId,bridge,[transport.deliver]);const ref=await tb.put(providerId,Buffer.from('fixture-token'));
 const source={sourceTreeSha256:'a'.repeat(64)};const projection={runtime:'api',sourceTreeSha256:source.sourceTreeSha256,manifestSha256:'b'.repeat(64),treeSha256:'c'.repeat(64),derivation:{policySha256:'d'.repeat(64)}};
 const context={sourceTreeSha256:source.sourceTreeSha256,projectionManifestSha256:projection.manifestSha256,projectionTreeSha256:projection.treeSha256,derivationSha256:hash(canonicalJson(projection.derivation)),binarySha256:'e'.repeat(64),policySha256:'d'.repeat(64),osVersion:'fixture'};
 const prober=new ModelProber({context:async()=>({context,version:null}),provider:()=>provider,offline:(_key,signal)=>transport.call('chosen',tb,ref,signal),deadlineMs:1000});
 const outcome=await prober.probeModel({machineId,runtime:'api',providerId,modelId:'chosen'},{source,projection},'offline');assert.equal(outcome.errorCode,'TRANSIENT');assert.equal(hits,1);
 emit('transport-classification',{actual:outcome.errorCode,status:outcome.status,expected:'TOOL_PROTOCOL',requests:hits});
} finally {
 if(server){const address=server.address();server.closeAllConnections();await new Promise(r=>server.close(r));emit('listener-closed',{address,pid:process.pid})}
 for(const obj of opened.reverse())await obj.close();
 for(const pid of lockPids){let absent=false;try{process.kill(pid,0)}catch(e){absent=e.code==='ESRCH'}assert.equal(absent,true);emit('lock-reaped',{pid})}
 clearTimeout(timeout);const current=await lstat(root);assert.equal(current.dev,identity.dev);assert.equal(current.ino,identity.ino);assert.equal(current.uid,identity.uid);assert.equal(current.isSymbolicLink(),false);await rm(root,{recursive:true});let absent=false;try{await lstat(root)}catch(e){absent=e.code==='ENOENT'}assert.equal(absent,true);emit('resource-removed',{nonce,root,dev:identity.dev,ino:identity.ino,uid:identity.uid,absent});
}
emit('complete',{checks:6,sourceMutation:false,network:'one owned loopback fixture only',keychain:'fake map only'});
