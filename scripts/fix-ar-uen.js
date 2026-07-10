/**
 * Fix UENs in ar_reminder:
 *   1. For each of the 35 companies, find the best-matching existing row (fuzzy name)
 *   2. UPDATE that row with the correct UEN
 *   3. DELETE any duplicate rows that were inserted with full FKA names
 *
 * Usage: node scripts/fix-ar-uen.js [month] [year]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const FYE_MONTH = process.argv[2] || 'April';
const FYE_YEAR  = parseInt(process.argv[3] || '2026');

const COMPANIES = [
  { company_name: 'AUTHENTIC ENTERPRISE MANAGEMENT CONSULTING PTE. LTD.', uen: '202320507E' },
  { company_name: 'AFRI S GROUP PTE. LTD.',                               uen: '202526827Z' },
  { company_name: 'BROTH BEYOND SINGAPORE PTE. LTD. (FKA THE DOLLAR SHOP SINGAPORE PTE. LTD.)', uen: '202117339E' },
  { company_name: 'CHINASIN MARINE ENGINEERING PTE. LTD',                 uen: '202521112H' },
  { company_name: 'CHRONOAI PTE. LTD. (FKA AELF PTE. LTD.)',             uen: '201815367H' },
  { company_name: 'CHENG HE CONSTRUCTION PTE. LTD.',                      uen: '202536252N' },
  { company_name: 'DJ BEAUTY TANG PTE. LTD.',                             uen: '202317100G' },
  { company_name: 'ELECTRAMIN INTERNATIONAL PTE. LTD.',                   uen: '202519736W' },
  { company_name: 'GOOHAH SHIPPING PTE. LTD.',                            uen: '202215911K' },
  { company_name: 'GOLDEN LOTUS INFORMATION SERVICE PTE. LTD.',           uen: '202418776H' },
  { company_name: 'HONG YANG DEVELOPMENT PTE. LTD.',                      uen: '201110838G' },
  { company_name: 'HAI RUI PTE. LTD.',                                    uen: '202419688E' },
  { company_name: 'H & W SPA PTE. LTD.',                                  uen: '201523516W' },
  { company_name: 'IHORIZON CONSULTING SINGAPORE PTE. LTD',               uen: '201712019K' },
  { company_name: 'I-LINK TECHNOLOGY PTE. LTD. (f.k.a. HK AIR LOGISTIC SINGAPORE PTE. LTD.)', uen: '201915742K' },
  { company_name: 'INFINITY LINKS PTE. LTD.',                             uen: '202320434R' },
  { company_name: 'JIA JIA FU PTE. LTD.',                                 uen: '201714658K' },
  { company_name: 'JOPHEN INVESTMENT MANAGEMENT PTE. LTD.',               uen: '201815438R' },
  { company_name: 'LOYANG BESTCON TRADING & SERVICES',                    uen: '201916145M' },
  { company_name: 'LIE YANG CONSTRUCTION PTE. LTD.',                      uen: '202217190W' },
  { company_name: 'LYNKORA TECHNOLOGY PTE. LTD.',                         uen: '202522163Z' },
  { company_name: 'MUTUAL SYNERGY TRADING PTE. LTD.',                     uen: '202013163Z' },
  { company_name: 'MERIT BULK PTE. LTD.',                                 uen: '202214878M' },
  { company_name: 'NAJIWAN PTE. LTD.',                                    uen: '202417366C' },
  { company_name: 'OCEANIC APEX SHIPPING PTE. LTD.',                      uen: '202523571E' },
  { company_name: 'QAP LEISURE ASSET HOLDINGS PTE. LTD.',                 uen: '202525381C' },
  { company_name: 'RUICHI INTERNATIONAL TRADING PTE. LTD',                uen: '202319422K' },
  { company_name: 'STARTASTER TECHNOLOGY PTE. LTD.',                      uen: '201312363W' },
  { company_name: 'SNACKING PTE. LTD.',                                   uen: '202014534G' },
  { company_name: 'SUPER MALL PTE. LTD.',                                 uen: '202317699M' },
  { company_name: 'TAIHUA SHIPPING PTE. LTD.',                            uen: '201714802K' },
  { company_name: 'TOUCHSTONE MEDTECH PTE. LTD.',                         uen: '202320811R' },
  { company_name: 'TRILITHON CAPITAL PTE. LTD.',                          uen: '202522838W' },
  { company_name: 'YUAN SOON CONSTRUCTION PTE. LTD.',                     uen: '200202467H' },
  { company_name: 'BAOBABTREE (S) PTE. LTD.',                             uen: '202523505Z' },
];

// Strip FKA/f.k.a. clause, Pte Ltd variants, punctuation — get core name
function normalize(name) {
  return name
    .toLowerCase()
    .replace(/\(fka\b[^)]*\)/gi, '')      // (FKA ...)
    .replace(/\(f\.k\.a\.[^)]*\)/gi, '')  // (f.k.a. ...)
    .replace(/\bpte\.?\s*ltd\.?\b/gi, '')
    .replace(/\bprivate\s+limited\b/gi, '')
    .replace(/\blimited\b/gi, '')
    .replace(/\bllp\b/gi, '')
    .replace(/[.\-,()&]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function score(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 90;
  const wa = new Set(na.split(' ').filter(w => w.length > 1));
  const wb = new Set(nb.split(' ').filter(w => w.length > 1));
  if (!wa.size || !wb.size) return 0;
  const common = [...wa].filter(w => wb.has(w)).length;
  return Math.round((common / Math.max(wa.size, wb.size)) * 100);
}

async function run() {
  // Fetch ALL ar_reminder rows for this FYE (including duplicates)
  const { data: rows, error } = await sb
    .from('ar_reminder')
    .select('id, entity_name, uen, fye_date, prepared_date, sent_date')
    .eq('fye_month', FYE_MONTH)
    .eq('fye_year', FYE_YEAR);

  if (error) { console.error(error.message); process.exit(1); }
  console.log(`Found ${rows.length} rows in ar_reminder for ${FYE_MONTH} ${FYE_YEAR}\n`);

  let updated = 0, deleted = 0, skipped = 0;

  for (const c of COMPANIES) {
    // Find all rows that match this company name (above 70%)
    const matches = rows
      .map(r => ({ ...r, s: score(c.company_name, r.entity_name) }))
      .filter(r => r.s >= 70)
      .sort((a, b) => {
        // Prefer: has fye_date → has UEN → higher score
        const aScore = (a.fye_date ? 1000 : 0) + (a.uen ? 100 : 0) + a.s;
        const bScore = (b.fye_date ? 1000 : 0) + (b.uen ? 100 : 0) + b.s;
        return bScore - aScore;
      });

    if (matches.length === 0) {
      console.log(`  [SKIP] No match: ${c.company_name}`);
      skipped++;
      continue;
    }

    const best = matches[0];
    const dupes = matches.slice(1);

    // Update best row with UEN if missing or different
    if (best.uen !== c.uen) {
      const { error: updErr } = await sb
        .from('ar_reminder')
        .update({ uen: c.uen })
        .eq('id', best.id);
      if (updErr) {
        console.error(`  [ERR] Update ${best.entity_name}: ${updErr.message}`);
      } else {
        console.log(`  [UEN] ${best.entity_name} → ${c.uen}`);
        updated++;
      }
    } else {
      console.log(`  [OK ] ${best.entity_name} already has UEN ${c.uen}`);
    }

    // Delete duplicate rows (same company, different name variant)
    for (const dupe of dupes) {
      const { error: delErr } = await sb
        .from('ar_reminder')
        .delete()
        .eq('id', dupe.id);
      if (delErr) {
        console.error(`  [ERR] Delete dupe ${dupe.entity_name}: ${delErr.message}`);
      } else {
        console.log(`  [DEL] Dupe removed: "${dupe.entity_name}" (id=${dupe.id})`);
        deleted++;
      }
    }
  }

  console.log(`\n✅ Done — ${updated} UENs updated, ${deleted} duplicates removed, ${skipped} skipped`);
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
