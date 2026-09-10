// Every chat-writeable field must carry the exact field name and endpoint
// its API expects. Added 2026-09-10 after a refactor that moved column-name
// resolution from the browser to the server silently dropped `apiField` on
// the trademark branch — the card would have PATCHed `field: undefined`.
// The browser must never derive a column name; this asserts it never has to.
//
// Run: npx tsx test-chat-write-fields.tsx
import { config } from 'dotenv';
config({ path: '.env.local' });
import { previewCompanyUpdate } from './lib/company-update-lookup';

let fail = 0;
const ok = (n: string, c: boolean, d = '') => { console.log((c ? 'OK   ' : 'FAIL ') + n + (c ? '' : ' -- ' + d)); if (!c) fail++; };

(async () => {
  const cases: [string, unknown, string, string][] = [
    ['billto:care_of', 'X', '/api/companies/bill-to', 'bill_to_care_of'],
    ['billto:addr_source', 'b', '/api/companies/bill-to', 'bill_to_care_of_addr_source'],
    ['billto:addr_custom', 'X', '/api/companies/bill-to', 'bill_to_care_of_addr_custom'],
    ['billto:attn', 'X', '/api/companies/bill-to', 'bill_to_attn'],
    ['master:remark', 'X', '/api/master-list', 'remark'],
    ['master:grade', 'A', '/api/master-list', 'grade'],
  ];
  for (const [f, v, ep, af] of cases) {
    const r = await previewCompanyUpdate('1V CAPITAL', f as never, v);
    ok(`${f} -> ${af} @ ${ep}`, r.found && r.preview.apiField === af && r.preview.endpoint === ep,
       r.found ? `${r.preview.apiField} @ ${r.preview.endpoint}` : r.message);
  }
  for (const tf of ['status_text', 'mark_expired_date', 'updates_note', 'remarks']) {
    const r = await previewCompanyUpdate('GRAND GOLDEN COAST', `trademark:${tf}` as never, tf === 'mark_expired_date' ? '2030-01-01' : 'X');
    ok(`trademark:${tf} -> ${tf} @ /api/trademark`, r.found && r.preview.apiField === tf && r.preview.endpoint === '/api/trademark',
       r.found ? String(r.preview.apiField) : r.message);
  }
  // These endpoints take a fixed body shape and must NOT get a field name.
  for (const f of ['customer_source', 'parent_company', 'service:xbrl']) {
    const r = await previewCompanyUpdate('1V CAPITAL', f as never, f === 'service:xbrl' ? true : null);
    ok(`${f} carries no apiField`, r.found && r.preview.apiField === undefined, r.found ? String(r.preview.apiField) : r.message);
  }
  // Conflict-safe endpoints must always receive the value this preview saw.
  const ml = await previewCompanyUpdate('1V CAPITAL', 'master:grade' as never, 'B');
  ok('master:* carries rowId + previousValue for the conflict check', ml.found && typeof ml.preview.rowId === 'number' && 'previousValue' in ml.preview);

  console.log(fail === 0 ? '\n=== ALL PASSED ===' : `\n=== ${fail} FAILED ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAILED', e instanceof Error ? e.message : e); process.exit(1); });
