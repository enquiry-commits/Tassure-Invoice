import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { isWithinRestriction } from '@/lib/approved-accounts';
import { buildWorkbook } from '@/lib/export-columns';
import { buildChatExport, type ChatExportSpec } from '@/lib/chat-export';
import type { CompanyListFilters } from '@/lib/company-list-lookup';

/**
 * The .xlsx behind a chat list answer (2026-09-10) — see lib/chat-export.ts
 * for why this exists and why the file is built from a re-run query rather
 * than from anything the model produced.
 *
 * This route parses the request body field-by-field against an allow-list
 * (parseSpec below) instead of trusting the posted JSON's shape. That is not
 * ceremony: the body originates from a card rendered off an LLM turn, so
 * spreading it into CompanyListFilters would let a stray key (e.g.
 * `unlimited`, or a future filter) ride in unchecked. Same discipline as
 * companyListTool() in ../route.ts.
 *
 * Permissions mirror the PAGE each list belongs to, using the same
 * isWithinRestriction() check the assistant's own billing tools use — a
 * restricted account (restrictedTo: '/billing?tab=ar') must not be able to
 * download the full client roster just because chat can compose the query.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

// Which real page each export kind belongs to, for the restriction check.
const KIND_PAGE: Record<ChatExportSpec['kind'], { pathname: string; params: Record<string, string> }> = {
  company_list: { pathname: '/companies', params: {} },
  collections: { pathname: '/billing/soa/tab', params: {} },
  deadlines: { pathname: '/billing', params: { tab: 'ar' } },
  late_filing: { pathname: '/late-filing', params: {} },
};

const SERVICES = ['address', 'nd', 'agm', 'xbrl', 'accounts', 'tax'];

function parseSpec(body: Record<string, unknown>): ChatExportSpec | null {
  const kind = body.kind;

  if (kind === 'company_list') {
    const raw = (body.filters ?? {}) as Record<string, unknown>;
    const filters: CompanyListFilters = {};
    if (typeof raw.pic === 'string' && raw.pic.trim()) filters.pic = raw.pic;
    if (typeof raw.fyeMonth === 'string' && raw.fyeMonth.trim()) filters.fyeMonth = raw.fyeMonth;
    if (typeof raw.service === 'string' && SERVICES.includes(raw.service)) filters.service = raw.service as CompanyListFilters['service'];
    if (typeof raw.industry === 'string' && raw.industry.trim()) filters.industry = raw.industry;
    if (typeof raw.companyType === 'string' && raw.companyType.trim()) filters.companyType = raw.companyType;
    if (typeof raw.customerSource === 'string' && raw.customerSource.trim()) filters.customerSource = raw.customerSource;
    if (typeof raw.status === 'string' && raw.status.trim()) filters.status = raw.status;
    if (typeof raw.activeOnly === 'boolean') filters.activeOnly = raw.activeOnly;
    // Deliberately NOT copied: `limit` and `unlimited`. An export is always
    // the complete list — that is the entire point of the feature.
    if (!Object.keys(filters).length) return null;
    return { kind: 'company_list', filters };
  }

  if (kind === 'collections') {
    const owner = typeof body.owner === 'string' && body.owner.trim() ? body.owner.trim() : null;
    return { kind: 'collections', owner };
  }

  if (kind === 'deadlines') {
    const days = typeof body.rangeDays === 'number' && body.rangeDays > 0 ? Math.min(Math.round(body.rangeDays), 365) : 30;
    return { kind: 'deadlines', rangeDays: days };
  }

  if (kind === 'late_filing') return { kind: 'late_filing' };

  return null;
}

export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const spec = parseSpec(body);
  if (!spec) return NextResponse.json({ error: 'Unknown or incomplete export request' }, { status: 400 });

  const page = KIND_PAGE[spec.kind];
  if (account.restrictedTo && !isWithinRestriction(account.restrictedTo, page.pathname, new URLSearchParams(page.params))) {
    return NextResponse.json({ error: 'Your account does not have access to this data.' }, { status: 403 });
  }

  try {
    const built = await buildChatExport(spec);
    const buffer = await buildWorkbook(
      [{ name: built.sheetName, rows: built.rows, columns: built.columns, titleRow: built.titleRow }],
      { title: built.sheetName, subject: built.titleRow },
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${built.filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[assistant/export] failed', err);
    return NextResponse.json({ error: 'Could not build the export.' }, { status: 500 });
  }
}
