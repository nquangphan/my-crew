# Đọc file đính kèm trên Mac (crew-mac files)

> Flow `mac-attachments`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-attachments` in ra đúng danh sách đó.

## Mục đích

Agent `claude_local` chạy trên Mac mini cần đọc ảnh, PDF, DOCX, XLSX, CSV và text mà chủ dự án đính kèm vào issue
hoặc comment Paperclip. Lệnh `crew-mac files` (sẽ có ở bước sau) tải file qua bridge của run, kiểm mã băm, lưu vào
một cache cục bộ và in danh sách kèm đường dẫn để agent `Read`. Flow này hiện có phần nền (kiểu dữ liệu, hằng số,
cache có kiểm mã băm, dọn cache, log) và phần nhận diện byte, chính sách kiểu, chuẩn bị ảnh, kiểm PDF. Các bước còn
lại (bridge, trích xuất, che credential, lệnh) bổ sung vào flow khi có.

## Cache trên Mac

Gốc `~/.crew/cache/attachments/` (thư mục 0700, file 0600), do `attachmentPaths` dựng từ HOME:

```
blobs/<sha256>                   bất biến, tên = sha256 thật của bytes
blobs/<sha256>.part.<pid>.<rand> đang ghi; GC xóa khi cũ hơn 1 giờ
derived/<sha256>/v<EXTRACTOR_VERSION>/   bản cho agent đọc (đã che), media/, info.json
derived/<sha256>/verified        dấu băm lười: mtime và cỡ của blob lúc kiểm
runs/<runId>/manifest.json       RunManifest do crew-mac ghi
runs/<runId>/server-manifest.json, pending, ready   chỉ đường đẩy bằng SSH (hiện không dùng)
incoming/<runId>/                chỉ đường đẩy bằng SSH (hiện không dùng)
gc.lock                          khóa GC
```

`blobPath`/`derivedDir` từ chối sha256 sai dạng và `runDir` từ chối runId không phải UUID, nên giá trị từ ngoài không
thoát được khỏi thư mục cache. Log của lệnh nằm ở `~/.crew/logs/attachments.log` (0600, xoay vòng khi > 5 MB, giữ
một bản `.1`); mỗi dòng chỉ có thời điểm, runId và attachmentId rút gọn 8 ký tự, sha256 rút gọn 12 ký tự, số byte,
trạng thái, mã lý do và ghi chú cố định. Không bao giờ có nội dung file, tên sheet hay text lỗi bên ngoài.

## Các bước

1. `apps/crew-mac/src/files/types.ts`: trạng thái (`FileStatus`), loại nhận diện (`DetectedKind`), mã lý do
   (`ReasonCode`), mã ghi chú (`NoteCode`), `ManifestFile`/`RunManifest`, và các bảng câu cố định `REASON_TEXT`,
   `NOTE_TEXT`, `STATUS_LABEL`. Lý do luôn in từ bảng này, không chép lỗi của server hay parser.
2. `apps/crew-mac/src/files/config.ts`: hằng số giới hạn (10 MB mỗi file, 40 file mỗi lượt, 200 trang PDF, TTL 7
   ngày, trần cache 2 GB, hạn worker 60 giây/512 MB) và `ATTACHMENT_TRANSPORT = 'bridge'`, chọn theo phép đo bridge
   stock trên prod (mọi lần tải 1, 5, 9,5 MB xong dưới 25 giây, mã băm khớp).
3. `apps/crew-mac/src/files/paths.ts`: `attachmentPaths`, `blobPath`, `derivedDir`, `runDir`.
4. `apps/crew-mac/src/files/cache.ts`:
   - `ensureCacheDirs` tạo thư mục 0700 và sửa quyền nếu lệch.
   - `storeBlob` nhận byte hoặc luồng, băm sha256 trong lúc ghi `.part` (0600, fsync), vượt trần thì dừng và xóa
     (`vuot_10mb`), lệch mã băm thì xóa (`sai_ma_bam`), đúng thì `rename` atomic. Blob dở dang không bao giờ mang tên
     sha256.
   - `hasBlob` kiểm blob tồn tại và băm khớp tên; chỉ băm lại khi mtime hoặc cỡ khác dấu `verified`; blob sai bị xóa.
   - `writeRunManifest`/`readRunManifest` ghi atomic 0600 và đọc lại (JSON hỏng hay sai version trả `null`).
5. `apps/crew-mac/src/files/gc.ts` → `runGc` (async, nhả lượt một lần sau khi giữ khóa):
   - Giữ `gc.lock` bằng `O_EXCL`; khóa của pid chết hoặc cũ hơn 10 phút bị chiếm lại; khóa sống thì trả
     `skippedLocked`.
   - Xóa `.part` cũ hơn 1 giờ, xóa run có manifest cũ hơn 7 ngày (trừ run hiện tại).
   - Lập tập tham chiếu từ `manifest.json` và `server-manifest.json` của các run còn lại, xóa blob không ai tham chiếu
     quá 7 ngày.
   - Còn vượt 2 GB thì xóa theo thứ tự: blob mồ côi cũ hơn 24 giờ (cũ nhất trước), rồi blob chỉ run cũ hơn 24 giờ
     tham chiếu (tham chiếu cũ nhất trước). Blob của run hiện tại, của run dưới 24 giờ và blob mồ côi dưới 24 giờ
     (đang tải) không bao giờ bị xóa, nên hai agent chạy song song cùng issue không xóa blob của nhau.
   - Cuối cùng xóa `derived/<sha256>` không còn blob.
6. `apps/crew-mac/src/files/log.ts` → `logLine`: ghi dòng log cố định; lỗi ghi log không làm hỏng lệnh.
7. `apps/crew-mac/src/files/sniff.ts` → `detectKind(bytes, filename, declaredType)`: nhận diện theo byte, tên và
   mime khai báo chỉ dùng để tách csv/text/svg. Cần toàn bộ nội dung file (zip đọc thư mục trung tâm ở cuối file).
   Port `detectFormat` của v2 (giữ nguyên thuật toán OLE/ZIP), thứ tự xét xem bảng chữ ký bên dưới.
   `blockLabel(kind, filename)` cho nhãn trong ngoặc của lý do.
8. `apps/crew-mac/src/files/policy.ts` → `decide(kind, filename)`: bảng `ALLOWED_EXTENSIONS`, `SNIFF_CHECKED`,
   `MACRO_EXTENSIONS` (giống hệt bản chép trong plugin `crew.core`), rồi quyết định: ảnh, PDF, trích xuất
   (text/csv/docx/xlsx) hoặc từ chối kèm trạng thái, mã lý do, nhãn.
9. `apps/crew-mac/src/files/image.ts` → `prepareImage`: đọc kích thước bằng `sips -g pixelWidth -g pixelHeight`
   (sips thoát 0 cả khi file không phải ảnh, nên thiếu số là `doi_anh_loi`). Ảnh ≤ 5 MB và cạnh ≤ 8000 px đọc thẳng
   blob. HEIC đổi sang JPEG (`sips -s format jpeg`). Ảnh quá giới hạn thu nhỏ bằng `sips -Z <min(4096, cạnh dài)>`
   ra JPEG (không phóng to ảnh nhỏ). Bản đổi ghi tạm rồi `rename` thành `derived/<sha>/v1/<sha>.jpg` (0600).
10. `apps/crew-mac/src/files/pdf.ts` → `inspectPdf`: chạy `osascript -l JavaScript -e <pdf-info.js> <blob>` (PDFKit,
    timeout 30 giây), nhận `{pages, encrypted}`; mọi đầu ra khác là `hong_cau_truc`. `pdf-info.js` đọc bằng
    `import.meta.url`, script `build` chép nó vào `dist/files/`. `pdfReadHint(pages)`: rỗng khi ≤ 10 trang, còn lại
    `pages 1-20, 21-40, …` (Claude Code `Read` nhận tối đa 20 trang mỗi lần, đo trên prod).

## Nhận diện byte và xử lý theo kiểu

`detectKind` xét theo thứ tự (byte thắng đuôi và mime khai báo):

| Thứ tự | Chữ ký | Kiểu |
|---|---|---|
| 1 | `MZ`; Mach-O `FE ED FA CE`/`FE ED FA CF`/`CE FA ED FE`/`CF FA ED FE`/`CA FE BA BE`; ELF `7F 45 4C 46` | `executable` |
| 2 | PNG `89 50 4E 47 0D 0A 1A 0A`; JPEG `FF D8 FF`; `GIF87a`/`GIF89a`; `RIFF????WEBP` | `png`/`jpeg`/`gif`/`webp` |
| 3 | byte 4–7 `ftyp`: brand `heic heix hevc hevx mif1 msf1` → `heic`, brand khác (MP4, MOV…) → `media` | `heic`/`media` |
| 4 | `%PDF-` | `pdf` |
| 5 | OLE `D0 CF 11 E0 A1 B1 1A E1`: có stream `EncryptionInfo` + `EncryptedPackage` qua chuỗi FAT hợp lệ → `encrypted-office`, còn lại → `legacy-office` (DOC/XLS/PPT cũ) | |
| 6 | `PK 03 04`: tên mục có `vbaProject`, đuôi `.bin` hoặc `macroEnabled` → `macro-office`; OOXML Word → `docx`, Excel → `xlsx`, có `ppt/presentation.xml` → `pptx`; > 2000 mục, cấu trúc hỏng hoặc không phải OOXML → `zip` | |
| 7 | gzip, 7z, rar, bzip2, xz, tar, zip rỗng | `zip` |
| 8 | ID3, khung MP3/AAC, `OggS`, `fLaC`, WAV/AVI, AIFF, Matroska/WebM | `media` |
| 9 | Text: giải mã nghiêm UTF-8/UTF-16 (BOM) như v2. Có NUL → `unknown`. Không giải mã được: có byte điều khiển → `unknown`, không có → `text` (trình đọc sẽ báo `khong_utf8`). Đuôi `.svg` và có `<svg` trong 1 KB đầu → `svg`; đuôi `.csv` hoặc mime `text/csv` → `csv`; còn lại `text` | |

`decide` theo thứ tự:

1. `encrypted-office` → `ma_hoa`/`office_ma_hoa`; `macro-office` → `bi_chan`/`office_macro` (nhãn `xlsm` với đuôi
   Excel, `pptx` với đuôi PowerPoint, còn lại `docm`).
2. Kiểu cấm theo byte → `bi_chan`/`kieu_cam`: `zip` (zip), `executable` (exe), `legacy-office` (office-cu), `pptx`
   (pptx), `media` (media), `unknown` (khac).
3. Đuôi trong `MACRO_EXTENSIONS` → `office_macro`; đuôi ngoài `ALLOWED_EXTENSIONS` (kể cả không có đuôi) → `kieu_cam`
   với nhãn theo đuôi như plugin: zip/7z/rar/gz/tar… → zip, exe/msi/dmg/pkg/app… → exe, doc/xls/ppt → office-cu,
   pptx → pptx, mp3/mp4/mov… → media, còn lại khac.
4. Còn lại xử lý theo byte: ảnh → `image`, `pdf` → `pdf`, `docx`/`xlsx`/`csv` → trích xuất cùng tên, `text`/`svg` →
   trích xuất `text`. Byte lệch đuôi mà cả hai đều được phép (ví dụ `.png` chứa JPEG) thì theo byte.

```
ALLOWED_EXTENSIONS = png jpg jpeg gif webp heic heif pdf docx xlsx csv txt md json yaml yml log html htm xml svg ts tsx js jsx mjs cjs py sh css sql
SNIFF_CHECKED      = png jpg jpeg gif webp heic heif pdf docx xlsx
MACRO_EXTENSIONS   = docm xlsm pptm dotm xltm
```

## Trạng thái và lý do (cố định)

| Trạng thái | Nhãn | Mã lý do |
|---|---|---|
| `san_sang` | sẵn sàng | không |
| `mot_phan` | một phần | không (có `NoteCode`) |
| `khong_doc_duoc` | không đọc được | `khong_utf8`, `trinh_doc_loi`, `doi_anh_loi`, `tai_loi` |
| `bi_chan` | bị chặn | `kieu_cam`, `office_macro` |
| `ma_hoa` | mã hóa | `office_ma_hoa`, `pdf_ma_hoa` |
| `qua_lon` | quá lớn | `vuot_10mb`, `vuot_40_file`, `vuot_200_trang` |
| `hong` | hỏng | `sai_ma_bam`, `hong_cau_truc` |
| `chua_dong_bo` | chưa đồng bộ | `den_sau`, `chua_len_kip` |

## Điểm cần nhớ

- Hợp đồng khi đổi: tên file trong cache, dạng `RunManifest` và bảng câu cố định là hợp đồng với các bước sau của
  flow và với hướng dẫn agent; đổi dạng thì tăng `EXTRACTOR_VERSION` để bản trích cũ không bị dùng lại.
- Test dùng HOME giả trong thư mục tạm; GC kiểm bằng file thưa nên không tốn đĩa.
- Test nhận diện dựng mọi file xấu (exe đổi đuôi, zip, Office macro, OLE mã hóa) bằng buffer trong bộ nhớ qua
  `test/fixtures/attachments/make-fixtures.ts`; không có file độc nào được commit. PDF và JPEG mẫu chép từ fixture
  v2. Test gọi `sips`/`osascript` thật chỉ chạy trên macOS (`runIf(darwin)`), phần còn lại dùng runner giả.
