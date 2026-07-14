const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

async function getToken(label) {
  const { data: row } = await sb.from('quickbooks_tokens').select('*').eq('company_label', label).single();
  if (new Date(row.expires_at).getTime() > Date.now() + 120000) return row;
  const basic = Buffer.from(`${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: row.refresh_token }),
  });
  const t = await res.json();
  const now = new Date();
  await sb.from('quickbooks_tokens').update({
    access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(now.getTime() + t.expires_in * 1000).toISOString(),
    refresh_expires_at: new Date(now.getTime() + t.x_refresh_token_expires_in * 1000).toISOString(),
    updated_at: now.toISOString(),
  }).eq('company_label', label);
  return { ...row, access_token: t.access_token };
}

const pickFields = (inv) => ({
  DocNumber: inv.DocNumber ?? '(BLANK)',
  TxnDate: inv.TxnDate,
  Customer: inv.CustomerRef?.name,
  SalesTermRef: inv.SalesTermRef ?? '(none)',
  DueDate: inv.DueDate,
  EmailStatus: inv.EmailStatus,
  Lines: (inv.Line ?? []).filter(l => l.DetailType === 'SalesItemLineDetail').map(l => ({
    item: l.SalesItemLineDetail?.ItemRef?.name,
    class: l.SalesItemLineDetail?.ClassRef ?? '(none)',
    amount: l.Amount,
  })),
});

async function main() {
  const tok = await getToken('TAB');
  const H = { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' };
  const B = `https://quickbooks.api.intuit.com/v3/company/${tok.realm_id}`;

  // 1) 手工开的最近一张（单号最大的）
  const q1 = encodeURIComponent(`SELECT * FROM Invoice WHERE DocNumber = '02610732'`);
  const manual = (await (await fetch(`${B}/query?query=${q1}&minorversion=65`, { headers: H })).json()).QueryResponse?.Invoice?.[0];
  console.log('=== 手工发票 02610732 ===');
  console.log(JSON.stringify(manual ? pickFields(manual) : 'NOT FOUND', null, 2));

  // 2) 系统今天开的那张
  const ours = (await (await fetch(`${B}/invoice/19095?minorversion=65`, { headers: H })).json()).Invoice;
  console.log('=== 系统开的 (Id 19095, Altstake) ===');
  console.log(JSON.stringify(ours ? pickFields(ours) : 'NOT FOUND', null, 2));

  // 3) Terms 列表
  const q3 = encodeURIComponent('SELECT * FROM Term');
  const terms = (await (await fetch(`${B}/query?query=${q3}&minorversion=65`, { headers: H })).json()).QueryResponse?.Term ?? [];
  console.log('=== Terms ===', JSON.stringify(terms.map(t => ({ id: t.Id, name: t.Name, days: t.DueDays }))));

  // 4) Class 列表
  const q4 = encodeURIComponent('SELECT * FROM Class MAXRESULTS 50');
  const classes = (await (await fetch(`${B}/query?query=${q4}&minorversion=65`, { headers: H })).json()).QueryResponse?.Class ?? [];
  console.log('=== Classes ===', JSON.stringify(classes.map(c => ({ id: c.Id, name: c.Name }))));
}
main().catch(e => console.error('FATAL', e.message));
