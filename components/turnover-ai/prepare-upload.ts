import { kindOf, UPLOAD_MAX_BYTES, IMAGE_MAX_EDGE, megabytes, pdfTooLargeMessage } from '@/lib/turnover-ai-files';

// Makes one file uploadable before it's sent (browser only, one file at a
// time — decoding many phone photos at once can run a tab out of memory):
// - a PDF over the upload limit is stopped here with a reason, never sent
//   (Vercel would reject it with an unreadable 413);
// - a HEIC photo, or any photo over the limit, becomes a JPEG at most
//   IMAGE_MAX_EDGE on its longest side — EXIF rotation applied, since
//   Claude doesn't read it. Chrome/Edge can't decode HEIC themselves, so the
//   heic-to decoder (libheif, ~3MB) is fetched only when a HEIC actually
//   arrives and the browser can't open it;
// - anything else that already fits goes up untouched.
// See lib/turnover-ai-files.ts for the limits.

export type PreparedUpload =
  | { ok: true; file: File }
  | { ok: false; reason: 'unreadable' | 'pdf_too_large' | 'image_failed'; error: string };

async function decode(file: File, heic: boolean): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    if (!heic) return null;
  }
  try {
    const { heicTo } = await import('heic-to/next');
    return await heicTo({ blob: file, type: 'bitmap', options: { imageOrientation: 'from-image' } });
  } catch {
    return null;
  }
}

function toJpeg(bitmap: ImageBitmap, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function prepareForUpload(file: File): Promise<PreparedUpload> {
  const kind = kindOf(file);
  if (!kind) return { ok: false, reason: 'unreadable', error: 'Not a PDF or photo — only PDF, JPG, PNG, WEBP or HEIC can be read.' };
  if (kind === 'pdf') {
    return file.size > UPLOAD_MAX_BYTES ? { ok: false, reason: 'pdf_too_large', error: pdfTooLargeMessage(file.size) } : { ok: true, file };
  }
  if (kind !== 'heic' && file.size <= UPLOAD_MAX_BYTES) return { ok: true, file };

  const bitmap = await decode(file, kind === 'heic');
  if (!bitmap) {
    return { ok: false, reason: 'image_failed', error: kind === 'heic' ? 'This HEIC photo could not be opened — export it as JPG and drop that instead.' : 'This photo could not be opened.' };
  }
  try {
    for (const quality of [0.9, 0.75]) {
      const blob = await toJpeg(bitmap, quality);
      if (blob && blob.size <= UPLOAD_MAX_BYTES) {
        return { ok: true, file: new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' }) };
      }
    }
    return { ok: false, reason: 'image_failed', error: `This photo is still over ${megabytes(UPLOAD_MAX_BYTES)} after shrinking it.` };
  } finally {
    bitmap.close();
  }
}
