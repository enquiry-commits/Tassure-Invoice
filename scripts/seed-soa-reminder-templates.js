// One-time seed: the real 1st/2nd/3rd escalating SOA reminder wording,
// supplied by Vincent as 3 real Word documents (Auto_1st/2nd/3rd.docx,
// 2026-09-17) — the actual company-wide reminder sequence, not placeholder
// text. Converts the docx's own <User Name>/<Amount>/<Date>/<Day>
// placeholders to this app's real merge fields ({{contactName}},
// {{totalAmount}}, {{lastReminderDate}}, {{daysOverdue}} — the last two are
// new, auto-computed fields added the same day, see lib/email-merge.ts).
//
// The docx's own "PAYMENT METHOD付款方式:" section is an embedded bank/QR
// image — deliberately NOT re-embedded here. Vincent confirmed it's the
// same image Billing Drafts' own AR templates already rely on, and
// components/client-communications/OutlookStyleSendModal.tsx already
// auto-attaches /assets/payment_options.png (+ the standing bank-details
// PDF) whenever a draft's body contains the literal text "PAYMENT METHOD" —
// confirmed against the real existing 'ar' template rows, which end in that
// exact marker with no image markup of their own. Keeping the same marker
// here is enough; no image handling needed in this script.
//
// Additive: inserts 3 new rows and keeps old placeholder rows only so past
// email_campaigns.template_id foreign keys remain valid. The application
// now hides every other SOA template and exposes only this fixed 1st/2nd/3rd
// sequence. "1st Reminder" becomes the type='soa' default.
//
// Usage: node scripts/seed-soa-reminder-templates.js
// Safe to re-run: skips any template whose exact name already exists.

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const env = fs.readFileSync('.env.local', 'utf8');
function getEnv(name) {
  const m = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
  if (!m) throw new Error(`${name} not found in .env.local`);
  return m[1].trim();
}
const supabase = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SECRET_KEY'));

