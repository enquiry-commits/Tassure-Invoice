import { NextRequest, NextResponse } from 'next/server';
import { getValidToken } from '@/lib/quickbooks';

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

export interface DraftLineItem {
  service: string;          // 'Secretary' | 'Address' | 'ND' etc.
  description: string;      // full line description
  rate: number;
  qty?: number;
}

// ── Look up QB Customer by display name ───────────────────────────────────────
async function findCustomer(token: string, realmId: string, name: string) {
  const escaped = name.replace(/'/g, "\\'");
  const q = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${escaped}' MAXRESULTS 5`);
  const res = await fetch(`${QB_BASE}/v3/company/${realmId}/query?query=${q}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const json = await res.json();
  const rows: Record<string, unknown>[] = json.QueryResponse?.Customer ?? [];
  if (rows.length) return { id: rows[0].Id as string, name: rows[0].DisplayName as string };

  // Fuzzy fallback: partial word match
  const words = name.toLowerCase().replace(/pte\.?\s*ltd\.?/gi,'').trim().split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return null;
  const q2 = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName LIKE '%${words[0]}%' MAXRESULTS 20`);
  const res2 = await fetch(`${QB_BASE}/v3/company/${realmId}/query?query=${q2}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res2.ok) return null;
  const json2 = await res2.json();
  const rows2: Record<string, unknown>[] = json2.QueryResponse?.Customer ?? [];
  const normTarget = name.toLowerCase().replace(/pte\.?\s*ltd\.?/gi,'').trim();
  const match = rows2.find(r => {
    const dn = (r.DisplayName as string ?? '').toLowerCase().replace(/pte\.?\s*ltd\.?/gi,'').trim();
    return dn.includes(normTarget) || normTarget.includes(dn);
  });
  return match ? { id: match.Id as string, name: match.DisplayName as string } : null;
}

// ── Look up QB Items to get ItemRef for each service ─────────────────────────
async function getItemMap(token: string, realmId: string): Promise<Map<string, { id: string; name: string }>> {
  const q = encodeURIComponent('SELECT * FROM Item WHERE Type = \'Service\' MAXRESULTS 200');
  const res = await fetch(`${QB_BASE}/v3/company/${realmId}/query?query=${q}&minorversion=65`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const map = new Map<string, { id: string; name: string }>();
  if (!res.ok) return map;
  const json = await res.json();
  for (const item of json.QueryResponse?.Item ?? []) {
    map.set((item.Name as string).toLowerCase(), { id: item.Id as string, name: item.Name as string });
  }
  return map;
}

function pickItem(service: string, itemMap: Map<string, { id: string; name: string }>) {
  const keywords: Record<string, string[]> = {
    Secretary: ['secretarial', 'corporate sec', 'secretary'],
    Address:   ['address', 'virtual office', 'registered office'],
    ND:        ['nominee', 'director'],
    AR:        ['annual return', 'government fee'],
    XBRL:      ['xbrl', 'ixbrl'],
    Accounts:  ['account', 'bookkeeping', 'compilation'],
    Tax:       ['tax', 'iras'],
    Audit:     ['audit'],
  };
  const kws = keywords[service] ?? [service.toLowerCase()];
  for (const [key, val] of itemMap) {
    if (kws.some(k => key.includes(k))) return val;
  }
  // Generic fallback — first service item
  return itemMap.size ? [...itemMap.values()][0] : { id: '1', name: 'Services' };
}

// ── POST /api/quickbooks/create-invoice ───────────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { companyName, email, lines, txnDate } = body as {
    companyName: string;
    email?: string;
    lines: DraftLineItem[];
    txnDate?: string;
  };

  if (!companyName || !lines?.length) {
    return NextResponse.json({ error: 'companyName and lines are required' }, { status: 400 });
  }

  const tokenRow = await getValidToken();
  if (!tokenRow) return NextResponse.json({ error: 'QuickBooks not connected' }, { status: 401 });

  const { access_token: token, realm_id: realmId } = tokenRow;

  // 1. Find customer
  const customer = await findCustomer(token, realmId, companyName);
  if (!customer) {
    return NextResponse.json({ error: `Customer not found in QB: "${companyName}"` }, { status: 404 });
  }

  // 2. Get item map
  const itemMap = await getItemMap(token, realmId);

  // 3. Build invoice lines
  const invoiceLines = lines.map((l, i) => {
    const item = pickItem(l.service, itemMap);
    return {
      LineNum: i + 1,
      DetailType: 'SalesItemLineDetail',
      Amount: +(l.rate * (l.qty ?? 1)).toFixed(2),
      Description: l.description,
      SalesItemLineDetail: {
        ItemRef: { value: item.id, name: item.name },
        Qty:       l.qty ?? 1,
        UnitPrice: l.rate,
      },
    };
  });

  // 4. Build invoice payload
  const payload: Record<string, unknown> = {
    Line:        invoiceLines,
    CustomerRef: { value: customer.id, name: customer.name },
    TxnDate:     txnDate ?? new Date().toISOString().slice(0, 10),
    PrintStatus: 'NeedToPrint',
    EmailStatus: email ? 'NeedToSend' : 'NotSet',
  };
  if (email) payload.BillEmail = { Address: email };

  // 5. Create draft invoice in QB
  const createRes = await fetch(
    `${QB_BASE}/v3/company/${realmId}/invoice?minorversion=65`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept:         'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!createRes.ok) {
    const errText = await createRes.text();
    return NextResponse.json({ error: 'QB create failed', detail: errText }, { status: 500 });
  }

  const created = await createRes.json();
  const inv = created.Invoice ?? {};

  return NextResponse.json({
    success:   true,
    invoiceNo: inv.DocNumber,
    qbId:      inv.Id,
    customer:  customer.name,
    total:     inv.TotalAmt,
  });
}
