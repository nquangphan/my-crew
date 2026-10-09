// Script JXA chạy bằng `osascript -l JavaScript -e <script> <đường dẫn PDF>`: in JSON số trang và mã hóa (PDFKit).
// Chỉ đọc cấu trúc PDF, không chạy gì nhúng trong file. Không mở được thì in {"error":"open"}.
ObjC.import('PDFKit');
// biome-ignore lint/correctness/noUnusedVariables: osascript gọi hàm run theo tên.
function run(argv) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (doc.isNil()) return JSON.stringify({ error: 'open' });
  return JSON.stringify({
    pages: Number(doc.pageCount),
    encrypted: Boolean(doc.isEncrypted) || Boolean(doc.isLocked),
  });
}
