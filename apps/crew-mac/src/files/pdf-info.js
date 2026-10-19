// Script JXA chạy bằng `osascript -l JavaScript -e <script> <đường dẫn PDF>`: in JSON số trang và mã hóa (PDFKit).
// `encrypted` chỉ đúng khi PDF cần mật khẩu để mở (`isLocked`). PDF chỉ có mật khẩu chủ (khóa quyền in/sửa) vẫn mở
// và `Read` được nên không tính là mã hóa.
// Chỉ đọc cấu trúc PDF, không chạy gì nhúng trong file. Không mở được thì in {"error":"open"}.
ObjC.import('PDFKit');
// biome-ignore lint/correctness/noUnusedVariables: osascript gọi hàm run theo tên.
function run(argv) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (doc.isNil()) return JSON.stringify({ error: 'open' });
  return JSON.stringify({
    pages: Number(doc.pageCount),
    encrypted: Boolean(doc.isLocked),
  });
}
