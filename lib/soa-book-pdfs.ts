// Which books' SOA PDFs go on an ALL-mode Draft (the "All" page's Draft
// Email asks TAB, TAC and TAO for their own PDF and attaches each that comes
// back). A book answering 404 owes nothing there and is left out on purpose.
// Any OTHER failure — a 500, a timeout, a network error — used to be dropped
// the same way, so a statement the client owes could silently be missing from
// a collections email; the council review of 2026-10-06 flagged it and
// Vincent chose "改成明确报错": it now stops the draft and names the book.
// Pure — the fetches stay in lib/soa-actions-client.ts.

import type { QbCompany } from '@/lib/quickbooks';

// A failed SOA PDF request, with the HTTP status when there was one.
export class SoaPdfError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'SoaPdfError';
    this.status = status;
  }
}

export type BookPdfAttempt<F> = { book: QbCompany; file: F } | { book: QbCompany; error: unknown };

export function settleBookPdfs<F>(attempts: BookPdfAttempt<F>[]): F[] {
  const files: F[] = [];
  const failed: string[] = [];
  for (const attempt of attempts) {
    if ('file' in attempt) { files.push(attempt.file); continue; }
    if (attempt.error instanceof SoaPdfError && attempt.error.status === 404) continue; // nothing outstanding in that book
    failed.push(`${attempt.book}: ${attempt.error instanceof Error ? attempt.error.message : String(attempt.error)}`);
  }
  if (failed.length) {
    throw new Error(`No draft was made — the SOA PDF failed for ${failed.join(' | ')}. A draft without it would be missing a statement the client owes; try again, and tell Vincent if it keeps failing.`);
  }
  if (!files.length) throw new Error('Unable to generate any SOA PDF for this company.');
  return files;
}
