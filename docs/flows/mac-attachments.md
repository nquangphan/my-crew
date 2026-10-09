# Đọc file đính kèm trên Mac (crew-mac files)

> Flow `mac-attachments`. Danh sách file chính thức nằm trong `docs/flows.yaml`; `crew-docs flow mac-attachments` in ra đúng danh sách đó.

## Mục đích

Agent `claude_local` chạy trên Mac mini cần đọc ảnh, PDF, DOCX, XLSX, CSV và text mà chủ dự án đính kèm vào issue
hoặc comment Paperclip. Lệnh `crew-mac files` (sẽ có ở bước sau) tải file qua bridge của run, kiểm mã băm, lưu vào
một cache cục bộ và in danh sách kèm đường dẫn để agent `Read`. Flow này hiện có phần nền: kiểu dữ liệu, hằng số,
cache có kiểm mã băm, dọn cache và log. Các bước còn lại (nhận diện byte, bridge, trích xuất, che credential, lệnh)
bổ sung vào flow khi có.

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
