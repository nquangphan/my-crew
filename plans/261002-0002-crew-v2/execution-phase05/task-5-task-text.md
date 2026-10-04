## Task 5: Extractors và provenance kiểm chứng được

**Files:** Task5 row. **Consumes:** WorkerInput/original chỉ đọc, four pinned packages; no model API. **Produces:** functions typed below and golden corpus generated deterministically; fixtures containing executable-looking content are inert data, generated at test runtime where possible.

```ts
export type ExtractedFile = {relativeName:string;kind:'text'|'image';mime:'text/plain'|'image/png';
  bytes:Uint8Array;unitIds:string[]};
export type ExtractResult = {status:ExtractStatus;units:CoverageUnit[];
  files:ExtractedFile[];problems:Problem[]};
export type ExtractContext = {original:AttachmentRef;mime:string;config:WorkerConfig;
  signal:AbortSignal};
export function detectFormat(bytes:Uint8Array,fileName:string,declaredMime:string):
  'png'|'jpeg'|'pdf'|'docx'|'xlsx'|'csv'|'text'|'encrypted-office'|'unsupported';
export function extractText(bytes:Uint8Array,c:ExtractContext):Promise<ExtractResult>;
export function extractCsv(bytes:Uint8Array,c:ExtractContext):Promise<ExtractResult>;
export function extractImage(bytes:Uint8Array,c:ExtractContext):Promise<ExtractResult>;
export function extractPdf(bytes:Uint8Array,c:ExtractContext):Promise<ExtractResult>;
export function extractDocx(bytes:Uint8Array,c:ExtractContext):Promise<ExtractResult>;
export function extractXlsx(bytes:Uint8Array,c:ExtractContext):Promise<ExtractResult>;
export function verifyExtraction(input:WorkerInput,result:ExtractResult):WorkerResult;
export function readOfficeParts(bytes:Uint8Array,c:ExtractContext):Promise<Map<string,Uint8Array>>;
export function parseXml(bytes:Uint8Array,onNode:(event:XmlEvent)=>void,config:WorkerConfig):void;
export type XmlEvent={kind:'open'|'close'|'text';uri:string;local:string;attributes:Readonly<Record<string,string>>;text:string};
```

`verifyExtraction` từ chối metadata >8MiB hoặc >100000 units bằng partial LIMIT_EXCEEDED có missing tail locator; group sheet/CSV units theo dải ô thay vì mỗi cell khi vượt cap. Hàm tạo digest/size manifest từ bytes, kiểm mỗi available unit có file đúng modality, mỗi file chỉ tham chiếu unit đã khai báo, không trùng locator/unit/relative name và complete không có missing unit. Hàm không chứng nhận ý nghĩa nội dung. Files yielded to runner progressively; public functions above return bounded result for unit tests, CLI drains each page/part to framed writer under total limit. `writeFrame` is worker-protocol producer with JSON header `{kind:'file-start',name,mime,bytes,sha256}`, zero or more `{kind:'file-chunk',name,base64}`, `{kind:'file-end',name}`, then `{kind:'result',body:WorkerResult}`; mỗi file-chunk/header line<=128KiB; terminal result tối đa8MiB (bounded coverage metadata), max decoded chunk64KiB, byte/digest check independent. No arbitrary JSON object is trusted as verified derivative until parent verification completes.

- [ ] **Step 1 RED:** construct corpus in `make-fixtures.ts`, no network. Export `makePdf(mode:'text'|'scan'|'mixed'|'encrypted'|'corrupt'):Uint8Array`, `makeOffice(kind:'docx'|'xlsx',parts:Record<string,string|Uint8Array>):Uint8Array`, `makePng(width,height):Uint8Array`, `extractContextFixture(mime):ExtractContext`. For PDF fixtures use committed small licensed/generated PDFs with README provenance + SHA256, don't invent PDF writer from scratch for encrypted fixture; source fixture generation recipe/author/license recorded. Office ZIP generator của fixture ghi local/central headers store-method với crc32, không dùng làm production unzip. formats.ts kiểm OLE directory có chain sector hữu hạn trong file (sector512/4096, số sector<=file size, reject cycle/out-of-range) và UTF16 directory names EncryptionInfo+EncryptedPackage trước khi gọi encrypted-office; không decrypt hoặc chạy Office, OLE không đủ chứng cứ trả unsupported. Snapshot expected text/units separately reviewed, no snapshot auto-update without review.

