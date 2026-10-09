import { blockLabel, extensionOf } from './sniff.js';
import type { BlockLabel, DetectedKind, ReasonCode } from './types.js';

// Bảng kiểu dùng chung với plugin crew.core (bản chép ở packages/crew-plugin/src/attachments/rules.ts của fork).
// Đổi một bên thì đổi cả bên kia; test hai bên so nguyên chuỗi.
export const ALLOWED_EXTENSIONS: readonly string[] = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'heic',
  'heif',
  'pdf',
  'docx',
  'xlsx',
  'csv',
  'txt',
  'md',
  'json',
  'yaml',
  'yml',
  'log',
  'html',
  'htm',
  'xml',
  'svg',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'sh',
  'css',
  'sql',
];
export const SNIFF_CHECKED: readonly string[] = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'heic',
  'heif',
  'pdf',
  'docx',
  'xlsx',
];
export const MACRO_EXTENSIONS: readonly string[] = ['docm', 'xlsm', 'pptm', 'dotm', 'xltm'];

/** Nhãn theo đuôi cho file có đuôi ngoài danh sách cho phép (cùng cách gọi tên với plugin). */
const EXTENSION_LABELS: Record<Exclude<BlockLabel, 'khac'>, readonly string[]> = {
  zip: ['zip', '7z', 'rar', 'gz', 'tgz', 'tar', 'bz2', 'xz'],
  exe: ['exe', 'msi', 'dmg', 'pkg', 'app', 'bat', 'cmd', 'com', 'scr', 'dll', 'dylib', 'jar', 'apk'],
  docm: ['docm', 'dotm'],
  xlsm: ['xlsm', 'xltm'],
  'office-cu': ['doc', 'xls', 'ppt', 'dot', 'xlt', 'pot'],
  pptx: ['pptx', 'pptm', 'ppsx', 'potx'],
  media: ['mp3', 'mp4', 'm4a', 'm4v', 'mov', 'wav', 'avi', 'mkv', 'webm', 'aac', 'flac', 'ogg', 'aiff'],
};

function labelForExtension(ext: string): BlockLabel {
  for (const [label, exts] of Object.entries(EXTENSION_LABELS))
    if (exts.includes(ext)) return label as BlockLabel;
  return 'khac';
}

export type Decision =
  | { action: 'image' }
  | { action: 'pdf' }
  | { action: 'extract'; kind: 'text' | 'csv' | 'docx' | 'xlsx' }
  | { action: 'reject'; status: 'bi_chan' | 'ma_hoa'; reason: ReasonCode; label?: BlockLabel };

function blocked(reason: 'kieu_cam' | 'office_macro', label: BlockLabel): Decision {
  return { action: 'reject', status: 'bi_chan', reason, label };
}

/**
 * Quyết định xử lý theo kiểu nhận từ byte và đuôi tên file.
 * Thứ tự: kiểu nguy hiểm theo byte → đuôi macro → đuôi ngoài danh sách → xử lý theo byte (byte thắng đuôi).
 */
export function decide(kind: DetectedKind, filename: string): Decision {
  const ext = extensionOf(filename);
  if (kind === 'encrypted-office') return { action: 'reject', status: 'ma_hoa', reason: 'office_ma_hoa' };
  if (kind === 'macro-office') return blocked('office_macro', blockLabel(kind, filename) ?? 'docm');
  const kindLabel = blockLabel(kind, filename);
  if (kindLabel) return blocked('kieu_cam', kindLabel);
  if (MACRO_EXTENSIONS.includes(ext)) return blocked('office_macro', labelForExtension(ext));
  if (!ALLOWED_EXTENSIONS.includes(ext)) return blocked('kieu_cam', labelForExtension(ext));
  switch (kind) {
    case 'png':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'heic':
      return { action: 'image' };
    case 'pdf':
      return { action: 'pdf' };
    case 'docx':
    case 'xlsx':
    case 'csv':
      return { action: 'extract', kind };
    default:
      // text, svg (đọc như text XML)
      return { action: 'extract', kind: 'text' };
  }
}
