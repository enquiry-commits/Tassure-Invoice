// Turnover AI upload rules (lib/turnover-ai-files.ts, docs/INVARIANTS.md
// INV-DATA-071/072). Vincent, 2026-10-05: "超过约 4.5MB 的文件会被挡、HEIC
// 照片读不了、读失败的文件在项目页看不到 — 这个现在处理".
//
// Run: npx tsx test-turnover-files.ts
import { readFileSync } from 'fs';
import { kindOf, isReadableFile, sniffKind, documentOutcome, isUnread, UPLOAD_MAX_BYTES, IMAGE_MAX_EDGE, READING_TIMEOUT_MS, ACCEPT } from './lib/turnover-ai-files';
import { prepareBatch } from './components/turnover-ai/upload-handoff';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};
const bytes = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap(p => (typeof p === 'string' ? [...p].map(c => c.charCodeAt(0)) : p)));

console.log('--- what a file claims to be (type, else extension) ---');
check('PDF by type', kindOf({ name: 'a', type: 'application/pdf' }) === 'pdf');
check('a .PDF with no type (Windows) still counts', kindOf({ name: 'SCAN.PDF', type: '' }) === 'pdf');
check('a .HEIC with no type (Windows) is a HEIC photo, not "unreadable"', kindOf({ name: 'IMG_0042.HEIC', type: '' }) === 'heic');
check('image/heif counts as HEIC', kindOf({ name: 'x', type: 'image/heif' }) === 'heic');
check('.jpeg and .jpg are JPEG', kindOf({ name: 'a.jpeg', type: '' }) === 'jpeg' && kindOf({ name: 'b.JPG', type: '' }) === 'jpeg');
check('a Word file is not readable', !isReadableFile({ name: 'minutes.docx', type: 'application/msword' }));
check('a folder (no type, no extension) is not readable', !isReadableFile({ name: 'Receipts', type: '' }));
check('the picker lists .heic/.heif so Windows shows them', ACCEPT.includes('.heic') && ACCEPT.includes('.heif'));

console.log('\n--- what the bytes are (the server trusts only this) ---');
check('%PDF → pdf', sniffKind(bytes('%PDF-1.7')) === 'pdf');
check('FF D8 FF → jpeg', sniffKind(bytes([0xff, 0xd8, 0xff, 0xe0])) === 'jpeg');
check('PNG signature → png', sniffKind(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a])) === 'png');
check('RIFF....WEBP → webp', sniffKind(bytes('RIFF', [0, 0, 0, 0], 'WEBP')) === 'webp');
check('ftyp heic → heic', sniffKind(bytes([0, 0, 0, 24], 'ftypheic')) === 'heic');
check('ftyp mif1 (iPhone HEIF) → heic', sniffKind(bytes([0, 0, 0, 24], 'ftypmif1')) === 'heic');
check('ftyp mp42 (a video) is not a photo', sniffKind(bytes([0, 0, 0, 24], 'ftypmp42')) === null);
check('a renamed .exe is nothing', sniffKind(bytes('MZ', [0x90, 0])) === null);
check('too-short input is nothing, never a crash', sniffKind(new Uint8Array([0x25])) === null);

console.log('\n--- the size limit is Vercel’s, not the old 15MB ---');
check('one upload stays under Vercel’s ~4.5MB request body, with room for the multipart envelope', UPLOAD_MAX_BYTES < 4_500_000 && UPLOAD_MAX_BYTES >= 4_000_000, String(UPLOAD_MAX_BYTES));
check('converted photos use Claude’s own working edge (2576px)', IMAGE_MAX_EDGE === 2576);