```ts
test('attachment scan cannot become complete text coverage',async()=>{
  const result=await extractPdf(makePdf('scan'),extractContextFixture('application/pdf'));
  assert.equal(result.status,'complete');
  assert.ok(result.units.length>0);
  assert.ok(result.units.every(u=>u.needs==='vision' && u.state==='available'));
  assert.ok(result.files.every(f=>f.kind==='image'));
  assert.ok(result.units.every(u=>u.locator.kind==='pdf' && u.locator.page>=1));
});
test('attachment csv retains multiline quoted cells without evaluating formula',async()=>{
  const bytes=Buffer.from('name,value\r\n"a\nb","=1+1"\r\n');
  const result=await extractCsv(bytes,extractContextFixture('text/csv'));
  assert.equal(result.status,'complete');
  const text=Buffer.concat(result.files.map(f=>Buffer.from(f.bytes))).toString();
  assert.match(text,/=1\+1/); assert.match(text,/a\\nb/);
  assert.ok(result.units.some(u=>u.locator.kind==='csv' && u.locator.rowStart===2));
});
```

Add explicit tests for each row in extraction table below; XML DTD refusal, declared1MiB/actual100MiB ZIP expansion, duplicate paths Unicode/backslash/case normalized collisions, encrypted ZIP, invalid CRC/offset/overlapping entries, ZIP64 uint>MAX_SAFE_INTEGER, zero division compression ratio, 2001 entries, DOCM/XLSM renamed, `vbaProject.bin`, embedded OLE/external altChunk, external relationship URL, symlink attrs, invalid path. Scanned page empty text must produce image unit, never empty text success; encrypted file returns encrypted and zero available units; truncation partial with missing page/unit vs unreadable corrupt. Check execution/network sentinel remains unchanged.
- [ ] **Step 2 RED run:** `pnpm --dir v2/server test:unit --test-name-pattern='attachment'` is not used if package script forwards flags after file globs; exact reliable command from server cwd: `node --test --test-name-pattern='attachment' test/attachments-formats.unit.test.ts test/attachments-text-csv.unit.test.ts test/attachments-pdf-image.unit.test.ts test/attachments-ooxml.unit.test.ts`. Expected missing extractors/coverage assertions RED.
- [ ] **Step 3 GREEN:** implement table as bounded parsers, not generic HTML conversion. Byte signature determines real format; ZIP needs content-types and root relationships, renamed macro/unknown ZIP rejected. Errors are structured statuses, not prose pretending read succeeded.

