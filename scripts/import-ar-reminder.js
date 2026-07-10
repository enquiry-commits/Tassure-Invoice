// Import AR Reminder JSON → Supabase ar_reminder table
// Usage: node scripts/import-ar-reminder.js [month] [year]
//        node scripts/import-ar-reminder.js April 2026
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

function parseDate(d) {
  if (!d || d === '--Select--' || d === 'null') return null;
  d = String(d).trim();
  // DD/MM/YYYY
  const m1 = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  // Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return null;
}

function clean(s) {
  if (!s || s === '--Select--') return null;
  return String(s).trim() || null;
}

async function main() {
  const month = process.argv[2] || 'April';
  const year  = process.argv[3] || '2026';
  const file  = path.join(__dirname, `../data/ar_reminder_${month.toLowerCase()}_${year}.json`);

  if (!fs.existsSync(file)) {
    console.error('File not found:', file);
    console.error('Run scrape-ar-reminder.js first.');
    process.exit(1);
  }

  const raw     = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const records = raw.records || [];
  console.log(`Importing ${records.length} records — FYE ${month} ${year}`);

  // Deduplicate by (entity_name, fye_month, fye_year) — keep last occurrence
  const seen = new Map();
  records.forEach(r => { seen.set(r.entityName.toLowerCase().trim(), r); });
  const unique = [...seen.values()];
  console.log(`After dedup: ${unique.length} unique records (removed ${records.length - unique.length} duplicates)`);

  const rows = unique.map(r => {
    const d = r.detail || {};
    return {
      entity_name:     r.entityName,
      uen:             r.uen || '',
      fye_month:       month,
      fye_year:        parseInt(year),
      fye_date:        parseDate(d.fye_date) || parseDate(r.fye),
      due_date:        r.dueDate
        ? (/^\d{4}/.test(r.dueDate) ? r.dueDate.slice(0, 10) : parseDate(r.dueDate))
        : null,
      pic:             r.pic || '',
      status:          r.status || 'Pending',
      event_id:        r.eventId || null,
      xbrl:            clean(d.xbrl),
      accounts_status: clean(d.accounts_status),
      fin_stmt_status: clean(d.fin_stmt_status),
      audited_fs:      clean(d.audited_fs),
      agm_documents:   clean(d.agm_documents),
      dormant:         clean(d.dormant),
      prepared_date:   parseDate(d.prepared_date),
      sent_date:       parseDate(d.sent_date),
      received_date:   parseDate(d.received_date),
      date_of_agm:     parseDate(d.date_of_agm),
      agm_held_date:   parseDate(d.agm_held_date),
      filling_date:    parseDate(d.filling_date),
      remarks:         clean(d.remarks),
      scraped_at:      raw.scraped_at || new Date().toISOString(),
    };
  });

  const { error } = await sb.from('ar_reminder').upsert(rows, {
    onConflict: 'entity_name,fye_month,fye_year',
  });

  if (error) { console.error('Supabase error:', error.message); process.exit(1); }
  console.log(`✅ Upserted ${rows.length} rows into ar_reminder`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
