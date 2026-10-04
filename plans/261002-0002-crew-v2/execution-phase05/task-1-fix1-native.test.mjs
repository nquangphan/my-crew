import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import test from 'node:test';
import {databaseFixture} from '../../../v2/server/test/support/db.ts';
const exec=promisify(execFile);
test('FIX1 actual Linux private PG replay and EOF regressions',async()=>{
 await databaseFixture(9)(async db=>{
  const pg=process.env.CREW_V2_TEST_CONTAINER_ID;assert.match(pg,/^[0-9a-f]{64}$/);
  const [row]=await db`select current_database() as name`;assert.match(row.name,/^crew_v2_test_[0-9a-f]{32}$/);
  const repo=fileURLToPath(new URL('../../../',import.meta.url));let id='';
  try{
   const created=await exec('docker',['create','--name',`crew-v2-attachments-fix1-${randomUUID()}`,'--label','crew.phase05.task1=fix1-native','--network',`container:${pg}`,'--read-only','--cap-drop','ALL','--memory','256m','--cpus','1','--pids-limit','32','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','-v',`${repo}:/workspace:ro`,'-w','/workspace','node:24.12.0@sha256:929c026d5a4e4a59685b3c1dbc1a8c3eb090aa95373d3a4fd668daa2493c8331','node','plans/261002-0002-crew-v2/execution-phase05/task-1-fix1-native-probe.mjs',row.name]);
   id=created.stdout.trim();assert.match(id,/^[0-9a-f]{64}$/);console.info(`FIX1 native created ${id} pg=${pg} database=${row.name}`);
   const result=await exec('docker',['start','-a',id],{maxBuffer:1024*1024,timeout:15000});console.info(result.stdout.trim());
   const inspect=await exec('docker',['inspect','--format','{{.State.ExitCode}}',id]);assert.equal(inspect.stdout.trim(),'0');
  }catch(error){if(error.stdout)console.info(error.stdout);if(error.stderr)console.info(error.stderr);throw error;}
  finally{if(id){await exec('docker',['rm','-f',id]);console.info(`FIX1 native removed ${id}`);}}
 });
});
