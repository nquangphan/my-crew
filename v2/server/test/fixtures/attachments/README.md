# Corpus attachment tổng hợp

Các fixture là dữ liệu tổng hợp do Crew Task5 tạo ngày 2026-10-02; không chứa tài liệu người dùng hoặc nội dung tải từ mạng. Test đọc fixture đã lưu, không dùng mạng và không cập nhật golden tự động. `make-fixtures.ts` tạo ZIP store-method bằng header/CRC32 độc lập với production yauzl; PNG dùng zlib/CRC32. Các chuỗi macro, JavaScript, URL và executable chỉ là dữ liệu inert.

PDF tạo bằng **ReportLab 4.4.9** có sẵn trong runtime Codex, không cài thêm dependency. Tác giả nội dung: Crew Task5 generated test fixture. Nội dung chữ `Crew fixture text`; ảnh scan là ô màu RGB(30,90,180), kích thước8×8. Thư viện ReportLab do ReportLab Inc. phát hành theo BSD; xác minh từ [FAQ chính thức](https://docs.reportlab.com/developerfaqs/) và [metadata phát hành chính thức](https://pypi.org/project/reportlab/4.4.9/). API mã hóa thật `StandardEncryption` được mô tả trong [hướng dẫn chính thức](https://docs.reportlab.com/reportlab/userguide/ch4_pdffeatures/). Không tự viết thuật toán encryption hoặc PDF writer.

Recipe chạy bằng bundled Python, thư viện PIL đi kèm:

```python
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.pdfencrypt import StandardEncryption
from reportlab.lib.utils import ImageReader
from PIL import Image
from pathlib import Path
root = Path('v2/server/test/fixtures/attachments')
for mode in ('text', 'scan', 'mixed', 'encrypted'):
    c = Canvas(str(root / (mode + '.pdf')), pagesize=(144,144), invariant=1,
               pageCompression=0,
               encrypt=StandardEncryption('crew-fixture-password',
                   ownerPassword='crew-fixture-owner', strength=128)
                   if mode == 'encrypted' else None)
    c.setAuthor('Crew Task5 generated test fixture')
    c.setTitle('Synthetic attachment fixture')
    if mode in ('text', 'mixed', 'encrypted'):
        c.drawString(10,100,'Crew fixture text')
    else:
        c.drawImage(ImageReader(Image.new('RGB',(8,8),(30,90,180))),10,10,100,100)
    c.showPage()
    if mode == 'mixed':
        c.drawImage(ImageReader(Image.new('RGB',(8,8),(30,90,180))),10,10,100,100)
        c.showPage()
    c.save()
```

Hai negative PDF dùng **pypdf 6.10.0** đã có sẵn, `PdfReader(text.pdf)` → `PdfWriter.append_pages_from_reader`; `add_js('throw new Error("inert sentinel");')` tạo `javascript.pdf`; `add_attachment('inert.exe', b'fixture only')` tạo `embedded-executable.pdf`. [API và giấy phép pypdf](https://github.com/py-pdf/pypdf/blob/main/pyproject.toml). Không chạy nội dung nhúng. JPEG EXIF6 dùng PIL: `Image.new('RGB',(3,2),(255,0,0)); e=Image.Exif(); e[274]=6; image.save('orientation-6.jpg',exif=e)`.

Golden độc lập: text PDF một trang, có vision+supplementary text; scan một trang chỉ vision; mixed hai trang, trang2 chỉ vision; encrypted yêu cầu mật khẩu và không có available unit; JavaScript/executable blocked và không có derivative. PNG3×2 vision; JPEG3×2 EXIF6 thành PNG2×3, provenance giữ original3×2/rotation90. DOCX có paragraph1 `Xin chào Việt Nam`; XLSX sheet `Hiện` và veryHidden `Ẩn`, literal formula1+1/cached2; công thức không cache → partial. `complete extraction` không chứng minh model đã đọc.

## SHA-256 của corpus lưu trong repo

| File | Bytes | SHA-256 |
|---|---:|---|
| `embedded-executable.pdf` | 1216 | `52d23086fa9f1b7a4be2a46e202ef7e030ff7e86ed0f2f94f0c606ba50476239` |
| `encrypted.pdf` | 1929 | `e39ff9ad175663b2a603104c88cd80ab2f24f51a18ddc129a1a6bfc2c8bd66b8` |
| `javascript.pdf` | 1091 | `92a74737af3c07e239fa1818339834c394cb85402782e29ff241641a8f934571` |
| `launch-compressed.pdf` | 1009 | `8093cee4f0204657115a3fcfed2ee034506711e55340a49cd356988de4c2e143` |
| `launch-escaped.pdf` | 908 | `8423a553c7dbf71af76d37a1c9963c659405546ff1dd0f96f380e7d04c81e083` |
| `launch-incremental.pdf` | 1696 | `5e6506f0beb731a67419ec3ef9ac3d819b99808f606e286fb0916f9c2dd174dc` |
| `launch.pdf` | 934 | `452380707bda4ded5122b3efea542a308a0b720f75981e138dcf2140e8d628fb` |
| `mixed.pdf` | 2029 | `e967451dd350be34adcd78a5a44e3d9112b28b051b3e3b32a79fe5848e277fa3` |
| `orientation-6.jpg` | 669 | `34fbeb44f2ccaddb296d78d415af6444427f5a6206efb3941f15af5b79d76249` |
| `portfolio.pdf` | 884 | `7158cd617d7ee430792cc03490aa2d4ce3fc708ff61c6175a235f45d0501e9b5` |
| `rotated.pdf` | 867 | `2b82c523ea3cd2a1caa9fc5d91906c90eca96cf99a450f685208bfa7ce0754a9` |
| `scan.pdf` | 1645 | `e0dd29c35085b59e7305bcc8dad57fc022671d74871cd1710b738322235c8ad9` |
| `text.pdf` | 1335 | `42e7fee83fca52e8901f2b48c84cc3ff94d1f22941ca644a8fc9da738343befe` |

Launch/portfolio/rotation: pypdf append text.pdf pages; root `OpenAction` dictionary `{S:NameObject('/Launch'),F:TextStringObject('inert')}`; portfolio root `Collection: DictionaryObject()`; page `rotate(90)`. `launch-escaped.pdf` dùng NameObject('/Launchxx'), sau write thay đúng 9 bytes `/Launchxx` thành `/L#61unch`, không đổi offset/xref. `launch-incremental.pdf` dùng public `PdfWriter(text.pdf, incremental=True)` rồi thêm OpenAction; byte prefix giữ nguyên text.pdf và update thật nằm cuối. [Public incremental writer documentation](https://pypdf.readthedocs.io/en/6.7.2/modules/PdfWriter.html). Cả hai regenerate bằng nhau và independent `PdfReader(strict=True)` đọc action `/Launch`; evidence `pdf-extra-provenance.json`. Không gọi action.

`launch-compressed.pdf` dùng public **pdf-lib1.17.1** trong image Linux đã audit: load text.pdf `{updateMetadata:false}`, catalog OpenAction trỏ tới registered dictionary `{S:PDFName.of('Launch'),F:'inert'}`, save `{useObjectStreams:true,addDefaultPage:false}`. `/ObjStm` hiện diện, regeneration unit so byte-for-byte, independent pypdf strict xác nhận `/Launch`. [Source/API chính thức](https://github.com/Hopding/pdf-lib/tree/v1.17.1) (MIT; PM audit package payload). Evidence `500a02ae-d1e8-464c-b0dc-05682ac86660.json`, `pdf-compressed-provenance.json`.

CorpusCases hiện có 37 cases trả bytes/status cố định; bốn unit files còn kiểm các cap/config và malformed structural mutations riêng. Actual PM worker challenge phải đối chiếu status, original SHA, real locators, derivative digest/modality và actual closed worker; public pure corpus không tự ký PASS.