const TEMPLATES = [
  {
    name: '1st Reminder',
    is_default: true,
    subject_template: 'Payment Reminder (1st Notice) - {{companyName}}',
    body_template: `Dear {{contactName}},

It has come to our attention that your account with us has an outstanding amount of S$${'{{totalAmount}}'}.

Enclosed is a copy of invoice(s) and monthly statement(s) for your easy reference.

We would greatly appreciate it if you could kindly assist in looking into the payment status of the outstanding amount.

Please inform us if you have made payment earlier than our reminder email and provide us copies of payment record for our updates.

If you have any enquiries, please do not hesitate to contact us.

Thank you.

尊敬的 {{contactName}},

首先非常感谢贵公司对我们实信集团的支持，很荣幸为贵公司提供我们的服务，并保持长期友好的合作关系。截至今日，我司账面尚有贵公司有未付款项，金额为{{totalAmount}}新元。

随函附上发票和月结单副本，方便供您参考和查阅。

如果您能协助尽快安排付款，我们将不胜感激。

请通知我们，如果您已提前在此邮件发送时付款，并向我们提供付款单的副本，我们的财务会尽快查看并更新记录。

让我们继续与贵公司携手发展，实现共赢。

如果您有任何疑问，请随时与我们联系。

谢谢您！

Please see below summary of the outstanding invoices:

以下是未偿还的发票，请查阅：

{{invoiceList}}

Total 总金额：S$${'{{totalAmount}}'}

PAYMENT METHOD付款方式:

Kindly disregard this email if the payment has already been made.

如果您已经完成了付款，请您忽略此邮件。感谢您一直以来对我们公司的支持与信任。`,
  },
  {
    name: '2nd Reminder',
    is_default: false,
    subject_template: 'Payment Reminder (2nd Notice) - {{companyName}}',
    body_template: `Dear {{contactName}},

Further to our email sent on {{lastReminderDate}}, we are writing you to remind you that an amount of S$${'{{totalAmount}}'} is due for more than {{daysOverdue}} days.

You may have overlooked the payment due to your busy schedules; we are resending you our first reminder email and bank payment details so that you can make payment at your convenient time.

Please inform us if you have made payment earlier than our 2nd reminder email and provide us copies of payment record for our updates.

Thank you for your immediate attention.

If you have any enquiries, please do not hesitate to contact us.

尊敬的{{contactName}},

感谢您百忙之中抽空查看这封邮件。继我方于 {{lastReminderDate}}所发送的付款提醒邮件之后，尚未收到您的回复。可能由于贵公司业务过于繁忙，以至忽略，故特致函再次提醒您，贵公司一笔逾期款项 {{totalAmount}} 新元，已逾期{{daysOverdue}}天。

为了方便您的付款，我们重新向您发送我们上一封提醒邮件和相关发票和结单，和我们的银行付款详细信息。

为了我们双方今后更好的合作，请您在收到此邮件后能立即协助安排付款。再次感谢贵公司长期以来的大力支持！

请通知我们，如果您已提前在此邮件发送时付款，并向我们提供付款单的副本，我们的财务会尽快查看并更新记录。

非常感谢您的及时关注与协助。

如果您有任何疑问，请随时与我们联系。

Please see below summary of the outstanding invoices:

以下是未偿还的发票，请查阅：

{{invoiceList}}

Total 总金额：S$${'{{totalAmount}}'}

PAYMENT METHOD付款方式:

Kindly disregard this email if the payment has already been made.

如果您已经完成了付款，请您忽略此邮件。感谢您一直以来对我们公司的支持与信任。`,
  },
  {
    name: '3rd Reminder',
    is_default: false,
    subject_template: 'Payment Reminder (3rd & Final Notice) - {{companyName}}',
    body_template: `Dear {{contactName}},

We have been writing to you since {{lastReminderDate}} requesting for the payment of a total outstanding amount of S$${'{{totalAmount}}'}.

Attached herewith statement of account and bank details for your payment arrangement.

You have not notified us of any reason for non-payment of amount, neither have we received payment which is now inordinately overdue.

Our Group strives to provide a combination of value for money and an efficient service to all our esteemed clients and this can only be achieved if our clients make payment on time.

We would be grateful if you would look into the non-payment of the overdue amount stated in the attached statement of account and arrange payments immediately.

Please inform us if you have made payment earlier than our 3rd reminder email and provide us copies of payment record for our updates.

We look forward to hearing from you immediately.

Thank you for your immediate action.

If you have any enquiries, please do not hesitate to contact us.

尊敬的{{contactName}},

继 {{lastReminderDate}} 起，我们已两次通过电子邮件提醒贵公司支付欠款金额{{totalAmount}}新元。但我方至今仍未收到该笔款项，也没有收到任何关于未支付欠款金额的原因。

特请贵公司能够重视此事并立即支付上述款项以让我们继续与贵公司一起保持相互的支持和信任！我们也希望继续为信誉良好的贵公司提供有价值和高效的服务，并长期保持良好的合作关系！随函附上相关的发票，结单和银行付款账户信息，方便供您参考和立即安排付款。

再次感谢贵公司长期以来的大力支持！

请通知我们，如果您已提前在此邮件发送时付款，并向我们提供付款单的副本，我们的财务会尽快查看并更新记录。

非常感谢您的及时关注与协助。

如果您有任何疑问，请随时与我们联系。

Please see below summary of the outstanding invoices:

以下是未偿还的发票，请查阅：

{{invoiceList}}

Total 总金额：S$${'{{totalAmount}}'}

PAYMENT METHOD付款方式:

Kindly disregard this email if the payment has already been made.

如果您已经完成了付款，请您忽略此邮件。感谢您一直以来对我们公司的支持与信任。`,
  },
];

async function main() {
  const { data: existing, error: existingErr } = await supabase.from('email_templates').select('id, name').eq('type', 'soa');
  if (existingErr) throw existingErr;
  const existingNames = new Set((existing ?? []).map(t => t.name));

  const toInsert = TEMPLATES.filter(t => !existingNames.has(t.name)).map(t => ({ ...t, type: 'soa' }));
  if (!toInsert.length) {
    console.log('All 3 templates already exist by name — nothing to insert.');
    return;
  }

  if (toInsert.some(t => t.is_default)) {
    const { error } = await supabase.from('email_templates').update({ is_default: false }).eq('type', 'soa').eq('is_default', true);
    if (error) throw error;
  }

  const { data: inserted, error } = await supabase.from('email_templates').insert(toInsert).select('id, name, is_default');
  if (error) throw error;
  console.log(`Inserted ${inserted.length} template(s):`);
  for (const t of inserted) console.log(`  id=${t.id} "${t.name}" default=${t.is_default}`);
}

main().catch(err => { console.error(err); process.exit(1); });
