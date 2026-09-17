/**
 * One-time update: the 3 SOA escalating-reminder templates' subject lines
 * were seeded (scripts/seed-soa-reminder-templates.js) with placeholder
 * English wording ("Payment Reminder (1st Notice) - {{companyName}}") that
 * never matched the real subject convention Chelsea actually uses. Vincent,
 * WhatsApp 2026-09-17, relaying Chelsea's own text (labeled "SOA email
 * subject"): "Auto1:GENTLE REMINDER FROM TASSURE GROUP (SEP 2026) /
 * Auto2: 2ND REMINDER FROM TASSURE GROUP (SEP 2026) / Auto3: 3RD REMINDER
 * FROM TASSURE GROUP (SEP 2026)" — confirmed "Auto1/2/3:" is just her own
 * labeling (not part of the subject), and confirmed the subject
 * deliberately carries NO company name (unlike every other template here).
 * The "(SEP 2026)" portion becomes {{sendMonth}} (lib/date.ts's
 * currentMonthUpperSGT(), wired into the merge-field pipeline the same day)
 * so staff never have to hand-edit the month again.
 *
 * Safe to re-run (idempotent: sets subject_template unconditionally to the
 * same target value each time).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const UPDATES = [
  { name: '1st Reminder', subject_template: 'GENTLE REMINDER FROM TASSURE GROUP ({{sendMonth}})' },
  { name: '2nd Reminder', subject_template: '2ND REMINDER FROM TASSURE GROUP ({{sendMonth}})' },
  { name: '3rd Reminder', subject_template: '3RD REMINDER FROM TASSURE GROUP ({{sendMonth}})' },
];

(async () => {
  for (const u of UPDATES) {
    const { data, error } = await sb.from('email_templates')
      .update({ subject_template: u.subject_template })
      .eq('type', 'soa').eq('name', u.name)
      .select('id, name, subject_template');
    if (error) { console.error(`FAILED ${u.name}:`, error.message); continue; }
    if (!data || !data.length) { console.log(`No row found for name="${u.name}" type=soa — skipped.`); continue; }
    console.log(`Updated: ${JSON.stringify(data[0])}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
