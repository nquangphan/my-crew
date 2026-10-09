/** Đường chở file chọn theo kết quả đo bridge stock trên prod: bridge đạt (mọi lần < 25 giây, sha256 khớp). */
export const ATTACHMENT_TRANSPORT: 'bridge' | 'ssh' = 'bridge';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_RUN = 40;
export const MAX_PDF_PAGES = 200;
export const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const RELIST_IF_ISSUE_YOUNGER_MS = 2 * 60 * 1000;
export const RELIST_DELAY_MS = 15_000;
export const SMALL_FILE_BYTES = 256 * 1024;
export const WORKER_TIMEOUT_MS = 60_000;
export const WORKER_MAX_OLD_SPACE_MB = 512;
export const INLINE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const INLINE_IMAGE_MAX_EDGE = 8000;
export const RESIZE_EDGE = 4096;
export const PDF_PAGES_PER_READ = 20;

/** Blob dở dang (`.part`) cũ hơn mốc này bị GC xóa. */
export const PART_MAX_AGE_MS = 60 * 60 * 1000;
/** Blob chỉ được run cũ hơn mốc này tham chiếu mới bị LRU xóa khi cache vượt trần. */
export const RUN_PROTECT_MS = 24 * 60 * 60 * 1000;
/** `gc.lock` cũ hơn mốc này coi như chết. */
export const GC_LOCK_STALE_MS = 10 * 60 * 1000;
/** Log xoay vòng khi lớn hơn mốc này. */
export const LOG_MAX_BYTES = 5 * 1024 * 1024;
