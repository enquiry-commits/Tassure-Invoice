/**
 * Sets the 3 SOA escalating-reminder templates' subject lines (email_templates,
 * type 'soa') to the house convention — docs/INVARIANTS.md INV-MAIL-008:
 *
 *   {{companyName}} - GENTLE REMINDER FROM TASSURE GROUP ({{sendMonth}})
 *   {{companyName}} - 2ND REMINDER FROM TASSURE GROUP ({{sendMonth}})
 *   {{companyName}} - 3RD REMINDER FROM TASSURE GROUP ({{sendMonth}})
 *
 * History. Seeded (scripts/seed-soa-reminder-templates.js) with placeholder
 * wording ("Payment Reminder (1st Notice) - {{companyName}}"). Vincent,
 * WhatsApp 2026-09-17, relaying Chelsea's own text: "Auto1:GENTLE REMINDER
 * FROM TASSURE GROUP (SEP 2026) / Auto2: 2ND REMINDER … / Auto3: 3RD
 * REMINDER …" ("Auto1/2/3:" was her labeling, not part of the subject), at
 * the time deliberately with NO company name; "(SEP 2026)" became
 * {{sendMonth}} (lib/date.ts's currentMonthUpperSGT()). Vincent,
 * 2026-10-07, on a real 2nd-reminder draft: "SOA Email Drafts 的 Subject来讲，
 * 需要统一格式，不管是第几次 reminder — Wangxiaozan Singapore Pte. - GENTLE
 * REMINDER FROM TASSURE GROUP (OCT 2026)", then "1st REMINDER 放 GENTLE
 * REMINDER / 2nd REMINDER 放 2ND REMINDER / 3rd REMINDER 放 3RD REMINDER" — so
 * the company name now leads every stage, the stage wording stays, and the
 * name is the stored one ("照系统存的，全大写": {{companyName}} as merged by
 * lib/email-merge.ts, no title-casing).
 *
 * Run from the repository: node scripts/update-soa-reminder-subjects.js
 * (reads .env.local itself). Safe to re-run (idempotent). Drafts that already
 * exist keep the subject they were created with — only campaigns created, or
 * drafts re-prepared, after the run get the new one.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const UPDATES = [
  { name: '1st Reminder', subject_template: '{{companyName}} - GENTLE REMINDER FROM TASSURE GROUP ({{sendMonth}})' },
  { name: '2nd Reminder', subject_template: '{{companyName}} - 2ND REMINDER FROM TASSURE GROUP ({{sendMonth}})' },
  { name: '3rd Reminder', subject_template: '{{companyName}} - 3RD REMINDER FROM TASSURE GROUP ({{sendMonth}})' },
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
