// One-time historical import: BULK.xlsm (desktop) -> email_campaigns/email_drafts.
//
// Six sheets, wildly different column layouts, so columns are located by
// header text (the "<Placeholder>" cells) rather than hardcoded index — the
// only thing shared across sheets is that data columns start after the
// header row and are followed by a variable number of tracking columns.
//
// "Send Email ?" is NOT a sent/not-sent flag (real rows with "n" still have
// real send timestamps after them) - it's a "should the macro process this
// row" trigger. The actual evidence a row was sent is a numeric Excel date
// serial (roughly 40000-60000) anywhere after the named columns; the
// earliest one found is used as sent_at. No such value -> status: 'pending'.
//
// Usage: node scripts/import-bulk-history.js [--commit]
// Dry-run by default (prints per-sheet stats + samples); --commit writes.
const path = require('path');
const XLSX = require('xlsx');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const COMMIT = process.argv.includes('--commit');
const FILE_PATH = path.join('C:', 'Users', 'vincent', 'Desktop', 'BULK.xlsm');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

function excelSerialToDate(serial) {
  const utcDays = Math.floor(serial - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  const fractionalDay = serial - Math.floor(serial);
  date.setUTCSeconds(date.getUTCSeconds() + Math.round(fractionalDay * 86400));
  return date;
}
function isDateSerial(v) {
  return typeof v === 'number' && v > 40000 && v < 60000;
}
function normalize(name) {
  return (name || '').toLowerCase()
    .replace(/\(f\.?k\.?a\.?[^)]*\)/gi, '')
    .replace(/\bpte\.?\s*ltd\.?\b/gi, '').replace(/\bprivate\s+limited\b/gi, '')
    .replace(/\blimited\b/gi, '').replace(/[.,()]/g, ' ').replace(/\s+/g, ' ').trim();
}
function colIndex(header, label) {
  return header.findIndex(h => String(h).trim() === label);
}
// Free-text invoice references (AR1/AR2/AR3): pull every (company?, number)
// pair out of strings like "02610451 & TAC 02680105" or
// "TAB02610471 & TAO02560817,02660059,02660095,02660260".
function parseFreeTextInvoices(text) {
  if (!text) return [];
  const out = [];
  const re = /(TAB|TAC|TAO)?\s*(\d{6,8})/gi;
  let m;
  let lastCompany = null;
  while ((m = re.exec(String(text))) !== null) {
    const company = m[1] ? m[1].toUpperCase() : lastCompany;
    if (m[1]) lastCompany = m[1].toUpperCase();
    out.push({ qbCompany: company ?? 'UNKNOWN', invoiceNo: m[2], amount: 0 });
  }
  return out;
}

async function loadCompanies() {
  const { data } = await sb.from('companies').select('id, company_name');
  return (data ?? []).map(c => ({ id: c.id, norm: normalize(c.company_name) }));
}
function matchCompany(name, companies) {
  const n = normalize(name);
  const exact = companies.find(c => c.norm === n);
  if (exact) return exact.id;
  // cheap fuzzy: containment either direction, only when unambiguous
  const candidates = companies.filter(c => c.norm && (c.norm.includes(n) || n.includes(c.norm)) && n.length > 3);
  return candidates.length === 1 ? candidates[0].id : null;
}

