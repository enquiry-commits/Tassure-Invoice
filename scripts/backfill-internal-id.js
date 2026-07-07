const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const DRY_RUN = process.argv.includes('--dry-run');

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\(f\.?k\.?a\.?[^)]*\)/gi, '')
    .replace(/\bpte\.?\s*ltd\.?\s*/gi, '')
    .replace(/\bprivate\s+limited\b/gi, '')
    .replace(/\blimited\b/gi, '')
    .replace(/\b(s'?pore|singapore)\b/gi, '')
    .replace(/\binternational\b/gi, 'intl')
    .replace(/[().,&@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordOverlap(a, b) {
  const wa = new Set(normalizeName(a).split(' ').filter(w => w.length > 1));
  const wb = new Set(normalizeName(b).split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  const common = [...wa].filter(w => wb.has(w)).length;
  return common / Math.max(wa.size, wb.size); // stricter: normalized by the larger set
}

async function main() {
  const { data: companies, error } = await sb.from('companies').select('id, company_name, internal_id').is('internal_id', null);
  if (error) { console.error(error); process.exit(1); }
  console.log(`${companies.length} companies missing internal_id.`);

  const twList = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'teamwork-api', 'companies-list.json'), 'utf-8'));

  const highConfidence = [];
  const lowConfidence = [];

  for (const c of companies) {
    let best = null, bestScore = 0;
    for (const tw of twList) {
      const score = wordOverlap(c.company_name, tw.company_name);
      if (score > bestScore) { bestScore = score; best = tw; }
    }
    if (best && bestScore >= 0.9) {
      highConfidence.push({ id: c.id, company_name: c.company_name, match: best.company_name, company_id: best.company_id, score: bestScore });
    } else {
      lowConfidence.push({ id: c.id, company_name: c.company_name, bestMatch: best?.company_name ?? null, score: bestScore.toFixed(2) });
    }
  }

  console.log(`\n=== High confidence matches (>=0.9): ${highConfidence.length} ===`);
  for (const m of highConfidence) {
    console.log(`  #${m.id} "${m.company_name}" -> TW "${m.match}" (company_id=${m.company_id}, score=${m.score.toFixed(2)})`);
    if (!DRY_RUN) {
      const { error: upErr } = await sb.from('companies').update({ internal_id: m.company_id }).eq('id', m.id);
      if (upErr) console.error('    ERROR:', upErr.message);
    }
  }

  console.log(`\n=== Low confidence / no match (needs manual review): ${lowConfidence.length} ===`);
  for (const m of lowConfidence) {
    console.log(`  #${m.id} "${m.company_name}" -> best guess: "${m.bestMatch}" (score=${m.score})`);
  }
}

main();
