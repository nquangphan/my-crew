#!/usr/bin/env node
// Review artifact only. --plan is pure/static; --run requires an exact external PM approval.
// Uses existing37 cases and existing5 diagnostics. No new allocation/security/wall payloads.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, statfs } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { crc32, inflateSync } from 'node:zlib';

const IMAGE = 'sha256:8f2eec2f52fd3ed6c2c42215cad5ce81bee8989a9db3c8bd97f689aed998988a';
const SOURCE = '5d40c2d9ce6c1137d1dc476988f28b981ee8ea027c6fc8ad6795a9f01c7764f5';
const RUNNER = '7c28d38d321cb8ffa51d53b46b690cf5e22c7777abfd9e9052678d6f5faeca1e';
const GATES = { allocation: 'UNVERIFIED_OMITTED', parserWall: 'UNVERIFIED_OMITTED' };
const runFile = promisify(execFile);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function exclusive(path, bytes, mode = 0o600) {
  const fd = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
  const dir = await open(resolve(path, '..'), constants.O_RDONLY);
  try { await dir.sync(); } finally { await dir.close(); }
}
export async function assertOwnedComponents(root, target, io = {lstat,realpath}, uid = process.getuid?.()) {
  assert.ok(isAbsolute(root) && isAbsolute(target));
  const rel=relative(root,target); assert.ok(rel==='' || (!rel.startsWith(`..${sep}`) && rel!=='..' && !isAbsolute(rel)), 'OWNED_PATH_ESCAPE');
  const st=await io.lstat(root); assert.ok(st.isDirectory() && !st.isSymbolicLink(), 'OWNED_ROOT_TYPE'); assert.equal(st.uid,uid,'OWNED_UID'); assert.equal(st.mode&0o777,0o700,'OWNED_ROOT_MODE');
  assert.equal(await io.realpath(root),root,'OWNED_ROOT_CANONICAL');
  let current=root;
  const components=rel ? rel.split(sep) : [];
  for (let i=0; i<components.length; i++) {
    current=join(current,components[i]); const info=await io.lstat(current);
    assert.ok(!info.isSymbolicLink(),'OWNED_SYMLINK_COMPONENT'); assert.equal(info.uid,uid,'OWNED_COMPONENT_UID');
    if (i<components.length-1 || info.isDirectory()) { assert.ok(info.isDirectory(),'OWNED_DIRECTORY_TYPE'); assert.equal(info.mode&0o777,0o700,'OWNED_DIRECTORY_MODE'); }
    else { assert.ok(info.isFile(),'OWNED_REGULAR_FILE'); assert.ok([0o600,0o444,0o400].includes(info.mode&0o777),'OWNED_FILE_MODE'); }
    assert.equal(await io.realpath(current),current,'OWNED_PATH_CANONICAL');
  }
  return components.length ? await io.lstat(target) : st;
}
async function readOwned(root,path) {
  const before=await assertOwnedComponents(root,path); assert.ok(before.isFile(),'OWNED_READ_REGULAR');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try { const actual=await fd.stat(); assert.ok(actual.isFile()); assert.equal(actual.dev,before.dev); assert.equal(actual.ino,before.ino); assert.equal(actual.uid,process.getuid?.()); assert.equal(actual.mode,before.mode,'OWNED_FD_MODE_CHANGED'); return await fd.readFile(); }
  finally { await fd.close(); }
}
const json = async (root,path) => JSON.parse((await readOwned(root,path)).toString('utf8'));
async function readExternalRegular(path) {
  assert.ok(isAbsolute(path)); let current=sep;
  for (const component of path.split(sep).filter(Boolean)) { current=join(current,component); const st=await lstat(current); assert.ok(!st.isSymbolicLink(),'EXTERNAL_SYMLINK_COMPONENT'); }
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try { const st=await fd.stat(); assert.ok(st.isFile() && st.uid===process.getuid?.() && !(st.mode&0o022),'EXTERNAL_RECEIPT_MODE_UID'); return await fd.readFile(); } finally { await fd.close(); }
}
const unit = (locator, needs = 'text', state = 'available', reason = null, body = null) => ({ locator, needs, state, reason, body });
const doc = { kind: 'docx', part: 'word/document.xml', paragraph: 1, table: null, row: null, cell: null };
const sheet = (name, hidden, range, part) => ({ kind: 'sheet', part, sheet: name, range, hidden });
const hSheet = sheet('Hiện', false, 'A1:B1', 'xl/worksheets/sheet1.xml');
const vSheet = sheet('Ẩn', true, 'A1:A1', 'xl/worksheets/sheet2.xml');
const pdf = (page, rotation = 0, box = [0, 0, 1, 1]) => ({ kind: 'pdf', page, box, rotation });
// Helvetica AFM widths, supplied by the independently authored ReportLab recipe.
const pdfTextWidth = [722,333,556,722,278,278,222,500,278,556,333,556,278,278,556,500,278].reduce((a,b) => a+b, 0) * 12 / 1000;
const pdfText = rotation => unit(pdf(1, rotation, [10, 100, pdfTextWidth, 12]), 'text', 'available', null,
  { type: 'pdf-json', text: 'Crew fixture text', transform: [12, 0, 0, 12, 10, 100], width: pdfTextWidth, height: 12 });