// ── Per-sheet row parsers -> a common draft shape ───────────────────────────
function parseLetterRow(row, header) {
  const idx = {
    company: colIndex(header, '<Company Name>'), user: colIndex(header, '<User Name>'),
    to: colIndex(header, '<To Email>'), cc: colIndex(header, '<CC Email>'),
    date: colIndex(header, '<Date>'), letter: colIndex(header, '<Letter>'),
    status: colIndex(header, 'Status'),
  };
  const company = row[idx.company];
  if (!company) return null;
  const trackingStart = idx.status + 1;
  const timestamps = row.slice(trackingStart).filter(isDateSerial);
  return {
    companyName: company, contactName: row[idx.user] || company,
    toEmail: row[idx.to] || null, ccEmail: row[idx.cc] || null,
    invoiceRefs: [], totalAmount: null,
    subjectNote: `Document reminder — ${row[idx.letter] || ''}`.trim(),
    timestamps,
  };
}
function parseArFreeTextRow(row, header, invCols) {
  const idx = {
    company: colIndex(header, '<Company Name>'), user: colIndex(header, '<User Name>'),
    to: colIndex(header, '<To Email>'), cc: colIndex(header, '<CC Email>'),
    amount: colIndex(header, '<Amount>'), status: colIndex(header, 'Status'),
  };
  const company = row[idx.company];
  if (!company) return null;
  const invText = invCols.map(label => row[colIndex(header, label)]).filter(Boolean).join(' & ');
  const refs = parseFreeTextInvoices(invText);
  const totalAmount = typeof row[idx.amount] === 'number' ? row[idx.amount] : null;
  const trackingStart = idx.status + 1;
  const timestamps = row.slice(trackingStart).filter(isDateSerial);
  return {
    companyName: company, contactName: row[idx.user] || company,
    toEmail: row[idx.to] || null, ccEmail: row[idx.cc] || null,
    invoiceRefs: refs, totalAmount,
    subjectNote: `AR renewal reminder — invoice ref: ${invText || '(none recorded)'}`,
    timestamps,
  };
}
function parseSoaRow(row, header) {
  const idx = {
    company: colIndex(header, '<Company Name>'), user: colIndex(header, '<User Name>'),
    to: colIndex(header, '<To Email>'), cc: colIndex(header, '<CC Email>'),
    amount: colIndex(header, '<Amount>'), status: colIndex(header, 'Status'),
  };
  const company = row[idx.company];
  if (!company) return null;
  const slots = [
    ['TAB', '<Invoice TAB 1>', '<Amount $ TAB 1>'], ['TAB', '<Invoice TAB 2>', '<Amount $TAB 2>'],
    ['TAO', '<Invoice TAO 1>', '<Amount $ TAO 1>'], ['TAO', '<Invoice TAO 2>', '<Amount $TAO 2>'], ['TAO', '<Invoice TAO 3>', '<Amount $TAO 3>'],
    ['TAC', '<Invoice TAC 1>', '<Amount $ TAC 1>'],
  ];
  const refs = [];
  for (const [company_, invLabel, amtLabel] of slots) {
    const invIdx = colIndex(header, invLabel);
    const amtIdx = colIndex(header, amtLabel);
    const invoiceNo = invIdx >= 0 ? row[invIdx] : null;
    if (invoiceNo) refs.push({ qbCompany: company_, invoiceNo: String(invoiceNo).trim(), amount: (amtIdx >= 0 && typeof row[amtIdx] === 'number') ? row[amtIdx] : 0 });
  }
  const totalAmount = typeof row[idx.amount] === 'number' ? row[idx.amount] : refs.reduce((s, r) => s + r.amount, 0) || null;
  // Status column itself can BE a timestamp on this sheet (see List_SOA1 sample).
  const trackingStart = idx.status;
  const timestamps = row.slice(trackingStart).filter(isDateSerial);
  return {
    companyName: company, contactName: row[idx.user] || company,
    toEmail: row[idx.to] || null, ccEmail: row[idx.cc] || null,
    invoiceRefs: refs, totalAmount,
    subjectNote: `Statement of Account — ${refs.length} invoice(s)`,
    timestamps,
  };
}

const SHEETS = [
  { name: 'List_letter', type: 'letter', parse: parseLetterRow },
  { name: 'List_AR1', type: 'ar', parse: (row, header) => parseArFreeTextRow(row, header, ['<INV>']) },
  { name: 'List_AR2', type: 'ar', parse: (row, header) => parseArFreeTextRow(row, header, ['<INV 1>', '<INV 2>', '<INV 3>']) },
  { name: 'List_AR3', type: 'ar', parse: (row, header) => parseArFreeTextRow(row, header, ['<INV>']) },
  { name: 'List_SOA1', type: 'soa', parse: parseSoaRow },
  { name: 'List_SOA2', type: 'soa', parse: parseSoaRow },
];

