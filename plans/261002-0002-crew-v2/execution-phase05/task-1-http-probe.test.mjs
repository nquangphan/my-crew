import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';
import { databaseFixture } from '../../../v2/server/test/support/db.ts';
import { apiFixture } from '../../../v2/server/test/support/http.ts';

test('readonly actual oversized HTTP response observation', async()=>{
 await databaseFixture(6)(async db=>{
  console.info(`readonly probe PG=${process.env.CREW_V2_TEST_CONTAINER_ID}`);
  const f=await apiFixture(db);
  try{
   for(const [path,size] of [['/v2/tickets',1024*1024],['/v2/docs/imports',24*1024*1024]]){
    const body=Buffer.from(JSON.stringify({blob:'x'.repeat(size)}));
    const response=await new Promise((resolve,reject)=>{
     let arrived=false;const req=request(`${f.url}${path}`,{method:'POST',headers:{cookie:f.identity.cookie,origin:'http://localhost:5182','x-csrf-token':f.identity.csrf,'idempotency-key':`read-only-${size}`,'content-type':'application/json','content-length':body.length}},res=>{
      arrived=true;const parts=[];res.on('data',chunk=>parts.push(chunk));res.on('error',reject);res.on('end',()=>{req.destroy();resolve({status:res.statusCode,text:Buffer.concat(parts).toString()});});
     });
     req.setTimeout(5000,()=>{req.destroy();reject(new Error('PROBE_TIMEOUT'));});
     req.on('error',error=>{if(!arrived)reject(error);});
     req.flushHeaders();req.write(body.subarray(0,64*1024));
    });
    assert.equal(response.status,413);console.info(`readonly observed path=${path} Content-Length=${body.length} actualStatus=${response.status} response=${response.text}`);
   }
  }finally{await f.close();}
 });
});
