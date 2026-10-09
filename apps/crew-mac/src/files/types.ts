export const EXTRACTOR_VERSION = 1;

export type FileStatus =
  | 'san_sang'
  | 'mot_phan'
  | 'khong_doc_duoc'
  | 'bi_chan'
  | 'ma_hoa'
  | 'qua_lon'
  | 'hong'
  | 'chua_dong_bo';

export type DetectedKind =
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'heic'
  | 'svg'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'text'
  | 'encrypted-office'
  | 'macro-office'
  | 'legacy-office'
  | 'pptx'
  | 'zip'
  | 'executable'
  | 'media'
  | 'unknown';

export type ReasonCode =
  | 'kieu_cam'
  | 'office_macro'
  | 'office_ma_hoa'
  | 'pdf_ma_hoa'
  | 'vuot_10mb'
  | 'vuot_40_file'
  | 'vuot_200_trang'
  | 'sai_ma_bam'
  | 'hong_cau_truc'
  | 'khong_utf8'
  | 'trinh_doc_loi'
  | 'doi_anh_loi'
  | 'tai_loi'
  | 'den_sau'
  | 'chua_len_kip';

export type NoteCode =
  | 'sheet_an'
  | 'thieu_formula_cache'
  | 'vuot_gioi_han'
  | 'anh_nhung_bo_qua'
  | 'pdf_doc_theo_trang'
  | 'anh_da_thu_nho';

/** Chỉ có tên luật và số dòng, không bao giờ có giá trị khớp. */
export interface CredentialFinding {
  rule: string;
  line: number;
}

/** Bản agent đọc đã được quét credential tới đâu. Ảnh và PDF không trích chữ (không OCR) nên không quét được. */
export type CredentialScanCode = 'da_quet' | 'khong_quet_duoc' | 'anh_nhung_khong_quet';

export const CREDENTIAL_SCAN_TEXT: Record<CredentialScanCode, string> = {
  da_quet: 'đã quét và che credential trong chữ',
  khong_quet_duoc: 'không quét được credential trong ảnh/PDF',
  anh_nhung_khong_quet: 'đã quét và che credential trong chữ; không quét được credential trong ảnh nhúng',
};

export interface ManifestFile {
  attachmentId: string;
  issueId: string;
  /** Ví dụ "TPS-80". */
  issueKey: string;
  relation: 'self' | 'ancestor';
  issueCommentId: string | null;
  /** Câu nguồn theo định dạng đầu ra của lệnh. */
  source: string;
  /** Tên đã làm sạch: bỏ ký tự điều khiển, `/`, tối đa 120 ký tự. */
  filename: string;
  declaredType: string;
  detected: DetectedKind;
  byteSize: number;
  sha256: string;
  pages: number | null;
  status: FileStatus;
  reason: ReasonCode | null;
  notes: NoteCode[];
  /** Đường dẫn tuyệt đối agent `Read`. */
  readPaths: string[];
  credentialFindings: CredentialFinding[];
  /** Có khi agent có file để `Read` (`readPaths` khác rỗng): mã và câu cố định nói bản đọc đã quét credential chưa. */
  credentialScan?: { code: CredentialScanCode; text: string };
  /** Nhãn trong ngoặc của lý do `kieu_cam` và `office_macro`. */
  blockLabel?: BlockLabel;
  /** Ghi chú kèm số hoặc tên (đã làm sạch); `notes` chỉ giữ mã. Thiếu thì in câu không tham số. */
  noteDetails?: { code: NoteCode; count?: number; name?: string }[];
}

export interface RunManifest {
  version: 1;
  runId: string;
  issueId: string;
  transport: 'bridge' | 'ssh';
  /** ISO UTC. */
  generatedAt: string;
  files: ManifestFile[];
  /** Có khi listing file của issue tổ tiên bị bridge từ chối: file của issue cha không có trong `files`. */
  ancestorsUnreadable?: true;
}

/** Lý do in nguyên văn; không bao giờ chép text lỗi của server hay parser. */
export const REASON_TEXT: Record<ReasonCode, string> = {
  kieu_cam: 'kiểu file không được phép',
  office_macro: 'tài liệu Office có macro',
  office_ma_hoa: 'tài liệu Office có mật khẩu',
  pdf_ma_hoa: 'PDF có mật khẩu',
  vuot_10mb: 'file vượt 10 MB',
  vuot_40_file: 'quá 40 file trong một lượt; file này chưa được tải',
  vuot_200_trang: 'PDF hơn 200 trang',
  sai_ma_bam: 'nội dung tải về không khớp mã băm',
  hong_cau_truc: 'file hỏng, không mở được',
  khong_utf8: 'không đọc được bảng mã chữ (cần UTF-8)',
  trinh_doc_loi: 'trình đọc file dừng vì lỗi hoặc quá thời gian',
  doi_anh_loi: 'không chuyển được ảnh sang dạng đọc được',
  tai_loi: 'không tải được file từ Paperclip',
  den_sau: 'file lớn đính kèm sau khi lượt chạy bắt đầu; lượt sau sẽ đọc',
  chua_len_kip: 'file chưa tải lên xong khi lượt chạy bắt đầu',
};

/** Nhãn đi kèm `kieu_cam` và `office_macro` trong ngoặc. */
export const BLOCK_LABELS = ['zip', 'exe', 'docm', 'xlsm', 'office-cu', 'pptx', 'media', 'khac'] as const;
export type BlockLabel = (typeof BLOCK_LABELS)[number];

export const NOTE_TEXT: Record<NoteCode, (x: { count?: number; name?: string }) => string> = {
  sheet_an: (x) => `sheet "${x.name ?? ''}" bị ẩn`,
  thieu_formula_cache: (x) => `${x.count ?? 0} ô thiếu giá trị công thức`,
  vuot_gioi_han: () => 'một phần vượt giới hạn đọc, đã bỏ qua',
  anh_nhung_bo_qua: (x) => `${x.count ?? 0} ảnh nhúng không đọc được`,
  pdf_doc_theo_trang: () => 'đọc theo trang (pages), tối đa 20 trang mỗi lần',
  anh_da_thu_nho: () => 'ảnh đã được thu nhỏ để đọc',
};

export const STATUS_LABEL: Record<FileStatus, string> = {
  san_sang: 'sẵn sàng',
  mot_phan: 'một phần',
  khong_doc_duoc: 'không đọc được',
  bi_chan: 'bị chặn',
  ma_hoa: 'mã hóa',
  qua_lon: 'quá lớn',
  hong: 'hỏng',
  chua_dong_bo: 'chưa đồng bộ',
};
