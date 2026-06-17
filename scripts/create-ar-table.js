// Create annual_returns table and import data
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
);

const DATA_FILE = path.join(__dirname, '../data/annual_returns.json');

async function main() {
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const records = raw.records;
  console.log(`Loaded ${records.length} AR records`);

  // Pick the last (most recent) date; convert DD/MM/YYYY → YYYY-MM-DD if needed
  function cleanDate(val) {
    if (!val) return null;
    const dates = val.split('\n').map(s => s.trim()).filter(Boolean);
    const raw = dates[dates.length - 1] || null;
    if (!raw) return null;
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return raw;
  }

  // Upsert in batches of 100
  const rows = records.map(r => ({
    entity_name: r.entityName,
    year: r.year,
    fye: cleanDate(r.fye),
    due_date: cleanDate(r.dueDate),
    pic: r.pic || '',
    status: r.status || 'Pending',
    scraped_at: raw.scraped_at,
  }));

  let done = 0;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await sb
      .from('annual_returns')
      .upsert(batch, { onConflict: 'entity_name,year', ignoreDuplicates: false });

    if (error) {
      console.error(`Batch ${i}-${i + BATCH} error:`, error.message);
    } else {
      done += batch.length;
      if (done % 200 === 0 || done === rows.length) {
        console.log(`  Upserted ${done}/${rows.length}`);
      }
    }
  }

  console.log(`\n✅ Done. ${done} records imported into annual_returns`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
