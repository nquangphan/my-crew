import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {mkdtemp,realpath,lstat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const load=p=>import(pathToFileURL(join(process.cwd(),p)));
const {CredentialProvisioning,ServerReceiptClock}=await load('v2/gateway/src/models/credential-provisioning.ts');
const {CredentialBroker}=await load('v2/gateway/src/models/credential-broker.ts');
const {hash,canonicalJson}=await load('v2/gateway/src/journal/atomic-records.ts');
const nonce=randomUUID(),root=await mkdtemp(join(await realpath(tmpdir()),`crew-task2-fix1-review-${nonce}-`)),stat=await lstat(root);
const emit=(kind,data)=>console.log(JSON.stringify({kind,...data}));
emit('create',{nonce,root,pid:process.pid,dev:stat.dev,ino:stat.ino,uid:stat.uid});
let p,pid;
try{
 const machineId=randomUUID(),providerId=randomUUID(),keyId=randomUUID(),id=randomUUID();
 const key=generateKeyPairSync('x25519'),keyBytes=key.privateKey.export({type:'pkcs8',format:'der'}),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64');
 const bridge={read:async(s,a)=>a===keyId?Buffer.from(keyBytes):null,put:async()=>{throw new Error('unexpected write')},remove:async()=>{}};
 const broker=new CredentialBroker(machineId,bridge,[]),clock=new ServerReceiptClock(()=>0);let writes=0;
 const http={prepare:async()=>{writes++;throw new Error('unexpected HTTP')},replay:async()=>{writes++;throw new Error('unexpected HTTP')}};
 p=await CredentialProvisioning.open(root,machineId,bridge,broker,http,clock);pid=p.store.lock.child.pid;emit('lock-create',{pid});
 const envelope={id,machineId,providerId,keyId,configRevision:1,operationId:randomUUID(),expiresAt:'2026-10-02T07:05:00.000Z',ephemeralPublicKey:'fixture',nonce:'fixture',ciphertext:'fixture',tag:'fixture',ciphertextSha256:'a'.repeat(64)};
 const credentialRef=`${machineId}_${providerId}_${id}`;
 // Fixture reproduces persisted post-write/pre-receipt state; local generic credential was subsequently lost.
 await p.store.put('active-key',{formatVersion:1,id:keyId,publicKey,confirmed:true});
 await p.store.put(id,{formatVersion:1,envelopeHash:hash(canonicalJson(envelope)),ack:{operationId:envelope.operationId,keyId,ciphertextSha256:envelope.ciphertextSha256,credentialRef}});
 await p.store.put(`pending-envelope:${id}`,{formatVersion:1,envelope});
 await p.store.put('envelope-cursor',{formatVersion:1,cursor:'1'});
 await assert.rejects(p.replayAck(id),/CREDENTIAL_MISSING/);
 const result=await p.syncPending(async(route)=>route==='/v2/machine/model-sources'?{revision:1,enabled:{api:true,claude:false,codex:false},apiProviders:[{id:providerId,credentialStatus:'stored'}]}:{items:[],nextCursor:'1',serverTime:'2026-10-02T07:06:00.000Z'});
 assert.equal(result.state,'stored');assert.equal(writes,0);
 assert.ok((await p.store.get(`pending-envelope:${id}`)).envelope);
 emit('confirmed',{directReplay:'CREDENTIAL_MISSING',sameCurrentProviderServerStatus:'stored',syncPendingState:result.state,queueRetained:true,httpCalls:writes});keyBytes.fill(0);
} finally {
 await p?.close();if(pid){assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH');emit('lock-reaped',{pid})}
 const current=await lstat(root);assert.equal(current.dev,stat.dev);assert.equal(current.ino,stat.ino);assert.equal(current.uid,stat.uid);assert.equal(current.isSymbolicLink(),false);await rm(root,{recursive:true});await assert.rejects(lstat(root),e=>e.code==='ENOENT');emit('removed',{nonce,root,dev:stat.dev,ino:stat.ino,uid:stat.uid,absent:true});
}
