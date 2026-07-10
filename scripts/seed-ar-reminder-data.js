// Seeds screenshot data (FYE April 2026, as of 08/05/2026) into ar_reminder table
// Each row: [entity_name, ar_status, xbrl, software_update, dpo, ond_ron, pic, acc_pic, tax_pic, remarks, reminder_note]
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const SEED = [
  // entity_name (exact DB name)           | ar   | xbrl  | sw_upd | dpo    | ond_ron      | sec_pic    | acc_pic         | tax_pic  | remarks                 | reminder_note
  ['AUTHENTIC ENTERPRISE MANAGEMENT CONSULTING PTE. LTD.', '', '',     'YES',  'DONE', '',           'Hoe Chyi', 'Vernice',       'VY',     '',                      ''],
  ['AFRI S GROUP PTE. LTD.',                               '', '',     '',     '',     '',           'Kah Ye',   'Jay',           '',       '',                      ''],
  ['BROTH BEYOND SINGAPORE PTE. LTD.',                     'I','DONE', '',     '',     '',           'Shemin',   'Client',        'VY',     '',                      ''],
  ['CHINASIN MARINE ENGINEERING PTE. LTD.',                '', '',     '',     '',     '',           'Shemin',   'JF',            '',       '',                      ''],
  ['CHRONOAI PTE. LTD.',                                   '', 'YES',  '',     '',     '',           'Shemin',   'JF',            'QT',     '',                      ''],
  ['CHENG HE CONSTRUCTION PTE. LTD.',                      '', '',     '',     '',     '',           'Shemin',   'YH',            '',       '',                      ''],
  ['DJ BEAUTY TANG PTE. LTD.',                             'I','DONE', '',     '',     '',           'Shemin',   'WE',            'QT',     '',                      ''],
  ['ELECTRAMIN INTERNATIONAL PTE. LTD.',                   '', '',     '',     '',     '',           'Hoe Chyi', 'YH',            'EP',     '',                      ''],
  ['GOOHAI SHIPPING PTE. LTD.',                            '', 'DONE', 'DONE', '',     '',           'Shemin',   'YH',            'VY',     '',                      ''],
  ['GOLDEN LOTUS INFORMATION SERVICE PTE. LTD.',           '', 'DONE', 'DONE', '',     '',           'Shemin',   'JF',            'VY',     'EP',                    ''],
  ['HONG YANG DEVELOPMENT PTE. LTD.',                      'I','DONE', '',     '',     '',           'Shi Ming', 'Audited-CKS',   'CS',     '',                      ''],
  ['HAI RUI PTE. LTD.',                                    'I','DONE', '',     '',     '',           'Shi Ming', 'YH',            'QT',     'EP',                    ''],
  ['H & W SPA PTE. LTD.',                                  '', 'DONE', '',     '',     '',           'Shi Ming', 'Vernice',       '',       '',                      ''],
  ['IHORIZON CONSULTING SINGAPORE PTE. LTD.',               '', 'YES',  'DONE', '',     '',           'Shi Ming', 'JAY',           'QT',     '',                      ''],
  ['I-LINK TECHNOLOGY PTE. LTD.',                          'yes','DONE','',    '',     '',           'Shemin',   'Client',        'Client', '',                      ''],
  ['INFINITY LINKS PTE. LTD.',                             '', 'YES',  'DONE', '',     '',           'Shi Ming', 'Vernice',       'QT',     '',                      ''],
  ['JIA JIA FU PTE. LTD.',                                 'I','DONE', '',     '',     '',           'Shemin',   'JAY',           'QT',     '',                      ''],
  ['JOPHEN INVESTENT MANAGEMENT PTE. LTD.',                '', 'YES',  'DONE', '',     '',           'Shemin',   'JF',            'QT',     '',                      ''],
  ['LOYANG BESTCONN TRADING & SERVICES PTE. LTD.',         '', 'DONE', '',     'DONE', '',           'Shi Ming', 'Client',        'Client', '',                      ''],
  ['LIE YANG CONSTRUCTION PTE. LTD.',                      'I','DONE', '',     '',     '',           'Shi Ming', 'WE',            'QT',     '',                      ''],
  ['LYNKORA TECHNOLOGY PTE. LTD.',                         '', '',     '',     '',     '',           'Hoe Chyi', 'YH',            '',       'please look for Cindy', ''],
  ['MUTUAL SYNERGY TRADING PTE. LTD.',                     'CLIENT','DONE','', '',     '',           'Shemin',   'YH',            'QT',     '',                      ''],
  ['MERIT BULK PTE. LTD.',                                 '', 'YES',  'DONE', '',     '',           'Shemin',   'Vernice',       'QT',     'EP',                    ''],
  ['NAJIWAN PTE. LTD.',                                    '', '',     '',     'DONE', '',           'Shemin',   'WE',            'QT',     '',                      ''],
  ['OCEANIC APEX SHIPPING PTE. LTD.',                      '', '',     '',     '',     '',           'Kah Ye',   'Jay',           '',       '',                      ''],
  ['QAP LEISURE ASSET HOLDINGS PTE. LTD.',                 '', '',     '',     '',     '',           'Kah Ye',   'Jay',           '',       '',                      ''],
  ['RUICH INTERNATIONAL TRADING PTE. LTD.',                'I','',    '',     '',     'CLIENT ND',  'Shemin',   'Vernice',       'QT',     '',                      ''],
  ['STARTASTER TECHNOLOGY PTE. LTD.',                      'CLIENT','DONE','', '',     '',           'Shi Ming', 'YH',            'VY',     '',                      ''],
  ['SNACKING PTE. LTD.',                                   'YES','DONE','',    '',     '',           'Shi Ming', 'YH',            'QT',     '',                      ''],
  ['SUPER MALL PTE. LTD.',                                 '', 'DONE', '',     'DONE', '',           'Shi Ming', 'WE',            'QT',     '',                      ''],
  ['TAIHUA SHIPPING PTE. LTD.',                            'I','DONE', '',     '',     '',           'Shi Ming', 'Vernice',       'VY',     '',                      ''],
  ['TOUCHSTONE MEDTECH PTE. LTD.',                         'I','DONE', '',     '',     '',           'Shi Ming', 'WE',            'CS',     'EP',                    ''],
  ['TRILITHON CAPITAL PTE. LTD.',                          '', '',     '',     '',     '',           'Kah Ye',   'JF',            '',       '',                      '16.06.2026'],
  ['BAOBABTREE (S) PTE. LTD.',                             '', '',     '',     '',     '',           'Shemin',   '',              '',       '',                      ''],
  // YUAN SOON CONSTRUCTION PTE. LTD. was not scraped from Due Date Tracker — inserted manually
  ['YUAN SOON CONSTRUCTION PTE. LTD.',                     '', '',     '',     '',     '',           'Shemin',   'JAY',           '',       '',                      ''],
];

