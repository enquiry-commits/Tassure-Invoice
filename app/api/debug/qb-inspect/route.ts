import { NextRequest, NextResponse } from 'next/server';
import { getValidToken } from '@/lib/quickbooks';
import { nextDocNumber, getNet7TermId, findPicClass } from '@/lib/qb-invoice-conventions';

// TEMPORARY — inspect invoice conventions (DocNumber/Class/Terms) so the
// create-invoice route can replicate them. Delete after use.
const QB_BASE = 'https://quickbooks.api.intuit.com';

const pickFields = (inv: Record<string, unknown>) => ({
  DocNumber: inv.DocNumber ?? '(BLANK)',
  TxnDate: inv.TxnDate,
  Customer: (inv.CustomerRef as Record<string, unknown>)?.name,
  SalesTermRef: inv.SalesTermRef ?? '(none)',
  DueDate: inv.DueDate,
  Lines: ((inv.Line as Record<string, unknown>[]) ?? [])
    .filter(l => l.DetailType === 'SalesItemLineDetail')
    .map(l => {
      const d = l.SalesItemLineDetail as Record<string, unknown>;
      return { item: (d?.ItemRef as Record<string, unknown>)?.name, class: d?.ClassRef ?? '(none)', amount: l.Amount };
    }),
});

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get('company') === 'TAC' ? 'TAC' : 'TAB';
  const docNo = req.nextUrl.searchParams.get('doc');
  const invId = req.nextUrl.searchParams.get('id');

  const tok = await getValidToken(company);
  if (!tok) return NextResponse.json({ error: `${company} not connected` }, { status: 500 });
  const H = { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' };
  const B = `${QB_BASE}/v3/company/${tok.realm_id}`;

  const out: Record<string, unknown> = {};

  // Preview mode: dry-run the invoice-convention helpers (nothing created).
  if (req.nextUrl.searchParams.get('preview')) {
    const pic = req.nextUrl.searchParams.get('pic') ?? '';
    const today = new Date().toISOString().slice(0, 10);
    const [doc, term, cls] = await Promise.all([
      nextDocNumber(tok.access_token, tok.realm_id, company, today),
      getNet7TermId(tok.access_token, tok.realm_id),
      pic ? findPicClass(tok.access_token, tok.realm_id, pic) : Promise.resolve(null),
    ]);
    return NextResponse.json({ company, nextDocNumber: doc, net7TermId: term, pic, matchedClass: cls });
  }

  if (docNo) {
    const q = encodeURIComponent(`SELECT * FROM Invoice WHERE DocNumber = '${docNo}'`);
    const j = await (await fetch(`${B}/query?query=${q}&minorversion=65`, { headers: H })).json();
    const inv = j.QueryResponse?.Invoice?.[0];
    out.byDocNumber = inv ? pickFields(inv) : (j.Fault ?? 'NOT FOUND');
  }
  if (invId) {
    const j = await (await fetch(`${B}/invoice/${invId}?minorversion=65`, { headers: H })).json();
    out.byId = j.Invoice ? pickFields(j.Invoice) : (j.Fault ?? 'NOT FOUND');
  }

  const terms = (await (await fetch(`${B}/query?query=${encodeURIComponent('SELECT * FROM Term')}&minorversion=65`, { headers: H })).json()).QueryResponse?.Term ?? [];
  out.terms = terms.map((t: Record<string, unknown>) => ({ id: t.Id, name: t.Name, days: t.DueDays }));

  const classes = (await (await fetch(`${B}/query?query=${encodeURIComponent('SELECT * FROM Class MAXRESULTS 200')}&minorversion=65`, { headers: H })).json()).QueryResponse?.Class ?? [];
  out.classes = classes.map((c: Record<string, unknown>) => ({ id: c.Id, name: c.Name }));

  // latest DocNumbers to learn the numbering scheme
  const q = encodeURIComponent(`SELECT DocNumber, TxnDate FROM Invoice ORDER BY MetaData.CreateTime DESC MAXRESULTS 10`);
  const j = await (await fetch(`${B}/query?query=${q}&minorversion=65`, { headers: H })).json();
  out.latestDocNumbers = (j.QueryResponse?.Invoice ?? []).map((i: Record<string, unknown>) => ({ doc: i.DocNumber ?? '(BLANK)', date: i.TxnDate }));

  return NextResponse.json(out);
}
