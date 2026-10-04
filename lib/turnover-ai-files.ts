// Which files Turnover AI can read, and how big they may be — ONE copy for
// the browser (the Projects list drop zone, a project's own upload loop) and
// the server (app/api/turnover-ai/extract/route.ts), so the two can't drift.
// Vincent, 2026-10-05: "超过约 4.5MB 的文件会被挡、HEIC 照片读不了…这个现在处理".
//
// - Vercel rejects a function request body over ~4.5MB with a non-JSON 413
//   before the route runs (nothing recorded, the old 15MB check never ran),
//   so 4.4MB is the real ceiling for one upload, multipart overhead included.
// - Claude reads JPEG/PNG/GIF/WebP images and PDFs — not HEIC. HEIC photos are
//   converted to JPEG in the browser first (components/turnover-ai/
//   prepare-upload.ts); the server never forwards HEIC.
// - Windows browsers often give a .heic file an empty type, so the extension
//   counts too; the server decides from the file's own first bytes.
//
// Pure (no DOM, no Node APIs): safe to import from client and server code.

export type FileKind = 'pdf' | 'jpeg' | 'png' | 'webp' | 'heic';

export const UPLOAD_MAX_BYTES = 4_400_000;
// Claude's own working size for an image's longest edge: a converted photo
// loses nothing it would have read.
export const IMAGE_MAX_EDGE = 2576;

export const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

const KIND_BY_TYPE: Record<string, FileKind> = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heic',
};
const KIND_BY_EXTENSION: Record<string, FileKind> = {
  pdf: 'pdf', jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', heic: 'heic', heif: 'heic',
};

/** What a file claims to be, from its type or else its extension; null when it isn't readable at all. */
export function kindOf(file: { name: string; type: string }): FileKind | null {
  return KIND_BY_TYPE[file.type] ?? KIND_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

export const isReadableFile = (file: { name: string; type: string }) => kindOf(file) !== null;

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

/** What the bytes actually are (the server trusts this, never the browser's type). */
export function sniffKind(bytes: Uint8Array): FileKind | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === '%PDF') return 'pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  if (ascii(4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(8, 12))) return 'heic';
  return null;
}

export const MEDIA_TYPE: Record<Exclude<FileKind, 'heic'>, string> = {
  pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};
export const EXTENSION: Record<Exclude<FileKind, 'heic'>, string> = { pdf: 'pdf', jpeg: 'jpg', png: 'png', webp: 'webp' };

export const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)}MB`;

// A document still 'processing' this long after upload was cut off mid-read
// (the extract route's maxDuration is 300s, and a killed function never
// reaches its own catch) — shown as interrupted, never written back.
export const READING_TIMEOUT_MS = 6 * 60 * 1000;
export type DocumentOutcome = 'done' | 'failed' | 'reading' | 'interrupted';

export function documentOutcome(status: string, uploadedAt: string, nowMs: number): DocumentOutcome {
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  return nowMs - Date.parse(uploadedAt) > READING_TIMEOUT_MS ? 'interrupted' : 'reading';
}

// A file that couldn't be read — failed, or cut off mid-read: nothing from it
// is in the total. Listed on the project page, counted apart on the Projects
// card, and the only kind of file staff can remove from a project (Vincent,
// 2026-10-05: "加移除按钮" — once it's been dropped again, its old line
// needn't wait for the 3-day cleanup). Never a file still being read.
export const isUnread = (outcome: DocumentOutcome) => outcome === 'failed' || outcome === 'interrupted';

export function pdfTooLargeMessage(bytes: number): string {
  return `This PDF is ${megabytes(bytes)} — uploads are limited to ${megabytes(UPLOAD_MAX_BYTES)}. Split it into smaller files, or save a smaller copy (e.g. print it to PDF), then drop those.`;
}
