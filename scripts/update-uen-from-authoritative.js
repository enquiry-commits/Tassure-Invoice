/**
 * Updates companies table with authoritative UENs from the official AR Reminder list.
 * Matches by company name (fuzzy), then sets the correct UEN.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

// Authoritative list: canonical name → UEN
const AUTHORITATIVE = [
  { name: 'AUTHENTIC ENTERPRISE MANAGEMENT CONSULTING PTE. LTD.', uen: '202320507E' },
  { name: 'AFRI S GROUP PTE. LTD.',                               uen: '202526827Z' },
  { name: 'BROTH BEYOND SINGAPORE PTE. LTD.',                     uen: '202117339E' },
  { name: 'CHINASIN MARINE ENGINEERING PTE. LTD.',                uen: '202521112H' },
  { name: 'CHRONOAI PTE. LTD.',                                   uen: '201815367H' },
  { name: 'CHENG HE CONSTRUCTION PTE. LTD.',                      uen: '202536252N' },
  { name: 'DJ BEAUTY TANG PTE. LTD.',                             uen: '202317100G' },
  { name: 'ELECTRAMIN INTERNATIONAL PTE. LTD.',                   uen: '202519736W' },
  { name: 'GOOHAH SHIPPING PTE. LTD.',                            uen: '202215911K' },
  { name: 'GOLDEN LOTUS INFORMATION SERVICE PTE. LTD.',           uen: '202418776H' },
  { name: 'HONG YANG DEVELOPMENT PTE. LTD.',                      uen: '201110838G' },
  { name: 'HAI RUI PTE. LTD.',                                    uen: '202419688E' },
  { name: 'H & W SPA PTE. LTD.',                                  uen: '201523516W' },
  { name: 'IHORIZON CONSULTING SINGAPORE PTE. LTD.',              uen: '201712019K' },
  { name: 'I-LINK TECHNOLOGY PTE. LTD.',                          uen: '201915742K' },
  { name: 'INFINITY LINKS PTE. LTD.',                             uen: '202320434R' },
  { name: 'JIA JIA FU PTE. LTD.',                                 uen: '201714658K' },
  { name: 'JOPHEN INVESTMENT MANAGEMENT PTE. LTD.',               uen: '201815438R' },
  { name: 'LOYANG BESTCON TRADING & SERVICES',                    uen: '201916145M' },
  { name: 'LIE YANG CONSTRUCTION PTE. LTD.',                      uen: '202217190W' },
  { name: 'LYNKORA TECHNOLOGY PTE. LTD.',                         uen: '202522163Z' },
  { name: 'MUTUAL SYNERGY TRADING PTE. LTD.',                     uen: '202013163Z' },
  { name: 'MERIT BULK PTE. LTD.',                                 uen: '202214878M' },
  { name: 'NAJIWAN PTE. LTD.',                                    uen: '202417366C' },
  { name: 'OCEANIC APEX SHIPPING PTE. LTD.',                      uen: '202523571E' },
  { name: 'QAP LEISURE ASSET HOLDINGS PTE. LTD.',                 uen: '202525381C' },
  { name: 'RUICHI INTERNATIONAL TRADING PTE. LTD.',               uen: '202319422K' },
  { name: 'STARTASTER TECHNOLOGY PTE. LTD.',                      uen: '201312363W' },
  { name: 'SNACKING PTE. LTD.',                                   uen: '202014534G' },
  { name: 'SUPER MALL PTE. LTD.',                                 uen: '202317699M' },
  { name: 'TAIHUA SHIPPING PTE. LTD.',                            uen: '201714802K' },
  { name: 'TOUCHSTONE MEDTECH PTE. LTD.',                         uen: '202320811R' },
  { name: 'TRILITHON CAPITAL PTE. LTD.',                          uen: '202522838W' },
  { name: 'YUAN SOON CONSTRUCTION PTE. LTD.',                     uen: '200202467H' },
  { name: 'BAOBABTREE (S) PTE. LTD.',                             uen: '202523505Z' },
];

function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/\bpte\.?\s*ltd\.?\b/gi, '')
    .replace(/\bsdn\.?\s*bhd\.?\b/gi, '')
    .replace(/\(s\)/gi, '')
    .replace(/[^a-z0-9 &]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function wordOverlap(a, b) {
  const wa = new Set(normalize(a).split(' ').filter(w => w.length > 1));
  const wb = new Set(normalize(b).split(' ').filter(w => w.length > 1));
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union ? inter / union : 0;
}

async function run() {
  const { data: companies, error } = await sb
    .from('companies')
    .select('id, company_name, registration_no');

  if (error) { console.error('Fetch error:', error.message); process.exit(1); }
  console.log(`Loaded ${companies.length} companies from Supabase\n`);

  let updated = 0, skipped = 0, notFound = 0;

  for (const auth of AUTHORITATIVE) {
    // Find best match in companies table
    let best = null, bestScore = 0;
    for (const c of companies) {
      const score = wordOverlap(c.company_name, auth.name);
      if (score > bestScore) { bestScore = score; best = c; }
    }

    if (!best || bestScore < 0.5) {
      console.log(`✗ NOT FOUND: ${auth.name}`);
      notFound++;
      continue;
    }

    if (best.registration_no === auth.uen) {
      process.stdout.write(`  ✓ ${auth.name.substring(0,50)} UEN already correct\n`);
      skipped++;
      continue;
    }

    // Update UEN
    const { error: upErr } = await sb
      .from('companies')
      .update({ registration_no: auth.uen })
      .eq('id', best.id);

    if (upErr) {
      console.log(`✗ Update failed for ${auth.name}: ${upErr.message}`);
    } else {
      console.log(`✓ ${best.company_name.substring(0,45).padEnd(45)} → UEN: ${auth.uen} (was: ${best.registration_no || 'null'})`);
      updated++;
    }
  }

  console.log(`\n✅ Done: ${updated} updated, ${skipped} already correct, ${notFound} not found`);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
