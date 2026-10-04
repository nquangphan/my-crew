import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const root=process.cwd();
const require=createRequire(path.join(root,'v2/server/package.json'));
const {parse,stringify}=require('yaml');
const manifestFile=path.join(root,'v2/docs/flows.yaml');
const manifest=parse(await fs.readFile(manifestFile,'utf8'));
const prefix=process.argv[2] || 'server-platform';
const unit=process.argv[3] || 'platform';
async function walk(dir){const found=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())found.push(...await walk(p));else found.push(path.relative(path.join(root,'v2'),p).split(path.sep).join('/'));}return found.sort();}
if(unit==='platform'){
 manifest.source.include=['src/**','server/src/**','server/scripts/**','server/migrations/**'];
 const files=[...await walk(path.join(root,'v2/server/src/platform')),...await walk(path.join(root,'v2/server/src/db')),...await walk(path.join(root,'v2/server/scripts')),'server/migrations/001_platform.sql','server/package.json','server/tsconfig.json'];
 manifest.flows[prefix]={title:'Nền tảng server và database riêng Crew v2',doc:`docs/flows/${prefix}.md`,entrypoints:['server/src/db/migrate.ts'],files:files.filter(f=>f!=='server/src/db/migrate.ts'),tests:['server/test/platform.test.ts','server/test/support/db.ts']};
}
if(unit==='journal'){
 const files=[...await walk(path.join(root,'v2/server/src/journal')),'server/migrations/002_journal.sql'];
 manifest.flows[prefix]={title:'Mutation và event journal bền vững Crew v2',doc:`docs/flows/${prefix}.md`,entrypoints:['server/src/journal/routes.ts'],files:files.filter(f=>f!=='server/src/journal/routes.ts'),tests:(await walk(path.join(root,'v2/server/test'))).filter(f=>/^server\/test\/journal(?:-.*)?\.test\.ts$/.test(f))};
}
if(unit==='journal-event-extension'){
 manifest.flows[prefix].tests=[...new Set([...manifest.flows[prefix].tests,'server/test/attachments-events.unit.test.ts'])].sort();
}
if(unit==='identity'){
 const files=[...await walk(path.join(root,'v2/server/src/auth')),...await walk(path.join(root,'v2/server/src/projects')),'server/migrations/003_identity.sql'];
 const entries=['server/src/auth/routes.ts','server/src/projects/routes.ts'];
 manifest.flows[prefix]={title:'Xác thực owner và gắn dự án với máy Crew v2',doc:`docs/flows/${prefix}.md`,entrypoints:entries,files:files.filter(f=>!entries.includes(f)),tests:['server/test/auth.test.ts','server/test/projects.test.ts','server/test/support/identity-app.ts']};
}
if(unit==='docs-unit'){
 const files=await walk(path.join(root,'v2/server/src/docs'));
 manifest.flows[prefix]={title:'Kiểm tra snapshot tài liệu và nhập nguyên trạng Crew v2',doc:`docs/flows/${prefix}.md`,entrypoints:['server/src/docs/validator.ts'],files:files.filter(f=>f!=='server/src/docs/validator.ts'),tests:['server/test/docs-validator.unit.test.ts','server/test/support/docs.ts',...await walk(path.join(root,'v2/server/test/fixtures/legacy-docs'))]};
}
if(unit==='docs-import'){
 const files=[...await walk(path.join(root,'v2/server/src/docs')),'server/scripts/docs-import.ts','server/migrations/006_docs.sql'];
 const entries=['server/scripts/docs-import.ts','server/src/docs/validator.ts'];
 const tests=(await walk(path.join(root,'v2/server/test'))).filter(f=>/^server\/test\/docs(?:-.*)?\.(?:unit\.)?test\.ts$/.test(f));
 manifest.flows[prefix]={title:'Kiểm tra snapshot tài liệu và nhập nguyên trạng Crew v2',doc:`docs/flows/${prefix}.md`,entrypoints:entries,files:files.filter(f=>!entries.includes(f)),tests:[...tests,'server/test/support/docs.ts',...await walk(path.join(root,'v2/server/test/fixtures/legacy-docs'))]};
}
if(unit==='tickets'){
 const files=[...await walk(path.join(root,'v2/server/src/tickets')),'server/migrations/004_tickets.sql',...(await walk(path.join(root,'v2/server/migrations'))).filter(f=>f==='server/migrations/010_attachment_comment_text.sql')];
 manifest.flows[prefix]={title:'Cây ticket, phụ thuộc và bằng chứng hoàn tất',doc:`docs/flows/${prefix}.md`,entrypoints:['server/src/tickets/routes.ts'],files:files.filter(f=>f!=='server/src/tickets/routes.ts'),tests:['server/test/tickets.test.ts','server/test/dependencies.test.ts','server/test/completion.test.ts','server/test/repair.test.ts','server/test/support/tickets.ts','server/test/ticket-events.unit.test.ts','server/test/deploy.test.ts',...(await walk(path.join(root,'v2/server/test'))).filter(f=>f==='server/test/attachments-comment-factory.test.ts')]};
}
if(unit==='gateway-shell'){
 manifest.source.include=[...new Set([...manifest.source.include,'gateway/src/**','desktop/src/**'])];
 for(const name of ['gateway','desktop']){
  const id=name==='gateway'?'gateway-host':'desktop-shell';
  const files=[...await walk(path.join(root,`v2/${name}/src`)),`${name}/package.json`,`${name}/pnpm-lock.yaml`,`${name}/tsconfig.json`,`${name}/tsconfig.build.json`];
  const entry=name==='gateway'?'gateway/src/host/main.ts':'desktop/src/main/index.ts';
  manifest.flows[id]={title:name==='gateway'?'Host cổng macOS Crew v2':'Giao diện cổng Crew v2 trên macOS',doc:`docs/flows/${id}.md`,entrypoints:[entry],files:files.filter(f=>f!==entry),tests:await walk(path.join(root,`v2/${name}/test`))};
 }
}
if(unit==='execution'){
 const files=[...await walk(path.join(root,'v2/server/src/execution')),'server/migrations/005_execution.sql'];
 manifest.flows[prefix]={title:'Command, attempt và quyền thực thi có fencing',doc:`docs/flows/${prefix}.md`,entrypoints:['server/src/execution/routes.ts'],files:files.filter(f=>f!=='server/src/execution/routes.ts'),tests:['server/test/commands.test.ts','server/test/attempts.test.ts','server/test/execution-events.unit.test.ts','server/test/support/execution.ts']};
}
if(unit==='integration-view'){
 const entries=['server/src/app.ts','server/src/docs/routes.ts'];
 const files=['server/src/main.ts','server/src/docs/read.ts','server/src/docs/search.ts'];
 manifest.flows[prefix]={title:'Đọc tài liệu và tích hợp HTTP Crew v2',doc:`docs/flows/${prefix}.md`,entrypoints:entries,files,tests:['server/test/docs-read.test.ts','server/test/api-acceptance.test.ts','server/test/support/http.ts']};
 const authFile='server/src/tickets/authorization.ts';
 if(!manifest.flows['server-tickets'].files.includes(authFile))manifest.flows['server-tickets'].files.push(authFile);
}
if(unit==='gateway-workflows'){
 const entries=['gateway/src/workflows/registry.ts'];
 const files=await walk(path.join(root,'v2/gateway/src/workflows'));
 manifest.flows[prefix]={title:'Registry workflow ghim nguồn và runtime projection',doc:`docs/flows/${prefix}.md`,entrypoints:entries,files:files.filter(f=>!entries.includes(f)),tests:[...(await walk(path.join(root,'v2/gateway/test'))).filter(f=>/^gateway\/test\/workflow(?:-.*)?\.test\.ts$/.test(f)),'gateway/test/support/workflow-archives.ts',...(await walk(path.join(root,'v2/gateway/test/support'))).filter(f=>/(?:audit-dependency-content|audit-dependency-provenance|compare-real-builds|freeze-dependencies|freeze-real-projections|probe-bmad-build|reclaim-proven-build-probes|workflow-crash-worker|workflow-admission-crash-worker)\.(?:ts|py)$/.test(f)),...await walk(path.join(root,'v2/gateway/test/fixtures/workflows')),...await walk(path.join(root,'v2/gateway/test/fixtures/workflow-builder'))]};
}
if(unit==='gateway-isolation'){
 const flow=manifest.flows['gateway-workflows'];
 const files=['workspace','policy','inventory','preflight'].map(name=>`gateway/src/isolation/${name}.ts`);
 const tests=['gateway/test/isolation-workspace.test.ts','gateway/test/isolation.test.ts','gateway/test/support/isolation-probe.ts','gateway/test/support/isolation-typecheck.json'];
 for(const file of [...files,...tests])await fs.access(path.join(root,'v2',file));
 flow.files=[...new Set([...flow.files,...files])].sort();
 flow.tests=[...new Set([...flow.tests,...tests])].sort();
}
if(unit==='gateway-server'){
 const entries=['server/src/gateway/routes.ts'];
 const files=[...await walk(path.join(root,'v2/server/src/gateway')),'server/migrations/007_gateway.sql'];
 manifest.flows[prefix]={title:'Control plane gateway và boot/config/report',doc:`docs/flows/${prefix}.md`,entrypoints:entries,files:files.filter(f=>!entries.includes(f)),tests:['server/test/gateway.test.ts','server/test/support/gateway.ts']};
}
if(unit==='server-models'){
 const entries=['server/src/models/routes.ts'];
 const files=[...await walk(path.join(root,'v2/server/src/models')),'server/migrations/008_model_pool.sql'];
 const tests=(await walk(path.join(root,'v2/server/test'))).filter(f=>/^server\/test\/model(?:-.*)?\.test\.ts$/.test(f));
 const support=(await walk(path.join(root,'v2/server/test/support'))).filter(f=>/^server\/test\/support\/model(?:-.*)?\.ts$/.test(f));
 manifest.flows[prefix]={title:'Nguồn model, catalogue và provisioning credential Crew v2',doc:`docs/flows/${prefix}.md`,entrypoints:entries,files:files.filter(f=>!entries.includes(f)),tests:[...tests,...support]};
}
if(unit==='gateway-sync'){
 const flow=manifest.flows['gateway-host'];
 const files=[];for(const dir of ['sync','commands','execution'])files.push(...await walk(path.join(root,`v2/gateway/src/${dir}`)));
 flow.files=[...new Set([...flow.files,...files])].sort();
 const tests=['connection','event-pump','execution-bridge-db','execution-bridge','execution-crash','pin-retirement','retirement-crash','stop-control','sync'].map(name=>`gateway/test/${name}.test.ts`);
 const support=['bridge-crash-worker','bridge-fixture','pin-retirement-crash-worker'].map(name=>`gateway/test/support/${name}.ts`);
 for(const file of [...tests,...support])await fs.access(path.join(root,'v2',file));
 flow.tests=[...new Set([...flow.tests,...tests,...support])].sort();
}
if(unit==='gateway-models'){
 const files=await walk(path.join(root,'v2/gateway/src/models'));
 manifest.flows[prefix]={title:'Inventory, credential broker và probe model trên gateway',doc:`docs/flows/${prefix}.md`,entrypoints:[],files,tests:[...(await walk(path.join(root,'v2/gateway/test'))).filter(f=>/^gateway\/test\/(?:model(?:-.*)?|credential(?:-.*)?|current-credential-resolver)\.test\.ts$/.test(f)),...(await walk(path.join(root,'v2/gateway/test/support'))).filter(f=>/^gateway\/test\/support\/(?:model(?:-.*)?|credential(?:-.*)?)\.(?:ts|c)$/.test(f)),...await walk(path.join(root,'v2/gateway/test/fixtures/models'))]};
}
if(unit==='gateway-runtime'){
 const files=await walk(path.join(root,'v2/gateway/src/runtime'));
 const tests=(await walk(path.join(root,'v2/gateway/test'))).filter(f=>/^gateway\/test\/(?:runtime-boundary|runtime-crash|runtime-workspace|effect-ledger|isolation-runtime)\.test\.ts$/.test(f));
 const support=(await walk(path.join(root,'v2/gateway/test/support'))).filter(f=>/^gateway\/test\/support\/(?:runtime|effect-ledger|isolation-runtime)(?:-.*)?\.(?:ts|json)$/.test(f));
 manifest.flows[prefix]={title:'Boundary runtime và receipt logical effect Crew v2',doc:`docs/flows/${prefix}.md`,entrypoints:[],files,tests:[...tests,...support]};
}
if(unit==='server-assistant'){
 const files=[...await walk(path.join(root,'v2/server/src/assistant')),'server/migrations/011_assistant.sql'];
 const tests=(await walk(path.join(root,'v2/server/test'))).filter(f=>/^server\/test\/assistant(?:-.*)?\.test\.ts$/.test(f));
 const support=(await walk(path.join(root,'v2/server/test/support'))).filter(f=>/^server\/test\/support\/assistant(?:-.*)?\.ts$/.test(f));
 manifest.flows[prefix]={title:'Trợ lý, workflow và work inbox bền vững Crew v2',doc:`docs/flows/${prefix}.md`,entrypoints:[],files,tests:[...tests,...support]};
}
const extractorSource=f=>/^server\/src\/attachments\/(?:jobs|worker-(?:runner|protocol|entry|diagnostic))\.ts$/.test(f)||f.startsWith('server/src/attachments/extract/');
const extractorTest=f=>/^server\/test\/attachments-(?:worker(?:-live)?|formats|text-csv|pdf-image|ooxml)\.(?:unit\.)?test\.ts$/.test(f)||f.startsWith('server/test/fixtures/attachments/');
if(unit==='server-attachments'){
 const files=[...(await walk(path.join(root,'v2/server/src/attachments'))).filter(f=>!extractorSource(f)),'server/migrations/009_attachments.sql'];
 manifest.flows[prefix]={title:'Storage và staging attachment Crew v2',doc:`docs/flows/${prefix}.md`,entrypoints:[],files,tests:[...(await walk(path.join(root,'v2/server/test'))).filter(f=>/^server\/test\/attachment(?:s)?(?:-.*)?\.test\.ts$/.test(f)&&!extractorTest(f)&&f!=='server/test/attachments-comment-factory.test.ts'),...(await walk(path.join(root,'v2/server/test/support'))).filter(f=>/^server\/test\/support\/attachment(?:s)?(?:-.*)?\.ts$/.test(f))]};
}
if(unit==='attachment-extraction'){
 const source=(await walk(path.join(root,'v2/server/src/attachments'))).filter(extractorSource);
 const files=[...source,'server/extractor.Dockerfile','server/extractor.dockerignore'];
 manifest.flows[prefix]={title:'Worker trích xuất attachment có giới hạn',doc:`docs/flows/${prefix}.md`,entrypoints:['server/src/attachments/worker-entry.ts'],files:files.filter(f=>f!=='server/src/attachments/worker-entry.ts'),tests:(await walk(path.join(root,'v2/server/test'))).filter(extractorTest)};
}