console.log('\n--- a dropped batch on the Projects list ---');
const pdf = (name: string, size: number) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });
const batch = prepareBatch([
  pdf('big-scan.pdf', 5_200_000), pdf('ok.pdf', 1000),
  new File(['x'], 'IMG_0042.HEIC', { type: '' }), new File(['x'], 'notes.docx', { type: 'application/msword' }),
  new File([new Uint8Array(8_000_000)], 'camera.jpg', { type: 'image/jpeg' }),
]);
check('a PDF over the limit is set aside up front, not sent', batch.tooLarge.map(f => f.name).join() === 'big-scan.pdf');
check('a HEIC with no type and an 8MB photo go in (they are converted on the way)', ['IMG_0042.HEIC', 'camera.jpg', 'ok.pdf'].every(n => batch.batch.some(f => f.name === n)) && batch.batch.length === 3, batch.batch.map(f => f.name).join());
check('the Word file is skipped', batch.rejected.map(f => f.name).join() === 'notes.docx');
const many = prepareBatch(Array.from({ length: 105 }, (_, i) => pdf(`scan-${i + 1}.pdf`, 10)));
check('105 files → the first 100 by name now, 5 later', many.batch.length === 100 && many.deferred.length === 5 && many.batch[99].name === 'scan-100.pdf');

console.log('\n--- what staff see for each file ---');
const t0 = Date.parse('2026-10-05T03:00:00Z');
check('done and failed are what they say', documentOutcome('done', '2026-10-05T03:00:00Z', t0) === 'done' && documentOutcome('failed', '2026-10-05T03:00:00Z', t0) === 'failed');
check('still processing within the time limit → reading', documentOutcome('processing', '2026-10-05T03:00:00Z', t0 + 60_000) === 'reading');
check('processing past the route’s 300s limit → interrupted (display only)', documentOutcome('processing', '2026-10-05T03:00:00Z', t0 + READING_TIMEOUT_MS + 1) === 'interrupted' && READING_TIMEOUT_MS > 300_000);
check('failed and interrupted files are the unread ones (listed, counted apart, removable)', isUnread('failed') && isUnread('interrupted'));
check('a file still being read, or read fine, is never unread — so never removable', !isUnread('reading') && !isUnread('done'));

console.log('\n--- source guards ---');
const read = (p: string) => readFileSync(p, 'utf8');
const route = read('app/api/turnover-ai/extract/route.ts');
check('extract writes client_name (NOT NULL in production — INV-DATA-071)', /client_name: project\.name/.test(route));
check('extract decides the type from the bytes and uses the shared limit', /sniffKind\(/.test(route) && /UPLOAD_MAX_BYTES/.test(route) && !/15 \* 1024 \* 1024/.test(route));
check('extract never forwards HEIC to Claude', /kind === 'heic'/.test(route));
check('the stored original gets an ASCII-only key', /\/original\.\$\{EXTENSION\[kind\]\}/.test(route));
check('extract may run 300s', /maxDuration = 300/.test(route));
const lib = read('lib/turnover-ai.ts');
check('a reply cut off at max_tokens fails the file instead of under-counting', /stop_reason === 'max_tokens'/.test(lib) && /max_tokens: 8192/.test(lib));
const page = read('app/turnover-ai/project/[id]/page.tsx');
check('the project page prepares every file before sending it', /prepareForUpload\(file\)/.test(page));
check('a non-JSON platform error (413/504) never crashes the row', /res\.json\(\)\.catch\(\(\) => null\)/.test(page));
check('the project page lists files that couldn’t be read, by the shared rule', /unreadDocuments = detail\.documents\.filter\(d => isUnread\(d\.outcome\)\)/.test(page));
check('the project page can remove one through the documents route', /removeDocument\(d\)/.test(page) && /\/api\/turnover-ai\/documents\/\$\{doc\.id\}`, \{ method: 'DELETE' \}/.test(page));
const removeRoute = read('app/api/turnover-ai/documents/[id]/route.ts');
check('the remove route re-checks the file is unread on the server', /isUnread\(documentOutcome\(doc\.status, doc\.uploaded_at, Date\.now\(\)\)\)/.test(removeRoute));
check('the remove route refuses a file with receipts in the table', /from\('turnover_line_items'\)\.select\('id', \{ count: 'exact', head: true \}\)\.eq\('document_id', documentId\)/.test(removeRoute) && /if \(count\) return/.test(removeRoute));
check('the remove route can never delete a done file', /\.delete\(\)\.eq\('id', documentId\)\.neq\('status', 'done'\)/.test(removeRoute));
check('the Projects card counts unread by the same rule', /isUnread\(outcome\)/.test(read('app/api/turnover-ai/projects/route.ts')));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
