// lib/soa-book-pdfs.ts — which books' SOA PDFs go on an ALL-mode Draft.
// Only a 404 (the book owes nothing for this client) may be left out; any
// other failure must stop the draft and name the book, or a collections email
// silently goes out without a statement the client owes (council review
// 2026-10-06; Vincent: "改成明确报错").
//
// Run: npx tsx test-soa-book-pdfs.ts
import fs from 'fs';
import path from 'path';
import { SoaPdfError, settleBookPdfs, type BookPdfAttempt } from './lib/soa-book-pdfs';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};

const ok = (book: 'TAB' | 'TAC' | 'TAO'): BookPdfAttempt<string> => ({ book, file: `${book}.pdf` });
const bad = (book: 'TAB' | 'TAC' | 'TAO', error: unknown): BookPdfAttempt<string> => ({ book, error });
const settle = (attempts: BookPdfAttempt<string>[]): { files?: string[]; error?: string } => {
  try { return { files: settleBookPdfs(attempts) }; } catch (err) { return { error: (err as Error).message }; }
};

console.log('--- a book that owes nothing is left out; anything else stops the draft ---');
check('all three books answered: three attachments', JSON.stringify(settle([ok('TAB'), ok('TAC'), ok('TAO')]).files) === '["TAB.pdf","TAC.pdf","TAO.pdf"]');
check('a 404 (nothing outstanding in that book) is left out, quietly', JSON.stringify(settle([ok('TAB'), bad('TAC', new SoaPdfError('No outstanding invoices found for "X".', 404)), ok('TAO')]).files) === '["TAB.pdf","TAO.pdf"]');
const failed = settle([ok('TAB'), bad('TAC', new SoaPdfError('The SOA PDF could not be generated: boom', 500)), ok('TAO')]);
check('a 500 in one book stops the draft instead of dropping that book', !failed.files && /TAC: The SOA PDF could not be generated: boom/.test(failed.error ?? ''), JSON.stringify(failed));
check('  and says why no draft was made', /No draft was made/.test(failed.error ?? '') && !/TAB:|TAO:/.test(failed.error ?? ''));
check('a network error (no HTTP status) also stops the draft', !!settle([ok('TAB'), bad('TAO', new TypeError('Failed to fetch'))]).error);
check('a thrown non-Error is reported, not swallowed', /TAO: weird/.test(settle([ok('TAB'), bad('TAO', 'weird')]).error ?? ''));
const two = settle([bad('TAB', new SoaPdfError('a', 502)), ok('TAC'), bad('TAO', new SoaPdfError('b', 504))]);
check('every failing book is named', /TAB: a \| TAO: b/.test(two.error ?? ''), two.error);
check('a 404 next to a 500 still stops (the 500 is a real failure)', /TAC: x/.test(settle([bad('TAB', new SoaPdfError('none', 404)), bad('TAC', new SoaPdfError('x', 500))]).error ?? ''));
check('all three 404: the old "unable to generate any" message', settle([bad('TAB', new SoaPdfError('n', 404)), bad('TAC', new SoaPdfError('n', 404)), bad('TAO', new SoaPdfError('n', 404))]).error === 'Unable to generate any SOA PDF for this company.');
check('a 404 that is not an SoaPdfError (plain Error) is NOT trusted as "nothing owed"', !!settle([ok('TAB'), bad('TAC', new Error('404'))]).error);

console.log('\n--- the Draft flow uses it ---');
const client = fs.readFileSync(path.join(process.cwd(), 'lib', 'soa-actions-client.ts'), 'utf8');
check('the SOA client raises SoaPdfError with the HTTP status', /new SoaPdfError\(j\.error \?\? `Unable to generate the \$\{book\} SOA PDF\.`, res\.status\)/.test(client));
check('the ALL-mode draft settles through settleBookPdfs (no silent catch { return null })', /settleBookPdfs\(attempts\)/.test(client) && !/catch \{ return null; \}/.test(client));

console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
process.exit(fail === 0 ? 0 : 1);