const pdfVision = (page, rotation = 0, raster = 'text') => unit(pdf(page, rotation), 'vision', 'available', null, { type: 'png', width: 288, height: 288, raster: {kind:raster,rotation} });
const fail = (status, code) => ({ status, problemCodes: [code], units: [] });
const good = units => ({ status: 'complete', problemCodes: [], units });
const cell = (ref, type, formula, value, inline = '') => ({ ref, type, style: '0', formula, formulaAttrs: {}, value, inline, sharedFormulaSource: null, raw: value, cached: formula !== null ? value : null });
const xlsxBody = (name, hidden, cells) => ({ type: 'xlsx-json', value: { sheet: name, hidden, cells, merged: [], styles: [] } });
// These are authored expectations. No expected output is copied from the selected parser/result.
export const GOLDENS = Object.freeze({
  'zip-zero-compressed': fail('failed', 'LIMIT_EXCEEDED'),
  'zip-invalid-crc': fail('corrupt', 'CORRUPT_DOCUMENT'),
  'zip-2001-entries': fail('failed', 'LIMIT_EXCEEDED'),
  'xml-depth-limit': fail('failed', 'LIMIT_EXCEEDED'),
  'embedded-ole-docx': fail('blocked', 'ACTIVE_CONTENT_BLOCKED'),
  'launch-escaped-pdf': fail('blocked', 'ACTIVE_CONTENT_BLOCKED'),
  'launch-incremental-pdf': fail('blocked', 'ACTIVE_CONTENT_BLOCKED'),
  'launch-compressed-pdf': fail('blocked', 'ACTIVE_CONTENT_BLOCKED'),
  'launch-pdf': fail('blocked', 'ACTIVE_CONTENT_BLOCKED'),
  'javascript-pdf': fail('blocked', 'ACTIVE_CONTENT_BLOCKED'),
  'executable-pdf': fail('blocked', 'ACTIVE_CONTENT_BLOCKED'),
  'portfolio-pdf': { status: 'partial', problemCodes: ['UNSUPPORTED_VISUAL'], units: [unit(pdf(1, 0, [0, 0, 0, 0]), 'vision', 'missing', 'UNSUPPORTED_VISUAL'), pdfVision(1), pdfText(0)] },
  'rotated-pdf': good([pdfVision(1, 90), pdfText(90)]),
  'exif6-jpeg': good([unit({ kind: 'image', width: 2, height: 3, box: [0, 0, 1, 1], transform: { originalWidth: 3, originalHeight: 2, orientation: 6, normalizedWidth: 2, normalizedHeight: 3, rotation: 90, reflected: false } }, 'vision', 'available', null, { type: 'png', width: 2, height: 3, solid: [254, 0, 0], tolerance: 2 })]),
  'truncated-png': fail('corrupt', 'CORRUPT_DOCUMENT'),
  'huge-png': fail('blocked', 'ACTIVE_CONTENT_BLOCKED'),
  'malformed-csv': fail('corrupt', 'CORRUPT_DOCUMENT'),
  'utf16le-text': good([unit({ kind: 'text', byteStart: 0, byteEnd: 20, lineStart: 1, lineEnd: 2 }, 'text', 'available', null, { type: 'literal', value: 'Việt Nam\n' })]),
  'binary-text': fail('unsupported', 'UNSUPPORTED_TYPE'),
  'zip-traversal': fail('corrupt', 'CORRUPT_DOCUMENT'),
  'zip-case-collision': fail('corrupt', 'CORRUPT_DOCUMENT'),
  'zip-encrypted': fail('blocked', 'ACTIVE_CONTENT_BLOCKED'),
  'zip-symlink': fail('corrupt', 'CORRUPT_DOCUMENT'),
  'xml-dtd': fail('blocked', 'ACTIVE_CONTENT_BLOCKED'),
  'docx-unsupported-drawing': { status: 'partial', problemCodes: ['UNSUPPORTED_VISUAL'], units: [unit({ ...doc, component: { kind: 'unsupported-visual', index: 1 } }, 'vision', 'missing', 'UNSUPPORTED_VISUAL'), unit(doc, 'text', 'available', null, { type: 'literal', value: '' })] },
  'vietnamese-docx': good([unit(doc, 'text', 'available', null, { type: 'literal', value: 'Xin chào Việt Nam' })]),
  'hidden-xlsx': good([unit(hSheet, 'text', 'available', null, xlsxBody('Hiện', false, [cell('A1', 'inlineStr', null, null, 'Việt Nam'), cell('B1', 'n', '1+1', '2')])), unit(vSheet, 'text', 'available', null, xlsxBody('Ẩn', true, [cell('A1', 'n', null, '7')]))]),
  'scan-pdf': good([pdfVision(1,0,'scan')]),
  'text-pdf': good([pdfVision(1), pdfText(0)]),
  'mixed-pdf': good([pdfVision(1), pdfText(0), pdfVision(2,0,'scan')]),
  'encrypted-pdf': fail('encrypted', 'PASSWORD_REQUIRED'),
  'corrupt-pdf': fail('corrupt', 'CORRUPT_DOCUMENT'),
  'png': good([unit({ kind: 'image', width: 3, height: 2, box: [0, 0, 1, 1] }, 'vision', 'available', null, { type: 'png', width: 3, height: 2, solid: [0, 0, 0], tolerance: 0 })]),
  'code': good([unit({ kind: 'text', byteStart: 0, byteEnd: Buffer.byteLength('const secret = "literal";\n// Việt Nam\n'), lineStart: 1, lineEnd: 3 }, 'text', 'available', null, { type: 'literal', value: 'const secret = "literal";\n// Việt Nam\n' })]),
  'quoted-csv': good([unit({ kind: 'csv', rowStart: 1, rowEnd: 1, columnStart: 1, columnEnd: 2 }, 'text', 'available', null, { type: 'csv-json', value: { row: 1, cells: [{ column: 1, value: 'name' }, { column: 2, value: 'value' }] } }), unit({ kind: 'csv', rowStart: 2, rowEnd: 2, columnStart: 1, columnEnd: 2 }, 'text', 'available', null, { type: 'csv-json', value: { row: 2, cells: [{ column: 1, value: 'a\nb' }, { column: 2, value: '=1+1' }] } })]),
  'macro-docx': fail('blocked', 'ACTIVE_CONTENT_BLOCKED'),
  'formula-missing-xlsx': { status: 'partial', problemCodes: ['FORMULA_CACHE_MISSING'], units: [unit({ ...hSheet, range: 'A1:A1' }, 'text', 'available', null, xlsxBody('Hiện', false, [cell('A1', 'n', '1+1', null)])), unit({ ...hSheet, range: 'A1', component: { kind: 'calculated-value', index: 1 } }, 'text', 'missing', 'FORMULA_CACHE_MISSING'), unit(vSheet, 'text', 'available', null, xlsxBody('Ẩn', true, [cell('A1', 'n', null, '7')]))] },
});
const DIAGNOSTICS = Object.freeze([
  { name: 'boundary', wallMs: 10000, checks: ['selected-original-readable', 'private-output-writable', 'network-denied', 'foreign-host-unavailable', 'readonly-source', 'readonly-original', 'no-credential-db-workflow-env', 'no-docker-socket', 'no-host-source', 'nonroot', 'native-png-probe'], error: null },
  { name: 'pids', wallMs: 10000, checks: ['pids-limit'], error: null },
  { name: 'memory', wallMs: 20000, checks: [], error: 'WORKER_DIAGNOSTIC_INVALID', oom: true },
  { name: 'stdout-bomb', wallMs: 2000, checks: [], error: 'WORKER_OUTPUT_LIMIT' },
  { name: 'timeout', wallMs: 2000, checks: [], error: 'WORKER_TIMEOUT' },
]);
export function closeEnough(actual, expected, label) {
  if (typeof expected === 'number') assert.ok(typeof actual==='number' && Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) < 0.00001, label);
  else if (Array.isArray(expected)) { assert.equal(actual?.length, expected.length, label); expected.forEach((v,i) => closeEnough(actual[i], v, label)); }
  else if (expected && typeof expected === 'object') { assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), label); for (const key of Object.keys(expected)) closeEnough(actual[key], expected[key], label); }
  else assert.equal(actual, expected, label);
}
export function assertRasterGolden(pixel, width, height, golden) {
  assert.equal(width,288); assert.equal(height,288); assert.ok(['text','scan'].includes(golden.kind)); assert.ok([0,90].includes(golden.rotation));
  const originalPixel=(x,y)=>golden.rotation===0 ? pixel(x,y) : pixel(height-1-y,x);
  const white=rgb=>rgb.every(v=>v>=250), inside=(x,y,box)=>x>=box[0] && y>=box[1] && x<box[2] && y<box[3];
  // AFM advances at scale2: Crew ends75.992; fixture starts82.664/ends148.016; text starts154.688/ends193.376.
  let ink=0, blue=0; const words=[0,0,0], wordBoxes=[[20,68,77,90],[82,68,149,90],[154,68,195,90]];
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const rgb=originalPixel(x,y); assert.ok(Array.isArray(rgb) && rgb.length===3 && rgb.every(v=>Number.isInteger(v) && v>=0 && v<=255),'RASTER_PIXEL_TYPE');
    if (golden.kind==='scan') {
      if (inside(x,y,[24,72,216,264])) { assert.ok(rgb.every((v,i)=>Math.abs(v-[30,90,180][i])<=2),'SCAN_BLUE_INTERIOR'); blue++; }
      if (!inside(x,y,[18,66,222,270])) assert.ok(white(rgb),'SCAN_WHITE_EXTERIOR');
    } else {
      if (!inside(x,y,[18,66,197,92])) assert.ok(white(rgb),'TEXT_WHITE_EXTERIOR');
      assert.ok(Math.max(...rgb)-Math.min(...rgb)<=3,'TEXT_GRAYSCALE');
      if (rgb.every(v=>v<100)) { ink++; wordBoxes.forEach((b,i)=>{if(inside(x,y,b)) words[i]++;}); }
      if (inside(x,y,[77,66,81,92]) || inside(x,y,[150,66,153,92])) assert.ok(white(rgb),'TEXT_WORD_SPACING');
    }
  }
  if (golden.kind==='scan') assert.equal(blue,192*192);
  else { assert.ok(ink>=50,'TEXT_INK'); assert.ok(words.every(v=>v>=10),'TEXT_THREE_WORD_REGIONS'); }
}
function checkPng(bytes, expected) {
  assert.deepEqual([...bytes.subarray(0,8)], [137,80,78,71,13,10,26,10]);
  let position = 8, width, height, bpp, seenIend = false; const chunks = [];
  while (position < bytes.length) {
    const length = bytes.readUInt32BE(position), type = bytes.toString('ascii', position+4, position+8);
    assert.ok(position+12+length <= bytes.length, 'PNG chunk bounds');
    assert.equal(crc32(bytes.subarray(position+4, position+8+length)), bytes.readUInt32BE(position+8+length), 'PNG CRC');
    assert.ok(!['tEXt','zTXt','iTXt','eXIf','tIME'].includes(type), 'PNG retains untrusted metadata');
    const data = bytes.subarray(position+8, position+8+length);
    if (type === 'IHDR') { assert.equal(position, 8); width = data.readUInt32BE(0); height = data.readUInt32BE(4); assert.equal(data[8], 8); assert.ok([2,6].includes(data[9])); bpp = data[9] === 2 ? 3 : 4; assert.equal(data[12], 0); }
    if (type === 'IDAT') chunks.push(data);
    if (type === 'IEND') { assert.equal(length, 0); seenIend = true; assert.equal(position+12, bytes.length); }
    position += length+12;
  }
  assert.ok(seenIend && chunks.length); assert.equal(width, expected.width); assert.equal(height, expected.height);
  const stride = width*bpp, raw = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride+1)*height });
  assert.equal(raw.length, (stride+1)*height);
  let previous = Buffer.alloc(stride); const pixels=expected.raster ? Buffer.alloc(width*height*3) : null;
  const paeth = (a,b,c) => { const p=a+b-c, aa=Math.abs(p-a), bb=Math.abs(p-b), cc=Math.abs(p-c); return aa<=bb && aa<=cc ? a : bb<=cc ? b : c; };
  for (let y=0; y<height; y++) {
    const filter=raw[y*(stride+1)], row=Buffer.from(raw.subarray(y*(stride+1)+1, (y+1)*(stride+1))); assert.ok(filter<=4);
    for (let x=0; x<stride; x++) { const left=x>=bpp ? row[x-bpp] : 0, up=previous[x], upperLeft=x>=bpp ? previous[x-bpp] : 0; row[x]=(row[x]+[0,left,up,Math.floor((left+up)/2),paeth(left,up,upperLeft)][filter])&255; }
    for (let x=0; x<stride; x+=bpp) { const rgb=[...row.subarray(x,x+3)]; if(pixels) pixels.set(rgb,(y*width+x/bpp)*3); if (expected.solid) rgb.forEach((v,i)=>assert.ok(Math.abs(v-expected.solid[i]) <= expected.tolerance, 'PNG pixel golden')); if (bpp===4) assert.equal(row[x+3],255); }
    previous=row;
  }
  if (pixels) assertRasterGolden((x,y)=>[...pixels.subarray((y*width+x)*3,(y*width+x)*3+3)],width,height,expected.raster);
}
async function checkGolden(root, input, result, golden, directory, protocol) {
  protocol.validateWorkerResult(input, result);
  assert.equal(result.status, golden.status);
  assert.deepEqual(result.problems.map(p=>p.code).sort(), [...golden.problemCodes].sort());
  assert.equal(result.units.length, golden.units.length, 'coverage count');
  const available = result.units.filter(u=>u.state==='available');
  assert.equal(result.files.length, available.length, 'one independently checked file per available source unit');
  const expectedUnits=[...golden.units]; const used=new Set();
  const originKey = locator => { const {box, ...origin} = locator; return canonical(origin); };
  for (const actual of result.units) {
    const index=expectedUnits.findIndex((g,i)=>!used.has(i) && originKey(g.locator)===originKey(actual.locator) && g.needs===actual.needs && g.state===actual.state);
    assert.ok(index>=0, 'unexpected source locator/state'); used.add(index); const expected=expectedUnits[index];
    closeEnough(actual.locator, expected.locator, 'source coordinates'); assert.equal(actual.reason, expected.reason);
    if (actual.state==='missing') { assert.ok(result.problems.some(p=>p.code===actual.reason && p.unitIds.includes(actual.id))); continue; }
    const files=result.files.filter(f=>f.unitIds.includes(actual.id)); assert.equal(files.length, 1); const file=files[0]; assert.deepEqual(file.unitIds,[actual.id]);
    const data=await readOwned(root,join(directory,'output',file.relativeName)); assert.equal(data.length,file.byteLength); assert.equal(hash(data),file.sha256);
    const body=expected.body; assert.ok(body, 'golden missing for available source');
    if (body.type==='png') { assert.equal(file.kind,'image'); assert.equal(file.mime,'image/png'); checkPng(data,body); }
    else { assert.equal(file.kind,'text'); assert.equal(file.mime,'text/plain'); const text=new TextDecoder('utf-8',{fatal:true}).decode(data);
      if (body.type==='literal') assert.equal(text,body.value);
      else { assert.ok(text.endsWith('\n')); const records=text.trimEnd().split('\n').map(line=>JSON.parse(line)); assert.equal(records.length,1);
        if (body.type==='pdf-json') closeEnough(records[0],{text:body.text,transform:body.transform,width:body.width,height:body.height},'PDF supplementary text');
        else assert.deepEqual(records[0],body.value);
      }
    }
  }
}
async function verifyRoot(root) {
  const st=await assertOwnedComponents(root,root);
  const owner=await json(root,join(root,'owner.json'));
  assert.equal(owner.root,root); assert.equal(owner.dev,st.dev); assert.equal(owner.ino,st.ino); assert.equal(owner.uid,st.uid); assert.equal(owner.kind,'static-corpus-parent');
  const frozen=await json(root,join(root,'frozen-parent.json')); assert.deepEqual(frozen.root,owner); assert.equal(frozen.imageDigest,IMAGE); assert.equal(frozen.sourceTreeSha256,SOURCE);
  assert.equal(pathToFileURL(join(root,'harness.mjs')).href,import.meta.url,'EXECUTE_FROZEN_OWNED_HARNESS');
  assert.equal(hash(await readOwned(root,join(root,'harness.mjs'))),frozen.harnessSha256);
  for (const file of frozen.files) { const path=join(root,file.path); const bytes=await readOwned(root,path); assert.equal(bytes.length,file.bytes); assert.equal(hash(bytes),file.sha256); }
  assert.equal(hash(await readOwned(root,join(root,'v2/server/src/attachments/worker-runner.ts'))),RUNNER);
  return {owner,frozen};
}
async function makePlan(root, frozen) {
  const {loadAttachmentConfig}=await import(pathToFileURL(join(root,'v2/server/src/attachments/config.ts')));
  const {corpusCases}=await import(pathToFileURL(join(root,'v2/server/test/fixtures/attachments/make-fixtures.ts')));
  const all=corpusCases(); assert.equal(all.length,37); assert.deepEqual(all.map(c=>c.name).sort(),Object.keys(GOLDENS).sort());
  const loaded=loadAttachmentConfig({CREW_V2_ATTACHMENT_STORAGE_ROOT:root});
  const config={policySha256:loaded.policySha256,limits:{...loaded.limits}};
  await mkdir(join(root,'originals'),{mode:0o700});
  const cases=[];
  for (const entry of all) { const expected=GOLDENS[entry.name]; assert.equal(entry.status,expected.status,'fixture status vs independent expected table'); const path=`originals/${entry.name}.bin`; await exclusive(join(root,path),entry.bytes,0o444); cases.push({name:entry.name,kind:'corpus',path,mime:entry.mime,sha256:hash(entry.bytes),byteLength:entry.bytes.length,expected,jobId:randomUUID(),attachmentId:randomUUID(),generation:'1',wallMs:30000}); }
  // Match the object key order read back from the canonical on-disk plan, as required by frozen helper JSON.stringify.
  const originals=canonicalOriginals(cases);
  const challenge={version:1,imageDigest:IMAGE,sourceTreeSha256:SOURCE,corpusSha256:hash(JSON.stringify(originals)),config,originals,maxCases:37};
  const diagnostics=DIAGNOSTICS.map(c=>({...c,kind:'diagnostic',jobId:randomUUID(),attachmentId:randomUUID(),generation:'1',sha256:hash('original'),byteLength:8,mime:'text/plain'}));
  const plan={version:1,state:'STATIC_PLAN_REQUIRES_PM_REVIEW',root:frozen.root,imageDigest:IMAGE,sourceTreeSha256:SOURCE,harnessSha256:frozen.harnessSha256,parentManifestSha256:hash(await readOwned(root,join(root,'frozen-parent.json'))),config,challenge,challengeSha256:hash(canonical(challenge)),diagnostics,cases,gates:GATES,certificate:false};
  assertChallengeSerialization(plan); await exclusive(join(root,'plan.json'),canonical(plan),0o444); return plan;
}
export function assertChallengeSerialization(plan) {
  const parsed=JSON.parse(canonical(plan));
  assert.equal(parsed.challenge.corpusSha256,hash(JSON.stringify(parsed.challenge.originals)),'SERIALIZED_CORPUS_HASH');
  assert.equal(parsed.challengeSha256,hash(canonical(parsed.challenge)),'SERIALIZED_CHALLENGE_HASH');
  return parsed;
}
export function canonicalOriginals(cases) { return JSON.parse(canonical(cases.map(c=>({sha256:c.sha256,mime:c.mime})))); }
async function hostGate(root) {
  const command=async (bin,args)=>(await runFile(bin,args,{timeout:5000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin'}})).stdout;
  const pressure=Number((await command('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level'])).trim());
  const vm=await command('/usr/bin/vm_stat',[]), page=Number(/page size of (\d+) bytes/.exec(vm)?.[1]);
  const availableBytes=['free','inactive','speculative'].reduce((a,k)=>a+Number(new RegExp(`Pages ${k}:\\s+(\\d+)`).exec(vm)?.[1]),0)*page;
  const top=await command('/usr/bin/top',['-l','1','-n','0']), idlePercent=Number(/([\d.]+)% idle/.exec(top)?.[1]);
  const disk=await statfs(root), diskBytes=disk.bavail*disk.bsize;
  const measured={at:new Date().toISOString(),pressure,availableBytes,idlePercent,diskBytes,availableDefinition:'(free+inactive+speculative)*page_size'};
  measured.admitted=[1,2].includes(pressure) && availableBytes>=4*1024**3 && idlePercent>=50 && diskBytes>=8*1024**3;
  return measured;
}
async function command(binary,args) {
  const answer=await runFile(binary,args,{timeout:5000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent'}}); return answer.stdout;
}
export function classifyPs(answer, pid) {
  if (!answer || answer.killed || answer.signal || answer.code==='ETIMEDOUT' || answer.code==='ENOBUFS') return {state:'unknown'};
  if (answer.code===1 && typeof answer.stdout==='string' && answer.stdout.trim()==='' && typeof answer.stderr==='string' && answer.stderr.trim()==='') return {state:'absent',pid};
  if (answer.code!==0 || typeof answer.stdout!=='string' || (answer.stderr ?? '').trim()!=='') return {state:'unknown'};
  const match=/^([A-Z][a-z]{2} [A-Z][a-z]{2}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(.+)$/.exec(answer.stdout.trim());
  return match ? {state:'present',pid,birth:match[1],command:match[2]} : {state:'unknown'};
}
async function probePs(pid) {
  try { const answer=await runFile('/bin/ps',['-p',String(pid),'-o','lstart=,command='],{timeout:2000,maxBuffer:8192}); return classifyPs({...answer,code:0},pid); }
  catch(error) { return classifyPs({code:error.code,killed:error.killed,signal:error.signal,stdout:error.stdout,stderr:error.stderr},pid); }
}
export function assertAttachMarker(attached, owner, input, cid) {
  assert.ok(Number.isSafeInteger(attached?.pid) && attached.pid>0,'ATTACH_PID_INVALID'); assert.equal(attached.nonce,owner.nonce); assert.equal(attached.workerId,`crew-v2-extract-${input.jobId}-${input.generation}`); assert.equal(attached.containerId,cid); assert.match(cid,/^[a-f0-9]{64}$/);
}
function assertContainerMarker(saved,owner,input) { assert.equal(saved.nonce,owner.nonce); assert.equal(saved.workerId,`crew-v2-extract-${input.jobId}-${input.generation}`); assert.match(saved.id,/^[a-f0-9]{64}$/); }
export function classifyAttachClosure(probe,birth) {
  if (!birth || birth.state!=='present' || probe.pid!==birth.pid) return 'unknown';
  if (probe.state==='absent' || (probe.state==='present' && probe.birth!==birth.birth)) return 'closed';
  return probe.state==='present' && probe.birth===birth.birth && probe.command===birth.command ? 'running' : 'unknown';
}
async function observeDuring(root,binary,path,observation,settled,owner,input) {
  let seenAttach=false, seenRunning=false;
  while (!settled.done) {
    try {
      const attached=await json(root,join(path,'.attach.json')), saved=await json(root,join(path,'.container.json')); assertContainerMarker(saved,owner,input); assertAttachMarker(attached,owner,input,saved.id); observation.attach=attached;
      if (!seenAttach) { const probe=await probePs(attached.pid); observation.attachBirthProbe=probe; if(probe.state==='present' && probe.command===`${binary} start --attach ${saved.id}`) { seenAttach=true; observation.attachBirth=probe; } }
    } catch { /* Short run may close before ps: retained as unavailable, never invented. */ }
    try {
      const container=await json(root,join(path,'.container.json')); assertContainerMarker(container,owner,input); observation.container=container;
      if (!seenRunning) { const [row]=JSON.parse(await command(binary,['inspect',container.id])); assert.equal(row.Id,container.id); assert.equal(row.Image,IMAGE); assert.equal(row.Config.Labels['crew.v2.nonce'],owner.nonce); assert.equal(row.Config.Labels['crew.v2.source'],SOURCE); if (row.State.Running && Number.isSafeInteger(row.State.Pid) && row.State.Pid>0) { seenRunning=true; observation.running={id:row.Id,image:row.Image,state:row.State,cgroup:{memory:row.HostConfig.Memory,memorySwap:row.HostConfig.MemorySwap,nanoCpus:row.HostConfig.NanoCpus,pidsLimit:row.HostConfig.PidsLimit,cgroupnsMode:row.HostConfig.CgroupnsMode}}; } }
    } catch { /* No mutation/recovery from partial observations. */ }
    await pause(10);
  }
}
function exactClosed(row, owner, input) {
  assert.match(row.Id,/^[a-f0-9]{64}$/); assert.equal(row.Image,IMAGE); assert.equal(row.Name,`/crew-v2-extract-${input.jobId}-${input.generation}`);
  assert.equal(row.Config.Labels['crew.v2.nonce'],owner.nonce); assert.equal(row.Config.Labels['crew.v2.source'],SOURCE);
  assert.equal(row.State.Running,false); assert.equal(row.State.Pid,0); assert.ok(['exited','dead'].includes(row.State.Status));
  assert.equal(row.HostConfig.Memory,512*1024**2); assert.equal(row.HostConfig.MemorySwap,512*1024**2); assert.equal(row.HostConfig.NanoCpus,1e9); assert.equal(row.HostConfig.PidsLimit,32);
  assert.equal(row.HostConfig.NetworkMode,'none'); assert.equal(row.HostConfig.ReadonlyRootfs,true); assert.deepEqual(row.HostConfig.CapDrop,['ALL']); assert.ok(row.HostConfig.SecurityOpt.includes('no-new-privileges'));
  assert.equal(row.HostConfig.LogConfig.Type,'none'); assert.equal(row.Config.User,'65532:65532'); assert.equal(row.Config.WorkingDir,'/extractor');
}
async function executeCase(root, plan, entry, runner, protocol, verifier, binary, telemetry) {
  const input={version:1,jobId:entry.jobId,generation:entry.generation,original:{attachmentId:entry.attachmentId,sha256:entry.sha256,ownerId:'owner'},mime:entry.mime,inputName:'original',extractorVersion:`crew-extractor-v1+pdfjs6.3.289+canvas1.0.3+yauzl3.4.0+saxes6.0.0+pdf-lib1.17.1+${SOURCE}`,config:plan.config};
  const directory=await runner.prepareWorkerDirectory(root,input), owner=await json(root,join(directory,'.owner.json'));
  const configuration={dockerBinary:binary,imageDigest:IMAGE,sourceTreeSha256:SOURCE,storageRoot:root,wallMs:entry.wallMs};
  const original=entry.kind==='diagnostic' ? Buffer.from('original') : await readOwned(root,join(root,entry.path)); assert.equal(hash(original),entry.sha256); assert.equal(original.length,entry.byteLength);
  await exclusive(join(directory,'input','original'),original,0o444); await exclusive(join(directory,'input','request.json'),JSON.stringify(input),0o444);
  if (entry.kind==='diagnostic') await exclusive(join(directory,'input','canary.json'),JSON.stringify({scenario:entry.name,foreignPath:join(root,'foreign-sentinel.txt')}),0o444);
  await chmod(join(directory,'input'),0o755);
  const observation={name:entry.name,kind:entry.kind,jobId:entry.jobId,generation:entry.generation,originalSha256:entry.sha256,originalByteLength:entry.byteLength,owner,imageDigest:IMAGE,sourceTreeSha256:SOURCE,telemetry,wallMs:entry.wallMs,root:plan.root,startedAt:new Date().toISOString(),cleanup:'UNKNOWN_RETAINED',certificate:false};
  await exclusive(join(directory,'.harness-intent.json'),canonical(observation));
  const settled={done:false}; const observer=observeDuring(root,binary,directory,observation,settled,owner,input); let result, error;
  try { result=entry.kind==='diagnostic' ? await runner.runExtractorDiagnostic(configuration,directory) : await verifier.verify(input,directory); }
  catch (caught) { error=caught.code || caught.message || 'UNKNOWN'; }
  finally {
    // No golden/outcome assertion precedes helper settlement, actual closure and exact cleanup.
    settled.done=true; await observer;
    try {
      const saved=await json(root,join(directory,'.container.json')), [closed]=JSON.parse(await command(binary,['inspect',saved.id]));
      assertContainerMarker(saved,owner,input); exactClosed(closed,owner,input); assert.equal(saved.id,closed.Id); observation.closed={id:closed.Id,image:closed.Image,state:closed.State,hostConfig:closed.HostConfig};
      observation.attach=await json(root,join(directory,'.attach.json')); assertAttachMarker(observation.attach,owner,input,saved.id);
      observation.attachClosureProbe=await probePs(observation.attach.pid);
      observation.attachClosure=classifyAttachClosure(observation.attachClosureProbe,observation.attachBirth);
      observation.attachClosed=observation.attachClosure==='closed';
      assert.ok(observation.attachClosed,'ATTACH_CLOSURE_UNKNOWN_RETAINED');
      assert.ok(observation.running?.state?.Pid>0,'RUNNING_WITNESS_UNVERIFIED_RETAINED');
      observation.cleanup=await runner.removeStoppedWorkerContainer(configuration,`crew-v2-extract-${input.jobId}-${input.generation}`);
      assert.equal(observation.cleanup,'removed');
    } catch (closureError) { observation.closureError=closureError.code || closureError.message; }
    observation.result=result ?? null; observation.error=error ?? null; observation.finishedAt=new Date().toISOString();
    await exclusive(join(directory,'.harness-observation.json'),canonical(observation));
  }
  assert.equal(observation.cleanup,'removed','UNKNOWN: retained, halt all remaining cases');
  assert.ok(observation.attachBirth,'attach birth unavailable: retain measurement, independent review required');
  assert.ok(observation.running?.state?.Pid>0,'running worker PID/cgroup unavailable: retain measurement, independent review required');
  if (entry.kind==='diagnostic') {
    assert.equal(error ?? null,entry.error);
    assert.equal(observation.closed.state.OOMKilled,entry.oom ?? false);
    if (result) { assert.equal(observation.closed.state.ExitCode,0); assert.deepEqual(result.checks.map(c=>c.name).sort(),[...entry.checks].sort()); assert.ok(result.checks.every(c=>c.status==='pass')); assert.equal(result.imageDigest,IMAGE); assert.equal(result.sourceTreeSha256,SOURCE); }
  } else { assert.equal(error,undefined); assert.equal(observation.closed.state.OOMKilled,false); assert.equal(observation.closed.state.ExitCode,0); await checkGolden(root,input,result,entry.expected,directory,protocol); }
  return {name:entry.name,kind:entry.kind,observationPath:join(directory,'.harness-observation.json'),observationSha256:hash(await readOwned(root,join(directory,'.harness-observation.json'))),goldenMatched:true,certificate:false};
}
async function main() {
  const [mode, rawRoot, approvalPath]=process.argv.slice(2);
  if (!['--plan','--run'].includes(mode) || !rawRoot) { console.log('STATIC REVIEW ARTIFACT. Usage: node --max-old-space-size=384 harness.mjs --plan <owned-root>; --run <owned-root> <exact-PM-approval.json>. Allocation/parser-wall gates remain UNVERIFIED.'); return; }
  assert.ok(Number(process.versions.node.split('.')[0])>=24,'Node24 required');
  const root=resolve(rawRoot), {owner,frozen}=await verifyRoot(root);
  if (mode==='--plan') { const plan=await makePlan(root,frozen); console.log(JSON.stringify({state:plan.state,planSha256:hash(await readOwned(root,join(root,'plan.json'))),root:owner,corpusCases:37,diagnostics:5,gates:GATES,certificate:false})); return; }
  assert.ok(approvalPath,'external PM approval required'); const approvalBytes=await readExternalRegular(resolve(approvalPath)), approval=JSON.parse(approvalBytes);
  const planBytes=await readOwned(root,join(root,'plan.json')), plan=JSON.parse(planBytes); assertChallengeSerialization(plan); assert.equal(approval.planSha256,hash(planBytes)); assert.equal(approval.harnessSha256,frozen.harnessSha256); assert.equal(approval.rootNonce,owner.nonce); assert.equal(approval.imageDigest,IMAGE); assert.equal(approval.sourceTreeSha256,SOURCE); assert.equal(approval.launchApproved,true); assert.equal(approval.soleHeavy,true); assert.match(approval.independentReviewSha256,/^[a-f0-9]{64}$/);
  const checkApproval=()=>assert.ok(Date.now()<Date.parse(approval.expiresAt),'PM approval expired; no renewal/fallback/replay'); checkApproval();
  assert.equal(hash(await readOwned(root,join(root,'frozen-parent.json'))),plan.parentManifestSha256); assert.deepEqual(plan.root,owner); assert.equal(hash(canonical(plan.challenge)),plan.challengeSha256);
  assert.equal(plan.cases.length,37); assert.equal(plan.diagnostics.length,5); assert.equal(plan.challenge.maxCases,37);
  for (const entry of plan.cases) assert.deepEqual(entry.expected,GOLDENS[entry.name]); assert.deepEqual(plan.diagnostics.map(({jobId,attachmentId,generation,sha256,byteLength,mime,kind,...entry})=>entry),DIAGNOSTICS);
  // Imported only from immutable owned parent; no node_modules or external parent dependencies.
  const runner=await import(pathToFileURL(join(root,'v2/server/src/attachments/worker-runner.ts'))), protocol=await import(pathToFileURL(join(root,'v2/server/src/attachments/worker-protocol.ts')));
  const binary=await realpath('/usr/local/bin/docker'); const binarySha256=hash(await readFile(binary));
  const verifier=runner.createExtractorCorpusVerifier({dockerBinary:binary,imageDigest:IMAGE,sourceTreeSha256:SOURCE,storageRoot:root,wallMs:30000},plan.challenge);
  await exclusive(join(root,'foreign-sentinel.txt'),'host-only-existing-diagnostic-sentinel',0o600);
  await exclusive(join(root,'launch-intent.json'),canonical({approvalSha256:hash(approvalBytes),planSha256:hash(planBytes),parentPid:process.pid,parentArgv:process.argv,parentHeapMiB:384,parentRssHardCap:false,binary,binarySha256,root:owner,gates:GATES,certificate:false}));
  const observations=[], attempted=[]; let failure=null;
  try {
    for (const entry of [...plan.diagnostics,...plan.cases]) {
      checkApproval(); await verifyRoot(root); assert.equal(hash(await readFile(binary)),binarySha256);
      const telemetry=await hostGate(root); await exclusive(join(root,`admission-${entry.jobId}.json`),canonical(telemetry));
      assert.ok(telemetry.admitted,'HOST_GATE_DENIED: no create; pending cases retained; no unconditional run');
      attempted.push({name:entry.name,kind:entry.kind,jobId:entry.jobId,generation:entry.generation,observationPath:join(root,'jobs',entry.jobId,entry.generation,'.harness-observation.json')});
      observations.push(await executeCase(root,plan,entry,runner,protocol,verifier,binary,telemetry));
      await verifyRoot(root);
    }
  } catch (error) { failure=error.code || error.message; }
  const summary={state:failure ? 'HALTED_REVIEW_REQUIRED' : 'OBSERVATIONS_READY_FOR_INDEPENDENT_REVIEW',root:owner,attempted,observations,pendingCases:42-attempted.length,failure,gates:GATES,certificate:false,productionPermitCreated:false};
  await exclusive(join(root,'summary.json'),canonical(summary)); console.log(JSON.stringify(summary)); if (failure) process.exitCode=1;
}
// Importing GOLDENS for a static reviewer never starts the harness.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) await main();