async function main() {
  const wb = XLSX.readFile(FILE_PATH, { cellDates: false });
  const companies = await loadCompanies();
  console.log(`Loaded ${companies.length} companies for matching.\n`);

  const { data: defaultTemplates } = await sb.from('email_templates').select('id, type, is_default').eq('is_default', true);
  const templateByType = new Map((defaultTemplates ?? []).map(t => [t.type, t.id]));

  let grandTotal = 0;
  for (const sheetDef of SHEETS) {
    const sheet = wb.Sheets[sheetDef.name];
    if (!sheet) { console.log(`--- ${sheetDef.name}: sheet not found, skipping ---`); continue; }
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const header = rows[0];
    const dataRows = rows.slice(1);

    const drafts = [];
    let matched = 0, sent = 0;
    for (const row of dataRows) {
      const parsed = sheetDef.parse(row, header);
      if (!parsed) continue;
      const companyId = matchCompany(parsed.companyName, companies);
      if (companyId) matched++;
      const hasTimestamp = parsed.timestamps.length > 0;
      if (hasTimestamp) sent++;
      const sentAt = hasTimestamp ? excelSerialToDate(Math.min(...parsed.timestamps)) : null;
      drafts.push({
        company_id: companyId, company_name: parsed.companyName,
        to_email: parsed.toEmail, cc_email: parsed.ccEmail,
        subject: `[Historical] ${parsed.subjectNote}`.slice(0, 500),
        body: `Imported from BULK.xlsm (${sheetDef.name}). Original email content was generated by an Excel macro and is not preserved — this record exists for delivery-history/audit purposes only.`,
        invoice_refs: parsed.invoiceRefs,
        total_amount: parsed.totalAmount,
        status: hasTimestamp ? 'sent' : 'pending',
        sent_at: sentAt ? sentAt.toISOString() : null,
        sent_by_name: hasTimestamp ? 'BULK.xlsm Import' : null,
      });
    }

    grandTotal += drafts.length;
    const pendingSample = drafts.filter(d => d.status === 'pending').slice(0, 3);
    console.log(`--- ${sheetDef.name} (${sheetDef.type}): ${drafts.length} rows parsed, ${matched} matched to a company, ${sent} marked sent, ${drafts.length - sent} pending ---`);
    console.log('sample sent:', JSON.stringify(drafts.filter(d => d.status === 'sent').slice(0, 2), null, 2));
    if (pendingSample.length) console.log('sample pending:', JSON.stringify(pendingSample, null, 2));

    if (COMMIT && drafts.length) {
      const { data: campaign, error: campaignErr } = await sb.from('email_campaigns').insert({
        type: sheetDef.type, name: `Historical Import — ${sheetDef.name}`,
        template_id: templateByType.get(sheetDef.type) ?? null,
        status: 'completed', created_by_name: 'BULK.xlsm Import',
      }).select().single();
      if (campaignErr) { console.error(`  FAILED to create campaign for ${sheetDef.name}:`, campaignErr.message); continue; }

      for (let i = 0; i < drafts.length; i += 200) {
        const chunk = drafts.slice(i, i + 200).map(d => ({ ...d, campaign_id: campaign.id }));
        const { error } = await sb.from('email_drafts').insert(chunk);
        if (error) console.error(`  FAILED inserting drafts ${i}-${i + chunk.length} for ${sheetDef.name}:`, error.message);
      }
      console.log(`  -> campaign ${campaign.id} created with ${drafts.length} drafts.`);
    }
    console.log('');
  }

  console.log(`TOTAL across all sheets: ${grandTotal} historical drafts${COMMIT ? ' (written)' : ' (DRY RUN — nothing written, re-run with --commit)'}`);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