await fs.writeFile(manifestFile,stringify(manifest));
execFileSync('git',['add','--','v2/docs/flows.yaml'],{cwd:root});
const mirror=await fs.mkdtemp(path.join(os.tmpdir(),'crew-v2-docs-'));
try{
 const baselineArchive=path.join(mirror,'.baseline.tar');
 execFileSync('git',['archive','HEAD:v2','--output',baselineArchive],{cwd:root});
 execFileSync('tar',['-xf',baselineArchive,'-C',mirror]);
 await fs.unlink(baselineArchive);
 execFileSync('git',['init','-q'],{cwd:mirror});
 execFileSync('git',['add','.'],{cwd:mirror});
 execFileSync('git',['-c','user.name=Crew v2 docs fixture','-c','user.email=docs-fixture@localhost','commit','-qm','baseline'],{cwd:mirror});
 // Verify exactly the serialized commit candidate; parallel untracked workers
 // are not part of this task and must not enter its docs fixture.
 for(const entry of await fs.readdir(mirror))if(entry!=='.git')await fs.rm(path.join(mirror,entry),{recursive:true,force:true});
 const indexed=execFileSync('git',['ls-files','-z','--cached','--','v2'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
 for(const file of indexed){
  const target=path.join(mirror,file.slice('v2/'.length));
  await fs.mkdir(path.dirname(target),{recursive:true});
  const output=await fs.open(target,'w');
  try{execFileSync('git',['show',`:${file}`],{cwd:root,stdio:['ignore',output.fd,'pipe']});}
  finally{await output.close();}
 }
 const bundle=process.env.CREW_V2_DOCS_BUNDLE || '/Users/phannhatquang/Documents/projects/crew/packages/docs-kit/dist/crew-docs.cjs';
 if(!path.isAbsolute(bundle))throw Error('Docs validator path must be absolute');
 execFileSync(process.execPath,[bundle,'generate'],{cwd:mirror,stdio:'inherit'});
 execFileSync(process.execPath,[bundle,'check','--all'],{cwd:mirror,stdio:'inherit'});
 execFileSync('git',['add','.'],{cwd:mirror});
 execFileSync(process.execPath,[bundle,'check','--staged'],{cwd:mirror,stdio:'inherit'});
 for(const f of ['index.md','files.md'])await fs.copyFile(path.join(mirror,'docs',f),path.join(root,'v2/docs',f));
 const headings=['Mục đích','Điểm vào','Các bước','Files','Dữ liệu','Flow liên quan','Tests'];
 for(const id of Object.keys(manifest.flows)){
  const txt=await fs.readFile(path.join(mirror,manifest.flows[id].doc),'utf8');
  const actual=[...txt.matchAll(/^## (.+)$/gm)].map(x=>x[1]);
  if(JSON.stringify(actual)!==JSON.stringify(headings))throw Error(`Heading order invalid ${id}: ${actual}`);
 }
}finally{await fs.rm(mirror,{recursive:true,force:true});}