| Input | Implementation and provenance | Status/coverage boundary |
|---|---|---|
| text/code | fatal UTF8, BOM UTF16LE/BE; preserve original byte spans, decode line boundaries and chunks<=32KiB; output textual escaped control chars with line IDs, no execute/eval; HTML/script is literal text | invalid encoding unsupported; cap yields partial with missing tail byte range; whitespace empty file complete with explicit zero-content unit |
| CSV | RFC4180 state machine (unquoted, quoted, afterQuote), comma delimiter fixed, CRLF/LF, doubled quote, embedded newline; output JSON-lines cells as literal text with 1-based row/column; preserve Unicode/BOM | malformed quoting corrupt; row/col/field caps partial + missing unit; no formula evaluation or delimiter auto-guess; formula string kept |
| PNG/JPEG | inspect header dimensions before native loadImage(Buffer); decode+orientation normalize, export safe PNG stripping arbitrary metadata; full normalized pixel region, mapping original dimensions/rotation recorded in problem metadata when transformed | huge dimensions blocked; truncated decoder corrupt; always vision, never OCR/alt filename as replacement |
| PDF | load local Uint8Array, no URL, stopAtErrors true, enableXfa false, useWorkerFetch false, bundled font/CMap/WASM only, no viewer scripting/annotation event handler. Enumerate numPages; for each getTextContent with item transform/box and render at144DPI bounded area, respecting page rotate | page unit always vision (page render preserves layout/charts/scan); extracted text is supplementary text unit. Text-only simplification requires explicit scope decision excluding visual units; embedded JavaScript/launch action/embedded executable bị blocked ACTIVE_CONTENT_BLOCKED; XFA/portfolio/embedded tài liệu chưa hỗ trợ thành partial với missing unit, không evaluate; password encrypted; corrupt page missing with reason; page>200 tail missing |
| DOCX | strict OOXML parts/relationships via readOfficeParts + saxes; enumerate main/header/footer/footnotes/endnotes/comments; paragraphs/tables/runs in order, breaks, tracked insert/delete labels; resolve only internal relationships | locator part+paragraph/table/cell, no invented page. Embedded PNG/JPEG produce vision unit linked to paragraph; EMF/SVG/drawing/chart/SmartArt/altChunk not parsed becomes missing visual unit →partial. External hyperlinks displayed as text only, external body/image relations unavailable, no fetch. Macro/OLE executable content blocked |
| XLSX | enumerate workbook sheets including hidden and veryHidden, shared/inline strings, cell types/raw value/style number format, shared formulas, merged ranges, comments; represent cells with exact A1 coordinate + sheet/part, preserve raw and cached value separately, formula as text | never recalculate or claim cache fresh. Formula without cached value missing calculated-value unit; charts/drawings/pivots unsupported missing units →partial; hidden sheets included. Internal image PNG/JPEG vision unit, external links no fetch/partial; macros/OLE blocked |

PDF page text box uses points relative to page crop box and rotation, image box normalized [0,0,1,1], rendering metadata in locator remains stable under chunking. New config/extractor generates new extraction ID; do not overwrite old derivative/manifest to make checkpoints point at new bytes. `readOfficeParts` validates every central path before any open, limits actual output bytes on each stream, verifies CRC32 using node:zlib crc32 against entry, rejects duplicate normalized names, symlink/device entries and unsupported encryption/compression. No extraction to filesystem. XML parser `new SaxesParser({xmlns:true})`; error throws, doctype handler always rejects, count depth/text/total bytes outside parser. Events identify namespaces by URI, not prefix spelling; office URI allowlist from ECMA-376. Reject active content before extracting useful pieces; retained original status blocked visible owner.

```ts
const parser=new SaxesParser({xmlns:true});
parser.on('doctype',()=>{throw new ExtractError('ACTIVE_CONTENT_BLOCKED');});
parser.on('error',()=>{throw new ExtractError('CORRUPT_XML');});
// open/text/close handlers meter depth, text-node length and namespace+part allowlist.
// Never register a resolver, URI fetcher, JS interpreter or Office application.
parser.write(decodedXml).close();
```

`ExtractError extends Error` has readonly code:string from closed error union; wrap only recognized parser errors into corrupt/unsupported/blocked/partial; unexpected bug→failed EXTRACTOR_FAILED, not complete with empty text. Required codes: EXTRACTOR_UNAVAILABLE, EXTRACTOR_FAILED, LIMIT_EXCEEDED, ACTIVE_CONTENT_BLOCKED, UNSUPPORTED_TYPE, UNSUPPORTED_ENCODING, CORRUPT_DOCUMENT, CORRUPT_XML, PASSWORD_REQUIRED, EXTERNAL_RESOURCE_UNAVAILABLE, UNSUPPORTED_VISUAL, FORMULA_CACHE_MISSING, STALE_EXTRACTION_GENERATION, HASH_MISMATCH, DATA_LOSS. No prompt/file content in messages.
- [ ] **Step 4 GREEN run:** exact node command above + typecheck, then actual worker fixture corpus via Task4 live test on target CPU architecture. Verify at least one Vietnamese DOCX, multi-sheet XLSX, scan PDF, image, code and quoted CSV original hash matches input and every available unit links derivative bytes+locator. Set partial expectations intentionally for unsupported constructs; review does not edit goldens to erase missing coverage.
- [ ] **Step 5 docs/review/commit:** extraction flow lists supported subset/limits and semantics “complete extraction ≠ model đã đọc”. Controller commit `feat(attachments): extract document content with provenance`.