async function main() {
  let updated = 0, inserted = 0, skipped = 0;

  for (const [name, ar_status, xbrl, software_update, dpo, ond_ron, pic, acc_pic, tax_pic, remarks, reminder_note] of SEED) {
    const updates = {
      ...(ar_status      && { ar_status }),
      ...(xbrl           && { xbrl }),
      ...(software_update && { software_update }),
      ...(dpo            && { dpo }),
      ...(ond_ron        && { ond_ron }),
      ...(pic            && { pic }),
      ...(acc_pic        && { acc_pic }),
      ...(tax_pic        && { tax_pic }),
      ...(remarks        && { remarks }),
      ...(reminder_note  && { reminder_note }),
    };

    // Check if record exists
    const { data: existing } = await sb.from('ar_reminder')
      .select('id')
      .eq('fye_month', 'April').eq('fye_year', 2026)
      .eq('entity_name', name)
      .maybeSingle();

    if (existing) {
      if (Object.keys(updates).length > 0) {
        const { error } = await sb.from('ar_reminder').update(updates).eq('id', existing.id);
        if (error) { console.error(`  ✗ ${name}: ${error.message}`); skipped++; }
        else { console.log(`  ✓ updated: ${name.substring(0, 50)}`); updated++; }
      } else {
        skipped++;
      }
    } else {
      // Insert new row (e.g. YUAN SOON)
      const { error } = await sb.from('ar_reminder').insert({
        entity_name: name,
        fye_month: 'April', fye_year: 2026,
        ...updates,
      });
      if (error) { console.error(`  ✗ INSERT ${name}: ${error.message}`); skipped++; }
      else { console.log(`  + inserted: ${name}`); inserted++; }
    }
  }

  console.log(`\n✅ Done — updated: ${updated}, inserted: ${inserted}, skipped/no-change: ${skipped}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
